import { and, desc, eq, getTableName, isNull, lt, or, sql } from "drizzle-orm";
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

interface AuditPage {
  companyId: string;
  limit: number;
  after: { id: string; time: string | null } | null;
}

const auditListFields = {
  id: auditEntries.id,
  actorId: auditEntries.actorId,
  action: auditEntries.operation,
  subjectId: auditEntries.subjectId,
  occurredAt: auditEntries.occurredAt,
};

function auditPagePredicate(input: AuditPage, action?: string) {
  applicationId(input.companyId);
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 101)
    throw new Error("AUDIT_QUERY_BOUND_EXCEEDED");
  if (input.after) {
    applicationId(input.after.id);
    utcDateTime(input.after.time as string);
  }
  return and(
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
    action === undefined
      ? undefined
      : sql`cast(${auditEntries.operation} as binary) = cast(${action} as binary)`,
  );
}

type ReadableDetails = {
  [Record in AuditDetailRecord as Record["operation"]]: {
    action: Record["operation"];
    objectType: Record["subjectKind"];
    details: Record["details"];
  };
}[AuditDetailRecord["operation"]];

function readableDetails(
  action: AuditCodes["operation"],
  objectType: AuditCodes["subjectKind"],
  raw: unknown,
) {
  if (raw !== null) {
    try {
      // The allowlist checks the action, subject and both snapshots together.
      return {
        action,
        objectType,
        details: safeAuditDetails(action, objectType, raw),
      } as ReadableDetails;
    } catch {
      // An unsupported or malformed historical snapshot must not hide its audit row.
    }
  }
  return { action, objectType, details: null };
}

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
    async list(tx: TxContext, input: AuditPage) {
      return unitOfWork
        .client(tx)
        .select(auditListFields)
        .from(auditEntries)
        .where(auditPagePredicate(input))
        .orderBy(desc(auditEntries.occurredAt), desc(auditEntries.id))
        .limit(input.limit);
    },
    // Same authorization requirement as list. Keep legacy reads independent of the details column.
    async listStage3(tx: TxContext, input: AuditPage & { action?: string }) {
      if (input.action !== undefined && (input.action.length < 1 || [...input.action].length > 48))
        throw new Error("AUDIT_QUERY_BOUND_EXCEEDED");
      const rows = await unitOfWork
        .client(tx)
        .select({
          ...auditListFields,
          objectType: auditEntries.subjectKind,
          details: auditEntries.details,
        })
        .from(auditEntries)
        .where(auditPagePredicate(input, input.action))
        .orderBy(desc(auditEntries.occurredAt), desc(auditEntries.id))
        .limit(input.limit);
      return rows.map(({ action, objectType, details, ...row }) => ({
        ...row,
        ...readableDetails(action, objectType, details),
      }));
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
