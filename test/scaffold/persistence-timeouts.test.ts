import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import type { AddressInfo, Server, Socket } from "node:net";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { expectedMysqlVersion, requiredSqlModes } from "@vtc/db";

// Explicit synthetic protocol peer, never a real MySQL connection or production identity.
interface PeerConnection extends EventEmitter {
  stream: Socket;
  sequenceId: number;
  serverHandshake(options: Record<string, unknown>): void;
  writeOk(): void;
  writeError(options: { code: number; message: string }): void;
  writeColumns(columns: Record<string, string | number>[]): void;
  writeTextRow(row: string[]): void;
  writeEof(): void;
}
interface PeerServer extends EventEmitter {
  _server: Server;
  close(callback: (error?: Error) => void): void;
}
const require = createRequire(new URL("../../packages/db/package.json", import.meta.url));
const mysql = require("mysql2") as { createServer(): PeerServer };
type Phase =
  | "commit"
  | "commit-delayed"
  | "commit-late"
  | "commit-error"
  | "rollback"
  | "rollback-queued"
  | "migration-baseline"
  | "migration-statement"
  | "migration-journal";

async function peer(phase: Phase) {
  const server = mysql.createServer();
  const sockets = new Set<Socket>();
  const acknowledgements = new Set<ReturnType<typeof setTimeout>>();
  const counts = {
    commits: 0,
    rollbacks: 0,
    stalls: 0,
    ends: 0,
    applying: 0,
    applied: 0,
    releaseQueries: 0,
    delayedAcks: 0,
  };
  server.on("connection", (connection: PeerConnection) => {
    connection.stream.allowHalfOpen = true;
    sockets.add(connection.stream);
    connection.stream.once("end", () => counts.ends++);
    connection.stream.once("close", () => sockets.delete(connection.stream));
    connection.on("error", () => {});
    let authenticated = false;
    connection.stream.prependListener("data", () => {
      if (authenticated) connection.sequenceId = 0;
    });
    connection.serverHandshake({
      protocolVersion: 10,
      serverVersion: expectedMysqlVersion,
      connectionId: 1,
      statusFlags: 2,
      characterSet: 45,
      capabilityFlags: 0x00088200,
      authCallback: (_input: unknown, done: (error: null) => void) => {
        authenticated = true;
        done(null);
      },
    });
    const rows = (names: string[], values: string[][]) => {
      connection.writeColumns(
        names.map((name) => ({
          catalog: "def",
          schema: "",
          table: "",
          orgTable: "",
          name,
          orgName: name,
          characterSet: 45,
          columnLength: 255,
          columnType: 253,
          flags: 0,
          decimals: 0,
        })),
      );
      for (const row of values) connection.writeTextRow(row);
      connection.writeEof();
    };
    connection.on("stmt_prepare", () => connection.writeOk());
    connection.on("query", (query: string) => {
      if (phase === "rollback-queued" && query === "SELECT synthetic_stalled_domain") {
        counts.stalls++;
        return;
      }
      if (query === "COMMIT") {
        counts.commits++;
        if ((phase === "commit-delayed" || phase === "commit-late") && counts.commits === 1) {
          const timer = setTimeout(
            () => {
              acknowledgements.delete(timer);
              counts.delayedAcks++;
              connection.writeOk();
            },
            phase === "commit-delayed" ? 2300 : 5600,
          );
          acknowledgements.add(timer);
          return;
        }
        if (phase === "commit-error" && counts.commits === 1) {
          connection.writeError({ code: 1105, message: "SYNTHETIC_PRIVATE_COMMIT_DIAGNOSTIC" });
          return;
        }
        if (phase === "commit" && counts.commits <= 5) {
          counts.stalls++;
          return;
        }
      }
      if (query === "ROLLBACK") {
        counts.rollbacks++;
        if (phase === "rollback") {
          counts.stalls++;
          return;
        }
      }
      if (query.startsWith("SELECT GET_LOCK")) {
        rows(["acquired"], [["1"]]);
        return;
      }
      if (query.startsWith("SELECT RELEASE_LOCK")) {
        counts.releaseQueries++;
        rows(["released"], [["1"]]);
        return;
      }
      if (query.startsWith("SELECT VERSION")) {
        if (phase === "migration-baseline") {
          counts.stalls++;
          return;
        }
        rows(
          [
            "version",
            "engine",
            "charsetName",
            "collationName",
            "sqlMode",
            "timezone",
            "isolationLevel",
          ],
          [
            [
              expectedMysqlVersion,
              "InnoDB",
              "utf8mb4",
              "utf8mb4_0900_ai_ci",
              requiredSqlModes.join(","),
              "+00:00",
              "REPEATABLE-READ",
            ],
          ],
        );
        return;
      }
      if (query.startsWith("SELECT version, hash, state")) {
        rows(["version", "hash", "state"], []);
        return;
      }
      if (query.startsWith("INSERT INTO _vtc_migrations")) counts.applying++;
      if (query.startsWith("CREATE TABLE `audit_entries`")) {
        if (phase === "migration-statement") {
          counts.stalls++;
          return;
        }
      }
      if (query.startsWith("UPDATE _vtc_migrations")) {
        if (phase === "migration-journal") {
          counts.stalls++;
          return;
        }
        counts.applied++;
      }
      connection.writeOk();
    });
  });
  await new Promise<void>((resolve) => server._server.listen(0, "127.0.0.1", resolve));
  return {
    counts,
    port: (server._server.address() as AddressInfo).port,
    async close() {
      for (const timer of acknowledgements) clearTimeout(timer);
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function probe(phase: Phase, body: string) {
  const fixture = await peer(phase);
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
import assert from 'node:assert/strict';
import { createUnitOfWork, runMigrations, databaseFailureContext, TransactionCommitOutcomeUnknownError, TRANSACTION_COMMIT_OUTCOME_UNKNOWN } from '@vtc/db';
const settings = { host: '127.0.0.1', port: Number(process.env.FIXTURE_PORT),
  database: 'synthetic_database', user: 'synthetic_user', password: 'NONFUNCTIONAL_EXAMPLE_ONLY' };
${body}
`,
    ],
    {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      env: { ...process.env, FIXTURE_PORT: String(fixture.port) },
      stdio: "ignore",
    },
  );
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const code = await Promise.race([
      exited,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Synthetic child exceeded cleanup deadline")),
          ["commit", "commit-delayed", "commit-late"].includes(phase) ? 8500 : 3500,
        );
      }),
    ]);
    assert.equal(code, 0, phase);
    const deadline = Date.now() + 500;
    const expectedEnds =
      phase === "commit"
        ? 6
        : ["rollback-queued", "commit-late", "commit-error"].includes(phase)
          ? 2
          : 1;
    while (fixture.counts.ends < expectedEnds && Date.now() < deadline) await delay(10);
    assert.equal(fixture.counts.ends, expectedEnds, "client sockets disposed before peer cleanup");
    if (phase === "commit-late") {
      const lateDeadline = Date.now() + 1500;
      while (fixture.counts.delayedAcks === 0 && Date.now() < lateDeadline) await delay(10);
      assert.equal(fixture.counts.delayedAcks, 1, "late response follows natural child exit");
    }
    return fixture.counts;
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill();
    await exited;
    // Half-open peers stay alive until AFTER natural child exit was asserted above.
    await fixture.close();
  }
}

test("five stalled COMMITs reject, dispose half-open sockets, recover pool capacity and shut down naturally", async () => {
  const counts = await probe(
    "commit",
    `
const unit = createUnitOfWork(settings);
try {
  let calls = 0;
  const started = performance.now();
  const results = await Promise.allSettled(Array.from({length: 5}, () => unit.run(async () => { calls++; return 1; })));
  assert.equal(calls, 5, 'uncertain commands are not retried');
  assert.ok(performance.now() - started >= 4500, 'COMMIT retains its five-second receipt budget');
  assert.ok(performance.now() - started < 7000, 'COMMIT rejection remains bounded');
  assert.equal(results.filter(result => result.status === 'rejected').length, 5);
  for (const result of results) {
    assert.equal(result.status, 'rejected');
    const error = result.reason;
    assert.ok(error instanceof TransactionCommitOutcomeUnknownError);
    assert.equal(error.code, TRANSACTION_COMMIT_OUTCOME_UNKNOWN);
    assert.equal(error.message, TRANSACTION_COMMIT_OUTCOME_UNKNOWN);
    assert.ok(error.cause instanceof Error);
    assert.ok(error.cause.code === 'PROTOCOL_SEQUENCE_TIMEOUT' || error.cause.message === 'TRANSACTION_CONTROL_TIMEOUT');
    assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(error)), 'cause'), false);
  }
  assert.equal(await unit.run(async () => 2), 2);
} finally { await unit.close(); }
`,
  );
  assert.equal(counts.commits, 6);
  assert.equal(counts.stalls, 5);
  assert.equal(counts.rollbacks, 0, "uncertain COMMIT must not queue ROLLBACK");
  assert.equal(counts.ends, 6);
});

test("a delayed COMMIT acknowledgement inside five seconds completes the callback exactly once", async () => {
  const counts = await probe(
    "commit-delayed",
    `
const unit = createUnitOfWork(settings);
let calls = 0;
const started = performance.now();
try {
  assert.equal(await unit.run(async () => { calls++; return 7; }), 7);
  assert.equal(calls, 1);
  assert.ok(performance.now() - started >= 2100);
  assert.ok(performance.now() - started < 5000);
} finally { await unit.close(); }
`,
  );
  assert.equal(counts.commits, 1);
  assert.equal(counts.delayedAcks, 1);
  assert.equal(counts.rollbacks, 0);
});

test("a COMMIT acknowledgement after five seconds stays unknown, discards its socket and recovers capacity without retry", async () => {
  const counts = await probe(
    "commit-late",
    `
const unit = createUnitOfWork(settings);
let calls = 0;
const started = performance.now();
try {
  await assert.rejects(unit.run(async () => { calls++; return 1; }), error => {
    assert.ok(error instanceof TransactionCommitOutcomeUnknownError);
    assert.equal(error.code, TRANSACTION_COMMIT_OUTCOME_UNKNOWN);
    assert.ok(error.cause instanceof Error);
    assert.ok(error.cause.code === 'PROTOCOL_SEQUENCE_TIMEOUT' || error.cause.message === 'TRANSACTION_CONTROL_TIMEOUT');
    return true;
  });
  assert.equal(calls, 1);
  assert.ok(performance.now() - started >= 4500);
  assert.ok(performance.now() - started < 7000);
  assert.equal(await unit.run(async () => 2), 2);
} finally { await unit.close(); }
`,
  );
  assert.equal(counts.commits, 2);
  assert.equal(counts.rollbacks, 0);
  assert.equal(counts.delayedAcks, 1);
});

test("server COMMIT errors have a safe distinct outcome code with the original private cause", async () => {
  const counts = await probe(
    "commit-error",
    `
const unit = createUnitOfWork(settings);
let calls = 0;
try {
  await assert.rejects(unit.run(async () => { calls++; return 1; }), error => {
    assert.ok(error instanceof TransactionCommitOutcomeUnknownError);
    assert.equal(error.code, TRANSACTION_COMMIT_OUTCOME_UNKNOWN);
    assert.equal(error.message, TRANSACTION_COMMIT_OUTCOME_UNKNOWN);
    assert.ok(error.cause instanceof Error);
    assert.equal(error.cause.code, 'ER_UNKNOWN_ERROR');
    assert.ok(error.cause.message.includes('SYNTHETIC_PRIVATE_COMMIT_DIAGNOSTIC'));
    assert.equal(JSON.stringify(error).includes('SYNTHETIC_PRIVATE_COMMIT_DIAGNOSTIC'), false);
    return true;
  });
  assert.equal(calls, 1);
  assert.equal(await unit.run(async () => 2), 2);
} finally { await unit.close(); }
`,
  );
  assert.equal(counts.commits, 2);
  assert.equal(counts.rollbacks, 0);
});

test("stalled rollback preserves the command failure and disposes its half-open socket", async () => {
  const counts = await probe(
    "rollback",
    `
const unit = createUnitOfWork(settings);
const failure = new Error('SYNTHETIC_COMMAND_FAILURE');
const started = performance.now();
try {
  await assert.rejects(unit.run(async () => { throw failure; }), error => error === failure && !(error instanceof TransactionCommitOutcomeUnknownError));
  assert.ok(performance.now() - started >= 800);
  assert.ok(performance.now() - started < 2500, 'ROLLBACK retains its one-second budget');
}
finally { await unit.close(); }
`,
  );
  assert.equal(counts.rollbacks, 1);
  assert.equal(counts.stalls, 1);
});

test("rollback queued behind unresolved wire work is wall-clock bounded and releases the pool", async () => {
  const counts = await probe(
    "rollback-queued",
    `
import { sql } from 'drizzle-orm';
import { setTimeout as delay } from 'node:timers/promises';
const unit = createUnitOfWork(settings);
const failure = new Error('SYNTHETIC_COMMAND_FAILURE');
const started = performance.now();
try {
  await assert.rejects(unit.run(async tx => {
    // Deliberately simulate a caller abort while its query is still active on the wire.
    const pending = unit.client(tx).execute(sql.raw('SELECT synthetic_stalled_domain')).then(() => {}, () => {});
    await Promise.race([pending, delay(50)]);
    throw failure;
  }), error => error === failure && !(error instanceof TransactionCommitOutcomeUnknownError));
  assert.ok(performance.now() - started >= 800);
  assert.ok(performance.now() - started < 2500, 'queued ROLLBACK retains its one-second wall bound');
  assert.equal(await unit.run(async () => 2), 2);
} finally { await unit.close(); }
`,
  );
  assert.equal(counts.stalls, 1);
  assert.equal(
    counts.rollbacks,
    0,
    "queued rollback never reached the wire, so its driver timer could not start",
  );
});

for (const phase of ["migration-baseline", "migration-statement", "migration-journal"] as const) {
  test(`${phase} timeout disposes half-open socket without queued lock cleanup`, async () => {
    const counts = await probe(
      phase,
      `
await assert.rejects(runMigrations(settings, { statementTimeoutMs: 100 }), error => {
  const context = databaseFailureContext(error);
  assert.equal(context?.operation, '${phase === "migration-baseline" ? "migration_baseline" : phase === "migration-statement" ? "migration_statement" : "migration_journal_finalize"}');
  assert.equal(context.wireDeadlineMs, ${phase === "migration-statement" ? 100 : 1000});
  assert.ok(context.elapsedMs >= ${phase === "migration-statement" ? 80 : 800});
  assert.deepEqual(Object.keys(context).sort(), ['elapsedMs', 'operation', 'wireDeadlineMs']);
  return true;
});
`,
    );
    assert.equal(counts.stalls, 1);
    assert.equal(counts.releaseQueries, 0);
    assert.equal(counts.applying, phase === "migration-baseline" ? 0 : 1);
    assert.equal(counts.applied, 0);
  });
}
