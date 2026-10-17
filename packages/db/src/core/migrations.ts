import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import type { RowDataPacket } from "mysql2/promise";
import { type DatabaseSettings, expectedMysqlVersion, requiredSqlModes } from "../index.js";
import { dedicatedConnection, discard } from "./session.js";

export const migrationFolder = fileURLToPath(new URL("../../migrations/", import.meta.url));

export function migrationLockName(database: string): string {
  // Case folding may over-serialize distinct schemas on case-sensitive servers, but avoids
  // separate locks for aliases on servers with case-insensitive database names.
  return `vtc:migrate:${createHash("sha256").update(database.toLowerCase()).digest("hex").slice(0, 48)}`;
}

export interface MigrationOptions {
  folder?: string;
  lockTimeoutSeconds?: number;
  statementTimeoutMs?: number;
}

// Own ledger extends Drizzle's generated assets with checksums and a durable dirty marker.
// MySQL DDL implicitly commits: an "applying" row requires operator recovery, never replay.
export async function runMigrations(
  settings: DatabaseSettings,
  options: MigrationOptions = {},
): Promise<number> {
  const seconds = options.lockTimeoutSeconds ?? 5;
  const statementTimeout = options.statementTimeoutMs ?? 30000;
  if (
    !Number.isInteger(seconds) ||
    seconds < 0 ||
    seconds > 30 ||
    !Number.isInteger(statementTimeout) ||
    statementTimeout < 100 ||
    statementTimeout > 300000
  ) {
    throw new Error("INVALID_MIGRATION_BOUNDS");
  }
  const migrations = readMigrationFiles({ migrationsFolder: options.folder ?? migrationFolder });
  let last = -1;
  for (const migration of migrations) {
    if (!Number.isSafeInteger(migration.folderMillis) || migration.folderMillis <= last)
      throw new Error("INVALID_MIGRATION_ORDER");
    last = migration.folderMillis;
  }
  const connection = await dedicatedConnection(settings);
  const lockName = migrationLockName(settings.database);
  try {
    const [lock] = await connection.query<RowDataPacket[]>({
      sql: "SELECT GET_LOCK(?, ?) AS acquired",
      values: [lockName, seconds],
      timeout: (seconds + 2) * 1000,
    });
    if (String(lock[0]?.acquired) !== "1") throw new Error("MIGRATION_LOCK_UNAVAILABLE");
    const [baseline] = await connection.query<RowDataPacket[]>({
      sql: "SELECT VERSION() AS version, @@default_storage_engine AS engine, @@character_set_database AS charsetName, @@collation_database AS collationName, @@session.sql_mode AS sqlMode, @@session.time_zone AS timezone, @@session.transaction_isolation AS isolationLevel",
      timeout: 1000,
    });
    const row = baseline[0];
    if (
      !row ||
      row.version !== expectedMysqlVersion ||
      row.engine !== "InnoDB" ||
      row.charsetName !== "utf8mb4" ||
      row.collationName !== "utf8mb4_0900_ai_ci" ||
      row.timezone !== "+00:00" ||
      row.isolationLevel !== "REPEATABLE-READ" ||
      !requiredSqlModes.every((mode) => String(row.sqlMode).split(",").includes(mode))
    ) {
      throw new Error("MIGRATION_BASELINE_MISMATCH");
    }
    await connection.query({ sql: "SET SESSION autocommit = 1", timeout: 1000 });
    await connection.query({
      sql: "CREATE TABLE IF NOT EXISTS _vtc_migrations (version BIGINT NOT NULL PRIMARY KEY, hash BINARY(64) NOT NULL, state ENUM('applying','applied') NOT NULL, started_at DATETIME(3) NOT NULL, applied_at DATETIME(3) NULL) ENGINE=InnoDB",
      timeout: statementTimeout,
    });
    const [history] = await connection.query<RowDataPacket[]>({
      sql: "SELECT version, hash, state FROM _vtc_migrations ORDER BY version",
      timeout: 1000,
    });
    for (const [index, applied] of history.entries()) {
      const expected = migrations[index];
      if (
        !expected ||
        String(applied.version) !== String(expected.folderMillis) ||
        !Buffer.isBuffer(applied.hash) ||
        applied.hash.toString("ascii") !== expected.hash
      ) {
        throw new Error("MIGRATION_HISTORY_DRIFT");
      }
      if (applied.state !== "applied") throw new Error("MIGRATION_RECOVERY_REQUIRED");
    }
    let count = 0;
    for (const migration of migrations.slice(history.length)) {
      await connection.query({
        sql: "INSERT INTO _vtc_migrations (version, hash, state, started_at) VALUES (?, ?, 'applying', UTC_TIMESTAMP(3))",
        values: [String(migration.folderMillis), Buffer.from(migration.hash, "ascii")],
        timeout: 1000,
      });
      for (const statement of migration.sql) {
        if (statement.trim()) await connection.query({ sql: statement, timeout: statementTimeout });
      }
      await connection.query({
        sql: "UPDATE _vtc_migrations SET state = 'applied', applied_at = UTC_TIMESTAMP(3) WHERE version = ? AND state = 'applying'",
        values: [String(migration.folderMillis)],
        timeout: 1000,
      });
      count++;
    }
    return count;
  } finally {
    // This single-purpose connection owns the lock for its entire lifetime. Never queue
    // RELEASE_LOCK after a timed-out command: mysql2 can leave that command active and
    // a queued cleanup query's own timer will not start. Force-close locally instead;
    // MySQL releases the lock when it processes the disconnect (possibly after DDL ends).
    discard(connection);
  }
}
