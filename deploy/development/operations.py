#!/usr/bin/python3
"""Root-owned fixed operations. Diagnostics deliberately omit commands and child output."""
import contextlib
import fcntl
import hashlib
import json
import os
import pathlib
import re
import secrets
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import uuid
import urllib.request
import activation
import identity_acceptance
import notifications_acceptance
import ingress_probe

BASE = pathlib.Path('/opt/vtc-development')
MAX_IMAGE = 800 * 1024 * 1024
SHA = re.compile(r'^[a-f0-9]{40}$')
HASH = re.compile(r'^[a-f0-9]{64}$')
PROJECT = 'vtc-development'
READINESS_ATTEMPTS = 30
WORKER_CONTROL_TIMEOUT = 10


def require(condition, code):
    if not condition:
        raise RuntimeError(code)


def digest(path):
    with open(path, 'rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


DIAGNOSTIC_BYTES = 65536
MIGRATION_CODES = frozenset(['MIGRATION_EXECUTION_FAILED', 'MIGRATION_LOCK_UNAVAILABLE',
    'MIGRATION_BASELINE_MISMATCH', 'MIGRATION_HISTORY_DRIFT', 'MIGRATION_RECOVERY_REQUIRED',
    'INVALID_MIGRATION_ORDER', 'DATABASE_CONFIGURATION_MISSING', 'DATABASE_PORT_INVALID'])
NATIVE_CODES = frozenset(['PROTOCOL_SEQUENCE_TIMEOUT', 'ETIMEDOUT', 'ER_LOCK_WAIT_TIMEOUT',
    'ER_LOCK_DEADLOCK', 'ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'PROTOCOL_CONNECTION_LOST',
    'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'ER_CON_COUNT_ERROR',
    'ER_TOO_MANY_USER_CONNECTIONS', 'ER_ACCESS_DENIED_ERROR', 'ER_DBACCESS_DENIED_ERROR',
    'ER_BAD_DB_ERROR', 'ER_DUP_ENTRY', 'ER_NO_SUCH_TABLE', 'ER_TABLE_EXISTS_ERROR',
    'ER_NO_REFERENCED_ROW_2', 'ER_ROW_IS_REFERENCED_2'])
DATABASE_OPERATIONS = frozenset(['connection_open', 'session_configuration', 'session_charset',
    'migration_lock', 'migration_baseline', 'migration_autocommit', 'migration_journal_create',
    'migration_history_read', 'migration_journal_insert', 'migration_statement', 'migration_journal_finalize'])


def migration_diagnostics(data):
    records = []
    if not isinstance(data, bytes):
        return records
    for line in data[-DIAGNOSTIC_BYTES:].splitlines()[-64:]:
        if len(line) > 4096:
            continue
        try:
            value = json.loads(line)
        except (ValueError, UnicodeError, RecursionError):
            continue
        if not isinstance(value, dict) or value.get('event') != 'database.migration_failed':
            continue
        code = value.get('code')
        record = {'code': code if isinstance(code, str) and code in MIGRATION_CODES else 'MIGRATION_EXECUTION_FAILED',
                  'nativeCodes': []}
        codes = value.get('nativeCodes')
        if isinstance(codes, list):
            for native in codes[:8]:
                if isinstance(native, str) and native in NATIVE_CODES and native not in record['nativeCodes']:
                    record['nativeCodes'].append(native)
        context = value.get('databaseOperation')
        if isinstance(context, dict) and isinstance(context.get('operation'), str) and context['operation'] in DATABASE_OPERATIONS:
            deadline, elapsed = context.get('wireDeadlineMs'), context.get('elapsedMs')
            if type(deadline) is int and 0 < deadline <= 9007199254740991 and type(elapsed) is int and 0 <= elapsed <= 9007199254740991:
                record['databaseOperation'] = {'operation': context['operation'], 'wireDeadlineMs': deadline, 'elapsedMs': elapsed}
        records.append(record)
        if len(records) == 8:
            break
    return records


def failed_child(outcome, started, timeout, error_file, stdout=b'', returncode=None):
    # Only bounded private tails are retained. Public diagnostics reconstruct fixed fields.
    streams = []
    with open(error_file, 'rb') as source:
        source.seek(0, os.SEEK_END)
        source.seek(max(0, source.tell() - DIAGNOSTIC_BYTES))
        streams.append(('stderr', source.read(DIAGNOSTIC_BYTES)))
    streams.append(('stdout', stdout[-DIAGNOSTIC_BYTES:] if isinstance(stdout, bytes) else b''))
    migrations = []
    for name, content in streams:
        path = BASE / f'state/last-failed-child.{name}'
        with open(path, 'wb') as target:
            os.chmod(path, 0o600)
            target.write(content)
        migrations.extend(migration_diagnostics(content))
    record = {'event': 'operation_child_failed', 'outcome': outcome,
              'exitCode': returncode if type(returncode) is int and returncode >= 0 else None,
              'signal': -returncode if type(returncode) is int and returncode < 0 else None,
              'elapsedMs': round((time.monotonic() - started) * 1000),
              'deadlineMs': round(timeout * 1000), 'migrations': migrations[:8]}
    atomic_json(BASE / 'state/last-failed-child.json', record)
    print(json.dumps(record), file=sys.stderr, flush=True)


def run(args, *, revision=None, image_id=None, project=PROJECT, data=None, timeout=180, output=None):
    env = dict(os.environ, VTC_REVISION=revision or 'local')
    if image_id is not None:
        require(re.fullmatch(r'sha256:[a-f0-9]{64}', image_id), 'IMAGE_ID_INVALID')
        env['VTC_IMAGE_ID'] = image_id
    (BASE / 'state').mkdir(mode=0o700, exist_ok=True)
    error_file = BASE / 'state/last-child.stderr'
    started = time.monotonic()
    with open(error_file, 'wb') as errors:
        os.chmod(error_file, 0o600)
        try:
            result = subprocess.run(args, cwd=BASE, env=env, input=data,
                                    stdout=output or subprocess.PIPE, stderr=errors,
                                    timeout=timeout, check=False)
        except (subprocess.TimeoutExpired, OSError) as error:
            errors.flush()
            failed_child('timeout' if isinstance(error, subprocess.TimeoutExpired) else 'spawn_error',
                         started, timeout, error_file, getattr(error, 'stdout', b''))
            raise
    if result.returncode != 0:
        failed_child('signal' if result.returncode < 0 else 'exit', started, timeout,
                     error_file, result.stdout, result.returncode)
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


def validate_image(image_id, revision, *, timeout=180):
    require(re.fullmatch(r'sha256:[a-f0-9]{64}', image_id), 'IMAGE_ID_INVALID')
    image = json.loads(run(['docker', 'image', 'inspect', image_id], timeout=timeout))[0]
    require(image['Id'] == image_id and
            image['Config']['Labels'].get('org.opencontainers.image.revision') == revision and
            f'VTC_REVISION={revision}' in image['Config']['Env'], 'IMAGE_REVISION_MISMATCH')
    return image


def compose(args, *, revision, image_id=None, project=PROJECT, **kwargs):
    image_id = image_id or accepted_image_id(revision)
    return run(['docker', 'compose', '--env-file', str(BASE / 'private/ingress.env'), '--project-name', project, '--file', str(BASE / 'compose.yaml'),
                *args], revision=revision, image_id=image_id, project=project, **kwargs)


@contextlib.contextmanager
def lock(wait_seconds=600):
    (BASE / 'state').mkdir(mode=0o700, exist_ok=True)
    with open(BASE / 'state/operations.lock', 'a') as handle:
        # Also serializes cron, export and restore; waiting is bounded.
        deadline = time.monotonic() + wait_seconds
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
    stop_owned_jobs(revision, image_id)
    compose(['stop', 'app', 'probe'], revision=revision, image_id=image_id)


def stop_owned_jobs(revision, image_id=None):
    """A Docker client timeout does not stop its container. Keep recovery fenced on failure."""
    try:
        names = {f'/{PROJECT}-{suffix}': service
                 for suffix, service in [('jobs', 'jobs'), ('jobs-acceptance-a', 'jobs'), ('jobs-acceptance-b', 'jobs'),
                                         ('heartbeat', 'heartbeat'), ('stage-seed', 'migrate')]}
        inventory = ['docker', 'ps', '-aq', '--no-trunc', '--filter',
                     'name=^/(' + '|'.join(re.escape(name[1:]) for name in names) + ')$']
        discovery_deadline = time.monotonic() + 2 * WORKER_CONTROL_TIMEOUT
        def discover(args):
            remaining = discovery_deadline - time.monotonic()
            require(remaining > 0, 'WORKER_DISCOVERY_DEADLINE')
            return run(args, timeout=min(WORKER_CONTROL_TIMEOUT, remaining))
        def inventory_ids():
            values = discover(inventory).decode().split()
            require(len(values) <= len(names) and len(set(values)) == len(values) and
                    all(re.fullmatch(r'[a-f0-9]{12,64}', identity) for identity in values),
                    'WORKER_INVENTORY_INVALID')
            return values
        ids = inventory_ids()
        while ids:
            try:
                inspection = discover(['docker', 'inspect', *ids])
            except RuntimeError as error:
                if error.args != ('OPERATION_CHILD_FAILED',):
                    raise
                survivors = inventory_ids()
                require(set(survivors).issubset(ids), 'WORKER_INVENTORY_CHANGED')
                if not survivors or set(survivors) == set(ids):
                    wait_owned_jobs_absent(inventory)
                    return
                # Only a strict subset of the original IDs can be inspected again.
                # At most four refreshes fit the five-name inventory, and every
                # discovery call shares the original twenty-second deadline.
                ids = survivors
                continue
            inspected = json.loads(inspection)
            require(len(inspected) == len(ids), 'WORKER_OWNERSHIP_INVALID')
            seen = set()
            for identity, info in zip(ids, inspected):
                labels = info['Config'].get('Labels') or {}
                require(info['Id'].startswith(identity) and info['Name'] in names and
                        info['Name'] not in seen and
                        labels.get('com.docker.compose.project') == PROJECT and
                        labels.get('com.docker.compose.service') == names[info['Name']],
                        'WORKER_OWNERSHIP_INVALID')
                seen.add(info['Name'])
            # Validate every name/project/service tuple before removing any container.
            # Stale accepted images must also be stoppable before migration/restore.
            try:
                run(['docker', 'rm', '-f', *[info['Id'] for info in inspected]], timeout=20)
            except (RuntimeError, subprocess.TimeoutExpired) as error:
                if isinstance(error, RuntimeError) and error.args != ('OPERATION_CHILD_FAILED',):
                    raise
                # Docker --rm and explicit removal can overlap. A failed client
                # is not completion: only the bounded absence proof may recover it.
                pass
            break
        wait_owned_jobs_absent(inventory)
    except BaseException:
        maintenance(True)
        recovery_intent()
        raise RuntimeError('WORKER_RECOVERY_REQUIRED') from None


def wait_owned_jobs_absent(inventory):
    """Observe removal without retrying deletion or adopting replacement containers."""
    deadline = time.monotonic() + WORKER_CONTROL_TIMEOUT
    while True:
        remaining = deadline - time.monotonic()
        require(remaining > 0, 'WORKER_STILL_PRESENT')
        if not run(inventory, timeout=min(WORKER_CONTROL_TIMEOUT, remaining)).strip():
            return
        remaining = deadline - time.monotonic()
        require(remaining > 0, 'WORKER_STILL_PRESENT')
        time.sleep(min(0.2, remaining))


def jobs_locked(revision, image_id):
    require(not (BASE / 'state/jobs-acceptance').exists(), 'ACCEPTANCE_WINDOW')
    require(not (BASE / 'state/identity-acceptance').exists(), 'ACCEPTANCE_WINDOW')
    require(not (BASE / 'state/notifications-acceptance').exists(), 'ACCEPTANCE_WINDOW')
    require(not (BASE / 'state/ingress-check.json').exists(), 'ACCEPTANCE_WINDOW')
    validate_image(image_id, revision, timeout=WORKER_CONTROL_TIMEOUT)
    stop_owned_jobs(revision, image_id)
    try:
        output = compose(['run', '--rm', '--name', f'{PROJECT}-jobs', '--no-deps', 'jobs'],
                         revision=revision, image_id=image_id, timeout=55)
        require(len(output) <= 32768, 'WORKER_RESULT_TOO_LARGE')
        # Safe fixed CLI JSON only; raw child diagnostics remain private.
        value = json.loads(output)
        require(value.get('event') == 'jobs_result', 'WORKER_RESULT_INVALID')
        atomic_json(BASE / 'state/jobs-last.json', {'revision': revision, 'imageId': image_id,
                    'completedUtc': int(time.time()), 'result': value})
    finally:
        stop_owned_jobs(revision, image_id)


def tick_locked(revision, image_id):
    """Attempt heartbeat first; report each step without crossing a new safety fence."""
    require(not (BASE / 'private/maintenance/enabled').exists(), 'MAINTENANCE')
    require(not (BASE / 'state/recovery-required').exists(), 'RECOVERY_REQUIRED')
    path = BASE / 'state/tick-last.json'
    value = {'revision': revision, 'imageId': image_id, 'attemptedUtc': int(time.time()),
             'status': 'running', 'steps': {name: {'status': 'not_attempted'}
                                           for name in ['validation', 'heartbeat', 'jobs']}}
    atomic_json(path, value)

    def safety_fenced():
        return ((BASE / 'private/maintenance/enabled').exists() or
                (BASE / 'state/recovery-required').exists())

    def attempt(name, operation):
        step = value['steps'][name]
        step.update(status='running', attemptedUtc=int(time.time()))
        atomic_json(path, value)
        started = time.monotonic()
        ordinary_failure = False
        try:
            operation()
            step['status'] = 'completed'
        except Exception as error:
            # Classify fixed outcomes only. Exception text may contain private child data.
            step['status'] = 'failed'
            if safety_fenced():
                step['category'] = 'safety_fence'
            elif isinstance(error, subprocess.TimeoutExpired):
                step['category'] = 'client_timeout'
                ordinary_failure = True
            elif isinstance(error, RuntimeError) and error.args == ('OPERATION_CHILD_FAILED',):
                step['category'] = 'client_failed'
                ordinary_failure = True
            else:
                step['category'] = 'control_failed'
        step['durationMs'] = max(0, int((time.monotonic() - started) * 1000))
        atomic_json(path, value)
        return step['status'] == 'completed' or ordinary_failure

    valid = attempt('validation', lambda: validate_image(image_id, revision,
                                                        timeout=WORKER_CONTROL_TIMEOUT))
    # A failed image check never authorizes a writer, even if its client failure is ordinary.
    if valid and value['steps']['validation']['status'] == 'completed':
        may_continue = attempt('heartbeat', lambda: heartbeat_locked(revision, image_id, timeout=30))
        if safety_fenced():
            value['steps']['jobs']['status'] = 'skipped_safety_fence'
        elif not may_continue:
            value['steps']['jobs']['status'] = 'skipped_control_failure'
        elif (BASE / 'state/notifications-acceptance').exists():
            attempt('jobs', lambda: notifications_acceptance.tick(sys.modules[__name__], revision, image_id))
        elif any((BASE / f'state/{name}').exists() for name in ['jobs-acceptance', 'identity-acceptance', 'ingress-check.json']):
            value['steps']['jobs']['status'] = 'skipped_acceptance_window'
        else:
            attempt('jobs', lambda: jobs_locked(revision, image_id))
    failed = any(step['status'] not in ['completed', 'skipped_acceptance_window']
                 for step in value['steps'].values())
    value['status'] = ('failed' if failed else 'completed_with_skips'
                       if value['steps']['jobs']['status'] == 'skipped_acceptance_window' else 'completed')
    value['finishedUtc'] = int(time.time())
    if not failed:
        value['completedUtc'] = value['finishedUtc']
    atomic_json(path, value)
    require(not failed, 'TICK_FAILED')


def heartbeat_locked(revision, image_id, timeout=30):
    stop_owned_jobs(revision, image_id)
    try:
        compose(['run', '--rm', '--name', f'{PROJECT}-heartbeat', '--no-deps', 'heartbeat'],
                revision=revision, image_id=image_id, timeout=timeout)
    finally:
        stop_owned_jobs(revision, image_id)


def jobs_configuration():
    shared = BASE / 'private/identity-mail.env'
    if not shared.exists():
        with open(shared, 'x') as handle:
            os.chmod(shared, 0o600)
            handle.write('IDENTITY_ENABLED=false\nMAIL_MODE=disabled\n')
    path = BASE / 'private/jobs.env'
    if path.exists():
        values = dict(line.split('=', 1) for line in path.read_text().splitlines())
        password = values.get('MYSQL_PASSWORD', '')
        require(re.fullmatch(r'[a-f0-9]{64}', password), 'WORKER_CONFIG_INVALID')
    else:
        password = secrets.token_hex(32)
        with open(path, 'x') as handle:
            os.chmod(path, 0o600)
            handle.write('MYSQL_HOST=db\nMYSQL_PORT=3306\nMYSQL_DATABASE=vtc\nMYSQL_USER=vtc_jobs\n'
                         + f'MYSQL_PASSWORD={password}\n')
    return password


def jobs_grants_locked(revision):
    """Explicit existing-installation update; never runs during ordinary startup/cron."""
    password = jobs_configuration()
    # No schema-wide writes, DDL, migration ledger or identity mutation grants.
    statement = f"CREATE USER IF NOT EXISTS 'vtc_jobs'@'%' IDENTIFIED BY '{password}';\n"
    for table, privileges in [('durable_jobs', 'SELECT,INSERT,UPDATE'),
                              ('job_effect_receipts', 'SELECT,INSERT'),
                              ('job_runner_leases', 'SELECT,INSERT,UPDATE,DELETE'),
                              ('outbox_events', 'SELECT,INSERT'),
                              ('mail_deliveries', 'SELECT,UPDATE'),
                              ('mail_commands', 'SELECT,DELETE'),
                              ('identity_company', 'SELECT'),
                              ('identity_memberships', 'SELECT'),
                              ('identity_users', 'SELECT'),
                              ('identity_challenges', 'SELECT')]:
        statement += f"GRANT {privileges} ON vtc.{table} TO 'vtc_jobs'@'%';\n"
    for role in ['runtime', 'jobs']:
        statement += f"GRANT INSERT,SELECT ON vtc.outbox_events TO 'vtc_{role}'@'%';\n"
    statement += "GRANT SELECT,INSERT,UPDATE ON vtc.durable_jobs TO 'vtc_runtime'@'%';\n"
    statement += "GRANT SELECT ON vtc.job_effect_receipts TO 'vtc_runtime'@'%';\n"
    statement += "GRANT SELECT,INSERT,UPDATE ON vtc.mail_deliveries TO 'vtc_runtime'@'%';\n"
    statement += "GRANT SELECT,INSERT,DELETE ON vtc.mail_commands TO 'vtc_runtime'@'%';\n"
    compose(['exec', '-T', 'db', 'mysql', '--defaults-extra-file=/run/secrets/admin.cnf'],
            revision=revision, data=statement.encode())


def jobs_acceptance_locked(revision, image_id, mode, run_id):
    require(re.fullmatch(r'[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}', run_id),
            'ACCEPTANCE_ID_INVALID')
    marker = BASE / 'state/jobs-acceptance'
    def sql(statement):
        return compose(['exec', '-T', 'db', 'mysql', '--defaults-extra-file=/run/secrets/admin.cnf', '--database=vtc'],
                       revision=revision, image_id=image_id, data=statement.encode())
    if mode == 'prepare':
        require(not marker.exists() or marker.read_text() == run_id, 'OTHER_ACCEPTANCE_ACTIVE')
        marker.write_text(run_id)
        os.chmod(marker, 0o600)
        sql("CREATE TABLE IF NOT EXISTS vtc.synthetic_job_counter (run_id BINARY(36) NOT NULL, sequence INT NOT NULL, stage INT NOT NULL, touches INT NOT NULL, PRIMARY KEY(run_id,sequence,stage)) ENGINE=InnoDB;\nGRANT SELECT,INSERT ON vtc.synthetic_job_counter TO 'vtc_jobs'@'%';")
        return
    require(marker.exists() and marker.read_text() == run_id, 'ACCEPTANCE_WINDOW_REQUIRED')
    if mode == 'cleanup':
        # Exact fixture run only. Domain/platform data and other fixture runs survive.
        sql(f"DELETE r FROM vtc.job_effect_receipts r JOIN vtc.durable_jobs j ON j.id=r.job_id WHERE j.consumer='acceptance.counter' AND j.reference->>'$.runId'='{run_id}';\nDELETE FROM vtc.durable_jobs WHERE consumer='acceptance.counter' AND reference->>'$.runId'='{run_id}';\nDELETE FROM vtc.synthetic_job_counter WHERE run_id='{run_id}';\nREVOKE SELECT,INSERT ON vtc.synthetic_job_counter FROM 'vtc_jobs'@'%';")
        marker.unlink()
        return
    require(mode in ['seed', 'seed-backlog', 'run', 'inspect', 'crash-claim', 'crash-effect', 'hang', 'contend'], 'ACCEPTANCE_MODE_INVALID')
    stop_owned_jobs(revision, image_id)
    def invoke(suffix, command):
        return compose(['run', '--rm', '--name', f'{PROJECT}-{suffix}', '--no-deps',
                        '-e', 'VTC_JOBS_ACCEPTANCE=synthetic-only', 'jobs', 'node',
                        'dist/jobs-acceptance.js', command, run_id], revision=revision,
                       image_id=image_id, timeout=55)
    try:
        if mode == 'contend':
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                futures = [pool.submit(invoke, f'jobs-acceptance-{suffix}', 'consume') for suffix in ['a', 'b']]
                for future in futures:
                    future.result()
        else:
            result = invoke('jobs-acceptance-a', mode)
            require(len(result) <= 32768, 'ACCEPTANCE_RESULT_TOO_LARGE')
            if mode == 'inspect':
                atomic_json(BASE / 'state/jobs-acceptance-last.json', json.loads(result))
    finally:
        stop_owned_jobs(revision, image_id)


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


def stage_demo_password():
    """Stable private fixture password; it reaches the container only on stdin, never argv or output."""
    path = BASE / 'private/stage-demo-login.env'
    if not path.exists():
        temporary = path.with_name(path.name + '.new')
        temporary.unlink(missing_ok=True)
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, 'w') as handle:
            handle.write(f'VTC_STAGE_DEMO_PASSWORD={secrets.token_urlsafe(24)}\n')
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    info = path.lstat()
    require(not path.is_symlink() and path.is_file() and info.st_uid == 0 and not info.st_mode & 0o077,
            'PRIVATE_CONFIGURATION_REQUIRED')
    key, _, value = path.read_text().strip().partition('=')
    require(key == 'VTC_STAGE_DEMO_PASSWORD' and len(value) >= 16, 'PRIVATE_CONFIGURATION_REQUIRED')
    return value.encode()


def stage_seed_locked(revision):
    """Synthetic fixture for this development host: consistent export first, then one transaction."""
    password = stage_demo_password()
    fenced(revision)
    try:
        identity = export_locked(revision)
        # The migrator is the only account with fixture DML; runtime grants stay narrow.
        compose(['run', '--rm', '--name', f'{PROJECT}-stage-seed', '--no-deps', '-T',
                 '-e', 'VTC_STAGE_SEED=synthetic-only', 'migrate', 'node', 'dist/stage-seed.js'],
                revision=revision, data=password, timeout=180)
    finally:
        # A client timeout does not stop the container: end it before service resumes beside it.
        stop_owned_jobs(revision)
        # A failed export or seed left the data unchanged, so service can resume.
        compose(['up', '-d', '--no-deps', 'app', 'probe'], revision=revision)
        ready(revision)
        public_ready(revision)
        maintenance(False)
    return identity


def stage_smoke_locked(revision, image_id):
    """Route check under the real runtime account. Not read-only: login and rate limits write."""
    validate_image(image_id, revision)
    return run(['docker', 'run', '--rm', '-i', '--network', f'{PROJECT}_database', '--read-only', '--cap-drop', 'ALL',
                '--security-opt', 'no-new-privileges:true', '--memory', '192m', '--tmpfs', '/tmp:size=16m,mode=1777',
                '--env-file', str(BASE / 'private/runtime.env'), '--env-file', str(BASE / 'private/identity-mail.env'),
                image_id, 'node', 'operations/stage-smoke.mjs'], revision=revision, image_id=image_id,
               data=stage_demo_password(), timeout=120)


def event_media_volume():
    """Whether the active project's event media volume exists. Only an exact, single name counts."""
    name = f'{PROJECT}_event-media'
    names = run(['docker', 'volume', 'ls', '-q', '--filter', f'name=^{name}$'], timeout=30).decode().split()
    require(names in ([], [name]), 'EVENT_MEDIA_VOLUME_INVENTORY_INVALID')
    return bool(names)


def media_archive(volume, image_id, output):
    # Promotion hard-links staged files, so store each name as its own regular file.
    run(['docker', 'run', '--rm', '--network', 'none', '--read-only', '--user', '0',
         '--mount', f'type=volume,source={volume},target=/event-media,readonly',
         image_id, 'tar', '--hard-dereference', '-C', '/event-media', '-cf', '-', '.'], output=output)


def export_locked(revision):
    """Caller owns lock and stopped all application/probe writers; cron shares that lock."""
    identity = uuid.uuid4().hex
    directory = BASE / 'state/exports' / identity
    directory.mkdir(parents=True, mode=0o700)
    try:
        image_id = accepted_image_id(revision)
        validate_image(image_id, revision)
        media = event_media_volume()
        # A configured media root without its volume would export without the uploads.
        require(media or not activation.module_flags(BASE / 'private/identity-mail.env').get(
            activation.EVENT_MEDIA_SETTING), 'EVENT_MEDIA_VOLUME_MISSING')
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
        files = ['database.sql', 'evidence.tar']
        if media:
            with open(directory / 'event-media.tar', 'wb') as output:
                media_archive(f'{PROJECT}_event-media', image_id, output)
            files.append('event-media.tar')
        manifest = {'version': 1, 'revision': revision, 'imageId': image_id, 'createdUtc': int(time.time()),
                    'syntheticReference': reference,
                    'evidenceFiles': inventory,
                    'files': {name: {'sha256': digest(directory / name), 'bytes': (directory / name).stat().st_size}
                              for name in files}}
        if media:
            manifest['eventMediaFiles'] = evidence_inventory(directory / 'event-media.tar')
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
    # Event media is optional, but its archive and its inventory always travel together.
    media = 'eventMediaFiles' in manifest
    require(set(manifest.get('files', {})) == {'database.sql', 'evidence.tar', *(['event-media.tar'] if media else [])},
            'EXPORT_INVALID')
    for name, expected in manifest['files'].items():
        path = directory / name
        require(path.is_file() and not path.is_symlink() and path.stat().st_size == expected['bytes']
                and digest(path) == expected['sha256'], 'EXPORT_CHECKSUM_INVALID')
    archive_safe(directory / 'evidence.tar')
    require(evidence_inventory(directory / 'evidence.tar') == manifest['evidenceFiles'], 'EVIDENCE_MANIFEST_INVALID')
    if media:
        require(evidence_inventory(directory / 'event-media.tar') == manifest['eventMediaFiles'],
                'EVENT_MEDIA_MANIFEST_INVALID')
    return directory, manifest


# The application refuses a media root that its own user does not own with mode 0700.
MEDIA_ROOT_CHECK = ("const f=require('node:fs'),p=process.argv[1],s=f.lstatSync(p);"
                    "if(!s.isDirectory()||s.uid!==process.getuid()||(s.mode&0o777)!==0o700)process.exit(1);"
                    "f.accessSync(p,f.constants.R_OK|f.constants.W_OK|f.constants.X_OK);"
                    "for(const n of f.readdirSync(p)){const x=p+'/'+n;if(!f.lstatSync(x).isFile())process.exit(1);"
                    "f.closeSync(f.openSync(x,'r'));}")


def restore_event_media(directory, manifest, project, revision, image_id):
    """Into the destination's own new volume; the active media volume is never mounted."""
    volume = f'{project}_event-media'
    require(project != PROJECT, 'RESTORE_DESTINATION_INVALID')
    run(['docker', 'volume', 'create', volume])
    run(['docker', 'run', '--rm', '-i', '--network', 'none', '--read-only', '--user', '0',
         '--mount', f'type=volume,source={volume},target=/restore',
         image_id, 'tar', '-C', '/restore', '-xf', '-'],
        data=(directory / 'event-media.tar').read_bytes())
    run(['docker', 'run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
         '--mount', f'type=volume,source={volume},target={activation.EVENT_MEDIA_ROOT}',
         image_id, 'node', '-e', MEDIA_ROOT_CHECK, activation.EVENT_MEDIA_ROOT],
        revision=revision, image_id=image_id)
    with tempfile.NamedTemporaryFile() as restored:
        media_archive(volume, image_id, restored)
        restored.flush()
        require(evidence_inventory(pathlib.Path(restored.name)) == manifest['eventMediaFiles'],
                'RESTORED_EVENT_MEDIA_MISMATCH')


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
        if 'eventMediaFiles' in manifest:
            restore_event_media(directory, manifest, project, revision, image_id)
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


HANDOFF_CONFIGURATION = ('admin.cnf', 'db.env', 'export.cnf', 'heartbeat.env', 'identity-mail.env',
                         'ingress.env', 'jobs.env', 'migrator.env', 'operator.env', 'probe.env',
                         'proxy.env', 'runtime.env')
HANDOFF_PHASES = ('prepared', 'exported', 'migrating', 'migrated', 'granted', 'verified', 'complete')
HANDOFF_MAX_RECORD = 262144  # Includes both exact histories, each capped at 1024 migrations.


def sealed_file(path, maximum, *, read=True):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as handle:
        info = os.fstat(handle.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and
                not info.st_mode & 0o077 and 0 < info.st_size <= maximum, 'HANDOFF_FILE_INVALID')
        return handle.read() if read else None


def handoff_configuration():
    result = {}
    for name in HANDOFF_CONFIGURATION:
        path = BASE / 'private' / name
        sealed_file(path, 16384)
        result[name] = digest(path)
    keys = {'MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD'}
    migrator = activation.private_values(sys.modules[__name__], BASE / 'private/migrator.env', keys)
    require(set(migrator) == keys and migrator['MYSQL_DATABASE'] == 'vtc' and
            migrator['MYSQL_HOST'] == 'db' and migrator['MYSQL_PORT'] == '3306' and
            migrator['MYSQL_USER'] == 'vtc_migrator', 'HANDOFF_MIGRATOR_CONFIGURATION_INVALID')
    return result


def handoff_controls(state, *, settled=False):
    require(state.get('pending') is (not settled) and state.get('complete') is True and
            state.get('prepared') is True and set(state.get('hashes', {})) == activation.CONTROL_FILES and
            set(state.get('previous', {})).issubset(activation.CONTROL_FILES), 'HANDOFF_CONTROLS_INVALID')
    for directory, hashes in [(BASE, state['hashes']),
                              (BASE / 'state/controls-candidate', state['hashes']),
                              (BASE / 'state/controls-previous', state['previous'])]:
        require(directory.is_dir() and not directory.is_symlink() and directory.stat().st_uid == 0 and
                not directory.stat().st_mode & (0o022 if directory == BASE else 0o077),
                'HANDOFF_CONTROLS_INVALID')
        for name, checksum in hashes.items():
            path = directory / name
            require(isinstance(checksum, str) and HASH.fullmatch(checksum) and path.is_file() and
                    not path.is_symlink() and path.stat().st_uid == 0 and
                    not path.stat().st_mode & 0o022 and digest(path) == checksum,
                    'HANDOFF_CONTROLS_CHANGED')


def handoff_history(revision, image_id):
    # The same connection holds the runner's named lock throughout the ledger read.
    # A dead Docker client/absent container alone does not prove DDL has stopped.
    name = 'vtc:migrate:' + hashlib.sha256(b'vtc').hexdigest()[:48]
    query = (f"SELECT GET_LOCK('{name}',5);\n"
             "SELECT version,CONVERT(hash USING ascii),state FROM vtc._vtc_migrations "
             f"WHERE IS_USED_LOCK('{name}')=CONNECTION_ID() ORDER BY version;\n"
             f"SELECT RELEASE_LOCK('{name}');\n")
    lines = compose(['exec', '-T', 'db', 'mysql', '--defaults-extra-file=/run/secrets/admin.cnf',
                     '-N', '-B'], revision=revision, image_id=image_id, data=query.encode(), timeout=15).decode().splitlines()
    require(len(lines) >= 2 and lines[0] == '1' and lines[-1] == '1', 'HANDOFF_MIGRATION_LOCK_REQUIRED')
    return [line.split('\t') for line in lines[1:-1]]


def handoff_migrator_absent(intent):
    name = f'{PROJECT}-handoff-{intent["id"]}'
    def inventory(selector):
        ids = run(['docker', 'ps', '-aq', '--no-trunc', '--filter', selector], timeout=10).decode().split()
        require(len(ids) <= 1 and all(re.fullmatch('[a-f0-9]{64}', value) for value in ids),
                'HANDOFF_MIGRATOR_INVALID')
        return ids
    named = inventory(f'name=^/{name}$')
    record = intent.get('migrator')
    if record is None:
        require(not named, 'HANDOFF_MIGRATOR_UNOWNED')
        return
    require(record.get('phase') in ['created', 'removed'] and
            re.fullmatch('[a-f0-9]{64}', record.get('id', '')) and
            re.fullmatch('[a-f0-9]{32}', record.get('attempt', '')), 'HANDOFF_MIGRATOR_UNCERTAIN')
    identity = record['id']
    path = BASE / f'state/handoff-{intent["id"]}-{record["attempt"]}.cid'
    require(sealed_file(path, 128).decode().strip() == identity, 'HANDOFF_MIGRATOR_RECEIPT_INVALID')
    by_id = inventory(f'id={identity}')
    require(not named or named == [identity], 'HANDOFF_MIGRATOR_UNOWNED')
    if by_id:
        require(named == [identity] and record['phase'] == 'created', 'HANDOFF_MIGRATOR_UNOWNED')
        info = json.loads(run(['docker', 'inspect', identity], timeout=10))[0]
        labels = info['Config'].get('Labels') or {}
        require(info['Id'] == identity and info['Name'] == '/' + name and
                info['Image'] == intent['binding']['target']['imageId'] and
                labels.get('vtc.release-handoff') == intent['id'] and
                labels.get('com.docker.compose.project') == PROJECT and
                labels.get('com.docker.compose.service') == 'migrate', 'HANDOFF_MIGRATOR_UNOWNED')
        if info['State']['Running']:
            run(['docker', 'stop', '--time', '30', identity], timeout=40)
        run(['docker', 'rm', identity], timeout=10)
    require(not inventory(f'id={identity}') and not inventory(f'name=^/{name}$'), 'HANDOFF_MIGRATOR_REMAINS')
    record['phase'] = 'removed'
    atomic_json(BASE / 'state/release-handoff.json', intent)


def handoff_migrate(intent, expected_count):
    target = intent['binding']['target']
    attempt = uuid.uuid4().hex
    path = BASE / f'state/handoff-{intent["id"]}-{attempt}.cid'
    intent['migrator'] = {'phase': 'creating', 'attempt': attempt}
    atomic_json(BASE / 'state/release-handoff.json', intent)
    # Create is separate from start: the committed CID receipt grants execution authority.
    identity = run(['docker', 'create', '--name', f'{PROJECT}-handoff-{intent["id"]}',
                    '--cidfile', str(path), '--label', f'vtc.release-handoff={intent["id"]}',
                    '--label', f'com.docker.compose.project={PROJECT}',
                    '--label', 'com.docker.compose.service=migrate',
                    '--label', f'vtc011.rehearsal={PROJECT}',
                    '--network', f'{PROJECT}_database', '--init', '--read-only', '--cap-drop', 'ALL',
                    '--security-opt', 'no-new-privileges:true', '--memory', '192m', '--pids-limit', '32',
                    '--env-file', str(BASE / 'private/migrator.env'), target['imageId'],
                    'node', 'node_modules/@vtc/db/dist/migrate-cli.js'], timeout=30).decode().strip()
    require(re.fullmatch('[a-f0-9]{64}', identity) and sealed_file(path, 128).decode().strip() == identity,
            'HANDOFF_MIGRATOR_RECEIPT_INVALID')
    # Docker writes the receipt; flush both it and its parent before recording authority.
    with open(path, 'rb') as handle:
        os.fsync(handle.fileno())
    sync_directory(path.parent)
    intent['migrator'].update(phase='created', id=identity)
    atomic_json(BASE / 'state/release-handoff.json', intent)
    run(['docker', 'start', identity], timeout=10)
    status = run(['docker', 'wait', identity], timeout=180).decode().strip()
    output = run(['docker', 'logs', identity], timeout=10)
    require(status == '0' and len(output) <= 32768, 'HANDOFF_MIGRATION_FAILED')
    receipts = []
    for line in output.splitlines():
        try:
            value = json.loads(line)
        except (ValueError, UnicodeError):
            continue
        if isinstance(value, dict) and value.get('event') == 'database.migrated':
            require(type(value.get('applied')) is int, 'HANDOFF_MIGRATION_ACK_INVALID')
            receipts.append(value)
    require(receipts == [{'event': 'database.migrated', 'applied': expected_count}],
            'HANDOFF_MIGRATION_ACK_INVALID')
    handoff_migrator_absent(intent)


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def handoff_metadata(intent):
    before, target = intent['binding']['previous'], intent['binding']['target']
    accepted = {key: target[key] for key in ['revision', 'imageId', 'runId', 'attempt']}
    accepted['backup'] = intent.get('backup')
    old = intent['metadata']
    high_water = old['high-water.json'] or before
    high_water = {'runId': high_water['runId'], 'attempt': high_water['attempt']}
    promoted = {'current.json': accepted,
                'previous.json': before if before['imageId'] != target['imageId'] else old['previous.json'],
                'high-water.json': {'runId': target['runId'], 'attempt': target['attempt']}
                if (target['runId'], target['attempt']) >
                (high_water['runId'], high_water['attempt']) else high_water}
    actual = {name: json.loads((BASE / 'state' / name).read_text()) if (BASE / 'state' / name).exists()
              else None for name in old}
    # Only prefixes of the fixed publication order can be the result of an interrupted settlement.
    order = ['previous.json', 'current.json', 'high-water.json']
    permitted = [dict(old, **{name: promoted[name] for name in order[:count]}) for count in range(4)]
    allowed = [promoted] if intent['phase'] == 'complete' else permitted if intent['phase'] == 'verified' else [old]
    require(actual in allowed,
            'HANDOFF_METADATA_CHANGED')
    return promoted


def controls_release_locked(mode):
    require(mode in ['start', 'resume'], 'HANDOFF_MODE_INVALID')
    require(not any((BASE / f'state/{name}').exists() for name in
                    ['jobs-acceptance', 'identity-acceptance', 'notifications-acceptance', 'ingress-check.json']),
            'ACCEPTANCE_WINDOW')
    activation_intent = BASE / 'state/activation-intent.json'
    require(not activation_intent.exists() or json.loads(activation_intent.read_text()).get('pending') is not True,
            'ACTIVATION_PENDING')
    binding_path, archive = BASE / 'private/controls-release.json', BASE / 'state/incoming/controls-release.tar'
    binding = json.loads(sealed_file(binding_path, 16384))
    require(set(binding) == {'version', 'previous', 'target', 'controlsHash', 'configuration'} and
            type(binding['version']) is int and binding['version'] == 1, 'HANDOFF_BINDING_INVALID')
    target = binding['target']
    require(isinstance(target, dict) and set(target) == {'revision', 'imageId', 'sha256', 'bytes', 'runId', 'attempt', 'mode'} and
            isinstance(target['revision'], str) and SHA.fullmatch(target['revision']) and
            isinstance(target['imageId'], str) and re.fullmatch('sha256:[a-f0-9]{64}', target['imageId']) and
            isinstance(target['sha256'], str) and HASH.fullmatch(target['sha256']) and
            type(target['bytes']) is int and 0 < target['bytes'] <= MAX_IMAGE and
            type(target['runId']) is int and 0 < target['runId'] < 10**15 and
            type(target['attempt']) is int and 0 < target['attempt'] < 10**6 and
            target['mode'] in ['auto', 'manual'], 'HANDOFF_BINDING_INVALID')
    require(binding['configuration'] == handoff_configuration(), 'HANDOFF_CONFIGURATION_CHANGED')
    sealed_file(archive, MAX_IMAGE, read=False)
    require(archive.stat().st_size == target['bytes'] and digest(archive) == target['sha256'],
            'HANDOFF_ARTIFACT_CHANGED')
    marker = BASE / 'state/controls-update.json'
    controls = json.loads(sealed_file(marker, 65536))
    intent_path, recovery = BASE / 'state/release-handoff.json', BASE / 'state/recovery-required'
    if mode == 'start':
        retained = json.loads(sealed_file(intent_path, HANDOFF_MAX_RECORD)) if intent_path.exists() else None
        require(retained is None or (retained.get('phase') == 'complete' and
                retained.get('pending') is False), 'HANDOFF_ALREADY_RECORDED')
        require(digest(marker) == binding['controlsHash'] and current() == binding['previous'] and
                controls.get('revision') == binding['previous']['revision'] and
                controls.get('imageId') == binding['previous']['imageId'], 'HANDOFF_PREVIOUS_CHANGED')
        handoff_controls(controls)
        require(json.loads(sealed_file(recovery, 65536)) == {'owner': 'controls-update', 'state': controls},
                'HANDOFF_RECOVERY_UNOWNED')
        previous = binding['previous']
        validate_image(previous['imageId'], previous['revision'])
        original = activation.packaged_history(sys.modules[__name__], previous['imageId'])
        require(original and handoff_history(previous['revision'], previous['imageId']) == original,
                'HANDOFF_PREVIOUS_HISTORY_INVALID')
        high = BASE / 'state/high-water.json'
        high_water = json.loads(high.read_text()) if high.exists() else previous
        require(target['mode'] == 'manual' or (target['runId'], target['attempt']) >=
                (high_water['runId'], high_water['attempt']), 'STALE_AUTOMATIC_RELEASE')
        require(shutil.disk_usage(BASE).free > target['bytes'] * 3 + 1024**3, 'DISK_CAPACITY_REQUIRED')
        archive_safe(archive, docker=True)
        run(['docker', 'load', '--input', str(archive)], timeout=240)
        loaded = json.loads(run(['docker', 'image', 'inspect', f'vtc-dashboard:{target["revision"]}']))[0]
        require(loaded['Id'] == target['imageId'], 'LOADED_IMAGE_ID_MISMATCH')
        validate_image(target['imageId'], target['revision'])
        expected = activation.packaged_history(sys.modules[__name__], target['imageId'])
        require(len(original) <= len(expected) <= 1024 and expected[:len(original)] == original,
                'HANDOFF_TARGET_HISTORY_INVALID')
        intent = {'version': 1, 'id': uuid.uuid4().hex, 'pending': True, 'phase': 'prepared',
                  'schemaAdvanced': False, 'binding': binding, 'bindingHash': digest(binding_path),
                  'controls': controls, 'original': original, 'expected': expected,
                  'metadata': {name: json.loads((BASE / 'state' / name).read_text())
                               if (BASE / 'state' / name).exists() else None
                               for name in ['current.json', 'previous.json', 'high-water.json']}}
        if retained is not None:
            archived = BASE / f'state/release-handoff-{retained["id"]}.json'
            require(not archived.exists(), 'HANDOFF_ARCHIVE_COLLISION')
            os.replace(intent_path, archived)
            sync_directory(intent_path.parent)
        atomic_json(intent_path, intent)
    else:
        intent = json.loads(sealed_file(intent_path, HANDOFF_MAX_RECORD))
        require(intent.get('version') == 1 and re.fullmatch('[a-f0-9]{32}', intent.get('id', '')) and
                intent.get('phase') in HANDOFF_PHASES and intent.get('binding') == binding and
                intent.get('bindingHash') == digest(binding_path), 'HANDOFF_TARGET_CHANGED')
        require(controls in [intent['controls'], dict(intent['controls'], pending=False)] and
                (controls['pending'] is True or intent['phase'] in ['verified', 'complete']) and
                (intent['phase'] != 'complete' or controls['pending'] is False),
                'HANDOFF_CONTROLS_CHANGED')
        handoff_controls(controls, settled=controls['pending'] is False)
        validate_image(target['imageId'], target['revision'])
        require(activation.packaged_history(sys.modules[__name__], target['imageId']) == intent['expected'],
                'HANDOFF_TARGET_HISTORY_INVALID')
    owner = {'owner': 'controls-release', 'id': intent['id'], 'bindingHash': intent['bindingHash']}
    observed = json.loads(sealed_file(recovery, 65536)) if recovery.exists() else None
    require(observed == owner or (intent['phase'] == 'prepared' and observed ==
            {'owner': 'controls-update', 'state': intent['controls']}) or
            (intent['phase'] == 'complete' and observed is None), 'HANDOFF_RECOVERY_UNOWNED')
    handoff_metadata(intent)
    atomic_json(recovery, owner)
    revision, image_id = target['revision'], target['imageId']
    try:
        fenced(revision, image_id)
        handoff_migrator_absent(intent)
        history = handoff_history(revision, image_id)
        original, expected = intent['original'], intent['expected']
        old = history == original
        full = history == expected
        require((old and not intent['schemaAdvanced'] and intent['phase'] in ['prepared', 'exported', 'migrating']) or
                (full and intent['phase'] in ['migrating', 'migrated', 'granted', 'verified', 'complete']),
                'HANDOFF_MIGRATION_RECOVERY_REQUIRED')
        if full and original != expected and not intent['schemaAdvanced']:
            intent['schemaAdvanced'] = True
            atomic_json(intent_path, intent)
        if intent['phase'] == 'prepared':
            backup = export_locked(binding['previous']['revision'])
            directory, _ = validate_export(backup)
            intent.update(backup=backup, backupHash=digest(directory / 'manifest.json'), phase='exported')
            atomic_json(intent_path, intent)
        directory, manifest = validate_export(intent['backup'])
        require(digest(directory / 'manifest.json') == intent['backupHash'] and
                manifest['revision'] == binding['previous']['revision'] and
                manifest['imageId'] == binding['previous']['imageId'], 'HANDOFF_BACKUP_CHANGED')
        if intent['phase'] in ['exported', 'migrating']:
            intent['phase'] = 'migrating'
            atomic_json(intent_path, intent)
            handoff_migrate(intent, len(expected) - len(original) if old else 0)
            require(handoff_history(revision, image_id) == expected, 'HANDOFF_MIGRATION_RECOVERY_REQUIRED')
            intent.update(phase='migrated', schemaAdvanced=original != expected)
            atomic_json(intent_path, intent)
        require(handoff_configuration() == binding['configuration'], 'HANDOFF_CONFIGURATION_CHANGED')
        activation.validate(sys.modules[__name__], revision, image_id, BASE / 'private/identity-mail.env')
        # Admin SQL uses the existing database container; accepted metadata remains old.
        # Compose configuration and both grant profiles are already hash-bound to this handoff.
        values = activation.module_flags(BASE / 'private/identity-mail.env')
        activation.grants(sys.modules[__name__], binding['previous']['revision'], values)
        activation.check_privileges(sys.modules[__name__], activation.privileges(sys.modules[__name__],
                                    binding['previous']['revision']), complete=True, values=values)
        require(handoff_configuration() == binding['configuration'] and digest(binding_path) == intent['bindingHash'],
                'HANDOFF_CONFIGURATION_CHANGED')
        handoff_controls(controls, settled=controls['pending'] is False)
        if intent['phase'] not in ['verified', 'complete']:
            intent['phase'] = 'granted'
            atomic_json(intent_path, intent)
        compose(['up', '-d', '--no-deps', 'app', 'probe'], revision=revision, image_id=image_id)
        ready(revision, image_id)
        compose(['up', '-d', '--no-deps', 'proxy'], revision=revision, image_id=image_id)
        public_ready(revision)
        require(json.loads(sealed_file(marker, 65536)) == controls and
                digest(binding_path) == intent['bindingHash'], 'HANDOFF_CONTROLS_CHANGED')
        handoff_controls(controls, settled=controls['pending'] is False)
        if intent['phase'] != 'complete':
            intent['phase'] = 'verified'
            atomic_json(intent_path, intent)
        promoted = handoff_metadata(intent)
        for name in ['previous.json', 'current.json', 'high-water.json']:
            if promoted[name] is not None:
                atomic_json(BASE / 'state' / name, promoted[name])
        require(handoff_configuration() == binding['configuration'], 'HANDOFF_CONFIGURATION_CHANGED')
        atomic_json(marker, dict(intent['controls'], pending=False))
        intent.update(phase='complete', pending=False)
        atomic_json(intent_path, intent)
        recovery.unlink(missing_ok=True)
        sync_directory(recovery.parent)
        maintenance(False)
        sync_directory(BASE / 'private/maintenance')
    except BaseException:
        # Never roll back to the old image, even if a resumed migrator returned applied:0.
        with contextlib.suppress(Exception):
            fenced(revision, image_id)
        # Worker cleanup deliberately sets a generic safety marker on failure. Retain
        # this already-established owner under the operations lock, rather than losing it.
        if not recovery.exists() or recovery.read_text().strip() == 'RECOVERY_REQUIRED':
            atomic_json(recovery, owner)
        raise


def release_locked(path, revision, run_id, attempt, mode, expected_image_id):
    require(not any((BASE / f'state/{name}').exists() for name in
                    ['jobs-acceptance', 'identity-acceptance', 'notifications-acceptance', 'ingress-check.json']), 'ACCEPTANCE_WINDOW')
    for name in ['activation-intent.json', 'controls-update.json', 'release-handoff.json']:
        control = BASE / 'state' / name
        require(not control.exists() or json.loads(control.read_text()).get('pending') is not True,
                'ACTIVATION_PENDING')
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
    if len(operation) == 2 and operation[0] == 'controls-release':
        with lock():
            controls_release_locked(operation[1])
        print('Controls release: success')
        return
    require(operation and operation[0] in ['tick', 'heartbeat', 'jobs', 'jobs-config', 'jobs-grants', 'jobs-acceptance', 'activation', 'identity-acceptance', 'notifications-acceptance', 'export', 'restore', 'seed-synthetic', 'stage-seed', 'stage-smoke'], 'OPERATION_REJECTED')
    with lock(wait_seconds=0 if operation[0] in ['tick', 'heartbeat', 'jobs'] else 600):
        active = current()
        require(active is not None, 'RELEASE_REQUIRED')
        revision = active['revision']
        require(not (BASE / 'state/recovery-required').exists() or operation[0] == 'restore' or
                operation in [['activation', 'recover'], ['activation', 'rollback']] or
                (operation in [['activation', 'prepare-stage'], ['activation', 'validate'], ['activation', 'apply']] and
                 activation.controls_pending(sys.modules[__name__], revision, active['imageId'])), 'RECOVERY_REQUIRED')
        require(not (BASE / 'state/notifications-acceptance').exists() or operation[0] in
                ['notifications-acceptance', 'tick', 'heartbeat'], 'ACCEPTANCE_WINDOW')
        require(not (BASE / 'state/identity-acceptance').exists() or operation[0] in
                ['identity-acceptance', 'tick', 'jobs', 'heartbeat'], 'ACCEPTANCE_WINDOW')
        require(not (BASE / 'state/ingress-check.json').exists() or operation[0] in
                ['tick', 'jobs', 'heartbeat'] or operation == ['activation', 'ingress-cleanup'],
                'ACCEPTANCE_WINDOW')
        if operation == ['tick']:
            tick_locked(revision, active['imageId'])
            print('Tick: success')
        elif operation == ['jobs']:
            require(not (BASE / 'private/maintenance/enabled').exists(), 'MAINTENANCE')
            jobs_locked(revision, active['imageId'])
            print('Jobs: success')
        elif operation == ['jobs-config']:
            jobs_configuration()
            print('Jobs configuration: success')
        elif operation == ['jobs-grants']:
            jobs_grants_locked(revision)
            print('Jobs grants: success')
        elif len(operation) == 2 and operation[0] == 'activation':
            if operation[1] in ['ingress-check', 'ingress-cleanup']:
                ingress_probe.check(sys.modules[__name__], revision, active['imageId'],
                                    cleanup=operation[1] == 'ingress-cleanup')
            else:
                activation.config_operation(sys.modules[__name__], revision, active['imageId'], operation[1])
            print('Activation: success')
        elif len(operation) == 3 and operation[0] == 'notifications-acceptance':
            notifications_acceptance.operation(sys.modules[__name__], revision, active['imageId'], operation[1], operation[2])
            print('Notifications acceptance: success')
        elif len(operation) == 3 and operation[0] == 'identity-acceptance':
            identity_acceptance.operation(sys.modules[__name__], revision, active['imageId'], operation[1], operation[2])
            print('Identity acceptance: success')
        elif len(operation) == 3 and operation[0] == 'jobs-acceptance':
            jobs_acceptance_locked(revision, active['imageId'], operation[1], operation[2])
            print('Jobs acceptance: success')
        elif operation == ['heartbeat']:
            require(not (BASE / 'private/maintenance/enabled').exists(), 'MAINTENANCE')
            heartbeat_locked(revision, active['imageId'])
            print('Heartbeat: success')
        elif operation == ['seed-synthetic']:
            seed_synthetic_locked(revision)
            print('Synthetic reference: success')
        elif operation == ['stage-seed']:
            require(not (BASE / 'private/maintenance/enabled').exists(), 'MAINTENANCE')
            identity = stage_seed_locked(revision)
            print(f'Stage seed: success {identity}')
        elif operation == ['stage-smoke']:
            require(not (BASE / 'private/maintenance/enabled').exists(), 'MAINTENANCE')
            # Fixed statuses and paths only; on failure they stay in state/last-failed-child.stdout.
            print(stage_smoke_locked(revision, active['imageId']).decode(), end='')
            print('Stage smoke: success')
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
    except BaseException as error:
        if type(error) is RuntimeError and error.args == ('EVENT_ROUTE_HISTORY_REQUIRES_STAGE2',):
            print('Activation: published event route history requires Stage 2', file=sys.stderr)
        else:
            print('Operation: failed; inspect private operator state', file=sys.stderr)
        sys.exit(1)
