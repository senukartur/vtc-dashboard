import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  aliasKey,
  type CatalogConfig,
  cursorCodec,
  gates,
  hash,
  mappingSummary,
  ordered,
  parseArtifact,
  semantic,
  validateCatalogConfig,
} from "../../apps/api/src/modules/catalogs/artifact.ts";
import { buildArtifact } from "../../apps/api/src/modules/catalogs/preparation.ts";
import { parseRegistries } from "../../scripts/catalogs/registry.mjs";
import { artifact, entity } from "../fixtures/catalogs/synthetic.ts";

const bytes = (v: unknown) => Buffer.from(JSON.stringify(v));
const config: CatalogConfig = {
  production: false,
  synthetic: true,
  cursorKey: "1".repeat(64),
  maxFileBytes: 1048576,
  artifactTtlMs: 86400000,
  policyRevision: 1,
  evidence: [],
};
test("closed artifact retains exact identities; aliases normalize separately with accents intact", () => {
  const a = artifact("ats", [
    entity("A"),
    entity("a"),
    entity("é"),
    entity("e\u0301"),
    entity("tail "),
  ]);
  expect(parseArtifact(bytes(a))).toEqual(a);
  expect(aliasKey("  E\u0301cole \t EAST ")).toBe("école east");
  expect(aliasKey("École")).not.toBe(aliasKey("Ecole"));
  expect(semantic({ a: ["b", "a"], c: true })).toBe(semantic({ c: true, a: ["a", "b"] }));
});
test("artifact rejects unknown/private fields, invalid UTF8, malformed JSON and lossy decimals before durable storage", () => {
  for (const a of [
    { ...artifact(), privatePath: "nonfunctional-placeholder" },
    { ...artifact(), approved: true },
    { ...artifact(), schemaVersion: 2 },
    {
      ...artifact(),
      entities: [
        { ...entity("cargo", { kind: "cargo" }), cargoUnitMassKg: "0.0000000000000000001" },
      ],
    },
    { ...artifact(), entities: [entity("cargo", { kind: "cargo", cargoUnitMassKg: "1.0" })] },
    { ...artifact(), entities: [entity("city", { cargoUnitMassKg: "2" })] },
    {
      ...artifact(),
      entities: [
        entity("alias", { aliases: [{ locale: "en", label: "漢".repeat(200), regionKey: null }] }),
      ],
    },
  ])
    expect(() => parseArtifact(bytes(a))).toThrow();
  expect(() => parseArtifact(Buffer.from([255]))).toThrow();
  expect(() => parseArtifact(Buffer.from("{"))).toThrow();
});
test("typed same-map relations and per-pack evidence reject incomplete or contradictory artifacts", () => {
  const region = entity("region", { kind: "region" }),
    city = entity("city", { regionKey: "region" });
  expect(parseArtifact(bytes(artifact("ats", [region, city]))).entities).toHaveLength(2);
  for (const entities of [
    [city],
    [region, { ...city, mapNamespace: "other" }],
    [region, { ...city, adrCategoryKey: "region" }],
    [region, city, city],
  ])
    expect(() => parseArtifact(bytes(artifact("ats", entities)))).toThrow();
  expect(() =>
    parseArtifact(bytes({ ...artifact(), packs: [{ ...artifact().packs[0], state: "missing" }] })),
  ).toThrow();
  expect(() =>
    parseArtifact(
      bytes({ ...artifact(), entities: [entity("x", { labels: { en: "@@token@@", ru: null } })] }),
    ),
  ).toThrow();
});
test("production source review requires operator exact-hash inventory/provenance, never artifact flags or synthetic mode", () => {
  const a = { ...artifact(), synthetic: false },
    prod = { ...config, synthetic: false, production: true };
  expect(gates(a, hash(bytes(a)), prod).sourceReviewComplete).toBe(false);
  expect(() => validateCatalogConfig({ ...config, production: true })).toThrow();
  expect(gates(artifact(), hash(bytes(artifact())), config).coverageComplete).toBe(true);
  const provenance = {
    referenceId: "10000000-0000-4000-8000-000000000001",
    publicSourceUrl: "https://example.invalid/catalog",
    attribution: "Fictional metadata",
    permittedUseBasis: "Fictional test basis",
    observedAt: "2026-10-20T00:00:00.000Z",
  };
  a.provenance = [provenance];
  const trusted = {
    ...prod,
    evidence: [
      {
        artifactSha256: hash(bytes(a)),
        game: a.game,
        gameBuild: a.gameBuild,
        releaseInventoryAsOf: a.releaseInventoryAsOf,
        expectedPacks: ["base"],
        provenance: a.provenance,
        englishLabelsReviewed: true as const,
      },
    ],
  };
  expect(gates(a, hash(bytes(a)), trusted).sourceReviewComplete).toBe(true);
  expect(gates(a, "b".repeat(64), trusted).sourceReviewComplete).toBe(false);
  a.packs.push({
    packId: "missing",
    title: "Fictional missing",
    state: "missing",
    contributionKinds: [],
    provenance: [],
    reasonCodes: ["source_missing"],
  });
  expect(gates(a, hash(bytes(a)), trusted).coverageComplete).toBe(false);
});
test("signed cursors bind exact candidate/review/filter/actor and reject tampering", () => {
  const codec = cursorCodec(config.cursorKey),
    binding = ["revision", 1, "ru", "city"],
    cursor = codec.write(binding, "after");
  expect(codec.read(binding, cursor)).toBe("after");
  expect(() => codec.read(["revision", 2, "ru", "city"], cursor)).toThrow();
  expect(() => codec.read(binding, `${cursor}a`)).toThrow();
  for (const [original, swapped] of [
    [
      ["revision", "en", "city", "cargo"],
      ["revision", "en", "cargo", "city"],
    ],
    [
      ["revision", "en", "city", "ru"],
      ["revision", "ru", "city", "en"],
    ],
  ]) {
    expect(() => codec.read(swapped, codec.write(original, "after"))).toThrow();
    expect(ordered(original)).not.toBe(ordered(swapped));
  }
  expect(ordered({ b: ["city", "cargo"], a: true })).toBe(
    ordered({ a: true, b: ["city", "cargo"] }),
  );
  expect(semantic([{ locale: "en", normalized: "ru" }])).not.toBe(
    semantic([{ locale: "ru", normalized: "en" }]),
  );
});
test("mapping diff summaries preserve exact pair scope within existing 256-scalar item bounds", () => {
  const pairs = [
    { provider: "漢".repeat(128), sourceId: "🚛".repeat(128) },
    { provider: "A", sourceId: "a" },
    { provider: "a", sourceId: "A" },
  ];
  const summary = mappingSummary(pairs);
  expect(summary).toEqual(mappingSummary([...pairs].reverse()));
  expect(summary.every((value) => [...value].length <= 256)).toBe(true);
});
test("offline normalization binds reviewed entities to exact active units without turning tokens into labels", () => {
  const a = artifact("ats", [entity("fictional")]);
  const parsed = {
    units: [
      {
        type: "city_data",
        id: "city.fictional",
        values: { city_name_localized: "@@fictional@@", country: "country.example" },
        origin: { packId: "base", file: "city.sui", sha256: "b".repeat(64) },
        overlays: [],
      },
    ],
    manifest: [],
    sourceManifestSha256: "c".repeat(64),
  };
  const { sourceManifestSha256: _, ...reviewed } = a;
  const review = {
    artifact: reviewed,
    ignoredUnits: [],
    bindings: [
      {
        kind: "city",
        mapNamespace: "base",
        key: "fictional",
        unitType: "city_data",
        unitId: "city.fictional",
        sourceFacts: parsed.units[0]?.values,
      },
    ],
  };
  const output = buildArtifact(parsed, review);
  expect(output.sourceManifestSha256).toBe(parsed.sourceManifestSha256);
  expect(output.entities[0]?.labels.en).toBe("Fictional fictional");
  expect(output.entities[0]?.aliases[0]?.label).toBe("Fictional fictional");
  expect(() => buildArtifact(parsed, { ...review, bindings: [] })).toThrow("UNBOUND_CATALOG_UNIT");
  expect(() =>
    buildArtifact(
      {
        ...parsed,
        units: [
          { ...(parsed.units[0] as (typeof parsed.units)[0]), values: { country: "changed" } },
        ],
      },
      review,
    ),
  ).toThrow("SOURCE_BINDING_MISMATCH");
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
