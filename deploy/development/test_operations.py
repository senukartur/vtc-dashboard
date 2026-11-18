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


class ControlsReleaseTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = pathlib.Path(temporary.name)
        for name in ['state/incoming', 'state/controls-candidate', 'state/controls-previous', 'private/maintenance']:
            (self.base / name).mkdir(parents=True, mode=0o700, exist_ok=True)
        self.base.chmod(0o700)
        self.patch(ops, 'BASE', self.base)
        self.old = {'revision': 'a' * 40, 'imageId': 'sha256:' + 'a' * 64, 'runId': 10, 'attempt': 1}
        self.target = {'revision': 'b' * 40, 'imageId': 'sha256:' + 'b' * 64, 'runId': 11,
                       'attempt': 1, 'mode': 'auto', 'bytes': 7, 'sha256': hashlib.sha256(b'archive').hexdigest()}
        self.write('state/current.json', self.old)
        for name in ops.HANDOFF_CONFIGURATION:
            path = self.base / 'private' / name
            path.write_text('fictional-private-value\n')
            path.chmod(0o600)
        (self.base / 'private/migrator.env').write_text('MYSQL_HOST=db\nMYSQL_PORT=3306\nMYSQL_DATABASE=vtc\nMYSQL_USER=vtc_migrator\nMYSQL_PASSWORD=fictional\n')
        hashes = {}
        for name in ops.activation.CONTROL_FILES:
            for prefix in ['', 'state/controls-candidate/', 'state/controls-previous/']:
                path = self.base / (prefix + name)
                path.write_text('fictional-control\n')
                path.chmod(0o600)
            hashes[name] = ops.digest(self.base / name)
        self.controls = dict(pending=True, complete=True, prepared=True, revision=self.old['revision'],
                             imageId=self.old['imageId'], hashes=hashes, previous=hashes)
        self.write('state/controls-update.json', self.controls)
        self.write('state/recovery-required', {'owner': 'controls-update', 'state': self.controls})
        self.binding = dict(version=1, previous=self.old, target=self.target,
                            controlsHash=ops.digest(self.base / 'state/controls-update.json'),
                            configuration=ops.handoff_configuration())
        self.write('private/controls-release.json', self.binding)
        path = self.base / 'state/incoming/controls-release.tar'
        path.write_bytes(b'archive')
        path.chmod(0o600)
        self.original = [['1', 'c' * 64, 'applied']]
        self.expected = self.original + [['2', 'd' * 64, 'applied']]
        self.history = self.original
        self.order = []
        self.patch(ops, 'validate_image')
        self.patch(ops, 'archive_safe')
        self.patch(ops, 'run', side_effect=lambda *a, **k: json.dumps([{'Id': self.target['imageId']}]).encode())
        self.patch(ops.activation, 'packaged_history', side_effect=lambda _o, image: self.original if image == self.old['imageId'] else self.expected)
        self.patch(ops, 'handoff_history', side_effect=lambda *a: self.history)
        self.patch(ops, 'handoff_migrator_absent', side_effect=lambda *a: self.order.append('migrator-absent'))
        self.patch(ops, 'fenced', side_effect=lambda *a: (ops.maintenance(True), self.order.append('fenced')))
        backup = self.base / 'state/exports' / ('e' * 32)
        backup.mkdir(parents=True)
        self.write(str(backup.relative_to(self.base) / 'manifest.json'),
                   dict(revision=self.old['revision'], imageId=self.old['imageId']))
        self.patch(ops, 'export_locked', side_effect=lambda *a: (self.order.append('export') or 'e' * 32))
        self.patch(ops, 'validate_export', return_value=(backup, json.loads((backup / 'manifest.json').read_text())))
        self.patch(ops, 'handoff_migrate', side_effect=self.migrate)
        self.patch(ops.activation, 'validate', side_effect=lambda _o, rev, image, _p: self.order.append(('validate', rev, image)))
        self.patch(ops.activation, 'module_flags', return_value={'TRIPS_ENABLED': 'true'})
        self.patch(ops.activation, 'grants', side_effect=lambda *a: self.order.append('grants'))
        self.patch(ops.activation, 'privileges', return_value=[])
        self.patch(ops.activation, 'check_privileges', side_effect=lambda *a, **k: self.order.append('readback'))
        self.patch(ops, 'compose', side_effect=lambda *a, **k: self.order.append(('start', a[0])))
        self.patch(ops, 'ready', side_effect=lambda *a: self.order.append('ready'))
        self.patch(ops, 'public_ready', side_effect=lambda *a: self.order.append('public-ready'))

    def patch(self, target, name, *args, **kwargs):
        replacement = patch.object(target, name, *args, **kwargs)
        result = replacement.start()
        self.addCleanup(replacement.stop)
        return result

    def write(self, name, value):
        ops.atomic_json(self.base / name, value)

    def intent(self):
        return json.loads((self.base / 'state/release-handoff.json').read_text())

    def migrate(self, intent, count):
        self.assertEqual(self.history in [self.original, self.expected], True)
        self.assertEqual(count, 1 if self.history == self.original else 0)
        self.assertIn('export', self.order)
        self.order.append(('migrate', count))
        self.history = self.expected

    def assert_fenced(self):
        self.assertTrue((self.base / 'state/recovery-required').exists())
        self.assertTrue((self.base / 'private/maintenance/enabled').exists())

    def test_candidate_validation_and_complete_grants_precede_every_producer(self):
        ops.controls_release_locked('start')
        self.assertLess(self.order.index('export'), self.order.index(('migrate', 1)))
        candidate = ('validate', self.target['revision'], self.target['imageId'])
        self.assertLess(self.order.index(candidate), self.order.index('grants'))
        first_start = next(i for i, value in enumerate(self.order) if isinstance(value, tuple) and value[0] == 'start')
        self.assertLess(self.order.index('readback'), first_start)
        self.assertEqual(ops.current()['imageId'], self.target['imageId'])
        self.assertEqual(json.loads((self.base / 'state/previous.json').read_text()), self.old)
        self.assertEqual(self.intent()['phase'], 'complete')
        self.assertTrue(self.intent()['schemaAdvanced'])
        self.assertEqual(ops.handoff_configuration(), self.binding['configuration'])
        self.assertFalse((self.base / 'state/recovery-required').exists())
        self.assertFalse(json.loads((self.base / 'state/controls-update.json').read_text())['pending'])

    def test_unowned_or_incomplete_controls_and_foreign_fence_reject_before_mutation(self):
        for field, value in [('pending', False), ('complete', False), ('prepared', False)]:
            with self.subTest(field=field):
                altered = dict(self.controls, **{field: value})
                self.write('state/controls-update.json', altered)
                with self.assertRaises(RuntimeError):
                    ops.controls_release_locked('start')
                self.assertEqual(self.order, [])
        self.write('state/controls-update.json', self.controls)
        self.write('state/recovery-required', {'owner': 'foreign'})
        with self.assertRaisesRegex(RuntimeError, 'HANDOFF_RECOVERY_UNOWNED'):
            ops.controls_release_locked('start')
        self.assertEqual(self.order, [])

    def test_dirty_extra_and_checksum_drift_reject_before_export(self):
        for history in [[['1', 'c' * 64, 'applying']], self.expected,
                        [['1', 'f' * 64, 'applied']]]:
            with self.subTest(history=history):
                self.history = history
                with self.assertRaisesRegex(RuntimeError, 'HANDOFF_PREVIOUS_HISTORY_INVALID'):
                    ops.controls_release_locked('start')
                self.assertNotIn('export', self.order)

    def test_stale_automatic_target_and_altered_archive_are_rejected(self):
        self.write('state/high-water.json', {'runId': 12, 'attempt': 1})
        with self.assertRaisesRegex(RuntimeError, 'STALE_AUTOMATIC_RELEASE'):
            ops.controls_release_locked('start')
        self.assertEqual(self.order, [])
        (self.base / 'state/incoming/controls-release.tar').write_bytes(b'changed')
        with self.assertRaisesRegex(RuntimeError, 'HANDOFF_ARTIFACT_CHANGED'):
            ops.controls_release_locked('start')

    def test_migration_lock_database_cannot_differ_from_bound_migrator(self):
        path = self.base / 'private/migrator.env'
        path.write_text(path.read_text().replace('MYSQL_DATABASE=vtc', 'MYSQL_DATABASE=foreign'))
        self.binding['configuration']['migrator.env'] = ops.digest(path)
        self.write('private/controls-release.json', self.binding)
        with self.assertRaisesRegex(RuntimeError, 'HANDOFF_MIGRATOR_CONFIGURATION_INVALID'):
            ops.controls_release_locked('start')
        self.assertEqual(self.order, [])

    def test_backup_failure_leaves_old_metadata_and_owned_fence(self):
        with patch.object(ops, 'export_locked', side_effect=RuntimeError('EXPORT_FAILED')):
            with self.assertRaisesRegex(RuntimeError, 'EXPORT_FAILED'):
                ops.controls_release_locked('start')
        self.assert_fenced()
        self.assertEqual(ops.current(), self.old)
        self.assertEqual(self.intent()['phase'], 'prepared')
        ops.controls_release_locked('resume')
        self.assertEqual(self.intent()['phase'], 'complete')

    def test_manual_older_target_preserves_previous_high_water_without_a_file(self):
        self.binding['target'].update(mode='manual', runId=9)
        self.write('private/controls-release.json', self.binding)
        ops.controls_release_locked('start')
        self.assertEqual(json.loads((self.base / 'state/high-water.json').read_text()), {'runId': 10, 'attempt': 1})

    def test_maximum_bound_histories_resume_and_completed_metadata_cannot_regress(self):
        self.original = [[str(9007199254739968 + i), 'c' * 64, 'applied'] for i in range(1023)]
        self.expected = self.original + [['9007199254740991', 'd' * 64, 'applied']]
        self.history = self.original
        ops.controls_release_locked('start')
        path = self.base / 'state/release-handoff.json'
        self.assertGreater(path.stat().st_size, 65536)
        self.assertLess(path.stat().st_size, ops.HANDOFF_MAX_RECORD)
        ops.controls_release_locked('resume')
        self.write('state/current.json', self.old)
        with self.assertRaisesRegex(RuntimeError, 'HANDOFF_METADATA_CHANGED'):
            ops.controls_release_locked('resume')

    def test_configuration_change_during_grants_never_starts_candidate(self):
        def changed(*args):
            (self.base / 'private/identity-mail.env').write_text('changed')
        with patch.object(ops.activation, 'grants', side_effect=changed):
            with self.assertRaisesRegex(RuntimeError, 'HANDOFF_CONFIGURATION_CHANGED'):
                ops.controls_release_locked('start')
        self.assert_fenced()
        self.assertFalse(any(isinstance(x, tuple) and x[0] == 'start' for x in self.order))

    def test_migration_lost_ack_replays_only_exact_candidate_with_zero_and_no_old_start(self):
        def lost(intent, count):
            self.migrate(intent, count)
            raise RuntimeError('LOST_ACK')
        with patch.object(ops, 'handoff_migrate', side_effect=lost):
            with self.assertRaisesRegex(RuntimeError, 'LOST_ACK'):
                ops.controls_release_locked('start')
        self.assert_fenced()
        ops.controls_release_locked('resume')
        self.assertIn(('migrate', 0), self.order)
        self.assertTrue(self.intent()['schemaAdvanced'])
        self.assertEqual(self.intent()['phase'], 'complete')

    def test_original_prefix_can_resume_before_advancement_but_not_after(self):
        with patch.object(ops, 'handoff_migrate', side_effect=RuntimeError('BEFORE_DDL')):
            with self.assertRaisesRegex(RuntimeError, 'BEFORE_DDL'):
                ops.controls_release_locked('start')
        ops.controls_release_locked('resume')
        self.history = self.original
        with self.assertRaisesRegex(RuntimeError, 'HANDOFF_MIGRATION_RECOVERY_REQUIRED'):
            ops.controls_release_locked('resume')
        self.assert_fenced()

    def test_candidate_history_before_migration_intent_is_unexplained(self):
        with patch.object(ops, 'export_locked', side_effect=RuntimeError('EXPORT_FAILED')):
            with self.assertRaises(RuntimeError):
                ops.controls_release_locked('start')
        self.history = self.expected
        with self.assertRaisesRegex(RuntimeError, 'HANDOFF_MIGRATION_RECOVERY_REQUIRED'):
            ops.controls_release_locked('resume')
        self.assert_fenced()

    def test_grant_failure_or_missing_readback_never_starts_candidate(self):
        with patch.object(ops.activation, 'grants', side_effect=RuntimeError('GRANT_FAILED')):
            with self.assertRaisesRegex(RuntimeError, 'GRANT_FAILED'):
                ops.controls_release_locked('start')
        self.assert_fenced()
        self.assertFalse(any(isinstance(x, tuple) and x[0] == 'start' for x in self.order))
        with patch.object(ops.activation, 'check_privileges', side_effect=RuntimeError('INCOMPLETE_GRANTS')):
            with self.assertRaisesRegex(RuntimeError, 'INCOMPLETE_GRANTS'):
                ops.controls_release_locked('resume')
        self.assertFalse(any(isinstance(x, tuple) and x[0] == 'start' for x in self.order))
        ops.controls_release_locked('resume')

    def test_readiness_failure_never_restores_old_image(self):
        with patch.object(ops, 'ready', side_effect=RuntimeError('NOT_READY')):
            with self.assertRaisesRegex(RuntimeError, 'NOT_READY'):
                ops.controls_release_locked('start')
        self.assert_fenced()
        self.assertTrue(self.intent()['schemaAdvanced'])
        self.assertEqual(ops.current(), self.old)
        ops.controls_release_locked('resume')

    def test_old_history_after_recorded_advancement_or_intermediate_history_is_blocked(self):
        with patch.object(ops, 'ready', side_effect=RuntimeError('NOT_READY')):
            with self.assertRaises(RuntimeError):
                ops.controls_release_locked('start')
        for history in [self.original, self.expected + [['3', 'e' * 64, 'applied']],
                        self.original + [['2', 'd' * 64, 'applying']]]:
            self.history = history
            with self.assertRaisesRegex(RuntimeError, 'HANDOFF_MIGRATION_RECOVERY_REQUIRED'):
                ops.controls_release_locked('resume')
            self.assert_fenced()

    def test_lost_ack_replays_only_exact_candidate_with_zero_and_latches_advancement(self):
        def lost_ack(intent, count):
            self.history = self.expected
            raise RuntimeError('LOST_ACK')
        with patch.object(ops, 'handoff_migrate', side_effect=lost_ack):
            with self.assertRaisesRegex(RuntimeError, 'LOST_ACK'):
                ops.controls_release_locked('start')
        self.assertEqual(self.intent()['phase'], 'migrating')
        with patch.object(ops, 'handoff_migrate', side_effect=RuntimeError('SECOND_LOST_ACK')):
            with self.assertRaises(RuntimeError):
                ops.controls_release_locked('resume')
        self.assertTrue(self.intent()['schemaAdvanced'])
        self.history = self.original
        with self.assertRaisesRegex(RuntimeError, 'HANDOFF_MIGRATION_RECOVERY_REQUIRED'):
            ops.controls_release_locked('resume')
        self.history = self.expected
        ops.controls_release_locked('resume')
        self.assertIn(('migrate', 0), self.order)

    def test_resume_rejects_changed_binding_configuration_controls_backup_and_metadata(self):
        with patch.object(ops, 'ready', side_effect=RuntimeError('NOT_READY')):
            with self.assertRaises(RuntimeError):
                ops.controls_release_locked('start')
        for name in ['private/controls-release.json', 'private/identity-mail.env', 'operations.py',
                     'state/exports/' + 'e' * 32 + '/manifest.json', 'state/current.json']:
            path = self.base / name
            original = path.read_bytes()
            try:
                path.write_text('{}' if path.suffix == '.json' else 'changed')
                with self.assertRaises((RuntimeError, KeyError)):
                    ops.controls_release_locked('resume')
            finally:
                path.write_bytes(original)
        ops.controls_release_locked('resume')

    def test_crashes_at_every_metadata_and_controls_write_resume_exactly(self):
        actual_write = ops.atomic_json
        for suffix in ['previous.json', 'current.json', 'high-water.json', 'controls-update.json']:
            with self.subTest(suffix=suffix):
                if self.intent_exists():
                    # Independently model the original verified pre-publication state
                    # for every boundary, rather than replaying already-published values.
                    intent = self.intent()
                    intent.update(phase='verified', pending=True)
                    for name, value in intent['metadata'].items():
                        if value is None:
                            (self.base / 'state' / name).unlink(missing_ok=True)
                        else:
                            self.write('state/' + name, value)
                    self.write('state/controls-update.json', intent['controls'])
                    self.write('state/release-handoff.json', intent)
                    self.write('state/recovery-required', dict(owner='controls-release', id=intent['id'], bindingHash=intent['bindingHash']))
                def crash(path, value):
                    actual_write(path, value)
                    if path.name == suffix:
                        raise RuntimeError('CRASH_AFTER_WRITE')
                with patch.object(ops, 'atomic_json', side_effect=crash):
                    with self.assertRaisesRegex(RuntimeError, 'CRASH_AFTER_WRITE'):
                        ops.controls_release_locked('resume' if self.intent_exists() else 'start')
                self.assert_fenced()
                self.assertEqual(ops.current()['imageId'], self.old['imageId'] if suffix == 'previous.json' else self.target['imageId'])
                ops.controls_release_locked('resume')
                self.assertEqual(self.intent()['phase'], 'complete')

    def test_settled_controls_and_lost_unfence_acknowledgment_resume(self):
        actual_write = ops.atomic_json
        def interrupted(path, value):
            if path.name == 'release-handoff.json' and value.get('phase') == 'complete':
                raise RuntimeError('SETTLEMENT_INTERRUPTED')
            actual_write(path, value)
        with patch.object(ops, 'atomic_json', side_effect=interrupted):
            with self.assertRaisesRegex(RuntimeError, 'SETTLEMENT_INTERRUPTED'):
                ops.controls_release_locked('start')
        self.assertEqual(self.intent()['phase'], 'verified')
        self.assertFalse(json.loads((self.base / 'state/controls-update.json').read_text())['pending'])
        self.assert_fenced()
        maintenance = ops.maintenance
        def interrupted_unfence(enabled):
            if not enabled:
                raise RuntimeError('UNFENCE_INTERRUPTED')
            maintenance(enabled)
        with patch.object(ops, 'maintenance', side_effect=interrupted_unfence):
            with self.assertRaisesRegex(RuntimeError, 'UNFENCE_INTERRUPTED'):
                ops.controls_release_locked('resume')
        self.assertEqual(self.intent()['phase'], 'complete')
        ops.controls_release_locked('resume')
        self.assertFalse((self.base / 'state/recovery-required').exists())

    def intent_exists(self):
        return (self.base / 'state/release-handoff.json').exists()

    def test_changed_configuration_target_or_metadata_cannot_resume(self):
        with patch.object(ops, 'ready', side_effect=RuntimeError('NOT_READY')):
            with self.assertRaises(RuntimeError):
                ops.controls_release_locked('start')
        self.write('state/current.json', dict(self.old, runId=9))
        with self.assertRaisesRegex(RuntimeError, 'HANDOFF_METADATA_CHANGED'):
            ops.controls_release_locked('resume')
        self.write('state/current.json', self.old)
        self.write('private/controls-release.json', dict(self.binding, target=dict(self.target, attempt=2)))
        with self.assertRaisesRegex(RuntimeError, 'HANDOFF_TARGET_CHANGED'):
            ops.controls_release_locked('resume')
        self.write('private/controls-release.json', self.binding)
        (self.base / 'private/identity-mail.env').write_text('changed\n')
        with self.assertRaisesRegex(RuntimeError, 'HANDOFF_CONFIGURATION_CHANGED'):
            ops.controls_release_locked('resume')

    def test_activation_and_ordinary_release_cannot_steal_handoff(self):
        self.write('state/release-handoff.json', {'pending': True})
        with self.assertRaisesRegex(RuntimeError, 'CONTROLS_RELEASE_PENDING'):
            ops.activation.config_operation(ops, self.old['revision'], self.old['imageId'], 'recover')
        with self.assertRaisesRegex(RuntimeError, 'ACTIVATION_PENDING'):
            ops.release_locked(self.base / 'state/incoming/controls-release.tar', self.target['revision'], 11, 1, 'auto', self.target['imageId'])


class HandoffLockTests(unittest.TestCase):
    def test_ledger_read_holds_same_named_lock_and_rejects_failed_acquisition(self):
        with patch.object(ops, 'compose', return_value=b'1\n1\t' + b'a' * 64 + b'\tapplied\n1\n') as child:
            self.assertEqual(len(ops.handoff_history('a' * 40, 'sha256:' + 'b' * 64)), 1)
        sql = child.call_args.kwargs['data'].decode()
        name = 'vtc:migrate:' + hashlib.sha256(b'vtc').hexdigest()[:48]
        self.assertIn(f"GET_LOCK('{name}',5)", sql)
        self.assertLess(sql.index('GET_LOCK'), sql.index('FROM vtc._vtc_migrations'))
        self.assertLess(sql.index('FROM vtc._vtc_migrations'), sql.index('RELEASE_LOCK'))
        self.assertIn('CONNECTION_ID()', sql)
        with patch.object(ops, 'compose', return_value=b'0\nNULL\n'):
            with self.assertRaisesRegex(RuntimeError, 'HANDOFF_MIGRATION_LOCK_REQUIRED'):
                ops.handoff_history('a' * 40, 'sha256:' + 'b' * 64)

    def test_owned_cid_image_project_service_and_uuid_required_before_cleanup(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(ops, 'BASE', pathlib.Path(temporary)):
            (ops.BASE / 'state').mkdir()
            identity, attempt, owner = 'c' * 64, 'd' * 32, 'e' * 32
            name = f'{ops.PROJECT}-handoff-{owner}'
            image = 'sha256:' + 'a' * 64
            intent = dict(id=owner, binding={'target': {'imageId': image}},
                          migrator=dict(id=identity, attempt=attempt, phase='created'))
            receipt = ops.BASE / f'state/handoff-{owner}-{attempt}.cid'
            receipt.write_text(identity)
            receipt.chmod(0o600)
            info = dict(Id=identity, Name='/' + name, Image=image, State={'Running': True},
                        Config={'Labels': {'vtc.release-handoff': owner,
                                'com.docker.compose.project': ops.PROJECT, 'com.docker.compose.service': 'migrate'}})
            present = True
            calls = []
            def child(args, **kwargs):
                nonlocal present
                calls.append(args)
                if args[1] == 'ps':
                    return identity.encode() if present else b''
                if args[1] == 'inspect':
                    return json.dumps([info]).encode()
                if args[1] == 'rm':
                    present = False
                return b''
            for field, value in [('Image', 'sha256:' + 'f' * 64), ('Name', '/foreign')]:
                previous = info[field]
                info[field] = value
                with patch.object(ops, 'run', side_effect=child):
                    with self.assertRaisesRegex(RuntimeError, 'HANDOFF_MIGRATOR_UNOWNED'):
                        ops.handoff_migrator_absent(intent)
                self.assertFalse(any(call[1] in ['stop', 'rm'] for call in calls))
                info[field] = previous
            for field in ['vtc.release-handoff', 'com.docker.compose.project', 'com.docker.compose.service']:
                previous = info['Config']['Labels'][field]
                info['Config']['Labels'][field] = 'foreign'
                with patch.object(ops, 'run', side_effect=child):
                    with self.assertRaisesRegex(RuntimeError, 'HANDOFF_MIGRATOR_UNOWNED'):
                        ops.handoff_migrator_absent(intent)
                self.assertFalse(any(call[1] in ['stop', 'rm'] for call in calls))
                info['Config']['Labels'][field] = previous
            with patch.object(ops, 'run', side_effect=child):
                ops.handoff_migrator_absent(intent)
            self.assertLess(next(i for i, call in enumerate(calls) if call[1] == 'stop'),
                            next(i for i, call in enumerate(calls) if call[1] == 'rm'))
            self.assertEqual(intent['migrator']['phase'], 'removed')
            intent['migrator']['phase'] = 'creating'
            with patch.object(ops, 'run', return_value=b'') as run:
                with self.assertRaisesRegex(RuntimeError, 'HANDOFF_MIGRATOR_UNCERTAIN'):
                    ops.handoff_migrator_absent(intent)
            self.assertFalse(any(call.args[0][1] == 'rm' for call in run.call_args_list))

    def test_cli_ack_requires_exit_zero_exact_integer_suffix_and_single_receipt(self):
        for status, output, accepted in [('0', b'{"event":"database.migrated","applied":1}', True),
                ('1', b'{"event":"database.migrated","applied":1}', False),
                ('0', b'{"event":"database.migrated","applied":0}', False),
                ('0', b'{"event":"database.migrated","applied":true}', False),
                ('0', b'{}', False)]:
            with self.subTest(status=status, output=output), tempfile.TemporaryDirectory() as temporary, \
                    patch.object(ops, 'BASE', pathlib.Path(temporary)):
                (ops.BASE / 'state').mkdir()
                intent = dict(id='e' * 32, binding={'target': {'imageId': 'sha256:' + 'a' * 64}})
                def child(args, **kwargs):
                    if args[1] == 'create':
                        path = pathlib.Path(args[args.index('--cidfile') + 1])
                        path.write_text('c' * 64)
                        path.chmod(0o600)
                        return ('c' * 64).encode()
                    if args[1] == 'wait':
                        return status.encode()
                    if args[1] == 'logs':
                        return output
                    return b''
                with patch.object(ops, 'run', side_effect=child), patch.object(ops, 'handoff_migrator_absent'):
                    if accepted:
                        ops.handoff_migrate(intent, 1)
                    else:
                        with self.assertRaisesRegex(RuntimeError, 'HANDOFF_MIGRATION_(?:FAILED|ACK_INVALID)'):
                            ops.handoff_migrate(intent, 1)


if __name__ == '__main__':
    unittest.main()
