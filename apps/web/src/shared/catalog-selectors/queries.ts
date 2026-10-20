import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { z } from "zod";
import { useSession } from "../../app/Session.js";
import { AccountFailure, read } from "../../features/account/transport.js";
import { catalogParams, envelope, type Game, revisionsSchema } from "./contracts.js";

export function useCatalogAccess() {
  const session = useSession();
  return {
    scope: [session.self?.member.id, session.generation, session.self?.identityEpoch],
    read: async <T extends z.ZodType>(path: string, schema: T, signal: AbortSignal) => {
      try {
        return await read(path, envelope(schema), signal);
      } catch (error) {
        if (error instanceof AccountFailure && error.kind === "unauthorized" && !signal.aborted)
          await session.confirmSessionLoss(signal);
        if (error instanceof AccountFailure && error.kind === "forbidden" && !signal.aborted)
          await session.refresh();
        throw error;
      }
    },
  };
}
export function useCatalogQuery<T extends z.ZodType>(
  key: readonly unknown[],
  path: string,
  schema: T,
  enabled = true,
  poll = false,
) {
  const access = useCatalogAccess();
  const query = useQuery({
    queryKey: ["catalogs", ...access.scope, ...key],
    meta: { private: true },
    enabled,
    retry: false,
    gcTime: 0,
    staleTime: poll ? 0 : 10000,
    refetchOnWindowFocus: poll,
    refetchOnReconnect: poll,
    queryFn: ({ signal }) => access.read(path, schema, signal),
    refetchInterval: (query) =>
      poll &&
      document.visibilityState === "visible" &&
      navigator.onLine &&
      !(
        query.state.error instanceof AccountFailure &&
        ["forbidden", "unauthorized"].includes(query.state.error.kind)
      ) &&
      (query.state.data?.data.data as { state?: string } | undefined)?.state === "processing"
        ? 1500
        : false,
    refetchIntervalInBackground: false,
  });
  return { ...query, data: query.isError ? undefined : query.data };
}
export function useCatalogPages<
  T extends z.ZodType<{ items: unknown[]; nextCursor: string | null }>,
>(
  key: readonly unknown[],
  path: string,
  params: Record<string, string | number | undefined>,
  schema: T,
  enabled = true,
) {
  const access = useCatalogAccess();
  const query = useInfiniteQuery({
    queryKey: ["catalogs", ...access.scope, ...key, params],
    meta: { private: true },
    enabled,
    retry: false,
    gcTime: 0,
    staleTime: 10000,
    refetchOnWindowFocus: key[0] === "published",
    refetchOnReconnect: key[0] === "published",
    initialPageParam: null as string | null,
    queryFn: ({ signal, pageParam }) =>
      access.read(
        `${path}?${catalogParams({ ...params, limit: 25, cursor: pageParam })}`,
        schema,
        signal,
      ),
    getNextPageParam: (last) => last.data.data.nextCursor ?? undefined,
  });
  return { ...query, data: query.isError ? undefined : query.data };
}
export function usePublishedRevisions(game: Game) {
  return useCatalogPages(["published", game], "/catalogs/revisions", { game }, revisionsSchema);
}
