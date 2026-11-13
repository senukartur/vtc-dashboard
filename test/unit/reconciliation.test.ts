import { randomBytes } from "node:crypto";
import { newId, type TxContext } from "@vtc/db";
import { expect, test } from "vitest";
import {
  automaticCandidate,
  matchEvidence,
  ruleIdentity,
  ruleSnapshot,
  validateReconciliationConfig,
  withinDistance,
} from "../../apps/api/src/modules/reconciliation/matcher.ts";
import { selectQuality } from "../../apps/api/src/modules/reconciliation/quality.ts";
import type { NormalizedTripEvidence } from "../../apps/api/src/modules/sources/contracts/evidence.ts";
import {
  type Telemetry,
  telemetryAdapter,
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
      value: { entityId: newId() },
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
  expect(ruleSnapshot(undefined)).toEqual({ matcher: "canonical-evidence/v1", rule: null });
  expect(JSON.stringify(ruleSnapshot(undefined))).not.toBe("null");
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
test("only a proven open-source pair permits metric evolution while unknown values and identity conflicts remain guarded", async () => {
  const previous = await fact(),
    next = structuredClone(previous);
  previous.outcome = "open";
  previous.fuelUsedL = {
    status: "known",
    value: "0",
    sourceRecordId: previous.sourceRecordId,
    sourceField: "synthetic.fuel",
  };
  next.factRevisionId = newId();
  next.sourceRecordId = newId();
  next.fuelUsedL = {
    status: "known",
    value: "38.5",
    sourceRecordId: next.sourceRecordId,
    sourceField: "synthetic.fuel",
  };
  const progression = { fromFactId: previous.factRevisionId, toFactId: next.factRevisionId };
  expect(selectQuality([previous, next], next.factRevisionId).reasons).toContain(
    "quality_supported_conflict",
  );
  const evolved = selectQuality([previous, next], next.factRevisionId, progression);
  expect(evolved.reasons).toEqual([]);
  expect(evolved.selected?.fuelUsedL).toEqual(next.fuelUsedL);
  expect(evolved.selected?.actualDistanceM).toEqual(next.actualDistanceM);
  expect(
    selectQuality([previous, next], next.factRevisionId, { ...progression, fromFactId: newId() })
      .reasons,
  ).toContain("quality_supported_conflict");
  const missing = structuredClone(next);
  missing.fuelUsedL = {
    status: "unknown",
    reasonCode: "unavailable",
    sourceRecordId: missing.sourceRecordId,
  };
  const degraded = selectQuality([previous, missing], missing.factRevisionId, progression);
  expect(
    degraded.selected?.factRevisionId !== missing.factRevisionId || degraded.reasons.length > 0,
  ).toBe(true);
  const conflict = structuredClone(next);
  if (conflict.origin.status === "known") conflict.origin.value.entityId = newId();
  expect(
    selectQuality([previous, conflict], conflict.factRevisionId, progression).reasons,
  ).toContain("quality_supported_conflict");
});

async function openLineage() {
  const previous = await fact();
  previous.outcome = "open";
  previous.end = { utc: null, basis: "unknown", verifiedActual: false };
  previous.wholeTripDistanceSupported = false;
  previous.actualDistanceM = {
    status: "unknown",
    reasonCode: "whole_trip_distance_unknown",
    sourceRecordId: previous.sourceRecordId,
  };
  previous.ruleContextComplete = true;
  previous.trailers = {
    complete: true,
    items: [
      {
        status: "known",
        value: { entityId: newId() },
        sourceRecordId: previous.sourceRecordId,
        sourceField: "synthetic.trailer",
      },
    ],
  };
  const next = structuredClone(previous);
  next.factRevisionId = newId();
  next.sourceRecordId = newId();
  return {
    previous,
    next,
    progression: { fromFactId: previous.factRevisionId, toFactId: next.factRevisionId },
  };
}
const degradations = {
  recording: (f: NormalizedTripEvidence) => {
    f.recording = "partial";
  },
  ruleContext: (f: NormalizedTripEvidence) => {
    f.ruleContextComplete = false;
  },
  trailers: (f: NormalizedTripEvidence) => {
    f.trailers.complete = false;
  },
  unknownTrailer: (f: NormalizedTripEvidence) => {
    f.trailers = {
      complete: false,
      items: [{ status: "unknown", reasonCode: "source_id_unknown", sourceRecordId: newId() }],
    };
  },
};
test.each([
  { name: "recording", lost: ["recording"] },
  { name: "rule context", lost: ["ruleContext"] },
  { name: "a complete trailer chain", lost: ["trailers"] },
  { name: "a known trailer", lost: ["unknownTrailer"] },
  { name: "all three", lost: ["recording", "ruleContext", "trailers"] },
] as { name: string; lost: (keyof typeof degradations)[] }[])(
  "a newer revision of one source lineage may lose $name without a quality hold",
  async ({ lost }) => {
    const { previous, next, progression } = await openLineage();
    for (const name of lost) degradations[name](next);
    if (next.fuelUsedL.status === "known") next.fuelUsedL.value = "41";
    for (const [facts, preferred] of [
      [[previous, next], next.factRevisionId],
      [[next, previous], previous.factRevisionId],
    ] as const) {
      const evolved = selectQuality(facts, preferred, progression);
      expect(evolved.reasons).toEqual([]);
      expect(evolved.selected?.factRevisionId).toBe(next.factRevisionId);
    }
    // Without the proven lineage the evolved metric conflicts and an equal-metric pair keeps
    // the more complete older snapshot.
    expect(selectQuality([previous, next], next.factRevisionId).reasons).toContain(
      "quality_supported_conflict",
    );
    next.fuelUsedL = structuredClone(previous.fuelUsedL);
    const independent = selectQuality([previous, next], next.factRevisionId);
    expect(independent.reasons).toEqual([]);
    expect(independent.selected?.factRevisionId).toBe(previous.factRevisionId);
  },
);
test("source lineage tolerance never covers lost facts or changed trailer and route identities", async () => {
  const { previous, next, progression } = await openLineage();
  degradations.recording(next);
  next.fuelUsedL = {
    status: "unknown",
    reasonCode: "unavailable",
    sourceRecordId: next.sourceRecordId,
  };
  const lostFuel = selectQuality([previous, next], next.factRevisionId, progression);
  expect(lostFuel.selected?.factRevisionId).toBe(previous.factRevisionId);
  const changedTrailer = structuredClone(next);
  changedTrailer.fuelUsedL = structuredClone(previous.fuelUsedL);
  const [item] = changedTrailer.trailers.items;
  changedTrailer.trailers.complete = true;
  if (item?.status === "known") item.value.entityId = newId();
  expect(
    selectQuality([previous, changedTrailer], next.factRevisionId, progression).reasons,
  ).toContain("quality_supported_conflict");
  const changedOrigin = structuredClone(next);
  changedOrigin.fuelUsedL = structuredClone(previous.fuelUsedL);
  if (changedOrigin.origin.status === "known") changedOrigin.origin.value.entityId = newId();
  expect(
    selectQuality([previous, changedOrigin], next.factRevisionId, progression).reasons,
  ).toContain("quality_supported_conflict");
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
