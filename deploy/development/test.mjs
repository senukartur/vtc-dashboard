import { randomBytes } from "node:crypto";
import { mkdir, open, writeFile } from "node:fs/promises";
import { runRehearsalChild } from "./rehearsal-child.mjs";

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== "--manual-only"))
  throw new Error("REHEARSAL_MODE_INVALID");
const mode = args.length ? "manual-only" : "full";
const label = mode === "full" ? "Deployment rehearsal" : "Focused manual deployment rehearsal";
const identity = randomBytes(8).toString("hex");
const project = `vtc011-${identity}`;
const revision = identity.repeat(3).slice(0, 40);
const runner = `${project}-operator`;
const volume = `${project}-config`;
const network = `${project}-operator`;
await mkdir(`.local/development/${identity}`, { recursive: true });
let operation = 0;
async function docker(args, timeout = 600000, allowFailure = false) {
  const index = operation++;
  const log = await open(`.local/development/${identity}/${index}.log`, "w", 0o600);
  const startedAt = new Date().toISOString();
  console.log(
    JSON.stringify({
      event: "deployment_rehearsal_child",
      operation: index,
      state: "start",
      startedAt,
      timeoutMs: timeout,
    }),
  );
  let outcome;
  try {
    outcome = await runRehearsalChild("docker", args, {
      stdio: ["ignore", log.fd, log.fd],
      timeout,
    });
  } finally {
    await log.close();
  }
  const metadata = {
    event: "deployment_rehearsal_child",
    operation: index,
    state: "settled",
    startedAt,
    ...outcome,
  };
  await writeFile(
    `.local/development/${identity}/${index}.lifecycle.json`,
    JSON.stringify(metadata) + "\n",
    { mode: 0o600 },
  );
  console.log(JSON.stringify(metadata));
  const code = outcome.exitCode;
  if (code !== 0 && !allowFailure) throw new Error("REHEARSAL_OPERATION_FAILED");
  return code;
}
let passed = false;
try {
  await docker([
    "build",
    "--target",
    "production",
    "--build-arg",
    `VTC_REVISION=${revision}`,
    "--label",
    `vtc011.rehearsal=${project}`,
    "-t",
    `vtc-dashboard:${revision}`,
    ".",
  ]);
  console.log(`${label}: production image built`);
  await docker([
    "build",
    "-f",
    "deploy/development/operator-test.Dockerfile",
    "--label",
    `vtc011.rehearsal=${project}`,
    "-t",
    runner,
    ".",
  ]);
  await docker(["volume", "create", volume]);
  await docker(["network", "create", network]);
  await docker(
    [
      "run",
      "--name",
      runner,
      "--rm",
      "--network",
      network,
      "--mount",
      "type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock",
      "--mount",
      `type=volume,source=${volume},target=/opt/vtc-development`,
      "-e",
      `REHEARSAL_PROJECT=${project}`,
      "-e",
      `REHEARSAL_VOLUME=${volume}`,
      "-e",
      `REHEARSAL_REVISION=${revision}`,
      "-e",
      `REHEARSAL_MODE=${mode}`,
      runner,
    ],
    // FULL adds synthetic role/upgrade/recovery proofs: the observed aggregate
    // reached dirty-migration at 876982ms before its 900000ms cutoff. Individual
    // operation and production deadlines stay unchanged; manual mode retains its bound.
    mode === "full" ? 1_000_000 : 900_000,
  );
  passed = true;
  console.log(
    mode === "full"
      ? "Deployment rehearsal: SQL privileges, persistence, consistent export/restore, dirty migration, auth, TLS, archive and operation-lock cases passed"
      : "Focused manual deployment rehearsal: codec, notices, persistent bytes and restricted manual role proof passed; remaining baseline NOT RUN",
  );
} catch {
  console.error(`${label}: failed; raw child output kept private`);
  await docker(["logs", `${project}-db-1`], 30000, true);
  await docker(
    [
      "run",
      "--rm",
      "--network",
      "none",
      "--mount",
      `type=volume,source=${volume},target=/opt/vtc-development`,
      runner,
      "cat",
      "/opt/vtc-development/state/last-failed-child.stderr",
    ],
    30000,
    true,
  );
} finally {
  await docker(["rm", "-f", runner], 30000, true);
  // Only resources bearing this fresh random allocation are eligible for cleanup.
  for (const type of ["container", "network", "volume", "image"]) {
    const { spawnSync } = await import("node:child_process");
    const filter =
      type === "container"
        ? ["ps", "-aq", "--filter", `label=vtc011.rehearsal=${project}`]
        : type === "image"
          ? [
              "image",
              "ls",
              "-a",
              "-q",
              "--no-trunc",
              "--filter",
              `label=vtc011.rehearsal=${project}`,
            ]
          : type === "network"
            ? ["network", "ls", "-q", "--filter", `label=vtc011.rehearsal=${project}`]
            : ["volume", "ls", "-q", "--filter", `label=vtc011.rehearsal=${project}`];
    const result = spawnSync("docker", filter, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (result.status !== 0) passed = false;
    if (type === "image") {
      // Include untagged parent images after same-SHA retagging. Three bounded
      // passes also cover engines that retain parent/child deletion ordering.
      let pending = result;
      for (let attempt = 0; attempt < 3 && pending.status === 0; attempt++) {
        const images = new Set(pending.stdout.trim().split(/\s+/).filter(Boolean));
        if (!images.size) break;
        for (const resource of images) await docker(["image", "rm", "-f", resource], 30000, true);
        pending = spawnSync("docker", filter, {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        });
      }
      if (pending.status !== 0 || pending.stdout?.trim()) passed = false;
      continue;
    }
    for (const resource of new Set(result.stdout?.trim().split(/\s+/).filter(Boolean) ?? []))
      if (
        (await docker(
          type === "container" ? ["rm", "-f", resource] : [type, "rm", resource],
          30000,
          true,
        )) !== 0
      )
        passed = false;
  }
  if ((await docker(["volume", "rm", volume], 30000, true)) !== 0) passed = false;
  if ((await docker(["network", "rm", network], 30000, true)) !== 0) passed = false;
}
process.exitCode = passed ? 0 : 1;
