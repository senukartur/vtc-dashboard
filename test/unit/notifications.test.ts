import { newId } from "@vtc/db";
import { expect, test } from "vitest";
import { notificationCursors } from "../../apps/api/src/modules/notifications/cursor.ts";
import {
  reminderWindow,
  sourceLiveUntil,
} from "../../apps/api/src/modules/notifications/policy.ts";
import {
  eventReference,
  reminderReference,
  validateNotificationsConfig,
} from "../../apps/api/src/modules/notifications/service.ts";
import { domainEvent } from "../../apps/api/src/platform/outbox/events.ts";

const actor = {
  userId: newId(),
  sessionId: newId(),
  accessEpoch: 1,
  credentialEpoch: 1,
  capabilities: [],
};
test("notification checkpoints preserve BIGINT precision and bind user, session, epochs and direction", () => {
  const c = notificationCursors("a".repeat(64)),
    saved = c.encode(actor, "poll", "9007199254740993");
  expect(c.decode(actor, "poll", saved)).toBe("9007199254740993");
  expect(c.decode(actor, "read-through", saved)).toBe("9007199254740993");
  expect(() => c.decode(actor, "read-through", c.encode(actor, "history", "1"))).toThrow();
  for (const changed of [
    { ...actor, userId: newId() },
    { ...actor, sessionId: newId() },
    { ...actor, accessEpoch: 2 },
    { ...actor, credentialEpoch: 2 },
  ])
    expect(() => c.decode(changed, "poll", saved)).toThrow();
  expect(() => c.decode(actor, "history", saved)).toThrow();
  expect(() => c.decode(actor, "poll", `${saved}x`)).toThrow();
  expect(c.decode(actor, "poll", c.encode(actor, "poll", "0"))).toBe("0");
});
test.each([0, 119999, 120000, 120001])(
  "source freshness %i ms uses receipt and supported occurrence",
  (delay) => {
    const utc = "2026-10-25T00:30:00.000Z",
      receivedAt = new Date(Date.parse(utc) + delay).toISOString(),
      context = { provider: "ets2telemetry", deliveryMode: "live", receivedAt };
    const reported = { utc, basis: "event" as const, verifiedActual: true };
    expect(sourceLiveUntil(context, reported)).toBe(
      delay <= 120000 ? "2026-10-25T00:32:00.000Z" : null,
    );
    expect(sourceLiveUntil({ ...context, deliveryMode: "backfill" }, reported)).toBeNull();
    expect(sourceLiveUntil(context, { ...reported, basis: "checkpoint" })).toBeNull();
    expect(sourceLiveUntil(context, { ...reported, verifiedActual: false })).toBeNull();
    expect(sourceLiveUntil(context, { ...reported, utc: null })).toBeNull();
    expect(
      sourceLiveUntil({ ...context, receivedAt: "2026-10-25T00:29:59.999Z" }, reported),
    ).toBeNull();
  },
);
test("one-hour arithmetic stays UTC across DST and refuses missed/expired scheduling windows", () => {
  const start = "2026-10-25T01:30:00.000Z";
  expect(reminderWindow(start, "2026-10-25T00:29:59.999Z")).toEqual({
    due: "2026-10-25T00:30:00.000Z",
    eligible: false,
    schedulable: true,
  });
  expect(reminderWindow(start, "2026-10-25T00:30:00.000Z").eligible).toBe(true);
  expect(reminderWindow(start, "2026-10-25T00:32:00.000Z").eligible).toBe(true);
  expect(reminderWindow(start, "2026-10-25T00:32:00.001Z").schedulable).toBe(false);
  expect(reminderWindow(start, start).schedulable).toBe(false);
});
test("worker references reject extensions, nonplain objects, invalid versions and private payloads", () => {
  const eventId = newId();
  expect(eventReference({ eventId, after: null })).toEqual({ eventId, after: null });
  expect(reminderReference({ eventId, generation: 2, after: null }).generation).toBe(2);
  for (const value of [
    { eventId, after: null, reason: "Fictional private reason" },
    Object.assign(Object.create({}), { eventId, after: null }),
    { eventId, after: "not-an-id" },
  ])
    expect(() => eventReference(value)).toThrow();
  for (const generation of [0, -1, 2 ** 31, "1"])
    expect(() => reminderReference({ eventId, generation, after: null })).toThrow();
  expect(() => validateNotificationsConfig({ cursorKey: "REPLACE_WITH_KEY" })).toThrow();
});
test("typed event decoder rejects unknown family/version and leaked fields instead of casting JSON", () => {
  const id = newId(),
    e = {
      eventId: newId(),
      type: "application.submitted",
      schemaVersion: 1,
      aggregate: { kind: "application", id, version: 1 },
      occurredAt: "2026-10-25T00:30:00.000Z",
      correlationId: newId(),
      causationId: null,
      data: { applicationId: id },
    };
  expect(domainEvent(e).type).toBe("application.submitted");
  for (const value of [
    { ...e, type: "notification.anything" },
    { ...e, schemaVersion: 2 },
    { ...e, data: { ...e.data, email: "fictional@example.invalid" } },
    { ...e, aggregate: { ...e.aggregate, id: newId() } },
  ])
    expect(() => domainEvent(value)).toThrow();
});
