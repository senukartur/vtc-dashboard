import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { hash } from "../../apps/api/src/modules/catalogs/artifact.js";
import { buildArtifact, sourceManifest } from "../../apps/api/src/modules/catalogs/preparation.js";

export { buildArtifact } from "../../apps/api/src/modules/catalogs/preparation.js";

import { parseRegistries } from "./registry.mjs";

export async function build(sourceManifestPath: string, reviewPath: string, output: string) {
  const source = sourceManifest(JSON.parse(await readFile(sourceManifestPath, "utf8")));
  const parsed = await parseRegistries(
      source.layers.map(({ root, packId, registries, overlay, sourceId, files }) => ({
        root,
        packId,
        registries,
        overlay: overlay === true,
        ...(sourceId !== undefined ? { sourceId } : {}),
        ...(files !== undefined ? { files } : {}),
      })),
      source.resolution ? { resolution: source.resolution } : {},
    ),
    artifact = buildArtifact(parsed, JSON.parse(await readFile(reviewPath, "utf8"))),
    bytes = Buffer.from(JSON.stringify(artifact));
  await writeFile(output, bytes, { flag: "wx", mode: 0o600 });
  return {
    sha256: hash(bytes),
    byteLength: bytes.length,
    entities: artifact.entities.length,
    packs: artifact.packs.length,
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 5) throw new Error("INVALID_ARGUMENTS");
    console.log(
      JSON.stringify(
        await build(
          process.argv[2] as string,
          process.argv[3] as string,
          process.argv[4] as string,
        ),
      ),
    );
  } catch {
    console.error(JSON.stringify({ event: "catalog_build_failed" }));
    process.exitCode = 1;
  }
}
