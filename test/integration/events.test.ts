import { randomBytes } from "node:crypto";
import {
  createUnitOfWork,
  newId,
  runMigrations,
  TransactionCommitOutcomeUnknownError,
  type UnitOfWork,
} from "@vtc/db";
import { eq, membership } from "@vtc/db/identity-schema";
import type { components } from "@vtc/contracts";
import type { Connection, RowDataPacket } from "mysql2/promise";
import { beforeEach, expect, test, afterAll as after, beforeAll as before } from "vitest";
import { createCatalogs } from "../../apps/api/src/modules/catalogs/service.ts";
import { createQueue } from "../../apps/api/src/platform/jobs/queue.ts";
import { runPass } from "../../apps/api/src/platform/jobs/runner.ts";
import { artifact, entity } from "../fixtures/catalogs/synthetic.ts";
import { createApp } from "../../apps/api/src/app.ts";
import {
  createIdentity,
  type Actor,
  type Identity,
} from "../../apps/api/src/modules/identity/service.ts";
import { createEvents, type Events } from "../../apps/api/src/modules/events/service.ts";
import {
  createOutbox,
  identityAccessEvents,
  catalogEvents,
} from "../../apps/api/src/platform/outbox/events.ts";
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
    "event_catalog_pins",
    "event_responses",
    "event_attendances",
    "event_attendance_revisions",
    "event_response_revisions",
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
    { identity, catalogs: { eventReferencesInTransaction: async () => null } },
    now,
  );
  await expect(
    denied.create(director, newId(), input({ originCityId: newId() })),
  ).rejects.toMatchObject({ statusCode: 422 });
});
test("HTTP actual composition enforces auth, CSRF, strong separate ETags and closed responses", async () => {
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
    const pub = await app.inject({ url: `/api/v1/public/events/${id}` });
    expect(pub.statusCode).toBe(200);
    expect(pub.json().data).not.toHaveProperty("myResponse");
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
test("published same-game catalog facts are pinned immutably and mismatched kinds/games fail closed", async () => {
  const catalogs = createCatalogs(
    unit,
    {
      production: false,
      synthetic: true,
      cursorKey: randomBytes(32).toString("hex"),
      maxFileBytes: 8 * 1024 * 1024,
      artifactTtlMs: 86400000,
      policyRevision: 1,
      evidence: [],
    },
    { identity, published: catalogEvents(unit).append },
  );
  async function publish(label: string) {
    const data = artifact("ets2", [
      entity("event_city", { labels: { en: label, ru: null } }),
      entity("event_cargo", { kind: "cargo" }),
    ]);
    const uploaded = await catalogs.upload(director, newId(), Buffer.from(JSON.stringify(data)));
    const op = await catalogs.import(director, newId(), {
      artifactId: uploaded.id,
      sha256: uploaded.sha256,
      game: "ets2",
    });
    await runPass(createQueue(unit, [catalogs.handler]), new AbortController().signal);
    const result = await catalogs.operation(director, op.id),
      id = result.resultId as string,
      detail = await catalogs.detail(director, id);
    await catalogs.publish(director, id, newId(), detail.version, {
      expectedPublicationVersion: detail.publicationVersion,
      reason: "Fictional catalog review",
    });
    return id;
  }
  const first = await publish("Fictional original city");
  const city = (
      await catalogs.entities(director, { revisionId: first, kind: "city", locale: "en" })
    ).items[0]?.id as string,
    cargo = (await catalogs.entities(director, { revisionId: first, kind: "cargo", locale: "en" }))
      .items[0]?.id as string;
  const integrated = createEvents(unit, config, { identity, catalogs }, now),
    created = await integrated.create(
      director,
      newId(),
      input({ originCityId: city, prescribedCargoId: cargo }),
    );
  expect(created.data.event.origin?.label).toBe("Fictional original city");
  await publish("Fictional later city");
  expect((await integrated.get(trainee, created.data.event.id)).data).toMatchObject({
    event: { origin: { label: "Fictional original city" } },
  });
  await expect(
    integrated.create(director, newId(), input({ game: "ats", originCityId: city })),
  ).rejects.toMatchObject({ statusCode: 422 });
  await expect(
    integrated.create(director, newId(), input({ originCityId: cargo })),
  ).rejects.toMatchObject({ statusCode: 422 });
}, 30000);
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
import { events, eventRevisions } from "@vtc/db/events-schema";
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
