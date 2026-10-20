import { readFileSync } from "node:fs";
import { newId, type TxContext } from "@vtc/db";
import { expect, test } from "vitest";
import {
  canonicalJson,
  contentHash,
  decimal,
  sourceKey,
} from "../../apps/api/src/modules/sources/contracts/canonical.ts";
import type {
  AdapterContext,
  CatalogPort,
} from "../../apps/api/src/modules/sources/contracts/evidence.ts";
import { manualAdapter } from "../../apps/api/src/modules/sources/contracts/manual.ts";
import {
  type Telemetry,
  telemetryAdapter,
} from "../../apps/api/src/modules/sources/contracts/telemetry.ts";
import { tripEvent } from "../../apps/api/src/platform/outbox/events.ts";
import { telemetryFixture } from "../support/builders.ts";

const context = (): AdapterContext => ({
  tx: {} as TxContext,
  ownerUserId: newId(),
  sourceRecordId: newId(),
  factRevisionId: newId(),
});
const input = (kind: "completed" | "started" | "closed-partial" = "completed") =>
  telemetryFixture(kind) as unknown as Telemetry;
test("RFC8785 canonicalization follows UTF16 sorting, direct numeric-key ordering, Unicode preservation and finite safe JSON", () => {
  expect(canonicalJson({ "2": "two", "10": "ten", z: [3, 2], "€": "€", a: -0 })).toBe(
    '{"10":"ten","2":"two","a":0,"z":[3,2],"€":"€"}',
  );
  expect(contentHash(canonicalJson({ b: 2, a: 1 }))).toEqual(
    contentHash(canonicalJson({ a: 1, b: 2 })),
  );
  expect(contentHash(canonicalJson({ a: [1, 2] }))).not.toEqual(
    contentHash(canonicalJson({ a: [2, 1] })),
  );
  expect(canonicalJson("é")).not.toEqual(canonicalJson("e\u0301"));
  for (const value of [
    Infinity,
    NaN,
    9007199254740992,
    "\ud800",
    "\udfff",
    undefined,
    new Date(),
    Array(2),
  ])
    expect(() => canonicalJson(value)).toThrow();
  expect(() =>
    canonicalJson(Object.defineProperty({}, "a", { get: () => 1, enumerable: true })),
  ).toThrow();
  expect(sourceKey("00000101-0000-0000-0000-000000000001").length).toBe(36);
  expect(() => sourceKey("00000101-0000-0000-0000-00000000000A")).toThrow();
});
test("deployed telemetry structural schema is an exact frozen contract copy", () => {
  expect(
    readFileSync(
      new URL(
        "../../apps/api/src/modules/sources/contracts/telemetry-v1.schema.json",
        import.meta.url,
      ),
    ),
  ).toEqual(
    readFileSync(new URL("../../docs/contracts/telemetry-v1.schema.json", import.meta.url)),
  );
});
test("telemetry preserves separate normalized metrics, zero, exact money, field provenance and supported milliseconds", async () => {
  const p = input();
  Object.assign(p.snapshot.cargoDamage, { value: 0 });
  Object.assign(p.snapshot.fuelUsed, { value: 0.000001 });
  const ctx = context(),
    fact = await telemetryAdapter.normalize(p, ctx);
  expect(fact.actualDistanceM).toEqual({
    status: "known",
    value: "123400",
    sourceRecordId: ctx.sourceRecordId,
    sourceField: "snapshot.observedDistance",
  });
  expect(fact.plannedDistanceM).toMatchObject({ value: "120000" });
  expect(fact.deliveredDistanceM).toMatchObject({ value: "123400" });
  expect(fact.cargoMassKg).toMatchObject({ value: "18000" });
  expect(fact.cargoDamageFraction).toMatchObject({ value: "0" });
  expect(fact.fuelUsedL).toMatchObject({ value: "0.000001" });
  expect(fact.money).toEqual({
    expectedIncome: p.snapshot.expectedIncome,
    revenue: p.snapshot.revenue,
    penalty: p.snapshot.penalty,
  });
  expect(fact.start).toMatchObject({
    utc: new Date(p.snapshot.start.utcMs as number).toISOString(),
    verifiedActual: true,
  });
  expect(fact.origin).toMatchObject({ status: "unknown", reasonCode: "catalog_unavailable" });
  expect(decimal("0.100000000000000000")).toBe("0.1");
  expect(decimal(1e-7)).toBe("0.0000001");
  for (const value of ["1e999999999", "1e-999999999", "1".repeat(1000)])
    expect(() => decimal(value)).toThrow("INVALID_NONNEGATIVE_DECIMAL");
  expect(() => decimal("1.1234567890123456789")).toThrow();
});
test("partial coverage and unsupported time bases never become whole-trip distance or actual occurrence", async () => {
  const p = input("closed-partial"),
    f = await telemetryAdapter.normalize(p, context());
  expect(f.actualDistanceM.status).toBe("unknown");
  expect(f.measuredSegmentM.status).toBe("known");
  expect(f.start).toMatchObject({ basis: "checkpoint", verifiedActual: false });
  expect(f.end).toMatchObject({ basis: "last-known", verifiedActual: false });
  const open = await telemetryAdapter.normalize(input("started"), context());
  expect(open.actualDistanceM.status).toBe("unknown");
  const changed = input();
  changed.snapshot.evidence.clockAnomaly = true;
  Object.assign(changed.snapshot.cargoDamage, { value: 1000 });
  const anomaly = await telemetryAdapter.normalize(changed, context());
  expect(anomaly.start.verifiedActual).toBe(false);
  expect(anomaly.end.verifiedActual).toBe(false);
  expect(anomaly.cargoDamageFraction).toMatchObject({
    status: "unknown",
    reasonCode: "damage_out_of_range",
  });
  expect(anomaly.reasonCodes).toContain("clock_anomaly");
});
test("valid telemetry quantities beyond storage precision remain unknown evidence without rounding", async () => {
  const p = input();
  Object.assign(p.snapshot.observedDistance, { value: 1e-19 });
  Object.assign(p.snapshot.job.cargoMass, { value: 1e-19 });
  const f = await telemetryAdapter.normalize(p, context());
  expect(f.actualDistanceM).toMatchObject({
    status: "unknown",
    reasonCode: "quantity_out_of_range",
  });
  expect(f.cargoMassKg).toMatchObject({ status: "unknown", reasonCode: "quantity_out_of_range" });
  expect(f.reasonCodes).toContain("quantity_out_of_range");
  expect(f.provenance).toMatchObject({
    unsupportedQuantities: { "snapshot.observedDistance": 1e-19, "snapshot.job.cargoMass": 1e-19 },
  });
});
test("strict adapter rejects acceptance injection, wrong lifecycle, out-of-range lossless values and duplicate reasons", () => {
  for (const mutate of [
    (p: Telemetry) => {
      Object.assign(p, { accepted: true });
    },
    (p: Telemetry) => {
      p.snapshot.outcome = "cancelled";
    },
    (p: Telemetry) => {
      Object.assign(p.snapshot.revenue, {
        value: { raw: "9223372036854775808", sdkType: "s64", currency: { status: "unknown" } },
      });
    },
    (p: Telemetry) => {
      p.snapshot.start.eventSeq = "18446744073709551616";
    },
    (p: Telemetry) => {
      p.snapshot.evidence.reasons = ["unknown-code", "unknown-code"];
    },
    (p: Telemetry) => {
      Object.assign(p.snapshot.job.origin.cityId, { value: "я".repeat(100) });
    },
  ]) {
    const p = input();
    mutate(p);
    expect(() => telemetryAdapter.identity(p)).toThrow();
  }
});
test("frozen mode, money SDK types and time basis semantics remain strict", () => {
  for (const mutation of [
    {
      gameMode: { mode: "unknown", method: "module-scan", confidence: "strong", ambiguous: false },
    },
    {
      gameMode: {
        mode: "single-player",
        method: "process-scan",
        confidence: "strong",
        ambiguous: false,
      },
    },
    {
      expectedIncome: {
        available: true,
        value: { raw: "1", sdkType: "s64", currency: { status: "unknown" } },
      },
    },
    { start: { basis: "unknown", utcMs: 1, eventSeq: null } },
    { start: { basis: "event", utcMs: 1, eventSeq: null } },
  ]) {
    const p = input();
    Object.assign(p.snapshot, mutation);
    expect(() => telemetryAdapter.identity(p)).toThrow();
  }
});
test("time regression and out-of-storage-range instants remain uncertain evidence", async () => {
  const reversed = input();
  if (!reversed.snapshot.end) throw new Error("SYNTHETIC_END_EXPECTED");
  reversed.snapshot.end.utcMs = (reversed.snapshot.start.utcMs as number) - 1;
  const conflict = await telemetryAdapter.normalize(reversed, context());
  expect(conflict.start.verifiedActual).toBe(false);
  expect(conflict.end.verifiedActual).toBe(false);
  expect(conflict.reasonCodes).toContain("time_order_conflict");
  expect(conflict.actualDistanceM.status).toBe("unknown");
  const extreme = input();
  extreme.snapshot.start.utcMs = Number.MAX_SAFE_INTEGER;
  const uncertain = await telemetryAdapter.normalize(extreme, context());
  expect(uncertain.start.utc).toBeNull();
  expect(uncertain.start.verifiedActual).toBe(false);
});
test("catalog normalization pins a single publication, uses exact IDs, keeps ambiguous and missing mappings unknown", async () => {
  const revisionId = newId(),
    entityId = newId(),
    factId = newId();
  let pointerReads = 0;
  const catalogs: CatalogPort = {
    async publishedInTransaction(_tx, _game, build) {
      pointerReads++;
      expect(build).toBe("synthetic-build");
      return revisionId;
    },
    async resolveInTransaction(_tx, p) {
      expect(p.revisionId).toBe(revisionId);
      expect(p.label).toBeNull();
      return p.sourceId === "fixture_north"
        ? { status: "resolved", entityId, factRevisionId: factId }
        : { status: "ambiguous", candidateIds: [newId(), newId()] };
    },
    async pinnedInTransaction() {
      return null;
    },
  };
  const p = input();
  p.snapshot.context.gameBuild = { available: true, value: "synthetic-build" };
  const f = await telemetryAdapter.normalize(p, { ...context(), catalogs });
  expect(pointerReads).toBe(1);
  expect(f.origin).toMatchObject({
    status: "known",
    value: { entityId, catalogRevisionId: revisionId, factRevisionId: factId },
  });
  expect(f.destination).toMatchObject({ status: "unknown", reasonCode: "catalog_ambiguous" });
  const missingBuild = await telemetryAdapter.normalize(input(), { ...context(), catalogs });
  expect(missingBuild.origin).toMatchObject({
    status: "unknown",
    reasonCode: "catalog_build_unknown",
  });
  expect(pointerReads).toBe(1);
});
test("manual adapter requires immutable validated references and never supplies source times or acceptance", async () => {
  const reportId = newId(),
    revisionId = newId(),
    catalogRevisionId = newId(),
    originId = newId(),
    destinationId = newId(),
    cargoId = newId(),
    trailerTypeId = newId();
  const p = {
    reportId,
    revisionId,
    revision: 1,
    game: "ets2",
    catalogRevisionId,
    originId,
    destinationId,
    cargoId,
    trailerTypeId,
    cargoMassKg: "0",
    actualDistanceM: "1.250",
    evidenceIds: [newId()],
  };
  expect(() => manualAdapter.identity({ ...p, accepted: true })).toThrow();
  expect(() => manualAdapter.identity({ ...p, evidenceIds: [] })).toThrow();
  expect(() => manualAdapter.identity({ ...p, actualDistanceM: "1e999999999" })).toThrow(
    "INVALID_NONNEGATIVE_DECIMAL",
  );
  const kinds = new Map([
    [originId, "city"],
    [destinationId, "city"],
    [cargoId, "cargo"],
    [trailerTypeId, "trailer_type"],
  ]);
  const catalogs: CatalogPort = {
    async publishedInTransaction() {
      return catalogRevisionId;
    },
    async resolveInTransaction() {
      return { status: "unknown", reasonCode: "unused" };
    },
    async pinnedInTransaction(_tx, _r, id) {
      return {
        id: newId(),
        entityId: id,
        game: "ets2",
        kind: kinds.get(id) ?? "invalid",
        adrCategoryId: null,
      };
    },
  };
  const f = await manualAdapter.normalize(p, { ...context(), catalogs });
  expect(f.start.utc).toBeNull();
  expect(f.end.verifiedActual).toBe(false);
  expect(f.actualDistanceM).toMatchObject({ value: "1.25" });
  expect(f.reasonCodes).toContain("manual_review_required");
});
test("trip event registry is closed and contains safe references only", () => {
  const sourceRecordId = newId(),
    tripId = newId(),
    factRevisionId = newId(),
    eventId = newId();
  const event = {
    eventId,
    type: "source.snapshot_stored",
    schemaVersion: 1,
    aggregate: { kind: "source", id: sourceRecordId, version: 1 },
    occurredAt: "2026-10-20T00:00:00.000Z",
    correlationId: eventId,
    causationId: null,
    data: { sourceRecordId, tripId, factRevisionId },
  };
  expect(tripEvent(event).type).toBe("source.snapshot_stored");
  expect(() => tripEvent({ ...event, data: { ...event.data, accepted: true } })).toThrow();
  expect(() => tripEvent({ ...event, type: "trip.accepted" })).toThrow();
});
