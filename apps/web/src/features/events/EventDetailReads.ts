import type { DetailEvent, DetailMember } from "./EventDetailContent.js";
import type { DTO } from "./model.js";
import { useEventQuery } from "./queries.js";
import { useEventStage2Query } from "./stage-2-queries.js";
import { type EventStage2Locale, eventStage2Reads } from "./stage-2-transport.js";
import { EventFailure, schema } from "./transport.js";

function legacySelectorRejected(id: string, error: unknown) {
  // Flag-off deployments reject the locale query before reading the event.
  return (
    error instanceof EventFailure && error.status === 422 && schema("Id").safeParse(id).success
  );
}

function legacyEvent(event: DTO["EventPublic"]): DetailEvent {
  return {
    ...event,
    platform: null,
    originDepot: null,
    destinationDepot: null,
    distanceKm: null,
    requiredDlcs: null,
    hasCover: false,
  };
}

function legacyMember(member: DTO["EventMember"]): DetailMember {
  return {
    ...member,
    event: legacyEvent(member.event),
    organizerMemberId: null,
    responseCounts: null,
    prescribedCargo: null,
    prescribedTrailerType: null,
  };
}

export function usePublicDetailRead(id: string, locale: EventStage2Locale) {
  const staged = useEventStage2Query(eventStage2Reads.publicDetail(id, locale));
  const fallback = legacySelectorRejected(id, staged.error);
  const legacy = useEventQuery(
    `/public/events/${encodeURIComponent(id)}`,
    "EnvelopeEventPublic",
    fallback,
  );
  return {
    query: fallback ? legacy : staged,
    event: fallback ? legacy.data && legacyEvent(legacy.data.data.data) : staged.data?.data.data,
  };
}

export function useMemberDetailRead(id: string, locale: EventStage2Locale, allowed: boolean) {
  const staged = useEventStage2Query(eventStage2Reads.memberDetail(id, locale), allowed);
  const fallback = allowed && legacySelectorRejected(id, staged.error);
  const legacy = useEventQuery(
    `/events/${encodeURIComponent(id)}`,
    "EnvelopeEventMember",
    fallback,
  );
  const snapshot = fallback
    ? legacy.data && {
        member: legacyMember(legacy.data.data.data),
        etag: legacy.data.etag,
        staged: false,
      }
    : staged.data && { member: staged.data.data.data, etag: staged.data.etag, staged: true };
  return { query: fallback ? legacy : staged, snapshot };
}
