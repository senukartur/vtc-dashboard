import {
  type DefaultError,
  type DefaultedQueryObserverOptions,
  QueryClient,
  type QueryKey,
  type QueryObserverOptions,
} from "@tanstack/react-query";
import { rateLimitSeconds } from "../shared/rate-limit.js";

/**
 * Every read that fails with HTTP 429 and a known 1-60 s Retry-After waits that long and
 * retries once, even when the query itself disables retries. The query stays pending
 * meanwhile. Other failures keep the query's own retry policy. `meta.rateLimitRetry: false`
 * opts out for readers that schedule their own wait, such as the notifications feed.
 * Mutations are never retried here.
 */
export class AppQueryClient extends QueryClient {
  override defaultQueryOptions<
    TQueryFnData = unknown,
    TError = DefaultError,
    TData = TQueryFnData,
    TQueryData = TQueryFnData,
    TQueryKey extends QueryKey = QueryKey,
    TPageParam = never,
  >(
    options:
      | QueryObserverOptions<TQueryFnData, TError, TData, TQueryData, TQueryKey, TPageParam>
      | DefaultedQueryObserverOptions<TQueryFnData, TError, TData, TQueryData, TQueryKey>,
  ): DefaultedQueryObserverOptions<TQueryFnData, TError, TData, TQueryData, TQueryKey> {
    const defaulted = super.defaultQueryOptions(options);
    // Already-defaulted options are returned unchanged, so a policy is never wrapped twice.
    // An explicit `retry: undefined` keeps the library's own defaults untouched.
    const { retry, retryDelay } = defaulted;
    if (options._defaulted || retry === undefined || defaulted.meta?.rateLimitRetry === false)
      return defaulted;
    defaulted.retry = (failures, error) =>
      rateLimitSeconds(error) !== null
        ? failures < 1
        : typeof retry === "function"
          ? retry(failures, error)
          : typeof retry === "number"
            ? failures < retry
            : retry;
    defaulted.retryDelay = (failures, error) => {
      const seconds = rateLimitSeconds(error);
      if (seconds !== null) return seconds * 1000;
      if (typeof retryDelay === "function") return retryDelay(failures, error);
      // The library's default: doubling from one second, at most thirty seconds.
      return retryDelay ?? Math.min(1000 * 2 ** failures, 30000);
    };
    return defaulted;
  }
}
export const createAppQueryClient = () =>
  new AppQueryClient({ defaultOptions: { queries: { retry: false } } });
export function clearPrivateQueries(client: QueryClient) {
  void client.cancelQueries({ predicate: (query) => query.meta?.private === true });
  client.removeQueries({ predicate: (query) => query.meta?.private === true });
  client.getMutationCache().clear();
}
