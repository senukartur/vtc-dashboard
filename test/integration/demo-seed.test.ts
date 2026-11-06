import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createUnitOfWork, runMigrations, type UnitOfWork } from "@vtc/db";
import {
  catalogArtifacts,
  catalogEntities,
  catalogFacts,
  catalogRevisions,
} from "@vtc/db/catalogs-schema";
import { company, eq } from "@vtc/db/identity-schema";
import { and, qualificationAssignments, qualificationStates } from "@vtc/db/qualifications-schema";
import { sql, tripContributions, trips } from "@vtc/db/trips-schema";
import type { Connection } from "mysql2/promise";
import { expect, test, afterAll as vitestAfterAll, beforeAll as vitestBeforeAll } from "vitest";
import { createApp } from "../../apps/api/src/app.ts";
import {
  demoDataset,
  demoEmail,
  demoEpoch,
  demoId,
  demoMembers,
} from "../../apps/api/src/demo-dataset.ts";
import { seedDashboard } from "../../apps/api/src/demo-seed.ts";
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
import { catalogEvents } from "../../apps/api/src/platform/outbox/events.ts";
import { composeIdentity } from "../../apps/api/src/use-cases/identity-messaging.ts";
import {
  guardedSettings,
  reset,
  SCHEMA_SETUP_TIMEOUT_MS,
  testConnection,
} from "../persistence/support.ts";
import { telemetryFixture } from "../support/builders.ts";
import { completeCatalogImport } from "../support/catalog-import-fixture.ts";
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
  // The image ships exactly the file the profile names.
  expect(profile.settings.CATALOGS_EVIDENCE_FILE).toBe(
    "/app/operations/stage-catalog-evidence.json",
  );
  expect(readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8")).toContain(
    "deploy/development/stage-catalog-evidence.json ./operations/",
  );
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
    CATALOGS_EVIDENCE_FILE: fileURLToPath(
      new URL("../../deploy/development/stage-catalog-evidence.json", import.meta.url),
    ),
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
  const cursorKey = randomBytes(32).toString("hex");
  const catalogs = createCatalogs(
    unit,
    {
      production: false,
      synthetic: true,
      cursorKey,
      maxFileBytes: 1000000,
      artifactTtlMs: 60000,
      policyRevision: 1,
      evidence: [],
    },
    { identity, published: catalogEvents(unit).append },
  );
  const tripService = createTrips(unit, { cursorKey }, { identity, catalogs });
  const qualifications = createQualifications(
    unit,
    { cursorKey },
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
    expect(directory.body).not.toContain("@example.invalid");
    for (const game of ["ets2", "ats"]) {
      const progress = await get(`/api/v1/me/qualification-progress?game=${game}`);
      expect(progress.statusCode).toBe(200);
      expect(progress.json().data.acceptedTrips).toBeGreaterThan(0);
    }
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
    // A database seeded before the trailer label existed gains it before a later rerun pins it.
    await unit.run(async (tx) => {
      const client = unit.client(tx);
      await client.execute(sql`SET FOREIGN_KEY_CHECKS = 0`);
      await client.delete(catalogFacts).where(eq(catalogFacts.id, demoId("catalog-fact/ets2/3")));
      await client.delete(catalogEntities).where(eq(catalogEntities.id, demoId("entity/ets2/3")));
      await client.execute(sql`SET FOREIGN_KEY_CHECKS = 1`);
    });
    const later = await seedDashboard(
      unit,
      identity,
      credential.passwordHash,
      new Date(now.getTime() + 86400000),
    );
    expect(later.addedTrips).toBeGreaterThan(0);
  } finally {
    await app.close();
  }
}, 60000);

test("stage profile validates in production, adopts a bootstrapped company and accepts a trip", async () => {
  const evidenceRoot = mkdtempSync(join(tmpdir(), "vtc-stage-seed-"));
  const config = readConfig(stageEnvironment(evidenceRoot));
  expect(config.catalogs).toMatchObject({ production: true, synthetic: false });
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
    const addCatalog = (creatorId: string) =>
      unit.run(async (tx) => {
        const c = unit.client(tx),
          artifactId = randomUUID(),
          sha256 = createHash("sha256").update("existing-catalog").digest();
        await c.insert(catalogArtifacts).values({
          id: artifactId,
          creatorId,
          sha256,
          byteLength: 0,
          content: null,
          expiresAt: demoEpoch,
          createdAt: demoEpoch,
        });
        await c.insert(catalogRevisions).values({
          id: randomUUID(),
          game: "ets2",
          version: 1,
          state: "validated",
          complete: true,
          artifactId,
          artifactSha256: sha256,
          gameBuild: "existing-build",
          inventoryAsOf: "2026-01-01",
          synthetic: false,
          sourceManifestSha256: sha256,
          provenance: [{ source: "Fictional existing catalog" }],
          createdAt: demoEpoch,
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
    await addCatalog(userId);
    await expect(
      seedDashboard(unit, identity, passwordHash, new Date(), { adoptCompany: true }),
    ).rejects.toThrow("DEMO_REFUSES_EXISTING_CATALOG");
    await addMember();
    await expect(
      seedDashboard(unit, identity, passwordHash, new Date(), { adoptCompany: true }),
    ).rejects.toThrow("DEMO_REFUSES_EXISTING_MEMBERS");
    expect(await tripCount()).toBe(0);

    const { userId: directorId } = await start();
    // An assignment newer than the fixture trips earns them no credit, as in real attribution.
    await unit.run(async (tx) => {
      const c = unit.client(tx),
        assignmentId = randomUUID();
      await c.insert(qualificationAssignments).values({
        id: assignmentId,
        userId: directorId,
        game: "ets2",
        levelId: structuralLevels.ets2[0],
        assignedAt: new Date().toISOString(),
        endedAt: null,
        purpose: "initial",
        actorId: null,
        reason: "Fictional assignment newer than the fixture trips",
      });
      await c
        .insert(qualificationStates)
        .values({ userId: directorId, game: "ets2", assignmentId, version: 1 })
        .onDuplicateKeyUpdate({ set: { assignmentId } });
    });
    const expected = demoDataset(new Date());
    expect(
      await seedDashboard(unit, identity, passwordHash, new Date(), { adoptCompany: true }),
    ).toEqual({ members: 8, addedTrips: expected.trips.length, addedEvents: 2 });
    expect(
      await seedDashboard(unit, identity, passwordHash, new Date(), { adoptCompany: true }),
    ).toEqual({ members: 8, addedTrips: 0, addedEvents: 0 });
    expect(await tripCount()).toBe(expected.trips.length);
    const directorCredit = await unit.run((tx) =>
      unit
        .client(tx)
        .select({ game: trips.game, credited: tripContributions.credited })
        .from(tripContributions)
        .innerJoin(trips, eq(trips.id, tripContributions.tripId))
        .where(and(eq(trips.ownerId, directorId), eq(trips.decision, "accepted"))),
    );
    const creditedFor = (game: string) =>
      directorCredit.filter((row) => row.game === game).map((row) => Boolean(row.credited));
    expect(creditedFor("ets2").length).toBeGreaterThan(0);
    expect(creditedFor("ets2")).not.toContain(true);
    expect(creditedFor("ats")).toContain(true);

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
    await addCatalog(directorId);
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

test("Stage placeholder catalog publishes in production mode and telemetry resolves to ordinary acceptance", async () => {
  const evidenceRoot = mkdtempSync(join(tmpdir(), "vtc-stage-catalog-"));
  const environment = stageEnvironment(evidenceRoot);
  const config = readConfig(environment);
  expect(config.catalogs).toMatchObject({ production: true, synthetic: false });
  expect(() => readConfig({ ...environment, CATALOGS_SYNTHETIC: "true" })).toThrow(
    "CATALOGS_SYNTHETIC",
  );
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
    // Before any publication a trip cannot be accepted, whatever staff do.
    const early = await receive();
    expect((await review(early.tripId)).json().data.acceptance.mode).toBe("unavailable");

    const revisions = new Map<string, string>();
    for (const game of ["ets2", "ats"] as const) {
      const bytes = readFileSync(
        new URL(`../../deploy/development/stage-catalog-${game}.json`, import.meta.url),
      );
      const artifact = await catalogs.upload(actor, randomUUID(), bytes);
      const operation = await catalogs.import(actor, randomUUID(), {
        artifactId: artifact.id,
        sha256: artifact.sha256,
        game,
      });
      const { resultId } = await completeCatalogImport(
        operation.id,
        {
          read: (id) => catalogs.operation(actor, id),
          pass: (signal) => runPass(composed.jobsQueue, signal),
        },
        { deadlineAt: performance.now() + 25000 },
      );
      const candidate = await catalogs.detail(actor, resultId);
      expect(candidate.sourceReviewComplete).toBe(true);
      await catalogs.publish(actor, resultId, randomUUID(), candidate.version, {
        expectedPublicationVersion: candidate.publicationVersion,
        reason: "Stage placeholder catalog",
      });
      revisions.set(game, resultId);
    }
    // The seed never writes beside a catalog that is not its own, reruns included.
    await expect(
      seedDashboard(unit, identity, passwordHash, new Date(), { adoptCompany: true }),
    ).rejects.toThrow("DEMO_REFUSES_EXISTING_CATALOG");
    const catalogRevisionId = revisions.get("ets2") as string;
    const pick = async (kind: string, label: string) => {
      const { items } = await catalogs.entities(actor, {
        revisionId: catalogRevisionId,
        kind,
        locale: "en",
      });
      const found = items.find((item) => item.display.label === label);
      if (!found) throw new Error("SYNTHETIC_ENTITY_MISSING");
      return found.id;
    };
    const selection = {
      catalogRevisionId,
      originCityId: await pick("city", "Stage placeholder origin"),
      destinationCityId: await pick("city", "Stage placeholder destination"),
      cargoId: await pick("cargo", "Stage placeholder cargo"),
      trailerTypeId: await pick("trailer_type", "Stage placeholder trailer"),
    };

    const resolve = async (tripId: string, changes: Record<string, string>, author = director) => {
      const before = await review(tripId);
      expect(before.json().data.acceptance.mode).toBe("unavailable");
      const proposed = await command(
        author,
        `/api/v1/trips/${tripId}/resolution-proposals`,
        before.headers.etag,
        { reason: "Stage check of a client integration trip", evidenceIds: [], ...changes },
      );
      expect(proposed.statusCode).toBe(201);
      const proposal = await app.inject({
        method: "GET",
        url: `/api/v1/trips/${tripId}/proposals/${proposed.json().data.id}`,
        headers: { cookie: deputy, origin },
      });
      const approved = await command(
        deputy,
        `/api/v1/trips/${tripId}/proposals/${proposed.json().data.id}/decisions`,
        proposal.headers.etag,
        {
          decision: "approve",
          reviewedRevisionId: proposal.json().data.revisionId,
          reason: "Second reviewer confirmed the Stage check",
        },
      );
      expect(approved.statusCode).toBe(200);
      expect((await review(tripId)).json().data.acceptance).toEqual({
        mode: "ordinary",
        blockedReasonCodes: [],
      });
      const [row] = await unit.run((tx) =>
        unit
          .client(tx)
          .select({ decision: trips.decision })
          .from(trips)
          .where(eq(trips.id, tripId)),
      );
      expect(row?.decision).toBe("accepted");
    };

    // The committed fixture sends no game build, so its identifiers cannot resolve on their own.
    const fixture = await receive();
    expect((await review(fixture.tripId)).json().data.acceptance.blockedReasonCodes).toEqual([
      "cargo_unknown",
      "destination_unknown",
      "origin_unknown",
      "trailer_context_unknown",
    ]);
    await resolve(fixture.tripId, selection);

    // The shape ET-103a projects today: no build or map, incomplete trailers and a quality reason.
    // The owner's client is bound to the director, who cannot review their own trip.
    const client = await receive((payload) => {
      const absent = { available: false, reason: "not-observed" } as const;
      payload.snapshot.context.gameBuild = absent;
      payload.snapshot.context.mapId = absent;
      payload.snapshot.trailers.complete = false;
      payload.snapshot.evidence.ruleContextComplete = false;
      payload.snapshot.evidence.reasons = ["catalog-context-unavailable"];
    }, actor.userId);
    expect((await review(client.tripId)).json().data.acceptance.blockedReasonCodes).toEqual([
      "actual_distance_unknown",
      "cargo_unknown",
      "destination_unknown",
      "origin_unknown",
      "trailer_context_unknown",
      "whole_trip_distance_unknown",
    ]);
    await resolve(client.tripId, { ...selection, actualDistanceM: "123400" }, dispatcher);
  } finally {
    await app.close();
    rmSync(evidenceRoot, { recursive: true, force: true });
  }
}, 180000);
