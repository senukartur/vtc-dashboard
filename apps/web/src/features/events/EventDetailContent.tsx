import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { catalogParams } from "../../shared/catalog-selectors/contracts.js";
import { useCatalogQuery } from "../../shared/catalog-selectors/queries.js";
import { Card } from "../../shared/ui/primitives.js";
import { CompanyLogo } from "../catalogs/CompanyLogo.js";
import { depotListSchema } from "../catalogs/transport.js";
import { useEventTimezone } from "./components.js";
import { type DTO, eventTime } from "./model.js";
import type { EventStage2Locale } from "./stage-2-transport.js";
import { showException } from "./view-model.js";
import "../catalogs/catalogs.css";

export type DetailEvent = Omit<DTO["EventStage2Public"], "requiredDlcs"> & {
  requiredDlcs: DTO["EventStage2Public"]["requiredDlcs"] | null;
};
export type DetailMember = Omit<DTO["EventStage2Member"], "event" | "responseCounts"> & {
  event: DetailEvent;
  responseCounts: DTO["EventResponseCounts"] | null;
};

export function useDetailLocale(): EventStage2Locale {
  return useTranslation("events").i18n.resolvedLanguage === "en" ? "en" : "ru";
}

export function DetailTime({ value, publicView }: { value: string; publicView?: boolean }) {
  const timezone = useEventTimezone(publicView);
  const locale = useDetailLocale();
  return <time dateTime={value}>{eventTime(value, locale, timezone)}</time>;
}

function CatalogName({ item }: { item: DTO["CatalogLabel"] }) {
  const { t } = useTranslation("events");
  return (
    <>
      <span lang={item.renderedLocale}>{item.label}</span>
      {item.englishFallback && (
        <span className="events-language muted"> {t("englishFallback")}</span>
      )}
    </>
  );
}

export function EventSchedule({
  event,
  publicView,
  responsesOpen,
}: {
  event: DetailEvent;
  publicView: boolean;
  responsesOpen: boolean;
}) {
  const { t } = useTranslation("events");
  return (
    <>
      <h2>{t("schedule")}</h2>
      <dl className="events-facts">
        <div>
          <dt>{t("meetingAt")}</dt>
          <dd>
            <DetailTime value={event.meetingAt} publicView={publicView} />
          </dd>
        </div>
        <div>
          <dt>{t("startsAt")}</dt>
          <dd>
            <DetailTime value={event.startsAt} publicView={publicView} />
            {responsesOpen && <span className="events-fact-note">{t("responseClosed")}</span>}
          </dd>
        </div>
        {event.endsAt && (
          <div>
            <dt>{t("endsAt")}</dt>
            <dd>
              <DetailTime value={event.endsAt} publicView={publicView} />
            </dd>
          </div>
        )}
        {!event.originDepot && event.meetingLocation && (
          <div>
            <dt>{t("meetingLocation")}</dt>
            <dd>{event.meetingLocation}</dd>
          </div>
        )}
      </dl>
    </>
  );
}

function DepotLogo({
  game,
  cityId,
  depotId,
}: {
  game: DetailEvent["game"];
  cityId: string;
  depotId: string;
}) {
  const locale = useDetailLocale();
  const path = `/catalogs/depots?${catalogParams({ game, cityId, depotId, includeHidden: "true", locale })}`;
  const query = useCatalogQuery(["event-detail-depot", path], path, depotListSchema);
  const row = query.data?.data.data.items.find(
    (item) => item.id === depotId && item.game === game && item.city.id === cityId,
  );
  return row ? <CompanyLogo companyId={row.company.id} logo={row.company.logo} /> : null;
}

function RouteStop({
  title,
  city,
  depot,
  game,
  publicView,
}: {
  title: string;
  city: DetailEvent["origin"];
  depot: DetailEvent["originDepot"];
  game: DetailEvent["game"];
  publicView: boolean;
}) {
  const { t } = useTranslation("events");
  return (
    <div className="events-route-stop">
      <dt>{title}</dt>
      <dd>
        {city ? (
          <strong>
            <CatalogName item={city} />
          </strong>
        ) : (
          <span className="muted">{t("notSpecified")}</span>
        )}
        {depot && (
          <>
            <span className="events-catalog-pair">
              <span>{depot.name}</span>
              <span className="muted">{depot.code}</span>
            </span>
            {!publicView && city && (
              <DepotLogo game={game} cityId={city.entityId} depotId={depot.id} />
            )}
          </>
        )}
      </dd>
    </div>
  );
}

export function EventRoute({ event, publicView }: { event: DetailEvent; publicView: boolean }) {
  const { t } = useTranslation("events");
  const locale = useDetailLocale();
  const routeStops =
    event.origin || event.destination || event.originDepot || event.destinationDepot;
  return (
    <>
      <h2>{t("route")}</h2>
      <dl className="events-facts events-route-info">
        <div>
          <dt>{t("platform")}</dt>
          <dd>
            {event.platform === "truckersmp"
              ? "TruckersMP"
              : event.platform === "haulmp"
                ? "HaulMP"
                : t("notSpecified")}
          </dd>
        </div>
        <div>
          <dt>{t("server")}</dt>
          <dd>{event.server}</dd>
        </div>
        <div>
          <dt>{t("distance")}</dt>
          <dd>
            {event.distanceKm === null
              ? t("notSpecified")
              : t("distanceKm", {
                  value: locale === "ru" ? event.distanceKm.replace(".", ",") : event.distanceKm,
                })}
          </dd>
        </div>
      </dl>
      {routeStops && (
        <dl className="events-facts events-route-stops">
          <RouteStop
            title={t("routeStart")}
            city={event.origin}
            depot={event.originDepot}
            game={event.game}
            publicView={publicView}
          />
          <RouteStop
            title={t("routeFinish")}
            city={event.destination}
            depot={event.destinationDepot}
            game={event.game}
            publicView={publicView}
          />
        </dl>
      )}
      {event.route && (!event.originDepot || !event.destinationDepot) && (
        <p className="events-route-text">{event.route}</p>
      )}
      <dl className="events-facts">
        <div>
          <dt>{t("requiredDlcs")}</dt>
          <dd>
            {event.requiredDlcs === null ? (
              t("notSpecified")
            ) : event.requiredDlcs.length ? (
              <ul className="events-catalog-list">
                {event.requiredDlcs.map((dlc) => (
                  <li key={dlc.id} className="events-catalog-pair">
                    <span>{dlc.name}</span>
                    <span className="muted">{dlc.code}</span>
                  </li>
                ))}
              </ul>
            ) : (
              t("baseMap")
            )}
          </dd>
        </div>
      </dl>
    </>
  );
}

export function EventLoad({ member, legacy }: { member: DetailMember; legacy: boolean }) {
  const { t } = useTranslation("events");
  return (
    <>
      <h2>{t("load")}</h2>
      <dl className="events-facts">
        {member.prescribedMassKg !== null && (
          <div>
            <dt>{t("prescribedMassKg")}</dt>
            <dd className="events-break">{member.prescribedMassKg}</dd>
          </div>
        )}
        {(member.prescribedCargo !== null || member.prescribedCargoId !== null) && (
          <div>
            <dt>{t("prescribedCargoId")}</dt>
            <dd className={legacy ? "events-break" : undefined}>
              {member.prescribedCargo ? (
                <CatalogName item={member.prescribedCargo} />
              ) : (
                ((legacy ? member.prescribedCargoId : null) ?? t("notSpecified"))
              )}
            </dd>
          </div>
        )}
        {(member.prescribedTrailerType !== null || member.prescribedTrailerTypeId !== null) && (
          <div>
            <dt>{t("prescribedTrailerTypeId")}</dt>
            <dd className={legacy ? "events-break" : undefined}>
              {member.prescribedTrailerType ? (
                <CatalogName item={member.prescribedTrailerType} />
              ) : (
                ((legacy ? member.prescribedTrailerTypeId : null) ?? t("notSpecified"))
              )}
            </dd>
          </div>
        )}
      </dl>
      {showException(member) && <p className="events-exception">{t("exceptionHelp")}</p>}
    </>
  );
}

export function EventOrganizer({ name, memberId }: { name: string; memberId?: string | null }) {
  const { t } = useTranslation("events");
  const id = useId();
  return (
    <Card aria-labelledby={id}>
      <h2 id={id}>{t("organizer")}</h2>
      {memberId ? (
        <Link className="events-detail-link" to={`/account/drivers/${memberId}`}>
          {name}
        </Link>
      ) : (
        <p>{name}</p>
      )}
    </Card>
  );
}
