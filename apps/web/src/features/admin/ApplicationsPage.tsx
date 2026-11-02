import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { formatUtc } from "../../shared/formatting.js";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../shared/ui/dialog.js";
import { Badge, Button, Card, Label, Table } from "../../shared/ui/primitives.js";
import {
  type ApplicationStatus,
  applicationTone,
  type InviteState,
  invitationView,
  mailActions,
} from "./applications-model.js";
import {
  CommandFeedback,
  Confirmation,
  Pager,
  Permission,
  QueryState,
  WorkspaceHeading,
} from "./components.js";
import { type DTO, useWorkspaceCommand, useWorkspaceQuery } from "./transport.js";
import "./applications.css";

export function SensitiveValue({
  title,
  description,
  value,
  close,
  returnFocus,
}: {
  title: string;
  description: string;
  value: string;
  close: () => void;
  returnFocus: HTMLElement | null;
}) {
  const { t } = useTranslation("administration"),
    [copied, setCopied] = useState<boolean | null>(null);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (
            returnFocus?.isConnected &&
            returnFocus.getClientRects().length > 0 &&
            !returnFocus.matches(":disabled, [aria-disabled=true]") &&
            !returnFocus.closest("[inert]")
          )
            returnFocus.focus();
        }}
      >
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        <pre className="admin-secret">{value}</pre>
        <Button
          onClick={async () => {
            try {
              if (!navigator.clipboard) throw new Error();
              await navigator.clipboard.writeText(value);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {t("copyClipboard")}
        </Button>
        {copied !== null && <p role="status">{t(copied ? "copied" : "clipboardUnavailable")}</p>}
        <Button variant="outline" onClick={close}>
          {t("hideSecret")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
/** Dates use the member's display timezone; the timezone name is shown where expiry matters. */
function useDates() {
  const { i18n } = useTranslation("administration"),
    session = useSession();
  const locale = i18n.resolvedLanguage === "en" ? "en" : "ru",
    timezone = session.self?.preferences.displayTimezone ?? "UTC";
  return {
    timezone,
    format: (value: string | null | undefined) => formatUtc(value ?? null, locale, timezone),
  };
}
function StatusBadge({ status }: { status: ApplicationStatus }) {
  const { t } = useTranslation("administration"),
    { tone, symbol } = applicationTone(status);
  return (
    <Badge size="xs" className={`applications-status applications-tone-${tone}`}>
      <span aria-hidden="true">{symbol}</span>
      {t(`applicationsUi.appStatus.${status}`)}
    </Badge>
  );
}
const inviteBadge: Record<InviteState, string> = {
  active: "stateActive",
  expired: "stateExpired",
  used: "stateUsed",
  revoked: "stateRevoked",
  reserved: "stateReserved",
};
const mailHint = {
  notRequested: "applicationsUi.mailNotRequestedHint",
  disabled: "applicationsUi.mailDisabledHint",
  retry: "applicationsUi.mailRetryHint",
  help: "mailHelp",
} as const;
function Invitation({ id }: { id: string }) {
  const { t } = useTranslation("administration"),
    dates = useDates(),
    query = useWorkspaceQuery(`/admin/invitations/${id}`, "EnvelopeInvitation"),
    capabilities = useWorkspaceQuery("/admin/source-capabilities", "EnvelopeSourceCapabilities"),
    command = useWorkspaceCommand(),
    copy = useWorkspaceCommand();
  const [link, setLink] = useState<DTO["InvitationLink"] | null>(null);
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const data = query.data?.data.data;
  const delivery = useWorkspaceQuery(
    `/mail-deliveries/${data?.deliveryId ?? "none"}`,
    "EnvelopeMailDelivery",
    !!data?.deliveryId,
  );
  const mail = delivery.data?.data.data;
  const valid = data?.state === "active" && Date.parse(data.expiresAt) > Date.now();
  const busy = command.pending || command.seconds > 0;
  // Display only: the copy/send/retry controls of a link that is no longer live are not rendered.
  const view = data && invitationView(data.state, data.expiresAt, Date.now()),
    actions =
      data &&
      mailActions({
        emailDelivery: data.emailDelivery,
        mailState: mail?.state,
        mailEnabled: capabilities.data?.data.data.mail ?? null,
        live: valid,
        busy,
      });
  const deliveryState = data?.deliveryId ? (
    <QueryState pending={delivery.isPending} error={delivery.isError} retry={delivery.refetch} />
  ) : null;
  return (
    <section className="stack applications-section applications-invitation">
      <div className="applications-section-head">
        <h3>{t("invitation")}</h3>
        {view && (
          <Badge size="xs" className={`applications-invite applications-invite-${view.badge}`}>
            {t(`applicationsUi.${inviteBadge[view.badge]}`)}
          </Badge>
        )}
      </div>
      <QueryState pending={query.isPending} error={query.isError} retry={query.refetch} />
      {data && view && actions && (
        <>
          {valid ? (
            <>
              <p>
                {t("applicationsUi.validUntil", {
                  date: dates.format(data.expiresAt),
                  timezone: dates.timezone,
                })}
              </p>
              <p className="muted">{t("applicationsUi.emailKept")}</p>
              <div className="admin-actions">
                <Button
                  variant="outline"
                  disabled={copy.pending}
                  onClick={async (event) => {
                    returnFocus.current = event.currentTarget;
                    const result = await copy.run(
                      `/admin/invitations/${id}/copy-link`,
                      "EnvelopeInvitationLink",
                      undefined,
                      query.data?.etag,
                      "POST",
                      false,
                    );
                    if (result) setLink(result.data);
                  }}
                >
                  {t("applicationsUi.copyLink")}
                </Button>
              </div>
              <div className="applications-mail stack">
                <p>{`${t("delivery")}: ${t(`mail.${data.emailDelivery}`)}`}</p>
                <p className="muted">{t(mailHint[actions.hint])}</p>
                {(actions.send !== "hidden" || actions.retry !== "hidden") && (
                  <div className="admin-actions">
                    {actions.send !== "hidden" && (
                      <Button
                        variant="outline"
                        size="xs"
                        disabled={actions.send === "disabled"}
                        onClick={() =>
                          void command.run(
                            `/admin/invitations/${id}/email-deliveries`,
                            "EnvelopeInvitation",
                            undefined,
                            query.data?.etag,
                          )
                        }
                      >
                        {t("applicationsUi.sendEmail")}
                      </Button>
                    )}
                    {mail && actions.retry !== "hidden" && (
                      <Button
                        variant="outline"
                        size="xs"
                        disabled={actions.retry === "disabled"}
                        onClick={() =>
                          void command.run(
                            `/mail-deliveries/${mail.id}/resends`,
                            "EnvelopeCommandResult",
                            undefined,
                            delivery.data?.etag,
                          )
                        }
                      >
                        {t("applicationsUi.retryEmail")}
                      </Button>
                    )}
                  </div>
                )}
                {deliveryState}
              </div>
            </>
          ) : view.line === "expired" ? (
            <>
              <p>
                {t("applicationsUi.expiredOn", {
                  date: dates.format(data.expiresAt),
                  timezone: dates.timezone,
                })}
              </p>
              <p className="muted">{t("applicationsUi.canReissue")}</p>
            </>
          ) : view.line === "used" ? (
            <>
              <p>{t("applicationsUi.usedLine")}</p>
              <p className="muted">{t("applicationsUi.usedNote")}</p>
            </>
          ) : view.line === "revoked" ? (
            <p>{t("applicationsUi.revokedLine")}</p>
          ) : null}
          {!valid && deliveryState}
          {view.canReissue && (
            <div className="applications-reissue">
              <Confirmation
                label={t("applicationsUi.reissueLink")}
                description={t("applicationsUi.reissueNote")}
                busy={busy}
                disabled={command.held || !["active", "expired"].includes(data.state)}
                triggerClassName="applications-danger"
                confirm={async () =>
                  !!(await command.run(
                    `/admin/invitations/${id}/reissue`,
                    "EnvelopeInvitation",
                    undefined,
                    query.data?.etag,
                  ))
                }
              >
                <div className="applications-dialog">
                  <ul className="applications-points">
                    <li>{t("applicationsUi.reissuePoint1")}</li>
                    <li>{t("applicationsUi.reissuePoint2")}</li>
                    <li>{t("applicationsUi.reissuePoint3")}</li>
                  </ul>
                </div>
              </Confirmation>
              <p className="muted">{t("applicationsUi.reissueNote")}</p>
            </div>
          )}
          <CommandFeedback command={command} />
          <CommandFeedback command={copy} />
        </>
      )}
      {link && (
        <SensitiveValue
          title={t("invitation")}
          description={t("privateLink")}
          value={link.link}
          returnFocus={returnFocus.current}
          close={() => setLink(null)}
        />
      )}
    </section>
  );
}
function ApplicationDetail({ id, back }: { id: string; back: () => void }) {
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const { t } = useTranslation("administration"),
    dates = useDates(),
    query = useWorkspaceQuery(`/admin/applications/${id}`, "EnvelopeApplication"),
    history = useWorkspaceQuery(
      `/admin/applications/${id}/history?limit=25${historyCursor ? `&cursor=${encodeURIComponent(historyCursor)}` : ""}`,
      "EnvelopeListApplication",
    ),
    command = useWorkspaceCommand();
  const [reason, setReason] = useState("");
  const app = query.data?.data.data;
  const busy = command.pending || command.seconds > 0;
  async function decide(decision: "approve" | "reject") {
    return !!(await command.run(
      `/admin/applications/${id}/decisions`,
      "EnvelopeApplication",
      decision === "approve" ? { decision } : { decision, reason },
      query.data?.etag,
    ));
  }
  const games = app?.fields.games.map((game) => t(game)).join(", "),
    tone = app && applicationTone(app.status);
  return (
    <Card className="admin-detail applications-detail stack">
      <Button className="admin-mobile-back" variant="ghost" onClick={back}>
        {t("back")}
      </Button>
      <QueryState pending={query.isPending} error={query.isError} retry={query.refetch} />
      {app && tone && (
        <>
          <div className="applications-detail-head">
            <div className="applications-title">
              <h2>{app.fields.nickname}</h2>
              <StatusBadge status={app.status} />
            </div>
            <p className="muted">
              {t("applicationsUi.submittedOn", { date: dates.format(app.submittedAt) })}
            </p>
            <p className="admin-id applications-break">{app.id}</p>
          </div>
          <dl className="applications-facts">
            <div>
              <dt>{t("applicationsUi.inviteEmail")}</dt>
              <dd className="applications-break">{app.fields.email}</dd>
            </div>
            <div>
              <dt>{t("steamProfile")}</dt>
              <dd>
                <a
                  className="applications-break"
                  href={app.fields.steamProfileUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {app.fields.steamProfileUrl}
                </a>{" "}
                <span className="muted">{t("applicationsUi.steamUnverified")}</span>
              </dd>
            </div>
            <div>
              <dt>{t("games")}</dt>
              <dd>{games}</dd>
            </div>
            <div>
              <dt>{t("discord")}</dt>
              <dd>{app.fields.discord ?? t("notSet")}</dd>
            </div>
            <div className="applications-wide">
              <dt>{t("introduction")}</dt>
              <dd>{app.fields.introduction ?? t("notSet")}</dd>
            </div>
          </dl>
          <section className="stack applications-section applications-history">
            <h3>{t("prior")}</h3>
            <QueryState
              pending={history.isPending}
              error={history.isError}
              retry={history.refetch}
              empty={history.data?.data.data.items.length === 0}
            />
            {history.data?.data.data.items.map((previous) => (
              <div key={previous.id} className="applications-history-item">
                <p className="applications-history-line">
                  <span>{dates.format(previous.submittedAt)}</span>
                  <span aria-hidden="true">·</span>
                  <StatusBadge status={previous.status} />
                  {previous.id === app.id && (
                    <Badge size="xs" className="applications-current">
                      {t("applicationsUi.thisApplication")}
                    </Badge>
                  )}
                </p>
                <p className="muted applications-reason-text">
                  {previous.decisionReason ?? t("noReason")}
                </p>
              </div>
            ))}
            <Pager
              cursor={historyCursor}
              next={history.data?.data.data.nextCursor}
              setCursor={setHistoryCursor}
            />
          </section>
          <section className="stack applications-section applications-decision">
            <h3>{t("decision")}</h3>
            {app.status === "submitted" ? (
              <>
                <div className="applications-field">
                  <Label htmlFor="application-reason">{t("reason")}</Label>
                  <textarea
                    id="application-reason"
                    className="input"
                    rows={3}
                    maxLength={2048}
                    value={reason}
                    disabled={command.held || busy}
                    aria-describedby="application-reason-help"
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <p id="application-reason-help" className="muted">
                    {t("applicationsUi.reasonHelp")}
                  </p>
                </div>
                <div className="admin-actions">
                  <Confirmation
                    label={t("approve")}
                    description={t("reviewConfirm")}
                    busy={busy}
                    disabled={command.held}
                    variant="default"
                    confirm={() => decide("approve")}
                  >
                    <div className="applications-dialog">
                      <p>
                        {app.fields.nickname} ·{" "}
                        <span className="applications-break">{app.fields.email}</span>
                      </p>
                      <ul className="applications-points">
                        <li>{t("applicationsUi.approvePoint1")}</li>
                        <li>{t("applicationsUi.approvePoint2", { games })}</li>
                        <li>{t("applicationsUi.approveNoEmail")}</li>
                      </ul>
                    </div>
                  </Confirmation>
                  <Confirmation
                    label={t("reject")}
                    description={t("reviewConfirm")}
                    busy={busy}
                    disabled={command.held || !reason.trim()}
                    triggerClassName="applications-danger"
                    confirm={() => decide("reject")}
                  >
                    <div className="applications-dialog">
                      <p>{app.fields.nickname}</p>
                      <p className="applications-quote">{reason}</p>
                    </div>
                  </Confirmation>
                </div>
                <p className="muted">{t("applicationsUi.approveNote")}</p>
                {command.held && (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void command.run(
                        `/admin/applications/${id}/decisions`,
                        "EnvelopeApplication",
                        undefined,
                        query.data?.etag,
                      )
                    }
                  >
                    {t("refresh")}
                  </Button>
                )}
              </>
            ) : (
              <>
                <p className="applications-summary">
                  <span aria-hidden="true" className={`applications-tone-${tone.tone}`}>
                    {tone.symbol}
                  </span>{" "}
                  {t(
                    app.status === "rejected"
                      ? "applicationsUi.rejectedSummary"
                      : "applicationsUi.approvedSummary",
                    { date: dates.format(app.decision?.decidedAt) },
                  )}
                </p>
                {app.status === "rejected" && (
                  <>
                    <p className="applications-quote">
                      {app.decisionReason ? `«${app.decisionReason}»` : t("noReason")}
                    </p>
                    <p className="muted">{t("applicationsUi.rejectedNote")}</p>
                  </>
                )}
              </>
            )}
            <CommandFeedback command={command} />
          </section>
          {app.invitationId && <Invitation key={app.invitationId} id={app.invitationId} />}
        </>
      )}
    </Card>
  );
}
function Applications() {
  const { t } = useTranslation("administration"),
    dates = useDates(),
    [search, setSearch] = useSearchParams(),
    [selected, setSelected] = useState<string | null>(null);
  const value = search.get("status"),
    status = ["submitted", "approved", "rejected"].includes(value ?? "")
      ? (value as string)
      : "submitted",
    cursor = search.get("cursor");
  const query = useWorkspaceQuery(
    `/admin/applications?status=${status}&limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    "EnvelopeListApplication",
  );
  const items = query.data?.data.data.items,
    columns = [
      "colApplicant",
      "colGames",
      "colSubmitted",
      "colStatus",
      ...(status === "rejected" ? ["colDecided"] : []),
    ];
  function page(next: string | null) {
    setSelected(null);
    setSearch({ status, ...(next ? { cursor: next } : {}) });
  }
  return (
    <div className="administration-page applications-page stack">
      <div className="applications-heading">
        <WorkspaceHeading title={t("applications")} />
        <p className="muted">{t("applicationsUi.subtitle")}</p>
      </div>
      <nav className="admin-tabs" aria-label={t("status")}>
        {["submitted", "approved", "rejected"].map((item) => (
          <a
            key={item}
            href={`?status=${item}`}
            aria-current={status === item ? "page" : undefined}
            onClick={(e) => {
              e.preventDefault();
              setSelected(null);
              setSearch({ status: item });
            }}
          >
            {t(item)}
          </a>
        ))}
      </nav>
      <div className={`admin-workbench ${selected ? "has-selection" : ""}`}>
        <Card className="admin-master applications-master stack">
          <QueryState
            pending={query.isPending}
            error={query.isError}
            retry={query.refetch}
            empty={query.data?.data.data.items.length === 0}
          />
          {items && items.length > 0 && (
            <Table size="xs" className="applications-table" role="table">
              <caption className="visually-hidden">{t("applicationsUi.listCaption")}</caption>
              {/* biome-ignore lint/a11y/noRedundantRoles: the phone layout changes table display, which drops implicit table semantics in browsers. */}
              <thead role="rowgroup">
                {/* biome-ignore lint/a11y/noRedundantRoles: the phone layout changes table display, which drops implicit table semantics in browsers. */}
                <tr role="row">
                  {columns.map((column) => (
                    // biome-ignore lint/a11y/noRedundantRoles: the phone layout changes table display, which drops implicit table semantics in browsers.
                    <th key={column} scope="col" role="columnheader">
                      {t(`applicationsUi.${column}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              {/* biome-ignore lint/a11y/noRedundantRoles: the phone layout changes table display, which drops implicit table semantics in browsers. */}
              <tbody role="rowgroup">
                {items.map((app) => (
                  // biome-ignore lint/a11y/noRedundantRoles: the phone layout changes table display, which drops implicit table semantics in browsers.
                  <tr key={app.id} role="row" data-selected={selected === app.id ? "" : undefined}>
                    {/* biome-ignore lint/a11y/noRedundantRoles: the phone layout changes table display, which drops implicit table semantics in browsers. */}
                    <th scope="row" role="rowheader">
                      <Button
                        variant="ghost"
                        size="xs"
                        className="applications-row-button"
                        aria-pressed={selected === app.id}
                        onClick={() => setSelected(app.id)}
                      >
                        {app.fields.nickname}
                      </Button>
                    </th>
                    {[
                      <span key="games" className="applications-games">
                        {app.fields.games.map((game) => (
                          <Badge key={game} size="xs">
                            {t(`applicationsUi.gameShort.${game}`)}
                          </Badge>
                        ))}
                      </span>,
                      dates.format(app.submittedAt),
                      <StatusBadge key="status" status={app.status} />,
                      ...(status === "rejected" ? [dates.format(app.decision?.decidedAt)] : []),
                    ].map((cell, index) => (
                      // biome-ignore lint/a11y/noRedundantRoles: the phone layout changes table display, which drops implicit table semantics in browsers.
                      <td key={columns[index + 1]} role="cell">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <p className="muted">{t("applicationsUi.historyNote")}</p>
          <Pager cursor={cursor} next={query.data?.data.data.nextCursor} setCursor={page} />
        </Card>
        {selected ? (
          <ApplicationDetail key={selected} id={selected} back={() => setSelected(null)} />
        ) : (
          <Card className="admin-detail">
            <p>{t("select")}</p>
          </Card>
        )}
      </div>
    </div>
  );
}
export function ApplicationsPage() {
  return (
    <Permission capability="applications.manage">
      <Applications />
    </Permission>
  );
}
