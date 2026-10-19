export type BrowserFailureStatus = "failed" | "timedOut" | "interrupted";
export type BrowserFailure =
  | { kind: "test"; file: string; project: string; line: number; status: BrowserFailureStatus }
  | { kind: "global"; category: string; status: BrowserFailureStatus };
export const browserFiles: Record<string, string>;
export const browserProjects: string[];
export const browserFailurePrefix: string;
export function safeBrowserFailure(value: unknown): BrowserFailure | undefined;
export function browserFailureLine(value: unknown): string;
