import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { Button, Card, Label } from "../../shared/ui/primitives.js";
import {
  Codes,
  Confirm,
  EffectiveFacts,
  Failure,
  Fields,
  PageNav,
  State,
  TripSummary,
} from "../trips/components.js";
import { useTripCommand, useTripQuery } from "../trips/queries.js";
import { type DTO, validId } from "../trips/transport.js";
import "../trips/trips.css";
export function ReconciliationPage() {
  const { t } = useTranslation("trips"),
    session = useSession(),
    [params] = useSearchParams(),
    [cursor, setCursor] = useState<string | null>(null),
    [history, setHistory] = useState<string[]>([]),
    [pair, setPair] = useState<DTO["MergeCandidate"] | null>(null),
    [merged, setMerged] = useState<string | null>(null),
    staff = !!session.self?.capabilities.includes("trips.review"),
    query = useTripQuery(
      `/reconciliation-candidates?limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      "EnvelopeListMergeCandidate",
      staff,
    ),
    historyTrip = params.get("trip");
  if (!staff)
    return (
      <Card>
        <p>{t("forbidden")}</p>
      </Card>
    );
  return (
    <div className="stack trip-page">
      <h1>{t("reconciliation")}</h1>
      <p>{t("mergeHelp")}</p>
      <Card className="stack">
        <State
          query={query}
          refresh={() => {
            setCursor(null);
            setHistory([]);
            if (!cursor) void query.refetch();
          }}
        />
        {query.data && !query.data.data.data.items.length && <p>{t("empty")}</p>}
        {query.data?.data.data.items.map((candidate) => (
          <article className="trip-revision" key={candidate.id}>
            <Fields
              values={{ primary: candidate.primaryTripId, secondary: candidate.secondaryTripId }}
            />
            <Codes values={candidate.reasonCodes} />
            <Button variant="outline" onClick={() => setPair(candidate)}>
              {t("selectPair")}
            </Button>
          </article>
        ))}
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
      {pair && (
        <MergePair
          key={pair.id}
          pair={pair}
          onMerged={(id) => {
            setMerged(id);
            setPair(null);
          }}
        />
      )}
      {merged && (
        <Card>
          <p role="status">{t("success")}</p>
          <Button asChild>
            <Link to={`/account/trips/${merged}`}>{t("history")}</Link>
          </Button>
        </Card>
      )}
      {validId(historyTrip ?? undefined) && (
        <ReconciliationHistory tripId={historyTrip as string} />
      )}
    </div>
  );
}
function MergePair({
  pair,
  onMerged,
}: {
  pair: DTO["MergeCandidate"];
  onMerged: (id: string) => void;
}) {
  const { t } = useTranslation("trips"),
    session = useSession(),
    command = useTripCommand(),
    a = useTripQuery(`/trips/${pair.primaryTripId}`, "EnvelopeTripView"),
    b = useTripQuery(`/trips/${pair.secondaryTripId}`, "EnvelopeTripView", !!a.data),
    [primary, setPrimary] = useState(pair.primaryTripId),
    [reason, setReason] = useState("");
  const av = a.data?.data.data,
    bv = b.data?.data.data,
    as = av?.view === "private" ? av.summary : av,
    bs = bv?.view === "private" ? bv.summary : bv;
  const self = [as, bs].some(
    (s) => s && s.owner.id === session.self?.member.id && s.sourceKinds.includes("manual"),
  );
  const p = primary === as?.id ? as : bs,
    s = primary === as?.id ? bs : as,
    body =
      p && s
        ? {
            primaryTripId: p.id,
            secondaryTripId: s.id,
            primaryVersion: p.version,
            secondaryVersion: s.version,
            reason: reason.trim(),
          }
        : null;
  return (
    <Card className="stack">
      <h2>{t("mergePair")}</h2>
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
          {self && <p>{t("selfReview")}</p>}
          <Failure error={command.failure} seconds={command.seconds} />
          <Confirm
            label={t("merge")}
            guard={JSON.stringify(body)}
            disabled={self || !reason.trim() || as.id === bs.id || command.seconds > 0}
            pending={command.pending}
            failure={command.failure}
            onConfirm={async () => {
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
    [open, setOpen] = useState(false),
    [cursor, setCursor] = useState<string | null>(null),
    [history, setHistory] = useState<string[]>([]),
    query = useTripQuery(
      `/trips/${tripId}/reconciliations?limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
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
            <State query={query} />
            {query.data && !query.data.data.data.items.length && <p>{t("empty")}</p>}
            {query.data?.data.data.items.map((r) => (
              <ReverseMerge key={r.id} reconciliation={r} />
            ))}
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
          </div>
        )}
      </details>
    </Card>
  );
}
function ReverseMerge({ reconciliation }: { reconciliation: DTO["Reconciliation"] }) {
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
    self = summaries.some(
      (s) => s && s.owner.id === session.self?.member.id && s.sourceKinds.includes("manual"),
    );
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
          {self && <p>{t("selfReview")}</p>}
          {r.state === "applied" && (
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
                guard={JSON.stringify([query.data?.etag, body])}
                disabled={!reason.trim() || self || !a.data || !b.data || command.seconds > 0}
                pending={command.pending}
                failure={command.failure}
                onConfirm={async () => {
                  const result = await command.run(
                    `/reconciliations/${r.id}/reversals`,
                    body,
                    "EnvelopeReconciliation",
                    query.data?.etag,
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
