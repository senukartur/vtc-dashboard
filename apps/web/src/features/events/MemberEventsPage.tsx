import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { useSession } from "../../app/Session.js";
import { Button, Card } from "../../shared/ui/primitives.js";
import { SegmentedControl } from "../../shared/ui/segmented-control.js";
import { EventState, KeepFocusButton, useEventTimezone } from "./components.js";
import { EventDraftList } from "./EventDraftList.js";
import { EventListCard } from "./EventListCard.js";
import { eventListCopy } from "./event-list-copy.js";
import { useEventListLocale } from "./event-list-queries.js";
import { periodFrom } from "./model.js";
import { useEventStage2Query } from "./stage-2-queries.js";
import { eventStage2Reads } from "./stage-2-transport.js";
import { timezoneLabel } from "./view-model.js";
import "./event-list.css";

export function MemberEventsPage() {
  const { t } = useTranslation("events");
  const locale = useEventListLocale();
  const session = useSession();
  const self = session.self;
  const [search, setSearch] = useSearchParams();
  const timezone = useEventTimezone();
  const [now] = useState(Date.now);
  const heading = useRef<HTMLHeadingElement>(null);
  const canRead = self?.capabilities.includes("company.read") === true;
  const canManage = self?.capabilities.includes("events.manage") === true;
  const canRespond = self?.capabilities.includes("events.respond") === true;
  const requestedPeriod = search.get("period");
  const publishedPeriod = periodFrom(requestedPeriod);
  const isDrafts = canManage && requestedPeriod === "drafts";
  const period = isDrafts ? "drafts" : publishedPeriod;
  // Discard cursors from a draft view after a privilege change. Otherwise the API owns cursor
  // validation, so expired or malformed bookmarks retain the first-page recovery action.
  const cursor = requestedPeriod === "drafts" && !isDrafts ? null : search.get("cursor");
  const filter = { limit: 12, locale, ...(cursor ? { cursor } : {}) };
  const member = useEventStage2Query(
    eventStage2Reads.memberList({ ...filter, period: publishedPeriod }),
    canRead && !isDrafts,
  );
  const admin = useEventStage2Query(
    eventStage2Reads.adminList({ ...filter, period: "drafts" }),
    canRead && isDrafts,
  );
  const memberData = member.data?.data.data;
  const draftData = admin.data?.data.data;
  const data = isDrafts ? draftData : memberData;
  const focusHeading = () => heading.current?.focus();
  const page = (next: string | null) => setSearch(next ? { period, cursor: next } : { period });
  const options = [
    { value: "upcoming", label: t("upcoming") },
    { value: "past", label: t("past") },
    ...(canManage ? [{ value: "drafts", label: eventListCopy[locale].drafts }] : []),
  ];

  return (
    <div className="events-page stack">
      <header className="events-heading">
        <div className="events-heading-text">
          <h1 ref={heading} tabIndex={-1}>
            {t("title")}
          </h1>
          <p className="muted">{t("timezoneNote", { zone: timezoneLabel(timezone, now) })}</p>
        </div>
        {canRead && canManage && (
          <Button asChild>
            <Link to="/account/events/new">{t("create")}</Link>
          </Button>
        )}
      </header>
      {canRead ? (
        <>
          <SegmentedControl
            aria-label={t("period")}
            size="sm"
            value={period}
            onValueChange={(next) => setSearch({ period: next })}
            options={options}
          />
          <EventState
            query={isDrafts ? admin : member}
            focusTarget={focusHeading}
            {...(cursor ? { reset: () => page(null) } : {})}
          />
          {isDrafts ? (
            <Card className="events-list-card">
              <EventDraftList
                key={JSON.stringify([
                  self?.member.id,
                  session.generation,
                  self?.identityEpoch,
                  cursor,
                ])}
                rows={draftData?.items}
                timezone={timezone}
                focusHeading={focusHeading}
              />
            </Card>
          ) : (
            memberData &&
            (memberData.items.length ? (
              <ul className="events-list event-card-list">
                {memberData.items.map((row) => (
                  <EventListCard
                    key={row.event.id}
                    row={row}
                    timezone={timezone}
                    canRespond={canRespond}
                  />
                ))}
              </ul>
            ) : (
              <Card>
                <p>{t("empty")}</p>
              </Card>
            ))
          )}
          {data && (cursor || data.nextCursor) && (
            <nav className="events-pager" aria-label={t("next")}>
              {cursor && (
                <KeepFocusButton
                  variant="outline"
                  focusTarget={focusHeading}
                  onClick={() => page(null)}
                >
                  {t("first")}
                </KeepFocusButton>
              )}
              {data.nextCursor && (
                <KeepFocusButton
                  variant="outline"
                  focusTarget={focusHeading}
                  onClick={() => page(data.nextCursor)}
                >
                  {t("next")}
                </KeepFocusButton>
              )}
            </nav>
          )}
        </>
      ) : (
        <p>{t("forbidden")}</p>
      )}
    </div>
  );
}
