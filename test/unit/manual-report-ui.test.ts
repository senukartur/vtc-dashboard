import { describe, expect, test } from "vitest";
import {
  damagePercent,
  missingRequirements,
  requirements,
  submissionTimeErrors,
} from "../../apps/web/src/features/manual-reports/model.ts";
import {
  displayTimezone,
  referenceInstant,
  referenceLocalValue,
} from "../../apps/web/src/features/manual-reports/reference-time.ts";
import { tripTranslations } from "../../apps/web/src/features/trips/translations.ts";
import { schema } from "../../apps/web/src/features/trips/transport.ts";

const pin = (tail: number) => ({
  status: "resolved" as const,
  entityId: `63000000-0000-4000-8000-${String(tail).padStart(12, "0")}`,
});
const complete = () => ({
  game: "ets2" as const,
  origin: pin(1),
  destination: pin(2),
  cargo: pin(3),
  trailerType: pin(4),
  cargoMassKg: "18000",
  actualDistanceM: "123400",
  evidenceIds: ["43000000-0000-4000-8000-000000000030"],
  comment: null,
  startedAt: "2025-01-12T10:00:00.000Z",
  completedAt: "2025-01-12T11:00:00.000Z",
});
const unresolved = (label: string) => ({
  status: "unresolved" as const,
  label,
  reasonCode: "not_listed" as const,
  locale: "ru" as const,
  context: null,
});

describe("manual report requirements", () => {
  test("an empty new report lists every required field and the screenshot in field order", () => {
    expect(missingRequirements({ game: "ets2", comment: null }, false)).toEqual([
      "origin",
      "destination",
      "cargo",
      "trailerType",
      "cargoMassKg",
      "actualDistanceM",
      "startedAt",
      "completedAt",
      "evidence",
    ]);
  });

  test("a complete submission needs only a ready screenshot", () => {
    expect(missingRequirements(complete(), true)).toEqual([]);
    expect(missingRequirements(complete(), false)).toEqual(["evidence"]);
  });

  test("inexact or negative mass is listed alone; zero distance is a valid value", () => {
    for (const cargoMassKg of ["-1", "1e3", "01", "1.0", " 1"])
      expect(missingRequirements({ ...complete(), cargoMassKg }, true), cargoMassKg).toEqual([
        "cargoMassKg",
      ]);
    expect(missingRequirements({ ...complete(), actualDistanceM: "0" }, true)).toEqual([]);
    expect(missingRequirements({ ...complete(), actualDistanceM: "-0" }, true)).toEqual([
      "actualDistanceM",
    ]);
  });

  test("an unresolved selection needs its diagnostic label", () => {
    expect(missingRequirements({ ...complete(), cargo: unresolved("") }, true)).toEqual(["cargo"]);
    expect(
      missingRequirements({ ...complete(), cargo: unresolved("Fictional crates") }, true),
    ).toEqual([]);
  });

  test("an empty screenshot list is listed even when the uploader reports ready", () => {
    expect(missingRequirements({ ...complete(), evidenceIds: [] }, true)).toEqual(["evidence"]);
  });

  test("unmapped issues still produce a non-empty list", () => {
    expect(missingRequirements({ ...complete(), eventId: "not-an-id" }, true)).toEqual(["invalid"]);
    expect(missingRequirements({ ...complete(), comment: "" }, true)).toEqual(["invalid"]);
    expect(missingRequirements({ ...complete(), game: "fs22" }, true)).toEqual(["invalid"]);
  });

  test("the list is empty exactly when the editor's complete condition holds", () => {
    const keys = [
      "origin",
      "destination",
      "cargo",
      "trailerType",
      "cargoMassKg",
      "actualDistanceM",
      "evidenceIds",
    ] as const;
    const broken: Record<(typeof keys)[number], unknown> = {
      origin: unresolved(""),
      destination: { status: "resolved", entityId: "x" },
      cargo: undefined,
      trailerType: null,
      cargoMassKg: "-1",
      actualDistanceM: "1e3",
      evidenceIds: ["43000000-0000-4000-8000-000000000030", "43000000-0000-4000-8000-000000000030"],
    };
    let checked = 0;
    for (let mask = 0; mask < 1 << keys.length; mask++)
      for (const ready of [true, false]) {
        const submission: Record<string, unknown> = complete();
        keys.forEach((key, bit) => {
          if (mask & (1 << bit)) {
            if (broken[key] === undefined) delete submission[key];
            else submission[key] = broken[key];
          }
        });
        const result = missingRequirements(submission, ready),
          completeNow =
            schema("ManualDatedSubmissionFields").safeParse(submission).success && ready;
        expect(result.length === 0, JSON.stringify([mask, ready])).toBe(completeNow);
        expect(result).toEqual(requirements.filter((item) => result.includes(item)));
        expect(new Set(result).size).toBe(result.length);
        checked++;
      }
    expect(checked).toBe(256);
  });
});

describe("manual report reference controls", () => {
  test("account timezone converts wall time to UTC and unknown zones fall back to UTC", () => {
    expect(displayTimezone("Unknown/Fictional")).toBe("UTC");
    expect(displayTimezone(null)).toBe("UTC");
    expect(referenceInstant("2025-01-12T10:15", "Asia/Kathmandu")).toBe("2025-01-12T04:30:00.000Z");
    expect(referenceLocalValue("2025-01-12T04:30:00.037Z", "Asia/Kathmandu")).toBe(
      "2025-01-12T10:15",
    );
  });

  test("skipped wall times, skipped dates and invalid calendar dates have no instant", () => {
    expect(referenceInstant("2025-03-30T02:30", "Europe/Warsaw")).toBeUndefined();
    expect(referenceInstant("2011-12-30T10:00", "Pacific/Apia")).toBeUndefined();
    expect(referenceInstant("2025-02-29T10:00", "UTC")).toBeUndefined();
  });

  test("new repeated times choose the first instant and unchanged times keep exact milliseconds", () => {
    const saved = "2025-10-26T01:30:12.437Z";
    const local = referenceLocalValue(saved, "Europe/Warsaw");
    expect(local).toBe("2025-10-26T02:30");
    expect(referenceInstant(local, "Europe/Warsaw", saved)).toBe(saved);
    expect(referenceInstant(local, "Europe/Warsaw")).toBe("2025-10-26T00:30:00.000Z");
    expect(referenceInstant("2025-04-06T01:45", "Australia/Lord_Howe")).toBe(
      "2025-04-05T14:45:00.000Z",
    );
  });

  test("final writes distinguish future dates and invalid ordering at the millisecond", () => {
    const end = "2025-01-12T11:00:00.000Z";
    const now = Date.parse(end);
    expect(submissionTimeErrors("2025-01-12T10:59:59.999Z", end, now)).toEqual({
      startedAt: undefined,
      completedAt: undefined,
    });
    expect(submissionTimeErrors(end, end, now).completedAt).toBe("referenceOrder");
    expect(submissionTimeErrors("2025-01-12T11:00:00.001Z", end, now).startedAt).toBe(
      "referenceFuture",
    );
    expect(submissionTimeErrors(undefined, "2025-01-12T11:00:00.001Z", now).completedAt).toBe(
      "referenceFuture",
    );
  });

  test("optional damage accepts zero and fractional percentages without rounding the bound", () => {
    expect(damagePercent("0")).toBe(0);
    expect(damagePercent("2,75")).toBe(2.75);
    expect(damagePercent("100.000")).toBe(100);
    for (const invalid of ["", "-0.1", "1e2", "100.1", "100.000000000000000001"])
      expect(damagePercent(invalid), invalid).toBeUndefined();
  });
});

describe("manual report translations", () => {
  const keys = [
    "cargoMassHelp",
    "distanceHelp",
    "catalogNone",
    "reportMissing",
    "missingEvidence",
    "missingInvalid",
    "reportNextTitle",
    "reportNext1",
    "reportNext2",
    "reportNext3",
    "reportNext4",
  ] as const;
  test("new form keys exist in EN and RU and are non-empty", () => {
    for (const locale of ["en", "ru"] as const)
      for (const key of keys)
        expect(tripTranslations[locale][key].trim(), `${locale}.${key}`).not.toBe("");
    expect(Object.keys(tripTranslations.en).sort()).toEqual(
      Object.keys(tripTranslations.ru).sort(),
    );
  });

  test("every requirement has a label in both locales", () => {
    for (const locale of ["en", "ru"] as const)
      for (const item of requirements) {
        const key =
          item === "evidence" ? "missingEvidence" : item === "invalid" ? "missingInvalid" : item;
        expect(tripTranslations[locale][key], `${locale}.${key}`).toBeTruthy();
      }
  });

  test("the mockup-only slogan is not part of the form copy", () => {
    const text = JSON.stringify(tripTranslations);
    expect(text).not.toMatch(/Достаточно суров|Юкон\?|Yukon\?/);
  });
});
