import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  datetime,
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
import { idColumn, opaqueColumn } from "../../core/values.js";

// Keep module queries on the same Drizzle type identity as the transaction host.
export { and, eq, gt, inArray, lt, sql } from "drizzle-orm";

// Better Auth receives Date values; ordinary utcColumn intentionally receives ISO strings.
const instant = (name: string) => datetime(name, { mode: "date", fsp: 3 });
const exactText = (name: string, length: number) =>
  customType<{ data: string; driverData: string }>({
    dataType: () => `varchar(${length}) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`,
  })(name);

export const user = mysqlTable(
  "identity_users",
  {
    id: idColumn("id").primaryKey(),
    name: varchar("name", { length: 128 }).notNull(),
    email: exactText("email", 254).notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    createdAt: instant("created_at").notNull(),
    updatedAt: instant("updated_at").notNull(),
  },
  (t) => [uniqueIndex("identity_email_unique").on(t.email)],
);

export const account = mysqlTable(
  "identity_accounts",
  {
    id: idColumn("id").primaryKey(),
    accountId: exactText("account_id", 128).notNull(),
    providerId: exactText("provider_id", 64).notNull(),
    userId: idColumn("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    password: text("password"),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: instant("access_token_expires_at"),
    refreshTokenExpiresAt: instant("refresh_token_expires_at"),
    scope: text("scope"),
    createdAt: instant("created_at").notNull(),
    updatedAt: instant("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("identity_provider_account_unique").on(t.providerId, t.accountId),
    index("identity_account_user").on(t.userId),
  ],
);

export const membership = mysqlTable("identity_memberships", {
  userId: idColumn("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "restrict" }),
  status: mysqlEnum("status", ["active", "inactive"]).notNull(),
  version: int("version", { unsigned: true }).notNull().default(1),
  accessEpoch: int("access_epoch", { unsigned: true }).notNull().default(1),
  identityEpoch: int("identity_epoch", { unsigned: true }).notNull().default(1),
  credentialEpoch: int("credential_epoch", { unsigned: true }).notNull().default(1),
  emailEpoch: int("email_epoch", { unsigned: true }).notNull().default(1),
  locale: mysqlEnum("locale", ["en", "ru"]).notNull().default("en"),
  displayTimezone: varchar("display_timezone", { length: 128 }).notNull().default("UTC"),
});

export const roles = mysqlTable(
  "identity_roles",
  {
    userId: idColumn("user_id")
      .notNull()
      .references(() => membership.userId, { onDelete: "restrict" }),
    role: mysqlEnum("role", ["trainee", "driver", "dispatcher", "deputy_director"]).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.role] })],
);

export const company = mysqlTable(
  "identity_company",
  {
    singleton: int("singleton").primaryKey(),
    id: idColumn("id").notNull().unique(),
    directorUserId: idColumn("director_user_id").notNull(),
    version: int("version", { unsigned: true }).notNull().default(1),
  },
  (t) => [
    check("identity_one_company", sql`${t.singleton} = 1`),
    foreignKey({
      name: "identity_company_director_fk",
      columns: [t.directorUserId],
      foreignColumns: [membership.userId],
    }).onDelete("restrict"),
  ],
);

export const session = mysqlTable(
  "identity_sessions",
  {
    id: idColumn("id").primaryKey(),
    token: exactText("token", 256).notNull().unique(),
    userId: idColumn("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    expiresAt: instant("expires_at").notNull(),
    createdAt: instant("created_at").notNull(),
    updatedAt: instant("updated_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    accessEpoch: int("access_epoch", { unsigned: true }).notNull().default(0),
    credentialEpoch: int("credential_epoch", { unsigned: true }).notNull().default(0),
  },
  (t) => [
    index("identity_session_user").on(t.userId),
    index("identity_session_expiry").on(t.expiresAt),
  ],
);

// The native verification API is never exposed. Project challenges are bound below.
export const verification = mysqlTable("identity_verifications", {
  id: idColumn("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: instant("expires_at").notNull(),
  createdAt: instant("created_at").notNull(),
  updatedAt: instant("updated_at").notNull(),
});

export const challenges = mysqlTable(
  "identity_challenges",
  {
    id: idColumn("id").primaryKey(),
    userId: idColumn("user_id")
      .notNull()
      .references(() => membership.userId, { onDelete: "restrict" }),
    purpose: mysqlEnum("purpose", [
      "email_verification",
      "password_reset",
      "password_change",
      "email_change",
      "succession",
    ]).notNull(),
    successorId: idColumn("successor_id").references(() => membership.userId, {
      onDelete: "restrict",
    }),
    proposedEmail: exactText("proposed_email", 254),
    currentEmailConfirmed: boolean("current_email_confirmed").notNull().default(false),
    identityEpoch: int("identity_epoch", { unsigned: true }).notNull().default(0),
    emailEpoch: int("email_epoch", { unsigned: true }).notNull(),
    accessEpoch: int("access_epoch", { unsigned: true }).notNull(),
    credentialEpoch: int("credential_epoch", { unsigned: true }).notNull(),
    secretHash: opaqueColumn("secret_hash", { length: 32 }).notNull(),
    expiresAt: instant("expires_at").notNull(),
    attempts: int("attempts", { unsigned: true }).notNull().default(0),
    consumed: boolean("consumed").notNull().default(false),
  },
  (t) => [index("identity_challenge_member_purpose").on(t.userId, t.purpose)],
);

export const limits = mysqlTable("identity_limits", {
  bucket: varchar("bucket", { length: 32 }).primaryKey(),
  window: int("window", { unsigned: true }).notNull(),
  count: int("count", { unsigned: true }).notNull(),
});

export const commandResults = mysqlTable(
  "identity_command_results",
  {
    scopeHash: opaqueColumn("scope_hash", { length: 32 }).notNull(),
    key: idColumn("command_key").notNull(),
    fingerprint: opaqueColumn("fingerprint", { length: 32 }).notNull(),
    result: json("result").$type<Record<string, unknown>>().notNull(),
    expiresAt: instant("expires_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.scopeHash, t.key] }),
    index("identity_result_expiry").on(t.expiresAt),
  ],
);

export const authSchema = { user, account, session, verification };
