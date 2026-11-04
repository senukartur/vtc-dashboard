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
export type RehearsalTiming = {
  event: "deployment_rehearsal_timing";
  scenarios: { ordinal: number; startOffsetMs: number; durationMs: number }[];
  ticks: { count: number; busySeconds: number };
};
export function rehearsalTiming(bundle: unknown): RehearsalTiming | null;
export const windowShards: readonly (readonly number[])[];
export function rehearsalPlan(args: readonly string[]): {
  mode: "full" | "manual-only";
  groups: ("core" | "window" | "recovery")[];
  requireWindow: boolean;
  fullCoverage: boolean;
  scenarios: readonly number[];
};
export function retainRehearsalEvidence(
  bytes: Buffer,
  path: string,
  options: {
    requireWindow: boolean;
    scenarios?: readonly number[];
    requiredGroups?: readonly string[];
    sourceSha: string;
    sourceFingerprint: string;
    project: string;
    revision: string;
    volume: string;
    expectedImageId: string;
  },
): Promise<number>;
