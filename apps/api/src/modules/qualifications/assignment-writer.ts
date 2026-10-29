import { createAudit, newId, type TxContext, type UnitOfWork } from "@vtc/db";
import {
  and,
  eq,
  qualificationAssignments,
  qualificationStates,
} from "@vtc/db/qualifications-schema";
import { createOutbox } from "../../platform/outbox/events.js";
import { type Actor, identityError } from "../identity/service.js";

type Assignment = typeof qualificationAssignments.$inferSelect;
// The lifecycle coordinator and ordinary qualification commands share one caller-owned write.
export function createAssignmentWriter(
  unit: UnitOfWork,
  outbox: Pick<ReturnType<typeof createOutbox>, "append"> = createOutbox(unit),
  now = () => new Date().toISOString(),
) {
  return async (
    tx: TxContext,
    actor: Actor,
    input: Omit<Assignment, "id" | "actorId" | "revision">,
  ) => {
    const c = unit.client(tx);
    let [current] = await c
      .select()
      .from(qualificationStates)
      .where(
        and(eq(qualificationStates.userId, input.userId), eq(qualificationStates.game, input.game)),
      )
      .for("update");
    if (!current) {
      current = { userId: input.userId, game: input.game, assignmentId: null, version: 1 };
      await c.insert(qualificationStates).values(current);
    }
    if (current.assignmentId && input.purpose !== "historical_resolution") {
      const [old] = await c
        .select()
        .from(qualificationAssignments)
        .where(eq(qualificationAssignments.id, current.assignmentId))
        .for("update");
      if (!old || old.assignedAt > input.assignedAt || input.purpose === "reinstatement")
        throw identityError(409);
      await c
        .update(qualificationAssignments)
        .set({ endedAt: input.assignedAt })
        .where(eq(qualificationAssignments.id, old.id));
    }
    const row = { ...input, id: newId(), actorId: actor.userId, revision: 1 };
    await c.insert(qualificationAssignments).values(row);
    await c
      .update(qualificationStates)
      .set({
        ...(input.purpose === "historical_resolution" ? {} : { assignmentId: row.id }),
        version: current.version + 1,
      })
      .where(
        and(eq(qualificationStates.userId, input.userId), eq(qualificationStates.game, input.game)),
      );
    await createAudit(unit).append(tx, {
      actorKind: "user",
      actorId: actor.userId,
      operation: "membership.changed",
      subjectKind: "user",
      subjectId: input.userId,
      reason: "operator_request",
      occurredAt: now(),
    });
    const eventId = newId();
    await outbox.append(tx, {
      eventId,
      type: "qualification.assigned",
      schemaVersion: 1,
      aggregate: { kind: "qualification", id: row.id, version: current.version + 1 },
      occurredAt: now(),
      correlationId: eventId,
      causationId: null,
      data: { userId: input.userId, assignmentId: row.id },
    });
    return { row, version: current.version + 1 };
  };
}
