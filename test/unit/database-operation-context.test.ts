import { expect, test, vi } from "vitest";
import {
  databaseFailureContext,
  observeDatabaseOperation,
} from "../../packages/db/src/core/operation-context.ts";

test("database operation diagnostics preserve exact error/cause and retain only fixed side metadata", async () => {
  const cause = new Error("SYNTHETIC_PRIVATE_INPUT");
  const failure = Object.assign(new Error("SYNTHETIC_PRIVATE_SQL", { cause }), {
    code: "PROTOCOL_SEQUENCE_TIMEOUT",
  });
  const before = JSON.stringify(failure);
  await expect(
    observeDatabaseOperation("migration_baseline", 1000, async () => {
      throw failure;
    }),
  ).rejects.toBe(failure);
  expect(failure.cause).toBe(cause);
  expect(JSON.stringify(failure)).toBe(before);
  expect(Object.keys(databaseFailureContext(failure) ?? {}).sort()).toEqual([
    "elapsedMs",
    "operation",
    "wireDeadlineMs",
  ]);
  const context = databaseFailureContext(failure);
  expect(context).toMatchObject({ operation: "migration_baseline", wireDeadlineMs: 1000 });
  expect(context?.elapsedMs).toBeGreaterThanOrEqual(0);
  Object.assign(context ?? {}, { operation: "SYNTHETIC_PRIVATE" });
  expect(databaseFailureContext(failure)?.operation).toBe("migration_baseline");
});

test("nested operation capture preserves the precise inner phase and bounded cause lookup", async () => {
  const failure = new Error("SYNTHETIC_PRIVATE");
  await expect(
    observeDatabaseOperation("migration_baseline", 1000, () =>
      observeDatabaseOperation("session_charset", 1000, async () => {
        throw failure;
      }),
    ),
  ).rejects.toBe(failure);
  expect(databaseFailureContext(new Error("SYNTHETIC_PRIVATE", { cause: failure }))).toMatchObject({
    operation: "session_charset",
    wireDeadlineMs: 1000,
  });
  const cycle = { cause: {} };
  cycle.cause = cycle;
  expect(databaseFailureContext(cycle)).toBeNull();
  expect(
    databaseFailureContext({
      get cause() {
        throw new Error("SYNTHETIC_PRIVATE");
      },
    }),
  ).toBeNull();
  expect(
    databaseFailureContext({ operation: "migration_statement", wireDeadlineMs: 1 }),
  ).toBeNull();
});

test("operation observer emits no logs and rejects invalid metadata without altering work", async () => {
  const output = vi.spyOn(console, "log");
  const work = vi.fn(async () => 3);
  try {
    expect(await observeDatabaseOperation("migration_statement", 30000, work)).toBe(3);
    expect(work).toHaveBeenCalledTimes(1);
    for (const [operation, deadline] of [
      ["SYNTHETIC_PRIVATE", 1000],
      ["migration_lock", Number.NaN],
    ] as const) {
      const failure = new Error("SYNTHETIC_PRIVATE");
      await expect(
        observeDatabaseOperation(operation as never, deadline, async () => {
          throw failure;
        }),
      ).rejects.toBe(failure);
      expect(databaseFailureContext(failure)).toBeNull();
    }
    await expect(
      observeDatabaseOperation("connection_open", 1000, async () => {
        throw 7;
      }),
    ).rejects.toBe(7);
    expect(output).not.toHaveBeenCalled();
  } finally {
    output.mockRestore();
  }
});
