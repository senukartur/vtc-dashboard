export type BrowserFailureStatus = "failed" | "timedOut" | "interrupted";
export const qualificationPhaseAnnotation: "vtc-qualification-promotion-phase";
export const qualificationPhaseScenario: "qualification-promotion-refresh";
export const qualificationPromotionPhases: readonly [
  "setup",
  "initial-route",
  "initial-reason",
  "open-promotion",
  "confirm-promotion",
  "command-arrived",
  "trigger-old-reads",
  "old-reads-held",
  "release-promotion",
  "promotion-committed",
  "release-old-reads",
  "promotion-dialog-settled",
  "current-level",
  "promotion-disabled",
  "history-assignment",
  "history-level",
  "assignment-purpose",
  "assignment-level",
  "open-assignment",
  "confirm-assignment",
  "assignment-dialog-settled",
  "command-etags",
  "finally-release-command",
  "finally-release-held",
  "finally-persist-race",
  "complete",
];
export type QualificationPromotionPhase = (typeof qualificationPromotionPhases)[number];
export interface QualificationFailurePhase {
  scenario: typeof qualificationPhaseScenario;
  phase: QualificationPromotionPhase;
  primaryPhase:
    | "none"
    | Exclude<
        QualificationPromotionPhase,
        "finally-release-command" | "finally-release-held" | "finally-persist-race" | "complete"
      >;
}
export function safeQualificationPhase(value: unknown): QualificationFailurePhase | undefined;
export function safeQualificationAnnotations(value: unknown): QualificationFailurePhase | undefined;
export type BrowserFailure =
  | { kind: "test"; file: string; project: string; line: number; status: BrowserFailureStatus }
  | ({
      kind: "test";
      file: "qualifications";
      project: string;
      line: number;
      status: BrowserFailureStatus;
    } & QualificationFailurePhase)
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
