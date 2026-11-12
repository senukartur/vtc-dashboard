import { sql } from "drizzle-orm";
import {
  type AnyMySqlColumn,
  boolean,
  check,
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
import {
  catalogCargoes,
  catalogCities,
  catalogCompanyCities,
  catalogDlcs,
  catalogTrailers,
} from "../catalogs/index.js";
import { membership } from "../identity/index.js";

export { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";

const fk = (name: string, column: AnyMySqlColumn, target: AnyMySqlColumn) =>
  foreignKey({ name, columns: [column], foreignColumns: [target] }).onDelete("restrict");
export const events = mysqlTable(
  "events",
  {
    id: idColumn("id").primaryKey(),
    version: int("version", { unsigned: true }).notNull(),
    changeSequence: int("change_sequence", { unsigned: true }).notNull(),
    notificationPending: boolean("notification_pending").notNull().default(true),
    notificationMaterial: json("notification_material").$type<{
      schemaVersion: 1;
      throughVersion: number;
      startVersion: number;
      routeVersion: number;
      statusVersion: number;
    }>(),
    notificationMaterialPending: boolean("notification_material_pending").generatedAlwaysAs(
      sql`
      CASE WHEN JSON_TYPE(notification_material)='OBJECT' AND JSON_LENGTH(notification_material)=5
        AND JSON_TYPE(JSON_EXTRACT(notification_material,'$.schemaVersion')) IN ('INTEGER','DOUBLE','DECIMAL')
        AND JSON_EXTRACT(notification_material,'$.schemaVersion') BETWEEN 1 AND version
        AND JSON_TYPE(JSON_EXTRACT(notification_material,'$.throughVersion')) IN ('INTEGER','DOUBLE','DECIMAL')
        AND JSON_EXTRACT(notification_material,'$.throughVersion') BETWEEN 1 AND version
        AND JSON_TYPE(JSON_EXTRACT(notification_material,'$.startVersion')) IN ('INTEGER','DOUBLE','DECIMAL')
        AND JSON_EXTRACT(notification_material,'$.startVersion') BETWEEN 1 AND version
        AND JSON_TYPE(JSON_EXTRACT(notification_material,'$.routeVersion')) IN ('INTEGER','DOUBLE','DECIMAL')
        AND JSON_EXTRACT(notification_material,'$.routeVersion') BETWEEN 1 AND version
        AND JSON_TYPE(JSON_EXTRACT(notification_material,'$.statusVersion')) IN ('INTEGER','DOUBLE','DECIMAL')
        AND JSON_EXTRACT(notification_material,'$.statusVersion') BETWEEN 1 AND version
        AND JSON_EXTRACT(notification_material,'$.schemaVersion')=1
      THEN NOT (CAST(JSON_EXTRACT(notification_material,'$.schemaVersion') AS UNSIGNED)=JSON_EXTRACT(notification_material,'$.schemaVersion')
        AND CAST(JSON_EXTRACT(notification_material,'$.throughVersion') AS UNSIGNED)=JSON_EXTRACT(notification_material,'$.throughVersion')
        AND CAST(JSON_EXTRACT(notification_material,'$.startVersion') AS UNSIGNED)=JSON_EXTRACT(notification_material,'$.startVersion')
        AND CAST(JSON_EXTRACT(notification_material,'$.routeVersion') AS UNSIGNED)=JSON_EXTRACT(notification_material,'$.routeVersion')
        AND CAST(JSON_EXTRACT(notification_material,'$.statusVersion') AS UNSIGNED)=JSON_EXTRACT(notification_material,'$.statusVersion')
        AND CAST(JSON_EXTRACT(notification_material,'$.throughVersion') AS UNSIGNED)=version
        AND CAST(JSON_EXTRACT(notification_material,'$.startVersion') AS UNSIGNED) BETWEEN 1 AND version
        AND CAST(JSON_EXTRACT(notification_material,'$.routeVersion') AS UNSIGNED) BETWEEN 1 AND version
        AND CAST(JSON_EXTRACT(notification_material,'$.statusVersion') AS UNSIGNED) BETWEEN 1 AND version)
      ELSE TRUE END`,
      { mode: "virtual" },
    ),
    tripAssessmentPending: boolean("trip_assessment_pending").notNull().default(false),
    tripAssessmentGeneration: int("trip_assessment_generation", { unsigned: true })
      .notNull()
      .default(0),
    attendanceVersion: int("attendance_version", { unsigned: true }).notNull(),
    currentRevisionId: idColumn("current_revision_id"),
    game: mysqlEnum("game", ["ets2", "ats"]).notNull(),
    visibility: mysqlEnum("visibility", ["public", "members"]).notNull(),
    status: mysqlEnum("status", ["scheduled", "cancelled"]).notNull(),
    startsAt: utcColumn("starts_at").notNull(),
    createdAt: utcColumn("created_at").notNull(),
  },
  (t) => [
    index("event_member_page").on(t.startsAt, t.id),
    index("event_trip_assessment_pending").on(t.tripAssessmentPending, t.id),
    index("event_notification_pending").on(t.notificationPending, t.id),
    index("event_notification_material_pending").on(t.notificationMaterialPending, t.id),
    index("event_public_page").on(t.visibility, t.startsAt, t.id),
    check(
      "event_versions_positive",
      sql`${t.version}>0 AND ${t.changeSequence}>0 AND ${t.attendanceVersion}>0`,
    ),
  ],
);
export const eventRevisions = mysqlTable(
  "event_revisions",
  {
    id: idColumn("id").primaryKey(),
    eventId: idColumn("event_id").notNull(),
    version: int("version", { unsigned: true }).notNull(),
    sequence: int("sequence", { unsigned: true }).notNull(),
    actorId: idColumn("actor_id").notNull(),
    recordedAt: utcColumn("recorded_at").notNull(),
    category: mysqlEnum("category", ["created", "updated", "cancelled", "published"]).notNull(),
    status: mysqlEnum("status", ["scheduled", "cancelled"]).notNull(),
    title: varchar("title", { length: 256 }).notNull(),
    description: text("description").notNull(),
    game: mysqlEnum("game", ["ets2", "ats"]).notNull(),
    server: varchar("server", { length: 256 }).notNull(),
    organizer: varchar("organizer", { length: 256 }).notNull(),
    meetingLocation: varchar("meeting_location", { length: 2048 }).notNull(),
    route: varchar("route", { length: 2048 }).notNull(),
    meetingAt: utcColumn("meeting_at").notNull(),
    startsAt: utcColumn("starts_at").notNull(),
    endsAt: utcColumn("ends_at"),
    visibility: mysqlEnum("visibility", ["public", "members"]).notNull(),
    originCityId: idColumn("origin_city_id"),
    destinationCityId: idColumn("destination_city_id"),
    prescribedCargoId: idColumn("prescribed_cargo_id"),
    prescribedTrailerId: idColumn("prescribed_trailer_id"),
    prescribedMassKg: decimalColumn("prescribed_mass_kg"),
    privateReason: varchar("private_reason", { length: 2048 }),
  },
  (t) => [
    fk("event_revision_event_fk", t.eventId, events.id),
    fk("event_revision_actor_fk", t.actorId, membership.userId),
    uniqueIndex("event_revision_version").on(t.eventId, t.version),
    uniqueIndex("event_revision_sequence").on(t.eventId, t.sequence),
    check(
      "event_time_order",
      sql`${t.meetingAt}<=${t.startsAt} AND (${t.endsAt} IS NULL OR ${t.endsAt}>=${t.startsAt})`,
    ),
    foreignKey({
      name: "event_revision_origin_fk",
      columns: [t.originCityId, t.game],
      foreignColumns: [catalogCities.id, catalogCities.game],
    }).onDelete("restrict"),
    foreignKey({
      name: "event_revision_destination_fk",
      columns: [t.destinationCityId, t.game],
      foreignColumns: [catalogCities.id, catalogCities.game],
    }).onDelete("restrict"),
    foreignKey({
      name: "event_revision_cargo_fk",
      columns: [t.prescribedCargoId, t.game],
      foreignColumns: [catalogCargoes.id, catalogCargoes.game],
    }).onDelete("restrict"),
    foreignKey({
      name: "event_revision_trailer_fk",
      columns: [t.prescribedTrailerId, t.game],
      foreignColumns: [catalogTrailers.id, catalogTrailers.game],
    }).onDelete("restrict"),
    check("event_mass_nonnegative", sql`${t.prescribedMassKg} IS NULL OR ${t.prescribedMassKg}>=0`),
  ],
);
export const eventResponses = mysqlTable(
  "event_responses",
  {
    id: idColumn("id").primaryKey(),
    eventId: idColumn("event_id").notNull(),
    memberId: idColumn("member_id").notNull(),
    version: int("version", { unsigned: true }).notNull(),
    currentRevisionId: idColumn("current_revision_id").notNull(),
    status: mysqlEnum("status", ["unanswered", "participating", "declined"]).notNull(),
  },
  (t) => [
    fk("event_response_event_fk", t.eventId, events.id),
    fk("event_response_member_fk", t.memberId, membership.userId),
    uniqueIndex("event_response_member").on(t.eventId, t.memberId),
    index("event_participants_page").on(t.eventId, t.status, t.memberId),
  ],
);
export const eventResponseRevisions = mysqlTable(
  "event_response_revisions",
  {
    id: idColumn("id").primaryKey(),
    responseId: idColumn("response_id").notNull(),
    eventId: idColumn("event_id").notNull(),
    memberId: idColumn("member_id").notNull(),
    version: int("version", { unsigned: true }).notNull(),
    sequence: int("sequence", { unsigned: true }).notNull(),
    actorId: idColumn("actor_id").notNull(),
    recordedAt: utcColumn("recorded_at").notNull(),
    status: mysqlEnum("status", ["unanswered", "participating", "declined"]).notNull(),
    reason: varchar("reason", { length: 2048 }),
  },
  (t) => [
    fk("event_response_rev_event_fk", t.eventId, events.id),
    fk("event_response_rev_member_fk", t.memberId, membership.userId),
    fk("event_response_rev_actor_fk", t.actorId, membership.userId),
    uniqueIndex("event_response_rev_version").on(t.responseId, t.version),
    index("event_response_order").on(t.eventId, t.sequence, t.memberId),
    check(
      "event_decline_reason",
      sql`(${t.status}='declined' AND ${t.reason} IS NOT NULL AND CHAR_LENGTH(TRIM(${t.reason}))>0) OR (${t.status}<>'declined' AND ${t.reason} IS NULL)`,
    ),
  ],
);
export const eventAttendances = mysqlTable(
  "event_attendances",
  {
    eventId: idColumn("event_id").notNull(),
    memberId: idColumn("member_id").notNull(),
    currentRevisionId: idColumn("current_revision_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.memberId] }),
    fk("event_attendance_event_fk", t.eventId, events.id),
    fk("event_attendance_member_fk", t.memberId, membership.userId),
  ],
);
export const eventAttendanceRevisions = mysqlTable(
  "event_attendance_revisions",
  {
    id: idColumn("id").primaryKey(),
    eventId: idColumn("event_id").notNull(),
    eventRevisionId: idColumn("event_revision_id").notNull(),
    memberId: idColumn("member_id").notNull(),
    version: int("version", { unsigned: true }).notNull(),
    sequence: int("sequence", { unsigned: true }).notNull(),
    actorId: idColumn("actor_id").notNull(),
    recordedAt: utcColumn("recorded_at").notNull(),
    status: mysqlEnum("status", ["attended", "not_attended"]).notNull(),
    note: varchar("note", { length: 2048 }),
  },
  (t) => [
    fk("event_attendance_rev_event_fk", t.eventId, events.id),
    fk("event_attendance_rev_definition_fk", t.eventRevisionId, eventRevisions.id),
    fk("event_attendance_rev_member_fk", t.memberId, membership.userId),
    fk("event_attendance_rev_actor_fk", t.actorId, membership.userId),
    uniqueIndex("event_attendance_rev_version").on(t.eventId, t.memberId, t.version),
    index("event_attendance_order").on(t.eventId, t.sequence, t.memberId),
  ],
);
// Durable results contain immutable references only; private reasons remain in owned history.
export const eventCommands = mysqlTable(
  "event_commands",
  {
    actorId: idColumn("actor_id").notNull(),
    route: mysqlEnum("route", ["create", "update", "cancel", "response", "attendance"]).notNull(),
    targetId: idColumn("target_id").notNull(),
    key: idColumn("key").notNull(),
    fingerprint: opaqueColumn("fingerprint", { length: 32 }).notNull(),
    result: json("result")
      .$type<{ eventId: string; revisionId: string; version: number }>()
      .notNull(),
    recordedAt: utcColumn("recorded_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.actorId, t.route, t.targetId, t.key] }),
    fk("event_command_actor_fk", t.actorId, membership.userId),
  ],
);

// Reserve an identity at draft creation. Legacy events acquire metadata when
// a Stage 2 command first needs it.
export const eventMetadata = mysqlTable(
  "event_metadata",
  {
    id: idColumn("id").primaryKey(),
    publishedEventId: idColumn("published_event_id"),
    mediaVersion: int("media_version", { unsigned: true }).notNull().default(1),
    createdAt: utcColumn("created_at").notNull(),
  },
  (t) => [
    fk("event_metadata_published_fk", t.publishedEventId, events.id),
    check(
      "event_metadata_published_id",
      sql`${t.publishedEventId} IS NULL OR ${t.publishedEventId}=${t.id}`,
    ),
    check("event_media_version_positive", sql`${t.mediaVersion}>0`),
  ],
);

const routeExtension = () => ({
  platform: mysqlEnum("platform", ["truckersmp", "haulmp"]),
  organizerMemberId: idColumn("organizer_member_id"),
  originDepotId: idColumn("origin_depot_id"),
  destinationDepotId: idColumn("destination_depot_id"),
  distanceKm: decimalColumn("distance_km"),
});

export const eventDrafts = mysqlTable(
  "event_drafts",
  {
    eventId: idColumn("event_id").primaryKey(),
    version: int("version", { unsigned: true }).notNull(),
    updatedBy: idColumn("updated_by").notNull(),
    updatedAt: utcColumn("updated_at").notNull(),
    discardedAt: utcColumn("discarded_at"),
    title: varchar("title", { length: 256 }),
    description: text("description"),
    game: mysqlEnum("game", ["ets2", "ats"]),
    server: varchar("server", { length: 256 }),
    organizer: varchar("organizer", { length: 256 }),
    meetingLocation: varchar("meeting_location", { length: 2048 }),
    route: varchar("route", { length: 2048 }),
    meetingAt: utcColumn("meeting_at"),
    startsAt: utcColumn("starts_at"),
    endsAt: utcColumn("ends_at"),
    visibility: mysqlEnum("visibility", ["public", "members"]),
    originCityId: idColumn("origin_city_id"),
    destinationCityId: idColumn("destination_city_id"),
    prescribedCargoId: idColumn("prescribed_cargo_id"),
    prescribedTrailerTypeId: idColumn("prescribed_trailer_type_id"),
    prescribedMassKg: decimalColumn("prescribed_mass_kg"),
    ...routeExtension(),
  },
  (t) => [
    fk("event_draft_metadata_fk", t.eventId, eventMetadata.id),
    fk("event_draft_actor_fk", t.updatedBy, membership.userId),
    fk("event_draft_organizer_fk", t.organizerMemberId, membership.userId),
    fk("event_draft_origin_depot_fk", t.originDepotId, catalogCompanyCities.id),
    fk("event_draft_destination_depot_fk", t.destinationDepotId, catalogCompanyCities.id),
    foreignKey({
      name: "event_draft_origin_fk",
      columns: [t.originCityId, t.game],
      foreignColumns: [catalogCities.id, catalogCities.game],
    }).onDelete("restrict"),
    foreignKey({
      name: "event_draft_destination_fk",
      columns: [t.destinationCityId, t.game],
      foreignColumns: [catalogCities.id, catalogCities.game],
    }).onDelete("restrict"),
    foreignKey({
      name: "event_draft_cargo_fk",
      columns: [t.prescribedCargoId, t.game],
      foreignColumns: [catalogCargoes.id, catalogCargoes.game],
    }).onDelete("restrict"),
    foreignKey({
      name: "event_draft_trailer_fk",
      columns: [t.prescribedTrailerTypeId, t.game],
      foreignColumns: [catalogTrailers.id, catalogTrailers.game],
    }).onDelete("restrict"),
    uniqueIndex("event_draft_id_game").on(t.eventId, t.game),
    index("event_draft_page").on(t.discardedAt, t.updatedAt, t.eventId),
    check("event_draft_version_positive", sql`${t.version}>0`),
    check("event_draft_distance_nonnegative", sql`${t.distanceKm} IS NULL OR ${t.distanceKm}>=0`),
    check(
      "event_draft_mass_nonnegative",
      sql`${t.prescribedMassKg} IS NULL OR ${t.prescribedMassKg}>=0`,
    ),
    check(
      "event_draft_catalog_game",
      sql`${t.game} IS NOT NULL OR (
      ${t.originCityId} IS NULL AND ${t.destinationCityId} IS NULL
      AND ${t.originDepotId} IS NULL AND ${t.destinationDepotId} IS NULL
      AND ${t.prescribedCargoId} IS NULL AND ${t.prescribedTrailerTypeId} IS NULL)`,
    ),
  ],
);

export const eventRevisionDetails = mysqlTable(
  "event_revision_details",
  {
    revisionId: idColumn("revision_id").primaryKey(),
    ...routeExtension(),
  },
  (t) => [
    fk("event_revision_details_fk", t.revisionId, eventRevisions.id),
    fk("event_revision_organizer_fk", t.organizerMemberId, membership.userId),
    fk("event_revision_origin_depot_fk", t.originDepotId, catalogCompanyCities.id),
    fk("event_revision_destination_depot_fk", t.destinationDepotId, catalogCompanyCities.id),
    check(
      "event_revision_distance_nonnegative",
      sql`${t.distanceKm} IS NULL OR ${t.distanceKm}>=0`,
    ),
  ],
);

const dlcSelection = () => ({
  dlcId: idColumn("dlc_id").notNull(),
  game: mysqlEnum("game", ["ets2", "ats"]).notNull(),
});

export const eventDraftDlcs = mysqlTable(
  "event_draft_dlcs",
  {
    eventId: idColumn("event_id").notNull(),
    ...dlcSelection(),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.dlcId] }),
    foreignKey({
      name: "event_draft_dlc_draft_fk",
      columns: [t.eventId, t.game],
      foreignColumns: [eventDrafts.eventId, eventDrafts.game],
    }).onDelete("restrict"),
    foreignKey({
      name: "event_draft_dlc_catalog_fk",
      columns: [t.dlcId, t.game],
      foreignColumns: [catalogDlcs.id, catalogDlcs.game],
    }).onDelete("restrict"),
  ],
);

export const eventRevisionDlcs = mysqlTable(
  "event_revision_dlcs",
  {
    revisionId: idColumn("revision_id").notNull(),
    ...dlcSelection(),
  },
  (t) => [
    primaryKey({ columns: [t.revisionId, t.dlcId] }),
    fk("event_revision_dlc_revision_fk", t.revisionId, eventRevisionDetails.revisionId),
    foreignKey({
      name: "event_revision_dlc_catalog_fk",
      columns: [t.dlcId, t.game],
      foreignColumns: [catalogDlcs.id, catalogDlcs.game],
    }).onDelete("restrict"),
  ],
);

// The collection version is independent of the definition and survives
// publication under the same event ID.
export const eventMedia = mysqlTable(
  "event_media",
  {
    id: idColumn("id").primaryKey(),
    eventId: idColumn("event_id").notNull(),
    uploaderId: idColumn("uploader_id").notNull(),
    uploadKey: idColumn("upload_key").notNull(),
    state: mysqlEnum("state", ["processing", "ready", "rejected", "deleting", "deleted"]).notNull(),
    generation: idColumn("generation").notNull(),
    originalName: varchar("original_name", { length: 256 }).notNull(),
    contentType: mysqlEnum("content_type", ["image/png", "image/jpeg"]).notNull(),
    byteLength: int("byte_length", { unsigned: true }).notNull().default(0),
    width: int("width", { unsigned: true }),
    height: int("height", { unsigned: true }),
    sha256: opaqueColumn("sha256", { length: 32 }),
    fingerprint: opaqueColumn("fingerprint", { length: 32 }),
    caption: varchar("caption", { length: 2048 }),
    position: int("position", { unsigned: true }),
    isCover: boolean("is_cover").notNull().default(false),
    coverEventId: idColumn("cover_event_id").generatedAlwaysAs(
      sql`CASE WHEN is_cover THEN event_id ELSE NULL END`,
      { mode: "virtual" },
    ),
    leaseToken: idColumn("lease_token"),
    leaseUntil: utcColumn("lease_until"),
    nextCheckAt: utcColumn("next_check_at").notNull(),
    createdAt: utcColumn("created_at").notNull(),
    updatedAt: utcColumn("updated_at").notNull(),
    deletedAt: utcColumn("deleted_at"),
  },
  (t) => [
    fk("event_media_event_fk", t.eventId, eventMetadata.id),
    fk("event_media_uploader_fk", t.uploaderId, membership.userId),
    uniqueIndex("event_media_upload").on(t.eventId, t.uploaderId, t.uploadKey),
    uniqueIndex("event_media_one_cover").on(t.coverEventId),
    index("event_media_order").on(t.eventId, t.state, t.position, t.id),
    index("event_media_due").on(t.state, t.nextCheckAt, t.id),
    check(
      "event_media_ready_shape",
      sql`${t.state}<>'ready' OR (
      ${t.sha256} IS NOT NULL AND ${t.fingerprint} IS NOT NULL AND ${t.byteLength}>0
      AND ${t.width} IS NOT NULL AND ${t.width}>0 AND ${t.height} IS NOT NULL AND ${t.height}>0
      AND ${t.position} IS NOT NULL)`,
    ),
    check("event_media_cover_ready", sql`NOT ${t.isCover} OR ${t.state}='ready'`),
    check("event_media_position_range", sql`${t.position} IS NULL OR ${t.position}<10`),
  ],
);

// Record each candidate generation before filesystem I/O so interrupted and
// superseded attempts can be reconciled under their original generation.
export const eventMediaGenerations = mysqlTable(
  "event_media_generations",
  {
    mediaId: idColumn("media_id").notNull(),
    generation: idColumn("generation").notNull(),
    state: mysqlEnum("state", ["tracked", "deleting"]).notNull().default("tracked"),
    createdAt: utcColumn("created_at").notNull(),
    updatedAt: utcColumn("updated_at").notNull(),
    leaseUntil: utcColumn("lease_until").notNull(),
    nextCheckAt: utcColumn("next_check_at").notNull(),
    deleteAttempt: int("delete_attempt", { unsigned: true }).notNull().default(0),
    deletionJobId: idColumn("deletion_job_id"),
  },
  (t) => [
    primaryKey({ columns: [t.mediaId, t.generation] }),
    fk("event_media_generation_media_fk", t.mediaId, eventMedia.id),
    index("event_media_generation_due").on(t.state, t.nextCheckAt, t.mediaId, t.generation),
  ],
);

export const eventStage2Commands = mysqlTable(
  "event_stage2_commands",
  {
    actorId: idColumn("actor_id").notNull(),
    route: mysqlEnum("route", [
      "draft_create",
      "draft_update",
      "draft_delete",
      "publish",
      "media_edit",
      "media_delete",
    ]).notNull(),
    targetId: idColumn("target_id").notNull(),
    key: idColumn("key").notNull(),
    fingerprint: opaqueColumn("fingerprint", { length: 32 }).notNull(),
    result: json("result")
      .$type<{ eventId: string; version: number; revisionId?: string }>()
      .notNull(),
    recordedAt: utcColumn("recorded_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.actorId, t.route, t.targetId, t.key] }),
    fk("event_stage2_command_actor_fk", t.actorId, membership.userId),
  ],
);
