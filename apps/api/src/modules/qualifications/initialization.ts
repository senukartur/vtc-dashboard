import type { components } from "@vtc/contracts";
import { newId, type TxContext, type UnitOfWork } from "@vtc/db";
import {
  and,
  eq,
  inArray,
  isNull,
  qualificationAssignments,
  qualificationLevels,
} from "@vtc/db/qualifications-schema";
import type { createOutbox } from "../../platform/outbox/events.js";
import { type Actor, identityError } from "../identity/service.js";
import { activeLevels, type Game, hasConditions } from "./ladder.js";
import { createAssignments } from "./promotion.js";

export type { Game } from "./ladder.js";
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
type AssignmentDto = components["schemas"]["Assignment"];
const dto = (row: {
  id: string;
  game: Game;
  levelId: string;
  assignedAt: string;
}): AssignmentDto => ({
  id: row.id,
  periodId: row.id,
  game: row.game,
  levelId: row.levelId,
  assignedAt: row.assignedAt,
});

/** Membership lifecycle seams: admission, deactivation, reinstatement and current levels. */
export function createQualificationInitialization(
  unit: UnitOfWork,
  outbox?: Pick<ReturnType<typeof createOutbox>, "append">,
) {
  const assignments = createAssignments(unit, {
    // Admission and reinstatement never close a previous first-level assignment.
    identity: {
      completeTraineeAsSystemInTransaction: () => {
        throw new Error("QUALIFICATION_LIFECYCLE_ROLE_CHANGE");
      },
    },
    ...(outbox ? { events: outbox } : {}),
  });
  async function open(tx: TxContext, userIds: string[]) {
    if (!userIds.length) return [];
    return unit
      .client(tx)
      .select()
      .from(qualificationAssignments)
      .where(
        and(
          inArray(qualificationAssignments.userId, userIds),
          isNull(qualificationAssignments.endedAt),
        ),
      )
      .orderBy(qualificationAssignments.userId, qualificationAssignments.game)
      .for("share");
  }
  return {
    async administrationLevels(tx: TxContext) {
      return (await activeLevels(unit, tx)).map(({ id, game, name, position }) => ({
        id,
        game,
        name,
        position,
      }));
    },
    async administrationProjection(tx: TxContext, ids: string[]) {
      if (ids.length > 100) throw new Error("QUALIFICATION_PROJECTION_BOUND_EXCEEDED");
      const rows = await open(tx, ids);
      return new Map(ids.map((id) => [id, rows.filter((row) => row.userId === id).map(dto)]));
    },
    // Ready when each game has a ladder and every non-top level has a promotion condition.
    async administrationReadiness(tx: TxContext, _instant?: string) {
      const levels = await activeLevels(unit, tx);
      for (const game of ["ets2", "ats"] as const) {
        const ladder = levels.filter((row) => row.game === game);
        if (!ladder.length || ladder.slice(0, -1).some((row) => !hasConditions(row))) return false;
      }
      return true;
    },
    async reinstate(
      tx: TxContext,
      actor: Actor,
      userId: string,
      input: readonly components["schemas"]["AssignmentInput"][],
      assignedAt: string,
      companyId?: string,
    ) {
      if (
        !input.length ||
        input.length > 2 ||
        new Set(input.map((row) => row.game)).size !== input.length
      )
        throw identityError(422);
      const c = unit.client(tx);
      for (const row of [...input].sort((a, b) => a.game.localeCompare(b.game))) {
        if (
          !["ats", "ets2"].includes(row.game) ||
          row.purpose !== "reinstatement" ||
          typeof row.reason !== "string" ||
          !row.reason.trim() ||
          row.reason.length > 2048
        )
          throw identityError(422);
        const [level] = await c
          .select()
          .from(qualificationLevels)
          .where(eq(qualificationLevels.id, row.levelId))
          .for("share");
        if (!level || level.game !== row.game || level.position === null) throw identityError(422);
        if (await assignments.openFor(tx, userId, row.game)) throw identityError(409);
        await assignments.assign(tx, {
          userId,
          game: row.game,
          levelId: row.levelId,
          kind: "reinstatement",
          actorId: actor.userId,
          comment: row.reason,
          companyId: companyId ?? null,
          at: assignedAt,
          previous: null,
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
        const [first] = await unit
          .client(tx)
          .select({ id: qualificationLevels.id })
          .from(qualificationLevels)
          .where(and(eq(qualificationLevels.game, game), eq(qualificationLevels.position, 1)))
          .for("share");
        if (!first) throw new Error("QUALIFICATION_INITIAL_LEVEL_MISSING");
        await unit.client(tx).insert(qualificationAssignments).values({
          id: newId(),
          userId: input.userId,
          game,
          levelId: first.id,
          assignedAt: input.assignedAt,
          kind: "admission",
          actorId: null,
          comment: null,
        });
      }
    },
    async close(tx: TxContext, userId: string, endedAt: string) {
      for (const game of ["ats", "ets2"] as const) {
        const current = await assignments.openFor(tx, userId, game);
        if (!current) continue;
        if (current.assignedAt > endedAt) throw new Error("QUALIFICATION_INTERVAL_INVALID");
        await unit
          .client(tx)
          .update(qualificationAssignments)
          .set({ endedAt })
          .where(eq(qualificationAssignments.id, current.id));
      }
    },
    async currentAssignments(tx: TxContext, userId: string): Promise<AssignmentDto[]> {
      return (await open(tx, [userId])).map(dto);
    },
  };
}
