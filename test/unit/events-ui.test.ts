import { expect, test } from "vitest";
import { timezoneOffset } from "../../apps/web/src/features/events/model.ts";
import { eventTranslations } from "../../apps/web/src/features/events/translations.ts";
import {
  compactTime,
  countsView,
  dateTile,
  eventPhase,
  memberLabel,
  responseChoiceKey,
  responseTone,
  showException,
  timezoneLabel,
} from "../../apps/web/src/features/events/view-model.ts";

const start = "2026-11-04T17:00:00.000Z";
const load = { prescribedCargoId: null, prescribedMassKg: null, prescribedTrailerTypeId: null };
const summary = {
  id: "e0581000-0000-4000-8000-000000000001",
  nickname: "Fictional_Driver",
  formerMember: false,
  roles: ["driver" as const],
};

test("responses close exactly at the start; cancellation and completion close them first", () => {
  const at = Date.parse(start);
  expect(eventPhase({ status: "scheduled", startsAt: start }, at - 1)).toBe("open");
  expect(eventPhase({ status: "scheduled", startsAt: start }, at)).toBe("started");
  expect(eventPhase({ status: "scheduled", startsAt: start }, at + 1)).toBe("started");
  expect(eventPhase({ status: "cancelled", startsAt: start }, at - 1)).toBe("cancelled");
  expect(eventPhase({ status: "completed", startsAt: start }, at - 1)).toBe("completed");
});

test("the date tile uses the display timezone across a day boundary and a DST change", () => {
  // 22:30 UTC is already 01:30 on the next day in Moscow (UTC+3).
  expect(dateTile("2026-10-25T22:30:00.000Z", "en", "Europe/Moscow").day).toBe("26");
  expect(dateTile("2026-10-25T22:30:00.000Z", "en", "UTC").day).toBe("25");
  expect(dateTile("2026-10-25T22:30:00.000Z", "en", "Europe/Moscow").month).toBe("Oct");
  expect(dateTile("2026-10-25T22:30:00.000Z", "ru", "Europe/Moscow").month).toMatch(/^окт/);
  // Warsaw leaves summer time at 01:00 UTC on 2026-10-25; both sides stay on the 25th.
  expect(dateTile("2026-10-24T22:30:00.000Z", "en", "Europe/Warsaw").day).toBe("25");
  expect(dateTile("2026-10-25T22:30:00.000Z", "en", "Europe/Warsaw").day).toBe("25");
});

// ICU versions differ in the space before AM/PM (U+202F or U+0020); compare normalized text.
const spaced = (value: string) => value.replace(/\s+/g, " ");
test("compact times and the timezone label carry the offset at that instant", () => {
  expect(timezoneOffset("2026-10-25T00:30:00.000Z", "Europe/Warsaw")).toBe("GMT+02:00");
  expect(timezoneOffset("2026-10-25T01:30:00.000Z", "Europe/Warsaw")).toBe("GMT+01:00");
  expect(spaced(compactTime("2026-10-25T00:30:00.000Z", "en", "Europe/Warsaw"))).toMatch(
    /^Sun, Oct 25, 2026, 02:30 AM · GMT\+02:00$/,
  );
  expect(spaced(compactTime("2026-10-25T01:30:00.000Z", "en", "Europe/Warsaw"))).toMatch(
    /^Sun, Oct 25, 2026, 02:30 AM · GMT\+01:00$/,
  );
  expect(spaced(compactTime(start, "ru", "Europe/Moscow"))).toMatch(
    /4 нояб.*2026.*20:00 · GMT\+03:00$/,
  );
  expect(timezoneLabel("Europe/Moscow", start)).toBe("Europe/Moscow (GMT+03:00)");
  expect(timezoneLabel("Europe/Warsaw", "2026-07-01T12:00:00.000Z")).toBe(
    "Europe/Warsaw (GMT+02:00)",
  );
});

test("response symbols stay within the font coverage set and pair with a text label", () => {
  const allowed = new Set(["✓", "✕", "◇"]);
  for (const response of ["participating", "declined", "unanswered"] as const) {
    const tone = responseTone(response);
    expect(tone.tone).toBe(response);
    expect(allowed.has(tone.symbol)).toBe(true);
    for (const locale of ["en", "ru"] as const)
      expect(eventTranslations[locale][responseChoiceKey(response)]).toBeTruthy();
  }
  expect(responseTone("participating").symbol).toBe("✓");
  expect(responseTone("declined").symbol).toBe("✕");
  expect(responseTone("unanswered").symbol).toBe("◇");
  expect(eventTranslations.ru.choiceDeclined).toBe("Не смогу");
  expect(eventTranslations.ru.choiceUnanswered).toBe("Без ответа");
});

test("the event-load exception note needs a prescribed load and an event that is not cancelled", () => {
  const event = (status: string) => ({ status });
  expect(showException({ ...load, event: event("scheduled") })).toBe(false);
  expect(showException({ ...load, prescribedMassKg: "21000", event: event("scheduled") })).toBe(
    true,
  );
  expect(
    showException({
      ...load,
      prescribedCargoId: "e0581000-0000-4000-8000-000000000002",
      event: event("completed"),
    }),
  ).toBe(true);
  expect(showException({ ...load, prescribedMassKg: "21000", event: event("cancelled") })).toBe(
    false,
  );
});

test("unavailable counts are never shown as zero", () => {
  expect(countsView({ isPending: true, isError: false })).toEqual({ state: "loading" });
  expect(countsView({ isPending: false, isError: true })).toEqual({ state: "unavailable" });
  expect(
    countsView({ isPending: false, isError: true, data: { participating: 0, declined: 0 } }),
  ).toEqual({ state: "unavailable" });
  expect(countsView({ isPending: false, isError: false })).toEqual({ state: "unavailable" });
  expect(
    countsView({ isPending: false, isError: false, data: { participating: 0, declined: 2 } }),
  ).toEqual({ state: "ready", participating: 0, declined: 2 });
  expect(eventTranslations.en.countsUnavailable).toBe("Counts are unavailable");
  expect(eventTranslations.en.countsUnavailable).not.toMatch(/\d/);
  expect(eventTranslations.ru.countsUnavailable).not.toMatch(/\d/);
});

test("member labels mark the current member and former members", () => {
  expect(memberLabel(summary, summary.id)).toEqual({ self: true, former: false });
  expect(memberLabel({ ...summary, formerMember: true }, "other")).toEqual({
    self: false,
    former: true,
  });
  expect(memberLabel(summary, undefined)).toEqual({ self: false, former: false });
});

test("the mockup slogan never appears in event strings", () => {
  for (const locale of ["en", "ru"] as const)
    for (const value of Object.values(eventTranslations[locale]))
      expect(value).not.toMatch(/Достаточно суров|Юкон\?|Yukon\?/);
});
