import { rm } from "node:fs/promises";
import { runMigrations } from "@vtc/db";
import type { RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, expect, test } from "vitest";
import { structuralLevels } from "../../apps/api/src/modules/qualifications/initialization.ts";
import {
  guardedSettings,
  reset,
  SCHEMA_SETUP_TIMEOUT_MS,
  simpleQualificationsPriorFolder,
  testConnection,
} from "../persistence/support.ts";

const settings = guardedSettings();
let control: Awaited<ReturnType<typeof testConnection>>;
const prefix = simpleQualificationsPriorFolder();
const id = (n: number) => `0a157000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [l1, l2] = structuralLevels.ets2;
const rows = async (sql: string) => (await control.query<RowDataPacket[]>(sql))[0];
const scope =
  "TABLE_SCHEMA=DATABASE() AND (TABLE_NAME LIKE 'qualification%' OR TABLE_NAME IN ('trip_decisions','trip_contributions'))";
const schema = async () => ({
  tables: await rows(
    "SELECT TABLE_NAME t FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME LIKE 'qualification%' ORDER BY 1",
  ),
  columns: await rows(
    `SELECT TABLE_NAME t, COLUMN_NAME c, COLUMN_TYPE ty, IS_NULLABLE n, COLUMN_DEFAULT d, EXTRA e, GENERATION_EXPRESSION g FROM information_schema.COLUMNS WHERE ${scope} ORDER BY 1,2`,
  ),
  constraints: await rows(
    `SELECT TABLE_NAME t, CONSTRAINT_NAME c, CONSTRAINT_TYPE ty FROM information_schema.TABLE_CONSTRAINTS WHERE ${scope} ORDER BY 1,2`,
  ),
  indexes: await rows(
    `SELECT TABLE_NAME t, INDEX_NAME i, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) c, MIN(NON_UNIQUE) nu FROM information_schema.STATISTICS WHERE ${scope} GROUP BY 1,2 ORDER BY 1,2`,
  ),
});

beforeAll(async () => {
  control = await testConnection();
  await reset(control);
  expect(await runMigrations(settings, { folder: await prefix })).toBe(35);
}, SCHEMA_SETUP_TIMEOUT_MS);
afterAll(async () => {
  await control?.end();
  await rm(await prefix, { recursive: true, force: true });
});

test(
  "the old qualification model upgrades to the three-table model and matches a fresh schema",
  async () => {
    // Fictional old-model rows: an archived level, rule versions, promotion proof and review,
    // an orphan open assignment, and outbox and notification rows of the retired types.
    const seed = [
      `INSERT INTO identity_users (id,name,email,created_at,updated_at) VALUES ('${id(1)}','Fictional One','fictional-one@example.invalid',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)),('${id(2)}','Fictional Two','fictional-two@example.invalid',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
      `INSERT INTO identity_memberships (user_id,status) VALUES ('${id(1)}','active'),('${id(2)}','active')`,
      `INSERT INTO qualification_levels (id,game,code,name,version,active_position) VALUES ('${id(9)}','ets2',NULL,'Fictional Archived',2,NULL)`,
      `INSERT INTO qualification_rule_versions (id,level_id,published_at,effective_at,rules,required_trips,required_distance_m,actor_id,reason) VALUES ('${id(10)}','${l1}','2026-01-01 00:00:00.000','2026-01-01 00:00:00.000','[]',5,NULL,'${id(2)}','Fictional rules')`,
      `INSERT INTO qualification_assignments (id,user_id,game,level_id,assigned_at,ended_at,purpose,actor_id,reason) VALUES
        ('${id(20)}','${id(1)}','ets2','${l1}','2026-01-02 00:00:00.000','2026-02-01 00:00:00.000','initial',NULL,'Admission initial assignment'),
        ('${id(21)}','${id(1)}','ets2','${l2}','2026-02-01 00:00:00.000',NULL,'promotion','${id(2)}','Fictional promotion'),
        ('${id(22)}','${id(1)}','ets2','${l1}','2026-01-05 00:00:00.000',NULL,'historical_resolution','${id(2)}','Fictional orphan'),
        ('${id(23)}','${id(2)}','ets2','${id(9)}','2026-01-03 00:00:00.000','2026-01-04 00:00:00.000','administrative_correction','${id(2)}','Fictional correction'),
        ('${id(24)}','${id(2)}','ets2','${l1}','2026-01-04 00:00:00.000',NULL,'ladder_archive_transfer','${id(2)}','Fictional transfer')`,
      `INSERT INTO qualification_states (user_id,game,assignment_id,version) VALUES ('${id(1)}','ets2','${id(21)}',3),('${id(2)}','ets2','${id(24)}',2)`,
      `INSERT INTO qualification_promotions (id,source_assignment_id,target_assignment_id,rule_version_id,required_trips,required_distance_m,accepted_trips,actual_distance_m,period_revision,confirmed_at,actor_id,reason) VALUES ('${id(30)}','${id(20)}','${id(21)}','${id(10)}',5,NULL,5,'1000',1,'2026-02-01 00:00:00.000','${id(2)}','Fictional proof')`,
      `INSERT INTO qualification_promotion_reviews (promotion_id,review_required,version,checked_revision,checked_at) VALUES ('${id(30)}',1,1,1,'2026-02-02 00:00:00.000')`,
      `INSERT INTO outbox_events (id,type,schema_version,aggregate_kind,aggregate_id,aggregate_version,occurred_at,correlation_id,causation_id,data,fingerprint,recorded_at) VALUES
        ('${id(40)}','qualification.progress_changed',1,'qualification','${id(21)}',1,UTC_TIMESTAMP(3),'${id(40)}',NULL,'{}',REPEAT('a',32),UTC_TIMESTAMP(3)),
        ('${id(41)}','qualification.assigned',1,'qualification','${id(21)}',1,UTC_TIMESTAMP(3),'${id(41)}',NULL,'{}',REPEAT('b',32),UTC_TIMESTAMP(3))`,
      `INSERT INTO outbox_routing (event_id,consumer,event_type,recorded_at) VALUES ('${id(40)}','notifications','qualification.progress_changed',UTC_TIMESTAMP(3))`,
      `INSERT INTO notification_recipients (recipient_id) VALUES ('${id(1)}')`,
      `INSERT INTO notifications (id,recipient_id,sequence,effect_key,category,access,subject_kind,subject_id,subject_version,occurred_at,recipient_access_epoch) VALUES
        ('${id(50)}','${id(1)}',1,'fictional-e1','promotion.eligible','company','qualification','${id(21)}',1,UTC_TIMESTAMP(3),1),
        ('${id(51)}','${id(1)}',2,'fictional-e2','qualification.promoted','company','qualification','${id(21)}',1,UTC_TIMESTAMP(3),1)`,
    ];
    for (const statement of seed) await control.query(statement);
    expect(await runMigrations(settings)).toBe(1);
    expect(await runMigrations(settings)).toBe(0);

    expect(
      (
        await rows(
          `SELECT TABLE_NAME t FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME LIKE 'qualification%' ORDER BY 1`,
        )
      ).map((r) => r.t),
    ).toEqual([
      "qualification_assignments",
      "qualification_level_trailers",
      "qualification_levels",
    ]);
    const levels = await rows(
      "SELECT CAST(id AS CHAR) id, name, position, deleted_at IS NOT NULL deleted FROM qualification_levels WHERE game='ets2' ORDER BY position IS NULL, position",
    );
    expect(levels.map((r) => [r.id, r.position, Number(r.deleted)])).toEqual([
      ...structuralLevels.ets2.map((level, index) => [level, index + 1, 0]),
      [id(9), null, 1],
    ]);
    const assignments = await rows(
      "SELECT CAST(id AS CHAR) id, kind, CAST(assigned_at AS CHAR) assignedAt, CAST(ended_at AS CHAR) endedAt, open_marker, comment FROM qualification_assignments ORDER BY id",
    );
    expect(
      assignments.map((r) => [
        r.id,
        r.kind,
        r.endedAt === null ? "open" : r.endedAt,
        r.open_marker,
      ]),
    ).toEqual([
      [id(20), "admission", "2026-02-01 00:00:00.000", null],
      [id(21), "promotion", "open", 1],
      // The orphan open row without a state is closed at its own start.
      [id(22), "manual", "2026-01-05 00:00:00.000", null],
      [id(23), "manual", "2026-01-04 00:00:00.000", null],
      [id(24), "level_removed", "open", 1],
    ]);
    expect(
      (await rows("SELECT CAST(type AS CHAR) t FROM outbox_events ORDER BY 1")).map((r) => r.t),
    ).toEqual(["qualification.assigned"]);
    expect(Number((await rows("SELECT COUNT(*) n FROM outbox_routing"))[0]?.n)).toBe(0);
    expect(
      (await rows("SELECT category FROM notifications ORDER BY 1")).map((r) => r.category),
    ).toEqual(["qualification.promoted"]);

    const upgraded = await schema();
    await reset(control);
    expect(await runMigrations(settings)).toBe(36);
    expect(await schema()).toEqual(upgraded);
  },
  SCHEMA_SETUP_TIMEOUT_MS,
);
