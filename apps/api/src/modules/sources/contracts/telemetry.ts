import { utcDateTime, utcIso } from "@vtc/db";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { canonicalJson, decimal, sourceKey } from "./canonical.js";
import type {
  Fact,
  Game,
  NormalizedTripEvidence,
  Outcome,
  PinnedEntity,
  Recording,
  ReportedTime,
  TripSourceAdapter,
} from "./evidence.js";
import schema from "./telemetry-v1.schema.json" with { type: "json" };

type Available<T> = { available: true; value: T } | { available: false; reason: string };
type Time = { utcMs: number | null; basis: ReportedTime["basis"]; eventSeq: string | null };
export interface Telemetry {
  contract: unknown;
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
    gameMode: unknown;
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
    };
    trailers: { complete: boolean; items: { id: Available<string> }[] };
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
    const gameBuild =
      s.context.gameBuild.available && s.context.gameBuild.value ? s.context.gameBuild.value : null;
    const catalogRevisionId = gameBuild
      ? ((await context.catalogs?.publishedInTransaction(context.tx, p.source.game, gameBuild)) ??
        null)
      : null;
    const mapNamespace =
      s.context.mapId.available && s.context.mapId.value ? s.context.mapId.value : null;
    async function resolve(
      input: Available<string>,
      field: string,
      kind: "city" | "cargo" | "trailer_type",
    ): Promise<Fact<PinnedEntity>> {
      if (!context.catalogs) return unknown("catalog_unavailable");
      if (!gameBuild) return unknown("catalog_build_unknown");
      if (!catalogRevisionId) return unknown("catalog_build_unavailable");
      if (!mapNamespace) return unknown("map_unknown");
      if (!input.available || input.value === "") return unknown("source_id_unknown");
      const resolved = await context.catalogs.resolveInTransaction(context.tx, {
        revisionId: catalogRevisionId,
        game: p.source.game,
        kind,
        mapNamespace,
        provider: "ets2telemetry",
        sourceId: input.value,
        locale: null,
        label: null,
        regionId: null,
      });
      return resolved.status === "resolved"
        ? known(
            {
              entityId: resolved.entityId,
              catalogRevisionId,
              factRevisionId: resolved.factRevisionId,
            },
            field,
          )
        : unknown(resolved.status === "ambiguous" ? "catalog_ambiguous" : resolved.reasonCode);
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
    const wholeTripDistanceSupported =
      s.recordingCompleteness === "complete" &&
      start.verifiedActual &&
      end.verifiedActual &&
      s.evidence.reasons.length === 0;
    const origin = await resolve(s.job.origin.cityId, "snapshot.job.origin.cityId", "city");
    const destination = await resolve(
      s.job.destination.cityId,
      "snapshot.job.destination.cityId",
      "city",
    );
    const cargo = await resolve(s.job.cargoId, "snapshot.job.cargoId", "cargo");
    const trailers: Fact<PinnedEntity>[] = [];
    for (let index = 0; index < s.trailers.items.length; index++)
      trailers.push(
        await resolve(
          s.trailers.items[index]?.id ?? { available: false, reason: "not-observed" },
          `snapshot.trailers.items.${index}.id`,
          "trailer_type",
        ),
      );
    let adrCategory = unknown<PinnedEntity>("cargo_adr_unknown");
    if (cargo.status === "known" && context.catalogs && catalogRevisionId) {
      const fact = await context.catalogs.pinnedInTransaction(
        context.tx,
        catalogRevisionId,
        cargo.value.entityId,
      );
      if (fact?.adrCategoryId) {
        const adr = await context.catalogs.pinnedInTransaction(
          context.tx,
          catalogRevisionId,
          fact.adrCategoryId,
        );
        if (adr?.kind === "adr_category")
          adrCategory = known(
            { entityId: adr.entityId, catalogRevisionId, factRevisionId: adr.id },
            "catalog.cargo.adrCategoryId",
          );
      }
    }
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
      adrCategory.status === "known" &&
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
      if (fact.status === "unknown") reasons.add(`${name}_unknown`.replace("adrCategory", "adr"));
    const result: NormalizedTripEvidence = {
      sourceRecordId: id,
      factRevisionId: context.factRevisionId,
      provider: "ets2telemetry",
      ownerUserId: context.ownerUserId,
      game: p.source.game,
      outcome: s.outcome,
      recording: s.recordingCompleteness,
      catalogRevisionId,
      start,
      end,
      origin,
      destination,
      cargo,
      cargoMassKg,
      actualDistanceM: wholeTripDistanceSupported
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
