import type { components } from "@vtc/contracts";
import { applicationId, type TxContext, type UnitOfWork } from "@vtc/db";
import {
  and,
  asc,
  eq,
  eventResponses,
  eventRevisions,
  events,
  gt,
  isNull,
  or,
  sql,
} from "@vtc/db/events-schema";

type UpcomingEvents = NonNullable<
  components["schemas"]["WorkspaceSummary"]["unansweredUpcomingEvents"]
>;

export function createEventWorkspace(unit: UnitOfWork) {
  return {
    async workspaceUnansweredEventsInTransaction(
      tx: TxContext,
      viewerId: string,
      computedAt: string,
    ): Promise<UpcomingEvents> {
      // The caller has checked events.respond. Both event visibility classes are open to members.
      const client = unit.client(tx);
      const viewerResponse = and(
        eq(eventResponses.eventId, events.id),
        eq(eventResponses.memberId, applicationId(viewerId)),
      );
      const unansweredUpcoming = and(
        eq(events.status, "scheduled"),
        gt(events.startsAt, computedAt),
        or(isNull(eventResponses.id), eq(eventResponses.status, "unanswered")),
      );
      const [totals] = await client
        .select({ count: sql<number | string>`count(*)` })
        .from(events)
        .leftJoin(eventResponses, viewerResponse)
        .where(unansweredUpcoming);
      const preview = await client
        .select({ eventId: events.id, title: eventRevisions.title, startsAt: events.startsAt })
        .from(events)
        .leftJoin(eventResponses, viewerResponse)
        .leftJoin(
          eventRevisions,
          and(
            eq(eventRevisions.id, events.currentRevisionId),
            eq(eventRevisions.eventId, events.id),
            eq(eventRevisions.version, events.version),
          ),
        )
        .where(unansweredUpcoming)
        .orderBy(asc(events.startsAt), asc(events.id))
        .limit(5);
      return {
        count: Number(totals?.count ?? 0),
        items: preview.map(({ eventId, title, startsAt }) => {
          if (title === null) throw new Error("EVENT_REVISION_MISSING");
          return { eventId, title, startsAt };
        }),
      };
    },
  };
}
