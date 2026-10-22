export type BrowserFailureStatus = "failed" | "timedOut" | "interrupted";
export type BrowserFailure =
  | { kind: "test"; file: string; project: string; line: number; status: BrowserFailureStatus }
  | { kind: "global"; category: string; status: BrowserFailureStatus };
export const browserFiles: Record<string, string>;
export const browserProjects: string[];
export const browserFailurePrefix: string;
export function safeBrowserFailure(value: unknown): BrowserFailure | undefined;
export function browserFailureLine(value: unknown): string;

export type BrowserPreparationPhase =
  | "ownership"
  | "synthetic_ddl"
  | "ownership_close"
  | "migrations"
  | "bootstrap"
  | "credential_hash"
  | "credential_insert"
  | "unit_close";
export type BrowserPreparation =
  | {
      kind: "wrapper";
      state: "success" | "failed";
      category:
        | "completed"
        | "nonzero-exit"
        | "signal-exit"
        | "spawn-error"
        | "pipe-error"
        | "deadline";
      configuredTimeoutMs: number;
      durationMs: number;
    }
  | {
      kind: "phase";
      phase: BrowserPreparationPhase;
      state: "started" | "success" | "failed";
      durationMs: number;
      totalDurationMs: number;
      credential?: 1 | 2 | 3;
      applied?: number;
      databaseOperation?: {
        operation:
          | "connection_open"
          | "session_configuration"
          | "session_charset"
          | "migration_lock"
          | "migration_baseline"
          | "migration_autocommit"
          | "migration_journal_create"
          | "migration_history_read"
          | "migration_journal_insert"
          | "migration_statement"
          | "migration_journal_finalize";
        wireDeadlineMs: number;
        elapsedMs: number;
      };
    };
export const browserPreparationPrefix: string;
export function safeBrowserPreparation(value: unknown): BrowserPreparation | undefined;
export function browserPreparationLine(value: unknown): string;
