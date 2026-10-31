import { randomBytes } from "node:crypto";
import {
  createUnitOfWork,
  dedicatedConnection,
  newId,
  runMigrations,
  type UnitOfWork,
} from "@vtc/db";
import { company, membership } from "@vtc/db/identity-schema";
import { eq, trips } from "@vtc/db/trips-schema";
import type { Connection, RowDataPacket } from "mysql2/promise";
import { expect, test, afterAll as vitestAfterAll, beforeAll as vitestBeforeAll } from "vitest";
import { createApp } from "../../apps/api/src/app.ts";
import { createAnalytics } from "../../apps/api/src/modules/analytics/service.ts";
import { createIdentity, type Identity } from "../../apps/api/src/modules/identity/service.ts";
import { identityAccessEvents } from "../../apps/api/src/platform/outbox/events.ts";
import {
  guardedSettings,
  reset,
  SCHEMA_SETUP_TIMEOUT_MS,
  testConnection,
} from "../persistence/support.ts";
import { schemaLifecycleHooks } from "../support/schema-lifecycle.ts";

const { beforeAll, afterAll } = schemaLifecycleHooks(vitestBeforeAll, vitestAfterAll);

const path = "/api/v1/public/company-stats";
const password = "Fictional-public-stats-password-42";
const cursorKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

// Independent clocks: the identity clock drives rate-limit windows (real time unless pinned),
// the stats clock selects the reporting month. Sessions keep using real time.
let identityNow: Date | null = null;
let statsNow = new Date("2026-10-15T12:00:00.000Z");

let control: Connection;
let unit: UnitOfWork;
let identity: Identity;
let app: Awaited<ReturnType<typeof createApp>>;
let fallbackApp: Awaited<ReturnType<typeof createApp>>;
let directorId: string;
let directorCookie: string;
const fixtureIds: string[] = [];
const fixtureNames: string[] = [];
const fixtureEmails: string[] = [];
const members: Record<string, string> = {};

async function registerMember(
  name: string,
  roles: ("driver" | "trainee" | "dispatcher" | "deputy_director")[],
) {
  const userId = newId();
  const email = `${userId}@example.invalid`;
  const credential = await identity.prepareCredential(password);
  await unit.run((tx) =>
    identity.insertWithCredential(tx, { userId, email, name, ...credential, roles }),
  );
  fixtureIds.push(userId);
  fixtureNames.push(name);
  fixtureEmails.push(email);
  return userId;
}

async function get(url = path, headers: Record<string, string> = {}, remoteAddress?: string) {
  return app.inject({ method: "GET", url, headers, ...(remoteAddress ? { remoteAddress } : {}) });
}

function expectPublicHeaders(res: Awaited<ReturnType<typeof get>>) {
  expect(res.headers["cache-control"]).toBe("public, max-age=60");
  expect(res.headers["set-cookie"]).toBeUndefined();
  expect(res.headers.etag).toBeUndefined();
  expect(res.headers["x-content-type-options"]).toBe("nosniff");
}

function expectNoStoreError(res: Awaited<ReturnType<typeof get>>, status: number, code: string) {
  expect(res.statusCode).toBe(status);
  expect(res.headers["cache-control"]).toBe("no-store");
  expect(res.headers["set-cookie"]).toBeUndefined();
  expect(res.json().error.code).toBe(code);
}

type TripDecision = "unassessed" | "pending_review" | "accepted" | "rejected";
function trip(input: {
  ownerId: string;
  game: "ets2" | "ats";
  decision: TripDecision;
  reportingAt: string | null;
  actualDistanceM: string | null;
  aliasOf?: string | null;
  correctionPending?: boolean;
  reviewHold?: boolean;
}) {
  const id = newId();
  fixtureIds.push(id);
  return {
    id,
    ownerId: input.ownerId,
    game: input.game,
    aliasOf: input.aliasOf ?? null,
    version: input.correctionPending ? 2 : 1,
    outcome: "delivered" as const,
    recording: "complete" as const,
    decision: input.decision,
    assessmentPending: input.decision === "unassessed",
    correctionPending: input.correctionPending ?? false,
    reviewHold: input.reviewHold ?? false,
    reviewReasons: [],
    actualDistanceM: input.actualDistanceM,
    reportingAt: input.reportingAt,
    createdAt: "2026-10-01T00:00:00.000Z",
  };
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
    () => identityNow ?? new Date(),
  );
  app = await createApp({
    checkReadiness: async () => true,
    identity,
    analytics: createAnalytics(unit, identity, { enabled: true, cursorKey }, () => statsNow),
  });
  fallbackApp = await createApp({
    checkReadiness: async () => true,
    identity,
    analytics: createAnalytics(
      unit,
      identity,
      { enabled: true, cursorKey, reportingTimezone: "UTC" },
      () => statsNow,
    ),
  });
}, SCHEMA_SETUP_TIMEOUT_MS);

afterAll(async () => {
  if (app) await app.close();
  if (fallbackApp) await fallbackApp.close();
  await unit?.close();
  await control?.end();
});

test("I1: before company bootstrap the route is a no-store 409 SETUP_REQUIRED", async () => {
  const res = await get();
  expectNoStoreError(res, 409, "SETUP_REQUIRED");
});

test("I2: active memberships are counted and a missing timezone is unavailable, never zero", async () => {
  const directorEmail = "public-stats-director@example.invalid";
  const directorName = "Fictional Stats Director";
  directorId = (await identity.bootstrap({ email: directorEmail, name: directorName, password }))
    .userId;
  fixtureIds.push(directorId);
  fixtureNames.push(directorName);
  fixtureEmails.push(directorEmail);
  directorCookie = (await identity.login(directorEmail, password)).cookies
    .map((v) => v.split(";", 1)[0])
    .join("; ");
  members.driverA = await registerMember("Fictional Stats Driver A", ["driver"]);
  members.driverB = await registerMember("Fictional Stats Driver B", ["driver"]);
  members.trainee = await registerMember("Fictional Stats Trainee", ["trainee"]);
  members.roleless = await registerMember("Fictional Stats Roleless", []);
  members.inactive = await registerMember("Fictional Stats Former", ["driver"]);
  await unit.run((tx) =>
    unit
      .client(tx)
      .update(membership)
      .set({ status: "inactive" })
      .where(eq(membership.userId, members.inactive as string)),
  );

  const res = await get();
  expect(res.statusCode).toBe(200);
  expectPublicHeaders(res);
  expect(res.json().data).toEqual({
    computedAt: "2026-10-15T12:00:00.000Z",
    activeMembers: 5,
    currentMonth: { status: "unavailable", reason: "company_reporting_timezone" },
  });

  const fallback = await fallbackApp.inject({ method: "GET", url: path });
  expect(fallback.statusCode).toBe(200);
  expectPublicHeaders(fallback);
  expect(fallback.json().data).toEqual({
    computedAt: "2026-10-15T12:00:00.000Z",
    activeMembers: 5,
    currentMonth: {
      status: "available",
      month: "2026-10",
      reportingTimezone: "UTC",
      fromDate: "2026-10-01",
      toDateExclusive: "2026-11-01",
      acceptedTrips: 0,
      actualDistanceM: "0",
      games: [],
    },
  });
});

test("I3: only accepted canonical trips in the current Moscow month count, matching VTC-032", async () => {
  await unit.run((tx) =>
    unit
      .client(tx)
      .update(company)
      .set({ reportingTimezone: "Europe/Moscow" })
      .where(eq(company.singleton, 1)),
  );
  const driverA = members.driverA as string;
  const driverB = members.driverB as string;
  const t3 = trip({
    ownerId: driverB,
    game: "ats",
    decision: "accepted",
    reportingAt: "2026-11-10T10:00:00.000Z",
    actualDistanceM: "150000.05",
  });
  const rows = [
    // T1: last millisecond of October in Moscow.
    trip({
      ownerId: driverA,
      game: "ets2",
      decision: "accepted",
      reportingAt: "2026-10-31T20:59:59.999Z",
      actualDistanceM: "100000.5",
    }),
    // T2: first millisecond of November in Moscow; sub-tenth digits are truncated per trip.
    trip({
      ownerId: driverA,
      game: "ets2",
      decision: "accepted",
      reportingAt: "2026-10-31T21:00:00.000Z",
      actualDistanceM: "200000.25",
    }),
    t3,
    // T4-T6: rejected, pending review and unassessed never count.
    trip({
      ownerId: driverA,
      game: "ets2",
      decision: "rejected",
      reportingAt: "2026-11-11T10:00:00.000Z",
      actualDistanceM: "999000",
    }),
    trip({
      ownerId: driverA,
      game: "ets2",
      decision: "pending_review",
      reportingAt: "2026-11-12T10:00:00.000Z",
      actualDistanceM: "888000",
    }),
    trip({
      ownerId: driverB,
      game: "ats",
      decision: "unassessed",
      reportingAt: "2026-11-13T10:00:00.000Z",
      actualDistanceM: "777000",
    }),
    // T7: superseded alias of T3.
    trip({
      ownerId: driverB,
      game: "ats",
      decision: "accepted",
      reportingAt: "2026-11-10T10:00:00.000Z",
      actualDistanceM: "666000",
      aliasOf: t3.id,
    }),
    // T8: accepted but undated.
    trip({
      ownerId: driverA,
      game: "ets2",
      decision: "accepted",
      reportingAt: null,
      actualDistanceM: "555000",
    }),
    // T9: accepted with a pending correction keeps its confirmed facts.
    trip({
      ownerId: driverA,
      game: "ets2",
      decision: "accepted",
      reportingAt: "2026-11-20T10:00:00.000Z",
      actualDistanceM: "105600",
      correctionPending: true,
      reviewHold: true,
    }),
    // T10: first millisecond of December in Moscow.
    trip({
      ownerId: driverA,
      game: "ets2",
      decision: "accepted",
      reportingAt: "2026-11-30T21:00:00.000Z",
      actualDistanceM: "444000",
    }),
    // T11: accepted trip of a member who later became inactive still counts.
    trip({
      ownerId: members.inactive as string,
      game: "ets2",
      decision: "accepted",
      reportingAt: "2026-11-25T10:00:00.000Z",
      actualDistanceM: "50000.09",
    }),
  ];
  await unit.run((tx) => unit.client(tx).insert(trips).values(rows));

  async function companyTotal(fromDate: string, toDateExclusive: string) {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/analytics/company?fromDate=${fromDate}&toDateExclusive=${toDateExclusive}&granularity=month`,
      headers: { cookie: directorCookie },
    });
    expect(res.statusCode).toBe(200);
    return res.json().data as { acceptedTrips: number; actualDistanceM: string };
  }

  statsNow = new Date("2026-10-15T12:00:00.000Z");
  const october = await get();
  expect(october.statusCode).toBe(200);
  expectPublicHeaders(october);
  expect(october.json().data).toEqual({
    computedAt: "2026-10-15T12:00:00.000Z",
    activeMembers: 5,
    currentMonth: {
      status: "available",
      month: "2026-10",
      reportingTimezone: "Europe/Moscow",
      fromDate: "2026-10-01",
      toDateExclusive: "2026-11-01",
      acceptedTrips: 1,
      actualDistanceM: "100000.5",
      games: ["ets2"],
    },
  });
  const octoberTotal = await companyTotal("2026-10-01", "2026-11-01");
  expect(octoberTotal.acceptedTrips).toBe(1);
  expect(octoberTotal.actualDistanceM).toBe("100000.5");

  statsNow = new Date("2026-10-31T21:30:00.000Z");
  const november = await get();
  expect(november.statusCode).toBe(200);
  // T2 200000.2 + T3 150000.0 + T9 105600 + T11 50000.0 (per-trip tenths; the raw sum is 505600.39).
  expect(november.json().data.currentMonth).toEqual({
    status: "available",
    month: "2026-11",
    reportingTimezone: "Europe/Moscow",
    fromDate: "2026-11-01",
    toDateExclusive: "2026-12-01",
    acceptedTrips: 4,
    actualDistanceM: "505600.2",
    games: ["ets2", "ats"],
  });
  const novemberTotal = await companyTotal("2026-11-01", "2026-12-01");
  expect(novemberTotal.acceptedTrips).toBe(november.json().data.currentMonth.acceptedTrips);
  expect(novemberTotal.actualDistanceM).toBe(november.json().data.currentMonth.actualDistanceM);

  statsNow = new Date("2027-01-15T12:00:00.000Z");
  const january = await get();
  expect(january.statusCode).toBe(200);
  expect(january.json().data.currentMonth).toEqual({
    status: "available",
    month: "2027-01",
    reportingTimezone: "Europe/Moscow",
    fromDate: "2027-01-01",
    toDateExclusive: "2027-02-01",
    acceptedTrips: 0,
    actualDistanceM: "0",
    games: [],
  });
  const januaryTotal = await companyTotal("2027-01-01", "2027-02-01");
  expect(januaryTotal.acceptedTrips).toBe(0);
  expect(januaryTotal.actualDistanceM).toBe("0");
  statsNow = new Date("2026-10-31T21:30:00.000Z");
});

test("I4: the response is a closed anonymous aggregate regardless of cookies", async () => {
  const allowed = new Set([
    "data",
    "meta",
    "requestId",
    "computedAt",
    "activeMembers",
    "currentMonth",
    "status",
    "month",
    "reportingTimezone",
    "fromDate",
    "toDateExclusive",
    "acceptedTrips",
    "actualDistanceM",
    "games",
  ]);
  const keys = (value: unknown): string[] =>
    value && typeof value === "object"
      ? Array.isArray(value)
        ? value.flatMap(keys)
        : Object.entries(value).flatMap(([key, child]) => [key, ...keys(child)])
      : [];
  const anonymous = await get();
  const director = await get(path, { cookie: directorCookie });
  const garbage = await get(path, { cookie: "__Host-vtc_session=not-a-real-session; other=x" });
  for (const res of [anonymous, director, garbage]) {
    expect(res.statusCode).toBe(200);
    expectPublicHeaders(res);
    for (const key of keys(res.json())) expect(allowed.has(key), key).toBe(true);
    for (const value of [...fixtureIds, ...fixtureNames, ...fixtureEmails])
      expect(res.body.includes(value), "fixture identity leaked").toBe(false);
  }
  const strip = (res: Awaited<ReturnType<typeof get>>) => res.json().data;
  expect(strip(director)).toEqual(strip(anonymous));
  expect(strip(garbage)).toEqual(strip(anonymous));
  expect(anonymous.json().meta.requestId).not.toBe(director.json().meta.requestId);
});

test("I5: a company row held FOR UPDATE does not block the public read", async () => {
  const holder = await dedicatedConnection(guardedSettings());
  try {
    await holder.query("START TRANSACTION");
    await holder.query("SELECT singleton FROM identity_company WHERE singleton = 1 FOR UPDATE");
    const started = Date.now();
    const res = await get();
    const elapsed = Date.now() - started;
    expect(res.statusCode).toBe(200);
    expect(res.json().data.currentMonth.acceptedTrips).toBe(4);
    expect(elapsed).toBeLessThan(2000);
  } finally {
    await holder.query("ROLLBACK").catch(() => {});
    await holder.end();
  }
});

test("I6: the month aggregate range-scans trip_analytics_reporting", async () => {
  const driverA = members.driverA as string;
  const filler = Array.from({ length: 500 }, (_, i) =>
    trip({
      ownerId: driverA,
      game: i % 2 ? "ats" : "ets2",
      decision: "accepted",
      reportingAt: new Date(Date.UTC(2024, 0, 1) + i * 3600000 * 30).toISOString(),
      actualDistanceM: "1000",
    }),
  );
  await unit.run((tx) => unit.client(tx).insert(trips).values(filler));
  await control.query("ANALYZE TABLE trips");
  // Mirrors the service statement (getPublicCompanyStats) for the November 2026 Moscow window.
  const [plan] = await control.query<RowDataPacket[]>(
    "EXPLAIN SELECT count(*), coalesce(sum(truncate(actual_distance_m, 1)), 0), max(game = ?), max(game = ?) FROM trips WHERE decision = ? AND alias_of IS NULL AND reporting_at >= ? AND reporting_at < ?",
    ["ets2", "ats", "accepted", "2026-10-31 21:00:00.000", "2026-11-30 21:00:00.000"],
  );
  expect(plan).toHaveLength(1);
  expect(plan[0]?.table).toBe("trips");
  expect(plan[0]?.key).toBe("trip_analytics_reporting");
  expect(plan[0]?.type).toBe("range");
  const stats = await get();
  expect(stats.json().data.currentMonth.acceptedTrips).toBe(4);
});

test("I8: unknown query parameters are rejected as no-store 422", async () => {
  expectNoStoreError(await get(`${path}?foo=1`), 422, "INVALID_PAYLOAD");
});

test("I7: the public read limit returns 429 with Retry-After and no-store", async () => {
  identityNow = new Date("2030-01-01T00:00:30.000Z");
  try {
    for (let i = 0; i < 40; i++) {
      const res = await get(path, {}, "198.51.100.7");
      expect(res.statusCode, `request ${i + 1}`).toBe(200);
    }
    const limited = await get(path, {}, "198.51.100.7");
    expectNoStoreError(limited, 429, "RATE_LIMITED");
    expect(limited.headers["retry-after"]).toBe("60");
  } finally {
    identityNow = null;
  }
});
