import { index, json, mysqlEnum, mysqlTable, varchar } from "drizzle-orm/mysql-core";
import type { AuditDetails } from "../core/audit-details.js";
import { idColumn, utcColumn } from "../core/values.js";

export const auditOperations = [
  "configuration.changed",
  "membership.changed",
  "report.reviewed",
  "leadership.transferred",
  "catalog.published",
  "catalog.imported",
  "catalog.changed",
  "application.submitted",
  "application.reviewed",
  "invitation.reissued",
  "invitation.copied",
  "invitation.redeemed",
  "steam.linked",
  "steam.replaced",
  "trip.reconciled",
  "manual.submitted",
  "manual.correction_requested",
  "report.accepted_over_limits",
  "roles.changed",
  "duplicate.dismissed",
  "duplicate.dismissal_undone",
  "qualification.assigned",
  "qualification.promoted",
  "qualification.level_changed",
  "qualification.rules_published",
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
  "duplicate_candidate",
  "qualification_level",
  "qualification_rule_version",
] as const;

export const auditEntryColumns = {
  id: idColumn("id").primaryKey(),
  actorKind: mysqlEnum("actor_kind", ["user", "system"]).notNull(),
  actorId: idColumn("actor_id"),
  operation: varchar("operation", { length: 48, enum: auditOperations }).notNull(),
  subjectKind: mysqlEnum("subject_kind", auditSubjects).notNull(),
  subjectId: idColumn("subject_id").notNull(),
  occurredAt: utcColumn("occurred_at").notNull(),
  reason: varchar("reason", { length: 32, enum: auditReasons }).notNull(),
  companyId: idColumn("company_id"),
};

export const auditEntries = mysqlTable(
  "audit_entries",
  { ...auditEntryColumns, details: json("details").$type<AuditDetails>() },
  (table) => [
    index("audit_subject_time_idx").on(table.subjectKind, table.subjectId, table.occurredAt),
    index("audit_actor_time_idx").on(table.actorId, table.occurredAt),
  ],
);
