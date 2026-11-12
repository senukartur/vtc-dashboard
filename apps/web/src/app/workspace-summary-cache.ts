import type { QueryClient } from "@tanstack/react-query";
import type { components } from "@vtc/contracts";

type WorkspaceSummarySession = {
  self: Pick<components["schemas"]["Self"], "member" | "identityEpoch" | "capabilities"> | null;
  generation: number;
};

export const workspaceSummaryPrefix = ["workspace-summary"] as const;

function workspaceSummarySessionKey(session: WorkspaceSummarySession) {
  return [...workspaceSummaryPrefix, session.self?.member.id, session.generation] as const;
}

export function workspaceSummaryKey(session: WorkspaceSummarySession) {
  return [
    ...workspaceSummarySessionKey(session),
    session.self?.identityEpoch,
    session.self?.capabilities.toSorted().join(","),
  ] as const;
}

export async function refreshWorkspaceSummary(
  client: QueryClient,
  session?: WorkspaceSummarySession,
) {
  // The same member can gain authority while a command is pending. Refresh any snapshot
  // in that session generation, including one fetched under the new authority.
  const filters = {
    queryKey: session ? workspaceSummarySessionKey(session) : workspaceSummaryPrefix,
  };
  // An initial read can also predate the commit. Explicit cancellation fences it even when
  // there is no cached data yet. A focus read started after cancellation can be reused.
  await client.cancelQueries(filters);
  await client.invalidateQueries(filters, { cancelRefetch: false });
}
