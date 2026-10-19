import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { Button, Card } from "../../shared/ui/primitives.js";
import { formatUtc } from "../../shared/formatting.js";
import { Form, codeValid, emailValid, newPasswordValid, type AccountField } from "./Form.js";
import { AccountFailure, readPending, type DTO } from "./transport.js";
import { useCommand } from "./useCommand.js";

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
function Preferences({ self, etag }: { self: DTO["Self"]; etag: string | null }) {
  const { t, i18n } = useTranslation("account");
  const session = useSession();
  const request = useCommand();
  const recheck = useRecheck();
  const [review, setReview] = useState(false);
  const [saved, setSaved] = useState(false);
  const fields: AccountField[] = [
    {
      name: "locale",
      label: "locale",
      initial: self.preferences.locale,
      validate: (v) => ["ru", "en"].includes(v),
      options: [
        { value: "ru", label: "Русский" },
        { value: "en", label: "English" },
      ],
    },
    {
      name: "timezone",
      label: "timezone",
      initial: self.preferences.displayTimezone,
      hint: "timezoneHelp",
      validate: (v) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: v }).format();
          return v.length > 0 && v.length <= 128;
        } catch {
          return false;
        }
      },
    },
  ];
  return (
    <Card id="preferences" className="stack">
      <h2>{t("preferences")}</h2>
      {review && <p role="alert">{t("preferenceConflict")}</p>}
      {saved && <p role="status">{t("saved")}</p>}
      {!etag ? (
        <p role="alert">{t("sessionUnavailable")}</p>
      ) : (
        <Form
          key={review ? etag : "preferences"}
          id="preferences"
          fields={fields}
          {...request}
          action="save"
          submit={async (values) => {
            setSaved(false);
            const result = await request.run(
              "preferences",
              { locale: values.locale as "ru" | "en", displayTimezone: values.timezone ?? "" },
              etag,
            );
            if (result) {
              setSaved(true);
              setReview(false);
              await session.refresh();
              await i18n.changeLanguage(values.locale);
            } else if (request.lastFailure()?.kind === "unauthorized") await recheck();
          }}
        />
      )}
      {request.failure?.kind === "conflict" && (
        <Button
          variant="outline"
          onClick={async () => {
            await session.refresh();
            setReview(true);
            request.reset();
          }}
        >
          {t("refreshPreferences")}
        </Button>
      )}
    </Card>
  );
}
function Verification({ verified }: { verified: boolean }) {
  const { t } = useTranslation("account");
  const session = useSession();
  const request = useCommand();
  const confirm = useCommand();
  const recheck = useRecheck();
  const [challenge, setChallenge] = useState<DTO["Challenge"] | null>(null);
  return (
    <Card id="verification" className="stack">
      <h2>{t("verification")}</h2>
      <p>{t(verified ? "verified" : "unverified")}</p>
      {!verified && (
        <>
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
                    await session.refresh();
                  } else await recheck();
                }}
              />
            </>
          )}
        </>
      )}
    </Card>
  );
}
function PasswordChange({ verified }: { verified: boolean }) {
  const { t } = useTranslation("account");
  const session = useSession();
  const request = useCommand();
  const confirm = useCommand();
  const recheck = useRecheck();
  const navigate = useNavigate();
  const [challenge, setChallenge] = useState<DTO["Challenge"] | null>(null);
  return (
    <Card id="password" className="stack">
      <h2>{t("passwordChange")}</h2>
      {!verified ? (
        <p>{t("verifyFirst")}</p>
      ) : (
        <>
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
        </>
      )}
    </Card>
  );
}
function EmailChange({ verified }: { verified: boolean }) {
  const { t, i18n } = useTranslation("account");
  const session = useSession();
  const request = useCommand();
  const confirm = useCommand();
  const recheck = useRecheck();
  const navigate = useNavigate();
  const pending = useQuery({
    queryKey: ["account-email-change", session.generation],
    meta: { private: true },
    queryFn: ({ signal }) => readPending(signal),
    retry: false,
    gcTime: 0,
    enabled: verified,
  });
  const current = pending.data?.data.data.pending;
  const endSession = session.end;
  useEffect(() => {
    // This authenticated read has no code-validation 401; it signals session loss.
    if (pending.error instanceof AccountFailure && pending.error.kind === "unauthorized")
      endSession();
  }, [pending.error, endSession]);
  return (
    <Card id="email" className="stack">
      <h2>{t("emailChange")}</h2>
      {!verified ? (
        <p>{t("verifyFirst")}</p>
      ) : (
        <>
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
            action={current ? "replaceRequest" : "requestEmailCode"}
            submit={async (values) => {
              const result = await request.run("challenge", {
                purpose: "email_change",
                newEmail: values.email ?? "",
              });
              if (result) {
                confirm.reset();
                await pending.refetch();
              } else await recheck();
            }}
          />
          {pending.isPending ? (
            <p role="status">{t("checking")}</p>
          ) : pending.isError ? (
            <>
              <p role="alert">{t("pendingUnavailable")}</p>
              <Button variant="outline" onClick={() => void pending.refetch()}>
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
                action="confirmEmail"
                submit={async (values) => {
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
                }}
              />
              <Button variant="ghost" onClick={() => void pending.refetch()}>
                {t("refreshPending")}
              </Button>
            </>
          ) : (
            <p>{t("noPending")}</p>
          )}
        </>
      )}
    </Card>
  );
}
export function AccountPage() {
  const session = useSession();
  const { t } = useTranslation("account");
  const logout = useCommand();
  const [leaving, setLeaving] = useState(false);
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);
  const self = session.self;
  if (!self) return null;
  async function signOut() {
    const current = lifetime.current;
    if (!current || current.signal.aborted) return;
    setLeaving(true);
    const result = await logout.run("logout", undefined);
    if (current.signal.aborted) return;
    if (result) session.end();
    else await session.confirmSessionLoss(current.signal);
  }
  if (leaving)
    return (
      <Card className="auth-card stack">
        <h1>{t("logout")}</h1>
        <p role="status">{t(logout.pending ? "working" : "logoutUncertain")}</p>
        <Form id="logout" fields={[]} {...logout} action="logout" submit={signOut} />
        <Button
          variant="outline"
          disabled={logout.pending}
          onClick={async () => {
            await session.refresh();
            setLeaving(false);
          }}
        >
          {t("checkSession")}
        </Button>
      </Card>
    );
  return (
    <div className="account-page stack">
      <header className="page-heading">
        <p className="eyebrow">Yukon Union</p>
        <h1>{t("account")}</h1>
        <p>{self.member.nickname}</p>
        <p className="muted account-address">{self.email}</p>
        <Button variant="outline" onClick={() => void signOut()}>
          {t("logout")}
        </Button>
      </header>
      <nav className="account-sections" aria-label={t("accountSections")}>
        {["preferences", "verification", "password", "email", "connections"].map((section) => (
          <a key={section} href={`#${section}`}>
            {t(
              section === "password"
                ? "passwordChange"
                : section === "email"
                  ? "emailChange"
                  : section,
            )}
          </a>
        ))}
      </nav>
      <div className="account-grid">
        <Preferences self={self} etag={session.etag} />
        <Verification verified={self.emailVerified} />
        <PasswordChange verified={self.emailVerified} />
        <EmailChange verified={self.emailVerified} />
        <Card id="connections" className="stack">
          <h2>{t("connections")}</h2>
          <p>{t("sessionConfirmed")}</p>
          <p>{t(self.steamVerified ? "steamVerified" : "steamMissing")}</p>
          <p>{t(self.missingSetup.length ? "setupIncomplete" : "setupComplete")}</p>
          <p className="muted">{t("futureConnections")}</p>
          <Button disabled variant="outline">
            {t("connectionUnavailable")}
          </Button>
          <Link to="/status">{t("applicationConnection")}</Link>
        </Card>
      </div>
    </div>
  );
}
