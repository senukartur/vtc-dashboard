import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  type AuditInput,
  applicationId,
  bigintColumn,
  createAudit,
  createDatabase,
  createUnitOfWork,
  databaseFailureContext,
  decimal38_18,
  decimalColumn,
  idColumn,
  migrationFolder,
  migrationLockName,
  newId,
  opaqueBytes,
  opaqueColumn,
  opaqueUtf8,
  requiredSqlModes,
  runMigrations,
  signedBigint,
  type TransactionClient,
  type TxContext,
  utcColumn,
  utcDateTime,
  utcIso,
} from "@vtc/db";
import { eq, type SQL, sql } from "drizzle-orm";
import { int, mysqlTable, varchar } from "drizzle-orm/mysql-core";
import type { RowDataPacket } from "mysql2/promise";
import { createEvents } from "../../apps/api/src/modules/events/service.ts";
import { createIdentity } from "../../apps/api/src/modules/identity/service.ts";
import { identityAccessEvents } from "../../apps/api/src/platform/outbox/events.ts";
import { auditEntries } from "../../packages/db/src/schema/audit.ts";
import { bounded, until } from "../support/concurrency.ts";
import { seedPublishedEventsHistory } from "./published-events-fixture.ts";
import { journalAckGate } from "./journal-ack-gate.ts";
import {
  admissionsPriorFolder,
  auditOnlyFolder,
  catalogsPriorFolder,
  eventsPriorFolder,
  extendedFixtureFolder,
  externalIdentitiesPriorFolder,
  fixtureRoot,
  guardedSettings,
  hasCode,
  hasMessage,
  identityFoundationFolder,
  jobsPriorFolder,
  manualPriorFolder,
  messagingPriorFolder,
  qualificationsPriorFolder,
  reconciliationPriorFolder,
  decisionsPriorFolder,
  reset,
  root,
  EXTENDED_TEST_TIMEOUT_MS,
  telemetryPriorFolder,
  testConnection,
  tripsPriorFolder,
} from "./support.ts";

const values = mysqlTable("synthetic_values", {
  id: idColumn("id").primaryKey(),
  parentId: int("parent_id").notNull(),
  key: opaqueColumn("opaque_key", { length: 512 }).notNull(),
  label: varchar("label", { length: 128 }).notNull(),
  amount: decimalColumn("amount").notNull(),
  largeInteger: bigintColumn("large_integer").notNull(),
  occurredAt: utcColumn("occurred_at").notNull(),
});

const seed = (key: string) => ({
  id: newId(),
  parentId: 1,
  key: opaqueUtf8(key),
  label: "Маршрут / Route 🚚",
  amount: "12345678901234567890.123456789012345678",
  largeInteger: "9007199254740993",
  occurredAt: "2026-01-31T23:45:01.123-03:00",
});

const auditInput = (): AuditInput => ({
  actorKind: "user",
  actorId: newId(),
  operation: "configuration.changed",
  subjectKind: "company",
  subjectId: newId(),
  occurredAt: "2026-02-01T02:45:01.123Z",
  reason: "operator_request",
  companyId: newId(),
});

async function rows(client: TransactionClient, query: SQL) {
  const result = await client.execute(query);
  return result[0] as unknown as Record<string, unknown>[];
}

async function cooperatingMigrations(
  settings: ReturnType<typeof guardedSettings>,
  phase: "replay" | "fresh",
  folder?: string,
) {
  // Successful waiters use the supported 30-second bound for full fixture application;
  // lock denial and disconnect release retain their separate short bounds below.
  const lockTimeoutSeconds = 30;
  const results = await Promise.allSettled(
    [0, 1].map(async (caller) => {
      const started = performance.now();
      try {
        const applied = await runMigrations(settings, {
          ...(folder === undefined ? {} : { folder }),
          lockTimeoutSeconds,
        });
        console.log(
          JSON.stringify({
            event: "persistence_migration_concurrency",
            phase,
            caller,
            state: "fulfilled",
            durationMs: Math.round(performance.now() - started),
            applied,
            lockTimeoutSeconds,
          }),
        );
        return applied;
      } catch (error) {
        const categories: Record<string, string> = {
          MIGRATION_LOCK_UNAVAILABLE: "lock_unavailable",
          MIGRATION_BASELINE_MISMATCH: "baseline_mismatch",
          MIGRATION_HISTORY_DRIFT: "history_drift",
          MIGRATION_RECOVERY_REQUIRED: "recovery_required",
        };
        console.log(
          JSON.stringify({
            event: "persistence_migration_concurrency",
            phase,
            caller,
            state: "rejected",
            durationMs: Math.round(performance.now() - started),
            lockTimeoutSeconds,
            category:
              error instanceof Error && Object.hasOwn(categories, error.message)
                ? categories[error.message]
                : "unclassified",
            databaseOperation: databaseFailureContext(error),
            codes: [
              "PROTOCOL_SEQUENCE_TIMEOUT",
              "ETIMEDOUT",
              "ER_LOCK_WAIT_TIMEOUT",
              "ER_LOCK_DEADLOCK",
              "ECONNRESET",
              "ECONNREFUSED",
              "PROTOCOL_CONNECTION_LOST",
            ].filter((code) => hasCode(code)(error)),
          }),
        );
        throw new Error("SYNTHETIC_COOPERATING_MIGRATION_FAILED");
      }
    }),
  );
  // Drain every started caller before an assertion can exit into reset/teardown.
  return results.map((result) => {
    if (result.status !== "fulfilled") throw new Error("SYNTHETIC_COOPERATING_MIGRATION_FAILED");
    return result.value;
  });
}

async function serializedFreshMigrations(
  settings: ReturnType<typeof guardedSettings>,
  connection: Awaited<ReturnType<typeof testConnection>>,
) {
  const journal = JSON.parse(
    await readFile(join(migrationFolder, "meta/_journal.json"), "utf8"),
  ) as {
    entries: { when: number; tag: string }[];
  };
  assert.equal(journal.entries.length, 15);
  const expectedHistory = await Promise.all(
    journal.entries.map(async (entry) => ({
      version: String(entry.when),
      hash: createHash("sha256")
        .update(await readFile(join(migrationFolder, `${entry.tag}.sql`)))
        .digest("hex"),
      state: "applied",
    })),
  );
  const expectedTables = Object.keys(
    JSON.parse(await readFile(join(root, "packages/db/migrations/meta/0014_snapshot.json"), "utf8"))
      .tables,
  ).sort();
  assert.equal(expectedTables.length, 96);
  const gate = await journalAckGate("finalize", 15);
  const lock = migrationLockName(settings.database);
  const history = async () => {
    const [rows] = await connection.query<RowDataPacket[]>({
      sql: "SELECT CAST(version AS CHAR) version,CAST(hash AS CHAR) hash,state,CAST(started_at AS CHAR) startedAt,CAST(applied_at AS CHAR) appliedAt FROM _vtc_migrations ORDER BY version",
      timeout: 1000,
    });
    return rows;
  };
  const lockOwner = async () => {
    const [rows] = await connection.query<RowDataPacket[]>({
      sql: "SELECT IS_USED_LOCK(?) owner",
      values: [lock],
      timeout: 1000,
    });
    return rows[0]?.owner;
  };
  const tables = async () => {
    const [rows] = await connection.query<RowDataPacket[]>({
      sql: "SELECT TABLE_NAME name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' AND TABLE_NAME<>'_vtc_migrations' ORDER BY TABLE_NAME",
      timeout: 1000,
    });
    return rows.map((row) => String(row.name)).sort();
  };
  const observe = async (caller: 0 | 1) => {
    const started = performance.now();
    try {
      const applied = await runMigrations(gate.settings, { lockTimeoutSeconds: 30 });
      console.log(
        JSON.stringify({
          event: "persistence_migration_concurrency",
          phase: "fresh",
          caller,
          state: "fulfilled",
          applied,
          lockTimeoutSeconds: 30,
          durationMs: Math.round(performance.now() - started),
        }),
      );
      return { state: "fulfilled" as const, applied };
    } catch (error) {
      const category =
        error instanceof Error && error.message === "MIGRATION_LOCK_UNAVAILABLE"
          ? "lock_unavailable"
          : "unclassified";
      console.log(
        JSON.stringify({
          event: "persistence_migration_concurrency",
          phase: "fresh",
          caller,
          state: "rejected",
          category,
          lockTimeoutSeconds: 30,
          durationMs: Math.round(performance.now() - started),
          databaseOperation: databaseFailureContext(error),
        }),
      );
      return { state: "rejected" as const };
    }
  };
  const first = observe(0);
  let second: ReturnType<typeof observe> | undefined;
  let secondSettled = false;
  let completed = false;
  const started = performance.now();
  const milestone = (
    phase:
      | "final_journal_held"
      | "history_verified"
      | "waiter_forwarded"
      | "waiter_blocked"
      | "ack_released"
      | "settled",
  ) =>
    console.log(
      JSON.stringify({
        event: "persistence_migration_serialization",
        phase,
        state: "success",
        durationMs: Math.round(performance.now() - started),
        lockTimeoutSeconds: 30,
        journalReceiptMs: 5000,
        holdSafetyMs: 2000,
        waiterForwardMs: 1000,
      }),
    );
  try {
    await Promise.race([
      bounded(gate.withheld, "fresh_final_journal_ack", EXTENDED_TEST_TIMEOUT_MS),
      first.then(() => {
        throw new Error("FRESH_MIGRATION_ENDED_BEFORE_FINAL_ACK_GATE");
      }),
    ]);
    assert.equal(gate.facts.finalizations, 15);
    assert.equal(gate.facts.okPackets, 1);
    milestone("final_journal_held");
    const before = await history();
    assert.deepEqual(
      before.map(({ version, hash, state }) => ({ version, hash, state })),
      expectedHistory,
    );
    assert.deepEqual(await tables(), expectedTables);
    const owner = await lockOwner();
    assert.ok(
      Number(owner) > 0,
      "first migrator owns the real named lock after its committed final journal write",
    );
    milestone("history_verified");
    second = observe(1).finally(() => {
      secondSettled = true;
    });
    await bounded(gate.waiterForwarded, "fresh_waiter_forwarded", 1000);
    milestone("waiter_forwarded");
    await delay(100);
    assert.equal(
      secondSettled,
      false,
      "actual waiter remains incomplete while first owns the lock",
    );
    assert.equal(gate.facts.waiterRequests, 1);
    assert.equal(gate.facts.waiterResponses, 0);
    assert.equal(await lockOwner(), owner);
    milestone("waiter_blocked");
    assert.equal(
      gate.facts.automaticRelease,
      false,
      "coordination must finish inside the two-second safety release",
    );
    gate.release();
    milestone("ack_released");
    const result = await Promise.all([first, second]);
    assert.deepEqual(result, [
      { state: "fulfilled", applied: 15 },
      { state: "fulfilled", applied: 0 },
    ]);
    assert.equal(gate.facts.explicitReleases, 1);
    assert.equal(gate.facts.automaticRelease, false);
    assert.equal(gate.facts.waiterResponses, 1);
    assert.equal(gate.facts.waiterResponseBeforeRelease, false);
    assert.equal(gate.facts.inserts, 15);
    assert.equal(gate.facts.finalizations, 15);
    assert.deepEqual(
      await history(),
      before,
      "waiter neither reapplies DDL nor rewrites any journal receipt",
    );
    assert.deepEqual(await tables(), expectedTables);
    milestone("settled");
    completed = true;
  } finally {
    try {
      gate.release();
      if (!completed) await gate.close();
    } finally {
      try {
        await Promise.allSettled([first, ...(second ? [second] : [])]);
      } finally {
        if (completed) await gate.close();
        await until(async () => (await lockOwner()) === null);
      }
    }
  }
}

type MigrationContext = {
  settings: ReturnType<typeof guardedSettings>;
  connection: Awaited<ReturnType<typeof testConnection>>;
  unit: ReturnType<typeof createUnitOfWork>;
  audit: ReturnType<typeof createAudit>;
};

let publishedUpgradeRunning = false;

function publishedUpgrade(name: string, command: (context: MigrationContext) => Promise<void>) {
  test(name, { timeout: 120000 }, async () => {
    // A framework timeout does not cancel the callback or its SQL/cleanup.
    // Fail closed before another case can reset that still-active fixture.
    assert.equal(publishedUpgradeRunning, false, "PUBLISHED_UPGRADE_CLEANUP_REQUIRED");
    publishedUpgradeRunning = true;
    try {
      const settings = guardedSettings();
      const connection = await testConnection();
      const unit = createUnitOfWork(settings);
      const audit = createAudit(unit);
      try {
        await command({ settings, connection, unit, audit });
      } finally {
        try {
          await unit.close();
        } finally {
          await connection.end();
        }
      }
    } finally {
      publishedUpgradeRunning = false;
    }
  });
}

// Destructive upgrades share the allocated schema, so every case runs sequentially.
// Each published prefix has its own finite budget and connection/pool lifecycle.
// Isolation replaces the former aggregate 180-second allowance; SQL deadlines stay unchanged.
await describe("published-prefix migration upgrades", { concurrency: false }, () => {
  publishedUpgrade(
    "email stage migration preserves old identity rows and invalidates outstanding proof epochs",
    async ({ settings, connection }) => {
      await reset(connection);
      const folder = await identityFoundationFolder();
      try {
        assert.equal(await runMigrations(settings, { folder }), 2);
        const id = newId(),
          challengeId = newId();
        await connection.execute(
          "INSERT INTO identity_users (id, name, email, email_verified, created_at, updated_at) VALUES (?, 'Synthetic Upgrade', 'synthetic-upgrade@example.invalid', 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
          [id],
        );
        await connection.execute(
          "INSERT INTO identity_memberships (user_id, status) VALUES (?, 'active')",
          [id],
        );
        await connection.execute(
          "INSERT INTO identity_challenges (id, user_id, purpose, proposed_email, email_epoch, access_epoch, credential_epoch, secret_hash, expires_at) VALUES (?, ?, 'email_change', 'synthetic-new@example.invalid', 1, 1, 1, ?, UTC_TIMESTAMP(3) + INTERVAL 10 MINUTE)",
          [challengeId, id, Buffer.alloc(32)],
        );
        assert.equal(await runMigrations(settings), 13);
        assert.equal(await runMigrations(settings), 0);
        const [rows] = await connection.query<RowDataPacket[]>(
          "SELECT u.email_verified, c.proposed_email, c.current_email_confirmed, c.identity_epoch, c.consumed FROM identity_users u JOIN identity_challenges c ON c.user_id=u.id WHERE c.id=?",
          [challengeId],
        );
        assert.equal(Number(rows[0]?.email_verified), 1);
        assert.equal(rows[0]?.proposed_email, "synthetic-new@example.invalid");
        assert.equal(Number(rows[0]?.current_email_confirmed), 0);
        assert.equal(Number(rows[0]?.identity_epoch), 0);
        assert.equal(Number(rows[0]?.consumed), 0);
      } finally {
        await rm(folder, { recursive: true });
      }
    },
  );

  publishedUpgrade(
    "jobs migration upgrades the exact published prefix and preserves its sentinel/checksums",
    async ({ settings, connection, unit, audit }) => {
      await reset(connection);
      const folder = await jobsPriorFolder();
      try {
        assert.equal(await runMigrations(settings, { folder }), 3);
        const id = await unit.run((tx) => audit.append(tx, auditInput()));
        const [before] = await connection.query<RowDataPacket[]>(
          "SELECT version,hash FROM _vtc_migrations ORDER BY version",
        );
        assert.equal(await runMigrations(settings), 12);
        assert.equal(await runMigrations(settings), 0);
        const [after] = await connection.query<RowDataPacket[]>(
          "SELECT version,hash FROM _vtc_migrations ORDER BY version LIMIT 3",
        );
        assert.deepEqual(after, before);
        const [saved] = await connection.query<RowDataPacket[]>(
          "SELECT COUNT(*) AS count FROM audit_entries WHERE id=?",
          [Buffer.from(id)],
        );
        assert.equal(String(saved[0]?.count), "1");
      } finally {
        await rm(folder, { recursive: true });
      }
    },
  );

  publishedUpgrade(
    "messaging migration preserves the exact published jobs prefix and safe sentinel",
    async ({ settings, connection, unit, audit }) => {
      await reset(connection);
      const folder = await messagingPriorFolder();
      try {
        assert.equal(await runMigrations(settings, { folder }), 4);
        const id = await unit.run((tx) => audit.append(tx, auditInput()));
        const [before] = await connection.query<RowDataPacket[]>(
          "SELECT version,hash FROM _vtc_migrations ORDER BY version",
        );
        assert.equal(await runMigrations(settings), 11);
        assert.equal(await runMigrations(settings), 0);
        const [after] = await connection.query<RowDataPacket[]>(
          "SELECT version,hash FROM _vtc_migrations ORDER BY version LIMIT 4",
        );
        assert.deepEqual(after, before);
        const [saved] = await connection.execute<RowDataPacket[]>(
          "SELECT COUNT(*) count FROM audit_entries WHERE id=?",
          [Buffer.from(id)],
        );
        assert.equal(String(saved[0]?.count), "1");
      } finally {
        await rm(folder, { recursive: true });
      }
    },
  );

  publishedUpgrade(
    "admissions migration preserves the exact published mail prefix and audit sentinel",
    async ({ settings, connection, unit, audit }) => {
      await reset(connection);
      const folder = await admissionsPriorFolder();
      try {
        assert.equal(await runMigrations(settings, { folder }), 5);
        const id = await unit.run((tx) => audit.append(tx, auditInput()));
        const [before] = await connection.query<RowDataPacket[]>(
          "SELECT version,hash FROM _vtc_migrations ORDER BY version",
        );
        assert.equal(await runMigrations(settings), 10);
        assert.equal(await runMigrations(settings), 0);
        const [after] = await connection.query<RowDataPacket[]>(
          "SELECT version,hash FROM _vtc_migrations ORDER BY version LIMIT 5",
        );
        assert.deepEqual(after, before);
        const [saved] = await connection.execute<RowDataPacket[]>(
          "SELECT COUNT(*) count FROM audit_entries WHERE id=?",
          [Buffer.from(id)],
        );
        assert.equal(String(saved[0]?.count), "1");
      } finally {
        await rm(folder, { recursive: true });
      }
    },
  );
  publishedUpgrade(
    "external identities upgrades the exact six-migration prefix without changing members/history",
    async ({ settings, connection, unit, audit }) => {
      await reset(connection);
      const folder = await externalIdentitiesPriorFolder();
      try {
        assert.equal(await runMigrations(settings, { folder }), 6);
        const auditId = await unit.run((tx) => audit.append(tx, auditInput()));
        const memberId = newId();
        await connection.execute(
          "INSERT INTO identity_users (id,name,email,email_verified,created_at,updated_at) VALUES (?, 'Synthetic Upgrade', 'external-upgrade@example.invalid', 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
          [memberId],
        );
        await connection.execute(
          "INSERT INTO identity_memberships (user_id,status) VALUES (?, 'active')",
          [memberId],
        );
        const [before] = await connection.query<RowDataPacket[]>(
          "SELECT version,hash FROM _vtc_migrations ORDER BY version",
        );
        assert.equal(await runMigrations(settings), 9);
        assert.equal(await runMigrations(settings), 0);
        const [after] = await connection.query<RowDataPacket[]>(
          "SELECT version,hash FROM _vtc_migrations ORDER BY version LIMIT 6",
        );
        assert.deepEqual(after, before);
        const [saved] = await connection.execute<RowDataPacket[]>(
          "SELECT COUNT(*) n FROM audit_entries WHERE id=?",
          [auditId],
        );
        assert.equal(String(saved[0]?.n), "1");
        const [members] = await connection.execute<RowDataPacket[]>(
          "SELECT m.status,m.version,m.identity_epoch,u.email_verified FROM identity_memberships m JOIN identity_users u ON u.id=m.user_id WHERE m.user_id=?",
          [memberId],
        );
        assert.equal(members[0]?.status, "active");
        assert.equal(Number(members[0]?.identity_epoch), 1);
        assert.equal(Number(members[0]?.version), 1);
        assert.equal(Number(members[0]?.email_verified), 1);
        const [links] = await connection.query<RowDataPacket[]>(
          "SELECT COUNT(*) n FROM external_steam_links",
        );
        assert.equal(String(links[0]?.n), "0");
        const [tables] = await connection.query<RowDataPacket[]>(
          "SELECT ENGINE,TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME LIKE 'external\\_%'",
        );
        assert.equal(tables.length, 6);
        assert.ok(
          tables.every(
            (row) => row.ENGINE === "InnoDB" && row.TABLE_COLLATION === "utf8mb4_0900_ai_ci",
          ),
        );
      } finally {
        await rm(folder, { recursive: true });
      }
    },
  );
  publishedUpgrade(
    "catalog migration preserves the exact published external-identities prefix and sentinel",
    async ({ settings, connection, unit, audit }) => {
      await reset(connection);
      const folder = await catalogsPriorFolder();
      try {
        assert.equal(await runMigrations(settings, { folder }), 7);
        const id = await unit.run((tx) => audit.append(tx, auditInput()));
        const [before] = await connection.query<RowDataPacket[]>(
          "SELECT version,hash FROM _vtc_migrations ORDER BY version",
        );
        assert.equal(await runMigrations(settings), 8);
        assert.equal(await runMigrations(settings), 0);
        const [after] = await connection.query<RowDataPacket[]>(
          "SELECT version,hash FROM _vtc_migrations ORDER BY version LIMIT 7",
        );
        assert.deepEqual(after, before);
        const [saved] = await connection.execute<RowDataPacket[]>(
          "SELECT COUNT(*) count FROM audit_entries WHERE id=?",
          [Buffer.from(id)],
        );
        assert.equal(String(saved[0]?.count), "1");
      } finally {
        await rm(folder, { recursive: true });
      }
    },
  );
  publishedUpgrade(
    "trip migration preserves exact eight-migration prefix, sentinel and checksums",
    async ({ settings, connection, unit, audit }) => {
      await reset(connection);
      const folder = await tripsPriorFolder();
      try {
        assert.equal(await runMigrations(settings, { folder }), 8);
        const id = await unit.run((tx) => audit.append(tx, auditInput()));
        const [before] = await connection.query<RowDataPacket[]>(
          "SELECT version,hash FROM _vtc_migrations ORDER BY version",
        );
        assert.equal(await runMigrations(settings), 7);
        assert.equal(await runMigrations(settings), 0);
        const [after] = await connection.query<RowDataPacket[]>(
          "SELECT version,hash FROM _vtc_migrations ORDER BY version LIMIT 8",
        );
        assert.deepEqual(after, before);
        const [saved] = await connection.execute<RowDataPacket[]>(
          "SELECT COUNT(*) count FROM audit_entries WHERE id=?",
          [Buffer.from(id)],
        );
        assert.equal(String(saved[0]?.count), "1");
      } finally {
        await rm(folder, { recursive: true });
      }
    },
  );
  publishedUpgrade(
    "telemetry migration preserves exact nine-migration prefix, audit sentinel and restrictive references",
    async ({ settings, connection, unit, audit }) => {
      await reset(connection);
      const folder = await telemetryPriorFolder();
      try {
        assert.equal(await runMigrations(settings, { folder }), 9);
        const id = await unit.run((tx) => audit.append(tx, auditInput()));
        const [before] = await connection.query<RowDataPacket[]>(
          "SELECT version,hash FROM _vtc_migrations ORDER BY version",
        );
        assert.equal(await runMigrations(settings), 6);
        assert.equal(await runMigrations(settings), 0);
        const [after] = await connection.query<RowDataPacket[]>(
          "SELECT version,hash FROM _vtc_migrations ORDER BY version LIMIT 9",
        );
        assert.deepEqual(after, before);
        const [saved] = await connection.execute<RowDataPacket[]>(
          "SELECT COUNT(*) count FROM audit_entries WHERE id=?",
          [Buffer.from(id)],
        );
        assert.equal(String(saved[0]?.count), "1");
        const [fks] = await connection.query<RowDataPacket[]>(
          "SELECT DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME LIKE 'telemetry_%'",
        );
        assert.equal(fks.length, 6);
        assert.ok(fks.every((row) => row.DELETE_RULE === "RESTRICT"));
      } finally {
        await rm(folder, { recursive: true });
      }
    },
  );
  publishedUpgrade(
    "qualification upgrade preserves onboarding evidence and fences inactive or returned-active legacy history",
    async ({ settings, connection, unit }) => {
      await reset(connection);
      const folder = await qualificationsPriorFolder();
      try {
        assert.equal(await runMigrations(settings, { folder }), 10);
        const [before] = await connection.query<RowDataPacket[]>(
          "SELECT version,hash FROM _vtc_migrations ORDER BY version",
        );
        const activeId = newId(),
          inactiveId = newId(),
          returnedId = newId(),
          activeAssignment = newId(),
          inactiveAssignment = newId(),
          returnedAssignment = newId();
        for (const [id, status] of [
          [activeId, "active"],
          [inactiveId, "inactive"],
          [returnedId, "active"],
        ] as const) {
          await connection.execute(
            "INSERT INTO identity_users(id,name,email,email_verified,created_at,updated_at) VALUES(?, 'Fictional upgrade member', ?, 0, UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
            [id, `${id}@example.invalid`],
          );
          await connection.execute(
            "INSERT INTO identity_memberships(user_id,status,locale,display_timezone) VALUES(?,?,'en','UTC')",
            [id, status],
          );
        }
        for (const [id, userId] of [
          [activeAssignment, activeId],
          [inactiveAssignment, inactiveId],
          [returnedAssignment, returnedId],
        ] as const)
          await connection.execute(
            "INSERT INTO qualification_initial_assignments(id,user_id,game,level,assigned_at) VALUES(?,?,'ets2','trainee','2026-01-02 03:04:05.678')",
            [id, userId],
          );
        // This is the pre-0010 identity composition: no qualification lifecycle port existed.
        const identity = createIdentity(
          unit,
          {
            secret: randomBytes(32).toString("hex"),
            origin: "http://127.0.0.1:4173",
            production: false,
          },
          { accessEvents: identityAccessEvents(unit) },
        );
        const password = "Fictional-upgrade-passphrase-42";
        await identity.bootstrap({
          email: "upgrade-director@example.invalid",
          name: "Fictional Upgrade Director",
          password,
        });
        const login = await identity.login("upgrade-director@example.invalid", password);
        const cookie = login.cookies.map((value) => value.split(";", 1)[0]).join("; ");
        const director = await identity.authenticate(new Headers({ cookie }));
        await identity.administer(director, returnedId, newId(), 1, { kind: "deactivate" });
        await identity.administer(director, returnedId, newId(), 2, {
          kind: "reinstate",
          roles: ["trainee"],
        });
        const [returned] = await connection.query<RowDataPacket[]>(
          "SELECT status,identity_epoch FROM identity_memberships WHERE user_id=?",
          [returnedId],
        );
        assert.equal(returned[0]?.status, "active");
        assert.equal(Number(returned[0]?.identity_epoch), 3);
        const [original] = await connection.query<RowDataPacket[]>(
          "SELECT HEX(id) id,HEX(user_id) userId,game,level,CAST(assigned_at AS CHAR) assignedAt FROM qualification_initial_assignments ORDER BY id",
        );
        assert.equal(await runMigrations(settings), 5);
        assert.equal(await runMigrations(settings), 0);
        const [after] = await connection.query<RowDataPacket[]>(
          "SELECT version,hash FROM _vtc_migrations ORDER BY version LIMIT 10",
        );
        assert.deepEqual(after, before);
        const [evidence] = await connection.query<RowDataPacket[]>(
          "SELECT HEX(id) id,HEX(user_id) userId,game,level,CAST(assigned_at AS CHAR) assignedAt FROM qualification_initial_assignments ORDER BY id",
        );
        assert.deepEqual(evidence, original);
        const [assignments] = await connection.query<RowDataPacket[]>(
          "SELECT CAST(id AS CHAR) id,CAST(assigned_at AS CHAR) assignedAt,ended_at FROM qualification_assignments",
        );
        assert.equal(assignments.length, 1);
        assert.equal(assignments[0]?.id, activeAssignment);
        assert.equal(assignments[0]?.assignedAt, "2026-01-02 03:04:05.678");
        assert.equal(assignments[0]?.ended_at, null);
        const [states] = await connection.query<RowDataPacket[]>(
          "SELECT CAST(user_id AS CHAR) userId,CAST(assignment_id AS CHAR) assignmentId FROM qualification_states",
        );
        assert.deepEqual(
          states.map((row) => [row.userId, row.assignmentId]),
          [[activeId, activeAssignment]],
        );
        const [unsupported] = await connection.query<RowDataPacket[]>(
          "SELECT COUNT(*) n FROM qualification_assignments WHERE user_id IN (?,?)",
          [inactiveId, returnedId],
        );
        assert.equal(Number(unsupported[0]?.n), 0);
        const [rules] = await connection.query<RowDataPacket[]>(
          "SELECT COUNT(*) n FROM qualification_rule_versions",
        );
        assert.equal(Number(rules[0]?.n), 0);
      } finally {
        await rm(folder, { recursive: true });
      }
    },
  );
  publishedUpgrade(
    "manual reports preserve exact twelve-migration prefix, sentinels and restrictive report/revision/trip relationships",
    async ({ settings, connection, unit, audit }) => {
      await reset(connection);
      const folder = await manualPriorFolder();
      try {
        assert.equal(await runMigrations(settings, { folder }), 12);
        const id = await unit.run((tx) => audit.append(tx, auditInput()));
        const identity = createIdentity(
          unit,
          {
            secret: randomBytes(32).toString("hex"),
            origin: "http://127.0.0.1:4173",
            production: false,
          },
          { accessEvents: identityAccessEvents(unit) },
        );
        const password = "Fictional-event-upgrade-passphrase-42";
        await identity.bootstrap({
          email: "event-upgrade@example.invalid",
          name: "Fictional Event Upgrade Director",
          password,
        });
        const login = await identity.login("event-upgrade@example.invalid", password);
        const cookie = login.cookies.map((value) => value.split(";", 1)[0]).join("; ");
        const director = await identity.authenticate(new Headers({ cookie }));
        const eventKey = randomBytes(32).toString("hex");
        const eventInput = {
          title: "Fictional upgrade convoy",
          description: "Fictional retained event history",
          game: "ets2" as const,
          server: "Fictional server",
          organizer: "Fictional organizer",
          meetingLocation: "Fictional meeting location",
          route: "Fictional route",
          meetingAt: "2026-10-22T12:00:30.000Z",
          startsAt: "2026-10-22T12:01:00.000Z",
          endsAt: null,
          visibility: "members" as const,
          originCityId: null,
          destinationCityId: null,
          prescribedCargoId: null,
          prescribedMassKg: null,
          prescribedTrailerTypeId: null,
        };
        const fixture = await seedPublishedEventsHistory(
          unit,
          director.userId,
          eventKey,
          eventInput,
        );
        const { eventId, createKey, eventBefore, historyBefore, replayBefore } = fixture;
        const events = createEvents(unit, { cursorKey: eventKey }, { identity });
        assert.equal(historyBefore.definitions.length, 1);
        assert.equal(historyBefore.responses.length, 1);
        assert.equal(historyBefore.attendance.length, 1);
        const [before] = await connection.query<RowDataPacket[]>(
          "SELECT version,hash FROM _vtc_migrations ORDER BY version",
        );
        assert.equal(await runMigrations(settings), 3);
        assert.equal(await runMigrations(settings), 0);
        const [after] = await connection.query<RowDataPacket[]>(
          "SELECT version,hash FROM _vtc_migrations ORDER BY version LIMIT 12",
        );
        assert.deepEqual(after, before);
        assert.deepEqual(await events.get(director, eventId), eventBefore);
        assert.deepEqual(await events.history(director, eventId), historyBefore);
        assert.deepEqual(await events.create(director, createKey, eventInput), replayBefore);
        assert.deepEqual(
          await events.respond(director, eventId, fixture.responseKey, 1, fixture.responseInput),
          { data: { version: 2, response: "participating", declineReason: null }, version: 2 },
        );
        assert.deepEqual(
          await events.setAttendance(
            director,
            eventId,
            fixture.attendanceKey,
            1,
            fixture.attendanceInput,
          ),
          { data: { id: eventId, version: 2 }, version: 2 },
        );
        assert.deepEqual(await fixture.readReceipts(), fixture.receiptsBefore);
        const [eventReceipts] = await connection.query<RowDataPacket[]>(
          "SELECT COUNT(*) n FROM event_commands",
        );
        assert.equal(Number(eventReceipts[0]?.n), 3);
        const [saved] = await connection.execute<RowDataPacket[]>(
          "SELECT COUNT(*) count FROM audit_entries WHERE id=?",
          [Buffer.from(id)],
        );
        assert.equal(String(saved[0]?.count), "1");
        const [constraints] = await connection.query<RowDataPacket[]>(
          "SELECT CONSTRAINT_NAME,DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME LIKE 'manual_%'",
        );
        assert.ok(constraints.length >= 23);
        assert.ok(constraints.every((row) => row.DELETE_RULE === "RESTRICT"));
        for (const name of [
          "manual_report_current_revision_fk",
          "manual_ref_report_trip_fk",
          "manual_ref_report_revision_fk",
        ])
          assert.ok(constraints.some((row) => row.CONSTRAINT_NAME === name));
      } finally {
        await rm(folder, { recursive: true });
      }
    },
  );
  publishedUpgrade(
    "events upgrades exact eleven-migration prefix and preserves populated history",
    async ({ settings, connection, unit, audit }) => {
      await reset(connection);
      const folder = await eventsPriorFolder();
      try {
        assert.equal(await runMigrations(settings, { folder }), 11);
        const id = await unit.run((tx) => audit.append(tx, auditInput()));
        const [before] = await connection.query<RowDataPacket[]>(
          "SELECT version,hash FROM _vtc_migrations ORDER BY version",
        );
        assert.equal(await runMigrations(settings), 4);
        assert.equal(await runMigrations(settings), 0);
        const [after] = await connection.query<RowDataPacket[]>(
          "SELECT version,hash FROM _vtc_migrations ORDER BY version LIMIT 11",
        );
        assert.deepEqual(after, before);
        const [saved] = await connection.query<RowDataPacket[]>(
          "SELECT COUNT(*) n FROM audit_entries WHERE id=?",
          [id],
        );
        assert.equal(Number(saved[0]?.n), 1);
        const [tables] = await connection.query<RowDataPacket[]>(
          "SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND (TABLE_NAME='events' OR TABLE_NAME LIKE 'event_%')",
        );
        assert.equal(Number(tables[0]?.n), 8);
        const [fks] = await connection.query<RowDataPacket[]>(
          "SELECT DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME LIKE 'event_%'",
        );
        assert.ok(fks.length >= 15);
        assert.ok(fks.every((r) => r.DELETE_RULE === "RESTRICT"));
      } finally {
        await rm(folder, { recursive: true });
      }
    },
  );
  publishedUpgrade(
    "reconciliation upgrades the exact thirteen-migration prefix with retained audit/trip history",
    async ({ settings, connection, unit, audit }) => {
      await reset(connection);
      const folder = await reconciliationPriorFolder();
      try {
        assert.equal(await runMigrations(settings, { folder }), 13);
        const id = await unit.run((tx) => audit.append(tx, auditInput()));
        const [before] = await connection.query<RowDataPacket[]>(
          "SELECT version,hash FROM _vtc_migrations ORDER BY version",
        );
        assert.equal(await runMigrations(settings), 2);
        assert.equal(await runMigrations(settings), 0);
        const [after] = await connection.query<RowDataPacket[]>(
          "SELECT version,hash FROM _vtc_migrations ORDER BY version LIMIT 13",
        );
        assert.deepEqual(after, before);
        const [sentinel] = await connection.query<RowDataPacket[]>(
          "SELECT COUNT(*) n FROM audit_entries WHERE id=?",
          [id],
        );
        assert.equal(Number(sentinel[0]?.n), 1);
        const [column] = await connection.query<RowDataPacket[]>(
          "SELECT IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='trips' AND COLUMN_NAME='alias_of'",
        );
        assert.equal(column[0]?.IS_NULLABLE, "YES");
        const [searches] = await connection.query<RowDataPacket[]>(
          "SELECT COUNT(*) n FROM reconciliation_searches",
        );
        assert.equal(String(searches[0]?.n), "0");
        const [searchForeign] = await connection.query<RowDataPacket[]>(
          "SELECT REFERENCED_TABLE_NAME,DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='reconciliation_searches' ORDER BY REFERENCED_TABLE_NAME",
        );
        assert.deepEqual(
          searchForeign.map((row) => [row.REFERENCED_TABLE_NAME, row.DELETE_RULE]),
          [
            ["reconciliation_rules", "RESTRICT"],
            ["trips", "RESTRICT"],
          ],
        );
        const [foreign] = await connection.query<RowDataPacket[]>(
          "SELECT DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME LIKE 'reconciliation%' ",
        );
        assert.ok(foreign.length >= 8);
        assert.ok(foreign.every((row) => row.DELETE_RULE === "RESTRICT"));
      } finally {
        await rm(folder, { recursive: true });
      }
    },
  );
  publishedUpgrade(
    "trip decisions upgrade exact fourteen-migration prefix and preserve source/history shape",
    async ({ settings, connection, unit, audit }) => {
      await reset(connection);
      const folder = await decisionsPriorFolder();
      try {
        assert.equal(await runMigrations(settings, { folder }), 14);
        const id = await unit.run((tx) => audit.append(tx, auditInput()));
        const [before] = await connection.query<RowDataPacket[]>(
          "SELECT version,hash FROM _vtc_migrations ORDER BY version",
        );
        assert.equal(await runMigrations(settings), 1);
        assert.equal(await runMigrations(settings), 0);
        const [after] = await connection.query<RowDataPacket[]>(
          "SELECT version,hash FROM _vtc_migrations ORDER BY version LIMIT 14",
        );
        assert.deepEqual(after, before);
        const [sentinel] = await connection.execute<RowDataPacket[]>(
          "SELECT COUNT(*) n FROM audit_entries WHERE id=?",
          [id],
        );
        assert.equal(Number(sentinel[0]?.n), 1);
        const [columns] = await connection.query<RowDataPacket[]>(
          "SELECT COLUMN_NAME,IS_NULLABLE,COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='trip_facts' AND COLUMN_NAME IN ('message_id','kind') ORDER BY COLUMN_NAME",
        );
        assert.equal(columns[0]?.COLUMN_DEFAULT, "source");
        assert.equal(columns[1]?.IS_NULLABLE, "YES");
        const [foreign] = await connection.query<RowDataPacket[]>(
          "SELECT DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME IN ('trip_decisions','trip_proposals','trip_resolutions')",
        );
        assert.ok(foreign.length >= 18);
        assert.ok(foreign.every((r) => r.DELETE_RULE === "RESTRICT"));
      } finally {
        await rm(folder, { recursive: true });
      }
    },
  );
  publishedUpgrade(
    "identity migration preserves existing published audit history",
    async ({ settings, connection, unit, audit }) => {
      await reset(connection);
      const folder = await auditOnlyFolder();
      try {
        assert.equal(await runMigrations(settings, { folder }), 1);
        const id = await unit.run((tx) => audit.append(tx, auditInput()));
        assert.equal(await runMigrations(settings), 14);
        assert.equal(await runMigrations(settings), 0);
        const [saved] = await connection.query<RowDataPacket[]>(
          "SELECT COUNT(*) AS count FROM audit_entries WHERE id = ?",
          [Buffer.from(id)],
        );
        assert.equal(String(saved[0]?.count), "1");
      } finally {
        await rm(folder, { recursive: true });
      }
    },
  );
});

test("real MySQL persistence foundations", { timeout: 120000 }, async (t) => {
  assert.equal(publishedUpgradeRunning, false, "PUBLISHED_UPGRADE_CLEANUP_REQUIRED");
  const settings = guardedSettings();
  const connection = await testConnection();
  const unit = createUnitOfWork(settings);
  const other = createUnitOfWork(settings);
  const audit = createAudit(unit);
  let extended: string | undefined;
  let freshSchemaReady = false;
  try {
    await t.test(
      "destructive fixtures require synthetic name, test mode and explicit acknowledgment",
      () => {
        for (const [name, invalid] of [
          ["NODE_ENV", "production"],
          ["DB_TEST_RESET_ACK", ""],
          ["MYSQL_DATABASE", "forbidden_database"],
        ] as const) {
          const original = process.env[name];
          try {
            process.env[name] = invalid;
            assert.throws(guardedSettings, /SYNTHETIC_DATABASE_AND_RESET_ACK_REQUIRED/);
          } finally {
            if (original === undefined) delete process.env[name];
            else process.env[name] = original;
          }
        }
      },
    );
    await t.test("server baseline, empty migration and replay", async () => {
      const readiness = createDatabase(settings);
      try {
        assert.equal(await readiness.check(), true);
      } finally {
        await readiness.close();
      }
      await reset(connection);
      await serializedFreshMigrations(settings, connection);
      assert.equal(await runMigrations(settings), 0);
      const [tables] = await connection.query<RowDataPacket[]>(
        "SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_entries'",
      );
      assert.equal(tables[0]?.ENGINE, "InnoDB");
      freshSchemaReady = true;
    });
    assert.equal(
      freshSchemaReady,
      true,
      "FRESH_SCHEMA_AND_SERIALIZATION_REQUIRED_BEFORE_LATER_FIXTURES",
    );

    await t.test(
      "additive migration from committed prior fixture preserves sentinel and rejects history drift",
      async () => {
        await reset(connection);
        assert.equal(await runMigrations(settings, { folder: join(fixtureRoot, "prior") }), 1);
        await connection.execute("INSERT INTO synthetic_parent VALUES (1, ?)", [
          "Синтетический / Synthetic 🚚",
        ]);
        extended = await extendedFixtureFolder();
        assert.equal(await runMigrations(settings, { folder: extended }), 15);
        assert.equal(await runMigrations(settings, { folder: extended }), 0);
        const [parents] = await connection.query<RowDataPacket[]>(
          "SELECT label FROM synthetic_parent WHERE id = 1",
        );
        assert.equal(parents[0]?.label, "Синтетический / Synthetic 🚚");
        const sqlPath = join(extended, "0000_synthetic_prior.sql");
        const original = await readFile(sqlPath, "utf8");
        await writeFile(sqlPath, `${original}\n-- synthetic checksum drift probe\n`);
        await assert.rejects(
          runMigrations(settings, { folder: extended }),
          /MIGRATION_HISTORY_DRIFT/,
        );
        await writeFile(sqlPath, original);
        assert.equal(await runMigrations(settings, { folder: extended }), 0);
        await connection.query(await readFile(join(fixtureRoot, "values.sql"), "utf8"));
      },
    );

    await t.test(
      "repositories and audit commit on the same connection, with active-context enforcement",
      async () => {
        let completed: TxContext | undefined;
        let escaped: PromiseLike<unknown> | undefined;
        const input = auditInput();
        const id = await unit.run(async (tx) => {
          completed = tx;
          const client = unit.client(tx);
          assert.throws(() => other.client(tx), /INACTIVE_OR_FOREIGN/);
          assert.throws(() => unit.client({} as TxContext), /INACTIVE_OR_FOREIGN/);
          const before = await rows(client, sql`SELECT CONNECTION_ID() AS id`);
          await client.insert(values).values(seed("committed"));
          const auditId = await audit.append(tx, input);
          const visible = await client
            .select()
            .from(auditEntries)
            .where(eq(auditEntries.id, auditId));
          assert.equal(visible[0]?.reason, input.reason);
          assert.equal(visible[0]?.actorId, input.actorId);
          assert.equal(visible[0]?.operation, input.operation);
          assert.equal(visible[0]?.subjectId, input.subjectId);
          assert.equal(visible[0]?.occurredAt, input.occurredAt);
          assert.deepEqual(await rows(client, sql`SELECT CONNECTION_ID() AS id`), before);
          escaped = client.select().from(auditEntries);
          return auditId;
        });
        assert.equal(applicationId(id), id);
        assert.ok(completed);
        const completedContext = completed;
        assert.throws(() => unit.client(completedContext), /INACTIVE_OR_FOREIGN/);
        await assert.rejects(audit.append(completed, input), /INACTIVE_OR_FOREIGN/);
        assert.ok(escaped);
        await assert.rejects(Promise.resolve(escaped), hasMessage("INACTIVE_OR_FOREIGN"));
        const [saved] = await connection.execute<RowDataPacket[]>(
          "SELECT COUNT(*) AS count FROM audit_entries WHERE id = ?",
          [Buffer.from(id)],
        );
        assert.equal(String(saved[0]?.count), "1");
      },
    );

    await t.test(
      "induced DML failure rolls back domain and audit together and invalidates context",
      async () => {
        let failed: TxContext | undefined;
        const item = seed("rollback");
        const [before] = await connection.query<RowDataPacket[]>(
          "SELECT COUNT(*) AS count FROM audit_entries",
        );
        await assert.rejects(
          unit.run(async (tx) => {
            failed = tx;
            await unit.client(tx).insert(values).values(item);
            await audit.append(tx, auditInput());
            await unit.client(tx).insert(values).values(item);
          }),
          hasCode("ER_DUP_ENTRY"),
        );
        const [after] = await connection.query<RowDataPacket[]>(
          "SELECT COUNT(*) AS count FROM audit_entries",
        );
        assert.equal(after[0]?.count, before[0]?.count);
        const [absent] = await connection.execute<RowDataPacket[]>(
          "SELECT COUNT(*) AS count FROM synthetic_values WHERE id = ?",
          [Buffer.from(item.id)],
        );
        assert.equal(String(absent[0]?.count), "0");
        assert.ok(failed);
        const failedContext = failed;
        assert.throws(() => unit.client(failedContext), /INACTIVE_OR_FOREIGN/);
        await unit.run(async (tx) => {
          assert.equal(
            String((await rows(unit.client(tx), sql`SELECT 1 AS healthy`))[0]?.healthy),
            "1",
          );
        });
      },
    );

    await t.test(
      "five concurrent connections reinitialize UTC, SQL modes and isolation after session tampering; saturation fails fast",
      async () => {
        const ids = new Set();
        for (const tamper of [true, false]) {
          let release = () => {};
          const gate = new Promise<void>((resolve) => {
            release = resolve;
          });
          let reached = 0;
          let allReady = () => {};
          const ready = new Promise<void>((resolve) => {
            allReady = resolve;
          });
          const commands = Array.from({ length: 5 }, () =>
            unit.run(async (tx) => {
              const client = unit.client(tx);
              const result = (
                await rows(
                  client,
                  sql`SELECT CONNECTION_ID() AS id, @@session.time_zone AS timezone, @@session.sql_mode AS modes, @@session.transaction_isolation AS isolationLevel, @@character_set_connection AS charsetName`,
                )
              )[0];
              assert.ok(result);
              ids.add(result.id);
              assert.equal(result.timezone, "+00:00");
              assert.equal(result.isolationLevel, "REPEATABLE-READ");
              assert.equal(result.charsetName, "utf8mb4");
              assert.deepEqual(
                String(result.modes).split(",").sort(),
                [...requiredSqlModes].sort(),
              );
              if (tamper)
                await client.execute(
                  sql`SET SESSION time_zone = '+03:00', sql_mode = 'NO_ENGINE_SUBSTITUTION', transaction_isolation = 'READ-COMMITTED'`,
                );
              if (++reached === 5) allReady();
              await gate;
            }),
          );
          try {
            await Promise.race([ready, Promise.all(commands)]);
            const start = Date.now();
            await assert.rejects(
              unit.run(async () => {}),
              /No connections available/,
            );
            assert.ok(Date.now() - start < 500);
          } finally {
            release();
            await Promise.all(commands);
          }
        }
        assert.equal(ids.size, 5, "successful transactions reuse the same bounded connections");
      },
    );

    await t.test(
      "opaque bytes distinguish case, accents, normalization and trailing spaces; labels and exact numbers roundtrip",
      async () => {
        const keys = [
          "Cargo",
          "cargo",
          "cárgo",
          "ca\u0301rgo",
          "cargo ",
          "cargo  ",
          "Груз",
          "груз",
        ];
        for (const key of keys) {
          const item = seed(key);
          await unit.run(async (tx) => {
            const client = unit.client(tx);
            await client.insert(values).values(item);
            const [stored] = await client.select().from(values).where(eq(values.id, item.id));
            assert.ok(stored);
            assert.deepEqual(stored.key, opaqueUtf8(key));
            assert.equal(stored.id, item.id);
            assert.equal(stored.label, item.label);
            assert.equal(stored.amount, item.amount);
            assert.equal(stored.largeInteger, item.largeInteger);
            assert.equal(stored.occurredAt, "2026-02-01T02:45:01.123Z");
          });
        }
        await assert.rejects(
          unit.run(async (tx) => {
            await unit.client(tx).insert(values).values(seed("cargo "));
          }),
          hasCode("ER_DUP_ENTRY"),
        );
        await assert.rejects(
          unit.run(async (tx) => {
            await unit
              .client(tx)
              .insert(values)
              .values({ ...seed("bad-parent"), parentId: 999 });
          }),
          hasCode("ER_NO_REFERENCED_ROW_2"),
        );
        await assert.rejects(
          connection.query("DELETE FROM synthetic_parent WHERE id = 1"),
          hasCode("ER_ROW_IS_REFERENCED_2"),
        );
        await unit.run(async (tx) => {
          const item = {
            ...seed("binary-hash"),
            key: opaqueBytes(Uint8Array.from([0, 255, 32, 0])),
            amount: "-0.000000000000000001",
            largeInteger: "-9223372036854775808",
            occurredAt: "2026-02-01T00:00:00.000Z",
          };
          const client = unit.client(tx);
          await client.insert(values).values(item);
          const [stored] = await client.select().from(values).where(eq(values.id, item.id));
          assert.ok(stored);
          assert.deepEqual(stored.key, item.key);
          assert.equal(stored.amount, item.amount);
          assert.equal(stored.largeInteger, item.largeInteger);
          assert.equal(stored.occurredAt, item.occurredAt);
        });
      },
    );

    await t.test(
      "precision/range/format violations are rejected without insertion or rounding",
      async () => {
        for (const value of [
          "100000000000000000000.0",
          "1.1234567890123456789",
          "1e3",
          "01",
          "NaN",
        ])
          assert.throws(() => decimal38_18(value));
        for (const value of ["9223372036854775808", "-9223372036854775809", "1.0", "1e3"])
          assert.throws(() => signedBigint(value));
        assert.equal(signedBigint("-9223372036854775808"), "-9223372036854775808");
        assert.throws(() => applicationId(newId().toUpperCase()));
        assert.throws(() => opaqueBytes(Buffer.alloc(513)));
        assert.throws(() => opaqueBytes(Buffer.alloc(3), 2));
        assert.throws(() => opaqueBytes(Buffer.alloc(513), 513));
        const corruptId = Buffer.from(newId());
        corruptId[0] = (corruptId[0] ?? 0) | 128;
        assert.throws(() => values.id.mapFromDriverValue(corruptId), /INVALID_APPLICATION_ID/);
        assert.throws(() => opaqueUtf8("\ud800"));
        for (const amount of ["1.1234567890123456789", "100000000000000000000"]) {
          await assert.rejects(
            unit.run(async (tx) => {
              await unit
                .client(tx)
                .insert(values)
                .values({ ...seed("invalid-decimal"), amount });
            }),
            hasMessage("DECIMAL_PRECISION_EXCEEDED"),
          );
        }
        const [absent] = await connection.execute<RowDataPacket[]>(
          "SELECT COUNT(*) AS count FROM synthetic_values WHERE opaque_key = ?",
          [opaqueUtf8("invalid-decimal")],
        );
        assert.equal(String(absent[0]?.count), "0");
        // Direct SQL still rejects overflow under strict SQL modes, but callers must use helpers
        // for excessive fractional scale: MySQL can round that scale even in strict mode.
        await assert.rejects(
          connection.query(
            "INSERT INTO synthetic_values VALUES (?, 1, ?, 'Synthetic', ?, '1', '2026-02-01 00:00:00.000')",
            [Buffer.from(newId()), opaqueUtf8("raw-overflow"), "100000000000000000000"],
          ),
          hasCode("ER_WARN_DATA_OUT_OF_RANGE"),
        );
      },
    );

    await t.test(
      "UTC millisecond conversion is independent of process timezone and rejects ambiguous/lossy timestamps",
      async () => {
        assert.equal(utcDateTime("2026-02-01T05:45:01.123+03:00"), "2026-02-01 02:45:01.123");
        assert.equal(utcIso("2026-02-01 02:45:01.123"), "2026-02-01T02:45:01.123Z");
        for (const value of [
          "2026-02-01 02:45:01.123",
          "2026-02-30T00:00:00Z",
          "2026-02-01T00:00:00.1234Z",
        ])
          assert.throws(() => utcDateTime(value));
        const child = spawn(
          process.execPath,
          ["--import", "tsx", "test/persistence/timezone-probe.ts"],
          { cwd: root, env: { ...process.env, TZ: "Pacific/Honolulu" }, stdio: "ignore" },
        );
        assert.equal(
          await new Promise((resolve, reject) => {
            child.once("error", reject);
            child.once("exit", resolve);
          }),
          0,
        );
      },
    );

    await t.test(
      "audit rejects private/unknown properties and unregistered values before persistence",
      async () => {
        const [before] = await connection.query<RowDataPacket[]>(
          "SELECT COUNT(*) AS count FROM audit_entries",
        );
        for (const invalid of [
          { ...auditInput(), password: "NONFUNCTIONAL_EXAMPLE_ONLY" },
          { ...auditInput(), payload: { email: "fictional@example.invalid" } },
          { ...auditInput(), reason: "free text is forbidden" },
          { ...auditInput(), operation: "unregistered.operation" },
          { ...auditInput(), subjectKind: "unregistered" },
          { ...auditInput(), actorKind: "system", actorId: newId() },
          Object.defineProperty(auditInput(), "password", { value: "NONFUNCTIONAL_EXAMPLE_ONLY" }),
          Object.defineProperty(auditInput(), "operation", {
            enumerable: true,
            get: () => "configuration.changed",
          }),
        ])
          await assert.rejects(
            unit.run((tx) => audit.append(tx, invalid as AuditInput)),
            /INVALID_AUDIT|UNREGISTERED_AUDIT/,
          );
        const [after] = await connection.query<RowDataPacket[]>(
          "SELECT COUNT(*) AS count FROM audit_entries",
        );
        assert.equal(after[0]?.count, before[0]?.count);
        await unit.run((tx) =>
          audit.append(tx, { ...auditInput(), actorKind: "system", actorId: null }),
        );
      },
    );

    await t.test(
      "migration lock contention is bounded, serializes callers and releases after failure/disconnect",
      async () => {
        assert.ok(extended);
        const lock = migrationLockName(settings.database);
        await connection.query("SELECT GET_LOCK(?, 0)", [lock]);
        const start = Date.now();
        await assert.rejects(
          runMigrations(settings, { folder: extended, lockTimeoutSeconds: 1 }),
          /MIGRATION_LOCK_UNAVAILABLE/,
        );
        assert.ok(Date.now() - start >= 900 && Date.now() - start < 3500);
        await connection.query("SELECT RELEASE_LOCK(?)", [lock]);
        assert.deepEqual(await cooperatingMigrations(settings, "replay", extended), [0, 0]);
        const disposable = await testConnection();
        await disposable.query("SELECT GET_LOCK(?, 0)", [lock]);
        // Begin a cooperating waiter, then terminate the lock holder's connection.
        const waiter = runMigrations(settings, { folder: extended, lockTimeoutSeconds: 2 });
        await delay(100);
        disposable.destroy();
        assert.equal(await waiter, 0);
        const [history] = await connection.query<RowDataPacket[]>(
          "SELECT COUNT(*) AS count FROM _vtc_migrations",
        );
        // The extended fixture retains its synthetic prior entry plus fifteen current migrations.
        assert.equal(String(history[0]?.count), "16");
      },
    );
  } finally {
    try {
      await unit.close();
    } finally {
      try {
        await other.close();
      } finally {
        try {
          await connection.end();
        } finally {
          if (extended) await rm(extended, { recursive: true });
        }
      }
    }
  }
});
