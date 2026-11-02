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

export function levelsFixture(game: Game): DTO["EnvelopeListQualificationLevel"] {
  // Deliberately unsorted: the profile orders the ladder by code.
  const order = [2, 0, 3, 1];
  return {
    data: {
      items: order.map((index) => {
        const code = codes[index] ?? "trainee";
        return {
          id: levelId(game, code),
          game,
          code,
          name: levelNames[game][index] ?? code,
          version: 1,
          ruleVersionId: null,
          configured: true,
          requiredTrips: null,
          requiredDistanceM: null,
        };
      }),
      nextCursor: null,
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

export function profileFixture(id: string): DTO["EnvelopeMemberProfile"] {
  return { data: { member: member(id), qualifications: assignmentsOf(id) }, meta };
}

/** Public progress (no review fields): the shape `/members/{id}/qualification-progress` returns. */
export function progressFixture(id: string, game: Game): DTO["EnvelopeProgressPublic"] | null {
  const current = assignmentsOf(id).find((item) => item.game === game);
  if (!current) return null;
  const values =
    id === alphaId && game === "ets2"
      ? { acceptedTrips: 41, actualDistanceM: "52300000", requiredTrips: 80 as number | null }
      : id === alphaId
        ? { acceptedTrips: 50, actualDistanceM: "61200000", requiredTrips: 50 as number | null }
        : id === topId
          ? { acceptedTrips: 12, actualDistanceM: "9800000", requiredTrips: null }
          : { acceptedTrips: 3, actualDistanceM: "1250500", requiredTrips: 10 as number | null };
  const requiredDistanceM =
    id === alphaId && game === "ets2"
      ? "100000000"
      : id === alphaId
        ? "60000000"
        : id === topId
          ? null
          : "5000000";
  return {
    data: {
      assignment: current,
      ...values,
      requiredDistanceM,
      eligibleForConfirmation: id === alphaId && game === "ats",
      computedAt: "2026-11-15T11:00:00.000Z",
      projectionVersion: 3,
      projectionPending: false,
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
    retired: false,
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
      : "manual_confirmation",
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

/** Seven more ETS2 trips by AlphaHauler, so the company window holds twelve of theirs. */
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

/**
 * Accepted trip page. `company` mixes owners like the real latest-company window; `mine` holds
 * only the viewer's trips. The game filter applies before paging, as on the server.
 */
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
  const items = seeds
    .map((seed, index) => trip(seed, own ? index + 50 : index))
    .filter((item) => !game || item.game === game);
  return {
    data: { items, nextCursor: options.nextCursor ? "NONFUNCTIONAL_CURSOR" : null },
    meta,
  };
}
