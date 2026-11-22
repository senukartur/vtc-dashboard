import type { components } from "@vtc/contracts";
import type { Fact, NormalizedTripEvidence, TripEntity } from "../sources/contracts/evidence.js";
import { type CorrectionField, editableFields } from "./evaluation.js";

type S = components["schemas"];
/** Extra decision reason code of a reviewer's "return for fixes" (VTC-169). */
export const RETURNED_FOR_FIXES = "returned_for_fixes";

type Available = { available?: unknown; value?: unknown } | undefined;
const raw = (value: Available) =>
  value?.available === true &&
  typeof value.value === "string" &&
  value.value.length > 0 &&
  value.value.length <= 128
    ? value.value
    : null;
const entity = (fact: Fact<TripEntity> | undefined) =>
  fact?.status === "known" ? fact.value.entityId : null;
const quantity = (fact: Fact<string>) => (fact.status === "known" ? fact.value : null);
const why = (fact: Fact<unknown> | undefined) =>
  fact?.status === "unknown" && fact.reasonCode.length <= 128 ? fact.reasonCode : null;

/**
 * Correctable facts of a fact revision with what the source reported, even when unconfirmed, so
 * the author starts from the telemetry value. Raw codes come only from immutable provenance.
 */
export function correctionFacts(e: NormalizedTripEvidence): S["TripCorrectionFact"][] {
  const provenance = (e.provenance ?? {}) as {
    jobIdentity?: { originCityId?: Available; destinationCityId?: Available; cargoId?: Available };
    trailerEvidence?: { items?: { index?: number; bodyType?: Available }[] };
  };
  const telemetry = e.provider === "ets2telemetry";
  const code = (value: Available) => (telemetry ? raw(value) : null);
  const firstTrailer = provenance.trailerEvidence?.items?.find((t) => t.index === 0);
  const value = (field: CorrectionField): Omit<S["TripCorrectionFact"], "field"> => {
    switch (field) {
      case "actualDistanceM":
        return {
          reported: quantity(e.actualDistanceM) ?? quantity(e.measuredSegmentM),
          sourceCode: null,
          reasonCode: e.wholeTripDistanceSupported ? null : "whole_trip_distance_unknown",
        };
      case "actualStartAt":
        return {
          reported: e.start.utc,
          sourceCode: null,
          reasonCode: e.start.verifiedActual ? null : "actual_start_unknown",
        };
      case "actualCompletedAt":
        return {
          reported: e.end.utc,
          sourceCode: null,
          reasonCode: e.end.verifiedActual ? null : "actual_completion_unknown",
        };
      case "originCityId":
        return {
          reported: entity(e.origin),
          sourceCode:
            e.origin.status === "known" ? null : code(provenance.jobIdentity?.originCityId),
          reasonCode: why(e.origin),
        };
      case "destinationCityId":
        return {
          reported: entity(e.destination),
          sourceCode:
            e.destination.status === "known"
              ? null
              : code(provenance.jobIdentity?.destinationCityId),
          reasonCode: why(e.destination),
        };
      case "cargoId":
        return {
          reported: entity(e.cargo),
          sourceCode: e.cargo.status === "known" ? null : code(provenance.jobIdentity?.cargoId),
          reasonCode: why(e.cargo),
        };
      case "cargoMassKg":
        return {
          reported: quantity(e.cargoMassKg),
          sourceCode: null,
          reasonCode: why(e.cargoMassKg),
        };
      case "trailerTypeId": {
        const first = e.trailers.items[0];
        return {
          reported: entity(first),
          sourceCode: first?.status === "known" ? null : code(firstTrailer?.bodyType),
          reasonCode: why(first) ?? (e.trailers.items.length ? null : "trailer_context_unknown"),
        };
      }
    }
  };
  return editableFields(e).map((field) => ({ field, ...value(field) }));
}

/** Acceptance blockers an author correction of the listed fields can clear. */
const fixable: Record<CorrectionField, readonly string[]> = {
  actualDistanceM: [
    "whole_trip_distance_unknown",
    "actual_distance_unknown",
    "actual_distance_not_positive",
    "recording_not_supported",
  ],
  actualStartAt: [
    "actual_start_unknown",
    "actual_time_order_invalid",
    "qualification_attribution_time_unknown",
  ],
  actualCompletedAt: ["actual_completion_unknown", "actual_time_order_invalid"],
  originCityId: ["origin_unknown"],
  destinationCityId: ["destination_unknown"],
  cargoId: ["cargo_unknown", "qualification_unknown"],
  cargoMassKg: ["cargoMassKg_unknown", "qualification_unknown"],
  trailerTypeId: ["trailer_context_unknown", "qualification_unknown"],
};
/** Whether every acceptance blocker is one the author can correct. */
export function blockedOnlyByEditable(
  blocked: readonly string[],
  fields: readonly CorrectionField[],
) {
  if (!blocked.length || !fields.length) return false;
  const allowed = new Set(fields.flatMap((field) => fixable[field]));
  return blocked.every((code) => allowed.has(code));
}

const CLIENT_REASON = /^[a-z][a-z0-9-]{0,63}$/;
/** Raw client quality reasons of a telemetry fact (snapshot.evidence.reasons), bounded. */
export function clientReasonCodes(e: NormalizedTripEvidence | null | undefined): string[] {
  if (e?.provider !== "ets2telemetry") return [];
  const quality = (e.provenance as { quality?: { reasons?: unknown } } | null)?.quality;
  if (!Array.isArray(quality?.reasons)) return [];
  return [
    ...new Set(
      quality.reasons.filter(
        (code): code is string => typeof code === "string" && CLIENT_REASON.test(code),
      ),
    ),
  ].slice(0, 32);
}

/** The latest human rejection without a return for fixes is final (no driver action). */
export function finalRejection(
  latest: { outcome: string; actorId: string | null; reasonCodes: readonly string[] } | undefined,
) {
  return (
    latest?.outcome === "rejected" &&
    latest.actorId !== null &&
    !latest.reasonCodes.includes(RETURNED_FOR_FIXES)
  );
}
export function returnedForFixes(
  latest: { outcome: string; actorId: string | null; reasonCodes: readonly string[] } | undefined,
) {
  return (
    latest?.outcome === "rejected" &&
    latest.actorId !== null &&
    latest.reasonCodes.includes(RETURNED_FOR_FIXES)
  );
}
