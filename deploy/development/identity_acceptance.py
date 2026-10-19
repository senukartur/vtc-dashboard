"""Run-owned isolated synthetic acceptance; never selects an active company as its target."""
import json
import os
import re
import secrets
import shutil
import stat

import activation

RUN = re.compile(r'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$')
ACTIVE_TABLES = ['identity_company', 'identity_users', 'identity_accounts', 'identity_sessions',
                 'identity_memberships', 'identity_roles', 'identity_challenges']


class AcceptanceContainers:
    """Only a committed create receipt/ID authorizes starting or removing a container."""

    def __init__(self, o, revision, image_id, run_id, directory, names, read, save):
        self.o, self.revision, self.image_id = o, revision, image_id
        self.run_id, self.directory, self.names = run_id, directory, names
        self.read, self.save = read, save

    def inventory(self, *, name=None, identity=None):
        selector = f'name=^/{name}$' if name else f'id={identity}'
        values = self.o.run(['docker', 'ps', '-aq', '--no-trunc', '--filter', selector],
                            timeout=10).decode().split()
        self.o.require(len(values) <= 1 and all(re.fullmatch(r'[a-f0-9]{64}', value)
                                               for value in values), 'ACCEPTANCE_CONTAINER_INVALID')
        return values

    def preflight(self, names=None):
        for name in names or self.names:
            self.o.require(not self.inventory(name=name), 'ACCEPTANCE_CONTAINER_COLLISION')

    def receipt(self, name, record):
        role = name.rsplit('-', 1)[1]
        attempt = record.get('attempt', '')
        self.o.require(re.fullmatch(r'[a-f0-9]{32}', attempt) and
                       record.get('receipt') == f'container-{role}-{attempt}.cid',
                       'ACCEPTANCE_CREATE_RECEIPT_INVALID')
        path = self.directory / record['receipt']
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(descriptor, 'rb') as handle:
            info = os.fstat(handle.fileno())
            self.o.require(stat.S_ISREG(info.st_mode) and info.st_uid == 0,
                           'ACCEPTANCE_CREATE_RECEIPT_INVALID')
            os.fchmod(handle.fileno(), 0o600)
            value = handle.read(128).decode('ascii')
            self.o.require(re.fullmatch(r'[a-f0-9]{64}\n?', value),
                           'ACCEPTANCE_CREATE_RECEIPT_INVALID')
            os.fsync(handle.fileno())
        descriptor = os.open(self.directory, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        return value.strip()

    def validate(self, name, identity):
        info = json.loads(self.o.run(['docker', 'inspect', identity], timeout=10))[0]
        self.o.require(info['Id'] == identity and info['Name'] == f'/{name}' and
                       info['Image'] == self.image_id and
                       (info['Config'].get('Labels') or {}).get('vtc.identity-acceptance') == self.run_id,
                       'ACCEPTANCE_CONTAINER_OWNERSHIP_INVALID')

    def stop(self, name):
        state = self.read()
        record = state.get('containers', {}).get(name)
        if not record:
            self.o.require(not self.inventory(name=name), 'ACCEPTANCE_CONTAINER_UNRECORDED')
            return
        # A failed/unknown Docker create cannot turn an occupied name or matching label
        # into authority. Even a CID file alone is not adopted after interrupted commit.
        self.o.require(record.get('phase') in ['created', 'removed'], 'ACCEPTANCE_CREATION_UNCERTAIN')
        identity = record.get('id', '')
        self.o.require(re.fullmatch(r'[a-f0-9]{64}', identity) and
                       self.receipt(name, record) == identity, 'ACCEPTANCE_CREATE_RECEIPT_INVALID')
        by_name, by_id = self.inventory(name=name), self.inventory(identity=identity)
        self.o.require(not by_name or by_name == [identity], 'ACCEPTANCE_CONTAINER_UNRECORDED')
        if by_id:
            self.o.require(record['phase'] == 'created' and by_name == [identity],
                           'ACCEPTANCE_CONTAINER_OWNERSHIP_INVALID')
            self.validate(name, identity)
            self.o.run(['docker', 'rm', '-f', identity], timeout=20)
        self.o.require(not self.inventory(identity=identity) and not self.inventory(name=name),
                       'ACCEPTANCE_CONTAINER_REMAINS')
        if record['phase'] != 'removed':
            record['phase'] = 'removed'
            self.save(state)

    def run(self, command, role, name):
        self.o.require(name in self.names, 'ACCEPTANCE_CONTAINER_NAME_INVALID')
        self.o.validate_image(self.image_id, self.revision)
        self.stop(name)
        self.preflight([name])
        attempt = secrets.token_hex(16)
        receipt = f'container-{role}-{attempt}.cid'
        self.o.require(not (self.directory / receipt).exists(), 'ACCEPTANCE_CREATE_RECEIPT_COLLISION')
        state = self.read()
        record = {'phase': 'creating', 'attempt': attempt, 'receipt': receipt}
        state.setdefault('containers', {})[name] = record
        self.save(state)
        args = ['docker', 'create', '--name', name, '--cidfile', str(self.directory / receipt),
                '--label', f'vtc.identity-acceptance={self.run_id}',
                '--label', f'vtc011.rehearsal={self.o.PROJECT}',
                '--network', f'{self.o.PROJECT}_database', '--init', '--read-only', '--cap-drop', 'ALL',
                '--security-opt', 'no-new-privileges:true', '--memory', '192m', '--pids-limit', '32',
                '--env-file', str(self.directory / f'{role}.env'),
                '--env-file', str(self.directory / 'shared.env')]
        if role == 'jobs':
            args += ['--network', f'{self.o.PROJECT}_mail-egress']
        args += [self.image_id, 'node', *command]
        # No finally cleanup surrounds creation: rejection, timeout or an interrupted
        # receipt/manifest write retains uncertainty and never deletes a name collision.
        identity = self.o.run(args, timeout=30).decode().strip()
        self.o.require(re.fullmatch(r'[a-f0-9]{64}', identity) and
                       self.receipt(name, record) == identity, 'ACCEPTANCE_CREATE_RECEIPT_INVALID')
        self.validate(name, identity)
        record.update(phase='created', id=identity)
        self.save(state)  # Durable creation authority precedes all process execution.
        try:
            self.o.run(['docker', 'start', identity], timeout=10)
            exit_status = self.o.run(['docker', 'wait', identity], timeout=55).decode().strip()
            output = self.o.run(['docker', 'logs', identity], timeout=10)
            self.o.require(exit_status == '0', 'ACCEPTANCE_CONTAINER_FAILED')
            self.o.require(len(output) <= 32768, 'ACCEPTANCE_RESULT_TOO_LARGE')
            return json.loads(output)
        finally:
            self.stop(name)


def operation(o, revision, image_id, mode, run_id, *, local_fixture=False):
    o.require(RUN.fullmatch(run_id) and mode in
              ['prepare', 'produce', 'inspect', 'worker', 'cleanup'], 'ACCEPTANCE_ARGUMENT_INVALID')
    o.require(not (o.BASE / 'private/maintenance/enabled').exists() and
              not (o.BASE / 'state/recovery-required').exists(), 'ACCEPTANCE_FENCED')
    o.require(not (o.BASE / 'state/jobs-acceptance').exists(), 'OTHER_ACCEPTANCE_ACTIVE')
    o.require(not (o.BASE / 'state/ingress-check.json').exists(), 'OTHER_ACCEPTANCE_ACTIVE')
    marker = o.BASE / 'state/identity-acceptance'
    suffix = run_id.replace('-', '')[:16]
    schema = f'vtc_accept_{suffix}'
    accounts = {'runtime': f'vtc_ar_{suffix}', 'jobs': f'vtc_aw_{suffix}',
                'migrator': f'vtc_am_{suffix}'}
    directory = o.BASE / 'private' / f'acceptance-{run_id}'

    def sql(statement):
        return o.compose(['exec', '-T', 'db', 'mysql', '--defaults-extra-file=/run/secrets/admin.cnf',
                          '-N', '-B'], revision=revision, image_id=image_id, data=statement.encode())

    def active_counts():
        return [int(sql(f'SELECT COUNT(*) FROM vtc.{table};').decode().strip())
                for table in ACTIVE_TABLES]

    def save(state):
        o.atomic_json(marker, state)

    def bound():
        o.require(marker.is_file() and not marker.is_symlink(), 'ACCEPTANCE_WINDOW_REQUIRED')
        state = json.loads(marker.read_text())
        o.require(state.get('runId') == run_id and state.get('schema') == schema and
                  state.get('accounts') == accounts and state.get('imageId') == image_id and
                  state.get('revision') == revision and state.get('directory') == str(directory),
                  'ACCEPTANCE_OWNERSHIP_INVALID')
        return state

    names = [f'{o.PROJECT}-identity-{suffix}-{role}' for role in ['runtime', 'jobs', 'migrator']]
    containers = AcceptanceContainers(o, revision, image_id, run_id, directory, names, bound, save)
    container, stop_container = containers.run, containers.stop
    if mode == 'prepare':
        o.require(not marker.exists() and not directory.exists(), 'ACCEPTANCE_COLLISION')
        containers.preflight()  # All roles, before schemas/accounts/networks can mutate.
        o.require(sql(f"SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='{schema}';").strip() == b'0',
                  'ACCEPTANCE_COLLISION')
        for account in accounts.values():
            o.require(sql(f"SELECT COUNT(*) FROM mysql.user WHERE User='{account}';").strip() == b'0',
                      'ACCEPTANCE_COLLISION')
        o.validate_image(image_id, revision)
        activation.private_values(o, o.BASE / 'private/identity-mail.env', activation.SHARED_KEYS)
        recipient = activation.private_values(o, o.BASE / 'private/acceptance-input.env',
                                              {'VTC_ACCEPTANCE_RECIPIENT'})
        o.require(set(recipient) == {'VTC_ACCEPTANCE_RECIPIENT'}, 'ACCEPTANCE_RECIPIENT_REQUIRED')
        counts = active_counts()
        o.require(counts[0] == 0, 'EMPTY_ACTIVE_COMPANY_REQUIRED')
        # A never-run tools profile has not created its egress network yet. Let Compose
        # establish only the reviewed jobs networks without invoking any provider code.
        o.stop_owned_jobs(revision, image_id)
        try:
            o.compose(['run', '--rm', '--name', f'{o.PROJECT}-jobs', '--no-deps', 'jobs',
                       'node', '-e', ''], revision=revision, image_id=image_id, timeout=30)
        finally:
            o.stop_owned_jobs(revision, image_id)
        state = {'runId': run_id, 'schema': schema, 'accounts': accounts, 'imageId': image_id,
                 'revision': revision, 'directory': str(directory), 'activeCounts': counts,
                 'phase': 'allocating', 'createdAccounts': [], 'schemaCreated': False, 'containers': {}}
        save(state)
        directory.mkdir(mode=0o700)
        if local_fixture:
            shared_content = (f'IDENTITY_ENABLED=true\nIDENTITY_SECRET={secrets.token_hex(32)}\n'
                              'IDENTITY_ORIGIN=http://127.0.0.1\nMAIL_MODE=local\n'
                              f'MAIL_ENCRYPTION_KEY={secrets.token_hex(32)}\n'
                              'MAIL_SENDER=synthetic@example.invalid\nNODE_ENV=test\n')
        else:
            activation.validate(o, revision, image_id, o.BASE / 'private/identity-mail.env')
            shared_content = (o.BASE / 'private/identity-mail.env').read_text()
            values = activation.private_values(o, o.BASE / 'private/identity-mail.env', activation.SHARED_KEYS)
            o.require(values.get('IDENTITY_ENABLED') == 'true' and values.get('MAIL_MODE') == 'resend',
                      'ACCEPTANCE_ENABLED_RESEND_REQUIRED')
        with open(directory / 'shared.env', 'x') as handle:
            os.chmod(handle.name, 0o600)
            handle.write(shared_content)
        # Intent is persisted before every nontransactional DDL. Collision checks ran under the lock.
        # Interrupted prepare is cleanup-only; no second prepare can adopt an existing allocation.
        sql(f'CREATE DATABASE {schema} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;')
        state['schemaCreated'] = True
        save(state)
        sql(f"CREATE TABLE {schema}.acceptance_allocation (singleton TINYINT PRIMARY KEY, run_id CHAR(36) NOT NULL) ENGINE=InnoDB; INSERT INTO {schema}.acceptance_allocation VALUES (1,'{run_id}');")
        for role, account in accounts.items():
            password = secrets.token_hex(32)
            sql(f"CREATE USER '{account}'@'%' IDENTIFIED BY '{password}' ATTRIBUTE '{{\"vtcAcceptance\":\"{run_id}\"}}';")
            state['createdAccounts'].append(account)
            save(state)
            # Derived role files contain secrets only in root-private storage, never argv.
            content = (f'MYSQL_HOST=db\nMYSQL_PORT=3306\nMYSQL_DATABASE={schema}\nMYSQL_USER={account}\n'
                       f'MYSQL_PASSWORD={password}\nVTC_IDENTITY_ACCEPTANCE=synthetic-only\n'
                       f'VTC_IDENTITY_ACCEPTANCE_RUN={run_id}\n')
            if role == 'runtime':
                content += f"VTC_ACCEPTANCE_RECIPIENT={recipient['VTC_ACCEPTANCE_RECIPIENT']}\n"
            with open(directory / f'{role}.env', 'x') as handle:
                os.chmod(handle.name, 0o600)
                handle.write(content)
        grant_schema = schema.replace('_', '\\_')
        sql(f"GRANT SELECT,INSERT,UPDATE,DELETE,CREATE,ALTER,DROP,INDEX,REFERENCES ON `{grant_schema}`.* TO '{accounts['migrator']}'@'%';")
        container(['node_modules/@vtc/db/dist/migrate-cli.js'], 'migrator', names[2])
        state = bound()
        sql(activation.grant_sql(o, schema, accounts))
        for role in ['runtime', 'jobs']:
            sql(f"GRANT SELECT ON {schema}.acceptance_allocation TO '{accounts[role]}'@'%';")
        state['phase'] = 'prepared'
        save(state)
        return
    state = bound()
    if mode == 'cleanup':
        for name in names:
            stop_container(name)
        # Resource identity is derived and checked before DROP. Never use user-supplied identifiers.
        for account in accounts.values():
            found = sql(f"SELECT COALESCE(JSON_UNQUOTE(JSON_EXTRACT(User_attributes,'$.metadata.vtcAcceptance')),'') FROM mysql.user WHERE User='{account}' AND Host='%';").decode().strip()
            o.require(not found or found == run_id, 'ACCEPTANCE_ACCOUNT_OWNERSHIP_INVALID')
            if found:
                sql(f"DROP USER '{account}'@'%';")
        exists = sql(f"SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='{schema}';").strip() == b'1'
        if exists:
            owned = sql(f"SELECT run_id FROM {schema}.acceptance_allocation WHERE singleton=1;").decode().strip()
            o.require(owned == run_id, 'ACCEPTANCE_SCHEMA_OWNERSHIP_INVALID')
            sql(f'DROP DATABASE {schema};')
        o.require(active_counts() == state['activeCounts'], 'ACTIVE_IDENTITY_CHANGED')
        for account in accounts.values():
            o.require(sql(f"SELECT COUNT(*) FROM mysql.user WHERE User='{account}';").strip() == b'0',
                      'ACCEPTANCE_ACCOUNT_REMAINS')
        o.require(sql(f"SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='{schema}';").strip() == b'0',
                  'ACCEPTANCE_SCHEMA_REMAINS')
        if directory.exists():
            o.require(directory.is_dir() and not directory.is_symlink() and
                      directory.resolve().parent == (o.BASE / 'private').resolve(),
                      'ACCEPTANCE_DIRECTORY_INVALID')
            shutil.rmtree(directory)
        marker.unlink()
        return
    o.require(state['phase'] in ['prepared', 'produced', 'worker_completed'], 'ACCEPTANCE_NOT_PREPARED')
    for name in names:
        stop_container(name)
    if mode == 'worker':
        o.require(state['phase'] in ['produced', 'worker_completed'], 'ACCEPTANCE_NOT_PRODUCED')
        result = container(['dist/jobs.js', 'run'], 'jobs', names[1])
        o.require(result.get('event') == 'jobs_result', 'ACCEPTANCE_WORKER_FAILED')
        state = bound()
        state['phase'] = 'worker_completed'
        save(state)
    else:
        o.require(mode != 'produce' or state['phase'] == 'prepared', 'ACCEPTANCE_ALREADY_PRODUCED')
        result = container(['dist/identity-acceptance.js', mode], 'runtime', names[0])
        o.require(result.get('event') == 'identity_acceptance' and result.get('runId') == run_id,
                  'ACCEPTANCE_RESULT_INVALID')
        state = bound()
        if mode == 'produce':
            o.require(result.get('state') == 'queued', 'ACCEPTANCE_NOT_DURABLE')
            state['phase'] = 'produced'
            state['identity'] = {key: result[key] for key in ['challengeId', 'deliveryId', 'jobId']}
        elif state['phase'] == 'worker_completed':
            o.require(result.get('state') in ['accepted', 'simulated'] and result.get('purgedPayload')
                      and result.get('attempts') == 1 and all(result.get(key) == value for key, value
                      in state['identity'].items()), 'ACCEPTANCE_NOT_COMPLETED')
        save(state)
    o.atomic_json(o.BASE / 'state/identity-acceptance-last.json', result)
