"""Creation-authority regressions; rehearsal additionally exercises real Docker collisions."""
import json
import pathlib
import re
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import identity_acceptance as acceptance
import operations as ops


class CreationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.base = pathlib.Path(self.temporary.name)
        (self.base / 'state').mkdir()
        self.directory = self.base / 'private/allocation'
        self.directory.mkdir(parents=True, mode=0o700)
        self.marker = self.base / 'state/creation-fixture.json'
        self.run_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
        self.image = 'sha256:' + 'b' * 64
        self.revision = 'c' * 40
        self.names = [f'{ops.PROJECT}-identity-aaaaaaaaaaaa4aaa-{role}'
                      for role in ['runtime', 'jobs', 'migrator']]
        self.objects, self.actions = {}, []
        self.sequence, self.race, self.interrupt_create = 0, None, False
        self.exit_code = 0
        self.write({'containers': {}})
        self.manager = acceptance.AcceptanceContainers(ops, self.revision, self.image,
            self.run_id, self.directory, self.names, self.read, self.write)
        self.patch = patch.object(ops, 'run', side_effect=self.docker)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.validation = patch.object(ops, 'validate_image')
        self.validation.start()
        self.addCleanup(self.validation.stop)

    def read(self):
        return json.loads(self.marker.read_text())

    def write(self, state):
        ops.atomic_json(self.marker, state)

    def fixture(self, name, label, running=True):
        self.sequence += 1
        identity = f'{self.sequence:064x}'
        self.objects[identity] = {'Id': identity, 'Name': '/' + name, 'Image': self.image,
            'Config': {'Labels': {'vtc.identity-acceptance': label}}, 'State': {'Running': running}}
        return identity

    def docker(self, args, **_kwargs):
        self.actions.append(args)
        command = args[1]
        if command == 'ps':
            selector = args[-1]
            result = [identity for identity, info in self.objects.items()
                      if (selector.startswith('name=') and
                          re.fullmatch(selector[5:], info['Name'])) or selector == f'id={identity}']
            return ('\n'.join(result) + ('\n' if result else '')).encode()
        if command == 'inspect':
            return json.dumps([self.objects[args[2]]]).encode()
        if command == 'create':
            name = args[args.index('--name') + 1]
            if self.race:
                self.fixture(name, self.race)
            if any(info['Name'] == '/' + name for info in self.objects.values()):
                raise RuntimeError('FIXED_CREATE_NAME_REJECTED')
            identity = self.fixture(name, self.run_id, running=False)
            if self.interrupt_create:
                raise subprocess.TimeoutExpired('synthetic-create', 30)
            pathlib.Path(args[args.index('--cidfile') + 1]).write_text(identity)
            return (identity + '\n').encode()
        if command == 'start':
            identity = args[2]
            name = self.objects[identity]['Name'][1:]
            record = self.read()['containers'][name]
            self.assertEqual((record['phase'], record['id']), ('created', identity))
            self.objects[identity]['State']['Running'] = True
            return (identity + '\n').encode()
        if command == 'wait':
            self.objects[args[2]]['State']['Running'] = False
            return f'{self.exit_code}\n'.encode()
        if command == 'logs':
            return b'{"event":"synthetic_result"}\n'
        if command == 'rm':
            self.assertRegex(args[-1], r'^[a-f0-9]{64}$')
            self.objects.pop(args[-1])
            return (args[-1] + '\n').encode()
        raise AssertionError('UNEXPECTED_DOCKER_COMMAND')

    def test_prepare_refuses_each_same_run_and_wrong_run_name_before_allocation(self):
        with patch.object(ops, 'BASE', self.base):
            for name in self.names:
                for label in [self.run_id, 'different-fixture-run']:
                    with self.subTest(name=name, label=label):
                        self.objects.clear()
                        identity = self.fixture(name, label)
                        before = json.loads(json.dumps(self.objects))
                        with self.assertRaisesRegex(RuntimeError, '^ACCEPTANCE_CONTAINER_COLLISION$'):
                            acceptance.operation(ops, self.revision, self.image, 'prepare', self.run_id,
                                                 local_fixture=True)
                        self.assertEqual(self.objects, before)
                        self.assertTrue(self.objects[identity]['State']['Running'])
                        self.assertFalse((self.base / 'state/identity-acceptance').exists())
                        self.assertFalse(any(args[1] != 'ps' for args in self.actions))

    def test_create_races_never_enter_cleanup_for_any_role_or_matching_label(self):
        for role, name in zip(['runtime', 'jobs', 'migrator'], self.names):
            for label in [self.run_id, 'different-fixture-run']:
                with self.subTest(role=role, label=label):
                    self.objects.clear()
                    self.actions.clear()
                    self.write({'containers': {}})
                    self.race = label
                    with self.assertRaisesRegex(RuntimeError, '^FIXED_CREATE_NAME_REJECTED$'):
                        self.manager.run(['dist/synthetic.js'], role, name)
                    before = json.loads(json.dumps(self.objects))
                    self.assertEqual(len(before), 1)
                    self.assertTrue(next(iter(before.values()))['State']['Running'])
                    self.assertEqual(self.read()['containers'][name]['phase'], 'creating')
                    self.assertNotIn('id', self.read()['containers'][name])
                    with self.assertRaisesRegex(RuntimeError, '^ACCEPTANCE_CREATION_UNCERTAIN$'):
                        self.manager.stop(name)
                    self.assertEqual(self.objects, before)
                    self.assertFalse(any(args[1] in ['rm', 'start', 'wait'] for args in self.actions))

    def test_owned_lifecycle_commits_id_before_start_and_removes_only_that_id(self):
        for role, name in zip(['runtime', 'jobs', 'migrator'], self.names):
            self.assertEqual(self.manager.run(['dist/synthetic.js'], role, name),
                             {'event': 'synthetic_result'})
            record = self.read()['containers'][name]
            self.assertEqual(record['phase'], 'removed')
            self.assertEqual((self.directory / record['receipt']).read_text(), record['id'])
        self.assertFalse(self.objects)
        self.assertEqual(len([args for args in self.actions if args[1] == 'rm']), 3)

    def test_nonzero_container_exit_is_failure_with_owned_finally_cleanup(self):
        self.exit_code = 7
        with self.assertRaisesRegex(RuntimeError, '^ACCEPTANCE_CONTAINER_FAILED$'):
            self.manager.run(['dist/synthetic.js'], 'runtime', self.names[0])
        self.assertFalse(self.objects)
        self.assertEqual(self.read()['containers'][self.names[0]]['phase'], 'removed')

    def test_interrupted_create_without_receipt_retains_object_and_intent(self):
        self.interrupt_create = True
        with self.assertRaises(subprocess.TimeoutExpired):
            self.manager.run(['dist/synthetic.js'], 'migrator', self.names[2])
        before = json.loads(json.dumps(self.objects))
        self.assertFalse(next(iter(before.values()))['State']['Running'])
        with self.assertRaisesRegex(RuntimeError, '^ACCEPTANCE_CREATION_UNCERTAIN$'):
            self.manager.stop(self.names[2])
        self.assertEqual(self.objects, before)

    def test_interruption_before_id_commit_does_not_adopt_even_a_valid_cid_receipt(self):
        def interrupted_save(state):
            if any(value['phase'] == 'created' for value in state['containers'].values()):
                raise RuntimeError('FIXED_BEFORE_ID_COMMIT')
            self.write(state)
        self.manager.save = interrupted_save
        with self.assertRaisesRegex(RuntimeError, '^FIXED_BEFORE_ID_COMMIT$'):
            self.manager.run(['dist/synthetic.js'], 'migrator', self.names[2])
        before = json.loads(json.dumps(self.objects))
        self.assertEqual(self.read()['containers'][self.names[2]]['phase'], 'creating')
        self.assertTrue(list(self.directory.glob('*.cid')))
        with self.assertRaisesRegex(RuntimeError, '^ACCEPTANCE_CREATION_UNCERTAIN$'):
            self.manager.stop(self.names[2])
        self.assertEqual(self.objects, before)

    def test_interruption_after_durable_id_commit_allows_later_owned_cleanup(self):
        def interrupted_save(state):
            self.write(state)
            if any(value['phase'] == 'created' for value in state['containers'].values()):
                raise RuntimeError('FIXED_AFTER_ID_COMMIT')
        self.manager.save = interrupted_save
        with self.assertRaisesRegex(RuntimeError, '^FIXED_AFTER_ID_COMMIT$'):
            self.manager.run(['dist/synthetic.js'], 'migrator', self.names[2])
        self.assertTrue(self.objects)
        self.assertFalse(any(args[1] == 'start' for args in self.actions))
        self.manager.save = self.write
        self.manager.stop(self.names[2])
        self.assertFalse(self.objects)

    def test_replacement_with_same_run_label_cannot_inherit_old_creation_authority(self):
        def stop_after_start(args, **kwargs):
            if args[1] == 'wait':
                original = args[2]
                name = self.objects.pop(original)['Name'][1:]
                self.fixture(name, self.run_id)
                raise RuntimeError('FIXED_REPLACEMENT')
            return self.docker(args, **kwargs)
        with patch.object(ops, 'run', side_effect=stop_after_start):
            with self.assertRaisesRegex(RuntimeError, '^ACCEPTANCE_CONTAINER_UNRECORDED$'):
                self.manager.run(['dist/synthetic.js'], 'runtime', self.names[0])
        self.assertEqual(len(self.objects), 1)
        self.assertTrue(next(iter(self.objects.values()))['State']['Running'])
        self.assertFalse(any(args[1] == 'rm' for args in self.actions))


if __name__ == '__main__':
    unittest.main()
