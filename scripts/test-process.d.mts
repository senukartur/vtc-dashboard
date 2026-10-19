import type { ChildProcess } from "node:child_process";
export interface ProcessResult {
  exitCode: number;
  nativeExitCode?: number;
  category:
    | "spawn-error"
    | "pipe-error"
    | "deadline"
    | "signal-exit"
    | "completed"
    | "nonzero-exit";
}
export function runTestProcess(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    cleanup?: boolean;
    timeout?: number;
    onSpawn?: (child: ChildProcess) => void;
  },
): Promise<ProcessResult>;
