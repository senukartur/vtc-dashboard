import type { components } from "@vtc/contracts";
import {
  type ConfirmedEventContext,
  REASON_CODES,
  type Rule,
  type RuleEvaluationDetail,
} from "../qualification-rules/contracts.js";
import { compareDecimal } from "../qualification-rules/decimal.js";
import { defaultRegistry } from "../qualification-rules/registry.js";
import type { Qualifications } from "../qualifications/service.js";
import type { NormalizedTripEvidence } from "../sources/contracts/evidence.js";

type S = components["schemas"];
export type Historical = Awaited<ReturnType<Qualifications["lookupInTransaction"]>>;
// Only these qualification limits can be waived by an explicit staff override (policy 204).
export const OVER_LIMIT_CODES: ReadonlySet<string> = new Set([
  REASON_CODES.RULE_MASS_EXCEEDED,
  REASON_CODES.RULE_TRAILER_TYPE_DISALLOWED,
  REASON_CODES.RULE_ADR_CATEGORY_DISALLOWED,
]);
export const ACCEPTED_OVER_LIMITS = "accepted_over_limits";
const DECIMAL = /^(0|[1-9][0-9]*)(\.[0-9]*[1-9])?$/,
  UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  ADR_CLASS = /^[123468]$/;
const sorted = (values: readonly string[]) => [...new Set(values)].sort();
function evaluateRules(
  e: NormalizedTripEvidence,
  history: Extract<Historical, { status: "resolved" }>,
  event: ConfirmedEventContext | null,
) {
  return defaultRegistry.evaluate(e, history.rules, {
    qualificationAssignmentId: history.assignmentId,
    ruleVersionId: history.ruleVersionId,
    confirmedEvent: event,
  });
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
  let rules: ReturnType<typeof evaluateRules> | null = null;
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
    rules = evaluateRules(e, history, event);
    if (rules.outcome === "fail")
      violations.push(
        ...rules.ruleResults.filter((r) => r.outcome === "fail").map((r) => r.reasonCode),
      );
    if (rules.outcome === "unknown")
      missing.push(
        ...rules.ruleResults.filter((r) => r.outcome === "unknown").map((r) => r.reasonCode),
      );
  }
  return { missing, violations, rules };
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
function ruleCheck(
  r: RuleEvaluationDetail,
  rule: Rule | undefined,
  e: NormalizedTripEvidence,
): S["QualificationRuleCheck"] {
  const mass = r.ruleType === "max_mass",
    limit = mass && rule && "maxKg" in rule ? rule.maxKg : null,
    offending =
      r.outcome !== "fail"
        ? []
        : r.ruleType === "allowed_trailer_types"
          ? r.reasonDetails?.disallowedEntityIds
          : r.ruleType === "allowed_adr_categories"
            ? [r.observed]
            : [];
  return {
    ruleType: r.ruleType,
    outcome: r.outcome,
    reasonCode: r.reasonCode,
    bypassedByEvent: r.bypassedByEvent === true,
    // Unknown or malformed values stay null and are never shown as zero.
    observedMassKg:
      mass && e.cargoMassKg.status === "known" && DECIMAL.test(e.cargoMassKg.value)
        ? e.cargoMassKg.value
        : null,
    limitMassKg: typeof limit === "string" && DECIMAL.test(limit) ? limit : null,
    entityIds: sorted(
      (Array.isArray(offending) ? offending : []).filter(
        (id): id is string => typeof id === "string" && (UUID.test(id) || ADR_CLASS.test(id)),
      ),
    ).slice(0, 10),
  };
}
// Per-rule details of the same historical rules that classify() applies.
export function qualificationCheck(
  e: NormalizedTripEvidence,
  history: Historical,
  event: ConfirmedEventContext | null,
): S["QualificationCheck"] {
  if (history.status !== "resolved")
    return { status: "unresolved", reasonCode: history.reasonCode, rules: [] };
  const rules = evaluateRules(e, history, event);
  return {
    status: "resolved",
    reasonCode: null,
    rules: rules.ruleResults.map((r, i) => ruleCheck(r, history.rules[i], e)),
  };
}
export interface AcceptanceContext {
  hasTelemetrySource: boolean;
  eventInvalid: boolean;
  eventReviewRequired: boolean;
}
// How a different human reviewer may accept: ordinarily, only over qualification limits with
// explicit confirmation, or not at all. Over-limit acceptance requires a group without any
// telemetry source or event exception and with every other gate satisfied (policy 204).
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
  const { missing, violations, rules } = examine(e, history, event, true),
    results = rules?.ruleResults ?? [];
  // A proven failure hides unknown rules in classify(); every limit must still be known here.
  const gaps = [
      ...missing,
      ...results.filter((r) => r.outcome === "unknown").map((r) => r.reasonCode),
    ],
    exceeded = sorted(violations.filter((code) => OVER_LIMIT_CODES.has(code)));
  if (!violations.length && !gaps.length && !eventCodes.length)
    return { mode: "ordinary", exceeded: [], blockedReasonCodes: [] };
  const blockedReasonCodes = sorted([
    ...violations.filter((code) => !OVER_LIMIT_CODES.has(code)),
    ...gaps,
    ...eventCodes,
    ...(exceeded.length && context.hasTelemetrySource ? ["telemetry_source_present"] : []),
    ...(exceeded.length && results.some((r) => r.bypassedByEvent)
      ? ["event_exception_applied"]
      : []),
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
    ruleVersionId: h.status === "resolved" ? h.ruleVersionId : null,
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
