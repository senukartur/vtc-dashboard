import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  createUnitOfWork,
  dedicatedConnection,
  newId,
  runMigrations,
  TransactionCommitOutcomeUnknownError,
  type UnitOfWork,
  type TxContext,
} from "@vtc/db";
import { catalogCities, catalogCompanies, catalogCompanyCities } from "@vtc/db/catalogs-schema";
import { eq, membership } from "@vtc/db/identity-schema";
import type { components } from "@vtc/contracts";
import { browserSchemaRef } from "@vtc/contracts/runtime";
import type { Connection, RowDataPacket } from "mysql2/promise";
import { beforeEach, expect, test, afterAll as after, beforeAll as before } from "vitest";
import { createCatalogs } from "../../apps/api/src/modules/catalogs/service.ts";
import { createQueue } from "../../apps/api/src/platform/jobs/queue.ts";
import { runPass } from "../../apps/api/src/platform/jobs/runner.ts";
import { catalogConfig, seedCatalog } from "../fixtures/catalogs/synthetic.ts";
import { createApp } from "../../apps/api/src/app.ts";
import {
  createIdentity,
  type Actor,
  type Identity,
} from "../../apps/api/src/modules/identity/service.ts";
import { createEvents, type Events } from "../../apps/api/src/modules/events/service.ts";
import { createEventWorkspace } from "../../apps/api/src/modules/events/workspace.ts";
import { createSchemaValidator } from "../../apps/api/src/platform/http/schemas.ts";
import { createOutbox, identityAccessEvents } from "../../apps/api/src/platform/outbox/events.ts";
import {
  guardedSettings,
  reset,
  SCHEMA_SETUP_TIMEOUT_MS,
  testConnection,
} from "../persistence/support.ts";
import { schemaLifecycleHooks } from "../support/schema-lifecycle.ts";
import { matchEventPrescribedLoad } from "../../apps/api/src/modules/qualification-rules/index.ts";
import {
  createSyntheticTripEvidence,
  knownFact,
} from "../fixtures/qualification-rules/fixtures.ts";
import { deferred } from "../support/concurrency.ts";
const { beforeAll, afterAll } = schemaLifecycleHooks(before, after);
let control: Connection,
  unit: UnitOfWork,
  identity: Identity,
  service: Events,
  director: Actor,
  trainee: Actor,
  driver: Actor,
  deputy: Actor,
  dispatcher: Actor,
  directorCookie: string,
  traineeCookie: string;
const origin = "http://127.0.0.1:4173",
  password = "Fictional-event-passphrase-42",
  config = { cursorKey: randomBytes(32).toString("hex") };
let instant = Date.parse("2026-10-22T12:00:00.000Z");
const now = () => new Date(instant);
const input = (
  extra: Partial<components["schemas"]["EventInput"]> = {},
): components["schemas"]["EventInput"] => ({
  title: "Fictional convoy",
  description: "Fictional event description",
  game: "ets2",
  server: "Fictional simulation server",
  organizer: "Fictional company",
  route: "Fictional route",
  meetingLocation: "Fictional meeting place",
  meetingAt: "2026-10-22T12:30:00.000Z",
  startsAt: "2026-10-22T13:00:00.000Z",
  endsAt: null,
  visibility: "members",
  originCityId: null,
  destinationCityId: null,
  prescribedCargoId: null,
  prescribedMassKg: "30000",
  prescribedTrailerTypeId: null,
  ...extra,
});
async function member(roles: ("trainee" | "driver" | "deputy_director" | "dispatcher")[]) {
  const id = newId(),
    email = `${id}@example.invalid`,
    credential = await identity.prepareCredential(password);
  await unit.run((tx) =>
    identity.insertWithCredential(tx, {
      userId: id,
      email,
      name: "Fictional Event Member",
      ...credential,
      roles,
    }),
  );
  const login = await identity.login(email, password),
    cookie = login.cookies.map((c) => c.split(";", 1)[0]).join("; ");
  return { actor: await identity.authenticate(new Headers({ cookie })), cookie };
}
const create = (extra: Partial<components["schemas"]["EventInput"]> = {}) =>
  service.create(director, newId(), input(extra));
async function count(table: string) {
  const allowed = [
    "events",
    "event_revision_dlcs",
    "event_revision_details",
    "event_revisions",
    "event_responses",
    "event_response_revisions",
    "event_attendances",
    "event_attendance_revisions",
    "event_commands",
    "outbox_events",
    "audit_entries",
  ];
  if (!allowed.includes(table)) throw new Error("INVALID_FIXTURE_TABLE");
  const [rows] = await control.query<RowDataPacket[]>(`SELECT COUNT(*) n FROM ${table}`);
  return Number(rows[0]?.n);
}
beforeAll(async () => {
  control = await testConnection();
  unit = createUnitOfWork(guardedSettings());
  await reset(control);
  await runMigrations(guardedSettings());
  identity = createIdentity(
    unit,
    { secret: randomBytes(32).toString("hex"), origin, production: false },
    { accessEvents: identityAccessEvents(unit) },
    now,
  );
  await identity.bootstrap({
    email: "events-director@example.invalid",
    name: "Fictional Event Director",
    password,
  });
  const login = await identity.login("events-director@example.invalid", password);
  directorCookie = login.cookies.map((c) => c.split(";", 1)[0]).join("; ");
  director = await identity.authenticate(new Headers({ cookie: directorCookie }));
  ({ actor: trainee, cookie: traineeCookie } = await member(["trainee"]));
  driver = (await member(["driver"])).actor;
  deputy = (await member(["deputy_director"])).actor;
  dispatcher = (await member(["dispatcher"])).actor;
  service = createEvents(unit, config, { identity }, now);
}, SCHEMA_SETUP_TIMEOUT_MS);
beforeEach(async () => {
  instant = Date.parse("2026-10-22T12:00:00.000Z");
  for (const table of [
    "event_commands",
    "event_responses",
    "event_attendances",
    "event_attendance_revisions",
    "event_response_revisions",
    "event_revision_dlcs",
    "event_revision_details",
    "event_revisions",
    "events",
    "outbox_events",
    "audit_entries",
  ])
    await control.query(`DELETE FROM ${table}`);
});
afterAll(async () => {
  await unit?.close();
  await control?.end();
}, SCHEMA_SETUP_TIMEOUT_MS);
test("Director/Deputy manage, additive Driver/trainee respond, dispatcher denied, anonymous privacy", async () => {
  const e = await create(),
    id = e.data.event.id;
  await expect(service.create(dispatcher, newId(), input())).rejects.toMatchObject({
    statusCode: 403,
  });
  await expect(service.create(trainee, newId(), input())).rejects.toMatchObject({
    statusCode: 403,
  });
  await service.update(deputy, id, newId(), 1, input({ title: "Fictional edited convoy" }));
  await expect(service.get(null, id)).rejects.toMatchObject({ statusCode: 404 });
  expect((await service.list(null)).items).toEqual([]);
  await service.respond(trainee, id, newId(), 1, {
    response: "declined",
    reason: "Fictional confidential decline",
  });
  await service.respond(driver, id, newId(), 1, { response: "participating" });
  const participants = await service.participants(trainee, id);
  expect(participants.items.map((p) => p.member.id)).toEqual([driver.userId]);
  expect(JSON.stringify(participants)).not.toContain("decline");
  const own = await service.myResponse(trainee, id);
  expect(own.data.declineReason).toBe("Fictional confidential decline");
  const attendance = await service.attendance(deputy, id);
  expect(
    attendance.data.items.find((a) => a.member.id === trainee.userId)?.response.declineReason,
  ).toContain("confidential");
  await expect(service.attendance(dispatcher, id)).rejects.toMatchObject({ statusCode: 403 });
  expect((await service.nearest(trainee))?.id).toBe(id);
});
test("independent event/own response/attendance versions and equivalent responses have no effects", async () => {
  const e = await create(),
    id = e.data.event.id;
  const first = await service.respond(trainee, id, newId(), 1, { response: "participating" });
  expect(first.version).toBe(2);
  expect((await service.get(director, id)).version).toBe(1);
  expect((await service.myResponse(driver, id)).version).toBe(1);
  expect((await service.attendance(director, id)).version).toBe(1);
  const counts = await Promise.all(["event_response_revisions", "outbox_events"].map(count));
  await service.respond(trainee, id, newId(), 2, { response: "participating" });
  expect(await Promise.all(["event_response_revisions", "outbox_events"].map(count))).toEqual(
    counts,
  );
  await expect(
    service.respond(trainee, id, newId(), 1, { response: "unanswered" }),
  ).rejects.toMatchObject({ statusCode: 412 });
});
test("revised start cutoff uses locked current time at equality; reschedule preserves RSVP and reopens it", async () => {
  const e = await create(),
    id = e.data.event.id;
  instant = Date.parse("2026-10-22T12:59:59.999Z");
  await service.respond(trainee, id, newId(), 1, { response: "participating" });
  instant++;
  await expect(
    service.respond(trainee, id, newId(), 2, { response: "unanswered" }),
  ).rejects.toMatchObject({ statusCode: 409 });
  const changed = await service.update(
    deputy,
    id,
    newId(),
    1,
    input({ startsAt: "2026-10-22T14:00:00.000Z" }),
  );
  expect(changed.data.myResponse.response).toBe("unanswered");
  expect((await service.myResponse(trainee, id)).data.response).toBe("participating");
  await service.respond(trainee, id, newId(), 2, {
    response: "declined",
    reason: "Fictional changed availability",
  });
  await service.cancel(director, id, newId(), 2, "Fictional cancellation note");
  await expect(
    service.respond(driver, id, newId(), 1, { response: "participating" }),
  ).rejects.toMatchObject({ statusCode: 409 });
  expect(await service.nearest(trainee)).toBeNull();
});
test("durable idempotency replays original revisions, conflicts input and still checks current authority", async () => {
  const key = newId(),
    e = await service.create(director, key, input()),
    id = e.data.event.id;
  expect((await service.create(director, key, input())).data).toEqual(e.data);
  await service.update(director, id, newId(), 1, input({ title: "Fictional newer title" }));
  expect((await service.create(director, key, input())).data.event.title).toBe(input().title);
  await expect(
    service.create(director, key, input({ title: "Fictional conflicting title" })),
  ).rejects.toMatchObject({ statusCode: 409, publicCode: "IDEMPOTENCY_CONFLICT" });
  const rkey = newId();
  await service.respond(trainee, id, rkey, 1, { response: "participating" });
  await service.respond(trainee, id, newId(), 2, {
    response: "declined",
    reason: "Fictional reason",
  });
  expect(
    (await service.respond(trainee, id, rkey, 1, { response: "participating" })).data.response,
  ).toBe("participating");
  await unit.run((tx) =>
    unit
      .client(tx)
      .update(membership)
      .set({ accessEpoch: 2 })
      .where(eq(membership.userId, trainee.userId)),
  );
  try {
    await expect(
      service.respond(trainee, id, rkey, 1, { response: "participating" }),
    ).rejects.toMatchObject({ statusCode: 401 });
  } finally {
    await unit.run((tx) =>
      unit
        .client(tx)
        .update(membership)
        .set({ accessEpoch: 1 })
        .where(eq(membership.userId, trainee.userId)),
    );
  }
});
test("concurrent identical/conflicting command keys and competing initial responses serialize exactly once", async () => {
  const key = newId();
  const results = await Promise.all([
    service.create(director, key, input()),
    service.create(director, key, input()),
  ]);
  expect(results[0]).toEqual(results[1]);
  expect(await count("events")).toBe(1);
  const id = results[0]?.data.event.id as string,
    rkey = newId();
  const repeated = await Promise.all([
    service.respond(trainee, id, rkey, 1, { response: "participating" }),
    service.respond(trainee, id, rkey, 1, { response: "participating" }),
  ]);
  expect(repeated[0]).toEqual(repeated[1]);
  expect(await count("event_response_revisions")).toBe(1);
  const competing = await Promise.allSettled([
    service.respond(driver, id, newId(), 1, { response: "participating" }),
    service.respond(driver, id, newId(), 1, { response: "declined", reason: "Fictional reason" }),
  ]);
  expect(competing.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(competing.filter((r) => r.status === "rejected")).toHaveLength(1);
  const conflict = await Promise.allSettled([
    service.update(director, id, key, 1, input({ title: "Fictional A" })),
    service.update(director, id, key, 1, input({ title: "Fictional B" })),
  ]);
  expect(conflict.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(conflict.find((r) => r.status === "rejected")).toMatchObject({
    reason: { publicCode: "IDEMPOTENCY_CONFLICT" },
  });
});
test("attendance opens at actual revised start, is atomic/versioned/private and only attended yields confirmed exception seam", async () => {
  const e = await create(),
    id = e.data.event.id;
  await service.respond(trainee, id, newId(), 1, { response: "participating" });
  expect(
    (
      await unit.run((tx) =>
        service.associateInTransaction(tx, trainee, {
          eventId: id,
          memberId: trainee.userId,
          game: "ets2",
        }),
      )
    ).confirmedEvent,
  ).toBeNull();
  await expect(
    service.setAttendance(director, id, newId(), 1, {
      members: [{ memberId: trainee.userId, attendance: "attended", note: null }],
    }),
  ).rejects.toMatchObject({ statusCode: 409 });
  instant = Date.parse(input().startsAt);
  await service.setAttendance(deputy, id, newId(), 1, {
    members: [
      { memberId: trainee.userId, attendance: "attended", note: "Fictional private staff note" },
      { memberId: driver.userId, attendance: "not_attended", note: null },
    ],
  });
  expect((await service.attendance(director, id)).version).toBe(2);
  expect((await service.myResponse(trainee, id)).version).toBe(2);
  const linked = await unit.run((tx) =>
    service.associateInTransaction(tx, trainee, {
      eventId: id,
      memberId: trainee.userId,
      game: "ets2",
    }),
  );
  expect(
    (
      await unit.run((tx) =>
        service.associateInTransaction(tx, dispatcher, {
          eventId: id,
          memberId: trainee.userId,
          game: "ets2",
        }),
      )
    ).confirmedEvent,
  ).toEqual(linked.confirmedEvent);
  expect(linked.confirmedEvent).toMatchObject({
    attendanceStatus: "confirmed",
    prescribedMassKg: "30000",
  });
  expect(
    matchEventPrescribedLoad(createSyntheticTripEvidence({ cargoMassKg: knownFact("30000") }), {
      confirmedEvent: linked.confirmedEvent,
    }).matches,
  ).toBe(true);
  expect(
    matchEventPrescribedLoad(createSyntheticTripEvidence({ cargoMassKg: knownFact("29999") }), {
      confirmedEvent: linked.confirmedEvent,
    }).matches,
  ).toBe(false);
  expect(
    (
      await unit.run((tx) =>
        service.associateInTransaction(tx, driver, {
          eventId: id,
          memberId: driver.userId,
          game: "ets2",
        }),
      )
    ).attendanceStatus,
  ).toBe("declined");
  await expect(
    unit.run((tx) =>
      service.associateInTransaction(tx, trainee, {
        eventId: id,
        memberId: trainee.userId,
        game: "ats",
      }),
    ),
  ).rejects.toMatchObject({ statusCode: 409 });
  await expect(
    unit.run((tx) =>
      service.associateInTransaction(tx, driver, {
        eventId: id,
        memberId: trainee.userId,
        game: "ets2",
      }),
    ),
  ).rejects.toMatchObject({ statusCode: 404 });
  await expect(
    service.setAttendance(director, id, newId(), 1, {
      members: [{ memberId: driver.userId, attendance: "attended", note: null }],
    }),
  ).rejects.toMatchObject({ statusCode: 412 });
  await service.cancel(director, id, newId(), 1, "Fictional cancellation");
  await expect(
    unit.run((tx) =>
      service.associateInTransaction(tx, trainee, {
        eventId: id,
        memberId: trainee.userId,
        game: "ets2",
        eventRevisionId: linked.eventRevisionId,
        attendanceRevisionId: linked.attendanceRevisionId as string,
      }),
    ),
  ).rejects.toMatchObject({ statusCode: 409 });
  expect(await count("event_attendance_revisions")).toBe(2);
  const history = await service.history(deputy, id);
  expect(history.definitions.at(-1)?.privateReason).toBe("Fictional cancellation");
  expect(history.attendance.find((a) => a.memberId === trainee.userId)?.note).toBe(
    "Fictional private staff note",
  );
  await expect(service.history(dispatcher, id)).rejects.toMatchObject({ statusCode: 403 });
});
test("history paginates complete unequal attendance batches without losing revisions or crossing events", async () => {
  const id = (await create()).data.event.id;
  await service.update(director, id, newId(), 1, input({ title: "Fictional revision two" }));
  await service.respond(trainee, id, newId(), 1, { response: "participating" });
  await service.update(director, id, newId(), 2, input({ title: "Fictional revision three" }));
  await service.respond(driver, id, newId(), 1, {
    response: "declined",
    reason: "Fictional private history reason",
  });
  instant = Date.parse(input().startsAt);
  const members = [director, deputy, trainee, driver, dispatcher].map((a) => a.userId),
    sizes = Array.from({ length: 60 }, (_, i) => [5, 4, 3, 2][i % 4] as number);
  // Bulk immutable read fixtures keep command atomicity coverage in its separate cases.
  const expected = await unit.run(async (tx) => {
    const client = unit.client(tx),
      [event] = await client.select().from(events).where(eq(events.id, id));
    if (!event?.currentRevisionId) throw new Error("SYNTHETIC_EVENT_MISSING");
    const revisions = sizes.flatMap((size, i) =>
      members.slice(0, size).map((memberId) => ({
        id: newId(),
        eventId: id,
        eventRevisionId: event.currentRevisionId as string,
        memberId,
        version: i + 2,
        sequence: event.changeSequence + i + 1,
        actorId: director.userId,
        recordedAt: now().toISOString(),
        status: "attended" as const,
        note: `Fictional private batch ${i + 1}`,
      })),
    );
    expect(revisions).toHaveLength(210);
    expect(revisions[199]?.sequence).toBe(revisions[200]?.sequence);
    await client.insert(eventAttendanceRevisions).values(revisions);
    await client.insert(eventAttendances).values(
      members.map((memberId) => {
        const last = revisions.findLast((r) => r.memberId === memberId);
        if (!last) throw new Error("SYNTHETIC_ATTENDANCE_MISSING");
        return { eventId: id, memberId, currentRevisionId: last.id };
      }),
    );
    await client
      .update(events)
      .set({
        attendanceVersion: sizes.length + 1,
        changeSequence: event.changeSequence + sizes.length,
      })
      .where(eq(events.id, id));
    return {
      definitions: await client
        .select({ id: eventRevisions.id, sequence: eventRevisions.sequence })
        .from(eventRevisions)
        .where(eq(eventRevisions.eventId, id))
        .orderBy(asc(eventRevisions.sequence), asc(eventRevisions.id)),
      responses: await client
        .select({ id: eventResponseRevisions.id, sequence: eventResponseRevisions.sequence })
        .from(eventResponseRevisions)
        .where(eq(eventResponseRevisions.eventId, id))
        .orderBy(asc(eventResponseRevisions.sequence), asc(eventResponseRevisions.id)),
      attendance: await client
        .select({ id: eventAttendanceRevisions.id, sequence: eventAttendanceRevisions.sequence })
        .from(eventAttendanceRevisions)
        .where(eq(eventAttendanceRevisions.eventId, id))
        .orderBy(asc(eventAttendanceRevisions.sequence), asc(eventAttendanceRevisions.id)),
    };
  });
  const other = (await create()).data.event.id;
  await service.setAttendance(director, other, newId(), 1, {
    members: [{ memberId: trainee.userId, attendance: "not_attended", note: "Other event" }],
  });
  await expect(service.history(trainee, id, 0, 1)).rejects.toMatchObject({ statusCode: 403 });
  for (const limit of [1, 7]) {
    for (const stream of ["definitions", "responses", "attendance"] as const) {
      const seen: string[] = [];
      let afterSequence = 0,
        pages = 0;
      for (;;) {
        const page = await service.history(deputy, id, afterSequence, limit),
          rows = page[stream],
          sequences = [...new Set(rows.map((r) => r.sequence))];
        expect(++pages).toBeLessThanOrEqual(expected[stream].length + 1);
        expect(sequences.length).toBeLessThanOrEqual(limit);
        expect(rows.length).toBeLessThanOrEqual(stream === "attendance" ? 100 * limit : limit);
        expect(rows.every((r) => r.eventId === id && r.sequence > afterSequence)).toBe(true);
        for (const sequence of sequences)
          expect(rows.filter((r) => r.sequence === sequence).map((r) => r.id)).toEqual(
            expected[stream].filter((r) => r.sequence === sequence).map((r) => r.id),
          );
        seen.push(...rows.map((r) => r.id));
        const next = page.nextAfterSequence[stream];
        if (next === null) break;
        expect(next).toBe(rows.at(-1)?.sequence);
        expect(next).toBeGreaterThan(afterSequence);
        afterSequence = next;
      }
      expect(seen).toEqual(expected[stream].map((r) => r.id));
      expect(new Set(seen).size).toBe(seen.length);
    }
  }
  const end = await service.history(deputy, id, expected.attendance.at(-1)?.sequence, 1);
  expect(end).toEqual({
    definitions: [],
    responses: [],
    attendance: [],
    nextAfterSequence: { definitions: null, responses: null, attendance: null },
  });
});
test("history/audit/outbox and batch changes roll back together after injected effect failure", async () => {
  const e = await create(),
    id = e.data.event.id;
  instant = Date.parse(input().startsAt);
  const outbox = createOutbox(unit),
    broken = createEvents(
      unit,
      config,
      {
        identity,
        outbox: {
          async append(tx, event) {
            await outbox.append(tx, event);
            throw new Error("SYNTHETIC_AFTER_OUTBOX");
          },
        },
      },
      now,
    );
  const before = await Promise.all(
    [
      "event_revisions",
      "event_attendance_revisions",
      "event_commands",
      "outbox_events",
      "audit_entries",
    ].map(count),
  );
  await expect(
    broken.update(director, id, newId(), 1, input({ title: "Fictional rollback" })),
  ).rejects.toThrow("SYNTHETIC_AFTER_OUTBOX");
  await expect(
    broken.setAttendance(director, id, newId(), 1, {
      members: [
        { memberId: trainee.userId, attendance: "attended", note: null },
        { memberId: driver.userId, attendance: "attended", note: null },
      ],
    }),
  ).rejects.toThrow("SYNTHETIC_AFTER_OUTBOX");
  expect(
    await Promise.all(
      [
        "event_revisions",
        "event_attendance_revisions",
        "event_commands",
        "outbox_events",
        "audit_entries",
      ].map(count),
    ),
  ).toEqual(before);
  expect((await service.attendance(director, id)).version).toBe(1);
});
test("lock-time cutoff rechecked after a concurrent definition lock; no stale pre-lock clock decision", async () => {
  const e = await create(),
    id = e.data.event.id,
    locked = deferred<void>(),
    release = deferred<void>();
  const blocker = unit.run(async (tx) => {
    await identity.eventContextInTransaction(tx, director);
    locked.resolve();
    await release.promise;
  });
  await locked.promise;
  const pending = service.respond(trainee, id, newId(), 1, { response: "participating" });
  instant = Date.parse(input().startsAt);
  release.resolve();
  await blocker;
  await expect(pending).rejects.toMatchObject({ statusCode: 409 });
  expect(await count("event_response_revisions")).toBe(0);
});
test("query ties, fixed boundaries, cross-scope cursors and public serializers remain safe", async () => {
  const a = await create({ visibility: "public" }),
    b = await create({ visibility: "public" });
  const all = await service.list(null, { limit: 1 });
  expect(all.items).toHaveLength(1);
  expect(all.nextCursor).toBeTruthy();
  instant = Date.parse("2026-10-22T14:00:00.000Z");
  const next = await service.list(null, { limit: 1, cursor: all.nextCursor as string });
  expect(new Set([...all.items, ...next.items].map((e) => e.id))).toEqual(
    new Set([a.data.event.id, b.data.event.id]),
  );
  await expect(service.list(trainee, { cursor: all.nextCursor as string })).rejects.toMatchObject({
    statusCode: 409,
  });
  await expect(
    service.list(null, { period: "past", cursor: all.nextCursor as string }),
  ).rejects.toMatchObject({ statusCode: 409 });
  expect(Object.keys((await service.get(null, a.data.event.id)).data)).not.toContain("myResponse");
  const [plan] = await control.query<RowDataPacket[]>(
    "EXPLAIN SELECT id FROM events WHERE visibility=? AND starts_at>=? ORDER BY starts_at,id LIMIT 26",
    ["public", "2026-10-22 12:00:00.000"],
  );
  expect(plan.length).toBeGreaterThan(0);
});
test("workspace counts current unanswered scheduled events before its stable five-row preview", async () => {
  const computedAt = now().toISOString();
  const firstStart = {
    meetingAt: "2026-10-22T11:30:00.000Z",
    startsAt: "2026-10-22T12:00:00.001Z",
  };
  const first = await create({ ...firstStart, title: "Fictional original title" });
  const currentTitle = "Fictional revised title";
  const renamed = await service.update(
    director,
    first.data.event.id,
    newId(),
    first.version,
    input({ ...firstStart, title: currentTitle }),
  );
  const nextStart = { ...firstStart, startsAt: "2026-10-22T12:30:00.000Z" };
  const cleared = await create({ ...nextStart, visibility: "public" });
  const answeredByAnother = await create(nextStart);
  const tied = [await create(), await create(), await create()];
  const participating = await create();
  const declined = await create();
  const cancelled = await create();
  await create({ ...firstStart, startsAt: computedAt });
  await create({ ...firstStart, startsAt: "2026-10-22T11:59:59.999Z" });

  const ownDecline = await service.respond(trainee, cleared.data.event.id, newId(), 1, {
    response: "declined",
    reason: "Fictional private cleared reason",
  });
  await service.respond(trainee, cleared.data.event.id, newId(), ownDecline.version, {
    response: "unanswered",
  });
  await service.respond(driver, answeredByAnother.data.event.id, newId(), 1, {
    response: "declined",
    reason: "Fictional private reason from another member",
  });
  await service.respond(trainee, participating.data.event.id, newId(), 1, {
    response: "participating",
  });
  await service.respond(trainee, declined.data.event.id, newId(), 1, {
    response: "declined",
    reason: "Fictional private reason",
  });
  await service.cancel(director, cancelled.data.event.id, newId(), 1, "Fictional cancellation");

  const workspace = createEventWorkspace(unit);
  const read = (at: string) =>
    unit.run((tx) => workspace.workspaceUnansweredEventsInTransaction(tx, trainee.userId, at));
  const eligible = [renamed, cleared, answeredByAnother, ...tied]
    .map(({ data: { event } }) => ({
      eventId: event.id,
      title: event.title,
      startsAt: event.startsAt,
    }))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.eventId.localeCompare(b.eventId));
  const result = await read(computedAt);
  expect(result).toEqual({ count: 6, items: eligible.slice(0, 5) });
  expect(result.items[0]?.title).toBe(currentTitle);
  expect(await read(input().startsAt)).toEqual({ count: 0, items: [] });

  // As in the ordinary Events list, a missing selected definition fails the read.
  await control.execute("UPDATE events SET current_revision_id=NULL WHERE id=?", [
    first.data.event.id,
  ]);
  await expect(read(computedAt)).rejects.toThrow("EVENT_REVISION_MISSING");
});

test("workspace count and preview retain the caller snapshot across another connection's RSVP", async () => {
  const {
    data: { event },
  } = await create();
  const workspace = createEventWorkspace(unit);
  const computedAt = now().toISOString();
  const read = (tx: TxContext) =>
    workspace.workspaceUnansweredEventsInTransaction(tx, trainee.userId, computedAt);
  const unanswered = {
    count: 1,
    items: [{ eventId: event.id, title: event.title, startsAt: event.startsAt }],
  };
  await unit.run(async (tx) => {
    expect(await read(tx)).toEqual(unanswered);
    await service.respond(trainee, event.id, newId(), 1, { response: "participating" });
    expect(await read(tx)).toEqual(unanswered);
  });
  expect(await unit.run(read)).toEqual({ count: 0, items: [] });
});

test("validation rejects blank reasons, invalid UTC/calendar/decimal and unavailable catalog identities", async () => {
  const e = await create(),
    id = e.data.event.id;
  await expect(
    service.respond(trainee, id, newId(), 1, { response: "declined", reason: "   " }),
  ).rejects.toMatchObject({ statusCode: 422 });
  for (const bad of [
    input({ startsAt: "2026-02-30T13:00:00.000Z" }),
    input({ meetingAt: "2026-10-22T14:00:00.000Z" }),
    input({ prescribedMassKg: "1.0000000000000000001" }),
    input({ prescribedMassKg: "-1" }),
  ])
    await expect(service.create(director, newId(), bad)).rejects.toMatchObject({ statusCode: 422 });
  await expect(create({ originCityId: newId() })).rejects.toMatchObject({ statusCode: 503 });
  const denied = createEvents(
    unit,
    config,
    {
      identity,
      catalogs: {
        selectionsInTransaction: async () => new Map(),
        labelsInTransaction: async () => new Map(),
      },
    },
    now,
  );
  await expect(
    denied.create(director, newId(), input({ originCityId: newId() })),
  ).rejects.toMatchObject({ statusCode: 422 });
});
const eventsStage2Header = "x-vtc-events-stage2";
const eventWireValidator = createSchemaValidator();

test("HTTP actual composition enforces auth, CSRF, strong separate ETags and closed responses", async () => {
  // All tests share one fixed clock window; start this request budget from zero.
  await control.query("DELETE FROM identity_limits");
  const app = await createApp({ identity, events: service, checkReadiness: async () => true });
  try {
    expect((await app.inject({ url: "/api/v1/events" })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/admin/events",
          headers: { cookie: directorCookie, "idempotency-key": newId() },
          payload: input(),
        })
      ).statusCode,
    ).toBe(403);
    const csrf = (
      await app.inject({ url: "/api/v1/auth/csrf", headers: { cookie: directorCookie } })
    ).json().data.token;
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/admin/events",
      headers: { cookie: directorCookie, origin, "x-csrf-token": csrf, "idempotency-key": newId() },
      payload: input({ visibility: "public" }),
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().data.event.id;

    // Stage 2 additions are documented for downstream work but this app still
    // serves the old request and response contracts.
    const stagedEndpoints = [
      ["GET", "/api/v1/admin/events?period=drafts"],
      ["GET", `/api/v1/admin/events/drafts/${id}`],
      ["PATCH", `/api/v1/admin/events/drafts/${id}`],
      ["DELETE", `/api/v1/admin/events/${id}`],
      ["POST", `/api/v1/admin/events/${id}/publication`],
      ["GET", `/api/v1/admin/events/${id}/nonresponders`],
      ["GET", `/api/v1/admin/events/${id}/media`],
      ["POST", `/api/v1/admin/events/${id}/media`],
      ["PATCH", `/api/v1/admin/events/${id}/media/${id}`],
      ["DELETE", `/api/v1/admin/events/${id}/media/${id}`],
      ["GET", `/api/v1/events/${id}/media`],
      ["GET", `/api/v1/events/${id}/media/${id}/content?size=thumb`],
      ["GET", `/api/v1/public/events/${id}/cover`],
    ] as const;
    for (const [method, url] of stagedEndpoints) {
      expect(
        (await app.inject({ method, url, headers: { cookie: directorCookie } })).statusCode,
      ).toBe(404);
    }
    const stagedDraft = await app.inject({
      method: "POST",
      url: "/api/v1/admin/events",
      headers: { cookie: directorCookie, origin, "x-csrf-token": csrf, "idempotency-key": newId() },
      payload: { draft: true, title: "Fictional draft" },
    });
    expect(stagedDraft.statusCode).toBe(422);
    const [draftRows] = await control.query<RowDataPacket[]>("SELECT id FROM event_metadata");
    expect(draftRows).toEqual([]);
    const pub = await app.inject({ url: `/api/v1/public/events/${id}` });
    expect(pub.statusCode).toBe(200);
    expect(pub.json().data).not.toHaveProperty("myResponse");
    for (const locale of ["en", "ru"]) {
      const localized = await app.inject({ url: `/api/v1/public/events/${id}?locale=${locale}` });
      expect(localized.statusCode).toBe(200);
      expect(
        eventWireValidator.validate(browserSchemaRef("EnvelopeEventPublic"), localized.json()),
      ).toBe(true);
      expect(localized.json().data).toEqual(pub.json().data);
    }
    expect((await app.inject({ url: `/api/v1/public/events/${id}?locale=fr` })).statusCode).toBe(
      422,
    );
    const self = await app.inject({ url: "/api/v1/me", headers: { cookie: traineeCookie } });
    expect(self.statusCode).toBe(200);
    expect(eventWireValidator.validate(browserSchemaRef("EnvelopeSelf"), self.json())).toBe(true);
    expect(self.headers[eventsStage2Header]).toBeUndefined();
    const own = await app.inject({
      url: `/api/v1/events/${id}/my-response`,
      headers: { cookie: traineeCookie },
    });
    expect(own.headers.etag).toBe('"v1"');
    const tcsrf = (
      await app.inject({ url: "/api/v1/auth/csrf", headers: { cookie: traineeCookie } })
    ).json().data.token;
    const response = await app.inject({
      method: "PUT",
      url: `/api/v1/events/${id}/my-response`,
      headers: {
        cookie: traineeCookie,
        origin,
        "x-csrf-token": tcsrf,
        "idempotency-key": newId(),
        "if-match": '"v1"',
      },
      payload: { response: "participating" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"v2"');
    const evt = await app.inject({
      url: `/api/v1/events/${id}`,
      headers: { cookie: traineeCookie },
    });
    expect(evt.headers.etag).toBe('"v1"');
    await service.respond(driver, id, newId(), 1, {
      response: "declined",
      reason: "Fictional HTTP decliner reason",
    });
    for (const path of ["decliners", "response-counts"]) {
      expect((await app.inject({ url: `/api/v1/events/${id}/${path}` })).statusCode).toBe(401);
      expect((await app.inject({ url: `/api/v1/public/events/${id}/${path}` })).statusCode).toBe(
        404,
      );
    }
    const decliners = await app.inject({
      url: `/api/v1/events/${id}/decliners`,
      headers: { cookie: traineeCookie },
    });
    expect(decliners.statusCode).toBe(200);
    expect(decliners.headers.etag).toBeUndefined();
    expect(decliners.json().data).toEqual({
      items: [{ member: expect.objectContaining({ id: driver.userId }) }],
      nextCursor: null,
    });
    const counts = await app.inject({
      url: `/api/v1/events/${id}/response-counts`,
      headers: { cookie: traineeCookie },
    });
    expect(counts.statusCode).toBe(200);
    expect(counts.headers.etag).toBeUndefined();
    expect(counts.json().data).toEqual({ participating: 1, declined: 1 });
    for (const body of [decliners.body, counts.body]) {
      expect(body).not.toContain("Fictional HTTP decliner reason");
      expect(body).not.toContain("declineReason");
    }
    expect(
      (
        await app.inject({
          url: `/api/v1/events/${id}/response-counts?unanswered=1`,
          headers: { cookie: traineeCookie },
        })
      ).statusCode,
    ).toBe(422);
  } finally {
    await app.close();
  }
});

test("safe ordered recipient seam reconstructs participating membership at immutable definition changes", async () => {
  const e = await create(),
    id = e.data.event.id;
  await service.respond(trainee, id, newId(), 1, { response: "participating" });
  await service.respond(driver, id, newId(), 1, { response: "participating" });
  const changed = await service.update(
    director,
    id,
    newId(),
    1,
    input({ title: "Fictional changed event" }),
  );
  const [definition] = await control.query<RowDataPacket[]>(
    "SELECT CAST(id AS CHAR) id FROM event_revisions WHERE event_id=? AND version=2",
    [id],
  );
  await service.respond(trainee, id, newId(), 2, {
    response: "declined",
    reason: "Fictional later decline",
  });
  const r = await unit.run(async (tx) => {
    const d = await service.definitionInTransaction(tx, String(definition[0]?.id));
    return service.recipientsInTransaction(tx, id, d.changeSequence);
  });
  expect(new Set(r)).toEqual(new Set([trainee.userId, driver.userId]));
  expect(changed.version).toBe(2);
  expect(await unit.run((tx) => service.generationInTransaction(tx, id))).toMatchObject({
    eventId: id,
    version: 2,
    status: "scheduled",
    visibility: "members",
  });
  const first = await unit.run((tx) => service.recipientsInTransaction(tx, id, 4, null, 1));
  expect(first).toHaveLength(1);
  expect(
    await unit.run((tx) => service.recipientsInTransaction(tx, id, 4, first[0] as string, 1)),
  ).toHaveLength(1);
  const [safe] = await control.query<RowDataPacket[]>(
    "SELECT CAST(data AS CHAR) payload FROM outbox_events WHERE type LIKE 'event.%'",
  );
  expect(safe.every((r) => !String(r.payload).includes("Fictional"))).toBe(true);
});
test("transient callback failure explicitly rolls back and retries; uncertain commit is surfaced once and manual replay reads durable receipt", async () => {
  const outbox = createOutbox(unit);
  let effects = 0;
  const transient = createEvents(
    unit,
    config,
    {
      identity,
      outbox: {
        async append(tx, event) {
          await outbox.append(tx, event);
          if (++effects === 1)
            throw Object.assign(new Error("SYNTHETIC_LOCK_WAIT"), { code: "ER_LOCK_WAIT_TIMEOUT" });
        },
      },
    },
    now,
  );
  const e = await transient.create(director, newId(), input());
  expect(e.version).toBe(1);
  expect(effects).toBe(2);
  expect(await count("events")).toBe(1);
  expect(await count("event_revisions")).toBe(1);
  expect(await count("outbox_events")).toBe(1);
  let executions = 0;
  const uncertain: UnitOfWork = {
    ...unit,
    async run(command) {
      executions++;
      await unit.run(command);
      throw new TransactionCommitOutcomeUnknownError(new Error("SYNTHETIC_COMMITTED_RECEIPT_LOSS"));
    },
  };
  const unknown = createEvents(uncertain, config, { identity }, now),
    key = newId();
  await expect(unknown.create(director, key, input())).rejects.toBeInstanceOf(
    TransactionCommitOutcomeUnknownError,
  );
  expect(executions).toBe(1);
  const replay = await service.create(director, key, input());
  expect(replay.version).toBe(1);
  expect(await count("events")).toBe(2);
});
test("server IDs stay independent of actor-scoped keys and historic confirmations cannot authorize a new exception", async () => {
  const key = newId(),
    a = await service.create(director, key, input()),
    b = await service.create(deputy, key, input());
  expect(a.data.event.id).not.toBe(key);
  expect(a.data.event.id).not.toBe(b.data.event.id);
  const id = a.data.event.id;
  instant = Date.parse(input().startsAt);
  await service.setAttendance(director, id, newId(), 1, {
    members: [{ memberId: trainee.userId, attendance: "attended", note: null }],
  });
  const linked = await unit.run((tx) =>
    service.associateInTransaction(tx, trainee, {
      eventId: id,
      memberId: trainee.userId,
      game: "ets2",
    }),
  );
  await service.setAttendance(director, id, newId(), 2, {
    members: [{ memberId: trainee.userId, attendance: "not_attended", note: null }],
  });
  const old = await unit.run((tx) =>
    service.associateInTransaction(tx, trainee, {
      eventId: id,
      memberId: trainee.userId,
      game: "ets2",
      eventRevisionId: linked.eventRevisionId,
      attendanceRevisionId: linked.attendanceRevisionId as string,
    }),
  );
  expect(old.reviewRequired).toBe(true);
  expect(old.confirmedEvent).toBeNull();
  await expect(control.query("DELETE FROM events WHERE id=?", [id])).rejects.toMatchObject({
    code: "ER_ROW_IS_REFERENCED_2",
  });
});
test("event selections use same-game rows, labels follow renames and hidden rows stay only when unchanged", async () => {
  const catalogs = createCatalogs(unit, catalogConfig(), { identity });
  const rows = await seedCatalog(unit, "ets2", {
    cities: [
      { code: "event_city", nameEn: "Fictional original city" },
      { code: "event_hidden_city", hidden: true },
    ],
    cargoes: ["event_cargo"],
    trailers: ["event_trailer"],
  });
  const city = rows.id("event_city"),
    cargo = rows.id("event_cargo"),
    trailer = rows.id("event_trailer"),
    hidden = rows.id("event_hidden_city");
  const integrated = createEvents(unit, config, { identity, catalogs }, now);
  const created = await integrated.create(
    director,
    newId(),
    input({ originCityId: city, prescribedCargoId: cargo, prescribedTrailerTypeId: trailer }),
  );
  expect(created.data.event.origin?.label).toBe("Fictional original city");
  await unit.run((tx) =>
    unit
      .client(tx)
      .update(catalogCities)
      .set({ nameEn: "Fictional later city" })
      .where(eq(catalogCities.id, city)),
  );
  expect((await integrated.get(trainee, created.data.event.id)).data).toMatchObject({
    event: { origin: { label: "Fictional later city" } },
  });
  await expect(
    integrated.create(director, newId(), input({ game: "ats", originCityId: city })),
  ).rejects.toMatchObject({ statusCode: 422 });
  await expect(
    integrated.create(director, newId(), input({ originCityId: cargo })),
  ).rejects.toMatchObject({ statusCode: 422 });
  await expect(
    integrated.create(director, newId(), input({ originCityId: hidden })),
  ).rejects.toMatchObject({ statusCode: 422, publicCode: "CATALOG_SELECTION_HIDDEN" });
  await unit.run((tx) =>
    unit.client(tx).update(catalogCities).set({ hidden: true }).where(eq(catalogCities.id, city)),
  );
  await expect(
    integrated.update(director, created.data.event.id, newId(), 1, {
      ...input({
        title: "Fictional unchanged origin",
        originCityId: city,
        prescribedCargoId: cargo,
      }),
      prescribedTrailerTypeId: trailer,
    }),
  ).resolves.toBeDefined();
  await expect(
    integrated.update(director, created.data.event.id, newId(), 2, {
      ...input({ title: "Fictional hidden origin", originCityId: hidden }),
    }),
  ).rejects.toMatchObject({ publicCode: "CATALOG_SELECTION_HIDDEN" });
});
// Concurrent commands share the current definition lock and must observe a serial outcome.
test("RSVP versus cancellation/rescheduling and competing attendance batches preserve one serial history", async () => {
  const e = await create(),
    id = e.data.event.id;
  const race = await Promise.allSettled([
    service.cancel(director, id, newId(), 1, "Fictional concurrent cancellation"),
    service.respond(trainee, id, newId(), 1, { response: "participating" }),
  ]);
  expect(race[0]?.status).toBe("fulfilled");
  const own = await service.myResponse(trainee, id);
  expect(["unanswered", "participating"]).toContain(own.data.response);
  expect((await service.get(trainee, id)).data).toMatchObject({ event: { status: "cancelled" } });
  expect(await count("event_response_revisions")).toBe(
    own.data.response === "participating" ? 1 : 0,
  );
  const second = await create(),
    sid = second.data.event.id;
  instant = Date.parse(input().startsAt);
  const revised = await Promise.allSettled([
    service.update(director, sid, newId(), 1, input({ startsAt: "2026-10-22T14:00:00.000Z" })),
    service.respond(driver, sid, newId(), 1, { response: "participating" }),
  ]);
  expect(revised[0]?.status).toBe("fulfilled");
  const response = await service.myResponse(driver, sid);
  if (revised[1]?.status === "fulfilled") expect(response.data.response).toBe("participating");
  else expect(response.data.response).toBe("unanswered");
  instant = Date.parse("2026-10-22T14:00:00.000Z");
  const attendance = await Promise.allSettled([
    service.setAttendance(director, sid, newId(), 1, {
      members: [{ memberId: driver.userId, attendance: "attended", note: null }],
    }),
    service.setAttendance(deputy, sid, newId(), 1, {
      members: [{ memberId: driver.userId, attendance: "not_attended", note: null }],
    }),
  ]);
  expect(attendance.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(attendance.find((r) => r.status === "rejected")).toMatchObject({
    reason: { statusCode: 412 },
  });
  expect((await service.attendance(director, sid)).version).toBe(2);
});
test("current role and session revocation precede both saved-command replay and private history reads", async () => {
  const own = await member(["trainee"]),
    staff = await member(["deputy_director"]),
    e = await create(),
    id = e.data.event.id,
    key = newId();
  await service.respond(own.actor, id, key, 1, { response: "participating" });
  const createKey = newId();
  await service.create(staff.actor, createKey, input());
  await identity.administer(director, own.actor.userId, newId(), 1, {
    kind: "roles",
    roles: ["dispatcher"],
  });
  await expect(
    service.respond(own.actor, id, key, 1, { response: "participating" }),
  ).rejects.toMatchObject({ statusCode: 401 });
  await identity.administer(director, staff.actor.userId, newId(), 1, {
    kind: "roles",
    roles: ["dispatcher"],
  });
  await expect(service.create(staff.actor, createKey, input())).rejects.toMatchObject({
    statusCode: 401,
  });
  const login = await identity.login(`${staff.actor.userId}@example.invalid`, password),
    cookie = login.cookies.map((c) => c.split(";", 1)[0]).join("; "),
    current = await identity.authenticate(new Headers({ cookie }));
  await expect(service.create(current, createKey, input())).rejects.toMatchObject({
    statusCode: 403,
  });
  await expect(service.history(current, id)).rejects.toMatchObject({ statusCode: 403 });
});
import {
  asc,
  events,
  eventRevisions,
  eventResponseRevisions,
  eventAttendances,
  eventAttendanceRevisions,
} from "@vtc/db/events-schema";
test("representative mixed event histories expose an ordered selective public-page index", async () => {
  const original = await create({ visibility: "public" }),
    id = original.data.event.id;
  await unit.run(async (tx) => {
    const [definition] = await unit
      .client(tx)
      .select()
      .from(eventRevisions)
      .where(eq(eventRevisions.eventId, id));
    if (!definition) throw new Error("SYNTHETIC_EVENT_MISSING");
    const rows = Array.from({ length: 256 }, (_, i) => ({
      id: newId(),
      revisionId: newId(),
      startsAt: new Date(Date.parse(input().startsAt) + i * 3600000).toISOString(),
      visibility: i % 4 === 0 ? ("public" as const) : ("members" as const),
    }));
    await unit
      .client(tx)
      .insert(events)
      .values(
        rows.map((r) => ({
          id: r.id,
          version: 1,
          changeSequence: 1,
          attendanceVersion: 1,
          currentRevisionId: r.revisionId,
          game: "ets2" as const,
          visibility: r.visibility,
          status: "scheduled" as const,
          startsAt: r.startsAt,
          createdAt: now().toISOString(),
        })),
      );
    await unit
      .client(tx)
      .insert(eventRevisions)
      .values(
        rows.map((r) => ({
          ...definition,
          id: r.revisionId,
          eventId: r.id,
          startsAt: r.startsAt,
          visibility: r.visibility,
        })),
      );
  });
  const [plan] = await control.query<RowDataPacket[]>(
    "EXPLAIN SELECT id FROM events WHERE visibility=? AND starts_at>=? ORDER BY starts_at,id LIMIT 26",
    ["public", "2026-10-22 12:00:00.000"],
  );
  const row = plan[0];
  expect(String(row?.possible_keys)).toContain("event_public_page");
  expect(row?.key).toBe("event_public_page");
  expect(String(row?.Extra)).not.toContain("Using filesort");
  console.log(
    JSON.stringify({
      event: "events_query_plan",
      shape: "public_page",
      access: row?.type,
      index: row?.key,
      estimatedRows: row?.rows,
    }),
  );
});
test("members read decliners and response counts without reasons or unanswered members", async () => {
  await control.query("DELETE FROM identity_limits");
  const staff = (await member(["deputy_director", "driver"])).actor,
    quiet = (await member(["trainee"])).actor,
    id = (await create()).data.event.id,
    other = (await create()).data.event.id,
    reasons = ["Fictional private decliner reason", "Fictional staff decliner reason"] as const;
  await service.respond(trainee, id, newId(), 1, { response: "declined", reason: reasons[0] });
  await service.respond(driver, id, newId(), 1, { response: "participating" });
  await service.respond(staff, id, newId(), 1, { response: "declined", reason: reasons[1] });
  await service.respond(quiet, id, newId(), 1, { response: "participating" });
  await service.respond(quiet, id, newId(), 2, { response: "unanswered" });
  await service.respond(driver, other, newId(), 1, {
    response: "declined",
    reason: "Fictional other event reason",
  });
  const ids = (list: { items: { member: { id: string } }[] }) => list.items.map((p) => p.member.id);
  const declined = [trainee.userId, staff.userId].sort();
  for (const viewer of [driver, dispatcher]) {
    const list = await service.decliners(viewer, id);
    expect(ids(list)).toEqual(declined);
    expect(list.nextCursor).toBeNull();
    expect(list.items.every((p) => Object.keys(p).join() === "member")).toBe(true);
    const counts = await service.responseCounts(viewer, id);
    expect(counts).toEqual({ participating: 1, declined: 2 });
    for (const body of [JSON.stringify(list), JSON.stringify(counts)]) {
      for (const reason of reasons) expect(body).not.toContain(reason);
      expect(body).not.toContain("declineReason");
      expect(body).not.toContain(quiet.userId);
    }
  }
  expect(ids(await service.participants(dispatcher, id))).toEqual([driver.userId]);
  expect(ids(await service.decliners(dispatcher, other))).toEqual([driver.userId]);
  expect(await service.responseCounts(dispatcher, other)).toEqual({
    participating: 0,
    declined: 1,
  });
  const first = await service.decliners(dispatcher, id, { limit: 1 });
  expect(ids(first)).toEqual([declined[0]]);
  const cursor = first.nextCursor as string;
  expect(cursor).toBeTruthy();
  const second = await service.decliners(dispatcher, id, { limit: 1, cursor });
  expect(ids(second)).toEqual([declined[1]]);
  expect(second.nextCursor).toBeNull();
  await expect(service.participants(dispatcher, id, { cursor })).rejects.toMatchObject({
    statusCode: 409,
  });
  await expect(service.decliners(dispatcher, other, { cursor })).rejects.toMatchObject({
    statusCode: 409,
  });
  await service.respond(trainee, id, newId(), 2, { response: "participating" });
  expect(ids(await service.decliners(driver, id))).toEqual([staff.userId]);
  expect(await service.responseCounts(driver, id)).toEqual({ participating: 2, declined: 1 });
  const participating = await service.participants(dispatcher, id, { limit: 1 });
  expect(participating.nextCursor).toBeTruthy();
  await expect(
    service.decliners(dispatcher, id, { cursor: participating.nextCursor as string }),
  ).rejects.toMatchObject({ statusCode: 409 });
  const unknown = newId();
  await expect(service.decliners(driver, unknown)).rejects.toMatchObject({ statusCode: 404 });
  await expect(service.responseCounts(driver, unknown)).rejects.toMatchObject({
    statusCode: 404,
  });
  await service.cancel(director, id, newId(), 1, "Fictional cancellation note");
  expect(ids(await service.decliners(driver, id))).toEqual([staff.userId]);
  expect(await service.responseCounts(driver, id)).toEqual({ participating: 2, declined: 1 });
});
type Stage2Input = components["schemas"]["EventStage2Input"];

function stagedInput(extra: Partial<Stage2Input> = {}): Stage2Input {
  const {
    organizer: _organizer,
    route: _route,
    meetingLocation: _meeting,
    description: _description,
    ...core
  } = input();
  return {
    ...core,
    organizerMemberId: trainee.userId,
    platform: "haulmp",
    requiredDlcIds: [],
    ...extra,
  };
}

async function convoyCatalog() {
  const { id } = await seedCatalog(unit, "ets2", {
    dlcs: [
      {
        code: "stage2_city_dlc",
        nameEn: "Fictional City DLC",
        nameRu: "Fictional translated city DLC",
      },
      { code: "stage2_depot_dlc", nameEn: "Fictional Depot DLC" },
      { code: "stage2_manual_dlc", nameEn: "Fictional Manual DLC" },
    ],
    cities: [
      {
        code: "stage2_origin",
        nameEn: "Fictional Origin",
        nameRu: "Fictional translated origin",
        dlcCode: "stage2_city_dlc",
      },
      { code: "stage2_destination", nameEn: "Fictional Destination" },
    ],
    cargoes: [
      { code: "stage2_cargo", nameEn: "Fictional Cargo", nameRu: "Fictional translated cargo" },
    ],
    trailers: [{ code: "stage2_trailer", nameEn: "Fictional Trailer" }],
  });
  const ats = await seedCatalog(unit, "ats", {
    dlcs: ["stage2_city_dlc"],
    cities: ["stage2_origin"],
  });
  const companyId = newId(),
    originDepot = newId(),
    destinationDepot = newId(),
    atsDepot = newId();
  await unit.run(async (tx) => {
    const c = unit.client(tx),
      atsCompany = newId();
    await c.insert(catalogCompanies).values([
      {
        id: companyId,
        game: "ets2",
        code: Buffer.from("fictional_freight"),
        nameEn: "Fictional Freight",
        nameRu: "Fictional translated company",
      },
      {
        id: atsCompany,
        game: "ats",
        code: Buffer.from("fictional_freight"),
        nameEn: "Fictional American Freight",
      },
    ]);
    await c.insert(catalogCompanyCities).values([
      {
        id: originDepot,
        game: "ets2",
        cityId: id("stage2_origin"),
        companyId,
        dlcId: id("stage2_depot_dlc"),
      },
      { id: destinationDepot, game: "ets2", cityId: id("stage2_destination"), companyId },
      { id: atsDepot, game: "ats", cityId: ats.id("stage2_origin"), companyId: atsCompany },
    ]);
  });
  return { id, ats: ats.id, companyId, originDepot, destinationDepot, atsDepot };
}

test("opted-in published route HTTP serves localized canonical selections and preserves the live wire", async () => {
  await control.query("DELETE FROM identity_limits");
  const { id, ats, companyId, originDepot, destinationDepot, atsDepot } = await convoyCatalog();
  const catalogs = createCatalogs(unit, catalogConfig(), { identity }, now);
  const routes = createEvents(unit, { ...config, routeEnabled: true }, { identity, catalogs }, now);
  const app = await createApp({ identity, events: routes, checkReadiness: async () => true });
  const value = stagedInput({
    visibility: "public",
    originCityId: id("stage2_origin"),
    destinationCityId: id("stage2_destination"),
    originDepotId: originDepot,
    destinationDepotId: destinationDepot,
    prescribedCargoId: id("stage2_cargo"),
    prescribedTrailerTypeId: id("stage2_trailer"),
    requiredDlcIds: [id("stage2_manual_dlc"), id("stage2_city_dlc")],
    distanceKm: "99999999999999999999.000000000000000001",
  });
  try {
    const csrf = (
      await app.inject({ url: "/api/v1/auth/csrf", headers: { cookie: directorCookie } })
    ).json().data.token;
    const write = (
      method: "POST" | "PATCH",
      url: string,
      payload: object,
      key = newId(),
      match?: string,
    ) =>
      app.inject({
        method,
        url,
        payload,
        headers: {
          cookie: directorCookie,
          origin,
          "x-csrf-token": csrf,
          "idempotency-key": key,
          ...(match === undefined ? {} : { "if-match": match }),
        },
      });
    const createPath = "/api/v1/admin/events";
    for (const bad of [
      { ...value, draft: true },
      { ...value, organizer: "Fictional arbitrary organizer" },
      { ...value, organizerMemberId: newId() },
      { ...value, originDepotId: destinationDepot },
      { ...value, originDepotId: atsDepot },
      { ...value, originCityId: null },
      { ...value, requiredDlcIds: [ats("stage2_city_dlc")] },
      { ...value, requiredDlcIds: [newId()] },
      { ...value, requiredDlcIds: [id("stage2_city_dlc"), id("stage2_city_dlc")] },
      { ...value, distanceKm: 0 },
      { ...value, distanceKm: "-1" },
      { ...value, distanceKm: "0.00" },
    ]) {
      expect((await write("POST", createPath, bad)).statusCode).toBe(422);
    }
    expect(await count("events")).toBe(0);
    const createKey = newId();
    const created = await write(
      "POST",
      `${createPath}?locale=ru`,
      { ...value, draft: false },
      createKey,
    );
    expect(created.statusCode, created.body).toBe(201);
    expect(created.headers.etag).toBe('"v1"');
    const member = created.json().data;
    const eventId = member.event.id;
    const publicPath = `/api/v1/public/events/${eventId}`;
    const memberPath = `/api/v1/events/${eventId}`;
    const updatePath = `${createPath}/${eventId}`;
    expect(member).toMatchObject({
      organizerMemberId: trainee.userId,
      prescribedCargo: { label: "Fictional translated cargo", renderedLocale: "ru" },
      prescribedTrailerType: { label: "Fictional Trailer", englishFallback: true },
      responseCounts: { participating: 0, declined: 0 },
      event: {
        organizer: "Fictional Event Member",
        platform: "haulmp",
        origin: { label: "Fictional translated origin", requestedLocale: "ru" },
        destination: { label: "Fictional Destination", englishFallback: true },
        originDepot: { id: originDepot, name: "Fictional Freight", code: "fictional_freight" },
        destinationDepot: {
          id: destinationDepot,
          name: "Fictional Freight",
          code: "fictional_freight",
        },
        description: null,
        route: null,
        meetingLocation: null,
        distanceKm: value.distanceKm,
        hasCover: false,
      },
    });
    expect(member.event.requiredDlcs).toEqual(
      [
        {
          id: id("stage2_city_dlc"),
          name: "Fictional City DLC",
          code: "stage2_city_dlc",
          sources: ["from_city", "manual"],
        },
        {
          id: id("stage2_depot_dlc"),
          name: "Fictional Depot DLC",
          code: "stage2_depot_dlc",
          sources: ["from_city"],
        },
        {
          id: id("stage2_manual_dlc"),
          name: "Fictional Manual DLC",
          code: "stage2_manual_dlc",
          sources: ["manual"],
        },
      ].sort((a, b) => a.id.localeCompare(b.id, "en")),
    );
    const publicDetail = await app.inject({ url: `${publicPath}?locale=en` });
    expect(publicDetail.statusCode).toBe(200);
    expect(
      eventWireValidator.validate(
        browserSchemaRef("EventStage2EnvelopePublic"),
        publicDetail.json(),
      ),
    ).toBe(true);
    expect((await app.inject({ url: `${publicPath}?locale=fr` })).statusCode).toBe(422);
    const russianDetail = await app.inject({ url: `${publicPath}?locale=ru` });
    expect(russianDetail.statusCode).toBe(200);
    expect(
      eventWireValidator.validate(
        browserSchemaRef("EventStage2EnvelopePublic"),
        russianDetail.json(),
      ),
    ).toBe(true);
    expect(russianDetail.json().data.origin).toMatchObject({
      label: "Fictional translated origin",
      requestedLocale: "ru",
    });
    const legacyDetail = await app.inject({ url: publicPath });
    expect(legacyDetail.statusCode).toBe(200);
    expect(
      eventWireValidator.validate(browserSchemaRef("EnvelopeEventPublic"), legacyDetail.json()),
    ).toBe(true);
    const self = await app.inject({ url: "/api/v1/me", headers: { cookie: traineeCookie } });
    expect(self.statusCode).toBe(200);
    expect(eventWireValidator.validate(browserSchemaRef("EnvelopeSelf"), self.json())).toBe(true);
    expect(self.headers[eventsStage2Header]).toBe("1");
    const anonymousSelf = await app.inject({ url: "/api/v1/me" });
    expect(anonymousSelf.statusCode).toBe(401);
    expect(anonymousSelf.headers[eventsStage2Header]).toBeUndefined();
    expect(publicDetail.headers[eventsStage2Header]).toBeUndefined();
    expect(publicDetail.json().data.origin).toMatchObject({
      label: "Fictional Origin",
      requestedLocale: "en",
    });
    for (const privateValue of [
      trainee.userId,
      id("stage2_cargo"),
      id("stage2_trailer"),
      "responseCounts",
      "companyLogo",
      "logo",
      "organizerMemberId",
    ])
      expect(publicDetail.body).not.toContain(privateValue);
    expect((await app.inject({ url: `${memberPath}?locale=en` })).statusCode).toBe(401);
    expect((await app.inject({ url: `${publicPath}?locale=ru&locale=en` })).statusCode).toBe(422);
    expect((await app.inject({ url: publicPath })).json().data).toMatchObject({
      description: "\u2014",
      route: "\u2014",
      meetingLocation: "\u2014",
    });
    expect(
      (await app.inject({ url: "/api/v1/public/events" })).json().data.items[0],
    ).not.toHaveProperty("platform");

    await control.query("UPDATE catalog_companies SET hidden=1 WHERE id=?", [companyId]);
    const zero = await write(
      "PATCH",
      updatePath,
      {
        ...value,
        distanceKm: "0",
        route: "Fictional legacy route",
        meetingLocation: "Fictional meeting text",
      },
      newId(),
      '"v1"',
    );
    expect(zero.statusCode, zero.body).toBe(200);
    expect(zero.json().data.event.distanceKm).toBe("0");
    const removed = await write(
      "PATCH",
      updatePath,
      {
        ...value,
        originDepotId: null,
        distanceKm: null,
        meetingLocation: null,
        visibility: "members",
      },
      newId(),
      '"v2"',
    );
    expect(removed.statusCode, removed.body).toBe(200);
    expect(removed.json().data.event).toMatchObject({
      originDepot: null,
      distanceKm: null,
      route: "Fictional legacy route",
      meetingLocation: null,
    });
    const hidden = await write("PATCH", updatePath, value, newId(), '"v3"');
    expect(hidden.statusCode).toBe(422);
    expect(hidden.json().error.code).toBe("CATALOG_SELECTION_HIDDEN");
    expect((await app.inject({ url: `${publicPath}?locale=en` })).statusCode).toBe(404);

    await routes.respond(driver, eventId, newId(), 1, {
      response: "declined",
      reason: "Fictional private decline",
    });
    const memberRead = await app.inject({
      url: `${memberPath}?locale=ru`,
      headers: { cookie: traineeCookie },
    });
    expect(memberRead.json().data.responseCounts).toEqual({ participating: 0, declined: 1 });
    expect(memberRead.body).not.toContain("Fictional private decline");
    const replay = await write("POST", `${createPath}?locale=ru`, value, createKey);
    expect(replay.statusCode, replay.body).toBe(201);
    expect(replay.headers.etag).toBe('"v1"');
    expect(replay.json().data).toEqual(member);
    expect((await write("POST", createPath, input(), createKey)).statusCode).toBe(409);
    const reason = { reason: "Fictional private cancellation" };
    const cancelPath = `${updatePath}/cancellation`;
    const cancelKey = newId();
    const cancelled = await write("POST", `${cancelPath}?locale=ru`, reason, cancelKey, '"v3"');
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(cancelled.headers.etag).toBe('"v4"');
    expect(cancelled.json().data.event).toMatchObject({
      status: "cancelled",
      destinationDepot: member.event.destinationDepot,
    });
    expect(cancelled.body).not.toContain(reason.reason);
    const legacyCancelReplay = await write("POST", cancelPath, reason, cancelKey, '"v3"');
    expect(legacyCancelReplay.headers.etag).toBe('"v4"');
    expect(legacyCancelReplay.json().data.event).not.toHaveProperty("platform");
    await control.query("DELETE FROM identity_limits");
    const headSelf = await app.inject({
      method: "HEAD",
      url: "/api/v1/me",
      headers: { cookie: traineeCookie },
    });
    expect(headSelf.statusCode).toBe(200);
    expect(headSelf.headers[eventsStage2Header]).toBeUndefined();
  } finally {
    await app.close();
  }
});

test("legacy writers carry compatible route details and staged failures leave no partial rows", async () => {
  const catalogs = createCatalogs(unit, catalogConfig(), { identity }, now);
  const enabled = { ...config, routeEnabled: true };
  const routes = createEvents(unit, enabled, { identity, catalogs }, now);
  const { id } = await seedCatalog(unit, "ets2", {
    cities: ["legacy_route_city"],
    dlcs: ["legacy_manual_dlc"],
  });
  const value = stagedInput({
    originCityId: id("legacy_route_city"),
    requiredDlcIds: [id("legacy_manual_dlc")],
    distanceKm: "12.75",
  });
  await expect(
    routes.createPublished(director, newId(), { ...value, distanceKm: "-1" }, "en"),
  ).rejects.toMatchObject({ statusCode: 422 });
  const old = await create();
  expect((await routes.getPublished(trainee, old.data.event.id, "ru")).data).toMatchObject({
    organizerMemberId: null,
    event: { platform: null, distanceKm: null, requiredDlcs: [] },
  });
  const commandKey = newId(),
    outbox = createOutbox(unit);
  const broken = createEvents(
    unit,
    enabled,
    {
      identity,
      catalogs,
      outbox: {
        async append(tx, event) {
          await outbox.append(tx, event);
          throw Error("FICTIONAL_ROUTE_EFFECT_FAILURE");
        },
      },
    },
    now,
  );
  const affected = [
    "events",
    "event_revisions",
    "event_revision_details",
    "event_revision_dlcs",
    "event_commands",
    "outbox_events",
    "audit_entries",
  ];
  const baseline = await Promise.all(affected.map(count));
  await expect(broken.createPublished(director, commandKey, value, "en")).rejects.toThrow(
    "FICTIONAL_ROUTE_EFFECT_FAILURE",
  );
  expect(await Promise.all(affected.map(count))).toEqual(baseline);
  const [created, replay] = await Promise.all([
    routes.createPublished(director, commandKey, value, "en"),
    routes.createPublished(director, commandKey, value, "en"),
  ]);
  expect(replay).toEqual(created);
  expect(await count("event_revision_details")).toBe(1);
  expect(await count("event_revision_dlcs")).toBe(1);
  const eventId = created.data.event.id;
  const legacy = input({
    organizer: created.data.event.organizer,
    route: "\u2014",
    meetingLocation: "\u2014",
    description: "\u2014",
    originCityId: value.originCityId,
  });
  await routes.update(director, eventId, newId(), 1, legacy);
  expect((await routes.getPublished(trainee, eventId, "en")).data).toMatchObject({
    organizerMemberId: trainee.userId,
    event: {
      platform: "haulmp",
      distanceKm: "12.75",
      requiredDlcs: [{ id: id("legacy_manual_dlc") }],
      route: null,
      meetingLocation: null,
      description: null,
    },
  });
  await routes.update(director, eventId, newId(), 2, {
    ...legacy,
    game: "ats",
    originCityId: null,
    organizer: "Fictional replacement organizer",
  });
  expect((await routes.getPublished(trainee, eventId, "en")).data).toMatchObject({
    organizerMemberId: null,
    event: {
      organizer: "Fictional replacement organizer",
      platform: "haulmp",
      distanceKm: null,
      requiredDlcs: [],
    },
  });
});

test("the fenced route-history probe observes the first committed marker after an earlier empty read", async () => {
  const event = await create();
  const guard = await dedicatedConnection(guardedSettings());
  try {
    await guard.beginTransaction();
    const [early] = await guard.query<RowDataPacket[]>(
      "SELECT EXISTS(SELECT 1 FROM event_revision_details) AS present",
    );
    expect(Number(early[0]?.present)).toBe(0);
    await control.execute(
      "INSERT INTO event_revision_details (revision_id) SELECT current_revision_id FROM events WHERE id=?",
      [event.data.event.id],
    );
    const [fenced] = await guard.query<RowDataPacket[]>(
      "SELECT EXISTS(SELECT revision_id FROM event_revision_details LIMIT 1 FOR SHARE) AS present",
    );
    expect(Number(fenced[0]?.present)).toBe(1);
  } finally {
    try {
      await guard.rollback();
    } finally {
      await guard.end();
    }
  }
});

test("a newly inactive organizer blocks selection while a committed command still replays", async () => {
  const catalogs = createCatalogs(unit, catalogConfig(), { identity }, now);
  const routes = createEvents(unit, { ...config, routeEnabled: true }, { identity, catalogs }, now);
  const { actor: organizer } = await member(["driver"]);
  const value = stagedInput({ organizerMemberId: organizer.userId });
  const key = newId();
  const created = await routes.createPublished(director, key, value, "en");
  await unit.run((tx) =>
    unit
      .client(tx)
      .update(membership)
      .set({ status: "inactive" })
      .where(eq(membership.userId, organizer.userId)),
  );
  await expect(routes.createPublished(director, newId(), value, "en")).rejects.toMatchObject({
    statusCode: 422,
  });
  await expect(routes.createPublished(director, key, value, "en")).resolves.toEqual(created);
});
