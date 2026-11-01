import { useQuery } from "@tanstack/react-query";
import { type RefObject, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { formatUtc } from "../../shared/formatting.js";
import { Badge, Button } from "../../shared/ui/primitives.js";
import { type AccountField, codeValid, emailValid, Form, newPasswordValid } from "./Form.js";
import { SettingsRow } from "./SettingsRow.js";
import { useSignOut } from "./sign-out.js";
import { AccountFailure, type DTO, readPending } from "./transport.js";
import { useCommand } from "./useCommand.js";

const explanationId = "security-verify-explanation";
const codeField: AccountField = {
  name: "code",
  label: "code",
  type: "password",
  autocomplete: "one-time-code",
  validate: codeValid,
};
function passwordFields(): AccountField[] {
  return [
    {
      name: "password",
      label: "newPassword",
      type: "password",
      autocomplete: "new-password",
      hint: "passwordHelp",
      validate: newPasswordValid,
    },
    {
      name: "confirmation",
      label: "confirmation",
      type: "password",
      autocomplete: "new-password",
      validate: (value, values) => value === values.password,
    },
  ];
}
function useRecheck() {
  const session = useSession();
  return session.refresh;
}

/**
 * Row action that opens a disclosure. Its accessible name stays fixed ("Change email");
 * aria-expanded carries the state. Until the email is verified it stays focusable but
 * inert (aria-disabled) and is described by the verification notice.
 */
function ChangeToggle({
  target,
  locked,
  expanded,
  controls,
  onToggle,
  ref,
}: {
  target: "email" | "password";
  locked: boolean;
  expanded: boolean;
  controls: string;
  onToggle: () => void;
  ref?: RefObject<HTMLButtonElement | null>;
}) {
  const { t } = useTranslation("account");
  return (
    <Button
      ref={ref}
      type="button"
      size="xs"
      variant="outline"
      {...(locked
        ? { "aria-disabled": true, "aria-describedby": explanationId }
        : { "aria-expanded": expanded, "aria-controls": controls })}
      onClick={() => {
        if (!locked) onToggle();
      }}
    >
      {t("change")} <span className="visually-hidden">{t(`changeTarget.${target}`)}</span>
    </Button>
  );
}

function Verification({ onVerified }: { onVerified: () => void }) {
  const { t } = useTranslation("account");
  const session = useSession();
  const request = useCommand();
  const confirm = useCommand();
  const recheck = useRecheck();
  const [challenge, setChallenge] = useState<DTO["Challenge"] | null>(null);
  return (
    <div className="settings-notice">
      <div className="settings-notice-text">
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 3l10 18H2zM12 10v4M12 17v.5" />
        </svg>
        <p id={explanationId}>{t("verifyFirst")}</p>
      </div>
      <Form
        id="verifyRequest"
        fields={[]}
        {...request}
        action={challenge ? "reissue" : "requestVerification"}
        submit={async () => {
          const result = await request.run("verifyRequest", undefined);
          if (result && "expiresAt" in result) {
            setChallenge(result);
            confirm.reset();
          } else await recheck();
        }}
      />
      {challenge && (
        <>
          <p role="status">{t("deliveryPending")}</p>
          <Form
            key={challenge.id}
            id="verify"
            fields={[codeField]}
            {...confirm}
            submit={async (values) => {
              const result = await confirm.run("verify", {
                challengeId: challenge.id,
                code: values.code ?? "",
              });
              if (result) {
                setChallenge(null);
                onVerified();
                await session.refresh();
              } else await recheck();
            }}
          />
        </>
      )}
    </div>
  );
}

function PasswordRow({ verified }: { verified: boolean }) {
  const { t } = useTranslation("account");
  const session = useSession();
  const request = useCommand();
  const confirm = useCommand();
  const recheck = useRecheck();
  const navigate = useNavigate();
  const [challenge, setChallenge] = useState<DTO["Challenge"] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const panel = "security-password-panel";
  return (
    <SettingsRow
      id="security-password"
      title={t("password")}
      hint={t("passwordHint")}
      action={
        <ChangeToggle
          target="password"
          locked={!verified}
          expanded={expanded}
          controls={panel}
          onToggle={() => setExpanded((open) => !open)}
        />
      }
    >
      {verified && (
        // Collapsing only hides the panel, so a requested code and typed values survive.
        <div id={panel} className="settings-panel" hidden={!expanded}>
          <Form
            id="passwordChallenge"
            fields={[]}
            {...request}
            action={challenge ? "reissue" : "requestPasswordCode"}
            submit={async () => {
              const result = await request.run("challenge", { purpose: "password_change" });
              if (result && "expiresAt" in result) {
                setChallenge(result);
                confirm.reset();
              } else await recheck();
            }}
          />
          {challenge && (
            <>
              <p role="status">{t("deliveryPending")}</p>
              <Form
                key={challenge.id}
                id="passwordChange"
                fields={[codeField, ...passwordFields()]}
                {...confirm}
                action="changePassword"
                submit={async (values) => {
                  const result = await confirm.run("password", {
                    kind: "password_change",
                    challengeId: challenge.id,
                    code: values.code ?? "",
                    newPassword: values.password ?? "",
                  });
                  if (result) {
                    session.end();
                    navigate("/login", { replace: true });
                  } else await recheck();
                }}
              />
            </>
          )}
        </div>
      )}
    </SettingsRow>
  );
}

function EmailValue({ address, verified }: { address: string; verified: boolean }) {
  const { t } = useTranslation("account");
  return (
    <>
      <span className="account-address">{address}</span>
      <Badge className={verified ? "badge-accepted" : "badge-pending"}>
        {t(verified ? "emailVerifiedBadge" : "emailUnverifiedBadge")}
      </Badge>
    </>
  );
}

function LockedEmailRow({ address }: { address: string }) {
  const { t } = useTranslation("account");
  return (
    <SettingsRow
      id="security-email"
      title={t("email")}
      hint={t("emailHint")}
      value={<EmailValue address={address} verified={false} />}
      action={
        <ChangeToggle
          target="email"
          locked
          expanded={false}
          controls="security-email-panel"
          onToggle={() => {}}
        />
      }
    />
  );
}

/** Owns the protected two-proof replacement; mounted only for a verified current email. */
function EmailRow({
  address,
  toggleRef,
}: {
  address: string;
  toggleRef: RefObject<HTMLButtonElement | null>;
}) {
  const { t, i18n } = useTranslation("account");
  const session = useSession();
  const request = useCommand();
  const confirm = useCommand();
  const recheck = useRecheck();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const pending = useQuery({
    queryKey: ["account-email-change", session.generation],
    meta: { private: true },
    queryFn: ({ signal }) => readPending(signal),
    retry: false,
    gcTime: 0,
  });
  const current = pending.data?.data.data.pending;
  const interaction = useRef(false);
  const [coordinating, setCoordinating] = useState(false);
  const busy = coordinating || request.pending || confirm.pending || pending.isFetching;
  async function coordinate(action: () => Promise<unknown>) {
    if (interaction.current || pending.isFetching) return;
    interaction.current = true;
    setCoordinating(true);
    try {
      await action();
    } finally {
      interaction.current = false;
      setCoordinating(false);
    }
  }
  const endSession = session.end;
  useEffect(() => {
    // This authenticated read has no code-validation 401; it signals session loss.
    if (pending.error instanceof AccountFailure && pending.error.kind === "unauthorized")
      endSession();
  }, [pending.error, endSession]);
  // A replacement in progress (or an unknown pending state) opens the forms, also after reload.
  // The disclosure then stays open (latched) so a later "no pending request" result stays visible.
  const forced = current != null || pending.isError;
  if (forced && !expanded) setExpanded(true);
  // Refresh controls live in the result branch that a completed read may replace; when the
  // pressed one disappears, keep focus on the new result instead of dropping it to the page.
  const result = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const origin = returnFocus.current;
    if (!origin || pending.isFetching) return;
    returnFocus.current = null;
    const active = document.activeElement;
    if (!origin.isConnected || active === null || active === document.body) result.current?.focus();
  });
  function refetchFrom(button: HTMLElement) {
    returnFocus.current = button;
    void coordinate(() => pending.refetch());
  }
  const panel = "security-email-panel";
  return (
    <SettingsRow
      id="security-email"
      title={t("email")}
      hint={t("emailHint")}
      value={<EmailValue address={address} verified />}
      action={
        current != null ? (
          <Badge className="badge-pending">{t("emailPendingBadge")}</Badge>
        ) : pending.isError ? undefined : (
          <ChangeToggle
            ref={toggleRef}
            target="email"
            locked={false}
            expanded={expanded}
            controls={panel}
            onToggle={() => setExpanded((value) => !value)}
          />
        )
      }
    >
      <div id={panel} className="settings-panel" hidden={!expanded}>
        <p>{t("emailChangeHelp")}</p>
        <Form
          id="emailChallenge"
          fields={[
            {
              name: "email",
              label: "newEmail",
              type: "email",
              autocomplete: "email",
              validate: emailValid,
            },
          ]}
          {...request}
          pending={busy}
          action={current ? "replaceRequest" : "requestEmailCode"}
          submit={(values) =>
            coordinate(async () => {
              const result = await request.run("challenge", {
                purpose: "email_change",
                newEmail: values.email ?? "",
              });
              if (result) {
                confirm.reset();
              } else await recheck();
              // An uncertain command may have committed a new generation too.
              await pending.refetch();
            })
          }
        />
        <div ref={result} tabIndex={-1} className="settings-panel">
          {pending.isPending ? (
            <p role="status">{t("checking")}</p>
          ) : pending.isError ? (
            <>
              <p role="alert">{t("pendingUnavailable")}</p>
              <Button
                variant="outline"
                disabled={busy}
                onClick={(event) => refetchFrom(event.currentTarget)}
              >
                {t("refresh")}
              </Button>
            </>
          ) : current ? (
            <>
              <p role="status">
                {t(current.stage === "current_email" ? "currentStage" : "proposedStage", {
                  email: current.proposedEmail,
                })}
              </p>
              <p className="muted">
                {t("expires", {
                  date: formatUtc(
                    current.expiresAt,
                    i18n.resolvedLanguage === "en" ? "en" : "ru",
                    session.self?.preferences.displayTimezone ?? "UTC",
                  ),
                })}
              </p>
              <Form
                key={current.id}
                id="emailConfirm"
                fields={[codeField]}
                {...confirm}
                pending={busy}
                action="confirmEmail"
                submit={(values) =>
                  coordinate(async () => {
                    const result =
                      current.stage === "current_email"
                        ? await confirm.run("emailCurrent", {
                            kind: "email_change",
                            challengeId: current.id,
                            code: values.code ?? "",
                          })
                        : await confirm.run("emailProposed", {
                            challengeId: current.id,
                            code: values.code ?? "",
                          });
                    if (result) {
                      if (current.stage === "current_email") await pending.refetch();
                      else {
                        session.end();
                        navigate("/login", { replace: true });
                      }
                    } else {
                      await recheck();
                    }
                  })
                }
              />
              <Button
                variant="ghost"
                disabled={busy}
                onClick={(event) => refetchFrom(event.currentTarget)}
              >
                {t("refreshPending")}
              </Button>
            </>
          ) : (
            <p>{t("noPending")}</p>
          )}
        </div>
      </div>
    </SettingsRow>
  );
}

function SessionRow() {
  const { t } = useTranslation("account");
  const signOut = useSignOut();
  return (
    <SettingsRow
      id="security-session"
      title={t("session")}
      hint={t("sessionHint")}
      action={
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={() => {
            // The sign-out status replaces this page; keep focus on main instead of losing it.
            document.getElementById("main-content")?.focus();
            void signOut.start();
          }}
        >
          {t("logout")}
        </Button>
      }
    />
  );
}

export function SecuritySection({ self }: { self: DTO["Self"] }) {
  const { t } = useTranslation("account");
  const verified = self.emailVerified;
  const [justVerified, setJustVerified] = useState(false);
  const changeEmail = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    // Once the refreshed session confirms the verification, continue at the unlocked action.
    if (justVerified && verified) changeEmail.current?.focus();
  }, [justVerified, verified]);
  return (
    <>
      <p role="status" className="settings-status settings-status-saved">
        {justVerified ? t("verified") : ""}
      </p>
      {!verified && <Verification onVerified={() => setJustVerified(true)} />}
      <div className="settings-card">
        {verified ? (
          <EmailRow address={self.email} toggleRef={changeEmail} />
        ) : (
          <LockedEmailRow address={self.email} />
        )}
        <PasswordRow verified={verified} />
        <SessionRow />
      </div>
    </>
  );
}
