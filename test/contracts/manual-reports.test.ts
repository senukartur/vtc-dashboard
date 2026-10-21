import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { components } from "@vtc/contracts";
import { expect, test } from "vitest";
import { createSchemaValidator } from "../../apps/api/src/platform/http/schemas.ts";

type S = components["schemas"];
const examples = JSON.parse(
  readFileSync(new URL("../../docs/contracts/dashboard/examples.json", import.meta.url), "utf8"),
) as {
  cases: { id: string; operationId: string; request?: unknown; response: { data?: unknown } }[];
};
const fixture = (id: string) => {
  const value = examples.cases.find((item) => item.id === id);
  if (!value) throw new Error(`MISSING_SYNTHETIC_FIXTURE: ${id}`);
  return structuredClone(value);
};
const validator = createSchemaValidator();
const valid = (name: keyof S, value: unknown) =>
  validator.compile({ $ref: `urn:vtc:browser:v1#/$defs/${name}` })(value);
const request = fixture("submitManualReport:success").request as S["ManualReportInput"];

test("published legacy manual schema objects remain unchanged from the contract-stage base", () => {
  const spec = JSON.parse(
    readFileSync(new URL("../../docs/contracts/dashboard/openapi.json", import.meta.url), "utf8"),
  ) as { components: { schemas: Record<string, unknown> } };
  // Serialized schema-object hashes from ef6f2a5; whitespace outside objects is irrelevant.
  for (const [name, expected] of [
    ["ManualInput", "8061f266cc93442c5b7d44b971ca657383ab05bf76b90820c0657462f0e0d1b3"],
    ["ManualRevision", "6d3137675bdc843a9e031fd1b277ef561f4d9e57e4bda00fc77afb4d702c3073"],
  ] as const)
    expect(
      createHash("sha256").update(JSON.stringify(spec.components.schemas[name])).digest("hex"),
    ).toBe(expected);
});

test("resolved legacy payloads and omitted optional writes remain compatible without widening legacy readback", () => {
  const legacy = fixture("submitManualTrip:success").request;
  expect(valid("ManualInput", legacy)).toBe(true);
  expect(valid("ManualResolvedInput", legacy)).toBe(true);
  const omitted = fixture("submitManualTrip:omitted-optionals").request;
  expect(valid("ManualResolvedInput", omitted)).toBe(true);
  expect(valid("ManualInput", omitted)).toBe(false);
  expect(valid("ManualRevision", fixture("getManualRevision:success").response.data)).toBe(true);
  expect(valid("ManualInput", request.fields)).toBe(false);
});

test("partial drafts do not weaken complete submission, target version or evidence requirements", () => {
  expect(valid("ManualDraftInput", { fields: {} })).toBe(true);
  expect(valid("ManualDraftInput", { fields: { evidenceIds: [] }, targetTrip: null })).toBe(true);
  expect(valid("ManualReportInput", request)).toBe(true);
  expect(valid("ManualDraftSubmission", { fields: request.fields })).toBe(true);
  for (const name of ["ManualReportInput", "ManualDraftSubmission"] as const) {
    expect(valid(name, { fields: {} })).toBe(false);
    expect(valid(name, { fields: { ...request.fields, evidenceIds: [] } })).toBe(false);
    for (const missing of [
      "game",
      "origin",
      "destination",
      "cargo",
      "cargoMassKg",
      "trailerType",
      "actualDistanceM",
      "evidenceIds",
    ]) {
      const fields = { ...request.fields } as Record<string, unknown>;
      delete fields[missing];
      expect(valid(name, { fields })).toBe(false);
    }
  }
  for (const targetTrip of [
    { tripId: request.targetTrip?.tripId },
    { tripId: request.targetTrip?.tripId, expectedVersion: 0 },
    { tripId: request.targetTrip?.tripId, expectedVersion: "2" },
    { ...request.targetTrip, ownerId: request.targetTrip?.tripId },
  ])
    expect(valid("ManualReportInput", { ...request, targetTrip })).toBe(false);
  expect(valid("ManualReportRevisionInput", { fields: request.fields })).toBe(false);
  expect(
    valid("ManualReportRevisionInput", { fields: request.fields, expectedTripVersion: 3 }),
  ).toBe(true);
  for (const value of [12500.5, "-1", "1.00", "1e3", "01", null])
    expect(valid("ManualSubmissionFields", { ...request.fields, actualDistanceM: value })).toBe(
      false,
    );
  expect(valid("ManualSubmissionFields", { ...request.fields, actualDistanceM: "0" })).toBe(true);
});

test("submitted catalog selections are disjoint diagnostics or real pinned identities", () => {
  expect(valid("ManualCatalogSelection", request.fields.origin)).toBe(true);
  expect(valid("ManualCatalogSelection", request.fields.cargo)).toBe(true);
  for (const selection of [
    { status: "resolved", entityId: request.targetTrip?.tripId },
    { status: "unresolved", entityId: request.targetTrip?.tripId },
    { ...request.fields.cargo, entityId: request.targetTrip?.tripId },
    { ...request.fields.origin, label: "Fictional extra label" },
    { ...request.fields.cargo, reasonCode: "automatically_accepted" },
    { ...request.fields.cargo, label: "x".repeat(257) },
    { ...request.fields.cargo, context: "x".repeat(513) },
    { status: "unknown" },
    null,
  ])
    expect(valid("ManualCatalogSelection", selection)).toBe(false);
});

test("manual authority and timing inputs fail closed at every new write DTO boundary", () => {
  const inputs = {
    ManualDraftInput: { fields: {} },
    ManualDraftSubmission: { fields: request.fields },
    ManualReportInput: request,
    ManualReportRevisionInput: { fields: request.fields, expectedTripVersion: 3 },
  };
  for (const [name, input] of Object.entries(inputs))
    for (const field of [
      "ownerId",
      "tripDate",
      "submittedAt",
      "actualStartedAt",
      "accepted",
      "qualificationId",
      "attendanceConfirmed",
      "staffApproved",
      "unknownField",
    ]) {
      expect(valid(name as keyof S, { ...input, [field]: "forbidden" })).toBe(false);
      expect(
        valid(name as keyof S, { ...input, fields: { ...input.fields, [field]: "forbidden" } }),
      ).toBe(false);
    }
  for (const fields of [request.fields, { ...request.fields, eventId: null, comment: null }])
    expect(valid("ManualSubmissionFields", fields)).toBe(true);
  expect(valid("ManualReportFields", request.fields)).toBe(false);
  expect(valid("ManualReportFields", { ...request.fields, eventId: null, comment: null })).toBe(
    true,
  );
});

// Compile-time consumer: callers must narrow both the revision format and catalog fact.
function originalCargo(revision: S["ManualRevisionRead"]): string {
  if ("representation" in revision) {
    const cargo = revision.fields.cargo;
    return cargo.status === "resolved" ? cargo.entityId : cargo.label;
  }
  return revision.fields.cargoId;
}

test("existing and new history endpoints retain mixed immutable revisions and typed consumers narrow them", () => {
  for (const operation of ["listManualRevisions", "listManualReportRevisions"]) {
    const data = fixture(
      `${operation}:${operation === "listManualRevisions" ? "extended-history" : "mixed-history"}`,
    ).response.data as S["ListManualRevision"];
    expect(valid("ListManualRevision", data)).toBe(true);
    expect(data.items).toHaveLength(2);
    expect(data.items.map(originalCargo)).toEqual([
      "Fictional cargo",
      "41000000-0000-4000-8000-000000000013",
    ]);
    for (const revision of data.items) {
      expect(valid("ManualRevisionRead", { ...revision, accepted: true })).toBe(false);
      if ("representation" in revision) {
        expect(valid("ManualRevision", revision)).toBe(false);
        const changed = { ...revision, fields: { ...revision.fields, ownerId: "forbidden" } };
        expect(valid("ManualRevisionRead", changed)).toBe(false);
      }
    }
  }
  expect(valid("TripView", fixture("getTrip:extended-manual-revision").response.data)).toBe(true);
});

test("all new read DTOs reject private storage fields and correction requests remain distinct from proposals", () => {
  for (const [name, operation] of [
    ["ManualDraft", "getMyManualDraft"],
    ["ManualReport", "getManualReport"],
    ["ManualReportRevision", "getManualReportRevision"],
    ["ManualCorrectionRequest", "getTripCorrectionRequest"],
  ] as const) {
    const data = fixture(`${operation}:success`).response.data;
    expect(valid(name, data)).toBe(true);
    for (const field of ["storagePath", "objectGeneration", "authorization", "proposalId"])
      expect(valid(name, { ...(data as object), [field]: "forbidden" })).toBe(false);
  }
  const correction = fixture("getTripCorrectionRequest:success").response.data;
  expect(valid("TripProposal", correction)).toBe(false);
  expect(valid("ManualCorrectionRequest", { ...(correction as object), baseTripVersion: 0 })).toBe(
    false,
  );
  const evidence = fixture("getEvidence:success").response.data;
  expect(valid("Evidence", { ...(evidence as object), state: "deleting" })).toBe(false);
});
