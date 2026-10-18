import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { maxImageBytes, repository, validateManifest } from "./policy.mjs";

try {
  const selected = JSON.parse(await readFile(".local/deploy/selected.json", "utf8"));
  const response = await fetch(
    `https://api.github.com/repos/${repository}/actions/artifacts/${selected.artifactId}/zip`,
    {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
      },
      signal: AbortSignal.timeout(120000),
    },
  );
  if (!response.ok) throw new Error("ARTIFACT_DOWNLOAD_FAILED");
  // Bound streaming independently of the provider's reported archive size.
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > maxImageBytes + 1048576) throw new Error("ARCHIVE_TOO_LARGE");
    chunks.push(chunk);
  }
  await writeFile(".local/deploy/release.zip", Buffer.concat(chunks));
  const extraction = spawnSync("python3", ["deploy/development/unpack.py"], { stdio: "ignore" });
  if (extraction.status !== 0) throw new Error("ARTIFACT_LAYOUT_INVALID");
  const manifest = validateManifest(
    JSON.parse(await readFile(".local/deploy/release.json", "utf8")),
    selected,
  );
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(".local/deploy/image.tar")) {
    bytes += chunk.length;
    hash.update(chunk);
  }
  if (bytes !== manifest.bytes || hash.digest("hex") !== manifest.sha256)
    throw new Error("IMAGE_CHECKSUM_INVALID");
  console.log("Artifact identity and checksum: success");
} catch {
  console.error("Artifact validation: rejected");
  process.exitCode = 1;
}
