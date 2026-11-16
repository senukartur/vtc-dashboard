import { randomBytes } from "node:crypto";
import type { components } from "@vtc/contracts";
import { createUnitOfWork, newId, runMigrations, type UnitOfWork } from "@vtc/db";
import { sourceMessages, sourceTrips, trips } from "@vtc/db/trips-schema";
import type { Connection, RowDataPacket } from "mysql2/promise";
import {
  beforeEach,
  expect,
  test,
  afterAll as vitestAfterAll,
  beforeAll as vitestBeforeAll,
} from "vitest";
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
import { identityAccessEvents } from "../../apps/api/src/platform/outbox/events.ts";
import {
  guardedSettings,
  reset,
  SCHEMA_SETUP_TIMEOUT_MS,
  testConnection,
} from "../persistence/support.ts";
import { telemetryFixture } from "../support/builders.ts";
import { schemaLifecycleHooks } from "../support/schema-lifecycle.ts";

type S = components["schemas"];
const { beforeAll, afterAll } = schemaLifecycleHooks(vitestBeforeAll, vitestAfterAll);

let control: Connection,
  unit: UnitOfWork,
  identity: Identity,
  tripService: Trips,
  service: Qualifications;
let director: Actor, owner: Actor, deputy: Actor, observer: Actor;
const password = "Fictional-qualification-passphrase-42";
const identityConfig = {
  secret: randomBytes(32).toString("hex"),
  origin: "http://127.0.0.1:4173",
  production: false,
};
let instant = Date.parse("2026-11-01T12:00:00.000Z");
const now = () => new Date(instant),
  iso = () => now().toISOString(),
  tick = (ms = 1000) => {
    instant += ms;
  };
const openLimits: S["QualificationLimitsInput"] = {
  massMinKg: null,
  massMaxKg: null,
  distanceMinM: null,
  distanceMaxM: null,
  trailers: { mode: "any", typeIds: [] },
  adr: { mode: "any", classes: [] },
  hardModeRequired: false,
};
const noConditions = { requiredTrips: null, requiredDistanceM: null };
const status = (error: unknown) => (error as { statusCode?: number }).statusCode;
async function rejects(promise: Promise<unknown>, statusCode: number, publicCode?: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(status(error)).toBe(statusCode);
  if (publicCode) expect((error as { publicCode?: string }).publicCode).toBe(publicCode);
}

async function member(assigned: ("driver" | "trainee" | "deputy_director")[] = ["trainee"]) {
  const id = newId(),
    email = `${id}@example.invalid`,
    credential = await identity.prepareCredential(password);
  await unit.run(async (tx) => {
    await identity.insertWithCredential(tx, {
      userId: id,
      email,
      name: `Fictional member ${id.slice(0, 8)}`,
      ...credential,
      roles: assigned,
    });
    await createQualificationInitialization(unit).initialize(tx, {
      userId: id,
      games: ["ets2", "ats"],
      assignedAt: iso(),
    });
  });
  const login = await identity.login(email, password),
    cookie = login.cookies.map((v) => v.split(";", 1)[0]).join("; ");
  return identity.authenticate(new Headers({ cookie }));
}
const levelId = (rank: number, game: Game = "ets2") => structuralLevels[game][rank] as string;
async function configure(
  rank: number,
  conditions: S["QualificationConditions"],
  limits = openLimits,
  game: Game = "ets2",
) {
  const level = await service.detail(director, levelId(rank, game));
  return service.update(director, level.id, {
    expectedVersion: level.version,
    name: level.name,
    limits,
    conditions,
  });
}
async function credit(options: { ownerId?: string; distance?: string } = {}) {
  const ownerId = options.ownerId ?? owner.userId,
    tripId = newId(),
    sourceId = newId(),
    messageId = newId(),
    factId = newId(),
    distance = options.distance ?? "100000";
  await unit.run(async (tx) => {
    await identity.qualificationContextInTransaction(tx, [ownerId]);
    let evidence: NormalizedTripEvidence = await telemetryAdapter.normalize(
      telemetryFixture("completed") as unknown as Telemetry,
      { tx, ownerUserId: ownerId, sourceRecordId: messageId, factRevisionId: factId },
    );
    evidence = {
      ...evidence,
      game: "ets2",
      actualDistanceM: {
        status: "known",
        value: distance,
        sourceRecordId: messageId,
        sourceField: "synthetic.actualDistance",
      },
      start: { utc: iso(), basis: "event", verifiedActual: true },
      end: { utc: null, basis: "unknown", verifiedActual: false },
    };
    const c = unit.client(tx);
    await c.insert(trips).values({
      id: tripId,
      ownerId,
      game: "ets2",
      version: 1,
      outcome: "delivered",
      recording: "complete",
      decision: "accepted",
      currentFactId: factId,
      actualDistanceM: distance,
      reviewReasons: [],
      createdAt: iso(),
    });
    await c.insert(sourceTrips).values({
      id: sourceId,
      provider: "ets2telemetry",
      game: "ets2",
      sessionKey: Buffer.from(newId()),
      tripKey: Buffer.from(newId()),
      ownerId,
      canonicalTripId: tripId,
      latestRevision: "1",
      connectionContext: { state: "unknown", referenceId: null },
      createdAt: iso(),
    });
    await c.insert(sourceMessages).values({
      id: messageId,
      sourceTripId: sourceId,
      provider: "ets2telemetry",
      eventKey: Buffer.from(newId()),
      revision: "1",
      sha256: randomBytes(32),
      receivedAt: iso(),
      deliveryMode: "backfill",
    });
    await createFactRepository(unit).insert(tx, tripId, evidence, 1);
  });
  tick();
  return { tripId, expectedTripVersion: 1, version: 1, factId } satisfies ContributionChange;
}
const replace = (changes: ContributionChange[]) =>
  identity.transaction((tx) => service.replaceContributionsInTransaction(tx, changes));
async function revoke(change: ContributionChange) {
  await control.query("UPDATE trips SET version=2, decision='rejected' WHERE id=?", [
    change.tripId,
  ]);
  return replace([{ ...change, version: 2, expectedTripVersion: 2 }]);
}
async function rows<T>(sql: string, values: unknown[] = []) {
  const [result] = await control.query<RowDataPacket[]>(sql, values);
  return result as T[];
}
const openLevel = async (userId = owner.userId, game: Game = "ets2") =>
  (
    await rows<{ level_id: string; kind: string }>(
      "SELECT CAST(level_id AS CHAR) level_id, kind FROM qualification_assignments WHERE user_id=? AND game=? AND ended_at IS NULL",
      [userId, game],
    )
  ).map((row) => ({ levelId: row.level_id, kind: row.kind }));
const rolesOf = async (userId: string) =>
  (await rows<{ role: string }>("SELECT role FROM identity_roles WHERE user_id=?", [userId]))
    .map((row) => row.role)
    .sort();
const count = async (sql: string, values: unknown[]) =>
  Number((await rows<{ n: number | string }>(sql, values))[0]?.n);
const promotions = async (userId = owner.userId) => ({
  assignments: await count(
    "SELECT COUNT(*) n FROM qualification_assignments WHERE user_id=? AND kind='promotion'",
    [userId],
  ),
  events: await count(
    "SELECT COUNT(*) n FROM outbox_events WHERE type='qualification.promoted' AND JSON_UNQUOTE(JSON_EXTRACT(data,'$.userId'))=?",
    [userId],
  ),
  audits: await count(
    "SELECT COUNT(*) n FROM audit_entries a JOIN qualification_assignments q ON q.id=a.subject_id WHERE a.operation='qualification.promoted' AND q.user_id=?",
    [userId],
  ),
});

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
  director = await identity.authenticate(
    new Headers({ cookie: login.cookies.map((v) => v.split(";", 1)[0]).join("; ") }),
  );
  tripService = createTrips(
    unit,
    { cursorKey: randomBytes(32).toString("hex") },
    { identity },
    now,
  );
  service = createQualifications(unit, {}, { identity, trips: tripService }, now);
}, SCHEMA_SETUP_TIMEOUT_MS);
beforeEach(async () => {
  for (const table of [
    "identity_limits",
    "trip_contribution_history",
    "trip_contributions",
    "trip_history",
    "trip_fact_trailers",
    "trip_facts",
    "source_payloads",
    "source_messages",
    "source_trips",
    "trips",
    "outbox_events",
    "qualification_level_trailers",
  ])
    await control.query(`DELETE FROM ${table}`);
  await control.query("UPDATE qualification_assignments SET previous_assignment_id=NULL");
  await control.query("DELETE FROM qualification_assignments");
  const structural = [...structuralLevels.ets2, ...structuralLevels.ats];
  await control.query("DELETE FROM qualification_levels WHERE id NOT IN (?)", [structural]);
  await control.query(
    "UPDATE qualification_levels SET position=NULL, deleted_at=UTC_TIMESTAMP(3), version=1",
  );
  const names = ["Trainee", "Driver III", "Driver II", "Driver I"];
  for (const game of ["ets2", "ats"] as const)
    for (const [index, id] of structuralLevels[game].entries())
      await control.query(
        "UPDATE qualification_levels SET position=?, deleted_at=NULL, name=?, mass_min_kg=NULL, mass_max_kg=NULL, distance_min_m=NULL, distance_max_m=NULL, trailer_mode='any', adr_mode='any', adr_classes=NULL, hard_mode_required=0, required_trips=NULL, required_distance_m=NULL WHERE id=?",
        [index + 1, names[index], id],
      );
  instant = Date.parse("2026-11-01T12:00:00.000Z");
  owner = await member(["trainee"]);
  deputy = await member(["deputy_director"]);
  observer = await member(["driver"]);
  tick();
});
afterAll(async () => {
  await unit?.close();
  await control?.end();
});

test("company members read the ladder; only qualification managers change it", async () => {
  const list = await service.list(observer, "ets2");
  expect(list).toMatchObject({ game: "ets2", canManage: false });
  expect(list.levels.map((level) => level.position)).toEqual([1, 2, 3, 4]);
  expect(list.mine?.level?.id).toBe(levelId(0));
  expect((await service.list(deputy, "ets2")).canManage).toBe(true);
  expect((await service.detail(observer, levelId(1))).drivers).toEqual([]);
  const level = await service.detail(director, levelId(0));
  const input = {
    expectedVersion: level.version,
    name: "Fictional renamed",
    limits: openLimits,
    conditions: { requiredTrips: 1, requiredDistanceM: null },
  };
  await rejects(service.update(observer, level.id, input), 403);
  await rejects(
    service.create(owner, {
      game: "ets2",
      position: 5,
      name: "Fictional",
      limits: openLimits,
      conditions: noConditions,
    }),
    403,
  );
  await rejects(
    service.changeMember(observer, owner.userId, "ets2", { levelId: levelId(1), reason: "x" }),
    403,
  );
  await rejects(service.list(observer, "other" as Game), 422);
  const mine = await service.memberQualifications(observer, owner.userId);
  expect(mine.items.map((item) => [item.game, item.level?.id])).toEqual([
    ["ets2", levelId(0)],
    ["ats", levelId(0, "ats")],
  ]);
});

test("create, edit, move and remove keep a dense ladder and record history", async () => {
  const created = await service.create(deputy, {
    game: "ets2",
    position: 2,
    name: "Fictional Heavy",
    limits: {
      ...openLimits,
      massMinKg: "10000",
      massMaxKg: "30000",
      adr: { mode: "selected", classes: ["3", "8"] },
      hardModeRequired: true,
    },
    conditions: { requiredTrips: 3, requiredDistanceM: "500000" },
  });
  expect(created.promotedCount).toBe(0);
  expect(created.level).toMatchObject({
    position: 2,
    levelCount: 5,
    limits: { massMinKg: "10000", adr: { mode: "selected", classes: ["3", "8"] } },
    conditions: { requiredTrips: 3, requiredDistanceM: "500000" },
  });
  let ladder = (await service.list(director, "ets2")).levels;
  expect(ladder.map((level) => level.name)).toEqual([
    "Trainee",
    "Fictional Heavy",
    "Driver III",
    "Driver II",
    "Driver I",
  ]);
  // Distinct instants keep the newest-first history order deterministic.
  tick();
  const edited = await service.update(director, created.level.id, {
    expectedVersion: created.level.version,
    name: "Fictional Heavy II",
    limits: openLimits,
    conditions: { requiredTrips: 2, requiredDistanceM: null },
  });
  expect(edited.level.version).toBe(created.level.version + 1);
  tick();
  const moved = await service.move(director, created.level.id, {
    expectedVersion: edited.level.version,
    position: 4,
  });
  expect(moved.level.position).toBe(4);
  expect(
    (moved.level.history ?? []).map((entry) => [entry.operation, entry.actor?.id ?? null]),
  ).toEqual([
    ["moved", director.userId],
    ["edited", director.userId],
    ["created", deputy.userId],
  ]);
  ladder = (await service.list(director, "ets2")).levels;
  expect(ladder.map((level) => [level.position, level.name])).toEqual([
    [1, "Trainee"],
    [2, "Driver III"],
    [3, "Driver II"],
    [4, "Fictional Heavy II"],
    [5, "Driver I"],
  ]);
  const removed = await service.remove(director, created.level.id, {
    expectedVersion: moved.level.version,
    transferLevelId: levelId(1),
  });
  expect(removed.transferLevel.id).toBe(levelId(1));
  ladder = (await service.list(director, "ets2")).levels;
  expect(ladder.map((level) => level.position)).toEqual([1, 2, 3, 4]);
  expect(ladder.some((level) => level.id === created.level.id)).toBe(false);
  await rejects(service.detail(director, created.level.id), 404);
  expect((await service.detail(observer, levelId(1))).history).toBeNull();
});

test("a level below the top needs a condition; the top may have none", async () => {
  const level = await service.detail(director, levelId(1));
  await rejects(
    service.update(director, level.id, {
      expectedVersion: level.version,
      name: level.name,
      limits: openLimits,
      conditions: noConditions,
    }),
    422,
    "QUALIFICATION_CONDITIONS_REQUIRED",
  );
  await rejects(
    service.create(director, {
      game: "ets2",
      position: 1,
      name: "Fictional first",
      limits: openLimits,
      conditions: noConditions,
    }),
    422,
    "QUALIFICATION_CONDITIONS_REQUIRED",
  );
  const top = await service.detail(director, levelId(3));
  expect(
    (
      await service.update(director, top.id, {
        expectedVersion: top.version,
        name: top.name,
        limits: openLimits,
        conditions: noConditions,
      })
    ).level.conditions,
  ).toEqual(noConditions);
  await rejects(
    service.update(director, level.id, {
      expectedVersion: level.version,
      name: level.name,
      limits: openLimits,
      conditions: { requiredTrips: null, requiredDistanceM: "0" },
    }),
    422,
  );
  await rejects(
    service.update(director, level.id, {
      expectedVersion: level.version,
      name: level.name,
      limits: { ...openLimits, massMinKg: "2", massMaxKg: "1" },
      conditions: { requiredTrips: 1, requiredDistanceM: null },
    }),
    422,
  );
  await rejects(
    service.update(director, level.id, {
      expectedVersion: level.version,
      name: level.name,
      limits: { ...openLimits, adr: { mode: "selected", classes: [] } },
      conditions: { requiredTrips: 1, requiredDistanceM: null },
    }),
    422,
  );
});

test("a stale expectedVersion is a conflict and changes nothing", async () => {
  const level = await service.detail(director, levelId(1));
  const input = {
    expectedVersion: level.version,
    name: "Fictional first edit",
    limits: openLimits,
    conditions: { requiredTrips: 4, requiredDistanceM: null },
  };
  const [first, second] = await Promise.allSettled([
    service.update(director, level.id, input),
    service.update(deputy, level.id, { ...input, name: "Fictional second edit" }),
  ]);
  const outcomes = [first, second].map((r) => (r.status === "fulfilled" ? 200 : status(r.reason)));
  expect(outcomes.sort()).toEqual([200, 409]);
  await rejects(
    service.move(director, level.id, { expectedVersion: level.version, position: 3 }),
    409,
  );
  expect((await service.detail(director, level.id)).position).toBe(2);
});

test("the completing credit promotes once; leaving the first level makes a trainee a driver", async () => {
  await configure(0, { requiredTrips: 2, requiredDistanceM: "150000" });
  const first = await credit();
  expect((await replace([first])).promotedCount).toBe(0);
  expect(await openLevel()).toEqual([{ levelId: levelId(0), kind: "admission" }]);
  const progress = (await service.list(owner, "ets2")).mine;
  expect(progress?.progress).toEqual({ trips: 1, distanceM: "100000" });
  const second = await credit();
  expect((await replace([second])).promotedCount).toBe(1);
  expect(await openLevel()).toEqual([{ levelId: levelId(1), kind: "promotion" }]);
  expect(await rolesOf(owner.userId)).toEqual(["driver"]);
  expect(await promotions()).toEqual({ assignments: 1, events: 1, audits: 1 });
  // Recrediting the same trips never promotes again, and revoking one never demotes.
  expect((await replace([second])).promotedCount).toBe(0);
  await revoke(first);
  expect(await openLevel()).toEqual([{ levelId: levelId(1), kind: "promotion" }]);
  expect((await service.list(owner, "ets2")).mine?.progress).toEqual({
    trips: 0,
    distanceM: "0",
  });
});

test("two connections crediting at once produce exactly one promotion", async () => {
  await configure(0, { requiredTrips: 2, requiredDistanceM: null });
  const seed = await credit();
  await replace([seed]);
  const a = await credit(),
    b = await credit();
  const results = await Promise.all([replace([a]), replace([b])]);
  expect(results.reduce((sum, r) => sum + r.promotedCount, 0)).toBe(1);
  expect(await promotions()).toEqual({ assignments: 1, events: 1, audits: 1 });
  expect(await openLevel()).toEqual([{ levelId: levelId(1), kind: "promotion" }]);
});

test("lowering conditions promotes the drivers who already meet them", async () => {
  await configure(0, { requiredTrips: 5, requiredDistanceM: null });
  const second = await member(["trainee"]);
  for (const ownerId of [owner.userId, owner.userId, second.userId])
    await replace([await credit({ ownerId })]);
  const detail = await service.detail(director, levelId(0));
  const trips = (id: string) => detail.drivers.find((d) => d.memberId === id)?.credited.trips;
  expect([trips(owner.userId), trips(second.userId), trips(deputy.userId)]).toEqual([2, 1, 0]);
  const lowered = await configure(0, { requiredTrips: 2, requiredDistanceM: null });
  expect(lowered.promotedCount).toBe(1);
  expect(await openLevel()).toEqual([{ levelId: levelId(1), kind: "promotion" }]);
  expect(await openLevel(second.userId)).toEqual([{ levelId: levelId(0), kind: "admission" }]);
  const again = await configure(0, { requiredTrips: 1, requiredDistanceM: null });
  expect(again.promotedCount).toBe(1);
});

test("a level without conditions never promotes, even with credited trips", async () => {
  await configure(2, { requiredTrips: 1, requiredDistanceM: null });
  await service.changeMember(director, owner.userId, "ets2", {
    levelId: levelId(3),
    reason: "Fictional move to the top",
  });
  await replace([await credit()]);
  expect(await openLevel()).toEqual([{ levelId: levelId(3), kind: "manual" }]);
});

test("a manual change needs a reason, is audited and refuses the current level", async () => {
  await rejects(
    service.changeMember(director, owner.userId, "ets2", { levelId: levelId(2), reason: " " }),
    422,
  );
  await rejects(
    service.changeMember(director, owner.userId, "ets2", { levelId: levelId(0), reason: "x" }),
    409,
  );
  await rejects(
    service.changeMember(director, owner.userId, "ets2", { levelId: newId(), reason: "x" }),
    422,
  );
  const changed = await service.changeMember(deputy, owner.userId, "ets2", {
    levelId: levelId(2),
    reason: "Fictional experienced driver",
  });
  expect(changed.qualification.level?.id).toBe(levelId(2));
  expect(await rolesOf(owner.userId)).toEqual(["driver"]);
  const [row] = await rows<{ actor_id: string; comment: string; kind: string }>(
    "SELECT CAST(actor_id AS CHAR) actor_id, comment, kind FROM qualification_assignments WHERE user_id=? AND game='ets2' AND ended_at IS NULL",
    [owner.userId],
  );
  expect(row).toMatchObject({
    actor_id: deputy.userId,
    comment: "Fictional experienced driver",
    kind: "manual",
  });
  const audits = await rows<{ operation: string; actor_id: string }>(
    "SELECT a.operation, CAST(a.actor_id AS CHAR) actor_id FROM audit_entries a JOIN qualification_assignments q ON q.id=a.subject_id WHERE q.user_id=? AND q.kind='manual'",
    [owner.userId],
  );
  expect(audits).toEqual([{ operation: "qualification.assigned", actor_id: deputy.userId }]);
  // The other game is unaffected.
  expect(await openLevel(owner.userId, "ats")).toEqual([
    { levelId: levelId(0, "ats"), kind: "admission" },
  ]);
});

test("removing a level transfers its drivers and shifts the levels after it", async () => {
  await service.changeMember(director, observer.userId, "ets2", {
    levelId: levelId(1),
    reason: "Fictional placement",
  });
  const level = await service.detail(director, levelId(1));
  expect(level.drivers.map((d) => d.memberId)).toEqual([observer.userId]);
  await rejects(
    service.remove(director, level.id, {
      expectedVersion: level.version,
      transferLevelId: level.id,
    }),
    422,
  );
  const removed = await service.remove(director, level.id, {
    expectedVersion: level.version,
    transferLevelId: levelId(3),
  });
  expect(removed.transferLevel).toMatchObject({ id: levelId(3), position: 3 });
  expect(await openLevel(observer.userId)).toEqual([
    { levelId: levelId(3), kind: "level_removed" },
  ]);
  const ladder = (await service.list(director, "ets2")).levels;
  expect(ladder.map((l) => [l.id, l.position])).toEqual([
    [levelId(0), 1],
    [levelId(2), 2],
    [levelId(3), 3],
  ]);
  // Removing the first level moves its trainees off it, so they become drivers.
  const first = await service.detail(director, levelId(0));
  await service.remove(director, first.id, {
    expectedVersion: first.version,
    transferLevelId: levelId(2),
  });
  expect(await openLevel()).toEqual([{ levelId: levelId(2), kind: "level_removed" }]);
  expect(await rolesOf(owner.userId)).toEqual(["driver"]);
});

test("reads never promote, even when a driver already meets the conditions", async () => {
  await replace([await credit()]);
  await control.query("UPDATE qualification_levels SET required_trips=1 WHERE id=?", [levelId(0)]);
  await service.list(owner, "ets2");
  await service.detail(owner, levelId(0));
  await service.memberQualifications(owner, owner.userId);
  expect(await openLevel()).toEqual([{ levelId: levelId(0), kind: "admission" }]);
  expect(await promotions()).toEqual({ assignments: 0, events: 0, audits: 0 });
});
