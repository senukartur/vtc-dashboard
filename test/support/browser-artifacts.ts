import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const ordinaryOutput = resolve(".local/testing/browser-results");

export async function screenshotInventory(
  directory = ordinaryOutput,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  async function visit(path: string, prefix: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error("BROWSER_CAPTURE_SYMLINK_REJECTED");
      const relative = join(prefix, entry.name);
      if (entry.isDirectory()) await visit(join(path, entry.name), relative);
      else if (entry.isFile() && entry.name.endsWith(".png"))
        result.set(
          relative,
          createHash("sha256")
            .update(await readFile(join(path, entry.name)))
            .digest("hex"),
        );
    }
  }
  try {
    await visit(directory, "");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return result;
}

export async function assertScreenshotsRetained(
  before: ReadonlyMap<string, string>,
  directory = ordinaryOutput,
): Promise<void> {
  const after = await screenshotInventory(directory);
  if ([...before].some(([path, hash]) => after.get(path) !== hash))
    throw new Error("BROWSER_CAPTURE_RETENTION_FAILED");
}
