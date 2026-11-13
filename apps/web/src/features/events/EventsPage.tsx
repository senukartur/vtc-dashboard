import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { uuid } from "../../shared/catalog-selectors/contracts.js";
import { Badge, Button, Card } from "../../shared/ui/primitives.js";
import { SegmentedControl } from "../../shared/ui/segmented-control.js";
import { publicContent, publicPath } from "../landing/content.js";
import { EventState, KeepFocusButton, useEventTimezone } from "./components.js";
import { EventEditor } from "./EventEditor.js";
import { DraftEventEditor, useDraftText } from "./editor/draft.js";
import { isEventStage2Enabled } from "./event-stage-2-mode.js";
import { MemberEventsPage } from "./MemberEventsPage.js";
import { type DTO, periodFrom } from "./model.js";
import { useEventQuery } from "./queries.js";
import { compactTime, dateTile, timezoneLabel } from "./view-model.js";
import "./events.css";
import "./events-workspace.css";

export function EventsPage({ publicView = false }: { publicView?: boolean }) {
  const session = useSession();
  if (!publicView && isEventStage2Enabled(session)) return <MemberEventsPage />;
  return <LegacyEventsPage publicView={publicView} />;
}

function LegacyEventsPage({ publicView }: { publicView: boolean }) {
  const { t, i18n } = useTranslation("events"),
    session = useSession(),
    [search, setSearch] = useSearchParams(),
    requestedPeriod = search.get("period"),
    period = periodFrom(requestedPeriod),
    cursor = !publicView && requestedPeriod === "drafts" ? null : search.get("cursor"),
    allowed = publicView || !!session.self?.capabilities.includes("company.read"),
    timezone = useEventTimezone(publicView),
    [now] = useState(Date.now),
    heading = useRef<HTMLHeadingElement>(null);
  const query = useEventQuery(
    `${publicView ? "/public" : ""}/events?period=${period}&limit=12${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    "EnvelopeListEventPublic",
    allowed,
  );
  const data = query.data?.data.data;
  function page(next: string | null) {
    setSearch(next ? { period, cursor: next } : { period });
  }
  /** Paging replaces the list and its pager while loading; focus then moves to the heading. */
  const focusHeading = () => heading.current?.focus();
  return (
    <div className="events-page stack">
      <header className="events-heading">
        <div className="events-heading-text">
          <h1 ref={heading} tabIndex={-1}>
            {t(publicView ? "publicTitle" : "title")}
          </h1>
          <p className="muted">{t("timezoneNote", { zone: timezoneLabel(timezone, now) })}</p>
        </div>
        {publicView && (
          <Button asChild variant="outline">
            <Link to={`${publicPath(i18n.resolvedLanguage === "en" ? "en" : "ru")}#apply`}>
              {publicContent[i18n.resolvedLanguage === "en" ? "en" : "ru"].apply}
            </Link>
          </Button>
        )}
        {!publicView && session.self?.capabilities.includes("events.manage") && (
          <Button asChild>
            <Link to="/account/events/new">{t("create")}</Link>
          </Button>
        )}
      </header>
      {!allowed ? (
        <p>{t("forbidden")}</p>
      ) : (
        <>
          <SegmentedControl
            aria-label={t("period")}
            size="sm"
            value={period}
            onValueChange={(p) => setSearch({ period: p })}
            options={(["upcoming", "past"] as const).map((p) => ({ value: p, label: t(p) }))}
          />
          <EventState
            query={query}
            focusTarget={focusHeading}
            {...(cursor ? { reset: () => page(null) } : {})}
          />
          {data && (
            <>
              <Card className="events-list-card">
                {data.items.length ? (
                  <ul className="events-list">
                    {data.items.map((e) => (
                      <EventRow key={e.id} event={e} publicView={publicView} timezone={timezone} />
                    ))}
                  </ul>
                ) : (
                  <p>{t("empty")}</p>
                )}
              </Card>
              {(cursor || data.nextCursor) && (
                <nav className="events-pager" aria-label={t("next")}>
                  {cursor && (
                    <KeepFocusButton
                      variant="outline"
                      focusTarget={focusHeading}
                      onClick={() => page(null)}
                    >
                      {t("first")}
                    </KeepFocusButton>
                  )}
                  {data.nextCursor && (
                    <KeepFocusButton
                      variant="outline"
                      focusTarget={focusHeading}
                      onClick={() => page(data.nextCursor)}
                    >
                      {t("next")}
                    </KeepFocusButton>
                  )}
                </nav>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
function EventRow({
  event,
  publicView,
  timezone,
}: {
  event: DTO["EventPublic"];
  publicView: boolean;
  timezone: string;
}) {
  const { t, i18n } = useTranslation("events"),
    locale = i18n.resolvedLanguage ?? "en",
    tile = dateTile(event.startsAt, locale, timezone);
  return (
    <li className="events-row">
      <span className="events-tile" aria-hidden="true">
        <span className="events-tile-day">{tile.day}</span>
        <span className="events-tile-month">{tile.month}</span>
      </span>
      <div className="events-row-body">
        <h2 className="events-row-title">
          <Link to={`${publicView ? "" : "/account"}/events/${event.id}`}>{event.title}</Link>
        </h2>
        <p className="events-row-meta">
          <span className="events-game">{event.game.toUpperCase()}</span>
          <time dateTime={event.startsAt}>{compactTime(event.startsAt, locale, timezone)}</time>
          {event.status !== "scheduled" && (
            <Badge className={`events-status events-status-${event.status}`}>
              {t(event.status)}
            </Badge>
          )}
        </p>
      </div>
    </li>
  );
}
export function CreateEventPage() {
  const { t } = useTranslation("events"),
    session = useSession(),
    draftText = useDraftText(),
    [search] = useSearchParams();
  const draftIds = search.getAll("draftId");
  if (draftIds.length) {
    const id = draftIds.length === 1 ? draftIds[0] : undefined;
    const valid = id && id === id.toLowerCase() && uuid.safeParse(id).success;
    return (
      <div className="event-page stack">
        <Link to="/account/events">{t("back")}</Link>
        <h1>{draftText.heading}</h1>
        <Card>
          {!valid ? (
            <p role="alert" className="field-error">
              {draftText.invalidId}
            </p>
          ) : session.state === "checking" ? (
            <p role="status">{t("loading")}</p>
          ) : session.eventsDraftsEnabled ? (
            <DraftEventEditor id={id} />
          ) : (
            <p role="alert" className="field-error">
              {draftText.unavailable}
            </p>
          )}
        </Card>
      </div>
    );
  }
  return (
    <div className="event-page stack">
      <Link to="/account/events">{t("back")}</Link>
      <h1>{t("create")}</h1>
      <Card>
        {session.self?.capabilities.includes("events.manage") ? (
          <EventEditor />
        ) : (
          <p>{t("forbidden")}</p>
        )}
      </Card>
    </div>
  );
}
