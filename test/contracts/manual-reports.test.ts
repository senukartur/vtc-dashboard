import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { components } from "@vtc/contracts";
import { expect, test } from "vitest";
import { createSchemaValidator } from "../../apps/api/src/platform/http/schemas.ts";

type S = components["schemas"];
const contractFile = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`../../docs/contracts/dashboard/${name}`, import.meta.url), "utf8"),
  );
const examples = contractFile("examples.json") as {
  cases: {
    id: string;
    operationId: string;
    status: number;
    request?: unknown;
    path?: Record<string, string>;
    query?: Record<string, unknown>;
    headers?: Record<string, string>;
    responseHeaders?: Record<string, string>;
    response: { data?: unknown; error?: { code: string } };
  }[];
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
  const spec = contractFile("openapi.json");
  // Serialized schema-object hashes; whitespace outside objects is irrelevant. ManualRevision is
  // from ef6f2a5; ManualInput was re-pinned when VTC-084 dropped its catalog revision field.
  for (const [name, expected] of [
    ["ManualInput", "55467aa8de85770eb40847180bb4ed64cd32308a164286a4e6c8c7a861754991"],
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
    { status: "resolved" },
    { ...request.fields.origin, catalogRevisionId: request.targetTrip?.tripId },
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

test("staged manual requests retain closed legacy wire bodies and require complete dated submissions", () => {
  const spec = contractFile("openapi.json");
  const dated = fixture("submitManualReport:dated").request as S["ManualReportCreationInput"];
  const datedFields = dated.fields as S["ManualDatedSubmissionFields"];
  const cases = [
    [
      "submitManualDraft",
      "/api/v1/me/manual-drafts/{draftId}/submission",
      "ManualDraftFinalSubmissionInput",
      "ManualDraftSubmission",
    ],
    [
      "submitManualReport",
      "/api/v1/manual-reports",
      "ManualReportCreationInput",
      "ManualReportInput",
    ],
    [
      "reviseManualReport",
      "/api/v1/manual-reports/{reportId}/revisions",
      "ManualReportResubmissionInput",
      "ManualReportRevisionInput",
    ],
  ] as const;
  for (const [operation, path, staged, live] of cases) {
    const post = spec.paths[path].post;
    expect(post.requestBody.content["application/json"].schema.$ref).toBe(
      `#/components/schemas/${staged}`,
    );
    const old = fixture(`${operation}:success`).request;
    const next = fixture(`${operation}:dated`).request as {
      fields: Partial<S["ManualDatedSubmissionFields"]>;
    };
    expect(valid(live, old)).toBe(true);
    expect(valid(staged, old)).toBe(true);
    expect(valid(staged, next)).toBe(true);
    expect(valid(live, next)).toBe(false);
    for (const requiredDate of ["startedAt", "completedAt"] as const) {
      const incomplete = structuredClone(next);
      delete incomplete.fields[requiredDate];
      expect(valid(staged, incomplete)).toBe(false);
    }
    const withoutDates = structuredClone(next);
    delete withoutDates.fields.startedAt;
    delete withoutDates.fields.completedAt;
    expect(valid(staged, withoutDates)).toBe(false);
    for (const invalid of [
      { startedAt: "2026-02-30T12:00:00.000Z" },
      { completedAt: "2026-10-20T10:00:00+01:00" },
      { cargoDamagePercent: -0.01 },
      { cargoDamagePercent: 100.01 },
      { cargoDamagePercent: "0" },
      { originCompanyId: "synthetic-company" },
      { destinationCompanyId: "00000000-0000-0000-0000-000000000000" },
      { senderCompanyId: datedFields.originCompanyId },
      { receiverCompanyId: datedFields.destinationCompanyId },
      { reportingAt: datedFields.completedAt },
      { confirmedAt: datedFields.completedAt },
      { actualStartedAt: datedFields.startedAt },
      { actualCompletedAt: datedFields.completedAt },
      { accepted: true },
      { ownerId: datedFields.originCompanyId },
      { progressCredit: 1 },
      { labels: { origin: null } },
    ]) {
      expect(valid(staged, { ...next, fields: { ...next.fields, ...invalid } })).toBe(false);
    }
    expect(valid(staged, { ...next, progressCredit: 1 })).toBe(false);
  }
  for (const [path, operation] of [
    ["/api/v1/manual-trips", "submitManualTrip"],
    ["/api/v1/trips/{tripId}/manual-revisions", "reviseManualTrip"],
  ] as const) {
    expect(spec.paths[path].post.requestBody.content["application/json"].schema.$ref).toBe(
      "#/components/schemas/ManualResolvedInput",
    );
    expect(valid("ManualResolvedInput", fixture(`${operation}:success`).request)).toBe(true);
  }
});

test("staged draft fields are partial and draft labels are closed read-only projections", () => {
  const spec = contractFile("openapi.json");
  for (const post of [
    spec.paths["/api/v1/me/manual-drafts"].post,
    spec.paths["/api/v1/me/manual-drafts/{draftId}"].put,
  ]) {
    expect(post.requestBody.content["application/json"].schema.$ref).toBe(
      "#/components/schemas/ManualDraftWriteInput",
    );
  }
  const partial = fixture("createManualDraft:partial-reference-fields").request;
  const request = fixture("replaceManualDraft:reference-fields-and-labels").request;
  const read = fixture("replaceManualDraft:reference-fields-and-labels").response
    .data as S["ManualDraft"];
  expect(valid("ManualDraftWriteInput", { fields: {} })).toBe(true);
  expect(valid("ManualDraftWriteInput", partial)).toBe(true);
  expect(valid("ManualDraftWriteInput", request)).toBe(true);
  expect(valid("ManualDraftInput", partial)).toBe(false);
  expect(valid("ManualDraftInput", request)).toBe(false);
  expect(valid("ManualDraft", read)).toBe(true);
  expect(read.labels?.cargo).toBeNull();
  expect(valid("ManualDraftWriteInput", { ...(request as object), labels: read.labels })).toBe(
    false,
  );
  expect(valid("ManualDraftWriteInput", { fields: { ...read.fields, labels: read.labels } })).toBe(
    false,
  );
  expect(valid("ManualDraft", { ...read, labels: { ...read.labels, trailer: null } })).toBe(false);

  const old = fixture("getManualReportRevision:success").response.data;
  const dated = fixture("getManualReportRevision:dated").response.data as S["ManualReportRevision"];
  expect(valid("ManualReportRevision", old)).toBe(true);
  expect(valid("ManualReportRevision", dated)).toBe(true);
  expect(valid("ManualReportFields", dated.fields)).toBe(false);
  expect(valid("TripPrivate", fixture("getTrip:dated-private-revision").response.data)).toBe(true);
  expect(valid("Review", fixture("getTripReview:dated-private-revision").response.data)).toBe(true);
  expect(
    valid("ManualReportRevision", { ...dated, fields: { ...dated.fields, creditedM: "10" } }),
  ).toBe(false);
});

test("editing filter and count are optional and draft deletion is bodyless, guarded and no-store", () => {
  const spec = contractFile("openapi.json");
  const list = spec.paths["/api/v1/me/manual-drafts"].get;
  const state = list.parameters.find((parameter: { name?: string }) => parameter.name === "state");
  expect(state).toMatchObject({
    in: "query",
    required: false,
    schema: { type: "string", enum: ["editing"] },
  });
  for (const name of ["editing-only", "editing-empty"]) {
    const editing = fixture(`listMyManualDrafts:${name}`);
    expect(editing.query?.state).toBe("editing");
    expect(valid("EnvelopeListManualDraft", editing.response)).toBe(true);
    const data = editing.response.data as S["ListManualDraft"];
    expect(data.editingCount).toBe(name === "editing-only" ? 2 : 0);
    expect(data.items).toHaveLength(name === "editing-only" ? 1 : 0);
    expect(data.items.every((draft) => draft.state === "editing")).toBe(true);
    expect(valid("ListManualDraft", { ...data, editingCount: -1 })).toBe(false);
  }
  expect(valid("EnvelopeListManualDraft", fixture("listMyManualDrafts:success").response)).toBe(
    true,
  );

  const remove = spec.paths["/api/v1/me/manual-drafts/{draftId}"].delete;
  expect(remove).toMatchObject({
    operationId: "deleteManualDraft",
    security: [{ sessionCookie: [], csrfHeader: [] }],
    "x-capability": "trips.submit_own",
    "x-guards": expect.arrayContaining(["exact_origin_session_csrf", "owner_only", "editing_only"]),
  });
  expect(remove).not.toHaveProperty("requestBody");
  expect(spec.components.securitySchemes.csrfHeader).toMatchObject({
    in: "header",
    name: "X-CSRF-Token",
  });
  expect(remove.responses[200].headers["Cache-Control"].schema.const).toBe("no-store");
  const headers = spec.components.parameters;
  const draftIdSchema = remove.parameters.find((p: { name?: string }) => p.name === "draftId");
  expect(draftIdSchema).toMatchObject({ in: "path", required: true });
  for (const parameter of ["IfMatch", "IdempotencyKey"]) {
    expect(remove.parameters).toContainEqual({ $ref: `#/components/parameters/${parameter}` });
    expect(headers[parameter]).toMatchObject({ in: "header", required: true });
  }

  const success = fixture("deleteManualDraft:success");
  const replay = fixture("deleteManualDraft:exact-replay");
  expect(replay.headers).toEqual(success.headers);
  expect(replay.path).toEqual(success.path);
  expect(replay.response).toEqual(success.response);
  expect(valid("EnvelopeCommandResult", success.response)).toBe(true);
  expect(success.response.data).toMatchObject({ id: success.path?.draftId });

  for (const [name, status, code] of [
    ["success", 200, null],
    ["exact-replay", 200, null],
    ["private-not-found", 404, "NOT_FOUND"],
    ["version-conflict", 409, "VERSION_CONFLICT"],
    ["already-submitted", 409, "STATE_CONFLICT"],
    ["changed-retry", 409, "IDEMPOTENCY_CONFLICT"],
    ["missing-if-match", 428, "PRECONDITION_REQUIRED"],
  ] as const) {
    const example = fixture(`deleteManualDraft:${name}`);
    expect(example).not.toHaveProperty("request");
    expect(example.status).toBe(status);
    expect(example.responseHeaders).toEqual({ "Cache-Control": "no-store" });
    expect(validator.compile(draftIdSchema.schema)(example.path?.draftId)).toBe(true);
    expect(example.headers?.Origin).toBe("https://dashboard.example.invalid");
    expect(example.headers?.["X-CSRF-Token"]).toBe("synthetic-csrf-placeholder");
    expect(
      validator.compile(headers.IdempotencyKey.schema)(example.headers?.["Idempotency-Key"]),
    ).toBe(true);
    if (status === 428) expect(example.headers).not.toHaveProperty("If-Match");
    else
      expect(validator.compile(headers.IfMatch.schema)(example.headers?.["If-Match"])).toBe(true);
    if (code) expect(example.response.error?.code).toBe(code);
  }
});
