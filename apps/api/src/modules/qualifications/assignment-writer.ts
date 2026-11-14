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
  trackEligibility = false,
) {
  return async (
    tx: TxContext,
    actor: Actor,
    input: Omit<Assignment, "id" | "actorId" | "revision">,
    options?: { companyId: string | null; instant: string },
  ) => {
    const c = unit.client(tx);
    let [current] = await c
      .select({
        assignmentId: qualificationStates.assignmentId,
        version: qualificationStates.version,
      })
      .from(qualificationStates)
      .where(
        and(eq(qualificationStates.userId, input.userId), eq(qualificationStates.game, input.game)),
      )
      .for("update");
    if (!current) {
      current = { assignmentId: null, version: 1 };
      await c
        .insert(qualificationStates)
        .values({ userId: input.userId, game: input.game, ...current });
    }
    let previous: Assignment | undefined;
    if (current.assignmentId && input.purpose !== "historical_resolution") {
      [previous] = await c
        .select()
        .from(qualificationAssignments)
        .where(eq(qualificationAssignments.id, current.assignmentId))
        .for("update");
      if (!previous || previous.assignedAt > input.assignedAt || input.purpose === "reinstatement")
        throw identityError(409);
      await c
        .update(qualificationAssignments)
        .set({ endedAt: input.assignedAt })
        .where(eq(qualificationAssignments.id, previous.id));
    }
    const row = { ...input, id: newId(), actorId: actor.userId, revision: 1 };
    await c.insert(qualificationAssignments).values(row);
    await c
      .update(qualificationStates)
      .set({
        ...(input.purpose === "historical_resolution"
          ? {}
          : {
              assignmentId: row.id,
              ...(trackEligibility ? { eligibleSince: null, eligibilityEvaluatedAt: null } : {}),
            }),
        version: current.version + 1,
      })
      .where(
        and(eq(qualificationStates.userId, input.userId), eq(qualificationStates.game, input.game)),
      );
    const instant = options?.instant ?? now();
    const audit = createAudit(unit);
    const entry = {
      actorKind: "user",
      actorId: actor.userId,
      reason: "operator_request",
      occurredAt: instant,
    } as const;
    const snapshot = (assignment: Assignment) => ({
      game: assignment.game,
      assignmentId: assignment.id,
      levelId: assignment.levelId,
    });
    await audit.append(tx, {
      ...entry,
      companyId: options?.companyId ?? null,
      operation:
        input.purpose === "promotion" ? "qualification.promoted" : "qualification.assigned",
      subjectKind: "qualification",
      subjectId: row.id,
      details: { before: previous ? snapshot(previous) : null, after: snapshot(row) },
    });
    const eventId = newId();
    await outbox.append(tx, {
      eventId,
      type: "qualification.assigned",
      schemaVersion: 1,
      aggregate: { kind: "qualification", id: row.id, version: current.version + 1 },
      occurredAt: instant,
      correlationId: eventId,
      causationId: null,
      data: { userId: input.userId, assignmentId: row.id },
    });
    return { row, version: current.version + 1 };
  };
}
