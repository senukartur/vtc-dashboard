// Pure overview dashboard helpers: filter values, period ranges and progress geometry.
import { chartGeometry } from "../../shared/formatting.js";

export type GameFilter = "all" | "ets2" | "ats";
export type PeriodFilter = "thisMonth" | "lastMonth" | "last30Days" | "last7Days";

export const periods: readonly PeriodFilter[] = [
  "thisMonth",
  "lastMonth",
  "last30Days",
  "last7Days",
];

// Period anchor ("today", month start) uses the UTC clock; the API interprets the dates in the reporting timezone.
export function computePeriodDates(
  period: PeriodFilter,
  now = new Date(),
): { fromDate: string; toDateExclusive: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const formatDate = (d: Date) =>
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth();

  if (period === "thisMonth") {
    const from = new Date(Date.UTC(currentYear, currentMonth, 1));
    const to = new Date(Date.UTC(currentYear, currentMonth + 1, 1));
    return { fromDate: formatDate(from), toDateExclusive: formatDate(to) };
  }
  if (period === "lastMonth") {
    const from = new Date(Date.UTC(currentYear, currentMonth - 1, 1));
    const to = new Date(Date.UTC(currentYear, currentMonth, 1));
    return { fromDate: formatDate(from), toDateExclusive: formatDate(to) };
  }
  if (period === "last7Days") {
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    const from = new Date(to.getTime() - 7 * 86400000);
    return { fromDate: formatDate(from), toDateExclusive: formatDate(to) };
  }
  // last30Days
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const from = new Date(to.getTime() - 30 * 86400000);
  return { fromDate: formatDate(from), toDateExclusive: formatDate(to) };
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
