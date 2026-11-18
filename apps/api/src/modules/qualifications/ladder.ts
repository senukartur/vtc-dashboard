import type { TxContext, UnitOfWork } from "@vtc/db";
import {
  and,
  eq,
  inArray,
  isNotNull,
  maxQualificationLevels,
  qualificationLevels,
  qualificationLevelTrailers,
  qualificationLevelTrailerTypes,
} from "@vtc/db/qualifications-schema";
import { decimal } from "../sources/contracts/canonical.js";
import type { AdrClass } from "../sources/contracts/evidence.js";
import type { QualificationConditions, QualificationLimits } from "./check.js";

export type Game = "ets2" | "ats";
export type LevelRow = typeof qualificationLevels.$inferSelect;
export type ActiveLevel = LevelRow & { position: number };

const exact = (value: string | null) => (value === null ? null : decimal(value));

/** Active levels ordered by game and position; positions are always 1..N per game. */
export async function activeLevels(
  unit: UnitOfWork,
  tx: TxContext,
  game?: Game,
  lock: "share" | "update" = "share",
): Promise<ActiveLevel[]> {
  const rows = await unit
    .client(tx)
    .select()
    .from(qualificationLevels)
    .where(
      and(
        isNotNull(qualificationLevels.position),
        game ? eq(qualificationLevels.game, game) : undefined,
      ),
    )
    .orderBy(qualificationLevels.game, qualificationLevels.position)
    .limit((game ? 1 : 2) * maxQualificationLevels + 1)
    .for(lock);
  if (rows.length > (game ? 1 : 2) * maxQualificationLevels)
    throw new Error("QUALIFICATION_LADDER_BOUND_EXCEEDED");
  const counters = new Map<string, number>();
  for (const row of rows) {
    const expected = (counters.get(row.game) ?? 0) + 1;
    if (row.position !== expected) throw new Error("INVALID_QUALIFICATION_LADDER");
    counters.set(row.game, expected);
  }
  return rows as ActiveLevel[];
}

/** Allowed trailer type IDs of each level, sorted. */
export async function levelTrailers(unit: UnitOfWork, tx: TxContext, levelIds: string[]) {
  const result = new Map<string, string[]>(levelIds.map((id) => [id, []]));
  if (!levelIds.length) return result;
  for (const table of [qualificationLevelTrailers, qualificationLevelTrailerTypes]) {
    const rows = await unit
      .client(tx)
      .select({
        levelId: table.levelId,
        trailerId: table.trailerId,
      })
      .from(table)
      .where(inArray(table.levelId, [...new Set(levelIds)]))
      .orderBy(table.levelId, table.trailerId)
      .for("share");
    for (const row of rows) result.get(row.levelId)?.push(row.trailerId);
  }
  return result;
}

export function limitsOf(row: LevelRow, trailerIds: readonly string[]): QualificationLimits {
  return {
    massMinKg: exact(row.massMinKg),
    massMaxKg: exact(row.massMaxKg),
    distanceMinM: exact(row.distanceMinM),
    distanceMaxM: exact(row.distanceMaxM),
    trailers: {
      ...(row.trailerBasis === "type" ? { basis: "type" as const } : {}),
      mode: row.trailerMode,
      typeIds: row.trailerMode === "selected" ? [...trailerIds].sort() : [],
    },
    adr: {
      mode: row.adrMode,
      classes: row.adrMode === "selected" ? ([...(row.adrClasses ?? [])].sort() as AdrClass[]) : [],
    },
    hardModeRequired: row.hardModeRequired,
  };
}

export function conditionsOf(row: LevelRow): QualificationConditions {
  return { requiredTrips: row.requiredTrips, requiredDistanceM: exact(row.requiredDistanceM) };
}

export function hasConditions(row: LevelRow) {
  return row.requiredTrips !== null || row.requiredDistanceM !== null;
}
