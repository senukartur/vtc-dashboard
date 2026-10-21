import type { NormalizedTripEvidence } from "../sources/contracts/evidence.js";
import type { EvaluationContext, QualificationEvaluationResult, Rule } from "./contracts.js";
import { defaultRegistry } from "./registry.js";

export * from "./contracts.js";
export * from "./decimal.js";
export * from "./evaluators/max-mass.js";
export * from "./evaluators/allowed-trailer-types.js";
export * from "./evaluators/allowed-adr-categories.js";
export * from "./event-exception.js";
export * from "./company-acceptance.js";
export * from "./qualification-progress.js";
export * from "./registry.js";

/**
 * Convenient pure facade function to evaluate trip evidence against qualification rules
 * using the default rule evaluator registry.
 */
export function evaluateQualificationRules(
  evidence: NormalizedTripEvidence,
  rules: readonly Rule[],
  context: EvaluationContext = {},
): QualificationEvaluationResult {
  return defaultRegistry.evaluate(evidence, rules, context);
}
