import { randomBytes } from "node:crypto";
import { createUnitOfWork, newId, runMigrations, type UnitOfWork } from "@vtc/db";
import { catalogCities } from "@vtc/db/catalogs-schema";
import { membership, roles } from "@vtc/db/identity-schema";
import {
  eq,
  sourceMessages,
  sourcePayloads,
  sourceTrips,
  sql,
  tripFacts,
  tripFactTrailers,
  tripHistory,
  trips,
} from "@vtc/db/trips-schema";
import type { Connection, RowDataPacket } from "mysql2/promise";
import {
  beforeEach,
  expect,
  test,
  afterAll as vitestAfterAll,
  beforeAll as vitestBeforeAll,
} from "vitest";
import { createApp } from "../../apps/api/src/app.ts";
import { createCatalogs } from "../../apps/api/src/modules/catalogs/service.ts";
import { createEvents } from "../../apps/api/src/modules/events/service.ts";
import {
  type Actor,
  createIdentity,
  type Identity,
} from "../../apps/api/src/modules/identity/service.ts";
import { canonicalJson } from "../../apps/api/src/modules/sources/contracts/canonical.ts";
import type { NormalizedTripEvidence } from "../../apps/api/src/modules/sources/contracts/evidence.ts";
import type { Telemetry } from "../../apps/api/src/modules/sources/contracts/telemetry.ts";
import { tripSearchCondition } from "../../apps/api/src/modules/trips/list-query.ts";
import {
  createTrips,
  type SourceContext,
  type Trips,
  tripListQuery,
} from "../../apps/api/src/modules/trips/service.ts";
import { createQueue, retryTransaction } from "../../apps/api/src/platform/jobs/queue.ts";
import { runPass } from "../../apps/api/src/platform/jobs/runner.ts";
import { createOutbox, identityAccessEvents } from "../../apps/api/src/platform/outbox/events.ts";
import { catalogConfig, seedCatalog } from "../fixtures/catalogs/synthetic.ts";
import {
  guardedSettings,
  hasCode,
  reset,
  SCHEMA_SETUP_TIMEOUT_MS,
  testConnection,
} from "../persistence/support.ts";
import { telemetryFixture } from "../support/builders.ts";
import { schemaLifecycleHooks } from "../support/schema-lifecycle.ts";

const { beforeAll, afterAll } = schemaLifecycleHooks(vitestBeforeAll, vitestAfterAll);

let control: Connection, unit: UnitOfWork, identity: Identity, service: Trips;
let owner: Actor, other: Actor, staff: Actor, ownerCookie: string, otherCookie: string;
let instant = Date.parse("2026-10-20T12:00:00.000Z");
const now = () => new Date(instant);
const password = "Fictional-trip-passphrase-42",
  config = { cursorKey: randomBytes(32).toString("hex") };
const identityConfig = {
  secret: randomBytes(32).toString("hex"),
  origin: "http://127.0.0.1:4173",
  production: false,
};
const fixture = (kind: "started" | "completed" | "cancelled" | "closed-partial" = "completed") =>
  telemetryFixture(kind) as unknown as Telemetry;
const context = (id = owner.userId): SourceContext => ({
  ownerUserId: id,
  connection: { state: "unknown", referenceId: null },
});
const receive = (p: Telemetry, target = service, ctx = context()) =>
  retryTransaction(unit, (tx) => target.storeInTransaction(tx, "ets2telemetry", p, ctx));
let listed: Promise<{
  catalogs: ReturnType<typeof createCatalogs>;
  trips: Trips;
  rows: Awaited<ReturnType<typeof seedCatalog>>;
}> | null = null;
/** One seeded set of list rows per suite; a telemetry fixture resolves only against these. */
const listedTrips = () => {
  listed ??= (async () => {
    const catalogs = createCatalogs(unit, catalogConfig(), { identity });
    const rows = await seedCatalog(unit, "ets2", {
      cities: [
        { code: "fixture_north", nameEn: "Fictional north" },
        { code: "fixture_south", nameEn: "Fictional south" },
      ],
      cargoes: [
        { code: "fixture_crates", nameEn: "Fictional crates" },
        { code: "fixture_gas", nameEn: "Fictional gas", adrClass: "2" },
      ],
      trailers: [
        { code: "fixture_box", nameEn: "Fictional box" },
        { code: "fixture_hidden_body", nameEn: "Fictional hidden body", hidden: true },
      ],
    });
    return { catalogs, trips: createTrips(unit, config, { identity, catalogs }), rows };
  })();
  return listed;
};
const fresh = () => {
  const p = fixture();
  p.eventId = newId();
  p.source.tripId = newId();
  p.source.pluginSessionId = newId();
  return p;
};
async function addMember() {
  const id = newId(),
    email = `${id}@example.invalid`,
    credential = await identity.prepareCredential(password);
  await unit.run((tx) =>
    identity.insertWithCredential(tx, {
      userId: id,
      email,
      name: "Fictional Trip Driver",
      ...credential,
      roles: ["driver"],
    }),
  );
  const login = await identity.login(email, password),
    cookie = login.cookies.map((value) => value.split(";", 1)[0]).join("; ");
  return { actor: await identity.authenticate(new Headers({ cookie })), cookie };
}
async function fixturePhase<T>(
  phase: "connection" | "reset" | "migrations" | "bootstrap" | "credentials",
  operation: () => Promise<T>,
): Promise<T> {
  const started = performance.now();
  console.log(JSON.stringify({ event: "trip_fixture_phase", phase, state: "started" }));
  try {
    return await operation();
  } finally {
    console.log(
      JSON.stringify({
        event: "trip_fixture_phase",
        phase,
        state: "settled",
        durationMs: Math.round(performance.now() - started),
      }),
    );
  }
}
beforeAll(async () => {
  control = await fixturePhase("connection", () => testConnection());
  unit = createUnitOfWork(guardedSettings());
  await fixturePhase("reset", () => reset(control));
  await fixturePhase("migrations", () => runMigrations(guardedSettings()));
  identity = createIdentity(unit, identityConfig, { accessEvents: identityAccessEvents(unit) });
  await fixturePhase("bootstrap", () =>
    identity.bootstrap({
      email: "trip-director@example.invalid",
      name: "Fictional Trip Director",
      password,
    }),
  );
  const login = await identity.login("trip-director@example.invalid", password);
  staff = await identity.authenticate(
    new Headers({ cookie: login.cookies.map((value) => value.split(";", 1)[0]).join("; ") }),
  );
  const a = await fixturePhase("credentials", () => addMember()),
    b = await fixturePhase("credentials", () => addMember());
  owner = a.actor;
  ownerCookie = a.cookie;
  other = b.actor;
  otherCookie = b.cookie;
  service = createTrips(unit, config, { identity }, now);
}, SCHEMA_SETUP_TIMEOUT_MS);
beforeEach(async () => {
  // Alias members reference their root; detach them so the restrictive self-reference allows cleanup.
  await control.query("UPDATE trips SET alias_of=NULL");
  for (const table of [
    "trip_history",
    "trip_fact_trailers",
    "trip_facts",
    "source_payloads",
    "source_messages",
    "source_trips",
    "trips",
    "outbox_events",
  ])
    await control.query(`DELETE FROM ${table}`);
  instant = Date.parse("2026-10-20T12:00:00.000Z");
});
afterAll(async () => {
  await unit?.close();
  await control?.end();
});
async function state(id: string) {
  return unit.run(
    async (tx) => (await unit.client(tx).select().from(trips).where(eq(trips.id, id)))[0],
  );
}
async function totals() {
  const [rows] = await control.query<RowDataPacket[]>(
    "SELECT (SELECT COUNT(*) FROM trips) trips,(SELECT COUNT(*) FROM source_trips) sources,(SELECT COUNT(*) FROM source_messages) messages,(SELECT COUNT(*) FROM trip_facts) facts,(SELECT COUNT(*) FROM trip_history) history,(SELECT COUNT(*) FROM outbox_events) events",
  );
  return Object.fromEntries(
    Object.entries(rows[0] ?? {}).map(([key, value]) => [key, Number(value)]),
  );
}
test("concurrent identical events produce one immutable identity, message, canonical trip and transition", async () => {
  const p = fixture();
  const results = await Promise.all([
    receive(p),
    receive(p),
    receive(JSON.parse(canonicalJson(p)) as Telemetry),
  ]);
  expect(new Set(results.map((r) => r.tripId)).size).toBe(1);
  expect(results.filter((r) => r.duplicate).length).toBe(2);
  expect(await totals()).toEqual({
    trips: 1,
    sources: 1,
    messages: 1,
    facts: 1,
    history: 1,
    events: 2,
  });
  expect((await state(results[0]?.tripId as string))?.decision).toBe("unassessed");
  const [rows] = await control.query<RowDataPacket[]>(
    "SELECT CAST(type AS CHAR) type FROM outbox_events",
  );
  expect(rows.map((row) => row.type).sort()).toEqual([
    "source.snapshot_stored",
    "trip.lifecycle_changed",
  ]);
});
test("event/content/revision collisions fail without overwrite and another owner sees no receipt", async () => {
  const p = fixture(),
    saved = await receive(p);
  const changed = structuredClone(p);
  Object.assign(changed.snapshot.observedDistance, { value: 123401 });
  await expect(receive(changed)).rejects.toMatchObject({ statusCode: 409 });
  const reusedRevision = structuredClone(p);
  reusedRevision.eventId = newId();
  await expect(receive(reusedRevision)).rejects.toMatchObject({ statusCode: 409 });
  await expect(receive(p, service, context(other.userId))).rejects.toMatchObject({
    statusCode: 409,
  });
  const copy = structuredClone(p);
  copy.eventId = newId();
  copy.revision = 3;
  copy.source.databaseUuid = newId();
  copy.installationId = newId();
  await expect(receive(copy, service, context(other.userId))).rejects.toMatchObject({
    statusCode: 409,
  });
  expect((await receive(copy)).tripId).toBe(saved.tripId);
  expect((await totals()).trips).toBe(1);
  expect((await totals()).messages).toBe(2);
});
test("out-of-order terminal then older start never regresses or reopens; terminal-only revision1 is valid", async () => {
  const p = fixture(),
    result = await receive(p),
    before = await state(result.tripId);
  const start = fixture("started");
  start.source = structuredClone(p.source);
  start.revision = 1;
  await receive(start);
  expect(await state(result.tripId)).toEqual(before);
  expect((await totals()).events).toBe(3);
  const terminal = fixture();
  terminal.eventId = newId();
  terminal.source.tripId = newId();
  terminal.revision = 1;
  const lone = await receive(terminal);
  expect((await state(lone.tripId))?.outcome).toBe("delivered");
});
test("open refresh advances once without another lifecycle transition and gaps are allowed", async () => {
  const p = fixture("started"),
    first = await receive(p);
  p.eventId = newId();
  p.revision = 7;
  Object.assign(p.snapshot.observedDistance, { value: 400 });
  await receive(p);
  expect((await state(first.tripId))?.version).toBe(2);
  expect((await state(first.tripId))?.actualDistanceM).toBeNull();
  const [rows] = await control.query<RowDataPacket[]>(
    "SELECT CAST(type AS CHAR) type,COUNT(*) n FROM outbox_events GROUP BY type",
  );
  expect(Number(rows.find((r) => r.type === "trip.lifecycle_changed")?.n)).toBe(1);
});
test("higher contradictory outcome, attempted reopen and factual correction retain evidence and current facts", async () => {
  const p = fixture(),
    first = await receive(p),
    current = await state(first.tripId);
  const cancelled = fixture("cancelled");
  cancelled.source = p.source;
  cancelled.eventId = newId();
  cancelled.revision = 3;
  await receive(cancelled);
  const reopened = fixture("started");
  reopened.source = p.source;
  reopened.eventId = newId();
  reopened.revision = 4;
  await receive(reopened);
  const correction = structuredClone(p);
  correction.eventId = newId();
  correction.revision = 5;
  correction.type = "trip.corrected";
  Object.assign(correction.snapshot.job.cargoMass, { value: 19000 });
  await receive(correction);
  const after = await state(first.tripId);
  expect(after?.currentFactId).toBe(current?.currentFactId);
  expect(after?.outcome).toBe("delivered");
  expect(after?.decision).toBe("unassessed");
  expect(after?.reviewHold).toBe(true);
  expect(after?.reviewReasons).toEqual(
    expect.arrayContaining([
      "terminal_outcome_conflict",
      "attempted_reopen",
      "cargoMassKg_conflict",
    ]),
  );
  expect((await totals()).facts).toBe(4);
});

async function projectionConflict(p: Telemetry, next: Telemetry, reasons: string[]) {
  const first = await receive(p),
    before = await state(first.tripId);
  if (!before) throw new Error("SYNTHETIC_TRIP_EXPECTED");
  expect(before.actualStart).not.toBeNull();
  if (p.snapshot.outcome !== "open") {
    expect(before.actualEnd).not.toBeNull();
    expect(before.reportingAt).toBe(before.actualEnd);
  }
  const receipt = await receive(next),
    after = await state(first.tripId);
  expect(receipt.tripId).toBe(first.tripId);
  expect(after).toMatchObject({
    currentFactId: before.currentFactId,
    actualStart: before.actualStart,
    actualEnd: before.actualEnd,
    reportingAt: before.reportingAt,
    actualDistanceM: before.actualDistanceM,
    outcome: before.outcome,
    recording: before.recording,
    decision: "unassessed",
    version: before.version + 1,
    reviewHold: true,
    correctionPending: false,
    reviewReasons: expect.arrayContaining(reasons),
  });
  const evidence = await unit.run((tx) =>
    service.sourceEvidenceInTransaction(tx, receipt.sourceRecordId),
  );
  if (!evidence) throw new Error("SYNTHETIC_EVIDENCE_EXPECTED");
  expect(evidence.factRevisionId).not.toBe(before.currentFactId);
  expect(evidence.reasonCodes).toEqual(expect.arrayContaining(reasons));
  const [history] = await unit.run((tx) =>
    unit
      .client(tx)
      .select()
      .from(tripHistory)
      .where(eq(tripHistory.factId, evidence.factRevisionId)),
  );
  expect(history).toMatchObject({
    tripId: first.tripId,
    version: before.version + 1,
    outcome: before.outcome,
    reasons: expect.arrayContaining(reasons),
  });
  const [payload] = await unit.run((tx) =>
    unit
      .client(tx)
      .select()
      .from(sourcePayloads)
      .where(eq(sourcePayloads.messageId, receipt.sourceRecordId)),
  );
  expect(payload?.content).toBe(canonicalJson(next));
  const detail = await service.detail(owner, first.tripId);
  if (detail.view !== "private") throw new Error("SYNTHETIC_PRIVATE_VIEW_EXPECTED");
  expect(detail.reviewReasonCodes).toEqual(expect.arrayContaining(reasons));
  expect(detail.summary.reportingAt).toBe(before.reportingAt);
  expect(await totals()).toEqual({
    trips: 1,
    sources: 1,
    messages: 2,
    facts: 2,
    history: 2,
    events: 4,
  });
  const [events] = await control.query<RowDataPacket[]>(
    "SELECT CAST(type AS CHAR) type,COUNT(*) n FROM outbox_events GROUP BY type",
  );
  expect(Number(events.find((row) => row.type === "source.snapshot_stored")?.n)).toBe(2);
  expect(Number(events.find((row) => row.type === "trip.lifecycle_changed")?.n)).toBe(1);
  expect(Number(events.find((row) => row.type === "trip.facts_changed")?.n)).toBe(1);
  expect((await receive(next)).duplicate).toBe(true);
  expect(await state(first.tripId)).toEqual(after);
  expect(await totals()).toEqual({
    trips: 1,
    sources: 1,
    messages: 2,
    facts: 2,
    history: 2,
    events: 4,
  });
  return evidence;
}

test.each(["started", "completed"] as const)(
  "higher same-outcome %s evidence losing clock verification preserves canonical timing and records a review conflict",
  async (kind) => {
    const p = fixture(kind),
      next = structuredClone(p);
    next.eventId = newId();
    next.revision = p.revision + 1;
    next.snapshot.evidence.clockAnomaly = true;
    const reasons = [
      "start_time_became_unverified",
      ...(kind === "completed" ? ["end_time_became_unverified"] : []),
    ];
    const evidence = await projectionConflict(p, next, reasons);
    expect(evidence.start).toMatchObject({
      verifiedActual: false,
      utc: new Date(p.snapshot.start.utcMs as number).toISOString(),
    });
    expect(evidence.end.verifiedActual).toBe(false);
  },
);

test.each(["start", "end"] as const)(
  "higher terminal evidence with unknown %s time retains all canonical timestamps",
  async (field) => {
    const p = fixture(),
      next = structuredClone(p);
    next.eventId = newId();
    next.revision = p.revision + 1;
    next.snapshot[field] = { utcMs: null, basis: "unknown", eventSeq: null };
    next.snapshot.evidence[field === "start" ? "startObserved" : "endObserved"] = false;
    next.snapshot.recordingCompleteness = "partial";
    const evidence = await projectionConflict(p, next, [`${field}_time_became_unverified`]);
    expect(evidence[field]).toEqual({ utc: null, basis: "unknown", verifiedActual: false });
    expect(evidence[field === "start" ? "end" : "start"].verifiedActual).toBe(true);
  },
);

test.each(["start", "end"] as const)(
  "changed verified terminal %s time remains a review conflict",
  async (field) => {
    const p = fixture(),
      next = structuredClone(p);
    next.eventId = newId();
    next.revision = p.revision + 1;
    const changed = next.snapshot[field];
    if (!changed || changed.utcMs === null) throw new Error("SYNTHETIC_TIME_EXPECTED");
    changed.utcMs += 1000;
    const evidence = await projectionConflict(p, next, [`${field}_time_conflict`]);
    expect(evidence[field]).toMatchObject({
      verifiedActual: true,
      utc: new Date(changed.utcMs).toISOString(),
    });
  },
);

test("unknown times can improve to verified times and unchanged verified revisions refresh without timing conflicts", async () => {
  const p = fixture();
  p.snapshot.evidence.clockAnomaly = true;
  const first = await receive(p),
    before = await state(first.tripId);
  expect(before).toMatchObject({
    actualStart: null,
    actualEnd: null,
    reportingAt: null,
    reviewHold: false,
  });
  p.eventId = newId();
  p.revision++;
  p.snapshot.evidence.clockAnomaly = false;
  await receive(p);
  const current = await state(first.tripId);
  expect(current).toMatchObject({
    actualStart: new Date(p.snapshot.start.utcMs as number).toISOString(),
    actualEnd: new Date(p.snapshot.end?.utcMs as number).toISOString(),
    reportingAt: new Date(p.snapshot.end?.utcMs as number).toISOString(),
    reviewHold: false,
    version: 2,
  });
  expect(current?.currentFactId).not.toBe(before?.currentFactId);
  p.eventId = newId();
  p.revision++;
  await receive(p);
  const refreshed = await state(first.tripId);
  expect(refreshed).toMatchObject({
    actualStart: current?.actualStart,
    actualEnd: current?.actualEnd,
    reportingAt: current?.reportingAt,
    reviewHold: false,
    version: 3,
  });
  expect(refreshed?.currentFactId).not.toBe(current?.currentFactId);
  expect(refreshed?.reviewReasons.some((reason) => reason.includes("_time_"))).toBe(false);
  expect((await receive(p)).duplicate).toBe(true);
  expect(await totals()).toEqual({
    trips: 1,
    sources: 1,
    messages: 3,
    facts: 3,
    history: 3,
    events: 6,
  });
});

test.each(["actualDistanceM", "deliveredDistanceM"] as const)(
  "higher terminal evidence losing only %s retains the canonical projection under review",
  async (field) => {
    const p = fixture(),
      next = structuredClone(p);
    next.eventId = newId();
    next.revision = p.revision + 1;
    if (field === "actualDistanceM") next.snapshot.recordingCompleteness = "partial";
    else
      Object.assign(next.snapshot, {
        deliveredDistance: { available: false, reason: "not-observed", unit: "m" },
      });
    const evidence = await projectionConflict(p, next, [`${field}_became_unknown`]);
    expect(evidence[field].status).toBe("unknown");
    expect(
      evidence[field === "actualDistanceM" ? "deliveredDistanceM" : "actualDistanceM"],
    ).toMatchObject({ status: "known", value: "123400" });
    expect(evidence.start).toEqual({
      utc: new Date(p.snapshot.start.utcMs as number).toISOString(),
      basis: "event",
      verifiedActual: true,
    });
    expect(evidence.end).toEqual({
      utc: new Date(p.snapshot.end?.utcMs as number).toISOString(),
      basis: "event",
      verifiedActual: true,
    });
    expect(evidence.reasonCodes.some((reason) => reason.includes("_time_"))).toBe(false);
  },
);

test("unknown terminal distances can improve and refresh while verified times remain unchanged", async () => {
  const p = fixture();
  p.snapshot.recordingCompleteness = "partial";
  Object.assign(p.snapshot, {
    deliveredDistance: { available: false, reason: "not-observed", unit: "m" },
  });
  const first = await receive(p),
    before = await state(first.tripId);
  expect(before?.actualStart).not.toBeNull();
  expect(before?.actualEnd).not.toBeNull();
  expect(before?.actualDistanceM).toBeNull();
  const prior = await unit.run((tx) =>
    service.sourceEvidenceInTransaction(tx, first.sourceRecordId),
  );
  expect(prior?.actualDistanceM.status).toBe("unknown");
  expect(prior?.deliveredDistanceM.status).toBe("unknown");
  p.eventId = newId();
  p.revision++;
  p.snapshot.recordingCompleteness = "complete";
  Object.assign(p.snapshot, { deliveredDistance: { available: true, value: 123400, unit: "m" } });
  const improved = await receive(p),
    current = await state(first.tripId);
  expect(current).toMatchObject({
    actualStart: before?.actualStart,
    actualEnd: before?.actualEnd,
    reportingAt: before?.reportingAt,
    actualDistanceM: "123400.000000000000000000",
    reviewHold: false,
    version: 2,
  });
  expect(current?.currentFactId).not.toBe(before?.currentFactId);
  const evidence = await unit.run((tx) =>
    service.sourceEvidenceInTransaction(tx, improved.sourceRecordId),
  );
  expect(evidence?.actualDistanceM).toMatchObject({ status: "known", value: "123400" });
  expect(evidence?.deliveredDistanceM).toMatchObject({ status: "known", value: "123400" });
  p.eventId = newId();
  p.revision++;
  await receive(p);
  const refreshed = await state(first.tripId);
  expect(refreshed).toMatchObject({
    actualStart: before?.actualStart,
    actualEnd: before?.actualEnd,
    reportingAt: before?.reportingAt,
    actualDistanceM: "123400.000000000000000000",
    reviewHold: false,
    version: 3,
  });
  expect(refreshed?.currentFactId).not.toBe(current?.currentFactId);
  expect(refreshed?.reviewReasons).not.toContain("actualDistanceM_became_unknown");
  expect(refreshed?.reviewReasons).not.toContain("deliveredDistanceM_became_unknown");
  expect((await receive(p)).duplicate).toBe(true);
  expect(await totals()).toEqual({
    trips: 1,
    sources: 1,
    messages: 3,
    facts: 3,
    history: 3,
    events: 6,
  });
});
test("safe maximum provider revision is preserved independently of application event versions", async () => {
  const p = fixture();
  p.revision = Number.MAX_SAFE_INTEGER;
  const result = await receive(p);
  const [messages] = await control.query<RowDataPacket[]>("SELECT revision FROM source_messages");
  expect(messages[0]?.revision).toBe("9007199254740991");
  const [events] = await control.query<RowDataPacket[]>(
    "SELECT aggregate_version FROM outbox_events",
  );
  expect(events.every((event) => Number(event.aggregate_version) === 1)).toBe(true);
  expect((await receive(p)).sourceRecordId).toBe(result.sourceRecordId);
});
test("valid unrepresentable telemetry quantity is durably retained with unknown normalized metric", async () => {
  const p = fixture();
  Object.assign(p.snapshot.observedDistance, { value: 1e-19 });
  const result = await receive(p);
  const [saved] = await unit.run((tx) =>
    unit.client(tx).select().from(tripFacts).where(eq(tripFacts.canonicalTripId, result.tripId)),
  );
  if (!saved) throw new Error("SYNTHETIC_FACT_EXPECTED");
  const evidence = await unit.run((tx) =>
    service.sourceEvidenceInTransaction(tx, result.sourceRecordId),
  );
  if (!evidence) throw new Error("SYNTHETIC_EVIDENCE_EXPECTED");
  expect(evidence.actualDistanceM).toMatchObject({
    status: "unknown",
    reasonCode: "quantity_out_of_range",
  });
  expect(evidence.provenance).toMatchObject({
    unsupportedQuantities: { "snapshot.observedDistance": 1e-19 },
  });
  expect((await state(result.tripId))?.actualDistanceM).toBeNull();
  expect((await receive(p)).duplicate).toBe(true);
  expect((await totals()).messages).toBe(1);
});
test("relational facts preserve zero, precision, nulls, times and one coupling row independently of redundant evidence", async () => {
  const p = fixture();
  Object.assign(p.snapshot.job.cargoMass, { value: 0 });
  Object.assign(p.snapshot.observedDistance, { value: 0 });
  Object.assign(p.snapshot.deliveredDistance, { value: 0 });
  Object.assign(p.snapshot.fuelUsed, { value: 0.12345678901234568 });
  const second = structuredClone(p.snapshot.trailers.items[0]);
  if (!second) throw new Error("SYNTHETIC_TRAILER_EXPECTED");
  Object.assign(second, { index: 1 });
  p.snapshot.trailers.items.push(second);
  const result = await receive(p);
  const [saved] = await unit.run((tx) =>
    unit.client(tx).select().from(tripFacts).where(eq(tripFacts.messageId, result.sourceRecordId)),
  );
  if (!saved) throw new Error("SYNTHETIC_FACT_EXPECTED");
  expect(saved).toMatchObject({
    outcome: "delivered",
    recording: "complete",
    cargoMassKg: "0.000000000000000000",
    actualDistanceM: "0.000000000000000000",
    measuredSegmentM: "0.000000000000000000",
    fuelUsedL: "0.123456789012345680",
    originCityId: null,
    startBasis: "event",
    startVerified: true,
    endBasis: "event",
    endVerified: true,
    trailerCount: 1,
    trailersComplete: true,
  });
  const before = await unit.run((tx) =>
    service.sourceEvidenceInTransaction(tx, result.sourceRecordId),
  );
  if (!before) throw new Error("SYNTHETIC_EVIDENCE_EXPECTED");
  const redundant = structuredClone(saved.evidence) as NormalizedTripEvidence;
  redundant.ownerUserId = other.userId;
  redundant.game = "ats";
  redundant.outcome = "cancelled";
  redundant.recording = "partial";
  redundant.start.utc = "2000-01-01T00:00:00.000Z";
  if (redundant.actualDistanceM.status === "known") redundant.actualDistanceM.value = "999";
  redundant.trailers = { complete: false, items: [] };
  // A fixture-only corruption proves JSON normalized snapshots do not compete with relational facts.
  await unit.run((tx) =>
    unit
      .client(tx)
      .update(tripFacts)
      .set({ evidence: redundant })
      .where(eq(tripFacts.id, saved.id)),
  );
  const after = await unit.run((tx) =>
    service.sourceEvidenceInTransaction(tx, result.sourceRecordId),
  );
  expect(after).toEqual(before);
  expect(after?.actualDistanceM).toMatchObject({ status: "known", value: "0" });
  expect(after?.fuelUsedL).toMatchObject({ status: "known", value: "0.12345678901234568" });
  const children = await unit.run((tx) =>
    unit
      .client(tx)
      .select()
      .from(tripFactTrailers)
      .where(eq(tripFactTrailers.tripFactId, saved.id))
      .orderBy(tripFactTrailers.position),
  );
  expect(children.map((row) => row.position)).toEqual([0]);
  expect(children.every((row) => row.trailerId === null && row.unknownReason !== null)).toBe(true);
});

test("an explicit coordinator target links another source identity without summing metrics and rejects stale/foreign targets", async () => {
  const first = await receive(fixture());
  const p = fixture();
  p.source.tripId = newId();
  p.eventId = newId();
  p.revision = 1;
  const target = { ...context(), canonical: { tripId: first.tripId, expectedVersion: 1 } };
  expect((await receive(p, service, target)).tripId).toBe(first.tripId);
  expect((await totals()).trips).toBe(1);
  expect((await totals()).sources).toBe(2);
  expect((await service.detail(owner, first.tripId)).view).toBe("private");
  expect((await state(first.tripId))?.actualDistanceM).toBe("123400.000000000000000000");
  const another = fixture();
  another.source.tripId = newId();
  another.eventId = newId();
  await expect(receive(another, service, target)).rejects.toMatchObject({
    publicCode: "VERSION_CONFLICT",
  });
  await expect(
    receive(another, service, {
      ...context(other.userId),
      canonical: { tripId: first.tripId, expectedVersion: 2 },
    }),
  ).rejects.toMatchObject({ statusCode: 409 });
  another.source.game = "ats";
  await expect(
    receive(another, service, {
      ...context(),
      canonical: { tripId: first.tripId, expectedVersion: 2 },
    }),
  ).rejects.toMatchObject({ statusCode: 409 });
});
test("contradictory obsolete terminal becomes visible review evidence without regressing effective outcome", async () => {
  const p = fixture();
  p.revision = 9;
  p.snapshot.job.market = { available: true, value: "freight_market" };
  const result = await receive(p),
    lower = fixture("cancelled");
  lower.source = p.source;
  lower.eventId = newId();
  lower.revision = 2;
  lower.contract.minor = 1;
  lower.snapshot.hardModeResult = "qualified";
  lower.snapshot.job.market = { available: true, value: "quick_job" };
  await receive(lower);
  const detail = await service.detail(owner, result.tripId);
  expect(detail.view).toBe("private");
  if (detail.view !== "private") throw new Error("SYNTHETIC_PRIVATE_VIEW_EXPECTED");
  expect(detail.reviewReasonCodes).toContain("terminal_outcome_conflict");
  expect(detail.summary.outcome).toBe("delivered");
  expect(detail.effectiveFacts?.recordedTelemetry).toEqual({
    jobType: "freight-market",
    gameMode: "unknown",
    hardModeResult: "unknown",
  });
});
test("confirmed projection remains fixed while later evidence records correction pending", async () => {
  const p = fixture(),
    result = await receive(p),
    original = await state(result.tripId);
  await unit.run((tx) =>
    unit.client(tx).update(trips).set({ decision: "accepted" }).where(eq(trips.id, result.tripId)),
  );
  p.eventId = newId();
  p.revision = 3;
  p.contract.minor = 1;
  p.snapshot.hardModeResult = "not-qualified";
  Object.assign(p.snapshot.observedDistance, { value: 999 });
  p.snapshot.evidence.clockAnomaly = true;
  await receive(p);
  const current = await state(result.tripId);
  expect(current?.currentFactId).toBe(original?.currentFactId);
  expect(current?.actualDistanceM).toBe(original?.actualDistanceM);
  expect(current?.actualStart).toBe(original?.actualStart);
  expect(current?.actualEnd).toBe(original?.actualEnd);
  expect(current?.reportingAt).toBe(original?.reportingAt);
  expect(current?.decision).toBe("accepted");
  expect(current?.correctionPending).toBe(true);
  const detail = await service.detail(owner, result.tripId);
  expect(detail).toMatchObject({
    view: "private",
    effectiveFacts: {
      factRevisionId: original?.currentFactId,
      recordedTelemetry: { hardModeResult: "unknown" },
    },
  });
});
test("source/domain/event writes roll back together at either producer boundary", async () => {
  for (const type of ["source.snapshot_stored", "trip.lifecycle_changed"]) {
    const outbox = createOutbox(unit);
    const failing = createTrips(
      unit,
      config,
      {
        identity,
        events: {
          async append(tx, event) {
            await outbox.append(tx, event);
            if (event.type === type) throw new Error("SYNTHETIC_TRIP_ROLLBACK");
          },
        },
      },
      now,
    );
    await expect(receive(fixture(), failing)).rejects.toThrow("SYNTHETIC_TRIP_ROLLBACK");
    expect(await totals()).toEqual({
      trips: 0,
      sources: 0,
      messages: 0,
      facts: 0,
      history: 0,
      events: 0,
    });
  }
});
test("async owner checks cannot let a caller mutate the captured immutable envelope or owner context", async () => {
  let reached!: () => void, release!: () => void;
  const gate = new Promise<void>((resolve) => {
      reached = resolve;
    }),
    resume = new Promise<void>((resolve) => {
      release = resolve;
    });
  const captured = createTrips(
    unit,
    config,
    {
      identity: {
        ...identity,
        async accessState(tx, id) {
          const state = await identity.accessState(tx, id);
          reached();
          await resume;
          return state;
        },
      },
    },
    now,
  );
  const p = fixture(),
    ctx = context(),
    work = receive(p, captured, ctx);
  await gate;
  Object.assign(p.snapshot.observedDistance, { value: 999 });
  ctx.ownerUserId = other.userId;
  release();
  const result = await work;
  const saved = await state(result.tripId);
  expect(saved?.ownerId).toBe(owner.userId);
  expect(saved?.actualDistanceM).toBe("123400.000000000000000000");
  const [payload] = await unit.run((tx) => unit.client(tx).select().from(sourcePayloads));
  expect(JSON.parse(payload?.content ?? "{}").snapshot.observedDistance.value).toBe(123400);
});
test("null/before/at expiry, holds and current review gate only raw payload cleanup; identity/facts survive", async () => {
  const p = fixture();
  p.snapshot.job.market = { available: true, value: "external_contracts" };
  p.snapshot.gameMode = {
    mode: "truckersmp",
    method: "module-scan",
    confidence: "strong",
    ambiguous: false,
  };
  const result = await receive(p);
  // Simulate a fact saved before normalized telemetry classification existed.
  await control.execute(
    "UPDATE trip_facts SET evidence=JSON_REMOVE(evidence,'$.recordedTelemetry') WHERE message_id=?",
    [result.sourceRecordId],
  );
  const legacy = (jobType: string) => ({
    view: "private",
    effectiveFacts: {
      recordedTelemetry: { jobType, gameMode: "truckersmp", hardModeResult: "unknown" },
    },
  });
  expect(await service.detail(owner, result.tripId)).toMatchObject(legacy("world-of-trucks"));
  expect(await service.detail(staff, result.tripId)).toMatchObject(legacy("world-of-trucks"));
  const expire = () =>
    unit.run((tx) => service.expirePayloadInTransaction(tx, result.sourceRecordId));
  expect(await expire()).toBe(false);
  const set = (eligibleAt: string | null, hold: boolean) =>
    unit.run((tx) =>
      service.retentionPolicyInTransaction(tx, result.sourceRecordId, {
        reviewedPolicyReference: "synthetic-policy/v1",
        eligibleAt,
        hold,
      }),
    );
  await set(new Date(instant + 1000).toISOString(), false);
  expect(await expire()).toBe(false);
  instant += 1000;
  await set(now().toISOString(), true);
  expect(await expire()).toBe(false);
  await set(now().toISOString(), false);
  await unit.run((tx) =>
    unit
      .client(tx)
      .update(trips)
      .set({ decision: "pending_review" })
      .where(eq(trips.id, result.tripId)),
  );
  expect(await expire()).toBe(false);
  await unit.run((tx) =>
    unit
      .client(tx)
      .update(trips)
      .set({ decision: "unassessed" })
      .where(eq(trips.id, result.tripId)),
  );
  expect(await expire()).toBe(true);
  expect(await expire()).toBe(false);
  expect((await receive(p)).duplicate).toBe(true);
  const [payload] = await unit.run((tx) => unit.client(tx).select().from(sourcePayloads));
  expect(payload?.content).toBeNull();
  expect(payload?.expiredAt).toBe(now().toISOString());
  expect(await service.detail(owner, result.tripId)).toMatchObject(legacy("unknown"));
  expect((await service.list(owner, { scope: "mine" })).items[0]).toMatchObject({
    id: result.tripId,
    gameMode: "truckersmp",
  });
  expect((await totals()).facts).toBe(1);
  expect((await totals()).trips).toBe(1);
  const eventContext = await unit.run((tx) =>
    service.eventContextInTransaction(tx, result.sourceRecordId),
  );
  expect(eventContext?.deliveryMode).toBe("live");
  expect(eventContext?.end.verifiedActual).toBe(true);
  const [retained] = await unit.run((tx) => unit.client(tx).select().from(tripFacts));
  if (!retained) throw new Error("SYNTHETIC_FACT_EXPECTED");
  const retainedEvidence = await unit.run((tx) =>
    service.sourceEvidenceInTransaction(tx, result.sourceRecordId),
  );
  expect(retainedEvidence?.provenance).toMatchObject({
    sourceIdentity: { source: { databaseUuid: p.source.databaseUuid } },
  });
});
test("a concurrent reopened review hold wins under the canonical lock before retention rechecks", async () => {
  const result = await receive(fixture());
  await unit.run((tx) =>
    service.retentionPolicyInTransaction(tx, result.sourceRecordId, {
      reviewedPolicyReference: "synthetic-policy/v1",
      eligibleAt: now().toISOString(),
      hold: false,
    }),
  );
  let locked!: () => void, release!: () => void;
  const lockedGate = new Promise<void>((resolve) => {
      locked = resolve;
    }),
    releaseGate = new Promise<void>((resolve) => {
      release = resolve;
    });
  const holding = unit.run(async (tx) => {
    await unit.client(tx).select().from(trips).where(eq(trips.id, result.tripId)).for("update");
    locked();
    await releaseGate;
    await unit
      .client(tx)
      .update(trips)
      .set({ reviewHold: true })
      .where(eq(trips.id, result.tripId));
  });
  await lockedGate;
  const expiry = unit.run((tx) => service.expirePayloadInTransaction(tx, result.sourceRecordId));
  release();
  await holding;
  expect(await expiry).toBe(false);
  const [payload] = await unit.run((tx) => unit.client(tx).select().from(sourcePayloads));
  expect(payload?.content).not.toBeNull();
});
test("owner, reviewer and company views filter private facts before serialization and expose real absence", async () => {
  const audited = telemetryFixture("haulmp-audited") as unknown as Telemetry;
  const pending = await receive(audited);
  const recordedTelemetry = {
    jobType: "freight-market",
    gameMode: "haulmp",
    hardModeResult: "qualified",
  };
  await expect(service.detail(other, pending.tripId)).rejects.toMatchObject({ statusCode: 404 });
  expect((await service.detail(owner, pending.tripId)).view).toBe("private");
  expect((await service.detail(staff, pending.tripId)).view).toBe("private");
  await expect(service.list(other, { scope: "review" })).rejects.toMatchObject({ statusCode: 403 });
  expect((await service.list(owner, { scope: "company" })).items).toEqual([]);
  await unit.run((tx) =>
    unit.client(tx).update(trips).set({ decision: "accepted" }).where(eq(trips.id, pending.tripId)),
  );
  const publicView = await service.detail(other, pending.tripId);
  expect(publicView.view).toBe("summary");
  expect(Object.keys(publicView)).not.toContain("reviewReasonCodes");
  const privateView = await service.detail(owner, pending.tripId);
  expect(privateView).toMatchObject({
    view: "private",
    manualRevision: null,
    evidence: [],
    decisions: [],
    pendingProposalId: null,
  });
  const app = await createApp({ checkReadiness: async () => true, identity, trips: service });
  try {
    const denied = await app.inject({ url: `/api/v1/trips/${pending.tripId}` });
    expect(denied.statusCode).toBe(401);
    const response = await app.inject({
      url: `/api/v1/trips/${pending.tripId}`,
      headers: { cookie: otherCookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBe('"v1"');
    expect(response.headers["cache-control"]).toBe("no-store");
    const json = response.json();
    expect(json.data.view).toBe("summary");
    for (const field of [
      "effectiveFacts",
      "recordedTelemetry",
      "snapshot",
      "sourceRecordId",
      "eventId",
      "money",
      "reviewReasonCodes",
    ])
      expect(JSON.stringify(json)).not.toContain(`"${field}"`);
    const ownerResponse = await app.inject({
      url: `/api/v1/trips/${pending.tripId}`,
      headers: { cookie: ownerCookie },
    });
    expect(ownerResponse.statusCode).toBe(200);
    expect(ownerResponse.json().data.effectiveFacts.recordedTelemetry).toEqual(recordedTelemetry);
    expect(ownerResponse.json().data.summary).toMatchObject({
      gameMode: "haulmp",
      event: null,
      submittedAt: null,
    });
    expect(JSON.stringify(ownerResponse.json())).not.toMatch(
      /"snapshot"|"sourceRecordId"|"eventId"|"ambiguous"/,
    );
    expect(await service.detail(staff, pending.tripId)).toMatchObject({
      view: "private",
      effectiveFacts: { recordedTelemetry },
    });
    expect(
      (
        await app.inject({
          url: "/api/v1/trips?scope=mine&limit=1",
          headers: { cookie: ownerCookie },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          url: "/api/v1/me/trip-status-summary",
          headers: { cookie: ownerCookie },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ url: "/api/v1/trips?accepted=true", headers: { cookie: ownerCookie } }))
        .statusCode,
    ).toBe(422);
  } finally {
    await app.close();
  }
});
test("keyset cursors bind actor/session/epoch/scope/filter and current authority is checked every page", async () => {
  for (let n = 0; n < 3; n++) {
    const p = fixture();
    p.eventId = newId();
    p.source.tripId = newId();
    await receive(p);
  }
  const first = await service.list(owner, { scope: "mine", limit: 1 });
  expect(first.nextCursor).not.toBeNull();
  const next = await service.list(owner, {
    scope: "mine",
    limit: 1,
    cursor: first.nextCursor as string,
  });
  expect(next.items[0]?.id).not.toBe(first.items[0]?.id);
  for (const options of [
    { scope: "mine" as const, cursor: `${first.nextCursor}x` },
    { scope: "mine" as const, cursor: `${first.nextCursor}!` },
    { scope: "mine" as const, game: "ets2" as const, cursor: first.nextCursor as string },
    { scope: "company" as const, cursor: first.nextCursor as string },
  ])
    await expect(service.list(owner, options)).rejects.toMatchObject({ statusCode: 409 });
  await expect(
    service.list(other, { scope: "mine", cursor: first.nextCursor as string }),
  ).rejects.toMatchObject({ statusCode: 409 });
  await expect(
    service.list(
      { ...owner, sessionId: newId() },
      { scope: "mine", cursor: first.nextCursor as string },
    ),
  ).rejects.toMatchObject({ statusCode: 401 });
  await expect(
    service.detail({ ...owner, accessEpoch: owner.accessEpoch + 1 }, first.items[0]?.id as string),
  ).rejects.toMatchObject({ statusCode: 401 });
  await unit.run((tx) =>
    unit
      .client(tx)
      .update(membership)
      .set({ status: "inactive" })
      .where(eq(membership.userId, other.userId)),
  );
  await expect(receive(fixture(), service, context(other.userId))).rejects.toMatchObject({
    statusCode: 403,
  });
  await expect(service.list(other, { scope: "company" })).rejects.toMatchObject({
    statusCode: 401,
  });
  await unit.run((tx) =>
    unit
      .client(tx)
      .update(membership)
      .set({ status: "active" })
      .where(eq(membership.userId, other.userId)),
  );
  await unit.run((tx) => unit.client(tx).delete(roles).where(eq(roles.userId, other.userId)));
  await expect(receive(fixture(), service, context(other.userId))).rejects.toMatchObject({
    statusCode: 403,
  });
  await unit.run((tx) =>
    unit.client(tx).insert(roles).values({ userId: other.userId, role: "driver" }),
  );
});
test("decision counts partition own trips and active/correction axes deliberately overlap", async () => {
  const decisions = ["unassessed", "pending_review", "accepted", "rejected"] as const;
  for (const decision of decisions)
    await unit.run((tx) =>
      unit
        .client(tx)
        .insert(trips)
        .values({
          id: newId(),
          ownerId: owner.userId,
          game: "ets2",
          version: 1,
          outcome: "open",
          recording: "unknown",
          decision,
          correctionPending: decision === "accepted",
          reviewReasons: [],
          createdAt: now().toISOString(),
        }),
    );
  expect(await service.status(owner)).toEqual({
    counts: { unassessed: 1, pendingReview: 1, accepted: 1, rejected: 1 },
    activeTrips: 4,
    correctionPending: 1,
    lifetimeTotals: { acceptedTrips: 1, actualDistanceM: "0" },
  });
  expect((await service.status(other)).lifetimeTotals).toEqual({
    acceptedTrips: 0,
    actualDistanceM: "0",
  });
});
test("restrictive relationships retain historical ownership and normalized evidence", async () => {
  const result = await receive(fixture());
  await expect(
    unit.run((tx) => unit.client(tx).delete(trips).where(eq(trips.id, result.tripId))),
  ).rejects.toBeDefined();
  await expect(
    unit.run((tx) =>
      unit.client(tx).delete(sourceMessages).where(eq(sourceMessages.id, result.sourceRecordId)),
    ),
  ).rejects.toBeDefined();
  expect((await totals()).trips).toBe(1);
  expect((await totals()).facts).toBe(1);
});
test("manual internal adapter uses current canonical selections, evidence port and unknown source dates", async () => {
  const { catalogs, rows } = await listedTrips();
  const city = (code: string) => rows.id(code),
    originId = city("fixture_north"),
    destinationId = city("fixture_south");
  const resolved = (entityId: string) => ({ status: "resolved" as const, entityId });
  const cargoId = rows.id("fixture_crates"),
    trailerTypeId = rows.id("fixture_box");
  const p = {
    format: 2 as const,
    reportId: newId(),
    revisionId: newId(),
    revision: 1,
    fields: {
      game: "ets2" as const,
      origin: resolved(originId),
      destination: resolved(destinationId),
      cargo: resolved(cargoId),
      trailerType: resolved(trailerTypeId),
      cargoMassKg: "1000.5",
      actualDistanceM: "1234.5",
      evidenceIds: [newId()],
      eventId: null,
      comment: null,
    },
  };
  const withoutEvidence = createTrips(unit, config, { identity, catalogs });
  await expect(
    unit.run((tx) => withoutEvidence.storeInTransaction(tx, "manual", p, context())),
  ).rejects.toMatchObject({ statusCode: 503 });
  let validated = false;
  const manual = createTrips(unit, config, {
    identity,
    catalogs,
    manualEvidence: async (_tx, id) => {
      expect(id).toBe(owner.userId);
      validated = true;
    },
  });
  const result = await unit.run((tx) => manual.storeInTransaction(tx, "manual", p, context()));
  const sourceFact = await unit.run((tx) =>
    manual.sourceEvidenceInTransaction(tx, result.sourceRecordId),
  );
  if (!sourceFact) throw new Error("SYNTHETIC_FACT_EXPECTED");
  expect(sourceFact.cargo).toMatchObject({
    status: "known",
    value: { entityId: cargoId },
  });
  expect(sourceFact.trailers.items[0]).toMatchObject({
    status: "known",
    value: { entityId: trailerTypeId },
  });
  expect(
    await unit
      .run((tx) =>
        unit
          .client(tx)
          .update(tripFacts)
          .set({ cargoId: originId })
          .where(eq(tripFacts.id, sourceFact.factRevisionId)),
      )
      .then(() => false, hasCode("ER_NO_REFERENCED_ROW_2")),
  ).toBe(true);
  expect(
    await unit
      .run((tx) =>
        unit
          .client(tx)
          .update(tripFactTrailers)
          .set({ trailerId: cargoId })
          .where(eq(tripFactTrailers.tripFactId, sourceFact.factRevisionId)),
      )
      .then(() => false, hasCode("ER_NO_REFERENCED_ROW_2")),
  ).toBe(true);
  expect(validated).toBe(true);
  expect((await state(result.tripId))?.actualEnd).toBeNull();
  expect((await state(result.tripId))?.reportingAt).toBeNull();
  expect((await state(result.tripId))?.decision).toBe("unassessed");
  expect((await manual.detail(owner, result.tripId)).view).toBe("private");
  const telemetry = fixture();
  telemetry.eventId = newId();
  telemetry.snapshot.context.gameBuild = { available: true, value: "synthetic-build" };
  Object.assign(telemetry.snapshot.job.cargoMass, { value: 1000.5 });
  Object.assign(telemetry.snapshot.observedDistance, { value: 1234.5 });
  Object.assign(telemetry.snapshot.deliveredDistance, { value: 1234.5 });
  await receive(telemetry, manual, {
    ...context(),
    canonical: { tripId: result.tripId, expectedVersion: 1 },
  });
  const mixed = await manual.detail(owner, result.tripId);
  expect(mixed.view).toBe("private");
  if (mixed.view !== "private") throw new Error("SYNTHETIC_PRIVATE_VIEW_EXPECTED");
  expect(mixed.summary.sourceKinds.sort()).toEqual(["ets2telemetry", "manual"]);
  expect(mixed.summary.actualDistanceM).toBe("1234.5");
  expect((await totals()).trips).toBe(1);
  const reverse = structuredClone(telemetry);
  reverse.eventId = newId();
  reverse.source.tripId = newId();
  Object.assign(reverse.snapshot, {
    plannedDistance: { available: false, reason: "not-observed", unit: "m" },
    deliveredDistance: { available: false, reason: "not-observed", unit: "m" },
  });
  const telemetryFirst = await receive(reverse, manual),
    timing = await state(telemetryFirst.tripId);
  if (!timing) throw new Error("SYNTHETIC_TRIP_EXPECTED");
  expect(timing.actualStart).not.toBeNull();
  expect(timing.actualEnd).not.toBeNull();
  const manualAttachment = await unit.run((tx) =>
    manual.storeInTransaction(
      tx,
      "manual",
      { ...p, reportId: newId(), revisionId: newId() },
      { ...context(), canonical: { tripId: telemetryFirst.tripId, expectedVersion: 1 } },
    ),
  );
  const held = await state(telemetryFirst.tripId);
  expect(held).toMatchObject({
    currentFactId: timing.currentFactId,
    actualStart: timing.actualStart,
    actualEnd: timing.actualEnd,
    reportingAt: timing.reportingAt,
    reviewHold: true,
    version: 2,
    reviewReasons: expect.arrayContaining([
      "start_time_became_unverified",
      "end_time_became_unverified",
    ]),
  });
  expect(
    held?.reviewReasons.filter(
      (reason) => reason.includes("_became_") || reason.endsWith("_conflict"),
    ),
  ).toEqual(["end_time_became_unverified", "start_time_became_unverified"]);
  const manualEvidence = await unit.run((tx) =>
    manual.sourceEvidenceInTransaction(tx, manualAttachment.sourceRecordId),
  );
  expect(manualEvidence?.provider).toBe("manual");
  expect(manualEvidence?.start).toEqual({ utc: null, basis: "unknown", verifiedActual: false });
  expect(manualEvidence?.end).toEqual({ utc: null, basis: "unknown", verifiedActual: false });
  await unit.run((tx) =>
    unit
      .client(tx)
      .update(membership)
      .set({ locale: "ru" })
      .where(eq(membership.userId, owner.userId)),
  );
  const ru = await manual.detail(owner, result.tripId);
  if (ru.view !== "private") throw new Error("SYNTHETIC_PRIVATE_VIEW_EXPECTED");
  expect(ru.summary.origin).toMatchObject({
    requestedLocale: "ru",
    renderedLocale: "en",
    englishFallback: true,
  });
  await unit.run((tx) =>
    unit
      .client(tx)
      .update(catalogCities)
      .set({ nameNative: "Krönburg" })
      .where(eq(catalogCities.id, originId)),
  );
  const canonical = await manual.detail(owner, result.tripId);
  if (canonical.view !== "private") throw new Error("SYNTHETIC_PRIVATE_VIEW_EXPECTED");
  expect(canonical.summary.origin).toMatchObject({ nameNative: "Krönburg" });
  expect(canonical.summary.destination).not.toHaveProperty("nameNative");
  await unit.run((tx) =>
    unit
      .client(tx)
      .update(catalogCities)
      .set({ nameNative: null })
      .where(eq(catalogCities.id, originId)),
  );
  await unit.run((tx) =>
    unit
      .client(tx)
      .update(membership)
      .set({ locale: "en" })
      .where(eq(membership.userId, owner.userId)),
  );
  await expect(
    unit.run((tx) =>
      manual.retentionPolicyInTransaction(tx, result.sourceRecordId, {
        reviewedPolicyReference: "synthetic/v1",
        eligibleAt: now().toISOString(),
        hold: false,
      }),
    ),
  ).rejects.toThrow("MANUAL_RETENTION_OUT_OF_SCOPE");
  const pinnedView = await manual.detail(owner, result.tripId);
  if (pinnedView.view !== "private") throw new Error("SYNTHETIC_PRIVATE_VIEW_EXPECTED");
  expect(pinnedView.summary.origin?.label).toBe("Fictional north");
  // Names follow the row, not a pin: staff edits show up on trips already recorded.
  await unit.run((tx) =>
    unit
      .client(tx)
      .update(catalogCities)
      .set({ nameEn: "Renamed north" })
      .where(eq(catalogCities.id, originId)),
  );
  const renamed = await manual.detail(owner, result.tripId);
  if (renamed.view !== "private") throw new Error("SYNTHETIC_PRIVATE_VIEW_EXPECTED");
  expect(renamed.summary.origin?.label).toBe("Renamed north");
  await unit.run((tx) =>
    unit
      .client(tx)
      .update(catalogCities)
      .set({ nameEn: "Fictional north" })
      .where(eq(catalogCities.id, originId)),
  );
});

// Telemetry recognition against editable lists: the first trailer's body type names the coupling.
const coupling = (
  first: Partial<Telemetry["snapshot"]["trailers"]["items"][number]>,
  ...rest: Telemetry["snapshot"]["trailers"]["items"]
) => {
  const p = fresh();
  const base = p.snapshot.trailers.items[0];
  if (!base) throw new Error("SYNTHETIC_TRAILER_EXPECTED");
  p.snapshot.trailers.items = [{ ...base, ...first }, ...rest];
  return p;
};
const tokenTrailer = (index: number, bodyType: string, id = "fixture_other_trailer") => ({
  index,
  id: { available: true as const, value: id },
  bodyType: { available: true as const, value: bodyType },
  chainType: { available: true as const, value: "fixture_single" },
});
const noBodyType = { available: false as const, reason: "not-observed" as const };
const stored = async (p: Telemetry) => {
  const { trips } = await listedTrips();
  const result = await receive(p, trips);
  const evidence = await unit.run((tx) =>
    trips.sourceEvidenceInTransaction(tx, result.sourceRecordId),
  );
  if (!evidence) throw new Error("SYNTHETIC_EVIDENCE_EXPECTED");
  const [fact] = await unit.run((tx) =>
    unit.client(tx).select().from(tripFacts).where(eq(tripFacts.messageId, result.sourceRecordId)),
  );
  const children = await unit.run((tx) =>
    unit
      .client(tx)
      .select()
      .from(tripFactTrailers)
      .where(eq(tripFactTrailers.tripFactId, fact?.id ?? "")),
  );
  return { evidence, fact, children };
};

test("telemetry recognizes a coupling by the first body type when the trailer id matches nothing", async () => {
  const { rows } = await listedTrips();
  const { evidence, fact, children } = await stored(
    coupling({ id: { available: true, value: "fixture_unlisted_trailer" } }),
  );
  expect(evidence.trailers.items).toHaveLength(1);
  expect(evidence.trailers.items[0]).toMatchObject({
    status: "known",
    value: { entityId: rows.id("fixture_box") },
  });
  expect(fact).toMatchObject({ trailerCount: 1, ruleContextComplete: true });
  expect(children.map((row) => [row.position, row.trailerId])).toEqual([
    [0, rows.id("fixture_box")],
  ]);
});

test("later slots never block the coupling and stay in provenance", async () => {
  const { rows } = await listedTrips();
  const later = { ...tokenTrailer(1, "ignored"), bodyType: noBodyType };
  const { evidence, fact, children } = await stored(coupling({}, later));
  expect(fact?.ruleContextComplete).toBe(true);
  expect(evidence.trailers.items[0]).toMatchObject({ status: "known" });
  expect(evidence.trailers.items).toHaveLength(1);
  expect(children.map((row) => row.position)).toEqual([0]);
  expect(
    (evidence.provenance as { trailerEvidence: { items: unknown[] } }).trailerEvidence.items,
  ).toHaveLength(2);
  expect(rows.ids.size).toBeGreaterThan(0);
});

test("the first body type has no fallback to the trailer id, chain type or another slot", async () => {
  const unavailable = await stored(
    coupling(
      { id: { available: true, value: "fixture_box" }, bodyType: noBodyType },
      tokenTrailer(1, "fixture_box"),
    ),
  );
  expect(unavailable.evidence.trailers.items[0]).toMatchObject({
    status: "unknown",
    reasonCode: "source_id_unknown",
  });
  expect(unavailable.fact?.ruleContextComplete).toBe(false);
  const later = await stored(coupling({ bodyType: { available: true, value: "" } }));
  expect(later.evidence.trailers.items[0]).toMatchObject({ status: "unknown" });
});

test("items without index zero and unlisted body types stay unknown", async () => {
  const p = fresh();
  p.snapshot.trailers.items = [tokenTrailer(1, "fixture_box")];
  const missingZero = await stored(p);
  expect(missingZero.evidence.trailers.items[0]).toMatchObject({
    status: "unknown",
    reasonCode: "source_id_unknown",
  });
  expect(missingZero.fact?.ruleContextComplete).toBe(false);
  const unlisted = await stored(
    coupling({ bodyType: { available: true, value: "fixture_unlisted_body" } }),
  );
  expect(unlisted.evidence.trailers.items[0]).toMatchObject({
    status: "unknown",
    reasonCode: "unknown_source_id",
  });
  expect(unlisted.fact?.ruleContextComplete).toBe(false);
});

test("telemetry stays incomplete when the client reports an incomplete coupling or context", async () => {
  const incomplete = fresh();
  incomplete.snapshot.trailers.complete = false;
  expect((await stored(incomplete)).fact?.ruleContextComplete).toBe(false);
});

test("resolution does not depend on the game build or map", async () => {
  const { rows } = await listedTrips();
  for (const change of [
    { gameBuild: { available: true, value: "another-build" } },
    { gameBuild: { available: false, reason: "not-observed" } },
    {
      gameBuild: { available: false, reason: "not-observed" },
      mapId: { available: false, reason: "not-observed" },
    },
  ]) {
    const p = fresh();
    Object.assign(p.snapshot.context, change);
    const { evidence } = await stored(p);
    expect(evidence.origin).toMatchObject({
      status: "known",
      value: { entityId: rows.id("fixture_north") },
    });
    expect(evidence.cargo).toMatchObject({ status: "known" });
  }
});

test("non-hazardous and unlisted cargo give distinct ADR outcomes and hidden rows stay recognized", async () => {
  const nonHazardous = await stored(fresh());
  expect(nonHazardous.evidence.adrCategory).toMatchObject({
    status: "unknown",
    reasonCode: "cargo_not_adr",
  });
  expect(nonHazardous.fact?.ruleContextComplete).toBe(true);
  const hazardous = fresh();
  Object.assign(hazardous.snapshot.job.cargoId, { value: "fixture_gas" });
  const known = await stored(hazardous);
  expect(known.evidence.adrCategory).toMatchObject({ status: "known", value: "2" });
  expect(known.fact?.adrClass).toBe("2");
  const unlisted = fresh();
  Object.assign(unlisted.snapshot.job.cargoId, { value: "fixture_unlisted_cargo" });
  const missing = await stored(unlisted);
  expect(missing.evidence.adrCategory).toMatchObject({
    status: "unknown",
    reasonCode: "cargo_adr_unknown",
  });
  expect(missing.fact?.ruleContextComplete).toBe(false);
  const hidden = await stored(
    coupling({ bodyType: { available: true, value: "fixture_hidden_body" } }),
  );
  expect(hidden.evidence.trailers.items[0]).toMatchObject({ status: "known" });
  expect(hidden.fact?.ruleContextComplete).toBe(true);
});

test("review queue filters hold and order, binds them to cursors and projects manual revisions once per page", async () => {
  const created: string[] = [];
  for (let n = 0; n < 4; n++) {
    const p = fixture();
    p.eventId = newId();
    p.source.tripId = newId();
    created.push((await receive(p)).tripId);
    instant += 1000;
  }
  const [first, second, third, fourth] = created as [string, string, string, string];
  await unit.run(async (tx) => {
    for (const [id, hold] of [
      [first, true],
      [second, false],
      [third, true],
      [fourth, false],
    ] as const)
      await unit.client(tx).update(trips).set({ reviewHold: hold }).where(eq(trips.id, id));
  });
  const calls: string[][] = [],
    submittedAt = "2026-10-20T11:00:00.000Z",
    missingEventId = newId();
  const events = createEvents(unit, config, { identity }, now);
  const queue = createTrips(
    unit,
    config,
    {
      identity,
      // The queue must never build evidence DTOs; only the narrow revision port is read.
      manualProjection: async () => {
        throw new Error("SYNTHETIC_QUEUE_MUST_NOT_PROJECT_EVIDENCE");
      },
      manualRevisions: async (_tx, ids) => {
        calls.push([...ids]);
        return new Map(
          ids
            .filter((id) => id === third)
            .map((id) => [id, { number: 2, submittedAt, eventId: missingEventId }]),
        );
      },
      eventTitles: events.tripTitlesInTransaction,
    },
    now,
  );
  const held = await queue.list(staff, { scope: "review", hold: true, order: "asc", limit: 1 });
  expect(held.items.map((item) => item.id)).toEqual([first]);
  expect(held.items[0]?.review).toEqual({
    hold: true,
    reasonCodes: (await state(first))?.reviewReasons,
    createdAt: (await state(first))?.createdAt,
    manualRevision: null,
  });
  expect(held.nextCursor).not.toBeNull();
  const next = await queue.list(staff, {
    scope: "review",
    hold: true,
    order: "asc",
    limit: 1,
    cursor: held.nextCursor as string,
  });
  expect(next.items.map((item) => item.id)).toEqual([third]);
  expect(next.items[0]?.review?.manualRevision).toEqual({ number: 2, submittedAt });
  expect(next.items[0]).toMatchObject({ submittedAt, event: null, gameMode: "unknown" });
  expect(next.nextCursor).toBeNull();
  // One batched projection call per page, never one per row.
  expect(calls).toEqual([[first], [third]]);
  const newest = await queue.list(staff, { scope: "review", hold: true, limit: 5 });
  expect(newest.items.map((item) => item.id)).toEqual([third, first]);
  expect(calls.at(-1)).toEqual([third, first]);
  const clear = await queue.list(staff, { scope: "review", hold: false, order: "asc" });
  expect(clear.items.map((item) => [item.id, item.review?.hold])).toEqual([
    [second, false],
    [fourth, false],
  ]);
  const all = await queue.list(staff, { scope: "review", limit: 5 });
  expect(all.items.map((item) => item.id)).toEqual([fourth, third, second, first]);
  // The filters are part of the cursor binding: changing hold or order invalidates the cursor.
  for (const options of [
    { hold: false, order: "asc" as const },
    { hold: true, order: "desc" as const },
    { order: "asc" as const },
    { hold: true },
  ])
    await expect(
      queue.list(staff, {
        scope: "review",
        limit: 1,
        cursor: held.nextCursor as string,
        ...options,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  for (const options of [
    { scope: "company" as const, hold: true },
    { scope: "review" as const, hold: "true" as unknown as boolean },
    { scope: "review" as const, order: "up" as unknown as "asc" },
  ])
    await expect(queue.list(staff, options)).rejects.toMatchObject({ statusCode: 422 });
  calls.length = 0;
  await unit.run((tx) =>
    unit.client(tx).update(trips).set({ decision: "accepted" }).where(eq(trips.id, third)),
  );
  const company = await queue.list(staff, { scope: "company" });
  expect(company.items[0]).toMatchObject({ id: third, submittedAt });
  expect(company.items[0]).not.toHaveProperty("review");
  expect(company.items[0]).not.toHaveProperty("gameMode");
  expect(company.items[0]).not.toHaveProperty("event");
  const mine = await queue.list(owner, { scope: "mine" });
  expect(mine.items.find((item) => item.id === third)).toMatchObject({ submittedAt, event: null });
  for (const item of mine.items) expect(item).not.toHaveProperty("review");
  expect(calls).toEqual([[third], [fourth, third, second, first]]);
});
test("representative mixed history uses bounded ordered company, owner and review queue indexes", async () => {
  const rows = Array.from({ length: 600 }, (_, i) => ({
    id: newId(),
    ownerId: i < 15 ? owner.userId : other.userId,
    game: i % 2 ? ("ets2" as const) : ("ats" as const),
    version: 1,
    outcome: "delivered" as const,
    recording: "partial" as const,
    decision: i < 30 ? ("accepted" as const) : ("unassessed" as const),
    reviewHold: i >= 570,
    reviewReasons: [],
    createdAt: new Date(instant + i).toISOString(),
  }));
  await unit.run((tx) => unit.client(tx).insert(trips).values(rows));
  await control.query("ANALYZE TABLE trips");
  const [company] = await control.query<RowDataPacket[]>(
    "EXPLAIN SELECT id FROM trips WHERE decision='accepted' ORDER BY created_at DESC,id DESC LIMIT 25",
  );
  const [mine] = await control.execute<RowDataPacket[]>(
    "EXPLAIN SELECT id FROM trips WHERE owner_id=? ORDER BY created_at DESC,id DESC LIMIT 25",
    [owner.userId],
  );
  const [queue] = await control.query<RowDataPacket[]>(
    "EXPLAIN SELECT id FROM trips WHERE review_hold=1 AND alias_of IS NULL ORDER BY created_at,id LIMIT 26",
  );
  expect(company[0]?.key).toBe("trip_company_page");
  expect(mine[0]?.key).toBe("trip_owner_page");
  expect(queue[0]?.key).toBe("trip_review_queue");
  expect(Number(company[0]?.rows)).toBeLessThan(600);
  expect(Number(mine[0]?.rows)).toBeLessThan(600);
  expect(Number(queue[0]?.rows)).toBeLessThan(600);
});

type SourceKind = "ets2telemetry" | "manual";
type Decision = (typeof trips.$inferInsert)["decision"];
const sourceRow = (
  tripId: string,
  ownerId: string,
  game: "ets2" | "ats",
  provider: SourceKind,
) => ({
  id: newId(),
  provider,
  game,
  sessionKey: Buffer.from(newId(), "ascii"),
  tripKey: Buffer.from(newId(), "ascii"),
  ownerId,
  canonicalTripId: tripId,
  latestRevision: "1",
  connectionContext: {},
  createdAt: new Date(instant).toISOString(),
});
const tripRow = (
  id: string,
  ownerId: string,
  spec: { game?: "ets2" | "ats"; decision?: Decision; hold?: boolean },
  aliasOf: string | null = null,
) => {
  // Every synthetic trip is one second newer than the previous one.
  instant += 1000;
  return {
    id,
    ownerId,
    game: spec.game ?? ("ets2" as const),
    aliasOf,
    version: 1,
    outcome: "delivered" as const,
    recording: "complete" as const,
    decision: spec.decision ?? ("unassessed" as const),
    reviewHold: spec.hold ?? false,
    reviewReasons: [],
    createdAt: new Date(instant).toISOString(),
  };
};
/** Synthetic root trip with root sources and an optional alias member carrying more sources. */
async function seedSourced(
  ownerId: string,
  spec: {
    game?: "ets2" | "ats";
    decision?: Decision;
    hold?: boolean;
    sources?: SourceKind[];
    aliasSources?: SourceKind[];
  },
) {
  const id = newId(),
    member = spec.aliasSources ? newId() : null,
    game = spec.game ?? "ets2";
  await unit.run(async (tx) => {
    const db = unit.client(tx);
    await db.insert(trips).values(tripRow(id, ownerId, spec));
    if (member) await db.insert(trips).values(tripRow(member, ownerId, { game }, id));
    const sources = [
      ...(spec.sources ?? []).map((p) => sourceRow(id, ownerId, game, p)),
      ...(member ? (spec.aliasSources ?? []).map((p) => sourceRow(member, ownerId, game, p)) : []),
    ];
    if (sources.length) await db.insert(sourceTrips).values(sources);
  });
  return { id, member };
}
/** T1..T8 and newer fillers F (newest first) for the source-filter matrix. */
async function sourceMatrix() {
  const o = owner.userId,
    x = other.userId;
  const T1 = (await seedSourced(o, { decision: "accepted", sources: ["ets2telemetry"] })).id;
  const T2 = (await seedSourced(o, { decision: "pending_review", hold: true, sources: ["manual"] }))
    .id;
  const T3 = (
    await seedSourced(o, {
      decision: "accepted",
      game: "ats",
      sources: ["ets2telemetry", "manual"],
    })
  ).id;
  const T4 = (await seedSourced(o, {})).id;
  const t5 = await seedSourced(o, {
    decision: "accepted",
    sources: ["ets2telemetry"],
    aliasSources: ["manual"],
  });
  const T5 = t5.id,
    A5 = t5.member as string;
  const T6 = (await seedSourced(x, { decision: "accepted", game: "ats", sources: ["manual"] })).id;
  const T7 = (await seedSourced(x, { decision: "rejected", hold: true, sources: ["manual"] })).id;
  const T8 = (
    await seedSourced(x, { decision: "pending_review", hold: true, sources: ["ets2telemetry"] })
  ).id;
  const F: string[] = [];
  for (let n = 0; n < 6; n++) F.unshift((await seedSourced(o, { sources: ["ets2telemetry"] })).id);
  return { T1, T2, T3, T4, T5, A5, T6, T7, T8, F };
}
type ListArgs = NonNullable<Parameters<Trips["list"]>[1]>;
const ids = (page: { items: { id: string }[] }) => page.items.map((item) => item.id);
async function walk(actor: Actor, options: ListArgs, limit: number, total?: number) {
  const seen: string[] = [];
  let cursor: string | undefined;
  for (let n = 0; n < 50; n++) {
    const page = await service.list(actor, { ...options, limit, ...(cursor ? { cursor } : {}) });
    if (total !== undefined) expect(page.total).toBe(total);
    seen.push(...ids(page));
    if (!page.nextCursor) {
      expect(page.items.length).toBeLessThanOrEqual(limit);
      return seen;
    }
    expect(page.items.length, "a page with a next cursor is full").toBe(limit);
    cursor = page.nextCursor;
  }
  throw new Error("CURSOR_WALK_UNBOUNDED");
}
test("completion paging keeps missing times last, with directional ties and an unpaged total", async () => {
  const early = "2026-10-18T08:00:00.000Z";
  const late = "2026-10-20T08:00:00.000Z";
  const rows = [late, early, null, late, null].map((actualEnd) => ({
    ...tripRow(newId(), owner.userId, { decision: "accepted" }),
    actualEnd,
  }));
  await unit.run((tx) => unit.client(tx).insert(trips).values(rows));
  const knownTies = rows
    .filter((r) => r.actualEnd === late)
    .map((r) => r.id)
    .sort();
  const missing = rows
    .filter((r) => r.actualEnd === null)
    .map((r) => r.id)
    .sort();
  const earliest = rows.find((r) => r.actualEnd === early)?.id;
  expect(await walk(owner, { order: "completion_asc" }, 1, rows.length)).toEqual([
    earliest,
    ...knownTies,
    ...missing,
  ]);
  const latestFirst = [...knownTies.reverse(), earliest, ...missing.reverse()];
  expect(await walk(owner, { scope: "mine", order: "completion_desc" }, 1, rows.length)).toEqual(
    latestFirst,
  );
  expect(ids(await service.list(staff, { scope: "review", order: "completion_desc" }))).toEqual(
    latestFirst,
  );
  const sortedByCreation = rows.map((r) => r.id);
  expect(ids(await service.list(owner, { scope: "mine", order: "asc" }))).toEqual(sortedByCreation);
  expect(ids(await service.list(owner, { order: "desc" }))).toEqual(sortedByCreation.reverse());
});

test("reporting bounds and owner filters intersect current visibility before counting and paging", async () => {
  const from = "2026-10-20T10:00:00.001Z";
  const toExclusive = "2026-10-20T10:00:00.002Z";
  const seed = (actor: Actor, decision: Decision, reportingAt: string | null) => ({
    ...tripRow(newId(), actor.userId, { decision, hold: true }),
    reportingAt,
    actualEnd: "2026-10-18T08:00:00.000Z",
  });
  const atLower = seed(other, "accepted", from);
  const atUpper = seed(other, "accepted", toExclusive);
  const undated = seed(other, "accepted", null);
  const privateOther = seed(other, "pending_review", from);
  const privateOwn = seed(owner, "pending_review", from);
  await unit.run((tx) =>
    unit.client(tx).insert(trips).values([atLower, atUpper, undated, privateOther, privateOwn]),
  );
  const filter = { ownerId: other.userId };
  expect(await walk(owner, { ...filter, from }, 1, 2)).toEqual([atUpper.id, atLower.id]);
  const bounded = await service.list(owner, { ...filter, toExclusive, limit: 1 });
  expect(ids(bounded)).toEqual([atLower.id]);
  expect(bounded.total).toBe(1);
  expect(ids(await service.list(owner, { ...filter, from, toExclusive }))).toEqual([atLower.id]);
  expect((await service.list(owner, filter)).total).toBe(3);
  expect(await service.list(owner, { ...filter, scope: "mine" })).toEqual({
    items: [],
    nextCursor: null,
    total: 0,
  });
  expect(
    ids(await service.list(owner, { scope: "mine", ownerId: owner.userId, from, toExclusive })),
  ).toEqual([privateOwn.id]);
  expect(
    ids(await service.list(staff, { ...filter, scope: "review", hold: true, from, toExclusive })),
  ).toEqual([atLower.id]);
  expect(
    ids(await service.list(staff, { scope: "review", hold: true, from, toExclusive })),
  ).toEqual([privateOwn.id, privateOther.id, atLower.id]);
  await expect(service.list(owner, { ...filter, scope: "review" })).rejects.toMatchObject({
    statusCode: 403,
  });
  const first = await service.list(owner, { ...filter, from, limit: 1 });
  for (const changed of [
    { ownerId: newId() },
    { from: "2026-10-20T10:00:00.000Z" },
    { toExclusive },
    { decision: "accepted" as const },
    { order: "completion_desc" as const },
  ])
    await expect(
      service.list(owner, { ...filter, from, ...changed, cursor: first.nextCursor as string }),
    ).rejects.toMatchObject({ statusCode: 409 });
  for (const bounds of [
    { from, toExclusive: from },
    { from: toExclusive, toExclusive: from },
    { from: "2026-02-30T00:00:00.000Z" },
    { toExclusive: "2026-10-20T10:00:00.000+00:00" },
    { ownerId: "not-a-uuid" },
  ])
    await expect(service.list(owner, bounds)).rejects.toMatchObject({ statusCode: 422 });
});

test("number search is exact and allocations survive concurrent creation, replay and rollback", async () => {
  const firstPayload = fresh();
  const [received, manual] = await Promise.all([
    receive(firstPayload),
    unit.run((tx) => service.reserveManualInTransaction(tx, owner.userId, "ets2")),
    receive(fresh()),
  ]);
  const page = await service.list(owner, { scope: "mine" });
  const numbers = page.items.map((item) => item.number);
  expect(numbers).toHaveLength(3);
  expect(new Set(numbers).size).toBe(3);
  for (const number of numbers)
    expect(typeof number === "number" && Number.isSafeInteger(number) && number > 0).toBe(true);
  const receiptNumber = page.items.find((item) => item.id === received.tripId)?.number;
  expect((await receive(firstPayload)).duplicate).toBe(true);
  for (const q of [String(receiptNumber), ` #000${receiptNumber} `]) {
    const result = await service.list(owner, { scope: "mine", q, locale: "ru" });
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      id: received.tripId,
      number: receiptNumber,
      submittedAt: null,
    });
  }
  for (const q of ["0", "#000", "#4294967296", "9".repeat(128)])
    expect(await service.list(owner, { scope: "mine", q })).toEqual({
      items: [],
      nextCursor: null,
      total: 0,
    });
  await expect(
    unit.run((tx) =>
      unit
        .client(tx)
        .update(trips)
        .set({ number: receiptNumber as number })
        .where(eq(trips.id, manual)),
    ),
  ).rejects.toSatisfy(hasCode("ER_DUP_ENTRY"));

  let rolledBackNumber: number | undefined;
  await expect(
    unit.run(async (tx) => {
      const id = await service.reserveManualInTransaction(tx, owner.userId, "ets2");
      const [row] = await unit
        .client(tx)
        .select({ number: trips.number })
        .from(trips)
        .where(eq(trips.id, id));
      rolledBackNumber = row?.number;
      throw new Error("SYNTHETIC_TRIP_ALLOCATION_ROLLBACK");
    }),
  ).rejects.toThrow("SYNTHETIC_TRIP_ALLOCATION_ROLLBACK");
  expect(rolledBackNumber).toBeGreaterThan(0);
  const afterRollback = await receive(fresh());
  expect((await state(afterRollback.tripId))?.number).toBeGreaterThan(rolledBackNumber as number);
  expect((await service.list(owner, { scope: "mine", q: String(rolledBackNumber) })).total).toBe(0);
});

test("catalog search and labels use the same locale, fallback, hidden names and literal wildcard handling", async () => {
  const { trips: catalogTrips, rows } = await listedTrips();
  const nameEn = "Fictional Northern Gate";
  const nameRu = "Северный порт _%\\!";
  const initial = await unit.run(async (tx) => {
    const db = unit.client(tx);
    const [city] = await db
      .select()
      .from(catalogCities)
      .where(eq(catalogCities.id, rows.id("fixture_north")));
    const [member] = await db
      .select({ locale: membership.locale })
      .from(membership)
      .where(eq(membership.userId, owner.userId));
    if (!city || !member) throw new Error("SYNTHETIC_SEARCH_FIXTURE_MISSING");
    await db.update(catalogCities).set({ nameEn, nameRu }).where(eq(catalogCities.id, city.id));
    await db.update(membership).set({ locale: "ru" }).where(eq(membership.userId, owner.userId));
    return { city, locale: member.locale };
  });
  try {
    const [a, b] = await Promise.all([
      receive(fresh(), catalogTrips),
      receive(fresh(), catalogTrips),
    ]);
    const opts = { scope: "mine" as const, q: "  порт  ", limit: 1 };
    const first = await catalogTrips.list(owner, opts);
    expect(first.total).toBe(2);
    expect(first.items[0]?.origin).toMatchObject({
      label: nameRu,
      requestedLocale: "ru",
      renderedLocale: "ru",
    });
    const cursor = first.nextCursor as string;
    const next = await catalogTrips.list(owner, { ...opts, q: "порт", locale: "ru", cursor });
    expect(next.total).toBe(2);
    expect(new Set([...ids(first), ...ids(next)])).toEqual(new Set([a.tripId, b.tripId]));
    await expect(
      catalogTrips.list(owner, { ...opts, q: "Северный", cursor }),
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(catalogTrips.list(owner, { ...opts, locale: "en", cursor })).rejects.toMatchObject(
      { statusCode: 409 },
    );
    expect((await catalogTrips.list(owner, { ...opts, q: nameEn })).total).toBe(0);
    expect(
      (await catalogTrips.list(owner, { ...opts, q: nameEn, locale: "en" })).items[0]?.origin,
    ).toMatchObject({ label: nameEn, requestedLocale: "en" });
    const fallback = await catalogTrips.list(owner, { ...opts, q: "Fictional south" });
    expect(fallback.total).toBe(2);
    expect(fallback.items[0]?.destination).toMatchObject({
      label: "Fictional south",
      requestedLocale: "ru",
      renderedLocale: "en",
      englishFallback: true,
    });
    expect((await catalogTrips.list(owner, { ...opts, q: "Fictional crates" })).total).toBe(2);
    expect((await catalogTrips.list(owner, { ...opts, q: "_%\\!" })).total).toBe(2);
    expect((await catalogTrips.list(owner, { ...opts, q: "ficti_nal%" })).total).toBe(0);
    const renamed = "Новое имя";
    await unit.run((tx) =>
      unit
        .client(tx)
        .update(catalogCities)
        .set({ nameRu: renamed, hidden: true })
        .where(eq(catalogCities.id, initial.city.id)),
    );
    expect((await catalogTrips.list(owner, opts)).total).toBe(0);
    const hidden = await catalogTrips.list(owner, { ...opts, q: renamed });
    expect(hidden.total).toBe(2);
    expect(hidden.items[0]?.origin).toMatchObject({ label: renamed, hidden: true });
    await unit.run((tx) =>
      unit
        .client(tx)
        .update(membership)
        .set({ locale: "en" })
        .where(eq(membership.userId, owner.userId)),
    );
    await expect(catalogTrips.list(owner, { ...opts, cursor })).rejects.toMatchObject({
      statusCode: 409,
    });
  } finally {
    await unit.run(async (tx) => {
      const db = unit.client(tx);
      await db
        .update(catalogCities)
        .set({
          nameEn: initial.city.nameEn,
          nameRu: initial.city.nameRu,
          hidden: initial.city.hidden,
        })
        .where(eq(catalogCities.id, initial.city.id));
      await db
        .update(membership)
        .set({ locale: initial.locale })
        .where(eq(membership.userId, owner.userId));
    });
  }
});

test("source filter matches the canonical group per scope, combines with filters and keeps omitted unchanged", async () => {
  const m = await sourceMatrix();
  // Omitted: no source predicate, sourceless trips included, alias members never listed.
  const all = await service.list(owner, { scope: "mine" });
  expect(ids(all)).toEqual([...m.F, m.T5, m.T4, m.T3, m.T2, m.T1]);
  expect(all.items.find((item) => item.id === m.T4)?.sourceKinds).toEqual([]);
  const omitted = await service.list(owner, { scope: "mine", limit: 2 });
  expect(omitted.nextCursor).not.toBeNull();
  expect(
    ids(
      await service.list(owner, { scope: "mine", limit: 2, cursor: omitted.nextCursor as string }),
    ),
  ).toEqual([m.F[2], m.F[3]]);
  const cases: [Actor, ListArgs, string[]][] = [
    [owner, { scope: "mine", source: "manual" }, [m.T5, m.T3, m.T2]],
    [owner, { scope: "mine", source: "ets2telemetry" }, [...m.F, m.T5, m.T3, m.T1]],
    [other, { scope: "company", source: "manual" }, [m.T6, m.T5, m.T3]],
    [other, { scope: "company", source: "ets2telemetry" }, [m.T5, m.T3, m.T1]],
    [staff, { scope: "review", source: "manual" }, [m.T7, m.T6, m.T5, m.T3, m.T2]],
    [staff, { scope: "review", source: "ets2telemetry" }, [...m.F, m.T8, m.T5, m.T3, m.T1]],
    [owner, { scope: "mine", decision: "pending_review", source: "manual" }, [m.T2]],
    [owner, { scope: "company", game: "ats", source: "manual" }, [m.T6, m.T3]],
    [staff, { scope: "review", hold: true, source: "manual" }, [m.T7, m.T2]],
    [staff, { scope: "review", hold: true, order: "asc", source: "manual" }, [m.T2, m.T7]],
    [staff, { scope: "review", hold: true, source: "ets2telemetry" }, [m.T8]],
    // Permission filtering is unchanged: other members' unaccepted trips stay private.
    [other, { scope: "mine", source: "manual" }, [m.T7, m.T6]],
  ];
  for (const [actor, options, expected] of cases) {
    const page = await service.list(actor, options);
    expect(ids(page), JSON.stringify(options)).toEqual(expected);
    for (const item of page.items) expect(item.sourceKinds).toContain(options.source);
    expect(ids(page)).not.toContain(m.A5);
    expect(ids(page)).not.toContain(m.T4);
  }
  for (const source of ["manual", "ets2telemetry"] as const) {
    const company = ids(await service.list(owner, { scope: "company", source }));
    for (const hidden of [m.T2, m.T4, m.T7, m.T8]) expect(company).not.toContain(hidden);
  }
  const mixed = (await service.list(owner, { scope: "mine", source: "manual" })).items[0];
  expect(mixed?.id).toBe(m.T5);
  expect([...(mixed?.sourceKinds ?? [])].sort()).toEqual(["ets2telemetry", "manual"]);
  await expect(service.list(owner, { scope: "review", source: "manual" })).rejects.toMatchObject({
    statusCode: 403,
  });
  for (const source of ["telemetry", "", "x"])
    await expect(
      service.list(owner, { scope: "mine", source: source as never }),
    ).rejects.toMatchObject({ statusCode: 422 });
});
test("source filter applies before keyset limits and binds the cursor to the source", async () => {
  const m = await sourceMatrix();
  expect(await walk(owner, { scope: "mine", source: "manual" }, 2)).toEqual([m.T5, m.T3, m.T2]);
  expect(await walk(staff, { scope: "review", source: "manual" }, 2)).toEqual([
    m.T7,
    m.T6,
    m.T5,
    m.T3,
    m.T2,
  ]);
  const telemetry = await walk(owner, { scope: "mine", source: "ets2telemetry" }, 3);
  expect(telemetry).toEqual(
    ids(await service.list(owner, { scope: "mine", source: "ets2telemetry", limit: 100 })),
  );
  expect(new Set(telemetry).size).toBe(telemetry.length);
  const manual = await service.list(owner, { scope: "mine", source: "manual", limit: 1 }),
    plain = await service.list(owner, { scope: "mine", limit: 1 }),
    held = await service.list(staff, { scope: "review", hold: true, source: "manual", limit: 1 });
  expect(manual.nextCursor).not.toBeNull();
  const replays: [Actor, ListArgs][] = [
    [owner, { scope: "mine", source: "ets2telemetry", cursor: manual.nextCursor as string }],
    [owner, { scope: "mine", cursor: manual.nextCursor as string }],
    [owner, { scope: "mine", source: "manual", cursor: plain.nextCursor as string }],
    [
      staff,
      { scope: "review", hold: true, source: "ets2telemetry", cursor: held.nextCursor as string },
    ],
    [staff, { scope: "review", hold: true, cursor: held.nextCursor as string }],
  ];
  for (const [actor, options] of replays)
    await expect(service.list(actor, options), JSON.stringify(options)).rejects.toMatchObject({
      statusCode: 409,
    });
  expect(
    ids(
      await service.list(staff, {
        scope: "review",
        hold: true,
        source: "manual",
        limit: 1,
        cursor: held.nextCursor as string,
      }),
    ),
  ).toEqual([m.T2]);
});
test("HTTP source query is validated, permission filtered and cursor bound", async () => {
  const m = await sourceMatrix();
  const app = await createApp({ checkReadiness: async () => true, identity, trips: service });
  const get = (query: string, cookie: string | null = ownerCookie) =>
    app.inject({ url: `/api/v1/trips?${query}`, headers: cookie ? { cookie } : {} });
  try {
    const ok = await get("scope=mine&source=manual");
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["cache-control"]).toBe("no-store");
    expect(ok.json().data.items.map((item: { id: string }) => item.id)).toEqual([m.T5, m.T3, m.T2]);
    for (const query of [
      "scope=mine&source=telemetry",
      "scope=mine&source=Manual",
      "scope=mine&source=",
      "scope=mine&source=manual&source=ets2telemetry",
    ]) {
      const invalid = await get(query);
      expect(invalid.statusCode, query).toBe(422);
      expect(invalid.json().error.code, query).toBe("INVALID_PAYLOAD");
      expect(invalid.json(), query).not.toHaveProperty("data");
    }
    expect((await get("scope=mine&source=manual", null)).statusCode).toBe(401);
    expect((await get("scope=review&source=manual")).statusCode).toBe(403);
    const first = (await get("scope=mine&source=manual&limit=1")).json().data.nextCursor;
    const replay = await get(
      `scope=mine&source=ets2telemetry&limit=1&cursor=${encodeURIComponent(first)}`,
    );
    expect(replay.statusCode).toBe(409);
    expect(replay.json().error.code).toBe("VERSION_CONFLICT");
    const next = await get(`scope=mine&source=manual&limit=1&cursor=${encodeURIComponent(first)}`);
    expect(next.json().data.items.map((item: { id: string }) => item.id)).toEqual([m.T3]);
  } finally {
    await app.close();
  }
});
test("source filter keeps each scope's page index with ref probes and no outer filesort", async () => {
  const rows = Array.from({ length: 600 }, (_, i) =>
    // Same shape as the guard above: a small owner/accepted/held share of a mixed history.
    tripRow(newId(), i % 20 ? other.userId : owner.userId, {
      game: i % 3 ? "ets2" : "ats",
      decision: i % 10 ? "unassessed" : "accepted",
      hold: i >= 570,
    }),
  );
  const members = Array.from({ length: 20 }, (_, i) => {
    const root = rows[i * 30] as (typeof rows)[number];
    return tripRow(newId(), root.ownerId, { game: root.game }, root.id);
  });
  const sources = [
    ...rows.map((row) => sourceRow(row.id, row.ownerId, row.game, "ets2telemetry")),
    ...rows
      .filter((_, i) => i % 10 === 0)
      .map((row) => sourceRow(row.id, row.ownerId, row.game, "manual")),
    ...members.map((row) => sourceRow(row.id, row.ownerId, row.game, "manual")),
  ];
  await unit.run(async (tx) => {
    const db = unit.client(tx);
    await db.insert(trips).values(rows);
    await db.insert(trips).values(members);
    for (let n = 0; n < sources.length; n += 200)
      await db.insert(sourceTrips).values(sources.slice(n, n + 200));
  });
  await control.query("ANALYZE TABLE trips, source_trips");
  const last = rows[300] as (typeof rows)[number];
  // The service's own list predicate and keyset order, so the guard checks the real query.
  const plan = async (
    scope: "company" | "mine" | "review",
    source: SourceKind,
    extra: { game?: "ats"; hold?: boolean; order?: "asc"; after?: boolean } = {},
  ) => {
    const query = await unit.run(async (tx) => {
      const db = unit.client(tx);
      const q = tripListQuery(db, {
        scope,
        viewerId: owner.userId,
        game: extra.game,
        hold: extra.hold,
        source,
        order: extra.order,
        after: extra.after ? { instant: last.createdAt, id: last.id } : null,
      });
      return db
        .select()
        .from(trips)
        .where(q.where)
        .orderBy(...q.orderBy)
        .limit(26)
        .toSQL();
    });
    const [table] = await control.query<RowDataPacket[]>(`EXPLAIN ${query.sql}`, query.params);
    const [tree] = await control.query<RowDataPacket[]>(
      `EXPLAIN FORMAT=TREE ${query.sql}`,
      query.params,
    );
    return { table, tree: String(Object.values(tree[0] ?? {})[0]) };
  };
  const checked = async (name: string, keys: string[], ...args: Parameters<typeof plan>) => {
    const { table, tree } = await plan(...args),
      evidence = `${name}\n${JSON.stringify(table)}\n${tree}`;
    const [outer, ...dependent] = table;
    expect(keys, evidence).toContain(outer?.key);
    expect(String(outer?.Extra ?? ""), evidence).not.toMatch(/filesort|temporary/i);
    expect(dependent.length, evidence).toBe(3);
    for (const row of dependent) {
      expect(row.select_type, evidence).toBe("DEPENDENT SUBQUERY");
      expect(row.type, evidence).toBe("ref");
      expect(row.key, evidence).toBe(
        row.table === "source_member" ? "trip_group_members" : "source_canonical",
      );
    }
    for (const row of table) expect(row.type, evidence).not.toBe("ALL");
    expect(tree, evidence).not.toMatch(/semijoin|materializ/i);
  };
  await checked("E1", ["trip_company_page"], "company", "manual");
  await checked("E2", ["trip_game_page", "trip_company_page"], "company", "manual", {
    game: "ats",
  });
  await checked("E3", ["trip_owner_page"], "mine", "manual");
  await checked("E4", ["trip_review_queue"], "review", "manual", { hold: true, order: "asc" });
  await checked("E6", ["trip_owner_page"], "mine", "ets2telemetry", { after: true });
  // Review without hold has no page index today; its source probes must still be ref lookups.
  const { table: unheld } = await plan("review", "ets2telemetry");
  for (const row of unheld.slice(1)) expect(row.type).toBe("ref");
});

test("EXPLAIN covers owner reporting bounds, completion and localized page and count", async () => {
  const { catalogs, trips: catalogTrips } = await listedTrips();
  const matched = await receive(fresh(), catalogTrips);
  const rows = Array.from({ length: 600 }, (_, i) => {
    const row = tripRow(newId(), i % 10 === 1 ? owner.userId : other.userId, {
      game: i % 3 ? "ets2" : "ats",
      decision: i % 4 ? "accepted" : "unassessed",
    });
    return {
      ...row,
      reportingAt: i % 7 ? row.createdAt : null,
      actualEnd: i % 5 ? row.createdAt : null,
    };
  });
  await unit.run(async (tx) => {
    const db = unit.client(tx);
    await db.update(trips).set({ decision: "accepted" }).where(eq(trips.id, matched.tripId));
    await db.insert(trips).values(rows);
  });
  await control.query("ANALYZE TABLE trips, trip_facts, catalog_cities, catalog_cargoes");

  const first = rows[0] as (typeof rows)[number];
  const upper = rows[31] as (typeof rows)[number];
  const queries = await unit.run(async (tx) => {
    const db = unit.client(tx);
    const base = { scope: "company" as const, viewerId: owner.userId };
    const ownerReporting = tripListQuery(db, {
      ...base,
      ownerId: owner.userId,
      from: first.createdAt,
      toExclusive: upper.createdAt,
    });
    const completion = tripListQuery(db, {
      ...base,
      order: "completion_asc",
      after: { instant: upper.actualEnd, id: upper.id },
    });
    const localized = tripListQuery(db, {
      ...base,
      searchCondition: tripSearchCondition(
        unit,
        tx,
        catalogs.labelSearchCondition,
        { label: "Fictional north" },
        "ru",
      ),
    });
    const page = (query: ReturnType<typeof tripListQuery>) =>
      db
        .select()
        .from(trips)
        .where(query.where)
        .orderBy(...query.orderBy)
        .limit(26)
        .toSQL();
    return {
      ownerReporting: page(ownerReporting),
      completion: page(completion),
      localizedPage: page(localized),
      localizedCount: db
        .select({ total: sql<string>`COUNT(*)` })
        .from(trips)
        .where(localized.filtered)
        .toSQL(),
    };
  });
  const explain = async (query: { sql: string; params: unknown[] }) => {
    const [plan] = await control.query<RowDataPacket[]>(`EXPLAIN ${query.sql}`, query.params);
    return plan;
  };
  const [ownerPlan, completionPlan, labelPagePlan, labelCountPlan] = await Promise.all([
    explain(queries.ownerReporting),
    explain(queries.completion),
    explain(queries.localizedPage),
    explain(queries.localizedCount),
  ]);
  const ownerAccess = ownerPlan.find((row) => row.table === "trips");
  const possible = String(ownerAccess?.possible_keys ?? "").split(",");
  expect([...possible, ownerAccess?.key]).toContain("trip_owner_reporting");
  expect(completionPlan.some((row) => row.table === "trips")).toBe(true);
  expect(queries.completion.sql).toMatch(
    /order by `trips`\.`actual_end` is null asc, `trips`\.`actual_end` asc, `trips`\.`id` asc/i,
  );
  for (const plan of [labelPagePlan, labelCountPlan])
    expect(plan.map((row) => row.table)).toEqual(
      expect.arrayContaining(["trips", "trip_facts", "catalog_cities", "catalog_cargoes"]),
    );
  expect(queries.localizedCount.sql).not.toMatch(/order by|limit/i);

  const accesses = (plan: RowDataPacket[]) =>
    plan.map((row) => ({
      table: row.table,
      access: row.type,
      index: row.key,
      estimatedRows: row.rows,
      filesort: /filesort/i.test(String(row.Extra ?? "")),
    }));
  console.log(
    JSON.stringify({
      event: "trip_list_explain",
      ownerReporting: accesses(ownerPlan),
      completion: accesses(completionPlan),
      localizedPage: accesses(labelPagePlan),
      localizedCount: accesses(labelCountPlan),
    }),
  );
});

test("private normalized telemetry facts retain supported actual timing, zero, planned distance and unknown completeness", async () => {
  const p = fixture();
  p.eventId = newId();
  p.source.tripId = newId();
  p.source.pluginSessionId = newId();
  if (p.snapshot.observedDistance.available) p.snapshot.observedDistance.value = 0;
  const r = await receive(p),
    view = await service.detail(owner, r.tripId);
  if (view.view !== "private") throw Error("EXPECTED_PRIVATE_TRIP");
  expect(view.effectiveFacts).toMatchObject({
    provider: "ets2telemetry",
    actualDistanceM: "0",
    plannedDistanceM: "120000",
    actualStartAt: new Date(p.snapshot.start.utcMs as number).toISOString(),
    actualCompletedAt: new Date(p.snapshot.end?.utcMs as number).toISOString(),
  });
  expect(view.summary.reportingBasis).toBe("actual_completion");
  const partial = fixture("closed-partial");
  partial.eventId = newId();
  partial.source.tripId = newId();
  partial.source.pluginSessionId = newId();
  const result = await receive(partial),
    read = await service.detail(owner, result.tripId);
  if (read.view !== "private") throw Error("EXPECTED_PRIVATE_TRIP");
  expect(read.effectiveFacts?.actualDistanceM).toBeNull();
  expect(read.effectiveFacts?.wholeTripDistanceSupported).toBe(false);
  expect(read.summary.recording).toBe("partial");
});
