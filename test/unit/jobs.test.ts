import { newId, TransactionCommitOutcomeUnknownError, type UnitOfWork } from "@vtc/db";
import { expect, test, vi } from "vitest";
import { BlobFailure } from "../../apps/api/src/platform/blob-storage/filesystem.ts";
import { fixtureReference } from "../../apps/api/src/platform/jobs/acceptance.ts";
import type { Queue } from "../../apps/api/src/platform/jobs/queue.ts";
import {
  bounds,
  ExternalNotStartedError,
  externalExecutionBudget,
  LeaseLostError,
  retryTransaction,
} from "../../apps/api/src/platform/jobs/queue.ts";
import { runPass } from "../../apps/api/src/platform/jobs/runner.ts";
import { accessEvent } from "../../apps/api/src/platform/outbox/events.ts";

const envelope = () => {
  const id = newId();
  return {
    eventId: newId(),
    type: "member.access_changed",
    schemaVersion: 1,
    aggregate: { kind: "member", id, version: 1 },
    occurredAt: "2026-02-01T00:00:00.001+01:00",
    correlationId: newId(),
    causationId: null,
    data: { userId: id, accessEpoch: 1, identityEpoch: 1 },
  };
};
test("external lease budget subtracts pre-fence receipt and later preflight time monotonically", () => {
  let instant = 1000;
  const controller = new AbortController();
  const budget = externalExecutionBudget(15000, instant, controller.signal, () => instant);
  expect(budget.remainingMs()).toBe(15000 - bounds.externalCompletionHeadroomMs);
  instant += 3500;
  expect(budget.remainingMs()).toBe(5500);
  instant += 6000;
  expect(budget.remainingMs()).toBe(0);
  controller.abort();
  expect(budget.signal.aborted).toBe(true);
});
test("exhausted or aborted external budgets never authorize callback entry", () => {
  const signal = new AbortController().signal;
  for (const remaining of [0, 6000, Number.NaN])
    expect(() => externalExecutionBudget(remaining, 0, signal, () => 1)).toThrow(
      ExternalNotStartedError,
    );
  const aborted = new AbortController();
  aborted.abort();
  expect(() => externalExecutionBudget(15000, 0, aborted.signal, () => 1)).toThrow(
    ExternalNotStartedError,
  );
});
test("closed event/reference registry rejects private, extra, unsupported, oversized and accessor inputs", () => {
  const e = envelope();
  expect(accessEvent(e).occurredAt).toBe("2026-01-31T23:00:00.001Z");
  for (const value of [
    { ...e, email: "fictional@example.invalid" },
    { ...e, schemaVersion: 2 },
    { ...e, occurredAt: new Date() },
    { ...e, type: "trip.decision_changed" },
    { ...e, data: { ...e.data, token: "nonfunctional-placeholder" } },
    { ...e, data: { ...e.data, userId: "x".repeat(8192) } },
    { ...e, aggregate: { ...e.aggregate, version: 0 } },
    { ...e, data: { ...e.data, identityEpoch: 1.5 } },
    { ...e, occurredAt: "2026-02-01T00:00:00.0001Z" },
    { ...e, occurredAt: "2026-02-01 00:00:00" },
  ])
    expect(() => accessEvent(value)).toThrow();
  let read = false;
  const getter = Object.defineProperty({ ...e }, "data", {
    enumerable: true,
    get: () => {
      read = true;
      return e.data;
    },
  });
  expect(() => accessEvent(getter)).toThrow();
  expect(read).toBe(false);
  for (const value of [
    { runId: newId(), sequence: 1, stage: "1" },
    { runId: newId(), sequence: 1, stage: 1, email: "synthetic@example.invalid" },
  ])
    expect(() => fixtureReference(value)).toThrow();
});

test("unknown COMMIT has precedence over transient cause; safe callbacks are never blindly replayed", async () => {
  let attempts = 0;
  const transient = Object.assign(new Error("SYNTHETIC_TIMEOUT"), { code: "ER_LOCK_WAIT_TIMEOUT" });
  const uncertain = new TransactionCommitOutcomeUnknownError(transient);
  const unit = {
    run: async () => {
      attempts++;
      throw uncertain;
    },
  } as unknown as UnitOfWork;
  await expect(retryTransaction(unit, async () => {})).rejects.toBe(uncertain);
  expect(attempts).toBe(1);
});
test("runner cleanup cannot hide an unknown COMMIT outcome", async () => {
  const uncertain = new TransactionCommitOutcomeUnknownError(new Error("SYNTHETIC_RECEIPT_LOSS"));
  const queue = {
    acquireRunner: async () => newId(),
    renewRunner: async () => {
      throw uncertain;
    },
    releaseRunner: async () => {
      throw new Error("SYNTHETIC_CLOSE_FAILURE");
    },
  } as unknown as Queue;
  await expect(runPass(queue, new AbortController().signal)).rejects.toBe(uncertain);
});

test("wrapped lost lease takes precedence over a transient-looking database code", async () => {
  let attempts = 0;
  const failure = Object.assign(
    new Error("SYNTHETIC_WRAPPED_LEASE", { cause: new LeaseLostError() }),
    { code: "ER_LOCK_DEADLOCK" },
  );
  const unit = {
    run: async () => {
      attempts++;
      throw failure;
    },
  } as unknown as UnitOfWork;
  await expect(retryTransaction(unit, async () => {})).rejects.toBe(failure);
  expect(attempts).toBe(1);
});

test.each([
  "complete",
  "inspect",
  "disabled",
  "configuration_pending",
  "storage_unavailable",
  "unknown_commit",
  "wrapped_unknown_commit",
  "wrapped_database",
  "wrapped_lease",
  "wrapped_authority",
  "database",
  "lease",
  "authority",
  "cancelled",
  "aborted_unavailable",
  "pass_unknown_commit",
] as const)(
  "actual jobs orchestration preserves %s routing and failure ownership",
  async (scenario) => {
    const originalArgv = process.argv,
      originalExitCode = process.exitCode;
    const signals = new Map(
      (["SIGINT", "SIGTERM"] as const).map(
        (signal) => [signal, process.listeners(signal)] as const,
      ),
    );
    const records: Record<string, unknown>[] = [];
    const output = (value: unknown) => records.push(JSON.parse(String(value)));
    const log = vi.spyOn(console, "log").mockImplementation(output);
    const error = vi.spyOn(console, "error").mockImplementation(output);
    const uncertain = new TransactionCommitOutcomeUnknownError(Error("SYNTHETIC_PRIVATE_RECEIPT"));
    const unavailable = new BlobFailure("unavailable");
    const failure =
      scenario === "unknown_commit"
        ? uncertain
        : scenario === "wrapped_unknown_commit"
          ? Object.assign(unavailable, { cause: uncertain })
          : scenario === "wrapped_database"
            ? Object.assign(unavailable, {
                cause: Object.assign(Error("SYNTHETIC_PRIVATE_SQL"), {
                  code: "PROTOCOL_SEQUENCE_TIMEOUT",
                }),
              })
            : scenario === "wrapped_lease"
              ? Object.assign(unavailable, { cause: new LeaseLostError() })
              : scenario === "wrapped_authority"
                ? Object.assign(unavailable, {
                    cause: Object.assign(Error("SYNTHETIC_PRIVATE_AUTHORITY"), { statusCode: 403 }),
                  })
                : scenario === "database"
                  ? Object.assign(Error("SYNTHETIC_PRIVATE_SQL"), {
                      code: "PROTOCOL_SEQUENCE_TIMEOUT",
                    })
                  : scenario === "lease"
                    ? new LeaseLostError()
                    : scenario === "authority"
                      ? Object.assign(Error("SYNTHETIC_PRIVATE_AUTHORITY"), { statusCode: 403 })
                      : scenario === "cancelled"
                        ? new BlobFailure("cancelled")
                        : unavailable;
    const sequence: string[] = [];
    const close = vi.fn(async () => {
      sequence.push("close");
    });
    const unit = { close };
    const maintenance = vi.fn(async () => {
      sequence.push("maintenance");
      if (scenario === "aborted_unavailable") {
        const listener = process
          .listeners("SIGTERM")
          .find((listener) => !signals.get("SIGTERM")?.includes(listener));
        expect(listener).toBeDefined();
        listener?.("SIGTERM");
      }
      if (!["complete", "inspect", "disabled", "configuration_pending"].includes(scenario))
        throw failure;
      return "complete";
    });
    const inspect = vi.fn(async () => ({ status: "inspected" }));
    const pass = vi.fn(async () => {
      sequence.push("pass");
      if (scenario === "pass_unknown_commit") throw uncertain;
      return { status: "completed", processed: 1 };
    });
    const admissions = vi.fn(async () => "completed"),
      mail = vi.fn(async () => "completed");
    const catalogs = vi.fn(async () => {});
    const pending = vi.fn(async () => scenario === "configuration_pending");
    const observedErrors: unknown[] = [];
    vi.resetModules();
    vi.doMock("@vtc/db", async (original) => ({
      ...(await original<typeof import("@vtc/db")>()),
      TransactionCommitOutcomeUnknownError,
      createUnitOfWork: () => unit,
    }));
    vi.doMock("../../apps/api/src/platform/blob-storage/filesystem.ts", () => ({ BlobFailure }));
    vi.doMock("../../apps/api/src/platform/config/env.ts", () => ({
      readConfig: () => ({ identity: {}, database: {}, mail: { mode: "local" }, catalogs: {} }),
    }));
    vi.doMock("../../apps/api/src/platform/jobs/process.ts", () => ({
      ownedCli: (work: () => Promise<void>) => work(),
    }));
    vi.doMock("../../apps/api/src/modules/admissions/service.ts", () => ({
      cleanupAdmissions: admissions,
    }));
    vi.doMock("../../apps/api/src/modules/messaging/service.ts", () => ({ cleanupMail: mail }));
    vi.doMock("../../apps/api/src/modules/catalogs/service.ts", () => ({
      cleanupCatalogs: catalogs,
    }));
    vi.doMock("../../apps/api/src/modules/manual-reports/service.ts", () => ({
      manualCleanupPending: pending,
    }));
    vi.doMock("../../apps/api/src/platform/jobs/runner.ts", () => ({ runPass: pass }));
    vi.doMock("../../apps/api/src/platform/jobs/queue.ts", async (original) => {
      const actual = await original<typeof import("../../apps/api/src/platform/jobs/queue.ts")>();
      return {
        ...actual,
        unknownCommit: (failure: unknown) => {
          observedErrors.push(failure);
          return actual.unknownCommit(failure);
        },
      };
    });
    vi.doMock("../../apps/api/src/use-cases/identity-messaging.ts", () => ({
      composeIdentity: () => ({
        messaging: {},
        catalogs: {},
        jobsQueue: { inspect },
        ...(scenario === "disabled" || scenario === "configuration_pending"
          ? {}
          : { manualReports: { maintenance } }),
      }),
    }));
    process.argv = ["node", "jobs.js", scenario === "inspect" ? "inspect" : "run"];
    process.exitCode = undefined;
    vi.useFakeTimers();
    try {
      await import("../../apps/api/src/jobs.ts");
      const continued = [
        "complete",
        "disabled",
        "configuration_pending",
        "storage_unavailable",
        "pass_unknown_commit",
      ].includes(scenario);
      expect(pass).toHaveBeenCalledTimes(continued ? 1 : 0);
      expect(maintenance).toHaveBeenCalledTimes(
        ["inspect", "disabled", "configuration_pending"].includes(scenario) ? 0 : 1,
      );
      expect(inspect).toHaveBeenCalledTimes(scenario === "inspect" ? 1 : 0);
      expect(close).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
      if (["complete", "inspect", "disabled", "configuration_pending"].includes(scenario))
        expect(process.exitCode).toBeUndefined();
      else expect(process.exitCode).toBe(1);
      const result = records.find((record) => record.event === "jobs_result");
      if (scenario === "storage_unavailable") {
        expect(result).toMatchObject({ manualCleanup: "storage_unavailable", processed: 1 });
        expect(records).toContainEqual({
          event: "manual_cleanup_failed",
          category: "storage_unavailable",
        });
        expect(sequence).toEqual(["maintenance", "pass", "close"]);
      } else if (scenario === "complete" || scenario === "disabled")
        expect(result?.manualCleanup).toBe("complete");
      else if (scenario === "inspect") {
        expect(result?.manualCleanup).toBe("not_run");
        expect(admissions).not.toHaveBeenCalled();
        expect(mail).not.toHaveBeenCalled();
        expect(catalogs).not.toHaveBeenCalled();
      } else if (scenario === "configuration_pending")
        expect(result?.manualCleanup).toBe("configuration_pending");
      else {
        expect(result).toBeUndefined();
        expect(observedErrors.at(-1)).toBe(
          scenario === "pass_unknown_commit" ? uncertain : failure,
        );
        expect(records).toContainEqual({
          event: "jobs_failed",
          category: ["unknown_commit", "wrapped_unknown_commit", "pass_unknown_commit"].includes(
            scenario,
          )
            ? "commit_outcome_unknown"
            : "operation_failed",
        });
      }
      expect(JSON.stringify(records)).not.toContain("SYNTHETIC_PRIVATE");
    } finally {
      for (const [signal, original] of signals)
        for (const listener of process.listeners(signal))
          if (!original.includes(listener)) process.removeListener(signal, listener);
      process.argv = originalArgv;
      process.exitCode = originalExitCode;
      vi.useRealTimers();
      log.mockRestore();
      error.mockRestore();
      for (const path of [
        "@vtc/db",
        "../../apps/api/src/platform/blob-storage/filesystem.ts",
        "../../apps/api/src/platform/config/env.ts",
        "../../apps/api/src/platform/jobs/process.ts",
        "../../apps/api/src/modules/admissions/service.ts",
        "../../apps/api/src/modules/messaging/service.ts",
        "../../apps/api/src/modules/catalogs/service.ts",
        "../../apps/api/src/modules/manual-reports/service.ts",
        "../../apps/api/src/platform/jobs/runner.ts",
        "../../apps/api/src/platform/jobs/queue.ts",
        "../../apps/api/src/use-cases/identity-messaging.ts",
      ])
        vi.doUnmock(path);
      vi.resetModules();
    }
  },
);
