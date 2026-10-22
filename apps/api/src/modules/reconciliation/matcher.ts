import { canonicalJson, contentHash, decimal } from "../sources/contracts/canonical.js";
import type { NormalizedTripEvidence as Evidence } from "../sources/contracts/evidence.js";
export interface MatchingRule {
  version: number;
  startToleranceMs: number;
  endToleranceMs: number;
  distanceToleranceM: string;
}
export interface ReconciliationConfig {
  key: string;
  rule?: MatchingRule;
}
export const candidateBound = 100;
export function validateReconciliationConfig(config: ReconciliationConfig) {
  if (!/^[0-9a-f]{64}$/.test(config.key)) throw new Error("INVALID_RECONCILIATION_CONFIG");
  if (!config.rule) return;
  const r = config.rule;
  if (
    !Number.isInteger(r.version) ||
    r.version < 1 ||
    r.version > 2147483647 ||
    !Number.isSafeInteger(r.startToleranceMs) ||
    r.startToleranceMs < 0 ||
    !Number.isSafeInteger(r.endToleranceMs) ||
    r.endToleranceMs < 0 ||
    typeof r.distanceToleranceM !== "string" ||
    decimal(r.distanceToleranceM) !== r.distanceToleranceM
  )
    throw new Error("INVALID_RECONCILIATION_RULE");
}
export const ruleSnapshot = (rule: MatchingRule | undefined) => ({
  matcher: "canonical-evidence/v1",
  rule: rule ?? null,
});
export const ruleIdentity = (rule: MatchingRule | undefined) =>
  contentHash(canonicalJson(ruleSnapshot(rule)));
function scaled(value: string) {
  const [whole = "0", fraction = ""] = decimal(value).split(".");
  return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, "0"));
}
export function withinDistance(left: string, right: string, tolerance: string) {
  const d = scaled(left) - scaled(right);
  return (d < 0n ? -d : d) <= scaled(tolerance);
}
export function matchEvidence(left: Evidence, right: Evidence, rule?: MatchingRule) {
  const reasons: string[] = [];
  // Frozen v1 authenticates the submitter; no gameplay-owner attestation exists for legacy unbound history.
  if (left.provider === "ets2telemetry" || right.provider === "ets2telemetry")
    reasons.push("gameplay_owner_unproven");
  if (left.ownerUserId !== right.ownerUserId || left.game !== right.game)
    return { outcome: "different" as const, reasons: ["owner_or_game_differs"] };
  // Distinct identities from a single provider cannot prove another copy of the same trip.
  if (left.provider === right.provider)
    return { outcome: "different" as const, reasons: ["distinct_same_provider_identity"] };
  for (const field of ["origin", "destination", "cargo"] as const) {
    const a = left[field],
      b = right[field];
    if (a.status === "known" && b.status === "known") {
      if (a.value.entityId !== b.value.entityId)
        return { outcome: "different" as const, reasons: [`${field}_identity_differs`] };
    } else reasons.push(`${field}_identity_unknown`);
  }
  if (!rule) reasons.push("matching_rule_unconfigured");
  for (const field of ["start", "end"] as const) {
    const a = left[field],
      b = right[field];
    if (!a.verifiedActual || !b.verifiedActual || !a.utc || !b.utc)
      reasons.push(`${field}_unsupported`);
    else if (
      rule &&
      Math.abs(Date.parse(a.utc) - Date.parse(b.utc)) >
        (field === "start" ? rule.startToleranceMs : rule.endToleranceMs)
    )
      return { outcome: "different" as const, reasons: [`${field}_outside_tolerance`] };
  }
  if (
    !left.wholeTripDistanceSupported ||
    !right.wholeTripDistanceSupported ||
    left.actualDistanceM.status !== "known" ||
    right.actualDistanceM.status !== "known"
  )
    reasons.push("whole_trip_distance_unsupported");
  else if (
    rule &&
    !withinDistance(
      left.actualDistanceM.value,
      right.actualDistanceM.value,
      rule.distanceToleranceM,
    )
  )
    return { outcome: "different" as const, reasons: ["distance_outside_tolerance"] };
  if (
    left.outcome !== "delivered" ||
    right.outcome !== "delivered" ||
    left.recording !== "complete" ||
    right.recording !== "complete"
  )
    reasons.push("lifecycle_incomplete");
  // Today's undated manual contract intentionally cannot satisfy actual-time proof.
  if (left.provider === "manual" || right.provider === "manual")
    reasons.push("manual_actual_time_unknown");
  return {
    outcome: reasons.length ? ("review_required" as const) : ("supported" as const),
    reasons: [...new Set(reasons)].sort(),
  };
}

export function automaticCandidate<T extends { supported: boolean }>(
  candidates: readonly T[],
  searchComplete: boolean,
): T | null {
  return searchComplete && candidates.length === 1 && candidates[0]?.supported
    ? candidates[0]
    : null;
}
