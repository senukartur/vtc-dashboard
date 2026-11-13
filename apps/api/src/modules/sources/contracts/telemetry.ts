import { utcDateTime, utcIso } from "@vtc/db";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { canonicalJson, decimal, sourceKey } from "./canonical.js";
import type {
  AdrClass,
  Fact,
  Game,
  NormalizedTripEvidence,
  Outcome,
  RecordedTelemetry,
  Recording,
  ReportedTime,
  TripEntity,
  TripSourceAdapter,
} from "./evidence.js";
import schema from "./telemetry-v1.schema.json" with { type: "json" };

type Available<T> = { available: true; value: T } | { available: false; reason: string };
type AccountingStatus = "complete" | "partial" | "unknown";
type Time = { utcMs: number | null; basis: ReportedTime["basis"]; eventSeq: string | null };
export interface Telemetry {
  contract: { major: 1; minor: 0 | 1 | 2 };
  producer: unknown;
  createdUtcMs: number;
  eventId: string;
  revision: number;
  installationId: string;
  bindingId: string;
  source: { game: Game; pluginSessionId: string; tripId: string; databaseUuid: string };
  delivery: { mode: "live" | "backfill" };
  type: string;
  snapshot: {
    gameMode: {
      mode: RecordedTelemetry["gameMode"];
      method: "module-scan" | "process-scan" | "none";
      confidence: "strong" | "weak" | "none";
      ambiguous: boolean;
    };
    hardModeResult?: RecordedTelemetry["hardModeResult"];
    // Required in v1.2 and forbidden earlier; fuel status is evidence only.
    accounting?: { distance: AccountingStatus; fuel: AccountingStatus };
    closeReason: string | null;
    checkpointNextEventSeq: string | null;
    outcome: Outcome;
    recordingCompleteness: Recording;
    start: Time;
    end: Time | null;
    openedBy: string;
    openedEventSeq: string | null;
    outcomeEventSeq: string | null;
    context: {
      mapId: Available<string>;
      sourceLocale: Available<string>;
      gameBuild: Available<string>;
    };
    job: {
      origin: { cityId: Available<string>; cityName: Available<string> };
      destination: { cityId: Available<string>; cityName: Available<string> };
      cargoId: Available<string>;
      cargoName: Available<string>;
      cargoMass: Available<number>;
      market: Available<string>;
    };
    trailers: {
      complete: boolean;
      items: {
        index: number;
        id: Available<string>;
        bodyType: Available<string>;
        chainType: Available<string>;
      }[];
    };
    plannedDistance: Available<number>;
    observedDistance: Available<number>;
    deliveredDistance: Available<number>;
    fuelUsed: Available<number>;
    cargoDamage: Available<number>;
    expectedIncome: Available<unknown>;
    revenue: Available<unknown>;
    penalty: Available<unknown>;
    evidence: {
      startObserved: boolean;
      endObserved: boolean;
      ruleContextComplete: boolean;
      clockAnomaly: boolean;
      reasons: string[];
    };
  };
}
const ajv = new Ajv2020({
  strict: true,
  strictTypes: false,
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
});
addFormats.default(ajv);
const validate = ajv.compile(schema);
function semantics(value: unknown, key = "", depth = 0): void {
  if (typeof value === "string") {
    if (Buffer.byteLength(value) > 256) throw new Error("SOURCE_TEXT_BYTES");
    if (key === "eventSeq" || key.endsWith("EventSeq")) {
      if (!/^(0|[1-9]\d*)$/.test(value) || BigInt(value) > 18446744073709551615n)
        throw new Error("INVALID_SEQUENCE");
    }
    if (
      ["cityId", "companyId", "cargoId", "mapId", "bodyType", "chainType"].includes(key) &&
      Buffer.byteLength(value) > 128
    )
      throw new Error("SOURCE_ID_BYTES");
    return;
  }
  if (!value || typeof value !== "object") return;
  if (depth > 16) throw new Error("INVALID_JSON_DEPTH");
  const row = value as Record<string, unknown>;
  if (typeof row.raw === "string" && (row.sdkType === "s64" || row.sdkType === "u64")) {
    const n = BigInt(row.raw),
      signed = row.sdkType === "s64";
    if (
      !/^(0|-?[1-9]\d*)$/.test(row.raw) ||
      n < (signed ? -9223372036854775808n : 0n) ||
      n > (signed ? 9223372036854775807n : 18446744073709551615n)
    )
      throw new Error("INVALID_MONEY_RANGE");
  }
  if (row.available === true && typeof row.value === "string") {
    const bound = ["cityName", "companyName", "cargoName"].includes(key) ? 256 : 128;
    if (Buffer.byteLength(row.value) > bound) throw new Error("SOURCE_TEXT_BYTES");
  }
  if (
    key === "dlcIds" &&
    row.available === true &&
    Array.isArray(row.value) &&
    row.value.some((id) => typeof id !== "string" || Buffer.byteLength(id) > 128)
  )
    throw new Error("SOURCE_ID_BYTES");
  for (const [name, item] of Object.entries(row)) semantics(item, name, depth + 1);
}
function parse(value: unknown): Telemetry {
  const canonical = canonicalJson(value);
  if (Buffer.byteLength(canonical) > 65536 || !validate(value))
    throw new Error("INVALID_TELEMETRY_ENVELOPE");
  semantics(value);
  const p = value as unknown as Telemetry,
    s = p.snapshot;
  sourceKey(p.eventId);
  sourceKey(p.source.pluginSessionId);
  sourceKey(p.source.tripId);
  const expected: Record<string, Outcome> = {
    "trip.started": "open",
    "trip.completed": "delivered",
    "trip.cancelled": "cancelled",
    "trip.closed": "none",
  };
  if (
    (p.type !== "trip.corrected" && expected[p.type] !== s.outcome) ||
    (p.type === "trip.corrected" && s.outcome === "open")
  )
    throw new Error("INVALID_LIFECYCLE");
  if (new Set(s.evidence.reasons).size !== s.evidence.reasons.length)
    throw new Error("DUPLICATE_REASON");
  return p;
}
export function telemetryJobType(market: unknown): RecordedTelemetry["jobType"] {
  if (
    !market ||
    typeof market !== "object" ||
    !("available" in market) ||
    market.available !== true ||
    !("value" in market)
  )
    return "unknown";
  switch (market.value) {
    case "quick_job":
      return "quick-job";
    case "freight_market":
      return "freight-market";
    case "cargo_market":
      return "cargo-market";
    case "external_contracts":
    case "external_market":
      return "world-of-trucks";
    default:
      return "unknown";
  }
}

export const telemetryAdapter: TripSourceAdapter = {
  provider: "ets2telemetry",
  version: 1,
  identity(payload) {
    const p = parse(payload);
    return {
      provider: "ets2telemetry",
      game: p.source.game,
      sessionKey: p.source.pluginSessionId,
      tripKey: p.source.tripId,
      eventKey: p.eventId,
      revision: p.revision,
      deliveryMode: p.delivery.mode,
    };
  },
  async normalize(payload, context) {
    const p = parse(payload),
      s = p.snapshot,
      id = context.sourceRecordId;
    const unknown = <T>(reasonCode: string): Fact<T> => ({
      status: "unknown",
      reasonCode,
      sourceRecordId: id,
    });
    const known = <T>(value: T, sourceField: string): Fact<T> => ({
      status: "known",
      value,
      sourceRecordId: id,
      sourceField,
    });
    const reasons = new Set(s.evidence.reasons);
    const unsupportedQuantities: Record<string, number> = {};
    const quantity = (input: Available<number>, field: string): Fact<string> => {
      if (!input.available) return unknown(input.reason);
      try {
        return known(decimal(input.value), field);
      } catch {
        unsupportedQuantities[field] = input.value;
        reasons.add("quantity_out_of_range");
        return unknown("quantity_out_of_range");
      }
    };
    let cargoAdr: { resolved: boolean; adrClass: AdrClass | null } = {
      resolved: false,
      adrClass: null,
    };
    async function resolve(
      input: Available<string>,
      field: string,
      kind: "city" | "cargo" | "trailer",
    ): Promise<Fact<TripEntity>> {
      if (!context.catalogs) return unknown("catalog_unavailable");
      if (!input.available || input.value === "") return unknown("source_id_unknown");
      const resolved = await context.catalogs.resolveInTransaction(context.tx, {
        game: p.source.game,
        kind,
        code: input.value,
      });
      if (resolved.status !== "resolved") return unknown(resolved.reasonCode);
      if (kind === "cargo") cargoAdr = { resolved: true, adrClass: resolved.adrClass };
      return known({ entityId: resolved.id }, field);
    }
    function time(input: Time | null, observed: boolean, isStart: boolean): ReportedTime {
      if (!input) return { utc: null, basis: "unknown", verifiedActual: false };
      let utc: string | null = null;
      try {
        utc = input.utcMs === null ? null : utcIso(utcDateTime(new Date(input.utcMs)));
      } catch {
        // Preserve the source number in immutable evidence; unsupported DB dates stay unknown.
      }
      return {
        utc,
        basis: input.basis,
        verifiedActual:
          utc !== null &&
          input.basis === "event" &&
          input.eventSeq !== null &&
          observed &&
          !s.evidence.clockAnomaly &&
          (isStart
            ? s.openedBy === "event" && s.openedEventSeq === input.eventSeq
            : s.outcome !== "open" && s.outcome !== "none" && s.outcomeEventSeq === input.eventSeq),
      };
    }
    const start = time(s.start, s.evidence.startObserved, true),
      end = time(s.end, s.evidence.endObserved, false);
    const timeOrderConflict = start.utc !== null && end.utc !== null && end.utc < start.utc;
    if (timeOrderConflict) {
      start.verifiedActual = false;
      end.verifiedActual = false;
    }
    // v1.2 carries the client's own distance accounting; earlier minors have none.
    const distance = p.contract.minor === 2 ? (s.accounting?.distance ?? "unknown") : null;
    const wholeTripDistanceSupported =
      s.recordingCompleteness === "complete" &&
      start.verifiedActual &&
      end.verifiedActual &&
      s.evidence.reasons.length === 0 &&
      (distance === null || distance === "complete");
    // Complete v1.2 distance accounting makes the observed distance the actual total despite
    // partial recording or client reasons; whole-trip support keeps the stricter rule above.
    const actualDistanceEligible =
      distance === null
        ? wholeTripDistanceSupported
        : start.verifiedActual && end.verifiedActual && distance === "complete";
    const origin = await resolve(s.job.origin.cityId, "snapshot.job.origin.cityId", "city");
    const destination = await resolve(
      s.job.destination.cityId,
      "snapshot.job.destination.cityId",
      "city",
    );
    const cargo = await resolve(s.job.cargoId, "snapshot.job.cargoId", "cargo");
    // A coupling counts as its first trailer's body type; every slot stays in provenance.
    const first = s.trailers.items.find((t) => t.index === 0);
    const trailers: Fact<TripEntity>[] = s.trailers.items.length
      ? [
          await resolve(
            first?.bodyType ?? { available: false, reason: "not-observed" },
            "snapshot.trailers.items.0.bodyType",
            "trailer",
          ),
        ]
      : [];
    const adrCategory: Fact<AdrClass> = !cargoAdr.resolved
      ? unknown("cargo_adr_unknown")
      : cargoAdr.adrClass === null
        ? unknown("cargo_not_adr")
        : known(cargoAdr.adrClass, "catalog.cargo.adrClass");
    const cargoMassKg = quantity(s.job.cargoMass, "snapshot.job.cargoMass");
    const ruleContextComplete =
      s.evidence.ruleContextComplete &&
      s.evidence.reasons.length === 0 &&
      s.trailers.complete &&
      trailers.length > 0 &&
      trailers.every((f) => f.status === "known") &&
      origin.status === "known" &&
      destination.status === "known" &&
      cargo.status === "known" &&
      (adrCategory.status === "known" || adrCategory.reasonCode === "cargo_not_adr") &&
      cargoMassKg.status === "known";
    if (!start.verifiedActual) reasons.add("actual_start_unknown");
    if (s.outcome !== "open" && !end.verifiedActual) reasons.add("actual_end_unknown");
    if (timeOrderConflict) reasons.add("time_order_conflict");
    if (!wholeTripDistanceSupported) reasons.add("whole_trip_distance_unknown");
    if (s.evidence.clockAnomaly) reasons.add("clock_anomaly");
    if (!ruleContextComplete) reasons.add("rule_context_incomplete");
    if (s.cargoDamage.available && s.cargoDamage.value > 1) reasons.add("damage_out_of_range");
    if (
      s.observedDistance.available &&
      s.deliveredDistance.available &&
      s.observedDistance.value !== s.deliveredDistance.value
    )
      reasons.add("distance_conflict");
    for (const [name, fact] of Object.entries({ origin, destination, cargo, adrCategory }))
      if (fact.status === "unknown" && fact.reasonCode !== "cargo_not_adr")
        reasons.add(`${name}_unknown`.replace("adrCategory", "adr"));
    const result: NormalizedTripEvidence = {
      sourceRecordId: id,
      factRevisionId: context.factRevisionId,
      provider: "ets2telemetry",
      ownerUserId: context.ownerUserId,
      game: p.source.game,
      outcome: s.outcome,
      recording: s.recordingCompleteness,
      start,
      end,
      origin,
      destination,
      cargo,
      cargoMassKg,
      actualDistanceM: actualDistanceEligible
        ? quantity(s.observedDistance, "snapshot.observedDistance")
        : unknown("whole_trip_distance_unknown"),
      measuredSegmentM: quantity(s.observedDistance, "snapshot.observedDistance"),
      plannedDistanceM: quantity(s.plannedDistance, "snapshot.plannedDistance"),
      deliveredDistanceM: quantity(s.deliveredDistance, "snapshot.deliveredDistance"),
      fuelUsedL: quantity(s.fuelUsed, "snapshot.fuelUsed"),
      cargoDamageFraction:
        s.cargoDamage.available && s.cargoDamage.value > 1
          ? unknown("damage_out_of_range")
          : quantity(s.cargoDamage, "snapshot.cargoDamage"),
      money: { expectedIncome: s.expectedIncome, revenue: s.revenue, penalty: s.penalty },
      recordedTelemetry: {
        jobType: telemetryJobType(s.job.market),
        gameMode: s.gameMode.mode,
        hardModeResult: s.hardModeResult ?? "unknown",
      },
      provenance: {
        sourceIdentity: {
          eventId: p.eventId,
          revision: p.revision,
          installationId: p.installationId,
          bindingId: p.bindingId,
          source: p.source,
        },
        contract: p.contract,
        producer: p.producer,
        createdUtcMs: p.createdUtcMs,
        delivery: p.delivery,
        context: s.context,
        mode: s.gameMode,
        lifecycle: {
          start: s.start,
          end: s.end,
          closeReason: s.closeReason,
          openedBy: s.openedBy,
          openedEventSeq: s.openedEventSeq,
          outcomeEventSeq: s.outcomeEventSeq,
          checkpointNextEventSeq: s.checkpointNextEventSeq,
        },
        jobIdentity: {
          originCityId: s.job.origin.cityId,
          destinationCityId: s.job.destination.cityId,
          cargoId: s.job.cargoId,
        },
        trailerEvidence: s.trailers,
        quality: s.evidence,
        anomalousDamage:
          s.cargoDamage.available && s.cargoDamage.value > 1 ? s.cargoDamage.value : null,
        unsupportedQuantities,
        accounting: s.accounting ?? null,
      },
      wholeTripDistanceSupported,
      trailers: { complete: s.trailers.complete, items: trailers },
      adrCategory,
      ruleContextComplete,
      reasonCodes: [...reasons].sort(),
    };
    return result;
  },
};
