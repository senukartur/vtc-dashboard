import { spawn } from "node:child_process";

/** Await owned children; only POSIX needs a new session to isolate terminal signals. */
export function runTestProcess(command, args, options) {
  return new Promise((accept) => {
    const cleanup = options.cleanup === true;
    const ownProcessGroup = cleanup && process.platform !== "win32";
    let child;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: cleanup ? ["ignore", "pipe", "pipe"] : "inherit",
        detached: ownProcessGroup,
        windowsHide: true,
      });
    } catch {
      accept({ exitCode: 1, category: "spawn-error" });
      return;
    }
    options.onSpawn?.(child);
    let category;
    function terminate() {
      // Descendants retaining a pipe cannot extend the cleanup deadline.
      child.stdout?.destroy();
      child.stderr?.destroy();
      try {
        if (ownProcessGroup && child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }
    if (cleanup) {
      for (const [source, target] of [
        [child.stdout, process.stdout],
        [child.stderr, process.stderr],
      ]) {
        source.on("error", () => {
          category = "pipe-error";
          terminate();
        });
        source.pipe(target, { end: false });
      }
    }
    const timer =
      options.timeout === undefined
        ? undefined
        : setTimeout(() => {
            category = "deadline";
            terminate();
          }, options.timeout);
    child.once("error", () => {
      clearTimeout(timer);
      accept({ exitCode: 1, category: "spawn-error" });
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      // Windows native statuses may exceed the portable CI event range. They still fail.
      const portableCode = Number.isInteger(code) && code >= 0 && code <= 255;
      accept({
        exitCode: category || !portableCode ? 1 : code,
        category: category ?? (signal ? "signal-exit" : code === 0 ? "completed" : "nonzero-exit"),
        ...(Number.isSafeInteger(code) && !portableCode ? { nativeExitCode: code } : {}),
      });
    });
  });
}
