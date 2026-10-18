"""Synthetic-only Docker rehearsal. Its root/socket privileges belong only to the operator test."""
import hashlib
import importlib.util
import io
import json
import multiprocessing
import os
import pathlib
import shutil
import ssl
import subprocess
import tarfile
import tempfile
import time
import urllib.error
import urllib.request
import uuid
import zipfile

base = pathlib.Path('/opt/vtc-development')
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
result = subprocess.run(['docker', 'compose', '--profile', '*', '-f', str(base / 'compose.yaml'), 'config', '--format', 'json'],
                        env=dict(os.environ, VTC_REVISION=revision, VTC_IMAGE_ID=image_id), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=True)
config = json.loads(result.stdout)
config['name'] = project
label = {'vtc011.rehearsal': project}
for name, value in config['services'].items():
    value['labels'] = label
    value.pop('ports', None)
    if name in ['app', 'probe', 'heartbeat', 'migrate']:
        value['image'] = '${VTC_IMAGE_ID:?Set the validated immutable image ID}'
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


compose(['up', '-d', '--wait', 'db'], revision=revision, timeout=240)
compose(['run', '--rm', '--no-deps', 'migrate'], revision=revision)
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
runtime_negative = """const mysql=require('mysql2/promise'); const c=await mysql.createConnection({host:process.env.MYSQL_HOST,user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD,database:'vtc'}); for(const sql of ['CREATE TABLE forbidden (id INT)','SET GLOBAL max_connections=99','SELECT * FROM mysql.user','UPDATE _vtc_migrations SET state=\\'applying\\'']) {let denied=false;try{await c.query(sql)}catch{denied=true}if(!denied)process.exit(1)}await c.end();"""
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
