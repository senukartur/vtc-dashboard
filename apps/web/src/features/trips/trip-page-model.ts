import { type CheckState, checkSymbol } from "../review/review-model.js";
import type { DTO } from "./transport.js";

/** Pure view model of the author's trip page blocks added in Stage 4 (VTC-146). */
export type TripRuleCheck = DTO["TripStage4RuleCheck"];
export type TripRuleRow = {
  key: string;
  state: CheckState;
  symbol: string;
  /** Null for the single "check unavailable" row of unresolved history. */
  rule: TripRuleCheck | null;
};

/**
 * Rows of the author-safe qualification check: null when the server sends no check, one
 * unavailable row for unresolved history, otherwise one row per rule in server order. An event
 * bypass overrides the rule's own outcome.
 */
export function ruleRows(
  check: DTO["TripStage4QualificationCheck"] | null | undefined,
): TripRuleRow[] | null {
  if (!check) return null;
  if (check.status === "unresolved")
    return [
      { key: "unavailable", state: "unavailable", symbol: checkSymbol.unavailable, rule: null },
    ];
  return check.rules.map((rule, index) => {
    const state: CheckState = rule.bypassedByEvent ? "bypassed" : rule.outcome;
    return { key: `${index}-${rule.ruleType}`, state, symbol: checkSymbol[state], rule };
  });
}

/** Translation key ("trips" namespace) of a source's persisted outcome. */
export function sourceOutcomeKey(state: DTO["TripStage4Source"]["state"]) {
  return state === "open" ? "outcomeOpen" : state;
}

/** Configured trailer types beyond the server's truncated list. */
export function extraTrailerTypes(rule: {
  allowedTrailerTypes: readonly unknown[];
  allowedTrailerTypeCount: number;
}) {
  return Math.max(0, rule.allowedTrailerTypeCount - rule.allowedTrailerTypes.length);
}

/** Cargo damage of the effective fact; unknown stays null and is never shown as zero. */
export function damageValue(facts: DTO["EffectiveTripFacts"] | null | undefined): number | null {
  const value = facts?.cargoDamagePercent;
  return typeof value === "number" ? value : null;
}
