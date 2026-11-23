import { ArrowLeft, Lock } from "lucide-react";
import { type ReactNode, useCallback, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { CatalogSelector } from "../../shared/catalog-selectors/index.js";
import { formatQuantity } from "../../shared/formatting.js";
import { DateTimeField } from "../../shared/ui/date-time-field.js";
import { Button, Card, FieldError, Input, Label } from "../../shared/ui/primitives.js";
import { EvidenceUpload } from "../manual-reports/fields.js";
import { Confirm, Failure, State } from "./components.js";
import {
  type CorrectionDraft,
  type CorrectionFact,
  type CorrectionField,
  catalogKinds,
  correctableFacts,
  correctionBody,
  correctionFields,
  draftChanges,
  initialDraft,
  isCatalogField,
  isTimeField,
} from "./correction-model.js";
import { useTripCommand, useTripQuery } from "./queries.js";
import { useTripLabel } from "./TripPageOverview.js";
import { CorrectionValue, useTripDisplay } from "./TripPageSections.js";
import { CatalogName } from "./TripTable.js";
import { type DTO, validId } from "./transport.js";
import { latestDecision, privateOf, returnedForFixesCode } from "./trip-page-model.js";
import "./trips.css";

/**
 * The author's own trip correction (VTC-169, board trip-Correct): the reviewer's return reason,
 * the correctable facts prefilled with what the source reported, the confirmed facts read-only,
 * a required reason and optional screenshots. The previous result stays in effect until a
 * different reviewer decides; the server enforces every rule.
 */
export function TripCorrectionPage() {
  const { t } = useTranslation("trips"),
    { tripId } = useParams(),
    session = useSession(),
    query = useTripQuery(`/trips/${tripId}`, "EnvelopeTripView", validId(tripId)),
    view = privateOf(query.data?.data.data),
    selfId = session.self?.member.id;
  if (!validId(tripId))
    return (
      <Card>
        <p>{t("notFound")}</p>
      </Card>
    );
  const back = `/account/trips/${tripId}`;
  return (
    <div className="stack trip-page trip-correction">
      <div>
        <Button asChild variant="outline">
          <Link to={back}>
            <ArrowLeft size={14} strokeWidth={1.8} aria-hidden="true" focusable="false" />{" "}
            {t("correctBack")}
          </Link>
        </Button>
      </div>
      <State query={query} rateLimitNotice />
      {query.data &&
        (view?.correction?.canPropose && view.summary.owner.id === selfId ? (
          <CorrectionForm
            key={`${view.summary.id}:${view.correction.baseFactRevisionId}`}
            view={view}
            state={view.correction}
            etag={query.data.etag}
            back={back}
          />
        ) : (
          <Card>
            <h1>{t("correctTitle")}</h1>
            <p>{t("correctUnavailable")}</p>
          </Card>
        ))}
    </div>
  );
}

function CorrectionForm({
  view,
  state,
  etag,
  back,
}: {
  view: DTO["TripPrivate"];
  state: DTO["TripCorrectionState"];
  etag: string | null;
  back: string;
}) {
  const { t } = useTranslation("trips"),
    { timezone } = useTripDisplay(),
    navigate = useNavigate(),
    command = useTripCommand(),
    headingId = useId(),
    noteId = useId(),
    label = useTripLabel(view.summary),
    facts = useMemo(() => correctableFacts(state), [state]),
    manual = view.effectiveFacts?.provider === "manual",
    [draft, setDraft] = useState<CorrectionDraft>(() => initialDraft(facts, timezone)),
    [reason, setReason] = useState(""),
    [evidence, setEvidence] = useState<string[]>([]),
    [ready, setReady] = useState(true),
    [touched, setTouched] = useState(false),
    latest = latestDecision(view.decisions),
    returned = latest?.reasonCodes.includes(returnedForFixesCode) ? latest : null,
    // A manual report is corrected against its own screenshots, which the server requires.
    reportEvidence = manual
      ? view.evidence.filter((e) => e.state === "ready").map((e) => e.id)
      : [],
    { changes, errors } = draftChanges(draft, facts, timezone),
    body = correctionBody(changes, reason, [...reportEvidence, ...evidence]),
    uploadsReady = !evidence.length || ready,
    evidenceMissing = manual && !reportEvidence.length,
    blocked = !body || !uploadsReady || evidenceMissing || command.seconds > 0;
  const onReady = useCallback((value: boolean) => setReady(value), []);
  const set = (field: CorrectionField, value: string) => {
    setDraft((previous) => ({ ...previous, [field]: value }));
    setTouched(true);
  };
  return (
    <>
      <header className="trip-heading">
        <div>
          <h1 id={headingId}>{t("correctTitle")}</h1>
          <p className="trip-detail-meta">
            {view.summary.origin || view.summary.destination ? (
              <>
                <CatalogName value={view.summary.origin} /> →{" "}
                <CatalogName value={view.summary.destination} />
              </>
            ) : (
              label
            )}
          </p>
        </div>
      </header>
      {returned && (
        <section className="trip-banner" data-tone="warn" data-status="needs_fix">
          <div className="trip-banner-body">
            <strong>
              {t("correctReturnedBy", { name: returned.reviewer?.nickname ?? t("system") })}
            </strong>
            {returned.reason && (
              <span className="trip-detail-quote">{t("quoted", { text: returned.reason })}</span>
            )}
          </div>
        </section>
      )}
      <Card className="stack" aria-labelledby={`${headingId}-editable`}>
        <h2 id={`${headingId}-editable`}>{t("correctEditable")}</h2>
        <p id={noteId} className="trip-muted">
          {t("timesIn", { timezone })}
        </p>
        <div className="trip-correction-fields">
          {facts.map((fact) => (
            <CorrectionInput
              key={fact.field}
              fact={fact}
              manual={manual}
              game={view.summary.game}
              value={draft[fact.field] ?? ""}
              error={touched ? errors[fact.field] : undefined}
              timezone={timezone}
              noteId={noteId}
              onChange={(value) => set(fact.field, value)}
            />
          ))}
        </div>
      </Card>
      <LockedFacts view={view} editable={facts.map((fact) => fact.field)} />
      <Card className="stack">
        <div className="field">
          <Label htmlFor="correction-reason">{t("correctReason")} *</Label>
          <textarea
            id="correction-reason"
            className="input"
            required
            maxLength={2048}
            aria-describedby="correction-reason-help"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <small id="correction-reason-help" className="trip-muted">
            {t("correctReasonHelp")}
          </small>
        </div>
        <p className="trip-muted">
          {t(manual ? "correctEvidenceRequired" : "correctEvidenceOptional")}
        </p>
        <EvidenceUpload ids={evidence} onChange={setEvidence} onReady={onReady} />
        <p className="trip-correction-effective" role="note">
          {t("correctEffective")}
        </p>
        <Failure error={command.failure} seconds={command.seconds} />
        {touched && !Object.keys(changes).length && (
          <p className="trip-muted" role="status">
            {t("correctNothing")}
          </p>
        )}
        <div className="trip-actions">
          <Button asChild variant="ghost">
            <Link to={back}>{t("correctCancel")}</Link>
          </Button>
          <Confirm
            label={t("correctSubmit")}
            variant="default"
            guard={JSON.stringify([etag, body])}
            disabled={blocked}
            pending={command.pending}
            failure={command.failure}
            onConfirm={async () => {
              if (!body) return;
              const result = await command.run(
                `/trips/${view.summary.id}/corrections`,
                body,
                "EnvelopeCommandResult",
                etag,
              );
              if (result) navigate(back);
              return result;
            }}
          >
            <p>{t("correctConfirmText")}</p>
            <dl className="trip-detail-kv">
              {correctionFields
                .filter((field) => changes[field] !== undefined)
                .map((field) => (
                  <div key={field}>
                    <dt>{t(`correctField_${field}`)}</dt>
                    <dd>
                      <CorrectionValue
                        field={field}
                        value={changes[field] as string}
                        game={view.summary.game}
                      />
                    </dd>
                  </div>
                ))}
            </dl>
            <p className="trip-detail-quote">{reason}</p>
          </Confirm>
        </div>
      </Card>
    </>
  );
}

/** "Telemetry: …" (or "Report: …") under a correctable fact: what the source reported. */
function ReportedHint({
  fact,
  manual,
  game,
  id,
}: {
  fact: CorrectionFact;
  manual: boolean;
  game: DTO["TripSummary"]["game"];
  id: string;
}) {
  const { t } = useTranslation("trips");
  const text = (value: ReactNode) => (
    <>
      {t(manual ? "correctReported" : "correctTelemetry")} {value}
    </>
  );
  return (
    <small id={id} className="trip-muted trip-correction-was">
      {fact.reported
        ? text(<CorrectionValue field={fact.field} value={fact.reported} game={game} />)
        : fact.sourceCode
          ? t("correctTelemetryCode", { code: fact.sourceCode })
          : t(manual ? "correctReportedNone" : "correctTelemetryNone")}
    </small>
  );
}

function CorrectionInput({
  fact,
  manual,
  game,
  value,
  error,
  timezone,
  noteId,
  onChange,
}: {
  fact: CorrectionFact;
  manual: boolean;
  game: DTO["TripSummary"]["game"];
  value: string;
  error: string | undefined;
  timezone: string;
  noteId: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation("trips"),
    { field } = fact,
    id = `correction-${field}`,
    hintId = `${id}-was`,
    errorId = `${id}-error`,
    describedBy = error ? `${hintId} ${errorId}` : hintId,
    title = t(`correctField_${field}`),
    hint = <ReportedHint fact={fact} manual={manual} game={game} id={hintId} />;
  if (isCatalogField(field))
    return (
      <div className="field trip-correction-field" data-field={field}>
        <CatalogSelector
          label={title}
          game={game}
          kind={catalogKinds[field]}
          value={value || null}
          onChange={(next) => onChange(next ?? "")}
        />
        {hint}
      </div>
    );
  if (isTimeField(field))
    return (
      <div className="field trip-correction-field" data-field={field}>
        <Label htmlFor={id}>{title}</Label>
        <DateTimeField
          id={id}
          fieldName={title}
          value={value}
          timeZone={timezone}
          invalid={!!error}
          aria-describedby={`${describedBy} ${noteId}`}
          onChange={onChange}
        />
        {hint}
        <FieldError id={errorId}>{error && t(error)}</FieldError>
      </div>
    );
  return (
    <div className="field trip-correction-field" data-field={field}>
      <Label htmlFor={id}>{title}</Label>
      <Input
        id={id}
        inputMode="decimal"
        maxLength={64}
        value={value}
        aria-invalid={!!error || undefined}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint}
      <FieldError id={errorId}>{error && t(error)}</FieldError>
    </div>
  );
}

/** The facts the author cannot change, collapsed and read-only. */
function LockedFacts({
  view,
  editable,
}: {
  view: DTO["TripPrivate"];
  editable: readonly CorrectionField[];
}) {
  const { t } = useTranslation("trips"),
    { locale } = useTripDisplay(),
    facts = view.effectiveFacts,
    summary = view.summary,
    rows: { field: CorrectionField; value: ReactNode }[] = [];
  const add = (field: CorrectionField, value: ReactNode) => {
    if (!editable.includes(field)) rows.push({ field, value });
  };
  add("actualDistanceM", formatQuantity(summary.actualDistanceM, "km", locale));
  if (facts?.actualStartAt)
    add(
      "actualStartAt",
      <CorrectionValue field="actualStartAt" value={facts.actualStartAt} game={summary.game} />,
    );
  if (facts?.actualCompletedAt)
    add(
      "actualCompletedAt",
      <CorrectionValue
        field="actualCompletedAt"
        value={facts.actualCompletedAt}
        game={summary.game}
      />,
    );
  add("originCityId", <CatalogName value={summary.origin} />);
  add("destinationCityId", <CatalogName value={summary.destination} />);
  add("cargoId", <CatalogName value={summary.cargo} />);
  if (facts?.cargoMassKg) add("cargoMassKg", formatQuantity(facts.cargoMassKg, "t", locale));
  return (
    <Card className="stack trip-correction-locked">
      <details>
        <summary>
          <Lock size={13} strokeWidth={1.8} aria-hidden="true" focusable="false" />{" "}
          {t("correctLocked", { count: rows.length })}
        </summary>
        {rows.length ? (
          <dl className="trip-detail-kv">
            {rows.map(({ field, value }) => (
              <div key={field}>
                <dt>{t(`correctField_${field}`)}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="trip-muted">{t("correctLockedNone")}</p>
        )}
      </details>
    </Card>
  );
}
