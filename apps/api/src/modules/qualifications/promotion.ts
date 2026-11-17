import { createAudit, newId, type TxContext, type UnitOfWork } from "@vtc/db";
import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  qualificationAssignments,
  qualificationLevels,
} from "@vtc/db/qualifications-schema";
import { createOutbox } from "../../platform/outbox/events.js";
import type { Identity } from "../identity/service.js";
import type { ContributionRegister } from "../trips/contributions.js";
import { conditionsMet } from "./check.js";
import { type ActiveLevel, activeLevels, conditionsOf, type Game } from "./ladder.js";

export type Assignment = typeof qualificationAssignments.$inferSelect;
export type AssignmentKind = Assignment["kind"];

interface Ports {
  identity: Pick<Identity, "completeTraineeAsSystemInTransaction" | "traineeIdsInTransaction">;
  totals?: Pick<ContributionRegister, "totalsByAssignment">;
  events?: Pick<ReturnType<typeof createOutbox>, "append">;
}

/**
 * Assignment writes and automatic promotion. Callers hold the company lock and then the member
 * locks (company -> members -> assignments -> contributions), so promotion is serialized per
 * member; the unique open marker and predecessor indexes are the database backstop.
 */
export function createAssignments(
  unit: UnitOfWork,
  ports: Ports,
  now = () => new Date().toISOString(),
) {
  const c = (tx: TxContext) => unit.client(tx),
    audit = createAudit(unit),
    outbox = ports.events ?? createOutbox(unit);
  const snapshot = (row: Pick<Assignment, "game" | "id" | "levelId">) => ({
    game: row.game,
    assignmentId: row.id,
    levelId: row.levelId,
  });
  async function openFor(tx: TxContext, userId: string, game: Game) {
    const [row] = await c(tx)
      .select()
      .from(qualificationAssignments)
      .where(
        and(
          eq(qualificationAssignments.userId, userId),
          eq(qualificationAssignments.game, game),
          isNull(qualificationAssignments.endedAt),
        ),
      )
      .for("update");
    return row;
  }
  /** The game's current first level, which is the only level a trainee belongs on. */
  async function lowestLevel(tx: TxContext, game: Game) {
    const [row] = await c(tx)
      .select({ id: qualificationLevels.id })
      .from(qualificationLevels)
      .where(and(eq(qualificationLevels.game, game), isNotNull(qualificationLevels.position)))
      .orderBy(asc(qualificationLevels.position))
      .limit(1)
      .for("share");
    return row?.id ?? null;
  }
  /**
   * A ladder edit that makes another level first moves the former first level up under its
   * members: they leave the first level, so a held Trainee role becomes Driver. Only members on
   * that former first level are affected; a Trainee that staff set on another level stays.
   */
  async function completeFormerFirst(tx: TxContext, game: Game, formerFirst: string) {
    if ((await lowestLevel(tx, game)) === formerFirst) return;
    const rows = await c(tx)
      .select({ userId: qualificationAssignments.userId })
      .from(qualificationAssignments)
      .where(
        and(
          eq(qualificationAssignments.levelId, formerFirst),
          isNull(qualificationAssignments.endedAt),
        ),
      )
      .orderBy(asc(qualificationAssignments.userId))
      .for("share");
    for (let offset = 0; offset < rows.length; offset += 100)
      for (const userId of await ports.identity.traineeIdsInTransaction(
        tx,
        rows.slice(offset, offset + 100).map((row) => row.userId),
      ))
        await ports.identity.completeTraineeAsSystemInTransaction(tx, userId, null);
  }
  /**
   * Close the member's open assignment (if any) and open one on levelId. A promotion, manual
   * change or removal transfer that leaves the current first level completes a trainee; a
   * Trainee that staff set on a later level stays one. Writes the audit entry and the outbox
   * event in the caller transaction.
   */
  async function assign(
    tx: TxContext,
    input: {
      userId: string;
      game: Game;
      levelId: string;
      kind: AssignmentKind;
      actorId: string | null;
      comment: string | null;
      companyId: string | null;
      at?: string;
      previous?: Assignment | null;
    },
  ) {
    const at = input.at ?? now();
    const previous =
      input.previous === undefined ? await openFor(tx, input.userId, input.game) : input.previous;
    if (previous) {
      if (previous.assignedAt > at) throw new Error("QUALIFICATION_INTERVAL_INVALID");
      const [closed] = await c(tx)
        .update(qualificationAssignments)
        .set({ endedAt: at })
        .where(
          and(
            eq(qualificationAssignments.id, previous.id),
            isNull(qualificationAssignments.endedAt),
          ),
        );
      if (closed.affectedRows !== 1) throw new Error("QUALIFICATION_ASSIGNMENT_ALREADY_CLOSED");
    }
    const row = {
      id: newId(),
      userId: input.userId,
      game: input.game,
      levelId: input.levelId,
      assignedAt: at,
      endedAt: null,
      kind: input.kind,
      actorId: input.actorId,
      comment: input.comment,
      previousAssignmentId: previous?.id ?? null,
    };
    await c(tx).insert(qualificationAssignments).values(row);
    const leaving =
      (input.kind === "promotion" || input.kind === "manual" || input.kind === "level_removed") &&
      previous &&
      previous.levelId !== input.levelId &&
      previous.levelId === (await lowestLevel(tx, input.game));
    if (leaving)
      await ports.identity.completeTraineeAsSystemInTransaction(tx, input.userId, input.actorId);
    const promoted = input.kind === "promotion";
    await audit.append(tx, {
      actorKind: input.actorId ? "user" : "system",
      actorId: input.actorId,
      reason: input.actorId
        ? "operator_request"
        : promoted
          ? "automatic_promotion"
          : "initial_setup",
      occurredAt: at,
      companyId: input.companyId,
      operation: promoted ? "qualification.promoted" : "qualification.assigned",
      subjectKind: "qualification",
      subjectId: row.id,
      details: { before: previous ? snapshot(previous) : null, after: snapshot(row) },
    });
    const eventId = newId();
    await outbox.append(tx, {
      eventId,
      type: promoted ? "qualification.promoted" : "qualification.assigned",
      schemaVersion: 1,
      aggregate: { kind: "qualification", id: row.id, version: 1 },
      occurredAt: at,
      correlationId: eventId,
      causationId: null,
      data: { userId: input.userId, assignmentId: row.id },
    });
    return row;
  }
  /** Promote each open assignment whose credited totals meet its level's conditions, once. */
  async function promote(tx: TxContext, assignments: Assignment[], companyId: string | null) {
    if (!ports.totals) throw new Error("QUALIFICATION_TOTALS_UNAVAILABLE");
    const open = assignments.filter((row) => row.endedAt === null);
    if (!open.length) return 0;
    const ladders = new Map<Game, ActiveLevel[]>();
    for (const game of [...new Set(open.map((row) => row.game))])
      ladders.set(game, await activeLevels(unit, tx, game));
    let count = 0;
    for (let offset = 0; offset < open.length; offset += 100) {
      const batch = open.slice(offset, offset + 100);
      // A locking read: the transaction snapshot may predate the member fence.
      const found = await ports.totals.totalsByAssignment(
        tx,
        batch.map((row) => row.id),
        "share",
      );
      for (const row of batch) {
        const ladder = ladders.get(row.game) ?? [];
        const index = ladder.findIndex((level) => level.id === row.levelId);
        const level = ladder[index],
          next = ladder[index + 1];
        if (!level || !next) continue;
        const progress = found.get(row.id) ?? { completedTrips: 0, completedDistanceM: "0" };
        if (!conditionsMet(conditionsOf(level), progress)) continue;
        await assign(tx, {
          userId: row.userId,
          game: row.game,
          levelId: next.id,
          kind: "promotion",
          actorId: null,
          comment: null,
          companyId,
          previous: row,
        });
        count++;
      }
    }
    return count;
  }
  return {
    openFor,
    assign,
    /** After contribution changes: lock and promote the given open assignments. */
    async promoteInTransaction(tx: TxContext, ids: readonly string[], companyId: string | null) {
      const unique = [...new Set(ids)].sort();
      if (!unique.length) return 0;
      const rows: Assignment[] = [];
      for (const id of unique) {
        const [row] = await c(tx)
          .select()
          .from(qualificationAssignments)
          .where(and(eq(qualificationAssignments.id, id), isNull(qualificationAssignments.endedAt)))
          .for("update");
        if (row) rows.push(row);
      }
      return promote(tx, rows, companyId);
    },
    /**
     * After a ladder edit: lock every open assignment of the game, complete the trainees on
     * formerFirst (the first level before a create, move or removal) when it is no longer first,
     * then promote qualifying ones.
     */
    async recheckGameInTransaction(
      tx: TxContext,
      game: Game,
      companyId: string | null,
      formerFirst?: string,
    ) {
      const rows = await c(tx)
        .select()
        .from(qualificationAssignments)
        .where(
          and(eq(qualificationAssignments.game, game), isNull(qualificationAssignments.endedAt)),
        )
        .orderBy(asc(qualificationAssignments.userId))
        .for("update");
      if (formerFirst) await completeFormerFirst(tx, game, formerFirst);
      return promote(tx, rows, companyId);
    },
    /** Open assignments on the given levels, locked, ordered by member. */
    async openOnLevelsInTransaction(tx: TxContext, levelIds: string[]) {
      if (!levelIds.length) return [];
      return c(tx)
        .select()
        .from(qualificationAssignments)
        .where(
          and(
            inArray(qualificationAssignments.levelId, levelIds),
            isNull(qualificationAssignments.endedAt),
          ),
        )
        .orderBy(asc(qualificationAssignments.userId))
        .for("update");
    },
  };
}
export type Assignments = ReturnType<typeof createAssignments>;
