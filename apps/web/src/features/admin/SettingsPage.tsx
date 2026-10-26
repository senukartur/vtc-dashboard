import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../shared/ui/dialog.js";
import { Badge, Button, Card, Input, Label } from "../../shared/ui/primitives.js";
import {
  CommandFeedback,
  Confirmation,
  Pager,
  Permission,
  QueryState,
  WorkspaceHeading,
} from "./components.js";
import { type DTO, useWorkspaceCommand, useWorkspaceQuery } from "./transport.js";

function TimezoneEditor({
  data,
  etag,
  command,
}: {
  data: DTO["CompanySettings"];
  etag: string | null;
  command: ReturnType<typeof useWorkspaceCommand>;
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
  return (
    <div className="stack">
      <p>{t("timezoneHelp")}</p>
      {stale && (
        <>
          <p role="alert">{t("errors.conflict")}</p>
          <Button
            variant="outline"
            disabled={command.held || command.pending}
            onClick={() => void command.refresh("/admin/company-settings")}
          >
            {t("refresh")}
          </Button>
        </>
      )}
      <p>{t("personalTimezone", { timezone: session.self?.preferences.displayTimezone })}</p>
      {!data.reportingTimezone && <p role="status">{t("timezoneUnset")}</p>}
      <Label htmlFor="company-timezone">{t("reportingTimezone")}</Label>
      <Input
        id="company-timezone"
        placeholder="Europe/Warsaw"
        autoComplete="off"
        maxLength={128}
        value={timezone}
        disabled={command.held || command.pending}
        onChange={(e) => setTimezone(e.target.value)}
      />
      <Confirmation
        label={t("saveTimezone")}
        description={t("timezoneHelp")}
        busy={command.pending}
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
        <p>{timezone}</p>
      </Confirmation>
      {command.held && (
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
      )}
    </div>
  );
}
function TransferAttempt({ successor }: { successor: DTO["MemberSummary"] }) {
  const { t } = useTranslation("administration"),
    session = useSession(),
    request = useWorkspaceCommand(),
    confirm = useWorkspaceCommand(),
    [challenge, setChallenge] = useState<DTO["Challenge"] | null>(null),
    [open, setOpen] = useState(false),
    [code, setCode] = useState("");
  const busy = request.pending || confirm.pending;
  return (
    <div className="stack">
      <p>{successor.nickname}</p>
      <p className="admin-id">{successor.id}</p>
      <Button
        disabled={busy || request.seconds > 0}
        onClick={async () => {
          const result = await request.run(
            "/admin/leadership/challenges",
            "EnvelopeChallenge",
            { successorId: successor.id },
            null,
            "POST",
            false,
          );
          if (result) {
            setCode("");
            setChallenge(result.data);
          }
        }}
      >
        {t("requestCode")}
      </Button>
      <CommandFeedback command={request} />
      {challenge && (
        <>
          <p role="status">{t("transferPending", { name: successor.nickname })}</p>
          <p>
            {t("expires")}: {challenge.expiresAt}
          </p>
          <Button
            variant="outline"
            disabled={busy || Date.parse(challenge.expiresAt) <= Date.now()}
            onClick={() => setOpen(true)}
          >
            {t("transferReview")}
          </Button>
          <Dialog
            open={open}
            onOpenChange={(value) => {
              if (!busy) {
                setOpen(value);
                if (!value) setCode("");
              }
            }}
          >
            <DialogContent>
              <DialogTitle>{t("transfer")}</DialogTitle>
              <DialogDescription>{t("transferConfirm")}</DialogDescription>
              <p>{successor.nickname}</p>
              <p className="admin-id">{successor.id}</p>
              <Label htmlFor="leadership-code">{t("transferCode")}</Label>
              <Input
                id="leadership-code"
                type="password"
                autoComplete="off"
                maxLength={128}
                value={code}
                disabled={confirm.held || busy}
                onChange={(e) => setCode(e.target.value)}
              />
              <CommandFeedback command={confirm} />
              <div className="button-row">
                <Button
                  disabled={busy || !code || confirm.seconds > 0}
                  onClick={async () => {
                    const result = await confirm.run(
                      "/admin/leadership/transfers",
                      "EnvelopeCommandResult",
                      { challengeId: challenge.id, code },
                      null,
                      "POST",
                      false,
                    );
                    if (result) {
                      setCode("");
                      setChallenge(null);
                      setOpen(false);
                      session.changed();
                    }
                  }}
                >
                  {t("confirm")}
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setOpen(false);
                    setCode("");
                  }}
                >
                  {t("cancel")}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
function Leadership() {
  const { t } = useTranslation("administration"),
    session = useSession(),
    [cursor, setCursor] = useState<string | null>(null),
    [successor, setSuccessor] = useState<DTO["MemberSummary"] | null>(null),
    query = useWorkspaceQuery(
      `/admin/members?status=active&limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      "EnvelopeListMemberAdmin",
    );
  const items =
    query.data?.data.data.items.filter(
      (row) => row.profile.member.id !== session.self?.member.id,
    ) ?? [];
  return (
    <Card className="admin-detail stack">
      <h2>{t("transfer")}</h2>
      <p>{t("transferHelp")}</p>
      {!session.self?.emailVerified ? (
        <p>{t("verifyEmailFirst")}</p>
      ) : (
        <>
          <QueryState
            pending={query.isPending}
            error={query.isError}
            retry={query.refetch}
            empty={!!query.data && !items.length}
          />
          <Label htmlFor="leadership-successor">{t("successor")}</Label>
          <select
            id="leadership-successor"
            className="input"
            value={successor?.id ?? ""}
            onChange={(e) =>
              setSuccessor(
                items.find((row) => row.profile.member.id === e.target.value)?.profile.member ??
                  null,
              )
            }
          >
            <option value="">{t("select")}</option>
            {items.map((row) => (
              <option key={row.profile.member.id} value={row.profile.member.id}>
                {row.profile.member.nickname} · {row.profile.member.id}
              </option>
            ))}
          </select>
          <Pager
            cursor={cursor}
            next={query.data?.data.data.nextCursor}
            setCursor={(value) => {
              setSuccessor(null);
              setCursor(value);
            }}
          />
          {successor && <TransferAttempt key={successor.id} successor={successor} />}
        </>
      )}
    </Card>
  );
}
function Audit() {
  const { t, i18n } = useTranslation("administration"),
    [cursor, setCursor] = useState<string | null>(null),
    query = useWorkspaceQuery(
      `/admin/audit?limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      "EnvelopeListAuditEntry",
    );
  return (
    <Card className="admin-detail stack">
      <h2>{t("audit")}</h2>
      <p>{t("auditHelp")}</p>
      <QueryState
        pending={query.isPending}
        error={query.isError}
        retry={query.refetch}
        empty={query.data?.data.data.items.length === 0}
      />
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: This named overflow region needs focus for native keyboard scrolling. */}
      <section className="admin-table-scroll" aria-label={t("audit")} tabIndex={0}>
        <table className="admin-safe-table admin-audit-table">
          <thead>
            <tr>
              <th>{t("timeUtc")}</th>
              <th>{t("action")}</th>
              <th>{t("actor")}</th>
              <th>{t("subject")}</th>
            </tr>
          </thead>
          <tbody>
            {query.data?.data.data.items.map((row) => (
              <tr key={row.id}>
                <td>
                  <time dateTime={row.occurredAt}>
                    {new Intl.DateTimeFormat(i18n.resolvedLanguage === "ru" ? "ru-RU" : "en-GB", {
                      timeZone: "UTC",
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                      fractionalSecondDigits: 3,
                      hourCycle: "h23",
                    }).format(new Date(row.occurredAt))}{" "}
                    UTC
                  </time>
                </td>
                <td>
                  {t(`auditActions.${row.action.replaceAll(".", "_")}`, {
                    defaultValue: t("auditUnknown"),
                  })}
                </td>
                <td className="admin-id">{row.actorId ?? t("system")}</td>
                <td className="admin-id">{row.subjectId}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <Pager cursor={cursor} next={query.data?.data.data.nextCursor} setCursor={setCursor} />
    </Card>
  );
}
function Settings() {
  const { t } = useTranslation("administration"),
    session = useSession(),
    command = useWorkspaceCommand(),
    settings = useWorkspaceQuery("/admin/company-settings", "EnvelopeCompanySettings"),
    sources = useWorkspaceQuery("/admin/source-capabilities", "EnvelopeSourceCapabilities"),
    data = settings.data?.data.data;
  return (
    <div className="administration-page stack">
      <WorkspaceHeading title={t("settings")} />
      <Card className="admin-detail stack">
        <h2>{t("reportingTimezone")}</h2>
        <CommandFeedback command={command} />
        <QueryState
          pending={settings.isPending}
          error={settings.isError}
          retry={settings.refetch}
        />
        {data && (
          <>
            <TimezoneEditor data={data} etag={settings.data?.etag ?? null} command={command} />
            <h3>{t("readiness")}</h3>
            <p>{t(data.launchReady ? "ready" : "incomplete")}</p>
            <ul>
              {data.missingSetup.map((code) => (
                <li key={code}>{t(code)}</li>
              ))}
            </ul>
          </>
        )}
        <Link to="/account/qualifications">{t("qualificationWorkspace")}</Link>
      </Card>
      <Card className="stack">
        <h2>{t("sources")}</h2>
        <p>{t("sourceHelp")}</p>
        <QueryState pending={sources.isPending} error={sources.isError} retry={sources.refetch} />
        {sources.data?.data.data.sources.map((source) => (
          <div key={source.provider}>
            <h3>{t(source.provider)}</h3>
            <Badge>
              {t(!source.implemented ? "deferred" : source.runtimeEnabled ? "enabled" : "disabled")}
            </Badge>
          </div>
        ))}
      </Card>
      {session.self?.capabilities.includes("leadership.transfer") && <Leadership />}
      <Audit />
    </div>
  );
}
export function SettingsPage() {
  return (
    <Permission capability="company.configure">
      <Settings />
    </Permission>
  );
}
