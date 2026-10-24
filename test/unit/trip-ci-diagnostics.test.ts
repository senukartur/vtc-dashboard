import { expect, test } from "vitest";
import { collectEvents, qualityReport } from "../../scripts/ci-result.mjs";
import { generationProcessLine } from "../support/manual-generation-diagnostics.ts";
import { manualJobsObservation } from "../support/manual-jobs-diagnostics.ts";

test("actual CI collection/report retain closed pre503, worker boundary and owned CLI failure facts across chunks", () => {
  const failure = {
    event: "identity_fixture",
    fixture: "reconciliation",
    phase: "transaction",
    state: "failed",
    durationMs: 5,
    caseId: "reconciliation_root_submit",
    step: "submit",
    transactionOrdinal: 1,
    category: "transaction_control_timeout",
    codes: ["TRANSACTION_COMMIT_OUTCOME_UNKNOWN", "ETIMEDOUT"],
  };
  const worker = JSON.parse(
    generationProcessLine({
      event: "manual_generation_process",
      caseId: "generation_progress",
      ordinal: 2,
      state: "close",
      durationMs: 5010,
      exitCode: null,
      signal: "SIGKILL",
      timerFired: true,
      caseAborted: false,
      spawnFailed: false,
      firstStop: "child_deadline",
      receiptState: "missing",
      lastTransaction: {
        event: "manual_generation_transaction",
        caseId: "generation_progress",
        ordinal: 2,
        phase: "maintenance",
        transactionOrdinal: 7,
        boundary: "callback_returned",
        durationMs: 12,
      },
    }),
  );
  let now = 0;
  const cli = manualJobsObservation(2, 7000, () => now);
  now = 7100;
  const child = JSON.parse(
    cli.line("failure", {
      closed: true,
      timedOut: true,
      spawnFailed: false,
      streamFailed: false,
      exitCode: 1,
    }),
  );
  const collector = collectEvents();
  for (const record of [failure, worker, child]) {
    const line = JSON.stringify(record) + "\n";
    collector.push(line.slice(0, 21));
    collector.push(line.slice(21));
  }
  expect(collector.fixtureDiagnostics).toEqual([failure, worker, child]);
  expect(qualityReport(1, 9000, [], undefined, [], collector.fixtureDiagnostics)).toMatchObject({
    status: "failure",
    fixtureDiagnostics: [failure, worker, child],
  });
});

test("CI fixture reporting rejects arbitrary/private facts, bounds volume and ignores successful per-transaction chatter", () => {
  const value = {
    event: "identity_fixture",
    fixture: "reconciliation",
    phase: "transaction",
    state: "failed",
    durationMs: 5,
    caseId: "reconciliation_root_submit",
    step: "submit",
    transactionOrdinal: 1,
    category: "unclassified",
    codes: ["ETIMEDOUT"],
  };
  const privateText = "SYNTHETIC_PRIVATE_SQL_INPUT";
  const invalid = [
    { ...value, sql: privateText },
    { ...value, codes: [privateText] },
    { ...value, caseId: privateText },
    { ...value, fixture: "identity" },
    { ...value, databaseOperation: { operation: "commit", wireDeadlineMs: 1, elapsedMs: 1 } },
    { event: "manual_jobs_cli", private: privateText },
    { event: "manual_generation_process", private: privateText },
  ];
  const collector = collectEvents();
  for (const record of invalid) collector.push(JSON.stringify(record) + "\n");
  collector.push("{" + "x".repeat(3000) + "}\n");
  expect(collector.fixtureDiagnostics).toEqual([]);
  const success = {
    event: "manual_generation_transaction",
    caseId: "generation_progress",
    ordinal: 0,
    phase: "maintenance",
    transactionOrdinal: 1,
    boundary: "fulfilled",
    durationMs: 1,
  };
  for (let n = 0; n < 200; n++) collector.push(JSON.stringify(success) + "\n");
  expect(collector.fixtureDiagnostics).toEqual([]);
  for (let n = 0; n < 200; n++) collector.push(JSON.stringify(value) + "\n");
  expect(collector.fixtureDiagnostics).toHaveLength(64);
  const report = qualityReport(
    1,
    2,
    [],
    undefined,
    [],
    [...invalid, ...collector.fixtureDiagnostics],
  );
  expect(JSON.stringify(report)).not.toContain(privateText);
  expect(report).toMatchObject({ fixtureDiagnostics: Array.from({ length: 64 }, () => value) });
});
