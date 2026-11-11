import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { listTripsQuerystring } from "../../apps/api/src/modules/trips/http.ts";
import { createSchemaValidator } from "../../apps/api/src/platform/http/schemas.ts";

const read = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`../../docs/contracts/dashboard/${name}`, import.meta.url), "utf8"),
  );
const spec = read("openapi.json");
const sourceSchema = { type: "string", enum: ["ets2telemetry", "manual"] };

test("listTrips source is an optional query filter using the TripSummary.sourceKinds vocabulary", () => {
  const parameter = spec.paths["/api/v1/trips"].get.parameters.find(
    (p: { name?: string }) => p.name === "source",
  );
  expect(parameter).toMatchObject({ in: "query", required: false });
  expect(parameter.schema).toEqual(sourceSchema);
  expect(parameter.schema.enum).toEqual(
    spec.components.schemas.TripSummary.properties.sourceKinds.items.enum,
  );
  expect(parameter.description).toMatch(/cursor/);
  // The route validates the same wire schema the contract publishes.
  expect(
    (listTripsQuerystring.properties as Record<string, unknown>).source,
    "route parity",
  ).toEqual(sourceSchema);
  expect(listTripsQuerystring.additionalProperties).toBe(false);
});

test("the route query schema accepts both source kinds and rejects other spellings", () => {
  // The same parameter coercion the API installs for query strings.
  const validate = createSchemaValidator("array").compile(listTripsQuerystring);
  expect(validate({})).toBe(true);
  for (const source of ["ets2telemetry", "manual"]) {
    expect(validate({ source }), source).toBe(true);
    expect(validate({ scope: "review", hold: true, order: "asc", source }), source).toBe(true);
  }
  for (const source of ["telemetry", "", "MANUAL", "Manual", ["manual", "ets2telemetry"]])
    expect(validate({ source }), JSON.stringify(source)).toBe(false);
});

const stageFixtures = read("examples.json");
const stageFixture = (id: string) =>
  stageFixtures.cases.find((item: { id: string }) => item.id === id);

test("staged trip query supports both independent UTC bounds, bounded search and new order values", () => {
  const operation = spec.paths["/api/v1/trips"].get;
  const parameters = operation.parameters.map(
    (parameter: { $ref?: string; name?: string; schema?: object }) =>
      parameter.$ref
        ? spec.components.parameters[parameter.$ref.slice("#/components/parameters/".length)]
        : parameter,
  );
  const properties = Object.fromEntries(
    parameters.map((parameter: { name: string; schema: object }) => [
      parameter.name,
      parameter.schema,
    ]),
  );
  const schema = JSON.parse(
    JSON.stringify({ type: "object", properties, additionalProperties: false }).replaceAll(
      "#/components/schemas/",
      "urn:vtc:browser:v1#/$defs/",
    ),
  );
  const validate = createSchemaValidator().compile(schema);
  const company = stageFixture("listTrips:filtered-company");
  const own = stageFixture("listTrips:filtered-own");
  const review = stageFixture("listTrips:completion-review");
  const mismatch = stageFixture("listTrips:filter-cursor-mismatch");
  expect(company.query).toMatchObject({ scope: "company", q: "#42", order: "completion_desc" });
  expect(own.query).toMatchObject({ scope: "mine", q: "Fictional Harbor", order: "asc" });
  expect(review.query).toMatchObject({ scope: "review", hold: true, order: "completion_asc" });
  expect(mismatch).toMatchObject({
    status: 409,
    response: { error: { code: "VERSION_CONFLICT" } },
  });
  expect(operation.responses[409].description).toMatch(/cursor/);
  for (const fixture of [company, own, review, mismatch])
    expect(validate(fixture.query)).toBe(true);
  expect(validate({ from: company.query.from })).toBe(true);
  expect(validate({ toExclusive: company.query.toExclusive })).toBe(true);
  for (const query of [
    { from: "2026-02-30T10:00:00.000Z" },
    { toExclusive: "2026-10-20T10:00:00+01:00" },
    { q: "" },
    { q: "   " },
    { q: "x".repeat(129) },
    { locale: "fr" },
    { ownerId: "not-an-id" },
    { order: "completed" },
    { extra: true },
  ]) {
    expect(validate(query), JSON.stringify(query)).toBe(false);
  }
  expect(
    operation.parameters.find((p: { name?: string }) => p.name === "hold").description,
  ).toMatch(/Review queue only/);
});

test("trip summaries retain legacy payloads and keep event and game mode out of company fixtures", () => {
  const validator = createSchemaValidator();
  const validate = (name: string, data: unknown) =>
    validator.compile({ $ref: `urn:vtc:browser:v1#/$defs/${name}` })(data);
  const company = stageFixture("listTrips:filtered-company").response.data;
  const own = stageFixture("listTrips:filtered-own").response.data;
  const review = stageFixture("listTrips:completion-review").response.data;
  const trip = company.items[0];
  for (const result of [stageFixture("listTrips:success").response.data, company, own, review]) {
    expect(validate("ListTripSummary", result)).toBe(true);
  }
  expect(company.total).toBe(1);
  expect(company.items).toHaveLength(1);
  expect(company.nextCursor).toBeNull();
  expect(trip).toMatchObject({ number: 42, decision: "accepted", submittedAt: null });
  expect(trip).not.toHaveProperty("event");
  expect(trip).not.toHaveProperty("gameMode");
  expect(own.items[0]).toMatchObject({
    event: { title: "Fictional evening convoy" },
    gameMode: "haulmp",
  });
  expect(own.items[0].submittedAt).toBeNull();
  const reviewed = review.items[0];
  expect(reviewed).toMatchObject({ event: null, gameMode: "unknown" });
  expect(reviewed.createdAt).toBe(reviewed.review.createdAt);
  expect(reviewed.submittedAt).toBe(reviewed.review.manualRevision.submittedAt);
  expect(Date.parse(reviewed.createdAt)).toBeLessThanOrEqual(Date.parse(reviewed.submittedAt));
  for (const changes of [
    { number: 0 },
    { number: Number.MAX_SAFE_INTEGER + 1 },
    { createdAt: "2026-10-20" },
    { submittedAt: "2026-10-20T10:00:00.000+00:00" },
    { gameMode: "convoy" },
    { event: { ...own.items[0].event, declineReason: "private" } },
    { sourcePayload: {} },
  ]) {
    expect(validate("TripSummary", { ...trip, ...changes })).toBe(false);
  }
  const ownTotals = stageFixture("getMyTripStatusSummary:game-lifetime-totals");
  const profile = stageFixture("getMember:all-game-lifetime-totals").response.data;
  expect(ownTotals.query).toEqual({ game: "ets2" });
  expect(validate("OwnTripStatusSummary", ownTotals.response.data)).toBe(true);
  expect(ownTotals.response.data.counts.accepted).toBe(
    ownTotals.response.data.lifetimeTotals.acceptedTrips,
  );
  expect(validate("MemberProfile", profile)).toBe(true);
  expect(profile.lifetimeTotals).toEqual({ acceptedTrips: 0, actualDistanceM: "0" });
  expect(validate("LifetimeTripTotals", { acceptedTrips: 1, actualDistanceM: 3.5 })).toBe(false);
  expect(validate("LifetimeTripTotals", { acceptedTrips: 1, actualDistanceM: "3.50" })).toBe(false);
});
