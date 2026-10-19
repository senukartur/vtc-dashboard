import {
  customType,
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
import { idColumn, opaqueColumn, utcColumn } from "../../core/values.js";
import { membership } from "../identity/index.js";

export { and, desc, eq, inArray, lt, lte, or, sql } from "drizzle-orm";

const email = (name: string) =>
  customType<{ data: string; driverData: string }>({
    dataType: () => "varchar(254) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin",
  })(name);
export const applications = mysqlTable(
  "admissions_applications",
  {
    id: idColumn("id").primaryKey(),
    version: int("version", { unsigned: true }).notNull().default(1),
    status: mysqlEnum("status", ["submitted", "approved", "rejected"])
      .notNull()
      .default("submitted"),
    submittedAt: utcColumn("submitted_at").notNull(),
    nickname: varchar("nickname", { length: 128 }).notNull(),
    locale: mysqlEnum("locale", ["en", "ru"]).notNull().default("en"),
    email: email("email").notNull(),
    emailKey: email("email_key").notNull(),
    openEmail: email("open_email"),
    steamProfileUrl: varchar("steam_profile_url", { length: 512 }).notNull(),
    games: json("games").$type<("ets2" | "ats")[]>().notNull(),
    discord: varchar("discord", { length: 256 }),
    introduction: text("introduction"),
    invitationId: idColumn("invitation_id"),
  },
  (t) => [
    uniqueIndex("admissions_one_open_email").on(t.openEmail),
    index("admissions_submitted_page").on(t.submittedAt, t.id),
    index("admissions_email_history").on(t.emailKey, t.submittedAt, t.id),
  ],
);
export const decisions = mysqlTable(
  "admissions_decisions",
  {
    applicationId: idColumn("application_id").primaryKey(),
    id: idColumn("id").notNull().unique(),
    outcome: mysqlEnum("outcome", ["approve", "reject"]).notNull(),
    reason: text("reason"),
    reviewerId: idColumn("reviewer_id")
      .notNull()
      .references(() => membership.userId, { onDelete: "restrict" }),
    decidedAt: utcColumn("decided_at").notNull(),
    applicationVersion: int("application_version", { unsigned: true }).notNull(),
    deliveryId: idColumn("delivery_id"),
  },
  (t) => [
    foreignKey({
      name: "admissions_decision_application_fk",
      columns: [t.applicationId],
      foreignColumns: [applications.id],
    }).onDelete("restrict"),
  ],
);
export const invitations = mysqlTable(
  "admissions_invitations",
  {
    id: idColumn("id").primaryKey(),
    applicationId: idColumn("application_id").notNull(),
    version: int("version", { unsigned: true }).notNull().default(1),
    state: mysqlEnum("state", ["active", "used", "revoked"]).notNull().default("active"),
    secretHash: opaqueColumn("secret_hash", { length: 32 }),
    ciphertext: text("ciphertext"),
    payloadExpiresAt: utcColumn("payload_expires_at"),
    createdAt: utcColumn("created_at").notNull(),
    expiresAt: utcColumn("expires_at").notNull(),
    consumedAt: utcColumn("consumed_at"),
    userId: idColumn("user_id").references(() => membership.userId, { onDelete: "restrict" }),
    deliveryId: idColumn("delivery_id"),
  },
  (t) => [
    uniqueIndex("admissions_invitation_hash").on(t.secretHash),
    foreignKey({
      name: "admissions_invitation_application_fk",
      columns: [t.applicationId],
      foreignColumns: [applications.id],
    }).onDelete("restrict"),
    index("admissions_invitation_application").on(t.applicationId),
    index("admissions_invitation_expiry").on(t.payloadExpiresAt),
  ],
);
export const commandResults = mysqlTable(
  "admissions_command_results",
  {
    scopeHash: opaqueColumn("scope_hash", { length: 32 }).notNull(),
    key: idColumn("idempotency_key").notNull(),
    fingerprint: opaqueColumn("fingerprint", { length: 32 }).notNull(),
    result: json("result").$type<{ id: string; version: number; response?: unknown }>().notNull(),
    expiresAt: utcColumn("expires_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.scopeHash, t.key] }),
    index("admissions_result_expiry").on(t.expiresAt),
  ],
);
export const limits = mysqlTable("admissions_limits", {
  bucket: varchar("bucket", { length: 64 }).primaryKey(),
  window: int("window", { unsigned: true }).notNull(),
  count: int("count", { unsigned: true }).notNull(),
});
