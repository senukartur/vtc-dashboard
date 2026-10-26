import { isCancelledError, type QueryClient } from "@tanstack/react-query";
import { affectedRead, type Change } from "./changes.js";

export async function fenceQualificationReads(
  client: QueryClient,
  scope: readonly unknown[],
  change: Change,
  selfId: string | undefined,
  conflict: boolean,
) {
  const filters = {
    queryKey: scope,
    predicate: (query: { queryKey: readonly unknown[] }) =>
      affectedRead(change, String(query.queryKey.at(-2) ?? ""), selfId, conflict),
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
              wasSuccess: query.state.status === "success",
              outcome: promise.catch((error: unknown) => error),
            },
          ]
        : [];
    });
  // Reverting would restore fetch-start data and can discard a newer validated cache write.
  await client.cancelQueries(filters, { revert: false });
  for (const { query, wasSuccess, outcome } of pending) {
    const ownCancellation = await outcome;
    if (
      wasSuccess &&
      isCancelledError(ownCancellation) &&
      query.state.error === ownCancellation &&
      query.state.fetchStatus === "idle" &&
      client.getQueryCache().get(query.queryHash) === query
    ) {
      // Only our cancellation of a cached success is presentation-neutral. Preserve CURRENT
      // data/timestamps; never restore an old error or cross a newer fetch/success/error/removal.
      query.setState({ status: "success", error: null });
    }
  }
}
