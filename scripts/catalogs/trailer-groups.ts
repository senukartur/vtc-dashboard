import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

/** Only explicit, unambiguous legacy links are evidence of a common trailer. */
export function commonTrailerGroups(sources: readonly string[]) {
  const candidates = new Map<string, Set<string>>();
  const fragmented = new Set<string>();
  for (const source of sources) {
    const text = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?:#|\/\/)[^\r\n]*/g, "");
    for (const match of text.matchAll(/\btrailer_def\s*:\s*[^\s{]+\s*\{([^{}]*)\}/g)) {
      const body = match[1] ?? "";
      // Attribute fragments need a real include/mount resolver. Never infer a group for them.
      const token = (field: string) =>
        new RegExp(`\\b${field}\\s*:\\s*(?:"([^"]+)"|([a-zA-Z0-9_.-]+))`).exec(body);
      const b = token("body_type"),
        t = token("trailer");
      const code = b?.[1] ?? b?.[2]?.toLowerCase();
      const trailer = t?.[1] ?? t?.[2]?.toLowerCase();
      if (body.includes("@include")) {
        if (code) fragmented.add(code);
        continue;
      }
      if (!code || !trailer || trailer === "null") continue;
      const values = candidates.get(code) ?? new Set<string>();
      values.add(trailer);
      candidates.set(code, values);
    }
  }
  return {
    groups: new Map(
      [...candidates].flatMap(([body, values]) =>
        values.size === 1 && !fragmented.has(body)
          ? [[body, [...values][0] as string] as const]
          : [],
      ),
    ),
    ambiguous: [
      ...new Set([
        ...[...candidates].filter(([, values]) => values.size !== 1).map(([body]) => body),
        ...fragmented,
      ]),
    ],
  };
}

async function definitions(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const parts: string[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new Error("SYMLINK_DEFINITION");
    const file = resolve(root, entry.name);
    if (entry.isDirectory()) parts.push(...(await definitions(file)));
    else if (/\.(sii|sui)$/.test(entry.name)) {
      const source = await readFile(file, "utf8");
      if (/\btrailer_def\s*:/.test(source)) parts.push(source);
    }
  }
  return parts;
}

// The generated file contains game-derived identifiers and may only live in ignored storage.
async function main() {
  const { values } = parseArgs({
    options: {
      game: { type: "string" },
      definitions: { type: "string", multiple: true },
      out: { type: "string" },
    },
  });
  if (!["ets2", "ats"].includes(values.game ?? "") || !values.definitions?.length || !values.out)
    throw new Error(
      "USAGE: --game ets2|ats --definitions <extracted-def-root> --out .local/catalogs/<file>.csv",
    );
  const repo = fileURLToPath(new URL("../../", import.meta.url));
  const target = resolve(values.out),
    rel = relative(resolve(repo, ".local/catalogs"), target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("PRIVATE_OUTPUT_REQUIRED");
  execFileSync("git", ["check-ignore", "--quiet", "--", target], { cwd: repo });
  const source = (
    await Promise.all(values.definitions.map((root) => definitions(resolve(root))))
  ).flat();
  const result = commonTrailerGroups(source);
  const cell = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const lines = [
    "game,code,common_trailer",
    ...[...result.groups]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([code, trailer]) => [values.game as string, code, trailer].map(cell).join(",")),
  ];
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${lines.join("\r\n")}\r\n`, { flag: "wx" });
  console.log(JSON.stringify({ mapped: result.groups.size, ambiguous: result.ambiguous.length }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error("Trailer grouping preparation failed; verify arguments and private output.");
    process.exitCode = 1;
  });
}
