"""Synthetic-only Docker rehearsal. Its root/socket privileges belong only to the operator test."""
import hashlib
import ipaddress
import importlib.util
import io
import json
import multiprocessing
import os
import pathlib
import re
import shutil
import ssl
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request
import uuid
import zipfile

base = pathlib.Path('/opt/vtc-development')
subprocess.run(['python3', '/source/test_operations.py'], check=True, timeout=30)
subprocess.run(['python3', '/source/test_activation.py'], check=True, timeout=30)
subprocess.run(['python3', '/source/test_acceptance_containers.py'], check=True, timeout=30)
project = os.environ['REHEARSAL_PROJECT']
revision = os.environ['REHEARSAL_REVISION']
volume = os.environ['REHEARSAL_VOLUME']
assert project.startswith('vtc011-') and len(project) == 23
image_id = json.loads(subprocess.run(['docker', 'image', 'inspect', f'vtc-dashboard:{revision}'],
                                   stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=True).stdout)[0]['Id']
for path in pathlib.Path('/source').iterdir():
    if path.is_file():
        shutil.copyfile(path, base / path.name)
subprocess.run(['node', str(base / 'setup.mjs'), str(base)], check=True, stdout=subprocess.DEVNULL)


def verify_sshd():
    # Parser/configuration inspection only: no daemon, socket or listening port.
    assert not list(pathlib.Path('/etc/ssh').glob('ssh_host_*'))
    pathlib.Path('/run/sshd').mkdir(mode=0o755, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='sshd-', dir=base / 'private') as directory:
        directory = pathlib.Path(directory)
        key = directory / 'host-key'
        subprocess.run(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', str(key)],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
        global_config = (f'HostKey {key}\nPidFile {directory / "sshd.pid"}\nUsePAM no\n'
                         'PubkeyAuthentication yes\nAuthenticationMethods any\n'
                         'PasswordAuthentication yes\nKbdInteractiveAuthentication yes\n'
                         'AllowTcpForwarding yes\nAllowAgentForwarding yes\n'
                         'X11Forwarding yes\nPermitTTY yes\nPermitTunnel yes\n'
                         'AcceptEnv LANG\nAcceptEnv LC_*\nSubsystem sftp internal-sftp\n')
        template = (base / 'sshd.example').read_text()
        candidate = directory / 'sshd_config'

        def parse(content):
            candidate.write_text(content)
            return subprocess.run(['/usr/sbin/sshd', '-t', '-f', str(candidate)],
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)

        def effective(user):
            result = subprocess.run(['/usr/sbin/sshd', '-T', '-f', str(candidate), '-C',
                                     f'user={user},host=client.example.invalid,addr=192.0.2.2,laddr=192.0.2.1,lport=22'],
                                    check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
            return result.stdout

        restricted = {
            'pubkeyauthentication': 'yes', 'authenticationmethods': 'publickey',
            'passwordauthentication': 'no', 'kbdinteractiveauthentication': 'no',
            'allowtcpforwarding': 'no', 'allowagentforwarding': 'no',
            'x11forwarding': 'no', 'permittty': 'no', 'permittunnel': 'no',
            'permituserenvironment': 'no',
        }

        def require_restricted(output):
            # Only these known single-valued keys use a mapping; compare all operator bytes.
            settings = dict(line.split(' ', 1) for line in output.decode().splitlines())
            for name, value in restricted.items():
                assert settings[name] == value, name

        assert parse(global_config).returncode == 0
        operator_before = effective('vtc-operator')
        operator_lines = operator_before.decode().splitlines()
        for setting in ['pubkeyauthentication yes', 'authenticationmethods any',
                        'passwordauthentication yes', 'kbdinteractiveauthentication yes',
                        'permittty yes', 'allowtcpforwarding yes', 'permittunnel yes']:
            assert setting in operator_lines
        assert operator_lines.count('acceptenv LANG') == 1
        assert operator_lines.count('acceptenv LC_*') == 1
        assert parse(global_config + template).returncode == 0
        require_restricted(effective('vtc-deploy'))
        assert effective('vtc-operator') == operator_before
        # Each removed Match restriction must independently fail the deployment expectation.
        for directive, name in {
            'AuthenticationMethods publickey': 'authenticationmethods',
            'PasswordAuthentication no': 'passwordauthentication',
            'KbdInteractiveAuthentication no': 'kbdinteractiveauthentication',
        }.items():
            line = f'  {directive}\n'
            assert template.count(line) == 1
            assert parse(global_config + template.replace(line, '')).returncode == 0
            assert effective('vtc-operator') == operator_before
            try:
                require_restricted(effective('vtc-deploy'))
            except AssertionError as failure:
                assert failure.args == (name,)
            else:
                raise AssertionError('SSH_RESTRICTION_REMOVAL_UNDETECTED')
        # Recreate the original unsupported placement, retaining the same full base.
        bad_match = template.replace('PermitUserEnvironment no\n', '') + '  PermitUserEnvironment no\n'
        rejected = parse(global_config + bad_match)
        assert rejected.returncode != 0
        assert b'Directive \'PermitUserEnvironment\' is not allowed within a Match block' in rejected.stderr
        # A global-only directive cannot directly follow the open User condition.
        rejected = parse(global_config + template + f'PidFile {directory / "later.pid"}\n')
        assert rejected.returncode != 0 and b'is not allowed within a Match block' in rejected.stderr
    assert not list((base / 'private').glob('sshd-*'))


verify_sshd()
print('OpenSSH template: full-config parser, effective deploy/operator policy and placement rejection passed', flush=True)
# Fixed layout/expanded-size/type checks run before any infrastructure is started.
zip_directory = base / '.local/deploy'
for entries in [ {'../escape': b'x', 'release.json': b'{}'},
                 {'image.tar': b'x', 'release.json': b'x' * 8193},
                 {'image.tar': b'x', 'release.json': b'{}', 'extra': b'x'} ]:
    zip_directory.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_directory / 'release.zip', 'w') as archive:
        for name, content in entries.items():
            archive.writestr(name, content)
    rejected = subprocess.run(['python3', str(base / 'unpack.py')], cwd=base,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    assert rejected.returncode != 0
    shutil.rmtree(zip_directory)
(base / 'private/proxy.env').write_text('STAGING_DOMAIN=proxy\nTLS_EMAIL=operator@example.invalid\n')
caddy = (base / 'Caddyfile').read_text().replace('{$STAGING_DOMAIN} {', '{$STAGING_DOMAIN} {\n  tls internal')
(base / 'Caddyfile').write_text(caddy)
# Allocate a fresh private ingress subnet independently of every existing Docker network.
network_ids = subprocess.run(['docker', 'network', 'ls', '-q'], check=True, stdout=subprocess.PIPE).stdout.decode().split()
inventory = json.loads(subprocess.run(['docker', 'network', 'inspect', *network_ids], check=True, stdout=subprocess.PIPE).stdout)
occupied = [ipaddress.ip_network(item['Subnet']) for value in inventory
            for item in value.get('IPAM', {}).get('Config') or [] if item.get('Subnet')]
for attempt in range(100):
    entropy = uuid.uuid4().bytes
    subnet = ipaddress.IPv4Network(f'10.{entropy[0]}.{entropy[1]}.0/29')
    if not any(other.version == 4 and subnet.overlaps(other) for other in occupied):
        break
else:
    raise AssertionError('INGRESS_ALLOCATION_UNAVAILABLE')
ingress_file = base / 'private/ingress.env'
ingress_file.write_text(f'VTC_INGRESS_SUBNET={subnet}\nVTC_INGRESS_APP_IPV4={subnet.network_address + 2}\nVTC_INGRESS_PROXY_IPV4={subnet.network_address + 3}\n')
os.chmod(ingress_file, 0o600)
result = subprocess.run(['docker', 'compose', '--env-file', str(ingress_file), '--profile', '*', '-f', str(base / 'compose.yaml'), 'config', '--format', 'json'],
                        env=dict(os.environ, VTC_REVISION=revision, VTC_IMAGE_ID=image_id), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=True)
config = json.loads(result.stdout)
assert set(config['services']['jobs']['networks']) == {'database', 'mail-egress'}
assert not config['services']['jobs'].get('ports')
assert set(config['services']['db']['networks']) == {'database'}
assert config['networks']['database']['internal']
assert not config['networks']['mail-egress'].get('internal', False)
assert set(config['services']['app']['networks']) == {'database', 'ingress'}
assert set(config['services']['proxy']['networks']) == {'frontend', 'ingress'}
assert config['networks']['ingress']['internal']
config['name'] = project
label = {'vtc011.rehearsal': project}
for name, value in config['services'].items():
    value['labels'] = label
    value.pop('ports', None)
    if name in ['app', 'probe', 'heartbeat', 'migrate', 'jobs']:
        value['image'] = '${VTC_IMAGE_ID:?Set the validated immutable image ID}'
    if name in ['app', 'jobs']:
        # Keep the shared file live while role-specific DB settings remain synthetic/resolved.
        value['env_file'] = [str(base / 'private/identity-mail.env')]
        for key in ['IDENTITY_ENABLED', 'MAIL_MODE']:
            value['environment'].pop(key, None)
for name, value in config['volumes'].items():
    value['name'] = f'{project}_{name}'
    value['labels'] = label
for name, value in config['networks'].items():
    value['name'] = f'{project}_{name}'
    value['labels'] = label
config['volumes']['operator-files'] = {'name': volume, 'external': True}


def mount(target, subpath=None):
    value = {'type': 'volume', 'source': 'operator-files', 'target': target, 'read_only': True}
    if subpath:
        value['volume'] = {'subpath': subpath}
    return value


config['services']['db']['volumes'] = [
    {'type': 'volume', 'source': 'mysql', 'target': '/var/lib/mysql'},
    mount('/run/secrets', 'private'), mount('/docker-entrypoint-initdb.d', 'private/bootstrap')]
config['services']['proxy']['volumes'] = [
    mount('/etc/caddy'), mount('/maintenance', 'private/maintenance'),
    {'type': 'volume', 'source': 'tls', 'target': '/data'},
    {'type': 'volume', 'source': 'proxy-config', 'target': '/config'}]
(base / 'compose.yaml').write_text(json.dumps(config))
spec = importlib.util.spec_from_file_location('operations', base / 'operations.py')
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)
ops.PROJECT = project
# Restores need the same reviewed file configuration but fresh named volumes/networks.
original_compose = ops.compose


def compose(args, *, revision, image_id=None, project=project, **kwargs):
    selected_image = image_id or (ops.accepted_image_id(revision) if ops.current() else globals()['image_id'])
    if project != ops.PROJECT:
        # Compose's explicit volume names must be allocated independently for each restore.
        restored = json.loads(json.dumps(config))
        for name, value in restored['volumes'].items():
            if not value.get('external'):
                value['name'] = f'{project}_{name}'
        for name, value in restored['networks'].items():
            value['name'] = f'{project}_{name}'
        file = base / f'{project}.json'
        file.write_text(json.dumps(restored))
        return ops.run(['docker', 'compose', '-p', project, '-f', str(file), *args], revision=revision, image_id=selected_image, **kwargs)
    return original_compose(args, revision=revision, image_id=selected_image, project=project, **kwargs)


ops.compose = compose


def sql(statement):
    return compose(['exec', '-T', 'db', 'mysql', '--defaults-extra-file=/run/secrets/admin.cnf', '-N', '-B'],
                   revision=revision, data=statement.encode())


def expect_failure(callback):
    try:
        callback()
    except Exception:
        return
    raise AssertionError('EXPECTED_FAILURE_MISSING')


def tick_process():
    # Fork inherits only the harness's isolated project/Compose allocation overrides.
    # Exercise the real root dispatcher, nonblocking lock and nonzero failure mapping.
    sys.argv = ['operations.py', 'tick']
    try:
        ops.main()
    except BaseException:
        raise SystemExit(1)


compose(['up', '-d', '--wait', 'db'], revision=revision, timeout=240)
compose(['run', '--rm', '--no-deps', 'migrate'], revision=revision)
ops.jobs_grants_locked(revision)
# Exercise the known existing-installation SELECT revocation, not only fresh setup.
sql("GRANT SELECT ON vtc.* TO 'vtc_runtime'@'%';")
ops.activation.grants(ops, revision)
ops.activation.ingress(ops)
compose(['run', '--rm', '--no-deps', 'heartbeat'], revision=revision)
sql('CREATE TABLE vtc.rehearsal_reference (id INT PRIMARY KEY, evidence_sha CHAR(64) NOT NULL) ENGINE=InnoDB;')
sentinel = b'fictional-evidence-sentinel-vtc011\n'
checksum = hashlib.sha256(sentinel).hexdigest()
sql(f"INSERT INTO vtc.rehearsal_reference VALUES (1, '{checksum}');")
compose(['up', '-d', '--no-deps', 'app', 'probe', 'proxy'], revision=revision)
ops.ready(revision)
ops.run(['docker', 'run', '--rm', '--network', 'none', '--user', '1000', '--mount',
         f'type=volume,source={project}_evidence,target=/app/private-evidence', f'vtc-dashboard:{revision}',
         'node', '-e', "require('node:fs').writeFileSync('/app/private-evidence/sentinel.txt','fictional-evidence-sentinel-vtc011\\n')"])
runtime_negative = """const mysql=require('mysql2/promise'); const c=await mysql.createConnection({host:process.env.MYSQL_HOST,user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD,database:'vtc'}); for(const sql of ['CREATE TABLE forbidden (id INT)','SET GLOBAL max_connections=99','SELECT * FROM mysql.user','SELECT * FROM _vtc_migrations','UPDATE audit_entries SET reason=reason','DELETE FROM audit_entries','UPDATE outbox_events SET schema_version=99','DELETE FROM outbox_events','DELETE FROM identity_verifications','UPDATE _vtc_migrations SET state=\\'applying\\'']) {let denied=false;try{await c.query(sql)}catch(e){if(![1044,1142,1143,1227].includes(e.errno))process.exit(1);denied=true}if(!denied)process.exit(1)}await c.end();"""
compose(['exec', '-T', 'app', 'node', '--input-type=module', '-e', runtime_negative.replace("const mysql=require('mysql2/promise');", "import {createRequire} from 'node:module';const mysql=createRequire(import.meta.resolve('@vtc/db'))('mysql2/promise');")], revision=revision)
ops.maintenance(False)
ops.run(['docker', 'network', 'connect', f'{project}_frontend', os.environ['HOSTNAME']])
proxy_id = compose(['ps', '-q', 'proxy'], revision=revision).decode().strip()
for _ in range(30):
    result = subprocess.run(['docker', 'cp', f'{proxy_id}:/data/caddy/pki/authorities/local/root.crt', str(base / 'test-ca.crt')],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if result.returncode == 0:
        break
    time.sleep(1)
context = ssl.create_default_context(cafile=str(base / 'test-ca.crt'))
os.environ['SSL_CERT_FILE'] = str(base / 'test-ca.crt')
token = dict(line.split('=', 1) for line in (base / 'private/operator.env').read_text().splitlines())['OPERATOR_TOKEN']


def get(path, bearer=None, expected=200):
    request = urllib.request.Request(f'https://proxy{path}', headers={'Authorization': f'Bearer {bearer}'} if bearer else {})
    try:
        with urllib.request.urlopen(request, context=context, timeout=5) as response:
            status, body = response.status, response.read(8192)
    except urllib.error.HTTPError as error:
        status, body = error.code, error.read(8192)
    assert status == expected, 'HTTP_STATUS_MISMATCH'
    return body


get('/_operations/release', expected=401)
get('/_operations/release', 'incorrect', expected=401)
assert json.loads(get('/_operations/release', token))['revision'] == revision
for path in ['/evidence/sentinel.txt', '/evidence%2fsentinel.txt', '/private-evidence/sentinel.txt', '/.env', '/uploads/sentinel.txt', '/%65vidence/sentinel.txt']:
    get(path, expected=404)
compose(['stop', 'db'], revision=revision)
get('/_operations/release', token, expected=503)
compose(['up', '-d', '--wait', 'db'], revision=revision, timeout=120)
ops.ready(revision)
get('/_operations/release', token)
image_id = json.loads(ops.run(["docker", "image", "inspect", f"vtc-dashboard:{revision}"]))[0]["Id"]
image_archive = base / 'test-image.tar'
ops.run(['docker', 'save', '--output', str(image_archive), f'vtc-dashboard:{revision}'])
with ops.lock():
    ops.release_locked(image_archive, revision, 100, 1, 'auto', image_id)
assert ops.current()['runId'] == 100
# Install the same reviewed controls through their real staged/fenced update, retaining
# this harness's translated mounts and privately resolved synthetic role settings.
import update_controls
update_controls.o = ops
control_source = base / 'private/controls-fixture'
control_source.mkdir(mode=0o700)
for name in update_controls.FILES:
    shutil.copyfile(base / name, control_source / name)
update_controls.install(control_source)
assert (base / 'state/recovery-required').exists() and (base / 'private/maintenance/enabled').exists()
assert ops.activation.controls_pending(ops, revision, image_id)
# The reviewed activation operation validates both roles and re-reads exact narrow grants.
identity_secret = uuid.uuid4().hex + uuid.uuid4().hex
activation_input = base / 'private/activation-input.env'
activation_input.write_text(f'IDENTITY_ENABLED=true\nIDENTITY_SECRET={identity_secret}\nIDENTITY_ORIGIN=https://proxy\nMAIL_MODE=disabled\n')
os.chmod(activation_input, 0o600)
valid_activation = activation_input.read_bytes()
activation_input.write_text('IDENTITY_ENABLED=true\nMAIL_MODE=disabled\n')
expect_failure(lambda: ops.activation.config_operation(ops, revision, image_id, 'validate'))
activation_input.write_bytes(valid_activation)
sql("UPDATE vtc._vtc_migrations SET state='applying';")
expect_failure(lambda: ops.activation.config_operation(ops, revision, image_id, 'validate'))
sql("UPDATE vtc._vtc_migrations SET state='applied';")
with ops.lock():
    ops.activation.config_operation(ops, revision, image_id, 'validate')
    ops.activation.config_operation(ops, revision, image_id, 'apply')
    ops.activation.config_operation(ops, revision, image_id, 'inspect')
assert not ops.activation.controls_pending(ops, revision, image_id)
# Exercise the exact root operator probe using only this rehearsal's synthetic CA.
with ops.lock():
    ops.ingress_probe.check(ops, revision, image_id, ca=(base / 'test-ca.crt').read_text())
with ops.lock():
    ops.activation.config_operation(ops, revision, image_id, 'rollback')
assert sql('SELECT COUNT(*) FROM vtc.identity_company;').strip() == b'0'
print('Identity ingress rehearsal: exact Caddy peer, spoof overwrite, distinct noncolliding durable source slots, 21st denial/global isolation and recreation passed', flush=True)
acceptance_input = base / 'private/acceptance-input.env'
acceptance_input.write_text('VTC_ACCEPTANCE_RECIPIENT=synthetic@example.invalid\n')
os.chmod(acceptance_input, 0o600)
with ops.lock():
    # No pre-existing derived role name is adoptable, even with the requested run label.
    for role in ['runtime', 'jobs', 'migrator']:
        for matching_label in [True, False]:
            preexisting_run = str(uuid.uuid4())
            preexisting_suffix = preexisting_run.replace('-', '')[:16]
            preexisting_name = f'{project}-identity-{preexisting_suffix}-{role}'
            fixture_id = ops.run(['docker', 'run', '-d', '--name', preexisting_name,
                                 '--label', f'vtc011.rehearsal={project}', '--label',
                                 f'vtc.identity-acceptance={preexisting_run if matching_label else uuid.uuid4()}',
                                 '--network', 'none', '--read-only', '--cap-drop', 'ALL', image_id,
                                 'node', '-e', 'setInterval(()=>{},1000)']).decode().strip()
            expect_failure(lambda: ops.identity_acceptance.operation(ops, revision, image_id,
                           'prepare', preexisting_run, local_fixture=True))
            retained = json.loads(ops.run(['docker', 'inspect', fixture_id]))[0]
            assert retained['Id'] == fixture_id and retained['State']['Running']
            assert not (base / 'state/identity-acceptance').exists()
            assert not (base / f'private/acceptance-{preexisting_run}').exists()
            assert sql(f"SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='vtc_accept_{preexisting_suffix}';").strip() == b'0'
            assert sql(f"SELECT COUNT(*) FROM mysql.user WHERE User IN ('vtc_ar_{preexisting_suffix}','vtc_aw_{preexisting_suffix}','vtc_am_{preexisting_suffix}');").strip() == b'0'
            ops.run(['docker', 'rm', '-f', fixture_id], timeout=20)
    print('Acceptance name preflight: existing runtime/jobs/migrator IDs and running state preserved for same/wrong run labels before allocation', flush=True)
    activation_run = str(uuid.uuid4())
    invoke = lambda mode, identity=activation_run: ops.identity_acceptance.operation(ops, revision, image_id, mode, identity, local_fixture=True)
    invoke('prepare')
    expect_failure(lambda: invoke('prepare'))
    expect_failure(lambda: invoke('inspect', str(uuid.uuid4())))
    expect_failure(lambda: ops.jobs_locked(revision, image_id))
    runtime_fixture = base / f'private/acceptance-{activation_run}/runtime.env'
    runtime_fixture_bytes = runtime_fixture.read_bytes()
    runtime_fixture.write_text('\n'.join(line for line in runtime_fixture_bytes.decode().splitlines()
                                        if not line.startswith('VTC_ACCEPTANCE_RECIPIENT=')) + '\n')
    try:
        expect_failure(lambda: invoke('produce'))
        failed_producer = json.loads((base / 'state/identity-acceptance').read_text())
        runtime_name = f"{project}-identity-{activation_run.replace('-', '')[:16]}-runtime"
        assert failed_producer['phase'] == 'prepared'
        assert failed_producer['containers'][runtime_name]['phase'] == 'removed'
        assert not ops.run(['docker', 'ps', '-aq', '--filter',
                           f"id={failed_producer['containers'][runtime_name]['id']}"]).strip()
    finally:
        runtime_fixture.write_bytes(runtime_fixture_bytes)
    invoke('produce')
    expect_failure(lambda: invoke('produce'))
    invoke('inspect')
    pending = json.loads((base / 'state/identity-acceptance-last.json').read_text())
    assert pending['state'] == 'queued' and pending['retainedPayload']
    invoke('worker')
    invoke('inspect')
    accepted = json.loads((base / 'state/identity-acceptance-last.json').read_text())
    assert accepted['state'] == 'simulated' and accepted['purgedPayload'] and accepted['attempts'] == 1
    invoke('worker')
    invoke('inspect')
    assert json.loads((base / 'state/identity-acceptance-last.json').read_text()) == accepted
    invoke('cleanup')
    assert not (base / 'state/identity-acceptance').exists()
    # Fresh pre-existing resources must fail before allocating or mutating anything else.
    collision_run = str(uuid.uuid4())
    collision_suffix = collision_run.replace('-', '')[:16]
    collision_schema = f'vtc_accept_{collision_suffix}'
    collision_account = f'vtc_ar_{collision_suffix}'
    sql(f'CREATE DATABASE {collision_schema}; CREATE TABLE {collision_schema}.sentinel (id INT PRIMARY KEY); INSERT INTO {collision_schema}.sentinel VALUES (1);')
    expect_failure(lambda: invoke('prepare', collision_run))
    assert not (base / 'state/identity-acceptance').exists()
    assert sql(f'SELECT id FROM {collision_schema}.sentinel;').strip() == b'1'
    sql(f'DROP DATABASE {collision_schema};')
    sql(f"CREATE USER '{collision_account}'@'%' IDENTIFIED BY '{uuid.uuid4().hex}';")
    expect_failure(lambda: invoke('prepare', collision_run))
    assert sql(f"SELECT COUNT(*) FROM mysql.user WHERE User='{collision_account}';").strip() == b'1'
    assert not (base / 'state/identity-acceptance').exists()
    sql(f"DROP USER '{collision_account}'@'%';")
    # An interrupted prepared window remains bound, can be cleaned and cannot be adopted.
    invoke('prepare', collision_run)
    expect_failure(lambda: invoke('produce', str(uuid.uuid4())))
    collision_container = f'{project}-identity-{collision_suffix}-runtime'
    owned_collision_id = ops.run(['docker', 'run', '-d', '--name', collision_container,
                                 '--label', f'vtc011.rehearsal={project}', '--label',
                                 f'vtc.identity-acceptance={uuid.uuid4()}', '--network', 'none',
                                 image_id, 'node', '-e', 'setInterval(()=>{},1000)']).decode().strip()
    expect_failure(lambda: invoke('produce', collision_run))
    expect_failure(lambda: invoke('cleanup', collision_run))
    collision_info = json.loads(ops.run(['docker', 'inspect', owned_collision_id]))[0]
    assert collision_info['State']['Running'] and (base / 'state/identity-acceptance').exists()
    # Only this harness created the conflicting fixture; the acceptance wrapper refused it.
    ops.run(['docker', 'rm', '-f', owned_collision_id], timeout=20)
    invoke('cleanup', collision_run)
    # Inject an actual Docker name collision after preflight but immediately before create.
    # The migrator case specifically exercises failed creation during allocating/finally.
    for role in ['runtime', 'jobs', 'migrator']:
        for matching_label in [True, False]:
            race_run = str(uuid.uuid4())
            race_suffix = race_run.replace('-', '')[:16]
            race_name = f'{project}-identity-{race_suffix}-{role}'
            race_invoke = lambda mode: invoke(mode, race_run)
            if role != 'migrator':
                race_invoke('prepare')
                if role == 'jobs':
                    race_invoke('produce')
            original_run = ops.run
            race_ids = []
            def create_race(args, **kwargs):
                if args[:2] == ['docker', 'create'] and '--name' in args and args[args.index('--name') + 1] == race_name:
                    assert not race_ids
                    race_ids.append(original_run(['docker', 'run', '-d', '--name', race_name,
                        '--label', f'vtc011.rehearsal={project}', '--label',
                        f'vtc.identity-acceptance={race_run if matching_label else uuid.uuid4()}',
                        '--network', 'none', '--read-only', '--cap-drop', 'ALL', image_id,
                        'node', '-e', 'setInterval(()=>{},1000)']).decode().strip())
                return original_run(args, **kwargs)
            ops.run = create_race
            try:
                expect_failure(lambda: race_invoke('prepare' if role == 'migrator' else
                                                  'worker' if role == 'jobs' else 'produce'))
            finally:
                ops.run = original_run
            assert len(race_ids) == 1
            race_state = json.loads((base / 'state/identity-acceptance').read_text())
            intent = race_state['containers'][race_name]
            assert intent['phase'] == 'creating' and 'id' not in intent
            expect_failure(lambda: race_invoke('cleanup'))
            retained = json.loads(ops.run(['docker', 'inspect', race_ids[0]]))[0]
            assert retained['Id'] == race_ids[0] and retained['State']['Running']
            ops.run(['docker', 'rm', '-f', race_ids[0]], timeout=20)
            expect_failure(lambda: race_invoke('cleanup'))
            # Test-only root investigation: the harness created and removed the foreign
            # object, observed create rejection, and verifies no CID receipt/unknown object.
            # The operator has no automatic uncertain-creation reconciliation command.
            receipt = base / race_state['directory'] / intent['receipt']
            assert not receipt.exists() or receipt.read_text().strip() == ''
            assert not ops.run(['docker', 'ps', '-aq', '--filter', f'name=^/{race_name}$']).strip()
            race_state['containers'].pop(race_name)
            ops.atomic_json(base / 'state/identity-acceptance', race_state)
            race_invoke('cleanup')
    print('Acceptance create races: same/wrong-run runtime/jobs/migrator IDs and state preserved, failed migrator create never cleans a collision, uncertain markers retained', flush=True)
    ops.jobs_locked(revision, image_id)
print('Identity durable acceptance rehearsal: restricted native bootstrap/login/challenge, terminated producer, ordinary separate worker, purge, duplicate pass and owned cleanup passed; no provider call', flush=True)
with ops.lock():
    heartbeat_before = int(sql('SELECT sequence FROM vtc_operations.heartbeat;').decode().strip())
    ops.tick_locked(revision, image_id)
    assert int(sql('SELECT sequence FROM vtc_operations.heartbeat;').decode().strip()) == heartbeat_before + 1
# Compose config has resolved env_file. The heartbeat fixes its schema but reads MYSQL_HOST;
# its own container loopback has no MySQL server and cannot reach a host/external endpoint.
# Real CLI failures, not replaced operations: keep diagnostics private and restore exact config.
for service, setting, expected, unavailable in [
        ('jobs', 'MYSQL_DATABASE', 'vtc', 'synthetic_unavailable'),
        ('heartbeat', 'MYSQL_HOST', 'db', '127.0.0.1')]:
    config_path = base / 'compose.yaml'
    original = config_path.read_bytes()
    heartbeat_before = int(sql('SELECT sequence FROM vtc_operations.heartbeat;').decode().strip())
    started = time.monotonic()
    try:
        injected = json.loads(original)
        assert injected['services'][service]['environment'][setting] == expected
        injected['services'][service]['environment'][setting] = unavailable
        config_path.write_text(json.dumps(injected))
        child = multiprocessing.Process(target=tick_process)
        child.start()
        child.join(timeout=330)
        if child.is_alive():
            child.kill()
            child.join(timeout=5)
            raise AssertionError('TICK_REHEARSAL_DEADLINE')
        assert child.exitcode == 1
    finally:
        config_path.write_bytes(original)
    tick = json.loads((base / 'state/tick-last.json').read_text())
    assert tick['status'] == 'failed' and 'completedUtc' not in tick
    assert tick['steps'][service]['status'] == 'failed'
    assert tick['steps'][service]['category'] == 'client_failed'
    other = 'heartbeat' if service == 'jobs' else 'jobs'
    assert tick['steps'][other]['status'] == 'completed'
    assert all(step['durationMs'] >= 0 and step['attemptedUtc'] >= tick['attemptedUtc']
               for step in tick['steps'].values())
    heartbeat_after = int(sql('SELECT sequence FROM vtc_operations.heartbeat;').decode().strip())
    assert heartbeat_after == heartbeat_before + (1 if service == 'jobs' else 0)
    for suffix in ['jobs', 'jobs-acceptance-a', 'jobs-acceptance-b', 'heartbeat']:
        assert not ops.run(['docker', 'ps', '-aq', '--filter', f'name=^/{project}-{suffix}$'], timeout=10).strip()
    assert not (base / 'state/recovery-required').exists()
    assert not (base / 'private/maintenance/enabled').exists()
    print(f'Durable tick rehearsal: {service} failure, nonzero exit, safe failed result, writer routing and absence passed ({int((time.monotonic() - started) * 1000)} ms)', flush=True)
with ops.lock():
    acceptance_run = str(uuid.uuid4())
    for mode in ['prepare', 'seed', 'seed', 'contend']:
        ops.jobs_acceptance_locked(revision, image_id, mode, acceptance_run)
    expect_failure(lambda: ops.jobs_locked(revision, image_id))
    ops.tick_locked(revision, image_id)
    assert json.loads((base / 'state/tick-last.json').read_text())['steps']['jobs']['status'] == 'skipped_acceptance_window'
    time.sleep(1.1)
    ops.jobs_acceptance_locked(revision, image_id, 'run', acceptance_run)
    ops.jobs_acceptance_locked(revision, image_id, 'inspect', acceptance_run)
    rows = sql(f"SELECT COUNT(*),SUM(touches) FROM vtc.synthetic_job_counter WHERE run_id='{acceptance_run}';")
    assert b'20\t20' in rows
    ops.jobs_acceptance_locked(revision, image_id, 'cleanup', acceptance_run)
    assert b'0' in sql('SELECT COUNT(*) FROM vtc.synthetic_job_counter;')
    ops.tick_locked(revision, image_id)
jobs_negative = """import {createRequire} from 'node:module';const mysql=createRequire(import.meta.resolve('@vtc/db'))('mysql2/promise');const c=await mysql.createConnection({host:process.env.MYSQL_HOST,user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD,database:'vtc'});await c.beginTransaction();for(const t of ['identity_company','identity_memberships','identity_users','identity_challenges'])await c.query('SELECT * FROM '+t+' LIMIT 1 FOR SHARE');await c.rollback();for(const s of ['CREATE TABLE forbidden_jobs (id INT)','UPDATE outbox_events SET schema_version=99','DELETE FROM outbox_events','UPDATE identity_users SET email_verified=1','UPDATE audit_entries SET reason=reason','DELETE FROM audit_entries','DELETE FROM identity_verifications','UPDATE _vtc_migrations SET state=\\'applying\\'','UPDATE job_effect_receipts SET committed_at=UTC_TIMESTAMP(3)']){let denied=false;try{await c.query(s)}catch(e){if(![1044,1142,1143,1227].includes(e.errno))process.exit(1);denied=true}if(!denied)process.exit(1)}await c.end();"""
compose(['run', '--rm', '--no-deps', 'jobs', 'node', '--input-type=module', '-e', jobs_negative], revision=revision)
mail_peer = f'{project}-mail-egress-peer'
mail_alias = 'mail-egress-fixture.invalid'
try:
    ops.run(['docker', 'run', '-d', '--name', mail_peer, '--label', f'vtc011.rehearsal={project}',
             '--network', f'{project}_mail-egress', '--network-alias', mail_alias,
             '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
             '--memory', '64m', '--pids-limit', '32', image_id, 'node', '-e',
             "require('node:net').createServer(s=>s.end('mail-egress-fixture')).listen(8443,'0.0.0.0')"])
    positive = """const s=require('node:net').connect(8443,'mail-egress-fixture.invalid');s.setTimeout(3000);s.on('data',b=>{if(b.toString()!=='mail-egress-fixture')process.exit(1);s.end()});s.on('error',()=>process.exit(1));s.on('timeout',()=>process.exit(1));"""
    compose(['run', '--rm', '--no-deps', 'jobs', 'node', '-e', positive], revision=revision)
    peer = json.loads(ops.run(['docker', 'inspect', mail_peer]))[0]
    peer_ip = peer['NetworkSettings']['Networks'][f'{project}_mail-egress']['IPAddress']
    assert re.fullmatch(r'[0-9.]+', peer_ip)
    negative = """const dns=require('node:dns').promises;const net=require('node:net');(async()=>{try{await dns.lookup('mail-egress-fixture.invalid');process.exit(1)}catch(e){if(!['ENOTFOUND','EAI_AGAIN'].includes(e.code))process.exit(1)}const s=net.connect(8443,process.argv[1]);s.setTimeout(2000);s.on('connect',()=>process.exit(1));s.on('error',()=>{s.destroy()});s.on('timeout',()=>{s.destroy()})})().catch(()=>process.exit(1));"""
    for isolated_network in ['database', 'frontend']:
        ops.run(['docker', 'run', '--rm', '--network', f'{project}_{isolated_network}',
                 '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
                 '--memory', '64m', '--pids-limit', '32', image_id, 'node', '-e', negative, peer_ip], timeout=30)
    egress = json.loads(ops.run(['docker', 'network', 'inspect', f'{project}_mail-egress']))[0]
    assert not egress['Internal'] and egress['Driver'] == 'bridge'
    print('Mail network rehearsal: worker DNS/TCP, dedicated NAT bridge and database/frontend isolation passed; no provider call', flush=True)
finally:
    ops.run(['docker', 'rm', '-f', mail_peer], timeout=20)
sql("REVOKE UPDATE ON vtc.mail_deliveries FROM 'vtc_jobs'@'%';")
paused_cleanup = compose(['run', '--rm', '--no-deps', 'jobs', 'node', 'dist/jobs.js', 'run'], revision=revision)
assert b'\"mailCleanup\":\"configuration_pending\"' in paused_cleanup
with ops.lock():
    ops.jobs_grants_locked(revision)
completed_cleanup = compose(['run', '--rm', '--no-deps', 'jobs', 'node', 'dist/jobs.js', 'run'], revision=revision)
assert b'\"mailCleanup\":\"completed\"' in completed_cleanup
print('Durable jobs rehearsal: empty pass, duplicate seed, consumers, retry/chaining, shared identity reads, cleanup grant notice and denied writes passed', flush=True)
with ops.lock():
    ops.seed_synthetic_locked(revision)
expect_failure(lambda: ops.release_locked(image_archive, revision, 99, 1, 'auto', image_id))
expect_failure(lambda: ops.release_locked(image_archive, revision, 101, 1, 'auto', 'sha256:' + '0' * 64))
assert ops.current()['runId'] == 100
# Two actual release operations acquire the same lock and retain ordering/promotion.
def deploy_release(run_id, queue):
    with ops.lock():
        queue.put(run_id)
        ops.release_locked(image_archive, revision, run_id, 1, 'auto', image_id)
release_queue = multiprocessing.Queue()
first_release = multiprocessing.Process(target=deploy_release, args=(101, release_queue))
second_release = multiprocessing.Process(target=deploy_release, args=(102, release_queue))
first_release.start()
assert release_queue.get(timeout=10) == 101
second_release.start()
assert release_queue.get(timeout=120) == 102
first_release.join(timeout=120); second_release.join(timeout=120)
assert first_release.exitcode == 0 and second_release.exitcode == 0 and ops.current()['runId'] == 102
# A healthy same-SHA rebuild can be accepted while retaining its predecessor by ID.
rebuilt_context = io.BytesIO()
rebuilt_dockerfile = f'FROM vtc-dashboard:{revision}\nLABEL vtc011.variant=healthy-rebuild\n'.encode()
with tarfile.open(fileobj=rebuilt_context, mode='w') as archive:
    entry = tarfile.TarInfo('Dockerfile'); entry.size = len(rebuilt_dockerfile)
    archive.addfile(entry, io.BytesIO(rebuilt_dockerfile))
rebuilt_tag = f'{project}:rebuilt'
ops.run(['docker', 'build', '-t', rebuilt_tag, '-'], data=rebuilt_context.getvalue(), timeout=180)
rebuilt_id = json.loads(ops.run(['docker', 'image', 'inspect', rebuilt_tag]))[0]['Id']
assert rebuilt_id != image_id
ops.run(['docker', 'tag', rebuilt_id, f'vtc-dashboard:{revision}'])
rebuilt_archive = base / 'rebuilt-image.tar'
ops.run(['docker', 'save', '--output', str(rebuilt_archive), f'vtc-dashboard:{revision}'])
with ops.lock():
    ops.release_locked(rebuilt_archive, revision, 103, 1, 'auto', rebuilt_id)
assert ops.current()['imageId'] == rebuilt_id and ops.current()['runId'] == 103
assert json.loads((base / 'state/previous.json').read_text())['imageId'] == image_id
assert json.loads((base / 'state/exports' / ops.current()['backup'] / 'manifest.json').read_text())['imageId'] == image_id
image_id = rebuilt_id
image_archive = rebuilt_archive
# A rebuilt artifact for the SAME source SHA has a different immutable image and
# actually returns HTTP 503. Loading it deliberately overwrites the revision tag.
unhealthy_tag = f'{project}:unhealthy'
unhealthy_script = b"""import {createServer} from 'node:http';
import {writeFileSync} from 'node:fs';
createServer((request,response)=>{
  if(request.url==='/health/ready') {
    writeFileSync('/app/private-evidence/unhealthy-http-observed.txt','HTTP_503_OBSERVED\\n');
    response.writeHead(503).end('SYNTHETIC_UNAVAILABLE');
  } else response.writeHead(200).end('SYNTHETIC_LIVE');
}).listen(3000,'0.0.0.0');
"""
dockerfile = (f'FROM vtc-dashboard:{revision}\nCOPY --chown=node:node unhealthy.mjs /app/operations/unhealthy.mjs\n'
              f'LABEL vtc011.rehearsal={project}\nCMD ["node","operations/unhealthy.mjs"]\n').encode()
context_tar = io.BytesIO()
with tarfile.open(fileobj=context_tar, mode='w') as archive:
    for name, content in [('Dockerfile', dockerfile), ('unhealthy.mjs', unhealthy_script)]:
        entry = tarfile.TarInfo(name); entry.size = len(content); archive.addfile(entry, io.BytesIO(content))
ops.run(['docker', 'build', '-t', unhealthy_tag, '-'], data=context_tar.getvalue(), timeout=180)
unhealthy_id = json.loads(ops.run(['docker', 'image', 'inspect', unhealthy_tag]))[0]['Id']
assert unhealthy_id != image_id
ops.run(['docker', 'tag', unhealthy_id, f'vtc-dashboard:{revision}'])
unhealthy_archive = base / 'unhealthy-image.tar'
ops.run(['docker', 'save', '--output', str(unhealthy_archive), f'vtc-dashboard:{revision}'])
accepted_metadata = (base / 'state/current.json').read_bytes()
accepted_previous = (base / 'state/previous.json').read_bytes()
# Only the attempt count changes in this test; every attempt still performs the
# production HTTP request. Production retains its 30-attempt bound.
production_attempts = ops.READINESS_ATTEMPTS
ops.READINESS_ATTEMPTS = 5
with ops.lock():
    expect_failure(lambda: ops.release_locked(unhealthy_archive, revision, 104, 1, 'auto', unhealthy_id))
ops.READINESS_ATTEMPTS = production_attempts
assert (base / 'state/current.json').read_bytes() == accepted_metadata
assert (base / 'state/previous.json').read_bytes() == accepted_previous
assert ops.current()['runId'] == 103 and ops.current()['imageId'] == image_id
assert not (base / 'private/maintenance/enabled').exists() and not (base / 'state/recovery-required').exists()
assert json.loads(ops.run(['docker', 'image', 'inspect', f'vtc-dashboard:{revision}']))[0]['Id'] == unhealthy_id
for service in ['app', 'probe']:
    container = compose(['ps', '-q', service], revision=revision).decode().strip()
    assert json.loads(ops.run(['docker', 'inspect', container]))[0]['Image'] == image_id
assert json.loads(get('/_operations/readiness', token))['revision'] == revision
assert checksum.encode() in sql('SELECT evidence_sha FROM vtc.rehearsal_reference;')
evidence_check = "const f=require('node:fs');if(f.readFileSync('/app/private-evidence/sentinel.txt','utf8')!=='fictional-evidence-sentinel-vtc011\\n'||f.readFileSync('/app/private-evidence/unhealthy-http-observed.txt','utf8')!=='HTTP_503_OBSERVED\\n')process.exit(1)"
compose(['exec', '-T', 'app', 'node', '-e', evidence_check], revision=revision)
ops.fenced(revision)
with ops.lock():
    export_id = ops.export_locked(revision)
directory, manifest = ops.validate_export(export_id)
assert manifest['evidenceFiles']['sentinel.txt']['sha256'] == checksum
assert manifest['evidenceFiles']['vtc011-sentinel.txt']['sha256'] == manifest['syntheticReference']
assert manifest['imageId'] == image_id  # The revision tag still points at the rejected image.
assert manifest['files']['database.sql']['bytes'] > 0
# Authenticate a full SQL/files/manifest copy before restoring from its recovered bytes.
# This local fixture proves the pipeline; actual off-VM storage/access remains hosted acceptance.
copy_directory = base / 'private/copy-fixture'
copy_directory.mkdir(mode=0o700)
export_tar = copy_directory / 'export.tar'
with tarfile.open(export_tar, 'w') as archive:
    for name in ['database.sql', 'evidence.tar', 'manifest.json']:
        archive.add(directory / name, arcname=name)
key = base / 'private/recovery-test.key'
encrypted = copy_directory / 'export.encrypted'
decrypted = copy_directory / 'recovered.tar'
for args, data in [(['key', str(key)], None), (['seal', str(encrypted), str(key)], export_tar.read_bytes()),
                   (['open', str(encrypted), str(key), str(decrypted)], None)]:
    subprocess.run(['node', str(base / 'recovery-copy.mjs'), *args], input=data, check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
recovered_id = uuid.uuid4().hex
recovered_directory = base / 'state/exports' / recovered_id
recovered_directory.mkdir(mode=0o700)
with tarfile.open(decrypted, 'r:') as archive:
    assert set(archive.getnames()) == {'database.sql', 'evidence.tar', 'manifest.json'}
    for entry in archive.getmembers():
        assert entry.isfile()
        (recovered_directory / entry.name).write_bytes(archive.extractfile(entry).read())
with ops.lock():
    restored_project = ops.restore_locked(recovered_id)
# Restore helper stops destination after verifying ledger/files. Restart only that isolated DB for references.
ops.fenced(revision)
compose(['stop', 'db'], revision=revision)
compose(['up', '-d', '--wait', 'db'], revision=revision, project=restored_project, timeout=120)
restored_sql = compose(['exec', '-T', 'db', 'mysql', '--defaults-extra-file=/run/secrets/admin.cnf', '-N', '-B', '-e',
                        'SELECT evidence_sha FROM vtc.rehearsal_reference WHERE id=1; SELECT state FROM vtc._vtc_migrations; SELECT sequence FROM vtc_operations.heartbeat;'], revision=revision, project=restored_project)
assert checksum.encode() in restored_sql and b'applied' in restored_sql and b'1' in restored_sql
compose(['stop', 'db'], revision=revision, project=restored_project)
compose(['up', '-d', '--wait', 'db'], revision=revision, timeout=120)
# Damage detection must precede database/volume actions and must not mutate the active sentinel.
original = (directory / 'database.sql').read_bytes()
(directory / 'database.sql').write_bytes(original + b'corrupt')
expect_failure(lambda: ops.restore_locked(export_id))
(directory / 'database.sql').write_bytes(original)
assert checksum.encode() in sql('SELECT evidence_sha FROM vtc.rehearsal_reference;')
compose(['up', '-d', '--force-recreate', '--no-deps', 'app', 'probe'], revision=revision)
ops.ready(revision)
assert checksum.encode() in sql('SELECT evidence_sha FROM vtc.rehearsal_reference;')
sql("UPDATE vtc._vtc_migrations SET state='applying';")
with ops.lock():
    expect_failure(lambda: ops.release_locked(image_archive, revision, 105, 1, 'auto', image_id))
assert ops.current()['runId'] == 103 and (base / 'state/recovery-required').exists() and (base / 'private/maintenance/enabled').exists()
compose(['up', '-d', '--wait', 'db'], revision=revision, timeout=120)  # Synthetic root-only inspection, writers remain fenced.
assert b'applying' in sql('SELECT state FROM vtc._vtc_migrations;')
expect_failure(lambda: compose(['run', '--rm', '--no-deps', 'migrate'], revision=revision))
# Real cross-process serialization of the same flock used by every release/export/cron command.
def hold(queue):
    with ops.lock():
        queue.put(time.monotonic())
        time.sleep(0.5)
queue = multiprocessing.Queue()
first = multiprocessing.Process(target=hold, args=(queue,))
second = multiprocessing.Process(target=hold, args=(queue,))
first.start()
a = queue.get(timeout=5)
second.start()
b = queue.get(timeout=5)
first.join(); second.join()
assert b - a >= 0.45
for name in ['../escape', '/absolute', 'nested/../../escape']:
    archive = base / 'unsafe.tar'
    with tarfile.open(archive, 'w') as output:
        entry = tarfile.TarInfo(name); entry.size = 1; output.addfile(entry, io.BytesIO(b'x'))
    expect_failure(lambda: ops.archive_safe(archive))
with tarfile.open(archive, 'w') as output:
    entry = tarfile.TarInfo('link'); entry.type = tarfile.SYMTYPE; entry.linkname = '/outside'; output.addfile(entry)
expect_failure(lambda: ops.archive_safe(archive))
for command in ['sh', 'release $(id)', 'release ;id', 'release ' + 'a' * 40 + ' x 2 1 1 auto', 'export']:
    os.environ['SSH_ORIGINAL_COMMAND'] = command
    expect_failure(ops.receive)
# Exercise bounded stdin failure without ever reaching Docker load or active state.
for data, length, checksum in [(b'x', 2, hashlib.sha256(b'x').hexdigest()), (b'xx', 1, hashlib.sha256(b'x').hexdigest()), (b'x', 1, '0' * 64)]:
    result = subprocess.run(['python3', str(base / 'operations.py'), 'receive'], input=data,
                            env=dict(os.environ, SSH_ORIGINAL_COMMAND=f'release {revision} {checksum} {length} {image_id} 106 1 auto'),
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
    assert result.returncode == 1 and ops.current()['runId'] == 103
print('Synthetic deployment rehearsal passed')
