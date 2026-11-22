import type { components } from "@vtc/contracts";
import type { TxContext, UnitOfWork } from "@vtc/db";
import { and, desc, eq, gt, sql, tripDecisions } from "@vtc/db/trip-decisions-schema";
import { isNotNull, notExists, or, type SQLWrapper, type Subquery } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";

type ReturnedTrips = NonNullable<components["schemas"]["WorkspaceSummary"]["tripsNeedingFixes"]>;

interface ReturnedTripSources {
  // One row per direct member, including the root itself, of each owned effectively rejected group.
  rejectedGroupMembers(
    tx: TxContext,
    viewerId: string,
  ): Subquery & { canonicalTripId: SQLWrapper; groupMemberTripId: SQLWrapper };
  // Current author-resubmittable revisions, each uniquely identified by revisionId.
  resubmittableRevisions(
    tx: TxContext,
    viewerId: string,
  ): Subquery & { reportTripId: SQLWrapper; revisionId: SQLWrapper };
}

export function createTripDecisionWorkspace(unit: UnitOfWork, sources: ReturnedTripSources) {
  const newer = alias(tripDecisions, "workspace_newer_decision");
  return {
    async workspaceReturnedTripsInTransaction(
      tx: TxContext,
      viewerId: string,
    ): Promise<ReturnedTrips> {
      // The caller has checked trips.read_own_private. Use the same snapshot for both reads.
      const client = unit.client(tx);
      const group = sources.rejectedGroupMembers(tx, viewerId);
      const revisions = sources.resubmittableRevisions(tx, viewerId);
      const eligible = client
        .select({
          tripId: tripDecisions.tripId,
          decidedAt: tripDecisions.decidedAt,
          reason: tripDecisions.reason,
        })
        .from(group)
        .innerJoin(tripDecisions, eq(tripDecisions.tripId, group.canonicalTripId))
        .leftJoin(
          revisions,
          and(
            eq(group.groupMemberTripId, revisions.reportTripId),
            eq(tripDecisions.reviewedRevisionId, revisions.revisionId),
          ),
        )
        .where(
          and(
            // A returned manual revision the author can resubmit, or a returned telemetry trip the
            // author can correct: its decision reviewed the root's own fact (VTC-169).
            or(
              isNotNull(revisions.revisionId),
              and(
                eq(group.groupMemberTripId, group.canonicalTripId),
                eq(tripDecisions.reviewedRevisionId, tripDecisions.factId),
              ),
            ),
            // A newer row of any outcome, author or revision supersedes this root decision.
            notExists(
              client
                .select({ id: newer.id })
                .from(newer)
                .where(
                  and(
                    eq(newer.tripId, tripDecisions.tripId),
                    gt(newer.sequence, tripDecisions.sequence),
                  ),
                ),
            ),
            eq(tripDecisions.outcome, "rejected"),
            isNotNull(tripDecisions.actorId),
            // Only a return for fixes; a plain rejection is final (VTC-169).
            sql`JSON_CONTAINS(${tripDecisions.reasonCodes}, '"returned_for_fixes"')`,
          ),
        )
        .as("workspace_returned_trips");

      const [totals] = await client
        .select({ count: sql<number | string>`count(*)` })
        .from(eligible);
      const preview = await client
        .select({ tripId: eligible.tripId, reason: eligible.reason })
        .from(eligible)
        .orderBy(desc(eligible.decidedAt), desc(eligible.tripId))
        .limit(5);
      return {
        count: Number(totals?.count ?? 0),
        items: preview.map(({ tripId, reason }) => ({
          tripId,
          latestReturnReason: reason?.trim() ? reason : null,
        })),
      };
    },
  };
}
