import {
  index,
  int,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { idColumn, opaqueColumn, utcColumn } from "../../core/values.js";
import { company, membership } from "../identity/index.js";

export { and, asc, desc, eq, gt, isNull, lt, ne, or, sql } from "drizzle-orm";
export const telemetryTokens = mysqlTable(
  "telemetry_tokens",
  {
    id: idColumn("id").primaryKey(),
    ownerId: idColumn("owner_id")
      .notNull()
      .references(() => membership.userId, { onDelete: "restrict" }),
    companyId: idColumn("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "restrict" }),
    steamId: opaqueColumn("steam_id", { length: 17 }).notNull(),
    accessEpoch: int("access_epoch", { unsigned: true }).notNull(),
    identityEpoch: int("identity_epoch", { unsigned: true }).notNull(),
    credentialEpoch: int("credential_epoch", { unsigned: true }).notNull(),
    secretHash: opaqueColumn("secret_hash", { length: 32 }).notNull(),
    scope: mysqlEnum("scope", ["ingest"]).notNull(),
    label: varchar("label", { length: 128 }).notNull(),
    createdAt: utcColumn("created_at").notNull(),
    lastUsedAt: utcColumn("last_used_at"),
    revokedAt: utcColumn("revoked_at"),
  },
  (t) => [index("telemetry_token_owner_page").on(t.ownerId, t.createdAt, t.id)],
);
export const telemetryCommands = mysqlTable(
  "telemetry_commands",
  {
    ownerId: idColumn("owner_id")
      .notNull()
      .references(() => membership.userId, { onDelete: "restrict" }),
    key: idColumn("command_key").notNull(),
    fingerprint: opaqueColumn("fingerprint", { length: 32 }).notNull(),
    tokenId: idColumn("token_id")
      .notNull()
      .references(() => telemetryTokens.id, { onDelete: "restrict" }),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.key] })],
);
export const telemetryInstallations = mysqlTable(
  "telemetry_installations",
  {
    id: idColumn("id").primaryKey(),
    bindingId: idColumn("binding_id").notNull().unique(),
    ownerId: idColumn("owner_id")
      .notNull()
      .references(() => membership.userId, { onDelete: "restrict" }),
    companyId: idColumn("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "restrict" }),
    identityEpoch: int("identity_epoch", { unsigned: true }).notNull(),
    clientId: opaqueColumn("client_id", { length: 36 }).notNull(),
    createdAt: utcColumn("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("telemetry_registration_unique").on(
      t.ownerId,
      t.companyId,
      t.identityEpoch,
      t.clientId,
    ),
  ],
);
export const telemetryLimits = mysqlTable("telemetry_limits", {
  key: opaqueColumn("bucket_key", { length: 64 }).primaryKey(),
  credits: int("credits", { unsigned: true }).notNull(),
  updatedMs: opaqueColumn("updated_ms", { length: 16 }).notNull(),
});
