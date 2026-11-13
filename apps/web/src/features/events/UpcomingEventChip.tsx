import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { NavIcon } from "../../app/nav-icons.js";
import { useSession } from "../../app/Session.js";
import { useEventTimezone } from "./components.js";
import { EventQuickResponse } from "./EventQuickResponse.js";
import { EventResponseSummary } from "./EventResponseSummary.js";
import { useEventListLocale, useUpcomingEventCard } from "./event-list-queries.js";
import {
  eventLifecycleChanged,
  refreshStage2ListsAtLifecycleChange,
} from "./event-projection-cache.js";
import {
  type ResponseProjection,
  useEventResponseScope,
  useEventResponseView,
} from "./event-quick-response.js";
import type { DTO } from "./model.js";
import { eventTime } from "./model.js";
import { eventStage2SessionScope } from "./stage-2-queries.js";

export function UpcomingEventChip() {
  const { t } = useTranslation("events");
  const session = useSession();
  const client = useQueryClient();
  const query = useUpcomingEventCard();
  const chip = useRef<HTMLDivElement>(null);
  const refreshed = useRef<string | null>(null);
  const observed = useRef<{ scope: string; event: DTO["EventStage2Public"] | null } | null>(null);
  const event = query.data === null ? null : query.data?.event;
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
  useEffect(() => {
    if (!scope || event === undefined) return;
    const previous = observed.current;
    observed.current = { scope, event };
    if (previous?.scope === scope && eventLifecycleChanged(previous.event, event)) {
      void refreshStage2ListsAtLifecycleChange(client, scope, previous.event, event);
    }
  }, [client, event, scope]);
  if (!canRead) return null;

  return (
    <div className="event-nearest event-nearest-compact" ref={chip} tabIndex={-1}>
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
  const fullTime = eventTime(event.startsAt, locale, timezone);
  const compactTime = new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "shortOffset",
  }).format(new Date(event.startsAt));
  return (
    <>
      <Link
        ref={title}
        to={`/account/events/${event.id}`}
        className="event-nearest-link"
        aria-label={`${t("nearest")}: ${event.title}. ${fullTime}`}
        title={event.title}
      >
        <NavIcon name="myTrips" />
        <strong>{event.title}</strong>
        <time dateTime={event.startsAt} title={fullTime}>
          {compactTime}
        </time>
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
