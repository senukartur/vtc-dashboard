import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Badge } from "../../shared/ui/primitives.js";
import { EventState, useEventTimezone } from "../events/components.js";
import { type DTO, eventTime } from "../events/model.js";
import { publicContent, type PublicLocale } from "./content.js";
import {
  formatCountdown,
  maxTimerDelay,
  nextChangeDelay,
  nextConvoy,
  routeLabel,
  tickerRoutes,
} from "./model.js";

type Convoy = DTO["EventPublic"];
/** One shared public read feeds the chip, ticker and cards. */
export const publicConvoysPath = "/public/events?period=upcoming&limit=3";

/**
 * Next scheduled convoy with a minute countdown. The accessible name is static (title and
 * absolute time); only the aria-hidden visible text changes, so nothing is announced.
 */
export function ConvoyChip({
  items,
  pending,
  paused,
  locale,
  onPassed,
}: {
  items: readonly Convoy[] | undefined;
  pending: boolean;
  paused: boolean;
  locale: PublicLocale;
  onPassed: (id: string) => void;
}) {
  const c = publicContent[locale],
    timezone = useEventTimezone(true),
    [now, setNow] = useState(Date.now),
    next = items ? nextConvoy(items, now) : undefined,
    nextId = next?.id,
    nextStart = next?.startsAt;
  useEffect(() => {
    if (!nextId || !nextStart) return;
    const current = Date.now(),
      start = Date.parse(nextStart);
    // Resynchronise a stale clock snapshot (for example, data arriving after mount).
    if (Math.abs(current - now) >= 1000) {
      setNow(current);
      return;
    }
    const remaining = start - current,
      delay = paused ? remaining : nextChangeDelay(remaining);
    const timer = window.setTimeout(
      () => {
        const fired = Date.now();
        if (fired >= start) onPassed(nextId);
        setNow(fired);
      },
      Math.min(Math.max(delay, 0), maxTimerDelay),
    );
    return () => clearTimeout(timer);
  }, [nextId, nextStart, paused, now, onPassed]);
  if (pending) return <span className="landing-chip-slot" aria-hidden="true" />;
  if (!next) return null;
  const absolute = eventTime(next.startsAt, locale, timezone),
    countdown = formatCountdown(Date.parse(next.startsAt) - now, locale);
  return (
    <Link className="landing-convoy-chip" to={`/events/${next.id}`}>
      <span className="landing-chip-dot landing-motion" aria-hidden="true" />
      <span className="visually-hidden">
        {c.nextConvoy}: {next.title}, {absolute}
      </span>
      <span className="landing-chip-text" aria-hidden="true">
        {paused || !countdown ? (
          <>
            {c.nextConvoy}: {absolute} · {next.title}
          </>
        ) : (
          <>
            {c.nextConvoyIn} <strong>{countdown}</strong> · {next.title}
          </>
        )}
      </span>
    </Link>
  );
}

/** Purely decorative duplicate of the cards' routes; it never holds focusable content. */
export function RouteTicker({ items }: { items: readonly Convoy[] }) {
  const routes = tickerRoutes(items);
  if (!routes.length) return null;
  return (
    <div className="landing-ticker" aria-hidden="true">
      <div className="landing-ticker-track landing-motion">
        {routes.map((route) => (
          <span
            key={route.key}
            className="landing-ticker-item"
            {...(route.copy ? { "data-copy": "" } : {})}
          >
            <span className="landing-ticker-game">{route.game.toUpperCase()}</span>
            <span className="landing-ticker-label">{route.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** WCAG 2.2.2 control: freezes art, ticker and chip pulse and replaces the countdown. */
export function MotionToggle({
  paused,
  hasScheduled,
  locale,
  onToggle,
}: {
  paused: boolean;
  hasScheduled: boolean;
  locale: PublicLocale;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="button button-ghost landing-motion-toggle"
      aria-pressed={paused}
      data-timer={hasScheduled}
      onClick={onToggle}
    >
      <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16" width="14" height="14">
        {paused ? <path d="M4 2.5v11l9-5.5z" /> : <path d="M4 2.5h3v11H4zM9 2.5h3v11H9z" />}
      </svg>
      {publicContent[locale].pauseMotion}
    </button>
  );
}

const cardRoutes = [
  "M16 70 L80 58 L130 34 L200 36 L284 16",
  "M24 18 L76 40 L120 66 L196 60 L284 74",
  "M16 34 L90 24 L140 66 L210 62 L284 40",
];

export function ConvoySection({
  query,
  locale,
}: {
  query: {
    data: { data: DTO["EnvelopeListEventPublic"] } | undefined;
    isPending: boolean;
    isError: boolean;
    error: unknown;
    refetch: () => unknown;
  };
  locale: PublicLocale;
}) {
  const { t } = useTranslation("events"),
    c = publicContent[locale],
    timezone = useEventTimezone(true),
    items = query.data?.data.data.items;
  return (
    <section className="landing-section landing-convoys" aria-labelledby="landing-events">
      <header className="event-heading">
        <h2 id="landing-events">{t("publicTitle")}</h2>
        <Link className="landing-convoys-link" to="/events">
          {t("title")}
        </Link>
      </header>
      <EventState query={query} />
      {items &&
        (items.length ? (
          <>
            <ul className="landing-convoy-grid">
              {items.map((event, index) => {
                const path = cardRoutes[index % cardRoutes.length];
                return (
                  <li key={event.id}>
                    <article className="landing-convoy-card">
                      <svg
                        className="landing-convoy-art"
                        aria-hidden="true"
                        focusable="false"
                        viewBox="0 0 300 90"
                        preserveAspectRatio="none"
                      >
                        <path className="landing-convoy-road" d={path} />
                        <path className="landing-convoy-lane" d={path} />
                      </svg>
                      <div className="landing-convoy-body">
                        <p className="landing-convoy-badges">
                          <Badge>{event.game.toUpperCase()}</Badge>
                          {event.status !== "scheduled" && <Badge>{t(event.status)}</Badge>}
                        </p>
                        <h3>
                          <Link to={`/events/${event.id}`}>{event.title}</Link>
                        </h3>
                        <p className="landing-convoy-route">{routeLabel(event)}</p>
                        <dl className="landing-convoy-facts">
                          <div>
                            <dt>{t("startsAt")}</dt>
                            <dd>{eventTime(event.startsAt, locale, timezone)}</dd>
                          </div>
                          <div>
                            <dt>{t("server")}</dt>
                            <dd>{event.server}</dd>
                          </div>
                        </dl>
                      </div>
                    </article>
                  </li>
                );
              })}
            </ul>
            <p className="muted">{c.convoysNote}</p>
          </>
        ) : (
          <p>{c.convoysEmpty}</p>
        ))}
    </section>
  );
}
