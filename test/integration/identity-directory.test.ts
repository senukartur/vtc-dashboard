import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createUnitOfWork,
  dedicatedConnection,
  migrationFolder,
  newId,
  runMigrations,
  type UnitOfWork,
} from "@vtc/db";
import { membership, user } from "@vtc/db/identity-schema";
import { qualificationAssignments, qualificationLevels } from "@vtc/db/qualifications-schema";
import { trips } from "@vtc/db/trips-schema";
import { eq } from "drizzle-orm";
import type { Connection, RowDataPacket } from "mysql2/promise";
import {
  beforeEach,
  expect,
  test,
  afterAll as vitestAfterAll,
  beforeAll as vitestBeforeAll,
} from "vitest";
import { createApp } from "../../apps/api/src/app.ts";
import { createMemberDirectoryActivity } from "../../apps/api/src/modules/analytics/member-activity.ts";
import {
  type Actor,
  createIdentity,
  type Identity,
  type IdentityPorts,
} from "../../apps/api/src/modules/identity/service.ts";
import { pagination } from "../../apps/api/src/modules/identity/pagination.ts";
import {
  createDirectoryCurrentLevels,
  createDirectoryLevelFilter,
  type DirectoryGameLevels,
} from "../../apps/api/src/modules/qualifications/directory-level-filter.ts";
import {
  createQualificationInitialization,
  structuralLevels,
} from "../../apps/api/src/modules/qualifications/initialization.ts";
import { createTripActivity } from "../../apps/api/src/modules/trips/activity.ts";
import { identityAccessEvents } from "../../apps/api/src/platform/outbox/events.ts";
import {
  guardedSettings,
  reset,
  SCHEMA_SETUP_TIMEOUT_MS,
  testConnection,
} from "../persistence/support.ts";
import { schemaLifecycleHooks } from "../support/schema-lifecycle.ts";

const { beforeAll, afterAll } = schemaLifecycleHooks(vitestBeforeAll, vitestAfterAll);

const password = "Fictional-directory-password-42";
const identityConfig = {
  secret: "non-hex-directory-secret-phrase-32-chars-long!",
  origin: "http://127.0.0.1:4173",
  production: false,
};
const DAY = 86400000;
// The window end of the first page; the injected identity clock starts here.
const W = Math.floor(Date.now() / 1000) * 1000;
let clock = W;
const now = () => new Date(clock);
const iso = (ms: number) => new Date(ms).toISOString();

type Role = "trainee" | "driver" | "dispatcher" | "deputy_director";
type Sort = "nickname" | "distance30d" | "trips30d" | "lastTrip";
interface Fact {
  nickname: string;
  trips: number;
  distance: string;
  last: string | null;
}
interface Item {
  id: string;
  nickname: string;
  formerMember: boolean;
  roles: string[];
  last30Days?: { acceptedTrips: number; actualDistanceM: string };
  lastAcceptedTripAt?: string | null;
  levels?: DirectoryGameLevels;
}
interface Counts {
  active: number;
  former: number;
  droveLast30Days?: number;
}

let control: Connection;
let unit: UnitOfWork;
let recording: UnitOfWork;
let identity: Identity;
let plain: Identity;
let app: Awaited<ReturnType<typeof createApp>>;
let plainApp: Awaited<ReturnType<typeof createApp>>;
// Trips without Qualifications, and Qualifications without Trips.
let tripsOnlyApp: Awaited<ReturnType<typeof createApp>>;
let levelsOnlyApp: Awaited<ReturnType<typeof createApp>>;
// Member IDs of every current level lookup the directory makes.
const levelCalls: string[][] = [];
let director: { id: string; cookie: string; actor: Actor };
let driverCookie: string;
const recorded: { sql: string; params: unknown[] }[] = [];
const facts = new Map<string, Fact>();
const ids: Record<string, string> = {};
const lifecycle = () => createQualificationInitialization(unit);
const basePorts = (u: UnitOfWork): IdentityPorts => ({
  qualificationsLifecycle: createQualificationInitialization(u),
  accessEvents: identityAccessEvents(u),
});

// Records the final SQL of the directory, count and level selects so they can be explained.
function recordingUnit(inner: UnitOfWork): UnitOfWork {
  function wrap(builder: object): object {
    return new Proxy(builder, {
      get(target, property) {
        const value = Reflect.get(target, property);
        if (property === "then" && typeof value === "function") {
          const query = (target as { toSQL?: () => { sql: string; params: unknown[] } }).toSQL?.();
          if (
            query?.sql.includes("directory_window_trips") ||
            query?.sql.includes("`qualification_assignments`")
          )
            recorded.push(query);
          return value.bind(target);
        }
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          const next = Reflect.apply(value, target, args);
          return next && typeof next === "object" ? wrap(next) : next;
        };
      },
    });
  }
  return {
    run: (command) => inner.run(command),
    close: async () => {},
    client(tx) {
      const original = inner.client(tx);
      return new Proxy(original, {
        get(target, property) {
          const value = Reflect.get(target, property);
          if (property === "select" && typeof value === "function")
            return (...args: unknown[]) => wrap(Reflect.apply(value, target, args));
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
}

async function signIn(email: string) {
  const login = await identity.login(email, password, true);
  const cookie = login.cookies.map((value) => value.split(";", 1)[0]).join("; ");
  return { cookie, actor: await identity.authenticate(new Headers({ cookie })) };
}

let credential: Awaited<ReturnType<Identity["prepareCredential"]>> | undefined;
async function register(key: string, nickname: string, roles: Role[] = ["driver"]) {
  const userId = newId();
  // One hash of the shared fictional password keeps the fixture inside its setup bound.
  credential ??= await identity.prepareCredential(password);
  const prepared = credential;
  await unit.run((tx) =>
    identity.insertWithCredential(tx, {
      userId,
      email: `${userId}@example.invalid`,
      name: nickname,
      ...prepared,
      roles,
    }),
  );
  ids[key] = userId;
  facts.set(userId, { nickname, trips: 0, distance: "0", last: null });
  return userId;
}

type Trip = typeof trips.$inferInsert;
const trip = (
  ownerId: string,
  reportingAt: number,
  actualDistanceM: string,
  options: Partial<Pick<Trip, "id" | "decision" | "aliasOf" | "game">> = {},
): Trip => ({
  id: newId(),
  ownerId,
  game: "ets2",
  outcome: "delivered",
  recording: "complete",
  decision: "accepted",
  version: 1,
  reviewReasons: [],
  createdAt: iso(reportingAt),
  reportingAt: iso(reportingAt),
  actualDistanceM,
  ...options,
});

async function administer(
  targetId: string,
  input: Parameters<Identity["administer"]>[4],
): Promise<void> {
  const [row] = await unit.run((tx) =>
    unit.client(tx).select().from(membership).where(eq(membership.userId, targetId)),
  );
  await identity.administer(director.actor, targetId, newId(), row?.version ?? 0, input);
}
const reinstate = (levels: { ets2?: string; ats?: string }, roles: Role[] = ["driver"]) => ({
  kind: "reinstate" as const,
  roles,
  qualifications: (["ets2", "ats"] as const)
    .filter((game) => levels[game])
    .map((game) => ({
      game,
      levelId: levels[game] as string,
      purpose: "reinstatement" as const,
      reason: "Fictional return",
    })),
});

// Long traversals exceed the per-source read quota, which identity.test.ts already covers.
async function get(url: string, cookie = driverCookie, target = app) {
  await control.query("DELETE FROM identity_limits");
  return target.inject({ method: "GET", url, headers: { cookie } });
}

async function page(query: string, cookie = driverCookie, target = app) {
  const response = await get(`/api/v1/members?${query}`, cookie, target);
  expect(response.statusCode, `${query}: ${response.body}`).toBe(200);
  return response.json().data as {
    items: Item[];
    nextCursor: string | null;
    windowEndsAt?: string;
    statusCounts?: Counts;
  };
}

async function traverse(query: string, limit: number, beforeNext?: () => void, target = app) {
  const items: Item[] = [];
  const windows = new Set<string | undefined>();
  const counts: (Counts | undefined)[] = [];
  let cursor: string | null = null;
  for (let pages = 0; pages < 100; pages++) {
    const data = await page(
      `${query}${query ? "&" : ""}limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      driverCookie,
      target,
    );
    counts.push(data.statusCounts);
    expect(data.items.length).toBeLessThanOrEqual(limit);
    items.push(...data.items);
    windows.add(data.windowEndsAt);
    cursor = data.nextCursor;
    if (!cursor) break;
    beforeNext?.();
  }
  const seen = items.map((item) => item.id);
  expect(new Set(seen).size, `${query} has no duplicates`).toBe(seen.length);
  return { items, ids: seen, windows, counts };
}

const scaled = (value: string) => {
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, "0"));
};
function expectedOrder(sort?: Sort, order?: "asc" | "desc") {
  const rows = [...facts.entries()].map(([id, fact]) => ({ id, ...fact }));
  const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const sign = order === "asc" ? 1 : -1;
  const compare = (a: (typeof rows)[number], b: (typeof rows)[number]) => {
    switch (sort) {
      case "nickname": {
        const x = a.nickname.toLowerCase(),
          y = b.nickname.toLowerCase();
        return x < y ? -1 : x > y ? 1 : 0;
      }
      case "trips30d":
        return a.trips - b.trips;
      case "distance30d": {
        const x = scaled(a.distance),
          y = scaled(b.distance);
        return x < y ? -1 : x > y ? 1 : 0;
      }
      default:
        return Date.parse(a.last ?? "") - Date.parse(b.last ?? "");
    }
  };
  return rows
    .sort((a, b) => {
      if (!sort) return byId(a, b);
      if (sort === "lastTrip" && (a.last === null || b.last === null))
        return a.last === b.last ? byId(a, b) : a.last === null ? 1 : -1;
      return sign * compare(a, b) || byId(a, b);
    })
    .map((row) => row.id);
}

beforeAll(async () => {
  control = await testConnection();
  unit = createUnitOfWork(guardedSettings());
  await reset(control);
  await runMigrations(guardedSettings());
  recording = recordingUnit(unit);
  const currentLevels = createDirectoryCurrentLevels(recording);
  identity = createIdentity(
    recording,
    identityConfig,
    {
      ...basePorts(unit),
      memberActivity: createMemberDirectoryActivity(),
      memberLevelFilter: createDirectoryLevelFilter(unit),
      memberCurrentLevels: (tx, userIds) => {
        levelCalls.push([...userIds]);
        return currentLevels(tx, userIds);
      },
    },
    now,
  );
  // Without Trips and qualifications: no activity facts and no level filter.
  plain = createIdentity(unit, identityConfig, basePorts(unit), now);
  const tripsOnly = createIdentity(
    unit,
    identityConfig,
    { ...basePorts(unit), memberActivity: createMemberDirectoryActivity() },
    now,
  );
  const levelsOnly = createIdentity(
    unit,
    identityConfig,
    {
      ...basePorts(unit),
      memberLevelFilter: createDirectoryLevelFilter(unit),
      memberCurrentLevels: createDirectoryCurrentLevels(unit),
    },
    now,
  );

  // Everyone registers before the fixture returns and the window end.
  clock = W - 30000;
  await identity.bootstrap({
    email: "directory-director@example.invalid",
    name: "Directory Director",
    password,
  });
  const [owner] = await unit.run((tx) =>
    unit.client(tx).select().from(user).where(eq(user.email, "directory-director@example.invalid")),
  );
  if (!owner) throw new Error("SYNTHETIC_DIRECTOR_MISSING");
  ids.director = owner.id;
  facts.set(owner.id, { nickname: "Directory Director", trips: 0, distance: "0", last: null });
  director = { id: owner.id, ...(await signIn("directory-director@example.invalid")) };
  clock = W - 20000;

  const tie = await register("tie", "Tie Driver");
  const tieLower = await register("tieLower", "tie driver", ["driver", "dispatcher"]);
  const exact = await register("exact", "Exact Driver", ["trainee"]);
  const round = await register("round", "Round Driver", ["driver", "deputy_director"]);
  const old = await register("old", "Old Driver");
  await register("quiet", "Quiet Driver");
  const excluded = await register("excluded", "Excluded Driver");
  await register("percent", "Percent 100% Driver");
  await register("underscore", "Under_score Driver");
  const former = await register("former", "Former Driver");
  await register("returner", "Return Driver");
  driverCookie = (await signIn(`${tie}@example.invalid`)).cookie;
  clock = W;

  await unit.run(async (tx) => {
    for (const userId of [tie, tieLower, former])
      await lifecycle().initialize(tx, {
        userId,
        games: ["ets2", "ats"],
        assignedAt: iso(W - 15000),
      });
    const rejectedRoot = newId();
    await unit
      .client(tx)
      .insert(trips)
      .values([
        // Both window ends count: [W - 30 days, W].
        trip(tie, W, "3"),
        trip(tie, W - 30 * DAY, "7.5"),
        trip(tieLower, W - DAY, "10.5"),
        trip(exact, W - 2 * DAY, "10.000000000000000001"),
        trip(round, W - 2 * DAY, "10", { game: "ats" }),
        trip(round, W - 30 * DAY - 1, "100"),
        trip(old, W - 40 * DAY, "55"),
        trip(former, W - 5 * DAY, "1"),
        // Rejected, pending and alias rows never count, not even for the last trip time.
        trip(excluded, W - DAY, "70", { id: rejectedRoot, decision: "rejected" }),
        trip(excluded, W - DAY, "80", { decision: "pending_review" }),
        trip(excluded, W, "90", { aliasOf: rejectedRoot }),
      ]);
  });
  Object.assign(facts.get(tie) as Fact, { trips: 2, distance: "10.5", last: iso(W) });
  Object.assign(facts.get(tieLower) as Fact, { trips: 1, distance: "10.5", last: iso(W - DAY) });
  Object.assign(facts.get(exact) as Fact, {
    trips: 1,
    distance: "10.000000000000000001",
    last: iso(W - 2 * DAY),
  });
  Object.assign(facts.get(round) as Fact, { trips: 1, distance: "10", last: iso(W - 2 * DAY) });
  Object.assign(facts.get(old) as Fact, { last: iso(W - 40 * DAY) });
  Object.assign(facts.get(former) as Fact, { trips: 1, distance: "1", last: iso(W - 5 * DAY) });

  // Current levels through the real lifecycle: Exact at ETS2 level 2, Round at ATS level 2.
  clock = W - 10000;
  await administer(exact, { kind: "deactivate" });
  await administer(round, { kind: "deactivate" });
  clock = W - 9000;
  await administer(
    exact,
    reinstate({ ets2: structuralLevels.ets2[1], ats: structuralLevels.ats[0] }, ["trainee"]),
  );
  await administer(
    round,
    reinstate({ ats: structuralLevels.ats[1] }, ["driver", "deputy_director"]),
  );
  await administer(former, { kind: "deactivate" });
  clock = W;

  app = await createApp({ checkReadiness: async () => true, identity });
  plainApp = await createApp({ checkReadiness: async () => true, identity: plain });
  tripsOnlyApp = await createApp({ checkReadiness: async () => true, identity: tripsOnly });
  levelsOnlyApp = await createApp({ checkReadiness: async () => true, identity: levelsOnly });
}, SCHEMA_SETUP_TIMEOUT_MS);

beforeEach(async () => {
  clock = W;
  await control.query("DELETE FROM identity_limits");
});

afterAll(async () => {
  await app?.close();
  await plainApp?.close();
  await tripsOnlyApp?.close();
  await levelsOnlyApp?.close();
  await unit?.close();
  await control?.end();
});

test("directory rows carry the activity facts, zeros and null last trips without private fields", async () => {
  const data = await page("limit=100");
  expect(Object.keys(data).sort()).toEqual(["items", "nextCursor", "statusCounts", "windowEndsAt"]);
  expect(data.windowEndsAt).toBe(iso(W));
  expect(data.nextCursor).toBeNull();
  expect(data.items.map((item) => item.id)).toEqual(expectedOrder());
  for (const item of data.items) {
    expect(Object.keys(item).sort()).toEqual([
      "formerMember",
      "id",
      "last30Days",
      "lastAcceptedTripAt",
      "levels",
      "nickname",
      "roles",
    ]);
    const fact = facts.get(item.id) as Fact;
    expect(item.last30Days, fact.nickname).toEqual({
      acceptedTrips: fact.trips,
      actualDistanceM: fact.distance,
    });
    expect(item.lastAcceptedTripAt, fact.nickname).toBe(fact.last);
  }
  const byKey = (key: string) => data.items.find((item) => item.id === ids[key]) as Item;
  // Only old trips: zeros for the window but a real last accepted trip time.
  expect(byKey("old")).toMatchObject({
    last30Days: { acceptedTrips: 0, actualDistanceM: "0" },
    lastAcceptedTripAt: iso(W - 40 * DAY),
  });
  expect(byKey("quiet").lastAcceptedTripAt).toBeNull();
  expect(byKey("excluded")).toMatchObject({
    last30Days: { acceptedTrips: 0, actualDistanceM: "0" },
    lastAcceptedTripAt: null,
  });
  expect(byKey("former")).toMatchObject({ formerMember: true, roles: [] });
  expect(byKey("director").roles).toContain("director");
  const raw = await get("/api/v1/members?limit=100");
  expect(raw.body).not.toContain("@example.invalid");
  expect(raw.body).not.toContain("email");
});

test("every sort and order pages as a stable keyset without duplicates or skips", async () => {
  for (const sort of [undefined, "nickname", "distance30d", "trips30d", "lastTrip"] as const)
    for (const order of sort ? (["asc", "desc", undefined] as const) : [undefined]) {
      const effective = order ?? (sort === "nickname" ? "asc" : "desc");
      const query = [sort && `sort=${sort}`, order && `order=${order}`].filter(Boolean).join("&");
      for (const limit of [1, 2]) {
        const result = await traverse(query, limit);
        expect(result.ids, `${query} limit ${limit}`).toEqual(expectedOrder(sort, effective));
        expect([...result.windows]).toEqual([iso(W)]);
      }
    }
  // Spot checks of the tie rules on the actual rows.
  const trips30d = expectedOrder("trips30d", "desc");
  expect(trips30d[0]).toBe(ids.tie);
  const distance = (await traverse("sort=distance30d", 2)).ids;
  expect(distance.slice(0, 4)).toEqual([...[ids.tie, ids.tieLower].sort(), ids.exact, ids.round]);
  const nickname = (await traverse("sort=nickname", 1)).items.map((item) => item.nickname);
  expect(nickname.filter((name) => name.toLowerCase() === "tie driver")).toHaveLength(2);
  for (const order of ["asc", "desc"]) {
    const last = (await traverse(`sort=lastTrip&order=${order}`, 2)).items;
    const nulls = last.filter((item) => item.lastAcceptedTripAt === null).map((item) => item.id);
    // Members without an accepted trip sort last in both orders, by ascending ID.
    expect(last.slice(-nulls.length).map((item) => item.id)).toEqual([...nulls].sort());
  }
});

test("the 30-day window and its cursor binding survive a clock change between pages", async () => {
  const result = await traverse("", 1, () => {
    clock = W + 3600000;
  });
  expect([...result.windows]).toEqual([iso(W)]);
  expect(result.items.find((item) => item.id === ids.tie)?.last30Days).toEqual({
    acceptedTrips: 2,
    actualDistanceM: "10.5",
  });
  // A new first page uses the current instant: W - 30 days has left the window.
  clock = W + 3600000;
  const fresh = await page("limit=100");
  expect(fresh.windowEndsAt).toBe(iso(W + 3600000));
  expect(fresh.items.find((item) => item.id === ids.tie)?.last30Days).toEqual({
    acceptedTrips: 1,
    actualDistanceM: "3",
  });
  // A trip one millisecond before W - 30 days never counted for Round.
  expect(fresh.items.find((item) => item.id === ids.round)?.last30Days).toEqual({
    acceptedTrips: 1,
    actualDistanceM: "10",
  });
});

test("search, role and level filters apply before paging and combine with AND", async () => {
  const all = (await page("limit=100")).items;
  const of = async (query: string) => (await traverse(query, 2)).ids;
  const sorted = (...keys: string[]) => keys.map((key) => ids[key] as string).sort();
  expect(await of("search=tie")).toEqual(sorted("tie", "tieLower"));
  expect(await of(`search=${encodeURIComponent("  TIE ")}`)).toEqual(sorted("tie", "tieLower"));
  expect(await of(`search=${encodeURIComponent("%")}`)).toEqual(sorted("percent"));
  expect(await of("search=_")).toEqual(sorted("underscore"));
  for (const blank of ["%20%20", encodeURIComponent("\t")])
    expect((await get(`/api/v1/members?search=${blank}`)).statusCode).toBe(422);
  expect((await get(`/api/v1/members?search=${"x".repeat(129)}`)).statusCode).toBe(422);

  for (const role of ["trainee", "driver", "dispatcher", "deputy_director", "director"])
    expect(await of(`role=${role}`), role).toEqual(
      all
        .filter((item) => item.roles.includes(role))
        .map((item) => item.id)
        .sort(),
    );
  expect(await of("role=director")).toEqual([ids.director]);
  expect((await get("/api/v1/members?role=owner")).statusCode).toBe(422);
  expect(await of("role=driver&search=tie")).toEqual(sorted("tie", "tieLower"));
  expect(await of("role=dispatcher&search=tie")).toEqual(sorted("tieLower"));

  const [ets2First, ets2Second] = structuralLevels.ets2;
  const [atsFirst, atsSecond] = structuralLevels.ats;
  // A plain driver can filter by any active level; former members never match.
  expect(await of(`ets2Level=${ets2First}`)).toEqual(sorted("tie", "tieLower"));
  expect(await of(`ets2Level=${ets2Second}`)).toEqual(sorted("exact"));
  expect(await of(`atsLevel=${atsSecond}`)).toEqual(sorted("round"));
  expect(await of(`atsLevel=${atsFirst}`)).toEqual(sorted("tie", "tieLower", "exact"));
  expect(await of(`ets2Level=${ets2First}&atsLevel=${atsFirst}`)).toEqual(
    sorted("tie", "tieLower"),
  );
  expect(await of(`ets2Level=${ets2Second}&atsLevel=${atsFirst}`)).toEqual(sorted("exact"));
  expect(await of(`ets2Level=${ets2First}&atsLevel=${atsSecond}`)).toEqual([]);
  expect(await of(`ets2Level=${ets2First}&search=lower`)).toEqual([]);
  expect(await of(`ets2Level=${ets2First}&sort=trips30d`)).toEqual([ids.tie, ids.tieLower]);

  const archived = newId();
  await unit.run((tx) =>
    unit.client(tx).insert(qualificationLevels).values({
      id: archived,
      game: "ets2",
      name: "Fictional archived level",
      version: 1,
      position: null,
      deletedAt: "2026-01-01T00:00:00.000Z",
    }),
  );
  for (const query of [
    `ets2Level=${archived}`,
    `ets2Level=${atsFirst}`,
    `atsLevel=${ets2First}`,
    `ets2Level=${newId()}`,
    "atsLevel=not-a-level",
  ])
    expect((await get(`/api/v1/members?${query}`)).statusCode, query).toBe(422);
  expect(
    (await get(`/api/v1/members?ets2Level=${ets2First}`, driverCookie, plainApp)).statusCode,
  ).toBe(422);
});

test("cursors bind the reader, session, filters, sort and effective order", async () => {
  const first = await page("sort=trips30d&limit=1");
  const cursor = encodeURIComponent(first.nextCursor as string);
  // Omitting order is the same binding as its desc default.
  expect(
    (await get(`/api/v1/members?sort=trips30d&order=desc&limit=1&cursor=${cursor}`)).statusCode,
  ).toBe(200);
  for (const query of [
    "sort=trips30d&order=asc",
    "sort=distance30d",
    "sort=trips30d&search=driver",
    "sort=trips30d&role=driver",
    `sort=trips30d&ets2Level=${structuralLevels.ets2[0]}`,
    `sort=trips30d&atsLevel=${structuralLevels.ats[0]}`,
    "",
  ]) {
    const response = await get(
      `/api/v1/members?${query}${query ? "&" : ""}limit=1&cursor=${cursor}`,
    );
    expect(response.statusCode, query).toBe(409);
    expect(response.json().error.code).toBe("VERSION_CONFLICT");
  }
  const otherSession = await signIn(`${ids.tie}@example.invalid`);
  expect(
    (await get(`/api/v1/members?sort=trips30d&limit=1&cursor=${cursor}`, otherSession.cookie))
      .statusCode,
  ).toBe(409);
  expect(
    (await get(`/api/v1/members?sort=trips30d&limit=1&cursor=${cursor}`, director.cookie))
      .statusCode,
  ).toBe(409);
  const [body = "", mac = ""] = (first.nextCursor as string).split(".");
  const payload = JSON.parse(Buffer.from(body, "base64url").toString());
  const forged = Buffer.from(JSON.stringify({ ...payload, w: iso(W - DAY) })).toString("base64url");
  for (const tampered of [`${forged}.${mac}`, `${body}.${mac.slice(0, -2)}AA`, `${body}x.${mac}`])
    expect(
      (await get(`/api/v1/members?sort=trips30d&limit=1&cursor=${encodeURIComponent(tampered)}`))
        .statusCode,
    ).toBe(409);
  // An order without a sort is rejected rather than ignored.
  expect((await get("/api/v1/members?order=asc")).statusCode).toBe(422);
  for (const query of ["sort=points", "order=up", "limit=0", "limit=101", "extra=1"])
    expect((await get(`/api/v1/members?${query}`)).statusCode, query).toBe(422);
});

test("without Trips the directory omits activity facts and rejects activity sorts", async () => {
  const response = await get("/api/v1/members?limit=100", driverCookie, plainApp);
  expect(response.statusCode).toBe(200);
  const data = response.json().data;
  expect(Object.keys(data).sort()).toEqual(["items", "nextCursor", "statusCounts"]);
  expect(Object.keys(data.statusCounts).sort()).toEqual(["active", "former"]);
  for (const item of data.items)
    expect(Object.keys(item).sort()).toEqual(["formerMember", "id", "nickname", "roles"]);
  for (const sort of ["distance30d", "trips30d", "lastTrip"])
    expect((await get(`/api/v1/members?sort=${sort}`, driverCookie, plainApp)).statusCode).toBe(
      422,
    );
  const nickname = await get("/api/v1/members?sort=nickname&limit=2", driverCookie, plainApp);
  expect(nickname.statusCode).toBe(200);
  expect(
    (
      await get(
        `/api/v1/members?sort=nickname&limit=2&cursor=${encodeURIComponent(nickname.json().data.nextCursor)}`,
        driverCookie,
        plainApp,
      )
    ).statusCode,
  ).toBe(200);
  const profile = await get(`/api/v1/members/${ids.tie}`, driverCookie, plainApp);
  expect(profile.json().data).toHaveProperty("memberSince");
  expect(profile.json().data).not.toHaveProperty("lastAcceptedTripAt");
});

test("profiles expose memberSince and the same last accepted trip time as administration", async () => {
  const activity = createTripActivity(unit);
  const keys = ["tie", "old", "quiet", "excluded", "former"];
  const admin = await unit.run((tx) =>
    activity.lastAcceptedInTransaction(
      tx,
      keys.map((key) => ids[key] as string),
    ),
  );
  for (const key of keys) {
    const response = await get(`/api/v1/members/${ids[key]}`);
    expect(response.statusCode).toBe(200);
    const data = response.json().data;
    expect(data.lastAcceptedTripAt, key).toBe(admin.get(ids[key] as string) ?? null);
    expect(data.lastAcceptedTripAt, key).toBe(facts.get(ids[key] as string)?.last);
    expect(response.body).not.toContain("@example.invalid");
  }
  expect((await get(`/api/v1/members/${ids.exact}`)).json().data.memberSince).toBe(iso(W - 9000));
  expect((await get(`/api/v1/members/${ids.tie}`)).json().data.memberSince).toBe(iso(W - 20000));
  expect((await get(`/api/v1/members/${ids.former}`)).json().data.memberSince).toBe(iso(W - 20000));
});

test("anonymous and stale sessions cannot read the directory", async () => {
  expect((await app.inject({ url: "/api/v1/members" })).statusCode).toBe(401);
  expect((await app.inject({ url: `/api/v1/members/${ids.tie}` })).statusCode).toBe(401);
  const stale = await signIn(`${ids.returner}@example.invalid`);
  await administer(ids.returner as string, { kind: "deactivate" });
  for (const url of ["/api/v1/members", `/api/v1/members/${ids.tie}`])
    expect((await get(url, stale.cookie)).statusCode).toBe(401);
  clock = W + 500;
  await administer(ids.returner as string, reinstate({ ets2: structuralLevels.ets2[0] }));
});

test("joined_at is the registration instant and moves to the latest return only", async () => {
  const joinedAt = async (userId: string) => {
    const [[row]] = await control.query<RowDataPacket[]>(
      "SELECT CAST(m.joined_at AS CHAR) joined, CAST(u.created_at AS CHAR) created FROM identity_memberships m JOIN identity_users u ON u.id=m.user_id WHERE m.user_id=?",
      [userId],
    );
    return { joined: row?.joined as string, created: row?.created as string };
  };
  const profile = async (userId: string) =>
    (await get(`/api/v1/members/${userId}`)).json().data.memberSince as string;
  const sqlTime = (ms: number) => iso(ms).slice(0, 23).replace("T", " ");

  clock = W + 100000;
  const userId = await register("cycle", "Cycle Driver");
  facts.delete(userId);
  const registered = await joinedAt(userId);
  expect(registered).toEqual({ joined: sqlTime(W + 100000), created: sqlTime(W + 100000) });
  await unit.run((tx) =>
    lifecycle().initialize(tx, { userId, games: ["ets2"], assignedAt: iso(W + 100000) }),
  );
  expect(await profile(userId)).toBe(iso(W + 100000));

  clock = W + 200000;
  await administer(userId, { kind: "deactivate" });
  expect((await joinedAt(userId)).joined).toBe(sqlTime(W + 100000));
  clock = W + 300000;
  await administer(userId, reinstate({ ets2: structuralLevels.ets2[0] }));
  expect(await joinedAt(userId)).toEqual({
    joined: sqlTime(W + 300000),
    created: sqlTime(W + 100000),
  });
  expect(await profile(userId)).toBe(iso(W + 300000));
  const [[initial]] = await control.query<RowDataPacket[]>(
    "SELECT CAST(assigned_at AS CHAR) at FROM qualification_assignments WHERE user_id=? AND kind='admission'",
    [userId],
  );
  expect(initial?.at).toBe(sqlTime(W + 100000));

  // Role and membership changes leave it; a second return moves it again.
  clock = W + 400000;
  await administer(userId, { kind: "roles", roles: ["driver", "dispatcher"] });
  await administer(userId, { kind: "membership", membership: "trainee" });
  expect((await joinedAt(userId)).joined).toBe(sqlTime(W + 300000));
  clock = W + 500000;
  await administer(userId, { kind: "deactivate" });
  clock = W + 600000;
  await administer(userId, reinstate({ ets2: structuralLevels.ets2[0] }));
  expect((await joinedAt(userId)).joined).toBe(sqlTime(W + 600000));

  // A reinstatement that fails rolls back with its joined_at change.
  clock = W + 700000;
  await administer(userId, { kind: "deactivate" });
  const failing = createIdentity(
    unit,
    identityConfig,
    {
      qualificationsLifecycle: createQualificationInitialization(unit),
      accessEvents: {
        append: async () => {
          throw new Error("SYNTHETIC_ACCESS_EVENT_FAILURE");
        },
      },
    },
    () => new Date(W + 800000),
  );
  const [row] = await unit.run((tx) =>
    unit.client(tx).select().from(membership).where(eq(membership.userId, userId)),
  );
  await expect(
    failing.administer(
      director.actor,
      userId,
      newId(),
      row?.version ?? 0,
      reinstate({ ets2: structuralLevels.ets2[0] }),
    ),
  ).rejects.toThrow();
  expect((await joinedAt(userId)).joined).toBe(sqlTime(W + 600000));
  clock = W + 900000;
  await administer(userId, reinstate({ ets2: structuralLevels.ets2[0] }));
  expect((await joinedAt(userId)).joined).toBe(sqlTime(W + 900000));

  // The 0032/0033 derivation reproduces every value this code wrote.
  const [before] = await control.query<RowDataPacket[]>(
    "SELECT CAST(user_id AS CHAR) id, CAST(joined_at AS CHAR) joined FROM identity_memberships ORDER BY user_id",
  );
  // 0035 renamed the assignment purpose to kind; the derivation is otherwise unchanged.
  const catchUp = await readFile(join(migrationFolder, "0033_joined_at_catch_up.sql"), "utf8");
  await control.query(
    catchUp.replace("a.`purpose` = 'reinstatement'", "a.`kind` = 'reinstatement'"),
  );
  const [after] = await control.query<RowDataPacket[]>(
    "SELECT CAST(user_id AS CHAR) id, CAST(joined_at AS CHAR) joined FROM identity_memberships ORDER BY user_id",
  );
  expect(after).toEqual(before);
});

test("the directory statement uses the accepted reporting index for its trip subqueries", async () => {
  recorded.length = 0;
  await page("sort=lastTrip&limit=5");
  // The rows statement is the only one with the last-trip subquery; the count statement follows.
  const statement = recorded.find((query) => query.sql.includes("directory_last_trip"));
  const counts = recorded.find(
    (query) =>
      query.sql.includes("directory_window_trips") && !query.sql.includes("directory_last_trip"),
  );
  if (!statement || !counts) throw new Error("SYNTHETIC_DIRECTORY_SQL_MISSING");
  await control.query("ANALYZE TABLE trips, identity_users, identity_memberships");
  const [countPlan] = await control.query<RowDataPacket[]>(`EXPLAIN ${counts.sql}`, counts.params);
  const counted = countPlan.filter((row) => row.table === "directory_window_trips");
  expect(counted).toHaveLength(1);
  expect(String(counted[0]?.possible_keys)).toContain("trip_owner_accepted_reporting");
  expect(counts.sql).not.toMatch(/for (share|update)/i);
  const [rows] = await control.query<RowDataPacket[]>(`EXPLAIN ${statement.sql}`, statement.params);
  const subqueries = rows.filter((row) => String(row.table).startsWith("directory_"));
  expect(subqueries.map((row) => row.table).sort()).toEqual([
    "directory_last_trip",
    "directory_window_distance",
    "directory_window_trips",
  ]);
  for (const row of subqueries)
    expect(String(row.possible_keys), String(row.table)).toContain("trip_owner_accepted_reporting");
  const [tree] = await control.query<RowDataPacket[]>(
    `EXPLAIN FORMAT=TREE ${statement.sql}`,
    statement.params,
  );
  // Synthetic plan evidence for review; identifiers and instants are masked before logging.
  const text = String(tree[0]?.EXPLAIN)
    .replace(/'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/g, "'<id>'")
    .replace(/0x[0-9a-f]+/g, "<id>")
    .replace(/'\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?'/g, "'<instant>'");
  console.info(JSON.stringify({ event: "vtc140_directory_explain", plan: text }));
});

// VTC-150 follow-up: status filter, company-wide counts and current levels.
const keyed = (...keys: string[]) => keys.map((key) => ids[key] as string).sort();
const formerOf = (status: "active" | "former") => (item: Item) =>
  item.formerMember === (status === "former");

async function baselineCounts(): Promise<Counts> {
  const [[row]] = await control.query<RowDataPacket[]>(
    "SELECT COUNT(CASE WHEN m.status='active' THEN 1 END) active, COUNT(CASE WHEN m.status='inactive' THEN 1 END) former FROM identity_users u JOIN identity_memberships m ON m.user_id=u.id",
  );
  return { active: Number(row?.active), former: Number(row?.former) };
}
async function levelRows() {
  const [rows] = await control.query<RowDataPacket[]>(
    "SELECT CAST(id AS CHAR) id, game, name, position FROM qualification_levels",
  );
  return new Map(
    rows.map((row) => [
      String(row.id),
      {
        game: row.game as "ets2" | "ats",
        name: String(row.name),
        position: row.position === null ? null : Number(row.position),
      },
    ]),
  );
}

test("the status filter lists active or former members before paging with every sort", async () => {
  for (const sort of [undefined, "nickname", "distance30d", "trips30d", "lastTrip"] as const)
    for (const order of sort ? (["asc", "desc"] as const) : [undefined]) {
      const base = [sort && `sort=${sort}`, order && `order=${order}`].filter(Boolean).join("&");
      const all = (await traverse(base, 100)).items;
      for (const status of ["active", "former"] as const)
        for (const limit of [1, 2]) {
          const query = [base, `status=${status}`].filter(Boolean).join("&");
          const result = await traverse(query, limit);
          expect(result.items, `${query} limit ${limit}`).toEqual(all.filter(formerOf(status)));
          expect([...result.windows]).toEqual([iso(W)]);
        }
    }
  const all = (await traverse("", 100)).items;
  expect(all.filter(formerOf("former")).map((item) => item.id)).toContain(ids.former);
  const of = async (query: string) => (await traverse(query, 2)).ids;
  const ofAll = (predicate: (item: Item) => boolean) =>
    all
      .filter(predicate)
      .map((item) => item.id)
      .sort();
  expect(await of("status=active&search=tie")).toEqual(keyed("tie", "tieLower"));
  expect(await of("status=former&search=driver")).toEqual(
    ofAll((item) => item.formerMember && item.nickname.toLowerCase().includes("driver")),
  );
  for (const role of ["driver", "dispatcher", "director"])
    for (const status of ["active", "former"] as const)
      expect(await of(`status=${status}&role=${role}`), `${status} ${role}`).toEqual(
        ofAll((item) => formerOf(status)(item) && item.roles.includes(role)),
      );
  const [ets2First] = structuralLevels.ets2;
  expect(await of(`status=former&ets2Level=${ets2First}`)).toEqual([]);
  expect(await of(`status=active&ets2Level=${ets2First}`)).toEqual(
    await of(`ets2Level=${ets2First}`),
  );
  // The former tab keeps the 30-day facts and the activity sorts.
  for (const sort of ["trips30d", "distance30d", "lastTrip"]) {
    const former = (await page(`status=former&sort=${sort}&limit=100`)).items.find(
      (item) => item.id === ids.former,
    );
    expect(former, sort).toMatchObject({
      formerMember: true,
      last30Days: { acceptedTrips: 1, actualDistanceM: "1" },
      lastAcceptedTripAt: iso(W - 5 * DAY),
    });
  }
  for (const query of [
    "status=inactive",
    "status=Active",
    "status=",
    "status=active&status=former",
    "status=active&status=active",
  ])
    expect((await get(`/api/v1/members?${query}`)).statusCode, query).toBe(422);
  await expect(
    identity.listMembers(director.actor, { status: "inactive" as "active" }),
  ).rejects.toMatchObject({ statusCode: 422 });
});

test("cursors bind the status filter and keep cursors minted without it", async () => {
  const conflict = async (query: string, cursor: string | null) => {
    const response = await get(
      `/api/v1/members?${query}${query ? "&" : ""}limit=1&cursor=${encodeURIComponent(cursor as string)}`,
    );
    expect(response.statusCode, query).toBe(409);
    expect(response.json().error.code).toBe("VERSION_CONFLICT");
  };
  const active = await page("status=active&limit=1");
  expect(
    (
      await get(
        `/api/v1/members?status=active&limit=1&cursor=${encodeURIComponent(active.nextCursor as string)}`,
      )
    ).statusCode,
  ).toBe(200);
  for (const query of ["", "status=former"]) await conflict(query, active.nextCursor);
  const omitted = await page("limit=1");
  for (const query of ["status=active", "status=former"]) await conflict(query, omitted.nextCursor);

  // A cursor bound to the eight-element scope used before the status filter keeps working.
  const actor = await identity.authenticate(new Headers({ cookie: driverCookie }));
  const [first] = omitted.items;
  if (!first) throw new Error("SYNTHETIC_DIRECTORY_EMPTY");
  const legacy = pagination(identityConfig.secret)(
    actor,
    ["members", "directory", null, null, null, null, null, null],
    { limit: 1 },
    { sort: undefined, windowed: true },
  ).finish(
    [first, first],
    (item) => ({ id: item.id, value: null }),
    omitted.windowEndsAt ?? null,
  ).nextCursor;
  const next = await page(`limit=1&cursor=${encodeURIComponent(omitted.nextCursor as string)}`);
  const resumed = await page(`limit=1&cursor=${encodeURIComponent(legacy as string)}`);
  expect(resumed.items).toEqual(next.items);
  expect(resumed.windowEndsAt).toBe(omitted.windowEndsAt);
});

test("status counts are company-wide, ignore every filter and match the row facts", async () => {
  const baseline = await baselineCounts();
  const all = (await traverse("", 100)).items;
  const drove = all
    .filter((item) => !item.formerMember && (item.last30Days?.acceptedTrips ?? 0) > 0)
    .map((item) => item.id)
    .sort();
  // ATS-only trips count; former, rejected, pending, alias and old trips do not.
  expect(drove).toEqual(keyed("tie", "tieLower", "exact", "round"));
  expect(baseline.former).toBe(all.filter(formerOf("former")).length);
  expect(baseline.active).toBe(all.filter(formerOf("active")).length);
  const expected = { ...baseline, droveLast30Days: drove.length };
  for (const query of [
    "limit=100",
    "limit=1",
    "search=zz-no-such-member",
    "status=former",
    "status=active&role=dispatcher",
    `ets2Level=${structuralLevels.ets2[1]}`,
    "sort=trips30d&order=asc&limit=2",
  ])
    expect((await page(query)).statusCounts, query).toEqual(expected);
  for (const query of ["", "status=active", "sort=lastTrip"]) {
    const { counts } = await traverse(query, 2);
    expect(counts.length, query).toBeGreaterThan(1);
    for (const value of counts) expect(value, query).toEqual(expected);
  }
});

test("droveLast30Days uses the page window, its inclusive edge and only accepted trips", async () => {
  const before = (await page("limit=1")).statusCounts as Counts;
  const root = newId();
  const edge = trip(ids.quiet as string, W - 30 * DAY, "2");
  const excluded = [
    trip(ids.old as string, W - DAY, "4", { id: root, decision: "rejected" }),
    trip(ids.old as string, W - DAY, "5", { decision: "pending_review" }),
  ];
  const alias = trip(ids.old as string, W, "6", { aliasOf: root });
  await unit.run((tx) =>
    unit
      .client(tx)
      .insert(trips)
      .values([edge, ...excluded]),
  );
  await unit.run((tx) => unit.client(tx).insert(trips).values(alias));
  try {
    const result = await traverse("", 1, () => {
      clock = W + 1;
    });
    expect([...result.windows]).toEqual([iso(W)]);
    for (const counts of result.counts)
      expect(counts).toEqual({ ...before, droveLast30Days: (before.droveLast30Days ?? 0) + 1 });
    expect(result.items.find((item) => item.id === ids.quiet)?.last30Days).toEqual({
      acceptedTrips: 1,
      actualDistanceM: "2",
    });
    // A fresh first page one millisecond later leaves the edge trip outside the window.
    clock = W + 1;
    const fresh = await page("limit=100");
    expect(fresh.windowEndsAt).toBe(iso(W + 1));
    expect(fresh.statusCounts).toEqual(before);
    expect(fresh.items.find((item) => item.id === ids.old)?.last30Days?.acceptedTrips).toBe(0);
  } finally {
    await unit.run(async (tx) => {
      await unit
        .client(tx)
        .delete(trips)
        .where(eq(trips.id, alias.id as string));
      for (const row of [edge, ...excluded])
        await unit
          .client(tx)
          .delete(trips)
          .where(eq(trips.id, row.id as string));
    });
  }
});

test("without Trips the counts omit droveLast30Days and the status filter still applies", async () => {
  const baseline = await baselineCounts();
  for (const target of [plainApp, levelsOnlyApp]) {
    for (const query of ["limit=100", "status=former&limit=100", "status=active&limit=1"]) {
      const data = await page(query, driverCookie, target);
      expect(data).not.toHaveProperty("windowEndsAt");
      expect(data.statusCounts, query).toEqual(baseline);
      expect(Object.keys(data.statusCounts as Counts).sort()).toEqual(["active", "former"]);
    }
    const former = (await traverse("status=former", 1, undefined, target)).items;
    expect(former.map((item) => item.id)).toContain(ids.former);
    expect(former.every((item) => item.formerMember)).toBe(true);
    const active = (await traverse("status=active", 2, undefined, target)).items;
    expect(active.length).toBe(baseline.active);
    expect(active.some((item) => item.formerMember)).toBe(false);
  }
});

test("each row shows its current level per game as listQualificationLevels returns it", async () => {
  const levels = await levelRows();
  const data = await page("limit=100");
  const at = (game: "ets2" | "ats", index: number) => {
    const id = structuralLevels[game][index] as string;
    const row = levels.get(id);
    return { id, name: row?.name, position: row?.position };
  };
  const byKey = (key: string) => data.items.find((item) => item.id === ids[key])?.levels;
  for (const key of ["tie", "tieLower"])
    expect(byKey(key), key).toEqual({ ets2: at("ets2", 0), ats: at("ats", 0) });
  expect(byKey("exact")).toEqual({ ets2: at("ets2", 1), ats: at("ats", 0) });
  expect(byKey("round")).toEqual({ ets2: null, ats: at("ats", 1) });
  expect(byKey("returner")).toEqual({ ets2: at("ets2", 0), ats: null });
  for (const key of ["former", "quiet", "old", "excluded"])
    expect(byKey(key), key).toEqual({ ets2: null, ats: null });
  for (const item of data.items) {
    for (const game of ["ets2", "ats"] as const) {
      const level = item.levels?.[game];
      if (!level) continue;
      expect(item.formerMember).toBe(false);
      const row = levels.get(level.id);
      expect(row?.game).toBe(game);
      expect(row?.position).not.toBeNull();
      expect(level).toEqual({ id: level.id, name: row?.name, position: row?.position });
    }
  }
  // The level filter and the shown level agree for every active level of each game.
  const all = (await traverse("", 100)).items;
  for (const [id, row] of levels) {
    if (row.position === null) continue;
    const filtered = (await traverse(`${row.game}Level=${id}`, 2)).ids;
    expect(filtered, `${row.game} ${row.name}`).toEqual(
      all
        .filter((item) => item.levels?.[row.game]?.id === id)
        .map((item) => item.id)
        .sort(),
    );
    for (const item of (await page(`${row.game}Level=${id}&limit=100`)).items)
      expect(item.levels?.[row.game]?.id).toBe(id);
  }
});

test("a level that left the active ladder shows null without leaking its name", async () => {
  const quiet = ids.quiet as string;
  const retired = newId();
  const assignment = newId();
  const name = "Fictional retired ladder level";
  const [[open]] = await control.query<RowDataPacket[]>(
    "SELECT CAST(id AS CHAR) id, DATE_FORMAT(assigned_at,'%Y-%m-%dT%H:%i:%s.%fZ') assignedAt FROM qualification_assignments WHERE user_id=? AND game='ets2' AND ended_at IS NULL",
    [quiet],
  );
  // A member with an open period moves it to the removed level; otherwise one is opened.
  const at = open ? new Date(String(open.assignedAt)).toISOString() : iso(W - 1000);
  await unit.run(async (tx) => {
    await unit.client(tx).insert(qualificationLevels).values({
      id: retired,
      game: "ets2",
      name,
      version: 1,
      position: null,
      deletedAt: at,
    });
    if (open)
      await unit
        .client(tx)
        .update(qualificationAssignments)
        .set({ endedAt: at })
        .where(eq(qualificationAssignments.id, String(open.id)));
    await unit
      .client(tx)
      .insert(qualificationAssignments)
      .values({
        id: assignment,
        userId: quiet,
        game: "ets2",
        levelId: retired,
        assignedAt: at,
        kind: "manual",
        comment: "Fictional retired level",
        previousAssignmentId: open ? String(open.id) : null,
      });
  });
  try {
    const response = await get("/api/v1/members?limit=100");
    expect(response.statusCode).toBe(200);
    const items = response.json().data.items as Item[];
    expect(items.find((item) => item.id === quiet)?.levels).toEqual({ ets2: null, ats: null });
    expect(response.body).not.toContain(name);
    expect((await get(`/api/v1/members?ets2Level=${retired}`)).statusCode).toBe(422);
    const direct = await unit.run((tx) => createDirectoryCurrentLevels(unit)(tx, [quiet]));
    expect(direct.get(quiet)).toEqual({ ets2: null, ats: null });
  } finally {
    await unit.run(async (tx) => {
      await unit
        .client(tx)
        .delete(qualificationAssignments)
        .where(eq(qualificationAssignments.id, assignment));
      if (open)
        await unit
          .client(tx)
          .update(qualificationAssignments)
          .set({ endedAt: null })
          .where(eq(qualificationAssignments.id, String(open.id)));
      await unit.client(tx).delete(qualificationLevels).where(eq(qualificationLevels.id, retired));
    });
  }
});

test("former members show no levels even when an assignment is still open", async () => {
  const former = ids.former as string;
  const [[openCount]] = await control.query<RowDataPacket[]>(
    "SELECT COUNT(*) n FROM qualification_assignments WHERE user_id=? AND game='ets2' AND ended_at IS NULL",
    [former],
  );
  expect(Number(openCount?.n)).toBe(0);
  const [[ended]] = await control.query<RowDataPacket[]>(
    "SELECT CAST(id AS CHAR) id, ended_at endedAt FROM qualification_assignments WHERE user_id=? AND game='ets2' AND ended_at IS NOT NULL ORDER BY assigned_at DESC LIMIT 1",
    [former],
  );
  if (!ended) throw new Error("SYNTHETIC_ENDED_ASSIGNMENT_MISSING");
  // A stale open period on its own must not give a former member a level.
  await control.query("UPDATE qualification_assignments SET ended_at=NULL WHERE id=?", [ended.id]);
  try {
    levelCalls.length = 0;
    const formerTab = await page("status=former&limit=100");
    expect(formerTab.items.find((item) => item.id === former)?.levels).toEqual({
      ets2: null,
      ats: null,
    });
    // Only former rows on the page: the lookup is not called at all.
    expect(levelCalls).toEqual([]);
    const all = await page("limit=100");
    expect(all.items.find((item) => item.id === former)?.levels).toEqual({
      ets2: null,
      ats: null,
    });
    expect(levelCalls.flat()).not.toContain(former);
  } finally {
    await control.query("UPDATE qualification_assignments SET ended_at=? WHERE id=?", [
      ended.endedAt,
      ended.id,
    ]);
  }
});

test("without Qualifications rows carry no levels and Trips facts stay", async () => {
  for (const target of [plainApp, tripsOnlyApp]) {
    const data = await page("limit=100", driverCookie, target);
    for (const item of data.items) expect(item).not.toHaveProperty("levels");
    expect(
      (await get(`/api/v1/members?ets2Level=${structuralLevels.ets2[0]}`, driverCookie, target))
        .statusCode,
    ).toBe(422);
  }
  const trips30 = await page("limit=100", driverCookie, tripsOnlyApp);
  const full = await page("limit=100");
  expect(trips30.windowEndsAt).toBe(iso(W));
  expect(trips30.statusCounts).toEqual(full.statusCounts);
  expect(trips30.statusCounts).toHaveProperty("droveLast30Days");
  expect(trips30.items).toEqual(full.items.map(({ levels: _levels, ...item }) => item));
});

test("current levels come from one bounded non-locking read per page", async () => {
  for (const limit of [2, 100]) {
    recorded.length = 0;
    levelCalls.length = 0;
    const data = await page(`limit=${limit}`);
    const reads = recorded.filter(
      (query) =>
        query.sql.includes("`qualification_assignments`") &&
        !query.sql.includes("directory_window_trips"),
    );
    expect(reads, `limit ${limit}`).toHaveLength(1);
    expect(reads[0]?.sql).not.toMatch(/for (share|update)/i);
    // Active rows of the page only; the lookahead row is not looked up.
    expect(levelCalls).toEqual([
      data.items.filter((item) => !item.formerMember).map((item) => item.id),
    ]);
  }
  const lookup = createDirectoryCurrentLevels(unit);
  const batch = Array.from({ length: 101 }, () => newId());
  const result = await unit.run((tx) => lookup(tx, batch));
  expect(result.size).toBe(101);
  for (const id of batch) expect(result.get(id)).toEqual({ ets2: null, ats: null });
  await expect(unit.run((tx) => lookup(tx, [...batch, newId()]))).rejects.toThrow(
    "DIRECTORY_LEVEL_BOUND_EXCEEDED",
  );
});

test("the directory waits for no qualification or trip row lock", async () => {
  const holder = await dedicatedConnection(guardedSettings());
  const members = [ids.tie, ids.exact, ids.round] as string[];
  try {
    await holder.query("START TRANSACTION");
    await holder.query("SELECT id FROM qualification_assignments WHERE user_id IN (?) FOR UPDATE", [
      members,
    ]);
    await holder.query("SELECT id FROM qualification_levels FOR UPDATE");
    await holder.query("SELECT id FROM trips WHERE owner_id IN (?) FOR UPDATE", [members]);
    let timer: NodeJS.Timeout | undefined;
    const bound = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), 5000);
    });
    try {
      for (const query of ["limit=100", "status=active&sort=trips30d&limit=2"]) {
        const response = await Promise.race([get(`/api/v1/members?${query}`), bound]);
        expect(response, query).not.toBe("timeout");
        if (response === "timeout") continue;
        expect(response.statusCode, query).toBe(200);
        const items = response.json().data.items as Item[];
        expect(items.find((item) => item.id === ids.tie)?.levels?.ets2).not.toBeNull();
      }
    } finally {
      clearTimeout(timer);
    }
  } finally {
    await holder.query("ROLLBACK");
    await holder.end();
  }
});
