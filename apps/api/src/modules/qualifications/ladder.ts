import type { components } from "@vtc/contracts";
import { applicationId, createAudit, newId, type TxContext, type UnitOfWork } from "@vtc/db";
import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  maxQualificationLevels,
  notInArray,
  or,
  qualificationAssignments,
  qualificationLadderHistory,
  qualificationLevels,
  qualificationStates,
  sql,
} from "@vtc/db/qualifications-schema";
import { type Actor, type Identity, identityError } from "../identity/service.js";
import type { createAssignmentWriter } from "./assignment-writer.js";
import type { Game } from "./initialization.js";

type S = components["schemas"];
export type ActiveLevel = typeof qualificationLevels.$inferSelect & { activePosition: number };
type Level = typeof qualificationLevels.$inferSelect;
type Change =
  | { type: "add"; input: S["QualificationLadderAddInput"] }
  | { type: "reorder"; input: S["QualificationLadderOrderInput"] }
  | { type: "archive"; levelId: string; input: S["QualificationLadderArchiveInput"] };

function revision(rows: ActiveLevel[]) {
  const value = rows[0]?.ladderRevision;
  if (
    !value ||
    rows.some((row, index) => row.activePosition !== index + 1 || row.ladderRevision !== value)
  )
    throw new Error("INVALID_QUALIFICATION_LADDER");
  return value;
}

export function ladderReason(value: string | undefined) {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (!trimmed || [...trimmed].length > 2048) throw identityError(422);
  return trimmed;
}

export async function activeLevels(unit: UnitOfWork, tx: TxContext, game?: Game) {
  const rows = await unit
    .client(tx)
    .select()
    .from(qualificationLevels)
    .where(
      and(
        isNotNull(qualificationLevels.activePosition),
        game ? eq(qualificationLevels.game, game) : undefined,
      ),
    )
    .orderBy(qualificationLevels.game, qualificationLevels.activePosition)
    .limit((game ? 1 : 2) * maxQualificationLevels + 1)
    .for("share");
  const active = rows as ActiveLevel[];
  for (const selected of game ? [game] : ["ets2", "ats"]) {
    const ladder = active.filter((row) => row.game === selected);
    if (ladder.length > maxQualificationLevels)
      throw new Error("QUALIFICATION_LADDER_BOUND_EXCEEDED");
    revision(ladder);
  }
  return active;
}

function snapshot(row: Level, formerPosition?: number) {
  const position = row.activePosition ?? formerPosition;
  if (position === undefined) throw new Error("QUALIFICATION_LEVEL_POSITION_MISSING");
  return {
    game: row.game,
    levelId: row.id,
    position,
    active: row.activePosition !== null,
    version: row.version,
  };
}

export function createLadder(
  unit: UnitOfWork,
  ports: {
    identity: Pick<
      Identity,
      "transaction" | "qualificationContextInTransaction" | "externalCommand"
    >;
    assignment: ReturnType<typeof createAssignmentWriter>;
    emit: (tx: TxContext, id: string, version: number, instant: string) => Promise<void>;
  },
  enabled: boolean,
  now: () => string,
) {
  const audit = createAudit(unit);
  const c = (tx: TxContext) => unit.client(tx);
  async function auditLevel(
    tx: TxContext,
    actor: Actor,
    companyId: string,
    before: Level | null,
    after: Level,
    instant: string,
    reason: string | null = null,
  ) {
    const id = await audit.append(tx, {
      actorKind: "user",
      actorId: actor.userId,
      companyId,
      operation: "qualification.level_changed",
      subjectKind: "qualification_level",
      subjectId: after.id,
      occurredAt: instant,
      reason: "operator_request",
      details: {
        before: before ? snapshot(before) : null,
        after: snapshot(after, before?.activePosition ?? undefined),
      },
    });
    if (reason !== null)
      await c(tx).insert(qualificationLadderHistory).values({ auditId: id, reason });
  }

  async function nextLevelInTransaction(tx: TxContext, current: { id: string; game: Game }) {
    const [source] = await c(tx)
      .select({ position: qualificationLevels.activePosition })
      .from(qualificationLevels)
      .where(
        and(
          eq(qualificationLevels.id, applicationId(current.id)),
          eq(qualificationLevels.game, current.game),
        ),
      )
      .for("share");
    if (source?.position == null) return null;
    const [target] = await c(tx)
      .select({ id: qualificationLevels.id, name: qualificationLevels.name })
      .from(qualificationLevels)
      .where(
        and(
          eq(qualificationLevels.game, current.game),
          eq(qualificationLevels.activePosition, source.position + 1),
        ),
      )
      .for("share");
    return target ?? null;
  }

  async function currentMembers(tx: TxContext, game: Game, levelId: string, lock = false) {
    const query = c(tx)
      .select({ userId: qualificationStates.userId })
      .from(qualificationStates)
      .innerJoin(
        qualificationAssignments,
        eq(qualificationAssignments.id, qualificationStates.assignmentId),
      )
      .where(
        and(
          eq(qualificationStates.game, game),
          eq(qualificationAssignments.game, game),
          eq(qualificationAssignments.levelId, levelId),
          isNull(qualificationAssignments.endedAt),
        ),
      )
      .orderBy(asc(qualificationStates.userId));
    return lock ? query.for("update") : query;
  }

  async function counts(tx: TxContext, game: Game, ids: string[]) {
    const rows = await c(tx)
      .select({
        levelId: qualificationAssignments.levelId,
        count: sql<number>`COUNT(*)`.mapWith(Number),
      })
      .from(qualificationStates)
      .innerJoin(
        qualificationAssignments,
        eq(qualificationAssignments.id, qualificationStates.assignmentId),
      )
      .where(
        and(
          eq(qualificationStates.game, game),
          eq(qualificationAssignments.game, game),
          inArray(qualificationAssignments.levelId, ids),
          isNull(qualificationAssignments.endedAt),
        ),
      )
      .groupBy(qualificationAssignments.levelId);
    return new Map(rows.map((row) => [row.levelId, row.count]));
  }

  return {
    auditLevel,
    counts,
    nextLevelInTransaction,
    revision,
    async change(actor: Actor, game: Game, key: string, expected: number, change: Change) {
      const reason = ladderReason(change.input.reason);
      return ports.identity.transaction(async (tx) => {
        const { companyId } = await ports.identity.qualificationContextInTransaction(tx, [], actor);
        if (!enabled) throw identityError(503);
        const result = await ports.identity.externalCommand(
          tx,
          `${actor.userId}:qualification:ladder:${game}:${change.type}`,
          key,
          { expected, change },
          async () => {
            const before = await activeLevels(unit, tx, game);
            if (expected !== revision(before)) throw identityError(409, "VERSION_CONFLICT");
            const nextRevision = expected + 1;
            const byId = new Map(before.map((row) => [row.id, row]));
            let proposed = [...before];
            let archived: ActiveLevel | undefined;
            let transferTarget: ActiveLevel | undefined;
            let affectedMembers: { userId: string }[] = [];
            if (change.type === "add") {
              if (before.length >= maxQualificationLevels) throw identityError(409);
              const { position, name } = change.input;
              if (
                !Number.isInteger(position) ||
                position < 1 ||
                position > before.length + 1 ||
                !name.trim() ||
                [...name.trim()].length > 128
              )
                throw identityError(422);
              proposed.splice(position - 1, 0, {
                id: newId(),
                game,
                code: null,
                name: name.trim(),
                version: 1,
                activePosition: position,
                ladderRevision: nextRevision,
                promotionGeneration: 1,
              });
            } else if (change.type === "reorder") {
              if (
                change.input.levelIds.length !== before.length ||
                new Set(change.input.levelIds).size !== before.length
              )
                throw identityError(422);
              proposed = change.input.levelIds.map((id) => {
                const row = byId.get(id);
                if (!row) throw identityError(422);
                return row;
              });
              if (proposed.every((row, index) => row.id === before[index]?.id))
                return { version: expected, data: { game, revision: expected } };
            } else {
              archived = byId.get(change.levelId);
              transferTarget = byId.get(change.input.targetLevelId);
              if (!archived) throw identityError(404);
              if (before.length === 1) throw identityError(409);
              if (
                !transferTarget ||
                transferTarget.id === archived.id ||
                !Number.isSafeInteger(change.input.observedDriverCount) ||
                change.input.observedDriverCount < 0
              )
                throw identityError(422);
              affectedMembers = await currentMembers(tx, game, archived.id);
              if (affectedMembers.length !== change.input.observedDriverCount)
                throw identityError(409, "VERSION_CONFLICT");
              const { members } = await ports.identity.qualificationContextInTransaction(
                tx,
                affectedMembers.map((row) => row.userId),
                actor,
              );
              if (affectedMembers.some((row) => members.get(row.userId)?.status !== "active"))
                throw identityError(409);
              const locked = await currentMembers(tx, game, archived.id, true);
              if (
                locked.length !== change.input.observedDriverCount ||
                locked.some((row, index) => row.userId !== affectedMembers[index]?.userId)
              )
                throw identityError(409, "VERSION_CONFLICT");
              proposed = before.filter((row) => row.id !== archived?.id);
            }
            const instant = now();
            // Clear the unique positions inside this fenced transaction before assigning final positions.
            await c(tx)
              .update(qualificationLevels)
              .set({ activePosition: null })
              .where(
                and(
                  eq(qualificationLevels.game, game),
                  isNotNull(qualificationLevels.activePosition),
                ),
              );
            const oldTopId = before.at(-1)?.id;
            const newTopId = proposed.at(-1)?.id;
            const changedSuccessors: string[] = [];
            let commandReason = reason;
            if (archived) {
              const row = {
                ...archived,
                activePosition: null,
                ladderRevision: nextRevision,
                version: archived.version + 1,
              };
              await c(tx)
                .update(qualificationLevels)
                .set({ ladderRevision: nextRevision, version: row.version })
                .where(eq(qualificationLevels.id, row.id));
              await auditLevel(tx, actor, companyId, archived, row, instant, commandReason);
              await ports.emit(tx, row.id, row.version, instant);
              commandReason = null;
            }
            for (const [index, row] of proposed.entries()) {
              const previous = byId.get(row.id);
              const successorChanged =
                previous && before[previous.activePosition]?.id !== proposed[index + 1]?.id;
              const terminalChanged = previous && (row.id === oldTopId) !== (row.id === newTopId);
              const changed =
                !previous ||
                previous.activePosition !== index + 1 ||
                terminalChanged ||
                successorChanged;
              const next = {
                activePosition: index + 1,
                ladderRevision: nextRevision,
                version: row.version + (previous && changed ? 1 : 0),
                promotionGeneration:
                  row.promotionGeneration + (row.id === oldTopId && row.id !== newTopId ? 1 : 0),
              };
              const updated = { ...row, ...next };
              if (previous)
                await c(tx)
                  .update(qualificationLevels)
                  .set(next)
                  .where(eq(qualificationLevels.id, row.id));
              else await c(tx).insert(qualificationLevels).values(updated);
              if (changed) {
                const rationale = change.type === "add" && previous ? null : commandReason;
                await auditLevel(
                  tx,
                  actor,
                  companyId,
                  previous ?? null,
                  updated,
                  instant,
                  rationale,
                );
                if (rationale !== null) commandReason = null;
                await ports.emit(tx, row.id, next.version, instant);
              }
              if (successorChanged) changedSuccessors.push(row.id);
            }
            // Every game command version is invalidated, including a reorder followed by its reversal.
            // The B2 eligibility writer also resets the observation checkpoint for changed successors.
            const assignmentIds = (levelIds: string[]) =>
              c(tx)
                .select({ id: qualificationAssignments.id })
                .from(qualificationAssignments)
                .where(
                  and(
                    eq(qualificationAssignments.game, game),
                    isNull(qualificationAssignments.endedAt),
                    inArray(qualificationAssignments.levelId, levelIds),
                  ),
                );
            if (changedSuccessors.length) {
              await c(tx)
                .update(qualificationStates)
                .set({ eligibleSince: null })
                .where(
                  and(
                    eq(qualificationStates.game, game),
                    inArray(qualificationStates.assignmentId, assignmentIds(changedSuccessors)),
                  ),
                )
                .orderBy(asc(qualificationStates.userId));
            }
            await c(tx)
              .update(qualificationStates)
              .set({ version: sql`${qualificationStates.version} + 1` })
              .where(
                and(
                  eq(qualificationStates.game, game),
                  archived
                    ? or(
                        isNull(qualificationStates.assignmentId),
                        notInArray(qualificationStates.assignmentId, assignmentIds([archived.id])),
                      )
                    : undefined,
                ),
              )
              .orderBy(asc(qualificationStates.userId));
            if (archived && transferTarget) {
              for (const { userId } of affectedMembers) {
                await ports.assignment(
                  tx,
                  actor,
                  {
                    userId,
                    game,
                    levelId: transferTarget.id,
                    purpose: "ladder_archive_transfer",
                    assignedAt: instant,
                    endedAt: null,
                    reason: "Qualification ladder archive transfer",
                  },
                  { companyId, instant },
                );
              }
            }
            return { data: { game, revision: nextRevision }, version: nextRevision };
          },
        );
        return result as { data: S["QualificationLadderRevision"]; version: number };
      });
    },
  };
}
