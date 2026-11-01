import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { brotliDecompressSync } from "node:zlib";
import { describe, expect, test } from "vitest";

// Rendered symbols the source font contains; they must stay in the core subset.
const renderedSymbols = "←↑→↓—№∅◇●×•«»·–";
// Rendered characters that intentionally use the system fallback: the source ellipsis is a
// full-width form with centred dots, and the other glyphs are absent from the source font.
const fallback = new Set([0x2026, 0x2197, 0x2713, 0x2715, 0x25a4, 0x25f7, 0x1f512]);

type Face = {
  file: string;
  weight: string;
  declared: string;
  part: string;
  range: Set<number>;
  text: string;
};

function parseRange(value: string) {
  const codes = new Set<number>();
  for (const part of value.split(",")) {
    const match = /^U\+([0-9A-F]+)(?:-([0-9A-F]+))?$/i.exec(part.trim());
    if (!match) throw new Error(`INVALID_RANGE ${part}`);
    const start = Number.parseInt(match[1] ?? "", 16);
    const end = Number.parseInt(match[2] ?? match[1] ?? "", 16);
    for (let code = start; code <= end; code += 1) codes.add(code);
  }
  return codes;
}

function base128(bytes: Buffer, cursor: { at: number }) {
  let value = 0;
  for (let index = 0; index < 5; index += 1) {
    const byte = bytes.readUInt8(cursor.at++);
    value = value * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) return value;
  }
  throw new Error("INVALID_UINTBASE128");
}

// Minimal WOFF2 reader: cmap is never transformed, so it is a plain slice of the brotli stream.
function woff2Cmap(bytes: Buffer) {
  if (bytes.toString("latin1", 0, 4) !== "wOF2") throw new Error("NOT_WOFF2");
  const tables = bytes.readUInt16BE(12);
  const compressed = bytes.readUInt32BE(20);
  const cursor = { at: 48 };
  let offset = 0;
  let cmap: { offset: number; length: number } | undefined;
  for (let index = 0; index < tables; index += 1) {
    const flags = bytes.readUInt8(cursor.at++);
    const known = flags & 0x3f;
    // Index 0x3f is followed by an arbitrary four-byte tag; cmap always uses known index 0.
    if (known === 0x3f) cursor.at += 4;
    const original = base128(bytes, cursor);
    const version = flags >> 6;
    const glyphTable = known === 10 || known === 11;
    const transformed = glyphTable ? version === 0 : version !== 0;
    const length = transformed ? base128(bytes, cursor) : original;
    if (known === 0) cmap = { offset, length };
    offset += length;
  }
  if (!cmap) throw new Error("MISSING_CMAP");
  const data = brotliDecompressSync(bytes.subarray(cursor.at, cursor.at + compressed));
  const table = data.subarray(cmap.offset, cmap.offset + cmap.length);
  const codes = new Set<number>();
  for (let record = 0; record < table.readUInt16BE(2); record += 1) {
    const platform = table.readUInt16BE(4 + record * 8);
    const sub = table.subarray(table.readUInt32BE(8 + record * 8));
    if (platform !== 3 && platform !== 0) continue;
    if (sub.readUInt16BE(0) === 4) {
      const segments = sub.readUInt16BE(6) / 2;
      const ends = 14,
        starts = ends + segments * 2 + 2,
        deltas = starts + segments * 2,
        ranges = deltas + segments * 2;
      for (let segment = 0; segment < segments; segment += 1) {
        const start = sub.readUInt16BE(starts + segment * 2);
        const end = sub.readUInt16BE(ends + segment * 2);
        const delta = sub.readInt16BE(deltas + segment * 2);
        const rangeOffset = sub.readUInt16BE(ranges + segment * 2);
        for (let code = start; code <= end && code !== 0xffff; code += 1) {
          let glyph = code;
          if (rangeOffset) {
            glyph = sub.readUInt16BE(ranges + segment * 2 + rangeOffset + (code - start) * 2);
            if (!glyph) continue;
          }
          if ((glyph + delta) & 0xffff) codes.add(code);
        }
      }
    } else if (sub.readUInt16BE(0) === 12) {
      for (let group = 0; group < sub.readUInt32BE(12); group += 1) {
        const at = 16 + group * 12;
        for (let code = sub.readUInt32BE(at); code <= sub.readUInt32BE(at + 4); code += 1)
          codes.add(code);
      }
    }
  }
  return codes;
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return [".ts", ".tsx", ".css"].includes(extname(entry.name)) ? [path] : [];
    }),
  );
  return files.flat();
}

const css = await readFile(resolve("apps/web/src/shared/styles.css"), "utf8");
const readme = await readFile(resolve("third_party/huninn/README.md"), "utf8");
const faces: Face[] = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, body = ""]) => {
  const file = /url\("\.\.\/assets\/([^"]+)"\)/.exec(body)?.[1] ?? "";
  const range = /unicode-range:\s*([^;]+);/.exec(body)?.[1] ?? "";
  const declared = /font-weight:\s*(\d+);/.exec(body)?.[1] ?? "";
  const [, weight = "", part = ""] = /-(\d{3})-(core|ext)\.woff2$/.exec(file) ?? [];
  return {
    file,
    weight,
    declared,
    part,
    range: parseRange(range),
    text: range.replace(/\s+/g, ""),
  };
});
const cmaps = new Map(
  await Promise.all(
    faces.map(
      async (face) =>
        [face.file, woff2Cmap(await readFile(resolve("apps/web/src/assets", face.file)))] as const,
    ),
  ),
);

describe("Huninn subsets", () => {
  test("two weight-400 faces declare the documented disjoint core and ext ranges", () => {
    expect(faces.map((face) => face.file)).toEqual([
      "huninn-400-core.woff2",
      "huninn-400-ext.woff2",
    ]);
    expect(faces.map((face) => face.declared)).toEqual(["400", "400"]);
    for (const part of ["core", "ext"]) {
      const documented = new RegExp(`^${part.toUpperCase()}='([^']+)'$`, "m").exec(readme)?.[1];
      for (const face of faces.filter((item) => item.part === part))
        expect(face.text).toBe(documented);
    }
    const [core, ext] = [faces[0]?.range ?? new Set(), faces[1]?.range ?? new Set()];
    expect([...core].filter((code) => ext.has(code))).toEqual([]);
  });

  test("documented output sizes and SHA-256 match the committed subsets", async () => {
    const rows = [...readme.matchAll(/^\| `(huninn-[^`]+)` \| (\d+) \| `([0-9a-f]{64})` \|$/gm)];
    expect(rows.map(([, file]) => file)).toEqual(faces.map((face) => face.file));
    for (const [, file = "", size, hash] of rows) {
      const bytes = await readFile(resolve("apps/web/src/assets", file));
      expect([String(bytes.length), createHash("sha256").update(bytes).digest("hex")]).toEqual([
        size,
        hash,
      ]);
    }
  });

  test("each subset maps only codepoints of its declared range; core keeps rendered symbols", () => {
    const symbols = [...renderedSymbols].map((symbol) => symbol.codePointAt(0) ?? 0);
    for (const face of faces) {
      const cmap = cmaps.get(face.file) ?? new Set();
      // Measured: core maps 311 codepoints and ext 339.
      expect(cmap.size).toBeGreaterThan(face.part === "core" ? 300 : 330);
      expect([...cmap].filter((code) => !face.range.has(code))).toEqual([]);
      for (const code of fallback) expect(cmap.has(code)).toBe(false);
      if (face.part !== "core") continue;
      for (const code of symbols) {
        const label = `${face.file} U+${code.toString(16).toUpperCase()}`;
        expect(face.range.has(code), label).toBe(true);
        expect(cmap.has(code), label).toBe(true);
      }
      expect(face.range.has(0x2026)).toBe(false);
    }
  });

  test("every non-ASCII character in the web sources is in the subsets or a documented fallback", async () => {
    const used = new Set<number>();
    for (const file of await sourceFiles(resolve("apps/web/src")))
      for (const character of await readFile(file, "utf8")) {
        const code = character.codePointAt(0) ?? 0;
        if (code > 0x7e) used.add(code);
      }
    expect(used.has(0x2192) && used.has(0x2190)).toBe(true);
    for (const weight of ["400"]) {
      const mapped = new Set(
        faces
          .filter((face) => face.weight === weight)
          .flatMap((face) => [...(cmaps.get(face.file) ?? [])]),
      );
      const uncovered = [...used]
        .filter((code) => !mapped.has(code) && !fallback.has(code))
        .map((code) => `U+${code.toString(16).toUpperCase()}`);
      expect(uncovered, weight).toEqual([]);
    }
  });

  test("the core subset maps every Russian letter", () => {
    const core = cmaps.get("huninn-400-core.woff2") ?? new Set();
    const russian = [0x401, 0x451];
    for (let code = 0x410; code <= 0x44f; code += 1) russian.push(code);
    expect(russian.filter((code) => !core.has(code))).toEqual([]);
  });

  test("bold is synthesized and only the Huninn subsets are bundled", async () => {
    expect(css).not.toMatch(/font-synthesis-weight:\s*none/);
    const assets = (await readdir(resolve("apps/web/src/assets"))).filter(
      (file) => extname(file) === ".woff2",
    );
    expect(assets.sort()).toEqual(["huninn-400-core.woff2", "huninn-400-ext.woff2"]);
  });
});
