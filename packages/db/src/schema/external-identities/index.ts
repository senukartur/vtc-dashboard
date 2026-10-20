import {
  boolean,
  customType,
  datetime,
  foreignKey,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  uniqueIndex,
} from "drizzle-orm/mysql-core";
import { idColumn, opaqueColumn } from "../../core/values.js";
import { membership } from "../identity/index.js";

export { and, asc, eq, gt, lt, or, sql } from "drizzle-orm";
const instant = (name: string) => datetime(name, { mode: "date", fsp: 3 });
const exact = (name: string, length: number) =>
  customType<{ data: string; driverData: string }>({
    dataType: () => `varchar(${length}) CHARACTER SET ascii COLLATE ascii_bin`,
  })(name);

// Ownership is permanent, including after a replacement. Display names are never keys.
export const steamAccounts = mysqlTable("external_steam_accounts", {
  steamId: exact("steam_id", 17).primaryKey(),
  userId: idColumn("user_id")
    .notNull()
    .references(() => membership.userId, { onDelete: "restrict" }),
  createdAt: instant("created_at").notNull(),
});
export const steamLinks = mysqlTable(
  "external_steam_links",
  {
    userId: idColumn("user_id")
      .primaryKey()
      .references(() => membership.userId, { onDelete: "restrict" }),
    steamId: exact("steam_id", 17).notNull(),
  },
  (t) => [
    uniqueIndex("external_current_steam_unique").on(t.steamId),
    foreignKey({
      name: "external_link_steam_fk",
      columns: [t.steamId],
      foreignColumns: [steamAccounts.steamId],
    }).onDelete("restrict"),
  ],
);
export const steamProofs = mysqlTable(
  "external_steam_proofs",
  {
    id: idColumn("id").primaryKey(),
    userId: idColumn("user_id")
      .notNull()
      .references(() => membership.userId, { onDelete: "restrict" }),
    sessionId: idColumn("session_id").notNull(),
    purpose: mysqlEnum("purpose", ["initial", "replacement"]).notNull(),
    state: mysqlEnum("state", [
      "pending",
      "verified",
      "failed",
      "applied",
      "invalidated",
    ]).notNull(),
    identityEpoch: int("identity_epoch", { unsigned: true }).notNull(),
    accessEpoch: int("access_epoch", { unsigned: true }).notNull(),
    credentialEpoch: int("credential_epoch", { unsigned: true }).notNull(),
    emailEpoch: int("email_epoch", { unsigned: true }).notNull(),
    previousSteamId: exact("previous_steam_id", 17),
    candidateSteamId: exact("candidate_steam_id", 17),
    createdAt: instant("created_at").notNull(),
    expiresAt: instant("expires_at").notNull(),
    verifiedAt: instant("verified_at"),
  },
  (t) => [
    index("external_proof_member_page").on(t.userId, t.purpose, t.id),
    index("external_proof_active").on(t.userId, t.identityEpoch, t.state, t.expiresAt, t.id),
    index("external_proof_expiry").on(t.expiresAt),
  ],
);
export const steamNonces = mysqlTable(
  "external_steam_nonces",
  {
    hash: opaqueColumn("hash", { length: 32 }).primaryKey(),
    expiresAt: instant("expires_at").notNull(),
  },
  (t) => [index("external_nonce_expiry").on(t.expiresAt)],
);
export const steamChanges = mysqlTable(
  "external_steam_changes",
  {
    id: idColumn("id").primaryKey(),
    userId: idColumn("user_id")
      .notNull()
      .references(() => membership.userId, { onDelete: "restrict" }),
    proofId: idColumn("proof_id")
      .notNull()
      .references(() => steamProofs.id, { onDelete: "restrict" }),
    actorId: idColumn("actor_id")
      .notNull()
      .references(() => membership.userId, { onDelete: "restrict" }),
    previousSteamId: exact("previous_steam_id", 17),
    steamId: exact("steam_id", 17).notNull(),
    version: int("version", { unsigned: true }).notNull(),
    identityEpoch: int("identity_epoch", { unsigned: true }).notNull(),
    reason: text("reason").notNull(),
    occurredAt: instant("occurred_at").notNull(),
  },
  (t) => [
    uniqueIndex("external_change_proof_unique").on(t.proofId),
    index("external_change_member").on(t.userId, t.occurredAt),
    foreignKey({
      name: "external_change_old_steam_fk",
      columns: [t.previousSteamId],
      foreignColumns: [steamAccounts.steamId],
    }).onDelete("restrict"),
    foreignKey({
      name: "external_change_new_steam_fk",
      columns: [t.steamId],
      foreignColumns: [steamAccounts.steamId],
    }).onDelete("restrict"),
  ],
);
export interface TruckersProfile {
  playerId: string;
  displayName: string;
  vtc: {
    inVtc: boolean;
    id: string | null;
    name: string | null;
    tag: string | null;
    memberId: string | null;
  };
}
export const truckersCache = mysqlTable(
  "external_truckers_cache",
  {
    userId: idColumn("user_id")
      .primaryKey()
      .references(() => membership.userId, { onDelete: "restrict" }),
    steamId: exact("steam_id", 17).notNull(),
    identityEpoch: int("identity_epoch", { unsigned: true }).notNull(),
    generation: int("generation", { unsigned: true }).notNull(),
    leaseId: idColumn("lease_id"),
    leaseUntil: instant("lease_until"),
    found: boolean("found"),
    profile: json("profile").$type<TruckersProfile>(),
    checkedAt: instant("checked_at"),
    lastAttemptAt: instant("last_attempt_at"),
    failure: mysqlEnum("failure", [
      "transport",
      "timeout",
      "rate_limited",
      "unavailable",
      "invalid_response",
    ]),
  },
  (t) => [
    index("external_cache_lease").on(t.leaseUntil),
    foreignKey({
      name: "external_cache_steam_fk",
      columns: [t.steamId],
      foreignColumns: [steamAccounts.steamId],
    }).onDelete("restrict"),
  ],
);
