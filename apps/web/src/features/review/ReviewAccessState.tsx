import { useTranslation } from "react-i18next";
import type { useWorkspaceSummary } from "../../app/workspace-summary.js";
import { Card } from "../../shared/ui/primitives.js";
import { State } from "../trips/components.js";

export function ReviewAccessState({
  summary,
}: {
  summary: ReturnType<typeof useWorkspaceSummary>;
}) {
  const { t } = useTranslation("trips");
  return (
    <Card className="stack review-queue-header">
      <h1>{t("review")}</h1>
      {summary.isPending ? (
        <p role="status">{t("loading")}</p>
      ) : summary.isError ? (
        <State query={summary} />
      ) : (
        <p>{t("queueTotalsUnavailable")}</p>
      )}
    </Card>
  );
}
