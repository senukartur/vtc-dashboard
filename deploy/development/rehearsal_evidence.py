"""Read only fixed private rehearsal records from the acknowledged disposable volume."""
import json
import hashlib
import os
import pathlib
import stat
import sys

FILES = ('notifications-acceptance-evidence.json', 'notifications-acceptance-last.json',
         'rehearsal-core.json', 'rehearsal-window.json', 'rehearsal-recovery.json')
MAXIMUM = 1024 * 1024


def collect(root):
    files, digests, total = {}, {}, 0
    for name in FILES:
        path = root / 'state' / name
        try:
            info = path.lstat()
        except FileNotFoundError:
            continue
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077 or info.st_size > MAXIMUM:
            raise RuntimeError('REHEARSAL_EVIDENCE_FILE_INVALID')
        # No-follow open and readback protect against a replaced private record.
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(descriptor, 'rb') as handle:
            opened = os.fstat(handle.fileno())
            if (opened.st_dev, opened.st_ino, opened.st_size) != (info.st_dev, info.st_ino, info.st_size):
                raise RuntimeError('REHEARSAL_EVIDENCE_CHANGED')
            content = handle.read(MAXIMUM + 1)
        total += len(content)
        if total > MAXIMUM:
            raise RuntimeError('REHEARSAL_EVIDENCE_TOO_LARGE')
        value = json.loads(content)
        if not isinstance(value, dict):
            raise RuntimeError('REHEARSAL_EVIDENCE_SHAPE_INVALID')
        files[name] = value
        digests[name] = hashlib.sha256(content).hexdigest()
    try:
        (root / 'state/notifications-acceptance').lstat()
        fenced = True
    except FileNotFoundError:
        fenced = False
    return {'version': 1, 'files': files, 'digests': digests, 'windowFenced': fenced}


if __name__ == '__main__':
    try:
        if sys.argv[1:]:
            raise RuntimeError('REHEARSAL_EVIDENCE_ARGUMENT_INVALID')
        print(json.dumps(collect(pathlib.Path('/evidence'))))
    except BaseException:
        print('REHEARSAL_EVIDENCE_FAILED', file=sys.stderr)
        sys.exit(1)
