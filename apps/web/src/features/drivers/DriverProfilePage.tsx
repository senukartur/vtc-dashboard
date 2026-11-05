import { type ReactNode, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import type { Locale } from "../../shared/formatting.js";
import { Button, Card } from "../../shared/ui/primitives.js";
import { PERIOD_FALLBACK_TIMEZONE, periodTimeZone } from "../dashboard/model.js";
import { useReportingTimezoneSource } from "../dashboard/queries.js";
import { untilAnchored } from "../dashboard/view-model.js";
import { useQualificationQuery } from "../qualifications/queries.js";
import {
  DistanceByMonth,
  DriverKpis,
  DriverTrips,
  type LevelsState,
  ProfileHeader,
  QualificationCard,
  Skeleton,
} from "./components.js";
import { assignmentFor, failureView, GAMES, type GameFilter, twelveMonthWindow } from "./model.js";
import {
  useMemberAcceptedTrips,
  useMemberAnalytics,
  useMemberProfile,
  useMemberProgress,
} from "./queries.js";
import "./drivers.css";

/** Gate: without company.read no profile query hook mounts, so nothing is requested. */
export function DriverProfilePage() {
  const { memberId = "" } = useParams<{ memberId: string }>();
  const { t } = useTranslation("drivers");
  const session = useSession();
  if (!session.self?.capabilities.includes("company.read"))
    return (
      <div className="driver-profile-page">
        <header className="driver-header">
          <div className="driver-identity">
            <div className="driver-title-row">
              <h1>{t("profile.title")}</h1>
            </div>
          </div>
        </header>
        <Card className="driver-notice">
          <p>{t("states.forbidden")}</p>
        </Card>
      </div>
    );
  // A new member resets the local game filter.
  return <DriverProfileContent key={memberId} memberId={memberId} />;
}

function DriverProfileContent({ memberId }: { memberId: string }) {
  const { t, i18n } = useTranslation("drivers");
  const locale = (i18n.resolvedLanguage === "en" ? "en" : "ru") as Locale;
  const session = useSession();
  const isSelf = session.self?.member.id === memberId;
  const displayTimezone = session.self?.preferences.displayTimezone ?? "UTC";
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [game, setGame] = useState<GameFilter>("all");
  // Fixed for the page lifetime so a midnight rollover never silently changes the window.
  const [now] = useState(() => new Date());
  const effectiveGame = game === "all" ? undefined : game;

  // The 12-month window starts from today's month in the reporting timezone (shared overview
  // read), so analytics waits for it and its first request already has the right dates. A failed
  // read that is being retried still waits. Called first so, on a cold load, the stats read
  // enters the read queue alongside the profile read.
  const timezoneQuery = useReportingTimezoneSource();
  const reportingTimezone = periodTimeZone(
    timezoneQuery.data,
    timezoneQuery.isError && !timezoneQuery.isFetching,
  );
  const anchored = reportingTimezone !== undefined;
  const period = twelveMonthWindow(now, reportingTimezone ?? PERIOD_FALLBACK_TIMEZONE);

  // The other reads have no date window, so they do not wait: the profile read renders the
  // header, layout and not-found/forbidden/error states as soon as possible.
  const profileQuery = useMemberProfile(memberId);
  const profile = profileQuery.data;
  const assignments = {
    ets2: profile ? assignmentFor(profile, "ets2") : null,
    ats: profile ? assignmentFor(profile, "ats") : null,
  };
  const analyticsQuery = useMemberAnalytics(memberId, {
    ...period,
    game: effectiveGame,
    enabled: anchored,
  });
  // Until the zone is known the KPIs and chart show loading, never cached data or errors of a
  // fallback-dates key from an earlier visit.
  const analyticsView = untilAnchored(analyticsQuery, anchored);
  const tripsQuery = useMemberAcceptedTrips(memberId, { isSelf, game: effectiveGame });
  const progress = {
    ets2: useMemberProgress(memberId, "ets2", !!assignments.ets2),
    ats: useMemberProgress(memberId, "ats", !!assignments.ats),
  };
  // Same request and cache key as the overview; only games with an assignment ask for names.
  const ets2Levels = useQualificationQuery(
    "/qualification-levels?game=ets2&limit=25",
    "EnvelopeListQualificationLevel",
    !!assignments.ets2,
  );
  const atsLevels = useQualificationQuery(
    "/qualification-levels?game=ats&limit=25",
    "EnvelopeListQualificationLevel",
    !!assignments.ats,
  );
  const levels: Record<"ets2" | "ats", LevelsState> = {
    ets2: { levels: ets2Levels.data?.data.data.items, pending: ets2Levels.isPending },
    ats: { levels: atsLevels.data?.data.data.items, pending: atsLevels.isPending },
  };

  /**
   * Retry rereads a pending, failed or zone-less stats read first (reusing a read in flight). A new
   * zone changes the analytics key and that query fetches on its own; refetching the current one
   * would repeat the old dates. Refetch ignores `enabled`, so it never runs on a pending zone.
   */
  const retryAnalytics = async () => {
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
  };

  const failure = !profile && profileQuery.isError ? failureView(profileQuery.error) : null;
  const pending =
    !failure && (profileQuery.isPending || analyticsView.isPending || tripsQuery.isPending);

  let content: ReactNode;
  if (failure === "notFound") {
    content = (
      <Card className="driver-notice">
        <p>{t("states.notFound")}</p>
        <Link to="/account/drivers" className="driver-head-link">
          {t("states.backToDirectory")}
        </Link>
      </Card>
    );
  } else if (failure === "forbidden") {
    content = (
      <Card className="driver-notice">
        <p>{t("states.forbidden")}</p>
      </Card>
    );
  } else if (failure) {
    content = (
      <Card className="driver-error" role="alert">
        <p>{t("states.error")}</p>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            // The alert unmounts on success; the title stays mounted and keeps focus.
            titleRef.current?.focus();
            void profileQuery.refetch();
          }}
        >
          {t("states.retry")}
        </Button>
      </Card>
    );
  } else if (!profile) {
    content = (
      <div className="driver-layout" aria-hidden="true">
        <div className="driver-main">
          <Skeleton className="driver-skeleton-block" />
        </div>
        <div className="driver-side">
          <Skeleton className="driver-skeleton-block" />
        </div>
      </div>
    );
  } else {
    const visibleGames = GAMES.filter((g) => game === "all" || g === game);
    content = (
      <>
        <DriverKpis query={analyticsView} locale={locale} onRetry={() => void retryAnalytics()} />
        <div className="driver-layout">
          <div className="driver-main">
            <DriverTrips
              query={tripsQuery}
              isSelf={isSelf}
              game={effectiveGame}
              nickname={profile.member.nickname}
              locale={locale}
              displayTimezone={displayTimezone}
            />
          </div>
          <div className="driver-side">
            {visibleGames.map((g) => (
              <QualificationCard
                key={g}
                game={g}
                assignment={assignments[g]}
                progress={progress[g]}
                levels={levels[g]}
                locale={locale}
                displayTimezone={displayTimezone}
              />
            ))}
            <p className="driver-note">{t("qualification.note")}</p>
            <DistanceByMonth query={analyticsView} locale={locale} />
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="driver-profile-page">
      {/* Always mounted so screen readers announce loading, including after Retry. */}
      <p className="visually-hidden" role="status">
        {pending ? t("states.loading") : ""}
      </p>
      {failure !== "notFound" && failure !== "forbidden" && (
        <Link to="/account/drivers" className="driver-back">
          <span aria-hidden="true">←</span> {t("profile.back")}
        </Link>
      )}
      <ProfileHeader
        profile={profile}
        pending={profileQuery.isPending}
        isSelf={isSelf}
        assignments={assignments}
        levels={levels}
        game={game}
        onGameChange={setGame}
        titleRef={titleRef}
      />
      {content}
    </div>
  );
}
