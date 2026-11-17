import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "../../app/Session.js";
import { InfoTip } from "../../shared/ui/info-tip.js";
import { Button, Card } from "../../shared/ui/primitives.js";
import { AccountFailure } from "../account/transport.js";
import { NotificationFailure, useOnline } from "./components.js";
import { useNotificationCommand, useNotifications } from "./controller.js";
import {
  type DTO,
  type GroupState,
  groupDetails,
  groupState,
  groupWrite,
  type PreferenceGroupId,
  preferenceGroups,
  visibleGroups,
} from "./model.js";
import { notificationRead } from "./transport.js";

type Preferences = DTO["NotificationPreferences"];
const retryable = ["uncertain", "unavailable", "limited"];

/**
 * Notification settings rows for the account Preferences section (mockup P14). A row renders when
 * the server returned at least one of its keys and switches all of them; differing values show
 * as partly on. Each change saves at once with the full returned key set and the latest ETag.
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
        <InfoTip label={t("aboutTip")} title={t("title")}>
          <p>{t("toggleHint")}</p>
          <p>{t("how5")}</p>
        </InfoTip>
      </div>
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
  // The row being saved and its requested position; null once the server answered.
  const [pending, setPending] = useState<{ group: PreferenceGroupId; value: boolean } | null>(null),
    // The last write that failed retryably; Retry resends it unchanged under the same key.
    [retry, setRetry] = useState<{ group: PreferenceGroupId; value: boolean } | null>(null),
    [saved, setSaved] = useState(false),
    // A command failure dismissed by a successful reload.
    [cleared, setCleared] = useState<unknown>(null);
  const failure = command.error === cleared ? null : command.error;
  const kind = failure ? (failure instanceof AccountFailure ? failure.kind : "uncertain") : null;
  // 409/412/428 and 422 lock every row until the preferences are read again.
  const locked = kind === "conflict" || kind === "invalid";
  const inert =
    !query.data || query.isFetching || command.pending || command.seconds > 0 || !online || locked;
  const data = query.data?.data;
  const capabilities = session.self?.capabilities ?? [];
  async function send(group: PreferenceGroupId, value: boolean) {
    const read = query.data;
    if (inert || !read) return;
    // Exactly the keys the read returned, so the server's exact-key check accepts the write; the
    // same row and value over an unchanged read give the same body, so a retry keeps its key.
    const keys = preferenceGroups.find((item) => item.id === group)?.keys ?? [];
    const body: Preferences = groupWrite(read.data, keys, value);
    setPending({ group, value });
    setRetry({ group, value });
    setSaved(false);
    const result = await command.run(
      "/me/notification-preferences",
      body,
      "EnvelopeNotificationPreferences",
      read.etag,
    );
    setPending(null);
    if (!result || !context.current()) return;
    // The saved data and its strong ETag become the base of the next change.
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
              onClick={() => void send(retry.group, retry.value)}
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
        <>
          <div className="notification-switch-columns">
            <span>{t("columns.name")}</span>
            <span className="notification-switch-cell">{t("columns.site")}</span>
          </div>
          <ul className="notification-switches">
            {visibleGroups(data).map((group) => {
              const input = `${id}-${group.id}`,
                name = t(`groups.${group.id}`),
                confirmed = groupState(data, group.keys),
                busy = pending?.group === group.id;
              // A pending row shows its requested position; otherwise the server-confirmed one.
              const shown: GroupState = busy ? (pending.value ? "on" : "off") : confirmed;
              return (
                <li className="notification-switch-row" key={group.id}>
                  <span className="notification-switch-text">
                    <label htmlFor={input}>{name}</label>
                    {group.audience && (
                      <span id={`${input}-audience`} className="notification-switch-audience">
                        {" "}
                        · {t(`audience.${group.id}`)}
                      </span>
                    )}{" "}
                    <InfoTip label={t("rowTip", { name })} title={name}>
                      {groupDetails(group, data, capabilities).map((detail) => (
                        <p key={detail}>{t(`details.${detail}`)}</p>
                      ))}
                      {confirmed === "mixed" && <p>{t("details.mixed")}</p>}
                    </InfoTip>
                  </span>
                  <span className="notification-switch-cell">
                    <span className="notification-switch">
                      <input
                        id={input}
                        type="checkbox"
                        checked={shown === "on"}
                        // Partly on has no attribute; the DOM property is set on every render.
                        ref={(element) => {
                          if (element) element.indeterminate = shown === "mixed";
                        }}
                        aria-describedby={group.audience ? `${input}-audience` : undefined}
                        aria-disabled={inert || undefined}
                        aria-busy={busy || undefined}
                        onChange={(event) => {
                          // A click clears the mixed mark even when nothing is sent.
                          event.currentTarget.indeterminate = shown === "mixed";
                          // Off and partly on turn every key of the row on; on turns them off.
                          void send(group.id, shown !== "on");
                        }}
                      />
                      <span className="notification-switch-track" aria-hidden="true" />
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}
