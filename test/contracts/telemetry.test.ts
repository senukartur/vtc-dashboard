import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { expect, test } from "vitest";
import { telemetryExamples, telemetryFixture } from "../support/builders.ts";

const ajv = new Ajv2020({
  strict: true,
  // The frozen schema refines existing objects in conditionals without repeating type.
  strictTypes: false,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
});
addFormats.default(ajv);
const validate = ajv.compile(
  JSON.parse(
    readFileSync(new URL("../../docs/contracts/telemetry-v1.schema.json", import.meta.url), "utf8"),
  ),
);
for (const name of telemetryExamples)
  test(`frozen telemetry structural fixture: ${name}`, () => {
    expect(validate(telemetryFixture(name)), ajv.errorsText(validate.errors)).toBe(true);
  });

test("telemetry structural boundary rejects unsupported versions and supplied ownership/acceptance", () => {
  for (const mutation of [
    { contract: { major: 2, minor: 0 } },
    { contract: { major: 1, minor: 1 } },
    { userId: "synthetic-owner" },
    { companyId: "synthetic-company" },
    { accepted: true },
    { qualificationId: "synthetic-qualification" },
    { revision: "2" },
    { createdUtcMs: "1792231200000" },
    { type: "trip.accepted" },
  ])
    expect(validate({ ...telemetryFixture("completed"), ...mutation })).toBe(false);
});

test("telemetry quantities preserve unavailable and measured zero as different shapes", () => {
  const fixture = telemetryFixture("completed");
  const snapshot = fixture.snapshot as Record<string, unknown>;
  for (const distance of [
    { available: true, value: 0, unit: "m" },
    { available: false, reason: "not-observed", unit: "m" },
  ]) {
    snapshot.observedDistance = distance;
    expect(validate(fixture), ajv.errorsText(validate.errors)).toBe(true);
  }
  for (const distance of [
    { available: true, value: "0", unit: "m" },
    { available: false, value: 0, unit: "m" },
    { available: true, unit: "m" },
    { available: true, value: -1, unit: "m" },
  ]) {
    snapshot.observedDistance = distance;
    expect(validate(fixture)).toBe(false);
  }
});

test("telemetry event/outcome enums and exact sequence/money strings remain frozen", () => {
  const fixture = telemetryFixture("completed");
  const snapshot = fixture.snapshot as Record<string, unknown>;
  snapshot.outcome = "accepted";
  expect(validate(fixture)).toBe(false);
  snapshot.outcome = "delivered";
  snapshot.outcomeEventSeq = 9007199254740992;
  expect(validate(fixture)).toBe(false);
  snapshot.outcomeEventSeq = "9007199254740999";
  snapshot.revenue = {
    available: true,
    value: { raw: 9800, sdkType: "s64", currency: { status: "unknown" } },
  };
  expect(validate(fixture)).toBe(false);
});
