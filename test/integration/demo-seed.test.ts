import { randomBytes } from "node:crypto";
import { createUnitOfWork, runMigrations, type UnitOfWork } from "@vtc/db";
import { company, eq } from "@vtc/db/identity-schema";
import { sql, trips, tripContributions } from "@vtc/db/trips-schema";
import type { Connection } from "mysql2/promise";
import { expect, test, afterAll as vitestAfterAll, beforeAll as vitestBeforeAll } from "vitest";
import { createApp } from "../../apps/api/src/app.ts";
import { createAnalytics } from "../../apps/api/src/modules/analytics/service.ts";
import { createCatalogs } from "../../apps/api/src/modules/catalogs/service.ts";
import { createEvents } from "../../apps/api/src/modules/events/service.ts";
import { createIdentity } from "../../apps/api/src/modules/identity/service.ts";
import { createQualificationInitialization } from "../../apps/api/src/modules/qualifications/initialization.ts";
import { createQualifications } from "../../apps/api/src/modules/qualifications/service.ts";
import { createTrips } from "../../apps/api/src/modules/trips/service.ts";
import { catalogEvents } from "../../apps/api/src/platform/outbox/events.ts";
import { demoDataset, demoEmail, demoMembers } from "../../scripts/demo/dataset.ts";
import { seedDashboard } from "../../scripts/demo/seed.ts";
import {
  guardedSettings,
  reset,
  SCHEMA_SETUP_TIMEOUT_MS,
  testConnection,
} from "../persistence/support.ts";
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
  } finally {
    await app.close();
  }
}, 60000);
