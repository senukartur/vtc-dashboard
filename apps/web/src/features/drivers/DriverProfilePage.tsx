import { type ReactNode, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import type { Locale } from "../../shared/formatting.js";
import { Button, Card } from "../../shared/ui/primitives.js";
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
  const [period] = useState(() => twelveMonthWindow());
  const effectiveGame = game === "all" ? undefined : game;

  const profileQuery = useMemberProfile(memberId);
  const profile = profileQuery.data;
  const assignments = {
    ets2: profile ? assignmentFor(profile, "ets2") : null,
    ats: profile ? assignmentFor(profile, "ats") : null,
  };
  const analyticsQuery = useMemberAnalytics(memberId, { ...period, game: effectiveGame });
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

  const failure = !profile && profileQuery.isError ? failureView(profileQuery.error) : null;
  const pending =
    !failure && (profileQuery.isPending || analyticsQuery.isPending || tripsQuery.isPending);

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
        <DriverKpis query={analyticsQuery} locale={locale} />
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
            <DistanceByMonth query={analyticsQuery} locale={locale} />
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
