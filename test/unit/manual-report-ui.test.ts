import { describe, expect, test } from "vitest";
import {
  missingRequirements,
  requirements,
} from "../../apps/web/src/features/manual-reports/model.ts";
import { tripTranslations } from "../../apps/web/src/features/trips/translations.ts";
import { schema } from "../../apps/web/src/features/trips/transport.ts";

const revisionId = "61000000-0000-4000-8000-000000000020";
const pin = (tail: number) => ({
  status: "resolved" as const,
  entityId: `63000000-0000-4000-8000-${String(tail).padStart(12, "0")}`,
  catalogRevisionId: revisionId,
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
      destination: { status: "resolved", entityId: "x", catalogRevisionId: revisionId },
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
          completeNow = schema("ManualSubmissionFields").safeParse(submission).success && ready;
        expect(result.length === 0, JSON.stringify([mask, ready])).toBe(completeNow);
        expect(result).toEqual(requirements.filter((item) => result.includes(item)));
        expect(new Set(result).size).toBe(result.length);
        checked++;
      }
    expect(checked).toBe(256);
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
