import { randomBytes } from "node:crypto";
import { newId, type TxContext } from "@vtc/db";
import { expect, test } from "vitest";
import {
  automaticCandidate,
  matchEvidence,
  ruleIdentity,
  validateReconciliationConfig,
  withinDistance,
} from "../../apps/api/src/modules/reconciliation/matcher.ts";
import { selectQuality } from "../../apps/api/src/modules/reconciliation/quality.ts";
import type { NormalizedTripEvidence } from "../../apps/api/src/modules/sources/contracts/evidence.ts";
import {
  telemetryAdapter,
  type Telemetry,
} from "../../apps/api/src/modules/sources/contracts/telemetry.ts";
import { reconciliationEvent } from "../../apps/api/src/platform/outbox/events.ts";
import { telemetryFixture } from "../support/builders.ts";
const rule = {
  version: 1,
  startToleranceMs: 1000,
  endToleranceMs: 2000,
  distanceToleranceM: "0.01",
};
async function fact(): Promise<NormalizedTripEvidence> {
  const f = await telemetryAdapter.normalize(
    telemetryFixture("completed") as unknown as Telemetry,
    { tx: {} as TxContext, ownerUserId: newId(), sourceRecordId: newId(), factRevisionId: newId() },
  );
  for (const field of ["origin", "destination", "cargo"] as const)
    f[field] = {
      status: "known",
      value: { entityId: newId(), factRevisionId: newId(), catalogRevisionId: newId() },
      sourceRecordId: f.sourceRecordId,
      sourceField: `synthetic.${field}`,
    };
  return f;
}
test("explicit versioned tolerances use exact decimals and inclusive integer millisecond boundaries", async () => {
  expect(
    withinDistance(
      "9007199254740992.000000000000000001",
      "9007199254740992",
      "0.000000000000000001",
    ),
  ).toBe(true);
  expect(withinDistance("1.000000000000000002", "1", "0.000000000000000001")).toBe(false);
  validateReconciliationConfig({ key: randomBytes(32).toString("hex"), rule });
  expect(() =>
    validateReconciliationConfig({ key: "a".repeat(64), rule: { ...rule, startToleranceMs: -1 } }),
  ).toThrow();
  expect(ruleIdentity(rule)).not.toEqual(ruleIdentity({ ...rule, version: 2 }));
  expect(ruleIdentity(rule)).not.toEqual(ruleIdentity({ ...rule, distanceToleranceM: "0.02" }));
  const a = await fact(),
    b = { ...structuredClone(a), provider: "manual" as const };
  b.start.utc = new Date(Date.parse(a.start.utc as string) + 1000).toISOString();
  b.end.utc = new Date(Date.parse(a.end.utc as string) + 2000).toISOString();
  expect(matchEvidence(a, b, rule).reasons).not.toContain("start_outside_tolerance");
  b.start.utc = new Date(Date.parse(a.start.utc as string) + 1001).toISOString();
  expect(matchEvidence(a, b, rule).outcome).toBe("different");
});
test("canonical identity ignores locale labels and refuses distinct driver/game/source, similar labels and planned/segment distance", async () => {
  const a = await fact(),
    b = { ...structuredClone(a), provider: "manual" as const };
  b.provenance = { label: "Russian fictional route" };
  a.provenance = { label: "English fictional route" };
  expect(matchEvidence(a, b, rule).outcome).toBe("review_required");
  expect(matchEvidence(a, { ...b, ownerUserId: newId() }, rule).outcome).toBe("different");
  expect(matchEvidence(a, { ...b, game: "ats" }, rule).outcome).toBe("different");
  expect(matchEvidence(a, { ...b, provider: "ets2telemetry" }, rule).outcome).toBe("different");
  const changed = structuredClone(b);
  if (changed.origin.status === "known") changed.origin.value.entityId = newId();
  expect(matchEvidence(a, changed, rule).outcome).toBe("different");
  b.start = { utc: null, basis: "unknown", verifiedActual: false };
  b.end = { utc: null, basis: "unknown", verifiedActual: false };
  b.wholeTripDistanceSupported = false;
  b.actualDistanceM = {
    status: "unknown",
    reasonCode: "unavailable",
    sourceRecordId: b.sourceRecordId,
  };
  expect(matchEvidence(a, b, rule).reasons).toEqual(
    expect.arrayContaining([
      "start_unsupported",
      "end_unsupported",
      "whole_trip_distance_unsupported",
      "manual_actual_time_unknown",
    ]),
  );
  expect(matchEvidence(a, b).reasons).toContain("matching_rule_unconfigured");
});
test("automatic selection requires one fully supported candidate after complete discovery; ambiguity and overflow retain review", () => {
  const only = { supported: true, id: "fictional" };
  expect(automaticCandidate([only], true)).toBe(only);
  expect(automaticCandidate([only], false)).toBeNull();
  expect(automaticCandidate([only, { supported: false }], true)).toBeNull();
  expect(automaticCandidate([{ supported: false }], true)).toBeNull();
  expect(automaticCandidate([], true)).toBeNull();
});
test("coherent quality snapshots preserve known zero, exact nonadditive metrics, catalog pins and alternatives; equal conflicts require review", async () => {
  const high = await fact(),
    low = structuredClone(high);
  low.factRevisionId = newId();
  low.sourceRecordId = newId();
  high.fuelUsedL = {
    status: "known",
    value: "0",
    sourceRecordId: high.sourceRecordId,
    sourceField: "synthetic.fuel",
  };
  low.fuelUsedL = {
    status: "unknown",
    reasonCode: "unavailable",
    sourceRecordId: low.sourceRecordId,
  };
  const result = selectQuality([high, low], high.factRevisionId);
  expect(result.selected?.factRevisionId).toBe(high.factRevisionId);
  expect(result.selected?.actualDistanceM).toEqual(high.actualDistanceM);
  expect(result.provenance?.fields.fuelUsedL).toMatchObject({
    status: "known",
    value: "0",
    sourceRecordId: high.sourceRecordId,
  });
  expect(result.provenance?.alternatives).toHaveLength(2);
  const conflict = structuredClone(high);
  conflict.factRevisionId = newId();
  conflict.actualDistanceM = {
    status: "known",
    value: "1",
    sourceRecordId: conflict.sourceRecordId,
    sourceField: "synthetic.distance",
  };
  expect(selectQuality([high, conflict], high.factRevisionId).reasons).toContain(
    "quality_supported_conflict",
  );
  expect(selectQuality([high, conflict], high.factRevisionId).selected?.factRevisionId).toBe(
    high.factRevisionId,
  );
});
test("correction events reject private fields and retain safe versioned references only", () => {
  const tripId = newId(),
    value = {
      eventId: newId(),
      type: "trip.correction_recorded" as const,
      schemaVersion: 1 as const,
      aggregate: { kind: "trip" as const, id: tripId, version: 2 },
      occurredAt: "2026-10-22T12:00:00.000Z",
      correlationId: newId(),
      causationId: null,
      data: {
        reconciliationId: newId(),
        primaryTripId: tripId,
        secondaryTripId: newId(),
        reconciliationVersion: 1,
      },
    };
  expect(reconciliationEvent(value)).toEqual(value);
  expect(() =>
    reconciliationEvent({ ...value, data: { ...value.data, reason: "private" } }),
  ).toThrow();
  expect(() =>
    reconciliationEvent({ ...value, aggregate: { ...value.aggregate, id: newId() } }),
  ).toThrow();
});
