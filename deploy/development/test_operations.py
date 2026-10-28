"""Focused control-flow tests; real child failures are also exercised by rehearsal.py."""
import contextlib
import io
import json
import signal
import sys
import pathlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import operations as ops


class TickTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.base = pathlib.Path(self.directory.name)
        (self.base / 'state').mkdir()
        (self.base / 'private/maintenance').mkdir(parents=True)
        self.base_patch = patch.object(ops, 'BASE', self.base)
        self.base_patch.start()
        self.addCleanup(self.base_patch.stop)
        self.validation = patch.object(ops, 'validate_image')
        self.validate = self.validation.start()
        self.addCleanup(self.validation.stop)

    def result(self):
        return json.loads((self.base / 'state/tick-last.json').read_text())

    def failed_tick(self):
        with self.assertRaisesRegex(RuntimeError, '^TICK_FAILED$'):
            ops.tick_locked('a' * 40, 'sha256:' + 'b' * 64)
        result = self.result()
        self.assertEqual(result['status'], 'failed')
        self.assertNotIn('completedUtc', result)
        self.assertGreaterEqual(result['finishedUtc'], result['attemptedUtc'])
        return result

    def test_jobs_failure_follows_heartbeat_and_retains_safe_outcomes(self):
        order = []
        def heartbeat(*args, **kwargs):
            self.assertEqual(kwargs['timeout'], 30)
            order.append('heartbeat')
        def jobs(*args):
            order.append('jobs')
            raise RuntimeError('OPERATION_CHILD_FAILED')
        with patch.object(ops, 'heartbeat_locked', side_effect=heartbeat), patch.object(ops, 'jobs_locked', side_effect=jobs):
            result = self.failed_tick()
        self.assertEqual(order, ['heartbeat', 'jobs'])
        self.assertEqual(result['steps']['heartbeat']['status'], 'completed')
        self.assertEqual(result['steps']['jobs']['category'], 'client_failed')
        for step in result['steps'].values():
            self.assertGreaterEqual(step['attemptedUtc'], result['attemptedUtc'])
            self.assertGreaterEqual(step['durationMs'], 0)

    def test_ordinary_heartbeat_timeout_allows_jobs_after_successful_cleanup(self):
        with patch.object(ops, 'heartbeat_locked', side_effect=subprocess.TimeoutExpired('private-command', 30)), patch.object(ops, 'jobs_locked') as jobs:
            result = self.failed_tick()
        jobs.assert_called_once()
        self.assertEqual(result['steps']['heartbeat']['category'], 'client_timeout')
        self.assertEqual(result['steps']['jobs']['status'], 'completed')
        self.assertNotIn('private-command', json.dumps(result))

    def test_cleanup_failure_fences_all_later_writers(self):
        with patch.object(ops, 'run', side_effect=OSError('private-detail')), patch.object(ops, 'compose') as compose, patch.object(ops, 'jobs_locked') as jobs:
            result = self.failed_tick()
        compose.assert_not_called()
        jobs.assert_not_called()
        self.assertEqual(result['steps']['heartbeat']['category'], 'safety_fence')
        self.assertEqual(result['steps']['jobs']['status'], 'skipped_safety_fence')

    def test_control_failure_and_invalid_image_do_not_authorize_later_writers(self):
        with patch.object(ops, 'heartbeat_locked', side_effect=ValueError('private-detail')), patch.object(ops, 'jobs_locked') as jobs:
            result = self.failed_tick()
        jobs.assert_not_called()
        self.assertEqual(result['steps']['jobs']['status'], 'skipped_control_failure')
        self.assertNotIn('private-detail', json.dumps(result))
        self.validate.side_effect = RuntimeError('OPERATION_CHILD_FAILED')
        with patch.object(ops, 'heartbeat_locked') as heartbeat, patch.object(ops, 'jobs_locked') as jobs:
            self.failed_tick()
        heartbeat.assert_not_called()
        jobs.assert_not_called()

    def test_failed_heartbeat_with_failed_final_cleanup_never_starts_jobs(self):
        with patch.object(ops, 'run', side_effect=[b'', b'', OSError('private-detail')]), patch.object(ops, 'compose', side_effect=RuntimeError('OPERATION_CHILD_FAILED')) as compose, patch.object(ops, 'jobs_locked') as jobs:
            result = self.failed_tick()
        compose.assert_called_once()
        jobs.assert_not_called()
        self.assertEqual(result['steps']['heartbeat']['category'], 'safety_fence')
        self.assertEqual(result['steps']['jobs']['status'], 'skipped_safety_fence')
        self.assertTrue((self.base / 'state/recovery-required').exists())

    def test_acceptance_window_is_explicit_and_still_attempts_heartbeat(self):
        (self.base / 'state/jobs-acceptance').touch()
        with patch.object(ops, 'heartbeat_locked') as heartbeat, patch.object(ops, 'jobs_locked') as jobs:
            ops.tick_locked('a' * 40, 'sha256:' + 'b' * 64)
        heartbeat.assert_called_once()
        jobs.assert_not_called()
        self.assertEqual(self.result()['steps']['jobs']['status'], 'skipped_acceptance_window')
        self.assertEqual(self.result()['status'], 'completed_with_skips')

    def test_existing_maintenance_prevents_any_writer(self):
        ops.maintenance(True)
        with patch.object(ops, 'heartbeat_locked') as heartbeat, patch.object(ops, 'jobs_locked') as jobs:
            with self.assertRaisesRegex(RuntimeError, '^MAINTENANCE$'):
                ops.tick_locked('a' * 40, 'sha256:' + 'b' * 64)
        heartbeat.assert_not_called()
        jobs.assert_not_called()

    def test_cleanup_validates_every_owner_before_any_removal(self):
        ids = ['a' * 12, 'b' * 12]
        def info(identity, suffix, service):
            return {'Id': identity + '0' * 52, 'Name': f'/{ops.PROJECT}-{suffix}',
                    'Config': {'Labels': {'com.docker.compose.project': ops.PROJECT,
                                          'com.docker.compose.service': service}}}
        inspected = [info(ids[0], 'jobs', 'jobs'), info(ids[1], 'heartbeat', 'wrong-service')]
        with patch.object(ops, 'run', side_effect=[' '.join(ids).encode(), json.dumps(inspected).encode()]) as run:
            with self.assertRaisesRegex(RuntimeError, '^WORKER_RECOVERY_REQUIRED$'):
                ops.stop_owned_jobs('a' * 40)
        self.assertEqual(run.call_count, 2)
        self.assertTrue((self.base / 'state/recovery-required').exists())
        self.assertTrue((self.base / 'private/maintenance/enabled').exists())

    def test_cleanup_batches_only_verified_owned_containers_with_bounded_clients(self):
        identity = 'a' * 12
        info = {'Id': identity + '0' * 52, 'Name': f'/{ops.PROJECT}-jobs',
                'Config': {'Labels': {'com.docker.compose.project': ops.PROJECT,
                                      'com.docker.compose.service': 'jobs'}}}
        with patch.object(ops, 'run', side_effect=[identity.encode(), json.dumps([info]).encode(), b'', b'']) as run:
            ops.stop_owned_jobs('a' * 40)
        self.assertEqual([call.kwargs['timeout'] for call in run.call_args_list[:3]], [10, 10, 20])
        self.assertGreater(run.call_args_list[3].kwargs['timeout'], 0)
        self.assertLessEqual(run.call_args_list[3].kwargs['timeout'], 10)
        self.assertEqual(run.call_args_list[2].args[0], ['docker', 'rm', '-f', info['Id']])

    def cleanup_info(self):
        return {'Id': 'a' * 64, 'Name': f'/{ops.PROJECT}-jobs',
                'Config': {'Labels': {'com.docker.compose.project': ops.PROJECT,
                                      'com.docker.compose.service': 'jobs'}}}

    def test_auto_removal_in_progress_requires_eventual_absence_without_second_delete(self):
        for outcome in [RuntimeError('OPERATION_CHILD_FAILED'), subprocess.TimeoutExpired('private', 20), b'']:
            with self.subTest(outcome=type(outcome).__name__):
                responses = [b'a' * 12, json.dumps([self.cleanup_info()]).encode(), outcome, b'a' * 12, b'']
                with patch.object(ops, 'run', side_effect=responses) as run, patch.object(ops.time, 'sleep'):
                    ops.stop_owned_jobs('a' * 40)
                self.assertEqual(sum(call.args[0][:3] == ['docker', 'rm', '-f'] for call in run.call_args_list), 1)
                self.assertFalse((self.base / 'state/recovery-required').exists())

    def test_auto_removal_between_inventory_and_inspection_never_authorizes_delete(self):
        with patch.object(ops, 'run', side_effect=[b'a' * 12, RuntimeError('OPERATION_CHILD_FAILED'), b'a' * 12, b'']) as run, patch.object(ops.time, 'sleep'):
            ops.stop_owned_jobs('a' * 40)
        self.assertFalse(any(call.args[0][:3] == ['docker', 'rm', '-f'] for call in run.call_args_list))
        self.assertFalse((self.base / 'state/recovery-required').exists())

    def test_persistent_or_replacement_container_keeps_recovery_fenced(self):
        for outcome, remaining in [(RuntimeError('OPERATION_CHILD_FAILED'), b'a' * 12), (b'', b'b' * 12)]:
            with self.subTest(remaining=remaining):
                responses = [b'a' * 12, json.dumps([self.cleanup_info()]).encode(), outcome, remaining, remaining]
                with patch.object(ops, 'run', side_effect=responses) as run, patch.object(ops, 'wait_owned_jobs_absent', side_effect=RuntimeError('WORKER_STILL_PRESENT')):
                    with self.assertRaisesRegex(RuntimeError, '^WORKER_RECOVERY_REQUIRED$'):
                        ops.stop_owned_jobs('a' * 40)
                self.assertEqual(sum(call.args[0][:3] == ['docker', 'rm', '-f'] for call in run.call_args_list), 1)
                self.assertTrue((self.base / 'state/recovery-required').exists())
                self.assertTrue((self.base / 'private/maintenance/enabled').exists())

    def test_poll_failure_and_unrelated_control_error_keep_recovery_fenced(self):
        for responses in [
                [b'a' * 12, json.dumps([self.cleanup_info()]).encode(), RuntimeError('OPERATION_CHILD_FAILED'), OSError('private')],
                [b'a' * 12, json.dumps([self.cleanup_info()]).encode(), RuntimeError('UNRELATED_CONTROL_FAILURE')],
                [b'a' * 12, RuntimeError('UNRELATED_CONTROL_FAILURE')]]:
            with self.subTest(count=len(responses)), patch.object(ops, 'run', side_effect=responses):
                with self.assertRaisesRegex(RuntimeError, '^WORKER_RECOVERY_REQUIRED$'):
                    ops.stop_owned_jobs('a' * 40)
                self.assertTrue((self.base / 'state/recovery-required').exists())

    def test_absence_poll_has_one_total_budget_and_no_success_after_deadline(self):
        with patch.object(ops, 'run', return_value=b'a' * 12) as run, patch.object(ops.time, 'monotonic', side_effect=[0, 0, 9.9, 10]), patch.object(ops.time, 'sleep') as sleep:
            with self.assertRaisesRegex(RuntimeError, '^WORKER_STILL_PRESENT$'):
                ops.wait_owned_jobs_absent(['docker', 'ps'])
        self.assertEqual(run.call_count, 1)
        self.assertLessEqual(sleep.call_args.args[0], 0.11)

    def test_partial_batch_disappearance_revalidates_survivor_before_removal(self):
        survivor = self.cleanup_info()
        survivor['Id'] = 'b' * 64
        survivor['Name'] = f'/{ops.PROJECT}-heartbeat'
        survivor['Config']['Labels']['com.docker.compose.service'] = 'heartbeat'
        responses = [('a' * 12 + ' ' + 'b' * 12).encode(), RuntimeError('OPERATION_CHILD_FAILED'),
                     b'b' * 12, json.dumps([survivor]).encode(), b'', b'']
        with patch.object(ops, 'run', side_effect=responses) as run:
            ops.stop_owned_jobs('a' * 40)
        self.assertEqual(run.call_args_list[3].args[0], ['docker', 'inspect', 'b' * 12])
        self.assertEqual(run.call_args_list[4].args[0], ['docker', 'rm', '-f', 'b' * 64])
        self.assertFalse((self.base / 'state/recovery-required').exists())

    def test_partial_batch_replacement_or_wrong_owner_never_authorizes_removal(self):
        wrong_owner = self.cleanup_info()
        wrong_owner['Id'] = 'b' * 64
        wrong_owner['Config']['Labels']['com.docker.compose.service'] = 'wrong'
        for tail in [[b'c' * 12], [b'b' * 12, json.dumps([wrong_owner]).encode()]]:
            responses = [('a' * 12 + ' ' + 'b' * 12).encode(), RuntimeError('OPERATION_CHILD_FAILED'), *tail]
            with patch.object(ops, 'run', side_effect=responses) as run:
                with self.assertRaisesRegex(RuntimeError, '^WORKER_RECOVERY_REQUIRED$'):
                    ops.stop_owned_jobs('a' * 40)
            self.assertFalse(any(call.args[0][:3] == ['docker', 'rm', '-f'] for call in run.call_args_list))

    def test_repeated_partial_disappearance_shares_discovery_deadline(self):
        responses = [('a' * 12 + ' ' + 'b' * 12).encode(), RuntimeError('OPERATION_CHILD_FAILED'), b'b' * 12]
        with patch.object(ops, 'run', side_effect=responses) as run, patch.object(ops.time, 'monotonic', side_effect=[0, 0, 10, 19, 20]):
            with self.assertRaisesRegex(RuntimeError, '^WORKER_RECOVERY_REQUIRED$'):
                ops.stop_owned_jobs('a' * 40)
        self.assertEqual([call.kwargs['timeout'] for call in run.call_args_list], [10, 10, 1])


class ChildOutcomeTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.base = pathlib.Path(self.directory.name)
        self.base_patch = patch.object(ops, 'BASE', self.base)
        self.base_patch.start()
        self.addCleanup(self.base_patch.stop)

    def test_native_failure_retains_both_streams_and_safe_context_through_cleanup(self):
        diagnostic = {'event': 'database.migration_failed', 'code': 'MIGRATION_EXECUTION_FAILED',
                      'nativeCodes': ['PROTOCOL_SEQUENCE_TIMEOUT', 'private-host'],
                      'databaseOperation': {'operation': 'migration_baseline', 'wireDeadlineMs': 1000,
                                            'elapsedMs': 1001, 'sql': 'private-sql'},
                      'message': 'private-password', 'args': ['private-path']}
        for stream in ['stdout', 'stderr']:
            captured = io.StringIO()
            script = 'import sys; print(' + repr(json.dumps(diagnostic)) + ', file=sys.' + stream + '); print("private-output"); sys.exit(7)'
            with self.assertRaisesRegex(RuntimeError, '^OPERATION_CHILD_FAILED$'), contextlib.redirect_stderr(captured):
                ops.run([sys.executable, '-c', script], timeout=2)
            record = json.loads(captured.getvalue())
            self.assertEqual((record['outcome'], record['exitCode'], record['signal']), ('exit', 7, None))
            self.assertEqual(record['migrations'], [{'code': 'MIGRATION_EXECUTION_FAILED',
                'nativeCodes': ['PROTOCOL_SEQUENCE_TIMEOUT'], 'databaseOperation': {
                    'operation': 'migration_baseline', 'wireDeadlineMs': 1000, 'elapsedMs': 1001}}])
            self.assertNotIn('private-', captured.getvalue())
            files = [self.base / ('state/last-failed-child.' + suffix) for suffix in ['json', 'stdout', 'stderr']]
            before = [path.read_bytes() for path in files]
            self.assertEqual(ops.run([sys.executable, '-c', 'print("cleanup")'], timeout=2), b'cleanup\n')
            self.assertEqual([path.read_bytes() for path in files], before)
            self.assertTrue(all(path.stat().st_mode & 0o777 == 0o600 for path in files))

    def test_failed_private_stream_retention_is_bounded(self):
        captured = io.StringIO()
        with self.assertRaisesRegex(RuntimeError, '^OPERATION_CHILD_FAILED$'), contextlib.redirect_stderr(captured):
            ops.run([sys.executable, '-c', 'import sys; print("x" * 100000); print("y" * 100000, file=sys.stderr); sys.exit(3)'], timeout=2)
        for suffix in ['stdout', 'stderr']:
            self.assertEqual((self.base / ('state/last-failed-child.' + suffix)).stat().st_size, ops.DIAGNOSTIC_BYTES)
        self.assertEqual(json.loads(captured.getvalue())['migrations'], [])

    def test_malformed_unknown_and_oversized_child_records_are_not_forwarded(self):
        payload = {'event': 'database.migration_failed', 'code': ['private-value'],
                   'nativeCodes': ['ER_LOCK_DEADLOCK'] * 9 + ['ECONNRESET'],
                   'databaseOperation': {'operation': 'migration_statement', 'wireDeadlineMs': True, 'elapsedMs': 0},
                   'sql': 'private-sql'}
        data = (b'private-prefix' * 65536 + b'\n' + b'x' * 4097 + b'\n' + b'{bad json\n' +
                json.dumps(['private-value']).encode() + b'\n' + json.dumps(payload).encode())
        result = ops.migration_diagnostics(data)
        self.assertEqual(result, [{'code': 'MIGRATION_EXECUTION_FAILED', 'nativeCodes': ['ER_LOCK_DEADLOCK']}])
        self.assertNotIn('private-', json.dumps(result))
        self.assertEqual(ops.migration_diagnostics(None), [])
        self.assertEqual(len(ops.migration_diagnostics((json.dumps(payload).encode() + b'\n') * 64)), 8)
        payload['databaseOperation'] = {'operation': 'private-operation', 'wireDeadlineMs': 1, 'elapsedMs': 0}
        self.assertNotIn('databaseOperation', ops.migration_diagnostics(json.dumps(payload).encode())[0])

    def test_timeout_signal_spawn_failure_and_streamed_success_preserve_native_behavior(self):
        captured = io.StringIO()
        with self.assertRaises(subprocess.TimeoutExpired), contextlib.redirect_stderr(captured):
            ops.run([sys.executable, '-c', 'import time; print("private-partial", flush=True); time.sleep(5)'], timeout=0.1)
        self.assertEqual(json.loads(captured.getvalue())['outcome'], 'timeout')
        self.assertIn(b'private-partial', (self.base / 'state/last-failed-child.stdout').read_bytes())
        captured = io.StringIO()
        with self.assertRaisesRegex(RuntimeError, '^OPERATION_CHILD_FAILED$'), contextlib.redirect_stderr(captured):
            ops.run([sys.executable, '-c', 'import os, signal; os.kill(os.getpid(), signal.SIGTERM)'], timeout=2)
        self.assertEqual(json.loads(captured.getvalue())['signal'], signal.SIGTERM)
        captured = io.StringIO()
        with self.assertRaises(FileNotFoundError), contextlib.redirect_stderr(captured):
            ops.run(['/nonexistent-synthetic-child'], timeout=2)
        self.assertEqual(json.loads(captured.getvalue())['outcome'], 'spawn_error')
        with tempfile.TemporaryFile() as destination:
            self.assertIsNone(ops.run([sys.executable, '-c', 'print("streamed")'], output=destination, timeout=2))
            destination.seek(0)
            self.assertEqual(destination.read(), b'streamed\n')
        self.assertNotIn('private-', captured.getvalue())


if __name__ == '__main__':
    unittest.main()
