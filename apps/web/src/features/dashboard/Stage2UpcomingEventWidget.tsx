import { type ReactNode, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { formatUtc, type Locale } from "../../shared/formatting.js";
import { Card } from "../../shared/ui/primitives.js";
import { KeepFocusButton } from "../events/components.js";
import { EventQuickResponse } from "../events/EventQuickResponse.js";
import { EventResponseSummary } from "../events/EventResponseSummary.js";
import {
  type ResponseProjection,
  useEventResponseScope,
  useEventResponseView,
} from "../events/event-quick-response.js";
import { useEventQuery } from "../events/queries.js";
import { countsView } from "../events/view-model.js";
import { useBlockRetry, useCountdownNow } from "./blocks.js";
import { Skeleton } from "./components.js";
import type { DTO } from "./transport.js";
import { blockView, type Countdown, countdown, type QueryView } from "./view-model.js";

type EventData = DTO["EventStage2Upcoming"] | null;

/** Nearest scheduled company event ("convoy"): countdown, participants and the member’s response. */
export function Stage2UpcomingEventWidget({
  query,
  locale,
  displayTimezone,
  canRespond,
  started,
}: {
  query: QueryView<EventData>;
  locale: Locale;
  displayTimezone: string;
  /** events.respond: presentation only, the server still checks the permission. */
  canRespond: boolean;
  started: boolean;
}) {
  const { t } = useTranslation("dashboard");
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const event = query.data?.event;
  const now = useCountdownNow(event?.startsAt ?? null);
  const left = event ? countdown(event.startsAt, now) : null;
  const { retrying, retry } = useBlockRetry(query);
  const view = retrying && query.data === undefined ? "error" : blockView(query, (d) => d === null);

  let body: ReactNode;
  if (view === "ready" && event && query.data) {
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
          {event.origin && event.destination ? (
            <p className="dashboard-muted dashboard-event-route">
              {event.origin.label} → {event.destination.label}
            </p>
          ) : (
            event.route && <p className="dashboard-muted dashboard-event-route">{event.route}</p>
          )}
        </div>
        <UpcomingResponse
          key={event.id}
          projection={query.data}
          started={started}
          canRespond={canRespond}
          focusHeading={() => heading.current?.focus()}
        />
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

function UpcomingResponse({
  projection,
  started,
  canRespond,
  focusHeading,
}: {
  projection: ResponseProjection;
  started: boolean;
  canRespond: boolean;
  focusHeading: () => void;
}) {
  const { t } = useTranslation("events");
  const scope = useEventResponseScope();
  const response = useEventResponseView(projection);
  const { event } = projection;
  return (
    <div className="dashboard-rsvp">
      {started ? (
        <Link to="/account/events" className="dashboard-head-link">
          {t("checkUpcoming")}
        </Link>
      ) : canRespond ? (
        <>
          <EventResponseSummary response={response.response} />
          {projection.myResponse !== null &&
            response.version !== null &&
            event.status === "scheduled" && (
              <EventQuickResponse key={scope} projection={projection} focusTarget={focusHeading} />
            )}
        </>
      ) : null}
      <GoingCount id={event.id} optimistic={response.goingCount} />
    </div>
  );
}

/** Participants of the event; a missing count is "unavailable", never zero. */
function GoingCount({ id, optimistic }: { id: string; optimistic: number | undefined }) {
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
        t("upcomingEvent.going", { count: optimistic ?? view.participating })
      ) : view.state === "loading" ? (
        <Skeleton className="dashboard-skeleton-inline" />
      ) : (
        t("upcomingEvent.goingUnavailable")
      )}
    </p>
  );
}
