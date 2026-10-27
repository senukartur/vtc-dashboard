import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Cell, XAxis } from "recharts";
import type { components } from "@vtc/contracts";
import {
  chartGeometry,
  formatDecimal,
  formatQuantity,
  formatUtc,
  type Locale,
} from "../../shared/formatting.js";
import { ChartContainer } from "../../shared/ui/chart.js";
import { Badge, Button, Card, Table } from "../../shared/ui/primitives.js";
import type { DTO } from "./transport.js";

type AnalyticsData = DTO["Analytics"];
type LeaderboardData = DTO["ListLeaderboardEntry"];
type SummaryData = DTO["OwnTripStatusSummary"];
type ProgressData = DTO["Progress"];
type EventData = DTO["OptionalEvent"];
type ReviewListData = DTO["ListTripSummary"];

export function MetricCard({
  title,
  value,
  unit,
  help,
}: {
  title: string;
  value: string;
  unit?: string;
  help?: string;
}) {
  return (
    <Card className="metric-card">
      <div className="section-heading">
        <div>
          <span className="eyebrow">{title}</span>
          <div className="metric-value-row">
            <span className="metric-value">{value}</span>
            {unit && <span className="metric-unit">{unit}</span>}
          </div>
        </div>
      </div>
      {help && <p className="muted text-sm">{help}</p>}
    </Card>
  );
}

export function ActualDistanceChart({
  analytics,
  locale,
  displayTimezone,
  granularity,
  onGranularityChange,
}: {
  analytics: AnalyticsData;
  locale: Locale;
  displayTimezone: string;
  granularity: "day" | "month";
  onGranularityChange: (g: "day" | "month") => void;
}) {
  const { t } = useTranslation("dashboard");

  const points = analytics.buckets.map((b) => ({
    date: b.date,
    value: chartGeometry(b.actualDistanceM) ?? 0,
    exactDistance: b.actualDistanceM,
    trips: b.acceptedTrips,
  }));

  const maxValue = Math.max(...points.map((p) => p.value), 0);

  return (
    <Card className="analytics-chart-card" aria-labelledby="chart-heading">
      <div className="chart-header">
        <div>
          <h2 id="chart-heading" className="text-lg font-semibold">
            {t("chart.title")}
          </h2>
          <p className="muted text-sm">{t("chart.help")}</p>
        </div>
        <div className="chart-controls">
          <fieldset className="button-group" aria-label={t("chart.title")}>
            <Button
              type="button"
              variant={granularity === "day" ? "default" : "outline"}
              onClick={() => onGranularityChange("day")}
              aria-pressed={granularity === "day"}
            >
              {t("chart.day")}
            </Button>
            <Button
              type="button"
              variant={granularity === "month" ? "default" : "outline"}
              onClick={() => onGranularityChange("month")}
              aria-pressed={granularity === "month"}
            >
              {t("chart.month")}
            </Button>
          </fieldset>
        </div>
      </div>

      <div className="meta-line muted text-xs">
        {t("chart.reportingTz")}: <strong>{analytics.reportingTimezone}</strong>
      </div>

      {points.length === 0 ? (
        <p className="muted py-8 text-center">{t("chart.emptyChart")}</p>
      ) : (
        <figure aria-labelledby="chart-heading" className="chart-figure">
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
                tick={{ fill: "var(--muted)", fontSize: 12 }}
              />
              <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false} maxBarSize={64}>
                {points.map((entry) => {
                  const isMax = entry.value === maxValue && maxValue > 0;
                  return (
                    <Cell
                      key={`cell-${entry.date}`}
                      fill={isMax ? "var(--focus)" : "var(--chart)"}
                    />
                  );
                })}
              </Bar>
            </BarChart>
          </ChartContainer>

          <figcaption className="chart-table-caption">
            <Table>
              <caption>
                {t("chart.tableCaption")} ({analytics.reportingTimezone})
              </caption>
              <thead>
                <tr>
                  <th scope="col">{t("chart.dateCol")}</th>
                  <th scope="col">{t("chart.distanceCol")}</th>
                  <th scope="col">{t("chart.tripsCol")}</th>
                </tr>
              </thead>
              <tbody>
                {points.map((p) => {
                  const isMax = p.value === maxValue && maxValue > 0;
                  return (
                    <tr key={p.date} className={isMax ? "highlighted-row" : undefined}>
                      <th scope="row">
                        {p.date}
                        {isMax && (
                          <Badge className="ml-2 bg-blue-900 text-blue-200">
                            {t("chart.highestPeriod")}
                          </Badge>
                        )}
                      </th>
                      <td>{formatQuantity(p.exactDistance, "km", locale)}</td>
                      <td>{formatDecimal(String(p.trips), locale)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </figcaption>
        </figure>
      )}

      <p className="muted text-xs mt-2">
        {formatUtc(analytics.computedAt, locale, displayTimezone)} ({displayTimezone})
      </p>
    </Card>
  );
}

export function LeaderboardWidget({
  leaderboard,
  locale,
}: {
  leaderboard: LeaderboardData | undefined;
  locale: Locale;
}) {
  const { t } = useTranslation("dashboard");
  const entries = leaderboard?.items ?? [];

  return (
    <Card className="leaderboard-card">
      <div className="section-heading">
        <h2 className="text-lg font-semibold">{t("leaderboard.title")}</h2>
      </div>

      {entries.length === 0 ? (
        <p className="muted py-4">{t("leaderboard.empty")}</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <th scope="col">{t("leaderboard.rank")}</th>
              <th scope="col">{t("leaderboard.driver")}</th>
              <th scope="col">{t("leaderboard.trips")}</th>
              <th scope="col">{t("leaderboard.distance")}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, index) => {
              const rank = index + 1;
              return (
                <tr key={entry.member.id}>
                  <td>
                    {rank <= 3 ? (
                      <Badge className="rank-badge">{rank}</Badge>
                    ) : (
                      <span className="muted">{rank}</span>
                    )}
                  </td>
                  <td>
                    <Link
                      to={`/account/drivers/${entry.member.id}`}
                      className="font-medium hover:underline"
                    >
                      {entry.member.nickname}
                    </Link>
                  </td>
                  <td>{formatDecimal(String(entry.acceptedTrips), locale)}</td>
                  <td>{formatQuantity(entry.actualDistanceM, "km", locale)}</td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

export function MyQualificationWidget({
  ets2Progress,
  atsProgress,
}: {
  ets2Progress: ProgressData | undefined;
  atsProgress: ProgressData | undefined;
}) {
  const { t, i18n } = useTranslation("dashboard");
  const locale = (i18n.resolvedLanguage === "en" ? "en" : "ru") as Locale;

  const renderProgress = (progress: ProgressData | undefined) => {
    if (!progress?.assignment) {
      return <span className="text-sm muted">{t("myQualification.noQualification")}</span>;
    }
    return (
      <div className="qualification-details space-y-1">
        <div className="flex items-center gap-2">
          <Badge>{progress.assignment.levelId}</Badge>
          {progress.eligibleForConfirmation && (
            <Badge className="bg-emerald-950 text-emerald-300">
              {t("myQualification.eligible")}
            </Badge>
          )}
        </div>
        <div className="text-xs text-gray-400">
          <span>
            {t("leaderboard.trips")}: {progress.acceptedTrips}
            {progress.requiredTrips !== null ? ` / ${progress.requiredTrips}` : ""}
          </span>
          <span className="mx-2">·</span>
          <span>
            {formatQuantity(progress.actualDistanceM, "km", locale)}
            {progress.requiredDistanceM !== null
              ? ` / ${formatQuantity(progress.requiredDistanceM, "km", locale)}`
              : ""}
          </span>
        </div>
      </div>
    );
  };

  return (
    <Card className="qualification-widget">
      <div className="section-heading">
        <h2 className="text-lg font-semibold">{t("myQualification.title")}</h2>
      </div>

      <div className="space-y-4">
        <div className="qualification-game-row">
          <span className="font-medium">ETS2</span>
          {renderProgress(ets2Progress)}
        </div>

        <div className="qualification-game-row">
          <span className="font-medium">ATS</span>
          {renderProgress(atsProgress)}
        </div>
      </div>

      <div className="mt-4 pt-2 border-t border-gray-800">
        <Button asChild variant="outline" className="w-full">
          <Link to="/account/trips">{t("myQualification.tripsLink")}</Link>
        </Button>
      </div>
    </Card>
  );
}

export function ReviewerQueueWidget({ reviewTrips }: { reviewTrips: ReviewListData | undefined }) {
  const { t } = useTranslation("dashboard");
  const count = reviewTrips?.items.length ?? 0;

  return (
    <Card className="review-queue-widget">
      <div className="section-heading">
        <h2 className="text-lg font-semibold">{t("reviewQueue.title")}</h2>
      </div>
      <p className="text-sm muted mb-3">
        {count > 0 ? `${t("reviewQueue.pendingCount")}: ${count}` : t("reviewQueue.noPending")}
      </p>
      <Button asChild variant="default" className="w-full">
        <Link to="/account/review">{t("reviewQueue.reviewLink")}</Link>
      </Button>
    </Card>
  );
}

export function UpcomingEventWidget({
  eventData,
  locale,
  displayTimezone,
}: {
  eventData: EventData | undefined;
  locale: Locale;
  displayTimezone: string;
}) {
  const { t } = useTranslation("dashboard");
  const event = eventData;

  return (
    <Card className="upcoming-event-widget">
      <div className="section-heading">
        <h2 className="text-lg font-semibold">{t("upcomingEvent.title")}</h2>
      </div>
      {event ? (
        <div className="space-y-2">
          <h3 className="font-medium">{event.title}</h3>
          <p className="text-xs muted">{formatUtc(event.startsAt, locale, displayTimezone)}</p>
          <Button asChild variant="outline" className="w-full mt-2">
            <Link to={`/account/events/${event.id}`}>{t("upcomingEvent.viewEvent")}</Link>
          </Button>
        </div>
      ) : (
        <p className="text-sm muted">{t("upcomingEvent.noUpcoming")}</p>
      )}
    </Card>
  );
}

export function MetricDefinitionsCard() {
  const { t } = useTranslation("dashboard");
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Card className="definitions-card">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{t("definitions.title")}</h2>
        <Button
          type="button"
          variant="ghost"
          onClick={() => setIsOpen(!isOpen)}
          aria-expanded={isOpen}
          className="text-xs"
        >
          {isOpen ? t("definitions.toggleClose") : t("definitions.toggleOpen")}
        </Button>
      </div>

      {isOpen && (
        <div className="definitions-content mt-4 space-y-3 pt-3 border-t border-gray-800 text-sm">
          <div>
            <h3 className="font-medium text-foreground">{t("definitions.timezoneTitle")}</h3>
            <p className="muted text-xs">{t("definitions.timezoneDesc")}</p>
          </div>
          <div>
            <h3 className="font-medium text-foreground">{t("definitions.telemetryTitle")}</h3>
            <p className="muted text-xs">{t("definitions.telemetryDesc")}</p>
          </div>
          <div>
            <h3 className="font-medium text-foreground">{t("definitions.reviewsTitle")}</h3>
            <p className="muted text-xs">{t("definitions.reviewsDesc")}</p>
          </div>
          <div>
            <h3 className="font-medium text-foreground">{t("definitions.eventsTitle")}</h3>
            <p className="muted text-xs">{t("definitions.eventsDesc")}</p>
          </div>
        </div>
      )}
    </Card>
  );
}
