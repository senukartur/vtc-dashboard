import { sql } from "drizzle-orm";
import {
  type AnyMySqlColumn,
  check,
  foreignKey,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { decimalColumn, idColumn, opaqueColumn, utcColumn } from "../../core/values.js";
import { membership } from "../identity/index.js";
import { catalogFacts } from "../catalogs/index.js";
export { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
const fk = (name: string, column: AnyMySqlColumn, target: AnyMySqlColumn) =>
  foreignKey({ name, columns: [column], foreignColumns: [target] }).onDelete("restrict");
export const events = mysqlTable(
  "events",
  {
    id: idColumn("id").primaryKey(),
    version: int("version", { unsigned: true }).notNull(),
    changeSequence: int("change_sequence", { unsigned: true }).notNull(),
    attendanceVersion: int("attendance_version", { unsigned: true }).notNull(),
    currentRevisionId: idColumn("current_revision_id"),
    game: mysqlEnum("game", ["ets2", "ats"]).notNull(),
    visibility: mysqlEnum("visibility", ["public", "members"]).notNull(),
    status: mysqlEnum("status", ["scheduled", "cancelled"]).notNull(),
    startsAt: utcColumn("starts_at").notNull(),
    createdAt: utcColumn("created_at").notNull(),
  },
  (t) => [
    index("event_member_page").on(t.startsAt, t.id),
    index("event_public_page").on(t.visibility, t.startsAt, t.id),
    check(
      "event_versions_positive",
      sql`${t.version}>0 AND ${t.changeSequence}>0 AND ${t.attendanceVersion}>0`,
    ),
  ],
);
export const eventRevisions = mysqlTable(
  "event_revisions",
  {
    id: idColumn("id").primaryKey(),
    eventId: idColumn("event_id").notNull(),
    version: int("version", { unsigned: true }).notNull(),
    sequence: int("sequence", { unsigned: true }).notNull(),
    actorId: idColumn("actor_id").notNull(),
    recordedAt: utcColumn("recorded_at").notNull(),
    category: mysqlEnum("category", ["created", "updated", "cancelled"]).notNull(),
    status: mysqlEnum("status", ["scheduled", "cancelled"]).notNull(),
    title: varchar("title", { length: 256 }).notNull(),
    description: text("description").notNull(),
    game: mysqlEnum("game", ["ets2", "ats"]).notNull(),
    server: varchar("server", { length: 256 }).notNull(),
    organizer: varchar("organizer", { length: 256 }).notNull(),
    meetingLocation: varchar("meeting_location", { length: 2048 }).notNull(),
    route: varchar("route", { length: 2048 }).notNull(),
    meetingAt: utcColumn("meeting_at").notNull(),
    startsAt: utcColumn("starts_at").notNull(),
    endsAt: utcColumn("ends_at"),
    visibility: mysqlEnum("visibility", ["public", "members"]).notNull(),
    prescribedMassKg: decimalColumn("prescribed_mass_kg"),
    privateReason: varchar("private_reason", { length: 2048 }),
  },
  (t) => [
    fk("event_revision_event_fk", t.eventId, events.id),
    fk("event_revision_actor_fk", t.actorId, membership.userId),
    uniqueIndex("event_revision_version").on(t.eventId, t.version),
    uniqueIndex("event_revision_sequence").on(t.eventId, t.sequence),
    check(
      "event_time_order",
      sql`${t.meetingAt}<=${t.startsAt} AND (${t.endsAt} IS NULL OR ${t.endsAt}>=${t.startsAt})`,
    ),
    check("event_mass_nonnegative", sql`${t.prescribedMassKg} IS NULL OR ${t.prescribedMassKg}>=0`),
  ],
);
export const eventCatalogPins = mysqlTable(
  "event_catalog_pins",
  {
    revisionId: idColumn("revision_id").notNull(),
    field: mysqlEnum("field", ["origin", "destination", "cargo", "trailer"]).notNull(),
    factId: idColumn("fact_id").notNull(),
    entityId: idColumn("entity_id").notNull(),
    catalogRevisionId: idColumn("catalog_revision_id").notNull(),
    label: json("label")
      .$type<{
        entityId: string;
        label: string;
        requestedLocale: "en" | "ru";
        renderedLocale: "en" | "ru";
        englishFallback: boolean;
        retired: boolean;
      }>()
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.revisionId, t.field] }),
    fk("event_pin_revision_fk", t.revisionId, eventRevisions.id),
    foreignKey({
      name: "event_pin_catalog_fk",
      columns: [t.factId, t.catalogRevisionId, t.entityId],
      foreignColumns: [catalogFacts.id, catalogFacts.revisionId, catalogFacts.entityId],
    }).onDelete("restrict"),
  ],
);
export const eventResponses = mysqlTable(
  "event_responses",
  {
    id: idColumn("id").primaryKey(),
    eventId: idColumn("event_id").notNull(),
    memberId: idColumn("member_id").notNull(),
    version: int("version", { unsigned: true }).notNull(),
    currentRevisionId: idColumn("current_revision_id").notNull(),
    status: mysqlEnum("status", ["unanswered", "participating", "declined"]).notNull(),
  },
  (t) => [
    fk("event_response_event_fk", t.eventId, events.id),
    fk("event_response_member_fk", t.memberId, membership.userId),
    uniqueIndex("event_response_member").on(t.eventId, t.memberId),
    index("event_participants_page").on(t.eventId, t.status, t.memberId),
  ],
);
export const eventResponseRevisions = mysqlTable(
  "event_response_revisions",
  {
    id: idColumn("id").primaryKey(),
    responseId: idColumn("response_id").notNull(),
    eventId: idColumn("event_id").notNull(),
    memberId: idColumn("member_id").notNull(),
    version: int("version", { unsigned: true }).notNull(),
    sequence: int("sequence", { unsigned: true }).notNull(),
    actorId: idColumn("actor_id").notNull(),
    recordedAt: utcColumn("recorded_at").notNull(),
    status: mysqlEnum("status", ["unanswered", "participating", "declined"]).notNull(),
    reason: varchar("reason", { length: 2048 }),
  },
  (t) => [
    fk("event_response_rev_event_fk", t.eventId, events.id),
    fk("event_response_rev_member_fk", t.memberId, membership.userId),
    fk("event_response_rev_actor_fk", t.actorId, membership.userId),
    uniqueIndex("event_response_rev_version").on(t.responseId, t.version),
    index("event_response_order").on(t.eventId, t.sequence, t.memberId),
    check(
      "event_decline_reason",
      sql`(${t.status}='declined' AND ${t.reason} IS NOT NULL AND CHAR_LENGTH(TRIM(${t.reason}))>0) OR (${t.status}<>'declined' AND ${t.reason} IS NULL)`,
    ),
  ],
);
export const eventAttendances = mysqlTable(
  "event_attendances",
  {
    eventId: idColumn("event_id").notNull(),
    memberId: idColumn("member_id").notNull(),
    currentRevisionId: idColumn("current_revision_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.memberId] }),
    fk("event_attendance_event_fk", t.eventId, events.id),
    fk("event_attendance_member_fk", t.memberId, membership.userId),
  ],
);
export const eventAttendanceRevisions = mysqlTable(
  "event_attendance_revisions",
  {
    id: idColumn("id").primaryKey(),
    eventId: idColumn("event_id").notNull(),
    eventRevisionId: idColumn("event_revision_id").notNull(),
    memberId: idColumn("member_id").notNull(),
    version: int("version", { unsigned: true }).notNull(),
    sequence: int("sequence", { unsigned: true }).notNull(),
    actorId: idColumn("actor_id").notNull(),
    recordedAt: utcColumn("recorded_at").notNull(),
    status: mysqlEnum("status", ["attended", "not_attended"]).notNull(),
    note: varchar("note", { length: 2048 }),
  },
  (t) => [
    fk("event_attendance_rev_event_fk", t.eventId, events.id),
    fk("event_attendance_rev_definition_fk", t.eventRevisionId, eventRevisions.id),
    fk("event_attendance_rev_member_fk", t.memberId, membership.userId),
    fk("event_attendance_rev_actor_fk", t.actorId, membership.userId),
    uniqueIndex("event_attendance_rev_version").on(t.eventId, t.memberId, t.version),
    index("event_attendance_order").on(t.eventId, t.sequence, t.memberId),
  ],
);
// Durable results contain immutable references only; private reasons remain in owned history.
export const eventCommands = mysqlTable(
  "event_commands",
  {
    actorId: idColumn("actor_id").notNull(),
    route: mysqlEnum("route", ["create", "update", "cancel", "response", "attendance"]).notNull(),
    targetId: idColumn("target_id").notNull(),
    key: idColumn("key").notNull(),
    fingerprint: opaqueColumn("fingerprint", { length: 32 }).notNull(),
    result: json("result")
      .$type<{ eventId: string; revisionId: string; version: number }>()
      .notNull(),
    recordedAt: utcColumn("recorded_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.actorId, t.route, t.targetId, t.key] }),
    fk("event_command_actor_fk", t.actorId, membership.userId),
  ],
);
