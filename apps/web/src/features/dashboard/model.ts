// Pure overview dashboard helpers: filter values, period ranges and progress geometry.
import type { components } from "@vtc/contracts";
import { chartGeometry } from "../../shared/formatting.js";

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
function calendarToday(now: Date, timeZone: string): { year: number; month: number; day: number } {
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
function isoDate(year: number, month: number, day: number): string {
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
