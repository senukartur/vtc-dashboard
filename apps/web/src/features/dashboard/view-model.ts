// Pure view model for the overview's recent company trips and nearest convoy blocks (VTC-055),
// plus the pending query view for any page that waits for the reporting timezone (the overview
// and, since VTC-078, the driver profile). It only decides what the blocks show; requests, keys,
// ETags and command state stay in the hooks and components.
import { formatQuantity, formatUtc, type Locale } from "../../shared/formatting.js";
import { AccountFailure } from "../account/transport.js";
import type { EventPhase, ResponseValue } from "../events/view-model.js";
import { dashboardTranslations } from "./translations.js";
import type { DTO } from "./transport.js";

/** The block shows at most this many trips; the request asks for exactly this many. */
export const RECENT_TRIPS_LIMIT = 5;

/**
 * Latest accepted company trips ordered by effective actual completion.
 */
export function recentTripsPath(game?: "ets2" | "ats") {
  return `/trips?scope=company&limit=${RECENT_TRIPS_LIMIT}&order=completion_desc${game ? `&game=${game}` : ""}`;
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
  origin: string;
  destination: string;
  driver: string;
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
    origin: trip.origin?.label ?? unknown,
    destination: trip.destination?.label ?? unknown,
    driver: trip.owner.nickname,
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
