import type { TxContext, UnitOfWork } from "@vtc/db";
import { desc, eq, tripDecisions, tripEventAssociations } from "@vtc/db/trip-decisions-schema";
import type { Events } from "../events/service.js";
import type { TripState } from "../trips/groups.js";

/** Acceptance owns the relation; Trips projects and fences the corresponding owners. */
export function companionEventTripRelation(unit: UnitOfWork, tx: TxContext, eventId: string) {
  return unit
    .client(tx)
    .select({ id: tripEventAssociations.tripId })
    .from(tripEventAssociations)
    .where(eq(tripEventAssociations.eventId, eventId));
}

/** Retained immutable assessment only: deliberately excludes reviewer reads and catch-up. */
export function createCompanionAssessments(unit: UnitOfWork, events: Events) {
  const c = (tx: TxContext) => unit.client(tx);
  return {
    async read(tx: TxContext, root: TripState) {
      const [decision] = await c(tx)
        .select({
          id: tripDecisions.id,
          sequence: tripDecisions.sequence,
          factId: tripDecisions.factId,
          outcome: tripDecisions.outcome,
          assignmentId: tripDecisions.assignmentId,
          qualificationSnapshot: tripDecisions.qualificationSnapshot,
          eventRevisionId: tripDecisions.eventRevisionId,
          attendanceRevisionId: tripDecisions.attendanceRevisionId,
          decidedAt: tripDecisions.decidedAt,
        })
        .from(tripDecisions)
        .where(eq(tripDecisions.tripId, root.id))
        .orderBy(desc(tripDecisions.sequence))
        .limit(1)
        .for("share");
      const [association] = await c(tx)
        .select({ eventId: tripEventAssociations.eventId })
        .from(tripEventAssociations)
        .where(eq(tripEventAssociations.tripId, root.id))
        .for("share");
      let stale = false;
      if (association) {
        try {
          const current = await events.currentAssociationInTransaction(tx, {
            eventId: association.eventId,
            memberId: root.ownerId,
            game: root.game,
          });
          stale =
            !!decision &&
            (current.eventRevisionId !== decision.eventRevisionId ||
              current.attendanceRevisionId !== decision.attendanceRevisionId ||
              current.reviewRequired);
        } catch (error) {
          if ([404, 409].includes(Number((error as { statusCode?: number }).statusCode)))
            stale = true;
          else throw error;
        }
      }
      return {
        decision: decision && root.decision === decision.outcome ? decision : null,
        eventStale: stale,
      };
    },
  };
}
