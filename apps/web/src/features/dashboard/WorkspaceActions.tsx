import { type ReactNode, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { paths } from "../../app/navigation-model.js";
import { useSession } from "../../app/Session.js";
import { useWorkspaceSummary } from "../../app/workspace-summary.js";
import { formatUtc, type Locale } from "../../shared/formatting.js";
import { Card } from "../../shared/ui/primitives.js";
import { KeepFocusButton } from "../events/components.js";
import { eventTime } from "../events/model.js";
import { useBlockRetry } from "./blocks.js";
import { type ActionKey, visibleActionSections } from "./view-model.js";

export function WorkspaceActions({ locale, timezone }: { locale: Locale; timezone: string }) {
  const { t } = useTranslation("dashboard");
  const { self } = useSession();
  const query = useWorkspaceSummary();
  const heading = useRef<HTMLHeadingElement>(null);
  const { retrying, retry } = useBlockRetry({
    ...query,
    refetch: () => query.refetch({ cancelRefetch: false }),
  });
  const id = useId();
  const summary = query.data;
  const fixes = summary?.tripsNeedingFixes;
  const drafts = summary?.unfinishedManualDrafts;
  const events = summary?.unansweredUpcomingEvents;
  const details: Record<ActionKey, { destination?: string; preview?: ReactNode[] | undefined }> = {
    fixes: {
      preview: fixes?.items.map(({ tripId, latestReturnReason }, index, items) => {
        const reasonId = `${id}-reason-${index}`;
        return (
          <li key={tripId}>
            <Link
              to={`/account/trips/${tripId}`}
              aria-describedby={latestReturnReason ? reasonId : undefined}
            >
              {items.length === 1
                ? t("actions.openTrip")
                : t("actions.openTripPreview", { position: index + 1, total: items.length })}
            </Link>
            {latestReturnReason && (
              <p id={reasonId} className="dashboard-muted dashboard-action-reason">
                {latestReturnReason}
              </p>
            )}
          </li>
        );
      }),
    },
    drafts: {
      destination: "/account/reports?state=editing",
      preview: drafts?.items.map(({ draftId, updatedAt }) => (
        <li key={draftId}>
          <Link to={`/account/reports/drafts/${draftId}`}>
            {t("actions.continueDraft", { date: formatUtc(updatedAt, locale, timezone) })}
          </Link>
        </li>
      )),
    },
    events: {
      preview: events?.items.map(({ eventId, title, startsAt }) => (
        <li key={eventId}>
          <Link to={`/account/events/${eventId}`}>{title}</Link>
          <time className="dashboard-muted" dateTime={startsAt}>
            {eventTime(startsAt, locale, timezone)}
          </time>
        </li>
      )),
    },
    review: { destination: "/account/review" },
    applications: { destination: "/account/admin/applications?status=submitted" },
    promotions: {
      destination:
        summary?.promotionsReady?.ats && !summary.promotionsReady.ets2
          ? `${paths.promotions}?game=ats`
          : paths.promotions,
    },
  };
  // "Unavailable" is only a failed load; an omitted count is not mentioned at all.
  const actionable = summary ? visibleActionSections(summary, self?.capabilities ?? []) : [];
  const number = new Intl.NumberFormat(locale);

  return (
    <Card className="dashboard-side-card dashboard-actions" aria-labelledby={id}>
      <div className="dashboard-card-head">
        <h2 ref={heading} id={id} tabIndex={-1}>
          {t("actions.title")}
        </h2>
      </div>
      {query.isPending && !retrying && (
        <p className="dashboard-muted" role="status">
          {t("actions.loading")}
        </p>
      )}
      {(query.isError || retrying) && (
        <div className="stack">
          <p className="dashboard-muted" role="alert">
            {t("actions.error")}
          </p>
          <KeepFocusButton
            type="button"
            variant="outline"
            size="sm"
            aria-disabled={query.isFetching}
            focusTarget={() => heading.current?.focus()}
            onClick={() => {
              if (!query.isFetching) retry();
            }}
          >
            {t("states.retry")}
          </KeepFocusButton>
        </div>
      )}
      {summary && (
        <>
          {actionable.map(({ key, count }) => {
            const { destination, preview } = details[key];
            const label = t(`actions.${key}`, { total: number.format(count) });
            return (
              <div className="dashboard-action-group" key={key}>
                <h3>{destination ? <Link to={destination}>{label}</Link> : label}</h3>
                {!!preview?.length && <ul>{preview}</ul>}
              </div>
            );
          })}
          {actionable.length === 0 && <p className="dashboard-muted">{t("actions.empty")}</p>}
        </>
      )}
    </Card>
  );
}
