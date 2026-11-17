import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "../../app/Session.js";
import { accountTimeZone } from "../../shared/formatting.js";
import { writeStoredLocale } from "../../shared/i18n.js";
import { Button, Card, FieldError, Select } from "../../shared/ui/primitives.js";
import { SegmentedControl } from "../../shared/ui/segmented-control.js";
import { useMinuteNow } from "../notifications/components.js";
import { OptionalNotifications } from "../notifications/controller.js";
import { NotificationPreferencesCard } from "../notifications/preferences.js";
import { SettingsRow } from "./SettingsRow.js";
import { runtimeZones, type TimezoneChoice, timezoneChoices, timezoneValid } from "./settings.js";
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

const zoneName = (zone: string) => zone.replaceAll("_", " ");
const clockLocales = { ru: "ru-RU", en: "en-GB" } as const;

function TimezoneForm({
  initial,
  busy,
  onEdit,
  save,
}: {
  initial: string | null;
  busy: boolean;
  onEdit: () => void;
  save: (value: string | null) => Promise<boolean>;
}) {
  const { t, i18n } = useTranslation("account");
  // The user's selection, or null while untouched: an untouched field follows the saved value
  // when the session refreshes, while an edit is never overwritten.
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? initial ?? "";
  const [invalid, setInvalid] = useState(false);
  const select = useRef<HTMLSelectElement>(null);
  const now = useMinuteNow();
  // Several hundred offset formatters: built once per mount. The device and saved entries follow
  // the current saved value, so a saved replacement drops an unknown legacy zone without a remount.
  const [zones] = useState(() => runtimeZones());
  const choices = timezoneChoices(initial, now, zones, value);
  const unknown = choices.some((choice) => choice.kind === "unknown" && choice.value === value);
  const id = "preferences-timezone";
  // The preview follows the selection before it is saved; an unknown zone shows UTC honestly.
  const zone = accountTimeZone(value === "" ? null : value);
  const clock = new Intl.DateTimeFormat(
    clockLocales[i18n.resolvedLanguage === "ru" ? "ru" : "en"],
    {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: zone,
    },
  ).format(now);
  const label = (choice: TimezoneChoice) =>
    choice.kind === "device"
      ? t("timezoneDevice", { zone: zoneName(choice.zone), offset: choice.offset })
      : choice.kind === "unknown"
        ? t("timezoneUnknown", { zone: choice.zone })
        : `${zoneName(choice.zone)} (${choice.offset})`;
  return (
    <form
      noValidate
      className="settings-inline-form settings-timezone-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        // "As on the device" saves as null; a zone this browser cannot format is never sent.
        if (value !== "" && !timezoneValid(value)) {
          setInvalid(true);
          select.current?.focus();
          return;
        }
        setInvalid(false);
        const sent = value;
        void save(sent === "" ? null : sent).then((saved) => {
          // A saved selection is the saved value again, so the field follows it from now on,
          // unless the user already picked something else while the save was pending.
          if (saved) setDraft((current) => (current === sent ? null : current));
        });
      }}
    >
      <Select
        ref={select}
        id={id}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-hint${unknown ? ` ${id}-unknown` : ""}${invalid ? ` ${id}-error` : ""}`}
        aria-invalid={invalid}
        value={value}
        onChange={(event) => {
          setDraft(event.target.value);
          setInvalid(false);
          onEdit();
        }}
      >
        {choices.map((choice) => (
          <option key={choice.kind === "device" ? "device" : choice.value} value={choice.value}>
            {label(choice)}
          </option>
        ))}
      </Select>
      <Button type="submit" size="xs" aria-disabled={busy || undefined}>
        {t("saveShort")}
      </Button>
      {unknown && (
        <p id={`${id}-unknown`} className="settings-timezone-unknown">
          {t("timezoneUnknownHint")}
        </p>
      )}
      <p className="settings-timezone-now">
        {t("timezoneNow", { time: clock, zone: zoneName(zone) })}
      </p>
      <FieldError id={`${id}-error`}>{invalid ? t("timezoneChooseListed") : undefined}</FieldError>
    </form>
  );
}

/**
 * Saved account preferences. Language saves as soon as another option is chosen; the timezone
 * saves explicitly, since a closed native select changes on every arrow key. Each command sends
 * the other preference's saved value, never an unsaved edit. Notification switches follow in their
 * own card when the notifications provider is active.
 */
export function PreferencesSection({
  self,
  etag,
}: {
  self: DTO["SelfStage4"];
  etag: string | null;
}) {
  const { t, i18n } = useTranslation("account");
  const session = useSession();
  const request = useCommand();
  const [status, setStatus] = useState<{ row: Row; state: "pending" | "saved" } | null>(null);
  const [review, setReview] = useState(false);
  // Remounts the timezone field with refreshed authoritative values after a conflict.
  const [revision, setRevision] = useState(0);
  const busy = status?.state === "pending" || request.pending;
  // A rate-limit wait blocks saving too; Save shows it as aria-disabled like other forms.
  const waiting = request.seconds > 0;
  const saved = self.preferences;
  async function save(row: Row, preferences: { locale: Locale; displayTimezone: string | null }) {
    if (!etag || busy || waiting) return false;
    setStatus({ row, state: "pending" });
    const result = await request.run("preferences", preferences, etag);
    if (result) {
      setReview(false);
      await session.refresh();
      // A timezone save leaves a session-only interface language alone.
      if (row === "language") {
        writeStoredLocale(preferences.locale);
        await i18n.changeLanguage(preferences.locale);
      }
      setStatus({ row, state: "saved" });
      return true;
    }
    setStatus(null);
    if (request.lastFailure()?.kind === "unauthorized") await session.refresh();
    return false;
  }
  const rowState = (row: Row) => (status?.row === row ? status.state : null);
  return (
    <>
      {review && <p role="alert">{t("preferenceConflict")}</p>}
      <Card className="settings-card" aria-labelledby="preferences-language-time">
        <h2 id="preferences-language-time">{t("languageTimeCard")}</h2>
        <SettingsRow
          id="preferences-language"
          level={3}
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
                  writeStoredLocale(locale);
                  void i18n.changeLanguage(locale);
                } else void save("language", { locale, displayTimezone: saved.displayTimezone });
              }}
            />
          }
        >
          <RowStatus state={rowState("language")} saved={t("languageSaved")} />
        </SettingsRow>
        <SettingsRow
          id="preferences-timezone"
          level={3}
          title={t("timezone")}
          hint={t("timezoneHelp")}
        >
          <TimezoneForm
            key={revision}
            initial={saved.displayTimezone}
            busy={busy || waiting || !etag}
            onEdit={() => {
              if (status?.state === "saved") setStatus(null);
            }}
            save={(displayTimezone) => save("timezone", { locale: saved.locale, displayTimezone })}
          />
          <RowStatus state={rowState("timezone")} saved={t("timezoneSaved")} />
        </SettingsRow>
      </Card>
      {!etag && <p role="alert">{t("sessionUnavailable")}</p>}
      {request.failure && (
        <p role="alert" className="field-error">
          {t(`errors.${request.failure.kind}`)}
        </p>
      )}
      {waiting && <p role="status">{t("wait", { seconds: request.seconds })}</p>}
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
      <OptionalNotifications>
        <NotificationPreferencesCard />
      </OptionalNotifications>
    </>
  );
}
