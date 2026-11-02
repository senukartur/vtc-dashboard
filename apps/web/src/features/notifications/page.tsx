import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { Button, Card } from "../../shared/ui/primitives.js";
import { SegmentedControl } from "../../shared/ui/segmented-control.js";
import { AccountFailure } from "../account/transport.js";
import { EventFailure } from "../events/transport.js";
import {
  FeedState,
  NotificationFailure,
  NotificationRow,
  UnreadSummary,
  useMinuteNow,
  useOnline,
  useTimeDisplay,
} from "./components.js";
import { useNotificationCommand, useNotifications, useReadThrough } from "./controller.js";
import {
  groupByDay,
  preferenceNames,
  type DayGroup,
  type DTO,
  type Notification,
} from "./model.js";
import { notificationRead } from "./transport.js";
class HistoryCursorFailure extends AccountFailure {
  constructor() {
    super("conflict");
  }
}

export function NotificationsPage() {
  const session = useSession(),
    { t } = useTranslation("notifications");
  return session.self?.capabilities.includes("company.read") ? (
    <History />
  ) : (
    <div className="notifications-page">
      <Card className="notifications-forbidden">
        <h1>{t("title")}</h1>
        <p>{t("forbidden")}</p>
      </Card>
    </div>
  );
}
function History() {
  const context = useNotifications(),
    { t } = useTranslation("notifications"),
    [params, setParams] = useSearchParams(),
    readThrough = useReadThrough(),
    online = useOnline(),
    now = useMinuteNow(),
    { timezone } = useTimeDisplay();
  const unread = params.get("filter") === "unread";
  const query = useInfiniteQuery({
    queryKey: ["notifications-history", context.scope],
    meta: { private: true },
    initialPageParam: null as string | null,
    enabled: !context.blocked,
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
    getNextPageParam: (page: DTO["ListNotification"]) => page.nextCursor,
    queryFn: async ({ signal, pageParam }) => {
      try {
        const result = await notificationRead(
          `/notifications/history?limit=25${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`,
          "EnvelopeListNotification",
          signal,
        );
        if (!context.current() || signal.aborted) throw new AccountFailure("unavailable");
        return result.data;
      } catch (error) {
        await context.failure(error, signal);
        if (
          context.current() &&
          !signal.aborted &&
          pageParam &&
          error instanceof EventFailure &&
          error.status === 409
        )
          throw new HistoryCursorFailure();
        throw error;
      }
    },
  });
  const { current, rebaseline, blocked } = context;
  useEffect(() => {
    if (!blocked && current() && query.error instanceof HistoryCursorFailure) {
      // Reset the whole infinite collection. A fresh first page must never be
      // appended into an invalid old cursor slot while stale pages survive.
      rebaseline();
    }
  }, [query.error, blocked, current, rebaseline]);
  const items =
    context.blocked || query.isError
      ? []
      : [
          ...new Map(
            (query.data?.pages.flatMap((page) => page.items) ?? []).map((item) => [item.id, item]),
          ).values(),
        ].filter((item) => !unread || !item.readAt);
  const groups = groupByDay(items, now, timezone);
  return (
    <div className="notifications-page">
      <div className="notifications-header">
        <div className="notifications-heading">
          <h1>{t("title")}</h1>
          <p className="notifications-subtitle">{t("subtitle")}</p>
          <UnreadSummary className="notifications-summary" />
        </div>
        <Button
          variant="outline"
          className="notifications-read-all"
          disabled={readThrough.disabled}
          onClick={readThrough.start}
        >
          {t("readAll")}
        </Button>
        <div className="notifications-status">
          <FeedState offline={!online} showEmpty={false} />
          <NotificationFailure error={readThrough.error} seconds={readThrough.seconds} />
        </div>
      </div>
      <div className="notifications-main">
        <div className="notifications-toolbar">
          <SegmentedControl
            aria-label={t("filter")}
            value={unread ? "unread" : "all"}
            onValueChange={(value) => setParams(value === "unread" ? { filter: "unread" } : {})}
            options={[
              { value: "all", label: t("all") },
              { value: "unread", label: t("unread") },
            ]}
          />
          <p className="notifications-note">{t("subset")}</p>
        </div>
        {query.isPending && !context.blocked && (
          <p role="status" className="notifications-placeholder">
            {t("loading")}
          </p>
        )}
        <NotificationFailure error={context.blocked ? null : query.error} />
        {query.isError && !context.blocked && (
          <Button variant="outline" onClick={() => void query.refetch()}>
            {t("retry")}
          </Button>
        )}
        {groups.map((group) => (
          <DaySection key={group.key} group={group.key} items={group.items} now={now} />
        ))}
        {!context.blocked && query.data && items.length === 0 && (
          <p className="notifications-empty">{t(unread ? "emptyUnread" : "empty")}</p>
        )}
        {query.hasNextPage && !context.blocked && (
          <div className="notifications-more">
            <Button
              variant="outline"
              disabled={query.isFetching}
              onClick={() => void query.fetchNextPage()}
            >
              {t(query.isFetching ? "loading" : "more")}
            </Button>
          </div>
        )}
      </div>
      <aside className="notifications-aside" aria-label={t("howTitle")}>
        <Card className="notifications-how">
          <h2>{t("howTitle")}</h2>
          <ul>
            {(["how1", "how2", "how3", "how4", "how5"] as const).map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ul>
        </Card>
        {!context.blocked && <Preferences />}
      </aside>
    </div>
  );
}
const groupTitles = {
  today: "groupToday",
  yesterday: "groupYesterday",
  earlier: "groupEarlier",
} as const;
function DaySection({
  group,
  items,
  now,
}: {
  group: DayGroup;
  items: Notification[];
  now: number;
}) {
  const { t } = useTranslation("notifications"),
    id = useId();
  return (
    <section className="notifications-day" aria-labelledby={id}>
      <h2 id={id}>{t(groupTitles[group])}</h2>
      <ul className="notification-list">
        {items.map((item) => (
          <NotificationRow key={item.id} item={item} now={now} />
        ))}
      </ul>
    </section>
  );
}
function Preferences() {
  const context = useNotifications(),
    { t } = useTranslation("notifications"),
    command = useNotificationCommand();
  const query = useQuery({
    queryKey: ["notifications-preferences", context.scope],
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
  const [draft, setDraft] = useState<DTO["NotificationPreferences"] | null>(null),
    [saved, setSaved] = useState(false),
    [revision, setRevision] = useState<string | null>(null),
    [reloaded, setReloaded] = useState(false);
  const preferences = draft ?? query.data?.data;
  const conflict =
    command.error instanceof AccountFailure && command.error.kind === "conflict" && !reloaded;
  return (
    <Card className="notifications-preferences">
      <h2>{t("preferences")}</h2>
      <p className="notifications-help">{t("preferenceHelp")}</p>
      {query.isPending && <p role="status">{t("loading")}</p>}
      <NotificationFailure error={query.error} />
      <NotificationFailure
        error={reloaded ? null : command.error}
        seconds={command.seconds}
        preference
      />
      <Button
        variant="ghost"
        size="xs"
        className="notifications-reload"
        disabled={query.isFetching || command.pending}
        onClick={async () => {
          const result = await query.refetch();
          if (!context.current()) return;
          if (result.isSuccess) {
            setDraft(null);
            setRevision(null);
            setSaved(false);
            setReloaded(true);
          }
        }}
      >
        {t("reload")}
      </Button>
      {preferences && !query.isError && (
        <form
          className="notifications-preference-form"
          aria-label={t("preferences")}
          onSubmit={async (event) => {
            event.preventDefault();
            if (conflict) return;
            setSaved(false);
            setReloaded(false);
            const result = await command.run(
              "/me/notification-preferences",
              preferences,
              "EnvelopeNotificationPreferences",
              revision ?? query.data?.etag ?? null,
            );
            if (result && context.current()) {
              setSaved(true);
              setDraft(result.data);
              setRevision(result.etag);
            }
          }}
        >
          <fieldset disabled={command.pending || conflict || command.seconds > 0}>
            <legend className="sr-only">{t("preferences")}</legend>
            {preferenceNames.map((name) => (
              <label className="notification-preference" key={name}>
                <input
                  type="checkbox"
                  name={name}
                  checked={preferences[name]}
                  onChange={(event) => {
                    setDraft({ ...preferences, [name]: event.target.checked });
                    setRevision(revision ?? query.data?.etag ?? null);
                    setSaved(false);
                  }}
                />
                {t(name)}
              </label>
            ))}
          </fieldset>
          <Button disabled={command.pending || conflict || command.seconds > 0}>
            {t(command.pending ? "pending" : "save")}
          </Button>
        </form>
      )}
      {saved && <p role="status">{t("saved")}</p>}
    </Card>
  );
}
