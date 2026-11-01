import type { UseQueryResult } from "@tanstack/react-query";
import { type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Cell, XAxis } from "recharts";
import {
  chartGeometry,
  formatDecimal,
  formatQuantity,
  formatUtc,
  type Locale,
} from "../../shared/formatting.js";
import { ChartContainer } from "../../shared/ui/chart.js";
import { Badge, Button, Card, Table } from "../../shared/ui/primitives.js";
import { SegmentedControl } from "../../shared/ui/segmented-control.js";
import { useQualificationQuery } from "../qualifications/queries.js";
import { progressPercent } from "./model.js";
import type { DTO } from "./transport.js";
import "./dashboard.css";

type AnalyticsData = DTO["Analytics"];
type LeaderboardData = DTO["ListLeaderboardEntry"];
type ProgressData = DTO["Progress"];
type EventData = DTO["OptionalEvent"];
type ReviewListData = DTO["ListTripSummary"];

/** Decorative placeholder; the page status line announces loading. */
function Skeleton({ className }: { className?: string }) {
  return (
    <span
      className={className ? `dashboard-skeleton ${className}` : "dashboard-skeleton"}
      aria-hidden="true"
    />
  );
}

export function KpiStrip({
  analytics,
  analyticsPending,
  leaderboard,
  leaderboardPending,
  locale,
}: {
  analytics: AnalyticsData | undefined;
  analyticsPending: boolean;
  leaderboard: LeaderboardData | undefined;
  leaderboardPending: boolean;
  locale: Locale;
}) {
  const { t } = useTranslation("dashboard");
  // Leaderboard failure leaves the driver count unknown, which is distinct from zero.
  const activeDrivers = leaderboard
    ? `${formatDecimal(String(leaderboard.items.length), locale)}${leaderboard.nextCursor ? "+" : ""}`
    : formatDecimal(null, locale);
  const items = [
    {
      key: "distance",
      label: t("metrics.totalDistance"),
      value: analytics ? formatQuantity(analytics.actualDistanceM, "km", locale) : undefined,
      pending: analyticsPending,
    },
    {
      key: "trips",
      label: t("metrics.acceptedTrips"),
      value: analytics ? formatDecimal(String(analytics.acceptedTrips), locale) : undefined,
      pending: analyticsPending,
    },
    {
      key: "drivers",
      label: t("metrics.activeDrivers"),
      value: activeDrivers,
      pending: leaderboardPending,
    },
  ];

  return (
    <section
      className="dashboard-kpis"
      aria-label={t("metrics.label")}
      aria-busy={analyticsPending || leaderboardPending}
    >
      <dl>
        {items.map((item) => (
          <div key={item.key} className="dashboard-kpi">
            <dt>{item.label}</dt>
            <dd>{item.pending || item.value === undefined ? <Skeleton /> : item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

type ChartView = "chart" | "table";

export function ActualDistanceChart({
  analytics,
  pending,
  locale,
  displayTimezone,
  granularity,
  onGranularityChange,
}: {
  analytics: AnalyticsData | undefined;
  pending: boolean;
  locale: Locale;
  displayTimezone: string;
  granularity: "day" | "month";
  onGranularityChange: (g: "day" | "month") => void;
}) {
  const { t } = useTranslation("dashboard");
  const headingId = useId();
  const captionId = useId();
  const [view, setView] = useState<ChartView>("chart");

  const points = (analytics?.buckets ?? []).map((b) => ({
    date: b.date,
    value: chartGeometry(b.actualDistanceM) ?? 0,
    exactDistance: b.actualDistanceM,
    trips: b.acceptedTrips,
  }));
  const maxValue = Math.max(...points.map((p) => p.value), 0);
  const isPeak = (value: number) => value === maxValue && maxValue > 0;
  const peak = points.find((p) => isPeak(p.value));

  let body: ReactNode;
  if (pending || !analytics) {
    body = <div className="dashboard-chart-body dashboard-chart-skeleton" aria-hidden="true" />;
  } else if (points.length === 0) {
    body = (
      <div className="dashboard-chart-body dashboard-chart-empty">
        <p>{t("chart.emptyChart")}</p>
      </div>
    );
  } else if (view === "chart") {
    body = (
      <figure aria-labelledby={headingId} className="dashboard-chart-body dashboard-chart-figure">
        <ChartContainer>
          <BarChart
            data={points}
            accessibilityLayer={false}
            margin={{ left: 8, right: 8, top: 12, bottom: 4 }}
          >
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--muted)", fontSize: 11 }}
            />
            <Bar dataKey="value" radius={[3, 3, 0, 0]} isAnimationActive={false} maxBarSize={48}>
              {points.map((entry) => (
                <Cell
                  key={`cell-${entry.date}`}
                  fill={isPeak(entry.value) ? "var(--focus)" : "var(--chart)"}
                />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
        <figcaption className="dashboard-chart-caption">
          {peak
            ? t("chart.peakSummary", {
                date: peak.date,
                distance: formatQuantity(peak.exactDistance, "km", locale),
              })
            : t("chart.tableHint")}
        </figcaption>
      </figure>
    );
  } else {
    body = (
      <div className="dashboard-chart-body">
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: This named overflow region needs focus for native keyboard scrolling. */}
        <section className="dashboard-table-scroll" aria-labelledby={captionId} tabIndex={0}>
          <Table size="xs">
            <caption id={captionId}>
              {t("chart.tableCaption")} ({analytics.reportingTimezone})
            </caption>
            <thead>
              <tr>
                <th scope="col">{t("chart.dateCol")}</th>
                <th scope="col" className="dashboard-num">
                  {t("chart.distanceCol")}
                </th>
                <th scope="col" className="dashboard-num">
                  {t("chart.tripsCol")}
                </th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.date}>
                  <th scope="row">
                    {p.date}
                    {isPeak(p.value) && (
                      <Badge size="xs" className="dashboard-peak-badge">
                        {t("chart.highestPeriod")}
                      </Badge>
                    )}
                  </th>
                  <td className="dashboard-num">{formatQuantity(p.exactDistance, "km", locale)}</td>
                  <td className="dashboard-num">{formatDecimal(String(p.trips), locale)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </section>
      </div>
    );
  }

  return (
    <Card className="dashboard-chart" aria-labelledby={headingId}>
      <div className="dashboard-card-head">
        <h2 id={headingId}>{t("chart.title")}</h2>
        <div className="dashboard-card-controls">
          <SegmentedControl
            aria-label={t("chart.granularity")}
            value={granularity}
            onValueChange={onGranularityChange}
            options={[
              { value: "day", label: t("chart.day") },
              { value: "month", label: t("chart.month") },
            ]}
          />
          <SegmentedControl
            aria-label={t("chart.view")}
            value={view}
            onValueChange={setView}
            options={[
              { value: "chart", label: t("chart.viewChart") },
              { value: "table", label: t("chart.viewTable") },
            ]}
          />
        </div>
      </div>

      <div className="dashboard-meta">
        <span>
          {t("chart.reportingTz")}:{" "}
          {analytics ? (
            <strong>{analytics.reportingTimezone}</strong>
          ) : (
            <Skeleton className="dashboard-skeleton-inline" />
          )}
        </span>
        {analytics && (
          <span>
            {formatUtc(analytics.computedAt, locale, displayTimezone)} ({displayTimezone})
          </span>
        )}
      </div>

      {body}
    </Card>
  );
}

export function LeaderboardWidget({
  query,
  locale,
}: {
  query: UseQueryResult<LeaderboardData>;
  locale: Locale;
}) {
  const { t } = useTranslation("dashboard");
  const headingId = useId();
  const entries = query.data?.items.slice(0, 10) ?? [];

  let body: ReactNode;
  if (query.isError) {
    body = (
      <div className="dashboard-block-error">
        <p>{t("leaderboard.error")}</p>
        <Button type="button" variant="outline" onClick={() => void query.refetch()}>
          {t("leaderboard.retry")}
        </Button>
      </div>
    );
  } else if (!query.data) {
    body = (
      <div className="dashboard-skeleton-rows" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((row) => (
          <Skeleton key={row} />
        ))}
      </div>
    );
  } else if (entries.length === 0) {
    body = <p className="dashboard-empty">{t("leaderboard.empty")}</p>;
  } else {
    body = (
      <Table size="xs" className="dashboard-leaderboard">
        <thead>
          <tr>
            <th scope="col" className="dashboard-rank-col">
              {t("leaderboard.rank")}
            </th>
            <th scope="col">{t("leaderboard.driver")}</th>
            <th scope="col" className="dashboard-num dashboard-trips-col">
              {t("leaderboard.trips")}
            </th>
            <th scope="col" className="dashboard-num dashboard-distance-col">
              {t("leaderboard.distance")}
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, index) => {
            const rank = index + 1;
            return (
              <tr key={entry.member.id}>
                <td>
                  {rank <= 3 ? (
                    <Badge size="xs" className="dashboard-rank">
                      {rank}
                    </Badge>
                  ) : (
                    <span className="dashboard-rank-plain">{rank}</span>
                  )}
                </td>
                <td>
                  <Link
                    to={`/account/drivers/${entry.member.id}`}
                    className="dashboard-driver-link"
                  >
                    {entry.member.nickname}
                  </Link>
                </td>
                <td className="dashboard-num">
                  {formatDecimal(String(entry.acceptedTrips), locale)}
                </td>
                <td className="dashboard-num">
                  {formatQuantity(entry.actualDistanceM, "km", locale)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    );
  }

  return (
    <Card className="dashboard-leaderboard-card" aria-labelledby={headingId}>
      <div className="dashboard-card-head">
        <h2 id={headingId}>{t("leaderboard.title")}</h2>
        <Link to="/account/drivers" className="dashboard-head-link">
          {t("leaderboard.allDrivers")}
        </Link>
      </div>
      {body}
    </Card>
  );
}

type LevelsQuery = ReturnType<typeof useQualificationQuery<"EnvelopeListQualificationLevel">>;

function QualificationGame({
  label,
  query,
  available,
  levels,
  locale,
}: {
  label: string;
  query: UseQueryResult<ProgressData>;
  available: boolean;
  levels: LevelsQuery;
  locale: Locale;
}) {
  const { t } = useTranslation("dashboard");
  const progress = query.data;

  let content: ReactNode;
  let badges: ReactNode = null;
  if (!available || (progress && !progress.assignment)) {
    // Members without own-trip submission have no driver qualification to show.
    content = <p className="dashboard-muted">{t("myQualification.noQualification")}</p>;
  } else if (query.isError) {
    content = <p className="dashboard-muted">{t("myQualification.progressUnavailable")}</p>;
  } else if (!progress) {
    content = <p className="dashboard-muted">{t("myQualification.progressLoading")}</p>;
  } else {
    const level = levels.data?.data.data.items.find(
      (item) => item.id === progress.assignment.levelId && item.game === progress.assignment.game,
    );
    badges = (
      <>
        <Badge size="xs">
          {level?.name ??
            t(
              levels.isPending
                ? "myQualification.levelLoading"
                : "myQualification.levelUnavailable",
            )}
        </Badge>
        {progress.eligibleForConfirmation && (
          <Badge size="xs" className="badge-accepted">
            {t("myQualification.eligible")}
          </Badge>
        )}
      </>
    );
    const rows = [
      {
        key: "trips",
        label: t("myQualification.trips"),
        value: `${formatDecimal(String(progress.acceptedTrips), locale)}${
          progress.requiredTrips !== null
            ? ` / ${formatDecimal(String(progress.requiredTrips), locale)}`
            : ""
        }`,
        percent: progressPercent(
          String(progress.acceptedTrips),
          progress.requiredTrips === null ? null : String(progress.requiredTrips),
        ),
      },
      {
        key: "distance",
        label: t("myQualification.distance"),
        value: `${formatQuantity(progress.actualDistanceM, "km", locale)}${
          progress.requiredDistanceM !== null
            ? ` / ${formatQuantity(progress.requiredDistanceM, "km", locale)}`
            : ""
        }`,
        percent: progressPercent(progress.actualDistanceM, progress.requiredDistanceM),
      },
    ];
    content = (
      <dl className="dashboard-progress">
        {rows.map((row) => (
          <div key={row.key}>
            <dt>{row.label}</dt>
            <dd>
              {row.percent !== null && (
                <span className="dashboard-bar" aria-hidden="true">
                  <span style={{ width: `${row.percent}%` }} />
                </span>
              )}
              <span className="dashboard-progress-value">{row.value}</span>
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  return (
    <div className="dashboard-qualification-game">
      <div className="dashboard-qualification-title">
        <h3>{label}</h3>
        {badges}
      </div>
      {content}
    </div>
  );
}

export function MyQualificationWidget({
  ets2Progress,
  atsProgress,
  available,
}: {
  ets2Progress: UseQueryResult<ProgressData>;
  atsProgress: UseQueryResult<ProgressData>;
  available: boolean;
}) {
  const { t, i18n } = useTranslation("dashboard");
  const locale = (i18n.resolvedLanguage === "en" ? "en" : "ru") as Locale;
  const headingId = useId();
  const ets2Levels = useQualificationQuery(
    "/qualification-levels?game=ets2&limit=25",
    "EnvelopeListQualificationLevel",
  );
  const atsLevels = useQualificationQuery(
    "/qualification-levels?game=ats&limit=25",
    "EnvelopeListQualificationLevel",
  );

  return (
    <Card className="dashboard-qualification" aria-labelledby={headingId}>
      <div className="dashboard-card-head">
        <h2 id={headingId}>{t("myQualification.title")}</h2>
        <Link to="/account/trips" className="dashboard-head-link">
          {t("myQualification.tripsLink")}
        </Link>
      </div>
      <QualificationGame
        label="ETS2"
        query={ets2Progress}
        available={available}
        levels={ets2Levels}
        locale={locale}
      />
      <QualificationGame
        label="ATS"
        query={atsProgress}
        available={available}
        levels={atsLevels}
        locale={locale}
      />
    </Card>
  );
}

export function ReviewerQueueWidget({
  query,
  locale,
}: {
  query: UseQueryResult<ReviewListData>;
  locale: Locale;
}) {
  const { t } = useTranslation("dashboard");
  const headingId = useId();
  const review = query.data;
  // The queue request is limited to five items; a next page means "more than shown".
  const count = review
    ? `${formatDecimal(String(review.items.length), locale)}${review.nextCursor ? "+" : ""}`
    : "";

  return (
    <Card className="dashboard-side-card" aria-labelledby={headingId}>
      <div className="dashboard-card-head">
        <h2 id={headingId}>{t("reviewQueue.title")}</h2>
      </div>
      {review ? (
        <p className="dashboard-muted">
          {review.items.length > 0
            ? `${t("reviewQueue.pendingCount")}: ${count}`
            : t("reviewQueue.noPending")}
        </p>
      ) : query.isError ? (
        <p className="dashboard-muted">{t("states.error")}</p>
      ) : (
        <Skeleton className="dashboard-skeleton-line" />
      )}
      <Link to="/account/review" className="dashboard-head-link">
        {t("reviewQueue.reviewLink")}
      </Link>
    </Card>
  );
}

export function UpcomingEventWidget({
  query,
  locale,
  displayTimezone,
}: {
  query: UseQueryResult<EventData>;
  locale: Locale;
  displayTimezone: string;
}) {
  const { t } = useTranslation("dashboard");
  const headingId = useId();
  const event = query.data;

  let body: ReactNode;
  if (event) {
    body = (
      <>
        <h3 className="dashboard-event-title">{event.title}</h3>
        <p className="dashboard-muted">
          {formatUtc(event.startsAt, locale, displayTimezone)} ({displayTimezone})
        </p>
        <Link to={`/account/events/${event.id}`} className="dashboard-head-link">
          {t("upcomingEvent.viewEvent")}
        </Link>
      </>
    );
  } else if (query.isError) {
    body = <p className="dashboard-muted">{t("states.error")}</p>;
  } else if (query.isSuccess) {
    body = <p className="dashboard-muted">{t("upcomingEvent.noUpcoming")}</p>;
  } else {
    body = <Skeleton className="dashboard-skeleton-line" />;
  }

  return (
    <Card className="dashboard-side-card" aria-labelledby={headingId}>
      <div className="dashboard-card-head">
        <h2 id={headingId}>{t("upcomingEvent.title")}</h2>
      </div>
      {body}
    </Card>
  );
}

export function MetricDefinitionsCard() {
  const { t } = useTranslation("dashboard");
  const contentId = useId();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Card className="dashboard-definitions">
      <div className="dashboard-card-head">
        <h2>{t("definitions.title")}</h2>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setIsOpen((open) => !open)}
          aria-expanded={isOpen}
          aria-controls={contentId}
        >
          {isOpen ? t("definitions.toggleClose") : t("definitions.toggleOpen")}
        </Button>
      </div>

      <div id={contentId} className="dashboard-definitions-content" hidden={!isOpen}>
        <div>
          <h3>{t("definitions.timezoneTitle")}</h3>
          <p>{t("definitions.timezoneDesc")}</p>
        </div>
        <div>
          <h3>{t("definitions.telemetryTitle")}</h3>
          <p>{t("definitions.telemetryDesc")}</p>
        </div>
        <div>
          <h3>{t("definitions.reviewsTitle")}</h3>
          <p>{t("definitions.reviewsDesc")}</p>
        </div>
        <div>
          <h3>{t("definitions.eventsTitle")}</h3>
          <p>{t("definitions.eventsDesc")}</p>
        </div>
      </div>
    </Card>
  );
}
