import type { NormalizedTripEvidence } from "../../sources/contracts/evidence.js";
import {
  type EvaluationContext,
  type MaxMassRule,
  REASON_CODES,
  type RuleEvaluationDetail,
  type RuleEvaluator,
} from "../contracts.js";
import { compareDecimal } from "../decimal.js";

const MAX_MASS_REGEX = /^(0|[1-9][0-9]*)(\.[0-9]*[1-9])?$/;

/**
 * Validates whether the given value strictly conforms to the MaxMassRule schema.
 * Rejects extra properties, invalid types, and non-canonical decimal representations.
 */
export function validateMaxMassConfig(config: unknown): config is MaxMassRule {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return false;
  }
  const keys = Object.keys(config);
  if (keys.length !== 2) {
    return false;
  }
  const record = config as Record<string, unknown>;
  if (record.type !== "max_mass") {
    return false;
  }
  if (
    typeof record.maxKg !== "string" ||
    record.maxKg.length === 0 ||
    record.maxKg.length > 64 ||
    !MAX_MASS_REGEX.test(record.maxKg)
  ) {
    return false;
  }
  return true;
}

export const maxMassEvaluator: RuleEvaluator<MaxMassRule> = {
  type: "max_mass",
  validateConfig(config: unknown): config is MaxMassRule {
    return validateMaxMassConfig(config);
  },
  evaluate(
    rule: MaxMassRule,
    evidence: NormalizedTripEvidence,
    _context: EvaluationContext,
  ): RuleEvaluationDetail {
    const fact = evidence.cargoMassKg;
    if (fact.status === "unknown") {
      return {
        ruleType: "max_mass",
        outcome: "unknown",
        observed: null,
        expected: rule.maxKg,
        reasonCode: REASON_CODES.RULE_MASS_UNKNOWN,
        reasonDetails: {
          sourceReasonCode: fact.reasonCode,
        },
      };
    }

    const observed = fact.value;
    const cmp = compareDecimal(observed, rule.maxKg);

    if (cmp <= 0) {
      return {
        ruleType: "max_mass",
        outcome: "pass",
        observed,
        expected: rule.maxKg,
        reasonCode: REASON_CODES.RULE_PASSED,
      };
    }

    return {
      ruleType: "max_mass",
      outcome: "fail",
      observed,
      expected: rule.maxKg,
      reasonCode: REASON_CODES.RULE_MASS_EXCEEDED,
    };
  },
};
