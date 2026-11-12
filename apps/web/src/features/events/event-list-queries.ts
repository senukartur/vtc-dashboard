import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useEventStarted } from "./components.js";
import { useEventStage2Query } from "./stage-2-queries.js";
import { type EventStage2Locale, eventStage2Reads } from "./stage-2-transport.js";

export function useEventListLocale(): EventStage2Locale {
  const { i18n } = useTranslation("events");
  return i18n.resolvedLanguage === "en" ? "en" : "ru";
}

/** The header and overview observe the same scoped and localized nearest-event read. */
export function useUpcomingEventCard(enabled = true) {
  const locale = useEventListLocale();
  const query = useEventStage2Query(eventStage2Reads.upcoming(locale), enabled);
  const data = query.data?.data.data;
  const startsAt = data?.event.startsAt ?? null;
  const eventId = data?.event.id;
  const started = useEventStarted(startsAt);
  const { refetch } = query;

  // Each enabled observer can reach the cutoff; TanStack shares the in-flight request.
  // The effect only repeats when the event/start or its scoped query changes.
  useEffect(() => {
    if (enabled && started && eventId && startsAt) void refetch({ cancelRefetch: false });
  }, [enabled, eventId, refetch, started, startsAt]);

  return { ...query, data, started };
}
