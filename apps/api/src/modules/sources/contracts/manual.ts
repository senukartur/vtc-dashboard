import { applicationId } from "@vtc/db";
import { closed, positive } from "../../../platform/outbox/events.js";
import { decimal } from "./canonical.js";
import type {
  Fact,
  Game,
  NormalizedTripEvidence,
  PinnedEntity,
  TripSourceAdapter,
} from "./evidence.js";

// Internal boundary only: VTC-025 owns the authorized report/blob command and wire validation.
export interface ManualSourceRevision {
  reportId: string;
  revisionId: string;
  revision: number;
  game: Game;
  catalogRevisionId: string;
  originId: string;
  destinationId: string;
  cargoId: string;
  trailerTypeId: string;
  cargoMassKg: string;
  actualDistanceM: string;
  evidenceIds: string[];
}
function parse(payload: unknown): ManualSourceRevision {
  const p = closed(payload, [
    "reportId",
    "revisionId",
    "revision",
    "game",
    "catalogRevisionId",
    "originId",
    "destinationId",
    "cargoId",
    "trailerTypeId",
    "cargoMassKg",
    "actualDistanceM",
    "evidenceIds",
  ]);
  for (const name of [
    "reportId",
    "revisionId",
    "catalogRevisionId",
    "originId",
    "destinationId",
    "cargoId",
    "trailerTypeId",
  ])
    applicationId(p[name] as string);
  positive(p.revision);
  if (
    !["ets2", "ats"].includes(p.game as string) ||
    typeof p.cargoMassKg !== "string" ||
    typeof p.actualDistanceM !== "string" ||
    !Array.isArray(p.evidenceIds) ||
    p.evidenceIds.length < 1 ||
    p.evidenceIds.length > 100
  )
    throw new Error("INVALID_MANUAL_SOURCE");
  for (const value of p.evidenceIds) applicationId(value);
  if (new Set(p.evidenceIds).size !== p.evidenceIds.length)
    throw new Error("DUPLICATE_EVIDENCE_REFERENCE");
  decimal(p.cargoMassKg);
  decimal(p.actualDistanceM);
  return p as unknown as ManualSourceRevision;
}
export const manualAdapter: TripSourceAdapter = {
  provider: "manual",
  version: 1,
  identity(payload) {
    const p = parse(payload);
    return {
      provider: "manual",
      game: p.game,
      sessionKey: p.reportId,
      tripKey: p.reportId,
      eventKey: p.revisionId,
      revision: p.revision,
      deliveryMode: "manual",
    };
  },
  async normalize(payload, context) {
    const p = parse(payload),
      id = context.sourceRecordId;
    const known = <T>(value: T, sourceField: string): Fact<T> => ({
      status: "known",
      value,
      sourceRecordId: id,
      sourceField,
    });
    const unknown = <T>(reasonCode: string): Fact<T> => ({
      status: "unknown",
      reasonCode,
      sourceRecordId: id,
    });
    async function selected(
      entityId: string,
      kind: string,
      field: string,
    ): Promise<Fact<PinnedEntity>> {
      const fact = await context.catalogs?.pinnedInTransaction(
        context.tx,
        p.catalogRevisionId,
        entityId,
      );
      if (!fact || fact.game !== p.game || fact.kind !== kind)
        throw new Error("INVALID_PINNED_MANUAL_SELECTION");
      return known(
        { entityId, catalogRevisionId: p.catalogRevisionId, factRevisionId: fact.id },
        field,
      );
    }
    const origin = await selected(p.originId, "city", "originId"),
      destination = await selected(p.destinationId, "city", "destinationId"),
      cargo = await selected(p.cargoId, "cargo", "cargoId"),
      trailer = await selected(p.trailerTypeId, "trailer_type", "trailerTypeId");
    const result: NormalizedTripEvidence = {
      sourceRecordId: id,
      factRevisionId: context.factRevisionId,
      provider: "manual",
      ownerUserId: context.ownerUserId,
      game: p.game,
      outcome: "delivered",
      recording: "unknown",
      catalogRevisionId: p.catalogRevisionId,
      start: { utc: null, basis: "unknown", verifiedActual: false },
      end: { utc: null, basis: "unknown", verifiedActual: false },
      origin,
      destination,
      cargo,
      cargoMassKg: known(decimal(p.cargoMassKg), "cargoMassKg"),
      actualDistanceM: known(decimal(p.actualDistanceM), "actualDistanceM"),
      measuredSegmentM: unknown("not_supported"),
      plannedDistanceM: unknown("not_supported"),
      deliveredDistanceM: unknown("not_supported"),
      fuelUsedL: unknown("not_supported"),
      cargoDamageFraction: unknown("not_supported"),
      money: null,
      provenance: {
        reportId: p.reportId,
        revisionId: p.revisionId,
        revision: p.revision,
        evidenceIds: p.evidenceIds,
      },
      wholeTripDistanceSupported: false,
      trailers: { complete: true, items: [trailer] },
      adrCategory: unknown("cargo_adr_unknown"),
      ruleContextComplete: false,
      reasonCodes: ["manual_review_required", "manual_times_unknown"],
    };
    return result;
  },
};
