import { ArrowLeft } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useParams } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { useWorkspaceSummary } from "../../app/workspace-summary.js";
import { queryString, useCursorPages } from "../../shared/paging.js";
import { Pager } from "../../shared/ui/pager.js";
import { Button, Card } from "../../shared/ui/primitives.js";
import { DecisionPanel } from "../review/DecisionPanel.js";
import { dispatchSearch } from "../review/dispatch-model.js";
import { ReviewAccessState } from "../review/ReviewAccessState.js";
import { ProposalList } from "../review/ReviewPanel.js";
import { ReconciliationHistory } from "../review/reconciliation-parts.js";
import { queueSearch } from "../review/review-model.js";
import { Fields, Revision, State } from "./components.js";
import { correctableFacts, proposedChanges, unconfirmedFields } from "./correction-model.js";
import { useTripQuery } from "./queries.js";
import { TripActionsMenu } from "./TripActionsMenu.js";
import { TripEventDialog } from "./TripEventDialog.js";
import { TripHeader, TripHistory, TripStatusBanner } from "./TripPageOverview.js";
import {
  TripCargo,
  TripConditions,
  TripDataNote,
  TripEvidence,
  TripQualificationCheck,
  TripRoute,
  TripSources,
} from "./TripPageSections.js";
import { TripTechnicalDetails } from "./TripTechnicalDetails.js";
import { type DTO, validId } from "./transport.js";
import {
  acceptedLine,
  awaitingFix,
  canCorrect,
  privateOf,
  revisableReportId,
  tripBanner,
  tripStatus,
  tripTimes,
} from "./trip-page-model.js";
import "./trips.css";
/**
 * Trip page (VTC-170, mockup variant A): the route title with its status and an actions menu,
 * one status banner for a trip that is not accepted (an accepted one gets a counted line instead),
 * the route card, cargo and conditions, screenshots, the collapsed qualification check beside a
 * compact history, and for staff one collapsed "For dispatchers" block. Hiding is presentation
 * only: the server filters every private field.
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
    [dialog, setDialog] = useState(false),
    [notice, setNotice] = useState<string | null>(null),
    menuButton = useRef<HTMLButtonElement>(null),
    opener = useRef<HTMLElement | null>(null);
  const view = query.data?.data.data,
    own = privateOf(view),
    summary = view?.view === "private" ? view.summary : view,
    etag = query.data?.etag ?? null,
    selfId = session.self?.member.id,
    staff = !!session.self?.capabilities.includes("trips.review"),
    owner = !!summary && summary.owner.id === selfId,
    submitOwn = owner && !!session.self?.capabilities.includes("trips.submit_own"),
    // Actions stay owner-gated; status and the banner read the trip data alike for all.
    reportId = revisableReportId(view, selfId),
    status = summary ? tripStatus(summary, awaitingFix(view)) : null,
    banner = tripBanner(view, { owner, staff }),
    counted = acceptedLine(view),
    canLink = !!own && submitOwn && !!summary && "event" in summary,
    // VTC-169: the driver's own corrections feed the history; the pending one marks its values.
    correctable = canCorrect(view, selfId),
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
    correctPath =
      summary && correctable && !reportId ? `/account/trips/${summary.id}/correct` : null,
    openDialog = (from: HTMLElement | null) => {
      opener.current = from;
      setNotice(null);
      setDialog(true);
    };
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
  const editPath = reportId && status !== "needs_fix" ? `/account/reports/${reportId}/edit` : null;
  return (
    <div className="stack trip-page trip-detail">
      <TripHeader
        summary={summary}
        view={own}
        status={status}
        owner={owner}
        counted={counted}
        correctionPending={!!own?.pendingProposalId && status === "accepted"}
        menu={
          summary && (
            <TripActionsMenu
              triggerRef={menuButton}
              tripId={summary.id}
              onLinkEvent={canLink ? () => openDialog(menuButton.current) : null}
              editPath={editPath}
              dispatchPath={staff ? `/account/review/${summary.id}` : null}
              refreshing={query.isFetching}
              onRefresh={() => void query.refetch()}
              onCopied={(copied) => setNotice(t(copied ? "linkCopied" : "linkCopyFailed"))}
            />
          )
        }
      />
      <p role="status" className="trip-detail-notice">
        {notice}
      </p>
      <State query={query} rateLimitNotice />
      {summary && (
        <>
          {!own && <p className="trip-muted">{t("summaryView")}</p>}
          {banner && (
            <TripStatusBanner
              banner={banner}
              fixPath={reportId ? `/account/reports/${reportId}/edit` : null}
              correctPath={correctPath}
              fields={
                own && !reportId ? correctableFacts(own.correction).map((fact) => fact.field) : []
              }
              correctionPending={!!own?.pendingProposalId}
            />
          )}
          <TripRoute summary={summary} view={own} marks={marks} />
          <div className="trip-detail-grid">
            <TripCargo summary={summary} view={own} marks={marks} />
            {own && (
              <TripConditions
                summary={summary}
                view={own}
                onLink={canLink ? openDialog : undefined}
              />
            )}
          </div>
          {own && (own.evidence.length > 0 || own.manualRevision) && (
            <TripEvidence evidence={own.evidence} />
          )}
          {own && (
            <div className="trip-detail-grid">
              <TripQualificationCheck check={own.qualificationCheck} />
              <TripHistory view={own} proposals={proposalItems} />
            </div>
          )}
          {own && correctPath && status === "accepted" && <OwnerCorrection path={correctPath} />}
          {own && staff && <StaffBlock view={own} />}
          {own && <TripDataNote view={own} />}
          {canLink && (
            <TripEventDialog
              open={dialog}
              onOpenChange={setDialog}
              summary={summary}
              times={tripTimes(own?.effectiveFacts, own?.manualRevision)}
              etag={etag}
              onDone={(result) =>
                setNotice(t(result === "sent" ? "eventSentDone" : "eventLinkedDone"))
              }
              restoreFocus={() => (opener.current ?? menuButton.current)?.focus()}
            />
          )}
        </>
      )}
    </div>
  );
}
/**
 * Staff-only data, collapsed: sources, technical details, the private report history and the
 * reconciliation history. Nothing inside renders or loads until it is opened; drivers never get it.
 */
function StaffBlock({ view }: { view: DTO["TripPrivate"] }) {
  const { t } = useTranslation("trips"),
    [open, setOpen] = useState(false),
    [history, setHistory] = useState(false),
    summary = view.summary;
  return (
    <details
      className="card trip-staff"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        <span className="trip-staff-title">{t("staffTitle")}</span>
        <span className="trip-muted">{t("staffHint")}</span>
      </summary>
      {open && (
        <div className="stack trip-staff-body">
          <TripSources sources={view.sources} />
          <TripTechnicalDetails view={view} />
          <Card>
            <details open={history} onToggle={(e) => setHistory(e.currentTarget.open)}>
              <summary>{t("privateView")}</summary>
              {history && <PrivateHistory tripId={summary.id} />}
            </details>
          </Card>
          <ReconciliationHistory tripId={summary.id} />
        </div>
      )}
    </details>
  );
}
/**
 * An accepted manual report changes only through the driver's correction that another reviewer
 * approves (VTC-169); the accepted result stays effective until then.
 */
function OwnerCorrection({ path }: { path: string }) {
  const { t } = useTranslation("trips");
  return (
    <Card className="stack">
      <h2>{t("correction")}</h2>
      <p>{t("correctionHelp")}</p>
      <div className="trip-actions">
        <Button asChild variant="outline">
          <Link to={path}>{t("proposeCorrection")}</Link>
        </Button>
      </div>
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
