import { index, mysqlEnum, mysqlTable, varchar } from "drizzle-orm/mysql-core";
import { idColumn, utcColumn } from "../core/values.js";

export const auditOperations = [
  "configuration.changed",
  "membership.changed",
  "report.reviewed",
  "leadership.transferred",
  "catalog.published",
  "application.submitted",
  "application.reviewed",
  "invitation.reissued",
  "invitation.copied",
  "invitation.redeemed",
  "steam.linked",
  "steam.replaced",
] as const;
export const auditReasons = [
  "operator_request",
  "staff_review",
  "initial_setup",
  "catalog_update",
] as const;
export const auditSubjects = [
  "company",
  "user",
  "trip",
  "catalog",
  "application",
  "invitation",
  "qualification",
  "event",
] as const;

export const auditEntries = mysqlTable(
  "audit_entries",
  {
    id: idColumn("id").primaryKey(),
    actorKind: mysqlEnum("actor_kind", ["user", "system"]).notNull(),
    actorId: idColumn("actor_id"),
    operation: varchar("operation", { length: 48, enum: auditOperations }).notNull(),
    subjectKind: mysqlEnum("subject_kind", auditSubjects).notNull(),
    subjectId: idColumn("subject_id").notNull(),
    occurredAt: utcColumn("occurred_at").notNull(),
    reason: varchar("reason", { length: 32, enum: auditReasons }).notNull(),
    companyId: idColumn("company_id"),
  },
  (table) => [
    index("audit_subject_time_idx").on(table.subjectKind, table.subjectId, table.occurredAt),
    index("audit_actor_time_idx").on(table.actorId, table.occurredAt),
  ],
);
