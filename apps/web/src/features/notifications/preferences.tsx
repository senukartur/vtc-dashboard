import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "../../app/Session.js";
import { Button, Card } from "../../shared/ui/primitives.js";
import { AccountFailure } from "../account/transport.js";
import { NotificationFailure, useOnline } from "./components.js";
import { useNotificationCommand, useNotifications } from "./controller.js";
import {
  type DTO,
  type PreferenceName,
  preferenceAudience,
  preferenceLabel,
  visiblePreferences,
} from "./model.js";
import { notificationRead } from "./transport.js";

type Preferences = DTO["NotificationPreferences"];
const retryable = ["uncertain", "unavailable", "limited"];

/**
 * Notification switches for the account Preferences section. Rows follow exactly the keys the
 * server returned; each switch saves at once with the full returned key set and the latest ETag.
 * Needs the notifications provider (see `OptionalNotifications`).
 */
export function NotificationPreferencesCard() {
  const context = useNotifications(),
    { t } = useTranslation("notifications"),
    id = useId();
  return (
    <Card className="settings-card notification-preferences-card" aria-labelledby={`${id}-title`}>
      <div className="notification-preferences-header">
        <h2 id={`${id}-title`}>{t("title")}</h2>
        <span className="notification-preferences-note">{t("savedImmediately")}</span>
      </div>
      <p className="notification-preferences-hint">{t("toggleHint")}</p>
      {context.blocked ? (
        <div className="notification-preferences-state">
          <p role="alert" className="notification-preferences-forbidden">
            {t("forbidden")}
          </p>
          <Button variant="outline" size="xs" onClick={context.refresh}>
            {t("retry")}
          </Button>
        </div>
      ) : (
        <PreferenceSwitches id={id} />
      )}
    </Card>
  );
}

function PreferenceSwitches({ id }: { id: string }) {
  const context = useNotifications(),
    session = useSession(),
    client = useQueryClient(),
    { t } = useTranslation("notifications"),
    command = useNotificationCommand(),
    online = useOnline();
  const key = ["notifications-preferences", context.scope];
  const query = useQuery({
    queryKey: key,
    meta: { private: true },
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      try {
        const result = await notificationRead(
          "/me/notification-preferences",
          "EnvelopeNotificationPreferences",
          signal,
        );
        if (!context.current() || signal.aborted) throw new AccountFailure("unavailable");
        if (!result.etag || !/^"[^"\r\n]+"$/.test(result.etag))
          throw new AccountFailure("unavailable");
        return result;
      } catch (error) {
        await context.failure(error, signal);
        throw error;
      }
    },
  });
  // The switch being saved and its requested position; null once the server answered.
  const [pending, setPending] = useState<{ name: PreferenceName; value: boolean } | null>(null),
    // The last write that failed retryably; Retry resends it unchanged under the same key.
    [retry, setRetry] = useState<{ name: PreferenceName; value: boolean } | null>(null),
    [saved, setSaved] = useState(false),
    // A command failure dismissed by a successful reload.
    [cleared, setCleared] = useState<unknown>(null);
  const failure = command.error === cleared ? null : command.error;
  const kind = failure ? (failure instanceof AccountFailure ? failure.kind : "uncertain") : null;
  // 409/412/428 and 422 lock every switch until the preferences are read again.
  const locked = kind === "conflict" || kind === "invalid";
  const inert =
    !query.data || query.isFetching || command.pending || command.seconds > 0 || !online || locked;
  const data = query.data?.data;
  const capabilities = session.self?.capabilities ?? [];
  async function send(name: PreferenceName, value: boolean) {
    const read = query.data;
    if (inert || !read) return;
    // Exactly the keys the read returned, so the server's exact-key check accepts the write.
    const body: Preferences = { ...read.data, [name]: value };
    setPending({ name, value });
    setRetry({ name, value });
    setSaved(false);
    const result = await command.run(
      "/me/notification-preferences",
      body,
      "EnvelopeNotificationPreferences",
      read.etag,
    );
    setPending(null);
    if (!result || !context.current()) return;
    // The saved data and its strong ETag become the base of the next switch.
    client.setQueryData(key, result);
    setRetry(null);
    setSaved(true);
  }
  async function reload() {
    const result = await query.refetch();
    if (!context.current() || !result.isSuccess) return;
    setCleared(command.error);
    setRetry(null);
    setSaved(false);
  }
  const status = query.isPending
    ? t("loading")
    : pending
      ? t("pending")
      : saved && !failure
        ? t("saved")
        : "";
  return (
    <>
      <p role="status" className="notification-preferences-status">
        {status}
      </p>
      <NotificationFailure error={query.error} />
      <NotificationFailure error={failure} seconds={command.seconds} preference />
      {!online && <p className="notification-preferences-note">{t("offline")}</p>}
      {(query.isError || locked || (retry && kind && retryable.includes(kind))) && (
        <div className="notification-preferences-actions">
          {retry && kind && retryable.includes(kind) && !query.isError && (
            <Button
              variant="outline"
              size="xs"
              aria-disabled={inert || undefined}
              onClick={() => void send(retry.name, retry.value)}
            >
              {t("retrySave")}
            </Button>
          )}
          {(query.isError || locked) && (
            <Button
              variant="outline"
              size="xs"
              aria-disabled={query.isFetching || command.pending || undefined}
              onClick={() => {
                if (!query.isFetching && !command.pending) void reload();
              }}
            >
              {t("reload")}
            </Button>
          )}
        </div>
      )}
      {data && !query.isError && (
        <ul className="notification-switches">
          {visiblePreferences(data).map((name) => {
            const input = `${id}-${name}`,
              audience = (preferenceAudience as readonly string[]).includes(name);
            const checked = pending?.name === name ? pending.value : data[name] === true;
            return (
              <li className="notification-switch-row" key={name}>
                <span className="notification-switch-text">
                  <label htmlFor={input}>
                    {t(`toggles.${preferenceLabel(name, data, capabilities)}`)}
                  </label>
                  {audience && (
                    <span id={`${input}-audience`} className="notification-switch-audience">
                      {" "}
                      · {t(`audience.${name}`)}
                    </span>
                  )}
                </span>
                <span className="notification-switch">
                  <input
                    id={input}
                    type="checkbox"
                    role="switch"
                    checked={checked}
                    aria-checked={checked}
                    aria-describedby={audience ? `${input}-audience` : undefined}
                    aria-disabled={inert || undefined}
                    aria-busy={pending?.name === name || undefined}
                    onChange={(event) => void send(name, event.target.checked)}
                  />
                  <span className="notification-switch-track" aria-hidden="true" />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
