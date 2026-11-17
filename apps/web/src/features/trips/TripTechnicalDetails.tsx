import { useState } from "react";
import { useTranslation } from "react-i18next";
import { formatUtc } from "../../shared/formatting.js";
import { Badge, Card } from "../../shared/ui/primitives.js";
import { EvidenceItem } from "../manual-reports/fields.js";
import { ReferenceFacts } from "../manual-reports/ReferenceFacts.js";
import { Codes, EffectiveFacts, Fields, Revision } from "./components.js";
import { useTripDisplay } from "./TripPageSections.js";
import { type DTO, tripSourceLabels } from "./transport.js";

function recordingKey(recording: DTO["TripSummary"]["recording"]) {
  return recording === "partial"
    ? "partialRecording"
    : recording === "complete"
      ? "complete"
      : "unknownRecording";
}

/**
 * Staff-only raw trip data, collapsed: identifiers, versions, raw reason codes, the effective facts,
 * the manual revision with its reference facts, private evidence files and decision references.
 * Nothing renders or loads until it is opened.
 */
export function TripTechnicalDetails({ view }: { view: DTO["TripPrivate"] }) {
  const { t } = useTranslation("trips"),
    { locale, timezone } = useTripDisplay(),
    [open, setOpen] = useState(false),
    summary = view.summary;
  return (
    <Card className="trip-detail-technical">
      <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>{t("technicalTitle")}</summary>
        {open && (
          <div className="stack">
            <p className="trip-muted">{t("technicalNote")}</p>
            <Fields
              values={{
                tripId: summary.id,
                version: summary.version,
                recording: t(recordingKey(summary.recording)),
                reportingAt: formatUtc(summary.reportingAt, locale, timezone),
                reportingBasis: t(summary.reportingBasis ?? "unknown"),
                source: summary.sourceKinds.map((kind) => t(tripSourceLabels[kind])),
                pendingProposalId: view.pendingProposalId,
              }}
            />
            <Codes values={view.reviewReasonCodes} />
            <EffectiveFacts facts={view.effectiveFacts} />
            {view.manualRevision && (
              <section className="stack">
                <ReferenceFacts revision={view.manualRevision} />
                <Revision revision={view.manualRevision} hideReferenceFields />
              </section>
            )}
            <section className="stack">
              <h3>{t("evidence")}</h3>
              {view.evidence.map((e) => (
                <EvidenceItem key={e.id} id={e.id} metadata={e} />
              ))}
              {!view.evidence.length && <p className="trip-muted">{t("noEvidence")}</p>}
              <p className="trip-muted">{t("retention")}</p>
            </section>
            <section className="stack">
              <h3>{t("decisions")}</h3>
              {!view.decisions.length && <p className="trip-muted">{t("empty")}</p>}
              {view.decisions.map((d) => (
                <article key={d.id} className="trip-revision">
                  <h4>{t(d.outcome)}</h4>
                  <p className="review-decision-by">
                    {d.reviewer?.nickname ?? t("system")}
                    {d.acceptedOverLimits && (
                      <Badge className="review-marker">{t("overLimitsMarker")}</Badge>
                    )}
                  </p>
                  <Fields
                    values={{
                      reviewedRevisionId: d.reviewedRevisionId,
                      submittedAt: d.decidedAt,
                      ...d.basis,
                    }}
                  />
                  <Codes values={d.reasonCodes} />
                </article>
              ))}
              <p className="trip-muted">{t("historyBound")}</p>
            </section>
          </div>
        )}
      </details>
    </Card>
  );
}
