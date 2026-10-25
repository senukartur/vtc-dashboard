import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CatalogSelector, type Selection } from "../../shared/catalog-selectors/index.js";
import { usePublishedRevisions } from "../../shared/catalog-selectors/queries.js";
import { Card, Input, Label } from "../../shared/ui/primitives.js";
import { EvidenceItem } from "../manual-reports/fields.js";
import { Codes, Confirm, Failure, Fields, PageNav, State } from "../trips/components.js";
import { HistoricalRules } from "../trips/HistoricalRules.js";
import { useTripCommand, useTripQuery } from "../trips/queries.js";
import { canonicalDecimal, type DTO, proposalResult, schema } from "../trips/transport.js";
export function ReviewPanel({ tripId }: { tripId: string }) {
  const { t } = useTranslation("trips"),
    query = useTripQuery(`/trips/${tripId}/review`, "EnvelopeReview"),
    command = useTripCommand(),
    [reason, setReason] = useState(""),
    [success, setSuccess] = useState(false);
  const review = query.data?.data.data,
    trip = review?.trip,
    self = review?.blockedReasonCodes.includes("self_review_forbidden"),
    reviewed = trip?.manualRevision?.id ?? review?.factRevisionId;
  return (
    <div className="stack">
      <Card className="stack">
        <h2>{t("review")}</h2>
        <State query={query} />
        {review && (
          <>
            <Fields
              values={{
                version: trip?.summary.version,
                reviewedRevisionId: reviewed,
                ...review.evaluation,
              }}
            />
            <Codes values={review.blockedReasonCodes} />
            <HistoricalRules basis={review.evaluation} />
            {self && <p>{t("selfReview")}</p>}
            <h3>{t("facts")}</h3>
            {review.facts.map((f) => (
              <Fields
                key={`${f.field}-${f.evidenceRecordId}`}
                values={{
                  [f.field]: f.sourceValue,
                  source: f.evidenceRecordId,
                  reasonCodes: f.reasonCode,
                }}
              />
            ))}
            <Label htmlFor="review-reason">{t("reason")}</Label>
            <textarea
              id="review-reason"
              className="input"
              maxLength={2048}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setSuccess(false);
              }}
            />
            <Failure error={command.failure} seconds={command.seconds} />
            {success && <p role="status">{t("success")}</p>}
            <div className="trip-actions">
              {(["accept", "reject"] as const).map((decision) => (
                <Confirm
                  key={decision}
                  label={t(decision)}
                  guard={JSON.stringify([
                    query.data?.etag,
                    reviewed,
                    review.factRevisionId,
                    reason,
                    decision,
                  ])}
                  disabled={!review.canDecide || !reason.trim() || command.seconds > 0}
                  pending={command.pending}
                  failure={command.failure}
                  onConfirm={async () => {
                    const r = await command.run(
                      `/trips/${tripId}/decisions`,
                      {
                        decision,
                        reviewedRevisionId: reviewed,
                        factRevisionId: review.factRevisionId,
                        proposalId: null,
                        reason: reason.trim(),
                      },
                      "EnvelopeDecision",
                      query.data?.etag,
                    );
                    if (r) setSuccess(true);
                    return r;
                  }}
                >
                  <p>{reason}</p>
                  <Fields
                    values={{
                      decision: t(decision),
                      version: trip?.summary.version,
                      reviewedRevisionId: reviewed,
                      factRevisionId: review.factRevisionId,
                    }}
                  />
                </Confirm>
              ))}
            </div>
          </>
        )}
      </Card>
      {review && trip && (
        <>
          <ProposalList tripId={tripId} etag={query.data?.etag ?? null} self={!!self} />
          {!self && <ResolutionForm tripId={tripId} trip={trip} etag={query.data?.etag ?? null} />}
        </>
      )}
    </div>
  );
}
function ResolutionForm({
  tripId,
  trip,
  etag,
}: {
  tripId: string;
  trip: DTO["TripPrivate"];
  etag: string | null;
}) {
  const { t } = useTranslation("trips"),
    command = useTripCommand(),
    [reason, setReason] = useState(""),
    [changes, setChanges] = useState<DTO["ResolutionChanges"]>({}),
    [request, setRequest] = useState<string | null>(null),
    [evidence, setEvidence] = useState<string[]>(
      trip.evidence.filter((e) => e.state === "ready").map((e) => e.id),
    ),
    [open, setOpen] = useState(false),
    [error, setError] = useState(false),
    [saved, setSaved] = useState(false),
    [publication, setPublication] = useState(""),
    [catalogField, setCatalogField] = useState("cargoId"),
    [requestCursor, setRequestCursor] = useState<string | null>(null),
    [assignmentCursor, setAssignmentCursor] = useState<string | null>(null);
  const pub = usePublishedRevisions(trip.summary.game),
    active = publication || pub.data?.pages[0]?.data.data.items[0]?.id || "",
    requests = useTripQuery(
      `/trips/${tripId}/correction-requests?limit=25${requestCursor ? `&cursor=${encodeURIComponent(requestCursor)}` : ""}`,
      "EnvelopeListManualCorrectionRequest",
      open,
    ),
    assignments = useTripQuery(
      `/trips/${tripId}/qualification-assignments?limit=25${assignmentCursor ? `&cursor=${encodeURIComponent(assignmentCursor)}` : ""}`,
      "EnvelopeListAssignmentHistory",
      open && !requests.isPending,
    );
  const body = {
    ...changes,
    reason: reason.trim(),
    evidenceIds: evidence,
    ...(request ? { correctionRequestId: request } : {}),
  };
  function patch(key: keyof DTO["ResolutionChanges"], value: string) {
    setChanges((prev) => {
      const next = { ...prev };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });
    setSaved(false);
  }
  return (
    <Card className="stack">
      <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>{t("resolve")}</summary>
        {open && (
          <div className="stack">
            <p>{t("supportedChange")}</p>
            <Label htmlFor="resolution-request">{t("requestLink")}</Label>
            <select
              className="input"
              id="resolution-request"
              value={request ?? ""}
              onChange={(e) => setRequest(e.target.value || null)}
            >
              <option value="">—</option>
              {request && !requests.data?.data.data.items.some((item) => item.id === request) && (
                <option value={request}>{request}</option>
              )}
              {requests.data?.data.data.items
                .filter((r) => r.status === "pending")
                .map((r) => (
                  <option value={r.id} key={r.id}>
                    {r.reason} · {r.id}
                  </option>
                ))}
            </select>
            <State query={requests} />
            <PageNav
              next={requests.data?.data.data.nextCursor}
              hasPrevious={!!requestCursor}
              onNext={setRequestCursor}
              onPrevious={() => setRequestCursor(null)}
            />
            <div className="trip-grid">
              {(["actualDistanceM", "cargoMassKg"] as const).map((k) => (
                <div key={k} className="field">
                  <Label htmlFor={`resolution-${k}`}>{t(k)}</Label>
                  <Input
                    id={`resolution-${k}`}
                    value={changes[k] ?? ""}
                    inputMode="decimal"
                    maxLength={64}
                    onChange={(e) => patch(k, canonicalDecimal(e.target.value) ?? e.target.value)}
                  />
                </div>
              ))}
            </div>
            <Label htmlFor="resolution-publication">{t("catalogRevision")}</Label>
            <select
              className="input"
              id="resolution-publication"
              value={active}
              onChange={(e) => {
                setPublication(e.target.value);
                setChanges((prev) =>
                  Object.fromEntries(
                    Object.entries(prev).filter(
                      ([key]) =>
                        ![
                          "catalogRevisionId",
                          "originCityId",
                          "destinationCityId",
                          "cargoId",
                          "trailerTypeId",
                        ].includes(key),
                    ),
                  ),
                );
              }}
            >
              <option value="">{t("unknown")}</option>
              {pub.data?.pages
                .flatMap((p) => p.data.data.items)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.id}
                  </option>
                ))}
            </select>
            <Label htmlFor="resolution-field">{t("catalogField")}</Label>
            <select
              className="input"
              id="resolution-field"
              value={catalogField}
              onChange={(e) => setCatalogField(e.target.value)}
            >
              {[
                ["originCityId", "origin"],
                ["destinationCityId", "destination"],
                ["cargoId", "cargo"],
                ["trailerTypeId", "trailerType"],
              ].map(([id, label]) => (
                <option key={id} value={id}>
                  {t(label ?? "unknown")}
                </option>
              ))}
            </select>
            <div className="trip-grid">
              {(
                [
                  ["originCityId", "origin", "city"],
                  ["destinationCityId", "destination", "city"],
                  ["cargoId", "cargo", "cargo"],
                  ["trailerTypeId", "trailerType", "trailer_type"],
                ] as const
              )
                .filter(([key]) => key === catalogField)
                .map(([key, label, kind]) => (
                  <CatalogSelector
                    key={key}
                    label={t(label)}
                    game={trip.summary.game}
                    revisionId={active}
                    kind={kind}
                    value={
                      changes[key]
                        ? {
                            entityId: changes[key],
                            revisionId: changes.catalogRevisionId ?? active,
                          }
                        : null
                    }
                    onChange={(s: Selection | null) => {
                      setChanges((prev) => {
                        const next = { ...prev };
                        if (s) {
                          next[key] = s.entityId;
                          next.catalogRevisionId = s.revisionId;
                        } else delete next[key];
                        if (
                          ![
                            next.originCityId,
                            next.destinationCityId,
                            next.cargoId,
                            next.trailerTypeId,
                          ].some(Boolean)
                        )
                          delete next.catalogRevisionId;
                        return next;
                      });
                    }}
                  />
                ))}
            </div>
            <Label htmlFor="resolution-assignment">{t("assignment")}</Label>
            <select
              id="resolution-assignment"
              className="input"
              value={changes.qualificationAssignmentId ?? ""}
              onChange={(e) => patch("qualificationAssignmentId", e.target.value)}
            >
              <option value="">—</option>
              {changes.qualificationAssignmentId &&
                !assignments.data?.data.data.items.some(
                  (item) => item.id === changes.qualificationAssignmentId,
                ) && (
                  <option value={changes.qualificationAssignmentId}>
                    {changes.qualificationAssignmentId}
                  </option>
                )}
              {assignments.data?.data.data.items.map((a) => (
                <option value={a.id} key={a.id}>
                  {a.id} · {a.assignedAt} → {a.endedAt ?? "…"}
                </option>
              ))}
            </select>
            <State query={assignments} />
            <PageNav
              next={assignments.data?.data.data.nextCursor}
              hasPrevious={!!assignmentCursor}
              onNext={setAssignmentCursor}
              onPrevious={() => setAssignmentCursor(null)}
            />
            {trip.effectiveFacts?.provider === "ets2telemetry" && (
              <>
                <p>{t("timeHelp")}</p>
                {(["actualStartAt", "actualCompletedAt"] as const).map((k) => (
                  <div key={k}>
                    <Label htmlFor={`resolution-${k}`}>{t(k)} (UTC)</Label>
                    <Input
                      id={`resolution-${k}`}
                      placeholder="YYYY-MM-DDTHH:mm:ss.sssZ"
                      value={changes[k] ?? ""}
                      onChange={(e) => patch(k, e.target.value)}
                    />
                  </div>
                ))}
              </>
            )}
            <fieldset className="stack">
              <legend>{t("evidenceSelect")}</legend>
              {trip.evidence.map((e) => (
                <label className="trip-check" key={e.id}>
                  <input
                    type="checkbox"
                    disabled={e.state !== "ready"}
                    checked={evidence.includes(e.id)}
                    onChange={(event) =>
                      setEvidence(
                        event.target.checked
                          ? [...evidence, e.id]
                          : evidence.filter((id) => id !== e.id),
                      )
                    }
                  />
                  {e.originalName} · {t(e.state)}
                </label>
              ))}
            </fieldset>
            <Label htmlFor="resolution-reason">{t("reason")}</Label>
            <textarea
              id="resolution-reason"
              className="input"
              maxLength={2048}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <Failure error={command.failure} seconds={command.seconds} />
            {error && <p role="alert">{t("noChanges")}</p>}
            {saved && <p role="status">{t("success")}</p>}
            <Confirm
              label={t("resolve")}
              guard={JSON.stringify([etag, body])}
              disabled={!reason.trim() || !Object.keys(changes).length || command.seconds > 0}
              pending={command.pending}
              failure={command.failure}
              onConfirm={async () => {
                if (!schema("ResolutionInput").safeParse(body).success) {
                  setError(true);
                  return;
                }
                const r = await command.run(
                  `/trips/${tripId}/resolution-proposals`,
                  body,
                  "EnvelopeCommandResult",
                  etag,
                );
                if (r) {
                  setSaved(true);
                  setChanges({});
                }
                return r;
              }}
            >
              <Fields
                values={{ version: trip.summary.version, ...changes, requestLink: request }}
              />
              <p>{reason}</p>
            </Confirm>
          </div>
        )}
      </details>
    </Card>
  );
}
export function ProposalList({
  tripId,
  etag,
  self,
}: {
  tripId: string;
  etag: string | null;
  self: boolean;
}) {
  const { t } = useTranslation("trips"),
    [cursor, setCursor] = useState<string | null>(null),
    [history, setHistory] = useState<string[]>([]),
    query = useTripQuery(
      `/trips/${tripId}/proposals?limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      "EnvelopeListTripProposal",
    );
  return (
    <Card className="stack">
      <h2>{t("proposals")}</h2>
      <p>{t("frozen")}</p>
      <State query={query} />
      {query.data?.data.data.items.map((p) => (
        <Proposal key={p.id} proposal={p} tripId={tripId} etag={etag} self={self} />
      ))}
      {query.data && !query.data.data.data.items.length && <p>{t("empty")}</p>}
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
  );
}
function Proposal({
  proposal,
  tripId,
  etag,
  self,
}: {
  proposal: DTO["TripProposal"];
  tripId: string;
  etag: string | null;
  self: boolean;
}) {
  const { t } = useTranslation("trips"),
    [open, setOpen] = useState(false),
    [reason, setReason] = useState(""),
    [message, setMessage] = useState(""),
    command = useTripCommand(),
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
          {p.state === "pending" && !self && (
            <>
              <Label htmlFor={`proposal-${p.id}`}>{t("reason")}</Label>
              <textarea
                id={`proposal-${p.id}`}
                className="input"
                value={reason}
                maxLength={2048}
                onChange={(e) => setReason(e.target.value)}
              />
              <div className="trip-actions">
                {(["approve", "reject"] as const).map((decision) => (
                  <Confirm
                    key={decision}
                    label={t(decision === "approve" ? "approve" : "rejectProposal")}
                    guard={JSON.stringify([etag, p.revisionId, decision, reason])}
                    pending={command.pending}
                    failure={command.failure}
                    disabled={
                      !reason.trim() ||
                      command.seconds > 0 ||
                      (decision === "approve" && p.kind === "correction_request")
                    }
                    onConfirm={async () => {
                      const r = await command.run(
                        `/trips/${tripId}/proposals/${p.id}/decisions`,
                        { decision, reviewedRevisionId: p.revisionId, reason: reason.trim() },
                        "EnvelopeTripProposalDecision",
                        etag,
                      );
                      if (r)
                        setMessage(
                          proposalResult(r.data.data) === "proposal"
                            ? "proposalRejected"
                            : "success",
                        );
                      return r;
                    }}
                  >
                    <Fields
                      values={{ proposalRevision: p.revisionId, version: etag, ...p.changes }}
                    />
                    {p.eventAssociation && <Fields values={p.eventAssociation} />}
                    <p>{reason}</p>
                  </Confirm>
                ))}
              </div>
            </>
          )}
          <Failure error={command.failure} seconds={command.seconds} />
          {message && <p role="status">{t(message)}</p>}
        </div>
      )}
    </details>
  );
}
