import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { CatalogNativeName } from "../../shared/catalog-selectors/CatalogNativeName.js";
import { Badge } from "../../shared/ui/primitives.js";
import { useEventStarted } from "./components.js";
import { EventQuickResponse } from "./EventQuickResponse.js";
import { EventResponseSummary } from "./EventResponseSummary.js";
import { eventListCopy } from "./event-list-copy.js";
import { useEventListLocale } from "./event-list-queries.js";
import {
  addResponseDelta,
  useEventResponseScope,
  useEventResponseView,
} from "./event-quick-response.js";
import type { DTO } from "./model.js";
import { useEventStage2Image, useEventStage2Query } from "./stage-2-queries.js";
import { eventStage2Content, eventStage2Reads } from "./stage-2-transport.js";
import { compactTime, dateTile } from "./view-model.js";

function CoverPlaceholder() {
  return <span className="event-list-placeholder" aria-hidden="true" />;
}

/** Unmount immediately when the member media query no longer authorizes the blob. */
function CoverThumbnail({ blob }: { blob: Blob }) {
  const [source, setSource] = useState<{ blob: Blob; url: string }>();
  const [failed, setFailed] = useState<string>();
  useEffect(() => {
    const url = URL.createObjectURL(blob);
    setSource({ blob, url });
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  return source?.blob === blob && failed !== source.url ? (
    <img src={source.url} alt="" onError={() => setFailed(source.url)} />
  ) : (
    <CoverPlaceholder />
  );
}

function EventCover({ id }: { id: string }) {
  const media = useEventStage2Query(eventStage2Reads.memberMedia(id));
  const cover = media.data?.data.data.items.find((item) => item.isCover);
  const image = useEventStage2Image(
    eventStage2Content.member(id, cover?.id ?? "", "thumb"),
    !!cover,
  );
  return image.data ? <CoverThumbnail blob={image.data} /> : <CoverPlaceholder />;
}

function EventRoute({
  origin,
  destination,
  route,
}: Pick<DTO["EventStage2Public"], "origin" | "destination" | "route">) {
  if (!origin || !destination) return route;
  return (
    <>
      {origin.label}
      <CatalogNativeName value={origin} />
      {" → "}
      {destination.label}
      <CatalogNativeName value={destination} />
    </>
  );
}

export function EventListCard({
  row,
  timezone,
  canRespond,
}: {
  row: DTO["EventStage2MemberListItem"];
  timezone: string;
  canRespond: boolean;
}) {
  const { t } = useTranslation("events");
  const locale = useEventListLocale();
  const copy = eventListCopy[locale];
  const { event } = row;
  const scope = useEventResponseScope();
  const started = useEventStarted(canRespond ? event.startsAt : null);
  const response = useEventResponseView(row);
  const responseCounts = addResponseDelta(row.responseCounts, response.delta);
  const title = useRef<HTMLAnchorElement>(null);
  const canAnswer =
    canRespond &&
    response.version !== null &&
    row.myResponse !== null &&
    event.status === "scheduled" &&
    !started;
  const tile = dateTile(event.startsAt, locale, timezone);

  return (
    <li className="events-row event-list-card">
      <div className="event-list-cover" aria-hidden="true">
        {event.hasCover ? <EventCover id={event.id} /> : <CoverPlaceholder />}
      </div>
      <span className="events-tile" aria-hidden="true">
        <span className="events-tile-day">{tile.day}</span>
        <span className="events-tile-month">{tile.month}</span>
      </span>
      <div className="events-row-body">
        <h2 className="events-row-title">
          <Link ref={title} to={`/account/events/${event.id}`}>
            {event.title}
          </Link>
        </h2>
        <p className="events-row-meta">
          <span className="events-game">{event.game.toUpperCase()}</span>
          {event.platform && (
            <span>{event.platform === "truckersmp" ? "TruckersMP" : "HaulMP"}</span>
          )}
          {event.server && <span>{event.server}</span>}
          {event.status !== "scheduled" && (
            <Badge className={`events-status events-status-${event.status}`}>
              {t(event.status)}
            </Badge>
          )}
        </p>
        <p className="event-list-route">
          <EventRoute origin={event.origin} destination={event.destination} route={event.route} />
        </p>
        <dl className="event-list-facts">
          <div>
            <dt>{t("meetingAt")}</dt>
            <dd>
              <time dateTime={event.meetingAt}>
                {compactTime(event.meetingAt, locale, timezone)}
              </time>
            </dd>
          </div>
          <div>
            <dt>{t("startsAt")}</dt>
            <dd>
              <time dateTime={event.startsAt}>{compactTime(event.startsAt, locale, timezone)}</time>
            </dd>
          </div>
        </dl>
        <p className="events-row-meta">
          {event.requiredDlcs.length
            ? `${copy.requiredDlc}: ${event.requiredDlcs.map(({ name }) => name).join(", ")}`
            : copy.noDlc}
        </p>
      </div>
      <div className="event-list-responses">
        <div className="events-row-meta">
          <span className="events-tone-participating">
            <span aria-hidden="true">✓</span>{" "}
            {t("countParticipating", { count: responseCounts.participating })}
          </span>
          <span className="events-tone-declined">
            <span aria-hidden="true">✕</span>{" "}
            {t("countDeclined", { count: responseCounts.declined })}
          </span>
        </div>
        {canRespond && <EventResponseSummary response={response.response} />}
      </div>
      {canAnswer && (
        <EventQuickResponse
          key={scope}
          projection={row}
          focusTarget={() => title.current?.focus()}
        />
      )}
    </li>
  );
}
