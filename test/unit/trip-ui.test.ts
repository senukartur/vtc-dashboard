import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
  tripListFilters,
  tripListTimestamp,
  tripPeriodBounds,
  tripSearch,
} from "../../apps/web/src/features/trips/list-model.ts";
import { tripTranslations } from "../../apps/web/src/features/trips/translations.ts";
import {
  attemptFor,
  canonicalDecimal,
  filterSearch,
  proposalResult,
  queryString,
  revisionFields,
  schema,
  selectedTrip,
  selectionSearch,
  tripFilters,
  tripSources,
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
  ).toEqual({ scope: "mine", game: "ets2", decision: "accepted", source: undefined });
  // The review queue has its own page and query; the member list never selects the review scope.
  expect(
    tripFilters(new URLSearchParams("scope=review&game=wrong&decision=wrong&source=wrong")),
  ).toEqual({
    scope: "mine",
    game: undefined,
    decision: undefined,
    source: undefined,
  });
});
test("source filter accepts only the contract source kinds and resets paging state", () => {
  const spec = JSON.parse(
    readFileSync(new URL("../../docs/contracts/dashboard/openapi.json", import.meta.url), "utf8"),
  );
  expect([...tripSources]).toEqual(
    spec.components.schemas.TripSummary.properties.sourceKinds.items.enum,
  );
  for (const source of tripSources)
    expect(tripFilters(new URLSearchParams({ source })).source).toBe(source);
  for (const query of ["source=", "source=telemetry", "source=Manual", "source=MANUAL", ""])
    expect(tripFilters(new URLSearchParams(query)).source, query).toBeUndefined();
  // The first repeated value wins, as for the other filters; the request sends exactly one.
  expect(tripFilters(new URLSearchParams("source=manual&source=ets2telemetry")).source).toBe(
    "manual",
  );
  // Company scope keeps the source filter (unlike decision, which the page drops there).
  expect(tripFilters(new URLSearchParams("scope=company&source=ets2telemetry"))).toEqual({
    scope: "company",
    game: undefined,
    decision: undefined,
    source: "ets2telemetry",
  });
  const manual = { scope: "mine", source: "manual" },
    telemetry = { scope: "mine", source: "ets2telemetry" };
  expect(queryString({ ...manual, limit: 25, cursor: null })).toBe(
    "scope=mine&source=manual&limit=25",
  );
  expect(queryString(manual)).not.toBe(queryString(telemetry));
  expect(queryString({ scope: "mine", source: undefined })).toBe("scope=mine");
  const id = "49000000-0000-4000-8000-000000000002";
  expect(
    filterSearch(`?scope=company&game=ats&cursor=c&trip=${id}`, "source", "manual").toString(),
  ).toBe("scope=company&game=ats&source=manual");
  expect(filterSearch("?scope=mine&source=manual&cursor=c", "source", "").toString()).toBe(
    "scope=mine",
  );
  expect(filterSearch("game=ats", "source", "ets2telemetry").toString()).toBe(
    "game=ats&source=ets2telemetry",
  );
});
test("list filters use canonical owners and completion order, and normalize the search", () => {
  const id = "49000000-0000-4000-8000-00000000000a";
  expect(
    tripListFilters(
      new URLSearchParams({
        scope: "company",
        ownerId: id.toUpperCase(),
        decision: "rejected",
        q: " #1046 ",
        order: "completion_asc",
        period: "lastMonth",
      }),
    ),
  ).toMatchObject({
    scope: "company",
    ownerId: id,
    decision: undefined,
    q: "#1046",
    order: "completion_asc",
    period: "lastMonth",
  });
  expect(
    tripListFilters(new URLSearchParams("ownerId=bad&order=asc&period=yesterday")),
  ).toMatchObject({
    scope: "mine",
    ownerId: undefined,
    order: "completion_desc",
    period: undefined,
    q: "",
  });
  expect(
    tripListFilters(new URLSearchParams({ scope: "mine", ownerId: id })).ownerId,
  ).toBeUndefined();
  expect(
    tripListFilters(new URLSearchParams({ scope: "company", ownerId: "not-a-driver" })).ownerId,
  ).toBeUndefined();
  expect(tripSearch(" 1046 ")).toBe("1046");
  expect(tripSearch(` ${"🚛".repeat(129)} `)).toBe("🚛".repeat(128));
});

test("half-open trip periods use the display calendar and both DST offsets", () => {
  const now = new Date("2026-10-30T12:00:00Z");
  expect(tripPeriodBounds("thisMonth", now, "Europe/Warsaw")).toEqual({
    from: "2026-09-30T22:00:00.000Z",
    toExclusive: "2026-10-31T23:00:00.000Z",
  });
  expect(tripPeriodBounds("last7Days", now, "Europe/Warsaw")).toEqual({
    from: "2026-10-23T22:00:00.000Z",
    toExclusive: "2026-10-30T23:00:00.000Z",
  });
  expect(
    tripPeriodBounds("last7Days", new Date("2018-11-10T12:00:00Z"), "America/Sao_Paulo"),
  ).toEqual({
    from: "2018-11-04T03:00:00.000Z",
    toExclusive: "2018-11-11T02:00:00.000Z",
  });
  expect(tripPeriodBounds("lastMonth", now, "Unknown/Zone")).toBeUndefined();
});

test("list dates distinguish completion, staff confirmation and legacy reporting time", () => {
  const sample = cases.find((f: { id: string }) => f.id === "getTrip:success").response.data;
  const at = "2026-10-30T12:00:00Z";
  expect(tripListTimestamp({ ...sample, reportingAt: at, reportingBasis: "unknown" })).toEqual({
    at,
    label: "reportingColumn",
  });
  expect(tripListTimestamp({ ...sample, reportingAt: at, reportingBasis: undefined })).toEqual({
    at,
    label: "reportingColumn",
  });
  expect(
    tripListTimestamp({ ...sample, reportingAt: null, reportingBasis: "actual_completion" }),
  ).toBeNull();
  expect(
    tripListTimestamp({ ...sample, reportingAt: at, reportingBasis: "actual_completion" }),
  ).toEqual({
    at,
    label: null,
  });
  expect(
    tripListTimestamp({ ...sample, reportingAt: at, reportingBasis: "manual_confirmation" }),
  ).toEqual({
    at,
    label: "manual_confirmation",
  });
});

test("side-panel selection accepts only canonical UUIDv4 values and never reaches list filters", () => {
  const id = "49000000-0000-4000-8000-000000000002";
  expect(selectedTrip(new URLSearchParams(`trip=${id}`))).toBe(id);
  for (const value of ["", "nope", "49000000-0000-1000-8000-000000000002", `../${id}`, `${id}/x`])
    expect(selectedTrip(new URLSearchParams({ trip: value }))).toBeNull();
  expect(selectedTrip(new URLSearchParams("scope=company"))).toBeNull();
  expect(tripFilters(new URLSearchParams(`scope=company&game=ats&trip=${id}`))).toEqual(
    tripFilters(new URLSearchParams("scope=company&game=ats")),
  );
  const filters = new URLSearchParams("scope=company&game=ets2&decision=accepted&cursor=c2");
  expect(selectionSearch(filters, id)).toBe(
    `?scope=company&game=ets2&decision=accepted&trip=${id}`,
  );
  expect(selectionSearch(new URLSearchParams(`game=ats&trip=${id}&cursor=c2`), null)).toBe(
    "?game=ats",
  );
  expect(selectionSearch(new URLSearchParams(`trip=${id}`), null)).toBe("");
  expect(filters.get("cursor")).toBe("c2");
});
test("dense list strings exist in both locales and never include mockup-only copy", () => {
  const keys = [
    "scopeLabel",
    "filters",
    "allGames",
    "anyDecision",
    "sourceFilter",
    "anySource",
    "sourceTelemetry",
    "sourceManual",
    "listLabel",
    "timesIn",
    "distance",
    "reportingColumn",
    "outcome",
    "outcomeOpen",
    "details",
    "openFull",
    "closeDetails",
    "noDecisions",
    "historyUnavailable",
  ] as const;
  for (const locale of ["en", "ru"] as const) {
    const strings = tripTranslations[locale];
    for (const key of keys) expect(strings[key], `${locale}.${key}`).toMatch(/\S/);
    expect(strings.timesIn).toContain("{{timezone}}");
    for (const value of Object.values(strings))
      expect(value).not.toMatch(/Достаточно суров|Yukon\?/);
  }
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

test("manual revision readback keeps paired reference dates and closed fields in Ajv and Zod", async () => {
  const { createSchemaValidator } = await import("../../apps/api/src/platform/http/schemas.ts");
  const ajv = createSchemaValidator().compile({
    $ref: "urn:vtc:browser:v1#/$defs/EnvelopeManualRevision",
  });
  const zod = schema("EnvelopeManualRevision");
  const undated = cases.find(
    (f: { id: string }) => f.id === "getManualReportRevision:success",
  ).response;
  const dated = cases.find(
    (f: { id: string }) => f.id === "getManualReportRevision:dated",
  ).response;
  const { startedAt, completedAt, ...withoutDates } = dated.data.fields;
  for (const [fields, expected] of [
    [undated.data.fields, true],
    [dated.data.fields, true],
    [withoutDates, true],
    [{ ...withoutDates, startedAt }, false],
    [{ ...withoutDates, completedAt }, false],
    [{ ...dated.data.fields, startedAt: "2026-10-20" }, false],
    [{ ...withoutDates, extra: true }, false],
    [{ ...dated.data.fields, extra: true }, false],
  ] as const) {
    const value = { ...dated, data: { ...dated.data, fields } };
    expect(ajv(value), "server validation").toBe(expected);
    const result = zod.safeParse(value);
    expect(result.success, "browser validation").toBe(expected);
    if (result.success) expect(result.data).toEqual(value);
  }
});
