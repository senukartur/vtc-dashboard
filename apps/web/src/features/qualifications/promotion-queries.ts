import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "../../app/Session.js";
import { refreshWorkspaceSummary } from "../../app/workspace-summary-cache.js";
import {
  affectedPromotionRead,
  type Candidate,
  promotionCandidatesUrl,
  promotionHistoryUrl,
  promotionMemberSearchUrl,
  qualificationMembersPath,
} from "./promotion-transport.js";
import { useQualificationQuery } from "./queries.js";

export function usePromotionCandidates(
  game: Candidate["game"],
  status: Parameters<typeof promotionCandidatesUrl>[1],
  cursor: string | null,
  enabled: boolean,
) {
  return useQualificationQuery(
    promotionCandidatesUrl(game, status, cursor),
    "QualificationStage3PromotionCandidateListEnvelope",
    enabled,
  );
}

export function usePromotionHistory(
  game: Candidate["game"],
  memberId: string | null,
  cursor: string | null,
  enabled: boolean,
) {
  return useQualificationQuery(
    promotionHistoryUrl(game, memberId, cursor),
    "QualificationStage3PromotionHistoryListEnvelope",
    enabled,
  );
}

export function usePromotionMemberSearch(search: string, cursor: string | null) {
  return useQualificationQuery(
    promotionMemberSearchUrl(search, cursor),
    "QualificationStage3MemberSearchListEnvelope",
  );
}

export function useRefreshPromotionReads() {
  const client = useQueryClient();
  const session = useSession();
  return async ({ game, member }: Candidate, { committed }: { committed: boolean }) => {
    const selfId = session.self?.member.id;
    const filters = {
      predicate: ({ queryKey: key }: { queryKey: readonly unknown[] }) => {
        if (key[0] === "qualification-workspace") {
          if (key[1] !== selfId || key[2] !== session.generation || typeof key[5] !== "string")
            return false;
          const url = new URL(key[5], "https://qualification.invalid");
          return (
            affectedPromotionRead(url, game, { history: true, memberId: member.id }) ||
            (url.pathname === qualificationMembersPath && url.searchParams.get("view") === "stage3")
          );
        }
        if (key[0] === "dashboard-my-progress")
          return (
            member.id === selfId &&
            key[1] === game &&
            key[2] === selfId &&
            key[3] === session.generation
          );
        if (key[0] === "driver-profile" || key[0] === "driver-progress")
          return (
            key[1] === member.id &&
            key[2] === selfId &&
            key[3] === session.generation &&
            (key[0] === "driver-profile" || String(key.at(-1)).endsWith(`?game=${game}`))
          );
        if (key[0] === "drivers-list") return key[1] === selfId && key[2] === session.generation;
        return false;
      },
    };
    // Cancel fetch-start snapshots before starting any fresh reads. Cursor pages are stale after
    // the write. The workspace resets to its first page, so only reload unpaged reads immediately.
    const refreshReads = async () => {
      await client.cancelQueries(filters);
      await client.invalidateQueries({ ...filters, refetchType: "none" });
      await client.refetchQueries(
        {
          type: "active",
          predicate: (query) =>
            filters.predicate(query) && !String(query.queryKey.at(-2) ?? "").includes("&cursor="),
        },
        { cancelRefetch: false },
      );
    };
    await Promise.all([
      refreshReads(),
      committed ? refreshWorkspaceSummary(client, session) : undefined,
    ]);
  };
}
