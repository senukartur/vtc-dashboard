"""Failure-path feedback; real configuration, grants and durable flows run in rehearsal.py."""
import json
import pathlib
import tempfile
import unittest
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


if __name__ == '__main__':
    unittest.main()
