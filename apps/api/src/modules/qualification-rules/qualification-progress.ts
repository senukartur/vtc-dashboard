import type {
  QualificationProgressCondition,
  QualificationProgressResult,
  QualificationProgressTotals,
} from "./contracts.js";
import { compareDecimal, isValidNonNegativeDecimal, subtractDecimal } from "./decimal.js";

/**
 * Pure evaluator for driver qualification progress toward promotion thresholds.
 * Evaluates aggregated lifetime/period contributions independently of individual trip eligibility.
 *
 * @param condition Target threshold requirements (trips and/or distance in metres).
 * @param totals Current completed accepted trip contributions.
 */
export function evaluateQualificationProgress(
  condition: QualificationProgressCondition,
  totals: QualificationProgressTotals,
): QualificationProgressResult {
  if (!Number.isInteger(totals.completedTrips) || totals.completedTrips < 0) {
    throw new Error("INVALID_COMPLETED_TRIPS");
  }
  if (!isValidNonNegativeDecimal(totals.completedDistanceM)) {
    throw new Error("INVALID_COMPLETED_DISTANCE");
  }

  // 1. Evaluate required trips threshold
  let tripsSatisfied = true;
  let remainingTrips: number | null = null;
  if (condition.requiredTrips !== null) {
    if (!Number.isInteger(condition.requiredTrips) || condition.requiredTrips < 0) {
      throw new Error("INVALID_REQUIRED_TRIPS");
    }
    tripsSatisfied = totals.completedTrips >= condition.requiredTrips;
    remainingTrips = Math.max(0, condition.requiredTrips - totals.completedTrips);
  }

  // 2. Evaluate required distance threshold
  let distanceSatisfied = true;
  let remainingDistanceM: string | null = null;
  if (condition.requiredDistanceM !== null) {
    if (!isValidNonNegativeDecimal(condition.requiredDistanceM)) {
      throw new Error("INVALID_REQUIRED_DISTANCE");
    }
    const cmp = compareDecimal(totals.completedDistanceM, condition.requiredDistanceM);
    distanceSatisfied = cmp >= 0;
    remainingDistanceM = distanceSatisfied
      ? "0"
      : subtractDecimal(condition.requiredDistanceM, totals.completedDistanceM);
  }

  const eligibleForPromotion = tripsSatisfied && distanceSatisfied;

  return {
    eligibleForPromotion,
    tripsSatisfied,
    distanceSatisfied,
    currentTrips: totals.completedTrips,
    requiredTrips: condition.requiredTrips,
    currentDistanceM: totals.completedDistanceM,
    requiredDistanceM: condition.requiredDistanceM,
    remainingTrips,
    remainingDistanceM,
  };
}
