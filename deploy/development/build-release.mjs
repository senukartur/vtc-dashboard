import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { maxImageBytes, shaPattern } from "./policy.mjs";

function command(args) {
  const result = spawnSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) throw new Error("IMAGE_COMMAND_FAILED");
  return result.stdout.trim();
}
try {
  const revision = process.env.GITHUB_SHA;
  const runId = Number(process.env.GITHUB_RUN_ID);
  const attempt = Number(process.env.GITHUB_RUN_ATTEMPT);
  if (
    !shaPattern.test(revision ?? "") ||
    !Number.isSafeInteger(runId) ||
    runId < 1 ||
    !Number.isSafeInteger(attempt) ||
    attempt < 1
  )
    throw new Error("INVALID_IDENTITY");
  const tag = `vtc-dashboard:${revision}`;
  await mkdir(".local/release", { recursive: true });
  command([
    "build",
    "--target",
    "production",
    "--build-arg",
    `VTC_REVISION=${revision}`,
    "-t",
    tag,
    ".",
  ]);
  const imageId = command(["image", "inspect", "--format", "{{.Id}}", tag]);
  command(["save", "--output", ".local/release/image.tar", tag]);
  const bytes = (await stat(".local/release/image.tar")).size;
  if (bytes > maxImageBytes) throw new Error("IMAGE_TOO_LARGE");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(".local/release/image.tar")) hash.update(chunk);
  await writeFile(
    ".local/release/release.json",
    `${JSON.stringify({ version: 1, revision, runId, attempt, bytes, imageId, sha256: hash.digest("hex") })}\n`,
  );
  console.log("Production artifact: success");
} catch {
  console.error("Production artifact: failure");
  process.exitCode = 1;
}
