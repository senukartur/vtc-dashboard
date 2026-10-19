import { identityDiagnostics } from "../support/identity-diagnostics.ts";
import { createAudit, createUnitOfWork, dedicatedConnection, runMigrations } from "@vtc/db";
import { sql } from "drizzle-orm";
import type { Connection, RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, expect, test } from "vitest";
import { guardedSettings, hasCode, reset, testConnection } from "../persistence/support.ts";
import { clock, idGenerator } from "../support/builders.ts";
import { barrier, bounded, connections, deferred, transaction } from "../support/concurrency.ts";

const diagnostic = identityDiagnostics("concurrency");
let control: Connection;
beforeAll(async () => {
  control = await diagnostic.phase("connection", () => testConnection());
  await diagnostic.phase("reset", () => reset(control));
  await diagnostic.phase("migrations", () => runMigrations(guardedSettings()));
  await diagnostic.phase("synthetic_ddl", () =>
    control.query(
      "CREATE TABLE synthetic_race (id INT PRIMARY KEY, source_key VARBINARY(64) NOT NULL UNIQUE, payload VARCHAR(64) NOT NULL, touches INT NOT NULL DEFAULT 0) ENGINE=InnoDB",
    ),
  );
  await diagnostic.phase("synthetic_ddl", () =>
    control.query(
      "CREATE TABLE synthetic_jobs (id INT PRIMARY KEY, token VARCHAR(36), lease_until DATETIME(3), done BOOLEAN NOT NULL DEFAULT FALSE) ENGINE=InnoDB",
    ),
  );
});
afterAll(async () => {
  await control?.end();
});

async function rows(connection: Connection, statement: string, values: unknown[] = []) {
  return (await connection.query<RowDataPacket[]>({ sql: statement, values, timeout: 3500 }))[0];
}

test("racing unique source keys leave one immutable input, including a conflicting replay", async () => {
  await connections(guardedSettings(), 2, async ([a, b]) => {
    if (!a || !b) throw new Error("CONNECTIONS_MISSING");
    const meet = barrier(2);
    const results = await Promise.allSettled(
      [a, b].map((client, i) =>
        transaction(client, async () => {
          await meet();
          await client.execute(
            "INSERT INTO synthetic_race (id, source_key, payload) VALUES (?, ?, ?)",
            [i + 1, Buffer.from("same-event"), `input-${i}`],
          );
        }),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((result) => result.status === "rejected");
    expect(failed?.status === "rejected" && hasCode("ER_DUP_ENTRY")(failed.reason)).toBe(true);
    const [saved] = await rows(control, "SELECT payload FROM synthetic_race WHERE source_key = ?", [
      Buffer.from("same-event"),
    ]);
    expect(["input-0", "input-1"]).toContain(saved?.payload);
    await expect(
      control.execute(
        "INSERT INTO synthetic_race (id, source_key, payload) VALUES (3, ?, 'conflicting')",
        [Buffer.from("same-event")],
      ),
    ).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
    expect((await rows(control, "SELECT payload FROM synthetic_race"))[0]?.payload).toBe(
      saved?.payload,
    );
    // Identical replays also cannot multiply the row.
    await expect(
      control.execute("INSERT INTO synthetic_race (id, source_key, payload) VALUES (4, ?, ?)", [
        Buffer.from("same-event"),
        saved?.payload,
      ]),
    ).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
    expect(await rows(control, "SELECT id FROM synthetic_race")).toHaveLength(1);
  });
});

test("two consumers skip held rows, persist leases across reconnect and reject stale completion", async () => {
  await control.query("INSERT INTO synthetic_jobs (id) VALUES (1), (2)");
  const ids = idGenerator("leases");
  const time = clock("2026-02-01T00:00:00.000Z");
  const tokens = [ids.nextId(), ids.nextId()] as const;
  const locked = deferred<void>();
  const release = deferred<void>();
  await connections(guardedSettings(), 2, async ([a, b]) => {
    if (!a || !b) throw new Error("CONNECTIONS_MISSING");
    const first = transaction(a, async () => {
      const row = (
        await rows(
          a,
          "SELECT id FROM synthetic_jobs WHERE token IS NULL ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED",
        )
      )[0];
      expect(row?.id).toBe(1);
      await a.execute("UPDATE synthetic_jobs SET token = ?, lease_until = ? WHERE id = 1", [
        tokens[0],
        "2026-02-01 00:00:10.000",
      ]);
      locked.resolve();
      await bounded(release.promise, "lease-release");
    });
    const second = (async () => {
      try {
        await bounded(locked.promise, "lease-lock");
        await transaction(b, async () => {
          const row = (
            await rows(
              b,
              "SELECT id FROM synthetic_jobs WHERE token IS NULL ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED",
            )
          )[0];
          expect(row?.id).toBe(2);
          await b.execute("UPDATE synthetic_jobs SET token = ?, lease_until = ? WHERE id = 2", [
            tokens[1],
            "2026-02-01 00:00:10.000",
          ]);
        });
      } finally {
        release.resolve();
      }
    })();
    await Promise.all([first, second]);
  });
  const reconnected = await dedicatedConnection(guardedSettings());
  try {
    expect(
      (await rows(reconnected, "SELECT token FROM synthetic_jobs ORDER BY id")).map(
        (row) => row.token,
      ),
    ).toEqual(tokens);
    time.advance(11000);
    const reclaimed = ids.nextId();
    await reconnected.execute(
      "UPDATE synthetic_jobs SET token = ?, lease_until = '2026-02-01 00:00:21.000' WHERE id = 1 AND lease_until < ?",
      [reclaimed, time.nowUtc().replace("T", " ").replace("Z", "")],
    );
    const [stale] = await reconnected.execute(
      "UPDATE synthetic_jobs SET done = TRUE WHERE id = 1 AND token = ?",
      [tokens[0]],
    );
    expect((stale as { affectedRows: number }).affectedRows).toBe(0);
    const [fresh] = await reconnected.execute(
      "UPDATE synthetic_jobs SET done = TRUE WHERE id = 1 AND token = ?",
      [reclaimed],
    );
    expect((fresh as { affectedRows: number }).affectedRows).toBe(1);
  } finally {
    await reconnected.end();
  }
});

test("opposed lock order causes a real deadlock and bounded whole-transaction retry", async () => {
  await control.query(
    "INSERT INTO synthetic_race (id, source_key, payload) VALUES (10, 'lock-a', 'synthetic'), (20, 'lock-b', 'synthetic')",
  );
  const meet = barrier(2);
  const attempts = [0, 0];
  await connections(guardedSettings(), 2, async (clients) => {
    await Promise.all(
      clients.map((client, index) =>
        transaction(client, async (attempt) => {
          attempts[index] = attempt;
          const order = index === 0 ? ([10, 20] as const) : ([20, 10] as const);
          await client.execute("UPDATE synthetic_race SET touches = touches + 1 WHERE id = ?", [
            order[0],
          ]);
          if (attempt === 1) await meet();
          await client.execute("UPDATE synthetic_race SET touches = touches + 1 WHERE id = ?", [
            order[1],
          ]);
        }),
      ),
    );
  });
  expect(attempts.sort()).toEqual([1, 2]);
  expect(
    (await rows(control, "SELECT touches FROM synthetic_race WHERE id IN (10,20) ORDER BY id")).map(
      (row) => row.touches,
    ),
  ).toEqual([2, 2]);
});

test("callback failure rolls back synthetic write and audit on the same transaction", async () => {
  const unit = diagnostic.unit(createUnitOfWork(guardedSettings()), control);
  const audit = createAudit(unit);
  const ids = idGenerator("audit");
  try {
    await expect(
      unit.run(async (tx) => {
        await unit
          .client(tx)
          .execute(
            sql`INSERT INTO synthetic_race (id, source_key, payload) VALUES (30, 'rollback', 'synthetic')`,
          );
        await audit.append(tx, {
          actorKind: "system",
          actorId: null,
          operation: "configuration.changed",
          subjectKind: "company",
          subjectId: ids.nextId(),
          occurredAt: clock().nowUtc(),
          reason: "operator_request",
        });
        throw new Error("SYNTHETIC_CALLBACK_FAILURE");
      }),
    ).rejects.toThrow("SYNTHETIC_CALLBACK_FAILURE");
    expect(await rows(control, "SELECT id FROM synthetic_race WHERE id = 30")).toHaveLength(0);
    expect(await rows(control, "SELECT id FROM audit_entries")).toHaveLength(0);
  } finally {
    await unit.close();
  }
});

test("same-schema suite competition fails immediately; database grant cannot see other allocations", async () => {
  const start = Date.now();
  expect(
    Number(
      (
        await rows(control, "SELECT GET_LOCK(?, 0) AS acquired", [
          `vtc008:${guardedSettings().database}`,
        ])
      )[0]?.acquired,
    ),
  ).toBe(0);
  expect(Date.now() - start).toBeLessThan(1000);
  await expect(control.query("CREATE DATABASE vtc_test_forbidden")).rejects.toMatchObject({
    code: "ER_DBACCESS_DENIED_ERROR",
  });
  await expect(control.query("SELECT User FROM mysql.user")).rejects.toMatchObject({
    code: "ER_TABLEACCESS_DENIED_ERROR",
  });
});
