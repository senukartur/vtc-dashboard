import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { idColumn, opaqueColumn, utcColumn } from "../../core/values.js";
import { eventAttendanceRevisions, eventRevisions, events } from "../events/index.js";
import { membership } from "../identity/index.js";
import { manualCorrectionRequests } from "../manual-reports/index.js";
import {
  qualificationAssignments,
  qualificationLevels,
  qualificationRules,
} from "../qualifications/index.js";
import { tripFacts, tripResolutions, trips } from "../trips/index.js";

export { and, asc, desc, eq, gt, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";

export const tripDecisions = mysqlTable(
  "trip_decisions",
  {
    id: idColumn("id").primaryKey(),
    tripId: idColumn("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "restrict" }),
    sequence: int("sequence", { unsigned: true }).notNull(),
    factId: idColumn("fact_id")
      .notNull()
      .references(() => tripFacts.id, { onDelete: "restrict" }),
    outcome: mysqlEnum("outcome", ["accepted", "rejected"]).notNull(),
    actorId: idColumn("actor_id").references(() => membership.userId, { onDelete: "restrict" }),
    reviewedRevisionId: idColumn("reviewed_revision_id"),
    reason: varchar("reason", { length: 2048 }),
    reasonCodes: json("reason_codes").$type<string[]>().notNull(),
    assignmentId: idColumn("assignment_id").references(() => qualificationAssignments.id, {
      onDelete: "restrict",
    }),
    levelId: idColumn("level_id").references(() => qualificationLevels.id, {
      onDelete: "restrict",
    }),
    ruleVersionId: idColumn("rule_version_id").references(() => qualificationRules.id, {
      onDelete: "restrict",
    }),
    eventId: idColumn("event_id").references(() => events.id, { onDelete: "restrict" }),
    eventRevisionId: idColumn("event_revision_id").references(() => eventRevisions.id, {
      onDelete: "restrict",
    }),
    attendanceRevisionId: idColumn("attendance_revision_id"),
    attributionAt: utcColumn("attribution_at"),
    attributionBasis: mysqlEnum("attribution_basis", [
      "actual_start",
      "manual_confirmation",
      "staff_resolution",
      "unknown",
    ]).notNull(),
    reportingAt: utcColumn("reporting_at"),
    supportingFacts: json("supporting_facts").$type<string[]>().notNull(),
    decidedAt: utcColumn("decided_at").notNull(),
  },
  (t) => [
    foreignKey({
      name: "trip_decision_attendance_fk",
      columns: [t.attendanceRevisionId],
      foreignColumns: [eventAttendanceRevisions.id],
    }).onDelete("restrict"),
    uniqueIndex("trip_decision_sequence").on(t.tripId, t.sequence),
    check("trip_decision_reason", sql`${t.actorId} IS NULL OR CHAR_LENGTH(TRIM(${t.reason})) > 0`),
  ],
);
export const tripProposals = mysqlTable(
  "trip_proposals",
  {
    id: idColumn("id").primaryKey(),
    revisionId: idColumn("revision_id").notNull(),
    tripId: idColumn("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "restrict" }),
    kind: mysqlEnum("kind", ["correction_request", "resolution"]).notNull(),
    correctionRequestId: idColumn("correction_request_id"),
    authorId: idColumn("author_id")
      .notNull()
      .references(() => membership.userId, { onDelete: "restrict" }),
    baseTripVersion: int("base_trip_version", { unsigned: true }).notNull(),
    baseFactId: idColumn("base_fact_id")
      .notNull()
      .references(() => tripFacts.id, { onDelete: "restrict" }),
    derivedFactId: idColumn("derived_fact_id").references(() => tripFacts.id, {
      onDelete: "restrict",
    }),
    resolutionId: idColumn("resolution_id").references(() => tripResolutions.id, {
      onDelete: "restrict",
    }),
    supportHash: opaqueColumn("support_hash", { length: 32 }).notNull(),
    reason: varchar("reason", { length: 2048 }).notNull(),
    evidenceIds: json("evidence_ids").$type<string[]>().notNull(),
    changes: json("changes").$type<unknown>(),
    eventId: idColumn("event_id").references(() => events.id, { onDelete: "restrict" }),
    eventRevisionId: idColumn("event_revision_id").references(() => eventRevisions.id, {
      onDelete: "restrict",
    }),
    attendanceRevisionId: idColumn("attendance_revision_id"),
    createdAt: utcColumn("created_at").notNull(),
  },
  (t) => [
    foreignKey({
      name: "trip_proposal_correction_fk",
      columns: [t.correctionRequestId],
      foreignColumns: [manualCorrectionRequests.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "trip_proposal_attendance_fk",
      columns: [t.attendanceRevisionId],
      foreignColumns: [eventAttendanceRevisions.id],
    }).onDelete("restrict"),
    check(
      "trip_proposal_event_shape",
      sql`(${t.eventId} IS NULL AND ${t.eventRevisionId} IS NULL AND ${t.attendanceRevisionId} IS NULL) OR (${t.eventId} IS NOT NULL AND ${t.eventRevisionId} IS NOT NULL)`,
    ),
    uniqueIndex("trip_proposal_revision").on(t.revisionId),
    index("trip_proposal_page").on(t.tripId, t.createdAt, t.id),
  ],
);
export const tripProposalReviews = mysqlTable("trip_proposal_reviews", {
  proposalId: idColumn("proposal_id")
    .primaryKey()
    .references(() => tripProposals.id, { onDelete: "restrict" }),
  actorId: idColumn("actor_id")
    .notNull()
    .references(() => membership.userId, { onDelete: "restrict" }),
  outcome: mysqlEnum("outcome", ["approve", "reject"]).notNull(),
  reviewedRevisionId: idColumn("reviewed_revision_id").notNull(),
  reason: varchar("reason", { length: 2048 }).notNull(),
  decidedAt: utcColumn("decided_at").notNull(),
});
export const tripReviewWork = mysqlTable(
  "trip_review_work",
  {
    tripId: idColumn("trip_id")
      .primaryKey()
      .references(() => trips.id, { onDelete: "restrict" }),
    supportHash: opaqueColumn("support_hash", { length: 32 }).notNull(),
    pending: boolean("pending").notNull(),
    reasons: json("reasons").$type<string[]>().notNull(),
    assessedAt: utcColumn("assessed_at").notNull(),
  },
  (t) => [index("trip_review_pending").on(t.pending, t.tripId)],
);
export const tripEventAssociations = mysqlTable(
  "trip_event_associations",
  {
    tripId: idColumn("trip_id")
      .primaryKey()
      .references(() => trips.id, { onDelete: "restrict" }),
    eventId: idColumn("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "restrict" }),
  },
  (t) => [index("trip_event_fanout").on(t.eventId, t.tripId)],
);
export const tripDecisionCommands = mysqlTable(
  "trip_decision_commands",
  {
    actorId: idColumn("actor_id")
      .notNull()
      .references(() => membership.userId, { onDelete: "restrict" }),
    operation: mysqlEnum("operation", ["decide", "propose", "review", "associate"]).notNull(),
    key: idColumn("key").notNull(),
    fingerprint: opaqueColumn("fingerprint", { length: 32 }).notNull(),
    result: json("result").$type<unknown>().notNull(),
    createdAt: utcColumn("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.actorId, t.operation, t.key] })],
);
export const tripDecisionCatchup = mysqlTable("trip_decision_catchup", {
  id: int("id", { unsigned: true }).primaryKey(),
  generation: int("generation", { unsigned: true }).notNull().default(0),
  cursor: idColumn("cursor"),
  complete: boolean("complete").notNull(),
});
