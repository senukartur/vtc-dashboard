import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
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
function Invitation({ id }: { id: string }) {
  const { t } = useTranslation("administration"),
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
  return (
    <section className="stack">
      <h3>{t("invitation")}</h3>
      <QueryState pending={query.isPending} error={query.isError} retry={query.refetch} />
      {data && (
        <>
          <Badge>{t(data.state, { defaultValue: data.state })}</Badge>
          <p>
            {t("expires")}: {data.expiresAt}
          </p>
          <p>
            {t("delivery")}: {t(`mail.${data.emailDelivery}`)}
          </p>
          <p className="muted">{t("mailHelp")}</p>
          <div className="admin-actions">
            <Button
              variant="outline"
              disabled={!valid || copy.pending}
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
              {t("copy")}
            </Button>
            {data.emailDelivery === "not_requested" && (
              <Button
                variant="outline"
                disabled={!valid || busy || !capabilities.data?.data.data.mail}
                onClick={() =>
                  void command.run(
                    `/admin/invitations/${id}/email-deliveries`,
                    "EnvelopeInvitation",
                    undefined,
                    query.data?.etag,
                  )
                }
              >
                {t("requestEmail")}
              </Button>
            )}
            {mail && ["failed", "retryable"].includes(mail.state) && (
              <Button
                variant="outline"
                disabled={!valid || busy}
                onClick={() =>
                  void command.run(
                    `/mail-deliveries/${mail.id}/resends`,
                    "EnvelopeCommandResult",
                    undefined,
                    delivery.data?.etag,
                  )
                }
              >
                {t("retryMail")}
              </Button>
            )}
            <Confirmation
              label={t("reissue")}
              description={t("reissueHelp")}
              busy={busy}
              disabled={command.held || !["active", "expired"].includes(data.state)}
              confirm={async () =>
                !!(await command.run(
                  `/admin/invitations/${id}/reissue`,
                  "EnvelopeInvitation",
                  undefined,
                  query.data?.etag,
                ))
              }
            />
          </div>
          {data.deliveryId && (
            <QueryState
              pending={delivery.isPending}
              error={delivery.isError}
              retry={delivery.refetch}
            />
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
  return (
    <Card className="admin-detail stack">
      <Button className="admin-mobile-back" variant="ghost" onClick={back}>
        {t("back")}
      </Button>
      <QueryState pending={query.isPending} error={query.isError} retry={query.refetch} />
      {app && (
        <>
          <h2>{app.fields.nickname}</h2>
          <Badge>{t(app.status)}</Badge>
          <p className="admin-id">{app.id}</p>
          <dl>
            <dt>{t("email")}</dt>
            <dd>{app.fields.email}</dd>
            <dt>{t("games")}</dt>
            <dd>{app.fields.games.map((game) => t(game)).join(", ")}</dd>
            <dt>{t("steamProfile")}</dt>
            <dd>
              <a href={app.fields.steamProfileUrl} target="_blank" rel="noreferrer">
                {app.fields.steamProfileUrl}
              </a>
            </dd>
            <dt>{t("discord")}</dt>
            <dd>{app.fields.discord ?? t("notSet")}</dd>
            <dt>{t("introduction")}</dt>
            <dd>{app.fields.introduction ?? t("notSet")}</dd>
            <dt>{t("submittedAt")}</dt>
            <dd>{app.submittedAt}</dd>
          </dl>
          {app.status === "submitted" ? (
            <>
              <Label htmlFor="application-reason">{t("reason")}</Label>
              <Input
                id="application-reason"
                maxLength={2048}
                value={reason}
                disabled={command.held || busy}
                onChange={(e) => setReason(e.target.value)}
              />
              <div className="admin-actions">
                <Confirmation
                  label={t("approve")}
                  description={t("reviewConfirm")}
                  busy={busy}
                  disabled={command.held}
                  confirm={() => decide("approve")}
                >
                  <p>
                    {app.fields.nickname} · {app.fields.email}
                  </p>
                </Confirmation>
                <Confirmation
                  label={t("reject")}
                  description={t("reviewConfirm")}
                  busy={busy}
                  disabled={command.held || !reason.trim()}
                  confirm={() => decide("reject")}
                >
                  <p>{app.fields.nickname}</p>
                  <p>{reason}</p>
                </Confirmation>
              </div>
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
            <section>
              <h3>{t("decision")}</h3>
              <p>
                {t(app.status)} · {app.decision?.decidedAt}
              </p>
              <p>{app.decisionReason ?? t("noReason")}</p>
            </section>
          )}
          <CommandFeedback command={command} />
          {app.invitationId && <Invitation key={app.invitationId} id={app.invitationId} />}
          <section className="stack">
            <h3>{t("prior")}</h3>
            <QueryState
              pending={history.isPending}
              error={history.isError}
              retry={history.refetch}
              empty={history.data?.data.data.items.length === 0}
            />
            {history.data?.data.data.items.map((previous) => (
              <div key={previous.id}>
                <p>
                  {previous.submittedAt} · {t(previous.status)}
                </p>
                <p>{previous.decisionReason ?? t("noReason")}</p>
              </div>
            ))}
            <Pager
              cursor={historyCursor}
              next={history.data?.data.data.nextCursor}
              setCursor={setHistoryCursor}
            />
          </section>
        </>
      )}
    </Card>
  );
}
function Applications() {
  const { t } = useTranslation("administration"),
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
  function page(next: string | null) {
    setSelected(null);
    setSearch({ status, ...(next ? { cursor: next } : {}) });
  }
  return (
    <div className="administration-page stack">
      <WorkspaceHeading title={t("applications")} />
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
        <Card className="admin-master stack">
          <QueryState
            pending={query.isPending}
            error={query.isError}
            retry={query.refetch}
            empty={query.data?.data.data.items.length === 0}
          />
          <ul className="admin-list">
            {query.data?.data.data.items.map((app) => (
              <li key={app.id}>
                <Button
                  variant="ghost"
                  aria-pressed={selected === app.id}
                  onClick={() => setSelected(app.id)}
                >
                  {app.fields.nickname} · {app.submittedAt}
                </Button>
              </li>
            ))}
          </ul>
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
