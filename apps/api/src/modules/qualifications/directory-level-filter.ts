import { applicationId, type TxContext, type UnitOfWork } from "@vtc/db";
import {
  qualificationAssignments,
  qualificationLevels,
  qualificationStates,
} from "@vtc/db/qualifications-schema";
import { and, eq, inArray, isNotNull, type SQL, type SQLWrapper, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { identityError } from "../identity/service.js";

/**
 * Member directory level lookups (VTC-140, VTC-150). The directory accepts a level only when
 * listQualificationLevels returns it to the reader for that game, which today means an active
 * level of the game for any company.read reader. Any other ID is rejected with 422.
 *
 * The filter predicate matches members whose current qualification in the game is that level.
 * Former members have no current state and never match. createDirectoryCurrentLevels returns
 * each row's current level per game under the same rule. These two exports are the only
 * qualification reads the directory makes; a qualification model change (VTC-157) replaces both.
 */
export type DirectoryLevelFilter = (
  tx: TxContext,
  game: "ets2" | "ats",
  levelId: string,
  ownerRef: SQLWrapper,
) => Promise<SQL>;

export function createDirectoryLevelFilter(unit: UnitOfWork): DirectoryLevelFilter {
  return async (tx, game, levelId, ownerRef) => {
    let id: string;
    try {
      id = applicationId(levelId);
    } catch {
      throw identityError(422);
    }
    // listMembers locks the company FOR UPDATE and checks the actor, then this level row is read
    // FOR SHARE before the directory statement shares the member rows. Every path takes the
    // exclusive company lock first, which keeps this order deadlock-safe; a replacement (VTC-157)
    // must keep its reads behind that lock.
    const [level] = await unit
      .client(tx)
      .select({ id: qualificationLevels.id })
      .from(qualificationLevels)
      .where(
        and(
          eq(qualificationLevels.id, id),
          eq(qualificationLevels.game, game),
          isNotNull(qualificationLevels.activePosition),
        ),
      )
      .for("share");
    if (!level) throw identityError(422);
    const state = alias(qualificationStates, `directory_${game}_state`);
    const assignment = alias(qualificationAssignments, `directory_${game}_assignment`);
    // A raw template renders an alias by its name only, so name each base table explicitly.
    return sql`EXISTS (SELECT 1 FROM ${qualificationStates} ${state} JOIN ${qualificationAssignments} ${assignment} ON ${eq(assignment.id, state.assignmentId)} WHERE ${and(eq(state.userId, ownerRef), eq(state.game, game), eq(assignment.levelId, level.id))})`;
  };
}

export interface DirectoryLevel {
  id: string;
  name: string;
  position: number;
}
export interface DirectoryGameLevels {
  ets2: DirectoryLevel | null;
  ats: DirectoryLevel | null;
}
/** Current level per game for a bounded batch (<= 101) of member IDs; every requested ID is present. */
export type DirectoryCurrentLevels = (
  tx: TxContext,
  userIds: readonly string[],
) => Promise<Map<string, DirectoryGameLevels>>;

// At most one directory page (100 IDs; the lookahead row is never looked up). 101 leaves headroom.
const CURRENT_LEVEL_BATCH = 101;

export function createDirectoryCurrentLevels(unit: UnitOfWork): DirectoryCurrentLevels {
  return async (tx, userIds) => {
    if (userIds.length > CURRENT_LEVEL_BATCH) throw new Error("DIRECTORY_LEVEL_BOUND_EXCEEDED");
    const unique = [...new Set(userIds.map((id) => applicationId(id)))];
    const result = new Map<string, DirectoryGameLevels>(
      unique.map((id) => [id, { ets2: null, ats: null }]),
    );
    if (!unique.length) return result;
    // A plain read of the transaction snapshot after the directory statement: it takes no locks,
    // so it adds no lock edge, and it sees the same states the level filter's EXISTS read. A level
    // that left the active ladder is null, so an archived name never leaves the server.
    const rows = await unit
      .client(tx)
      .select({
        userId: qualificationStates.userId,
        game: qualificationStates.game,
        id: qualificationLevels.id,
        name: qualificationLevels.name,
        position: qualificationLevels.activePosition,
      })
      .from(qualificationStates)
      .innerJoin(
        qualificationAssignments,
        eq(qualificationAssignments.id, qualificationStates.assignmentId),
      )
      .innerJoin(
        qualificationLevels,
        and(
          eq(qualificationLevels.id, qualificationAssignments.levelId),
          eq(qualificationLevels.game, qualificationStates.game),
        ),
      )
      .where(
        and(
          inArray(qualificationStates.userId, unique),
          isNotNull(qualificationLevels.activePosition),
        ),
      );
    for (const row of rows) {
      const entry = result.get(row.userId);
      if (!entry || row.position === null) continue;
      entry[row.game] = { id: row.id, name: row.name, position: row.position };
    }
    return result;
  };
}
