import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Cell, XAxis } from "recharts";
import { useSession } from "../../app/Session.js";
import {
  chartGeometry,
  formatDecimal,
  formatQuantity,
  formatUtc,
  type Locale,
} from "../../shared/formatting.js";
import { ChartContainer } from "../../shared/ui/chart.js";
import { Badge, Button, Card, Table } from "../../shared/ui/primitives.js";
import {
  useMemberAcceptedTrips,
  useMemberAnalytics,
  useMemberProfile,
  useMemberProgress,
} from "./queries.js";

type GameFilter = "all" | "ets2" | "ats";

export function DriverProfilePage() {
  const { memberId = "" } = useParams<{ memberId: string }>();
  const { t, i18n } = useTranslation("drivers");
  const locale = (i18n.resolvedLanguage === "en" ? "en" : "ru") as Locale;
  const session = useSession();
  const displayTimezone = session.self?.preferences.displayTimezone ?? "UTC";

  const [game, setGame] = useState<GameFilter>("all");
  const effectiveGame = game === "all" ? undefined : game;

  // Dates for driver personal analytics (current year)
  const currentYear = new Date().getUTCFullYear();
  const fromDate = `${currentYear}-01-01`;
  const toDateExclusive = `${currentYear + 1}-01-01`;

  const profileQuery = useMemberProfile(memberId);
  const analyticsQuery = useMemberAnalytics(memberId, {
    fromDate,
    toDateExclusive,
    game: effectiveGame,
    granularity: "month",
  });
  const ets2ProgressQuery = useMemberProgress(memberId, "ets2");
  const atsProgressQuery = useMemberProgress(memberId, "ats");
  const tripsQuery = useMemberAcceptedTrips(memberId, {
    game: effectiveGame,
  });

  const profile = profileQuery.data;
  const analytics = analyticsQuery.data;
  const member = profile?.member;

  const roleLabel = (r: string) => t(`roles.${r}` as any) || r;

  const chartPoints = useMemo(() => {
    if (!analytics) return [];
    return analytics.buckets.map((b) => ({
      date: b.date,
      value: chartGeometry(b.actualDistanceM) ?? 0,
      exactDistance: b.actualDistanceM,
      trips: b.acceptedTrips,
    }));
  }, [analytics]);

  const maxChartValue = Math.max(...chartPoints.map((p) => p.value), 0);

  if (profileQuery.isLoading) {
    return (
      <div className="driver-profile-page stack space-y-6">
        <Card className="p-8 text-center" role="status" aria-busy="true">
          <p className="muted">{t("states.loading")}</p>
        </Card>
      </div>
    );
  }

  if (profileQuery.isError || !member) {
    return (
      <div className="driver-profile-page stack space-y-6">
        <Card className="p-8 text-center text-red-400">
          <p className="mb-4">{t("states.notFound")}</p>
          <Button asChild variant="outline">
            <Link to="/account/drivers">{t("states.backToDirectory")}</Link>
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="driver-profile-page stack space-y-6">
      {/* Header and navigation */}
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" className="text-sm">
          <Link to="/account/drivers">← {t("states.backToDirectory")}</Link>
        </Button>
      </div>

      {/* Driver profile identity card */}
      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <span className="eyebrow">{t("profile.title")}</span>
            <h1 className="text-2xl font-bold flex items-center gap-3 mt-1">
              {member.nickname}
              {member.formerMember ? (
                <Badge className="bg-zinc-800 text-zinc-400 text-xs">{t("profile.former")}</Badge>
              ) : (
                <Badge className="bg-emerald-950 text-emerald-300 text-xs">
                  {t("profile.active")}
                </Badge>
              )}
            </h1>
            <div className="flex flex-wrap gap-1 mt-3">
              {member.roles.map((r) => (
                <Badge key={r} className="bg-gray-800 text-gray-200">
                  {roleLabel(r)}
                </Badge>
              ))}
            </div>
          </div>
        </div>

        {/* Privacy Notice Card */}
        <div className="mt-4 p-3 bg-gray-900 border border-gray-800 rounded text-xs text-gray-400">
          🔒 {t("profile.privacyNotice")}
        </div>
      </Card>

      {/* Game filter toggle */}
      <Card className="p-4">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">{t("profile.gameCol")}:</span>
          <fieldset className="button-group" aria-label={t("profile.gameCol")}>
            <Button
              type="button"
              variant={game === "all" ? "default" : "outline"}
              onClick={() => setGame("all")}
              aria-pressed={game === "all"}
            >
              {t("profile.allGames")}
            </Button>
            <Button
              type="button"
              variant={game === "ets2" ? "default" : "outline"}
              onClick={() => setGame("ets2")}
              aria-pressed={game === "ets2"}
            >
              ETS2
            </Button>
            <Button
              type="button"
              variant={game === "ats" ? "default" : "outline"}
              onClick={() => setGame("ats")}
              aria-pressed={game === "ats"}
            >
              ATS
            </Button>
          </fieldset>
        </div>
      </Card>

      {/* Personal statistics KPIs */}
      {analytics && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">{t("profile.statsTitle")}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card className="metric-card p-5">
              <span className="eyebrow">{t("profile.totalDistance")}</span>
              <div className="text-2xl font-bold mt-1">
                {formatQuantity(analytics.actualDistanceM, "km", locale)}
              </div>
            </Card>
            <Card className="metric-card p-5">
              <span className="eyebrow">{t("profile.acceptedTrips")}</span>
              <div className="text-2xl font-bold mt-1">
                {formatDecimal(String(analytics.acceptedTrips), locale)}
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* Driver Qualifications */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-4">{t("profile.qualificationsTitle")}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="p-4 border border-gray-800 rounded">
            <h3 className="font-semibold text-base mb-2">ETS2</h3>
            {profile.qualifications.find((q) => q.game === "ets2") ? (
              <div className="space-y-2">
                <Badge className="bg-blue-950 text-blue-300">
                  {profile.qualifications.find((q) => q.game === "ets2")?.levelId}
                </Badge>
                {ets2ProgressQuery.data && (
                  <div className="text-xs text-gray-400 mt-2 space-y-1">
                    <div>
                      {t("profile.acceptedTrips")}: {ets2ProgressQuery.data.acceptedTrips}
                      {ets2ProgressQuery.data.requiredTrips !== null
                        ? ` / ${ets2ProgressQuery.data.requiredTrips}`
                        : ""}
                    </div>
                    <div>
                      {formatQuantity(ets2ProgressQuery.data.actualDistanceM, "km", locale)}
                      {ets2ProgressQuery.data.requiredDistanceM !== null
                        ? ` / ${formatQuantity(ets2ProgressQuery.data.requiredDistanceM, "km", locale)}`
                        : ""}
                    </div>
                    {ets2ProgressQuery.data.eligibleForConfirmation && (
                      <Badge className="bg-emerald-950 text-emerald-300">
                        {t("profile.eligible")}
                      </Badge>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm muted">{t("profile.noQualifications")}</p>
            )}
          </div>

          <div className="p-4 border border-gray-800 rounded">
            <h3 className="font-semibold text-base mb-2">ATS</h3>
            {profile.qualifications.find((q) => q.game === "ats") ? (
              <div className="space-y-2">
                <Badge className="bg-amber-950 text-amber-300">
                  {profile.qualifications.find((q) => q.game === "ats")?.levelId}
                </Badge>
                {atsProgressQuery.data && (
                  <div className="text-xs text-gray-400 mt-2 space-y-1">
                    <div>
                      {t("profile.acceptedTrips")}: {atsProgressQuery.data.acceptedTrips}
                      {atsProgressQuery.data.requiredTrips !== null
                        ? ` / ${atsProgressQuery.data.requiredTrips}`
                        : ""}
                    </div>
                    <div>
                      {formatQuantity(atsProgressQuery.data.actualDistanceM, "km", locale)}
                      {atsProgressQuery.data.requiredDistanceM !== null
                        ? ` / ${formatQuantity(atsProgressQuery.data.requiredDistanceM, "km", locale)}`
                        : ""}
                    </div>
                    {atsProgressQuery.data.eligibleForConfirmation && (
                      <Badge className="bg-emerald-950 text-emerald-300">
                        {t("profile.eligible")}
                      </Badge>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm muted">{t("profile.noQualifications")}</p>
            )}
          </div>
        </div>
      </Card>

      {/* Monthly Distance Dynamics Chart */}
      {analytics && chartPoints.length > 0 && (
        <Card className="p-6" aria-labelledby="driver-chart-heading">
          <h2 id="driver-chart-heading" className="text-lg font-semibold mb-2">
            {t("profile.chartTitle")}
          </h2>
          <figure aria-labelledby="driver-chart-heading">
            <ChartContainer>
              <BarChart
                data={chartPoints}
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
                <Bar
                  dataKey="value"
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={false}
                  maxBarSize={48}
                >
                  {chartPoints.map((entry) => (
                    <Cell
                      key={`driver-cell-${entry.date}`}
                      fill={
                        entry.value === maxChartValue && maxChartValue > 0
                          ? "var(--focus)"
                          : "var(--chart)"
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>

            <figcaption className="chart-table-caption mt-4">
              <Table>
                <caption>
                  {t("profile.chartTitle")} ({analytics.reportingTimezone})
                </caption>
                <thead>
                  <tr>
                    <th scope="col">{t("profile.dateCol")}</th>
                    <th scope="col">{t("profile.distanceCol")}</th>
                    <th scope="col">{t("profile.acceptedTrips")}</th>
                  </tr>
                </thead>
                <tbody>
                  {chartPoints.map((p) => (
                    <tr key={p.date}>
                      <th scope="row">{p.date}</th>
                      <td>{formatQuantity(p.exactDistance, "km", locale)}</td>
                      <td>{formatDecimal(String(p.trips), locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </figcaption>
          </figure>
        </Card>
      )}

      {/* History of Accepted Trips Table */}
      <Card className="p-6">
        <div className="section-heading mb-4">
          <div>
            <h2 className="text-lg font-semibold">{t("profile.tripsTitle")}</h2>
            <p className="muted text-sm">{t("profile.tripsHelp")}</p>
          </div>
        </div>

        {tripsQuery.isLoading && <p className="muted py-4 text-center">{t("states.loading")}</p>}

        {!tripsQuery.isLoading && (tripsQuery.data?.items.length ?? 0) === 0 && (
          <p className="muted py-6 text-center">{t("profile.noTrips")}</p>
        )}

        {!tripsQuery.isLoading && (tripsQuery.data?.items.length ?? 0) > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <th scope="col">{t("profile.gameCol")}</th>
                  <th scope="col">{t("profile.dateCol")}</th>
                  <th scope="col">{t("profile.distanceCol")}</th>
                  <th scope="col">{t("profile.cargoCol")}</th>
                  <th scope="col">{t("profile.detailsCol")}</th>
                </tr>
              </thead>
              <tbody>
                {tripsQuery.data?.items.map((trip) => (
                  <tr key={trip.id}>
                    <td>
                      <Badge className="text-xs uppercase">{trip.game}</Badge>
                    </td>
                    <td>{formatUtc(trip.reportingAt, locale, displayTimezone)}</td>
                    <td>{formatQuantity(trip.actualDistanceM, "km", locale)}</td>
                    <td>{trip.cargo ? trip.cargo.label : "—"}</td>
                    <td>
                      <Button asChild variant="outline" className="text-xs py-1 px-3">
                        <Link to={`/account/trips/${trip.id}`}>{t("profile.viewTrip")}</Link>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
