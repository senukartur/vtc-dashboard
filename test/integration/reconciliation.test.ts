import { randomBytes } from "node:crypto";
import { request } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { components } from "@vtc/contracts";
import {
  createUnitOfWork,
  newId,
  runMigrations,
  TransactionCommitOutcomeUnknownError,
  type UnitOfWork,
} from "@vtc/db";
import { and, eq, roles } from "@vtc/db/identity-schema";
import { manualEvidence } from "@vtc/db/manual-reports-schema";
import { sql, tripContributions, trips } from "@vtc/db/trips-schema";
import type { Connection, RowDataPacket } from "mysql2/promise";
import { beforeEach, expect, test, afterAll as vAfter, beforeAll as vBefore } from "vitest";
import type { createApp } from "../../apps/api/src/app.ts";
import { createCatalogs } from "../../apps/api/src/modules/catalogs/service.ts";
import { csrfProtection } from "../../apps/api/src/modules/identity/http.ts";
import {
  type Actor,
  createIdentity,
  type Identity,
} from "../../apps/api/src/modules/identity/service.ts";
import {
  createManualReports,
  type ManualReports,
} from "../../apps/api/src/modules/manual-reports/service.ts";
import {
  createQualificationInitialization,
  structuralLevels,
} from "../../apps/api/src/modules/qualifications/initialization.ts";
import {
  createQualifications,
  type Qualifications,
} from "../../apps/api/src/modules/qualifications/service.ts";
import {
  createReconciliation,
  type Reconciliation,
} from "../../apps/api/src/modules/reconciliation/service.ts";
import type { Telemetry } from "../../apps/api/src/modules/sources/contracts/telemetry.ts";
import { createTrips, type Trips } from "../../apps/api/src/modules/trips/service.ts";
import { retryTransaction } from "../../apps/api/src/platform/jobs/queue.ts";
import { catalogEvents, identityAccessEvents } from "../../apps/api/src/platform/outbox/events.ts";
import { composeIdentity } from "../../apps/api/src/use-cases/identity-messaging.ts";
import {
  guardedSettings,
  reset,
  SCHEMA_SETUP_TIMEOUT_MS,
  testConnection,
} from "../persistence/support.ts";
import { telemetryFixture } from "../support/builders.ts";
import { deferred } from "../support/concurrency.ts";
import { schemaLifecycleHooks } from "../support/schema-lifecycle.ts";

const { beforeAll, afterAll } = schemaLifecycleHooks(vBefore, vAfter);
type S = components["schemas"];
let control: Connection,
  unit: UnitOfWork,
  identity: Identity,
  tripService: Trips,
  manual: ManualReports,
  qualifications: Qualifications,
  service: Reconciliation;
let owner: Actor,
  other: Actor,
  director: Actor,
  dispatcher: Actor,
  deputy: Actor,
  directorCookie: string;
let instant = Date.parse("2026-10-10T12:00:00.000Z");
const now = () => new Date(instant),
  iso = () => now().toISOString();
const emails = new Map<string, string>();
const password = "Fictional-reconciliation-passphrase-42",
  origin = "http://127.0.0.1:4173",
  identityConfig = { secret: randomBytes(32).toString("hex"), origin, production: false },
  tripConfig = { cursorKey: randomBytes(32).toString("hex") },
  qualConfig = { cursorKey: randomBytes(32).toString("hex") },
  config = {
    key: randomBytes(32).toString("hex"),
    rule: { version: 1, startToleranceMs: 1000, endToleranceMs: 1000, distanceToleranceM: "0.01" },
  },
  catalogConfig = {
    production: false,
    synthetic: true,
    cursorKey: randomBytes(32).toString("hex"),
    maxFileBytes: 1048576,
    artifactTtlMs: 86400000,
    policyRevision: 1,
    evidence: [],
  },
  manualConfig = {
    key: randomBytes(32).toString("hex"),
    maxFilesPerReport: 5,
    policyRevision: 1,
    orphanGraceMs: 60000,
  };
async function member(assigned: ("driver" | "dispatcher" | "deputy_director")[] = ["driver"]) {
  const userId = newId(),
    email = `${userId}@example.invalid`,
    credential = await identity.prepareCredential(password);
  await unit.run(async (tx) => {
    await identity.insertWithCredential(tx, {
      userId,
      email,
      name: "Fictional Reconciliation Member",
      ...credential,
      roles: assigned,
    });
    await createQualificationInitialization(unit).initialize(tx, {
      userId,
      games: ["ets2", "ats"],
      assignedAt: iso(),
    });
  });
  emails.set(userId, email);
  const login = await identity.login(email, password),
    cookie = login.cookies.map((v) => v.split(";", 1)[0]).join("; ");
  return identity.authenticate(new Headers({ cookie }));
}
beforeAll(async () => {
  control = await testConnection();
  unit = createUnitOfWork(guardedSettings());
  await reset(control);
  await runMigrations(guardedSettings());
  identity = createIdentity(unit, identityConfig, { accessEvents: identityAccessEvents(unit) });
  await identity.bootstrap({
    email: "reconciliation-director@example.invalid",
    name: "Fictional Reconciliation Director",
    password,
  });
  const login = await identity.login("reconciliation-director@example.invalid", password);
  directorCookie = login.cookies.map((v) => v.split(";", 1)[0]).join("; ");
  director = await identity.authenticate(new Headers({ cookie: directorCookie }));
  owner = await member();
  other = await member();
  dispatcher = await member(["dispatcher"]);
  deputy = await member(["deputy_director"]);
  const catalogs = createCatalogs(
    unit,
    catalogConfig,
    { identity, published: catalogEvents(unit).append },
    now,
  );
  tripService = createTrips(
    unit,
    tripConfig,
    {
      identity,
      catalogs,
      prepare: async (tx, ownerId, game) => {
        await qualifications.prepareInTransaction(tx, [{ ownerId, game }]);
      },
      sourceStored: (tx, id, record) => service.refreshInTransaction(tx, id, record),
      manualEvidence: (tx, owner, payload, id) =>
        manual.validateSourceInTransaction(tx, owner, payload, id),
      manualProjection: (tx, ids) => manual.projectionInTransaction(tx, ids),
    },
    now,
  );
  qualifications = createQualifications(
    unit,
    qualConfig,
    { identity, trips: tripService, catalogs },
    now,
  );
  manual = createManualReports(unit, manualConfig, { identity, catalogs, trips: tripService }, now);
  service = createReconciliation(
    unit,
    config,
    { identity, trips: tripService, qualifications, manual },
    now,
  );
  const levels = await qualifications.levels(director, "ets2"),
    level = levels.items.find((v) => v.id === structuralLevels.ets2[0]);
  if (!level) throw new Error("SYNTHETIC_LEVEL_MISSING");
  await qualifications.publish(director, level.id, newId(), level.version, {
    rules: [{ type: "max_mass", maxKg: "20000" }],
    requiredTrips: 1,
    requiredDistanceM: "100",
    reason: "Fictional test configuration",
  });
}, SCHEMA_SETUP_TIMEOUT_MS);
beforeEach(async () => {
  await control.query("UPDATE manual_reports SET current_revision_id=NULL");
  await control.query("UPDATE trips SET alias_of=NULL");
  for (const table of [
    "reconciliation_commands",
    "reconciliation_history",
    "reconciliations",
    "reconciliation_candidates",
    "reconciliation_rules",
    "manual_commands",
    "manual_correction_history",
    "manual_correction_requests",
    "manual_evidence_refs",
    "manual_revisions",
    "manual_reports",
    "manual_review_gates",
    "manual_evidence",
    "trip_contribution_history",
    "trip_contributions",
    "qualification_promotion_reviews",
    "qualification_promotions",
    "trip_history",
    "trip_fact_trailers",
    "trip_facts",
    "source_payloads",
    "source_messages",
    "source_trips",
    "trips",
    "outbox_events",
    "identity_limits",
  ])
    await control.query(`DELETE FROM ${table}`);
  instant = Date.parse("2026-10-21T12:00:00.000Z");
});
afterAll(async () => {
  await unit?.close();
  await control?.end();
});
function payload(kind: "completed" | "started" = "completed") {
  const p = telemetryFixture(kind) as unknown as Telemetry;
  p.eventId = newId();
  p.source.tripId = newId();
  p.source.pluginSessionId = newId();
  if (p.snapshot.start.utcMs !== null) p.snapshot.start.utcMs = instant - 60000;
  if (p.snapshot.end?.utcMs !== null && p.snapshot.end) p.snapshot.end.utcMs = instant;
  p.createdUtcMs = instant;
  return p;
}
const receive = (p = payload(), who = owner, target = tripService) =>
  retryTransaction(unit, (tx) =>
    target.storeInTransaction(tx, "ets2telemetry", p, {
      ownerUserId: who.userId,
      connection: { state: "unknown", referenceId: null },
    }),
  );
async function image(who = owner) {
  const id = newId();
  await unit.run((tx) =>
    unit
      .client(tx)
      .insert(manualEvidence)
      .values({
        id,
        ownerId: who.userId,
        state: "ready",
        generation: newId(),
        originalName: "fictional.png",
        contentType: "image/png",
        byteLength: 1,
        sha256: randomBytes(32),
        fingerprint: randomBytes(32),
        createdAt: iso(),
        updatedAt: iso(),
        nextCheckAt: iso(),
      }),
  );
  return id;
}
function fields(evidenceId: string): S["ManualSubmissionFields"] {
  const unresolved = {
    status: "unresolved" as const,
    label: "Fictional unresolved selection",
    reasonCode: "not_listed" as const,
    locale: "en" as const,
    context: null,
  };
  return {
    game: "ets2",
    origin: unresolved,
    destination: unresolved,
    cargo: unresolved,
    trailerType: unresolved,
    cargoMassKg: "1000",
    actualDistanceM: "123400",
    evidenceIds: [evidenceId],
  };
}
async function report(who = owner, target = manual) {
  return target.submitReport(who, newId(), { fields: fields(await image(who)) });
}
async function state(id: string) {
  return unit.run(
    async (tx) => (await unit.client(tx).select().from(trips).where(eq(trips.id, id)))[0],
  );
}
async function merge(a: string, b: string, actor = director, key = newId()) {
  const p = await state(a),
    s = await state(b);
  if (!p || !s) throw new Error("SYNTHETIC_TRIPS_MISSING");
  return service.merge(actor, key, {
    primaryTripId: a,
    secondaryTripId: b,
    primaryVersion: p.version,
    secondaryVersion: s.version,
    reason: "Fictional duplicate evidence review",
  });
}
async function reverse(id: string, actor = director, key = newId()) {
  const current = await service.get(actor, id);
  return service.reverse(actor, id, key, current.version, {
    primaryVersion: current.data.primaryVersion,
    secondaryVersion: current.data.secondaryVersion,
    reason: "Fictional independent journey review",
  });
}
async function accepted(id: string, report?: S["ManualReport"], who = owner) {
  await identity.transaction(async (tx) => {
    await qualifications.prepareInTransaction(
      tx,
      [{ ownerId: who.userId, game: "ets2" }],
      director,
    );
    const row = await tripService.groups.resolve(tx, id, true);
    await unit
      .client(tx)
      .update(trips)
      .set({ decision: "accepted", reviewHold: false, correctionPending: false })
      .where(eq(trips.id, row.id));
    if (report)
      await manual.decisionRecordedInTransaction(
        tx,
        director,
        report.id,
        report.currentRevision.id,
        iso(),
      );
    await qualifications.replaceContributionsInTransaction(tx, [
      {
        tripId: id,
        expectedTripVersion: row.version,
        version: 1,
        factId: row.currentFactId as string,
        ...(report ? { manualConfirmedAt: iso() } : {}),
      },
    ]);
  });
}
async function corrections() {
  const [rows] = await control.query<RowDataPacket[]>(
    "SELECT COUNT(*) n FROM outbox_events WHERE type='trip.correction_recorded'",
  );
  return Number(rows[0]?.n);
}
test("production composition invokes matching in telemetry and completed manual transactions without an outbox subscription", async () => {
  const composed = composeIdentity(
    unit,
    identityConfig,
    undefined,
    undefined,
    false,
    catalogConfig,
    tripConfig,
    undefined,
    manualConfig,
    qualConfig,
    undefined,
    config,
  );
  if (!composed.trips || !composed.manualReports || !composed.reconciliation)
    throw new Error("SYNTHETIC_COMPOSITION_MISSING");
  const t = await receive(payload(), owner, composed.trips),
    r = await report(owner, composed.manualReports);
  const candidates = await composed.reconciliation.list(director);
  expect(candidates.items).toHaveLength(1);
  expect(
    new Set([candidates.items[0]?.primaryTripId, candidates.items[0]?.secondaryTripId]),
  ).toEqual(new Set([t.tripId, r.tripId]));
  expect(candidates.items[0]?.reasonCodes).toEqual(
    expect.arrayContaining(["manual_actual_time_unknown", "gameplay_owner_unproven"]),
  );
  expect((await state(r.tripId))?.decision).toBe("pending_review");
  const [facts] = await control.query<RowDataPacket[]>(
    "SELECT evidence FROM reconciliation_candidates",
  );
  expect(facts[0]?.evidence.factIds).toHaveLength(2);
});
test("delayed manual report and repeated/overlapping routes retain review candidates; distinct same-provider identities never auto-link", async () => {
  const a = await receive(),
    b = await receive();
  instant += 20 * 86400000;
  const r = await report();
  const candidates = await service.list(director);
  expect(candidates.items).toHaveLength(2);
  expect(candidates.items.every((c) => c.reasonCodes.includes("multiple_candidates"))).toBe(true);
  expect((await tripService.list(owner, { scope: "mine" })).items).toHaveLength(3);
  const wrong = await receive(payload(), other);
  expect(
    (await service.list(director)).items.flatMap((c) => [c.primaryTripId, c.secondaryTripId]),
  ).not.toContain(wrong.tripId);
  expect((await state(a.tripId))?.aliasOf).toBeNull();
  expect((await state(b.tripId))?.aliasOf).toBeNull();
  expect((await state(r.tripId))?.aliasOf).toBeNull();
});
test("reviewed merge resolves aliases, preserves immutable identities/evidence/privacy, excludes alias counts and reverses monotonically", async () => {
  const p = payload(),
    t = await receive(p),
    r = await report(),
    before = await state(t.tripId),
    merged = await merge(t.tripId, r.tripId);
  expect((await state(r.tripId))?.aliasOf).toBe(t.tripId);
  expect((await tripService.detail(owner, r.tripId)).view).toBe("private");
  const detail = await tripService.detail(owner, t.tripId);
  if (detail.view !== "private") throw new Error("SYNTHETIC_PRIVATE_EXPECTED");
  expect(detail.evidence).toHaveLength(1);
  expect(detail.manualRevision).not.toBeNull();
  expect(detail.summary.sourceKinds.sort()).toEqual(["ets2telemetry", "manual"]);
  expect((await tripService.list(owner, { scope: "mine" })).items).toHaveLength(1);
  expect((await tripService.status(owner)).counts.unassessed).toBe(1);
  await expect(tripService.detail(other, r.tripId)).rejects.toMatchObject({ statusCode: 404 });
  expect((await receive(p)).duplicate).toBe(true);
  expect(await corrections()).toBe(1);
  const [original] = await control.query<RowDataPacket[]>(
    "SELECT trip_id FROM manual_reports WHERE id=?",
    [r.id],
  );
  expect(String(original[0]?.trip_id)).toBe(r.tripId);
  const [facts] = await control.query<RowDataPacket[]>(
    "SELECT DISTINCT canonical_trip_id id FROM trip_facts",
  );
  expect(new Set(facts.map((f) => String(f.id)))).toEqual(new Set([t.tripId, r.tripId]));
  const restored = await reverse(merged.data.id);
  expect(restored.data.state).toBe("reversed");
  expect((await state(r.tripId))?.aliasOf).toBeNull();
  expect((await state(t.tripId))?.version).toBeGreaterThan(before?.version ?? 0);
  expect((await tripService.list(owner, { scope: "mine" })).items).toHaveLength(2);
  expect((await receive(p)).duplicate).toBe(true);
  expect(await corrections()).toBe(2);
});
test("permanent merge/reverse receipts resolve exact retries, conflicting keys and stale versions without another effect", async () => {
  const a = await receive(),
    b = await receive(),
    p = await state(a.tripId),
    s = await state(b.tripId),
    key = newId();
  const input = {
    primaryTripId: a.tripId,
    secondaryTripId: b.tripId,
    primaryVersion: p?.version as number,
    secondaryVersion: s?.version as number,
    reason: "Fictional permanent command",
  };
  const first = await service.merge(director, key, input);
  instant += 400 * 86400000;
  expect(await service.merge(director, key, input)).toEqual(first);
  expect(await corrections()).toBe(1);
  await expect(
    service.merge(director, key, { ...input, reason: "Changed private input" }),
  ).rejects.toMatchObject({ statusCode: 409, publicCode: "IDEMPOTENCY_CONFLICT" });
  await expect(service.merge(director, newId(), input)).rejects.toMatchObject({ statusCode: 409 });
  const current = await service.get(director, first.data.id),
    reverseKey = newId(),
    reversal = {
      primaryVersion: current.data.primaryVersion,
      secondaryVersion: current.data.secondaryVersion,
      reason: "Fictional reversal",
    };
  await expect(
    service.reverse(director, first.data.id, newId(), current.version, {
      ...reversal,
      primaryVersion: 1,
    }),
  ).rejects.toMatchObject({ statusCode: 409 });
  const back = await service.reverse(
    director,
    first.data.id,
    reverseKey,
    current.version,
    reversal,
  );
  expect(
    await service.reverse(director, first.data.id, reverseKey, current.version, reversal),
  ).toEqual(back);
  expect(await corrections()).toBe(2);
});
test("dependent merges reject obsolete reversal until later reconciliation is reversed; cycles and alias roots fail", async () => {
  const a = await receive(),
    b = await receive(),
    c = await receive(),
    one = await merge(a.tripId, b.tripId),
    two = await merge(a.tripId, c.tripId);
  await expect(reverse(one.data.id)).rejects.toMatchObject({ statusCode: 409 });
  await expect(merge(b.tripId, a.tripId)).rejects.toMatchObject({ statusCode: 409 });
  await reverse(two.data.id);
  await reverse(one.data.id);
  expect((await tripService.list(owner, { scope: "mine" })).items).toHaveLength(3);
});
test("accepted manual primary keeps confirmation/reporting/qualification facts while late telemetry and reversal retain new source history", async () => {
  const r = await report();
  await accepted(r.tripId, r);
  const confirmed = await state(r.tripId),
    t = await receive();
  const merged = await merge(r.tripId, t.tripId);
  expect((await state(r.tripId))?.currentFactId).toBe(confirmed?.currentFactId);
  const next = payload();
  next.source = payload().source;
  const attached = await retryTransaction(unit, (tx) =>
    tripService.storeInTransaction(tx, "ets2telemetry", next, {
      ownerUserId: owner.userId,
      connection: { state: "unknown", referenceId: null },
      canonical: { tripId: t.tripId, expectedVersion: merged.data.primaryVersion },
    }),
  );
  expect(attached.tripId).toBe(r.tripId);
  expect((await state(r.tripId))?.correctionPending).toBe(true);
  expect((await state(r.tripId))?.currentFactId).toBe(confirmed?.currentFactId);
  await reverse(merged.data.id);
  expect((await state(r.tripId))?.decision).toBe("accepted");
  expect((await state(t.tripId))?.aliasOf).toBeNull();
  expect((await receive(next)).duplicate).toBe(true);
});
test("accepted duplicate credits replace atomically and reversal restores historical periods with new contribution versions", async () => {
  const a = await receive(),
    b = await receive();
  await accepted(a.tripId);
  await accepted(b.tripId);
  expect(
    (await qualifications.progress(owner, owner.userId, "ets2", "owner")).data.acceptedTrips,
  ).toBe(2);
  const one = await merge(a.tripId, b.tripId);
  expect(
    (await qualifications.progress(owner, owner.userId, "ets2", "owner")).data.acceptedTrips,
  ).toBe(1);
  const alias = await unit.run(
    async (tx) =>
      (
        await unit
          .client(tx)
          .select()
          .from(tripContributions)
          .where(eq(tripContributions.tripId, b.tripId))
      )[0],
  );
  expect(alias?.credited).toBe(false);
  await reverse(one.data.id);
  expect(
    (await qualifications.progress(owner, owner.userId, "ets2", "owner")).data.acceptedTrips,
  ).toBe(2);
  const restored = await unit.run(
    async (tx) =>
      (
        await unit
          .client(tx)
          .select()
          .from(tripContributions)
          .where(eq(tripContributions.tripId, b.tripId))
      )[0],
  );
  expect(restored?.version).toBeGreaterThan(alias?.version ?? 0);
});
test("current dispatcher/deputy/director permissions never allow manual authors to reconcile their own reports", async () => {
  const r = await report(),
    t = await receive();
  await unit.run((tx) =>
    unit.client(tx).insert(roles).values({ userId: owner.userId, role: "dispatcher" }),
  );
  const fresh = await identity.authenticate(
    new Headers({
      cookie: (await identity.login(emails.get(owner.userId) as string, password)).cookies
        .map((c) => c.split(";", 1)[0])
        .join("; "),
    }),
  );
  await expect(merge(t.tripId, r.tripId, fresh)).rejects.toMatchObject({ statusCode: 403 });
  await unit.run((tx) =>
    unit
      .client(tx)
      .delete(roles)
      .where(and(eq(roles.userId, owner.userId), eq(roles.role, "dispatcher"))),
  );
  // Other current review roles can act; ownership guard applies independently of rank.
  const a = await receive(),
    b = await receive();
  const x = await merge(a.tripId, b.tripId, dispatcher);
  await reverse(x.data.id, deputy);
  await unit.run((tx) =>
    unit
      .client(tx)
      .insert(roles)
      .values([
        { userId: director.userId, role: "driver" },
        { userId: deputy.userId, role: "driver" },
      ])
      .onDuplicateKeyUpdate({ set: { role: "driver" } }),
  );
  const dr = await report(director),
    dt = await receive(payload(), director);
  await expect(merge(dt.tripId, dr.tripId, director)).rejects.toMatchObject({ statusCode: 403 });
  const deputyReport = await report(deputy),
    deputyTrip = await receive(payload(), deputy);
  await expect(merge(deputyTrip.tripId, deputyReport.tripId, deputy)).rejects.toMatchObject({
    statusCode: 403,
  });
});
test("competing merges and merge/reverse serialize through real MySQL locks and preserve one canonical credit", async () => {
  const a = await receive(),
    b = await receive(),
    c = await receive(),
    sa = await state(a.tripId),
    sb = await state(b.tripId),
    sc = await state(c.tripId);
  const outcomes = await Promise.allSettled([
    service.merge(director, newId(), {
      primaryTripId: a.tripId,
      secondaryTripId: b.tripId,
      primaryVersion: sa?.version as number,
      secondaryVersion: sb?.version as number,
      reason: "Fictional concurrent A",
    }),
    service.merge(deputy, newId(), {
      primaryTripId: a.tripId,
      secondaryTripId: c.tripId,
      primaryVersion: sa?.version as number,
      secondaryVersion: sc?.version as number,
      reason: "Fictional concurrent B",
    }),
  ]);
  expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter((o) => o.status === "rejected")).toHaveLength(1);
  const winner = outcomes.find((o) => o.status === "fulfilled");
  if (winner?.status !== "fulfilled") throw new Error("SYNTHETIC_WINNER_MISSING");
  const result = await Promise.allSettled([reverse(winner.value.data.id), receive()]);
  expect(result.every((r) => r.status === "fulfilled")).toBe(true);
});
test("outbox failure rolls back aliases, immutable command/history and contribution replacements", async () => {
  const a = await receive(),
    b = await receive();
  await accepted(a.tripId);
  await accepted(b.tripId);
  const broken = createReconciliation(
    unit,
    config,
    {
      identity,
      trips: tripService,
      qualifications,
      manual,
      outbox: {
        append: async () => {
          throw new Error("SYNTHETIC_OUTBOX_FAILURE");
        },
      },
    },
    now,
  );
  const before = await state(a.tripId),
    other = await state(b.tripId);
  await expect(
    broken.merge(director, newId(), {
      primaryTripId: a.tripId,
      secondaryTripId: b.tripId,
      primaryVersion: before?.version as number,
      secondaryVersion: other?.version as number,
      reason: "Fictional rollback",
    }),
  ).rejects.toThrow("SYNTHETIC_OUTBOX_FAILURE");
  expect(await state(a.tripId)).toEqual(before);
  expect(await state(b.tripId)).toEqual(other);
  const [rows] = await control.query<RowDataPacket[]>(
    "SELECT (SELECT COUNT(*) FROM reconciliations) n,(SELECT COUNT(*) FROM reconciliation_commands) receipts,(SELECT COUNT(*) FROM trip_contributions WHERE credited=1) credits",
  );
  expect(Number(rows[0]?.n)).toBe(0);
  expect(Number(rows[0]?.receipts)).toBe(0);
  expect(Number(rows[0]?.credits)).toBe(2);
});
test("built listening approved HTTP routes enforce current authority, CSRF/Origin, schema and both aggregate versions", async () => {
  const a = await receive(),
    b = await receive();
  const built = (await import(pathToFileURL(resolve("apps/api/dist/app.js")).href)) as {
    createApp: typeof createApp;
  };
  const app = await built.createApp({
    identity,
    reconciliation: service,
    checkReadiness: async () => true,
  });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const http = (
    url: string,
    input: { method?: string; headers?: Record<string, string>; body?: string } = {},
  ) =>
    new Promise<{
      status: number;
      headers: { get(name: string): string | null };
      json(): Promise<unknown>;
    }>((accept, reject) => {
      const call = request(
        url,
        {
          method: input.method ?? "GET",
          headers: {
            ...input.headers,
            ...(input.body ? { "content-length": Buffer.byteLength(input.body) } : {}),
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          let size = 0;
          response.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > 65536) response.destroy(new Error("SYNTHETIC_HTTP_RESPONSE_BOUND"));
            else chunks.push(chunk);
          });
          response.once("error", reject);
          response.once("end", () =>
            accept({
              status: response.statusCode ?? 0,
              headers: {
                get: (name) => {
                  const value = response.headers[name.toLowerCase()];
                  return typeof value === "string" ? value : null;
                },
              },
              json: async () => JSON.parse(Buffer.concat(chunks).toString("utf8")),
            }),
          );
        },
      );
      call.setTimeout(5000, () => call.destroy(new Error("SYNTHETIC_HTTP_DEADLINE")));
      call.once("error", reject);
      call.end(input.body);
    });
  try {
    expect((await http(`${address}/api/v1/reconciliation-candidates`)).status).toBe(401);
    const body = {
        primaryTripId: a.tripId,
        secondaryTripId: b.tripId,
        primaryVersion: 1,
        secondaryVersion: 1,
        reason: "Fictional HTTP review",
      },
      csrf = csrfProtection(identity.config).issue({ cookie: directorCookie }, director),
      headers = {
        cookie: directorCookie,
        origin,
        "x-csrf-token": csrf.token,
        "idempotency-key": newId(),
        "content-type": "application/json",
      };
    expect(
      (
        await http(`${address}/api/v1/reconciliations`, {
          method: "POST",
          headers: { cookie: directorCookie, "content-type": "application/json" },
          body: JSON.stringify(body),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await http(`${address}/api/v1/reconciliations`, {
          method: "POST",
          headers: { ...headers, origin: "http://example.invalid" },
          body: JSON.stringify(body),
        })
      ).status,
    ).toBe(403);
    const created = await http(`${address}/api/v1/reconciliations`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    expect(created.status).toBe(201);
    const result = (await created.json()) as { data: S["Reconciliation"] };
    expect(JSON.stringify(result)).not.toContain(body.reason);
    const get = await http(`${address}/api/v1/reconciliations/${result.data.id}`, {
      headers: { cookie: directorCookie },
    });
    expect(get.headers.get("etag")).toBe('"v1"');
    const current = (await get.json()) as { data: S["Reconciliation"] },
      reversal = {
        primaryVersion: current.data.primaryVersion,
        secondaryVersion: current.data.secondaryVersion,
        reason: "Fictional HTTP reversal",
      };
    expect(
      (
        await http(`${address}/api/v1/reconciliations/${result.data.id}/reversals`, {
          method: "POST",
          headers: { ...headers, "idempotency-key": newId() },
          body: JSON.stringify(reversal),
        })
      ).status,
    ).toBe(428);
    const reversed = await http(`${address}/api/v1/reconciliations/${result.data.id}/reversals`, {
      method: "POST",
      headers: {
        ...headers,
        "idempotency-key": newId(),
        "if-match": get.headers.get("etag") as string,
      },
      body: JSON.stringify(reversal),
    });
    expect(reversed.status).toBe(200);
    expect(reversed.headers.get("etag")).toBe('"v2"');
    expect(((await reversed.json()) as { data: S["Reconciliation"] }).data.state).toBe("reversed");
  } finally {
    await app.close();
  }
});

test("classified transient failures roll back the complete reconciliation before bounded retry; unknown COMMIT resolves from permanent receipt", async () => {
  const a = await receive(),
    b = await receive(),
    sa = await state(a.tripId),
    sb = await state(b.tripId),
    input = {
      primaryTripId: a.tripId,
      secondaryTripId: b.tripId,
      primaryVersion: sa?.version as number,
      secondaryVersion: sb?.version as number,
      reason: "Fictional classified retry",
    };
  let attempts = 0;
  const transient: UnitOfWork = {
    client: unit.client,
    close: async () => {},
    run: (command) =>
      unit.run(async (tx) => {
        const result = await command(tx);
        if (++attempts < 3)
          throw Object.assign(new Error("SYNTHETIC_DEADLOCK"), { code: "ER_LOCK_DEADLOCK" });
        return result;
      }),
  };
  const retryIdentity = createIdentity(transient, identityConfig),
    retryService = createReconciliation(
      transient,
      config,
      { identity: retryIdentity, trips: tripService, qualifications, manual },
      now,
    );
  const result = await retryService.merge(director, newId(), input);
  expect(attempts).toBe(3);
  expect(await corrections()).toBe(1);
  await reverse(result.data.id);
  const c = await receive(),
    d = await receive(),
    sc = await state(c.tripId),
    sd = await state(d.tripId),
    key = newId(),
    body = {
      ...input,
      primaryTripId: c.tripId,
      secondaryTripId: d.tripId,
      primaryVersion: sc?.version as number,
      secondaryVersion: sd?.version as number,
    };
  let calls = 0;
  const uncertain: UnitOfWork = {
    client: unit.client,
    close: async () => {},
    run: async (command) => {
      const result = await unit.run(command);
      if (++calls === 1)
        throw new TransactionCommitOutcomeUnknownError(
          Object.assign(new Error("SYNTHETIC_RECEIPT_LOSS"), { code: "ER_LOCK_WAIT_TIMEOUT" }),
        );
      return result;
    },
  };
  const uncertainIdentity = createIdentity(uncertain, identityConfig),
    uncertainService = createReconciliation(
      uncertain,
      config,
      { identity: uncertainIdentity, trips: tripService, qualifications, manual },
      now,
    );
  await expect(uncertainService.merge(director, key, body)).rejects.toBeInstanceOf(
    TransactionCommitOutcomeUnknownError,
  );
  expect(calls).toBe(1);
  const replay = await uncertainService.merge(director, key, body);
  expect(replay.data.state).toBe("applied");
  expect(calls).toBe(2);
  expect(await corrections()).toBe(3);
});
test("actual MySQL company lock waits exhaust only three rolled-back attempts without changing links", async () => {
  const a = await receive(),
    b = await receive(),
    sa = await state(a.tripId),
    sb = await state(b.tripId);
  let attempts = 0;
  const waiting: UnitOfWork = {
    client: unit.client,
    close: async () => {},
    run: (command) =>
      unit.run(async (tx) => {
        attempts++;
        await unit.client(tx).execute(sql`SET SESSION innodb_lock_wait_timeout=1`);
        return command(tx);
      }),
  };
  const current = createIdentity(waiting, identityConfig),
    blocked = createReconciliation(
      waiting,
      config,
      { identity: current, trips: tripService, qualifications, manual },
      now,
    );
  await control.beginTransaction();
  await control.query("SELECT id FROM identity_company FOR UPDATE");
  try {
    await expect(
      blocked.merge(director, newId(), {
        primaryTripId: a.tripId,
        secondaryTripId: b.tripId,
        primaryVersion: sa?.version as number,
        secondaryVersion: sb?.version as number,
        reason: "Fictional lockwait",
      }),
    ).rejects.toBeTruthy();
  } finally {
    await control.rollback();
  }
  expect(attempts).toBe(3);
  expect((await state(b.tripId))?.aliasOf).toBeNull();
  expect(await corrections()).toBe(0);
});
test("alias screenshots honor the full group's latest decision/reopen hold and deletion generation fences", async () => {
  const id = await image(),
    r = await manual.submitReport(owner, newId(), { fields: fields(id) }),
    t = await receive();
  await accepted(r.tripId, r);
  const one = await merge(r.tripId, t.tripId);
  instant += 400 * 86400000;
  // An alias keeps its immutable pending report; the effective group's hold blocks old eligibility.
  expect(await manual.reserveExpiry(id)).toBe(false);
  await identity.transaction(async (tx) => {
    await qualifications.prepareInTransaction(
      tx,
      [{ ownerId: owner.userId, game: "ets2" }],
      director,
    );
    await tripService.groups.members(tx, [r.tripId], true);
    await unit
      .client(tx)
      .update(trips)
      .set({ reviewHold: false, correctionPending: false })
      .where(eq(trips.id, r.tripId));
    await manual.decisionRecordedInTransaction(tx, director, r.id, r.currentRevision.id, iso());
  });
  expect(await manual.reserveExpiry(id)).toBe(false);
  instant += 366 * 86400000;
  const held = deferred<void>(),
    release = deferred<void>();
  const reopening = identity.transaction(async (tx) => {
    await qualifications.prepareInTransaction(
      tx,
      [{ ownerId: owner.userId, game: "ets2" }],
      director,
    );
    await manual.reopenInTransaction(tx, director, t.tripId);
    held.resolve();
    await release.promise;
  });
  await held.promise;
  const expiring = manual.reserveExpiry(id);
  release.resolve();
  await reopening;
  expect(await expiring).toBe(false);
  await unit.run((tx) =>
    unit
      .client(tx)
      .update(manualEvidence)
      .set({ state: "deleting" })
      .where(eq(manualEvidence.id, id)),
  );
  await expect(reverse(one.data.id)).rejects.toMatchObject({
    statusCode: 503,
    publicCode: "EVIDENCE_TRANSITION",
  });
  expect((await state(t.tripId))?.aliasOf).toBe(r.tripId);
});
test("candidate pagination is signed/session scoped and rule changes invalidate previous snapshots", async () => {
  await receive();
  await receive();
  await report();
  const first = await service.list(director, { limit: 1 });
  expect(first.nextCursor).not.toBeNull();
  await expect(
    service.list(deputy, { limit: 1, cursor: first.nextCursor as string }),
  ).rejects.toMatchObject({ statusCode: 409 });
  expect(
    (await service.list(director, { limit: 1, cursor: first.nextCursor as string })).items,
  ).toHaveLength(1);
  const changed = createReconciliation(
    unit,
    { ...config, rule: { ...config.rule, version: 2 } },
    { identity, trips: tripService, qualifications, manual },
    now,
  );
  expect((await changed.list(director)).items).toHaveLength(0);
  const source = await receive();
  await unit.run((tx) => changed.refreshInTransaction(tx, source.tripId, source.sourceRecordId));
  expect((await changed.list(director)).items.length).toBeGreaterThan(0);
  const [plans] = await control.execute<RowDataPacket[]>(
    "EXPLAIN SELECT id FROM trips WHERE owner_id=? AND game='ets2' AND alias_of IS NULL ORDER BY id LIMIT 101",
    [owner.userId],
  );
  expect(plans[0]?.possible_keys).toContain("trip_match_owner");
  const [pagePlan] = await control.query<RowDataPacket[]>(
    "EXPLAIN SELECT id FROM reconciliation_candidates WHERE active=1 ORDER BY created_at DESC,id DESC LIMIT 25",
  );
  expect(pagePlan[0]?.possible_keys).toContain("reconciliation_candidate_page");
});

test("concurrent production telemetry/manual discovery cannot miss the duplicate candidate or create credit", async () => {
  const [t, r] = await Promise.all([receive(), report()]);
  const candidates = await service.list(director);
  expect(candidates.items).toHaveLength(1);
  expect(
    new Set([candidates.items[0]?.primaryTripId, candidates.items[0]?.secondaryTripId]),
  ).toEqual(new Set([t.tripId, r.tripId]));
  expect(candidates.items[0]?.confidence).toBe("review_required");
  const [credit] = await control.query<RowDataPacket[]>(
    "SELECT COUNT(*) n FROM trip_contributions WHERE credited=1",
  );
  expect(Number(credit[0]?.n)).toBe(0);
});

test("raw expiry after reviewed linking retains exact replay identity through reversal", async () => {
  const first = payload(),
    second = payload(),
    a = await receive(first),
    b = await receive(second),
    one = await merge(a.tripId, b.tripId);
  await identity.transaction(async (tx) => {
    await tripService.retentionPolicyInTransaction(tx, b.sourceRecordId, {
      reviewedPolicyReference: "synthetic/reconciliation/v1",
      eligibleAt: iso(),
      hold: false,
    });
    expect(await tripService.expirePayloadInTransaction(tx, b.sourceRecordId)).toBe(true);
  });
  const replay = await receive(second);
  expect(replay.duplicate).toBe(true);
  expect(replay.sourceRecordId).toBe(b.sourceRecordId);
  await reverse(one.data.id);
  expect((await receive(second)).sourceRecordId).toBe(b.sourceRecordId);
  expect(await corrections()).toBe(2);
});
test("audit failure rolls back the entire membership/history/credit/outbox command", async () => {
  const a = await receive(),
    b = await receive(),
    before = await state(a.tripId),
    other = await state(b.tripId);
  await control.query(
    `ALTER TABLE audit_entries ADD CONSTRAINT synthetic_reconciliation_audit_failure CHECK (operation <> 'trip.reconciled' OR subject_id <> ${control.escape(a.tripId)})`,
  );
  try {
    await expect(merge(a.tripId, b.tripId)).rejects.toBeTruthy();
  } finally {
    await control.query(
      "ALTER TABLE audit_entries DROP CHECK synthetic_reconciliation_audit_failure",
    );
  }
  expect(await state(a.tripId)).toEqual(before);
  expect(await state(b.tripId)).toEqual(other);
  expect(await corrections()).toBe(0);
  const [rows] = await control.query<RowDataPacket[]>(
    "SELECT COUNT(*) n FROM reconciliation_commands",
  );
  expect(Number(rows[0]?.n)).toBe(0);
});
test("duplicate correction invalidates historical promotion proof without demotion and reversal restores its support", async () => {
  instant -= 120000;
  const who = await member();
  instant += 120000;
  const level = (await qualifications.levels(director, "ets2")).items.find(
    (l) => l.id === structuralLevels.ets2[0],
  );
  if (!level) throw new Error("SYNTHETIC_LEVEL_MISSING");
  await qualifications.publish(director, level.id, newId(), level.version, {
    rules: [{ type: "max_mass", maxKg: "20000" }],
    requiredTrips: 2,
    requiredDistanceM: "100",
    reason: "Fictional duplicate-proof threshold",
  });
  const a = await receive(payload(), who),
    b = await receive(payload(), who);
  await accepted(a.tripId, undefined, who);
  await accepted(b.tripId, undefined, who);
  const before = await qualifications.progress(who, who.userId, "ets2", "owner");
  await qualifications.promote(director, who.userId, newId(), before.version, {
    game: "ets2",
    assignmentId: before.data.assignment.id,
    targetLevelId: structuralLevels.ets2[1],
    reason: "Fictional promotion proof",
  });
  const promoted = await qualifications.progress(who, who.userId, "ets2", "owner"),
    one = await merge(a.tripId, b.tripId);
  const current = await qualifications.progress(who, who.userId, "ets2", "owner");
  expect(current.data.assignment.id).toBe(promoted.data.assignment.id);
  const [proof] = await control.query<RowDataPacket[]>(
    "SELECT review_required FROM qualification_promotion_reviews",
  );
  expect(proof.some((r) => Boolean(r.review_required))).toBe(true);
  await reverse(one.data.id);
  expect((await qualifications.progress(who, who.userId, "ets2", "owner")).data.assignment.id).toBe(
    promoted.data.assignment.id,
  );
});

test("an unassessed or rejected primary cannot erase an accepted secondary; differing accepted contexts retain the primary reviewed result", async () => {
  const a = await receive(),
    b = await receive();
  await accepted(b.tripId);
  await expect(merge(a.tripId, b.tripId)).rejects.toMatchObject({ statusCode: 409 });
  await unit.run((tx) =>
    unit.client(tx).update(trips).set({ decision: "rejected" }).where(eq(trips.id, a.tripId)),
  );
  await expect(merge(a.tripId, b.tripId)).rejects.toMatchObject({ statusCode: 409 });
  expect((await state(b.tripId))?.aliasOf).toBeNull();
  const r = await report();
  await accepted(r.tripId, r);
  const confirmed = await state(r.tripId),
    beforeCredit = await unit.run(
      async (tx) =>
        (
          await unit
            .client(tx)
            .select()
            .from(tripContributions)
            .where(eq(tripContributions.tripId, r.tripId))
        )[0],
    );
  const merged = await merge(r.tripId, b.tripId),
    after = await state(r.tripId),
    afterCredit = await unit.run(
      async (tx) =>
        (
          await unit
            .client(tx)
            .select()
            .from(tripContributions)
            .where(eq(tripContributions.tripId, r.tripId))
        )[0],
    );
  expect(after?.decision).toBe("accepted");
  expect(after?.correctionPending).toBe(true);
  expect(after?.currentFactId).toBe(confirmed?.currentFactId);
  expect(after?.reportingAt).toBe(confirmed?.reportingAt);
  expect(afterCredit?.attributionAt).toBe(beforeCredit?.attributionAt);
  expect(afterCredit?.factId).toBe(beforeCredit?.factId);
  expect(afterCredit?.actualDistanceM).toBe(beforeCredit?.actualDistanceM);
  await reverse(merged.data.id);
  expect((await state(b.tripId))?.decision).toBe("accepted");
});

test("a later manual correction request fences reversal instead of restoring obsolete review flags", async () => {
  const r = await report(),
    t = await receive();
  await accepted(r.tripId, r);
  const one = await merge(r.tripId, t.tripId);
  const current = await state(r.tripId);
  await manual.requestCorrection(owner, t.tripId, newId(), current?.version as number, {
    reason: "Fictional new correction request",
  });
  await expect(reverse(one.data.id)).rejects.toMatchObject({ statusCode: 409 });
  expect((await state(r.tripId))?.correctionPending).toBe(true);
  expect((await state(t.tripId))?.aliasOf).toBe(r.tripId);
});
