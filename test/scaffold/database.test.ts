import assert from "node:assert/strict";
import type { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import type { AddressInfo, Server, Socket } from "node:net";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createDatabase, expectedMysqlVersion, requiredSqlModes } from "@vtc/db";
import { createApp } from "../../apps/api/src/app.ts";

// mysql2's test-server API is only partly typed; these are the fixture's used methods.
interface FixtureConnection extends EventEmitter {
  stream: Socket;
  sequenceId: number;
  serverHandshake(options: Record<string, unknown>): void;
  writeOk(): void;
  writeColumns(columns: Record<string, string | number>[]): void;
  writeTextRow(row: string[]): void;
  writeEof(): void;
}
interface FixtureServer extends EventEmitter {
  _server: Server;
  close(callback: (error?: Error) => void): void;
}
const require = createRequire(new URL("../../packages/db/package.json", import.meta.url));
const mysql = require("mysql2") as { createServer(): FixtureServer };
type Phase = "handshake" | "session" | "select" | "healthy";

async function bounded<T>(work: Promise<T>, milliseconds = 2500): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Fixture deadline exceeded")), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function fixture(initialPhase: Phase) {
  let phase = initialPhase;
  let sessions = 0;
  const sockets = new Set<Socket>();
  const server = mysql.createServer();
  server.on("connection", (connection: FixtureConnection) => {
    sockets.add(connection.stream);
    connection.stream.once("close", () => sockets.delete(connection.stream));
    connection.on("error", () => {});
    if (phase === "handshake") return;
    let authenticated = false;
    // The fixture server keeps one command object; reset packet IDs for each command.
    connection.stream.prependListener("data", () => {
      if (authenticated) connection.sequenceId = 0;
    });
    connection.serverHandshake({
      protocolVersion: 10,
      serverVersion: expectedMysqlVersion,
      connectionId: 1,
      statusFlags: 2,
      characterSet: 45,
      capabilityFlags: 0x00088200,
      authCallback: (_input: unknown, done: (error: null) => void) => {
        authenticated = true;
        done(null);
      },
    });
    connection.on("stmt_prepare", () => {
      sessions++;
      if (phase !== "session") connection.writeOk();
    });
    connection.on("query", () => {
      if (phase === "select") return;
      const row = {
        version: expectedMysqlVersion,
        timezone: "+00:00",
        serverTimezone: "+00:00",
        engineName: "InnoDB",
        sqlMode: requiredSqlModes.join(","),
        isolationLevel: "REPEATABLE-READ",
        charsetName: "utf8mb4",
        collationName: "utf8mb4_0900_ai_ci",
      };
      connection.writeColumns(
        Object.keys(row).map((name) => ({
          catalog: "def",
          schema: "",
          table: "",
          orgTable: "",
          name,
          orgName: name,
          characterSet: 45,
          columnLength: 255,
          columnType: 253,
          flags: 0,
          decimals: 0,
        })),
      );
      connection.writeTextRow(Object.values(row));
      connection.writeEof();
    });
  });
  await new Promise<void>((resolve) => server._server.listen(0, "127.0.0.1", resolve));
  const database = createDatabase({
    host: "127.0.0.1",
    port: (server._server.address() as AddressInfo).port,
    database: "synthetic_database",
    user: "synthetic_user",
    password: "NONFUNCTIONAL_EXAMPLE_ONLY",
  });
  return {
    database,
    setPhase(value: Phase) {
      phase = value;
    },
    async waitForSessions(count: number) {
      const deadline = Date.now() + 2500;
      while (sessions < count && Date.now() < deadline) await delay(10);
      assert.ok(sessions >= count, "Fixture did not receive expected sessions");
    },
    async close() {
      // Test watchdogs must also dispose underlying work if a regression hangs a probe.
      try {
        await bounded(database.close());
      } finally {
        for (const socket of sockets) socket.destroy();
        await bounded(new Promise<void>((resolve) => server.close(() => resolve())));
      }
    },
  };
}

test("readiness bounds stalled MySQL handshakes and both query phases, then recovers", async () => {
  for (const phase of ["handshake", "session", "select"] as const) {
    const stub = await fixture(phase);
    const app = await createApp({ checkReadiness: stub.database.check });
    try {
      const failed = await bounded(app.inject("/health/ready"));
      assert.equal(failed.statusCode, 503, phase);
      assert.deepEqual(failed.json(), { status: "not_ready" });
      assert.equal((await app.inject("/health/live")).statusCode, 200);
      stub.setPhase("healthy");
      assert.equal((await bounded(app.inject("/health/ready"))).statusCode, 200, phase);
    } finally {
      await stub.close();
      await app.close();
    }
  }
});

test("saturated readiness pool rejects without queuing and replaces timed-out connections", async () => {
  const stub = await fixture("session");
  const pending = Array.from({ length: 5 }, () =>
    stub.database.check().then(
      () => "unexpected_success",
      () => "rejected",
    ),
  );
  try {
    await stub.waitForSessions(5);
    await assert.rejects(bounded(stub.database.check(), 500), /No connections available/);
    assert.deepEqual(await bounded(Promise.all(pending)), Array(5).fill("rejected"));
    stub.setPhase("healthy");
    assert.equal(await bounded(stub.database.check()), true);
  } finally {
    await stub.close();
    await Promise.all(pending);
  }
});
