import { describe, expect, test } from "vitest";
import { utcInput as eventUtcInput } from "../../apps/web/src/features/events/model.ts";
import { referenceInstant } from "../../apps/web/src/features/manual-reports/reference-time.ts";
import { utcInput as qualificationUtcInput } from "../../apps/web/src/features/qualifications/transport.ts";
import {
  clampSegment,
  composeEdit,
  composeTime,
  composeWallClock,
  decodeIncomplete,
  editSegment,
  emptyTime,
  formatDateText,
  incompleteValue,
  inDateRange,
  isIsoDate,
  parseDateText,
  segmentsFor,
  splitTime,
  splitWallClock,
  stepSegment,
  todayIn,
  typeDigit,
  typeDigits,
} from "../../apps/web/src/shared/ui/date-time.ts";

describe("typed dates follow the interface language", () => {
  test("Russian day.month.year", () => {
    expect(parseDateText("17.11.2026", "ru")).toBe("2026-11-17");
    expect(parseDateText("17112026", "ru")).toBe("2026-11-17");
    expect(parseDateText(" 1.2.2026 ", "ru")).toBe("2026-02-01");
    expect(parseDateText("1/2/2026", "ru")).toBe("2026-02-01");
    // An English-order date is not a Russian date.
    expect(parseDateText("11/17/2026", "ru")).toBeUndefined();
  });
  test("English month/day/year", () => {
    expect(parseDateText("11/17/2026", "en")).toBe("2026-11-17");
    expect(parseDateText("2/1/2026", "en")).toBe("2026-02-01");
    expect(parseDateText("11172026", "en")).toBe("2026-11-17");
    expect(parseDateText("17.11.2026", "en")).toBeUndefined();
  });
  test("only real calendar dates with four-digit years", () => {
    for (const text of ["31.02.2026", "17.13.2026", "17.11.26", "00.11.2026", "29.02.2025", ""])
      expect(parseDateText(text, "ru")).toBeUndefined();
    expect(parseDateText("29.02.2028", "ru")).toBe("2028-02-29");
    expect(parseDateText("17.11.2026x", "ru")).toBeUndefined();
    expect(parseDateText("17.11.0000", "ru")).toBeUndefined();
  });
  test("formatting in both languages", () => {
    expect(formatDateText("2026-11-04", "ru")).toBe("04.11.2026");
    expect(formatDateText("2026-11-04", "en")).toBe("11/04/2026");
    for (const locale of ["ru", "en"] as const)
      expect(parseDateText(formatDateText("2026-02-01", locale), locale)).toBe("2026-02-01");
  });
});

describe("min and max bounds", () => {
  test("inclusive edges", () => {
    expect(inDateRange("2026-11-13", "2026-11-13", "2026-11-13")).toBe(true);
    expect(inDateRange("2026-11-12", "2026-11-13")).toBe(false);
    expect(inDateRange("2026-11-14", undefined, "2026-11-13")).toBe(false);
    expect(inDateRange("2026-11-14")).toBe(true);
  });
  test("today is read in an explicit time zone", () => {
    const instant = Date.parse("2026-11-13T09:30:00.000Z");
    expect(todayIn("UTC", instant)).toBe("2026-11-13");
    expect(todayIn("Pacific/Kiritimati", instant)).toBe("2026-11-13");
    expect(todayIn("Pacific/Kiritimati", Date.parse("2026-11-13T10:30:00.000Z"))).toBe(
      "2026-11-14",
    );
    expect(todayIn("America/Los_Angeles", instant)).toBe("2026-11-13");
    expect(todayIn("America/Los_Angeles", Date.parse("2026-11-13T07:59:00.000Z"))).toBe(
      "2026-11-12",
    );
  });
});

describe("24-hour time segments", () => {
  test("typing completes a segment and reports when focus can advance", () => {
    expect(typeDigit("", "1", "hours")).toEqual({ text: "1", complete: false });
    expect(typeDigit("1", "8", "hours")).toEqual({ text: "18", complete: true });
    expect(typeDigit("", "3", "hours")).toEqual({ text: "03", complete: true });
    expect(typeDigit("", "2", "hours")).toEqual({ text: "2", complete: false });
    expect(typeDigit("", "6", "minutes")).toEqual({ text: "06", complete: true });
    expect(typeDigit("", "5", "minutes")).toEqual({ text: "5", complete: false });
    // 25 is out of range, so 5 starts the hour again.
    expect(typeDigits("", "25", "hours")).toEqual({ text: "05", complete: true });
    // A complete segment starts again with the next digit.
    expect(typeDigit("18", "2", "hours")).toEqual({ text: "2", complete: false });
    expect(typeDigits("", "30", "minutes")).toEqual({ text: "30", complete: true });
    expect(typeDigits("", "09", "hours")).toEqual({ text: "09", complete: true });
  });
  test("milliseconds take three digits", () => {
    expect(typeDigits("", "9", "milliseconds")).toEqual({ text: "9", complete: false });
    expect(typeDigits("", "99", "milliseconds")).toEqual({ text: "99", complete: false });
    expect(typeDigits("", "999", "milliseconds")).toEqual({ text: "999", complete: true });
    expect(clampSegment("12", "milliseconds")).toBe("012");
    expect(clampSegment("1", "hours")).toBe("01");
    expect(clampSegment("", "hours")).toBe("");
  });
  test("typing over a selected filled segment replaces it; only deletions keep the text", () => {
    // Focus selects "14"; the browser value is then just the typed digit.
    expect(editSegment("14", "9", false, "hours")).toEqual({ text: "09", complete: true });
    expect(editSegment("00", "3", false, "minutes")).toEqual({ text: "3", complete: false });
    expect(editSegment("3", "30", false, "minutes")).toEqual({ text: "30", complete: true });
    expect(editSegment("14", "1", false, "hours")).toEqual({ text: "1", complete: false });
    expect(editSegment("500", "7", false, "milliseconds")).toEqual({ text: "7", complete: false });
    // An unfinished segment continues; a caret after a finished one starts again.
    expect(editSegment("1", "18", false, "hours")).toEqual({ text: "18", complete: true });
    expect(editSegment("14", "145", false, "hours")).toEqual({ text: "05", complete: true });
    // Real deletions keep the remaining digits without advancing.
    expect(editSegment("14", "1", true, "hours")).toEqual({ text: "1", complete: false });
    expect(editSegment("14", "", true, "hours")).toEqual({ text: "", complete: false });
  });
  test("arrow steps wrap without AM/PM", () => {
    expect(stepSegment("23", 1, "hours")).toBe("00");
    expect(stepSegment("00", -1, "hours")).toBe("23");
    expect(stepSegment("00", -1, "minutes")).toBe("59");
    expect(stepSegment("59", 1, "minutes")).toBe("00");
    expect(stepSegment("", 1, "hours")).toBe("00");
    expect(stepSegment("", -1, "hours")).toBe("23");
    expect(stepSegment("", -1, "milliseconds")).toBe("999");
    expect(stepSegment("11", 1, "hours")).toBe("12");
    expect(stepSegment("12", 1, "hours")).toBe("13");
    expect(segmentsFor("minute")).toEqual(["hours", "minutes"]);
    expect(segmentsFor("millisecond")).toEqual(["hours", "minutes", "seconds", "milliseconds"]);
  });
});

describe("exact wall-clock strings", () => {
  test("split and compose round trips", () => {
    for (const [value, precision] of [
      ["2026-11-17T18:00", "minute"],
      ["2026-11-17T18:00:05", "second"],
      ["2026-11-17T18:00:05.120", "millisecond"],
      ["2025-01-31T23:59:59.999", "millisecond"],
    ] as const) {
      const parts = splitWallClock(value);
      expect(parts).toBeDefined();
      if (parts) expect(composeWallClock(parts, precision)).toBe(value);
    }
    // A fraction is read as a fraction, as each form's conversion does.
    expect(splitWallClock("2026-11-17T18:00:05.12")?.milliseconds).toBe("120");
    expect(eventUtcInput("2026-11-17T18:00:05.12")).toBe("2026-11-17T18:00:05.120Z");
  });
  test("sub-minute parts are added only when entered", () => {
    const date = "2026-11-17";
    expect(composeWallClock({ date, ...emptyTime, hours: "18", minutes: "5" }, "millisecond")).toBe(
      "2026-11-17T18:05",
    );
    expect(
      composeWallClock({ date, ...emptyTime, hours: "18", minutes: "05", seconds: "7" }, "second"),
    ).toBe("2026-11-17T18:05:07");
    expect(
      composeWallClock(
        { date, hours: "18", minutes: "05", seconds: "", milliseconds: "12" },
        "millisecond",
      ),
    ).toBe("2026-11-17T18:05:00.012");
    // A minute field drops hidden seconds when edited.
    expect(
      composeWallClock(
        { date, hours: "18", minutes: "05", seconds: "30", milliseconds: "500" },
        "minute",
      ),
    ).toBe("2026-11-17T18:05");
    expect(composeWallClock({ date, ...emptyTime, hours: "18" }, "minute")).toBeUndefined();
    expect(
      composeWallClock({ date: "2026-02-31", ...emptyTime, hours: "1", minutes: "1" }, "minute"),
    ).toBeUndefined();
  });
  test("the untouched stored value keeps its exact string", () => {
    const stored = "2026-11-17T18:00:00.000";
    const parts = splitWallClock(stored);
    expect(parts).toEqual({
      date: "2026-11-17",
      hours: "18",
      minutes: "00",
      seconds: "00",
      milliseconds: "000",
    });
    if (parts) expect(composeWallClock(parts, "millisecond")).toBe(stored);
  });
  test("incomplete entry is rejected by every form's conversion and decodes back", () => {
    const time = { hours: "18", minutes: "", seconds: "", milliseconds: "" };
    const marker = incompleteValue("31.02.2026", time);
    expect(marker).not.toBe("");
    expect(eventUtcInput(marker)).toBeUndefined();
    expect(qualificationUtcInput(marker)).toBeUndefined();
    expect(referenceInstant(marker, "Europe/Warsaw")).toBeUndefined();
    expect(decodeIncomplete(marker)).toEqual({ date: "31.02.2026", ...time });
    expect(decodeIncomplete("2026-11-17T18:00")).toBeUndefined();
    expect(decodeIncomplete("invalid:not-json")).toBeUndefined();
  });
});

describe("date-only and time-only values", () => {
  test("ISO dates and times of day split and compose with the wall-clock rules", () => {
    expect(isIsoDate("2099-10-25")).toBe(true);
    expect(isIsoDate("2026-02-31")).toBe(false);
    expect(isIsoDate("25.10.2099")).toBe(false);
    expect(splitTime("17:00:30.5")).toEqual({
      hours: "17",
      minutes: "00",
      seconds: "30",
      milliseconds: "500",
    });
    expect(splitTime("7:00")).toBeUndefined();
    expect(composeTime({ ...emptyTime, hours: "9", minutes: "5" }, "minute")).toBe("09:05");
    expect(composeTime({ ...emptyTime, hours: "24", minutes: "00" }, "minute")).toBeUndefined();
    expect(
      composeTime({ hours: "17", minutes: "00", seconds: "30", milliseconds: "500" }, "minute"),
    ).toBe("17:00");
  });
});

describe("hidden sub-minute parts", () => {
  const stored = splitWallClock("2099-10-25T14:00:30.500");
  if (!stored) throw new Error("fixture");
  test("a date-only edit at minute or second precision keeps them exactly", () => {
    const moved = { ...stored, date: "2099-10-26" };
    expect(composeEdit(moved, "minute", true)).toBe("2099-10-26T14:00:30.500");
    expect(composeEdit(moved, "second", true)).toBe("2099-10-26T14:00:30.500");
    const exact = splitWallClock("2099-10-25T18:00:00.000");
    if (!exact) throw new Error("fixture");
    expect(composeEdit({ ...exact, date: "2099-10-26" }, "minute", true)).toBe(
      "2099-10-26T18:00:00.000",
    );
    expect(composeEdit({ ...stored, seconds: "", milliseconds: "" }, "minute", true)).toBe(
      "2099-10-25T14:00",
    );
  });
  test("a time edit emits exactly the shown segments", () => {
    expect(composeEdit({ ...stored, hours: "15" }, "minute", false)).toBe("2099-10-25T15:00");
    expect(composeEdit({ ...stored, minutes: "05" }, "second", false)).toBe("2099-10-25T14:05:30");
    expect(composeEdit({ ...stored, hours: "15" }, "millisecond", false)).toBe(
      "2099-10-25T15:00:30.500",
    );
  });
});
