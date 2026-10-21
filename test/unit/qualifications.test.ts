import { randomBytes } from "node:crypto";
import { newId } from "@vtc/db";
import { expect, test } from "vitest";
import { pagination } from "../../apps/api/src/modules/qualifications/pagination.ts";
import { validateQualificationsConfig } from "../../apps/api/src/modules/qualifications/service.ts";
import { qualificationEvent } from "../../apps/api/src/platform/outbox/events.ts";

const actor = {
  userId: newId(),
  sessionId: newId(),
  accessEpoch: 1,
  credentialEpoch: 1,
  capabilities: [],
};
test("signed qualification keysets are bounded and bound to user/session/epoch/scope", () => {
  const page = pagination(randomBytes(32).toString("hex"));
  const a = { id: newId() },
    b = { id: newId() },
    first = page(actor, ["history", actor.userId, "ets2", 1], { limit: 1 }).finish(
      [a, b],
      (row) => ({ id: row.id, time: "2026-10-20T12:00:00.001Z" }),
    );
  const cursor = first.nextCursor as string;
  expect(page(actor, ["history", actor.userId, "ets2", 1], { cursor }).after).toEqual({
    id: a.id,
    time: "2026-10-20T12:00:00.001Z",
  });
  for (const current of [
    { ...actor, userId: newId() },
    { ...actor, sessionId: newId() },
    { ...actor, accessEpoch: 2 },
  ])
    expect(() => page(current, ["history", actor.userId, "ets2", 1], { cursor })).toThrow();
  expect(() => page(actor, ["history", actor.userId, "ats", 1], { cursor })).toThrow();
  expect(() => page(actor, ["history", actor.userId, "ets2", 2], { cursor })).toThrow();
  expect(() =>
    page(actor, ["history", actor.userId, "ets2", 1], { cursor: `${cursor}x` }),
  ).toThrow();
  for (const limit of [0, 101, 1.1]) expect(() => page(actor, [], { limit })).toThrow();
});
test("safe qualification events accept only closed references and reject private text or mismatched kinds", () => {
  const id = newId(),
    event = {
      eventId: newId(),
      type: "promotion.review_required" as const,
      schemaVersion: 1,
      aggregate: { kind: "qualification", id, version: 1 },
      occurredAt: "2026-10-20T12:00:00.000Z",
      correlationId: newId(),
      causationId: null,
      data: { userId: newId(), assignmentId: newId() },
    };
  expect(qualificationEvent(event)).toEqual(event);
  expect(() =>
    qualificationEvent({ ...event, data: { ...event.data, reason: "Private reason" } }),
  ).toThrow();
  expect(() =>
    qualificationEvent({ ...event, aggregate: { ...event.aggregate, kind: "trip" } }),
  ).toThrow();
  expect(() =>
    qualificationEvent({ ...event, data: { userId: null, assignmentId: null } }),
  ).toThrow();
  expect(() => qualificationEvent({ ...event, schemaVersion: 2 })).toThrow();
});
test("qualification activation has no fallback cursor key or numeric policy defaults", () => {
  expect(() => validateQualificationsConfig({ cursorKey: "" })).toThrow();
  expect(() => validateQualificationsConfig({ cursorKey: "REPLACE_CURSOR_KEY" })).toThrow();
  expect(() =>
    validateQualificationsConfig({ cursorKey: randomBytes(32).toString("hex") }),
  ).not.toThrow();
});
