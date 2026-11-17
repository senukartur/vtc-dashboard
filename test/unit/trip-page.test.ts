import { expect, test } from "vitest";
import { tripTranslations } from "../../apps/web/src/features/trips/translations.ts";
import { type DTO, schema } from "../../apps/web/src/features/trips/transport.ts";
import {
  damageValue,
  sourceOutcomeKey,
} from "../../apps/web/src/features/trips/trip-page-model.ts";
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

test("stub checks cover the checked, event-exempt, unknown-level and missing states", () => {
  const checked = privateView(telemetryWithEvent()).qualificationCheck;
  expect(checked?.status).toBe("checked");
  expect(checked?.basis).toBe("decision");
  expect(checked?.rules.map(({ rule, result }) => `${rule}:${result}`)).toEqual([
    "cargo_mass:pass",
    "distance:pass",
    "trailer_types:fail",
    "adr:pass",
    "hard_mode:pass",
  ]);
  expect(privateView(manualUnknown()).qualificationCheck).toMatchObject({
    status: "no_level",
    level: null,
    rules: [],
  });
  expect(privateView(manualUnknown("event-exempt")).qualificationCheck).toMatchObject({
    status: "event_exempt",
    rules: [],
  });
  expect(privateView(manualUnknown("no-check")).qualificationCheck).toBeNull();
  const returned = privateView(returnedTrip()).qualificationCheck?.rules ?? [];
  expect(returned.flatMap((rule) => (rule.rule === "trailer_types" ? rule.allowed : []))).toEqual(
    [],
  );
});

test("source outcome keys and unknown damage stay distinct from zero", () => {
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
    "outcomeOpen",
  ] as const;
  for (const key of keys) {
    expect(tripTranslations.en[key], key).toBeTruthy();
    expect(tripTranslations.ru[key], key).toBeTruthy();
    expect(tripTranslations.ru[key]).not.toBe(tripTranslations.en[key]);
  }
});
