import { expect, test } from "vitest";
import {
  damageValue,
  emptyAllowlist,
  extraTrailerTypes,
  ruleRows,
  sourceOutcomeKey,
} from "../../apps/web/src/features/trips/trip-page-model.ts";
import { tripTranslations } from "../../apps/web/src/features/trips/translations.ts";
import { type DTO, schema } from "../../apps/web/src/features/trips/transport.ts";
import {
  manualUnknown,
  returnedTrip,
  telemetryWithEvent,
  tripPageStubs,
} from "../e2e/support/trip-page-fixtures.ts";

const privateView = (envelope: DTO["EnvelopeTripView"]) => envelope.data as DTO["TripPrivate"];

test("every trip page browser stub keeps the full contract shape", () => {
  for (const [name, stub] of Object.entries(tripPageStubs())) {
    const parsed = schema("EnvelopeTripView").safeParse(stub);
    expect(parsed.success, name).toBe(true);
  }
});

test("rule rows follow server order, stable keys and symbols, and an event bypass wins", () => {
  const rows = ruleRows(privateView(telemetryWithEvent()).qualificationCheck);
  expect(rows?.map(({ key, state, symbol }) => ({ key, state, symbol }))).toEqual([
    { key: "0-max_mass", state: "pass", symbol: "✓" },
    { key: "1-allowed_trailer_types", state: "fail", symbol: "✕" },
    // The ADR rule's own outcome is unknown; the event bypass overrides it.
    { key: "2-allowed_adr_categories", state: "bypassed", symbol: "◇" },
  ]);
  expect(rows?.[0]?.rule?.ruleType).toBe("max_mass");
});

test("an unresolved check is one unavailable row and a missing check is no rows at all", () => {
  expect(ruleRows(privateView(manualUnknown()).qualificationCheck)).toEqual([
    { key: "unavailable", state: "unavailable", symbol: "?", rule: null },
  ]);
  expect(ruleRows(null)).toBeNull();
  expect(ruleRows(undefined)).toBeNull();
  expect(ruleRows(privateView(manualUnknown("no-rules")).qualificationCheck)).toEqual([]);
});

test("an empty configured allowlist is detected, while a truncated trailer list is not", () => {
  const configured = privateView(telemetryWithEvent()).qualificationCheck?.rules ?? [];
  const empty = privateView(returnedTrip()).qualificationCheck?.rules ?? [];
  expect(configured.map(emptyAllowlist)).toEqual([false, false, false]);
  expect(empty.map(emptyAllowlist)).toEqual([false, true, true]);
  const trailer = empty.find((rule) => rule.ruleType === "allowed_trailer_types");
  if (trailer?.ruleType !== "allowed_trailer_types") throw new Error("MISSING_TRAILER_RULE");
  expect(emptyAllowlist({ ...trailer, allowedTrailerTypeCount: 2 })).toBe(false);
});

test("trailer overflow, source outcome keys and unknown damage stay distinct from zero", () => {
  expect(extraTrailerTypes({ allowedTrailerTypes: [{}], allowedTrailerTypeCount: 3 })).toBe(2);
  expect(extraTrailerTypes({ allowedTrailerTypes: [{}], allowedTrailerTypeCount: 1 })).toBe(0);
  expect(sourceOutcomeKey("open")).toBe("outcomeOpen");
  expect(sourceOutcomeKey("delivered")).toBe("delivered");
  expect(sourceOutcomeKey("cancelled")).toBe("cancelled");
  expect(sourceOutcomeKey("none")).toBe("none");
  expect(damageValue(privateView(manualUnknown()).effectiveFacts)).toBeNull();
  expect(damageValue(privateView(manualUnknown("zero-damage")).effectiveFacts)).toBe(0);
  expect(damageValue(privateView(telemetryWithEvent()).effectiveFacts)).toBe(37.5);
  const { cargoDamagePercent: _omitted, ...absent } = privateView(manualUnknown())
    .effectiveFacts as DTO["EffectiveTripFacts"];
  expect(damageValue(absent)).toBeNull();
  expect(damageValue(null)).toBeNull();
});

test("the trip page keys exist in both languages", () => {
  const keys = [
    "sourcesTitle",
    "sourcesEmpty",
    "sourceReceived",
    "sourceEffective",
    "senderCompany",
    "receiverCompany",
    "companyUnknown",
    "ruleAllowed",
    "ruleAllowedNone",
    "ruleAdrNone",
    "ruleMore",
    "massUnknown",
    "ruleAdrObserved",
    "checkUnresolved",
    "outcomeOpen",
  ] as const;
  for (const key of keys) {
    expect(tripTranslations.en[key], key).toBeTruthy();
    expect(tripTranslations.ru[key], key).toBeTruthy();
    expect(tripTranslations.ru[key]).not.toBe(tripTranslations.en[key]);
  }
});
