import { createHmac, randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { components } from "@vtc/contracts";
import { createUnitOfWork, newId, runMigrations, type UnitOfWork } from "@vtc/db";
import { catalogTrailers } from "@vtc/db/catalogs-schema";
import { eq, membership, roles } from "@vtc/db/identity-schema";
import {
  and,
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
import { createCatalogs } from "../../apps/api/src/modules/catalogs/service.ts";
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
import { createQueue } from "../../apps/api/src/platform/jobs/queue.ts";
import { runPass } from "../../apps/api/src/platform/jobs/runner.ts";
import { createOutbox, identityAccessEvents } from "../../apps/api/src/platform/outbox/events.ts";
import { catalogConfig, seedCatalog } from "../fixtures/catalogs/synthetic.ts";
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
let maximumPublicationWork: Promise<void> | undefined;
let director: Actor,
  owner: Actor,
  deputy: Actor,
  observer: Actor,
  ownerCookie: string,
  deputyCookie: string,
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
  name = "Fictional Qualification Member",
) {
  const id = newId(),
    email = `${id}@example.invalid`,
    credential = await identity.prepareCredential(password);
  await unit.run(async (tx) => {
    await identity.insertWithCredential(tx, {
      userId: id,
      email,
      name,
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
  service = createQualifications(unit, config, { identity, trips: tripService }, now);
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
  deputyCookie = b.cookie;
  observer = d.actor;
});
afterAll(async () => {
  // The final large-catalog case must settle before pools close, even after a framework timeout.
  await maximumPublicationWork?.catch(() => undefined);
  await unit?.close();
  await control?.end();
});
async function eligibilityState(userId = owner.userId, game: Game = "ets2") {
  const [row] = await unit.run((tx) =>
    unit
      .client(tx)
      .select()
      .from(qualificationStates)
      .where(and(eq(qualificationStates.userId, userId), eq(qualificationStates.game, game))),
  );
  return row;
}

function tracked(cutoff = iso()) {
  return createQualifications(
    unit,
    { ...config, eligibilityTrackingSince: cutoff },
    { identity, trips: tripService },
    now,
  );
}

function ready() {
  return identity.transaction(async (tx) => {
    await identity.qualificationContextInTransaction(tx, [], director);
    return service.workspacePromotionsReadyInTransaction(tx, iso());
  });
}

async function ownerCandidate(game: Game = "ets2") {
  const result = await service.promotionCandidates(director, { game, status: "all" });
  return result.items.find((row) => row.member.id === owner.userId);
}

test("candidates use active current per-game assignments, canonical thresholds, and filter-bound keysets", async () => {
  await publish("ets2", 0, 1, "0.000000000000000001");
  await publish("ats", 0, 1, "100");
  tick();
  service = tracked();
  const terminal = await member(["driver"], false);
  await service.assign(director, terminal.actor.userId, newId(), 1, {
    game: "ets2",
    levelId: structuralLevels.ets2[3],
    purpose: "initial",
    reason: "Fictional placement",
  });
  const former = await member();
  await identity.administer(
    director,
    former.actor.userId,
    newId(),
    (await identity.current(former.actor)).version,
    {
      kind: "deactivate",
    },
  );
  tick();
  const first = await fixture({ distance: "0.000000000000000001" });
  const older = iso();
  await replace([first.change]);
  tick();
  const second = await fixture({ ownerId: deputy.userId });
  const ats = await fixture({ game: "ats" });
  await replace([second.change, ats.change]);
  const latest = iso();
  const result = await service.promotionCandidates(director, { game: "ets2", limit: 1 });
  expect(result).toMatchObject({
    total: 2,
    items: [
      {
        member: { id: deputy.userId },
        currentLevel: { id: structuralLevels.ets2[0] },
        nextLevel: { id: structuralLevels.ets2[1] },
        requiredTrips: 1,
        requiredDistanceM: "0.000000000000000001",
        eligible: true,
        eligibleSince: latest,
      },
    ],
  });
  expect(result.nextCursor).not.toBeNull();
  const cursor = result.nextCursor as string;
  expect(
    await service.promotionCandidates(director, { game: "ets2", status: "eligible", cursor }),
  ).toMatchObject({
    total: 2,
    nextCursor: null,
    items: [
      {
        member: { id: owner.userId },
        actualDistanceM: "0.000000000000000001",
        eligibleSince: older,
      },
    ],
  });
  for (const query of [{ game: "ats" as const }, { game: "ets2" as const, status: "all" as const }])
    await expect(service.promotionCandidates(director, { ...query, cursor })).rejects.toMatchObject(
      {
        statusCode: 409,
        publicCode: "VERSION_CONFLICT",
      },
    );
  await expect(service.promotionCandidates(deputy, { game: "ets2", cursor })).rejects.toMatchObject(
    { statusCode: 409 },
  );
  const all = await service.promotionCandidates(director, { game: "ets2", status: "all" });
  expect(all.total).toBe(4);
  expect(all.items.map((row) => row.member.id)).toEqual([
    deputy.userId,
    owner.userId,
    ...[observer.userId, terminal.actor.userId].sort(),
  ]);
  expect(all.items.find((row) => row.member.id === terminal.actor.userId)).toMatchObject({
    eligible: false,
    eligibleSince: null,
    nextLevel: null,
  });
  expect(await ready()).toEqual({ ets2: 2, ats: 1 });
  await expect(service.promotionCandidates(observer, { game: "ets2" })).rejects.toMatchObject({
    statusCode: 403,
  });
});

test("scheduled activation changes the read-only ready list and the next atomic batch retains its date", async () => {
  await publish("ets2", 0, 2, null);
  tick();
  const first = await fixture(),
    replacement = await fixture(),
    legacyA = await fixture({ ownerId: deputy.userId }),
    legacyB = await fixture({ ownerId: deputy.userId });
  await replace([first.change, legacyA.change, legacyB.change]);
  expect(await eligibilityState()).toMatchObject({
    eligibleSince: null,
    eligibilityEvaluatedAt: null,
  });
  tick();
  service = tracked();
  const effectiveAt = new Date(instant + 2000).toISOString();
  await publish("ets2", 0, 1, null, { effectiveAt });
  expect(await ready()).toEqual({ ets2: 1, ats: 0 });
  expect(await ownerCandidate()).toMatchObject({ eligible: false, eligibleSince: null });
  tick(2000);
  expect(await ready()).toEqual({ ets2: 2, ats: 0 });
  const page = await service.promotionCandidates(director, { game: "ets2", limit: 1 });
  expect(page).toMatchObject({
    total: 2,
    items: [{ member: { id: owner.userId }, eligibleSince: effectiveAt }],
  });
  expect(page.nextCursor).not.toBeNull();
  expect(
    await service.promotionCandidates(director, {
      game: "ets2",
      limit: 1,
      cursor: page.nextCursor as string,
    }),
  ).toMatchObject({
    total: 2,
    nextCursor: null,
    items: [{ member: { id: deputy.userId }, eligibleSince: null }],
  });
  expect(await eligibilityState()).toMatchObject({
    eligibleSince: null,
    eligibilityEvaluatedAt: null,
  });
  tick();
  const changes = [{ ...first.change, version: 2 }, replacement.change];
  async function batch(rollback = false) {
    return identity.transaction(async (tx) => {
      await service.prepareInTransaction(tx, [{ ownerId: owner.userId, game: "ets2" }]);
      await unit
        .client(tx)
        .update(trips)
        .set({ decision: "rejected" })
        .where(eq(trips.id, first.tripId));
      await service.replaceContributionsInTransaction(tx, changes);
      if (rollback) throw new Error("SYNTHETIC_ELIGIBILITY_ROLLBACK");
    });
  }
  await expect(batch(true)).rejects.toThrow("SYNTHETIC_ELIGIBILITY_ROLLBACK");
  expect(await eligibilityState()).toMatchObject({
    eligibleSince: null,
    eligibilityEvaluatedAt: null,
  });
  expect(await ownerCandidate()).toMatchObject({ acceptedTrips: 1, eligibleSince: effectiveAt });
  await batch();
  const evaluatedAt = iso();
  expect(await eligibilityState()).toMatchObject({
    eligibleSince: effectiveAt,
    eligibilityEvaluatedAt: evaluatedAt,
  });
  tick();
  await replace(changes);
  expect(await eligibilityState()).toMatchObject({
    eligibleSince: effectiveAt,
    eligibilityEvaluatedAt: evaluatedAt,
  });
  expect(await ownerCandidate()).toMatchObject({ acceptedTrips: 1, eligibleSince: effectiveAt });
});

test("immediate rule and lifecycle changes reset or establish onset even in the same millisecond", async () => {
  await publish("ets2", 0, 1, null);
  await publish("ets2", 1, null, null);
  tick();
  const cutoff = iso();
  service = tracked(cutoff);
  const f = await fixture();
  await replace([f.change]);
  expect(await ownerCandidate()).toMatchObject({ eligible: true, eligibleSince: iso() });
  await publish("ets2", 0, 2, null);
  expect(await eligibilityState()).toMatchObject({
    eligibleSince: null,
    eligibilityEvaluatedAt: iso(),
  });
  tick(1);
  await publish("ets2", 0, 1, null);
  const earned = iso();
  expect(await ownerCandidate()).toMatchObject({ eligible: true, eligibleSince: earned });
  const lifecycle = createQualificationInitialization(unit, undefined, cutoff);
  tick(1);
  await unit.run(async (tx) => {
    await identity.qualificationContextInTransaction(tx, [owner.userId]);
    await lifecycle.close(tx, owner.userId, iso());
    expect(await service.workspacePromotionsReadyInTransaction(tx, iso())).toEqual({
      ets2: 0,
      ats: 0,
    });
    await lifecycle.reinstate(
      tx,
      director,
      owner.userId,
      [
        {
          game: "ets2",
          levelId: structuralLevels.ets2[1],
          purpose: "reinstatement",
          reason: "Fictional return",
        },
      ],
      iso(),
    );
  });
  expect(await eligibilityState()).toMatchObject({
    eligibleSince: null,
    eligibilityEvaluatedAt: null,
  });
  expect(await ownerCandidate()).toMatchObject({
    eligible: true,
    eligibleSince: iso(),
    acceptedTrips: 0,
  });
});

test("default-off writers preserve the old checkpoint and a fresh cutoff makes prior onset unknown", async () => {
  await publish("ets2", 0, 1, null);
  tick();
  service = tracked();
  const f = await fixture();
  await replace([f.change]);
  const old = iso();
  expect(await eligibilityState()).toMatchObject({
    eligibleSince: old,
    eligibilityEvaluatedAt: old,
  });
  tick();
  service = createQualifications(unit, config, { identity, trips: tripService }, now);
  await correction(f, 2, "rejected");
  expect(await ownerCandidate()).toMatchObject({ eligible: false, eligibleSince: null });
  tick();
  await correction(f, 3, "accepted");
  expect(await ownerCandidate()).toMatchObject({
    eligible: true,
    eligibleSince: null,
    acceptedTrips: 1,
  });
  expect(await eligibilityState()).toMatchObject({
    eligibleSince: old,
    eligibilityEvaluatedAt: old,
  });
  tick();
  service = tracked();
  expect(await ownerCandidate()).toMatchObject({ eligible: true, eligibleSince: null });
  const second = await fixture();
  await replace([second.change]);
  expect(await ownerCandidate()).toMatchObject({
    eligible: true,
    eligibleSince: null,
    acceptedTrips: 2,
  });
  await correction(f, 4, "rejected");
  tick();
  await correction(second, 2, "rejected");
  expect(await ownerCandidate()).toMatchObject({ eligible: false, eligibleSince: null });
  tick();
  await correction(second, 3, "accepted");
  expect(await ownerCandidate()).toMatchObject({ eligible: true, eligibleSince: iso() });
});

test("stage 3 member search and action history opt in to exact private representations", async () => {
  const named = await member(["trainee"], true, "Fictional %_ Pilot");
  const former = await member(["trainee"], true, "Fictional %_ Former Pilot");
  const other = await member(["trainee"], true, "Fictional ab Pilot");
  await identity.administer(
    director,
    former.actor.userId,
    newId(),
    (await identity.current(former.actor)).version,
    {
      kind: "deactivate",
    },
  );
  await publish("ets2", 0, null, null);
  tick();
  const promoted = await promote("ets2", named.actor);
  const promotedId = (promoted.data as components["schemas"]["Assignment"]).id;
  const app = await createApp({
    identity,
    qualifications: service,
    checkReadiness: async () => true,
  });
  const searchUrl = "/api/v1/admin/qualification-members";
  const actionUrl = `/api/v1/admin/members/${named.actor.userId}/qualification-action-history?game=ets2`;
  const get = (url: string, cookie = directorCookie) => app.inject({ url, headers: { cookie } });
  try {
    expect((await get(`${searchUrl}?search=Fictional`)).statusCode).toBe(422);
    expect((await get(`${searchUrl}?view=stage3&search=%20%20`)).statusCode).toBe(422);
    expect((await get(`${searchUrl}?view=stage3&search=Fictional`, ownerCookie)).statusCode).toBe(
      403,
    );
    expect(
      (await get(`${searchUrl}?view=stage3&search=Missing-Synthetic-Nickname`)).json().data,
    ).toEqual({ items: [], nextCursor: null });
    const first = await get(`${searchUrl}?view=stage3&limit=1&search=%20%25_%20`);
    expect(first.statusCode).toBe(200);
    expect(first.headers["cache-control"]).toBe("no-store");
    const { items, nextCursor } = first.json().data;
    expect(items).toHaveLength(1);
    expect(nextCursor).not.toBeNull();
    const next = await get(`${searchUrl}?view=stage3&limit=1&search=%25_&cursor=${nextCursor}`);
    expect(next.statusCode).toBe(200);
    expect(next.json().data.nextCursor).toBeNull();
    const matched = [...items, ...next.json().data.items];
    expect(matched.map((row) => row.id)).toEqual([named.actor.userId, former.actor.userId].sort());
    expect(matched.find((row) => row.id === former.actor.userId)).toMatchObject({
      formerMember: true,
    });
    expect(matched.map((row) => row.id)).not.toContain(other.actor.userId);
    for (const query of ["view=stage3&search=pilot", "limit=1"])
      expect((await get(`${searchUrl}?${query}&cursor=${nextCursor}`)).statusCode).toBe(409);
    const folded = await get(`${searchUrl}?view=stage3&limit=1&search=%20fICTIonal%20`);
    expect(folded.statusCode).toBe(200);
    const foldedCursor = folded.json().data.nextCursor;
    expect(foldedCursor).not.toBeNull();
    expect(
      (await get(`${searchUrl}?view=stage3&search=fICTIonal&cursor=${foldedCursor}`)).statusCode,
    ).toBe(200);
    const legacy = await get(actionUrl);
    const staged = await get(`${actionUrl}&view=stage3&limit=1`);
    expect(staged.statusCode).toBe(200);
    expect(staged.headers.etag).toBe(legacy.headers.etag);
    expect(staged.headers["cache-control"]).toBe("no-store");
    const legacyAction = legacy.json().data.items[0];
    expect(legacyAction).not.toHaveProperty("assignmentReason");
    expect(Object.keys(legacyAction.promotion).sort()).toEqual(["confirmedAt", "id"]);
    expect(staged.json().data.items[0]).toMatchObject({
      id: promotedId,
      assignmentReason: "Fictional promotion confirmation",
      promotion: {
        id: legacyAction.promotion.id,
        actor: { id: director.userId },
        reason: "Fictional promotion confirmation",
      },
    });
    expect((await get(`${actionUrl}&cursor=${staged.json().data.nextCursor}`)).statusCode).toBe(
      409,
    );
    expect((await get(`${actionUrl}&view=stage3`, ownerCookie)).statusCode).toBe(403);
    const empty = await member(["driver"], false);
    const emptyActions = await get(
      `/api/v1/admin/members/${empty.actor.userId}/qualification-action-history?game=ats&view=stage3`,
    );
    expect(emptyActions.statusCode).toBe(200);
    expect(emptyActions.json().data).toEqual({ items: [], nextCursor: null });
  } finally {
    await app.close();
  }
});

test("company history filters first and paginates equal action IDs by kind with exact promotion proofs", async () => {
  await publish("ets2", 0, 1, null);
  tick();
  const a = await fixture({ distance: "99999999999999999999.999999999999999999" });
  const b = await fixture({ distance: "0.000000000000000001" });
  await replace([a.change, b.change]);
  tick();
  const source = await progress();
  const confirmedAt = iso();
  const promoted = await promote();
  const promotedId = (promoted.data as components["schemas"]["Assignment"]).id;
  const [proof] = await unit.run((tx) =>
    unit
      .client(tx)
      .select()
      .from(qualificationPromotions)
      .where(eq(qualificationPromotions.targetAssignmentId, promotedId)),
  );
  if (!proof) throw new Error("SYNTHETIC_PROMOTION_MISSING");
  await unit.run((tx) =>
    unit.client(tx).insert(qualificationAssignments).values({
      id: proof.id,
      userId: owner.userId,
      game: "ets2",
      levelId: structuralLevels.ets2[0],
      assignedAt: confirmedAt,
      endedAt: confirmedAt,
      purpose: "historical_resolution",
      actorId: null,
      reason: "",
    }),
  );

  const app = await createApp({
    identity,
    qualifications: service,
    checkReadiness: async () => true,
  });
  const url = "/api/v1/admin/promotion-history";
  const query = `${url}?game=ets2&memberId=${owner.userId}&limit=1`;
  const get = (target: string, cookie = directorCookie) =>
    app.inject({ url: target, headers: { cookie } });
  try {
    const page = await get(query);
    expect(page.statusCode).toBe(200);
    expect(page.headers["cache-control"]).toBe("no-store");
    expect(page.json().data).toMatchObject({
      total: 3,
      items: [
        {
          kind: "assignment",
          id: proof.id,
          assignmentId: proof.id,
          assignedAt: confirmedAt,
          member: { id: owner.userId },
          actor: null,
          reason: null,
        },
      ],
    });
    const cursor = page.json().data.nextCursor;
    expect(cursor).not.toBeNull();
    const next = await get(`${query}&cursor=${cursor}`);
    expect(next.statusCode).toBe(200);
    expect(next.json().data).toMatchObject({
      total: 3,
      items: [
        {
          kind: "promotion",
          id: proof.id,
          confirmedAt,
          actor: { id: director.userId },
          sourceAssignmentId: source.data.assignment.id,
          sourceLevel: { id: structuralLevels.ets2[0] },
          targetAssignmentId: promotedId,
          targetLevel: { id: structuralLevels.ets2[1] },
          requiredTrips: 1,
          requiredDistanceM: null,
          acceptedTrips: 2,
          actualDistanceM: "100000000000000000000",
          reason: "Fictional promotion confirmation",
        },
      ],
    });
    expect((await get(`${query}&cursor=${next.json().data.nextCursor}`)).json().data).toMatchObject(
      {
        total: 3,
        nextCursor: null,
        items: [{ id: source.data.assignment.id, kind: "assignment" }],
      },
    );
    expect(
      (await get(`${url}?game=ats&memberId=${owner.userId}&cursor=${cursor}`)).statusCode,
    ).toBe(409);
    expect((await get(`${url}?game=ets2&cursor=${cursor}`)).statusCode).toBe(409);
    expect((await get(query, ownerCookie)).statusCode).toBe(403);

    const candidates = await get("/api/v1/admin/promotion-candidates?game=ets2&status=all");
    expect(candidates.statusCode).toBe(200);
    expect(candidates.headers["cache-control"]).toBe("no-store");
    expect(
      candidates
        .json()
        .data.items.find((row: { member: { id: string } }) => row.member.id === owner.userId),
    ).toMatchObject({
      assignmentId: promotedId,
      currentLevel: { id: structuralLevels.ets2[1] },
      eligibleSince: null,
    });
    expect(
      (await get("/api/v1/admin/promotion-candidates?game=ets2&status=all", ownerCookie))
        .statusCode,
    ).toBe(403);
    expect(
      (await get("/api/v1/admin/promotion-candidates?game=ets2&status=pending")).statusCode,
    ).toBe(422);
    expect((await get("/api/v1/admin/promotion-candidates?game=ets2")).json().data).toEqual({
      total: 0,
      items: [],
      nextCursor: null,
    });

    const [audited] = await control.query<RowDataPacket[]>(
      "SELECT operation, subject_kind, details FROM audit_entries WHERE subject_id=?",
      [promotedId],
    );
    expect(audited).toEqual([
      {
        operation: "qualification.promoted",
        subject_kind: "qualification",
        details: {
          before: {
            game: "ets2",
            assignmentId: source.data.assignment.id,
            levelId: structuralLevels.ets2[0],
          },
          after: {
            game: "ets2",
            assignmentId: promotedId,
            levelId: structuralLevels.ets2[1],
          },
        },
      },
    ]);
  } finally {
    await app.close();
  }
});

test("staff action and publisher projections retain exact persisted attribution without changing safe history contracts", async () => {
  const target = await member(["trainee"], false);
  await service.assign(director, target.actor.userId, newId(), 1, {
    game: "ets2",
    levelId: structuralLevels.ets2[0],
    purpose: "initial",
    reason: "Fictional private initial rationale",
  });
  const initial = await service.progress(director, target.actor.userId, "ets2", "admin");
  tick();
  await service.assign(deputy, target.actor.userId, newId(), initial.version, {
    game: "ets2",
    levelId: structuralLevels.ets2[0],
    purpose: "administrative_correction",
    reason: "Fictional private correction rationale",
  });
  const correction = await service.progress(director, target.actor.userId, "ets2", "admin");
  tick();
  await service.assign(director, target.actor.userId, newId(), correction.version, {
    game: "ets2",
    levelId: structuralLevels.ets2[0],
    purpose: "historical_resolution",
    assignedAt: "2020-01-01T00:00:00.000Z",
    endedAt: "2020-01-02T00:00:00.000Z",
    reason: "Fictional private historical rationale",
  });
  await publish();
  await publish("ets2", 1);
  tick();
  const contribution = await fixture({ ownerId: target.actor.userId });
  await replace([contribution.change]);
  await promote("ets2", target.actor, deputy);
  const promoted = await service.progress(director, target.actor.userId, "ets2", "admin");
  const [proof] = await unit.run((tx) =>
    unit
      .client(tx)
      .select()
      .from(qualificationPromotions)
      .where(eq(qualificationPromotions.targetAssignmentId, promoted.data.assignment.id)),
  );
  const deputyLogin = await identity.login(`${deputy.userId}@example.invalid`, password),
    deputyCookie = deputyLogin.cookies.map((v) => v.split(";", 1)[0]).join("; ");
  const app = await createApp({
    identity,
    qualifications: service,
    checkReadiness: async () => true,
  });
  const actionUrl = `/api/v1/admin/members/${target.actor.userId}/qualification-action-history?game=ets2`,
    ruleUrl = `/api/v1/admin/qualification-levels/${structuralLevels.ets2[0]}/rule-versions`;
  const slot = (source: string) =>
    createHmac("sha256", identityConfig.secret).update(source).digest()[0];
  // Keep this scenario's real admission charges separate from existing loopback scenarios.
  const source = Array.from({ length: 254 }, (_, i) => `192.0.2.${i + 1}`).find(
    (value) => slot(value) !== slot("127.0.0.1"),
  );
  if (!source) throw new Error("SYNTHETIC_DISTINCT_RATE_SOURCE_MISSING");
  const read = (url: string, cookie?: string) =>
    app.inject({ url, remoteAddress: source, ...(cookie ? { headers: { cookie } } : {}) });
  try {
    for (const cookie of [directorCookie, deputyCookie]) {
      const response = await read(actionUrl, cookie);
      expect(response.statusCode).toBe(200);
      const rows = response.json().data.items;
      expect(rows).toHaveLength(4);
      expect(rows.find((r: { id: string }) => r.id === promoted.data.assignment.id)).toMatchObject({
        purpose: "promotion",
        actor: { id: deputy.userId, nickname: "Fictional Qualification Member" },
        promotion: { id: proof?.id, confirmedAt: proof?.confirmedAt },
      });
      expect(rows.find((r: { id: string }) => r.id === initial.data.assignment.id)).toMatchObject({
        purpose: "initial",
        actor: { id: director.userId },
        promotion: null,
      });
      expect(
        rows.find((r: { id: string }) => r.id === correction.data.assignment.id),
      ).toMatchObject({
        purpose: "administrative_correction",
        actor: { id: deputy.userId },
        promotion: null,
      });
      expect(
        rows.find((r: { purpose: string }) => r.purpose === "historical_resolution"),
      ).toMatchObject({
        assignedAt: "2020-01-01T00:00:00.000Z",
        endedAt: "2020-01-02T00:00:00.000Z",
        actor: { id: director.userId },
        promotion: null,
      });
      for (const row of rows)
        expect(Object.keys(row).sort()).toEqual([
          "actor",
          "assignedAt",
          "endedAt",
          "game",
          "id",
          "levelId",
          "periodId",
          "promotion",
          "purpose",
        ]);
      expect(response.body).not.toMatch(/private|reason|recordedAt|email|provider|roles/);
      const versions = await read(ruleUrl, cookie);
      expect(versions.statusCode).toBe(200);
      expect(versions.json().data.items[0].publisher).toEqual({
        id: director.userId,
        nickname: "Fictional Qualification Director",
      });
      expect(versions.body).not.toMatch(/reason|email|provider|roles/);
    }
    const legacy = await service.actionHistory(director, owner.userId, "ets2");
    expect(legacy.data.items[0]).toMatchObject({
      purpose: "initial",
      actor: null,
      promotion: null,
    });
    for (const [url, cookie] of [
      [`/api/v1/me/qualification-assignments?game=ets2`, target.cookie],
      [
        `/api/v1/admin/members/${target.actor.userId}/qualification-assignments?game=ets2`,
        directorCookie,
      ],
    ] as const) {
      const response = await read(url, cookie);
      expect(response.statusCode).toBe(200);
      for (const row of response.json().data.items)
        expect(Object.keys(row).sort()).toEqual([
          "assignedAt",
          "endedAt",
          "game",
          "id",
          "levelId",
          "periodId",
        ]);
    }
    const safeRules = await read(
      `/api/v1/qualification-levels/${structuralLevels.ets2[0]}/rule-versions`,
      ownerCookie,
    );
    expect(Object.keys(safeRules.json().data.items[0]).sort()).toEqual([
      "effectiveAt",
      "game",
      "id",
      "levelId",
      "publishedAt",
      "requiredDistanceM",
      "requiredTrips",
      "rules",
    ]);
    const publicProgress = await read(
      `/api/v1/members/${target.actor.userId}/qualification-progress?game=ets2`,
      ownerCookie,
    );
    expect(publicProgress.statusCode).toBe(200);
    expect(publicProgress.body).not.toMatch(/publisher|purpose|actor|promotion/);
    for (const url of [actionUrl, ruleUrl]) {
      expect((await read(url, ownerCookie)).statusCode).toBe(403);
      expect((await read(`${url}${url.includes("?") ? "&" : "?"}limit=invalid`)).statusCode).toBe(
        401,
      );
    }
    await identity.administer(director, deputy.userId, newId(), 1, {
      kind: "roles",
      roles: ["driver"],
    });
    for (const url of [actionUrl, ruleUrl])
      expect((await read(url, deputyCookie)).statusCode).toBe(401);
    if (!proof) throw new Error("SYNTHETIC_PROMOTION_PROOF_MISSING");
    await unit.run((tx) =>
      unit
        .client(tx)
        .insert(qualificationPromotions)
        .values({ ...proof, id: newId(), sourceAssignmentId: initial.data.assignment.id }),
    );
    await expect(service.actionHistory(director, target.actor.userId, "ets2")).rejects.toThrow(
      "AMBIGUOUS_QUALIFICATION_PROMOTION",
    );
    await expect(
      service.actionHistory(director, target.actor.userId, "ets2", { limit: 1 }),
    ).rejects.toThrow("AMBIGUOUS_QUALIFICATION_PROMOTION");
  } finally {
    await app.close();
  }
});

test("staff histories trim lookahead, batch current actor labels and isolate signed cursors by route session game and state", async () => {
  await unit.run((tx) =>
    unit
      .client(tx)
      .insert(qualificationAssignments)
      .values(
        Array.from({ length: 101 }, (_, i) => ({
          id: newId(),
          userId: owner.userId,
          game: "ets2" as const,
          levelId: structuralLevels.ets2[0],
          assignedAt: new Date(Date.UTC(2020, 0, 1) + i * 2).toISOString(),
          endedAt: new Date(Date.UTC(2020, 0, 1) + i * 2 + 1).toISOString(),
          purpose: "historical_resolution" as const,
          actorId: i < 2 ? owner.userId : i % 2 ? director.userId : deputy.userId,
          reason: "Fictional private pagination rationale",
        })),
      ),
  );
  const calls: string[][] = [],
    measured = createQualifications(
      unit,
      config,
      {
        identity: {
          ...identity,
          async memberSummariesInTransaction(tx, ids) {
            calls.push(ids);
            return identity.memberSummariesInTransaction(tx, ids);
          },
        },
        trips: tripService,
      },
      now,
    );
  const first = await measured.actionHistory(director, owner.userId, "ets2", { limit: 100 });
  expect(first.data.items).toHaveLength(100);
  expect(calls).toHaveLength(1);
  expect(calls[0]?.sort()).toEqual([director.userId, deputy.userId].sort());
  const next = await measured.actionHistory(director, owner.userId, "ets2", {
    limit: 100,
    cursor: first.data.nextCursor as string,
  });
  expect(next.data.items).toHaveLength(2);
  expect(next.data.nextCursor).toBeNull();
  expect(calls[1]).toEqual([owner.userId]);
  const missingLabel = createQualifications(
    unit,
    config,
    {
      identity: {
        ...identity,
        async memberSummariesInTransaction() {
          return new Map();
        },
      },
      trips: tripService,
    },
    now,
  );
  expect(
    (await missingLabel.actionHistory(director, owner.userId, "ets2", { limit: 2 })).data.items[1]
      ?.actor,
  ).toMatchObject({ id: expect.any(String), nickname: null });
  for (const run of [
    () =>
      service.actionHistory(deputy, owner.userId, "ets2", {
        cursor: first.data.nextCursor as string,
      }),
    () =>
      service.actionHistory(director, owner.userId, "ats", {
        cursor: first.data.nextCursor as string,
      }),
    () =>
      service.actionHistory(director, deputy.userId, "ets2", {
        cursor: first.data.nextCursor as string,
      }),
    () =>
      service.history(
        director,
        owner.userId,
        "ets2",
        { cursor: first.data.nextCursor as string },
        true,
      ),
    () =>
      service.actionHistory(director, owner.userId, "ets2", {
        cursor: `${first.data.nextCursor}x`,
      }),
  ])
    await expect(run()).rejects.toMatchObject({ statusCode: 409 });
  await expect(
    service.actionHistory(director, owner.userId, "ets2", { limit: 101 }),
  ).rejects.toMatchObject({ statusCode: 422 });
  tick();
  await publish();
  tick();
  await publish();
  const staffRules = await service.rules(
    director,
    structuralLevels.ets2[0],
    { limit: 1 },
    undefined,
    true,
  );
  expect(staffRules.nextCursor).not.toBeNull();
  await expect(
    service.rules(director, structuralLevels.ets2[0], { cursor: staffRules.nextCursor as string }),
  ).rejects.toMatchObject({ statusCode: 409 });
  const login = await identity.login("qualification-director@example.invalid", password),
    another = await identity.authenticate(
      new Headers({ cookie: login.cookies.map((v) => v.split(";", 1)[0]).join("; ") }),
    );
  await expect(
    service.actionHistory(another, owner.userId, "ets2", {
      cursor: first.data.nextCursor as string,
    }),
  ).rejects.toMatchObject({ statusCode: 409 });
  tick();
  await service.assign(director, owner.userId, newId(), first.version, {
    game: "ets2",
    levelId: structuralLevels.ets2[0],
    purpose: "administrative_correction",
    reason: "Fictional new state",
  });
  await expect(
    service.actionHistory(director, owner.userId, "ets2", {
      cursor: first.data.nextCursor as string,
    }),
  ).rejects.toMatchObject({ statusCode: 409 });
  tick();
  await publish();
  await expect(
    service.rules(
      director,
      structuralLevels.ets2[0],
      { cursor: staffRules.nextCursor as string },
      undefined,
      true,
    ),
  ).rejects.toMatchObject({ statusCode: 409 });
});

test("one hundred distinct recorded actors use one facade batch and leave the lookahead actor unenriched", async () => {
  const target = await member(["trainee"], false),
    ids = Array.from({ length: 101 }, () => newId()),
    credential = await identity.prepareCredential(password);
  await unit.run(async (tx) => {
    for (const [i, id] of ids.entries())
      await identity.insertWithCredential(tx, {
        userId: id,
        email: `${id}@example.invalid`,
        name: `Fictional recorded operator ${i}`,
        roles: ["driver"],
        ...credential,
      });
    await unit
      .client(tx)
      .insert(qualificationAssignments)
      .values(
        ids.map((actorId, i) => ({
          id: newId(),
          userId: target.actor.userId,
          game: "ets2" as const,
          levelId: structuralLevels.ets2[0],
          assignedAt: new Date(Date.UTC(2020, 0, 1) + i * 2).toISOString(),
          endedAt: new Date(Date.UTC(2020, 0, 1) + i * 2 + 1).toISOString(),
          purpose: "historical_resolution" as const,
          actorId,
          reason: "Fictional bounded actor fixture",
        })),
      );
  });
  const calls: string[][] = [],
    measured = createQualifications(
      unit,
      config,
      {
        identity: {
          ...identity,
          async memberSummariesInTransaction(tx, actorIds) {
            calls.push(actorIds);
            return identity.memberSummariesInTransaction(tx, actorIds);
          },
        },
        trips: tripService,
      },
      now,
    );
  const result = await measured.actionHistory(director, target.actor.userId, "ets2", {
    limit: 100,
  });
  expect(result.data.items).toHaveLength(100);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toHaveLength(100);
  expect(calls[0]).not.toContain(ids[0]);
  expect(
    result.data.items.every((row) =>
      row.actor?.nickname?.startsWith("Fictional recorded operator "),
    ),
  ).toBe(true);
  const last = await measured.actionHistory(director, target.actor.userId, "ets2", {
    limit: 100,
    cursor: result.data.nextCursor as string,
  });
  expect(last.data.items).toHaveLength(1);
  expect(calls[1]).toEqual([ids[0]]);
});

test("structural levels have no launch defaults; a trips-only rule enables promotion after the required count", async () => {
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
  await expect(promote()).rejects.toMatchObject({ statusCode: 409 });
  await publish("ets2", 0, 1, null);
  expect((await progress()).data).toMatchObject({
    requiredTrips: 1,
    requiredDistanceM: null,
    eligibleForConfirmation: false,
  });
  await expect(promote()).rejects.toMatchObject({ statusCode: 409 });
  tick();
  const f = await fixture();
  await replace([f.change]);
  expect((await progress()).data.eligibleForConfirmation).toBe(true);
  await promote();
  const [proof] = await unit.run((tx) => unit.client(tx).select().from(qualificationPromotions));
  expect(proof).toMatchObject({
    requiredTrips: 1,
    requiredDistanceM: null,
    acceptedTrips: 1,
    actualDistanceM: "100.000000000000000000",
  });
});
test("distance-only progress and notification agree just below and at 20 km; corrections use the nullable proof", async () => {
  await publish("ets2", 0, null, "20000");
  const ruleVersionId = (await service.levels(director, "ets2")).items.find(
    (level) => level.id === structuralLevels.ets2[0],
  )?.ruleVersionId;
  expect(ruleVersionId).toEqual(expect.any(String));
  tick();
  const below = "19999.999999999999999999",
    f = await fixture({ distance: below });
  await replace([f.change]);
  const initial = (await progress()).data;
  const notification = () =>
    unit.run(async (tx) => {
      await identity.qualificationContextInTransaction(tx, [owner.userId]);
      return service.notificationAssignmentInTransaction(tx, initial.assignment.id);
    });
  expect(initial).toMatchObject({
    acceptedTrips: 1,
    actualDistanceM: below,
    requiredTrips: null,
    requiredDistanceM: "20000",
    eligibleForConfirmation: false,
  });
  expect((await notification()).eligible).toBe(false);
  await expect(promote("ets2", owner, deputy)).rejects.toMatchObject({ statusCode: 409 });
  await correction(f, 2, "accepted", "20000");
  expect((await progress()).data).toMatchObject({
    assignment: initial.assignment,
    acceptedTrips: 1,
    actualDistanceM: "20000",
    eligibleForConfirmation: true,
  });
  expect((await notification()).eligible).toBe(true);
  expect((await identity.current(owner)).data.member.roles).toEqual(["trainee"]);
  const result = await promote("ets2", owner, deputy);
  const next = (await progress()).data.assignment;
  expect(result).toMatchObject({ data: { id: next.id, levelId: structuralLevels.ets2[1] } });
  expect((await notification()).eligible).toBe(false);
  const proofs = () => unit.run((tx) => unit.client(tx).select().from(qualificationPromotions));
  const [proof] = await proofs();
  expect(proof).toMatchObject({
    sourceAssignmentId: initial.assignment.id,
    targetAssignmentId: next.id,
    ruleVersionId,
    requiredTrips: null,
    requiredDistanceM: "20000.000000000000000000",
    acceptedTrips: 1,
    actualDistanceM: "20000.000000000000000000",
  });
  tick();
  await publish("ets2", 0, null, null);
  await correction(f, 3, "accepted", below);
  expect((await progress()).data).toMatchObject({
    assignment: { levelId: structuralLevels.ets2[1] },
    reviewRequired: true,
    reviewReasonCodes: ["promotion_requirements_no_longer_met"],
  });
  expect(await proofs()).toEqual([proof]);
  expect((await identity.current(owner)).data.member.roles).toEqual(["driver"]);
});

test("readiness needs eight effective versions; null and explicit zero work until the terminal level", async () => {
  const initialization = createQualificationInitialization(unit),
    ready = () => unit.run((tx) => initialization.administrationReadiness(tx, iso()));
  expect(await ready()).toBe(false);
  const effectiveAt = new Date(instant + 1000).toISOString();
  await publish("ets2", 0, null, null, { effectiveAt });
  await publish("ets2", 1, 0, null);
  await publish("ets2", 2, null, "0");
  await publish("ets2", 3, null, null);
  for (let rank = 0; rank < 4; rank++) await publish("ats", rank, null, null);
  const notification = (assignmentId: string) =>
    unit.run(async (tx) => {
      await identity.qualificationContextInTransaction(tx, [owner.userId]);
      return service.notificationAssignmentInTransaction(tx, assignmentId);
    });
  const trainee = (await progress()).data;
  expect(trainee.eligibleForConfirmation).toBe(false);
  expect((await notification(trainee.assignment.id)).eligible).toBe(false);
  expect(await ready()).toBe(false);
  await expect(promote()).rejects.toMatchObject({ statusCode: 409 });
  tick();
  expect(await ready()).toBe(true);
  expect((await progress()).data).toMatchObject({
    requiredTrips: null,
    requiredDistanceM: null,
    acceptedTrips: 0,
    actualDistanceM: "0",
    eligibleForConfirmation: true,
  });
  expect((await notification(trainee.assignment.id)).eligible).toBe(true);
  await promote();
  tick();
  const driverIII = (await progress()).data;
  expect(driverIII).toMatchObject({
    requiredTrips: 0,
    requiredDistanceM: null,
    eligibleForConfirmation: true,
  });
  await promote();
  tick();
  const driverII = (await progress()).data;
  expect(driverII).toMatchObject({
    requiredTrips: null,
    requiredDistanceM: "0",
    eligibleForConfirmation: true,
  });
  await promote();
  const terminal = await progress();
  expect(terminal.data).toMatchObject({
    assignment: { levelId: structuralLevels.ets2[3] },
    eligibleForConfirmation: false,
  });
  expect((await notification(terminal.data.assignment.id)).eligible).toBe(false);
  await expect(
    service.promote(director, owner.userId, newId(), terminal.version, {
      game: "ets2",
      assignmentId: terminal.data.assignment.id,
      targetLevelId: structuralLevels.ets2[3],
      reason: "Fictional attempted promotion after Driver I",
    }),
  ).rejects.toMatchObject({ statusCode: 409 });
  const proofs = await unit.run((tx) => unit.client(tx).select().from(qualificationPromotions));
  expect(proofs).toHaveLength(3);
  expect(proofs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        sourceAssignmentId: trainee.assignment.id,
        requiredTrips: null,
        requiredDistanceM: null,
      }),
      expect.objectContaining({
        sourceAssignmentId: driverIII.assignment.id,
        requiredTrips: 0,
        requiredDistanceM: null,
      }),
      expect.objectContaining({
        sourceAssignmentId: driverII.assignment.id,
        requiredTrips: null,
        requiredDistanceM: "0.000000000000000000",
      }),
    ]),
  );
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
    qualifications: [
      {
        game: "ets2",
        levelId: structuralLevels.ets2[1],
        purpose: "reinstatement",
        reason: "Fictional return",
      },
    ],
  });
  const returned = await progress();
  expect(returned.data.assignment.levelId).toBe(structuralLevels.ets2[1]);
  let history = await service.history(director, owner.userId, "ets2", {}, true);
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

test("publication HTTP preserves closed inputs, optional reason, staff authority and exact idempotent replay", async () => {
  // Exercise every admission case in a separate synthetic minute from the other HTTP tests.
  tick(60000);
  const app = await createApp({
    identity,
    qualifications: service,
    checkReadiness: async () => true,
  });
  try {
    const headersFor = async (cookie: string, version = 1) => {
      const csrf = await app.inject({ url: "/api/v1/auth/csrf", headers: { cookie } });
      expect(csrf.statusCode).toBe(200);
      return {
        cookie,
        origin,
        "x-csrf-token": csrf.json().data.token as string,
        "idempotency-key": newId(),
        "if-match": `"v${version}"`,
      };
    };
    const levelId = structuralLevels.ets2[0],
      url = `/api/v1/admin/qualification-levels/${levelId}/rule-versions`,
      headers = await headersFor(directorCookie),
      payload = { rules: [], requiredTrips: null, requiredDistanceM: "20000" };
    expect(
      (await app.inject({ method: "POST", url, headers: { cookie: directorCookie }, payload }))
        .statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: "POST", url, headers: await headersFor(ownerCookie), payload }))
        .statusCode,
    ).toBe(403);
    for (const invalid of [
      { ...payload, reason: "" },
      { ...payload, reason: "   " },
      { ...payload, reason: null },
      { ...payload, reason: "x".repeat(2049) },
      { ...payload, sample: {} },
      { rules: [], requiredDistanceM: "20000" },
      { rules: [], requiredTrips: null },
    ])
      expect(
        (await app.inject({ method: "POST", url, headers, payload: invalid })).statusCode,
      ).toBe(422);
    const responses = await Promise.all([
      app.inject({ method: "POST", url, headers, payload }),
      app.inject({ method: "POST", url, headers, payload }),
    ]);
    expect(responses.map((response) => response.statusCode)).toEqual([201, 201]);
    expect(responses.map((response) => response.headers.etag)).toEqual(['"v2"', '"v2"']);
    const first = responses[0].json().data;
    expect(responses[1].json().data).toEqual(first);
    expect(first).toMatchObject({
      configured: true,
      requiredTrips: null,
      requiredDistanceM: "20000",
    });
    const readRules = () =>
      unit.run((tx) =>
        unit
          .client(tx)
          .select()
          .from(qualificationRules)
          .where(eq(qualificationRules.levelId, levelId)),
      );
    expect(await readRules()).toEqual([
      expect.objectContaining({ id: first.ruleVersionId, reason: null }),
    ]);
    expect(
      (
        await app.inject({
          method: "POST",
          url,
          headers,
          payload: { ...payload, reason: "Fictional changed intent" },
        })
      ).json().error.code,
    ).toBe("IDEMPOTENCY_CONFLICT");
    tick();
    const legacy = { ...payload, reason: "Fictional retained explanation" },
      deputyHeaders = await headersFor(deputyCookie, 2),
      published = await app.inject({
        method: "POST",
        url,
        headers: deputyHeaders,
        payload: legacy,
      });
    expect(published.statusCode).toBe(201);
    expect(published.headers.etag).toBe('"v3"');
    const recorded = published.json().data;
    const rules = await readRules();
    expect(rules).toHaveLength(2);
    expect(rules.find((rule) => rule.id === recorded.ruleVersionId)).toMatchObject({
      actorId: deputy.userId,
      reason: legacy.reason,
    });
    expect(recorded).not.toHaveProperty("reason");
    const replay = await app.inject({
      method: "POST",
      url,
      headers: deputyHeaders,
      payload: legacy,
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.headers.etag).toBe('"v3"');
    expect(replay.json().data).toEqual(recorded);
    expect(await readRules()).toHaveLength(2);
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
  const readAudit = () =>
    control.execute<RowDataPacket[]>(
      "SELECT CAST(id AS CHAR) id,CAST(subject_id AS CHAR) subjectId,subject_kind subjectKind,CAST(actor_id AS CHAR) actorId FROM audit_entries WHERE subject_kind='qualification' AND subject_id=?",
      [levelId],
    );
  const [baseline] = await readAudit();
  const priorIds = new Set(baseline.map((row) => row.id)),
    priorCount = baseline.length;
  await service.rename(director, levelId, newId(), 1, { name: "Fictional renamed trainee" });
  await publish();
  const [audit] = await readAudit();
  expect(audit).toHaveLength(priorCount + 2);
  const inserted = audit.filter((row) => !priorIds.has(row.id));
  expect(inserted).toHaveLength(2);
  expect(
    inserted.every(
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

test("promotion uses one confirmation instant and immutable rule when a stricter scheduled rule activates during execution", async () => {
  await publish("ets2", 0, 1, "100");
  const confirmedAt = iso(),
    boundary = instant + 1000;
  await publish("ets2", 0, 10, "1000", { effectiveAt: new Date(boundary).toISOString() });
  const a = await fixture(),
    b = await fixture({ ownerId: deputy.userId });
  await replace([a.change, b.change]);
  const initial = await progress();
  let calls = 0;
  // The former implementation read assignment/rule/computedAt before reselecting a stricter rule.
  const crossing = createQualifications(
    unit,
    config,
    { identity, trips: tripService },
    () => new Date(++calls <= 3 ? instant : boundary),
  );
  const result = await crossing.promote(director, owner.userId, newId(), initial.version, {
    game: "ets2",
    assignmentId: initial.data.assignment.id,
    targetLevelId: structuralLevels.ets2[1],
    reason: "Fictional clock-boundary confirmation",
  });
  expect(calls).toBeGreaterThan(3);
  const [proof] = await unit.run((tx) => unit.client(tx).select().from(qualificationPromotions));
  if (!proof) throw new Error("SYNTHETIC_PROMOTION_PROOF_MISSING");
  expect(proof).toMatchObject({
    requiredTrips: 1,
    requiredDistanceM: "100.000000000000000000",
    acceptedTrips: 1,
    actualDistanceM: "100.000000000000000000",
    confirmedAt,
  });
  expect(result).toMatchObject({ data: { assignedAt: confirmedAt } });
  expect(await service.progress(director, owner.userId, "ets2", "admin")).not.toHaveProperty(
    "rule",
  );
  const [rule] = await unit.run((tx) =>
    unit
      .client(tx)
      .select()
      .from(qualificationRules)
      .where(eq(qualificationRules.id, proof.ruleVersionId)),
  );
  expect(rule?.effectiveAt).toBe(confirmedAt);
  const later = createQualifications(
    unit,
    config,
    { identity, trips: tripService },
    () => new Date(boundary),
  );
  const pending = await progress("ets2", deputy);
  await expect(
    later.promote(director, deputy.userId, newId(), pending.version, {
      game: "ets2",
      assignmentId: pending.data.assignment.id,
      targetLevelId: structuralLevels.ets2[1],
      reason: "Fictional after-boundary confirmation",
    }),
  ).rejects.toMatchObject({ statusCode: 409 });
  expect(
    await unit.run((tx) => unit.client(tx).select().from(qualificationPromotions)),
  ).toHaveLength(1);
});

test("qualification target lookup is bounded, named, private and bound to current staff sessions", async () => {
  const credential = await identity.prepareCredential(password);
  for (let batch = 0; batch < 4; batch++)
    await unit.run(async (tx) => {
      for (let i = 0; i < 26; i++) {
        const n = batch * 26 + i,
          id = `d3100000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
        await identity.insertWithCredential(tx, {
          userId: id,
          email: `lookup-${n}@example.invalid`,
          name: "Fictional Duplicate Name",
          ...credential,
          roles: ["driver", "dispatcher"],
        });
      }
    });
  const former = "d3100000-0000-4000-8000-000000000000";
  await unit.run((tx) =>
    unit
      .client(tx)
      .update(membership)
      .set({ status: "inactive" })
      .where(eq(membership.userId, former)),
  );
  const full = await service.members(director, { limit: 100 });
  expect(full.items).toHaveLength(100);
  expect(full.nextCursor).not.toBeNull();
  const all: typeof full.items = [];
  let cursor: string | undefined;
  do {
    const page = await service.members(director, { limit: 100, ...(cursor ? { cursor } : {}) });
    all.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  expect(new Set(all.map((m) => m.id)).size).toBe(all.length);
  expect(all.map((m) => m.id)).toEqual([...all.map((m) => m.id)].sort());
  expect(all.find((m) => m.id === former)).toMatchObject({
    nickname: "Fictional Duplicate Name",
    formerMember: true,
    roles: ["driver", "dispatcher"],
  });
  expect(all.find((m) => m.id === director.userId)?.roles).toContain("director");
  let selects = 0;
  const measured = createIdentity(
    {
      ...unit,
      client(tx) {
        const database = unit.client(tx);
        return new Proxy(database, {
          get(target, key, receiver) {
            if (key === "select")
              return (...args: unknown[]) => {
                selects++;
                return Reflect.apply(target.select, target, args);
              };
            return Reflect.get(target, key, receiver);
          },
        });
      },
    },
    identityConfig,
    {},
    now,
  );
  const bounded = await unit.run((tx) => measured.qualificationMembersInTransaction(tx, null, 100));
  expect(bounded).toHaveLength(101);
  expect(selects).toBe(3);
  const [plan] = await control.execute<RowDataPacket[]>(
    "EXPLAIN SELECT u.id,u.name,m.status FROM identity_users u INNER JOIN identity_memberships m ON m.user_id=u.id WHERE u.id>? ORDER BY u.id LIMIT 101",
    [former],
  );
  expect(plan.length).toBeGreaterThan(0);
  expect(plan.some((row) => row.key === "PRIMARY")).toBe(true);
  expect(plan.every((row) => !String(row.Extra).includes("Using filesort"))).toBe(true);
  for (const m of all)
    expect(Object.keys(m).sort()).toEqual(["formerMember", "id", "nickname", "roles"]);
  await expect(service.members(owner)).rejects.toMatchObject({ statusCode: 403 });
  await expect(service.members(director, { limit: 101 })).rejects.toMatchObject({
    statusCode: 422,
  });
  await expect(
    service.members(deputy, { cursor: full.nextCursor as string }),
  ).rejects.toMatchObject({ statusCode: 409 });
  await expect(service.members(director, { cursor: `${full.nextCursor}x` })).rejects.toMatchObject({
    statusCode: 409,
  });
  const login = await identity.login("qualification-director@example.invalid", password),
    cookie = login.cookies.map((v) => v.split(";", 1)[0]).join("; "),
    another = await identity.authenticate(new Headers({ cookie }));
  await expect(
    service.members(another, { cursor: full.nextCursor as string }),
  ).rejects.toMatchObject({ statusCode: 409 });
});

test("preview HTTP admits current staff before parsing, enforces closed CSRF facts and writes no domain state", async () => {
  const app = await createApp({
      identity,
      qualifications: service,
      checkReadiness: async () => true,
    }),
    url = "/api/v1/admin/qualification-rule-previews",
    payload = {
      game: "ets2",
      rules: [{ type: "max_mass", maxKg: "10" }],
      sample: {
        cargoMassKg: "10.000000000000000001",
        trailerTypeIds: [],
        trailersComplete: false,
        adr: { status: "unknown", adrClass: null },
      },
    };
  async function snapshot() {
    const counts: Record<string, number> = {};
    for (const table of [
      "qualification_assignments",
      "qualification_rule_versions",
      "qualification_promotions",
      "trip_contributions",
      "audit_entries",
      "outbox_events",
    ]) {
      const [rows] = await control.query<RowDataPacket[]>(`SELECT COUNT(*) n FROM ${table}`);
      counts[table] = Number(rows[0]?.n);
    }
    return counts;
  }
  try {
    const before = await snapshot();
    expect((await app.inject({ method: "POST", url, payload })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url,
          headers: { cookie: ownerCookie, "content-type": "application/json" },
          payload: "{",
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: "POST", url, headers: { cookie: directorCookie }, payload }))
        .statusCode,
    ).toBe(403);
    const csrf = (
      await app.inject({ url: "/api/v1/auth/csrf", headers: { cookie: directorCookie } })
    ).json().data.token;
    const headers = { cookie: directorCookie, origin, "x-csrf-token": csrf };
    for (const extra of ["ownerId", "accepted", "confirmedEvent", "sourcePayload"])
      expect(
        (await app.inject({ method: "POST", url, headers, payload: { ...payload, [extra]: true } }))
          .statusCode,
      ).toBe(422);
    expect(
      (
        await app.inject({
          method: "POST",
          url,
          headers: { ...headers, origin: "https://example.invalid" },
          payload,
        })
      ).statusCode,
    ).toBe(403);
    const result = await app.inject({ method: "POST", url, headers, payload });
    expect(result.statusCode).toBe(200);
    expect(result.json().data).toEqual({
      outcome: "fail",
      ruleResults: [{ ruleType: "max_mass", outcome: "fail", reasonCode: "rule_mass_exceeded" }],
    });
    const ids = Array.from(
      { length: 1000 },
      (_, i) => `d5100000-0000-4000-8000-${i.toString(16).padStart(12, "0")}`,
    );
    const large = {
      ...payload,
      rules: [
        { type: "max_mass", maxKg: "99999999999999999999.999999999999999999" },
        { type: "allowed_trailer_types", entityIds: ids },
        { type: "allowed_adr_categories", classes: ["1", "2", "3", "4", "6", "8"] },
      ],
      sample: {
        cargoMassKg: "99999999999999999999.999999999999999999",
        trailerTypeIds: ids.slice(0, 1),
        trailersComplete: false,
        adr: { status: "known", adrClass: "2" },
      },
    };
    expect(Buffer.byteLength(JSON.stringify(large))).toBeGreaterThan(32768);
    expect(Buffer.byteLength(JSON.stringify(large))).toBeLessThanOrEqual(131072);
    expect((await app.inject({ method: "POST", url, headers, payload: large })).statusCode).toBe(
      200,
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url,
          headers: { ...headers, "content-type": "application/json" },
          payload: " ".repeat(131073),
        })
      ).statusCode,
    ).toBe(413);
    expect(await snapshot()).toEqual(before);
    expect(
      (
        await app.inject({
          url: "/api/v1/admin/qualification-members",
          headers: { cookie: ownerCookie },
        })
      ).statusCode,
    ).toBe(403);
    const members = await app.inject({
      url: "/api/v1/admin/qualification-members?limit=1",
      headers: { cookie: directorCookie },
    });
    expect(members.statusCode).toBe(200);
    expect(members.json().data.items).toHaveLength(1);
    expect(
      (await app.inject({ url: "/api/v1/admin/members", headers: { cookie: directorCookie } }))
        .statusCode,
    ).toBe(404);
    const revoked = await member(["deputy_director"]);
    const revokedCsrf = (
      await app.inject({ url: "/api/v1/auth/csrf", headers: { cookie: revoked.cookie } })
    ).json().data.token;
    await identity.administer(director, revoked.actor.userId, newId(), 1, {
      kind: "roles",
      roles: ["driver"],
    });
    expect(
      (
        await app.inject({
          url: "/api/v1/admin/qualification-members",
          headers: { cookie: revoked.cookie },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url,
          headers: { cookie: revoked.cookie, origin, "x-csrf-token": revokedCsrf },
          payload,
        })
      ).statusCode,
    ).toBe(401);
  } finally {
    await app.close();
  }
});

test("maximum supported publication fits its route bound with real list rows and rejects an oversized body", () => {
  maximumPublicationWork = maximumPublication();
  return maximumPublicationWork;
});
async function maximumPublication() {
  const catalogs = createCatalogs(unit, catalogConfig(), { identity }, now);
  const seeded = await seedCatalog(unit, "ets2", {
    trailers: Array.from({ length: 1000 }, (_, i) => `qualification_trailer_${i}`),
  });
  const trailerIds = [...seeded.ids.values()],
    q = createQualifications(unit, config, { identity, trips: tripService, catalogs }, now),
    app = await createApp({ identity, qualifications: q, checkReadiness: async () => true });
  try {
    const csrf = (
      await app.inject({ url: "/api/v1/auth/csrf", headers: { cookie: directorCookie } })
    ).json().data.token;
    const headers = {
        cookie: directorCookie,
        origin,
        "x-csrf-token": csrf,
        "idempotency-key": newId(),
        "if-match": '"v1"',
      },
      url = `/api/v1/admin/qualification-levels/${structuralLevels.ets2[0]}/rule-versions`,
      maximum = "99999999999999999999.999999999999999999";
    const payload = {
      rules: [
        { type: "max_mass", maxKg: maximum },
        { type: "allowed_trailer_types", entityIds: trailerIds },
        { type: "allowed_adr_categories", classes: ["1", "2", "3", "4", "6", "8"] },
      ],
      requiredTrips: 2147483647,
      requiredDistanceM: maximum,
      reason: "Fictional maximum wire-size fixture".padEnd(2048, "x"),
    };
    expect(Buffer.byteLength(JSON.stringify(payload))).toBeGreaterThan(32768);
    expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThanOrEqual(131072);
    const result = await app.inject({ method: "POST", url, headers, payload });
    expect(result.statusCode).toBe(201);
    expect((await q.rules(director, structuralLevels.ets2[0])).items[0]?.rules).toEqual(
      payload.rules,
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url,
          headers: { ...headers, "content-type": "application/json" },
          payload: " ".repeat(131073),
        })
      ).statusCode,
    ).toBe(413);
    expect((await q.rules(director, structuralLevels.ets2[0])).items).toHaveLength(1);
  } finally {
    await app.close();
  }
}

test("trailer allowlists reject hidden rows on new selections, keep them unchanged and ADR classes stay closed", async () => {
  const catalogs = createCatalogs(unit, catalogConfig(), { identity }, now);
  const rows = await seedCatalog(unit, "ets2", {
    trailers: ["qualification_kept", { code: "qualification_hidden", hidden: true }],
  });
  const q = createQualifications(unit, config, { identity, trips: tripService, catalogs }, now);
  const levelId = structuralLevels.ets2[3] as string;
  const publishRules = async (rules: components["schemas"]["Rule"][]) => {
    const level = (await q.levels(director, "ets2")).items.find((v) => v.id === levelId);
    if (!level) throw new Error("SYNTHETIC_LEVEL_MISSING");
    tick();
    return q.publish(director, levelId, newId(), level.version, {
      rules,
      requiredTrips: 1,
      requiredDistanceM: "1",
      reason: "Fictional allowlist",
    });
  };
  const kept = rows.id("qualification_kept"),
    hidden = rows.id("qualification_hidden");
  await expect(
    publishRules([{ type: "allowed_trailer_types", entityIds: [hidden] }]),
  ).rejects.toMatchObject({ statusCode: 422, publicCode: "CATALOG_SELECTION_HIDDEN" });
  await publishRules([{ type: "allowed_trailer_types", entityIds: [kept] }]);
  await unit.run((tx) =>
    unit
      .client(tx)
      .update(catalogTrailers)
      .set({ hidden: true })
      .where(eq(catalogTrailers.id, kept)),
  );
  await publishRules([{ type: "allowed_trailer_types", entityIds: [kept] }]);
  await expect(
    publishRules([{ type: "allowed_trailer_types", entityIds: [kept, hidden] }]),
  ).rejects.toMatchObject({ publicCode: "CATALOG_SELECTION_HIDDEN" });
  await expect(
    publishRules([{ type: "allowed_trailer_types", entityIds: [newId()] }]),
  ).rejects.toMatchObject({ statusCode: 422 });
  await expect(
    publishRules([{ type: "allowed_adr_categories", classes: ["5"] as never }]),
  ).rejects.toMatchObject({ statusCode: 422 });
  await publishRules([{ type: "allowed_adr_categories", classes: ["2", "3"] }]);
});
