// Pure presentation helpers for the qualification levels table. They only summarize server data;
// qualification decisions and limits stay on the server.
import { type DTO, levelOrder } from "./transport.js";

type Level = DTO["QualificationLevel"];

/** Levels in fixed progression order (Trainee → Driver I); unknown codes keep their place last. */
export function sortLevels(levels: readonly Level[]): Level[] {
  const rank = (level: Level) => {
    const index = levelOrder.indexOf(level.code);
    return index < 0 ? levelOrder.length : index;
  };
  return [...levels].sort((a, b) => rank(a) - rank(b));
}

/** The row selected when nothing (or a level no longer listed) is selected. */
export function defaultLevelId(levels: readonly Level[]): string | null {
  return sortLevels(levels)[0]?.id ?? null;
}

/** Levels without an effective published rule version; the server applies no default values. */
export function unconfiguredCount(levels: readonly Level[]): number {
  return levels.filter((level) => !level.ruleVersionId).length;
}

export type AllowlistSummary =
  | { kind: "none" }
  | { kind: "empty" }
  | { kind: "count"; count: number };
export type RuleSummary = {
  mass: { kind: "none" } | { kind: "value"; maxKg: string };
  trailers: AllowlistSummary;
  adr: AllowlistSummary;
};

/**
 * Summarizes one effective rule version. An omitted restriction is "none" (no restriction), which
 * differs from an enabled empty allowlist ("empty": nothing listed is permitted). Unregistered
 * rule types are ignored rather than guessed.
 */
export function ruleSummary(rules: readonly DTO["Rule"][]): RuleSummary {
  const summary: RuleSummary = {
    mass: { kind: "none" },
    trailers: { kind: "none" },
    adr: { kind: "none" },
  };
  const allowlist = (ids: readonly string[]): AllowlistSummary =>
    ids.length ? { kind: "count", count: ids.length } : { kind: "empty" };
  for (const rule of rules) {
    if (rule.type === "max_mass") summary.mass = { kind: "value", maxKg: rule.maxKg };
    else if (rule.type === "allowed_trailer_types") summary.trailers = allowlist(rule.entityIds);
    else if (rule.type === "allowed_adr_categories") summary.adr = allowlist(rule.entityIds);
  }
  return summary;
}

export type ThresholdSummary =
  | { kind: "terminal" }
  | { kind: "value"; trips: number | null; distanceM: string | null };

/** Promotion threshold of a level; Driver I is terminal. Null parts stay unset, never zero. */
export function thresholdSummary(level: Level): ThresholdSummary {
  if (level.code === "driver_i") return { kind: "terminal" };
  return { kind: "value", trips: level.requiredTrips, distanceM: level.requiredDistanceM };
}
