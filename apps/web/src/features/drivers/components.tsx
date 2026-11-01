import type { UseQueryResult } from "@tanstack/react-query";
import { type ReactNode, type RefObject, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Cell, XAxis } from "recharts";
import {
  chartGeometry,
  decimalShift,
  formatDecimal,
  formatQuantity,
  formatUtc,
  type Locale,
} from "../../shared/formatting.js";
import { ChartContainer } from "../../shared/ui/chart.js";
import { Badge, Button, Card, Table } from "../../shared/ui/primitives.js";
import { SegmentedControl } from "../../shared/ui/segmented-control.js";
import { progressPercent } from "../dashboard/model.js";
import {
  type Assignment,
  COMPANY_TRIPS_WINDOW,
  failureView,
  type Game,
  type GameFilter,
  initial,
  LEVEL_ORDER,
  type Level,
  ladderFor,
  monthLabel,
  nextLevel,
  sourceKeys,
} from "./model.js";
import type { AcceptedTrips } from "./queries.js";
import type { DTO } from "./transport.js";

type Analytics = DTO["Analytics"];
type Progress = DTO["ProgressPublic"];
type MemberProfile = DTO["MemberProfile"];

const gameName: Record<Game, string> = { ets2: "ETS2", ats: "ATS" };

/** Level lookup state for one game, derived from the shared qualification levels read. */
export type LevelsState = { levels: Level[] | undefined; pending: boolean };

/** Decorative placeholder; the page status line announces loading. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      className={className ? `driver-skeleton ${className}` : "driver-skeleton"}
      aria-hidden="true"
    />
  );
}

function GameChip({ game }: { game: Game }) {
  return (
    <span className="driver-game" data-game={game}>
      {gameName[game]}
    </span>
  );
}

function levelText(
  assignment: Assignment,
  state: LevelsState,
  t: (key: string) => string,
): { name: string; resolved: Level | undefined } {
  const resolved = state.levels?.find(
    (level) => level.id === assignment.levelId && level.game === assignment.game,
  );
  if (resolved) return { name: resolved.name, resolved };
  return {
    name: t(state.pending ? "qualification.levelLoading" : "qualification.levelUnavailable"),
    resolved,
  };
}

export function ProfileHeader({
  profile,
  pending,
  isSelf,
  assignments,
  levels,
  game,
  onGameChange,
  titleRef,
}: {
  profile: MemberProfile | undefined;
  pending: boolean;
  isSelf: boolean;
  assignments: Record<Game, Assignment | null>;
  levels: Record<Game, LevelsState>;
  game: GameFilter;
  onGameChange: (game: GameFilter) => void;
  titleRef: RefObject<HTMLHeadingElement | null>;
}) {
  const { t } = useTranslation("drivers");
  const member = profile?.member;
  const chips = member
    ? (["ets2", "ats"] as const).flatMap((g) => {
        const assignment = assignments[g];
        return assignment ? [{ game: g, name: levelText(assignment, levels[g], t).name }] : [];
      })
    : [];

  return (
    <header className="driver-header">
      {member ? (
        <span className="driver-avatar" aria-hidden="true">
          {initial(member.nickname)}
        </span>
      ) : (
        pending && <Skeleton className="driver-avatar" />
      )}
      <div className="driver-identity">
        <div className="driver-title-row">
          {/* Stable focus target: Retry and state changes keep this node mounted. */}
          <h1 ref={titleRef} tabIndex={-1}>
            {member?.nickname ?? t("profile.title")}
          </h1>
          {member && (
            <>
              {member.roles.map((role) => (
                <Badge key={role} size="xs">
                  {t(`roles.${role}`)}
                </Badge>
              ))}
              {member.formerMember ? (
                <Badge size="xs" className="driver-former">
                  {t("profile.former")}
                </Badge>
              ) : (
                <Badge size="xs" className="driver-active">
                  {t("profile.active")}
                </Badge>
              )}
              {isSelf && (
                <Badge size="xs" className="driver-self">
                  {t("profile.you")}
                </Badge>
              )}
            </>
          )}
        </div>
        {chips.length > 0 && (
          <p className="driver-chips">
            {chips.map((chip) => (
              <span key={chip.game} className="driver-level-chip" data-game={chip.game}>
                {gameName[chip.game]} · {chip.name}
              </span>
            ))}
          </p>
        )}
      </div>
      {member && (
        <SegmentedControl
          className="driver-game-filter"
          aria-label={t("profile.game")}
          value={game}
          onValueChange={onGameChange}
          options={[
            { value: "all", label: t("profile.allGames") },
            { value: "ets2", label: "ETS2" },
            { value: "ats", label: "ATS" },
          ]}
        />
      )}
    </header>
  );
}

export function DriverKpis({
  query,
  locale,
}: {
  query: UseQueryResult<Analytics>;
  locale: Locale;
}) {
  const { t } = useTranslation("drivers");
  const sectionRef = useRef<HTMLElement>(null);
  const analytics = query.data;
  const failure = !analytics && query.isError ? failureView(query.error) : null;

  let body: ReactNode;
  if (failure === "setup") {
    body = <p className="driver-block-note">{t("kpi.setup")}</p>;
  } else if (failure) {
    body = (
      <div className="driver-block-error">
        <p>{t("kpi.error")}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            // The button unmounts on success; keep focus inside the statistics region.
            sectionRef.current?.focus();
            void query.refetch();
          }}
        >
          {t("kpi.retry")}
        </Button>
      </div>
    );
  } else {
    const month = analytics?.buckets.at(-1);
    const items = [
      {
        key: "trips",
        label: t("kpi.trips"),
        value: analytics ? formatDecimal(String(analytics.acceptedTrips), locale) : undefined,
        sub: t("kpi.window"),
      },
      {
        key: "distance",
        label: t("kpi.distance"),
        value: analytics ? formatQuantity(analytics.actualDistanceM, "km", locale) : undefined,
        sub: t("kpi.window"),
      },
      {
        key: "month",
        label: t("kpi.month"),
        value: analytics
          ? month
            ? formatQuantity(month.actualDistanceM, "km", locale)
            : formatQuantity(null, "km", locale)
          : undefined,
        sub: month
          ? t("kpi.monthSub", {
              trips: formatDecimal(String(month.acceptedTrips), locale),
              month: monthLabel(month.date, locale, "long"),
            })
          : undefined,
      },
    ];
    body = (
      <dl>
        {items.map((item) => (
          <div key={item.key} className="driver-kpi">
            <dt>{item.label}</dt>
            <dd>
              <span className="driver-kpi-value">{item.value ?? <Skeleton />}</span>
              {item.sub && analytics && <span className="driver-kpi-sub">{item.sub}</span>}
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      className="driver-kpis"
      aria-label={t("kpi.label")}
      aria-busy={query.isPending}
    >
      {body}
    </section>
  );
}

function ProgressRows({ progress, locale }: { progress: Progress; locale: Locale }) {
  const { t } = useTranslation("drivers");
  const rows = [
    {
      key: "trips",
      label: t("qualification.trips"),
      value:
        progress.requiredTrips === null
          ? formatDecimal(String(progress.acceptedTrips), locale)
          : `${formatDecimal(String(progress.acceptedTrips), locale)} / ${formatDecimal(String(progress.requiredTrips), locale)}`,
      percent: progressPercent(
        String(progress.acceptedTrips),
        progress.requiredTrips === null ? null : String(progress.requiredTrips),
      ),
    },
    {
      key: "distance",
      label: t("qualification.distance"),
      value:
        progress.requiredDistanceM === null
          ? formatQuantity(progress.actualDistanceM, "km", locale)
          : `${formatDecimal(decimalShift(progress.actualDistanceM, 3), locale)} / ${formatQuantity(progress.requiredDistanceM, "km", locale)}`,
      percent: progressPercent(progress.actualDistanceM, progress.requiredDistanceM),
    },
  ];
  const unconfigured = progress.requiredTrips === null || progress.requiredDistanceM === null;
  return (
    <>
      <dl className="driver-progress">
        {rows.map((row) => (
          <div key={row.key}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
            {row.percent !== null && (
              <span className="driver-bar" aria-hidden="true">
                <span style={{ width: `${row.percent}%` }} />
              </span>
            )}
          </div>
        ))}
      </dl>
      {unconfigured && <p className="driver-muted">{t("qualification.notConfigured")}</p>}
      {progress.eligibleForConfirmation && (
        <p className="driver-eligible">
          <span aria-hidden="true">✓</span> {t("qualification.eligible")}
        </p>
      )}
    </>
  );
}

export function QualificationCard({
  game,
  assignment,
  progress,
  levels,
  locale,
  displayTimezone,
}: {
  game: Game;
  assignment: Assignment | null;
  progress: UseQueryResult<Progress>;
  levels: LevelsState;
  locale: Locale;
  displayTimezone: string;
}) {
  const { t } = useTranslation("drivers");
  const headingId = useId();

  if (!assignment) {
    return (
      <Card className="driver-qualification" aria-labelledby={headingId}>
        <div className="driver-qualification-head">
          <h2 id={headingId}>
            <GameChip game={game} />
          </h2>
        </div>
        <p className="driver-muted">{t("qualification.none")}</p>
      </Card>
    );
  }

  const { name, resolved } = levelText(assignment, levels, t);
  const ladder = levels.levels ? ladderFor(levels.levels, game) : [];
  const next = resolved ? nextLevel(ladder, resolved.id) : null;
  const failure = !progress.data && progress.isError ? failureView(progress.error) : null;

  let body: ReactNode;
  if (progress.data) body = <ProgressRows progress={progress.data} locale={locale} />;
  else if (failure === "setup") body = <p className="driver-muted">{t("qualification.none")}</p>;
  else if (failure) body = <p className="driver-muted">{t("qualification.progressUnavailable")}</p>;
  else body = <p className="driver-muted">{t("qualification.progressLoading")}</p>;

  return (
    <Card className="driver-qualification" aria-labelledby={headingId}>
      <div className="driver-qualification-head">
        <h2 id={headingId}>
          <GameChip game={game} />
          <span className="visually-hidden"> · </span>
          <span>{name}</span>
        </h2>
        {next && (
          <span className="driver-next">
            {next === "top"
              ? t("qualification.top")
              : t("qualification.next", { level: next.name })}
          </span>
        )}
      </div>
      {resolved && ladder.length > 0 && (
        <ol className="driver-ladder" aria-label={t("qualification.ladder")}>
          {ladder.map((level) => {
            const current = level.id === resolved.id;
            const passed = LEVEL_ORDER.indexOf(level.code) < LEVEL_ORDER.indexOf(resolved.code);
            return (
              <li
                key={level.id}
                aria-current={current ? "step" : undefined}
                data-state={current ? "current" : passed ? "passed" : "upcoming"}
              >
                {level.name}
              </li>
            );
          })}
        </ol>
      )}
      {body}
      <p className="driver-since">
        {t("qualification.since", {
          date: `${formatUtc(assignment.assignedAt, locale, displayTimezone)} (${displayTimezone})`,
        })}
      </p>
    </Card>
  );
}

/** Drivers-local catalog label: the canonical ID stays in data, only the label is shown. */
function CatalogName({ value }: { value: DTO["CatalogLabel"] | null }) {
  const { t } = useTranslation("drivers");
  return (
    <>
      {value?.label ?? t("trips.unknown")}
      {value?.englishFallback && (
        <small className="driver-fallback"> · {t("trips.englishName")}</small>
      )}
    </>
  );
}

/** Date and time stay whole but may wrap onto two lines when the table is narrow. */
function CountedAt({ value }: { value: string }) {
  const split = value.lastIndexOf(", ");
  if (split < 0) return <span className="driver-nowrap">{value}</span>;
  return (
    <span>
      <span className="driver-nowrap">{value.slice(0, split + 1)}</span>{" "}
      <span className="driver-nowrap">{value.slice(split + 2)}</span>
    </span>
  );
}

function CellLabel({ children }: { children: ReactNode }) {
  // Visible only on phone cards; the table header already names the column for assistive tech.
  return (
    <span className="driver-cell-label" aria-hidden="true">
      {children}
    </span>
  );
}

export function DriverTrips({
  query,
  isSelf,
  nickname,
  locale,
  displayTimezone,
}: {
  query: UseQueryResult<AcceptedTrips>;
  isSelf: boolean;
  nickname: string;
  locale: Locale;
  displayTimezone: string;
}) {
  const { t } = useTranslation("drivers");
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const data = query.data;
  const limit = COMPANY_TRIPS_WINDOW;

  let body: ReactNode;
  if (!data && query.isError) {
    body = (
      <div className="driver-block-error">
        <p>{t("trips.error")}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            headingRef.current?.focus();
            void query.refetch();
          }}
        >
          {t("trips.retry")}
        </Button>
      </div>
    );
  } else if (!data) {
    body = (
      <div className="driver-skeleton-rows" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((row) => (
          <Skeleton key={row} />
        ))}
      </div>
    );
  } else if (data.items.length === 0) {
    body = (
      <p className="driver-empty">
        {isSelf
          ? t("trips.emptyOwn")
          : data.windowIncomplete
            ? t("trips.emptyWindow", { limit })
            : t("trips.empty")}
      </p>
    );
  } else {
    body = (
      <div className="driver-trips-area">
        <Table className="driver-trips-table">
          <caption className="visually-hidden">{t("trips.caption", { nickname })}</caption>
          <thead>
            <tr>
              <th scope="col" className="driver-col-time">
                {t("trips.counted")}
              </th>
              <th scope="col">{t("trips.route")}</th>
              <th scope="col">{t("trips.cargo")}</th>
              <th scope="col">{t("trips.source")}</th>
              <th scope="col" className="driver-num">
                {t("trips.distance")}
              </th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((trip) => (
              <tr key={trip.id} className="driver-trip-row">
                <td className="driver-trip-time">
                  <CellLabel>{t("trips.counted")}</CellLabel>
                  <CountedAt value={formatUtc(trip.reportingAt, locale, displayTimezone)} />
                </td>
                <td className="driver-trip-route">
                  <CellLabel>{t("trips.route")}</CellLabel>
                  <span className="driver-route-line">
                    <GameChip game={trip.game} />
                    <Link className="driver-trip-link" to={`/account/trips/${trip.id}`}>
                      <span>
                        <CatalogName value={trip.origin} />
                        {"\u00a0→ "}
                        <CatalogName value={trip.destination} />
                      </span>
                    </Link>
                  </span>
                </td>
                <td className="driver-trip-cargo">
                  <CellLabel>{t("trips.cargo")}</CellLabel>
                  <span>
                    <CatalogName value={trip.cargo} />
                  </span>
                </td>
                <td className="driver-trip-source">
                  <CellLabel>{t("trips.source")}</CellLabel>
                  <span>
                    {sourceKeys(trip.sourceKinds)
                      .map((key) => t(`trips.${key}`))
                      .join(" + ")}
                  </span>
                </td>
                <td className="driver-num driver-trip-distance">
                  <CellLabel>{t("trips.distance")}</CellLabel>
                  <span>{formatQuantity(trip.actualDistanceM, "km", locale)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    );
  }

  return (
    <Card className="driver-trips" aria-labelledby={headingId}>
      <div className="driver-card-head">
        <h2 id={headingId} ref={headingRef} tabIndex={-1}>
          {t("trips.title")}
        </h2>
        <span className="driver-muted">{t("trips.subtitle")}</span>
        <span className="driver-muted driver-timezone">
          {t("trips.timezone", { timezone: displayTimezone })}
        </span>
      </div>
      {body}
      {data && !isSelf && data.windowIncomplete && data.items.length > 0 && (
        <p className="driver-muted">{t("trips.windowNote", { limit })}</p>
      )}
      {data && isSelf && data.nextCursor && (
        <Link to="/account/trips" className="driver-head-link">
          {t("trips.allMine")}
        </Link>
      )}
      <p className="driver-footnote">{t("trips.privacy")}</p>
    </Card>
  );
}

type ChartView = "chart" | "table";

export function DistanceByMonth({
  query,
  locale,
}: {
  query: UseQueryResult<Analytics>;
  locale: Locale;
}) {
  const { t } = useTranslation("drivers");
  const headingId = useId();
  const captionId = useId();
  const [view, setView] = useState<ChartView>("chart");
  const analytics = query.data;
  const failure = !analytics && query.isError ? failureView(query.error) : null;

  const points = (analytics?.buckets ?? []).map((bucket) => ({
    date: bucket.date,
    label: monthLabel(bucket.date, locale, "short"),
    value: chartGeometry(bucket.actualDistanceM) ?? 0,
    exactDistance: bucket.actualDistanceM,
    trips: bucket.acceptedTrips,
  }));
  const maxValue = Math.max(...points.map((p) => p.value), 0);
  const isPeak = (value: number) => value === maxValue && maxValue > 0;
  const peak = points.find((p) => isPeak(p.value));

  let body: ReactNode;
  if (failure) {
    body = (
      <div className="driver-chart-body driver-chart-empty">
        <p>{t(failure === "setup" ? "kpi.setup" : "kpi.error")}</p>
      </div>
    );
  } else if (!analytics) {
    body = <div className="driver-chart-body driver-chart-skeleton" aria-hidden="true" />;
  } else if (points.length === 0 || analytics.acceptedTrips === 0) {
    body = (
      <div className="driver-chart-body driver-chart-empty">
        <p>{t("chart.empty")}</p>
      </div>
    );
  } else if (view === "chart") {
    body = (
      <figure aria-labelledby={headingId} className="driver-chart-body driver-chart-figure">
        <ChartContainer>
          <BarChart
            data={points}
            accessibilityLayer={false}
            margin={{ left: 4, right: 4, top: 8, bottom: 0 }}
          >
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              tick={{ fill: "var(--muted)", fontSize: 10 }}
            />
            <Bar dataKey="value" radius={[3, 3, 0, 0]} isAnimationActive={false} maxBarSize={28}>
              {points.map((entry) => (
                <Cell
                  key={entry.date}
                  fill={isPeak(entry.value) ? "var(--focus)" : "var(--chart)"}
                />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
        <figcaption className="driver-chart-caption">
          {peak &&
            t("chart.peak", {
              month: monthLabel(peak.date, locale, "long"),
              distance: formatQuantity(peak.exactDistance, "km", locale),
            })}
        </figcaption>
      </figure>
    );
  } else {
    body = (
      <div className="driver-chart-body">
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: This named overflow region needs focus for native keyboard scrolling. */}
        <section className="driver-table-scroll" aria-labelledby={captionId} tabIndex={0}>
          <Table size="xs">
            <caption id={captionId}>
              {t("chart.caption", { timezone: analytics.reportingTimezone })}
            </caption>
            <thead>
              <tr>
                <th scope="col">{t("chart.monthCol")}</th>
                <th scope="col" className="driver-num">
                  {t("chart.distanceCol")}
                </th>
                <th scope="col" className="driver-num">
                  {t("chart.tripsCol")}
                </th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.date}>
                  <th scope="row">{monthLabel(p.date, locale, "long")}</th>
                  <td className="driver-num">{formatQuantity(p.exactDistance, "km", locale)}</td>
                  <td className="driver-num">{formatDecimal(String(p.trips), locale)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </section>
      </div>
    );
  }

  return (
    <Card className="driver-chart" aria-labelledby={headingId}>
      <div className="driver-card-head">
        <h2 id={headingId}>{t("chart.title")}</h2>
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
      <div className="driver-meta">
        <span>{t("chart.unit")}</span>
        {!failure && (
          <span>
            {t("chart.reportingTz")}:{" "}
            {analytics ? (
              <strong>{analytics.reportingTimezone}</strong>
            ) : (
              <Skeleton className="driver-skeleton-inline" />
            )}
          </span>
        )}
      </div>
      {body}
    </Card>
  );
}
