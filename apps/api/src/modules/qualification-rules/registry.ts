import type { NormalizedTripEvidence } from "../sources/contracts/evidence.js";
import {
  type EvaluationContext,
  type EvaluationOutcome,
  type QualificationEvaluationResult,
  REASON_CODES,
  type Rule,
  type RuleEvaluationDetail,
  type RuleEvaluator,
} from "./contracts.js";
import { allowedAdrCategoriesEvaluator } from "./evaluators/allowed-adr-categories.js";
import { allowedTrailerTypesEvaluator } from "./evaluators/allowed-trailer-types.js";
import { maxMassEvaluator } from "./evaluators/max-mass.js";
import { isBypassedQualificationRule, matchEventPrescribedLoad } from "./event-exception.js";

/**
 * Registry for declarative rule evaluators.
 * Guarantees safe configuration validation and strictly pure evaluation.
 * Prohibits arbitrary executable admin expressions (no eval or Function constructors).
 */
export class RuleEvaluatorRegistry {
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous evaluator registry
  private readonly evaluators = new Map<string, RuleEvaluator<any>>();

  /**
   * Registers a pure rule evaluator.
   */
  register<R extends Rule = Rule>(evaluator: RuleEvaluator<R>): void {
    if (!evaluator || typeof evaluator.type !== "string") {
      throw new Error("INVALID_EVALUATOR_REGISTRATION");
    }
    this.evaluators.set(evaluator.type, evaluator);
  }

  /**
   * Checks whether an evaluator for the specified rule type is registered.
   */
  has(type: string): boolean {
    return this.evaluators.has(type);
  }

  /**
   * Retrieves an evaluator by rule type.
   */
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous evaluator registry
  get(type: string): RuleEvaluator<any> | undefined {
    return this.evaluators.get(type);
  }

  /**
   * Validates a single rule configuration against registered evaluators.
   * Rejects malformed rules, unknown types, or invalid property schemas.
   *
   * @throws {Error} If configuration is malformed or rule type is unknown.
   */
  validateRule(rule: unknown): Rule {
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
      throw new Error("INVALID_RULE_OBJECT");
    }
    const record = rule as Record<string, unknown>;
    if (typeof record.type !== "string") {
      throw new Error("MISSING_RULE_TYPE");
    }

    const evaluator = this.evaluators.get(record.type);
    if (!evaluator) {
      throw new Error(`UNKNOWN_RULE_TYPE: ${record.type}`);
    }

    if (!evaluator.validateConfig(rule)) {
      throw new Error(`INVALID_RULE_CONFIG: ${record.type}`);
    }

    return rule as Rule;
  }

  /**
   * Validates an entire rule set array.
   *
   * @throws {Error} If rule set is not an array or any rule is invalid.
   */
  validateRuleSet(rules: unknown): Rule[] {
    if (!Array.isArray(rules)) {
      throw new Error("INVALID_RULE_SET");
    }
    return rules.map((r) => this.validateRule(r));
  }

  /**
   * Pure evaluation orchestrator.
   * Evaluates normalized trip evidence against a rule set within an evaluation context.
   * Applies three-valued logic (pass | fail | unknown) and event-prescribed load bypass.
   */
  evaluate(
    evidence: NormalizedTripEvidence,
    rules: readonly Rule[],
    context: EvaluationContext = {},
  ): QualificationEvaluationResult {
    const eventMatch = matchEventPrescribedLoad(evidence, context);
    const eventExceptionApplied = eventMatch.matches;

    const ruleResults: RuleEvaluationDetail[] = [];
    const reasonCodes: string[] = [];
    const bypassedRules: string[] = [];

    for (const rule of rules) {
      // Event-prescribed load bypass: confirmed attendance with matching load
      // bypasses max_mass, allowed_trailer_types, and allowed_adr_categories
      if (eventExceptionApplied && isBypassedQualificationRule(rule.type)) {
        bypassedRules.push(rule.type);
        ruleResults.push({
          ruleType: rule.type,
          outcome: "pass",
          observed: "bypassed_by_event",
          expected: rule,
          reasonCode: REASON_CODES.EVENT_PRESCRIBED_LOAD_BYPASS,
          bypassedByEvent: true,
        });
        reasonCodes.push(REASON_CODES.EVENT_PRESCRIBED_LOAD_BYPASS);
        continue;
      }

      const evaluator = this.evaluators.get(rule.type);
      if (!evaluator) {
        ruleResults.push({
          ruleType: rule.type,
          outcome: "fail",
          observed: null,
          expected: null,
          reasonCode: REASON_CODES.RULE_TYPE_UNKNOWN,
        });
        reasonCodes.push(REASON_CODES.RULE_TYPE_UNKNOWN);
        continue;
      }

      const result = evaluator.evaluate(rule, evidence, context);
      ruleResults.push(result);
      reasonCodes.push(result.reasonCode);
    }

    // Three-valued logic aggregation:
    // 1. Any proven failure -> fail
    // 2. Any unknown fact -> unknown
    // 3. Otherwise -> pass
    let outcome: EvaluationOutcome = "pass";
    if (ruleResults.some((r) => r.outcome === "fail")) {
      outcome = "fail";
    } else if (ruleResults.some((r) => r.outcome === "unknown")) {
      outcome = "unknown";
    }

    return {
      outcome,
      ruleResults,
      reasonCodes,
      eventExceptionApplied,
      bypassedRules,
    };
  }
}

/**
 * Creates a standard evaluator registry populated with initial MVP qualification rule evaluators.
 */
export function createDefaultRegistry(): RuleEvaluatorRegistry {
  const registry = new RuleEvaluatorRegistry();
  registry.register(maxMassEvaluator);
  registry.register(allowedTrailerTypesEvaluator);
  registry.register(allowedAdrCategoriesEvaluator);
  return registry;
}

export const defaultRegistry = createDefaultRegistry();
