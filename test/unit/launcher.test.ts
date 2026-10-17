import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { bounded, until } from "../support/concurrency.ts";
import { safeChildEnvironment } from "../support/environment.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const fakeDocker = `#!/usr/bin/env node
import { existsSync } from "node:fs";
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
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
    console.log("FAKE_CLEANUP_SIGNAL_FORWARDED"); process.exit(91);
  });
  console.log("FAKE_CLEANUP_STARTED");
  const timer = setInterval(() => {
    if (existsSync(join(process.env.VTC_FAKE_DOCKER_DIR, "release"))) {
      clearInterval(timer); console.log("FAKE_CLEANUP_COMPLETE");
    }
  }, 10);
} else process.exit(8);
`;

async function launcher(
  mode: "signals" | "fail",
  work: (session: {
    child: ReturnType<typeof spawn>;
    output: () => string;
    exit: Promise<number>;
    release: () => Promise<void>;
    configuration: () => string;
  }) => Promise<void>,
) {
  await mkdir(resolve(root, ".local/testing"), { recursive: true });
  const directory = await mkdtemp(resolve(root, ".local/testing/fake-docker-"));
  await writeFile(join(directory, "docker"), fakeDocker, { mode: 0o755 });
  const child = spawn(process.execPath, ["scripts/test-local.mjs", "unit"], {
    cwd: root,
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
  try {
    await work({
      child,
      output: () => output,
      exit,
      release: () => writeFile(join(directory, "release"), "synthetic"),
      configuration,
    });
  } finally {
    await writeFile(join(directory, "release"), "synthetic");
    if (child.exitCode === null) child.kill("SIGKILL");
    await bounded(exit, "fake-launcher-exit");
    const run = output.match(/Owned isolated test project: vtc008-([a-f0-9]{16})/)?.[1];
    if (run) await rm(resolve(root, ".local/testing", run), { recursive: true });
    await rm(directory, { recursive: true });
  }
}

test.skipIf(process.platform === "win32")(
  "repeated signals during cleanup cannot kill the owned compose-down child",
  async () => {
    await launcher("signals", async ({ child, output, exit, release, configuration }) => {
      await until(async () => output().includes("FAKE_UP_READY"));
      child.kill("SIGINT");
      await until(async () => output().includes("FAKE_CLEANUP_STARTED"));
      child.kill("SIGINT");
      await until(async () => output().includes("Cleanup already running"));
      child.kill("SIGTERM");
      await until(async () => output().split("Cleanup already running").length === 3);
      await release();
      expect(await bounded(exit, "signal-launcher-exit")).toBe(130);
      expect(output()).toContain("FAKE_CLEANUP_COMPLETE");
      expect(output()).not.toContain("FAKE_CLEANUP_SIGNAL_FORWARDED");
      await expect(access(configuration())).rejects.toMatchObject({ code: "ENOENT" });
    });
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
    });
  },
);
