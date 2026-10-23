import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { TransactionCommitOutcomeUnknownError } from "@vtc/db";
import { expect, test } from "vitest";
import {
  acceptanceDiagnosticRecord,
  acceptanceFailure,
  observeAcceptanceChild,
} from "../../apps/api/src/platform/jobs/acceptance-diagnostics.ts";
import { observeDatabaseOperation } from "../../packages/db/dist/core/operation-context.js";

function syntheticChild() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });
  return { child, observed: child as unknown as ChildProcess };
}

test("acceptance diagnostics preserve fixed guard codes and observed native context without private fields", async () => {
  for (const code of [
    "ACCEPTANCE_GUARD_REQUIRED",
    "INVALID_ACCEPTANCE_MODE",
    "INVALID_APPLICATION_ID",
    "ACCEPTANCE_CLAIM_REQUIRED",
  ])
    expect(acceptanceFailure(new Error(code)).code).toBe(code);
  const native = Object.assign(new Error("SYNTHETIC_PRIVATE_SQL_PASSWORD"), {
    code: "PROTOCOL_SEQUENCE_TIMEOUT",
    sql: "SYNTHETIC_PRIVATE_SQL",
    parameters: ["SYNTHETIC_PRIVATE_ID"],
  });
  await expect(
    observeDatabaseOperation("session_configuration", 1000, async () => {
      throw native;
    }),
  ).rejects.toBe(native);
  const record = acceptanceFailure(new Error("SYNTHETIC_PRIVATE_OUTER", { cause: native }));
  expect(record).toEqual({
    event: "acceptance_failed",
    category: "operation_failed",
    code: "ACCEPTANCE_OPERATION_FAILED",
    nativeCodes: ["PROTOCOL_SEQUENCE_TIMEOUT"],
    databaseOperation: {
      operation: "session_configuration",
      wireDeadlineMs: 1000,
      elapsedMs: expect.any(Number),
    },
  });
  expect(JSON.stringify(record)).not.toContain("SYNTHETIC_PRIVATE");
});

test("unknown COMMIT classification takes precedence and bounded defensive causes keep unknown fallback", () => {
  const uncertain = new TransactionCommitOutcomeUnknownError(
    Object.assign(new Error("ACCEPTANCE_CLAIM_REQUIRED"), { code: "ER_LOCK_WAIT_TIMEOUT" }),
  );
  expect(acceptanceFailure(uncertain)).toMatchObject({
    category: "commit_outcome_unknown",
    code: "TRANSACTION_COMMIT_OUTCOME_UNKNOWN",
    nativeCodes: ["ER_LOCK_WAIT_TIMEOUT"],
  });
  const cycle: Record<string, unknown> = { code: "ER_LOCK_DEADLOCK", message: "SYNTHETIC_PRIVATE" };
  cycle.cause = cycle;
  expect(acceptanceFailure(cycle).nativeCodes).toEqual(["ER_LOCK_DEADLOCK"]);
  const hostile = Object.create(null);
  for (const key of ["message", "code", "cause"])
    Object.defineProperty(hostile, key, {
      get() {
        throw Error("SYNTHETIC_PRIVATE");
      },
    });
  for (const value of [hostile, null, "SYNTHETIC_PRIVATE", { code: "SYNTHETIC_PRIVATE" }])
    expect(acceptanceFailure(value)).toEqual({
      event: "acceptance_failed",
      category: "operation_failed",
      code: "ACCEPTANCE_OPERATION_FAILED",
      nativeCodes: [],
    });
  let deep: unknown = uncertain;
  for (let i = 0; i < 8; i++) deep = { cause: deep };
  expect(acceptanceFailure(deep).category).toBe("operation_failed");
});

test("child record reconstruction rejects unknown events and strips arbitrary fields and invalid contexts", () => {
  const input = {
    event: "acceptance_failed",
    category: "operation_failed",
    code: "ACCEPTANCE_CLAIM_REQUIRED",
    nativeCodes: ["ER_LOCK_DEADLOCK", "SYNTHETIC_PRIVATE"],
    databaseOperation: {
      operation: "migration_statement",
      wireDeadlineMs: 30000,
      elapsedMs: 2,
      sql: "SYNTHETIC_PRIVATE",
    },
    args: ["SYNTHETIC_PRIVATE"],
  };
  expect(acceptanceDiagnosticRecord(input)).toEqual({
    event: "acceptance_failed",
    category: "operation_failed",
    code: "ACCEPTANCE_CLAIM_REQUIRED",
    nativeCodes: ["ER_LOCK_DEADLOCK"],
    databaseOperation: { operation: "migration_statement", wireDeadlineMs: 30000, elapsedMs: 2 },
  });
  expect(
    acceptanceDiagnosticRecord({
      ...input,
      databaseOperation: { operation: "migration_statement", wireDeadlineMs: true, elapsedMs: -1 },
    }),
  ).not.toHaveProperty("databaseOperation");
  for (const value of [
    null,
    [],
    { event: "private" },
    {
      ...input,
      category: {
        toString() {
          throw Error("PRIVATE");
        },
      },
    },
  ])
    expect(acceptanceDiagnosticRecord(value)).toBeUndefined();
});

test("child observer waits for close after exit and drains bounded redacted final records", async () => {
  const { child, observed } = syntheticChild(),
    records: Record<string, unknown>[] = [];
  let settled = false;
  const done = observeAcceptanceChild(observed, (record) => records.push(record)).then((code) => {
    settled = true;
    return code;
  });
  child.emit("exit", 1, null);
  await Promise.resolve();
  expect(settled).toBe(false);
  child.stdout.write("SYNTHETIC_PRIVATE".repeat(10000) + "\n");
  child.stderr.write("{malformed}\n");
  for (let i = 0; i < 12; i++)
    child.stderr.write(
      JSON.stringify({
        event: "jobs_failed",
        category: "hard_deadline",
        args: "SYNTHETIC_PRIVATE",
      }) + "\n",
    );
  child.stdout.end();
  child.stderr.end();
  child.emit("close", 1, null);
  expect(await done).toBe(1);
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({
    closeConfirmed: true,
    exitCode: 1,
    signal: null,
    spawnErrorCategory: null,
  });
  expect(records[0]?.failures).toHaveLength(8);
  expect(JSON.stringify(records)).not.toContain("SYNTHETIC_PRIVATE");
});

test("actual native child failure metadata survives final stream drain without forwarding private payload", async () => {
  const records: Record<string, unknown>[] = [];
  const child = spawn(
    process.execPath,
    [
      "-e",
      'console.log("SYNTHETIC_PRIVATE"); console.error(JSON.stringify({event:"acceptance_failed",category:"operation_failed",code:"ACCEPTANCE_CLAIM_REQUIRED",sql:"SYNTHETIC_PRIVATE"})); process.exitCode=3;',
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  expect(await observeAcceptanceChild(child, (record) => records.push(record))).toBe(3);
  expect(records[0]).toMatchObject({
    exitCode: 3,
    closeConfirmed: true,
    signal: null,
    failures: [
      {
        event: "acceptance_failed",
        category: "operation_failed",
        code: "ACCEPTANCE_CLAIM_REQUIRED",
        nativeCodes: [],
      },
    ],
  });
  expect(JSON.stringify(records)).not.toContain("SYNTHETIC_PRIVATE");
});

test("spawn errors and diagnostic sink errors preserve observed native settlement", async () => {
  const records: Record<string, unknown>[] = [];
  const child = spawn("vtc029-nonexistent-synthetic-child", [], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const code = await observeAcceptanceChild(child, (record) => records.push(record));
  expect(code).not.toBe(0);
  expect(records[0]).toMatchObject({
    closeConfirmed: true,
    exitCode: null,
    spawnErrorCategory: "ENOENT",
  });
  const { child: fixture, observed } = syntheticChild();
  const done = observeAcceptanceChild(observed, () => {
    throw Error("SYNTHETIC_PRIVATE");
  });
  fixture.stdout.end();
  fixture.stderr.end();
  fixture.emit("close", 7, null);
  expect(await done).toBe(7);
});
