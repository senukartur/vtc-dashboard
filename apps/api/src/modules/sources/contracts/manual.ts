import type { components } from "@vtc/contracts";
import { applicationId } from "@vtc/db";
import { createSchemaValidator } from "../../../platform/http/schemas.js";
import { closed, positive } from "../../../platform/outbox/events.js";
import { decimal } from "./canonical.js";
import type {
  AdrClass,
  Fact,
  NormalizedTripEvidence,
  TripEntity,
  TripSourceAdapter,
} from "./evidence.js";

// Internal boundary only: VTC-025 owns the authorized report/blob command and wire validation.
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
export function parseManualSource(payload: unknown): ExtendedManualSourceRevision {
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
export const manualAdapter: TripSourceAdapter = {
  provider: "manual",
  version: 2,
  identity(payload) {
    const p = parseManualSource(payload);
    return {
      provider: "manual",
      game: p.fields.game,
      sessionKey: p.reportId,
      tripKey: p.reportId,
      eventKey: p.revisionId,
      revision: p.revision,
      deliveryMode: "manual",
    };
  },
  async normalize(payload, context) {
    const source = parseManualSource(payload),
      p = {
        reportId: source.reportId,
        revisionId: source.revisionId,
        revision: source.revision,
        game: source.fields.game,
        cargoMassKg: source.fields.cargoMassKg,
        actualDistanceM: source.fields.actualDistanceM,
        evidenceIds: source.fields.evidenceIds,
      },
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
    let cargoClass: AdrClass | null = null;
    async function selected(
      kind: "city" | "cargo" | "trailer",
      field: string,
      selection: components["schemas"]["ManualCatalogSelection"],
    ): Promise<Fact<TripEntity>> {
      if (selection.status === "unresolved") return unknown(`manual_${selection.reasonCode}`);
      const row = (
        await context.catalogs?.selectionsInTransaction(context.tx, [
          { kind, id: selection.entityId },
        ])
      )?.get(selection.entityId);
      if (!row || row.game !== p.game || row.kind !== kind)
        throw new Error("INVALID_MANUAL_SELECTION");
      if (kind === "cargo") cargoClass = row.adrClass;
      return known({ entityId: selection.entityId }, field);
    }
    const origin = await selected("city", "originId", source.fields.origin),
      destination = await selected("city", "destinationId", source.fields.destination),
      cargo = await selected("cargo", "cargoId", source.fields.cargo),
      trailer = await selected("trailer", "trailerTypeId", source.fields.trailerType);
    const adrCategory: Fact<AdrClass> =
      cargo.status !== "known"
        ? unknown("cargo_adr_unknown")
        : cargoClass === null
          ? unknown("cargo_not_adr")
          : known(cargoClass, "catalog.cargo.adrClass");
    const result: NormalizedTripEvidence = {
      sourceRecordId: id,
      factRevisionId: context.factRevisionId,
      provider: "manual",
      ownerUserId: context.ownerUserId,
      game: p.game,
      outcome: "delivered",
      recording: "unknown",
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
        eventId: source.fields.eventId ?? null,
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
