import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { types } from "node:util";

// The production deployment installs mysql2 as @vtc/db's dependency, not the API's.
const mysql = createRequire(import.meta.resolve("@vtc/db"))("mysql2/promise");

const revision = /^[a-f0-9]{40}$/.test(process.env.VTC_REVISION ?? "")
  ? process.env.VTC_REVISION
  : "local";
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: 3306,
  database: "vtc_operations",
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  connectionLimit: 1,
  waitForConnections: false,
  connectTimeout: 1000,
  timezone: "Z",
});
const nativeCodes = new Set([
  "PROTOCOL_SEQUENCE_TIMEOUT",
  "PROTOCOL_CONNECTION_LOST",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ER_ACCESS_DENIED_ERROR",
  "ER_DBACCESS_DENIED_ERROR",
  "ER_BAD_DB_ERROR",
  "ER_CON_COUNT_ERROR",
  "ER_TOO_MANY_USER_CONNECTIONS",
  "ER_NO_SUCH_TABLE",
  "ER_BAD_FIELD_ERROR",
  "ER_TABLEACCESS_DENIED_ERROR",
  "ER_COLUMNACCESS_DENIED_ERROR",
  "ER_LOCK_WAIT_TIMEOUT",
  "ER_LOCK_DEADLOCK",
]);
function monotonicNow() {
  try {
    const now = performance.now();
    return Number.isFinite(now) ? now : null;
  } catch {
    return null;
  }
}
function heartbeatFailure(phase, error, started) {
  let nativeCode = "unknown";
  try {
    if (types.isNativeError(error) && !types.isProxy(error)) {
      const code = Object.getOwnPropertyDescriptor(error, "code")?.value;
      if (typeof code === "string" && nativeCodes.has(code)) nativeCode = code;
    }
  } catch {
    // Accessors, proxies and non-errors provide no trusted native code.
  }
  const now = monotonicNow();
  const elapsed = started === null || now === null ? null : now - started;
  return {
    event: "probe.heartbeat_failed",
    schemaVersion: 1,
    phase: phase === "acquire" || phase === "query" ? phase : "unknown",
    nativeCode,
    elapsedMs:
      elapsed !== null && elapsed >= 0 && elapsed <= Number.MAX_SAFE_INTEGER
        ? Math.floor(elapsed)
        : null,
    deadlineMs: 1000,
  };
}
async function query(sql, observeFailure) {
  let connection;
  let phase = "acquire";
  let started = monotonicNow();
  try {
    connection = await pool.getConnection();
    phase = "query";
    started = monotonicNow();
    return await connection.query({ sql, timeout: 1000 });
  } catch (error) {
    if (observeFailure) {
      try {
        observeFailure(heartbeatFailure(phase, error, started));
      } catch {
        // Observability cannot replace the database failure or block disposal.
      }
    }
    if (connection) {
      connection.destroy();
      throw new Error("PROBE_DATABASE_UNAVAILABLE");
    }
    throw error;
  } finally {
    connection?.release();
  }
}
if (process.argv[2] === "heartbeat") {
  let failure = heartbeatFailure("unknown", null, null);
  try {
    await query(
      "INSERT INTO heartbeat (singleton, at_utc, sequence) VALUES (1, UTC_TIMESTAMP(3), 1) ON DUPLICATE KEY UPDATE at_utc=UTC_TIMESTAMP(3), sequence=sequence+1",
      (record) => {
        failure = record;
      },
    );
    console.log("Heartbeat: success");
  } catch {
    console.error("Heartbeat: unavailable");
    try {
      console.error(JSON.stringify(failure));
    } catch {
      // A missing diagnostic does not turn the failed heartbeat into success.
    }
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
} else if (process.argv[2] === "serve" && /^[a-f0-9]{64}$/.test(process.env.OPERATOR_TOKEN ?? "")) {
  const expected = Buffer.from(`Bearer ${process.env.OPERATOR_TOKEN}`);
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "application/json");
    const supplied = Buffer.from(request.headers.authorization ?? "");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      response.writeHead(401).end('{"code":"OPERATOR_AUTH_REQUIRED"}');
      return;
    }
    if (
      request.method !== "GET" ||
      !["/release", "/heartbeat", "/readiness"].includes(request.url)
    ) {
      response.writeHead(404).end('{"code":"NOT_FOUND"}');
      return;
    }
    try {
      const started = Date.now();
      if (request.url === "/readiness") {
        const ready = await fetch("http://app:3000/health/ready", {
          signal: AbortSignal.timeout(4000),
        });
        if (!ready.ok) throw new Error("APPLICATION_UNAVAILABLE");
        await ready.body?.cancel();
      }
      const [rows] = await query(
        "SELECT DATE_FORMAT(at_utc, '%Y-%m-%dT%H:%i:%s.%fZ') AS atUtc, CAST(sequence AS CHAR) AS sequence FROM heartbeat WHERE singleton=1",
      );
      response.end(
        JSON.stringify({
          revision,
          database: "available",
          heartbeat: rows[0] ? { atUtc: rows[0].atUtc, sequence: rows[0].sequence } : null,
          durationMs: Date.now() - started,
        }),
      );
    } catch {
      response.writeHead(503).end(JSON.stringify({ code: "PROBE_DATABASE_UNAVAILABLE", revision }));
    }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.listen(3001, "0.0.0.0");
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () =>
      server.close(() => {
        pool.end().finally(() => process.exit());
      }),
    );
} else {
  await pool.end();
  process.exitCode = 1;
}
