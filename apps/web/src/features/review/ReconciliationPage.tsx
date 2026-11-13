import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { useWorkspaceSummary } from "../../app/workspace-summary.js";
import { Button, Card } from "../../shared/ui/primitives.js";
import { Codes, Fields, PageNav, State } from "../trips/components.js";
import { useTripQuery } from "../trips/queries.js";
import { type DTO, validId } from "../trips/transport.js";
import { DispatchReviewPage } from "./DispatchReviewPage.js";
import { ReviewAccessState } from "./ReviewAccessState.js";
import { MergePair, ReconciliationHistory } from "./reconciliation-parts.js";
import "../trips/trips.css";

export function ReconciliationPage() {
  const { t } = useTranslation("trips");
  const session = useSession();
  const summary = useWorkspaceSummary();
  if (!session.self?.capabilities.includes("trips.review"))
    return (
      <Card>
        <p>{t("forbidden")}</p>
      </Card>
    );
  if (summary.dispatchMode === "stage3") return <DispatchReviewPage reconciliationAlias />;
  if (summary.dispatchMode === "legacy") return <LegacyReconciliationPage />;
  return <ReviewAccessState summary={summary} />;
}

function LegacyReconciliationPage() {
  const { t } = useTranslation("trips"),
    [params] = useSearchParams(),
    [cursor, setCursor] = useState<string | null>(null),
    [history, setHistory] = useState<string[]>([]),
    [pair, setPair] = useState<DTO["MergeCandidate"] | null>(null),
    [merged, setMerged] = useState<string | null>(null),
    query = useTripQuery(
      `/reconciliation-candidates?limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      "EnvelopeListMergeCandidate",
    ),
    historyTrip = params.get("trip");
  return (
    <div className="stack trip-page">
      <h1>{t("reconciliation")}</h1>
      <p>{t("mergeHelp")}</p>
      <Card className="stack">
        <State
          query={query}
          refresh={() => {
            setCursor(null);
            setHistory([]);
            if (!cursor) void query.refetch();
          }}
        />
        {query.data && !query.data.data.data.items.length && <p>{t("empty")}</p>}
        {query.data?.data.data.items.map((candidate) => (
          <article className="trip-revision" key={candidate.id}>
            <Fields
              values={{ primary: candidate.primaryTripId, secondary: candidate.secondaryTripId }}
            />
            <Codes values={candidate.reasonCodes} />
            <Button variant="outline" onClick={() => setPair(candidate)}>
              {t("selectPair")}
            </Button>
          </article>
        ))}
        <PageNav
          next={query.data?.data.data.nextCursor}
          hasPrevious={history.length > 0}
          onNext={(c) => {
            setHistory([...history, cursor ?? ""]);
            setCursor(c);
          }}
          onPrevious={() => {
            setCursor(history.at(-1) || null);
            setHistory(history.slice(0, -1));
          }}
        />
      </Card>
      {pair && (
        <MergePair
          key={pair.id}
          pair={pair}
          onMerged={(id) => {
            setMerged(id);
            setPair(null);
          }}
        />
      )}
      {merged && (
        <Card>
          <p role="status">{t("success")}</p>
          <Button asChild>
            <Link to={`/account/trips/${merged}`}>{t("history")}</Link>
          </Button>
        </Card>
      )}
      {validId(historyTrip ?? undefined) && (
        <ReconciliationHistory tripId={historyTrip as string} />
      )}
    </div>
  );
}
