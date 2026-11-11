import type { TxContext, UnitOfWork } from "@vtc/db";
import { and, eq, isNull, sql, trips } from "@vtc/db/trips-schema";
import { count, min, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { tripListQuery } from "./service.js";

const member = alias(trips, "workspace_rejected_member");

export function createTripWorkspace(unit: UnitOfWork) {
  return {
    // The caller checks trips.review in the same transaction before requesting the aggregate.
    async workspaceReviewQueueInTransaction(
      tx: TxContext,
      viewerId: string,
    ): Promise<{ count: number; oldestCreatedAt: string | null }> {
      const db = unit.client(tx);
      const queue = tripListQuery(db, { scope: "review", viewerId, hold: true });
      const [summary] = await db
        .select({ count: count(), oldestCreatedAt: min(trips.createdAt) })
        .from(trips)
        .where(and(queue.where, ne(trips.ownerId, viewerId)));
      return { count: summary?.count ?? 0, oldestCreatedAt: summary?.oldestCreatedAt ?? null };
    },

    // The caller checks trips.read_own_private. Acceptance decides which revisions qualify.
    rejectedGroupMembers(tx: TxContext, viewerId: string) {
      const db = unit.client(tx);
      const ownRejectedRoots = and(
        eq(trips.ownerId, viewerId),
        eq(trips.decision, "rejected"),
        isNull(trips.aliasOf),
      );
      const canonicalTripId = sql<string>`${trips.id}`.mapWith(trips.id).as("canonical_trip_id");
      const roots = db
        .select({
          canonicalTripId,
          groupMemberTripId: sql<string>`${trips.id}`.mapWith(trips.id).as("group_member_trip_id"),
        })
        .from(trips)
        .where(ownRejectedRoots);
      const aliases = db
        .select({ canonicalTripId, groupMemberTripId: member.id })
        .from(trips)
        .innerJoin(
          member,
          and(
            eq(member.aliasOf, trips.id),
            eq(member.ownerId, trips.ownerId),
            eq(member.game, trips.game),
          ),
        )
        .where(ownRejectedRoots);
      // Separate branches let the alias join probe by alias_of without an OR on the join key.
      return roots.unionAll(aliases).as("workspace_rejected_group_members");
    },
  };
}
