import { databaseFailureContext } from "./operation-context.js";

const migrationCodes = new Set([
  "MIGRATION_LOCK_UNAVAILABLE",
  "MIGRATION_BASELINE_MISMATCH",
  "MIGRATION_HISTORY_DRIFT",
  "MIGRATION_RECOVERY_REQUIRED",
  "INVALID_MIGRATION_ORDER",
  "DATABASE_CONFIGURATION_MISSING",
  "DATABASE_PORT_INVALID",
]);
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
function field(value: object, key: string): unknown {
  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}
// Reconstruct fixed fields only. Native messages, SQL, arguments and identities stay private.
export function migrationFailure(error: unknown) {
  let code = "MIGRATION_EXECUTION_FAILED",
    current = error;
  const codes: string[] = [],
    seen = new Set<object>();
  for (let depth = 0; depth < 8 && current !== null && typeof current === "object"; depth++) {
    if (seen.has(current)) break;
    seen.add(current);
    const message = field(current, "message"),
      native = field(current, "code");
    if (
      typeof message === "string" &&
      migrationCodes.has(message) &&
      code === "MIGRATION_EXECUTION_FAILED"
    )
      code = message;
    if (typeof native === "string" && nativeCodes.has(native) && !codes.includes(native))
      codes.push(native);
    current = field(current, "cause");
  }
  const context = databaseFailureContext(error);
  return {
    event: "database.migration_failed" as const,
    code,
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
    action: "inspect_private_diagnostics_and_recovery_runbook",
  };
}
