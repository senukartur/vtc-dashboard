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
import { bigintColumn, idColumn, opaqueColumn, utcColumn } from "../../core/values.js";
import { membership } from "../identity/index.js";

export { and, asc, desc, eq, gt, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
export const notificationAccess = [
  "company",
  "trips.review",
  "applications.manage",
  "qualifications.manage",
  "members.manage",
] as const;
export const preferenceNames = [
  "tripStarted",
  "tripFinished",
  "tripRejected",
  "eventChanges",
  "eventReminders",
  "qualificationChanges",
] as const;
export const recipientStates = mysqlTable(
  "notification_recipients",
  {
    recipientId: idColumn("recipient_id").primaryKey(),
    sequence: bigintColumn("sequence").notNull().default("0"),
    version: int("version", { unsigned: true }).notNull().default(1),
    tripStarted: boolean("trip_started").notNull().default(true),
    tripFinished: boolean("trip_finished").notNull().default(true),
    tripRejected: boolean("trip_rejected").notNull().default(true),
    eventChanges: boolean("event_changes").notNull().default(true),
    eventReminders: boolean("event_reminders").notNull().default(true),
    qualificationChanges: boolean("qualification_changes").notNull().default(true),
  },
  (t) => [
    check("notification_sequence_nonnegative", sql`${t.sequence}>=0`),
    foreignKey({
      name: "notification_recipient_member_fk",
      columns: [t.recipientId],
      foreignColumns: [membership.userId],
    }).onDelete("restrict"),
  ],
);
export const notifications = mysqlTable(
  "notifications",
  {
    id: idColumn("id").primaryKey(),
    recipientId: idColumn("recipient_id").notNull(),
    sequence: bigintColumn("sequence").notNull(),
    effectKey: opaqueColumn("effect_key", { length: 128 }).notNull(),
    category: varchar("category", { length: 128 }).notNull(),
    access: mysqlEnum("access", notificationAccess).notNull(),
    ownerId: idColumn("owner_id"),
    subjectKind: mysqlEnum("subject_kind", [
      "trip",
      "event",
      "qualification",
      "application",
      "member",
    ]).notNull(),
    subjectId: idColumn("subject_id").notNull(),
    subjectVersion: int("subject_version", { unsigned: true }).notNull(),
    actorNickname: varchar("actor_nickname", { length: 128 }),
    game: mysqlEnum("game", ["ets2", "ats"]),
    eventTitle: varchar("event_title", { length: 256 }),
    occurredAt: utcColumn("occurred_at").notNull(),
    liveUntil: utcColumn("live_until"),
    readAt: utcColumn("read_at"),
    invalidatedAt: utcColumn("invalidated_at"),
    reminderRevisionId: idColumn("reminder_revision_id"),
    reminderResponseId: idColumn("reminder_response_id"),
    expiresAt: utcColumn("expires_at"),
    recipientAccessEpoch: int("recipient_access_epoch", { unsigned: true }).notNull(),
  },
  (t) => [
    foreignKey({
      name: "notification_recipient_fk",
      columns: [t.recipientId],
      foreignColumns: [recipientStates.recipientId],
    }).onDelete("restrict"),
    uniqueIndex("notification_recipient_sequence").on(t.recipientId, t.sequence),
    uniqueIndex("notification_recipient_effect").on(t.recipientId, t.effectKey),
    index("notification_unread").on(t.recipientId, t.readAt, t.invalidatedAt, t.access),
    index("notification_subject").on(t.subjectKind, t.subjectId, t.category, t.recipientId),
    index("notification_reminder_invalidation").on(
      t.subjectKind,
      t.subjectId,
      t.category,
      t.recipientId,
      t.invalidatedAt,
    ),
    check("notification_sequence_positive", sql`${t.sequence}>0`),
  ],
);
export const notificationCommands = mysqlTable(
  "notification_commands",
  {
    recipientId: idColumn("recipient_id").notNull(),
    route: mysqlEnum("route", ["read", "read-all", "preferences"]).notNull(),
    key: idColumn("key").notNull(),
    fingerprint: opaqueColumn("fingerprint", { length: 32 }).notNull(),
    result: json("result")
      .$type<{
        id: string;
        version: number;
        preferences?: Record<(typeof preferenceNames)[number], boolean>;
      }>()
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.recipientId, t.route, t.key] }),
    foreignKey({
      name: "notification_command_recipient_fk",
      columns: [t.recipientId],
      foreignColumns: [recipientStates.recipientId],
    }).onDelete("restrict"),
  ],
);
