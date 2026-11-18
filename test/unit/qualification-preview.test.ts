import type { companionComponents } from "@vtc/contracts";
import type { TxContext } from "@vtc/db";
import { expect, test } from "vitest";
import { checkTrip } from "../../apps/api/src/modules/qualifications/check.ts";
import {
  checkPreview,
  previewDistanceEnvelope,
  previewFacts,
} from "../../apps/api/src/modules/qualifications/preview.ts";

type S = companionComponents["schemas"];
const id = "00000000-0000-4000-8000-000000000001";
const limits: S["Limits"] = {
  massMinKg: "0",
  massMaxKg: "24000",
  distanceMinM: "100000",
  distanceMaxM: "500000",
  trailers: { mode: "any", typeIds: [] },
  adr: { mode: "any", classes: [] },
  hardModeRequired: true,
};
const input = (): S["PreviewInput"] => ({
  requestId: id,
  contextRevision: 1,
  evidenceRevision: 1,
  game: "ets2",
  cargo: { availability: "unknown", code: null },
  cargoMassKg: { availability: "known", value: "0" },
  trailers: { complete: false, items: [] },
  actualDistance: {
    availability: "known",
    metres: "99999.999999999999999999",
    support: "whole-trip",
    final: false,
  },
  hardMode: { result: "qualified", final: false },
  start: null,
  eventId: null,
});
async function evaluate(value: S["PreviewInput"], custom = limits, exempt = false) {
  const facts = await previewFacts({} as TxContext, id, value);
  return { live: checkPreview(custom, facts, value, {}, exempt), final: checkTrip(custom, facts) };
}
test("growing below-minimum and nonfinal Hard Mode stay unknown, exact maxima still fail", async () => {
  const value = input(),
    growing = await evaluate(value);
  expect(growing.live.outcome).toBe("unknown");
  expect(growing.live.rules.find((r) => r.rule === "distance")).toMatchObject({
    result: "unknown",
    reasons: ["below_minimum_growing"],
  });
  expect(growing.live.rules.find((r) => r.rule === "hard_mode")).toMatchObject({
    result: "unknown",
    observed: "unknown",
    reasons: ["hard_mode_not_final"],
  });
  expect(growing.final.outcome).toBe("fail");
  value.actualDistance.metres = "500000.000000000000000001";
  expect((await evaluate(value)).live.outcome).toBe("fail");
  value.actualDistance.metres = "500000";
  value.actualDistance.final = true;
  value.hardMode.final = true;
  const final = await evaluate(value);
  expect(final.live.outcome).toBe("pass");
  expect(final.live.rules.map(({ reasons: _reasons, ...rule }) => rule)).toEqual(final.final.rules);
});
test("zero remains observed, missing/partial distance cannot invent final compliance", async () => {
  const value = input();
  value.actualDistance = {
    availability: "known",
    metres: "100000",
    support: "partial",
    final: false,
  };
  expect((await evaluate(value)).live.rules.find((r) => r.rule === "distance")).toMatchObject({
    result: "unknown",
    observedM: null,
    reasons: ["unsupported_distance"],
  });
  expect((await evaluate(value)).live.rules.find((r) => r.rule === "cargo_mass")).toMatchObject({
    result: "pass",
    observedKg: "0",
  });
  value.cargoMassKg = { availability: "unknown", value: null };
  expect((await evaluate(value)).live.rules.find((r) => r.rule === "cargo_mass")).toMatchObject({
    result: "unknown",
    observedKg: null,
  });
});
test("confirmed event exemption passes all five independently of load; unresolved never does", async () => {
  const value = input();
  value.cargoMassKg.value = "99999";
  const custom = {
    ...limits,
    trailers: { mode: "selected" as const, typeIds: [id] },
    adr: { mode: "forbidden" as const, classes: [] },
  };
  expect((await evaluate(value, custom)).live.outcome).toBe("fail");
  const exempt = (await evaluate(value, custom, true)).live;
  expect(exempt.outcome).toBe("pass");
  expect(exempt.rules).toHaveLength(5);
  expect(
    exempt.rules.every((r) => r.result === "pass" && r.reasons[0] === "event_attendance_exemption"),
  ).toBe(true);
});
test("known disallowed previous bodies outrank unresolved holes and groups preserve allowance", async () => {
  const value = input(),
    allowed = "00000000-0000-4000-8000-000000000002",
    variant = "00000000-0000-4000-8000-000000000003";
  value.trailers = {
    complete: false,
    items: [
      { code: "variant", provenance: "previous" },
      { code: null, provenance: "unknown" },
    ],
  };
  const facts = await previewFacts({} as TxContext, id, value, {
    resolveInTransaction: async () => ({ status: "resolved", id: variant, adrClass: null }),
  });
  const custom = { ...limits, trailers: { mode: "selected" as const, typeIds: [allowed] } };
  expect(
    checkPreview(custom, facts, value, {}, false).rules.find((r) => r.rule === "trailer_types"),
  ).toMatchObject({ result: "fail" });
  expect(
    checkPreview(custom, facts, value, { [allowed]: "same", [variant]: "same" }, false).rules.find(
      (r) => r.rule === "trailer_types",
    ),
  ).toMatchObject({ result: "unknown" });
});
test("confirmed non-ADR always passes restricted ADR, missing catalog classification stays unknown", async () => {
  const value = input();
  value.cargo = { availability: "known", code: "fixture_cargo" };
  const facts = await previewFacts({} as TxContext, id, value, {
    resolveInTransaction: async () => ({ status: "resolved", id, adrClass: null }),
  });
  const custom = { ...limits, adr: { mode: "forbidden" as const, classes: [] } };
  expect(
    checkPreview(custom, facts, value, {}, false).rules.find((r) => r.rule === "adr"),
  ).toMatchObject({ result: "pass", observed: "none" });
  facts.adrCategory = { status: "unknown", reasonCode: "catalog_unknown", sourceRecordId: id };
  expect(
    checkPreview(custom, facts, value, {}, false).rules.find((r) => r.rule === "adr"),
  ).toMatchObject({ result: "unknown", observed: null });
});

test("server guards invalidate a delayed positive at max, preserve an already-proven breach and fence final corrections", async () => {
  const value = input();
  value.actualDistance.metres = "499999";
  value.hardMode.final = true;
  expect((await evaluate(value)).live.outcome).toBe("pass");
  expect(previewDistanceEnvelope(value, limits, false)).toEqual({
    minimumDistanceM: "499999",
    maximumDistanceM: "500000",
  });
  value.actualDistance.metres = "500001";
  expect((await evaluate(value)).live.outcome).toBe("fail");
  expect(previewDistanceEnvelope(value, limits, false)).toEqual({
    minimumDistanceM: "500001",
    maximumDistanceM: null,
  });
  value.actualDistance.final = true;
  expect(previewDistanceEnvelope(value, limits, false)).toEqual({
    minimumDistanceM: "500001",
    maximumDistanceM: "500001",
  });
});

test("supported partial distance can prove a maximum breach but cannot establish a completed pass", async () => {
  const value = input();
  value.actualDistance.support = "partial";
  value.actualDistance.metres = "500001";
  const checked = await evaluate(value);
  expect(checked.live.outcome).toBe("fail");
  expect(checked.live.rules.find((rule) => rule.rule === "distance")).toMatchObject({
    observedM: "500001",
    result: "fail",
    reasons: ["limit_mismatch"],
  });
  expect(previewDistanceEnvelope(value, limits, false)).toEqual({
    minimumDistanceM: "500001",
    maximumDistanceM: null,
  });
  value.actualDistance.metres = "100000";
  expect((await evaluate(value)).live.rules.find((rule) => rule.rule === "distance")).toMatchObject(
    { result: "unknown" },
  );
});

test("all nonfinal Hard Mode values remain unknown; final not-qualified is a proven failure", async () => {
  const value = input();
  value.actualDistance.metres = "100000";
  for (const result of ["qualified", "not-qualified", "unknown"] as const) {
    value.hardMode.result = result;
    expect(
      (await evaluate(value)).live.rules.find((rule) => rule.rule === "hard_mode"),
    ).toMatchObject({ result: "unknown", reasons: ["hard_mode_not_final"] });
  }
  value.hardMode = { result: "not-qualified", final: true };
  expect((await evaluate(value)).live.outcome).toBe("fail");
});
