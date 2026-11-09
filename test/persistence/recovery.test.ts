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
  decisionsPriorFolder,
  EXTENDED_TEST_TIMEOUT_MS,
  fixtureRoot,
  guardedSettings,
  hasCode,
  manualPriorFolder,
  notificationMaterialPriorFolder,
  notificationsPriorFolder,
  reconciliationPriorFolder,
  reset,
  reviewQueuePriorFolder,
  SCHEMA_SETUP_TIMEOUT_MS,
  simpleCatalogsPriorFolder,
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
      assert.equal(await runMigrations(settings), 21);
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
      assert.equal(await runMigrations(settings), 21);
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
      assert.equal(await runMigrations(guardedSettings()), 21);
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
        assert.equal(await runMigrations(settings), 21);
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
      assert.equal(await runMigrations(guardedSettings()), 21);
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
      assert.equal(await runMigrations(guardedSettings()), 21);
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
      assert.equal(await runMigrations(guardedSettings()), 21);
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
      assert.equal(await runMigrations(settings), 21);
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
      assert.equal(await runMigrations(settings), 2);
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
      assert.equal(history.length, 21);
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
