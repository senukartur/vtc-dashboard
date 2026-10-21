import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  int,
  json,
  type MySqlTableExtraConfigValue,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { idColumn, opaqueColumn, utcColumn } from "../../core/values.js";
import { membership } from "../identity/index.js";
import { sourceMessages, trips } from "../trips/index.js";

export { and, asc, desc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
export const manualEvidence = mysqlTable(
  "manual_evidence",
  {
    id: idColumn("id").primaryKey(),
    ownerId: idColumn("owner_id")
      .notNull()
      .references(() => membership.userId, { onDelete: "restrict" }),
    state: mysqlEnum("state", ["processing", "ready", "rejected", "deleting", "expired"]).notNull(),
    generation: idColumn("generation").notNull(),
    originalName: varchar("original_name", { length: 256 }).notNull(),
    contentType: varchar("content_type", { length: 128 }).notNull(),
    byteLength: int("byte_length", { unsigned: true }).notNull().default(0),
    sha256: opaqueColumn("sha256", { length: 32 }),
    fingerprint: opaqueColumn("fingerprint", { length: 32 }),
    leaseToken: idColumn("lease_token"),
    leaseUntil: utcColumn("lease_until"),
    deletionJobId: idColumn("deletion_job_id"),
    deleteAttempt: int("delete_attempt", { unsigned: true }).notNull().default(0),
    createdAt: utcColumn("created_at").notNull(),
    updatedAt: utcColumn("updated_at").notNull(),
    expiredAt: utcColumn("expired_at"),
    nextCheckAt: utcColumn("next_check_at").notNull(),
  },
  (t) => [
    index("manual_evidence_recovery").on(t.state, t.leaseUntil, t.id),
    index("manual_evidence_orphans").on(t.state, t.updatedAt, t.id),
    index("manual_evidence_retention_scan").on(t.state, t.nextCheckAt, t.id),
    uniqueIndex("manual_evidence_generation").on(t.id, t.generation),
    check(
      "manual_evidence_ready_shape",
      sql`${t.state} NOT IN ('ready','deleting','expired') OR (${t.sha256} IS NOT NULL AND ${t.fingerprint} IS NOT NULL AND ${t.byteLength} > 0)`,
    ),
  ],
);
// Every candidate generation is recorded before filesystem I/O. Missing/deleted
// paths remain scheduled because a previously issued syscall can complete late.
export const manualBlobGenerations = mysqlTable(
  "manual_blob_generations",
  {
    evidenceId: idColumn("evidence_id")
      .notNull()
      .references(() => manualEvidence.id, { onDelete: "restrict" }),
    generation: idColumn("generation").notNull(),
    state: mysqlEnum("state", ["tracked", "deleting"]).notNull().default("tracked"),
    createdAt: utcColumn("created_at").notNull(),
    leaseUntil: utcColumn("lease_until").notNull(),
    nextCheckAt: utcColumn("next_check_at").notNull(),
    deleteAttempt: int("delete_attempt", { unsigned: true }).notNull().default(0),
    deletionJobId: idColumn("deletion_job_id"),
    updatedAt: utcColumn("updated_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.evidenceId, t.generation] }),
    index("manual_generation_due").on(t.state, t.nextCheckAt, t.evidenceId, t.generation),
  ],
);
export const manualReports = mysqlTable(
  "manual_reports",
  {
    id: idColumn("id").primaryKey(),
    ownerId: idColumn("owner_id")
      .notNull()
      .references(() => membership.userId, { onDelete: "restrict" }),
    tripId: idColumn("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "restrict" }),
    version: int("version", { unsigned: true }).notNull(),
    currentRevisionId: idColumn("current_revision_id"),
    revisionNumber: int("revision_number", { unsigned: true }).notNull(),
    createdAt: utcColumn("created_at").notNull(),
  },
  (t): MySqlTableExtraConfigValue[] => [
    uniqueIndex("manual_report_trip_identity").on(t.id, t.tripId),
    foreignKey({
      name: "manual_report_current_revision_fk",
      columns: [t.id, t.currentRevisionId],
      foreignColumns: [manualRevisions.reportId, manualRevisions.id],
    }).onDelete("restrict"),
    index("manual_report_owner_page").on(t.ownerId, t.createdAt, t.id),
    index("manual_report_trip_page").on(t.tripId, t.createdAt, t.id),
    check("manual_report_version", sql`${t.version} > 0 AND ${t.revisionNumber} > 0`),
  ],
);
export const manualRevisions = mysqlTable(
  "manual_revisions",
  {
    id: idColumn("id").primaryKey(),
    reportId: idColumn("report_id")
      .notNull()
      .references(() => manualReports.id, { onDelete: "restrict" }),
    number: int("number", { unsigned: true }).notNull(),
    format: mysqlEnum("format", ["legacy", "extended"]).notNull(),
    fields: json("fields").$type<unknown>().notNull(),
    sourceRecordId: idColumn("source_record_id").references(() => sourceMessages.id, {
      onDelete: "restrict",
    }),
    submittedAt: utcColumn("submitted_at").notNull(),
  },
  (t) => [
    uniqueIndex("manual_revision_number").on(t.reportId, t.number),
    uniqueIndex("manual_revision_report_id").on(t.reportId, t.id),
    index("manual_revision_page").on(t.reportId, t.submittedAt, t.id),
  ],
);
export const manualEvidenceReferences = mysqlTable(
  "manual_evidence_refs",
  {
    evidenceId: idColumn("evidence_id")
      .notNull()
      .references(() => manualEvidence.id, { onDelete: "restrict" }),
    revisionId: idColumn("revision_id")
      .notNull()
      .references(() => manualRevisions.id, { onDelete: "restrict" }),
    reportId: idColumn("report_id").notNull(),
    tripId: idColumn("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "restrict" }),
  },
  (t) => [
    primaryKey({ columns: [t.evidenceId, t.revisionId] }),
    index("manual_refs_trip").on(t.tripId, t.evidenceId),
    index("manual_refs_revision").on(t.revisionId, t.evidenceId),
    foreignKey({
      name: "manual_ref_report_revision_fk",
      columns: [t.reportId, t.revisionId],
      foreignColumns: [manualRevisions.reportId, manualRevisions.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "manual_ref_report_trip_fk",
      columns: [t.reportId, t.tripId],
      foreignColumns: [manualReports.id, manualReports.tripId],
    }).onDelete("restrict"),
  ],
);
export const manualDrafts = mysqlTable(
  "manual_drafts",
  {
    id: idColumn("id").primaryKey(),
    ownerId: idColumn("owner_id")
      .notNull()
      .references(() => membership.userId, { onDelete: "restrict" }),
    version: int("version", { unsigned: true }).notNull(),
    state: mysqlEnum("state", ["editing", "submitted"]).notNull(),
    fields: json("fields").$type<unknown>().notNull(),
    targetTrip: json("target_trip").$type<unknown>(),
    submittedReportId: idColumn("submitted_report_id").references(() => manualReports.id, {
      onDelete: "restrict",
    }),
    createdAt: utcColumn("created_at").notNull(),
    updatedAt: utcColumn("updated_at").notNull(),
  },
  (t) => [index("manual_draft_owner_page").on(t.ownerId, t.createdAt, t.id)],
);
export const manualDraftEvidence = mysqlTable(
  "manual_draft_evidence",
  {
    draftId: idColumn("draft_id")
      .notNull()
      .references(() => manualDrafts.id, { onDelete: "restrict" }),
    evidenceId: idColumn("evidence_id")
      .notNull()
      .references(() => manualEvidence.id, { onDelete: "restrict" }),
    holdUntil: utcColumn("hold_until").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.draftId, t.evidenceId] }),
    index("manual_draft_evidence_reference").on(t.evidenceId, t.draftId),
  ],
);
export const manualDraftHistory = mysqlTable(
  "manual_draft_history",
  {
    draftId: idColumn("draft_id")
      .notNull()
      .references(() => manualDrafts.id, { onDelete: "restrict" }),
    version: int("version", { unsigned: true }).notNull(),
    snapshot: json("snapshot").$type<unknown>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.draftId, t.version] })],
);
export const manualCommands = mysqlTable(
  "manual_commands",
  {
    ownerId: idColumn("owner_id")
      .notNull()
      .references(() => membership.userId, { onDelete: "restrict" }),
    scope: opaqueColumn("scope", { length: 128 }).notNull(),
    key: idColumn("command_key").notNull(),
    fingerprint: opaqueColumn("fingerprint", { length: 32 }).notNull(),
    result: json("result").$type<unknown>().notNull(),
    createdAt: utcColumn("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.scope, t.key] })],
);
export const manualCorrectionRequests = mysqlTable(
  "manual_correction_requests",
  {
    id: idColumn("id").primaryKey(),
    ownerId: idColumn("owner_id").notNull(),
    tripId: idColumn("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "restrict" }),
    baseTripVersion: int("base_trip_version", { unsigned: true }).notNull(),
    baseRevisionId: idColumn("base_revision_id"),
    reason: varchar("reason", { length: 4000 }).notNull(),
    status: mysqlEnum("status", ["pending", "resolved", "declined"]).notNull(),
    requestedAt: utcColumn("requested_at").notNull(),
  },
  (t) => [
    index("manual_correction_trip_page").on(t.tripId, t.requestedAt, t.id),
    foreignKey({
      name: "manual_correction_owner_fk",
      columns: [t.ownerId],
      foreignColumns: [membership.userId],
    }).onDelete("restrict"),
    foreignKey({
      name: "manual_correction_revision_fk",
      columns: [t.baseRevisionId],
      foreignColumns: [manualRevisions.id],
    }).onDelete("restrict"),
  ],
);
export const manualCorrectionHistory = mysqlTable(
  "manual_correction_history",
  {
    id: idColumn("id").primaryKey(),
    requestId: idColumn("request_id").notNull(),
    status: mysqlEnum("status", ["pending", "resolved", "declined"]).notNull(),
    recordedAt: utcColumn("recorded_at").notNull(),
    reason: varchar("reason", { length: 4000 }),
  },
  (t) => [
    index("manual_correction_history_page").on(t.requestId, t.recordedAt, t.id),
    foreignKey({
      name: "manual_correction_history_request_fk",
      columns: [t.requestId],
      foreignColumns: [manualCorrectionRequests.id],
    }).onDelete("restrict"),
  ],
);
export const manualReviewGates = mysqlTable(
  "manual_review_gates",
  {
    tripId: idColumn("trip_id")
      .primaryKey()
      .references(() => trips.id, { onDelete: "restrict" }),
    latestDecisionAt: utcColumn("latest_decision_at"),
    underReview: boolean("under_review").notNull(),
  },
  (t) => [index("manual_review_retention").on(t.underReview, t.latestDecisionAt, t.tripId)],
);
