import { Check, Flame, Truck } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { CatalogNativeName } from "../../shared/catalog-selectors/CatalogNativeName.js";
import { type CatalogList, itemSchema } from "../../shared/catalog-selectors/contracts.js";
import { useCatalogQuery } from "../../shared/catalog-selectors/queries.js";
import { accountTimeZone, formatQuantity, formatUtc } from "../../shared/formatting.js";
import { InfoTip } from "../../shared/ui/info-tip.js";
import { Badge, Card } from "../../shared/ui/primitives.js";
import { CompanyLogo } from "../catalogs/CompanyLogo.js";
import { formatDamage } from "../manual-reports/model.js";
import { QualificationCheckList } from "../qualifications/QualificationCheckList.js";
import { EvidenceViewer } from "../review/decision-parts.js";
import { shortDate } from "../review/review-model.js";
import {
  CargoLabelBadges,
  GameModeBadge,
  JobTypeBadge,
  OutcomeBadge,
  SourceBadge,
} from "./badges.js";
import { formatTripRevenue } from "./list-model.js";
import { type DTO, revisionFields } from "./transport.js";
import {
  cargoLabels,
  creditState,
  formatRounded,
  qualificationSummary,
  recordedValueKey,
  reportedDamage,
  tripDuration,
  tripTimes,
} from "./trip-page-model.js";
import "../catalogs/catalogs.css";

/** Interface language and the viewer's display time zone ("as on the device" when unset). */
export function useTripDisplay() {
  const { i18n } = useTranslation("trips"),
    session = useSession();
  return {
    locale: i18n.resolvedLanguage === "en" ? ("en" as const) : ("ru" as const),
    // Null means "as on the device", like every other trip time on the page.
    timezone: accountTimeZone(session.self?.preferences.displayTimezone),
  };
}

/** Short day, month and time in the display zone, or the full form when it cannot be shortened. */
export function useWhen() {
  const { locale, timezone } = useTripDisplay();
  return (value: string) =>
    shortDate(value, locale, timezone) ?? formatUtc(value, locale, timezone);
}

/** A muted unknown value, optionally explained behind an info button; never rendered as zero. */
export function UnknownValue({ hint, label }: { hint?: string; label?: ReactNode }) {
  const { t } = useTranslation("trips");
  return (
    <span className="trip-detail-unknown">
      <span>{label ?? t("unknown")}</span>
      {hint && (
        <InfoTip label={t("unknownInfoLabel")}>
          <p>{t(hint)}</p>
        </InfoTip>
      )}
    </span>
  );
}

/**
 * A catalog label with the city's native name. The trip page leaves out the English-fallback note
 * and catalog codes; staff keep them in the technical details.
 */
export function PlaceName({ value }: { value: DTO["CatalogLabel"] }) {
  return (
    <>
      {value.label}
      <CatalogNativeName value={value} />
    </>
  );
}

/**
 * The localized label of one catalog entry read by its canonical ID. The answer must name the same
 * entry of the same game; anything else reads as unavailable.
 */
export function CatalogEntryName({
  list,
  id,
  game,
}: {
  list: CatalogList;
  id: string;
  game: DTO["TripSummary"]["game"];
}) {
  const { t } = useTranslation("trips"),
    { locale } = useTripDisplay(),
    query = useCatalogQuery(
      ["trip-catalog-entry", list, game, id, locale],
      `/catalogs/${list}/${id}?locale=${locale}`,
      itemSchema,
    );
  if (query.isPending) return <span className="trip-muted">{t("loading")}</span>;
  const item = query.data?.data.data;
  return item?.id === id && item.game === game ? (
    <PlaceName value={item.display} />
  ) : (
    <UnknownValue />
  );
}

export function TrailerName({ id, game }: { id: string; game: DTO["TripSummary"]["game"] }) {
  return <CatalogEntryName list="trailers" id={id} game={game} />;
}

type Facts = DTO["EffectiveTripFacts"];
type Fields = DTO["ManualReportReadFields"];

/**
 * The company of one route end: the effective fact's resolved company with its logo plate, else,
 * when the fact carries no company field, the company the manual report selected. An unresolved or
 * missing company is left out; its provider code stays in the technical details.
 */
function RouteCompany({
  facts,
  fields,
  side,
}: {
  facts: Facts | null;
  fields: Fields | null;
  side: "origin" | "destination";
}) {
  const key = side === "origin" ? "originCompany" : "destinationCompany";
  if (facts && key in facts) {
    const company = facts[key];
    if (company?.state !== "resolved") return null;
    return (
      <span className="trip-route-company" data-company="resolved">
        <CompanyLogo companyId={company.companyId} logo={company.logo} />
        <span className="trip-company-name">{company.name}</span>
      </span>
    );
  }
  const reported = fields?.[side === "origin" ? "originCompanyId" : "destinationCompanyId"];
  return reported && fields ? (
    <span className="trip-route-company" data-company="reported">
      <span className="trip-company-name">
        <CatalogEntryName list="companies" id={reported} game={fields.game} />
      </span>
    </span>
  ) : null;
}

function RouteEnd({
  side,
  city,
  company,
  at,
}: {
  side: "origin" | "destination";
  city: DTO["CatalogLabel"] | null;
  company: ReactNode;
  at: string | null | undefined;
}) {
  const { locale, timezone } = useTripDisplay(),
    when = useWhen();
  return (
    <div className="trip-route-end" data-side={side}>
      {company}
      {city && (
        <span className="trip-route-city">
          <PlaceName value={city} />
        </span>
      )}
      {at && (
        <time className="trip-muted" dateTime={at} title={formatUtc(at, locale, timezone)}>
          {when(at)}
        </time>
      )}
    </div>
  );
}

/** "8 h 5 min" from whole minutes. */
export function useDuration() {
  const { t } = useTranslation("trips");
  return (minutes: number) => {
    const hours = Math.floor(minutes / 60),
      rest = minutes % 60;
    return hours === 0
      ? t("durationMinutes", { minutes: rest })
      : rest === 0
        ? t("durationHours", { hours })
        : t("durationHoursMinutes", { hours, minutes: rest });
  };
}

function outcomeKey(outcome: DTO["TripSummary"]["outcome"]) {
  return outcome === "open" ? "status_in_progress" : outcome === "none" ? null : outcome;
}

/**
 * The route: origin and destination with company, city and time, the rounded distance and duration
 * between them, then the strip of distance, revenue, cargo mass and damage. Only the distance is
 * always listed (unknown is explained, never zero); other missing values are left out.
 */
export function TripRoute({
  summary,
  view,
}: {
  summary: DTO["TripSummary"];
  view: DTO["TripPrivate"] | null;
}) {
  const { t } = useTranslation("trips"),
    { locale } = useTripDisplay(),
    duration = useDuration(),
    facts = view?.effectiveFacts ?? null,
    revision = view?.manualRevision ?? null,
    fields = revision ? revisionFields(revision) : null,
    times = view ? tripTimes(facts, revision) : null,
    minutes = tripDuration(times),
    distance = formatRounded(summary.actualDistanceM, "km", locale),
    damage = view ? reportedDamage(facts, revision) : null,
    mass = facts ? facts.cargoMassKg : view && !facts ? (fields?.cargoMassKg ?? null) : null,
    outcome = outcomeKey(summary.outcome),
    middle = [distance, minutes === null ? null : duration(minutes)].filter(Boolean).join(" · ");
  return (
    <section className="card trip-route" aria-label={t("routeRegion")}>
      <div className="trip-route-line">
        <RouteEnd
          side="origin"
          city={summary.origin}
          company={view && <RouteCompany facts={facts} fields={fields} side="origin" />}
          at={times?.startedAt}
        />
        <div className="trip-route-middle">
          {middle && <span className="trip-route-measure">{middle}</span>}
          <span className="trip-route-track" aria-hidden="true">
            <span className="trip-route-dot" />
            <span className="trip-route-dash" />
            <Truck size={16} strokeWidth={1.8} focusable="false" />
            <span className="trip-route-dash" />
            <span className="trip-route-dot" data-end="true" />
          </span>
          {outcome && <span className="trip-muted">{t(outcome)}</span>}
        </div>
        <RouteEnd
          side="destination"
          city={summary.destination}
          company={view && <RouteCompany facts={facts} fields={fields} side="destination" />}
          at={times?.completedAt}
        />
      </div>
      <dl className="trip-route-strip">
        <div>
          <dt>{t("tileDistance")}</dt>
          <dd>{distance ?? <UnknownValue hint="distanceUnknownHelp" />}</dd>
        </div>
        {summary.revenue && (
          <div>
            <dt>{t("revenue")}</dt>
            <dd>
              {formatTripRevenue(summary.revenue.amount, locale)}
              {summary.revenue.currency ? (
                ` ${summary.revenue.currency}`
              ) : (
                <small className="trip-muted"> {t("currencyUnknown")}</small>
              )}
            </dd>
          </div>
        )}
        {mass !== null && (
          <div>
            <dt>{t("stripMass")}</dt>
            <dd>{formatRounded(mass, "t", locale)}</dd>
          </div>
        )}
        {damage && (
          <div>
            <dt>{t("factDamage")}</dt>
            <dd data-zero={damage.value === 0 || undefined}>
              {formatDamage(damage.value, locale)} %
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}

/** Rows of a detail card; a card without rows is left out. */
function DetailCard({
  title,
  rows,
  className,
}: {
  title: string;
  rows: { key: string; term: ReactNode; value: ReactNode }[];
  className?: string;
}) {
  const id = useId();
  if (!rows.length) return null;
  return (
    <Card className={`stack trip-detail-card ${className ?? ""}`} aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      <dl className="trip-detail-kv">
        {rows.map(({ key, term, value }) => (
          <div key={key}>
            <dt>{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/**
 * Trailers of the effective fact; the trailer type the report selected stands in only when there is
 * no effective fact. Null when none is known.
 */
function trailers(
  facts: Facts | null,
  fields: Fields | null,
  game: DTO["TripSummary"]["game"],
): ReactNode {
  if (facts) {
    const pins = facts.trailers.filter((pin) => pin !== null);
    if (!pins.length) return null;
    return (
      <span className="trip-detail-list">
        {pins.map((pin) => (
          <span key={pin.entityId}>
            <TrailerName id={pin.entityId} game={game} />
          </span>
        ))}
      </span>
    );
  }
  const selection = fields?.trailerType;
  if (selection?.status === "resolved") return <TrailerName id={selection.entityId} game={game} />;
  if (selection?.status === "unresolved") return selection.label;
  return null;
}

/** Cargo, the cargo labels the telemetry client reported, and the trailer. */
export function TripCargo({
  summary,
  view,
}: {
  summary: DTO["TripSummary"];
  view: DTO["TripPrivate"] | null;
}) {
  const { t } = useTranslation("trips"),
    facts = view?.effectiveFacts ?? null,
    revision = view?.manualRevision ?? null,
    fields = revision ? revisionFields(revision) : null,
    rows: { key: string; term: ReactNode; value: ReactNode }[] = [];
  if (summary.cargo)
    rows.push({ key: "cargo", term: t("cargo"), value: <PlaceName value={summary.cargo} /> });
  if (cargoLabels(facts?.cargoClassification).length)
    rows.push({
      key: "properties",
      term: t("cargoProperties"),
      value: <CargoLabelBadges classification={facts?.cargoClassification} tip={false} />,
    });
  const trailer = view ? trailers(facts, fields, summary.game) : null;
  if (trailer) rows.push({ key: "trailer", term: t("factTrailer"), value: trailer });
  return <DetailCard title={t("cargoTrailerTitle")} rows={rows} className="trip-cargo-card" />;
}

/**
 * Game mode, job type and Hard Mode as recorded, then the event with the owner's Link or Change
 * control. Unknown recorded values are left out.
 */
export function TripConditions({
  summary,
  view,
  onLink,
}: {
  summary: DTO["TripSummary"];
  view: DTO["TripPrivate"];
  /** Opens the event dialog; only for the owner who may link the trip. */
  onLink?: ((opener: HTMLElement) => void) | undefined;
}) {
  const { t } = useTranslation("trips"),
    recorded = view.effectiveFacts?.recordedTelemetry,
    mode = recorded?.gameMode ?? summary.gameMode,
    job = recorded?.jobType ?? summary.jobType,
    hardMode = recorded?.hardModeResult ?? summary.hardModeResult,
    hardModeKey = recordedValueKey("telemetryAudit", hardMode),
    rows: { key: string; term: ReactNode; value: ReactNode }[] = [];
  if (recordedValueKey("telemetryMode", mode))
    rows.push({ key: "mode", term: t("recordedGameMode"), value: <GameModeBadge mode={mode} /> });
  if (recordedValueKey("telemetryJob", job))
    rows.push({ key: "job", term: t("recordedJobType"), value: <JobTypeBadge job={job} /> });
  if (hardModeKey)
    rows.push({
      key: "hardMode",
      term: (
        <>
          <Flame size={12} strokeWidth={1.8} aria-hidden="true" /> {t("recordedHardModeResult")}
        </>
      ),
      value: (
        <span className="trip-hard-mode" data-result={hardMode}>
          {t(hardModeKey)}
        </span>
      ),
    });
  if ("event" in summary)
    rows.push({
      key: "event",
      term: t("eventId"),
      value: (
        <span className="trip-detail-inline">
          {summary.event ? (
            <Link to={`/account/events/${summary.event.id}`}>{summary.event.title}</Link>
          ) : (
            <span className="trip-muted">{t("eventNone")}</span>
          )}
          {onLink && (
            <>
              <span className="trip-muted" aria-hidden="true">
                ·
              </span>
              <button
                type="button"
                className="trip-link-button"
                aria-haspopup="dialog"
                onClick={(event) => onLink(event.currentTarget)}
              >
                {t(summary.event ? "eventChangeAction" : "eventLinkAction")}
              </button>
            </>
          )}
        </span>
      ),
    });
  return <DetailCard title={t("conditionsTitle")} rows={rows} className="trip-conditions-card" />;
}

/** Completion screenshots by original name and state; ready ones open in a viewer. */
export function TripEvidence({ evidence }: { evidence: DTO["Evidence"][] }) {
  const { t } = useTranslation("trips"),
    id = useId();
  return (
    <Card className="stack trip-detail-card" aria-labelledby={id}>
      <div className="trip-detail-card-head">
        <h2 id={id}>{t("evidence")}</h2>
        <span className="trip-muted">{t("screenshotCount", { count: evidence.length })}</span>
      </div>
      {evidence.length ? (
        <>
          <ul className="trip-detail-evidence">
            {evidence.map((item, index) => (
              <li key={item.id}>
                <span className="trip-detail-evidence-name">
                  <strong>{item.originalName}</strong>
                  <small className="trip-muted">
                    {t(item.state === "expired" ? "expiredShort" : item.state)}
                  </small>
                </span>
                {item.state === "ready" && <EvidenceViewer item={item} number={index + 1} />}
              </li>
            ))}
          </ul>
          {/* The retention disclosure belongs to every reader of the screenshots (policy). */}
          <p className="trip-muted">{t("retention")}</p>
        </>
      ) : (
        <p className="trip-muted">{t("noEvidence")}</p>
      )}
    </Card>
  );
}

/** The trip's author-safe sources in server order: kind, receipt, distance and outcome. */
export function TripSources({ sources }: { sources: DTO["TripStage4Source"][] | undefined }) {
  const { t } = useTranslation("trips"),
    { locale, timezone } = useTripDisplay(),
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
                  <SourceBadge source={source.kind} />
                  {source.effective && (
                    <Badge tone="info" icon={Check} className="trip-source-effective">
                      {t("sourceEffective")}
                    </Badge>
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
                    <dd>
                      <OutcomeBadge outcome={source.state} />
                    </dd>
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
 * The author-safe qualification check, collapsed: "Rules: N of M", the checked level or why there
 * is none, and the five limits through the shared list on demand. No check renders nothing.
 */
export function TripQualificationCheck({
  check,
}: {
  check: DTO["QualificationCheck"] | null | undefined;
}) {
  const { t } = useTranslation("trips"),
    { t: tq } = useTranslation("qualifications"),
    id = useId(),
    listId = useId(),
    [open, setOpen] = useState(false);
  if (!check) return null;
  const rules = qualificationSummary(check);
  return (
    <Card className="stack trip-detail-card trip-qualification" aria-labelledby={id}>
      <div className="trip-detail-card-head">
        <h2 id={id}>{t("qualificationTitle")}</h2>
        {rules && (
          <Badge tone={rules.tone} className="trip-qualification-rules">
            {t("qualificationRules", { passed: rules.passed, total: rules.total })}
          </Badge>
        )}
      </div>
      <p className="trip-qualification-text">
        {check.status === "checked"
          ? tq("checkChecked", { name: check.level?.name ?? "" })
          : check.status === "event_exempt"
            ? tq("checkEventExempt")
            : tq("checkNoLevel")}
        <span className="trip-muted">
          {" · "}
          {tq(check.basis === "decision" ? "checkBasisDecision" : "checkBasisCurrent")}
        </span>
      </p>
      {rules && (
        <>
          {open && (
            <div id={listId}>
              <QualificationCheckList check={check} rulesOnly />
            </div>
          )}
          <button
            type="button"
            className="trip-link-button"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            onClick={() => setOpen((value) => !value)}
          >
            {t(open ? "hideRules" : "showRules")}
          </button>
        </>
      )}
    </Card>
  );
}

/**
 * The bottom note: the display time zone and one info button on where the data comes from (the
 * telemetry receipt, the manual report, values from the report, the reporting basis of an accepted
 * trip and the reported cargo labels).
 */
export function TripDataNote({ view }: { view: DTO["TripPrivate"] }) {
  const { t } = useTranslation("trips"),
    { locale, timezone } = useTripDisplay(),
    when = useWhen(),
    summary = view.summary,
    telemetry = view.sources?.find((source) => source.kind === "ets2telemetry"),
    distance = telemetry ? formatRounded(telemetry.actualDistanceM, "km", locale) : null,
    revision = view.manualRevision,
    credit = creditState(summary),
    lines: { key: string; text: string }[] = [];
  if (telemetry)
    lines.push({
      key: "telemetry",
      text: distance
        ? t("dataTelemetry", { date: when(telemetry.receivedAt), distance })
        : t("dataTelemetryNoDistance", { date: when(telemetry.receivedAt) }),
    });
  else if (!summary.sourceKinds.includes("ets2telemetry"))
    lines.push({ key: "noTelemetry", text: t("unknownHelpNoTelemetry") });
  lines.push(
    revision
      ? { key: "manual", text: t("dataManual", { date: when(revision.submittedAt) }) }
      : { key: "manual", text: t("dataNoManual") },
  );
  if (revision) lines.push({ key: "reported", text: t("reportedValueHelp") });
  if (credit.basisKey) lines.push({ key: "basis", text: t(credit.basisKey) });
  if (cargoLabels(view.effectiveFacts?.cargoClassification).length)
    lines.push({ key: "labels", text: t("cargoLabelsHelp") });
  return (
    <p className="trip-muted trip-data-note">
      <span>{t("timesInZone", { timezone })}</span>
      <InfoTip label={t("dataInfoLabel")} title={t("dataTitle")}>
        {lines.map((line) => (
          <p key={line.key}>{line.text}</p>
        ))}
      </InfoTip>
    </p>
  );
}
