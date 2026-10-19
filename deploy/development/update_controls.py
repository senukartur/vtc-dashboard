"""Stage a reviewed control package; preserve a fenced, retryable multi-file update."""
import json
import os
import pathlib
import sys

import activation
import operations as o

FILES = sorted(activation.CONTROL_FILES)


def install(source):
    o.require(os.geteuid() == 0, 'ROOT_OPERATOR_REQUIRED')
    o.require(o.BASE.is_dir() and o.BASE.stat().st_uid == 0 and not o.BASE.stat().st_mode & 0o022,
              'INSTALLATION_INVALID')
    with o.lock():
        active = o.current()
        o.require(active is not None, 'RELEASE_REQUIRED')
        o.require(not any((o.BASE / f'state/{name}').exists() for name in
                  ['jobs-acceptance', 'identity-acceptance', 'ingress-check.json']), 'ACCEPTANCE_WINDOW')
        revision, image = active['revision'], active['imageId']
        o.validate_image(image, revision)
        activation.ingress(o)
        hashes = {name: o.digest(source / name) for name in FILES}
        for name in FILES:
            if name.endswith('.py'):
                compile((source / name).read_text(), name, 'exec')
        json.loads((source / 'activation-grants.json').read_text())
        marker = o.BASE / 'state/controls-update.json'
        recovery = o.BASE / 'state/recovery-required'
        backup = o.BASE / 'state/controls-previous'
        stage = o.BASE / 'state/controls-candidate'
        if not marker.exists() and recovery.exists():
            interrupted = json.loads(recovery.read_text())
            recovered = interrupted.get('state', {})
            o.require(interrupted.get('owner') == 'controls-update' and
                      recovered.get('revision') == revision and recovered.get('imageId') == image and
                      recovered.get('hashes') == hashes and recovered.get('pending') is True,
                      'CONTROL_UPDATE_OWNERSHIP_INVALID')
            o.atomic_json(marker, recovered)
        if marker.exists():
            state = json.loads(marker.read_text())
            o.require(state.get('pending') is True and state.get('revision') == revision and
                      state.get('imageId') == image and state.get('hashes') == hashes,
                      'CONTROL_UPDATE_OWNERSHIP_INVALID')
        else:
            o.require(not recovery.exists() and
                      not (o.BASE / 'private/maintenance/enabled').exists() and
                      not stage.exists() and not backup.exists(), 'CONTROL_UPDATE_FENCED')
            previous = {}
            for name in FILES:
                target = o.BASE / name
                if target.exists():
                    o.require(target.is_file() and not target.is_symlink(), 'CONTROL_FILE_INVALID')
                    previous[name] = o.digest(target)
            state = {'pending': True, 'complete': False, 'revision': revision,
                     'imageId': image, 'hashes': hashes, 'previous': previous, 'prepared': False}
            # Legacy controls already honor this path. Its self-contained ownership
            # record closes the crash window before the second state file is saved.
            o.atomic_json(recovery, {'owner': 'controls-update', 'state': state})
            o.atomic_json(marker, state)
        for directory in [stage, backup]:
            directory.mkdir(mode=0o700, exist_ok=True)
            o.require(directory.is_dir() and not directory.is_symlink() and
                      directory.stat().st_uid == 0 and not directory.stat().st_mode & 0o077,
                      'CONTROL_DIRECTORY_INVALID')
        if not state.get('prepared'):
            for name in FILES:
                target = o.BASE / name
                o.require((name not in state['previous'] and not target.exists()) or
                          (name in state['previous'] and o.digest(target) == state['previous'][name]),
                          'CONTROL_PREPARATION_CHANGED')
                activation.private_copy(source / name, stage / name)
                if name in state['previous']:
                    activation.private_copy(target, backup / name)
            state['prepared'] = True
            o.atomic_json(marker, state)
        o.require(all(o.digest(stage / name) == checksum for name, checksum in hashes.items()) and
                  all(o.digest(backup / name) == checksum for name, checksum in state['previous'].items()),
                  'CONTROL_BACKUP_CHANGED')
        o.jobs_configuration()
        # This parses private files without returning expanded configuration to stdout.
        o.run(['docker', 'compose', '--project-directory', str(o.BASE), '--env-file',
               str(o.BASE / 'private/ingress.env'), '--file', str(stage / 'compose.yaml'),
               'config', '--quiet'], revision=revision, image_id=image)
        o.fenced(revision, image)
        o.recovery_intent()
        for name in FILES:
            o.require(o.digest(stage / name) == hashes[name], 'CONTROL_STAGE_CHANGED')
            activation.private_copy(stage / name, o.BASE / name)
            os.chmod(o.BASE / name, 0o755 if name == 'receive.sh' else 0o644)
        state['complete'] = True
        o.atomic_json(marker, state)
        # activation apply consumes this exact owned fence; no mixed settings are resumed.


if __name__ == '__main__':
    try:
        o.require(len(sys.argv) == 1, 'CONTROL_UPDATE_ARGUMENT_INVALID')
        install(pathlib.Path(__file__).resolve().parent)
        print('Controls staged and installed; activation validation/application required before resume.')
    except BaseException:
        print('Control update failed; retain private state and rerun the same reviewed source package.', file=sys.stderr)
        sys.exit(1)
