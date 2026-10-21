import type { Fact, NormalizedTripEvidence, PinnedEntity } from "../sources/contracts/evidence.js";
import {
  type EvaluationContext,
  type EventPrescribedLoadMatchResult,
  REASON_CODES,
} from "./contracts.js";
import { compareDecimal } from "./decimal.js";

export const BYPASSED_QUALIFICATION_RULE_TYPES = new Set([
  "max_mass",
  "allowed_trailer_types",
  "allowed_adr_categories",
]);

/**
 * Returns true if the given rule type is one of the three ordinary qualification rules
 * eligible for bypass under an event-prescribed load exception.
 */
export function isBypassedQualificationRule(ruleType: string): boolean {
  return BYPASSED_QUALIFICATION_RULE_TYPES.has(ruleType);
}

/**
 * Evaluates whether a trip matches an event-prescribed load and qualifies for
 * qualification limit bypass under company policy (Scenario 14).
 *
 * Requirements for bypass:
 * 1. A confirmed company event must be present in the evaluation context.
 * 2. Driver attendance must be explicitly confirmed (attendanceRevisionId must be present).
 *    An RSVP alone without attendance confirmation does not authorize the exception.
 * 3. All non-null prescribed load attributes (cargo, mass, trailer type) must match the trip evidence.
 */
export function matchEventPrescribedLoad(
  evidence: NormalizedTripEvidence,
  context: EvaluationContext,
): EventPrescribedLoadMatchResult {
  const event = context.confirmedEvent;
  if (!event) {
    return {
      matches: false,
      reasonCode: REASON_CODES.EVENT_NOT_CONFIRMED,
    };
  }

  // 1. Attendance confirmation check: attendanceRevisionId must be non-empty
  if (
    !event.attendanceRevisionId ||
    typeof event.attendanceRevisionId !== "string" ||
    event.attendanceRevisionId.trim() === ""
  ) {
    return {
      matches: false,
      reasonCode: REASON_CODES.EVENT_ATTENDANCE_UNCONFIRMED,
      details: {
        attendanceConfirmed: false,
        cargoMatch: false,
        massMatch: false,
        trailerMatch: false,
      },
    };
  }

  // 2. Cargo matching
  let cargoMatch = true;
  if (event.prescribedCargoId !== null) {
    cargoMatch =
      evidence.cargo.status === "known" &&
      evidence.cargo.value.entityId === event.prescribedCargoId;
  }

  // 3. Mass matching
  let massMatch = true;
  if (event.prescribedMassKg !== null) {
    massMatch =
      evidence.cargoMassKg.status === "known" &&
      compareDecimal(evidence.cargoMassKg.value, event.prescribedMassKg) === 0;
  }

  // 4. Trailer type matching
  let trailerMatch = true;
  if (event.prescribedTrailerTypeId !== null) {
    trailerMatch =
      evidence.trailers.items.length > 0 &&
      evidence.trailers.items.every(
        (t: Fact<PinnedEntity>) =>
          t.status === "known" && t.value.entityId === event.prescribedTrailerTypeId,
      );
  }

  const allMatched = cargoMatch && massMatch && trailerMatch;

  return {
    matches: allMatched,
    reasonCode: allMatched
      ? REASON_CODES.EVENT_PRESCRIBED_LOAD_BYPASS
      : REASON_CODES.EVENT_PRESCRIBED_LOAD_MISMATCH,
    details: {
      attendanceConfirmed: true,
      cargoMatch,
      massMatch,
      trailerMatch,
    },
  };
}
