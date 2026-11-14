import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useSignOut } from "../features/account/sign-out.js";
import { AccountFailure } from "../features/account/transport.js";
import {
  DashboardFailure,
  DashboardPayloadFailure,
  type DTO,
  dashboardRead,
} from "../features/dashboard/transport.js";
import { useSession } from "./Session.js";
import { workspaceSummaryKey, workspaceSummaryPrefix } from "./workspace-summary-cache.js";

export { refreshWorkspaceSummary } from "./workspace-summary-cache.js";

export type WorkspaceSummary = DTO["WorkspaceSummary"] & {
  dispatch?: "stage3" | "legacy";
  promotionsReady?: DTO["WorkspaceStage3Summary"]["promotionsReady"];
};

export function workspaceSummary(data: DTO["WorkspaceStage3Summary"]): WorkspaceSummary {
  const { reviewQueue: staged, legacyReviewQueue: legacy, ...sections } = data;
  if (staged && legacy) throw new DashboardPayloadFailure();
  if (staged)
    return {
      ...sections,
      dispatch: "stage3",
      reviewQueue: { count: staged.waitingCount, oldestAgeSeconds: staged.oldestAgeSeconds },
    };
  if (legacy) return { ...sections, dispatch: "legacy", reviewQueue: legacy };
  return sections;
}

function recoverableRefresh(error: unknown) {
  return (
    error instanceof DashboardFailure &&
    !(error instanceof DashboardPayloadFailure) &&
    (error.status === 0 || error.status === 503)
  );
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
    queryFn: async ({ signal, queryKey }): Promise<WorkspaceSummary | null> => {
      try {
        const result = await dashboardRead(
          "/me/workspace-summary?view=stage3",
          "WorkspaceStage3SummaryEnvelope",
          signal,
        );
        return workspaceSummary(result.data.data);
      } catch (error) {
        if (!signal.aborted && error instanceof AccountFailure) {
          // An invalid or denied snapshot clears the last successful selection for this key.
          // A later transient failure must never revive a selection the server invalidated.
          if (!recoverableRefresh(error)) client.setQueryData(queryKey, null);
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
          { queryKey: workspaceSummaryPrefix, type: "active" },
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
  const dispatchMode =
    enabled &&
    session.self?.capabilities.includes("trips.review") &&
    (!query.isError || recoverableRefresh(query.error))
      ? query.data?.dispatch
      : undefined;
  return {
    ...query,
    data: enabled && !query.isError ? (query.data ?? undefined) : undefined,
    dispatchMode,
  };
}
