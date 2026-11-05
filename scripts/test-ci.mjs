import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { collectEvents, qualityReport } from "./ci-result.mjs";
import { ciGroups, shardableLanes, validShard } from "./test-selection.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const probe =
  args[0] === "--probe" && args.length === 2 && ["unit", "integration", "e2e"].includes(args[1])
    ? args[1]
    : undefined;
// node scripts/test-ci.mjs --group <core|integration|persistence-recovery|e2e> [--shard <i/n>]
const group = args[0] === "--group" && Object.hasOwn(ciGroups, args[1]) ? args[1] : undefined;
const shard =
  shardableLanes.includes(group) &&
  args.length === 4 &&
  args[2] === "--shard" &&
  validShard(args[3])
    ? args[3]
    : undefined;
if (args.length && !probe && !(group && args.length === (shard ? 4 : 2)))
  throw new Error("INVALID_CI_ARGUMENTS");
// Only core runs check; every other group leaves it to core and still builds.
const launch = probe
  ? [probe, "--probe"]
  : group
    ? [group, ...(group === "core" ? [] : ["--skip-check"]), ...(shard ? ["--shard", shard] : [])]
    : [];
const directory = new URL("../.local/ci/", import.meta.url);
await mkdir(directory, { recursive: true });
const path = new URL("quality.json", directory);
await rm(path, { force: true });
const collector = collectEvents();
const started = Date.now();
const child = spawn(process.execPath, ["scripts/test-local.mjs", ...launch], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
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
  collector.fixtureDiagnostics,
  collector.fileTimings,
);
await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(`Quality suite: ${report.status}; ${report.category}`);
for (const event of report.stages)
  console.log(`${event.stage}: ${event.status} (${event.durationMs}ms)`);
for (const timing of report.fileTimings) console.log(`${timing.file}: ${timing.durationMs}ms`);
if (report.probeIdentity) console.log(`Probe: ${report.probeIdentity}; exit ${report.exitCode}`);
process.exitCode = report.exitCode;
