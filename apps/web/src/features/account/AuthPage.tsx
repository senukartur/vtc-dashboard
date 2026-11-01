import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { loginDestination } from "../../app/navigation-model.js";
import { useSession } from "../../app/Session.js";
import { publicContent, publicPath } from "../landing/content.js";
import { AuthBrand } from "./AuthBrand.js";
import { Form, emailValid, newPasswordValid, type AccountField } from "./Form.js";
import { useCommand } from "./useCommand.js";
import type { LinkHandoff } from "./link.js";
export type AuthKind = "login" | "recovery" | "reset" | "invitation";
export function AuthPage({ kind, handoff }: { kind: AuthKind; handoff?: LinkHandoff | undefined }) {
  const { t, i18n } = useTranslation("account");
  const locale = i18n.resolvedLanguage === "en" ? "en" : "ru";
  const session = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const request = useCommand();
  const token = useRef(handoff?.token ?? null);
  useEffect(() => {
    if (handoff) handoff.token = null;
  }, [handoff]);
  const [success, setSuccess] = useState(false);
  const linked = kind === "reset" || kind === "invitation";
  const unavailable =
    !success &&
    linked &&
    (!token.current ||
      request.failure?.kind === "conflict" ||
      request.failure?.kind === "unauthorized");
  const fields: AccountField[] =
    kind === "login" || kind === "recovery"
      ? [
          {
            name: "email",
            label: "email",
            type: "email",
            autocomplete: "username",
            validate: emailValid,
          },
        ]
      : [];
  if (kind !== "recovery")
    fields.push({
      name: "password",
      label: linked ? "newPassword" : "password",
      type: "password",
      autocomplete: linked ? "new-password" : "current-password",
      hint: linked ? "passwordHelp" : undefined,
      labelAction:
        kind === "login" ? <Link to="/password-recovery">{t("forgotPassword")}</Link> : undefined,
      validate: linked ? newPasswordValid : (value) => value.length >= 1 && value.length <= 1024,
    });
  if (linked)
    fields.push({
      name: "confirmation",
      label: "confirmation",
      type: "password",
      autocomplete: "new-password",
      validate: (value, values) => value === values.password,
    });
  return (
    <div className="auth-layout">
      <div className="auth-panel stack">
        {kind !== "login" && (
          <Link className="auth-back" to="/login">
            <svg
              aria-hidden="true"
              focusable="false"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M15 6l-6 6 6 6" />
            </svg>
            {t("backToLogin")}
          </Link>
        )}
        <h1>{t(unavailable ? "linkUnavailable" : success ? `${kind}SuccessTitle` : kind)}</h1>
        {unavailable ? (
          <p>{t(kind === "invitation" ? "invitationUnavailable" : "resetUnavailable")}</p>
        ) : success ? (
          <p role="status">{t(`${kind}Success`)}</p>
        ) : (
          <Form
            key={kind}
            id={kind}
            fields={fields}
            {...request}
            help={`${kind}Help`}
            action={kind}
            submit={async (values) => {
              const result =
                kind === "login"
                  ? await request.run("login", {
                      email: values.email ?? "",
                      password: values.password ?? "",
                    })
                  : kind === "recovery"
                    ? await request.run("recovery", { email: values.email ?? "" })
                    : kind === "reset"
                      ? await request.run("reset", {
                          token: token.current ?? "",
                          newPassword: values.password ?? "",
                        })
                      : await request.run("invitation", {
                          invitationToken: token.current ?? "",
                          password: values.password ?? "",
                        });
              if (!result) return;
              token.current = null;
              if (kind === "login") {
                session.changed();
                navigate(loginDestination(location.state), { replace: true });
              } else {
                if (kind === "reset") session.end();
                setSuccess(true);
              }
            }}
          />
        )}
        {kind === "invitation" && !unavailable && !success && (
          <div className="auth-steps">
            <h2 id="invitation-steps" className="auth-steps-title">
              {t("nextSteps")}
            </h2>
            <ol aria-labelledby="invitation-steps">
              <li aria-current="step">{t("stepPassword")}</li>
              <li>{t("stepSignIn")}</li>
              <li>{t("stepSteam")}</li>
            </ol>
          </div>
        )}
        {kind === "login" && !success && (
          <p className="auth-alt">
            <span>{t("notMember")}</span>
            <Link to={`${publicPath(locale)}#apply`}>
              {publicContent[locale].apply}
              <span aria-hidden="true">→</span>
            </Link>
          </p>
        )}
        {unavailable && kind === "reset" && <Link to="/password-recovery">{t("recovery")}</Link>}
        <Link to={publicPath(locale)}>{t("home")}</Link>
      </div>
      <AuthBrand locale={locale} />
    </div>
  );
}
