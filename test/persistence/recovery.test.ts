import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { databaseFailureContext, migrationFolder, migrationLockName, runMigrations } from "@vtc/db";
import type { RowDataPacket } from "mysql2/promise";
import { bounded, until } from "../support/concurrency.ts";
import { journalAckGate } from "./journal-ack-gate.ts";
import {
  decisionsPriorFolder,
  fixtureRoot,
  guardedSettings,
  hasCode,
  manualPriorFolder,
  reconciliationPriorFolder,
  reset,
  SCHEMA_SETUP_TIMEOUT_MS,
  testConnection,
} from "./support.ts";

let recoveryRunning = false;

async function reconciliationPhase<T>(
  scenario: "sticky_ddl" | "baseline_restore",
  phase:
    | "connection"
    | "reset"
    | "prefix_fixture"
    | "prefix_migration"
    | "partial_fixture"
    | "partial_migration"
    | "sticky_inspection"
    | "dirty_replay"
    | "full_migration"
    | "clean_replay"
    | "cleanup",
  command: () => Promise<T>,
): Promise<T> {
  const started = performance.now();
  const record = (state: "started" | "success" | "failed") =>
    console.log(
      JSON.stringify({
        event: "recovery_fixture_phase",
        category: "reconciliation_recovery",
        scenario,
        phase,
        state,
        durationMs: Math.round(performance.now() - started),
      }),
    );
  record("started");
  try {
    const result = await command();
    record("success");
    return result;
  } catch (error) {
    record("failed");
    throw error;
  }
}

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
      assert.equal(await runMigrations(settings), 15);
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
      assert.equal(await runMigrations(settings), 15);
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

await recoveryTest(
  "actual manual migration partial DDL is sticky and preserves legacy audit evidence until a controlled restore",
  async () => {
    const connection = await testConnection(),
      settings = guardedSettings();
    let folder: string | undefined;
    try {
      await reset(connection);
      folder = await manualPriorFolder();
      assert.equal(await runMigrations(settings, { folder }), 12);
      await connection.query(
        "INSERT INTO audit_entries(id,actor_kind,actor_id,operation,subject_kind,subject_id,occurred_at,reason,company_id) VALUES ('02500000-0000-4000-8000-000000000001','system',NULL,'configuration.changed','company','02500000-0000-4000-8000-000000000002','2026-01-01 00:00:00.000','operator_request',NULL)",
      );
      const journal = JSON.parse(
        await readFile(join(migrationFolder, "meta/_journal.json"), "utf8"),
      );
      journal.entries = journal.entries.slice(0, 13);
      const entry = journal.entries.at(-1);
      assert.equal(entry.idx, 12);
      const sql = await readFile(join(migrationFolder, `${entry.tag}.sql`), "utf8");
      const marker = sql
        .split("--> statement-breakpoint")
        .find((statement) => statement.includes("ADD CONSTRAINT `trip_origin_individual_pin_fk`"))
        ?.trim();
      assert.ok(marker);
      assert.ok(sql.includes(marker));
      await writeFile(
        join(folder, `${entry.tag}.sql`),
        sql.replace(
          marker,
          `${marker}\n--> statement-breakpoint\nALTER TABLE synthetic_manual_missing ADD COLUMN fault INT;`,
        ),
      );
      await writeFile(join(folder, "meta/_journal.json"), JSON.stringify(journal));
      await assert.rejects(runMigrations(settings, { folder }), hasCode("ER_NO_SUCH_TABLE"));
      const [checks] = await connection.query<RowDataPacket[]>(
        "SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME='trip_fact_origin_shape'",
      );
      assert.equal(checks.length, 1);
      const [addedPin] = await connection.query<RowDataPacket[]>(
        "SELECT CONSTRAINT_NAME FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME='trip_origin_individual_pin_fk'",
      );
      assert.equal(addedPin.length, 1);
      const [legacy] = await connection.query<RowDataPacket[]>(
        "SELECT CONSTRAINT_NAME FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME='trip_fact_origin_pin_fk'",
      );
      assert.equal(legacy.length, 1);
      const [history] = await connection.query<RowDataPacket[]>(
        "SELECT state FROM _vtc_migrations ORDER BY version",
      );
      assert.equal(history.length, 13);
      assert.equal(history.at(-1)?.state, "applying");
      const [sentinel] = await connection.query<RowDataPacket[]>(
        "SELECT COUNT(*) n FROM audit_entries WHERE id='02500000-0000-4000-8000-000000000001'",
      );
      assert.equal(Number(sentinel[0]?.n), 1);
      await assert.rejects(
        runMigrations(settings, { folder, lockTimeoutSeconds: 0 }),
        /MIGRATION_RECOVERY_REQUIRED/,
      );
    } finally {
      await connection.end();
      if (folder) await rm(folder, { recursive: true, force: true });
    }
  },
);
await recoveryTest(
  "manual partial-DDL recovery restores the known synthetic baseline and applies full strict schema",
  async () => {
    const connection = await testConnection();
    try {
      // Empty is this disposable fixture's consistent pre-deployment baseline. The
      // interrupted schema is never replayed or stamped as applied.
      await reset(connection);
      assert.equal(await runMigrations(guardedSettings()), 15);
      assert.equal(await runMigrations(guardedSettings()), 0);
      const [checks] = await connection.query<RowDataPacket[]>(
        "SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME IN ('trip_fact_origin_shape','trip_fact_destination_shape','trip_fact_cargo_shape','trip_fact_adr_shape')",
      );
      assert.equal(checks.length, 4);
      const [foreign] = await connection.query<RowDataPacket[]>(
        "SELECT CONSTRAINT_NAME FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME IN ('manual_report_current_revision_fk','manual_ref_report_revision_fk','manual_ref_report_trip_fk')",
      );
      assert.equal(foreign.length, 3);
    } finally {
      await connection.end();
    }
  },
);

await recoveryTest(
  "reconciliation partial DDL remains sticky and preserves the interrupted alias column",
  async () => {
    const connection = await reconciliationPhase("sticky_ddl", "connection", testConnection),
      settings = guardedSettings();
    let folder: string | undefined;
    try {
      await reconciliationPhase("sticky_ddl", "reset", () => reset(connection));
      folder = await reconciliationPhase("sticky_ddl", "prefix_fixture", reconciliationPriorFolder);
      const priorFolder = folder;
      await reconciliationPhase("sticky_ddl", "prefix_migration", async () => {
        assert.equal(await runMigrations(settings, { folder: priorFolder }), 13);
      });
      await reconciliationPhase("sticky_ddl", "partial_fixture", async () => {
        const journal = JSON.parse(
            await readFile(join(migrationFolder, "meta/_journal.json"), "utf8"),
          ),
          entry = journal.entries.at(-1);
        assert.equal(entry.idx, 13);
        const original = await readFile(join(migrationFolder, `${entry.tag}.sql`), "utf8");
        const marker = "ALTER TABLE `trips` ADD `alias_of` binary(36);";
        assert.ok(original.includes(marker));
        await writeFile(
          join(priorFolder, `${entry.tag}.sql`),
          original.replace(
            marker,
            `${marker}\n--> statement-breakpoint\nALTER TABLE synthetic_reconciliation_missing ADD COLUMN fault INT;`,
          ),
        );
        await writeFile(join(priorFolder, "meta/_journal.json"), JSON.stringify(journal));
      });
      await reconciliationPhase("sticky_ddl", "partial_migration", async () => {
        await assert.rejects(
          runMigrations(settings, { folder: priorFolder }),
          hasCode("ER_NO_SUCH_TABLE"),
        );
      });
      await reconciliationPhase("sticky_ddl", "sticky_inspection", async () => {
        const [history] = await connection.query<RowDataPacket[]>(
          "SELECT state FROM _vtc_migrations ORDER BY version",
        );
        assert.equal(history.length, 14);
        assert.equal(history.at(-1)?.state, "applying");
        const [columns] = await connection.query<RowDataPacket[]>(
          "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='trips' AND COLUMN_NAME='alias_of'",
        );
        assert.equal(columns.length, 1);
      });
      await reconciliationPhase("sticky_ddl", "dirty_replay", async () => {
        await assert.rejects(
          runMigrations(settings, { folder: priorFolder, lockTimeoutSeconds: 0 }),
          /MIGRATION_RECOVERY_REQUIRED/,
        );
      });
    } finally {
      await reconciliationPhase("sticky_ddl", "cleanup", async () => {
        try {
          await connection.end();
        } finally {
          if (folder) await rm(folder, { recursive: true, force: true });
        }
      });
    }
  },
);
await recoveryTest(
  "reconciliation partial-DDL recovery restores the known synthetic baseline and full schema",
  async () => {
    const connection = await reconciliationPhase("baseline_restore", "connection", testConnection),
      settings = guardedSettings();
    try {
      // Restore only this disposable fixture's known empty baseline; never stamp dirty history.
      await reconciliationPhase("baseline_restore", "reset", () => reset(connection));
      await reconciliationPhase("baseline_restore", "full_migration", async () => {
        assert.equal(await runMigrations(settings), 15);
      });
      await reconciliationPhase("baseline_restore", "clean_replay", async () => {
        assert.equal(await runMigrations(settings), 0);
      });
    } finally {
      await reconciliationPhase("baseline_restore", "cleanup", () => connection.end());
    }
  },
);

await recoveryTest(
  "trip decision DDL failure remains sticky after retained fact-shape alteration",
  async () => {
    const connection = await testConnection(),
      settings = guardedSettings();
    let folder: string | undefined;
    try {
      await reset(connection);
      folder = await decisionsPriorFolder();
      assert.equal(await runMigrations(settings, { folder }), 14);
      const journal = JSON.parse(
          await readFile(join(migrationFolder, "meta/_journal.json"), "utf8"),
        ),
        entry = journal.entries.at(-1);
      assert.equal(entry.idx, 14);
      const source = await readFile(join(migrationFolder, `${entry.tag}.sql`), "utf8");
      await writeFile(
        join(folder, `${entry.tag}.sql`),
        source +
          "\n--> statement-breakpoint\nALTER TABLE synthetic_decision_missing ADD COLUMN fault INT;\n",
      );
      await writeFile(join(folder, "meta/_journal.json"), JSON.stringify(journal));
      await assert.rejects(runMigrations(settings, { folder }), hasCode("ER_NO_SUCH_TABLE"));
      const [columns] = await connection.query<RowDataPacket[]>(
        "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='trip_facts' AND COLUMN_NAME='resolution_revision_id'",
      );
      assert.equal(columns.length, 1);
      const [history] = await connection.query<RowDataPacket[]>(
        "SELECT state FROM _vtc_migrations ORDER BY version DESC LIMIT 1",
      );
      assert.equal(history[0]?.state, "applying");
      await assert.rejects(runMigrations(settings, { folder }), /MIGRATION_RECOVERY_REQUIRED/);
    } finally {
      await connection.end();
      if (folder) await rm(folder, { recursive: true });
    }
  },
);
await recoveryTest(
  "trip decision partial-DDL recovery reconstructs only the known disposable baseline",
  async () => {
    const connection = await testConnection();
    try {
      await reset(connection);
      assert.equal(await runMigrations(guardedSettings()), 15);
      assert.equal(await runMigrations(guardedSettings()), 0);
    } finally {
      await connection.end();
    }
  },
);
