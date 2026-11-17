"""Focused control-flow tests; real child failures are also exercised by rehearsal.py."""
import contextlib
import hashlib
import io
import json
import signal
import sys
import pathlib
import subprocess
import tarfile
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

    def test_heartbeat_closed_diagnostic_survives_successful_jobs_and_cleanup_commands(self):
        diagnostic = {'event': 'probe.heartbeat_failed', 'schemaVersion': 1, 'phase': 'query',
                      'nativeCode': 'ER_NO_SUCH_TABLE', 'elapsedMs': 7, 'deadlineMs': 1000}
        captured = io.StringIO()
        script = ('import sys; print("Heartbeat: unavailable", file=sys.stderr); print(' +
                  repr(json.dumps(diagnostic)) + ', file=sys.stderr); sys.exit(1)')
        with self.assertRaisesRegex(RuntimeError, '^OPERATION_CHILD_FAILED$'), contextlib.redirect_stderr(captured):
            ops.run([sys.executable, '-c', script], timeout=2)
        record = json.loads(captured.getvalue())
        self.assertEqual((record['outcome'], record['exitCode']), ('exit', 1))
        self.assertEqual(record['migrations'], [])
        paths = [self.base / ('state/last-failed-child.' + suffix) for suffix in ['json', 'stdout', 'stderr']]
        before = [path.read_bytes() for path in paths]
        lines = before[2].splitlines()
        self.assertEqual(lines[0], b'Heartbeat: unavailable')
        self.assertEqual(json.loads(lines[1]), diagnostic)
        self.assertNotIn('probe.heartbeat_failed', captured.getvalue())
        for outcome in ['jobs completed', 'cleanup completed']:
            self.assertEqual(ops.run([sys.executable, '-c', 'print(' + repr(outcome) + ')'], timeout=2),
                             (outcome + '\n').encode())
            self.assertEqual([path.read_bytes() for path in paths], before)
        self.assertTrue(all(path.stat().st_mode & 0o777 == 0o600 for path in paths))
        self.assertTrue(all(path.stat().st_size <= ops.DIAGNOSTIC_BYTES for path in paths))

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


def archive(files, link=None):
    """A volume archive as tar writes it: the root entry, then fictional regular files."""
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode='w') as output:
        root = tarfile.TarInfo('.')
        root.type, root.mode = tarfile.DIRTYPE, 0o700
        output.addfile(root)
        for name, content in files.items():
            entry = tarfile.TarInfo(f'./{name}')
            entry.size = len(content)
            output.addfile(entry, io.BytesIO(content))
        if link:
            entry = tarfile.TarInfo(f'./{link[0]}')
            entry.type, entry.linkname = tarfile.LNKTYPE, f'./{link[1]}'
            output.addfile(entry)
    return buffer.getvalue()


class FakeDocker:
    """Answers the export and restore children; archives are keyed by volume name suffix."""
    def __init__(self, volumes, archives):
        self.volumes, self.archives, self.calls = volumes, archives, []

    def __call__(self, args, **kwargs):
        self.calls.append((args, kwargs))
        if args[:3] == ['docker', 'volume', 'ls']:
            return ''.join(f'{name}\n' for name in self.volumes).encode()
        if args[:2] == ['docker', 'run'] and args[-3:] == ['-cf', '-', '.']:
            source = next(value for value in args if value.startswith('type=volume,')).split(',')[1]
            kwargs['output'].write(self.archives[source.removeprefix('source=').rsplit('_', 1)[1]])
            return None
        return b''

    def media_calls(self):
        return [args for args, _ in self.calls if any('event-media' in value for value in args)]


def compose(args, **kwargs):
    if 'mysqldump' in args:
        kwargs['output'].write(b'-- fictional dump\n')
        return None
    return b''


class ExportTests(unittest.TestCase):
    revision, image = 'a' * 40, 'sha256:' + 'b' * 64
    media = {'fictional.blob': b'fictional-media\n', 'fictional.thumb': b'fictional-thumb\n'}

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.base = pathlib.Path(self.directory.name)
        (self.base / 'state').mkdir()
        (self.base / 'private/maintenance').mkdir(parents=True)
        (self.base / 'private/identity-mail.env').write_text('IDENTITY_ENABLED=true\nMAIL_MODE=disabled\n')
        for target, value in [('BASE', self.base), ('validate_image', None), ('compose', compose),
                              ('accepted_image_id', lambda _revision: self.image)]:
            item = patch.object(ops, target, value) if value is not None else patch.object(ops, target)
            item.start()
            self.addCleanup(item.stop)

    def export(self, volumes, media=None):
        docker = FakeDocker(volumes, {'evidence': archive({'fictional-evidence.txt': b'evidence\n'}),
                                      'event-media': archive(media or self.media)})
        with patch.object(ops, 'run', docker):
            identity = ops.export_locked(self.revision)
        return identity, docker

    def test_export_without_a_media_volume_keeps_the_two_file_manifest(self):
        identity, docker = self.export([])
        directory, manifest = ops.validate_export(identity)
        self.assertEqual(set(manifest['files']), {'database.sql', 'evidence.tar'})
        self.assertNotIn('eventMediaFiles', manifest)
        self.assertFalse((directory / 'event-media.tar').exists())
        self.assertEqual(len(docker.media_calls()), 1)  # Only the inventory query.

    def test_export_follows_the_project_set_at_run_time(self):
        # The rehearsal sets PROJECT after import; the inventory and archive must use that value.
        with patch.object(ops, 'PROJECT', 'vtc011-0123456789abcdef'):
            identity, docker = self.export(['vtc011-0123456789abcdef_event-media'])
        self.assertIn('eventMediaFiles', ops.validate_export(identity)[1])
        self.assertTrue(all('vtc011-0123456789abcdef_event-media' in ' '.join(args) for args in docker.media_calls()))

    def test_export_refuses_a_configured_root_without_its_volume_and_an_unexpected_inventory(self):
        (self.base / 'private/identity-mail.env').write_text('EVENT_MEDIA_ROOT=/app/private-event-media\n')
        for volumes, code in [([], 'EVENT_MEDIA_VOLUME_MISSING'),
                              ([f'{ops.PROJECT}_event-media-copy'], 'EVENT_MEDIA_VOLUME_INVENTORY_INVALID'),
                              ([f'{ops.PROJECT}_event-media'] * 2, 'EVENT_MEDIA_VOLUME_INVENTORY_INVALID')]:
            with self.subTest(volumes=volumes):
                with patch.object(ops, 'compose') as dump:
                    with self.assertRaisesRegex(RuntimeError, '^EXPORT_FAILED$') as failure:
                        self.export(volumes)
                self.assertEqual(failure.exception.__context__.args, (code,))
                dump.assert_not_called()
        self.assertFalse(list((self.base / 'state/exports').glob('*/manifest.json')))

    def test_export_with_media_hashes_every_name_and_validation_fails_closed(self):
        identity, docker = self.export([f'{ops.PROJECT}_event-media'])
        directory, manifest = ops.validate_export(identity)
        self.assertEqual(set(manifest['files']), {'database.sql', 'evidence.tar', 'event-media.tar'})
        self.assertEqual(manifest['eventMediaFiles'], {name: {'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()}
                                                       for name, content in self.media.items()})
        archive_call = docker.media_calls()[1]
        self.assertIn('--hard-dereference', archive_call)
        self.assertIn(f'type=volume,source={ops.PROJECT}_event-media,target=/event-media,readonly', archive_call)
        original = (directory / 'manifest.json').read_text()
        media_bytes = (directory / 'event-media.tar').read_bytes()

        def changed(update, code):
            value = json.loads(original)
            update(value)
            (directory / 'manifest.json').write_text(json.dumps(value))
            with self.assertRaisesRegex(RuntimeError, f'^{code}$'):
                ops.validate_export(identity)
            (directory / 'manifest.json').write_text(original)
            (directory / 'event-media.tar').write_bytes(media_bytes)

        changed(lambda value: value.pop('eventMediaFiles'), 'EXPORT_INVALID')
        changed(lambda value: value['files'].pop('event-media.tar'), 'EXPORT_INVALID')
        changed(lambda value: value['eventMediaFiles']['fictional.blob'].update(bytes=1), 'EVENT_MEDIA_MANIFEST_INVALID')
        changed(lambda value: value['eventMediaFiles'].pop('fictional.thumb'), 'EVENT_MEDIA_MANIFEST_INVALID')
        changed(lambda _value: (directory / 'event-media.tar').write_bytes(media_bytes + b'x'), 'EXPORT_CHECKSUM_INVALID')
        # A hard link that reaches the manifest with matching hashes is still not a regular file.
        linked = archive(self.media, link=('fictional.copy', 'fictional.blob'))
        def relinked(value):
            (directory / 'event-media.tar').write_bytes(linked)
            value['files']['event-media.tar'] = {'sha256': hashlib.sha256(linked).hexdigest(), 'bytes': len(linked)}
        changed(relinked, 'ARCHIVE_TYPE_INVALID')
        ops.validate_export(identity)

    def restore(self, identity, restored_media):
        self.docker = FakeDocker([], {'evidence': archive({'fictional-evidence.txt': b'evidence\n'}),
                                      'event-media': restored_media})
        with patch.object(ops, 'run', self.docker), patch.object(ops, 'compose', side_effect=compose) as self.composed, \
                patch.object(ops, 'fenced', side_effect=lambda *_a, **_k: ops.maintenance(True)), \
                patch.object(ops, 'ready'), patch.object(ops, 'public_ready'):
            return ops.restore_locked(identity), self.docker

    def test_restore_fills_only_a_new_media_volume_and_compares_it(self):
        identity, _ = self.export([f'{ops.PROJECT}_event-media'])
        exported = (self.base / 'state/exports' / identity / 'event-media.tar').read_bytes()
        project, docker = self.restore(identity, archive(self.media))
        self.assertTrue(project.startswith('vtc-development-restore-'))
        self.assertFalse((self.base / 'private/maintenance/enabled').exists())
        calls = docker.media_calls()
        self.assertEqual(calls[0], ['docker', 'volume', 'create', f'{project}_event-media'])
        self.assertEqual([kwargs.get('data') for args, kwargs in docker.calls if '-xf' in args][-1], exported)
        self.assertIn(ops.MEDIA_ROOT_CHECK, calls[2])
        self.assertIn(f'type=volume,source={project}_event-media,target=/app/private-event-media', calls[2])
        # The active volume is never mounted, so restore cannot change or switch active media.
        self.assertFalse([args for args in calls if any(f'source={ops.PROJECT}_event-media,' in value for value in args)])

    def test_restore_with_different_media_bytes_stays_fenced(self):
        identity, _ = self.export([f'{ops.PROJECT}_event-media'])
        with self.assertRaisesRegex(RuntimeError, '^RESTORED_EVENT_MEDIA_MISMATCH$'):
            self.restore(identity, archive({'fictional.blob': b'other-media\n'}))
        self.assertTrue((self.base / 'private/maintenance/enabled').exists())
        self.assertFalse([call for call in self.composed.call_args_list if 'app' in call.args[0]])
        # A refused media root also stops the restore before the inventory comparison.
        refused = FakeDocker([], {})
        def failing(args, **kwargs):
            if ops.MEDIA_ROOT_CHECK in args:
                raise RuntimeError('OPERATION_CHILD_FAILED')
            return refused(args, **kwargs)
        manifest = json.loads((self.base / 'state/exports' / identity / 'manifest.json').read_text())
        with patch.object(ops, 'run', failing):
            with self.assertRaisesRegex(RuntimeError, '^OPERATION_CHILD_FAILED$'):
                ops.restore_event_media(self.base / 'state/exports' / identity, manifest,
                                        'vtc-development-restore-fictional', self.revision, self.image)
        self.assertFalse([args for args, _ in refused.calls if args[-3:] == ['-cf', '-', '.']])
        with self.assertRaisesRegex(RuntimeError, '^RESTORE_DESTINATION_INVALID$'):
            ops.restore_event_media(self.base, manifest, ops.PROJECT, self.revision, self.image)


if __name__ == '__main__':
    unittest.main()
