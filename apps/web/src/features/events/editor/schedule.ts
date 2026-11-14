import {
  composeTime,
  decodeIncomplete,
  emptyTime,
  incompleteValue,
  isIsoDate,
  splitTime,
  type TimeParts,
} from "../../../shared/ui/date-time.js";
import { utcInput } from "../model.js";
import type { EditorForm } from "./model.js";

// Stage 2 schedule values are stored as UTC wall clocks and shown in Moscow time. The shared
// date and time fields hand over "YYYY-MM-DD" / "HH:mm[:ss[.SSS]]" values, "" or an
// incomplete-entry marker; an incomplete part is kept in the form value as a marker, which the
// editor's validation rejects as an invalid time instead of dropping it.

export const scheduleFields = ["meetingAt", "startsAt", "endsAt"] as const;
export type ScheduleField = (typeof scheduleFields)[number];
export type Schedule = Pick<EditorForm, ScheduleField>;
export const moscowOffsetMs = 3 * 60 * 60 * 1000;

export function shiftWallTime(value: string, offset: number) {
  const iso = utcInput(value);
  if (!iso || !Number.isFinite(offset)) return "";
  const shifted = new Date(Date.parse(iso) + offset).toISOString().slice(0, -1);
  if (!utcInput(shifted)) return "";
  return shifted.replace(/:00\.000$/, "").replace(/\.000$/, "");
}

/** The date field value of a typed date: "", "YYYY-MM-DD" or the field's own marker. */
function dateValue(raw: string) {
  return !raw || isIsoDate(raw) ? raw : incompleteValue(raw, emptyTime);
}
function timeValue(parts: TimeParts) {
  if (Object.values(parts).every((part) => !part)) return "";
  return composeTime(parts, "millisecond") ?? incompleteValue("", parts);
}

/** A stored schedule value as the Moscow date and time field values. */
export function toMoscow(value: string): { date: string; time: string } {
  if (!value) return { date: "", time: "" };
  const incomplete = decodeIncomplete(value);
  if (incomplete) {
    const { date, ...time } = incomplete;
    return { date: dateValue(date), time: timeValue(time) };
  }
  const local = shiftWallTime(value, moscowOffsetMs);
  return local ? { date: local.slice(0, 10), time: local.slice(11) } : { date: "", time: "" };
}

/**
 * The stored value for Moscow date and time field values. A complete pair is a UTC wall clock;
 * no time with a complete or empty date is empty; anything else keeps its parts in a marker.
 */
export function fromMoscow(date: string, time: string): string {
  const incompleteTime = decodeIncomplete(time);
  if (!time && (!date || isIsoDate(date))) return "";
  if (isIsoDate(date) && !incompleteTime) {
    const value = shiftWallTime(`${date}T${time}`, -moscowOffsetMs);
    if (value) return value;
  }
  const parts = incompleteTime ?? { date: "", ...(splitTime(time) ?? emptyTime) };
  const { date: _, ...timeParts } = parts;
  return incompleteValue(decodeIncomplete(date)?.date ?? date, timeParts);
}

/**
 * Moves a date when the shared date changes from `previous` to `next`. `anchor` is the last
 * complete shared date. Dates on the previous shared date follow it, also while it is being typed;
 * other dates do not move while the shared date is incomplete. Once it is complete again, every
 * other complete date moves by the days from the anchor to the new date, so a complete change
 * shifts the whole schedule by the same number of days.
 */
export function moveDate(value: string, previous: string, next: string, anchor: string | null) {
  if (value === previous) return next;
  const from = isIsoDate(previous) ? previous : anchor;
  if (!from || !isIsoDate(from) || !isIsoDate(next) || !isIsoDate(value)) return value;
  const delta = Date.parse(next) - Date.parse(from);
  return shiftWallTime(`${value}T00:00`, delta).slice(0, 10) || value;
}

/**
 * The schedule after the shared date changes; values whose date does not move stay exact.
 * A fully cleared shared date clears the schedule.
 */
export function moveSchedule(
  form: Schedule,
  previous: string,
  next: string,
  anchor: string | null,
): Schedule {
  if (!next) return { meetingAt: "", startsAt: "", endsAt: "" };
  const moved = { ...form };
  for (const name of scheduleFields) {
    if (!form[name]) continue;
    const local = toMoscow(form[name]);
    const date = moveDate(local.date, previous, next, anchor);
    if (date !== local.date) moved[name] = fromMoscow(date, local.time);
  }
  return moved;
}
