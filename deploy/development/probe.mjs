import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";

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
async function query(sql) {
  const connection = await pool.getConnection();
  try {
    return await connection.query({ sql, timeout: 1000 });
  } catch {
    connection.destroy();
    throw new Error("PROBE_DATABASE_UNAVAILABLE");
  } finally {
    connection.release();
  }
}
if (process.argv[2] === "heartbeat") {
  try {
    await query(
      "INSERT INTO heartbeat (singleton, at_utc, sequence) VALUES (1, UTC_TIMESTAMP(3), 1) ON DUPLICATE KEY UPDATE at_utc=UTC_TIMESTAMP(3), sequence=sequence+1",
    );
    console.log("Heartbeat: success");
  } catch {
    console.error("Heartbeat: unavailable");
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
