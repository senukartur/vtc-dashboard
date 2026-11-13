import type { operations } from "@vtc/contracts";
import type { DTO } from "./transport.js";

type CandidateFilter = operations["listPromotionCandidates"]["parameters"]["query"];
type HistoryFilter = NonNullable<operations["listPromotionHistory"]["parameters"]["query"]>;
export type Candidate = DTO["QualificationStage3PromotionCandidate"];

export function promotionInput(
  candidate: Candidate & { nextLevel: NonNullable<Candidate["nextLevel"]> },
  reason: string,
): DTO["PromotionInput"] {
  return {
    game: candidate.game,
    assignmentId: candidate.assignmentId,
    targetLevelId: candidate.nextLevel.id,
    reason,
  };
}

export const promotionCandidatesPath = "/admin/promotion-candidates";
export const promotionHistoryPath = "/admin/promotion-history";
export const qualificationMembersPath = "/admin/qualification-members";

function listPath(path: string, filters: Record<string, string>, cursor: string | null) {
  const params = new URLSearchParams({ ...filters, limit: "25" });
  if (cursor) params.set("cursor", cursor);
  return `${path}?${params}`;
}

export function promotionCandidatesUrl(
  game: CandidateFilter["game"],
  status: NonNullable<CandidateFilter["status"]>,
  cursor: string | null,
) {
  return listPath(promotionCandidatesPath, { game, status }, cursor);
}

export function promotionHistoryUrl(
  game: NonNullable<HistoryFilter["game"]>,
  memberId: HistoryFilter["memberId"] | null,
  cursor: string | null,
) {
  return listPath(promotionHistoryPath, { game, ...(memberId ? { memberId } : {}) }, cursor);
}

export function promotionMemberSearchUrl(search: string, cursor: string | null) {
  return listPath(qualificationMembersPath, { view: "stage3", search }, cursor);
}
