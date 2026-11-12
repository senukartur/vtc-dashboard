import { useMutation, useMutationState, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { useSession } from "../../app/Session.js";
import type { DTO } from "./model.js";
import { useEventCommand } from "./queries.js";
import { eventStage2SessionScope, isEventStage2QueryKey } from "./stage-2-queries.js";
import { eventPhase, type ResponseValue } from "./view-model.js";

export type ResponseProjection = Pick<DTO["EventStage2Upcoming"], "event" | "myResponse">;
type QueryKey = readonly unknown[];
type QuickResponse = "participating" | "declined";
type Intent = { version: number; response: QuickResponse; countBefore: number | undefined };
type CacheRead<T> = { data: T; etag: string | null };
type Counts = DTO["EventResponseCounts"];

const memberList = "EventStage2EnvelopeMemberList";
const upcoming = "EventStage2EnvelopeUpcoming";

export function useEventResponseScope() {
  return eventStage2SessionScope(useSession());
}

function responseVersion(projection: ResponseProjection) {
  // The generated VTC-126 wire version is absent on the Stage 2 foundation base.
  const value = "myResponseVersion" in projection ? projection.myResponseVersion : null;
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

const responseKey = (scope: string | null, eventId: string) =>
  ["event-quick-response", scope, eventId] as const;

function belongsTo(key: QueryKey, scope: string | null) {
  return isEventStage2QueryKey(key) && key[1] === scope && key.at(-3) === "company.read";
}

export function responseDelta(previous: ResponseValue | null, next: ResponseValue | null) {
  if (previous === null || next === null) return { participating: 0, declined: 0 };
  return {
    participating: Number(next === "participating") - Number(previous === "participating"),
    declined: Number(next === "declined") - Number(previous === "declined"),
  };
}

export function addResponseDelta(counts: Counts, delta: Counts): Counts {
  return {
    participating: Math.max(0, counts.participating + delta.participating),
    declined: Math.max(0, counts.declined + delta.declined),
  };
}

export function useEventResponseView(projection: ResponseProjection) {
  const scope = useEventResponseScope();
  const version = responseVersion(projection);
  const pending = useMutationState({
    filters: {
      mutationKey: responseKey(scope, projection.event.id),
      exact: true,
      status: "pending",
    },
    select: (mutation) => mutation.state.variables as Intent,
  }).at(-1);
  const response =
    pending && pending.version === version ? pending.response : projection.myResponse;

  const delta = responseDelta(projection.myResponse, response);
  return {
    version,
    response,
    pending: !!pending,
    delta,
    goingCount:
      pending?.countBefore === undefined || pending.version !== version
        ? undefined
        : Math.max(0, pending.countBefore + delta.participating),
  };
}

export function useEventQuickCommand(projection: ResponseProjection) {
  const client = useQueryClient();
  const session = useSession();
  const scope = eventStage2SessionScope(session);
  const { event } = projection;
  const mutationKey = responseKey(scope, event.id);
  const version = responseVersion(projection);
  const held = useRef<{ input: DTO["RsvpInput"]; version: number } | null>(null);
  const input = useRef<DTO["RsvpInput"] | null>(null);

  const command = useEventCommand((failure) => {
    if (failure.kind === "conflict") {
      held.current = null;
      void client.invalidateQueries({
        predicate: ({ queryKey }) =>
          belongsTo(queryKey, scope) && [memberList, upcoming].includes(String(queryKey.at(-1))),
      });
    } else if (!["uncertain", "unavailable", "limited"].includes(failure.kind)) {
      held.current = null;
    }
  });

  async function applyResponse(confirmed: DTO["Rsvp"]) {
    // Ignore an old read finishing after the committed response. Leave unrelated or
    // not-yet-loaded pages alone; the ordinary success path patches rows without a list reload.
    await client.cancelQueries({
      predicate: ({ queryKey, state }) => {
        if (!belongsTo(queryKey, scope)) return false;
        if (queryKey.at(-1) === memberList) {
          const read = state.data as CacheRead<DTO["EventStage2EnvelopeMemberList"]> | undefined;
          return read?.data.data.items.some((row) => row.event.id === event.id) ?? false;
        }
        if (queryKey.at(-1) === upcoming) {
          const read = state.data as CacheRead<DTO["EventStage2EnvelopeUpcoming"]> | undefined;
          return read?.data.data?.event.id === event.id;
        }
        return false;
      },
    });
    function patch<T extends ResponseProjection>(current: T) {
      const currentVersion = responseVersion(current);
      if (
        current.event.id !== event.id ||
        currentVersion === null ||
        currentVersion >= confirmed.version
      )
        return current;
      return { ...current, myResponse: confirmed.response, myResponseVersion: confirmed.version };
    }

    client.setQueriesData<CacheRead<DTO["EventStage2EnvelopeMemberList"]>>(
      { predicate: ({ queryKey }) => belongsTo(queryKey, scope) && queryKey.at(-1) === memberList },
      (read) => {
        if (!read) return read;
        const items = read.data.data.items.map((row) => {
          const next = patch(row);
          if (next === row) return row;
          return {
            ...next,
            responseCounts: addResponseDelta(
              row.responseCounts,
              responseDelta(row.myResponse, next.myResponse),
            ),
          };
        });
        return { ...read, data: { ...read.data, data: { ...read.data.data, items } } };
      },
    );
    client.setQueriesData<CacheRead<DTO["EventStage2EnvelopeUpcoming"]>>(
      { predicate: ({ queryKey }) => belongsTo(queryKey, scope) && queryKey.at(-1) === upcoming },
      (read) => {
        if (!read?.data.data) return read;
        return { ...read, data: { ...read.data, data: patch(read.data.data) } };
      },
    );
  }

  const mutation = useMutation({
    mutationKey,
    gcTime: 0,
    retry: false,
    mutationFn: async (intent: Intent) => {
      const body = input.current;
      input.current = null;
      if (!body) return false;
      held.current = { input: body, version: intent.version };
      const result = await command.run(
        `/events/${event.id}/my-response`,
        body,
        "EnvelopeRsvp",
        `"v${intent.version}"`,
        "PUT",
      );
      if (!result) return false;
      held.current = null;
      await applyResponse(result.data.data);
      return true;
    },
  });

  return {
    failure: command.failure,
    seconds: command.seconds,
    async run(body: DTO["RsvpInput"] & { response: QuickResponse }) {
      if (
        !scope ||
        !session.self?.capabilities.includes("events.respond") ||
        version === null ||
        eventPhase(event, Date.now()) !== "open" ||
        command.seconds > 0 ||
        client.isMutating({ mutationKey, exact: true })
      )
        return false;
      const self = session.self;
      const counts = client.getQueryData<CacheRead<DTO["EnvelopeEventResponseCounts"]>>([
        "events",
        self.member.id,
        session.generation,
        self.identityEpoch,
        self.capabilities.join(","),
        `/events/${event.id}/response-counts`,
        "EnvelopeEventResponseCounts",
      ]);
      const prior = held.current;
      const same = prior && JSON.stringify(prior.input) === JSON.stringify(body);
      input.current = body;
      return mutation.mutateAsync({
        response: body.response,
        countBefore: counts?.data.data.participating,
        version: same ? prior.version : version,
      });
    },
  };
}
