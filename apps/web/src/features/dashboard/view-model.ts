// Pure view model for the overview blocks: own recent trips and the nearest convoy (VTC-055), plus
// the pending query view for any page that waits for the reporting timezone (the overviews and,
// since VTC-078, the driver profile). It only decides what the blocks show; requests, keys, ETags
// and command state stay in the hooks and components. Since VTC-148 it also builds the statistics
// request paths and the place, leaderboard and breakdown views, and since VTC-159 the period
// comparisons of the company KPIs and the personal month.
import { formatQuantity, formatUtc, type Locale } from "../../shared/formatting.js";
import { AccountFailure } from "../account/transport.js";
import type { EventPhase, ResponseValue } from "../events/view-model.js";
import {
  averageDelta,
  averageDistanceM,
  type CalendarRange,
  countDelta,
  type Delta,
  differenceDelta,
  distanceDelta,
  type PeriodQuery,
} from "./model.js";
import { dashboardTranslations } from "./translations.js";
import type { DTO } from "./transport.js";

/** The block shows at most this many trips; the request asks for exactly this many. */
export const RECENT_TRIPS_LIMIT = 5;

/**
 * The viewer's own latest trips, with every decision, ordered by effective actual completion and
 * labelled in the interface language.
 */
export function recentTripsPath(game?: "ets2" | "ats", locale?: "en" | "ru") {
  return `/trips?scope=mine&limit=${RECENT_TRIPS_LIMIT}&order=completion_desc${game ? `&game=${game}` : ""}${locale ? `&locale=${locale}` : ""}`;
}

export type BlockState = "ready" | "empty" | "loading" | "error" | "forbidden";

/** Data wins: a failed background refresh keeps the last data instead of an error. */
export function blockView<T>(
  query: { data: T | undefined; isError: boolean; error: unknown },
  isEmpty: (data: T) => boolean,
): BlockState {
  if (query.data !== undefined) return isEmpty(query.data) ? "empty" : "ready";
  if (query.isError) return isForbidden(query.error) ? "forbidden" : "error";
  return "loading";
}

/**
 * While a user Retry runs without data, the block keeps its error view. `since` is the query's
 * error count when Retry was pressed; data or a later error is a newer outcome that ends it.
 */
export function retainsError(
  since: number | null,
  query: { data: unknown; errorUpdateCount: number },
) {
  return since !== null && query.data === undefined && query.errorUpdateCount === since;
}

/** What a block reads from its query; a TanStack result satisfies it unchanged. */
export type QueryView<T> = {
  data: T | undefined;
  error: unknown;
  isError: boolean;
  isPending: boolean;
  errorUpdateCount: number;
  refetch: (options?: { cancelRefetch?: boolean }) => Promise<unknown>;
};

/**
 * A query's view while a page waits for the reporting timezone: loading, never the cached data or
 * error of keys the page may not use.
 */
export function untilAnchored<T>(query: QueryView<T>, anchored: boolean): QueryView<T> {
  if (anchored) return query;
  return {
    data: undefined,
    error: null,
    isError: false,
    isPending: true,
    errorUpdateCount: query.errorUpdateCount,
    refetch: query.refetch,
  };
}

function isForbidden(error: unknown) {
  return error instanceof AccountFailure && error.kind === "forbidden";
}

export type RecentTripRow = {
  id: string;
  game: DTO["TripSummary"]["game"];
  decision: DTO["TripSummary"]["decision"];
  origin: string;
  destination: string;
  /** True when either place label is an English fallback for the requested locale. */
  fallback: boolean;
  distance: string;
  countedAt: string;
};

/** Missing places read "Unknown"; a missing distance or time reads "Unavailable", never zero. */
export function recentTripRow(
  trip: DTO["TripSummary"],
  locale: Locale,
  timezone: string,
): RecentTripRow {
  const unknown = dashboardTranslations[locale].recentTrips.unknownPlace;
  return {
    id: trip.id,
    game: trip.game,
    decision: trip.decision,
    origin: trip.origin?.label ?? unknown,
    destination: trip.destination?.label ?? unknown,
    fallback: !!trip.origin?.englishFallback || !!trip.destination?.englishFallback,
    distance: formatQuantity(trip.actualDistanceM, "km", locale),
    countedAt: formatUtc(trip.reportingAt, locale, timezone),
  };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export type Countdown = (
  | { kind: "days"; days: number; hours: number }
  | { kind: "hours"; hours: number; minutes: number }
  | { kind: "minutes"; minutes: number }
  | { kind: "soon" }
  | { kind: "started" }
) & {
  /** Milliseconds until the shown text changes; null once started. */
  nextChangeMs: number | null;
};

/**
 * Time left until `startsAt`, floored to the shown units. Reaching the start counts as started,
 * matching `eventPhase` and the server's response cutoff.
 */
export function countdown(startsAt: string, now: number): Countdown {
  const remaining = Date.parse(startsAt) - now;
  if (!(remaining > 0)) return { kind: "started", nextChangeMs: null };
  if (remaining >= DAY)
    return {
      kind: "days",
      days: Math.floor(remaining / DAY),
      hours: Math.floor((remaining % DAY) / HOUR),
      nextChangeMs: (remaining % HOUR) + 1,
    };
  if (remaining >= HOUR)
    return {
      kind: "hours",
      hours: Math.floor(remaining / HOUR),
      minutes: Math.floor((remaining % HOUR) / MINUTE),
      nextChangeMs: (remaining % MINUTE) + 1,
    };
  if (remaining >= MINUTE)
    return {
      kind: "minutes",
      minutes: Math.floor(remaining / MINUTE),
      nextChangeMs: (remaining % MINUTE) + 1,
    };
  return { kind: "soon", nextChangeMs: remaining };
}

export type RsvpView =
  | { state: "readOnly" }
  | { state: "closed" }
  | { state: "loading" }
  | { state: "unavailable" }
  | { state: "forbidden" }
  | { state: "ready"; current: DTO["Rsvp"]; etag: string | null; canSubmit: boolean };

/**
 * Own response area. Without events.respond it is read-only and makes no my-response read; after
 * the start it is closed. A missing ETag blocks the command: If-Match is never invented.
 */
export function rsvpView({
  canRespond,
  phase,
  query,
}: {
  canRespond: boolean;
  phase: EventPhase;
  query: {
    data?: { data: DTO["EnvelopeRsvp"]; etag: string | null } | undefined;
    isError: boolean;
    error: unknown;
  };
}): RsvpView {
  if (!canRespond) return { state: "readOnly" };
  if (phase !== "open") return { state: "closed" };
  if (query.data)
    return {
      state: "ready",
      current: query.data.data.data,
      etag: query.data.etag,
      canSubmit: query.data.etag !== null,
    };
  if (query.isError) return { state: isForbidden(query.error) ? "forbidden" : "unavailable" };
  return { state: "loading" };
}

/**
 * Pressed toggles. Only the server-confirmed response is pressed, except while the decline draft
 * is open: then Can't go is pressed locally until the draft is saved or cancelled.
 */
export function responsePressed(current: ResponseValue, declining: boolean) {
  return {
    going: !declining && current === "participating",
    cantGo: declining || current === "declined",
  };
}

export type ActionKey = "fixes" | "drafts" | "events" | "review" | "applications";
/** Each "Needs attention" section and the capability that offers it, in display order. */
const actionSections: readonly { key: ActionKey; capability: string }[] = [
  { key: "fixes", capability: "trips.read_own_private" },
  { key: "drafts", capability: "trips.submit_own" },
  { key: "events", capability: "events.respond" },
  { key: "review", capability: "trips.review" },
  { key: "applications", capability: "applications.manage" },
];
type ActionSummary = DTO["WorkspaceSummary"];

const actionCount = (summary: ActionSummary, key: ActionKey) =>
  ({
    fixes: summary.tripsNeedingFixes?.count,
    drafts: summary.unfinishedManualDrafts?.count,
    events: summary.unansweredUpcomingEvents?.count,
    review: summary.reviewQueue?.count,
    applications: summary.newApplicationsCount,
  })[key];

/**
 * Sections of a loaded summary that have work for the viewer. A count the summary omits, because
 * the viewer has no access or its module is off, is simply not mentioned: it is not a failure.
 */
export function visibleActionSections(
  summary: ActionSummary,
  capabilities: readonly string[],
): { key: ActionKey; count: number }[] {
  return actionSections.flatMap(({ key, capability }) => {
    const count = actionCount(summary, key);
    return capabilities.includes(capability) && count !== undefined && count > 0
      ? [{ key, count }]
      : [];
  });
}

// Overview statistics (VTC-148): request paths, the viewer's place, Stage 4 KPI values,
// leaderboard rows and the trip breakdowns. Components format and render the results.

type Game = "ets2" | "ats";

function periodParams(query: PeriodQuery): Record<string, string> {
  return query.period === "all_time"
    ? { period: "all_time" }
    : { fromDate: query.fromDate, toDateExclusive: query.toDateExclusive };
}

/** Company analytics. All time sends no dates and always month buckets (day is rejected). */
export function analyticsPath(
  query: PeriodQuery,
  options: { game?: Game | undefined; granularity: "day" | "month" },
) {
  const granularity = query.period === "all_time" ? "month" : options.granularity;
  return `/analytics/company?${new URLSearchParams({
    ...periodParams(query),
    granularity,
    ...(options.game ? { game: options.game } : {}),
  })}`;
}

/**
 * One member's analytics (My overview). The endpoint needs both dates and has no all time, so the
 * path always carries a calendar range.
 */
export function memberAnalyticsPath(
  memberId: string,
  query: CalendarRange,
  options: { game?: Game | undefined; granularity: "day" | "month" },
) {
  return `/members/${encodeURIComponent(memberId)}/analytics?${new URLSearchParams({
    fromDate: query.fromDate,
    toDateExclusive: query.toDateExclusive,
    granularity: options.granularity,
    ...(options.game ? { game: options.game } : {}),
  })}`;
}

/** The overviews show the top five; the viewer's own row comes with the page when ranked. */
export const LEADERBOARD_LIMIT = 5;

export function leaderboardPath(query: PeriodQuery, game?: Game) {
  return `/analytics/leaderboard?${new URLSearchParams({
    ...periodParams(query),
    limit: String(LEADERBOARD_LIMIT),
    ...(game ? { game } : {}),
  })}`;
}

export type BreakdownDimension = "route" | "cargo" | "source";
/** Top routes and cargo shown per card; the source split always has its two parts. */
export const BREAKDOWN_LIMIT = 5;

/** Labels in the interface language; `limit` only for route and cargo (source rejects it). */
export function breakdownPath(
  dimension: BreakdownDimension,
  query: PeriodQuery,
  options: { game?: Game | undefined; locale: Locale },
) {
  return `/analytics/company/breakdown?${new URLSearchParams({
    dimension,
    ...periodParams(query),
    ...(options.game ? { game: options.game } : {}),
    locale: options.locale,
    ...(dimension === "source" ? {} : { limit: String(BREAKDOWN_LIMIT) }),
  })}`;
}

type Leaderboard = DTO["ListLeaderboardEntry"];

export type PlaceView =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "notRanked" }
  | {
      kind: "ranked";
      position: number;
      /** Undefined when the response does not say how many members are ranked. */
      ranked: number | undefined;
      acceptedTrips: number;
      actualDistanceM: string;
    };

/**
 * The viewer's place from the leaderboard read. An absent viewer (no Stage 4 data) or a failure
 * without data is unavailable; null means the viewer has no accepted trip in the period.
 */
export function placeView(leaderboard: Leaderboard | undefined, failed: boolean): PlaceView {
  if (!leaderboard) return failed ? { kind: "unavailable" } : { kind: "loading" };
  const { viewer } = leaderboard;
  if (viewer === undefined) return { kind: "unavailable" };
  if (viewer === null) return { kind: "notRanked" };
  return {
    kind: "ranked",
    position: viewer.position,
    ranked: leaderboard.rankedMembers,
    acceptedTrips: viewer.acceptedTrips,
    actualDistanceM: viewer.actualDistanceM,
  };
}

type CompanyAnalytics = DTO["AnalyticsStage4Company"];

/**
 * Active drivers come from analytics only. They include former members with accepted trips, so
 * active members are a separate sub-line, never a denominator. Null means unavailable.
 */
export function activeDriversView(analytics: CompanyAnalytics) {
  return {
    drivers: analytics.activeDrivers ?? null,
    members: analytics.activeMembers ?? null,
  };
}

/**
 * The previous period's read as a comparison line sees it: no line (all time), a reserved line
 * while pending, unavailable after a failure without data, or the previous totals.
 */
export type PreviousPeriod<T> =
  | { state: "none" }
  | { state: "pending" }
  | { state: "failed" }
  | { state: "ready"; data: T; range: CalendarRange };

/** The previous-period view of a query; data wins over a failed background refresh. */
export function previousPeriod<T>(
  range: CalendarRange | null,
  query: { data: T | undefined; isError: boolean },
): PreviousPeriod<T> {
  if (!range) return { state: "none" };
  if (query.data !== undefined) return { state: "ready", data: query.data, range };
  return query.isError ? { state: "failed" } : { state: "pending" };
}

/** A tile's comparison line: null shows none, "pending" reserves it. */
export type DeltaLine = Delta | "pending" | null;
export type KpiDeltas = Record<"distance" | "trips" | "average" | "drivers", DeltaLine>;

/**
 * Each company KPI against the previous period of the same length. Without accepted trips in the
 * previous period nothing is compared; a failed read or an absent Stage 4 count is unavailable.
 * The average has no line without current trips, where its tile says "No trips".
 */
export function companyDeltas(
  current: CompanyAnalytics,
  previous: PreviousPeriod<CompanyAnalytics>,
): KpiDeltas {
  const all = (line: DeltaLine): KpiDeltas => ({
    distance: line,
    trips: line,
    average: current.acceptedTrips > 0 ? line : null,
    drivers: line,
  });
  if (previous.state === "none") return all(null);
  if (previous.state === "pending") return all("pending");
  if (previous.state === "failed") return all({ kind: "unavailable" });
  const before = previous.data;
  if (before.acceptedTrips === 0) return all({ kind: "noBaseline" });
  return {
    distance: distanceDelta(current.actualDistanceM, before.actualDistanceM),
    trips: countDelta(current.acceptedTrips, before.acceptedTrips),
    average: averageDelta(
      { distanceM: current.actualDistanceM, trips: current.acceptedTrips },
      { distanceM: before.actualDistanceM, trips: before.acceptedTrips },
    ),
    drivers:
      current.activeDrivers === undefined || before.activeDrivers === undefined
        ? { kind: "unavailable" }
        : countDelta(current.activeDrivers, before.activeDrivers),
  };
}

/** The average accepted trip of the analytics totals, or null without trips. */
export function averageTripM(analytics: { actualDistanceM: string; acceptedTrips: number }) {
  return averageDistanceM(analytics.actualDistanceM, analytics.acceptedTrips);
}

/**
 * The own month's distance against the same elapsed days of the previous month, as an exact
 * difference ("320 km more than 1–17 October"). Without previous accepted trips there is nothing
 * to compare with.
 */
export function personalDistanceDelta(
  current: { actualDistanceM: string },
  previous: PreviousPeriod<{ acceptedTrips: number; actualDistanceM: string }>,
): DeltaLine {
  if (previous.state === "none") return null;
  if (previous.state === "pending") return "pending";
  if (previous.state === "failed") return { kind: "unavailable" };
  if (previous.data.acceptedTrips === 0) return { kind: "noBaseline" };
  return differenceDelta(current.actualDistanceM, previous.data.actualDistanceM);
}

/** Per-game totals for the KPI sub-lines, only when the response splits both games. */
export function gameSplit(analytics: CompanyAnalytics) {
  const ets2 = analytics.byGame?.find((item) => item.game === "ets2");
  const ats = analytics.byGame?.find((item) => item.game === "ats");
  return ets2 && ats ? { ets2, ats } : null;
}

export type LeaderboardRow = {
  entry: Leaderboard["items"][number];
  rank: number;
  self: boolean;
};

/**
 * Shown leaderboard rows with their rank (server position, else the list order) and the viewer's
 * own row marked. A ranked viewer outside the shown rows is returned separately for an extra row.
 */
export function leaderboardRows(leaderboard: Leaderboard, selfId: string | undefined) {
  const rows: LeaderboardRow[] = leaderboard.items
    .slice(0, LEADERBOARD_LIMIT)
    .map((entry, index) => ({
      entry,
      rank: entry.position ?? index + 1,
      self: selfId !== undefined && entry.member.id === selfId,
    }));
  const viewer = leaderboard.viewer ?? null;
  const offPage = viewer && !rows.some((row) => row.self) ? viewer : null;
  return { rows, offPage };
}

type RouteBreakdown = DTO["AnalyticsStage4RouteBreakdown"];
type CargoBreakdown = DTO["AnalyticsStage4CargoBreakdown"];
type SourceBreakdown = DTO["AnalyticsStage4SourceBreakdown"];
export type BreakdownData = {
  route: RouteBreakdown;
  cargo: CargoBreakdown;
  source: SourceBreakdown;
};

export type BreakdownRow = {
  key: string;
  game: Game;
  /** Origin and destination for a route, the cargo alone otherwise; the role is a stable key. */
  labels: { role: "origin" | "destination" | "cargo"; label: DTO["CatalogLabel"] }[];
  /** True when any label is an English fallback for the requested locale. */
  fallback: boolean;
  acceptedTrips: number;
  /** Decorative bar width (0–100) relative to the largest shown item. */
  barPercent: number;
};

export type BreakdownView = {
  rows: BreakdownRow[];
  /** Game chips only when the breakdown covers both games. */
  chips: boolean;
  /** Trips outside the shown items, or null when there are none. */
  remainder: number | null;
  /** Trips whose city or cargo was not recognized, or null when there are none. */
  undetermined: number | null;
};

/** Empty only for a computed zero total; a failure is never empty. */
export function breakdownEmpty(data: { totals: { acceptedTrips: number } }) {
  return data.totals.acceptedTrips === 0;
}

export function breakdownRows(data: RouteBreakdown | CargoBreakdown): BreakdownView {
  const items: { key: string; game: Game; labels: BreakdownRow["labels"]; trips: number }[] =
    data.dimension === "route"
      ? data.items.map((item) => ({
          key: `${item.game}:${item.origin.entityId}:${item.destination.entityId}`,
          game: item.game,
          labels: [
            { role: "origin", label: item.origin },
            { role: "destination", label: item.destination },
          ],
          trips: item.acceptedTrips,
        }))
      : data.items.map((item) => ({
          key: `${item.game}:${item.cargo.entityId}`,
          game: item.game,
          labels: [{ role: "cargo", label: item.cargo }],
          trips: item.acceptedTrips,
        }));
  const largest = Math.max(0, ...items.map((item) => item.trips));
  return {
    rows: items.map((item) => ({
      key: item.key,
      game: item.game,
      labels: item.labels,
      fallback: item.labels.some(({ label }) => label.englishFallback),
      acceptedTrips: item.trips,
      barPercent: largest > 0 ? (item.trips / largest) * 100 : 0,
    })),
    chips: data.game === null,
    remainder: data.remainder.acceptedTrips > 0 ? data.remainder.acceptedTrips : null,
    undetermined: data.undetermined.acceptedTrips > 0 ? data.undetermined.acceptedTrips : null,
  };
}

export type SourcePart = {
  source: "ets2telemetry" | "manual" | "undetermined";
  acceptedTrips: number;
  /** Whole percent of the total, rounded per part (the parts may not add up to exactly 100). */
  percent: number;
};

/**
 * The source split in its fixed order (telemetry, manual), plus undetermined trips only when
 * there are some. A zero total has no shares: the card shows its empty state instead.
 */
export function sourceShares(data: SourceBreakdown): SourcePart[] {
  const total = data.totals.acceptedTrips;
  if (total === 0) return [];
  const share = (trips: number) => Math.round((trips * 100) / total);
  const parts: SourcePart[] = (["ets2telemetry", "manual"] as const).map((source) => {
    const trips = data.items.find((item) => item.source === source)?.acceptedTrips ?? 0;
    return { source, acceptedTrips: trips, percent: share(trips) };
  });
  if (data.undetermined.acceptedTrips > 0)
    parts.push({
      source: "undetermined",
      acceptedTrips: data.undetermined.acceptedTrips,
      percent: share(data.undetermined.acceptedTrips),
    });
  return parts;
}

const numberTag = { ru: "ru-RU", en: "en-GB" } as const;
export type TripsKey = "tripsOne" | "tripsFew" | "tripsMany" | "tripsOther";

/**
 * Translation key for a trip count. Plain keys chosen by the CLDR plural rules keep the RU and EN
 * key sets identical; i18next plural suffixes would differ by language.
 */
export function tripsKey(count: number, locale: Locale): TripsKey {
  const category = new Intl.PluralRules(numberTag[locale]).select(count);
  if (category === "one") return "tripsOne";
  if (category === "few") return "tripsFew";
  if (category === "many") return "tripsMany";
  return "tripsOther";
}

/** A whole percent in the interface language ("76%", "76 %"). */
export function formatPercent(percent: number, locale: Locale) {
  return new Intl.NumberFormat(numberTag[locale], {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(percent / 100);
}
