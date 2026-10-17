import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  type AuditInput,
  applicationId,
  auditEntries,
  bigintColumn,
  createAudit,
  createDatabase,
  createUnitOfWork,
  decimal38_18,
  decimalColumn,
  idColumn,
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
import {
  extendedFixtureFolder,
  fixtureRoot,
  guardedSettings,
  hasCode,
  hasMessage,
  reset,
  root,
  testConnection,
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

test("real MySQL persistence foundations", { timeout: 60000 }, async (t) => {
  const settings = guardedSettings();
  const connection = await testConnection();
  const unit = createUnitOfWork(settings);
  const other = createUnitOfWork(settings);
  const audit = createAudit(unit);
  let extended: string | undefined;
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
      assert.equal(await runMigrations(settings), 1);
      assert.equal(await runMigrations(settings), 0);
      const [tables] = await connection.query<RowDataPacket[]>(
        "SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_entries'",
      );
      assert.equal(tables[0]?.ENGINE, "InnoDB");
    });

    await t.test(
      "additive migration from committed prior fixture preserves sentinel and rejects history drift",
      async () => {
        await reset(connection);
        assert.equal(await runMigrations(settings, { folder: join(fixtureRoot, "prior") }), 1);
        await connection.execute("INSERT INTO synthetic_parent VALUES (1, ?)", [
          "Синтетический / Synthetic 🚚",
        ]);
        extended = await extendedFixtureFolder();
        assert.equal(await runMigrations(settings, { folder: extended }), 1);
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
        assert.deepEqual(
          await Promise.all([
            runMigrations(settings, { folder: extended }),
            runMigrations(settings, { folder: extended }),
          ]),
          [0, 0],
        );
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
        assert.equal(String(history[0]?.count), "2");
        await reset(connection);
        assert.deepEqual(
          (await Promise.all([runMigrations(settings), runMigrations(settings)])).sort(),
          [0, 1],
        );
        const [singleApply] = await connection.query<RowDataPacket[]>(
          "SELECT COUNT(*) AS count FROM _vtc_migrations WHERE state = 'applied'",
        );
        assert.equal(String(singleApply[0]?.count), "1");
      },
    );
  } finally {
    await unit.close();
    await other.close();
    await connection.end();
    if (extended) await rm(extended, { recursive: true });
  }
});
