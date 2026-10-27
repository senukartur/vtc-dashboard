import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { Button, Card } from "../../shared/ui/primitives.js";
import { publicContent, publicPath } from "../landing/content.js";
import { EventCard, EventState } from "./components.js";
import { EventEditor } from "./EventEditor.js";
import { periodFrom } from "./model.js";
import { useEventQuery } from "./queries.js";
import "./events.css";

export function EventsPage({ publicView = false }: { publicView?: boolean }) {
  const { t, i18n } = useTranslation("events"),
    session = useSession(),
    [search, setSearch] = useSearchParams(),
    period = periodFrom(search.get("period")),
    cursor = search.get("cursor"),
    allowed = publicView || !!session.self?.capabilities.includes("company.read");
  const query = useEventQuery(
    `${publicView ? "/public" : ""}/events?period=${period}&limit=12${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    "EnvelopeListEventPublic",
    allowed,
  );
  const data = query.data?.data.data;
  return (
    <div className="event-page stack">
      <header className="event-heading">
        <h1>{t(publicView ? "publicTitle" : "title")}</h1>
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
          <nav className="event-actions" aria-label={t("title")}>
            {["upcoming", "past"].map((p) => (
              <Button
                key={p}
                variant={period === p ? "default" : "outline"}
                aria-pressed={period === p}
                onClick={() => setSearch({ period: p })}
              >
                {t(p)}
              </Button>
            ))}
          </nav>
          <EventState query={query} {...(cursor ? { reset: () => setSearch({ period }) } : {})} />
          {data && (
            <>
              <div className="event-grid">
                {data.items.map((e) => (
                  <EventCard key={e.id} event={e} publicView={publicView} />
                ))}
              </div>
              {!data.items.length && (
                <Card>
                  <p>{t("empty")}</p>
                </Card>
              )}
              <nav className="event-actions" aria-label={t("next")}>
                {cursor && (
                  <Button variant="outline" onClick={() => setSearch({ period })}>
                    {t("first")}
                  </Button>
                )}
                {data.nextCursor && (
                  <Button
                    variant="outline"
                    onClick={() => setSearch({ period, cursor: data.nextCursor as string })}
                  >
                    {t("next")}
                  </Button>
                )}
              </nav>
            </>
          )}
        </>
      )}
    </div>
  );
}
export function CreateEventPage() {
  const { t } = useTranslation("events"),
    session = useSession();
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
export function PublicEventWidget() {
  const { t } = useTranslation("events"),
    query = useEventQuery("/public/events?period=upcoming&limit=3", "EnvelopeListEventPublic");
  const data = query.data?.data.data;
  return (
    <section className="landing-section stack" aria-labelledby="landing-events">
      <header className="event-heading">
        <h2 id="landing-events">{t("publicTitle")}</h2>
        <Link to="/events">{t("title")}</Link>
      </header>
      <EventState query={query} />
      {data &&
        (data.items.length ? (
          <div className="event-grid">
            {data.items.map((event) => (
              <EventCard key={event.id} event={event} publicView />
            ))}
          </div>
        ) : (
          <p>{t("empty")}</p>
        ))}
    </section>
  );
}
