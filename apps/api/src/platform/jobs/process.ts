import { spawn } from "node:child_process";
import { hardRemainingMs, workerDeadlineEnv } from "./deadline.js";

// Keep this module and deadline.ts free of application imports: the supervisor should load only
// them, leaving the application graph to the worker it spawns.
export async function ownedCli(work: () => Promise<void>): Promise<void> {
  if (process.env.VTC_JOBS_WORKER === "1") {
    const alive = setInterval(() => {}, 1000);
    try {
      await work();
    } finally {
      clearInterval(alive);
    }
    return;
  }
  // Independent supervisor can terminate even a synchronous/noncooperative callback.
  const child = spawn(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    env: { ...process.env, VTC_JOBS_WORKER: "1", ...workerDeadlineEnv() },
    stdio: "inherit",
    windowsHide: true,
  });
  let drain: ReturnType<typeof setTimeout> | undefined;
  const hard = setTimeout(() => {
    console.error(JSON.stringify({ event: "jobs_failed", category: "hard_deadline" }));
    child.kill("SIGKILL");
  }, hardRemainingMs(0));
  const stop = () => {
    child.kill("SIGTERM");
    drain ??= setTimeout(() => child.kill("SIGKILL"), 5000);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    process.exitCode = await new Promise<number>((resolve) => {
      child.once("error", () => resolve(1));
      child.once("exit", (code) => resolve(code ?? 1));
    });
  } finally {
    clearTimeout(hard);
    clearTimeout(drain);
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}
