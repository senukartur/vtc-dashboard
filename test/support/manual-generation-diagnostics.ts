const phases = ["guard", "composition", "initialize", "maintenance", "pass", "close"] as const;
export type GenerationPhase = (typeof phases)[number];
export const generationTransactionFlag = "--synthetic-late-transaction-trace";
export function generationTransactionTracing(args: readonly string[]): boolean {
  if (args.length === 0) return false;
  if (args.length === 1 && args[0] === generationTransactionFlag) return true;
  throw Error("INVALID_GENERATION_TRANSACTION_FLAG");
}
const cases = ["generation_progress", "generation_late", "generation_retry"] as const;
export type GenerationCase = (typeof cases)[number];
export function generationTransactionArguments(caseId: GenerationCase, ordinal: number): string[] {
  return caseId === "generation_late" && ordinal === 1 ? [generationTransactionFlag] : [];
}
const codes = [
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
];
const operations = [
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
];
const integer = (value: unknown, max = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max;
function fields(
  value: unknown,
  required: string[],
  optional: string[] = [],
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
  );
}
function allowed(value: unknown, values: readonly string[]) {
  return typeof value === "string" && values.includes(value);
}

export function safeScopedTransactionRecord(value: unknown): Record<string, unknown> | undefined {
  if (
    !fields(
      value,
      ["event", "fixture", "caseId", "step", "transactionOrdinal", "boundary", "durationMs"],
      ["category", "codes", "statusCode", "databaseOperation"],
    ) ||
    value.event !== "identity_fixture_transaction" ||
    !(
      (value.fixture === "admissions" &&
        value.caseId === "admissions_reissue_expiry" &&
        value.step === "purge") ||
      (value.fixture === "generation_worker" &&
        value.caseId === "generation_worker" &&
        allowed(value.step, phases))
    ) ||
    !integer(value.transactionOrdinal, 1000000) ||
    value.transactionOrdinal === 0 ||
    !integer(value.durationMs, 86400000) ||
    !allowed(value.boundary, [
      "invoked",
      "callback_entered",
      "callback_returned",
      "callback_threw",
      "fulfilled",
      "rejected",
    ])
  )
    return;
  const failed = value.boundary === "callback_threw" || value.boundary === "rejected";
  const failure: Record<string, unknown> = {};
  if (failed) {
    if (
      !allowed(value.category, [
        "unclassified",
        "transaction_control_timeout",
        "pool_capacity",
        "baseline_mismatch",
      ]) ||
      !Array.isArray(value.codes) ||
      value.codes.length > codes.length ||
      !value.codes.every((code) => allowed(code, codes))
    )
      return;
    failure.category = value.category;
    failure.codes = [...value.codes];
    if (Object.hasOwn(value, "statusCode")) {
      if (!integer(value.statusCode, 599) || value.statusCode < 400) return;
      failure.statusCode = value.statusCode;
    }
    if (Object.hasOwn(value, "databaseOperation")) {
      const context = value.databaseOperation;
      if (
        !fields(context, ["operation", "wireDeadlineMs", "elapsedMs"]) ||
        !allowed(context.operation, operations) ||
        !integer(context.wireDeadlineMs, 86400000) ||
        context.wireDeadlineMs < 1 ||
        !integer(context.elapsedMs, 86400000)
      )
        return;
      failure.databaseOperation = {
        operation: context.operation,
        wireDeadlineMs: context.wireDeadlineMs,
        elapsedMs: context.elapsedMs,
      };
    }
  } else if (
    ["category", "codes", "statusCode", "databaseOperation"].some((key) =>
      Object.hasOwn(value, key),
    )
  )
    return;
  return {
    event: value.event,
    fixture: value.fixture,
    caseId: value.caseId,
    step: value.step,
    transactionOrdinal: value.transactionOrdinal,
    boundary: value.boundary,
    durationMs: value.durationMs,
    ...failure,
  };
}
export function scopedTransactionLine(value: unknown): string {
  const record = safeScopedTransactionRecord(value);
  if (!record) throw Error("INVALID_SCOPED_TRANSACTION");
  return JSON.stringify(record);
}

// The private receipt PID is validated for the caller's in-memory distinct-process assertion,
// but is never returned by this sanitizer or accepted in public process records.
export function safeGenerationWorkerRecord(value: unknown): Record<string, unknown> | undefined {
  const transaction = safeScopedTransactionRecord(value);
  if (transaction?.fixture === "generation_worker") return transaction;
  if (
    fields(value, ["event", "processed", "pid"]) &&
    value.event === "manual_generation_worker" &&
    integer(value.processed) &&
    integer(value.pid) &&
    value.pid > 1
  )
    return { event: value.event, processed: value.processed };
  if (
    !fields(
      value,
      ["event", "phase", "state", "durationMs"],
      ["category", "codes", "databaseOperation", "runnerStatus", "processed"],
    ) ||
    value.event !== "manual_generation_worker_phase" ||
    !allowed(value.phase, phases) ||
    !allowed(value.state, ["started", "success", "failed"]) ||
    !integer(value.durationMs, 86400000)
  )
    return;
  const result: Record<string, unknown> = {
    event: value.event,
    phase: value.phase,
    state: value.state,
    durationMs: value.durationMs,
  };
  if (Object.hasOwn(value, "runnerStatus") || Object.hasOwn(value, "processed")) {
    if (
      value.phase !== "pass" ||
      value.state !== "success" ||
      !allowed(value.runnerStatus, ["completed", "overlap", "stopped"]) ||
      !integer(value.processed)
    )
      return;
    result.runnerStatus = value.runnerStatus;
    result.processed = value.processed;
  }
  if (Object.hasOwn(value, "category") || Object.hasOwn(value, "codes")) {
    if (
      value.state !== "failed" ||
      !allowed(value.category, [
        "unclassified",
        "transaction_control_timeout",
        "pool_capacity",
        "baseline_mismatch",
      ]) ||
      !Array.isArray(value.codes) ||
      value.codes.length > codes.length ||
      !value.codes.every((code) => allowed(code, codes))
    )
      return;
    result.category = value.category;
    result.codes = [...value.codes];
  }
  if (Object.hasOwn(value, "databaseOperation")) {
    const context = value.databaseOperation;
    if (
      value.state !== "failed" ||
      !fields(context, ["operation", "wireDeadlineMs", "elapsedMs"]) ||
      !allowed(context.operation, operations) ||
      !integer(context.wireDeadlineMs, 86400000) ||
      context.wireDeadlineMs < 1 ||
      !integer(context.elapsedMs, 86400000)
    )
      return;
    result.databaseOperation = {
      operation: context.operation,
      wireDeadlineMs: context.wireDeadlineMs,
      elapsedMs: context.elapsedMs,
    };
  }
  return result;
}
export function generationWorkerPhaseLine(value: unknown): string {
  const result = safeGenerationWorkerRecord(value);
  if (result?.event !== "manual_generation_worker_phase") throw Error("INVALID_GENERATION_PHASE");
  return JSON.stringify(result);
}
export function parseGenerationWorkerLine(line: string): Record<string, unknown> | undefined {
  if (line.length > 4000) return;
  try {
    return safeGenerationWorkerRecord(JSON.parse(line));
  } catch {
    return;
  }
}

export function safeGenerationProcessRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const candidate = value as Record<string, unknown>;
  if (!allowed(candidate.caseId, cases) || !integer(candidate.ordinal, 4)) return;
  const context = { caseId: candidate.caseId, ordinal: candidate.ordinal };
  if (candidate.event === "manual_generation_transaction") {
    if (
      !fields(
        candidate,
        ["event", "caseId", "ordinal", "phase", "transactionOrdinal", "boundary", "durationMs"],
        ["category", "codes", "statusCode", "databaseOperation"],
      ) ||
      candidate.caseId !== "generation_late" ||
      candidate.ordinal !== 1
    )
      return;
    const { caseId: _case, ordinal: _ordinal, phase, ...transaction } = candidate;
    const record = safeScopedTransactionRecord({
      ...transaction,
      event: "identity_fixture_transaction",
      fixture: "generation_worker",
      caseId: "generation_worker",
      step: phase,
    });
    if (!record) return;
    const { fixture: _fixture, caseId: _scope, step: _step, ...facts } = record;
    return { ...facts, event: "manual_generation_transaction", phase, ...context };
  }
  if (candidate.event === "manual_generation_phase") {
    const { caseId: _case, ordinal: _ordinal, ...phase } = candidate;
    const result = safeGenerationWorkerRecord({
      ...phase,
      event: "manual_generation_worker_phase",
    });
    if (result?.event !== "manual_generation_worker_phase") return;
    return { ...result, event: "manual_generation_phase", ...context };
  }
  if (
    fields(candidate, ["event", "caseId", "ordinal", "durationMs", "processed"]) &&
    candidate.event === "manual_generation_process_duration" &&
    integer(candidate.durationMs, 86400000) &&
    integer(candidate.processed)
  )
    return {
      event: candidate.event,
      ...context,
      durationMs: candidate.durationMs,
      processed: candidate.processed,
    };
  if (
    !fields(candidate, [
      "event",
      "caseId",
      "ordinal",
      "state",
      "durationMs",
      "exitCode",
      "signal",
      "timerFired",
      "caseAborted",
      "spawnFailed",
      "firstStop",
      "receiptState",
    ]) ||
    candidate.event !== "manual_generation_process" ||
    !allowed(candidate.state, ["exit", "close", "spawn_error"]) ||
    !integer(candidate.durationMs, 86400000) ||
    !(
      candidate.exitCode === null ||
      (typeof candidate.exitCode === "number" && Number.isSafeInteger(candidate.exitCode))
    ) ||
    !(
      candidate.signal === null ||
      allowed(candidate.signal, ["SIGKILL", "SIGTERM", "SIGINT", "other"])
    ) ||
    typeof candidate.timerFired !== "boolean" ||
    typeof candidate.caseAborted !== "boolean" ||
    typeof candidate.spawnFailed !== "boolean" ||
    !allowed(candidate.firstStop, ["none", "child_deadline", "case_abort"]) ||
    !allowed(candidate.receiptState, ["pending", "valid", "missing", "malformed"])
  )
    return;
  return {
    event: candidate.event,
    ...context,
    state: candidate.state,
    durationMs: candidate.durationMs,
    exitCode: candidate.exitCode,
    signal: candidate.signal,
    timerFired: candidate.timerFired,
    caseAborted: candidate.caseAborted,
    spawnFailed: candidate.spawnFailed,
    firstStop: candidate.firstStop,
    receiptState: candidate.receiptState,
  };
}
export function generationProcessLine(value: unknown): string {
  const result = safeGenerationProcessRecord(value);
  if (!result) throw Error("INVALID_GENERATION_PROCESS_DIAGNOSTIC");
  return JSON.stringify(result);
}
