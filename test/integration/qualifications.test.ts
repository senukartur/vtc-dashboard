import { randomBytes } from "node:crypto";
import { createUnitOfWork, newId, runMigrations, type UnitOfWork } from "@vtc/db";
import { eq, membership, roles } from "@vtc/db/identity-schema";
import {
  qualificationAssignments,
  qualificationPromotions,
  qualificationRules,
  qualificationStates,
} from "@vtc/db/qualifications-schema";
import { sourceMessages, sourceTrips, tripContributions, trips } from "@vtc/db/trips-schema";
import type { Connection, RowDataPacket } from "mysql2/promise";
import {
  beforeEach,
  expect,
  test,
  afterAll as vitestAfterAll,
  beforeAll as vitestBeforeAll,
} from "vitest";
import { createApp } from "../../apps/api/src/app.ts";
import {
  type Actor,
  createIdentity,
  type Identity,
} from "../../apps/api/src/modules/identity/service.ts";
import {
  createQualificationInitialization,
  type Game,
  structuralLevels,
} from "../../apps/api/src/modules/qualifications/initialization.ts";
import {
  createQualifications,
  type Qualifications,
} from "../../apps/api/src/modules/qualifications/service.ts";
import type { NormalizedTripEvidence } from "../../apps/api/src/modules/sources/contracts/evidence.ts";
import {
  type Telemetry,
  telemetryAdapter,
} from "../../apps/api/src/modules/sources/contracts/telemetry.ts";
import type { ContributionChange } from "../../apps/api/src/modules/trips/contributions.ts";
import { createFactRepository } from "../../apps/api/src/modules/trips/facts.ts";
import { createTrips, type Trips } from "../../apps/api/src/modules/trips/service.ts";
import { createOutbox, identityAccessEvents } from "../../apps/api/src/platform/outbox/events.ts";
import {
  guardedSettings,
  reset,
  SCHEMA_SETUP_TIMEOUT_MS,
  testConnection,
} from "../persistence/support.ts";
import { telemetryFixture } from "../support/builders.ts";
import { deferred } from "../support/concurrency.ts";
import { schemaLifecycleHooks } from "../support/schema-lifecycle.ts";

const { beforeAll, afterAll } = schemaLifecycleHooks(vitestBeforeAll, vitestAfterAll);

let control: Connection,
  unit: UnitOfWork,
  identity: Identity,
  tripService: Trips,
  service: Qualifications;
let director: Actor,
  owner: Actor,
  deputy: Actor,
  observer: Actor,
  ownerCookie: string,
  directorCookie: string;
const origin = "http://127.0.0.1:4173",
  password = "Fictional-qualification-passphrase-42";
const identityConfig = { secret: randomBytes(32).toString("hex"), origin, production: false };
const config = { cursorKey: randomBytes(32).toString("hex") };
let instant = Date.parse("2026-10-20T12:00:00.000Z");
const now = () => new Date(instant),
  tick = (ms = 1000) => {
    instant += ms;
  };
const iso = () => now().toISOString();
async function member(
  assigned: ("driver" | "trainee" | "dispatcher" | "deputy_director")[] = ["trainee"],
  initialize = true,
) {
  const id = newId(),
    email = `${id}@example.invalid`,
    credential = await identity.prepareCredential(password);
  await unit.run(async (tx) => {
    await identity.insertWithCredential(tx, {
      userId: id,
      email,
      name: "Fictional Qualification Member",
      ...credential,
      roles: assigned,
    });
    if (initialize)
      await createQualificationInitialization(unit).initialize(tx, {
        userId: id,
        games: ["ets2", "ats"],
        assignedAt: iso(),
      });
  });
  const login = await identity.login(email, password),
    cookie = login.cookies.map((v) => v.split(";", 1)[0]).join("; ");
  return { actor: await identity.authenticate(new Headers({ cookie })), cookie };
}
async function publish(
  game: Game = "ets2",
  rank = 0,
  requiredTrips: number | null = 1,
  requiredDistanceM: string | null = "100",
  extra: { effectiveAt?: string } = {},
) {
  const levelId = structuralLevels[game][rank] as string;
  const selected = (await service.levels(director, game)).items.find((v) => v.id === levelId);
  if (!selected) throw new Error("SYNTHETIC_LEVEL_MISSING");
  return service.publish(director, levelId, newId(), selected.version, {
    rules: [{ type: "max_mass", maxKg: "20000" }],
    requiredTrips,
    requiredDistanceM,
    reason: "Fictional reviewed configuration",
    ...extra,
  });
}
async function fixture(
  options: {
    game?: Game;
    distance?: string;
    start?: string | null;
    provider?: "manual" | "ets2telemetry";
    decision?: "accepted" | "rejected";
    ownerId?: string;
  } = {},
) {
  const ownerId = options.ownerId ?? owner.userId,
    tripId = newId(),
    sourceId = newId(),
    messageId = newId(),
    factId = newId();
  let evidence!: NormalizedTripEvidence;
  await unit.run(async (tx) => {
    await identity.qualificationContextInTransaction(tx, [ownerId]);
    const payload = telemetryFixture("completed") as unknown as Telemetry;
    evidence = await telemetryAdapter.normalize(payload, {
      tx,
      ownerUserId: ownerId,
      sourceRecordId: messageId,
      factRevisionId: factId,
    });
    evidence = {
      ...evidence,
      game: options.game ?? "ets2",
      provider: options.provider ?? "ets2telemetry",
      recording: options.provider === "manual" ? "unknown" : "complete",
      wholeTripDistanceSupported: options.provider !== "manual",
      actualDistanceM: {
        status: "known",
        value: options.distance ?? "100",
        sourceRecordId: messageId,
        sourceField: "synthetic.actualDistance",
      },
      plannedDistanceM: {
        status: "known",
        value: "999999",
        sourceRecordId: messageId,
        sourceField: "synthetic.plannedDistance",
      },
      start:
        options.provider === "manual" || options.start === null
          ? { utc: null, basis: "unknown", verifiedActual: false }
          : { utc: options.start ?? iso(), basis: "event", verifiedActual: true },
      end: { utc: null, basis: "unknown", verifiedActual: false },
    };
    await unit
      .client(tx)
      .insert(trips)
      .values({
        id: tripId,
        ownerId,
        game: evidence.game,
        version: 1,
        outcome: "delivered",
        recording: "complete",
        decision: options.decision ?? "accepted",
        currentFactId: factId,
        actualDistanceM: options.distance ?? "100",
        reviewReasons: [],
        createdAt: iso(),
      });
    await unit
      .client(tx)
      .insert(sourceTrips)
      .values({
        id: sourceId,
        provider: evidence.provider,
        game: evidence.game,
        sessionKey: Buffer.from(newId()),
        tripKey: Buffer.from(newId()),
        ownerId,
        canonicalTripId: tripId,
        latestRevision: "1",
        connectionContext: { state: "unknown", referenceId: null },
        createdAt: iso(),
      });
    await unit
      .client(tx)
      .insert(sourceMessages)
      .values({
        id: messageId,
        sourceTripId: sourceId,
        provider: evidence.provider,
        eventKey: Buffer.from(newId()),
        revision: "1",
        sha256: randomBytes(32),
        receivedAt: iso(),
        deliveryMode: evidence.provider === "manual" ? "manual" : "backfill",
      });
    await createFactRepository(unit).insert(tx, tripId, evidence, 1);
  });
  return {
    tripId,
    sourceId,
    evidence,
    change: { tripId, expectedTripVersion: 1, version: 1, factId } satisfies ContributionChange,
  };
}
const replace = (changes: ContributionChange[]) =>
  identity.transaction((tx) => service.replaceContributionsInTransaction(tx, changes));
async function correction(
  f: Awaited<ReturnType<typeof fixture>>,
  version: number,
  decision: "accepted" | "rejected",
  distance?: string,
  start?: string,
) {
  return identity.transaction(async (tx) => {
    await identity.qualificationContextInTransaction(tx, [f.evidence.ownerUserId]);
    const [trip] = await unit
      .client(tx)
      .select()
      .from(trips)
      .where(eq(trips.id, f.tripId))
      .for("update");
    if (!trip) throw new Error("SYNTHETIC_TRIP_MISSING");
    let factId = trip.currentFactId as string;
    if (distance !== undefined || start !== undefined) {
      const messageId = newId();
      factId = newId();
      const next = {
        ...f.evidence,
        sourceRecordId: messageId,
        factRevisionId: factId,
        ...(start ? { start: { utc: start, basis: "event" as const, verifiedActual: true } } : {}),
        actualDistanceM: {
          status: "known" as const,
          value:
            distance ??
            (f.evidence.actualDistanceM.status === "known"
              ? f.evidence.actualDistanceM.value
              : "0"),
          sourceRecordId: messageId,
          sourceField: "synthetic.correctedDistance",
        },
      };
      await unit
        .client(tx)
        .insert(sourceMessages)
        .values({
          id: messageId,
          sourceTripId: f.sourceId,
          provider: f.evidence.provider,
          eventKey: Buffer.from(newId()),
          revision: String(version),
          sha256: randomBytes(32),
          receivedAt: iso(),
          deliveryMode: f.evidence.provider === "manual" ? "manual" : "backfill",
        });
      await createFactRepository(unit).insert(tx, f.tripId, next, 1);
    }
    await unit
      .client(tx)
      .update(trips)
      .set({ version: trip.version + 1, currentFactId: factId, decision })
      .where(eq(trips.id, f.tripId));
    return service.replaceContributionsInTransaction(tx, [
      { ...f.change, version, expectedTripVersion: trip.version + 1, factId },
    ]);
  });
}
const progress = (game: Game = "ets2", target = owner) =>
  service.progress(director, target.userId, game, "admin");
async function promote(game: Game = "ets2", target = owner, actor = director, key = newId()) {
  const p = await service.progress(actor, target.userId, game, "admin"),
    rank = structuralLevels[game].indexOf(p.data.assignment.levelId as never);
  return service.promote(actor, target.userId, key, p.version, {
    game,
    assignmentId: p.data.assignment.id,
    targetLevelId: structuralLevels[game][rank + 1] as string,
    reason: "Fictional promotion confirmation",
  });
}
beforeAll(async () => {
  control = await testConnection();
  unit = createUnitOfWork(guardedSettings());
  await reset(control);
  await runMigrations(guardedSettings());
  identity = createIdentity(
    unit,
    identityConfig,
    {
      accessEvents: identityAccessEvents(unit),
      qualificationsLifecycle: createQualificationInitialization(unit),
    },
    now,
  );
  await identity.bootstrap({
    email: "qualification-director@example.invalid",
    name: "Fictional Qualification Director",
    password,
  });
  const login = await identity.login("qualification-director@example.invalid", password);
  directorCookie = login.cookies.map((v) => v.split(";", 1)[0]).join("; ");
  director = await identity.authenticate(new Headers({ cookie: directorCookie }));
  tripService = createTrips(
    unit,
    { cursorKey: randomBytes(32).toString("hex") },
    { identity },
    now,
  );
  service = createQualifications(unit, config, { identity, trips: tripService }, now);
}, SCHEMA_SETUP_TIMEOUT_MS);
beforeEach(async () => {
  for (const table of [
    "trip_contribution_history",
    "trip_contributions",
    "qualification_promotion_reviews",
    "qualification_promotions",
    "qualification_states",
    "qualification_assignments",
    "qualification_rule_versions",
    "qualification_initial_assignments",
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
  await control.query("UPDATE qualification_levels SET version=1");
  instant = Date.parse("2026-10-20T12:00:00.000Z");
  const a = await member(),
    b = await member(["deputy_director", "dispatcher"]),
    d = await member(["driver"]);
  owner = a.actor;
  ownerCookie = a.cookie;
  deputy = b.actor;
  observer = d.actor;
});
afterAll(async () => {
  await unit?.close();
  await control?.end();
});
test("structural levels have no launch defaults; unset either threshold stays ineligible", async () => {
  const levels = await service.levels(owner, "ets2");
  expect(levels.items.map((v) => v.code)).toEqual([
    "trainee",
    "driver_iii",
    "driver_ii",
    "driver_i",
  ]);
  expect(
    levels.items.every(
      (v) => !v.configured && v.requiredTrips === null && v.requiredDistanceM === null,
    ),
  ).toBe(true);
  expect((await progress()).data.eligibleForConfirmation).toBe(false);
  await publish("ets2", 0, 1, null);
  tick();
  const f = await fixture();
  await replace([f.change]);
  expect((await progress()).data.eligibleForConfirmation).toBe(false);
  await expect(promote()).rejects.toMatchObject({ statusCode: 409 });
  tick();
  await publish("ets2", 0, null, "1");
  expect((await progress()).data.eligibleForConfirmation).toBe(false);
});
test("both count AND exact actual distance are required and thresholds never promote automatically", async () => {
  await publish("ets2", 0, 2, "200.000000000000000001");
  tick();
  const a = await fixture({ distance: "100" }),
    b = await fixture({ distance: "100" });
  await replace([a.change, b.change]);
  expect((await progress()).data).toMatchObject({
    acceptedTrips: 2,
    actualDistanceM: "200",
    eligibleForConfirmation: false,
    projectionPending: false,
  });
  await correction(b, 2, "accepted", "100.000000000000000001");
  expect((await progress()).data.eligibleForConfirmation).toBe(true);
  expect((await identity.current(owner)).data.member.roles).toContain("trainee");
  const result = await promote();
  expect(result).toMatchObject({ data: { levelId: structuralLevels.ets2[1] } });
  expect((await progress("ats")).data.assignment.levelId).toBe(structuralLevels.ats[0]);
  expect((await identity.current(owner)).data.member.roles).toEqual(["driver"]);
  expect((await progress()).data).toMatchObject({
    acceptedTrips: 0,
    actualDistanceM: "0",
    eligibleForConfirmation: false,
  });
});
test("historical start uses millisecond half-open periods and immutable rule effective versions", async () => {
  await publish();
  const initial = (await progress()).data.assignment;
  tick(1);
  const boundary = iso();
  await publish("ets2", 0, 1, "200");
  const before = await fixture({ start: initial.assignedAt }),
    atBoundary = await fixture({ start: boundary }),
    unknown = await fixture({ start: "2026-10-20T11:59:59.999Z" });
  const look = async (f: typeof before) =>
    unit.run((tx) => service.lookupInTransaction(tx, f.evidence));
  const old = await look(before),
    next = await look(atBoundary);
  expect(old.status).toBe("resolved");
  expect(next.status).toBe("resolved");
  if (old.status !== "resolved" || next.status !== "resolved") throw new Error();
  expect(next.ruleVersionId).not.toBe(old.ruleVersionId);
  expect((await look(unknown)).status).toBe("unresolved");
  tick();
  await replace([before.change, atBoundary.change]);
  await promote();
  const promotedAt = iso();
  tick();
  const late = await fixture({ start: boundary }),
    fresh = await fixture({ start: promotedAt });
  await replace([late.change, fresh.change]);
  expect((await progress()).data.acceptedTrips).toBe(0);
  // The next level is deliberately unconfigured; its exact-boundary history is not replaced by old rules.
  expect(await look(fresh)).toMatchObject({
    status: "unresolved",
    reasonCode: "qualification_rules_unconfigured",
  });
});
test("unknown telemetry start is unresolved while undated manual uses explicit confirmation without inventing gameplay time", async () => {
  await publish();
  tick();
  const unknown = await fixture({ start: null }),
    manual = await fixture({ provider: "manual" });
  await replace([unknown.change, manual.change]);
  expect((await progress()).data.acceptedTrips).toBe(0);
  await replace([{ ...manual.change, version: 2, manualConfirmedAt: iso() }]);
  expect((await progress()).data.acceptedTrips).toBe(1);
  const [saved] = await unit.run((tx) =>
    unit
      .client(tx)
      .select()
      .from(tripContributions)
      .where(eq(tripContributions.tripId, manual.tripId)),
  );
  expect(saved).toMatchObject({ attributionBasis: "manual_confirmation", attributionAt: iso() });
  expect(manual.evidence.start.utc).toBeNull();
  tick();
  await replace([
    { ...manual.change, version: 2, manualConfirmedAt: saved?.attributionAt as string },
  ]);
  expect((await progress()).data.acceptedTrips).toBe(1);
});
test("replay no-op, conflicting version rejection, stale no regression, revoke and exact correction replace one canonical contribution", async () => {
  await publish();
  tick();
  const f = await fixture({ distance: "123.5" });
  await replace([f.change]);
  const first = await progress();
  tick();
  await replace([f.change]);
  expect((await progress()).data.projectionVersion).toBe(first.data.projectionVersion);
  await expect(replace([{ ...f.change, aliasOf: newId() }])).rejects.toMatchObject({
    statusCode: 404,
  });
  await correction(f, 3, "accepted", "99.25");
  const current = await progress();
  expect(current.data).toMatchObject({ acceptedTrips: 1, actualDistanceM: "99.25" });
  const [trip] = await unit.run((tx) =>
    unit.client(tx).select().from(trips).where(eq(trips.id, f.tripId)),
  );
  await replace([
    {
      ...f.change,
      expectedTripVersion: trip?.version as number,
      factId: trip?.currentFactId as string,
      version: 2,
    },
  ]);
  expect((await progress()).data.projectionVersion).toBe(current.data.projectionVersion);
  await expect(
    replace([
      {
        ...f.change,
        expectedTripVersion: trip?.version as number,
        factId: trip?.currentFactId as string,
        version: 3,
        manualConfirmedAt: iso(),
        aliasOf: f.tripId,
      },
    ]),
  ).rejects.toMatchObject({ statusCode: 409 });
  await correction(f, 4, "rejected");
  expect((await progress()).data).toMatchObject({ acceptedTrips: 0, actualDistanceM: "0" });
});
test("batch merge removes alias credit and unmerge restores it without duplicating progress", async () => {
  await publish();
  tick();
  const a = await fixture(),
    b = await fixture();
  await replace([a.change, b.change]);
  expect((await progress()).data.acceptedTrips).toBe(2);
  await replace([
    { ...a.change, version: 2 },
    { ...b.change, version: 2, aliasOf: a.tripId },
  ]);
  expect((await progress()).data.acceptedTrips).toBe(1);
  await replace([{ ...b.change, version: 3, aliasOf: null }]);
  expect((await progress()).data.acceptedTrips).toBe(2);
  const foreign = await fixture({ ownerId: observer.userId });
  await expect(
    replace([{ ...b.change, version: 4, aliasOf: foreign.tripId }]),
  ).rejects.toMatchObject({ statusCode: 409 });
});
test("correction invalidates recorded promotion proof, emits one durable alert per transition and never demotes or leaks private flags", async () => {
  await publish();
  tick();
  const f = await fixture();
  await replace([f.change]);
  tick();
  await promote();
  await correction(f, 2, "accepted", "99");
  const p = await progress();
  expect(p.data).toMatchObject({
    reviewRequired: true,
    reviewReasonCodes: ["promotion_requirements_no_longer_met"],
  });
  expect(p.data.assignment.levelId).toBe(structuralLevels.ets2[1]);
  expect((await identity.current(owner)).data.member.roles).toEqual(["driver"]);
  const publicData = (await service.progress(observer, owner.userId, "ets2", "public")).data;
  expect(publicData).not.toHaveProperty("reviewRequired");
  expect(publicData).not.toHaveProperty("reviewReasonCodes");
  await correction(f, 3, "accepted", "98");
  let [alerts] = await control.query<RowDataPacket[]>(
    "SELECT COUNT(*) n FROM outbox_events WHERE type=CAST('promotion.review_required' AS BINARY)",
  );
  expect(Number(alerts[0]?.n)).toBe(1);
  await correction(f, 4, "accepted", "100");
  expect((await progress()).data).toMatchObject({ reviewRequired: false });
  await correction(f, 5, "rejected");
  [alerts] = await control.query<RowDataPacket[]>(
    "SELECT COUNT(*) n FROM outbox_events WHERE type=CAST('promotion.review_required' AS BINARY)",
  );
  expect(Number(alerts[0]?.n)).toBe(2);
  const [proof] = await unit.run((tx) => unit.client(tx).select().from(qualificationPromotions));
  expect(proof).toMatchObject({
    requiredTrips: 1,
    acceptedTrips: 1,
    actualDistanceM: "100.000000000000000000",
  });
});
test("simultaneous game promotions preserve additive roles and director pointer and cannot skip next level", async () => {
  await unit.run((tx) =>
    unit.client(tx).insert(roles).values({ userId: owner.userId, role: "dispatcher" }),
  );
  await publish();
  await publish("ats");
  tick();
  const a = await fixture(),
    b = await fixture({ game: "ats" });
  await replace([a.change, b.change]);
  tick();
  await Promise.all([promote("ets2"), promote("ats")]);
  expect((await identity.current(owner)).data.member.roles).toEqual(["dispatcher", "driver"]);
  const p = await progress();
  await expect(
    service.promote(director, owner.userId, newId(), p.version, {
      game: "ets2",
      assignmentId: p.data.assignment.id,
      targetLevelId: structuralLevels.ets2[3],
      reason: "Fictional skip",
    }),
  ).rejects.toMatchObject({ statusCode: 409 });
  tick();
  await service.assign(director, director.userId, newId(), 1, {
    game: "ets2",
    levelId: structuralLevels.ets2[0],
    purpose: "initial",
    reason: "Fictional director qualification",
  });
  const d = await fixture({ ownerId: director.userId });
  await replace([d.change]);
  tick();
  await promote("ets2", director);
  expect((await identity.current(director)).data.member.roles).toContain("director");
});
test("deputy confirms promotion with administrative parity; dispatcher/ordinary and stale actors are denied", async () => {
  await publish();
  tick();
  const f = await fixture();
  await replace([f.change]);
  tick();
  await promote("ets2", owner, deputy);
  await expect(service.progress(deputy, deputy.userId, "ets2", "owner")).rejects.toMatchObject({
    statusCode: 403,
  });
  await expect(service.history(observer, owner.userId, "ets2", {}, true)).rejects.toMatchObject({
    statusCode: 403,
  });
  await unit.run((tx) => unit.client(tx).delete(roles).where(eq(roles.userId, deputy.userId)));
  await expect(
    service.rename(deputy, structuralLevels.ets2[0], newId(), 2, { name: "Fictional" }),
  ).rejects.toMatchObject({ statusCode: 403 });
  await unit.run((tx) =>
    unit
      .client(tx)
      .update(membership)
      .set({ accessEpoch: owner.accessEpoch + 1 })
      .where(eq(membership.userId, owner.userId)),
  );
  await expect(service.progress(owner, owner.userId, "ets2", "owner")).rejects.toMatchObject({
    statusCode: 401,
  });
});
test("concurrent identical and conflicting command keys serialize and stale ETags fail", async () => {
  const key = newId(),
    input = { name: "Fictional trainee" };
  const identical = await Promise.all([
    service.rename(director, structuralLevels.ets2[0], key, 1, input),
    service.rename(director, structuralLevels.ets2[0], key, 1, input),
  ]);
  expect(identical[0]).toEqual(identical[1]);
  await expect(
    service.rename(director, structuralLevels.ets2[0], key, 1, { name: "Other" }),
  ).rejects.toMatchObject({ statusCode: 409, publicCode: "IDEMPOTENCY_CONFLICT" });
  await expect(
    service.rename(director, structuralLevels.ets2[0], newId(), 1, input),
  ).rejects.toMatchObject({ statusCode: 409, publicCode: "VERSION_CONFLICT" });
  const selected = (await service.levels(director, "ets2")).items[0];
  const rules = { rules: [], requiredTrips: 1, requiredDistanceM: "100", reason: "Fictional" };
  const results = await Promise.allSettled([
    service.publish(director, selected?.id as string, newId(), 2, rules),
    service.publish(director, selected?.id as string, newId(), 2, rules),
  ]);
  expect(results.filter((v) => v.status === "fulfilled")).toHaveLength(1);
});
test("departure closes periods, return has no automatic assignment, and historical gap resolution cannot overlap or rewrite accepted attribution", async () => {
  await publish();
  tick();
  const before = iso();
  const memberBefore = await identity.current(owner);
  await identity.administer(director, owner.userId, newId(), memberBefore.version, {
    kind: "deactivate",
  });
  const [closed] = await unit.run((tx) =>
    unit
      .client(tx)
      .select()
      .from(qualificationAssignments)
      .where(eq(qualificationAssignments.userId, owner.userId)),
  );
  expect(closed?.endedAt).toBe(before);
  const [m] = await unit.run((tx) =>
    unit.client(tx).select().from(membership).where(eq(membership.userId, owner.userId)),
  );
  tick();
  await identity.administer(director, owner.userId, newId(), m?.version as number, {
    kind: "reinstate",
    roles: ["driver"],
  });
  await expect(progress()).rejects.toMatchObject({ publicCode: "SETUP_REQUIRED" });
  let history = await service.history(director, owner.userId, "ets2", {}, true);
  await service.assign(director, owner.userId, newId(), history.version, {
    game: "ets2",
    levelId: structuralLevels.ets2[1],
    purpose: "reinstatement",
    reason: "Fictional return",
  });
  tick();
  history = await service.history(director, owner.userId, "ets2", {}, true);
  await expect(
    service.assign(director, owner.userId, newId(), history.version, {
      game: "ets2",
      levelId: structuralLevels.ets2[0],
      purpose: "historical_resolution",
      reason: "Fictional overlap",
      assignedAt: "2026-10-20T12:00:00.000Z",
      endedAt: iso(),
    }),
  ).rejects.toMatchObject({ statusCode: 409 });
});
test("publication rejects retroactive, duplicate effective time, invalid decimals and unregistered or wrong catalog rules", async () => {
  await publish();
  tick();
  await expect(
    publish("ets2", 0, 1, "1", { effectiveAt: "2026-10-20T12:00:00.000Z" }),
  ).rejects.toMatchObject({ statusCode: 422 });
  await expect(publish("ets2", 0, 1, "0.0000000000000000001")).rejects.toMatchObject({
    statusCode: 422,
  });
  const input = {
    rules: [{ type: "allowed_trailer_types" as const, entityIds: [newId()] }],
    requiredTrips: 1,
    requiredDistanceM: "1",
    reason: "Fictional",
  };
  await expect(
    service.publish(director, structuralLevels.ets2[0], newId(), 2, input),
  ).rejects.toMatchObject({ statusCode: 422 });
  const future = new Date(instant + 10000).toISOString();
  await publish("ets2", 0, 1, "2", { effectiveAt: future });
  await expect(publish("ets2", 0, 1, "2", { effectiveAt: future })).rejects.toMatchObject({
    statusCode: 409,
  });
});
test("zero actual distance is uncredited under existing positive supported company-acceptance contract; planned distance never substitutes", async () => {
  await publish();
  tick();
  const f = await fixture({ distance: "0" });
  await replace([f.change]);
  expect((await progress()).data).toMatchObject({
    acceptedTrips: 0,
    actualDistanceM: "0",
    eligibleForConfirmation: false,
  });
});
test("promotion versus revocation serializes: correction-first denies, promotion-first retains qualification and flags proof", async () => {
  await publish();
  tick();
  const f = await fixture();
  await replace([f.change]);
  tick();
  const outcomes = await Promise.allSettled([promote(), correction(f, 2, "rejected")]);
  expect(outcomes[1]?.status).toBe("fulfilled");
  const p = await progress();
  if (outcomes[0]?.status === "fulfilled")
    expect(p.data).toMatchObject({
      assignment: { levelId: structuralLevels.ets2[1] },
      reviewRequired: true,
    });
  else
    expect(p.data).toMatchObject({
      assignment: { levelId: structuralLevels.ets2[0] },
      eligibleForConfirmation: false,
    });
});
test("promotion waits on current member lock and rechecks current contributions rather than an old RR snapshot", async () => {
  await publish();
  tick();
  const f = await fixture();
  await replace([f.change]);
  tick();
  const held = deferred<void>(),
    release = deferred<void>();
  const revoke = identity.transaction(async (tx) => {
    await identity.qualificationContextInTransaction(tx, [owner.userId]);
    held.resolve();
    await release.promise;
    await unit.client(tx).update(trips).set({ decision: "rejected" }).where(eq(trips.id, f.tripId));
    await service.replaceContributionsInTransaction(tx, [{ ...f.change, version: 2 }]);
  });
  await held.promise;
  const candidate = promote();
  release.resolve();
  await revoke;
  await expect(candidate).rejects.toMatchObject({ statusCode: 409 });
});
test("failed safe event append rolls back configuration and promotion assignment/role/proof together", async () => {
  await publish();
  tick();
  const f = await fixture();
  await replace([f.change]);
  tick();
  const real = createOutbox(unit),
    failing = createQualifications(
      unit,
      config,
      {
        identity,
        trips: tripService,
        events: {
          append: async (tx, input) => {
            await real.append(tx, input);
            if (input.type === "qualification.promoted")
              throw new Error("SYNTHETIC_AFTER_PROMOTION");
          },
        },
      },
      now,
    );
  const p = await progress();
  await expect(
    failing.promote(director, owner.userId, newId(), p.version, {
      game: "ets2",
      assignmentId: p.data.assignment.id,
      targetLevelId: structuralLevels.ets2[1],
      reason: "Fictional rollback",
    }),
  ).rejects.toThrow("SYNTHETIC_AFTER_PROMOTION");
  expect((await progress()).data.assignment.id).toBe(p.data.assignment.id);
  expect((await identity.current(owner)).data.member.roles).toEqual(["trainee"]);
  const [proofs] = await unit.run((tx) =>
    unit.client(tx).select({ id: qualificationPromotions.id }).from(qualificationPromotions),
  );
  expect(proofs).toBeUndefined();
});
test("HTTP routes enforce CSRF, strict inputs, ETags, scoped cursors, private DTOs and leave adjudication endpoint unmounted", async () => {
  const app = await createApp({
    identity,
    qualifications: service,
    checkReadiness: async () => true,
  });
  try {
    const url = `/api/v1/admin/qualification-levels/${structuralLevels.ets2[0]}`;
    expect(
      (
        await app.inject({
          method: "PATCH",
          url,
          headers: { cookie: directorCookie },
          payload: { name: "Fictional" },
        })
      ).statusCode,
    ).toBe(403);
    const csrf = (
      await app.inject({ url: "/api/v1/auth/csrf", headers: { cookie: directorCookie } })
    ).json().data.token as string;
    const headers = {
      cookie: directorCookie,
      origin,
      "x-csrf-token": csrf,
      "idempotency-key": newId(),
      "if-match": '"v1"',
    };
    expect(
      (
        await app.inject({
          method: "PATCH",
          url,
          headers,
          payload: { name: "Fictional", secret: "unaccepted" },
        })
      ).statusCode,
    ).toBe(422);
    const ok = await app.inject({ method: "PATCH", url, headers, payload: { name: "Fictional" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers.etag).toBe('"v2"');
    const page = await app.inject({
      url: "/api/v1/qualification-levels?game=ets2&limit=1",
      headers: { cookie: ownerCookie },
    });
    expect(page.statusCode).toBe(200);
    const cursor = page.json().data.nextCursor as string;
    expect(
      (
        await app.inject({
          url: `/api/v1/qualification-levels?game=ats&cursor=${cursor}`,
          headers: { cookie: ownerCookie },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          url: `/api/v1/members/${owner.userId}/qualification-progress?game=ets2`,
          headers: { cookie: ownerCookie },
        })
      ).json().data,
    ).not.toHaveProperty("reviewRequired");
    expect(
      (
        await app.inject({
          url: "/api/v1/me/qualification-progress?game=ets2",
          headers: { cookie: ownerCookie },
        })
      ).json().data,
    ).toHaveProperty("reviewRequired", false);
    expect(
      (
        await app.inject({
          url: `/api/v1/trips/${newId()}/qualification-assignments`,
          headers: { cookie: ownerCookie },
        })
      ).statusCode,
    ).toBe(404);
  } finally {
    await app.close();
  }
});

test("supported gap resolution inserts history without mutating the old unresolved snapshot", async () => {
  const uninitialized = await member(["trainee"], false);
  await publish();
  const begin = iso();
  tick(2000);
  const f = await fixture({
    ownerId: uninitialized.actor.userId,
    start: "2026-10-20T12:00:00.500Z",
  });
  await replace([f.change]);
  let [credit] = await unit.run((tx) =>
    unit.client(tx).select().from(tripContributions).where(eq(tripContributions.tripId, f.tripId)),
  );
  expect(credit?.credited).toBe(false);
  expect(credit?.assignmentId).toBeNull();
  const h = await service.history(director, uninitialized.actor.userId, "ets2", {}, true);
  await service.assign(director, uninitialized.actor.userId, newId(), h.version, {
    game: "ets2",
    levelId: structuralLevels.ets2[0],
    purpose: "historical_resolution",
    assignedAt: begin,
    endedAt: "2026-10-20T12:00:01.000Z",
    reason: "Fictional supported interval",
  });
  [credit] = await unit.run((tx) =>
    unit.client(tx).select().from(tripContributions).where(eq(tripContributions.tripId, f.tripId)),
  );
  expect(credit?.assignmentId).toBeNull();
  await replace([{ ...f.change, version: 2 }]);
  [credit] = await unit.run((tx) =>
    unit.client(tx).select().from(tripContributions).where(eq(tripContributions.tripId, f.tripId)),
  );
  expect(credit?.credited).toBe(true);
  await expect(
    service.progress(director, uninitialized.actor.userId, "ets2", "admin"),
  ).rejects.toMatchObject({ publicCode: "SETUP_REQUIRED" });
});
test("reviewed attribution correction updates old and new periods and rechecks old promotion proof", async () => {
  await publish();
  await publish("ets2", 1);
  tick();
  const f = await fixture();
  await replace([f.change]);
  tick();
  await promote();
  const nextStart = iso();
  tick();
  await correction(f, 2, "accepted", "100", nextStart);
  expect((await progress()).data).toMatchObject({
    acceptedTrips: 1,
    actualDistanceM: "100",
    reviewRequired: true,
  });
  const [proof] = await unit.run((tx) => unit.client(tx).select().from(qualificationPromotions));
  expect(
    await unit.run((tx) =>
      tripService.contributions.totals(tx, proof?.sourceAssignmentId as string),
    ),
  ).toMatchObject({ completedTrips: 0, completedDistanceM: "0" });
});
test("concurrent same-game confirmations produce exactly one immutable promotion and identical key replay", async () => {
  await publish();
  tick();
  const f = await fixture();
  await replace([f.change]);
  tick();
  const p = await progress(),
    key = newId();
  const input = {
    game: "ets2" as const,
    assignmentId: p.data.assignment.id,
    targetLevelId: structuralLevels.ets2[1],
    reason: "Fictional simultaneous confirmation",
  };
  const results = await Promise.all([
    service.promote(director, owner.userId, key, p.version, input),
    service.promote(director, owner.userId, key, p.version, input),
  ]);
  expect(results[0]).toEqual(results[1]);
  const proofs = await unit.run((tx) => unit.client(tx).select().from(qualificationPromotions));
  expect(proofs).toHaveLength(1);
  await expect(
    service.promote(director, owner.userId, newId(), p.version, input),
  ).rejects.toMatchObject({ publicCode: "VERSION_CONFLICT" });
});

test("database revision constraints and configured storage precision fail without partial changes", async () => {
  const p = await progress();
  await expect(
    unit.run((tx) =>
      unit
        .client(tx)
        .update(qualificationStates)
        .set({ version: 0 })
        .where(eq(qualificationStates.userId, owner.userId)),
    ),
  ).rejects.toBeDefined();
  expect((await progress()).version).toBe(p.version);
  const input = {
    rules: [],
    requiredTrips: 2147483648,
    requiredDistanceM: "1",
    reason: "Fictional storage bound",
  };
  await expect(
    service.publish(director, structuralLevels.ets2[0], newId(), 1, input),
  ).rejects.toMatchObject({ statusCode: 422 });
  await expect(publish("ets2", 0, 1, "100000000000000000000")).rejects.toMatchObject({
    statusCode: 422,
  });
  await publish("ets2", 0, 0, "0");
  expect((await progress()).data.eligibleForConfirmation).toBe(true);
  await promote();
  expect((await progress()).data.assignment.levelId).toBe(structuralLevels.ets2[1]);
});
test("representative history and rule-effective lookups use their scoped ordered indexes", async () => {
  const start = Date.parse("2026-01-01T00:00:00.000Z");
  await unit.run((tx) =>
    unit
      .client(tx)
      .insert(qualificationAssignments)
      .values(
        Array.from({ length: 600 }, (_, i) => ({
          id: newId(),
          userId: owner.userId,
          game: "ets2" as const,
          levelId: structuralLevels.ets2[0],
          assignedAt: new Date(start + i * 2).toISOString(),
          endedAt: new Date(start + i * 2 + 1).toISOString(),
          purpose: "historical_resolution" as const,
          actorId: director.userId,
          reason: "Fictional index fixture",
        })),
      ),
  );
  await unit.run((tx) =>
    unit
      .client(tx)
      .insert(qualificationRules)
      .values(
        Array.from({ length: 100 }, (_, i) => ({
          id: newId(),
          levelId: structuralLevels.ets2[0],
          publishedAt: iso(),
          effectiveAt: new Date(instant + i).toISOString(),
          rules: [],
          requiredTrips: null,
          requiredDistanceM: null,
          actorId: director.userId,
          reason: "Fictional effective index fixture",
        })),
      ),
  );
  await control.query("ANALYZE TABLE qualification_assignments,qualification_rule_versions");
  const [history] = await control.execute<RowDataPacket[]>(
    "EXPLAIN SELECT id FROM qualification_assignments WHERE user_id=? AND game='ets2' ORDER BY assigned_at DESC,id DESC LIMIT 25",
    [owner.userId],
  );
  const [rules] = await control.execute<RowDataPacket[]>(
    "EXPLAIN SELECT id FROM qualification_rule_versions WHERE level_id=? AND effective_at<='2026-10-20 12:00:00.050' ORDER BY effective_at DESC LIMIT 1",
    [structuralLevels.ets2[0]],
  );
  expect(history[0]?.key).toBe("qualification_assignment_history");
  expect(rules[0]?.key).toBe("qualification_rule_effective");
  const page = await service.history(director, owner.userId, "ets2", { limit: 25 }, true);
  expect(page.data.items).toHaveLength(25);
  expect(page.data.nextCursor).not.toBeNull();
  const next = await service.history(
    director,
    owner.userId,
    "ets2",
    { limit: 25, cursor: page.data.nextCursor as string },
    true,
  );
  expect(
    next.data.items.some((row) => page.data.items.some((previous) => row.id === previous.id)),
  ).toBe(false);
});
test("accepted prescribed-load decision seam credits progress without re-running ordinary qualification restrictions", async () => {
  await service.publish(director, structuralLevels.ets2[0], newId(), 1, {
    rules: [{ type: "max_mass", maxKg: "0" }],
    requiredTrips: 1,
    requiredDistanceM: "100",
    reason: "Fictional event exception seam",
  });
  tick();
  const f = await fixture();
  await replace([f.change]);
  expect((await progress()).data).toMatchObject({
    acceptedTrips: 1,
    eligibleForConfirmation: true,
  });
});

test("exact aggregate proof distance can exceed a single source decimal without rounding or overflow", async () => {
  await publish("ets2", 0, 2, "100");
  tick();
  const a = await fixture({ distance: "99999999999999999999" }),
    b = await fixture({ distance: "99999999999999999999" });
  await replace([a.change, b.change]);
  expect((await progress()).data.actualDistanceM).toBe("199999999999999999998");
  tick();
  await promote();
  const [proof] = await unit.run((tx) => unit.client(tx).select().from(qualificationPromotions));
  expect(proof?.actualDistanceM).toBe("199999999999999999998.000000000000000000");
});

test("internal contribution command refuses arbitrary acceptance flags and duplicate subjects before writes", async () => {
  await publish();
  tick();
  const f = await fixture();
  await expect(
    replace([{ ...f.change, accepted: true } as ContributionChange]),
  ).rejects.toMatchObject({ statusCode: 422 });
  await expect(replace([f.change, f.change])).rejects.toMatchObject({ statusCode: 422 });
  expect((await progress()).data.acceptedTrips).toBe(0);
});
test("configuration audit traces changed level separately from actor and publication failure rolls back all records", async () => {
  const levelId = structuralLevels.ets2[0];
  const [baseline] = await control.execute<RowDataPacket[]>(
    "SELECT COUNT(*) n FROM audit_entries WHERE subject_kind='qualification' AND subject_id=?",
    [levelId],
  );
  const priorCount = Number(baseline[0]?.n);
  await service.rename(director, levelId, newId(), 1, { name: "Fictional renamed trainee" });
  await publish();
  const [audit] = await control.execute<RowDataPacket[]>(
    "SELECT subject_kind subjectKind,CAST(subject_id AS CHAR) subjectId,CAST(actor_id AS CHAR) actorId FROM audit_entries WHERE subject_kind='qualification' AND subject_id=?",
    [levelId],
  );
  expect(audit).toHaveLength(priorCount + 2);
  expect(
    audit.every(
      (row) =>
        row.subjectKind === "qualification" &&
        row.subjectId === levelId &&
        row.actorId === director.userId,
    ),
  ).toBe(true);
  const real = createOutbox(unit),
    failing = createQualifications(
      unit,
      config,
      {
        identity,
        trips: tripService,
        events: {
          append: async (tx, input) => {
            await real.append(tx, input);
            throw new Error("SYNTHETIC_AFTER_RULE_EVENT");
          },
        },
      },
      now,
    );
  tick();
  await expect(
    failing.publish(director, levelId, newId(), 3, {
      rules: [],
      requiredTrips: 1,
      requiredDistanceM: "100",
      reason: "Fictional private configuration rationale",
    }),
  ).rejects.toThrow("SYNTHETIC_AFTER_RULE_EVENT");
  const [after] = await control.execute<RowDataPacket[]>(
    "SELECT COUNT(*) n FROM audit_entries WHERE subject_kind='qualification' AND subject_id=?",
    [levelId],
  );
  expect(Number(after[0]?.n)).toBe(priorCount + 2);
  expect((await service.levels(director, "ets2")).items[0]?.version).toBe(3);
  expect((await service.rules(director, levelId)).items).toHaveLength(1);
});
