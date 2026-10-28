"""Fixed-operation failure paths; real MySQL/HTTPS/minute work belongs to the window rehearsal."""
import json
import contextlib
import http.server
import io
import os
import pathlib
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch

import notifications_acceptance as n
import operations as o
import update_controls

RUN = '12345678-1234-4123-8123-123456789abc'
SHA = 'a' * 40
IMAGE = 'sha256:' + 'b' * 64


def completed_controls_receipt():
    # Historical full-controls release, deliberately different from current notification inputs.
    return dict(pending=False, complete=True, prepared=True, revision='c' * 40,
                imageId='sha256:' + 'd' * 64,
                hashes={'operations.py': 'e' * 64, 'activation.py': 'f' * 64},
                previous={'operations.py': 'a' * 64})


class WindowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = pathlib.Path(self.temp.name)
        (self.base / 'state').mkdir(mode=0o700)
        (self.base / 'private/maintenance').mkdir(parents=True)
        self.patch = patch.object(o, 'BASE', self.base)
        self.patch.start(); self.addCleanup(self.patch.stop)
        for name in n.FILES:
            (self.base / name).write_text('{}' if name.endswith(('.json', '.yaml')) else '# synthetic controls\n')
        self.window = n.Window(o, SHA, IMAGE, RUN)

    def state(self, **values):
        value = dict(runId=RUN, schema=self.window.schema, accounts=self.window.accounts,
                     revision=SHA, imageId=IMAGE, directory=str(self.window.directory),
                     controls=n.hashes(o, n.FILES), protected=n.hashes(o, n.PROTECTED),
                     containers={}, ticks=[], phase='running', schedule=True, expiresUtc=500, allocations={})
        value.update(values)
        self.window.save(value)
        return value

    def test_closed_modes_and_uuid_reject_before_allocating(self):
        for mode, run in [('shell', RUN), ('prepare', '../escape'), ('prepare', RUN.upper())]:
            with self.assertRaisesRegex(RuntimeError, 'NOTIFICATIONS_ARGUMENT_INVALID'):
                n.operation(o, SHA, IMAGE, mode, run)
        self.assertFalse(self.window.marker.exists())

    def test_owned_worker_logs_capture_initial_empty_stderr_phase_and_final_stdout(self):
        self.interrupt_fixture()
        phase = b'{"event":"jobs_acceptance_phase","phase":"jobs_trip_catchup"}\n'
        failure = json.dumps({'event': 'jobs_failed', 'category': 'operation_failed', 'diagnostic': {
            'category': 'database', 'step': 'jobs_pass', 'nativeErrno': 1142, 'message': 'fictional private body'}}).encode()
        replies = iter([(b'', b''), (b'', phase), (b'{"event":"jobs_result","status":"completed"}\n', failure)])
        def reply(args, **_options):
            self.assertEqual(args, ['docker', 'logs', 'c' * 64])
            output, errors = next(replies)
            path = self.base / 'state/last-child.stderr'; path.write_bytes(errors); path.chmod(0o600)
            now = n.time.time_ns(); os.utime(path, ns=(now, now))
            return output
        with patch.object(o, 'run', side_effect=reply):
            self.assertIsNone(n.worker_phase(self.window.worker_logs('c' * 64)))
            self.assertEqual(n.worker_phase(self.window.worker_logs('c' * 64)), 'jobs_trip_catchup')
            final = self.window.worker_logs('c' * 64)
        self.assertIn(b'jobs_result', final)
        projection = n.worker_failure(final, [])
        self.assertEqual(projection['nativeErrno'], 1142)
        self.assertNotIn('fictional private', json.dumps(projection))
        self.window.containers.validate.assert_called_with('synthetic-interrupted', 'c' * 64)
        with patch.object(o, 'run') as command:
            with self.assertRaisesRegex(RuntimeError, '^NOTIFICATIONS_LOG_RECEIPT_REQUIRED$'):
                self.window.worker_logs('d' * 64)
            command.assert_not_called()

    def test_log_tails_are_bounded_and_new_file_does_not_depend_on_clock_precision(self):
        path = self.base / 'state/last-child.stderr'
        def reply(_args, **_options):
            path.write_bytes(b'e' * 70000); path.chmod(0o600)
            os.utime(path, ns=(0, 0))
            return b'o' * 70000
        with patch.object(o, 'run', side_effect=reply), patch.object(n.time, 'time_ns', side_effect=AssertionError('clock comparison')):
            value = n.worker_log_output(o, 'c' * 64)
        self.assertEqual(value, b'o' * 65536 + b'\n' + b'e' * 65536)
        # A preceding private tail is retired before the command; it cannot be adopted if no new file is created.
        with patch.object(o, 'run', return_value=b''):
            with self.assertRaises(FileNotFoundError): n.worker_log_output(o, 'c' * 64)
        self.assertFalse(path.exists())
        with patch.object(o, 'run') as command:
            with self.assertRaisesRegex(RuntimeError, '^NOTIFICATIONS_LOG_IDENTITY_INVALID$'):
                n.worker_log_output(o, '../foreign')
            command.assert_not_called()

    def test_log_reader_preserves_unrelated_public_linked_or_foreign_input(self):
        path = self.base / 'state/last-child.stderr'
        target = self.base / 'private/unrelated'; target.write_bytes(b'fictional unrelated'); target.chmod(0o600)
        for kind in ['public', 'hardlink', 'symlink', 'foreign']:
            if kind == 'hardlink': os.link(target, path)
            elif kind == 'symlink': path.symlink_to(target)
            else:
                path.write_bytes(b'fictional prior'); path.chmod(0o644 if kind == 'public' else 0o600)
                if kind == 'foreign': os.chown(path, 1000, 1000)
            with patch.object(o, 'run') as command:
                with self.assertRaises((RuntimeError, OSError)): n.worker_log_output(o, 'c' * 64)
                command.assert_not_called()
            self.assertTrue(path.exists()); self.assertEqual(target.read_bytes(), b'fictional unrelated')
            path.unlink()
        path.parent.chmod(0o755)
        with patch.object(o, 'run') as command:
            with self.assertRaisesRegex(RuntimeError, '^NOTIFICATIONS_LOG_DIRECTORY_INVALID$'):
                n.worker_log_output(o, 'c' * 64)
            command.assert_not_called()

    def test_log_reader_requires_new_private_file_and_preserves_command_primary(self):
        path = self.base / 'state/last-child.stderr'
        def reply(_args, **_options):
            self.assertFalse(path.exists())
            path.write_bytes(b'fictional public tail'); path.chmod(0o644)
            return b''
        with patch.object(o, 'run', side_effect=reply):
            with self.assertRaisesRegex(RuntimeError, '^NOTIFICATIONS_LOG_STDERR_INVALID$'):
                n.worker_log_output(o, 'c' * 64)
        path.chmod(0o600)
        primary = RuntimeError('fictional command failure')
        with patch.object(o, 'run', side_effect=primary):
            with self.assertRaises(RuntimeError) as caught: n.worker_log_output(o, 'c' * 64)
        self.assertIs(caught.exception, primary)
        self.assertFalse(path.exists())

    def test_log_reader_rejects_replacement_after_retiring_prior_tail(self):
        path = self.base / 'state/last-child.stderr'; path.write_bytes(b'previous'); path.chmod(0o600)
        original = pathlib.Path.unlink
        def replaced(value, *args, **options):
            original(value, *args, **options)
            if value == path:
                path.write_bytes(b'fictional collision'); path.chmod(0o600)
        with patch.object(pathlib.Path, 'unlink', new=replaced), patch.object(o, 'run') as command:
            with self.assertRaisesRegex(RuntimeError, '^NOTIFICATIONS_LOG_STDERR_INVALID$'):
                n.worker_log_output(o, 'c' * 64)
            command.assert_not_called()
        self.assertEqual(path.read_bytes(), b'fictional collision')

    def test_fixture_signal_has_final_mode_before_rename_under_private_umask(self):
        path = self.base / 'state/tick.json'; path.write_text('{"old":true}'); path.chmod(0o644)
        parent_mode = (path.parent.stat().st_mode & 0o777)
        original = os.replace
        def replace(source, target):
            self.assertEqual(source.stat().st_mode & 0o777, 0o644)
            self.assertEqual(json.loads(source.read_text()), {'count': 1})
            self.assertEqual(json.loads(target.read_text()), {'old': True})
            original(source, target)
            self.assertEqual(target.stat().st_mode & 0o777, 0o644)
        old = os.umask(0o077)
        try:
            with patch.object(n.os, 'replace', side_effect=replace): n.fixture_json(path, {'count': 1})
        finally: os.umask(old)
        self.assertEqual(json.loads(path.read_text()), {'count': 1})
        self.assertEqual(path.parent.stat().st_mode & 0o777, parent_mode)
        self.assertFalse(any(p.name.endswith('.tmp') for p in path.parent.iterdir()))

    def test_fixture_signal_collision_and_cleanup_failure_preserve_unrelated_data_and_primary(self):
        path = self.base / 'state/tick.json'; path.write_text('{"old":true}')
        collision = path.with_name('.tick.json-' + 'a' * 32 + '.tmp')
        collision.write_text('fictional unrelated collision')
        with patch.object(n.secrets, 'token_hex', return_value='a' * 32):
            with self.assertRaises(FileExistsError): n.fixture_json(path, {'count': 1})
        self.assertEqual(collision.read_text(), 'fictional unrelated collision')
        self.assertEqual(json.loads(path.read_text()), {'old': True})
        primary = OSError('fictional rename failure')
        with patch.object(n.os, 'replace', side_effect=primary), \
                patch.object(pathlib.Path, 'unlink', side_effect=OSError('fictional cleanup failure')):
            with self.assertRaises(OSError) as caught: n.fixture_json(path, {'count': 1})
        self.assertIs(caught.exception, primary)
        self.assertEqual(collision.read_text(), 'fictional unrelated collision')
        self.assertEqual(json.loads(path.read_text()), {'old': True})

    def parent_tick(self):
        return dict(revision=SHA, imageId=IMAGE, attemptedUtc=100, finishedUtc=130, status='failed',
                    steps={'validation': {'status': 'completed', 'attemptedUtc': 100, 'durationMs': 2},
                           'heartbeat': {'status': 'failed', 'category': 'client_failed', 'durationMs': 4},
                           'jobs': {'status': 'completed', 'durationMs': 15000}})

    def test_parent_tick_retains_only_closed_current_step_outcomes(self):
        value = self.parent_tick()
        value.update(account='fictional private account', body='fictional private body')
        value['steps']['heartbeat']['message'] = 'fictional raw command and credential'
        result = n.parent_tick_result(value, dict(revision=SHA, imageId=IMAGE, startedUtc=90), 140)
        self.assertEqual(result['availability'], 'available')
        self.assertEqual(result['steps']['heartbeat'], dict(status='failed', category='client_failed', durationMs=4))
        self.assertEqual(result['steps']['jobs'], dict(status='completed', durationMs=15000))
        for private in [SHA, IMAGE, 'account', 'body', 'credential', 'message']:
            self.assertNotIn(private, json.dumps(result))

    def test_parent_tick_rejects_stale_binding_and_malformed_categories(self):
        state = dict(revision=SHA, imageId=IMAGE, startedUtc=90)
        for change, reason in [({'attemptedUtc': 89}, 'stale'), ({'imageId': 'other'}, 'binding_mismatch'),
                               ({'status': []}, 'malformed'), ({'finishedUtc': 141}, 'malformed'),
                               ({'attemptedUtc': True}, 'malformed'), ({'steps': {}}, 'malformed')]:
            self.assertEqual(n.parent_tick_result(self.parent_tick() | change, state, 140),
                             dict(availability='unavailable', reason=reason))
        value = self.parent_tick(); value['steps']['heartbeat']['category'] = ['private']
        self.assertEqual(n.parent_tick_result(value, state, 140)['reason'], 'malformed')
        self.assertEqual(n.parent_tick_result(None, state, 140)['reason'], 'malformed')

    def test_parent_tick_file_requires_own_run_private_receipt_and_reports_missing(self):
        state = self.state(startedUtc=90)
        self.assertEqual(n.parent_tick_receipt(self.window, state)['reason'], 'missing')
        o.atomic_json(self.base / 'state/tick-last.json', self.parent_tick())
        with patch.object(n.time, 'time', return_value=140):
            self.assertEqual(n.parent_tick_receipt(self.window, state)['availability'], 'available')
            self.assertEqual(n.parent_tick_receipt(self.window, state | {'runId': 'other'})['reason'], 'binding_mismatch')
        (self.base / 'state/tick-last.json').chmod(0o644)
        self.assertEqual(n.parent_tick_receipt(self.window, state)['reason'], 'read_failed')

    def test_scheduler_failure_diagnostics_are_closed(self):
        self.assertEqual(n.scheduler_failure('tick', RuntimeError('TICK_FAILED')), dict(stage='tick', code='TICK_FAILED'))
        self.assertEqual(n.scheduler_failure(['private'], RuntimeError({'private': 'body'})), dict(stage='unknown', code='unknown'))

    def test_rehearsal_retention_and_cleanup_failures_preserve_primary_scheduler_error(self):
        primary = RuntimeError('TICK_FAILED')
        window = Mock()
        window.bound.return_value = self.state()
        window.save.side_effect = RuntimeError('fictional private retention failure')
        window.cleanup.side_effect = RuntimeError('fictional private cleanup failure')
        output = io.StringIO()
        with patch.object(n, 'Window', return_value=window), patch.object(n, 'hashes', return_value={}), \
                patch.object(n, 'operation', side_effect=primary), patch.object(o, 'current', return_value={'revision': SHA, 'imageId': IMAGE}), \
                patch.object(o, 'lock', side_effect=contextlib.nullcontext), contextlib.redirect_stdout(output):
            with self.assertRaises(RuntimeError) as caught:
                n.rehearse(o)
        self.assertIs(caught.exception, primary)
        self.assertNotIn('fictional private', output.getvalue())
        self.assertIn('retention', output.getvalue()); self.assertIn('cleanup', output.getvalue())
        window.cleanup.assert_called_once()

    def test_rehearsal_cleanup_only_failure_stays_fatal(self):
        failure = RuntimeError('fictional cleanup failure')
        window = Mock()
        window.bound.return_value = {'phase': 'completed'}
        window.cleanup.side_effect = failure
        with patch.object(n, 'Window', return_value=window), patch.object(n, 'hashes', return_value={}), \
                patch.object(n, 'operation'), patch.object(o, 'current', return_value={'revision': SHA, 'imageId': IMAGE}), \
                patch.object(o, 'lock', side_effect=contextlib.nullcontext), patch.object(n.time, 'time', return_value=100), \
                patch.object(n.time, 'monotonic', return_value=0), contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(RuntimeError) as caught:
                n.rehearse(o)
        self.assertIs(caught.exception, failure)

    def interrupt_request(self):
        return dict(runId=RUN, requestId='11111111-1111-4111-8111-111111111111',
                    tripId='22222222-2222-4222-8222-222222222222',
                    sourceRecordId='33333333-3333-4333-8333-333333333333',
                    eventId='44444444-4444-4444-8444-444444444444', fixtureId='d' * 64)

    def interrupt_fixture(self):
        self.state(containers={'synthetic-interrupted': {'phase': 'created', 'id': 'c' * 64, 'imageId': IMAGE}})
        self.window.directory.mkdir(parents=True)
        (self.window.directory / 'exchange').mkdir()
        containers = Mock()
        containers.names = ['synthetic-interrupted', 'synthetic-fixture']
        containers.create.return_value = 'c' * 64
        self.window.containers = containers
        self.window.observed_containers = Mock(return_value=containers)
        self.window.interruption_fixture = Mock()
        self.window.interruption_armed = Mock(return_value=True)
        return containers

    def interrupt_reply(self, args, **_kwargs):
        if args[:2] == ['docker', 'logs']:
            path = self.base / 'state/last-child.stderr'
            path.write_bytes(b'{"event":"jobs_acceptance_phase","phase":"jobs_trip_catchup"}\n')
            path.chmod(0o600)
            now = n.time.time_ns(); os.utime(path, ns=(now, now))
            return b''
        if args[:2] == ['docker', 'inspect']:
            return json.dumps([{'Id': args[2], 'State': {'Running': True, 'ExitCode': 0, 'OOMKilled': False, 'Dead': False}}]).encode()
        return b''

    def interrupt_lease(self):
        return dict(state='running', attempts=1, leaseUntilUtc='2026-10-28T00:01:00.000000Z',
                    observedUtc='2026-10-28T00:00:00.000000Z', unexpired=1, completedAt=None)

    def test_interrupt_claim_timeout_retains_closed_stage_and_primary_when_stop_fails(self):
        containers = self.interrupt_fixture()
        containers.stop.side_effect = RuntimeError('private cleanup detail')
        counts = iter([b'0', b'1'])
        self.window.sql = Mock(side_effect=lambda _sql, **_options: next(counts, b''))
        now = [100.0]
        with patch.object(o, 'run', side_effect=self.interrupt_reply), \
                patch.object(n.time, 'monotonic', side_effect=lambda: now[0]), \
                patch.object(n.time, 'sleep', side_effect=lambda _delay: now.__setitem__(0, now[0] + 6)):
            with self.assertRaisesRegex(RuntimeError, '^NOTIFICATIONS_LEASE_NOT_OBSERVED$'):
                self.window.interrupt(self.interrupt_request())
        record = self.window.bound()['interruption']
        self.assertEqual((record['stage'], record['reason'], record['claimed'], record['queries']),
                         ('claim_wait', 'claim_not_observed', False, 2))
        self.assertTrue(record['producerUncommittedAtStartup'] and record['targetBound'] and record['stopFailed'])
        self.assertNotIn('private', json.dumps(record))

    def test_interrupt_query_failure_has_closed_reason_without_exception_text(self):
        containers = self.interrupt_fixture()
        self.window.sql = Mock(side_effect=[b'0', b'1', RuntimeError('private query account and body')])
        with patch.object(o, 'run', side_effect=self.interrupt_reply):
            with self.assertRaisesRegex(RuntimeError, '^private query account and body$'):
                self.window.interrupt(self.interrupt_request())
        record = self.window.bound()['interruption']
        self.assertEqual((record['stage'], record['reason'], record['claimed']), ('claim_wait', 'operation_failed', False))
        self.assertNotIn('private', json.dumps(record))
        containers.stop.assert_called_once_with('synthetic-interrupted')

    def test_interrupt_unknown_creation_never_adopts_or_stops_a_name(self):
        containers = self.interrupt_fixture()
        containers.create.side_effect = RuntimeError('uncertain private create detail')
        with self.assertRaisesRegex(RuntimeError, '^uncertain private create detail$'):
            self.window.interrupt(self.interrupt_request())
        self.assertEqual(self.window.bound()['interruption']['stage'], 'create')
        containers.stop.assert_not_called()

    def test_interrupt_success_binds_source_event_ascii_job_and_postkill_unexpired_lease(self):
        containers = self.interrupt_fixture()
        request = self.interrupt_request()
        job = '55555555-5555-4555-8555-555555555555'.encode().hex().upper()
        self.window.sql = Mock(side_effect=[b'0', b'1', job.encode(), json.dumps(self.interrupt_lease()).encode()])
        with patch.object(o, 'run', side_effect=self.interrupt_reply):
            self.window.interrupt(request)
        record = self.window.bound()['interruption']
        self.assertEqual((record['stage'], record['status'], record['claimed'], record['queries']), ('ack', 'pass', True, 1))
        self.assertTrue(record['processAbsent'] and record['producerUncommittedAtStartup'] and record['targetBound'])
        self.assertEqual(containers.stop.call_count, 2)
        ack = json.loads((self.window.directory / 'exchange/interrupted.json').read_text())
        ready = json.loads((self.window.directory / 'exchange/interrupt-ready.json').read_text())
        for key in ['runId', 'requestId', 'tripId', 'sourceRecordId', 'eventId']:
            self.assertEqual(ack[key], request[key]); self.assertEqual(ready[key], request[key])
        self.assertEqual((ack['workerId'], ack['jobIdHex'], ack['phase']), ('c' * 64, job, 'stopped'))
        self.assertEqual(len(job), 72)
        self.assertEqual(ack['lease'], self.interrupt_lease())
        queries = [call.args[0] for call in self.window.sql.call_args_list]
        self.assertIn(request['eventId'].encode().hex(), queries[2])
        self.assertIn(request['tripId'].encode().hex(), queries[2])
        self.assertIn(request['sourceRecordId'], queries[2])
        self.assertIn("j.consumer='notifications.v1'", queries[2])
        self.assertIn('completed_at', queries[3])

    def test_interrupt_worker_exit_and_bypassed_company_barrier_fail_before_claim(self):
        for phase, running, reason in [(None, False, 'worker_exited'), ('jobs_pass', True, 'barrier_bypassed')]:
            self.interrupt_fixture()
            def reply(args, **_kwargs):
                if args[:2] == ['docker', 'logs']:
                    path = self.base / 'state/last-child.stderr'
                    path.write_bytes(json.dumps({'event': 'jobs_acceptance_phase', 'phase': phase}).encode())
                    path.chmod(0o600)
                    now = n.time.time_ns(); os.utime(path, ns=(now, now))
                    return b''
                if args[:2] == ['docker', 'inspect']:
                    return json.dumps([{'Id': args[2], 'State': {'Running': running, 'ExitCode': 1, 'OOMKilled': False, 'Dead': False}}]).encode()
                return b''
            self.window.sql = Mock()
            with patch.object(o, 'run', side_effect=reply):
                with self.assertRaises(RuntimeError):
                    self.window.interrupt(self.interrupt_request())
            self.assertEqual(self.window.bound()['interruption']['reason'], reason)
            self.window.sql.assert_not_called()
            self.assertFalse((self.window.directory / 'exchange/interrupted.json').exists())
            # Reuse only this test's synthetic directory for the next independent fake allocation.
            if phase is None:
                self.window.marker.unlink()
                (self.window.directory / 'exchange').rmdir(); self.window.directory.rmdir()

    def test_observation_budget_shares_absolute_deadline_and_never_extends_child_bounds(self):
        now = [10.0]
        budget = n.ObservationBudget(o, 15.0)
        with patch.object(n.time, 'monotonic', side_effect=lambda: now[0]), patch.object(o, 'run', return_value=b'') as run:
            budget.run(['fixed'], timeout=30)
            self.assertEqual(run.call_args.kwargs['timeout'], 5)
            now[0] = 14.0
            budget.run(['fixed'], timeout=10)
            self.assertEqual(run.call_args.kwargs['timeout'], 1)
            now[0] = 15.0
            with self.assertRaisesRegex(RuntimeError, '^NOTIFICATIONS_INTERRUPT_OBSERVATION_DEADLINE$'):
                budget.run(['fixed'], timeout=10)
            self.assertEqual(run.call_count, 2)

    def test_armed_ack_rejects_stale_worker_request_event_or_unowned_file(self):
        self.interrupt_fixture()
        request = self.interrupt_request()
        binding = n.interruption_target(o, request) | {'workerId': 'c' * 64}
        path = self.window.directory / 'exchange/interrupt-armed.json'
        path.write_text(json.dumps(binding | {'phase': 'armed'})); path.chmod(0o600); os.chown(path, 1000, 1000)
        self.assertTrue(n.Window.interruption_armed(self.window, request, binding, n.ObservationBudget(o, n.time.monotonic() + 1)))
        for key in ['requestId', 'workerId', 'eventId', 'tripId', 'sourceRecordId', 'phase']:
            path.write_text(json.dumps(binding | {'phase': 'armed', key: 'stale'}))
            with self.assertRaisesRegex(RuntimeError, '^NOTIFICATIONS_INTERRUPT_ARMED_INVALID$'):
                n.Window.interruption_armed(self.window, request, binding, n.ObservationBudget(o, n.time.monotonic() + 1))
        path.write_text(json.dumps(binding | {'phase': 'armed'})); os.chown(path, 0, 0)
        with self.assertRaisesRegex(RuntimeError, '^NOTIFICATIONS_INTERRUPT_ARMED_INVALID$'):
            n.Window.interruption_armed(self.window, request, binding, n.ObservationBudget(o, n.time.monotonic() + 1))

    def test_postkill_lease_requires_running_unexpired_uncompleted_target(self):
        self.assertEqual(n.interrupted_lease(o, self.interrupt_lease()), self.interrupt_lease())
        for values in [{'state': 'ready'}, {'unexpired': 0}, {'unexpired': True}, {'completedAt': 'fictional completed time'}, {'attempts': 0},
                       {'leaseUntilUtc': self.interrupt_lease()['observedUtc']}, {'observedUtc': '2026-13-28T00:00:00.000000Z'}]:
            with self.assertRaisesRegex(RuntimeError, '^NOTIFICATIONS_INTERRUPTED_LEASE_INVALID$'):
                n.interrupted_lease(o, self.interrupt_lease() | values)

    def test_postkill_lease_observation_preserves_types_without_unknown_values(self):
        valid = n.interrupted_lease_observation(self.interrupt_lease())
        self.assertTrue(valid['object'] and valid['exactKeys'] and valid['timestampFormat'] and valid['timestampParse'])
        self.assertEqual((valid['types']['unexpired'], valid['unexpired'], valid['remainingMs']), ('integer', 1, 60000))
        boolean = n.interrupted_lease_observation(self.interrupt_lease() | {'unexpired': True})
        self.assertEqual((boolean['types']['unexpired'], boolean['unexpired']), ('boolean', None))
        expired = n.interrupted_lease_observation(self.interrupt_lease() | {'observedUtc': '2026-10-28T00:02:00.000000Z'})
        self.assertEqual(expired['remainingMs'], -60000)
        self.assertFalse(n.interrupted_lease_observation(None)['object'])
        private = 'fictional-private-input-that-must-not-be-echoed'
        value = n.interrupted_lease_observation({'state': private, 'attempts': private, 'leaseUntilUtc': private,
            'observedUtc': private, 'unexpired': private, 'completedAt': private, private: private})
        self.assertNotIn(private, json.dumps(value))
        self.assertFalse(value['exactKeys'] or value['timestampFormat'] or value['timestampParse'])
        malformed = n.interrupted_lease_observation(self.interrupt_lease() | {'observedUtc': '2026-13-28T00:00:00.000000Z'})
        self.assertTrue(malformed['timestampFormat']); self.assertFalse(malformed['timestampParse'])

    def test_invalid_lease_observation_survives_primary_validation_and_secondary_stop_failure(self):
        containers = self.interrupt_fixture()
        containers.stop.side_effect = [None, RuntimeError('fictional private cleanup error')]
        job = '55555555-5555-4555-8555-555555555555'.encode().hex().upper()
        invalid = self.interrupt_lease() | {'unexpired': True}
        self.window.sql = Mock(side_effect=[b'0', b'1', job.encode(), json.dumps(invalid).encode()])
        with patch.object(o, 'run', side_effect=self.interrupt_reply):
            with self.assertRaisesRegex(RuntimeError, '^NOTIFICATIONS_INTERRUPTED_LEASE_INVALID$'):
                self.window.interrupt(self.interrupt_request())
        record = self.window.bound()['interruption']
        self.assertEqual((record['stage'], record['reason']), ('lease_proof', 'lease_invalid'))
        self.assertEqual(record['leaseObservation']['types']['unexpired'], 'boolean')
        self.assertTrue(record['processAbsent'] and record['stopFailed'])
        self.assertNotIn('lease', record)
        self.assertNotIn('fictional private', json.dumps(record))

    def test_cold_start_does_not_consume_claim_time_and_late_stop_cannot_escape_absolute_budget(self):
        for late_stop in [False, True]:
            containers = self.interrupt_fixture()
            now = [100.0]
            def reply(args, **kwargs):
                if args[:2] == ['docker', 'logs'] and now[0] < 125:
                    path = self.base / 'state/last-child.stderr'; path.write_bytes(b''); path.chmod(0o600)
                    current = n.time.time_ns(); os.utime(path, ns=(current, current))
                    return b''
                return self.interrupt_reply(args, **kwargs)
            if late_stop:
                containers.stop.side_effect = lambda _name: now.__setitem__(0, 156.0)
            job = '55555555-5555-4555-8555-555555555555'.encode().hex().upper()
            self.window.sql = Mock(side_effect=[b'0', b'1', job.encode(), json.dumps(self.interrupt_lease()).encode()])
            with patch.object(o, 'run', side_effect=reply), patch.object(n.time, 'monotonic', side_effect=lambda: now[0]), \
                    patch.object(n.time, 'sleep', side_effect=lambda _delay: now.__setitem__(0, now[0] + 5)):
                if late_stop:
                    with self.assertRaisesRegex(RuntimeError, '^NOTIFICATIONS_INTERRUPT_OBSERVATION_DEADLINE$'):
                        self.window.interrupt(self.interrupt_request())
                else:
                    self.window.interrupt(self.interrupt_request())
            self.assertEqual(self.window.sql.call_args_list[2].kwargs['timeout'], 10)
            self.assertEqual(self.window.observed_containers.call_args_list[0].args[0].deadline, 155)
            record = self.window.bound()['interruption']
            self.assertEqual(record['status'], 'failed' if late_stop else 'pass')
            self.assertEqual((self.window.directory / 'exchange/interrupted.json').exists(), not late_stop)
            if not late_stop:
                self.assertIn("'unexpired',CAST(j.lease_until>UTC_TIMESTAMP(3) AS UNSIGNED)", self.window.sql.call_args_list[3].args[0])
                self.assertEqual(record['leaseObservation']['types']['unexpired'], 'integer')
                for path in (self.window.directory / 'exchange').iterdir():
                    path.unlink()
                self.window.marker.unlink()
                (self.window.directory / 'exchange').rmdir(); self.window.directory.rmdir()

    def test_visible_before_startup_or_missing_after_arm_never_claims_an_unbound_job(self):
        for counts in [[b'1'], [b'0', b'0']]:
            containers = self.interrupt_fixture()
            self.window.sql = Mock(side_effect=counts)
            with patch.object(o, 'run', side_effect=self.interrupt_reply):
                with self.assertRaisesRegex(RuntimeError, 'NOTIFICATIONS_(PRODUCER_ALREADY_COMMITTED|INTERRUPT_TARGET_NOT_COMMITTED)'):
                    self.window.interrupt(self.interrupt_request())
            self.assertFalse(self.window.bound()['interruption']['claimed'])
            self.assertFalse((self.window.directory / 'exchange/interrupted.json').exists())
            containers.stop.assert_called_once_with('synthetic-interrupted')
            if len(counts) == 1:
                self.window.marker.unlink()
                (self.window.directory / 'exchange').rmdir(); self.window.directory.rmdir()

    def test_interrupt_target_rejects_noncanonical_identifiers_before_container_creation(self):
        containers = self.interrupt_fixture()
        for values in [{'eventId': 'private SQL fragment'}, {'tripId': None}, {'sourceRecordId': 'a' * 64}, {'fixtureId': 'not-a-cid'}]:
            with self.assertRaisesRegex(RuntimeError, '^NOTIFICATIONS_INTERRUPT_TARGET_INVALID$'):
                self.window.interrupt(self.interrupt_request() | values)
        containers.create.assert_not_called()

    def test_worker_phase_is_bounded_closed_and_never_retains_private_fields(self):
        output = b'private prefix\n' + json.dumps({'event': 'jobs_acceptance_phase', 'phase': 'jobs_pass',
            'sql': 'private body', 'cookie': 'private cookie'}).encode() + b'\n'
        self.assertEqual(n.worker_phase(output), 'jobs_pass')
        self.assertIsNone(n.worker_phase(b'{"event":"jobs_acceptance_phase","phase":"private account"}\n'))
        self.assertIsNone(n.worker_phase(b'null\n[]\n{"phase":"jobs_pass"}\n'))
        self.assertIsNone(n.worker_phase(b'{"event":"jobs_acceptance_phase","phase":[]}\n'))
        self.assertIsNone(n.worker_phase(output + b'x' * 65536))

    def test_worker_state_reports_process_exit_without_private_docker_fields(self):
        value = {'State': {'Running': False, 'ExitCode': 137, 'OOMKilled': True, 'Dead': False,
                           'Error': 'private path and host', 'Pid': 999}}
        self.assertEqual(n.worker_state(value), {'running': False, 'exitCode': 137, 'oomKilled': True, 'dead': False})
        self.assertNotIn('private', json.dumps(n.worker_state(value)))
        self.assertIsNone(n.worker_state(None))
        self.assertIsNone(n.worker_state({'State': []}))
        self.assertEqual(n.worker_state({'State': {'Running': 'private', 'ExitCode': True, 'OOMKilled': [], 'Dead': {}}}),
                         {'running': None, 'exitCode': None, 'oomKilled': None, 'dead': None})

    def test_host_none_and_null_ipam_inventory_have_no_ranges(self):
        self.assertEqual(n.occupied_ranges(o, [{'Name': 'host', 'IPAM': {'Config': None}},
                                              {'Name': 'none', 'IPAM': {'Config': []}},
                                              {'IPAM': None}, {}]), [])

    def test_mixed_ipv4_ipv6_ranges_are_retained_and_invalid_shape_fails_closed(self):
        ranges = n.occupied_ranges(o, [{'IPAM': {'Config': [{'Subnet': '192.0.2.0/24'}, {'Subnet': '2001:db8::/64'}]}}])
        self.assertEqual([r.version for r in ranges], [4, 6])
        for inventory in [None, [None], [{'IPAM': 'bad'}], [{'IPAM': {'Config': 'bad'}}],
                          [{'IPAM': {'Config': [{'Subnet': 'fictional-invalid-subnet'}]}}]]:
            with self.assertRaisesRegex(RuntimeError, '^NOTIFICATIONS_NETWORK_INVENTORY_INVALID$'):
                n.occupied_ranges(o, inventory)

    def test_non_docker_host_vpn_route_excludes_candidate_and_default_route_does_not(self):
        header = 'Iface Destination Gateway Flags RefCnt Use Metric Mask MTU Window IRTT\n'
        routes = activation.host_routes(o, header +
            'vpn0 00003C0A 00000000 0001 0 0 0 0000FFFF 0 0 0\n' +
            'eth0 00000000 00000000 0001 0 0 0 00000000 0 0 0\n')
        self.assertEqual([str(r) for r in routes], ['10.60.0.0/16'])
        with patch.object(n.secrets, 'token_bytes', side_effect=[bytes([60, 1]), bytes([61, 1])]):
            selected = n.choose_subnet(o, n.occupied_ranges(o, [{'IPAM': {'Config': None}}]) + routes)
        self.assertEqual(str(selected), '10.61.1.0/29')
        self.assertEqual(activation.host_routes(o, header), [])
        for bad in ['', 'unrecognized header', header + 'vpn0 malformed\n']:
            with self.assertRaisesRegex(RuntimeError, '^HOST_ROUTE_INVENTORY_INVALID$'):
                activation.host_routes(o, bad)

    def test_pause_resume_preserve_exercising_phase_and_reject_invalid_replay(self):
        self.state(phase='exercising')
        with patch.object(n.WindowContainers, 'stop'), patch.object(n.time, 'time', return_value=100):
            n.operation(o, SHA, IMAGE, 'pause', RUN)
            self.assertFalse(self.window.bound()['schedule'])
            n.operation(o, SHA, IMAGE, 'resume', RUN)
            self.assertEqual(self.window.bound()['phase'], 'exercising')
            self.assertTrue(self.window.bound()['schedule'])
            with self.assertRaisesRegex(RuntimeError, '^NOTIFICATIONS_PHASE_INVALID$'):
                n.operation(o, SHA, IMAGE, 'resume', RUN)

    def test_private_input_rejects_symlink_and_permissive_mode(self):
        path = self.base / 'private/input.json'
        path.write_text('{}'); path.chmod(0o644)
        with self.assertRaisesRegex(RuntimeError, 'NOTIFICATIONS_PRIVATE_INPUT_INVALID'):
            n.private_json(o, path)
        path.chmod(0o600)
        link = self.base / 'private/link'
        link.symlink_to(path)
        with self.assertRaisesRegex(RuntimeError, 'NOTIFICATIONS_PRIVATE_INPUT_INVALID'):
            n.private_json(o, link)

    def test_binding_rejects_other_run_controls_and_shared_change(self):
        self.state()
        self.assertEqual(self.window.bound()['runId'], RUN)
        (self.base / 'operations.py').write_text('# changed')
        with self.assertRaisesRegex(RuntimeError, 'NOTIFICATIONS_SHARED_STATE_CHANGED'):
            self.window.bound()
        self.state(runId='other')
        with self.assertRaisesRegex(RuntimeError, 'NOTIFICATIONS_BINDING_INVALID'):
            self.window.bound()

    def test_prepare_collision_never_creates_resources(self):
        self.state()
        with patch.object(o, 'run') as run, patch.object(self.window, 'sql') as sql:
            with self.assertRaisesRegex(RuntimeError, 'NOTIFICATIONS_COLLISION'):
                self.window.prepare()
        run.assert_not_called(); sql.assert_not_called()

    def test_stop_attempts_every_receipt_and_retains_failed_fence(self):
        state = self.state()
        with patch.object(self.window.containers, 'stop', side_effect=[RuntimeError('fixed')] + [None] * (len(n.ROLES) - 1)) as stop:
            with self.assertRaisesRegex(RuntimeError, 'NOTIFICATIONS_STOP_INCOMPLETE'):
                self.window.stop_all(state)
        self.assertEqual(stop.call_count, len(n.ROLES))
        self.assertEqual(self.window.bound()['phase'], 'stop_failed')
        self.assertFalse(self.window.bound()['schedule'])

    def test_expiry_stops_and_paused_tick_never_runs_worker(self):
        self.state(schedule=False)
        with patch.object(n.time, 'time', return_value=100), patch.object(self.window, 'worker') as worker:
            self.window.tick()
        worker.assert_not_called()
        self.state()
        with patch.object(n.time, 'time', return_value=501), patch.object(self.window.containers, 'stop') as stop, patch.object(self.window, 'worker') as worker:
            self.window.tick()
        self.assertEqual(stop.call_count, len(n.ROLES)); worker.assert_not_called()
        self.assertEqual(self.window.bound()['phase'], 'expired')

    def test_tick_records_failure_without_switching_to_shared_jobs(self):
        self.state()
        with patch.object(n.time, 'time', return_value=100), patch.object(self.window, 'work_sample', return_value={'ready': 1}), patch.object(self.window, 'worker', side_effect=RuntimeError('fixed')):
            with self.assertRaisesRegex(RuntimeError, '^fixed$'):
                self.window.tick()
        self.assertEqual(self.window.bound()['ticks'][0]['status'], 'failed')

    def test_same_minute_duplicate_tick_is_observed_without_accelerating_workers(self):
        self.state(ticks=[{'startedUtc': 121, 'status': 'pass'}])
        with patch.object(n.time, 'time', return_value=150), patch.object(self.window, 'worker') as worker:
            self.window.tick()
        worker.assert_not_called()
        self.assertEqual(self.window.bound()['duplicateMinuteSkips'], 1)
        self.assertEqual(len(self.window.bound()['ticks']), 1)

    def test_work_sample_preserves_uninitialized_scan_and_no_due_work_as_unavailable(self):
        with patch.object(self.window, 'sql', return_value=b'0\t0\t0\t0\tNULL\n0\n'):
            sample = self.window.work_sample()
        self.assertIsNone(sample['oldestDueMs'])
        self.assertFalse(sample['scanInitialized'])
        self.assertIsNone(sample['scanCursor'])
        with patch.object(self.window, 'sql', return_value=b'3\t2\t1\t0\t1200000\n2\nNULL\n'):
            sample = self.window.work_sample()
        self.assertEqual(sample['oldestDueMs'], 1200)
        self.assertTrue(sample['scanInitialized'])

    def test_fixture_request_without_committed_process_receipt_never_invokes_docker(self):
        self.state(phase='exercising', startedUtc=90)
        exchange = self.window.directory / 'exchange'; exchange.mkdir(parents=True)
        path = exchange / 'request.json'
        path.write_text(json.dumps({'runId': RUN, 'scenario': 8, 'kind': 'overlap', 'createdUtc': 100000}))
        path.chmod(0o600); os.chown(path, 1000, 1000)
        with patch.object(n.time, 'time', return_value=100), patch.object(o, 'run') as run:
            with self.assertRaisesRegex(RuntimeError, '^NOTIFICATIONS_FIXTURE_RECEIPT_REQUIRED$'):
                self.window.request(self.window.bound())
        run.assert_not_called()

    def test_unknown_create_acknowledgement_halts_before_any_drop(self):
        self.state(allocations={'schema': 'creating'})
        with patch.object(self.window.containers, 'stop'), patch.object(self.window, 'sql') as sql:
            with self.assertRaisesRegex(RuntimeError, 'NOTIFICATIONS_ALLOCATION_UNCERTAIN'):
                self.window.cleanup()
        sql.assert_not_called()

    def test_extra_global_privilege_is_rejected(self):
        self.state()
        with patch.object(self.window, 'sql', side_effect=[b'0'] * 6 + [b'SUPER']):
            with self.assertRaisesRegex(RuntimeError, 'NOTIFICATIONS_GLOBAL_GRANT'):
                self.window.verify_rights({'runtime': {}, 'jobs': {}})

    def test_reconciliation_source_and_continuation_profile_has_no_history_mutation_or_excess_columns(self):
        manifest = json.loads(pathlib.Path(__file__).with_name('notifications-acceptance-grants.json').read_text())
        for profile in manifest.values():
            self.assertEqual(profile['reconciliation_rules'], ['INSERT', 'SELECT'])
            self.assertEqual(profile['reconciliation_candidates'], ['INSERT', 'SELECT', 'UPDATE(active)'])
            self.assertEqual(profile['reconciliation_searches'], ['INSERT', 'SELECT',
                'UPDATE(trip_id,generation,root_version,rule_hash,epoch,phase,cursor,finished,complete,evidence_complete,updated_at)'])
            for unrelated in ['reconciliation_commands', 'reconciliation_history', 'reconciliations']:
                self.assertNotIn(unrelated, profile)

    def test_column_grant_renderer_quotes_identifiers_and_rejects_sql_fragments(self):
        self.assertEqual(n.grant_privileges(o, ['INSERT', 'SELECT', 'UPDATE(trip_id,cursor)']),
                         'INSERT,SELECT,UPDATE(`trip_id`,`cursor`)')
        for rights in [[], ['UPDATE(cursor);DELETE'], ['UPDATE(cursor`x)'], ['SELECT', 'SELECT'], ['ALL'], [None]]:
            with self.assertRaisesRegex(RuntimeError, '^NOTIFICATIONS_GRANTS_INVALID$'):
                n.grant_privileges(o, rights)

    def test_combined_jobs_catalog_cleanup_has_precise_owning_writes_and_protected_columns(self):
        manifest = json.loads(pathlib.Path(__file__).with_name('notifications-acceptance-grants.json').read_text())
        jobs, runtime = manifest['jobs'], manifest['runtime']
        self.assertEqual(jobs['catalog_commands'], ['DELETE', 'SELECT'])
        self.assertEqual(jobs['catalog_operations'], ['SELECT', 'UPDATE(state,failure_code)'])
        self.assertEqual(jobs['catalog_artifacts'], ['SELECT', 'UPDATE(content,payload_expires_at)'])
        self.assertEqual(jobs['catalog_revisions'], ['SELECT', 'UPDATE(state,pruned)'])
        for table in ['catalog_relations', 'catalog_mappings', 'catalog_aliases', 'catalog_facts', 'catalog_changes', 'catalog_coverage', 'catalog_mapping_issues']:
            self.assertEqual(jobs[table], ['DELETE', 'SELECT'])
        self.assertNotIn('catalog_publications', jobs)
        for table in ['catalog_facts', 'catalog_revisions', 'catalog_publications']:
            self.assertEqual(runtime[table], ['SELECT'])
        self.assertEqual(runtime['notification_acceptance'], ['SELECT', 'UPDATE(refs)'])
        self.assertEqual(jobs['notification_acceptance'], ['SELECT'])

    def test_worker_failure_capture_retains_primary_closed_context_and_discards_private_fields(self):
        records = [dict(event='jobs_failed', category='operation_failed', diagnostic={
            'category': 'database', 'step': 'jobs_catalog_cleanup', 'nativeErrno': 1142,
            'sqlOperation': 'delete', 'sqlTables': ['catalog_commands', 'private_table'],
            'deniedTable': 'catalog_commands', 'lockingMode': 'none', 'sql': 'private_body',
            'params': ['private_password'], 'schema': 'private_schema', 'account': 'private_account'}),
            dict(event='jobs_failed', category='close_failed', diagnostic={'category': 'operation', 'step': 'jobs_close'})]
        captured = n.worker_failure(('\n'.join(json.dumps(row) for row in records)).encode(), ['catalog_commands'])
        self.assertEqual(captured['step'], 'jobs_catalog_cleanup')
        self.assertEqual(captured['sqlTables'], ['catalog_commands'])
        self.assertEqual(captured['nativeErrno'], 1142)
        self.assertNotIn('private_', json.dumps(captured))
        self.assertIsNone(n.worker_failure(b'{"event":"jobs_failed","category":"operation_failed"}', ['catalog_commands']))

    def test_proxy_only_inherits_the_existing_minimal_bind_capability(self):
        template = json.loads(pathlib.Path(__file__).with_name('notifications.acceptance.compose.yaml').read_text())
        for role, service in template['services'].items():
            self.assertEqual(service.get('cap_add', []), ['NET_BIND_SERVICE'] if role == 'proxy' else [])
            self.assertEqual(service['cap_drop'], ['ALL'])
            self.assertEqual(service['security_opt'], ['no-new-privileges:true'])
            self.assertTrue(service['read_only']); self.assertNotIn('ports', service)
        (self.base / 'notifications.acceptance.compose.yaml').write_text(json.dumps(template))
        self.state(phase='prepared', apiIp='192.0.2.2', proxyIp='192.0.2.3')
        for name in ['exchange', 'proxy-config']:
            (self.window.directory / name).mkdir(parents=True, exist_ok=True)
        created = []
        def create(role, arguments, **kwargs):
            created.append((role, arguments))
            return 'c' * 64
        def run(arguments, **kwargs):
            if arguments[1] == 'cp':
                pathlib.Path(arguments[-1]).write_text('fictional certificate-only fixture')
            return json.dumps([{'Id': IMAGE}]).encode()
        project = 'vtc011-0123456789abcdef'
        with patch.dict(os.environ, REHEARSAL_VOLUME=project + '-config', REHEARSAL_PROJECT=project), patch.object(o, 'PROJECT', project), patch.object(n.time, 'time', return_value=100), patch.object(o, 'run', side_effect=run), patch.object(self.window.containers, 'create', side_effect=create):
            self.window.start()
        for role, arguments in created:
            added = [arguments[i + 1] for i, value in enumerate(arguments) if value == '--cap-add']
            self.assertEqual(added, ['NET_BIND_SERVICE'] if role == 'proxy' else [])
            self.assertNotIn('--publish', arguments)

    def test_real_mount_formatter_rejects_mismatched_rehearsal_allocation(self):
        source = self.base / 'private/fictional-exchange'
        with patch.dict(os.environ, REHEARSAL_VOLUME='', REHEARSAL_PROJECT=''):
            self.assertEqual(n.mount(o, source, '/acceptance'), f'type=bind,source={source},target=/acceptance,readonly')
        project = 'vtc011-0123456789abcdef'
        with patch.object(o, 'PROJECT', project), patch.dict(os.environ, REHEARSAL_VOLUME=project + '-config', REHEARSAL_PROJECT=project):
            self.assertEqual(n.mount(o, source, '/acceptance'), f'type=volume,source={project}-config,target=/acceptance,volume-subpath=private/fictional-exchange,readonly')
            for name, value in [('REHEARSAL_PROJECT', 'foreign'), ('REHEARSAL_VOLUME', '../foreign')]:
                with patch.dict(os.environ, {name: value}):
                    with self.assertRaisesRegex(RuntimeError, '^NOTIFICATIONS_REHEARSAL_BINDING_INVALID$'):
                        n.mount(o, source, '/acceptance')

    def test_shared_grant_digest_tracks_real_rights_without_authentication_or_bodies(self):
        queries = []
        def read(query):
            queries.append(query)
            return b'fictional stable grant metadata\n'
        with patch.object(self.window, 'sql', side_effect=read):
            baseline = self.window.shared_grants()
        self.assertEqual(len(queries), 9)
        for forbidden in ['authentication_string', 'password', 'ROUTINE_DEFINITION', 'SHOW CREATE']:
            self.assertFalse(any(forbidden.lower() in query.lower() for query in queries))
        self.assertTrue(any('mysql.default_roles' in query for query in queries))
        self.assertTrue(any('mysql.procs_priv' in query for query in queries))
        with patch.object(self.window, 'sql', side_effect=[b'changed permission\n'] + [b'fictional stable grant metadata\n'] * 8):
            self.assertNotEqual(self.window.shared_grants(), baseline)

    def test_every_uncertain_allocation_fails_cleanup_before_any_sql_drop(self):
        for resource in ['schema', 'network', 'runtime', 'jobs', 'migrator']:
            self.state(allocations={resource: 'creating'})
            with patch.object(self.window.containers, 'stop'), patch.object(self.window, 'sql') as sql:
                with self.assertRaisesRegex(RuntimeError, '^NOTIFICATIONS_ALLOCATION_UNCERTAIN$'):
                    self.window.cleanup()
            sql.assert_not_called()
            self.assertTrue(self.window.marker.exists())

    def test_one_account_drop_failure_does_not_skip_other_safe_account_removals(self):
        self.state(allocations={role: 'created' for role in self.window.accounts})
        drops = []
        def sql(query):
            if query.startswith('SELECT COALESCE'):
                return RUN.encode()
            if query.startswith('SELECT COUNT(*) FROM information_schema.SCHEMATA'):
                return b'0'
            if query.startswith('DROP USER'):
                drops.append(query)
                if self.window.accounts['runtime'] in query:
                    raise RuntimeError('fixed DCL failure')
                return b''
            self.fail('Unexpected cleanup query')
        with patch.object(self.window.containers, 'stop'), patch.object(self.window, 'sql', side_effect=sql):
            with self.assertRaisesRegex(RuntimeError, '^NOTIFICATIONS_CLEANUP_INCOMPLETE$'):
                self.window.cleanup()
        self.assertEqual(len(drops), 3)
        state = self.window.bound()
        self.assertEqual(state['allocations'], {'runtime': 'created', 'jobs': 'removed', 'migrator': 'removed'})
        self.assertFalse(state['schedule']); self.assertTrue(self.window.marker.exists())

    def test_shared_grant_change_keeps_fence_and_never_reverts_unowned_rights(self):
        self.state(allocations={role: 'removed' for role in ['schema', 'network', *self.window.accounts]},
                   sharedGrantsSha256='a' * 64)
        queries = []
        def sql(query):
            queries.append(query)
            return b'' if query.startswith('SELECT COALESCE') else b'0'
        with patch.object(self.window.containers, 'stop'), patch.object(self.window, 'sql', side_effect=sql), patch.object(self.window, 'shared_grants', return_value='b' * 64):
            with self.assertRaisesRegex(RuntimeError, '^NOTIFICATIONS_SHARED_GRANTS_CHANGED$'):
                self.window.cleanup()
        self.assertTrue(self.window.marker.exists())
        self.assertTrue((self.base / 'state/notifications-acceptance-evidence.json').exists())
        self.assertTrue(all(query.startswith('SELECT ') for query in queries))

    def test_acknowledged_schema_without_matching_sentinel_is_never_dropped(self):
        self.state(allocations={'schema': 'created'})
        queries = []
        def sql(query):
            queries.append(query)
            if query.startswith('SELECT COALESCE'):
                return b''
            if query.startswith('SELECT COUNT(*) FROM information_schema.SCHEMATA'):
                return b'1'
            return b'foreign synthetic run'
        with patch.object(self.window.containers, 'stop'), patch.object(self.window, 'sql', side_effect=sql):
            with self.assertRaisesRegex(RuntimeError, '^NOTIFICATIONS_SENTINEL_INVALID$'):
                self.window.cleanup()
        self.assertTrue(all(query.startswith('SELECT ') for query in queries))
        self.assertTrue(self.window.marker.exists())

    def test_tick_preserves_heartbeat_then_selects_only_owned_window(self):
        self.state()
        calls = []
        with patch.object(o, 'validate_image'), patch.object(o, 'heartbeat_locked', side_effect=lambda *a, **k: calls.append('heartbeat')), patch.object(n, 'tick', side_effect=lambda *a: calls.append('window')), patch.object(o, 'jobs_locked') as shared:
            o.tick_locked(SHA, IMAGE)
        shared.assert_not_called()
        self.assertEqual(calls, ['heartbeat', 'window'])


class ControlInstallTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = pathlib.Path(self.temp.name) / 'installed'; self.base.mkdir()
        (self.base / 'private').mkdir(); (self.base / 'state').mkdir()
        self.source = pathlib.Path(self.temp.name) / 'reviewed'; self.source.mkdir()
        for name in n.FILES:
            original = pathlib.Path(__file__).parent / name
            (self.source / name).write_bytes(original.read_bytes())
            (self.base / name).write_text('# old executable controls\n' if name.endswith('.py') else '{}')
        self.original = {name: (self.base / name).read_bytes() for name in n.FILES}
        (self.base / 'compose.yaml').write_text('shared compose must survive')
        (self.base / 'activation-grants.json').write_text('shared grants must survive')
        self.patch = patch.object(o, 'BASE', self.base); self.patch.start(); self.addCleanup(self.patch.stop)
        self.reviewed = dict(revision=SHA, imageId=IMAGE, candidate={name: o.digest(self.source / name) for name in n.FILES},
                             previous=n.hashes(o, n.FILES), protected=n.hashes(o, n.PROTECTED))
        o.atomic_json(self.base / 'private/notifications-controls-input.json', self.reviewed)
        self.active = patch.object(o, 'current', return_value={'revision': SHA, 'imageId': IMAGE})
        self.active.start(); self.addCleanup(self.active.stop)
        for name in ['validate_image', 'stop_owned_jobs']:
            p = patch.object(o, name); p.start(); self.addCleanup(p.stop)

    def test_old_controls_bootstrap_is_control_only_idempotent_and_restorable(self):
        with patch.object(o, 'compose') as compose:
            update_controls.notifications_install(self.source)
            update_controls.notifications_install(self.source)
            self.assertFalse((self.base / 'state/recovery-required').exists())
            self.assertEqual(n.hashes(o, n.PROTECTED), self.reviewed['protected'])
            update_controls.notifications_install(self.source, restore=True)
            for name, content in self.original.items():
                self.assertEqual((self.base / name).read_bytes(), content)
        compose.assert_not_called()

    def test_completed_full_controls_receipt_allows_dispatch_without_mutation(self):
        path = self.base / 'state/controls-update.json'
        o.atomic_json(path, completed_controls_receipt())
        retained = path.read_bytes()
        with patch.object(n, 'Window') as window:
            n.operation(o, SHA, IMAGE, 'prepare', RUN)
            window.return_value.prepare.assert_called_once()
        self.assertEqual(path.read_bytes(), retained)

    def test_completed_full_controls_receipt_allows_notifications_only_install_and_restore(self):
        path = self.base / 'state/controls-update.json'
        o.atomic_json(path, completed_controls_receipt())
        retained = path.read_bytes()
        update_controls.notifications_install(self.source)
        self.assertEqual(path.read_bytes(), retained)
        update_controls.notifications_install(self.source, restore=True)
        self.assertEqual(path.read_bytes(), retained)
        self.assertEqual({name: (self.base / name).read_bytes() for name in n.FILES}, self.original)

    def assert_receipt_rejected_before_dispatch_or_install(self):
        before = {name: (self.base / name).read_bytes() for name in n.FILES}
        with patch.object(n, 'Window') as window, patch.object(activation, 'private_copy') as copy:
            for action in [lambda: n.operation(o, SHA, IMAGE, 'prepare', RUN),
                           lambda: update_controls.notifications_install(self.source)]:
                with self.assertRaises((RuntimeError, ValueError, OSError)):
                    action()
            window.assert_not_called(); copy.assert_not_called()
        self.assertEqual({name: (self.base / name).read_bytes() for name in n.FILES}, before)
        self.assertFalse((self.base / 'state/notifications-controls-update.json').exists())

    def test_active_incomplete_malformed_and_unknown_full_controls_receipts_fail_before_work(self):
        path = self.base / 'state/controls-update.json'
        receipt = completed_controls_receipt()
        variants = [None, [], False, {}, receipt | {'pending': True}, receipt | {'pending': 0},
                    receipt | {'pending': 'false'}, receipt | {'complete': False}, receipt | {'complete': 1},
                    receipt | {'prepared': False}, receipt | {'revision': 'invalid'},
                    receipt | {'imageId': 'invalid'}, receipt | {'hashes': {}}, receipt | {'hashes': []},
                    receipt | {'hashes': {'../foreign': 'e' * 64}}, receipt | {'hashes': {'operations.py': 'invalid'}},
                    receipt | {'previous': {'foreign.py': 'e' * 64}}, receipt | {'unknown': True}]
        variants += [{k: v for k, v in receipt.items() if k != missing} for missing in receipt]
        for value in variants:
            with self.subTest(valueType=type(value).__name__):
                o.atomic_json(path, value)
                retained = path.read_bytes()
                self.assert_receipt_rejected_before_dispatch_or_install()
                self.assertEqual(path.read_bytes(), retained)
        path.write_text('{invalid'); path.chmod(0o600)
        self.assert_receipt_rejected_before_dispatch_or_install()
        self.assertEqual(path.read_text(), '{invalid')

    def test_unsafe_full_controls_receipts_are_not_adopted_or_deleted(self):
        path = self.base / 'state/controls-update.json'
        unrelated = self.base / 'private/unrelated.json'
        o.atomic_json(unrelated, completed_controls_receipt())
        retained = unrelated.read_bytes()
        for kind in ['public', 'foreign', 'oversize', 'directory', 'symlink', 'dangling', 'hardlink']:
            with self.subTest(kind=kind):
                if kind in ['symlink', 'dangling']:
                    path.symlink_to(unrelated if kind == 'symlink' else self.base / 'absent')
                elif kind == 'directory': path.mkdir()
                elif kind == 'hardlink': os.link(unrelated, path)
                else:
                    o.atomic_json(path, completed_controls_receipt())
                    if kind == 'public': path.chmod(0o644)
                    if kind == 'foreign': os.chown(path, 1000, 1000)
                    if kind == 'oversize': path.write_bytes(b' ' * 65537)
                self.assert_receipt_rejected_before_dispatch_or_install()
                self.assertTrue(path.is_symlink() or path.exists())
                self.assertEqual(unrelated.read_bytes(), retained)
                if kind == 'directory': path.rmdir()
                else: path.unlink()

    def test_terminal_controls_history_does_not_override_existing_acceptance_or_safety_fences(self):
        path = self.base / 'state/controls-update.json'
        o.atomic_json(path, completed_controls_receipt())
        retained = path.read_bytes()
        for name in ['identity-acceptance', 'jobs-acceptance', 'ingress-check.json',
                     'recovery-required', '../private/maintenance/enabled']:
            marker = self.base / 'state' / name
            marker.parent.mkdir(parents=True, exist_ok=True); marker.write_text('{}')
            with patch.object(n, 'Window') as window:
                with self.assertRaisesRegex(RuntimeError, '^NOTIFICATIONS_FENCED$'):
                    n.operation(o, SHA, IMAGE, 'prepare', RUN)
                window.assert_not_called()
            marker.unlink()
        for name in ['notifications-acceptance', 'identity-acceptance', 'jobs-acceptance', 'ingress-check.json']:
            marker = self.base / 'state' / name; marker.write_text('{}')
            with patch.object(activation, 'private_copy') as copy:
                with self.assertRaisesRegex(RuntimeError, '^ACCEPTANCE_WINDOW$'):
                    update_controls.notifications_install(self.source)
                copy.assert_not_called()
            marker.unlink()
        self.assertEqual(path.read_bytes(), retained)

    def test_interrupted_install_fences_then_exact_source_resumes(self):
        original_copy = activation.private_copy
        def interrupt(source, destination):
            if destination == self.base / 'operations.py':
                raise RuntimeError('fixed interruption')
            return original_copy(source, destination)
        with patch.object(activation, 'private_copy', side_effect=interrupt):
            with self.assertRaisesRegex(RuntimeError, 'fixed interruption'):
                update_controls.notifications_install(self.source)
        self.assertTrue((self.base / 'state/recovery-required').exists())
        self.assertEqual(n.hashes(o, n.PROTECTED), self.reviewed['protected'])
        update_controls.notifications_install(self.source)
        self.assertFalse((self.base / 'state/recovery-required').exists())

    def test_changed_review_and_foreign_fence_reject_without_write(self):
        (self.base / 'state/recovery-required').write_text('{}')
        (self.base / 'state/recovery-required').chmod(0o600)
        with self.assertRaisesRegex(RuntimeError, 'NOTIFICATIONS_CONTROL_FENCE_FOREIGN'):
            update_controls.notifications_install(self.source)
        self.assertEqual({name: (self.base / name).read_bytes() for name in n.FILES}, self.original)


class HttpProbeTests(unittest.TestCase):
    """Transport/failure propagation only; these stub responses are not domain/TLS acceptance."""

    def probe(self, *, two_expected=False, fail_http=False):
        preferences = {name: True for name in ['tripStarted', 'tripFinished', 'tripRejected', 'eventChanges', 'eventReminders', 'qualificationChanges']}
        sessions = {}
        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass
            def respond(self, status, data, cookie=None, etag=None):
                self.send_response(status)
                self.send_header('content-type', 'application/json')
                self.send_header('cache-control', 'no-store')
                if cookie:
                    self.send_header('set-cookie', cookie)
                if etag:
                    self.send_header('etag', etag)
                self.end_headers()
                self.wfile.write(json.dumps({'data': data}).encode())
            def dispatch(self):
                if fail_http:
                    self.respond(500, {'private': 'fictional must never be logged'})
                    return
                cookie = self.headers.get('cookie', '')
                session = cookie.split('=', 1)[-1]
                if self.path == '/api/v1/auth/csrf':
                    self.respond(200, {'token': 'fictional-csrf'})
                    return
                if self.path == '/api/v1/auth/login':
                    body = json.loads(self.rfile.read(int(self.headers.get('content-length', '0'))))
                    identity = 'observer' if body['email'].startswith('observer') else 'owner'
                    sessions[identity] = True
                    self.respond(200, {}, 'fixture=' + identity)
                    return
                if not sessions.get(session):
                    self.respond(401, {})
                    return
                if self.path == '/api/v1/auth/logout':
                    sessions[session] = False
                    self.respond(200, {})
                    return
                if 'notification-preferences' in self.path:
                    self.respond(200, preferences, etag='"1"' if self.command == 'GET' else '"2"')
                    return
                if self.command == 'POST':
                    if self.headers.get('content-length'):
                        self.rfile.read(int(self.headers['content-length']))
                    self.respond(200, {})
                    return
                item = {'id': '00000000-0000-4000-8000-000000000001', 'category': 'event.reminder',
                        'display': {'actorNickname': None, 'eventTitle': 'Fictional convoy', 'game': 'ets2'},
                        'target': None, 'liveToastEligible': False}
                self.respond(200, {'nextCursor': 'fictional-checkpoint', 'items': [item] if session == 'owner' else [],
                                   'hasMore': False, 'unreadCount': 1 if session == 'owner' else 0})
            do_GET = dispatch
            do_POST = dispatch
            do_PUT = dispatch
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            with tempfile.TemporaryDirectory() as directory:
                config = pathlib.Path(directory) / 'probe.json'
                actors = [{'email': 'owner@example.invalid', 'password': 'fictional-private-passphrase',
                           'forbiddenCategories': [], 'expected': {'category': 'event.reminder', 'occurredAt': '2026-01-01T00:00:00.000Z'}}]
                if two_expected:
                    actors.append(dict(actors[0], email='observer@example.invalid'))
                config.write_text(json.dumps({'origin': f'http://127.0.0.1:{server.server_port}', 'syntheticOnly': True, 'actors': actors})); config.chmod(0o600)
                result = subprocess.run(['node', str(pathlib.Path(__file__).with_name('notifications-probe.mjs')), 'exercise'],
                                        env=dict(os.environ, VTC_NOTIFICATIONS_PROBE='synthetic-only', NOTIFICATIONS_PROBE_CONFIG=str(config)),
                                        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15)
                output = (result.stdout + result.stderr).decode()
                for private in ['fictional-private-passphrase', 'owner@example.invalid', 'observer@example.invalid', 'fictional must never be logged']:
                    self.assertNotIn(private, output)
                return result.returncode, output
        finally:
            server.shutdown(); server.server_close(); thread.join(timeout=2)

    def test_real_http_six_operations_and_logout_propagate_success(self):
        code, output = self.probe()
        self.assertEqual(code, 0)
        self.assertIn('"result":"pass"', output)

    def test_every_expected_actor_must_observe_its_own_message(self):
        code, output = self.probe(two_expected=True)
        self.assertNotEqual(code, 0)
        self.assertIn('"result":"fail"', output)

    def test_real_http_failure_is_nonzero_and_private_body_is_redacted(self):
        code, output = self.probe(fail_http=True)
        self.assertNotEqual(code, 0)
        self.assertIn('"result":"fail"', output)


import activation

if __name__ == '__main__':
    unittest.main()
