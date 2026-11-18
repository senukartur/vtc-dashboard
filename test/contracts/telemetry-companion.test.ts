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

type BoundedSchema = {
  $ref?: string;
  type?: string;
  pattern?: string;
  const?: string | number | boolean | null;
  enum?: (string | number | boolean | null)[];
  oneOf?: BoundedSchema[];
  anyOf?: BoundedSchema[];
  properties?: Record<string, BoundedSchema>;
  additionalProperties?: boolean;
  items?: BoundedSchema;
  maxItems?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
};
// Only these complete anchored patterns admit ASCII without JSON escape characters.
// Unknown patterns/format-only strings retain the six-byte bound.
const unescapedAsciiPatterns = new Set([
  "^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$",
  "^[A-Za-z0-9_-]{43}$",
  "^(?:type:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|common:(?:ets2|ats):[0-9a-f]{2,256}|undefined)$",
]);
/** Includes keys, delimiters, every optional property and the largest union alternative. */
function encodedCeiling(schema: BoundedSchema, seen = new Set<string>()): number {
  if (schema.$ref) {
    const name = schema.$ref.split("/").at(-1)!;
    if (seen.has(name) || !schemas.$defs[name]) throw new Error("UNBOUNDED_REFERENCE");
    return encodedCeiling(schemas.$defs[name], new Set([...seen, name]));
  }
  if (schema.const !== undefined) return Buffer.byteLength(JSON.stringify(schema.const));
  if (schema.enum)
    return Math.max(...schema.enum.map((value) => Buffer.byteLength(JSON.stringify(value))));
  const alternatives = schema.oneOf ?? schema.anyOf;
  if (alternatives) return Math.max(...alternatives.map((value) => encodedCeiling(value, seen)));
  switch (schema.type) {
    case "null":
      return 4;
    case "boolean":
      return 5;
    case "integer": {
      if (!Number.isSafeInteger(schema.minimum) || !Number.isSafeInteger(schema.maximum))
        throw new Error("UNBOUNDED_INTEGER");
      return Math.max(String(schema.minimum).length, String(schema.maximum).length);
    }
    case "string": {
      if (!Number.isSafeInteger(schema.maxLength) || schema.maxLength! < 0)
        throw new Error("UNBOUNDED_STRING");
      // JSON.stringify uses at most six bytes per codepoint: escaped C0/lone surrogate;
      // valid supplementary characters remain UTF-8 (at most four bytes), not escaped pairs.
      return 2 + (unescapedAsciiPatterns.has(schema.pattern ?? "") ? 1 : 6) * schema.maxLength!;
    }
    case "array": {
      if (!Number.isSafeInteger(schema.maxItems) || schema.maxItems! < 0 || !schema.items)
        throw new Error("UNBOUNDED_ARRAY");
      return (
        2 +
        schema.maxItems! * encodedCeiling(schema.items, seen) +
        Math.max(0, schema.maxItems! - 1)
      );
    }
    case "object": {
      if (schema.additionalProperties !== false || !schema.properties)
        throw new Error("UNBOUNDED_OBJECT");
      const properties = Object.entries(schema.properties);
      return (
        2 +
        Math.max(0, properties.length - 1) +
        properties.reduce(
          (total, [key, value]) =>
            total + Buffer.byteLength(JSON.stringify(key)) + 1 + encodedCeiling(value, seen),
          0,
        )
      );
    }
    default:
      throw new Error("UNBOUNDED_SCHEMA_TYPE");
  }
}

test("every output has a finite encoded ceiling and one complete result always fits below 1 MiB", () => {
  for (const name of ["Capabilities", "Qualification", "Preview", "ResultBatch", "Error"])
    expect(Number.isSafeInteger(encodedCeiling(schemas.$defs[name])), name).toBe(true);
  const single = structuredClone(schemas.$defs.ResultBatch);
  single.properties.items.maxItems = 1;
  const ceiling = encodedCeiling(single);
  expect(ceiling).toBeLessThan(1048576);
  expect(encodedCeiling(schemas.$defs.Result)).toBeLessThan(ceiling);
  const fixture = fixtures.find(
    (value) => value.name === "single-result-maximum-arrays-and-json-escaping",
  );
  if (!fixture) throw new Error("MAXIMUM_RESULT_FIXTURE_REQUIRED");
  const body = fixture.value as unknown as companionComponents["schemas"]["ResultBatch"];
  const assessment = body.items[0]!.assessment!;
  expect(body.items).toHaveLength(1);
  expect(assessment.trailerDisplay).toHaveLength(110);
  expect(assessment.limits!.trailers.typeIds).toHaveLength(100);
  const trailers = assessment.rules.find((rule) => rule.rule === "trailer_types");
  expect(trailers?.observedIds).toHaveLength(10);
  expect(assessment.rules).toHaveLength(5);
  expect(assessment.trailerComparison!.entries).toHaveLength(1010);
  expect(
    assessment.trailerDisplay.every(
      (row) => row.nameEn?.length === 256 && row.nameRu?.length === 256,
    ),
  ).toBe(true);
  const bytes = Buffer.byteLength(JSON.stringify(body));
  expect(JSON.stringify(body)).toContain("\\u0001");
  console.info(
    JSON.stringify({
      event: "companion_response_ceiling",
      singleItemBytes: ceiling,
      fixtureBytes: bytes,
    }),
  );
  expect(bytes).toBeGreaterThan(800000);
  expect(encodedCeiling({ type: "string", format: "uuid", maxLength: 36 } as BoundedSchema)).toBe(
    218,
  );
  expect(encodedCeiling({ type: "string", pattern: "^.*$", maxLength: 36 })).toBe(218);
  expect(bytes).toBeLessThanOrEqual(ceiling);
  for (const value of ["\u0001", "\ud800", "😀", "\\", '"'])
    expect(Buffer.byteLength(JSON.stringify(value))).toBeLessThanOrEqual(2 + 6 * [...value].length);
  for (const unbounded of [
    { type: "string" },
    { type: "array", items: { type: "boolean" } },
    { type: "integer", minimum: 0 },
    { type: "object", properties: {}, additionalProperties: true },
  ])
    expect(() => encodedCeiling(unbounded)).toThrow(/UNBOUNDED/);
});

test("output timestamps use bounded canonical UTC milliseconds while input compatibility is preserved", () => {
  const output = ajv.compile({ $ref: "urn:vtc:companion:v1#/$defs/TrailerDisplay" });
  const row = {
    id: "00000000-0000-4000-8000-000000000001",
    code: null,
    groupCode: null,
    nameEn: null,
    nameRu: null,
    basis: "current_catalog",
    identityKind: "unavailable",
    classification: { state: "unavailable" },
    asOf: "2026-11-18T12:00:00.000Z",
  };
  expect(output(row)).toBe(true);
  for (const asOf of [
    "2026-11-18T12:00:00Z",
    "2026-11-18T12:00:00.000000Z",
    "2026-11-18T12:00:00.000+00:00",
  ])
    expect(output({ ...row, asOf })).toBe(false);
  const input = ajv.compile({ $ref: "urn:vtc:companion:v1#/$defs/PreviewInput" });
  const fixture = fixtures.find((value) => value.schema === "PreviewInput");
  if (!fixture) throw new Error("PREVIEW_INPUT_FIXTURE_REQUIRED");
  expect(input({ ...fixture.value, start: { utc: "2026-11-18T12:00:00Z", basis: "actual" } })).toBe(
    true,
  );
});

test("the permanent split hint is closed and never a transient retry signal", () => {
  const fixture = fixtures.find(
    (value) => value.name === "result-batch-too-large-permanent-split-hint",
  );
  if (!fixture) throw new Error("PERMANENT_SPLIT_FIXTURE_REQUIRED");
  expect(fixture.value).toEqual({
    error: { code: "RESULT_BATCH_TOO_LARGE", retryable: false },
    requestId: expect.any(String),
  });
  const validate = ajv.compile({ $ref: "urn:vtc:companion:v1#/$defs/Error" });
  expect(
    validate({
      ...fixture.value,
      error: { ...(fixture.value.error as object), message: "private" },
    }),
  ).toBe(false);
});

test("equal domain revisions revalidate presentation and legitimate A/B/A hashes remain request fenced", () => {
  const get = (name: string) => {
    const fixture = fixtures.find((value) => value.name === name);
    if (!fixture) throw new Error("PRESENTATION_FIXTURE_REQUIRED");
    return fixture.value as unknown as companionComponents["schemas"]["ResultBatch"];
  };
  const a = get("presentation-A-equal-domain-revision"),
    b = get("presentation-B-equal-domain-revision-current-request"),
    again = get("presentation-return-A-old-hash-legitimate-later-request"),
    stale = get("presentation-stale-request-A-ignore-even-at-equal-domain-revision");
  expect([a, b, again].map((value) => value.items[0]!.resultRevision)).toEqual(["12", "12", "12"]);
  expect(a.items[0]!.version).not.toBe(b.items[0]!.version);
  expect(again.items[0]!.version).toBe(a.items[0]!.version);
  const domain = (value: companionComponents["schemas"]["ResultBatch"]) => {
    const { version: _version, assessment, ...rest } = value.items[0]!;
    if (!assessment) throw new Error("RETAINED_FIXTURE_REQUIRED");
    const { trailerDisplay: _display, ...saved } = assessment;
    return { ...rest, assessment: saved };
  };
  expect(domain(b)).toEqual(domain(a));
  expect(domain(again)).toEqual(domain(a));
  const display = (value: companionComponents["schemas"]["ResultBatch"]) =>
    value.items[0]!.assessment!.trailerDisplay.map(({ asOf: _asOf, ...row }) => row);
  expect(display(again)).toEqual(display(a));
  expect(display(b)).not.toEqual(display(a));
  expect(again.requestId).not.toBe(stale.requestId);
  expect(stale.requestId).toBe(a.requestId);
});

test("owning unsigned versions/conditions and aggregate progress preserve their full legal ranges", () => {
  const scalar = (schema: unknown) => ajv.compile(schema);
  for (const definition of [
    schemas.$defs.LevelIdentity.properties.editVersion,
    schemas.$defs.Assessment.properties.decisionSequence,
    schemas.$defs.Conditions.properties.requiredTrips,
    schemas.$defs.Progress.properties.remainingTrips,
  ]) {
    const validate = scalar(definition);
    expect(validate(4294967295)).toBe(true);
    expect(validate(4294967296)).toBe(false);
  }
  const count = scalar(schemas.$defs.Progress.properties.creditedTrips);
  expect(count(Number.MAX_SAFE_INTEGER)).toBe(true);
  expect(count(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
  const aggregate = ajv.compile({ $ref: "urn:vtc:companion:v1#/$defs/AggregateDecimal" });
  expect(aggregate("199999999999999999999.999999999999999998")).toBe(true);
  expect(aggregate("1.0")).toBe(false);
  const individual = ajv.compile({ $ref: "urn:vtc:companion:v1#/$defs/Decimal" });
  expect(individual("199999999999999999999.999999999999999998")).toBe(false);
});
