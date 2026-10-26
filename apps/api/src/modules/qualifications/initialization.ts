import type { components } from "@vtc/contracts";
import { newId, type TxContext, type UnitOfWork } from "@vtc/db";
import {
  and,
  eq,
  inArray,
  initialQualifications,
  qualificationAssignments,
  qualificationStates,
} from "@vtc/db/qualifications-schema";
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
