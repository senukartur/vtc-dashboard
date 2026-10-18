import { databaseFailureContext, type UnitOfWork } from "@vtc/db";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import type { Connection, RowDataPacket } from "mysql2/promise";

type Fixture = "identity" | "admission" | "availability" | "email" | "reset" | "concurrency";
type Phase =
  | "connection"
  | "reset"
  | "migrations"
  | "synthetic_ddl"
  | "bootstrap"
  | "verification"
  | "operation"
  | "transaction";
const codes = new Set([
  "PROTOCOL_SEQUENCE_TIMEOUT",
  "ETIMEDOUT",
  "ER_LOCK_WAIT_TIMEOUT",
  "ER_LOCK_DEADLOCK",
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
  "PROTOCOL_CONNECTION_LOST",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ER_CON_COUNT_ERROR",
  "ER_TOO_MANY_USER_CONNECTIONS",
  "ER_DUP_ENTRY",
  "ER_NO_SUCH_TABLE",
  "ER_TABLE_EXISTS_ERROR",
  "ER_NO_REFERENCED_ROW_2",
  "ER_ROW_IS_REFERENCED_2",
  "TRANSACTION_COMMIT_OUTCOME_UNKNOWN",
]);

// Never serialize the exception: driver/repository messages may contain private SQL/inputs.
export function safeIdentityFailure(error: unknown) {
  const result: {
    statusCode?: number;
    codes: string[];
    category: string;
    databaseOperation?: NonNullable<ReturnType<typeof databaseFailureContext>>;
  } = {
    codes: [],
    category: "unclassified",
  };
  const context = databaseFailureContext(error);
  if (context) result.databaseOperation = context;
  const seen = new Set<object>();
  let current = error;
  for (
    let depth = 0;
    depth < 8 && current && typeof current === "object" && !seen.has(current);
    depth++
  ) {
    seen.add(current);
    if (
      "statusCode" in current &&
      typeof current.statusCode === "number" &&
      Number.isInteger(current.statusCode) &&
      current.statusCode >= 400 &&
      current.statusCode <= 599
    )
      result.statusCode ??= current.statusCode;
    if (
      "code" in current &&
      typeof current.code === "string" &&
      codes.has(current.code) &&
      !result.codes.includes(current.code)
    )
      result.codes.push(current.code);
    if (current instanceof Error) {
      if (current.message === "TRANSACTION_CONTROL_TIMEOUT")
        result.category = "transaction_control_timeout";
      if (["No connections available.", "Pool is closed."].includes(current.message))
        result.category = "pool_capacity";
      if (current.message === "TEST_DATABASE_BASELINE_MISMATCH")
        result.category = "baseline_mismatch";
    }
    current = "cause" in current ? current.cause : null;
  }
  return result;
}

export function identityDiagnostics(fixture: Fixture) {
  let captured = false;
  const emit = (
    phase: Phase,
    state: "started" | "success" | "failed",
    durationMs: number | null,
    error?: unknown,
  ) =>
    console.log(
      JSON.stringify({
        event: "identity_fixture",
        fixture,
        phase,
        state,
        durationMs,
        ...(state === "failed" ? safeIdentityFailure(error) : {}),
      }),
    );
  return {
    failure(error: unknown, durationMs: number | null = null) {
      emit("operation", "failed", durationMs === null ? null : Math.round(durationMs), error);
    },
    async phase<T>(phase: Phase, work: () => Promise<T>): Promise<T> {
      const started = performance.now();
      emit(phase, "started", 0);
      try {
        const result = await work();
        emit(phase, "success", Math.round(performance.now() - started));
        return result;
      } catch (error) {
        emit(phase, "failed", Math.round(performance.now() - started), error);
        throw Object.assign(new Error("IDENTITY_FIXTURE_PHASE_FAILED"), safeIdentityFailure(error));
      }
    },
    unit(unit: UnitOfWork, control?: Connection): UnitOfWork {
      const delay = monitorEventLoopDelay({ resolution: 10 });
      delay.enable();
      return {
        client: (tx) => unit.client(tx),
        async close() {
          delay.disable();
          await unit.close();
        },
        async run(command) {
          const started = performance.now();
          const utilization = performance.eventLoopUtilization();
          try {
            return await unit.run(command);
          } catch (error) {
            emit("transaction", "failed", Math.round(performance.now() - started), error);
            if (
              !captured &&
              safeIdentityFailure(error).codes.includes("TRANSACTION_COMMIT_OUTCOME_UNKNOWN")
            ) {
              captured = true;
              console.log(
                JSON.stringify({
                  event: "identity_fixture_unknown_commit",
                  fixture,
                  eventLoopMaximumMs: Math.round(delay.max / 1_000_000),
                  eventLoopMeanMs: Number.isFinite(delay.mean)
                    ? Math.round(delay.mean / 1_000_000)
                    : 0,
                  eventLoopUtilization: performance.eventLoopUtilization(utilization).utilization,
                }),
              );
              if (control) {
                const captureStarted = performance.now();
                try {
                  const [rows] = await control.query<RowDataPacket[]>({
                    sql: "SHOW GLOBAL STATUS WHERE Variable_name IN ('Com_commit','Innodb_log_waits','Innodb_os_log_fsyncs','Innodb_os_log_pending_fsyncs','Innodb_os_log_pending_writes','Threads_running')",
                    timeout: 500,
                  });
                  const allowed = new Set([
                    "Com_commit",
                    "Innodb_log_waits",
                    "Innodb_os_log_fsyncs",
                    "Innodb_os_log_pending_fsyncs",
                    "Innodb_os_log_pending_writes",
                    "Threads_running",
                  ]);
                  const counters = Object.fromEntries(
                    rows
                      .filter(
                        (row) => allowed.has(row.Variable_name) && /^\d+$/.test(String(row.Value)),
                      )
                      .map((row) => [row.Variable_name, Number(row.Value)]),
                  );
                  console.log(
                    JSON.stringify({
                      event: "identity_fixture_commit_status",
                      fixture,
                      durationMs: Math.round(performance.now() - captureStarted),
                      counters,
                    }),
                  );
                } catch (captureError) {
                  console.log(
                    JSON.stringify({
                      event: "identity_fixture_commit_status",
                      fixture,
                      durationMs: Math.round(performance.now() - captureStarted),
                      state: "unavailable",
                      ...safeIdentityFailure(captureError),
                    }),
                  );
                }
              }
            }
            throw error;
          }
        },
      };
    },
  };
}
