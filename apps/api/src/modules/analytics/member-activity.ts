import type { components } from "@vtc/contracts";
import { trips } from "@vtc/db/trips-schema";
import { and, eq, gte, isNull, lte, type SQL, type SQLWrapper, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { decimal } from "./service.js";

type Totals = components["schemas"]["AnalyticsStage4Totals"];

// Each correlated subquery reads its own alias so one statement can embed all three.
const counted = alias(trips, "directory_window_trips");
const measured = alias(trips, "directory_window_distance");
const latest = alias(trips, "directory_last_trip");

type TripAlias = typeof counted | typeof measured | typeof latest;
// A raw template renders an alias by its name only, so name the base table explicitly.
const from = (table: TripAlias) => sql`${trips} ${table}`;
const accepted = (table: TripAlias, ownerRef: SQLWrapper) =>
  and(eq(table.ownerId, ownerRef), eq(table.decision, "accepted"), isNull(table.aliasOf));
const window = (table: TripAlias, fromInclusive: string, throughInclusive: string) =>
  and(gte(table.reportingAt, fromInclusive), lte(table.reportingAt, throughInclusive));

/**
 * Read-only member directory activity (VTC-140): scalar subqueries over accepted unique canonical
 * trips for the caller's owner reference. They use the trip_owner_accepted_reporting covering
 * index, read the caller's transaction snapshot and take no trip locks.
 */
export function createMemberDirectoryActivity() {
  return {
    acceptedTrips(ownerRef: SQLWrapper, fromInclusive: string, throughInclusive: string): SQL {
      return sql`(SELECT COUNT(*) FROM ${from(counted)} WHERE ${accepted(counted, ownerRef)} AND ${window(counted, fromInclusive, throughInclusive)})`;
    },
    acceptedDistance(ownerRef: SQLWrapper, fromInclusive: string, throughInclusive: string): SQL {
      return sql`COALESCE((SELECT SUM(${measured.actualDistanceM}) FROM ${from(measured)} WHERE ${accepted(measured, ownerRef)} AND ${window(measured, fromInclusive, throughInclusive)}), 0)`;
    },
    // The column decoder returns canonical UTC ISO text with milliseconds, or null without trips.
    lastAcceptedAt(ownerRef: SQLWrapper): SQL<string | null> {
      return sql<
        string | null
      >`(SELECT MAX(${latest.reportingAt}) FROM ${from(latest)} WHERE ${accepted(latest, ownerRef)})`.mapWith(
        latest.reportingAt,
      );
    },
    totals(count: number | string, sum: number | string): Totals {
      const acceptedTrips = Number(count);
      if (!Number.isSafeInteger(acceptedTrips) || acceptedTrips < 0)
        throw new Error("DIRECTORY_TRIP_COUNT_INVALID");
      const text = String(sum);
      if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(text)) throw new Error("DIRECTORY_DISTANCE_SUM_INVALID");
      return { acceptedTrips, actualDistanceM: decimal(text) };
    },
  };
}
export type MemberDirectoryActivity = ReturnType<typeof createMemberDirectoryActivity>;
