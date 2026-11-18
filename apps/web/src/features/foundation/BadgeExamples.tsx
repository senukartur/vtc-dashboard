import { useTranslation } from "react-i18next";
import { Badge, Card } from "../../shared/ui/primitives.js";
import {
  GameModeBadge,
  HardModeBadge,
  JobTypeBadge,
  OutcomeBadge,
  RecordingBadge,
  SourceBadge,
  StatusBadge,
} from "../trips/badges.js";

/** Synthetic examples of the shared badge states, using the product components themselves. */
export function BadgeExamples() {
  const { t } = useTranslation("foundation");
  return (
    <Card className="stack foundation-badges" aria-labelledby="badge-examples-title">
      <h2 id="badge-examples-title">{t("badgeExamples")}</h2>
      <div className="heading-actions">
        <Badge tone="ets2">ETS2</Badge>
        <Badge tone="ats">ATS</Badge>
        <HardModeBadge result="qualified" />
        {(
          [
            "accepted",
            "pending_review",
            "needs_fix",
            "rejected",
            "in_progress",
            "unassessed",
            "cancelled",
          ] as const
        ).map((status) => (
          <StatusBadge key={status} status={status} />
        ))}
      </div>
      <div className="heading-actions">
        {(["single-player", "truckersmp", "haulmp", "unknown"] as const).map((mode) => (
          <GameModeBadge key={mode} mode={mode} />
        ))}
        {(
          ["quick-job", "freight-market", "cargo-market", "world-of-trucks", "unknown"] as const
        ).map((job) => (
          <JobTypeBadge key={job} job={job} />
        ))}
      </div>
      <div className="heading-actions">
        {(["open", "delivered", "cancelled", "none"] as const).map((outcome) => (
          <OutcomeBadge key={outcome} outcome={outcome} />
        ))}
        {(["complete", "partial", "unknown"] as const).map((recording) => (
          <RecordingBadge key={recording} recording={recording} />
        ))}
        <SourceBadge source="ets2telemetry" />
        <SourceBadge source="manual" />
      </div>
    </Card>
  );
}
