import type { components } from "@vtc/contracts";
import { createSchemaValidator } from "../../platform/http/schemas.js";
import { createTripGroups } from "./groups.js";
import { applicationId, type TxContext, type UnitOfWork } from "@vtc/db";
import {
  asc,
  eq,
  sql,
  tripResolutions,
  inArray,
  sourceMessages,
  sourceTrips,
  tripFacts,
  tripFactTrailers,
} from "@vtc/db/trips-schema";
import { decimal } from "../sources/contracts/canonical.js";
import type { Fact, NormalizedTripEvidence, TripEntity } from "../sources/contracts/evidence.js";

export function createFactRepository(unit: UnitOfWork) {
  const c = (tx: TxContext) => unit.client(tx),
    groups = createTripGroups(unit),
    validChanges = createSchemaValidator().compile({
      $ref: "urn:vtc:browser:v1#/$defs/ResolutionChanges",
    });
  return {
    async insert(
      tx: TxContext,
      tripId: string,
      f: NormalizedTripEvidence,
      adapterVersion: number,
      derived?: { baseFactId: string; resolutionRevisionId: string },
    ) {
      const entity = (value: Fact<TripEntity>) =>
        value.status === "known" ? value.value.entityId : null;
      const quantity = (value: Fact<string>) => (value.status === "known" ? value.value : null);
      await c(tx)
        .insert(tripFacts)
        .values({
          id: f.factRevisionId,
          kind: derived ? "derived" : "source",
          messageId: derived ? null : f.sourceRecordId,
          baseFactId: derived?.baseFactId ?? null,
          resolutionRevisionId: derived?.resolutionRevisionId ?? null,
          derivedSourceMessageId: derived ? f.sourceRecordId : null,
          canonicalTripId: tripId,
          adapterVersion,
          outcome: f.outcome,
          recording: f.recording,
          startUtc: f.start.utc,
          startBasis: f.start.basis,
          startVerified: f.start.verifiedActual,
          endUtc: f.end.utc,
          endBasis: f.end.basis,
          endVerified: f.end.verifiedActual,
          originCityId: entity(f.origin),
          destinationCityId: entity(f.destination),
          cargoId: entity(f.cargo),
          adrClass: f.adrCategory.status === "known" ? f.adrCategory.value : null,
          cargoMassKg: quantity(f.cargoMassKg),
          actualDistanceM: quantity(f.actualDistanceM),
          measuredSegmentM: quantity(f.measuredSegmentM),
          plannedDistanceM: quantity(f.plannedDistanceM),
          deliveredDistanceM: quantity(f.deliveredDistanceM),
          fuelUsedL: quantity(f.fuelUsedL),
          cargoDamageFraction: quantity(f.cargoDamageFraction),
          wholeTripDistanceSupported: f.wholeTripDistanceSupported,
          trailersComplete: f.trailers.complete,
          trailerCount: f.trailers.items.length,
          ruleContextComplete: f.ruleContextComplete,
          reasons: [...f.reasonCodes],
          evidence: f,
        });
      if (f.trailers.items.length > 10) throw new Error("SOURCE_TRAILER_BOUND_EXCEEDED");
      if (f.trailers.items.length)
        await c(tx)
          .insert(tripFactTrailers)
          .values(
            f.trailers.items.map((item, position) => ({
              tripFactId: f.factRevisionId,
              position,
              trailerId: entity(item),
              sourceField: item.status === "known" ? item.sourceField : null,
              unknownReason: item.status === "unknown" ? item.reasonCode : null,
            })),
          );
    },
    async read(tx: TxContext, ids: string[], current = false) {
      const result = new Map<string, { tripId: string; evidence: NormalizedTripEvidence }>();
      const unique = [...new Set(ids)].map(applicationId);
      if (unique.length > 100) throw new Error("SOURCE_FACT_BATCH_BOUND_EXCEEDED");
      if (!unique.length) return result;
      const rowsQuery = c(tx)
        .select({
          stored: tripFacts,
          provider: sourceMessages.provider,
          ownerUserId: sourceTrips.ownerId,
          game: sourceTrips.game,
        })
        .from(tripFacts)
        .innerJoin(
          sourceMessages,
          eq(
            sourceMessages.id,
            sql`COALESCE(${tripFacts.messageId},${tripFacts.derivedSourceMessageId})`,
          ),
        )
        .innerJoin(sourceTrips, eq(sourceTrips.id, sourceMessages.sourceTripId))
        .where(inArray(tripFacts.id, unique));
      // A command may have locked a pointer committed after its RR snapshot began.
      // Read the complete immutable projection from that same current view.
      const rows = await (current ? rowsQuery.for("share") : rowsQuery);
      const derived = rows.filter((r) => r.stored.kind === "derived"),
        baseIds = [
          ...new Set(derived.flatMap((r) => (r.stored.baseFactId ? [r.stored.baseFactId] : []))),
        ],
        resolutionIds = derived.flatMap((r) =>
          r.stored.resolutionRevisionId ? [r.stored.resolutionRevisionId] : [],
        );
      const bases = baseIds.length
        ? await c(tx).select().from(tripFacts).where(inArray(tripFacts.id, baseIds)).for("share")
        : [];
      const resolutions = resolutionIds.length
        ? await c(tx)
            .select()
            .from(tripResolutions)
            .where(inArray(tripResolutions.id, resolutionIds))
            .for("share")
        : [];
      const trailersQuery = c(tx)
        .select()
        .from(tripFactTrailers)
        .where(inArray(tripFactTrailers.tripFactId, [...new Set([...unique, ...baseIds])]))
        .orderBy(asc(tripFactTrailers.position));
      const trailers = await (current ? trailersQuery.for("share") : trailersQuery);
      for (const row of rows) {
        const stored = row.stored,
          metadata = stored.evidence as NormalizedTripEvidence,
          messageId = stored.messageId ?? stored.derivedSourceMessageId;
        if (!messageId) throw new Error("SOURCE_PROVENANCE_MISSING");
        if (stored.kind === "derived") {
          const resolution = resolutions.find((r) => r.id === stored.resolutionRevisionId),
            base = bases.find((b) => b.id === stored.baseFactId);
          if (
            !resolution ||
            !base ||
            base.id === stored.id ||
            base.baseFactId === stored.id ||
            resolution.baseFactId !== base.id ||
            resolution.tripId !== stored.canonicalTripId ||
            (base.messageId ?? base.derivedSourceMessageId) !== messageId ||
            !validChanges(resolution.changes) ||
            !resolution.reason.trim()
          )
            throw new Error("DERIVED_PROVENANCE_INVALID");
          const own = await groups.resolve(tx, stored.canonicalTripId, "share"),
            previous = await groups.resolve(tx, base.canonicalTripId, "share");
          if (own.id !== previous.id || own.ownerId !== row.ownerUserId || own.game !== row.game)
            throw new Error("DERIVED_PROVENANCE_SCOPE_INVALID");
          const changes = resolution.changes as Record<string, string>;
          for (const [key, column] of [
            ["actualDistanceM", "actualDistanceM"],
            ["cargoMassKg", "cargoMassKg"],
            ["actualStartAt", "startUtc"],
            ["actualCompletedAt", "endUtc"],
            ["originCityId", "originCityId"],
            ["destinationCityId", "destinationCityId"],
            ["cargoId", "cargoId"],
          ] as const) {
            const actual = stored[column],
              expected = changes[key] ?? base[column];
            const quantity = column === "actualDistanceM" || column === "cargoMassKg";
            if (
              (actual === null ? null : quantity ? decimal(actual) : actual) !==
              (expected === null ? null : quantity ? decimal(expected as string) : expected)
            )
              throw new Error("DERIVED_PROVENANCE_VALUE_MISMATCH");
          }
          for (const key of [
            "outcome",
            "recording",
            "measuredSegmentM",
            "plannedDistanceM",
            "deliveredDistanceM",
            "fuelUsedL",
            "cargoDamageFraction",
          ] as const)
            if (stored[key] !== base[key]) throw new Error("DERIVED_PROVENANCE_VALUE_MISMATCH");
          if (row.provider === "manual" && (changes.actualStartAt || changes.actualCompletedAt))
            throw new Error("DERIVED_MANUAL_TIME_FORBIDDEN");
          for (const [field, key] of [
            ["start", "actualStartAt"],
            ["end", "actualCompletedAt"],
          ] as const) {
            if (
              changes[key] &&
              (stored[`${field}Basis`] !== "staff-resolution" || !stored[`${field}Verified`])
            )
              throw new Error("DERIVED_TIME_PROVENANCE_INVALID");
            if (
              !changes[key] &&
              (stored[`${field}Basis`] !== base[`${field}Basis`] ||
                stored[`${field}Verified`] !== base[`${field}Verified`])
            )
              throw new Error("DERIVED_TIME_PROVENANCE_INVALID");
          }
          const actualTrailers = trailers.filter((t) => t.tripFactId === stored.id),
            baseTrailers = trailers.filter((t) => t.tripFactId === base.id);
          if (
            changes.trailerTypeId
              ? actualTrailers.length !== 1 ||
                !stored.trailersComplete ||
                actualTrailers[0]?.trailerId !== changes.trailerTypeId
              : stored.trailersComplete !== base.trailersComplete ||
                JSON.stringify(actualTrailers.map((t) => t.trailerId)) !==
                  JSON.stringify(baseTrailers.map((t) => t.trailerId))
          )
            throw new Error("DERIVED_TRAILER_PROVENANCE_INVALID");
        }
        if (![1, 2].includes(stored.adapterVersion))
          throw new Error("UNSUPPORTED_SOURCE_FACT_VERSION");
        if (!metadata || typeof metadata !== "object") throw new Error("SOURCE_PROVENANCE_MISSING");
        const unknown = <T>(meta: Fact<T>): Fact<T> => ({
          status: "unknown",
          reasonCode: meta?.status === "unknown" ? meta.reasonCode : "normalized_unknown",
          sourceRecordId: messageId,
        });
        const known = <T>(value: T, meta: Fact<T>): Fact<T> => {
          if (meta?.status !== "known" || typeof meta.sourceField !== "string")
            throw new Error("SOURCE_PROVENANCE_MISSING");
          return {
            status: "known",
            value,
            sourceRecordId: messageId,
            sourceField: meta.sourceField,
          };
        };
        const entity = (id: string | null, meta: Fact<TripEntity>): Fact<TripEntity> =>
          id === null ? unknown(meta) : known({ entityId: id }, meta);
        const quantity = (value: string | null, meta: Fact<string>): Fact<string> =>
          value === null ? unknown(meta) : known(decimal(value), meta);
        const orderedTrailers = trailers.filter((t) => t.tripFactId === stored.id);
        if (
          orderedTrailers.length !== stored.trailerCount ||
          orderedTrailers.some((t, index) => t.position !== index)
        )
          throw new Error("SOURCE_TRAILER_HISTORY_INCOMPLETE");
        const items: Fact<TripEntity>[] = orderedTrailers.map((t) => {
          if (t.trailerId === null)
            return {
              status: "unknown",
              reasonCode: t.unknownReason ?? "normalized_unknown",
              sourceRecordId: messageId,
            };
          if (!t.sourceField) throw new Error("SOURCE_TRAILER_REF_INCONSISTENT");
          return {
            status: "known",
            value: { entityId: t.trailerId },
            sourceRecordId: messageId,
            sourceField: t.sourceField,
          };
        });
        const evidence: NormalizedTripEvidence = {
          sourceRecordId: messageId,
          factRevisionId: stored.id,
          provider: row.provider,
          ownerUserId: row.ownerUserId,
          game: row.game,
          outcome: stored.outcome,
          recording: stored.recording,
          start: {
            utc: stored.startUtc,
            basis: stored.startBasis,
            verifiedActual: stored.startVerified,
          },
          end: { utc: stored.endUtc, basis: stored.endBasis, verifiedActual: stored.endVerified },
          origin: entity(stored.originCityId, metadata.origin),
          destination: entity(stored.destinationCityId, metadata.destination),
          cargo: entity(stored.cargoId, metadata.cargo),
          adrCategory:
            stored.adrClass === null
              ? unknown(metadata.adrCategory)
              : known(stored.adrClass, metadata.adrCategory),
          cargoMassKg: quantity(stored.cargoMassKg, metadata.cargoMassKg),
          actualDistanceM: quantity(stored.actualDistanceM, metadata.actualDistanceM),
          measuredSegmentM: quantity(stored.measuredSegmentM, metadata.measuredSegmentM),
          plannedDistanceM: quantity(stored.plannedDistanceM, metadata.plannedDistanceM),
          deliveredDistanceM: quantity(stored.deliveredDistanceM, metadata.deliveredDistanceM),
          fuelUsedL: quantity(stored.fuelUsedL, metadata.fuelUsedL),
          cargoDamageFraction: quantity(stored.cargoDamageFraction, metadata.cargoDamageFraction),
          trailers: { complete: stored.trailersComplete, items },
          wholeTripDistanceSupported: stored.wholeTripDistanceSupported,
          ruleContextComplete: stored.ruleContextComplete,
          reasonCodes: stored.reasons,
          money: metadata.money,
          provenance: metadata.provenance,
        };
        result.set(stored.id, { tripId: stored.canonicalTripId, evidence });
      }
      return result;
    },
  };
}

/** Explicit normalized private projection; no raw payload, diagnostic text or money. */
export function effectiveFacts(
  f: NormalizedTripEvidence,
): components["schemas"]["EffectiveTripFacts"] {
  const pin = (value: Fact<TripEntity>) =>
    value.status === "known" ? { entityId: value.value.entityId } : null;
  const quantity = (value: Fact<string>) => (value.status === "known" ? value.value : null);
  return {
    factRevisionId: f.factRevisionId,
    provider: f.provider,
    actualStartAt: f.start.verifiedActual ? f.start.utc : null,
    actualCompletedAt: f.end.verifiedActual ? f.end.utc : null,
    actualDistanceM: quantity(f.actualDistanceM),
    plannedDistanceM: quantity(f.plannedDistanceM),
    cargoMassKg: quantity(f.cargoMassKg),
    origin: pin(f.origin),
    destination: pin(f.destination),
    cargo: pin(f.cargo),
    trailers: f.trailers.items.map(pin),
    trailersComplete: f.trailers.complete,
    wholeTripDistanceSupported: f.wholeTripDistanceSupported,
    ruleContextComplete: f.ruleContextComplete,
  };
}
