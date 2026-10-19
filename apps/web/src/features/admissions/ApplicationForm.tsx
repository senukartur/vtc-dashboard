import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Button, FieldError, Input, Label } from "../../shared/ui/primitives.js";
import { applicationPayload, applicationSchema, type ApplicationFields } from "./schema.js";
import {
  ApplicationFailure,
  submissionAttempt,
  submitApplication,
  type SubmissionAttempt,
} from "./transport.js";

export function ApplicationForm() {
  const { t, i18n } = useTranslation("admissions");
  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors },
  } = useForm<ApplicationFields>({
    defaultValues: {
      nickname: "",
      email: "",
      steamProfileUrl: "",
      games: [],
      discord: "",
      introduction: "",
    },
  });
  const attempt = useRef<SubmissionAttempt | null>(null);
  const busy = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const [waitUntil, setWaitUntil] = useState(0);
  const [now, setNow] = useState(Date.now);
  const feedback = useRef<HTMLDivElement | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!waitUntil) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [waitUntil]);
  const mutation = useMutation({
    retry: false,
    mutationFn: async (fields: ApplicationFields) => {
      const payload = applicationPayload(fields);
      attempt.current = submissionAttempt(payload, attempt.current);
      const current = new AbortController();
      controller.current = current;
      const timer = window.setTimeout(() => current.abort(), 15000);
      try {
        await submitApplication(
          attempt.current.payload,
          attempt.current.key,
          i18n.resolvedLanguage === "en" ? "en" : "ru",
          current.signal,
        );
      } finally {
        window.clearTimeout(timer);
      }
    },
    onError: (error) => {
      if (error instanceof ApplicationFailure && error.kind === "limited" && error.retryAfter) {
        setNow(Date.now());
        setWaitUntil(Date.now() + error.retryAfter * 1000);
      }
    },
    onSettled: () => {
      busy.current = false;
    },
  });
  const seconds = Math.max(0, Math.ceil((waitUntil - now) / 1000));
  const failure = mutation.error instanceof ApplicationFailure ? mutation.error.kind : "uncertain";
  const values = watch();
  const changed =
    attempt.current && attempt.current.serialized !== JSON.stringify(applicationPayload(values));
  async function submit(fields: ApplicationFields) {
    if (busy.current || mutation.isSuccess || seconds > 0) return;
    const parsed = applicationSchema.safeParse(fields);
    if (!parsed.success) {
      for (const [index, issue] of parsed.error.issues.entries()) {
        const name = issue.path[0] as keyof ApplicationFields;
        setError(name, { type: "validate", message: name }, { shouldFocus: index === 0 });
      }
      return;
    }
    busy.current = true;
    await mutation.mutateAsync(parsed.data).catch(() => {});
    feedback.current?.focus();
  }
  return (
    <div className="card application-card">
      <h3 id="application-title">{t("title")}</h3>
      <p className="muted">{t("required")}</p>
      <form
        aria-labelledby="application-title"
        noValidate
        onSubmit={handleSubmit(submit)}
        className="stack"
      >
        <fieldset
          disabled={mutation.isPending || mutation.isSuccess}
          className="application-fields"
        >
          {(["nickname", "email", "steamProfileUrl", "discord"] as const).map((name) => (
            <div className="field" key={name}>
              <Label htmlFor={`application-${name}`}>{t(name)}</Label>
              <Input
                id={`application-${name}`}
                type={name === "email" ? "email" : name === "steamProfileUrl" ? "url" : "text"}
                autoComplete={name === "email" ? "email" : name === "nickname" ? "nickname" : "off"}
                aria-required={name !== "discord"}
                aria-invalid={Boolean(errors[name])}
                aria-describedby={
                  `${name === "steamProfileUrl" ? "steam-help " : ""}${errors[name] ? `${name}-error` : ""}`.trim() ||
                  undefined
                }
                {...register(name)}
              />
              <FieldError id={`${name}-error`}>
                {errors[name] ? t(`errors.${name}`) : undefined}
              </FieldError>
              {name === "steamProfileUrl" && (
                <p id="steam-help" className="muted">
                  {t("steamHelp")}
                </p>
              )}
            </div>
          ))}
          <fieldset
            className="game-options"
            aria-describedby={errors.games ? "games-error" : undefined}
            aria-invalid={Boolean(errors.games)}
          >
            <legend>{t("games")}</legend>
            {(["ets2", "ats"] as const).map((game) => (
              <label key={game} className="checkbox-label">
                <input type="checkbox" value={game} {...register("games")} />
                {game.toUpperCase()}
              </label>
            ))}
            <FieldError id="games-error">{errors.games ? t("errors.games") : undefined}</FieldError>
          </fieldset>
          <div className="field">
            <Label htmlFor="application-introduction">{t("introduction")}</Label>
            <textarea
              className="input"
              id="application-introduction"
              rows={4}
              aria-invalid={Boolean(errors.introduction)}
              aria-describedby={errors.introduction ? "introduction-error" : undefined}
              {...register("introduction")}
            />
            <FieldError id="introduction-error">
              {errors.introduction ? t("errors.introduction") : undefined}
            </FieldError>
          </div>
        </fieldset>
        <p className="muted">{t("privacy")}</p>
        {Object.keys(errors).length > 0 && (
          <p className="field-error" role="alert">
            {t("errors.summary")}
          </p>
        )}
        <div ref={feedback} tabIndex={-1} aria-live="polite" className="submission-feedback">
          {mutation.isSuccess ? (
            <p role="status" className="confirmation">
              {t("success")}
            </p>
          ) : mutation.isError ? (
            <p role="alert" className="field-error">
              {t(`errors.${failure}`)}
            </p>
          ) : null}
          {mutation.isError && changed && <p className="muted">{t("errors.changed")}</p>}
          {seconds > 0 && <p>{t("errors.wait", { seconds })}</p>}
        </div>
        {!mutation.isSuccess && (
          <Button type="submit" disabled={mutation.isPending || seconds > 0}>
            {t(mutation.isPending ? "pending" : mutation.isError ? "retry" : "submit")}
          </Button>
        )}
      </form>
    </div>
  );
}
