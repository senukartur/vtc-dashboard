import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { Button } from "../../shared/ui/primitives.js";
import { AccountFailure } from "../account/transport.js";
import { useUpcomingEvent } from "../dashboard/queries.js";
import { eventTime } from "./model.js";
import { EventFailure } from "./transport.js";

/** The current time, re-read when `startsAt` passes so start-bound views update at the boundary. */
export function useEventClock(startsAt: string | null) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!startsAt) return;
    let timer: number | undefined;
    const update = () => {
      const current = Date.now();
      setNow(current);
      const remaining = Date.parse(startsAt) - current;
      if (remaining > 0) timer = window.setTimeout(update, Math.min(remaining, 2147483647));
    };
    update();
    return () => clearTimeout(timer);
  }, [startsAt]);
  return now;
}
export function useEventStarted(startsAt: string | null) {
  const now = useEventClock(startsAt);
  return startsAt !== null && Date.parse(startsAt) <= now;
}

export function useEventTimezone(publicView = false) {
  const session = useSession();
  return (
    (!publicView && session.self?.preferences.displayTimezone) ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    "UTC"
  );
}
export function EventFailureView({ error, seconds = 0 }: { error: unknown; seconds?: number }) {
  const { t } = useTranslation("events");
  if (!error) return null;
  // The countdown changes every second, so it stays outside the alert to avoid repeated
  // announcements.
  return (
    <>
      <div role="alert" className="field-error">
        <p>
          {t(
            error instanceof EventFailure && error.status === 404
              ? "notFound"
              : error instanceof AccountFailure
                ? error.kind
                : "unavailable",
          )}
        </p>
      </div>
      {seconds > 0 && <p className="field-error">{t("wait", { seconds })}</p>}
    </>
  );
}
/**
 * `focusTarget` receives focus when Try again / Start from first page is used: without data the
 * refetch replaces the button with the loading status, so focus would otherwise fall to the body.
 */
export function EventState({
  query,
  reset,
  focusTarget,
}: {
  query: { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  reset?: (() => void) | undefined;
  focusTarget?: (() => void) | undefined;
}) {
  const { t } = useTranslation("events");
  return query.isPending ? (
    <p role="status">{t("loading")}</p>
  ) : query.isError ? (
    <>
      <EventFailureView error={query.error} />
      <Button
        variant="outline"
        onClick={() => {
          void (reset ?? query.refetch)();
          focusTarget?.();
        }}
      >
        {t(reset ? "reset" : "retry")}
      </Button>
    </>
  ) : null;
}
/** `chip` is a plain element for use inside another landmark such as the workspace banner; its states are self-describing. */
export function NearestEvent({ variant = "landmark" }: { variant?: "landmark" | "chip" }) {
  const query = useUpcomingEvent(),
    { t, i18n } = useTranslation("events"),
    timezone = useEventTimezone();
  const session = useSession();
  const event = query.isError ? undefined : query.data;
  const started = useEventStarted(event?.startsAt ?? null),
    refreshed = useRef<string | null>(null);
  const stamp = event
    ? JSON.stringify([
        session.self?.member.id,
        session.generation,
        session.self?.identityEpoch,
        event.id,
        event.startsAt,
      ])
    : null;
  useEffect(() => {
    if (started && stamp && refreshed.current !== stamp) {
      refreshed.current = stamp;
      void query.refetch({ cancelRefetch: false });
    }
  }, [started, stamp, query.refetch]);
  if (!session.self?.capabilities.includes("company.read")) return null;
  const content = query.isPending ? (
    <span role="status">{t("loading")}</span>
  ) : query.isError ? (
    <span>{t("unavailable")}</span>
  ) : started ? (
    query.isFetching ? (
      <span role="status">{t("loading")}</span>
    ) : (
      <Link to="/account/events">{t("checkUpcoming")}</Link>
    )
  ) : event ? (
    <Link to={`/account/events/${event.id}`}>
      <strong>
        {t("nearest")}: {event.title}
      </strong>
      <span>{eventTime(event.startsAt, i18n.resolvedLanguage ?? "en", timezone)}</span>
    </Link>
  ) : (
    <span>{t("noUpcoming")}</span>
  );
  return variant === "chip" ? (
    <div className="event-nearest">{content}</div>
  ) : (
    <aside className="event-nearest" aria-label={t("nearest")}>
      {content}
    </aside>
  );
}
