import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { expect, test } from "vitest";
import type { companionComponents } from "@vtc/contracts";
import { compareDecimal } from "../../apps/api/src/modules/sources/contracts/decimal.ts";

const schemas = JSON.parse(
  readFileSync(
    new URL("../../packages/contracts/src/generated/companion-schemas.json", import.meta.url),
    "utf8",
  ),
);
const fixtures = JSON.parse(
  readFileSync(
    new URL("../../docs/contracts/examples/telemetry-companion-v1.json", import.meta.url),
    "utf8",
  ),
) as { name: string; schema: string; value: Record<string, unknown> }[];
const ajv = new Ajv2020({
  strict: true,
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
});
addFormats.default(ajv);
ajv.addSchema(schemas);
for (const fixture of fixtures)
  test(fixture.name, () => {
    const validate = ajv.compile({ $ref: `urn:vtc:companion:v1#/$defs/${fixture.schema}` });
    expect(validate(fixture.value), ajv.errorsText(validate.errors)).toBe(true);
    expect(validate({ ...fixture.value, privateNotes: "forbidden" })).toBe(false);
  });
test("positive fixtures agree with their exact rule observations and selected trailer limits", () => {
  for (const fixture of fixtures.filter((f) => f.schema === "Preview")) {
    const value = fixture.value as unknown as companionComponents["schemas"]["Preview"];
    expect(value.outcome, fixture.name).toBe(
      value.basis === "unavailable"
        ? "unknown"
        : value.rules.some((r) => r.result === "fail")
          ? "fail"
          : value.rules.some((r) => r.result === "unknown")
            ? "unknown"
            : "pass",
    );
    for (const rule of value.rules) {
      if (value.assignment) {
        const limits = value.assignment.limits;
        if (rule.rule === "cargo_mass")
          expect([rule.minKg, rule.maxKg], fixture.name).toEqual([
            limits.massMinKg,
            limits.massMaxKg,
          ]);
        if (rule.rule === "distance")
          expect([rule.minM, rule.maxM], fixture.name).toEqual([
            limits.distanceMinM,
            limits.distanceMaxM,
          ]);
        if (rule.rule === "adr")
          expect([rule.mode, rule.allowedClasses], fixture.name).toEqual([
            limits.adr.mode,
            limits.adr.classes,
          ]);
        if (rule.rule === "hard_mode")
          expect(rule.required, fixture.name).toBe(limits.hardModeRequired);
      }
      if (value.eventExempt) {
        expect(rule.result, fixture.name).toBe("pass");
        expect(rule.reasons, fixture.name).toContain("event_attendance_exemption");
      }
      if (rule.rule === "trailer_types" && value.assignment) {
        expect(rule.mode, fixture.name).toBe(value.assignment.limits.trailers.mode);
        expect(rule.allowedIds, fixture.name).toEqual(value.assignment.limits.trailers.typeIds);
      }
      if (value.eventExempt || rule.result !== "pass") continue;
      if (rule.rule === "distance" && (rule.minM !== null || rule.maxM !== null)) {
        expect(rule.observedM, fixture.name).not.toBeNull();
        if (rule.observedM !== null && rule.minM !== null)
          expect(compareDecimal(rule.observedM, rule.minM), fixture.name).toBeGreaterThanOrEqual(0);
        if (rule.observedM !== null && rule.maxM !== null)
          expect(compareDecimal(rule.observedM, rule.maxM), fixture.name).toBeLessThanOrEqual(0);
      }
      if (rule.rule === "hard_mode" && rule.required)
        expect(rule.observed, fixture.name).toBe("qualified");
    }
  }
});
test("receipt and current-assessment fixtures certify the exact requested immutable envelope", () => {
  for (const fixture of fixtures.filter((f) => f.schema === "ResultBatch"))
    for (const item of (fixture.value as unknown as companionComponents["schemas"]["ResultBatch"])
      .items) {
      if (item.receipt === "received") {
        expect(item.requestedSourceMessageId, fixture.name).not.toBeNull();
        expect(item.canonicalTripId, fixture.name).not.toBeNull();
        expect(item.latestSourceRevision, fixture.name).toBeGreaterThanOrEqual(
          item.requestedRevision,
        );
      }
      if (item.assessmentBasis === "current" && item.assessment) {
        expect(item.assessment.sourceEventId, fixture.name).toBe(item.requestedEventId);
        expect(item.assessment.sourceRevision, fixture.name).toBe(item.requestedRevision);
        expect(item.assessment.sourceMessageId, fixture.name).toBe(item.requestedSourceMessageId);
        expect(item.assessment.assessedSource, fixture.name).toEqual(item.source);
      }
    }
});
test("exact decimal and batch bounds reject rounding, invented targets and oversized work", () => {
  const decimal = ajv.compile({ $ref: "urn:vtc:companion:v1#/$defs/Decimal" });
  for (const value of ["0", "0.000000000000000001", "99999999999999999999.999999999999999999"])
    expect(decimal(value)).toBe(true);
  for (const value of [
    0,
    "00",
    "1.0",
    "-1",
    "1e3",
    "100000000000000000000",
    "0.0000000000000000001",
  ])
    expect(decimal(value)).toBe(false);
  const fixture = fixtures.find((f) => f.schema === "ResultBatchInput");
  if (!fixture) throw new Error("SYNTHETIC_BATCH_FIXTURE_REQUIRED");
  const input = fixture.value;
  const validate = ajv.compile({ $ref: "urn:vtc:companion:v1#/$defs/ResultBatchInput" });
  expect(validate({ ...input, items: [] })).toBe(false);
  expect(validate({ ...input, items: Array(26).fill((input.items as unknown[])[0]) })).toBe(false);
  expect(validate({ ...input, memberId: "foreign" })).toBe(false);
});
