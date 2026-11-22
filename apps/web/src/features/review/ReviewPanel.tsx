import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CatalogSelector } from "../../shared/catalog-selectors/index.js";
import { queryString, useCursorPages } from "../../shared/paging.js";
import { Pager } from "../../shared/ui/pager.js";
import { Card, Input, Label } from "../../shared/ui/primitives.js";
import { EvidenceItem } from "../manual-reports/fields.js";
import { Confirm, Failure, Fields, State } from "../trips/components.js";
import { useTripCommand, useTripQuery } from "../trips/queries.js";
import { canonicalDecimal, type DTO, proposalResult, schema } from "../trips/transport.js";
import type { ReviewTrip } from "./review-model.js";
/** The trip's proposals, read-only: staff decide a pending one in the decision form. */
export function ProposalList({ tripId }: { tripId: string }) {
  const { t } = useTranslation("trips"),
    pages = useCursorPages(`/trips/${tripId}/proposals`),
    query = useTripQuery(
      `/trips/${tripId}/proposals?${queryString({ limit: 25, cursor: pages.cursor })}`,
      "EnvelopeListTripProposal",
    );
  return (
    <Card className="stack">
      <h2>{t("proposals")}</h2>
      <p>{t("frozen")}</p>
      <State query={query} />
      {query.data?.data.data.items.map((p) => (
        <Proposal key={p.id} proposal={p} tripId={tripId} />
      ))}
      {query.data && !query.data.data.data.items.length && <p>{t("empty")}</p>}
      <Pager
        pages={pages}
        nextCursor={query.data?.data.data.nextCursor}
        label={t("proposalPages")}
      />
    </Card>
  );
}
function Proposal({ proposal, tripId }: { proposal: DTO["TripProposal"]; tripId: string }) {
  const { t } = useTranslation("trips"),
    [open, setOpen] = useState(false),
    query = useTripQuery(`/trips/${tripId}/proposals/${proposal.id}`, "EnvelopeTripProposal", open),
    p = query.data?.data.data;
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        {t(proposal.state)} · {proposal.id}
      </summary>
      <State query={query} />
      {p && (
        <div className="stack">
          <Fields
            values={{
              proposalRevision: p.revisionId,
              baseTripVersion: p.baseTripVersion,
              baseFactRevisionId: p.baseFactRevisionId,
              requestLink: p.correctionRequestId ?? null,
            }}
          />
          <p>{p.reason}</p>
          {p.changes && <Fields values={p.changes} />}{" "}
          {p.eventAssociation && <Fields values={p.eventAssociation} />}{" "}
          {p.evidence.map((e) => (
            <EvidenceItem key={e.id} id={e.id} metadata={e} />
          ))}
          {p.review && (
            <>
              <p>
                {t(p.review.decision === "approve" ? "approved" : "rejected")} · {p.review.reason}
              </p>
              <Fields
                values={{
                  reviewedRevisionId: p.review.reviewedRevisionId,
                  submittedAt: p.review.decidedAt,
                }}
              />
            </>
          )}
        </div>
      )}
    </details>
  );
}
