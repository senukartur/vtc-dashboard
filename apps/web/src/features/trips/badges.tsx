import {
  Activity,
  Check,
  Circle,
  CircleHelp,
  Clock,
  FileText,
  Flame,
  Globe,
  Package,
  Pencil,
  TriangleAlert,
  Truck,
  UserRound,
  UsersRound,
  X,
  Zap,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "../../shared/ui/primitives.js";
import { type DTO, tripSourceLabels } from "./transport.js";
import type { TripStatus } from "./trip-page-model.js";

const statusLook = {
  accepted: { tone: "ok", icon: Check },
  pending_review: { tone: "info", icon: Clock },
  needs_fix: { tone: "warn", icon: Pencil },
  rejected: { tone: "error", icon: X },
  in_progress: { tone: "neutral", icon: Circle },
  unassessed: { tone: "neutral", icon: CircleHelp },
  cancelled: { tone: "error", icon: X },
} as const;

export function StatusBadge({
  status,
  className,
  label,
}: {
  status: TripStatus;
  className?: string;
  label?: string;
}) {
  const { t } = useTranslation("trips");
  return (
    <Badge {...statusLook[status]} className={className} data-status={status}>
      {label ?? t(`status_${status}`)}
    </Badge>
  );
}

export function OutcomeBadge({ outcome }: { outcome: DTO["TripSummary"]["outcome"] }) {
  const { t } = useTranslation("trips");
  const look =
    outcome === "delivered"
      ? statusLook.accepted
      : outcome === "cancelled"
        ? statusLook.cancelled
        : outcome === "open"
          ? statusLook.in_progress
          : statusLook.unassessed;
  return (
    <Badge {...look} className="trips-outcome" data-outcome={outcome}>
      {t(outcome === "open" ? "status_in_progress" : outcome === "none" ? "noOutcome" : outcome)}
    </Badge>
  );
}

export function RecordingBadge({ recording }: { recording: DTO["TripSummary"]["recording"] }) {
  const { t } = useTranslation("trips");
  return (
    <Badge
      className="trips-recording"
      data-recording={recording ?? "unknown"}
      tone={recording === "complete" ? "ok" : recording === "partial" ? "warn" : "neutral"}
      icon={recording === "complete" ? Check : recording === "partial" ? TriangleAlert : CircleHelp}
    >
      {t(
        recording === "complete"
          ? "complete"
          : recording === "partial"
            ? "partialRecording"
            : "unknownRecording",
      )}
    </Badge>
  );
}

export function GameModeBadge({ mode }: { mode: DTO["TripSummary"]["gameMode"] }) {
  const { t } = useTranslation("trips");
  if (!mode) return null;
  const multiplayer = mode === "truckersmp" || mode === "haulmp";
  return (
    <Badge
      tone={multiplayer ? "ok" : "neutral"}
      icon={multiplayer ? UsersRound : mode === "single-player" ? UserRound : CircleHelp}
      className="trips-mode"
      data-mode={mode}
    >
      {t(mode === "unknown" ? "modeUnknown" : `telemetryMode_${mode}`)}
    </Badge>
  );
}

const jobIcons = {
  "quick-job": Zap,
  "freight-market": Package,
  "cargo-market": Truck,
  "world-of-trucks": Globe,
  unknown: CircleHelp,
} as const;
export function JobTypeBadge({ job }: { job: DTO["TripSummary"]["jobType"] }) {
  const { t } = useTranslation("trips");
  if (!job) return null;
  return (
    <Badge
      tone={job === "world-of-trucks" ? "info" : "neutral"}
      icon={jobIcons[job]}
      className="trips-job"
      data-job={job}
    >
      {t(job === "unknown" ? "jobUnknown" : `telemetryJob_${job}`)}
    </Badge>
  );
}

export function HardModeBadge({
  result,
  compact = false,
}: {
  result: DTO["TripSummary"]["hardModeResult"];
  compact?: boolean;
}) {
  return result === "qualified" ? (
    <Badge tone="ok" icon={Flame} className="trips-hard-mode">
      {compact ? "HM" : "Hard Mode"}
    </Badge>
  ) : null;
}

export function SourceBadge({ source }: { source: DTO["TripSummary"]["sourceKinds"][number] }) {
  const { t } = useTranslation("trips");
  return (
    <Badge icon={source === "manual" ? FileText : Activity}>{t(tripSourceLabels[source])}</Badge>
  );
}
