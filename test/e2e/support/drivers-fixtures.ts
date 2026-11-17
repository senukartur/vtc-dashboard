// Fictional, contract-typed driver profile fixtures. Pure data: no Playwright import, so the unit
// lane can validate every builder against the browser runtime schemas.
import type { components } from "@vtc/contracts";
import { fixtureId } from "../../../apps/web/src/features/account/fixtures.ts";

type DTO = components["schemas"];
type Game = "ets2" | "ats";

const meta = { requestId: "synthetic-driver-request" };

export const selfId = fixtureId;
export const alphaId = "41000000-0000-4000-8000-000000000101";
export const betaId = "41000000-0000-4000-8000-000000000102";
export const formerId = "41000000-0000-4000-8000-000000000103";
export const topId = "41000000-0000-4000-8000-000000000104";
export const unknownId = "41000000-0000-4000-8000-000000000199";

const codes = ["trainee", "driver_iii", "driver_ii", "driver_i"] as const;
const levelNames: Record<Game, readonly string[]> = {
  ets2: ["Trainee", "Driver III", "Driver II", "Driver I"],
  ats: ["Trainee", "Highway Driver III", "Highway Driver II", "Highway Driver I"],
};
/** Canonical level ID: never rendered, only matched against assignments. */
export function levelId(game: Game, code: (typeof codes)[number]) {
  return `52000000-0000-4000-8000-0000000000${game === "ets2" ? "1" : "2"}${codes.indexOf(code) + 1}`;
}

const openLimits: DTO["QualificationLimits"] = {
  massMinKg: null,
  massMaxKg: null,
  distanceMinM: null,
  distanceMaxM: null,
  trailers: { mode: "any", types: [] },
  adr: { mode: "any", classes: [] },
  hardModeRequired: false,
};
const ladderConditions = [
  { requiredTrips: 10, requiredDistanceM: "5000000" },
  { requiredTrips: 80, requiredDistanceM: "100000000" },
  { requiredTrips: 50, requiredDistanceM: "60000000" },
  { requiredTrips: null, requiredDistanceM: null },
];
const levelRef = (game: Game, index: number) => {
  const code = codes[index];
  return code ? { id: levelId(game, code), name: levelNames[game][index] ?? code } : null;
};

export function levelsFixture(game: Game): DTO["EnvelopeQualificationLevelList"] {
  // Deliberately unsorted: the profile orders the ladder by position.
  const order = [2, 0, 3, 1];
  return {
    data: {
      game,
      canManage: false,
      levels: order.map((index) => {
        const code = codes[index] ?? "trainee";
        return {
          id: levelId(game, code),
          game,
          position: index + 1,
          name: levelNames[game][index] ?? code,
          version: 1,
          limits: openLimits,
          conditions: ladderConditions[index] ?? ladderConditions[3],
          nextLevel: levelRef(game, index + 1),
          driverCount: 1,
        } as DTO["QualificationLevelSummary"];
      }),
      mine: null,
    },
    meta,
  };
}

function member(id: string): DTO["MemberSummary"] {
  if (id === selfId)
    return { id, nickname: "Fictional Yukon Member", formerMember: false, roles: ["trainee"] };
  if (id === alphaId)
    return { id, nickname: "AlphaHauler", formerMember: false, roles: ["driver", "dispatcher"] };
  if (id === betaId)
    return { id, nickname: "BetaTrainee", formerMember: false, roles: ["trainee"] };
  if (id === formerId)
    return { id, nickname: "GammaRetired", formerMember: true, roles: ["driver"] };
  return { id, nickname: "DeltaVeteran", formerMember: false, roles: ["driver"] };
}

function assignment(
  id: string,
  game: Game,
  code: (typeof codes)[number],
  assignedAt: string,
): DTO["Assignment"] {
  const suffix = `${id.slice(-3)}${game === "ets2" ? "1" : "2"}`;
  return {
    id: `53000000-0000-4000-8000-00000000${suffix}`.slice(0, 36),
    periodId: `54000000-0000-4000-8000-00000000${suffix}`.slice(0, 36),
    game,
    levelId: levelId(game, code),
    assignedAt,
  };
}

/** Assignments per fictional member. */
export function assignmentsOf(id: string): DTO["Assignment"][] {
  if (id === alphaId)
    return [
      assignment(id, "ets2", "driver_ii", "2026-08-20T09:00:00.000Z"),
      assignment(id, "ats", "driver_iii", "2026-07-01T09:00:00.000Z"),
    ];
  if (id === betaId) return [assignment(id, "ets2", "trainee", "2026-10-05T18:30:00.000Z")];
  if (id === selfId) return [assignment(id, "ets2", "trainee", "2026-09-01T12:00:00.000Z")];
  if (id === topId) return [assignment(id, "ets2", "driver_i", "2026-03-10T08:00:00.000Z")];
  return [];
}

/** Stage 4 profile facts per fictional member: latest join and accepted-trip totals. */
const profileFacts: Record<
  string,
  { memberSince: string; lastAcceptedTripAt: string; lifetimeTotals: DTO["LifetimeTripTotals"] }
> = {
  [selfId]: {
    memberSince: "2026-09-01T12:00:00.000Z",
    lastAcceptedTripAt: "2026-11-13T12:00:00.000Z",
    lifetimeTotals: { acceptedTrips: 2, actualDistanceM: "623000" },
  },
  [alphaId]: {
    memberSince: "2026-03-12T09:00:00.000Z",
    lastAcceptedTripAt: "2026-11-14T16:20:00.000Z",
    lifetimeTotals: { acceptedTrips: 253, actualDistanceM: "64585250" },
  },
  [betaId]: {
    memberSince: "2026-10-05T18:00:00.000Z",
    lastAcceptedTripAt: "2026-11-14T10:05:00.000Z",
    lifetimeTotals: { acceptedTrips: 1, actualDistanceM: "351000" },
  },
  [formerId]: {
    memberSince: "2025-06-01T10:00:00.000Z",
    lastAcceptedTripAt: "2026-02-10T20:30:00.000Z",
    lifetimeTotals: { acceptedTrips: 87, actualDistanceM: "21400000" },
  },
};

/**
 * Profile with the live Stage 4 fields. `trips`: "on" (default) has lifetime totals, the last
 * accepted trip and the directory's 30-day totals with their window end (VTC-160), "none" a member
 * without accepted trips (zero totals, null last trip), "off" the shape without the Trips module
 * (all absent, never zero).
 */
export function profileFixture(
  id: string,
  trips: "on" | "none" | "off" = "on",
): DTO["EnvelopeMemberProfile"] {
  const facts = profileFacts[id] ?? {
    memberSince: "2026-01-20T08:00:00.000Z",
    lastAcceptedTripAt: "2026-11-11T19:00:00.000Z",
    lifetimeTotals: { acceptedTrips: 12, actualDistanceM: "9800000" },
  };
  return {
    data: {
      member: member(id),
      qualifications: assignmentsOf(id),
      memberSince: facts.memberSince,
      ...(trips === "on"
        ? {
            lifetimeTotals: facts.lifetimeTotals,
            lastAcceptedTripAt: facts.lastAcceptedTripAt,
            last30Days: directoryLast30Days(id),
            last30DaysEndsAt: directoryWindowEndsAt,
          }
        : trips === "none"
          ? {
              lifetimeTotals: { acceptedTrips: 0, actualDistanceM: "0" },
              lastAcceptedTripAt: null,
              last30Days: { acceptedTrips: 0, actualDistanceM: "0" },
              last30DaysEndsAt: directoryWindowEndsAt,
            }
          : {}),
    },
    meta,
  };
}

/** Public qualifications: the shape `/members/{id}/qualifications` returns. */
export function qualificationsFixture(id: string): DTO["EnvelopeMyQualificationList"] {
  const progressOf = (game: Game) =>
    id === alphaId && game === "ets2"
      ? { trips: 41, distanceM: "52300000" }
      : id === alphaId
        ? { trips: 50, distanceM: "61200000" }
        : id === topId
          ? { trips: 12, distanceM: "9800000" }
          : { trips: 3, distanceM: "1250500" };
  return {
    data: {
      items: assignmentsOf(id).map((current) => {
        const index = codes.findIndex((code) => levelId(current.game, code) === current.levelId);
        const level = levelRef(current.game, index);
        return {
          game: current.game,
          level: level ? { ...level, position: index + 1 } : null,
          since: current.assignedAt,
          progress: progressOf(current.game),
          conditions: ladderConditions[index] ?? null,
          nextLevel: levelRef(current.game, index + 1),
        };
      }),
    },
    meta,
  };
}

const perGame: Record<Game, readonly [number, string][]> = {
  ets2: [
    [6, "1510000"],
    [8, "1880000"],
    [5, "1600000"],
    [9, "2090000"],
    [7, "1920000"],
    [11, "2410000"],
    [12, "2630000"],
    [9, "2004500"],
    [10, "2250000"],
    [13, "2890000"],
    [14, "3120000"],
    [4, "1190000"],
  ],
  ats: [
    [1, "310000"],
    [2, "360000"],
    [2, "380000"],
    [3, "520000"],
    [2, "510000"],
    [4, "670000"],
    [4, "730000"],
    [3, "600000"],
    [2, "450000"],
    [3, "640000"],
    [4, "880000"],
    [1, "292000"],
  ],
};

function monthStarts(fromDate: string, count: number) {
  const [year = 2025, month = 12] = fromDate.split("-").map(Number);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1 + index, 1));
    return date.toISOString().slice(0, 10);
  });
}

/** Twelve dense month buckets for the requested window; totals are exact bucket sums. */
export function analyticsFixture(
  search: URLSearchParams,
  options: { empty?: boolean } = {},
): DTO["EnvelopeAnalytics"] {
  const fromDate = search.get("fromDate") ?? "2025-12-01";
  const toDateExclusive = search.get("toDateExclusive") ?? "2026-12-01";
  const game = search.get("game");
  const games: Game[] = game === "ets2" || game === "ats" ? [game] : ["ets2", "ats"];
  const buckets = monthStarts(fromDate, 12).map((date, index) => {
    if (options.empty) return { date, acceptedTrips: 0, actualDistanceM: "0" };
    let trips = 0;
    let distance = 0n;
    for (const g of games) {
      const [t, d] = perGame[g][index] ?? [0, "0"];
      trips += t;
      distance += BigInt(d);
    }
    return { date, acceptedTrips: trips, actualDistanceM: String(distance) };
  });
  return {
    data: {
      acceptedTrips: buckets.reduce((sum, bucket) => sum + bucket.acceptedTrips, 0),
      actualDistanceM: String(
        buckets.reduce((sum, bucket) => sum + BigInt(bucket.actualDistanceM), 0n),
      ),
      reportingTimezone: "Europe/Moscow",
      fromDate,
      toDateExclusive,
      granularity: "month",
      buckets,
      computedAt: "2026-11-15T11:00:00.000Z",
      projectionVersion: 3,
      projectionPending: false,
    },
    meta,
  };
}

function label(entityId: string, text: string, englishFallback = false): DTO["CatalogLabel"] {
  return {
    entityId,
    label: text,
    requestedLocale: "ru",
    renderedLocale: englishFallback ? "en" : "ru",
    englishFallback,
    hidden: false,
  };
}

type TripSeed = {
  owner: string;
  game: Game;
  route: [string, string];
  cargo: string | null;
  km: string | null;
  at: string;
  sources: DTO["TripSummary"]["sourceKinds"];
  fallback?: boolean;
};

function trip(seed: TripSeed, index: number): DTO["TripSummary"] {
  const n = String(index + 1).padStart(3, "0");
  return {
    view: "summary",
    id: `55000000-0000-4000-8000-000000000${n}`,
    version: 1,
    owner: member(seed.owner),
    game: seed.game,
    outcome: "delivered",
    decision: "accepted",
    origin: label(`60000000-0000-4000-8000-000000000${n}`, seed.route[0], seed.fallback),
    destination: label(`61000000-0000-4000-8000-000000000${n}`, seed.route[1]),
    cargo: seed.cargo ? label(`62000000-0000-4000-8000-000000000${n}`, seed.cargo) : null,
    actualDistanceM: seed.km,
    reportingAt: seed.at,
    sourceKinds: seed.sources,
    recording: "complete",
    reportingBasis: seed.sources.includes("ets2telemetry")
      ? "actual_completion"
      : seed.sources.includes("manual")
        ? "manual_confirmation"
        : "unknown",
  };
}

const companySeeds: TripSeed[] = [
  {
    owner: alphaId,
    game: "ets2",
    route: ["Осло", "Гётеборг"],
    cargo: "Рыба охлаждённая",
    km: "293000",
    at: "2026-11-14T16:20:00.000Z",
    sources: ["manual"],
  },
  {
    owner: betaId,
    game: "ets2",
    route: ["Берлин", "Прага"],
    cargo: "Бумага",
    km: "351000",
    at: "2026-11-14T10:05:00.000Z",
    sources: ["ets2telemetry"],
  },
  {
    owner: alphaId,
    game: "ats",
    route: ["Grand Junction", "Шайенн"],
    cargo: "Стройматериалы",
    km: "172400",
    at: "2026-11-13T21:40:00.000Z",
    sources: ["ets2telemetry"],
    fallback: true,
  },
  {
    owner: alphaId,
    game: "ets2",
    route: ["Тулуза", "Барселона"],
    cargo: "Оливковое масло",
    km: "398000",
    at: "2026-11-12T08:15:00.000Z",
    sources: ["ets2telemetry", "manual"],
  },
  {
    owner: topId,
    game: "ets2",
    route: ["Вена", "Будапешт"],
    cargo: "Химикаты",
    km: "243000",
    at: "2026-11-11T19:00:00.000Z",
    sources: ["ets2telemetry"],
  },
  {
    owner: alphaId,
    game: "ets2",
    route: ["Санкт-Петербург", "Великий Новгород"],
    cargo: "Металлоконструкции",
    km: null,
    at: "2026-11-10T13:30:00.000Z",
    sources: [],
  },
  {
    owner: alphaId,
    game: "ats",
    route: ["Сиэтл", "Портленд"],
    cargo: null,
    km: "285000",
    at: "2026-11-09T07:45:00.000Z",
    sources: ["ets2telemetry"],
  },
];

/** Seven more ETS2 trips by AlphaHauler, so the owner filter has more than one page. */
const bulkSeeds: TripSeed[] = Array.from({ length: 7 }, (_, index) => ({
  owner: alphaId,
  game: "ets2" as const,
  route: ["Берлин", "Гамбург"] as [string, string],
  cargo: "Бумага",
  km: String(280000 + index * 1000),
  at: `2026-11-0${8 - index}T10:00:00.000Z`,
  sources: ["ets2telemetry" as const],
}));

const ownSeeds: TripSeed[] = [
  {
    owner: selfId,
    game: "ets2",
    route: ["Гамбург", "Берлин"],
    cargo: "Продукты",
    km: "289000",
    at: "2026-11-13T12:00:00.000Z",
    sources: ["ets2telemetry"],
  },
  {
    owner: selfId,
    game: "ets2",
    route: ["Прага", "Вена"],
    cargo: "Сталь",
    km: "334000",
    at: "2026-11-02T09:30:00.000Z",
    sources: ["manual"],
  },
];

/** Accepted fixture page with owner/game filters applied before limit. */
export function tripsFixture(
  search: URLSearchParams,
  options: { nextCursor?: boolean; empty?: boolean; bulk?: boolean } = {},
): DTO["EnvelopeListTripSummary"] {
  const own = search.get("scope") === "mine";
  const game = search.get("game");
  const seeds = options.empty
    ? []
    : own
      ? ownSeeds
      : options.bulk
        ? [...companySeeds, ...bulkSeeds]
        : companySeeds;
  const ownerId = search.get("ownerId");
  const matches = seeds
    .map((seed, index) => trip(seed, own ? index + 50 : index))
    .filter((item) => (!game || item.game === game) && (!ownerId || item.owner.id === ownerId));
  if (search.get("order") === "completion_desc") {
    const completion = (item: DTO["TripSummary"]) =>
      item.reportingBasis === "actual_completion" ? (item.reportingAt ?? "") : "";
    matches.sort((a, b) => completion(b).localeCompare(completion(a)));
  }
  const limit = Number(search.get("limit") ?? 100);
  return {
    data: {
      items: matches.slice(0, limit),
      total: matches.length,
      nextCursor: options.nextCursor || matches.length > limit ? "NONFUNCTIONAL_CURSOR" : null,
    },
    meta,
  };
}

// Drivers directory (VTC-145): a server-like listMembers over 18 active and 4 former fictional
// members, with filter-bound cursors and the Trips-off and Qualifications-off shapes.

export const directoryWindowEndsAt = "2026-11-14T12:00:00.000Z";

type Code = (typeof codes)[number];
export type DirectorySeed = Seed;
type Seed = {
  id: string;
  nickname: string;
  roles: DTO["MemberStage4DirectoryEntry"]["roles"];
  former?: boolean;
  trips: number;
  km: string;
  last: string | null;
  ets2?: Code;
  ats?: Code;
};

const seedId = (n: number) => `41000000-0000-4000-8000-000000000${String(200 + n)}`;
function seed(
  id: string,
  nickname: string,
  roles: Seed["roles"],
  activity: [number, string, string | null],
  levels: { ets2?: Code; ats?: Code } = {},
): Seed {
  const [trips, km, last] = activity;
  return { id, nickname, roles, trips, km, last, ...levels };
}
const activeSeeds: Seed[] = [
  seed(selfId, "Fictional Yukon Member", ["trainee"], [2, "623000", "2026-11-13T12:00:00.000Z"], {
    ets2: "trainee",
  }),
  seed(
    alphaId,
    "AlphaHauler",
    ["driver", "dispatcher"],
    [14, "4210000", "2026-11-14T16:20:00.000Z"],
    { ets2: "driver_ii", ats: "driver_iii" },
  ),
  seed(betaId, "BetaTrainee", ["trainee"], [1, "351000", "2026-11-14T10:05:00.000Z"], {
    ets2: "trainee",
  }),
  seed(topId, "DeltaVeteran", ["driver"], [6, "1650000", "2026-11-11T19:00:00.000Z"], {
    ets2: "driver_i",
  }),
  seed(seedId(1), "EchoRunner", ["driver"], [9, "3150000", "2026-11-13T09:30:00.000Z"], {
    ets2: "driver_ii",
    ats: "driver_ii",
  }),
  seed(seedId(2), "FoxtrotLane", ["driver"], [0, "0", null], { ets2: "driver_iii" }),
  seed(seedId(3), "GolfCarrier", ["driver"], [0, "0", "2026-09-02T18:00:00.000Z"], {
    ats: "driver_iii",
  }),
  seed(seedId(4), "HotelTransit", ["driver"], [4, "1020000", "2026-11-09T07:45:00.000Z"], {
    ets2: "driver_iii",
    ats: "driver_i",
  }),
  seed(seedId(5), "IndiaCargo", ["trainee"], [3, "765000", "2026-11-08T21:00:00.000Z"], {
    ets2: "trainee",
  }),
  seed(seedId(6), "JulietRoute", ["driver"], [11, "3980000", "2026-11-12T08:15:00.000Z"], {
    ets2: "driver_i",
    ats: "driver_ii",
  }),
  seed(seedId(7), "KiloFreight", ["driver"], [5, "1410000", "2026-11-10T13:30:00.000Z"], {
    ets2: "driver_ii",
  }),
  seed(
    seedId(8),
    "LimaConvoy",
    ["driver", "dispatcher"],
    [7, "2050000", "2026-11-11T11:00:00.000Z"],
    { ets2: "driver_iii" },
  ),
  seed(seedId(9), "MikeHauler", ["driver"], [2, "540000", "2026-10-30T17:20:00.000Z"]),
  seed(seedId(10), "NovemberRig", ["trainee"], [0, "0", null]),
  seed(
    seedId(11),
    "OscarTrail",
    ["director", "driver"],
    [8, "2630000", "2026-11-12T19:40:00.000Z"],
    { ets2: "driver_i", ats: "driver_i" },
  ),
  seed(
    seedId(12),
    "PapaLogistics",
    ["deputy_director", "driver"],
    [10, "3320000", "2026-11-13T15:10:00.000Z"],
    { ets2: "driver_ii", ats: "driver_iii" },
  ),
  seed(seedId(13), "QuebecMile", ["driver"], [1, "298000", "2026-11-01T06:00:00.000Z"], {
    ats: "trainee",
  }),
  seed(
    seedId(14),
    "Romeo Long Distance Hauler of the Northern Routes",
    ["driver"],
    [12, "4480000", "2026-11-14T08:00:00.000Z"],
    { ets2: "driver_ii", ats: "driver_ii" },
  ),
];
const formerSeeds: Seed[] = [
  seed(formerId, "GammaRetired", [], [0, "0", "2026-02-10T20:30:00.000Z"]),
  seed(seedId(15), "SierraPast", [], [1, "420000", "2026-11-02T16:45:00.000Z"]),
  seed(seedId(16), "TangoEarlier", [], [0, "0", null]),
  seed(seedId(17), "UniformGone", [], [0, "0", "2026-06-18T10:00:00.000Z"]),
].map((item) => ({ ...item, former: true }));

/** The fictional directory population, in no particular order. */
export const directoryMembers = { active: activeSeeds, former: formerSeeds };

/** A member's directory 30-day totals, which the profile repeats for the same window. */
export function directoryLast30Days(id: string): DTO["AnalyticsStage4Totals"] {
  const item = [...activeSeeds, ...formerSeeds].find((entry) => entry.id === id);
  return { acceptedTrips: item?.trips ?? 0, actualDistanceM: item?.km ?? "0" };
}

function levelOf(game: Game, code: Code | undefined) {
  if (!code) return null;
  const index = codes.indexOf(code);
  return { id: levelId(game, code), name: levelNames[game][index] ?? code, position: index + 1 };
}

export type DirectoryOptions = {
  tripsOff?: boolean;
  qualificationsOff?: boolean;
  empty?: boolean;
  /** Serve pages of at most this many rows, so the 18 members span several pages. */
  pageCap?: number;
  /** A mutable copy of the members that access commands change (VTC-160). */
  population?: { active: Seed[]; former: Seed[] };
};

/** A fresh, independently mutable copy of the directory members. */
export function directoryPopulation(): { active: Seed[]; former: Seed[] } {
  const copy = (item: Seed): Seed => ({ ...item, roles: [...item.roles] });
  return { active: activeSeeds.map(copy), former: formerSeeds.map(copy) };
}

function entry(item: Seed, options: DirectoryOptions): DTO["MemberStage4DirectoryEntry"] {
  return {
    id: item.id,
    nickname: item.nickname,
    formerMember: !!item.former,
    roles: item.roles,
    ...(options.tripsOff
      ? {}
      : {
          last30Days: { acceptedTrips: item.trips, actualDistanceM: item.km },
          lastAcceptedTripAt: item.last,
        }),
    ...(options.qualificationsOff
      ? {}
      : {
          levels: item.former
            ? { ets2: null, ats: null }
            : { ets2: levelOf("ets2", item.ets2), ats: levelOf("ats", item.ats) },
        }),
  };
}

/** Company-wide counters: constant under every filter, tab and cursor. */
export function directoryCounts(
  options: DirectoryOptions = {},
): DTO["MemberStage4DirectoryCounts"] {
  const { active, former } = options.population ?? { active: activeSeeds, former: formerSeeds };
  return {
    active: active.length,
    former: former.length,
    ...(options.tripsOff
      ? {}
      : { droveLast30Days: active.filter((item) => item.trips > 0).length }),
  };
}

export type DirectoryResult =
  | { status: 200; body: DTO["MemberStage4DirectoryListEnvelope"] }
  | { status: 409 | 422; body: { error: { code: string } } };

const sortKeys = ["nickname", "distance30d", "trips30d", "lastTrip"];
const reject = (status: 409 | 422, code: string): DirectoryResult => ({
  status,
  body: { error: { code } },
});

/** The cursor binding: every parameter except the cursor and the page size. */
function binding(search: URLSearchParams) {
  const bound = new URLSearchParams(search);
  bound.delete("cursor");
  bound.delete("limit");
  bound.sort();
  return bound.toString();
}

function compareBy(sort: string | null, direction: 1 | -1) {
  return (a: Seed, b: Seed) => {
    if (sort === "lastTrip" && (a.last === null || b.last === null))
      return a.last === b.last ? 0 : a.last === null ? 1 : -1;
    const value =
      sort === "nickname"
        ? a.nickname.toLowerCase().localeCompare(b.nickname.toLowerCase())
        : sort === "distance30d"
          ? Number(a.km) - Number(b.km)
          : sort === "trips30d"
            ? a.trips - b.trips
            : sort === "lastTrip"
              ? (a.last ?? "").localeCompare(b.last ?? "")
              : 0;
    return value * direction;
  };
}

/** Server-like `GET /members`: validation (422), filter-bound cursors (409), sort and page. */
export function directoryResponse(
  search: URLSearchParams,
  options: DirectoryOptions = {},
): DirectoryResult {
  const status = search.get("status");
  const sort = search.get("sort");
  const order = search.get("order");
  const role = search.get("role");
  const term = search.get("search");
  if (status && status !== "active" && status !== "former") return reject(422, "VALIDATION");
  if (sort && !sortKeys.includes(sort)) return reject(422, "VALIDATION");
  if (order && (!sort || (order !== "asc" && order !== "desc"))) return reject(422, "VALIDATION");
  if (term !== null && (!term.trim() || Array.from(term.trim()).length > 128))
    return reject(422, "VALIDATION");
  if (options.tripsOff && sort && sort !== "nickname") return reject(422, "TRIPS_UNAVAILABLE");
  for (const game of ["ets2", "ats"] as const) {
    const value = search.get(`${game}Level`);
    if (value === null) continue;
    if (options.qualificationsOff) return reject(422, "QUALIFICATIONS_UNAVAILABLE");
    if (!codes.some((code) => levelId(game, code) === value)) return reject(422, "UNKNOWN_LEVEL");
  }
  const limit = Math.min(Number(search.get("limit") ?? 25), options.pageCap ?? 100);
  const cursor = search.get("cursor");
  let offset = 0;
  if (cursor) {
    const separator = cursor.indexOf("|");
    const position = Number(cursor.slice("fixture-directory:".length, separator));
    if (
      !cursor.startsWith("fixture-directory:") ||
      separator < 0 ||
      !Number.isInteger(position) ||
      cursor.slice(separator + 1) !== binding(search)
    )
      return reject(409, "VERSION_CONFLICT");
    offset = position;
  }
  const population = options.population ?? { active: activeSeeds, former: formerSeeds };
  const pool = options.empty
    ? []
    : status === "active"
      ? population.active
      : status === "former"
        ? population.former
        : [...population.active, ...population.former];
  const needle = term?.trim().toLowerCase();
  const matches = pool.filter((item) => {
    if (needle && !item.nickname.toLowerCase().includes(needle)) return false;
    if (role && !item.roles.includes(role as Seed["roles"][number])) return false;
    for (const game of ["ets2", "ats"] as const) {
      const value = search.get(`${game}Level`);
      if (value && (item.former || levelOf(game, item[game])?.id !== value)) return false;
    }
    return true;
  });
  const direction = (order ?? (sort === "nickname" ? "asc" : "desc")) === "asc" ? 1 : -1;
  const compare = compareBy(sort, direction);
  matches.sort((a, b) => compare(a, b) || a.id.localeCompare(b.id));
  const next =
    offset + limit < matches.length
      ? `fixture-directory:${offset + limit}|${binding(search)}`
      : null;
  return {
    status: 200,
    body: {
      data: {
        items: matches.slice(offset, offset + limit).map((item) => entry(item, options)),
        nextCursor: next,
        ...(options.tripsOff ? {} : { windowEndsAt: directoryWindowEndsAt }),
        statusCounts: directoryCounts(options),
      },
      meta,
    },
  };
}

// Access panel (VTC-160): the Members page reads for one directory member. The email is a
// fictional example.invalid address that the panel must never render.

/** `GET /admin/members/{id}`: the administration view of a directory member at `version`. */
export function directoryAdminMember(item: Seed, version: number): DTO["EnvelopeMemberAdmin"] {
  return {
    data: {
      accessEpoch: 1,
      email: `member-${item.id.slice(-3)}@example.invalid`,
      identityEpoch: 1,
      lastAcceptedTripAt: item.last,
      profile: {
        member: {
          id: item.id,
          nickname: item.nickname,
          formerMember: !!item.former,
          roles: item.roles,
        },
        qualifications: [],
      },
      status: item.former ? "inactive" : "active",
      version,
    },
    meta,
  };
}

/** `GET /members/{id}` for a directory member: the panel's "in the company since" line. */
export function directoryProfile(item: Seed, options: DirectoryOptions = {}) {
  const profile: DTO["EnvelopeMemberProfile"] = {
    data: {
      member: {
        id: item.id,
        nickname: item.nickname,
        formerMember: !!item.former,
        roles: item.roles,
      },
      qualifications: [],
      memberSince: "2026-09-12T09:00:00.000Z",
      ...(options.tripsOff
        ? {}
        : {
            lastAcceptedTripAt: item.last,
            last30Days: { acceptedTrips: item.trips, actualDistanceM: item.km },
            last30DaysEndsAt: directoryWindowEndsAt,
          }),
    },
    meta,
  };
  return profile;
}

/** `GET /admin/reinstatement-options`: the active ladders of both games. */
export function reinstatementOptionsFixture(): DTO["EnvelopeReinstatementOptions"] {
  return {
    data: {
      levels: (["ets2", "ats"] as const).flatMap((game) =>
        codes.map((code, index) => ({
          id: levelId(game, code),
          game,
          position: index + 1,
          name: levelNames[game][index] ?? code,
        })),
      ),
    },
    meta,
  };
}

// Invitations (applications.manage): fictional applicants with example.invalid addresses that
// the page must never render.
const invitationSeeds: Record<"active" | "expired", [string, string][]> = {
  active: [
    ["Fictional Applicant One", "2026-11-20T12:00:00.000Z"],
    ["Fictional Applicant Two", "2026-11-22T09:30:00.000Z"],
  ],
  expired: [["Fictional Late Applicant", "2026-11-01T08:00:00.000Z"]],
};

export function invitationsFixture(search: URLSearchParams): DTO["InvitationStage4ListEnvelope"] {
  const state = search.get("state") === "expired" ? "expired" : "active";
  const limit = Number(search.get("limit") ?? 25);
  const seeds = invitationSeeds[state];
  const items: DTO["InvitationStage4ListItem"][] = seeds
    .slice(0, limit)
    .map(([nickname, expiresAt], index) => {
      const n = `${state === "active" ? 6 : 7}0${index}`;
      return {
        invitation: {
          id: `41500000-0000-4000-8000-000000000${n}`,
          version: 1,
          applicationId: `41500000-0000-4000-8000-000000001${n}`,
          expiresAt,
          state,
          emailDelivery: "accepted" as const,
          deliveryId: null,
        },
        applicant: { nickname, email: `applicant-${n}@example.invalid` },
      };
    });
  return {
    data: {
      items,
      nextCursor: seeds.length > limit ? "fixture-invitations-next" : null,
      total: seeds.length,
    },
    meta,
  };
}
