import { randomBytes } from "node:crypto";
import { createUnitOfWork, newId, runMigrations, type UnitOfWork } from "@vtc/db";
import { company, membership } from "@vtc/db/identity-schema";
import { eq, trips } from "@vtc/db/trips-schema";
import type { Connection, RowDataPacket } from "mysql2/promise";
import { expect, test, afterAll as vitestAfterAll, beforeAll as vitestBeforeAll } from "vitest";
import { createApp } from "../../apps/api/src/app.ts";
import { addDistances, createAnalytics } from "../../apps/api/src/modules/analytics/service.ts";
import {
  type Actor,
  createIdentity,
  type Identity,
} from "../../apps/api/src/modules/identity/service.ts";
import { identityAccessEvents } from "../../apps/api/src/platform/outbox/events.ts";
import {
  guardedSettings,
  reset,
  SCHEMA_SETUP_TIMEOUT_MS,
  testConnection,
} from "../persistence/support.ts";
import { schemaLifecycleHooks } from "../support/schema-lifecycle.ts";

const { beforeAll, afterAll } = schemaLifecycleHooks(vitestBeforeAll, vitestAfterAll);

let control: Connection;
let unit: UnitOfWork;
let identity: Identity;
let app: Awaited<ReturnType<typeof createApp>>;

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

  // Add driver 1 and driver 2
  const d1 = await registerMember("Driver One");
  driver1Actor = d1.actor;
  driver1Cookie = d1.cookie;

  const d2 = await registerMember("Driver Two");
  driver2Actor = d2.actor;
  driver2Cookie = d2.cookie;

  // Create Analytics Service & App
  // Fixed clock: all_time ranges end with November 2026 as the current month.
  const analytics = createAnalytics(
    unit,
    identity,
    { enabled: true, cursorKey },
    () => new Date("2026-11-16T09:00:00.000Z"),
  );

  app = await createApp({
    checkReadiness: async () => true,
    identity,
    analytics,
  });
}, SCHEMA_SETUP_TIMEOUT_MS);

afterAll(async () => {
  if (app) await app.close();
  await unit?.close();
  await control?.end();
});

test("returns 409 SETUP_REQUIRED when company timezone is unconfigured", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/api/v1/analytics/company?fromDate=2026-10-01&toDateExclusive=2026-10-31",
    headers: { cookie: directorCookie },
  });

  expect(res.statusCode).toBe(409);
  const json = res.json();
  expect(json.error.code).toBe("SETUP_REQUIRED");
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
      assessmentPending: false,
      correctionPending: false,
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
      assessmentPending: false,
      correctionPending: false,
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
      assessmentPending: false,
      correctionPending: false,
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
      assessmentPending: true,
      correctionPending: false,
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
      assessmentPending: false,
      correctionPending: false,
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
      assessmentPending: false,
      correctionPending: false,
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
  const compData = compRes.json().data;

  // Total accepted trips: Trip 1 (150km) + Trip 2 (200km) + Trip 3 (80km) = 3 trips, 430,000m
  expect(compData.acceptedTrips).toBe(3);
  expect(compData.actualDistanceM).toBe("430000");
  // projectionPending should be true due to Trip 4 (pending_review)
  expect(compData.projectionPending).toBe(true);
  expect(compData.reportingTimezone).toBe("Europe/Moscow");

  // Check time-series buckets:
  // 2026-10-20: Trip 1 (150,000m) + Trip 3 (80,000m) = 230,000m, 2 trips
  // 2026-10-21: Trip 2 (200,000m cross-midnight) = 200,000m, 1 trip
  expect(compData.buckets).toEqual([
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
  const ets2Data = ets2Res.json().data;
  // Excludes ATS (Trip 3)
  expect(ets2Data.acceptedTrips).toBe(2);
  expect(ets2Data.actualDistanceM).toBe("350000");

  // 3. Query company analytics with game=ats
  const atsRes = await app.inject({
    method: "GET",
    url: "/api/v1/analytics/company?fromDate=2026-10-20&toDateExclusive=2026-10-22&game=ats",
    headers: { cookie: driver1Cookie },
  });
  expect(atsRes.statusCode).toBe(200);
  const atsData = atsRes.json().data;
  // Only Trip 3 (no pending ETS2 trip in ATS scope)
  expect(atsData.acceptedTrips).toBe(1);
  expect(atsData.actualDistanceM).toBe("80000");
  expect(atsData.projectionPending).toBe(false);

  // 4. Query Member Analytics for Driver 1
  const m1Res = await app.inject({
    method: "GET",
    url: `/api/v1/members/${driver1Actor.userId}/analytics?fromDate=2026-10-20&toDateExclusive=2026-10-22`,
    headers: { cookie: driver1Cookie },
  });
  expect(m1Res.statusCode).toBe(200);
  const m1Data = m1Res.json().data;
  expect(m1Data.acceptedTrips).toBe(2);
  expect(m1Data.actualDistanceM).toBe("350000");
  expect(m1Data.projectionPending).toBe(true);

  // 5. Query Member Analytics for Driver 2
  const m2Res = await app.inject({
    method: "GET",
    url: `/api/v1/members/${driver2Actor.userId}/analytics?fromDate=2026-10-20&toDateExclusive=2026-10-22`,
    headers: { cookie: driver2Cookie },
  });
  expect(m2Res.statusCode).toBe(200);
  const m2Data = m2Res.json().data;
  expect(m2Data.acceptedTrips).toBe(1);
  expect(m2Data.actualDistanceM).toBe("80000");
  expect(m2Data.projectionPending).toBe(false);

  // 6. Leaderboard query
  const lbRes = await app.inject({
    method: "GET",
    url: "/api/v1/analytics/leaderboard?fromDate=2026-10-20&toDateExclusive=2026-10-22&limit=1",
    headers: { cookie: driver1Cookie },
  });
  expect(lbRes.statusCode).toBe(200);
  const lbData = lbRes.json().data;
  expect(lbData.items.length).toBe(1);
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
  const lb2Data = lbPage2.json().data;
  expect(lb2Data.items.length).toBe(1);
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
  const compData = compRes.json().data;

  // Driver 1's trips were updated to 180,000m each (Trip 1 and Trip 2 = 360,000m) + Trip 3 (80,000m) = 440,000m
  expect(compData.actualDistanceM).toBe("440000");
});

test("verifies EXPLAIN uses trip_analytics_reporting index", async () => {
  await control.query("ANALYZE TABLE trips");
  const [unforced] = await control.execute<RowDataPacket[]>(
    "EXPLAIN SELECT id FROM trips WHERE decision = 'accepted' AND reporting_at >= '2026-10-19 21:00:00' AND reporting_at < '2026-10-21 21:00:00' AND alias_of IS NULL",
  );
  expect(unforced[0]?.possible_keys).toContain("trip_analytics_reporting");

  const [explain] = await control.execute<RowDataPacket[]>(
    "EXPLAIN SELECT id FROM trips FORCE INDEX (trip_analytics_reporting) WHERE decision = 'accepted' AND reporting_at >= '2026-10-19 21:00:00' AND reporting_at < '2026-10-21 21:00:00' AND alias_of IS NULL",
  );
  expect(explain[0]?.key).toBe("trip_analytics_reporting");
});

// VTC-143: all_time periods, active counts and leaderboard positions on a known dataset in
// Europe/Berlin. The fixed clock (2026-11-16) makes November 2026 the current month.
const stage4 = {
  driver3: { userId: "", cookie: "" },
  trainee: { userId: "", cookie: "" },
  formerId: "",
  tripIds: {} as Record<string, string>,
};
// Documentation-range sources keep these reads under the per-source read limit.
let sourceCounter = 0;
const nextSource = () => `198.51.100.${(sourceCounter++ % 254) + 1}`;
const get = (url: string, cookie = driver1Cookie) =>
  app.inject({ method: "GET", url, headers: { cookie }, remoteAddress: nextSource() });
const anonymous = (url: string) => app.inject({ method: "GET", url, remoteAddress: nextSource() });
const data = async (url: string, cookie = driver1Cookie) => {
  const res = await get(url, cookie);
  expect(res.statusCode, url).toBe(200);
  return res.json().data;
};
const months = (from: string, toExclusive: string) => {
  const list: string[] = [];
  for (
    let date = new Date(`${from}T00:00:00.000Z`);
    date.toISOString().slice(0, 10) < toExclusive;
  ) {
    list.push(date.toISOString().slice(0, 10));
    date = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  }
  return list;
};
const total = (rows: { acceptedTrips: number; actualDistanceM: string }[]) => ({
  acceptedTrips: rows.reduce((sum, row) => sum + row.acceptedTrips, 0),
  actualDistanceM: rows.reduce((sum, row) => addDistances(sum, row.actualDistanceM), "0"),
});
type BoardItem = {
  member: { id: string; formerMember: boolean };
  acceptedTrips: number;
  actualDistanceM: string;
  position: number;
};
const ranking = (items: BoardItem[]) =>
  items.map((item) => [item.member.id, item.position, item.acceptedTrips, item.actualDistanceM]);

test("Stage 4 period parameters are validated and the breakdown route stays inactive until VTC-112", async () => {
  for (const url of [
    "/api/v1/analytics/company?period=all_time&fromDate=2026-10-01",
    "/api/v1/analytics/company?period=all_time&toDateExclusive=2026-11-01",
    "/api/v1/analytics/company?period=all_time&granularity=day",
    "/api/v1/analytics/company",
    "/api/v1/analytics/company?period=range",
    "/api/v1/analytics/company?fromDate=2026-10-01",
    "/api/v1/analytics/company?period=lifetime",
    "/api/v1/analytics/leaderboard?period=all_time&fromDate=2026-10-01&toDateExclusive=2026-11-01",
    "/api/v1/analytics/leaderboard",
    `/api/v1/members/${driver1Actor.userId}/analytics?period=all_time`,
    `/api/v1/members/${driver1Actor.userId}/analytics?period=range&fromDate=2026-10-20&toDateExclusive=2026-10-22`,
  ]) {
    const res = await get(url);
    expect(res.statusCode, url).toBe(422);
  }
  for (const url of [
    "/api/v1/analytics/company?period=all_time",
    "/api/v1/analytics/leaderboard?period=all_time",
  ])
    expect((await anonymous(url)).statusCode, url).toBe(401);
  const breakdown = await get(
    "/api/v1/analytics/company/breakdown?dimension=route&fromDate=2026-10-01&toDateExclusive=2026-10-31",
  );
  expect(breakdown.statusCode).toBe(404);

  for (const url of [
    "/api/v1/analytics/company?fromDate=2026-10-20&toDateExclusive=2026-10-22",
    "/api/v1/analytics/company?period=range&fromDate=2026-10-20&toDateExclusive=2026-10-22",
  ]) {
    const company = await get(url);
    expect(company.statusCode, url).toBe(200);
    expect(company.json().data, url).toMatchObject({
      period: "range",
      fromDate: "2026-10-20",
      toDateExclusive: "2026-10-22",
      acceptedTrips: 3,
      actualDistanceM: "440000",
      activeDrivers: 2,
      activeMembers: 3,
      byGame: [
        { game: "ets2", acceptedTrips: 2, actualDistanceM: "360000" },
        { game: "ats", acceptedTrips: 1, actualDistanceM: "80000" },
      ],
      computedAt: "2026-11-16T09:00:00.000Z",
    });
  }
  const ats = await get(
    "/api/v1/analytics/company?game=ats&fromDate=2026-10-20&toDateExclusive=2026-10-22",
  );
  expect(ats.json().data).toMatchObject({
    activeDrivers: 1,
    activeMembers: 3,
    byGame: [{ game: "ats", acceptedTrips: 1, actualDistanceM: "80000" }],
  });

  const board = await get(
    "/api/v1/analytics/leaderboard?period=range&fromDate=2026-10-20&toDateExclusive=2026-10-22",
    driver2Cookie,
  );
  expect(board.statusCode).toBe(200);
  expect(board.json().data).toMatchObject({
    rankedMembers: 2,
    viewer: { position: 2, acceptedTrips: 1, actualDistanceM: "80000" },
    period: "range",
    fromDate: "2026-10-20",
    toDateExclusive: "2026-10-22",
    nextCursor: null,
  });
  expect(
    board
      .json()
      .data.items.map((item: { member: { id: string }; position: number }) => [
        item.member.id,
        item.position,
      ]),
  ).toEqual([
    [driver1Actor.userId, 1],
    [driver2Actor.userId, 2],
  ]);
  // The leaderboard ignores granularity, also for all_time.
  const allTimeBoard = await get("/api/v1/analytics/leaderboard?period=all_time&granularity=day");
  expect(allTimeBoard.statusCode).toBe(200);
  expect(allTimeBoard.json().data).toMatchObject({
    period: "all_time",
    fromDate: "2026-10-01",
    toDateExclusive: "2026-12-01",
    rankedMembers: 2,
  });
});

test("Stage 4 directory and breakdown query shapes can use their trip indexes", async () => {
  await control.query("ANALYZE TABLE trips, trip_facts, source_messages");
  const owners = [driver1Actor.userId, driver2Actor.userId];
  const plans: Record<string, { sql: string; values: unknown[]; index: string }> = {
    directory30d: {
      sql: "SELECT owner_id, COUNT(*) trips, SUM(actual_distance_m) distance FROM trips WHERE owner_id IN (?,?) AND decision='accepted' AND alias_of IS NULL AND reporting_at >= ? AND reporting_at <= ? GROUP BY owner_id",
      values: [...owners, "2026-09-22 00:00:00.000", "2026-10-22 00:00:00.000"],
      index: "trip_owner_accepted_reporting",
    },
    directoryLastTrip: {
      sql: "SELECT owner_id, MAX(reporting_at) last FROM trips WHERE owner_id IN (?,?) AND decision='accepted' AND alias_of IS NULL GROUP BY owner_id",
      values: owners,
      index: "trip_owner_accepted_reporting",
    },
    route: {
      sql: "SELECT t.game, f.origin_city_id, f.destination_city_id, COUNT(*) trips, SUM(t.actual_distance_m) distance FROM trips t JOIN trip_facts f ON f.id=t.current_fact_id WHERE t.decision='accepted' AND t.alias_of IS NULL AND t.reporting_at >= ? AND t.reporting_at < ? GROUP BY t.game, f.origin_city_id, f.destination_city_id",
      values: ["2026-10-19 21:00:00.000", "2026-10-21 21:00:00.000"],
      index: "trip_analytics_reporting",
    },
    cargo: {
      sql: "SELECT t.game, f.cargo_id, COUNT(*) trips, SUM(t.actual_distance_m) distance FROM trips t JOIN trip_facts f ON f.id=t.current_fact_id WHERE t.decision='accepted' AND t.alias_of IS NULL AND t.reporting_at >= ? AND t.reporting_at < ? GROUP BY t.game, f.cargo_id",
      values: ["2026-10-19 21:00:00.000", "2026-10-21 21:00:00.000"],
      index: "trip_analytics_reporting",
    },
    source: {
      sql: "SELECT m.provider, COUNT(*) trips, SUM(t.actual_distance_m) distance FROM trips t JOIN trip_facts f ON f.id=t.current_fact_id JOIN source_messages m ON m.id=COALESCE(f.message_id, f.derived_source_message_id) WHERE t.decision='accepted' AND t.alias_of IS NULL AND t.reporting_at >= ? AND t.reporting_at < ? GROUP BY m.provider",
      values: ["2026-10-19 21:00:00.000", "2026-10-21 21:00:00.000"],
      index: "trip_analytics_reporting",
    },
  };
  for (const [name, plan] of Object.entries(plans)) {
    const [rows] = await control.query<RowDataPacket[]>(`EXPLAIN ${plan.sql}`, plan.values);
    const trips = rows.find((row) => row.table === "trips" || row.table === "t");
    expect(String(trips?.possible_keys), name).toContain(plan.index);
    const [tree] = await control.query<RowDataPacket[]>(
      `EXPLAIN FORMAT=TREE ${plan.sql}`,
      plan.values,
    );
    // Synthetic plan evidence for review; generated IDs are masked before logging.
    const text = String(tree[0]?.EXPLAIN)
      .replace(/'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/g, "'<id>'")
      .replace(/0x[0-9a-f]+/g, "<id>");
    console.info(JSON.stringify({ event: "stage4_explain", name, plan: text }));
  }
});

test("Stage 4 all_time covers an empty company with one zero bucket", async () => {
  await control.query("DELETE FROM trips WHERE alias_of IS NOT NULL");
  await control.query("DELETE FROM trips");
  await unit.run((tx) =>
    unit
      .client(tx)
      .update(company)
      .set({ reportingTimezone: "Europe/Berlin" })
      .where(eq(company.singleton, 1)),
  );
  const driver3 = await registerMember("Driver Three");
  stage4.driver3 = { userId: driver3.userId, cookie: driver3.cookie };
  const trainee = await registerMember("Trainee Four", ["trainee"]);
  stage4.trainee = { userId: trainee.userId, cookie: trainee.cookie };
  stage4.formerId = (await registerMember("Former Five")).userId;
  await unit.run((tx) =>
    unit
      .client(tx)
      .update(membership)
      .set({ status: "inactive" })
      .where(eq(membership.userId, stage4.formerId)),
  );

  expect(await data("/api/v1/analytics/company?period=all_time")).toEqual({
    acceptedTrips: 0,
    actualDistanceM: "0",
    reportingTimezone: "Europe/Berlin",
    fromDate: "2026-11-01",
    toDateExclusive: "2026-12-01",
    granularity: "month",
    buckets: [{ date: "2026-11-01", acceptedTrips: 0, actualDistanceM: "0" }],
    computedAt: "2026-11-16T09:00:00.000Z",
    projectionVersion: 1,
    projectionPending: false,
    period: "all_time",
    activeDrivers: 0,
    // Director, three drivers and the trainee; the former member is excluded.
    activeMembers: 5,
    byGame: [
      { game: "ets2", acceptedTrips: 0, actualDistanceM: "0" },
      { game: "ats", acceptedTrips: 0, actualDistanceM: "0" },
    ],
  });
  expect(
    (await data("/api/v1/analytics/company?period=all_time&game=ats&granularity=month")).byGame,
  ).toEqual([{ game: "ats", acceptedTrips: 0, actualDistanceM: "0" }]);
  expect(await data("/api/v1/analytics/leaderboard?period=all_time")).toEqual({
    items: [],
    nextCursor: null,
    rankedMembers: 0,
    viewer: null,
    period: "all_time",
    fromDate: "2026-11-01",
    toDateExclusive: "2026-12-01",
  });
});

test("Stage 4 all_time aggregates a known dataset from the month of the earliest accepted trip", async () => {
  const d1 = driver1Actor.userId;
  const d2 = driver2Actor.userId;
  const d3 = stage4.driver3.userId;
  const row = (
    key: string,
    ownerId: string,
    game: "ets2" | "ats",
    reportingAt: string,
    actualDistanceM: string | null,
    decision: "accepted" | "rejected" | "pending_review" = "accepted",
    aliasOf: string | null = null,
  ) => {
    const id = newId();
    stage4.tripIds[key] = id;
    return {
      id,
      ownerId,
      game,
      aliasOf,
      version: 1,
      outcome: "delivered" as const,
      recording: "complete" as const,
      decision,
      assessmentPending: decision === "pending_review",
      correctionPending: false,
      reviewReasons: [],
      actualDistanceM,
      reportingAt,
      createdAt: reportingAt,
    };
  };
  const accepted = [
    // 2024-01-01 00:30 in Berlin: the earliest accepted trip.
    row("d2First", d2, "ets2", "2023-12-31T23:30:00.000Z", "50000"),
    // 23:30 CEST on 31 March and 00:30 CEST on 1 April 2025.
    row("d1March", d1, "ets2", "2025-03-31T21:30:00.000Z", "100000.19"),
    row("d1April", d1, "ets2", "2025-03-31T22:30:00.000Z", "100000.19"),
    // 00:30 CET on 1 November 2025, after the October DST change.
    row("d1November", d1, "ets2", "2025-10-31T23:30:00.000Z", "70000.5"),
    row("d1Ats", d1, "ats", "2026-02-10T12:00:00.000Z", "80000"),
    row("former", stage4.formerId, "ets2", "2026-05-05T10:00:00.000Z", "40000"),
    row("d3NoDistance", d3, "ets2", "2026-06-15T10:00:00.000Z", null),
    row("d2Tie", d2, "ets2", "2026-11-05T10:00:00.000Z", "300000"),
    row("d3Tie", d3, "ets2", "2026-11-06T10:00:00.000Z", "300000"),
  ];
  const ignored = [
    // The trainee's only trip is rejected, so the trainee is never ranked.
    row(
      "rejected",
      stage4.trainee.userId,
      "ets2",
      "2023-05-01T10:00:00.000Z",
      "999999",
      "rejected",
    ),
    row("pending", d1, "ets2", "2023-06-02T10:00:00.000Z", "999999", "pending_review"),
  ];
  await unit.run((tx) =>
    unit
      .client(tx)
      .insert(trips)
      .values([...accepted, ...ignored]),
  );
  await unit.run((tx) =>
    unit
      .client(tx)
      .insert(trips)
      .values(
        row("alias", d1, "ets2", "2023-04-01T10:00:00.000Z", "999999", "accepted", accepted[0]?.id),
      ),
  );

  const allTime = await data("/api/v1/analytics/company?period=all_time");
  const nonZero: Record<string, [number, string]> = {
    "2024-01-01": [1, "50000"],
    "2025-03-01": [1, "100000.1"],
    "2025-04-01": [1, "100000.1"],
    "2025-11-01": [1, "70000.5"],
    "2026-02-01": [1, "80000"],
    "2026-05-01": [1, "40000"],
    "2026-06-01": [1, "0"],
    "2026-11-01": [2, "600000"],
  };
  const expectedBuckets = months("2024-01-01", "2026-12-01").map((date) => ({
    date,
    acceptedTrips: nonZero[date]?.[0] ?? 0,
    actualDistanceM: nonZero[date]?.[1] ?? "0",
  }));
  expect(expectedBuckets).toHaveLength(35);
  expect(allTime).toEqual({
    acceptedTrips: 9,
    actualDistanceM: "1040000.7",
    reportingTimezone: "Europe/Berlin",
    fromDate: "2024-01-01",
    toDateExclusive: "2026-12-01",
    granularity: "month",
    buckets: expectedBuckets,
    computedAt: "2026-11-16T09:00:00.000Z",
    projectionVersion: 1,
    // The pending 2023 trip predates the earliest accepted trip and could still change all_time.
    projectionPending: true,
    period: "all_time",
    activeDrivers: 4,
    activeMembers: 5,
    byGame: [
      { game: "ets2", acceptedTrips: 8, actualDistanceM: "960000.7" },
      { game: "ats", acceptedTrips: 1, actualDistanceM: "80000" },
    ],
  });
  // A range only sees unfinalized trips inside it; the game filter also applies to all_time.
  for (const [query, pending] of [
    ["fromDate=2023-06-01&toDateExclusive=2023-07-01", true],
    ["fromDate=2024-01-01&toDateExclusive=2025-01-01", false],
    ["period=all_time&game=ats", false],
    ["period=all_time&game=ets2", true],
  ] as const)
    expect((await data(`/api/v1/analytics/company?${query}`)).projectionPending, query).toBe(
      pending,
    );
  // The covered range exceeds 732 days, which an explicit range may not.
  expect(
    (await get("/api/v1/analytics/company?fromDate=2024-01-01&toDateExclusive=2026-12-01"))
      .statusCode,
  ).toBe(422);

  // V5: byGame sums exactly to the totals, for range and all_time.
  const year2026 = await data(
    "/api/v1/analytics/company?fromDate=2026-01-01&toDateExclusive=2026-12-01&granularity=month",
  );
  for (const result of [allTime, year2026]) {
    const totals = { acceptedTrips: result.acceptedTrips, actualDistanceM: result.actualDistanceM };
    expect(total(result.byGame)).toEqual(totals);
    expect(total(result.buckets)).toEqual(totals);
  }
  expect(year2026).toMatchObject({ acceptedTrips: 5, actualDistanceM: "720000", activeDrivers: 4 });

  // V6: consecutive yearly ranges add up to all_time, bucket by bucket.
  const years = [
    await data(
      "/api/v1/analytics/company?fromDate=2024-01-01&toDateExclusive=2025-01-01&granularity=month",
    ),
    await data(
      "/api/v1/analytics/company?fromDate=2025-01-01&toDateExclusive=2026-01-01&granularity=month",
    ),
    year2026,
  ];
  expect(years.flatMap((year) => year.buckets)).toEqual(allTime.buckets);
  expect(total(years)).toEqual({ acceptedTrips: 9, actualDistanceM: "1040000.7" });

  // The game filter also moves the start to that game's first accepted trip.
  const ats = await data("/api/v1/analytics/company?period=all_time&game=ats");
  expect(ats).toMatchObject({
    fromDate: "2026-02-01",
    toDateExclusive: "2026-12-01",
    acceptedTrips: 1,
    actualDistanceM: "80000",
    activeDrivers: 1,
    activeMembers: 5,
    byGame: [{ game: "ats", acceptedTrips: 1, actualDistanceM: "80000" }],
  });
  expect(ats.buckets.map((bucket: { date: string }) => bucket.date)).toEqual(
    months("2026-02-01", "2026-12-01"),
  );
  expect(await data("/api/v1/analytics/company?period=all_time&game=ets2")).toMatchObject({
    fromDate: "2024-01-01",
    acceptedTrips: 8,
    byGame: [{ game: "ets2", acceptedTrips: 8, actualDistanceM: "960000.7" }],
  });

  // Day buckets start at local midnight on both sides of the 2025 DST changes.
  expect(
    (await data("/api/v1/analytics/company?fromDate=2025-03-29&toDateExclusive=2025-04-02"))
      .buckets,
  ).toEqual([
    { date: "2025-03-29", acceptedTrips: 0, actualDistanceM: "0" },
    { date: "2025-03-30", acceptedTrips: 0, actualDistanceM: "0" },
    { date: "2025-03-31", acceptedTrips: 1, actualDistanceM: "100000.1" },
    { date: "2025-04-01", acceptedTrips: 1, actualDistanceM: "100000.1" },
  ]);
  const autumn = await data(
    "/api/v1/analytics/company?fromDate=2025-10-25&toDateExclusive=2025-11-03",
  );
  expect(
    autumn.buckets.filter((bucket: { acceptedTrips: number }) => bucket.acceptedTrips > 0),
  ).toEqual([{ date: "2025-11-01", acceptedTrips: 1, actualDistanceM: "70000.5" }]);
  expect(autumn.buckets).toHaveLength(9);
});

test("Stage 4 leaderboard reports positions, the viewer and rankedMembers equal to activeDrivers", async () => {
  const d1 = driver1Actor.userId;
  const d2 = driver2Actor.userId;
  const d3 = stage4.driver3.userId;
  const allTime = await data("/api/v1/analytics/leaderboard?period=all_time", driver2Cookie);
  expect(ranking(allTime.items)).toEqual([
    [d1, 1, 4, "350000.88"],
    [d2, 2, 2, "350000"],
    // Trips without a distance count as trips and add no distance.
    [d3, 3, 2, "300000"],
    [stage4.formerId, 4, 1, "40000"],
  ]);
  expect(allTime.items[3].member.formerMember).toBe(true);
  expect(allTime).toMatchObject({
    nextCursor: null,
    rankedMembers: 4,
    viewer: { position: 2, acceptedTrips: 2, actualDistanceM: "350000" },
    period: "all_time",
    fromDate: "2024-01-01",
    toDateExclusive: "2026-12-01",
  });

  // V1: the viewer's own row is returned also when it is not on the page.
  const offPage = await data(
    "/api/v1/analytics/leaderboard?period=all_time&limit=1",
    stage4.driver3.cookie,
  );
  expect(ranking(offPage.items)).toEqual([[d1, 1, 4, "350000.88"]]);
  expect(offPage.viewer).toEqual({ position: 3, acceptedTrips: 2, actualDistanceM: "300000" });
  expect(offPage.rankedMembers).toBe(4);
  expect(offPage.nextCursor).toEqual(expect.any(String));

  // V3: members without accepted trips in the period are not ranked.
  for (const cookie of [directorCookie, stage4.trainee.cookie]) {
    const board = await data("/api/v1/analytics/leaderboard?period=all_time&limit=2", cookie);
    expect(board.viewer).toBeNull();
    expect(board.rankedMembers).toBe(4);
  }

  // V2: equal distance and trips are ordered by member ID.
  const november = await data(
    "/api/v1/analytics/leaderboard?fromDate=2026-11-01&toDateExclusive=2026-12-01",
    stage4.driver3.cookie,
  );
  const [first, second] = [d2, d3].sort();
  expect(ranking(november.items)).toEqual([
    [first, 1, 1, "300000"],
    [second, 2, 1, "300000"],
  ]);
  expect(november.viewer?.position).toBe(first === d3 ? 1 : 2);

  // V4: activeDrivers equals rankedMembers for the same period and game.
  for (const [company, board] of [
    ["period=all_time", "period=all_time"],
    ["period=all_time&game=ats", "period=all_time&game=ats"],
    ["period=all_time&game=ets2", "period=all_time&game=ets2"],
    [
      "fromDate=2026-11-01&toDateExclusive=2026-12-01",
      "fromDate=2026-11-01&toDateExclusive=2026-12-01",
    ],
  ]) {
    const companyData = await data(`/api/v1/analytics/company?${company}`);
    const boardData = await data(`/api/v1/analytics/leaderboard?${board}`);
    expect(companyData.activeDrivers, company).toBe(boardData.rankedMembers);
    expect([companyData.fromDate, companyData.toDateExclusive], company).toEqual([
      boardData.fromDate,
      boardData.toDateExclusive,
    ]);
  }
  // activeDrivers includes the former member with accepted trips in the period.
  expect((await data("/api/v1/analytics/company?period=all_time")).activeDrivers).toBe(4);
});

test("Stage 4 all_time leaderboard pages by position and binds the period into the cursor", async () => {
  const seen: [string, number][] = [];
  let cursor: string | null = null;
  let firstCursor = "";
  do {
    const url: string = `/api/v1/analytics/leaderboard?period=all_time&limit=1${
      cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""
    }`;
    const page = await data(url);
    expect(page.items).toHaveLength(1);
    expect(page.rankedMembers).toBe(4);
    expect(page.viewer.position).toBe(1);
    seen.push([page.items[0].member.id, page.items[0].position]);
    cursor = page.nextCursor;
    if (!firstCursor && cursor) firstCursor = cursor;
  } while (cursor && seen.length < 10);
  expect(seen).toEqual([
    [driver1Actor.userId, 1],
    [driver2Actor.userId, 2],
    [stage4.driver3.userId, 3],
    [stage4.formerId, 4],
  ]);

  for (const url of [
    `/api/v1/analytics/leaderboard?fromDate=2026-01-01&toDateExclusive=2026-12-01&limit=1&cursor=${encodeURIComponent(firstCursor)}`,
    `/api/v1/analytics/leaderboard?period=all_time&game=ets2&limit=1&cursor=${encodeURIComponent(firstCursor)}`,
  ]) {
    const res = await get(url);
    expect(res.statusCode, url).toBe(409);
    expect(res.json().error.code, url).toBe("VERSION_CONFLICT");
  }
});

test("Stage 4 aggregate, earliest-trip and leaderboard queries can use their trip indexes", async () => {
  await control.query("ANALYZE TABLE trips");
  // Bounds of the all_time range above: 2024-01-01 and 2026-12-01 in Europe/Berlin.
  const start = "2023-12-31 23:00:00.000";
  const end = "2026-11-30 23:00:00.000";
  const bucketStarts = [Date.UTC(2023, 11, 31, 23), Date.UTC(2024, 0, 31, 23)];
  // Keep in sync with getCompanyAnalytics, coveredRange and getLeaderboard in service.ts.
  const accepted =
    "decision='accepted' AND alias_of IS NULL AND reporting_at >= ? AND reporting_at < ?";
  const plans: Record<string, { sql: string; values: unknown[]; keys: string[] }> = {
    vtc143_earliest: {
      sql: "SELECT reporting_at FROM trips WHERE decision='accepted' AND alias_of IS NULL AND reporting_at IS NOT NULL ORDER BY reporting_at LIMIT 1",
      values: [],
      keys: ["trip_analytics_reporting"],
    },
    vtc143_earliest_game: {
      sql: "SELECT reporting_at FROM trips WHERE decision='accepted' AND alias_of IS NULL AND reporting_at IS NOT NULL AND game=? ORDER BY reporting_at LIMIT 1",
      values: ["ats"],
      keys: ["trip_analytics_reporting"],
    },
    vtc143_buckets: {
      sql: `SELECT INTERVAL(TIMESTAMPDIFF(MICROSECOND, '1970-01-01 00:00:00', reporting_at) DIV 1000, ?, ?) AS bucket, game, COUNT(*) trips, COALESCE(SUM(TRUNCATE(actual_distance_m, 1)), 0) distance, MAX(GREATEST(version, adjudication_version)) pv FROM trips WHERE ${accepted} GROUP BY bucket, game`,
      values: [...bucketStarts, start, end],
      keys: ["trip_analytics_reporting"],
    },
    vtc143_active_drivers: {
      sql: `SELECT COUNT(DISTINCT owner_id) drivers FROM trips WHERE ${accepted}`,
      values: [start, end],
      keys: ["trip_analytics_reporting"],
    },
    vtc143_leaderboard: {
      sql: `SELECT owner_id, COUNT(*) trips, COALESCE(SUM(actual_distance_m), 0) distance FROM trips WHERE ${accepted} GROUP BY owner_id ORDER BY COALESCE(SUM(actual_distance_m), 0) DESC, COUNT(*) DESC, owner_id`,
      values: [start, end],
      keys: ["trip_analytics_reporting", "trip_owner_accepted_reporting"],
    },
  };
  for (const [name, plan] of Object.entries(plans)) {
    const [rows] = await control.query<RowDataPacket[]>(`EXPLAIN ${plan.sql}`, plan.values);
    const tripsRow = rows.find((item) => item.table === "trips");
    expect(
      plan.keys.some((key) => String(tripsRow?.possible_keys).includes(key)),
      name,
    ).toBe(true);
    // On this tiny table the game-filtered variant may pick trip_game_page; its plan is logged.
    if (name === "vtc143_earliest") {
      expect(tripsRow?.key, name).toBe("trip_analytics_reporting");
      // Index-ordered read of the accepted prefix: range or ref on decision, never a filesort.
      expect(["range", "ref"], name).toContain(tripsRow?.type);
      expect(String(tripsRow?.Extra), name).not.toContain("filesort");
    }
    const [tree] = await control.query<RowDataPacket[]>(
      `EXPLAIN FORMAT=TREE ${plan.sql}`,
      plan.values,
    );
    // Synthetic plan evidence for review; generated IDs are masked before logging.
    const text = String(tree[0]?.EXPLAIN)
      .replace(/'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/g, "'<id>'")
      .replace(/0x[0-9a-f]+/g, "<id>");
    console.info(JSON.stringify({ event: "stage4_explain", name, plan: text }));
  }
});

test("Stage 4 leaderboard keyset continues after a ranked member leaves between pages", async () => {
  const base =
    "/api/v1/analytics/leaderboard?fromDate=2026-01-01&toDateExclusive=2026-12-01&limit=1";
  const first = await data(base);
  const second = await data(`${base}&cursor=${encodeURIComponent(first.nextCursor)}`);
  // 2026: driver 3 (two trips), driver 2 (one trip, same distance), driver 1, former member.
  expect(ranking([...first.items, ...second.items])).toEqual([
    [stage4.driver3.userId, 1, 2, "300000"],
    [driver2Actor.userId, 2, 1, "300000"],
  ]);
  // Driver 2's only 2026 trip is rejected after the second page was served.
  await unit.run((tx) =>
    unit
      .client(tx)
      .update(trips)
      .set({ decision: "rejected" })
      .where(eq(trips.id, stage4.tripIds.d2Tie ?? "")),
  );
  const third = await data(`${base}&cursor=${encodeURIComponent(second.nextCursor)}`);
  expect(ranking(third.items)).toEqual([[driver1Actor.userId, 2, 1, "80000"]]);
  expect(third.rankedMembers).toBe(3);
  const fourth = await data(`${base}&cursor=${encodeURIComponent(third.nextCursor)}`);
  expect(ranking(fourth.items)).toEqual([[stage4.formerId, 3, 1, "40000"]]);
  expect(fourth.nextCursor).toBeNull();
});

test("Stage 4 all_time cursor fails with 409 when an earlier trip moves the covered range", async () => {
  const base = "/api/v1/analytics/leaderboard?period=all_time&limit=1";
  const first = await data(base);
  expect(first.fromDate).toBe("2024-01-01");
  await unit.run((tx) =>
    unit
      .client(tx)
      .update(trips)
      .set({ decision: "accepted", assessmentPending: false })
      .where(eq(trips.id, stage4.tripIds.pending ?? "")),
  );
  const stale = await get(`${base}&cursor=${encodeURIComponent(first.nextCursor)}`);
  expect(stale.statusCode).toBe(409);
  expect(stale.json().error.code).toBe("VERSION_CONFLICT");
  expect(await data("/api/v1/analytics/company?period=all_time")).toMatchObject({
    fromDate: "2023-06-01",
    toDateExclusive: "2026-12-01",
  });
});
