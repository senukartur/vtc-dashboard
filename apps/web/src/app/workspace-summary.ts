import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useSignOut } from "../features/account/sign-out.js";
import { AccountFailure } from "../features/account/transport.js";
import { type DTO, dashboardRead } from "../features/dashboard/transport.js";
import { useSession } from "./Session.js";

export type WorkspaceSummary = DTO["WorkspaceSummary"];

const summaryKey = ["workspace-summary"] as const;

function workspaceSummaryKey(session: ReturnType<typeof useSession>) {
  return [
    ...summaryKey,
    session.self?.member.id,
    session.generation,
    session.self?.identityEpoch,
    session.self?.capabilities.toSorted().join(","),
  ] as const;
}

export function useWorkspaceSummary({ refreshOnFocus = false } = {}) {
  const client = useQueryClient();
  const session = useSession();
  const signOut = useSignOut();
  const { pathname } = useLocation();
  const enabled =
    /^\/account(?:\/|$)/i.test(pathname) &&
    session.state === "authenticated" &&
    !signOut.active &&
    !!session.self?.capabilities.includes("company.read");
  const query = useQuery({
    queryKey: enabled ? workspaceSummaryKey(session) : ["workspace-summary-disabled"],
    enabled,
    meta: { private: true },
    gcTime: 0,
    staleTime: Infinity,
    retryOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async ({ signal }) => {
      try {
        return (await dashboardRead("/me/workspace-summary", "EnvelopeWorkspaceSummary", signal))
          .data.data;
      } catch (error) {
        if (!signal.aborted && error instanceof AccountFailure) {
          if (error.kind === "unauthorized") void session.confirmSessionLoss(signal);
          if (error.kind === "forbidden") void session.refresh();
        }
        throw error;
      }
    },
  });
  useEffect(() => {
    if (!refreshOnFocus || !enabled) return;
    const refresh = () => {
      if (navigator.onLine && document.visibilityState === "visible")
        void client.refetchQueries(
          { queryKey: summaryKey, type: "active" },
          { cancelRefetch: false },
        );
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [client, enabled, refreshOnFocus]);
  return { ...query, data: enabled && !query.isError ? query.data : undefined };
}

export async function refreshWorkspaceSummary(
  client: QueryClient,
  session?: ReturnType<typeof useSession>,
) {
  const filters = session
    ? { queryKey: workspaceSummaryKey(session), exact: true }
    : { queryKey: summaryKey };
  // An initial read can also predate the commit. Explicit cancellation fences it even when
  // there is no cached data yet. A focus read started after cancellation can be reused.
  await client.cancelQueries(filters);
  await client.invalidateQueries(filters, { cancelRefetch: false });
}
