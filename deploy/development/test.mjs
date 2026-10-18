import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, open } from "node:fs/promises";

const identity = randomBytes(8).toString("hex");
const project = `vtc011-${identity}`;
const revision = identity.repeat(3).slice(0, 40);
const runner = `${project}-operator`;
const volume = `${project}-config`;
const network = `${project}-operator`;
await mkdir(`.local/development/${identity}`, { recursive: true });
let operation = 0;
async function docker(args, timeout = 600000, allowFailure = false) {
  const log = await open(`.local/development/${identity}/${operation++}.log`, "w", 0o600);
  const code = await new Promise((accept) => {
    const child = spawn("docker", args, {
      stdio: ["ignore", log.fd, log.fd],
      timeout,
      windowsHide: true,
    });
    child.on("error", () => accept(1));
    child.on("close", (status) => accept(status ?? 1));
  });
  await log.close();
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
  console.log("Deployment rehearsal: production image built");
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
      runner,
    ],
    900000,
  );
  passed = true;
  console.log(
    "Deployment rehearsal: SQL privileges, persistence, consistent export/restore, dirty migration, auth, TLS, archive and operation-lock cases passed",
  );
} catch {
  console.error("Deployment rehearsal: failed; raw child output kept private");
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
      "/opt/vtc-development/state/last-child.stderr",
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
