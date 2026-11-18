// Company overview (/account/company): the company KPIs with their previous-period comparison,
// the distance chart, the top drivers and the trip breakdowns for the selected game and period.
// The member's own blocks live on My overview (VTC-159).
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "../../app/Session.js";
import { accountTimeZone, type Locale } from "../../shared/formatting.js";
import { isRateLimited, rateLimitSeconds } from "../../shared/rate-limit.js";
import { Button, Card, Select } from "../../shared/ui/primitives.js";
import { RateLimitNotice } from "../../shared/ui/rate-limit-notice.js";
import { SegmentedControl } from "../../shared/ui/segmented-control.js";
import { TripBreakdowns } from "./breakdowns.js";
import {
  ActualDistanceChart,
  KpiStrip,
  LeaderboardWidget,
  MetricDefinitionsCard,
} from "./components.js";
import {
  effectiveGranularity,
  type GameFilter,
  type OverviewPeriod,
  overviewPeriods,
  PERIOD_FALLBACK_TIMEZONE,
  periodQuery,
  periodTimeZone,
  previousPeriodQuery,
} from "./model.js";
import {
  useCompanyAnalytics,
  useCompanyBreakdown,
  useDriverLeaderboard,
  useReportingTimezoneSource,
} from "./queries.js";
import { companyDeltas, previousPeriod, untilAnchored } from "./view-model.js";
import "./dashboard.css";

export function CompanyOverview() {
  const { t, i18n } = useTranslation("dashboard");
  const locale = (i18n.resolvedLanguage === "en" ? "en" : "ru") as Locale;
  const session = useSession();
  const displayTimezone = accountTimeZone(session.self?.preferences.displayTimezone);
  const titleRef = useRef<HTMLHeadingElement>(null);

  const periodId = useId();
  const [game, setGame] = useState<GameFilter>("all");
  const [period, setPeriod] = useState<OverviewPeriod>("thisMonth");
  const [granularity, setGranularity] = useState<"day" | "month">("day");
  const allTime = period === "allTime";

  // Overview reads wait for the reporting timezone, so the first period request already has its
  // dates and, on a cold load, analytics and the leaderboard enter the read queue first. A failed
  // read that is being retried still waits, so no request uses the fallback dates first.
  const timezoneQuery = useReportingTimezoneSource();
  const reportingTimezone = periodTimeZone(
    timezoneQuery.data,
    timezoneQuery.isError && !timezoneQuery.isFetching,
  );
  const anchored = reportingTimezone !== undefined;
  // All time sends no dates, but its reads still wait for the zone, like every overview read.
  const now = new Date();
  const zone = reportingTimezone ?? PERIOD_FALLBACK_TIMEZONE;
  const query = periodQuery(period, now, zone);
  // The previous period of the same length; none for all time.
  const previousRange = previousPeriodQuery(period, now, zone);
  const effectiveGame = game === "all" ? undefined : game;

  const analyticsQuery = useCompanyAnalytics({
    query,
    game: effectiveGame,
    granularity: effectiveGranularity(period, granularity),
    enabled: anchored,
  });

  // The top five; the viewer's own place comes with the page, active drivers from analytics.
  const leaderboardQuery = useDriverLeaderboard({ query, game: effectiveGame, enabled: anchored });

  // The comparison totals: daily buckets whatever the Interval, so the key never follows it.
  const previousQuery = useCompanyAnalytics({
    query: previousRange ?? query,
    game: effectiveGame,
    granularity: "day",
    enabled: anchored && previousRange !== null,
  });

  // Last in hook order, so on a cold load the breakdowns enter the read queue after the KPIs.
  const breakdownParams = { query, game: effectiveGame, enabled: anchored };
  const routeQuery = useCompanyBreakdown("route", breakdownParams);
  const cargoQuery = useCompanyBreakdown("cargo", breakdownParams);
  const sourceQuery = useCompanyBreakdown("source", breakdownParams);

  /**
   * Retry rereads a pending, failed or zone-less stats read first (reusing a read in flight). A new
   * zone changes the dated period keys and those queries fetch on their own; refetching the current
   * ones would repeat the old dates. All time has no dates, so its keys stay and are refetched.
   * Refetch ignores `enabled`, so it never runs on a pending zone.
   */
  const retryPeriodData = async () => {
    if (
      !anchored ||
      timezoneQuery.isError ||
      timezoneQuery.data?.currentMonth.status === "unavailable"
    ) {
      const result = await timezoneQuery.refetch({ cancelRefetch: false });
      // The page may have gone (navigation, revoked access): no private reads for it.
      if (!titleRef.current) return;
      if (!allTime && periodTimeZone(result.data, result.isError) !== reportingTimezone) return;
    }
    const reads = [analyticsQuery, leaderboardQuery, routeQuery, cargoQuery, sourceQuery];
    for (const read of previousRange ? [...reads, previousQuery] : reads)
      void read.refetch({ cancelRefetch: false });
  };

  // Until the zone is known the page waits: the fallback keys' cached data or errors never show.
  const analytics = anchored ? analyticsQuery.data : undefined;
  const leaderboard = anchored ? leaderboardQuery.data : undefined;
  const analyticsPending = !anchored || analyticsQuery.isPending;
  const leaderboardPending = !anchored || leaderboardQuery.isPending;
  const pending = analyticsPending || leaderboardPending;
  // A failed background refresh keeps the last data; the alert is only for having none.
  const analyticsFailed = anchored && analyticsQuery.isError && !analytics;
  const analyticsLimited = analyticsFailed && isRateLimited(analyticsQuery.error);
  const previous = previousPeriod(
    previousRange,
    anchored ? previousQuery : { data: undefined, isError: false },
  );
  const deltas = analytics ? companyDeltas(analytics, previous) : undefined;

  const self = session.self?.member;

  // Zero only counts as an empty company when both sources actually answered.
  const isCompanyEmpty =
    analytics !== undefined &&
    analytics.acceptedTrips === 0 &&
    leaderboard !== undefined &&
    leaderboard.items.length === 0;

  return (
    <div className="dashboard-page dashboard-company">
      <header className="dashboard-header">
        <div className="dashboard-title">
          {/* Focus target after Retry replaces the alert, so focus never falls to the body. */}
          <h1 ref={titleRef} tabIndex={-1}>
            {t("title")}
          </h1>
          <p className="dashboard-subtitle">{t("subtitle")}</p>
          {/* Announced only: per-block placeholders show loading without shifting the layout.
              Always mounted so screen readers announce text changes, including after Retry. */}
          <p className="visually-hidden" role="status">
            {pending && !analyticsFailed ? t("states.loading") : ""}
          </p>
        </div>
        <div className="dashboard-filters">
          <div className="dashboard-period">
            <label htmlFor={periodId}>{t("filters.period")}</label>
            <Select
              id={periodId}
              value={period}
              onChange={(event) => {
                const next = overviewPeriods.find((item) => item === event.target.value);
                if (next) setPeriod(next);
              }}
            >
              {overviewPeriods.map((item) => (
                <option key={item} value={item}>
                  {t(`filters.${item}`)}
                </option>
              ))}
            </Select>
          </div>
          <SegmentedControl
            aria-label={t("filters.game")}
            value={game}
            onValueChange={setGame}
            options={[
              { value: "all", label: t("filters.allGames") },
              { value: "ets2", label: "ETS2" },
              { value: "ats", label: "ATS" },
            ]}
          />
        </div>
      </header>

      {analyticsFailed ? (
        // A read still rate limited explains the wait in a status notice, never inside an alert.
        <Card className="dashboard-error" role={analyticsLimited ? undefined : "alert"}>
          {analyticsLimited ? (
            <RateLimitNotice seconds={rateLimitSeconds(analyticsQuery.error)} />
          ) : (
            <p>{t("states.error")}</p>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              titleRef.current?.focus();
              void retryPeriodData();
            }}
          >
            {t("states.retry")}
          </Button>
        </Card>
      ) : (
        <>
          {isCompanyEmpty && (
            <div className="dashboard-notice">
              <p className="dashboard-notice-title">{t("emptyState.newCompanyTitle")}</p>
              <p>{t("emptyState.newCompanyDesc")}</p>
            </div>
          )}

          <KpiStrip
            analytics={analytics}
            analyticsPending={analyticsPending}
            deltas={deltas}
            previousRange={previousRange}
            locale={locale}
          />

          <div className="dashboard-company-split">
            <ActualDistanceChart
              analytics={analytics}
              pending={analyticsPending}
              locale={locale}
              displayTimezone={displayTimezone}
              granularity={granularity}
              onGranularityChange={setGranularity}
              showGranularity={!allTime}
            />
            <LeaderboardWidget
              query={untilAnchored(leaderboardQuery, anchored)}
              locale={locale}
              self={self ? { id: self.id, nickname: self.nickname } : undefined}
            />
          </div>

          <TripBreakdowns
            route={untilAnchored(routeQuery, anchored)}
            cargo={untilAnchored(cargoQuery, anchored)}
            source={untilAnchored(sourceQuery, anchored)}
            locale={locale}
          />

          <MetricDefinitionsCard />
        </>
      )}
    </div>
  );
}
