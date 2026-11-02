import type { components } from "@vtc/contracts";
import { describe, expect, test } from "vitest";
import {
  defaultLevelId,
  ruleSummary,
  sortLevels,
  thresholdSummary,
  unconfiguredCount,
} from "../../apps/web/src/features/qualifications/model.ts";
import { qualificationTranslations } from "../../apps/web/src/features/qualifications/translations.ts";
import { formatQuantity } from "../../apps/web/src/shared/formatting.ts";

type Level = components["schemas"]["QualificationLevel"];
type Rule = components["schemas"]["Rule"];
const ids = [
  "e3400000-0000-4000-8000-000000000001",
  "e3400000-0000-4000-8000-000000000002",
  "e3400000-0000-4000-8000-000000000003",
];
const level = (code: Level["code"], overrides: Partial<Level> = {}): Level => ({
  id: `e3400000-0000-4000-8000-0000000000${String(["trainee", "driver_iii", "driver_ii", "driver_i"].indexOf(code) + 10)}`,
  version: 1,
  game: "ets2",
  code,
  name: `Fictional ${code}`,
  ruleVersionId: "e3300000-0000-4000-8000-000000000001",
  configured: true,
  requiredTrips: 2,
  requiredDistanceM: "100",
  ...overrides,
});

describe("qualification levels model", () => {
  test("sorts levels in progression order without mutating the input", () => {
    const input = [level("driver_i"), level("trainee"), level("driver_ii"), level("driver_iii")];
    const before = input.map((l) => l.code);
    expect(sortLevels(input).map((l) => l.code)).toEqual([
      "trainee",
      "driver_iii",
      "driver_ii",
      "driver_i",
    ]);
    expect(input.map((l) => l.code)).toEqual(before);
  });

  test("defaults the selection to the first progression level, or null without levels", () => {
    expect(defaultLevelId([level("driver_ii"), level("driver_iii")])).toBe(level("driver_iii").id);
    expect(defaultLevelId([])).toBeNull();
  });

  test("counts levels without an effective rule version", () => {
    expect(unconfiguredCount([level("trainee"), level("driver_iii")])).toBe(0);
    expect(
      unconfiguredCount([
        level("trainee", { ruleVersionId: null, configured: false }),
        level("driver_iii"),
        level("driver_i", { ruleVersionId: null, configured: false }),
      ]),
    ).toBe(2);
  });

  test("summarizes omitted, valued, empty and counted restrictions", () => {
    expect(ruleSummary([])).toEqual({
      mass: { kind: "none" },
      trailers: { kind: "none" },
      adr: { kind: "none" },
    });
    expect(
      ruleSummary([
        { type: "max_mass", maxKg: "10" },
        { type: "allowed_trailer_types", entityIds: [] },
        { type: "allowed_adr_categories", entityIds: ids },
      ]),
    ).toEqual({
      mass: { kind: "value", maxKg: "10" },
      trailers: { kind: "empty" },
      adr: { kind: "count", count: 3 },
    });
  });

  test("ignores unregistered rule types instead of guessing a restriction", () => {
    const unknown = { type: "max_axles", value: 3 } as unknown as Rule;
    expect(ruleSummary([unknown, { type: "allowed_trailer_types", entityIds: ids }])).toEqual({
      mass: { kind: "none" },
      trailers: { kind: "count", count: 3 },
      adr: { kind: "none" },
    });
  });

  test("keeps unset threshold parts unset and treats Driver I as terminal", () => {
    expect(thresholdSummary(level("trainee"))).toEqual({
      kind: "value",
      trips: 2,
      distanceM: "100",
    });
    expect(
      thresholdSummary(level("driver_iii", { requiredTrips: null, requiredDistanceM: null })),
    ).toEqual({ kind: "value", trips: null, distanceM: null });
    expect(thresholdSummary(level("driver_i"))).toEqual({ kind: "terminal" });
  });

  test("formats wire meters and kilograms exactly as kilometres and tonnes", () => {
    expect(formatQuantity("100.000000000000000001", "km", "en")).toBe("0.100000000000000000001 km");
    expect(formatQuantity("100.000000000000000001", "km", "ru")).toBe("0,100000000000000000001 км");
    expect(formatQuantity("10", "t", "en")).toBe("0.01 t");
    expect(formatQuantity("10", "t", "ru")).toBe("0,01 т");
  });
});

describe("qualification translations", () => {
  const added = [
    "forbidden",
    "colMass",
    "colTrailers",
    "colAdr",
    "colThreshold",
    "noRestriction",
    "noneAllowed",
    "allowedCount",
    "thresholdValue",
    "topLevel",
    "statusEffective",
    "statusUnpublished",
    "cellLoading",
    "cellUnavailable",
    "draftOpen",
    "ready",
    "emptyLevels",
    "unconfigured",
    "decisionNeeded",
    "levelKept",
  ] as const;

  test("RU and EN expose the same keys, including every compact-layout key", () => {
    const en = qualificationTranslations.en,
      ru = qualificationTranslations.ru;
    expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort());
    for (const key of added) {
      expect(en[key]).toBeTruthy();
      expect(ru[key]).toBeTruthy();
    }
    expect(en.levels).toBe("Levels and effective rules");
    expect(ru.levels).toBe("Уровни и действующие правила");
  });

  test("interpolation placeholders exist in both languages", () => {
    const placeholders: Partial<Record<keyof typeof qualificationTranslations.en, string[]>> = {
      allowedCount: ["{{count}}"],
      thresholdValue: ["{{trips}}", "{{distance}}"],
      unconfigured: ["{{count}}", "{{total}}", "{{game}}"],
    };
    for (const locale of ["en", "ru"] as const)
      for (const [key, expected] of Object.entries(placeholders))
        for (const placeholder of expected ?? [])
          expect(
            qualificationTranslations[locale][key as keyof typeof qualificationTranslations.en],
          ).toContain(placeholder);
  });

  test("copy states no automatic demotion and never contains the mockup slogan", () => {
    expect(qualificationTranslations.en.levelKept).toContain("no automatic demotion");
    expect(qualificationTranslations.ru.levelKept).toContain("Автоматического понижения нет");
    expect(qualificationTranslations.en.distance).toBe("Actual distance");
    expect(qualificationTranslations.ru.distance).toBe("Фактическое расстояние");
    expect(/Достаточно суров|Yukon\?|Юкон\?/.test(JSON.stringify(qualificationTranslations))).toBe(
      false,
    );
  });
});
