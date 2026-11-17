// My overview blocks (VTC-159): the own month with its place and comparison, the start steps for a
// member without trips and the phone link to the company overview. Lists only, no tables.
import type { TFunction } from "i18next";
import { useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { formatDecimal, formatQuantity, type Locale } from "../../shared/formatting.js";
import { Button, Card } from "../../shared/ui/primitives.js";
import { KeepFocusButton } from "../events/components.js";
import { useBlockRetry } from "./blocks.js";
import { Skeleton } from "./components.js";
import { type CalendarRange, inclusiveRangeLabel } from "./model.js";
import type { DTO } from "./transport.js";
import type { DeltaLine, PlaceView, QueryView } from "./view-model.js";
import "./dashboard.css";

type MemberAnalytics = DTO["Analytics"];

/** "320 km more than 1–17 October", or why there is no comparison. */
function monthDeltaText(
  line: Exclude<DeltaLine, null | "pending">,
  range: CalendarRange,
  locale: Locale,
  t: TFunction<"dashboard">,
) {
  const period = inclusiveRangeLabel(range, locale, "long");
  if (line.kind === "unavailable") return t("personal.unavailable");
  if (line.kind === "noBaseline") return t("personal.noBaseline", { range: period });
  if (line.kind === "same") return t("personal.same", { range: period });
  return t(line.kind === "up" ? "personal.more" : "personal.less", {
    distance: formatQuantity(line.difference, "km", locale),
    range: period,
  });
}

/**
 * "My November": the own accepted distance and trips of the reporting month, the place among
 * ranked members and the change against the same elapsed days of the previous month. A failed
 * read keeps the place and offers Retry; unavailable values are never shown as zero.
 */
export function MyMonthCard({
  query,
  delta,
  previousRange,
  place,
  month,
  locale,
  onRetry,
}: {
  query: QueryView<MemberAnalytics>;
  delta: DeltaLine;
  previousRange: CalendarRange | null;
  place: PlaceView;
  /** The month name in the interface language ("ноябрь", "November"). */
  month: string | undefined;
  locale: Locale;
  /** The page Retry: rereads a failed timezone first, then the month reads. */
  onRetry: () => void;
}) {
  const { t } = useTranslation("dashboard");
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const { retrying, retry } = useBlockRetry({ ...query, refetch: async () => onRetry() });
  const data = query.data;
  const failed = !data && (query.isError || retrying);
  const number = (value: number) => formatDecimal(String(value), locale);

  const placeValue =
    place.kind === "ranked"
      ? place.ranked === undefined
        ? number(place.position)
        : t("metrics.placeOf", { position: number(place.position), ranked: number(place.ranked) })
      : place.kind === "notRanked"
        ? t("metrics.notRanked")
        : place.kind === "unavailable"
          ? formatDecimal(null, locale)
          : undefined;

  return (
    <Card className="dashboard-month" aria-labelledby={headingId} aria-busy={!data && !failed}>
      <div className="dashboard-card-head">
        <h2 id={headingId} ref={heading} tabIndex={-1}>
          {month ? (
            t("personal.month", { month })
          ) : (
            <Skeleton className="dashboard-skeleton-inline" />
          )}
        </h2>
      </div>
      {failed && (
        <div className="dashboard-block-error">
          <p>{t("personal.monthError")}</p>
          <KeepFocusButton
            variant="outline"
            focusTarget={() => heading.current?.focus()}
            onClick={retry}
          >
            {t("personal.retry")}
          </KeepFocusButton>
        </div>
      )}
      <dl className="dashboard-month-stats">
        {!failed && (
          <>
            <div>
              <dt>{t("personal.distance")}</dt>
              <dd className="dashboard-month-value">
                {data ? formatQuantity(data.actualDistanceM, "km", locale) : <Skeleton />}
              </dd>
            </div>
            <div>
              <dt>{t("personal.trips")}</dt>
              <dd className="dashboard-month-value">
                {data ? number(data.acceptedTrips) : <Skeleton />}
              </dd>
            </div>
          </>
        )}
        <div>
          <dt>{t("personal.place")}</dt>
          <dd className="dashboard-month-value">
            {placeValue ?? <Skeleton />}{" "}
            <Link to="/account/company" className="dashboard-month-place-link">
              {t("personal.inCompany")}
            </Link>
          </dd>
        </div>
      </dl>
      {!failed &&
        previousRange &&
        (data && delta !== null && delta !== "pending" ? (
          <p className={`dashboard-month-delta dashboard-delta-${delta.kind}`}>
            {monthDeltaText(delta, previousRange, locale, t)}
          </p>
        ) : (
          <p className="dashboard-month-delta dashboard-kpi-delta-reserve" aria-hidden="true" />
        ))}
    </Card>
  );
}

/**
 * Shown instead of the statistics to a member who can submit trips and has none yet: connect
 * telemetry or send a manual report.
 */
export function StartStepsCard() {
  const { t } = useTranslation("dashboard");
  const headingId = useId();
  const steps = [
    {
      key: "telemetry",
      text: t("personal.stepTelemetry"),
      action: t("personal.stepTelemetryAction"),
      to: "/account/connections",
    },
    {
      key: "manual",
      text: t("personal.stepManual"),
      action: t("personal.stepManualAction"),
      to: "/account/reports/new",
    },
  ];
  return (
    <Card className="dashboard-start" aria-labelledby={headingId}>
      <div className="dashboard-card-head">
        <h2 id={headingId}>{t("personal.startTitle")}</h2>
      </div>
      <p className="dashboard-muted">{t("personal.startText")}</p>
      <ol className="dashboard-start-steps" aria-label={t("personal.startSteps")}>
        {steps.map((step, index) => (
          <li key={step.key}>
            <span className="dashboard-start-number" aria-hidden="true">
              {index + 1}
            </span>
            <span className="dashboard-start-text">{step.text}</span>
            <Button asChild variant={index === 0 ? "default" : "outline"} size="sm">
              <Link to={step.to}>{step.action}</Link>
            </Button>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/** Phone only (CSS): the way from My overview to the company statistics. */
export function CompanyLinkCard() {
  const { t } = useTranslation("dashboard");
  return (
    <Link to="/account/company" className="card dashboard-company-link">
      <span className="dashboard-company-link-title">{t("personal.companyLink")}</span>
      <span className="dashboard-muted"> · {t("personal.companyLinkSub")}</span>
      <span className="dashboard-company-link-arrow" aria-hidden="true">
        ›
      </span>
    </Link>
  );
}
