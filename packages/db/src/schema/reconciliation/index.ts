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
import { membership } from "../identity/index.js";
import { trips } from "../trips/index.js";
export { and, asc, desc, eq, gt, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
export const reconciliationRules = mysqlTable(
  "reconciliation_rules",
  {
    hash: opaqueColumn("hash", { length: 32 }).primaryKey(),
    version: int("version", { unsigned: true }),
    config: json("config").$type<unknown>().notNull(),
    createdAt: utcColumn("created_at").notNull(),
  },
  (t) => [uniqueIndex("reconciliation_rule_version").on(t.version)],
);
export const reconciliationCandidates = mysqlTable(
  "reconciliation_candidates",
  {
    id: idColumn("id").primaryKey(),
    ownerId: idColumn("owner_id").notNull(),
    game: mysqlEnum("game", ["ets2", "ats"]).notNull(),
    searchHash: opaqueColumn("search_hash", { length: 32 }).notNull(),
    primaryTripId: idColumn("primary_trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "restrict" }),
    secondaryTripId: idColumn("secondary_trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "restrict" }),
    primaryVersion: int("primary_version", { unsigned: true }).notNull(),
    secondaryVersion: int("secondary_version", { unsigned: true }).notNull(),
    ruleHash: opaqueColumn("rule_hash", { length: 32 })
      .notNull()
      .references(() => reconciliationRules.hash, { onDelete: "restrict" }),
    evidence: json("evidence").$type<unknown>().notNull(),
    reasons: json("reasons").$type<string[]>().notNull(),
    active: boolean("active").notNull(),
    createdAt: utcColumn("created_at").notNull(),
  },
  (t) => [
    foreignKey({
      name: "recon_candidate_owner_fk",
      columns: [t.ownerId],
      foreignColumns: [membership.userId],
    }).onDelete("restrict"),
    uniqueIndex("reconciliation_candidate_snapshot").on(
      t.primaryTripId,
      t.secondaryTripId,
      t.primaryVersion,
      t.secondaryVersion,
      t.ruleHash,
      t.searchHash,
    ),
    index("reconciliation_candidate_owner").on(t.ownerId, t.game, t.active),
    index("reconciliation_candidate_page").on(t.active, t.createdAt, t.id),
    check("reconciliation_candidate_distinct", sql`${t.primaryTripId} <> ${t.secondaryTripId}`),
  ],
);
export const reconciliations = mysqlTable("reconciliations", {
  id: idColumn("id").primaryKey(),
  version: int("version", { unsigned: true }).notNull(),
  primaryTripId: idColumn("primary_trip_id")
    .notNull()
    .references(() => trips.id, { onDelete: "restrict" }),
  secondaryTripId: idColumn("secondary_trip_id")
    .notNull()
    .references(() => trips.id, { onDelete: "restrict" }),
  primaryVersion: int("primary_version", { unsigned: true }).notNull(),
  secondaryVersion: int("secondary_version", { unsigned: true }).notNull(),
  state: mysqlEnum("state", ["applied", "reversed"]).notNull(),
  createdAt: utcColumn("created_at").notNull(),
});
export const reconciliationHistory = mysqlTable(
  "reconciliation_history",
  {
    reconciliationId: idColumn("reconciliation_id")
      .notNull()
      .references(() => reconciliations.id, { onDelete: "restrict" }),
    version: int("version", { unsigned: true }).notNull(),
    actorId: idColumn("actor_id").references(() => membership.userId, { onDelete: "restrict" }),
    operation: mysqlEnum("operation", ["apply", "reverse"]).notNull(),
    reason: varchar("reason", { length: 2048 }).notNull(),
    snapshot: json("snapshot").$type<unknown>().notNull(),
    createdAt: utcColumn("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.reconciliationId, t.version] })],
);

// Permanent command receipts survive unrelated identity command expiry and raw evidence retention.
export const reconciliationCommands = mysqlTable(
  "reconciliation_commands",
  {
    actorId: idColumn("actor_id")
      .notNull()
      .references(() => membership.userId, { onDelete: "restrict" }),
    operation: mysqlEnum("operation", ["merge", "reverse"]).notNull(),
    key: idColumn("key").notNull(),
    fingerprint: opaqueColumn("fingerprint", { length: 32 }).notNull(),
    result: json("result").$type<unknown>().notNull(),
    createdAt: utcColumn("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.actorId, t.operation, t.key] })],
);
