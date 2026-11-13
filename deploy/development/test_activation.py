"""Failure-path feedback; real configuration, grants and durable flows run in rehearsal.py."""
import base64
import json
import pathlib
import signal
import subprocess
import sys
import tempfile
import unittest
from contextlib import ExitStack
from unittest.mock import patch

import activation
import operations as ops
import update_controls


class ActivationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.base = pathlib.Path(self.directory.name)
        (self.base / 'state').mkdir()
        (self.base / 'private/maintenance').mkdir(parents=True)
        (self.base / 'private/identity-mail.env').write_text('IDENTITY_ENABLED=false\nMAIL_MODE=disabled\n')
        (self.base / 'private/activation-input.env').write_text('IDENTITY_ENABLED=true\nMAIL_MODE=disabled\n')
        self.patch = patch.object(ops, 'BASE', self.base)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.revision, self.image = 'a' * 40, 'sha256:' + 'b' * 64

    def invoke(self, mode):
        return activation.config_operation(ops, self.revision, self.image, mode)

    def fence(self, *_args):
        ops.maintenance(True)

    def test_invalid_config_and_acceptance_window_never_fence_or_mutate(self):
        original = (self.base / 'private/identity-mail.env').read_bytes()
        with patch.object(activation, 'validate', side_effect=RuntimeError('FIXED_INVALID_CONFIG')), patch.object(ops, 'fenced') as fenced:
            with self.assertRaisesRegex(RuntimeError, '^FIXED_INVALID_CONFIG$'):
                self.invoke('apply')
        fenced.assert_not_called()
        self.assertEqual((self.base / 'private/identity-mail.env').read_bytes(), original)
        (self.base / 'state/identity-acceptance').touch()
        with patch.object(activation, 'validate') as validate:
            with self.assertRaisesRegex(RuntimeError, '^ACCEPTANCE_WINDOW$'):
                self.invoke('apply')
        validate.assert_not_called()
        with patch.object(ops, 'run') as run:
            with self.assertRaisesRegex(RuntimeError, '^ACCEPTANCE_WINDOW$'):
                ops.release_locked(self.base / 'not-opened.tar', self.revision, 1, 1, 'auto', self.image)
        run.assert_not_called()

    def test_partial_grants_keep_fence_and_original_config_then_recover(self):
        original = (self.base / 'private/identity-mail.env').read_bytes()
        with patch.object(activation, 'validate'), patch.object(ops, 'fenced', side_effect=self.fence), patch.object(activation, 'grants', side_effect=RuntimeError('FIXED_GRANT_FAILURE')):
            with self.assertRaisesRegex(RuntimeError, '^FIXED_GRANT_FAILURE$'):
                self.invoke('apply')
        self.assertTrue((self.base / 'state/recovery-required').exists())
        self.assertTrue((self.base / 'private/maintenance/enabled').exists())
        self.assertEqual((self.base / 'private/identity-mail.env').read_bytes(), original)
        self.assertEqual((self.base / 'private/identity-mail.previous.env').read_bytes(), original)
        with patch.object(activation, 'validate'), patch.object(ops, 'fenced', side_effect=self.fence), patch.object(activation, 'grants'), patch.object(ops, 'compose'), patch.object(ops, 'ready'), patch.object(ops, 'public_ready'):
            self.invoke('recover')
            self.assertFalse((self.base / 'state/recovery-required').exists())
            self.invoke('rollback')
        self.assertEqual((self.base / 'private/identity-mail.env').read_bytes(), original)
        self.assertFalse((self.base / 'private/maintenance/enabled').exists())
        ops.recovery_intent()
        with patch.object(activation, 'validate'), patch.object(ops, 'fenced') as fenced:
            with self.assertRaisesRegex(RuntimeError, '^ACTIVATION_UNRELATED_RECOVERY$'):
                self.invoke('rollback')
        fenced.assert_not_called()

    def test_readiness_failure_retains_fence_and_rejects_changed_recovery_input(self):
        with patch.object(activation, 'validate'), patch.object(ops, 'fenced', side_effect=self.fence), patch.object(activation, 'grants'), patch.object(ops, 'compose'), patch.object(ops, 'ready', side_effect=RuntimeError('FIXED_READINESS_FAILURE')):
            with self.assertRaisesRegex(RuntimeError, '^FIXED_READINESS_FAILURE$'):
                self.invoke('apply')
        (self.base / 'private/activation-input.env').write_text('DIFFERENT=INPUT\n')
        with patch.object(activation, 'validate'), patch.object(ops, 'fenced') as fenced:
            with self.assertRaisesRegex(RuntimeError, '^ACTIVATION_RECOVERY_OWNERSHIP_INVALID$'):
                self.invoke('recover')
        fenced.assert_not_called()
        self.assertTrue((self.base / 'state/recovery-required').exists())

    def test_privilege_matrix_refuses_extras_but_allows_only_known_legacy_select(self):
        shutil_source = pathlib.Path(__file__).with_name('activation-grants.json')
        (self.base / 'activation-grants.json').write_bytes(shutil_source.read_bytes())
        expected = [[f"'vtc_{role}'@'%'", 'vtc', table, privilege, 'NO']
                    for role, tables in activation.matrix(ops).items()
                    for table, permissions in tables.items() for privilege in permissions]
        activation.check_privileges(ops, expected, complete=True)
        legacy = ["'vtc_runtime'@'%'", 'vtc', '*', 'SELECT', 'NO']
        activation.check_privileges(ops, expected + [legacy], allow_legacy=True)
        for extra in [legacy, ["'vtc_runtime'@'%'", 'vtc', 'identity_verifications', 'INSERT', 'NO'],
                      ["'vtc_jobs'@'%'", 'vtc', 'identity_users', 'UPDATE', 'NO'],
                      ["'vtc_jobs'@'%'", 'global', '*', 'SUPER', 'NO']]:
            with self.assertRaisesRegex(RuntimeError, '^UNEXPECTED_EFFECTIVE_PRIVILEGES$'):
                activation.check_privileges(ops, expected + [extra], complete=True)

    def test_partial_control_replacement_keeps_fence_and_same_source_retry_preserves_backup(self):
        source = pathlib.Path(__file__).parent
        original = b'# previous reviewed disabled controls\n'
        (self.base / 'operations.py').write_bytes(original)
        real_copy = activation.private_copy
        failed = False
        def interrupted_copy(origin, target):
            nonlocal failed
            if target == self.base / 'Caddyfile' and not failed:
                failed = True
                raise RuntimeError('FIXED_CONTROL_COPY_FAILURE')
            return real_copy(origin, target)
        with patch.object(ops, 'current', return_value={'revision': self.revision, 'imageId': self.image}), patch.object(ops, 'validate_image'), patch.object(activation, 'ingress'), patch.object(ops, 'jobs_configuration'), patch.object(ops, 'run', return_value=b''), patch.object(ops, 'fenced', side_effect=self.fence):
            with patch.object(activation, 'private_copy', side_effect=interrupted_copy):
                with self.assertRaisesRegex(RuntimeError, '^FIXED_CONTROL_COPY_FAILURE$'):
                    update_controls.install(source)
            self.assertTrue((self.base / 'state/recovery-required').exists())
            self.assertTrue((self.base / 'private/maintenance/enabled').exists())
            with self.assertRaisesRegex(RuntimeError, '^CONTROL_UPDATE_INCOMPLETE$'):
                activation.controls_pending(ops, self.revision, self.image)
            update_controls.install(source)
        self.assertEqual((self.base / 'state/controls-previous/operations.py').read_bytes(), original)
        self.assertTrue(activation.controls_pending(ops, self.revision, self.image))
        self.assertEqual((self.base / 'operations.py').read_bytes(), (source / 'operations.py').read_bytes())

    def settled_update(self):
        """What a finished earlier update and apply leave on a host."""
        marker = self.base / 'state/controls-update.json'
        marker.write_text(json.dumps({'pending': False, 'complete': True, 'revision': 'c' * 40,
                                      'imageId': 'sha256:' + 'd' * 64, 'hashes': {}, 'previous': {}, 'prepared': True}))
        for name in ['candidate', 'previous']:
            (self.base / f'state/controls-{name}').mkdir(mode=0o700)
            (self.base / f'state/controls-{name}/operations.py').write_text(f'# earlier {name}\n')
        (self.base / 'operations.py').write_text('# installed earlier\n')
        return self.base / f'state/controls-settled-{ops.digest(marker)[:16]}-0'

    def control_install(self):
        return patch.object(ops, 'current', return_value={'revision': self.revision, 'imageId': self.image}), patch.object(
            ops, 'validate_image'), patch.object(activation, 'ingress'), patch.object(ops, 'jobs_configuration'), patch.object(
            ops, 'run', return_value=b''), patch.object(ops, 'fenced', side_effect=self.fence)

    def test_update_after_a_finished_update_keeps_the_earlier_bytes(self):
        source = pathlib.Path(__file__).parent
        archive = self.settled_update()
        current, image, ingress, jobs, run, fenced = self.control_install()
        with current, image, ingress, jobs, run, fenced:
            update_controls.install(source)
        self.assertEqual((archive / 'controls-candidate/operations.py').read_text(), '# earlier candidate\n')
        self.assertEqual((archive / 'controls-previous/operations.py').read_text(), '# earlier previous\n')
        self.assertIs(json.loads((archive / 'controls-update.json').read_text())['pending'], False)
        self.assertEqual((self.base / 'state/controls-previous/operations.py').read_text(), '# installed earlier\n')
        self.assertEqual((self.base / 'operations.py').read_bytes(), (source / 'operations.py').read_bytes())
        self.assertTrue(activation.controls_pending(ops, self.revision, self.image))
        self.assertTrue((self.base / 'state/recovery-required').exists())

    def test_interrupted_retirement_repeats_under_the_same_name(self):
        source = pathlib.Path(__file__).parent
        archive = self.settled_update()
        real_replace = update_controls.os.replace
        def interrupted(origin, target):
            if pathlib.Path(origin).name == 'controls-previous':
                raise RuntimeError('FIXED_RETIRE_FAILURE')
            return real_replace(origin, target)
        current, image, ingress, jobs, run, fenced = self.control_install()
        with current, image, ingress, jobs, run, fenced:
            with patch.object(update_controls.os, 'replace', side_effect=interrupted):
                with self.assertRaisesRegex(RuntimeError, '^FIXED_RETIRE_FAILURE$'):
                    update_controls.install(source)
            self.assertFalse((self.base / 'state/recovery-required').exists())
            self.assertTrue((self.base / 'state/controls-update.json').exists())
            update_controls.install(source)
        self.assertEqual((archive / 'controls-candidate/operations.py').read_text(), '# earlier candidate\n')
        self.assertEqual((archive / 'controls-previous/operations.py').read_text(), '# earlier previous\n')
        self.assertIs(json.loads((archive / 'controls-update.json').read_text())['pending'], False)
        self.assertEqual(len(list((self.base / 'state').glob('controls-settled-*'))), 1)
        self.assertTrue(activation.controls_pending(ops, self.revision, self.image))

    def test_retired_record_moves_only_after_its_directories_are_durable(self):
        archive = self.settled_update()
        marker, stage, backup = [self.base / f'state/{name}' for name in
                                 ['controls-update.json', 'controls-candidate', 'controls-previous']]
        events = []
        real_replace, real_sync = update_controls.os.replace, update_controls.sync_directories
        def replace(origin, target):
            events.append(pathlib.Path(origin).name)
            return real_replace(origin, target)
        def sync(*paths):
            events.append(sorted(path.name for path in paths))
            return real_sync(*paths)
        with patch.object(update_controls.os, 'replace', side_effect=replace), patch.object(
                update_controls, 'sync_directories', side_effect=sync):
            update_controls.retire_settled(marker, stage, backup)
        durable = sorted([archive.name, 'state'])
        self.assertEqual(events, ['controls-candidate', 'controls-previous', durable, 'controls-update.json', durable])

    def test_repeated_updates_and_applies_at_one_revision_keep_working(self):
        source = pathlib.Path(__file__).parent
        current, image, ingress, jobs, run, fenced = self.control_install()
        with current, image, ingress, jobs, run, fenced, patch.object(activation, 'validate'), patch.object(
                activation, 'grants'), patch.object(ops, 'compose'), patch.object(ops, 'ready'), patch.object(ops, 'public_ready'):
            for _ in range(4):
                update_controls.install(source)
                self.assertTrue(activation.controls_pending(ops, self.revision, self.image))
                self.invoke('apply')
                self.assertFalse((self.base / 'state/recovery-required').exists())
                self.assertFalse(activation.controls_pending(ops, self.revision, self.image))
            update_controls.install(source)
        # The first record differs; the later ones repeat byte for byte and need their own slots.
        slots = sorted(path.name[-2:] for path in (self.base / 'state').glob('controls-settled-*'))
        self.assertEqual(slots, ['-0', '-0', '-1', '-2'])
        self.assertTrue(all((path / 'controls-update.json').exists() and (path / 'controls-previous').is_dir()
                            for path in (self.base / 'state').glob('controls-settled-*')))

    def test_settled_update_stays_in_place_during_a_window_or_pending_activation(self):
        source = pathlib.Path(__file__).parent
        self.settled_update()
        marker = self.base / 'state/controls-update.json'
        settled = marker.read_bytes()
        window = self.base / 'state/notifications-acceptance'
        intent = self.base / 'state/activation-intent.json'
        current, image, ingress, jobs, run, fenced = self.control_install()
        with current, image, ingress, jobs, run, fenced:
            window.mkdir()
            with self.assertRaisesRegex(RuntimeError, '^ACCEPTANCE_WINDOW$'):
                update_controls.install(source)
            window.rmdir()
            intent.write_text(json.dumps({'pending': True}))
            with self.assertRaisesRegex(RuntimeError, '^ACTIVATION_PENDING$'):
                update_controls.install(source)
        self.assertEqual(marker.read_bytes(), settled)
        self.assertTrue((self.base / 'state/controls-candidate/operations.py').exists())
        self.assertEqual(list((self.base / 'state').glob('controls-settled-*')), [])
        self.assertFalse((self.base / 'private/maintenance/enabled').exists())

    def test_settled_update_stays_in_place_under_a_fence_or_unknown_state(self):
        source = pathlib.Path(__file__).parent
        self.settled_update()
        marker = self.base / 'state/controls-update.json'
        settled = marker.read_bytes()
        current, image, ingress, jobs, run, fenced = self.control_install()
        with current, image, ingress, jobs, run, fenced:
            for fence in [self.base / 'state/recovery-required', self.base / 'private/maintenance/enabled']:
                fence.write_text('{}')
                with self.assertRaisesRegex(RuntimeError, '^CONTROL_UPDATE_FENCED$'):
                    update_controls.install(source)
                fence.unlink()
                self.assertEqual(marker.read_bytes(), settled)
                self.assertTrue((self.base / 'state/controls-candidate/operations.py').exists())
            marker.write_text(json.dumps({'pending': False, 'complete': False}))
            with self.assertRaisesRegex(RuntimeError, '^CONTROL_UPDATE_OWNERSHIP_INVALID$'):
                update_controls.install(source)
        self.assertEqual((self.base / 'operations.py').read_text(), '# installed earlier\n')

    def copy_interruption(self, target_name, prefix):
        real_copy = activation.private_copy
        original = (self.base / 'private/identity-mail.env').read_bytes()
        candidate = (self.base / 'private/activation-input.env').read_bytes()
        def interrupted_copy(source, target):
            if target.name == target_name:
                if prefix:
                    staged = target.with_name(target.name + '.new')
                    staged.write_bytes(source.read_bytes()[:12])
                    staged.chmod(0o600)
                raise RuntimeError('FIXED_COPY_INTERRUPTION')
            return real_copy(source, target)
        with patch.object(activation, 'validate'), patch.object(ops, 'fenced', side_effect=self.fence), patch.object(activation, 'grants'), patch.object(ops, 'compose'), patch.object(ops, 'ready'), patch.object(ops, 'public_ready'):
            with patch.object(activation, 'private_copy', side_effect=interrupted_copy):
                with self.assertRaisesRegex(RuntimeError, '^FIXED_COPY_INTERRUPTION$'):
                    self.invoke('apply')
            self.assertTrue((self.base / 'state/recovery-required').exists())
            self.assertTrue((self.base / 'private/maintenance/enabled').exists())
            self.invoke('recover')
        self.assertEqual((self.base / 'private/identity-mail.previous.env').read_bytes(), original)
        self.assertEqual((self.base / 'private/identity-mail.env').read_bytes(), candidate)
        self.assertFalse((self.base / 'state/recovery-required').exists())
        self.assertFalse(list((self.base / 'private').glob('*.new')))

    def test_recovery_reconstructs_missing_backup_from_only_exact_original_hash(self):
        self.copy_interruption('identity-mail.previous.env', False)

    def test_recovery_resumes_interrupted_backup_prefix(self):
        self.copy_interruption('identity-mail.previous.env', True)

    def test_recovery_resumes_interrupted_shared_replacement_prefix(self):
        self.copy_interruption('identity-mail.env', True)

    def test_copy_refuses_unexplained_bytes_and_symlinks_without_overwrite(self):
        source = self.base / 'private/activation-input.env'
        target = self.base / 'private/copy-fixture.env'
        temporary = target.with_name(target.name + '.new')
        temporary.write_bytes(b'UNRELATED_PRIVATE_FIXTURE')
        temporary.chmod(0o600)
        with self.assertRaisesRegex(RuntimeError, '^COPY_TEMP_CONTENT_INVALID$'):
            activation.private_copy(source, target)
        self.assertEqual(temporary.read_bytes(), b'UNRELATED_PRIVATE_FIXTURE')
        self.assertFalse(target.exists())
        temporary.unlink()
        temporary.symlink_to(source)
        original = source.read_bytes()
        with self.assertRaises(OSError):
            activation.private_copy(source, target)
        self.assertEqual(source.read_bytes(), original)

    def stage_profile(self):
        source = pathlib.Path(__file__).with_name(activation.STAGE_PROFILE)
        (self.base / activation.STAGE_PROFILE).write_bytes(source.read_bytes())
        (self.base / 'activation-grants.json').write_bytes(
            pathlib.Path(__file__).with_name('activation-grants.json').read_bytes())
        return json.loads(source.read_text())

    def test_stage_profile_matches_the_reviewed_key_allowlist(self):
        profile = self.stage_profile()
        self.assertEqual(set(profile['flags']), set(activation.STAGE_FLAGS))
        self.assertEqual(set(profile['settings']), set(activation.STAGE_SETTINGS))
        self.assertEqual(set(profile['generatedKeys']), set(activation.STAGE_KEYS))
        self.assertEqual(set(profile['grants']), {'runtime', 'jobs'})
        self.assertIn(activation.STAGE_PROFILE, activation.CONTROL_FILES)
        self.assertLessEqual({*activation.STAGE_FLAGS, *activation.STAGE_SETTINGS, *activation.STAGE_KEYS},
                             set(activation.SHARED_KEYS))
        self.assertFalse(activation.RETIRED_SETTINGS & set(profile['settings']))
        self.assertLessEqual(activation.RETIRED_SETTINGS, set(activation.SHARED_KEYS))

    def test_module_grants_install_only_for_a_configuration_that_enables_modules(self):
        self.stage_profile()
        baseline = activation.grant_sql(ops)
        self.assertNotIn('telemetry_tokens', baseline)
        self.assertEqual(activation.grant_sql(ops, values={'TRIPS_ENABLED': 'false'}), baseline)
        modules = activation.grant_sql(ops, values={'TRIPS_ENABLED': 'true'})
        self.assertIn('vtc.telemetry_tokens', modules)
        # MySQL refuses the reserved column name unless it is quoted.
        self.assertIn('`cursor`', modules)
        (self.base / activation.STAGE_PROFILE).unlink()
        with self.assertRaisesRegex(RuntimeError, '^STAGE_PROFILE_REQUIRED$'):
            activation.grant_sql(ops, values={'TRIPS_ENABLED': 'true'})

    def test_column_grants_read_back_per_column_and_rollback_keeps_module_grants(self):
        self.stage_profile()
        self.assertEqual(activation.quoted_columns('UPDATE(a,cursor)'), 'UPDATE(`a`,`cursor`)')
        self.assertEqual(activation.quoted_columns('SELECT'), 'SELECT')
        self.assertEqual({row[3] for row in activation.privilege_rows({'jobs': {'t': ['UPDATE(a,b)']}})},
                         {'UPDATE(a)', 'UPDATE(b)'})
        enabled = {'TRIPS_ENABLED': 'true'}
        rows = [list(row) for row in sorted(activation.privilege_rows(activation.matrix(ops, enabled)))]
        activation.check_privileges(ops, rows, complete=True, values=enabled)
        # A host that never applied modules must match the baseline exactly.
        with self.assertRaisesRegex(RuntimeError, '^UNEXPECTED_EFFECTIVE_PRIVILEGES$'):
            activation.check_privileges(ops, rows, complete=True, values={})
        with patch.object(activation, 'privileges', side_effect=[[], rows]), patch.object(ops, 'compose') as compose:
            activation.grants(ops, self.revision, enabled)
        compose.assert_called_once()
        self.assertTrue((self.base / activation.STAGE_GRANTS_STATE).exists())
        # A rolled-back identity-only configuration keeps the narrow rights that apply recorded.
        activation.check_privileges(ops, rows, complete=True, values={})
        # A later control update that narrows the profile cannot disown what is still installed.
        profile = self.stage_profile()
        del profile['grants']['runtime']['telemetry_tokens']
        (self.base / activation.STAGE_PROFILE).write_text(json.dumps(profile))
        activation.check_privileges(ops, rows, complete=True, values={})
        with patch.object(activation, 'privileges', side_effect=[rows, rows]), patch.object(ops, 'compose'):
            activation.grants(ops, self.revision, enabled)
        recorded = json.loads((self.base / activation.STAGE_GRANTS_STATE).read_text())['privileges']
        self.assertIn(['\'vtc_runtime\'@\'%\'', 'vtc', 'telemetry_tokens', 'SELECT', 'NO'], recorded)
        with self.assertRaisesRegex(RuntimeError, '^MISSING_EFFECTIVE_PRIVILEGES$'):
            activation.check_privileges(ops, rows[1:], complete=True, values=enabled)
        extra = ["'vtc_runtime'@'%'", 'vtc', 'telemetry_tokens', 'DROP', 'NO']
        with self.assertRaisesRegex(RuntimeError, '^UNEXPECTED_EFFECTIVE_PRIVILEGES$'):
            activation.check_privileges(ops, rows + [extra], values=enabled)

    def test_module_flags_ignore_every_other_value(self):
        path = self.base / 'private/flags.env'
        path.write_text('TRIPS_ENABLED=true\nEVENTS_ENABLED=false\nDIFFERENT=TRIPS_ENABLED=true\n')
        self.assertEqual(activation.module_flags(path), {'TRIPS_ENABLED': 'true'})

    def test_prepare_stage_keeps_live_values_and_never_regenerates_keys(self):
        self.stage_profile()
        shared = self.base / 'private/identity-mail.env'
        candidate = self.base / 'private/activation-input.env'
        shared.write_text('IDENTITY_ENABLED=true\nMAIL_MODE=disabled\nTRIPS_CURSOR_KEY=' + 'c' * 64 + '\n')
        shared.chmod(0o600)
        candidate.unlink()
        with patch.object(activation, 'private_values', side_effect=lambda _o, path, _k: dict(
                line.split('=', 1) for line in path.read_text().splitlines())):
            self.invoke('prepare-stage')
            first = candidate.read_text()
            self.assertEqual(candidate.stat().st_mode & 0o077, 0)
            self.assertIn('TRIPS_CURSOR_KEY=' + 'c' * 64 + '\n', first)
            self.assertIn('IDENTITY_ENABLED=true\n', first)
            self.assertIn('TELEMETRY_ENABLED=true\n', first)
            self.invoke('prepare-stage')
            self.assertEqual(candidate.read_text(), first)
            (self.base / 'state/activation-intent.json').write_text(json.dumps({'pending': True}))
            with self.assertRaisesRegex(RuntimeError, '^ACTIVATION_PENDING$'):
                self.invoke('prepare-stage')
            (self.base / 'state/activation-intent.json').unlink()
            shared.write_text('IDENTITY_ENABLED=false\n')
            with self.assertRaisesRegex(RuntimeError, '^IDENTITY_REQUIRED$'):
                self.invoke('prepare-stage')

    def test_second_apply_archives_a_settled_backup_and_refuses_an_unsettled_one(self):
        shared = self.base / 'private/identity-mail.env'
        previous = self.base / 'private/identity-mail.previous.env'
        first_config = shared.read_bytes()
        stack = (patch.object(activation, 'validate'), patch.object(ops, 'fenced', side_effect=self.fence),
                 patch.object(activation, 'grants'), patch.object(ops, 'compose'), patch.object(ops, 'ready'),
                 patch.object(ops, 'public_ready'))
        for item in stack:
            item.start()
            self.addCleanup(item.stop)
        self.invoke('apply')
        second_config = shared.read_bytes()
        (self.base / 'private/activation-input.env').write_text('IDENTITY_ENABLED=true\nMAIL_MODE=disabled\nTRIPS_ENABLED=true\n')
        self.invoke('apply')
        self.assertEqual(previous.read_bytes(), second_config)
        retired = list((self.base / 'private').glob('identity-mail.previous.*.env'))
        self.assertEqual([path.read_bytes() for path in retired], [first_config])
        self.invoke('rollback')
        self.assertEqual(shared.read_bytes(), second_config)
        # The intent no longer describes the live file: an unexplained edit must not lose the backup.
        shared.write_text('IDENTITY_ENABLED=true\nMAIL_MODE=disabled\nEDITED=1\n')
        with self.assertRaisesRegex(RuntimeError, '^ACTIVATION_BACKUP_STATE_INVALID$'):
            self.invoke('apply')
        self.assertEqual(previous.read_bytes(), second_config)

    def test_unchanged_apply_keeps_the_rollback_target(self):
        shared = self.base / 'private/identity-mail.env'
        previous = self.base / 'private/identity-mail.previous.env'
        original = shared.read_bytes()
        stack = (patch.object(activation, 'validate'), patch.object(ops, 'fenced', side_effect=self.fence),
                 patch.object(activation, 'grants'), patch.object(ops, 'compose'), patch.object(ops, 'ready'),
                 patch.object(ops, 'public_ready'))
        for item in stack:
            item.start()
            self.addCleanup(item.stop)
        self.invoke('apply')
        self.invoke('apply')
        self.assertEqual(previous.read_bytes(), original)
        self.assertFalse(list((self.base / 'private').glob('identity-mail.previous.*.env')))
        self.invoke('rollback')
        self.assertEqual(shared.read_bytes(), original)

    def route_activation_fixture(self):
        shared = self.base / 'private/identity-mail.env'
        candidate = self.base / 'private/activation-input.env'
        previous = self.base / 'private/identity-mail.previous.env'
        legacy = b'IDENTITY_ENABLED=true\nMAIL_MODE=disabled\nEVENTS_ENABLED=true\nCATALOGS_ENABLED=true\n'
        staged = legacy + b'EVENTS_ROUTE_ENABLED=true\n'
        for path, content in [(shared, legacy), (candidate, staged)]:
            path.write_bytes(content)
            path.chmod(0o600)
        return shared, candidate, previous, legacy, staged

    def mock_route_activation(self, stack, **history):
        stack.enter_context(patch.object(activation, 'validate'))
        fenced = stack.enter_context(patch.object(ops, 'fenced', side_effect=self.fence))
        grants = stack.enter_context(patch.object(activation, 'grants'))
        compose = stack.enter_context(patch.object(ops, 'compose'))
        stack.enter_context(patch.object(ops, 'ready'))
        stack.enter_context(patch.object(ops, 'public_ready'))
        probe = stack.enter_context(patch.object(activation, 'has_published_route_history', **history))
        return fenced, grants, compose, probe

    def test_route_history_probe_supports_pre_0028_and_checks_fenced_history_with_a_lock(self):
        with patch.object(ops, 'compose', return_value=b'0\n') as compose:
            self.assertFalse(activation.has_published_route_history(ops, self.revision, self.image))
        compose.assert_called_once()
        self.assertIn(b'information_schema.tables', compose.call_args.kwargs['data'])
        with patch.object(ops, 'compose', side_effect=[b'1\n', b'1\n']) as compose:
            self.assertTrue(activation.has_published_route_history(ops, self.revision, self.image, fenced=True))
        self.assertIn(b'START TRANSACTION;', compose.call_args.kwargs['data'])
        self.assertIn(b'FOR SHARE); COMMIT;', compose.call_args.kwargs['data'])
        with patch.object(ops, 'compose', return_value=b'unexpected'):
            with self.assertRaisesRegex(RuntimeError, '^EVENT_ROUTE_HISTORY_PROBE_INVALID$'):
                activation.has_published_route_history(ops, self.revision, self.image)

    def test_route_activation_allows_legacy_rollback_before_first_marked_revision(self):
        shared, _, previous, legacy, staged = self.route_activation_fixture()
        with ExitStack() as stack:
            _, grants, _, probe = self.mock_route_activation(stack, return_value=False)
            self.invoke('apply')
            self.assertEqual(shared.read_bytes(), staged)
            self.invoke('rollback')
        self.assertEqual([call.kwargs['fenced'] for call in probe.call_args_list], [False, True])
        self.assertEqual(grants.call_count, 2)
        self.assertEqual(shared.read_bytes(), legacy)
        self.assertEqual(previous.read_bytes(), legacy)
        self.assertFalse((self.base / 'state/recovery-required').exists())

    def test_route_activation_refuses_known_legacy_targets_before_fencing_even_after_disabling_events(self):
        shared, candidate, previous, legacy, staged = self.route_activation_fixture()
        intent = self.base / 'state/activation-intent.json'
        with ExitStack() as stack:
            fenced, grants, _, probe = self.mock_route_activation(stack, return_value=True)
            self.invoke('apply')
            original_intent = intent.read_bytes()
            with self.assertRaisesRegex(RuntimeError, '^EVENT_ROUTE_HISTORY_REQUIRES_STAGE2$'):
                self.invoke('rollback')
            self.assertEqual(intent.read_bytes(), original_intent)
            self.assertEqual(shared.read_bytes(), staged)
            self.assertEqual(previous.read_bytes(), legacy)
            self.assertEqual(fenced.call_count, 1)
            self.assertEqual(grants.call_count, 1)
            disabled = legacy.replace(b'EVENTS_ENABLED=true', b'EVENTS_ENABLED=false')
            candidate.write_bytes(disabled)
            self.invoke('apply')
            original_intent = intent.read_bytes()
            candidate.write_bytes(legacy)
            with self.assertRaisesRegex(RuntimeError, '^EVENT_ROUTE_HISTORY_REQUIRES_STAGE2$'):
                self.invoke('apply')
            self.assertEqual(intent.read_bytes(), original_intent)
            self.assertEqual(shared.read_bytes(), disabled)
            self.assertEqual(previous.read_bytes(), staged)
        self.assertEqual([call.kwargs['fenced'] for call in probe.call_args_list], [False, False])
        self.assertEqual(fenced.call_count, 2)
        self.assertEqual(grants.call_count, 2)
        self.assertFalse((self.base / 'private/maintenance/enabled').exists())

    def test_route_rollback_rechecks_after_fence_and_recovers_exact_live_configuration(self):
        shared, candidate, previous, legacy, staged = self.route_activation_fixture()
        intent = self.base / 'state/activation-intent.json'
        marker = self.base / 'private/maintenance/enabled'
        def late_revision(*_args, fenced):
            self.assertEqual(marker.exists(), fenced)
            return fenced

        with ExitStack() as stack:
            fenced, grants, compose, probe = self.mock_route_activation(stack, side_effect=late_revision)
            self.invoke('apply')
            # The activation input may have been edited after the earlier successful apply.
            candidate.write_bytes(legacy + b'TRIPS_ENABLED=true\n')
            with self.assertRaisesRegex(RuntimeError, '^EVENT_ROUTE_HISTORY_REQUIRES_STAGE2$'):
                self.invoke('rollback')
            self.assertEqual(fenced.call_count, 2)
            self.assertEqual(grants.call_count, 1)
            self.assertEqual(compose.call_count, 1)
            self.assertEqual(shared.read_bytes(), staged)
            self.assertEqual(previous.read_bytes(), legacy)
            pending = json.loads(intent.read_text())
            self.assertTrue(pending['pending'])
            self.assertEqual(pending['target'], 'shared')
            self.assertEqual(pending['sharedHash'], ops.digest(shared))
            self.assertTrue((self.base / 'state/recovery-required').exists())
            shared.write_bytes(staged + b'TRIPS_ENABLED=true\n')
            with self.assertRaisesRegex(RuntimeError, '^ACTIVATION_RECOVERY_OWNERSHIP_INVALID$'):
                self.invoke('recover')
            self.assertEqual(fenced.call_count, 2)
            shared.write_bytes(staged)
            self.invoke('recover')
        self.assertEqual([call.kwargs['fenced'] for call in probe.call_args_list], [False, True])
        self.assertEqual(shared.read_bytes(), staged)
        self.assertEqual(previous.read_bytes(), legacy)
        self.assertFalse(json.loads(intent.read_text())['pending'])
        self.assertFalse(marker.exists())
        self.assertFalse((self.base / 'state/recovery-required').exists())

    def test_route_guard_preserves_recovery_and_rollback_to_compatible_stage2_configurations(self):
        shared, candidate, previous, legacy, staged = self.route_activation_fixture()
        intent = self.base / 'state/activation-intent.json'
        with ExitStack() as stack:
            _, grants, _, probe = self.mock_route_activation(stack, return_value=True)
            self.invoke('apply')
            # Model a prior process that stopped after copying the legacy file, before readiness.
            shared.write_bytes(legacy)
            pending = json.loads(intent.read_text())
            pending.update(pending=True, target='previous')
            ops.atomic_json(intent, pending)
            ops.maintenance(True)
            ops.recovery_intent()
            with self.assertRaisesRegex(RuntimeError, '^EVENT_ROUTE_HISTORY_REQUIRES_STAGE2$'):
                self.invoke('recover')
            self.assertEqual(grants.call_count, 1)
            self.assertEqual(json.loads(intent.read_text())['target'], 'candidate')
            self.invoke('recover')
            self.assertEqual(shared.read_bytes(), staged)
            candidate.write_bytes(staged + b'TRIPS_ENABLED=true\n')
            self.invoke('apply')
            self.assertEqual(previous.read_bytes(), staged)
            self.invoke('rollback')
        self.assertEqual([call.kwargs['fenced'] for call in probe.call_args_list], [True])
        self.assertEqual(shared.read_bytes(), staged)
        self.assertFalse((self.base / 'state/recovery-required').exists())

    def test_prepare_stage_retires_old_catalog_settings_from_a_live_file(self):
        self.stage_profile()
        shared = self.base / 'private/identity-mail.env'
        shared.write_text('IDENTITY_ENABLED=true\nMAIL_MODE=disabled\nCATALOGS_SYNTHETIC=false\n'
                          'CATALOGS_MAX_FILE_BYTES=1048576\nCATALOGS_ARTIFACT_TTL_MS=86400000\n'
                          'CATALOGS_POLICY_REVISION=1\nCATALOGS_EVIDENCE_BASE64=e30=\n')
        candidate = self.base / 'private/activation-input.env'
        for path in [shared, candidate]:
            path.chmod(0o600)
        activation.prepare_stage(ops)
        values = activation.private_values(ops, candidate, activation.SHARED_KEYS)
        for key in activation.RETIRED_SETTINGS:
            self.assertNotIn(key, values)
        self.assertEqual(values['CATALOGS_ENABLED'], 'true')
        self.assertIn('CATALOGS_CURSOR_KEY', values)

    def test_apply_revokes_grants_on_tables_dropped_by_the_simple_catalogs_migration(self):
        self.stage_profile()
        statement = activation.grant_sql(ops, values={'TRIPS_ENABLED': 'true'})
        self.assertEqual(len(activation.RETIRED_TABLES), 15)
        self.assertLess(statement.index('REVOKE IF EXISTS'), statement.index('GRANT '))
        for user in ['vtc_runtime', 'vtc_jobs']:
            for table in activation.RETIRED_TABLES:
                self.assertIn(f"REVOKE IF EXISTS ALL PRIVILEGES ON vtc.{table} FROM '{user}'@'%';", statement)
        for table in ['catalog_dlcs', 'catalog_regions', 'catalog_cities', 'catalog_cargoes', 'catalog_trailers']:
            self.assertIn(f"GRANT SELECT,INSERT,UPDATE ON vtc.{table} TO 'vtc_runtime'@'%';", statement)
        for table in ['catalog_companies', 'catalog_company_cities']:
            self.assertIn(f"GRANT SELECT,INSERT,UPDATE ON vtc.{table} TO 'vtc_runtime'@'%';", statement)
        self.assertIn("GRANT SELECT,INSERT,UPDATE,DELETE ON vtc.catalog_company_logos TO 'vtc_runtime'@'%';", statement)

    def test_retired_table_grants_are_tolerated_only_before_apply(self):
        self.stage_profile()
        enabled = {'TRIPS_ENABLED': 'true'}
        rows = [list(row) for row in activation.privilege_rows(activation.matrix(ops, enabled))]
        stale = [["'vtc_runtime'@'%'", 'vtc', 'catalog_revisions', 'SELECT', 'NO'],
                 ["'vtc_runtime'@'%'", 'vtc', 'event_catalog_pins', 'INSERT', 'NO'],
                 ["'vtc_jobs'@'%'", 'vtc', 'catalog_facts', 'DELETE', 'NO']]
        activation.check_privileges(ops, rows + stale, allow_legacy=True, values=enabled)
        with self.assertRaisesRegex(RuntimeError, '^UNEXPECTED_EFFECTIVE_PRIVILEGES$'):
            activation.check_privileges(ops, rows + stale, complete=True, values=enabled)
        # A stage record from an earlier apply does not keep the retired tables allowed afterwards.
        (self.base / activation.STAGE_GRANTS_STATE).write_text(json.dumps({'privileges': stale}))
        with self.assertRaisesRegex(RuntimeError, '^UNEXPECTED_EFFECTIVE_PRIVILEGES$'):
            activation.check_privileges(ops, rows + stale, complete=True, values=enabled)

    def test_prepare_stage_runs_under_the_owned_control_fence_only(self):
        self.stage_profile()
        shared = self.base / 'private/identity-mail.env'
        shared.write_text('IDENTITY_ENABLED=true\nMAIL_MODE=disabled\n')
        candidate = self.base / 'private/activation-input.env'
        candidate.unlink()
        handlers = {number: signal.getsignal(number) for number in [signal.SIGHUP, signal.SIGTERM, signal.SIGINT]}
        for number, handler in handlers.items():
            self.addCleanup(signal.signal, number, handler)
        with patch.object(ops, 'current', return_value={'revision': self.revision, 'imageId': self.image}), patch.object(
                ops, 'validate_image'), patch.object(activation, 'ingress'), patch.object(ops, 'jobs_configuration'), patch.object(
                ops, 'run', return_value=b''), patch.object(ops, 'fenced', side_effect=self.fence), patch.object(
                activation, 'private_values', side_effect=lambda _o, path, _k: dict(
                    line.split('=', 1) for line in path.read_text().splitlines())), patch.object(
                ops.os, 'geteuid', return_value=0), patch.object(
                sys, 'argv', ['operations.py', 'activation', 'prepare-stage']):
            update_controls.install(pathlib.Path(__file__).parent)
            self.assertTrue((self.base / 'state/recovery-required').exists())
            ops.main()
            self.assertIn('TELEMETRY_ENABLED=true\n', candidate.read_text())
            # Any other recovery stays closed to it.
            (self.base / 'state/controls-update.json').unlink()
            with self.assertRaisesRegex(RuntimeError, '^RECOVERY_REQUIRED$'):
                ops.main()

    def seed_stack(self, **compose):
        stack = {name: patch.object(ops, name) for name in ['fenced', 'stop_owned_jobs', 'export_locked', 'ready',
                                                            'public_ready', 'maintenance']}
        started = {name: item.start() for name, item in stack.items()}
        for item in stack.values():
            self.addCleanup(item.stop)
        item = patch.object(ops, 'compose', **compose)
        started['compose'] = item.start()
        self.addCleanup(item.stop)
        return started

    def test_stage_seed_reopens_after_a_refused_transaction_and_keeps_the_login_stable(self):
        password = ops.stage_demo_password()
        self.assertEqual(ops.stage_demo_password(), password)
        self.assertEqual((self.base / 'private/stage-demo-login.env').stat().st_mode & 0o077, 0)
        mocks = self.seed_stack(side_effect=[RuntimeError('FIXED_SEED_REFUSED'), b''])
        with self.assertRaisesRegex(RuntimeError, '^FIXED_SEED_REFUSED$'):
            ops.stage_seed_locked(self.revision)
        mocks['export_locked'].assert_called_once()
        seed = mocks['compose'].call_args_list[0]
        self.assertEqual(seed.kwargs['data'], password)
        self.assertNotIn(password.decode(), ' '.join(seed.args[0]))
        mocks['stop_owned_jobs'].assert_called_once()
        mocks['ready'].assert_called_once()
        mocks['maintenance'].assert_called_once_with(False)

    def test_stage_seed_reopens_after_a_failed_export_without_seeding(self):
        mocks = self.seed_stack(return_value=b'')
        mocks['export_locked'].side_effect = RuntimeError('EXPORT_FAILED')
        with self.assertRaisesRegex(RuntimeError, '^EXPORT_FAILED$'):
            ops.stage_seed_locked(self.revision)
        self.assertEqual([call.args[0][0] for call in mocks['compose'].call_args_list], ['up'])
        mocks['maintenance'].assert_called_once_with(False)

    def test_stage_seed_stays_fenced_while_its_container_cannot_be_stopped(self):
        mocks = self.seed_stack(side_effect=[subprocess.TimeoutExpired('compose', 180)])
        mocks['stop_owned_jobs'].side_effect = RuntimeError('WORKER_DISCOVERY_DEADLINE')
        with self.assertRaisesRegex(RuntimeError, '^WORKER_DISCOVERY_DEADLINE$'):
            ops.stage_seed_locked(self.revision)
        mocks['maintenance'].assert_not_called()

    def test_stage_seed_returns_the_export_it_took(self):
        mocks = self.seed_stack(return_value=b'')
        mocks['export_locked'].return_value = 'fixed-export-id'
        self.assertEqual(ops.stage_seed_locked(self.revision), 'fixed-export-id')
        self.assertIn(f'{ops.PROJECT}-stage-seed', mocks['compose'].call_args_list[0].args[0])


if __name__ == '__main__':
    unittest.main()
