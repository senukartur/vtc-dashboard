// Pure presentation helpers for the qualification levels table. They only summarize server data;
// qualification decisions and limits stay on the server.
import type { DTO } from "./transport.js";

type Level = DTO["QualificationLevel"];

export function sortLevels(levels: readonly Level[]): Level[] {
  return [...levels].sort((a, b) => a.position - b.position);
}

/** The row selected when nothing (or a level no longer listed) is selected. */
export function defaultLevelId(levels: readonly Level[]): string | null {
  return sortLevels(levels)[0]?.id ?? null;
}

/** Levels without an effective published rule version; the server applies no default values. */
export function unconfiguredCount(levels: readonly Level[]): number {
  return levels.filter((level) => !level.ruleVersionId).length;
}

export type ThresholdSummary =
  | { kind: "terminal" }
  | { kind: "value"; trips: number | null; distanceM: string | null };

export function thresholdSummary(level: Level): ThresholdSummary {
  if (level.terminal) return { kind: "terminal" };
  return { kind: "value", trips: level.requiredTrips, distanceM: level.requiredDistanceM };
}
