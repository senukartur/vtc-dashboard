import type { TxContext, UnitOfWork } from "@vtc/db";
import type { Connection } from "mysql2/promise";
import { expect, test, vi } from "vitest";
import { observeDatabaseOperation } from "../../packages/db/dist/core/operation-context.js";
import { deferred } from "../support/concurrency.ts";
import { fixtureDatabaseFailure } from "../support/fixture-database-diagnostics.ts";
import { identityDiagnostics, safeIdentityFailure } from "../support/identity-diagnostics.ts";
import {
  generationProcessLine,
  generationTransactionArguments,
  generationTransactionFlag,
  generationTransactionTracing,
  generationWorkerPhaseLine,
  parseGenerationWorkerLine,
  safeGenerationProcessRecord,
  safeGenerationWorkerRecord,
  safeScopedTransactionRecord,
  scopedTransactionLine,
} from "../support/manual-generation-diagnostics.ts";

test("successor failure observations admit only the registered scope and omit queue/private fields", async () => {
  const lines: string[] = [];
  const output = vi.spyOn(console, "log").mockImplementation((line) => lines.push(String(line)));
  const query = vi
    .fn()
    .mockResolvedValueOnce([[{ total: "3" }], []])
    .mockResolvedValueOnce([
      [
        { Variable_name: "Connections", Value: "14" },
        { Variable_name: "SYNTHETIC_PRIVATE_NAME", Value: "SYNTHETIC_PRIVATE_VALUE" },
      ],
      [],
    ]);
  try {
    await fixtureDatabaseFailure({ query } as unknown as Connection, "administration_successor");
    expect(query).toHaveBeenCalledTimes(2);
    for (const [options] of query.mock.calls) expect(options.timeout).toBe(500);
    const record = JSON.parse(lines[0]!);
    expect(record).toEqual({
      event: "fixture_database_failure",
      caseId: "administration_successor",
      durationMs: expect.any(Number),
      ownedUserConnections: 3,
      serverGlobal: { Connections: 14 },
    });
    expect(lines.join("\n")).not.toContain("SYNTHETIC_PRIVATE");
    expect(Number.isSafeInteger(record.durationMs) && record.durationMs >= 0).toBe(true);
  } finally {
    output.mockRestore();
  }
});

test("successor observation failures remain unavailable and do not invent numeric zero", async () => {
  const lines: string[] = [];
  const output = vi.spyOn(console, "log").mockImplementation((line) => lines.push(String(line)));
  const query = vi.fn().mockRejectedValue(
    Object.assign(new Error("SYNTHETIC_PRIVATE_SQL_AND_CREDENTIAL"), {
      code: "PROTOCOL_SEQUENCE_TIMEOUT",
    }),
  );
  try {
    await fixtureDatabaseFailure({ query } as unknown as Connection, "administration_successor");
    expect(query).toHaveBeenCalledTimes(1);
    const record = JSON.parse(lines[0]!);
    expect(record.state).toBe("unavailable");
    expect(record.codes).toEqual(["PROTOCOL_SEQUENCE_TIMEOUT"]);
    expect(record).not.toHaveProperty("ownedUserConnections");
    expect(record).not.toHaveProperty("serverGlobal");
    expect(record).not.toHaveProperty("queue");
    expect(lines.join("\n")).not.toContain("SYNTHETIC_PRIVATE");
  } finally {
    output.mockRestore();
  }
});

test("actual successor observer rejects an unknown scope before queries or output", async () => {
  const query = vi.fn();
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await expect(
      fixtureDatabaseFailure({ query } as unknown as Connection, "private_scope" as never),
    ).rejects.toThrow("INVALID_DATABASE_FIXTURE_SCOPE");
    expect(query).not.toHaveBeenCalled();
    expect(output).not.toHaveBeenCalled();
  } finally {
    output.mockRestore();
  }
});

test("actual successor observer output errors remain throwable for the primary-preserving caller", async () => {
  const outputFailure = new Error("SYNTHETIC_PRIVATE_OUTPUT_FAILURE");
  const output = vi.spyOn(console, "log").mockImplementation(() => {
    throw outputFailure;
  });
  const query = vi.fn().mockRejectedValue(new Error("SYNTHETIC_PRIVATE_DATABASE_FAILURE"));
  try {
    await expect(
      fixtureDatabaseFailure({ query } as unknown as Connection, "administration_successor"),
    ).rejects.toBe(outputFailure);
    expect(query).toHaveBeenCalledTimes(1);
  } finally {
    output.mockRestore();
  }
});

test("identity fixture diagnostics retain only allowlisted failure facts through bounded cyclic causes", () => {
  const inner = Object.assign(new Error("SYNTHETIC_PRIVATE_SQL_AND_INPUT"), {
    code: "ETIMEDOUT",
    statusCode: 503,
  });
  const outer = Object.assign(new Error("SYNTHETIC_PRIVATE_CREDENTIAL"), {
    code: "SYNTHETIC_PRIVATE_CODE",
    cause: inner,
  });
  Object.assign(inner, { cause: outer });
  expect(safeIdentityFailure(outer)).toEqual({
    codes: ["ETIMEDOUT"],
    statusCode: 503,
    category: "unclassified",
  });
  expect(
    safeIdentityFailure({ statusCode: "SYNTHETIC_PRIVATE", code: "SYNTHETIC_PRIVATE" }),
  ).toEqual({ codes: [], category: "unclassified" });
});

test.each(["success", "before_callback", "callback", "after_callback"] as const)(
  "scoped transaction boundaries preserve exact ownership and %s outcome without retries",
  async (mode) => {
    const lines: string[] = [];
    const output = vi.spyOn(console, "log").mockImplementation((line) => lines.push(String(line)));
    const diagnostic = identityDiagnostics("admissions");
    const tx = {} as TxContext,
      result = { privateResult: "SYNTHETIC_PRIVATE_RESULT" };
    const failure = Object.assign(new Error("SYNTHETIC_PRIVATE_SQL"), { code: "ETIMEDOUT" });
    const callback = vi.fn(async (actual: TxContext) => {
      expect(actual).toBe(tx);
      if (mode === "callback") throw failure;
      return result;
    });
    const calls = vi.fn();
    const client = vi.fn();
    const subject = diagnostic.unit(
      {
        client,
        close: async () => {},
        async run<T>(command: (tx: TxContext) => Promise<T>) {
          calls();
          if (mode === "before_callback") throw failure;
          const value = await command(tx);
          if (mode === "after_callback") throw failure;
          return value;
        },
      },
      undefined,
      true,
    );
    try {
      const work = diagnostic.scope({ caseId: "admissions_reissue_expiry", step: "purge" }, () =>
        subject.run(callback),
      );
      if (mode === "success") expect(await work).toBe(result);
      else await expect(work).rejects.toBe(failure);
      expect(calls).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledTimes(mode === "before_callback" ? 0 : 1);
      expect(client).not.toHaveBeenCalled();
      const records = lines
        .map((line) => JSON.parse(line))
        .filter((record) => record.event === "identity_fixture_transaction");
      const expected =
        mode === "before_callback"
          ? ["invoked", "rejected"]
          : mode === "callback"
            ? ["invoked", "callback_entered", "callback_threw", "rejected"]
            : [
                "invoked",
                "callback_entered",
                "callback_returned",
                mode === "success" ? "fulfilled" : "rejected",
              ];
      expect(records.map((record) => record.boundary)).toEqual(expected);
      for (const record of records) {
        expect(safeScopedTransactionRecord(record)).toEqual(record);
        expect(record).toMatchObject({
          fixture: "admissions",
          caseId: "admissions_reissue_expiry",
          step: "purge",
          transactionOrdinal: 1,
        });
        expect(record.durationMs).toBeGreaterThanOrEqual(0);
      }
      expect(lines.join("\n")).not.toContain("SYNTHETIC_PRIVATE");
    } finally {
      await subject.close();
      output.mockRestore();
    }
  },
);

test("transaction tracing is scoped and opt-in, with immutable concurrent and nested ordinals", async () => {
  const lines: string[] = [];
  const output = vi.spyOn(console, "log").mockImplementation((line) => lines.push(String(line)));
  const diagnostic = identityDiagnostics("generation_worker"),
    entered = deferred<void>(),
    gate = deferred<void>();
  const raw: UnitOfWork = {
    client: vi.fn(),
    close: async () => {},
    run: async (command) => command({} as TxContext),
  };
  const subject = diagnostic.unit(raw, undefined, true),
    ordinary = diagnostic.unit(raw);
  try {
    await subject.run(async () => 0);
    await diagnostic.scope({ caseId: "generation_worker", step: "initialize" }, () =>
      ordinary.run(async () => 0),
    );
    expect(lines).toHaveLength(0);
    const first = diagnostic.scope(
      { caseId: "generation_worker", step: "maintenance" },
      async () => {
        await subject.run(async () => {
          entered.resolve();
          await gate.promise;
          return 1;
        });
        await diagnostic.scope({ caseId: "generation_worker", step: "pass" }, () =>
          subject.run(async () => 2),
        );
        await subject.run(async () => 3);
      },
    );
    await entered.promise;
    await diagnostic.scope({ caseId: "generation_worker", step: "initialize" }, () =>
      subject.run(async () => 4),
    );
    gate.resolve();
    await first;
    const records = lines.map((line) => JSON.parse(line));
    expect(
      records
        .filter((record) => record.boundary === "invoked")
        .map((record) => [record.step, record.transactionOrdinal]),
    ).toEqual([
      ["maintenance", 1],
      ["initialize", 1],
      ["pass", 1],
      ["maintenance", 2],
    ]);
    expect(
      records
        .filter((record) => record.boundary === "fulfilled")
        .map((record) => [record.step, record.transactionOrdinal]),
    ).toEqual([
      ["initialize", 1],
      ["maintenance", 1],
      ["pass", 1],
      ["maintenance", 2],
    ]);
  } finally {
    gate.resolve();
    await subject.close();
    await ordinary.close();
    output.mockRestore();
  }
});

test("trace output failures cannot replace original callback results or exception identity", async () => {
  const output = vi.spyOn(console, "log").mockImplementation(() => {
    throw Error("SYNTHETIC_OUTPUT_FAILURE");
  });
  const diagnostic = identityDiagnostics("admissions"),
    value = {},
    failure = Error("SYNTHETIC_PRIVATE_ERROR");
  const subject = diagnostic.unit(
    { client: vi.fn(), close: async () => {}, run: async (command) => command({} as TxContext) },
    undefined,
    true,
  );
  try {
    expect(
      await diagnostic.scope({ caseId: "admissions_reissue_expiry", step: "purge" }, () =>
        subject.run(async () => value),
      ),
    ).toBe(value);
    await expect(
      diagnostic.scope({ caseId: "admissions_reissue_expiry", step: "purge" }, () =>
        subject.run(async () => {
          throw failure;
        }),
      ),
    ).rejects.toBe(failure);
  } finally {
    await subject.close();
    output.mockRestore();
  }
});

test("new diagnostic scopes require matching factory fixtures before invoking work", () => {
  const work = vi.fn(async () => 0);
  expect(() =>
    identityDiagnostics("identity").scope(
      { caseId: "admissions_reissue_expiry", step: "purge" },
      work,
    ),
  ).toThrow("INVALID_IDENTITY_DIAGNOSTIC_SCOPE");
  expect(() =>
    identityDiagnostics("admissions").scope(
      { caseId: "generation_worker", step: "maintenance" },
      work,
    ),
  ).toThrow("INVALID_IDENTITY_DIAGNOSTIC_SCOPE");
  expect(() =>
    identityDiagnostics("generation_worker").scope(
      { caseId: "admissions_reissue_expiry", step: "purge" },
      work,
    ),
  ).toThrow("INVALID_IDENTITY_DIAGNOSTIC_SCOPE");
  expect(work).not.toHaveBeenCalled();
});

test("progress ordinals0–4 and original late ordinal1 receive the validated closed synthetic transaction flag", () => {
  for (const caseId of ["generation_progress", "generation_late", "generation_retry"] as const)
    for (let ordinal = 0; ordinal < 5; ordinal++) {
      const args = generationTransactionArguments(caseId, ordinal);
      expect(args).toEqual(
        caseId === "generation_progress" || (caseId === "generation_late" && ordinal === 1)
          ? [generationTransactionFlag]
          : [],
      );
      expect(generationTransactionTracing(args)).toBe(
        caseId === "generation_progress" || (caseId === "generation_late" && ordinal === 1),
      );
    }
  for (const args of [
    ["--debug"],
    [generationTransactionFlag, generationTransactionFlag],
    ["SYNTHETIC_PRIVATE"],
  ])
    expect(() => generationTransactionTracing(args)).toThrow("INVALID_GENERATION_TRANSACTION_FLAG");
});

test("closed transaction transport retains receipts and rejects private or unbounded facts", () => {
  const value = {
    event: "identity_fixture_transaction",
    fixture: "generation_worker",
    caseId: "generation_worker",
    step: "maintenance",
    transactionOrdinal: 1,
    boundary: "callback_returned",
    durationMs: 4,
  };
  expect(safeGenerationWorkerRecord(value)).toEqual(value);
  const receipt = JSON.stringify({ event: "manual_generation_worker", processed: 1, pid: 42 });
  const records = [
    receipt,
    scopedTransactionLine(value),
    generationWorkerPhaseLine({
      event: "manual_generation_worker_phase",
      phase: "close",
      state: "success",
      durationMs: 1,
    }),
  ].map(parseGenerationWorkerLine);
  expect(records[0]).toEqual({ event: "manual_generation_worker", processed: 1 });
  expect(JSON.parse(receipt).pid).toBe(42);
  expect(JSON.stringify(records)).not.toContain("pid");
  const parent = {
    event: "manual_generation_transaction",
    caseId: "generation_late",
    ordinal: 1,
    phase: "maintenance",
    transactionOrdinal: 1,
    boundary: "callback_returned",
    durationMs: 4,
  };
  expect(JSON.parse(generationProcessLine(parent))).toEqual(parent);
  for (const invalid of [
    ...["pid", "output", "error", "sql", "settings"].map((key) => ({
      ...value,
      [key]: "SYNTHETIC_PRIVATE",
    })),
    { ...value, transactionOrdinal: 0 },
    { ...value, transactionOrdinal: 1000001 },
    { ...value, transactionOrdinal: 0.5 },
    { ...value, durationMs: Number.NaN },
    { ...value, durationMs: 86400001 },
    { ...value, step: "purge" },
    { ...value, boundary: "committed" },
    { ...value, codes: [] },
    { ...value, fixture: "admissions" },
    { ...value, boundary: "rejected" },
  ])
    expect(safeScopedTransactionRecord(invalid)).toBeUndefined();
  for (const invalid of [
    { ...parent, ordinal: 0 },
    { ...parent, caseId: "generation_retry" },
    { ...parent, fixture: "generation_worker" },
    { ...parent, pid: 42 },
  ])
    expect(safeGenerationProcessRecord(invalid)).toBeUndefined();
  const failed = {
    ...value,
    boundary: "rejected",
    category: "unclassified",
    codes: ["TRANSACTION_COMMIT_OUTCOME_UNKNOWN", "PROTOCOL_SEQUENCE_TIMEOUT"],
    statusCode: 503,
    databaseOperation: { operation: "session_configuration", wireDeadlineMs: 1000, elapsedMs: 5 },
  };
  expect(safeScopedTransactionRecord(failed)).toEqual(failed);
  for (const invalid of [
    { ...failed, statusCode: 600 },
    { ...failed, category: "SYNTHETIC_PRIVATE" },
    { ...failed, codes: ["SYNTHETIC_PRIVATE"] },
    { ...failed, databaseOperation: { ...failed.databaseOperation, sql: "SYNTHETIC_PRIVATE" } },
  ])
    expect(safeScopedTransactionRecord(invalid)).toBeUndefined();
  expect(
    safeGenerationWorkerRecord({
      ...value,
      fixture: "admissions",
      caseId: "admissions_reissue_expiry",
      step: "purge",
    }),
  ).toBeUndefined();
});

test("unknown commit capture runs once, keeps fixed numeric counters and never retries the command", async () => {
  const lines: string[] = [];
  const output = vi.spyOn(console, "log").mockImplementation((value: unknown) => {
    lines.push(String(value));
  });
  const failure = Object.assign(new Error("SYNTHETIC_PRIVATE_SQL"), {
    code: "TRANSACTION_COMMIT_OUTCOME_UNKNOWN",
  });
  const query = vi.fn(async () => [
    [
      { Variable_name: "Com_commit", Value: "12" },
      { Variable_name: "SYNTHETIC_PRIVATE", Value: "secret" },
      { Variable_name: "Threads_running", Value: "SYNTHETIC_PRIVATE" },
    ],
    [],
  ]);
  const run = vi.fn(async () => {
    throw failure;
  });
  const subject = identityDiagnostics("identity").unit(
    { run, client: vi.fn(), close: async () => {} },
    { query } as unknown as Connection,
  );
  try {
    await expect(subject.run(async () => 0)).rejects.toBe(failure);
    await expect(subject.run(async () => 0)).rejects.toBe(failure);
    expect(run).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenCalledTimes(1);
    expect(lines.every((line) => !line.includes("SYNTHETIC_PRIVATE"))).toBe(true);
    const facts = lines.map((line) => JSON.parse(line));
    expect(facts.filter((fact) => fact.event === "identity_fixture_unknown_commit")).toHaveLength(
      1,
    );
    expect(facts.find((fact) => fact.event === "identity_fixture_commit_status").counters).toEqual({
      Com_commit: 12,
    });
  } finally {
    await subject.close();
    output.mockRestore();
  }
});

test("fixture phase errors are sanitized while transaction diagnostics preserve internal error identity", async () => {
  const lines: string[] = [],
    output = vi
      .spyOn(console, "log")
      .mockImplementation((value: unknown) => lines.push(String(value)));
  const diagnostic = identityDiagnostics("identity"),
    failure = Object.assign(new Error("SYNTHETIC_PRIVATE_SQL"), { code: "ER_NO_SUCH_TABLE" });
  try {
    expect(await diagnostic.phase("connection", async () => 1)).toBe(1);
    await expect(
      diagnostic.phase("migrations", async () => {
        throw failure;
      }),
    ).rejects.toMatchObject({
      message: "IDENTITY_FIXTURE_PHASE_FAILED",
      codes: ["ER_NO_SUCH_TABLE"],
    });
    const unit: UnitOfWork = {
      close: async () => {},
      client: () => {
        throw failure;
      },
      run: async () => {
        throw failure;
      },
    };
    await expect(diagnostic.unit(unit).run(async () => 0)).rejects.toBe(failure);
    expect(lines.length).toBe(5);
    expect(lines.every((line) => !line.includes("SYNTHETIC_PRIVATE"))).toBe(true);
    expect(lines.map((line) => JSON.parse(line).state)).toEqual([
      "started",
      "success",
      "started",
      "failed",
      "failed",
    ]);
  } finally {
    output.mockRestore();
  }
});

test.each([
  ["migration_history_read", 1000],
  ["migration_statement", 30000],
] as const)(
  "admission setup reports the exact %s deadline without private error data",
  async (operation, wireDeadlineMs) => {
    const lines: string[] = [];
    const output = vi.spyOn(console, "log").mockImplementation((value: unknown) => {
      lines.push(String(value));
    });
    const failure = Object.assign(new Error("SYNTHETIC_PRIVATE_QUERY"), {
      code: "PROTOCOL_SEQUENCE_TIMEOUT",
      sql: "SYNTHETIC_PRIVATE_SQL",
      config: { password: "SYNTHETIC_PRIVATE_CREDENTIAL" },
    });
    const work = vi.fn(async () => {
      try {
        return await observeDatabaseOperation(operation, wireDeadlineMs, async () => {
          throw failure;
        });
      } catch (error) {
        expect(error).toBe(failure);
        throw error;
      }
    });
    try {
      const sanitized = await identityDiagnostics("admission")
        .phase("migrations", work)
        .catch((error: unknown) => error);
      expect(work).toHaveBeenCalledTimes(1);
      expect(sanitized).not.toBe(failure);
      expect(sanitized).toMatchObject({
        message: "IDENTITY_FIXTURE_PHASE_FAILED",
        codes: ["PROTOCOL_SEQUENCE_TIMEOUT"],
        category: "unclassified",
        databaseOperation: { operation, wireDeadlineMs, elapsedMs: expect.any(Number) },
      });
      expect(Object.keys(sanitized as object).sort()).toEqual([
        "category",
        "codes",
        "databaseOperation",
      ]);
      expect(lines).toHaveLength(2);
      const facts = lines.map((line) => JSON.parse(line));
      expect(facts[1]).toEqual({
        event: "identity_fixture",
        fixture: "admission",
        phase: "migrations",
        state: "failed",
        durationMs: expect.any(Number),
        codes: ["PROTOCOL_SEQUENCE_TIMEOUT"],
        category: "unclassified",
        databaseOperation: { operation, wireDeadlineMs, elapsedMs: expect.any(Number) },
      });
      expect(facts[1].databaseOperation.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(lines.join("\n") + JSON.stringify(sanitized)).not.toContain("SYNTHETIC_PRIVATE");
    } finally {
      output.mockRestore();
    }
  },
);

test("identity scopes bind at transaction invocation across concurrent and nested work without retries", async () => {
  const lines: string[] = [];
  const output = vi.spyOn(console, "log").mockImplementation((line) => lines.push(String(line)));
  const diagnostic = identityDiagnostics("identity"),
    gate = deferred<void>(),
    entered = deferred<void>();
  const unknown = Object.assign(new Error("SYNTHETIC_PRIVATE_SQL"), {
    code: "TRANSACTION_COMMIT_OUTCOME_UNKNOWN",
  });
  const other = Object.assign(new Error("SYNTHETIC_PRIVATE_ACCOUNT"), { code: "ETIMEDOUT" });
  const run = vi.fn();
  const subject = diagnostic.unit({
    async run<T>(command: (tx: TxContext) => Promise<T>) {
      run();
      return command({} as TxContext);
    },
    client: vi.fn(),
    close: async () => {},
  });
  try {
    const first = diagnostic.scope(
      { caseId: "role_matrix", step: "member_login", mask: 7 },
      async () => {
        expect(await subject.run(async () => 1)).toBe(1);
        await expect(
          subject.run(async () => {
            entered.resolve();
            await gate.promise;
            throw unknown;
          }),
        ).rejects.toBe(unknown);
      },
    );
    await entered.promise;
    await diagnostic.scope({ caseId: "role_matrix", step: "director_login" }, async () => {
      await expect(
        subject.run(async () => {
          throw other;
        }),
      ).rejects.toBe(other);
    });
    gate.resolve();
    await first;
    const facts = lines.map((line) => JSON.parse(line));
    expect(
      facts
        .filter((f) => f.phase === "transaction")
        .map((f) => [f.step, f.mask, f.transactionOrdinal]),
    ).toEqual([
      ["director_login", undefined, 1],
      ["member_login", 7, 2],
    ]);
    expect(facts.find((f) => f.event === "identity_fixture_unknown_commit")).toMatchObject({
      caseId: "role_matrix",
      step: "member_login",
      mask: 7,
      transactionOrdinal: 2,
    });
    expect(run).toHaveBeenCalledTimes(3);
    await diagnostic.scope({ caseId: "role_matrix", step: "member_seed", mask: 2 }, async () => {
      await diagnostic.scope({ caseId: "role_matrix", step: "director_lookup" }, async () =>
        diagnostic.failure(other),
      );
      diagnostic.failure(other);
    });
    diagnostic.failure(other);
    const restored = lines.slice(-3).map((line) => JSON.parse(line));
    expect(restored.map((f) => f.step)).toEqual(["director_lookup", "member_seed", undefined]);
    expect(restored[2]).not.toHaveProperty("caseId");
    expect(lines.join("\n")).not.toContain("SYNTHETIC_PRIVATE");
  } finally {
    gate.resolve();
    await subject.close();
    output.mockRestore();
  }
});

test("identity scopes reject private extra fields and invalid masks before starting work", () => {
  const diagnostic = identityDiagnostics("identity"),
    work = vi.fn(async () => 1);
  for (const mask of [-1, 16, 0.5, Number.NaN, Number.POSITIVE_INFINITY])
    expect(() =>
      diagnostic.scope({ caseId: "role_matrix", step: "member_login", mask }, work),
    ).toThrow("INVALID_IDENTITY_DIAGNOSTIC_SCOPE");
  const withExtra = Object.defineProperty(
    { caseId: "role_matrix" as const, step: "director_login" as const },
    "account",
    {
      enumerable: true,
      get() {
        throw Error("PRIVATE_FIELD_READ");
      },
    },
  );
  expect(() => diagnostic.scope(withExtra, work)).toThrow("INVALID_IDENTITY_DIAGNOSTIC_SCOPE");
  expect(work).not.toHaveBeenCalled();
});

test("worker receipt remains identifiable before a later close phase without exposing its PID", () => {
  const receipt = JSON.stringify({ event: "manual_generation_worker", processed: 1, pid: 42 });
  const close = generationWorkerPhaseLine({
    event: "manual_generation_worker_phase",
    phase: "close",
    state: "success",
    durationMs: 1,
  });
  const records = [receipt, close].map(parseGenerationWorkerLine);
  expect(records.find((record) => record?.event === "manual_generation_worker")).toEqual({
    event: "manual_generation_worker",
    processed: 1,
  });
  expect(records[1]).toMatchObject({ phase: "close", state: "success" });
  expect(JSON.stringify(records)).not.toContain("pid");
  expect(JSON.parse(receipt).pid).toBe(42);
  const failure = safeGenerationWorkerRecord({
    event: "manual_generation_worker_phase",
    phase: "maintenance",
    state: "failed",
    durationMs: 5001,
    category: "unclassified",
    codes: ["TRANSACTION_COMMIT_OUTCOME_UNKNOWN", "PROTOCOL_SEQUENCE_TIMEOUT"],
  });
  expect(failure).toMatchObject({
    phase: "maintenance",
    codes: ["TRANSACTION_COMMIT_OUTCOME_UNKNOWN", "PROTOCOL_SEQUENCE_TIMEOUT"],
  });
});

test("closed worker lifecycle retains native exit and independent local stop facts per invocation", () => {
  const value = {
    event: "manual_generation_process",
    caseId: "generation_progress",
    ordinal: 0,
    state: "exit",
    durationMs: 5001,
    exitCode: null,
    signal: "SIGKILL",
    timerFired: true,
    caseAborted: false,
    spawnFailed: false,
    firstStop: "child_deadline",
    receiptState: "pending",
  };
  for (const facts of [
    {},
    { exitCode: 0, signal: null, timerFired: false, firstStop: "none", receiptState: "valid" },
    { exitCode: 7, signal: null, timerFired: false, firstStop: "none" },
    { exitCode: -1, signal: null },
    { caseAborted: true, timerFired: false, firstStop: "case_abort" },
    { exitCode: 0, signal: null, caseAborted: true },
    { state: "spawn_error", spawnFailed: true, signal: null, timerFired: false, firstStop: "none" },
    { state: "close", receiptState: "missing" },
    { state: "close", receiptState: "malformed" },
  ]) {
    const record = { ...value, ...facts };
    expect(safeGenerationProcessRecord(record)).toEqual(record);
    expect(JSON.parse(generationProcessLine(record))).toEqual(record);
  }
  const first = safeGenerationProcessRecord(value);
  safeGenerationProcessRecord({ ...value, caseId: "generation_late", ordinal: 1 });
  expect(first).toMatchObject({ caseId: "generation_progress", ordinal: 0 });
});

test("worker parsers reject private fields, malformed receipts and unsupported numeric or enum values", () => {
  const value = {
    event: "manual_generation_process",
    caseId: "generation_progress",
    ordinal: 0,
    state: "close",
    durationMs: 1,
    exitCode: 0,
    signal: null,
    timerFired: false,
    caseAborted: false,
    spawnFailed: false,
    firstStop: "none",
    receiptState: "valid",
  };
  const privateText = "SYNTHETIC_PRIVATE_VALUE";
  for (const invalid of [
    ...["pid", "output", "stderr", "settings", "error", "path"].map((key) => ({
      ...value,
      [key]: privateText,
    })),
    { ...value, ordinal: 5 },
    { ...value, ordinal: -1 },
    { ...value, caseId: privateText },
    { ...value, exitCode: Number.NaN },
    { ...value, exitCode: 0.5 },
    { ...value, signal: privateText },
    { ...value, firstStop: privateText },
    { ...value, receiptState: privateText },
    { ...value, durationMs: 86400001 },
  ]) {
    expect(safeGenerationProcessRecord(invalid)).toBeUndefined();
    expect(() => generationProcessLine(invalid)).toThrow("INVALID_GENERATION_PROCESS_DIAGNOSTIC");
  }
  for (const line of [
    "not json",
    privateText.repeat(4001),
    JSON.stringify({ event: "manual_generation_worker", processed: 1, pid: 1 }),
    JSON.stringify({
      event: "manual_generation_worker",
      processed: 1,
      pid: 42,
      password: privateText,
    }),
    JSON.stringify({
      event: "manual_generation_worker_phase",
      phase: "pass",
      state: "failed",
      durationMs: 1,
      category: "unclassified",
      codes: [privateText],
    }),
  ])
    expect(parseGenerationWorkerLine(line)).toBeUndefined();
  expect(
    safeGenerationWorkerRecord({
      event: "manual_generation_worker_phase",
      phase: "pass",
      state: "failed",
      durationMs: 1,
      databaseOperation: {
        operation: "migration_statement",
        wireDeadlineMs: 30000,
        elapsedMs: 1,
        sql: privateText,
      },
    }),
  ).toBeUndefined();
});

test("Jobs setup phase diagnostics retain original failures for the owning handler and redact their output", async () => {
  const lines: string[] = [],
    output = vi
      .spyOn(console, "log")
      .mockImplementation((value: unknown) => lines.push(String(value))),
    diagnostic = identityDiagnostics("jobs"),
    failure = Object.assign(new Error("SYNTHETIC_PRIVATE_SQL_PASSWORD"), {
      code: "ER_NO_SUCH_TABLE",
      statusCode: 503,
      sql: "SYNTHETIC_PRIVATE_SQL",
      parameters: ["SYNTHETIC_PRIVATE_KEY"],
    });
  try {
    expect(await diagnostic.phase("connection", async () => 7, { preserveFailure: true })).toBe(7);
    await expect(
      diagnostic.phase(
        "migrations",
        async () => {
          throw failure;
        },
        { preserveFailure: true },
      ),
    ).rejects.toBe(failure);
    expect(safeIdentityFailure(failure)).toEqual({
      statusCode: 503,
      codes: ["ER_NO_SUCH_TABLE"],
      category: "unclassified",
    });
    expect(lines.every((line) => !line.includes("SYNTHETIC_PRIVATE"))).toBe(true);
    const records = lines.map((line) => JSON.parse(line));
    expect(records.map(({ fixture, phase, state }) => ({ fixture, phase, state }))).toEqual([
      { fixture: "jobs", phase: "connection", state: "started" },
      { fixture: "jobs", phase: "connection", state: "success" },
      { fixture: "jobs", phase: "migrations", state: "started" },
      { fixture: "jobs", phase: "migrations", state: "failed" },
    ]);
    expect(records[3]).toEqual({
      event: "identity_fixture",
      fixture: "jobs",
      phase: "migrations",
      state: "failed",
      durationMs: expect.any(Number),
      statusCode: 503,
      codes: ["ER_NO_SUCH_TABLE"],
      category: "unclassified",
    });
    expect(
      records.every((record) => Number.isSafeInteger(record.durationMs) && record.durationMs >= 0),
    ).toBe(true);
  } finally {
    output.mockRestore();
  }
});
