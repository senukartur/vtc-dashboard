import type { NormalizedTripEvidence } from "../../sources/contracts/evidence.js";
import {
  type AllowedAdrCategoriesRule,
  type EvaluationContext,
  REASON_CODES,
  type RuleEvaluationDetail,
  type RuleEvaluator,
} from "../contracts.js";

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Validates whether the given value strictly conforms to the AllowedAdrCategoriesRule schema.
 */
export function validateAllowedAdrCategoriesConfig(
  config: unknown,
): config is AllowedAdrCategoriesRule {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return false;
  }
  const keys = Object.keys(config);
  if (keys.length !== 2) {
    return false;
  }
  const record = config as Record<string, unknown>;
  if (record.type !== "allowed_adr_categories") {
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

export const allowedAdrCategoriesEvaluator: RuleEvaluator<AllowedAdrCategoriesRule> = {
  type: "allowed_adr_categories",
  validateConfig(config: unknown): config is AllowedAdrCategoriesRule {
    return validateAllowedAdrCategoriesConfig(config);
  },
  evaluate(
    rule: AllowedAdrCategoriesRule,
    evidence: NormalizedTripEvidence,
    _context: EvaluationContext,
  ): RuleEvaluationDetail {
    const fact = evidence.adrCategory;

    // 1. Cargo has a resolved pinned ADR category
    if (fact.status === "known") {
      const observed = fact.value.entityId;
      if (rule.entityIds.includes(observed)) {
        return {
          ruleType: "allowed_adr_categories",
          outcome: "pass",
          observed,
          expected: rule.entityIds,
          reasonCode: REASON_CODES.RULE_PASSED,
        };
      }
      return {
        ruleType: "allowed_adr_categories",
        outcome: "fail",
        observed,
        expected: rule.entityIds,
        reasonCode: REASON_CODES.RULE_ADR_CATEGORY_DISALLOWED,
      };
    }

    // 2. Cargo is confirmed non-hazardous (contract code "cargo_not_adr")
    if (fact.reasonCode === "cargo_not_adr") {
      return {
        ruleType: "allowed_adr_categories",
        outcome: "pass",
        observed: "non_adr",
        expected: rule.entityIds,
        reasonCode: REASON_CODES.RULE_PASSED,
      };
    }

    // 3. ADR category is genuinely unknown without proving violation
    return {
      ruleType: "allowed_adr_categories",
      outcome: "unknown",
      observed: null,
      expected: rule.entityIds,
      reasonCode: REASON_CODES.RULE_ADR_CATEGORY_UNKNOWN,
      reasonDetails: {
        sourceReasonCode: fact.reasonCode,
      },
    };
  },
};
