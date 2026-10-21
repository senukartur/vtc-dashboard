import type { NormalizedTripEvidence } from "../sources/contracts/evidence.js";
import { type CompanyAcceptanceResult, type EvaluationOutcome, REASON_CODES } from "./contracts.js";
import { compareDecimal, isValidNonNegativeDecimal } from "./decimal.js";

/**
 * Pure evaluator for company trip acceptance rules.
 * Distinct from per-trip driver qualification rules and progress tracking.
 *
 * Checks:
 * 1. Outcome must be delivered.
 * 2. Telemetry trips require complete recording; manual reports require attached screenshot evidence.
 * 3. Distance must be supported (whole-trip supported for telemetry, positive known distance for all).
 */
export function evaluateCompanyAcceptance(
  evidence: NormalizedTripEvidence,
): CompanyAcceptanceResult {
  // Reject unhandled providers early
  if (evidence.provider !== "ets2telemetry" && evidence.provider !== "manual") {
    return {
      outcome: "fail",
      reasonCodes: [REASON_CODES.COMPANY_ACCEPTANCE_PROVIDER_UNSUPPORTED],
      details: {
        outcomeDelivered: false,
        recordingComplete: false,
        distanceSupported: false,
        screenshotAttached: false,
      },
    };
  }

  const reasonCodes: string[] = [];

  // 1. Outcome delivered check
  const outcomeDelivered = evidence.outcome === "delivered";
  if (!outcomeDelivered) {
    reasonCodes.push(REASON_CODES.COMPANY_ACCEPTANCE_OUTCOME_NOT_DELIVERED);
  }

  // 2. Recording completeness check (telemetry-only)
  const isTelemetry = evidence.provider === "ets2telemetry";
  const recordingComplete = isTelemetry ? evidence.recording === "complete" : true;
  if (isTelemetry && !recordingComplete) {
    reasonCodes.push(REASON_CODES.COMPANY_ACCEPTANCE_RECORDING_INCOMPLETE);
  }

  // 3. Supported distance check
  let distanceSupported = false;
  if (evidence.actualDistanceM.status === "known") {
    const distanceVal = evidence.actualDistanceM.value;
    const isPositive =
      isValidNonNegativeDecimal(distanceVal) && compareDecimal(distanceVal, "0") > 0;
    distanceSupported = isTelemetry
      ? evidence.wholeTripDistanceSupported && isPositive
      : isPositive;
  }
  if (!distanceSupported) {
    reasonCodes.push(REASON_CODES.COMPANY_ACCEPTANCE_DISTANCE_NOT_SUPPORTED);
  }

  // 4. Screenshot check (manual-only: requires array of non-empty strings)
  const isManual = evidence.provider === "manual";
  let screenshotAttached = true;
  if (isManual) {
    const prov = evidence.provenance as { evidenceIds?: readonly unknown[] } | undefined;
    screenshotAttached =
      Array.isArray(prov?.evidenceIds) &&
      prov.evidenceIds.length > 0 &&
      prov.evidenceIds.every((id: unknown) => typeof id === "string" && id.trim().length > 0);
    if (!screenshotAttached) {
      reasonCodes.push(REASON_CODES.COMPANY_ACCEPTANCE_SCREENSHOT_MISSING);
    }
  }

  let outcome: EvaluationOutcome;
  if (reasonCodes.length === 0) {
    outcome = "pass";
    reasonCodes.push(REASON_CODES.COMPANY_ACCEPTANCE_PASSED);
  } else if (
    !outcomeDelivered ||
    (isTelemetry && !recordingComplete) ||
    (isManual && !screenshotAttached) ||
    (evidence.actualDistanceM.status === "known" && !distanceSupported)
  ) {
    outcome = "fail";
  } else {
    // Missing required facts (e.g. unknown distance) without proven violation
    outcome = "unknown";
  }

  return {
    outcome,
    reasonCodes,
    details: {
      outcomeDelivered,
      recordingComplete,
      distanceSupported,
      screenshotAttached,
    },
  };
}
