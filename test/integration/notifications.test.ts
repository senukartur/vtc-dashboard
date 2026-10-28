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
async function repairOneMaterial() {
  return unit.run(async (tx) => {
    await identity.notificationContextInTransaction(tx);
    return events.repairPendingNotificationMaterialInTransaction(tx);
  });
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

test.each([
  ["start", "before"],
  ["route", "before"],
  ["start", "between-pages"],
  ["route", "between-pages"],
  ["start", "disabled"],
  ["route", "disabled"],
] as const)("material %s survives a cosmetic successor (%s)", async (kind, stage) => {
  const { id, input } = await participating();
  const audience = [owner, observer];
  if (stage === "between-pages") {
    const credential = await identity.prepareCredential(password);
    for (let index = 0; index < 25; index++) {
      const userId = newId(),
        email = `${userId}@example.invalid`;
      await unit.run((tx) =>
        identity.insertWithCredential(tx, {
          userId,
          email,
          name: "Fictional Material Change Participant",
          ...credential,
          roles: ["driver"],
        }),
      );
      const login = await identity.login(email, password);
      audience.push(
        await identity.authenticate(
          new Headers({ cookie: login.cookies.map((c) => c.split(";", 1)[0]).join("; ") }),
        ),
      );
    }
  }
  for (const participant of audience.slice(1)) {
    const current = await events.myResponse(participant, id);
    await events.respond(participant, id, newId(), current.version, { response: "participating" });
  }
  await drain();
  const writer =
    stage === "disabled" ? createEvents(unit, { cursorKey: key() }, { identity }, now) : events;
  const material =
    kind === "start"
      ? { ...input, startsAt: new Date(instant + 4200000).toISOString() }
      : {
          ...input,
          route: "Fictional Material Route",
          meetingLocation: "Fictional Material Meeting",
        };
  await writer.update(director, id, newId(), 1, material);
  const q = queue();
  let firstPageRecipient: Actor | undefined;
  if (stage === "between-pages") {
    expect(await q.route()).toBe(1);
    const claim = await q.claim();
    if (!claim) throw Error("SYNTHETIC_MATERIAL_CLAIM_MISSING");
    await q.execute(claim);
    const [prepared] = await control.query<RowDataPacket[]>(
      "SELECT COUNT(*) n FROM notifications WHERE subject_id=? AND category=?",
      [Buffer.from(id), `event.${kind === "start" ? "start" : "route"}_changed`],
    );
    expect(Number(prepared[0]?.n)).toBe(0);
    const delivery = await q.claim();
    if (!delivery) throw Error("SYNTHETIC_MATERIAL_DELIVERY_MISSING");
    expect(delivery.reference).toMatchObject({ phase: "deliver", after: null });
    await q.execute(delivery);
    const [page] = await control.query<RowDataPacket[]>(
      "SELECT CAST(recipient_id AS CHAR) recipientId FROM notifications WHERE subject_id=? AND category=? ORDER BY recipient_id",
      [Buffer.from(id), `event.${kind === "start" ? "start" : "route"}_changed`],
    );
    expect(page).toHaveLength(25);
    firstPageRecipient = audience.find((actor) => actor.userId === page[0]?.recipientId);
    expect(firstPageRecipient).toBeDefined();
    const [continuations] = await control.query<RowDataPacket[]>(
      "SELECT COUNT(*) n FROM durable_jobs WHERE state='ready'",
    );
    expect(Number(continuations[0]?.n)).toBe(1);
  }
  const lateParticipant = (await member()).actor;
  const late = await events.myResponse(lateParticipant, id);
  await writer.respond(lateParticipant, id, newId(), late.version, { response: "participating" });
  const cosmetic = {
    ...material,
    title: "Fictional Current Cosmetic Title",
    description: "Fictional cosmetic successor",
  };
  await writer.update(director, id, newId(), 2, cosmetic);
  await drain(q);
  const category = `event.${kind === "start" ? "start" : "route"}_changed`;
  const [effects] = await control.query<RowDataPacket[]>(
    "SELECT CAST(recipient_id AS CHAR) recipientId,CAST(effect_key AS CHAR) effectKey FROM notifications WHERE subject_id=? AND category=? ORDER BY recipient_id",
    [Buffer.from(id), category],
  );
  expect(effects.map((r) => r.recipientId).sort()).toEqual(audience.map((a) => a.userId).sort());
  expect(new Set(effects.map((r) => r.effectKey))).toEqual(new Set([`event:${id}:2`]));
  expect(
    (await service.poll(lateParticipant)).items.filter(
      (r) => r.target?.id === id && r.category === category,
    ),
  ).toEqual([]);
  const projected = (await service.poll(firstPageRecipient ?? owner)).items.filter(
    (r) => r.target?.id === id && r.category === category,
  );
  expect(projected).toHaveLength(1);
  expect(projected[0]?.display.eventTitle).toBe(cosmetic.title);
  expect(projected[0]?.liveToastEligible).toBe(true);
  await drain(q);
  const [replayed] = await control.query<RowDataPacket[]>(
    "SELECT COUNT(*) n FROM notifications WHERE subject_id=? AND category=?",
    [Buffer.from(id), category],
  );
  expect(Number(replayed[0]?.n)).toBe(audience.length);
});

test.each([
  ["start", false],
  ["route", false],
  ["start", true],
  ["route", true],
] as const)(
  "newer material %s suppresses obsolete live alerts (already inserted=%s)",
  async (kind, inserted) => {
    const { id, input } = await participating();
    await drain();
    const first =
      kind === "start"
        ? { ...input, startsAt: new Date(instant + 4200000).toISOString() }
        : { ...input, route: "Fictional first changed route" };
    await events.update(director, id, newId(), 1, first);
    if (inserted) await drain();
    const next =
      kind === "start"
        ? { ...first, startsAt: new Date(instant + 4800000).toISOString() }
        : { ...first, route: "Fictional next changed route" };
    await events.update(director, id, newId(), 2, next);
    const category = `event.${kind === "start" ? "start" : "route"}_changed`;
    if (inserted) {
      const old = (await service.poll(owner)).items.filter((r) => r.category === category);
      expect(old).toHaveLength(1);
      expect(old[0]?.liveToastEligible).toBe(false);
    }
    await events.update(director, id, newId(), 3, {
      ...next,
      title: "Fictional Latest Material Title",
    });
    await drain();
    const rows = (await service.poll(owner)).items.filter((r) => r.category === category);
    expect(rows).toHaveLength(inserted ? 2 : 1);
    expect(rows.filter((r) => r.liveToastEligible)).toHaveLength(1);
    expect(rows.every((r) => r.display.eventTitle === "Fictional Latest Material Title")).toBe(
      true,
    );
  },
);

test.each([
  ["start", false],
  ["route", false],
  ["start", true],
  ["route", true],
] as const)(
  "material reversion %s does not revive an older transition (already inserted=%s)",
  async (kind, inserted) => {
    const { id, input } = await participating();
    await drain();
    const first =
      kind === "start"
        ? { ...input, startsAt: new Date(instant + 4200000).toISOString() }
        : { ...input, route: "Fictional reverted route" };
    await events.update(director, id, newId(), 1, first);
    if (inserted) await drain();
    const category = `event.${kind === "start" ? "start" : "route"}_changed`;
    const old = (await service.poll(owner)).items.find((row) => row.category === category);
    expect(Boolean(old)).toBe(inserted);
    const intermediate =
      kind === "start"
        ? { ...first, startsAt: new Date(instant + 4800000).toISOString() }
        : { ...first, route: "Fictional intermediate route" };
    await events.update(director, id, newId(), 2, intermediate);
    await events.update(director, id, newId(), 3, first);
    await events.update(director, id, newId(), 4, {
      ...first,
      title: "Fictional Current Reverted Material",
    });
    if (old) {
      const current = (await service.poll(owner)).items.find((row) => row.id === old.id);
      expect(current?.liveToastEligible).toBe(false);
      expect((await service.history(owner)).items.some((row) => row.id === old.id)).toBe(true);
    }
    await drain();
    const rows = (await service.poll(owner)).items.filter((row) => row.category === category);
    expect(rows).toHaveLength(inserted ? 2 : 1);
    expect(rows.filter((row) => row.liveToastEligible)).toHaveLength(1);
    expect(
      rows.every((row) => row.display.eventTitle === "Fictional Current Reverted Material"),
    ).toBe(true);
    const [effects] = await control.query<RowDataPacket[]>(
      "SELECT subject_version FROM notifications WHERE subject_id=? AND recipient_id=? AND category=? ORDER BY subject_version",
      [Buffer.from(id), Buffer.from(owner.userId), category],
    );
    expect(effects.map((row) => Number(row.subject_version))).toEqual(inserted ? [2, 4] : [4]);
    await drain();
    expect(
      (await service.poll(owner)).items.filter((row) => row.category === category),
    ).toHaveLength(rows.length);
  },
);

test("material maintenance discovers legacy state after permanent jobs and reminder markers completed", async () => {
  const { id, input } = await participating();
  await drain();
  await service.maintenance();
  const [completed] = await control.query<RowDataPacket[]>(
    "SELECT COUNT(*) n FROM durable_jobs WHERE kind='notifications.deliver' AND state='completed'",
  );
  expect(Number(completed[0]?.n)).toBeGreaterThan(0);
  await control.execute(
    "UPDATE events SET notification_material=NULL,notification_pending=0 WHERE id=?",
    [Buffer.from(id)],
  );
  const first = await repairOneMaterial();
  expect(first).toMatchObject({ eventId: id, complete: true, throughVersion: 1, scanned: 1 });
  const [before] = await control.query<RowDataPacket[]>(
    "SELECT notification_material material FROM events WHERE id=?",
    [Buffer.from(id)],
  );
  await events.update(director, id, newId(), 1, {
    ...input,
    route: "Fictional Legacy Producer Route",
  });
  await drain();
  // Emulate the prior writer's unchanged derived column after its real immutable command/job history.
  await control.execute(
    "UPDATE events SET notification_material=?,notification_pending=0 WHERE id=?",
    [JSON.stringify(before[0]?.material), Buffer.from(id)],
  );
  const [stale] = await control.query<RowDataPacket[]>(
    "SELECT notification_material_pending pending,notification_pending reminders FROM events WHERE id=?",
    [Buffer.from(id)],
  );
  expect(Number(stale[0]?.pending)).toBe(1);
  expect(Number(stale[0]?.reminders)).toBe(0);
  await service.maintenance();
  const [fixed] = await control.query<RowDataPacket[]>(
    "SELECT notification_material material,notification_material_pending pending,notification_pending reminders FROM events WHERE id=?",
    [Buffer.from(id)],
  );
  expect(fixed[0]?.material).toMatchObject({
    schemaVersion: 1,
    throughVersion: 2,
    routeVersion: 2,
    startVersion: 1,
  });
  expect(Number(fixed[0]?.pending)).toBe(0);
  expect(Number(fixed[0]?.reminders)).toBe(0);
  expect(await repairOneMaterial()).toBeNull();
});

test("material prefix repair is bounded, rolls back and advances monotonically with two workers", async () => {
  const { id, input } = await participating();
  await drain();
  for (let version = 2; version <= 27; version++)
    await events.update(director, id, newId(), version - 1, {
      ...input,
      description: `Fictional retained revision ${version}`,
    });
  await drain();
  await control.execute(
    "UPDATE events SET notification_material=NULL,notification_pending=0 WHERE id=?",
    [Buffer.from(id)],
  );
  await expect(
    unit.run(async (tx) => {
      await identity.notificationContextInTransaction(tx);
      expect(await events.repairPendingNotificationMaterialInTransaction(tx)).toMatchObject({
        throughVersion: 25,
        complete: false,
        scanned: 25,
      });
      throw new Error("SYNTHETIC_MATERIAL_REPAIR_ROLLBACK");
    }),
  ).rejects.toThrow("SYNTHETIC_MATERIAL_REPAIR_ROLLBACK");
  const [rolledBack] = await control.query<RowDataPacket[]>(
    "SELECT notification_material material FROM events WHERE id=?",
    [Buffer.from(id)],
  );
  expect(rolledBack[0]?.material).toBeNull();
  const raced = await Promise.all([repairOneMaterial(), repairOneMaterial()]);
  const final = await repairOneMaterial();
  const batches = [...raced, final].filter((r) => r !== null);
  expect(batches.reduce((sum, r) => sum + r.scanned, 0)).toBe(27);
  expect(batches.every((r) => r.scanned <= 25)).toBe(true);
  expect(new Set(batches.map((r) => r.throughVersion)).size).toBe(batches.length);
  const [stored] = await control.query<RowDataPacket[]>(
    "SELECT notification_material material,notification_material_pending pending FROM events WHERE id=?",
    [Buffer.from(id)],
  );
  expect(stored[0]?.material).toEqual({
    schemaVersion: 1,
    throughVersion: 27,
    startVersion: 1,
    routeVersion: 1,
    statusVersion: 1,
  });
  expect(Number(stored[0]?.pending)).toBe(0);
  expect(await repairOneMaterial()).toBeNull();
  console.log(
    JSON.stringify({
      event: "notification_material_repair_work",
      revisions: 27,
      batches: batches.map((r) => r.scanned),
      maxBatch: 25,
      rollbackPreserved: true,
    }),
  );
});

test("material preparation rejects corrupt state and gaps without publishing a partial prefix", async () => {
  const { id, input } = await participating();
  await drain();
  await control.execute("UPDATE events SET notification_material=? WHERE id=?", [
    JSON.stringify({
      schemaVersion: 2,
      throughVersion: 1,
      startVersion: 1,
      routeVersion: 1,
      statusVersion: 1,
    }),
    Buffer.from(id),
  ]);
  await expect(repairOneMaterial()).rejects.toThrow("EVENT_NOTIFICATION_MATERIAL_INVALID");
  await control.execute("UPDATE events SET notification_material=NULL WHERE id=?", [
    Buffer.from(id),
  ]);
  await events.update(director, id, newId(), 1, { ...input, title: "Fictional Gap Two" });
  await events.update(director, id, newId(), 2, { ...input, title: "Fictional Gap Three" });
  // Failure injection removes only this fixture's unreferenced intermediate immutable definition.
  await control.execute("DELETE FROM event_revisions WHERE event_id=? AND version=2", [
    Buffer.from(id),
  ]);
  await expect(repairOneMaterial()).rejects.toThrow("EVENT_NOTIFICATION_MATERIAL_HISTORY_INVALID");
  const [rows] = await control.query<RowDataPacket[]>(
    "SELECT notification_material material,notification_material_pending pending FROM events WHERE id=?",
    [Buffer.from(id)],
  );
  expect(rows[0]?.material).toBeNull();
  expect(Number(rows[0]?.pending)).toBe(1);
});

test("material preparation and its delivery continuation commit or roll back together", async () => {
  const { id, input } = await participating();
  await drain();
  await events.update(director, id, newId(), 1, { ...input, route: "Fictional Atomic Material" });
  await control.execute("UPDATE events SET notification_material=NULL WHERE id=?", [
    Buffer.from(id),
  ]);
  const q = queue();
  await q.route();
  const claim = await q.claim();
  if (!claim) throw Error("SYNTHETIC_MATERIAL_ATOMIC_CLAIM_MISSING");
  const reference = claim.reference as { eventId: string };
  const deliveryCount = async () => {
    const [rows] = await control.query<RowDataPacket[]>(
      "SELECT COUNT(*) n FROM durable_jobs WHERE JSON_UNQUOTE(JSON_EXTRACT(reference,'$.eventId'))=? AND JSON_UNQUOTE(JSON_EXTRACT(reference,'$.phase'))='deliver'",
      [reference.eventId],
    );
    return Number(rows[0]?.n);
  };
  await expect(
    unit.run(async (tx) => {
      await service.handler.local?.(tx, claim.reference, claim);
      throw new Error("SYNTHETIC_MATERIAL_CONTINUATION_ROLLBACK");
    }),
  ).rejects.toThrow("SYNTHETIC_MATERIAL_CONTINUATION_ROLLBACK");
  const [rolledBack] = await control.query<RowDataPacket[]>(
    "SELECT notification_material material FROM events WHERE id=?",
    [Buffer.from(id)],
  );
  expect(rolledBack[0]?.material).toBeNull();
  expect(await deliveryCount()).toBe(0);
  expect(await q.receipt("notifications.v1", claim.effectKey.toString())).toBeNull();
  await q.execute(claim);
  expect(await deliveryCount()).toBe(1);
  const [timestamps] = await control.query<RowDataPacket[]>(
    "SELECT COUNT(*) total,COALESCE(SUM(j.available_at<>o.recorded_at),0) mismatches FROM durable_jobs j INNER JOIN outbox_events o ON JSON_UNQUOTE(JSON_EXTRACT(j.reference,'$.eventId'))=CAST(o.id AS CHAR) WHERE JSON_UNQUOTE(JSON_EXTRACT(j.reference,'$.eventId'))=? AND JSON_UNQUOTE(JSON_EXTRACT(j.reference,'$.phase'))='deliver'",
    [reference.eventId],
  );
  expect(Number(timestamps[0]?.total)).toBe(1);
  expect(Number(timestamps[0]?.mismatches)).toBe(0);
  expect((await service.poll(owner)).items.some((r) => r.category === "event.route_changed")).toBe(
    false,
  );
  await drain(q);
  expect(
    (await service.poll(owner)).items.filter((r) => r.category === "event.route_changed"),
  ).toHaveLength(1);
  await drain(q);
  expect(await deliveryCount()).toBe(1);
});

test("material generated discovery rejects coercion and uses its index among healthy events", async () => {
  const { id, input } = await participating();
  await drain();
  const valid = {
    schemaVersion: 1,
    throughVersion: 1,
    startVersion: 1,
    routeVersion: 1,
    statusVersion: 1,
  };
  for (const value of [
    null,
    {},
    { ...valid, throughVersion: null },
    { ...valid, throughVersion: "1" },
    { ...valid, throughVersion: true },
    { ...valid, throughVersion: 0 },
    { ...valid, throughVersion: 1.5 },
    { ...valid, schemaVersion: 2 },
    { ...valid, startVersion: 2 },
    { ...valid, extra: 1 },
  ]) {
    await control.execute("UPDATE events SET notification_material=CAST(? AS JSON) WHERE id=?", [
      JSON.stringify(value),
      Buffer.from(id),
    ]);
    const [rows] = await control.query<RowDataPacket[]>(
      "SELECT notification_material_pending pending FROM events WHERE id=?",
      [Buffer.from(id)],
    );
    expect(Number(rows[0]?.pending)).toBe(1);
  }
  // JSON Schema/Number.isInteger accept the numeric value 1.0; strings and fractional values do not qualify.
  for (const value of [
    JSON.stringify(valid),
    '{"schemaVersion":1.0,"throughVersion":1.0,"startVersion":1.0,"routeVersion":1.0,"statusVersion":1.0}',
  ]) {
    await control.execute("UPDATE events SET notification_material=CAST(? AS JSON) WHERE id=?", [
      value,
      Buffer.from(id),
    ]);
    const [rows] = await control.query<RowDataPacket[]>(
      "SELECT notification_material_pending pending FROM events WHERE id=?",
      [Buffer.from(id)],
    );
    expect(Number(rows[0]?.pending)).toBe(0);
  }
  const copies = JSON.stringify(
    Array.from({ length: 1000 }, () => ({ id: newId(), revision: newId() })),
  );
  // Representative index fixtures clone a real valid definition; no producer behavior is claimed for these rows.
  await control.execute(
    `INSERT INTO events(id,version,change_sequence,notification_pending,notification_material,trip_assessment_pending,trip_assessment_generation,attendance_version,current_revision_id,game,visibility,status,starts_at,created_at)
    SELECT fixture.id,1,1,0,JSON_OBJECT('schemaVersion',1,'throughVersion',1,'startVersion',1,'routeVersion',1,'statusVersion',1),0,0,1,fixture.revision,e.game,e.visibility,e.status,e.starts_at,e.created_at
    FROM JSON_TABLE(?, '$[*]' COLUMNS(id CHAR(36) PATH '$.id',revision CHAR(36) PATH '$.revision')) fixture CROSS JOIN events e WHERE e.id=?`,
    [copies, Buffer.from(id)],
  );
  await control.execute(
    `INSERT INTO event_revisions(id,event_id,version,sequence,actor_id,recorded_at,category,status,title,description,game,server,organizer,meeting_location,route,meeting_at,starts_at,ends_at,visibility,prescribed_mass_kg,private_reason)
    SELECT fixture.revision,fixture.id,1,1,r.actor_id,r.recorded_at,'created',r.status,r.title,r.description,r.game,r.server,r.organizer,r.meeting_location,r.route,r.meeting_at,r.starts_at,r.ends_at,r.visibility,r.prescribed_mass_kg,NULL
    FROM JSON_TABLE(?, '$[*]' COLUMNS(id CHAR(36) PATH '$.id',revision CHAR(36) PATH '$.revision')) fixture CROSS JOIN event_revisions r WHERE r.event_id=? AND r.version=1`,
    [copies, Buffer.from(id)],
  );
  await control.execute(
    "UPDATE events SET notification_material=NULL,notification_pending=0 WHERE id=?",
    [Buffer.from(id)],
  );
  await control.query("ANALYZE TABLE events");
  const [plan] = await control.query<RowDataPacket[]>(
    "EXPLAIN SELECT * FROM events WHERE notification_material_pending=1 ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED",
  );
  expect(plan[0]?.key).toBe("event_notification_material_pending");
  const [actual] = await control.query<RowDataPacket[]>(
    "EXPLAIN ANALYZE SELECT * FROM events WHERE notification_material_pending=1 ORDER BY id LIMIT 1",
  );
  const text = String(Object.values(actual[0] ?? {})[0]);
  const examined = [...text.matchAll(/actual time=[^\n]*?rows=(\d+) loops=(\d+)/g)].map((m) => ({
    rows: Number(m[1]),
    loops: Number(m[2]),
  }));
  expect(examined.length).toBeGreaterThan(0);
  expect(examined.every((r) => r.rows <= 1 && r.loops === 1)).toBe(true);
  expect(await repairOneMaterial()).toMatchObject({ eventId: id, complete: true, scanned: 1 });
  expect(await repairOneMaterial()).toBeNull();
  await events.update(director, id, newId(), 1, { ...input, route: "Fictional Projection Route" });
  // Substantial representative cosmetic history tests query work, not the producer command path.
  const cosmetics = Array.from({ length: 2000 }, (_, n) => ({ id: newId(), version: n + 3 }));
  await control.execute(
    `INSERT INTO event_revisions(id,event_id,version,sequence,actor_id,recorded_at,category,status,title,description,game,server,organizer,meeting_location,route,meeting_at,starts_at,ends_at,visibility,prescribed_mass_kg,private_reason)
    SELECT fixture.id,r.event_id,fixture.version,r.sequence+fixture.version-r.version,r.actor_id,r.recorded_at,'updated',r.status,'Fictional Projection Cosmetic',r.description,r.game,r.server,r.organizer,r.meeting_location,r.route,r.meeting_at,r.starts_at,r.ends_at,r.visibility,r.prescribed_mass_kg,NULL
    FROM JSON_TABLE(?, '$[*]' COLUMNS(id CHAR(36) PATH '$.id',version INT PATH '$.version')) fixture CROSS JOIN event_revisions r WHERE r.event_id=? AND r.version=2`,
    [JSON.stringify(cosmetics), Buffer.from(id)],
  );
  await control.execute(
    "UPDATE events SET version=2002,change_sequence=change_sequence+2000,current_revision_id=?,notification_material=JSON_OBJECT('schemaVersion',1,'throughVersion',2002,'startVersion',1,'routeVersion',2,'statusVersion',1) WHERE id=?",
    [Buffer.from(cosmetics.at(-1)?.id as string), Buffer.from(id)],
  );
  const versions = Array.from({ length: 100 }, (_, n) => n + 2);
  const projected = await unit.run(async (tx) => {
    await identity.notificationContextInTransaction(tx);
    return events.notificationChangeProjectionsInTransaction(
      tx,
      versions.map((version) => ({ eventId: id, version, category: "event.route_changed" })),
    );
  });
  expect(projected.get(`${id}:2:event.route_changed`)).toMatchObject({
    effective: true,
    title: "Fictional Projection Cosmetic",
  });
  expect(projected.size).toBe(100);
  expect([...projected.values()].filter((row) => row.effective)).toHaveLength(1);
  const projectionQuery = `SELECT e.id,r.version,current_definition.title,e.notification_material FROM events e INNER JOIN event_revisions r ON r.event_id=e.id INNER JOIN event_revisions current_definition ON current_definition.id=e.current_revision_id WHERE ${versions.map(() => "(e.id=? AND r.version=?)").join(" OR ")} ORDER BY e.id,r.version FOR SHARE`,
    projectionParameters = versions.flatMap((version) => [Buffer.from(id), version]);
  const [projectionPlan] = await control.query<RowDataPacket[]>(
    `EXPLAIN ${projectionQuery}`,
    projectionParameters,
  );
  expect(projectionPlan.find((row) => row.table === "r")?.key).toBe("event_revision_version");
  const [projectionActual] = await control.query<RowDataPacket[]>(
    `EXPLAIN ANALYZE ${projectionQuery}`,
    projectionParameters,
  );
  const projectionText = String(Object.values(projectionActual[0] ?? {})[0]),
    projectionWork = [
      ...projectionText.matchAll(/actual time=[^\n]*?rows=([\d.]+) loops=(\d+)/g),
    ].map((m) => Number(m[1]) * Number(m[2]));
  expect(projectionWork.length).toBeGreaterThan(0);
  expect(projectionWork.every((work) => work <= 100)).toBe(true);
  console.log(
    JSON.stringify({
      event: "notification_material_pending_plan",
      healthyEvents: 1000,
      pendingEvents: 1,
      index: plan[0]?.key,
      maxActualRows: Math.max(...examined.map((r) => r.rows)),
      repairedDefinitions: 1,
      projectionIndex: "event_revision_version",
      cosmeticHistory: 2000,
      projectionMaxActualWork: Math.max(...projectionWork),
      projectedDefinitions: projected.size,
    }),
  );
});

test("same-event writers keep combined material anchors atomic and cancellation terminal", async () => {
  const { id, input } = await participating();
  await drain();
  const changed = {
      ...input,
      startsAt: new Date(instant + 4200000).toISOString(),
      route: "Fictional Combined Route",
    },
    cosmetic = { ...input, title: "Fictional Concurrent Title" };
  const results = await Promise.allSettled([
    events.update(director, id, newId(), 1, changed),
    events.update(director, id, newId(), 1, cosmetic),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const conflict = results.find((r) => r.status === "rejected");
  expect(conflict?.status === "rejected" && conflict.reason.statusCode).toBe(412);
  const materialVersion = results[0]?.status === "fulfilled" ? 2 : 3;
  await events.update(director, id, newId(), 2, { ...changed, title: cosmetic.title });
  await events.update(director, id, newId(), 3, {
    ...changed,
    title: cosmetic.title,
    route: "Fictional Final Route",
  });
  await events.update(director, id, newId(), 4, {
    ...changed,
    title: cosmetic.title,
    route: "Fictional Final Route",
    description: "Fictional last cosmetic",
  });
  const [before] = await control.query<RowDataPacket[]>(
    "SELECT notification_material material FROM events WHERE id=?",
    [Buffer.from(id)],
  );
  expect(before[0]?.material).toMatchObject({
    throughVersion: 5,
    startVersion: materialVersion,
    routeVersion: 4,
    statusVersion: 1,
  });
  await drain();
  const live = (await service.poll(owner)).items.filter(
    (r) => r.target?.id === id && r.liveToastEligible,
  );
  expect(live.map((r) => r.category).sort()).toEqual([
    "event.route_changed",
    "event.start_changed",
  ]);
  await events.cancel(director, id, newId(), 5, "Fictional terminal cancellation");
  await expect(events.update(director, id, newId(), 6, changed)).rejects.toMatchObject({
    statusCode: 409,
  });
  await drain();
  const final = (await service.poll(owner)).items.filter((r) => r.target?.id === id);
  expect(final.filter((r) => r.liveToastEligible).map((r) => r.category)).toEqual([
    "event.cancelled",
  ]);
  expect(final).toHaveLength(3);
  expect((await service.history(owner)).items.filter((r) => r.target?.id === id)).toHaveLength(3);
  const [terminal] = await control.query<RowDataPacket[]>(
    "SELECT notification_material material FROM events WHERE id=?",
    [Buffer.from(id)],
  );
  expect(terminal[0]?.material).toEqual({
    schemaVersion: 1,
    throughVersion: 6,
    startVersion: 6,
    routeVersion: 6,
    statusVersion: 6,
  });
});

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
