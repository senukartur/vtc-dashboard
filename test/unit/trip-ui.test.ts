import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { tripTranslations } from "../../apps/web/src/features/trips/translations.ts";
import {
  attemptFor,
  canonicalDecimal,
  proposalResult,
  revisionFields,
  schema,
  tripFilters,
} from "../../apps/web/src/features/trips/transport.ts";

const cases = JSON.parse(
  readFileSync(new URL("../../docs/contracts/dashboard/examples.json", import.meta.url), "utf8"),
).cases;
test("generated trip runtime envelopes accept reviewed fixtures and reject private summary additions", () => {
  const operations: Record<string, Parameters<typeof schema>[0]> = {
    getTrip: "EnvelopeTripView",
    listTrips: "EnvelopeListTripSummary",
    getTripReview: "EnvelopeReview",
    getManualReport: "EnvelopeManualReport",
    getMyManualDraft: "EnvelopeManualDraft",
    getTripProposal: "EnvelopeTripProposal",
    decideTripProposal: "EnvelopeTripProposalDecision",
    listTripReconciliations: "EnvelopeListReconciliation",
    getEvidence: "EnvelopeEvidence",
  };
  for (const fixture of cases) {
    const name = operations[fixture.operationId];
    if (name && fixture.status === 200)
      expect(schema(name).safeParse(fixture.response).success, fixture.id).toBe(true);
  }
  const summary = cases.find((f: { id: string }) => f.id === "getTrip:success").response;
  expect(
    schema("EnvelopeTripView").safeParse({ ...summary, data: { ...summary.data, evidence: [] } })
      .success,
  ).toBe(false);
});
test("URL scope validation cannot grant review or invent unsupported filters", () => {
  expect(
    tripFilters(new URLSearchParams("scope=review&game=ets2&decision=accepted&search=secret")),
  ).toEqual({ scope: "mine", game: "ets2", decision: "accepted" });
  expect(tripFilters(new URLSearchParams("scope=review&game=wrong&decision=wrong"), true)).toEqual({
    scope: "review",
    game: undefined,
    decision: undefined,
  });
});
test("quantities remain exact including zero and very large values", () => {
  expect(canonicalDecimal("0,000")).toBe("0");
  expect(canonicalDecimal("9007199254740993123.4500")).toBe("9007199254740993123.45");
  for (const v of ["-1", "1e4", "01", "", "NaN"]) expect(canonicalDecimal(v)).toBeUndefined();
});
test("identical uncertain commands retain keys while input target or ETag changes invalidate them", () => {
  const first = attemptFor('["PUT","/draft","v1","same-bytes"]', null);
  expect(attemptFor(first.fingerprint, first)).toBe(first);
  expect(attemptFor("changed-payload", first).key).not.toBe(first.key);
  expect(attemptFor("changed-etag", first).key).not.toBe(first.key);
});
test("legacy and extended manual revisions preserve canonical pins and proposal rejection union", () => {
  const legacy = cases.find((f: { id: string }) => f.id === "getManualRevision:success")?.response
    .data;
  if (!legacy) throw Error("MISSING_FIXTURE");
  const fields = revisionFields(legacy);
  expect(fields.origin.status).toBe("resolved");
  expect(fields.evidenceIds.length).toBeGreaterThan(0);
  const rejected = cases.find(
    (f: { id: string }) => f.id === "decideTripProposal:reject-before-first-decision",
  ).response.data;
  expect(proposalResult(rejected)).toBe("proposal");
  expect(Object.keys(tripTranslations.en).sort()).toEqual(Object.keys(tripTranslations.ru).sort());
});

test("conditional runtime adapter preserves resolution links and proposal changes constraints", () => {
  const reason = "Synthetic supported correction",
    id = crypto.randomUUID();
  expect(
    schema("ResolutionInput").safeParse({ reason, evidenceIds: [], correctionRequestId: id })
      .success,
  ).toBe(false);
  expect(
    schema("ResolutionInput").safeParse({ reason, evidenceIds: [], correctionRequestId: null })
      .success,
  ).toBe(false);
  for (const correctionRequestId of [undefined, null, id]) {
    const body = {
      reason,
      evidenceIds: [],
      actualDistanceM: "0",
      ...(correctionRequestId === undefined ? {} : { correctionRequestId }),
    };
    expect(schema("ResolutionInput").safeParse(body).success).toBe(true);
  }
  const proposal = cases.find((f: { id: string }) => f.id === "getTripProposal:success").response
    .data;
  expect(
    schema("TripProposal").safeParse({ ...proposal, kind: "resolution", changes: null }).success,
  ).toBe(false);
  expect(
    schema("TripProposal").safeParse({
      ...proposal,
      kind: "resolution",
      changes: { actualDistanceM: "0" },
    }).success,
  ).toBe(true);
});

test("conditional importer matches authoritative generated AJV semantics on positive and negative revisions", async () => {
  const { createSchemaValidator } = await import("../../apps/api/src/platform/http/schemas.ts"),
    ajv = createSchemaValidator(),
    id = crypto.randomUUID(),
    base = { reason: "Fictional supported correction", evidenceIds: [] };
  const inputs = [
    base,
    { ...base, correctionRequestId: id },
    { ...base, correctionRequestId: null },
    { ...base, actualDistanceM: "0" },
    { ...base, actualDistanceM: "0", correctionRequestId: id },
    { ...base, actualDistanceM: "0", correctionRequestId: null },
    { ...base, actualDistanceM: 0 },
    { ...base, actualDistanceM: "1", correctionRequestId: 12 },
    { ...base, actualDistanceM: "1", extra: "forbidden" },
  ];
  const validate = ajv.compile({ $ref: "urn:vtc:browser:v1#/$defs/ResolutionInput" });
  for (const value of inputs)
    expect(schema("ResolutionInput").safeParse(value).success).toBe(!!validate(value));
  const proposal = cases.find((f: { id: string }) => f.id === "getTripProposal:success").response
      .data,
    check = ajv.compile({ $ref: "urn:vtc:browser:v1#/$defs/TripProposal" });
  for (const kind of ["resolution", "correction_request", "invalid"])
    for (const changes of [null, {}, { actualDistanceM: "0" }, { actualDistanceM: 0 }]) {
      const value = { ...proposal, kind, changes };
      expect(schema("TripProposal").safeParse(value).success).toBe(!!check(value));
    }
});
