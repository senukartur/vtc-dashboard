import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "../../shared/ui/dialog.js";
import { Badge, Button, Card, Input, Label, Select } from "../../shared/ui/primitives.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../shared/ui/tabs.js";
import { QualificationsPage } from "../qualifications/QualificationsPage.js";
import {
  CommandFeedback,
  Confirmation,
  Pager,
  Permission,
  QueryState,
  WorkspaceHeading,
} from "./components.js";
import { SettingsAudit } from "./SettingsAudit.js";
import {
  countdown,
  leadershipView,
  type ReadinessItem,
  readinessItems,
  secondsUntil,
  settingsTab,
  settingsTabs,
  sourceBadges,
  validReportingTimezone,
} from "./settings-model.js";
import { type DTO, useWorkspaceCommand, useWorkspaceQuery } from "./transport.js";
import "./settings.css";

type Command = ReturnType<typeof useWorkspaceCommand>;
type TransferConfirmation = {
  command: Command;
  submit: (challengeId: string, code: string, nickname: string) => Promise<boolean>;
};

function TimezoneEditor({
  data,
  etag,
  command,
  visible,
}: {
  data: DTO["CompanySettings"];
  etag: string | null;
  command: Command;
  visible: boolean;
}) {
  const { t } = useTranslation("administration"),
    session = useSession(),
    [timezone, setTimezone] = useState(data.reportingTimezone ?? "");
  const input = useRef<HTMLInputElement>(null);
  const [reviewedEtag] = useState(etag);
  const stale = reviewedEtag !== etag;
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
          ref={input}
          id="company-timezone"
          placeholder="Europe/Warsaw"
          autoComplete="off"
          maxLength={128}
          value={timezone}
          aria-describedby="company-timezone-help"
          disabled={command.held || command.pending}
          onChange={(e) => setTimezone(e.target.value)}
        />
        {visible && (
          <Confirmation
            label={t("saveTimezone")}
            description={t("timezoneHelp")}
            busy={command.pending}
            variant="default"
            restoreFocus={() => input.current}
            disabled={
              !validReportingTimezone(timezone) || command.seconds > 0 || command.held || stale
            }
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
        )}
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
function TransferFlow({
  visible,
  transferConfirmation,
}: {
  visible: boolean;
  transferConfirmation: TransferConfirmation;
}) {
  const { t } = useTranslation("administration"),
    session = useSession(),
    request = useWorkspaceCommand(),
    { command: confirm, submit } = transferConfirmation,
    [cursor, setCursor] = useState<string | null>(null),
    [successorId, setSuccessorId] = useState(""),
    [changing, setChanging] = useState(false),
    [shown, setShown] = useState<DTO["PendingLeadershipChallenge"] | null>(null),
    [code, setCode] = useState(""),
    [open, setOpen] = useState(false),
    [seenRefusal, setSeenRefusal] = useState(false),
    [focusCode, setFocusCode] = useState(0),
    [focusSuccessor, setFocusSuccessor] = useState(0),
    codeInput = useRef<HTMLInputElement>(null),
    successorSelect = useRef<HTMLSelectElement>(null),
    codeStep = useRef<HTMLDivElement>(null),
    resendButton = useRef<HTMLButtonElement>(null),
    timingText = useRef<HTMLParagraphElement>(null),
    usable = useRef(false),
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
  if (!visible && open) setOpen(false);
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
  useEffect(() => {
    if (focusSuccessor) successorSelect.current?.focus();
  }, [focusSuccessor]);
  // When the code stops being usable (used up, gone or expired) its input and Transfer button are
  // disabled. If focus was in the code step (or was lost with them), move it to Send a new code,
  // or to the explanation while a new code must still wait. Focus elsewhere is left alone.
  useEffect(() => {
    const was = usable.current;
    usable.current = view.codeUsable;
    if (!visible || !was || view.codeUsable || view.step !== "code") return;
    const active = document.activeElement;
    if (active && active !== document.body && !codeStep.current?.contains(active)) return;
    recoverFocus();
  });
  function recoverFocus() {
    if (resendButton.current && !resendButton.current.disabled) resendButton.current.focus();
    else timingText.current?.focus();
  }
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
    if (current && !(await submit(current.id, code, current.successor.nickname))) {
      void state.refetch();
    }
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
                  ref={successorSelect}
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
            <div ref={codeStep} className="settings-step stack">
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
                <p
                  ref={timingText}
                  id="leadership-code-timing"
                  className="muted settings-timing"
                  tabIndex={-1}
                >
                  {timing}
                </p>
              </div>
              <div className="admin-actions">
                <Dialog
                  open={visible && open}
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
                  <DialogContent
                    onCloseAutoFocus={(event) => {
                      if (!visible) {
                        event.preventDefault();
                        return;
                      }
                      // A trigger disabled meanwhile (expired or used-up code) cannot take focus.
                      if (view.codeUsable) return;
                      event.preventDefault();
                      recoverFocus();
                    }}
                  >
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
                  ref={resendButton}
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
                    // This button leaves with the code step; continue at the successor choice.
                    setFocusSuccessor((value) => value + 1);
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
function Leadership({
  visible,
  transferConfirmation,
}: {
  visible: boolean;
  transferConfirmation: TransferConfirmation;
}) {
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
        <p className="muted">{t("settingsUi.deputyAfterTransfer")}</p>
      </div>
      {verified ? (
        <TransferFlow visible={visible} transferConfirmation={transferConfirmation} />
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
function SettingsRestricted() {
  const { t } = useTranslation("administration");
  return (
    <Card className="settings-restricted">
      <h2>{t("permission")}</h2>
      <p>{t("settingsUi.sectionRestricted")}</p>
    </Card>
  );
}

function SettingsGeneral({
  visible,
  settings,
  transferConfirmation,
}: {
  visible: boolean;
  settings: ReturnType<typeof useWorkspaceQuery<"EnvelopeCompanySettings">>;
  transferConfirmation: TransferConfirmation;
}) {
  const { t } = useTranslation("administration"),
    session = useSession(),
    command = useWorkspaceCommand(),
    data = settings.data?.data.data;
  return (
    <div className="settings-layout">
      <div className="settings-main stack">
        <Card>
          <h2>{t("settingsUi.companyName")}</h2>
          <p>Yukon Union</p>
        </Card>
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
            <TimezoneEditor
              data={data}
              etag={settings.data?.etag ?? null}
              command={command}
              visible={visible}
            />
          )}
        </Card>
        {session.self?.capabilities.includes("connections.manage") ? (
          <Sources />
        ) : (
          <Card className="settings-sources">
            <h2>{t("sources")}</h2>
            <p>{t("settingsUi.sectionRestricted")}</p>
          </Card>
        )}
      </div>
      {session.self?.capabilities.includes("leadership.transfer") &&
        session.self.capabilities.includes("members.manage") && (
          <Leadership visible={visible} transferConfirmation={transferConfirmation} />
        )}
    </div>
  );
}

function SettingsQualificationLevels() {
  const session = useSession();
  return session.self?.capabilities.includes("qualifications.manage") ? (
    <QualificationsPage embedded />
  ) : (
    <SettingsRestricted />
  );
}

function Settings({ transferConfirmation }: { transferConfirmation: TransferConfirmation }) {
  const { t } = useTranslation("administration"),
    session = useSession(),
    location = useLocation(),
    navigate = useNavigate(),
    navigation = useNavigationType(),
    tab = settingsTab(new URLSearchParams(location.search).get("tab")),
    previousTab = useRef(tab),
    selectedTab = useRef<HTMLButtonElement>(null),
    lastFocused = useRef<HTMLElement | null>(null),
    [generalOpened, setGeneralOpened] = useState(tab === "general"),
    canReadAudit = !!session.self?.capabilities.includes("members.manage"),
    settings = useWorkspaceQuery(
      "/admin/company-settings",
      "EnvelopeCompanySettings",
      generalOpened || tab === "general" || (tab === "audit" && canReadAudit),
    );
  // General holds the timezone command and protected transfer flow for this page visit.
  if (tab === "general" && !generalOpened) setGeneralOpened(true);
  useEffect(() => {
    const changed = previousTab.current !== tab;
    previousTab.current = tab;
    if (!changed || navigation !== "POP") return;
    const active = document.activeElement;
    const previous = !active || active === document.body ? lastFocused.current : active;
    // A React portal (such as a confirmation dialog) also reports focus through the page.
    if (
      previous &&
      (!previous.isConnected ||
        previous.getClientRects().length === 0 ||
        previous.closest('[role="dialog"][data-state="closed"]'))
    ) {
      selectedTab.current?.focus();
    }
  }, [tab, navigation]);

  return (
    <div
      className="administration-page settings-page stack"
      onFocusCapture={(event) => {
        if (event.target instanceof HTMLElement) lastFocused.current = event.target;
      }}
    >
      <div className="settings-heading">
        <WorkspaceHeading title={t("settings")} />
      </div>
      <Tabs
        value={tab}
        activationMode="manual"
        onValueChange={(value) => {
          const params = new URLSearchParams(location.search);
          if (value === "general") params.delete("tab");
          else params.set("tab", value);
          navigate({ search: params.toString(), hash: location.hash });
        }}
      >
        <TabsList aria-label={t("settings")}>
          {settingsTabs.map((value) => (
            <TabsTrigger key={value} value={value} ref={value === tab ? selectedTab : undefined}>
              {t(`settingsUi.tabs.${value}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="general" forceMount hidden={tab !== "general"}>
          {(generalOpened || tab === "general") && (
            <SettingsGeneral
              visible={tab === "general"}
              settings={settings}
              transferConfirmation={transferConfirmation}
            />
          )}
        </TabsContent>
        <TabsContent value="qualifications">
          <SettingsQualificationLevels />
        </TabsContent>
        <TabsContent value="audit">
          {canReadAudit ? (
            <SettingsAudit
              reportingTimezone={settings.data?.data.data.reportingTimezone ?? null}
              timezonePending={settings.isPending}
            />
          ) : (
            <SettingsRestricted />
          )}
        </TabsContent>
      </Tabs>
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
    session = useSession(),
    location = useLocation(),
    navigate = useNavigate(),
    currentLocation = useRef<typeof location | null>(null),
    confirmation = useWorkspaceCommand(),
    incoming = transferredTo(location.state),
    [nickname, setNickname] = useState(incoming),
    notice = useRef<HTMLParagraphElement>(null);
  if (incoming && incoming !== nickname) setNickname(incoming);
  useLayoutEffect(() => {
    currentLocation.current = location;
    return () => {
      currentLocation.current = null;
    };
  }, [location]);
  const canTransfer =
    session.self?.emailVerified &&
    ["company.configure", "leadership.transfer", "members.manage"].every((capability) =>
      session.self?.capabilities.includes(capability),
    );
  useEffect(() => {
    if (!canTransfer && confirmation.held && !confirmation.pending) confirmation.dismiss();
  }, [canTransfer, confirmation]);

  async function submitTransfer(challengeId: string, code: string, nickname: string) {
    // A committed transfer can remove permissions before its response reaches this page.
    // ProtectedAccount keeps this owner scoped to the authenticated session generation.
    const result = await confirmation.run(
      "/admin/leadership/transfers",
      "EnvelopeCommandResult",
      { challengeId, code },
      null,
      "POST",
      false,
    );
    if (!result || !currentLocation.current) return false;
    const { pathname, search, hash } = currentLocation.current;
    navigate(
      { pathname, search, hash },
      { replace: true, state: { leadershipTransferredTo: nickname } },
    );
    session.changed();
    return true;
  }
  // The transfer ends this member's access, so the notice arrives through router state and
  // survives the session remount. It is shown once: the state is cleared from history so a reload
  // or Back does not repeat it.
  useEffect(() => {
    if (!incoming) return;
    navigate(
      { pathname: location.pathname, search: location.search, hash: location.hash },
      { replace: true, state: null },
    );
  }, [incoming, navigate, location.pathname, location.search, location.hash]);
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
          <Button variant="outline" onClick={() => setNickname(null)}>
            {t("settingsUi.dismiss")}
          </Button>
        </div>
      )}
      <Permission capability="company.configure">
        <Settings transferConfirmation={{ command: confirmation, submit: submitTransfer }} />
      </Permission>
    </>
  );
}
