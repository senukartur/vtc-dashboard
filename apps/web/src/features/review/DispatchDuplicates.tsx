import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { formatQuantity, formatUtc } from "../../shared/formatting.js";
import { Button, Card, Label, Select } from "../../shared/ui/primitives.js";
import { Confirm, Failure, PageNav, State } from "../trips/components.js";
import { useTripCommand, useTripQuery } from "../trips/queries.js";
import { CatalogName, DecisionBadge, GameChip } from "../trips/TripTable.js";
import { type DTO, queryString, rejectedCursor } from "../trips/transport.js";
import { ReviewReasonList } from "./DispatchQueueTable.js";
import type { dispatchParams } from "./dispatch-model.js";
import { MergePair } from "./reconciliation-parts.js";
import { pageSize, reasonLimit } from "./review-model.js";

type Duplicate = DTO["TripStage3Duplicate"];
type Params = ReturnType<typeof dispatchParams>;

function DuplicateTrip({
  trip,
  timezone,
  back,
}: {
  trip: DTO["TripStage3DuplicateTrip"];
  timezone: string;
  back: string;
}) {
  const { t, i18n } = useTranslation("trips");
  const locale = i18n.resolvedLanguage === "en" ? "en" : "ru";
  return (
    <div className="dispatch-pair-trip">
      <div className="trip-actions">
        <strong className="review-break">{trip.owner.nickname}</strong>
        <DecisionBadge decision={trip.decision} />
      </div>
      <Link className="review-break" to={`/account/review/${trip.id}${back}`}>
        <CatalogName value={trip.origin} /> → <CatalogName value={trip.destination} />
        {" · #"}
        {new Intl.NumberFormat(locale, { useGrouping: false }).format(trip.number)}
      </Link>
      <span>
        <CatalogName value={trip.cargo} /> · {formatQuantity(trip.actualDistanceM, "km", locale)}
      </span>
      <span className="review-muted">
        {formatUtc(trip.reportingAt, locale, timezone)} ·{" "}
        {trip.sourceKinds.map((kind) => t(kind)).join(" / ")}
      </span>
    </div>
  );
}

function DuplicateAction({
  candidate,
  canAct,
  onSuccess,
  onClose,
}: {
  candidate: Duplicate;
  canAct: boolean;
  onSuccess: (result: DTO["TripStage3DuplicateDismissal"]) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation("trips");
  const fieldId = useId();
  const command = useTripCommand();
  const heading = useRef<HTMLHeadingElement>(null);
  const reasonField = useRef<HTMLTextAreaElement>(null);
  const [reason, setReason] = useState("");
  const undo = candidate.dismissed;
  const title = t(undo ? "dispatchUndoDismissal" : "dispatchDismissDuplicate");
  const trimmed = reason.trim();
  const suffix = undo ? "dismissal-reversals" : "dismissals";
  const etag = `"v${candidate.version}"`;
  const body: DTO["TripStage3DuplicateUndoInput"] | DTO["TripStage3DuplicateDismissInput"] = undo
    ? {}
    : { reason: trimmed };
  useEffect(() => {
    (undo ? heading.current : reasonField.current)?.focus();
  }, [undo]);
  return (
    <Card className="stack dispatch-duplicate-action">
      <h2 ref={heading} tabIndex={-1}>
        {title}
      </h2>
      <p>
        <ReviewReasonList codes={candidate.reasonCodes} />
      </p>
      {!undo && (
        <div className="review-field">
          <Label htmlFor={fieldId}>{t("dispatchDismissReason")}</Label>
          <textarea
            ref={reasonField}
            id={fieldId}
            className="input"
            required
            aria-describedby={`${fieldId}-hint`}
            value={reason}
            maxLength={reasonLimit}
            onChange={(event) => setReason(event.target.value)}
          />
          <small id={`${fieldId}-hint`} className="review-muted">
            {t("dispatchDismissReasonHelp")}
          </small>
        </div>
      )}
      {!canAct && <p role="status">{t("dispatchCandidateChanged")}</p>}
      <Failure error={command.failure} seconds={command.seconds} />
      <div className="trip-actions">
        <Confirm
          label={title}
          guard={JSON.stringify([etag, undo, trimmed, canAct])}
          disabled={!canAct || (!undo && !trimmed) || command.seconds > 0}
          pending={command.pending}
          failure={command.failure}
          onConfirm={async () => {
            if (!canAct) return;
            const result = await command.run(
              `/reconciliation-candidates/${candidate.id}/${suffix}`,
              body,
              "TripStage3DuplicateDismissalEnvelope",
              etag,
            );
            if (result) onSuccess(result.data.data);
            return result;
          }}
        >
          <p className="review-multiline">{undo ? t("dispatchUndoHelp") : trimmed}</p>
        </Confirm>
        <Button type="button" variant="ghost" onClick={onClose} disabled={command.pending}>
          {t("cancel")}
        </Button>
      </div>
    </Card>
  );
}

export function DispatchDuplicates({
  game,
  status,
  memberId,
  timezone,
  changeStatus,
  back,
}: {
  game: Params["game"];
  status: Params["duplicateStatus"];
  memberId: string | undefined;
  timezone: string;
  changeStatus: (status: Params["duplicateStatus"]) => void;
  back: string;
}) {
  const { t } = useTranslation("trips");
  const statusId = useId();
  const filterKey = `${game ?? ""}:${status}`;
  const [pagination, setPagination] = useState({ key: filterKey, stack: [] as string[] });
  const [selection, setSelection] = useState<{
    key: string;
    candidate: Duplicate;
    action: "dismiss" | "merge";
  } | null>(null);
  const [saved, setSaved] = useState<DTO["TripStage3DuplicateDismissal"] | null>(null);
  const [merged, setMerged] = useState<string | null>(null);
  const stack = pagination.key === filterKey ? pagination.stack : [];
  const cursor = stack.at(-1) ?? null;
  const query = useTripQuery(
    `/reconciliation-candidates?${queryString({ view: "stage3", status, game, limit: pageSize, cursor })}`,
    "TripStage3DuplicateListEnvelope",
  );
  if (pagination.key !== filterKey || rejectedCursor(cursor, query.error))
    setPagination({ key: filterKey, stack: [] });
  const data = query.data?.data.data;
  const items = data?.items.filter(
    ({ primaryTrip, secondaryTrip }) =>
      primaryTrip.owner.id !== memberId && secondaryTrip.owner.id !== memberId,
  );
  const selected = selection?.key === filterKey ? selection : null;
  const current = items?.find((candidate) => candidate.id === selected?.candidate.id);
  const canAct =
    !!current &&
    current.dismissed === selected?.candidate.dismissed &&
    current.version === selected.candidate.version &&
    current.primaryTrip.id === selected.candidate.primaryTrip.id &&
    current.primaryTrip.version === selected.candidate.primaryTrip.version &&
    current.secondaryTrip.id === selected.candidate.secondaryTrip.id &&
    current.secondaryTrip.version === selected.candidate.secondaryTrip.version;
  function focusSelection() {
    (
      document.getElementById(`duplicate-${selected?.action}-${selected?.candidate.id}`) ??
      document.getElementById(statusId)
    )?.focus();
  }
  return (
    <div className="stack">
      <div className="trip-actions">
        <Label htmlFor={statusId}>{t("state")}</Label>
        <Select
          id={statusId}
          className="dispatch-duplicate-status"
          value={status}
          onChange={(event) =>
            changeStatus(event.target.value === "dismissed" ? "dismissed" : "waiting")
          }
        >
          <option value="waiting">{t("dispatchOpenDuplicates")}</option>
          <option value="dismissed">{t("dispatchDismissedDuplicates")}</option>
        </Select>
      </div>
      <State
        query={query}
        refresh={() => {
          setPagination({ key: filterKey, stack: [] });
          if (!cursor) void query.refetch();
        }}
      />
      {saved && (
        <p role="status">{t(saved.dismissed ? "dispatchDismissed" : "dispatchRestored")}</p>
      )}
      {merged && (
        <div className="trip-actions">
          <p role="status">{t("success")}</p>
          <Link to={`/account/trips/${merged}`}>{t("history")}</Link>
        </div>
      )}
      {selected?.action === "dismiss" && (
        <DuplicateAction
          key={selected.candidate.id}
          candidate={selected.candidate}
          canAct={canAct}
          onClose={() => {
            focusSelection();
            setSelection(null);
          }}
          onSuccess={(result) => {
            document.getElementById(statusId)?.focus();
            setSaved(result);
            setSelection(null);
            setPagination({ key: filterKey, stack: [] });
          }}
        />
      )}
      {selected?.action === "merge" && (
        <div className="stack">
          {canAct ? (
            <MergePair
              key={selected.candidate.id}
              pair={{
                primaryTripId: selected.candidate.primaryTrip.id,
                secondaryTripId: selected.candidate.secondaryTrip.id,
              }}
              expectedVersions={{
                primary: selected.candidate.primaryTrip.version,
                secondary: selected.candidate.secondaryTrip.version,
              }}
              refreshCandidate={() => {
                focusSelection();
                setSelection(null);
                void query.refetch();
              }}
              onMerged={(id) => {
                document.getElementById(statusId)?.focus();
                setMerged(id);
                setSelection(null);
                setPagination({ key: filterKey, stack: [] });
              }}
            />
          ) : (
            <p role="status">{t("dispatchCandidateChanged")}</p>
          )}
          <div>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                focusSelection();
                setSelection(null);
              }}
            >
              {t("cancel")}
            </Button>
          </div>
        </div>
      )}
      {items?.length === 0 && (
        <p>
          {t(status === "dismissed" ? "dispatchNoDismissedDuplicates" : "dispatchNoDuplicates")}
        </p>
      )}
      {items?.map((candidate) => (
        <Card className="stack dispatch-duplicate" key={candidate.id}>
          <header className="trip-actions">
            <GameChip game={candidate.game} />
            <ReviewReasonList codes={candidate.reasonCodes} />
          </header>
          <div className="dispatch-pair">
            <DuplicateTrip trip={candidate.primaryTrip} timezone={timezone} back={back} />
            <DuplicateTrip trip={candidate.secondaryTrip} timezone={timezone} back={back} />
          </div>
          <div className="trip-actions">
            <Button
              id={`duplicate-dismiss-${candidate.id}`}
              type="button"
              size="sm"
              variant="outline"
              aria-expanded={
                selected?.candidate.id === candidate.id && selected.action === "dismiss"
              }
              onClick={() => {
                setSelection({ key: filterKey, candidate, action: "dismiss" });
                setSaved(null);
                setMerged(null);
              }}
            >
              {t(candidate.dismissed ? "dispatchUndoDismissal" : "dispatchDismissDuplicate")}
            </Button>
            {!candidate.dismissed && (
              <Button
                id={`duplicate-merge-${candidate.id}`}
                type="button"
                size="sm"
                variant="ghost"
                aria-expanded={
                  selected?.candidate.id === candidate.id && selected.action === "merge"
                }
                onClick={() => {
                  setSelection({ key: filterKey, candidate, action: "merge" });
                  setSaved(null);
                  setMerged(null);
                }}
              >
                {t("mergePair")}
              </Button>
            )}
          </div>
        </Card>
      ))}
      {data && (
        <PageNav
          next={data.nextCursor}
          hasPrevious={stack.length > 0}
          onNext={(next) => setPagination({ key: filterKey, stack: [...stack, next] })}
          onPrevious={() => setPagination({ key: filterKey, stack: stack.slice(0, -1) })}
        />
      )}
    </div>
  );
}
