import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const probe = new URL("../../deploy/development/probe.mjs", import.meta.url);
const probeHash = createHash("sha256").update(readFileSync(probe)).digest("hex");
const heartbeatSql =
  "INSERT INTO heartbeat (singleton, at_utc, sequence) VALUES (1, UTC_TIMESTAMP(3), 1) ON DUPLICATE KEY UPDATE at_utc=UTC_TIMESTAMP(3), sequence=sequence+1";

function runProbe(phase: "success" | "acquire" | "query" | "invalid", shape = "unknown") {
  const script = `
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const probe = ${JSON.stringify(probe.href)};
const phase = ${JSON.stringify(phase)}, shape = ${JSON.stringify(shape)};
const require = createRequire(import.meta.resolve('@vtc/db'));
const fromProbe = createRequire(createRequire(probe).resolve('@vtc/db'));
const mysql = require('mysql2/promise');
const original = mysql.createPool;
const calls = [];
let hostileAccesses = 0;
function failure() {
  if (shape === 'null') return null;
  if (shape === 'primitive') return 'FICTIONAL_PRIVATE_ERROR';
  if (shape === 'plain') return { code: 'ECONNREFUSED', message: 'FICTIONAL_PRIVATE_MESSAGE' };
  const error = new Error('FICTIONAL_PRIVATE_MESSAGE mysql://fictional:nonfunctional@example.invalid/db');
  error.sql = 'FICTIONAL_PRIVATE_SQL';
  error.sqlMessage = 'FICTIONAL_PRIVATE_SQL_MESSAGE';
  error.errno = 999999;
  error.cause = error;
  if (shape === 'getter') Object.defineProperty(error, 'code', { get() { hostileAccesses++; throw Error('CODE_GETTER_EXECUTED'); } });
  else if (shape === 'proxy') return new Proxy(error, {
    getOwnPropertyDescriptor() { hostileAccesses++; throw Error('FICTIONAL_DESCRIPTOR_FAILURE'); },
    get() { hostileAccesses++; throw Error('FICTIONAL_PROPERTY_FAILURE'); }
  });
  else if (shape === 'object') error.code = { toString() { hostileAccesses++; throw Error('CODE_COERCION_EXECUTED'); } };
  else if (shape === 'unknown') error.code = 'FICTIONAL_PRIVATE_CODE';
  else error.code = shape;
  return error;
}
const connection = {
  async query(options) {
    calls.push('query');
    assert.equal(options.timeout, 1000);
    assert.equal(options.sql, ${JSON.stringify(heartbeatSql)});
    if (phase === 'query') throw failure();
    return [{ affectedRows: 1 }, []];
  },
  destroy() { calls.push('destroy'); },
  release() { calls.push('release'); }
};
mysql.createPool = (options) => {
  calls.push('pool');
  assert.deepEqual(options, {
    host: '127.0.0.1', port: 3306, database: 'vtc_operations',
    user: 'fictional_probe', password: 'NONFUNCTIONAL_EXAMPLE_ONLY',
    connectionLimit: 1, waitForConnections: false, connectTimeout: 1000, timezone: 'Z'
  });
  return {
    async getConnection() {
      calls.push('acquire');
      if (phase === 'acquire') throw failure();
      return connection;
    },
    async end() { calls.push('end'); }
  };
};
try {
  assert.equal(fromProbe.resolve('mysql2/promise'), require.resolve('mysql2/promise'));
  assert.equal(fromProbe('mysql2/promise'), mysql);
  assert.equal(createHash('sha256').update(readFileSync(new URL(probe))).digest('hex'), ${JSON.stringify(probeHash)});
  process.argv = [process.execPath, new URL(probe).pathname, phase === 'invalid' ? 'invalid' : 'heartbeat'];
  await import(probe);
  const expected = phase === 'success' ? ['pool', 'acquire', 'query', 'release', 'end']
    : phase === 'acquire' ? ['pool', 'acquire', 'end']
    : phase === 'query' ? ['pool', 'acquire', 'query', 'destroy', 'release', 'end']
    : ['pool', 'end'];
  assert.deepEqual(calls, expected);
  assert.equal(hostileAccesses, 0);
  assert.equal(process.getActiveResourcesInfo().some(name => /TCP|GetAddrInfo/.test(name)), false);
  assert.equal(process.exitCode ?? 0, phase === 'success' ? 0 : 1);
} catch {
  // A fixture assertion must never be mistaken for the expected production exit 1.
  process.stderr.write('PROBE_FIXTURE_ASSERTION_FAILED\\n');
  process.exitCode = 86;
} finally {
  mysql.createPool = original;
}
`;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    cwd: root,
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      NODE_ENV: "test",
      TZ: "UTC",
      MYSQL_HOST: "127.0.0.1",
      MYSQL_USER: "fictional_probe",
      MYSQL_PASSWORD: "NONFUNCTIONAL_EXAMPLE_ONLY",
      VTC_REVISION: "a".repeat(40),
    },
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 65536,
    windowsHide: true,
  });
  assert.equal(result.error, undefined, "PROBE_FIXTURE_CHILD_MUST_SETTLE");
  assert.equal(result.signal, null);
  assert.equal(result.status, phase === "success" ? 0 : 1, "PROBE_FIXTURE_EXIT");
  assert.doesNotMatch(result.stderr, /PROBE_FIXTURE_ASSERTION_FAILED/);
  if (phase === "success") {
    assert.equal(result.stdout, "Heartbeat: success\n");
    assert.equal(result.stderr, "");
    return;
  }
  assert.equal(result.stdout, "");
  if (phase === "invalid") {
    assert.equal(result.stderr, "");
    return;
  }
  const lines = result.stderr.trim().split(/\r?\n/);
  assert.equal(lines[0], "Heartbeat: unavailable");
  assert.equal(lines.length, 2);
  assert.ok(Buffer.byteLength(lines[1] as string) < 512);
  const record = JSON.parse(lines[1] as string);
  assert.deepEqual(Object.keys(record).sort(), [
    "deadlineMs",
    "elapsedMs",
    "event",
    "nativeCode",
    "phase",
    "schemaVersion",
  ]);
  assert.equal(record.event, "probe.heartbeat_failed");
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.phase, phase);
  assert.equal(record.deadlineMs, 1000);
  assert.ok(Number.isSafeInteger(record.elapsedMs) && record.elapsedMs >= 0);
  assert.doesNotMatch(result.stderr, /FICTIONAL_|mysql:\/\/|example\.invalid/);
  return record;
}

test("actual heartbeat entrypoint succeeds once with unchanged limits and pool disposal", () => {
  runProbe("success");
});

test("actual heartbeat entrypoint preserves acquisition failure and reports its safe native code", () => {
  assert.equal(runProbe("acquire", "ECONNREFUSED")?.nativeCode, "ECONNREFUSED");
});

test("actual heartbeat entrypoint retains query native codes before wrapping and disposes once", () => {
  for (const code of [
    "PROTOCOL_SEQUENCE_TIMEOUT",
    "ER_NO_SUCH_TABLE",
    "ER_TABLEACCESS_DENIED_ERROR",
  ])
    assert.equal(runProbe("query", code)?.nativeCode, code);
});

test("actual heartbeat diagnostics reject unknown, private, getter, proxy and non-error values", () => {
  for (const phase of ["acquire", "query"] as const)
    for (const shape of ["unknown", "getter", "proxy", "object", "primitive", "plain", "null"])
      assert.equal(runProbe(phase, shape)?.nativeCode, "unknown");
});

test("invalid probe mode closes its pool without starting a database operation or diagnostics", () => {
  runProbe("invalid");
});
