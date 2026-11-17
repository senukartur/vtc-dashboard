import { type ReactNode, type Ref, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Cell, Tooltip, XAxis } from "recharts";
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
import {
  bucketLabel,
  bucketsSpanYears,
  type CalendarRange,
  type Delta,
  inclusiveRangeLabel,
  progressPercent,
} from "./model.js";
import type { DTO } from "./transport.js";
import {
  activeDriversView,
  averageTripM,
  type DeltaLine,
  formatPercent,
  gameSplit,
  type KpiDeltas,
  type LeaderboardRow,
  leaderboardRows,
  type QueryView,
} from "./view-model.js";
import "./dashboard.css";

type AnalyticsData = DTO["AnalyticsStage4Company"];
/** What the distance chart reads; company and member analytics both satisfy it. */
export type ChartAnalytics = Pick<
  DTO["Analytics"],
  "granularity" | "buckets" | "reportingTimezone" | "computedAt"
>;
type LeaderboardData = DTO["ListLeaderboardEntry"];
type ProgressData = DTO["MyQualification"] | null;

/** Decorative placeholder; the page status line or the block itself announces loading. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      className={className ? `dashboard-skeleton ${className}` : "dashboard-skeleton"}
      aria-hidden="true"
    />
  );
}

/** "+8%", "−12", "<1%": the sign is text, so the change never relies on colour alone. */
export function deltaChange(delta: Extract<Delta, { difference: string }>, locale: Locale) {
  const sign = delta.kind === "up" ? "+" : delta.kind === "down" ? "−" : "";
  if (delta.percent === null) return `${sign}${formatDecimal(delta.difference, locale)}`;
  return delta.lessThanOne
    ? `${sign}<${formatPercent(1, locale)}`
    : `${sign}${formatPercent(delta.percent, locale)}`;
}

/**
 * A KPI's comparison with the previous period. The first tile shows the whole sentence
 * ("+8% vs 1–17 Oct"); the others show the change and keep the period for screen readers only.
 */
function DeltaLineView({
  line,
  range,
  locale,
  compact,
}: {
  line: DeltaLine;
  range: CalendarRange | null;
  locale: Locale;
  compact: boolean;
}) {
  const { t } = useTranslation("dashboard");
  if (line === null) return null;
  if (line === "pending")
    return <dd className="dashboard-kpi-delta dashboard-kpi-delta-reserve" aria-hidden="true" />;
  if (line.kind === "unavailable")
    return <dd className="dashboard-kpi-delta">{t("delta.unavailable")}</dd>;
  const period = range ? inclusiveRangeLabel(range, locale, "short") : "";
  const [shown, rest] =
    line.kind === "noBaseline"
      ? [t("delta.noData"), t("delta.noDataFor", { range: period })]
      : [deltaChange(line, locale), t("delta.against", { range: period })];
  return (
    <dd
      className={`dashboard-kpi-delta${line.kind === "noBaseline" ? "" : ` dashboard-delta-${line.kind}`}`}
    >
      {shown} <span className={compact ? "visually-hidden" : undefined}>{rest}</span>
    </dd>
  );
}

export function KpiStrip({
  analytics,
  analyticsPending,
  deltas,
  previousRange,
  locale,
}: {
  analytics: AnalyticsData | undefined;
  analyticsPending: boolean;
  /** Each tile's comparison with the previous period (see `companyDeltas`). */
  deltas: KpiDeltas | undefined;
  /** The previous period, or null for all time (no comparison). */
  previousRange: CalendarRange | null;
  locale: Locale;
}) {
  const { t } = useTranslation("dashboard");
  const number = (value: number) => formatDecimal(String(value), locale);
  const km = (value: string) => formatQuantity(value, "km", locale);
  // Shown values come from the latest data; an absent value is unavailable, never zero.
  const split = analytics ? gameSplit(analytics) : null;
  const drivers = analytics ? activeDriversView(analytics) : null;
  const average = analytics ? averageTripM(analytics) : null;
  // Each game is one unit, so a narrow tile wraps the split at the separator only (two lines).
  const splitText = (ets2: string, ats: string) => (
    <>
      <span className="dashboard-kpi-part">ETS2 {ets2}</span>
      {" · "}
      <span className="dashboard-kpi-part">ATS {ats}</span>
    </>
  );
  const items: {
    key: keyof KpiDeltas;
    label: string;
    value: string | undefined;
    sub?: ReactNode;
  }[] = [
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
      key: "average",
      label: t("metrics.averageTrip"),
      value: analytics ? (average === null ? t("metrics.noAverage") : km(average)) : undefined,
      ...(analytics && { sub: t("metrics.averageSub") }),
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
  ];

  return (
    <section
      className="dashboard-kpis"
      aria-label={t("metrics.label")}
      aria-busy={analyticsPending}
    >
      <dl>
        {items.map((item, index) => (
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
            {item.value === undefined ? (
              previousRange && (
                <dd
                  className="dashboard-kpi-delta dashboard-kpi-delta-reserve"
                  aria-hidden="true"
                />
              )
            ) : (
              <DeltaLineView
                line={deltas?.[item.key] ?? null}
                range={previousRange}
                locale={locale}
                compact={index > 0}
              />
            )}
          </div>
        ))}
      </dl>
    </section>
  );
}

type ChartView = "chart" | "table";

/** Decorative hover details; the Table view is the accessible alternative. */
function ChartTooltip({
  active,
  point,
  locale,
}: {
  active: boolean;
  point: { full: string; exactDistance: string; trips: number } | undefined;
  locale: Locale;
}) {
  const { t } = useTranslation("dashboard");
  if (!active || !point) return null;
  return (
    <div className="dashboard-chart-tooltip">
      <strong>{point.full}</strong>
      <span>{formatQuantity(point.exactDistance, "km", locale)}</span>
      <span>{t("chart.tooltipTrips", { trips: formatDecimal(String(point.trips), locale) })}</span>
    </div>
  );
}

export function ActualDistanceChart({
  analytics,
  pending,
  locale,
  displayTimezone,
  title,
  granularity = "day",
  onGranularityChange,
  showGranularity = true,
  failure,
  headingRef,
}: {
  analytics: ChartAnalytics | undefined;
  pending: boolean;
  locale: Locale;
  displayTimezone: string;
  /** The card heading; the company chart keeps its default title. */
  title?: string;
  granularity?: "day" | "month";
  /** Without a handler the card has no Interval control (My overview: days only). */
  onGranularityChange?: (g: "day" | "month") => void;
  /** False for all time, which only has month buckets; the chosen interval is kept. */
  showGranularity?: boolean;
  /** Shown in the body when the read failed without data (My overview has no page alert). */
  failure?: ReactNode;
  /** Makes the heading programmatically focusable, the focus target of a successful Retry. */
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const { t } = useTranslation("dashboard");
  const headingId = useId();
  const captionId = useId();
  const [view, setView] = useState<ChartView>("chart");

  // Labels follow the buckets the response actually has, never the requested interval.
  const step = analytics?.granularity ?? "day";
  const buckets = analytics?.buckets ?? [];
  const spansYears = bucketsSpanYears(buckets);
  const points = buckets.map((b) => ({
    date: b.date,
    axis: bucketLabel(b.date, step, locale, "axis", spansYears),
    full: bucketLabel(b.date, step, locale, "full"),
    value: chartGeometry(b.actualDistanceM) ?? 0,
    exactDistance: b.actualDistanceM,
    trips: b.acceptedTrips,
  }));
  const maxValue = Math.max(...points.map((p) => p.value), 0);
  const isPeak = (value: number) => value === maxValue && maxValue > 0;
  const peak = points.find((p) => isPeak(p.value));
  const axisLabel = new Map(points.map((p) => [p.date, p.axis]));

  let body: ReactNode;
  if (failure && !analytics) {
    body = <div className="dashboard-chart-body dashboard-chart-failure">{failure}</div>;
  } else if (pending || !analytics) {
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
              interval="preserveStartEnd"
              minTickGap={12}
              tickFormatter={(value: string) => axisLabel.get(value) ?? ""}
              tick={{ fill: "var(--muted)", fontSize: 11 }}
            />
            <Tooltip
              isAnimationActive={false}
              cursor={{ fill: "var(--surface-active)" }}
              content={({ active, payload }) => (
                <ChartTooltip
                  active={active}
                  point={payload?.[0]?.payload as (typeof points)[number] | undefined}
                  locale={locale}
                />
              )}
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
                date: peak.full,
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
                    <time dateTime={p.date}>{p.full}</time>
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
        <h2 id={headingId} ref={headingRef} tabIndex={headingRef ? -1 : undefined}>
          {title ?? t("chart.title")}
        </h2>
        <div className="dashboard-card-controls">
          {showGranularity && onGranularityChange && (
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

function QualificationGame({
  label,
  query,
  available,
  locale,
}: {
  label: string;
  query: QueryView<ProgressData>;
  available: boolean;
  locale: Locale;
}) {
  const { t } = useTranslation("dashboard");
  const progress = query.data;

  let content: ReactNode;
  let badges: ReactNode = null;
  if (!available || (!query.isPending && !query.isError && !progress?.level)) {
    // Members without own-trip submission have no driver qualification to show.
    content = <p className="dashboard-muted">{t("myQualification.noQualification")}</p>;
  } else if (!progress && query.isError) {
    content = <p className="dashboard-muted">{t("myQualification.progressUnavailable")}</p>;
  } else if (!progress?.level) {
    content = <p className="dashboard-muted">{t("myQualification.progressLoading")}</p>;
  } else {
    const conditions = progress.nextLevel ? progress.conditions : null;
    badges = (
      <Badge size="xs">
        <Link to={`/account/qualifications/${encodeURIComponent(progress.level.id)}`}>
          {progress.level.name}
        </Link>
      </Badge>
    );
    const rows = [
      {
        key: "trips",
        label: t("myQualification.trips"),
        value: `${formatDecimal(String(progress.progress.trips), locale)}${
          conditions?.requiredTrips != null
            ? ` / ${formatDecimal(String(conditions.requiredTrips), locale)}`
            : ""
        }`,
        percent: progressPercent(
          String(progress.progress.trips),
          conditions?.requiredTrips != null ? String(conditions.requiredTrips) : null,
        ),
      },
      {
        key: "distance",
        label: t("myQualification.distance"),
        value: `${formatQuantity(progress.progress.distanceM, "km", locale)}${
          conditions?.requiredDistanceM != null
            ? ` / ${formatQuantity(conditions.requiredDistanceM, "km", locale)}`
            : ""
        }`,
        percent: progressPercent(
          progress.progress.distanceM,
          conditions?.requiredDistanceM ?? null,
        ),
      },
    ];
    content = (
      <>
        {progress.nextLevel && (
          <p className="dashboard-muted">
            {t("myQualification.next", { name: progress.nextLevel.name })}
          </p>
        )}
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
      </>
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
  games = ["ets2", "ats"],
}: {
  ets2Progress: QueryView<ProgressData>;
  atsProgress: QueryView<ProgressData>;
  available: boolean;
  /** Games to show, in order: My overview follows its game filter. */
  games?: readonly ("ets2" | "ats")[];
}) {
  const { t, i18n } = useTranslation("dashboard");
  const locale = (i18n.resolvedLanguage === "en" ? "en" : "ru") as Locale;
  const headingId = useId();

  return (
    <Card className="dashboard-qualification" aria-labelledby={headingId}>
      <div className="dashboard-card-head">
        <h2 id={headingId}>{t("myQualification.title")}</h2>
        <Link to="/account/qualifications" className="dashboard-head-link">
          {t("myQualification.qualificationsLink")}
        </Link>
      </div>
      {games.map((game) => (
        <QualificationGame
          key={game}
          label={game === "ets2" ? "ETS2" : "ATS"}
          query={game === "ets2" ? ets2Progress : atsProgress}
          available={available}
          locale={locale}
        />
      ))}
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
