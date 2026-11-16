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
test("Stage 4 preference toggles are optional, boolean and closed", () => {
  const six = {
    tripStarted: true,
    tripFinished: true,
    tripRejected: false,
    eventChanges: true,
    eventReminders: true,
    qualificationChanges: false,
  };
  const preferences = valid("NotificationPreferences");
  const reviewer = { ...six, reviewQueue: true, newApplications: false };
  expect(preferences({ ...reviewer, tripAccepted: true, newEvent: false })).toBe(true);
  expect(preferences({ ...six, tripAccepted: true, newEvent: true })).toBe(true);
  expect(preferences(six)).toBe(true);
  for (const field of ["reviewQueue", "newApplications", "tripAccepted", "newEvent"])
    expect(preferences({ ...six, [field]: "true" }), field).toBe(false);
  expect(preferences({ ...six, eventPublished: true })).toBe(false);
  const { tripStarted: _started, ...missing } = six;
  expect(preferences({ ...missing, tripAccepted: true })).toBe(false);
});

test("new notification kinds use the existing closed row with their own targets", () => {
  const categories = valid("NotificationStage4Category");
  for (const category of [
    "trip.accepted",
    "event.published",
    "trip.started",
    "member.access_changed",
  ])
    expect(categories(category), category).toBe(true);
  for (const category of ["trip.approved", "event.created", ""])
    expect(categories(category), category).toBe(false);
  const row = {
    id: newId(),
    category: "trip.accepted",
    messageKey: "notifications.trip.accepted",
    display: { actorNickname: null, game: "ets2", eventTitle: null },
    target: { kind: "trip", id: newId() },
    occurredAt: "2026-11-10T19:30:00.000Z",
    readAt: null,
    liveToastEligible: true,
  };
  expect(valid("Notification")(row)).toBe(true);
  expect(
    valid("Notification")({
      ...row,
      category: "event.published",
      messageKey: "notifications.event.published",
      target: { kind: "event", id: newId() },
    }),
  ).toBe(true);
  expect(valid("Notification")({ ...row, target: { kind: "trip_accepted", id: newId() } })).toBe(
    false,
  );
  // Unknown categories remain a free string for older clients.
  expect(valid("Notification")({ ...row, category: "future.kind" })).toBe(true);
});

test("a null display time zone means as on the device and the legacy read stays a string", () => {
  const input = valid("PreferencesInput");
  expect(input({ displayTimezone: null })).toBe(true);
  expect(input({ displayTimezone: "Europe/Berlin" })).toBe(true);
  expect(input({ displayTimezone: "" })).toBe(false);
  expect(input({})).toBe(false);
  const staged = valid("PreferencesStage4");
  expect(staged({ locale: "ru", displayTimezone: null })).toBe(true);
  expect(staged({ locale: "ru" })).toBe(false);
  expect(valid("Preferences")({ locale: "ru", displayTimezone: null })).toBe(false);
  expect(valid("Preferences")({ locale: "ru", displayTimezone: "UTC" })).toBe(true);
  const self = {
    member: { id: newId(), nickname: "Fictional Driver", formerMember: false, roles: ["driver"] },
    email: "driver@example.invalid",
    emailVerified: true,
    capabilities: ["company.read"],
    preferences: { locale: "en", displayTimezone: null },
    steamVerified: false,
    identityEpoch: 1,
    missingSetup: [],
  };
  expect(valid("SelfStage4")(self)).toBe(true);
  expect(valid("Self")(self)).toBe(false);
  expect(valid("Self")({ ...self, preferences: { locale: "en", displayTimezone: "UTC" } })).toBe(
    true,
  );
});
