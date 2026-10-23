import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

const errorCodes = new Set(["ENOENT", "EACCES", "EPERM", "EIO", "ETIMEDOUT"]);
const cleanupGraceMs = 1000;
const signals = new Set(["SIGTERM", "SIGKILL", "SIGINT", "SIGABRT"]);

// Public metadata is constructed from fixed categories, never native messages or arguments.
export function runRehearsalChild(command, args, options) {
  const started = performance.now();
  return new Promise((resolve) => {
    let settled = false,
      timer,
      escalationTimer,
      settlementTimer;
    let terminationRequested = false,
      escalationRequested = false,
      terminationError = false,
      unrefAttempted = false,
      unrefSucceeded = false;
    let child,
      spawned = false,
      errorCategory = null,
      deadlineExceeded = false;
    const finish = (code, signal, settledByClose) => {
      if (settled) return;
      settled = true;
      if (!settledByClose && child) {
        unrefAttempted = true;
        try {
          child.unref();
          unrefSucceeded = true;
        } catch {
          /* Unconfirmed client ownership remains explicit. */
        }
      }
      clearTimeout(timer);
      clearTimeout(escalationTimer);
      clearTimeout(settlementTimer);
      const portable = Number.isInteger(code) && code >= 0 && code <= 255;
      const category = deadlineExceeded
        ? "deadline"
        : errorCategory
          ? "spawn-error"
          : signal
            ? "signal-exit"
            : code === 0
              ? "completed"
              : "nonzero-exit";
      resolve({
        category,
        exitCode: category === "completed" ? 0 : portable && code !== 0 ? code : 1,
        nativeExitCode: Number.isSafeInteger(code) ? code : null,
        signal: signal ? (signals.has(signal) ? signal : "other") : null,
        errorCategory,
        deadlineExceeded,
        spawned,
        settledByClose,
        terminationRequested,
        escalationRequested,
        terminationError,
        cleanupGraceMs,
        unrefAttempted,
        unrefSucceeded,
        elapsedMs: Math.round(performance.now() - started),
        timeoutMs: options.timeout,
      });
    };
    try {
      child = (options.spawnChild ?? spawn)(command, args, {
        stdio: options.stdio,
        windowsHide: true,
      });
    } catch {
      errorCategory = "synchronous-spawn";
      finish(null, null, false);
      return;
    }
    function terminate(signal) {
      try {
        if (!child.kill(signal)) terminationError = true;
      } catch {
        terminationError = true;
      }
    }
    timer = setTimeout(() => {
      deadlineExceeded = true;
      terminationRequested = true;
      terminate("SIGTERM");
      if (settled) return;
      escalationTimer = setTimeout(() => {
        escalationRequested = true;
        terminate("SIGKILL");
        if (settled) return;
        // Releasing this client handle is not cancellation of Docker/server work.
        settlementTimer = setTimeout(() => finish(null, null, false), cleanupGraceMs);
      }, cleanupGraceMs);
    }, options.timeout);
    child.once("spawn", () => {
      spawned = true;
    });
    child.on("error", (error) => {
      if (settled) return;
      errorCategory = errorCodes.has(error?.code) ? error.code : "other";
      // Kill failures can emit repeatedly during escalation. Keep errors handled and
      // the log descriptor open until close or explicitly unconfirmed settlement.
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      finish(code, signal, true);
    });
  });
}
