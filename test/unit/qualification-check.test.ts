import { describe, expect, test } from "vitest";
import {
  checkTrip,
  conditionsMet,
  type QualificationLimits,
} from "../../apps/api/src/modules/qualifications/check.ts";
import type {
  AdrClass,
  Fact,
  NormalizedTripEvidence,
} from "../../apps/api/src/modules/sources/contracts/evidence.ts";

const source = "c1570000-0000-4000-8000-000000000001";
const trailerA = "c1570000-0000-4000-8000-0000000000a1";
const trailerB = "c1570000-0000-4000-8000-0000000000b2";
const known = <T>(value: T): Fact<T> => ({
  status: "known",
  value,
  sourceRecordId: source,
  sourceField: "synthetic",
});
const unknown = (reasonCode = "synthetic_unknown"): Fact<never> => ({
  status: "unknown",
  reasonCode,
  sourceRecordId: source,
});
const open: QualificationLimits = {
  massMinKg: null,
  massMaxKg: null,
  distanceMinM: null,
  distanceMaxM: null,
  trailers: { mode: "any", typeIds: [] },
  adr: { mode: "any", classes: [] },
  hardModeRequired: false,
};
test("semantic types accept classified variants, hold unclassified bodies, and never expand legacy rules", () => {
  const limits: QualificationLimits = {
    ...open,
    trailers: { basis: "type", mode: "selected", typeIds: [source] },
  };
  const mapping = {
    [source]: `type:${source}`,
    [trailerA]: `type:${source}`,
    [trailerB]: "type:other",
  };
  expect(checkTrip(limits, facts(), mapping).outcome).toBe("pass");
  expect(checkTrip(limits, facts(), { ...mapping, [trailerA]: "undefined" }).outcome).toBe(
    "unknown",
  );
  expect(
    checkTrip(
      limits,
      facts({ trailers: { complete: true, items: [known({ entityId: trailerB })] } }),
      mapping,
    ).outcome,
  ).toBe("fail");
  const legacy: QualificationLimits = {
    ...open,
    trailers: { mode: "selected", typeIds: [trailerA] },
  };
  const typed = known({ entityId: source, identityKind: "type" as const });
  expect(checkTrip(legacy, facts({ trailers: { complete: true, items: [typed] } })).outcome).toBe(
    "unknown",
  );
  expect(
    checkTrip(
      legacy,
      facts({ trailers: { complete: true, items: [typed, known({ entityId: trailerB })] } }),
    ).outcome,
  ).toBe("fail");
});
function facts(overrides: Partial<NormalizedTripEvidence> = {}): NormalizedTripEvidence {
  return {
    sourceRecordId: source,
    factRevisionId: source,
    provider: "ets2telemetry",
    ownerUserId: source,
    game: "ets2",
    outcome: "delivered",
    recording: "complete",
    start: { utc: null, basis: "event", verifiedActual: true },
    end: { utc: null, basis: "event", verifiedActual: true },
    origin: unknown(),
    destination: unknown(),
    cargo: unknown(),
    cargoMassKg: known("12000"),
    actualDistanceM: known("450000"),
    measuredSegmentM: unknown(),
    plannedDistanceM: unknown(),
    deliveredDistanceM: unknown(),
    fuelUsedL: unknown(),
    cargoDamageFraction: unknown(),
    money: null,
    provenance: null,
    recordedTelemetry: {
      jobType: "freight-market",
      gameMode: "single-player",
      hardModeResult: "qualified",
    },
    wholeTripDistanceSupported: true,
    trailers: { complete: true, items: [known({ entityId: trailerA })] },
    adrCategory: unknown("cargo_not_adr"),
    ruleContextComplete: true,
    reasonCodes: [],
    ...overrides,
  };
}
test.each([
  ["0", known("0"), "pass", "0"],
  ["0", known("0.00000000000000000001"), "fail", "0.000000000000000001"],
  ["2.5", known("0.025"), "pass", "2.5"],
  ["2.5", known("0.025000000000000001"), "fail", "2.5000000000000001"],
  ["100", known("1"), "pass", "100"],
  ["100", known("1.01"), "unknown", null],
  ["0", known("NaN"), "unknown", null],
  ["0", unknown(), "unknown", null],
] as const)(
  "checks cargo damage %s inclusively with exact percent conversion",
  (cap, damage, result, observedPercent) => {
    const evidence = facts({ cargoDamageFraction: damage });
    expect(checkTrip(open, evidence).rules.some((rule) => rule.rule === "cargo_damage")).toBe(
      false,
    );
    expect(checkTrip({ ...open, cargoDamageMaxPercent: cap }, evidence).rules.at(-1)).toEqual({
      rule: "cargo_damage",
      result,
      maxPercent: cap,
      observedPercent,
    });
    expect(
      checkTrip({ ...open, cargoDamageMaxPercent: cap }, { ...evidence, outcome: "open" }).rules.at(
        -1,
      ),
    ).toMatchObject({ result: "unknown", observedPercent: null });
  },
);
const result = (limits: QualificationLimits, evidence = facts()) => {
  const check = checkTrip(limits, evidence);
  return {
    outcome: check.outcome,
    rules: Object.fromEntries(check.rules.map((rule) => [rule.rule, rule.result])),
  };
};

test("trailer groups allow another recognized body variant without changing the observed IDs", () => {
  const limits: QualificationLimits = {
    ...open,
    trailers: { mode: "selected", typeIds: [trailerA] },
  };
  const evidence = facts({ trailers: { complete: true, items: [known({ entityId: trailerB })] } });
  const groups = { [trailerA]: "common:ets2:fiction", [trailerB]: "common:ets2:fiction" };
  expect(checkTrip(limits, evidence).outcome).toBe("fail");
  const grouped = checkTrip(limits, evidence, groups);
  expect(grouped.outcome).toBe("pass");
  expect(grouped.rules.find((rule) => rule.rule === "trailer_types")).toMatchObject({
    allowedIds: [trailerA],
    observedIds: [trailerB],
  });
  expect(checkTrip(limits, evidence, { ...groups, [trailerB]: "common:ats:fiction" }).outcome).toBe(
    "fail",
  );
  expect(
    checkTrip(limits, facts({ trailers: { complete: true, items: [unknown()] } }), groups).outcome,
  ).toBe("unknown");
  expect(
    checkTrip(limits, { ...evidence, trailers: { ...evidence.trailers, complete: false } }, groups)
      .outcome,
  ).toBe("unknown");
});

describe("the five-rule trip check", () => {
  test("a level without limits passes every rule in a fixed order", () => {
    const check = checkTrip(open, facts({ cargoMassKg: unknown(), actualDistanceM: unknown() }));
    expect(check.outcome).toBe("pass");
    expect(check.rules.map((rule) => rule.rule)).toEqual([
      "cargo_mass",
      "distance",
      "trailer_types",
      "adr",
      "hard_mode",
    ]);
  });

  test("mass and distance bounds are inclusive; outside fails, an unknown value is unknown", () => {
    const bounded = { ...open, massMinKg: "12000", massMaxKg: "12000" };
    expect(result(bounded).rules.cargo_mass).toBe("pass");
    expect(result({ ...open, massMaxKg: "11999.9" }).rules.cargo_mass).toBe("fail");
    expect(result({ ...open, massMinKg: "12000.1" }).rules.cargo_mass).toBe("fail");
    expect(result(bounded, facts({ cargoMassKg: unknown() })).rules.cargo_mass).toBe("unknown");
    expect(result(bounded, facts({ cargoMassKg: known("12 t") })).rules.cargo_mass).toBe("unknown");
    const distance = { ...open, distanceMinM: "100000", distanceMaxM: "450000" };
    expect(result(distance).rules.distance).toBe("pass");
    expect(result({ ...open, distanceMaxM: "449999" }).rules.distance).toBe("fail");
    expect(result(distance, facts({ actualDistanceM: unknown() })).rules.distance).toBe("unknown");
  });

  test("selected trailers fail on a foreign type and are unknown on incomplete data", () => {
    const selected = { ...open, trailers: { mode: "selected" as const, typeIds: [trailerA] } };
    expect(result(selected).rules.trailer_types).toBe("pass");
    const foreign = facts({ trailers: { complete: true, items: [known({ entityId: trailerB })] } });
    expect(result(selected, foreign).rules.trailer_types).toBe("fail");
    const partial = facts({
      trailers: { complete: false, items: [known({ entityId: trailerA })] },
    });
    expect(result(selected, partial).rules.trailer_types).toBe("unknown");
    const missing = facts({ trailers: { complete: true, items: [unknown()] } });
    expect(result(selected, missing).rules.trailer_types).toBe("unknown");
    // A known foreign trailer outranks an incomplete list.
    const mixed = facts({
      trailers: { complete: false, items: [known({ entityId: trailerB }), unknown()] },
    });
    expect(result(selected, mixed).rules.trailer_types).toBe("fail");
    expect(result(open, foreign).rules.trailer_types).toBe("pass");
  });

  test("ADR forbids, selects or allows any class; non-ADR cargo always passes", () => {
    const adr = (value: AdrClass) => facts({ adrCategory: known(value) });
    const forbidden = { ...open, adr: { mode: "forbidden" as const, classes: [] } };
    const selected = { ...open, adr: { mode: "selected" as const, classes: ["3" as const] } };
    expect(result(forbidden).rules.adr).toBe("pass");
    expect(result(forbidden, adr("3")).rules.adr).toBe("fail");
    expect(result(selected, adr("3")).rules.adr).toBe("pass");
    expect(result(selected, adr("8")).rules.adr).toBe("fail");
    expect(result(open, adr("8")).rules.adr).toBe("pass");
    expect(result(forbidden, facts({ adrCategory: unknown("adr_unknown") })).rules.adr).toBe(
      "unknown",
    );
  });

  // One-sided bounds and the ADR edge cases; the default trip has 12000 kg and 450000 m.
  const selectedAdr = { ...open, adr: { mode: "selected" as const, classes: ["3" as const] } };
  test.each([
    ["mass min only, at or above", { ...open, massMinKg: "11000" }, facts(), "cargo_mass", "pass"],
    ["distance min only, above", { ...open, distanceMinM: "400000" }, facts(), "distance", "pass"],
    ["distance min only, below", { ...open, distanceMinM: "450001" }, facts(), "distance", "fail"],
    ["mass max only, below", { ...open, massMaxKg: "12000.5" }, facts(), "cargo_mass", "pass"],
    ["distance max only, at", { ...open, distanceMaxM: "450000" }, facts(), "distance", "pass"],
    [
      "selected ADR with non-ADR cargo",
      selectedAdr,
      facts({ adrCategory: unknown("cargo_not_adr") }),
      "adr",
      "pass",
    ],
    [
      "selected ADR with an unknown ADR class",
      selectedAdr,
      facts({ adrCategory: unknown("adr_class_unknown") }),
      "adr",
      "unknown",
    ],
  ] as const)("%s", (_name, limits, evidence, rule, expected) => {
    const check = result(limits, evidence);
    expect(check.rules[rule]).toBe(expected);
    expect(check.outcome).toBe(expected);
  });

  test("Hard Mode: qualified passes, not-qualified fails, unknown or absent is unknown", () => {
    const required = { ...open, hardModeRequired: true };
    const telemetry = (hardModeResult: "qualified" | "not-qualified" | "unknown") =>
      facts({
        recordedTelemetry: { jobType: "unknown", gameMode: "unknown", hardModeResult },
      });
    expect(result(required, telemetry("qualified")).rules.hard_mode).toBe("pass");
    expect(result(required, telemetry("not-qualified")).rules.hard_mode).toBe("fail");
    expect(result(required, telemetry("unknown")).rules.hard_mode).toBe("unknown");
    const manual = facts({ provider: "manual" });
    delete manual.recordedTelemetry;
    expect(result(required, manual).rules.hard_mode).toBe("unknown");
    expect(result(open, telemetry("not-qualified")).rules.hard_mode).toBe("pass");
  });

  test("any failure outranks any unknown rule", () => {
    const limits = { ...open, massMaxKg: "1000", hardModeRequired: true };
    const evidence = facts({
      recordedTelemetry: { jobType: "unknown", gameMode: "unknown", hardModeResult: "unknown" },
    });
    expect(result(limits, evidence)).toMatchObject({
      outcome: "fail",
      rules: { cargo_mass: "fail", hard_mode: "unknown" },
    });
    expect(result({ ...limits, massMaxKg: null }, evidence).outcome).toBe("unknown");
  });
});

describe("promotion conditions", () => {
  const totals = (completedTrips: number, completedDistanceM: string) => ({
    completedTrips,
    completedDistanceM,
  });
  test("every set condition must be met, inclusively and with exact decimals", () => {
    const both = { requiredTrips: 3, requiredDistanceM: "1500000.5" };
    expect(conditionsMet(both, totals(3, "1500000.5"))).toBe(true);
    expect(conditionsMet(both, totals(2, "9000000"))).toBe(false);
    expect(conditionsMet(both, totals(3, "1500000.4"))).toBe(false);
    expect(conditionsMet({ requiredTrips: 1, requiredDistanceM: null }, totals(1, "0"))).toBe(true);
    expect(conditionsMet({ requiredTrips: null, requiredDistanceM: "100" }, totals(0, "100"))).toBe(
      true,
    );
  });
  test("a level without conditions never promotes", () => {
    expect(
      conditionsMet({ requiredTrips: null, requiredDistanceM: null }, totals(999, "999999999")),
    ).toBe(false);
  });
});
