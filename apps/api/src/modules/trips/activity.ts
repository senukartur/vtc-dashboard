import type { TxContext, UnitOfWork } from "@vtc/db";
import { and, eq, inArray, isNull, sql, trips } from "@vtc/db/trips-schema";

// Read-only Trips facade for member administration (VTC-064A). It reports, per owner, the
// latest reporting instant of accepted canonical trips; aliases, other decisions and undated
// trips are ignored. It is a plain consistent read on the caller's transaction that takes no
// trip locks, so it runs after the coordinator's identity and qualification locks.
export function createTripActivity(unit: UnitOfWork) {
  return {
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
