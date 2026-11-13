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
    { contract: { major: 1, minor: 3 } },
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

test("telemetry versions close the audit shape and retain mode provenance constraints", () => {
  const fixture = telemetryFixture("haulmp-audited");
  const snapshot = fixture.snapshot as Record<string, unknown>;
  for (const result of ["qualified", "not-qualified", "unknown"]) {
    snapshot.hardModeResult = result;
    expect(validate(fixture), ajv.errorsText(validate.errors)).toBe(true);
  }
  for (const result of ["not_qualified", true, null, { status: "qualified" }]) {
    snapshot.hardModeResult = result;
    expect(validate(fixture)).toBe(false);
  }
  delete snapshot.hardModeResult;
  expect(validate(fixture)).toBe(false);
  fixture.contract = { major: 1, minor: 0 };
  expect(validate(fixture), ajv.errorsText(validate.errors)).toBe(true);
  snapshot.hardModeResult = "unknown";
  expect(validate(fixture)).toBe(false);
  delete snapshot.hardModeResult;

  for (const [mode, method, confidence, valid] of [
    ["haulmp", "module-scan", "strong", true],
    ["haulmp", "process-scan", "weak", true],
    ["haulmp", "none", "strong", false],
    ["haulmp", "process-scan", "none", false],
    ["truckersmp", "module-scan", "strong", true],
    ["single-player", "process-scan", "weak", true],
    ["single-player", "process-scan", "strong", false],
    ["unknown", "none", "none", true],
    ["unknown", "none", "weak", false],
  ] as const) {
    snapshot.gameMode = { mode, method, confidence, ambiguous: false };
    expect(validate(fixture)).toBe(valid);
  }
  snapshot.extra = "fictional";
  expect(validate(fixture)).toBe(false);
});

test("telemetry v1.2 requires a closed accounting status that earlier versions forbid", () => {
  const fixture = telemetryFixture("accounting");
  const snapshot = fixture.snapshot as Record<string, unknown>;
  expect(fixture.contract).toEqual({ major: 1, minor: 2 });
  for (const distance of ["complete", "partial", "unknown"])
    for (const fuel of ["complete", "partial", "unknown"]) {
      snapshot.accounting = { distance, fuel };
      expect(validate(fixture), ajv.errorsText(validate.errors)).toBe(true);
    }
  for (const accounting of [
    { distance: "complete" },
    { fuel: "partial" },
    { distance: "complete", fuel: "partial", extra: "fictional" },
    { distance: "whole", fuel: "partial" },
    { distance: "complete", fuel: null },
    { distance: true, fuel: "partial" },
    "complete",
    null,
  ]) {
    snapshot.accounting = accounting;
    expect(validate(fixture)).toBe(false);
  }
  snapshot.accounting = { distance: "complete", fuel: "partial" };
  const audit = snapshot.hardModeResult;
  delete snapshot.hardModeResult;
  expect(validate(fixture)).toBe(false);
  snapshot.hardModeResult = audit;
  delete snapshot.accounting;
  expect(validate(fixture)).toBe(false);
  for (const name of ["completed", "haulmp-audited"] as const) {
    const earlier = telemetryFixture(name);
    expect(validate(earlier), ajv.errorsText(validate.errors)).toBe(true);
    (earlier.snapshot as Record<string, unknown>).accounting = {
      distance: "complete",
      fuel: "complete",
    };
    expect(validate(earlier)).toBe(false);
  }
  expect(validate({ ...telemetryFixture("accounting"), contract: { major: 1, minor: 3 } })).toBe(
    false,
  );
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
