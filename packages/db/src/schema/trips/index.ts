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
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { decimalColumn, idColumn, opaqueColumn, utcColumn } from "../../core/values.js";
import { catalogFacts, catalogRevisions } from "../catalogs/index.js";
import { membership } from "../identity/index.js";
import { qualificationAssignments, qualificationRules } from "../qualifications/index.js";

export { and, asc, desc, eq, inArray, lt, lte, or, sql } from "drizzle-orm";

const game = (name: string) => mysqlEnum(name, ["ets2", "ats"]);
const provider = (name: string) => mysqlEnum(name, ["ets2telemetry", "manual"]);
const basis = (name: string) =>
  mysqlEnum(name, ["event", "checkpoint", "last-known", "receipt", "unknown"]);
const medium = customType<{ data: string; driverData: string }>({ dataType: () => "mediumtext" });

export const trips = mysqlTable(
  "trips",
  {
    id: idColumn("id").primaryKey(),
    ownerId: idColumn("owner_id")
      .notNull()
      .references(() => membership.userId, { onDelete: "restrict" }),
    game: game("game").notNull(),
    version: int("version", { unsigned: true }).notNull(),
    outcome: mysqlEnum("outcome", ["open", "delivered", "cancelled", "none"]).notNull(),
    recording: mysqlEnum("recording", ["complete", "partial", "unknown"]).notNull(),
    decision: mysqlEnum("decision", [
      "unassessed",
      "pending_review",
      "accepted",
      "rejected",
    ]).notNull(),
    correctionPending: boolean("correction_pending").notNull().default(false),
    currentFactId: idColumn("current_fact_id"),
    actualStart: utcColumn("actual_start"),
    actualEnd: utcColumn("actual_end"),
    reportingAt: utcColumn("reporting_at"),
    actualDistanceM: decimalColumn("actual_distance_m"),
    reviewReasons: json("review_reasons").$type<string[]>().notNull(),
    reviewHold: boolean("review_hold").notNull().default(false),
    createdAt: utcColumn("created_at").notNull(),
  },
  (t) => [
    index("trip_company_page").on(t.decision, t.createdAt, t.id),
    index("trip_owner_page").on(t.ownerId, t.createdAt, t.id),
    index("trip_game_page").on(t.game, t.decision, t.createdAt, t.id),
    check("trip_version_positive", sql`${t.version} > 0`),
  ],
);

export const sourceTrips = mysqlTable(
  "source_trips",
  {
    id: idColumn("id").primaryKey(),
    provider: provider("provider").notNull(),
    game: game("game").notNull(),
    sessionKey: opaqueColumn("session_key", { length: 36 }).notNull(),
    tripKey: opaqueColumn("trip_key", { length: 36 }).notNull(),
    ownerId: idColumn("owner_id")
      .notNull()
      .references(() => membership.userId, { onDelete: "restrict" }),
    canonicalTripId: idColumn("canonical_trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "restrict" }),
    latestRevision: varchar("latest_revision", { length: 16 }).notNull(),
    connectionContext: json("connection_context").$type<unknown>().notNull(),
    createdAt: utcColumn("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("source_permanent_identity").on(t.provider, t.game, t.sessionKey, t.tripKey),
    index("source_canonical").on(t.canonicalTripId, t.id),
  ],
);

export const sourceMessages = mysqlTable(
  "source_messages",
  {
    id: idColumn("id").primaryKey(),
    sourceTripId: idColumn("source_trip_id")
      .notNull()
      .references(() => sourceTrips.id, { onDelete: "restrict" }),
    provider: provider("provider").notNull(),
    eventKey: opaqueColumn("event_key", { length: 36 }).notNull(),
    revision: varchar("revision", { length: 16 }).notNull(),
    sha256: opaqueColumn("sha256", { length: 32 }).notNull(),
    receivedAt: utcColumn("received_at").notNull(),
    deliveryMode: mysqlEnum("delivery_mode", ["live", "backfill", "manual"]).notNull(),
  },
  (t) => [
    uniqueIndex("source_event_identity").on(t.provider, t.eventKey),
    uniqueIndex("source_revision_identity").on(t.sourceTripId, t.revision),
  ],
);

// Payload retention is separate from immutable identity and structured source facts.
export const sourcePayloads = mysqlTable(
  "source_payloads",
  {
    messageId: idColumn("message_id")
      .primaryKey()
      .references(() => sourceMessages.id, { onDelete: "restrict" }),
    content: medium("content"),
    eligibleAt: utcColumn("eligible_at"),
    policyReference: varchar("policy_reference", { length: 128 }),
    hold: boolean("hold").notNull().default(false),
    expiredAt: utcColumn("expired_at"),
  },
  (t) => [index("source_retention_eligibility").on(t.eligibleAt, t.messageId)],
);

export const tripFacts = mysqlTable(
  "trip_facts",
  {
    id: idColumn("id").primaryKey(),
    messageId: idColumn("message_id")
      .notNull()
      .references(() => sourceMessages.id, { onDelete: "restrict" }),
    canonicalTripId: idColumn("canonical_trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "restrict" }),
    adapterVersion: int("adapter_version", { unsigned: true }).notNull(),
    catalogRevisionId: idColumn("catalog_revision_id").references(() => catalogRevisions.id, {
      onDelete: "restrict",
    }),
    outcome: mysqlEnum("outcome", ["open", "delivered", "cancelled", "none"]).notNull(),
    recording: mysqlEnum("recording", ["complete", "partial", "unknown"]).notNull(),
    startUtc: utcColumn("start_utc"),
    startBasis: basis("start_basis").notNull(),
    startVerified: boolean("start_verified").notNull(),
    endUtc: utcColumn("end_utc"),
    endBasis: basis("end_basis").notNull(),
    endVerified: boolean("end_verified").notNull(),
    originCatalogRevisionId: idColumn("origin_catalog_revision_id"),
    originEntityId: idColumn("origin_entity_id"),
    originFactId: idColumn("origin_fact_id"),
    destinationCatalogRevisionId: idColumn("destination_catalog_revision_id"),
    destinationEntityId: idColumn("destination_entity_id"),
    destinationFactId: idColumn("destination_fact_id"),
    cargoCatalogRevisionId: idColumn("cargo_catalog_revision_id"),
    cargoEntityId: idColumn("cargo_entity_id"),
    cargoFactId: idColumn("cargo_fact_id"),
    adrCatalogRevisionId: idColumn("adr_catalog_revision_id"),
    adrEntityId: idColumn("adr_entity_id"),
    adrFactId: idColumn("adr_fact_id"),
    cargoMassKg: decimalColumn("cargo_mass_kg"),
    actualDistanceM: decimalColumn("actual_distance_m"),
    measuredSegmentM: decimalColumn("measured_segment_m"),
    plannedDistanceM: decimalColumn("planned_distance_m"),
    deliveredDistanceM: decimalColumn("delivered_distance_m"),
    fuelUsedL: decimalColumn("fuel_used_l"),
    cargoDamageFraction: decimalColumn("cargo_damage_fraction"),
    wholeTripDistanceSupported: boolean("whole_trip_distance_supported").notNull(),
    trailersComplete: boolean("trailers_complete").notNull(),
    trailerCount: int("trailer_count", { unsigned: true }).notNull(),
    ruleContextComplete: boolean("rule_context_complete").notNull(),
    reasons: json("reasons").$type<string[]>().notNull(),
    // Redundant immutable adapter evidence; normalized values are reconstructed from columns.
    evidence: json("evidence").$type<unknown>().notNull(),
  },
  (t) => [
    uniqueIndex("trip_fact_message").on(t.messageId),
    uniqueIndex("trip_fact_catalog_scope").on(t.id, t.catalogRevisionId),
    uniqueIndex("trip_fact_adapter_scope").on(t.id, t.adapterVersion),
    check(
      "trip_fact_format2_pin_mode",
      sql`${t.adapterVersion} <> 2 OR ${t.catalogRevisionId} IS NULL`,
    ),
    index("trip_fact_history").on(t.canonicalTripId, t.id),
    check("trip_fact_trailer_count", sql`${t.trailerCount} <= 10`),
    foreignKey({
      name: "trip_origin_individual_pin_fk",
      columns: [t.originFactId, t.originCatalogRevisionId, t.originEntityId],
      foreignColumns: [catalogFacts.id, catalogFacts.revisionId, catalogFacts.entityId],
    }).onDelete("restrict"),
    foreignKey({
      name: "trip_fact_origin_pin_fk",
      columns: [t.originFactId, t.catalogRevisionId, t.originEntityId],
      foreignColumns: [catalogFacts.id, catalogFacts.revisionId, catalogFacts.entityId],
    }).onDelete("restrict"),
    foreignKey({
      name: "trip_destination_individual_pin_fk",
      columns: [t.destinationFactId, t.destinationCatalogRevisionId, t.destinationEntityId],
      foreignColumns: [catalogFacts.id, catalogFacts.revisionId, catalogFacts.entityId],
    }).onDelete("restrict"),
    foreignKey({
      name: "trip_fact_destination_pin_fk",
      columns: [t.destinationFactId, t.catalogRevisionId, t.destinationEntityId],
      foreignColumns: [catalogFacts.id, catalogFacts.revisionId, catalogFacts.entityId],
    }).onDelete("restrict"),
    foreignKey({
      name: "trip_cargo_individual_pin_fk",
      columns: [t.cargoFactId, t.cargoCatalogRevisionId, t.cargoEntityId],
      foreignColumns: [catalogFacts.id, catalogFacts.revisionId, catalogFacts.entityId],
    }).onDelete("restrict"),
    foreignKey({
      name: "trip_fact_cargo_pin_fk",
      columns: [t.cargoFactId, t.catalogRevisionId, t.cargoEntityId],
      foreignColumns: [catalogFacts.id, catalogFacts.revisionId, catalogFacts.entityId],
    }).onDelete("restrict"),
    foreignKey({
      name: "trip_adr_individual_pin_fk",
      columns: [t.adrFactId, t.adrCatalogRevisionId, t.adrEntityId],
      foreignColumns: [catalogFacts.id, catalogFacts.revisionId, catalogFacts.entityId],
    }).onDelete("restrict"),
    foreignKey({
      name: "trip_fact_adr_pin_fk",
      columns: [t.adrFactId, t.catalogRevisionId, t.adrEntityId],
      foreignColumns: [catalogFacts.id, catalogFacts.revisionId, catalogFacts.entityId],
    }).onDelete("restrict"),
    ...(
      [
        ["origin", t.originEntityId, t.originFactId, t.originCatalogRevisionId],
        ["destination", t.destinationEntityId, t.destinationFactId, t.destinationCatalogRevisionId],
        ["cargo", t.cargoEntityId, t.cargoFactId, t.cargoCatalogRevisionId],
        ["adr", t.adrEntityId, t.adrFactId, t.adrCatalogRevisionId],
      ] as const
    ).map(([name, entity, fact, pin]) =>
      check(
        `trip_fact_${name}_shape`,
        sql`(${entity} IS NULL AND ${fact} IS NULL AND ${pin} IS NULL) OR (${entity} IS NOT NULL AND ${fact} IS NOT NULL AND ((${t.catalogRevisionId} IS NOT NULL AND (${pin} IS NULL OR ${pin} = ${t.catalogRevisionId})) OR (${t.catalogRevisionId} IS NULL AND ${pin} IS NOT NULL)))`,
      ),
    ),
    check(
      "trip_fact_start_supported",
      sql`${t.startVerified} = 0 OR (${t.startBasis} = 'event' AND ${t.startUtc} IS NOT NULL)`,
    ),
    check(
      "trip_fact_end_supported",
      sql`${t.endVerified} = 0 OR (${t.endBasis} = 'event' AND ${t.endUtc} IS NOT NULL)`,
    ),
    check(
      "trip_fact_quantities",
      sql`(${t.cargoMassKg} IS NULL OR ${t.cargoMassKg} >= 0) AND (${t.actualDistanceM} IS NULL OR ${t.actualDistanceM} >= 0) AND (${t.measuredSegmentM} IS NULL OR ${t.measuredSegmentM} >= 0) AND (${t.plannedDistanceM} IS NULL OR ${t.plannedDistanceM} >= 0) AND (${t.deliveredDistanceM} IS NULL OR ${t.deliveredDistanceM} >= 0) AND (${t.fuelUsedL} IS NULL OR ${t.fuelUsedL} >= 0) AND (${t.cargoDamageFraction} IS NULL OR (${t.cargoDamageFraction} >= 0 AND ${t.cargoDamageFraction} <= 1))`,
    ),
  ],
);

export const tripFactTrailers = mysqlTable(
  "trip_fact_trailers",
  {
    tripFactId: idColumn("trip_fact_id")
      .notNull()
      .references(() => tripFacts.id, { onDelete: "restrict" }),
    position: int("position", { unsigned: true }).notNull(),
    catalogRevisionId: idColumn("catalog_revision_id"),
    sourceAdapterVersion: int("source_adapter_version", { unsigned: true }).notNull().default(1),
    legacyCatalogRevisionId: idColumn("legacy_catalog_revision_id").generatedAlwaysAs(
      sql.raw("IF(`source_adapter_version` = 1, `catalog_revision_id`, NULL)"),
      { mode: "stored" },
    ),
    entityId: idColumn("entity_id"),
    catalogFactId: idColumn("catalog_fact_id"),
    sourceField: varchar("source_field", { length: 128 }),
    unknownReason: varchar("unknown_reason", { length: 128 }),
  },
  (t) => [
    primaryKey({ columns: [t.tripFactId, t.position] }),
    foreignKey({
      name: "trip_trailer_pin_fk",
      columns: [t.catalogFactId, t.catalogRevisionId, t.entityId],
      foreignColumns: [catalogFacts.id, catalogFacts.revisionId, catalogFacts.entityId],
    }).onDelete("restrict"),
    foreignKey({
      name: "trip_trailer_adapter_scope_fk",
      columns: [t.tripFactId, t.sourceAdapterVersion],
      foreignColumns: [tripFacts.id, tripFacts.adapterVersion],
    }).onDelete("restrict"),
    foreignKey({
      name: "trip_trailer_legacy_source_catalog_fk",
      columns: [t.tripFactId, t.legacyCatalogRevisionId],
      foreignColumns: [tripFacts.id, tripFacts.catalogRevisionId],
    }).onDelete("restrict"),
    check("trip_trailer_position", sql`${t.position} < 10`),
    check(
      "trip_trailer_shape",
      sql`(${t.entityId} IS NULL AND ${t.catalogFactId} IS NULL AND ${t.catalogRevisionId} IS NULL AND ${t.sourceField} IS NULL AND ${t.unknownReason} IS NOT NULL) OR (${t.entityId} IS NOT NULL AND ${t.catalogFactId} IS NOT NULL AND ${t.catalogRevisionId} IS NOT NULL AND ${t.sourceField} IS NOT NULL AND ${t.unknownReason} IS NULL)`,
    ),
  ],
);

export const tripHistory = mysqlTable(
  "trip_history",
  {
    id: idColumn("id").primaryKey(),
    tripId: idColumn("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "restrict" }),
    version: int("version", { unsigned: true }).notNull(),
    factId: idColumn("fact_id")
      .notNull()
      .references(() => tripFacts.id, { onDelete: "restrict" }),
    outcome: mysqlEnum("outcome", ["open", "delivered", "cancelled", "none"]).notNull(),
    reasons: json("reasons").$type<string[]>().notNull(),
    createdAt: utcColumn("created_at").notNull(),
  },
  (t) => [uniqueIndex("trip_history_version").on(t.tripId, t.version)],
);

// One authoritative replaceable credit row; immutable replacements retain the full decision seam.
export const tripContributions = mysqlTable(
  "trip_contributions",
  {
    tripId: idColumn("trip_id")
      .primaryKey()
      .references(() => trips.id, { onDelete: "restrict" }),
    version: int("version", { unsigned: true }).notNull(),
    ownerId: idColumn("owner_id")
      .notNull()
      .references(() => membership.userId, { onDelete: "restrict" }),
    game: game("game").notNull(),
    factId: idColumn("fact_id")
      .notNull()
      .references(() => tripFacts.id, { onDelete: "restrict" }),
    accepted: boolean("accepted").notNull(),
    credited: boolean("credited").notNull(),
    aliasOf: idColumn("alias_of").references(() => trips.id, { onDelete: "restrict" }),
    assignmentId: idColumn("assignment_id"),
    ruleVersionId: idColumn("rule_version_id"),
    attributionBasis: mysqlEnum("attribution_basis", [
      "actual_start",
      "manual_confirmation",
      "unresolved",
    ]).notNull(),
    attributionAt: utcColumn("attribution_at"),
    actualDistanceM: decimalColumn("actual_distance_m"),
    fingerprint: opaqueColumn("fingerprint", { length: 32 }).notNull(),
    changedAt: utcColumn("changed_at").notNull(),
  },
  (t) => [
    foreignKey({
      name: "trip_credit_assignment_fk",
      columns: [t.assignmentId],
      foreignColumns: [qualificationAssignments.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "trip_credit_rules_fk",
      columns: [t.ruleVersionId],
      foreignColumns: [qualificationRules.id],
    }).onDelete("restrict"),
    index("trip_contribution_period").on(t.assignmentId, t.credited, t.tripId),
    check("trip_credit_version_positive", sql`${t.version} > 0`),
    check("trip_credit_alias_distinct", sql`${t.aliasOf} IS NULL OR ${t.aliasOf} <> ${t.tripId}`),
    check(
      "trip_credit_shape",
      sql`${t.credited} = 0 OR (${t.accepted} = 1 AND ${t.aliasOf} IS NULL AND ${t.assignmentId} IS NOT NULL AND ${t.ruleVersionId} IS NOT NULL AND ${t.attributionAt} IS NOT NULL AND ${t.actualDistanceM} > 0)`,
    ),
  ],
);
export const tripContributionHistory = mysqlTable(
  "trip_contribution_history",
  {
    tripId: idColumn("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "restrict" }),
    version: int("version", { unsigned: true }).notNull(),
    snapshot: json("snapshot").$type<unknown>().notNull(),
    changedAt: utcColumn("changed_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.tripId, t.version] })],
);
