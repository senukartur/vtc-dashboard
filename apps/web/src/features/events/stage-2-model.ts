export const eventStage2QueryPrefix = "events-stage-2";
export const eventUpcomingQueryPrefix = "dashboard-upcoming-event";
export const landingConvoysQueryName = "landing-convoys";

export type EventStage2CommandReadFilter = (
  key: readonly unknown[],
  outcome: "success" | "conflict",
) => boolean;

export function isEventStage2QueryKey(key: readonly unknown[]) {
  return (
    key[0] === eventStage2QueryPrefix ||
    (key[0] === eventUpcomingQueryPrefix && key[2] === eventStage2QueryPrefix)
  );
}

export function isEventStage2CommandRead(key: readonly unknown[], scope: string | null) {
  // Landing uses the legacy namespace so older event commands still refresh it.
  return (
    (isEventStage2QueryKey(key) && (key[1] === scope || key[1] === "public")) ||
    (key[0] === "public-events" && key[2] === landingConvoysQueryName)
  );
}

export const eventStage2ImageQueryPolicy = {
  gcTime: 0,
  staleTime: 0,
  refetchOnMount: "always",
} as const;

export function visibleEventStage2Image(
  query: {
    data: Blob | undefined;
    isSuccess: boolean;
    fetchStatus: "idle" | "fetching" | "paused";
    isFetchedAfterMount: boolean;
  },
  enabled: boolean,
) {
  return enabled && query.isSuccess && query.fetchStatus === "idle" && query.isFetchedAfterMount
    ? query.data
    : undefined;
}
