import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useParams } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { useWorkspaceSummary } from "../../app/workspace-summary.js";
import { queryString, useCursorPages } from "../../shared/paging.js";
import { Pager } from "../../shared/ui/pager.js";
import { Button, Card } from "../../shared/ui/primitives.js";
import { EventSelect } from "../manual-reports/fields.js";
import { DecisionPanel } from "../review/DecisionPanel.js";
import { dispatchSearch } from "../review/dispatch-model.js";
import { ReviewAccessState } from "../review/ReviewAccessState.js";
import { ProposalList } from "../review/ReviewPanel.js";
import { ReconciliationHistory } from "../review/reconciliation-parts.js";
import { queueSearch } from "../review/review-model.js";
import { Confirm, Failure, Fields, Revision, State } from "./components.js";
import {
  type CorrectionField,
  correctableFacts,
  proposedChanges,
  unconfirmedFields,
} from "./correction-model.js";
import { useTripCommand, useTripQuery } from "./queries.js";
import { TripHeader, TripHistory, TripTiles } from "./TripPageOverview.js";
import {
  TripEvidence,
  TripFacts,
  TripQualificationCheck,
  TripSources,
} from "./TripPageSections.js";
import { TripTechnicalDetails } from "./TripTechnicalDetails.js";
import { type DTO, validId } from "./transport.js";
import {
  awaitingFix,
  canCorrect,
  latestDecision,
  nextStep,
  privateOf,
  revisableReportId,
  type TripStatus,
  tripStatus,
} from "./trip-page-model.js";
import "./trips.css";
/**
 * Trip page (VTC-158): header with status and actions, summary tiles, the trip facts, screenshots
 * and sources beside the history and qualification check. Staff also get collapsed technical
 * details, the private report history and reconciliation history. Hiding is presentation only:
 * the server filters every private field.
 */
export function TripDetailPage({ review = false }: { review?: boolean }) {
  const { t } = useTranslation("trips"),
    session = useSession(),
    { tripId } = useParams(),
    query = useTripQuery(
      `/trips/${tripId}`,
      "EnvelopeTripView",
      // The review page reads the trip through its review read instead.
      validId(tripId) && !review,
    ),
    [history, setHistory] = useState(false);
  const view = query.data?.data.data,
    own = privateOf(view),
    summary = view?.view === "private" ? view.summary : view,
    selfId = session.self?.member.id,
    staff = !!session.self?.capabilities.includes("trips.review"),
    owner = !!summary && summary.owner.id === selfId,
    submitOwn = owner && !!session.self?.capabilities.includes("trips.submit_own"),
    // Actions stay owner-gated; status, credit and the next step read the trip data alike for all.
    reportId = revisableReportId(view, selfId),
    fixPending = awaitingFix(view),
    status = summary ? tripStatus(summary, fixPending) : null,
    next = nextStep(view, { owner, staff }),
    correctable = canCorrect(view, selfId),
    // The driver's corrections feed the history; the pending one marks its values inline.
    proposals = useTripQuery(
      `/trips/${tripId}/proposals?limit=25`,
      "EnvelopeListTripProposal",
      validId(tripId) && !review && !!own && (owner || staff),
    ),
    proposalItems = proposals.data?.data.data.items ?? [],
    pending = proposalItems.find((p) => p.id === own?.pendingProposalId) ?? null,
    marks = own
      ? { unconfirmed: unconfirmedFields(own), proposed: proposedChanges(pending) }
      : undefined,
    correctPath = summary ? `/account/trips/${summary.id}/correct` : null;
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
  if (review) return <ReviewDetail tripId={tripId} />;
  const actions = (
    <>
      {reportId && status === "needs_fix" && (
        <Button asChild>
          <Link to={`/account/reports/${reportId}/edit`}>{t("fixReport")}</Link>
        </Button>
      )}
      {reportId && status !== "needs_fix" && (
        <Button asChild variant="outline">
          <Link to={`/account/reports/${reportId}/edit`}>{t("revise")}</Link>
        </Button>
      )}
      {correctable && !reportId && correctPath && status !== "needs_fix" && (
        <Button asChild variant="outline">
          <Link to={correctPath}>{t(status === "accepted" ? "proposeCorrection" : "fixTrip")}</Link>
        </Button>
      )}
      {staff && summary && (
        <Button asChild variant="outline">
          <Link to={`/account/review/${summary.id}`}>{t("review")}</Link>
        </Button>
      )}
      {!query.isError && (
        <Button variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}>
          {t("refresh")}
        </Button>
      )}
    </>
  );
  return (
    <div className="stack trip-page trip-detail">
      <TripHeader summary={summary} view={own} status={status} owner={owner} actions={actions} />
      <State query={query} rateLimitNotice />
      {summary && (
        <>
          {!own && <p className="trip-muted">{t("summaryView")}</p>}
          {own && status && (owner || staff) && (
            <TripCorrectionBanner
              view={own}
              status={status}
              owner={owner}
              pending={!!own.pendingProposalId}
              correctPath={correctable && !reportId ? correctPath : null}
              reportPath={reportId ? `/account/reports/${reportId}/edit` : null}
            />
          )}
          <TripTiles
            summary={summary}
            facts={own?.effectiveFacts}
            next={next}
            fixPending={fixPending}
          />
          <div className="trip-detail-layout">
            <div className="trip-detail-main">
              <TripFacts summary={summary} view={own} {...(marks ? { marks } : {})} />
              {own && (own.evidence.length > 0 || own.manualRevision) && (
                <TripEvidence evidence={own.evidence} />
              )}
              {own && <TripSources sources={own.sources} />}
              {own && submitOwn && (
                <OwnerAssociation
                  tripId={summary.id}
                  game={summary.game}
                  etag={query.data?.etag ?? null}
                />
              )}
            </div>
            {own && (
              <aside className="trip-detail-aside" aria-label={t("asideLabel")}>
                <TripHistory view={own} proposals={proposalItems} />
                <TripQualificationCheck check={own.qualificationCheck} />
              </aside>
            )}
          </div>
          {own && staff && (
            <>
              <TripTechnicalDetails view={own} />
              <Card>
                <details open={history} onToggle={(e) => setHistory(e.currentTarget.open)}>
                  <summary>{t("privateView")}</summary>
                  {history && <PrivateHistory tripId={summary.id} />}
                </details>
              </Card>
              <ReconciliationHistory tripId={summary.id} />
            </>
          )}
        </>
      )}
    </div>
  );
}
/**
 * The correction state above the trip (VTC-169): a return for fixes with what to fix and the fix
 * action, a pending correction with the rule that the previous result stays in effect, or a final
 * rejection without actions. Nothing for other states.
 */
function TripCorrectionBanner({
  view,
  status,
  owner,
  pending,
  correctPath,
  reportPath,
}: {
  view: DTO["TripPrivate"];
  status: TripStatus;
  owner: boolean;
  pending: boolean;
  correctPath: string | null;
  reportPath: string | null;
}) {
  const { t } = useTranslation("trips"),
    latest = latestDecision(view.decisions);
  if (pending)
    return (
      <Card className="trip-banner" data-state="correction_pending" role="status">
        <strong>{t("correctionPendingTitle")}</strong>
        <p>{t("correctionPendingNote")}</p>
      </Card>
    );
  if (status === "rejected" && owner)
    return (
      <Card className="trip-banner" data-state="rejected">
        <strong>{t("rejectedFinalTitle")}</strong>
        <p>{t("rejectedFinalNote")}</p>
      </Card>
    );
  if (status !== "needs_fix") return null;
  const fields: CorrectionField[] = correctableFacts(view.correction).map((fact) => fact.field);
  return (
    <Card className="trip-banner" data-state="needs_fix" data-attention="true">
      <strong>{t("fixBannerTitle")}</strong>
      {owner ? (
        <>
          <p>{t(reportPath ? "fixBannerReport" : "fixBannerTelemetry")}</p>
          {!reportPath && fields.length > 0 && (
            <p>
              {t("fixBannerFields", {
                fields: fields.map((field) => t(`correctField_${field}`)).join(", "),
              })}
            </p>
          )}
          {latest?.reason && (
            <p className="trip-detail-quote">
              {latest.reviewer?.nickname ?? t("system")}: {t("quoted", { text: latest.reason })}
            </p>
          )}
          {correctPath && !reportPath && (
            <div className="trip-actions">
              <Button asChild>
                <Link to={correctPath}>{t("fixTrip")}</Link>
              </Button>
            </div>
          )}
        </>
      ) : (
        <p>{t("fixBannerStaff")}</p>
      )}
    </Card>
  );
}
/**
 * Full review page: back to the same queue view, the decision workspace in two columns from
 * 1200px, then the private report history and reconciliation history.
 */
function ReviewDetail({ tripId }: { tripId: string }) {
  const { t } = useTranslation("trips"),
    location = useLocation(),
    summary = useWorkspaceSummary(),
    mode = summary.dispatchMode,
    staged = mode === "stage3",
    search = new URLSearchParams(location.search),
    back = `/account/review${staged ? dispatchSearch(search) : queueSearch(search)}`;
  if (!mode) return <ReviewAccessState summary={summary} />;
  return (
    <div className="stack trip-page review-detail">
      <header className="trip-heading review-detail-header">
        <div>
          <h1>{t("review")}</h1>
          <p className="trips-note">{t("frozen")}</p>
        </div>
        <Button asChild variant="outline">
          <Link to={back}>
            <ArrowLeft size={14} strokeWidth={1.8} aria-hidden="true" focusable="false" />{" "}
            {t("queueBack")}
          </Link>
        </Button>
      </header>
      <DecisionPanel key={`${mode}:${tripId}`} tripId={tripId} variant="page" staged={staged}>
        {staged && <ReviewDetailHistory key={tripId} tripId={tripId} />}
      </DecisionPanel>
      {!staged && <ReviewDetailHistory key={tripId} tripId={tripId} />}
    </div>
  );
}
function ReviewDetailHistory({ tripId }: { tripId: string }) {
  const { t } = useTranslation("trips");
  const [history, setHistory] = useState(false);
  return (
    <>
      <Card>
        <details open={history} onToggle={(e) => setHistory(e.currentTarget.open)}>
          <summary>{t("privateView")}</summary>
          {history && <PrivateHistory tripId={tripId} />}
        </details>
      </Card>
      <ReconciliationHistory tripId={tripId} />
    </>
  );
}
function PrivateHistory({ tripId }: { tripId: string }) {
  const { t } = useTranslation("trips"),
    [tab, setTab] = useState("revisions"),
    // Each trip and tab has its own cursor stack; choosing a tab starts at its first page.
    pages = useCursorPages(`${tripId}:${tab}`);
  const suffix = `?${queryString({ limit: 25, cursor: pages.cursor })}`;
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
              pages.restart();
            }}
          >
            {t(name)}
          </Button>
        ))}
      </div>
      {tab === "proposals" ? (
        <ProposalList tripId={tripId} />
      ) : (
        <State query={query} rateLimitNotice />
      )}
      {tab === "revisions" &&
        revisions.data?.data.data.items.map((r, _i, items) => {
          const previous =
            "reportId" in r
              ? items.find(
                  (other) =>
                    "reportId" in other &&
                    other.reportId === r.reportId &&
                    other.number === r.number - 1,
                )
              : undefined;
          return <Revision key={r.id} revision={r} {...(previous ? { previous } : {})} />;
        })}
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
      <Pager pages={pages} nextCursor={next} label={t("historyPages")} />
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
        <p>{t("associateConfirmText")}</p>
      </Confirm>
    </Card>
  );
}
