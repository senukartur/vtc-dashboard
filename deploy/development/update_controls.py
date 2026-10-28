"""Stage a reviewed control package; preserve a fenced, retryable multi-file update."""
import json
import os
import pathlib
import sys

import activation
import operations as o

FILES = sorted(activation.CONTROL_FILES)


def notifications_install(source, restore=False):
    """Bootstrap directly from reviewed source, including when installed controls predate this mode."""
    import notifications_acceptance as n
    o.require(os.geteuid() == 0 and o.BASE.is_dir() and o.BASE.stat().st_uid == 0 and
              not o.BASE.stat().st_mode & 0o022, 'INSTALLATION_INVALID')
    with o.lock():
        active = o.current()
        o.require(active is not None, 'RELEASE_REQUIRED')
        o.require(not any((o.BASE / f'state/{name}').exists() for name in
                         ['notifications-acceptance', 'identity-acceptance', 'jobs-acceptance',
                          'ingress-check.json', 'controls-update.json']), 'ACCEPTANCE_WINDOW')
        reviewed = n.private_json(o, o.BASE / 'private/notifications-controls-input.json')
        o.require(set(reviewed) == {'revision', 'imageId', 'candidate', 'previous', 'protected'} and
                  reviewed['revision'] == active['revision'] and reviewed['imageId'] == active['imageId'] and
                  set(reviewed['candidate']) == n.FILES and set(reviewed['previous']) == n.FILES and
                  reviewed['protected'] == n.hashes(o, n.PROTECTED), 'NOTIFICATIONS_CONTROL_REVIEW_REQUIRED')
        o.validate_image(active['imageId'], active['revision'])
        for name, checksum in reviewed['candidate'].items():
            o.require(source.is_dir() and not source.is_symlink() and source.stat().st_uid == 0 and
                      not source.stat().st_mode & 0o022 and o.digest(source / name) == checksum,
                      'NOTIFICATIONS_CONTROL_SOURCE_CHANGED')
            if name.endswith('.py'):
                compile((source / name).read_text(), name, 'exec')
        marker = o.BASE / 'state/notifications-controls-update.json'
        fence = o.BASE / 'state/recovery-required'
        stage, backup = [o.BASE / f'state/notifications-controls-{name}' for name in ['candidate', 'previous']]
        terminal = o.BASE / 'state/notifications-controls-last.json'
        if not marker.exists() and not fence.exists() and terminal.exists():
            retained = n.private_json(o, terminal)
            o.require(retained['reviewed'] == reviewed, 'NOTIFICATIONS_CONTROL_BINDING_CHANGED')
            selected = reviewed['previous'] if retained['phase'] == 'restored' else reviewed['candidate']
            o.require(all((checksum is None and not (o.BASE / name).exists()) or
                          (checksum is not None and o.digest(o.BASE / name) == checksum)
                          for name, checksum in selected.items()), 'NOTIFICATIONS_CONTROL_TARGET_CHANGED')
            if restore == (retained['phase'] == 'restored'):
                return
            o.atomic_json(marker, retained)
        if marker.exists():
            state = n.private_json(o, marker)
            o.require(state['reviewed'] == reviewed, 'NOTIFICATIONS_CONTROL_BINDING_CHANGED')
        elif fence.exists():
            state = n.private_json(o, fence)
            o.require(state.get('owner') == 'notifications-controls' and state.get('reviewed') == reviewed,
                      'NOTIFICATIONS_CONTROL_FENCE_FOREIGN')
            o.atomic_json(marker, state)
        else:
            o.require(not restore and not stage.exists() and not backup.exists(), 'NOTIFICATIONS_CONTROL_COLLISION')
            for name, checksum in reviewed['previous'].items():
                target = o.BASE / name
                o.require((checksum is None and not target.exists()) or
                          (checksum is not None and target.is_file() and not target.is_symlink() and
                           o.digest(target) == checksum), 'NOTIFICATIONS_OLD_CONTROLS_CHANGED')
            state = {'owner': 'notifications-controls', 'reviewed': reviewed, 'phase': 'preparing', 'prepared': False}
            # Old installed cron/release controls already honor this recovery path.
            o.atomic_json(fence, state)
            o.atomic_json(marker, state)
        if fence.exists():
            o.require(n.private_json(o, fence).get('owner') == 'notifications-controls', 'NOTIFICATIONS_CONTROL_FENCE_FOREIGN')
        else:
            o.atomic_json(fence, state)
        o.stop_owned_jobs(active['revision'], active['imageId'])
        for directory in [stage, backup]:
            directory.mkdir(mode=0o700, exist_ok=True)
            o.require(directory.is_dir() and not directory.is_symlink() and directory.stat().st_uid == 0 and
                      not directory.stat().st_mode & 0o077, 'NOTIFICATIONS_CONTROL_DIRECTORY_INVALID')
        if not state['prepared']:
            for name in sorted(n.FILES):
                activation.private_copy(source / name, stage / name)
                checksum = reviewed['previous'][name]
                if checksum is not None:
                    o.require(o.digest(o.BASE / name) == checksum, 'NOTIFICATIONS_OLD_CONTROLS_CHANGED')
                    activation.private_copy(o.BASE / name, backup / name)
            state['prepared'] = True
            o.atomic_json(marker, state)
        o.require(all(o.digest(stage / name) == checksum for name, checksum in reviewed['candidate'].items()) and
                  all(checksum is None or o.digest(backup / name) == checksum for name, checksum in reviewed['previous'].items()),
                  'NOTIFICATIONS_CONTROL_STAGE_CHANGED')
        state['phase'] = 'restoring' if restore else 'installing'
        o.atomic_json(marker, state)
        # Dependencies precede the dispatcher. No shared Compose/grants/configuration is applied.
        for name in sorted(n.FILES - {'operations.py'}) + ['operations.py']:
            checksum = reviewed['previous'][name] if restore else reviewed['candidate'][name]
            if checksum is None:
                target = o.BASE / name
                if target.exists():
                    o.require(o.digest(target) == reviewed['candidate'][name], 'NOTIFICATIONS_CONTROL_TARGET_CHANGED')
                    target.unlink()
            else:
                activation.private_copy((backup if restore else stage) / name, o.BASE / name)
                os.chmod(o.BASE / name, 0o644)
                o.require(o.digest(o.BASE / name) == checksum, 'NOTIFICATIONS_CONTROL_READBACK_FAILED')
        o.require(reviewed['protected'] == n.hashes(o, n.PROTECTED), 'NOTIFICATIONS_SHARED_STATE_CHANGED')
        state['phase'] = 'restored' if restore else 'installed'
        o.atomic_json(marker, state)
        o.require(n.private_json(o, fence).get('owner') == 'notifications-controls', 'NOTIFICATIONS_CONTROL_FENCE_FOREIGN')
        fence.unlink()
        # Retain exact old/new bytes and terminal receipt for a reviewed restoration.
        o.atomic_json(o.BASE / 'state/notifications-controls-last.json', state)
        marker.unlink()


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
        o.require(sys.argv[1:] in [[], ['--notifications-only'], ['--notifications-restore']], 'CONTROL_UPDATE_ARGUMENT_INVALID')
        if sys.argv[1:]:
            notifications_install(pathlib.Path(__file__).resolve().parent, sys.argv[1] == '--notifications-restore')
            print('Notification controls installed/restored and read back; shared activation unchanged.')
        else:
            install(pathlib.Path(__file__).resolve().parent)
            print('Controls staged and installed; activation validation/application required before resume.')
    except BaseException:
        print('Control update failed; retain private state and rerun the same reviewed source package.', file=sys.stderr)
        sys.exit(1)
