import { isCancelledError, type QueryClient } from "@tanstack/react-query";

export async function fenceQualificationReads(
  client: QueryClient,
  scope: readonly unknown[],
  affected: (path: string) => boolean,
) {
  const filters = {
    queryKey: scope,
    predicate: (query: { queryKey: readonly unknown[] }) =>
      affected(String(query.queryKey.at(-2) ?? "")),
  };
  const pending = client
    .getQueryCache()
    .findAll(filters)
    .flatMap((query) => {
      const promise = query.promise;
      return promise && query.state.fetchStatus !== "idle"
        ? [
            {
              query,
              originalPromise: promise,
              wasSuccess: query.state.status === "success",
              outcome: promise.catch((error: unknown) => error),
            },
          ]
        : [];
    });
  // Reverting would restore fetch-start data and can discard a newer validated cache write.
  await client.cancelQueries(filters, { revert: false });
  for (const { query, originalPromise, wasSuccess, outcome } of pending) {
    const ownCancellation = await outcome;
    if (
      wasSuccess &&
      isCancelledError(ownCancellation) &&
      query.state.error === ownCancellation &&
      query.state.fetchStatus === "idle" &&
      (!query.promise || query.promise === originalPromise) &&
      client.getQueryCache().get(query.queryHash) === query
    ) {
      // Only our cancellation of a cached success is presentation-neutral. Preserve CURRENT
      // data/timestamps; never restore an old error or cross a newer fetch/success/error/removal.
      query.setState({ status: "success", error: null });
    }
  }
}
