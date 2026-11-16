import type { components } from "@vtc/contracts";
import type { ConfirmedEventContext } from "../events/contracts.js";
import {
  checkTrip,
  QUALIFICATION_REASONS,
  QUALIFICATION_UNKNOWN,
  type QualificationSnapshot,
  type TripCheck,
} from "../qualifications/check.js";
import type { Qualifications } from "../qualifications/service.js";
import { compareDecimal } from "../sources/contracts/decimal.js";
import type { NormalizedTripEvidence } from "../sources/contracts/evidence.js";

type S = components["schemas"];
export type Historical = Awaited<ReturnType<Qualifications["lookupInTransaction"]>>;
// Only the five level limits can be waived by an explicit staff override (policy 204).
export const OVER_LIMIT_CODES: ReadonlySet<string> = new Set(Object.values(QUALIFICATION_REASONS));
export const ACCEPTED_OVER_LIMITS = "accepted_over_limits";
const sorted = (values: readonly string[]) => [...new Set(values)].sort();
// A confirmed company event trip is credited without the level limits (VTC-157).
function check(
  e: NormalizedTripEvidence,
  history: Historical,
  event: ConfirmedEventContext | null,
): TripCheck | null {
  return history.status === "resolved" && !event ? checkTrip(history.limits, e) : null;
}
// Knowledge and qualification gates of a non-open trip; callers handle open trips first.
function examine(
  e: NormalizedTripEvidence,
  history: Historical,
  event: ConfirmedEventContext | null,
  human: boolean,
) {
  const missing: string[] = [],
    violations: string[] = [];
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
  const result = check(e, history, event);
  if (history.status !== "resolved") missing.push(history.reasonCode);
  else if (result) {
    violations.push(
      ...result.rules.filter((r) => r.result === "fail").map((r) => QUALIFICATION_REASONS[r.rule]),
    );
    // A proven failure outranks unknown rules; unknown alone goes to staff review.
    if (result.outcome === "unknown") missing.push(QUALIFICATION_UNKNOWN);
  }
  return { missing, violations, result };
}
// Lifecycle and knowledge gates precede pure qualification checks. Missing evidence is never proof of violation.
export function classify(
  e: NormalizedTripEvidence,
  history: Historical,
  event: ConfirmedEventContext | null,
  workflow: readonly string[] = [],
  human = false,
  manualReviewRequired = false,
) {
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
  const { missing, violations } = examine(e, history, event, human);
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
/** The check stored with a decision and shown for a pending trip. */
export function qualificationSnapshot(
  e: NormalizedTripEvidence,
  history: Historical,
  event: ConfirmedEventContext | null,
): QualificationSnapshot {
  if (history.status !== "resolved")
    return {
      levelId: null,
      levelName: null,
      editVersion: null,
      limits: null,
      eventExempt: false,
      outcome: null,
      reasonCode: history.reasonCode,
      rules: [],
    };
  const result = check(e, history, event);
  return {
    levelId: history.levelId,
    levelName: history.levelName,
    editVersion: history.editVersion,
    limits: history.limits,
    eventExempt: result === null,
    outcome: result?.outcome ?? null,
    reasonCode: null,
    rules: result?.rules ?? [],
  };
}
export interface AcceptanceContext {
  hasTelemetrySource: boolean;
  eventInvalid: boolean;
  eventReviewRequired: boolean;
}
// How a different human reviewer may accept: ordinarily, only over qualification limits with
// explicit confirmation, or not at all. Over-limit acceptance requires a group without any
// telemetry source and with every other gate satisfied (policy 204).
export function acceptance(
  e: NormalizedTripEvidence,
  history: Historical,
  event: ConfirmedEventContext | null,
  context: AcceptanceContext,
): { mode: S["ReviewAcceptance"]["mode"]; exceeded: string[]; blockedReasonCodes: string[] } {
  const eventCodes =
    context.eventInvalid || context.eventReviewRequired ? ["event_requires_review"] : [];
  if (e.outcome === "open")
    return {
      mode: "unavailable",
      exceeded: [],
      blockedReasonCodes: sorted(["trip_open", ...eventCodes]),
    };
  const { missing, violations, result } = examine(e, history, event, true);
  // A proven failure hides unknown rules in classify(); every limit must still be known here.
  const gaps = [
      ...missing,
      ...(result?.rules.some((r) => r.result === "unknown") ? [QUALIFICATION_UNKNOWN] : []),
    ],
    exceeded = sorted(violations.filter((code) => OVER_LIMIT_CODES.has(code)));
  if (!violations.length && !gaps.length && !eventCodes.length)
    return { mode: "ordinary", exceeded: [], blockedReasonCodes: [] };
  const blockedReasonCodes = sorted([
    ...violations.filter((code) => !OVER_LIMIT_CODES.has(code)),
    ...gaps,
    ...eventCodes,
    ...(exceeded.length && context.hasTelemetrySource ? ["telemetry_source_present"] : []),
  ]);
  return {
    mode: exceeded.length && !blockedReasonCodes.length ? "over_limits" : "unavailable",
    exceeded,
    blockedReasonCodes,
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
