import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { Button, Card } from "../../shared/ui/primitives.js";
import { AccountFailure } from "../account/transport.js";
import { EventFailure } from "../events/transport.js";
import { FeedState, NotificationFailure, NotificationRow } from "./components.js";
import { useNotificationCommand, useNotifications } from "./controller.js";
import { preferenceNames, type DTO } from "./model.js";
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
    <Card>
      <h1>{t("title")}</h1>
      <p>{t("forbidden")}</p>
    </Card>
  );
}
function History() {
  const context = useNotifications(),
    { t } = useTranslation("notifications"),
    [params, setParams] = useSearchParams(),
    command = useNotificationCommand();
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
  const checkpoint = context.checkpoint();
  return (
    <div className="stack notifications-page">
      <div>
        <h1>{t("title")}</h1>
        <p>{t("delivery")}</p>
      </div>
      <Card className="stack">
        <div className="notification-toolbar">
          <h2>{t("history")}</h2>
          <Button
            variant="outline"
            disabled={context.blocked || !checkpoint || command.pending || command.seconds > 0}
            onClick={() => {
              const cursor = context.checkpoint();
              if (cursor)
                void command.run(
                  "/notifications/read-all",
                  { throughCursor: cursor },
                  "EnvelopeCommandResult",
                );
            }}
          >
            {t("readAll")}
          </Button>
        </div>
        <FeedState />
        <NotificationFailure error={command.error} seconds={command.seconds} />
        <fieldset className="notification-filters">
          <legend className="sr-only">{t("history")}</legend>
          <Button variant="outline" aria-pressed={!unread} onClick={() => setParams({})}>
            {t("all")}
          </Button>
          <Button
            variant="outline"
            aria-pressed={unread}
            onClick={() => setParams({ filter: "unread" })}
          >
            {t("unread")}
          </Button>
        </fieldset>
        <p className="muted">{t("subset")}</p>
        {query.isPending && !context.blocked && <p role="status">{t("loading")}</p>}
        <NotificationFailure error={context.blocked ? null : query.error} />
        {query.isError && !context.blocked && (
          <Button onClick={() => void query.refetch()}>{t("retry")}</Button>
        )}
        <ul className="notification-list">
          {items.map((item) => (
            <NotificationRow key={item.id} item={item} />
          ))}
        </ul>
        {!context.blocked && query.data && items.length === 0 && (
          <p>{t(unread ? "emptyUnread" : "empty")}</p>
        )}
        {query.hasNextPage && !context.blocked && (
          <Button
            variant="outline"
            disabled={query.isFetching}
            onClick={() => void query.fetchNextPage()}
          >
            {t(query.isFetching ? "loading" : "more")}
          </Button>
        )}
      </Card>
      {!context.blocked && <Preferences />}
    </div>
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
    <Card className="stack">
      <h2>{t("preferences")}</h2>
      <p>{t("preferenceHelp")}</p>
      {query.isPending && <p role="status">{t("loading")}</p>}
      <NotificationFailure error={query.error} />
      <NotificationFailure
        error={reloaded ? null : command.error}
        seconds={command.seconds}
        preference
      />
      <Button
        variant="ghost"
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
          className="stack"
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
