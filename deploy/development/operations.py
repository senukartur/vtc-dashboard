#!/usr/bin/python3
"""Root-owned fixed operations. Diagnostics deliberately omit commands and child output."""
import contextlib
import fcntl
import hashlib
import json
import os
import pathlib
import re
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
import uuid
import urllib.request

BASE = pathlib.Path('/opt/vtc-development')
MAX_IMAGE = 800 * 1024 * 1024
SHA = re.compile(r'^[a-f0-9]{40}$')
HASH = re.compile(r'^[a-f0-9]{64}$')
PROJECT = 'vtc-development'
READINESS_ATTEMPTS = 30


def require(condition, code):
    if not condition:
        raise RuntimeError(code)


def digest(path):
    with open(path, 'rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def run(args, *, revision=None, image_id=None, project=PROJECT, data=None, timeout=180, output=None):
    env = dict(os.environ, VTC_REVISION=revision or 'local')
    if image_id is not None:
        require(re.fullmatch(r'sha256:[a-f0-9]{64}', image_id), 'IMAGE_ID_INVALID')
        env['VTC_IMAGE_ID'] = image_id
    (BASE / 'state').mkdir(mode=0o700, exist_ok=True)
    error_file = BASE / 'state/last-child.stderr'
    # Private, overwritten diagnostic only; never returned through the receiver or CI report.
    with open(error_file, 'wb') as errors:
        os.chmod(error_file, 0o600)
        result = subprocess.run(args, cwd=BASE, env=env, input=data,
                                stdout=output or subprocess.PIPE, stderr=errors,
                                timeout=timeout, check=False)
    require(result.returncode == 0, 'OPERATION_CHILD_FAILED')
    return result.stdout


def accepted_image_id(revision):
    for name in ['current.json', 'previous.json']:
        path = BASE / 'state' / name
        if path.exists():
            release = json.loads(path.read_text())
            if release.get('revision') == revision:
                image_id = release.get('imageId', '')
                require(re.fullmatch(r'sha256:[a-f0-9]{64}', image_id), 'IMAGE_ID_INVALID')
                return image_id
    raise RuntimeError('ACCEPTED_IMAGE_REQUIRED')


def validate_image(image_id, revision):
    require(re.fullmatch(r'sha256:[a-f0-9]{64}', image_id), 'IMAGE_ID_INVALID')
    image = json.loads(run(['docker', 'image', 'inspect', image_id]))[0]
    require(image['Id'] == image_id and
            image['Config']['Labels'].get('org.opencontainers.image.revision') == revision and
            f'VTC_REVISION={revision}' in image['Config']['Env'], 'IMAGE_REVISION_MISMATCH')
    return image


def compose(args, *, revision, image_id=None, project=PROJECT, **kwargs):
    image_id = image_id or accepted_image_id(revision)
    return run(['docker', 'compose', '--project-name', project, '--file', str(BASE / 'compose.yaml'),
                *args], revision=revision, image_id=image_id, project=project, **kwargs)


@contextlib.contextmanager
def lock():
    (BASE / 'state').mkdir(mode=0o700, exist_ok=True)
    with open(BASE / 'state/operations.lock', 'a') as handle:
        # Also serializes cron, export and restore; waiting is bounded.
        deadline = time.monotonic() + 600
        while True:
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                require(time.monotonic() < deadline, 'OPERATIONS_BUSY')
                time.sleep(0.2)
        yield


def current():
    path = BASE / 'state/current.json'
    return json.loads(path.read_text()) if path.exists() else None


def atomic_json(path, value):
    temporary = path.with_suffix('.new')
    with open(temporary, 'w') as handle:
        handle.write(json.dumps(value))
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)
    directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def recovery_intent():
    path = BASE / 'state/recovery-required'
    with open(path, 'w') as handle:
        os.chmod(path, 0o600)
        handle.write('RECOVERY_REQUIRED\n')
        handle.flush()
        os.fsync(handle.fileno())
    directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def archive_safe(path, *, docker=False):
    # Inspect before Docker load or extraction. Never follow links or accept caller paths.
    with tarfile.open(path, 'r:') as archive:
        members = archive.getmembers()
        require(0 < len(members) <= 100000, 'ARCHIVE_LAYOUT_INVALID')
        names = set()
        total = 0
        for member in members:
            parts = pathlib.PurePosixPath(member.name).parts
            require(not member.name.startswith('/') and '..' not in parts and '\\' not in member.name,
                    'ARCHIVE_PATH_INVALID')
            require(member.isfile() or member.isdir(), 'ARCHIVE_TYPE_INVALID')
            normalized = str(pathlib.PurePosixPath(member.name))
            require(normalized not in names, 'ARCHIVE_DUPLICATE')
            names.add(normalized)
            total += member.size
            require(total <= MAX_IMAGE, 'ARCHIVE_TOO_LARGE')
        if docker:
            require('manifest.json' in names or 'index.json' in names, 'IMAGE_LAYOUT_INVALID')


def evidence_inventory(path):
    archive_safe(path)
    inventory = {}
    with tarfile.open(path, 'r:') as archive:
        for member in archive.getmembers():
            if member.isfile():
                name = str(pathlib.PurePosixPath(member.name))
                require(name not in inventory, 'EVIDENCE_DUPLICATE')
                inventory[name] = {'bytes': member.size,
                                   'sha256': hashlib.file_digest(archive.extractfile(member), 'sha256').hexdigest()}
    return inventory


def maintenance(enabled):
    marker = BASE / 'private/maintenance/enabled'
    if enabled:
        marker.touch(mode=0o600)
    else:
        marker.unlink(missing_ok=True)


def fenced(revision, image_id=None):
    maintenance(True)
    compose(['stop', 'app', 'probe'], revision=revision, image_id=image_id)


def synthetic_reference(revision, project=PROJECT, image_id=None):
    value = compose(['exec', '-T', 'db', 'mysql', '--defaults-extra-file=/run/secrets/export.cnf', '-N', '-B',
                     '-e', 'SELECT evidence_sha FROM vtc_operations.synthetic_reference WHERE singleton=1;'],
                    revision=revision, image_id=image_id, project=project).decode().strip()
    require(not value or HASH.fullmatch(value), 'SYNTHETIC_REFERENCE_INVALID')
    return value or None


def seed_synthetic_locked(revision):
    # Fixed fictional fixture in the operations schema; never a domain upload or production seed.
    fenced(revision)
    image_id = accepted_image_id(revision)
    content = b'fictional-vtc011-evidence-sentinel\n'
    checksum = hashlib.sha256(content).hexdigest()
    run(['docker', 'run', '--rm', '--network', 'none', '--read-only', '--user', '1000',
         '--mount', f'type=volume,source={PROJECT}_evidence,target=/app/private-evidence',
         image_id, 'node', '-e',
         "require('node:fs').writeFileSync('/app/private-evidence/vtc011-sentinel.txt','fictional-vtc011-evidence-sentinel\\n')"])
    compose(['exec', '-T', 'db', 'mysql', '--defaults-extra-file=/run/secrets/admin.cnf'],
            revision=revision, data=f"REPLACE INTO vtc_operations.synthetic_reference VALUES (1, '{checksum}');".encode())
    compose(['up', '-d', '--no-deps', 'app', 'probe'], revision=revision)
    ready(revision)
    public_ready(revision)
    maintenance(False)


def export_locked(revision):
    """Caller owns lock and stopped all application/probe writers; cron shares that lock."""
    identity = uuid.uuid4().hex
    directory = BASE / 'state/exports' / identity
    directory.mkdir(parents=True, mode=0o700)
    try:
        image_id = accepted_image_id(revision)
        validate_image(image_id, revision)
        with open(directory / 'database.sql', 'wb') as output:
            compose(['exec', '-T', 'db', 'mysqldump', '--defaults-extra-file=/run/secrets/export.cnf',
                     '--single-transaction', '--set-gtid-purged=OFF', '--no-tablespaces', '--hex-blob',
                     '--databases', 'vtc', 'vtc_operations'], revision=revision, output=output)
        with open(directory / 'evidence.tar', 'wb') as output:
            run(['docker', 'run', '--rm', '--network', 'none', '--read-only', '--user', '0',
                 '--mount', f'type=volume,source={PROJECT}_evidence,target=/evidence,readonly',
                 image_id, 'tar', '-C', '/evidence', '-cf', '-', '.'], output=output)
        archive_safe(directory / 'evidence.tar')
        reference = synthetic_reference(revision, PROJECT)
        inventory = evidence_inventory(directory / 'evidence.tar')
        if reference:
            require(inventory.get('vtc011-sentinel.txt', {}).get('sha256') == reference, 'SYNTHETIC_REFERENCE_MISMATCH')
        manifest = {'version': 1, 'revision': revision, 'imageId': image_id, 'createdUtc': int(time.time()),
                    'syntheticReference': reference,
                    'evidenceFiles': inventory,
                    'files': {name: {'sha256': digest(directory / name), 'bytes': (directory / name).stat().st_size}
                              for name in ['database.sql', 'evidence.tar']}}
        atomic_json(directory / 'manifest.json', manifest)
        return identity
    except BaseException:
        # Keep incomplete private output for diagnosis; it has no valid manifest.
        raise RuntimeError('EXPORT_FAILED') from None


def validate_export(identity):
    require(re.fullmatch(r'[a-f0-9]{32}', identity), 'EXPORT_ID_INVALID')
    directory = BASE / 'state/exports' / identity
    manifest = json.loads((directory / 'manifest.json').read_text())
    require(manifest.get('version') == 1 and SHA.fullmatch(manifest.get('revision', '')), 'EXPORT_INVALID')
    require(re.fullmatch(r'sha256:[a-f0-9]{64}', manifest.get('imageId', '')), 'EXPORT_IMAGE_INVALID')
    require(set(manifest.get('files', {})) == {'database.sql', 'evidence.tar'}, 'EXPORT_INVALID')
    for name, expected in manifest['files'].items():
        path = directory / name
        require(path.is_file() and not path.is_symlink() and path.stat().st_size == expected['bytes']
                and digest(path) == expected['sha256'], 'EXPORT_CHECKSUM_INVALID')
    archive_safe(directory / 'evidence.tar')
    require(evidence_inventory(directory / 'evidence.tar') == manifest['evidenceFiles'], 'EVIDENCE_MANIFEST_INVALID')
    return directory, manifest


def restore_locked(identity):
    directory, manifest = validate_export(identity)  # Validate before touching any database.
    revision = manifest['revision']
    image_id = manifest['imageId']
    validate_image(image_id, revision)
    project = f'vtc-development-restore-{uuid.uuid4().hex[:12]}'
    active_revision = current()['revision'] if current() else revision
    # One small host cannot assume two MySQL instances fit. Fence and stop active SQL;
    # preserve its volume unchanged while testing a fresh isolated destination.
    fenced(active_revision)
    compose(['stop', 'db'], revision=active_revision)
    # This destination has new named volumes and its own internal network. Never switch active data.
    compose(['up', '-d', '--wait', 'db'], revision=revision, image_id=image_id, project=project, timeout=240)
    try:
        compose(['exec', '-T', 'db', 'mysql', '--defaults-extra-file=/run/secrets/admin.cnf'],
                revision=revision, image_id=image_id, project=project, data=(directory / 'database.sql').read_bytes())
        run(['docker', 'volume', 'create', f'{project}_evidence'])
        run(['docker', 'run', '--rm', '-i', '--network', 'none', '--read-only', '--user', '0',
             '--mount', f'type=volume,source={project}_evidence,target=/restore',
             image_id, 'tar', '-C', '/restore', '-xf', '-'],
            data=(directory / 'evidence.tar').read_bytes())
        # Existing migrator validates exact server baseline, immutable checksums and clean ledger;
        # a dirty ledger must fail. Applied migrations replay as no-ops.
        compose(['run', '--rm', '--no-deps', 'migrate'], revision=revision, image_id=image_id, project=project)
        require(synthetic_reference(revision, project, image_id) == manifest['syntheticReference'], 'RESTORED_REFERENCE_MISMATCH')
        with tempfile.NamedTemporaryFile() as restored:
            run(['docker', 'run', '--rm', '--network', 'none', '--read-only', '--user', '0',
                 '--mount', f'type=volume,source={project}_evidence,target=/evidence,readonly',
                 image_id, 'tar', '-C', '/evidence', '-cf', '-', '.'], output=restored)
            restored.flush()
            require(evidence_inventory(pathlib.Path(restored.name)) == manifest['evidenceFiles'],
                    'RESTORED_EVIDENCE_MISMATCH')
    finally:
        # Leave isolated volumes intact for private inspection; never delete active volumes.
        compose(['stop', 'db'], revision=revision, image_id=image_id, project=project)
    if not (BASE / 'state/recovery-required').exists():
        compose(['up', '-d', '--wait', 'db'], revision=active_revision, timeout=240)
        compose(['up', '-d', '--no-deps', 'app', 'probe'], revision=active_revision)
        ready(active_revision)
        public_ready(active_revision)
        maintenance(False)
    return project


def release_locked(path, revision, run_id, attempt, mode, expected_image_id):
    previous = current()
    high_water_file = BASE / 'state/high-water.json'
    high_water = json.loads(high_water_file.read_text()) if high_water_file.exists() else previous
    require(not (BASE / 'state/recovery-required').exists(), 'RECOVERY_REQUIRED')
    require(mode == 'manual' or not high_water or run_id > high_water['runId'] or
            (run_id == high_water['runId'] and attempt >= high_water['attempt']), 'STALE_AUTOMATIC_RELEASE')
    require(shutil.disk_usage(BASE).free > path.stat().st_size * 3 + 1024**3, 'DISK_CAPACITY_REQUIRED')
    archive_safe(path, docker=True)
    run(['docker', 'load', '--input', str(path)], timeout=240)
    loaded = json.loads(run(['docker', 'image', 'inspect', f'vtc-dashboard:{revision}']))[0]
    require(loaded['Id'] == expected_image_id, 'LOADED_IMAGE_ID_MISMATCH')
    image = validate_image(expected_image_id, revision)
    fenced(previous['revision'] if previous else revision, previous['imageId'] if previous else expected_image_id)
    compose(['up', '-d', '--wait', 'db'], revision=revision, image_id=expected_image_id, timeout=240)
    backup = export_locked(previous['revision']) if previous else None
    # Durable fail-closed intent survives even SIGKILL, SSH loss or host process death.
    # Remove only after complete promotion or verified zero-migration previous-image recovery.
    recovery_intent()
    try:
        migration_output = compose(['run', '--rm', '--name', f'{PROJECT}-migration', '--no-deps', 'migrate'], revision=revision, image_id=expected_image_id)
    except BaseException:
        # A disconnect/timeout does not prove server-side DDL cancellation. Preserve sticky ledger.
        (BASE / 'state/recovery-required').touch(mode=0o600)
        # Stop the fixed one-off migrator and server before another root recovery action.
        # Killing a Docker client alone does not stop its container or an in-flight DDL.
        saved = {number: signal.signal(number, signal.SIG_IGN) for number in [signal.SIGHUP, signal.SIGTERM, signal.SIGINT]}
        try:
            with contextlib.suppress(Exception):
                run(['docker', 'stop', '--time', '30', f'{PROJECT}-migration'], timeout=45)
            with contextlib.suppress(Exception):
                compose(['stop', '--timeout', '30', 'db'], revision=revision, image_id=expected_image_id, timeout=45)
        finally:
            for number, handler in saved.items():
                signal.signal(number, handler)
        raise RuntimeError('MIGRATION_RECOVERY_REQUIRED') from None
    compose(['up', '-d', '--no-deps', 'app', 'probe'], revision=revision, image_id=expected_image_id)
    try:
        ready(revision, expected_image_id)
        compose(['up', '-d', '--no-deps', 'proxy'], revision=revision, image_id=expected_image_id)
        public_ready(revision)
    except BaseException:
        fenced(revision, expected_image_id)
        # The packaged CLI's fixed applied=0 result proves no new schema work occurred.
        # Only that case supports automatic previous-image recovery.
        if previous and b'"applied":0' in migration_output:
            compose(['up', '-d', '--no-deps', 'app', 'probe'], revision=previous['revision'], image_id=previous['imageId'])
            ready(previous['revision'], previous['imageId'])
            public_ready(previous['revision'])
            (BASE / 'state/recovery-required').unlink()
            maintenance(False)
            raise RuntimeError('CANDIDATE_REJECTED_PREVIOUS_RESTORED') from None
        (BASE / 'state/recovery-required').touch(mode=0o600)
        raise RuntimeError('READINESS_RECOVERY_REQUIRED') from None
    if previous and previous['imageId'] != image['Id']:
        atomic_json(BASE / 'state/previous.json', previous)
    atomic_json(BASE / 'state/current.json', {'revision': revision, 'runId': run_id,
                                             'attempt': attempt, 'imageId': image['Id'], 'backup': backup})
    if not high_water or (run_id, attempt) > (high_water['runId'], high_water['attempt']):
        atomic_json(high_water_file, {'runId': run_id, 'attempt': attempt})
    (BASE / 'state/recovery-required').unlink()
    maintenance(False)


def public_ready(revision):
    proxy = dict(line.split('=', 1) for line in (BASE / 'private/proxy.env').read_text().splitlines())
    token = dict(line.split('=', 1) for line in (BASE / 'private/operator.env').read_text().splitlines())['OPERATOR_TOKEN']
    domain = proxy['STAGING_DOMAIN']
    require(re.fullmatch(r'[a-zA-Z0-9.-]+', domain), 'DOMAIN_INVALID')
    # Normal certificate verification is required; no insecure TLS bypass or raw output.
    request = urllib.request.Request(f'https://{domain}/_operations/release',
                                     headers={'Authorization': f'Bearer {token}'})
    for _ in range(30):
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                value = json.loads(response.read(4096))
            require(value.get('revision') == revision and value.get('database') == 'available', 'PUBLIC_IDENTITY_INVALID')
            readiness = urllib.request.Request(f'https://{domain}/_operations/readiness',
                                               headers={'Authorization': f'Bearer {token}'})
            with urllib.request.urlopen(readiness, timeout=5) as response:
                require(response.status == 200, 'PUBLIC_READINESS_FAILED')
            return
        except Exception:
            time.sleep(2)
    raise RuntimeError('PUBLIC_READINESS_FAILED')


def ready(revision, image_id=None):
    for _ in range(READINESS_ATTEMPTS):
        try:
            output = compose(['exec', '-T', 'app', 'node', '-e',
                              "fetch('http://127.0.0.1:3000/health/ready',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"], revision=revision, image_id=image_id, timeout=8)
            require(output is not None, 'READINESS_FAILED')
            return
        except RuntimeError:
            time.sleep(2)
    raise RuntimeError('READINESS_FAILED')


def receive():
    command = os.environ.get('SSH_ORIGINAL_COMMAND', '')
    match = re.fullmatch(r'release ([a-f0-9]{40}) ([a-f0-9]{64}) ([1-9][0-9]{0,9}) (sha256:[a-f0-9]{64}) ([1-9][0-9]{0,14}) ([1-9][0-9]{0,5}) (auto|manual)', command)
    require(match is not None, 'PROTOCOL_REJECTED')
    revision, checksum, length, image_id, run_id, attempt, mode = match.groups()
    length = int(length)
    require(length <= MAX_IMAGE, 'UPLOAD_TOO_LARGE')
    require(shutil.disk_usage(BASE).free > length + 1024**3, 'UPLOAD_DISK_CAPACITY_REQUIRED')
    # Timeout also bounds interrupted clients. Only this root-owned directory supplies paths.
    def interrupted(_number, _frame):
        raise RuntimeError('UPLOAD_INTERRUPTED')
    signal.signal(signal.SIGALRM, interrupted)
    signal.alarm(600)
    incoming = BASE / 'state/incoming'
    incoming.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.NamedTemporaryFile(dir=incoming, delete=False) as output:
        path = pathlib.Path(output.name)
        try:
            remaining = length
            while remaining:
                chunk = sys.stdin.buffer.read(min(1024 * 1024, remaining))
                require(chunk, 'UPLOAD_INTERRUPTED')
                output.write(chunk)
                remaining -= len(chunk)
            require(sys.stdin.buffer.read(1) == b'', 'UPLOAD_OVERLONG')
            output.flush()
            require(digest(path) == checksum, 'UPLOAD_CHECKSUM_INVALID')
            signal.alarm(0)  # Upload bound must never terminate an active migration/release.
            with lock():
                release_locked(path, revision, int(run_id), int(attempt), mode, image_id)
        finally:
            signal.alarm(0)
            path.unlink(missing_ok=True)
    print('Release: success')


def main():
    os.umask(0o077)
    require(os.geteuid() == 0, 'ROOT_OPERATOR_REQUIRED')
    require(BASE.is_dir() and BASE.stat().st_uid == 0 and not BASE.stat().st_mode & 0o022, 'INSTALLATION_INVALID')
    operation = sys.argv[1:]
    def interrupted(_number, _frame):
        raise RuntimeError('OPERATION_INTERRUPTED')
    for number in [signal.SIGHUP, signal.SIGTERM, signal.SIGINT]:
        signal.signal(number, interrupted)
    if operation == ['receive']:
        receive()
        return
    require(operation and operation[0] in ['heartbeat', 'export', 'restore', 'seed-synthetic'], 'OPERATION_REJECTED')
    with lock():
        active = current()
        require(active is not None, 'RELEASE_REQUIRED')
        revision = active['revision']
        require(not (BASE / 'state/recovery-required').exists() or operation[0] == 'restore', 'RECOVERY_REQUIRED')
        if operation == ['heartbeat']:
            require(not (BASE / 'private/maintenance/enabled').exists(), 'MAINTENANCE')
            compose(['run', '--rm', '--no-deps', 'heartbeat'], revision=revision, timeout=30)
            print('Heartbeat: success')
        elif operation == ['seed-synthetic']:
            seed_synthetic_locked(revision)
            print('Synthetic reference: success')
        elif operation == ['export']:
            fenced(revision)
            identity = export_locked(revision)
            # Resume only after a fully successful export and authenticated readiness.
            compose(['up', '-d', '--no-deps', 'app', 'probe'], revision=revision)
            ready(revision)
            maintenance(False)
            print(f'Export: success {identity}')
        elif len(operation) == 2 and operation[0] == 'restore':
            restore_locked(operation[1])
            print('Isolated restore: success')
        else:
            raise RuntimeError('OPERATION_REJECTED')


if __name__ == '__main__':
    try:
        main()
    except BaseException:
        print('Operation: failed; inspect private operator state', file=sys.stderr)
        sys.exit(1)
