import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { bounded, until } from "../support/concurrency.ts";
import { safeChildEnvironment } from "../support/environment.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const fakeDocker = `#!/usr/bin/env node
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
if (args.includes("build")) process.exit(0);
if (args.includes("up")) {
  process.on("SIGINT", () => process.exit(130));
  process.on("SIGTERM", () => process.exit(143));
  console.log("FAKE_UP_READY");
  if (process.env.VTC_FAKE_DOCKER_MODE === "fail") process.exit(0);
  const timer = setInterval(() => {
    if (existsSync(join(process.env.VTC_FAKE_DOCKER_DIR, "release"))) {
      clearInterval(timer); process.exit(0);
    }
  }, 10);
} else if (args.includes("down")) {
  if (process.env.VTC_FAKE_DOCKER_MODE === "fail") process.exit(7);
  writeFileSync(join(process.env.VTC_FAKE_DOCKER_DIR, "cleanup-pid"), String(process.pid));
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
    console.log("FAKE_CLEANUP_SIGNAL_FORWARDED"); process.exit(91);
  });
  console.log("FAKE_CLEANUP_STARTED");
  const timer = setInterval(() => {
    if (process.env.VTC_FAKE_DOCKER_MODE !== "refuse-release" && existsSync(join(process.env.VTC_FAKE_DOCKER_DIR, "release"))) {
      clearInterval(timer); console.log("FAKE_CLEANUP_COMPLETE");
    }
  }, 10);
} else process.exit(8);
`;

async function launcher(
  mode: "signals" | "fail" | "refuse-release",
  work: (session: {
    child: ReturnType<typeof spawn>;
    output: () => string;
    exit: Promise<number>;
    release: () => Promise<void>;
    configuration: () => string;
  }) => Promise<void>,
  ownProcessGroup = false,
  observed?: { fallbackUsed: boolean; cleanupPid?: number | undefined },
) {
  await mkdir(resolve(root, ".local/testing"), { recursive: true });
  const directory = await mkdtemp(resolve(root, ".local/testing/fake-docker-"));
  await writeFile(join(directory, "docker"), fakeDocker, { mode: 0o755 });
  const child = spawn(process.execPath, ["scripts/test-local.mjs", "unit"], {
    cwd: root,
    detached: ownProcessGroup,
    windowsHide: true,
    env: {
      ...safeChildEnvironment(),
      PATH: `${directory}${delimiter}${process.env.PATH ?? ""}`,
      VTC_FAKE_DOCKER_DIR: directory,
      VTC_FAKE_DOCKER_MODE: mode,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  for (const stream of [child.stdout, child.stderr])
    stream?.on("data", (chunk) => {
      output += String(chunk);
    });
  const exit = new Promise<number>((accept, reject) => {
    child.once("error", reject);
    child.once("close", (code) => accept(code ?? 1));
  });
  const configuration = () => {
    const run = output.match(/Owned isolated test project: vtc008-([a-f0-9]{16})/)?.[1];
    if (!run) throw new Error("FAKE_LAUNCHER_ALLOCATION_MISSING");
    return resolve(root, ".local/testing", run, "stack.env");
  };
  let callbackFailed = false;
  let callbackError: unknown;
  try {
    await work({
      child,
      output: () => output,
      exit,
      release: () => writeFile(join(directory, "release"), "synthetic"),
      configuration,
    });
  } catch (error) {
    callbackFailed = true;
    callbackError = error;
  }
  try {
    await writeFile(join(directory, "release"), "synthetic");
    // Give polling children time to observe release before removing their directory.
    try {
      await bounded(exit, "fake-launcher-graceful-exit", 1500);
    } catch {
      if (observed) observed.fallbackUsed = true;
      // Only the fake executable in this uniquely allocated directory writes this PID.
      const cleanupPid = Number(await readFile(join(directory, "cleanup-pid"), "utf8"));
      if (!Number.isSafeInteger(cleanupPid) || cleanupPid < 2)
        throw new Error("INVALID_FAKE_CLEANUP_PID");
      if (observed) observed.cleanupPid = cleanupPid;
      try {
        process.kill(-cleanupPid, "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
      await bounded(exit, "fake-launcher-fallback-exit");
      await until(async () => {
        try {
          process.kill(cleanupPid, 0);
          return false;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
          throw error;
        }
      });
    }
    const run = output.match(/Owned isolated test project: vtc008-([a-f0-9]{16})/)?.[1];
    if (run) await rm(resolve(root, ".local/testing", run), { recursive: true });
    await rm(directory, { recursive: true });
  } catch (error) {
    // An assertion in the callback remains the primary failure, even if teardown fails.
    if (!callbackFailed) throw error;
  }
  if (callbackFailed) throw callbackError;
}

for (const target of ["PID", "process group"] as const)
  test.skipIf(process.platform === "win32")(
    `repeated ${target} signals during cleanup cannot kill the owned compose-down child`,
    async () => {
      await launcher(
        "signals",
        async ({ child, output, exit, release, configuration }) => {
          const signal = (value: NodeJS.Signals) => {
            if (target === "process group") {
              if (!child.pid) throw new Error("OWNED_LAUNCHER_PID_MISSING");
              // This group was created by this helper; never signal the test runner's group.
              process.kill(-child.pid, value);
            } else child.kill(value);
          };
          await until(async () => output().includes("FAKE_UP_READY"));
          signal("SIGINT");
          await until(async () => output().includes("FAKE_CLEANUP_STARTED"));
          expect(
            JSON.parse(await readFile(join(dirname(configuration()), "cleanup.json"), "utf8")),
          ).toMatchObject({ phase: "started", category: "pending", exitCode: null });
          signal("SIGINT");
          await until(async () => output().includes("Cleanup already running"));
          signal("SIGTERM");
          await until(async () => output().split("Cleanup already running").length === 3);
          await release();
          expect(await bounded(exit, "signal-launcher-exit")).toBe(130);
          expect(output()).toContain("FAKE_CLEANUP_COMPLETE");
          expect(output()).not.toContain("FAKE_CLEANUP_SIGNAL_FORWARDED");
          expect(
            JSON.parse(await readFile(join(dirname(configuration()), "cleanup.json"), "utf8")),
          ).toMatchObject({ phase: "completed", category: "completed", exitCode: 0 });
          await expect(access(configuration())).rejects.toMatchObject({ code: "ENOENT" });
        },
        target === "process group",
      );
    },
  );

test.skipIf(process.platform === "win32")(
  "failed compose-down retains private configuration and prints a bounded recovery instruction",
  async () => {
    await launcher("fail", async ({ output, exit, configuration }) => {
      await until(async () => output().includes("FAKE_UP_READY"));
      expect(await bounded(exit, "failed-cleanup-launcher-exit")).toBe(1);
      expect(output()).toContain("TEST_STACK_CLEANUP_FAILED");
      expect(output()).toContain("Recovery: docker compose --project-name vtc008-");
      expect((await readFile(configuration(), "utf8")).length).toBeGreaterThan(0);
      expect(
        JSON.parse(await readFile(join(dirname(configuration()), "cleanup.json"), "utf8")),
      ).toMatchObject({ phase: "completed", category: "nonzero-exit", exitCode: 7 });
    });
  },
);

for (const mode of ["signals", "refuse-release"] as const)
  test.skipIf(process.platform === "win32")(
    `early callback failure during cleanup preserves its error and reaps fake child (${mode})`,
    async () => {
      const original = new Error("SYNTHETIC_CALLBACK_ASSERTION");
      const observed = { fallbackUsed: false, cleanupPid: undefined as number | undefined };
      let output = "";
      await expect(
        launcher(
          mode,
          async (session) => {
            await until(async () => session.output().includes("FAKE_UP_READY"));
            session.child.kill("SIGINT");
            await until(async () => session.output().includes("FAKE_CLEANUP_STARTED"));
            const priorOutput = session.output;
            // Capture the final output on every teardown observation.
            session.child.on("close", () => {
              output = priorOutput();
            });
            throw original;
          },
          false,
          observed,
        ),
      ).rejects.toBe(original);
      expect(observed.fallbackUsed).toBe(mode === "refuse-release");
      if (mode === "signals") expect(output).toContain("FAKE_CLEANUP_COMPLETE");
      else {
        expect(observed.cleanupPid).toBeGreaterThan(1);
        const pid = observed.cleanupPid;
        if (!pid) throw new Error("FAKE_CLEANUP_PID_NOT_OBSERVED");
        expect(() => process.kill(pid, 0)).toThrow();
      }
    },
  );
