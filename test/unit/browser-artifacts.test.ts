import { mkdir, mkdtemp, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import { assertScreenshotsRetained, screenshotInventory } from "../support/browser-artifacts.ts";

test("capture retention checks exact PNG bytes and fails on changed or missing successful captures", async () => {
  const base = resolve(".local/testing");
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "capture-retention-"));
  const path = join(directory, "synthetic.png");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8d8AAAAASUVORK5CYII=",
    "base64",
  );
  try {
    await writeFile(path, png);
    const before = await screenshotInventory(directory);
    expect(before.size).toBe(1);
    await expect(assertScreenshotsRetained(before, directory)).resolves.toBeUndefined();
    expect(await readFile(path)).toEqual(png);
    await writeFile(path, Buffer.concat([png, Buffer.from("synthetic-change")]));
    await expect(assertScreenshotsRetained(before, directory)).rejects.toThrow(
      "BROWSER_CAPTURE_RETENTION_FAILED",
    );
    await rm(path);
    await expect(assertScreenshotsRetained(before, directory)).rejects.toThrow(
      "BROWSER_CAPTURE_RETENTION_FAILED",
    );
  } finally {
    await rm(path, { force: true });
    await rmdir(directory);
  }
});
