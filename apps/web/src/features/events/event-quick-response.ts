import { type Query, useMutation, useMutationState, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { useSession } from "../../app/Session.js";
import {
  type CacheRead,
  isColdStage2EventProjection,
  stage2EventProjection,
} from "./event-projection-cache.js";
import type { DTO } from "./model.js";
import { useEventCommand } from "./queries.js";
import { eventStage2SessionScope } from "./stage-2-queries.js";
import { eventPhase, type ResponseValue } from "./view-model.js";

export type ResponseProjection = Pick<
  DTO["EventStage2Upcoming"],
  "event" | "myResponse" | "myResponseVersion"
>;
type QuickResponse = "participating" | "declined";
type Intent = { version: number; response: QuickResponse; countBefore: number | undefined };
type Counts = DTO["EventResponseCounts"];

export function useEventResponseScope() {
  return eventStage2SessionScope(useSession());
}

function responseVersion(projection: ResponseProjection) {
  const value = projection.myResponseVersion;
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

const responseKey = (scope: string | null, eventId: string) =>
  ["event-quick-response", scope, eventId] as const;

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

  const command = useEventCommand(
    (failure) => {
      if (!["uncertain", "unavailable", "limited"].includes(failure.kind)) held.current = null;
    },
    { quickResponse: true },
  );

  async function applyResponse(confirmed: DTO["Rsvp"]) {
    function older(row: ResponseProjection) {
      const currentVersion = responseVersion(row);
      return (
        row.event.id === event.id && currentVersion !== null && currentVersion < confirmed.version
      );
    }

    function eligible(query: Query) {
      if (query.state.status !== "success") return undefined;
      const projection = stage2EventProjection(query, scope);
      return projection?.rows.some(older) ? projection : undefined;
    }

    function patch<T extends ResponseProjection>(current: T) {
      return { ...current, myResponse: confirmed.response, myResponseVersion: confirmed.version };
    }

    // A first read has no rows to patch and can still publish the pre-write version.
    const cold = new Set(
      client.getQueryCache().findAll({
        predicate: (query) => isColdStage2EventProjection(query, scope),
      }),
    );
    const predicate = (query: Query) => eligible(query) !== undefined;
    await client.cancelQueries({ predicate: (query) => cold.has(query) || predicate(query) });
    for (const query of client.getQueryCache().findAll({ predicate })) {
      const projection = eligible(query);
      if (!projection) continue;
      const {
        queryKey,
        state: { dataUpdatedAt, isInvalidated },
      } = query;
      const { read } = projection;
      if (projection.kind === "list") {
        const items = projection.rows.map((row) =>
          older(row)
            ? {
                ...patch(row),
                responseCounts: addResponseDelta(
                  row.responseCounts,
                  responseDelta(row.myResponse, confirmed.response),
                ),
              }
            : row,
        );
        client.setQueryData(
          queryKey,
          { ...read, data: { ...read.data, data: { ...read.data.data, items } } },
          { updatedAt: dataUpdatedAt },
        );
      } else {
        client.setQueryData(
          queryKey,
          { ...read, data: { ...read.data, data: patch(projection.rows[0]) } },
          { updatedAt: dataUpdatedAt },
        );
      }
      // Changing the response is independent of any pending definition or lifecycle refresh.
      if (isInvalidated)
        void client.invalidateQueries({ queryKey, exact: true, refetchType: "none" });
    }
    if (cold.size) {
      await client.refetchQueries(
        { type: "active", predicate: (query) => cold.has(query) && query.state.data === undefined },
        { cancelRefetch: false },
      );
    }
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
      if (!result.replay) await applyResponse(result.data.data);
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
