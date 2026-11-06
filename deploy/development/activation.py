"""Explicit root activation controls. Imported only by the fixed operations dispatcher."""
import ipaddress
import json
import os
import pathlib
import re
import secrets
import socket
import stat
import struct

STAGE_PROFILE = 'stage-features.json'
STAGE_GRANTS_STATE = 'state/stage-grants-installed.json'
# Written out rather than read from the profile: a partly copied control update must still import.
# test_activation.py keeps these equal to the profile.
STAGE_FLAGS = {'EXTERNAL_IDENTITIES_ENABLED', 'CATALOGS_ENABLED', 'TRIPS_ENABLED', 'QUALIFICATIONS_ENABLED',
               'TELEMETRY_ENABLED', 'MANUAL_REPORTS_ENABLED', 'EVENTS_ENABLED', 'RECONCILIATION_ENABLED',
               'TRIP_DECISIONS_ENABLED', 'ANALYTICS_ENABLED', 'NOTIFICATIONS_ENABLED'}
STAGE_SETTINGS = {'CATALOGS_SYNTHETIC', 'CATALOGS_EVIDENCE_FILE', 'CATALOGS_MAX_FILE_BYTES', 'CATALOGS_ARTIFACT_TTL_MS',
                  'CATALOGS_POLICY_REVISION', 'TELEMETRY_IP_PER_MINUTE', 'TELEMETRY_GLOBAL_PER_MINUTE',
                  'MANUAL_MAX_FILES_PER_REPORT', 'MANUAL_POLICY_REVISION', 'MANUAL_ORPHAN_GRACE_MS',
                  'MANUAL_EVIDENCE_ROOT', 'MANUAL_MAX_FILE_BYTES', 'MANUAL_MAX_PIXELS',
                  'MANUAL_UPLOAD_TIMEOUT_MS', 'ANALYTICS_REPORTING_TIMEZONE'}
STAGE_KEYS = {'CATALOGS_CURSOR_KEY', 'TRIPS_CURSOR_KEY', 'QUALIFICATIONS_CURSOR_KEY', 'TELEMETRY_CURSOR_KEY',
              'MANUAL_REPORTS_KEY', 'EVENTS_CURSOR_KEY', 'RECONCILIATION_KEY', 'TRIP_DECISIONS_KEY',
              'ANALYTICS_CURSOR_KEY', 'NOTIFICATIONS_CURSOR_KEY'}
SHARED_KEYS = {'IDENTITY_ENABLED', 'IDENTITY_SECRET', 'IDENTITY_ORIGIN', 'MAIL_MODE',
               'MAIL_ENCRYPTION_KEY', 'MAIL_SENDER', 'MAIL_API_KEY', 'MAIL_TRACKING_DISABLED',
               'ADMISSIONS_ENABLED', 'ADMISSIONS_ENCRYPTION_KEY',
               *STAGE_FLAGS, *STAGE_SETTINGS, *STAGE_KEYS}
INGRESS_KEYS = {'VTC_INGRESS_SUBNET', 'VTC_INGRESS_APP_IPV4', 'VTC_INGRESS_PROXY_IPV4'}
CONTROL_FILES = {'compose.yaml', 'Caddyfile', 'operations.py', 'activation.py', 'activation-grants.json',
                 'identity_acceptance.py', 'ingress_probe.py', 'receive.sh', 'notifications_acceptance.py',
                 'notifications.acceptance.compose.yaml', 'notifications-acceptance-grants.json',
                 STAGE_PROFILE}


def private_copy(source, destination):
    temporary = destination.with_name(destination.name + '.new')
    content = source.read_bytes()
    try:
        descriptor = os.open(temporary, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    except FileExistsError:
        descriptor = os.open(temporary, os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'r+b') as handle:
        info = os.fstat(handle.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
            raise RuntimeError('COPY_TEMP_OWNERSHIP_INVALID')
        retained = handle.read(len(content) + 1)
        # An interrupted copy may resume only its exact complete bytes or an exact
        # prefix of this hash-bound source. Never erase an unexplained collision.
        if not content.startswith(retained):
            raise RuntimeError('COPY_TEMP_CONTENT_INVALID')
        handle.write(content[len(retained):])
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, destination)
    directory = os.open(destination.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def controls_pending(o, revision, image_id):
    marker = o.BASE / 'state/controls-update.json'
    if not marker.exists():
        return False
    state = json.loads(marker.read_text())
    if state.get('pending') is not True:
        return False
    o.require(state.get('complete') is True and state.get('revision') == revision and
              state.get('imageId') == image_id and set(state.get('hashes', {})) == CONTROL_FILES and
              all(o.digest(o.BASE / name) == checksum for name, checksum in state['hashes'].items()),
              'CONTROL_UPDATE_INCOMPLETE')
    return True


def private_values(o, path, keys):
    info = path.lstat()
    o.require(not path.is_symlink() and path.is_file() and info.st_uid == 0 and
              not info.st_mode & 0o077, 'PRIVATE_CONFIGURATION_REQUIRED')
    content = path.read_text()
    o.require(len(content) <= 16384, 'CONFIGURATION_TOO_LARGE')
    values = {}
    for line in content.splitlines():
        o.require('=' in line, 'CONFIGURATION_INVALID')
        key, value = line.split('=', 1)
        o.require(key in keys and key not in values and value and
                  not any(c in value for c in ['\x00', '\r', '\n', '$', '"', "'", '\\']),
                  'CONFIGURATION_INVALID')
        values[key] = value
    return values


def host_routes(o, text=None):
    """Read IPv4 host routes without exposing inventory; the default route is not an overlap."""
    text = pathlib.Path('/proc/net/route').read_text() if text is None else text
    o.require(isinstance(text, str), 'HOST_ROUTE_INVENTORY_INVALID')
    lines = text.splitlines()
    o.require(lines and lines[0].split()[:2] == ['Iface', 'Destination'], 'HOST_ROUTE_INVENTORY_INVALID')
    routes = []
    for line in lines[1:]:
        fields = line.split()
        if not fields:
            continue
        o.require(len(fields) >= 8 and all(re.fullmatch(r'[a-fA-F0-9]{8}', fields[n]) for n in [1, 7]),
                  'HOST_ROUTE_INVENTORY_INVALID')
        destination, mask = (socket.inet_ntoa(struct.pack('<I', int(fields[n], 16))) for n in [1, 7])
        try:
            route = ipaddress.IPv4Network(f'{destination}/{mask}', strict=False)
        except ValueError:
            raise RuntimeError('HOST_ROUTE_INVENTORY_INVALID') from None
        if route.prefixlen:
            routes.append(route)
    return routes


def ingress(o):
    values = private_values(o, o.BASE / 'private/ingress.env', INGRESS_KEYS)
    o.require(set(values) == INGRESS_KEYS, 'INGRESS_CONFIGURATION_REQUIRED')
    subnet = ipaddress.IPv4Network(values['VTC_INGRESS_SUBNET'], strict=True)
    o.require(any(subnet.subnet_of(ipaddress.IPv4Network(block)) for block in
                  ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']) and
              24 <= subnet.prefixlen <= 29, 'INGRESS_SUBNET_INVALID')
    peers = [ipaddress.IPv4Address(values[key]) for key in
             ['VTC_INGRESS_APP_IPV4', 'VTC_INGRESS_PROXY_IPV4']]
    o.require(peers[0] != peers[1] and all(str(p) == values[key] for p, key in zip(peers,
              ['VTC_INGRESS_APP_IPV4', 'VTC_INGRESS_PROXY_IPV4'])) and
              all(p in subnet and p not in [subnet.network_address, subnet.broadcast_address,
                                           subnet.network_address + 1] for p in peers),
              'INGRESS_ADDRESS_INVALID')
    # Existing ingress is allowed only when its project/network ownership and subnet agree.
    ids = o.run(['docker', 'network', 'ls', '-q']).decode().split()
    networks = json.loads(o.run(['docker', 'network', 'inspect', *ids])) if ids else []
    allowed_route = False
    for network in networks:
        for entry in network.get('IPAM', {}).get('Config') or []:
            if not entry.get('Subnet'):
                continue
            other = ipaddress.ip_network(entry['Subnet'])
            if other.version != 4 or not subnet.overlaps(other):
                continue
            labels = network.get('Labels') or {}
            o.require(labels.get('com.docker.compose.project') == o.PROJECT and
                      labels.get('com.docker.compose.network') == 'ingress' and other == subnet,
                      'INGRESS_NETWORK_OVERLAP')
            allowed_route = True
    # Linux route inventory includes VPN/LAN/Docker routes. Default routes are not overlaps.
    for other in host_routes(o):
        if subnet.overlaps(other):
            o.require(allowed_route and other == subnet, 'INGRESS_HOST_ROUTE_OVERLAP')
    return values


def stage_enabled(values):
    return any(values.get(flag) == 'true' for flag in STAGE_FLAGS)


def module_flags(path):
    """Only which modules a file enables; `validate` owns its ownership and syntax checks."""
    lines = path.read_text().splitlines()
    return {flag: 'true' for flag in STAGE_FLAGS if f'{flag}=true' in lines}


def stage_grants(o):
    """Reviewed module supplement installed by the control update; absent on older installations."""
    path = o.BASE / STAGE_PROFILE
    return json.loads(path.read_text())['grants'] if path.exists() else {}


def matrix(o, values=None):
    """The baseline, plus the module supplement only for a configuration that enables modules."""
    base = json.loads((o.BASE / 'activation-grants.json').read_text())
    if values is None or not stage_enabled(values):
        return base
    supplement = stage_grants(o)
    o.require(supplement, 'STAGE_PROFILE_REQUIRED')
    for role, tables in supplement.items():
        for table, permissions in tables.items():
            base[role].setdefault(table, [])
            base[role][table] = base[role][table] + permissions
    return base


def quoted_columns(permission):
    # Column names may be reserved words (cursor); the matrix itself stays plain.
    name, _, columns = permission.rstrip(')').partition('(')
    return f"{name}({','.join(f'`{column}`' for column in columns.split(','))})" if columns else name


def grant_sql(o, schema='vtc', users=None, values=None):
    o.require(re.fullmatch(r'vtc(?:_accept_[a-f0-9]{16})?', schema), 'GRANT_SCHEMA_INVALID')
    users = users or {'runtime': 'vtc_runtime', 'jobs': 'vtc_jobs'}
    statements = []
    for role, tables in matrix(o, values).items():
        name = users[role]
        o.require(re.fullmatch(r'vtc_(?:runtime|jobs|ar_[a-f0-9]{16}|aw_[a-f0-9]{16})', name),
                  'GRANT_ACCOUNT_INVALID')
        for table, permissions in tables.items():
            statements.append(f"GRANT {','.join(map(quoted_columns, permissions))} ON {schema}.{table} TO '{name}'@'%';")
    return '\n'.join(statements) + '\n'


def privileges(o, revision):
    # No passwords, SHOW CREATE USER, session values or raw grants enter public output.
    query = """SELECT GRANTEE,'global','*',PRIVILEGE_TYPE,IS_GRANTABLE FROM information_schema.USER_PRIVILEGES
UNION ALL SELECT GRANTEE,TABLE_SCHEMA,'*',PRIVILEGE_TYPE,IS_GRANTABLE FROM information_schema.SCHEMA_PRIVILEGES
UNION ALL SELECT GRANTEE,TABLE_SCHEMA,TABLE_NAME,PRIVILEGE_TYPE,IS_GRANTABLE FROM information_schema.TABLE_PRIVILEGES
UNION ALL SELECT GRANTEE,TABLE_SCHEMA,TABLE_NAME,CONCAT(PRIVILEGE_TYPE,'(',COLUMN_NAME,')'),IS_GRANTABLE FROM information_schema.COLUMN_PRIVILEGES;
SELECT TO_USER,FROM_USER FROM mysql.role_edges WHERE TO_USER IN ('vtc_runtime','vtc_jobs');
SELECT User,Db,Routine_name FROM mysql.procs_priv WHERE User IN ('vtc_runtime','vtc_jobs');
SELECT User,Proxied_user FROM mysql.proxies_priv WHERE User IN ('vtc_runtime','vtc_jobs');
SELECT USER,PRIV FROM mysql.global_grants WHERE USER IN ('vtc_runtime','vtc_jobs');
SELECT User,Host FROM mysql.user WHERE User IN ('vtc_runtime','vtc_jobs') AND Host <> '%';
"""
    rows = o.compose(['exec', '-T', 'db', 'mysql', '--defaults-extra-file=/run/secrets/admin.cnf',
                      '-N', '-B'], revision=revision, data=query.encode()).decode().splitlines()
    result = []
    for row in rows:
        fields = row.split('\t')
        if fields[0] in ['vtc_runtime', 'vtc_jobs']:
            raise RuntimeError('UNEXPECTED_ROLE_GRANT')
        if fields[0] in ["'vtc_runtime'@'%'", "'vtc_jobs'@'%'"]:
            o.require(len(fields) == 5, 'UNEXPECTED_ROUTINE_GRANT')
            result.append(fields)
    return sorted(result)


def privilege_rows(tables_by_role):
    """One row per effective privilege; a column grant reads back once per named column."""
    rows = set()
    for role, tables in tables_by_role.items():
        for table, permissions in tables.items():
            for permission in permissions:
                name, _, columns = permission.rstrip(')').partition('(')
                for privilege in ([f'{name}({column})' for column in columns.split(',')] if columns else [name]):
                    rows.add((f"'vtc_{role}'@'%'", 'vtc', table, privilege, 'NO'))
    return rows


def check_privileges(o, rows, *, allow_legacy=False, complete=False, values=None):
    expected = privilege_rows(matrix(o, values))
    actual = set(map(tuple, rows))
    actual = {row for row in actual if row[1:] != ('global', '*', 'USAGE', 'NO')}
    legacy = ("'vtc_runtime'@'%'", 'vtc', '*', 'SELECT', 'NO')
    # A rollback keeps module grants only where an apply recorded them; any other host matches exactly.
    retained = privilege_rows(stage_grants(o)) if (o.BASE / STAGE_GRANTS_STATE).exists() else set()
    allowed = expected | retained | ({legacy} if allow_legacy else set())
    o.require(actual <= allowed, 'UNEXPECTED_EFFECTIVE_PRIVILEGES')
    if complete:
        o.require(expected <= actual, 'MISSING_EFFECTIVE_PRIVILEGES')


def grants(o, revision, values=None):
    before = privileges(o, revision)
    check_privileges(o, before, allow_legacy=True, values=values)
    if not (o.BASE / 'state/activation-grants-before.json').exists():
        o.atomic_json(o.BASE / 'state/activation-grants-before.json', {'privileges': before})
    statement = grant_sql(o, values=values)
    if ["'vtc_runtime'@'%'", 'vtc', '*', 'SELECT', 'NO'] in before:
        statement += "REVOKE SELECT ON vtc.* FROM 'vtc_runtime'@'%';\n"
    if values and stage_enabled(values):
        # Recorded before the nontransactional DDL, so a partial install stays explained.
        o.atomic_json(o.BASE / STAGE_GRANTS_STATE, {'revision': revision})
    o.compose(['exec', '-T', 'db', 'mysql', '--defaults-extra-file=/run/secrets/admin.cnf'],
              revision=revision, data=statement.encode())
    check_privileges(o, privileges(o, revision), complete=True, values=values)


def prepare_stage(o):
    """Write the module candidate from the live file; existing keys are never regenerated."""
    shared = o.BASE / 'private/identity-mail.env'
    candidate = o.BASE / 'private/activation-input.env'
    intent_path = o.BASE / 'state/activation-intent.json'
    o.require(not intent_path.exists() or json.loads(intent_path.read_text()).get('pending') is not True,
              'ACTIVATION_PENDING')
    values = private_values(o, shared, SHARED_KEYS)
    o.require(values.get('IDENTITY_ENABLED') == 'true', 'IDENTITY_REQUIRED')
    known = private_values(o, candidate, SHARED_KEYS) if candidate.exists() else {}
    profile = json.loads((o.BASE / STAGE_PROFILE).read_text())
    values.update({flag: 'true' for flag in profile['flags']})
    values.update(profile['settings'])
    for key in profile['generatedKeys']:
        # Cursor and command keys must stay stable; a retried preparation reuses them.
        values[key] = values.get(key) or known.get(key) or secrets.token_hex(32)
    temporary = candidate.with_name(candidate.name + '.prepare')
    temporary.unlink(missing_ok=True)
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'w') as handle:
        handle.write(''.join(f'{key}={value}\n' for key, value in values.items()))
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, candidate)


def retire_previous(o, shared, previous, intent_path):
    """Allow another apply only after a finished one: the older backup is kept, never overwritten."""
    if not previous.exists():
        return
    o.require(intent_path.exists(), 'ACTIVATION_BACKUP_STATE_INVALID')
    intent = json.loads(intent_path.read_text())
    settled = intent.get('previousHash' if intent.get('target') == 'previous' else 'candidateHash')
    o.require(intent.get('pending') is False and o.digest(shared) == settled,
              'ACTIVATION_BACKUP_STATE_INVALID')
    retired = previous.with_name(f'identity-mail.previous.{o.digest(previous)[:16]}.env')
    os.replace(previous, retired)
    directory = os.open(previous.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def validate(o, revision, image_id, path):
    values = private_values(o, path, SHARED_KEYS)
    if values.get('MAIL_MODE') == 'resend':
        o.require(len({values.get('IDENTITY_SECRET'), values.get('MAIL_ENCRYPTION_KEY'),
                       values.get('MAIL_API_KEY')}) == 3, 'SEPARATE_KEYS_REQUIRED')
    ingress(o)
    o.validate_image(image_id, revision)
    # Read the exact packaged migration hashes without applying missing DDL. Activation
    # is permitted only on the complete clean history already accepted by release.
    expected = json.loads(o.run(['docker', 'run', '--rm', '--network', 'none', '--read-only',
                                '--cap-drop', 'ALL', image_id, 'node', '--input-type=module', '-e',
                                "import {createRequire} from 'node:module';import {migrationFolder} from '@vtc/db';"
                                "const {readMigrationFiles}=createRequire(import.meta.resolve('@vtc/db'))('drizzle-orm/migrator');"
                                "console.log(JSON.stringify(readMigrationFiles({migrationsFolder:migrationFolder}).map(m=>[String(m.folderMillis),m.hash,'applied'])));"], timeout=30))
    history = o.compose(['exec', '-T', 'db', 'mysql', '--defaults-extra-file=/run/secrets/admin.cnf',
                         '-N', '-B'], revision=revision, image_id=image_id,
                        data=b'SELECT version,CONVERT(hash USING ascii),state FROM vtc._vtc_migrations ORDER BY version;')
    o.require(expected and [line.split('\t') for line in history.decode().splitlines()] == expected,
              'ACTIVATION_MIGRATION_HISTORY_INVALID')
    for role in ['runtime', 'jobs']:
        role_path = o.BASE / f'private/{role}.env'
        role_keys = {'MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD'}
        role_values = private_values(o, role_path, role_keys)
        o.require(set(role_values) == role_keys and role_values.get('MYSQL_DATABASE') == 'vtc' and
                  role_values.get('MYSQL_USER') == f'vtc_{role}' and
                  role_values.get('MYSQL_HOST') == 'db' and role_values.get('MYSQL_PORT') == '3306',
                  'ROLE_CONFIGURATION_INVALID')
        # The Docker client reads these private files. Values never become argv or output.
        result = o.run(['docker', 'run', '--rm', '--network', 'none', '--read-only',
                        '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
                        '--env-file', str(role_path),
                        '--env-file', str(path), image_id, 'node', '--input-type=module', '-e',
                        "import {readConfig} from './dist/platform/config/env.js';readConfig();"],
                       timeout=30)
        o.require(result == b'', 'CONFIGURATION_VALIDATION_INVALID')


def config_operation(o, revision, image_id, mode):
    o.require(mode in ['prepare-stage', 'validate', 'apply', 'recover', 'rollback', 'inspect'], 'ACTIVATION_MODE_INVALID')
    if mode == 'prepare-stage':
        prepare_stage(o)
        return
    shared = o.BASE / 'private/identity-mail.env'
    previous = o.BASE / 'private/identity-mail.previous.env'
    intent_path = o.BASE / 'state/activation-intent.json'
    candidate = previous if mode == 'rollback' else o.BASE / 'private/activation-input.env'
    if mode == 'recover':
        interrupted = json.loads(intent_path.read_text())
        o.require(interrupted.get('pending') is True and interrupted.get('target') in
                  ['candidate', 'previous'], 'ACTIVATION_RECOVERY_OWNERSHIP_INVALID')
        if interrupted['target'] == 'previous':
            candidate = previous
    o.require(not (o.BASE / 'state/identity-acceptance').exists() and
              not (o.BASE / 'state/jobs-acceptance').exists() and
              not (o.BASE / 'state/ingress-check.json').exists() and
              not (o.BASE / 'state/notifications-acceptance').exists(), 'ACCEPTANCE_WINDOW')
    if mode == 'inspect':
        check_privileges(o, privileges(o, revision), complete=True, values=module_flags(shared))
        validate(o, revision, image_id, shared)
        return
    validate(o, revision, image_id, candidate)
    if mode == 'validate':
        check_privileges(o, privileges(o, revision), allow_legacy=True, values=module_flags(candidate))
        return
    o.require(mode == 'apply' or previous.is_file() or mode == 'recover',
              'ACTIVATION_BACKUP_STATE_INVALID')
    if mode == 'apply':
        owned_controls = controls_pending(o, revision, image_id)
        o.require(owned_controls or (not (o.BASE / 'private/maintenance/enabled').exists() and
                  not (o.BASE / 'state/recovery-required').exists()), 'ACTIVATION_FENCED')
        retire_previous(o, shared, previous, intent_path)
        o.atomic_json(intent_path, {'revision': revision, 'imageId': image_id,
                                   'candidateHash': o.digest(candidate), 'previousHash': o.digest(shared),
                                   'pending': True, 'target': 'candidate'})
    else:
        intent = json.loads(intent_path.read_text())
        if previous.exists():
            private_values(o, previous, SHARED_KEYS)
        previous_hash = o.digest(previous) if previous.exists() else o.digest(shared)
        o.require(intent.get('revision') == revision and intent.get('imageId') == image_id and
                  previous_hash == intent.get('previousHash') and
                  (previous.exists() or (mode == 'recover' and intent.get('target') == 'candidate')) and
                  (mode == 'rollback' or o.digest(candidate) == intent.get(
                      'previousHash' if intent.get('target') == 'previous' else 'candidateHash')),
                  'ACTIVATION_RECOVERY_OWNERSHIP_INVALID')
        o.require(not (o.BASE / 'state/recovery-required').exists() or intent.get('pending') is True,
                  'ACTIVATION_UNRELATED_RECOVERY')
        o.require(not (o.BASE / 'private/maintenance/enabled').exists() or intent.get('pending') is True,
                  'ACTIVATION_FENCED')
        if mode == 'rollback':
            intent.update(pending=True, target='previous')
            o.atomic_json(intent_path, intent)
    # DDL grants are nontransactional. Keep durable recovery intent across every partial failure.
    o.fenced(revision, image_id)
    o.recovery_intent()
    if not previous.exists():
        intent = json.loads(intent_path.read_text())
        o.require(o.digest(shared) == intent.get('previousHash'), 'ACTIVATION_BACKUP_SOURCE_INVALID')
        private_copy(shared, previous)
        o.require(o.digest(previous) == intent.get('previousHash'), 'ACTIVATION_BACKUP_STATE_INVALID')
    grants(o, revision, module_flags(candidate))
    private_copy(candidate, shared)
    o.compose(['up', '-d', '--force-recreate', '--no-deps', 'app', 'probe', 'proxy'],
              revision=revision, image_id=image_id)
    o.ready(revision, image_id)
    o.public_ready(revision)
    if controls_pending(o, revision, image_id):
        control_path = o.BASE / 'state/controls-update.json'
        control_state = json.loads(control_path.read_text())
        control_state['pending'] = False
        o.atomic_json(control_path, control_state)
    (o.BASE / 'state/recovery-required').unlink()
    o.maintenance(False)
    completed_intent = json.loads(intent_path.read_text())
    completed_intent['pending'] = False
    o.atomic_json(intent_path, completed_intent)
