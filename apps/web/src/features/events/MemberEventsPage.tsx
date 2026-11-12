import { type ComponentProps, type ReactNode, useRef, useState } from "react";
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
import { isEventDraftsEnabled } from "./event-stage-2-mode.js";
import { periodFrom } from "./model.js";
import { useEventStage2Query } from "./stage-2-queries.js";
import { type EventStage2Locale, eventStage2Reads } from "./stage-2-transport.js";
import { timezoneLabel } from "./view-model.js";
import "./event-list.css";

const pageSize = 12;
type PageControls = {
  cursor: string | null;
  page: (next: string | null) => void;
  focusHeading: () => void;
};

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
  const canBrowseDrafts = canManage && isEventDraftsEnabled(session);
  const canRespond = self?.capabilities.includes("events.respond") === true;
  const requestedPeriod = search.get("period");
  const publishedPeriod = periodFrom(requestedPeriod);
  const isDrafts = canBrowseDrafts && requestedPeriod === "drafts";
  const period = isDrafts ? "drafts" : publishedPeriod;
  // Drop draft cursors when the draft view is unavailable. The API validates other cursors.
  const cursor = requestedPeriod === "drafts" && !isDrafts ? null : search.get("cursor");
  const member = useEventStage2Query(
    eventStage2Reads.memberList({
      limit: pageSize,
      locale,
      period: publishedPeriod,
      ...(cursor ? { cursor } : {}),
    }),
    canRead && !isDrafts,
  );
  const memberData = member.data?.data.data;
  const controls: PageControls = {
    cursor,
    focusHeading: () => heading.current?.focus(),
    page: (next) => setSearch(next ? { period, cursor: next } : { period }),
  };
  const options = [
    { value: "upcoming", label: t("upcoming") },
    { value: "past", label: t("past") },
    ...(canBrowseDrafts ? [{ value: "drafts", label: eventListCopy[locale].drafts }] : []),
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
          {isDrafts ? (
            <DraftEventsContent locale={locale} timezone={timezone} controls={controls} />
          ) : (
            <EventListResults
              query={member}
              controls={controls}
              nextCursor={memberData?.nextCursor}
            >
              {memberData &&
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
                ))}
            </EventListResults>
          )}
        </>
      ) : (
        <p>{t("forbidden")}</p>
      )}
    </div>
  );
}

function DraftEventsContent({
  locale,
  timezone,
  controls,
}: {
  locale: EventStage2Locale;
  timezone: string;
  controls: PageControls;
}) {
  const { self, generation } = useSession();
  const { cursor, focusHeading } = controls;
  const query = useEventStage2Query(
    eventStage2Reads.adminList({
      limit: pageSize,
      locale,
      period: "drafts",
      ...(cursor ? { cursor } : {}),
    }),
  );
  const data = query.data?.data.data;
  return (
    <EventListResults query={query} controls={controls} nextCursor={data?.nextCursor}>
      <Card className="events-list-card">
        <EventDraftList
          key={JSON.stringify([self?.member.id, generation, self?.identityEpoch, cursor])}
          rows={data?.items}
          timezone={timezone}
          focusHeading={focusHeading}
        />
      </Card>
    </EventListResults>
  );
}

function EventListResults({
  query,
  controls: { cursor, page, focusHeading },
  nextCursor,
  children,
}: {
  query: ComponentProps<typeof EventState>["query"];
  controls: PageControls;
  nextCursor: string | null | undefined;
  children: ReactNode;
}) {
  const { t } = useTranslation("events");
  return (
    <>
      <EventState
        query={query}
        focusTarget={focusHeading}
        {...(cursor ? { reset: () => page(null) } : {})}
      />
      {children}
      {nextCursor !== undefined && (cursor || nextCursor) && (
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
          {nextCursor && (
            <KeepFocusButton
              variant="outline"
              focusTarget={focusHeading}
              onClick={() => page(nextCursor)}
            >
              {t("next")}
            </KeepFocusButton>
          )}
        </nav>
      )}
    </>
  );
}
