import { History } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DataTable } from "../../shared/ui/DataTable.js";
import { Badge } from "../../shared/ui/primitives.js";
import {
  type CorrectionField,
  correctionFields,
  proposedChanges,
} from "../trips/correction-model.js";
import { CorrectionValue, UnknownValue } from "../trips/TripPageSections.js";
import type { DTO } from "../trips/transport.js";
import { EvidenceList, ReviewSection } from "./decision-parts.js";
import type { ProposalMode, ReviewTrip } from "./review-model.js";

/**
 * The driver's pending correction against what the source reported (VTC-169): each proposed
 * value beside the current one, the driver's reason and the cited screenshots. An old-format
 * request (text only) is marked and has no values.
 */
export function CorrectionComparison({ trip, mode }: { trip: ReviewTrip; mode: ProposalMode }) {
  const { t } = useTranslation("trips"),
    { proposal } = mode,
    changes = proposedChanges(proposal),
    reported = new Map((trip.correction?.fields ?? []).map((fact) => [fact.field, fact])),
    fields = correctionFields.filter((field) => changes[field] !== undefined);
  return (
    <ReviewSection
      title={t("correctionReviewTitle")}
      className="review-correction"
      note={
        mode.oldFormat ? (
          <Badge tone="warn" icon={History} className="review-marker">
            {t("oldFormatMarker")}
          </Badge>
        ) : undefined
      }
    >
      {mode.oldFormat ? (
        <p className="review-note">{t("oldFormatHelp")}</p>
      ) : (
        <p className="review-muted">{t("correctionReviewNote")}</p>
      )}
      {fields.length > 0 && (
        <DataTable<CorrectionField>
          caption={t("correctionReviewTitle")}
          className="review-correction-table"
          size="sm"
          rows={fields}
          rowKey={(field) => field}
          rowAttributes={(field) => ({ "data-field": field })}
          columns={[
            {
              id: "field",
              header: t("correctionField"),
              rowHeader: true,
              cardLabel: false,
              cell: (field) => t(`correctField_${field}`),
            },
            {
              id: "current",
              header: t("correctionCurrent"),
              cell: (field) => {
                const fact = reported.get(field);
                return fact?.reported ? (
                  <CorrectionValue field={field} value={fact.reported} game={trip.summary.game} />
                ) : fact?.sourceCode ? (
                  <code className="review-break">{fact.sourceCode}</code>
                ) : (
                  <UnknownValue />
                );
              },
            },
            {
              id: "proposed",
              header: t("correctionProposed"),
              cell: (field) => (
                <strong>
                  <CorrectionValue
                    field={field}
                    value={changes[field] as string}
                    game={trip.summary.game}
                  />
                </strong>
              ),
            },
          ]}
        />
      )}
      <p className="review-multiline">
        <span className="review-muted">{t("correctionReasonLabel")}:</span> {proposal.reason}
      </p>
      {proposal.evidence.length > 0 && <EvidenceList evidence={proposal.evidence} />}
    </ReviewSection>
  );
}

/** Raw quality reasons the telemetry client reported, labelled when known; staff only. */
export function ClientReasons({ review }: { review: DTO["TripCorrectionReview"] | undefined }) {
  const { t, i18n } = useTranslation("trips"),
    codes = review?.clientReasonCodes ?? [];
  if (!codes.length) return null;
  return (
    <ReviewSection title={t("clientReasonsTitle")} className="review-client-reasons">
      <p className="review-muted">{t("clientReasonsHelp")}</p>
      <ul className="review-client-reason-list">
        {codes.map((code) => (
          <li key={code} data-code={code}>
            <span>
              {i18n.exists(`trips:clientReason_${code}`)
                ? t(`clientReason_${code}`)
                : t("clientReasonUnknown")}
            </span>{" "}
            <code className="review-break">{code}</code>
          </li>
        ))}
      </ul>
    </ReviewSection>
  );
}
