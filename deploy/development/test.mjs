import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, open, writeFile } from "node:fs/promises";
import {
  rehearsalPlan,
  retainRehearsalEvidence,
  runRehearsalChild,
  validateEvidenceCollector,
} from "./rehearsal-child.mjs";

const args = process.argv.slice(2);
const { mode, groups, requireWindow } = rehearsalPlan(args);
const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const fingerprint = createHash("sha256");
for (const path of execFileSync(
  "git",
  ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean)
  .sort()) {
  fingerprint.update(path).update("\0").update(readFileSync(path)).update("\0");
}
const sourceFingerprint = fingerprint.digest("hex");
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
let passed = false,
  operatorBuilt = false,
  volumeAllocated = false,
  volumeReceipt = null,
  volumeSafe = false,
  allocationStatusKnown = false,
  retainAllocation = false,
  productionImageId = null;
async function inspectAllocatedVolume() {
  const index = operation;
  await docker(["volume", "inspect", volume], 30000);
  const records = JSON.parse(readFileSync(`.local/development/${identity}/${index}.log`));
  if (
    records.length !== 1 ||
    records[0].Name !== volume ||
    records[0].Labels?.["vtc011.rehearsal"] !== project ||
    records[0].Driver !== "local" ||
    typeof records[0].CreatedAt !== "string"
  )
    throw new Error("REHEARSAL_VOLUME_BINDING_INVALID");
  return JSON.stringify({
    name: records[0].Name,
    createdAt: records[0].CreatedAt,
    driver: records[0].Driver,
    labels: records[0].Labels,
  });
}
async function requireAllocatedVolume() {
  if (!volumeReceipt || (await inspectAllocatedVolume()) !== volumeReceipt)
    throw new Error("REHEARSAL_VOLUME_BINDING_CHANGED");
}
const collector = {
  phase: "unallocated",
  name: `${runner}-evidence`,
  attempt: randomBytes(16).toString("hex"),
  project,
  volume,
  sourceSha,
  sourceFingerprint,
};
const collectorJournal = `.local/development/${identity}/evidence-container.json`;
async function saveCollector(first = false, value = collector) {
  const handle = await open(collectorJournal, first ? "wx" : "r+", 0o600);
  try {
    if (!first) {
      const prior = JSON.parse(await handle.readFile("utf8"));
      if (
        prior.attempt !== collector.attempt ||
        prior.sourceFingerprint !== sourceFingerprint ||
        prior.project !== project
      )
        throw new Error("REHEARSAL_EVIDENCE_RECEIPT_CHANGED");
    }
    const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
    await handle.truncate(0);
    await handle.write(bytes, 0, bytes.length, 0);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function privateDocker(args) {
  const index = operation;
  await docker(args, 30000);
  return readFileSync(`.local/development/${identity}/${index}.log`);
}
async function requireCollector() {
  const records = JSON.parse(await privateDocker(["inspect", collector.id]));
  if (records.length !== 1) throw new Error("REHEARSAL_EVIDENCE_COLLECTOR_BINDING_INVALID");
  validateEvidenceCollector(records[0], collector);
}
async function collectEvidence() {
  const images = JSON.parse(await privateDocker(["image", "inspect", runner]));
  if (
    images.length !== 1 ||
    !/^sha256:[a-f0-9]{64}$/.test(images[0].Id) ||
    images[0].Config.Labels?.["vtc011.rehearsal"] !== project
  )
    throw new Error("REHEARSAL_EVIDENCE_IMAGE_INVALID");
  collector.imageId = images[0].Id;
  collector.volumeReceipt = volumeReceipt;
  collector.revision = revision;
  collector.productionImageId = productionImageId;
  const cidfile = resolve(`.local/development/${identity}/evidence.cid`);
  if (existsSync(cidfile)) throw new Error("REHEARSAL_EVIDENCE_CID_COLLISION");
  collector.phase = "creating";
  await saveCollector(true);
  const response = (
    await privateDocker([
      "create",
      "--cidfile",
      cidfile,
      "--name",
      collector.name,
      "--label",
      `vtc011.rehearsal=${project}`,
      "--label",
      `vtc011.evidence-attempt=${collector.attempt}`,
      "--network",
      "none",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges:true",
      "--memory",
      "64m",
      "--pids-limit",
      "16",
      "--mount",
      `type=volume,source=${volume},target=/evidence,readonly`,
      collector.imageId,
      "python3",
      "/source/rehearsal_evidence.py",
    ])
  )
    .toString()
    .trim();
  if (!/^[a-f0-9]{64}$/.test(response) || readFileSync(cidfile, "utf8").trim() !== response)
    throw new Error("REHEARSAL_EVIDENCE_CREATE_UNCERTAIN");
  collector.id = response;
  await requireCollector();
  await saveCollector(false, { ...collector, phase: "created" });
  collector.phase = "created";
  const bytes = await privateDocker(["start", "--attach", collector.id]);
  const snapshot = JSON.parse(bytes);
  if (typeof snapshot.windowFenced === "boolean") {
    allocationStatusKnown = true;
    retainAllocation = snapshot.windowFenced;
    if (retainAllocation) passed = false;
  }
  const files = await retainRehearsalEvidence(
    bytes,
    `.local/development/${identity}/evidence.json`,
    {
      requireWindow: passed && requireWindow,
      requiredGroups:
        passed && mode === "full"
          ? groups.filter((group) => ["core", "window", "recovery"].includes(group))
          : [],
      sourceSha,
      sourceFingerprint,
      project,
      revision,
      volume,
      expectedImageId: productionImageId,
    },
  );
  console.log(JSON.stringify({ event: "deployment_rehearsal_evidence", result: "pass", files }));
}
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
  const produced = JSON.parse(
    await privateDocker(["image", "inspect", `vtc-dashboard:${revision}`]),
  );
  if (
    produced.length !== 1 ||
    !/^sha256:[a-f0-9]{64}$/.test(produced[0].Id) ||
    produced[0].Config.Labels?.["vtc011.rehearsal"] !== project
  )
    throw new Error("REHEARSAL_PRODUCTION_IMAGE_INVALID");
  productionImageId = produced[0].Id;
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
  operatorBuilt = true;
  await docker(["volume", "create", "--label", `vtc011.rehearsal=${project}`, volume]);
  volumeAllocated = true;
  volumeReceipt = await inspectAllocatedVolume();
  volumeSafe = true;
  await docker(["network", "create", network]);
  for (const group of groups) {
    console.log(
      JSON.stringify({
        event: "deployment_rehearsal_group",
        group,
        state: "start",
        sourceSha,
        sourceFingerprint,
      }),
    );
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
        "-e",
        `REHEARSAL_GROUP=${group}`,
        "-e",
        `REHEARSAL_REQUIRE_WINDOW=${requireWindow}`,
        "-e",
        `REHEARSAL_SOURCE_SHA=${sourceSha}`,
        "-e",
        `REHEARSAL_SOURCE_FINGERPRINT=${sourceFingerprint}`,
        runner,
      ],
      // Separate finite aggregate guards compose the required work on the same allocation.
      // Production and individual operation/migration bounds are unchanged.
      group === "window" ? 1_800_000 : mode === "full" ? 1_000_000 : 900_000,
    );
    console.log(JSON.stringify({ event: "deployment_rehearsal_group", group, state: "pass" }));
  }
  passed = true;
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
  if (operatorBuilt && volumeAllocated) {
    try {
      volumeSafe = false;
      await requireAllocatedVolume();
      volumeSafe = true;
      await collectEvidence();
    } catch {
      passed = false;
      console.error(
        "Deployment rehearsal evidence retention failed; private records and lifecycle retained",
      );
    }
  }
  if (collector.phase === "creating") {
    passed = false;
    volumeSafe = false;
    retainAllocation = true;
    console.error(
      "Evidence collector creation is uncertain; retain its receipt and config volume for recovery",
    );
  } else if (collector.phase === "created") {
    try {
      await requireCollector();
      await docker(["rm", "-f", collector.id], 30000);
      if (
        (await privateDocker(["ps", "-aq", "--no-trunc", "--filter", `id=${collector.id}`]))
          .toString()
          .trim()
      )
        volumeSafe = false;
      else {
        collector.phase = "removed";
        await saveCollector();
      }
    } catch {
      passed = false;
      volumeSafe = false;
      retainAllocation = true;
    }
    if (collector.phase !== "removed") {
      passed = false;
      retainAllocation = true;
    }
  }
  if (volumeAllocated && !allocationStatusKnown) retainAllocation = true;
  await docker(["rm", "-f", runner], 30000, true);
  // Only resources bearing this fresh random allocation are eligible for cleanup.
  for (const type of ["container", "network", "volume", "image"]) {
    if (retainAllocation) {
      passed = false;
      console.error(
        "Rehearsal allocation retained for owned recovery; active fence or uncertain evidence/collector state",
      );
      break;
    }
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
    for (const resource of new Set(result.stdout?.trim().split(/\s+/).filter(Boolean) ?? [])) {
      if (type === "volume" && resource === volume) continue;
      if (
        (await docker(
          type === "container" ? ["rm", "-f", resource] : [type, "rm", resource],
          30000,
          true,
        )) !== 0
      )
        passed = false;
    }
  }
  if (volumeSafe && !retainAllocation) {
    try {
      await requireAllocatedVolume();
      if ((await docker(["volume", "rm", volume], 30000, true)) !== 0) passed = false;
    } catch {
      passed = false;
      console.error(
        "Deployment config volume ownership is uncertain; retain it for reviewed recovery",
      );
    }
  }
  if (!retainAllocation && (await docker(["network", "rm", network], 30000, true)) !== 0)
    passed = false;
}
if (passed)
  console.log(
    args[0] === "--core-recovery"
      ? "Focused deployment core/recovery passed; required window group NOT RUN"
      : mode === "full"
        ? "Deployment rehearsal: required core/window/recovery groups, evidence retention and cleanup passed; SQL privileges, persistence, consistent export/restore, dirty migration, auth, TLS, archive and operation-lock cases passed"
        : "Focused manual deployment rehearsal: codec, notices, persistent bytes and restricted manual role proof passed; remaining baseline NOT RUN",
  );
process.exitCode = passed ? 0 : 1;
