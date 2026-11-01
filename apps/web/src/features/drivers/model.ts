// Pure driver profile helpers: analytics window, level ladder, trip request paths and failures.
import type { Locale } from "../../shared/formatting.js";
import { DriversFailure, type DTO } from "./transport.js";

export type Game = "ets2" | "ats";
export type GameFilter = "all" | Game;
export type Level = DTO["QualificationLevel"];
export type Assignment = DTO["Assignment"];
export type TripSummary = DTO["TripSummary"];

export const GAMES: readonly Game[] = ["ets2", "ats"];
/** Ladder order by canonical level code; display names come from the server. */
export const LEVEL_ORDER: readonly Level["code"][] = [
  "trainee",
  "driver_iii",
  "driver_ii",
  "driver_i",
];
/** Exact own-trip page shown on the profile. */
export const OWN_TRIPS_LIMIT = 10;
/** Latest accepted company trips scanned for another member (contract maximum). */
export const COMPANY_TRIPS_WINDOW = 100;

const pad = (n: number) => String(n).padStart(2, "0");
const isoDate = (d: Date) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/**
 * Rolling window of twelve calendar months ending with the current one. Like the overview, the
 * anchor month uses the UTC clock; the API interprets both dates in the reporting timezone.
 */
export function twelveMonthWindow(now = new Date()): { fromDate: string; toDateExclusive: string } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  return {
    fromDate: isoDate(new Date(Date.UTC(year, month - 11, 1))),
    toDateExclusive: isoDate(new Date(Date.UTC(year, month + 1, 1))),
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

/** Levels of one game in ladder order; unknown codes are dropped. */
export function ladderFor(levels: readonly Level[], game: Game): Level[] {
  return levels
    .filter((level) => level.game === game && LEVEL_ORDER.includes(level.code))
    .sort((a, b) => LEVEL_ORDER.indexOf(a.code) - LEVEL_ORDER.indexOf(b.code));
}

/** The next ladder step, "top" for the highest level, or null when it cannot be resolved. */
export function nextLevel(ladder: readonly Level[], levelId: string): Level | "top" | null {
  const index = ladder.findIndex((level) => level.id === levelId);
  const current = ladder[index];
  if (!current) return null;
  if (current.code === "driver_i") return "top";
  return ladder[index + 1] ?? null;
}

export function assignmentFor(profile: DTO["MemberProfile"], game: Game): Assignment | null {
  return profile.qualifications.find((assignment) => assignment.game === game) ?? null;
}

/**
 * Own trips use the exact `mine` scope. Other members have no owner filter in the contract, so
 * the profile scans the latest accepted company trips and discloses that bounded window.
 */
export function tripsPath({ isSelf, game }: { isSelf: boolean; game?: Game | undefined }): string {
  const search = new URLSearchParams({
    scope: isSelf ? "mine" : "company",
    decision: "accepted",
    limit: String(isSelf ? OWN_TRIPS_LIMIT : COMPANY_TRIPS_WINDOW),
    ...(game ? { game } : {}),
  });
  return `/trips?${search.toString()}`;
}

export function ownTrips(
  items: readonly TripSummary[],
  memberId: string,
  max = OWN_TRIPS_LIMIT,
): TripSummary[] {
  return items.filter((trip) => trip.owner.id === memberId).slice(0, max);
}

/** Translation keys for the trip sources, deduplicated; an empty list is "unknown". */
export function sourceKeys(
  kinds: readonly TripSummary["sourceKinds"][number][],
): ("ets2telemetry" | "manual" | "unknown")[] {
  return kinds.length ? [...new Set(kinds)] : ["unknown"];
}

export type FailureView = "notFound" | "forbidden" | "setup" | "error";

/** Page/block outcome for a failed drivers read; everything unexpected is a retryable error. */
export function failureView(error: unknown): FailureView {
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
