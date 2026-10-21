import type { NormalizedTripEvidence } from "../sources/contracts/evidence.js";

export type EvaluationOutcome = "pass" | "fail" | "unknown";

export type BaseRuleType = "max_mass" | "allowed_trailer_types" | "allowed_adr_categories";

export interface MaxMassRule {
  readonly type: "max_mass";
  readonly maxKg: string;
}

export interface AllowedTrailerTypesRule {
  readonly type: "allowed_trailer_types";
  readonly entityIds: readonly string[];
}

export interface AllowedAdrCategoriesRule {
  readonly type: "allowed_adr_categories";
  readonly entityIds: readonly string[];
}

export interface CustomRule {
  readonly type: string;
  readonly [key: string]: unknown;
}

export type Rule = MaxMassRule | AllowedTrailerTypesRule | AllowedAdrCategoriesRule | CustomRule;

export interface ConfirmedEventContext {
  readonly eventId: string;
  readonly eventRevisionId: string;
  readonly attendanceRevisionId: string;
  readonly attendanceStatus?: "confirmed" | "declined" | "unconfirmed";
  readonly prescribedCargoId: string | null;
  readonly prescribedMassKg: string | null;
  readonly prescribedTrailerTypeId: string | null;
}

export interface EvaluationContext {
  readonly qualificationAssignmentId?: string | null;
  readonly ruleVersionId?: string | null;
  readonly attributionBasis?: "actual_start" | "manual_confirmation" | "staff_resolution";
  readonly confirmedEvent?: ConfirmedEventContext | null;
}

export interface RuleEvaluationDetail {
  readonly ruleType: string;
  readonly outcome: EvaluationOutcome;
  readonly observed: unknown;
  readonly expected: unknown;
  readonly reasonCode: string;
  readonly bypassedByEvent?: boolean;
  readonly reasonDetails?: Record<string, unknown>;
}

export interface QualificationEvaluationResult {
  readonly outcome: EvaluationOutcome;
  readonly ruleResults: readonly RuleEvaluationDetail[];
  readonly reasonCodes: readonly string[];
  readonly eventExceptionApplied: boolean;
  readonly bypassedRules: readonly string[];
}

export interface RuleEvaluator<R extends Rule = Rule> {
  readonly type: string;
  validateConfig(config: unknown): config is R;
  evaluate(
    rule: R,
    evidence: NormalizedTripEvidence,
    context: EvaluationContext,
  ): RuleEvaluationDetail;
}

export interface EventPrescribedLoadMatchResult {
  readonly matches: boolean;
  readonly reasonCode: string;
  readonly details?: {
    readonly attendanceConfirmed: boolean;
    readonly cargoMatch: boolean;
    readonly massMatch: boolean;
    readonly trailerMatch: boolean;
    readonly prescribedCargo: boolean;
    readonly prescribedMass: boolean;
    readonly prescribedTrailer: boolean;
  };
}

export interface CompanyAcceptanceResult {
  readonly outcome: EvaluationOutcome;
  readonly reasonCodes: readonly string[];
  readonly details: {
    readonly outcomeDelivered: boolean;
    readonly recordingComplete: boolean;
    readonly distanceSupported: boolean;
    readonly screenshotAttached: boolean;
  };
}

export interface QualificationProgressCondition {
  readonly requiredTrips: number | null;
  readonly requiredDistanceM: string | null;
}

export interface QualificationProgressTotals {
  readonly completedTrips: number;
  readonly completedDistanceM: string;
}

export interface QualificationProgressResult {
  readonly eligibleForPromotion: boolean;
  readonly tripsSatisfied: boolean;
  readonly distanceSatisfied: boolean;
  readonly currentTrips: number;
  readonly requiredTrips: number | null;
  readonly currentDistanceM: string;
  readonly requiredDistanceM: string | null;
  readonly remainingTrips: number | null;
  readonly remainingDistanceM: string | null;
}

export const REASON_CODES = {
  // Qualification evaluation outcomes
  RULE_PASSED: "rule_passed",
  RULE_MASS_EXCEEDED: "rule_mass_exceeded",
  RULE_MASS_UNKNOWN: "rule_mass_unknown",
  RULE_MASS_INVALID: "rule_mass_invalid",
  RULE_TRAILER_TYPE_DISALLOWED: "rule_trailer_type_disallowed",
  RULE_TRAILER_TYPE_UNKNOWN: "rule_trailer_type_unknown",
  RULE_TRAILERS_INCOMPLETE: "rule_trailers_incomplete",
  RULE_ADR_CATEGORY_DISALLOWED: "rule_adr_category_disallowed",
  RULE_ADR_CATEGORY_UNKNOWN: "rule_adr_category_unknown",
  RULE_TYPE_UNKNOWN: "unknown_rule_type",

  // Event-specific prescribed load exception
  EVENT_PRESCRIBED_LOAD_BYPASS: "event_prescribed_load_bypass",
  EVENT_PRESCRIBED_LOAD_MISMATCH: "event_prescribed_load_mismatch",
  EVENT_NO_PRESCRIBED_LOAD: "event_no_prescribed_load",
  EVENT_ATTENDANCE_UNCONFIRMED: "event_attendance_unconfirmed",
  EVENT_NOT_CONFIRMED: "event_not_confirmed",

  // Company trip acceptance
  COMPANY_ACCEPTANCE_PASSED: "company_acceptance_passed",
  COMPANY_ACCEPTANCE_OUTCOME_NOT_DELIVERED: "company_acceptance_outcome_not_delivered",
  COMPANY_ACCEPTANCE_RECORDING_INCOMPLETE: "company_acceptance_recording_incomplete",
  COMPANY_ACCEPTANCE_DISTANCE_NOT_SUPPORTED: "company_acceptance_distance_not_supported",
  COMPANY_ACCEPTANCE_SCREENSHOT_MISSING: "company_acceptance_screenshot_missing",
  COMPANY_ACCEPTANCE_PROVIDER_UNSUPPORTED: "provider_unsupported",

  // Qualification progress
  PROGRESS_CRITERIA_SATISFIED: "progress_criteria_satisfied",
  PROGRESS_CRITERIA_INCOMPLETE: "progress_criteria_incomplete",
} as const;

export type ReasonCode = (typeof REASON_CODES)[keyof typeof REASON_CODES];
