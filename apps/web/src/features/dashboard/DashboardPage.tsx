import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "../../app/Session.js";
import type { Locale } from "../../shared/formatting.js";
import { Button, Card, Select } from "../../shared/ui/primitives.js";
import { SegmentedControl } from "../../shared/ui/segmented-control.js";
import { RecentTripsWidget, UpcomingEventWidget } from "./blocks.js";
import {
  ActualDistanceChart,
  KpiStrip,
  LeaderboardWidget,
  MetricDefinitionsCard,
  MyQualificationWidget,
  ReviewerQueueWidget,
} from "./components.js";
import {
  computePeriodDates,
  type GameFilter,
  PERIOD_FALLBACK_TIMEZONE,
  type PeriodFilter,
  periods,
  periodTimeZone,
} from "./model.js";
import {
  useCompanyAnalytics,
  useDriverLeaderboard,
  useMyQualificationProgress,
  useRecentCompanyTrips,
  useReportingTimezoneSource,
  useReviewQueueTrips,
  useUpcomingEvent,
} from "./queries.js";
import { untilAnchored } from "./view-model.js";
import { WorkspaceActions } from "./WorkspaceActions.js";
import "./dashboard.css";

/** Gate: without company.read no dashboard query hook mounts, so nothing is requested. */
export function DashboardPage() {
  const { t } = useTranslation("dashboard");
  const session = useSession();
  if (!session.self?.capabilities.includes("company.read"))
    return (
      <div className="dashboard-page">
        <header className="dashboard-header">
          <div className="dashboard-title">
            <h1>{t("title")}</h1>
            <p className="dashboard-subtitle">{t("subtitle")}</p>
          </div>
        </header>
        <Card className="dashboard-forbidden">
          <p>{t("states.forbidden")}</p>
        </Card>
      </div>
    );
  return <DashboardContent />;
}

function DashboardContent() {
  const { t, i18n } = useTranslation("dashboard");
  const locale = (i18n.resolvedLanguage === "en" ? "en" : "ru") as Locale;
  const session = useSession();
  const displayTimezone = session.self?.preferences.displayTimezone ?? "UTC";
  const capabilities = session.self?.capabilities ?? [];
  const titleRef = useRef<HTMLHeadingElement>(null);

  const periodId = useId();
  const [game, setGame] = useState<GameFilter>("all");
  const [period, setPeriod] = useState<PeriodFilter>("thisMonth");
  const [granularity, setGranularity] = useState<"day" | "month">("day");

  // Overview reads wait for the reporting timezone, so the first period request already has its
  // dates and, on a cold load, analytics and the leaderboard enter the read queue first. A failed
  // read that is being retried still waits, so no request uses the fallback dates first.
  const timezoneQuery = useReportingTimezoneSource();
  const reportingTimezone = periodTimeZone(
    timezoneQuery.data,
    timezoneQuery.isError && !timezoneQuery.isFetching,
  );
  const anchored = reportingTimezone !== undefined;
  const dates = computePeriodDates(
    period,
    new Date(),
    reportingTimezone ?? PERIOD_FALLBACK_TIMEZONE,
  );
  const effectiveGame = game === "all" ? undefined : game;

  const analyticsQuery = useCompanyAnalytics({
    fromDate: dates.fromDate,
    toDateExclusive: dates.toDateExclusive,
    game: effectiveGame,
    granularity,
    enabled: anchored,
  });

  // Contract maximum: the widget shows the top ten, the KPI counts every returned driver.
  const leaderboardQuery = useDriverLeaderboard({
    fromDate: dates.fromDate,
    toDateExclusive: dates.toDateExclusive,
    game: effectiveGame,
    limit: 100,
    enabled: anchored,
  });

  // Enabled in the same render as the period reads and after them in hook order. The shell chip
  // keeps its own enabled observer of the nearest event.
  const ets2ProgressQuery = useMyQualificationProgress("ets2", { enabled: anchored });
  const atsProgressQuery = useMyQualificationProgress("ats", { enabled: anchored });
  const upcomingEventQuery = useUpcomingEvent({ enabled: anchored });
  const reviewTripsQuery = useReviewQueueTrips({ enabled: anchored });
  // Follows the game filter only: the trips list has no date filter for the period.
  const recentTripsQuery = useRecentCompanyTrips(effectiveGame, { enabled: anchored });

  /**
   * Retry rereads a pending, failed or zone-less stats read first (reusing a read in flight). A new
   * zone changes the period keys and those queries fetch on their own; refetching the current ones
   * would repeat the old dates. Refetch ignores `enabled`, so it never runs on a pending zone.
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
      if (periodTimeZone(result.data, result.isError) !== reportingTimezone) return;
    }
    void analyticsQuery.refetch({ cancelRefetch: false });
    void leaderboardQuery.refetch({ cancelRefetch: false });
  };

  const canReview = capabilities.includes("trips.review");
  // Until the zone is known the page waits: the fallback keys' cached data or errors never show.
  const analytics = anchored ? analyticsQuery.data : undefined;
  const leaderboard = anchored ? leaderboardQuery.data : undefined;
  const analyticsPending = !anchored || analyticsQuery.isPending;
  const leaderboardPending = !anchored || leaderboardQuery.isPending;
  const pending = analyticsPending || leaderboardPending;
  // A failed background refresh keeps the last data; the alert is only for having none.
  const analyticsFailed = anchored && analyticsQuery.isError && !analytics;

  // Zero only counts as an empty company when both sources actually answered.
  const isCompanyEmpty =
    analytics !== undefined &&
    analytics.acceptedTrips === 0 &&
    leaderboard !== undefined &&
    leaderboard.items.length === 0;

  const heading = (
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
  );

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        {heading}
        <div className="dashboard-filters">
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
          <div className="dashboard-period">
            <label htmlFor={periodId}>{t("filters.period")}</label>
            <Select
              id={periodId}
              value={period}
              onChange={(event) => {
                const next = periods.find((item) => item === event.target.value);
                if (next) setPeriod(next);
              }}
            >
              {periods.map((item) => (
                <option key={item} value={item}>
                  {t(`filters.${item}`)}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </header>

      {!analyticsFailed && (
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
            leaderboard={leaderboard}
            leaderboardPending={leaderboardPending}
            leaderboardFailed={anchored && leaderboardQuery.isError && !leaderboard}
            locale={locale}
          />
        </>
      )}

      <div className="dashboard-grid">
        {analyticsFailed ? (
          <Card className="dashboard-error" role="alert">
            <p>{t("states.error")}</p>
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
            <ActualDistanceChart
              analytics={analytics}
              pending={analyticsPending}
              locale={locale}
              displayTimezone={displayTimezone}
              granularity={granularity}
              onGranularityChange={setGranularity}
            />
            <MyQualificationWidget
              ets2Progress={untilAnchored(ets2ProgressQuery, anchored)}
              atsProgress={untilAnchored(atsProgressQuery, anchored)}
              available={capabilities.includes("trips.submit_own")}
            />
            <LeaderboardWidget query={untilAnchored(leaderboardQuery, anchored)} locale={locale} />
          </>
        )}
        <div className="dashboard-side">
          <WorkspaceActions locale={locale} timezone={displayTimezone} />
          {!analyticsFailed && (
            <>
              {canReview && (
                <ReviewerQueueWidget
                  query={untilAnchored(reviewTripsQuery, anchored)}
                  locale={locale}
                />
              )}
              <UpcomingEventWidget
                query={untilAnchored(upcomingEventQuery, anchored)}
                locale={locale}
                displayTimezone={displayTimezone}
                canRespond={capabilities.includes("events.respond")}
              />
            </>
          )}
        </div>
        {!analyticsFailed && (
          <RecentTripsWidget
            query={untilAnchored(recentTripsQuery, anchored)}
            locale={locale}
            displayTimezone={displayTimezone}
          />
        )}
      </div>

      {!analyticsFailed && <MetricDefinitionsCard />}
    </div>
  );
}
