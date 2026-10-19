import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Button, Input, Label, FieldError } from "../../shared/ui/primitives.js";
import type { AccountFailure } from "./transport.js";
export interface AccountField {
  name: string;
  label: string;
  type?: "email" | "password" | "text";
  autocomplete?: string;
  initial?: string;
  hint?: string | undefined;
  validate: (value: string, values: Record<string, string>) => boolean;
  options?: { value: string; label: string }[];
}
export const emailValid = (value: string) =>
  value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
export const newPasswordValid = (value: string) => value.length >= 12 && value.length <= 128;
export const codeValid = (value: string) => value.length >= 1 && value.length <= 128;
export function Form({
  id,
  fields,
  submit,
  pending,
  failure,
  seconds = 0,
  action = "continue",
  help,
}: {
  id: string;
  fields: AccountField[];
  submit: (values: Record<string, string>) => Promise<void>;
  pending: boolean;
  failure: AccountFailure | null;
  seconds?: number;
  action?: string;
  help?: string;
}) {
  const { t } = useTranslation("account");
  const {
    register,
    handleSubmit,
    setError,
    clearErrors,
    formState: { errors },
  } = useForm<Record<string, string>>({
    defaultValues: Object.fromEntries(fields.map((f) => [f.name, f.initial ?? ""])),
  });
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [invalid, setInvalid] = useState(0);
  const summary = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (invalid) summary.current?.focus();
  }, [invalid]);
  return (
    <form
      noValidate
      className="stack"
      aria-label={t(id)}
      onSubmit={handleSubmit(async (values) => {
        clearErrors();
        const invalidFields = fields.filter((f) => !f.validate(values[f.name] ?? "", values));
        if (invalidFields.length) {
          for (const f of invalidFields) setError(f.name, { type: "validate" });
          setInvalid((n) => n + 1);
          return;
        }
        await submit(values);
      })}
    >
      {help && <p className="muted">{t(help)}</p>}
      {Object.keys(errors).length > 0 && (
        <div className="error-summary" role="alert" tabIndex={-1} ref={summary}>
          <p>{t("validationSummary")}</p>
          <ul>
            {fields
              .filter((f) => errors[f.name])
              .map((f) => (
                <li key={f.name}>
                  <a
                    href={`#${id}-${f.name}`}
                    onClick={(e) => {
                      e.preventDefault();
                      document.getElementById(`${id}-${f.name}`)?.focus();
                    }}
                  >
                    {t(f.label)}
                  </a>
                </li>
              ))}
          </ul>
        </div>
      )}
      <fieldset className="account-fields stack" disabled={pending}>
        {fields.map((field) => (
          <div className="field" key={field.name}>
            <Label htmlFor={`${id}-${field.name}`}>{t(field.label)}</Label>
            {field.hint && (
              <p id={`${id}-${field.name}-hint`} className="muted">
                {t(field.hint)}
              </p>
            )}
            {field.options ? (
              <select
                id={`${id}-${field.name}`}
                className="input"
                aria-invalid={Boolean(errors[field.name])}
                aria-describedby={`${id}-${field.name}-error`}
                {...register(field.name)}
              >
                {field.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                id={`${id}-${field.name}`}
                type={
                  field.type === "password" && visible[field.name] ? "text" : (field.type ?? "text")
                }
                autoComplete={field.autocomplete ?? "off"}
                aria-required="true"
                aria-invalid={Boolean(errors[field.name])}
                aria-describedby={
                  [
                    field.hint ? `${id}-${field.name}-hint` : "",
                    errors[field.name] ? `${id}-${field.name}-error` : "",
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
                {...register(field.name)}
              />
            )}
            {field.type === "password" && (
              <Button
                type="button"
                variant="ghost"
                aria-pressed={Boolean(visible[field.name])}
                aria-controls={`${id}-${field.name}`}
                onClick={() => setVisible((old) => ({ ...old, [field.name]: !old[field.name] }))}
              >
                {t(visible[field.name] ? "hidePassword" : "showPassword", {
                  field: t(field.label),
                })}
              </Button>
            )}
            <FieldError id={`${id}-${field.name}-error`}>
              {errors[field.name] ? t("invalidField", { field: t(field.label) }) : undefined}
            </FieldError>
          </div>
        ))}
      </fieldset>
      {failure && (
        <p role="alert" className="field-error">
          {t(`errors.${failure.kind}`)}
        </p>
      )}
      {seconds > 0 && <p role="status">{t("wait", { seconds })}</p>}
      <Button type="submit" disabled={pending || seconds > 0}>
        {t(pending ? "working" : failure ? "retry" : action)}
      </Button>
    </form>
  );
}
