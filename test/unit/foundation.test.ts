import { browserSchemaDocument, browserSchemaRef } from "@vtc/contracts/runtime";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, test } from "vitest";
import { createFoundationMocks, fixtureId } from "../../apps/web/src/features/foundation/mocks.ts";
import {
  chartGeometry,
  decimalShift,
  formatDecimal,
  formatQuantity,
  formatUtc,
} from "../../apps/web/src/shared/formatting.ts";
import i18n from "../../apps/web/src/shared/i18n.ts";

describe("lossless browser presentation", () => {
  test("large and fractional base units retain every digit without mutating the wire value", () => {
    const canonical = "9007199254740993123456789.0012300";
    expect(decimalShift(canonical, 3)).toBe("9007199254740993123456.78900123");
    expect(formatQuantity(canonical, "km", "en")).toBe("9,007,199,254,740,993,123,456.78900123 km");
    expect(formatQuantity(canonical, "t", "ru")).toBe("9 007 199 254 740 993 123 456,78900123 т");
    expect(canonical).toBe("9007199254740993123456789.0012300");
    expect(formatQuantity("0.001", "km", "en")).toBe("0.000001 km");
    expect(formatQuantity("12500.5", "t", "ru")).toBe("12,5005 т");
    expect(formatDecimal("12.0000", "en")).toBe("12");
  });
  test("absence is distinct from zero and malformed decimal inputs fail closed", () => {
    expect(formatQuantity(null, "km", "en")).toBe("Unavailable");
    expect(formatQuantity("0", "km", "en")).toBe("0 km");
    expect(formatDecimal(null, "ru")).toBe("Недоступно");
    for (const value of ["01", "-1", "1e3", "1,5", "NaN", ""])
      expect(() => decimalShift(value, 3)).toThrow("INVALID_DECIMAL");
    expect(() => decimalShift("1", -1)).toThrow("INVALID_DECIMAL");
  });
  test("UTC instants use explicit display zones; invalid dates/zones never become a misleading date", () => {
    expect(formatUtc("2026-10-17T12:00:00Z", "en", "UTC")).toBe("17 Oct 2026, 12:00");
    expect(formatUtc("2026-10-17T12:00:00Z", "en", "Europe/Warsaw")).toBe("17 Oct 2026, 14:00");
    expect(formatUtc("2026-10-17T12:00:00Z", "ru", "UTC")).toContain("12:00");
    for (const date of [null, "2026-02-30T12:00:00Z", "2026-10-17T12:00:00+02:00", "invalid"])
      expect(formatUtc(date, "en", "UTC")).toBe("Unavailable");
    expect(formatUtc("2026-10-17T12:00:00Z", "en", "Not/A_Zone")).toBe("Unavailable");
    expect(chartGeometry("12500.5")).toBe(12500.5);
    expect(chartGeometry("9007199254740993.123")).toBeNull();
  });
});

test("each synthetic response validates against the reviewed runtime schemas for RU and EN", () => {
  const ajv = new Ajv2020({ strict: true });
  addFormats.default(ajv);
  ajv.addFormat("binary", { type: "string", validate: () => true });
  ajv.addSchema(browserSchemaDocument);
  for (const locale of ["ru", "en"] as const) {
    const mocks = createFoundationMocks(locale);
    for (const [name, value] of Object.entries(mocks)) {
      const schema =
        name === "catalog"
          ? "EnvelopeCatalogEntity"
          : name === "analytics"
            ? "EnvelopeAnalytics"
            : name === "forbidden"
              ? "Error"
              : "EnvelopeListTripSummary";
      const validate = ajv.compile(browserSchemaRef(schema));
      expect(validate(value), `${name}: ${ajv.errorsText(validate.errors)}`).toBe(true);
    }
    expect(mocks.catalog.data.display.requestedLocale).toBe(locale);
    expect(mocks.catalog.data.display.englishFallback).toBe(locale === "ru");
    expect(mocks.catalog.data.id).toBe(fixtureId);
    expect(mocks.analytics.data.reportingTimezone).toBe("UTC");
    mocks.trips.data.items.length = 0;
    expect(createFoundationMocks(locale).trips.data.items).toHaveLength(1);
  }
});

test("feature namespaces fall back to English without changing core language or canonical IDs", async () => {
  const instance = i18n;
  await instance.changeLanguage("ru");
  expect(instance.t("language")).toBe("Язык");
  expect(instance.t("foundation:fallbackProbe")).toBe("English namespace fallback is available.");
  const before = createFoundationMocks("ru");
  await instance.changeLanguage("en");
  const after = createFoundationMocks("en");
  expect(instance.t("foundation:formTitle")).toBe("Try a local form");
  expect(after.catalog.data.id).toBe(before.catalog.data.id);
  expect(after.catalog.data.revisionId).toBe(before.catalog.data.revisionId);
  expect(after.analytics.data).toEqual(before.analytics.data);
});
