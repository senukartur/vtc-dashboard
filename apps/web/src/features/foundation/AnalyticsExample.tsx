import { useTranslation } from "react-i18next";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import { chartGeometry, formatQuantity, formatUtc, type Locale } from "../../shared/formatting.js";
import { ChartContainer } from "../../shared/ui/chart.js";
import { Card, Table } from "../../shared/ui/primitives.js";
import type { FoundationMocks } from "./mocks.js";

export function AnalyticsExample({
  response,
  locale,
  displayTimezone,
}: {
  response: FoundationMocks["analytics"];
  locale: Locale;
  displayTimezone: string;
}) {
  const { t } = useTranslation("foundation");
  const data = response.data;
  const points = data.buckets.map((bucket) => ({
    date: bucket.date,
    value: chartGeometry(bucket.actualDistanceM),
  }));
  return (
    <Card className="analytics" aria-labelledby="chart-title">
      <h2 id="chart-title">{t("chart")}</h2>
      <p className="muted">{t("chartHelp")}</p>
      <p className="meta-line">
        {t("reporting")}: <strong>{data.reportingTimezone}</strong>
      </p>
      <figure aria-labelledby="chart-title">
        <ChartContainer>
          <BarChart
            data={points}
            accessibilityLayer={false}
            margin={{ left: 8, right: 8, top: 10 }}
          >
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--muted)" }}
            />
            <Bar
              dataKey="value"
              fill="var(--chart)"
              stroke="var(--focus)"
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
              maxBarSize={84}
            />
          </BarChart>
        </ChartContainer>
        <figcaption>
          <Table>
            <caption>
              {t("chart")} · {t("reporting")}: {data.reportingTimezone}
            </caption>
            <thead>
              <tr>
                <th scope="col">{t("day")}</th>
                <th scope="col">
                  {t("distance")} ({t("unitKm")})
                </th>
              </tr>
            </thead>
            <tbody>
              {data.buckets.map((bucket) => (
                <tr key={bucket.date}>
                  <th scope="row">{bucket.date}</th>
                  <td>{formatQuantity(bucket.actualDistanceM, "km", locale)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </figcaption>
      </figure>
      <p className="muted">
        {t("computed")}:{" "}
        <time dateTime={data.computedAt}>
          {formatUtc(data.computedAt, locale, displayTimezone)}
        </time>{" "}
        ({displayTimezone})
      </p>
    </Card>
  );
}
