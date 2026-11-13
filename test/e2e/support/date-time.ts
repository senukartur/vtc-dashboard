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

const pageOf = (scope: Scope): Page => ("page" in scope ? scope.page() : scope);
async function interfaceLocale(scope: Scope) {
  return (await pageOf(scope).locator("html").getAttribute("lang")) === "ru" ? "ru" : "en";
}
export function dateText(iso: string, locale: "ru" | "en") {
  const [year, month, day] = iso.split("-");
  return locale === "ru" ? `${day}.${month}.${year}` : `${month}/${day}/${year}`;
}

/** The shared date and time field whose typed date input is labelled `label`. */
export function dateTimeField(scope: Scope, label: string) {
  const date = scope.getByLabel(label, { exact: true });
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
  await control.date.fill(dateText(parts.date, await interfaceLocale(scope)));
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
  await expect(control.date).toHaveValue(dateText(parts.date, await interfaceLocale(scope)));
  await expect(control.segment("hours")).toHaveValue(parts.hours);
  await expect(control.segment("minutes")).toHaveValue(parts.minutes);
  if (parts.seconds !== undefined)
    await expect(control.segment("seconds")).toHaveValue(parts.seconds);
  if (parts.milliseconds !== undefined)
    await expect(control.segment("milliseconds")).toHaveValue(parts.milliseconds);
}
