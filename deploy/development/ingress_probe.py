"""Anonymous ingress/rate acceptance with allocation-owned client containers and safe output."""
import hashlib
import hmac
import json
import time
import uuid

import activation


def check(o, revision, image_id, *, cleanup=False, ca=None):
    marker = o.BASE / 'state/ingress-check.json'

    def remove(state):
        o.require(state.get('version') == 1 and state.get('project') == o.PROJECT and
                  state.get('imageId') == image_id and
                  isinstance(state.get('runId'), str) and
                  uuid.UUID(state['runId']).version == 4, 'INGRESS_CHECK_OWNERSHIP_INVALID')
        for index in range(8):
            name = f"{o.PROJECT}-ingress-{state['runId'][:8]}-{index}"
            ids = o.run(['docker', 'ps', '-aq', '--filter', f'name=^/{name}$'], timeout=10).decode().split()
            if ids:
                o.require(len(ids) == 1, 'INGRESS_CHECK_CONTAINER_INVALID')
                info = json.loads(o.run(['docker', 'inspect', ids[0]], timeout=10))[0]
                o.require(info['Name'] == '/' + name and
                          info['Config']['Labels'].get('vtc.ingress-check') == state['runId'],
                          'INGRESS_CHECK_CONTAINER_OWNERSHIP_INVALID')
                o.run(['docker', 'rm', '-f', ids[0]], timeout=20)
            o.require(not o.run(['docker', 'ps', '-aq', '--filter', f'name=^/{name}$'], timeout=10).strip(),
                      'INGRESS_CHECK_CONTAINER_REMAINS')
        marker.unlink()

    if cleanup:
        remove(json.loads(marker.read_text()))
        return
    o.require(not marker.exists() and
              not (o.BASE / 'private/maintenance/enabled').exists() and
              not (o.BASE / 'state/recovery-required').exists() and
              not (o.BASE / 'state/identity-acceptance').exists(), 'INGRESS_CHECK_FENCED')
    values = activation.private_values(o, o.BASE / 'private/identity-mail.env', activation.SHARED_KEYS)
    o.require(values.get('IDENTITY_ENABLED') == 'true', 'IDENTITY_REQUIRED')
    o.validate_image(image_id, revision)
    activation.ingress(o)
    state = {'version': 1, 'project': o.PROJECT, 'runId': str(uuid.uuid4()), 'imageId': image_id}
    o.atomic_json(marker, state)
    def query(statement):
        return o.compose(['exec', '-T', 'db', 'mysql', '--defaults-extra-file=/run/secrets/admin.cnf',
                          '-N', '-B'], revision=revision, image_id=image_id, data=statement.encode()).decode().strip()
    def counter(bucket):
        result = query(f"SELECT count FROM vtc.identity_limits WHERE bucket='{bucket}' AND `window`=FLOOR(UNIX_TIMESTAMP(UTC_TIMESTAMP())/60);")
        return int(result or '0')
    try:
        # Begin early in a minute; never reset an existing source/global counter.
        if time.time() % 60 > 20:
            time.sleep(60 - time.time() % 60 + 0.1)
        window = query('SELECT FLOOR(UNIX_TIMESTAMP(UTC_TIMESTAMP())/60);')
        baseline = counter('global:csrf')
        o.require(baseline <= 170, 'INGRESS_CHECK_CAPACITY_PENDING')
        selected, buckets = [], []
        for index in range(8):
            name = f"{o.PROJECT}-ingress-{state['runId'][:8]}-{index}"
            o.run(['docker', 'run', '-d', '--name', name, '--label',
                   f"vtc.ingress-check={state['runId']}", '--label', f'vtc011.rehearsal={o.PROJECT}',
                   '--network', f'{o.PROJECT}_frontend', '--read-only', '--cap-drop', 'ALL',
                   '--security-opt', 'no-new-privileges:true', '--memory', '64m', '--pids-limit', '32',
                   image_id, 'node', '-e', 'setInterval(()=>{},1000)'])
            info = json.loads(o.run(['docker', 'inspect', name]))[0]
            address = info['NetworkSettings']['Networks'][f'{o.PROJECT}_frontend']['IPAddress']
            bucket = hmac.new(values['IDENTITY_SECRET'].encode(), address.encode(), hashlib.sha256).digest()[0]
            if bucket not in buckets and counter(f'source:csrf:{bucket}') == 0:
                selected.append(name)
                buckets.append(bucket)
            if len(selected) == 2:
                break
        o.require(len(selected) == 2, 'INGRESS_CHECK_SLOTS_PENDING')
        # Resolve the configured origin to the proxy only for this owned test client.
        # TLS still validates the configured hostname using the normal CA store.
        proxy = o.compose(['ps', '-q', 'proxy'], revision=revision, image_id=image_id).decode().strip()
        info = json.loads(o.run(['docker', 'inspect', proxy]))[0]
        address = info['NetworkSettings']['Networks'][f'{o.PROJECT}_frontend']['IPAddress']
        source = ("const https=require('node:https');const u=new URL(" + json.dumps(values['IDENTITY_ORIGIN']) + ");"
                  "const call=()=>new Promise((ok,no)=>{const r=https.get({hostname:u.hostname,port:u.port||443,"
                  "path:'/api/v1/auth/csrf',lookup:(_h,_o,cb)=>cb(null,[{address:" + json.dumps(address) + ",family:4}]),"
                  + ("ca:" + json.dumps(ca) + "," if ca else "") +
                  "headers:{'X-Forwarded-For':Math.random()+', 198.51.100.99',Forwarded:'for=198.51.100.98'}},"
                  "r=>{r.resume();r.on('end',()=>ok({status:r.statusCode,retry:r.headers['retry-after']}))});"
                  "r.setTimeout(4000,()=>r.destroy());r.on('error',no)});"
                  "let result=[];for(let i=0;i<Number(process.argv[1]);i++)result.push(await call());"
                  "console.log(JSON.stringify(result));")
        def requests(name, count):
            return json.loads(o.run(['docker', 'exec', name, 'node', '-e',
                              '(async()=>{' + source + '})().catch(()=>process.exit(1));', str(count)], timeout=30))
        o.require(all(value['status'] == 200 for value in requests(selected[0], 20)), 'INGRESS_CHECK_ADMISSION_FAILED')
        o.require(requests(selected[0], 1) == [{'status': 429, 'retry': '60'}] and
                  counter('global:csrf') == baseline + 20, 'INGRESS_CHECK_DENIAL_FAILED')
        o.require(requests(selected[1], 1)[0]['status'] == 200 and
                  counter(f'source:csrf:{buckets[0]}') == 21 and
                  counter(f'source:csrf:{buckets[1]}') == 1, 'INGRESS_CHECK_SOURCE_FAILED')
        o.compose(['up', '-d', '--force-recreate', '--no-deps', 'app'], revision=revision, image_id=image_id)
        o.ready(revision, image_id)
        o.require(requests(selected[0], 1)[0]['status'] == 429 and
                  counter('global:csrf') == baseline + 21 and
                  query('SELECT FLOOR(UNIX_TIMESTAMP(UTC_TIMESTAMP())/60);') == window,
                  'INGRESS_CHECK_RECREATION_FAILED')
        o.atomic_json(o.BASE / 'state/ingress-check-last.json', {'event': 'ingress_check',
                      'revision': revision, 'imageId': image_id, 'distinctSources': 2,
                      'spoofIgnored': True, 'sourceLimit': True, 'globalIsolation': True,
                      'recreationPersisted': True})
    finally:
        remove(state)
