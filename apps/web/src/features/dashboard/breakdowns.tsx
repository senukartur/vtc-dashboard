// Overview trip breakdowns (VTC-148): popular routes, frequent cargo and how trips arrived, for
// the page's game and period. Each card has its own loading, empty, error and forbidden state;
// exact counts are always text, and the bars are decorative.
import { Fragment, type ReactNode, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { CatalogNativeName } from "../../shared/catalog-selectors/CatalogNativeName.js";
import { formatDecimal, type Locale } from "../../shared/formatting.js";
import { isRateLimited, rateLimitSeconds } from "../../shared/rate-limit.js";
import { Badge, Card } from "../../shared/ui/primitives.js";
import { RateLimitNotice } from "../../shared/ui/rate-limit-notice.js";
import { KeepFocusButton } from "../events/components.js";
import { useBlockRetry } from "./blocks.js";
import { Skeleton } from "./components.js";
import {
  type BreakdownData,
  type BreakdownDimension,
  blockView,
  breakdownEmpty,
  breakdownRows,
  formatPercent,
  type QueryView,
  type SourcePart,
  sourceShares,
  tripsKey,
} from "./view-model.js";
import "./dashboard.css";

const copy = {
  route: {
    title: "breakdowns.routesTitle",
    error: "breakdowns.routesError",
    other: "breakdowns.otherRoutes",
    undetermined: "breakdowns.undeterminedRoute",
  },
  cargo: {
    title: "breakdowns.cargoTitle",
    error: "breakdowns.cargoError",
    other: "breakdowns.otherCargo",
    undetermined: "breakdowns.undeterminedCargo",
  },
  source: {
    title: "breakdowns.sourceTitle",
    error: "breakdowns.sourceError",
  },
} as const;

/** "12 trips" / "12 рейсов": the exact count with the plural form of the interface language. */
function useTripsText(locale: Locale) {
  const { t } = useTranslation("dashboard");
  return (count: number) =>
    t(`breakdowns.${tripsKey(count, locale)}`, { trips: formatDecimal(String(count), locale) });
}

/**
 * A breakdown card. Data wins over a failed background refresh; a Retry without data keeps the
 * error (and focus on Retry) until a newer outcome, and success hands focus to the heading.
 */
function BreakdownCard<D extends BreakdownDimension>({
  dimension,
  query,
  children,
}: {
  dimension: D;
  query: QueryView<BreakdownData[D]>;
  children: (data: BreakdownData[D]) => ReactNode;
}) {
  const { t } = useTranslation("dashboard");
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const { retrying, error, retry } = useBlockRetry(query);
  const view = retrying && !query.data ? "error" : blockView(query, breakdownEmpty);

  let body: ReactNode;
  if (view === "ready" && query.data) body = children(query.data);
  else if (view === "empty") body = <p className="dashboard-empty">{t("breakdowns.empty")}</p>;
  else if (view === "forbidden")
    body = <p className="dashboard-muted">{t("breakdowns.forbidden")}</p>;
  else if (view === "error")
    body = (
      <div className="dashboard-block-error">
        {isRateLimited(error) ? (
          <RateLimitNotice seconds={rateLimitSeconds(error)} />
        ) : (
          <p>{t(copy[dimension].error)}</p>
        )}
        <KeepFocusButton
          variant="outline"
          focusTarget={() => heading.current?.focus()}
          onClick={retry}
        >
          {t("breakdowns.retry")}
        </KeepFocusButton>
      </div>
    );
  else
    body = (
      <div className="dashboard-skeleton-rows" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((row) => (
          <Skeleton key={row} />
        ))}
      </div>
    );

  return (
    <Card
      className={`dashboard-breakdown dashboard-breakdown-${dimension}`}
      aria-labelledby={headingId}
      aria-busy={view === "loading"}
    >
      <div className="dashboard-card-head">
        <h2 id={headingId} ref={heading} tabIndex={-1}>
          {t(copy[dimension].title)}
        </h2>
      </div>
      {body}
    </Card>
  );
}

/** Ranked routes or cargo with a single-series bar, then the remainder and unrecognized trips. */
function RankedItems({
  data,
  locale,
}: {
  data: BreakdownData["route"] | BreakdownData["cargo"];
  locale: Locale;
}) {
  const { t } = useTranslation("dashboard");
  const trips = useTripsText(locale);
  const view = breakdownRows(data);
  const labels = copy[data.dimension];
  const extra = [
    { key: "other", label: t(labels.other), count: view.remainder },
    { key: "undetermined", label: t(labels.undetermined), count: view.undetermined },
  ].filter((row): row is { key: string; label: string; count: number } => row.count !== null);

  return (
    <>
      {/* Only unrecognized trips (a total above zero without ranked items): no empty list. */}
      {view.rows.length > 0 && (
        <ol className="dashboard-breakdown-list">
          {view.rows.map((row) => (
            <li key={row.key} className="dashboard-breakdown-row">
              <div className="dashboard-breakdown-line">
                {view.chips && (
                  <Badge tone={row.game} className="dashboard-game">
                    {row.game.toUpperCase()}
                  </Badge>
                )}
                <span className="dashboard-breakdown-label">
                  {row.labels.map(({ role, label }) => (
                    <Fragment key={role}>
                      {role === "destination" && " → "}
                      {label.label}
                      <CatalogNativeName value={label} />
                    </Fragment>
                  ))}
                  {row.fallback && (
                    <small className="dashboard-fallback"> · {t("catalogs:fallback")}</small>
                  )}
                </span>
                <span className="dashboard-breakdown-count">{trips(row.acceptedTrips)}</span>
              </div>
              <span className="dashboard-breakdown-bar" aria-hidden="true">
                <span style={{ width: `${row.barPercent}%` }} />
              </span>
            </li>
          ))}
        </ol>
      )}
      {extra.length > 0 && (
        <ul className="dashboard-breakdown-extra">
          {extra.map((row) => (
            <li key={row.key} className="dashboard-breakdown-line">
              <span className="dashboard-breakdown-label">{row.label}</span>
              <span className="dashboard-breakdown-count">{trips(row.count)}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * Telemetry and manual reports as a thin segmented bar (a zero part draws nothing) with legend
 * rows that carry the name, the exact count and the share as text.
 */
function SourceSplit({ data, locale }: { data: BreakdownData["source"]; locale: Locale }) {
  const { t } = useTranslation("dashboard");
  const trips = useTripsText(locale);
  const parts = sourceShares(data);
  const name = (part: SourcePart) =>
    t(
      part.source === "ets2telemetry"
        ? "breakdowns.telemetry"
        : part.source === "manual"
          ? "breakdowns.manual"
          : "breakdowns.undeterminedSource",
    );

  return (
    <>
      <div className="dashboard-source-bar" aria-hidden="true">
        {parts
          .filter((part) => part.acceptedTrips > 0)
          .map((part) => (
            <span
              key={part.source}
              className={`dashboard-source-${part.source}`}
              style={{ flexGrow: part.acceptedTrips }}
            />
          ))}
      </div>
      <ul className="dashboard-source-legend">
        {parts.map((part) => (
          <li key={part.source} className="dashboard-breakdown-line">
            <span
              className={`dashboard-source-swatch dashboard-source-${part.source}`}
              aria-hidden="true"
            />
            <span className="dashboard-breakdown-label">{name(part)}</span>
            <span className="dashboard-breakdown-count">{trips(part.acceptedTrips)}</span>
            <span className="dashboard-source-share">{formatPercent(part.percent, locale)}</span>
          </li>
        ))}
      </ul>
      <p className="dashboard-muted">{t("breakdowns.manualNote")}</p>
    </>
  );
}

/** The full-width breakdown row of the overview: one card per dimension. */
export function TripBreakdowns({
  route,
  cargo,
  source,
  locale,
}: {
  route: QueryView<BreakdownData["route"]>;
  cargo: QueryView<BreakdownData["cargo"]>;
  source: QueryView<BreakdownData["source"]>;
  locale: Locale;
}) {
  return (
    <div className="dashboard-breakdowns">
      <BreakdownCard dimension="route" query={route}>
        {(data) => <RankedItems data={data} locale={locale} />}
      </BreakdownCard>
      <BreakdownCard dimension="cargo" query={cargo}>
        {(data) => <RankedItems data={data} locale={locale} />}
      </BreakdownCard>
      <BreakdownCard dimension="source" query={source}>
        {(data) => <SourceSplit data={data} locale={locale} />}
      </BreakdownCard>
    </div>
  );
}
