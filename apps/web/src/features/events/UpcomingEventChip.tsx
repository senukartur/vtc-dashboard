import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { useEventTimezone } from "./components.js";
import { EventQuickResponse } from "./EventQuickResponse.js";
import { EventResponseSummary } from "./EventResponseSummary.js";
import { useEventListLocale, useUpcomingEventCard } from "./event-list-queries.js";
import {
  type ResponseProjection,
  useEventResponseScope,
  useEventResponseView,
} from "./event-quick-response.js";
import { eventTime } from "./model.js";
import { eventStage2SessionScope } from "./stage-2-queries.js";

export function UpcomingEventChip() {
  const { t } = useTranslation("events");
  const session = useSession();
  const query = useUpcomingEventCard();
  const chip = useRef<HTMLDivElement>(null);
  const refreshed = useRef<string | null>(null);
  const event = query.data?.event;
  const canRead = session.self?.capabilities.includes("company.read") === true;
  const canRespond = session.self?.capabilities.includes("events.respond");
  const scope = eventStage2SessionScope(session);
  const cutoff =
    canRead && scope && event ? JSON.stringify([scope, event.id, event.startsAt]) : null;
  const { refetch, started } = query;
  // The overview observes the same query and closes its controls at the cutoff.
  // Only the shell issues the cutoff refresh, even if the timers settle in separate renders.
  useEffect(() => {
    if (!started || !cutoff || refreshed.current === cutoff) return;
    refreshed.current = cutoff;
    void refetch({ cancelRefetch: false });
  }, [cutoff, refetch, started]);
  if (!canRead) return null;

  return (
    <div className="event-nearest" ref={chip} tabIndex={-1}>
      {query.isPending || (query.started && query.isFetching) ? (
        <span role="status">{t("loading")}</span>
      ) : query.isError ? (
        <span>{t("unavailable")}</span>
      ) : query.started ? (
        <Link to="/account/events">{t("checkUpcoming")}</Link>
      ) : event && query.data ? (
        <NearestLink
          key={event.id}
          projection={query.data}
          canRespond={canRespond === true}
          focusChip={() => chip.current?.focus()}
        />
      ) : (
        <span>{t("noUpcoming")}</span>
      )}
    </div>
  );
}

function NearestLink({
  projection,
  canRespond,
  focusChip,
}: {
  projection: ResponseProjection;
  canRespond: boolean;
  focusChip: () => void;
}) {
  const { t } = useTranslation("events");
  const locale = useEventListLocale();
  const timezone = useEventTimezone();
  const scope = useEventResponseScope();
  const title = useRef<HTMLAnchorElement>(null);
  const view = useEventResponseView(projection);
  const { event } = projection;
  return (
    <>
      <Link ref={title} to={`/account/events/${event.id}`}>
        <strong>
          {t("nearest")}: {event.title}
        </strong>
        <time dateTime={event.startsAt}>{eventTime(event.startsAt, locale, timezone)}</time>
      </Link>
      {canRespond &&
      projection.myResponse !== null &&
      view.version !== null &&
      event.status === "scheduled" ? (
        <EventQuickResponse
          key={scope}
          projection={projection}
          compact
          focusTarget={() => {
            if (title.current) title.current.focus();
            else focusChip();
          }}
        />
      ) : canRespond ? (
        <EventResponseSummary response={view.response} />
      ) : null}
    </>
  );
}
