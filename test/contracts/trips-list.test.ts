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
