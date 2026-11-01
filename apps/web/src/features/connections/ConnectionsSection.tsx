import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "../../app/Session.js";
import { formatUtc } from "../../shared/formatting.js";
import { Badge, Button, Card, Input, Label } from "../../shared/ui/primitives.js";
import { SettingsRow } from "../account/SettingsRow.js";
import { SensitiveValue } from "../admin/ApplicationsPage.js";
import { CommandFeedback, Confirmation, Pager, QueryState } from "../admin/components.js";
import { type DTO, useWorkspaceCommand, useWorkspaceQuery } from "../admin/transport.js";

/** Formats an API UTC timestamp in the member's display timezone. */
function useTimestamp() {
  const { i18n } = useTranslation();
  const session = useSession();
  const locale = i18n.resolvedLanguage === "en" ? "en" : "ru";
  const timeZone = session.self?.preferences.displayTimezone ?? "UTC";
  return (value: string | null) => formatUtc(value, locale, timeZone);
}

function Tokens() {
  const { t } = useTranslation("administration"),
    session = useSession(),
    timestamp = useTimestamp(),
    allowed = session.self?.capabilities.includes("trips.submit_own") ?? false,
    [cursor, setCursor] = useState<string | null>(null),
    query = useWorkspaceQuery(
      `/me/telemetry-tokens?limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      "EnvelopeListTokenInfo",
      allowed,
    ),
    issue = useWorkspaceCommand(),
    revoke = useWorkspaceCommand(),
    [label, setLabel] = useState(""),
    [secret, setSecret] = useState<string | null>(null);
  const issueTrigger = useRef<HTMLButtonElement | null>(null),
    returnFocus = useRef<HTMLElement | null>(null);
  const recoveryId = issue.failure?.ownResourceId;
  const next = query.data?.data.data.nextCursor;
  async function revokeToken(id: string) {
    const result = await revoke.run(
      `/me/telemetry-tokens/${id}`,
      "EnvelopeCommandResult",
      undefined,
      null,
      "DELETE",
    );
    if (result && id === recoveryId) issue.dismiss();
    return !!result;
  }
  return (
    <Card className="settings-card">
      <h2>{t("tokens")}</h2>
      <div className="settings-card-body">
        <p className="muted">{t("tokenHelp")}</p>
        {!allowed ? (
          <p>{t("noSubmit")}</p>
        ) : !session.self?.steamVerified ? (
          <p>{t("steamRequired")}</p>
        ) : (
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              const submitter = (e.nativeEvent as SubmitEvent).submitter;
              returnFocus.current =
                submitter instanceof HTMLElement ? submitter : issueTrigger.current;
              const result = await issue.run("/me/telemetry-tokens", "EnvelopeTokenIssued", {
                label: label.trim(),
              });
              if (result) {
                setSecret(result.data.token);
              }
            }}
          >
            <Label htmlFor="telemetry-label">{t("tokenLabel")}</Label>
            <div className="settings-inline-form">
              <Input
                id="telemetry-label"
                required
                minLength={1}
                maxLength={128}
                value={label}
                disabled={issue.held || issue.pending || !!recoveryId}
                onChange={(e) => setLabel(e.target.value)}
              />
              <Button
                type="submit"
                ref={issueTrigger}
                size="xs"
                disabled={
                  issue.pending ||
                  revoke.pending ||
                  issue.seconds > 0 ||
                  !!recoveryId ||
                  !label.trim()
                }
              >
                {t("createToken")}
              </Button>
            </div>
          </form>
        )}
        {allowed && (
          <>
            <CommandFeedback command={issue} />
            {recoveryId && (
              <div className="stack">
                <p>{t("tokenRecovery")}</p>
                <p className="admin-id">{recoveryId}</p>
                <Button disabled={revoke.pending} onClick={() => void revokeToken(recoveryId)}>
                  {t("recoverRevoke")}
                </Button>
              </div>
            )}
            {revoke.held && (
              <Button
                disabled={revoke.pending || revoke.seconds > 0}
                onClick={() =>
                  void revoke.run(
                    "/me/telemetry-tokens",
                    "EnvelopeCommandResult",
                    undefined,
                    null,
                    "DELETE",
                  )
                }
              >
                {t("refresh")}
              </Button>
            )}
            <CommandFeedback command={revoke} />
            <QueryState
              pending={query.isPending}
              error={query.isError}
              retry={query.refetch}
              empty={query.data?.data.data.items.length === 0}
            />
          </>
        )}
      </div>
      {allowed &&
        query.data?.data.data.items.map((token) => (
          <SettingsRow
            key={token.id}
            id={`token-${token.id}`}
            level={3}
            title={token.label}
            hint={
              <>
                {t("created")}: {timestamp(token.createdAt)} · {t("lastUsed")}:{" "}
                {token.lastUsedAt ? timestamp(token.lastUsedAt) : t("neverUsed")}
              </>
            }
            action={
              token.revokedAt ? (
                <Badge>{t("revoked")}</Badge>
              ) : (
                <Confirmation
                  label={`${t("revokeToken")} · ${token.label}`}
                  description={t("revokeHelp")}
                  busy={revoke.pending}
                  disabled={revoke.held || revoke.seconds > 0}
                  confirm={() => revokeToken(token.id)}
                >
                  <p>{token.label}</p>
                  <p className="admin-id">{token.id}</p>
                </Confirmation>
              )
            }
          />
        ))}
      {allowed && (cursor || next) && (
        <div className="settings-card-body">
          <Pager cursor={cursor} next={next} setCursor={setCursor} />
        </div>
      )}
      {allowed && secret && (
        <SensitiveValue
          title={t("tokenSecret")}
          description={t("tokenHelp")}
          value={secret}
          returnFocus={returnFocus.current}
          close={() => setSecret(null)}
        />
      )}
    </Card>
  );
}

function statusBadge(status: string) {
  return status === "verified" || status === "available"
    ? "badge-accepted"
    : status === "pending" || status === "review_required" || status === "stale"
      ? "badge-pending"
      : undefined;
}

function ExternalIdentity() {
  const { t } = useTranslation("administration"),
    session = useSession(),
    timestamp = useTimestamp(),
    query = useWorkspaceQuery("/me/identity", "EnvelopeIdentity"),
    command = useWorkspaceCommand(),
    [verification, setVerification] = useState<DTO["IdentityVerification"] | null>(null);
  const identity = query.data?.data.data,
    proofId = identity?.pendingReplacementId,
    proof = useWorkspaceQuery(
      `/me/steam-replacement-verifications/${proofId ?? "none"}`,
      "EnvelopeSteamReplacementProof",
      !!proofId,
    );
  async function request(replacement: boolean) {
    const result = await command.run(
      `/me/${replacement ? "steam-replacement-verifications" : "steam-verifications"}`,
      "EnvelopeIdentityVerification",
      undefined,
      null,
      "POST",
      false,
    );
    if (result) setVerification(result.data);
  }
  const truckers = identity?.truckersMp;
  return (
    <Card className="settings-card">
      <h2>{t("identity")}</h2>
      {(query.isPending || query.isError) && (
        <div className="settings-card-body">
          <QueryState pending={query.isPending} error={query.isError} retry={query.refetch} />
        </div>
      )}
      {identity && truckers && (
        <>
          <SettingsRow
            id="connections-steam"
            level={3}
            title="Steam"
            value={
              <Badge className={statusBadge(identity.steamStatus)}>{t(identity.steamStatus)}</Badge>
            }
            hint={
              <>
                {identity.steamProfileUrl && (
                  <>
                    <a href={identity.steamProfileUrl} target="_blank" rel="noreferrer">
                      {identity.steamProfileUrl}
                    </a>{" "}
                  </>
                )}
                {t("account:steamHint")}
              </>
            }
            action={
              <>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={command.pending || command.seconds > 0}
                  onClick={() => void request(identity.steamStatus === "verified")}
                >
                  {t(identity.steamStatus === "verified" ? "replaceSteam" : "linkSteam")}
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={async () => {
                    await command.refresh();
                    await session.refresh();
                  }}
                >
                  {t("refresh")}
                </Button>
              </>
            }
          >
            {proofId && (
              <section className="stack">
                <h4>{t("pendingProof")}</h4>
                <QueryState pending={proof.isPending} error={proof.isError} retry={proof.refetch} />
                {proof.data && (
                  <>
                    <p>
                      {t(proof.data.data.data.state, { defaultValue: proof.data.data.data.state })}
                    </p>
                    <p>{proof.data.data.data.candidateSteamProfileUrl}</p>
                    <p>
                      {t("expires")}: {timestamp(proof.data.data.data.expiresAt)}
                    </p>
                  </>
                )}
              </section>
            )}
            <CommandFeedback command={command} />
            {verification && (
              <div className="stack">
                <p>{t("providerHelp")}</p>
                <a href={verification.verificationUrl} rel="noreferrer">
                  {t("providerLink")}
                </a>
                <p>
                  {t("expires")}: {timestamp(verification.expiresAt)}
                </p>
                <div className="button-row">
                  <Button size="xs" variant="ghost" onClick={() => setVerification(null)}>
                    {t("close")}
                  </Button>
                </div>
              </div>
            )}
          </SettingsRow>
          <SettingsRow
            id="connections-truckersmp"
            level={3}
            title="TruckersMP"
            value={<Badge className={statusBadge(truckers.status)}>{t(truckers.status)}</Badge>}
            hint={[
              truckers.found !== null ? t(truckers.found ? "found" : "notFound") : null,
              truckers.displayName,
              `${t("checkedAt")}: ${truckers.checkedAt ? timestamp(truckers.checkedAt) : t("notSet")}`,
              `${t("lastAttempt")}: ${truckers.lastAttemptAt ? timestamp(truckers.lastAttemptAt) : t("notSet")}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          />
        </>
      )}
    </Card>
  );
}

function Disabled({ title }: { title: string }) {
  const { t } = useTranslation("administration");
  return (
    <Card className="settings-card">
      <h2>{title}</h2>
      <div className="settings-card-body">
        <p>{t("disabled")}</p>
      </div>
    </Card>
  );
}

function Connections() {
  const { t } = useTranslation("administration"),
    session = useSession(),
    capabilities = useWorkspaceQuery(
      "/me/connection-capabilities",
      "EnvelopePersonalConnectionCapabilities",
    ),
    data = capabilities.data?.data.data,
    scope = [
      session.self?.member.id,
      session.generation,
      session.self?.identityEpoch,
      session.self?.capabilities.join(","),
    ].join(":");
  return (
    <>
      <QueryState
        pending={capabilities.isPending}
        error={capabilities.isError}
        retry={capabilities.refetch}
      />
      {data && (
        <>
          {(!data.telemetry || !data.externalIdentities) && <p role="status">{t("partial")}</p>}
          {data.externalIdentities ? (
            <ExternalIdentity key={`identity:${scope}`} />
          ) : (
            <Disabled title={t("identity")} />
          )}
          {data.telemetry ? <Tokens key={`tokens:${scope}`} /> : <Disabled title={t("tokens")} />}
        </>
      )}
    </>
  );
}

/** Steam/TruckersMP status and personal telemetry credentials inside account settings. */
export function ConnectionsSection() {
  const { t } = useTranslation("account");
  const session = useSession();
  // Connection capabilities are a company read; without it the section requests nothing.
  if (!session.self?.capabilities.includes("company.read"))
    return <p>{t("connectionUnavailable")}</p>;
  return <Connections />;
}
