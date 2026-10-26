import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "../../app/Session.js";
import { Badge, Button, Card, Input, Label } from "../../shared/ui/primitives.js";
import { SensitiveValue } from "../admin/ApplicationsPage.js";
import {
  CommandFeedback,
  Confirmation,
  Pager,
  QueryState,
  WorkspaceHeading,
} from "../admin/components.js";
import { IdentityView } from "../admin/MembersPage.js";
import { type DTO, useWorkspaceCommand, useWorkspaceQuery } from "../admin/transport.js";

function Tokens() {
  const { t } = useTranslation("administration"),
    session = useSession(),
    [cursor, setCursor] = useState<string | null>(null),
    query = useWorkspaceQuery(
      `/me/telemetry-tokens?limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      "EnvelopeListTokenInfo",
    ),
    issue = useWorkspaceCommand(),
    revoke = useWorkspaceCommand(),
    [label, setLabel] = useState(""),
    [secret, setSecret] = useState<string | null>(null);
  const allowed = session.self?.capabilities.includes("trips.submit_own") ?? false,
    recoveryId = issue.failure?.ownResourceId;
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
    <Card className="admin-detail stack">
      <h2>{t("tokens")}</h2>
      <p>{t("tokenHelp")}</p>
      {!allowed ? (
        <p>{t("noSubmit")}</p>
      ) : !session.self?.steamVerified ? (
        <p>{t("steamRequired")}</p>
      ) : (
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            const result = await issue.run("/me/telemetry-tokens", "EnvelopeTokenIssued", {
              label: label.trim(),
            });
            if (result) {
              setSecret(result.data.token);
              setLabel("");
            }
          }}
        >
          <Label htmlFor="telemetry-label">{t("tokenLabel")}</Label>
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
            disabled={
              issue.pending || revoke.pending || issue.seconds > 0 || !!recoveryId || !label.trim()
            }
          >
            {t("createToken")}
          </Button>
        </form>
      )}
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
      <QueryState
        pending={query.isPending}
        error={query.isError}
        retry={query.refetch}
        empty={query.data?.data.data.items.length === 0}
      />
      {query.data?.data.data.items.map((token) => (
        <section className="stack" key={token.id}>
          <h3>{token.label}</h3>
          <p>
            {t("created")}: {token.createdAt}
          </p>
          <p>
            {t("lastUsed")}: {token.lastUsedAt ?? t("neverUsed")}
          </p>
          {token.revokedAt ? (
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
          )}
        </section>
      ))}
      <Pager cursor={cursor} next={query.data?.data.data.nextCursor} setCursor={setCursor} />
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
      {secret && (
        <SensitiveValue
          title={t("tokenSecret")}
          description={t("tokenHelp")}
          value={secret}
          close={() => setSecret(null)}
        />
      )}
    </Card>
  );
}
function ExternalIdentity() {
  const { t } = useTranslation("administration"),
    session = useSession(),
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
  return (
    <Card className="admin-detail stack">
      <h2>{t("identity")}</h2>
      <QueryState pending={query.isPending} error={query.isError} retry={query.refetch} />
      {identity && (
        <>
          <IdentityView data={identity} />
          <Button
            variant="outline"
            disabled={command.pending || command.seconds > 0}
            onClick={() => void request(identity.steamStatus === "verified")}
          >
            {t(identity.steamStatus === "verified" ? "replaceSteam" : "linkSteam")}
          </Button>
          <Button
            variant="ghost"
            onClick={async () => {
              await command.refresh();
              await session.refresh();
            }}
          >
            {t("refresh")}
          </Button>
          {proofId && (
            <section>
              <h3>{t("pendingProof")}</h3>
              <QueryState pending={proof.isPending} error={proof.isError} retry={proof.refetch} />
              {proof.data && (
                <>
                  <p>
                    {t(proof.data.data.data.state, { defaultValue: proof.data.data.data.state })}
                  </p>
                  <p>{proof.data.data.data.candidateSteamProfileUrl}</p>
                  <p>
                    {t("expires")}: {proof.data.data.data.expiresAt}
                  </p>
                </>
              )}
            </section>
          )}
        </>
      )}
      <CommandFeedback command={command} />
      {verification && (
        <div className="stack">
          <p>{t("providerHelp")}</p>
          <a href={verification.verificationUrl} rel="noreferrer">
            {t("providerLink")}
          </a>
          <p>
            {t("expires")}: {verification.expiresAt}
          </p>
          <Button variant="ghost" onClick={() => setVerification(null)}>
            {t("close")}
          </Button>
        </div>
      )}
    </Card>
  );
}
export function ConnectionsPage() {
  const { t } = useTranslation("administration"),
    capabilities = useWorkspaceQuery(
      "/me/connection-capabilities",
      "EnvelopePersonalConnectionCapabilities",
    ),
    data = capabilities.data?.data.data;
  return (
    <div className="administration-page stack">
      <WorkspaceHeading title={t("connections")} />
      <QueryState
        pending={capabilities.isPending}
        error={capabilities.isError}
        retry={capabilities.refetch}
      />
      {data && (
        <>
          {(!data.telemetry || !data.externalIdentities) && <p role="status">{t("partial")}</p>}
          {data.externalIdentities ? (
            <ExternalIdentity />
          ) : (
            <Card>
              <h2>{t("identity")}</h2>
              <p>{t("disabled")}</p>
            </Card>
          )}
          {data.telemetry ? (
            <Tokens />
          ) : (
            <Card>
              <h2>{t("tokens")}</h2>
              <p>{t("disabled")}</p>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
