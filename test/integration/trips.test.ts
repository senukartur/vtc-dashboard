import { randomBytes } from "node:crypto";
import { createUnitOfWork, newId, runMigrations, type UnitOfWork } from "@vtc/db";
import { membership, roles } from "@vtc/db/identity-schema";
import {
  eq,
  sourceMessages,
  sourcePayloads,
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
import {
  type Actor,
  createIdentity,
  type Identity,
} from "../../apps/api/src/modules/identity/service.ts";
import { canonicalJson } from "../../apps/api/src/modules/sources/contracts/canonical.ts";
import type { NormalizedTripEvidence } from "../../apps/api/src/modules/sources/contracts/evidence.ts";
import type { Telemetry } from "../../apps/api/src/modules/sources/contracts/telemetry.ts";
import {
  createTrips,
  type SourceContext,
  type Trips,
} from "../../apps/api/src/modules/trips/service.ts";
import { createQueue, retryTransaction } from "../../apps/api/src/platform/jobs/queue.ts";
import { runPass } from "../../apps/api/src/platform/jobs/runner.ts";
import {
  catalogEvents,
  createOutbox,
  identityAccessEvents,
} from "../../apps/api/src/platform/outbox/events.ts";
import { artifact, entity } from "../fixtures/catalogs/synthetic.ts";
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
test("relational facts preserve zero, precision, nulls, times and ordered trailers independently of redundant evidence", async () => {
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
    originEntityId: null,
    originFactId: null,
    startBasis: "event",
    startVerified: true,
    endBasis: "event",
    endVerified: true,
    trailerCount: 2,
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
  expect(children.map((row) => row.position)).toEqual([0, 1]);
  expect(children.every((row) => row.entityId === null && row.unknownReason !== null)).toBe(true);
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
  const result = await receive(p),
    lower = fixture("cancelled");
  lower.source = p.source;
  lower.eventId = newId();
  lower.revision = 2;
  await receive(lower);
  const detail = await service.detail(owner, result.tripId);
  expect(detail.view).toBe("private");
  if (detail.view !== "private") throw new Error("SYNTHETIC_PRIVATE_VIEW_EXPECTED");
  expect(detail.reviewReasonCodes).toContain("terminal_outcome_conflict");
  expect(detail.summary.outcome).toBe("delivered");
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
  const p = fixture(),
    result = await receive(p);
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
  const pending = await receive(fixture());
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
    for (const field of ["snapshot", "sourceRecordId", "eventId", "money", "reviewReasonCodes"])
      expect(JSON.stringify(json)).not.toContain(`"${field}"`);
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
  });
  expect((await service.status(other)).counts.accepted).toBe(0);
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
test("manual internal adapter uses published canonical selections, evidence port and unknown source dates", async () => {
  const catalogs = createCatalogs(
    unit,
    {
      production: false,
      synthetic: true,
      cursorKey: randomBytes(32).toString("hex"),
      maxFileBytes: 1024 * 1024,
      artifactTtlMs: 86400000,
      policyRevision: 1,
      evidence: [],
    },
    { identity, published: catalogEvents(unit).append },
  );
  const mapped = (sourceId: string) => ({
    mapNamespace: "official",
    mappings: [{ provider: "ets2telemetry", sourceId }],
  });
  const a = artifact("ets2", [
    entity("north", mapped("fixture_north")),
    entity("south", mapped("fixture_south")),
    entity("load", { ...mapped("fixture_crates"), kind: "cargo" }),
    entity("box", { ...mapped("fixture_trailer"), kind: "trailer_type" }),
  ]);
  const uploaded = await catalogs.upload(staff, newId(), Buffer.from(JSON.stringify(a)));
  const op = await catalogs.import(staff, newId(), {
    artifactId: uploaded.id,
    sha256: uploaded.sha256,
    game: "ets2",
  });
  await runPass(createQueue(unit, [catalogs.handler]), new AbortController().signal);
  const revisionId = (await catalogs.operation(staff, op.id)).resultId as string;
  const r = await catalogs.detail(staff, revisionId);
  await catalogs.publish(staff, revisionId, newId(), r.version, {
    expectedPublicationVersion: r.publicationVersion,
    reason: "Fictional reviewed source",
  });
  const city = await catalogs.entities(staff, { revisionId, kind: "city", locale: "en" });
  const cargo = await catalogs.entities(staff, { revisionId, kind: "cargo", locale: "en" });
  const trailer = await catalogs.entities(staff, {
    revisionId,
    kind: "trailer_type",
    locale: "en",
  });
  const p = {
    reportId: newId(),
    revisionId: newId(),
    revision: 1,
    game: "ets2",
    catalogRevisionId: revisionId,
    originId: city.items.find((item) => item.display.label === "Fictional north")?.id,
    destinationId: city.items.find((item) => item.display.label === "Fictional south")?.id,
    cargoId: cargo.items[0]?.id,
    trailerTypeId: trailer.items[0]?.id,
    cargoMassKg: "1000.5",
    actualDistanceM: "1234.5",
    evidenceIds: [newId()],
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
    value: { entityId: p.cargoId, catalogRevisionId: revisionId },
  });
  expect(sourceFact.trailers.items[0]).toMatchObject({
    status: "known",
    value: { entityId: p.trailerTypeId, catalogRevisionId: revisionId },
  });
  expect(
    await unit
      .run((tx) =>
        unit
          .client(tx)
          .update(tripFacts)
          .set({ cargoEntityId: p.originId })
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
          .set({ entityId: p.cargoId })
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
  const next = structuredClone(a);
  next.gameBuild = "synthetic-build-next";
  for (const item of next.entities) item.labels.en = `Later ${item.labels.en}`;
  const nextUpload = await catalogs.upload(staff, newId(), Buffer.from(JSON.stringify(next)));
  const nextOp = await catalogs.import(staff, newId(), {
    artifactId: nextUpload.id,
    sha256: nextUpload.sha256,
    game: "ets2",
  });
  await runPass(createQueue(unit, [catalogs.handler]), new AbortController().signal);
  const nextId = (await catalogs.operation(staff, nextOp.id)).resultId as string;
  const nextRevision = await catalogs.detail(staff, nextId);
  await catalogs.publish(staff, nextId, newId(), nextRevision.version, {
    expectedPublicationVersion: nextRevision.publicationVersion,
    reason: "Fictional later build",
  });
  expect(
    await unit.run((tx) => catalogs.publishedInTransaction(tx, "ets2", "synthetic-build")),
  ).toBe(revisionId);
  const pinnedView = await manual.detail(owner, result.tripId);
  if (pinnedView.view !== "private") throw new Error("SYNTHETIC_PRIVATE_VIEW_EXPECTED");
  expect(pinnedView.summary.origin?.label).toBe("Fictional north");
  const mismatch = fixture();
  mismatch.eventId = newId();
  mismatch.source.tripId = newId();
  mismatch.snapshot.context.gameBuild = { available: true, value: "SYNTHETIC-BUILD" };
  const unknown = await receive(mismatch, manual);
  const [unknownFact] = await unit.run((tx) =>
    unit.client(tx).select().from(tripFacts).where(eq(tripFacts.canonicalTripId, unknown.tripId)),
  );
  if (!unknownFact) throw new Error("SYNTHETIC_FACT_EXPECTED");
  expect(unknownFact.catalogRevisionId).toBeNull();
  expect(
    (await unit.run((tx) => manual.sourceEvidenceInTransaction(tx, unknown.sourceRecordId)))?.cargo,
  ).toMatchObject({
    status: "unknown",
    reasonCode: "catalog_build_unavailable",
  });
  expect((await state(unknown.tripId))?.decision).toBe("unassessed");
});
test("representative mixed history uses bounded ordered company and owner indexes", async () => {
  const rows = Array.from({ length: 600 }, (_, i) => ({
    id: newId(),
    ownerId: i < 15 ? owner.userId : other.userId,
    game: i % 2 ? ("ets2" as const) : ("ats" as const),
    version: 1,
    outcome: "delivered" as const,
    recording: "partial" as const,
    decision: i < 30 ? ("accepted" as const) : ("unassessed" as const),
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
  expect(company[0]?.key).toBe("trip_company_page");
  expect(mine[0]?.key).toBe("trip_owner_page");
  expect(Number(company[0]?.rows)).toBeLessThan(600);
  expect(Number(mine[0]?.rows)).toBeLessThan(600);
});
