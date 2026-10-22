import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { Connection } from "mysql2/promise";
import { expect, test, vi } from "vitest";
import { deferred } from "../support/concurrency.ts";
import { fixtureDatabaseFailure } from "../support/fixture-database-diagnostics.ts";
import { childClose, fixtureSettlement } from "../support/fixture-settlement.ts";
import {
  safeGenerationProcessRecord,
  safeGenerationWorkerRecord,
} from "../support/manual-generation-diagnostics.ts";

const child = () =>
  Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  }) as unknown as ChildProcess;

test("exit cannot release fixture ownership before the final receipt and stream close", async () => {
  const process = child(),
    settled = vi.fn();
  let receipt = "";
  process.stdout?.on("data", (chunk) => {
    receipt += String(chunk);
  });
  const work = childClose(process).then((value) => {
    settled();
    return value;
  });
  process.emit("exit", 0, null);
  await Promise.resolve();
  expect(settled).not.toHaveBeenCalled();
  process.stdout?.emit("data", "synthetic final receipt");
  process.stdout?.emit("end");
  process.stderr?.emit("end");
  process.emit("close", 0, null);
  expect(await work).toEqual({ code: 0, signal: null, spawnFailed: false, streamFailed: false });
  expect(receipt).toBe("synthetic final receipt");
  expect(process.listenerCount("close")).toBe(0);
  expect(process.listenerCount("error")).toBe(0);
  expect(process.stdout?.listenerCount("error")).toBe(0);
  expect(process.stderr?.listenerCount("error")).toBe(0);
});

test.each(["spawn", "stream", "abort", "deadline"] as const)(
  "%s failure still retains ownership until close and preserves its failure facts",
  async (mode) => {
    const process = child(),
      settled = vi.fn();
    const work = childClose(process).then((value) => {
      settled();
      return value;
    });
    if (mode === "spawn") process.emit("error", Error("SYNTHETIC_PRIVATE_NATIVE_ERROR"));
    if (mode === "stream") process.stdout?.emit("error", Error("SYNTHETIC_PRIVATE_STREAM_ERROR"));
    const signal = mode === "deadline" ? "SIGKILL" : "SIGTERM";
    if (mode === "abort" || mode === "deadline") process.emit("exit", null, signal);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    process.emit("close", null, signal);
    expect(await work).toEqual({
      code: null,
      signal,
      spawnFailed: mode === "spawn",
      streamFailed: mode === "stream",
    });
    expect(process.listenerCount("error")).toBe(0);
    expect(process.stdout?.listenerCount("error")).toBe(0);
    expect(process.stderr?.listenerCount("error")).toBe(0);
  },
);

test("a timed-out callback cannot let a successor reset until its original work settles", async () => {
  const fixture = fixtureSettlement(),
    first = deferred<void>(),
    second = deferred<void>();
  const failure = Error("SYNTHETIC_ORIGINAL_FAILURE"),
    reset = vi.fn();
  const original = fixture.track(
    first.promise.then(async () => {
      await second.promise;
      throw failure;
    }),
  );
  const assertion = expect(original).rejects.toBe(failure);
  const successor = fixture.wait().then(reset);
  first.resolve();
  await Promise.resolve();
  expect(reset).not.toHaveBeenCalled();
  second.resolve();
  await assertion;
  await successor;
  expect(reset).toHaveBeenCalledOnce();
});

test("failed-fixture diagnostics retain only scoped counts and native failure categories", async () => {
  const lines: string[] = [],
    output = vi.spyOn(console, "log").mockImplementation((line) => lines.push(String(line)));
  const rows = [
    [{ total: "4", privateValue: "SYNTHETIC_PRIVATE" }],
    [
      { Variable_name: "Threads_connected", Value: "6" },
      { Variable_name: "SYNTHETIC_PRIVATE", Value: "42" },
    ],
    [{ active: "1", remaining: "12000", ready: "1", running: "0" }],
  ];
  const query = vi.fn(async () => [rows.shift(), []]);
  const control = { query } as unknown as Connection;
  try {
    await fixtureDatabaseFailure(control, "generation_progress");
    expect(JSON.parse(lines[0] as string)).toMatchObject({
      event: "fixture_database_failure",
      caseId: "generation_progress",
      ownedUserConnections: 4,
      serverGlobal: { Threads_connected: 6 },
      queue: { activeRunnerLeases: 1, runnerRemainingMs: 12000, readyJobs: 1, runningJobs: 0 },
    });
    expect(query).toHaveBeenCalledTimes(3);
    for (const [options] of query.mock.calls as unknown as [{ timeout: number }][])
      expect(options.timeout).toBe(500);
    const error = Object.assign(Error("SYNTHETIC_PRIVATE_SQL"), { code: "ER_CON_COUNT_ERROR" });
    query.mockRejectedValueOnce(error);
    await fixtureDatabaseFailure(control, "admissions_flood");
    expect(JSON.parse(lines[1] as string)).toMatchObject({
      state: "unavailable",
      codes: ["ER_CON_COUNT_ERROR"],
    });
    expect(lines.join("\n")).not.toContain("SYNTHETIC_PRIVATE");
    await expect(
      fixtureDatabaseFailure(control, "SYNTHETIC_PRIVATE" as "admissions_flood"),
    ).rejects.toThrow("INVALID_DATABASE_FIXTURE_SCOPE");
  } finally {
    output.mockRestore();
  }
});

test("queue pass diagnostics distinguish overlap without accepting unbounded or private metadata", () => {
  const record = {
    event: "manual_generation_worker_phase",
    phase: "pass",
    state: "success",
    durationMs: 4,
    runnerStatus: "overlap",
    processed: 0,
  };
  expect(safeGenerationWorkerRecord(record)).toEqual(record);
  expect(
    safeGenerationProcessRecord({
      ...record,
      event: "manual_generation_phase",
      caseId: "generation_late",
      ordinal: 1,
    }),
  ).toEqual({ ...record, event: "manual_generation_phase", caseId: "generation_late", ordinal: 1 });
  for (const patch of [
    { runnerStatus: "SYNTHETIC_PRIVATE" },
    { processed: -1 },
    { phase: "maintenance" },
    { privateValue: "SYNTHETIC_PRIVATE" },
  ])
    expect(safeGenerationWorkerRecord({ ...record, ...patch })).toBeUndefined();
});
