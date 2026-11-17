// Pure overview dashboard helpers: filter values, period ranges, progress geometry and, since
// VTC-159, the previous-period comparison with exact deltas and localized date labels.
import type { components } from "@vtc/contracts";
import { chartGeometry, type Locale } from "../../shared/formatting.js";

export type GameFilter = "all" | "ets2" | "ats";
export type PeriodFilter = "thisMonth" | "lastMonth" | "last30Days" | "last7Days";

export const periods: readonly PeriodFilter[] = [
  "thisMonth",
  "lastMonth",
  "last30Days",
  "last7Days",
];

/** Anchor zone when the reporting timezone is unknown: the behaviour before VTC-056. */
export const PERIOD_FALLBACK_TIMEZONE = "UTC";

const calendarLocale = "en-US-u-ca-gregory-nu-latn";
const dateFields = { year: "numeric", month: "numeric", day: "numeric" } as const;

/** Today's calendar date in `timeZone`. A zone unknown to the browser falls back to UTC. */
export function calendarToday(
  now: Date,
  timeZone: string,
): { year: number; month: number; day: number } {
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat(calendarLocale, { ...dateFields, timeZone });
  } catch {
    format = new Intl.DateTimeFormat(calendarLocale, {
      ...dateFields,
      timeZone: PERIOD_FALLBACK_TIMEZONE,
    });
  }
  const parts = format.formatToParts(now);
  const part = (type: "year" | "month" | "day") =>
    Number(parts.find((item) => item.type === type)?.value);
  return { year: part("year"), month: part("month"), day: part("day") };
}

/** Calendar arithmetic only: `Date.UTC` normalises overflowing months and days. */
export function isoDate(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

// Anchors are today's calendar date in the company reporting timezone; the API reads the dates in that timezone.
export function computePeriodDates(
  period: PeriodFilter,
  now: Date,
  timeZone: string,
): { fromDate: string; toDateExclusive: string } {
  const { year, month, day } = calendarToday(now, timeZone);
  if (period === "thisMonth")
    return { fromDate: isoDate(year, month, 1), toDateExclusive: isoDate(year, month + 1, 1) };
  if (period === "lastMonth")
    return { fromDate: isoDate(year, month - 1, 1), toDateExclusive: isoDate(year, month, 1) };
  const days = period === "last7Days" ? 7 : 30;
  return {
    fromDate: isoDate(year, month, day + 1 - days),
    toDateExclusive: isoDate(year, month, day + 1),
  };
}

/**
 * Overview period choices: the shared calendar periods plus "All time" (VTC-148). Only the
 * overview offers all time; the trip list keeps using `periods`.
 */
export type OverviewPeriod = PeriodFilter | "allTime";
export const overviewPeriods: readonly OverviewPeriod[] = [...periods, "allTime"];

/** Period parameters of the overview reads: all time sends no dates, the others send both. */
export type PeriodQuery =
  | { period: "all_time" }
  | { period?: undefined; fromDate: string; toDateExclusive: string };

export function periodQuery(period: OverviewPeriod, now: Date, timeZone: string): PeriodQuery {
  if (period === "allTime") return { period: "all_time" };
  return computePeriodDates(period, now, timeZone);
}

/** All time is reported in whole months (the API rejects daily buckets for it). */
export function effectiveGranularity(
  period: OverviewPeriod,
  granularity: "day" | "month",
): "day" | "month" {
  return period === "allTime" ? "month" : granularity;
}

/**
 * Zone for the period anchors, read from the public company stats. Undefined while that read is
 * pending; UTC when it failed without data or the company has no reporting timezone. Retained
 * data wins over a later failed refresh.
 */
export function periodTimeZone(
  stats: components["schemas"]["CompanyStatsPublic"] | undefined,
  failed: boolean,
): string | undefined {
  if (stats)
    return stats.currentMonth.status === "available"
      ? stats.currentMonth.reportingTimezone
      : PERIOD_FALLBACK_TIMEZONE;
  return failed ? PERIOD_FALLBACK_TIMEZONE : undefined;
}

/**
 * Bar width (0–100) for a decorative progress bar. Geometry only: the exact value/requirement text
 * stays visible next to it. Null when there is no finite requirement to compare against.
 */
export function progressPercent(value: string, required: string | null): number | null {
  if (required === null) return null;
  const target = chartGeometry(required);
  const current = chartGeometry(value);
  if (target === null || current === null) return null;
  if (target === 0) return 100;
  return Math.min(100, Math.max(0, (current / target) * 100));
}

// Period comparison (VTC-159): the previous period of the same length, exact deltas and the
// localized period and bucket labels. Calendar parts are formatted in UTC: they already are dates
// in the company reporting timezone, so the display timezone never shifts them.

export type CalendarRange = { fromDate: string; toDateExclusive: string };

/** Days in a month; month 0 is December of the previous year (`Date.UTC` normalises it). */
function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The previous period of the same length, or null for all time (no comparison). This month is
 * compared with the same elapsed days of the previous month, clamped to its length (31 March:
 * 1 February to 1 March); last month with the month before; a rolling window with the preceding
 * window of the same number of days.
 */
export function previousPeriodQuery(
  period: OverviewPeriod,
  now: Date,
  timeZone: string,
): CalendarRange | null {
  if (period === "allTime") return null;
  const { year, month, day } = calendarToday(now, timeZone);
  if (period === "thisMonth")
    return {
      fromDate: isoDate(year, month - 1, 1),
      toDateExclusive: isoDate(year, month - 1, Math.min(day, daysInMonth(year, month - 1)) + 1),
    };
  if (period === "lastMonth")
    return { fromDate: isoDate(year, month - 2, 1), toDateExclusive: isoDate(year, month - 1, 1) };
  const days = period === "last7Days" ? 7 : 30;
  return {
    fromDate: isoDate(year, month, day + 1 - 2 * days),
    toDateExclusive: isoDate(year, month, day + 1 - days),
  };
}

const dateTag = { ru: "ru-RU", en: "en-GB" } as const;
const utcDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

/** The last day of a range: the day before its exclusive end. */
function inclusiveEnd(range: CalendarRange) {
  const end = utcDate(range.toDateExclusive);
  end.setUTCDate(end.getUTCDate() - 1);
  return end;
}

/** A range of calendar dates: "1–17 окт." or, long, "1–17 октября"; one day is one date. */
export function inclusiveRangeLabel(
  range: CalendarRange,
  locale: Locale,
  month: "short" | "long",
): string {
  const format = new Intl.DateTimeFormat(dateTag[locale], {
    day: "numeric",
    month,
    timeZone: "UTC",
  });
  const from = utcDate(range.fromDate);
  const to = inclusiveEnd(range);
  if (to.getTime() <= from.getTime()) return format.format(from);
  return format.formatRange(from, to);
}

/**
 * A chart bucket's date in the interface language: compact on the axis ("4 Oct", "Oct", or
 * "Oct 2026" when the buckets span calendar years), full in the tooltip and the table.
 */
export function bucketLabel(
  date: string,
  granularity: "day" | "month",
  locale: Locale,
  style: "axis" | "full",
  spansYears = false,
): string {
  const options: Intl.DateTimeFormatOptions =
    granularity === "day"
      ? style === "axis"
        ? { day: "numeric", month: "short" }
        : { day: "numeric", month: "long", year: "numeric" }
      : style === "axis"
        ? { month: "short", ...(spansYears ? { year: "numeric" } : {}) }
        : { month: "long", year: "numeric" };
  return new Intl.DateTimeFormat(dateTag[locale], { ...options, timeZone: "UTC" }).format(
    utcDate(date),
  );
}

/** True when the bucket dates fall in more than one calendar year. */
export function bucketsSpanYears(buckets: readonly { date: string }[]) {
  return new Set(buckets.map((bucket) => bucket.date.slice(0, 4))).size > 1;
}

/** The standalone month name ("ноябрь", "November"). */
export function monthName(year: number, month: number, locale: Locale): string {
  return new Intl.DateTimeFormat(dateTag[locale], { month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
}

/** "Ноябрь 2026" / "November 2026": the capitalised standalone month name and the year. */
export function monthYearLabel(year: number, month: number, locale: Locale): string {
  const name = monthName(year, month, locale);
  return `${name.charAt(0).toLocaleUpperCase(dateTag[locale])}${name.slice(1)} ${year}`;
}

/** A canonical non-negative decimal as an integer and its number of fraction digits. */
function decimalParts(value: string): { digits: bigint; scale: number } {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) throw new Error("INVALID_DECIMAL");
  const [integer = "0", fraction = ""] = value.split(".");
  return { digits: BigInt(`${integer}${fraction}`), scale: fraction.length };
}

/** Both decimals as integers on a common scale, never through Number. */
function commonScale(a: string, b: string): { a: bigint; b: bigint; scale: number } {
  const left = decimalParts(a);
  const right = decimalParts(b);
  const scale = Math.max(left.scale, right.scale);
  return {
    a: left.digits * 10n ** BigInt(scale - left.scale),
    b: right.digits * 10n ** BigInt(scale - right.scale),
    scale,
  };
}

/** A scaled integer back to its canonical decimal string. */
function scaledString(value: bigint, scale: number): string {
  const digits = value.toString().padStart(scale + 1, "0");
  if (scale === 0) return digits;
  const fraction = digits.slice(-scale).replace(/0+$/, "");
  return `${digits.slice(0, -scale)}${fraction ? `.${fraction}` : ""}`;
}

/**
 * The average accepted trip in metres, rounded half up to whole kilometres (whole thousands of
 * metres). Null without trips, so the tile says "No trips" instead of dividing by zero.
 */
export function averageDistanceM(distanceM: string, trips: number): string | null {
  if (!Number.isSafeInteger(trips) || trips <= 0) return null;
  const { digits, scale } = decimalParts(distanceM);
  const divisor = 10n ** BigInt(scale) * BigInt(trips) * 1000n;
  return String(((2n * digits + divisor) / (2n * divisor)) * 1000n);
}

export type Delta =
  | {
      kind: "up" | "down" | "same";
      /** Whole percent of the change without its sign; null for counts. */
      percent: number | null;
      /** A nonzero change that rounds to 0%: shown as "<1%". */
      lessThanOne: boolean;
      /** Exact absolute difference (metres for distance, a count for counts). */
      difference: string;
    }
  /** The previous period has no accepted trips: nothing to compare with. */
  | { kind: "noBaseline" }
  /** The previous read failed or a value is absent: unavailable, never zero. */
  | { kind: "unavailable" };

function direction(change: bigint): "up" | "down" | "same" {
  return change > 0n ? "up" : change < 0n ? "down" : "same";
}
const magnitude = (value: bigint) => (value < 0n ? -value : value);

/** Whole percent of `numerator / denominator` (denominator > 0), rounded half away from zero. */
function wholePercent(numerator: bigint, denominator: bigint) {
  const percent = (200n * magnitude(numerator) + denominator) / (2n * denominator);
  return { percent: Number(percent), lessThanOne: numerator !== 0n && percent === 0n };
}

/** The change of an exact decimal distance against the previous period, in whole percent. */
export function distanceDelta(current: string, previous: string): Delta {
  const { a, b, scale } = commonScale(current, previous);
  if (b === 0n) return { kind: "noBaseline" };
  const change = a - b;
  return {
    kind: direction(change),
    ...wholePercent(change, b),
    difference: scaledString(magnitude(change), scale),
  };
}

/** The exact difference of two decimal distances, without a percent (also from zero). */
export function differenceDelta(current: string, previous: string): Delta {
  const { a, b, scale } = commonScale(current, previous);
  const change = a - b;
  return {
    kind: direction(change),
    percent: null,
    lessThanOne: false,
    difference: scaledString(magnitude(change), scale),
  };
}

/** The signed absolute change of a count (accepted trips, active drivers). */
export function countDelta(current: number, previous: number): Delta {
  const change = BigInt(current) - BigInt(previous);
  return {
    kind: direction(change),
    percent: null,
    lessThanOne: false,
    difference: String(magnitude(change)),
  };
}

/**
 * The change of the average trip in whole percent, by exact cross-multiplication:
 * (Dc/Tc − Dp/Tp) / (Dp/Tp) = (Dc·Tp − Dp·Tc) / (Dp·Tc). Null without current trips (the tile
 * says "No trips" and shows no comparison).
 */
export function averageDelta(
  current: { distanceM: string; trips: number },
  previous: { distanceM: string; trips: number },
): Delta | null {
  if (current.trips <= 0) return null;
  if (previous.trips <= 0) return { kind: "noBaseline" };
  const { a, b, scale } = commonScale(current.distanceM, previous.distanceM);
  if (b === 0n) return { kind: "noBaseline" };
  const tc = BigInt(current.trips);
  const tp = BigInt(previous.trips);
  const change = a * tp - b * tc;
  // Exact difference of the averages in metres, rounded half away from zero like the percent.
  const denominator = tc * tp * 10n ** BigInt(scale);
  const difference = (2n * magnitude(change) + denominator) / (2n * denominator);
  return {
    kind: direction(change),
    ...wholePercent(change, b * tc),
    difference: String(difference),
  };
}
