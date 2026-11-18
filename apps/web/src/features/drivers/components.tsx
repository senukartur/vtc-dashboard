import type { UseQueryResult } from "@tanstack/react-query";
import { ArrowRight, Check } from "lucide-react";
import { type ReactNode, type RefObject, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Cell, XAxis } from "recharts";
import { CatalogNativeName } from "../../shared/catalog-selectors/CatalogNativeName.js";
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
import type { QueryView } from "../dashboard/view-model.js";
import { tripListTimestamp } from "../trips/list-model.js";
import { InfoHint, RelativeDay, useMinuteNow } from "./directory-components.js";
import { driverAccessHref } from "./directory-model.js";
import {
  type Assignment,
  averageTripKm,
  capitalize,
  driverTripFilters,
  failureView,
  type Game,
  type GameFilter,
  initial,
  type Level,
  ladderFor,
  type MemberQualification,
  membershipParts,
  monthLabel,
  nextLevel,
  sourceKeys,
} from "./model.js";
import type { DTO } from "./transport.js";

type Analytics = DTO["Analytics"];
type Qualifications = DTO["MyQualificationList"];
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
    <Badge tone={game} className="driver-game" data-game={game}>
      {gameName[game]}
    </Badge>
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
  canManage,
  locale,
  displayTimezone,
  assignments,
  levels,
  game,
  onGameChange,
  titleRef,
}: {
  profile: MemberProfile | undefined;
  pending: boolean;
  isSelf: boolean;
  /** members.manage: opens this member's access panel over the drivers directory. */
  canManage: boolean;
  locale: Locale;
  displayTimezone: string;
  assignments: Record<Game, Assignment | null>;
  levels: Record<Game, LevelsState>;
  game: GameFilter;
  onGameChange: (game: GameFilter) => void;
  titleRef: RefObject<HTMLHeadingElement | null>;
}) {
  const { t } = useTranslation("drivers");
  const now = useMinuteNow();
  const member = profile?.member;
  const line = profile ? membershipParts(profile, locale, displayTimezone, t) : null;
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
                <Badge
                  key={role}
                  size="xs"
                  tone={role === "director" || role === "deputy_director" ? "info" : "neutral"}
                >
                  {t(`roles.${role}`)}
                </Badge>
              ))}
              {member.formerMember ? (
                <Badge size="xs" className="driver-former">
                  {t("profile.former")}
                </Badge>
              ) : (
                <Badge size="xs" tone="ok" icon={Check} className="driver-active">
                  {t("profile.active")}
                </Badge>
              )}
              {isSelf && (
                <Badge size="xs" tone="info" className="driver-self">
                  {t("profile.you")}
                </Badge>
              )}
            </>
          )}
        </div>
        {line && (line.since || line.lastTrip) && (
          <p className="driver-membership">
            {line.since}
            {line.since && line.lastTrip && " · "}
            {line.lastTrip?.kind === "none" &&
              (line.since ? t("profile.noTrips") : capitalize(t("profile.noTrips"), locale))}
            {line.lastTrip?.kind === "date" && (
              <>
                {line.since
                  ? t("profile.lastTripLabel")
                  : capitalize(t("profile.lastTripLabel"), locale)}{" "}
                <RelativeDay
                  iso={line.lastTrip.iso}
                  now={now}
                  locale={locale}
                  timezone={displayTimezone}
                />
              </>
            )}
          </p>
        )}
        {chips.length > 0 && (
          <p className="driver-chips">
            {chips.map((chip) => (
              <Badge
                key={chip.game}
                tone={chip.game}
                className="driver-level-chip"
                data-game={chip.game}
              >
                {gameName[chip.game]} · {chip.name}
              </Badge>
            ))}
          </p>
        )}
      </div>
      {member && canManage && (
        <Button asChild variant="outline" className="driver-access">
          <Link to={driverAccessHref(member)}>{t("profile.access")}</Link>
        </Button>
      )}
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

/**
 * Four profile totals, all games: lifetime distance, trips and average trip from the exact
 * lifetime totals, and the directory's 30-day distance. They come with the profile read, so they
 * do not follow the game filter or wait for analytics; an absent value reads "Unavailable", never 0.
 */
export function DriverKpis({
  lifetime,
  last30,
  endsAt,
  locale,
  timezone,
}: {
  lifetime: DTO["LifetimeTripTotals"] | undefined;
  last30: DTO["AnalyticsStage4Totals"] | undefined;
  endsAt: string | undefined;
  locale: Locale;
  timezone: string;
}) {
  const { t } = useTranslation("drivers");
  const average = averageTripKm(lifetime);
  const items: { key: string; label: ReactNode; value: ReactNode }[] = [
    {
      key: "total",
      label: t("kpi.total"),
      value: formatQuantity(lifetime?.actualDistanceM ?? null, "km", locale),
    },
    {
      key: "trips",
      label: t("kpi.trips"),
      value: formatDecimal(lifetime ? String(lifetime.acceptedTrips) : null, locale),
    },
    {
      key: "average",
      label: t("kpi.average"),
      value:
        average.kind === "none" ? (
          <>
            <span aria-hidden="true">—</span>
            <span className="visually-hidden">{t("kpi.noAverage")}</span>
          </>
        ) : (
          formatQuantity(average.kind === "value" ? average.distanceM : null, "km", locale)
        ),
    },
    {
      key: "last30",
      label: (
        <>
          {t("kpi.last30")}
          {last30 && endsAt && (
            <InfoHint label={t("kpi.last30Hint")}>
              {t("kpi.last30Text", { end: formatUtc(endsAt, locale, timezone), timezone })}
            </InfoHint>
          )}
        </>
      ),
      value: formatQuantity(last30?.actualDistanceM ?? null, "km", locale),
    },
  ];
  return (
    <section className="driver-kpis" aria-label={t("kpi.label")}>
      <p className="driver-kpi-caption">{t("kpi.games")}</p>
      <dl>
        {items.map((item) => (
          <div key={item.key} className="driver-kpi" data-kpi={item.key}>
            <dt>{item.label}</dt>
            <dd>
              <span className="driver-kpi-value">{item.value}</span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function ProgressRows({ item, locale }: { item: MemberQualification; locale: Locale }) {
  const { t } = useTranslation("drivers");
  const { progress, conditions } = item;
  const requiredTrips = conditions?.requiredTrips ?? null;
  const requiredDistanceM = conditions?.requiredDistanceM ?? null;
  const rows = [
    {
      key: "trips",
      label: t("qualification.trips"),
      value:
        requiredTrips === null
          ? formatDecimal(String(progress.trips), locale)
          : `${formatDecimal(String(progress.trips), locale)} / ${formatDecimal(String(requiredTrips), locale)}`,
      percent: progressPercent(
        String(progress.trips),
        requiredTrips === null ? null : String(requiredTrips),
      ),
    },
    {
      key: "distance",
      label: t("qualification.distance"),
      value:
        requiredDistanceM === null
          ? formatQuantity(progress.distanceM, "km", locale)
          : `${formatDecimal(decimalShift(progress.distanceM, 3), locale)} / ${formatQuantity(requiredDistanceM, "km", locale)}`,
      percent: progressPercent(progress.distanceM, requiredDistanceM),
    },
  ];
  return (
    <>
      <dl className="driver-progress">
        {rows.map((row) => (
          <div key={row.key}>
            <dt>{row.label}</dt>
            <dd>
              <span className="driver-progress-value">{row.value}</span>
              {row.percent !== null && (
                <span className="driver-bar" aria-hidden="true">
                  <span style={{ width: `${row.percent}%` }} />
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {item.nextLevel && requiredTrips === null && requiredDistanceM === null && (
        <p className="driver-muted">{t("qualification.notConfigured")}</p>
      )}
    </>
  );
}

export function QualificationCard({
  game,
  assignment,
  qualifications,
  levels,
  locale,
  displayTimezone,
}: {
  game: Game;
  assignment: Assignment | null;
  qualifications: UseQueryResult<Qualifications>;
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
  const item = qualifications.data?.items.find(
    (entry) => entry.game === game && entry.level?.id === assignment.levelId,
  );
  const failure =
    !qualifications.data && qualifications.isError ? failureView(qualifications.error) : null;

  let body: ReactNode;
  if (item) body = <ProgressRows item={item} locale={locale} />;
  else if (qualifications.data || failure)
    body = <p className="driver-muted">{t("qualification.progressUnavailable")}</p>;
  else body = <p className="driver-muted">{t("qualification.progressLoading")}</p>;

  return (
    <Card className="driver-qualification" aria-labelledby={headingId}>
      <div className="driver-qualification-head">
        <h2 id={headingId}>
          <GameChip game={game} />
          <span className="visually-hidden"> · </span>
          {resolved ? (
            <Link to={`/account/qualifications/${encodeURIComponent(resolved.id)}`}>{name}</Link>
          ) : (
            <span>{name}</span>
          )}
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
          {ladder.map((level, index) => {
            const current = level.id === resolved.id;
            const passed = level.position < resolved.position;
            return (
              <li
                key={level.id}
                aria-current={current ? "step" : undefined}
                data-state={current ? "current" : passed ? "passed" : "upcoming"}
              >
                {index > 0 && (
                  <ArrowRight
                    size={14}
                    strokeWidth={1.8}
                    aria-hidden="true"
                    focusable="false"
                    className="driver-ladder-arrow"
                  />
                )}
                <Badge tone={current ? "info" : "neutral"} className="driver-ladder-name">
                  {level.name}
                </Badge>
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
      <CatalogNativeName value={value} />
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
  game,
  member,
  locale,
  displayTimezone,
}: {
  query: UseQueryResult<DTO["ListTripSummary"]>;
  isSelf: boolean;
  game: Game | undefined;
  member: DTO["MemberSummary"];
  locale: Locale;
  displayTimezone: string;
}) {
  const { t } = useTranslation(["drivers", "trips"]);
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const data = query.data;
  const { nickname } = member;
  const history = driverTripFilters(member.id, { isSelf, game });

  let body: ReactNode;
  if (!data && failureView(query.error) === "forbidden") {
    body = <p className="driver-muted">{t("states.forbidden")}</p>;
  } else if (!data && query.isError) {
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
    body = <p className="driver-empty">{isSelf ? t("trips.emptyOwn") : t("trips.empty")}</p>;
  } else {
    body = (
      <div className="driver-trips-area">
        <Table className="driver-trips-table">
          <caption className="visually-hidden">{t("trips.caption", { nickname })}</caption>
          <thead>
            <tr>
              <th scope="col" className="driver-col-time">
                {t("trips:completionColumn")}
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
            {data.items.map((trip) => {
              const timestamp = tripListTimestamp(trip);
              return (
                <tr key={trip.id} className="driver-trip-row">
                  <td className="driver-trip-time">
                    <CellLabel>{t("trips:completionColumn")}</CellLabel>
                    <CountedAt value={formatUtc(timestamp?.at ?? null, locale, displayTimezone)} />
                    {timestamp?.label && (
                      <small className="driver-trip-basis">{t(`trips:${timestamp.label}`)}</small>
                    )}
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
              );
            })}
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
        <span className="driver-muted driver-timezone">
          {t("trips.timezone", { timezone: displayTimezone })}
        </span>
      </div>
      {body}
      {data && (
        <Link to={`/account/trips?${history}`} className="driver-head-link">
          {isSelf ? t("trips.allMine") : t("trips.allDriver", { nickname })}
        </Link>
      )}
      <p className="driver-footnote">{t("trips.privacy")}</p>
    </Card>
  );
}

type ChartView = "chart" | "table";

/**
 * `onRetry` belongs to the page: it may have to reread the reporting timezone first. The chart
 * owns the statistics failure, setup and Retry states; Retry keeps focus on the chart heading.
 */
export function DistanceByMonth({
  query,
  locale,
  onRetry,
}: {
  query: QueryView<Analytics>;
  locale: Locale;
  onRetry: () => void;
}) {
  const { t } = useTranslation("drivers");
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
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
  if (failure === "setup") {
    body = (
      <div className="driver-chart-body driver-chart-empty">
        <p>{t("chart.setup")}</p>
      </div>
    );
  } else if (failure) {
    body = (
      <div className="driver-chart-body driver-chart-empty driver-block-error">
        <p>{t("chart.error")}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            // The button unmounts on success; keep focus on the chart heading.
            headingRef.current?.focus();
            onRetry();
          }}
        >
          {t("chart.retry")}
        </Button>
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
    <Card className="driver-chart" aria-labelledby={headingId} aria-busy={query.isPending}>
      <div className="driver-card-head">
        <h2 id={headingId} ref={headingRef} tabIndex={-1}>
          {t("chart.title")}
        </h2>
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
