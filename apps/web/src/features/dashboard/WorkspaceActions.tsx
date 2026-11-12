import { useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { useWorkspaceSummary } from "../../app/workspace-summary.js";
import { formatUtc, type Locale } from "../../shared/formatting.js";
import { Card } from "../../shared/ui/primitives.js";
import { KeepFocusButton } from "../events/components.js";
import { eventTime } from "../events/model.js";
import { useBlockRetry } from "./blocks.js";

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
  const sections = [
    {
      key: "fixes",
      capability: "trips.read_own_private",
      count: fixes?.count,
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
    {
      key: "drafts",
      capability: "trips.submit_own",
      count: drafts?.count,
      destination: "/account/reports?state=editing",
      preview: drafts?.items.map(({ draftId, updatedAt }) => (
        <li key={draftId}>
          <Link to={`/account/reports/drafts/${draftId}`}>
            {t("actions.continueDraft", { date: formatUtc(updatedAt, locale, timezone) })}
          </Link>
        </li>
      )),
    },
    {
      key: "events",
      capability: "events.respond",
      count: events?.count,
      preview: events?.items.map(({ eventId, title, startsAt }) => (
        <li key={eventId}>
          <Link to={`/account/events/${eventId}`}>{title}</Link>
          <time className="dashboard-muted" dateTime={startsAt}>
            {eventTime(startsAt, locale, timezone)}
          </time>
        </li>
      )),
    },
    {
      key: "review",
      capability: "trips.review",
      count: summary?.reviewQueue?.count,
      destination: "/account/review",
    },
    {
      key: "applications",
      capability: "applications.manage",
      count: summary?.newApplicationsCount,
      destination: "/account/admin/applications?status=submitted",
    },
  ].filter(({ capability }) => self?.capabilities.includes(capability));
  const unavailable = sections.filter(({ count }) => count === undefined).length;
  const actionable = sections.filter(({ count }) => count !== undefined && count > 0);
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
          {actionable.map(({ key, count, destination, preview }) => {
            const label = t(`actions.${key}`, { total: number.format(count ?? 0) });
            return (
              <div className="dashboard-action-group" key={key}>
                <h3>{destination ? <Link to={destination}>{label}</Link> : label}</h3>
                {!!preview?.length && <ul>{preview}</ul>}
              </div>
            );
          })}
          {unavailable > 0 ? (
            <p className="dashboard-muted">
              {t(unavailable === sections.length ? "actions.unavailable" : "actions.partial")}
            </p>
          ) : actionable.length === 0 ? (
            <p className="dashboard-muted">{t("actions.empty")}</p>
          ) : null}
        </>
      )}
    </Card>
  );
}
