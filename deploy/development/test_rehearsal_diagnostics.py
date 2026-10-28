"""Safe phase diagnostics are tested without starting Docker or loading private state."""
import ast
import collections
import copy
import contextlib
import io
import hashlib
import json
import pathlib
import os
import subprocess
import time
import unittest
import tempfile
import types
import sys
from unittest.mock import patch
import rehearsal_evidence


def predecessor_assertion_digest(node):
    # Preserve predecessor assertion coverage modulo the single path-local rename that
    # prevents it from shadowing the new global handoff writer. Operators/values stay exact.
    comparable = copy.deepcopy(node)
    for name in ast.walk(comparable):
        if isinstance(name, ast.Name) and name.id == 'receipt_path': name.id = 'receipt'
    return hashlib.sha256(ast.dump(comparable, include_attributes=False).encode()).hexdigest()


class RehearsalEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        (self.root / 'state').mkdir()

    def save(self, name, value):
        path = self.root / 'state' / name
        path.write_text(json.dumps(value)); path.chmod(0o600)
        return path

    def test_reader_exports_only_allowlisted_private_records_and_byte_digests(self):
        path = self.save('rehearsal-core.json', {'binding': {'sourceSha': 'a' * 40}})
        self.save('runtime.env', {'password': 'fictional-secret-not-exported'})
        bundle = rehearsal_evidence.collect(self.root)
        self.assertEqual(list(bundle['files']), ['rehearsal-core.json'])
        self.assertEqual(bundle['digests']['rehearsal-core.json'], hashlib.sha256(path.read_bytes()).hexdigest())
        self.assertNotIn('fictional-secret', json.dumps(bundle))
        self.assertFalse(bundle['windowFenced'])
        self.save('notifications-acceptance', {'private': 'fictional-fence-value-not-exported'})
        fenced = rehearsal_evidence.collect(self.root)
        self.assertTrue(fenced['windowFenced'])
        self.assertNotIn('fictional-fence-value', json.dumps(fenced))

    def test_reader_rejects_symlink_modes_nonobjects_and_oversize(self):
        name = 'rehearsal-core.json'
        path = self.save(name, {})
        path.chmod(0o644)
        with self.assertRaisesRegex(RuntimeError, '^REHEARSAL_EVIDENCE_FILE_INVALID$'):
            rehearsal_evidence.collect(self.root)
        path.unlink(); path.symlink_to(self.root / 'foreign')
        with self.assertRaisesRegex(RuntimeError, '^REHEARSAL_EVIDENCE_FILE_INVALID$'):
            rehearsal_evidence.collect(self.root)
        path.unlink(); self.save(name, [])
        with self.assertRaisesRegex(RuntimeError, '^REHEARSAL_EVIDENCE_SHAPE_INVALID$'):
            rehearsal_evidence.collect(self.root)
        self.save(name, {'bounded': 'x' * rehearsal_evidence.MAXIMUM})
        with self.assertRaisesRegex(RuntimeError, '^REHEARSAL_EVIDENCE_FILE_INVALID$'):
            rehearsal_evidence.collect(self.root)

    def test_node_retention_is_exclusive_bound_and_never_overwrites_evidence(self):
        module = pathlib.Path(__file__).with_name('rehearsal-child.mjs').as_uri()
        script = '''
import assert from 'node:assert/strict';import{readFile,stat}from'node:fs/promises';
const{retainRehearsalEvidence:retain,validateEvidenceCollector:validate}=await import(process.argv[1]);
const target=process.argv[2],digest='c'.repeat(64),sourceSha='a'.repeat(40),sourceFingerprint='b'.repeat(64),revision='d'.repeat(40),project='vtc011-0123456789abcdef',volume=project+'-config';
const run='12345678-1234-4123-8123-123456789abc',expectedImageId='sha256:'+digest;
const options={requireWindow:true,requiredGroups:['core'],sourceSha,sourceFingerprint,revision,project,volume,expectedImageId};
const bundle={version:1,windowFenced:false,files:{'rehearsal-core.json':{binding:{sourceSha,sourceFingerprint,revision,project,volume}},'notifications-acceptance-last.json':{result:'cleaned',scenario:9,sharedGrantsUnchanged:true,sharedFilesUnchanged:true,evidenceSha256:digest},'notifications-acceptance-evidence.json':{runId:run,revision,imageId:expectedImageId,fixture:{runId:run,status:'pass',scenarios:[1,2,3,4,5,6,7,8,9].map(ordinal=>({ordinal,status:'pass'}))}}},digests:{}};
for(const name of Object.keys(bundle.files))bundle.digests[name]=digest;
const bytes=Buffer.from(JSON.stringify(bundle));assert.equal(await retain(bytes,target,options),3);assert.equal((await stat(target)).mode&0o777,0o600);
const original=await readFile(target);await assert.rejects(retain(bytes,target,options),{code:'EEXIST'});assert.deepEqual(await readFile(target),original);
await assert.rejects(retain(bytes,target+'-foreign',{...options,sourceFingerprint:'e'.repeat(64)}),/REHEARSAL_GROUP_EVIDENCE_BINDING_INVALID/);
await assert.rejects(retain(Buffer.from(JSON.stringify({version:1,windowFenced:false,files:{'runtime.env':{}},digests:{'runtime.env':digest}})),target+'-unsafe',options),/REHEARSAL_EVIDENCE_SHAPE_INVALID/);
await assert.rejects(retain(Buffer.from(JSON.stringify({version:1,windowFenced:false,files:{},digests:{}})),target+'-missing',{...options,requiredGroups:[]}),/REHEARSAL_WINDOW_EVIDENCE_MISSING/);
const expected={id:'e'.repeat(64),name:'fictional-evidence',imageId:expectedImageId,project,volume,attempt:'f'.repeat(32)};
const actual={Id:expected.id,Name:'/'+expected.name,Image:expected.imageId,Config:{Labels:{'vtc011.rehearsal':project,'vtc011.evidence-attempt':expected.attempt}},HostConfig:{NetworkMode:'none',ReadonlyRootfs:true,CapDrop:['ALL'],CapAdd:null,SecurityOpt:['no-new-privileges:true']},Mounts:[{Type:'volume',Name:volume,Destination:'/evidence',RW:false}]};
validate(actual,expected);for(const mutate of [a=>a.Id='0'.repeat(64),a=>a.Image='foreign',a=>a.Config.Labels['vtc011.evidence-attempt']='foreign',a=>a.HostConfig.NetworkMode='bridge',a=>a.Mounts[0].RW=true]){const changed=structuredClone(actual);mutate(changed);assert.throws(()=>validate(changed,expected),/REHEARSAL_EVIDENCE_COLLECTOR_BINDING_INVALID/);}
console.log('PRIVATE_EXCLUSIVE_EVIDENCE_RETENTION=PASS');
'''
        result = subprocess.run(['node', '--input-type=module', '-e', script, module, str(self.root / 'retained.json')],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertIn(b'PRIVATE_EXCLUSIVE_EVIDENCE_RETENTION=PASS', result.stdout)


class RehearsalDiagnosticsTests(unittest.TestCase):
    def setUp(self):
        self.source = ast.parse(pathlib.Path(__file__).with_name('rehearsal.py').read_text())
        function = next(n for n in self.source.body if isinstance(n, ast.FunctionDef) and n.name == 'rehearsal_phase')
        namespace = dict(contextlib=contextlib, time=time, json=json, subprocess=subprocess,
                         rehearsal_started=time.monotonic(), phase='remove')
        exec(compile(ast.Module(body=[function], type_ignores=[]), '<rehearsal-diagnostic>', 'exec'), namespace)
        self.phase = namespace['rehearsal_phase']

    def test_actual_cleanup_path_assignment_cannot_shadow_final_core_receipt_writer(self):
        core = next(n for n in self.source.body if isinstance(n, ast.FunctionDef) and n.name == 'core')
        writer = next(n for n in self.source.body if isinstance(n, ast.FunctionDef) and n.name == 'receipt')
        assignments = [n for n in ast.walk(core) if isinstance(n, ast.Assign) and len(n.targets) == 1 and
                       isinstance(n.targets[0], ast.Name) and n.targets[0].id in ('receipt', 'receipt_path')]
        calls = [n for n in ast.walk(core) if isinstance(n, ast.Expr) and isinstance(n.value, ast.Call) and
                 isinstance(n.value.func, ast.Name) and n.value.func.id == 'receipt' and
                 len(n.value.args) == 3 and isinstance(n.value.args[1], ast.Constant) and n.value.args[1].value == 'core']
        self.assertEqual((len(assignments), len(calls)), (1, 1))
        def execute(old_shadow):
            writes = []
            assignment = copy.deepcopy(assignments[0])
            if old_shadow: assignment.targets[0].id = 'receipt'
            tail = copy.deepcopy(core); tail.name = 'core_tail'; tail.body = [assignment, copy.deepcopy(calls[0])]
            base = pathlib.Path('/synthetic')
            owner = types.SimpleNamespace(BASE=base, digest=lambda path: 'c' * 64 if path.name == 'current.json' else 'd' * 64,
                                          atomic_json=lambda path, value: writes.append((path, value)))
            namespace = dict(base=base, ops=owner, race_state={'directory': 'owned'}, intent={'receipt': 'ack.json'},
                image_id='sha256:' + 'a' * 64, checksum='b' * 64, image_archive=base / 'test-image.tar',
                binding=lambda: {'sourceFingerprint': 'e' * 64}, time=types.SimpleNamespace(time=lambda: 123))
            exec(compile(ast.Module(body=[copy.deepcopy(writer), tail], type_ignores=[]), '<actual-core-receipt-tail>', 'exec'), namespace)
            if old_shadow:
                with self.assertRaisesRegex(TypeError, "object is not callable"):
                    namespace['core_tail']()
                self.assertEqual(writes, [])
            else:
                namespace['core_tail']()
                self.assertEqual(writes, [(base / 'state/rehearsal-core.json', {
                    'binding': {'sourceFingerprint': 'e' * 64}, 'completedUtc': 123, 'imageId': 'sha256:' + 'a' * 64,
                    'checksum': 'b' * 64, 'archive': str(base / 'test-image.tar'),
                    'currentSha256': 'c' * 64, 'composeSha256': 'd' * 64})])
        execute(True)
        execute(False)

    def test_actual_fresh_handoff_restores_core_network_and_default_tls_context(self):
        original = next(n for n in self.source.body if isinstance(n, ast.FunctionDef) and n.name == 'handoff_context')
        core = next(n for n in self.source.body if isinstance(n, ast.FunctionDef) and n.name == 'core')
        def effect(node):
            if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call) and isinstance(node.value.func, ast.Attribute):
                call = node.value
                if call.func.attr == 'run' and call.args and isinstance(call.args[0], ast.List):
                    start = call.args[0].elts[:3]
                    destination = call.args[0].elts[3] if len(call.args[0].elts) > 3 else None
                    if len(start) == 3 and all(isinstance(v, ast.Constant) for v in start) and [v.value for v in start] == ['docker', 'network', 'connect'] and \
                            isinstance(destination, ast.JoinedStr) and any(isinstance(v, ast.Constant) and v.value == '_frontend' for v in destination.values):
                        return 'network'
            if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Subscript):
                target = node.targets[0]
                if isinstance(target.slice, ast.Constant) and target.slice.value == 'SSL_CERT_FILE': return 'ca'
            return None
        core_effects = {effect(node): ast.dump(node, include_attributes=False) for node in ast.walk(core) if effect(node)}
        with tempfile.TemporaryDirectory() as temporary:
            base = pathlib.Path(temporary); (base / 'state').mkdir(); (base / 'private').mkdir()
            (base / 'test-image.tar').touch(); (base / 'test-ca.crt').write_text('fictional-public-ca-fixture')
            (base / 'compose.yaml').write_text('{}')
            (base / 'private/operator.env').write_text('OPERATOR_TOKEN=NONFUNCTIONAL_FIXTURE\n')
            image, revision, project = 'sha256:' + 'a' * 64, 'b' * 40, 'vtc011-0123456789abcdef'
            reviewed = {'sourceFingerprint': 'c' * 64}
            (base / 'state/rehearsal-core.json').write_text(json.dumps({'binding': reviewed, 'completedUtc': 123,
                'imageId': image, 'currentSha256': 'd' * 64, 'composeSha256': 'd' * 64,
                'checksum': 'e' * 64, 'archive': str(base / 'test-image.tar')}))
            def execute(omitted):
                environment = {'REHEARSAL_PROJECT': project, 'REHEARSAL_REVISION': revision,
                               'REHEARSAL_VOLUME': project + '-config', 'HOSTNAME': 'f' * 12}
                commands, contexts = [], []
                owner = types.ModuleType('operations')
                owner.digest = lambda _: 'd' * 64
                owner.validate_image = lambda *args: self.assertEqual(args, (image, revision))
                owner.current = lambda: {'imageId': image, 'runId': 100}
                owner.compose = lambda *args, **kwargs: None
                owner.run = lambda args: commands.append(args)
                function = copy.deepcopy(original)
                function.body = [node for node in function.body if effect(node) not in omitted]
                namespace = dict(pathlib=types.SimpleNamespace(Path=lambda value: base if str(value) == '/opt/vtc-development' else pathlib.Path(value)),
                    json=json, os=types.SimpleNamespace(environ=environment), time=types.SimpleNamespace(time=lambda: 123),
                    binding=lambda: reviewed, ssl=types.SimpleNamespace(create_default_context=lambda **options: contexts.append(options)))
                with patch.dict(sys.modules, {'operations': owner}):
                    exec(compile(ast.Module(body=[function], type_ignores=[]), '<actual-fresh-handoff>', 'exec'), namespace)
                    value = namespace['handoff_context']()
                self.assertEqual(value[:3], (base, owner, project))
                self.assertEqual(contexts, [{'cafile': str(base / 'test-ca.crt')}])
                # A default native HTTPS client uses this fresh process's route/trust, not get()'s explicit context.
                self.assertEqual(commands, [['docker', 'network', 'connect', project + '_frontend', 'f' * 12]])
                self.assertEqual(environment.get('SSL_CERT_FILE'), str(base / 'test-ca.crt'))
            for omitted in ({'network', 'ca'}, {'network'}, {'ca'}):
                with self.assertRaises(AssertionError): execute(omitted)
            execute(set())
            handoff_effects = {effect(node): ast.dump(node, include_attributes=False) for node in original.body if effect(node)}
            self.assertEqual(handoff_effects, core_effects)

    def test_existing_module_bindings_cannot_shadow_the_phase_helper(self):
        stores = [n for n in ast.walk(self.source) if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Store) and n.id == 'rehearsal_phase']
        self.assertEqual(stores, [])
        output = io.StringIO()
        with contextlib.redirect_stdout(output), self.phase('tail-export'):
            pass
        records = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual([r['state'] for r in records], ['start', 'pass'])
        for record in records:
            self.assertEqual(record['phase'], 'tail-export')
            self.assertGreaterEqual(record['elapsedMs'], 0)
            self.assertGreaterEqual(record['sinceStartMs'], 0)
            self.assertRegex(record['startedAt'], r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$')

    def test_initial_startup_phases_wrap_the_original_bounded_operations(self):
        phases = {node.items[0].context_expr.args[0].value: node for node in ast.walk(self.source)
                  if isinstance(node, ast.With) and isinstance(node.items[0].context_expr, ast.Call)
                  and isinstance(node.items[0].context_expr.func, ast.Name)
                  and node.items[0].context_expr.func.id == 'rehearsal_phase'}
        startup = phases['initial-database-startup'].body
        migration = phases['initial-migration'].body
        self.assertEqual(len(startup), 1)
        self.assertEqual(len(migration), 1)
        self.assertEqual(ast.literal_eval(startup[0].value.args[0]), ['up', '-d', '--wait', 'db'])
        self.assertEqual(ast.literal_eval(migration[0].value.args[0]), ['run', '--rm', '--no-deps', 'migrate'])
        self.assertEqual(next(k.value.value for k in startup[0].value.keywords if k.arg == 'timeout'), 240)
        self.assertNotIn('timeout', [k.arg for k in migration[0].value.keywords])

    def test_failures_are_timed_rethrown_and_redacted(self):
        for error, category in [(AssertionError('private-evidence'), 'assertion'),
                                (subprocess.TimeoutExpired('private-command', 1, output='private-output'), 'timeout'),
                                (RuntimeError('private-configuration'), 'operation')]:
            output = io.StringIO()
            with self.assertRaises(type(error)), contextlib.redirect_stdout(output):
                with self.phase('tail-restore'):
                    raise error
            records = [json.loads(line) for line in output.getvalue().splitlines()]
            self.assertEqual([r['state'] for r in records], ['start', 'fail'])
            self.assertEqual(records[-1]['category'], category)
            self.assertNotIn('private-', output.getvalue())

    def test_composition_retains_all_predecessor_assertions_and_required_tail_phases(self):
        coverage = json.loads(pathlib.Path(__file__).with_name('rehearsal-coverage.json').read_text())
        actual = collections.Counter(predecessor_assertion_digest(node)
                                     for node in ast.walk(self.source) if isinstance(node, ast.Assert))
        self.assertEqual(coverage['originalAssertionCount'], 124)
        self.assertFalse(collections.Counter(coverage['originalAssertions']) - actual)
        recovery = next(n for n in self.source.body if isinstance(n, ast.FunctionDef) and n.name == 'recovery')
        phases = [n.items[0].context_expr.args[0].value for n in ast.walk(recovery)
                  if isinstance(n, ast.With) and isinstance(n.items[0].context_expr, ast.Call)
                  and isinstance(n.items[0].context_expr.func, ast.Name)
                  and n.items[0].context_expr.func.id == 'rehearsal_phase']
        self.assertEqual(phases, coverage['recovery'])

    def test_composition_retains_exact_reviewed_main_cleanup_race_block(self):
        coverage = json.loads(pathlib.Path(__file__).with_name('rehearsal-coverage.json').read_text())
        self.assertEqual(coverage['integratedMain'], '06296fc00e0408ea672d9ae12003a9ac49508411')
        self.assertEqual(sum(coverage['integratedCleanupAssertions'].values()), 4)
        actual = collections.Counter(predecessor_assertion_digest(node)
                                     for node in ast.walk(self.source) if isinstance(node, ast.Assert))
        expected = collections.Counter(coverage['originalAssertions']) + collections.Counter(coverage['integratedCleanupAssertions'])
        self.assertFalse(expected - actual)
        core = next(n for n in self.source.body if isinstance(n, ast.FunctionDef) and n.name == 'core')
        phases = [n for n in ast.walk(core) if isinstance(n, ast.With) and
                  isinstance(n.items[0].context_expr, ast.Call) and
                  isinstance(n.items[0].context_expr.func, ast.Name) and
                  n.items[0].context_expr.func.id == 'rehearsal_phase']
        self.assertEqual([n.items[0].context_expr.args[0].value for n in phases], coverage['core'])
        cleanup = next(n for n in phases if n.items[0].context_expr.args[0].value == 'core-worker-cleanup-races')
        block = ast.Module(body=cleanup.body, type_ignores=[])
        self.assertEqual(hashlib.sha256(ast.dump(block, include_attributes=False).encode()).hexdigest(),
                         coverage['integratedCleanupBlockSha256'])

    def test_actual_controller_argument_mapping_preserves_focused_manual_and_full_coverage(self):
        module = pathlib.Path(__file__).with_name('rehearsal-child.mjs').as_uri()
        program = '''import assert from 'node:assert/strict';
import {rehearsalPlan} from MODULE;
assert.deepEqual(rehearsalPlan([]),{mode:'full',groups:['core','window','recovery'],requireWindow:true,fullCoverage:true});
assert.deepEqual(rehearsalPlan(['--manual-only']),{mode:'manual-only',groups:['core'],requireWindow:false,fullCoverage:false});
assert.deepEqual(rehearsalPlan(['--core-recovery']),{mode:'full',groups:['core','recovery'],requireWindow:false,fullCoverage:false});
for(const args of [['--unknown'],['--manual-only','--core-recovery'],[null],null])assert.throws(()=>rehearsalPlan(args),/REHEARSAL_MODE_INVALID/);
'''.replace('MODULE', json.dumps(module))
        subprocess.run(['node', '--input-type=module', '-e', program], check=True, timeout=10,
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    def test_focused_manual_completion_returns_without_system_exit_or_full_handoff(self):
        core = next(n for n in self.source.body if isinstance(n, ast.FunctionDef) and n.name == 'core')
        focused = next(n for n in ast.walk(core) if isinstance(n, ast.If) and
                       ast.unparse(n.test) == "mode == 'manual-only'")
        self.assertIsInstance(focused.body[-1], ast.Return)
        self.assertFalse(any(isinstance(n, ast.Call) and ast.unparse(n.func) in ['sys.exit', 'receipt']
                             for n in ast.walk(focused)))


if __name__ == '__main__':
    unittest.main()
