import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "../../app/Session.js";
import { formatDecimal, formatQuantity, type Locale } from "../../shared/formatting.js";
import { Button, Card } from "../../shared/ui/primitives.js";
import {
  ActualDistanceChart,
  LeaderboardWidget,
  MetricCard,
  MetricDefinitionsCard,
  MyQualificationWidget,
  ReviewerQueueWidget,
  UpcomingEventWidget,
} from "./components.js";
import {
  useCompanyAnalytics,
  useDriverLeaderboard,
  useMyQualificationProgress,
  useReviewQueueTrips,
  useTripStatusSummary,
  useUpcomingEvent,
} from "./queries.js";

type GameFilter = "all" | "ets2" | "ats";
type PeriodFilter = "thisMonth" | "lastMonth" | "last30Days" | "last7Days";

function computePeriodDates(
  period: PeriodFilter,
  now = new Date(),
): { fromDate: string; toDateExclusive: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const formatDate = (d: Date) =>
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth();

  if (period === "thisMonth") {
    const from = new Date(Date.UTC(currentYear, currentMonth, 1));
    const to = new Date(Date.UTC(currentYear, currentMonth + 1, 1));
    return { fromDate: formatDate(from), toDateExclusive: formatDate(to) };
  }
  if (period === "lastMonth") {
    const from = new Date(Date.UTC(currentYear, currentMonth - 1, 1));
    const to = new Date(Date.UTC(currentYear, currentMonth, 1));
    return { fromDate: formatDate(from), toDateExclusive: formatDate(to) };
  }
  if (period === "last7Days") {
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    const from = new Date(to.getTime() - 7 * 86400000);
    return { fromDate: formatDate(from), toDateExclusive: formatDate(to) };
  }
  // last30Days
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const from = new Date(to.getTime() - 30 * 86400000);
  return { fromDate: formatDate(from), toDateExclusive: formatDate(to) };
}

export function DashboardPage() {
  const { t, i18n } = useTranslation("dashboard");
  const locale = (i18n.resolvedLanguage === "en" ? "en" : "ru") as Locale;
  const session = useSession();
  const displayTimezone = session.self?.preferences.displayTimezone ?? "UTC";

  const [game, setGame] = useState<GameFilter>("all");
  const [period, setPeriod] = useState<PeriodFilter>("thisMonth");
  const [granularity, setGranularity] = useState<"day" | "month">("day");

  const dates = useMemo(() => computePeriodDates(period), [period]);

  const effectiveGame = game === "all" ? undefined : game;

  const analyticsQuery = useCompanyAnalytics({
    fromDate: dates.fromDate,
    toDateExclusive: dates.toDateExclusive,
    game: effectiveGame,
    granularity,
  });

  const leaderboardQuery = useDriverLeaderboard({
    fromDate: dates.fromDate,
    toDateExclusive: dates.toDateExclusive,
    game: effectiveGame,
    limit: 10,
  });

  const ets2ProgressQuery = useMyQualificationProgress("ets2");
  const atsProgressQuery = useMyQualificationProgress("ats");
  const upcomingEventQuery = useUpcomingEvent();
  const reviewTripsQuery = useReviewQueueTrips();

  const canReview = !!session.self?.capabilities.includes("trips.review");

  const isLoading = analyticsQuery.isLoading || leaderboardQuery.isLoading;
  const isError = analyticsQuery.isError;

  const analytics = analyticsQuery.data;
  const leaderboard = leaderboardQuery.data;

  // New company starting at zero check
  const isCompanyEmpty =
    analytics !== undefined &&
    analytics.acceptedTrips === 0 &&
    (leaderboard?.items.length ?? 0) === 0;

  return (
    <div className="dashboard-page stack space-y-6">
      <header className="page-heading">
        <span className="eyebrow">{session.self?.member.nickname}</span>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="lead muted">{t("subtitle")}</p>
      </header>

      {/* Filters Bar */}
      <Card className="filters-card p-4">
        <div className="flex flex-wrap gap-4 items-center justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium mr-1">{t("filters.game")}:</span>
            <fieldset className="button-group" aria-label={t("filters.game")}>
              <Button
                type="button"
                variant={game === "all" ? "default" : "outline"}
                onClick={() => setGame("all")}
                aria-pressed={game === "all"}
              >
                {t("filters.allGames")}
              </Button>
              <Button
                type="button"
                variant={game === "ets2" ? "default" : "outline"}
                onClick={() => setGame("ets2")}
                aria-pressed={game === "ets2"}
              >
                ETS2
              </Button>
              <Button
                type="button"
                variant={game === "ats" ? "default" : "outline"}
                onClick={() => setGame("ats")}
                aria-pressed={game === "ats"}
              >
                ATS
              </Button>
            </fieldset>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium mr-1">{t("filters.period")}:</span>
            <fieldset className="button-group" aria-label={t("filters.period")}>
              <Button
                type="button"
                variant={period === "thisMonth" ? "default" : "outline"}
                onClick={() => setPeriod("thisMonth")}
                aria-pressed={period === "thisMonth"}
              >
                {t("filters.thisMonth")}
              </Button>
              <Button
                type="button"
                variant={period === "lastMonth" ? "default" : "outline"}
                onClick={() => setPeriod("lastMonth")}
                aria-pressed={period === "lastMonth"}
              >
                {t("filters.lastMonth")}
              </Button>
              <Button
                type="button"
                variant={period === "last30Days" ? "default" : "outline"}
                onClick={() => setPeriod("last30Days")}
                aria-pressed={period === "last30Days"}
              >
                {t("filters.last30Days")}
              </Button>
              <Button
                type="button"
                variant={period === "last7Days" ? "default" : "outline"}
                onClick={() => setPeriod("last7Days")}
                aria-pressed={period === "last7Days"}
              >
                {t("filters.last7Days")}
              </Button>
            </fieldset>
          </div>
        </div>
      </Card>

      {/* Error state */}
      {isError && (
        <Card className="error-card p-6 text-center">
          <p className="text-red-400 font-medium mb-3">{t("states.error")}</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void analyticsQuery.refetch();
              void leaderboardQuery.refetch();
            }}
          >
            {t("states.retry")}
          </Button>
        </Card>
      )}

      {/* Loading state */}
      {isLoading && !isError && (
        <Card className="loading-card p-8 text-center" role="status" aria-busy="true">
          <p className="muted">{t("states.loading")}</p>
        </Card>
      )}

      {/* Main dashboard content */}
      {!isLoading && !isError && analytics && (
        <>
          {/* Empty company state notification if zero metrics */}
          {isCompanyEmpty && (
            <Card className="empty-company-card p-4 border-blue-900 bg-blue-950/40">
              <h3 className="font-semibold text-blue-200">{t("emptyState.newCompanyTitle")}</h3>
              <p className="text-sm text-blue-300 mt-1">{t("emptyState.newCompanyDesc")}</p>
            </Card>
          )}

          {/* Metric KPI cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <MetricCard
              title={t("metrics.totalDistance")}
              value={formatQuantity(analytics.actualDistanceM, "km", locale)}
              help={t("metrics.distanceHelp")}
            />
            <MetricCard
              title={t("metrics.acceptedTrips")}
              value={formatDecimal(String(analytics.acceptedTrips), locale)}
              help={t("metrics.tripsHelp")}
            />
            <MetricCard
              title={t("metrics.activeDrivers")}
              value={formatDecimal(String(leaderboard?.items.length ?? 0), locale)}
              help={t("metrics.driversHelp")}
            />
          </div>

          {/* Actual Distance Chart */}
          <ActualDistanceChart
            analytics={analytics}
            locale={locale}
            displayTimezone={displayTimezone}
            granularity={granularity}
            onGranularityChange={setGranularity}
          />

          {/* Widgets Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <LeaderboardWidget leaderboard={leaderboard} locale={locale} />
            </div>

            <div className="space-y-6">
              <MyQualificationWidget
                ets2Progress={ets2ProgressQuery.data}
                atsProgress={atsProgressQuery.data}
              />

              {canReview && <ReviewerQueueWidget reviewTrips={reviewTripsQuery.data} />}

              <UpcomingEventWidget
                eventData={upcomingEventQuery.data}
                locale={locale}
                displayTimezone={displayTimezone}
              />
            </div>
          </div>

          {/* Informational definitions section */}
          <MetricDefinitionsCard />
        </>
      )}
    </div>
  );
}
