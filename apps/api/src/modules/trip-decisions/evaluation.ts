import type { components } from "@vtc/contracts";
import type { ConfirmedEventContext } from "../qualification-rules/contracts.js";
import { compareDecimal } from "../qualification-rules/decimal.js";
import { defaultRegistry } from "../qualification-rules/registry.js";
import type { Qualifications } from "../qualifications/service.js";
import type { NormalizedTripEvidence } from "../sources/contracts/evidence.js";

type S = components["schemas"];
export type Historical = Awaited<ReturnType<Qualifications["lookupInTransaction"]>>;
// Lifecycle and knowledge gates precede pure qualification checks. Missing evidence is never proof of violation.
export function classify(
  e: NormalizedTripEvidence,
  history: Historical,
  event: ConfirmedEventContext | null,
  workflow: readonly string[] = [],
  human = false,
  manualReviewRequired = false,
) {
  const missing: string[] = [],
    violations: string[] = [];
  if (e.outcome === "open")
    return {
      decision:
        human || e.provider === "manual" || manualReviewRequired || workflow.length
          ? ("pending_review" as const)
          : ("unassessed" as const),
      reasons: [
        ...new Set([
          "trip_open",
          ...workflow,
          ...(!human && (e.provider === "manual" || manualReviewRequired)
            ? ["manual_requires_other_reviewer"]
            : []),
        ]),
      ].sort(),
    };
  if (e.outcome === "cancelled") violations.push("terminal_outcome_not_delivered");
  if (e.outcome === "none") missing.push("terminal_outcome_unknown");
  if (e.provider === "ets2telemetry") {
    if (e.recording !== "complete") missing.push("recording_not_supported");
    if (!e.wholeTripDistanceSupported) missing.push("whole_trip_distance_unknown");
    if (!e.start.verifiedActual || !e.start.utc) missing.push("actual_start_unknown");
    if (!e.end.verifiedActual || !e.end.utc) missing.push("actual_completion_unknown");
    if (
      e.start.verifiedActual &&
      e.end.verifiedActual &&
      e.start.utc &&
      e.end.utc &&
      e.start.utc > e.end.utc
    )
      violations.push("actual_time_order_invalid");
  } else {
    const provenance = e.provenance as { evidenceIds?: unknown[] };
    if (!provenance?.evidenceIds?.length) missing.push("manual_evidence_missing");
    if (!human) missing.push("manual_requires_other_reviewer");
  }
  if (e.actualDistanceM.status !== "known") missing.push("actual_distance_unknown");
  else if (compareDecimal(e.actualDistanceM.value, "0") <= 0)
    violations.push("actual_distance_not_positive");
  for (const field of ["origin", "destination", "cargo", "cargoMassKg"] as const)
    if (e[field].status !== "known") missing.push(`${field}_unknown`);
  if (
    !e.trailers.complete ||
    !e.trailers.items.length ||
    e.trailers.items.some((t) => t.status !== "known")
  )
    missing.push("trailer_context_unknown");
  if (history.status !== "resolved") missing.push(history.reasonCode);
  else {
    const rules = defaultRegistry.evaluate(e, history.rules, {
      qualificationAssignmentId: history.assignmentId,
      ruleVersionId: history.ruleVersionId,
      confirmedEvent: event,
    });
    if (rules.outcome === "fail")
      violations.push(
        ...rules.ruleResults.filter((r) => r.outcome === "fail").map((r) => r.reasonCode),
      );
    if (rules.outcome === "unknown")
      missing.push(
        ...rules.ruleResults.filter((r) => r.outcome === "unknown").map((r) => r.reasonCode),
      );
  }
  if (manualReviewRequired && !human) missing.push("manual_requires_other_reviewer");
  if ((e.provider === "manual" || manualReviewRequired) && !human)
    return {
      decision: "pending_review" as const,
      reasons: [...new Set([...violations, ...missing, ...workflow])].sort(),
    };
  const reasons = [...new Set([...violations, ...missing, ...workflow])].sort();
  return {
    decision: violations.length
      ? ("rejected" as const)
      : missing.length || workflow.length
        ? ("pending_review" as const)
        : ("accepted" as const),
    reasons: reasons.length ? reasons : ["supported_rules_passed"],
  };
}
export function evaluationSnapshot(
  e: NormalizedTripEvidence,
  h: Historical,
  event: ConfirmedEventContext | null,
  confirmationAt: string,
): S["EvaluationSnapshot"] {
  return {
    factRevisionId: e.factRevisionId,
    qualificationAssignmentId: h.status === "resolved" ? h.assignmentId : null,
    levelId: h.status === "resolved" ? h.levelId : null,
    ruleVersionId: h.status === "resolved" ? h.ruleVersionId : null,
    catalogRevisionId: e.catalogRevisionId,
    eventId: event?.eventId ?? null,
    attendanceRevisionId: event?.attendanceRevisionId ?? null,
    attributionAt: h.attributionAt,
    attributionBasis:
      h.attributionBasis === "unresolved"
        ? "unknown"
        : e.start.basis === "staff-resolution"
          ? "staff_resolution"
          : h.attributionBasis,
    reportingAt: e.provider === "manual" ? confirmationAt : e.end.verifiedActual ? e.end.utc : null,
  };
}
