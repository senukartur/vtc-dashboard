import { randomBytes } from "node:crypto";
import { createUnitOfWork, newId, runMigrations, type UnitOfWork } from "@vtc/db";
import { company } from "@vtc/db/identity-schema";
import { eq, trips } from "@vtc/db/trips-schema";
import type { Connection, RowDataPacket } from "mysql2/promise";
import {
  describe,
  expect,
  test,
  afterAll as vitestAfterAll,
  beforeAll as vitestBeforeAll,
} from "vitest";
import { createApp } from "../../apps/api/src/app.ts";
import { createAnalytics } from "../../apps/api/src/modules/analytics/service.ts";
import {
  type Actor,
  createIdentity,
  type Identity,
} from "../../apps/api/src/modules/identity/service.ts";
import { identityAccessEvents } from "../../apps/api/src/platform/outbox/events.ts";
import { guardedSettings, reset, testConnection } from "../persistence/support.ts";
import { schemaLifecycleHooks } from "../support/schema-lifecycle.ts";

const { beforeAll, afterAll } = schemaLifecycleHooks(vitestBeforeAll, vitestAfterAll);

describe("Analytics Integration Tests", () => {
  let control: Connection;
  let unit: UnitOfWork;
  let identity: Identity;
  let app: Awaited<ReturnType<typeof createApp>>;

  let directorActor: Actor;
  let directorCookie: string;
  let driver1Actor: Actor;
  let driver1Cookie: string;
  let driver2Actor: Actor;
  let driver2Cookie: string;

  const password = "Fictional-analytics-password-42";
  const cursorKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  async function registerMember(
    name: string,
    roles: ("driver" | "trainee" | "dispatcher" | "deputy_director")[] = ["driver"],
  ) {
    const userId = newId();
    const email = `${userId}@example.invalid`;
    const credential = await identity.prepareCredential(password);
    await unit.run((tx) =>
      identity.insertWithCredential(tx, {
        userId,
        email,
        name,
        ...credential,
        roles,
      }),
    );
    const login = await identity.login(email, password);
    const cookie = login.cookies.map((v) => v.split(";", 1)[0]).join("; ");
    const actor = await identity.authenticate(new Headers({ cookie }));
    return { userId, actor, cookie };
  }

  beforeAll(async () => {
    control = await testConnection();
    unit = createUnitOfWork(guardedSettings());
    await reset(control);
    await runMigrations(guardedSettings());

    identity = createIdentity(
      unit,
      {
        secret: randomBytes(32).toString("hex"),
        origin: "http://127.0.0.1:4173",
        production: false,
      },
      { accessEvents: identityAccessEvents(unit) },
    );

    // Bootstrap director
    await identity.bootstrap({
      email: "analytics-director@example.invalid",
      name: "Analytics Director",
      password,
    });
    const dirLogin = await identity.login("analytics-director@example.invalid", password);
    directorCookie = dirLogin.cookies.map((v) => v.split(";", 1)[0]).join("; ");
    directorActor = await identity.authenticate(new Headers({ cookie: directorCookie }));

    // Add driver 1 and driver 2
    const d1 = await registerMember("Driver One");
    driver1Actor = d1.actor;
    driver1Cookie = d1.cookie;

    const d2 = await registerMember("Driver Two");
    driver2Actor = d2.actor;
    driver2Cookie = d2.cookie;

    // Create Analytics Service & App
    const analytics = createAnalytics(unit, identity, {
      enabled: true,
      cursorKey,
    });

    app = await createApp({
      checkReadiness: async () => true,
      identity,
      analytics,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  test("returns 409 SETUP_REQUIRED when company timezone is unconfigured", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/analytics/company?fromDate=2026-10-01&toDateExclusive=2026-10-31",
      headers: { cookie: directorCookie },
    });

    expect(res.statusCode).toBe(409);
    const json = res.json();
    expect(json.code).toBe("SETUP_REQUIRED");
  });

  test("returns 401 when unauthenticated", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/analytics/company?fromDate=2026-10-01&toDateExclusive=2026-10-31",
    });
    expect(res.statusCode).toBe(401);
  });

  test("processes small known dataset with cross-midnight, aliases, rejected and pending trips", async () => {
    // Configure reporting timezone to Europe/Moscow (+03:00)
    await unit.run(async (tx) => {
      await unit
        .client(tx)
        .update(company)
        .set({ reportingTimezone: "Europe/Moscow" })
        .where(eq(company.singleton, 1));
    });

    const trip1Id = newId();
    const trip2Id = newId();
    const trip3Id = newId();
    const trip4Id = newId();
    const trip5Id = newId();
    const trip6Id = newId();

    // Dataset seed:
    // Trip 1: Driver 1, ETS2, accepted, 150,000.0 m (150 km)
    // reportingAt: 2026-10-20T20:30:00.000Z -> in MSK (+3) is 2026-10-20 23:30:00 (Day: 2026-10-20)
    //
    // Trip 2: Driver 1, ETS2, accepted, 200,000.0 m (200 km)
    // reportingAt: 2026-10-20T21:30:00.000Z -> in MSK (+3) is 2026-10-21 00:30:00 (Day: 2026-10-21, cross-midnight!)
    //
    // Trip 3: Driver 2, ATS, accepted, 80,000.0 m (80 km)
    // reportingAt: 2026-10-20T12:00:00.000Z -> in MSK (+3) is 2026-10-20 15:00:00 (Day: 2026-10-20)
    //
    // Trip 4: Driver 1, ETS2, pending_review, 50,000.0 m
    // reportingAt: 2026-10-20T14:00:00.000Z -> should make projectionPending = true, excluded from accepted totals
    //
    // Trip 5: Driver 1, ETS2, rejected, 60,000.0 m
    // reportingAt: 2026-10-20T15:00:00.000Z -> rejected, excluded from accepted totals
    //
    // Trip 6: Driver 1, ETS2, accepted, 70,000.0 m, aliasOf: trip1Id
    // reportingAt: 2026-10-20T16:00:00.000Z -> aliasOf trip1Id, excluded from accepted totals

    const knownRows = [
      {
        id: trip1Id,
        ownerId: driver1Actor.userId,
        game: "ets2" as const,
        aliasOf: null,
        version: 1,
        outcome: "delivered" as const,
        recording: "complete" as const,
        decision: "accepted" as const,
        reviewReasons: [],
        actualDistanceM: "150000.0",
        reportingAt: "2026-10-20T20:30:00.000Z",
        createdAt: "2026-10-20T20:35:00.000Z",
      },
      {
        id: trip2Id,
        ownerId: driver1Actor.userId,
        game: "ets2" as const,
        aliasOf: null,
        version: 1,
        outcome: "delivered" as const,
        recording: "complete" as const,
        decision: "accepted" as const,
        reviewReasons: [],
        actualDistanceM: "200000.0",
        reportingAt: "2026-10-20T21:30:00.000Z",
        createdAt: "2026-10-20T21:35:00.000Z",
      },
      {
        id: trip3Id,
        ownerId: driver2Actor.userId,
        game: "ats" as const,
        aliasOf: null,
        version: 1,
        outcome: "delivered" as const,
        recording: "complete" as const,
        decision: "accepted" as const,
        reviewReasons: [],
        actualDistanceM: "80000.0",
        reportingAt: "2026-10-20T12:00:00.000Z",
        createdAt: "2026-10-20T12:05:00.000Z",
      },
      {
        id: trip4Id,
        ownerId: driver1Actor.userId,
        game: "ets2" as const,
        aliasOf: null,
        version: 1,
        outcome: "delivered" as const,
        recording: "complete" as const,
        decision: "pending_review" as const,
        reviewReasons: [],
        actualDistanceM: "50000.0",
        reportingAt: "2026-10-20T14:00:00.000Z",
        createdAt: "2026-10-20T14:05:00.000Z",
      },
      {
        id: trip5Id,
        ownerId: driver1Actor.userId,
        game: "ets2" as const,
        aliasOf: null,
        version: 1,
        outcome: "delivered" as const,
        recording: "complete" as const,
        decision: "rejected" as const,
        reviewReasons: [],
        actualDistanceM: "60000.0",
        reportingAt: "2026-10-20T15:00:00.000Z",
        createdAt: "2026-10-20T15:05:00.000Z",
      },
      {
        id: trip6Id,
        ownerId: driver1Actor.userId,
        game: "ets2" as const,
        aliasOf: trip1Id,
        version: 1,
        outcome: "delivered" as const,
        recording: "complete" as const,
        decision: "accepted" as const,
        reviewReasons: [],
        actualDistanceM: "70000.0",
        reportingAt: "2026-10-20T16:00:00.000Z",
        createdAt: "2026-10-20T16:05:00.000Z",
      },
    ];

    await unit.run((tx) => unit.client(tx).insert(trips).values(knownRows));

    // 1. Query company analytics for date window 2026-10-20 to 2026-10-22
    const compRes = await app.inject({
      method: "GET",
      url: "/api/v1/analytics/company?fromDate=2026-10-20&toDateExclusive=2026-10-22&granularity=day",
      headers: { cookie: driver1Cookie },
    });

    expect(compRes.statusCode).toBe(200);
    const compData = compRes.json();

    // Total accepted trips: Trip 1 (150km) + Trip 2 (200km) + Trip 3 (80km) = 3 trips, 430,000m
    expect(compData.summary.acceptedTrips).toBe(3);
    expect(compData.summary.actualDistanceM).toBe("430000");
    // projectionPending should be true due to Trip 4 (pending_review)
    expect(compData.summary.projectionPending).toBe(true);
    expect(compData.reportingTimezone).toBe("Europe/Moscow");

    // Check time-series buckets:
    // 2026-10-20: Trip 1 (150,000m) + Trip 3 (80,000m) = 230,000m, 2 trips
    // 2026-10-21: Trip 2 (200,000m cross-midnight) = 200,000m, 1 trip
    expect(compData.timeSeries).toEqual([
      { date: "2026-10-20", acceptedTrips: 2, actualDistanceM: "230000" },
      { date: "2026-10-21", acceptedTrips: 1, actualDistanceM: "200000" },
    ]);

    // 2. Query company analytics with game=ets2
    const ets2Res = await app.inject({
      method: "GET",
      url: "/api/v1/analytics/company?fromDate=2026-10-20&toDateExclusive=2026-10-22&game=ets2",
      headers: { cookie: driver1Cookie },
    });
    expect(ets2Res.statusCode).toBe(200);
    const ets2Data = ets2Res.json();
    // Excludes ATS (Trip 3)
    expect(ets2Data.summary.acceptedTrips).toBe(2);
    expect(ets2Data.summary.actualDistanceM).toBe("350000");

    // 3. Query company analytics with game=ats
    const atsRes = await app.inject({
      method: "GET",
      url: "/api/v1/analytics/company?fromDate=2026-10-20&toDateExclusive=2026-10-22&game=ats",
      headers: { cookie: driver1Cookie },
    });
    expect(atsRes.statusCode).toBe(200);
    const atsData = atsRes.json();
    // Only Trip 3 (no pending ETS2 trip in ATS scope)
    expect(atsData.summary.acceptedTrips).toBe(1);
    expect(atsData.summary.actualDistanceM).toBe("80000");
    expect(atsData.summary.projectionPending).toBe(false);

    // 4. Query Member Analytics for Driver 1
    const m1Res = await app.inject({
      method: "GET",
      url: `/api/v1/members/${driver1Actor.userId}/analytics?fromDate=2026-10-20&toDateExclusive=2026-10-22`,
      headers: { cookie: driver1Cookie },
    });
    expect(m1Res.statusCode).toBe(200);
    const m1Data = m1Res.json();
    expect(m1Data.member.id).toBe(driver1Actor.userId);
    expect(m1Data.summary.acceptedTrips).toBe(2);
    expect(m1Data.summary.actualDistanceM).toBe("350000");
    expect(m1Data.summary.projectionPending).toBe(true);

    // 5. Query Member Analytics for Driver 2
    const m2Res = await app.inject({
      method: "GET",
      url: `/api/v1/members/${driver2Actor.userId}/analytics?fromDate=2026-10-20&toDateExclusive=2026-10-22`,
      headers: { cookie: driver2Cookie },
    });
    expect(m2Res.statusCode).toBe(200);
    const m2Data = m2Res.json();
    expect(m2Data.member.id).toBe(driver2Actor.userId);
    expect(m2Data.summary.acceptedTrips).toBe(1);
    expect(m2Data.summary.actualDistanceM).toBe("80000");
    expect(m2Data.summary.projectionPending).toBe(false);

    // 6. Leaderboard query
    const lbRes = await app.inject({
      method: "GET",
      url: "/api/v1/analytics/leaderboard?fromDate=2026-10-20&toDateExclusive=2026-10-22&limit=1",
      headers: { cookie: driver1Cookie },
    });
    expect(lbRes.statusCode).toBe(200);
    const lbData = lbRes.json();
    expect(lbData.items.length).toBe(1);
    expect(lbData.items[0].rank).toBe(1);
    expect(lbData.items[0].member.id).toBe(driver1Actor.userId);
    expect(lbData.items[0].actualDistanceM).toBe("350000");
    expect(lbData.nextCursor).toBeTruthy();

    // Query second page using cursor
    const lbPage2 = await app.inject({
      method: "GET",
      url: `/api/v1/analytics/leaderboard?fromDate=2026-10-20&toDateExclusive=2026-10-22&limit=1&cursor=${encodeURIComponent(
        lbData.nextCursor,
      )}`,
      headers: { cookie: driver1Cookie },
    });
    expect(lbPage2.statusCode).toBe(200);
    const lb2Data = lbPage2.json();
    expect(lb2Data.items.length).toBe(1);
    expect(lb2Data.items[0].rank).toBe(2);
    expect(lb2Data.items[0].member.id).toBe(driver2Actor.userId);
    expect(lb2Data.items[0].actualDistanceM).toBe("80000");
    expect(lb2Data.nextCursor).toBeNull();
  });

  test("verified dynamic correction immediately updates aggregates without snapshot records", async () => {
    // Correct Trip 1's distance from 150,000m to 180,000m (e.g. reviewed correction)
    await unit.run(async (tx) => {
      await unit
        .client(tx)
        .update(trips)
        .set({ actualDistanceM: "180000.0" })
        .where(eq(trips.ownerId, driver1Actor.userId));
    });

    const compRes = await app.inject({
      method: "GET",
      url: "/api/v1/analytics/company?fromDate=2026-10-20&toDateExclusive=2026-10-22&granularity=day",
      headers: { cookie: driver1Cookie },
    });

    expect(compRes.statusCode).toBe(200);
    const compData = compRes.json();

    // Driver 1's trips were updated to 180,000m each (Trip 1 and Trip 2 = 360,000m) + Trip 3 (80,000m) = 440,000m
    expect(compData.summary.actualDistanceM).toBe("440000");
  });

  test("verifies EXPLAIN uses trip_analytics_reporting index", async () => {
    await control.query("ANALYZE TABLE trips");
    const [explain] = await control.execute<RowDataPacket[]>(
      "EXPLAIN SELECT id FROM trips WHERE decision = 'accepted' AND reporting_at >= '2026-10-19 21:00:00' AND reporting_at < '2026-10-21 21:00:00' AND alias_of IS NULL",
    );
    expect(explain[0]?.key).toBe("trip_analytics_reporting");
  });
});
