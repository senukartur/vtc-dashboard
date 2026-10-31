import { newId } from "@vtc/db";
import { expect, test } from "vitest";
import { createSchemaValidator } from "../../apps/api/src/platform/http/schemas.ts";

const valid = (name: string) =>
  createSchemaValidator().compile({ $ref: `urn:vtc:browser:v1#/$defs/${name}` });
test("notification feed requires a non-null empty checkpoint and safe closed display", () => {
  const row = {
    id: newId(),
    category: "trip.started",
    messageKey: "notifications.trip.started",
    display: { actorNickname: "Fictional Driver", game: "ets2", eventTitle: null },
    target: null,
    occurredAt: "2026-10-25T00:30:00.000Z",
    readAt: null,
    liveToastEligible: true,
  };
  expect(valid("Notification")(row)).toBe(true);
  for (const field of ["reason", "email", "evidence", "providerPayload", "declineReason"])
    expect(
      valid("Notification")({
        ...row,
        display: { ...row.display, [field]: "Fictional private value" },
      }),
    ).toBe(false);
  const feed = {
    items: [],
    nextCursor: "signed-checkpoint",
    hasMore: false,
    unreadCount: 0,
    serverTime: row.occurredAt,
  };
  expect(valid("NotificationFeed")(feed)).toBe(true);
  expect(valid("NotificationFeed")({ ...feed, nextCursor: null })).toBe(false);
  expect(valid("NotificationFeed")({ ...feed, unreadCount: -1 })).toBe(false);
});
test("the six preference booleans and read-through contract remain closed", () => {
  const p = {
    tripStarted: true,
    tripFinished: true,
    tripRejected: true,
    eventChanges: true,
    eventReminders: true,
    qualificationChanges: true,
  };
  expect(valid("NotificationPreferences")(p)).toBe(true);
  expect(valid("NotificationPreferences")({ ...p, mail: true })).toBe(false);
  expect(valid("NotificationPreferences")({ ...p, tripStarted: "true" })).toBe(false);
  expect(valid("ReadAllInput")({ throughCursor: "signed-poll-checkpoint" })).toBe(true);
  expect(
    valid("ReadAllInput")({ throughCursor: "signed-poll-checkpoint", throughSequence: 100 }),
  ).toBe(false);
});
