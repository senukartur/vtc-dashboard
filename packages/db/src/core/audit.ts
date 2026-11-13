import { and, desc, eq, getTableName, isNull, lt, or } from "drizzle-orm";
import { mysqlTable } from "drizzle-orm/mysql-core";
import {
  auditEntries,
  auditEntryColumns,
  auditOperations,
  auditReasons,
  auditSubjects,
} from "../schema/audit.js";
import {
  type AuditDetailRecord,
  type AuditDetails,
  auditObject,
  safeAuditDetails,
} from "./audit-details.js";
import type { TxContext, UnitOfWork } from "./unit-of-work.js";
import { applicationId, newId, utcDateTime, utcIso } from "./values.js";

interface AuditMetadata {
  actorKind: "user" | "system";
  actorId: string | null;
  subjectId: string;
  occurredAt: string;
  reason: (typeof auditReasons)[number];
  companyId?: string | null;
}

type AuditCodes = {
  operation: (typeof auditOperations)[number];
  subjectKind: (typeof auditSubjects)[number];
};

export type AuditInput = AuditMetadata & ((AuditCodes & { details?: never }) | AuditDetailRecord);

// Drizzle includes all table columns in INSERT. This projection keeps detail-free writes
// compatible with the published pre-Stage 3 schema and its migration-prefix tests.
const legacyAuditEntries = mysqlTable(getTableName(auditEntries), auditEntryColumns);

function safeInput(raw: AuditInput): AuditMetadata & AuditCodes & { details?: AuditDetails } {
  const allowed = [
    "actorKind",
    "actorId",
    "operation",
    "subjectKind",
    "subjectId",
    "occurredAt",
    "reason",
    "companyId",
    "details",
  ];
  const input = auditObject(raw, allowed) as Partial<AuditMetadata & AuditCodes> & {
    details?: unknown;
  };
  if (
    !input.operation ||
    !auditOperations.includes(input.operation) ||
    !input.reason ||
    !auditReasons.includes(input.reason) ||
    !input.subjectKind ||
    !auditSubjects.includes(input.subjectKind)
  ) {
    throw new Error("UNREGISTERED_AUDIT_CODE");
  }
  if (input.actorKind === "user") applicationId(input.actorId as string);
  else if (input.actorKind !== "system" || input.actorId !== null)
    throw new Error("INVALID_AUDIT_ACTOR");
  const subjectId = applicationId(input.subjectId as string);
  if (typeof input.occurredAt !== "string") throw new Error("INVALID_AUDIT_TIME");
  if (input.companyId != null) applicationId(input.companyId);
  return {
    actorKind: input.actorKind,
    actorId: input.actorId as string | null,
    operation: input.operation,
    subjectKind: input.subjectKind,
    subjectId,
    occurredAt: utcIso(utcDateTime(input.occurredAt)),
    reason: input.reason,
    companyId: input.companyId ?? null,
    ...(Object.hasOwn(input, "details") && {
      details: safeAuditDetails(input.operation, input.subjectKind, input.details),
    }),
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
      if (safe.details) await client.insert(auditEntries).values({ id, ...safe });
      else await client.insert(legacyAuditEntries).values({ id, ...safe });
      return id;
    },
  };
}
