import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { Button, Card, Label } from "../../shared/ui/primitives.js";
import { EventSelect, EvidenceItem } from "../manual-reports/fields.js";
import { ReconciliationHistory } from "../review/ReconciliationPage.js";
import { ProposalList, ReviewPanel } from "../review/ReviewPanel.js";
import {
  Codes,
  Confirm,
  EffectiveFacts,
  Failure,
  Fields,
  PageNav,
  Revision,
  State,
  TripSummary,
} from "./components.js";
import { HistoricalRules } from "./HistoricalRules.js";
import { useTripCommand, useTripQuery } from "./queries.js";
import { validId } from "./transport.js";
import "./trips.css";
export function TripDetailPage({ review = false }: { review?: boolean }) {
  const { t } = useTranslation("trips"),
    session = useSession(),
    { tripId } = useParams(),
    query = useTripQuery(
      `/trips/${tripId}`,
      "EnvelopeTripView",
      validId(tripId) && (!review || !!session.self?.capabilities.includes("trips.review")),
    ),
    [history, setHistory] = useState(false),
    [reason, setReason] = useState(""),
    command = useTripCommand();
  const view = query.data?.data.data,
    summary = view?.view === "private" ? view.summary : view,
    staff = !!session.self?.capabilities.includes("trips.review");
  if (review && !staff)
    return (
      <Card>
        <p>{t("forbidden")}</p>
      </Card>
    );
  if (!validId(tripId))
    return (
      <Card>
        <p>{t("notFound")}</p>
      </Card>
    );
  return (
    <div className="stack trip-page">
      <header className="trip-heading">
        <h1>{t(review ? "review" : "title")}</h1>
        {!query.isError && (
          <Button
            variant="outline"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            {t("refresh")}
          </Button>
        )}
        <Button asChild variant="outline">
          <Link to="/account/trips">{t("back")}</Link>
        </Button>
      </header>
      <State query={query} />
      {summary && (
        <>
          <Card>
            <TripSummary trip={summary} link={false} />
            <small className="trip-wrap">{summary.id}</small>
            <p>{t(view?.view === "private" ? "privateView" : "summaryView")}</p>
          </Card>
          {view?.view === "private" && (
            <>
              <EffectiveFacts facts={view.effectiveFacts} />
              <Codes values={view.reviewReasonCodes} />
              {view.manualRevision && (
                <Card className="stack">
                  <Revision revision={view.manualRevision} />
                  {summary.owner.id === session.self?.member.id &&
                    summary.decision !== "accepted" &&
                    "reportId" in view.manualRevision && (
                      <Button asChild>
                        <Link to={`/account/reports/${view.manualRevision.reportId}/edit`}>
                          {t("revise")}
                        </Link>
                      </Button>
                    )}
                </Card>
              )}
              <Card className="stack">
                <h2>{t("evidence")}</h2>
                {view.evidence.map((e) => (
                  <EvidenceItem key={e.id} id={e.id} metadata={e} />
                ))}
                <p>{t("retention")}</p>
              </Card>
              <Card className="stack">
                <h2>{t("decisions")}</h2>
                {!view.decisions.length && <p>{t("empty")}</p>}
                {view.decisions.map((d) => (
                  <article key={d.id} className="trip-revision">
                    <h3>{t(d.outcome)}</h3>
                    <p>{d.reason}</p>
                    <Fields
                      values={{
                        reviewedRevisionId: d.reviewedRevisionId,
                        submittedAt: d.decidedAt,
                        ...d.basis,
                      }}
                    />
                    <Codes values={d.reasonCodes} />
                    <HistoricalRules basis={d.basis} />
                  </article>
                ))}
                <p>{t("historyBound")}</p>
              </Card>
              {summary.owner.id === session.self?.member.id &&
                summary.decision === "accepted" &&
                session.self.capabilities.includes("trips.submit_own") && (
                  <Card className="stack">
                    <h2>{t("correction")}</h2>
                    <p>{t("correctionHelp")}</p>
                    <Label htmlFor="correction-reason">{t("reason")}</Label>
                    <textarea
                      className="input"
                      id="correction-reason"
                      maxLength={4000}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                    <Failure error={command.failure} seconds={command.seconds} />
                    <Confirm
                      label={t("correction")}
                      guard={JSON.stringify([query.data?.etag, reason])}
                      disabled={!reason.trim() || command.seconds > 0}
                      pending={command.pending}
                      failure={command.failure}
                      onConfirm={async () => {
                        const r = await command.run(
                          `/trips/${summary.id}/correction-requests`,
                          { reason: reason.trim() },
                          "EnvelopeCommandResult",
                          query.data?.etag,
                        );
                        if (r) setReason("");
                        return r;
                      }}
                    >
                      <p>{reason}</p>
                      <Fields
                        values={{
                          version: summary.version,
                          reviewedRevisionId: view.manualRevision?.id ?? null,
                        }}
                      />
                    </Confirm>
                  </Card>
                )}
              {summary.owner.id === session.self?.member.id &&
                session.self.capabilities.includes("trips.submit_own") && (
                  <OwnerAssociation
                    tripId={summary.id}
                    game={summary.game}
                    etag={query.data?.etag ?? null}
                  />
                )}
              <Card>
                <details open={history} onToggle={(e) => setHistory(e.currentTarget.open)}>
                  <summary>{t("privateView")}</summary>
                  {history && <PrivateHistory tripId={summary.id} />}
                </details>
              </Card>
              {staff &&
                (review ? (
                  <ReviewPanel tripId={summary.id} />
                ) : (
                  <Button asChild>
                    <Link to={`/account/review/${summary.id}`}>{t("review")}</Link>
                  </Button>
                ))}
              {staff && <ReconciliationHistory tripId={summary.id} />}
            </>
          )}
        </>
      )}
    </div>
  );
}
function PrivateHistory({ tripId }: { tripId: string }) {
  const { t } = useTranslation("trips"),
    [tab, setTab] = useState("revisions"),
    [cursor, setCursor] = useState<string | null>(null),
    [cursors, setCursors] = useState<string[]>([]);
  const suffix = `?limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
  const revisions = useTripQuery(
      `/trips/${tripId}/manual-revisions${suffix}`,
      "EnvelopeListManualRevision",
      tab === "revisions",
    ),
    reports = useTripQuery(
      `/trips/${tripId}/manual-reports${suffix}`,
      "EnvelopeListManualReport",
      tab === "report",
    ),
    corrections = useTripQuery(
      `/trips/${tripId}/correction-requests${suffix}`,
      "EnvelopeListManualCorrectionRequest",
      tab === "corrections",
    );
  const query = tab === "revisions" ? revisions : tab === "report" ? reports : corrections,
    next = query.data?.data.data.nextCursor;
  return (
    <div className="stack">
      <div className="trip-actions">
        {["revisions", "report", "corrections", "proposals"].map((name) => (
          <Button
            type="button"
            key={name}
            variant={tab === name ? "default" : "outline"}
            onClick={() => {
              setTab(name);
              setCursor(null);
              setCursors([]);
            }}
          >
            {t(name)}
          </Button>
        ))}
      </div>
      {tab === "proposals" ? (
        <ProposalList tripId={tripId} etag={null} self />
      ) : (
        <State query={query} />
      )}
      {tab === "revisions" &&
        revisions.data?.data.data.items.map((r, i, items) => (
          <Revision key={r.id} revision={r} {...(items[i + 1] ? { previous: items[i + 1] } : {})} />
        ))}
      {tab === "report" &&
        reports.data?.data.data.items.map((r) => (
          <article key={r.id} className="trip-revision">
            <Fields
              values={{
                report: r.id,
                version: r.version,
                reviewedRevisionId: r.currentRevision.id,
              }}
            />
            <Button asChild variant="outline">
              <Link to={`/account/reports/${r.id}/edit`}>{t("viewReport")}</Link>
            </Button>
          </article>
        ))}
      {tab === "corrections" &&
        corrections.data?.data.data.items.map((r) => (
          <article key={r.id} className="trip-revision">
            <h3>{t(r.status)}</h3>
            <Fields
              values={{
                requestLink: r.id,
                baseTripVersion: r.baseTripVersion,
                reviewedRevisionId: r.baseRevisionId,
              }}
            />
            <p>{r.reason}</p>
            {r.history.map((h) => (
              <p key={`${h.recordedAt}-${h.status}`}>
                {t(h.status)} · {h.recordedAt} · {h.reason}
              </p>
            ))}
          </article>
        ))}
      {query.data && !query.data.data.data.items.length && <p>{t("empty")}</p>}
      <PageNav
        next={next}
        hasPrevious={cursors.length > 0}
        onNext={(c) => {
          setCursors([...cursors, cursor ?? ""]);
          setCursor(c);
        }}
        onPrevious={() => {
          setCursor(cursors.at(-1) || null);
          setCursors(cursors.slice(0, -1));
        }}
      />
    </div>
  );
}

function OwnerAssociation({
  tripId,
  game,
  etag,
}: {
  tripId: string;
  game: "ets2" | "ats";
  etag: string | null;
}) {
  const { t } = useTranslation("trips"),
    [event, setEvent] = useState<string | null>(null),
    [success, setSuccess] = useState(false),
    command = useTripCommand();
  return (
    <Card className="stack">
      <h2>{t("association")}</h2>
      <p>{t("associationHelp")}</p>
      <EventSelect value={event} onChange={setEvent} game={game} />
      <Failure error={command.failure} seconds={command.seconds} />
      {success && (
        <p role="status">
          {t("success")} {t("frozen")}
        </p>
      )}
      <Confirm
        label={t("association")}
        guard={JSON.stringify([event, etag])}
        disabled={!event || command.seconds > 0}
        pending={command.pending}
        failure={command.failure}
        onConfirm={async () => {
          const r = await command.run(
            `/trips/${tripId}/event-association`,
            { eventId: event },
            "EnvelopeCommandResult",
            etag,
          );
          if (r) setSuccess(true);
          return r;
        }}
      >
        <Fields values={{ eventId: event, version: etag }} />
      </Confirm>
    </Card>
  );
}
