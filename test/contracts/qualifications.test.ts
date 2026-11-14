import { readFileSync } from "node:fs";
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
    adr: { status: "unknown", adrClass: null },
  },
};
test("archived assignment choices expose only bounded same-game level labels", () => {
  const parse = valid("EnvelopeListQualificationArchivedLevel");
  const item = {
    id: "41000000-0000-4000-8000-000000000001",
    game: "ats",
    name: "Fictional archived level",
  };
  const reply = (items: unknown[]) => ({
    data: { items, nextCursor: null },
    meta: { requestId: "synthetic-request" },
  });
  expect(parse(reply([item]))).toBe(true);
  expect(parse(reply(Array(101).fill(item)))).toBe(false);
  expect(parse(reply([{ ...item, game: "other" }]))).toBe(false);
  for (const property of ["code", "position", "reason", "rules", "currentDriverCount"])
    expect(parse(reply([{ ...item, [property]: null }]))).toBe(false);
});
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

test("staff action projections are additive and closed without extending existing safe histories", () => {
  const id = "00000000-0000-4000-8000-000000000001",
    instant = "2026-10-20T12:00:00.000Z";
  const history = {
    id,
    periodId: id,
    game: "ets2",
    levelId: id,
    levelName: "Fictional level",
    assignedAt: instant,
    endedAt: null,
  };
  const actor = { id, nickname: "Fictional current nickname" };
  const action = {
    ...history,
    purpose: "promotion",
    actor,
    promotion: { id, confirmedAt: instant },
  };
  expect(valid("AssignmentHistory")(history)).toBe(true);
  expect(valid("AssignmentHistory")(action)).toBe(false);
  expect(valid("QualificationActionHistory")(action)).toBe(true);
  expect(
    valid("QualificationActionHistory")({
      ...action,
      purpose: "ladder_archive_transfer",
      promotion: null,
    }),
  ).toBe(true);
  expect(valid("QualificationActionHistory")({ ...action, actor: null, promotion: null })).toBe(
    true,
  );
  expect(valid("QualificationActionHistory")({ ...action, actor: { id, nickname: null } })).toBe(
    true,
  );
  for (const extra of [
    { reason: "private" },
    { recordedAt: instant },
    { email: "fiction@example.invalid" },
  ])
    expect(valid("QualificationActionHistory")({ ...action, ...extra })).toBe(false);
  expect(
    valid("QualificationActionHistory")({ ...action, actor: { ...actor, roles: ["director"] } }),
  ).toBe(false);
  const rule = {
    id,
    levelId: id,
    game: "ets2",
    publishedAt: instant,
    effectiveAt: instant,
    rules: [],
    requiredTrips: null,
    requiredDistanceM: null,
  };
  expect(valid("QualificationRuleVersion")({ ...rule, publisher: actor })).toBe(false);
  expect(valid("QualificationRuleHistory")({ ...rule, publisher: actor })).toBe(true);
  expect(valid("QualificationRuleHistory")({ ...rule, publisher: actor, reason: "private" })).toBe(
    false,
  );
});

test("freight summary keeps omitted restrictions and empty allowlists distinct and exposes no row IDs", () => {
  const validate = valid("QualificationFreightRuleSummary");
  const unrestricted = {
    maxMassKg: null,
    allowedTrailerTypeCount: null,
    allowedAdrCategoryCount: null,
  };
  expect(validate(unrestricted)).toBe(true);
  expect(
    validate({
      ...unrestricted,
      maxMassKg: "10000.000000000000000001",
      allowedTrailerTypeCount: 0,
    }),
  ).toBe(true);
  expect(validate({ ...unrestricted, allowedTrailerTypeCount: 1001 })).toBe(false);
  expect(validate({ ...unrestricted, entityIds: [] })).toBe(false);
});

test("staged qualification publication accepts an optional nonempty reason and keeps preview separate", () => {
  const read = (name: string) =>
    JSON.parse(
      readFileSync(new URL(`../../docs/contracts/dashboard/${name}`, import.meta.url), "utf8"),
    );
  const spec = read("openapi.json");
  const operation = spec.paths["/api/v1/admin/qualification-levels/{levelId}/rule-versions"].post;
  expect(operation.requestBody.content["application/json"].schema.$ref).toBe(
    "#/components/schemas/QualificationRulePublicationInput",
  );
  expect(operation).toMatchObject({
    "x-capability": "qualifications.manage",
    "x-guards": expect.arrayContaining(["immutable_effective_versions"]),
    security: [{ sessionCookie: [], csrfHeader: [] }],
  });

  const fixtures = read("examples.json").cases;
  const fixture = (id: string) => fixtures.find((example: { id: string }) => example.id === id);
  const immediate = fixture("publishQualificationRules:without-reason");
  const without = immediate.request;
  expect(immediate.status).toBe(201);
  expect(immediate.response.data).toMatchObject({
    configured: true,
    version: 2,
    ruleVersionId: expect.any(String),
  });
  const withReason = fixture("publishQualificationRules:success").request;
  const publication = valid("QualificationRulePublicationInput");
  const live = valid("RulesInput");
  expect(without).toEqual({ rules: [], requiredTrips: null, requiredDistanceM: null });
  expect(publication(without)).toBe(true);
  expect(publication(withReason)).toBe(true);
  expect(live(withReason)).toBe(true);
  expect(live(without)).toBe(false);
  for (const reason of ["", "   ", null, 1, "x".repeat(2049)]) {
    expect(publication({ ...without, reason })).toBe(false);
  }
  for (const changes of [
    { requiredTrips: undefined },
    { requiredDistanceM: undefined },
    { sample: sample.sample },
    { publisherId: "private" },
    { publishedAt: "2026-10-20T12:00:00.000Z" },
    { effectiveAt: "2026-10-20T12:00:00.000+00:00" },
  ]) {
    expect(publication({ ...without, ...changes })).toBe(false);
  }
});

test("Stage 3 company history accepts both promotion proof and ordinary assignment rows", () => {
  const examples = JSON.parse(
    readFileSync(new URL("../../docs/contracts/dashboard/examples.json", import.meta.url), "utf8"),
  );
  const response = examples.cases.find(
    (c: { id: string }) => c.id === "listPromotionHistory:stage-3-history",
  ).response;
  const check = valid("QualificationStage3PromotionHistoryListEnvelope");
  expect(response.data.items.map((item: { kind: string }) => item.kind)).toEqual([
    "promotion",
    "assignment",
  ]);
  expect(check(response)).toBe(true);
  const [promotion, assignment] = response.data.items;
  expect(
    check({
      ...response,
      data: { ...response.data, items: [{ ...assignment, confirmedAt: promotion.confirmedAt }] },
    }),
  ).toBe(false);
  expect(
    check({
      ...response,
      data: { ...response.data, items: [{ ...promotion, kind: "assignment" }] },
    }),
  ).toBe(false);
});
