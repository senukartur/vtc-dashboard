type Receipt = {
  manualCleanup: "complete" | "configuration_pending" | "storage_unavailable";
  processed: number;
};
type State = "spawn" | "close" | "deadline" | "spawn_error" | "stream_error" | "failure";
type Flags = {
  closed: boolean;
  timedOut: boolean;
  spawnFailed: boolean;
  streamFailed: boolean;
  exitCode: number | null;
};
const states: State[] = ["spawn", "close", "deadline", "spawn_error", "stream_error", "failure"];
const cleanup = ["complete", "configuration_pending", "storage_unavailable"];
const integer = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value);
const keys = [
  "event",
  "ordinal",
  "state",
  "durationMs",
  "remainingMs",
  "closed",
  "timedOut",
  "spawnFailed",
  "streamFailed",
  "exitCode",
  "receiptState",
  "lastEvent",
  "manualCleanup",
  "processed",
];

export function safeManualJobsRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(row, key)) ||
    row.event !== "manual_jobs_cli" ||
    ![1, 2].includes(row.ordinal as number) ||
    !states.includes(row.state as State) ||
    !integer(row.durationMs) ||
    row.durationMs < 0 ||
    row.durationMs > 86400000 ||
    !integer(row.remainingMs) ||
    Math.abs(row.remainingMs) > 86400000 ||
    !["closed", "timedOut", "spawnFailed", "streamFailed"].every(
      (key) => typeof row[key] === "boolean",
    ) ||
    !(row.exitCode === null || integer(row.exitCode)) ||
    !["pending", "valid", "missing"].includes(row.receiptState as string) ||
    !["none", "storage_unavailable", "jobs_result"].includes(row.lastEvent as string) ||
    !(row.manualCleanup === null || cleanup.includes(row.manualCleanup as string)) ||
    !(row.processed === null || (integer(row.processed) && row.processed >= 0))
  )
    return;
  if ((row.receiptState === "valid") !== (row.manualCleanup !== null && row.processed !== null))
    return;
  if (
    (row.manualCleanup === null) !== (row.processed === null) ||
    (row.receiptState === "missing" && !row.closed) ||
    (row.receiptState === "pending" && row.closed) ||
    (row.state === "close" && !row.closed) ||
    (row.state === "deadline" && !row.timedOut) ||
    (row.state === "spawn_error" && !row.spawnFailed) ||
    (row.state === "stream_error" && !row.streamFailed)
  )
    return;
  return Object.fromEntries(keys.map((key) => [key, row[key]]));
}

// Observe only closed existing CLI events; never retain the child payload or raw diagnostics.
export function manualJobsObservation(
  ordinal: 1 | 2,
  deadline: number,
  clock = () => performance.now(),
) {
  const started = clock();
  let receipt: Receipt | undefined;
  let lastEvent: "none" | "storage_unavailable" | "jobs_result" = "none";
  return {
    accept(value: unknown) {
      if (!value || typeof value !== "object") return;
      const row = value as Record<string, unknown>;
      if (row.event === "manual_cleanup_failed" && row.category === "storage_unavailable")
        lastEvent = "storage_unavailable";
      if (
        row.event === "jobs_result" &&
        cleanup.includes(row.manualCleanup as string) &&
        integer(row.processed) &&
        row.processed >= 0
      ) {
        receipt = {
          manualCleanup: row.manualCleanup as Receipt["manualCleanup"],
          processed: row.processed,
        };
        lastEvent = "jobs_result";
      }
    },
    line(state: State, flags: Flags) {
      const at = clock();
      const record = safeManualJobsRecord({
        event: "manual_jobs_cli",
        ordinal,
        state,
        durationMs: Math.round(at - started),
        remainingMs: Math.round(deadline - at),
        ...flags,
        receiptState: receipt ? "valid" : flags.closed ? "missing" : "pending",
        lastEvent,
        manualCleanup: receipt?.manualCleanup ?? null,
        processed: receipt?.processed ?? null,
      });
      if (!record) throw Error("INVALID_MANUAL_JOBS_DIAGNOSTIC");
      return JSON.stringify(record);
    },
  };
}
