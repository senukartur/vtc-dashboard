// Pure date/time text helpers for the shared date and time field. Values are wall-clock strings
// ("YYYY-MM-DDTHH:mm[:ss[.SSS]]"); converting them to instants stays in each form.

export type DateLocale = "ru" | "en";
export type Precision = "minute" | "second" | "millisecond";
export type Segment = "hours" | "minutes" | "seconds" | "milliseconds";
export type TimeParts = Record<Segment, string>;

export const emptyTime: TimeParts = { hours: "", minutes: "", seconds: "", milliseconds: "" };
export const segmentSpec: Record<Segment, { max: number; length: number }> = {
  hours: { max: 23, length: 2 },
  minutes: { max: 59, length: 2 },
  seconds: { max: 59, length: 2 },
  milliseconds: { max: 999, length: 3 },
};
export function segmentsFor(precision: Precision): Segment[] {
  if (precision === "minute") return ["hours", "minutes"];
  if (precision === "second") return ["hours", "minutes", "seconds"];
  return ["hours", "minutes", "seconds", "milliseconds"];
}

const pad = (value: number, length: number) => String(value).padStart(length, "0");

/** A real calendar date as "YYYY-MM-DD" (year 0001-9999), otherwise undefined. */
export function isoDate(year: number, month: number, day: number): string | undefined {
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const iso = `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
  const time = Date.parse(`${iso}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().startsWith(iso) ? iso : undefined;
}

/**
 * Typed dates follow the interface language: RU day.month.year, EN month/day/year. Either
 * separator style (".", "/", "-") and an eight-digit form are accepted; the year has 4 digits.
 */
export function parseDateText(text: string, locale: DateLocale): string | undefined {
  const clean = text.trim();
  const separated = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(clean);
  const digits = /^(\d{2})(\d{2})(\d{4})$/.exec(clean);
  const match = separated ?? digits;
  if (!match) return undefined;
  const [first, second, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return locale === "ru" ? isoDate(year, second, first) : isoDate(year, first, second);
}

export function formatDateText(iso: string, locale: DateLocale): string {
  const [year, month, day] = iso.split("-");
  return locale === "ru" ? `${day}.${month}.${year}` : `${month}/${day}/${year}`;
}

/** Splits a wall-clock value; a fraction is read as a fraction (".12" is 120 ms). */
export function splitWallClock(value: string): ({ date: string } & TimeParts) | undefined {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
  if (!match) return undefined;
  const [, date = "", hours = "", minutes = "", seconds = "", fraction] = match;
  return { date, hours, minutes, seconds, milliseconds: fraction ? fraction.padEnd(3, "0") : "" };
}

/** A real calendar date already in "YYYY-MM-DD" form. */
export function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return !!match && isoDate(Number(match[1]), Number(match[2]), Number(match[3])) === value;
}

/** Splits a time of day "HH:mm[:ss[.SSS]]" into segments. */
export function splitTime(value: string): TimeParts | undefined {
  const split = splitWallClock(`2000-01-01T${value}`);
  if (!split) return undefined;
  const { date: _, ...parts } = split;
  return parts;
}

/** Builds a time of day "HH:mm[:ss[.SSS]]" with the same rules as `composeWallClock`. */
export function composeTime(parts: TimeParts, precision: Precision): string | undefined {
  return composeWallClock({ ...parts, date: "2000-01-01" }, precision)?.slice(11);
}

function segmentValue(text: string, segment: Segment): number | undefined {
  if (!/^\d+$/.test(text) || text.length > segmentSpec[segment].length) return undefined;
  const value = Number(text);
  return value <= segmentSpec[segment].max ? value : undefined;
}

/**
 * Builds the wall-clock string. Hours and minutes are required; seconds and milliseconds are
 * added only when entered and when the precision includes them.
 */
export function composeWallClock(
  parts: { date: string } & TimeParts,
  precision: Precision,
): string | undefined {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(parts.date);
  if (!date || isoDate(Number(date[1]), Number(date[2]), Number(date[3])) !== parts.date)
    return undefined;
  const hours = segmentValue(parts.hours, "hours");
  const minutes = segmentValue(parts.minutes, "minutes");
  if (hours === undefined || minutes === undefined) return undefined;
  let value = `${parts.date}T${pad(hours, 2)}:${pad(minutes, 2)}`;
  if (precision === "minute") return value;
  const withMs = precision === "millisecond" && parts.milliseconds !== "";
  if (parts.seconds === "" && !withMs) return value;
  const seconds = parts.seconds === "" ? 0 : segmentValue(parts.seconds, "seconds");
  if (seconds === undefined) return undefined;
  value += `:${pad(seconds, 2)}`;
  if (!withMs) return value;
  const milliseconds = segmentValue(parts.milliseconds, "milliseconds");
  return milliseconds === undefined ? undefined : `${value}.${pad(milliseconds, 3)}`;
}

const markerPrefix = "invalid:";
/**
 * Incomplete or unparsable entry. It is non-empty and never matches a wall-clock pattern, so each
 * form's existing conversion rejects it and shows its own invalid-time error.
 */
export function incompleteValue(rawDate: string, time: TimeParts): string {
  return `${markerPrefix}${JSON.stringify([
    rawDate,
    time.hours,
    time.minutes,
    time.seconds,
    time.milliseconds,
  ])}`;
}
export function decodeIncomplete(value: string): ({ date: string } & TimeParts) | undefined {
  if (!value.startsWith(markerPrefix)) return undefined;
  try {
    const parts: unknown = JSON.parse(value.slice(markerPrefix.length));
    if (!Array.isArray(parts) || parts.length !== 5 || parts.some((p) => typeof p !== "string"))
      return undefined;
    const [date, hours, minutes, seconds, milliseconds] = parts as string[];
    return {
      date: date ?? "",
      hours: hours ?? "",
      minutes: minutes ?? "",
      seconds: seconds ?? "",
      milliseconds: milliseconds ?? "",
    };
  } catch {
    return undefined;
  }
}

/** Inclusive "YYYY-MM-DD" bounds. */
export function inDateRange(iso: string, min?: string, max?: string): boolean {
  return (!min || iso >= min) && (!max || iso <= max);
}

/** The calendar date at `now` in an explicit IANA time zone. */
export function todayIn(timeZone: string, now: number): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      calendar: "iso8601",
      numberingSystem: "latn",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(now)
      .map(({ type, value }) => [type, value]),
  );
  return `${String(parts.year).padStart(4, "0")}-${parts.month}-${parts.day}`;
}

/** Whether a segment text can take no further digit (full length, or any next digit overflows). */
export function segmentComplete(text: string, segment: Segment): boolean {
  const { max, length } = segmentSpec[segment];
  return text.length >= length || (text !== "" && Number(text) * 10 > max);
}

/**
 * One typed digit. A digit continues an incomplete segment when the result stays in range,
 * otherwise it starts the segment again. A first digit that cannot be followed (hours 3-9,
 * minutes 6-9) completes the segment with a leading zero.
 */
export function typeDigit(
  buffer: string,
  digit: string,
  segment: Segment,
): { text: string; complete: boolean } {
  const { max, length } = segmentSpec[segment];
  const start = (): { text: string; complete: boolean } =>
    segmentComplete(digit, segment)
      ? { text: digit.padStart(length, "0"), complete: true }
      : { text: digit, complete: false };
  if (buffer === "" || segmentComplete(buffer, segment)) return start();
  const candidate = buffer + digit;
  if (Number(candidate) > max) return start();
  return segmentComplete(candidate, segment)
    ? { text: candidate.padStart(length, "0"), complete: true }
    : { text: candidate, complete: false };
}

/** Feeds a digit string into a segment, starting from `buffer`. */
export function typeDigits(
  buffer: string,
  digits: string,
  segment: Segment,
): { text: string; complete: boolean } {
  let state = { text: buffer, complete: segmentComplete(buffer, segment) };
  for (const digit of digits) state = typeDigit(state.text, digit, segment);
  return state;
}

/**
 * Applies a browser edit of a segment. `literal` edits (deletion, undo) keep the remaining digits
 * as they are. Typing continues an unfinished `before`; any other insertion, including typing over
 * a selected filled segment, starts again as if the segment were empty.
 */
export function editSegment(
  before: string,
  raw: string,
  literal: boolean,
  segment: Segment,
): { text: string; complete: boolean } {
  const digits = raw.replace(/\D/g, "");
  if (literal) return { text: digits.slice(0, segmentSpec[segment].length), complete: false };
  const continues =
    before.length < segmentSpec[segment].length &&
    digits.length > before.length &&
    digits.startsWith(before);
  return continues
    ? typeDigits(before, digits.slice(before.length), segment)
    : typeDigits("", digits, segment);
}

/** Arrow-key step with wrap-around; an empty segment starts at 0 (up) or the maximum (down). */
export function stepSegment(text: string, delta: 1 | -1, segment: Segment): string {
  const { max, length } = segmentSpec[segment];
  const current = segmentValue(text, segment);
  const next =
    current === undefined ? (delta > 0 ? 0 : max) : (current + delta + max + 1) % (max + 1);
  return pad(next, length);
}

/** Pads a finished segment to its full width ("1" hour is "01", "12" ms is "012"). */
export function clampSegment(text: string, segment: Segment): string {
  const value = segmentValue(text, segment);
  return value === undefined ? text : pad(value, segmentSpec[segment].length);
}
