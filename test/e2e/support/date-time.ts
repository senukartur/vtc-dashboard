import type { Locator, Page } from "@playwright/test";
import { expect } from "./fixtures.ts";

type Scope = Page | Locator;
type Segment = "hours" | "minutes" | "seconds" | "milliseconds";
const segmentNames: Record<Segment, RegExp> = {
  hours: /^(Hours|Часы)$/,
  minutes: /^(Minutes|Минуты)$/,
  seconds: /^(Seconds|Секунды)$/,
  milliseconds: /^(Milliseconds|Миллисекунды)$/,
};

// The date input placeholder follows the interface language the field parses with.
async function inputLocale(input: Locator) {
  return (await input.getAttribute("placeholder"))?.startsWith("дд") ? "ru" : "en";
}
export function dateText(iso: string, locale: "ru" | "en") {
  const [year, month, day] = iso.split("-");
  return locale === "ru" ? `${day}.${month}.${year}` : `${month}/${day}/${year}`;
}

/** The shared date and time field whose typed date input is labelled `label`. */
export function dateTimeField(scope: Scope, label: string) {
  // Labels with a hidden required marker match by accessible name, not by label text.
  const date = scope
    .getByLabel(label, { exact: true })
    .or(scope.getByRole("textbox", { name: label, exact: true }));
  const field = date.locator(
    "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' date-time-field ')][1]",
  );
  return {
    date,
    field,
    calendarButton: field.getByRole("button", { name: /^(Choose date|Выбрать дату): / }),
    time: field.getByRole("group", { name: /^(Time|Время), / }),
    segment: (name: Segment) => field.getByRole("spinbutton", { name: segmentNames[name] }),
  };
}

function wallClock(value: string) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{3}))?)?$/.exec(value);
  if (!match) throw new Error("INVALID_WALL_CLOCK_FIXTURE");
  const [, date = "", hours = "", minutes = "", seconds, milliseconds] = match;
  return { date, hours, minutes, seconds, milliseconds };
}

/**
 * Types a wall-clock value ("YYYY-MM-DDTHH:mm[:ss[.SSS]]", or "" to clear) like a user: the date
 * in the interface language's format, then each time segment.
 */
export async function fillDateTime(scope: Scope, label: string, value: string) {
  const control = dateTimeField(scope, label);
  if (!value) {
    await control.date.fill("");
    for (const name of Object.keys(segmentNames) as Segment[])
      for (const segment of await control.segment(name).all()) await segment.fill("");
    return;
  }
  const parts = wallClock(value);
  await control.date.fill(dateText(parts.date, await inputLocale(control.date)));
  await control.segment("hours").fill(parts.hours);
  await control.segment("minutes").fill(parts.minutes);
  if (parts.seconds !== undefined) await control.segment("seconds").fill(parts.seconds);
  if (parts.milliseconds !== undefined)
    await control.segment("milliseconds").fill(parts.milliseconds);
}

/** Asserts the displayed date and time segments of a wall-clock value. */
export async function expectDateTime(scope: Scope, label: string, value: string) {
  const control = dateTimeField(scope, label);
  if (!value) {
    await expect(control.date).toHaveValue("");
    await expect(control.segment("hours")).toHaveValue("");
    await expect(control.segment("minutes")).toHaveValue("");
    return;
  }
  const parts = wallClock(value);
  await expect(control.date).toHaveValue(dateText(parts.date, await inputLocale(control.date)));
  await expect(control.segment("hours")).toHaveValue(parts.hours);
  await expect(control.segment("minutes")).toHaveValue(parts.minutes);
  if (parts.seconds !== undefined)
    await expect(control.segment("seconds")).toHaveValue(parts.seconds);
  if (parts.milliseconds !== undefined)
    await expect(control.segment("milliseconds")).toHaveValue(parts.milliseconds);
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The time-only shared field named `field` (its group is "Time, {field}"). */
export function timeField(scope: Scope, field: string) {
  const time = scope.getByRole("group", { name: new RegExp(`^(Time|Время), ${escaped(field)}$`) });
  return {
    time,
    segment: (name: Segment) => time.getByRole("spinbutton", { name: segmentNames[name] }),
  };
}

/** Types "HH:mm" into a time-only field segment by segment. */
export async function fillTime(scope: Scope, field: string, value: string) {
  const [hours = "", minutes = ""] = value.split(":");
  const control = timeField(scope, field);
  await control.segment("hours").fill(hours);
  await control.segment("minutes").fill(minutes);
}

/** Types a "YYYY-MM-DD" date into a date-only field in the interface language's format. */
export async function fillDate(scope: Scope, label: string, iso: string) {
  const input = scope.getByRole("textbox", { name: label, exact: true });
  await input.fill(iso ? dateText(iso, await inputLocale(input)) : "");
}
