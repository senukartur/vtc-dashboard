import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eventLine } from "./ci-result.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const focus = process.argv[2] ?? "all";
const probe = process.argv[3] === "--probe";
if (probe && !["unit", "integration", "e2e"].includes(focus)) throw new Error("INVALID_PROBE_LANE");
if (
  ![
    "all",
    "unit",
    "contracts",
    "integration",
    "persistence",
    "recovery",
    "e2e",
    "failure-reporting",
  ].includes(focus)
) {
  throw new Error("INVALID_TEST_LANE");
}
const run = randomBytes(8).toString("hex");
const project = `vtc008-${run}`;
const directory = resolve(root, ".local/testing", run);
const output = resolve(directory, "output");
await mkdir(output, { recursive: true });
const envFile = resolve(directory, "stack.env");
await writeFile(
  envFile,
  [
    `VTC_TEST_ROOT_PASSWORD=${randomBytes(32).toString("hex")}`,
    `VTC_TEST_RUN=${run}`,
    `VTC_TEST_FOCUS=${focus}`,
    `VTC_TEST_PROBE=${probe ? "assertion" : ""}`,
    `VTC_TEST_UID=${process.getuid?.() ?? 1000}`,
    `VTC_TEST_GID=${process.getgid?.() ?? 1000}`,
    `VTC_TEST_OUTPUT=${output.replaceAll("\\", "/")}`,
    "",
  ].join("\n"),
  { mode: 0o600, flag: "wx" },
);
const args = [
  "compose",
  "--project-name",
  project,
  "--env-file",
  envFile,
  "-f",
  resolve(root, "deploy/test/compose.yaml"),
];
let active;
let interrupted = false;
let cleaning = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    interrupted = true;
    if (cleaning) console.log("Cleanup already running; waiting for owned resources.");
    else active?.kill(signal);
  });
async function docker(tail, timeout) {
  return new Promise((accept, reject) => {
    const ownProcessGroup = cleaning;
    const child = spawn("docker", [...args, ...tail], {
      cwd: root,
      stdio: ownProcessGroup ? ["ignore", "pipe", "pipe"] : "inherit",
      // Await cleanup in a separate POSIX session so terminal signals cannot reach it directly.
      detached: ownProcessGroup,
      windowsHide: true,
      env: {
        ...process.env,
        // Explicit env-file plus these values prevent shell interpolation overriding the allocation.
        VTC_TEST_RUN: run,
        VTC_TEST_FOCUS: focus,
        VTC_TEST_PROBE: probe ? "assertion" : "",
        VTC_TEST_UID: String(process.getuid?.() ?? 1000),
        VTC_TEST_GID: String(process.getgid?.() ?? 1000),
        VTC_TEST_OUTPUT: output.replaceAll("\\", "/"),
        VTC_TEST_ROOT_PASSWORD: undefined,
      },
    });
    if (ownProcessGroup) {
      child.stdout.pipe(process.stdout, { end: false });
      child.stderr.pipe(process.stderr, { end: false });
    }
    active = child;
    let expired = false;
    const timer =
      timeout === undefined
        ? undefined
        : setTimeout(() => {
            expired = true;
            // A descendant retaining a pipe must not keep cleanup waiting after its deadline.
            child.stdout?.destroy();
            child.stderr?.destroy();
            try {
              if (ownProcessGroup && process.platform !== "win32" && child.pid)
                process.kill(-child.pid, "SIGKILL");
              else child.kill("SIGKILL");
            } catch {
              child.kill("SIGKILL");
            }
          }, timeout);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      accept(expired ? 1 : (code ?? 1));
    });
  });
}
let result = 1;
try {
  console.log(`Owned isolated test project: ${project}`);
  const started = Date.now();
  const built = await docker(["build", "runner"]);
  console.log(eventLine("build-image", built, Date.now() - started));
  if (built === 0 && !interrupted)
    result = await docker([
      "up",
      "--no-log-prefix",
      "--abort-on-container-exit",
      "--exit-code-from",
      "runner",
    ]);
} finally {
  // The project name is a fresh random allocation, never an existing development stack.
  cleaning = true;
  const started = Date.now();
  let cleaned = 1;
  try {
    cleaned = await docker(["down", "--volumes", "--remove-orphans", "--timeout", "5"], 15000);
  } catch {
    /* Retain the private configuration for explicit recovery below. */
  }
  if (cleaned === 0) {
    try {
      await rm(envFile, { force: true });
    } catch {
      result = 1;
      console.error(
        "TEST_STACK_CONFIGURATION_REMOVAL_FAILED: owned resources removed; private configuration retained.",
      );
    }
  } else {
    result = 1;
    console.error(
      "TEST_STACK_CLEANUP_FAILED: private configuration retained for owned-project recovery.",
    );
    console.error(
      `Recovery: docker compose --project-name ${project} --env-file .local/testing/${run}/stack.env -f deploy/test/compose.yaml down --volumes --remove-orphans --timeout 5`,
    );
  }
  console.log(eventLine("cleanup", cleaned, Date.now() - started));
}
process.exitCode = interrupted ? 130 : result;
