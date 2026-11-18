// Pure driver profile helpers: analytics window, level ladder, trip request paths and failures.
import type { TFunction } from "i18next";
import type { Locale } from "../../shared/formatting.js";
import { isRateLimited } from "../../shared/rate-limit.js";
import { formatDay } from "../admin/members-model.js";
import { calendarToday, isoDate } from "../dashboard/model.js";
import { DriversFailure, type DTO } from "./transport.js";

export type Game = "ets2" | "ats";
export type GameFilter = "all" | Game;
export type Level = DTO["QualificationLevelSummary"];
export type MemberQualification = DTO["MyQualification"];
export type Assignment = DTO["Assignment"];
export type TripSummary = DTO["TripSummary"];

export const GAMES: readonly Game[] = ["ets2", "ats"];
const RECENT_TRIPS_LIMIT = 10;

/**
 * Rolling window of twelve calendar months ending with the current one. Like the overview's
 * periods (VTC-056), the anchor is today's calendar month in the company reporting timezone, and
 * the API reads both dates in that timezone. A zone unknown to the browser falls back to UTC.
 */
export function twelveMonthWindow(
  now: Date,
  timeZone: string,
): { fromDate: string; toDateExclusive: string } {
  const { year, month } = calendarToday(now, timeZone);
  return {
    fromDate: isoDate(year, month - 11, 1),
    toDateExclusive: isoDate(year, month + 1, 1),
  };
}

const localeTag = { ru: "ru-RU", en: "en-GB" } as const;

/** Month name of a `YYYY-MM-DD` bucket date: "short" for chart ticks, "long" with the year. */
export function monthLabel(date: string, locale: Locale, style: "short" | "long"): string {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(date);
  if (!match) return date;
  const value = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  return new Intl.DateTimeFormat(localeTag[locale], {
    month: style,
    ...(style === "long" ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).format(value);
}

/** Levels of one game in current ladder order. */
export function ladderFor(levels: readonly Level[], game: Game): Level[] {
  return levels.filter((level) => level.game === game).sort((a, b) => a.position - b.position);
}

/** The next ladder step, "top" for the highest level, or null when it cannot be resolved. */
export function nextLevel(ladder: readonly Level[], levelId: string): Level | "top" | null {
  const current = ladder.find((level) => level.id === levelId);
  if (!current) return null;
  if (!current.nextLevel) return "top";
  return ladder.find((level) => level.id === current.nextLevel?.id) ?? null;
}

export function assignmentFor(profile: DTO["MemberProfile"], game: Game): Assignment | null {
  return profile.qualifications.find((assignment) => assignment.game === game) ?? null;
}

export function driverTripFilters(
  memberId: string,
  { isSelf, game }: { isSelf: boolean; game?: Game | undefined },
) {
  return new URLSearchParams({
    scope: isSelf ? "mine" : "company",
    ...(isSelf ? { decision: "accepted" } : { ownerId: memberId }),
    ...(game ? { game } : {}),
  });
}

/** The profile's recent trips, labelled in the interface language when one is given. */
export function tripsPath(
  memberId: string,
  params: { isSelf: boolean; game?: Game | undefined; locale?: "en" | "ru" | undefined },
) {
  const search = driverTripFilters(memberId, params);
  search.set("limit", String(RECENT_TRIPS_LIMIT));
  search.set("order", "completion_desc");
  if (params.locale) search.set("locale", params.locale);
  return `/trips?${search.toString()}`;
}

/** Translation keys for the trip sources, deduplicated; an empty list is "unknown". */
export function sourceKeys(
  kinds: readonly TripSummary["sourceKinds"][number][],
): ("ets2telemetry" | "manual" | "unknown")[] {
  return kinds.length ? [...new Set(kinds)] : ["unknown"];
}

export type FailureView = "notFound" | "forbidden" | "setup" | "limited" | "error";

/**
 * Page/block outcome for a failed drivers read; everything unexpected is a retryable error. A
 * read still rate limited after its automatic retry is "limited" and shows the wait notice.
 */
export function failureView(error: unknown): FailureView {
  if (isRateLimited(error)) return "limited";
  if (!(error instanceof DriversFailure)) return "error";
  if (error.status === 404 || error.status === 400 || error.status === 422) return "notFound";
  if (error.status === 403) return "forbidden";
  if (error.status === 409) return "setup";
  return "error";
}

/** First user-perceived character of the nickname for the decorative avatar. */
export function initial(nickname: string): string {
  const text = nickname.trim();
  const segment =
    typeof Intl.Segmenter === "function"
      ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
          .segment(text)
          [Symbol.iterator]()
          .next().value?.segment
      : Array.from(text)[0];
  return segment ? segment.toLocaleUpperCase() : "?";
}

/** The profile header's last trip: a dated accepted trip, none yet, or unavailable (Trips off). */
export type LastTripPart = { kind: "date"; iso: string } | { kind: "none" } | null;

/**
 * Parts of "In the company since … · last trip …" (a former member: "Joined the company on …").
 * An absent or malformed field is null; a null last trip means no accepted trip yet. The header
 * renders the last trip as a relative day (VTC-160).
 */
export function membershipParts(
  profile: DTO["MemberProfile"],
  locale: Locale,
  timeZone: string,
  t: TFunction<"drivers">,
): { since: string | null; lastTrip: LastTripPart } {
  const sinceDay = profile.memberSince ? formatDay(profile.memberSince, locale, timeZone) : null;
  const last = profile.lastAcceptedTripAt;
  const lastTrip: LastTripPart =
    last === null
      ? { kind: "none" }
      : last && formatDay(last, locale, timeZone)
        ? { kind: "date", iso: last }
        : null;
  return {
    since: sinceDay
      ? t(profile.member.formerMember ? "profile.joinedOn" : "profile.inCompanySince", {
          date: sinceDay,
        })
      : null,
    lastTrip,
  };
}

/** Uppercases the first character, for a line that starts with a lowercase part. */
export function capitalize(text: string, locale: Locale): string {
  return `${text.charAt(0).toLocaleUpperCase(locale)}${text.slice(1)}`;
}

/**
 * Average accepted trip, all games, rounded half up to whole kilometres and returned in metres
 * for `formatQuantity`. Exact BigInt arithmetic: lifetime distances can exceed a safe Number.
 * Absent totals are unavailable; zero trips have no average.
 */
export function averageTripKm(
  totals: DTO["LifetimeTripTotals"] | undefined,
): { kind: "unavailable" } | { kind: "none" } | { kind: "value"; distanceM: string } {
  if (!totals) return { kind: "unavailable" };
  if (totals.acceptedTrips <= 0) return { kind: "none" };
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(totals.actualDistanceM);
  if (!match) return { kind: "unavailable" };
  const fraction = match[2] ?? "";
  const numerator = BigInt(`${match[1]}${fraction}`);
  const denominator = BigInt(totals.acceptedTrips) * 1000n * 10n ** BigInt(fraction.length);
  const km = (2n * numerator + denominator) / (2n * denominator);
  return { kind: "value", distanceM: String(km * 1000n) };
}
