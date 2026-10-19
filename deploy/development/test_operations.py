"""Focused control-flow tests; real child failures are also exercised by rehearsal.py."""
import json
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
        self.assertEqual([call.kwargs['timeout'] for call in run.call_args_list], [10, 10, 20, 10])
        self.assertEqual(run.call_args_list[2].args[0], ['docker', 'rm', '-f', identity])


if __name__ == '__main__':
    unittest.main()
