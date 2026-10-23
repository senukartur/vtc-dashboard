import type { components } from "@vtc/contracts";
import { applicationId } from "@vtc/db";
import { createSchemaValidator } from "../../../platform/http/schemas.js";
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
export interface ExtendedManualSourceRevision {
  format: 2;
  reportId: string;
  revisionId: string;
  revision: number;
  fields: components["schemas"]["ManualReportFields"];
}
const fieldsValidator = createSchemaValidator().compile({
  $ref: "urn:vtc:browser:v1#/$defs/ManualReportFields",
});
export function parseManualSource(
  payload: unknown,
): ManualSourceRevision | ExtendedManualSourceRevision {
  if (payload && typeof payload === "object" && "format" in payload) {
    const p = closed(payload, ["format", "reportId", "revisionId", "revision", "fields"]);
    if (p.format !== 2 || !fieldsValidator(p.fields)) throw new Error("INVALID_MANUAL_SOURCE");
    applicationId(p.reportId as string);
    applicationId(p.revisionId as string);
    positive(p.revision);
    const fields = p.fields as ExtendedManualSourceRevision["fields"];
    if (fields.evidenceIds.length > 100) throw new Error("INVALID_MANUAL_SOURCE");
    decimal(fields.cargoMassKg);
    decimal(fields.actualDistanceM);
    return p as unknown as ExtendedManualSourceRevision;
  }
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
  version: 2,
  versionFor: (payload) => ("format" in parseManualSource(payload) ? 2 : 1),
  identity(payload) {
    const p = parseManualSource(payload);
    return {
      provider: "manual",
      game: "format" in p ? p.fields.game : p.game,
      sessionKey: p.reportId,
      tripKey: p.reportId,
      eventKey: p.revisionId,
      revision: p.revision,
      deliveryMode: "manual",
    };
  },
  async normalize(payload, context) {
    const original = parseManualSource(payload),
      extended = "format" in original ? original : null,
      legacy = "format" in original ? null : original,
      p = extended
        ? {
            reportId: extended.reportId,
            revisionId: extended.revisionId,
            revision: extended.revision,
            game: extended.fields.game,
            cargoMassKg: extended.fields.cargoMassKg,
            actualDistanceM: extended.fields.actualDistanceM,
            evidenceIds: extended.fields.evidenceIds,
          }
        : (original as ManualSourceRevision),
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
      entityId: string | null,
      kind: string,
      field: string,
      selection?: components["schemas"]["ManualCatalogSelection"],
    ): Promise<Fact<PinnedEntity>> {
      if (selection?.status === "unresolved") return unknown(`manual_${selection.reasonCode}`);
      const revisionId =
        selection?.status === "resolved" ? selection.catalogRevisionId : legacy?.catalogRevisionId;
      if (selection?.status === "resolved") entityId = selection.entityId;
      if (!entityId || !revisionId) throw new Error("INVALID_PINNED_MANUAL_SELECTION");
      const fact = await context.catalogs?.pinnedInTransaction(context.tx, revisionId, entityId);
      if (!fact || fact.game !== p.game || fact.kind !== kind)
        throw new Error("INVALID_PINNED_MANUAL_SELECTION");
      return known({ entityId, catalogRevisionId: revisionId, factRevisionId: fact.id }, field);
    }
    const origin = await selected(
        legacy?.originId ?? null,
        "city",
        "originId",
        extended?.fields.origin,
      ),
      destination = await selected(
        legacy?.destinationId ?? null,
        "city",
        "destinationId",
        extended?.fields.destination,
      ),
      cargo = await selected(legacy?.cargoId ?? null, "cargo", "cargoId", extended?.fields.cargo),
      trailer = await selected(
        legacy?.trailerTypeId ?? null,
        "trailer_type",
        "trailerTypeId",
        extended?.fields.trailerType,
      );
    let adrCategory = unknown<PinnedEntity>("cargo_adr_unknown");
    if (cargo.status === "known") {
      const cargoFact = await context.catalogs?.pinnedInTransaction(
        context.tx,
        cargo.value.catalogRevisionId,
        cargo.value.entityId,
      );
      if (cargoFact?.adrCategoryId)
        adrCategory = await selected(
          cargoFact.adrCategoryId,
          "adr_category",
          "catalog.cargo.adrCategoryId",
          {
            status: "resolved",
            entityId: cargoFact.adrCategoryId,
            catalogRevisionId: cargo.value.catalogRevisionId,
          },
        );
    }
    const result: NormalizedTripEvidence = {
      sourceRecordId: id,
      factRevisionId: context.factRevisionId,
      provider: "manual",
      ownerUserId: context.ownerUserId,
      game: p.game,
      outcome: "delivered",
      recording: "unknown",
      catalogRevisionId: legacy?.catalogRevisionId ?? null,
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
        eventId: extended?.fields.eventId ?? null,
        reportId: p.reportId,
        revisionId: p.revisionId,
        revision: p.revision,
        evidenceIds: p.evidenceIds,
      },
      wholeTripDistanceSupported: false,
      trailers: { complete: true, items: [trailer] },
      adrCategory,
      ruleContextComplete: false,
      reasonCodes: ["manual_review_required", "manual_times_unknown"],
    };
    return result;
  },
};
