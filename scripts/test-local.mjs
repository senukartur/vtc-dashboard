import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const focus = process.argv[2] ?? "all";
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
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    interrupted = true;
    active?.kill(signal);
  });
async function docker(tail) {
  return new Promise((accept, reject) => {
    active = spawn("docker", [...args, ...tail], {
      cwd: root,
      stdio: "inherit",
      env: {
        ...process.env,
        // Explicit env-file plus these values prevent shell interpolation overriding the allocation.
        VTC_TEST_RUN: run,
        VTC_TEST_FOCUS: focus,
        VTC_TEST_OUTPUT: output.replaceAll("\\", "/"),
        VTC_TEST_ROOT_PASSWORD: undefined,
      },
    });
    active.once("error", reject);
    active.once("exit", (code) => accept(code ?? 1));
  });
}
let result = 1;
try {
  console.log(`Owned isolated test project: ${project}`);
  const built = await docker(["build", "runner"]);
  if (built === 0 && !interrupted)
    result = await docker(["up", "--abort-on-container-exit", "--exit-code-from", "runner"]);
} finally {
  // The project name is a fresh random allocation, never an existing development stack.
  const cleaned = await docker(["down", "--volumes", "--remove-orphans", "--timeout", "5"]);
  if (cleaned !== 0) result = 1;
}
process.exitCode = interrupted ? 130 : result;
