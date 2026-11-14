import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "../../app/Session.js";
import { type WorkspaceSummary, useWorkspaceSummary } from "../../app/workspace-summary.js";
import { queryString, useCursorPages } from "../../shared/paging.js";
import { Pager } from "../../shared/ui/pager.js";
import { Button, Card, Label } from "../../shared/ui/primitives.js";
import {
  Confirm,
  EffectiveFacts,
  Failure,
  Fields,
  State,
  TripSummary,
} from "../trips/components.js";
import { useTripCommand, useTripQuery } from "../trips/queries.js";
import type { DTO } from "../trips/transport.js";
export function MergePair({
  pair,
  onMerged,
  expectedVersions,
  refreshCandidate,
}: {
  pair: Pick<DTO["MergeCandidate"], "primaryTripId" | "secondaryTripId">;
  onMerged: (id: string) => void;
  expectedVersions?: { primary: number; secondary: number };
  refreshCandidate?: () => void;
}) {
  const { t } = useTranslation("trips"),
    session = useSession(),
    command = useTripCommand(),
    a = useTripQuery(`/trips/${pair.primaryTripId}`, "EnvelopeTripView"),
    [primary, setPrimary] = useState(pair.primaryTripId),
    [reason, setReason] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const staged = !!expectedVersions;
  useEffect(() => {
    if (staged) heading.current?.focus();
  }, [staged]);
  const av = a.data?.data.data,
    as = av?.view === "private" ? av.summary : av;
  const memberId = session.self?.member.id;
  const primaryStale =
    expectedVersions &&
    as &&
    (as.id !== pair.primaryTripId || as.version !== expectedVersions.primary);
  const b = useTripQuery(
    `/trips/${pair.secondaryTripId}`,
    "EnvelopeTripView",
    !!as && !primaryStale && !(staged && as.owner.id === memberId),
  );
  const bv = b.data?.data.data,
    bs = bv?.view === "private" ? bv.summary : bv;
  const stale =
    primaryStale ||
    (expectedVersions &&
      bs &&
      (bs.id !== pair.secondaryTripId || bs.version !== expectedVersions.secondary));
  const ownTrips = [as, bs].filter(
    (trip): trip is DTO["TripSummary"] => trip !== undefined && trip.owner.id === memberId,
  );
  const ownManual = ownTrips.some((trip) => trip.sourceKinds.includes("manual"));
  const stagedSelf = staged && ownTrips.length > 0;
  const p = primary === as?.id ? as : bs,
    s = primary === as?.id ? bs : as,
    body =
      p && s && !stale && !ownManual && !stagedSelf
        ? {
            primaryTripId: p.id,
            secondaryTripId: s.id,
            primaryVersion: p.version,
            secondaryVersion: s.version,
            reason: reason.trim(),
          }
        : null;
  if (stale || stagedSelf)
    return (
      <Card className="stack">
        <h2 ref={heading} tabIndex={-1}>
          {t("mergePair")}
        </h2>
        <p role="status">
          {t(stagedSelf ? (ownManual ? "selfReview" : "forbidden") : "dispatchCandidateChanged")}
        </p>
        {refreshCandidate && (
          <div>
            <Button type="button" variant="outline" onClick={refreshCandidate}>
              {t("refresh")}
            </Button>
          </div>
        )}
      </Card>
    );
  return (
    <Card className="stack">
      <h2 ref={heading} tabIndex={-1}>
        {t("mergePair")}
      </h2>
      <State query={a} />
      <State query={b} />
      <div className="trip-grid">
        {[av, bv].map(
          (v, i) =>
            v && (
              <div key={i === 0 ? pair.primaryTripId : pair.secondaryTripId}>
                <TripSummary trip={v.view === "private" ? v.summary : v} />
                {v.view === "private" && <EffectiveFacts facts={v.effectiveFacts} />}
              </div>
            ),
        )}
      </div>
      {as && bs && (
        <>
          <Label htmlFor="merge-primary">{t("choosePrimary")}</Label>
          <select
            className="input"
            id="merge-primary"
            value={primary}
            onChange={(e) => setPrimary(e.target.value)}
          >
            <option value={as.id}>{as.id}</option>
            <option value={bs.id}>{bs.id}</option>
          </select>
          <Label htmlFor="merge-reason">{t("reason")}</Label>
          <textarea
            id="merge-reason"
            className="input"
            maxLength={2048}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {ownManual && <p>{t("selfReview")}</p>}
          <Failure error={command.failure} seconds={command.seconds} />
          <Confirm
            label={t("merge")}
            guard={JSON.stringify(body)}
            disabled={!body || !reason.trim() || as.id === bs.id || command.seconds > 0}
            pending={command.pending}
            failure={command.failure}
            onConfirm={async () => {
              if (!body) return;
              const r = await command.run("/reconciliations", body, "EnvelopeReconciliation");
              if (r) onMerged(r.data.data.primaryTripId);
              return r;
            }}
          >
            <p>{t("mergeHelp")}</p>
            {body && <Fields values={body} />}
          </Confirm>
        </>
      )}
    </Card>
  );
}
export function ReconciliationHistory({ tripId }: { tripId: string }) {
  const { t } = useTranslation("trips"),
    { dispatchMode } = useWorkspaceSummary(),
    [open, setOpen] = useState(false),
    pages = useCursorPages(`/trips/${tripId}/reconciliations`),
    query = useTripQuery(
      `/trips/${tripId}/reconciliations?${queryString({ limit: 25, cursor: pages.cursor })}`,
      "EnvelopeListReconciliation",
      open,
    );
  return (
    <Card className="stack">
      <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>{t("history")}</summary>
        {open && (
          <div className="stack">
            <p>{t("historyHelp")}</p>
            <State
              query={query}
              refresh={() => {
                pages.restart();
                if (!pages.cursor) void query.refetch();
              }}
            />
            {query.data && !query.data.data.data.items.length && <p>{t("empty")}</p>}
            {query.data?.data.data.items.map((r) => (
              <ReverseMerge key={r.id} reconciliation={r} dispatchMode={dispatchMode} />
            ))}
            <Pager
              pages={pages}
              nextCursor={query.data?.data.data.nextCursor}
              label={t("reconciliationPages")}
            />
          </div>
        )}
      </details>
    </Card>
  );
}
function ReverseMerge({
  reconciliation,
  dispatchMode,
}: {
  reconciliation: DTO["Reconciliation"];
  dispatchMode: WorkspaceSummary["dispatch"];
}) {
  const { t } = useTranslation("trips"),
    session = useSession(),
    [open, setOpen] = useState(false),
    [reason, setReason] = useState(""),
    [success, setSuccess] = useState(false),
    command = useTripCommand(),
    query = useTripQuery(`/reconciliations/${reconciliation.id}`, "EnvelopeReconciliation", open),
    r = query.data?.data.data,
    a = useTripQuery(`/trips/${r?.primaryTripId}`, "EnvelopeTripView", open && !!r),
    b = useTripQuery(`/trips/${r?.secondaryTripId}`, "EnvelopeTripView", open && !!a.data);
  const summaries = [a.data?.data.data, b.data?.data.data].map((v) =>
      v?.view === "private" ? v.summary : v,
    ),
    ownTrips = summaries.filter(
      (trip): trip is DTO["TripSummary"] =>
        trip !== undefined && trip.owner.id === session.self?.member.id,
    ),
    ownManual = ownTrips.some((trip) => trip.sourceKinds.includes("manual")),
    self = ownManual || (ownTrips.length > 0 && dispatchMode === "stage3"),
    waitingForMode = ownTrips.length > 0 && dispatchMode === undefined,
    etag = query.data?.etag,
    ready = !!a.data && !!b.data && !self && !waitingForMode && !!etag;
  const body = r
    ? {
        primaryVersion: r.primaryVersion,
        secondaryVersion: r.secondaryVersion,
        reason: reason.trim(),
      }
    : null;
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        {t(reconciliation.state)} · {reconciliation.id}
      </summary>
      <State query={query} />
      {r && (
        <div className="stack">
          <Fields
            values={{
              primary: r.primaryTripId,
              secondary: r.secondaryTripId,
              state: t(r.state),
              version: r.version,
            }}
          />
          <p>{t("reverseHelp")}</p>
          <State query={a} />
          <State query={b} />
          <div className="trip-grid">
            {summaries.map(
              (s, i) =>
                s && <TripSummary key={i === 0 ? r.primaryTripId : r.secondaryTripId} trip={s} />,
            )}
          </div>
          <Fields values={{ primary: r.primaryVersion, secondary: r.secondaryVersion }} />
          {r.state === "applied" && self && <p>{t(ownManual ? "selfReview" : "forbidden")}</p>}
          {r.state === "applied" && ready && (
            <>
              <Label htmlFor={`reverse-${r.id}`}>{t("reason")}</Label>
              <textarea
                id={`reverse-${r.id}`}
                className="input"
                value={reason}
                maxLength={2048}
                onChange={(e) => setReason(e.target.value)}
              />
              <Confirm
                label={t("reverse")}
                guard={JSON.stringify([etag, body])}
                disabled={!reason.trim() || command.seconds > 0}
                pending={command.pending}
                failure={command.failure}
                onConfirm={async () => {
                  if (!ready || !body || !etag) return;
                  const result = await command.run(
                    `/reconciliations/${r.id}/reversals`,
                    body,
                    "EnvelopeReconciliation",
                    etag,
                  );
                  if (result) setSuccess(true);
                  return result;
                }}
              >
                <p>{t("reverseHelp")}</p>
                <Fields
                  values={{ primary: r.primaryTripId, secondary: r.secondaryTripId, ...body }}
                />
              </Confirm>
            </>
          )}
          <Failure error={command.failure} seconds={command.seconds} />
          {success && <p role="status">{t("success")}</p>}
        </div>
      )}
    </details>
  );
}
