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
  const started = useEventStarted(data?.event.startsAt ?? null);
  return { ...query, data, started };
}
