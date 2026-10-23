import type { ChildProcess } from "node:child_process";
import { performance } from "node:perf_hooks";
import { databaseFailureContext, TransactionCommitOutcomeUnknownError } from "@vtc/db";

const nativeCodes = new Set([
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
  "ER_ACCESS_DENIED_ERROR",
  "ER_DBACCESS_DENIED_ERROR",
  "ER_BAD_DB_ERROR",
  "ER_DUP_ENTRY",
  "ER_NO_SUCH_TABLE",
  "ER_TABLE_EXISTS_ERROR",
  "ER_NO_REFERENCED_ROW_2",
  "ER_ROW_IS_REFERENCED_2",
]);
const fixedCodes = new Set([
  "ACCEPTANCE_OPERATION_FAILED",
  "ACCEPTANCE_GUARD_REQUIRED",
  "INVALID_ACCEPTANCE_MODE",
  "INVALID_APPLICATION_ID",
  "ACCEPTANCE_CLAIM_REQUIRED",
  "DATABASE_CONFIGURATION_MISSING",
  "DATABASE_PORT_INVALID",
  "TRANSACTION_COMMIT_OUTCOME_UNKNOWN",
]);
const operations = new Set([
  "connection_open",
  "session_configuration",
  "session_charset",
  "migration_lock",
  "migration_baseline",
  "migration_autocommit",
  "migration_journal_create",
  "migration_history_read",
  "migration_journal_insert",
  "migration_statement",
  "migration_journal_finalize",
]);
function field(value: object, key: string): unknown {
  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}
const integer = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

// Synthetic acceptance diagnostics reconstruct fixed fields; private error data never crosses this boundary.
export function acceptanceFailure(error: unknown) {
  let current = error,
    code = "ACCEPTANCE_OPERATION_FAILED",
    uncertain = false;
  const seen = new Set<object>(),
    codes: string[] = [];
  for (
    let depth = 0;
    depth < 8 && current !== null && typeof current === "object" && !seen.has(current);
    depth++
  ) {
    seen.add(current);
    try {
      uncertain ||= current instanceof TransactionCommitOutcomeUnknownError;
    } catch {
      /* Hostile diagnostic input stays unknown. */
    }
    const message = field(current, "message"),
      native = field(current, "code");
    if (
      typeof message === "string" &&
      fixedCodes.has(message) &&
      code === "ACCEPTANCE_OPERATION_FAILED"
    )
      code = message;
    if (typeof native === "string" && nativeCodes.has(native) && !codes.includes(native))
      codes.push(native);
    current = field(current, "cause");
  }
  const context = databaseFailureContext(error);
  return {
    event: "acceptance_failed" as const,
    category: uncertain ? "commit_outcome_unknown" : "operation_failed",
    code: uncertain ? "TRANSACTION_COMMIT_OUTCOME_UNKNOWN" : code,
    nativeCodes: codes,
    ...(context
      ? {
          databaseOperation: {
            operation: context.operation,
            wireDeadlineMs: context.wireDeadlineMs,
            elapsedMs: context.elapsedMs,
          },
        }
      : {}),
  };
}

export function acceptanceDiagnosticRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const event = field(value, "event"),
    category = field(value, "category");
  if (event === "jobs_failed" && category === "hard_deadline") return { event, category };
  if (
    event !== "acceptance_failed" ||
    typeof category !== "string" ||
    !["operation_failed", "commit_outcome_unknown", "close_failed"].includes(category)
  )
    return undefined;
  const code = field(value, "code"),
    suppliedCodes = field(value, "nativeCodes"),
    supplied = field(value, "databaseOperation");
  const codes: string[] = [];
  if (Array.isArray(suppliedCodes))
    for (const native of suppliedCodes.slice(0, 8))
      if (typeof native === "string" && nativeCodes.has(native) && !codes.includes(native))
        codes.push(native);
  let context: { operation: string; wireDeadlineMs: number; elapsedMs: number } | undefined;
  if (supplied !== null && typeof supplied === "object") {
    const operation = field(supplied, "operation"),
      deadline = field(supplied, "wireDeadlineMs"),
      elapsed = field(supplied, "elapsedMs");
    if (
      typeof operation === "string" &&
      operations.has(operation) &&
      integer(deadline) &&
      deadline > 0 &&
      integer(elapsed)
    )
      context = { operation, wireDeadlineMs: deadline, elapsedMs: elapsed };
  }
  return {
    event,
    category,
    code:
      category === "commit_outcome_unknown"
        ? "TRANSACTION_COMMIT_OUTCOME_UNKNOWN"
        : typeof code === "string" && fixedCodes.has(code)
          ? code
          : "ACCEPTANCE_OPERATION_FAILED",
    nativeCodes: codes,
    ...(context ? { databaseOperation: context } : {}),
  };
}

export function observeAcceptanceChild(
  child: ChildProcess,
  emit: (value: Record<string, unknown>) => void,
): Promise<number | null> {
  const started = performance.now(),
    failures: Record<string, unknown>[] = [];
  const flush: (() => void)[] = [];
  let spawnErrorCategory: string | null = null;
  for (const stream of [child.stdout, child.stderr]) {
    let pending = "";
    const line = (text: string) => {
      if (text.length > 4096) return;
      try {
        const record = acceptanceDiagnosticRecord(JSON.parse(text));
        if (record) {
          failures.push(record);
          if (failures.length > 8) failures.shift();
        }
      } catch {
        /* Unrecognized child output remains private. */
      }
    };
    stream?.on("data", (chunk: unknown) => {
      if (!Buffer.isBuffer(chunk) && typeof chunk !== "string") return;
      pending = (
        pending + (Buffer.isBuffer(chunk) ? chunk.subarray(-65536).toString() : chunk.slice(-65536))
      ).slice(-65536);
      let end = pending.indexOf("\n");
      while (end >= 0) {
        line(pending.slice(0, end));
        pending = pending.slice(end + 1);
        end = pending.indexOf("\n");
      }
    });
    flush.push(() => line(pending));
  }
  child.on("error", (error: unknown) => {
    const code = error !== null && typeof error === "object" ? field(error, "code") : undefined;
    spawnErrorCategory =
      typeof code === "string" && ["ENOENT", "EACCES", "EPERM", "EIO", "ETIMEDOUT"].includes(code)
        ? code
        : "unknown";
  });
  return new Promise((resolve) =>
    child.once("close", (code: number | null, signal: string | null) => {
      for (const finish of flush) finish();
      try {
        emit({
          event: "jobs_fixture_child",
          state: "closed",
          exitCode: integer(code) ? code : null,
          signal:
            signal !== null && ["SIGTERM", "SIGKILL", "SIGINT", "SIGABRT"].includes(signal)
              ? signal
              : null,
          closeConfirmed: true,
          elapsedMs: Math.round(performance.now() - started),
          spawnErrorCategory,
          failures,
        });
      } catch {
        /* Diagnostic output cannot replace native completion. */
      }
      resolve(code);
    }),
  );
}
