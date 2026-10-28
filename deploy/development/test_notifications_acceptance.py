"""Fixed-operation failure paths; real MySQL/HTTPS/minute work belongs to the window rehearsal."""
import json
import http.server
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


class WindowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = pathlib.Path(self.temp.name)
        (self.base / 'state').mkdir()
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

    def interrupt_fixture(self):
        self.state()
        self.window.directory.mkdir(parents=True)
        (self.window.directory / 'exchange').mkdir()
        containers = Mock()
        containers.names = ['synthetic-interrupted']
        containers.create.return_value = 'c' * 64
        self.window.containers = containers
        return containers

    def test_interrupt_claim_timeout_retains_closed_stage_and_primary_when_stop_fails(self):
        containers = self.interrupt_fixture()
        containers.stop.side_effect = RuntimeError('private cleanup detail')
        self.window.sql = Mock(return_value=b'')
        with patch.object(o, 'run', return_value=b''), patch.object(n.time, 'sleep'), \
                patch.object(n.time, 'monotonic', side_effect=[100, 100, 101, 111, 112]):
            with self.assertRaisesRegex(RuntimeError, '^NOTIFICATIONS_LEASE_NOT_OBSERVED$'):
                self.window.interrupt()
        record = self.window.bound()['interruption']
        self.assertEqual(record, {'stage': 'claim_wait', 'claimed': False, 'queries': 2,
                                  'status': 'failed', 'reason': 'claim_not_observed',
                                  'elapsedMs': 12000, 'stopFailed': True, 'workerPhase': None,
                                  'workerFailure': None, 'workerStateUnavailable': True})
        self.assertNotIn('private', json.dumps(record))

    def test_interrupt_query_failure_has_closed_reason_without_exception_text(self):
        containers = self.interrupt_fixture()
        self.window.sql = Mock(side_effect=RuntimeError('private query account and body'))
        with patch.object(o, 'run', return_value=b''):
            with self.assertRaisesRegex(RuntimeError, '^private query account and body$'):
                self.window.interrupt()
        record = self.window.bound()['interruption']
        self.assertEqual((record['stage'], record['reason'], record['claimed']),
                         ('claim_wait', 'operation_failed', False))
        self.assertNotIn('private', json.dumps(record))
        containers.stop.assert_called_once_with('synthetic-interrupted')

    def test_interrupt_unknown_creation_never_adopts_or_stops_a_name(self):
        containers = self.interrupt_fixture()
        containers.create.side_effect = RuntimeError('uncertain private create detail')
        with self.assertRaisesRegex(RuntimeError, '^uncertain private create detail$'):
            self.window.interrupt()
        self.assertEqual(self.window.bound()['interruption']['stage'], 'create')
        containers.stop.assert_not_called()

    def test_interrupt_success_ack_follows_positive_claim_and_stop(self):
        containers = self.interrupt_fixture()
        self.window.sql = Mock(return_value=('d' * 32).encode())
        with patch.object(o, 'run', return_value=b''):
            self.window.interrupt()
        record = self.window.bound()['interruption']
        self.assertEqual((record['stage'], record['status'], record['claimed'], record['queries']),
                         ('ack', 'pass', True, 1))
        self.assertEqual(containers.stop.call_count, 2)
        ack = json.loads((self.window.directory / 'exchange/interrupted.json').read_text())
        self.assertEqual((ack['runId'], ack['jobIdHex']), (RUN, 'd' * 32))

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
