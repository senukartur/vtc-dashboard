import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { decimalShift, formatQuantity } from "../../shared/formatting.js";
import { Table } from "../../shared/ui/primitives.js";
import { formatDamage } from "../manual-reports/model.js";
import { RecordedTelemetryFields } from "../trips/components.js";
import { type DTO, revisionFields } from "../trips/transport.js";
import { EntityLabel, ReviewSection } from "./decision-parts.js";

export function SourceComparison({
  manual,
  telemetry,
  game,
  timezone,
}: {
  manual: DTO["ManualRevisionRead"] | null;
  telemetry: DTO["TripStage3TelemetryNormalizedFacts"] | null;
  game: DTO["Game"];
  timezone: string;
}) {
  const { t, i18n } = useTranslation("trips");
  const locale = i18n.resolvedLanguage === "en" ? "en" : "ru";
  const fields = manual ? revisionFields(manual) : null;
  const quantity = (value: string | null | undefined, unit: "km" | "t") => ({
    comparable: value == null ? null : decimalShift(value, 0),
    text: formatQuantity(value ?? null, unit, locale),
  });
  const formatter = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
    timeZone: timezone,
  });
  const time = (value: string | null | undefined) => {
    const instant = value ? Date.parse(value) : Number.NaN;
    return Number.isFinite(instant)
      ? { comparable: instant, text: formatter.format(instant), dateTime: value }
      : { comparable: null, text: t("unknown") };
  };
  const label = (
    entityId: string | null | undefined,
    kind: "cargo" | "city" | "trailer",
    unresolved?: string,
  ) => ({
    comparable: entityId ?? null,
    text: entityId ? (
      <EntityLabel entityId={entityId} kind={kind} game={game} />
    ) : unresolved ? (
      <span className="review-break">
        {unresolved} · {t("unknownEntity")}
      </span>
    ) : (
      t("unknown")
    ),
  });
  const manualLabel = (
    value: DTO["ManualCatalogSelection"] | undefined,
    kind: "cargo" | "city" | "trailer",
  ) =>
    label(
      value?.status === "resolved" ? value.entityId : null,
      kind,
      value?.status === "unresolved" ? value.label : undefined,
    );
  const damage = (value: number | null | undefined) => ({
    comparable: value ?? null,
    text: value == null ? t("unknown") : `${formatDamage(value, locale)}%`,
  });

  type Cell = {
    comparable: string | number | null;
    text: ReactNode;
    dateTime?: string | null | undefined;
  };
  const trailers = telemetry?.trailers ?? [];
  const trailerId =
    telemetry?.trailersComplete && trailers.length === 1 ? trailers[0]?.entityId : null;
  const rows: [string, Cell, Cell][] = [
    [
      "actualDistanceDisplay",
      quantity(fields?.actualDistanceM, "km"),
      quantity(telemetry?.actualDistanceM, "km"),
    ],
    ["cargo", manualLabel(fields?.cargo, "cargo"), label(telemetry?.cargo?.entityId, "cargo")],
    ["cargoMassDisplay", quantity(fields?.cargoMassKg, "t"), quantity(telemetry?.cargoMassKg, "t")],
    ["dispatchCompareStart", time(fields?.startedAt), time(telemetry?.actualStartAt)],
    ["dispatchCompareEnd", time(fields?.completedAt), time(telemetry?.actualCompletedAt)],
    ["origin", manualLabel(fields?.origin, "city"), label(telemetry?.origin?.entityId, "city")],
    [
      "destination",
      manualLabel(fields?.destination, "city"),
      label(telemetry?.destination?.entityId, "city"),
    ],
    [
      "cargoDamagePercent",
      damage(fields?.cargoDamagePercent),
      damage(telemetry?.cargoDamagePercent),
    ],
    ["trailerType", manualLabel(fields?.trailerType, "trailer"), label(trailerId, "trailer")],
  ];
  if (!manual && !telemetry) return null;
  return (
    <ReviewSection title={t("dispatchSourceComparison")} note={t("timesIn", { timezone })}>
      {!manual && <p className="review-muted">{t("dispatchNoManualSource")}</p>}
      {!telemetry && <p className="review-muted">{t("dispatchNoTelemetrySource")}</p>}
      <Table className="review-diff dispatch-comparison">
        <thead>
          <tr>
            <th scope="col">{t("field")}</th>
            <th scope="col">{t("type_manual")}</th>
            <th scope="col">{t("ets2telemetry")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, report, recorded]) => {
            const bothKnown = report.comparable !== null && recorded.comparable !== null;
            const different = bothKnown && report.comparable !== recorded.comparable;
            const unavailable =
              !bothKnown && (report.comparable !== null || recorded.comparable !== null);
            return (
              <tr key={name} data-changed={different ? "true" : undefined}>
                <th scope="row">
                  {t(name)}
                  {different && (
                    <span className="review-changed">{t("dispatchSourceDifference")}</span>
                  )}
                  {unavailable && (
                    <span className="review-muted">{t("dispatchComparisonUnavailable")}</span>
                  )}
                </th>
                <td>
                  {report.dateTime ? (
                    <time dateTime={report.dateTime}>{report.text}</time>
                  ) : (
                    report.text
                  )}
                </td>
                <td>
                  {recorded.dateTime ? (
                    <time dateTime={recorded.dateTime}>{recorded.text}</time>
                  ) : (
                    recorded.text
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <div className="stack">
        <h4>{t(telemetry ? "dispatchTelemetryConditions" : "dispatchGameConditions")}</h4>
        <dl className="review-facts">
          <RecordedTelemetryFields telemetry={telemetry?.recordedTelemetry} />
        </dl>
      </div>
    </ReviewSection>
  );
}
