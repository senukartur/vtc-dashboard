import { performance } from "node:perf_hooks";
import { TransactionCommitOutcomeUnknownError } from "@vtc/db";
import type { components } from "@vtc/contracts";
import { expect, test, vi } from "vitest";
import {
  completeCatalogImport,
  catalogFixtureLifecycle,
  type CatalogFixtureDiagnostic,
} from "../support/catalog-import-fixture.ts";
import { deferred } from "../support/concurrency.ts";

type Operation = components["schemas"]["Operation"];
const operationId = "00000000-0000-4000-8000-000000000001";
const resultId = "00000000-0000-4000-8000-000000000002";
const processing: Operation = {
  id: operationId,
  state: "processing",
  resultId: null,
  failureCode: null,
};
const completed: Operation = { ...processing, state: "completed", resultId };
const options = () => ({ deadlineAt: performance.now() + 1000 });
const lost = () =>
  new TransactionCommitOutcomeUnknownError(
    Object.assign(new Error("NONFUNCTIONAL_PRIVATE_DIAGNOSTIC"), {
      code: "PROTOCOL_SEQUENCE_TIMEOUT",
    }),
  );

test("an already completed exact operation needs no fresh key, artifact or queue pass", async () => {
  const read = vi.fn(async () => completed),
    pass = vi.fn(async () => ({ processed: 0 }));
  expect(await completeCatalogImport(operationId, { read, pass }, options())).toEqual(completed);
  expect(read.mock.calls).toEqual([[operationId]]);
  expect(pass).not.toHaveBeenCalled();
});

test("a committed terminal outcome is recovered by a fresh exact-operation read without callback replay", async () => {
  let current = processing;
  const read = vi.fn(async (_id: string) => current);
  const pass = vi.fn(async () => {
    current = completed;
    throw lost();
  });
  const records: CatalogFixtureDiagnostic[] = [];
  expect(
    await completeCatalogImport(
      operationId,
      { read, pass },
      { ...options(), observe: (record) => records.push(record) },
    ),
  ).toEqual(completed);
  expect(read.mock.calls).toEqual([[operationId], [operationId]]);
  expect(pass).toHaveBeenCalledTimes(1);
  expect(records.map((record) => record.state)).toEqual([
    "processing",
    "commit_unknown",
    "completed",
  ]);
  expect(records[1]?.nativeCodes).toEqual(["PROTOCOL_SEQUENCE_TIMEOUT"]);
});

test("a committed continuation drives another ordinary durable pass for the same operation", async () => {
  let current = processing,
    passes = 0;
  const read = vi.fn(async (_id: string) => current);
  const pass = vi.fn(async () => {
    if (++passes === 1) throw lost();
    current = completed;
    return { processed: 4 };
  });
  expect(await completeCatalogImport(operationId, { read, pass }, options())).toEqual(completed);
  expect(pass).toHaveBeenCalledTimes(2);
  expect(read.mock.calls).toEqual([[operationId], [operationId], [operationId]]);
});

test("a noncommitted phase waits for a natural lease before a standard pass can complete it", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  try {
    let current = processing,
      first = true,
      effects = 0;
    const read = vi.fn(async (_id: string) => current);
    const pass = vi.fn(async () => {
      if (first) {
        first = false;
        throw lost();
      }
      if (Date.now() < 15000) return { processed: 0 };
      effects++;
      current = completed;
      return { processed: 1 };
    });
    const work = completeCatalogImport(
      operationId,
      { read, pass },
      { deadlineAt: 25000, now: Date.now },
    );
    await vi.advanceTimersByTimeAsync(14999);
    expect(effects).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(await work).toEqual(completed);
    expect(effects).toBe(1);
    expect(read.mock.calls.every(([id]) => id === operationId)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

test("ordinary native timeouts and forged unknown codes propagate rather than authorizing recovery", async () => {
  for (const error of [
    Object.assign(new Error(), { code: "PROTOCOL_SEQUENCE_TIMEOUT" }),
    { code: "TRANSACTION_COMMIT_OUTCOME_UNKNOWN" },
  ]) {
    const read = vi.fn(async () => processing),
      pass = vi.fn(async () => {
        throw error;
      });
    await expect(completeCatalogImport(operationId, { read, pass }, options())).rejects.toBe(error);
    expect(read).toHaveBeenCalledTimes(1);
    expect(pass).toHaveBeenCalledTimes(1);
  }
});

test("a failed terminal operation is a failure even after typed COMMIT uncertainty", async () => {
  let current = processing;
  const read = vi.fn(async () => current),
    pass = vi.fn(async () => {
      current = { ...processing, state: "failed", failureCode: "NONFUNCTIONAL_PRIVATE_DIAGNOSTIC" };
      throw lost();
    });
  const records: CatalogFixtureDiagnostic[] = [];
  await expect(
    completeCatalogImport(
      operationId,
      { read, pass },
      { ...options(), observe: (record) => records.push(record) },
    ),
  ).rejects.toThrow("CATALOG_FIXTURE_OPERATION_FAILED");
  expect(pass).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(records)).not.toContain("NONFUNCTIONAL_PRIVATE_DIAGNOSTIC");
});

test("missing result, wrong operation and unsupported states never produce false completion", async () => {
  for (const [current, category] of [
    [{ ...completed, resultId: null }, "RESULT_MISSING"],
    [{ ...completed, id: resultId }, "WRONG_OPERATION"],
    [{ ...processing, state: "unknown" } as unknown as Operation, "INVALID_STATE"],
  ] as const) {
    const pass = vi.fn(async () => ({ processed: 0 }));
    await expect(
      completeCatalogImport(operationId, { read: async () => current, pass }, options()),
    ).rejects.toThrow(`CATALOG_FIXTURE_${category}`);
    expect(pass).not.toHaveBeenCalled();
  }
});

test("fresh operation read failures propagate and do not schedule another pass", async () => {
  const error = new Error("NONFUNCTIONAL_PRIVATE_DIAGNOSTIC");
  const pass = vi.fn(async () => ({ processed: 0 }));
  await expect(
    completeCatalogImport(
      operationId,
      {
        read: async () => {
          throw error;
        },
        pass,
      },
      options(),
    ),
  ).rejects.toBe(error);
  expect(pass).not.toHaveBeenCalled();
});

test("bounded defensive causes recover only the typed outcome and emit closed redacted metadata", async () => {
  const privateValue = "NONFUNCTIONAL_PRIVATE_DIAGNOSTIC";
  const cyclic: Record<string, unknown> = {
    message: privateValue,
    sql: privateValue,
    cause: lost(),
  };
  Object.assign(cyclic.cause as object, { cause: cyclic });
  let current = processing;
  const records: CatalogFixtureDiagnostic[] = [];
  expect(
    await completeCatalogImport(
      operationId,
      {
        read: async () => current,
        pass: async () => {
          current = completed;
          throw cyclic;
        },
      },
      { ...options(), observe: (record) => records.push(record) },
    ),
  ).toEqual(completed);
  const output = JSON.stringify(records);
  for (const value of [privateValue, operationId, resultId, '"message"', '"sql"', '"cause"'])
    expect(output).not.toContain(value);
  expect(Object.keys(records[0] ?? {}).sort()).toEqual([
    "elapsedMs",
    "event",
    "nativeCodes",
    "phase",
    "state",
  ]);
});

test("hostile getters, cyclic unknown causes and excessive chains cannot authorize recovery", async () => {
  const hostile = new Proxy(
    {},
    {
      get() {
        throw new Error("NONFUNCTIONAL_PRIVATE_DIAGNOSTIC");
      },
    },
  );
  const cyclic: Record<string, unknown> = {};
  cyclic.cause = cyclic;
  const deep = { cause: {} };
  let tail: { cause: unknown } = deep;
  for (let depth = 0; depth < 9; depth++) {
    const next = { cause: {} };
    tail.cause = next;
    tail = next;
  }
  tail.cause = lost();
  for (const error of [hostile, cyclic, deep]) {
    const read = vi.fn(async () => processing),
      records: CatalogFixtureDiagnostic[] = [];
    await expect(
      completeCatalogImport(
        operationId,
        {
          read,
          pass: async () => {
            throw error;
          },
        },
        { ...options(), observe: (record) => records.push(record) },
      ),
    ).rejects.toBe(error);
    expect(read).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(records)).not.toContain("NONFUNCTIONAL_PRIVATE_DIAGNOSTIC");
  }
});

test("deadline abort waits for an in-flight pass to settle before fixture teardown can proceed", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  try {
    const gate = deferred<{ processed: number }>();
    let signal: AbortSignal | undefined,
      settled = false;
    const work = completeCatalogImport(
      operationId,
      {
        read: async () => processing,
        pass: async (value) => {
          signal = value;
          return gate.promise;
        },
      },
      { deadlineAt: 1000, now: Date.now },
    );
    const outcome = work.catch((error: unknown) => {
      settled = true;
      return error;
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(signal?.aborted).toBe(true);
    expect(settled).toBe(false);
    gate.resolve({ processed: 0 });
    expect(await outcome).toMatchObject({ message: "CATALOG_FIXTURE_DEADLINE" });
    expect(settled).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

test("upstream abort also drains in-flight work without echoing its private reason", async () => {
  const controller = new AbortController(),
    gate = deferred<{ processed: number }>();
  let entered = false,
    settled = false;
  const work = completeCatalogImport(
    operationId,
    {
      read: async () => processing,
      pass: async (signal) => {
        entered = true;
        expect(signal.aborted).toBe(false);
        return gate.promise;
      },
    },
    { ...options(), signal: controller.signal },
  );
  const outcome = work.catch((error: unknown) => {
    settled = true;
    return error;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(entered).toBe(true);
  controller.abort("NONFUNCTIONAL_PRIVATE_DIAGNOSTIC");
  expect(settled).toBe(false);
  gate.resolve({ processed: 0 });
  expect(await outcome).toMatchObject({ message: "CATALOG_FIXTURE_ABORTED" });
});

test("idle deadline is bounded, clears timers and never creates another operation", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  try {
    const read = vi.fn(async (_id: string) => processing),
      pass = vi.fn(async () => ({ processed: 0 }));
    const work = completeCatalogImport(
      operationId,
      { read, pass },
      { deadlineAt: 1000, now: Date.now },
    );
    const outcome = work.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await outcome).toMatchObject({ message: "CATALOG_FIXTURE_DEADLINE" });
    expect(read.mock.calls.every(([id]) => id === operationId)).toBe(true);
    expect(pass.mock.calls.length).toBeLessThanOrEqual(5);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

test("an in-flight read also settles before a deadline can release the fixture", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  try {
    const gate = deferred<Operation>(),
      pass = vi.fn(async () => ({ processed: 0 }));
    let settled = false;
    const work = completeCatalogImport(
      operationId,
      { read: () => gate.promise, pass },
      { deadlineAt: 1000, now: Date.now },
    );
    const outcome = work.catch((error: unknown) => {
      settled = true;
      return error;
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(settled).toBe(false);
    gate.resolve(completed);
    expect(await outcome).toMatchObject({ message: "CATALOG_FIXTURE_DEADLINE" });
    expect(pass).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

test("diagnostic consumer failure cannot change a supported completed result", async () => {
  expect(
    await completeCatalogImport(
      operationId,
      { read: async () => completed, pass: async () => ({ processed: 0 }) },
      {
        ...options(),
        observe() {
          throw new Error();
        },
      },
    ),
  ).toEqual(completed);
});

test("timed-out reset remains serialized before close and closing rejects new catalog work before invocation", async () => {
  vi.useFakeTimers();
  try {
    const lifecycle = catalogFixtureLifecycle(),
      catalog = deferred<void>(),
      resetGate = deferred<void>();
    const calls: string[] = [];
    const original = lifecycle.track(() => {
      calls.push("catalog_started");
      return catalog.promise;
    });
    const reset = lifecycle.reset(async () => {
      calls.push("reset_started");
      await resetGate.promise;
      calls.push("reset_finished");
    });
    const frameworkTimeout = new Error("SYNTHETIC_HOOK_TIMEOUT");
    const timeout = Promise.race([
      reset,
      new Promise<never>((_, reject) => setTimeout(() => reject(frameworkTimeout), 10)),
    ]).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10);
    expect(await timeout).toBe(frameworkTimeout);
    const close = lifecycle.close(async () => {
      calls.push("close");
    });
    const lateWork = vi.fn(async () => {
      calls.push("late_work");
    });
    await expect(lifecycle.track(lateWork)).rejects.toThrow("CATALOG_FIXTURE_CLOSING");
    await expect(lifecycle.reset(lateWork)).rejects.toThrow("CATALOG_FIXTURE_CLOSING");
    expect(lateWork).not.toHaveBeenCalled();
    expect(calls).toEqual(["catalog_started"]);
    catalog.resolve();
    await original;
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual(["catalog_started", "reset_started"]);
    resetGate.resolve();
    await reset;
    await close;
    expect(calls).toEqual(["catalog_started", "reset_started", "reset_finished", "close"]);
    await expect(lifecycle.track(lateWork)).rejects.toThrow("CATALOG_FIXTURE_CLOSING");
    expect(lateWork).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

test("all accepted catalog promises drain while their original failures remain owned by callers", async () => {
  const lifecycle = catalogFixtureLifecycle(),
    first = deferred<void>(),
    second = deferred<void>();
  const failure = new Error("NONFUNCTIONAL_PRIVATE_DIAGNOSTIC");
  const work = lifecycle.track(() => first.promise),
    other = lifecycle.track(() => second.promise);
  const originalFailure = work.catch((error: unknown) => error);
  let closed = false;
  const close = lifecycle.close(async () => {
    closed = true;
  });
  first.reject(failure);
  expect(await originalFailure).toBe(failure);
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(closed).toBe(false);
  second.resolve();
  await other;
  await close;
  expect(closed).toBe(true);
});

test("a reset rejection does not suppress its caller failure or prevent queued close", async () => {
  const lifecycle = catalogFixtureLifecycle(),
    calls: string[] = [];
  const failure = new Error("NONFUNCTIONAL_PRIVATE_DIAGNOSTIC");
  const reset = lifecycle.reset(async () => {
    calls.push("reset");
    throw failure;
  });
  const originalFailure = reset.catch((error: unknown) => error);
  const close = lifecycle.close(async () => {
    calls.push("close");
  });
  expect(await originalFailure).toBe(failure);
  await close;
  expect(calls).toEqual(["reset", "close"]);
});
