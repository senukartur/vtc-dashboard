// Frozen pre-VTC-025 persistence algorithm from 2b5d9fc452b80bbc831c6340f5330b9783dc5f67.
// Only imports are relocated; this fixture proves old writer/reader behavior.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
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
import { decimalColumn, idColumn, utcColumn } from "../../packages/db/src/core/values.ts";
import { catalogFacts, catalogRevisions } from "@vtc/db/catalogs-schema";
import { trips, sourceMessages } from "@vtc/db/trips-schema";
export { asc, eq, inArray, sourceMessages, sourceTrips } from "@vtc/db/trips-schema";
const basis = (name: string) =>
  mysqlEnum(name, ["event", "checkpoint", "last-known", "receipt", "unknown"]);
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
    originEntityId: idColumn("origin_entity_id"),
    originFactId: idColumn("origin_fact_id"),
    destinationEntityId: idColumn("destination_entity_id"),
    destinationFactId: idColumn("destination_fact_id"),
    cargoEntityId: idColumn("cargo_entity_id"),
    cargoFactId: idColumn("cargo_fact_id"),
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
    index("trip_fact_history").on(t.canonicalTripId, t.id),
    check("trip_fact_trailer_count", sql`${t.trailerCount} <= 10`),
    foreignKey({
      name: "trip_fact_origin_pin_fk",
      columns: [t.originFactId, t.catalogRevisionId, t.originEntityId],
      foreignColumns: [catalogFacts.id, catalogFacts.revisionId, catalogFacts.entityId],
    }).onDelete("restrict"),
    foreignKey({
      name: "trip_fact_destination_pin_fk",
      columns: [t.destinationFactId, t.catalogRevisionId, t.destinationEntityId],
      foreignColumns: [catalogFacts.id, catalogFacts.revisionId, catalogFacts.entityId],
    }).onDelete("restrict"),
    foreignKey({
      name: "trip_fact_cargo_pin_fk",
      columns: [t.cargoFactId, t.catalogRevisionId, t.cargoEntityId],
      foreignColumns: [catalogFacts.id, catalogFacts.revisionId, catalogFacts.entityId],
    }).onDelete("restrict"),
    foreignKey({
      name: "trip_fact_adr_pin_fk",
      columns: [t.adrFactId, t.catalogRevisionId, t.adrEntityId],
      foreignColumns: [catalogFacts.id, catalogFacts.revisionId, catalogFacts.entityId],
    }).onDelete("restrict"),
    ...(
      [
        ["origin", t.originEntityId, t.originFactId],
        ["destination", t.destinationEntityId, t.destinationFactId],
        ["cargo", t.cargoEntityId, t.cargoFactId],
        ["adr", t.adrEntityId, t.adrFactId],
      ] as const
    ).map(([name, entity, fact]) =>
      check(
        `trip_fact_${name}_shape`,
        sql`(${entity} IS NULL AND ${fact} IS NULL) OR (${entity} IS NOT NULL AND ${fact} IS NOT NULL AND ${t.catalogRevisionId} IS NOT NULL)`,
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
      name: "trip_trailer_source_catalog_fk",
      columns: [t.tripFactId, t.catalogRevisionId],
      foreignColumns: [tripFacts.id, tripFacts.catalogRevisionId],
    }).onDelete("restrict"),
    check("trip_trailer_position", sql`${t.position} < 10`),
    check(
      "trip_trailer_shape",
      sql`(${t.entityId} IS NULL AND ${t.catalogFactId} IS NULL AND ${t.catalogRevisionId} IS NULL AND ${t.sourceField} IS NULL AND ${t.unknownReason} IS NOT NULL) OR (${t.entityId} IS NOT NULL AND ${t.catalogFactId} IS NOT NULL AND ${t.catalogRevisionId} IS NOT NULL AND ${t.sourceField} IS NOT NULL AND ${t.unknownReason} IS NULL)`,
    ),
  ],
);
