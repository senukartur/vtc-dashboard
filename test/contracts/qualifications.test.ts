import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { createSchemaValidator } from "../../apps/api/src/platform/http/schemas.ts";

const valid = (name: string) =>
  createSchemaValidator().compile({ $ref: `urn:vtc:browser:v1#/$defs/${name}` });
const id = (n: number) => `41570000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const limits = {
  massMinKg: null,
  massMaxKg: "20000",
  distanceMinM: null,
  distanceMaxM: null,
  trailers: { mode: "selected", typeIds: [id(1)] },
  adr: { mode: "selected", classes: ["2", "3"] },
  hardModeRequired: true,
};
const conditions = { requiredTrips: 5, requiredDistanceM: "500000" };

describe("level commands", () => {
  test("create and update carry a name, the five limits and the promotion conditions only", () => {
    const create = valid("QualificationLevelCreateInput"),
      update = valid("QualificationLevelUpdateInput"),
      input = { game: "ets2", position: 2, name: "Fictional level", limits, conditions };
    expect(create(input)).toBe(true);
    expect(update({ expectedVersion: 1, name: "Fictional level", limits, conditions })).toBe(true);
    for (const changes of [
      { position: 0 },
      { position: 26 },
      { name: " " },
      { name: "x".repeat(129) },
      { game: "other" },
      { reason: "Retired publication reason" },
      { rules: [] },
      { effectiveAt: "2026-01-01T00:00:00.000Z" },
    ])
      expect(create({ ...input, ...changes }), JSON.stringify(changes)).toBe(false);
    expect(update({ expectedVersion: 0, name: "Fictional level", limits, conditions })).toBe(false);
  });

  test("limits and conditions are closed, exact decimals with bounded lists", () => {
    const parse = valid("QualificationLimitsInput");
    expect(parse(limits)).toBe(true);
    for (const changes of [
      { massMaxKg: 20000 },
      { massMaxKg: "-1" },
      { massMaxKg: "1e3" },
      { trailers: { mode: "selected", typeIds: Array.from({ length: 101 }, (_, n) => id(n)) } },
      { trailers: { mode: "selected", typeIds: [id(1), id(1)] } },
      { trailers: { mode: "some", typeIds: [] } },
      { adr: { mode: "selected", classes: ["5"] } },
      { adr: { mode: "selected", classes: ["2", "2"] } },
      { hardModeRequired: "yes" },
      { maxMassKg: "1" },
    ])
      expect(parse({ ...limits, ...changes }), JSON.stringify(changes)).toBe(false);
    const omitted: Record<string, unknown> = { ...limits };
    delete omitted.hardModeRequired;
    expect(parse(omitted)).toBe(false);
    const conditionsOf = valid("QualificationConditions");
    expect(conditionsOf({ requiredTrips: null, requiredDistanceM: null })).toBe(true);
    for (const value of [
      { requiredTrips: 0, requiredDistanceM: null },
      { requiredTrips: 1.5, requiredDistanceM: null },
      { requiredTrips: 4294967296, requiredDistanceM: null },
      { requiredTrips: null },
      { ...conditions, requiredDays: 3 },
    ])
      expect(conditionsOf(value), JSON.stringify(value)).toBe(false);
  });

  test("moving, removing and a manual level change need their version, target or comment", () => {
    expect(valid("QualificationLevelMoveInput")({ expectedVersion: 2, position: 1 })).toBe(true);
    expect(valid("QualificationLevelMoveInput")({ expectedVersion: 2, position: 26 })).toBe(false);
    const removal = valid("QualificationLevelRemovalInput");
    expect(removal({ expectedVersion: 1, transferLevelId: id(2) })).toBe(true);
    expect(removal({ expectedVersion: 1 })).toBe(false);
    expect(removal({ expectedVersion: 1, transferLevelId: "not-an-id" })).toBe(false);
    const change = valid("QualificationManualChangeInput");
    expect(change({ levelId: id(2), reason: "Fictional manual change" })).toBe(true);
    for (const value of [
      { levelId: id(2), reason: " " },
      { levelId: id(2), reason: "x".repeat(2049) },
      { levelId: id(2) },
      { levelId: id(2), reason: "Fictional", purpose: "promotion" },
    ])
      expect(change(value), JSON.stringify(value)).toBe(false);
  });
});

describe("level reads", () => {
  const summary = {
    id: id(1),
    game: "ets2",
    position: 1,
    name: "Fictional Trainee",
    limits: {
      ...limits,
      trailers: {
        mode: "selected",
        types: [
          {
            entityId: id(1),
            label: "Fictional curtainsider",
            requestedLocale: "en",
            renderedLocale: "en",
            englishFallback: false,
            hidden: false,
          },
        ],
      },
    },
    conditions,
    nextLevel: { id: id(2), name: "Fictional Driver" },
    driverCount: 3,
    version: 1,
  };
  test("the level list is bounded by the ladder size and closed", () => {
    const parse = valid("EnvelopeQualificationLevelList");
    const reply = (levels: unknown[]) => ({
      data: { game: "ets2", canManage: false, levels, mine: null },
      meta: { requestId: "synthetic-request" },
    });
    const ok = parse(reply([summary]));
    if (!ok) throw new Error(JSON.stringify(parse.errors));
    expect(parse(reply(Array(26).fill(summary)))).toBe(false);
    for (const property of ["code", "ruleVersionId", "effectiveAt", "archived"])
      expect(parse(reply([{ ...summary, [property]: null }])), property).toBe(false);
  });
  test("a member's qualification has a level or none, with progress that is never negative", () => {
    const parse = valid("MyQualification");
    const item = {
      game: "ets2",
      level: { id: id(1), name: "Fictional Trainee", position: 1 },
      since: "2026-11-01T10:00:00.000Z",
      progress: { trips: 2, distanceM: "450000" },
      conditions,
      nextLevel: { id: id(2), name: "Fictional Driver" },
    };
    expect(parse(item)).toBe(true);
    expect(
      parse({
        ...item,
        level: null,
        since: null,
        progress: { trips: 0, distanceM: "0" },
        conditions: null,
        nextLevel: null,
      }),
    ).toBe(true);
    expect(parse({ ...item, progress: { trips: -1, distanceM: "0" } })).toBe(false);
    expect(parse({ ...item, eligible: true })).toBe(false);
    expect(valid("MyQualificationList")({ items: [item, item, item] })).toBe(false);
  });
});

describe("trip check", () => {
  const rules = [
    { rule: "cargo_mass", result: "fail", minKg: null, maxKg: "20000", observedKg: "21000" },
    { rule: "distance", result: "pass", minM: null, maxM: null, observedM: null },
    { rule: "trailer_types", result: "pass", mode: "any", allowed: [], observed: [] },
    { rule: "adr", result: "unknown", mode: "forbidden", allowedClasses: [], observed: null },
    { rule: "hard_mode", result: "pass", required: false, observed: null },
  ];
  const check = {
    status: "checked",
    basis: "decision",
    level: { id: id(1), name: "Fictional Trainee" },
    outcome: "fail",
    reasonCode: null,
    rules,
  };
  test("the check lists at most the five rules with their configured value and trip value", () => {
    const parse = valid("QualificationCheck");
    expect(parse(check)).toBe(true);
    for (const status of ["event_exempt", "no_level"])
      expect(parse({ ...check, status, outcome: null, rules: [] })).toBe(true);
    expect(parse({ ...check, rules: [...rules, rules[0]] })).toBe(false);
    expect(parse({ ...check, status: "resolved" })).toBe(false);
    expect(parse({ ...check, basis: "historical" })).toBe(false);
    const rule = valid("QualificationRuleCheck");
    expect(rule({ ...rules[0], observedKg: 0 })).toBe(false);
    expect(rule({ ...rules[0], ruleType: "max_mass" })).toBe(false);
    expect(rule({ ...rules[3], observed: "5" })).toBe(false);
    expect(rule({ ...rules[4], observed: "hard" })).toBe(false);
  });
});

test("every qualification route is in the contract and the retired routes are gone", () => {
  const paths = Object.keys(
    JSON.parse(readFileSync("docs/contracts/dashboard/openapi.json", "utf8")).paths as object,
  ).filter((path) => path.includes("qualification"));
  expect(paths.sort()).toEqual(
    [
      "/api/v1/admin/members/{memberId}/qualifications/{game}",
      "/api/v1/admin/qualification-levels",
      "/api/v1/admin/qualification-levels/{levelId}",
      "/api/v1/admin/qualification-levels/{levelId}/position",
      "/api/v1/admin/qualification-levels/{levelId}/removal",
      "/api/v1/me/qualifications",
      "/api/v1/members/{memberId}/qualifications",
      "/api/v1/qualification-levels",
      "/api/v1/qualification-levels/{levelId}",
    ].sort(),
  );
});
