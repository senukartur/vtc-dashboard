import { Popover } from "radix-ui";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { useSession } from "../../app/Session.js";
import { Badge, Button } from "../../shared/ui/primitives.js";
import { AccountFailure } from "../account/transport.js";
import { eventTime } from "../events/model.js";
import { useNotificationCommand, useNotifications } from "./controller.js";
import { messageName, notificationTarget, type Notification } from "./model.js";

export function NotificationFailure({
  error,
  seconds = 0,
  preference = false,
}: {
  error: unknown;
  seconds?: number;
  preference?: boolean;
}) {
  const { t } = useTranslation("notifications");
  return error ? (
    <div role="alert">
      <p>
        {t(
          error instanceof AccountFailure
            ? preference && error.kind === "conflict"
              ? "preferenceConflict"
              : error.kind
            : "unavailable",
        )}
      </p>
      {seconds > 0 && <p>{t("wait", { seconds })}</p>}
    </div>
  ) : null;
}
export function NotificationMessage({ item }: { item: Notification }) {
  const { t } = useTranslation("notifications"),
    name = messageName(item);
  return (
    <>
      {name === "unknown"
        ? t("unknown")
        : t(`messages.${name}`, {
            actor: item.display.actorNickname ?? t("actor"),
            event: item.display.eventTitle ?? t("event"),
            game: item.display.game?.toUpperCase() ?? "",
          })}
    </>
  );
}
export function NotificationTime({ value }: { value: string }) {
  const session = useSession(),
    { i18n } = useTranslation("notifications"),
    [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const timezone = session.self?.preferences.displayTimezone ?? "UTC",
    locale = i18n.resolvedLanguage ?? "en";
  const minutes = Math.round((Date.parse(value) - now) / 60000),
    unit = Math.abs(minutes) < 60 ? "minute" : Math.abs(minutes) < 1440 ? "hour" : "day",
    amount = unit === "minute" ? minutes : Math.round(minutes / (unit === "hour" ? 60 : 1440));
  const absolute = eventTime(value, locale, timezone);
  return (
    <time dateTime={value} title={absolute}>
      <span>{new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(amount, unit)}</span>
      <small>{absolute}</small>
    </time>
  );
}
export function NotificationRow({
  item,
  compact = false,
}: {
  item: Notification;
  compact?: boolean;
}) {
  const { t } = useTranslation("notifications"),
    command = useNotificationCommand(),
    context = useNotifications(),
    target = notificationTarget(item);
  const kind = item.category.startsWith("trip.")
    ? "Trip"
    : item.category.startsWith("event.")
      ? "Event"
      : /^(qualification|promotion)\./.test(item.category)
        ? "Qualification"
        : /^(application|member)\./.test(item.category)
          ? "Administration"
          : "Other";
  const icon = { Trip: "↗", Event: "◷", Qualification: "◇", Administration: "▤", Other: "•" }[kind];
  return (
    <li className={`notification-row ${item.readAt ? "" : "notification-unread"}`}>
      <span className={`notification-icon notification-${kind.toLowerCase()}`} aria-hidden="true">
        {icon}
      </span>
      <div className="notification-body">
        <div className="notification-meta">
          <span>{t(`category${kind}`)}</span>
          {!item.readAt && <Badge>{t("new")}</Badge>}
        </div>
        <p className="notification-message">
          <NotificationMessage item={item} />
        </p>
        <NotificationTime value={item.occurredAt} />
        <div className="notification-actions">
          {target ? <Link to={target}>{t("open")}</Link> : <span>{t("noTarget")}</span>}
          {!compact && !item.readAt && (
            <Button
              variant="ghost"
              size="xs"
              disabled={context.blocked || command.pending || command.seconds > 0}
              onClick={() =>
                void command.run(
                  `/notifications/${item.id}/read`,
                  undefined,
                  "EnvelopeCommandResult",
                )
              }
            >
              {t("read")}
            </Button>
          )}
        </div>
        <NotificationFailure error={command.error} seconds={command.seconds} />
      </div>
    </li>
  );
}
export function NotificationBell() {
  const context = useNotifications(),
    { t } = useTranslation("notifications"),
    [open, setOpen] = useState(false);
  const count = context.feed?.unreadCount;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button
          variant="outline"
          className="notification-bell"
          aria-label={`${t("bell")} · ${count === undefined ? t("unknownCount") : t("unreadCount", { count })}`}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
          </svg>
          <span aria-hidden="true">{count === undefined ? "—" : count > 99 ? "99+" : count}</span>
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="notification-popover"
          sideOffset={8}
          align="end"
          collisionPadding={12}
          aria-label={t("title")}
        >
          <h2>{t("title")}</h2>
          <FeedState />
          {context.feed && !context.blocked && (
            <ul className="notification-list">
              {context.feed.items
                .slice(-5)
                .reverse()
                .map((item) => (
                  <NotificationRow key={item.id} item={item} compact />
                ))}
            </ul>
          )}
          <Link to="/account/notifications" onClick={() => setOpen(false)}>
            {t("history")}
          </Link>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
export function FeedState() {
  const context = useNotifications(),
    { t } = useTranslation("notifications");
  return (
    <>
      {context.blocked ? (
        <p role="alert">{t("forbidden")}</p>
      ) : context.error ? (
        <NotificationFailure error={context.error} />
      ) : !context.feed ? (
        <p role="status">{t("loading")}</p>
      ) : context.fetching ? (
        <p role="status">{t("refreshing")}</p>
      ) : context.feed.items.length === 0 ? (
        <p>{t("empty")}</p>
      ) : null}
      {(context.error || context.blocked) && (
        <Button variant="outline" onClick={context.refresh}>
          {t("retry")}
        </Button>
      )}
    </>
  );
}
export function NotificationToasts() {
  const { toasts, dismiss } = useNotifications(),
    { t } = useTranslation("notifications");
  return (
    <aside className="notification-toasts" aria-label={t("title")}>
      {toasts.map((item) => (
        <section className="notification-toast" key={item.id}>
          <p role="status">
            <NotificationMessage item={item} />
          </p>
          <NotificationTime value={item.occurredAt} />
          <div className="notification-actions">
            {notificationTarget(item) && (
              <Link
                to={notificationTarget(item) ?? "/account/notifications"}
                onClick={() => dismiss(item.id)}
              >
                {t("open")}
              </Link>
            )}
            <Button variant="ghost" size="xs" onClick={() => dismiss(item.id)}>
              {t("dismiss")}
            </Button>
          </div>
        </section>
      ))}
    </aside>
  );
}
