import { realpath } from "node:fs/promises";
import path from "node:path";

// Containment is checked in both directions: a served directory must never be
// the private root or one of its ancestors/descendants.
export function rootsOverlap(a: string, b: string, paths = path): boolean {
  const left = paths.resolve(a),
    right = paths.resolve(b);
  const contains = (parent: string, child: string) => {
    const relative = paths.relative(parent, child);
    return (
      relative === "" ||
      (!paths.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${paths.sep}`))
    );
  };
  return contains(left, right) || contains(right, left);
}
async function actualPath(value: string): Promise<string> {
  const resolved = path.resolve(value);
  try {
    return await realpath(resolved);
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT")
      throw error;
    const parent = path.dirname(resolved);
    if (parent === resolved) throw error;
    return path.join(await actualPath(parent), path.basename(resolved));
  }
}
export async function assertSeparateRoots(privateRoot: string, servedRoot: string): Promise<void> {
  if (
    rootsOverlap(privateRoot, servedRoot) ||
    rootsOverlap(await actualPath(privateRoot), await actualPath(servedRoot))
  )
    throw new Error("PRIVATE_STATIC_ROOT_OVERLAP");
}
