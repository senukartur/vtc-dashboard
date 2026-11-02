import { Popover } from "radix-ui";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { useSession } from "../../app/Session.js";
import { Badge, Button } from "../../shared/ui/primitives.js";
import { AccountFailure } from "../account/transport.js";
import { eventTime } from "../events/model.js";
import { useNotificationCommand, useNotifications, useReadThrough } from "./controller.js";
import {
  badgeText,
  messageName,
  notificationTarget,
  notificationVisual,
  type Notification,
  type NotificationIconName,
} from "./model.js";

export function NotificationFailure({
  error,
  seconds = 0,
  preference = false,
  announce = true,
}: {
  error: unknown;
  seconds?: number;
  preference?: boolean;
  /** False when the same failure is already announced elsewhere on screen. */
  announce?: boolean;
}) {
  const { t } = useTranslation("notifications");
  return error ? (
    <div role={announce ? "alert" : undefined} className="notification-failure">
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
/** Wall clock that advances once a minute, for relative times and day groups. */
export function useMinuteNow() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
const tabbable =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
function tabbables(root: ParentNode) {
  return [...root.querySelectorAll<HTMLElement>(tabbable)].filter(
    (element) => element.getClientRects().length > 0 && !element.closest("[inert]"),
  );
}
/** The control that follows `trigger` in page order, outside the portaled popup. */
function nextAfter(trigger: HTMLElement, popup: HTMLElement) {
  const candidates = tabbables(document).filter((element) => !popup.contains(element));
  const index = candidates.indexOf(trigger);
  // A trigger outside the computed order must not fall back to the first page control.
  return index < 0 ? null : (candidates[index + 1] ?? null);
}
function subscribeOnline(change: () => void) {
  window.addEventListener("online", change);
  window.addEventListener("offline", change);
  return () => {
    window.removeEventListener("online", change);
    window.removeEventListener("offline", change);
  };
}
/** Browser connectivity for the offline status line; polling keeps its own visibility checks. */
export function useOnline() {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}
/** Display timezone and locale used for absolute timestamps and day groups. */
export function useTimeDisplay() {
  const session = useSession(),
    { i18n } = useTranslation("notifications");
  return {
    timezone: session.self?.preferences.displayTimezone ?? "UTC",
    locale: i18n.resolvedLanguage ?? "en",
  };
}
function shortRelative(value: string, now: number, locale: string) {
  const minutes = Math.round((Date.parse(value) - now) / 60000);
  if (!Number.isFinite(minutes)) return "";
  const unit = Math.abs(minutes) < 60 ? "minute" : Math.abs(minutes) < 1440 ? "hour" : "day",
    amount = unit === "minute" ? minutes : Math.round(minutes / (unit === "hour" ? 60 : 1440));
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" }).format(
    amount,
    unit,
  );
}
function absoluteTime(value: string, locale: string, timezone: string) {
  return Number.isFinite(Date.parse(value)) ? eventTime(value, locale, timezone) : "";
}
const iconPaths: Record<NotificationIconName, string> = {
  truck:
    "M3 7h11v9H3zM14 10h4l3 3v3h-7M5 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0M15 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0",
  check: "M5 12l5 5L20 7",
  cross: "M6 6l12 12M18 6L6 18",
  review: "M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9",
  edit: "M4 20h4L19 9l-4-4L4 16zM13 7l4 4",
  calendar: "M3 5h18v16H3zM3 10h18M8 3v4M16 3v4",
  route:
    "M6 19a2 2 0 1 0 0-4a2 2 0 1 0 0 4M18 9a2 2 0 1 0 0-4a2 2 0 1 0 0 4M6 15V9a3 3 0 0 1 3-3h7M18 9v6a3 3 0 0 1-3 3H8",
  clock: "M12 7v5l3 2M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18",
  award: "M12 3a6 6 0 1 0 0 12a6 6 0 1 0 0-12M8.5 14 7 21l5-3 5 3-1.5-7",
  up: "M12 19V5M5 12l7-7 7 7",
  document: "M4 4h16v16H4zM8 9h8M8 13h8M8 17h5",
  user: "M8 8a4 4 0 1 0 8 0a4 4 0 1 0-8 0M4 21c1-4 4-6 8-6s7 2 8 6",
  dot: "M12 10a2 2 0 1 0 0 4a2 2 0 1 0 0-4",
};
function NotificationIcon({ item, size }: { item: Notification; size: "sm" | "md" }) {
  const visual = notificationVisual(item);
  return (
    <span
      className={`notification-icon notification-icon-${size} notification-tone-${visual.tone}`}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={iconPaths[visual.icon]} />
      </svg>
    </span>
  );
}
/** Page row: category, new badge and absolute time, short relative time, Open and Mark read. */
export function NotificationRow({ item, now }: { item: Notification; now: number }) {
  const { t } = useTranslation("notifications"),
    command = useNotificationCommand(),
    context = useNotifications(),
    { locale, timezone } = useTimeDisplay(),
    target = notificationTarget(item),
    visual = notificationVisual(item);
  const absolute = absoluteTime(item.occurredAt, locale, timezone);
  return (
    <li className={`notification-row${item.readAt ? "" : " notification-unread"}`}>
      <NotificationIcon item={item} size="md" />
      <div className="notification-body">
        <p className="notification-message">
          <NotificationMessage item={item} />
        </p>
        <div className="notification-meta">
          <span>{t(`category${visual.kind}`)}</span>
          {!item.readAt && <Badge size="xs">{t("new")}</Badge>}
          <time className="notification-absolute" dateTime={item.occurredAt}>
            {absolute}
          </time>
        </div>
        {!target && <p className="notification-note">{t("noTarget")}</p>}
        <NotificationFailure error={command.error} seconds={command.seconds} />
      </div>
      <div className="notification-side">
        <span className="notification-relative" title={absolute}>
          {shortRelative(item.occurredAt, now, locale)}
        </span>
        {(target || !item.readAt) && (
          <div className="notification-actions">
            {target && (
              <Link className="button button-outline button-xs notification-open" to={target}>
                {t("open")}
              </Link>
            )}
            {!item.readAt && (
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
        )}
      </div>
    </li>
  );
}
/** Popup entry: a link to the target, or a static row explaining that it is unavailable. */
export function NotificationMenuItem({
  item,
  now,
  onNavigate,
}: {
  item: Notification;
  now: number;
  onNavigate: () => void;
}) {
  const { t } = useTranslation("notifications"),
    { locale, timezone } = useTimeDisplay(),
    target = notificationTarget(item),
    visual = notificationVisual(item),
    unread = !item.readAt;
  const content = (
    <>
      <NotificationIcon item={item} size="sm" />
      <span className="notification-menu-body">
        <span className="notification-menu-title">
          {unread && <span className="visually-hidden">{t("unreadPrefix")} </span>}
          <NotificationMessage item={item} />
        </span>
        <span className="notification-menu-meta">
          {t(`category${visual.kind}`)} ·{" "}
          <time dateTime={item.occurredAt}>{absoluteTime(item.occurredAt, locale, timezone)}</time>
        </span>
        {!target && <span className="notification-menu-note">{t("noTarget")}</span>}
      </span>
      <span className="notification-menu-side" aria-hidden="true">
        <span>{shortRelative(item.occurredAt, now, locale)}</span>
        {unread && <span className="notification-dot" />}
      </span>
    </>
  );
  return (
    <li className={`notification-menu-item${unread ? " notification-unread" : ""}`}>
      {target ? (
        <Link className="notification-menu-link" to={target} onClick={onNavigate}>
          {content}
        </Link>
      ) : (
        <div className="notification-menu-static">{content}</div>
      )}
    </li>
  );
}
/** Unread summary for the popup and page header; an unknown count never reads as zero. */
export function UnreadSummary({ className }: { className?: string }) {
  const context = useNotifications(),
    { t } = useTranslation("notifications"),
    count = context.feed?.unreadCount;
  const text =
    context.blocked || context.error
      ? t("unknownCount")
      : count === undefined
        ? ""
        : count > 0
          ? t("unreadSummary", { count })
          : t("allRead");
  return <span className={className}>{text}</span>;
}
export function NotificationBell() {
  const context = useNotifications(),
    { t } = useTranslation("notifications"),
    readThrough = useReadThrough(),
    online = useOnline(),
    now = useMinuteNow(),
    titleId = useId(),
    // The notifications page header announces the same shared read-through failure.
    onPage = /^\/account\/notifications\/?$/i.test(useLocation().pathname),
    [open, setOpen] = useState(false),
    // Path at the moment a row or "All notifications" link was chosen; the shell focuses main.
    routedFrom = useRef<string | null>(null),
    trigger = useRef<HTMLButtonElement>(null),
    // Where focus continues after Tab leaves the last popup control.
    continueTo = useRef<HTMLElement | null>(null);
  const count = context.feed?.unreadCount,
    failed = context.blocked || !!context.error,
    badge = badgeText(count, failed);
  // Announce a known count only when it changes from an earlier known value in this scope.
  const [known, setKnown] = useState({ scope: context.scope, count }),
    [announcement, setAnnouncement] = useState("");
  if (known.scope !== context.scope) {
    setKnown({ scope: context.scope, count });
    setAnnouncement("");
  } else if (count !== undefined && count !== known.count) {
    setKnown({ scope: context.scope, count });
    if (known.count !== undefined) setAnnouncement(t("unreadAnnouncement", { count }));
  }
  const navigate = () => {
    routedFrom.current = window.location.pathname;
    setOpen(false);
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen} modal={false}>
      <Popover.Trigger asChild>
        <Button
          ref={trigger}
          variant="ghost"
          className="notification-bell"
          aria-label={`${t("bell")} · ${count === undefined ? t("unknownCount") : t("unreadCount", { count })}`}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0" />
          </svg>
          {badge && (
            <span
              className={`notification-badge${badge === "?" ? " notification-badge-unknown" : ""}`}
              aria-hidden="true"
            >
              {badge}
            </span>
          )}
        </Button>
      </Popover.Trigger>
      {/* A bare live region, not role="status": the shell is on every page, and pages own
          their single status message. */}
      <span
        className="visually-hidden notification-announcement"
        aria-live="polite"
        aria-atomic="true"
      >
        {announcement}
      </span>
      <Popover.Portal>
        <Popover.Content
          className="notification-popover"
          sideOffset={6}
          align="end"
          collisionPadding={12}
          aria-labelledby={titleId}
          onOpenAutoFocus={(event) => {
            // Radix skips links when choosing initial focus; start on the newest row link, then
            // a recovery action, then "All notifications", and never on the bulk read-through.
            event.preventDefault();
            const content = event.currentTarget as HTMLElement;
            const first = content.querySelector<HTMLElement>(
              ".notification-menu-link, .notification-state button, .notification-popover-footer a",
            );
            (first ?? content).focus({ preventScroll: true });
          }}
          onKeyDown={(event) => {
            // The popup is portaled to the end of the page, so keep its Tab order next to the bell:
            // Tab past the last control closes it and continues after the bell; Shift+Tab before
            // the first control closes it and returns to the bell.
            if (event.key !== "Tab" || !trigger.current) return;
            const controls = tabbables(event.currentTarget),
              edge = event.shiftKey ? controls[0] : controls.at(-1);
            if (!edge || document.activeElement !== edge) return;
            event.preventDefault();
            continueTo.current = event.shiftKey
              ? trigger.current
              : nextAfter(trigger.current, event.currentTarget);
            setOpen(false);
          }}
          onCloseAutoFocus={(event) => {
            const from = routedFrom.current,
              next = continueTo.current;
            routedFrom.current = null;
            continueTo.current = null;
            if (from !== null && from !== window.location.pathname) event.preventDefault();
            else if (next?.isConnected) {
              event.preventDefault();
              next.focus();
            }
          }}
        >
          <div className="notification-popover-header">
            <h2 id={titleId}>{t("title")}</h2>
            <UnreadSummary className="notification-popover-summary" />
          </div>
          <FeedState offline={!online} />
          {context.feed && !context.blocked && context.feed.items.length > 0 && (
            <ul className="notification-menu">
              {context.feed.items
                .slice(-5)
                .reverse()
                .map((item) => (
                  <NotificationMenuItem key={item.id} item={item} now={now} onNavigate={navigate} />
                ))}
            </ul>
          )}
          <NotificationFailure
            error={readThrough.error}
            seconds={readThrough.seconds}
            announce={!onPage}
          />
          <div className="notification-popover-footer">
            <Button
              variant="ghost"
              size="xs"
              disabled={readThrough.disabled}
              onClick={readThrough.start}
            >
              {t("readAll")}
            </Button>
            <Link to="/account/notifications" onClick={navigate}>
              {t("viewAll")} <span aria-hidden="true">→</span>
            </Link>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
/** Feed status line (loading, refreshing, empty, offline) plus feed/authorization failures. */
export function FeedState({
  offline = false,
  showEmpty = true,
}: {
  offline?: boolean;
  showEmpty?: boolean;
}) {
  const context = useNotifications(),
    { t } = useTranslation("notifications");
  const status = context.blocked
    ? ""
    : offline
      ? t("offline")
      : context.error
        ? ""
        : !context.feed
          ? t("loading")
          : context.fetching
            ? t("refreshing")
            : showEmpty && context.feed.items.length === 0
              ? t("empty")
              : "";
  return (
    <div className="notification-state">
      <p role="status">{status}</p>
      {context.blocked ? (
        <p role="alert">{t("forbidden")}</p>
      ) : (
        <NotificationFailure error={context.error} />
      )}
      {(context.error || context.blocked) && (
        <Button variant="outline" size="xs" onClick={context.refresh}>
          {t("retry")}
        </Button>
      )}
    </div>
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
