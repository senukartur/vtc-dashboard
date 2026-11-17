import { type ReactNode, useId } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { accountTimeZone, formatQuantity, formatUtc } from "../../shared/formatting.js";
import { Badge, Card } from "../../shared/ui/primitives.js";
import { CompanyLogo } from "../catalogs/CompanyLogo.js";
import { formatDamage } from "../manual-reports/model.js";
import { QualificationCheckList } from "../qualifications/QualificationCheckList.js";
import { type DTO, tripSourceLabels } from "./transport.js";
import { damageValue, sourceOutcomeKey } from "./trip-page-model.js";
import "../catalogs/catalogs.css";

function useDisplay() {
  const { i18n } = useTranslation("trips"),
    session = useSession();
  return {
    locale: i18n.resolvedLanguage === "en" ? ("en" as const) : ("ru" as const),
    // Null means "as on the device", like every other trip time on the page.
    timezone: accountTimeZone(session.self?.preferences.displayTimezone),
  };
}

function Company({ value }: { value: DTO["TripStage4CompanyRef"] | null }) {
  const { t } = useTranslation("trips");
  if (!value) return <>{t("notSpecified")}</>;
  // An unresolved company has no catalog entry, so it gets no plate and no image request.
  if (value.state === "unresolved")
    return (
      <span className="trip-company" data-company="unresolved">
        <span>{t("companyUnknown")}</span>
        {value.code && <small className="trip-company-code">{value.code}</small>}
      </span>
    );
  return (
    <span className="trip-company" data-company="resolved">
      <CompanyLogo companyId={value.companyId} logo={value.logo} />
      <span className="trip-company-name">
        <span>{value.name}</span>
        <small className="trip-company-code">{value.code}</small>
      </span>
    </span>
  );
}

/**
 * Sender and receiver companies, cargo damage and the event link inside the summary card. Each
 * row appears only when the server sends that fact; unknown damage is omitted, never zero.
 */
export function TripDeliveryFacts({
  summary,
  facts,
}: {
  summary: DTO["TripSummary"];
  facts?: DTO["EffectiveTripFacts"] | null | undefined;
}) {
  const { t } = useTranslation("trips"),
    { locale } = useDisplay(),
    damage = damageValue(facts),
    rows: { key: string; value: ReactNode }[] = [];
  if (facts && "originCompany" in facts)
    rows.push({ key: "senderCompany", value: <Company value={facts.originCompany ?? null} /> });
  if (facts && "destinationCompany" in facts)
    rows.push({
      key: "receiverCompany",
      value: <Company value={facts.destinationCompany ?? null} />,
    });
  if (damage !== null)
    rows.push({ key: "cargoDamagePercent", value: `${formatDamage(damage, locale)} %` });
  if (summary.event)
    rows.push({
      key: "eventId",
      value: <Link to={`/account/events/${summary.event.id}`}>{summary.event.title}</Link>,
    });
  if (!rows.length) return null;
  return (
    <dl className="trip-facts trip-delivery">
      {rows.map(({ key, value }) => (
        <div key={key}>
          <dt>{t(key)}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The trip's author-safe sources in server order: kind, receipt, distance and outcome. */
export function TripSources({ sources }: { sources: DTO["TripStage4Source"][] | undefined }) {
  const { t } = useTranslation("trips"),
    { locale, timezone } = useDisplay(),
    id = useId();
  if (!sources) return null;
  return (
    <Card className="stack" aria-labelledby={id}>
      <h2 id={id}>{t("sourcesTitle")}</h2>
      {sources.length ? (
        <>
          <ul className="trip-sources">
            {sources.map((source) => (
              <li key={source.kind}>
                <div className="trip-source-head">
                  <strong>{t(tripSourceLabels[source.kind])}</strong>
                  {source.effective && (
                    <Badge className="trip-source-effective">{t("sourceEffective")}</Badge>
                  )}
                </div>
                <dl className="trip-facts trip-source-facts">
                  <div>
                    <dt>{t("sourceReceived")}</dt>
                    <dd>{formatUtc(source.receivedAt, locale, timezone)}</dd>
                  </div>
                  <div>
                    <dt>{t("distance")}</dt>
                    <dd>{formatQuantity(source.actualDistanceM, "km", locale)}</dd>
                  </div>
                  <div>
                    <dt>{t("outcome")}</dt>
                    <dd>{t(sourceOutcomeKey(source.state))}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
          <small className="trip-muted">{t("timesIn", { timezone })}</small>
        </>
      ) : (
        <p>{t("sourcesEmpty")}</p>
      )}
    </Card>
  );
}

/**
 * The author-safe qualification check: the five level limits through the shared list, with the
 * checked level or why there is none and whether it reads the decision snapshot or current limits.
 * No check from the server renders nothing.
 */
export function TripQualificationCheck({
  check,
}: {
  check: DTO["QualificationCheck"] | null | undefined;
}) {
  const id = useId();
  if (!check) return null;
  return (
    <Card className="stack" aria-labelledby={id}>
      <QualificationCheckList check={check} headingId={id} />
    </Card>
  );
}
