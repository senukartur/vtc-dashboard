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
] as const;

type Operation = (typeof operations)[number];
interface Context {
  operation: Operation;
  wireDeadlineMs: number;
  elapsedMs: number;
}
const failures = new WeakMap<object, Readonly<Context>>();

// Private side metadata preserves native error identity/cause and never adds enumerable fields.
export async function observeDatabaseOperation<T>(
  operation: Operation,
  wireDeadlineMs: number,
  work: () => Promise<T>,
): Promise<T> {
  const started = performance.now();
  try {
    return await work();
  } catch (error) {
    const elapsedMs = Math.round(performance.now() - started);
    if (
      error !== null &&
      typeof error === "object" &&
      !failures.has(error) &&
      operations.includes(operation) &&
      Number.isSafeInteger(wireDeadlineMs) &&
      wireDeadlineMs > 0 &&
      Number.isSafeInteger(elapsedMs) &&
      elapsedMs >= 0
    )
      failures.set(error, Object.freeze({ operation, wireDeadlineMs, elapsedMs }));
    throw error;
  }
}

export function databaseFailureContext(error: unknown): Readonly<Context> | null {
  const seen = new Set<object>();
  let current = error;
  for (let depth = 0; depth < 8 && current !== null && typeof current === "object"; depth++) {
    if (seen.has(current)) break;
    seen.add(current);
    const context = failures.get(current);
    if (context) return { ...context };
    try {
      current = "cause" in current ? current.cause : null;
    } catch {
      return null;
    }
  }
  return null;
}
