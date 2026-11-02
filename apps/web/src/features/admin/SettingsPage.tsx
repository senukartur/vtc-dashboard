import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { formatUtc } from "../../shared/formatting.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "../../shared/ui/dialog.js";
import { Badge, Button, Card, Input, Label, Select } from "../../shared/ui/primitives.js";
import {
  CommandFeedback,
  Confirmation,
  Pager,
  Permission,
  QueryState,
  WorkspaceHeading,
} from "./components.js";
import {
  countdown,
  leadershipView,
  type ReadinessItem,
  readinessItems,
  secondsUntil,
  sourceBadges,
} from "./settings-model.js";
import { type DTO, useWorkspaceCommand, useWorkspaceQuery } from "./transport.js";
import "./settings.css";

type Command = ReturnType<typeof useWorkspaceCommand>;

function TimezoneEditor({
  data,
  etag,
  command,
}: {
  data: DTO["CompanySettings"];
  etag: string | null;
  command: Command;
}) {
  const { t } = useTranslation("administration"),
    session = useSession(),
    [timezone, setTimezone] = useState(data.reportingTimezone ?? "");
  const [reviewedEtag] = useState(etag);
  const stale = reviewedEtag !== etag;
  const valid = (() => {
    try {
      if (!timezone.trim() || !/^[A-Za-z][A-Za-z0-9_+/-]*$/.test(timezone)) return false;
      new Intl.DateTimeFormat("en", { timeZone: timezone });
      return true;
    } catch {
      return false;
    }
  })();
  const set = !!data.reportingTimezone;
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <div className="settings-title-line">
          <Label className="settings-row-title" htmlFor="company-timezone">
            {t("reportingTimezone")}
          </Label>
          <Badge size="xs" className={`settings-tone-${set ? "accepted" : "pending"}`}>
            <span aria-hidden="true">{set ? "✓" : "●"}</span>
            {t(set ? "settingsUi.set" : "settingsUi.notSet")}
          </Badge>
        </div>
        <p id="company-timezone-help" className="muted">
          {t("settingsUi.timezoneRowHelp")}
        </p>
        <p className="muted">
          {t("personalTimezone", { timezone: session.self?.preferences.displayTimezone })}
        </p>
      </div>
      <div className="settings-row-control">
        <Input
          id="company-timezone"
          placeholder="Europe/Warsaw"
          autoComplete="off"
          maxLength={128}
          value={timezone}
          aria-describedby="company-timezone-help"
          disabled={command.held || command.pending}
          onChange={(e) => setTimezone(e.target.value)}
        />
        <Confirmation
          label={t("saveTimezone")}
          description={t("timezoneHelp")}
          busy={command.pending}
          variant="default"
          disabled={!valid || command.seconds > 0 || command.held || stale}
          confirm={async () =>
            !!(await command.run(
              "/admin/company-settings",
              "EnvelopeCompanySettings",
              { reportingTimezone: timezone },
              reviewedEtag,
              "PATCH",
            ))
          }
        >
          <p className="settings-dialog">{timezone}</p>
        </Confirmation>
      </div>
      {stale && (
        <div className="settings-row-wide stack">
          <p role="alert">{t("errors.conflict")}</p>
          <Button
            variant="outline"
            disabled={command.held || command.pending}
            onClick={() => void command.refresh("/admin/company-settings")}
          >
            {t("refresh")}
          </Button>
        </div>
      )}
      {command.held && (
        <div className="settings-row-wide">
          <Button
            disabled={command.pending || command.seconds > 0}
            onClick={() =>
              void command.run(
                "/admin/company-settings",
                "EnvelopeCompanySettings",
                undefined,
                reviewedEtag,
                "PATCH",
              )
            }
          >
            {t("refresh")}
          </Button>
        </div>
      )}
    </div>
  );
}
function readinessLabel(
  item: ReadinessItem,
  timezone: string | null,
  t: ReturnType<typeof useTranslation<"administration">>["t"],
) {
  if (!item.known) return t("settingsUi.unknownMissing");
  if (item.code === "company_reporting_timezone")
    return item.ok ? t("settingsUi.timezoneOk", { timezone }) : t("settingsUi.timezoneMissing");
  return t(item.ok ? "settingsUi.qualificationsOk" : "settingsUi.qualificationsMissing");
}
/** Reporting readiness only; it never claims launch readiness. Not a live region. */
function Readiness({ data }: { data: DTO["CompanySettings"] }) {
  const { t } = useTranslation("administration");
  const items = readinessItems(data);
  return (
    <section
      className={`card settings-readiness settings-readiness-${data.launchReady ? "ready" : "pending"}`}
      aria-labelledby="settings-readiness-title"
    >
      <h2 id="settings-readiness-title">
        {t(data.launchReady ? "settingsUi.readyTitle" : "settingsUi.notReadyTitle")}
      </h2>
      <ul className="settings-checks">
        {items.map((item) => (
          <li key={item.code}>
            <span
              aria-hidden="true"
              className={`settings-tone-${item.ok ? "accepted" : "pending"}`}
            >
              {item.ok ? "✓" : "✕"}
            </span>
            {readinessLabel(item, data.reportingTimezone, t)}
          </li>
        ))}
      </ul>
      <p className="muted">{t("settingsUi.readinessNote")}</p>
    </section>
  );
}
function Sources() {
  const { t } = useTranslation("administration"),
    sources = useWorkspaceQuery("/admin/source-capabilities", "EnvelopeSourceCapabilities");
  const list = sources.data?.data.data.sources;
  return (
    <Card className="settings-sources" aria-labelledby="settings-sources-title">
      <h2 id="settings-sources-title">{t("sources")}</h2>
      <QueryState pending={sources.isPending} error={sources.isError} retry={sources.refetch} />
      {list && (
        <ul className="settings-source-list">
          {list.map((source) => {
            const badges = sourceBadges(source),
              live = badges.runtime === "enabled";
            return (
              <li key={source.provider} className="settings-source">
                <div className="settings-row-text">
                  <p className="settings-row-title">{t(source.provider)}</p>
                  <p className="muted">{t(`settingsUi.sourceNote.${source.provider}`)}</p>
                </div>
                <div className="settings-badges">
                  <Badge
                    size="xs"
                    className={`settings-tone-${badges.implemented === "implemented" ? "accepted" : "neutral"}`}
                  >
                    {t(`settingsUi.sourceState.${badges.implemented}`)}
                  </Badge>
                  <Badge size="xs" className={`settings-tone-${live ? "accepted" : "neutral"}`}>
                    {t(`settingsUi.sourceState.${badges.runtime}`)}
                  </Badge>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="muted">{t("sourceHelp")}</p>
    </Card>
  );
}
function Audit() {
  const { t, i18n } = useTranslation("administration"),
    session = useSession(),
    [cursor, setCursor] = useState<string | null>(null),
    query = useWorkspaceQuery(
      `/admin/audit?limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      "EnvelopeListAuditEntry",
    );
  const locale = i18n.resolvedLanguage === "en" ? "en" : "ru",
    timezone = session.self?.preferences.displayTimezone ?? "UTC",
    items = query.data?.data.data.items;
  return (
    <Card className="settings-audit">
      <div className="settings-section-head">
        <h2>{t("audit")}</h2>
        <p className="muted">{t("settingsUi.auditTimes", { timezone })}</p>
      </div>
      <QueryState
        pending={query.isPending}
        error={query.isError}
        retry={query.refetch}
        empty={items?.length === 0}
      />
      {!!items?.length && (
        // biome-ignore lint/a11y/noNoninteractiveTabindex: This named overflow region needs focus for native keyboard scrolling.
        <section className="admin-table-scroll" aria-label={t("audit")} tabIndex={0}>
          <table className="admin-safe-table admin-audit-table settings-audit-table">
            <thead>
              <tr>
                <th scope="col">{t("settingsUi.colTime")}</th>
                <th scope="col">{t("actor")}</th>
                <th scope="col">{t("action")}</th>
                <th scope="col">{t("subject")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id}>
                  <td>
                    <time dateTime={row.occurredAt}>
                      {formatUtc(row.occurredAt, locale, timezone)}
                    </time>
                  </td>
                  <td>
                    {row.actorId ? (
                      <span className="admin-id settings-break">{row.actorId}</span>
                    ) : (
                      t("system")
                    )}
                  </td>
                  <td>
                    {t(`auditActions.${row.action.replaceAll(".", "_")}`, {
                      defaultValue: t("auditUnknown"),
                    })}
                  </td>
                  <td>
                    <span className="admin-id settings-break">{row.subjectId}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <div className="settings-audit-foot">
        <p className="muted">{t("settingsUi.auditFootnote")}</p>
        <Pager cursor={cursor} next={query.data?.data.data.nextCursor} setCursor={setCursor} />
      </div>
    </Card>
  );
}
/** Command outcome without a ticking live region: the wait is plain text. */
function LeadershipFeedback({
  command,
  codeCommand = false,
  showWait = false,
}: {
  command: Command;
  codeCommand?: boolean;
  showWait?: boolean;
}) {
  const { t } = useTranslation("administration");
  const kind = command.failure?.kind;
  return (
    <>
      {command.pending && <p role="status">{t("working")}</p>}
      {kind && (
        <p role="alert">
          {codeCommand && kind === "unauthorized"
            ? t("settingsUi.codeRejected")
            : t(`errors.${kind}`)}
        </p>
      )}
      {command.held && <p className="muted">{t("frozen")}</p>}
      {showWait && command.seconds > 0 && (
        <p className="muted">{t("settingsUi.waitTime", { time: countdown(command.seconds) })}</p>
      )}
    </>
  );
}
/** One-second clock that runs only while `activeAt(now)` holds; the server values stay authoritative. */
function useClock(activeAt: (now: number) => boolean) {
  const [now, setNow] = useState(() => Date.now());
  const active = activeAt(now);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}
function successorLabel(
  member: DTO["MemberSummary"],
  t: ReturnType<typeof useTranslation<"administration">>["t"],
) {
  return member.roles.length
    ? `${member.nickname} · ${member.roles.map((role) => t(role)).join(", ")}`
    : member.nickname;
}
function TransferFlow() {
  const { t } = useTranslation("administration"),
    session = useSession(),
    location = useLocation(),
    navigate = useNavigate(),
    request = useWorkspaceCommand(),
    confirm = useWorkspaceCommand(),
    [cursor, setCursor] = useState<string | null>(null),
    [successorId, setSuccessorId] = useState(""),
    [changing, setChanging] = useState(false),
    [shown, setShown] = useState<DTO["PendingLeadershipChallenge"] | null>(null),
    [code, setCode] = useState(""),
    [open, setOpen] = useState(false),
    [seenRefusal, setSeenRefusal] = useState(false),
    [focusCode, setFocusCode] = useState(0),
    codeInput = useRef<HTMLInputElement>(null),
    state = useWorkspaceQuery("/admin/leadership/challenge", "EnvelopeLeadershipChallengeState"),
    members = useWorkspaceQuery(
      `/admin/members?status=active&limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      "EnvelopeListMemberAdmin",
    );
  const data = state.data?.data.data,
    pending = data?.pending ?? null,
    resendAt = data?.resendAvailableAt ?? null;
  // Remember the code this page shows, so a code the server stops reporting is explained.
  if (pending && pending.id !== shown?.id) setShown(pending);
  // A settled refusal closes the dialog once the command ends, so focus returns to an enabled
  // trigger; held (uncertain, unavailable, limited) outcomes stay in the dialog for a retry.
  const refused = !!confirm.failure && !confirm.held && !confirm.pending;
  if (refused !== seenRefusal) {
    setSeenRefusal(refused);
    if (refused) setOpen(false);
  }
  const now = useClock((at) => !!pending || secondsUntil(resendAt, at) > 0);
  const view = leadershipView({
    pending,
    requested: !!shown,
    changing,
    resendAvailableAt: resendAt,
    requestSeconds: request.seconds,
    now,
  });
  useEffect(() => {
    if (focusCode) codeInput.current?.focus();
  }, [focusCode]);
  const items =
    members.data?.data.data.items
      .map((row) => row.profile.member)
      .filter((member) => member.id !== session.self?.member.id) ?? [];
  const current = pending ?? shown,
    busy = request.pending || confirm.pending;
  async function requestCode(id: string) {
    const result = await request.run(
      "/admin/leadership/challenges",
      "EnvelopeChallenge",
      { successorId: id },
      null,
      "POST",
      false,
    );
    if (result) {
      // The code step and focus show the outcome; no lingering committed status.
      request.dismiss();
      confirm.dismiss();
      setCode("");
      await state.refetch();
      setChanging(false);
      setFocusCode((value) => value + 1);
    } else void state.refetch();
  }
  async function transfer() {
    if (!current) return;
    const nickname = current.successor.nickname;
    const result = await confirm.run(
      "/admin/leadership/transfers",
      "EnvelopeCommandResult",
      { challengeId: current.id, code },
      null,
      "POST",
      false,
    );
    if (result) {
      setCode("");
      setOpen(false);
      // Only the public nickname is kept in history state for the notice after access changes.
      navigate(
        { pathname: location.pathname, search: location.search, hash: location.hash },
        { replace: true, state: { leadershipTransferredTo: nickname } },
      );
      session.changed();
    } else void state.refetch();
  }
  const resendDescription =
    view.resendIn > 0 ? (
      <p id="leadership-resend" className="muted">
        {t("settingsUi.resendIn", { time: countdown(view.resendIn) })}
      </p>
    ) : null;
  const timing = view.gone
    ? t("settingsUi.codeGone")
    : view.expired
      ? t("settingsUi.codeExpired")
      : [
          t("settingsUi.expiresIn", { time: countdown(view.expiresIn) }),
          t("settingsUi.attemptsLeft", { count: view.attemptsLeft ?? 0 }),
          view.resendIn > 0
            ? t("settingsUi.newCodeIn", { time: countdown(view.resendIn) })
            : t("settingsUi.canResend"),
        ].join(" · ");
  return (
    <>
      <QueryState pending={state.isPending} error={state.isError} retry={state.refetch} />
      {data && (
        <>
          <ol className="settings-steps" aria-label={t("settingsUi.steps")}>
            <li aria-current={view.step === "successor" ? "step" : undefined}>
              {t("settingsUi.stepSuccessor")}
            </li>
            <li aria-current={view.step === "code" ? "step" : undefined}>
              {t("settingsUi.stepCode")}
            </li>
          </ol>
          {view.step === "successor" || !current ? (
            <div className="settings-step stack">
              <div className="settings-field">
                <Label htmlFor="leadership-successor">{t("successor")}</Label>
                <Select
                  id="leadership-successor"
                  value={successorId}
                  disabled={busy}
                  onChange={(e) => {
                    request.dismiss();
                    setSuccessorId(e.target.value);
                  }}
                >
                  <option value="">{t("settingsUi.choose")}</option>
                  {items.map((member) => (
                    <option key={member.id} value={member.id}>
                      {successorLabel(member, t)}
                    </option>
                  ))}
                </Select>
              </div>
              <QueryState
                pending={members.isPending}
                error={members.isError}
                retry={members.refetch}
                empty={!!members.data && !items.length}
              />
              <Pager
                cursor={cursor}
                next={members.data?.data.data.nextCursor}
                setCursor={(value) => {
                  request.dismiss();
                  setSuccessorId("");
                  setCursor(value);
                }}
              />
              <ul className="settings-points">
                <li>{t("settingsUi.consequenceDriver")}</li>
                <li>{t("settingsUi.consequenceEmail")}</li>
              </ul>
              <Button
                className="settings-wide-button"
                disabled={busy || !successorId || !view.canRequest}
                aria-describedby={resendDescription ? "leadership-resend" : undefined}
                onClick={() => void requestCode(successorId)}
              >
                {t("requestCode")}
              </Button>
              {resendDescription}
              <LeadershipFeedback command={request} />
            </div>
          ) : (
            <div className="settings-step stack">
              <p>{t("settingsUi.codeIntro", { nickname: current.successor.nickname })}</p>
              <div className="settings-field">
                <Label htmlFor="leadership-code">{t("transferCode")}</Label>
                <Input
                  ref={codeInput}
                  id="leadership-code"
                  type="password"
                  autoComplete="off"
                  maxLength={128}
                  value={code}
                  disabled={confirm.held || !view.codeUsable}
                  aria-describedby="leadership-code-timing"
                  onChange={(e) => setCode(e.target.value)}
                />
                <p id="leadership-code-timing" className="muted">
                  {timing}
                </p>
              </div>
              <div className="admin-actions">
                <Dialog
                  open={open}
                  onOpenChange={(value) => {
                    if (busy) return;
                    // A held attempt keeps its frozen request; a settled failure is cleared.
                    if (value && !confirm.held) confirm.dismiss();
                    setOpen(value);
                  }}
                >
                  <DialogTrigger asChild>
                    <Button
                      className="settings-danger"
                      disabled={busy || !code || !view.codeUsable}
                    >
                      {t("settingsUi.transferButton")}
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <div className="settings-dialog">
                      <DialogTitle>
                        {t("settingsUi.dialogTitle", { nickname: current.successor.nickname })}
                      </DialogTitle>
                      <DialogDescription>
                        {t("settingsUi.dialogBody", { nickname: current.successor.nickname })}
                      </DialogDescription>
                      <p className="admin-id settings-break">{current.successor.id}</p>
                      <ul className="settings-points">
                        <li>{t("settingsUi.dialogPointDriver")}</li>
                        <li>{t("settingsUi.dialogPointBack")}</li>
                        <li>{t("settingsUi.dialogPointAudit")}</li>
                      </ul>
                      {open && <LeadershipFeedback command={confirm} codeCommand showWait />}
                      <div className="button-row">
                        <Button
                          className="settings-danger-solid"
                          disabled={busy || confirm.seconds > 0}
                          onClick={() => void transfer()}
                        >
                          {t("confirm")}
                        </Button>
                        <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
                          {t("cancel")}
                        </Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
                <Button
                  variant="outline"
                  disabled={busy || !view.canRequest}
                  aria-describedby={resendDescription ? "leadership-resend" : undefined}
                  onClick={() => void requestCode(current.successor.id)}
                >
                  {t("settingsUi.resend")}
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    request.dismiss();
                    confirm.dismiss();
                    setCode("");
                    setSuccessorId("");
                    setChanging(true);
                  }}
                >
                  {t("settingsUi.changeSuccessor")}
                </Button>
              </div>
              {resendDescription}
              {!open && <LeadershipFeedback command={confirm} codeCommand showWait />}
              <LeadershipFeedback command={request} />
              <p className="muted">{t("settingsUi.policy")}</p>
            </div>
          )}
        </>
      )}
    </>
  );
}
/** Rendered only for the serving director (`leadership.transfer`). */
function Leadership() {
  const { t } = useTranslation("administration"),
    session = useSession(),
    verified = !!session.self?.emailVerified;
  return (
    <aside className="card settings-leadership" aria-labelledby="settings-leadership-title">
      <div className="settings-leadership-head">
        <div className="settings-title-line">
          <h2 id="settings-leadership-title">{t("transfer")}</h2>
          <Badge size="xs" className="settings-tone-pending">
            {t("settingsUi.directorOnly")}
          </Badge>
        </div>
        <p className="muted">{t("settingsUi.oneDirector")}</p>
      </div>
      {verified ? (
        <TransferFlow />
      ) : (
        <div className="settings-step stack">
          <p>{t("verifyEmailFirst")}</p>
          <Button asChild variant="outline" className="settings-wide-button">
            <Link to="/account/security">{t("settingsUi.securityLink")}</Link>
          </Button>
        </div>
      )}
      <div className="settings-footer stack">
        <p className="muted">{t("settingsUi.footer")}</p>
        {verified && (
          <Button asChild variant="ghost" className="settings-link">
            <Link to="/account/security">{t("settingsUi.securityLink")}</Link>
          </Button>
        )}
      </div>
    </aside>
  );
}
function Settings() {
  const { t } = useTranslation("administration"),
    session = useSession(),
    command = useWorkspaceCommand(),
    settings = useWorkspaceQuery("/admin/company-settings", "EnvelopeCompanySettings"),
    data = settings.data?.data.data;
  const qualificationsReady = data && !data.missingSetup.includes("qualification_configuration");
  return (
    <div className="administration-page settings-page stack">
      <div className="settings-heading">
        <WorkspaceHeading title={t("settings")} />
        <p className="muted">{t("settingsUi.subtitle")}</p>
      </div>
      <div className="settings-layout">
        <div className="settings-main stack">
          {data && <Readiness data={data} />}
          <Card className="settings-reporting" aria-labelledby="settings-reporting-title">
            <h2 id="settings-reporting-title">{t("settingsUi.reportingTitle")}</h2>
            <CommandFeedback command={command} />
            <QueryState
              pending={settings.isPending}
              error={settings.isError}
              retry={settings.refetch}
            />
            {data && (
              <TimezoneEditor data={data} etag={settings.data?.etag ?? null} command={command} />
            )}
            <div className="settings-row">
              <div className="settings-row-text">
                <div className="settings-title-line">
                  <h3 className="settings-row-title">{t("settingsUi.qualificationsTitle")}</h3>
                  {data && (
                    <Badge
                      size="xs"
                      className={`settings-tone-${qualificationsReady ? "accepted" : "pending"}`}
                    >
                      <span aria-hidden="true">{qualificationsReady ? "✓" : "●"}</span>
                      {t(
                        qualificationsReady ? "settingsUi.configured" : "settingsUi.notConfigured",
                      )}
                    </Badge>
                  )}
                </div>
                <p className="muted">{t("settingsUi.qualificationsHelp")}</p>
              </div>
              <div className="settings-row-control">
                <Button asChild variant="outline">
                  <Link to="/account/qualifications">{t("qualificationWorkspace")}</Link>
                </Button>
              </div>
            </div>
          </Card>
          <Sources />
          <Audit />
        </div>
        {session.self?.capabilities.includes("leadership.transfer") && <Leadership />}
      </div>
    </div>
  );
}
function transferredTo(state: unknown): string | null {
  if (!state || typeof state !== "object" || !("leadershipTransferredTo" in state)) return null;
  const value = state.leadershipTransferredTo;
  return typeof value === "string" && value ? value : null;
}
export function SettingsPage() {
  const { t } = useTranslation("administration"),
    location = useLocation(),
    navigate = useNavigate(),
    nickname = transferredTo(location.state),
    notice = useRef<HTMLParagraphElement>(null);
  // The transfer ends this member's access; the notice survives the session remount.
  useEffect(() => {
    if (nickname) notice.current?.focus();
  }, [nickname]);
  return (
    <>
      {nickname && (
        <div className="card settings-transferred">
          <p ref={notice} role="status" tabIndex={-1}>
            <span aria-hidden="true">✓ </span>
            {t("settingsUi.transferred", { nickname })}
          </p>
          <Button
            variant="outline"
            onClick={() =>
              navigate(
                { pathname: location.pathname, search: location.search, hash: location.hash },
                { replace: true, state: null },
              )
            }
          >
            {t("settingsUi.dismiss")}
          </Button>
        </div>
      )}
      <Permission capability="company.configure">
        <Settings />
      </Permission>
    </>
  );
}
