import type { BrowserFailure } from "./browser-diagnostics.mjs";
export interface SafeEvent {
  stage: string;
  status: string;
  exitCode: number;
  durationMs: number;
}
export const stages: string[];
export function requiredCi(results: unknown): number;
export function safeEvent(value: unknown): SafeEvent | undefined;
export function eventLine(stage: string, exitCode: number, durationMs: number): string;
export function collectEvents(): {
  events: SafeEvent[];
  browserFailures: BrowserFailure[];
  fixtureDiagnostics: Record<string, unknown>[];
  push(chunk: unknown): void;
};
export function qualityReport(
  exitCode: number,
  durationMs: number,
  events: SafeEvent[],
  probe?: string,
  browserFailures?: unknown[],
  fixtureDiagnostics?: unknown[],
): object;
