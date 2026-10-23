export const SCHEMA_DROP_QUERY_TIMEOUT_MS = 10000;
export const SCHEMA_CLEANUP_TIMEOUT_MS = 12000;

export interface OwnedAllocation {
  schema: boolean;
  user: boolean;
  file: boolean;
}

interface CleanupOperations {
  lock: () => Promise<void>;
  schema: () => Promise<void>;
  user: () => Promise<void>;
  file: () => Promise<void>;
  userAbsence?: () => Promise<boolean>;
  admin: () => Promise<void>;
  destroyAdmin: () => void;
}

type Phase = "lock" | "schema" | "user" | "file" | "user_absence" | "admin" | "admin_transport";
type Category =
  | "none"
  | "server_rejection"
  | "driver_timeout"
  | "transport_failure"
  | "filesystem_failure"
  | "wall_timeout"
  | "account_present"
  | "unknown";
export interface CleanupDiagnostic {
  event: "test_allocation_cleanup";
  phase: Phase;
  state: "started" | "success" | "failed" | "late_success" | "late_failed" | "not_checked";
  elapsedMs: number;
  wireTimeoutMs: number | null;
  wallTimeoutMs: number | null;
  settlement: "pending" | "fulfilled" | "rejected" | "not_started";
  serverOutcome: "acknowledged" | "rejected" | "unknown" | "not_applicable";
  category: Category;
  nativeCodes: string[];
  userAbsent: boolean | null;
}

const serverCodes = new Set([
  "ER_CANNOT_USER",
  "ER_ACCESS_DENIED_ERROR",
  "ER_DBACCESS_DENIED_ERROR",
  "ER_PARSE_ERROR",
  "ER_DB_DROP_EXISTS",
  "ER_DB_DROP_DELETE",
  "ER_DB_DROP_RMDIR",
  "ER_LOCK_WAIT_TIMEOUT",
  "ER_LOCK_DEADLOCK",
]);
const timeoutCodes = new Set(["PROTOCOL_SEQUENCE_TIMEOUT", "ETIMEDOUT"]);
const transportCodes = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "PROTOCOL_CONNECTION_LOST",
  "PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR",
  "PROTOCOL_ENQUEUE_AFTER_QUIT",
]);
const filesystemCodes = new Set(["ENOENT", "EACCES", "EPERM", "EIO", "EROFS"]);
function field(value: unknown, key: string): unknown {
  try {
    return value !== null && (typeof value === "object" || typeof value === "function")
      ? Reflect.get(value, key)
      : undefined;
  } catch {
    return undefined;
  }
}
function failure(error: unknown): { category: Category; nativeCodes: string[] } {
  const nativeCodes: string[] = [];
  const seen = new Set<unknown>();
  let current = error;
  for (let depth = 0; depth < 8 && current !== undefined && !seen.has(current); depth++) {
    seen.add(current);
    const code = field(current, "code");
    if (
      typeof code === "string" &&
      (serverCodes.has(code) ||
        timeoutCodes.has(code) ||
        transportCodes.has(code) ||
        filesystemCodes.has(code)) &&
      !nativeCodes.includes(code)
    )
      nativeCodes.push(code);
    current = field(current, "cause");
  }
  // A driver/transport uncertainty takes precedence over a nested server diagnostic.
  const category = nativeCodes.some((code) => timeoutCodes.has(code))
    ? "driver_timeout"
    : nativeCodes.some((code) => transportCodes.has(code))
      ? "transport_failure"
      : nativeCodes.some((code) => serverCodes.has(code))
        ? "server_rejection"
        : nativeCodes.some((code) => filesystemCodes.has(code))
          ? "filesystem_failure"
          : "unknown";
  return { category, nativeCodes };
}

export async function cleanupAllocation(
  owned: OwnedAllocation,
  operations: CleanupOperations,
  observe: (diagnostic: CleanupDiagnostic) => void = () => {},
): Promise<string[]> {
  const failures: string[] = [];
  let protocolUncertain = false;
  let userDropped = false;
  const emit = (diagnostic: CleanupDiagnostic) => {
    // Diagnostic consumers cannot prevent owned cleanup or hide its original failure.
    try {
      observe(diagnostic);
    } catch {
      /* Deliberately preserve cleanup semantics. */
    }
  };
  async function run(phase: Exclude<Phase, "admin_transport">, operation: () => Promise<unknown>) {
    const started = Date.now();
    const wireTimeoutMs =
      phase === "schema"
        ? SCHEMA_DROP_QUERY_TIMEOUT_MS
        : phase === "user" || phase === "user_absence"
          ? 2000
          : null;
    const wallTimeoutMs = phase === "schema" ? SCHEMA_CLEANUP_TIMEOUT_MS : 3000;
    const database = phase === "schema" || phase === "user" || phase === "user_absence";
    const base = { event: "test_allocation_cleanup" as const, phase, wireTimeoutMs, wallTimeoutMs };
    let settlement: CleanupDiagnostic["settlement"] = "pending";
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wall = new Error("OWNED_CLEANUP_WALL_DEADLINE");
    emit({
      ...base,
      state: "started",
      elapsedMs: 0,
      settlement,
      serverOutcome: database ? "unknown" : "not_applicable",
      category: "none",
      nativeCodes: [],
      userAbsent: null,
    });
    const work = Promise.resolve()
      .then(operation)
      .then(
        (value) => {
          settlement = "fulfilled";
          if (timedOut)
            emit({
              ...base,
              state: "late_success",
              elapsedMs: Date.now() - started,
              settlement,
              serverOutcome: database ? "acknowledged" : "not_applicable",
              category: "none",
              nativeCodes: [],
              userAbsent: phase === "user_absence" ? value === true : null,
            });
          return value;
        },
        (error: unknown) => {
          settlement = "rejected";
          if (timedOut) {
            const diagnostic = failure(error);
            emit({
              ...base,
              state: "late_failed",
              elapsedMs: Date.now() - started,
              settlement,
              serverOutcome: database
                ? diagnostic.category === "server_rejection"
                  ? "rejected"
                  : "unknown"
                : "not_applicable",
              ...diagnostic,
              userAbsent: null,
            });
          }
          throw error;
        },
      );
    try {
      const value = await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            reject(wall);
          }, wallTimeoutMs);
        }),
      ]);
      const absent = phase === "user_absence" ? value === true : null;
      if (absent === false) failures.push("USER_ABSENCE");
      emit({
        ...base,
        state: absent === false ? "failed" : "success",
        elapsedMs: Date.now() - started,
        settlement,
        serverOutcome: database ? "acknowledged" : "not_applicable",
        category: absent === false ? "account_present" : "none",
        nativeCodes: [],
        userAbsent: absent,
      });
      return absent !== false;
    } catch (error) {
      const diagnostic =
        error === wall ? { category: "wall_timeout" as const, nativeCodes: [] } : failure(error);
      failures.push(phase.toUpperCase());
      if (database && diagnostic.category !== "server_rejection") protocolUncertain = true;
      emit({
        ...base,
        state: "failed",
        elapsedMs: Date.now() - started,
        settlement,
        serverOutcome: database
          ? diagnostic.category === "server_rejection"
            ? "rejected"
            : "unknown"
          : "not_applicable",
        ...diagnostic,
        userAbsent: null,
      });
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
  for (const step of ["lock", "schema", "user", "file", "admin"] as const) {
    if (step !== "lock" && step !== "admin" && !owned[step]) continue;
    // Probe only this invocation's account, after file removal and an acknowledged DROP.
    // A timeout never proves SQL cancellation or makes a connection safe for another query.
    if (step === "admin" && owned.user && operations.userAbsence) {
      if (userDropped && !protocolUncertain) await run("user_absence", operations.userAbsence);
      else
        emit({
          event: "test_allocation_cleanup",
          phase: "user_absence",
          state: "not_checked",
          elapsedMs: 0,
          wireTimeoutMs: 2000,
          wallTimeoutMs: 3000,
          settlement: "not_started",
          serverOutcome: "unknown",
          category: "unknown",
          nativeCodes: [],
          userAbsent: null,
        });
    }
    const success = await run(step, operations[step]);
    if (step === "user") userDropped = success;
  }
  // Closing may reject or time out. Always force-close the provisioner's transport too.
  const started = Date.now();
  let diagnostic: Pick<CleanupDiagnostic, "state" | "category" | "nativeCodes"> = {
    state: "success",
    category: "none",
    nativeCodes: [],
  };
  try {
    operations.destroyAdmin();
  } catch (error) {
    failures.push("ADMIN_TRANSPORT");
    diagnostic = { state: "failed", ...failure(error) };
  }
  emit({
    event: "test_allocation_cleanup",
    phase: "admin_transport",
    ...diagnostic,
    elapsedMs: Date.now() - started,
    wireTimeoutMs: null,
    wallTimeoutMs: null,
    settlement: diagnostic.state === "success" ? "fulfilled" : "rejected",
    serverOutcome: "not_applicable",
    userAbsent: null,
  });
  return failures;
}
