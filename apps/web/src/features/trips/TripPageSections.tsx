import { Check, Flame } from "lucide-react";
import { type ReactNode, useId } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { type CatalogList, itemSchema } from "../../shared/catalog-selectors/contracts.js";
import { useCatalogQuery } from "../../shared/catalog-selectors/queries.js";
import { accountTimeZone, formatQuantity, formatUtc } from "../../shared/formatting.js";
import { InfoTip } from "../../shared/ui/info-tip.js";
import { Badge, Card } from "../../shared/ui/primitives.js";
import { CompanyLogo } from "../catalogs/CompanyLogo.js";
import { formatDamage } from "../manual-reports/model.js";
import { QualificationCheckList } from "../qualifications/QualificationCheckList.js";
import { EvidenceViewer } from "../review/decision-parts.js";
import {
  CargoLabelBadges,
  GameModeBadge,
  JobTypeBadge,
  OutcomeBadge,
  SourceBadge,
} from "./badges.js";
import type { Changes, CorrectionField } from "./correction-model.js";
import { CatalogName } from "./TripTable.js";
import { type DTO, revisionFields } from "./transport.js";
import { recordedValueKey, reportedDamage, tripTimes, unknownHintKey } from "./trip-page-model.js";
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

export function Company({ value }: { value: DTO["TripStage4CompanyRef"] | null }) {
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
    <CatalogName value={item.display} />
  ) : (
    <UnknownValue />
  );
}

export function TrailerName({ id, game }: { id: string; game: DTO["TripSummary"]["game"] }) {
  return <CatalogEntryName list="trailers" id={id} game={game} />;
}

/** A catalog label, or a muted "Unavailable" when the server knows none. */
function Label({ value }: { value: DTO["CatalogLabel"] | null }) {
  return value ? <CatalogName value={value} /> : <UnknownValue />;
}

function Place({ city, company }: { city: DTO["CatalogLabel"] | null; company: ReactNode }) {
  return (
    <span className="trip-detail-place">
      <span>
        <Label value={city} />
      </span>
      {company && (
        <>
          <span className="trip-muted" aria-hidden="true">
            ·
          </span>
          {company}
        </>
      )}
    </span>
  );
}

/**
 * A company of the effective fact, else, when the fact carries no company field, the company the
 * manual report selected, else nothing, so the place reads as the city alone. An unresolved company
 * that kept a provider code stays visible as unknown; one without a code counts as missing.
 */
function placeCompany(
  facts: DTO["EffectiveTripFacts"] | null,
  fields: DTO["ManualReportReadFields"] | null,
  side: "origin" | "destination",
) {
  const key = side === "origin" ? "originCompany" : "destinationCompany";
  if (facts && key in facts) {
    const effective = facts[key];
    return effective && (effective.state === "resolved" || effective.code) ? (
      <Company value={effective} />
    ) : null;
  }
  const reported = fields?.[side === "origin" ? "originCompanyId" : "destinationCompanyId"];
  return reported && fields ? (
    <CatalogEntryName list="companies" id={reported} game={fields.game} />
  ) : null;
}

/** "by the report" with an explanation: the value comes from the driver's report, not the fact. */
function ReportedMark({ times = false }: { times?: boolean }) {
  const { t } = useTranslation("trips"),
    { timezone } = useTripDisplay();
  return (
    <>
      <span className="trip-muted">· {t("reportedTime")}</span>
      <InfoTip label={t(times ? "reportedInfoLabel" : "reportedValueLabel")}>
        <p>{times ? t("referenceHelp", { timezone }) : t("reportedValueHelp")}</p>
      </InfoTip>
    </>
  );
}

/**
 * Trailers of the effective fact. The trailer type the report selected stands in, marked as
 * reported, only when there is no effective fact; an empty or unknown fact stays unknown.
 */
function Trailers({
  facts,
  fields,
  game,
}: {
  facts: DTO["EffectiveTripFacts"] | null;
  fields: DTO["ManualReportReadFields"] | null;
  game: DTO["TripSummary"]["game"];
}) {
  if (facts) {
    const pins = facts.trailers;
    if (!pins.length) return <UnknownValue />;
    return (
      <span className="trip-detail-list">
        {pins.map((pin, i) => (
          <span key={pin?.entityId ?? `unknown-${i}`}>
            {pin ? <TrailerName id={pin.entityId} game={game} /> : <UnknownValue />}
          </span>
        ))}
      </span>
    );
  }
  const selection = fields?.trailerType;
  if (selection?.status !== "resolved" && selection?.status !== "unresolved")
    return <UnknownValue />;
  return (
    <span className="trip-detail-inline">
      {selection.status === "resolved" ? (
        <TrailerName id={selection.entityId} game={game} />
      ) : (
        <span>{selection.label}</span>
      )}
      <ReportedMark />
    </span>
  );
}

/** Correction marks of the trip facts (VTC-169): unconfirmed facts and pending proposed values. */
export type CorrectionMarks = {
  unconfirmed: ReadonlySet<CorrectionField>;
  proposed: Changes;
};
const entityList = {
  originCityId: "cities",
  destinationCityId: "cities",
  cargoId: "cargoes",
  trailerTypeId: "trailers",
} as const satisfies Partial<Record<CorrectionField, CatalogList>>;

/** One corrected or reported value of a correctable fact in display units. */
export function CorrectionValue({
  field,
  value,
  game,
}: {
  field: CorrectionField;
  value: string;
  game: DTO["TripSummary"]["game"];
}) {
  const { locale, timezone } = useTripDisplay();
  switch (field) {
    case "actualDistanceM":
      return <>{formatQuantity(value, "km", locale)}</>;
    case "cargoMassKg":
      return <>{formatQuantity(value, "t", locale)}</>;
    case "actualStartAt":
    case "actualCompletedAt":
      return <time dateTime={value}>{formatUtc(value, locale, timezone)}</time>;
    default:
      return <CatalogEntryName list={entityList[field]} id={value} game={game} />;
  }
}

/**
 * The mark after a correctable fact: the pending proposed value ("251 → 312 km · correction under
 * review"), else "not confirmed" for an unconfirmed telemetry fact, else nothing.
 */
function CorrectionMark({
  field,
  marks,
  game,
}: {
  field: CorrectionField;
  marks: CorrectionMarks | undefined;
  game: DTO["TripSummary"]["game"];
}) {
  const { t } = useTranslation("trips"),
    proposed = marks?.proposed[field];
  if (proposed)
    return (
      <span className="trip-correction-proposed" data-field={field}>
        <span aria-hidden="true">→ </span>
        <span className="visually-hidden">{t("correctionProposed")}: </span>
        <CorrectionValue field={field} value={proposed} game={game} />
        <span className="trip-muted"> · {t("correctionPendingInline")}</span>
      </span>
    );
  if (!marks?.unconfirmed.has(field)) return null;
  return (
    <span className="trip-correction-unconfirmed" data-field={field}>
      <Badge tone="warn" className="trip-unconfirmed">
        {t("unconfirmed")}
      </Badge>
      <InfoTip label={t("unconfirmed")}>
        <p>{t("unconfirmedHelp")}</p>
      </InfoTip>
    </span>
  );
}

function Time({
  value,
  reported,
  hint,
}: {
  value: string | null | undefined;
  reported: boolean;
  hint: string;
}) {
  const { locale, timezone } = useTripDisplay();
  if (!value) return <UnknownValue hint={hint} />;
  return (
    <span className="trip-detail-inline">
      <time dateTime={value}>{formatUtc(value, locale, timezone)}</time>
      {reported && <ReportedMark times />}
    </span>
  );
}

/**
 * The trip itself: route with companies, cargo, trailer, times, damage, event and, in a private
 * view, the recorded game conditions. Unknown values are muted and never shown as zero.
 */
export function TripFacts({
  summary,
  view,
  marks,
}: {
  summary: DTO["TripSummary"];
  view: DTO["TripPrivate"] | null;
  marks?: CorrectionMarks;
}) {
  const { t } = useTranslation("trips"),
    { locale, timezone } = useTripDisplay(),
    id = useId(),
    facts = view?.effectiveFacts ?? null,
    revision = view?.manualRevision ?? null,
    fields = revision ? revisionFields(revision) : null,
    hint = unknownHintKey(summary),
    times = tripTimes(facts, revision),
    damage = reportedDamage(facts, revision),
    recorded = facts?.recordedTelemetry,
    rows: { key: string; term: ReactNode; value: ReactNode }[] = [];
  const add = (key: string, value: ReactNode, term: ReactNode = t(key)) =>
    rows.push({ key, term, value });
  const mark = (field: CorrectionField) => (
    <CorrectionMark field={field} marks={marks} game={summary.game} />
  );
  const marked = (value: ReactNode, ...fields: CorrectionField[]) =>
    fields.some((field) => marks?.proposed[field] || marks?.unconfirmed.has(field)) ? (
      <span className="trip-detail-inline trip-correction-row">
        {value}
        {fields.map((field) => (
          <span key={field}>{mark(field)}</span>
        ))}
      </span>
    ) : (
      value
    );
  // The tiles show the distance; the facts repeat it only to mark or correct it.
  if (marks?.proposed.actualDistanceM || marks?.unconfirmed.has("actualDistanceM"))
    add(
      "factDistance",
      marked(
        summary.actualDistanceM === null ? (
          <UnknownValue hint="distanceUnknownHelp" />
        ) : (
          formatQuantity(summary.actualDistanceM, "km", locale)
        ),
        "actualDistanceM",
      ),
    );
  add(
    "factFrom",
    marked(
      <Place city={summary.origin} company={placeCompany(facts, fields, "origin")} />,
      "originCityId",
    ),
  );
  add(
    "factTo",
    marked(
      <Place city={summary.destination} company={placeCompany(facts, fields, "destination")} />,
      "destinationCityId",
    ),
  );
  add(
    "cargo",
    marked(
      <span className="trip-detail-inline">
        <span>
          <Label value={summary.cargo} />
          {facts?.cargoMassKg && ` · ${formatQuantity(facts.cargoMassKg, "t", locale)}`}
        </span>
        <CargoLabelBadges classification={facts?.cargoClassification} />
      </span>,
      "cargoId",
      "cargoMassKg",
    ),
  );
  if (view) {
    add(
      "factTrailer",
      marked(<Trailers facts={facts} fields={fields} game={summary.game} />, "trailerTypeId"),
    );
    add(
      "factStarted",
      marked(
        <Time value={times?.startedAt} reported={!!times?.reported} hint={hint} />,
        "actualStartAt",
      ),
    );
    add(
      "factCompleted",
      marked(
        <Time value={times?.completedAt} reported={!!times?.reported} hint={hint} />,
        "actualCompletedAt",
      ),
    );
    add(
      "factDamage",
      damage === null ? (
        <UnknownValue hint="unknownHelpGeneric" />
      ) : damage.reported ? (
        <span className="trip-detail-inline">
          <span>{t("damageOfCargo", { value: formatDamage(damage.value, locale) })}</span>
          <ReportedMark />
        </span>
      ) : (
        t("damageOfCargo", { value: formatDamage(damage.value, locale) })
      ),
    );
  }
  if ("event" in summary)
    add(
      "eventId",
      summary.event ? (
        <Link to={`/account/events/${summary.event.id}`}>{summary.event.title}</Link>
      ) : (
        <span className="trip-muted">{t("eventNone")}</span>
      ),
    );
  if (view) {
    const conditions = [
      [
        "recordedGameMode",
        recordedValueKey("telemetryMode", recorded?.gameMode ?? summary.gameMode),
      ],
      ["recordedJobType", recordedValueKey("telemetryJob", recorded?.jobType)],
      ["recordedHardModeResult", recordedValueKey("telemetryAudit", recorded?.hardModeResult)],
    ] as const;
    for (const [key, value] of conditions)
      add(
        key,
        key === "recordedGameMode" ? (
          value ? (
            <GameModeBadge mode={recorded?.gameMode ?? summary.gameMode ?? "unknown"} />
          ) : (
            <UnknownValue label={<GameModeBadge mode="unknown" />} hint={hint} />
          )
        ) : key === "recordedJobType" ? (
          value ? (
            <JobTypeBadge job={recorded?.jobType ?? "unknown"} />
          ) : (
            <UnknownValue label={<JobTypeBadge job="unknown" />} hint={hint} />
          )
        ) : value ? (
          t(value)
        ) : (
          <UnknownValue label={t("recordedUnknown")} hint={hint} />
        ),
        key === "recordedHardModeResult" ? (
          <>
            <Flame size={12} strokeWidth={1.8} aria-hidden="true" /> {t(key)}
          </>
        ) : (
          t(key)
        ),
      );
  }
  return (
    <Card className="stack trip-detail-card trip-detail-facts" aria-labelledby={id}>
      <h2 id={id}>{t("tripTitle")}</h2>
      <dl className="trip-detail-kv">
        {rows.map(({ key, term, value }) => (
          <div key={key}>
            <dt>{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {view && <small className="trip-muted">{t("timesIn", { timezone })}</small>}
    </Card>
  );
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
