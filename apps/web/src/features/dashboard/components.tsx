import { type ReactNode, useId, useRef, useState } from "react";
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
import {
  activeDriversView,
  gameSplit,
  type LeaderboardRow,
  leaderboardRows,
  type PlaceView,
  type QueryView,
} from "./view-model.js";
import "./dashboard.css";

type AnalyticsData = DTO["AnalyticsStage4Company"];
type LeaderboardData = DTO["ListLeaderboardEntry"];
type ProgressData = DTO["Progress"];

/** Decorative placeholder; the page status line or the block itself announces loading. */
export function Skeleton({ className }: { className?: string }) {
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
  place,
  leaderboardPending,
  locale,
}: {
  analytics: AnalyticsData | undefined;
  analyticsPending: boolean;
  /** The viewer's place from the leaderboard read (see `placeView`). */
  place: PlaceView;
  leaderboardPending: boolean;
  locale: Locale;
}) {
  const { t } = useTranslation("dashboard");
  const number = (value: number) => formatDecimal(String(value), locale);
  const km = (value: string) => formatQuantity(value, "km", locale);
  // Shown values come from the latest data; an absent value is unavailable, never zero.
  const split = analytics ? gameSplit(analytics) : null;
  const drivers = analytics ? activeDriversView(analytics) : null;
  // Each game is one unit, so a narrow tile wraps the split at the separator only (two lines).
  const splitText = (ets2: string, ats: string) => (
    <>
      <span className="dashboard-kpi-part">ETS2 {ets2}</span>
      {" · "}
      <span className="dashboard-kpi-part">ATS {ats}</span>
    </>
  );
  const items: { key: string; label: string; value: string | undefined; sub?: ReactNode }[] = [
    {
      key: "distance",
      label: t("metrics.totalDistance"),
      value: analytics ? km(analytics.actualDistanceM) : undefined,
      ...(split && {
        sub: splitText(km(split.ets2.actualDistanceM), km(split.ats.actualDistanceM)),
      }),
    },
    {
      key: "trips",
      label: t("metrics.acceptedTrips"),
      value: analytics ? number(analytics.acceptedTrips) : undefined,
      ...(split && {
        sub: splitText(number(split.ets2.acceptedTrips), number(split.ats.acceptedTrips)),
      }),
    },
    {
      key: "drivers",
      label: t("metrics.activeDrivers"),
      value: drivers
        ? drivers.drivers === null
          ? formatDecimal(null, locale)
          : number(drivers.drivers)
        : undefined,
      ...(drivers &&
        drivers.members !== null && {
          sub: t("metrics.activeMembers", { members: number(drivers.members) }),
        }),
    },
    {
      key: "place",
      label: t("metrics.myPlace"),
      ...(place.kind === "ranked"
        ? {
            value:
              place.ranked === undefined
                ? number(place.position)
                : t("metrics.placeOf", {
                    position: number(place.position),
                    ranked: number(place.ranked),
                  }),
            sub: t("metrics.placeTotals", {
              distance: km(place.actualDistanceM),
              trips: number(place.acceptedTrips),
            }),
          }
        : place.kind === "notRanked"
          ? { value: t("metrics.notRanked"), sub: t("metrics.noTrips") }
          : {
              value: place.kind === "unavailable" ? formatDecimal(null, locale) : undefined,
            }),
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
            <dd className="dashboard-kpi-value">{item.value ?? <Skeleton />}</dd>
            {item.sub ? (
              <dd className="dashboard-kpi-sub">{item.sub}</dd>
            ) : (
              // While the value loads, reserve the sub-line so the strip keeps its height.
              item.value === undefined && (
                <dd className="dashboard-kpi-sub-reserve" aria-hidden="true" />
              )
            )}
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
  showGranularity = true,
}: {
  analytics: AnalyticsData | undefined;
  pending: boolean;
  locale: Locale;
  displayTimezone: string;
  granularity: "day" | "month";
  onGranularityChange: (g: "day" | "month") => void;
  /** False for all time, which only has month buckets; the chosen interval is kept. */
  showGranularity?: boolean;
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
          {showGranularity && (
            <SegmentedControl
              aria-label={t("chart.granularity")}
              value={granularity}
              onValueChange={onGranularityChange}
              options={[
                { value: "day", label: t("chart.day") },
                { value: "month", label: t("chart.month") },
              ]}
            />
          )}
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

function RankCell({ rank }: { rank: number }) {
  return (
    <td>
      {rank <= 3 ? (
        <Badge size="xs" className="dashboard-rank">
          {rank}
        </Badge>
      ) : (
        <span className="dashboard-rank-plain">{rank}</span>
      )}
    </td>
  );
}

export function LeaderboardWidget({
  query,
  locale,
  self,
}: {
  query: QueryView<LeaderboardData>;
  locale: Locale;
  /** The signed-in member, for marking the own row and the own place below the top ten. */
  self: { id: string; nickname: string } | undefined;
}) {
  const { t } = useTranslation("dashboard");
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { rows, offPage } = query.data
    ? leaderboardRows(query.data, self?.id)
    : { rows: [] as LeaderboardRow[], offPage: null };
  const you = <span className="dashboard-you"> · {t("leaderboard.you")}</span>;

  // Data first: a failed background refresh keeps the last rows instead of an error.
  let body: ReactNode;
  if (!query.data && query.isError) {
    body = (
      <div className="dashboard-block-error">
        <p>{t("leaderboard.error")}</p>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            // The button unmounts on success; keep focus inside the card.
            headingRef.current?.focus();
            void query.refetch();
          }}
        >
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
  } else if (rows.length === 0) {
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
          {rows.map(({ entry, rank, self: own }) => (
            <tr key={entry.member.id} className={own ? "dashboard-own-row" : undefined}>
              <RankCell rank={rank} />
              <td>
                <Link to={`/account/drivers/${entry.member.id}`} className="dashboard-driver-link">
                  {entry.member.nickname}
                </Link>
                {own && you}
              </td>
              <td className="dashboard-num">
                {formatDecimal(String(entry.acceptedTrips), locale)}
              </td>
              <td className="dashboard-num">
                {formatQuantity(entry.actualDistanceM, "km", locale)}
              </td>
            </tr>
          ))}
        </tbody>
        {/* The viewer's own place below the shown rows, set apart by a separator. */}
        {offPage && self && (
          <tbody className="dashboard-leaderboard-self">
            <tr className="dashboard-own-row">
              <RankCell rank={offPage.position} />
              <td>
                <Link to={`/account/drivers/${self.id}`} className="dashboard-driver-link">
                  {self.nickname}
                </Link>
                {you}
              </td>
              <td className="dashboard-num">
                {formatDecimal(String(offPage.acceptedTrips), locale)}
              </td>
              <td className="dashboard-num">
                {formatQuantity(offPage.actualDistanceM, "km", locale)}
              </td>
            </tr>
          </tbody>
        )}
      </Table>
    );
  }

  return (
    <Card className="dashboard-leaderboard-card" aria-labelledby={headingId}>
      <div className="dashboard-card-head">
        <h2 id={headingId} ref={headingRef} tabIndex={-1}>
          {t("leaderboard.title")}
        </h2>
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
  query: QueryView<ProgressData>;
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
  } else if (!progress && query.isError) {
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
  ets2Progress: QueryView<ProgressData>;
  atsProgress: QueryView<ProgressData>;
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

/**
 * The overview's review queue count. It is the workspace summary's exact count of trips the viewer
 * can decide, without the viewer's own, so it always agrees with the dispatch header and the menu.
 * A summary without the queue (no access) hides the card.
 */
export function ReviewerQueueWidget({
  summary,
  locale,
}: {
  summary: { data: DTO["WorkspaceSummary"] | undefined; isError: boolean };
  locale: Locale;
}) {
  const { t } = useTranslation("dashboard");
  const headingId = useId();
  const queue = summary.data?.reviewQueue;
  if (summary.data && !queue) return null;

  return (
    <Card className="dashboard-side-card" aria-labelledby={headingId}>
      <div className="dashboard-card-head">
        <h2 id={headingId}>{t("reviewQueue.title")}</h2>
      </div>
      {queue ? (
        <p className="dashboard-muted">
          {queue.count > 0
            ? `${t("reviewQueue.pendingCount")}: ${formatDecimal(String(queue.count), locale)}`
            : t("reviewQueue.noPending")}
        </p>
      ) : summary.isError ? (
        <p className="dashboard-muted">{t("reviewQueue.error")}</p>
      ) : (
        <Skeleton className="dashboard-skeleton-line" />
      )}
      <Link to="/account/review" className="dashboard-head-link">
        {t("reviewQueue.reviewLink")}
      </Link>
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
