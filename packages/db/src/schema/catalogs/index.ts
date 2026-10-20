import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  foreignKey,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { decimalColumn, idColumn, opaqueColumn, utcColumn } from "../../core/values.js";

export { and, asc, desc, eq, gt, inArray, lt, lte, or, sql } from "drizzle-orm";

const game = (name: string) => mysqlEnum(name, ["ets2", "ats"]);
const kind = (name: string) =>
  mysqlEnum(name, [
    "city",
    "region",
    "cargo",
    "trailer_type",
    "trailer_body_type",
    "trailer_chain_type",
    "adr_category",
  ]);
const bytes = (name: string) => opaqueColumn(name, { length: 512 });
const medium = customType<{ data: string; driverData: string }>({ dataType: () => "mediumtext" });
export const catalogArtifacts = mysqlTable(
  "catalog_artifacts",
  {
    id: idColumn("id").primaryKey(),
    creatorId: idColumn("creator_id").notNull(),
    sha256: opaqueColumn("sha256", { length: 32 }).notNull(),
    byteLength: int("byte_length", { unsigned: true }).notNull(),
    content: medium("content"),
    expiresAt: utcColumn("expires_at").notNull(),
    payloadExpiresAt: utcColumn("payload_expires_at"),
    createdAt: utcColumn("created_at").notNull(),
  },
  (t) => [index("catalog_artifact_expiry").on(t.payloadExpiresAt, t.id)],
);
export const catalogOperations = mysqlTable(
  "catalog_operations",
  {
    id: idColumn("id").primaryKey(),
    creatorId: idColumn("creator_id").notNull(),
    artifactId: idColumn("artifact_id")
      .notNull()
      .references(() => catalogArtifacts.id, { onDelete: "restrict" }),
    state: mysqlEnum("state", ["processing", "completed", "failed"]).notNull(),
    game: game("game").notNull(),
    resultId: idColumn("result_id"),
    failureCode: varchar("failure_code", { length: 128 }),
    stagingRevisionId: idColumn("staging_revision_id"),
    phase: mysqlEnum("phase", ["identities", "facts", "links", "issues", "finalize"]).notNull(),
    offset: int("offset", { unsigned: true }).notNull(),
    createdAt: utcColumn("created_at").notNull(),
  },
  (t) => [
    index("catalog_operation_artifact").on(t.artifactId),
    index("catalog_operation_state").on(t.state, t.id),
  ],
);
export const catalogCommands = mysqlTable(
  "catalog_commands",
  {
    scope: opaqueColumn("scope", { length: 32 }).notNull(),
    key: idColumn("key").notNull(),
    fingerprint: opaqueColumn("fingerprint", { length: 32 }).notNull(),
    result: json("result").$type<unknown>().notNull(),
    expiresAt: utcColumn("expires_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.scope, t.key] }),
    index("catalog_command_expiry").on(t.expiresAt),
  ],
);
export const catalogRevisions = mysqlTable(
  "catalog_revisions",
  {
    id: idColumn("id").primaryKey(),
    game: game("game").notNull(),
    version: int("version", { unsigned: true }).notNull(),
    state: mysqlEnum("state", ["draft", "validated", "published", "rejected"]).notNull(),
    complete: boolean("complete").notNull().default(false),
    pruned: boolean("pruned").notNull().default(false),
    artifactId: idColumn("artifact_id")
      .notNull()
      .references(() => catalogArtifacts.id, { onDelete: "restrict" }),
    artifactSha256: opaqueColumn("artifact_sha256", { length: 32 }).notNull(),
    comparisonRevisionId: idColumn("comparison_revision_id"),
    gameBuild: varchar("game_build", { length: 128 }).notNull(),
    inventoryAsOf: varchar("inventory_as_of", { length: 10 }).notNull(),
    synthetic: boolean("synthetic").notNull(),
    sourceManifestSha256: opaqueColumn("source_manifest_sha256", { length: 32 }).notNull(),
    provenance: json("provenance").$type<unknown[]>().notNull(),
    createdAt: utcColumn("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("catalog_revision_game").on(t.id, t.game),
    index("catalog_revision_page").on(t.game, t.state, t.createdAt, t.id),
    index("catalog_incomplete_cleanup").on(t.complete, t.state, t.pruned, t.id),
  ],
);
export const catalogPublications = mysqlTable(
  "catalog_publications",
  {
    game: game("game").primaryKey(),
    version: int("version", { unsigned: true }).notNull(),
    revisionId: idColumn("revision_id"),
  },
  (t) => [
    foreignKey({
      name: "catalog_publication_game_fk",
      columns: [t.revisionId, t.game],
      foreignColumns: [catalogRevisions.id, catalogRevisions.game],
    }).onDelete("restrict"),
  ],
);
export const catalogEntities = mysqlTable(
  "catalog_entities",
  {
    id: idColumn("id").primaryKey(),
    game: game("game").notNull(),
    kind: kind("kind").notNull(),
    map: bytes("map").notNull(),
    sourceKey: bytes("source_key").notNull(),
  },
  (t) => [
    uniqueIndex("catalog_canonical_identity").on(t.game, t.kind, t.map, t.sourceKey),
    uniqueIndex("catalog_entity_scope").on(t.id, t.game, t.kind, t.map),
  ],
);
export const catalogFacts = mysqlTable(
  "catalog_facts",
  {
    id: idColumn("id").primaryKey(),
    revisionId: idColumn("revision_id").notNull(),
    entityId: idColumn("entity_id").notNull(),
    game: game("game").notNull(),
    kind: kind("kind").notNull(),
    map: bytes("map").notNull(),
    retired: boolean("retired").notNull(),
    labelEn: varchar("label_en", { length: 256 }),
    labelRu: varchar("label_ru", { length: 256 }),
    regionId: idColumn("region_id"),
    cargoUnitMassKg: decimalColumn("cargo_unit_mass_kg"),
    adrCategoryId: idColumn("adr_category_id"),
    trailerBodyTypeId: idColumn("trailer_body_type_id"),
    trailerChainTypeId: idColumn("trailer_chain_type_id"),
    packId: bytes("pack_id").notNull(),
  },
  (t) => [
    uniqueIndex("catalog_revision_entity").on(t.revisionId, t.entityId),
    uniqueIndex("catalog_fact_scope").on(t.revisionId, t.entityId, t.kind, t.map),
    foreignKey({
      name: "catalog_fact_revision_game_fk",
      columns: [t.revisionId, t.game],
      foreignColumns: [catalogRevisions.id, catalogRevisions.game],
    }).onDelete("restrict"),
    foreignKey({
      name: "catalog_fact_entity_scope_fk",
      columns: [t.entityId, t.game, t.kind, t.map],
      foreignColumns: [
        catalogEntities.id,
        catalogEntities.game,
        catalogEntities.kind,
        catalogEntities.map,
      ],
    }).onDelete("restrict"),
    index("catalog_selection_page").on(t.revisionId, t.kind, t.retired, t.entityId),
    index("catalog_english_search").on(t.revisionId, t.kind, t.labelEn, t.entityId),
    check(
      "catalog_typed_values",
      sql`(${t.regionId} IS NULL OR ${t.kind} = 'city') AND (${t.cargoUnitMassKg} IS NULL OR (${t.kind} = 'cargo' AND ${t.cargoUnitMassKg} >= 0)) AND (${t.adrCategoryId} IS NULL OR ${t.kind} = 'cargo') AND ((${t.trailerBodyTypeId} IS NULL AND ${t.trailerChainTypeId} IS NULL) OR ${t.kind} = 'trailer_type')`,
    ),
  ],
);
export const catalogRelations = mysqlTable(
  "catalog_relations",
  {
    revisionId: idColumn("revision_id").notNull(),
    entityId: idColumn("entity_id").notNull(),
    relation: mysqlEnum("relation", [
      "region",
      "adr_category",
      "trailer_body_type",
      "trailer_chain_type",
    ]).notNull(),
    targetId: idColumn("target_id").notNull(),
    targetKind: kind("target_kind").notNull(),
    map: bytes("map").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.revisionId, t.entityId, t.relation] }),
    foreignKey({
      name: "catalog_relation_owner_fk",
      columns: [t.revisionId, t.entityId],
      foreignColumns: [catalogFacts.revisionId, catalogFacts.entityId],
    }).onDelete("restrict"),
    foreignKey({
      name: "catalog_relation_target_fk",
      columns: [t.revisionId, t.targetId, t.targetKind, t.map],
      foreignColumns: [
        catalogFacts.revisionId,
        catalogFacts.entityId,
        catalogFacts.kind,
        catalogFacts.map,
      ],
    }).onDelete("restrict"),
    check("catalog_relation_target_kind", sql`${t.relation} = ${t.targetKind}`),
  ],
);
export const catalogMappings = mysqlTable(
  "catalog_mappings",
  {
    revisionId: idColumn("revision_id").notNull(),
    game: game("game").notNull(),
    kind: kind("kind").notNull(),
    map: bytes("map").notNull(),
    provider: bytes("provider").notNull(),
    sourceId: bytes("source_id").notNull(),
    entityId: idColumn("entity_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.revisionId, t.provider, t.game, t.kind, t.map, t.sourceId] }),
    foreignKey({
      name: "catalog_mapping_target_fk",
      columns: [t.revisionId, t.entityId, t.kind, t.map],
      foreignColumns: [
        catalogFacts.revisionId,
        catalogFacts.entityId,
        catalogFacts.kind,
        catalogFacts.map,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "catalog_mapping_game_fk",
      columns: [t.revisionId, t.game],
      foreignColumns: [catalogRevisions.id, catalogRevisions.game],
    }).onDelete("restrict"),
  ],
);
export const catalogAliases = mysqlTable(
  "catalog_aliases",
  {
    revisionId: idColumn("revision_id").notNull(),
    entityId: idColumn("entity_id").notNull(),
    locale: mysqlEnum("locale", ["en", "ru"]).notNull(),
    normalized: opaqueColumn("normalized", { length: 512 }).notNull(),
    regionScope: opaqueColumn("region_scope", { length: 36 }).notNull(),
  },
  (t) => [
    primaryKey({
      name: "catalog_alias_pk",
      columns: [t.revisionId, t.locale, t.normalized, t.regionScope, t.entityId],
    }),
    foreignKey({
      name: "catalog_alias_fact_fk",
      columns: [t.revisionId, t.entityId],
      foreignColumns: [catalogFacts.revisionId, catalogFacts.entityId],
    }).onDelete("restrict"),
  ],
);
export const catalogCoverage = mysqlTable(
  "catalog_coverage",
  {
    revisionId: idColumn("revision_id")
      .notNull()
      .references(() => catalogRevisions.id, { onDelete: "restrict" }),
    packId: bytes("pack_id").notNull(),
    title: varchar("title", { length: 256 }).notNull(),
    state: mysqlEnum("state", ["validated", "missing", "failed", "non_contributing"]).notNull(),
    contributionKinds: json("contribution_kinds").$type<string[]>().notNull(),
    provenance: json("provenance").$type<unknown[]>().notNull(),
    reasonCodes: json("reason_codes").$type<string[]>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.revisionId, t.packId] })],
);
export const catalogChanges = mysqlTable(
  "catalog_changes",
  {
    revisionId: idColumn("revision_id")
      .notNull()
      .references(() => catalogRevisions.id, { onDelete: "restrict" }),
    entityId: idColumn("entity_id").notNull(),
    kind: kind("kind").notNull(),
    changeKind: mysqlEnum("change_kind", ["added", "changed", "retired"]).notNull(),
    fields: json("fields").$type<unknown[]>().notNull(),
    reasonCodes: json("reason_codes").$type<string[]>().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.revisionId, t.entityId] }),
    index("catalog_change_page").on(t.revisionId, t.changeKind, t.entityId),
  ],
);
export const catalogMappingReviews = mysqlTable("catalog_mapping_reviews", {
  id: idColumn("id").primaryKey(),
  revisionId: idColumn("revision_id")
    .notNull()
    .references(() => catalogRevisions.id, { onDelete: "restrict" }),
  actorId: idColumn("actor_id").notNull(),
  reason: text("reason").notNull(),
  version: int("version", { unsigned: true }).notNull(),
  createdAt: utcColumn("created_at").notNull(),
});
export const catalogMappingIssues = mysqlTable(
  "catalog_mapping_issues",
  {
    id: idColumn("id").primaryKey(),
    revisionId: idColumn("revision_id")
      .notNull()
      .references(() => catalogRevisions.id, { onDelete: "restrict" }),
    provider: bytes("provider").notNull(),
    kind: kind("kind").notNull(),
    map: bytes("map").notNull(),
    sourceId: bytes("source_id"),
    sourceLocale: mysqlEnum("source_locale", ["en", "ru"]),
    reasonCode: varchar("reason_code", { length: 128 }).notNull(),
    candidateEntityIds: json("candidate_entity_ids").$type<string[]>().notNull(),
    resolved: boolean("resolved").notNull().default(false),
  },
  (t) => [index("catalog_issue_page").on(t.revisionId, t.resolved, t.id)],
);
