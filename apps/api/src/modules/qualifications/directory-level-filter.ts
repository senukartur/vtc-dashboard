import { applicationId, type TxContext, type UnitOfWork } from "@vtc/db";
import {
  qualificationAssignments,
  qualificationLevels,
  qualificationStates,
} from "@vtc/db/qualifications-schema";
import { and, eq, isNotNull, type SQL, type SQLWrapper, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { identityError } from "../identity/service.js";

/**
 * Member directory level filter (VTC-140). The directory accepts a level only when
 * listQualificationLevels returns it to the reader for that game, which today means an active
 * level of the game for any company.read reader. Any other ID is rejected with 422.
 *
 * The returned predicate matches members whose current qualification in the game is that level.
 * Former members have no current state and never match. This is the single lookup the directory
 * uses; a qualification model change (VTC-157) replaces only this implementation.
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
