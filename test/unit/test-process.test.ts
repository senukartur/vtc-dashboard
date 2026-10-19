import { expect, test } from "vitest";
import { eventLine } from "../../scripts/ci-result.mjs";
import { runTestProcess } from "../../scripts/test-process.mjs";
import { bounded } from "../support/concurrency.ts";
import { safeChildEnvironment } from "../support/environment.ts";

const options = { cwd: process.cwd(), env: safeChildEnvironment(), cleanup: true, timeout: 3000 };

test("native exit statuses outside the portable event range stay failures and remain diagnosable", async () => {
  const outcome = await bounded(
    runTestProcess(process.execPath, ["-e", "process.exit(300)"], options),
    "cleanup-native-status",
    5000,
  );
  expect(outcome).toEqual(
    process.platform === "win32"
      ? { exitCode: 1, category: "nonzero-exit", nativeExitCode: 300 }
      : { exitCode: 44, category: "nonzero-exit" },
  );
  expect(() => eventLine("cleanup", outcome.exitCode, 1)).not.toThrow();
  expect(outcome.exitCode).not.toBe(0);
});

test("native owned cleanup process completes and preserves nonzero failure on each platform", async () => {
  expect(
    await bounded(
      runTestProcess(process.execPath, ["-e", "process.exit(0)"], options),
      "cleanup-completed",
      5000,
    ),
  ).toEqual({ exitCode: 0, category: "completed" });
  expect(
    await bounded(
      runTestProcess(process.execPath, ["-e", "process.exit(7)"], options),
      "cleanup-failed",
      5000,
    ),
  ).toEqual({ exitCode: 7, category: "nonzero-exit" });
});

test("native cleanup launch errors retain only a fixed category", async () => {
  expect(
    await bounded(
      runTestProcess("vtc-synthetic-nonexistent-command", [], options),
      "cleanup-spawn-error",
      5000,
    ),
  ).toEqual({ exitCode: 1, category: "spawn-error" });
});

test("native cleanup deadline terminates and reaps the exact owned process", async () => {
  let pid: number | undefined;
  const result = await bounded(
    runTestProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      ...options,
      timeout: 200,
      onSpawn: (child) => {
        pid = child.pid;
      },
    }),
    "cleanup-deadline",
    5000,
  );
  expect(result).toEqual({ exitCode: 1, category: "deadline" });
  expect(pid).toBeGreaterThan(1);
  expect(() => process.kill(pid ?? 0, 0)).toThrow();
});
