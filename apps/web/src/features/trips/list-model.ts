import type { operations } from "@vtc/contracts";
import { computePeriodDates, periods } from "../dashboard/model.js";
import { type DTO, tripFilters, validId } from "./transport.js";

type ListQuery = NonNullable<operations["listTrips"]["parameters"]["query"]>;
export type TripOrder = Extract<ListQuery["order"], `completion_${string}`>;
export const SEARCH_LIMIT = 128;

export function tripSearch(value: string) {
  // Count Unicode code points, the length unit of the JSON Schema string constraint.
  return Array.from(value.trim()).slice(0, SEARCH_LIMIT).join("").trimEnd();
}

export function tripListFilters(params: URLSearchParams) {
  const filters = tripFilters(params);
  const owner = params.get("ownerId") ?? undefined;
  const period = periods.find((value) => value === params.get("period"));
  const order: TripOrder =
    params.get("order") === "completion_asc" ? "completion_asc" : "completion_desc";
  return {
    ...filters,
    decision: filters.scope === "mine" ? filters.decision : undefined,
    ownerId: filters.scope === "company" && validId(owner) ? owner : undefined,
    q: tripSearch(params.get("q") ?? ""),
    period,
    order,
  };
}

/** Convert one local date boundary to an instant. Choose the earlier instant in a fold and
 * advance by the offset change if midnight falls in a gap. */
function localMidnight(date: string, formatter: Intl.DateTimeFormat) {
  const midnight = Date.parse(`${date}T00:00:00Z`);
  const offsetAt = (instant: number) => {
    const parts = formatter.formatToParts(instant);
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value;
    const local = `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}:${value("second")}Z`;
    return Date.parse(local) - instant;
  };
  const day = 86_400_000;
  const earlier = midnight - offsetAt(midnight + day);
  const later = midnight - offsetAt(midnight - day);
  const first = Math.min(earlier, later);
  return new Date(first + offsetAt(first) === midnight ? first : Math.max(earlier, later));
}

export function tripPeriodBounds(
  period: NonNullable<ReturnType<typeof tripListFilters>["period"]>,
  now: Date,
  timeZone: string,
): { from: string; toExclusive: string } | undefined {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    return undefined;
  }
  const { fromDate, toDateExclusive } = computePeriodDates(period, now, timeZone);
  return {
    from: localMidnight(fromDate, formatter).toISOString(),
    toExclusive: localMidnight(toDateExclusive, formatter).toISOString(),
  };
}

const timestampLabels = {
  actual_completion: null,
  manual_confirmation: "manual_confirmation",
  unknown: "reportingColumn",
} as const satisfies Record<NonNullable<DTO["TripSummary"]["reportingBasis"]>, string | null>;

export function tripListTimestamp(trip: DTO["TripSummary"]) {
  if (!trip.reportingAt) return null;
  return { at: trip.reportingAt, label: timestampLabels[trip.reportingBasis ?? "unknown"] };
}
