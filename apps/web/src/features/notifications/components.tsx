import {
  ArrowRight,
  ArrowUp,
  Award,
  Bell,
  Calendar,
  Check,
  Circle,
  ClipboardCheck,
  Clock,
  FileText,
  type LucideIcon,
  Pencil,
  Route,
  Truck,
  UserRound,
  X,
} from "lucide-react";
import { Popover } from "radix-ui";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { accountTimeZone } from "../../shared/formatting.js";
import { Badge, Button } from "../../shared/ui/primitives.js";
import { AccountFailure } from "../account/transport.js";
import { eventTime } from "../events/model.js";
import { useNotificationCommand, useNotifications, useReadThrough } from "./controller.js";
import {
  badgeText,
  messageName,
  type Notification,
  type NotificationIconName,
  notificationTarget,
  notificationVisual,
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
              : preference && error.kind === "invalid"
                ? "preferenceKeysChanged"
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
  const timezone = accountTimeZone(session.self?.preferences.displayTimezone),
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
    timezone: accountTimeZone(session.self?.preferences.displayTimezone),
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
const notificationIcons: Record<NotificationIconName, LucideIcon> = {
  truck: Truck,
  check: Check,
  cross: X,
  review: ClipboardCheck,
  edit: Pencil,
  calendar: Calendar,
  route: Route,
  clock: Clock,
  award: Award,
  up: ArrowUp,
  document: FileText,
  user: UserRound,
  dot: Circle,
};
function NotificationIcon({ item, size }: { item: Notification; size: "sm" | "md" }) {
  const visual = notificationVisual(item),
    Icon = notificationIcons[visual.icon];
  return (
    <span
      className={`notification-icon notification-icon-${size} notification-tone-${visual.tone}`}
      aria-hidden="true"
    >
      <Icon size={16} strokeWidth={1.8} aria-hidden="true" focusable="false" />
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
          {!item.readAt && (
            <Badge size="xs" tone="info">
              {t("new")}
            </Badge>
          )}
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
          <Bell size={18} strokeWidth={1.8} aria-hidden="true" focusable="false" />
          {badge && (
            <Badge className="notification-badge" tone="info" aria-hidden="true">
              {badge}
            </Badge>
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
              {t("viewAll")}{" "}
              <ArrowRight size={14} strokeWidth={1.8} aria-hidden="true" focusable="false" />
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
