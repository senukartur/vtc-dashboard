import type { Query, QueryClient } from "@tanstack/react-query";
import type { DTO } from "./model.js";
import { isEventStage2QueryKey } from "./stage-2-queries.js";

export type CacheRead<T> = { data: T; etag: string | null };
type ProjectionEvent = DTO["EventStage2Public"];

function projectionKind(query: Query, scope: string | null) {
  const { queryKey } = query;
  if (
    !scope ||
    !isEventStage2QueryKey(queryKey) ||
    queryKey[1] !== scope ||
    queryKey.at(-3) !== "company.read"
  )
    return undefined;

  if (queryKey.at(-1) === "EventStage2EnvelopeMemberList") return "list";
  if (queryKey.at(-1) === "EventStage2EnvelopeUpcoming") return "upcoming";
  return undefined;
}

export function stage2EventProjection(query: Query, scope: string | null) {
  const kind = projectionKind(query, scope);
  const { state } = query;
  if (kind === "list") {
    const read = state.data as CacheRead<DTO["EventStage2EnvelopeMemberList"]> | undefined;
    if (read) return { kind: "list" as const, read, rows: read.data.data.items };
  }
  if (kind === "upcoming") {
    const read = state.data as CacheRead<DTO["EventStage2EnvelopeUpcoming"]> | undefined;
    if (read?.data.data)
      return { kind: "upcoming" as const, read, rows: [read.data.data] as const };
  }
  return undefined;
}

/** A pre-write read is active but has no rows to match until its first response. */
export function isColdStage2EventProjection(query: Query, scope: string | null) {
  return (
    query.state.data === undefined &&
    query.state.fetchStatus === "fetching" &&
    query.isActive() &&
    projectionKind(query, scope) !== undefined
  );
}

/** An old in-flight read must not become the authority after a replay, conflict or detail write. */
export async function refreshStage2EventResponse(
  client: QueryClient,
  scope: string | null,
  id: string,
) {
  const targets = new Set(
    client.getQueryCache().findAll({
      predicate: (query) =>
        isColdStage2EventProjection(query, scope) ||
        stage2EventProjection(query, scope)?.rows.some(({ event }) => event.id === id) === true,
    }),
  );
  const predicate = (query: Query) => targets.has(query);
  await client.cancelQueries({ predicate });
  await client.invalidateQueries({ predicate }, { cancelRefetch: false });
}

type Lifecycle = Pick<ProjectionEvent, "id" | "version" | "status" | "startsAt">;

export function eventLifecycleChanged(before: Lifecycle | null, after: Lifecycle | null) {
  return (
    before?.id !== after?.id ||
    before?.version !== after?.version ||
    before?.status !== after?.status ||
    before?.startsAt !== after?.startsAt
  );
}

export function refreshStage2ListsAtLifecycleChange(
  client: QueryClient,
  scope: string,
  before: Lifecycle | null,
  after: Lifecycle | null,
) {
  return client.invalidateQueries({
    type: "active",
    predicate: (query) => {
      const projection = stage2EventProjection(query, scope);
      return (
        projection?.kind === "list" &&
        projection.rows.some(
          ({ event }) =>
            (event.id === before?.id && before.id !== after?.id) ||
            (event.id === after?.id && eventLifecycleChanged(event, after)),
        )
      );
    },
  });
}
