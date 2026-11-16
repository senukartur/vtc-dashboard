import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createUnitOfWork, migrationFolder, newId, runMigrations, type UnitOfWork } from "@vtc/db";
import { membership, user } from "@vtc/db/identity-schema";
import { qualificationLevels } from "@vtc/db/qualifications-schema";
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
import { createDirectoryLevelFilter } from "../../apps/api/src/modules/qualifications/directory-level-filter.ts";
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
}

let control: Connection;
let unit: UnitOfWork;
let recording: UnitOfWork;
let identity: Identity;
let plain: Identity;
let app: Awaited<ReturnType<typeof createApp>>;
let plainApp: Awaited<ReturnType<typeof createApp>>;
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

// Records the final SQL of every select so the directory statement can be explained verbatim.
function recordingUnit(inner: UnitOfWork): UnitOfWork {
  function wrap(builder: object): object {
    return new Proxy(builder, {
      get(target, property) {
        const value = Reflect.get(target, property);
        if (property === "then" && typeof value === "function") {
          const query = (target as { toSQL?: () => { sql: string; params: unknown[] } }).toSQL?.();
          if (query?.sql.includes("directory_window_trips")) recorded.push(query);
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
  };
}

async function traverse(query: string, limit: number, beforeNext?: () => void) {
  const items: Item[] = [];
  const windows = new Set<string | undefined>();
  let cursor: string | null = null;
  for (let pages = 0; pages < 100; pages++) {
    const data = await page(
      `${query}${query ? "&" : ""}limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    expect(data.items.length).toBeLessThanOrEqual(limit);
    items.push(...data.items);
    windows.add(data.windowEndsAt);
    cursor = data.nextCursor;
    if (!cursor) break;
    beforeNext?.();
  }
  const seen = items.map((item) => item.id);
  expect(new Set(seen).size, `${query} has no duplicates`).toBe(seen.length);
  return { items, ids: seen, windows };
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
  identity = createIdentity(
    recording,
    identityConfig,
    {
      ...basePorts(unit),
      memberActivity: createMemberDirectoryActivity(),
      memberLevelFilter: createDirectoryLevelFilter(unit),
    },
    now,
  );
  // Without Trips and qualifications: no activity facts and no level filter.
  plain = createIdentity(unit, identityConfig, basePorts(unit), now);

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
}, SCHEMA_SETUP_TIMEOUT_MS);

beforeEach(async () => {
  clock = W;
  await control.query("DELETE FROM identity_limits");
});

afterAll(async () => {
  await app?.close();
  await plainApp?.close();
  await unit?.close();
  await control?.end();
});

test("directory rows carry the activity facts, zeros and null last trips without private fields", async () => {
  const data = await page("limit=100");
  expect(Object.keys(data).sort()).toEqual(["items", "nextCursor", "windowEndsAt"]);
  expect(data.windowEndsAt).toBe(iso(W));
  expect(data.nextCursor).toBeNull();
  expect(data.items.map((item) => item.id)).toEqual(expectedOrder());
  for (const item of data.items) {
    expect(Object.keys(item).sort()).toEqual([
      "formerMember",
      "id",
      "last30Days",
      "lastAcceptedTripAt",
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
      activePosition: null,
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
  expect(Object.keys(data).sort()).toEqual(["items", "nextCursor"]);
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
    "SELECT CAST(assigned_at AS CHAR) at FROM qualification_assignments WHERE user_id=? AND purpose='initial'",
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
  await control.query(await readFile(join(migrationFolder, "0033_joined_at_catch_up.sql"), "utf8"));
  const [after] = await control.query<RowDataPacket[]>(
    "SELECT CAST(user_id AS CHAR) id, CAST(joined_at AS CHAR) joined FROM identity_memberships ORDER BY user_id",
  );
  expect(after).toEqual(before);
});

test("the directory statement uses the accepted reporting index for its trip subqueries", async () => {
  recorded.length = 0;
  await page("sort=lastTrip&limit=5");
  const statement = recorded.at(-1);
  if (!statement) throw new Error("SYNTHETIC_DIRECTORY_SQL_MISSING");
  await control.query("ANALYZE TABLE trips, identity_users, identity_memberships");
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
