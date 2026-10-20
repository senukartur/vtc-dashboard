import type {
  Artifact,
  EntityInput,
  Game,
} from "../../../apps/api/src/modules/catalogs/artifact.ts";
export function entity(key: string, overrides: Partial<EntityInput> = {}): EntityInput {
  return {
    key,
    kind: "city",
    mapNamespace: "base",
    packId: "base",
    retired: false,
    labels: { en: `Fictional ${key.trim()}`, ru: null },
    aliases: [{ locale: "en", label: `Fictional ${key.trim()}`, regionKey: null }],
    mappings: [{ provider: "synthetic", sourceId: key }],
    regionKey: null,
    cargoUnitMassKg: null,
    adrCategoryKey: null,
    trailerBodyTypeKey: null,
    trailerChainTypeKey: null,
    ...overrides,
  };
}
export function artifact(
  game: Game = "ats",
  entities: EntityInput[] = [entity("city_one"), entity("city_two")],
): Artifact {
  return {
    schemaVersion: 1,
    importerVersion: "vtc-catalogs/1",
    synthetic: true,
    game,
    gameBuild: "synthetic-build",
    releaseInventoryAsOf: "2026-10-20",
    sourceManifestSha256: "a".repeat(64),
    packs: [
      {
        packId: "base",
        title: "Fictional base pack",
        state: "validated",
        contributionKinds: [...new Set(entities.map((e) => e.kind))],
        provenance: [],
        reasonCodes: [],
      },
    ],
    provenance: [],
    entities,
    mappingIssues: [],
  };
}
