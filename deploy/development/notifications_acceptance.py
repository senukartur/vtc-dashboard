"""Fixed root-owned, isolated notification acceptance. No shared activation or provider calls."""
import concurrent.futures
import hashlib
import ipaddress
import json
import os
import pathlib
import re
import secrets
import shutil
import stat
import time

import activation
from identity_acceptance import AcceptanceContainers, RUN

MODES = frozenset(['prepare', 'start', 'exercise', 'inspect', 'pause', 'resume', 'overlap', 'stop', 'cleanup'])
WINDOW_SECONDS = 7200  # Operator safety bound; not a company or notification delivery policy.
PROXY_IMAGE = 'caddy:2.11.7-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f'
FILES = frozenset(['operations.py', 'activation.py', 'identity_acceptance.py', 'notifications_acceptance.py',
                   'notifications.acceptance.compose.yaml', 'notifications-acceptance-grants.json'])
PROTECTED = ('compose.yaml', 'activation-grants.json', 'Caddyfile', 'receive.sh', 'ingress_probe.py',
             'private/runtime.env', 'private/jobs.env', 'private/probe.env', 'private/heartbeat.env',
             'private/identity-mail.env', 'private/ingress.env', 'private/proxy.env', 'private/db.env',
             'private/admin.cnf', 'private/export.cnf', 'private/migrator.env', 'private/operator.env',
             'state/current.json', 'state/previous.json')
ROLES = ('api', 'proxy', 'probe', 'fixture', 'migrator', 'worker', 'overlap', 'interrupted')


def private_json(o, path, *, maximum=65536):
    info = path.lstat()
    o.require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o077 and
              info.st_size <= maximum, 'NOTIFICATIONS_PRIVATE_INPUT_INVALID')
    return json.loads(path.read_text())


def hashes(o, names):
    return {name: o.digest(o.BASE / name) for name in names if (o.BASE / name).exists()}


def failed_child(o, output):
    path = o.BASE / 'state/notifications-failed-child.log'
    with open(path, 'wb') as handle:
        os.fchmod(handle.fileno(), 0o600)
        handle.write(output[-65536:]); handle.flush(); os.fsync(handle.fileno())


def worker_failure(output, tables):
    def choice(value, allowed, default):
        return value if isinstance(value, str) and value in allowed else default
    for line in output[-65536:].decode(errors='replace').splitlines():
        try:
            record = json.loads(line)
        except (ValueError, TypeError):
            continue
        if not isinstance(record, dict) or record.get('event') != 'jobs_failed' or not isinstance(record.get('diagnostic'), dict):
            continue
        diagnostic = record['diagnostic']
        names = diagnostic.get('sqlTables')
        names = names if isinstance(names, list) else []
        table = diagnostic.get('deniedTable')
        errno = diagnostic.get('nativeErrno')
        return {'workerCategory': choice(record.get('category'), {'operation_failed', 'commit_outcome_unknown', 'close_failed'}, 'operation_failed'),
                'category': choice(diagnostic.get('category'), {'operation', 'database', 'assertion'}, 'operation'),
                'step': choice(diagnostic.get('step'), {'jobs_config', 'jobs_compose', 'jobs_trip_catchup', 'jobs_notification_maintenance',
                    'jobs_admissions_cleanup', 'jobs_mail_cleanup', 'jobs_catalog_cleanup', 'jobs_manual_cleanup', 'jobs_pass', 'jobs_close'}, 'unknown'),
                'nativeErrno': errno if type(errno) is int and errno in {1040,1044,1045,1049,1054,1059,1062,1142,1143,1146,1205,1213,1292,1317,1364,1406,1451,1452,2013} else None,
                'sqlOperation': choice(diagnostic.get('sqlOperation'), {'select', 'insert', 'update', 'delete'}, 'unknown'),
                'lockingMode': choice(diagnostic.get('lockingMode'), {'for_update', 'for_share', 'none'}, 'unknown'),
                'sqlTables': [name for name in names if isinstance(name, str) and name in tables][:8],
                'deniedTable': table if isinstance(table, str) and table in tables else None}
    return None


def worker_phase(output):
    phase = None
    allowed = {'jobs_compose', 'jobs_trip_catchup', 'jobs_notification_maintenance',
               'jobs_admissions_cleanup', 'jobs_mail_cleanup', 'jobs_catalog_cleanup',
               'jobs_manual_cleanup', 'jobs_pass'}
    for line in output[-65536:].decode(errors='replace').splitlines():
        try:
            record = json.loads(line)
        except (ValueError, TypeError):
            continue
        if (isinstance(record, dict) and record.get('event') == 'jobs_acceptance_phase' and
                isinstance(record.get('phase'), str) and record['phase'] in allowed):
            phase = record['phase']
    return phase


def worker_state(value):
    state = value.get('State') if isinstance(value, dict) else None
    if not isinstance(state, dict):
        return None
    return {'running': state.get('Running') if type(state.get('Running')) is bool else None,
            'exitCode': state.get('ExitCode') if type(state.get('ExitCode')) is int and 0 <= state['ExitCode'] <= 255 else None,
            'oomKilled': state.get('OOMKilled') if type(state.get('OOMKilled')) is bool else None,
            'dead': state.get('Dead') if type(state.get('Dead')) is bool else None}


def occupied_ranges(o, inventory):
    o.require(isinstance(inventory, list), 'NOTIFICATIONS_NETWORK_INVENTORY_INVALID')
    result = []
    for network in inventory:
        o.require(isinstance(network, dict), 'NOTIFICATIONS_NETWORK_INVENTORY_INVALID')
        ipam = network.get('IPAM')
        o.require(ipam is None or isinstance(ipam, dict), 'NOTIFICATIONS_NETWORK_INVENTORY_INVALID')
        ipam = ipam or {}
        configurations = ipam.get('Config')
        o.require(configurations is None or isinstance(configurations, list), 'NOTIFICATIONS_NETWORK_INVENTORY_INVALID')
        configurations = configurations or []
        for item in configurations:
            o.require(isinstance(item, dict), 'NOTIFICATIONS_NETWORK_INVENTORY_INVALID')
            if item.get('Subnet'):
                o.require(isinstance(item['Subnet'], str), 'NOTIFICATIONS_NETWORK_INVENTORY_INVALID')
                try:
                    result.append(ipaddress.ip_network(item['Subnet']))
                except ValueError:
                    raise RuntimeError('NOTIFICATIONS_NETWORK_INVENTORY_INVALID') from None
    return result


def choose_subnet(o, occupied):
    o.require(isinstance(occupied, list) and all(isinstance(r, (ipaddress.IPv4Network, ipaddress.IPv6Network))
                                               for r in occupied), 'NOTIFICATIONS_NETWORK_INVENTORY_INVALID')
    for _ in range(100):
        a, b = secrets.token_bytes(2)
        subnet = ipaddress.ip_network(f'10.{a}.{b}.0/29')
        if not any(r.version == 4 and r.overlaps(subnet) for r in occupied):
            return subnet
    raise RuntimeError('NOTIFICATIONS_NETWORK_UNAVAILABLE')


def grant_manifest(o):
    value = json.loads((o.BASE / 'notifications-acceptance-grants.json').read_text())
    o.require(set(value) == {'runtime', 'jobs'}, 'NOTIFICATIONS_GRANTS_INVALID')
    for tables in value.values():
        for table, rights in tables.items():
            o.require(re.fullmatch('[a-z_]+', table), 'NOTIFICATIONS_GRANTS_INVALID')
            grant_privileges(o, rights)
    return value


def grant_privileges(o, rights):
    o.require(isinstance(rights, list) and rights and all(isinstance(p, str) for p in rights) and
              len(rights) == len(set(rights)) and
              all(re.fullmatch(r'SELECT|INSERT|UPDATE|DELETE|UPDATE\([a-z_,]+\)', p) for p in rights),
              'NOTIFICATIONS_GRANTS_INVALID')
    return ','.join('UPDATE(' + ','.join('`' + column + '`' for column in p[7:-1].split(',')) + ')'
                    if p.startswith('UPDATE(') else p for p in rights)


def mount(o, path, target, readonly=True):
    """The rehearsal uses its positively allocated operator volume; real controls use fixed binds."""
    path = pathlib.Path(path)
    relative = path.relative_to(o.BASE)
    if os.environ.get('REHEARSAL_VOLUME'):
        volume = os.environ['REHEARSAL_VOLUME']
        o.require(re.fullmatch(r'vtc011-[a-f0-9]{16}-config', volume) and
                  os.environ.get('REHEARSAL_PROJECT') == o.PROJECT, 'NOTIFICATIONS_REHEARSAL_BINDING_INVALID')
        return f'type=volume,source={volume},target={target},volume-subpath={relative}' + (',readonly' if readonly else '')
    return f'type=bind,source={path},target={target}' + (',readonly' if readonly else '')


class WindowContainers(AcceptanceContainers):
    def validate(self, name, identity):
        record = self.read()['containers'][name]
        info = json.loads(self.o.run(['docker', 'inspect', identity], timeout=10))[0]
        self.o.require(info['Id'] == identity and info['Name'] == f'/{name}' and
                       info['Image'] == record['imageId'] and
                       info['Config']['Labels'].get('vtc.notifications-acceptance') == self.run_id,
                       'NOTIFICATIONS_CONTAINER_OWNERSHIP_INVALID')

    def create(self, role, arguments, *, image=None, wait=True, timeout=55):
        name = next(n for n in self.names if n.endswith('-' + role))
        self.o.validate_image(self.image_id, self.revision)
        self.stop(name)
        self.preflight([name])
        attempt = secrets.token_hex(16)
        receipt = f'container-{role}-{attempt}.cid'
        self.o.require(not (self.directory / receipt).exists(), 'ACCEPTANCE_CREATE_RECEIPT_COLLISION')
        state = self.read()
        record = {'phase': 'creating', 'attempt': attempt, 'receipt': receipt, 'imageId': image or self.image_id}
        state.setdefault('containers', {})[name] = record
        self.save(state)
        identity = self.o.run(['docker', 'create', '--name', name, '--cidfile', str(self.directory / receipt),
                              '--label', f'vtc.notifications-acceptance={self.run_id}',
                              '--label', f'vtc011.rehearsal={self.o.PROJECT}', *arguments], timeout=30).decode().strip()
        self.o.require(re.fullmatch('[a-f0-9]{64}', identity) and self.receipt(name, record) == identity,
                       'ACCEPTANCE_CREATE_RECEIPT_INVALID')
        self.validate(name, identity)
        record.update(phase='created', id=identity)
        self.save(state)
        if not wait:
            return identity
        try:
            self.o.run(['docker', 'start', identity], timeout=10)
            result = self.o.run(['docker', 'wait', identity], timeout=timeout).decode().strip()
            output = self.o.run(['docker', 'logs', identity], timeout=10)
            if result != '0':
                # Preserve bounded private diagnostics before removing the receipt-owned process.
                failed_child(self.o, output)
                raise RuntimeError('NOTIFICATIONS_CHILD_FAILED')
            return output
        finally:
            self.stop(name)


class Window:
    def __init__(self, o, revision, image_id, run_id):
        o.require(RUN.fullmatch(run_id), 'NOTIFICATIONS_RUN_INVALID')
        self.o, self.revision, self.image_id, self.run_id = o, revision, image_id, run_id
        self.suffix = run_id.replace('-', '')[:16]
        self.schema = f'vtc_na_{self.suffix}'
        self.accounts = {r: f'vtc_n{c}_{self.suffix}' for r, c in [('runtime', 'r'), ('jobs', 'w'), ('migrator', 'm')]}
        self.marker = o.BASE / 'state/notifications-acceptance'
        self.directory = o.BASE / 'private' / f'notifications-{run_id}'
        self.network = f'{o.PROJECT}-notifications-{self.suffix}'
        names = [f'{self.network}-{r}' for r in ROLES]
        self.containers = WindowContainers(o, revision, image_id, run_id, self.directory, names, self.bound, self.save)

    def sql(self, statement):
        return self.o.compose(['exec', '-T', 'db', 'mysql', '--defaults-extra-file=/run/secrets/admin.cnf', '-N', '-B'],
                              revision=self.revision, image_id=self.image_id, data=statement.encode(), timeout=30)

    def save(self, state):
        self.o.atomic_json(self.marker, state)

    def shared_grants(self):
        # Only privilege metadata is read: no authentication material, routine bodies or data.
        # Capture before any owned account exists and compare after every owned account is absent.
        queries = [
            'SELECT GRANTEE,PRIVILEGE_TYPE,IS_GRANTABLE FROM information_schema.USER_PRIVILEGES ORDER BY 1,2,3',
            'SELECT GRANTEE,TABLE_SCHEMA,PRIVILEGE_TYPE,IS_GRANTABLE FROM information_schema.SCHEMA_PRIVILEGES ORDER BY 1,2,3,4',
            'SELECT GRANTEE,TABLE_SCHEMA,TABLE_NAME,PRIVILEGE_TYPE,IS_GRANTABLE FROM information_schema.TABLE_PRIVILEGES ORDER BY 1,2,3,4,5',
            'SELECT GRANTEE,TABLE_SCHEMA,TABLE_NAME,COLUMN_NAME,PRIVILEGE_TYPE,IS_GRANTABLE FROM information_schema.COLUMN_PRIVILEGES ORDER BY 1,2,3,4,5,6',
            'SELECT FROM_HOST,FROM_USER,TO_HOST,TO_USER,WITH_ADMIN_OPTION FROM mysql.role_edges ORDER BY 1,2,3,4,5',
            'SELECT HOST,USER,DEFAULT_ROLE_HOST,DEFAULT_ROLE_USER FROM mysql.default_roles ORDER BY 1,2,3,4',
            'SELECT Host,User,Proxied_host,Proxied_user,With_grant FROM mysql.proxies_priv ORDER BY 1,2,3,4,5',
            'SELECT Host,Db,User,Routine_name,Routine_type,Proc_priv FROM mysql.procs_priv ORDER BY 1,2,3,4,5,6',
            'SELECT USER,HOST,PRIV,WITH_GRANT_OPTION FROM mysql.global_grants ORDER BY 1,2,3,4',
        ]
        digest = hashlib.sha256()
        for index, query in enumerate(queries):
            digest.update(str(index).encode() + b'\0' + self.sql(query + ';') + b'\0')
        return digest.hexdigest()

    def bound(self):
        state = private_json(self.o, self.marker, maximum=262144)
        self.o.require(state.get('runId') == self.run_id and state.get('schema') == self.schema and
                       state.get('accounts') == self.accounts and state.get('revision') == self.revision and
                       state.get('imageId') == self.image_id and state.get('directory') == str(self.directory),
                       'NOTIFICATIONS_BINDING_INVALID')
        self.o.require(state['controls'] == hashes(self.o, FILES) and
                       state['protected'] == hashes(self.o, PROTECTED), 'NOTIFICATIONS_SHARED_STATE_CHANGED')
        if state.get('configuration'):
            self.o.require(state['configuration'] == hashes(self.o, [str(p.relative_to(self.o.BASE)) for p in
                           self.directory.glob('*.env')]), 'NOTIFICATIONS_CONFIGURATION_CHANGED')
        return state

    def environment(self, role, *, network=None):
        args = ['--network', network or f'{self.o.PROJECT}_database', '--init', '--read-only', '--cap-drop', 'ALL',
                '--security-opt', 'no-new-privileges:true', '--memory', '96m' if role == 'jobs' else '192m',
                '--cpus', '0.25' if role == 'jobs' else '0.75', '--pids-limit', '32',
                '--tmpfs', '/tmp:size=16m,mode=1777', '--env-file', str(self.directory / f'{role}.env'),
                '--env-file', str(self.directory / 'shared.env')]
        return args

    def fixture(self, mode):
        self.o.require(mode in ['validate', 'seed', 'produce', 'inspect', 'revoke', 'worker-permissions'], 'NOTIFICATIONS_FIXTURE_MODE_INVALID')
        return self.containers.create('fixture', [*self.environment('jobs' if mode == 'worker-permissions' else 'runtime'), '--mount',
            mount(self.o, self.directory / 'exchange', '/acceptance', False), self.image_id,
            'node', 'dist/notifications-acceptance.js', mode])

    def prepare(self):
        o = self.o
        o.require(not self.marker.exists() and not self.directory.exists(), 'NOTIFICATIONS_COLLISION')
        input_value = private_json(o, o.BASE / 'private/notifications-acceptance-input.json')
        o.require(set(input_value) == {'revision', 'imageId', 'controls', 'scenarios'} and
                  input_value['revision'] == self.revision and input_value['imageId'] == self.image_id and
                  input_value['controls'] == hashes(o, FILES) and input_value['scenarios'] == list(range(1, 10)),
                  'NOTIFICATIONS_REVIEWED_INPUT_REQUIRED')
        active = o.current()
        o.require(active and active['imageId'] == self.image_id and active['revision'] == self.revision and
                  type(active.get('runId')) is int and active['runId'] > 0, 'NOTIFICATIONS_CURRENT_RELEASE_REQUIRED')
        o.validate_image(self.image_id, self.revision)
        self.containers.preflight()
        database = json.loads(o.run(['docker', 'network', 'inspect', f'{o.PROJECT}_database'], timeout=10))[0]
        o.require(database['Internal'] is True, 'NOTIFICATIONS_DATABASE_NETWORK_NOT_INTERNAL')
        o.stop_owned_jobs(self.revision, self.image_id)
        o.require(self.sql(f"SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='{self.schema}';").strip() == b'0', 'NOTIFICATIONS_COLLISION')
        for account in self.accounts.values():
            o.require(self.sql(f"SELECT COUNT(*) FROM mysql.user WHERE User='{account}';").strip() == b'0', 'NOTIFICATIONS_COLLISION')
        o.require(not o.run(['docker', 'network', 'ls', '-q', '--filter', f'name=^{self.network}$'], timeout=10).strip(), 'NOTIFICATIONS_COLLISION')
        state = dict(runId=self.run_id, schema=self.schema, accounts=self.accounts, revision=self.revision,
                     imageId=self.image_id, directory=str(self.directory), controls=hashes(o, FILES),
                     protected=hashes(o, PROTECTED), phase='allocating', schedule=False, containers={},
                     allocations={}, ticks=[], scenario=0, expiresUtc=int(time.time()) + WINDOW_SECONDS,
                     databaseNetworkId=database['Id'], sharedGrantsSha256=self.shared_grants())
        self.save(state)
        self.directory.mkdir(mode=0o700)
        for name in ['exchange', 'proxy-data', 'proxy-config']:
            (self.directory / name).mkdir(mode=0o700)
        os.chown(self.directory / 'exchange', 1000, 1000)
        occupied_ids = o.run(['docker', 'network', 'ls', '-q'], timeout=10).decode().split()
        occupied = json.loads(o.run(['docker', 'network', 'inspect', *occupied_ids], timeout=10)) if occupied_ids else []
        subnet = choose_subnet(o, occupied_ranges(o, occupied) + activation.host_routes(o))
        state.update(subnet=str(subnet), apiIp=str(subnet.network_address + 2), proxyIp=str(subnet.network_address + 3))
        state['allocations']['network'] = 'creating'; self.save(state)
        network_id = o.run(['docker', 'network', 'create', '--internal', '--subnet', str(subnet),
                            '--label', f'vtc.notifications-acceptance={self.run_id}', '--label',
                            f'vtc011.rehearsal={o.PROJECT}', self.network], timeout=30).decode().strip()
        o.require(re.fullmatch('[a-f0-9]{64}', network_id), 'NOTIFICATIONS_NETWORK_RECEIPT_INVALID')
        state['networkId'] = network_id; state['allocations']['network'] = 'created'; self.save(state)
        state['allocations']['schema'] = 'creating'; self.save(state)
        self.sql(f'CREATE DATABASE {self.schema} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;')
        state['allocations']['schema'] = 'created'; self.save(state)
        self.sql(f"CREATE TABLE {self.schema}.notification_acceptance (singleton TINYINT PRIMARY KEY,run_id CHAR(36) NOT NULL,image_id CHAR(71) NOT NULL,revision CHAR(40) NOT NULL,refs JSON NULL) ENGINE=InnoDB; INSERT INTO {self.schema}.notification_acceptance VALUES(1,'{self.run_id}','{self.image_id}','{self.revision}',NULL);")
        for role, account in self.accounts.items():
            password = secrets.token_hex(32)
            path = self.directory / f'{role}.env'
            path.write_text(f'MYSQL_HOST=db\nMYSQL_PORT=3306\nMYSQL_DATABASE={self.schema}\nMYSQL_USER={account}\nMYSQL_PASSWORD={password}\nNODE_OPTIONS=--max-old-space-size={64 if role == "jobs" else 128}\n')
            os.chmod(path, 0o600)
            state['allocations'][role] = 'creating'; self.save(state)
            self.sql(f"CREATE USER '{account}'@'%' IDENTIFIED BY '{password}' ATTRIBUTE '{{\"vtcNotifications\":\"{self.run_id}\"}}';")
            state['allocations'][role] = 'created'; self.save(state)
        escaped = self.schema.replace('_', '\\_')
        self.sql(f"GRANT SELECT,INSERT,UPDATE,DELETE,CREATE,ALTER,DROP,INDEX,REFERENCES ON `{escaped}`.* TO '{self.accounts['migrator']}'@'%';")
        shared = {'NODE_ENV': 'production', 'MAIL_MODE': 'disabled', 'IDENTITY_ORIGIN': 'https://notifications-acceptance.invalid',
                  'API_TRUSTED_PROXY_IPV4': state['proxyIp'], 'API_HOST': '0.0.0.0', 'API_PORT': '3000',
                  'VTC_NOTIFICATIONS_ACCEPTANCE': 'synthetic-only', 'VTC_NOTIFICATIONS_ACCEPTANCE_RUN': self.run_id,
                  'VTC_NOTIFICATIONS_ACCEPTANCE_IMAGE_ID': self.image_id, 'VTC_NOTIFICATIONS_ACCEPTANCE_REVISION': self.revision,
                  'CATALOGS_SYNTHETIC': 'false', 'CATALOGS_MAX_FILE_BYTES': '1048576', 'CATALOGS_ARTIFACT_TTL_MS': '86400000',
                  'CATALOGS_POLICY_REVISION': '1', 'MANUAL_MAX_FILES_PER_REPORT': '5', 'MANUAL_POLICY_REVISION': '1',
                  'MANUAL_ORPHAN_GRACE_MS': '60000', 'SERVE_WEB': 'true'}
        for feature in ['IDENTITY', 'ADMISSIONS', 'CATALOGS', 'TRIPS', 'QUALIFICATIONS', 'MANUAL_REPORTS', 'EVENTS', 'RECONCILIATION', 'TRIP_DECISIONS', 'NOTIFICATIONS']:
            shared[feature + '_ENABLED'] = 'true'
        for key in ['IDENTITY_SECRET', 'ADMISSIONS_ENCRYPTION_KEY', 'CATALOGS_CURSOR_KEY', 'TRIPS_CURSOR_KEY',
                    'QUALIFICATIONS_CURSOR_KEY', 'MANUAL_REPORTS_KEY', 'EVENTS_CURSOR_KEY', 'RECONCILIATION_KEY',
                    'TRIP_DECISIONS_KEY', 'NOTIFICATIONS_CURSOR_KEY']:
            shared[key] = secrets.token_hex(32) if key != 'ADMISSIONS_ENCRYPTION_KEY' else secrets.token_urlsafe(32)
        (self.directory / 'shared.env').write_text(''.join(f'{k}={v}\n' for k, v in shared.items()))
        os.chmod(self.directory / 'shared.env', 0o600)
        state['configuration'] = hashes(o, [str(p.relative_to(o.BASE)) for p in self.directory.glob('*.env')]); self.save(state)
        self.containers.create('migrator', [*self.environment('migrator'), self.image_id, 'node', 'node_modules/@vtc/db/dist/migrate-cli.js'], timeout=180)
        state = self.bound()
        state['diagnosticTables'] = self.sql(f"SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='{self.schema}' ORDER BY TABLE_NAME;").decode().splitlines()
        o.require(all(re.fullmatch('[a-z_]+', table) for table in state['diagnosticTables']), 'NOTIFICATIONS_SCHEMA_TABLES_INVALID')
        self.save(state)
        manifest = grant_manifest(o)
        for role, tables in manifest.items():
            for table, rights in tables.items():
                self.sql(f"GRANT {grant_privileges(o, rights)} ON {self.schema}.{table} TO '{self.accounts[role]}'@'%';")
        self.verify_rights(manifest)
        self.fixture('validate'); self.fixture('seed'); self.fixture('worker-permissions')
        state = self.bound(); state['phase'] = 'prepared'; self.save(state)

    def verify_rights(self, manifest):
        for role, account in self.accounts.items():
            who = f"'''{account}''@''%'''"
            for query in [f'SELECT COUNT(*) FROM mysql.role_edges WHERE TO_USER=\'{account}\';',
                          f'SELECT COUNT(*) FROM mysql.default_roles WHERE USER=\'{account}\';',
                          f'SELECT COUNT(*) FROM mysql.proxies_priv WHERE User=\'{account}\';',
                          f"SELECT COUNT(*) FROM mysql.procs_priv WHERE User='{account}';",
                          f"SELECT COUNT(*) FROM mysql.global_grants WHERE USER='{account}';",
                          f"SELECT COUNT(*) FROM mysql.user WHERE User='{account}' AND Host<>'%';"]:
                self.o.require(self.sql(query).strip() == b'0', 'NOTIFICATIONS_EXTRA_GRANT')
            rows = self.sql(f"SELECT PRIVILEGE_TYPE FROM information_schema.USER_PRIVILEGES WHERE GRANTEE={who} AND PRIVILEGE_TYPE<>'USAGE';")
            self.o.require(not rows.strip(), 'NOTIFICATIONS_GLOBAL_GRANT')
            for table in ['USER_PRIVILEGES', 'SCHEMA_PRIVILEGES', 'TABLE_PRIVILEGES', 'COLUMN_PRIVILEGES']:
                self.o.require(self.sql(f"SELECT COUNT(*) FROM information_schema.{table} WHERE GRANTEE={who} AND IS_GRANTABLE<>'NO';").strip() == b'0', 'NOTIFICATIONS_GRANT_OPTION')
            if role == 'migrator':
                schema_rows = self.sql(f"SELECT TABLE_SCHEMA,PRIVILEGE_TYPE FROM information_schema.SCHEMA_PRIVILEGES WHERE GRANTEE={who} ORDER BY 1,2;").decode().splitlines()
                expected_schema = sorted(f"{self.schema.replace('_', chr(92) + '_')}\t{p}" for p in ['SELECT','INSERT','UPDATE','DELETE','CREATE','ALTER','DROP','INDEX','REFERENCES'])
                # The mysql batch renderer escapes literal backslashes in wildcard-safe schema grants.
                schema_rows = [row.replace(chr(92) + chr(92), chr(92)) for row in schema_rows]
                self.o.require(schema_rows == expected_schema, 'NOTIFICATIONS_MIGRATOR_GRANT_MISMATCH')
                for table in ['TABLE_PRIVILEGES', 'COLUMN_PRIVILEGES']:
                    self.o.require(self.sql(f'SELECT COUNT(*) FROM information_schema.{table} WHERE GRANTEE={who};').strip() == b'0', 'NOTIFICATIONS_MIGRATOR_EXTRA_GRANT')
                continue
            schemas = self.sql(f'SELECT COUNT(*) FROM information_schema.SCHEMA_PRIVILEGES WHERE GRANTEE={who};')
            self.o.require(schemas.strip() == b'0', 'NOTIFICATIONS_SCHEMA_GRANT')
            actual = sorted(self.sql(f"SELECT TABLE_SCHEMA,TABLE_NAME,PRIVILEGE_TYPE FROM information_schema.TABLE_PRIVILEGES WHERE GRANTEE={who} ORDER BY 1,2,3;").decode().splitlines())
            expected = sorted(f'{self.schema}\t{table}\t{p}' for table, rights in manifest[role].items() for p in rights if '(' not in p)
            self.o.require(actual == expected, 'NOTIFICATIONS_TABLE_GRANT_MISMATCH')
            actual_columns = sorted(self.sql(f"SELECT TABLE_SCHEMA,TABLE_NAME,COLUMN_NAME,PRIVILEGE_TYPE FROM information_schema.COLUMN_PRIVILEGES WHERE GRANTEE={who} ORDER BY 1,2,3,4;").decode().splitlines())
            expected_columns = sorted(f'{self.schema}\t{table}\t{column}\tUPDATE' for table, rights in manifest[role].items() for p in rights if p.startswith('UPDATE(') for column in p[7:-1].split(','))
            self.o.require(actual_columns == expected_columns, 'NOTIFICATIONS_COLUMN_GRANT_MISMATCH')

    def stop_all(self, state):
        state['schedule'] = False; state['phase'] = 'stopping'; self.save(state)
        failed = False
        for name in self.containers.names:
            try:
                self.containers.stop(name)
            except Exception:
                failed = True
        state = self.bound(); state['phase'] = 'stop_failed' if failed else 'stopped'; self.save(state)
        self.o.require(not failed, 'NOTIFICATIONS_STOP_INCOMPLETE')

    def worker(self, role='worker'):
        identity = self.containers.create(role, [*self.environment('jobs'), self.image_id, 'node', 'dist/jobs.js', 'run'], wait=False)
        name = next(n for n in self.containers.names if n.endswith('-' + role))
        started = time.monotonic()
        cpu = None
        try:
            self.o.run(['docker', 'start', identity], timeout=10)
            try:
                sample = self.o.run(['docker', 'stats', '--no-stream', '--format', '{{.CPUPerc}}', identity], timeout=3).decode().strip()
                if re.fullmatch(r'[0-9]+(?:\.[0-9]+)?%', sample):
                    cpu = float(sample[:-1])
            except Exception:
                pass  # An unavailable sample stays null; it is never reported as zero usage.
            result = self.o.run(['docker', 'wait', identity], timeout=55).decode().strip()
            output = self.o.run(['docker', 'logs', identity], timeout=10)
            if result != '0':
                failed_child(self.o, output)
                state = self.bound()
                failure = worker_failure(output, state.get('diagnosticTables', []))
                state['lastWorkerFailure'] = failure
                if state['ticks']:
                    state['ticks'][-1]['workerFailure'] = failure
                self.save(state)
            self.o.require(result == '0', 'NOTIFICATIONS_WORKER_FAILED')
            records = [json.loads(line) for line in output.decode().splitlines() if line.startswith('{')]
            outcome = next(r for r in records if r.get('event') == 'jobs_result')
            self.o.require(outcome.get('status') in ['completed', 'stopped', 'overlap'] and
                           type(outcome.get('processed')) is int and 0 <= outcome['processed'] <= 100,
                           'NOTIFICATIONS_WORKER_RESULT_INVALID')
            return {'status': outcome['status'], 'processed': outcome['processed'], 'durationMs': round((time.monotonic() - started) * 1000), 'cpuPercentSample': cpu,
                    'maintenance': {name: outcome.get(name) if outcome.get(name) in allowed else 'unknown' for name, allowed in {
                        'manualCleanup': ['not_run', 'complete', 'configuration_pending', 'storage_unavailable'],
                        'admissionsCleanup': ['not_run', 'completed', 'configuration_pending'],
                        'mailCleanup': ['not_run', 'completed', 'configuration_pending']}.items()}}
        finally:
            self.containers.stop(name)

    def work_sample(self):
        values = self.sql(f"SELECT COUNT(*),COALESCE(SUM(state='ready'),0),COALESCE(SUM(state='running'),0),COALESCE(SUM(state='failed'),0),TIMESTAMPDIFF(MICROSECOND,MIN(CASE WHEN state='ready' AND available_at<=UTC_TIMESTAMP(3) THEN available_at END),UTC_TIMESTAMP(3)) FROM {self.schema}.durable_jobs; SELECT COUNT(*) FROM {self.schema}.outbox_routing; SELECT HEX(`cursor`) FROM {self.schema}.outbox_routing_scans WHERE consumer='notifications.v1';").decode().splitlines()
        counts = values[0].split('\t')
        self.o.require(len(counts) == 5 and len(values) in [2, 3], 'NOTIFICATIONS_WORK_SAMPLE_INVALID')
        return {'jobs': int(counts[0]), 'ready': int(counts[1]), 'running': int(counts[2]), 'failed': int(counts[3]),
                'oldestDueMs': None if counts[4] == 'NULL' else int(counts[4]) // 1000,
                'pending': int(values[1]), 'scanInitialized': len(values) == 3,
                'scanCursor': values[2] if len(values) == 3 and values[2] != 'NULL' else None}

    def tick(self):
        state = self.bound()
        if time.time() >= state['expiresUtc']:
            self.stop_all(state)
            state = self.bound(); state['phase'] = 'expired'; self.save(state)
            return
        if not state['schedule']:
            state['pausedTickCount'] = state.get('pausedTickCount', 0) + 1
            state['lastPausedTickUtc'] = int(time.time()); self.save(state)
            return
        self.o.require(state['phase'] in ['running', 'exercising'], 'NOTIFICATIONS_SCHEDULER_FENCED')
        started = int(time.time())
        if state['ticks'] and state['ticks'][-1]['startedUtc'] // 60 == started // 60:
            state['duplicateMinuteSkips'] = state.get('duplicateMinuteSkips', 0) + 1
            state['lastDuplicateMinuteUtc'] = started; self.save(state)
            return
        record = {'startedUtc': started, 'spacingSeconds': started - state['ticks'][-1]['startedUtc'] if state['ticks'] else None, 'status': 'running'}
        record['minuteOffsetSeconds'] = started % 60
        state['ticks'].append(record); self.save(state)
        try:
            record['before'] = self.work_sample(); self.save(state)
            request = self.request(state)
            if request and request['kind'] == 'pause':
                state = self.bound(); state['pausedUntilUtcMs'] = request['untilUtc']; self.save(state)
            if time.time() * 1000 < state.get('pausedUntilUtcMs', 0):
                result = 'skipped_requested_pause'
            elif request and request['kind'] == 'interrupt':
                self.interrupt()
                result = 'interrupted_owned_worker'
            elif request and request['kind'] == 'overlap':
                self.overlap()
                result = 'pass'
            else:
                metrics = self.worker()
                state = self.bound(); state['ticks'][-1]['worker'] = metrics; self.save(state)
                result = 'pass'
        except Exception:
            state = self.bound(); state['ticks'][-1].update(status='failed', finishedUtc=int(time.time()))
            try:
                state['ticks'][-1]['after'] = self.work_sample()
            except Exception:
                state['ticks'][-1]['afterUnavailable'] = True
            self.save(state)
            raise
        state = self.bound(); state['ticks'][-1].update(status=result, finishedUtc=int(time.time()), after=self.work_sample()); self.save(state)
        self.o.atomic_json(self.directory / 'exchange/tick.json', {'count': len(state['ticks']), 'finishedUtc': int(time.time()), 'status': result})
        os.chmod(self.directory / 'exchange/tick.json', 0o644)

    def request(self, state):
        path = self.directory / 'exchange/request.json'
        if state['phase'] != 'exercising' or not path.exists():
            return None
        info = path.lstat()
        self.o.require(stat.S_ISREG(info.st_mode) and info.st_uid == 1000 and not info.st_mode & 0o077 and
                       info.st_size <= 1024, 'NOTIFICATIONS_FIXTURE_REQUEST_INVALID')
        value = json.loads(path.read_text())
        self.o.require(value.get('runId') == self.run_id and value.get('kind') in ['pause', 'interrupt', 'overlap'] and
                       type(value.get('createdUtc')) is int and state['startedUtc'] * 1000 <= value['createdUtc'] <= time.time() * 1000 and
                       (value.get('scenario') == 6 if value['kind'] == 'pause' else value.get('scenario') == 8),
                       'NOTIFICATIONS_FIXTURE_REQUEST_INVALID')
        expected = {'runId', 'scenario', 'kind', 'createdUtc'} | ({'untilUtc'} if value['kind'] == 'pause' else set())
        self.o.require(set(value) == expected, 'NOTIFICATIONS_FIXTURE_REQUEST_INVALID')
        if value['kind'] == 'pause':
            self.o.require(type(value['untilUtc']) is int and 120000 < value['untilUtc'] - value['createdUtc'] <= 180000,
                           'NOTIFICATIONS_FIXTURE_REQUEST_INVALID')
        if value['createdUtc'] <= state.get('lastRequestUtcMs', 0):
            return None
        # Only this receipt-owned fixture has the exchange mount. API/HTTP requests cannot write it.
        name = next(n for n in self.containers.names if n.endswith('-fixture'))
        record = state['containers'].get(name)
        self.o.require(record and record['phase'] == 'created', 'NOTIFICATIONS_FIXTURE_RECEIPT_REQUIRED')
        self.containers.validate(name, record['id'])
        self.o.require(json.loads(self.o.run(['docker', 'inspect', record['id']], timeout=10))[0]['State']['Running'],
                       'NOTIFICATIONS_FIXTURE_NOT_RUNNING')
        state['lastRequestUtcMs'] = value['createdUtc']; self.save(state)
        return value

    def interrupt(self):
        name = next(n for n in self.containers.names if n.endswith('-interrupted'))
        started = time.monotonic()
        record = {'stage': 'create', 'claimed': False, 'queries': 0, 'status': 'running'}
        def remember():
            state = self.bound(); state['interruption'] = record; self.save(state)
        remember()
        primary, identity = None, None
        try:
            identity = self.containers.create('interrupted', [*self.environment('jobs'), self.image_id, 'node', 'dist/jobs.js', 'run'], wait=False)
            record['stage'] = 'start'; remember()
            self.o.run(['docker', 'start', identity], timeout=10)
            record['stage'] = 'claim_wait'; remember()
            deadline = time.monotonic() + 10
            while True:
                claimed = self.sql(f"SELECT HEX(id) FROM {self.schema}.durable_jobs WHERE kind='notifications.deliver' AND state='running' ORDER BY id LIMIT 1;").decode().strip()
                record['queries'] += 1
                if claimed:
                    record['claimed'] = True
                    break
                self.o.require(time.monotonic() < deadline, 'NOTIFICATIONS_LEASE_NOT_OBSERVED')
                time.sleep(0.1)
            record['stage'] = 'stop'; remember()
            self.containers.stop(name)
            record['stage'] = 'ack'; remember()
            self.o.atomic_json(self.directory / 'exchange/interrupted.json', {'runId': self.run_id, 'jobIdHex': claimed, 'stoppedUtc': int(time.time())})
            os.chmod(self.directory / 'exchange/interrupted.json', 0o644)
            record.update(status='pass', elapsedMs=round((time.monotonic() - started) * 1000)); remember()
        except Exception as error:
            primary = error
            record['workerPhase'] = None
            if identity is not None:
                try:
                    output = self.o.run(['docker', 'logs', identity], timeout=10)
                    record['workerPhase'] = worker_phase(output)
                    record['workerFailure'] = worker_failure(output, self.bound().get('diagnosticTables', []))
                except Exception:
                    record['workerPhaseUnavailable'] = True
                try:
                    values = json.loads(self.o.run(['docker', 'inspect', identity], timeout=10))
                    self.o.require(isinstance(values, list) and len(values) == 1 and values[0].get('Id') == identity,
                                   'NOTIFICATIONS_INTERRUPT_CONTAINER_CHANGED')
                    record['workerState'] = worker_state(values[0])
                except Exception:
                    record['workerStateUnavailable'] = True
            record.update(status='failed', elapsedMs=round((time.monotonic() - started) * 1000),
                          reason='claim_not_observed' if isinstance(error, RuntimeError) and error.args == ('NOTIFICATIONS_LEASE_NOT_OBSERVED',) else 'operation_failed')
            remember()
            raise
        finally:
            if identity is not None:
                try:
                    self.containers.stop(name)
                except Exception:
                    record['stopFailed'] = True; remember()
                    if primary is None:
                        raise

    def overlap(self):
        identities = []
        for role in ['worker', 'overlap']:
            identities.append(self.containers.create(role, [*self.environment('jobs'), self.image_id, 'node', 'dist/jobs.js', 'run'], wait=False))
        try:
            for identity in identities:
                self.o.run(['docker', 'start', identity], timeout=10)
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(lambda identity: self.o.run(['docker', 'wait', identity], timeout=55).strip(), identities))
            self.o.require(all(v == b'0' for v in results), 'NOTIFICATIONS_OVERLAP_FAILED')
        finally:
            for role in ['worker', 'overlap']:
                self.containers.stop(next(n for n in self.containers.names if n.endswith('-' + role)))

    def start(self):
        state = self.bound()
        self.o.require(state['phase'] == 'prepared' and time.time() < state['expiresUtc'], 'NOTIFICATIONS_PHASE_INVALID')
        proxy_info = json.loads(self.o.run(['docker', 'image', 'inspect', PROXY_IMAGE], timeout=10))[0]
        proxy_image_id = proxy_info['Id']
        config = self.directory / 'proxy-config/Caddyfile'
        template = json.loads((self.o.BASE / 'notifications.acceptance.compose.yaml').read_text())
        config.write_text(template['x-caddyfile'].replace('{apiIp}', state['apiIp']))
        os.chmod(config, 0o644)
        api = self.containers.create('api', [*self.environment('runtime'), self.image_id, 'node', 'dist/server.js'], wait=False)
        self.o.run(['docker', 'network', 'connect', '--ip', state['apiIp'], self.network, api], timeout=10)
        proxy = self.containers.create('proxy', ['--network', self.network, '--ip', state['proxyIp'], '--network-alias',
            'notifications-acceptance.invalid', '--read-only', '--cap-drop', 'ALL', '--cap-add', 'NET_BIND_SERVICE',
            '--security-opt', 'no-new-privileges:true',
            '--memory', '96m', '--pids-limit', '32', '--tmpfs', '/tmp:size=16m', '--mount',
            mount(self.o, self.directory / 'proxy-config', '/etc/caddy'), '--mount',
            mount(self.o, self.directory / 'proxy-data', '/data', False), proxy_image_id], image=proxy_image_id, wait=False)
        for identity in [api, proxy]:
            self.o.run(['docker', 'start', identity], timeout=10)
        for attempt in range(30):
            try:
                self.o.run(['docker', 'cp', f'{proxy}:/data/caddy/pki/authorities/local/root.crt', str(self.directory / 'exchange/ca.crt')], timeout=5)
                break
            except Exception:
                if attempt == 29:
                    raise
                time.sleep(1)
        os.chmod(self.directory / 'exchange/ca.crt', 0o644)
        self.o.atomic_json(self.directory / 'exchange/tick.json', {'count': 0, 'finishedUtc': int(time.time()), 'status': 'not_started'})
        os.chmod(self.directory / 'exchange/tick.json', 0o644)
        state = self.bound(); state.update(phase='running', schedule=True, startedUtc=int(time.time())); self.save(state)

    def exercise(self):
        state = self.bound()
        self.o.require(state['phase'] == 'running' and state['schedule'], 'NOTIFICATIONS_PHASE_INVALID')
        identity = self.containers.create('fixture', [*self.environment('runtime'), '--mount',
            mount(self.o, self.directory / 'exchange', '/acceptance', False), '-e',
            'NODE_EXTRA_CA_CERTS=/acceptance/ca.crt', self.image_id, 'node', 'dist/notifications-acceptance.js', 'exercise'], wait=False)
        self.o.run(['docker', 'network', 'connect', self.network, identity], timeout=10)
        state = self.bound(); state['phase'] = 'exercising'; self.save(state)
        self.o.run(['docker', 'start', identity], timeout=10)

    def inspect(self):
        state = self.bound()
        if state['phase'] == 'exercising':
            name = next(n for n in self.containers.names if n.endswith('-fixture'))
            record = state['containers'][name]
            self.containers.validate(name, record['id'])
            info = json.loads(self.o.run(['docker', 'inspect', record['id']], timeout=10))[0]
            if not info['State']['Running']:
                self.o.require(info['State']['ExitCode'] == 0, 'NOTIFICATIONS_EXERCISE_FAILED')
                path = self.directory / 'exchange/evidence.json'
                info = path.lstat()
                self.o.require(stat.S_ISREG(info.st_mode) and info.st_uid == 1000 and not info.st_mode & 0o077 and info.st_size <= 32768,
                               'NOTIFICATIONS_EVIDENCE_INVALID')
                evidence = json.loads(path.read_text())
                self.o.require(evidence.get('runId') == self.run_id and evidence.get('status') == 'pass' and
                               [r.get('ordinal') for r in evidence.get('scenarios', [])] == list(range(1, 10)) and
                               all(r.get('status') == 'pass' for r in evidence['scenarios']), 'NOTIFICATIONS_SCENARIOS_INCOMPLETE')
                state.update(phase='completed', schedule=False, scenario=9); self.save(state)
        print(json.dumps({'event': 'notifications_acceptance', 'phase': state['phase'], 'scenario': state['scenario'], 'ticks': len(state['ticks']), 'result': 'inspected'}), flush=True)

    def cleanup(self):
        state = self.bound()
        self.stop_all(state)
        state = self.bound()
        fixture_evidence = None
        evidence_path = self.directory / 'exchange/evidence.json'
        if evidence_path.exists():
            info = evidence_path.lstat()
            self.o.require(stat.S_ISREG(info.st_mode) and info.st_uid == 1000 and not info.st_mode & 0o077 and
                           info.st_size <= 32768, 'NOTIFICATIONS_EVIDENCE_INVALID')
            fixture_evidence = json.loads(evidence_path.read_text())
            self.o.require(fixture_evidence.get('runId') == self.run_id, 'NOTIFICATIONS_EVIDENCE_INVALID')
        # Retain measurements before removing generated keys and the owned schema. This is private;
        # public reports select fixed counters/ranges and never publish cursor or allocation values.
        self.o.atomic_json(self.o.BASE / 'state/notifications-acceptance-evidence.json', {
            'runId': self.run_id, 'revision': self.revision, 'imageId': self.image_id,
            'controls': state['controls'], 'ticks': state['ticks'], 'fixture': fixture_evidence,
            'duplicateMinuteSkips': state.get('duplicateMinuteSkips', 0),
            'pausedTickCount': state.get('pausedTickCount', 0), 'capturedUtc': int(time.time()),
            'workerFailure': state.get('lastWorkerFailure'), 'interruption': state.get('interruption'),
        })
        # Failed/unknown CREATE acknowledgements remain recovery blockers even if names match.
        for resource, phase in state['allocations'].items():
            self.o.require(phase in ['created', 'removed'], 'NOTIFICATIONS_ALLOCATION_UNCERTAIN')
        for role, account in self.accounts.items():
            metadata = self.sql(f"SELECT COALESCE(JSON_UNQUOTE(JSON_EXTRACT(User_attributes,'$.metadata.vtcNotifications')),'') FROM mysql.user WHERE User='{account}' AND Host='%';").decode().strip()
            self.o.require(not metadata or metadata == self.run_id, 'NOTIFICATIONS_ACCOUNT_OWNERSHIP_INVALID')
            self.o.require(not metadata or state['allocations'].get(role) == 'created', 'NOTIFICATIONS_ACCOUNT_RECEIPT_REQUIRED')
        exists = self.sql(f"SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='{self.schema}';").strip() == b'1'
        if exists:
            self.o.require(state['allocations'].get('schema') == 'created', 'NOTIFICATIONS_SCHEMA_RECEIPT_REQUIRED')
            self.o.require(self.sql(f'SELECT run_id FROM {self.schema}.notification_acceptance WHERE singleton=1;').decode().strip() == self.run_id, 'NOTIFICATIONS_SENTINEL_INVALID')
            if self.sql(f'SELECT refs IS NOT NULL FROM {self.schema}.notification_acceptance WHERE singleton=1;').strip() == b'1':
                self.fixture('revoke')
                state = self.bound()
                self.o.require(self.sql(f'SELECT COUNT(*) FROM {self.schema}.identity_sessions;').strip() == b'0', 'NOTIFICATIONS_SESSIONS_REMAIN')
            names = ','.join("'" + a + "'" for a in self.accounts.values())
            self.o.require(self.sql(f'SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE USER IN ({names});').strip() == b'0', 'NOTIFICATIONS_CLIENTS_REMAIN')
        failed = False
        for role, account in self.accounts.items():
            if state['allocations'].get(role) != 'created':
                continue
            try:
                self.sql(f"DROP USER IF EXISTS '{account}'@'%';")
                state['allocations'][role] = 'removed'; self.save(state)
            except Exception:
                failed = True
        if exists and not failed:
            self.sql(f'DROP DATABASE {self.schema};')
            state['allocations']['schema'] = 'removed'; self.save(state)
        if state['allocations'].get('network') == 'created':
            by_name = self.o.run(['docker', 'network', 'ls', '-q', '--no-trunc', '--filter', f'name=^{self.network}$'], timeout=10).decode().split()
            by_id = self.o.run(['docker', 'network', 'ls', '-q', '--no-trunc', '--filter', f'id={state["networkId"]}'], timeout=10).decode().split()
            self.o.require(not by_name or by_name == [state['networkId']], 'NOTIFICATIONS_NETWORK_OWNERSHIP_INVALID')
            if by_id:
                self.o.require(by_id == [state['networkId']] and by_name == by_id, 'NOTIFICATIONS_NETWORK_OWNERSHIP_INVALID')
                info = json.loads(self.o.run(['docker', 'network', 'inspect', state['networkId']], timeout=10))[0]
                self.o.require(info['Id'] == state['networkId'] and info['Name'] == self.network and
                               info['Labels'].get('vtc.notifications-acceptance') == self.run_id and not info.get('Containers'),
                               'NOTIFICATIONS_NETWORK_OWNERSHIP_INVALID')
                self.o.run(['docker', 'network', 'rm', state['networkId']], timeout=20)
                self.o.require(not self.o.run(['docker', 'network', 'ls', '-q', '--filter', f'id={state["networkId"]}'], timeout=10).strip(), 'NOTIFICATIONS_NETWORK_REMAINS')
            state['allocations']['network'] = 'removed'; self.save(state)
        self.o.require(not failed, 'NOTIFICATIONS_CLEANUP_INCOMPLETE')
        self.o.require(self.sql(f"SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='{self.schema}';").strip() == b'0', 'NOTIFICATIONS_SCHEMA_REMAINS')
        for account in self.accounts.values():
            self.o.require(self.sql(f"SELECT COUNT(*) FROM mysql.user WHERE User='{account}';").strip() == b'0', 'NOTIFICATIONS_ACCOUNT_REMAINS')
        self.o.require(state['sharedGrantsSha256'] == self.shared_grants(), 'NOTIFICATIONS_SHARED_GRANTS_CHANGED')
        self.o.require(state['protected'] == hashes(self.o, PROTECTED), 'NOTIFICATIONS_SHARED_STATE_CHANGED')
        if self.directory.exists():
            info = self.directory.lstat()
            self.o.require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o077, 'NOTIFICATIONS_DIRECTORY_OWNERSHIP_INVALID')
            shutil.rmtree(self.directory)
        self.o.require(not self.directory.exists(), 'NOTIFICATIONS_FILES_REMAIN')
        self.o.atomic_json(self.o.BASE / 'state/notifications-acceptance-last.json', {
            'result': 'cleaned', 'completedUtc': int(time.time()), 'ticks': len(state['ticks']), 'scenario': state['scenario'],
            'evidenceSha256': self.o.digest(self.o.BASE / 'state/notifications-acceptance-evidence.json'),
            'sharedGrantsUnchanged': True, 'sharedFilesUnchanged': True,
        })
        self.marker.unlink()


def operation(o, revision, image_id, mode, run_id):
    o.require(mode in MODES and RUN.fullmatch(run_id), 'NOTIFICATIONS_ARGUMENT_INVALID')
    o.require(not any((o.BASE / f'state/{n}').exists() for n in ['identity-acceptance', 'jobs-acceptance', 'ingress-check.json', 'controls-update.json']) and
              not (o.BASE / 'state/recovery-required').exists() and not (o.BASE / 'private/maintenance/enabled').exists(), 'NOTIFICATIONS_FENCED')
    window = Window(o, revision, image_id, run_id)
    if mode == 'prepare':
        return window.prepare()
    state = window.bound()
    if mode == 'cleanup':
        return window.cleanup()
    if mode == 'stop':
        return window.stop_all(state)
    o.require(time.time() < state['expiresUtc'], 'NOTIFICATIONS_EXPIRED')
    if mode == 'start':
        return window.start()
    if mode == 'pause':
        o.require(state['phase'] in ['running', 'exercising'] and state['schedule'], 'NOTIFICATIONS_PHASE_INVALID')
        state['schedule'] = False; state['pausedUtc'] = int(time.time()); window.save(state)
        for role in ['worker', 'overlap', 'interrupted']:
            window.containers.stop(next(n for n in window.containers.names if n.endswith('-' + role)))
    elif mode == 'resume':
        o.require(state['phase'] in ['running', 'exercising'] and not state['schedule'], 'NOTIFICATIONS_PHASE_INVALID')
        state['schedule'] = True; state['resumedUtc'] = int(time.time()); window.save(state)
    elif mode == 'overlap':
        o.require(state['phase'] == 'running' and state['schedule'], 'NOTIFICATIONS_PHASE_INVALID')
        window.overlap()
    elif mode == 'inspect':
        window.inspect()
    elif mode == 'exercise':
        window.exercise()


def tick(o, revision, image_id):
    state = private_json(o, o.BASE / 'state/notifications-acceptance', maximum=262144)
    Window(o, revision, image_id, state['runId']).tick()


def rehearse(o):
    """Required local group: real TLS and wall-clock minute ticks, with no external provider."""
    active = o.current()
    o.require(active is not None, 'RELEASE_REQUIRED')
    revision, image_id = active['revision'], active['imageId']
    import uuid
    run_id = str(uuid.uuid4())
    reviewed = {'revision': revision, 'imageId': image_id, 'controls': hashes(o, FILES), 'scenarios': list(range(1, 10))}
    o.atomic_json(o.BASE / 'private/notifications-acceptance-input.json', reviewed)
    window = Window(o, revision, image_id, run_id)
    original = hashes(o, PROTECTED)
    completed = False
    try:
        for mode in ['prepare', 'start', 'exercise']:
            with o.lock():
                operation(o, revision, image_id, mode, run_id)
            print(json.dumps({'event': 'notifications_window_rehearsal', 'phase': mode, 'result': 'pass'}), flush=True)
        # This is a local cron stand-in calling the actual fixed tick once per real UTC minute.
        # It neither accelerates application clocks nor permits HTTP to invoke workers.
        next_minute = (int(time.time()) // 60 + 1) * 60
        deadline = time.monotonic() + 1700
        while time.monotonic() < deadline:
            if time.time() >= next_minute:
                previous = __import__('sys').argv
                try:
                    __import__('sys').argv = ['operations.py', 'tick']
                    o.main()
                finally:
                    __import__('sys').argv = previous
                next_minute = (int(time.time()) // 60 + 1) * 60
            with o.lock():
                window.inspect()
                if window.bound()['phase'] == 'completed':
                    completed = True
                    break
            time.sleep(1)
        o.require(completed, 'NOTIFICATIONS_WINDOW_REHEARSAL_INCOMPLETE')
    finally:
        if window.marker.exists():
            with o.lock():
                window.cleanup()
        o.require(hashes(o, PROTECTED) == original, 'NOTIFICATIONS_SHARED_STATE_CHANGED')
    print(json.dumps({'event': 'notifications_window_rehearsal', 'phase': 'complete', 'result': 'pass'}), flush=True)
