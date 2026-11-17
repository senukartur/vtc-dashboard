// My overview (VTC-159, /account/dashboard): the signed-in member's own work and progress. The
// company statistics live on the company overview; this page reads the own analytics, the own
// place, qualification, the nearest event and the own latest trips.
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "../../app/Session.js";
import { accountTimeZone, type Locale } from "../../shared/formatting.js";
import { isRateLimited, rateLimitSeconds } from "../../shared/rate-limit.js";
import { RateLimitNotice } from "../../shared/ui/rate-limit-notice.js";
import { SegmentedControl } from "../../shared/ui/segmented-control.js";
import { KeepFocusButton } from "../events/components.js";
import { useUpcomingEventCard } from "../events/event-list-queries.js";
import { RecentTripsWidget, UpcomingEventWidget, useBlockRetry } from "./blocks.js";
import { ActualDistanceChart, MyQualificationWidget } from "./components.js";
import {
  calendarToday,
  computePeriodDates,
  type GameFilter,
  monthName,
  monthYearLabel,
  PERIOD_FALLBACK_TIMEZONE,
  periodTimeZone,
  previousPeriodQuery,
} from "./model.js";
import { CompanyLinkCard, MyMonthCard, StartStepsCard } from "./personal.js";
import {
  useDriverLeaderboard,
  useMemberPeriodAnalytics,
  useMyQualificationProgress,
  useMyRecentTrips,
  useReportingTimezoneSource,
  useTripStatusSummary,
  useUpcomingEvent,
} from "./queries.js";
import { Stage2UpcomingEventWidget } from "./Stage2UpcomingEventWidget.js";
import { personalDistanceDelta, placeView, previousPeriod, untilAnchored } from "./view-model.js";
import { WorkspaceActions } from "./WorkspaceActions.js";
import "./dashboard.css";

/** A member without any own trip yet: every count of an unfiltered summary is zero. */
function hasNoTrips(summary: {
  counts: { unassessed: number; pendingReview: number; accepted: number; rejected: number };
  activeTrips: number;
}) {
  const { unassessed, pendingReview, accepted, rejected } = summary.counts;
  return unassessed + pendingReview + accepted + rejected + summary.activeTrips === 0;
}

export function PersonalOverview() {
  const { t, i18n } = useTranslation("dashboard");
  const locale = (i18n.resolvedLanguage === "en" ? "en" : "ru") as Locale;
  const session = useSession();
  const displayTimezone = accountTimeZone(session.self?.preferences.displayTimezone);
  const capabilities = session.self?.capabilities ?? [];
  const self = session.self?.member;
  const titleRef = useRef<HTMLHeadingElement>(null);
  const chartHeading = useRef<HTMLHeadingElement>(null);
  const [game, setGame] = useState<GameFilter>("all");
  const effectiveGame = game === "all" ? undefined : game;
  const canSubmit = capabilities.includes("trips.submit_own");

  // Like the company overview, every read waits for the reporting timezone, so the first request
  // already has the month's dates and the period reads enter the read queue first.
  const timezoneQuery = useReportingTimezoneSource();
  const reportingTimezone = periodTimeZone(
    timezoneQuery.data,
    timezoneQuery.isError && !timezoneQuery.isFetching,
  );
  const anchored = reportingTimezone !== undefined;
  const now = new Date();
  const zone = reportingTimezone ?? PERIOD_FALLBACK_TIMEZONE;
  const today = calendarToday(now, zone);
  // This month and the same elapsed days of the previous month, always in days.
  const thisMonth = computePeriodDates("thisMonth", now, zone);
  const previousRange = previousPeriodQuery("thisMonth", now, zone);

  const analyticsQuery = useMemberPeriodAnalytics({
    memberId: self?.id,
    query: thisMonth,
    game: effectiveGame,
    granularity: "day",
    enabled: anchored,
  });
  const previousQuery = useMemberPeriodAnalytics({
    memberId: self?.id,
    query: previousRange,
    game: effectiveGame,
    granularity: "day",
    enabled: anchored,
  });
  // The place among ranked members this month; the company overview shares this key.
  const leaderboardQuery = useDriverLeaderboard({
    query: thisMonth,
    game: effectiveGame,
    enabled: anchored,
  });
  const ets2ProgressQuery = useMyQualificationProgress("ets2", { enabled: anchored });
  const atsProgressQuery = useMyQualificationProgress("ats", { enabled: anchored });
  const stage2 = session.eventsStage2Enabled;
  const upcomingEventQuery = useUpcomingEvent({ enabled: anchored && !stage2 });
  const stage2UpcomingQuery = useUpcomingEventCard(anchored && stage2);
  // Unfiltered, so the start steps never depend on the game filter (the hook reads it only for
  // members who submit trips).
  const statusQuery = useTripStatusSummary(undefined, { enabled: anchored });
  const recentTripsQuery = useMyRecentTrips(effectiveGame, { enabled: anchored });

  /**
   * The month reads' Retry first rereads a pending, failed or unavailable timezone (reusing a read
   * in flight). A new zone changes the dated keys, which then fetch on their own.
   */
  const retryMonth = async () => {
    if (
      !anchored ||
      timezoneQuery.isError ||
      timezoneQuery.data?.currentMonth.status === "unavailable"
    ) {
      const result = await timezoneQuery.refetch({ cancelRefetch: false });
      if (!titleRef.current) return;
      if (periodTimeZone(result.data, result.isError) !== reportingTimezone) return;
    }
    for (const read of [analyticsQuery, previousQuery]) void read.refetch({ cancelRefetch: false });
  };

  const analytics = untilAnchored(analyticsQuery, anchored);
  const previous = previousPeriod(
    previousRange,
    anchored ? previousQuery : { data: undefined, isError: false },
  );
  const leaderboard = anchored ? leaderboardQuery.data : undefined;
  const place = placeView(leaderboard, anchored && leaderboardQuery.isError && !leaderboard);
  const delta = analytics.data ? personalDistanceDelta(analytics.data, previous) : "pending";
  const status = anchored ? statusQuery.data : undefined;
  const showStart = canSubmit && status !== undefined && hasNoTrips(status);
  const monthLabel = anchored ? monthName(today.year, today.month, locale) : undefined;
  const pending = !anchored || analyticsQuery.isPending;
  const chartRetry = useBlockRetry({ ...analytics, refetch: async () => retryMonth() });
  const chartFailed = !analytics.data && (analytics.isError || chartRetry.retrying);
  const games = effectiveGame ? [effectiveGame] : (["ets2", "ats"] as const);

  return (
    <div className="dashboard-page dashboard-personal">
      <header className="dashboard-header">
        <div className="dashboard-title">
          <h1 ref={titleRef} tabIndex={-1}>
            {t("personal.title")}
          </h1>
          <p className="dashboard-subtitle">
            {anchored
              ? t("personal.subtitle", {
                  month: monthYearLabel(today.year, today.month, locale),
                })
              : ""}
          </p>
          <p className="visually-hidden" role="status">
            {pending && !analytics.isError ? t("states.loading") : ""}
          </p>
        </div>
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
        </div>
      </header>

      <WorkspaceActions locale={locale} timezone={displayTimezone} />

      {showStart ? (
        <StartStepsCard />
      ) : (
        <div className="dashboard-personal-row">
          <MyMonthCard
            query={analytics}
            delta={delta}
            previousRange={previousRange}
            place={place}
            month={monthLabel}
            locale={locale}
            onRetry={() => void retryMonth()}
          />
          <MyQualificationWidget
            ets2Progress={untilAnchored(ets2ProgressQuery, anchored)}
            atsProgress={untilAnchored(atsProgressQuery, anchored)}
            available={canSubmit}
            games={games}
          />
          {stage2 ? (
            <Stage2UpcomingEventWidget
              query={untilAnchored(stage2UpcomingQuery, anchored)}
              locale={locale}
              displayTimezone={displayTimezone}
              canRespond={capabilities.includes("events.respond")}
              started={stage2UpcomingQuery.started}
            />
          ) : (
            <UpcomingEventWidget
              query={untilAnchored(upcomingEventQuery, anchored)}
              locale={locale}
              displayTimezone={displayTimezone}
              canRespond={capabilities.includes("events.respond")}
            />
          )}
        </div>
      )}

      <CompanyLinkCard />

      {!showStart && (
        <div className="dashboard-personal-split">
          <ActualDistanceChart
            analytics={analytics.data}
            pending={pending}
            locale={locale}
            displayTimezone={displayTimezone}
            title={t("personal.chartTitle")}
            headingRef={chartHeading}
            failure={
              chartFailed ? (
                <div className="dashboard-block-error">
                  {isRateLimited(chartRetry.error) ? (
                    <RateLimitNotice seconds={rateLimitSeconds(chartRetry.error)} />
                  ) : (
                    <p>{t("personal.monthError")}</p>
                  )}
                  <KeepFocusButton
                    variant="outline"
                    onClick={chartRetry.retry}
                    focusTarget={() => chartHeading.current?.focus()}
                  >
                    {t("personal.retry")}
                  </KeepFocusButton>
                </div>
              ) : undefined
            }
          />
          <RecentTripsWidget
            query={untilAnchored(recentTripsQuery, anchored)}
            locale={locale}
            displayTimezone={displayTimezone}
          />
        </div>
      )}
    </div>
  );
}
