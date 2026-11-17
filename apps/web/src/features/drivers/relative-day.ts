// Relative calendar days of the drivers directory and profile (VTC-160): "today", "yesterday",
// "3 days ago", then the plain date from a week on. Days are calendar days in the display
// timezone, so the boundaries never depend on the hour of the trip or on DST lengths.
import { formatUtc, type Locale } from "../../shared/formatting.js";
import { formatDay } from "../admin/members-model.js";

const DAY_MS = 86400000;
const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const localeTag = { ru: "ru-RU", en: "en-GB" } as const;
const dayFormats = new Map<string, Intl.DateTimeFormat>();

/** UTC midnight of the calendar day of `ms` in `timeZone`; null for an unknown timezone. */
function dayStart(ms: number, timeZone: string): number | null {
  let format = dayFormats.get(timeZone);
  if (!format) {
    try {
      format = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
    } catch {
      return null;
    }
    dayFormats.set(timeZone, format);
  }
  const parts = Object.fromEntries(format.formatToParts(ms).map((part) => [part.type, part.value]));
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
}

/**
 * Whole calendar days from the day of `iso` to the day of `nowMs`, both read in `timeZone`:
 * 0 today, 1 yesterday, negative in the future. Null for a malformed value or timezone.
 */
export function calendarDayDiff(iso: string, nowMs: number, timeZone: string): number | null {
  if (!isoPattern.test(iso) || !Number.isFinite(nowMs)) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  const day = dayStart(at, timeZone);
  const today = dayStart(nowMs, timeZone);
  if (day === null || today === null) return null;
  return Math.round((today - day) / DAY_MS);
}

export type RelativeDayView = { text: string; absolute: string };

/** A relative day with its absolute date and time; null for a malformed value or timezone. */
export function relativeDay(
  iso: string,
  nowMs: number,
  locale: Locale,
  timeZone: string,
): RelativeDayView | null {
  const diff = calendarDayDiff(iso, nowMs, timeZone);
  if (diff === null) return null;
  const absolute = formatUtc(iso, locale, timeZone);
  const tag = localeTag[locale];
  // A trip "in the future" (a skewed device clock) still reads as today.
  if (diff <= 1)
    return {
      text: new Intl.RelativeTimeFormat(tag, { numeric: "auto" }).format(
        diff === 1 ? -1 : 0,
        "day",
      ),
      absolute,
    };
  if (diff < 7)
    return {
      text: new Intl.RelativeTimeFormat(tag, { numeric: "always" }).format(-diff, "day"),
      absolute,
    };
  const day = formatDay(iso, locale, timeZone);
  return day ? { text: day, absolute } : null;
}
