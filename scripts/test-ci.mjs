import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { collectEvents, qualityReport } from "./ci-result.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const probe =
  args[0] === "--probe" && args.length === 2 && ["unit", "integration", "e2e"].includes(args[1])
    ? args[1]
    : undefined;
if (args.length && !probe) throw new Error("INVALID_CI_ARGUMENTS");
const directory = new URL("../.local/ci/", import.meta.url);
await mkdir(directory, { recursive: true });
const path = new URL("quality.json", directory);
await rm(path, { force: true });
const collector = collectEvents();
const started = Date.now();
const child = spawn(
  process.execPath,
  ["scripts/test-local.mjs", ...(probe ? [probe, "--probe"] : [])],
  {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  },
);
let interrupted = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    interrupted = true;
    child.kill(signal);
  });
// Consume and discard raw streams, including Docker/build output and exception messages.
child.stdout.on("data", (chunk) => collector.push(chunk));
child.stderr.resume();
const code = await new Promise((accept) => {
  child.once("error", () => accept(1));
  child.once("close", (status) => accept(status ?? 1));
});
const report = qualityReport(
  interrupted ? 130 : code,
  Date.now() - started,
  collector.events,
  probe,
  collector.browserFailures,
);
await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(`Quality suite: ${report.status}; ${report.category}`);
for (const event of report.stages)
  console.log(`${event.stage}: ${event.status} (${event.durationMs}ms)`);
if (report.probeIdentity) console.log(`Probe: ${report.probeIdentity}; exit ${report.exitCode}`);
process.exitCode = report.exitCode;
