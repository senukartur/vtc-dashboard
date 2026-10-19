import {
  index,
  int,
  mediumtext,
  mysqlEnum,
  mysqlTable,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { idColumn, opaqueColumn, utcColumn } from "../core/values.js";

// Private ciphertext is deliberately separate from common job references and public DTOs.
export const mailDeliveries = mysqlTable(
  "mail_deliveries",
  {
    id: idColumn("id").primaryKey(),
    owner: mysqlEnum("owner", ["identity", "admissions"]).notNull(),
    generationId: idColumn("generation_id").notNull(),
    userId: idColumn("user_id"),
    kind: mysqlEnum("kind", [
      "email_verification",
      "password_reset",
      "password_change",
      "email_change",
      "succession",
      "invitation",
      "rejection",
    ]).notNull(),
    locale: mysqlEnum("locale", ["en", "ru"]).notNull(),
    mode: mysqlEnum("mode", ["local", "resend"]).notNull(),
    templateVersion: int("template_version").notNull(),
    fingerprint: opaqueColumn("fingerprint", { length: 32 }).notNull(),
    ciphertext: mediumtext("ciphertext"),
    state: mysqlEnum("state", [
      "queued",
      "attempting",
      "retryable",
      "accepted",
      "simulated",
      "suppressed",
      "failed",
      "ambiguous",
    ]).notNull(),
    category: varchar("category", { length: 32 }),
    version: int("version").notNull(),
    attempts: int("attempts").notNull(),
    expiresAt: utcColumn("expires_at").notNull(),
    createdAt: utcColumn("created_at").notNull(),
    updatedAt: utcColumn("updated_at").notNull(),
    firstAttemptAt: utcColumn("first_attempt_at"),
    nextAttemptAt: utcColumn("next_attempt_at"),
    receipt: varchar("receipt", { length: 128 }),
  },
  (t) => [
    uniqueIndex("mail_generation_unique").on(t.owner, t.generationId, t.kind),
    index("mail_user_idx").on(t.userId, t.id),
    index("mail_expiry_idx").on(t.expiresAt, t.id),
  ],
);

export const mailCommands = mysqlTable(
  "mail_commands",
  {
    key: idColumn("command_key").notNull(),
    actorId: idColumn("actor_id").notNull(),
    deliveryId: idColumn("delivery_id")
      .notNull()
      .references(() => mailDeliveries.id),
    expectedVersion: int("expected_version").notNull(),
    resultVersion: int("result_version").notNull(),
    createdAt: utcColumn("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("mail_command_actor_unique").on(t.actorId, t.key),
    index("mail_command_expiry_idx").on(t.createdAt),
  ],
);

export { and, eq, lte, sql } from "drizzle-orm";
