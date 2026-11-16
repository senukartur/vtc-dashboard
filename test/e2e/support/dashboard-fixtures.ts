// Synthetic overview fixtures: recent company trips and nearest convoy blocks (VTC-055), the
// public company stats that carry the reporting timezone for the period anchors (VTC-056), and
// the company analytics, leaderboard and trip breakdowns in their live Stage 4 shape (VTC-148).
// Pure data without Playwright imports, so unit tests parse every fixture with the runtime schemas.
import type { components } from "@vtc/contracts";
import { fixtureId } from "../../../apps/web/src/features/account/fixtures.ts";

type S = components["schemas"];

const meta = { requestId: "synthetic-dashboard-request" };

/** The first event starts 3 d 4 h 30 min after this fixed test time. */
export const overviewNow = "2099-11-02T13:30:00.000Z";
export const upcomingEventId = "70000000-0000-4000-8000-000000000001";
export const nextEventId = "70000000-0000-4000-8000-000000000002";

export type FixtureLocale = "en" | "ru";

/** Fictional catalog places with fixed IDs; a null Russian name renders the English fallback. */
const places = {
  berlin: { id: "60000000-0000-4000-8000-000000000101", en: "Berlin", ru: "Берлин" },
  warszawa: { id: "60000000-0000-4000-8000-000000000102", en: "Warszawa", ru: "Варшава" },
  seattle: { id: "60000000-0000-4000-8000-000000000103", en: "Seattle", ru: "Сиэтл" },
  portland: { id: "60000000-0000-4000-8000-000000000104", en: "Portland", ru: "Портленд" },
  praha: { id: "60000000-0000-4000-8000-000000000105", en: "Praha", ru: "Прага" },
  wien: { id: "60000000-0000-4000-8000-000000000106", en: "Wien", ru: null },
  phoenix: { id: "60000000-0000-4000-8000-000000000107", en: "Phoenix", ru: "Финикс" },
  petersburg: {
    id: "60000000-0000-4000-8000-000000000108",
    en: "Saint Petersburg",
    ru: "Санкт-Петербург",
  },
  novgorod: {
    id: "60000000-0000-4000-8000-000000000109",
    en: "Nizhny Novgorod",
    ru: "Нижний Новгород",
  },
} as const satisfies Record<string, { id: string; en: string; ru: string | null }>;

/** The label as the API renders it for `locale`: requested locale, rendered locale and fallback. */
function place(name: keyof typeof places, locale: FixtureLocale): S["CatalogLabel"] {
  const entry: { id: string; en: string; ru: string | null } = places[name];
  const russian = locale === "ru" ? entry.ru : null;
  return {
    entityId: entry.id,
    label: russian ?? entry.en,
    requestedLocale: locale,
    renderedLocale: russian === null ? "en" : "ru",
    englishFallback: locale === "ru" && russian === null,
    hidden: false,
  };
}

function trip(
  index: number,
  values: {
    game: S["TripSummary"]["game"];
    origin: S["CatalogLabel"] | null;
    destination: S["CatalogLabel"] | null;
    driver: string;
    actualDistanceM: string | null;
    reportingAt: string | null;
  },
): S["TripSummary"] {
  return {
    view: "summary",
    id: `05500000-0000-4000-8000-00000000000${index}`,
    version: 1,
    owner: {
      id: `41000000-0000-4000-8000-00000000055${index}`,
      nickname: values.driver,
      formerMember: false,
      roles: ["driver"],
    },
    game: values.game,
    outcome: "delivered",
    decision: "accepted",
    origin: values.origin,
    destination: values.destination,
    cargo: null,
    actualDistanceM: values.actualDistanceM,
    reportingAt: values.reportingAt,
    sourceKinds: [values.game === "ets2" ? "ets2telemetry" : "manual"],
    recording: "complete",
    reportingBasis: values.game === "ets2" ? "actual_completion" : "manual_confirmation",
  };
}

/**
 * Five accepted company trips as rendered for `locale`: a null distance (`Unavailable`), an
 * English-fallback label in Russian, an unknown origin, a missing counted time and long Russian
 * place names. IDs, drivers and values do not depend on the locale.
 */
export function recentTrips(locale: FixtureLocale = "en"): S["TripSummary"][] {
  return [
    trip(1, {
      game: "ets2",
      origin: place("berlin", locale),
      destination: place("warszawa", locale),
      driver: "AlphaDriver",
      actualDistanceM: "580000",
      reportingAt: "2099-11-01T14:30:00.000Z",
    }),
    trip(2, {
      game: "ats",
      origin: place("seattle", locale),
      destination: place("portland", locale),
      driver: "BetaHauler",
      actualDistanceM: null,
      reportingAt: "2099-11-01T09:15:00.000Z",
    }),
    trip(3, {
      game: "ets2",
      origin: place("praha", locale),
      destination: place("wien", locale),
      driver: "NightConvoyCaptain",
      actualDistanceM: "334000",
      reportingAt: "2099-10-31T20:05:00.000Z",
    }),
    trip(4, {
      game: "ats",
      origin: null,
      destination: place("phoenix", locale),
      driver: "CedarWolf",
      actualDistanceM: "1103000",
      reportingAt: null,
    }),
    trip(5, {
      game: "ets2",
      origin: place("petersburg", locale),
      destination: place("novgorod", locale),
      driver: "PolarBear",
      actualDistanceM: "1250000",
      reportingAt: "2099-10-30T07:45:00.000Z",
    }),
  ];
}
/** The English rendering, for tests that only need IDs, drivers and values. */
export const recentTripItems = recentTrips("en");

export function makeRecentTripsFixture(items: S["TripSummary"][] = recentTripItems) {
  return {
    data: { items, nextCursor: items.length >= 5 ? "NONFUNCTIONAL_CURSOR" : null },
    meta,
  } satisfies S["EnvelopeListTripSummary"];
}

export const upcomingEvent: S["EventPublic"] = {
  id: upcomingEventId,
  version: 1,
  title: "Autumn Yukon Convoy 2026",
  description: "Annual Autumn European Convoy for Yukon Union drivers",
  game: "ets2",
  startsAt: "2099-11-05T18:00:00.000Z",
  endsAt: "2099-11-05T21:00:00.000Z",
  status: "scheduled",
  origin: null,
  destination: null,
  server: "Simulation 1",
  organizer: "Yukon Staff",
  meetingLocation: "Berlin Quarry",
  route: "Berlin -> Hamburg -> Amsterdam",
  meetingAt: "2099-11-05T17:30:00.000Z",
};

/** What the endpoint returns once the first event has started. */
export const nextUpcomingEvent: S["EventPublic"] = {
  ...upcomingEvent,
  id: nextEventId,
  title: "Winter Baltic Convoy",
  description: "Fictional winter convoy along the Baltic coast",
  startsAt: "2099-11-12T18:00:00.000Z",
  endsAt: "2099-11-12T21:00:00.000Z",
  meetingAt: "2099-11-12T17:30:00.000Z",
  route: "Gdańsk -> Riga -> Tallinn",
};

export function makeOptionalEventFixture(event: S["EventPublic"] | null = upcomingEvent) {
  return { data: event, meta } satisfies S["EnvelopeOptionalEvent"];
}

export function makeRsvpFixture(
  response: S["Rsvp"]["response"] = "unanswered",
  version = 1,
  declineReason: string | null = null,
) {
  return { data: { response, version, declineReason }, meta } satisfies S["EnvelopeRsvp"];
}

export function makeResponseCountsFixture(participating = 8, declined = 2) {
  return {
    data: { participating, declined },
    meta,
  } satisfies S["EnvelopeEventResponseCounts"];
}

/**
 * Public company stats; the overview reads only `currentMonth.reportingTimezone`. A null zone is
 * the unavailable month the API returns when the company has no reporting timezone.
 */
export function makeCompanyStatsFixture(
  reportingTimezone: string | null,
): S["EnvelopeCompanyStatsPublic"] {
  return {
    data: {
      activeMembers: 3,
      computedAt: "2026-10-26T12:00:00.000Z",
      currentMonth:
        reportingTimezone === null
          ? { status: "unavailable", reason: "company_reporting_timezone" }
          : {
              status: "available",
              month: "2026-10",
              fromDate: "2026-10-01",
              toDateExclusive: "2026-11-01",
              reportingTimezone,
              acceptedTrips: 42,
              actualDistanceM: "125430000",
              games: ["ets2", "ats"],
            },
    },
    meta,
  };
}

// Company analytics, leaderboard and trip breakdowns (VTC-148). Range totals add up across the
// games (ETS2 20 + ATS 22 = 42 trips) and agree with the breakdown totals; all time is twelve
// months of the same numbers.

type Game = "ets2" | "ats";
type Totals = { acceptedTrips: number; actualDistanceM: string };

/** Factor of the all-time numbers over the range numbers: twelve equal months. */
const ALL_TIME_MONTHS = 12;
const allTimeRange = { fromDate: "2025-12-01", toDateExclusive: "2026-12-01" };
const isAllTime = (search: URLSearchParams | undefined) => search?.get("period") === "all_time";

function sum(items: Totals[]): Totals {
  return {
    acceptedTrips: items.reduce((total, item) => total + item.acceptedTrips, 0),
    actualDistanceM: String(
      items.reduce((total, item) => total + BigInt(item.actualDistanceM), 0n),
    ),
  };
}
function times(value: Totals, factor: number): Totals {
  return {
    acceptedTrips: value.acceptedTrips * factor,
    actualDistanceM: String(BigInt(value.actualDistanceM) * BigInt(factor)),
  };
}

/** Per-game daily buckets for filter tests; ETS2 + ATS add up to the all-games fixture. */
export const gameBuckets = {
  ets2: [
    { date: "2026-10-01", acceptedTrips: 3, actualDistanceM: "9000000" },
    { date: "2026-10-02", acceptedTrips: 7, actualDistanceM: "22000000" },
    { date: "2026-10-04", acceptedTrips: 10, actualDistanceM: "30430000" },
  ],
  ats: [
    { date: "2026-10-01", acceptedTrips: 2, actualDistanceM: "6000000" },
    { date: "2026-10-02", acceptedTrips: 5, actualDistanceM: "16000000" },
    { date: "2026-10-03", acceptedTrips: 8, actualDistanceM: "24000000" },
    { date: "2026-10-04", acceptedTrips: 7, actualDistanceM: "18000000" },
  ],
} as const;
const rangeByGame = { ets2: sum([...gameBuckets.ets2]), ats: sum([...gameBuckets.ats]) };
/** Distinct members with accepted trips (former members included) and active memberships. */
const activity = {
  range: { all: 2, ets2: 2, ats: 1 },
  allTime: { all: 9, ets2: 7, ats: 4 },
  activeMembers: 5,
};

/** Company analytics without the Stage 4 aggregates (absent means unavailable, never zero). */
export function analyticsWithoutStage4(envelope: S["AnalyticsStage4CompanyEnvelope"]) {
  const {
    period: _period,
    activeDrivers: _drivers,
    activeMembers: _members,
    byGame: _byGame,
    ...data
  } = envelope.data;
  return { ...envelope, data } satisfies S["AnalyticsStage4CompanyEnvelope"];
}

/** A leaderboard without the Stage 4 fields: no viewer, ranked count, period or positions. */
export function leaderboardWithoutStage4(envelope: S["EnvelopeListLeaderboardEntry"]) {
  const {
    rankedMembers: _ranked,
    viewer: _viewer,
    period: _period,
    fromDate: _from,
    toDateExclusive: _to,
    ...data
  } = envelope.data;
  return {
    ...envelope,
    data: { ...data, items: data.items.map(({ position: _position, ...entry }) => entry) },
  } satisfies S["EnvelopeListLeaderboardEntry"];
}

/** The default company analytics of the current month: four daily buckets, both games. */
export function makeAnalyticsFixture(empty = false) {
  const buckets = empty
    ? []
    : [
        { date: "2026-10-01", acceptedTrips: 5, actualDistanceM: "15000000" },
        { date: "2026-10-02", acceptedTrips: 12, actualDistanceM: "38000000" },
        { date: "2026-10-03", acceptedTrips: 8, actualDistanceM: "24000000" },
        { date: "2026-10-04", acceptedTrips: 17, actualDistanceM: "48430000" }, // max bar
      ];
  const zero = { acceptedTrips: 0, actualDistanceM: "0" };
  return {
    data: {
      ...sum(buckets),
      reportingTimezone: "Europe/Moscow",
      fromDate: "2026-10-01",
      toDateExclusive: "2026-11-01",
      granularity: "day" as "day" | "month",
      buckets,
      computedAt: "2026-10-26T12:00:00.000Z",
      projectionVersion: empty ? 1 : 2,
      projectionPending: false,
      // Stage 4 aggregates the live API returns since VTC-143.
      period: "range" as "range" | "all_time",
      activeDrivers: empty ? 0 : activity.range.all,
      activeMembers: activity.activeMembers,
      byGame: [
        { game: "ets2" as Game, ...(empty ? zero : rangeByGame.ets2) },
        { game: "ats" as Game, ...(empty ? zero : rangeByGame.ats) },
      ],
    },
    meta,
  } satisfies S["AnalyticsStage4CompanyEnvelope"];
}

/** All time: twelve month buckets of the range numbers, only the filtered game when set. */
export function makeAllTimeAnalyticsFixture(game?: Game, empty = false) {
  const base = makeAnalyticsFixture(empty).data;
  const month = game ? rangeByGame[game] : sum([rangeByGame.ets2, rangeByGame.ats]);
  const buckets = empty
    ? []
    : Array.from({ length: ALL_TIME_MONTHS }, (_, index) => ({
        date: `${index === 0 ? "2025-12" : `2026-${String(index).padStart(2, "0")}`}-01`,
        ...month,
      }));
  const byGame = (["ets2", "ats"] as const)
    .filter((item) => !game || item === game)
    .map((item) => ({
      game: item,
      ...(empty ? sum([]) : times(rangeByGame[item], ALL_TIME_MONTHS)),
    }));
  return {
    data: {
      ...base,
      ...(empty ? sum([]) : times(month, ALL_TIME_MONTHS)),
      ...(empty ? { fromDate: "2026-11-01", toDateExclusive: "2026-12-01" } : allTimeRange),
      granularity: "month" as const,
      buckets,
      period: "all_time" as const,
      activeDrivers: empty ? 0 : activity.allTime[game ?? "all"],
      byGame,
    },
    meta,
  } satisfies S["AnalyticsStage4CompanyEnvelope"];
}

/**
 * Filter-aware analytics: buckets follow the requested game, granularity and period, totals are
 * the exact bucket sums, and the echoed period matches the request.
 */
export function makeFilteredAnalyticsFixture(search: URLSearchParams, empty = false) {
  const game = search.get("game");
  const filtered = game === "ets2" || game === "ats" ? game : undefined;
  if (isAllTime(search)) return makeAllTimeAnalyticsFixture(filtered, empty);
  const base = makeAnalyticsFixture(empty);
  const daily: { date: string; acceptedTrips: number; actualDistanceM: string }[] = empty
    ? []
    : filtered
      ? gameBuckets[filtered].map((bucket) => ({ ...bucket }))
      : base.data.buckets;
  const totals = sum(daily);
  const granularity = search.get("granularity") === "month" ? ("month" as const) : ("day" as const);
  const buckets =
    granularity === "month" && daily.length > 0 ? [{ date: "2026-10-01", ...totals }] : daily;
  return {
    data: {
      ...base.data,
      ...totals,
      fromDate: search.get("fromDate") ?? base.data.fromDate,
      toDateExclusive: search.get("toDateExclusive") ?? base.data.toDateExclusive,
      granularity,
      buckets,
      // byGame lists only the filtered game, and its totals follow the buckets.
      ...(filtered
        ? { byGame: [{ game: filtered, ...totals }], activeDrivers: activity.range[filtered] }
        : {}),
    },
    meta,
  } satisfies S["AnalyticsStage4CompanyEnvelope"];
}

/** Driver statistics of a profile: the closed member analytics shape, without Stage 4 fields. */
export function makeMemberAnalyticsFixture() {
  return analyticsWithoutStage4(makeAnalyticsFixture(false)) satisfies S["EnvelopeAnalytics"];
}

export const leaderboardMember1Id = "41000000-0000-4000-8000-000000000001";
export const leaderboardMember2Id = "41000000-0000-4000-8000-000000000002";

/**
 * The viewer's place: not ranked (null, the default), on the shown page at 3, below it at 14 of
 * 15, or absent (an API without Stage 4 fields).
 */
export type LeaderboardViewer = "unranked" | "onPage" | "offPage" | "absent";
const selfIndex = { onPage: 2, offPage: 13 } as const;

function leaderboardEntry(index: number, viewer: LeaderboardViewer): S["LeaderboardEntry"] {
  if (index === 0)
    return {
      member: {
        id: leaderboardMember1Id,
        nickname: "AlphaDriver",
        formerMember: false,
        roles: ["director", "driver"],
      },
      acceptedTrips: 24,
      actualDistanceM: "72000000",
    };
  if (index === 1)
    return {
      member: {
        id: leaderboardMember2Id,
        nickname: "BetaHauler",
        formerMember: false,
        roles: ["dispatcher", "driver"],
      },
      acceptedTrips: 18,
      actualDistanceM: "53430000",
    };
  const values = {
    acceptedTrips: Math.max(1, 17 - index),
    actualDistanceM: String((200 - index) * 200000),
  };
  if ((viewer === "onPage" || viewer === "offPage") && index === selfIndex[viewer])
    return {
      // The fictional account fixture's member, as the account menu shows it.
      member: {
        id: fixtureId,
        nickname: "Fictional Yukon Member",
        formerMember: false,
        roles: ["trainee"],
      },
      ...values,
    };
  const number = String(index + 1).padStart(3, "0");
  return {
    member: {
      id: `41000000-0000-4000-8000-000000001${number}`,
      nickname: `Fictional Driver ${number}`,
      formerMember: false,
      roles: ["driver"],
    },
    ...values,
  };
}

/**
 * Leaderboard of `size` ranked members (default 2; 15 with the viewer below the page), answering
 * `limit` rows with positions, the ranked members count and the viewer's own row. All time has
 * twelve times the range values. The first two entries are AlphaDriver and BetaHauler.
 */
export function makeLeaderboardFixture(
  options: {
    empty?: boolean;
    size?: number;
    nextCursor?: boolean;
    viewer?: LeaderboardViewer;
    search?: URLSearchParams;
  } = {},
): S["EnvelopeListLeaderboardEntry"] {
  const viewer = options.viewer ?? "unranked";
  const size = options.empty
    ? 0
    : Math.max(
        options.size ?? (viewer === "offPage" ? 15 : 2),
        viewer === "onPage" ? 3 : 0,
        viewer === "offPage" ? 14 : 0,
      );
  const limit = Number(options.search?.get("limit") ?? 10);
  const factor = isAllTime(options.search) ? ALL_TIME_MONTHS : 1;
  const ranked = Array.from({ length: size }, (_, index) => {
    const entry = leaderboardEntry(index, viewer);
    return { ...entry, ...times(entry, factor), position: index + 1 };
  });
  const own = viewer === "onPage" || viewer === "offPage" ? ranked[selfIndex[viewer]] : undefined;
  const envelope = {
    data: {
      items: ranked.slice(0, limit),
      nextCursor: size > limit || options.nextCursor ? "NONFUNCTIONAL_CURSOR" : null,
      rankedMembers: size,
      viewer: own
        ? {
            position: own.position,
            acceptedTrips: own.acceptedTrips,
            actualDistanceM: own.actualDistanceM,
          }
        : null,
      period: isAllTime(options.search) ? ("all_time" as const) : ("range" as const),
      ...(isAllTime(options.search)
        ? allTimeRange
        : {
            fromDate: options.search?.get("fromDate") ?? "2026-10-01",
            toDateExclusive: options.search?.get("toDateExclusive") ?? "2026-11-01",
          }),
    },
    meta,
  } satisfies S["EnvelopeListLeaderboardEntry"];
  return viewer === "absent" ? leaderboardWithoutStage4(envelope) : envelope;
}

/** Leaderboard with `size` fictional entries; the first two match the default fixture. */
export function makeSizedLeaderboardFixture(size: number, nextCursor: string | null = null) {
  return makeLeaderboardFixture({ size, nextCursor: nextCursor !== null });
}

export type BreakdownDimension = "route" | "cargo" | "source";

type CatalogEntry = {
  id: string;
  en: string;
  ru: string | null;
  hidden?: boolean;
  nameNative?: string;
};
/** Fictional catalog entries of the breakdowns, with fixed IDs. */
const breakdownPlaces = {
  munich: {
    id: "60000000-0000-4000-8000-000000000110",
    en: "Munich",
    ru: "Мюнхен",
    nameNative: "München",
  },
  warszawa: places.warszawa,
  praha: places.praha,
  wien: places.wien,
  petersburg: places.petersburg,
  novgorod: places.novgorod,
  seattle: places.seattle,
  portland: places.portland,
  phoenix: { ...places.phoenix, hidden: true },
} satisfies Record<string, CatalogEntry>;
const cargoEntries = {
  vaccines: { id: "63000000-0000-4000-8000-000000000101", en: "Medical Vaccines", ru: "Вакцины" },
  steel: {
    id: "63000000-0000-4000-8000-000000000102",
    en: "Steel Coils",
    ru: "Стальные рулоны",
    hidden: true,
  },
  fish: { id: "63000000-0000-4000-8000-000000000103", en: "Fresh Fish", ru: "Свежая рыба" },
  lumber: { id: "63000000-0000-4000-8000-000000000104", en: "Lumber", ru: "Пиломатериалы" },
  gravel: { id: "63000000-0000-4000-8000-000000000105", en: "Gravel", ru: null },
} satisfies Record<string, CatalogEntry>;

function catalogLabel(entry: CatalogEntry, locale: FixtureLocale): S["CatalogLabel"] {
  const russian = locale === "ru" ? entry.ru : null;
  return {
    entityId: entry.id,
    label: russian ?? entry.en,
    requestedLocale: locale,
    renderedLocale: russian === null ? "en" : "ru",
    englishFallback: locale === "ru" && russian === null,
    hidden: entry.hidden ?? false,
    ...(entry.nameNative ? { nameNative: entry.nameNative } : {}),
  };
}

/** One trip is 1,000 km in the breakdown fixtures, so distances follow the counts. */
const trips = (acceptedTrips: number): Totals => ({
  acceptedTrips,
  actualDistanceM: String(acceptedTrips * 1_000_000),
});
const routeItems = [
  { game: "ets2", origin: "munich", destination: "warszawa", trips: 8 },
  { game: "ets2", origin: "praha", destination: "wien", trips: 5 },
  { game: "ets2", origin: "petersburg", destination: "novgorod", trips: 3 },
  { game: "ats", origin: "seattle", destination: "portland", trips: 9 },
  { game: "ats", origin: "phoenix", destination: "seattle", trips: 6 },
] as const;
const cargoItems = [
  { game: "ets2", cargo: "vaccines", trips: 7 },
  { game: "ets2", cargo: "steel", trips: 5 },
  { game: "ets2", cargo: "fish", trips: 4 },
  { game: "ats", cargo: "lumber", trips: 10 },
  { game: "ats", cargo: "gravel", trips: 6 },
] as const;
/** Trips outside the listed items and trips without a recognized city or cargo, per game. */
const unlisted = {
  route: { remainder: { ets2: 3, ats: 5 }, undetermined: { ets2: 1, ats: 2 } },
  cargo: { remainder: { ets2: 2, ats: 4 }, undetermined: { ets2: 2, ats: 2 } },
} as const;
const sourceItems = {
  ets2: { ets2telemetry: 17, manual: 3 },
  ats: { ets2telemetry: 15, manual: 7 },
} as const;

/**
 * A breakdown as the API answers `search` (dimension, game, period or dates, locale and limit).
 * Items plus remainder plus undetermined equal the totals, which equal the analytics totals.
 * `empty` is a computed zero for the period.
 */
export function makeBreakdownFixture(search: URLSearchParams, empty = false) {
  const dimension = (search.get("dimension") ?? "route") as BreakdownDimension;
  const locale: FixtureLocale = search.get("locale") === "ru" ? "ru" : "en";
  const requested = search.get("game");
  const game: Game | null = requested === "ets2" || requested === "ats" ? requested : null;
  const games: readonly Game[] = game ? [game] : ["ets2", "ats"];
  const factor = isAllTime(search) ? ALL_TIME_MONTHS : 1;
  const count = (value: number) => (empty ? 0 : value * factor);
  const common = {
    period: isAllTime(search) ? ("all_time" as const) : ("range" as const),
    ...(isAllTime(search)
      ? allTimeRange
      : {
          fromDate: search.get("fromDate") ?? "2026-10-01",
          toDateExclusive: search.get("toDateExclusive") ?? "2026-11-01",
        }),
    reportingTimezone: "Europe/Moscow",
    game,
    computedAt: "2026-10-26T12:00:00.000Z",
    projectionVersion: 2,
    projectionPending: false,
  };
  if (dimension === "source") {
    const items = (["ets2telemetry", "manual"] as const).map((source) => ({
      source,
      ...trips(count(games.reduce((total, item) => total + sourceItems[item][source], 0))),
    }));
    return {
      data: {
        dimension: "source" as const,
        ...common,
        totals: sum(items),
        undetermined: trips(0),
        remainder: trips(0),
        items,
      },
      meta,
    } satisfies S["AnalyticsStage4BreakdownEnvelope"];
  }
  const limit = Number(search.get("limit") ?? 5);
  const extra = (kind: "remainder" | "undetermined") =>
    count(games.reduce((total, item) => total + unlisted[dimension][kind][item], 0));
  const ranked = (dimension === "route" ? routeItems : cargoItems)
    .filter((item) => games.some((value) => value === item.game))
    .map((item) => ({ item, ...trips(count(item.trips)) }))
    .filter((entry) => entry.acceptedTrips > 0)
    .sort((a, b) => b.acceptedTrips - a.acceptedTrips);
  const shown = ranked.slice(0, limit);
  const remainder = trips(extra("remainder") + sum(ranked.slice(limit)).acceptedTrips);
  const undetermined = trips(extra("undetermined"));
  const totals = sum([...ranked, trips(extra("remainder")), undetermined]);
  const shared = { ...common, limit, totals, undetermined, remainder };
  if (dimension === "route")
    return {
      data: {
        dimension: "route" as const,
        ...shared,
        items: shown.map(({ item, ...values }) => {
          const route = item as (typeof routeItems)[number];
          return {
            game: route.game,
            origin: catalogLabel(breakdownPlaces[route.origin], locale),
            destination: catalogLabel(breakdownPlaces[route.destination], locale),
            ...values,
          };
        }),
      },
      meta,
    } satisfies S["AnalyticsStage4BreakdownEnvelope"];
  return {
    data: {
      dimension: "cargo" as const,
      ...shared,
      items: shown.map(({ item, ...values }) => {
        const cargo = item as (typeof cargoItems)[number];
        return {
          game: cargo.game,
          cargo: catalogLabel(cargoEntries[cargo.cargo], locale),
          ...values,
        };
      }),
    },
    meta,
  } satisfies S["AnalyticsStage4BreakdownEnvelope"];
}
