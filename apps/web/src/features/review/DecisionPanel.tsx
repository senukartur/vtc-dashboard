import { type KeyboardEvent, type RefObject, useId, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { Button } from "../../shared/ui/primitives.js";
import { State } from "../trips/components.js";
import { useTripQuery } from "../trips/queries.js";
import { CatalogName, DecisionBadge, GameChip } from "../trips/TripTable.js";
import { type DTO, revisionFields } from "../trips/transport.js";
import {
  DecisionForm,
  EvidenceList,
  QualificationCheckList,
  ReviewHistory,
  RevisionDiff,
} from "./decision-parts.js";
import { ReviewCorrections } from "./ReviewPanel.js";
import { historyItems, isOwn, queueType, reviewType } from "./review-model.js";
import "./review.css";

/** Catalog publication of the reviewed facts, for labels of rule entities. */
function catalogRevision(review: DTO["Review"]): string | null {
  if (review.evaluation.catalogRevisionId) return review.evaluation.catalogRevisionId;
  const revision = review.trip.manualRevision;
  if (!revision) return null;
  const trailer = revisionFields(revision).trailerType;
  return trailer.status === "resolved" ? trailer.catalogRevisionId : null;
}

/**
 * Decision workspace for one trip: revision diff, evidence, qualification check, history and the
 * decision form, all from the server's review read. `side` is the non-modal region beside the
 * queue at wide widths; `page` is the full review page.
 */
export function DecisionPanel({
  tripId,
  variant,
  fallback,
  headingRef,
  onClose,
  fullHref,
}: {
  tripId: string;
  variant: "side" | "page";
  fallback?: DTO["TripSummary"] | undefined;
  headingRef?: RefObject<HTMLHeadingElement | null>;
  onClose?: () => void;
  fullHref?: string;
}) {
  const { t } = useTranslation("trips"),
    session = useSession(),
    headingId = useId(),
    timezone = session.self?.preferences.displayTimezone ?? "UTC",
    query = useTripQuery(`/trips/${tripId}/review`, "EnvelopeReview"),
    review = query.data?.data.data,
    etag = query.data?.etag ?? null,
    revision = review?.trip.manualRevision ?? null,
    revisions = useTripQuery(
      `/trips/${tripId}/manual-revisions?limit=25`,
      "EnvelopeListManualRevision",
      !!revision,
    ),
    revisionItems = revisions.data?.data.data.items ?? [],
    summary = review?.trip.summary ?? fallback,
    // The queue row names the heading first so the focused heading does not change on load.
    titled = fallback ?? summary,
    type = fallback ? queueType(fallback) : review ? reviewType(review.trip) : null,
    own = summary ? isOwn(summary, session.self?.member.id) : false;
  const section = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (variant !== "side") return;
    const node = section.current;
    return () => {
      // Back/Forward, narrowing below the wide layout or a selection change can remove the panel
      // while it holds focus; Close and Escape already moved focus. Act only once the panel is
      // really gone and focus fell back to the document (Strict Mode reruns this cleanup).
      if (!node?.contains(document.activeElement)) return;
      queueMicrotask(() => {
        if (node.isConnected) return;
        const active = document.activeElement;
        if (active && active !== document.body) return;
        (
          document.getElementById(`trip-link-${tripId}`) ??
          document.getElementById("review-queue-table") ??
          document.getElementById("main-content")
        )?.focus();
      });
    };
  }, [tripId, variant]);
  function keyDown(event: KeyboardEvent<HTMLElement>) {
    if (variant !== "side" || event.key !== "Escape" || !onClose) return;
    // React bubbles events from portaled dialogs (confirmation, evidence viewer) through this
    // section; their Escape only closes the dialog, never the panel.
    if (!event.currentTarget.contains(event.target as Node)) return;
    event.stopPropagation();
    onClose();
  }
  const revisionId = review ? catalogRevision(review) : null,
    history = review
      ? historyItems(revisions.isError ? [] : revisionItems, review.trip.decisions)
      : [],
    diff = review && revision && (
      <RevisionDiff
        revision={revision}
        revisions={{
          isPending: revisions.isPending,
          isError: revisions.isError,
          items: revisionItems,
        }}
        game={review.trip.summary.game}
      />
    ),
    evidence = review && (revision || review.trip.evidence.length > 0) && (
      <EvidenceList evidence={review.trip.evidence} />
    ),
    check = review && (
      <QualificationCheckList
        check={review.qualificationCheck}
        game={review.trip.summary.game}
        revisionId={revisionId}
      />
    ),
    log = review && <ReviewHistory items={history} timezone={timezone} />,
    form = review && (
      <DecisionForm
        key={tripId}
        tripId={tripId}
        review={review}
        etag={etag}
        revisionId={revisionId}
      />
    );
  return (
    <section
      ref={section}
      className={`review-decision review-decision-${variant}`}
      aria-labelledby={headingId}
      onKeyDown={keyDown}
    >
      <header className="review-decision-header">
        <div className="review-decision-bar">
          {summary && <GameChip game={summary.game} />}
          {summary && <DecisionBadge decision={summary.decision} />}
          <span className="review-decision-actions">
            {variant === "side" && fullHref && (
              <Button asChild variant="outline" size="xs">
                <Link to={fullHref}>{t("openFull")}</Link>
              </Button>
            )}
            {variant === "page" && (
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => void query.refetch()}
                disabled={query.isFetching}
              >
                {t("refresh")}
              </Button>
            )}
            {variant === "side" && onClose && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="review-close"
                aria-label={t("closeDetails")}
                onClick={onClose}
              >
                <span aria-hidden="true">×</span>
              </Button>
            )}
          </span>
        </div>
        <h2 id={headingId} ref={headingRef} tabIndex={-1}>
          {titled ? (
            <>
              <CatalogName value={titled.origin} /> → <CatalogName value={titled.destination} />
            </>
          ) : (
            t("details")
          )}
        </h2>
        {summary && (
          <p className="review-meta">
            <span className="review-break">{summary.owner.nickname}</span>
            {own && <> {t("you")}</>}
            {type && <> · {t(`type_${type}`)}</>}
            {revision && <> · {t("revisionNumber", { number: revision.number })}</>}
          </p>
        )}
      </header>
      <div className="review-decision-body">
        <State query={query} />
        {review &&
          (variant === "page" ? (
            <div className="review-decision-columns">
              <div className="review-column">
                {diff}
                {evidence}
                {check}
              </div>
              <div className="review-column">
                {log}
                {form}
              </div>
            </div>
          ) : (
            <>
              {diff}
              {evidence}
              {check}
              {log}
              {form}
            </>
          ))}
        {review && variant === "page" && (
          <ReviewCorrections
            tripId={tripId}
            trip={review.trip}
            etag={etag}
            self={review.blockedReasonCodes.includes("self_review_forbidden")}
          />
        )}
      </div>
    </section>
  );
}
