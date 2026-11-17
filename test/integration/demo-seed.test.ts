import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createUnitOfWork, runMigrations, type UnitOfWork } from "@vtc/db";
import { catalogDlcs, catalogTrailers } from "@vtc/db/catalogs-schema";
import { company, eq } from "@vtc/db/identity-schema";
import { and, qualificationAssignments } from "@vtc/db/qualifications-schema";
import { sql, tripContributions, trips } from "@vtc/db/trips-schema";
import type { Connection } from "mysql2/promise";
import { expect, test, afterAll as vitestAfterAll, beforeAll as vitestBeforeAll } from "vitest";
import { createApp } from "../../apps/api/src/app.ts";
import {
  demoAssignmentEnd,
  demoAssignmentStart,
  demoDataset,
  demoEmail,
  demoId,
  demoMembers,
  games,
} from "../../apps/api/src/demo-dataset.ts";
import { createSeedIdentity, seedDashboard } from "../../apps/api/src/demo-seed.ts";
import { createAnalytics } from "../../apps/api/src/modules/analytics/service.ts";
import { createCatalogs } from "../../apps/api/src/modules/catalogs/service.ts";
import { createEvents } from "../../apps/api/src/modules/events/service.ts";
import { createIdentity } from "../../apps/api/src/modules/identity/service.ts";
import {
  createQualificationInitialization,
  structuralLevels,
} from "../../apps/api/src/modules/qualifications/initialization.ts";
import { createQualifications } from "../../apps/api/src/modules/qualifications/service.ts";
import type { Telemetry } from "../../apps/api/src/modules/sources/contracts/telemetry.ts";
import { createTrips } from "../../apps/api/src/modules/trips/service.ts";
import { readConfig } from "../../apps/api/src/platform/config/env.ts";
import { runPass } from "../../apps/api/src/platform/jobs/runner.ts";
import { composeIdentity } from "../../apps/api/src/use-cases/identity-messaging.ts";
import { catalogConfig } from "../fixtures/catalogs/synthetic.ts";
import {
  guardedSettings,
  reset,
  SCHEMA_SETUP_TIMEOUT_MS,
  testConnection,
} from "../persistence/support.ts";
import { telemetryFixture } from "../support/builders.ts";
import { schemaLifecycleHooks } from "../support/schema-lifecycle.ts";

const { beforeAll, afterAll } = schemaLifecycleHooks(vitestBeforeAll, vitestAfterAll);
let unit: UnitOfWork, control: Connection;
beforeAll(async () => {
  control = await testConnection();
  unit = createUnitOfWork(guardedSettings());
  await reset(control);
  await runMigrations(guardedSettings());
}, SCHEMA_SETUP_TIMEOUT_MS);
afterAll(async () => {
  await unit?.close();
  await control?.end();
});

// The production environment the Stage profile produces; the evidence file is read from the checkout.
function stageEnvironment(evidenceRoot: string) {
  const profile = JSON.parse(
    readFileSync(new URL("../../deploy/development/stage-features.json", import.meta.url), "utf8"),
  ) as { flags: string[]; settings: Record<string, string>; generatedKeys: string[] };
  const database = guardedSettings();
  return {
    NODE_ENV: "production",
    SERVE_WEB: "false",
    IDENTITY_ENABLED: "true",
    IDENTITY_SECRET: randomBytes(32).toString("hex"),
    IDENTITY_ORIGIN: "https://stage.example.invalid",
    MAIL_MODE: "disabled",
    MYSQL_HOST: database.host,
    MYSQL_PORT: String(database.port),
    MYSQL_DATABASE: database.database,
    MYSQL_USER: database.user,
    MYSQL_PASSWORD: database.password,
    ...Object.fromEntries(profile.flags.map((flag) => [flag, "true"])),
    ...profile.settings,
    MANUAL_EVIDENCE_ROOT: evidenceRoot,
    ...Object.fromEntries(
      profile.generatedKeys.map((key) => [key, randomBytes(32).toString("hex")]),
    ),
  };
}

test("local demo feeds real dashboard APIs, preserves reruns and refuses another company", async () => {
  const now = new Date("2026-10-30T12:00:00.000Z");
  const identity = createIdentity(
    unit,
    { secret: randomBytes(32).toString("hex"), origin: "http://127.0.0.1:4173", production: false },
    { qualificationsLifecycle: createQualificationInitialization(unit) },
  );
  const password = randomBytes(24).toString("base64url");
  const credential = await identity.prepareCredential(password);
  const expected = demoDataset(now);
  const seeded = await seedDashboard(unit, identity, credential.passwordHash, now);
  expect(seeded).toEqual({ members: 8, addedTrips: expected.trips.length, addedEvents: 2 });
  expect(await seedDashboard(unit, identity, credential.passwordHash, now)).toEqual({
    members: 8,
    addedTrips: 0,
    addedEvents: 0,
  });
  // Admissions carry believable dates before the first trip instead of 1 January 2000.
  const admissions = await unit.run((tx) =>
    unit
      .client(tx)
      .select({
        id: qualificationAssignments.id,
        assignedAt: qualificationAssignments.assignedAt,
        endedAt: qualificationAssignments.endedAt,
      })
      .from(qualificationAssignments)
      .where(eq(qualificationAssignments.kind, "admission")),
  );
  const firstTrip = expected.trips.map((trip) => trip.start).sort()[0] ?? "";
  for (const [memberIndex, member] of demoMembers.entries())
    for (const [gameIndex, game] of games.entries()) {
      const row = admissions.find((item) => item.id === demoId(`assignment/${member.id}/${game}`));
      expect(row?.assignedAt, `${member.nickname} ${game}`).toBe(
        demoAssignmentStart(now, memberIndex, gameIndex, member.rank),
      );
      expect(row?.endedAt ?? null).toBe(member.former ? demoAssignmentEnd(now) : null);
      expect((row?.assignedAt ?? "") < firstTrip).toBe(true);
    }
  const cursorKey = randomBytes(32).toString("hex");
  const catalogs = createCatalogs(unit, catalogConfig(), { identity });
  const tripService = createTrips(unit, { cursorKey }, { identity, catalogs });
  const qualifications = createQualifications(
    unit,
    {},
    { identity, trips: tripService },
    () => now,
  );
  const eventsService = createEvents(unit, { cursorKey }, { identity, catalogs }, () => now);
  const analytics = createAnalytics(unit, identity, { enabled: true, cursorKey });
  const app = await createApp({
    checkReadiness: async () => true,
    identity,
    trips: tripService,
    qualifications,
    events: eventsService,
    analytics,
  });
  try {
    const login = await identity.login(demoEmail, password);
    const cookie = login.cookies.map((part) => part.split(";", 1)[0]).join("; ");
    const get = (url: string) => app.inject({ method: "GET", url, headers: { cookie } });
    const aggregate = await get(
      "/api/v1/analytics/company?fromDate=2026-09-01&toDateExclusive=2026-11-01",
    );
    expect(aggregate.statusCode).toBe(200);
    const accepted = expected.trips.filter((trip) => trip.decision === "accepted");
    expect(aggregate.json().data.acceptedTrips).toBe(accepted.length);
    expect(aggregate.json().data.actualDistanceM).toBe(
      String(accepted.reduce((sum, trip) => sum + BigInt(trip.actualDistanceM), 0n)),
    );
    const leaders = await get(
      "/api/v1/analytics/leaderboard?fromDate=2026-09-01&toDateExclusive=2026-11-01",
    );
    expect(leaders.statusCode).toBe(200);
    expect(leaders.json().data.items).toHaveLength(7);
    const directory = await get("/api/v1/members");
    expect(directory.statusCode).toBe(200);
    expect(directory.json().data.items).toHaveLength(8);
    // Fixture members joined with their earliest admission, not at the seed instant.
    for (const [memberIndex, member] of demoMembers.entries()) {
      const profile = await get(`/api/v1/members/${member.id}`);
      expect(profile.statusCode).toBe(200);
      expect(profile.json().data.memberSince, member.nickname).toBe(
        games
          .map((_, gameIndex) => demoAssignmentStart(now, memberIndex, gameIndex, member.rank))
          .sort()[0],
      );
    }
    expect(directory.body).not.toContain("@example.invalid");
    const mine = await get("/api/v1/me/qualifications");
    expect(mine.statusCode).toBe(200);
    const items: { game: string; level: unknown; progress: { trips: number } }[] =
      mine.json().data.items;
    expect(items.map((item) => item.game).sort()).toEqual(["ats", "ets2"]);
    expect(items.every((item) => item.level !== null)).toBe(true);
    expect(items.some((item) => item.progress.trips > 0)).toBe(true);
    const upcoming = await get("/api/v1/me/upcoming-event");
    expect(upcoming.statusCode).toBe(200);
    expect(upcoming.json().data.title).toContain("Demo");
    const history = await get("/api/v1/trips?scope=company&limit=5");
    expect(history.statusCode).toBe(200);
    expect(history.json().data.items[0].origin.label).toBeTruthy();
    const queue = await get("/api/v1/trips?scope=review&decision=pending_review");
    expect(queue.statusCode).toBe(200);
    expect(queue.json().data.items).toHaveLength(2);
    const [counts] = await unit.run((tx) =>
      unit.client(tx).select({ count: sql<number>`count(*)` }).from(tripContributions),
    );
    expect(Number(counts?.count)).toBe(expected.trips.length);
    // Refusal happens before any writes even when given an otherwise valid fixture target.
    const originalId = await unit.run(async (tx) => {
      const [row] = await unit.client(tx).select().from(company);
      await unit
        .client(tx)
        .update(company)
        .set({ directorUserId: demoMembers[1]?.id })
        .where(eq(company.singleton, 1));
      return row?.directorUserId;
    });
    await expect(
      seedDashboard(unit, identity, credential.passwordHash, new Date("2026-10-31T12:00:00.000Z")),
    ).rejects.toThrow("DEMO_REFUSES_EXISTING_COMPANY");
    const [count] = await unit.run((tx) =>
      unit.client(tx).select({ count: sql<number>`count(*)` }).from(trips),
    );
    expect(Number(count?.count)).toBe(expected.trips.length);
    await unit.run((tx) =>
      unit
        .client(tx)
        .update(company)
        .set({ directorUserId: originalId })
        .where(eq(company.singleton, 1)),
    );
    // A demo list row removed since the last run is restored before a rerun uses it.
    await unit.run(async (tx) => {
      const client = unit.client(tx);
      await client.execute(sql`SET FOREIGN_KEY_CHECKS = 0`);
      await client.delete(catalogTrailers).where(eq(catalogTrailers.id, demoId("entity/ets2/3")));
      await client.execute(sql`SET FOREIGN_KEY_CHECKS = 1`);
    });
    // A rerun whose credit crosses the trainee's condition promotes them and ends the trainee
    // role, which appends an access change through the seed entries' identity.
    const trainee = demoMembers.find((member) => member.roles.includes("trainee"));
    if (!trainee) throw new Error("DEMO_TRAINEE_MISSING");
    const traineeState = () =>
      unit.run(async (tx) => {
        const client = unit.client(tx);
        const [[level]] = (await client.execute(sql`
          SELECT l.position FROM qualification_assignments a
          JOIN qualification_levels l ON l.id = a.level_id
          WHERE a.user_id = ${trainee.id} AND a.game = 'ets2' AND a.ended_at IS NULL`)) as unknown as [
          { position: number }[],
        ];
        const [roleRows] = (await client.execute(
          sql`SELECT role FROM identity_roles WHERE user_id = ${trainee.id} ORDER BY role`,
        )) as unknown as [{ role: string }[]];
        const [[events]] = (await client.execute(sql`
          SELECT count(*) AS count FROM outbox_events
          WHERE type = 'member.access_changed' AND aggregate_id = ${trainee.id}`)) as unknown as [
          { count: number }[],
        ];
        return {
          position: level?.position,
          roles: roleRows.map((row) => row.role),
          accessEvents: Number(events?.count),
        };
      });
    expect(await traineeState()).toEqual({ position: 1, roles: ["trainee"], accessEvents: 0 });
    await unit.run((tx) =>
      unit.client(tx).execute(sql`
        UPDATE qualification_levels SET required_trips = 1, required_distance_m = NULL,
          version = version + 1
        WHERE game = 'ets2' AND position = 1`),
    );
    const later = await seedDashboard(
      unit,
      createSeedIdentity(unit, "http://127.0.0.1:4173"),
      credential.passwordHash,
      new Date(now.getTime() + 86400000),
    );
    expect(later.addedTrips).toBeGreaterThan(0);
    expect(await traineeState()).toEqual({ position: 2, roles: ["driver"], accessEvents: 1 });
  } finally {
    await app.close();
  }
}, 60000);

test("stage profile validates in production, adopts a bootstrapped company and accepts a trip", async () => {
  const evidenceRoot = mkdtempSync(join(tmpdir(), "vtc-stage-seed-"));
  const config = readConfig(stageEnvironment(evidenceRoot));
  expect(config.catalogs).toMatchObject({ cursorKey: expect.any(String) });
  if (!config.identity) throw new Error("SYNTHETIC_IDENTITY_REQUIRED");
  const composed = composeIdentity(
    unit,
    config.identity,
    config.mail,
    config.admissions,
    config.externalIdentities,
    config.catalogs,
    config.trips,
    config.telemetry,
    config.manualReports,
    config.qualifications,
    config.events,
    config.reconciliation,
    config.tripDecisions,
    config.analytics,
    config.notifications,
  );
  const { identity } = composed;
  if (!identity) throw new Error("SYNTHETIC_IDENTITY_REQUIRED");
  const owner = { email: "owner@example.invalid", name: "Synthetic Owner" };
  const ownerPassword = randomBytes(24).toString("base64url");
  const demoPassword = randomBytes(24).toString("base64url");
  const { passwordHash } = await identity.prepareCredential(demoPassword);
  const start = async () => {
    await reset(control);
    await runMigrations(guardedSettings());
    return identity.bootstrap({ ...owner, password: ownerPassword });
  };
  const tripCount = async () => {
    const [row] = await unit.run((tx) =>
      unit.client(tx).select({ count: sql<number>`count(*)` }).from(trips),
    );
    return Number(row?.count);
  };
  const app = await createApp({ checkReadiness: async () => true, ...composed });
  try {
    const addCatalog = () =>
      unit.run(async (tx) => {
        await unit
          .client(tx)
          .insert(catalogDlcs)
          .values({
            id: randomUUID(),
            game: "ets2",
            code: Buffer.from(`fixture_existing_pack_${randomUUID()}`),
            nameEn: "Fictional existing pack",
          });
      });
    const addMember = () =>
      unit.run((tx) =>
        identity.insertWithCredential(tx, {
          userId: demoId("existing-member"),
          email: "existing.member@example.invalid",
          name: "Existing Member",
          passwordHash,
          roles: ["driver"],
        }),
      );
    const { userId } = await start();
    // Without the explicit adoption option an existing company is still refused.
    await expect(seedDashboard(unit, identity, passwordHash)).rejects.toThrow(
      "DEMO_REFUSES_EXISTING_COMPANY",
    );
    await addCatalog();
    await expect(
      seedDashboard(unit, identity, passwordHash, new Date(), { adoptCompany: true }),
    ).rejects.toThrow("DEMO_REFUSES_EXISTING_CATALOG");
    await addMember();
    await expect(
      seedDashboard(unit, identity, passwordHash, new Date(), { adoptCompany: true }),
    ).rejects.toThrow("DEMO_REFUSES_EXISTING_MEMBERS");
    expect(await tripCount()).toBe(0);

    const { userId: directorId } = await start();
    // As in real attribution, no credit from an assignment newer than the fixture trips (ets2)
    // or from a level period that has already ended (ats).
    await unit.run(async (tx) => {
      const c = unit.client(tx),
        at = Date.now();
      await c
        .delete(qualificationAssignments)
        .where(eq(qualificationAssignments.userId, directorId));
      await c.insert(qualificationAssignments).values(
        (["ets2", "ats"] as const).map((game) => ({
          id: randomUUID(),
          userId: directorId,
          game,
          levelId: structuralLevels[game][0],
          assignedAt: new Date(at).toISOString(),
          endedAt: game === "ats" ? new Date(at + 1000).toISOString() : null,
          kind: "admission" as const,
          actorId: null,
          comment: null,
        })),
      );
    });
    const expected = demoDataset(new Date());
    expect(
      await seedDashboard(unit, identity, passwordHash, new Date(), { adoptCompany: true }),
    ).toEqual({ members: 8, addedTrips: expected.trips.length, addedEvents: 2 });
    expect(
      await seedDashboard(unit, identity, passwordHash, new Date(), { adoptCompany: true }),
    ).toEqual({ members: 8, addedTrips: 0, addedEvents: 0 });
    expect(await tripCount()).toBe(expected.trips.length);
    const creditOf = async (ownerId: string) => {
      const rows = await unit.run((tx) =>
        unit
          .client(tx)
          .select({ game: trips.game, credited: tripContributions.credited })
          .from(tripContributions)
          .innerJoin(trips, eq(trips.id, tripContributions.tripId))
          .where(and(eq(trips.ownerId, ownerId), eq(trips.decision, "accepted"))),
      );
      return (game: string) =>
        rows.filter((row) => row.game === game).map((row) => Boolean(row.credited));
    };
    const director = await creditOf(directorId);
    for (const game of ["ets2", "ats"]) {
      expect(director(game).length).toBeGreaterThan(0);
      expect(director(game)).not.toContain(true);
    }
    const deputy = await creditOf(demoMembers[1]?.id ?? "");
    expect([...deputy("ets2"), ...deputy("ats")]).toContain(true);

    const session = async (email: string, password: string) => {
      const login = await identity.login(email, password);
      return login.cookies.map((part) => part.split(";", 1)[0]).join("; ");
    };
    const headers = (cookie: string) => ({ cookie, origin: "https://stage.example.invalid" });
    const ownerCookie = await session(owner.email, ownerPassword);
    const mine = await app.inject({
      method: "GET",
      url: "/api/v1/trips?scope=mine&limit=5",
      headers: headers(ownerCookie),
    });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().data.items.length).toBeGreaterThan(0);
    expect(mine.json().data.items[0].origin.label).toBeTruthy();

    // The seeded review queue is decidable: the Stage review page can be exercised end to end.
    const reviewer = await session(demoMembers[1]?.email ?? "", demoPassword);
    const tripId = demoId("queue/1");
    const review = await app.inject({
      method: "GET",
      url: `/api/v1/trips/${tripId}/review`,
      headers: headers(reviewer),
    });
    expect(review.statusCode).toBe(200);
    const detail = review.json().data;
    expect(detail.acceptance).toEqual({ mode: "ordinary", blockedReasonCodes: [] });
    const csrf = await app.inject({
      method: "GET",
      url: "/api/v1/auth/csrf",
      headers: headers(reviewer),
    });
    const decision = await app.inject({
      method: "POST",
      url: `/api/v1/trips/${tripId}/decisions`,
      headers: {
        ...headers(reviewer),
        "x-csrf-token": csrf.json().data.token,
        "idempotency-key": randomUUID(),
        "if-match": String(review.headers.etag),
        "content-type": "application/json",
      },
      payload: JSON.stringify({
        decision: "accept",
        reviewedRevisionId: detail.factRevisionId,
        factRevisionId: detail.factRevisionId,
        proposalId: null,
        reason: "Fictional evidence review",
      }),
    });
    expect(decision.statusCode).toBe(200);

    // A rerun also refuses once a real member or catalog sits beside the fixture.
    await addCatalog();
    await expect(
      seedDashboard(unit, identity, passwordHash, new Date(), { adoptCompany: true }),
    ).rejects.toThrow("DEMO_REFUSES_EXISTING_CATALOG");
    await addMember();
    await expect(
      seedDashboard(unit, identity, passwordHash, new Date(), { adoptCompany: true }),
    ).rejects.toThrow("DEMO_REFUSES_EXISTING_MEMBERS");
    expect(await tripCount()).toBe(expected.trips.length);
  } finally {
    await app.close();
    rmSync(evidenceRoot, { recursive: true, force: true });
  }
}, 180000);

test("Stage telemetry resolves against listed rows and stays conservative for a partial client trip", async () => {
  const evidenceRoot = mkdtempSync(join(tmpdir(), "vtc-stage-catalog-"));
  const environment = stageEnvironment(evidenceRoot);
  const config = readConfig(environment);
  expect(config.catalogs).toMatchObject({ cursorKey: expect.any(String) });
  if (!config.identity) throw new Error("SYNTHETIC_IDENTITY_REQUIRED");
  const composed = composeIdentity(
    unit,
    config.identity,
    config.mail,
    config.admissions,
    config.externalIdentities,
    config.catalogs,
    config.trips,
    config.telemetry,
    config.manualReports,
    config.qualifications,
    config.events,
    config.reconciliation,
    config.tripDecisions,
    config.analytics,
    config.notifications,
  );
  const { identity, catalogs, trips: tripService } = composed;
  if (!identity || !catalogs || !tripService) throw new Error("SYNTHETIC_COMPOSITION_REQUIRED");
  const owner = { email: "owner@example.invalid", name: "Synthetic Owner" };
  const ownerPassword = randomBytes(24).toString("base64url");
  const demoPassword = randomBytes(24).toString("base64url");
  await reset(control);
  await runMigrations(guardedSettings());
  await identity.bootstrap({ ...owner, password: ownerPassword });
  const { passwordHash } = await identity.prepareCredential(demoPassword);
  await seedDashboard(unit, identity, passwordHash, new Date(), { adoptCompany: true });

  const app = await createApp({ checkReadiness: async () => true, ...composed });
  const origin = "https://stage.example.invalid";
  const session = async (email: string, password: string) =>
    (await identity.login(email, password)).cookies.map((part) => part.split(";", 1)[0]).join("; ");
  const director = await session(owner.email, ownerPassword);
  const deputy = await session(demoMembers[1]?.email ?? "", demoPassword);
  const dispatcher = await session(demoMembers[2]?.email ?? "", demoPassword);
  const actor = await identity.authenticate(new Headers({ cookie: director }));
  const driverId = demoMembers[3]?.id;
  if (!actor || !driverId) throw new Error("SYNTHETIC_ACTORS_REQUIRED");
  const command = async (
    cookie: string,
    url: string,
    etag: string | string[] | number | undefined,
    payload: unknown,
  ) => {
    const csrf = await app.inject({
      method: "GET",
      url: "/api/v1/auth/csrf",
      headers: { cookie, origin },
    });
    return app.inject({
      method: "POST",
      url,
      headers: {
        cookie,
        origin,
        "x-csrf-token": csrf.json().data.token,
        "idempotency-key": randomUUID(),
        "if-match": String(etag),
        "content-type": "application/json",
      },
      payload: JSON.stringify(payload),
    });
  };
  const review = async (tripId: string) => {
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/trips/${tripId}/review`,
      headers: { cookie: deputy, origin },
    });
    expect(response.statusCode).toBe(200);
    return response;
  };
  const receive = async (
    shape: (payload: Telemetry) => void = () => {},
    ownerUserId: string = driverId,
  ) => {
    const payload = telemetryFixture("completed") as unknown as Telemetry;
    payload.eventId = randomUUID();
    payload.source.tripId = randomUUID();
    payload.source.pluginSessionId = randomUUID();
    // Only the clock moves, so that the trip falls inside the owner's qualification.
    payload.snapshot.start.utcMs = Date.now() - 1000;
    if (payload.snapshot.end) payload.snapshot.end.utcMs = Date.now();
    payload.createdUtcMs = Date.now();
    shape(payload);
    return unit.run((tx) =>
      tripService.storeInTransaction(tx, "ets2telemetry", payload, {
        ownerUserId,
        connection: { state: "unknown", referenceId: null },
      }),
    );
  };

  try {
    // Before any list rows exist the fixture cannot be recognized, whatever staff do.
    const early = await receive();
    expect((await review(early.tripId)).json().data.acceptance.mode).toBe("unavailable");

    for (const [list, code, nameEn] of [
      ["cities", "fixture_north", "Fictional north"],
      ["cities", "fixture_south", "Fictional south"],
      ["cargoes", "fixture_crates", "Fictional crates"],
      ["trailers", "fixture_box", "Fictional box"],
    ] as const)
      await catalogs.create(actor, list, randomUUID(), { game: "ets2", code, nameEn });

    // The seed never writes beside rows that are not its own, reruns included.
    await expect(
      seedDashboard(unit, identity, passwordHash, new Date(), { adoptCompany: true }),
    ).rejects.toThrow("DEMO_REFUSES_EXISTING_CATALOG");

    // A complete fixture trip is recognized from its telemetry alone, even without a build.
    const fixture = await receive((payload) => {
      const absent = { available: false, reason: "not-observed" } as const;
      payload.snapshot.context.gameBuild = absent;
      payload.snapshot.context.mapId = absent;
    });
    expect((await review(fixture.tripId)).json().data.acceptance).toEqual({
      mode: "ordinary",
      blockedReasonCodes: [],
    });

    // The shape the desktop client projects today: no build or map, incomplete trailers and a
    // quality reason. Facts resolve, but the trip stays conservative for human review.
    // The owner's client is bound to the director, who cannot review their own trip.
    const client = await receive((payload) => {
      const absent = { available: false, reason: "not-observed" } as const;
      payload.snapshot.context.gameBuild = absent;
      payload.snapshot.context.mapId = absent;
      payload.snapshot.trailers.complete = false;
      payload.snapshot.evidence.ruleContextComplete = false;
      payload.snapshot.evidence.reasons = ["catalog-context-unavailable"];
    }, actor.userId);
    const blocked: string[] = (await review(client.tripId)).json().data.acceptance
      .blockedReasonCodes;
    for (const reason of ["cargo_unknown", "destination_unknown", "origin_unknown"])
      expect(blocked).not.toContain(reason);
    const [clientRow] = await unit.run((tx) =>
      unit
        .client(tx)
        .select({ decision: trips.decision })
        .from(trips)
        .where(eq(trips.id, client.tripId)),
    );
    expect(clientRow?.decision).toBe("pending_review");
  } finally {
    await app.close();
    rmSync(evidenceRoot, { recursive: true, force: true });
  }
}, 180000);
