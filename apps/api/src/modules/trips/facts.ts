import { applicationId, type TxContext, type UnitOfWork } from "@vtc/db";
import {
  asc,
  eq,
  inArray,
  sourceMessages,
  sourceTrips,
  tripFacts,
  tripFactTrailers,
} from "@vtc/db/trips-schema";
import { decimal } from "../sources/contracts/canonical.js";
import type { Fact, NormalizedTripEvidence, PinnedEntity } from "../sources/contracts/evidence.js";

export function createFactRepository(unit: UnitOfWork) {
  const c = (tx: TxContext) => unit.client(tx);
  return {
    async insert(tx: TxContext, tripId: string, f: NormalizedTripEvidence, adapterVersion: number) {
      function pin(value: Fact<PinnedEntity>) {
        if (value.status === "unknown") return { entityId: null, factId: null };
        if (value.value.catalogRevisionId !== f.catalogRevisionId)
          throw new Error("SOURCE_FACT_CATALOG_MISMATCH");
        return { entityId: value.value.entityId, factId: value.value.factRevisionId };
      }
      const origin = pin(f.origin),
        destination = pin(f.destination),
        cargo = pin(f.cargo),
        adr = pin(f.adrCategory);
      const quantity = (value: Fact<string>) => (value.status === "known" ? value.value : null);
      await c(tx)
        .insert(tripFacts)
        .values({
          id: f.factRevisionId,
          messageId: f.sourceRecordId,
          canonicalTripId: tripId,
          adapterVersion,
          catalogRevisionId: f.catalogRevisionId,
          outcome: f.outcome,
          recording: f.recording,
          startUtc: f.start.utc,
          startBasis: f.start.basis,
          startVerified: f.start.verifiedActual,
          endUtc: f.end.utc,
          endBasis: f.end.basis,
          endVerified: f.end.verifiedActual,
          originEntityId: origin.entityId,
          originFactId: origin.factId,
          destinationEntityId: destination.entityId,
          destinationFactId: destination.factId,
          cargoEntityId: cargo.entityId,
          cargoFactId: cargo.factId,
          adrEntityId: adr.entityId,
          adrFactId: adr.factId,
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
            f.trailers.items.map((item, position) => {
              const ref = pin(item);
              return {
                tripFactId: f.factRevisionId,
                position,
                catalogRevisionId: item.status === "known" ? item.value.catalogRevisionId : null,
                entityId: ref.entityId,
                catalogFactId: ref.factId,
                sourceField: item.status === "known" ? item.sourceField : null,
                unknownReason: item.status === "unknown" ? item.reasonCode : null,
              };
            }),
          );
    },
    async read(tx: TxContext, ids: string[]) {
      const result = new Map<string, { tripId: string; evidence: NormalizedTripEvidence }>();
      const unique = [...new Set(ids)].map(applicationId);
      if (unique.length > 100) throw new Error("SOURCE_FACT_BATCH_BOUND_EXCEEDED");
      if (!unique.length) return result;
      const rows = await c(tx)
        .select({
          stored: tripFacts,
          provider: sourceMessages.provider,
          ownerUserId: sourceTrips.ownerId,
          game: sourceTrips.game,
        })
        .from(tripFacts)
        .innerJoin(sourceMessages, eq(sourceMessages.id, tripFacts.messageId))
        .innerJoin(sourceTrips, eq(sourceTrips.id, sourceMessages.sourceTripId))
        .where(inArray(tripFacts.id, unique));
      const trailers = await c(tx)
        .select()
        .from(tripFactTrailers)
        .where(inArray(tripFactTrailers.tripFactId, unique))
        .orderBy(asc(tripFactTrailers.position));
      for (const row of rows) {
        const stored = row.stored,
          metadata = stored.evidence as NormalizedTripEvidence;
        if (stored.adapterVersion !== 1) throw new Error("UNSUPPORTED_SOURCE_FACT_VERSION");
        if (!metadata || typeof metadata !== "object") throw new Error("SOURCE_PROVENANCE_MISSING");
        const unknown = <T>(meta: Fact<T>): Fact<T> => ({
          status: "unknown",
          reasonCode: meta?.status === "unknown" ? meta.reasonCode : "normalized_unknown",
          sourceRecordId: stored.messageId,
        });
        const known = <T>(value: T, meta: Fact<T>): Fact<T> => {
          if (meta?.status !== "known" || typeof meta.sourceField !== "string")
            throw new Error("SOURCE_PROVENANCE_MISSING");
          return {
            status: "known",
            value,
            sourceRecordId: stored.messageId,
            sourceField: meta.sourceField,
          };
        };
        const pin = (
          entityId: string | null,
          factId: string | null,
          meta: Fact<PinnedEntity>,
        ): Fact<PinnedEntity> => {
          if (entityId === null) return unknown(meta);
          if (!stored.catalogRevisionId || !factId) throw new Error("SOURCE_PIN_INCONSISTENT");
          return known(
            { entityId, factRevisionId: factId, catalogRevisionId: stored.catalogRevisionId },
            meta,
          );
        };
        const quantity = (value: string | null, meta: Fact<string>): Fact<string> =>
          value === null ? unknown(meta) : known(decimal(value), meta);
        const orderedTrailers = trailers.filter((t) => t.tripFactId === stored.id);
        if (
          orderedTrailers.length !== stored.trailerCount ||
          orderedTrailers.some((t, index) => t.position !== index)
        )
          throw new Error("SOURCE_TRAILER_HISTORY_INCOMPLETE");
        const items: Fact<PinnedEntity>[] = orderedTrailers.map((t) => {
          if (t.entityId === null)
            return {
              status: "unknown",
              reasonCode: t.unknownReason ?? "normalized_unknown",
              sourceRecordId: stored.messageId,
            };
          if (!t.catalogFactId || !t.catalogRevisionId || !t.sourceField)
            throw new Error("SOURCE_TRAILER_PIN_INCONSISTENT");
          return {
            status: "known",
            value: {
              entityId: t.entityId,
              factRevisionId: t.catalogFactId,
              catalogRevisionId: t.catalogRevisionId,
            },
            sourceRecordId: stored.messageId,
            sourceField: t.sourceField,
          };
        });
        const evidence: NormalizedTripEvidence = {
          sourceRecordId: stored.messageId,
          factRevisionId: stored.id,
          provider: row.provider,
          ownerUserId: row.ownerUserId,
          game: row.game,
          outcome: stored.outcome,
          recording: stored.recording,
          catalogRevisionId: stored.catalogRevisionId,
          start: {
            utc: stored.startUtc,
            basis: stored.startBasis,
            verifiedActual: stored.startVerified,
          },
          end: { utc: stored.endUtc, basis: stored.endBasis, verifiedActual: stored.endVerified },
          origin: pin(stored.originEntityId, stored.originFactId, metadata.origin),
          destination: pin(
            stored.destinationEntityId,
            stored.destinationFactId,
            metadata.destination,
          ),
          cargo: pin(stored.cargoEntityId, stored.cargoFactId, metadata.cargo),
          adrCategory: pin(stored.adrEntityId, stored.adrFactId, metadata.adrCategory),
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
