import { auditEntries, auditOperations, auditReasons, auditSubjects } from "../schema/audit.js";
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
    async append(tx: TxContext, input: AuditInput): Promise<string> {
      const client = unitOfWork.client(tx);
      const safe = safeInput(input);
      const id = newId();
      await client.insert(auditEntries).values({ id, ...safe });
      return id;
    },
  };
}
