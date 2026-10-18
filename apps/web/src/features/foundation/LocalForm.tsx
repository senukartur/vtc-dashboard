import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Button, Card, FieldError, Input, Label } from "../../shared/ui/primitives.js";

const noteSchema = z.string().trim().min(1);

export function LocalForm() {
  const { t } = useTranslation("foundation");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<{ note: string }>({ defaultValues: { note: "" } });
  const [fail, setFail] = useState(false);
  const [result, setResult] = useState<"failed" | "confirmed" | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function submit() {
    setResult(null);
    const attempt = new AbortController();
    controller.current = attempt;
    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, 500);
      attempt.signal.addEventListener(
        "abort",
        () => {
          window.clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
    if (!attempt.signal.aborted) setResult(fail ? "failed" : "confirmed");
  }
  return (
    <Card aria-labelledby="form-title">
      <h2 id="form-title">{t("formTitle")}</h2>
      <p className="muted">{t("formHelp")}</p>
      <form onSubmit={handleSubmit(submit)} noValidate className="stack">
        <div className="field">
          <Label htmlFor="preview-note">{t("note")}</Label>
          <Input
            id="preview-note"
            placeholder={t("notePlaceholder")}
            aria-invalid={Boolean(errors.note)}
            aria-describedby={errors.note ? "note-error" : undefined}
            {...register("note", {
              validate: (value) => noteSchema.safeParse(value).success || "required",
            })}
          />
          <FieldError id="note-error">{errors.note ? t("required") : undefined}</FieldError>
        </div>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={fail}
            onChange={(event) => setFail(event.target.checked)}
            disabled={isSubmitting}
          />
          {t("simulateFailure")}
        </label>
        <Button type="submit" disabled={isSubmitting}>
          {t(isSubmitting ? "pending" : "submit")}
        </Button>
        <div aria-live="polite">
          {result && (
            <p
              className={result === "failed" ? "field-error" : "confirmation"}
              role={result === "failed" ? "alert" : "status"}
            >
              {t(result === "failed" ? "formFailed" : "confirmed")}
            </p>
          )}
        </div>
      </form>
    </Card>
  );
}
