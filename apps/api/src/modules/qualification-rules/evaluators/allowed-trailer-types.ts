import type { NormalizedTripEvidence } from "../../sources/contracts/evidence.js";
import {
  type AllowedTrailerTypesRule,
  type EvaluationContext,
  REASON_CODES,
  type RuleEvaluationDetail,
  type RuleEvaluator,
} from "../contracts.js";

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Validates whether the given value strictly conforms to the AllowedTrailerTypesRule schema.
 */
export function validateAllowedTrailerTypesConfig(
  config: unknown,
): config is AllowedTrailerTypesRule {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return false;
  }
  const keys = Object.keys(config);
  if (keys.length !== 2) {
    return false;
  }
  const record = config as Record<string, unknown>;
  if (record.type !== "allowed_trailer_types") {
    return false;
  }
  if (!Array.isArray(record.entityIds)) {
    return false;
  }
  for (const id of record.entityIds) {
    if (typeof id !== "string" || !UUID_V4_REGEX.test(id)) {
      return false;
    }
  }
  return true;
}

export const allowedTrailerTypesEvaluator: RuleEvaluator<AllowedTrailerTypesRule> = {
  type: "allowed_trailer_types",
  validateConfig(config: unknown): config is AllowedTrailerTypesRule {
    return validateAllowedTrailerTypesConfig(config);
  },
  evaluate(
    rule: AllowedTrailerTypesRule,
    evidence: NormalizedTripEvidence,
    _context: EvaluationContext,
  ): RuleEvaluationDetail {
    const trailers = evidence.trailers;
    const observedIds: (string | null)[] = [];
    const disallowedIds: string[] = [];
    let hasUnknown = false;

    for (const item of trailers.items) {
      if (item.status === "known") {
        observedIds.push(item.value.entityId);
        if (!rule.entityIds.includes(item.value.entityId)) {
          disallowedIds.push(item.value.entityId);
        }
      } else {
        observedIds.push(null);
        hasUnknown = true;
      }
    }

    // 1. Proven violation: any trailer known to be disallowed causes failure
    if (disallowedIds.length > 0) {
      return {
        ruleType: "allowed_trailer_types",
        outcome: "fail",
        observed: observedIds,
        expected: rule.entityIds,
        reasonCode: REASON_CODES.RULE_TRAILER_TYPE_DISALLOWED,
        reasonDetails: {
          disallowedEntityIds: disallowedIds,
        },
      };
    }

    // 2. Incomplete trailer chain cannot satisfy allowlist check
    if (!trailers.complete) {
      return {
        ruleType: "allowed_trailer_types",
        outcome: "unknown",
        observed: observedIds,
        expected: rule.entityIds,
        reasonCode: REASON_CODES.RULE_TRAILERS_INCOMPLETE,
      };
    }

    // 3. Unknown trailer in chain leaves outcome unknown without proving violation
    if (hasUnknown) {
      return {
        ruleType: "allowed_trailer_types",
        outcome: "unknown",
        observed: observedIds,
        expected: rule.entityIds,
        reasonCode: REASON_CODES.RULE_TRAILER_TYPE_UNKNOWN,
      };
    }

    // 4. All trailers known, permitted, and chain complete
    return {
      ruleType: "allowed_trailer_types",
      outcome: "pass",
      observed: observedIds,
      expected: rule.entityIds,
      reasonCode: REASON_CODES.RULE_PASSED,
    };
  },
};
