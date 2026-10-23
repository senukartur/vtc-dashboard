import { randomBytes } from "node:crypto";
import type { components } from "@vtc/contracts";
import {
  createUnitOfWork,
  newId,
  runMigrations,
  TransactionCommitOutcomeUnknownError,
  type UnitOfWork,
} from "@vtc/db";
import { manualEvidence } from "@vtc/db/manual-reports-schema";
import { durableJobs } from "@vtc/db/platform-schema";
import { tripEventAssociations } from "@vtc/db/trip-decisions-schema";
import { eq, tripContributions, trips } from "@vtc/db/trips-schema";
import type { Connection, RowDataPacket } from "mysql2/promise";
import { expect, test, afterAll as vAfter, beforeAll as vBefore } from "vitest";
import { createApp } from "../../apps/api/src/app.ts";
import { createCatalogs } from "../../apps/api/src/modules/catalogs/service.ts";
import { createEvents, type Events } from "../../apps/api/src/modules/events/service.ts";
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
import {
  createTripDecisions,
  type TripDecisions,
} from "../../apps/api/src/modules/trip-decisions/service.ts";
import { createTrips, type Trips } from "../../apps/api/src/modules/trips/service.ts";
import { createQueue, retryTransaction } from "../../apps/api/src/platform/jobs/queue.ts";
import { runPass } from "../../apps/api/src/platform/jobs/runner.ts";
import { catalogEvents, identityAccessEvents } from "../../apps/api/src/platform/outbox/events.ts";
import { composeIdentity } from "../../apps/api/src/use-cases/identity-messaging.ts";
import { artifact, entity } from "../fixtures/catalogs/synthetic.ts";
import {
  guardedSettings,
  reset,
  SCHEMA_SETUP_TIMEOUT_MS,
  testConnection,
} from "../persistence/support.ts";
import { telemetryFixture } from "../support/builders.ts";
import { schemaLifecycleHooks } from "../support/schema-lifecycle.ts";

const { beforeAll, afterAll } = schemaLifecycleHooks(vBefore, vAfter);
type S = components["schemas"];
let control: Connection,
  unit: UnitOfWork,
  identity: Identity,
  tripsService: Trips,
  manual: ManualReports,
  qualifications: Qualifications,
  events: Events,
  reconciliation: Reconciliation,
  service: TripDecisions;
let owner: Actor,
  dispatcher: Actor,
  deputy: Actor,
  director: Actor,
  directorCookie: string,
  revisionId: string;
let instant = Date.parse("2026-10-10T12:00:00.000Z");
const now = () => new Date(instant),
  iso = () => now().toISOString(),
  key = () => randomBytes(32).toString("hex"),
  origin = "http://127.0.0.1:4173",
  password = "Fictional-decision-passphrase-42";
const ids = new Map<string, string>();
async function member(roles: ("driver" | "dispatcher" | "deputy_director")[] = ["driver"]) {
  const userId = newId(),
    email = `${userId}@example.invalid`,
    credential = await identity.prepareCredential(password);
  await unit.run(async (tx) => {
    await identity.insertWithCredential(tx, {
      userId,
      email,
      name: "Fictional Decision Member",
      ...credential,
      roles,
    });
    await createQualificationInitialization(unit).initialize(tx, {
      userId,
      games: ["ets2", "ats"],
      assignedAt: "2026-10-10T12:00:00.000Z",
    });
  });
  const login = await identity.login(email, password),
    cookie = login.cookies.map((v) => v.split(";", 1)[0]).join("; ");
  return identity.authenticate(new Headers({ cookie }));
}
beforeAll(async () => {
  control = await testConnection();
  unit = createUnitOfWork(guardedSettings());
  await reset(control);
  await runMigrations(guardedSettings());
  identity = createIdentity(
    unit,
    { secret: key(), origin, production: false },
    { accessEvents: identityAccessEvents(unit) },
  );
  await identity.bootstrap({
    email: "decisions-director@example.invalid",
    name: "Fictional Decision Director",
    password,
  });
  const login = await identity.login("decisions-director@example.invalid", password);
  directorCookie = login.cookies.map((v) => v.split(";", 1)[0]).join("; ");
  director = await identity.authenticate(new Headers({ cookie: directorCookie }));
  owner = await member();
  dispatcher = await member(["dispatcher"]);
  deputy = await member(["deputy_director"]);
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
  const entities = [
    entity("fixture_north"),
    entity("fixture_south"),
    entity("fixture_crates", { kind: "cargo" }),
    entity("fixture_trailer", { kind: "trailer_type" }),
  ].map((e) => ({
    ...e,
    mapNamespace: "official",
    mappings: [{ provider: "ets2telemetry", sourceId: e.key }],
  }));
  const a = artifact("ets2", entities),
    uploaded = await catalogs.upload(director, newId(), Buffer.from(JSON.stringify(a))),
    operation = await catalogs.import(director, newId(), {
      artifactId: uploaded.id,
      sha256: uploaded.sha256,
      game: "ets2",
    });
  await runPass(createQueue(unit, [catalogs.handler]), new AbortController().signal);
  const completed = await catalogs.operation(director, operation.id);
  expect(completed.state).toBe("completed");
  revisionId = completed.resultId as string;
  const r = await catalogs.detail(director, revisionId);
  await catalogs.publish(director, revisionId, newId(), r.version, {
    expectedPublicationVersion: r.publicationVersion,
    reason: "Fictional reviewed catalog",
  });
  for (const kind of ["city", "cargo", "trailer_type"])
    for (const row of (await catalogs.entities(director, { revisionId, kind, locale: "en" })).items)
      ids.set(row.display.label.replace("Fictional ", ""), row.id);
  tripsService = createTrips(
    unit,
    { cursorKey: key() },
    {
      identity,
      catalogs,
      prepare: (tx, ownerId, game) => qualifications.prepareInTransaction(tx, [{ ownerId, game }]),
      sourceStored: async (tx, id) => {
        await service.assessInTransaction(tx, id);
      },
      manualEvidence: (tx, owner, payload, id) =>
        manual.validateSourceInTransaction(tx, owner, payload, id),
      manualProjection: (tx, ids) => manual.projectionInTransaction(tx, ids),
      decisionProjection: (tx, id, actor) => service.privateProjectionInTransaction(tx, id, actor),
      correctionRequested: (tx, id, requestId, actor, reason) =>
        service.correctionRequestedInTransaction(tx, id, requestId, actor, reason),
    },
    now,
  );
  qualifications = createQualifications(
    unit,
    { cursorKey: key() },
    { identity, trips: tripsService, catalogs },
    now,
  );
  manual = createManualReports(
    unit,
    { key: key(), maxFilesPerReport: 5, policyRevision: 1, orphanGraceMs: 60000 },
    { identity, catalogs, trips: tripsService },
    now,
  );
  events = createEvents(
    unit,
    { cursorKey: key() },
    {
      identity,
      catalogs,
      tripChanged: (tx, id, generation) => service.eventChangedInTransaction(tx, id, generation),
    },
    now,
  );
  reconciliation = createReconciliation(
    unit,
    { key: key() },
    {
      identity,
      trips: tripsService,
      qualifications,
      manual,
      workflowChanged: (tx, id) => service.assessInTransaction(tx, id),
    },
    now,
  );
  service = createTripDecisions(
    unit,
    { key: key() },
    { identity, trips: tripsService, qualifications, manual, events },
    now,
  );
  const level = (await qualifications.levels(director, "ets2")).items.find(
    (v) => v.id === structuralLevels.ets2[0],
  );
  if (!level) throw Error("SYNTHETIC_LEVEL_MISSING");
  await qualifications.publish(director, level.id, newId(), level.version, {
    rules: [{ type: "max_mass", maxKg: "20000" }],
    requiredTrips: 1,
    requiredDistanceM: "100",
    reason: "Fictional launch fixture",
  });
  instant = Date.parse("2026-10-21T12:00:00.000Z");
}, SCHEMA_SETUP_TIMEOUT_MS);
afterAll(async () => {
  await unit?.close();
  await control?.end();
}, SCHEMA_SETUP_TIMEOUT_MS);
function payload(kind: "completed" | "started" | "closed-partial" = "completed") {
  const p = telemetryFixture(kind) as unknown as Telemetry;
  p.eventId = newId();
  p.source.tripId = newId();
  p.source.pluginSessionId = newId();
  p.snapshot.context.gameBuild = { available: true, value: "synthetic-build" };
  if (p.snapshot.start.utcMs !== null) p.snapshot.start.utcMs = instant - 60000;
  if (p.snapshot.end?.utcMs !== null && p.snapshot.end) p.snapshot.end.utcMs = instant;
  p.createdUtcMs = instant;
  return p;
}
const receive = (
  p = payload(),
  who = owner,
  target?: { tripId: string; expectedVersion: number },
) =>
  retryTransaction(unit, (tx) =>
    tripsService.storeInTransaction(tx, "ets2telemetry", p, {
      ownerUserId: who.userId,
      connection: { state: "unknown", referenceId: null },
      ...(target ? { canonical: target } : {}),
    }),
  );
async function state(id: string) {
  return unit.run(
    async (tx) => (await unit.client(tx).select().from(trips).where(eq(trips.id, id)))[0],
  );
}
async function credit(id: string) {
  return unit.run(
    async (tx) =>
      (
        await unit
          .client(tx)
          .select()
          .from(tripContributions)
          .where(eq(tripContributions.tripId, id))
      )[0],
  );
}
async function report(who = owner) {
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
  const pin = (name: string) => ({
    status: "resolved" as const,
    entityId: ids.get(name) as string,
    catalogRevisionId: revisionId,
  });
  return manual.submitReport(who, newId(), {
    fields: {
      game: "ets2",
      origin: pin("fixture_north"),
      destination: pin("fixture_south"),
      cargo: pin("fixture_crates"),
      trailerType: pin("fixture_trailer"),
      cargoMassKg: "18000",
      actualDistanceM: "123400",
      evidenceIds: [id],
    },
  });
}
async function decide(
  id: string,
  decision: "accept" | "reject" = "accept",
  actor = dispatcher,
  commandKey = newId(),
) {
  const review = await service.review(actor, id);
  return service.decide(actor, id, commandKey, review.version, {
    decision,
    reviewedRevisionId: review.data.trip.manualRevision?.id ?? review.data.factRevisionId,
    factRevisionId: review.data.factRevisionId,
    proposalId: null,
    reason: "Fictional evidence review",
  });
}
async function decideProposal(...args: Parameters<TripDecisions["proposalDecision"]>) {
  const result = await service.proposalDecision(...args);
  if (!("outcome" in result.data)) throw new Error("SYNTHETIC_TERMINAL_DECISION_EXPECTED");
  return { data: result.data, version: result.version };
}
async function resolveDistance(
  id: string,
  distance: string,
  extra: Partial<S["ResolutionInput"]> = {},
) {
  const row = await state(id);
  const proposed = await service.propose(dispatcher, id, newId(), row?.version as number, {
      reason: "Fictional supported correction",
      evidenceIds: [],
      actualDistanceM: distance,
      ...extra,
    }),
    p = await service.getProposal(dispatcher, id, proposed.data.id);
  return {
    p,
    result: await decideProposal(deputy, id, p.data.id, newId(), p.version, {
      decision: "approve",
      reviewedRevisionId: p.data.revisionId,
      reason: "Fictional verified correction",
    }),
  };
}

test("sufficient telemetry accepts once; exact replay leaves decision/outbox/contribution unchanged", async () => {
  const p = payload(),
    r = await receive(p),
    before = await state(r.tripId),
    saved = await credit(r.tripId);
  expect(before?.decision).toBe("accepted");
  expect(saved?.credited).toBe(true);
  const replay = await receive(p);
  expect(replay.duplicate).toBe(true);
  expect(await state(r.tripId)).toEqual(before);
  expect(await credit(r.tripId)).toEqual(saved);
  const [events] = await control.execute<RowDataPacket[]>(
    "SELECT COUNT(*) n FROM outbox_events WHERE type='trip.decision_changed' AND aggregate_id=?",
    [r.tripId],
  );
  expect(Number(events[0]?.n)).toBe(1);
});
test("open stays unassessed; missing history/build/recording/completion/distance routes review; known violation rejects", async () => {
  const open = await receive(payload("started"));
  expect((await state(open.tripId))?.decision).toBe("unassessed");
  const missing = payload();
  missing.snapshot.context.gameBuild = { available: false, reason: "not-observed" };
  const r = await receive(missing);
  expect((await state(r.tripId))?.decision).toBe("pending_review");
  expect(await credit(r.tripId)).toBeUndefined();
  const fail = payload();
  if (fail.snapshot.job.cargoMass.available) fail.snapshot.job.cargoMass.value = 21000;
  expect((await state((await receive(fail)).tripId))?.decision).toBe("rejected");
});
test("actual closed-none source retains uncertain terminal state for review without a fabricated rejection or contribution", async () => {
  const r = await receive(payload("closed-partial")),
    row = await state(r.tripId);
  expect(row?.outcome).toBe("none");
  expect(row?.recording).toBe("partial");
  expect(row?.decision).toBe("pending_review");
  expect(row?.reviewReasons).toContain("terminal_outcome_unknown");
  expect(await credit(r.tripId)).toBeUndefined();
  const [decisions] = await control.execute<RowDataPacket[]>(
    "SELECT COUNT(*) n FROM trip_decisions WHERE trip_id=?",
    [r.tripId],
  );
  expect(Number(decisions[0]?.n)).toBe(0);
});

test("frozen ingestion preserves reversed checkpoint and anomalous clock timestamps as unsupported review evidence", async () => {
  for (const basis of ["checkpoint", "clock-anomaly"] as const) {
    const p = payload();
    p.snapshot.start.utcMs = instant;
    p.snapshot.end!.utcMs = instant - 60000;
    if (basis === "checkpoint") {
      p.snapshot.start.basis = "checkpoint";
      p.snapshot.start.eventSeq = null;
      p.snapshot.end!.basis = "last-known";
      p.snapshot.end!.eventSeq = null;
      p.snapshot.openedBy = "checkpoint";
      p.snapshot.openedEventSeq = null;
      p.snapshot.checkpointNextEventSeq = "100";
    } else p.snapshot.evidence.clockAnomaly = true;
    const r = await receive(p),
      row = await state(r.tripId);
    expect(row?.decision).toBe("pending_review");
    expect(row?.reviewReasons).not.toContain("actual_time_order_invalid");
    expect(await credit(r.tripId)).toBeUndefined();
    const f = await unit.run(
      async (tx) =>
        (await tripsService.adjudication.facts(tx, [row?.currentFactId as string], true)).get(
          row?.currentFactId as string,
        )?.evidence,
    );
    expect(f?.start.verifiedActual).toBe(false);
    expect(f?.end.verifiedActual).toBe(false);
    expect(f?.start.utc).toBe(iso());
    expect(f?.end.utc).toBe(new Date(instant - 60000).toISOString());
    const [decisions] = await control.execute<RowDataPacket[]>(
      "SELECT COUNT(*) n FROM trip_decisions WHERE trip_id=?",
      [r.tripId],
    );
    expect(Number(decisions[0]?.n)).toBe(0);
  }
});

test("manual waits for a different authorized human; self review denied even Director; acceptance uses confirmation", async () => {
  const r = await report(),
    before = await state(r.tripId);
  expect(before?.decision).toBe("pending_review");
  await expect(decide(r.tripId, "accept", owner)).rejects.toMatchObject({ statusCode: 403 });
  const result = await decide(r.tripId);
  expect(result.data.outcome).toBe("accepted");
  expect(result.data.basis.attributionBasis).toBe("manual_confirmation");
  expect(result.data.basis.reportingAt).toBe(iso());
  expect((await credit(r.tripId))?.credited).toBe(true);
  expect((await state(r.tripId))?.actualStart).toBeNull();
  const own = await report(director);
  await expect(decide(own.tripId, "accept", director)).rejects.toMatchObject({
    statusCode: 403,
    publicCode: "SELF_REVIEW_FORBIDDEN",
  });
});
test("two dispatchers decide at most once and permanent receipts reject conflicting input and stale ETags", async () => {
  const r = await report(),
    review = await service.review(dispatcher, r.tripId),
    value = {
      decision: "accept" as const,
      reviewedRevisionId: r.currentRevision.id,
      factRevisionId: review.data.factRevisionId,
      proposalId: null,
      reason: "Fictional concurrent review",
    },
    commandKey = newId();
  const results = await Promise.allSettled([
    service.decide(dispatcher, r.tripId, commandKey, review.version, value),
    service.decide(deputy, r.tripId, newId(), review.version, value),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const win = results[0];
  if (win?.status === "fulfilled") {
    expect(await service.decide(dispatcher, r.tripId, commandKey, review.version, value)).toEqual(
      win.value,
    );
    await expect(
      service.decide(dispatcher, r.tripId, commandKey, review.version, {
        ...value,
        reason: "Different",
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  }
  await expect(
    service.decide(deputy, r.tripId, newId(), review.version, value),
  ).rejects.toMatchObject({ statusCode: 409 });
});
test("two successive derived corrections change real FK-backed credit and reconstruct after raw expiry", async () => {
  const p = payload(),
    r = await receive(p),
    original = await state(r.tripId),
    before = await credit(r.tripId);
  const a = await resolveDistance(r.tripId, "200000"),
    b = await resolveDistance(r.tripId, "300000");
  expect(a.result.data.basis.factRevisionId).not.toBe(original?.currentFactId);
  expect(b.result.data.basis.factRevisionId).not.toBe(a.result.data.basis.factRevisionId);
  expect((await credit(r.tripId))?.actualDistanceM).toBe("300000.000000000000000000");
  expect((await credit(r.tripId))?.version).toBe((before?.version ?? 0) + 2);
  await unit.run(async (tx) => {
    await tripsService.retentionPolicyInTransaction(tx, r.sourceRecordId, {
      reviewedPolicyReference: "synthetic/trip-decisions/v1",
      eligibleAt: iso(),
      hold: false,
    });
    expect(await tripsService.expirePayloadInTransaction(tx, r.sourceRecordId)).toBe(true);
    const f = (
      await tripsService.adjudication.facts(tx, [b.result.data.basis.factRevisionId], true)
    ).get(b.result.data.basis.factRevisionId);
    expect(f?.evidence.actualDistanceM).toMatchObject({ status: "known", value: "300000" });
    expect(f?.evidence.sourceRecordId).toBe(r.sourceRecordId);
  });
  expect((await receive(p)).duplicate).toBe(true);
  const other = await receive(),
    left = await state(r.tripId),
    right = await state(other.tripId),
    merged = await reconciliation.merge(director, newId(), {
      primaryTripId: r.tripId,
      secondaryTripId: other.tripId,
      primaryVersion: left?.version as number,
      secondaryVersion: right?.version as number,
      reason: "Fictional derived lineage merge",
    }),
    current = await reconciliation.get(director, merged.data.id);
  await reconciliation.reverse(director, merged.data.id, newId(), current.version, {
    primaryVersion: current.data.primaryVersion,
    secondaryVersion: current.data.secondaryVersion,
    reason: "Fictional supported independent restoration",
  });
  expect((await credit(r.tripId))?.factId).toBe(b.result.data.basis.factRevisionId);
  expect((await credit(r.tripId))?.actualDistanceM).toBe("300000.000000000000000000");
  await control.execute("UPDATE trip_facts SET actual_distance_m='999999' WHERE id=?", [
    b.result.data.basis.factRevisionId,
  ]);
  try {
    await expect(
      unit.run((tx) =>
        tripsService.adjudication.facts(tx, [b.result.data.basis.factRevisionId], true),
      ),
    ).rejects.toThrow("DERIVED_PROVENANCE_VALUE_MISMATCH");
  } finally {
    await control.execute("UPDATE trip_facts SET actual_distance_m='300000' WHERE id=?", [
      b.result.data.basis.factRevisionId,
    ]);
  }
});
test("derived corrections reject foreign evidence and invalid catalog kinds without changing confirmed credit", async () => {
  const a = await receive(),
    other = await report(await member()),
    before = await credit(a.tripId),
    row = await state(a.tripId);
  await expect(
    service.propose(dispatcher, a.tripId, newId(), row?.version as number, {
      reason: "Fictional foreign evidence refusal",
      evidenceIds: other.currentRevision.fields.evidenceIds,
      actualDistanceM: "250000",
    }),
  ).rejects.toMatchObject({ statusCode: 422 });
  await expect(
    service.propose(dispatcher, a.tripId, newId(), row?.version as number, {
      reason: "Fictional catalog kind refusal",
      evidenceIds: [],
      cargoId: ids.get("fixture_north") as string,
      catalogRevisionId: revisionId,
    }),
  ).rejects.toMatchObject({ statusCode: 422 });
  expect(await credit(a.tripId)).toEqual(before);
  expect(await state(a.tripId)).toEqual(row);
});

test("a proposal freezes confirmed credit, rejects stale support and proposal rejection returns effective decision", async () => {
  const p = payload(),
    r = await receive(p),
    before = await credit(r.tripId),
    row = await state(r.tripId),
    proposal = await service.propose(dispatcher, r.tripId, newId(), row?.version as number, {
      reason: "Fictional correction",
      evidenceIds: [],
      actualDistanceM: "200000",
    }),
    detail = await service.getProposal(dispatcher, r.tripId, proposal.data.id);
  expect(await credit(r.tripId)).toEqual(before);
  const rejected = await decideProposal(deputy, r.tripId, detail.data.id, newId(), detail.version, {
    decision: "reject",
    reviewedRevisionId: detail.data.revisionId,
    reason: "Fictional evidence insufficient",
  });
  expect(rejected.data.outcome).toBe("accepted");
  expect(await credit(r.tripId)).toEqual(before);
  expect(
    (await service.getProposal(dispatcher, r.tripId, detail.data.id)).data.review?.decision,
  ).toBe("reject");
  const pending = await service.propose(dispatcher, r.tripId, newId(), rejected.version, {
    reason: "Fictional next correction",
    evidenceIds: [],
    actualDistanceM: "400000",
  });
  const revision = { ...structuredClone(p), eventId: newId(), revision: p.revision + 1 };
  await receive(revision);
  const current = await service.getProposal(dispatcher, r.tripId, pending.data.id);
  expect(current.version).toBe((await state(r.tripId))?.version);
  await expect(
    decideProposal(deputy, r.tripId, current.data.id, newId(), current.version, {
      decision: "approve",
      reviewedRevisionId: current.data.revisionId,
      reason: "Fictional obsolete review",
    }),
  ).rejects.toMatchObject({ statusCode: 409 });
});
test("manual dates and an assignment ID without supported historical start cannot fabricate qualification", async () => {
  const r = await report(),
    row = await state(r.tripId);
  await expect(
    service.propose(dispatcher, r.tripId, newId(), row?.version as number, {
      reason: "Fictional invalid date",
      evidenceIds: r.currentRevision.fields.evidenceIds,
      actualStartAt: iso(),
    }),
  ).rejects.toMatchObject({ statusCode: 422 });
  const p = payload();
  p.snapshot.start = { utcMs: null, basis: "unknown", eventSeq: null };
  p.snapshot.evidence.startObserved = false;
  const t = await receive(p),
    stateT = await state(t.tripId);
  await expect(
    service.propose(dispatcher, t.tripId, newId(), stateT?.version as number, {
      reason: "Fictional invented history",
      evidenceIds: [],
      qualificationAssignmentId: newId(),
    }),
  ).rejects.toMatchObject({ statusCode: 422 });
});
test("late telemetry and manual approval in both serialized orders preserve one canonical confirmed result", async () => {
  for (const telemetryFirst of [false, true]) {
    const r = await report(),
      p = payload();
    if (telemetryFirst) {
      await receive(p, owner, {
        tripId: r.tripId,
        expectedVersion: (await state(r.tripId))?.version as number,
      });
      expect((await state(r.tripId))?.decision).toBe("pending_review");
      expect(await credit(r.tripId)).toBeUndefined();
      await decide(r.tripId);
    } else {
      await decide(r.tripId);
      const before = await credit(r.tripId),
        saved = await state(r.tripId);
      await receive(p, owner, { tripId: r.tripId, expectedVersion: saved?.version as number });
      expect(await credit(r.tripId)).toEqual(before);
      expect((await state(r.tripId))?.currentFactId).toBe(saved?.currentFactId);
      expect((await state(r.tripId))?.correctionPending).toBe(true);
      await decide(r.tripId);
      expect((await credit(r.tripId))?.attributionBasis).toBe("actual_start");
    }
  }
});
test("manual human review racing actual telemetry ingestion serializes without automatic manual approval or duplicate credit", async () => {
  const r = await report(),
    review = await service.review(dispatcher, r.tripId),
    p = payload();
  const value: S["DecisionInput"] = {
    decision: "accept",
    reviewedRevisionId: r.currentRevision.id,
    factRevisionId: review.data.factRevisionId,
    proposalId: null,
    reason: "Fictional concurrent source review",
  };
  const results = await Promise.allSettled([
    service.decide(dispatcher, r.tripId, newId(), review.version, value),
    receive(p, owner, { tripId: r.tripId, expectedVersion: review.version }),
  ]);
  expect(results.some((r) => r.status === "fulfilled")).toBe(true);
  for (const result of results)
    if (result.status === "rejected") expect(result.reason).toMatchObject({ statusCode: 409 });
  if (results[0]?.status === "rejected") {
    expect((await state(r.tripId))?.decision).toBe("pending_review");
    expect(await credit(r.tripId)).toBeUndefined();
  }
  if (results[1]?.status === "rejected")
    await receive(p, owner, {
      tripId: r.tripId,
      expectedVersion: (await state(r.tripId))?.version as number,
    });
  await decide(r.tripId);
  const current = await credit(r.tripId);
  expect(current?.credited).toBe(true);
  const [rows] = await control.execute<RowDataPacket[]>(
    "SELECT COUNT(*) n FROM trip_contributions WHERE trip_id=?",
    [r.tripId],
  );
  expect(Number(rows[0]?.n)).toBe(1);
});

test("audit, outbox and contribution failures roll back decision, credit, receipt and retention together", async () => {
  for (const phase of ["audit", "outbox", "contribution"] as const) {
    const r = await report(),
      before = await state(r.tripId);
    const table =
      phase === "audit"
        ? "audit_entries"
        : phase === "outbox"
          ? "outbox_events"
          : "trip_contributions";
    const predicate =
      phase === "audit"
        ? `subject_id <> ${control.escape(r.tripId)} OR operation <> 'report.reviewed'`
        : phase === "outbox"
          ? `aggregate_id <> ${control.escape(r.tripId)} OR type <> 'trip.decision_changed'`
          : `trip_id <> ${control.escape(r.tripId)} OR credited=0`;
    const [gate] = await control.execute<RowDataPacket[]>(
      "SELECT * FROM manual_review_gates WHERE trip_id=?",
      [r.tripId],
    );
    await control.query(
      `ALTER TABLE ${table} ADD CONSTRAINT synthetic_decision_failure CHECK (${predicate})`,
    );
    try {
      await expect(decide(r.tripId)).rejects.toBeTruthy();
    } finally {
      await control.query(`ALTER TABLE ${table} DROP CHECK synthetic_decision_failure`);
    }
    expect(await state(r.tripId)).toEqual(before);
    expect(await credit(r.tripId)).toBeUndefined();
    const [rows] = await control.execute<RowDataPacket[]>(
      "SELECT COUNT(*) n FROM trip_decisions WHERE trip_id=?",
      [r.tripId],
    );
    expect(Number(rows[0]?.n)).toBe(0);
    const [afterGate] = await control.execute<RowDataPacket[]>(
      "SELECT * FROM manual_review_gates WHERE trip_id=?",
      [r.tripId],
    );
    expect(afterGate).toEqual(gate);
  }
});

test("current ETag cannot approve a stale manual revision and revoked authority cannot replay a committed receipt", async () => {
  const r = await report(),
    old = await service.review(dispatcher, r.tripId);
  const fields = r.currentRevision.fields;
  if (!("origin" in fields)) throw Error("SYNTHETIC_MANUAL_V2_REQUIRED");
  const edited = await manual.reviseReport(owner, r.id, newId(), r.version, {
    fields: { ...fields, actualDistanceM: "124000" },
    expectedTripVersion: (await state(r.tripId))?.version as number,
  });
  const current = await service.review(dispatcher, r.tripId);
  await expect(
    service.decide(dispatcher, r.tripId, newId(), current.version, {
      decision: "accept",
      reviewedRevisionId: old.data.trip.manualRevision?.id as string,
      factRevisionId: current.data.factRevisionId,
      proposalId: null,
      reason: "Fictional stale revision",
    }),
  ).rejects.toMatchObject({ statusCode: 409 });
  expect(current.data.trip.manualRevision?.id).toBe(edited.currentRevision.id);
  const reviewer = await member(["dispatcher"]),
    key = newId();
  const value = {
    decision: "accept" as const,
    reviewedRevisionId: edited.currentRevision.id,
    factRevisionId: current.data.factRevisionId,
    proposalId: null,
    reason: "Fictional current review",
  };
  await service.decide(reviewer, r.tripId, key, current.version, value);
  await identity.administer(director, reviewer.userId, newId(), 1, {
    kind: "roles",
    roles: ["driver"],
  });
  await expect(
    service.decide(reviewer, r.tripId, key, current.version, value),
  ).rejects.toBeTruthy();
});

test("independent same-result adjudication invalidates obsolete merge reversal", async () => {
  const a = await receive(),
    b = await receive(),
    p = await state(a.tripId),
    s = await state(b.tripId),
    merged = await reconciliation.merge(director, newId(), {
      primaryTripId: a.tripId,
      secondaryTripId: b.tripId,
      primaryVersion: p?.version as number,
      secondaryVersion: s?.version as number,
      reason: "Fictional duplicate",
    });
  await decide(a.tripId);
  const current = await reconciliation.get(director, merged.data.id);
  await expect(
    reconciliation.reverse(director, merged.data.id, newId(), current.version, {
      primaryVersion: current.data.primaryVersion,
      secondaryVersion: current.data.secondaryVersion,
      reason: "Fictional obsolete reversal",
    }),
  ).rejects.toMatchObject({ statusCode: 409 });
});
test("every manual author in canonical aliases is forbidden from review or correction at every reviewer rank", async () => {
  for (const author of [
    await member(["driver", "dispatcher"]),
    await member(["driver", "deputy_director"]),
    director,
  ]) {
    const manualTrip = await report(author),
      primary = await receive(payload(), author);
    const a = await state(primary.tripId),
      b = await state(manualTrip.tripId);
    await reconciliation.merge(author.userId === director.userId ? dispatcher : director, newId(), {
      primaryTripId: primary.tripId,
      secondaryTripId: manualTrip.tripId,
      primaryVersion: a?.version as number,
      secondaryVersion: b?.version as number,
      reason: "Fictional alias authorship proof",
    });
    const review = await service.review(author, primary.tripId);
    expect(review.data.canDecide).toBe(false);
    await expect(decide(primary.tripId, "reject", author)).rejects.toMatchObject({
      statusCode: 403,
      publicCode: "SELF_REVIEW_FORBIDDEN",
    });
    await expect(
      service.propose(author, primary.tripId, newId(), review.version, {
        reason: "Fictional forbidden self correction",
        evidenceIds: [],
        actualDistanceM: "250000",
      }),
    ).rejects.toMatchObject({ statusCode: 403, publicCode: "SELF_REVIEW_FORBIDDEN" });
  }
});

test("pre-0014 reconciliation snapshots without adjudication markers remain reversible until an independent decision", async () => {
  const historicalWriter = createReconciliation(
    unit,
    { key: key() },
    { identity, trips: tripsService, qualifications, manual },
    now,
  );
  for (const independentlyReviewed of [false, true]) {
    const a = await receive(payload("started")),
      b = await receive(payload("started"));
    const primary = await state(a.tripId),
      secondary = await state(b.tripId);
    expect(primary?.adjudicationVersion).toBe(0);
    expect(secondary?.adjudicationVersion).toBe(0);
    const merged = await historicalWriter.merge(director, newId(), {
      primaryTripId: a.tripId,
      secondaryTripId: b.tripId,
      primaryVersion: primary?.version as number,
      secondaryVersion: secondary?.version as number,
      reason: "Fictional retained legacy merge",
    });
    // Privileged synthetic fixture models the JSON shape committed by pre-0014 writers.
    // Application reverse must read it without rewriting the immutable apply snapshot.
    const [rows] = await control.execute<RowDataPacket[]>(
      "SELECT snapshot FROM reconciliation_history WHERE reconciliation_id=? AND version=1",
      [merged.data.id],
    );
    const snapshot =
      typeof rows[0]?.snapshot === "string" ? JSON.parse(rows[0].snapshot) : rows[0]?.snapshot;
    for (const row of [...snapshot.before, ...snapshot.after]) {
      delete row.adjudicationVersion;
      delete row.assessmentPending;
    }
    const legacy = JSON.stringify(snapshot);
    await control.execute(
      "UPDATE reconciliation_history SET snapshot=? WHERE reconciliation_id=? AND version=1",
      [legacy, merged.data.id],
    );
    if (independentlyReviewed) await decide(a.tripId, "reject");
    const current = await reconciliation.get(director, merged.data.id);
    const reverse = reconciliation.reverse(director, merged.data.id, newId(), current.version, {
      primaryVersion: current.data.primaryVersion,
      secondaryVersion: current.data.secondaryVersion,
      reason: "Fictional legacy compatibility check",
    });
    if (independentlyReviewed) await expect(reverse).rejects.toMatchObject({ statusCode: 409 });
    else {
      expect((await reverse).data.state).toBe("reversed");
      expect((await state(b.tripId))?.aliasOf).toBeNull();
    }
    const [unchanged] = await control.execute<RowDataPacket[]>(
      "SELECT snapshot FROM reconciliation_history WHERE reconciliation_id=? AND version=1",
      [merged.data.id],
    );
    const retained =
      typeof unchanged[0]?.snapshot === "string"
        ? JSON.parse(unchanged[0].snapshot)
        : unchanged[0]?.snapshot;
    expect(retained).toEqual(snapshot);
  }
});

test("review/proposal privacy, current ETag and strict HTTP preconditions use existing browser contracts", async () => {
  const r = await report(),
    app = await createApp({
      identity,
      trips: tripsService,
      tripDecisions: service,
      checkReadiness: async () => true,
    });
  try {
    const review = await app.inject({
      url: `/api/v1/trips/${r.tripId}/review`,
      headers: { cookie: directorCookie },
    });
    expect(review.statusCode).toBe(200);
    expect(review.headers.etag).toBe(`"v${(await state(r.tripId))?.version}"`);
    expect(review.json().data.trip.view).toBe("private");
    const missing = await app.inject({
      method: "POST",
      url: `/api/v1/trips/${r.tripId}/decisions`,
      headers: {
        cookie: directorCookie,
        "content-type": "application/json",
        "idempotency-key": newId(),
      },
      payload: {},
    });
    expect([403, 428]).toContain(missing.statusCode);
  } finally {
    await app.close();
  }
});
test("denied reviewer GET leaves trip, qualification, review work and safe effects unchanged", async () => {
  const r = await report(),
    login = await identity.login(`${owner.userId}@example.invalid`, password),
    cookie = login.cookies.map((c) => c.split(";", 1)[0]).join("; ");
  const snapshots = async () => {
    const [work] = await control.execute<RowDataPacket[]>(
      "SELECT * FROM trip_review_work WHERE trip_id=?",
      [r.tripId],
    );
    const [qualification] = await control.execute<RowDataPacket[]>(
      "SELECT * FROM qualification_states WHERE user_id=? ORDER BY game",
      [owner.userId],
    );
    const [effects] = await control.query<RowDataPacket[]>(
      "SELECT (SELECT COUNT(*) FROM audit_entries) audit,(SELECT COUNT(*) FROM outbox_events) outbox",
    );
    return { trip: await state(r.tripId), work, qualification, effects };
  };
  const before = await snapshots(),
    app = await createApp({
      identity,
      trips: tripsService,
      tripDecisions: service,
      checkReadiness: async () => true,
    });
  try {
    const response = await app.inject({
      url: `/api/v1/trips/${r.tripId}/review`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(403);
    expect(await snapshots()).toEqual(before);
  } finally {
    await app.close();
  }
});

test("bounded activation catch-up and duplicate worker passes have no duplicate decisions", async () => {
  await service.catchup();
  const q = createQueue(unit, [service.handler]);
  await runPass(q, new AbortController().signal);
  await runPass(q, new AbortController().signal);
  const [rows] = await control.query<RowDataPacket[]>(
    "SELECT complete FROM trip_decision_catchup WHERE id=1",
  );
  expect(Boolean(rows[0]?.complete)).toBe(true);
});
test("disabled source intervals restart bounded catch-up generations and resume/replay without duplicate terminal effects", async () => {
  const q = createQueue(unit, [service.handler]);
  await service.catchup();
  await runPass(q, new AbortController().signal);
  const catchupState = async () => {
    const [rows] = await control.query<RowDataPacket[]>(
      "SELECT * FROM trip_decision_catchup WHERE id=1",
    );
    return rows[0] as RowDataPacket;
  };
  const baseline = await catchupState();
  expect(Boolean(baseline.complete)).toBe(true);
  const catalogs = composedModules().catalogs;
  if (!catalogs) throw Error("SYNTHETIC_CATALOG_REQUIRED");
  const disabled = createTrips(unit, { cursorKey: key() }, { identity, catalogs });
  const p = payload(),
    confirmed = await receive(p),
    oldCredit = await credit(confirmed.tripId),
    oldFact = (await state(confirmed.tripId))?.currentFactId;
  const disabledStore = (p: Telemetry) =>
    retryTransaction(unit, (tx) =>
      disabled.storeInTransaction(tx, "ets2telemetry", p, {
        ownerUserId: owner.userId,
        connection: { state: "unknown", referenceId: null },
      }),
    );
  const ids: string[] = [];
  for (let n = 0; n < 26; n++) ids.push((await disabledStore(payload())).tripId);
  const revision = structuredClone(p);
  revision.eventId = newId();
  revision.revision++;
  revision.type = "trip.corrected";
  if (revision.snapshot.observedDistance.available)
    revision.snapshot.observedDistance.value = 223400;
  if (revision.snapshot.deliveredDistance.available)
    revision.snapshot.deliveredDistance.value = 223400;
  await disabledStore(revision);
  expect((await state(confirmed.tripId))?.assessmentPending).toBe(true);
  expect(await credit(confirmed.tripId)).toEqual(oldCredit);
  await service.catchup();
  await service.catchup();
  const started = await catchupState();
  expect(started.generation).toBe(Number(baseline.generation) + 1);
  expect(Boolean(started.complete)).toBe(false);
  const token = await q.acquireRunner();
  if (!token) throw Error("SYNTHETIC_RUNNER_BUSY");
  try {
    let first: Awaited<ReturnType<typeof q.claim>> = null;
    for (let n = 0; n < 100; n++) {
      const claim = await q.claim(token);
      if (!claim) break;
      const ref = claim.reference as {
        eventId: string | null;
        generation: number;
        cursor: string | null;
      };
      if (ref.eventId === null && ref.generation === started.generation) {
        first = claim;
        break;
      }
      await q.execute(claim);
    }
    if (!first) throw Error("SYNTHETIC_CATCHUP_MISSING");
    await unit.run((tx) =>
      unit
        .client(tx)
        .update(durableJobs)
        .set({ leaseUntil: "2000-01-01T00:00:00.000Z" })
        .where(eq(durableJobs.id, first.id)),
    );
    const reclaimed = await q.claim(token);
    expect(reclaimed?.id).toBe(first.id);
    expect(reclaimed?.leaseToken).not.toBe(first.leaseToken);
    if (!reclaimed) throw Error("SYNTHETIC_RECLAIM_MISSING");
    await q.execute(reclaimed);
    await expect(q.execute(first)).rejects.toBeTruthy();
    const page = await catchupState();
    expect(Boolean(page.complete)).toBe(false);
    expect(page.cursor).not.toBeNull();
  } finally {
    await q.releaseRunner(token);
  }
  await service.catchup();
  await runPass(q, new AbortController().signal);
  expect(Boolean((await catchupState()).complete)).toBe(true);
  for (const id of ids) {
    expect((await state(id))?.decision).toBe("accepted");
    expect((await state(id))?.assessmentPending).toBe(false);
  }
  expect((await state(confirmed.tripId))?.currentFactId).toBe(oldFact);
  expect((await state(confirmed.tripId))?.correctionPending).toBe(true);
  expect(await credit(confirmed.tripId)).toEqual(oldCredit);
  const complete = await catchupState();
  await service.catchup();
  expect(await catchupState()).toEqual(complete);
  const extra = await disabledStore(payload());
  await service.catchup();
  const current = await catchupState();
  expect(current.generation).toBe(Number(complete.generation) + 1);
  await unit.run((tx) =>
    q.enqueue(tx, {
      kind: "trips.reevaluate",
      schemaVersion: 1,
      consumer: "trip-reevaluation-v1",
      effectKey: `synthetic:obsolete:${newId()}`,
      eventId: null,
      reference: { eventId: null, generation: complete.generation, cursor: null },
      availableAt: "2000-01-01T00:00:00.000Z",
      maxAttempts: 5,
    }),
  );
  const next = await q.acquireRunner();
  if (!next) throw Error("SYNTHETIC_RUNNER_BUSY");
  try {
    const stale = await q.claim(next);
    if (!stale) throw Error("SYNTHETIC_STALE_JOB_MISSING");
    expect((stale.reference as { generation: number }).generation).toBe(complete.generation);
    await q.execute(stale);
    expect((await state(extra.tripId))?.decision).toBe("unassessed");
  } finally {
    await q.releaseRunner(next);
  }
  await runPass(q, new AbortController().signal);
  expect((await state(extra.tripId))?.decision).toBe("accepted");
  const before = await state(extra.tripId),
    creditBefore = await credit(extra.tripId);
  const counts = async () => {
    const [r] = await control.execute<RowDataPacket[]>(
      "SELECT (SELECT COUNT(*) FROM trip_decisions WHERE trip_id=?) decisions,(SELECT COUNT(*) FROM trip_history WHERE trip_id=?) history,(SELECT COUNT(*) FROM outbox_events WHERE aggregate_id=?) outbox",
      [extra.tripId, extra.tripId, extra.tripId],
    );
    return r;
  };
  const unchanged = await counts();
  await unit.run((tx) =>
    unit
      .client(tx)
      .update(trips)
      .set({ assessmentPending: true })
      .where(eq(trips.id, extra.tripId)),
  );
  await service.catchup();
  await runPass(q, new AbortController().signal);
  expect(await state(extra.tripId)).toEqual(before);
  expect(await credit(extra.tripId)).toEqual(creditBefore);
  expect(await counts()).toEqual(unchanged);
});

test("representative review/proposal/event fanout plans expose the intended bounded indexes", async () => {
  for (const [query, index] of [
    [
      "SELECT id FROM trip_proposals WHERE trip_id=? ORDER BY created_at DESC,id DESC LIMIT 25",
      "trip_proposal_page",
    ],
    [
      "SELECT trip_id FROM trip_event_associations WHERE event_id=? ORDER BY trip_id LIMIT 26",
      "trip_event_fanout",
    ],
    [
      "SELECT trip_id FROM trip_review_work WHERE pending=1 AND trip_id>? ORDER BY trip_id LIMIT 26",
      "trip_review_pending",
    ],
    [
      "SELECT id FROM trips WHERE assessment_pending=1 AND alias_of IS NULL AND id>? ORDER BY id LIMIT 26",
      "trip_assessment_pending",
    ],
    [
      "SELECT id FROM events WHERE trip_assessment_pending=1 ORDER BY id LIMIT 25",
      "event_trip_assessment_pending",
    ],
  ] as const) {
    const [plan] = await control.execute<RowDataPacket[]>(
      `EXPLAIN ${query}`,
      query.includes("?") ? [newId()] : [],
    );
    expect(plan[0]?.possible_keys).toContain(index);
    console.log(
      JSON.stringify({
        event: "trip_decision_query_plan",
        shape: index,
        access: plan[0]?.type,
        index: plan[0]?.key,
        rows: String(plan[0]?.rows),
      }),
    );
  }
});

test("current attendance prescribed-load exception rejects RSVP/mismatch, fences obsolete support and freezes cancelled credit", async () => {
  const who = await member(),
    time = instant;
  try {
    const eventInput: S["EventInput"] = {
      title: "Fictional prescribed load",
      description: "Fictional attendance evidence",
      game: "ets2",
      server: "Synthetic",
      organizer: "Fictional company",
      route: "Synthetic route",
      meetingLocation: "Synthetic place",
      meetingAt: new Date(instant + 1800000).toISOString(),
      startsAt: new Date(instant + 3600000).toISOString(),
      endsAt: null,
      visibility: "members",
      originCityId: null,
      destinationCityId: null,
      prescribedCargoId: null,
      prescribedMassKg: "21000",
      prescribedTrailerTypeId: null,
    };
    const event = await events.create(director, newId(), eventInput),
      eventId = event.data.event.id;
    await events.respond(who, eventId, newId(), 1, { response: "participating" });
    const p = payload();
    if (p.snapshot.job.cargoMass.available) p.snapshot.job.cargoMass.value = 21000;
    const r = await receive(p, who);
    expect((await state(r.tripId))?.decision).toBe("rejected");
    const rsvp = await service.associate(
        who,
        r.tripId,
        newId(),
        (await state(r.tripId))?.version as number,
        { eventId },
      ),
      stale = await service.getProposal(dispatcher, r.tripId, rsvp.data.id);
    instant += 3600000;
    await events.setAttendance(director, eventId, newId(), 1, {
      members: [{ memberId: who.userId, attendance: "attended", note: null }],
    });
    await expect(
      decideProposal(dispatcher, r.tripId, stale.data.id, newId(), stale.version, {
        decision: "approve",
        reviewedRevisionId: stale.data.revisionId,
        reason: "Fictional obsolete attendance review",
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    const associated = await service.associate(
        who,
        r.tripId,
        newId(),
        (await state(r.tripId))?.version as number,
        { eventId },
      ),
      current = await service.getProposal(dispatcher, r.tripId, associated.data.id);
    const accepted = await decideProposal(
      dispatcher,
      r.tripId,
      current.data.id,
      newId(),
      current.version,
      {
        decision: "approve",
        reviewedRevisionId: current.data.revisionId,
        reason: "Fictional prescribed load confirmed",
      },
    );
    expect(accepted.data.outcome).toBe("accepted");
    expect(accepted.data.basis.eventId).toBe(eventId);
    expect((await credit(r.tripId))?.credited).toBe(true);
    const mismatch = payload();
    if (mismatch.snapshot.job.cargoMass.available) mismatch.snapshot.job.cargoMass.value = 22000;
    const other = await receive(mismatch, who),
      proposal = await service.associate(
        who,
        other.tripId,
        newId(),
        (await state(other.tripId))?.version as number,
        { eventId },
      ),
      detail = await service.getProposal(dispatcher, other.tripId, proposal.data.id);
    const rejected = await decideProposal(
      dispatcher,
      other.tripId,
      detail.data.id,
      newId(),
      detail.version,
      {
        decision: "approve",
        reviewedRevisionId: detail.data.revisionId,
        reason: "Fictional mismatched event load",
      },
    );
    expect(rejected.data.outcome).toBe("rejected");
    expect((await credit(other.tripId))?.credited).toBe(false);
    const before = await credit(r.tripId);
    await events.update(director, eventId, newId(), 1, {
      ...eventInput,
      prescribedMassKg: "22000",
    });
    await runPass(createQueue(unit, [service.handler]), new AbortController().signal);
    expect(await credit(r.tripId)).toEqual(before);
    expect((await state(r.tripId))?.correctionPending).toBe(true);
    await events.cancel(director, eventId, newId(), 2, "Fictional cancelled event");
    await runPass(createQueue(unit, [service.handler]), new AbortController().signal);
    expect(await credit(r.tripId)).toEqual(before);
    expect((await state(r.tripId))?.reviewHold).toBe(true);
  } finally {
    instant = time;
  }
});
test("event proposal references remain immutable and an old RR caller sees current event pins and attendance before assessment", async () => {
  const who = await member(),
    time = instant;
  try {
    const eventInput: S["EventInput"] = {
      title: "Fictional immutable event proposal",
      description: "Fictional current snapshot proof",
      game: "ets2",
      server: "Synthetic",
      organizer: "Synthetic",
      route: "Synthetic",
      meetingLocation: "Synthetic",
      meetingAt: new Date(instant + 1800000).toISOString(),
      startsAt: new Date(instant + 3600000).toISOString(),
      endsAt: null,
      visibility: "members",
      originCityId: null,
      destinationCityId: null,
      prescribedCargoId: ids.get("fixture_crates") as string,
      prescribedMassKg: "21000",
      prescribedTrailerTypeId: ids.get("fixture_trailer") as string,
    };
    const event = await events.create(director, newId(), eventInput),
      eventId = event.data.event.id,
      p = payload();
    if (p.snapshot.job.cargoMass.available) p.snapshot.job.cargoMass.value = 21000;
    const trip = await receive(p, who),
      initialVersion = (await state(trip.tripId))?.version as number,
      key = newId();
    const created = await service.associate(who, trip.tripId, key, initialVersion, { eventId }),
      original = await service.getProposal(dispatcher, trip.tripId, created.data.id);
    expect(original.data.eventAssociation).toMatchObject({ eventId, attendanceRevisionId: null });
    instant += 3600000;
    await events.setAttendance(director, eventId, newId(), 1, {
      members: [{ memberId: who.userId, attendance: "attended", note: null }],
    });
    const fresh = await service.associate(
        who,
        trip.tripId,
        newId(),
        (await state(trip.tripId))?.version as number,
        { eventId },
      ),
      detail = await service.getProposal(dispatcher, trip.tripId, fresh.data.id);
    expect(detail.data.eventAssociation?.attendanceRevisionId).not.toBeNull();
    await decideProposal(dispatcher, trip.tripId, detail.data.id, newId(), detail.version, {
      decision: "approve",
      reviewedRevisionId: detail.data.revisionId,
      reason: "Fictional current attendance and load",
    });
    const before = await credit(trip.tripId);
    let snapshotReady!: () => void, continueRead!: () => void;
    const ready = new Promise<void>((r) => {
        snapshotReady = r;
      }),
      proceed = new Promise<void>((r) => {
        continueRead = r;
      });
    const oldCaller = unit.run(async (tx) => {
      await unit.client(tx).select({ id: trips.id }).from(trips).where(eq(trips.id, trip.tripId));
      snapshotReady();
      await proceed;
      await identity.qualificationContextInTransaction(tx, [who.userId]);
      const current = await events.associateInTransaction(tx, who, {
        eventId,
        memberId: who.userId,
        game: "ets2",
      });
      const superseded = await events.associateInTransaction(tx, who, {
        eventId,
        memberId: who.userId,
        game: "ets2",
        eventRevisionId: detail.data.eventAssociation?.eventRevisionId as string,
        attendanceRevisionId: detail.data.eventAssociation?.attendanceRevisionId as string,
      });
      await service.assessInTransaction(tx, trip.tripId);
      return { current, superseded };
    });
    await ready;
    const peer = (async () => {
      try {
        await events.update(director, eventId, newId(), 1, {
          ...eventInput,
          prescribedMassKg: "22000",
        });
        await events.setAttendance(director, eventId, newId(), 2, {
          members: [{ memberId: who.userId, attendance: "attended", note: null }],
        });
      } finally {
        continueRead();
      }
    })();
    const settled = await Promise.allSettled([oldCaller, peer]);
    for (const result of settled) if (result.status === "rejected") throw result.reason;
    const result = settled[0];
    if (result?.status !== "fulfilled") throw Error("SYNTHETIC_CURRENT_READ_MISSING");
    expect(result.value.current.confirmedEvent).toMatchObject({
      prescribedCargoId: ids.get("fixture_crates"),
      prescribedMassKg: "22000",
      prescribedTrailerTypeId: ids.get("fixture_trailer"),
    });
    expect(result.value.current.attendanceRevisionId).not.toBe(
      detail.data.eventAssociation?.attendanceRevisionId,
    );
    expect(result.value.superseded.reviewRequired).toBe(true);
    expect(result.value.superseded.confirmedEvent).toBeNull();
    expect(await credit(trip.tripId)).toEqual(before);
    expect((await state(trip.tripId))?.reviewHold).toBe(true);
    const oldDetail = await service.getProposal(dispatcher, trip.tripId, original.data.id);
    expect(oldDetail.data.eventAssociation).toEqual(original.data.eventAssociation);
    expect(await service.associate(who, trip.tripId, key, initialVersion, { eventId })).toEqual(
      created,
    );
    await expect(
      decideProposal(dispatcher, trip.tripId, oldDetail.data.id, newId(), oldDetail.version, {
        decision: "approve",
        reviewedRevisionId: oldDetail.data.revisionId,
        reason: "Fictional superseded proposal",
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    const app = await createApp({
      identity,
      trips: tripsService,
      tripDecisions: service,
      checkReadiness: async () => true,
    });
    try {
      const detailResponse = await app.inject({
        url: `/api/v1/trips/${trip.tripId}/proposals/${original.data.id}`,
        headers: { cookie: directorCookie },
      });
      expect(detailResponse.statusCode).toBe(200);
      expect(detailResponse.json().data.eventAssociation).toEqual(original.data.eventAssociation);
      const list = await app.inject({
        url: `/api/v1/trips/${trip.tripId}/proposals`,
        headers: { cookie: directorCookie },
      });
      expect(list.statusCode).toBe(200);
      expect(
        list.json().data.items.find((p: { id: string }) => p.id === original.data.id)
          .eventAssociation,
      ).toEqual(original.data.eventAssociation);
    } finally {
      await app.close();
    }
  } finally {
    instant = time;
  }
});

test("Events support changes while decisions are disabled are durably caught up and RSVP cannot obsolete queued invalidation", async () => {
  const catalogs = composedModules().catalogs;
  if (!catalogs) throw Error("SYNTHETIC_CATALOG_REQUIRED");
  const offEvents = createEvents(unit, { cursorKey: key() }, { identity, catalogs }, now),
    who = await member(),
    time = instant,
    q = createQueue(unit, [service.handler]);
  try {
    const eventInput: S["EventInput"] = {
      title: "Fictional disabled-event interval",
      description: "Synthetic owning facade without adjudication callback",
      game: "ets2",
      server: "Synthetic",
      organizer: "Synthetic",
      route: "Synthetic",
      meetingLocation: "Synthetic",
      meetingAt: new Date(instant + 1800000).toISOString(),
      startsAt: new Date(instant + 3600000).toISOString(),
      endsAt: null,
      visibility: "members",
      originCityId: null,
      destinationCityId: null,
      prescribedCargoId: ids.get("fixture_crates") as string,
      prescribedMassKg: "21000",
      prescribedTrailerTypeId: ids.get("fixture_trailer") as string,
    };
    const created = await events.create(director, newId(), eventInput),
      eventId = created.data.event.id,
      p = payload();
    if (p.snapshot.job.cargoMass.available) p.snapshot.job.cargoMass.value = 21000;
    const trip = await receive(p, who);
    instant += 3600000;
    await events.setAttendance(director, eventId, newId(), 1, {
      members: [{ memberId: who.userId, attendance: "attended", note: null }],
    });
    const proposed = await service.associate(
        who,
        trip.tripId,
        newId(),
        (await state(trip.tripId))?.version as number,
        { eventId },
      ),
      detail = await service.getProposal(dispatcher, trip.tripId, proposed.data.id);
    await decideProposal(dispatcher, trip.tripId, detail.data.id, newId(), detail.version, {
      decision: "approve",
      reviewedRevisionId: detail.data.revisionId,
      reason: "Fictional confirmed supported event",
    });
    await runPass(q, new AbortController().signal);
    const before = await credit(trip.tripId);
    const support = async () => {
      const [rows] = await control.execute<RowDataPacket[]>(
        "SELECT trip_assessment_pending,trip_assessment_generation,change_sequence FROM events WHERE id=?",
        [eventId],
      );
      return rows[0] as RowDataPacket;
    };
    const jobs = async () => {
      const [rows] = await control.execute<RowDataPacket[]>(
        "SELECT COUNT(*) n FROM durable_jobs WHERE JSON_UNQUOTE(JSON_EXTRACT(reference,'$.eventId'))=?",
        [eventId],
      );
      return Number(rows[0]?.n);
    };
    const baseline = await support(),
      count = await jobs(),
      updateKey = newId(),
      updateValue = {
        ...eventInput,
        prescribedMassKg: "22000",
        meetingAt: new Date(instant + 1800000).toISOString(),
        startsAt: new Date(instant + 3600000).toISOString(),
      };
    expect(Number(baseline.trip_assessment_pending)).toBe(0);
    await offEvents.setAttendance(director, eventId, newId(), 2, {
      members: [
        {
          memberId: who.userId,
          attendance: "not_attended",
          note: "Fictional private attendance evidence",
        },
      ],
    });
    await offEvents.update(director, eventId, updateKey, 1, updateValue);
    const changed = await support();
    expect(Number(changed.trip_assessment_pending)).toBe(1);
    expect(Number(changed.trip_assessment_generation)).toBe(
      Number(baseline.trip_assessment_generation) + 2,
    );
    expect(await jobs()).toBe(count);
    expect(await credit(trip.tripId)).toEqual(before);
    expect((await state(trip.tripId))?.assessmentPending).toBe(false);
    await service.catchup();
    await service.catchup();
    expect(await jobs()).toBe(count + 1);
    expect(Number((await support()).trip_assessment_pending)).toBe(0);
    const queued = await support();
    await events.respond(who, eventId, newId(), 1, { response: "participating" });
    const rsvp = await support();
    expect(rsvp.trip_assessment_generation).toBe(queued.trip_assessment_generation);
    expect(Number(rsvp.change_sequence)).toBe(Number(queued.change_sequence) + 1);
    await runPass(q, new AbortController().signal);
    expect((await state(trip.tripId))?.reviewHold).toBe(true);
    expect(await credit(trip.tripId)).toEqual(before);
    await offEvents.update(director, eventId, updateKey, 1, updateValue);
    expect((await support()).trip_assessment_generation).toBe(rsvp.trip_assessment_generation);
    await offEvents.cancel(director, eventId, newId(), 2, "Fictional disabled cancellation");
    const cancelled = await support();
    expect(Number(cancelled.trip_assessment_generation)).toBe(
      Number(rsvp.trip_assessment_generation) + 1,
    );
    expect(Number(cancelled.trip_assessment_pending)).toBe(1);
    await service.catchup();
    await runPass(q, new AbortController().signal);
    expect(Number((await support()).trip_assessment_pending)).toBe(0);
    expect(await credit(trip.tripId)).toEqual(before);
    expect((await state(trip.tripId))?.correctionPending).toBe(true);
    const finalCount = await jobs();
    await service.catchup();
    await runPass(q, new AbortController().signal);
    expect(await jobs()).toBe(finalCount);
    expect(await credit(trip.tripId)).toEqual(before);
  } finally {
    instant = time;
  }
});

test("event fanout is bounded, disabled jobs pause, expired leases reclaim and duplicates preserve confirmed credit", async () => {
  const who = await member(),
    event = await events.create(director, newId(), {
      title: "Fictional fanout",
      description: "Synthetic bounded event invalidation",
      game: "ets2",
      server: "Synthetic",
      organizer: "Synthetic",
      route: "Synthetic",
      meetingLocation: "Synthetic",
      meetingAt: new Date(instant + 1800000).toISOString(),
      startsAt: new Date(instant + 3600000).toISOString(),
      endsAt: null,
      visibility: "members",
      originCityId: null,
      destinationCityId: null,
      prescribedCargoId: null,
      prescribedMassKg: null,
      prescribedTrailerTypeId: null,
    }),
    eventId = event.data.event.id,
    ids: string[] = [];
  for (let i = 0; i < 27; i++) {
    const r = await receive(payload(), who);
    ids.push(r.tripId);
  }
  await unit.run((tx) =>
    unit
      .client(tx)
      .insert(tripEventAssociations)
      .values(ids.map((tripId) => ({ tripId, eventId }))),
  );
  const before = await credit(ids[0] as string);
  await events.cancel(director, eventId, newId(), 1, "Fictional event invalidation");
  const paused = createQueue(unit, [], [], undefined, ["trips.reevaluate"]),
    pausedToken = await paused.acquireRunner();
  expect(pausedToken).not.toBeNull();
  try {
    expect(await paused.claim(pausedToken as string)).toBeNull();
  } finally {
    await paused.releaseRunner(pausedToken as string);
  }
  const q = createQueue(unit, [service.handler]),
    token = await q.acquireRunner();
  if (!token) throw Error("SYNTHETIC_RUNNER_BUSY");
  try {
    let first: Awaited<ReturnType<typeof q.claim>> = null;
    for (let i = 0; i < 100; i++) {
      const claim = await q.claim(token);
      if (!claim) break;
      const ref = claim.reference as { eventId: string; generation: number; cursor: string | null };
      if (ref.eventId === eventId && ref.generation === 2) {
        first = claim;
        break;
      }
      await q.execute(claim);
    }
    if (!first) throw Error("SYNTHETIC_EVENT_JOB_MISSING");
    await q.execute(first);
    const held = [];
    for (const id of ids) held.push(await state(id));
    expect(held.filter((t) => t?.correctionPending)).toHaveLength(25);
    await expect(q.execute(first)).rejects.toBeTruthy();
    let continuation: Awaited<ReturnType<typeof q.claim>> = null;
    for (let i = 0; i < 100; i++) {
      const claim = await q.claim(token);
      if (!claim) break;
      const ref = claim.reference as { eventId: string; generation: number; cursor: string | null };
      if (ref.eventId === eventId && ref.generation === 2 && ref.cursor !== null) {
        continuation = claim;
        break;
      }
      await q.execute(claim);
    }
    if (!continuation) throw Error("SYNTHETIC_CONTINUATION_MISSING");
    await unit.run((tx) =>
      unit
        .client(tx)
        .update(durableJobs)
        .set({ leaseUntil: "2000-01-01T00:00:00.000Z" })
        .where(eq(durableJobs.id, continuation.id)),
    );
    const reclaimed = await q.claim(token);
    expect(reclaimed?.id).toBe(continuation.id);
    expect(reclaimed?.leaseToken).not.toBe(continuation.leaseToken);
    if (!reclaimed) throw Error("SYNTHETIC_RECLAIM_MISSING");
    await q.execute(reclaimed);
    const completed = [];
    for (const id of ids) completed.push(await state(id));
    expect(completed.every((t) => t?.correctionPending)).toBe(true);
    expect(await credit(ids[0] as string)).toEqual(before);
  } finally {
    await q.releaseRunner(token);
  }
});
test("ambiguous COMMIT is returned once and durable receipt replay resolves committed decisions", async () => {
  const r = await report(),
    review = await service.review(dispatcher, r.tripId),
    commandKey = newId(),
    value: S["DecisionInput"] = {
      decision: "accept",
      reviewedRevisionId: r.currentRevision.id,
      factRevisionId: review.data.factRevisionId,
      proposalId: null,
      reason: "Fictional receipt loss",
    },
    receiptKey = key();
  let attempts = 0,
    loseReceipt = true;
  const faultUnit: UnitOfWork = {
    ...unit,
    run: async (work) => {
      attempts++;
      const result = await unit.run(work);
      if (loseReceipt) {
        loseReceipt = false;
        throw new TransactionCommitOutcomeUnknownError(
          new Error("SYNTHETIC_COMMITTED_RECEIPT_LOSS"),
        );
      }
      return result;
    },
  };
  const faultService = createTripDecisions(
    faultUnit,
    { key: receiptKey },
    {
      identity,
      trips: tripsService,
      qualifications,
      manual,
      events,
    },
    now,
  );
  await expect(
    faultService.decide(dispatcher, r.tripId, commandKey, review.version, value),
  ).rejects.toBeInstanceOf(TransactionCommitOutcomeUnknownError);
  expect(attempts).toBe(1);
  const before = await credit(r.tripId),
    replayed = await faultService.decide(dispatcher, r.tripId, commandKey, review.version, value);
  expect(replayed.data.outcome).toBe("accepted");
  expect(await credit(r.tripId)).toEqual(before);
});
function composedModules() {
  return composeIdentity(
    unit,
    { secret: key(), origin, production: false },
    undefined,
    undefined,
    false,
    {
      production: false,
      synthetic: true,
      cursorKey: key(),
      maxFileBytes: 1048576,
      artifactTtlMs: 86400000,
      policyRevision: 1,
      evidence: [],
    },
    { cursorKey: key() },
    undefined,
    { key: key(), maxFilesPerReport: 5, policyRevision: 1, orphanGraceMs: 60000 },
    { cursorKey: key() },
    { cursorKey: key() },
    { key: key() },
    { key: key() },
  );
}

test("production composition orders source reconciliation and assessment without a first outbox subscriber", async () => {
  const who = await member(),
    composed = composedModules();
  if (!composed.trips || !composed.tripDecisions) throw Error("SYNTHETIC_COMPOSITION_MISSING");
  const target = composed.trips;
  const p = payload(),
    result = await retryTransaction(unit, (tx) =>
      target.storeInTransaction(tx, "ets2telemetry", p, {
        ownerUserId: who.userId,
        connection: { state: "unknown", referenceId: null },
      }),
    );
  expect((await state(result.tripId))?.decision).toBe("accepted");
  expect((await credit(result.tripId))?.credited).toBe(true);
  expect((await composed.jobsQueue.inspect()).boundConsumers).toBe(0);
});
test("current production merge and immediate reverse preserve coherent final versions, evaluation and authoritative progress", async () => {
  const composed = composedModules();
  if (
    !composed.trips ||
    !composed.tripDecisions ||
    !composed.reconciliation ||
    !composed.qualifications ||
    !composed.catalogs
  )
    throw Error("SYNTHETIC_COMPOSITION_MISSING");
  const realTrips = composed.trips,
    decisions = composed.tripDecisions,
    recon = composed.reconciliation;
  const sourceOnly = createTrips(
    unit,
    { cursorKey: key() },
    { identity: composed.identity, catalogs: composed.catalogs },
  );
  for (const scenario of ["open", "violation", "accepted"] as const) {
    const who = await member(),
      results = [];
    for (let n = 0; n < 2; n++) {
      const p = payload(scenario === "open" ? "started" : "completed");
      if (scenario === "violation" && p.snapshot.job.cargoMass.available)
        p.snapshot.job.cargoMass.value = 21000;
      const source = scenario === "accepted" ? realTrips : sourceOnly;
      results.push(
        await retryTransaction(unit, (tx) =>
          source.storeInTransaction(tx, "ets2telemetry", p, {
            ownerUserId: who.userId,
            connection: { state: "unknown", referenceId: null },
          }),
        ),
      );
    }
    const leftId = results[0]?.tripId as string,
      rightId = results[1]?.tripId as string;
    const merge = async () =>
      recon.merge(director, newId(), {
        primaryTripId: leftId,
        secondaryTripId: rightId,
        primaryVersion: (await state(leftId))?.version as number,
        secondaryVersion: (await state(rightId))?.version as number,
        reason: "Fictional coherent current merge",
      });
    const merged = await merge(),
      appliedLeft = await state(leftId),
      appliedRight = await state(rightId);
    expect(merged.data.primaryVersion).toBe(appliedLeft?.version);
    expect(merged.data.secondaryVersion).toBe(appliedRight?.version);
    const [rows] = await control.execute<RowDataPacket[]>(
      "SELECT snapshot FROM reconciliation_history WHERE reconciliation_id=? AND version=1",
      [merged.data.id],
    );
    const snapshot =
      typeof rows[0]?.snapshot === "string" ? JSON.parse(rows[0].snapshot) : rows[0]?.snapshot;
    for (const saved of snapshot.after) expect(await state(saved.id)).toEqual(saved);
    if (scenario === "violation") expect(appliedLeft?.decision).toBe("rejected");
    const fresh = await recon.get(director, merged.data.id),
      reversed = await recon.reverse(director, merged.data.id, newId(), fresh.version, {
        primaryVersion: fresh.data.primaryVersion,
        secondaryVersion: fresh.data.secondaryVersion,
        reason: "Fictional immediate coherent reverse",
      });
    const finalLeft = await state(leftId),
      finalRight = await state(rightId);
    expect(reversed.data.primaryVersion).toBe(finalLeft?.version);
    expect(reversed.data.secondaryVersion).toBe(finalRight?.version);
    expect(finalRight?.aliasOf).toBeNull();
    for (const id of [leftId, rightId]) {
      const final = await state(id),
        review = await decisions.review(dispatcher, id),
        contribution = await credit(id);
      expect(review.version).toBe(final?.version);
      expect(review.data.trip.summary.decision).toBe(final?.decision);
      expect(review.data.evaluation.factRevisionId).toBe(final?.currentFactId);
      if (scenario === "accepted") {
        expect(final?.decision).toBe("accepted");
        expect(contribution?.credited).toBe(true);
        expect(contribution?.factId).toBe(final?.currentFactId);
      } else {
        expect(final?.decision).toBe(scenario === "violation" ? "rejected" : "pending_review");
        expect(contribution?.credited ?? false).toBe(false);
      }
    }
    const progress = await composed.qualifications.progress(director, who.userId, "ets2", "admin");
    expect(progress.data.acceptedTrips).toBe(scenario === "accepted" ? 2 : 0);
    if (scenario === "accepted") {
      const mergedAgain = await merge(),
        review = await decisions.review(dispatcher, leftId);
      await decisions.decide(dispatcher, leftId, newId(), review.version, {
        decision: "accept",
        reviewedRevisionId: review.data.factRevisionId,
        factRevisionId: review.data.factRevisionId,
        proposalId: null,
        reason: "Fictional later independent same outcome",
      });
      const current = await recon.get(director, mergedAgain.data.id);
      await expect(
        recon.reverse(director, mergedAgain.data.id, newId(), current.version, {
          primaryVersion: current.data.primaryVersion,
          secondaryVersion: current.data.secondaryVersion,
          reason: "Fictional obsolete current reversal",
        }),
      ).rejects.toMatchObject({ statusCode: 409 });
    }
  }
});

test("calendar-year renewed decisions and pending group review retain screenshots; committed deletion reservation rejects reopening", async () => {
  const r = await report(),
    id = r.currentRevision.fields.evidenceIds[0] as string,
    time = instant;
  await decide(r.tripId);
  const primary = await receive(),
    p = await state(primary.tripId),
    alias = await state(r.tripId);
  await reconciliation.merge(director, newId(), {
    primaryTripId: primary.tripId,
    secondaryTripId: r.tripId,
    primaryVersion: p?.version as number,
    secondaryVersion: alias?.version as number,
    reason: "Fictional group retention proof",
  });
  const effectiveId = primary.tripId;
  await decide(effectiveId);
  expect((await state(r.tripId))?.aliasOf).toBe(effectiveId);
  try {
    instant += 364 * 86400000;
    expect(await manual.reserveExpiry(id)).toBe(false);
    instant += 2 * 86400000;
    await decide(effectiveId);
    expect(await manual.reserveExpiry(id)).toBe(false);
    const proposed = await service.propose(
      dispatcher,
      effectiveId,
      newId(),
      (await state(effectiveId))?.version as number,
      { reason: "Fictional renewed review", evidenceIds: [id], actualDistanceM: "200000" },
    );
    instant += 400 * 86400000;
    expect(await manual.reserveExpiry(id)).toBe(false);
    await unit.run((tx) =>
      unit
        .client(tx)
        .update(manualEvidence)
        .set({ state: "deleting" })
        .where(eq(manualEvidence.id, id)),
    );
    const detail = await service
      .getProposal(dispatcher, effectiveId, proposed.data.id)
      .catch((e) => e);
    expect(detail).toMatchObject({ statusCode: 503, publicCode: "EVIDENCE_TRANSITION" });
    await expect(decide(effectiveId)).rejects.toMatchObject({
      statusCode: 503,
      publicCode: "EVIDENCE_TRANSITION",
    });
  } finally {
    instant = time;
  }
});

test.each(["manual", "open"] as const)(
  "HTTP rejection of a %s proposal before a first terminal decision preserves state and replays the actual ProposalReview",
  async (kind) => {
    const r = kind === "manual" ? await report() : await receive(payload("started")),
      id = r.tripId,
      before = await state(id);
    const evidenceIds =
      kind === "manual" ? (r as S["ManualReport"]).currentRevision.fields.evidenceIds : [];
    const proposalKey = newId(),
      proposalInput = {
        reason: "Fictional pre-decision correction",
        evidenceIds,
        actualDistanceM: "200000",
      };
    const p = await service.propose(
        dispatcher,
        id,
        proposalKey,
        before?.version as number,
        proposalInput,
      ),
      detail = await service.getProposal(dispatcher, id, p.data.id),
      token = csrfProtection(identity.config).issue({ cookie: directorCookie }, director).token,
      commandKey = newId(),
      body = {
        decision: "reject",
        reviewedRevisionId: detail.data.revisionId,
        reason: "Fictional insufficient correction evidence",
      };
    const app = await createApp({
      identity,
      trips: tripsService,
      tripDecisions: service,
      checkReadiness: async () => true,
    });
    try {
      const request = {
        method: "POST" as const,
        url: `/api/v1/trips/${id}/proposals/${p.data.id}/decisions`,
        headers: {
          cookie: directorCookie,
          origin,
          "content-type": "application/json",
          "x-csrf-token": token,
          "idempotency-key": commandKey,
          "if-match": `"v${detail.version}"`,
        },
        payload: body,
      };
      const response = await app.inject(request);
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toMatchObject({
        id: p.data.id,
        kind: "resolution",
        state: "rejected",
        review: {
          decision: "reject",
          reviewedRevisionId: detail.data.revisionId,
          reviewerId: director.userId,
        },
      });
      expect(response.json().data).not.toHaveProperty("outcome");
      const replay = await app.inject(request);
      expect(replay.statusCode).toBe(200);
      expect(replay.json().data).toEqual(response.json().data);
      expect(replay.headers.etag).toBe(response.headers.etag);
      expect((await state(id))?.decision).toBe(before?.decision);
      expect((await state(id))?.currentFactId).toBe(before?.currentFactId);
      expect(await credit(id)).toBeUndefined();
      expect((await service.getProposal(dispatcher, id, p.data.id)).data.state).toBe("rejected");
      expect(
        await service.propose(
          dispatcher,
          id,
          proposalKey,
          before?.version as number,
          proposalInput,
        ),
      ).toEqual(p);
      const [receipts] = await control.execute<RowDataPacket[]>(
        "SELECT result FROM trip_decision_commands WHERE actor_id=? AND `key`=?",
        [dispatcher.userId, proposalKey],
      );
      const stored =
        typeof receipts[0]?.result === "string"
          ? JSON.parse(receipts[0].result)
          : receipts[0]?.result;
      expect(stored).toEqual({
        kind: "command",
        id: p.data.id,
        version: p.version,
        reviewed: false,
      });
      const [decisions] = await control.execute<RowDataPacket[]>(
        "SELECT COUNT(*) n FROM trip_decisions WHERE trip_id=?",
        [id],
      );
      expect(Number(decisions[0]?.n)).toBe(0);
      const [events] = await control.execute<RowDataPacket[]>(
        "SELECT COUNT(*) n FROM outbox_events WHERE type='trip.proposal_reviewed' AND aggregate_id=?",
        [id],
      );
      expect(Number(events[0]?.n)).toBe(1);
    } finally {
      await app.close();
    }
  },
);

test("staff-supported telemetry time records explicit provenance and real historical credit without changing source time", async () => {
  const p = payload();
  p.snapshot.start = { utcMs: null, basis: "unknown", eventSeq: null };
  p.snapshot.evidence.startObserved = false;
  const r = await receive(p),
    row = await state(r.tripId);
  const proposed = await service.propose(dispatcher, r.tripId, newId(), row?.version as number, {
      reason: "Fictional reviewed structured time evidence",
      evidenceIds: [],
      actualDistanceM: "123400",
      actualStartAt: new Date(instant - 60000).toISOString(),
      actualCompletedAt: iso(),
    }),
    detail = await service.getProposal(dispatcher, r.tripId, proposed.data.id),
    approved = await decideProposal(deputy, r.tripId, detail.data.id, newId(), detail.version, {
      decision: "approve",
      reviewedRevisionId: detail.data.revisionId,
      reason: "Fictional confirmed historical start",
    });
  expect(approved.data.outcome).toBe("accepted");
  expect(approved.data.basis.attributionBasis).toBe("staff_resolution");
  expect((await credit(r.tripId))?.attributionBasis).toBe("staff_resolution");
  const [source] = await control.execute<RowDataPacket[]>(
    "SELECT start_utc,start_basis,start_verified FROM trip_facts WHERE message_id=?",
    [r.sourceRecordId],
  );
  expect(source[0]?.start_utc).toBeNull();
  expect(source[0]?.start_basis).toBe("unknown");
  expect(Boolean(source[0]?.start_verified)).toBe(false);
});

test("current reviewer GET stays coherent after ownership discovery establishes an old RR snapshot", async () => {
  const trip = await receive(payload());
  let ready!: () => void,
    resume!: () => void,
    gate = true;
  const discovered = new Promise<void>((r) => {
      ready = r;
    }),
    proceed = new Promise<void>((r) => {
      resume = r;
    });
  const observed = createTripDecisions(
    unit,
    service.config,
    {
      identity,
      qualifications,
      manual,
      events,
      trips: {
        ...tripsService,
        contributions: {
          ...tripsService.contributions,
          owners: async (tx, ids) => {
            const result = await tripsService.contributions.owners(tx, ids);
            if (gate && ids.includes(trip.tripId)) {
              gate = false;
              ready();
              await proceed;
            }
            return result;
          },
        },
      },
    },
    now,
  );
  const app = await createApp({
    identity,
    trips: tripsService,
    tripDecisions: observed,
    checkReadiness: async () => true,
  });
  try {
    await app.ready();
  } catch (error) {
    await app.close();
    throw error;
  }
  const response = app
    .inject({ url: `/api/v1/trips/${trip.tripId}/review`, headers: { cookie: directorCookie } })
    .then((r) => r);
  let pendingId!: string;
  try {
    await Promise.race([
      discovered,
      response.then(() => {
        throw Error("SYNTHETIC_REVIEW_RENDEZVOUS_NOT_REACHED");
      }),
    ]);
    try {
      await resolveDistance(trip.tripId, "200000");
      const current = await state(trip.tripId);
      pendingId = (
        await service.propose(dispatcher, trip.tripId, newId(), current!.version, {
          reason: "Fictional current pending request",
          evidenceIds: [],
          actualDistanceM: "210000",
        })
      ).data.id;
    } finally {
      resume();
    }
    const http = await response,
      current = await state(trip.tripId),
      detail = await service.review(director, trip.tripId);
    expect(http.statusCode).toBe(200);
    expect(http.headers.etag).toBe(`"v${current!.version}"`);
    expect(http.json().data).toEqual(detail.data);
    expect(http.json().data.trip.summary).toMatchObject({
      version: current!.version,
      decision: "accepted",
      actualDistanceM: "200000",
    });
    expect(http.json().data.factRevisionId).toBe(current!.currentFactId);
    expect(http.json().data.trip.pendingProposalId).toBe(pendingId);
    expect(
      http
        .json()
        .data.trip.decisions.some(
          (d: S["Decision"]) => d.basis.factRevisionId === current!.currentFactId,
        ),
    ).toBe(true);
    expect((await credit(trip.tripId))?.actualDistanceM).toBe("200000.000000000000000000");
  } finally {
    resume();
    await response;
    await app.close();
  }
});

test("obsolete proposal closure retains current guards and every other pending hold across approval and direct decisions", async () => {
  for (const order of ["approve-newest", "reject-oldest"]) {
    const trip = await receive(payload());
    async function propose(distance: string) {
      const row = await state(trip.tripId),
        result = await service.propose(dispatcher, trip.tripId, newId(), row!.version, {
          reason: "Fictional distinct resolution",
          evidenceIds: [],
          actualDistanceM: distance,
        });
      return (await service.getProposal(dispatcher, trip.tripId, result.data.id)).data;
    }
    const a = await propose("150000"),
      b = await propose("200000");
    const commandKey = newId(),
      reject = {
        decision: "reject" as const,
        reviewedRevisionId: a.revisionId,
        reason: "Fictional obsolete request closure",
      };
    let row = (await state(trip.tripId))!;
    await expect(
      service.proposalDecision(deputy, trip.tripId, a.id, newId(), row.version, {
        ...reject,
        decision: "approve",
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      service.proposalDecision(deputy, trip.tripId, a.id, newId(), row.version - 1, reject),
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      service.proposalDecision(deputy, trip.tripId, a.id, newId(), row.version, {
        ...reject,
        reviewedRevisionId: newId(),
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    if (order === "approve-newest") {
      await decideProposal(deputy, trip.tripId, b.id, newId(), row.version, {
        decision: "approve",
        reviewedRevisionId: b.revisionId,
        reason: "Fictional current correction",
      });
      expect((await state(trip.tripId))?.reviewHold).toBe(true);
      expect((await state(trip.tripId))?.correctionPending).toBe(true);
    }
    row = (await state(trip.tripId))!;
    const beforeCredit = await credit(trip.tripId),
      closed = await service.proposalDecision(
        deputy,
        trip.tripId,
        a.id,
        commandKey,
        row.version,
        reject,
      );
    expect((await service.getProposal(dispatcher, trip.tripId, a.id)).data.state).toBe("rejected");
    expect(await credit(trip.tripId)).toEqual(beforeCredit);
    expect(
      await service.proposalDecision(deputy, trip.tripId, a.id, commandKey, row.version, reject),
    ).toEqual(closed);
    if (order === "reject-oldest") {
      expect((await state(trip.tripId))?.reviewHold).toBe(true);
      expect((await service.review(dispatcher, trip.tripId)).data.trip.pendingProposalId).toBe(
        b.id,
      );
      await decide(trip.tripId);
      expect((await state(trip.tripId))?.reviewHold).toBe(true);
      const current = (await state(trip.tripId))!;
      await service.proposalDecision(deputy, trip.tripId, b.id, newId(), current.version, {
        decision: "reject",
        reviewedRevisionId: b.revisionId,
        reason: "Fictional remaining obsolete request closure",
      });
    }
    const final = await state(trip.tripId),
      review = await service.review(dispatcher, trip.tripId);
    expect(final?.reviewHold).toBe(false);
    expect(final?.correctionPending).toBe(false);
    expect(review.data.trip.pendingProposalId).toBeNull();
    const [work] = await control.execute<RowDataPacket[]>(
      "SELECT pending FROM trip_review_work WHERE trip_id=?",
      [trip.tripId],
    );
    expect(Number(work[0]?.pending)).toBe(0);
  }
});

test("linked staff resolutions terminalize only their originating correction request and preserve immutable history and other holds", async () => {
  for (const disposition of ["approve", "reject"] as const) {
    const r = await report();
    const accepted = await decide(r.tripId),
      acceptedCredit = await credit(r.tripId);
    const request = await manual.requestCorrection(owner, r.tripId, newId(), accepted.version, {
      reason: "Fictional owner correction request",
    });
    const initial = await service.review(dispatcher, r.tripId),
      evidenceId = initial.data.trip.evidence[0]!.id;
    const origins = await service.proposals(dispatcher, r.tripId),
      origin = origins.items.find((p) => p.correctionRequestId === request.id)!;
    expect(origin.id).not.toBe(request.id);
    expect(origin.kind).toBe("correction_request");
    await expect(
      service.propose(dispatcher, r.tripId, newId(), initial.version, {
        reason: "Fictional association alone",
        evidenceIds: [evidenceId],
        correctionRequestId: request.id,
      }),
    ).rejects.toMatchObject({ statusCode: 422 });
    await expect(
      service.propose(dispatcher, r.tripId, newId(), initial.version, {
        reason: "Fictional wrong request",
        evidenceIds: [evidenceId],
        actualDistanceM: "200000",
        correctionRequestId: newId(),
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
    const input = {
      reason: "Fictional supported linked distance",
      evidenceIds: [evidenceId],
      actualDistanceM: "200000",
      correctionRequestId: request.id,
    };
    const a = await service.propose(dispatcher, r.tripId, newId(), initial.version, input);
    const beforeB = (await state(r.tripId))!;
    const b = await service.propose(dispatcher, r.tripId, newId(), beforeB.version, input),
      detail = await service.getProposal(dispatcher, r.tripId, b.data.id);
    expect(detail.data.correctionRequestId).toBe(request.id);
    expect(detail.data.changes).not.toHaveProperty("correctionRequestId");
    const commandKey = newId(),
      reviewInput = {
        decision: disposition,
        reviewedRevisionId: detail.data.revisionId,
        reason: "Fictional exact linked request disposition",
      };
    instant += 1000;
    const result = await service.proposalDecision(
      deputy,
      r.tripId,
      b.data.id,
      commandKey,
      detail.version,
      reviewInput,
    );
    const readback = await manual.corrections(owner, r.tripId, {}, request.id);
    if (!("data" in readback)) throw Error("SYNTHETIC_CORRECTION_DETAIL_REQUIRED");
    const terminal = disposition === "approve" ? "resolved" : "declined";
    expect(readback.data).toMatchObject({
      id: request.id,
      status: terminal,
      history: [{ status: "pending" }, { status: terminal, reason: reviewInput.reason }],
    });
    const originReview = (await service.getProposal(dispatcher, r.tripId, origin.id)).data;
    expect(originReview.state).toBe(disposition === "approve" ? "approved" : "rejected");
    expect(originReview.review).toMatchObject({
      decision: disposition,
      reviewedRevisionId: origin.revisionId,
      reviewerId: deputy.userId,
      reason: reviewInput.reason,
    });
    expect(originReview.review?.decidedAt).toBe(
      (await service.getProposal(dispatcher, r.tripId, b.data.id)).data.review?.decidedAt,
    );
    expect((await state(r.tripId))?.reviewHold).toBe(true);
    if (disposition === "approve") {
      const c = await credit(r.tripId);
      expect(c?.actualDistanceM).toBe("200000.000000000000000000");
      expect(c?.factId).not.toBe(acceptedCredit?.factId);
      const [facts] = await control.execute<RowDataPacket[]>(
        "SELECT changes FROM trip_resolutions WHERE id=(SELECT resolution_id FROM trip_proposals WHERE id=?)",
        [b.data.id],
      );
      const changes =
        typeof facts[0]?.changes === "string" ? JSON.parse(facts[0].changes) : facts[0]?.changes;
      expect(changes).not.toHaveProperty("correctionRequestId");
    } else expect(await credit(r.tripId)).toEqual(acceptedCredit);
    expect(
      await service.proposalDecision(
        deputy,
        r.tripId,
        b.data.id,
        commandKey,
        detail.version,
        reviewInput,
      ),
    ).toEqual(result);
    const older = await service.getProposal(dispatcher, r.tripId, a.data.id),
      beforeClose = await credit(r.tripId);
    await expect(
      service.proposalDecision(deputy, r.tripId, older.data.id, newId(), older.version, {
        decision: "approve",
        reviewedRevisionId: older.data.revisionId,
        reason: "Fictional cannot reopen handled request",
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    await service.proposalDecision(deputy, r.tripId, older.data.id, newId(), older.version, {
      decision: "reject",
      reviewedRevisionId: older.data.revisionId,
      reason: "Fictional obsolete linked proposal closed",
    });
    const finalRequest = await manual.corrections(owner, r.tripId, {}, request.id);
    if (!("data" in finalRequest)) throw Error("SYNTHETIC_CORRECTION_DETAIL_REQUIRED");
    expect(finalRequest.data).toEqual(readback.data);
    expect((await service.getProposal(dispatcher, r.tripId, origin.id)).data).toEqual(originReview);
    expect(await credit(r.tripId)).toEqual(beforeClose);
    expect((await state(r.tripId))?.reviewHold).toBe(false);
    const app = await createApp({
      identity,
      trips: tripsService,
      tripDecisions: service,
      manualReports: manual,
      checkReadiness: async () => true,
    });
    try {
      const detailHttp = await app.inject({
        url: `/api/v1/trips/${r.tripId}/correction-requests/${request.id}`,
        headers: { cookie: directorCookie },
      });
      const listHttp = await app.inject({
        url: `/api/v1/trips/${r.tripId}/correction-requests`,
        headers: { cookie: directorCookie },
      });
      expect(detailHttp.statusCode).toBe(200);
      expect(listHttp.statusCode).toBe(200);
      expect(detailHttp.json().data).toEqual(readback.data);
      expect(
        listHttp.json().data.items.find((p: S["ManualCorrectionRequest"]) => p.id === request.id),
      ).toEqual(readback.data);
    } finally {
      await app.close();
    }
  }
});

test("linked correction history and downstream failure roll back request, origin review, credit, retention and permanent receipt together", async () => {
  for (const failure of ["history", "outbox"] as const) {
    const r = await report(),
      accepted = await decide(r.tripId),
      request = await manual.requestCorrection(owner, r.tripId, newId(), accepted.version, {
        reason: "Fictional atomic request",
      });
    const workspace = await service.review(dispatcher, r.tripId),
      proposal = await service.propose(dispatcher, r.tripId, newId(), workspace.version, {
        reason: "Fictional atomic correction",
        evidenceIds: [workspace.data.trip.evidence[0]!.id],
        actualDistanceM: "200000",
        correctionRequestId: request.id,
      }),
      detail = await service.getProposal(dispatcher, r.tripId, proposal.data.id),
      commandKey = newId(),
      input = {
        decision: "approve" as const,
        reviewedRevisionId: detail.data.revisionId,
        reason: "Fictional atomic review",
      };
    async function snapshot() {
      const [gate] = await control.execute<RowDataPacket[]>(
        "SELECT * FROM manual_review_gates WHERE trip_id=?",
        [r.tripId],
      );
      const [counts] = await control.execute<RowDataPacket[]>(
        "SELECT (SELECT COUNT(*) FROM trip_proposal_reviews WHERE proposal_id IN (SELECT id FROM trip_proposals WHERE trip_id=?)) reviews,(SELECT COUNT(*) FROM trip_decision_commands WHERE actor_id=? AND `key`=?) receipts,(SELECT COUNT(*) FROM audit_entries) audit,(SELECT COUNT(*) FROM outbox_events) outbox",
        [r.tripId, deputy.userId, commandKey],
      );
      return {
        trip: await state(r.tripId),
        credit: await credit(r.tripId),
        request: await manual.corrections(owner, r.tripId, {}, request.id),
        gate,
        counts,
      };
    }
    const before = await snapshot(),
      table = failure === "history" ? "manual_correction_history" : "outbox_events",
      predicate =
        failure === "history"
          ? `request_id<>${control.escape(request.id)} OR status='pending'`
          : `aggregate_id<>${control.escape(r.tripId)} OR type<>'trip.proposal_reviewed'`;
    await control.query(
      `ALTER TABLE ${table} ADD CONSTRAINT synthetic_linked_failure CHECK (${predicate})`,
    );
    try {
      await expect(
        service.proposalDecision(
          deputy,
          r.tripId,
          proposal.data.id,
          commandKey,
          detail.version,
          input,
        ),
      ).rejects.toBeTruthy();
    } finally {
      await control.query(`ALTER TABLE ${table} DROP CHECK synthetic_linked_failure`);
    }
    expect(await snapshot()).toEqual(before);
    const committed = await service.proposalDecision(
      deputy,
      r.tripId,
      proposal.data.id,
      commandKey,
      detail.version,
      input,
    );
    expect(
      await service.proposalDecision(
        deputy,
        r.tripId,
        proposal.data.id,
        commandKey,
        detail.version,
        input,
      ),
    ).toEqual(committed);
  }
});

test("direct author-request disposition, resolved rejected facts and null association replay retain exact lifecycle provenance", async () => {
  const r = await report(),
    accepted = await decide(r.tripId),
    request = await manual.requestCorrection(owner, r.tripId, newId(), accepted.version, {
      reason: "Fictional directly declined request",
    });
  const origin = (await service.proposals(dispatcher, r.tripId)).items.find(
    (p) => p.correctionRequestId === request.id,
  )!;
  instant += 1000;
  await service.proposalDecision(
    deputy,
    r.tripId,
    origin.id,
    newId(),
    (await state(r.tripId))!.version,
    {
      decision: "reject",
      reviewedRevisionId: origin.revisionId,
      reason: "Fictional direct disposition",
    },
  );
  const declined = await manual.corrections(owner, r.tripId, {}, request.id);
  if (!("data" in declined)) throw Error("SYNTHETIC_CORRECTION_DETAIL_REQUIRED");
  expect(declined.data.status).toBe("declined");
  expect(declined.data.history.map((h) => h.status)).toEqual(["pending", "declined"]);
  const next = await manual.requestCorrection(
    owner,
    r.tripId,
    newId(),
    (await state(r.tripId))!.version,
    { reason: "Fictional proven mass correction" },
  );
  const review = await service.review(dispatcher, r.tripId),
    proposal = await service.propose(dispatcher, r.tripId, newId(), review.version, {
      reason: "Fictional supported violation",
      evidenceIds: [review.data.trip.evidence[0]!.id],
      cargoMassKg: "21000",
      correctionRequestId: next.id,
    }),
    detail = await service.getProposal(dispatcher, r.tripId, proposal.data.id);
  instant += 1000;
  const decision = await decideProposal(
    deputy,
    r.tripId,
    proposal.data.id,
    newId(),
    detail.version,
    {
      decision: "approve",
      reviewedRevisionId: detail.data.revisionId,
      reason: "Fictional corrected facts prove rejection",
    },
  );
  expect(decision.data.outcome).toBe("rejected");
  const resolved = await manual.corrections(owner, r.tripId, {}, next.id);
  if (!("data" in resolved)) throw Error("SYNTHETIC_CORRECTION_DETAIL_REQUIRED");
  expect(resolved.data.status).toBe("resolved");
  expect((await credit(r.tripId))?.credited).toBe(false);
  const trip = await receive(payload()),
    key = newId(),
    version = (await state(trip.tripId))!.version,
    value = {
      reason: "Fictional optional association",
      evidenceIds: [],
      actualDistanceM: "150000",
    };
  const original = await service.propose(dispatcher, trip.tripId, key, version, value);
  expect(
    await service.propose(dispatcher, trip.tripId, key, version, {
      ...value,
      correctionRequestId: null,
    }),
  ).toEqual(original);
  expect(
    (await service.getProposal(dispatcher, trip.tripId, original.data.id)).data.correctionRequestId,
  ).toBeNull();
});
