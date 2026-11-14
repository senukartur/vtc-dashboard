import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { cityNameText } from "../../shared/catalog-selectors/native-name.js";
import { decodeIncomplete } from "../../shared/ui/date-time.js";
import { Button, Card, Input, Label } from "../../shared/ui/primitives.js";
import { Confirm, Failure, Fields, State } from "../trips/components.js";
import { useTripCommand, useTripQuery } from "../trips/queries.js";
import {
  canonicalDecimal,
  type DTO,
  revisionFields,
  schema,
  TripFailure,
  validId,
} from "../trips/transport.js";
import { DepotCompanyField, useDepotCompany } from "./DepotCompanyField.js";
import { DeleteDraft, draftsLocation } from "./Drafts.js";
import { EventSelect, EvidenceUpload, ManualCatalogField, ReferenceTimeField } from "./fields.js";
import {
  damagePercent,
  formatDamage,
  missingRequirements,
  type Requirement,
  submissionTimeErrors,
} from "./model.js";
import { displayTimezone, referenceInstant, referenceLocalValue } from "./reference-time.js";
import "../trips/trips.css";
import "./manual-reports.css";

export { ReportsPage } from "./Drafts.js";
export function ManualReportPage({ kind }: { kind: "new" | "draft" | "report" }) {
  const { t } = useTranslation("trips"),
    session = useSession(),
    { draftId, reportId } = useParams(),
    id = kind === "draft" ? draftId : reportId,
    valid = kind === "new" || validId(id),
    canSubmit = !!session.self?.capabilities.includes("trips.submit_own");
  const report = useTripQuery(
    `/manual-reports/${id}`,
    "EnvelopeManualReport",
    kind === "report" && valid && canSubmit,
  );
  const tripId = report.data?.data.data.tripId,
    trip = useTripQuery(`/trips/${tripId}`, "EnvelopeTripView", !!tripId),
    view = trip.data?.data.data,
    summary = view?.view === "private" ? view.summary : view;
  const title = t(kind === "report" ? "revise" : "newReport");
  if (!canSubmit || !session.self)
    return (
      <ReportFrame title={title}>
        <Card>
          <p>{t("forbidden")}</p>
        </Card>
      </ReportFrame>
    );
  if (!valid)
    return (
      <ReportFrame title={title}>
        <Card>
          <p>{t("notFound")}</p>
        </Card>
      </ReportFrame>
    );
  if (kind === "new") return <ManualEditor key="new" />;
  if (kind === "draft" && validId(draftId))
    return (
      <DraftEditorPage
        key={JSON.stringify([
          draftId,
          session.self.member.id,
          session.generation,
          session.self.identityEpoch,
        ])}
        id={draftId}
        title={title}
      />
    );
  if (!report.data || !summary)
    return (
      <ReportFrame title={title}>
        <Card>
          <State query={!report.data ? report : trip} />
        </Card>
      </ReportFrame>
    );
  if (summary.owner.id !== session.self.member.id)
    return (
      <ReportFrame title={title}>
        <Card>
          <p>{t("forbidden")}</p>
        </Card>
      </ReportFrame>
    );
  return (
    <ManualEditor
      key={id}
      report={report.data.data.data}
      reportEtag={report.data.etag}
      tripVersion={summary.version}
      accepted={summary.decision === "accepted"}
    />
  );
}
/** Shared page root and heading for the editor and every non-editor state. */
function ReportFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="stack trip-page manual-report">
      <header className="manual-report-header">
        <h1>{title}</h1>
      </header>
      {children}
    </div>
  );
}
type DraftSnapshot = { data: DTO["EnvelopeManualDraft"]; etag: string | null };
type DraftEditorState = {
  displayed: DraftSnapshot;
  writable: boolean;
  recovery: ReactNode;
  focusHeading: boolean;
  onConflict: () => void;
  onSaved: (snapshot: DraftSnapshot) => void;
};

function DraftEditorPage({ id, title }: { id: string; title: string }) {
  const { t } = useTranslation("trips");
  const query = useTripQuery(`/me/manual-drafts/${id}`, "EnvelopeManualDraft");
  const latest = query.data;
  // Background reads can block writes, but only a reload or our save receipt replaces the baseline.
  const [displayed, setDisplayed] = useState<DraftSnapshot | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const [conflict, setConflict] = useState(false);
  const recoveryAlert = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (!conflict) return;
    const frame = requestAnimationFrame(() => {
      if (document.activeElement === document.body) recoveryAlert.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [conflict]);
  const latestDraft = latest?.data.data;
  if (!displayed && latest && latestDraft?.state === "editing") setDisplayed(latest);

  if (latestDraft?.state === "submitted")
    return (
      <ReportFrame title={title}>
        <Card className="stack">
          <p role="status">{t("draftAlreadySubmitted")}</p>
          {latestDraft.submittedReportId && (
            <Button asChild>
              <Link to={`/account/reports/${latestDraft.submittedReportId}/edit`}>
                {t("viewReport")}
              </Link>
            </Button>
          )}
          <Link to={draftsLocation}>{t("backToDrafts")}</Link>
        </Card>
      </ReportFrame>
    );

  const error = query.error;
  const inaccessible =
    error instanceof TripFailure &&
    (error.kind === "unauthorized" ||
      error.kind === "forbidden" ||
      error.status === 404 ||
      error.status === 410);
  if (!displayed || inaccessible)
    return (
      <ReportFrame title={title}>
        <Card className="stack">
          <State query={query} />
          {query.isError && <Link to={draftsLocation}>{t("backToDrafts")}</Link>}
        </Card>
      </ReportFrame>
    );

  const changedVersion =
    latest &&
    (latest.etag !== displayed.etag || latest.data.data.version !== displayed.data.data.version);
  const needsReload = conflict || changedVersion || query.isError || !displayed.etag;
  async function reload() {
    if (query.isFetching) return;
    const refreshed = await query.refetch({ cancelRefetch: false });
    const result = refreshed.data;
    if (!refreshed.isSuccess || !result?.etag || result.data.data.state !== "editing") return;
    setDisplayed(result);
    setConflict(false);
    setEditorKey((previous) => previous + 1);
  }

  return (
    <ManualEditor
      key={editorKey}
      draftEditor={{
        displayed,
        writable: !!latest && !needsReload,
        onConflict: () => setConflict(true),
        onSaved: setDisplayed,
        focusHeading: editorKey > 0,
        recovery: needsReload && (
          <Card className="stack">
            <p ref={recoveryAlert} role="alert" tabIndex={-1} className="field-error">
              {t("draftReloadRequired")}
            </p>
            {query.isFetching && <p role="status">{t("loading")}</p>}
            <Failure error={error} />
            <Button
              type="button"
              variant="outline"
              disabled={query.isFetching}
              onClick={() => void reload()}
            >
              {t("reloadLatestDraft")}
            </Button>
          </Card>
        ),
      }}
    />
  );
}

function ManualEditor({
  draftEditor,
  report,
  reportEtag,
  tripVersion,
  accepted = false,
}: {
  draftEditor?: DraftEditorState;
  report?: DTO["ManualReport"];
  reportEtag?: string | null;
  tripVersion?: number;
  accepted?: boolean;
}) {
  const draft = draftEditor?.displayed.data.data;
  const draftEtag = draftEditor?.writable ? draftEditor.displayed.etag : null;
  const draftBlocked = !!draft && !draftEtag;
  const { t, i18n } = useTranslation("trips"),
    navigate = useNavigate(),
    location = useLocation(),
    session = useSession(),
    command = useTripCommand(),
    [initial] = useState<DTO["ManualDraftEditableFields"]>(() =>
      report ? revisionFields(report.currentRevision) : (draft?.fields ?? {}),
    ),
    [timezone] = useState(() => displayTimezone(session.self?.preferences.displayTimezone)),
    [fields, setFields] = useState(initial),
    [times, setTimes] = useState(() => ({
      startedAt: referenceLocalValue(initial.startedAt, timezone),
      completedAt: referenceLocalValue(initial.completedAt, timezone),
    })),
    [damage, setDamage] = useState(() =>
      initial.cargoDamagePercent === undefined
        ? ""
        : formatDamage(initial.cargoDamagePercent, "en"),
    ),
    [target, setTarget] = useState<DTO["ManualTelemetryTarget"] | null>(draft?.targetTrip ?? null),
    [ready, setReady] = useState(false),
    [invalid, setInvalid] = useState(false),
    // An incomplete time shows its error only once focus left that field or a save was tried.
    [timesLeft, setTimesLeft] = useState({ startedAt: false, completedAt: false }),
    [saved, setSaved] = useState(
      !draftEditor?.focusHeading && location.state?.manualDraftSaved === true,
    );
  const heading = useRef<HTMLHeadingElement>(null);
  const focusHeading = !!draftEditor?.focusHeading;
  useEffect(() => {
    if (focusHeading) heading.current?.focus();
  }, [focusHeading]);
  const game = fields.game ?? "ets2";
  // Telemetry targets list their routes in the interface language.
  const listLocale = i18n.resolvedLanguage === "en" ? "en" : "ru";
  const [cursor, setCursor] = useState<string | null>(null),
    targets = useTripQuery(
      `/trips?scope=mine&game=${game}&locale=${listLocale}&limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      "EnvelopeListTripSummary",
      !report,
    );
  const selectedTarget = useTripQuery(
    `/trips/${target?.tripId}`,
    "EnvelopeTripView",
    !!target && !report,
  );
  const selectedView = selectedTarget.data?.data.data,
    targetSummary = selectedView?.view === "private" ? selectedView.summary : selectedView;
  const changed = useCallback(() => {
    setInvalid(false);
    setSaved(false);
  }, []);
  function update<K extends keyof DTO["ManualDraftEditableFields"]>(
    name: K,
    value: DTO["ManualDraftEditableFields"][K],
  ) {
    setFields((prev) => {
      const next = { ...prev };
      if (value === undefined) delete next[name];
      else next[name] = value;
      return next;
    });
    changed();
  }
  const clearOriginCompany = useCallback(() => {
    setFields(({ originCompanyId: _, ...rest }) => rest);
    changed();
  }, [changed]);
  const clearDestinationCompany = useCallback(() => {
    setFields(({ destinationCompanyId: _, ...rest }) => rest);
    changed();
  }, [changed]);
  const originCompany = useDepotCompany(
    game,
    fields.origin,
    fields.originCompanyId,
    clearOriginCompany,
  );
  const destinationCompany = useDepotCompany(
    game,
    fields.destination,
    fields.destinationCompanyId,
    clearDestinationCompany,
  );
  const savedFields = draft?.fields ?? initial;
  const startedAt = referenceInstant(times.startedAt, timezone, savedFields.startedAt);
  const completedAt = referenceInstant(times.completedAt, timezone, savedFields.completedAt);
  const savedDamage = savedFields.cargoDamagePercent;
  const cargoDamagePercent =
    savedDamage !== undefined && damage === formatDamage(savedDamage, "en")
      ? savedDamage
      : damagePercent(damage);
  const timeErrors = submissionTimeErrors(startedAt, completedAt, Date.now());
  const startError = times.startedAt && !startedAt ? "referenceInvalid" : timeErrors.startedAt;
  const endError = times.completedAt && !completedAt ? "referenceInvalid" : timeErrors.completedAt;
  const shownTimeError = (name: "startedAt" | "completedAt") =>
    !timesLeft[name] && decodeIncomplete(times[name])
      ? undefined
      : name === "startedAt"
        ? startError
        : endError;
  const damageInvalid = damage !== "" && cargoDamagePercent === undefined;
  const companyPending = originCompany.blocked || destinationCompany.blocked;
  const partialInvalid =
    (!!times.startedAt && !startedAt) || (!!times.completedAt && !completedAt) || damageInvalid;

  const submission: DTO["ManualDraftEditableFields"] = {
    ...fields,
    game,
    ...(fields.cargoMassKg !== undefined
      ? { cargoMassKg: canonicalDecimal(fields.cargoMassKg) ?? fields.cargoMassKg }
      : {}),
    ...(fields.actualDistanceM !== undefined
      ? { actualDistanceM: canonicalDecimal(fields.actualDistanceM) ?? fields.actualDistanceM }
      : {}),
    comment: fields.comment?.trim() || null,
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(completedAt === undefined ? {} : { completedAt }),
    ...(cargoDamagePercent === undefined ? {} : { cargoDamagePercent }),
  };
  // References are derived from the controls. Empty inputs must clear any saved values.
  if (startedAt === undefined) delete submission.startedAt;
  if (completedAt === undefined) delete submission.completedAt;
  if (cargoDamagePercent === undefined) delete submission.cargoDamagePercent;
  async function save() {
    if (draftBlocked || companyPending) return;
    setTimesLeft({ startedAt: true, completedAt: true });
    const input: DTO["ManualDraftWriteInput"] = { fields: submission, targetTrip: target };
    if (partialInvalid || !schema("ManualDraftWriteInput").safeParse(input).success) {
      setInvalid(true);
      return;
    }
    const result = await command.run(
      draft ? `/me/manual-drafts/${draft.id}` : "/me/manual-drafts",
      input,
      "EnvelopeManualDraft",
      draftEtag,
      draft ? "PUT" : "POST",
    );
    if (result) {
      setSaved(true);
      if (draftEditor) draftEditor.onSaved(result);
      else
        navigate(`/account/reports/drafts/${result.data.data.id}`, {
          replace: true,
          state: { manualDraftSaved: true },
        });
    }
    return result;
  }
  const targetNeedsSave =
    !!draft &&
    (target?.tripId !== draft.targetTrip?.tripId ||
      target?.expectedVersion !== draft.targetTrip?.expectedVersion);
  const localIssues: Requirement[] = [];
  if (startError) localIssues.push("startedAt");
  if (endError) localIssues.push("completedAt");
  if (damageInvalid) localIssues.push("cargoDamagePercent");
  if (originCompany.blocked) localIssues.push("originCompanyId");
  if (destinationCompany.blocked) localIssues.push("destinationCompanyId");
  const missing = missingRequirements(submission, ready, localIssues),
    complete = missing.length === 0;
  const guard = JSON.stringify([
    submission,
    target,
    draft?.targetTrip,
    reportEtag,
    draftEtag,
    tripVersion,
    accepted,
  ]);
  const nextId = useId(),
    missingId = useId(),
    referenceNoteId = useId();
  return (
    <div className="stack trip-page manual-report">
      <header className="manual-report-header">
        <h1 ref={heading} tabIndex={focusHeading ? -1 : undefined}>
          {t(report ? "revise" : "newReport")}
        </h1>
        {report && <p className="muted">{t("pendingEdit")}</p>}
      </header>
      {(!command.pending || command.failure?.kind === "conflict") && draftEditor?.recovery}
      {accepted && report && (
        <Card className="stack">
          <p>{t("acceptedEdit")}</p>
          <Button asChild>
            <Link to={`/account/trips/${report.tripId}`}>{t("correction")}</Link>
          </Button>
        </Card>
      )}
      <div className="manual-report-layout">
        <form
          className="card manual-report-form"
          onSubmit={(e) => e.preventDefault()}
          aria-label={t("report")}
        >
          <fieldset disabled={accepted} className="trip-editor-body">
            <div className="manual-report-section manual-report-context">
              <div className="field">
                <Label htmlFor="manual-game">{t("game")}</Label>
                <select
                  id="manual-game"
                  className="input"
                  value={game}
                  disabled={!!report}
                  onChange={(e) => {
                    setFields({
                      game: e.target.value as "ets2" | "ats",
                      evidenceIds: fields.evidenceIds ?? [],
                      comment: fields.comment ?? null,
                    });
                    originCompany.clearNotice();
                    destinationCompany.clearNotice();
                    changed();
                    setTarget(null);
                    setCursor(null);
                  }}
                >
                  <option value="ets2">ETS2</option>
                  <option value="ats">ATS</option>
                </select>
              </div>
            </div>
            <div className="manual-report-section manual-report-fields">
              {(["origin", "destination"] as const).map((name) => {
                const companyName = name === "origin" ? "originCompanyId" : "destinationCompanyId";
                const choices = name === "origin" ? originCompany : destinationCompany;
                return (
                  <div className="manual-route-stop" key={name}>
                    <ManualCatalogField
                      name={name}
                      game={game}
                      value={fields[name]}
                      onChange={(value) => {
                        choices.clearNotice();
                        update(name, value);
                      }}
                    />
                    <DepotCompanyField
                      name={companyName}
                      value={fields[companyName]}
                      choices={choices}
                      onChange={(value) => update(companyName, value)}
                    />
                  </div>
                );
              })}
            </div>
            <div className="manual-report-section manual-report-fields">
              {(["cargo", "trailerType"] as const).map((name) => (
                <ManualCatalogField
                  key={name}
                  name={name}
                  game={game}
                  value={fields[name]}
                  onChange={(value) => update(name, value)}
                />
              ))}
              {(["cargoMassKg", "actualDistanceM"] as const).map((name) => (
                <div key={name} className="field">
                  <Label htmlFor={name}>{t(name)}</Label>
                  <Input
                    id={name}
                    inputMode="decimal"
                    aria-describedby={`${name}-help`}
                    value={fields[name] ?? ""}
                    maxLength={64}
                    onChange={(e) => update(name, e.target.value || undefined)}
                  />
                  <p id={`${name}-help`} className="manual-report-hint">
                    {t(name === "cargoMassKg" ? "cargoMassHelp" : "distanceHelp")}
                  </p>
                </div>
              ))}
            </div>
            <div className="manual-report-section manual-report-fields">
              <p id={referenceNoteId} className="manual-report-hint manual-reference-note">
                {t("referenceHelp", { timezone })}
              </p>
              {(["startedAt", "completedAt"] as const).map((name) => (
                <ReferenceTimeField
                  key={name}
                  name={name}
                  value={times[name]}
                  noteId={referenceNoteId}
                  timezone={timezone}
                  error={shownTimeError(name)}
                  onLeave={() =>
                    setTimesLeft((previous) =>
                      previous[name] ? previous : { ...previous, [name]: true },
                    )
                  }
                  onChange={(value) => {
                    setTimes((previous) => ({ ...previous, [name]: value }));
                    changed();
                  }}
                />
              ))}
              <div className="field">
                <Label htmlFor="cargoDamagePercent">{t("cargoDamagePercentOptional")}</Label>
                <Input
                  id="cargoDamagePercent"
                  inputMode="decimal"
                  maxLength={64}
                  value={damage}
                  aria-invalid={damageInvalid || undefined}
                  aria-describedby={damageInvalid ? "manual-damage-error" : undefined}
                  onChange={(event) => {
                    setDamage(event.target.value);
                    changed();
                  }}
                />
                {damageInvalid && (
                  <p id="manual-damage-error" className="field-error" role="alert">
                    {t("damageInvalid")}
                  </p>
                )}
              </div>
            </div>
            <div className="manual-report-section manual-report-fields">
              <EventSelect
                value={fields.eventId ?? null}
                onChange={(eventId) => update("eventId", eventId)}
                game={game}
              />
              <div className="field">
                <Label htmlFor="manual-comment">{t("comment")}</Label>
                <textarea
                  className="input"
                  id="manual-comment"
                  maxLength={4000}
                  value={fields.comment ?? ""}
                  onChange={(e) => update("comment", e.target.value || null)}
                />
              </div>
            </div>
            <div className="manual-report-section manual-report-evidence">
              <EvidenceUpload
                ids={fields.evidenceIds ?? []}
                onChange={(update) => {
                  setFields((previous) => ({
                    ...previous,
                    evidenceIds: update(previous.evidenceIds ?? []),
                  }));
                  changed();
                }}
                onReady={setReady}
              />
            </div>
            {!report && (
              <div className="manual-report-section manual-report-target">
                <Label htmlFor="manual-target">{t("target")}</Label>
                <p className="manual-report-hint">{t("targetHelp")}</p>
                <div className="manual-report-target-row">
                  <select
                    id="manual-target"
                    className="input"
                    value={target?.tripId ?? ""}
                    onChange={(e) => {
                      const item = targets.data?.data.data.items.find(
                        (t) => t.id === e.target.value,
                      );
                      setTarget(item ? { tripId: item.id, expectedVersion: item.version } : null);
                      changed();
                    }}
                  >
                    <option value="">{t("noTarget")}</option>
                    {target &&
                      !targets.data?.data.data.items.some((t) => t.id === target.tripId) && (
                        <option value={target.tripId}>
                          {target.tripId} · v{target.expectedVersion}
                        </option>
                      )}
                    {targets.data?.data.data.items
                      .filter(
                        (t) => t.sourceKinds.includes("ets2telemetry") && t.decision !== "accepted",
                      )
                      .map((trip) => (
                        <option key={trip.id} value={trip.id}>
                          {cityNameText(trip.origin, t("unknown"))} →{" "}
                          {cityNameText(trip.destination, t("unknown"))} · {trip.id} · v
                          {trip.version}
                        </option>
                      ))}
                  </select>
                  <div className="trip-actions">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setCursor(null);
                        if (target)
                          void selectedTarget.refetch().then((result) => {
                            const view = result.data?.data.data,
                              summary = view?.view === "private" ? view.summary : view;
                            if (
                              summary &&
                              summary.owner.id === session.self?.member.id &&
                              summary.game === game &&
                              summary.sourceKinds.includes("ets2telemetry")
                            )
                              setTarget({ tripId: summary.id, expectedVersion: summary.version });
                          });
                        else void targets.refetch();
                      }}
                    >
                      {t("targetRefresh")}
                    </Button>
                    {targets.data?.data.data.nextCursor && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setCursor(targets.data?.data.data.nextCursor ?? null)}
                      >
                        {t("next")}
                      </Button>
                    )}
                  </div>
                </div>
                {target && (
                  <Fields
                    values={{ target: target.tripId, targetVersion: target.expectedVersion }}
                  />
                )}
                <State query={targets} />
                {target && <State query={selectedTarget} />}
                {targetSummary?.decision === "accepted" && (
                  <p role="alert">
                    {t("acceptedTarget")}{" "}
                    <Link to={`/account/trips/${targetSummary.id}`}>{t("correction")}</Link>
                  </p>
                )}
              </div>
            )}
            <div className="manual-report-section manual-report-footer">
              {targetNeedsSave && <p role="status">{t("draftTargetSave")}</p>}
              {invalid && <p role="alert">{t("invalid")}</p>}
              <Failure
                error={
                  draftBlocked && command.failure?.kind === "conflict" ? null : command.failure
                }
                seconds={command.seconds}
              />
              {saved && <p role="status">{t("saved")}</p>}
              {!complete && !accepted && (
                <div className="manual-report-missing">
                  <p id={missingId}>{t("reportMissing")}</p>
                  <ul aria-labelledby={missingId}>
                    {missing.map((item) => (
                      <li key={item}>
                        {t(
                          item === "evidence"
                            ? "missingEvidence"
                            : item === "invalid"
                              ? "missingInvalid"
                              : item,
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="trip-actions manual-report-actions">
                {!report && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={
                      draftBlocked || companyPending || command.pending || command.seconds > 0
                    }
                    onClick={() => void save()}
                  >
                    {t("save")}
                  </Button>
                )}
                <Confirm
                  label={t(report ? "revise" : "submit")}
                  variant="default"
                  guard={guard}
                  pending={command.pending}
                  failure={command.failure}
                  disabled={
                    accepted ||
                    draftBlocked ||
                    targetNeedsSave ||
                    targetSummary?.decision === "accepted" ||
                    !complete ||
                    command.seconds > 0
                  }
                  onConfirm={async () => {
                    if (draftBlocked || targetNeedsSave || !complete) return;
                    const final = schema("ManualDatedSubmissionFields").safeParse(submission);
                    if (!final.success) return;
                    const body: DTO[
                      | "ManualReportResubmissionInput"
                      | "ManualDraftFinalSubmissionInput"
                      | "ManualReportCreationInput"] =
                      report && tripVersion !== undefined
                        ? { fields: final.data, expectedTripVersion: tripVersion }
                        : draft
                          ? { fields: final.data }
                          : { fields: final.data, targetTrip: target };
                    const path = report
                      ? `/manual-reports/${report.id}/revisions`
                      : draft
                        ? `/me/manual-drafts/${draft.id}/submission`
                        : "/manual-reports";
                    const result = await command.run(
                      path,
                      body,
                      "EnvelopeManualReport",
                      reportEtag ?? draftEtag,
                    );
                    if (result) navigate(`/account/trips/${result.data.data.tripId}`);
                    return result;
                  }}
                >
                  <p>{t("submitReview")}</p>
                  <Fields
                    values={{
                      game,
                      version: report?.version ?? draft?.version ?? null,
                      target: target?.tripId ?? t("noTarget"),
                      targetVersion: target?.expectedVersion ?? null,
                      reviewedRevisionId: report?.currentRevision.id ?? null,
                    }}
                  />
                </Confirm>
                {draft && draftEditor && (
                  <DeleteDraft
                    id={draft.id}
                    etag={draftEtag}
                    disabled={command.pending}
                    onConflict={draftEditor.onConflict}
                    onDeleted={() =>
                      navigate(draftsLocation, { replace: true, state: { draftDeleted: true } })
                    }
                  />
                )}
                <Button asChild variant="ghost">
                  <Link to={draft ? draftsLocation : "/account/trips"}>
                    {t(draft ? "backToDrafts" : "back")}
                  </Link>
                </Button>
              </div>
            </div>
          </fieldset>
        </form>
        <aside className="card manual-report-aside" aria-labelledby={nextId}>
          <h2 id={nextId}>{t("reportNextTitle")}</h2>
          <ol>
            {(["reportNext1", "reportNext2", "reportNext3", "reportNext4"] as const).map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ol>
        </aside>
      </div>
    </div>
  );
}
