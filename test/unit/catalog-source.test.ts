import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { buildArtifact } from "../../apps/api/src/modules/catalogs/preparation.ts";
import { parseRegistries } from "../../scripts/catalogs/registry.mjs";
import { artifact, entity } from "../fixtures/catalogs/synthetic.ts";

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

test("normalization validates actual kg unit mass, exact derived tokens and reviewed country references", async () => {
  const root = await fixture({
    "def/root.sii":
      '@include "country/fiction.sui" @include "city.sui" @include "cargo.sui" @include "trailer.sui"',
    "def/country/fiction.sui": 'country_data : country.data.fiction { name: "Fiction Region" }',
    "def/city.sui": 'city_data : city.fiction { city_name: "Fiction City" country: fiction }',
    "def/cargo.sui":
      "cargo_data : cargo.fiction { mass: 12.500 adr_class: 3 body_types[]: box body_types[]: tank }",
    "def/trailer.sui": "trailer_def : trailer.fiction { body_type: box chain_type: chain }",
  });
  try {
    const parsed = await parseRegistries(
      [{ root, packId: "base", registries: ["def/root.sii"] }],
      options,
    );
    const entities = [
      entity("country.data.fiction", { kind: "region" }),
      entity("city.fiction", { regionKey: "country.data.fiction" }),
      entity("cargo.fiction", { kind: "cargo", cargoUnitMassKg: "12.5", adrCategoryKey: "3" }),
      entity("trailer.fiction", {
        kind: "trailer_type",
        trailerBodyTypeKey: "box",
        trailerChainTypeKey: "chain",
      }),
      entity("3", { kind: "adr_category" }),
      entity("box", { kind: "trailer_body_type" }),
      entity("chain", { kind: "trailer_chain_type" }),
    ];
    const { sourceManifestSha256: _, ...a } = artifact("ats", entities);
    const find = (id: string) => {
      const unit = parsed.units.find((u) => u.id === id);
      if (!unit) throw new Error("MISSING_FICTIONAL_UNIT");
      return unit;
    };
    const binding = (
      kind: string,
      key: string,
      id: string,
      classification?: { field: string; token: string },
    ) => ({
      kind,
      mapNamespace: "base",
      key,
      unitType: find(id).type,
      unitId: id,
      sourceFacts: find(id).values,
      ...(classification ? { classification } : {}),
    });
    const review = {
      artifact: a,
      ignoredUnits: [],
      bindings: [
        binding("region", "country.data.fiction", "country.data.fiction"),
        binding("city", "city.fiction", "city.fiction"),
        binding("cargo", "cargo.fiction", "cargo.fiction"),
        binding("trailer_type", "trailer.fiction", "trailer.fiction"),
        binding("adr_category", "3", "cargo.fiction", { field: "adr_class", token: "3" }),
        binding("trailer_body_type", "box", "cargo.fiction", {
          field: "body_types[]",
          token: "box",
        }),
        binding("trailer_chain_type", "chain", "trailer.fiction", {
          field: "chain_type",
          token: "chain",
        }),
      ],
      sourceReferences: [
        {
          mapNamespace: "base",
          sourceUnitId: "city.fiction",
          sourceToken: "fiction",
          targetUnitId: "country.data.fiction",
        },
      ],
    };
    const output = buildArtifact(parsed, review);
    expect(output.entities.find((e) => e.kind === "cargo")?.cargoUnitMassKg).toBe("12.5");
    expect(output.sourceManifestSha256).not.toBe(parsed.sourceManifestSha256);
    expect(() => buildArtifact(parsed, { ...review, sourceReferences: [] })).toThrow(
      "MISSING_SOURCE_REFERENCE",
    );
    expect(() =>
      buildArtifact(parsed, {
        ...review,
        sourceReferences: [{ ...review.sourceReferences[0], sourceToken: "other" }],
      }),
    ).toThrow("INVALID_SOURCE_REFERENCE");
    expect(() =>
      buildArtifact(parsed, {
        ...review,
        bindings: review.bindings.map((b) =>
          b.kind === "trailer_body_type"
            ? { ...b, classification: { field: "body_types[]", token: "invented" } }
            : b,
        ),
      }),
    ).toThrow("INVALID_CLASSIFICATION_BINDING");
    expect(() =>
      buildArtifact(parsed, {
        ...review,
        artifact: {
          ...a,
          entities: a.entities.map((e) =>
            e.kind === "cargo" ? { ...e, cargoUnitMassKg: "13" } : e,
          ),
        },
      }),
    ).toThrow("UNIT_MASS_MISMATCH");
    const conflict = {
      ...parsed,
      units: parsed.units.map((u) =>
        u.type === "cargo_data" ? { ...u, values: { ...u.values, unit_mass: "13" } } : u,
      ),
    };
    const conflictingCargo = conflict.units.find((u) => u.type === "cargo_data");
    if (!conflictingCargo) throw new Error("MISSING_FICTIONAL_UNIT");
    expect(() =>
      buildArtifact(conflict, {
        ...review,
        bindings: review.bindings.map((b) =>
          b.unitType === "cargo_data" ? { ...b, sourceFacts: conflictingCargo.values } : b,
        ),
      }),
    ).toThrow("MASS_FIELD_CONFLICT");
    const variantCity = {
        ...find("city.fiction"),
        values: { ...find("city.fiction").values, country: "FICTION" },
      },
      variantSource = {
        ...parsed,
        units: parsed.units.map((u) => (u.id === variantCity.id ? variantCity : u)),
      },
      variantReview = {
        ...review,
        bindings: review.bindings.map((b) =>
          b.unitId === variantCity.id ? { ...b, sourceFacts: variantCity.values } : b,
        ),
        sourceReferences: [
          { ...review.sourceReferences[0], sourceToken: "FICTION", targetSourceToken: "fiction" },
        ],
      };
    const variant = buildArtifact(variantSource, variantReview);
    expect(variant.entities.find((e) => e.kind === "city")?.regionKey).toBe("country.data.fiction");
    expect(variant.sourceManifestSha256).not.toBe(output.sourceManifestSha256);
    for (const reference of [
      { ...review.sourceReferences[0], sourceToken: "FICTION" },
      { ...variantReview.sourceReferences[0], targetSourceToken: "other" },
    ])
      expect(() =>
        buildArtifact(variantSource, { ...variantReview, sourceReferences: [reference] }),
      ).toThrow("INVALID_SOURCE_REFERENCE");
    const missingFacts = {
      ...parsed,
      units: parsed.units.map((u) => {
        const values = { ...u.values };
        if (u.type === "cargo_data") delete values.adr_class;
        if (u.type === "trailer_def") delete values.chain_type;
        return { ...u, values };
      }),
    };
    const missingReview = {
      ...review,
      artifact: {
        ...a,
        packs: a.packs.map((p) => ({
          ...p,
          contributionKinds: p.contributionKinds.filter(
            (kind) => !["adr_category", "trailer_chain_type"].includes(kind),
          ),
        })),
        entities: a.entities
          .filter((e) => !["adr_category", "trailer_chain_type"].includes(e.kind))
          .map((e) =>
            e.kind === "cargo"
              ? { ...e, adrCategoryKey: null }
              : e.kind === "trailer_type"
                ? { ...e, trailerChainTypeKey: null }
                : e,
          ),
      },
      bindings: review.bindings
        .filter((b) => !["adr_category", "trailer_chain_type"].includes(b.kind))
        .map((b) => ({
          ...b,
          sourceFacts: missingFacts.units.find((u) => u.id === b.unitId)?.values,
        })),
    };
    const unknown = buildArtifact(missingFacts, missingReview);
    expect(unknown.entities.find((e) => e.kind === "cargo")?.adrCategoryKey).toBeNull();
    expect(unknown.entities.find((e) => e.kind === "trailer_type")?.trailerChainTypeKey).toBeNull();
    const missingMass = {
      ...parsed,
      units: parsed.units.map((u) => {
        const values = { ...u.values };
        if (u.type === "cargo_data") delete values.mass;
        return { ...u, values };
      }),
    };
    expect(() =>
      buildArtifact(missingMass, {
        ...review,
        bindings: review.bindings.map((b) => ({
          ...b,
          sourceFacts: missingMass.units.find((u) => u.id === b.unitId)?.values,
        })),
      }),
    ).toThrow("MISSING_UNIT_MASS");
  } finally {
    await rm(root, { recursive: true });
  }
});
