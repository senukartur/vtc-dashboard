import {
  type FormEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { CatalogNativeName } from "../../shared/catalog-selectors/CatalogNativeName.js";
import { formatUtc, type Locale } from "../../shared/formatting.js";
import { Button, Card, Label } from "../../shared/ui/primitives.js";
import { EventFailureView, KeepFocusButton } from "../events/components.js";
import { responseInput } from "../events/model.js";
import { useEventCommand, useEventQuery } from "../events/queries.js";
import { countsView, type EventPhase, eventPhase, responseTone } from "../events/view-model.js";
import { Skeleton } from "./components.js";
import type { DTO } from "./transport.js";
import {
  blockView,
  type Countdown,
  countdown,
  type QueryView,
  RECENT_TRIPS_LIMIT,
  recentTripRow,
  responsePressed,
  retainsError,
  rsvpView,
} from "./view-model.js";
import "./dashboard.css";

type EventData = DTO["OptionalEvent"];
type TripListData = DTO["ListTripSummary"];

/**
 * The current time, re-read only when the countdown text would change (and at the start), so a
 * days-away event wakes the page once an hour rather than every second.
 */
export function useCountdownNow(startsAt: string | null) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!startsAt) return;
    let timer: number | undefined;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      const next = countdown(startsAt, current).nextChangeMs;
      if (next !== null) timer = window.setTimeout(tick, Math.min(next, 2147483647));
    };
    tick();
    return () => clearTimeout(timer);
  }, [startsAt]);
  return now;
}

/**
 * A block's Retry. Without data TanStack resets a refetch to pending, which would replace the
 * error and its focused Retry with the loading state. Until the query (as passed down by the
 * page) shows a newer outcome, the block keeps its error, so a failed retry keeps focus on Retry
 * and success removes it, handing focus to the heading.
 */
function useBlockRetry(query: {
  data: unknown;
  errorUpdateCount: number;
  refetch: () => Promise<unknown>;
}) {
  const [since, setSince] = useState<number | null>(null);
  const retrying = retainsError(since, query);
  // Data or a later error ends the retry, so a later query (another game) shows its own state.
  if (since !== null && !retrying) setSince(null);
  return {
    retrying,
    retry() {
      setSince(query.errorUpdateCount);
      void query.refetch();
    },
  };
}

export function RecentTripsWidget({
  query,
  locale,
  displayTimezone,
}: {
  query: QueryView<TripListData>;
  locale: Locale;
  displayTimezone: string;
}) {
  const { t } = useTranslation("dashboard");
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const { retrying, retry } = useBlockRetry(query);
  const view = retrying && !query.data ? "error" : blockView(query, (d) => d.items.length === 0);

  let body: ReactNode;
  if (view === "ready" && query.data) {
    body = (
      <>
        <ul className="dashboard-trip-list">
          {query.data.items.slice(0, RECENT_TRIPS_LIMIT).map((trip) => {
            const row = recentTripRow(trip, locale, displayTimezone);
            return (
              <li key={row.id} className="dashboard-trip">
                <span className="dashboard-game">{row.game.toUpperCase()}</span>
                <div className="dashboard-trip-text">
                  <Link to={`/account/trips/${row.id}`} className="dashboard-trip-route">
                    <span>
                      {row.origin}
                      <CatalogNativeName value={trip.origin} /> → {row.destination}
                      <CatalogNativeName value={trip.destination} />
                      {row.fallback && (
                        <small className="dashboard-fallback"> · {t("catalogs:fallback")}</small>
                      )}
                    </span>
                  </Link>
                  <span className="dashboard-trip-meta">
                    {row.driver} · <span className="dashboard-nowrap">{row.distance}</span> ·{" "}
                    {trip.reportingAt ? (
                      <time dateTime={trip.reportingAt}>{row.countedAt}</time>
                    ) : (
                      row.countedAt
                    )}
                    {trip.reportingAt && trip.reportingBasis === "manual_confirmation" && (
                      <> · {t("trips:manual_confirmation")}</>
                    )}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
        <p className="dashboard-muted">{t("events:timezoneNote", { zone: displayTimezone })}</p>
      </>
    );
  } else if (view === "empty") {
    body = <p className="dashboard-empty">{t("recentTrips.empty")}</p>;
  } else if (view === "forbidden") {
    body = <p className="dashboard-muted">{t("recentTrips.forbidden")}</p>;
  } else if (view === "error") {
    body = (
      <div className="dashboard-block-error">
        <p>{t("recentTrips.error")}</p>
        {/* Removed on success, which hands focus to the heading; a failed retry keeps it here. */}
        <KeepFocusButton
          variant="outline"
          focusTarget={() => heading.current?.focus()}
          onClick={retry}
        >
          {t("recentTrips.retry")}
        </KeepFocusButton>
      </div>
    );
  } else {
    body = (
      <div className="dashboard-skeleton-rows" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((row) => (
          <Skeleton key={row} />
        ))}
      </div>
    );
  }

  return (
    <Card
      className="dashboard-recent-trips"
      aria-labelledby={headingId}
      aria-busy={view === "loading"}
    >
      <div className="dashboard-card-head">
        <h2 id={headingId} ref={heading} tabIndex={-1}>
          {t("recentTrips.title")}
        </h2>
        <Link to="/account/trips?scope=company" className="dashboard-head-link">
          {t("recentTrips.allTrips")}
        </Link>
      </div>
      {body}
    </Card>
  );
}

/** Nearest scheduled company event ("convoy"): countdown, participants and the own quick response. */
export function UpcomingEventWidget({
  query,
  locale,
  displayTimezone,
  canRespond,
}: {
  query: QueryView<EventData>;
  locale: Locale;
  displayTimezone: string;
  /** events.respond: presentation only, the server still checks the permission. */
  canRespond: boolean;
}) {
  const { t } = useTranslation("dashboard");
  const session = useSession();
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const event = query.data ?? null;
  // One clock drives both the countdown and the response cutoff.
  const now = useCountdownNow(event?.startsAt ?? null);
  const phase: EventPhase = event ? eventPhase(event, now) : "open";
  const left = event ? countdown(event.startsAt, now) : null;
  const { retrying, retry } = useBlockRetry(query);
  const view = retrying && query.data === undefined ? "error" : blockView(query, (d) => d === null);

  // At the start the endpoint moves on to the next event; refetch once per event and identity.
  const refreshed = useRef<string | null>(null);
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
    if (phase === "started" && stamp && refreshed.current !== stamp) {
      refreshed.current = stamp;
      void query.refetch({ cancelRefetch: false });
    }
  }, [phase, stamp, query.refetch]);

  let body: ReactNode;
  if (view === "ready" && event) {
    const count = <GoingCount id={event.id} />;
    body = (
      <>
        <div className="dashboard-event-info">
          <h3 className="dashboard-event-title">{event.title}</h3>
          <p className="dashboard-muted">
            <time dateTime={event.startsAt}>
              {formatUtc(event.startsAt, locale, displayTimezone)}
            </time>{" "}
            ({displayTimezone})
          </p>
          <p className="dashboard-muted dashboard-event-route">{event.route}</p>
        </div>
        {canRespond && phase === "open" ? (
          <ConvoyResponse
            key={event.id}
            event={event}
            phase={phase}
            heading={heading}
            onConflict={() => void query.refetch({ cancelRefetch: false })}
          >
            {count}
          </ConvoyResponse>
        ) : (
          <div className="dashboard-rsvp">
            {phase !== "open" && (
              <Link to="/account/events" className="dashboard-head-link">
                {t("events:checkUpcoming")}
              </Link>
            )}
            {count}
          </div>
        )}
        <Link to={`/account/events/${event.id}`} className="dashboard-head-link">
          {t("upcomingEvent.viewEvent")}
        </Link>
      </>
    );
  } else if (view === "empty") {
    // Success without an event; kept even if a later background refresh fails.
    body = (
      <>
        <p className="dashboard-muted">{t("upcomingEvent.noUpcoming")}</p>
        <Link to="/account/events" className="dashboard-head-link">
          {t("upcomingEvent.allEvents")}
        </Link>
      </>
    );
  } else if (view === "forbidden") {
    body = <p className="dashboard-muted">{t("upcomingEvent.forbidden")}</p>;
  } else if (view === "error") {
    body = (
      <div className="dashboard-block-error">
        <p>{t("upcomingEvent.error")}</p>
        <KeepFocusButton
          variant="outline"
          focusTarget={() => heading.current?.focus()}
          onClick={retry}
        >
          {t("upcomingEvent.retry")}
        </KeepFocusButton>
      </div>
    );
  } else {
    body = <Skeleton className="dashboard-skeleton-line" />;
  }

  // Plain text that changes at most once a minute: never a status, live or busy region.
  const countdownLabel = (value: Countdown) => {
    switch (value.kind) {
      case "days":
        return t("upcomingEvent.countdownDays", { days: value.days, hours: value.hours });
      case "hours":
        return t("upcomingEvent.countdownHours", { hours: value.hours, minutes: value.minutes });
      case "minutes":
        return t("upcomingEvent.countdownMinutes", { minutes: value.minutes });
      case "soon":
        return t("upcomingEvent.countdownSoon");
      default:
        return null;
    }
  };
  const chip = view === "ready" && left ? countdownLabel(left) : null;
  return (
    <Card className="dashboard-side-card dashboard-event-card" aria-labelledby={headingId}>
      <div className="dashboard-card-head">
        <h2 id={headingId} ref={heading} tabIndex={-1}>
          {t("upcomingEvent.title")}
        </h2>
        {chip && <span className="dashboard-countdown">{chip}</span>}
      </div>
      {body}
    </Card>
  );
}

/** Participants of the event; a missing count is "unavailable", never zero. */
function GoingCount({ id }: { id: string }) {
  const { t } = useTranslation("dashboard");
  // The detail page's path, so a committed response refreshes this count too.
  const counts = useEventQuery(`/events/${id}/response-counts`, "EnvelopeEventResponseCounts");
  const view = countsView({
    isPending: counts.isPending,
    isError: counts.isError,
    data: counts.data?.data.data,
  });
  return (
    <p className="dashboard-going">
      {view.state === "ready" ? (
        t("upcomingEvent.going", { count: view.participating })
      ) : view.state === "loading" ? (
        <Skeleton className="dashboard-skeleton-inline" />
      ) : (
        t("upcomingEvent.goingUnavailable")
      )}
    </p>
  );
}

/**
 * Own quick response while the event is open, for members with events.respond. It reads and
 * writes the detail page's my-response path through the events command hook, so ETag/If-Match,
 * idempotency keys, CSRF, held retries and cache refresh are the same as on the detail page.
 * The decline reason lives only in this component's state.
 */
function ConvoyResponse({
  event,
  phase,
  heading,
  onConflict,
  children,
}: {
  event: NonNullable<EventData>;
  phase: EventPhase;
  heading: RefObject<HTMLHeadingElement | null>;
  /**
   * Refetches the nearest event. The command hook refreshes only the events caches, so after a
   * cancellation or reschedule the overview would keep showing open controls for a closed event.
   */
  onConflict: () => void;
  /** The participants count, shown at the end of the response row. */
  children: ReactNode;
}) {
  const { t } = useTranslation("dashboard");
  const id = useId();
  const path = `/events/${event.id}/my-response`;
  const query = useEventQuery(path, "EnvelopeRsvp");
  const command = useEventCommand((failure) => {
    if (failure.kind === "conflict") onConflict();
  });
  // A Retry without data keeps "unavailable" (and focus on Retry) until it settles.
  const { retrying, retry } = useBlockRetry(query);
  const view = rsvpView({
    canRespond: true,
    phase,
    query: retrying ? { isError: true, error: null } : query,
  });
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [saved, setSaved] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const cantGo = useRef<HTMLButtonElement>(null);

  // At the start, a permission change or a new nearest event this area unmounts. If focus was
  // inside, move it to the block heading instead of losing it to the document body.
  useLayoutEffect(() => {
    const node = body.current;
    return () => {
      if (node?.contains(document.activeElement)) queueMicrotask(() => heading.current?.focus());
    };
  }, [heading]);

  const current = view.state === "ready" ? view.current : null;
  const etag = view.state === "ready" ? view.etag : null;
  // Unavailable controls stay focusable (aria-disabled); the handlers ignore them.
  const blocked = phase !== "open" || command.pending || command.seconds > 0 || !etag;
  const pressed = current ? responsePressed(current.response, declining) : null;

  async function going() {
    if (blocked || !current) return;
    setSaved(false);
    setInvalid(false);
    setDeclining(false);
    if (current.response === "participating") return;
    const result = await command.run(
      path,
      { response: "participating" },
      "EnvelopeRsvp",
      etag,
      "PUT",
    );
    if (result) setSaved(true);
  }

  function openDecline() {
    if (blocked || !current) return;
    setSaved(false);
    if (declining) return;
    setReason(current.declineReason ?? "");
    setInvalid(false);
    setDeclining(true);
  }

  function cancelDecline() {
    if (command.pending) return;
    setDeclining(false);
    setInvalid(false);
    setSaved(false);
    cantGo.current?.focus();
  }

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (blocked) return;
    const input = responseInput("declined", reason);
    setInvalid(!input);
    setSaved(false);
    if (!input) return;
    const result = await command.run(path, input, "EnvelopeRsvp", etag, "PUT");
    if (result) {
      // Focus the toggle before the form (and its submit button) unmounts.
      cantGo.current?.focus();
      setDeclining(false);
      setSaved(true);
    }
  }

  let state: ReactNode;
  if (view.state === "ready" && current) {
    const tone = responseTone(current.response);
    state = (
      <p className={`dashboard-rsvp-state dashboard-tone-${tone.tone}`}>
        {command.pending ? (
          t("events:savingResponse")
        ) : (
          <>
            <span aria-hidden="true">{tone.symbol}</span>{" "}
            {t(
              current.response === "participating"
                ? "events:stateParticipating"
                : current.response === "declined"
                  ? "events:stateDeclined"
                  : "events:stateUnanswered",
            )}
          </>
        )}
      </p>
    );
  } else if (view.state === "unavailable") {
    state = (
      <div className="dashboard-block-error">
        <p>{t("upcomingEvent.responseUnavailable")}</p>
        <KeepFocusButton
          variant="outline"
          focusTarget={() => heading.current?.focus()}
          onClick={retry}
        >
          {t("upcomingEvent.retry")}
        </KeepFocusButton>
      </div>
    );
  } else if (view.state === "forbidden") {
    state = <p className="dashboard-muted">{t("upcomingEvent.forbidden")}</p>;
  } else {
    state = <p className="dashboard-muted">{t("upcomingEvent.responseLoading")}</p>;
  }

  const showToggles = view.state === "ready" || view.state === "loading";
  return (
    <div className="dashboard-rsvp-body" ref={body}>
      {state}
      <div className="dashboard-rsvp">
        {showToggles && (
          <fieldset aria-label={t("events:response")} className="dashboard-rsvp-group">
            <Button
              type="button"
              variant="outline"
              className="dashboard-toggle dashboard-toggle-going"
              aria-pressed={pressed?.going}
              aria-disabled={blocked || undefined}
              onClick={() => void going()}
            >
              {t("upcomingEvent.goingButton")}
            </Button>
            <Button
              ref={cantGo}
              type="button"
              variant="outline"
              className="dashboard-toggle dashboard-toggle-decline"
              aria-pressed={pressed?.cantGo}
              aria-disabled={blocked || undefined}
              onClick={openDecline}
            >
              {t("upcomingEvent.cantGoButton")}
            </Button>
          </fieldset>
        )}
        {children}
      </div>
      {declining && current && (
        // noValidate: the translated inline error replaces the browser's required bubble.
        <form className="dashboard-decline" noValidate onSubmit={(e) => void submit(e)}>
          <Label htmlFor={`${id}-reason`}>{t("events:declineReason")}</Label>
          <textarea
            className="input dashboard-reason"
            id={`${id}-reason`}
            required
            maxLength={2048}
            aria-describedby={invalid ? `${id}-hint ${id}-error` : `${id}-hint`}
            aria-invalid={invalid || undefined}
            value={reason}
            readOnly={command.pending}
            onChange={(e) => {
              setReason(e.target.value);
              setSaved(false);
            }}
          />
          <p className="dashboard-muted" id={`${id}-hint`}>
            {t("events:declineHint")}
          </p>
          {invalid && (
            <p className="field-error" id={`${id}-error`} role="alert">
              {t("upcomingEvent.reasonRequired")}
            </p>
          )}
          <div className="dashboard-decline-actions">
            <Button type="submit" aria-disabled={blocked || undefined}>
              {t(command.pending ? "events:savingResponse" : "events:respond")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              aria-disabled={command.pending || undefined}
              onClick={cancelDecline}
            >
              {t("upcomingEvent.cancelDecline")}
            </Button>
          </div>
        </form>
      )}
      <EventFailureView error={command.failure} seconds={command.seconds} />
      {saved && (
        <p role="status" className="confirmation">
          {t("events:savedResponse")}
        </p>
      )}
    </div>
  );
}
