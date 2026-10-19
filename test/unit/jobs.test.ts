import { newId, TransactionCommitOutcomeUnknownError, type UnitOfWork } from "@vtc/db";
import { expect, test } from "vitest";
import { fixtureReference } from "../../apps/api/src/platform/jobs/acceptance.ts";
import type { Queue } from "../../apps/api/src/platform/jobs/queue.ts";
import { retryTransaction } from "../../apps/api/src/platform/jobs/queue.ts";
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
