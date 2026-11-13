import type { components } from "@vtc/contracts";
type Summary = components["schemas"];

export type PromotionWorkspaceSummary = Summary["WorkspaceSummary"] &
  Pick<Summary["WorkspaceStage3Summary"], "promotionsReady">;

export function promotionReadyCount(summary: PromotionWorkspaceSummary | undefined) {
  const counts = summary?.promotionsReady;
  return counts && counts.ets2 + counts.ats;
}
