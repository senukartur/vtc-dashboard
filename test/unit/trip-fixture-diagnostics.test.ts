import { TransactionCommitOutcomeUnknownError, type TxContext, type UnitOfWork } from "@vtc/db";
import { expect, test, vi } from "vitest";
import { deferred } from "../support/concurrency.ts";
import { identityDiagnostics } from "../support/identity-diagnostics.ts";
import {
  generationProcessLine,
  generationTransactionArguments,
  safeGenerationProcessRecord,
  safeScopedTransactionRecord,
} from "../support/manual-generation-diagnostics.ts";
import { manualJobsObservation, safeManualJobsRecord } from "../support/manual-jobs-diagnostics.ts";

const scope = { caseId: "reconciliation_root_submit", step: "submit" } as const;
test.each(["success", "before_callback", "callback", "unknown_receipt"] as const)(
  "submit observer preserves %s identity, invocation count and pre-redaction native failure",
  async (mode) => {
    const lines: string[] = [],
      log = vi.spyOn(console, "log").mockImplementation((value) => {
        lines.push(String(value));
      });
    const native = Object.assign(new Error("SYNTHETIC_PRIVATE_SQL"), {
      code: "ETIMEDOUT",
      sql: "SYNTHETIC_PRIVATE_PARAMETER",
    });
    const error =
      mode === "unknown_receipt" ? new TransactionCommitOutcomeUnknownError(native) : native;
    const tx = {} as TxContext,
      result = { privateResult: "SYNTHETIC_PRIVATE_RESULT" };
    const callback = vi.fn(async (actual) => {
      expect(actual).toBe(tx);
      if (mode === "callback") throw error;
      return result;
    });
    const run = vi.fn(async <T>(command: (tx: TxContext) => Promise<T>) => {
      if (mode === "before_callback") throw error;
      const value = await command(tx);
      if (mode === "unknown_receipt") throw error;
      return value;
    });
    const diagnostic = identityDiagnostics("reconciliation"),
      client = vi.fn();
    const subject = diagnostic.unit(
      { run: run as UnitOfWork["run"], client, close: async () => {} },
      undefined,
      true,
    );
    try {
      const work = diagnostic.scope(scope, () => subject.run(callback));
      if (mode === "success") expect(await work).toBe(result);
      else {
        await expect(
          work.catch((actual) => {
            expect(lines.some((line) => JSON.parse(line).phase === "transaction")).toBe(true);
            throw actual;
          }),
        ).rejects.toBe(error);
        const failures = lines
          .map((line) => JSON.parse(line))
          .filter((row) => row.phase === "transaction");
        expect(failures).toHaveLength(1);
        expect(failures[0].codes).toContain("ETIMEDOUT");
        if (mode === "unknown_receipt")
          expect(failures[0].codes).toContain("TRANSACTION_COMMIT_OUTCOME_UNKNOWN");
        expect(failures[0]).toMatchObject({ fixture: "reconciliation", ...scope });
      }
      expect(run).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledTimes(mode === "before_callback" ? 0 : 1);
      expect(client).not.toHaveBeenCalled();
      const boundaries = lines
        .map((line) => JSON.parse(line))
        .filter((row) => row.event === "identity_fixture_transaction");
      expect(boundaries.every((row) => safeScopedTransactionRecord(row))).toBe(true);
      expect(lines.join("\n")).not.toContain("SYNTHETIC_PRIVATE");
      expect(
        lines
          .map((line) => JSON.parse(line))
          .some((row) => row.event === "identity_fixture_unknown_commit"),
      ).toBe(false);
    } finally {
      await subject.close();
      log.mockRestore();
    }
  },
);

test.each(["identity", "admissions", "generation_worker", "reconciliation"] as const)(
  "inactive %s preserves historical failure capture compatibility",
  async (fixture) => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {}),
      error = Object.assign(Error("SYNTHETIC_PRIVATE"), { code: "ECONNRESET" });
    const run = vi.fn(async () => {
        throw error;
      }),
      subject = identityDiagnostics(fixture).unit({ run, client: vi.fn(), close: async () => {} });
    try {
      await expect(subject.run(async () => 0)).rejects.toBe(error);
      expect(run).toHaveBeenCalledTimes(1);
      expect(log.mock.calls.length).toBe(fixture === "reconciliation" ? 0 : 1);
    } finally {
      await subject.close();
      log.mockRestore();
    }
  },
);

test("submit AsyncLocalStorage restores nested/rejected scopes and leaves concurrent outside work inactive", async () => {
  const lines: string[] = [],
    log = vi.spyOn(console, "log").mockImplementation((value) => lines.push(String(value))),
    diagnostic = identityDiagnostics("reconciliation");
  const raw: UnitOfWork = {
      client: vi.fn(),
      close: async () => {},
      run: (command) => command({} as TxContext),
    },
    subject = diagnostic.unit(raw, undefined, true),
    gate = deferred<void>();
  try {
    const held = diagnostic.scope(scope, () =>
      subject.run(async () => {
        await gate.promise;
        return 1;
      }),
    );
    const count = lines.length;
    expect(await subject.run(async () => 2)).toBe(2);
    expect(lines).toHaveLength(count);
    gate.resolve();
    expect(await held).toBe(1);
    await diagnostic.scope(scope, async () => {
      await subject.run(async () => 0);
      await diagnostic.scope(scope, () => subject.run(async () => 0));
      await subject.run(async () => 0);
    });
    const invoked = lines
      .map((line) => JSON.parse(line))
      .filter((row) => row.boundary === "invoked");
    expect(invoked.map((row) => row.transactionOrdinal)).toEqual([1, 1, 1, 2]);
    const failure = Error("SYNTHETIC_PRIVATE");
    await expect(
      diagnostic.scope(scope, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    const after = lines.length;
    expect(await subject.run(async () => 3)).toBe(3);
    expect(lines).toHaveLength(after);
    for (const invalid of [
      { ...scope, step: "private" },
      { ...scope, private: "private" },
      { caseId: "role_matrix", step: "member_seed" },
    ])
      expect(() => diagnostic.scope(invalid as typeof scope, async () => 0)).toThrow(
        "INVALID_IDENTITY_DIAGNOSTIC_SCOPE",
      );
  } finally {
    gate.resolve();
    await subject.close();
    log.mockRestore();
  }
});

test("a broken diagnostic consumer cannot replace the original uncertain receipt", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {
      throw Error("SYNTHETIC_BROKEN_CONSUMER");
    }),
    error = new TransactionCommitOutcomeUnknownError(Error("SYNTHETIC_PRIVATE")),
    diagnostic = identityDiagnostics("reconciliation");
  const subject = diagnostic.unit(
    {
      client: vi.fn(),
      close: async () => {},
      run: async () => {
        throw error;
      },
    },
    undefined,
    true,
  );
  try {
    await expect(diagnostic.scope(scope, () => subject.run(async () => 0))).rejects.toBe(error);
  } finally {
    await subject.close();
    log.mockRestore();
  }
});

test("progress lifecycle snapshots retain the last closed transaction boundary, never arbitrary nested facts", () => {
  const base = {
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
  };
  const last = {
    event: "manual_generation_transaction",
    caseId: "generation_progress",
    ordinal: 2,
    phase: "maintenance",
    transactionOrdinal: 7,
    boundary: "callback_returned",
    durationMs: 12,
  };
  expect(JSON.parse(generationProcessLine({ ...base, lastTransaction: last }))).toEqual({
    ...base,
    lastTransaction: last,
  });
  for (const invalid of [
    { ...last, ordinal: 1 },
    { ...last, sql: "SYNTHETIC_PRIVATE" },
    { ...last, boundary: "commit" },
    { ...base },
  ])
    expect(safeGenerationProcessRecord({ ...base, lastTransaction: invalid })).toBeUndefined();
  for (const ordinal of [-1, 5, NaN, 1.5])
    expect(generationTransactionArguments("generation_progress", ordinal)).toEqual([]);
  for (let ordinal = 0; ordinal < 5; ordinal++)
    expect(safeGenerationProcessRecord({ ...last, ordinal })).toBeDefined();
});

test("CLI snapshots preserve the single absolute deadline, last validated receipt and closed failure facts", () => {
  let now = 100;
  const observer = manualJobsObservation(2, 7100, () => now),
    flags = {
      closed: false,
      timedOut: false,
      spawnFailed: false,
      streamFailed: false,
      exitCode: null,
    };
  const spawn = JSON.parse(observer.line("spawn", flags));
  expect(spawn).toMatchObject({
    ordinal: 2,
    durationMs: 0,
    remainingMs: 7000,
    receiptState: "pending",
    lastEvent: "none",
  });
  observer.accept({
    event: "jobs_result",
    manualCleanup: "private",
    processed: 0,
    sql: "SYNTHETIC_PRIVATE",
  });
  observer.accept({
    event: "manual_cleanup_failed",
    category: "storage_unavailable",
    private: "SYNTHETIC_PRIVATE",
  });
  now = 7200;
  const deadline = JSON.parse(observer.line("deadline", { ...flags, timedOut: true }));
  expect(deadline).toMatchObject({
    remainingMs: -100,
    durationMs: 7100,
    receiptState: "pending",
    lastEvent: "storage_unavailable",
    timedOut: true,
  });
  observer.accept({
    event: "jobs_result",
    manualCleanup: "complete",
    processed: 1,
    private: "SYNTHETIC_PRIVATE",
  });
  now = 7300;
  const close = JSON.parse(
    observer.line("close", { ...flags, closed: true, exitCode: 0, timedOut: true }),
  );
  expect(close).toMatchObject({
    remainingMs: -200,
    receiptState: "valid",
    manualCleanup: "complete",
    processed: 1,
    lastEvent: "jobs_result",
  });
  expect(deadline.remainingMs).toBe(-100);
  const missing = JSON.parse(
    manualJobsObservation(1, 7100, () => now).line("failure", {
      ...flags,
      closed: true,
      exitCode: 1,
    }),
  );
  expect(missing.receiptState).toBe("missing");
  expect(JSON.stringify([spawn, deadline, close, missing])).not.toContain("SYNTHETIC_PRIVATE");
  for (const invalid of [
    { ...close, private: "SYNTHETIC_PRIVATE" },
    { ...close, ordinal: 3 },
    { ...close, remainingMs: "private" },
    { ...close, remainingMs: 86400001 },
    { ...close, durationMs: 86400001 },
    { ...close, processed: -1 },
    { ...close, receiptState: "pending" },
    { ...close, manualCleanup: null },
    { ...close, closed: false },
  ])
    expect(safeManualJobsRecord(invalid)).toBeUndefined();
});
