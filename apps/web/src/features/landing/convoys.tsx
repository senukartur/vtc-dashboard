import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Badge } from "../../shared/ui/primitives.js";
import { EventState, useEventTimezone } from "../events/components.js";
import { type DTO, eventTime } from "../events/model.js";
import { type PublicLocale, publicContent } from "./content.js";
import {
  convoyDateParts,
  formatCountdown,
  maxTimerDelay,
  nextChangeDelay,
  nextConvoy,
  routeLabel,
} from "./model.js";

type Convoy = DTO["EventPublic"];
/** One shared public read feeds the countdown pill and the cards. */
export const publicConvoysPath = "/public/events?period=upcoming&limit=3";

/**
 * Departure pill for the next scheduled convoy with a minute countdown. The accessible name is
 * static (title and absolute time); only the aria-hidden visible text changes, so nothing is
 * announced. The hero always reserves its slot, so loading or no convoy renders nothing here.
 */
export function ConvoyChip({
  items,
  paused,
  locale,
  onPassed,
}: {
  items: readonly Convoy[] | undefined;
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
    // The delay derives from the same `now` the text uses. A stale snapshot (data arriving after
    // mount, resuming after a pause) only ever shows more time than remains and is refreshed at
    // once, because the elapsed time is subtracted from the delay.
    const start = Date.parse(nextStart),
      remaining = start - now,
      delay = (paused ? remaining : nextChangeDelay(remaining)) - (Date.now() - now);
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
            {c.nextConvoy}: {absolute}
          </>
        ) : (
          <>
            {c.nextConvoyIn} <strong>{countdown}</strong>
          </>
        )}
      </span>
    </Link>
  );
}

/** WCAG 2.2.2 control: pauses the video, cab drift and pulses and replaces the countdown. */
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
      className="landing-cta landing-cta-ghost landing-motion-toggle"
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
    <section
      id="convoys"
      tabIndex={-1}
      className="landing-section landing-wrap landing-convoys"
      aria-labelledby="landing-convoys-title"
    >
      <header className="landing-section-head">
        <div>
          <p className="landing-eyebrow">{c.convoysEyebrow}</p>
          <h2 id="landing-convoys-title">{c.convoysTitle}</h2>
        </div>
        <Link className="landing-convoys-link" to="/events">
          {c.allEvents} <span aria-hidden="true">→</span>
        </Link>
      </header>
      <EventState query={query} />
      {items &&
        (items.length ? (
          <>
            <ul className="landing-convoy-grid">
              {items.map((event) => {
                const date = convoyDateParts(event.startsAt, locale, timezone);
                return (
                  <li key={event.id}>
                    <article className="landing-convoy-card">
                      <span className="landing-convoy-date" aria-hidden="true">
                        <strong>{date.day}</strong>
                        <span>{date.month}</span>
                      </span>
                      <div className="landing-convoy-body">
                        <p className="landing-convoy-badges">
                          <span className="landing-game" data-game={event.game}>
                            {event.game.toUpperCase()}
                          </span>
                          {event.status !== "scheduled" && <Badge>{t(event.status)}</Badge>}
                        </p>
                        <h3>
                          <Link to={`/events/${event.id}`}>{event.title}</Link>
                        </h3>
                        <p className="landing-convoy-route">{routeLabel(event)}</p>
                        <p className="landing-convoy-facts">
                          <span className="visually-hidden">{t("startsAt")}: </span>
                          {eventTime(event.startsAt, locale, timezone)}
                          <span aria-hidden="true"> · </span>
                          <span className="visually-hidden">, {t("server")}: </span>
                          {event.server}
                        </p>
                      </div>
                    </article>
                  </li>
                );
              })}
            </ul>
            <p className="landing-convoys-note">{c.convoysNote}</p>
          </>
        ) : (
          <p>{c.convoysEmpty}</p>
        ))}
    </section>
  );
}
