import { expect, test } from "vitest";
import { createSchemaValidator } from "../../apps/api/src/platform/http/schemas.ts";

const valid = (name: string) =>
  createSchemaValidator().compile({ $ref: `urn:vtc:browser:v1#/$defs/${name}` });
const sample = {
  game: "ets2",
  rules: [],
  sample: {
    cargoMassKg: null,
    trailerTypeIds: [null],
    trailersComplete: false,
    adr: { status: "unknown", entityId: null },
  },
};
test("preview wire facts and safe results are closed, bounded and carry no decision authority", () => {
  expect(valid("QualificationPreviewInput")(sample)).toBe(true);
  for (const field of ["ownerId", "sourcePayload", "accepted", "confirmedEvent", "assignmentId"])
    expect(valid("QualificationPreviewInput")({ ...sample, [field]: true })).toBe(false);
  expect(
    valid("QualificationPreviewInput")({
      ...sample,
      sample: { ...sample.sample, trailerTypeIds: Array(33).fill(null) },
    }),
  ).toBe(false);
  expect(
    valid("QualificationPreviewInput")({
      ...sample,
      sample: { ...sample.sample, reasonCode: "cargo_not_adr" },
    }),
  ).toBe(false);
  const result = {
    outcome: "unknown",
    ruleResults: [{ ruleType: "max_mass", outcome: "unknown", reasonCode: "rule_mass_unknown" }],
  };
  expect(valid("QualificationPreview")(result)).toBe(true);
  expect(
    valid("QualificationPreview")({
      ...result,
      ruleResults: [{ ...result.ruleResults[0], reasonCode: "raw_engine_diagnostic" }],
    }),
  ).toBe(false);
  expect(
    valid("QualificationPreview")({
      ...result,
      ruleResults: [{ ...result.ruleResults[0], observed: { private: true } }],
    }),
  ).toBe(false);
});
