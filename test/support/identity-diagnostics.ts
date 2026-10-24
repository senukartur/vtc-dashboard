import { AsyncLocalStorage } from "node:async_hooks";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { databaseFailureContext, type UnitOfWork } from "@vtc/db";
import type { Connection, RowDataPacket } from "mysql2/promise";
import { type GenerationPhase, scopedTransactionLine } from "./manual-generation-diagnostics.ts";

type Fixture =
  | "identity"
  | "admission"
  | "admissions"
  | "availability"
  | "email"
  | "reset"
  | "concurrency"
  | "external"
  | "jobs"
  | "messaging"
  | "generation_worker"
  | "reconciliation";
type Phase =
  | "connection"
  | "reset"
  | "migrations"
  | "synthetic_ddl"
  | "bootstrap"
  | "verification"
  | "login"
  | "authentication"
  | "session_extension"
  | "unit"
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

type RoleScope = {
  caseId: "role_matrix";
  step:
    | "member_seed"
    | "member_login"
    | "member_authentication"
    | "director_lookup"
    | "director_login"
    | "director_authentication";
  mask?: number;
};
export type IdentityDiagnosticScope =
  | RoleScope
  | { caseId: "admissions_reissue_expiry"; step: "purge" }
  | { caseId: "generation_worker"; step: GenerationPhase }
  | { caseId: "reconciliation_root_submit"; step: "submit" };

export function identityDiagnostics(fixture: Fixture) {
  let captured = false;
  const scopes = new AsyncLocalStorage<IdentityDiagnosticScope & { ordinal: number }>();
  const scopeFields = (scope = scopes.getStore()) =>
    scope
      ? {
          caseId: scope.caseId,
          step: scope.step,
          ...("mask" in scope && scope.mask !== undefined ? { mask: scope.mask } : {}),
        }
      : {};
  const emit = (
    phase: Phase,
    state: "started" | "success" | "failed",
    durationMs: number | null,
    error?: unknown,
    context = scopeFields(),
  ) =>
    console.log(
      JSON.stringify({
        event: "identity_fixture",
        fixture,
        phase,
        state,
        durationMs,
        ...context,
        ...(state === "failed" ? safeIdentityFailure(error) : {}),
      }),
    );
  return {
    scope<T>(input: IdentityDiagnosticScope, work: () => Promise<T>): Promise<T> {
      const role = input.caseId === "role_matrix";
      const admitted =
        input.caseId === "admissions_reissue_expiry" &&
        input.step === "purge" &&
        fixture === "admissions";
      const generation =
        input.caseId === "generation_worker" &&
        fixture === "generation_worker" &&
        ["guard", "composition", "initialize", "maintenance", "pass", "close"].includes(input.step);
      const reconciliation =
        fixture === "reconciliation" &&
        input.caseId === "reconciliation_root_submit" &&
        input.step === "submit";
      if (
        (fixture === "reconciliation" && !reconciliation) ||
        Object.keys(input).some(
          (key) => !(role ? ["caseId", "step", "mask"] : ["caseId", "step"]).includes(key),
        ) ||
        (!admitted &&
          !generation &&
          !reconciliation &&
          (!role ||
            ![
              "member_seed",
              "member_login",
              "member_authentication",
              "director_lookup",
              "director_login",
              "director_authentication",
            ].includes(input.step))) ||
        ("mask" in input &&
          input.mask !== undefined &&
          (!Number.isSafeInteger(input.mask) || input.mask < 0 || input.mask > 15))
      )
        throw new Error("INVALID_IDENTITY_DIAGNOSTIC_SCOPE");
      const copied: IdentityDiagnosticScope =
        input.caseId === "role_matrix"
          ? {
              caseId: input.caseId,
              step: input.step,
              ...(input.mask === undefined ? {} : { mask: input.mask }),
            }
          : input.caseId === "admissions_reissue_expiry"
            ? { caseId: input.caseId, step: "purge" }
            : input.caseId === "reconciliation_root_submit"
              ? { caseId: input.caseId, step: "submit" }
              : { caseId: input.caseId, step: input.step };
      return scopes.run({ ...copied, ordinal: 0 }, work);
    },
    failure(error: unknown, durationMs: number | null = null) {
      emit("operation", "failed", durationMs === null ? null : Math.round(durationMs), error);
    },
    async phase<T>(
      phase: Phase,
      work: () => Promise<T>,
      options: { preserveFailure?: true } = {},
    ): Promise<T> {
      const started = performance.now();
      emit(phase, "started", 0);
      try {
        const result = await work();
        emit(phase, "success", Math.round(performance.now() - started));
        return result;
      } catch (error) {
        emit(phase, "failed", Math.round(performance.now() - started), error);
        if (options.preserveFailure) throw error;
        throw Object.assign(new Error("IDENTITY_FIXTURE_PHASE_FAILED"), safeIdentityFailure(error));
      }
    },
    unit(unit: UnitOfWork, control?: Connection, traceTransactions = false): UnitOfWork {
      const delay = monitorEventLoopDelay({ resolution: 10 });
      if (fixture !== "reconciliation") delay.enable();
      return {
        client: (tx) => unit.client(tx),
        async close() {
          delay.disable();
          await unit.close();
        },
        async run(command) {
          const scope = scopes.getStore();
          // This fixture observes only its explicit submit scope, before the public 503 mapping.
          if (fixture === "reconciliation" && !scope) return unit.run(command);
          const context = {
            ...scopeFields(scope),
            ...(scope ? { transactionOrdinal: ++scope.ordinal } : {}),
          };
          const started = performance.now();
          const trace = (
            boundary:
              | "invoked"
              | "callback_entered"
              | "callback_returned"
              | "callback_threw"
              | "fulfilled"
              | "rejected",
            error?: unknown,
          ) => {
            if (!traceTransactions || !scope || scope.caseId === "role_matrix") return;
            try {
              console.log(
                scopedTransactionLine({
                  event: "identity_fixture_transaction",
                  fixture,
                  ...context,
                  boundary,
                  durationMs: Math.round(performance.now() - started),
                  ...(boundary === "callback_threw" || boundary === "rejected"
                    ? safeIdentityFailure(error)
                    : {}),
                }),
              );
            } catch {
              // Diagnostics cannot replace the original callback result or exception.
            }
          };
          const utilization = performance.eventLoopUtilization();
          trace("invoked");
          try {
            const result = await unit.run(
              !traceTransactions || !scope || scope.caseId === "role_matrix"
                ? command
                : async (tx) => {
                    trace("callback_entered");
                    try {
                      const result = await command(tx);
                      trace("callback_returned");
                      return result;
                    } catch (error) {
                      trace("callback_threw", error);
                      throw error;
                    }
                  },
            );
            trace("fulfilled");
            return result;
          } catch (error) {
            trace("rejected", error);
            try {
              emit(
                "transaction",
                "failed",
                Math.round(performance.now() - started),
                error,
                context,
              );
              if (
                fixture !== "reconciliation" &&
                !captured &&
                safeIdentityFailure(error).codes.includes("TRANSACTION_COMMIT_OUTCOME_UNKNOWN")
              ) {
                captured = true;
                console.log(
                  JSON.stringify({
                    event: "identity_fixture_unknown_commit",
                    fixture,
                    ...context,
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
                          (row) =>
                            allowed.has(row.Variable_name) && /^\d+$/.test(String(row.Value)),
                        )
                        .map((row) => [row.Variable_name, Number(row.Value)]),
                    );
                    console.log(
                      JSON.stringify({
                        event: "identity_fixture_commit_status",
                        fixture,
                        ...context,
                        durationMs: Math.round(performance.now() - captureStarted),
                        counters,
                      }),
                    );
                  } catch (captureError) {
                    console.log(
                      JSON.stringify({
                        event: "identity_fixture_commit_status",
                        fixture,
                        ...context,
                        durationMs: Math.round(performance.now() - captureStarted),
                        state: "unavailable",
                        ...safeIdentityFailure(captureError),
                      }),
                    );
                  }
                }
              }
            } catch {
              // Preserve the original transaction failure even if diagnostics fail.
            }
            throw error;
          }
        },
      };
    },
  };
}
