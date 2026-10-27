import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { components } from "@vtc/contracts";
import {
  createUnitOfWork,
  newId,
  opaqueUtf8,
  runMigrations,
  TransactionCommitOutcomeUnknownError,
  type UnitOfWork,
} from "@vtc/db";
import { applications } from "@vtc/db/admissions-schema";
import { durableJobs, outboxEvents } from "@vtc/db/platform-schema";
import type { Connection, RowDataPacket } from "mysql2/promise";
import { afterAll as after, beforeAll as before, beforeEach, expect, test } from "vitest";
import { createApp } from "../../apps/api/src/app.ts";
import { createCatalogs } from "../../apps/api/src/modules/catalogs/service.ts";
import { createEvents, type Events } from "../../apps/api/src/modules/events/service.ts";
import { csrfProtection } from "../../apps/api/src/modules/identity/http.ts";
import {
  type Actor,
  createIdentity,
  type Identity,
} from "../../apps/api/src/modules/identity/service.ts";
import { createManualReports } from "../../apps/api/src/modules/manual-reports/service.ts";
import {
  createNotifications,
  invalidateEventNotifications,
  type Notifications,
} from "../../apps/api/src/modules/notifications/service.ts";
import {
  createQualificationInitialization,
  structuralLevels,
} from "../../apps/api/src/modules/qualifications/initialization.ts";
import {
  createQualifications,
  type Qualifications,
} from "../../apps/api/src/modules/qualifications/service.ts";
import type { Telemetry } from "../../apps/api/src/modules/sources/contracts/telemetry.ts";
import {
  createTripDecisions,
  type TripDecisions,
} from "../../apps/api/src/modules/trip-decisions/service.ts";
import { createTrips, type Trips } from "../../apps/api/src/modules/trips/service.ts";
import {
  createQueue,
  type Handler,
  retryTransaction,
} from "../../apps/api/src/platform/jobs/queue.ts";
import {
  type AdmissionsEvent,
  catalogEvents,
  createOutbox,
  type DomainEvent,
  domainEvent,
  fingerprint,
  identityAccessEvents,
  type ManualEvent,
  notificationEventTypes,
} from "../../apps/api/src/platform/outbox/events.ts";
import {
  guardedSettings,
  reset,
  SCHEMA_SETUP_TIMEOUT_MS,
  testConnection,
} from "../persistence/support.ts";
import { telemetryFixture } from "../support/builders.ts";
import { bounded, deferred } from "../support/concurrency.ts";
import { schemaLifecycleHooks } from "../support/schema-lifecycle.ts";

const { beforeAll, afterAll } = schemaLifecycleHooks(before, after);
type S = components["schemas"];
let control: Connection,
  unit: UnitOfWork,
  identity: Identity,
  events: Events,
  trips: Trips,
  qualifications: Qualifications,
  decisions: TripDecisions,
  service: Notifications;
let director: Actor,
  owner: Actor,
  observer: Actor,
  dispatcher: Actor,
  directorCookie: string,
  ownerCookie: string;
const origin = "http://127.0.0.1:4173",
  password = "Fictional-notifications-passphrase-42",
  key = () => randomBytes(32).toString("hex"),
  config = { cursorKey: key() };
const identityConfig = { secret: key(), origin, production: false };
let instant = Date.now();
const now = () => new Date(instant),
  iso = () => now().toISOString();
async function member(roles: ("driver" | "dispatcher" | "deputy_director")[] = ["driver"]) {
  const userId = newId(),
    email = `${userId}@example.invalid`,
    credential = await identity.prepareCredential(password);
  await unit.run(async (tx) => {
    await identity.insertWithCredential(tx, {
      userId,
      email,
      name: "Fictional Notification Driver",
      ...credential,
      roles,
    });
    await createQualificationInitialization(unit).initialize(tx, {
      userId,
      games: ["ets2", "ats"],
      assignedAt: iso(),
    });
  });
  const login = await identity.login(email, password),
    cookie = login.cookies.map((v) => v.split(";", 1)[0]).join("; ");
  return { actor: await identity.authenticate(new Headers({ cookie })), cookie, email };
}
beforeAll(async () => {
  control = await testConnection();
  unit = createUnitOfWork(guardedSettings());
  await reset(control);
  await runMigrations(guardedSettings());
  identity = createIdentity(unit, identityConfig, {
    accessEvents: identityAccessEvents(unit),
    qualificationsLifecycle: createQualificationInitialization(unit),
  });
  await identity.bootstrap({
    email: "notifications-director@example.invalid",
    name: "Fictional Notification Director",
    password,
  });
  const login = await identity.login("notifications-director@example.invalid", password);
  directorCookie = login.cookies.map((c) => c.split(";", 1)[0]).join("; ");
  director = await identity.authenticate(new Headers({ cookie: directorCookie }));
  ({ actor: owner, cookie: ownerCookie } = await member());
  observer = (await member()).actor;
  dispatcher = (await member(["dispatcher"])).actor;
  trips = createTrips(unit, { cursorKey: key() }, { identity }, now);
  qualifications = createQualifications(unit, { cursorKey: key() }, { identity, trips }, now);
  events = createEvents(
    unit,
    { cursorKey: key() },
    {
      identity,
      notificationChanged: (tx, id, memberId) =>
        invalidateEventNotifications(unit, tx, id, memberId),
    },
    now,
  );
  const catalogs = createCatalogs(
    unit,
    {
      production: false,
      synthetic: true,
      cursorKey: key(),
      maxFileBytes: 1048576,
      artifactTtlMs: 86400000,
      policyRevision: 1,
      evidence: [],
    },
    { identity, published: catalogEvents(unit).append },
    now,
  );
  const manual = createManualReports(
    unit,
    { key: key(), maxFilesPerReport: 5, policyRevision: 1, orphanGraceMs: 60000 },
    { identity, catalogs, trips },
    now,
  );
  decisions = createTripDecisions(
    unit,
    { key: key() },
    { identity, trips, qualifications, manual, events },
    now,
  );
  service = createNotifications(
    unit,
    config,
    { identity, trips, qualifications, events, decisions, manual },
    now,
  );
}, SCHEMA_SETUP_TIMEOUT_MS);
beforeEach(async () => {
  instant = Date.now();
  for (const table of [
    "notification_commands",
    "notifications",
    "notification_recipients",
    "job_effect_receipts",
    "durable_jobs",
    "outbox_routing",
    "outbox_routing_scans",
    "outbox_events",
    "event_commands",
    "event_catalog_pins",
    "event_responses",
    "event_attendances",
    "event_attendance_revisions",
    "event_response_revisions",
    "event_revisions",
    "events",
  ])
    await control.query(`DELETE FROM ${table}`);
});
afterAll(async () => {
  await unit?.close();
  await control?.end();
}, SCHEMA_SETUP_TIMEOUT_MS);
const queue = (handler: Handler = service.handler) =>
  createQueue(unit, [handler, service.reminderHandler], [service.subscription]);
async function drain(q = queue()) {
  for (let n = 0; n < 100; n++) {
    const routed = await q.route(),
      claim = await q.claim();
    if (claim) await q.execute(claim);
    else if (!routed) return;
  }
  throw new Error("SYNTHETIC_NOTIFICATION_DRAIN_EXHAUSTED");
}
function payload(
  kind: "started" | "completed" = "started",
  extra: { backfill?: boolean; age?: number } = {},
) {
  const p = telemetryFixture(kind) as unknown as Telemetry;
  p.eventId = newId();
  p.source.tripId = newId();
  p.source.pluginSessionId = newId();
  p.createdUtcMs = instant;
  p.snapshot.start.utcMs = instant - (extra.age ?? (kind === "completed" ? 3600000 : 0));
  if (p.snapshot.end) p.snapshot.end.utcMs = instant - (extra.age ?? 0);
  if (extra.backfill) p.delivery.mode = "backfill";
  return p;
}
const receive = (p = payload()) =>
  retryTransaction(unit, (tx) =>
    trips.storeInTransaction(tx, "ets2telemetry", p, {
      ownerUserId: owner.userId,
      connection: { state: "unknown", referenceId: null },
    }),
  );
const eventInput = (extra: Partial<S["EventInput"]> = {}): S["EventInput"] => ({
  title: "Fictional notification convoy",
  description: "Fictional description",
  game: "ets2",
  server: "Fictional server",
  organizer: "Fictional company",
  meetingLocation: "Fictional meeting",
  route: "Fictional route",
  meetingAt: iso(),
  startsAt: new Date(instant + 3600000).toISOString(),
  endsAt: null,
  visibility: "members",
  originCityId: null,
  destinationCityId: null,
  prescribedCargoId: null,
  prescribedMassKg: null,
  prescribedTrailerTypeId: null,
  ...extra,
});
async function participating(extra: Partial<S["EventInput"]> = {}) {
  const input = eventInput(extra),
    created = await events.create(director, newId(), input),
    id = created.data.event.id;
  await events.respond(owner, id, newId(), 1, { response: "participating" });
  return { id, input };
}
async function applicationEvent(): Promise<AdmissionsEvent> {
  const id = newId();
  await unit.run((tx) =>
    unit
      .client(tx)
      .insert(applications)
      .values({
        id,
        submittedAt: iso(),
        nickname: "Fictional Applicant",
        email: `${id}@example.invalid`,
        emailKey: `${id}@example.invalid`,
        openEmail: `${id}@example.invalid`,
        steamProfileUrl: "https://example.invalid/fictional-profile",
        games: ["ets2"],
      }),
  );
  return {
    eventId: newId(),
    type: "application.submitted",
    schemaVersion: 1,
    aggregate: { kind: "application", id, version: 1 },
    occurredAt: iso(),
    correlationId: newId(),
    causationId: null,
    data: { applicationId: id },
  };
}
test("empty checkpoint, latest chronological window, ascending lossless catch-up, history and future read isolation", async () => {
  const empty = await service.poll(owner);
  expect(empty.items).toEqual([]);
  expect(empty.nextCursor).toBeTruthy();
  for (let n = 0; n < 5; n++) await receive();
  await drain();
  const latest = await service.poll(owner, { limit: 2 });
  expect(latest.items).toHaveLength(2);
  expect(latest.hasMore).toBe(false);
  const first = await service.poll(owner, { cursor: empty.nextCursor, limit: 2 }),
    second = await service.poll(owner, { cursor: first.nextCursor, limit: 2 }),
    last = await service.poll(owner, { cursor: second.nextCursor, limit: 2 });
  expect([first.hasMore, second.hasMore, last.hasMore]).toEqual([true, true, false]);
  expect(new Set([...first.items, ...second.items, ...last.items].map((r) => r.id)).size).toBe(5);
  expect(latest.items.map((r) => r.id)).toEqual(
    [...second.items, ...last.items].slice(-2).map((r) => r.id),
  );
  const history = await service.history(owner, { limit: 2 });
  expect(history.items.map((r) => r.id)).toEqual([...latest.items].reverse().map((r) => r.id));
  expect(history.items.every((r) => !r.liveToastEligible)).toBe(true);
  await expect(service.poll(owner, { cursor: history.nextCursor as string })).rejects.toMatchObject(
    { statusCode: 409 },
  );
  await expect(service.history(owner, { cursor: last.nextCursor })).rejects.toMatchObject({
    statusCode: 409,
  });
  const readKey = newId();
  await service.readThrough(owner, readKey, last.nextCursor);
  await receive();
  await drain();
  expect((await service.poll(owner)).unreadCount).toBe(1);
  await service.readThrough(owner, readKey, last.nextCursor);
  expect((await service.poll(owner)).unreadCount).toBe(1);
  const fresh = (await service.poll(owner, { cursor: last.nextCursor })).items[0];
  expect(fresh?.readAt).toBeNull();
  await expect(service.read(observer, fresh?.id as string, newId())).rejects.toMatchObject({
    statusCode: 404,
  });
  const individual = newId();
  await service.read(owner, fresh?.id as string, individual);
  await service.read(owner, fresh?.id as string, individual);
  expect((await service.poll(owner)).unreadCount).toBe(0);
});
test("two routing/execution workers and duplicate event retries produce one effect per recipient", async () => {
  const p = payload(),
    saved = await receive(p);
  await receive(p);
  const a = queue(),
    b = queue();
  const routes = await Promise.all([a.route(), b.route()]);
  const [routingState] = await control.query<RowDataPacket[]>(
    "SELECT (SELECT COUNT(*) FROM durable_jobs) jobs,(SELECT COUNT(*) FROM outbox_routing) intents,(SELECT COUNT(*) FROM job_effect_receipts) receipts",
  );
  console.log(
    JSON.stringify({
      event: "notifications_two_router_state",
      newlyRouted: routes.reduce((x, y) => x + y, 0),
      jobs: Number(routingState[0]?.jobs),
      intents: Number(routingState[0]?.intents),
      receipts: Number(routingState[0]?.receipts),
    }),
  );
  expect(routes.reduce((x, y) => x + y, 0)).toBe(1);
  expect([Number(routingState[0]?.jobs), Number(routingState[0]?.intents)]).toEqual([1, 0]);
  const claims = await Promise.all([a.claim(), b.claim()]);
  expect(claims.filter(Boolean)).toHaveLength(1);
  const claim = claims.find(Boolean);
  if (!claim) throw Error("SYNTHETIC_CLAIM_MISSING");
  await a.execute(claim);
  await expect(b.execute(claim)).rejects.toThrow();
  expect(
    (await service.poll(owner)).items.filter((r) => r.target?.id === saved.tripId),
  ).toHaveLength(1);
  const receipt = await a.receipt("notifications.v1", claim.effectKey.toString());
  expect(receipt?.jobId).toBe(claim.id);
  await drain();
  expect((await service.poll(owner)).unreadCount).toBe(1);
});
test("rollback before effect commit and expired reclaim retain gap-safe checkpoint and stale-token fence", async () => {
  const empty = await service.poll(owner);
  await receive();
  let fail = true;
  const entered = deferred<void>(),
    release = deferred<void>();
  const handler: Handler = {
    ...service.handler,
    local: async (tx, ref, claim) => {
      await service.handler.local?.(tx, ref, claim);
      entered.resolve();
      await bounded(release.promise, "notification_effect_release");
      if (fail) throw Error("SYNTHETIC_NOTIFICATION_ROLLBACK");
    },
  };
  const q = queue(handler);
  await q.route();
  const claim = await q.claim();
  if (!claim) throw Error("SYNTHETIC_CLAIM_MISSING");
  const running = q.execute(claim);
  await bounded(entered.promise, "notification_effect_entered");
  const polling = service.poll(owner, { cursor: empty.nextCursor });
  release.resolve();
  await running;
  expect((await polling).items).toEqual([]);
  expect((await service.poll(owner)).nextCursor).toBe(empty.nextCursor);
  const [receipts] = await control.query<RowDataPacket[]>(
    "SELECT COUNT(*) n FROM job_effect_receipts",
  );
  expect(Number(receipts[0]?.n)).toBe(0);
  fail = false;
  await control.query(
    "UPDATE durable_jobs SET state='running',failure=NULL,lease_until=TIMESTAMPADD(SECOND,-1,UTC_TIMESTAMP(3)),lease_token=? WHERE id=?",
    [Buffer.from(newId()), Buffer.from(claim.id)],
  );
  const reclaimed = await q.claim();
  if (!reclaimed) throw Error("SYNTHETIC_RECLAIM_MISSING");
  expect(reclaimed.leaseToken).not.toBe(claim.leaseToken);
  await expect(q.execute(claim)).rejects.toThrow();
  await q.execute(reclaimed);
  expect((await service.poll(owner, { cursor: empty.nextCursor })).items).toHaveLength(1);
});

test("two distinct delivery transactions and a concurrent poll preserve committed recipient order", async () => {
  const checkpoint = await service.poll(owner),
    entered = deferred<void>(),
    release = deferred<void>();
  await receive();
  await receive();
  const held: Handler = {
      ...service.handler,
      local: async (tx, ref, claim) => {
        await service.handler.local?.(tx, ref, claim);
        entered.resolve();
        await bounded(release.promise, "concurrent_notification_commit");
      },
    },
    a = queue(held),
    b = queue();
  expect(await a.route()).toBe(2);
  const first = await a.claim(),
    second = await b.claim();
  if (!first || !second) throw Error("SYNTHETIC_DISTINCT_CLAIMS_MISSING");
  const pending = a.execute(first);
  await bounded(entered.promise, "first_notification_allocation");
  const following = b.execute(second),
    polling = service.poll(owner, { cursor: checkpoint.nextCursor });
  release.resolve();
  await Promise.all([pending, following]);
  const observed = await polling;
  const catchup = await service.poll(owner, { cursor: observed.nextCursor }),
    delivered = [...observed.items, ...catchup.items];
  // The concurrent poll may precede the second commit. Its checkpoint must leave that arrival
  // available to catch-up, while a poll after both commits may return both in the first page.
  expect(delivered).toHaveLength(2);
  expect(new Set(delivered.map((r) => r.id)).size).toBe(2);
  expect((await service.poll(owner, { cursor: catchup.nextCursor })).items).toEqual([]);
  const [sequences] = await control.query<RowDataPacket[]>(
    "SELECT sequence FROM notifications WHERE recipient_id=? ORDER BY sequence",
    [Buffer.from(owner.userId)],
  );
  expect(sequences.map((r) => String(r.sequence))).toEqual(["1", "2"]);
});
test("preferences serialize pending deliveries, retain saved history, require ETag and make retries conflict-safe", async () => {
  const initial = await service.getPreferences(owner),
    value = { ...initial.data, tripStarted: false },
    key = newId();
  await receive();
  const changed = await service.setPreferences(owner, key, initial.version, value);
  await drain();
  expect((await service.poll(owner)).items).toEqual([]);
  expect(await service.setPreferences(owner, key, initial.version, value)).toEqual(changed);
  await expect(
    service.setPreferences(owner, key, initial.version, { ...value, tripFinished: false }),
  ).rejects.toMatchObject({ statusCode: 409 });
  await expect(
    service.setPreferences(owner, newId(), initial.version, initial.data),
  ).rejects.toMatchObject({ statusCode: 412 });
  await service.setPreferences(owner, newId(), changed.version, initial.data);
  await receive();
  await drain();
  const saved = (await service.poll(owner)).items;
  expect(saved).toHaveLength(1);
  const active = await service.getPreferences(owner);
  await service.setPreferences(owner, newId(), active.version, value);
  expect((await service.history(owner)).items.map((r) => r.id)).toEqual(saved.map((r) => r.id));
});
test("company activity has safe nickname/game and null private target; fresh source, backfill and backlog obey receipt/occurrence", async () => {
  await receive();
  await receive(payload("started", { backfill: true }));
  await receive(payload("started", { age: 120001 }));
  await drain();
  const feed = await service.poll(observer);
  expect(feed.items).toHaveLength(3);
  expect(feed.items.filter((r) => r.liveToastEligible)).toHaveLength(1);
  expect(feed.items.every((r) => r.target === null)).toBe(true);
  expect(feed.items[0]?.display).toEqual({
    actorNickname: "Fictional Notification Driver",
    game: "ets2",
    eventTitle: null,
  });
  expect(JSON.stringify(feed)).not.toMatch(/evidence|reason|email|cargo|sourceRecordId/);
  instant += 120001;
  expect((await service.poll(observer)).items.every((r) => !r.liveToastEligible)).toBe(true);
});
test("terminal-before-start and open refresh cannot emit another lifecycle toast or count", async () => {
  const start = payload(),
    saved = await receive(start),
    end = payload("completed");
  end.source = { ...start.source };
  end.revision = 2;
  end.snapshot.start = { ...start.snapshot.start };
  await receive(end);
  await drain();
  const rows = (await service.poll(owner)).items;
  expect(rows.filter((r) => r.category === "trip.started")).toHaveLength(1);
  expect(rows.find((r) => r.category === "trip.started")?.liveToastEligible).toBe(false);
  expect(rows.filter((r) => r.category === "trip.finished")).toHaveLength(1);
  const refresh = structuredClone(end);
  refresh.eventId = newId();
  refresh.revision = 3;
  await receive(refresh);
  await drain();
  expect((await service.poll(owner)).items).toHaveLength(2);
  expect(saved.tripId).toBeTruthy();
});
test("current trip-review capabilities filter private decisions and unread counts after role loss", async () => {
  const candidate = await member(["driver", "dispatcher"]),
    p = payload("completed"),
    saved = await receive(p);
  const review = await decisions.review(dispatcher, saved.tripId);
  await decisions.decide(dispatcher, saved.tripId, newId(), review.version, {
    decision: "reject",
    reviewedRevisionId: review.data.factRevisionId,
    factRevisionId: review.data.factRevisionId,
    proposalId: null,
    reason: "Fictional private rejection explanation",
  });
  await drain();
  expect((await service.poll(observer)).items.some((r) => r.category === "trip.rejected")).toBe(
    false,
  );
  expect((await service.poll(owner)).items.some((r) => r.category === "trip.rejected")).toBe(true);
  const old = await service.poll(candidate.actor);
  expect(old.items.some((r) => r.category === "trip.rejected")).toBe(true);
  const me = await identity.current(candidate.actor);
  await identity.administer(director, candidate.actor.userId, newId(), me.version, {
    kind: "roles",
    roles: ["driver"],
  });
  const login = await identity.login(candidate.email, password),
    cookie = login.cookies.map((c) => c.split(";", 1)[0]).join("; "),
    current = await identity.authenticate(new Headers({ cookie }));
  await expect(service.poll(candidate.actor, { cursor: old.nextCursor })).rejects.toMatchObject({
    statusCode: 401,
  });
  const fresh = await service.poll(current);
  expect(fresh.items.some((r) => r.category === "trip.rejected")).toBe(false);
  expect(fresh.unreadCount).toBe(fresh.items.filter((r) => r.readAt === null).length);
  expect(JSON.stringify(await service.history(owner))).not.toContain("explanation");
});
test("application administration is capability-specific and hidden rows advance catch-up", async () => {
  const checkpoint = await service.poll(dispatcher),
    e = await applicationEvent();
  await unit.run((tx) => createOutbox(unit, { notifications: true }).append(tx, e));
  await drain();
  const admin = await service.poll(director);
  expect(admin.items.some((r) => r.category === "application.submitted")).toBe(true);
  expect((await service.poll(dispatcher, { cursor: checkpoint.nextCursor })).items).toEqual([]);
  expect((await service.poll(owner)).items).toEqual([]);
  await control.execute(
    "UPDATE admissions_applications SET status='rejected',version=2,open_email=NULL WHERE id=?",
    [Buffer.from(e.data.applicationId)],
  );
  await unit.run(async (tx) => {
    const outbox = createOutbox(unit, { notifications: true });
    await outbox.append(tx, { ...e, eventId: newId() });
    await outbox.append(tx, {
      ...e,
      eventId: newId(),
      type: "application.decided",
      aggregate: { ...e.aggregate, version: 2 },
    });
  });
  await drain();
  const decided = await service.poll(director);
  expect(decided.items.filter((r) => r.category === "application.submitted")).toHaveLength(1);
  expect(decided.items.filter((r) => r.category === "application.decided")).toHaveLength(1);
  expect((await service.poll(dispatcher)).items).toEqual([]);
});
test("one-hour reminder is participating-only, RSVP invalidates unread, time replacement preserves response, cancellation clears it", async () => {
  const { id, input } = await participating();
  await service.maintenance();
  await drain();
  expect(
    (await service.poll(owner)).items.filter((r) => r.category === "event.reminder"),
  ).toHaveLength(1);
  expect((await service.poll(observer)).unreadCount).toBe(0);
  const current = await events.myResponse(owner, id);
  await events.respond(owner, id, newId(), current.version, {
    response: "declined",
    reason: "Fictional confidential decline",
  });
  expect((await service.poll(owner)).unreadCount).toBe(0);
  const declined = await events.myResponse(owner, id);
  await events.respond(owner, id, newId(), declined.version, { response: "participating" });
  await service.maintenance();
  await drain();
  expect(
    (await service.poll(owner)).items.filter((r) => r.category === "event.reminder"),
  ).toHaveLength(1);
  const revised = { ...input, startsAt: new Date(instant + 7200000).toISOString() };
  await events.update(director, id, newId(), 1, revised);
  await service.maintenance();
  await drain();
  expect((await events.myResponse(owner, id)).data.response).toBe("participating");
  expect(
    (await service.poll(owner)).items.filter((r) => r.category === "event.reminder"),
  ).toHaveLength(0);
  expect((await service.poll(owner)).items.some((r) => r.category === "event.start_changed")).toBe(
    true,
  );
  instant += 3600000;
  await control.query(
    "UPDATE durable_jobs SET available_at=UTC_TIMESTAMP(3) WHERE CAST(kind AS CHAR)='notifications.remind' AND state='ready'",
  );
  await drain();
  expect(
    (await service.poll(owner)).items.filter((r) => r.category === "event.reminder"),
  ).toHaveLength(1);
  await events.cancel(director, id, newId(), 2, "Fictional confidential cancellation");
  await drain();
  const feed = await service.poll(owner);
  expect(feed.items.filter((r) => r.category === "event.reminder")).toHaveLength(0);
  expect(feed.items.some((r) => r.category === "event.cancelled")).toBe(true);
  expect(JSON.stringify(feed)).not.toContain("confidential");
});
test("disabled delivery preserves routing work and mutation invalidation; missed windows skip obsolete reminders", async () => {
  const { id, input } = await participating();
  await service.maintenance();
  await drain();
  const original = (await service.poll(owner)).items.find((r) => r.category === "event.reminder");
  if (!original) throw Error("SYNTHETIC_PAUSED_REMINDER_MISSING");
  await events.update(director, id, newId(), 1, { ...input, route: "Fictional replacement route" });
  expect(
    (await service.poll(owner)).items
      .filter((r) => r.category === "event.reminder")
      .map((r) => r.id),
  ).toEqual([original.id]);
  const disabled = createQueue(unit, [], [], undefined, [
    "notifications.deliver",
    "notifications.remind",
  ]);
  expect(await disabled.claim()).toBeNull();
  instant += 180000;
  await service.maintenance();
  await drain();
  const feed = await service.poll(owner);
  expect(feed.items.some((r) => r.category === "event.route_changed")).toBe(true);
  expect(feed.items.filter((r) => r.category === "event.reminder").map((r) => r.id)).toEqual([
    original.id,
  ]);
  expect(feed.items.find((r) => r.id === original.id)?.liveToastEligible).toBe(false);
  const [saved] = await control.query<RowDataPacket[]>(
    "SELECT COUNT(*) n FROM notifications WHERE subject_id=? AND recipient_id=? AND category='event.reminder'",
    [Buffer.from(id), Buffer.from(owner.userId)],
  );
  expect(Number(saved[0]?.n)).toBe(1);
  await events.update(director, id, newId(), 2, {
    ...input,
    startsAt: new Date(instant + 7200000).toISOString(),
  });
  expect((await service.poll(owner)).items.some((r) => r.category === "event.reminder")).toBe(
    false,
  );
  await events.cancel(director, id, newId(), 3, "Fictional cancellation after paused schedule");
  expect((await service.poll(owner)).items.some((r) => r.category === "event.reminder")).toBe(
    false,
  );
  instant = Date.now();
  const missed = await participating();
  instant += 180000;
  await service.maintenance();
  await drain();
  expect(
    (await service.poll(owner)).items.some(
      (r) => r.category === "event.reminder" && r.target?.id === missed.id,
    ),
  ).toBe(false);
  instant = Date.now();
  const other = await participating({ startsAt: new Date(instant + 3600000).toISOString() });
  instant += 3600001;
  await service.maintenance();
  await drain();
  expect(
    (await service.poll(owner)).items.some(
      (r) => r.category === "event.reminder" && r.target?.id === other.id,
    ),
  ).toBe(false);
});

test("typed old-producer event recovery repairs acknowledged scheduling markers atomically", async () => {
  const { id, input } = await participating({
    startsAt: new Date(instant + 7200000).toISOString(),
  });
  await service.maintenance();
  await drain();
  await service.maintenance();
  async function marker() {
    const [rows] = await control.query<RowDataPacket[]>(
      "SELECT notification_pending FROM events WHERE id=?",
      [Buffer.from(id)],
    );
    return Boolean(rows[0]?.notification_pending);
  }
  async function oldProducerFinalState() {
    // A pre-0016 writer preserves an acknowledged false column instead of setting the new marker.
    // The owning command supplies real immutable history/outbox; no consumer runs between writes.
    await control.execute("UPDATE events SET notification_pending=0 WHERE id=?", [Buffer.from(id)]);
  }
  expect(await marker()).toBe(false);
  const disabled = createEvents(unit, { cursorKey: key() }, { identity }, now);
  await disabled.update(director, id, newId(), 1, {
    ...input,
    startsAt: new Date(instant + 3600000).toISOString(),
  });
  await oldProducerFinalState();
  expect(await service.maintenance()).toBe(0);
  const q = queue();
  await q.route();
  const claim = await q.claim();
  if (!claim || claim.kind.toString() !== "notifications.deliver")
    throw Error("SYNTHETIC_OLD_EVENT_CLAIM_MISSING");
  await expect(
    unit.run(async (tx) => {
      await service.handler.local?.(tx, claim.reference, claim);
      throw Error("SYNTHETIC_MARKER_REPAIR_ROLLBACK");
    }),
  ).rejects.toThrow("SYNTHETIC_MARKER_REPAIR_ROLLBACK");
  expect(await marker()).toBe(false);
  expect(await q.receipt("notifications.v1", claim.effectKey.toString())).toBeNull();
  await q.execute(claim);
  expect(await marker()).toBe(true);
  expect(await q.receipt("notifications.v1", claim.effectKey.toString())).not.toBeNull();
  await service.maintenance();
  await drain();
  const first = (await service.poll(owner)).items.find((r) => r.category === "event.reminder");
  expect(first).toBeDefined();
  for (const response of ["declined", "participating"] as const) {
    const own = await events.myResponse(owner, id);
    await disabled.respond(
      owner,
      id,
      newId(),
      own.version,
      response === "declined"
        ? { response, reason: "Fictional old-producer decline reason" }
        : { response },
    );
    await oldProducerFinalState();
    await drain();
    expect(await marker()).toBe(true);
    await service.maintenance();
    await drain();
    const reminders = (await service.poll(owner)).items.filter(
      (r) => r.category === "event.reminder",
    );
    expect(reminders).toHaveLength(response === "participating" ? 1 : 0);
    if (response === "participating") expect(reminders[0]?.id).not.toBe(first?.id);
  }
  await disabled.cancel(director, id, newId(), 2, "Fictional old-producer cancellation");
  await oldProducerFinalState();
  await drain();
  expect(await marker()).toBe(true);
  await service.maintenance();
  expect(await marker()).toBe(false);
  expect((await service.poll(owner)).items.some((r) => r.category === "event.reminder")).toBe(
    false,
  );
});

test("concurrent reminder maintenance owns pending rows and two workers retain one effect", async () => {
  await participating();
  const maintenance = await Promise.all([service.maintenance(), service.maintenance()]);
  expect(maintenance.reduce((a, b) => a + b, 0)).toBe(1);
  const a = queue(),
    b = queue(),
    claims = await Promise.all([a.claim(), b.claim()]);
  expect(claims.filter(Boolean)).toHaveLength(1);
  const claim = claims.find(Boolean);
  if (!claim) throw Error("SYNTHETIC_CONCURRENT_REMINDER_MISSING");
  expect(claim.kind.toString()).toBe("notifications.remind");
  await a.execute(claim);
  await drain();
  const original = (await service.poll(owner)).items.filter((r) => r.category === "event.reminder");
  expect(original).toHaveLength(1);
  // Recovered definition/RSVP source jobs re-mark the schedule after its initial acknowledgement.
  await service.maintenance();
  await drain();
  expect((await service.poll(owner)).items.filter((r) => r.category === "event.reminder")).toEqual(
    original,
  );
  expect(await service.maintenance()).toBe(0);
  expect(
    (await service.poll(owner)).items.filter((r) => r.category === "event.reminder"),
  ).toHaveLength(1);
  const [pending] = await control.query<RowDataPacket[]>(
    "SELECT COUNT(*) n FROM events WHERE notification_pending=1",
  );
  expect(Number(pending[0]?.n)).toBe(0);
});
test("six HTTP operations enforce session, CSRF, strict contracts, ETag, replay authorization and logout", async () => {
  const app = await createApp({
    identity,
    notifications: service,
    checkReadiness: async () => true,
  });
  try {
    expect((await app.inject({ url: "/api/v1/notifications" })).statusCode).toBe(401);
    const auth = { cookie: ownerCookie },
      empty = await app.inject({ url: "/api/v1/notifications", headers: auth });
    expect(empty.statusCode).toBe(200);
    expect(empty.headers["cache-control"]).toBe("no-store");
    const preferences = await app.inject({
      url: "/api/v1/me/notification-preferences",
      headers: auth,
    });
    expect(preferences.headers.etag).toBe('"v1"');
    const issued = csrfProtection(identityConfig).issue({}, owner),
      headers = {
        cookie: `${ownerCookie}; ${issued.cookie.split(";", 1)[0]}`,
        origin,
        "x-csrf-token": issued.token,
        "idempotency-key": newId(),
        "if-match": '"v1"',
      };
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/v1/me/notification-preferences",
          headers: auth,
          payload: preferences.json().data,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/v1/me/notification-preferences",
          headers,
          payload: preferences.json().data,
        })
      ).statusCode,
    ).toBe(200);
    await receive();
    await drain();
    const poll = await app.inject({ url: "/api/v1/notifications", headers: auth });
    const row = poll.json().data.items[0];
    expect(
      (await app.inject({ url: "/api/v1/notifications/history", headers: auth })).json().data
        .items[0].liveToastEligible,
    ).toBe(false);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/notifications/${row.id}/read`,
          headers: { ...headers, "idempotency-key": newId() },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/notifications/read-all",
          headers: { ...headers, "idempotency-key": newId() },
          payload: { throughCursor: poll.json().data.nextCursor },
        })
      ).statusCode,
    ).toBe(200);
    const second = await identity.login("notifications-director@example.invalid", password),
      otherSession = await identity.authenticate(
        new Headers({ cookie: second.cookies.map((v) => v.split(";", 1)[0]).join("; ") }),
      );
    await expect(
      service.poll(otherSession, { cursor: poll.json().data.nextCursor }),
    ).rejects.toMatchObject({ statusCode: 409 });
    const person = await member(),
      saved = await service.poll(person.actor),
      prefs = await service.getPreferences(person.actor),
      retryKey = newId();
    await service.setPreferences(person.actor, retryKey, prefs.version, prefs.data);
    await identity.logout(person.actor, new Headers({ cookie: person.cookie }));
    await expect(
      service.setPreferences(person.actor, retryKey, prefs.version, prefs.data),
    ).rejects.toMatchObject({ statusCode: 401 });
    await expect(service.poll(person.actor, { cursor: saved.nextCursor })).rejects.toMatchObject({
      statusCode: 401,
    });
  } finally {
    await app.close();
  }
});
test("routing stays indexed with substantial routed/mixed history and discovers an earlier late commit", async () => {
  const outbox = createOutbox(unit, { notifications: true }),
    retained = Array.from({ length: 3000 }, (_, i) => ({
      id: newId(),
      type: opaqueUtf8(i % 2 ? "application.submitted" : "catalog.published", 64),
      schemaVersion: 1,
      aggregateKind: opaqueUtf8(i % 2 ? "application" : "catalog", 32),
      aggregateId: newId(),
      aggregateVersion: 1,
      occurredAt: iso(),
      correlationId: newId(),
      causationId: null,
      data: {},
      fingerprint: randomBytes(32),
      recordedAt: iso(),
    }));
  for (let n = 0; n < retained.length; n += 250)
    await unit.run((tx) =>
      unit
        .client(tx)
        .insert(outboxEvents)
        .values(retained.slice(n, n + 250)),
    );
  for (let n = 0; n < retained.length; n += 250)
    await unit.run((tx) =>
      unit
        .client(tx)
        .insert(durableJobs)
        .values(
          retained
            .slice(n, n + 250)
            .filter((e) => e.type.toString() === "application.submitted")
            .map((e) => ({
              id: newId(),
              kind: opaqueUtf8("notifications.deliver", 64),
              schemaVersion: 1,
              consumer: opaqueUtf8("notifications.v1", 64),
              effectKey: opaqueUtf8(e.id, 128),
              eventId: e.id,
              reference: { eventId: e.id, after: null },
              fingerprint: randomBytes(32),
              state: "completed" as const,
              availableAt: iso(),
              attempts: 1,
              maxAttempts: 5,
              createdAt: iso(),
              completedAt: iso(),
            })),
        ),
    );
  await control.query("DELETE FROM outbox_routing");
  const early = await applicationEvent(),
    entered = deferred<void>(),
    release = deferred<void>();
  const late = unit.run(async (tx) => {
    await outbox.append(tx, early);
    entered.resolve();
    await bounded(release.promise, "late_notification_commit");
  });
  await bounded(entered.promise, "early_event_inserted");
  const later = await applicationEvent();
  await unit.run((tx) => outbox.append(tx, later));
  const q = queue();
  expect(await q.route()).toBe(1);
  release.resolve();
  await late;
  expect(await q.route()).toBe(1);
  const [plan] = await control.query<RowDataPacket[]>(
    "EXPLAIN SELECT r.* FROM outbox_routing r WHERE r.consumer=? ORDER BY r.recorded_at,r.event_id LIMIT 25 FOR UPDATE SKIP LOCKED",
    [Buffer.from("notifications.v1")],
  );
  expect(plan.find((r) => r.table === "r")?.key).toBe("outbox_routing_pending");
  expect(String(plan.find((r) => r.table === "r")?.Extra)).not.toContain("filesort");
  const ids = [Buffer.from(early.eventId), Buffer.from(later.eventId)];
  const [evidencePlan] = await control.query<RowDataPacket[]>(
    "EXPLAIN SELECT e.* FROM outbox_events e WHERE e.id IN (?,?) ORDER BY e.id FOR SHARE",
    ids,
  );
  expect(evidencePlan[0]?.key).toBe("PRIMARY");
  expect(String(evidencePlan[0]?.Extra)).not.toContain("filesort");
  const [evidenceWork] = await control.query<RowDataPacket[]>(
    "EXPLAIN ANALYZE SELECT e.* FROM outbox_events e WHERE e.id IN (?,?) ORDER BY e.id FOR SHARE",
    ids,
  );
  expect(String(Object.values(evidenceWork[0] ?? {})[0])).toContain("rows=2");
  const started = performance.now();
  expect(await q.route()).toBe(0);
  console.log(
    JSON.stringify({
      event: "notifications_routing_plan",
      retained: 3002,
      pending: 0,
      index: plan.find((r) => r.table === "r")?.key,
      estimatedRows: plan.find((r) => r.table === "r")?.rows,
      evidenceIndex: evidencePlan[0]?.key,
      evidenceRows: 2,
      emptyRouteMs: Math.round(performance.now() - started),
    }),
  );
  await drain(q);
  expect((await service.poll(director)).items).toHaveLength(2);
});
test("unknown schema version becomes a visible failed job without blocking subsequent events", async () => {
  const e = await applicationEvent();
  await unit.run((tx) => createOutbox(unit, { notifications: true }).append(tx, e));
  await control.query("UPDATE outbox_events SET schema_version=2 WHERE id=?", [
    Buffer.from(e.eventId),
  ]);
  const q = queue();
  expect(await q.route()).toBe(1);
  const claim = await q.claim();
  if (!claim) throw Error("SYNTHETIC_INVALID_CLAIM_MISSING");
  await q.execute(claim);
  expect((await q.inspect()).failures).toContainEqual(
    expect.objectContaining({ id: claim.id, failure: "handler_failed" }),
  );
  const [rows] = await control.query<RowDataPacket[]>(
    "SELECT COUNT(*) n FROM outbox_routing WHERE event_id=?",
    [Buffer.from(e.eventId)],
  );
  expect(Number(rows[0]?.n)).toBe(0);
  const valid = await applicationEvent();
  await unit.run((tx) => createOutbox(unit, { notifications: true }).append(tx, valid));
  await drain(q);
  expect((await service.poll(director)).items).toHaveLength(1);
});

test("wrapping primary-ID recovery finds every closed family amid mixed history and a lower-ID old commit", async () => {
  function envelope(type: string, id = newId()): DomainEvent {
    let kind = "qualification",
      aggregateId = id,
      data: Record<string, unknown> = { userId: owner.userId, assignmentId: newId() };
    if (type === "qualification.rules_changed") data = { userId: null, assignmentId: null };
    else if (type.startsWith("application.")) {
      kind = "application";
      data = { applicationId: id };
    } else if (type === "member.access_changed") {
      kind = "member";
      data = { userId: id, accessEpoch: 1, identityEpoch: 1 };
    } else if (type === "trip.lifecycle_changed") {
      kind = "trip";
      data = { tripId: id, sourceRecordId: newId(), factRevisionId: newId() };
    } else if (type === "trip.decision_changed") {
      kind = "trip";
      data = { decisionId: newId(), contributionVersion: 1 };
    } else if (type.startsWith("manual.")) {
      kind = type === "manual.report_submitted" ? "manual_report" : "trip";
      data = { resourceId: newId(), tripId: type === "manual.report_submitted" ? newId() : id };
    } else if (type.startsWith("event.")) {
      const revision = newId();
      kind = type === "event.changed" ? "event" : "event_response";
      aggregateId = type === "event.changed" ? id : newId();
      data = {
        eventId: id,
        eventRevisionId: revision,
        revisionId: revision,
        changeSequence: 1,
        memberId: type === "event.changed" ? null : owner.userId,
        category: type === "event.changed" ? "updated" : "response",
      };
    }
    return domainEvent({
      eventId: newId(),
      type,
      schemaVersion: 1,
      aggregate: { kind, id: aggregateId, version: 1 },
      occurredAt: iso(),
      correlationId: newId(),
      causationId: null,
      data,
    });
  }
  const raw = (e: DomainEvent) => ({
    id: e.eventId,
    type: opaqueUtf8(e.type, 64),
    schemaVersion: e.schemaVersion,
    aggregateKind: opaqueUtf8(e.aggregate.kind, 32),
    aggregateId: e.aggregate.id,
    aggregateVersion: e.aggregate.version,
    occurredAt: e.occurredAt,
    correlationId: e.correlationId,
    causationId: e.causationId,
    data: e.data,
    fingerprint: fingerprint(e),
    recordedAt: iso(),
  });
  const events = notificationEventTypes.map((type) => envelope(type)),
    irrelevant = Array.from({ length: 3000 }, () => envelope("qualification.rules_changed"));
  const rows = [...events, ...irrelevant].map(raw);
  for (let n = 0; n < rows.length; n += 250)
    await unit.run((tx) =>
      unit
        .client(tx)
        .insert(outboxEvents)
        .values(rows.slice(n, n + 250)),
    );
  const q = queue();
  let discovered = 0;
  for (let n = 0; n < 14; n++) discovered += await q.route();
  expect(discovered).toBe(notificationEventTypes.length);
  const [families] = await control.query<RowDataPacket[]>(
    "SELECT DISTINCT CAST(e.type AS CHAR) type FROM durable_jobs j JOIN outbox_events e ON e.id=j.event_id WHERE j.consumer=?",
    [Buffer.from("notifications.v1")],
  );
  expect(families.map((r) => r.type).sort()).toEqual([...notificationEventTypes].sort());
  const early = envelope("member.access_changed");
  early.eventId = "00000000-0000-4000-8000-000000000036";
  const entered = deferred<void>(),
    release = deferred<void>();
  let producer: Promise<void> | undefined;
  try {
    producer = unit.run(async (tx) => {
      await unit.client(tx).insert(outboxEvents).values(raw(early));
      entered.resolve();
      await bounded(release.promise, "old_primary_commit", 10000);
    });
    await bounded(entered.promise, "old_primary_inserted");
    await control.query("UPDATE outbox_routing_scans SET `cursor`=? WHERE consumer=?", [
      Buffer.from("70000000-0000-4000-8000-000000000036"),
      Buffer.from("notifications.v1"),
    ]);
    expect(await q.route()).toBe(0);
    release.resolve();
    await producer;
    let found = 0;
    for (let n = 0; n < 15; n++) found += await q.route();
    expect(found).toBe(1);
    const [plan] = await control.query<RowDataPacket[]>(
      "EXPLAIN SELECT id,type,recorded_at FROM outbox_events WHERE id>? ORDER BY id LIMIT 250",
      [Buffer.from("70000000-0000-4000-8000-000000000036")],
    );
    expect(plan[0]?.key).toBe("PRIMARY");
    expect(String(plan[0]?.Extra)).not.toContain("filesort");
    const [work] = await control.query<RowDataPacket[]>(
      "EXPLAIN ANALYZE SELECT id,type,recorded_at FROM outbox_events WHERE id>? ORDER BY id LIMIT 250",
      [Buffer.from("00000000-0000-4000-8000-000000000000")],
    );
    expect(String(Object.values(work[0] ?? {})[0])).toContain("rows=250");
    console.log(
      JSON.stringify({
        event: "notifications_scan_plan",
        retained: rows.length + 1,
        families: notificationEventTypes.length,
        scanBound: 250,
        routeBound: 25,
        index: plan[0]?.key,
        lateRecovered: true,
      }),
    );
  } finally {
    release.resolve();
    await producer;
  }
});

test("response loss after a committed local notification reconciles its receipt without replay", async () => {
  await receive();
  let calls = 0,
    lose = false;
  const uncertain: UnitOfWork = {
    ...unit,
    run: async <T>(command: (tx: import("@vtc/db").TxContext) => Promise<T>) => {
      const result = await unit.run(command);
      if (lose && ++calls === 2)
        throw new TransactionCommitOutcomeUnknownError(new Error("SYNTHETIC_RECEIPT_LOSS"));
      return result;
    },
  };
  const q = createQueue(
    uncertain,
    [service.handler, service.reminderHandler],
    [service.subscription],
  );
  await q.route();
  const claim = await q.claim();
  if (!claim) throw Error("SYNTHETIC_CLAIM_MISSING");
  lose = true;
  await expect(q.execute(claim)).rejects.toBeInstanceOf(TransactionCommitOutcomeUnknownError);
  expect((await q.receipt("notifications.v1", claim.effectKey.toString()))?.jobId).toBe(claim.id);
  expect((await service.poll(owner)).items).toHaveLength(1);
  await expect(q.execute(claim)).rejects.toThrow();
});
test("routing enqueue and intent deletion roll back together on a conflicting batch effect", async () => {
  const a = await applicationEvent(),
    b = await applicationEvent();
  await unit.run(async (tx) => {
    await createOutbox(unit, { notifications: true }).append(tx, a);
    await createOutbox(unit, { notifications: true }).append(tx, b);
  });
  let validations = 0;
  const handler: Handler = {
    ...service.handler,
    validate: (r) => {
      if (++validations === 2) throw Error("SYNTHETIC_ROUTE_FAILURE");
      return service.handler.validate(r);
    },
  };
  await expect(queue(handler).route()).rejects.toThrow("SYNTHETIC_ROUTE_FAILURE");
  const [counts] = await control.query<RowDataPacket[]>(
    "SELECT (SELECT COUNT(*) FROM durable_jobs) jobs,(SELECT COUNT(*) FROM outbox_routing) pending",
  );
  expect(Number(counts[0]?.jobs)).toBe(0);
  expect(Number(counts[0]?.pending)).toBe(2);
  await drain();
  expect((await service.poll(director)).items).toHaveLength(2);
});
test("reconciled source aliases delivered out of order retain one canonical lifecycle effect", async () => {
  const a = await receive(),
    b = await receive();
  await unit.run(async (tx) => {
    await qualifications.prepareInTransaction(tx, [{ ownerId: owner.userId, game: "ets2" }]);
    const roots = await trips.statesInTransaction(tx, [a.tripId, b.tripId], true),
      primary = roots.find((r) => r.id === a.tripId),
      secondary = roots.find((r) => r.id === b.tripId);
    if (!primary || !secondary) throw Error("SYNTHETIC_GROUP_MISSING");
    await trips.reconciliation.apply(tx, primary, secondary);
  });
  await drain();
  const feed = await service.poll(owner);
  expect(feed.items.filter((r) => r.category === "trip.started")).toHaveLength(1);
  expect(feed.items[0]?.target?.id).toBe(a.tripId);
  await drain();
  expect((await service.poll(owner)).unreadCount).toBe(1);
});

async function rejectedAliasFixture() {
  const alias = await receive(payload("completed")),
    root = await receive(payload("completed")),
    review = await decisions.review(dispatcher, alias.tripId);
  await decisions.decide(dispatcher, alias.tripId, newId(), review.version, {
    decision: "reject",
    reviewedRevisionId: review.data.factRevisionId,
    factRevisionId: review.data.factRevisionId,
    proposalId: null,
    reason: "Fictional rejection superseded by canonical reconciliation",
  });
  return { alias, root };
}
async function reconcileRejectedAlias(
  aliasId: string,
  rootId: string,
  decision: "unassessed" | "accepted",
) {
  await unit.run(async (tx) => {
    await qualifications.prepareInTransaction(tx, [{ ownerId: owner.userId, game: "ets2" }]);
    const states = await trips.statesInTransaction(tx, [aliasId, rootId], true),
      root = states.find((r) => r.id === rootId),
      alias = states.find((r) => r.id === aliasId);
    if (!root || !alias) throw Error("SYNTHETIC_REJECTED_GROUP_MISSING");
    await trips.reconciliation.apply(tx, root, alias);
  });
  // Retained canonical projection fixture; immutable alias decision evidence remains unchanged.
  await control.execute("UPDATE trips SET decision=? WHERE id=?", [decision, Buffer.from(rootId)]);
}
test.each(["unassessed", "accepted"] as const)(
  "a retained rejected decision queued before aliasing cannot reject a canonical %s trip",
  async (decision) => {
    const { alias, root } = await rejectedAliasFixture();
    await reconcileRejectedAlias(alias.tripId, root.tripId, decision);
    await drain();
    expect((await service.poll(owner)).items.some((r) => r.category === "trip.rejected")).toBe(
      false,
    );
    expect((await service.poll(director)).items.some((r) => r.category === "trip.rejected")).toBe(
      false,
    );
  },
);
test.each(["unassessed", "accepted"] as const)(
  "a retained rejected decision inserted before aliasing loses its live flag when canonical state is %s",
  async (decision) => {
    const { alias, root } = await rejectedAliasFixture();
    await drain();
    const saved = (await service.poll(owner)).items.find((r) => r.category === "trip.rejected");
    if (!saved) throw Error("SYNTHETIC_SAVED_REJECTION_MISSING");
    expect(saved.liveToastEligible).toBe(true);
    await reconcileRejectedAlias(alias.tripId, root.tripId, decision);
    const current = (await service.poll(owner)).items.find((r) => r.id === saved.id);
    expect(current?.liveToastEligible).toBe(false);
    expect(current?.target?.id).toBe(root.tripId);
    expect((await service.history(owner)).items.some((r) => r.id === saved.id)).toBe(true);
  },
);
test("deactivation and return invalidate old sessions, poll/read-through proofs and old reminder epochs", async () => {
  const person = await member(),
    created = await events.create(director, newId(), eventInput()),
    id = created.data.event.id;
  await events.respond(person.actor, id, newId(), 1, { response: "participating" });
  await service.maintenance();
  await drain();
  const before = await service.poll(person.actor);
  expect(before.items.some((r) => r.category === "event.reminder")).toBe(true);
  const current = await identity.current(person.actor);
  await identity.administer(director, person.actor.userId, newId(), current.version, {
    kind: "deactivate",
  });
  await expect(service.poll(person.actor)).rejects.toMatchObject({ statusCode: 401 });
  await identity.administer(director, person.actor.userId, newId(), current.version + 1, {
    kind: "reinstate",
    roles: ["driver"],
    qualifications: [
      {
        game: "ets2",
        levelId: structuralLevels.ets2[0],
        purpose: "reinstatement",
        reason: "Fictional explicit return",
      },
    ],
  });
  const login = await identity.login(person.email, password),
    cookie = login.cookies.map((c) => c.split(";", 1)[0]).join("; "),
    returned = await identity.authenticate(new Headers({ cookie }));
  await expect(service.poll(returned, { cursor: before.nextCursor })).rejects.toMatchObject({
    statusCode: 409,
  });
  await expect(service.readThrough(returned, newId(), before.nextCursor)).rejects.toMatchObject({
    statusCode: 409,
  });
  expect((await service.poll(returned)).items.some((r) => r.category === "event.reminder")).toBe(
    false,
  );
  await expect(service.poll(person.actor)).rejects.toMatchObject({ statusCode: 401 });
});
test("qualification assignments, eligibility and confirmed promotion notify owner and qualification staff only", async () => {
  const person = await member(),
    levelId = structuralLevels.ets2[0],
    level = (await qualifications.levels(director, "ets2")).items.find((v) => v.id === levelId);
  if (!level) throw Error("SYNTHETIC_LEVEL_MISSING");
  await qualifications.publish(director, levelId, newId(), level.version, {
    rules: [{ type: "max_mass", maxKg: "20000" }],
    requiredTrips: 0,
    requiredDistanceM: "0",
    reason: "Fictional zero-progress notification fixture",
  });
  const current = await qualifications.progress(person.actor, person.actor.userId, "ets2", "owner");
  await qualifications.assign(director, person.actor.userId, newId(), current.version, {
    game: "ets2",
    levelId,
    purpose: "administrative_correction",
    reason: "Fictional assignment fixture",
  });
  const assigned = await qualifications.progress(
    person.actor,
    person.actor.userId,
    "ets2",
    "owner",
  );
  await drain();
  expect(
    (await service.poll(person.actor)).items.some((r) => r.category === "qualification.assigned"),
  ).toBe(true);
  expect(
    (await service.poll(dispatcher)).items.some((r) => r.category === "qualification.assigned"),
  ).toBe(false);
  const eventId = newId();
  await unit.run((tx) =>
    createOutbox(unit, { notifications: true }).append(tx, {
      eventId,
      type: "qualification.progress_changed",
      schemaVersion: 1,
      aggregate: { kind: "qualification", id: assigned.data.assignment.id, version: 1 },
      occurredAt: iso(),
      correlationId: eventId,
      causationId: null,
      data: { userId: person.actor.userId, assignmentId: assigned.data.assignment.id },
    }),
  );
  await drain();
  expect(
    (await service.poll(person.actor)).items.filter((r) => r.category === "promotion.eligible"),
  ).toHaveLength(1);
  expect(
    (await service.poll(director)).items.some((r) => r.category === "promotion.eligible"),
  ).toBe(true);
  expect(
    (await service.poll(observer)).items.some((r) => r.category === "promotion.eligible"),
  ).toBe(false);
  await qualifications.promote(director, person.actor.userId, newId(), assigned.version, {
    game: "ets2",
    assignmentId: assigned.data.assignment.id,
    targetLevelId: structuralLevels.ets2[1],
    reason: "Fictional confirmed promotion",
  });
  await drain();
  const promoted = await qualifications.progress(
    person.actor,
    person.actor.userId,
    "ets2",
    "owner",
  );
  const feed = await service.poll(person.actor);
  expect(feed.items.filter((r) => r.category === "qualification.promoted")).toHaveLength(1);
  expect(
    feed.items.filter(
      (r) =>
        r.category === "qualification.assigned" && r.target?.id === promoted.data.assignment.id,
    ),
  ).toHaveLength(0);
  const [proofs] = await control.query<RowDataPacket[]>(
    "SELECT id FROM qualification_promotions WHERE source_assignment_id=?",
    [Buffer.from(assigned.data.assignment.id)],
  );
  const proofId = proofs[0]?.id;
  if (!Buffer.isBuffer(proofId)) throw Error("SYNTHETIC_PROMOTION_PROOF_MISSING");
  const proof = proofId.toString();
  await control.execute(
    "INSERT INTO qualification_promotion_reviews (promotion_id,review_required,version,checked_revision,checked_at) VALUES (?,1,1,1,UTC_TIMESTAMP(3))",
    [Buffer.from(proof)],
  );
  const alert: DomainEvent = {
    eventId: newId(),
    type: "promotion.review_required",
    schemaVersion: 1,
    aggregate: { kind: "qualification", id: proof, version: 1 },
    occurredAt: iso(),
    correlationId: newId(),
    causationId: null,
    data: { userId: person.actor.userId, assignmentId: assigned.data.assignment.id },
  };
  await unit.run((tx) =>
    createOutbox(unit, { notifications: true }).append(tx, {
      ...alert,
      eventId: newId(),
      data: { userId: person.actor.userId, assignmentId: promoted.data.assignment.id },
    }),
  );
  await drain();
  expect(
    (await service.poll(person.actor)).items.filter(
      (r) => r.category === "promotion.review_required",
    ),
  ).toHaveLength(0);
  await unit.run((tx) => createOutbox(unit, { notifications: true }).append(tx, alert));
  await drain();
  expect(
    (await service.poll(person.actor)).items.filter(
      (r) => r.category === "promotion.review_required",
    ),
  ).toHaveLength(1);
  expect(
    (await service.poll(director)).items.some((r) => r.category === "promotion.review_required"),
  ).toBe(true);
  expect(
    (await service.poll(observer)).items.some((r) => r.category === "promotion.review_required"),
  ).toBe(false);
  await control.execute(
    "UPDATE qualification_promotion_reviews SET review_required=0,version=2 WHERE promotion_id=?",
    [Buffer.from(proof)],
  );
  await unit.run((tx) =>
    createOutbox(unit, { notifications: true }).append(tx, { ...alert, eventId: newId() }),
  );
  await drain();
  expect(
    (await service.poll(person.actor)).items.filter(
      (r) => r.category === "promotion.review_required",
    ),
  ).toHaveLength(1);
});

test("notification qualification reads fail visibly without creating missing business state", async () => {
  const person = await member(),
    current = await qualifications.progress(person.actor, person.actor.userId, "ets2", "owner");
  await control.execute("DELETE FROM qualification_states WHERE user_id=? AND game='ets2'", [
    Buffer.from(person.actor.userId),
  ]);
  await expect(
    unit.run(async (tx) => {
      await identity.notificationContextInTransaction(tx);
      return qualifications.notificationAssignmentInTransaction(tx, current.data.assignment.id);
    }),
  ).rejects.toThrow("NOTIFICATION_QUALIFICATION_STATE_MISSING");
  const [states] = await control.query<RowDataPacket[]>(
    "SELECT COUNT(*) n FROM qualification_states WHERE user_id=? AND game='ets2'",
    [Buffer.from(person.actor.userId)],
  );
  expect(Number(states[0]?.n)).toBe(0);
});
test("disabled event mutations filter obsolete unread generations immediately before maintenance", async () => {
  const { id, input } = await participating();
  await service.maintenance();
  await drain();
  const reminder = (await service.poll(owner)).items.find((r) => r.category === "event.reminder");
  expect(reminder).toBeDefined();
  for (let n = 0; n < 3; n++) await receive();
  await drain();
  const disabled = createEvents(unit, { cursorKey: key() }, { identity }, now),
    updated = { ...input, startsAt: new Date(instant + 7200000).toISOString() };
  await disabled.update(director, id, newId(), 1, updated);
  const [retained] = await control.query<RowDataPacket[]>(
    "SELECT invalidated_at FROM notifications WHERE id=?",
    [Buffer.from(reminder?.id as string)],
  );
  expect(retained[0]?.invalidated_at).toBeNull();
  expect((await service.poll(owner, { limit: 1 })).unreadCount).toBe(3);
  await expect(service.read(owner, reminder?.id as string, newId())).rejects.toMatchObject({
    statusCode: 404,
  });
  instant += 3600000;
  await service.maintenance();
  await control.query(
    "UPDATE durable_jobs SET available_at=UTC_TIMESTAMP(3) WHERE CAST(kind AS CHAR)='notifications.remind' AND state='ready'",
  );
  await drain();
  const before = await service.poll(owner);
  expect(before.items.some((r) => r.category === "event.reminder")).toBe(true);
  const response = await events.myResponse(owner, id);
  await disabled.respond(owner, id, newId(), response.version, {
    response: "declined",
    reason: "Fictional confidential scheduling reason",
  });
  expect((await service.poll(owner, { limit: 1 })).unreadCount).toBe(before.unreadCount - 1);
  const declined = await events.myResponse(owner, id);
  await disabled.respond(owner, id, newId(), declined.version, { response: "participating" });
  await service.maintenance();
  // The service clock advanced one hour; queue claims deliberately retain the real DB clock.
  await control.query(
    "UPDATE durable_jobs SET available_at=UTC_TIMESTAMP(3) WHERE CAST(kind AS CHAR)='notifications.remind' AND state='ready'",
  );
  await drain();
  const current = await service.poll(owner);
  expect(current.items.some((r) => r.category === "event.reminder")).toBe(true);
  await disabled.cancel(director, id, newId(), 2, "Fictional cancelled while delivery disabled");
  expect((await service.poll(owner, { limit: 1 })).unreadCount).toBe(current.unreadCount - 1);
  expect((await service.history(owner)).items.some((r) => r.category === "event.reminder")).toBe(
    false,
  );
});

test("read reminder history survives time changes, declined RSVP, cancellation and expiry", async () => {
  const { id, input } = await participating();
  await service.maintenance();
  await drain();
  const reminder = (await service.poll(owner)).items.find((r) => r.category === "event.reminder");
  if (!reminder) throw Error("SYNTHETIC_READ_REMINDER_MISSING");
  await service.read(owner, reminder.id, newId());
  await events.update(director, id, newId(), 1, {
    ...input,
    startsAt: new Date(instant + 7200000).toISOString(),
  });
  const response = await events.myResponse(owner, id);
  await events.respond(owner, id, newId(), response.version, {
    response: "declined",
    reason: "Fictional private historical decline reason",
  });
  await events.cancel(director, id, newId(), 2, "Fictional historical cancellation");
  instant += 10800000;
  const history = await service.history(owner),
    retained = history.items.find((r) => r.id === reminder.id);
  expect(retained?.readAt).toBeTruthy();
  expect(retained?.liveToastEligible).toBe(false);
  expect((await service.poll(owner)).unreadCount).toBe(0);
  const [saved] = await control.query<RowDataPacket[]>(
    "SELECT invalidated_at FROM notifications WHERE id=?",
    [Buffer.from(reminder.id)],
  );
  expect(saved[0]?.invalidated_at).toBeNull();
  expect(JSON.stringify(history)).not.toContain("private historical");
});

test.each([false, true])(
  "cosmetic reminder edits preserve delivery identity (read=%s)",
  async (read) => {
    const { id, input } = await participating();
    await service.maintenance();
    await drain();
    const reminder = (await service.poll(owner)).items.find((r) => r.category === "event.reminder");
    if (!reminder) throw Error("SYNTHETIC_COSMETIC_REMINDER_MISSING");
    if (read) await service.read(owner, reminder.id, newId());
    const disabled = createEvents(unit, { cursorKey: key() }, { identity }, now),
      writers = read ? [events, disabled] : [disabled, events];
    for (const [index, writer] of writers.entries()) {
      await writer.update(director, id, newId(), index + 1, {
        ...input,
        title: `Fictional cosmetic title ${index}`,
        description: `Fictional cosmetic description ${index}`,
      });
      await service.maintenance();
      await drain();
      const history = await service.history(owner),
        saved = history.items.filter((r) => r.category === "event.reminder");
      expect(saved.map((r) => r.id)).toEqual([reminder.id]);
      expect(Boolean(saved[0]?.readAt)).toBe(read);
      expect((await service.poll(owner)).unreadCount).toBe(read ? 0 : 1);
      const [rows] = await control.query<RowDataPacket[]>(
        "SELECT COUNT(*) n FROM notifications WHERE recipient_id=? AND subject_id=? AND category='event.reminder'",
        [Buffer.from(owner.userId), Buffer.from(id)],
      );
      expect(Number(rows[0]?.n)).toBe(1);
    }
    await disabled.update(director, id, newId(), 3, {
      ...input,
      route: "Fictional revised route while delivery is disabled",
    });
    expect((await service.poll(owner)).items.some((r) => r.id === reminder.id)).toBe(true);
    await service.maintenance();
    await drain();
    const afterRoute = await service.history(owner);
    expect(
      afterRoute.items.filter((r) => r.category === "event.reminder").map((r) => r.id),
    ).toEqual([reminder.id]);
    expect(afterRoute.items.filter((r) => r.category === "event.route_changed")).toHaveLength(1);
    expect((await service.poll(owner)).unreadCount).toBe(read ? 1 : 2);
  },
);

test("fanout commits at most 25 recipients per page and persists continuation with each effect", async () => {
  const credential = await identity.prepareCredential(password);
  for (let n = 0; n < 27; n++) {
    const id = newId();
    await unit.run((tx) =>
      identity.insertWithCredential(tx, {
        userId: id,
        email: `${id}@example.invalid`,
        name: "Fictional Fanout Driver",
        ...credential,
        roles: ["driver"],
      }),
    );
  }
  const [members] = await control.query<RowDataPacket[]>(
    "SELECT COUNT(*) n FROM identity_memberships WHERE status='active'",
  );
  await receive();
  const q = queue();
  expect(await q.route()).toBe(1);
  const first = await q.claim();
  if (!first) throw Error("SYNTHETIC_FANOUT_CLAIM_MISSING");
  await q.execute(first);
  const [page] = await control.query<RowDataPacket[]>(
    "SELECT (SELECT COUNT(*) FROM notifications) messages,(SELECT COUNT(*) FROM job_effect_receipts) receipts,(SELECT COUNT(*) FROM durable_jobs WHERE state='ready') continuations",
  );
  expect(Number(page[0]?.messages)).toBe(25);
  expect(Number(page[0]?.receipts)).toBe(1);
  expect(Number(page[0]?.continuations)).toBe(1);
  await drain(q);
  const [final] = await control.query<RowDataPacket[]>(
    "SELECT COUNT(*) messages,COUNT(DISTINCT recipient_id) recipients,MIN(sequence) first_sequence,MAX(sequence) last_sequence FROM notifications",
  );
  expect(Number(final[0]?.messages)).toBe(Number(members[0]?.n));
  expect(Number(final[0]?.recipients)).toBe(Number(members[0]?.n));
  expect([Number(final[0]?.first_sequence), Number(final[0]?.last_sequence)]).toEqual([1, 1]);
  expect(await q.route()).toBe(0);
  console.log(
    JSON.stringify({
      event: "notifications_fanout_work",
      pageBound: 25,
      recipients: Number(members[0]?.n),
      firstPage: 25,
      duplicateEffects: 0,
    }),
  );
});

test("manual review notifications require the current revision or pending correction and filter private state", async () => {
  const saved = await receive(),
    report = newId(),
    older = newId(),
    current = newId(),
    correction = newId();
  // Retained owning-module fixture: notification consumption reads references, never report fields.
  await control.execute("UPDATE trips SET decision='pending_review' WHERE id=?", [
    Buffer.from(saved.tripId),
  ]);
  await control.execute(
    "INSERT INTO manual_reports (id,owner_id,trip_id,version,current_revision_id,revision_number,created_at) VALUES (?,?,?,2,NULL,2,UTC_TIMESTAMP(3))",
    [Buffer.from(report), Buffer.from(owner.userId), Buffer.from(saved.tripId)],
  );
  for (const [id, number] of [
    [older, 1],
    [current, 2],
  ] as const)
    await control.execute(
      "INSERT INTO manual_revisions (id,report_id,number,format,fields,submitted_at) VALUES (?,?,?,'legacy',?,UTC_TIMESTAMP(3))",
      [
        Buffer.from(id),
        Buffer.from(report),
        number,
        JSON.stringify({ note: "Fictional private report fields" }),
      ],
    );
  await control.execute("UPDATE manual_reports SET current_revision_id=? WHERE id=?", [
    Buffer.from(current),
    Buffer.from(report),
  ]);
  await control.execute(
    "INSERT INTO manual_correction_requests (id,owner_id,trip_id,base_trip_version,base_revision_id,reason,status,requested_at) VALUES (?,?,?,1,?,?,'pending',UTC_TIMESTAMP(3))",
    [
      Buffer.from(correction),
      Buffer.from(owner.userId),
      Buffer.from(saved.tripId),
      Buffer.from(current),
      "Fictional private correction reason",
    ],
  );
  function review(resourceId: string, version: number): ManualEvent {
    return {
      eventId: newId(),
      type: "manual.report_submitted",
      schemaVersion: 1,
      aggregate: { kind: "manual_report", id: report, version },
      occurredAt: iso(),
      correlationId: newId(),
      causationId: null,
      data: { resourceId, tripId: saved.tripId },
    };
  }
  const request: DomainEvent = {
    ...review(correction, 1),
    type: "manual.correction_requested",
    aggregate: { kind: "trip", id: saved.tripId, version: 1 },
  };
  await unit.run(async (tx) => {
    const outbox = createOutbox(unit, { notifications: true });
    await outbox.append(tx, review(older, 1));
    await outbox.append(tx, review(current, 2));
    await outbox.append(tx, request);
  });
  await drain();
  const categories = (rows: S["Notification"][]) =>
    rows
      .filter((r) => ["trip.review_required", "trip.correction_requested"].includes(r.category))
      .map((r) => r.category)
      .sort();
  expect(categories((await service.poll(owner)).items)).toEqual([
    "trip.correction_requested",
    "trip.review_required",
  ]);
  expect(categories((await service.poll(dispatcher)).items)).toEqual([
    "trip.correction_requested",
    "trip.review_required",
  ]);
  expect(categories((await service.poll(observer)).items)).toEqual([]);
  expect(JSON.stringify(await service.history(owner))).not.toContain("private");
  await control.execute("UPDATE manual_correction_requests SET status='resolved' WHERE id=?", [
    Buffer.from(correction),
  ]);
  await unit.run((tx) =>
    createOutbox(unit, { notifications: true }).append(tx, { ...request, eventId: newId() }),
  );
  await drain();
  expect(categories((await service.poll(owner)).items)).toHaveLength(2);
});
