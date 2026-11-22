import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "../../app/Session.js";
import { queryString } from "../../shared/paging.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../../shared/ui/dialog.js";
import { InfoTip } from "../../shared/ui/info-tip.js";
import { Badge, Button } from "../../shared/ui/primitives.js";
import { SegmentedControl } from "../../shared/ui/segmented-control.js";
import { AccountFailure } from "../account/transport.js";
import { Failure } from "./components.js";
import { useTripCommand, useTripQuery } from "./queries.js";
import { useTripDisplay, useWhen } from "./TripPageSections.js";
import { type DTO, tripRead } from "./transport.js";
import {
  associationConsequence,
  eventCandidates,
  localDay,
  onTripDays,
  routeMatches,
  type TripTimes,
  tripDays,
} from "./trip-page-model.js";

type Event = DTO["EventPublic"];
type Batch = { items: Event[]; nextCursor: string | null; passedTripDay: boolean };
/** Where the next batch starts and whether an earlier batch already passed the last trip day. */
type BatchStart = { cursor: string | null; dayDone: boolean };

/** Pages of 100 read in one batch before the dialog asks to load more (500 events). */
const batchPages = 5;

/**
 * Past events from the given cursor, oldest first as the server lists them. A batch stops at the
 * end of the list or after `batchPages`; while the trip day scan is incomplete (`lastDay` set) it
 * also stops once a page passes the last trip day, since later events cannot start on it.
 */
async function readBatch(
  cursor: string | null,
  lastDay: string | null,
  timezone: string,
  signal: AbortSignal,
): Promise<Batch> {
  const items: Event[] = [];
  let next = cursor;
  for (let page = 0; page < batchPages; page++) {
    const read = await tripRead(
      `/events?${queryString({ period: "past", limit: 100, cursor: next })}`,
      "EnvelopeListEventPublic",
      signal,
    );
    const list = read.data.data;
    items.push(...list.items);
    next = list.nextCursor;
    const last = list.items.at(-1),
      day = last ? localDay(last.startsAt, timezone) : null;
    if (lastDay && day && day > lastDay) return { items, nextCursor: next, passedTripDay: true };
    if (!next) break;
  }
  return { items, nextCursor: next, passedTripDay: false };
}

/** Past events in bounded batches, keyed like the private trip reads plus game, days and zone. */
function useEventBatches(
  game: DTO["TripSummary"]["game"],
  days: string[] | null,
  timezone: string,
) {
  const session = useSession(),
    client = useQueryClient(),
    { i18n } = useTranslation(),
    lastDay = days?.at(-1) ?? null;
  const queryKey = [
    "trip-event-candidates",
    session.self?.member.id,
    session.generation,
    session.self?.identityEpoch,
    session.self?.capabilities.join(","),
    i18n.resolvedLanguage,
    game,
    days?.join(",") ?? "",
    timezone,
  ];
  const query = useInfiniteQuery({
    queryKey,
    meta: { private: true },
    retry: false,
    gcTime: 0,
    staleTime: 0,
    initialPageParam: { cursor: null, dayDone: false } as BatchStart,
    getNextPageParam: (last: Batch, all: Batch[]): BatchStart | null =>
      last.nextCursor
        ? { cursor: last.nextCursor, dayDone: all.some((batch) => batch.passedTripDay) }
        : null,
    queryFn: async ({ pageParam, signal }) => {
      try {
        // Once the trip day is covered, later batches (All past) read their full page budget.
        return await readBatch(
          pageParam.cursor,
          pageParam.dayDone ? null : lastDay,
          timezone,
          signal,
        );
      } catch (error) {
        if (error instanceof AccountFailure && !signal.aborted) {
          if (error.kind === "unauthorized") await session.confirmSessionLoss(signal);
          if (error.kind === "forbidden") {
            client.removeQueries({
              type: "inactive",
              predicate: (q) => q.meta?.private === true,
            });
            await session.refresh();
          }
        }
        throw error;
      }
    },
  });
  // A rejected (stale) cursor or any failure starts over from the first batch.
  const reset = () => void client.resetQueries({ queryKey, exact: true });
  return { query, reset };
}

/** The event route by catalog labels, else its free-text route. */
function eventRoute(event: Event) {
  return event.origin && event.destination
    ? `${event.origin.label} → ${event.destination.label}`
    : event.route;
}

/**
 * The owner links the trip to a past event of the same game: events of the trip day or all past
 * ones as native radio cards, the consequence of linking for this trip and the selected event's
 * attendance, and Link. The server decides; the page shows its confirmed result.
 */
export function TripEventDialog({
  open,
  onOpenChange,
  summary,
  times,
  etag,
  onDone,
  restoreFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summary: DTO["TripSummary"];
  times: TripTimes | null;
  etag: string | null;
  onDone: (result: "linked" | "sent") => void;
  /** The control that opened the dialog, focused again when it closes. */
  restoreFocus: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <EventDialogBody
          summary={summary}
          times={times}
          etag={etag}
          close={() => onOpenChange(false)}
          onDone={onDone}
          restoreFocus={restoreFocus}
        />
      )}
    </Dialog>
  );
}

function EventDialogBody({
  summary,
  times,
  etag,
  close,
  onDone,
  restoreFocus,
}: {
  summary: DTO["TripSummary"];
  times: TripTimes | null;
  etag: string | null;
  close: () => void;
  onDone: (result: "linked" | "sent") => void;
  restoreFocus: () => void;
}) {
  const { t } = useTranslation("trips"),
    { timezone } = useTripDisplay(),
    when = useWhen(),
    days = tripDays(times, timezone),
    [tab, setTab] = useState<"day" | "past">(days ? "day" : "past"),
    current = summary.event ?? null,
    [selected, setSelected] = useState<string | null>(current?.id ?? null),
    { query, reset } = useEventBatches(summary.game, days, timezone),
    member = useTripQuery(`/events/${selected}`, "EnvelopeEventMember", !!selected),
    command = useTripCommand();
  const batches = query.data?.pages ?? [],
    candidates = eventCandidates(
      batches.flatMap((batch) => batch.items),
      summary.game,
    ),
    visible =
      tab === "day" && days
        ? candidates.filter((event) => onTripDays(event, days, timezone))
        : candidates,
    dayComplete = batches.some((batch) => batch.passedTripDay) || !query.hasNextPage,
    // The tab's scan is complete: "none" is only claimed then, otherwise only the loaded part.
    complete = tab === "day" ? dayComplete : !query.hasNextPage,
    partial = !!query.data && !complete,
    shown = (id: string | undefined) => visible.some((event) => event.id === id),
    // The current and the selected event stay visible in every tab, so what Link submits is shown.
    showCurrent = !!current && !shown(current.id),
    pinned =
      selected && selected !== current?.id && !shown(selected)
        ? (candidates.find((event) => event.id === selected) ?? null)
        : null,
    selectedMember = member.data?.data.data.event.id === selected ? member.data.data.data : null,
    consequence = associationConsequence(summary.decision, selectedMember),
    decided = summary.decision === "accepted" || summary.decision === "rejected",
    route =
      summary.origin || summary.destination
        ? `${summary.origin?.label ?? t("unknown")} → ${summary.destination?.label ?? t("unknown")}`
        : null,
    span = [times?.startedAt, times?.completedAt]
      .filter((value): value is string => !!value)
      .map(when)
      .join("–"),
    description = [route, span, summary.game.toUpperCase()].filter(Boolean).join(" · "),
    name = `trip-event-${summary.id}`;
  const option = (id: string, body: ReactNode) => (
    <li key={id}>
      <label className="trip-event-option" data-selected={selected === id || undefined}>
        <input
          type="radio"
          name={name}
          value={id}
          checked={selected === id}
          onChange={() => setSelected(id)}
        />
        <span className="trip-event-option-body">{body}</span>
      </label>
    </li>
  );
  const card = (event: Event) =>
    option(
      event.id,
      <>
        <strong>{event.title}</strong>
        <span className="trip-muted">
          {when(event.startsAt)} · {eventRoute(event)}
        </span>
        {(event.id === current?.id || routeMatches(event, summary)) && (
          <span className="trip-event-badges">
            {routeMatches(event, summary) && <Badge tone="ok">{t("eventRouteMatches")}</Badge>}
            {event.id === current?.id && <Badge tone="info">{t("eventCurrent")}</Badge>}
          </span>
        )}
      </>,
    );
  // A hidden current event renders as a full card when it is among the loaded events.
  const currentLoaded = current ? candidates.find((event) => event.id === current.id) : undefined;
  return (
    <DialogContent
      className="trip-event-dialog"
      onEscapeKeyDown={(event) => {
        if (command.pending) event.preventDefault();
      }}
      onPointerDownOutside={(event) => {
        if (command.pending) event.preventDefault();
      }}
      onInteractOutside={(event) => {
        if (command.pending) event.preventDefault();
      }}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        restoreFocus();
      }}
    >
      <div className="trip-event-head">
        <div className="trip-event-heading">
          <DialogTitle>{t("eventDialogTitle")}</DialogTitle>
          <DialogDescription className="trip-muted">
            {description && <span>{description}</span>}
            <span>{t("timesIn", { timezone })}</span>
          </DialogDescription>
        </div>
        <DialogClose asChild>
          <Button
            type="button"
            variant="ghost"
            className="trip-event-close"
            aria-label={t("closeDialog")}
            disabled={command.pending}
          >
            <X size={16} strokeWidth={1.8} aria-hidden="true" focusable="false" />
          </Button>
        </DialogClose>
      </div>
      {days && (
        <SegmentedControl
          aria-label={t("eventTabsLabel")}
          value={tab}
          onValueChange={setTab}
          options={[
            { value: "day", label: t("eventTabDay") },
            { value: "past", label: t("eventTabPast") },
          ]}
        />
      )}
      {query.isPending ? (
        <p role="status">{t("loading")}</p>
      ) : (
        // The wrapper scrolls; a fieldset does not reliably shrink as a flex item.
        <div className="trip-event-options">
          <fieldset className="trip-event-fieldset">
            <legend className="visually-hidden">{t("eventId")}</legend>
            {(showCurrent || pinned || visible.length > 0) && (
              <ul>
                {showCurrent &&
                  current &&
                  (currentLoaded
                    ? card(currentLoaded)
                    : option(
                        current.id,
                        <>
                          <strong>{current.title}</strong>
                          <span className="trip-muted">{t("eventCurrent")}</span>
                        </>,
                      ))}
                {pinned && card(pinned)}
                {visible.map(card)}
              </ul>
            )}
            {query.data && !visible.length && (
              <p className="trip-muted">
                {t(
                  !complete
                    ? "eventEmptyLoaded"
                    : tab === "day"
                      ? "eventEmptyDay"
                      : "eventEmptyPast",
                )}
              </p>
            )}
          </fieldset>
        </div>
      )}
      {query.isError && (
        <div className="trip-event-state">
          <Failure error={query.error} />
          <Button type="button" variant="outline" onClick={reset}>
            {t("refresh")}
          </Button>
        </div>
      )}
      {partial && !query.isError && (
        <div className="trip-event-state">
          <span className="trip-muted">{t("eventPartial")}</span>
          <Button
            type="button"
            variant="outline"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {t("eventLoadMore")}
          </Button>
        </div>
      )}
      {selected && (
        <p className="trip-event-consequence">
          <span>
            {t(consequence.linkKey)}
            {consequence.attendanceKey && ` ${t(consequence.attendanceKey)}`}
          </span>
          <InfoTip label={t("eventHelpLabel")} title={t("eventHelpTitle")}>
            <p>{t("eventHelp")}</p>
          </InfoTip>
        </p>
      )}
      <Failure error={command.failure} seconds={command.seconds} />
      <div className="trip-event-actions">
        <DialogClose asChild>
          <Button type="button" variant="outline" disabled={command.pending}>
            {t("cancel")}
          </Button>
        </DialogClose>
        <Button
          type="button"
          disabled={!selected || command.pending || command.seconds > 0}
          onClick={async () => {
            if (!selected) return;
            const result = await command.run(
              `/trips/${summary.id}/event-association`,
              { eventId: selected },
              "EnvelopeCommandResult",
              etag,
            );
            if (!result) return;
            onDone(decided ? "sent" : "linked");
            close();
          }}
        >
          {t("eventLinkAction")}
        </Button>
      </div>
    </DialogContent>
  );
}
