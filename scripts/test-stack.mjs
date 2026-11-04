import { spawn } from "node:child_process";
import { eventLine } from "./ci-result.mjs";

if (process.env.VTC_TEST_LAUNCH !== "isolated-compose")
  throw new Error("ISOLATED_TEST_LAUNCH_REQUIRED");
const base = Object.fromEntries(
  ["PATH", "HOME", "PLAYWRIGHT_BROWSERS_PATH", "NODE_ENV", "TZ"]
    .filter((key) => process.env[key] !== undefined)
    .map((key) => [key, process.env[key]]),
);
let active;
let interrupted = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    interrupted = true;
    active?.kill(signal);
  });
async function run(args, env = base) {
  const started = Date.now();
  const code = await new Promise((accept, reject) => {
    active = spawn("pnpm", args, { stdio: "inherit", env });
    active.once("error", reject);
    active.once("exit", (status) => accept(status ?? 1));
  });
  console.log(`STACK ${args[0]}: ${code === 0 ? "PASS" : "FAIL"} (${Date.now() - started}ms)`);
  if (["check", "build"].includes(args[0]))
    console.log(eventLine(args[0], code, Date.now() - started));
  return code;
}
// Only a focused local run may skip check; the full suite and probes always run it.
const skipCheck =
  process.env.VTC_TEST_SKIP_CHECK === "1" &&
  !["all", "failure-reporting"].includes(process.env.VTC_TEST_FOCUS) &&
  !process.env.VTC_TEST_PROBE;
if (skipCheck) console.log("STACK check: SKIPPED (focused local run)");
const check = skipCheck ? 0 : await run(["check"]);
const build = interrupted ? 130 : await run(["build"]);
let tests = 1;
if (build === 0 && !interrupted)
  tests = await run(
    [
      process.env.VTC_TEST_FOCUS === "all"
        ? "test:all"
        : ({ persistence: "db:test", recovery: "db:recovery" }[process.env.VTC_TEST_FOCUS] ??
          `test:${process.env.VTC_TEST_FOCUS}`),
    ],
    {
      ...base,
      VTC_TEST_RUN: process.env.VTC_TEST_RUN,
      VTC_TEST_ROOT_PASSWORD: process.env.VTC_TEST_ROOT_PASSWORD,
      VTC_TEST_LAUNCH: process.env.VTC_TEST_LAUNCH,
      VTC_TEST_PROBE: process.env.VTC_TEST_PROBE,
      VTC_TEST_SELECTION: process.env.VTC_TEST_SELECTION,
      VTC_TEST_PROJECT: process.env.VTC_TEST_PROJECT,
    },
  );
process.exitCode = check || build || tests;
