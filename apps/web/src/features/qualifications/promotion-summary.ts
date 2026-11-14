import type { components } from "@vtc/contracts";

export function promotionReadyCount(
  counts: components["schemas"]["WorkspaceStage3Summary"]["promotionsReady"],
) {
  return counts && counts.ets2 + counts.ats;
}
