"""Safe phase diagnostics are tested without starting Docker or loading private state."""
import ast
import collections
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
import rehearsal_evidence


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
        actual = collections.Counter(hashlib.sha256(ast.dump(node, include_attributes=False).encode()).hexdigest()
                                     for node in ast.walk(self.source) if isinstance(node, ast.Assert))
        self.assertEqual(coverage['originalAssertionCount'], 124)
        self.assertFalse(collections.Counter(coverage['originalAssertions']) - actual)
        recovery = next(n for n in self.source.body if isinstance(n, ast.FunctionDef) and n.name == 'recovery')
        phases = [n.items[0].context_expr.args[0].value for n in ast.walk(recovery)
                  if isinstance(n, ast.With) and isinstance(n.items[0].context_expr, ast.Call)
                  and isinstance(n.items[0].context_expr.func, ast.Name)
                  and n.items[0].context_expr.func.id == 'rehearsal_phase']
        self.assertEqual(phases, coverage['recovery'])

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
