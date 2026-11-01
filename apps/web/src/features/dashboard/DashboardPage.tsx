import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "../../app/Session.js";
import type { Locale } from "../../shared/formatting.js";
import { Button, Card, Select } from "../../shared/ui/primitives.js";
import { SegmentedControl } from "../../shared/ui/segmented-control.js";
import {
  ActualDistanceChart,
  KpiStrip,
  LeaderboardWidget,
  MetricDefinitionsCard,
  MyQualificationWidget,
  ReviewerQueueWidget,
  UpcomingEventWidget,
} from "./components.js";
import { computePeriodDates, type GameFilter, type PeriodFilter, periods } from "./model.js";
import {
  useCompanyAnalytics,
  useDriverLeaderboard,
  useMyQualificationProgress,
  useReviewQueueTrips,
  useUpcomingEvent,
} from "./queries.js";
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

  const dates = computePeriodDates(period);
  const effectiveGame = game === "all" ? undefined : game;

  const analyticsQuery = useCompanyAnalytics({
    fromDate: dates.fromDate,
    toDateExclusive: dates.toDateExclusive,
    game: effectiveGame,
    granularity,
  });

  // Contract maximum: the widget shows the top ten, the KPI counts every returned driver.
  const leaderboardQuery = useDriverLeaderboard({
    fromDate: dates.fromDate,
    toDateExclusive: dates.toDateExclusive,
    game: effectiveGame,
    limit: 100,
  });

  const ets2ProgressQuery = useMyQualificationProgress("ets2");
  const atsProgressQuery = useMyQualificationProgress("ats");
  const upcomingEventQuery = useUpcomingEvent();
  const reviewTripsQuery = useReviewQueueTrips();

  const canReview = capabilities.includes("trips.review");
  const analytics = analyticsQuery.data;
  const leaderboard = leaderboardQuery.data;
  const pending = analyticsQuery.isPending || leaderboardQuery.isPending;
  // A failed background refresh keeps the last data; the alert is only for having none.
  const analyticsFailed = analyticsQuery.isError && !analytics;

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
      {/* Announced only: per-block placeholders show loading without shifting the layout. */}
      {!analyticsFailed && (
        <p className="visually-hidden" role="status">
          {pending ? t("states.loading") : ""}
        </p>
      )}
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

      {analyticsFailed ? (
        <Card className="dashboard-error" role="alert">
          <p>{t("states.error")}</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              titleRef.current?.focus();
              void analyticsQuery.refetch();
              void leaderboardQuery.refetch();
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
            analyticsPending={analyticsQuery.isPending}
            leaderboard={leaderboard}
            leaderboardPending={leaderboardQuery.isPending}
            leaderboardFailed={leaderboardQuery.isError && !leaderboard}
            locale={locale}
          />

          <div className="dashboard-grid" aria-busy={pending}>
            <ActualDistanceChart
              analytics={analytics}
              pending={analyticsQuery.isPending}
              locale={locale}
              displayTimezone={displayTimezone}
              granularity={granularity}
              onGranularityChange={setGranularity}
            />
            <MyQualificationWidget
              ets2Progress={ets2ProgressQuery}
              atsProgress={atsProgressQuery}
              available={capabilities.includes("trips.submit_own")}
            />
            <LeaderboardWidget query={leaderboardQuery} locale={locale} />
            <div className="dashboard-side">
              {canReview && <ReviewerQueueWidget query={reviewTripsQuery} locale={locale} />}
              <UpcomingEventWidget
                query={upcomingEventQuery}
                locale={locale}
                displayTimezone={displayTimezone}
              />
            </div>
          </div>

          <MetricDefinitionsCard />
        </>
      )}
    </div>
  );
}
