import path, { join } from "node:path";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { expect, test } from "vitest";
import {
  assertSeparateRoots,
  rootsOverlap,
} from "../../apps/api/src/platform/blob-storage/roots.ts";

test("private/static containment handles Windows and POSIX roots without sibling-prefix false positives", () => {
  for (const paths of [path.win32, path.posix]) {
    const root = paths === path.win32 ? "C:\\synthetic\\private" : "/synthetic/private";
    expect(rootsOverlap(root, root, paths)).toBe(true);
    expect(rootsOverlap(paths.join(root, "nested"), root, paths)).toBe(true);
    expect(rootsOverlap(root, paths.join(root, "nested"), paths)).toBe(true);
    expect(rootsOverlap(root, `${root}-public`, paths)).toBe(false);
  }
});
test("existing symlink aliases and missing descendants cannot bypass actual root separation", async () => {
  const root = await mkdtemp(join(tmpdir(), "vtc-root-separation-"));
  try {
    const privateRoot = join(root, "private"),
      alias = join(root, "alias");
    await mkdir(privateRoot);
    await symlink(privateRoot, alias, process.platform === "win32" ? "junction" : "dir");
    await expect(assertSeparateRoots(privateRoot, alias)).rejects.toThrow(
      "PRIVATE_STATIC_ROOT_OVERLAP",
    );
    await expect(assertSeparateRoots(privateRoot, join(alias, "missing"))).rejects.toThrow(
      "PRIVATE_STATIC_ROOT_OVERLAP",
    );
    await expect(
      assertSeparateRoots(privateRoot, `${privateRoot}-public`),
    ).resolves.toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
