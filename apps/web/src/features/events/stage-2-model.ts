export const eventStage2QueryPrefix = "events-stage-2";
export const landingConvoysQueryName = "landing-convoys";

export function isEventStage2CommandRead(key: readonly unknown[], scope: string | null) {
  // Landing uses the legacy namespace so older event commands still refresh it.
  return (
    (key[0] === eventStage2QueryPrefix && (key[1] === scope || key[1] === "public")) ||
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
