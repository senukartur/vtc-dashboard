import type { TxContext, UnitOfWork } from "@vtc/db";
import { and, eq, inArray, isNull, sql, trips } from "@vtc/db/trips-schema";
import { exists, gte, lte, type SQLWrapper } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";

const acceptedTrip = alias(trips, "accepted_reporting_activity");

// Read-only Trips facade for member administration. It reads the latest reporting instant or
// supplies an interval predicate for accepted canonical trips. Both use the caller's transaction
// without taking trip locks, after the coordinator's identity and qualification locks.
export function createTripActivity(unit: UnitOfWork) {
  return {
    // Compose into the caller's owner query after authorizing the activity projection.
    hasAcceptedReportingActivity(
      tx: TxContext,
      ownerRef: SQLWrapper,
      fromInclusive: string,
      throughInclusive: string,
    ) {
      return exists(
        unit
          .client(tx)
          .select({ one: sql`1` })
          .from(acceptedTrip)
          .where(
            and(
              eq(acceptedTrip.ownerId, ownerRef),
              eq(acceptedTrip.decision, "accepted"),
              isNull(acceptedTrip.aliasOf),
              gte(acceptedTrip.reportingAt, fromInclusive),
              lte(acceptedTrip.reportingAt, throughInclusive),
            ),
          ),
      );
    },
    async lastAcceptedInTransaction(
      tx: TxContext,
      ownerIds: readonly string[],
    ): Promise<Map<string, string>> {
      if (ownerIds.length > 100) throw new Error("TRIP_ACTIVITY_BOUND_EXCEEDED");
      const result = new Map<string, string>();
      if (!ownerIds.length) return result;
      const rows = await unit
        .client(tx)
        .select({
          ownerId: trips.ownerId,
          // The column decoder returns the canonical UTC ISO form with milliseconds.
          lastAcceptedAt: sql<string>`max(${trips.reportingAt})`.mapWith(trips.reportingAt),
        })
        .from(trips)
        .where(
          and(
            inArray(trips.ownerId, [...ownerIds]),
            eq(trips.decision, "accepted"),
            isNull(trips.aliasOf),
            sql`${trips.reportingAt} IS NOT NULL`,
          ),
        )
        .groupBy(trips.ownerId);
      for (const row of rows) if (row.lastAcceptedAt) result.set(row.ownerId, row.lastAcceptedAt);
      return result;
    },
  };
}
export type TripActivity = ReturnType<typeof createTripActivity>;
