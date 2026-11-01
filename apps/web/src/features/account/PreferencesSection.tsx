import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "../../app/Session.js";
import { Button, FieldError, Input } from "../../shared/ui/primitives.js";
import { SegmentedControl } from "../../shared/ui/segmented-control.js";
import { SettingsRow } from "./SettingsRow.js";
import { timezoneOptions, timezoneValid } from "./settings.js";
import type { DTO } from "./transport.js";
import { useCommand } from "./useCommand.js";

type Locale = "ru" | "en";
type Row = "language" | "timezone";
const languages = [
  { value: "ru", label: "Русский", lang: "ru" },
  { value: "en", label: "English", lang: "en" },
] as const;

function RowStatus({ state, saved }: { state: "pending" | "saved" | null; saved: string }) {
  const { t } = useTranslation("account");
  return (
    <p
      role="status"
      className={state === "saved" ? "settings-status settings-status-saved" : "settings-status"}
    >
      {state === "saved" && (
        <svg
          aria-hidden="true"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 12l5 5 9-10" />
        </svg>
      )}
      {state === "pending" ? t("working") : state === "saved" ? saved : ""}
    </p>
  );
}

function TimezoneForm({
  initial,
  busy,
  onEdit,
  save,
}: {
  initial: string;
  busy: boolean;
  onEdit: () => void;
  save: (value: string) => void;
}) {
  const { t } = useTranslation("account");
  const [value, setValue] = useState(initial);
  const [invalid, setInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const options = timezoneOptions(initial);
  const id = "preferences-timezone";
  return (
    <form
      noValidate
      className="settings-inline-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        const next = value.trim();
        if (!timezoneValid(next)) {
          setInvalid(true);
          input.current?.focus();
          return;
        }
        setInvalid(false);
        save(next);
      }}
    >
      <Input
        ref={input}
        id={id}
        list={`${id}-options`}
        autoComplete="off"
        spellCheck={false}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-hint${invalid ? ` ${id}-error` : ""}`}
        aria-invalid={invalid}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setInvalid(false);
          onEdit();
        }}
      />
      <datalist id={`${id}-options`}>
        {options.map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>
      <Button type="submit" size="xs" aria-disabled={busy || undefined}>
        {t("saveShort")}
      </Button>
      <FieldError id={`${id}-error`}>
        {invalid ? t("invalidField", { field: t("timezone") }) : undefined}
      </FieldError>
    </form>
  );
}

/**
 * Saved account preferences. Language saves as soon as another option is chosen; the timezone
 * saves explicitly. Each command sends the other preference's saved value, never an unsaved edit.
 */
export function PreferencesSection({ self, etag }: { self: DTO["Self"]; etag: string | null }) {
  const { t, i18n } = useTranslation("account");
  const session = useSession();
  const request = useCommand();
  const [status, setStatus] = useState<{ row: Row; state: "pending" | "saved" } | null>(null);
  const [review, setReview] = useState(false);
  // Remounts the timezone field with refreshed authoritative values after a conflict.
  const [revision, setRevision] = useState(0);
  const busy = status?.state === "pending" || request.pending;
  const saved = self.preferences;
  async function save(row: Row, preferences: { locale: Locale; displayTimezone: string }) {
    if (!etag || busy || request.seconds > 0) return;
    setStatus({ row, state: "pending" });
    const result = await request.run("preferences", preferences, etag);
    if (result) {
      setReview(false);
      await session.refresh();
      // A timezone save leaves a session-only interface language alone.
      if (row === "language") await i18n.changeLanguage(preferences.locale);
      setStatus({ row, state: "saved" });
    } else {
      setStatus(null);
      if (request.lastFailure()?.kind === "unauthorized") await session.refresh();
    }
  }
  const rowState = (row: Row) => (status?.row === row ? status.state : null);
  return (
    <>
      {review && <p role="alert">{t("preferenceConflict")}</p>}
      <div className="settings-card">
        <SettingsRow
          id="preferences-language"
          title={t("languageRow")}
          hint={t("languageHint")}
          action={
            <SegmentedControl
              aria-labelledby="preferences-language-title"
              value={saved.locale}
              options={languages}
              size="xs"
              onValueChange={(locale) => {
                if (busy) return;
                if (locale === saved.locale) {
                  // Choosing the saved language only applies it to this interface.
                  setStatus(null);
                  void i18n.changeLanguage(locale);
                } else void save("language", { locale, displayTimezone: saved.displayTimezone });
              }}
            />
          }
        >
          <RowStatus state={rowState("language")} saved={t("languageSaved")} />
        </SettingsRow>
        <SettingsRow id="preferences-timezone" title={t("timezone")} hint={t("timezoneHelp")}>
          <TimezoneForm
            key={revision}
            initial={saved.displayTimezone}
            busy={busy || !etag}
            onEdit={() => {
              if (status?.state === "saved") setStatus(null);
            }}
            save={(displayTimezone) =>
              void save("timezone", { locale: saved.locale, displayTimezone })
            }
          />
          <RowStatus state={rowState("timezone")} saved={t("timezoneSaved")} />
        </SettingsRow>
      </div>
      {!etag && <p role="alert">{t("sessionUnavailable")}</p>}
      {request.failure && (
        <p role="alert" className="field-error">
          {t(`errors.${request.failure.kind}`)}
        </p>
      )}
      {request.seconds > 0 && <p role="status">{t("wait", { seconds: request.seconds })}</p>}
      {request.failure?.kind === "conflict" && (
        <Button
          type="button"
          variant="outline"
          onClick={async () => {
            await session.refresh();
            setReview(true);
            setRevision((value) => value + 1);
            request.reset();
          }}
        >
          {t("refreshPreferences")}
        </Button>
      )}
    </>
  );
}
