import { type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { cityNameText } from "../../shared/catalog-selectors/native-name.js";
import { Button, Card, Input, Label } from "../../shared/ui/primitives.js";
import { Confirm, Failure, Fields, PageNav, State } from "../trips/components.js";
import { useTripCommand, useTripQuery } from "../trips/queries.js";
import { canonicalDecimal, type DTO, revisionFields, schema, validId } from "../trips/transport.js";
import { EventSelect, EvidenceUpload, ManualCatalogField } from "./fields.js";
import { missingRequirements } from "./model.js";
import "../trips/trips.css";
import "./manual-reports.css";
export function ReportsPage() {
  const [search] = useSearchParams();
  const editing = search.get("state") === "editing";
  return <DraftList key={editing ? "editing" : "all"} editing={editing} />;
}

function DraftList({ editing }: { editing: boolean }) {
  const { t } = useTranslation("trips"),
    session = useSession(),
    [cursor, setCursor] = useState<string | null>(null),
    [history, setHistory] = useState<string[]>([]),
    query = useTripQuery(
      `/me/manual-drafts?limit=25${editing ? "&state=editing" : ""}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      "EnvelopeListManualDraft",
      !!session.self?.capabilities.includes("trips.submit_own"),
    );
  if (!session.self?.capabilities.includes("trips.submit_own"))
    return (
      <Card>
        <p>{t("forbidden")}</p>
      </Card>
    );
  return (
    <div className="stack trip-page">
      <header className="trip-heading">
        <h1>{t(editing ? "editingDrafts" : "drafts")}</h1>
        <Button asChild>
          <Link to="/account/reports/new">{t("newReport")}</Link>
        </Button>
      </header>
      <Card className="stack">
        <State query={query} />
        {query.data && (
          <>
            {!query.data.data.data.items.length && <p>{t("empty")}</p>}
            {query.data.data.data.items.map((d) => (
              <article className="trip-row" key={d.id}>
                <Fields
                  values={{
                    game: d.fields.game ?? null,
                    version: d.version,
                    submittedAt: d.updatedAt,
                  }}
                />
                <Button asChild variant="outline">
                  <Link
                    to={
                      d.submittedReportId
                        ? `/account/reports/${d.submittedReportId}/edit`
                        : `/account/reports/drafts/${d.id}`
                    }
                  >
                    {t(d.submittedReportId ? "viewReport" : "useDraft")}
                  </Link>
                </Button>
              </article>
            ))}
            <PageNav
              next={query.data.data.data.nextCursor}
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
          </>
        )}
      </Card>
    </div>
  );
}
export function ManualReportPage({ kind }: { kind: "new" | "draft" | "report" }) {
  const { t } = useTranslation("trips"),
    session = useSession(),
    { draftId, reportId } = useParams(),
    id = kind === "draft" ? draftId : reportId,
    valid = kind === "new" || validId(id);
  const draft = useTripQuery(
      `/me/manual-drafts/${id}`,
      "EnvelopeManualDraft",
      kind === "draft" && valid,
    ),
    report = useTripQuery(
      `/manual-reports/${id}`,
      "EnvelopeManualReport",
      kind === "report" && valid,
    );
  const tripId = report.data?.data.data.tripId,
    trip = useTripQuery(`/trips/${tripId}`, "EnvelopeTripView", !!tripId),
    view = trip.data?.data.data,
    summary = view?.view === "private" ? view.summary : view;
  const title = t(kind === "report" ? "revise" : "newReport");
  if (!session.self?.capabilities.includes("trips.submit_own"))
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
  if (kind === "draft") {
    if (!draft.data)
      return (
        <ReportFrame title={title}>
          <Card>
            <State query={draft} />
          </Card>
        </ReportFrame>
      );
    if (draft.data.data.data.submittedReportId)
      return (
        <ReportFrame title={title}>
          <Card>
            <Button asChild>
              <Link to={`/account/reports/${draft.data.data.data.submittedReportId}/edit`}>
                {t("viewReport")}
              </Link>
            </Button>
          </Card>
        </ReportFrame>
      );
    return <ManualEditor key={id} draft={draft.data.data.data} draftEtag={draft.data.etag} />;
  }
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
function ManualEditor({
  draft,
  draftEtag,
  report,
  reportEtag,
  tripVersion,
  accepted = false,
}: {
  draft?: DTO["ManualDraft"];
  draftEtag?: string | null;
  report?: DTO["ManualReport"];
  reportEtag?: string | null;
  tripVersion?: number;
  accepted?: boolean;
}) {
  const { t } = useTranslation("trips"),
    navigate = useNavigate(),
    session = useSession(),
    command = useTripCommand(),
    initial = report ? revisionFields(report.currentRevision) : (draft?.fields ?? {}),
    [fields, setFields] = useState<DTO["ManualDraftFields"]>(initial),
    [target, setTarget] = useState<DTO["ManualTelemetryTarget"] | null>(draft?.targetTrip ?? null),
    [ready, setReady] = useState(false),
    [invalid, setInvalid] = useState(false),
    [saved, setSaved] = useState(false);
  const game = fields.game ?? "ets2";
  const [cursor, setCursor] = useState<string | null>(null),
    targets = useTripQuery(
      `/trips?scope=mine&game=${game}&limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
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
  function patch(value: Partial<DTO["ManualDraftFields"]>) {
    setFields((prev) => ({ ...prev, ...value }));
    setInvalid(false);
    setSaved(false);
  }
  const payload = () => ({
    ...fields,
    game,
    ...(fields.cargoMassKg !== undefined
      ? { cargoMassKg: canonicalDecimal(fields.cargoMassKg) ?? fields.cargoMassKg }
      : {}),
    ...(fields.actualDistanceM !== undefined
      ? { actualDistanceM: canonicalDecimal(fields.actualDistanceM) ?? fields.actualDistanceM }
      : {}),
    comment: fields.comment?.trim() || null,
  });
  async function save() {
    const input = { fields: payload(), targetTrip: target };
    if (!schema("ManualDraftInput").safeParse(input).success) {
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
      if (!draft) navigate(`/account/reports/drafts/${result.data.data.id}`, { replace: true });
    }
    return result;
  }
  const targetNeedsSave =
    !!draft &&
    (target?.tripId !== draft.targetTrip?.tripId ||
      target?.expectedVersion !== draft.targetTrip?.expectedVersion);
  const submission = payload(),
    complete = schema("ManualSubmissionFields").safeParse(submission).success && ready;
  const guard = JSON.stringify([
    submission,
    target,
    draft?.targetTrip,
    reportEtag,
    draftEtag,
    tripVersion,
    accepted,
  ]);
  const missing = complete ? [] : missingRequirements(submission, ready),
    nextId = useId(),
    missingId = useId();
  return (
    <div className="stack trip-page manual-report">
      <header className="manual-report-header">
        <h1>{t(report ? "revise" : "newReport")}</h1>
        <p className="muted">{t("noDate")}</p>
        {report && <p className="muted">{t("pendingEdit")}</p>}
      </header>
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
              {(["origin", "destination", "cargo", "trailerType"] as const).map((name) => (
                <ManualCatalogField
                  key={name}
                  name={name}
                  game={game}
                  value={fields[name]}
                  onChange={(value) => {
                    if (value) patch({ [name]: value });
                    else
                      setFields((prev) => {
                        const next = { ...prev };
                        delete next[name];
                        return next;
                      });
                  }}
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
                    onChange={(e) => {
                      if (e.target.value) patch({ [name]: e.target.value });
                      else
                        setFields((prev) => {
                          const next = { ...prev };
                          delete next[name];
                          return next;
                        });
                    }}
                  />
                  <p id={`${name}-help`} className="manual-report-hint">
                    {t(name === "cargoMassKg" ? "cargoMassHelp" : "distanceHelp")}
                  </p>
                </div>
              ))}
              <EventSelect
                value={fields.eventId ?? null}
                onChange={(eventId) => patch({ eventId })}
                game={game}
              />
              <div className="field">
                <Label htmlFor="manual-comment">{t("comment")}</Label>
                <textarea
                  className="input"
                  id="manual-comment"
                  maxLength={4000}
                  value={fields.comment ?? ""}
                  onChange={(e) => patch({ comment: e.target.value || null })}
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
                  setInvalid(false);
                  setSaved(false);
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
              <Failure error={command.failure} seconds={command.seconds} />
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
                    disabled={command.pending || command.seconds > 0}
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
                    targetNeedsSave ||
                    targetSummary?.decision === "accepted" ||
                    !complete ||
                    command.seconds > 0
                  }
                  onConfirm={async () => {
                    if (targetNeedsSave) return;
                    const body = report
                      ? { fields: submission, expectedTripVersion: tripVersion }
                      : draft
                        ? { fields: submission }
                        : { fields: submission, targetTrip: target };
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
                <Button asChild variant="ghost">
                  <Link to="/account/trips">{t("back")}</Link>
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
