import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { runMigrations } from "@vtc/db";
import type { RowDataPacket } from "mysql2/promise";
import { fixtureRoot, guardedSettings, hasCode, reset, testConnection } from "./support.ts";

test("separate disposable partial-DDL and consistent-baseline recovery rehearsal", {
  timeout: 20000,
}, async () => {
  const settings = guardedSettings();
  const connection = await testConnection();
  try {
    await reset(connection);
    const failedFolder = join(fixtureRoot, "partial");
    await assert.rejects(
      runMigrations(settings, { folder: failedFolder }),
      hasCode("ER_NO_SUCH_TABLE"),
    );
    const [tables] = await connection.query<RowDataPacket[]>(
      "SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'synthetic_recovery_kept'",
    );
    assert.equal(tables[0]?.ENGINE, "InnoDB", "earlier DDL survived the later failure");
    const [history] = await connection.query<RowDataPacket[]>(
      "SELECT state, applied_at FROM _vtc_migrations",
    );
    assert.equal(history[0]?.state, "applying");
    assert.equal(history[0]?.applied_at, null);
    // The failed runner released its lock; the next runner fails on dirty state, not lock timeout.
    await assert.rejects(
      runMigrations(settings, { folder: failedFolder, lockTimeoutSeconds: 0 }),
      /MIGRATION_RECOVERY_REQUIRED/,
    );
    const [unchanged] = await connection.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS count FROM _vtc_migrations",
    );
    assert.equal(String(unchanged[0]?.count), "1");

    // This fixture's complete pre-deployment baseline was an empty schema. Restore ONLY
    // that synthetic baseline, including its journal. Real recovery requires a consistent
    // database/evidence backup or reviewed forward repair, never these fixture drops.
    await reset(connection);
    const [empty] = await connection.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS count FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()",
    );
    assert.equal(String(empty[0]?.count), "0");
    assert.equal(await runMigrations(settings), 1);
    assert.equal(await runMigrations(settings), 0);
    const [recovered] = await connection.query<RowDataPacket[]>(
      "SELECT state, applied_at FROM _vtc_migrations",
    );
    assert.equal(recovered[0]?.state, "applied");
    assert.ok(recovered[0]?.applied_at);
  } finally {
    await connection.end();
  }
});
