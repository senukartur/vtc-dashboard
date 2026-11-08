import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { parseRegistries } from "../../scripts/catalogs/registry.mjs";

const execFileAsync = promisify(execFile);
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const options = { resolution: "unique_providers" as const };
async function fixture(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "vtc-source-"));
  for (const [file, source] of Object.entries(files)) {
    await mkdir(join(root, file, ".."), { recursive: true });
    await writeFile(join(root, file), source);
  }
  return root;
}
test("unique providers expand cross-pack attribute fragments, tuples and ordered compatibility without a mount guess", async () => {
  const base = await fixture({
    "def/city.sii": 'SiiNunit { @include "/def/city/fiction.sui" }',
    "def/city/fiction.sui":
      'city_data : city.fiction { city_name: "Fiction" country: fiction @include "attributes.sui" }',
  });
  const dlc = await fixture({
    "def/city/attributes.sui": "map_x_offsets[]: -1 map_y_offsets[]: 2 key_city: true",
    "def/country.sii":
      'country_data : country.data.fiction { name: "Fiction Region" pos: (1.25, -2, 3) region_areas[]: (1, 2, 3, 4) }',
    "def/cargo.sii":
      'cargo_data : cargo.fiction { name: "Fiction cargo" mass: 12.500 body_types[]: box body_types[]: tank }',
  });
  try {
    const parsed = await parseRegistries(
      [
        { root: base, packId: "base", registries: ["def/city.sii"] },
        { root: dlc, packId: "dlc", registries: ["def/country.sii", "def/cargo.sii"] },
      ],
      options,
    );
    expect(parsed.units.find((u) => u.type === "city_data")?.values).toMatchObject({
      city_name: "Fiction",
      "map_x_offsets[]": ["-1"],
      key_city: "true",
    });
    expect(
      parsed.units.find((u) => u.type === "city_data")?.dependencies?.map((o) => o.packId),
    ).toContain("dlc");
    expect(parsed.units.find((u) => u.type === "country_data")?.values.pos).toBe("(1.25,-2,3)");
    expect(parsed.units.find((u) => u.type === "cargo_data")?.values["body_types[]"]).toEqual([
      "box",
      "tank",
    ]);
  } finally {
    await rm(base, { recursive: true });
    await rm(dlc, { recursive: true });
  }
});
test("identical file providers preserve all provenance and order-independent facts; differing bytes have no implicit winner", async () => {
  const source = 'SiiNunit { cargo_data : cargo.fiction { name: "Fiction" mass: 1.00 } }';
  const a = await fixture({ "def/cargo.sii": source }),
    b = await fixture({ "def/cargo.sii": source });
  try {
    const layers = [
      { root: a, packId: "base", registries: ["def/cargo.sii"] },
      { root: b, packId: "dlc", registries: ["def/cargo.sii"] },
    ];
    const first = await parseRegistries(layers, options),
      reversed = await parseRegistries([...layers].reverse(), options);
    expect(first.units).toEqual(reversed.units);
    expect(first.units).toHaveLength(1);
    expect(first.units[0]?.coOrigins).toHaveLength(2);
    expect(first.sourceManifestSha256).not.toBe(reversed.sourceManifestSha256);
    await writeFile(join(b, "def/cargo.sii"), source.replace("1.00", "2.00"));
    await expect(parseRegistries(layers, options)).rejects.toThrow("conflicting_providers");
    await expect(parseRegistries([...layers].reverse(), options)).rejects.toThrow(
      "conflicting_providers",
    );
  } finally {
    await rm(a, { recursive: true });
    await rm(b, { recursive: true });
  }
});
test("anonymous support identities belong to expanded entrypoints and repeated includes within one context still fail", async () => {
  const root = await fixture({
    "a.sii": 'SiiNunit { @include "plate.sui" }',
    "b.sii": 'SiiNunit { @include "plate.sui" }',
    "plate.sui": 'license_plate_data : .plate { type: truck templates[]: "Fiction" }',
  });
  try {
    const layer = { root, packId: "base", registries: ["a.sii", "b.sii"] };
    const parsed = await parseRegistries([layer], options);
    expect(parsed.units).toHaveLength(2);
    expect(new Set(parsed.units.map((u) => u.scope)).size).toBe(2);
    await writeFile(join(root, "a.sii"), '@include "plate.sui" @include "plate.sui"');
    await expect(parseRegistries([layer], options)).rejects.toThrow("duplicate_include");
    await writeFile(join(root, "a.sii"), '@include "b.sii"');
    await writeFile(join(root, "b.sii"), '@include "a.sii"');
    await expect(parseRegistries([layer], options)).rejects.toThrow("include_cycle");
  } finally {
    await rm(root, { recursive: true });
  }
});
test("declared file providers bind exact bytes and validate the complete index before source access", async () => {
  const source = "cargo_data : cargo.fiction { mass: 1 }",
    sha256 = createHash("sha256").update(source).digest("hex"),
    root = await fixture({ "root.sii": source, "undeclared.sii": source }),
    layer = {
      root,
      packId: "base",
      registries: ["root.sii"],
      files: [{ file: "root.sii", sha256 }],
    };
  try {
    const parsed = await parseRegistries([layer], options);
    expect(parsed.units).toHaveLength(1);
    expect(parsed.manifest[0]?.sha256).toBe(sha256);
    await expect(
      parseRegistries([{ ...layer, registries: ["undeclared.sii"] }], options),
    ).rejects.toThrow("missing_include");
    await writeFile(join(root, "root.sii"), source.replace("mass: 1", "mass: 2"));
    await expect(parseRegistries([layer], options)).rejects.toThrow("source_changed");
    for (const { files, code } of [
      { files: [{ file: "../outside.sii", sha256 }], code: "path_escape" },
      { files: [{ file: "root.sii", sha256: "invalid" }], code: "invalid_layer" },
      { files: [{ file: "root.sii", sha256, unknown: true }], code: "invalid_layer" },
      { files: [...layer.files, ...layer.files], code: "invalid_layer" },
    ]) {
      await expect(
        parseRegistries(
          [{ ...layer, root: join(root, "missing"), files: files as never }],
          options,
        ),
      ).rejects.toThrow(code);
    }
  } finally {
    await rm(root, { recursive: true });
  }
});
test("unique source mode keeps closed fields, typed tuples, UTF8, limits and all-layer validation before reads", async () => {
  const root = await fixture({ "root.sii": "cargo_data : cargo.fiction { mass: 1 }" }),
    layer = { root, packId: "base", registries: ["root.sii"] };
  try {
    await expect(
      parseRegistries(
        [{ ...layer, root: join(root, "missing") }, { ...layer, sourceId: 12 } as never],
        options,
      ),
    ).rejects.toThrow("invalid_layer");
    for (const source of [
      "cargo_data : cargo.fiction { mass: 1 unknown: true }",
      "cargo_data : cargo.fiction { mass: 1 mass: 2 }",
      "country_data : country.data.fiction { pos: (1, 2) }",
      'dlc_package : package.fiction { secret_key: "fictional" }',
    ]) {
      await writeFile(join(root, "root.sii"), source);
      await expect(parseRegistries([layer], options)).rejects.toThrow();
    }
    await writeFile(join(root, "root.sii"), '@include "../../outside.sui"');
    await expect(parseRegistries([layer], options)).rejects.toThrow("path_escape");
    await writeFile(join(root, "root.sii"), Buffer.from([255]));
    await expect(parseRegistries([layer], options)).rejects.toThrow("invalid_utf8");
    await writeFile(join(root, "root.sii"), "cargo_data : cargo.fiction { mass: 1 }");
    await expect(parseRegistries([layer], { ...options, maxBytes: 1 })).rejects.toThrow(
      "byte_limit",
    );
    await symlink(join(root, "root.sii"), join(root, "linked.sii"));
    await expect(
      parseRegistries([{ ...layer, registries: ["linked.sii"] }], options),
    ).rejects.toThrow("symlink_path");
  } finally {
    await rm(root, { recursive: true });
  }
});

test("offline active registries preserve ordered overlay/include provenance and typed city arrays", async () => {
  const root = await mkdtemp(join(tmpdir(), "vtc-catalog-"));
  try {
    await mkdir(join(root, "base"));
    await mkdir(join(root, "dlc"));
    await writeFile(join(root, "base", "registry.sii"), 'SiiNunit { @include "city.sui" }');
    await writeFile(
      join(root, "base", "city.sui"),
      'city_data : city.fictional { city_name: "Fictional City" country: country.example key_city: true map_x_offsets[]: 1 map_y_offsets[]: -2 population: 42 vehicle_brands[]: "fictional" }',
    );
    await writeFile(
      join(root, "dlc", "registry.sii"),
      'city_data : city.fictional { city_name: "Reviewed Overlay" country: country.example }',
    );
    const layers = [
      { root: join(root, "base"), packId: "base", registries: ["registry.sii"] },
      { root: join(root, "dlc"), packId: "dlc", registries: ["registry.sii"], overlay: true },
    ];
    const parsed = await parseRegistries(layers);
    expect(parsed.units).toHaveLength(1);
    expect(parsed.units[0]?.overlays).toHaveLength(1);
    expect(parsed.manifest).toHaveLength(3);
    expect(parsed.units[0]?.values.city_name).toBe("Reviewed Overlay");
    const ordered = await parseRegistries(layers.map((layer) => ({ ...layer, overlay: true })));
    const reversed = await parseRegistries(
      [...layers].reverse().map((layer) => ({ ...layer, overlay: true })),
    );
    expect(ordered.sourceManifestSha256).not.toBe(reversed.sourceManifestSha256);
    expect(ordered.units[0]?.values.city_name).not.toBe(reversed.units[0]?.values.city_name);
    await expect(
      parseRegistries([
        { ...(layers[1] as (typeof layers)[0]), overlay: false },
        layers[0] as (typeof layers)[0],
      ]),
    ).rejects.toThrow("unapproved_overlay");
    await writeFile(join(root, "base", "city.sui"), '@include "registry.sii"');
    await expect(parseRegistries([layers[0] as (typeof layers)[0]])).rejects.toThrow(
      "include_cycle",
    );
    await writeFile(join(root, "base", "city.sui"), '@include "missing.sui"');
    await expect(parseRegistries([layers[0] as (typeof layers)[0]])).rejects.toThrow(
      "missing_include",
    );
    await writeFile(join(root, "base", "city.sui"), "city_data : .a { unreviewed_field: 1 }");
    await expect(parseRegistries([layers[0] as (typeof layers)[0]])).rejects.toThrow(
      "unsupported_or_duplicate_field",
    );
    await writeFile(
      join(root, "base", "city.sui"),
      'city_data : .a { name: "A" } city_data : .a { name: "B" }',
    );
    await expect(parseRegistries([layers[0] as (typeof layers)[0]])).rejects.toThrow(
      "duplicate_unit",
    );
    await expect(
      parseRegistries([
        { ...(layers[0] as (typeof layers)[0]), registries: ["../dlc/registry.sii"] },
      ]),
    ).rejects.toThrow("path_escape");
    await symlink(join(root, "dlc", "registry.sii"), join(root, "base", "escape.sui"));
    await expect(
      parseRegistries([{ ...(layers[0] as (typeof layers)[0]), registries: ["escape.sui"] }]),
    ).rejects.toThrow("symlink_path");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preparation validates every closed layer before source reads and accepts only explicit boolean overlays", async () => {
  const root = await mkdtemp(join(tmpdir(), "vtc-catalog-manifest-"));
  const script = fileURLToPath(new URL("../../scripts/catalogs/prepare.mjs", import.meta.url));
  const source = 'SiiNunit { city_data : city.fictional { city_name: "Fictional" } }';
  const layer = { root, packId: "base", registries: ["registry.sii"] };
  try {
    await writeFile(join(root, "registry.sii"), source);
    const malformed: unknown[] = [
      ...["false", "true", 0, 1, null, {}].map((overlay) => ({ ...layer, overlay })),
      { ...layer, unexpected: true },
      { ...layer, root: 1 },
      { ...layer, packId: 1 },
      { ...layer, registries: "registry.sii" },
      { ...layer, registries: [1] },
      { ...layer, registries: [] },
      null,
      [],
    ];
    for (const [index, invalid] of malformed.entries()) {
      const input = join(root, `invalid-${index}.json`),
        output = join(root, `invalid-output-${index}.json`);
      await writeFile(input, JSON.stringify({ layers: [layer, invalid] }));
      await expect(execFileAsync(process.execPath, [script, input, output])).rejects.toMatchObject({
        code: 1,
        stdout: "",
        stderr: `${JSON.stringify({ event: "catalog_preparation_failed" })}\n`,
      });
      await expect(readFile(output)).rejects.toMatchObject({ code: "ENOENT" });
      const unreadableFirst = { ...layer, root: join(root, "nonexistent-source") };
      await expect(
        parseRegistries([unreadableFirst, invalid] as Parameters<typeof parseRegistries>[0]),
      ).rejects.toThrow("invalid_layer");
    }
    const expected = hash(
      JSON.stringify({
        layers: [{ packId: "base", overlay: false, registries: ["registry.sii"] }],
        filesInExpansionOrder: [{ packId: "base", file: "registry.sii", sha256: hash(source) }],
      }),
    );
    for (const [index, valid] of [
      layer,
      { ...layer, overlay: false },
      { ...layer, overlay: true },
    ].entries()) {
      const input = join(root, `valid-${index}.json`),
        output = join(root, `valid-output-${index}.json`);
      await writeFile(input, JSON.stringify({ layers: [valid] }));
      const result = await execFileAsync(process.execPath, [script, input, output]);
      expect(JSON.parse(result.stdout)).toMatchObject({ files: 1, units: 1 });
      const parsed = JSON.parse(await readFile(output, "utf8"));
      if (index < 2) expect(parsed.sourceManifestSha256).toBe(expected);
      else expect(parsed.sourceManifestSha256).not.toBe(expected);
    }
    const input = join(root, "override.json"),
      output = join(root, "override-output.json");
    await writeFile(
      input,
      JSON.stringify({ layers: [layer, { ...layer, packId: "dlc", overlay: true }] }),
    );
    await execFileAsync(process.execPath, [script, input, output]);
    expect(JSON.parse(await readFile(output, "utf8")).units[0].overlays).toHaveLength(1);
  } finally {
    await rm(root, { recursive: true });
  }
});
