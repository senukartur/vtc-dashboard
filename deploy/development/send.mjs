import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { validateManifest } from "./policy.mjs";

try {
  const selected = JSON.parse(await readFile(".local/deploy/selected.json", "utf8"));
  const manifest = validateManifest(
    JSON.parse(await readFile(".local/deploy/release.json", "utf8")),
    selected,
  );
  const target = process.env.DEPLOY_TARGET;
  if (!/^vtc-deploy@[a-zA-Z0-9.-]+$/.test(target ?? "")) throw new Error("TARGET_INVALID");
  await mkdir(".local/deploy/ssh", { mode: 0o700 });
  for (const [name, content] of [
    ["key", process.env.DEPLOY_KEY],
    ["known_hosts", process.env.DEPLOY_KNOWN_HOSTS],
  ]) {
    if (!content || content.length > 32768) throw new Error("SSH_CONFIGURATION_INVALID");
    await writeFile(`.local/deploy/ssh/${name}`, `${content.trim()}\n`, { mode: 0o600 });
    await chmod(`.local/deploy/ssh/${name}`, 0o600);
  }
  const command = `release ${selected.revision} ${manifest.sha256} ${manifest.bytes} ${manifest.imageId} ${selected.runId} ${selected.attempt} ${selected.mode}`;
  const child = spawn(
    "ssh",
    [
      "-T",
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=yes",
      "-o",
      "IdentitiesOnly=yes",
      "-o",
      "ConnectTimeout=15",
      "-o",
      "ServerAliveInterval=15",
      "-o",
      "ServerAliveCountMax=3",
      "-o",
      "UserKnownHostsFile=.local/deploy/ssh/known_hosts",
      "-i",
      ".local/deploy/ssh/key",
      target,
      command,
    ],
    { stdio: ["pipe", "ignore", "ignore"], timeout: 900000 },
  );
  child.stdin.on("error", () => {});
  createReadStream(".local/deploy/image.tar").pipe(child.stdin);
  const code = await new Promise((accept) => {
    child.on("error", () => accept(1));
    child.on("close", accept);
  });
  if (code !== 0) throw new Error("REMOTE_RELEASE_FAILED");
  console.log(`Protected release: success ${selected.revision}`);
} catch {
  console.error("Protected release: failure; use private operator diagnostics");
  process.exitCode = 1;
}
