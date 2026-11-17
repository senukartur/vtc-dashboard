import type { components } from "@vtc/contracts";
import { describe, expect, test } from "vitest";
import {
  baseUnits,
  compareDecimal,
  displayUnits,
  failureText,
  hasConditions,
  meetsConditions,
  percent,
  promotionPreview,
  setLimits,
  tripCount,
} from "../../apps/web/src/features/qualifications/model.ts";
import { qualificationTranslations } from "../../apps/web/src/features/qualifications/translations.ts";
import { QualificationFailure } from "../../apps/web/src/features/qualifications/transport.ts";

type Driver = components["schemas"]["QualificationLevelDriver"];
type Limits = components["schemas"]["QualificationLimits"];
const driver = (n: number, trips: number, distanceM: string): Driver => ({
  memberId: `c1570000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`,
  displayName: `Fictional driver ${n}`,
  since: "2026-11-01T10:00:00.000Z",
  credited: { trips, distanceM },
});

describe("form units", () => {
  test("tonnes and kilometres become exact kilograms and metres", () => {
    expect(baseUnits("12")).toBe("12000");
    expect(baseUnits("12,5")).toBe("12500");
    expect(baseUnits("0.0015")).toBe("1.5");
    expect(baseUnits(" 1000.000 ")).toBe("1000000");
    expect(baseUnits("")).toBeNull();
    for (const invalid of ["-1", "1e3", "abc", "1.2.3", "12 t"])
      expect(baseUnits(invalid)).toBeUndefined();
    expect(displayUnits("12500", "ru")).toBe("12,5");
    expect(displayUnits("12500", "en")).toBe("12.5");
    expect(displayUnits(null, "en")).toBe("");
  });
  test("trip counts are positive whole numbers", () => {
    expect(tripCount("3")).toBe(3);
    expect(tripCount("")).toBeNull();
    for (const invalid of ["0", "1.5", "-2", "01", "4294967296"])
      expect(tripCount(invalid)).toBeUndefined();
  });
  test("decimal comparison is exact", () => {
    expect(compareDecimal("1000000.5", "1000000.50")).toBe(0);
    expect(compareDecimal("999999.9", "1000000")).toBe(-1);
    expect(compareDecimal("10.01", "10.001")).toBe(1);
  });
});

describe("promotion preview", () => {
  const drivers = [driver(1, 5, "500000"), driver(2, 2, "900000"), driver(3, 5, "499999.9")];
  test("counts drivers whose credited totals meet every draft condition, inclusively", () => {
    const conditions = { requiredTrips: 5, requiredDistanceM: "500000" };
    expect(promotionPreview(drivers, conditions, true)).toBe(1);
    expect(promotionPreview(drivers, { requiredTrips: 2, requiredDistanceM: null }, true)).toBe(3);
    expect(
      promotionPreview(drivers, { requiredTrips: null, requiredDistanceM: "900000" }, true),
    ).toBe(1);
  });
  test("the top level and a level without conditions move nobody", () => {
    const conditions = { requiredTrips: 1, requiredDistanceM: null };
    expect(promotionPreview(drivers, conditions, false)).toBe(0);
    const none = { requiredTrips: null, requiredDistanceM: null };
    expect(promotionPreview(drivers, none, true)).toBe(0);
    expect(hasConditions(none)).toBe(false);
    expect(hasConditions(null)).toBe(false);
    expect(meetsConditions({ trips: 99, distanceM: "1" }, none)).toBe(false);
  });
  test("progress bars are bounded and absent for an unset condition", () => {
    expect(percent(1, 4)).toBe(25);
    expect(percent("900", "300")).toBe(100);
    expect(percent(3, null)).toBeNull();
  });
});

describe("limits and messages", () => {
  test("only set limits are listed", () => {
    const limits: Limits = {
      massMinKg: null,
      massMaxKg: "20000",
      distanceMinM: null,
      distanceMaxM: null,
      trailers: { mode: "any", types: [] },
      adr: { mode: "forbidden", classes: [] },
      hardModeRequired: true,
    };
    expect(setLimits(limits)).toEqual({
      mass: true,
      distance: false,
      trailers: false,
      adr: true,
      hardMode: true,
    });
  });
  test("a level without conditions below the top gets its own validation message", () => {
    const t = ((key: string, options?: { name?: string }) =>
      options?.name ? `${key}:${options.name}` : key) as unknown as Parameters<
      typeof failureText
    >[0];
    const failure = (status: number, code: string | null) =>
      new QualificationFailure("invalid", status, null, code);
    expect(failureText(t, failure(422, "QUALIFICATION_CONDITIONS_REQUIRED"))).toBe(
      "errorConditions",
    );
    // A create or move that strands an existing level names it when the ladder knows it.
    const stranded = new QualificationFailure(
      "invalid",
      422,
      null,
      "QUALIFICATION_CONDITIONS_REQUIRED",
      "c1570000-0000-4000-8000-000000000201",
    );
    const ladder = [{ id: "c1570000-0000-4000-8000-000000000201", name: "Fictional Driver" }];
    expect(failureText(t, stranded, ladder)).toBe("errorConditionsLevel:Fictional Driver");
    expect(failureText(t, stranded)).toBe("errorConditions");
    expect(failureText(t, failure(422, null))).toBe("errorInvalid");
    expect(failureText(t, new QualificationFailure("conflict", 409))).toBe("errorConflict");
    expect(failureText(t, new Error("network"))).toBe("errorUncertain");
  });
});

describe("qualification translations", () => {
  const { en, ru } = qualificationTranslations;
  const base = (key: string) => key.replace(/_(one|few|many|other)$/, "");
  test("Russian and English cover the same keys, with the plural forms of each language", () => {
    expect(new Set(Object.keys(ru).map(base))).toEqual(new Set(Object.keys(en).map(base)));
    for (const key of Object.keys(en).filter((k) => k.endsWith("_one"))) {
      const stem = base(key);
      expect(Object.keys(en)).toContain(`${stem}_other`);
      for (const form of ["one", "few", "many", "other"])
        expect(Object.keys(ru)).toContain(`${stem}_${form}`);
    }
    for (const [key, value] of [...Object.entries(en), ...Object.entries(ru)])
      expect(value.trim(), key).not.toBe("");
  });
  test("Hard Mode keeps its English name in both languages", () => {
    expect(en.hardMode).toBe("Hard Mode");
    expect(ru.hardMode).toBe("Hard Mode");
  });
  test("interpolations match between languages", () => {
    const names = (value: string) => [...value.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(en)) {
      const counterpart = (ru as Record<string, string>)[key] ?? ru[`${base(key)}_other`];
      if (counterpart === undefined) continue;
      expect(names(counterpart), key).toEqual(names((en as Record<string, string>)[key] ?? ""));
    }
  });
});
