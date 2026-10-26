import { auditEntries, auditOperations, auditReasons, auditSubjects } from "../schema/audit.js";
import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import type { TxContext, UnitOfWork } from "./unit-of-work.js";
import { applicationId, newId, utcDateTime, utcIso } from "./values.js";

export interface AuditInput {
  actorKind: "user" | "system";
  actorId: string | null;
  operation: (typeof auditOperations)[number];
  subjectKind: (typeof auditSubjects)[number];
  subjectId: string;
  occurredAt: string;
  reason: (typeof auditReasons)[number];
  companyId?: string | null;
}

function safeInput(raw: AuditInput): AuditInput {
  const allowed = [
    "actorKind",
    "actorId",
    "operation",
    "subjectKind",
    "subjectId",
    "occurredAt",
    "reason",
    "companyId",
  ];
  if (
    !raw ||
    typeof raw !== "object" ||
    (Object.getPrototypeOf(raw) !== Object.prototype && Object.getPrototypeOf(raw) !== null) ||
    Reflect.ownKeys(raw).some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(raw, key);
      return (
        typeof key !== "string" ||
        !allowed.includes(key) ||
        !descriptor?.enumerable ||
        !("value" in descriptor)
      );
    })
  ) {
    throw new Error("INVALID_AUDIT_SHAPE");
  }
  // Snapshot once after rejecting accessors, so validation and persistence use identical values.
  const input = { ...raw };
  if (
    !auditOperations.includes(input.operation) ||
    !auditReasons.includes(input.reason) ||
    !auditSubjects.includes(input.subjectKind)
  ) {
    throw new Error("UNREGISTERED_AUDIT_CODE");
  }
  if (input.actorKind === "user") applicationId(input.actorId as string);
  else if (input.actorKind !== "system" || input.actorId !== null)
    throw new Error("INVALID_AUDIT_ACTOR");
  applicationId(input.subjectId);
  if (typeof input.occurredAt !== "string") throw new Error("INVALID_AUDIT_TIME");
  if (input.companyId != null) applicationId(input.companyId);
  return {
    actorKind: input.actorKind,
    actorId: input.actorId,
    operation: input.operation,
    subjectKind: input.subjectKind,
    subjectId: input.subjectId,
    occurredAt: utcIso(utcDateTime(input.occurredAt)),
    reason: input.reason,
    companyId: input.companyId ?? null,
  };
}

export function createAudit(unitOfWork: UnitOfWork) {
  return {
    // The caller must authorize company administration on this same transaction first.
    async list(
      tx: TxContext,
      input: {
        companyId: string;
        limit: number;
        after: { id: string; time: string | null } | null;
      },
    ) {
      applicationId(input.companyId);
      if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 101)
        throw new Error("AUDIT_QUERY_BOUND_EXCEEDED");
      if (input.after) {
        applicationId(input.after.id);
        utcDateTime(input.after.time as string);
      }
      return unitOfWork
        .client(tx)
        .select({
          id: auditEntries.id,
          actorId: auditEntries.actorId,
          action: auditEntries.operation,
          subjectId: auditEntries.subjectId,
          occurredAt: auditEntries.occurredAt,
        })
        .from(auditEntries)
        .where(
          and(
            // This single-company product also retains old module entries without a company reference.
            or(eq(auditEntries.companyId, input.companyId), isNull(auditEntries.companyId)),
            input.after
              ? or(
                  lt(auditEntries.occurredAt, input.after.time as string),
                  and(
                    eq(auditEntries.occurredAt, input.after.time as string),
                    lt(auditEntries.id, input.after.id),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(desc(auditEntries.occurredAt), desc(auditEntries.id))
        .limit(input.limit);
    },
    async append(tx: TxContext, input: AuditInput): Promise<string> {
      const client = unitOfWork.client(tx);
      const safe = safeInput(input);
      const id = newId();
      await client.insert(auditEntries).values({ id, ...safe });
      return id;
    },
  };
}
