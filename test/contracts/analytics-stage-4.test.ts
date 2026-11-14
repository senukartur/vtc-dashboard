import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { createSchemaValidator } from "../../apps/api/src/platform/http/schemas.ts";

type Parameter = { name: string; in: string; required?: boolean; schema: object };
type Operation = {
  operationId: string;
  parameters: (Parameter | { $ref: string })[];
  "x-contract-stage"?: string;
  "x-stage-4-changes"?: { "x-owner-card": string; parameters: string[]; fields: string[] };
};
const read = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`../../docs/contracts/dashboard/${name}`, import.meta.url), "utf8"),
  );
const spec = read("openapi.json") as {
  paths: Record<string, Record<string, Operation>>;
  components: { parameters: Record<string, Parameter> };
};
const cases = read("examples.json").cases as {
  id: string;
  operationId: string;
  response: { data: Record<string, unknown> };
}[];
const fixture = (id: string) => {
  const found = cases.find((item) => item.id === id);
  if (!found) throw new Error(`MISSING_FIXTURE ${id}`);
  return structuredClone(found.response.data);
};
const ajv = createSchemaValidator();
const valid = (name: string) => ajv.compile({ $ref: `urn:vtc:browser:v1#/$defs/${name}` });
const operation = (id: string) => {
  for (const methods of Object.values(spec.paths))
    for (const item of Object.values(methods)) if (item.operationId === id) return item;
  throw new Error(`MISSING_OPERATION ${id}`);
};
// The same parameter coercion the API installs for query strings.
const query = (id: string) => {
  const parameters = operation(id).parameters.flatMap((parameter) => {
    const resolved =
      "$ref" in parameter
        ? spec.components.parameters[parameter.$ref.split("/").at(-1) ?? ""]
        : parameter;
    return resolved && resolved.in === "query" ? [resolved] : [];
  });
  return createSchemaValidator("array").compile(
    JSON.parse(
      JSON.stringify({
        type: "object",
        properties: Object.fromEntries(parameters.map(({ name, schema }) => [name, schema])),
        required: parameters.filter(({ required }) => required).map(({ name }) => name),
        additionalProperties: false,
      }).replaceAll("#/components/schemas/", "urn:vtc:browser:v1#/$defs/"),
    ),
  );
};
const sum = (rows: { acceptedTrips: number; actualDistanceM: string }[]) => ({
  acceptedTrips: rows.reduce((total, row) => total + row.acceptedTrips, 0),
  // Fixture distances are exact decimals with at most one fractional digit.
  actualDistanceM: String(
    rows.reduce((total, row) => total + Math.round(Number(row.actualDistanceM) * 10), 0) / 10,
  ),
});

test("company analytics adds period, active counts and per-game totals without changing Analytics", () => {
  const company = valid("AnalyticsStage4Company");
  const range = fixture("getCompanyAnalytics:stage-4-range");
  const allTime = fixture("getCompanyAnalytics:stage-4-all-time");
  expect(company(range)).toBe(true);
  expect(company(allTime)).toBe(true);
  expect(valid("Analytics")(range)).toBe(false);
  const { period, activeDrivers, activeMembers, byGame, ...legacy } = range;
  expect([period, activeDrivers, activeMembers, byGame].every((value) => value !== undefined)).toBe(
    true,
  );
  expect(valid("Analytics")(legacy)).toBe(true);
  expect(company(legacy)).toBe(true);
  for (const mutation of [
    { period: "lifetime" },
    { activeDrivers: -1 },
    { activeMembers: 1.5 },
    { byGame: [] },
    { byGame: [...(byGame as object[]), { game: "ets2", acceptedTrips: 0, actualDistanceM: "0" }] },
    { byGame: [{ game: "ets2", acceptedTrips: 1, actualDistanceM: "1", shareOfTotal: "1" }] },
  ])
    expect(company({ ...range, ...mutation }), JSON.stringify(mutation)).toBe(false);

  const analyticsQuery = query("getCompanyAnalytics");
  expect(analyticsQuery({ period: "all_time" })).toBe(true);
  expect(analyticsQuery({ fromDate: "2026-10-01", toDateExclusive: "2026-11-01" })).toBe(true);
  expect(analyticsQuery({ period: "year" })).toBe(false);
  expect(operation("getCompanyAnalytics")["x-stage-4-changes"]?.["x-owner-card"]).toBe("VTC-143");
});

test("leaderboard reports the viewer position and ranked count, also off-page and unranked", () => {
  const list = valid("ListLeaderboardEntry");
  const offPage = fixture("getLeaderboard:stage-4-viewer-off-page");
  expect(list(offPage)).toBe(true);
  expect(list(fixture("getLeaderboard:stage-4-unranked"))).toBe(true);
  expect(list(fixture("getLeaderboard:stage-4-all-time"))).toBe(true);
  const items = offPage.items as { position: number }[];
  const viewer = offPage.viewer as { position: number };
  expect(viewer.position).toBeGreaterThan(items.length);
  for (const mutation of [
    { viewer: { ...viewer, position: 0 } },
    { viewer: { ...viewer, member: items[0] } },
    { rankedMembers: -1 },
    { period: "week" },
    { items: [{ ...items[0], position: 0 }] },
  ])
    expect(list({ ...offPage, ...mutation }), JSON.stringify(mutation)).toBe(false);
  expect(list({ items: [], nextCursor: null })).toBe(true);
  const leaderboardQuery = query("getLeaderboard");
  expect(leaderboardQuery({ period: "all_time", limit: "10" })).toBe(true);
  expect(leaderboardQuery({ period: "month" })).toBe(false);
});

test("breakdown variants are closed by dimension and reconcile with their totals", () => {
  const breakdown = valid("AnalyticsStage4Breakdown");
  for (const id of [
    "getCompanyAnalyticsBreakdown:stage-4-route",
    "getCompanyAnalyticsBreakdown:stage-4-reverse-route",
    "getCompanyAnalyticsBreakdown:stage-4-cargo",
    "getCompanyAnalyticsBreakdown:stage-4-source",
    "getCompanyAnalyticsBreakdown:stage-4-empty",
  ]) {
    const data = fixture(id) as {
      items: { acceptedTrips: number; actualDistanceM: string }[];
      remainder: { acceptedTrips: number; actualDistanceM: string };
      undetermined: { acceptedTrips: number; actualDistanceM: string };
      totals: { acceptedTrips: number; actualDistanceM: string };
    };
    expect(breakdown(data), id).toBe(true);
    expect(sum([...data.items, data.remainder, data.undetermined]), id).toEqual(data.totals);
  }
  const route = fixture("getCompanyAnalyticsBreakdown:stage-4-route");
  const routeItems = route.items as Record<string, unknown>[];
  const reverse = fixture("getCompanyAnalyticsBreakdown:stage-4-reverse-route");
  const [ab, ba] = reverse.items as {
    origin: { entityId: string };
    destination: { entityId: string };
  }[];
  expect([ab?.origin.entityId, ab?.destination.entityId]).toEqual([
    ba?.destination.entityId,
    ba?.origin.entityId,
  ]);
  const source = fixture("getCompanyAnalyticsBreakdown:stage-4-source");
  const sourceItems = source.items as Record<string, unknown>[];
  expect(sourceItems.map((item) => item.source)).toEqual(["ets2telemetry", "manual"]);
  for (const mutation of [
    { dimension: "cargo" },
    { limit: 11 },
    { limit: 0 },
    { items: Array.from({ length: 11 }, () => routeItems[0]) },
    { remainder: undefined },
    { undetermined: { acceptedTrips: -1, actualDistanceM: "0" } },
    { items: [{ ...routeItems[0], game: undefined }] },
    { items: [{ ...routeItems[0], originCode: "fict_city" }] },
  ])
    expect(breakdown({ ...route, ...mutation }), JSON.stringify(mutation)).toBe(false);
  for (const mutation of [
    { limit: 5 },
    { items: sourceItems.slice(0, 1) },
    { items: [...sourceItems, sourceItems[0]] },
    { dimension: "route" },
  ])
    expect(breakdown({ ...source, ...mutation }), JSON.stringify(mutation)).toBe(false);

  const breakdownQuery = query("getCompanyAnalyticsBreakdown");
  expect(
    breakdownQuery({ dimension: "route", limit: "10", locale: "ru", period: "all_time" }),
  ).toBe(true);
  for (const invalid of [
    {},
    { dimension: "city" },
    { dimension: "route", limit: "11" },
    { dimension: "route", limit: "0" },
    { dimension: "cargo", locale: "de" },
    { dimension: "route", top: "5" },
  ])
    expect(breakdownQuery(invalid), JSON.stringify(invalid)).toBe(false);
  const staged = operation("getCompanyAnalyticsBreakdown");
  expect(staged["x-contract-stage"]).toBe("VTC-150 Step 1");
  expect(spec.paths["/api/v1/analytics/company/breakdown"]?.get).toBe(staged);
});
