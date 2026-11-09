import { type KeyboardEvent, type RefObject, useId, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { Button } from "../../shared/ui/primitives.js";
import { State } from "../trips/components.js";
import { useTripQuery } from "../trips/queries.js";
import { CatalogName, DecisionBadge, GameChip } from "../trips/TripTable.js";
import type { DTO } from "../trips/transport.js";
import {
  DecisionForm,
  EvidenceList,
  HoldReasons,
  QualificationCheckList,
  ReviewHistory,
  RevisionDiff,
  TripFacts,
} from "./decision-parts.js";
import { ReviewCorrections } from "./ReviewPanel.js";
import { historyItems, isOwn, queueType, reviewType } from "./review-model.js";
import "./review.css";

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
    // An IME composition uses Escape to cancel itself.
    if (event.nativeEvent.isComposing) return;
    // React bubbles events from portaled dialogs (confirmation, evidence viewer) through this
    // section; their Escape only closes the dialog, never the panel.
    const target = event.target as Node;
    if (!event.currentTarget.contains(target)) return;
    // Escape on a decision control never discards a draft choice, reason or confirmation; the
    // form's heading (focused after a result) and other text still close the panel.
    if (
      target instanceof Element &&
      target.closest(".review-form :is(textarea, input, select, button)")
    )
      return;
    event.stopPropagation();
    onClose();
  }
  const history = review
      ? historyItems(revisions.isError ? [] : revisionItems, review.trip.decisions)
      : [],
    // Effective facts can differ from the manual revision (telemetry, an approved staff
    // resolution), so they show whenever the read has them; a trip without facts or a manual
    // revision still states that its facts are unavailable.
    facts = review && (review.trip.effectiveFacts || !revision) && (
      <TripFacts facts={review.trip.effectiveFacts} game={review.trip.summary.game} />
    ),
    // Telemetry facts lead on trips with a telemetry source (late telemetry changed them); a
    // manual trip shows its revision diff first.
    telemetryFirst = !!review?.trip.summary.sourceKinds.includes("ets2telemetry"),
    leading = telemetryFirst ? facts : null,
    trailing = telemetryFirst ? null : facts,
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
      <QualificationCheckList check={review.qualificationCheck} game={review.trip.summary.game} />
    ),
    log = review && <ReviewHistory items={history} timezone={timezone} />,
    form = review && <DecisionForm key={tripId} tripId={tripId} review={review} etag={etag} />;
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
        {review && <HoldReasons codes={review.trip.reviewReasonCodes} />}
      </header>
      <div className="review-decision-body">
        <State query={query} />
        {review &&
          (variant === "page" ? (
            <div className="review-decision-columns">
              <div className="review-column">
                {leading}
                {diff}
                {trailing}
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
              {leading}
              {diff}
              {trailing}
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
