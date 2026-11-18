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
  tinyint,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { decimalColumn, idColumn, utcColumn } from "../../core/values.js";
import { catalogTrailers, catalogTrailerTypes } from "../catalogs/index.js";
import { membership } from "../identity/index.js";

export {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";

export { alias } from "drizzle-orm/mysql-core";

const fk = (name: string, column: AnyMySqlColumn, target: AnyMySqlColumn) =>
  foreignKey({ name, columns: [column], foreignColumns: [target] }).onDelete("restrict");
const game = (name: string) => mysqlEnum(name, ["ets2", "ats"]);
export const maxQualificationLevels = 25;
export const qualificationAdrClasses = ["1", "2", "3", "4", "6", "8"] as const;
// One row per level of a game's ladder. position is null exactly when the level is deleted.
export const qualificationLevels = mysqlTable(
  "qualification_levels",
  {
    id: idColumn("id").primaryKey(),
    game: game("game").notNull(),
    name: varchar("name", { length: 128 }).notNull(),
    version: int("version", { unsigned: true }).notNull(),
    position: int("position", { unsigned: true }),
    massMinKg: decimalColumn("mass_min_kg"),
    massMaxKg: decimalColumn("mass_max_kg"),
    distanceMinM: decimalColumn("distance_min_m"),
    distanceMaxM: decimalColumn("distance_max_m"),
    trailerMode: mysqlEnum("trailer_mode", ["any", "selected"]).notNull().default("any"),
    trailerBasis: mysqlEnum("trailer_basis", ["variant", "type"]).notNull().default("variant"),
    adrMode: mysqlEnum("adr_mode", ["forbidden", "selected", "any"]).notNull().default("any"),
    adrClasses: json("adr_classes").$type<string[]>(),
    hardModeRequired: boolean("hard_mode_required").notNull().default(false),
    requiredTrips: int("required_trips", { unsigned: true }),
    requiredDistanceM: decimalColumn("required_distance_m"),
    deletedAt: utcColumn("deleted_at"),
  },
  (t) => [
    uniqueIndex("qualification_level_position").on(t.game, t.position),
    uniqueIndex("qualification_level_id_game").on(t.id, t.game),
    check("qual_level_version_positive", sql`${t.version} > 0`),
    check(
      "qual_level_position_bounds",
      sql`${t.position} IS NULL OR ${t.position} BETWEEN 1 AND ${sql.raw(String(maxQualificationLevels))}`,
    ),
    check("qual_level_deleted", sql`(${t.position} IS NULL) = (${t.deletedAt} IS NOT NULL)`),
    check(
      "qual_level_mass_range",
      sql`${t.massMinKg} IS NULL OR ${t.massMaxKg} IS NULL OR ${t.massMinKg} <= ${t.massMaxKg}`,
    ),
    check(
      "qual_level_distance_range",
      sql`${t.distanceMinM} IS NULL OR ${t.distanceMaxM} IS NULL OR ${t.distanceMinM} <= ${t.distanceMaxM}`,
    ),
    check(
      "qual_level_adr_classes",
      sql`(${t.adrMode} = 'selected') = (${t.adrClasses} IS NOT NULL)`,
    ),
    check("qual_level_required_trips", sql`${t.requiredTrips} IS NULL OR ${t.requiredTrips} > 0`),
    check(
      "qual_level_required_distance",
      sql`${t.requiredDistanceM} IS NULL OR ${t.requiredDistanceM} > 0`,
    ),
  ],
);
// Allowed trailer types of a level whose trailer mode is selected.
export const qualificationLevelTrailers = mysqlTable(
  "qualification_level_trailers",
  {
    levelId: idColumn("level_id").notNull(),
    game: game("game").notNull(),
    trailerId: idColumn("trailer_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.levelId, t.trailerId] }),
    foreignKey({
      name: "qual_level_trailer_level_fk",
      columns: [t.levelId, t.game],
      foreignColumns: [qualificationLevels.id, qualificationLevels.game],
    }).onDelete("cascade"),
    foreignKey({
      name: "qual_level_trailer_catalog_fk",
      columns: [t.trailerId, t.game],
      foreignColumns: [catalogTrailers.id, catalogTrailers.game],
    }).onDelete("restrict"),
  ],
);
export const qualificationLevelTrailerTypes = mysqlTable(
  "qualification_level_trailer_types",
  {
    levelId: idColumn("level_id").notNull(),
    game: game("game").notNull(),
    trailerId: idColumn("trailer_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.levelId, t.trailerId] }),
    foreignKey({
      name: "qual_level_type_level_fk",
      columns: [t.levelId, t.game],
      foreignColumns: [qualificationLevels.id, qualificationLevels.game],
    }).onDelete("cascade"),
    foreignKey({
      name: "qual_level_type_catalog_fk",
      columns: [t.trailerId, t.game],
      foreignColumns: [catalogTrailerTypes.id, catalogTrailerTypes.game],
    }).onDelete("restrict"),
  ],
);
export const qualificationAssignmentKinds = [
  "admission",
  "promotion",
  "manual",
  "level_removed",
  "reinstatement",
] as const;
// A member's level interval in one game; the open row (ended_at null) is the current level.
export const qualificationAssignments = mysqlTable(
  "qualification_assignments",
  {
    id: idColumn("id").primaryKey(),
    userId: idColumn("user_id").notNull(),
    game: game("game").notNull(),
    levelId: idColumn("level_id").notNull(),
    assignedAt: utcColumn("assigned_at").notNull(),
    endedAt: utcColumn("ended_at"),
    kind: mysqlEnum("kind", qualificationAssignmentKinds).notNull(),
    actorId: idColumn("actor_id"),
    comment: varchar("comment", { length: 2048 }),
    previousAssignmentId: idColumn("previous_assignment_id"),
    openMarker: tinyint("open_marker").generatedAlwaysAs(sql`IF(ended_at IS NULL, 1, NULL)`, {
      mode: "stored",
    }),
  },
  (t) => [
    fk("qual_assignment_member_fk", t.userId, membership.userId),
    fk("qual_assignment_actor_fk", t.actorId, membership.userId),
    fk("qual_assignment_level_fk", t.levelId, qualificationLevels.id),
    foreignKey({
      name: "qual_assignment_previous_fk",
      columns: [t.previousAssignmentId],
      foreignColumns: [t.id],
    }).onDelete("restrict"),
    uniqueIndex("qualification_assignment_previous").on(t.previousAssignmentId),
    uniqueIndex("qualification_assignment_open").on(t.userId, t.game, t.openMarker),
    index("qualification_assignment_level_open").on(t.levelId, t.openMarker),
    index("qualification_assignment_history").on(t.userId, t.game, t.assignedAt, t.id),
    check(
      "qualification_period_interval",
      sql`${t.endedAt} IS NULL OR ${t.endedAt} >= ${t.assignedAt}`,
    ),
  ],
);
