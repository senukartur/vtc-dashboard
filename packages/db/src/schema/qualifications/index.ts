import { foreignKey, mysqlEnum, mysqlTable, primaryKey, uniqueIndex } from "drizzle-orm/mysql-core";
import { idColumn, utcColumn } from "../../core/values.js";
import { membership } from "../identity/index.js";
export { eq } from "drizzle-orm";

// VTC-015 onboarding substrate; VTC-028 owns rules, progress and later assignments.
export const initialQualifications = mysqlTable(
  "qualification_initial_assignments",
  {
    id: idColumn("id").notNull(),
    userId: idColumn("user_id").notNull(),
    game: mysqlEnum("game", ["ets2", "ats"]).notNull(),
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
