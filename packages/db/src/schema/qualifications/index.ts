import { sql } from "drizzle-orm";
import {
  type AnyMySqlColumn,
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
import { decimalColumn, idColumn, utcColumn } from "../../core/values.js";
import { membership } from "../identity/index.js";

export { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";

const fk = (name: string, column: AnyMySqlColumn, target: AnyMySqlColumn) =>
  foreignKey({ name, columns: [column], foreignColumns: [target] }).onDelete("restrict");
// Aggregate proofs may exceed one source quantity; preserve the exact widened sum.
const totalDistanceColumn = customType<{ data: string; driverData: string }>({
  dataType: () => "decimal(65,18)",
  toDriver(value) {
    if (!/^(0|[1-9]\d{0,46})(\.\d{1,18})?$/.test(value))
      throw new Error("INVALID_AGGREGATE_DISTANCE");
    return value;
  },
  fromDriver(value) {
    if (!/^(0|[1-9]\d{0,46})(\.\d{1,18})?$/.test(value))
      throw new Error("INVALID_AGGREGATE_DISTANCE");
    return value;
  },
});
const game = (name: string) => mysqlEnum(name, ["ets2", "ats"]);
export const levelCodes = ["trainee", "driver_iii", "driver_ii", "driver_i"] as const;
export const qualificationLevels = mysqlTable(
  "qualification_levels",
  {
    id: idColumn("id").primaryKey(),
    game: game("game").notNull(),
    code: mysqlEnum("code", levelCodes).notNull(),
    name: varchar("name", { length: 128 }).notNull(),
    version: int("version", { unsigned: true }).notNull(),
  },
  (t) => [
    uniqueIndex("qualification_level_code").on(t.game, t.code),
    check("qual_level_version_positive", sql`${t.version} > 0`),
  ],
);
export const qualificationRules = mysqlTable(
  "qualification_rule_versions",
  {
    id: idColumn("id").primaryKey(),
    levelId: idColumn("level_id").notNull(),
    publishedAt: utcColumn("published_at").notNull(),
    effectiveAt: utcColumn("effective_at").notNull(),
    rules: json("rules").$type<unknown[]>().notNull(),
    requiredTrips: int("required_trips", { unsigned: true }),
    requiredDistanceM: decimalColumn("required_distance_m"),
    actorId: idColumn("actor_id").notNull(),
    reason: varchar("reason", { length: 2048 }).notNull(),
  },
  (t) => [
    fk("qual_rule_level_fk", t.levelId, qualificationLevels.id),
    fk("qual_rule_actor_fk", t.actorId, membership.userId),
    uniqueIndex("qualification_rule_effective").on(t.levelId, t.effectiveAt),
    check("qual_rule_effective_publication", sql`${t.effectiveAt} >= ${t.publishedAt}`),
    check(
      "qualification_threshold_distance",
      sql`${t.requiredDistanceM} IS NULL OR ${t.requiredDistanceM} >= 0`,
    ),
  ],
);
// Original onboarding evidence is retained unchanged after the additive history backfill.
export const initialQualifications = mysqlTable(
  "qualification_initial_assignments",
  {
    id: idColumn("id").notNull(),
    userId: idColumn("user_id").notNull(),
    game: game("game").notNull(),
    level: mysqlEnum("level", ["trainee"]).notNull(),
    assignedAt: utcColumn("assigned_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.game] }),
    foreignKey({
      name: "qualification_initial_member_fk",
      columns: [t.userId],
      foreignColumns: [membership.userId],
    }).onDelete("restrict"),
    uniqueIndex("qualification_initial_id").on(t.id),
  ],
);
export const qualificationAssignments = mysqlTable(
  "qualification_assignments",
  {
    id: idColumn("id").primaryKey(),
    userId: idColumn("user_id").notNull(),
    game: game("game").notNull(),
    levelId: idColumn("level_id").notNull(),
    assignedAt: utcColumn("assigned_at").notNull(),
    endedAt: utcColumn("ended_at"),
    revision: int("revision", { unsigned: true }).notNull().default(1),
    purpose: mysqlEnum("purpose", [
      "initial",
      "reinstatement",
      "historical_resolution",
      "administrative_correction",
      "promotion",
    ]).notNull(),
    actorId: idColumn("actor_id"),
    reason: varchar("reason", { length: 2048 }).notNull(),
  },
  (t) => [
    fk("qual_assignment_member_fk", t.userId, membership.userId),
    fk("qual_assignment_actor_fk", t.actorId, membership.userId),
    fk("qual_assignment_level_fk", t.levelId, qualificationLevels.id),
    check("qual_assignment_revision_positive", sql`${t.revision} > 0`),
    index("qualification_assignment_history").on(t.userId, t.game, t.assignedAt, t.id),
    check(
      "qualification_period_interval",
      sql`${t.endedAt} IS NULL OR ${t.endedAt} >= ${t.assignedAt}`,
    ),
  ],
);
export const qualificationStates = mysqlTable(
  "qualification_states",
  {
    userId: idColumn("user_id").notNull(),
    game: game("game").notNull(),
    assignmentId: idColumn("assignment_id"),
    version: int("version", { unsigned: true }).notNull(),
  },
  (t) => [
    fk("qual_state_member_fk", t.userId, membership.userId),
    fk("qual_state_assignment_fk", t.assignmentId, qualificationAssignments.id),
    primaryKey({ columns: [t.userId, t.game] }),
    check("qual_state_version_positive", sql`${t.version} > 0`),
  ],
);
export const qualificationPromotions = mysqlTable(
  "qualification_promotions",
  {
    id: idColumn("id").primaryKey(),
    sourceAssignmentId: idColumn("source_assignment_id").notNull(),
    targetAssignmentId: idColumn("target_assignment_id").notNull(),
    ruleVersionId: idColumn("rule_version_id").notNull(),
    requiredTrips: int("required_trips", { unsigned: true }).notNull(),
    requiredDistanceM: decimalColumn("required_distance_m").notNull(),
    acceptedTrips: int("accepted_trips", { unsigned: true }).notNull(),
    actualDistanceM: totalDistanceColumn("actual_distance_m").notNull(),
    periodRevision: int("period_revision", { unsigned: true }).notNull(),
    confirmedAt: utcColumn("confirmed_at").notNull(),
    actorId: idColumn("actor_id").notNull(),
    reason: varchar("reason", { length: 2048 }).notNull(),
  },
  (t) => [
    fk("qual_promotion_source_fk", t.sourceAssignmentId, qualificationAssignments.id),
    fk("qual_promotion_target_fk", t.targetAssignmentId, qualificationAssignments.id),
    fk("qual_promotion_rules_fk", t.ruleVersionId, qualificationRules.id),
    fk("qual_promotion_actor_fk", t.actorId, membership.userId),
    uniqueIndex("qualification_promotion_once").on(t.sourceAssignmentId),
  ],
);
export const promotionReviews = mysqlTable(
  "qualification_promotion_reviews",
  {
    promotionId: idColumn("promotion_id").primaryKey(),
    reviewRequired: boolean("review_required").notNull(),
    version: int("version", { unsigned: true }).notNull(),
    checkedRevision: int("checked_revision", { unsigned: true }).notNull(),
    checkedAt: utcColumn("checked_at").notNull(),
  },
  (t) => [
    fk("qual_review_promotion_fk", t.promotionId, qualificationPromotions.id),
    check("qual_review_versions_positive", sql`${t.version} > 0 AND ${t.checkedRevision} > 0`),
  ],
);
