import { type ReactNode, useId } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { accountTimeZone, formatQuantity, formatUtc } from "../../shared/formatting.js";
import { Badge, Card } from "../../shared/ui/primitives.js";
import { CompanyLogo } from "../catalogs/CompanyLogo.js";
import { formatDamage } from "../manual-reports/model.js";
import { CatalogName } from "./TripTable.js";
import {
  damageValue,
  emptyAllowlist,
  extraTrailerTypes,
  ruleRows,
  sourceOutcomeKey,
  type TripRuleRow,
} from "./trip-page-model.js";
import { type DTO, tripSourceLabels } from "./transport.js";
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

function Labels({ values }: { values: DTO["CatalogLabel"][] }) {
  return (
    <>
      {values.map((value, index) => (
        <span key={value.entityId}>
          {index > 0 && ", "}
          <CatalogName value={value} />
        </span>
      ))}
    </>
  );
}

function RuleDetail({ row }: { row: TripRuleRow }) {
  const { t } = useTranslation("trips"),
    { locale } = useDisplay(),
    rule = row.rule,
    lines: { key: string; line: ReactNode }[] = [];
  if (!rule) lines.push({ key: "unresolved", line: t("checkUnresolved") });
  else if (rule.ruleType === "max_mass") {
    const limit = formatQuantity(rule.limitMassKg, "t", locale);
    lines.push({
      key: "mass",
      line:
        rule.observedMassKg === null
          ? t("massUnknown", { limit })
          : t("massDetail", { observed: formatQuantity(rule.observedMassKg, "t", locale), limit }),
    });
  } else if (rule.ruleType === "allowed_trailer_types") {
    const extra = extraTrailerTypes(rule);
    // An empty configured allowlist permits nothing; say so instead of omitting the value.
    if (emptyAllowlist(rule)) lines.push({ key: "allowed", line: t("ruleAllowedNone") });
    else
      lines.push({
        key: "allowed",
        line: (
          <>
            {t("ruleAllowed")} <Labels values={rule.allowedTrailerTypes} />
            {extra > 0 && ` ${t("ruleMore", { count: extra })}`}
          </>
        ),
      });
    if (rule.offendingTrailerTypes.length)
      lines.push({
        key: "offending",
        line: (
          <>
            {t("notAllowed")} <Labels values={rule.offendingTrailerTypes} />
          </>
        ),
      });
  } else {
    const adr = (value: string) => t("catalogs:adrClass", { class: value });
    // No ADR class allowed still permits non-hazardous cargo (see the qualification editor).
    if (emptyAllowlist(rule)) lines.push({ key: "allowed", line: t("ruleAdrNone") });
    else
      lines.push({
        key: "allowed",
        line: `${t("ruleAllowed")} ${rule.allowedAdrClasses.map(adr).join(", ")}`,
      });
    if (rule.observedAdrClass)
      lines.push({
        key: "observed",
        line: t("ruleAdrObserved", { class: adr(rule.observedAdrClass) }),
      });
  }
  return (
    <>
      {lines.map(({ key, line }) => (
        <span key={key} className="trip-rule-detail">
          {line}
        </span>
      ))}
    </>
  );
}

/**
 * The author-safe qualification check, rule by rule. Every state has a symbol and visible text, so
 * it never depends on colour. No check from the server renders nothing; unresolved history shows
 * one unavailable row with a translated reason when one exists, never the raw code.
 */
export function TripQualificationCheck({
  check,
}: {
  check: DTO["TripStage4QualificationCheck"] | null | undefined;
}) {
  const { t, i18n } = useTranslation("trips"),
    id = useId(),
    rows = ruleRows(check),
    reason = check?.reasonCode ? `code_${check.reasonCode}` : null;
  if (!rows) return null;
  return (
    <Card className="stack" aria-labelledby={id}>
      <h2 id={id}>{t("check")}</h2>
      {rows.length ? (
        <ul className="trip-checks">
          {rows.map((row) => (
            <li key={row.key} data-state={row.state}>
              <span className="trip-rule-symbol" aria-hidden="true">
                {row.symbol}
              </span>
              <span className="trip-rule-text">
                <span className="trip-rule-title">
                  {row.rule && <span>{t(row.rule.ruleType)}</span>}
                  <span className="trip-rule-state">{t(`state_${row.state}`)}</span>
                </span>
                <RuleDetail row={row} />
                {!row.rule && reason && i18n.exists(`trips:${reason}`) && (
                  <span className="trip-rule-detail">{t(reason)}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p>{t("noRules")}</p>
      )}
    </Card>
  );
}
