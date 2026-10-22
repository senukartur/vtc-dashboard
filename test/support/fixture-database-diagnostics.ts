import type { Connection, RowDataPacket } from "mysql2/promise";
import { safeIdentityFailure } from "./identity-diagnostics.ts";

export type DatabaseFixtureCase =
  | "admissions_flood"
  | "generation_progress"
  | "generation_late"
  | "generation_retry"
  | "manual_storage";

// Failure-only observations do not pace the successful request/worker path. These
// are own-user counts and explicitly global counters, never process rows or IDs.
export async function fixtureDatabaseFailure(control: Connection, caseId: DatabaseFixtureCase) {
  if (
    ![
      "admissions_flood",
      "generation_progress",
      "generation_late",
      "generation_retry",
      "manual_storage",
    ].includes(caseId)
  )
    throw Error("INVALID_DATABASE_FIXTURE_SCOPE");
  const count = (value: unknown) => {
    const text = String(value),
      number = Number(text);
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(number) || number < 0)
      throw Error("INVALID_FIXTURE_COUNTER");
    return number;
  };
  const started = performance.now();
  try {
    const [owned] = await control.query<RowDataPacket[]>({
      sql: "SELECT COUNT(*) total FROM information_schema.PROCESSLIST WHERE USER=SUBSTRING_INDEX(CURRENT_USER(),'@',1)",
      timeout: 500,
    });
    const [global] = await control.query<RowDataPacket[]>({
      sql: "SHOW GLOBAL STATUS WHERE Variable_name IN ('Connections','Threads_connected','Threads_running','Aborted_clients','Connection_errors_max_connections')",
      timeout: 500,
    });
    const allowed = new Set([
      "Connections",
      "Threads_connected",
      "Threads_running",
      "Aborted_clients",
      "Connection_errors_max_connections",
    ]);
    const serverGlobal = Object.fromEntries(
      global
        .filter((row) => allowed.has(row.Variable_name) && /^\d+$/.test(String(row.Value)))
        .map((row) => [row.Variable_name, count(row.Value)]),
    );
    let queue:
      | {
          activeRunnerLeases: number;
          runnerRemainingMs: number;
          readyJobs: number;
          runningJobs: number;
        }
      | undefined;
    if (caseId !== "admissions_flood") {
      const [rows] = await control.query<RowDataPacket[]>({
        sql: "SELECT (SELECT COUNT(*) FROM job_runner_leases WHERE lease_until>UTC_TIMESTAMP(3)) active,(SELECT COALESCE(MAX(GREATEST(0,TIMESTAMPDIFF(MICROSECOND,UTC_TIMESTAMP(3),lease_until) DIV 1000)),0) FROM job_runner_leases) remaining,(SELECT COUNT(*) FROM durable_jobs WHERE state='ready') ready,(SELECT COUNT(*) FROM durable_jobs WHERE state='running') running",
        timeout: 500,
      });
      queue = {
        activeRunnerLeases: count(rows[0]?.active),
        runnerRemainingMs: count(rows[0]?.remaining),
        readyJobs: count(rows[0]?.ready),
        runningJobs: count(rows[0]?.running),
      };
    }
    console.log(
      JSON.stringify({
        event: "fixture_database_failure",
        caseId,
        durationMs: Math.round(performance.now() - started),
        ownedUserConnections: count(owned[0]?.total),
        serverGlobal,
        ...(queue ? { queue } : {}),
      }),
    );
  } catch (error) {
    console.log(
      JSON.stringify({
        event: "fixture_database_failure",
        caseId,
        state: "unavailable",
        durationMs: Math.round(performance.now() - started),
        ...safeIdentityFailure(error),
      }),
    );
  }
}
