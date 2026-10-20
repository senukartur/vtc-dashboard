import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseRegistries } from "./registry.mjs";

// This tool reads only separately extracted, explicitly ordered trees. Its output
// is private preparation evidence, never a publishable catalog or English-label guess.
export async function prepare(input, output) {
  const manifest = JSON.parse(await readFile(input, "utf8"));
  if (Object.keys(manifest).some((k) => !["layers", "resolution"].includes(k)))
    throw new Error("INVALID_PREPARATION_MANIFEST");
  const result = await parseRegistries(
    manifest.layers,
    manifest.resolution === undefined ? {} : { resolution: manifest.resolution },
  );
  await writeFile(output, JSON.stringify(result, null, 2), { flag: "wx", mode: 0o600 });
  return {
    files: result.manifest.length,
    units: result.units.length,
    sourceManifestSha256: result.sourceManifestSha256,
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4) throw new Error("INVALID_ARGUMENTS");
    console.log(JSON.stringify(await prepare(process.argv[2], process.argv[3])));
  } catch {
    console.error(JSON.stringify({ event: "catalog_preparation_failed" }));
    process.exitCode = 1;
  }
}
