import { useQuery } from "@tanstack/react-query";
import type { Readiness } from "@vtc/contracts";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button, Card } from "../shared/ui/primitives.js";

async function fetchReadiness({ signal }: { signal: AbortSignal }): Promise<Readiness> {
  const response = await fetch("/health/ready", { cache: "no-store", signal });
  if (response.status !== 200 && response.status !== 503) throw new Error("READINESS_UNAVAILABLE");
  const data: unknown = await response.json();
  if (
    !data ||
    typeof data !== "object" ||
    !("status" in data) ||
    Object.keys(data).length !== 1 ||
    (data.status !== "ready" && data.status !== "not_ready") ||
    (response.status === 200) !== (data.status === "ready")
  )
    throw new Error("INVALID_READINESS");
  return { status: data.status };
}

export function ReadinessPage() {
  const { t } = useTranslation("core");
  const readiness = useQuery({ queryKey: ["readiness"], queryFn: fetchReadiness });
  const message = readiness.isPending
    ? "checking"
    : readiness.isError
      ? "failed"
      : readiness.data.status === "ready"
        ? "ready"
        : "unavailable";
  return (
    <Card className="readiness-card">
      <p className="eyebrow">{t("stage")}</p>
      <h1>{t("heading")}</h1>
      <p className="lead">{t("description")}</p>
      <div className="readiness-status" aria-live="polite">
        <p>{t(message)}</p>
        <Button
          variant="outline"
          disabled={readiness.isFetching}
          onClick={() => void readiness.refetch()}
        >
          {t("retry")}
        </Button>
      </div>
      <Button asChild>
        <Link to="/foundation">{t("public")}</Link>
      </Button>
    </Card>
  );
}
