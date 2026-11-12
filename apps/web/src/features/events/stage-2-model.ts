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
