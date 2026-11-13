import { useQuery } from "@tanstack/react-query";
import { withReadSlot } from "../../shared/read-scheduler.js";
import { AccountFailure } from "../account/transport.js";
import type { DetailEvent, DetailMember } from "./EventDetailContent.js";
import type { DTO } from "./model.js";
import { useEventQuery } from "./queries.js";
import { useEventStage2Query } from "./stage-2-queries.js";
import { type EventStage2Locale, eventStage2Reads } from "./stage-2-transport.js";
import { fail, schema } from "./transport.js";

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

async function readPublicDetail(
  spec: ReturnType<typeof eventStage2Reads.publicDetail>,
  signal: AbortSignal,
): Promise<DetailEvent> {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
  try {
    return await withReadSlot(bounded, async () => {
      const response = await fetch(`/api/v1${spec.path}`, {
        credentials: "omit",
        cache: "no-store",
        signal: bounded,
        headers: { Accept: "application/json" },
      });
      try {
        if (response.status !== 200) fail(response);
        const body: unknown = await response.json();
        bounded.throwIfAborted();
        const staged = schema(spec.schema).safeParse(body);
        if (staged.success) return staged.data.data;
        const legacy = schema("EnvelopeEventPublic").safeParse(body);
        if (legacy.success) return legacyEvent(legacy.data.data);
        throw new AccountFailure("unavailable");
      } finally {
        if (!response.bodyUsed) await response.body?.cancel().catch(() => undefined);
      }
    });
  } catch (error) {
    if (error instanceof AccountFailure) throw error;
    throw new AccountFailure("unavailable");
  }
}

export function usePublicDetailRead(id: string, locale: EventStage2Locale) {
  const spec = eventStage2Reads.publicDetail(id, locale);
  const query = useQuery({
    // The Stage 2 namespace lets management and media commands invalidate this read.
    queryKey: ["events-stage-2", "public", spec.access, spec.path, "compatible-public-detail"],
    meta: { private: false },
    retry: false,
    gcTime: 300000,
    staleTime: 30000,
    queryFn: ({ signal }) => readPublicDetail(spec, signal),
  });
  return { query, event: query.isError ? undefined : query.data };
}

export function useMemberDetailRead(
  id: string,
  locale: EventStage2Locale,
  allowed: boolean,
  stage2Enabled: boolean,
) {
  const staged = useEventStage2Query(
    eventStage2Reads.memberDetail(id, locale),
    allowed && stage2Enabled,
  );
  const legacy = useEventQuery(
    `/events/${encodeURIComponent(id)}`,
    "EnvelopeEventMember",
    allowed && !stage2Enabled,
  );
  const snapshot = stage2Enabled
    ? staged.data && { member: staged.data.data.data, etag: staged.data.etag }
    : legacy.data && { member: legacyMember(legacy.data.data.data), etag: legacy.data.etag };
  return { query: stage2Enabled ? staged : legacy, snapshot };
}
