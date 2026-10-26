import type { components } from "@vtc/contracts";
import { newId, type TxContext, type UnitOfWork } from "@vtc/db";
import {
  and,
  eq,
  inArray,
  initialQualifications,
  qualificationAssignments,
  qualificationStates,
  qualificationLevels,
  qualificationRules,
  lte,
  desc,
  isNull,
} from "@vtc/db/qualifications-schema";
import { type Actor, identityError } from "../identity/service.js";
import { createAssignmentWriter } from "./assignment-writer.js";
export type Game = "ets2" | "ats";
export const structuralLevels = {
  ets2: [
    "02800000-0000-4000-8000-000000000001",
    "02800000-0000-4000-8000-000000000002",
    "02800000-0000-4000-8000-000000000003",
    "02800000-0000-4000-8000-000000000004",
  ],
  ats: [
    "02800000-0000-4000-8000-000000000005",
    "02800000-0000-4000-8000-000000000006",
    "02800000-0000-4000-8000-000000000007",
    "02800000-0000-4000-8000-000000000008",
  ],
} as const;
export function createQualificationInitialization(unit: UnitOfWork) {
  return {
    async administrationLevels(tx: TxContext) {
      const rows = await unit
        .client(tx)
        .select({
          id: qualificationLevels.id,
          game: qualificationLevels.game,
          code: qualificationLevels.code,
          name: qualificationLevels.name,
        })
        .from(qualificationLevels)
        .orderBy(qualificationLevels.game, qualificationLevels.id)
        .limit(9)
        .for("share");
      if (rows.length !== 8) throw identityError(503);
      return rows;
    },
    async administrationProjection(tx: TxContext, ids: string[]) {
      if (ids.length > 100) throw new Error("QUALIFICATION_PROJECTION_BOUND_EXCEEDED");
      if (!ids.length) return new Map<string, components["schemas"]["Assignment"][]>();
      const rows = await unit
        .client(tx)
        .select({
          userId: qualificationAssignments.userId,
          id: qualificationAssignments.id,
          game: qualificationAssignments.game,
          levelId: qualificationAssignments.levelId,
          assignedAt: qualificationAssignments.assignedAt,
        })
        .from(qualificationStates)
        .innerJoin(
          qualificationAssignments,
          eq(qualificationStates.assignmentId, qualificationAssignments.id),
        )
        .where(inArray(qualificationStates.userId, ids))
        .orderBy(qualificationStates.userId, qualificationStates.game)
        .for("share");
      return new Map(
        ids.map((id) => [
          id,
          rows
            .filter((row) => row.userId === id)
            .map(({ userId: _userId, ...row }) => ({ ...row, periodId: row.id })),
        ]),
      );
    },
    async administrationReadiness(tx: TxContext, instant: string) {
      const levels = await unit
        .client(tx)
        .select()
        .from(qualificationLevels)
        .orderBy(qualificationLevels.id)
        .limit(9)
        .for("share");
      if (levels.length !== 8) return false;
      for (const level of levels) {
        const [rule] = await unit
          .client(tx)
          .select()
          .from(qualificationRules)
          .where(
            and(
              eq(qualificationRules.levelId, level.id),
              lte(qualificationRules.effectiveAt, instant),
            ),
          )
          .orderBy(desc(qualificationRules.effectiveAt))
          .limit(1)
          .for("share");
        if (
          !rule ||
          (level.code !== "driver_i" &&
            (rule.requiredTrips === null || rule.requiredDistanceM === null))
        )
          return false;
      }
      return true;
    },
    async reinstate(
      tx: TxContext,
      actor: Actor,
      userId: string,
      assignments: readonly components["schemas"]["AssignmentInput"][],
      assignedAt: string,
    ) {
      if (
        !assignments.length ||
        assignments.length > 2 ||
        new Set(assignments.map((row) => row.game)).size !== assignments.length
      )
        throw identityError(422);
      const c = unit.client(tx);
      for (const input of [...assignments].sort((a, b) => a.game.localeCompare(b.game))) {
        if (
          !["ats", "ets2"].includes(input.game) ||
          input.purpose !== "reinstatement" ||
          input.assignedAt !== undefined ||
          input.endedAt !== undefined ||
          !input.reason.trim() ||
          input.reason.length > 2048
        )
          throw identityError(422);
        const [level] = await c
          .select()
          .from(qualificationLevels)
          .where(eq(qualificationLevels.id, input.levelId))
          .for("share");
        if (!level || level.game !== input.game) throw identityError(422);
        const [open] = await c
          .select({ id: qualificationAssignments.id })
          .from(qualificationAssignments)
          .where(
            and(
              eq(qualificationAssignments.userId, userId),
              eq(qualificationAssignments.game, input.game),
              isNull(qualificationAssignments.endedAt),
            ),
          )
          .limit(1)
          .for("update");
        if (open) throw identityError(409);
        await createAssignmentWriter(unit, undefined, () => assignedAt)(tx, actor, {
          userId,
          game: input.game,
          levelId: input.levelId,
          purpose: "reinstatement",
          assignedAt,
          endedAt: null,
          reason: input.reason,
        });
      }
    },
    async initialize(
      tx: TxContext,
      input: { userId: string; games: readonly Game[]; assignedAt: string },
    ) {
      if (
        !input.games.length ||
        new Set(input.games).size !== input.games.length ||
        input.games.some((game) => !["ets2", "ats"].includes(game))
      )
        throw new Error("INVALID_INITIAL_GAMES");
      for (const game of [...input.games].sort()) {
        const id = newId();
        await unit.client(tx).insert(initialQualifications).values({
          id,
          userId: input.userId,
          game,
          level: "trainee",
          assignedAt: input.assignedAt,
        });
        await unit.client(tx).insert(qualificationAssignments).values({
          id,
          userId: input.userId,
          game,
          levelId: structuralLevels[game][0],
          assignedAt: input.assignedAt,
          purpose: "initial",
          actorId: null,
          reason: "Admission initial assignment",
        });
        await unit
          .client(tx)
          .insert(qualificationStates)
          .values({ userId: input.userId, game, assignmentId: id, version: 1 });
      }
    },
    async close(tx: TxContext, userId: string, endedAt: string) {
      for (const game of ["ats", "ets2"] as const) {
        const [state] = await unit
          .client(tx)
          .select()
          .from(qualificationStates)
          .where(and(eq(qualificationStates.userId, userId), eq(qualificationStates.game, game)))
          .for("update");
        if (!state?.assignmentId) continue;
        const [assignment] = await unit
          .client(tx)
          .select()
          .from(qualificationAssignments)
          .where(eq(qualificationAssignments.id, state.assignmentId))
          .for("update");
        if (!assignment || assignment.assignedAt > endedAt)
          throw new Error("QUALIFICATION_INTERVAL_INVALID");
        await unit
          .client(tx)
          .update(qualificationAssignments)
          .set({ endedAt })
          .where(eq(qualificationAssignments.id, state.assignmentId));
        await unit
          .client(tx)
          .update(qualificationStates)
          .set({ assignmentId: null, version: state.version + 1 })
          .where(and(eq(qualificationStates.userId, userId), eq(qualificationStates.game, game)));
      }
    },
    async currentAssignments(
      tx: TxContext,
      userId: string,
    ): Promise<components["schemas"]["Assignment"][]> {
      const states = await unit
        .client(tx)
        .select({ assignmentId: qualificationStates.assignmentId })
        .from(qualificationStates)
        .where(eq(qualificationStates.userId, userId))
        .for("share");
      const ids = states.map((s) => s.assignmentId).filter((id): id is string => id !== null);
      if (!ids.length) return [];
      const rows = await unit
        .client(tx)
        .select()
        .from(qualificationAssignments)
        .where(inArray(qualificationAssignments.id, ids))
        .for("share");
      return rows.map((row) => ({
        id: row.id,
        periodId: row.id,
        game: row.game,
        levelId: row.levelId,
        assignedAt: row.assignedAt,
      }));
    },
  };
}
