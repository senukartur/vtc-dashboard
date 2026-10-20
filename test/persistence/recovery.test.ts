import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { databaseFailureContext, migrationLockName, runMigrations } from "@vtc/db";
import type { RowDataPacket } from "mysql2/promise";
import { bounded, until } from "../support/concurrency.ts";
import { journalAckGate } from "./journal-ack-gate.ts";
import {
  fixtureRoot,
  guardedSettings,
  hasCode,
  reset,
  SCHEMA_SETUP_TIMEOUT_MS,
  testConnection,
} from "./support.ts";

let recoveryRunning = false;

async function recoveryTest(name: string, command: () => Promise<void>) {
  await test(name, { timeout: SCHEMA_SETUP_TIMEOUT_MS, concurrency: false }, async () => {
    // Framework timeout does not cancel the callback or its connection cleanup.
    assert.equal(recoveryRunning, false, "RECOVERY_FIXTURE_CLEANUP_REQUIRED");
    recoveryRunning = true;
    try {
      await command();
    } finally {
      recoveryRunning = false;
    }
  });
}

await recoveryTest(
  "separate disposable partial-DDL and consistent-baseline recovery rehearsal",
  async () => {
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
      assert.equal(await runMigrations(settings), 9);
      assert.equal(await runMigrations(settings), 0);
      const [recovered] = await connection.query<RowDataPacket[]>(
        "SELECT state, applied_at FROM _vtc_migrations",
      );
      assert.equal(recovered[0]?.state, "applied");
      assert.ok(recovered[0]?.applied_at);
    } finally {
      await connection.end();
    }
  },
);

await recoveryTest(
  "real MySQL migration timeout rejects promptly and preserves dirty state despite server disconnect lag",
  async () => {
    const settings = guardedSettings();
    const connection = await testConnection();
    try {
      await reset(connection);
      const folder = join(fixtureRoot, "slow");
      const started = Date.now();
      await assert.rejects(
        runMigrations(settings, { folder, statementTimeoutMs: 100 }),
        (error) => {
          assert.equal(hasCode("PROTOCOL_SEQUENCE_TIMEOUT")(error), true);
          assert.equal(databaseFailureContext(error)?.operation, "migration_statement");
          assert.equal(databaseFailureContext(error)?.wireDeadlineMs, 100);
          return true;
        },
      );
      assert.ok(
        Date.now() - started < 1500,
        "local rejection must not await queued cleanup or server SLEEP",
      );
      const [history] = await connection.query<RowDataPacket[]>(
        "SELECT state, applied_at FROM _vtc_migrations",
      );
      assert.equal(history[0]?.state, "applying");
      assert.equal(history[0]?.applied_at, null);
      const [tables] = await connection.query<RowDataPacket[]>(
        "SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'synthetic_recovery_kept'",
      );
      assert.equal(tables[0]?.ENGINE, "InnoDB");
      // The server may finish SLEEP before noticing disconnect/releasing the named lock.
      // A cooperating retry waits within its bound, then stops on the preserved dirty state.
      await assert.rejects(
        runMigrations(settings, { folder, lockTimeoutSeconds: 3 }),
        /MIGRATION_RECOVERY_REQUIRED/,
      );
      const [unchanged] = await connection.query<RowDataPacket[]>(
        "SELECT state, applied_at FROM _vtc_migrations",
      );
      assert.equal(unchanged[0]?.state, "applying");
      assert.equal(unchanged[0]?.applied_at, null);
      await reset(connection);
      assert.equal(await runMigrations(settings), 9);
      assert.equal(await runMigrations(settings), 0);
    } finally {
      await connection.end();
    }
  },
);

for (const target of ["insert", "finalize"] as const) {
  await recoveryTest(
    `real committed journal ${target} survives a withheld acknowledgement`,
    async () => {
      const settings = guardedSettings();
      const connection = await testConnection();
      let gate: Awaited<ReturnType<typeof journalAckGate>> | undefined;
      let pending: Promise<{ applied: number } | { error: unknown }> | undefined;
      try {
        await reset(connection);
        const folder = join(fixtureRoot, "prior");
        gate = await journalAckGate(target);
        const started = performance.now();
        // Observe rejection immediately, while an independent connection checks durable state.
        pending = runMigrations(gate.settings, { folder }).then(
          (applied) => ({ applied }),
          (error: unknown) => ({ error }),
        );
        await bounded(gate.withheld, "journal_ack_gate", 10000);
        assert.equal(gate.facts.okPackets, 1, "withheld response is a genuine MySQL OK packet");
        const [history] = await connection.query<RowDataPacket[]>(
          "SELECT state, applied_at FROM _vtc_migrations",
        );
        assert.equal(history.length, 1);
        assert.equal(history[0]?.state, target === "insert" ? "applying" : "applied");
        if (target === "insert") assert.equal(history[0]?.applied_at, null);
        else assert.ok(history[0]?.applied_at);
        const [tables] = await connection.query<RowDataPacket[]>(
          "SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'synthetic_parent'",
        );
        assert.equal(tables.length, target === "insert" ? 0 : 1);
        if (target === "finalize") assert.equal(tables[0]?.ENGINE, "InnoDB");
        const [lock] = await connection.query<RowDataPacket[]>("SELECT IS_USED_LOCK(?) AS owner", [
          migrationLockName(settings.database),
        ]);
        assert.ok(lock[0]?.owner, "runner still owns its migration lock while ACK is withheld");
        const result = await pending;
        assert.ok("error" in result, "WITHHELD_JOURNAL_RECEIPT_MUST_NOT_SUCCEED");
        const error = result.error;
        assert.equal(hasCode("PROTOCOL_SEQUENCE_TIMEOUT")(error), true);
        const context = databaseFailureContext(error);
        assert.equal(context?.operation, `migration_journal_${target}`);
        assert.equal(context?.wireDeadlineMs, 5000);
        assert.ok((context?.elapsedMs ?? 0) >= 4500);
        assert.ok(performance.now() - started >= 4500);
        assert.ok(performance.now() - started < 7000);
        await until(async () => {
          const [rows] = await connection.query<RowDataPacket[]>(
            "SELECT IS_USED_LOCK(?) AS owner",
            [migrationLockName(settings.database)],
          );
          return rows[0]?.owner === null && gate?.activeSockets() === 0;
        });
        assert.equal(gate.facts.ends, 1, "runner disposed transport before gate teardown");
        assert.ok(
          gate.facts.queryAttributeEnvelopes > 0,
          "negotiated zero-attribute queries decoded",
        );
        assert.equal(gate.facts.unsupportedEnvelopes, 0);
        assert.equal(gate.facts.inserts, 1);
        assert.equal(gate.facts.finalizations, target === "insert" ? 0 : 1);
        assert.equal(gate.facts.statements, target === "insert" ? 0 : 1);
        assert.equal(gate.facts.releases, 0, "no queued lock cleanup");
        if (target === "insert")
          await assert.rejects(
            runMigrations(settings, { folder, lockTimeoutSeconds: 0 }),
            /MIGRATION_RECOVERY_REQUIRED/,
          );
        else assert.equal(await runMigrations(settings, { folder, lockTimeoutSeconds: 0 }), 0);
        const [unchanged] = await connection.query<RowDataPacket[]>(
          "SELECT state, applied_at FROM _vtc_migrations",
        );
        assert.deepEqual(
          unchanged,
          history,
          "later locked inspection never rewrites uncertain history",
        );
      } finally {
        try {
          await gate?.close();
        } finally {
          try {
            await pending;
          } finally {
            await connection.end();
          }
        }
      }
    },
  );
}
