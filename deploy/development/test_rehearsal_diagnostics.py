"""Safe phase diagnostics are tested without starting Docker or loading private state."""
import ast
import contextlib
import io
import json
import pathlib
import subprocess
import time
import unittest


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
        phases = {node.items[0].context_expr.args[0].value: node for node in self.source.body
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


if __name__ == '__main__':
    unittest.main()
