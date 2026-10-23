import type { EventEmitter } from "node:events";
import type { ChildProcess, SpawnOptions } from "node:child_process";
export type RehearsalChildOutcome = {
  category: "deadline" | "spawn-error" | "signal-exit" | "completed" | "nonzero-exit";
  exitCode: number;
  nativeExitCode: number | null;
  signal: "SIGTERM" | "SIGKILL" | "SIGINT" | "SIGABRT" | "other" | null;
  errorCategory:
    | "ENOENT"
    | "EACCES"
    | "EPERM"
    | "EIO"
    | "ETIMEDOUT"
    | "synchronous-spawn"
    | "other"
    | null;
  deadlineExceeded: boolean;
  spawned: boolean;
  settledByClose: boolean;
  terminationRequested: boolean;
  escalationRequested: boolean;
  terminationError: boolean;
  cleanupGraceMs: number;
  unrefAttempted: boolean;
  unrefSucceeded: boolean;
  elapsedMs: number;
  timeoutMs: number;
};
export function runRehearsalChild(
  command: string,
  args: readonly string[],
  options: {
    stdio: SpawnOptions["stdio"];
    timeout: number;
    spawnChild?: (
      command: string,
      args: readonly string[],
      options: SpawnOptions,
    ) => EventEmitter & Pick<ChildProcess, "kill"> & { unref?: () => void };
  },
): Promise<RehearsalChildOutcome>;
