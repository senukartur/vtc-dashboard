import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { decimalShift, formatQuantity } from "../../shared/formatting.js";
import { DataTable, type DataTableColumn } from "../../shared/ui/DataTable.js";
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
  type ComparisonRow = [string, Cell, Cell];
  const rows: ComparisonRow[] = [
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
  function compare(report: Cell, recorded: Cell) {
    if (report.comparable === null || recorded.comparable === null)
      return report.comparable !== recorded.comparable ? "unavailable" : "unknown";
    return report.comparable !== recorded.comparable ? "different" : "same";
  }
  function show(cell: Cell) {
    return cell.dateTime ? <time dateTime={cell.dateTime}>{cell.text}</time> : cell.text;
  }
  const columns: DataTableColumn<ComparisonRow>[] = [
    {
      id: "field",
      header: t("field"),
      rowHeader: true,
      cardLabel: false,
      className: "dispatch-comparison-field",
      cell: ([name, report, recorded]) => {
        const status = compare(report, recorded);
        return (
          <>
            {t(name)}
            {status === "different" && (
              <span className="review-changed">{t("dispatchSourceDifference")}</span>
            )}
            {status === "unavailable" && (
              <span className="review-muted">{t("dispatchComparisonUnavailable")}</span>
            )}
          </>
        );
      },
    },
    {
      id: "manual",
      header: t("type_manual"),
      cell: ([, report]) => show(report),
    },
    {
      id: "telemetry",
      header: t("ets2telemetry"),
      cell: ([, , recorded]) => show(recorded),
    },
  ];
  if (!manual && !telemetry) return null;
  return (
    <ReviewSection title={t("dispatchSourceComparison")} note={t("timesIn", { timezone })}>
      {!manual && <p className="review-muted">{t("dispatchNoManualSource")}</p>}
      {!telemetry && <p className="review-muted">{t("dispatchNoTelemetrySource")}</p>}
      <DataTable
        caption={t("dispatchSourceComparison")}
        className="dispatch-comparison"
        rows={rows}
        columns={columns}
        rowKey={([name]) => name}
        rowAttributes={([, report, recorded]) => ({
          "data-changed": compare(report, recorded) === "different" ? "true" : undefined,
        })}
      />
      <div className="stack">
        <h4>{t(telemetry ? "dispatchTelemetryConditions" : "dispatchGameConditions")}</h4>
        <dl className="review-facts">
          <RecordedTelemetryFields telemetry={telemetry?.recordedTelemetry} />
        </dl>
      </div>
    </ReviewSection>
  );
}
