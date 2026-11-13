import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { databaseFailureContext, migrationFolder, migrationLockName, runMigrations } from "@vtc/db";
import type { Connection, RowDataPacket } from "mysql2/promise";
import { bounded, until } from "../support/concurrency.ts";
import { journalAckGate } from "./journal-ack-gate.ts";
import {
  analyticsPriorFolder,
  catalogTimestampsPriorFolder,
  companyCatalogsPriorFolder,
  decisionsPriorFolder,
  EXTENDED_TEST_TIMEOUT_MS,
  eventStage2PriorFolder,
  fixtureRoot,
  guardedSettings,
  hasCode,
  manualDraftDiscardPriorFolder,
  manualPriorFolder,
  manualReferencePriorFolder,
  notificationMaterialPriorFolder,
  notificationsPriorFolder,
  qualificationEligibilityPriorFolder,
  qualificationRuleEditingPriorFolder,
  reconciliationPriorFolder,
  reset,
  reviewQueuePriorFolder,
  SCHEMA_SETUP_TIMEOUT_MS,
  simpleCatalogsPriorFolder,
  stage3PriorFolder,
  testConnection,
  tripNumberPriorFolder,
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

async function recoveryTest(
  name: string,
  command: () => Promise<void>,
  timeout = EXTENDED_TEST_TIMEOUT_MS,
) {
  await test(name, { timeout, concurrency: false }, async () => {
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
      assert.equal(await runMigrations(settings), 31);
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
  SCHEMA_SETUP_TIMEOUT_MS,
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
      assert.equal(await runMigrations(settings), 31);
      assert.equal(await runMigrations(settings), 0);
    } finally {
      await connection.end();
    }
  },
  SCHEMA_SETUP_TIMEOUT_MS,
);

for (const target of ["insert", "finalize"] as const) {
  await recoveryTest(
    `real committed journal ${target} survives a withheld acknowledgement`,
    async () => {
      const settings = guardedSettings();
      const connection = await testConnection();
      let gate: Awaited<ReturnType<typeof journalAckGate>> | undefined;
      let pending:
        | Promise<({ applied: number } | { error: unknown }) & { settledAt: number }>
        | undefined;
      try {
        await reset(connection);
        const folder = join(fixtureRoot, "prior");
        gate = await journalAckGate(target);
        // Measure settlement while the observer checks durable state on its own connection.
        pending = runMigrations(gate.settings, { folder }).then(
          (applied) => ({ applied, settledAt: performance.now() }),
          (error: unknown) => ({ error, settledAt: performance.now() }),
        );
        const withheldAt = await bounded(
          gate.withheld.then(() => performance.now()),
          "journal_ack_gate",
          10000,
        );
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
        const nativeElapsedMs = context?.elapsedMs;
        assert.ok(
          nativeElapsedMs !== undefined && nativeElapsedMs >= 4500 && nativeElapsedMs < 7000,
        );
        const settlementMs = result.settledAt - withheldAt;
        assert.ok(settlementMs >= 0 && settlementMs < 7000);
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
      assert.equal(await runMigrations(guardedSettings()), 31);
      assert.equal(await runMigrations(guardedSettings()), 0);
      const [checks] = await connection.query<RowDataPacket[]>(
        "SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME IN ('trip_fact_adr_requires_cargo','trip_trailer_shape')",
      );
      assert.equal(checks.length, 2);
      const [foreign] = await connection.query<RowDataPacket[]>(
        "SELECT CONSTRAINT_NAME FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME IN ('manual_report_current_revision_fk','manual_ref_report_revision_fk','manual_ref_report_trip_fk')",
      );
      assert.equal(foreign.length, 3);
    } finally {
      await connection.end();
    }
  },
  SCHEMA_SETUP_TIMEOUT_MS,
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
          entry = journal.entries.find((candidate: { idx: number }) => candidate.idx === 13);
        assert.equal(entry?.tag, "0013_modern_moon_knight");
        assert.equal(entry.idx, 13);
        journal.entries = journal.entries.filter(
          (candidate: { idx: number }) => candidate.idx <= 13,
        );
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
        assert.equal(await runMigrations(settings), 31);
      });
      await reconciliationPhase("baseline_restore", "clean_replay", async () => {
        assert.equal(await runMigrations(settings), 0);
      });
    } finally {
      await reconciliationPhase("baseline_restore", "cleanup", () => connection.end());
    }
  },
  SCHEMA_SETUP_TIMEOUT_MS,
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
      );
      journal.entries = journal.entries.filter((candidate: { idx: number }) => candidate.idx <= 14);
      const entry = journal.entries.at(-1);
      assert.equal(entry?.idx, 14);
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
  SCHEMA_SETUP_TIMEOUT_MS,
);
await recoveryTest(
  "trip decision partial-DDL recovery reconstructs only the known disposable baseline",
  async () => {
    const connection = await testConnection();
    try {
      await reset(connection);
      assert.equal(await runMigrations(guardedSettings()), 31);
      assert.equal(await runMigrations(guardedSettings()), 0);
    } finally {
      await connection.end();
    }
  },
  SCHEMA_SETUP_TIMEOUT_MS,
);

await recoveryTest(
  "analytics migration DDL failure remains sticky after retained column addition",
  async () => {
    const connection = await testConnection(),
      settings = guardedSettings();
    let folder: string | undefined;
    try {
      await reset(connection);
      folder = await analyticsPriorFolder();
      assert.equal(await runMigrations(settings, { folder }), 15);
      const journal = JSON.parse(
        await readFile(join(migrationFolder, "meta/_journal.json"), "utf8"),
      );
      journal.entries = journal.entries.filter((candidate: { idx: number }) => candidate.idx <= 15);
      const entry = journal.entries.at(-1);
      assert.equal(entry?.idx, 15);
      const source = await readFile(join(migrationFolder, `${entry.tag}.sql`), "utf8");
      await writeFile(
        join(folder, `${entry.tag}.sql`),
        source +
          "\n--> statement-breakpoint\nALTER TABLE synthetic_analytics_missing ADD COLUMN fault INT;\n",
      );
      await writeFile(join(folder, "meta/_journal.json"), JSON.stringify(journal));
      await assert.rejects(runMigrations(settings, { folder }), hasCode("ER_NO_SUCH_TABLE"));
      const [columns] = await connection.query<RowDataPacket[]>(
        "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='identity_company' AND COLUMN_NAME='reporting_timezone'",
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
  SCHEMA_SETUP_TIMEOUT_MS,
);
await recoveryTest(
  "analytics partial-DDL recovery reconstructs only the known disposable baseline",
  async () => {
    const connection = await testConnection();
    try {
      await reset(connection);
      assert.equal(await runMigrations(guardedSettings()), 31);
      assert.equal(await runMigrations(guardedSettings()), 0);
    } finally {
      await connection.end();
    }
  },
  SCHEMA_SETUP_TIMEOUT_MS,
);

await recoveryTest(
  "notification table/index partial DDL remains sticky and cannot silently replay",
  async () => {
    const connection = await testConnection(),
      settings = guardedSettings();
    let folder: string | undefined;
    try {
      await reset(connection);
      folder = await notificationsPriorFolder();
      assert.equal(await runMigrations(settings, { folder }), 16);
      const journal = JSON.parse(
        await readFile(join(migrationFolder, "meta/_journal.json"), "utf8"),
      );
      journal.entries = journal.entries.slice(0, 17);
      const entry = journal.entries.at(-1);
      assert.equal(entry?.idx, 16);
      const source = await readFile(join(migrationFolder, `${entry.tag}.sql`), "utf8");
      await writeFile(
        join(folder, `${entry.tag}.sql`),
        `${source}\n--> statement-breakpoint\nALTER TABLE synthetic_notifications_missing ADD COLUMN fault INT;\n`,
      );
      await writeFile(join(folder, "meta/_journal.json"), JSON.stringify(journal));
      await assert.rejects(runMigrations(settings, { folder }), hasCode("ER_NO_SUCH_TABLE"));
      const [tables] = await connection.query<RowDataPacket[]>(
        "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('outbox_routing','outbox_routing_scans','notifications','notification_recipients','notification_commands')",
      );
      assert.equal(tables.length, 5);
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
  SCHEMA_SETUP_TIMEOUT_MS,
);
await recoveryTest(
  "notification recovery restores the disposable baseline and replayable full schema",
  async () => {
    const connection = await testConnection();
    try {
      await reset(connection);
      assert.equal(await runMigrations(guardedSettings()), 31);
      assert.equal(await runMigrations(guardedSettings()), 0);
    } finally {
      await connection.end();
    }
  },
  SCHEMA_SETUP_TIMEOUT_MS,
);

await recoveryTest(
  "material prefix partial DDL preserves the seventeen-entry history and remains sticky",
  async () => {
    const connection = await testConnection(),
      settings = guardedSettings();
    let folder: string | undefined;
    try {
      await reset(connection);
      folder = await notificationMaterialPriorFolder();
      assert.equal(await runMigrations(settings, { folder }), 17);
      await connection.query(
        "INSERT INTO audit_entries(id,actor_kind,actor_id,operation,subject_kind,subject_id,occurred_at,reason,company_id) VALUES ('03600000-0000-4000-8000-000000000017','system',NULL,'configuration.changed','company','03600000-0000-4000-8000-000000000001','2026-01-01 00:00:00.000','operator_request',NULL)",
      );
      const [before] = await connection.query<RowDataPacket[]>(
        "SELECT version,hash,state,started_at,applied_at FROM _vtc_migrations ORDER BY version",
      );
      const journal = JSON.parse(
        await readFile(join(migrationFolder, "meta/_journal.json"), "utf8"),
      );
      journal.entries = journal.entries.slice(0, 18);
      const entry = journal.entries.at(-1);
      assert.equal(entry.idx, 17);
      assert.equal(entry.tag, "0017_event_notification_material");
      const source = await readFile(join(migrationFolder, `${entry.tag}.sql`), "utf8"),
        first = source.split("--> statement-breakpoint")[0];
      assert.ok(first);
      assert.ok(first.includes("ADD `notification_material` json"));
      await writeFile(
        join(folder, `${entry.tag}.sql`),
        `${first}\n--> statement-breakpoint\nALTER TABLE synthetic_material_missing ADD COLUMN fault INT;\n`,
      );
      await writeFile(join(folder, "meta/_journal.json"), JSON.stringify(journal));
      await assert.rejects(runMigrations(settings, { folder }), hasCode("ER_NO_SUCH_TABLE"));
      const [columns] = await connection.query<RowDataPacket[]>(
        "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='events' AND COLUMN_NAME IN ('notification_material','notification_material_pending') ORDER BY COLUMN_NAME",
      );
      assert.deepEqual(
        columns.map((r) => r.COLUMN_NAME),
        ["notification_material"],
      );
      const [retained] = await connection.query<RowDataPacket[]>(
        "SELECT version,hash,state,started_at,applied_at FROM _vtc_migrations ORDER BY version LIMIT 17",
      );
      assert.deepEqual(retained, before);
      const [dirty] = await connection.query<RowDataPacket[]>(
        "SELECT state,applied_at FROM _vtc_migrations ORDER BY version DESC LIMIT 1",
      );
      assert.equal(dirty[0]?.state, "applying");
      assert.equal(dirty[0]?.applied_at, null);
      const [sentinel] = await connection.query<RowDataPacket[]>(
        "SELECT COUNT(*) n FROM audit_entries WHERE id='03600000-0000-4000-8000-000000000017'",
      );
      assert.equal(Number(sentinel[0]?.n), 1);
      await assert.rejects(
        runMigrations(settings, { folder, lockTimeoutSeconds: 0 }),
        /MIGRATION_RECOVERY_REQUIRED/,
      );
    } finally {
      await connection.end();
      if (folder) await rm(folder, { recursive: true });
    }
  },
  SCHEMA_SETUP_TIMEOUT_MS,
);

await recoveryTest(
  "material recovery reconstructs the known empty disposable baseline and complete generated index",
  async () => {
    const connection = await testConnection(),
      settings = guardedSettings();
    try {
      // Empty is the consistent pre-deployment baseline for this independent owned recovery fixture.
      // This is not a live backup/restore procedure and never stamps or replays the partial schema.
      await reset(connection);
      assert.equal(await runMigrations(settings), 31);
      assert.equal(await runMigrations(settings), 0);
      const [columns] = await connection.query<RowDataPacket[]>(
        "SELECT COLUMN_NAME,EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='events' AND COLUMN_NAME IN ('notification_material','notification_material_pending') ORDER BY COLUMN_NAME",
      );
      assert.equal(columns.length, 2);
      assert.ok(String(columns[1]?.EXTRA).includes("VIRTUAL GENERATED"));
      const [index] = await connection.query<RowDataPacket[]>(
        "SELECT COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='events' AND INDEX_NAME='event_notification_material_pending' ORDER BY SEQ_IN_INDEX",
      );
      assert.deepEqual(
        index.map((r) => r.COLUMN_NAME),
        ["notification_material_pending", "id"],
      );
    } finally {
      await connection.end();
    }
  },
  SCHEMA_SETUP_TIMEOUT_MS,
);

await recoveryTest(
  "material migration committed finalization survives an unknown acknowledgement without rewriting history",
  async () => {
    const settings = guardedSettings(),
      connection = await testConnection();
    let folder: string | undefined,
      materialFolder: string | undefined,
      gate: Awaited<ReturnType<typeof journalAckGate>> | undefined;
    let pending: Promise<{ applied: number } | { error: unknown }> | undefined;
    try {
      await reset(connection);
      folder = await notificationMaterialPriorFolder();
      assert.equal(await runMigrations(settings, { folder }), 17);
      // Later migrations stay out of this fixture so the retry observes only the 0017 receipt.
      materialFolder = await reviewQueuePriorFolder();
      const [prefix] = await connection.query<RowDataPacket[]>(
        "SELECT version,hash,state,started_at,applied_at FROM _vtc_migrations ORDER BY version",
      );
      const source = await readFile(
        join(migrationFolder, "0017_event_notification_material.sql"),
        "utf8",
      );
      const statements = source
        .split("--> statement-breakpoint")
        .filter((statement) => statement.trim());
      assert.equal(statements.length, 3);
      const expected = createHash("sha256").update(source).digest("hex");
      gate = await journalAckGate("finalize", undefined, statements);
      const started = performance.now();
      pending = runMigrations(gate.settings, { folder: materialFolder }).then(
        (applied) => ({ applied }),
        (error: unknown) => ({ error }),
      );
      await bounded(gate.withheld, "material_final_ack", 10000);
      assert.equal(gate.facts.okPackets, 1);
      const [history] = await connection.query<RowDataPacket[]>(
        "SELECT version,CAST(hash AS CHAR) hash,state,started_at,applied_at FROM _vtc_migrations ORDER BY version",
      );
      assert.equal(history.length, 18);
      assert.equal(history.at(-1)?.hash, expected);
      assert.equal(history.at(-1)?.state, "applied");
      assert.ok(history.at(-1)?.applied_at);
      const [retained] = await connection.query<RowDataPacket[]>(
        "SELECT version,hash,state,started_at,applied_at FROM _vtc_migrations ORDER BY version LIMIT 17",
      );
      assert.deepEqual(retained, prefix);
      const [index] = await connection.query<RowDataPacket[]>(
        "SELECT COUNT(*) n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='events' AND INDEX_NAME='event_notification_material_pending'",
      );
      assert.equal(Number(index[0]?.n), 2);
      const result = await pending;
      assert.ok("error" in result, "UNKNOWN_MATERIAL_FINAL_ACK_MUST_NOT_SUCCEED");
      assert.ok(hasCode("PROTOCOL_SEQUENCE_TIMEOUT")(result.error));
      assert.equal(databaseFailureContext(result.error)?.operation, "migration_journal_finalize");
      assert.equal(databaseFailureContext(result.error)?.wireDeadlineMs, 5000);
      assert.ok(performance.now() - started >= 4500 && performance.now() - started < 7000);
      await until(async () => {
        const [lock] = await connection.query<RowDataPacket[]>("SELECT IS_USED_LOCK(?) owner", [
          migrationLockName(settings.database),
        ]);
        return lock[0]?.owner === null && gate?.activeSockets() === 0;
      });
      assert.equal(gate.facts.statements, 3);
      assert.equal(gate.facts.finalizations, 1);
      assert.equal(gate.facts.ends, 1);
      assert.equal(
        await runMigrations(settings, { folder: materialFolder, lockTimeoutSeconds: 0 }),
        0,
      );
      const [unchanged] = await connection.query<RowDataPacket[]>(
        "SELECT version,CAST(hash AS CHAR) hash,state,started_at,applied_at FROM _vtc_migrations ORDER BY version",
      );
      assert.deepEqual(unchanged, history);
    } finally {
      try {
        await gate?.close();
      } finally {
        try {
          await pending;
        } finally {
          await connection.end();
          if (folder) await rm(folder, { recursive: true });
          if (materialFolder) await rm(materialFolder, { recursive: true });
        }
      }
    }
  },
  SCHEMA_SETUP_TIMEOUT_MS,
);

const catalogUpgradeTime = "2026-01-01 00:00:00.000";
const catalogUpgradeId = (n: number) => `03600000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Fictional rows along every path 0019 deletes, plus rows it must retain. */
async function seedCatalogUpgradeRows(connection: Connection) {
  const id = catalogUpgradeId,
    time = catalogUpgradeTime,
    member = id(1),
    digest = "a".repeat(32);
  const insert = async (table: string, row: Record<string, unknown>) => {
    const columns = Object.keys(row);
    await connection.execute(
      `INSERT INTO ${table} (${columns.map((column) => `\`${column}\``).join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
      Object.values(row) as (string | number | null)[],
    );
  };
  await insert("identity_users", {
    id: member,
    name: "Synthetic Member",
    email: "catalog-upgrade@example.invalid",
    created_at: time,
    updated_at: time,
  });
  await insert("identity_memberships", { user_id: member, status: "active" });
  await insert("identity_company", { singleton: 1, id: id(2), director_user_id: member });
  await insert("telemetry_tokens", {
    id: id(3),
    owner_id: member,
    company_id: id(2),
    steam_id: "70000000000000000",
    access_epoch: 1,
    identity_epoch: 1,
    credential_epoch: 1,
    secret_hash: digest,
    scope: "ingest",
    label: "Synthetic token",
    created_at: time,
  });
  await insert("catalog_artifacts", {
    id: id(10),
    creator_id: member,
    sha256: digest,
    byte_length: 2,
    expires_at: time,
    created_at: time,
  });
  await insert("catalog_revisions", {
    id: id(11),
    game: "ets2",
    version: 1,
    state: "published",
    artifact_id: id(10),
    artifact_sha256: digest,
    game_build: "synthetic",
    inventory_as_of: "2026-01-01",
    synthetic: 1,
    source_manifest_sha256: digest,
    provenance: "{}",
    created_at: time,
  });
  await insert("catalog_entities", {
    id: id(12),
    game: "ets2",
    kind: "city",
    map: "synthetic",
    source_key: "city.synthetic",
  });
  await insert("catalog_facts", {
    id: id(13),
    revision_id: id(11),
    entity_id: id(12),
    game: "ets2",
    kind: "city",
    map: "synthetic",
    retired: 0,
    pack_id: "synthetic",
  });
  await insert("trips", {
    id: id(20),
    owner_id: member,
    game: "ets2",
    version: 1,
    outcome: "delivered",
    recording: "complete",
    decision: "accepted",
    review_reasons: "[]",
    created_at: time,
  });
  await insert("source_trips", {
    id: id(21),
    provider: "ets2telemetry",
    game: "ets2",
    session_key: "synthetic-session",
    trip_key: "synthetic-trip",
    owner_id: member,
    canonical_trip_id: id(20),
    latest_revision: "r1",
    connection_context: "{}",
    created_at: time,
  });
  await insert("source_messages", {
    id: id(22),
    source_trip_id: id(21),
    provider: "ets2telemetry",
    event_key: "synthetic-event",
    revision: "r1",
    sha256: digest,
    received_at: time,
    delivery_mode: "live",
  });
  await insert("source_payloads", { message_id: id(22) });
  const fact = {
    canonical_trip_id: id(20),
    adapter_version: 1,
    outcome: "delivered",
    recording: "complete",
    start_basis: "unknown",
    start_verified: 0,
    end_basis: "unknown",
    end_verified: 0,
    whole_trip_distance_supported: 0,
    trailers_complete: 1,
    trailer_count: 1,
    rule_context_complete: 0,
    reasons: "[]",
    evidence: "{}",
  };
  await insert("trip_facts", {
    ...fact,
    id: id(23),
    message_id: id(22),
    catalog_revision_id: id(11),
    origin_entity_id: id(12),
    origin_fact_id: id(13),
  });
  await insert("trip_fact_trailers", {
    trip_fact_id: id(23),
    position: 0,
    entity_id: id(12),
    catalog_fact_id: id(13),
    catalog_revision_id: id(11),
    source_field: "synthetic",
  });
  await insert("trip_resolutions", {
    id: id(24),
    trip_id: id(20),
    base_fact_id: id(23),
    author_id: member,
    changes: "{}",
    evidence_ids: "[]",
    reason: "synthetic",
    created_at: time,
  });
  await insert("trip_facts", {
    ...fact,
    id: id(25),
    kind: "derived",
    base_fact_id: id(23),
    resolution_revision_id: id(24),
    derived_source_message_id: id(22),
    trailer_count: 0,
  });
  // Published migrations already provide the level rows.
  const [levels] = await connection.query<RowDataPacket[]>(
    "SELECT id FROM qualification_levels WHERE game='ets2' AND code='trainee'",
  );
  const levelId = String(levels[0]?.id);
  await insert("qualification_rule_versions", {
    id: id(31),
    level_id: levelId,
    published_at: time,
    effective_at: time,
    rules: "{}",
    actor_id: member,
    reason: "synthetic",
  });
  await insert("trip_decisions", {
    id: id(32),
    trip_id: id(20),
    sequence: 1,
    fact_id: id(25),
    outcome: "accepted",
    reason_codes: "[]",
    attribution_basis: "staff_resolution",
    supporting_facts: "{}",
    decided_at: time,
  });
  await insert("manual_reports", {
    id: id(40),
    owner_id: member,
    trip_id: id(20),
    version: 1,
    revision_number: 1,
    created_at: time,
  });
  await insert("manual_revisions", {
    id: id(41),
    report_id: id(40),
    number: 1,
    format: "extended",
    fields: "{}",
    submitted_at: time,
  });
  await connection.execute("UPDATE manual_reports SET current_revision_id=? WHERE id=?", [
    id(41),
    id(40),
  ]);
  await insert("manual_evidence", {
    id: id(42),
    owner_id: member,
    state: "processing",
    generation: id(43),
    original_name: "synthetic.png",
    content_type: "image/png",
    created_at: time,
    updated_at: time,
    next_check_at: time,
  });
  await insert("events", {
    id: id(50),
    version: 1,
    change_sequence: 1,
    attendance_version: 1,
    game: "ets2",
    visibility: "members",
    status: "scheduled",
    starts_at: time,
    created_at: time,
  });
  await insert("event_revisions", {
    id: id(51),
    event_id: id(50),
    version: 1,
    sequence: 1,
    actor_id: member,
    recorded_at: time,
    category: "created",
    status: "scheduled",
    title: "Synthetic convoy",
    description: "Synthetic",
    game: "ets2",
    server: "Synthetic",
    organizer: "Synthetic",
    meeting_location: "Synthetic",
    route: "Synthetic",
    meeting_at: time,
    starts_at: time,
    visibility: "members",
  });
  await insert("event_catalog_pins", {
    revision_id: id(51),
    field: "origin",
    fact_id: id(13),
    entity_id: id(12),
    catalog_revision_id: id(11),
    label: "{}",
  });
  const outbox = {
    schema_version: 1,
    aggregate_kind: "synthetic",
    aggregate_version: 1,
    occurred_at: time,
    correlation_id: id(60),
    data: "{}",
    fingerprint: digest,
    recorded_at: time,
  };
  await insert("outbox_events", {
    ...outbox,
    id: id(61),
    type: "catalog.published",
    aggregate_id: id(11),
  });
  await insert("outbox_events", {
    ...outbox,
    id: id(62),
    type: "event.updated",
    aggregate_id: id(50),
  });
  const job = {
    schema_version: 1,
    consumer: "synthetic",
    reference: "{}",
    fingerprint: digest,
    state: "ready",
    available_at: time,
    attempts: 0,
    max_attempts: 3,
    created_at: time,
  };
  await insert("durable_jobs", {
    ...job,
    id: id(63),
    kind: "catalog.import",
    effect_key: "catalog",
  });
  await insert("durable_jobs", {
    ...job,
    id: id(64),
    kind: "event.reminder",
    effect_key: "reminder",
    event_id: id(62),
  });
  await insert("audit_entries", {
    id: id(70),
    actor_kind: "system",
    actor_id: null,
    operation: "configuration.changed",
    subject_kind: "company",
    subject_id: id(2),
    occurred_at: time,
    reason: "operator_request",
    company_id: null,
  });
}

const catalogUpgradeRowCount = async (connection: Connection, table: string) => {
  const [rows] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) n FROM ${table}`);
  return Number(rows[0]?.n);
};

await recoveryTest(
  "catalog replacement upgrades the published prefix, deletes old history and keeps retained rows",
  async () => {
    const connection = await testConnection();
    let folder: string | undefined;
    try {
      const settings = guardedSettings();
      await reset(connection);
      folder = await simpleCatalogsPriorFolder();
      assert.equal(await runMigrations(settings, { folder }), 19);
      await seedCatalogUpgradeRows(connection);
      assert.equal(await catalogUpgradeRowCount(connection, "catalog_facts"), 1);
      assert.equal(await runMigrations(settings), 12);
      assert.equal(await runMigrations(settings), 0);

      for (const table of [
        "trips",
        "source_trips",
        "source_messages",
        "source_payloads",
        "trip_facts",
        "trip_fact_trailers",
        "trip_resolutions",
        "trip_decisions",
        "manual_reports",
        "manual_revisions",
        "qualification_rule_versions",
      ])
        assert.equal(await catalogUpgradeRowCount(connection, table), 0, table);

      const id = catalogUpgradeId;
      const [gone] = await connection.query<RowDataPacket[]>(
        "SELECT (SELECT COUNT(*) FROM outbox_events WHERE id=?) outbox,(SELECT COUNT(*) FROM durable_jobs WHERE id=?) job",
        [id(61), id(63)],
      );
      assert.deepEqual([Number(gone[0]?.outbox), Number(gone[0]?.job)], [0, 0]);

      const [retained] = await connection.query<RowDataPacket[]>(
        "SELECT (SELECT COUNT(*) FROM identity_memberships WHERE user_id=?) member_row,(SELECT COUNT(*) FROM telemetry_tokens WHERE id=?) token,(SELECT COUNT(*) FROM manual_evidence WHERE id=?) evidence,(SELECT COUNT(*) FROM events WHERE id=?) event,(SELECT COUNT(*) FROM outbox_events WHERE id=?) outbox,(SELECT COUNT(*) FROM durable_jobs WHERE id=?) job,(SELECT COUNT(*) FROM audit_entries WHERE id=?) audit,(SELECT COUNT(*) FROM qualification_levels WHERE game='ets2' AND code='trainee') level",
        [id(1), id(3), id(42), id(50), id(62), id(64), id(70)],
      );
      assert.deepEqual(Object.values(retained[0] ?? {}).map(Number), [1, 1, 1, 1, 1, 1, 1, 1]);
      const [event] = await connection.query<RowDataPacket[]>(
        "SELECT title,origin_city_id o,destination_city_id d,prescribed_cargo_id c,prescribed_trailer_id t FROM event_revisions WHERE id=?",
        [id(51)],
      );
      assert.deepEqual(event[0], {
        title: "Synthetic convoy",
        o: null,
        d: null,
        c: null,
        t: null,
      });

      const [tables] = await connection.query<RowDataPacket[]>(
        "SELECT TABLE_NAME name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND (TABLE_NAME LIKE 'catalog\\_%' OR TABLE_NAME='event_catalog_pins') ORDER BY TABLE_NAME",
      );
      assert.deepEqual(
        tables.map((row) => row.name),
        [
          "catalog_cargoes",
          "catalog_cities",
          "catalog_companies",
          "catalog_company_cities",
          "catalog_company_logos",
          "catalog_dlcs",
          "catalog_regions",
          "catalog_trailers",
        ],
      );

      const [foreign] = await connection.query<RowDataPacket[]>(
        "SELECT CONSTRAINT_NAME name FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME IN ('trip_facts_base_fact_id_trip_facts_id_fk','trip_facts_resolution_revision_id_trip_resolutions_id_fk','manual_report_current_revision_fk','catalog_city_region_fk','catalog_city_dlc_fk','event_revision_trailer_fk')",
      );
      assert.equal(foreign.length, 6);
      const [pointer] = await connection.query<RowDataPacket[]>(
        "SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION) columns_ FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='manual_reports' AND CONSTRAINT_NAME='manual_report_current_revision_fk'",
      );
      assert.equal(pointer[0]?.columns_, "id,current_revision_id");

      await connection.execute(
        "INSERT INTO catalog_dlcs (id,game,code,name_en) VALUES (?,'ats','synthetic_pack','Synthetic pack')",
        [id(80)],
      );
      await assert.rejects(
        connection.execute(
          "INSERT INTO catalog_cities (id,game,code,name_en,dlc_id) VALUES (?,'ets2','synthetic_city','Synthetic city',?)",
          [id(81), id(80)],
        ),
        hasCode("ER_NO_REFERENCED_ROW_2"),
      );

      const [history] = await connection.query<RowDataPacket[]>(
        "SELECT state FROM _vtc_migrations ORDER BY version",
      );
      assert.equal(history.length, 31);
      assert.ok(history.every((row) => row.state === "applied"));
    } finally {
      await connection.end();
      if (folder) await rm(folder, { recursive: true });
    }
  },
  SCHEMA_SETUP_TIMEOUT_MS,
);

await recoveryTest(
  "an interrupted catalog replacement stays applying and refuses an automatic rerun",
  async () => {
    const connection = await testConnection();
    let folder: string | undefined;
    try {
      const settings = guardedSettings();
      await reset(connection);
      folder = await simpleCatalogsPriorFolder();
      assert.equal(await runMigrations(settings, { folder }), 19);
      await seedCatalogUpgradeRows(connection);
      const journal = JSON.parse(
        await readFile(join(migrationFolder, "meta/_journal.json"), "utf8"),
      );
      const entry = journal.entries[19];
      assert.equal(entry.tag, "0019_simple_catalogs");
      const source = await readFile(join(migrationFolder, `${entry.tag}.sql`), "utf8");
      const partial = source
        .split("--> statement-breakpoint")
        .slice(0, 3)
        .join("--> statement-breakpoint");
      await writeFile(
        join(folder, `${entry.tag}.sql`),
        `${partial}--> statement-breakpoint\nALTER TABLE synthetic_catalog_missing ADD COLUMN fault INT;\n`,
      );
      journal.entries = journal.entries.slice(0, 20);
      await writeFile(join(folder, "meta/_journal.json"), JSON.stringify(journal));
      await assert.rejects(runMigrations(settings, { folder }), hasCode("ER_NO_SUCH_TABLE"));
      const [history] = await connection.query<RowDataPacket[]>(
        "SELECT state,applied_at FROM _vtc_migrations ORDER BY version DESC LIMIT 1",
      );
      assert.equal(history[0]?.state, "applying");
      assert.equal(history[0]?.applied_at, null);
      // The partial DDL is visible and never stamped: only restoring the export recovers it.
      const [pointer] = await connection.query<RowDataPacket[]>(
        "SELECT COUNT(*) n FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME='trip_facts_base_fact_id_trip_facts_id_fk'",
      );
      assert.equal(Number(pointer[0]?.n), 0);
      assert.equal(await catalogUpgradeRowCount(connection, "catalog_facts"), 1);
      await assert.rejects(
        runMigrations(settings, { folder, lockTimeoutSeconds: 0 }),
        /MIGRATION_RECOVERY_REQUIRED/,
      );
    } finally {
      await connection.end();
      if (folder) await rm(folder, { recursive: true });
    }
  },
  SCHEMA_SETUP_TIMEOUT_MS,
);

await recoveryTest(
  "the company and depot migration keeps existing catalog rows and enforces same-game depots",
  async () => {
    const connection = await testConnection();
    let folder: string | undefined;
    try {
      const settings = guardedSettings();
      await reset(connection);
      folder = await companyCatalogsPriorFolder();
      assert.equal(await runMigrations(settings, { folder }), 22);
      const id = catalogUpgradeId;
      await connection.execute(
        "INSERT INTO catalog_dlcs (id,game,code,name_en) VALUES (?,'ets2','synthetic_pack','Synthetic pack')",
        [id(90)],
      );
      await connection.execute(
        "INSERT INTO catalog_cities (id,game,code,name_en,dlc_id) VALUES (?,'ets2','synthetic_city','Synthetic city',?)",
        [id(91), id(90)],
      );
      const companyCatalogs = await catalogTimestampsPriorFolder();
      try {
        assert.equal(await runMigrations(settings, { folder: companyCatalogs }), 1);
        assert.equal(await runMigrations(settings, { folder: companyCatalogs }), 0);
      } finally {
        await rm(companyCatalogs, { recursive: true });
      }
      assert.equal(await catalogUpgradeRowCount(connection, "catalog_dlcs"), 1);
      assert.equal(await catalogUpgradeRowCount(connection, "catalog_cities"), 1);
      for (const table of ["catalog_companies", "catalog_company_cities", "catalog_company_logos"])
        assert.equal(await catalogUpgradeRowCount(connection, table), 0, table);

      await connection.execute(
        "INSERT INTO catalog_companies (id,game,code,name_en) VALUES (?,'ets2','synthetic_co','Synthetic Co')",
        [id(92)],
      );
      await connection.execute(
        "INSERT INTO catalog_companies (id,game,code,name_en) VALUES (?,'ats','synthetic_co','Synthetic Co')",
        [id(93)],
      );
      await connection.execute(
        "INSERT INTO catalog_company_cities (id,game,company_id,city_id) VALUES (?,'ets2',?,?)",
        [id(94), id(92), id(91)],
      );
      await assert.rejects(
        connection.execute(
          "INSERT INTO catalog_company_cities (id,game,company_id,city_id) VALUES (?,'ats',?,?)",
          [id(95), id(93), id(91)],
        ),
        hasCode("ER_NO_REFERENCED_ROW_2"),
      );
      await assert.rejects(
        connection.execute(
          "INSERT INTO catalog_company_cities (id,game,company_id,city_id) VALUES (?,'ets2',?,?)",
          [id(96), id(92), id(91)],
        ),
        hasCode("ER_DUP_ENTRY"),
      );
      await assert.rejects(
        connection.execute(
          "INSERT INTO catalog_company_logos (company_id,png,byte_length,sha256,updated_at) VALUES (?,?,5,?,'2026-01-01 00:00:00.000')",
          [id(92), Buffer.from("abcd"), Buffer.alloc(32)],
        ),
        hasCode("ER_CHECK_CONSTRAINT_VIOLATED"),
      );
      await assert.rejects(
        connection.execute("DELETE FROM catalog_companies WHERE id=?", [id(92)]),
        hasCode("ER_ROW_IS_REFERENCED_2"),
      );
    } finally {
      await connection.end();
      if (folder) await rm(folder, { recursive: true });
    }
  },
  SCHEMA_SETUP_TIMEOUT_MS,
);

await recoveryTest(
  "catalog timestamps upgrade 0022 with one UTC backfill and preserve legacy inserts",
  async () => {
    const connection = await testConnection();
    let folder: string | undefined;
    const tables = [
      "catalog_dlcs",
      "catalog_regions",
      "catalog_cities",
      "catalog_cargoes",
      "catalog_trailers",
      "catalog_companies",
      "catalog_company_cities",
    ] as const;
    async function seedRows(base: number) {
      const id = (offset: number) => catalogUpgradeId(base + offset);
      const code = `synthetic_${base}`;
      await connection.execute(
        "INSERT INTO catalog_dlcs (id,game,code,name_en,steam_app_id,hidden) VALUES (?,'ets2',?,'Synthetic pack',123,1)",
        [id(0), code],
      );
      await connection.execute(
        "INSERT INTO catalog_regions (id,game,code,name_en,dlc_id) VALUES (?,'ets2',?,'Synthetic region',?)",
        [id(1), code, id(0)],
      );
      await connection.execute(
        "INSERT INTO catalog_cities (id,game,code,name_en,name_native,region_id,dlc_id) VALUES (?,'ets2',?,'Synthetic city','Synthetic native',?,?)",
        [id(2), code, id(1), id(0)],
      );
      await connection.execute(
        "INSERT INTO catalog_cargoes (id,game,code,name_en,adr_class,dlc_id) VALUES (?,'ets2',?,'Synthetic cargo','3',?)",
        [id(3), code, id(0)],
      );
      await connection.execute(
        "INSERT INTO catalog_trailers (id,game,code,name_en,dlc_id) VALUES (?,'ets2',?,'Synthetic trailer',?)",
        [id(4), code, id(0)],
      );
      await connection.execute(
        "INSERT INTO catalog_companies (id,game,code,name_en,name_ru,dlc_id) VALUES (?,'ets2',?,'Synthetic company','Синтетическая компания',?)",
        [id(5), code, id(0)],
      );
      await connection.execute(
        "INSERT INTO catalog_company_cities (id,game,company_id,city_id,dlc_id,hidden) VALUES (?,'ets2',?,?,?,1)",
        [id(6), id(5), id(2), id(0)],
      );
    }
    async function readRows(base: number) {
      const rows: RowDataPacket[] = [];
      for (const [index, table] of tables.entries()) {
        const [found] = await connection.execute<RowDataPacket[]>(
          `SELECT * FROM ${table} WHERE id=?`,
          [catalogUpgradeId(base + index)],
        );
        assert.equal(found.length, 1, table);
        const row = found[0];
        assert.ok(row, table);
        rows.push(row);
      }
      return rows;
    }
    async function serverUtc() {
      const [rows] = await connection.query<RowDataPacket[]>("SELECT UTC_TIMESTAMP(3) utc");
      return String(rows[0]?.utc);
    }
    try {
      const settings = guardedSettings();
      await reset(connection);
      folder = await catalogTimestampsPriorFolder();
      assert.equal(await runMigrations(settings, { folder }), 23);
      await seedRows(100);
      const before = await readRows(100);
      const [prefix] = await connection.query<RowDataPacket[]>(
        "SELECT version,hash FROM _vtc_migrations ORDER BY version",
      );
      const catalogTimestamps = await qualificationRuleEditingPriorFolder();
      try {
        assert.equal(await runMigrations(settings, { folder: catalogTimestamps }), 1);
        assert.equal(await runMigrations(settings, { folder: catalogTimestamps }), 0);
      } finally {
        await rm(catalogTimestamps, { recursive: true });
      }
      const [history] = await connection.query<RowDataPacket[]>(
        "SELECT version,hash,state,started_at,applied_at FROM _vtc_migrations ORDER BY version",
      );
      assert.deepEqual(
        history.slice(0, -1).map(({ version, hash }) => ({ version, hash })),
        prefix,
      );
      const migration = history.at(-1);
      assert.equal(migration?.state, "applied");

      const after = await readRows(100);
      assert.deepEqual(
        after.map(({ updated_at: _, ...row }) => row),
        before,
      );
      const stamp = after[0]?.updated_at;
      assert.match(String(stamp), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
      assert.ok(stamp >= migration?.started_at && stamp <= migration?.applied_at);
      assert.ok(after.every((row) => row.updated_at === stamp));

      // DATETIME must receive UTC even if an old caller inserts from a non-UTC session.
      await connection.query("SET SESSION time_zone = '+06:00'");
      const insertStart = await serverUtc();
      await seedRows(200);
      const insertEnd = await serverUtc();
      for (const [index, row] of (await readRows(200)).entries())
        assert.ok(row.updated_at >= insertStart && row.updated_at <= insertEnd, tables[index]);
    } finally {
      await connection.end();
      if (folder) await rm(folder, { recursive: true });
    }
  },
  SCHEMA_SETUP_TIMEOUT_MS,
);

await recoveryTest(
  "qualification rule editing upgrades the populated 0023 prefix and preserves historical proof",
  async () => {
    const connection = await testConnection();
    let folder: string | undefined;
    const fixtureId = (n: number) => "09400000-0000-4000-8000-" + String(n).padStart(12, "0");
    const member = fixtureId(301);
    const source = fixtureId(302);
    const target = fixtureId(303);
    const rule = fixtureId(304);
    const promotion = fixtureId(305);
    const newRule = fixtureId(306);
    const nextAssignment = fixtureId(307);
    const newPromotion = fixtureId(308);

    async function rows(sql: string, values: string[] = []) {
      const [result] = await connection.execute<RowDataPacket[]>(sql, values);
      return result;
    }

    async function schema() {
      const promotions = (await rows("SHOW CREATE TABLE qualification_promotions"))[0];
      const rules = (await rows("SHOW CREATE TABLE qualification_rule_versions"))[0];
      assert.ok(promotions && rules);
      return {
        promotions: String(promotions["Create Table"]),
        rules: String(rules["Create Table"]),
      };
    }

    async function history() {
      return {
        rules: await rows("SELECT * FROM qualification_rule_versions WHERE id=?", [rule]),
        promotions: await rows("SELECT * FROM qualification_promotions WHERE id=?", [promotion]),
        reviews: await rows("SELECT * FROM qualification_promotion_reviews WHERE promotion_id=?", [
          promotion,
        ]),
      };
    }

    try {
      const settings = guardedSettings();
      await reset(connection);
      folder = await qualificationRuleEditingPriorFolder();
      assert.equal(await runMigrations(settings, { folder }), 24);
      const levels = await rows(
        "SELECT code,id FROM qualification_levels WHERE game='ets2' AND code IN ('trainee','driver_iii','driver_ii')",
      );
      const level = (code: string) => {
        const id = levels.find((row) => row.code === code)?.id;
        assert.ok(Buffer.isBuffer(id), code);
        return id.toString("ascii");
      };
      const initial = "2026-01-01 00:00:00.000";
      const promoted = "2026-01-02 00:00:00.000";
      const next = "2026-01-03 00:00:00.000";
      await connection.execute(
        "INSERT INTO identity_users (id,name,email,created_at,updated_at) VALUES (?,'Synthetic member','qualification-upgrade@example.invalid',?,?)",
        [member, initial, initial],
      );
      await connection.execute(
        "INSERT INTO identity_memberships (user_id,status) VALUES (?,'active')",
        [member],
      );
      await connection.execute(
        "INSERT INTO qualification_assignments (id,user_id,game,level_id,assigned_at,ended_at,purpose,actor_id,reason) VALUES (?,?,'ets2',?,?,?,'initial',?,'Synthetic initial assignment'),(?,?,'ets2',?,?,NULL,'promotion',?,'Synthetic promotion assignment')",
        [
          source,
          member,
          level("trainee"),
          initial,
          promoted,
          member,
          target,
          member,
          level("driver_iii"),
          promoted,
          member,
        ],
      );
      await connection.execute(
        "INSERT INTO qualification_rule_versions (id,level_id,published_at,effective_at,rules,required_trips,required_distance_m,actor_id,reason) VALUES (?,?,?,?,JSON_ARRAY(),2,'12345.000000000000000001',?,'Synthetic published reason')",
        [rule, level("trainee"), initial, initial, member],
      );
      await connection.execute(
        "INSERT INTO qualification_promotions (id,source_assignment_id,target_assignment_id,rule_version_id,required_trips,required_distance_m,accepted_trips,actual_distance_m,period_revision,confirmed_at,actor_id,reason) VALUES (?,?,?,?,2,'12345.000000000000000001',3,'12346.000000000000000002',3,?,?,'Synthetic promotion proof')",
        [promotion, source, target, rule, promoted, member],
      );
      await connection.execute(
        "INSERT INTO qualification_promotion_reviews (promotion_id,review_required,version,checked_revision,checked_at) VALUES (?,1,2,4,?)",
        [promotion, promoted],
      );
      const beforeSchema = await schema();
      const beforeHistory = await history();
      for (const records of Object.values(beforeHistory)) assert.equal(records.length, 1);
      const ledgerSql = "SELECT version,hash,state FROM _vtc_migrations ORDER BY version";
      const prefix = await rows(ledgerSql);
      const qualificationRuleEditing = await manualDraftDiscardPriorFolder();
      try {
        assert.equal(await runMigrations(settings, { folder: qualificationRuleEditing }), 1);
        assert.equal(await runMigrations(settings, { folder: qualificationRuleEditing }), 0);
      } finally {
        await rm(qualificationRuleEditing, { recursive: true });
      }
      const ledger = await rows(ledgerSql);
      assert.deepEqual(ledger.slice(0, -1), prefix);
      assert.equal(ledger.at(-1)?.state, "applied");
      assert.deepEqual(await history(), beforeHistory);
      assert.deepEqual(await schema(), {
        promotions: beforeSchema.promotions
          .replace(
            "`required_trips` int unsigned NOT NULL",
            "`required_trips` int unsigned DEFAULT NULL",
          )
          .replace(
            "`required_distance_m` decimal(38,18) NOT NULL",
            "`required_distance_m` decimal(38,18) DEFAULT NULL",
          ),
        rules: beforeSchema.rules.replace(
          "`reason` varchar(2048) NOT NULL",
          "`reason` varchar(2048) DEFAULT NULL",
        ),
      });

      await connection.execute(
        "INSERT INTO qualification_rule_versions (id,level_id,published_at,effective_at,rules,required_trips,required_distance_m,actor_id) VALUES (?,?,?,?,JSON_ARRAY(),NULL,NULL,?)",
        [newRule, level("driver_iii"), next, next, member],
      );
      await connection.execute(
        "INSERT INTO qualification_assignments (id,user_id,game,level_id,assigned_at,purpose,actor_id,reason) VALUES (?,?,'ets2',?,?,'promotion',?,'Synthetic promotion assignment')",
        [nextAssignment, member, level("driver_ii"), next, member],
      );
      await connection.execute(
        "INSERT INTO qualification_promotions (id,source_assignment_id,target_assignment_id,rule_version_id,required_trips,required_distance_m,accepted_trips,actual_distance_m,period_revision,confirmed_at,actor_id,reason) VALUES (?,?,?,?,NULL,NULL,0,0,1,?,?,'Synthetic promotion proof')",
        [newPromotion, target, nextAssignment, newRule, next, member],
      );
      assert.deepEqual(
        (await rows("SELECT reason FROM qualification_rule_versions WHERE id=?", [newRule]))[0],
        { reason: null },
      );
      assert.deepEqual(
        (
          await rows(
            "SELECT required_trips,required_distance_m FROM qualification_promotions WHERE id=?",
            [newPromotion],
          )
        )[0],
        { required_trips: null, required_distance_m: null },
      );
      assert.deepEqual(await history(), beforeHistory);
    } finally {
      await connection.end();
      if (folder) await rm(folder, { recursive: true });
    }
  },
  SCHEMA_SETUP_TIMEOUT_MS,
);

await recoveryTest(
  "manual draft discard upgrades the populated 0024 prefix without rewriting history",
  async () => {
    const connection = await testConnection();
    let folder: string | undefined;
    const id = (n: number) => "11600000-0000-4000-8000-" + String(n).padStart(12, "0");
    const [owner, trip, report, revision, editing, submitted, evidence, generation, discarded] = [
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ].map(id) as [string, string, string, string, string, string, string, string, string];
    const time = "2026-01-01 00:00:00.000";
    const enumBefore = "enum('editing','submitted')";
    const enumAfter = "enum('editing','submitted','discarded')";
    const index = "  KEY `manual_draft_owner_state_page` (`owner_id`,`state`,`created_at`,`id`),\n";
    const ledgerSql = "SELECT version,hash,state FROM _vtc_migrations ORDER BY version";

    async function rows(sql: string) {
      const [result] = await connection.query<RowDataPacket[]>(sql);
      return result;
    }
    async function schema() {
      const [table] = await rows("SHOW CREATE TABLE manual_drafts");
      assert.ok(table);
      return String(table["Create Table"]);
    }
    async function history() {
      return {
        drafts: await rows("SELECT *,state+0 ordinal FROM manual_drafts ORDER BY id"),
        snapshots: await rows("SELECT * FROM manual_draft_history ORDER BY draft_id,version"),
        links: await rows("SELECT * FROM manual_draft_evidence ORDER BY draft_id,evidence_id"),
        reports: await rows("SELECT * FROM manual_reports ORDER BY id"),
        revisions: await rows("SELECT * FROM manual_revisions ORDER BY id"),
        evidence: await rows("SELECT * FROM manual_evidence ORDER BY id"),
      };
    }

    try {
      const settings = guardedSettings();
      await reset(connection);
      folder = await manualDraftDiscardPriorFolder();
      assert.equal(await runMigrations(settings, { folder }), 25);
      await connection.execute(
        "INSERT INTO identity_users (id,name,email,created_at,updated_at) VALUES (?,'Synthetic author','draft-upgrade@example.invalid',?,?)",
        [owner, time, time],
      );
      await connection.execute(
        "INSERT INTO identity_memberships (user_id,status) VALUES (?,'active')",
        [owner],
      );
      await connection.execute(
        "INSERT INTO trips (id,owner_id,game,version,outcome,recording,decision,review_reasons,created_at) VALUES (?,?,'ets2',1,'delivered','complete','pending_review',JSON_ARRAY(),?)",
        [trip, owner, time],
      );
      await connection.execute(
        "INSERT INTO manual_reports (id,owner_id,trip_id,version,revision_number,created_at) VALUES (?,?,?,1,1,?)",
        [report, owner, trip, time],
      );
      await connection.execute(
        "INSERT INTO manual_revisions (id,report_id,number,format,fields,submitted_at) VALUES (?,?,1,'legacy',JSON_OBJECT('game','ets2'),?)",
        [revision, report, time],
      );
      await connection.execute("UPDATE manual_reports SET current_revision_id=? WHERE id=?", [
        revision,
        report,
      ]);
      await connection.execute(
        "INSERT INTO manual_drafts (id,owner_id,version,state,fields,submitted_report_id,created_at,updated_at) VALUES (?,?,2,'editing',JSON_OBJECT('game','ets2'),NULL,?,?),(?,?,3,'submitted',JSON_OBJECT('game','ets2'),?,?,?)",
        [editing, owner, time, time, submitted, owner, report, time, time],
      );
      await connection.execute(
        "INSERT INTO manual_draft_history (draft_id,version,snapshot) VALUES (?,1,JSON_OBJECT('version',1,'state','editing')),(?,3,JSON_OBJECT('version',3,'state','submitted'))",
        [editing, submitted],
      );
      await connection.execute(
        "INSERT INTO manual_evidence (id,owner_id,state,generation,original_name,content_type,byte_length,sha256,fingerprint,created_at,updated_at,next_check_at) VALUES (?,?,'ready',?,'synthetic.png','image/png',4,UNHEX(REPEAT('ab',32)),UNHEX(REPEAT('cd',32)),?,?,?)",
        [evidence, owner, generation, time, time, time],
      );
      await connection.execute(
        "INSERT INTO manual_draft_evidence (draft_id,evidence_id,hold_until) VALUES (?,?,?)",
        [editing, evidence, time],
      );

      const beforeSchema = await schema();
      const beforeHistory = await history();
      const beforeLedger = await rows(ledgerSql);
      assert.deepEqual(
        beforeHistory.drafts.map(({ state, ordinal }) => ({ state, ordinal })),
        [
          { state: "editing", ordinal: 1 },
          { state: "submitted", ordinal: 2 },
        ],
      );
      const manualDraftDiscard = await tripNumberPriorFolder();
      try {
        assert.equal(await runMigrations(settings, { folder: manualDraftDiscard }), 1);
        assert.equal(await runMigrations(settings, { folder: manualDraftDiscard }), 0);
      } finally {
        await rm(manualDraftDiscard, { recursive: true });
      }

      const afterSchema = await schema();
      assert.ok(afterSchema.includes(index));
      assert.equal(afterSchema.replace(index, "").replace(enumAfter, enumBefore), beforeSchema);
      assert.deepEqual(await history(), beforeHistory);
      const ledger = await rows(ledgerSql);
      assert.deepEqual(ledger.slice(0, -1), beforeLedger);
      assert.equal(ledger.at(-1)?.state, "applied");

      await connection.execute(
        "INSERT INTO manual_drafts (id,owner_id,version,state,fields,created_at,updated_at) VALUES (?,?,1,'discarded',JSON_OBJECT(),?,?)",
        [discarded, owner, time, time],
      );
      const [saved] = await connection.execute<RowDataPacket[]>(
        "SELECT state,state+0 ordinal FROM manual_drafts WHERE id=?",
        [discarded],
      );
      assert.deepEqual(saved, [{ state: "discarded", ordinal: 3 }]);
    } finally {
      await connection.end();
      if (folder) await rm(folder, { recursive: true });
    }
  },
  SCHEMA_SETUP_TIMEOUT_MS,
);

const tripNumberId = (n: number) => "11500000-0000-4000-8000-" + String(n).padStart(12, "0");

async function seedTripNumberRows(connection: Connection) {
  const owner = tripNumberId(1);
  const earliest = tripNumberId(6);
  const alias = tripNumberId(3);
  const root = tripNumberId(4);
  const latest = tripNumberId(2);
  const firstTime = "2026-01-01 00:00:00.000";
  const tieTime = "2026-01-02 00:00:00.000";
  const lastTime = "2026-01-03 00:00:00.000";
  await connection.execute(
    "INSERT INTO identity_users (id,name,email,created_at,updated_at) VALUES (?,'Synthetic author','number-upgrade@example.invalid',?,?)",
    [owner, firstTime, firstTime],
  );
  await connection.execute(
    "INSERT INTO identity_memberships (user_id,status) VALUES (?,'active')",
    [owner],
  );
  const insert = (id: string, createdAt: string, aliasOf: string | null = null) =>
    connection.execute(
      "INSERT INTO trips (id,owner_id,game,version,outcome,recording,decision,review_reasons,created_at,reporting_at,alias_of) VALUES (?,?,'ets2',1,'delivered','complete','accepted',JSON_ARRAY(),?,?,?)",
      [id, owner, createdAt, createdAt, aliasOf],
    );
  await insert(latest, lastTime);
  await insert(root, tieTime);
  await insert(alias, tieTime, root);
  await insert(earliest, firstTime);
  await connection.execute(
    "INSERT INTO manual_reports (id,owner_id,trip_id,version,revision_number,created_at) VALUES (?,?,?,1,1,?)",
    [tripNumberId(7), owner, root, firstTime],
  );
  return { expected: [earliest, alias, root, latest], insert, lastTime };
}

await recoveryTest(
  "trip numbering upgrades the populated 0025 prefix in deterministic order and preserves UUID links",
  async () => {
    const connection = await testConnection();
    let folder: string | undefined;
    async function rows(sql: string) {
      const [result] = await connection.query<RowDataPacket[]>(sql);
      return result;
    }
    try {
      const settings = guardedSettings();
      await reset(connection);
      folder = await tripNumberPriorFolder();
      assert.equal(await runMigrations(settings, { folder }), 26);
      const { expected, insert, lastTime } = await seedTripNumberRows(connection);
      const tripSql = "SELECT * FROM trips ORDER BY id";
      const linkSql = "SELECT * FROM manual_reports ORDER BY id";
      const constraintsSql =
        "SELECT * FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND (TABLE_NAME='trips' OR REFERENCED_TABLE_NAME='trips') ORDER BY TABLE_NAME,CONSTRAINT_NAME";
      const ledgerSql = "SELECT version,hash,state FROM _vtc_migrations ORDER BY version";
      const trips = await rows(tripSql);
      const links = await rows(linkSql);
      const constraints = await rows(constraintsSql);
      const ledger = await rows(ledgerSql);
      assert.ok(constraints.some((row) => row.TABLE_NAME === "trips"));
      assert.ok(constraints.some((row) => row.TABLE_NAME === "manual_reports"));
      const tripNumberMigration = await manualReferencePriorFolder();
      try {
        assert.equal(await runMigrations(settings, { folder: tripNumberMigration }), 1);
        assert.equal(await runMigrations(settings, { folder: tripNumberMigration }), 0);
      } finally {
        await rm(tripNumberMigration, { recursive: true });
      }

      const newLedger = await rows(ledgerSql);
      assert.deepEqual(newLedger.slice(0, -1), ledger);
      assert.equal(newLedger.at(-1)?.state, "applied");
      const numbered = await rows(tripSql);
      assert.deepEqual(
        numbered.map(({ number: _, ...trip }) => trip),
        trips,
      );
      assert.deepEqual(await rows(linkSql), links);
      assert.deepEqual(await rows(constraintsSql), constraints);
      const [column] = await rows(
        "SELECT COLUMN_TYPE type,IS_NULLABLE nullable,EXTRA extra FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='trips' AND COLUMN_NAME='number'",
      );
      assert.deepEqual(column, { type: "int unsigned", nullable: "NO", extra: "auto_increment" });
      const indexes = await rows(
        "SELECT INDEX_NAME name,NON_UNIQUE nonunique,GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) columns_ FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='trips' AND INDEX_NAME IN ('PRIMARY','trip_number_unique','trip_owner_reporting') GROUP BY INDEX_NAME,NON_UNIQUE ORDER BY INDEX_NAME",
      );
      assert.deepEqual(indexes, [
        { name: "PRIMARY", nonunique: 0, columns_: "id" },
        { name: "trip_number_unique", nonunique: 0, columns_: "number" },
        { name: "trip_owner_reporting", nonunique: 1, columns_: "owner_id,reporting_at,id" },
      ]);
      const numberingSql = "SELECT CAST(id AS CHAR) id,`number` FROM trips ORDER BY `number`";
      assert.deepEqual(
        await rows(numberingSql),
        expected.map((id, i) => ({ id, number: i + 1 })),
      );
      const next = tripNumberId(8);
      await insert(next, lastTime);
      assert.deepEqual((await rows(numberingSql)).at(-1), { id: next, number: 5 });
      await assert.rejects(
        connection.execute("UPDATE trips SET `number`=1 WHERE id=?", [next]),
        hasCode("ER_DUP_ENTRY"),
      );
    } finally {
      await connection.end();
      if (folder) await rm(folder, { recursive: true });
    }
  },
  SCHEMA_SETUP_TIMEOUT_MS,
);

await recoveryTest(
  "trip numbering interruption after backfill stays dirty and refuses replay",
  async () => {
    const connection = await testConnection();
    let folder: string | undefined;
    try {
      const settings = guardedSettings();
      await reset(connection);
      folder = await tripNumberPriorFolder();
      assert.equal(await runMigrations(settings, { folder }), 26);
      const { expected } = await seedTripNumberRows(connection);
      const journal = JSON.parse(
        await readFile(join(migrationFolder, "meta/_journal.json"), "utf8"),
      );
      const entry = journal.entries[26];
      assert.match(entry.tag, /^0026_/);
      const sql = await readFile(join(migrationFolder, entry.tag + ".sql"), "utf8");
      const phases = sql.split("--> statement-breakpoint");
      assert.equal(phases.length, 3);
      await writeFile(
        join(folder, entry.tag + ".sql"),
        phases.slice(0, 2).join("--> statement-breakpoint") +
          "--> statement-breakpoint\nALTER TABLE synthetic_trip_number_missing ADD COLUMN fault INT;\n",
      );
      await writeFile(
        join(folder, "meta/_journal.json"),
        JSON.stringify({ ...journal, entries: journal.entries.slice(0, 27) }),
      );
      await assert.rejects(runMigrations(settings, { folder }), hasCode("ER_NO_SUCH_TABLE"));
      const [ledger] = await connection.query<RowDataPacket[]>(
        "SELECT state,applied_at FROM _vtc_migrations ORDER BY version DESC LIMIT 1",
      );
      assert.deepEqual(ledger, [{ state: "applying", applied_at: null }]);
      const [numbered] = await connection.query<RowDataPacket[]>(
        "SELECT CAST(id AS CHAR) id,`number` FROM trips ORDER BY `number`",
      );
      assert.deepEqual(
        numbered,
        expected.map((id, i) => ({ id, number: i + 1 })),
      );
      await assert.rejects(runMigrations(settings, { folder }), /MIGRATION_RECOVERY_REQUIRED/);
    } finally {
      await connection.end();
      if (folder) await rm(folder, { recursive: true });
    }
  },
  SCHEMA_SETUP_TIMEOUT_MS,
);

await recoveryTest(
  "manual reference fields upgrade preserves existing drafts and both revision formats",
  async () => {
    const connection = await testConnection();
    let folder: string | undefined;
    const id = (n: number) => "11700000-0000-4000-8000-" + String(n).padStart(12, "0");
    const time = "2026-01-02 03:04:05.678";
    const [owner, trip, report, legacy, extended, editing, submitted] = [
      id(1),
      id(2),
      id(3),
      id(4),
      id(5),
      id(6),
      id(7),
    ];
    const rows = async (sql: string) => {
      const [result] = await connection.query<RowDataPacket[]>(sql);
      return result;
    };
    const ledgerSql =
      "SELECT version,hash,state,started_at,applied_at FROM _vtc_migrations ORDER BY version";
    let manualReferenceFolder: string | undefined;
    const storedReports = () => rows("SELECT * FROM manual_reports ORDER BY id");
    const draftFields =
      "id,owner_id,version,state,CAST(fields AS CHAR) fields,CAST(target_trip AS CHAR) target_trip,submitted_report_id,created_at,updated_at";
    const revisionFields =
      "id,report_id,number,format,CAST(fields AS CHAR) fields,source_record_id,submitted_at";
    const referenceFields =
      "started_at,completed_at,cargo_damage_percent,origin_company_id,destination_company_id";

    try {
      const settings = guardedSettings();
      await reset(connection);
      folder = await manualReferencePriorFolder();
      assert.equal(await runMigrations(settings, { folder }), 27);
      await connection.execute(
        "INSERT INTO identity_users (id,name,email,created_at,updated_at) VALUES (?,'Synthetic author','reference-upgrade@example.invalid',?,?)",
        [owner, time, time],
      );
      await connection.execute(
        "INSERT INTO identity_memberships (user_id,status) VALUES (?,'active')",
        [owner],
      );
      await connection.execute(
        "INSERT INTO trips (id,owner_id,game,version,outcome,recording,decision,review_reasons,created_at) VALUES (?,?,'ets2',1,'delivered','complete','pending_review',JSON_ARRAY(),?)",
        [trip, owner, time],
      );
      await connection.execute(
        "INSERT INTO manual_reports (id,owner_id,trip_id,version,revision_number,created_at) VALUES (?,?,?,2,2,?)",
        [report, owner, trip, time],
      );
      await connection.execute(
        "INSERT INTO manual_revisions (id,report_id,number,format,fields,submitted_at) VALUES (?,?,1,'legacy',JSON_OBJECT('game','ets2','legacy',TRUE),?),(?,?,2,'extended',JSON_OBJECT('game','ets2','evidenceIds',JSON_ARRAY()),?)",
        [legacy, report, time, extended, report, time],
      );
      await connection.execute("UPDATE manual_reports SET current_revision_id=? WHERE id=?", [
        extended,
        report,
      ]);
      await connection.execute(
        "INSERT INTO manual_drafts (id,owner_id,version,state,fields,submitted_report_id,created_at,updated_at) VALUES (?,?,2,'editing',JSON_OBJECT('game','ets2','comment','Synthetic draft'),NULL,?,?),(?,?,3,'submitted',JSON_OBJECT('game','ets2'),?,?,?)",
        [editing, owner, time, time, submitted, owner, report, time, time],
      );

      const reports = await storedReports();
      const drafts = await rows("SELECT " + draftFields + " FROM manual_drafts ORDER BY id");
      const revisions = await rows(
        "SELECT " + revisionFields + " FROM manual_revisions ORDER BY id",
      );
      const ledger = await rows(ledgerSql);

      manualReferenceFolder = await eventStage2PriorFolder();
      assert.equal(await runMigrations(settings, { folder: manualReferenceFolder }), 1);
      assert.equal(await runMigrations(settings, { folder: manualReferenceFolder }), 0);

      assert.deepEqual(await storedReports(), reports);
      assert.deepEqual(
        await rows("SELECT " + draftFields + " FROM manual_drafts ORDER BY id"),
        drafts,
      );
      assert.deepEqual(
        await rows("SELECT " + revisionFields + " FROM manual_revisions ORDER BY id"),
        revisions,
      );
      for (const table of ["manual_drafts", "manual_revisions"] as const) {
        const references = await rows("SELECT " + referenceFields + " FROM " + table);
        assert.equal(references.length, 2);
        for (const row of references) assert.deepEqual(Object.values(row), Array(5).fill(null));
      }
      const updatedLedger = await rows(ledgerSql);
      assert.deepEqual(updatedLedger.slice(0, -1), ledger);
      const latest = updatedLedger.at(-1);
      assert.equal(latest?.state, "applied");
      assert.ok(latest?.applied_at);
    } finally {
      await connection.end();
      if (folder) await rm(folder, { recursive: true });
      if (manualReferenceFolder) await rm(manualReferenceFolder, { recursive: true });
    }
  },
  SCHEMA_SETUP_TIMEOUT_MS,
);

await recoveryTest(
  "Stage 2 Events upgrades populated 0027 and retains legacy writes and dormant storage constraints",
  async () => {
    const connection = await testConnection();
    let folder: string | undefined;
    let stage3Prefix: string | undefined;
    const id = (n: number) => `e1320000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    const [actor, legacy, draft, otherEvent, atsDlc, etsDlc] = [
      id(1),
      id(2),
      id(3),
      id(4),
      id(5),
      id(6),
    ];
    const time = "2099-10-25 12:00:00.000";
    const insertEvent = (eventId: string) =>
      connection.execute(
        "INSERT INTO events (id,version,change_sequence,attendance_version,game,visibility,status,starts_at,created_at) VALUES (?,1,1,1,'ets2','public','scheduled',?,?)",
        [eventId, time, time],
      );
    const insertRevision = (
      revisionId: string,
      version: number,
      category: string,
      status: string,
    ) =>
      connection.execute(
        "INSERT INTO event_revisions (id,event_id,version,sequence,actor_id,recorded_at,category,status,title,description,game,server,organizer,meeting_location,route,meeting_at,starts_at,visibility) VALUES (?,?,?,?,?,?,?,?,'Fictional convoy','Fictional description','ets2','Fictional server','Fictional organizer','Fictional location','Fictional route',?,?,'public')",
        [revisionId, legacy, version, version, actor, time, category, status, time, time],
      );
    const definitions = () =>
      connection
        .query<RowDataPacket[]>(
          "SELECT version,category,category+0 ordinal,title,description,organizer,meeting_location,route FROM event_revisions ORDER BY version",
        )
        .then(([rows]) => rows);
    const ledger = () =>
      connection
        .query<RowDataPacket[]>(
          "SELECT version,hash,state,started_at,applied_at FROM _vtc_migrations ORDER BY version",
        )
        .then(([rows]) => rows);
    const insertImage = (
      mediaId: string,
      eventId: string,
      key: string,
      cover: boolean,
      position: number,
    ) =>
      connection.execute(
        "INSERT INTO event_media (id,event_id,uploader_id,upload_key,state,generation,original_name,content_type,byte_length,width,height,sha256,fingerprint,position,is_cover,next_check_at,created_at,updated_at) VALUES (?,?,?,?,'ready',?,'fictional.png','image/png',512,32,16,?,?,?,?,?,?,?)",
        [
          mediaId,
          eventId,
          actor,
          key,
          id(99),
          Buffer.alloc(32),
          Buffer.alloc(32, 1),
          position,
          cover,
          time,
          time,
          time,
        ],
      );

    try {
      const settings = guardedSettings();
      await reset(connection);
      folder = await eventStage2PriorFolder();
      stage3Prefix = await stage3PriorFolder();
      assert.equal(await runMigrations(settings, { folder }), 28);
      await connection.execute(
        "INSERT INTO identity_users (id,name,email,created_at,updated_at) VALUES (?,'Fictional organizer','event-stage-2@example.invalid',?,?)",
        [actor, time, time],
      );
      await connection.execute(
        "INSERT INTO identity_memberships (user_id,status) VALUES (?,'active')",
        [actor],
      );
      await insertEvent(legacy);
      await insertRevision(id(11), 1, "created", "scheduled");
      await insertRevision(id(12), 2, "updated", "scheduled");
      await insertRevision(id(13), 3, "cancelled", "cancelled");
      await connection.execute(
        "UPDATE events SET current_revision_id=?,version=3,change_sequence=3,status='cancelled' WHERE id=?",
        [id(13), legacy],
      );
      const before = await definitions();
      const history = await ledger();

      assert.equal(await runMigrations(settings, { folder: stage3Prefix }), 1);
      assert.equal(await runMigrations(settings, { folder: stage3Prefix }), 0);
      const upgraded = await ledger();
      assert.equal(upgraded.length, 29);
      assert.deepEqual(upgraded.slice(0, -1), history);
      assert.equal(upgraded.at(-1)?.state, "applied");
      assert.ok(upgraded.at(-1)?.applied_at);
      assert.deepEqual(await definitions(), before);
      assert.deepEqual(
        before.map((row) => [row.category, Number(row.ordinal)]),
        [
          ["created", 1],
          ["updated", 2],
          ["cancelled", 3],
        ],
      );
      const [legacyState] = await connection.execute<RowDataPacket[]>(
        "SELECT version,status,CAST(current_revision_id AS CHAR) revision FROM events WHERE id=?",
        [legacy],
      );
      assert.deepEqual(legacyState, [{ version: 3, status: "cancelled", revision: id(13) }]);
      await insertRevision(id(14), 4, "updated", "scheduled");
      await insertRevision(id(15), 5, "published", "scheduled");
      assert.deepEqual(
        (await definitions()).slice(-2).map((row) => [row.category, Number(row.ordinal)]),
        [
          ["updated", 2],
          ["published", 4],
        ],
      );

      const [metadata] = await connection.query<RowDataPacket[]>("SELECT id FROM event_metadata");
      assert.deepEqual(metadata, []);
      await connection.execute("INSERT INTO event_metadata (id,created_at) VALUES (?,?),(?,?)", [
        draft,
        time,
        otherEvent,
        time,
      ]);
      await connection.execute(
        "INSERT INTO event_drafts (event_id,version,updated_by,updated_at) VALUES (?,1,?,?)",
        [draft, actor, time],
      );
      const [incomplete] = await connection.execute<RowDataPacket[]>(
        "SELECT d.title,d.game,d.starts_at,d.distance_km,(e.id IS NOT NULL) published FROM event_drafts d LEFT JOIN events e ON e.id=d.event_id WHERE d.event_id=?",
        [draft],
      );
      assert.deepEqual(
        incomplete.map((row) => ({ ...row, published: String(row.published) })),
        [{ title: null, game: null, starts_at: null, distance_km: null, published: "0" }],
      );
      await assert.rejects(
        connection.execute("UPDATE event_drafts SET distance_km=-1 WHERE event_id=?", [draft]),
        hasCode("ER_CHECK_CONSTRAINT_VIOLATED"),
      );
      await assert.rejects(
        connection.execute("UPDATE event_metadata SET published_event_id=? WHERE id=?", [
          legacy,
          draft,
        ]),
        hasCode("ER_CHECK_CONSTRAINT_VIOLATED"),
      );
      await connection.execute("UPDATE event_drafts SET game='ets2' WHERE event_id=?", [draft]);
      await connection.execute(
        "INSERT INTO catalog_dlcs (id,game,code,name_en) VALUES (?,'ats','synthetic_ats','Fictional ATS pack'),(?,'ets2','synthetic_ets','Fictional ETS2 pack')",
        [atsDlc, etsDlc],
      );
      const addDlc = (dlcId: string) =>
        connection.execute(
          "INSERT INTO event_draft_dlcs (event_id,dlc_id,game) VALUES (?,?,'ets2')",
          [draft, dlcId],
        );
      await assert.rejects(addDlc(atsDlc), hasCode("ER_NO_REFERENCED_ROW_2"));
      await addDlc(etsDlc);
      await assert.rejects(addDlc(etsDlc), hasCode("ER_DUP_ENTRY"));

      await insertImage(id(21), draft, id(31), true, 0);
      await insertImage(id(22), draft, id(32), false, 1);
      await assert.rejects(insertImage(id(23), draft, id(33), true, 2), hasCode("ER_DUP_ENTRY"));
      await assert.rejects(insertImage(id(23), draft, id(31), false, 2), hasCode("ER_DUP_ENTRY"));
      await assert.rejects(
        insertImage(id(23), draft, id(33), false, 10),
        hasCode("ER_CHECK_CONSTRAINT_VIOLATED"),
      );
      await insertImage(id(24), otherEvent, id(31), true, 0);
      await connection.execute(
        "INSERT INTO event_media_generations (media_id,generation,created_at,updated_at,lease_until,next_check_at) VALUES (?,?,?,?,?,?)",
        [id(21), id(99), time, time, time, time],
      );
      await assert.rejects(
        connection.execute("DELETE FROM event_media WHERE id=?", [id(21)]),
        hasCode("ER_ROW_IS_REFERENCED_2"),
      );
      await insertEvent(draft);
      await connection.execute("UPDATE event_metadata SET published_event_id=id WHERE id=?", [
        draft,
      ]);
      const [retained] = await connection.execute<RowDataPacket[]>(
        "SELECT CAST(m.event_id AS CHAR) event_id,CAST(e.published_event_id AS CHAR) published_event_id FROM event_media m JOIN event_metadata e ON e.id=m.event_id WHERE m.id=?",
        [id(21)],
      );
      assert.deepEqual(retained, [{ event_id: draft, published_event_id: draft }]);
    } finally {
      await connection.end();
      if (folder) await rm(folder, { recursive: true });
      if (stage3Prefix) await rm(stage3Prefix, { recursive: true });
    }
  },
  SCHEMA_SETUP_TIMEOUT_MS,
);

await recoveryTest(
  "Stage 3 upgrades the populated 0028 prefix, backfills held roots and constrains dismissal snapshots",
  async () => {
    const connection = await testConnection();
    const settings = guardedSettings();
    let folder: string | undefined;
    const id = (n: number) => `e1390000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    const owner = id(1),
      root = id(2),
      alias = id(3),
      free = id(4),
      empty = id(5),
      actor = id(6),
      candidate = id(7);
    const createdAt = "2026-01-02 00:00:00.123",
      later = "2026-01-03 00:00:00.456";
    const read = (sql: string) => connection.query<RowDataPacket[]>(sql).then(([rows]) => rows);
    const history = () =>
      read("SELECT version,hash,state,started_at,applied_at FROM _vtc_migrations ORDER BY version");
    const receiptKey = id(9);
    const fingerprint = Buffer.alloc(32, 0xab);
    const writeReceipt = (operation: string, result: object) =>
      connection.execute(
        "INSERT INTO reconciliation_commands (actor_id,operation,`key`,fingerprint,result,created_at) VALUES (?,?,?,?,?,?)",
        [actor, operation, receiptKey, fingerprint, JSON.stringify(result), createdAt],
      );
    const receipts = async () => {
      const rows = await read(
        "SELECT operation,operation+0 ordinal,CAST(`key` AS CHAR) receiptKey,HEX(fingerprint) fingerprint,result FROM reconciliation_commands ORDER BY ordinal",
      );
      return rows.map((row) => ({ ...row, ordinal: Number(row.ordinal) }));
    };
    const legacyReceipts = [
      { operation: "merge", result: { data: { id: root }, version: 4 } },
      { operation: "reverse", result: { data: { id: root }, version: 5 } },
    ];
    async function seedPrefix() {
      for (const [userId, email] of [
        [owner, "owner@example.invalid"],
        [actor, "reviewer@example.invalid"],
      ] as const) {
        await connection.execute(
          "INSERT INTO identity_users (id,name,email,created_at,updated_at) VALUES (?,'Fictional member',?,?,?)",
          [userId, email, createdAt, createdAt],
        );
        await connection.execute(
          "INSERT INTO identity_memberships (user_id,status) VALUES (?,'active')",
          [userId],
        );
      }
      for (const [tripId, aliasOf, held, reasons] of [
        [
          root,
          null,
          true,
          [
            "manual_review_required",
            "manual_review_required",
            "Manual_review_required",
            "unknown_actual_start",
          ],
        ],
        [alias, root, true, ["alias_reason"]],
        [free, null, false, ["obsolete_reason"]],
        [empty, null, true, []],
      ] as const) {
        await connection.execute(
          "INSERT INTO trips (id,owner_id,game,alias_of,version,outcome,recording,decision,reporting_at,review_hold,review_reasons,created_at) VALUES (?,?,'ets2',?,1,'delivered','complete','pending_review',?,?,?,?)",
          [tripId, owner, aliasOf, later, held, JSON.stringify(reasons), createdAt],
        );
      }
      await connection.execute(
        "INSERT INTO qualification_states (user_id,game,assignment_id,version) VALUES (?,'ets2',NULL,1)",
        [owner],
      );
      await connection.execute(
        "INSERT INTO audit_entries (id,actor_kind,actor_id,operation,subject_kind,subject_id,occurred_at,reason) VALUES (?,'user',?,'report.reviewed','trip',?,?,'staff_review')",
        [id(8), actor, root, createdAt],
      );
      for (const { operation, result } of legacyReceipts) await writeReceipt(operation, result);
    }
    async function backfilled() {
      const queue = await read(
        "SELECT CAST(id AS CHAR) id,CAST(queued_at AS CHAR) queuedAt FROM trips ORDER BY id",
      );
      assert.deepEqual(queue, [
        { id: root, queuedAt: createdAt },
        { id: alias, queuedAt: null },
        { id: free, queuedAt: null },
        { id: empty, queuedAt: createdAt },
      ]);
      const reasons = await read(
        "SELECT CAST(trip_id AS CHAR) id,code FROM trip_review_reasons ORDER BY trip_id,code",
      );
      assert.deepEqual(reasons, [
        { id: root, code: "Manual_review_required" },
        { id: root, code: "manual_review_required" },
        { id: root, code: "unknown_actual_start" },
      ]);
    }
    try {
      await reset(connection);
      folder = await stage3PriorFolder();
      assert.equal(await runMigrations(settings, { folder }), 29);
      await seedPrefix();
      const prefix = await history();
      const legacy = await receipts();
      assert.deepEqual(
        legacy,
        legacyReceipts.map((receipt, index) => ({
          ...receipt,
          ordinal: index + 1,
          receiptKey,
          fingerprint: fingerprint.toString("hex").toUpperCase(),
        })),
      );

      const stage3Folder = await qualificationEligibilityPriorFolder();
      try {
        assert.equal(await runMigrations(settings, { folder: stage3Folder }), 1);
        assert.equal(await runMigrations(settings, { folder: stage3Folder }), 0);
      } finally {
        await rm(stage3Folder, { recursive: true });
      }
      const applied = await history();
      assert.equal(applied.length, 30);
      assert.deepEqual(applied.slice(0, -1), prefix);
      assert.equal(applied.at(-1)?.state, "applied");
      await backfilled();
      assert.deepEqual(await read("SELECT eligible_since FROM qualification_states"), [
        { eligible_since: null },
      ]);
      const audit = await read("SELECT subject_kind+0 ordinal, details FROM audit_entries");
      assert.equal(audit.length, 1);
      assert.equal(Number(audit[0]?.ordinal), 3);
      assert.equal(audit[0]?.details, null);
      for (const [table, index, columns] of [
        ["trips", "trip_review_queue", ["review_hold", "alias_of", "created_at", "id"]],
        ["trips", "trip_review_queued_at", ["review_hold", "alias_of", "queued_at", "id"]],
        ["trip_review_reasons", "trip_review_reason_filter", ["code", "trip_id"]],
      ] as const) {
        const [fields] = await connection.execute<RowDataPacket[]>(
          "SELECT COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=? ORDER BY SEQ_IN_INDEX",
          [table, index],
        );
        assert.deepEqual(
          fields.map((row) => row.COLUMN_NAME),
          columns,
        );
      }
      await assert.rejects(
        connection.execute(
          "INSERT INTO trip_review_reasons (trip_id,code) VALUES (?,'manual_review_required')",
          [root],
        ),
        hasCode("ER_DUP_ENTRY"),
      );
      const hash = Buffer.alloc(32, 1);
      await connection.execute(
        "INSERT INTO reconciliation_rules (hash,config,created_at) VALUES (?,JSON_OBJECT(),?)",
        [hash, createdAt],
      );
      await connection.execute(
        "INSERT INTO reconciliation_candidates (id,owner_id,game,search_hash,primary_trip_id,secondary_trip_id,primary_version,secondary_version,rule_hash,evidence,reasons,active,created_at) VALUES (?,?,'ets2',?,?,?,1,1,?,JSON_OBJECT(),JSON_ARRAY(),TRUE,?)",
        [candidate, owner, hash, root, free, hash, createdAt],
      );
      const dismiss = (
        candidateId: string,
        reason: string,
        version: number,
        undoneBy: string | null = null,
        undoneAt: string | null = null,
      ) =>
        connection.execute(
          "INSERT INTO reconciliation_candidate_dismissals (candidate_id,dismissed_by,dismissed_at,reason,version,undone_by,undone_at) VALUES (?,?,?,?,?,?,?)",
          [candidateId, actor, createdAt, reason, version, undoneBy, undoneAt],
        );
      for (const result of [
        () => dismiss(candidate, "  \t", 2),
        () => dismiss(candidate, "Fictional reason", 0),
        () => dismiss(candidate, "Fictional reason", 1),
        () => dismiss(candidate, "Fictional reason", 2, actor),
        () => dismiss(candidate, "Fictional reason", 2, null, later),
        () => dismiss(candidate, "Fictional reason", 2, actor, "2026-01-01 00:00:00.000"),
      ])
        await assert.rejects(result(), hasCode("ER_CHECK_CONSTRAINT_VIOLATED"));
      await assert.rejects(
        dismiss(id(99), "Fictional reason", 2),
        hasCode("ER_NO_REFERENCED_ROW_2"),
      );
      await dismiss(candidate, "Fictional reason", 2);
      const dismissal = {
        data: {
          candidateId: candidate,
          version: 2,
          dismissed: true,
          dismissedAt: "2026-01-02T00:00:00.123Z",
          undoneAt: null,
        },
        version: 2,
      };
      await writeReceipt("dismiss", dismissal);
      await assert.rejects(writeReceipt("dismiss", dismissal), hasCode("ER_DUP_ENTRY"));
      await assert.rejects(dismiss(candidate, "Fictional reason", 2), hasCode("ER_DUP_ENTRY"));
      await assert.rejects(
        connection.execute("DELETE FROM reconciliation_candidates WHERE id=?", [candidate]),
        hasCode("ER_ROW_IS_REFERENCED_2"),
      );
      await connection.execute(
        "UPDATE reconciliation_candidate_dismissals SET undone_by=?,undone_at=?,version=3 WHERE candidate_id=?",
        [owner, later, candidate],
      );
      const undo = {
        data: {
          ...dismissal.data,
          version: 3,
          dismissed: false,
          undoneAt: "2026-01-03T00:00:00.456Z",
        },
        version: 3,
      };
      await writeReceipt("undo_dismissal", undo);
      assert.deepEqual(await receipts(), [
        ...legacy,
        {
          operation: "dismiss",
          ordinal: 3,
          receiptKey,
          fingerprint: fingerprint.toString("hex").toUpperCase(),
          result: dismissal,
        },
        {
          operation: "undo_dismissal",
          ordinal: 4,
          receiptKey,
          fingerprint: fingerprint.toString("hex").toUpperCase(),
          result: undo,
        },
      ]);
      await assert.rejects(
        connection.execute(
          "UPDATE reconciliation_candidate_dismissals SET undone_by=? WHERE candidate_id=?",
          [id(99), candidate],
        ),
        hasCode("ER_NO_REFERENCED_ROW_2"),
      );
      await reset(connection);
    } finally {
      await connection.end();
      if (folder) await rm(folder, { recursive: true });
    }
  },
  SCHEMA_SETUP_TIMEOUT_MS,
);

await recoveryTest(
  "Stage 3 partial DDL preserves the 0028 prefix and refuses automatic replay",
  async () => {
    const connection = await testConnection();
    const settings = guardedSettings();
    let folder: string | undefined;
    try {
      await reset(connection);
      folder = await stage3PriorFolder();
      assert.equal(await runMigrations(settings, { folder }), 29);
      const journal = JSON.parse(
        await readFile(join(migrationFolder, "meta/_journal.json"), "utf8"),
      );
      journal.entries = journal.entries.slice(0, 30);
      const entry = journal.entries.at(-1);
      assert.equal(entry.idx, 29);
      assert.equal(entry.tag, "0029_orange_zaladane");
      const filename = `${entry.tag}.sql`;
      const sql = await readFile(join(migrationFolder, filename), "utf8");
      const boundary = sql.indexOf("-- Backfill the published queue clock");
      assert.ok(boundary > 0);
      await writeFile(
        join(folder, filename),
        `${sql.slice(0, boundary)}ALTER TABLE synthetic_stage_three_missing ADD COLUMN fault INT;\n`,
      );
      await writeFile(join(folder, "meta/_journal.json"), JSON.stringify(journal));
      const readHistory = () =>
        connection
          .query<RowDataPacket[]>(
            "SELECT version,hash,state,started_at,applied_at FROM _vtc_migrations ORDER BY version",
          )
          .then(([rows]) => rows);
      const prefix = await readHistory();
      await assert.rejects(runMigrations(settings, { folder }), hasCode("ER_NO_SUCH_TABLE"));
      const dirty = await readHistory();
      assert.deepEqual(dirty.slice(0, -1), prefix);
      assert.equal(dirty.length, 30);
      assert.equal(dirty.at(-1)?.state, "applying");
      assert.equal(dirty.at(-1)?.applied_at, null);
      const [columns] = await connection.query<RowDataPacket[]>(
        "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='trips' AND COLUMN_NAME='queued_at'",
      );
      assert.equal(columns.length, 1);
      await assert.rejects(
        runMigrations(settings, { folder, lockTimeoutSeconds: 0 }),
        /MIGRATION_RECOVERY_REQUIRED/,
      );
    } finally {
      await connection.end();
      if (folder) await rm(folder, { recursive: true });
    }
  },
  SCHEMA_SETUP_TIMEOUT_MS,
);

await recoveryTest(
  "Stage 3 recovery reapplies from its known consistent disposable baseline",
  async () => {
    const connection = await testConnection();
    const settings = guardedSettings();
    try {
      // Reconstruct the known empty synthetic baseline used by the sticky-failure case.
      await reset(connection);
      assert.equal(await runMigrations(settings), 31);
      assert.equal(await runMigrations(settings), 0);
      const [recovered] = await connection.query<RowDataPacket[]>(
        "SELECT state FROM _vtc_migrations ORDER BY version",
      );
      assert.equal(recovered.length, 31);
      assert.ok(recovered.every((row) => row.state === "applied"));
    } finally {
      await connection.end();
    }
  },
  SCHEMA_SETUP_TIMEOUT_MS,
);
