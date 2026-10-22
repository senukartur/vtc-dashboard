import { randomBytes } from "node:crypto";
import { expect, test } from "vitest";
import { newId } from "@vtc/db";
import { companyEvent } from "../../apps/api/src/platform/outbox/events.ts";
import { pagination } from "../../apps/api/src/modules/events/pagination.ts";
import { validateEventsConfig } from "../../apps/api/src/modules/events/service.ts";
import type { Actor } from "../../apps/api/src/modules/identity/service.ts";
const instant = "2026-10-25T00:30:00.000Z",
  key = randomBytes(32).toString("hex");
const actor: Actor = {
  userId: newId(),
  sessionId: newId(),
  accessEpoch: 1,
  credentialEpoch: 1,
  capabilities: ["company.read"],
};
test("signed event pages preserve a fixed UTC boundary and reject scope/session/epoch tampering", () => {
  let clock = new Date(instant);
  const pages = pagination(key, () => clock),
    id = newId();
  const first = pages(actor, ["events", "upcoming"], { limit: 1 });
  const result = first.finish([{ id }, { id: newId() }], (r) => ({ id: r.id, time: instant }));
  expect(result.nextCursor).toBeTruthy();
  clock = new Date("2026-10-25T02:30:00.000Z");
  const cursor = result.nextCursor as string;
  expect(pages(actor, ["events", "upcoming"], { limit: 1, cursor }).boundary).toBe(instant);
  for (const a of [
    null,
    { ...actor, userId: newId() },
    { ...actor, sessionId: newId() },
    { ...actor, accessEpoch: 2 },
  ])
    expect(() => pages(a, ["events", "upcoming"], { cursor })).toThrow();
  expect(() => pages(actor, ["events", "past"], { cursor })).toThrow();
  expect(() =>
    pages(actor, ["events", "upcoming"], { cursor: `${cursor.slice(0, -2)}xx` }),
  ).toThrow();
});
test("safe event registry rejects private data, wrong aggregate and event versions", () => {
  const id = newId(),
    r = newId(),
    e = {
      eventId: newId(),
      type: "event.changed",
      schemaVersion: 1,
      aggregate: { kind: "event", id, version: 1 },
      occurredAt: instant,
      correlationId: newId(),
      causationId: null,
      data: {
        eventId: id,
        eventRevisionId: r,
        revisionId: r,
        changeSequence: 1,
        memberId: null,
        category: "created",
      },
    };
  expect(companyEvent(e).data.category).toBe("created");
  for (const value of [
    { ...e, schemaVersion: 2 },
    { ...e, data: { ...e.data, reason: "Fictional private reason" } },
    { ...e, aggregate: { ...e.aggregate, id: newId() } },
    { ...e, data: { ...e.data, memberId: newId() } },
    { ...e, data: { ...e.data, category: "response" } },
  ])
    expect(() => companyEvent(value)).toThrow();
});
test("event cursor key validation fails closed", () => {
  expect(() => validateEventsConfig({ cursorKey: key })).not.toThrow();
  for (const cursorKey of ["", key.toUpperCase(), "REPLACE_KEY", "a".repeat(63)])
    expect(() => validateEventsConfig({ cursorKey })).toThrow();
});
import { readConfig } from "../../apps/api/src/platform/config/env.ts";
test("events activation is opt-in, requires identity and rejects reused independent keys", () => {
  const base = {
    MYSQL_HOST: "127.0.0.1",
    MYSQL_PORT: "3307",
    MYSQL_USER: "fixture_user",
    MYSQL_DATABASE: "fixture_database",
    MYSQL_PASSWORD: "NONFUNCTIONAL_EXAMPLE_ONLY",
  };
  expect(readConfig(base).events).toBeUndefined();
  expect(() => readConfig({ ...base, EVENTS_ENABLED: "yes" })).toThrow("EVENTS_ENABLED");
  expect(() => readConfig({ ...base, EVENTS_ENABLED: "true", EVENTS_CURSOR_KEY: key })).toThrow(
    "IDENTITY_ENABLED",
  );
  const enabled = {
    ...base,
    IDENTITY_ENABLED: "true",
    IDENTITY_SECRET: "a".repeat(64),
    IDENTITY_ORIGIN: "http://127.0.0.1:4173",
    EVENTS_ENABLED: "true",
    EVENTS_CURSOR_KEY: key,
  };
  expect(readConfig(enabled).events).toEqual({ cursorKey: key });
  expect(() => readConfig({ ...enabled, EVENTS_CURSOR_KEY: "a".repeat(64) })).toThrow(
    "EVENTS_CURSOR_KEY",
  );
});
import { readFile } from "node:fs/promises";
test("prepared Events privileges retain immutable history and install no worker mutation", async () => {
  const grants = JSON.parse(
    await readFile(
      new URL("../../deploy/development/activation-grants.json", import.meta.url),
      "utf8",
    ),
  ) as { runtime: Record<string, string[]>; jobs: Record<string, string[]> };
  for (const table of ["events", "event_responses", "event_attendances"])
    expect(grants.runtime[table]).toEqual(["SELECT", "INSERT", "UPDATE"]);
  for (const table of [
    "event_revisions",
    "event_response_revisions",
    "event_attendance_revisions",
    "event_catalog_pins",
    "event_commands",
  ])
    expect(grants.runtime[table]).toEqual(["SELECT", "INSERT"]);
  expect(Object.keys(grants.jobs).filter((t) => t === "events" || t.startsWith("event_"))).toEqual(
    [],
  );
});
