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

const retired = [
  "qualification_initial_assignments",
  "qualification_ladder_history",
  "qualification_promotion_reviews",
  "qualification_promotions",
  "qualification_rule_versions",
  "qualification_states",
];
/** Simplified levels with separate legacy and semantic trailer joins; retired references are gone. */
const expectThreeTableModel = async () => {
  expect(
    (
      await rows(
        "SELECT TABLE_NAME t FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME LIKE 'qualification%' ORDER BY 1",
      )
    ).map((r) => r.t),
  ).toEqual([
    "qualification_assignments",
    "qualification_level_trailer_types",
    "qualification_level_trailers",
    "qualification_levels",
  ]);
  expect(
    await rows(
      `SELECT TABLE_NAME t FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${retired.map((name) => `'${name}'`).join(",")})`,
    ),
  ).toEqual([]);
  expect(
    await rows(
      "SELECT TABLE_NAME t, COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND COLUMN_NAME='rule_version_id'",
    ),
  ).toEqual([]);
};

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
  "the old qualification model upgrades to the three-table model, the end state of a fresh migration",
  async () => {
    // Fictional old-model rows: an archived level, rule versions, promotion proof and review,
    // an orphan open assignment, a decided and credited trip that name a rule version, and
    // outbox, routing, durable job, receipt and notification rows of retired and kept types.
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
      `INSERT INTO trips (id,owner_id,game,version,outcome,recording,decision,reporting_at,actual_distance_m,review_reasons,created_at) VALUES ('${id(60)}','${id(1)}','ets2',1,'delivered','complete','accepted','2026-01-10 03:00:00.000','12500',JSON_ARRAY(),'2026-01-10 00:00:00.000')`,
      `INSERT INTO source_trips (id,provider,game,session_key,trip_key,owner_id,canonical_trip_id,latest_revision,connection_context,created_at) VALUES ('${id(61)}','ets2telemetry','ets2','fictional-session','fictional-trip','${id(1)}','${id(60)}','1',JSON_OBJECT(),'2026-01-10 00:00:00.000')`,
      `INSERT INTO source_messages (id,source_trip_id,provider,event_key,revision,sha256,received_at,delivery_mode) VALUES ('${id(62)}','${id(61)}','ets2telemetry','fictional-event','1',REPEAT('c',32),'2026-01-10 03:00:00.000','live')`,
      `INSERT INTO trip_facts (id,message_id,canonical_trip_id,adapter_version,outcome,recording,start_basis,start_verified,end_basis,end_verified,whole_trip_distance_supported,trailers_complete,trailer_count,rule_context_complete,reasons,evidence) VALUES ('${id(63)}','${id(62)}','${id(60)}',1,'delivered','complete','unknown',0,'unknown',0,1,1,0,1,JSON_ARRAY(),JSON_OBJECT())`,
      `INSERT INTO trip_decisions (id,trip_id,sequence,fact_id,outcome,reason_codes,assignment_id,level_id,rule_version_id,attribution_at,attribution_basis,supporting_facts,decided_at) VALUES ('${id(64)}','${id(60)}',1,'${id(63)}','accepted',JSON_ARRAY(),'${id(20)}','${l1}','${id(10)}','2026-01-10 00:00:00.000','actual_start',JSON_ARRAY(),'2026-01-10 03:00:00.000')`,
      `INSERT INTO trip_contributions (trip_id,version,owner_id,game,fact_id,accepted,credited,assignment_id,rule_version_id,attribution_basis,attribution_at,actual_distance_m,fingerprint,changed_at) VALUES ('${id(60)}',1,'${id(1)}','ets2','${id(63)}',1,1,'${id(20)}','${id(10)}','actual_start','2026-01-10 00:00:00.000','12500',REPEAT('d',32),'2026-01-10 03:00:00.000')`,
      `INSERT INTO outbox_events (id,type,schema_version,aggregate_kind,aggregate_id,aggregate_version,occurred_at,correlation_id,causation_id,data,fingerprint,recorded_at) VALUES
        ('${id(40)}','qualification.progress_changed',1,'qualification','${id(21)}',1,UTC_TIMESTAMP(3),'${id(40)}',NULL,'{}',REPEAT('a',32),UTC_TIMESTAMP(3)),
        ('${id(41)}','qualification.assigned',1,'qualification','${id(21)}',1,UTC_TIMESTAMP(3),'${id(41)}',NULL,'{}',REPEAT('b',32),UTC_TIMESTAMP(3)),
        ('${id(42)}','qualification.rules_changed',1,'qualification','${l1}',1,UTC_TIMESTAMP(3),'${id(42)}',NULL,'{}',REPEAT('e',32),UTC_TIMESTAMP(3)),
        ('${id(43)}','promotion.review_required',1,'qualification','${id(30)}',1,UTC_TIMESTAMP(3),'${id(43)}',NULL,'{}',REPEAT('f',32),UTC_TIMESTAMP(3))`,
      `INSERT INTO outbox_routing (event_id,consumer,event_type,recorded_at) VALUES
        ('${id(40)}','notifications','qualification.progress_changed',UTC_TIMESTAMP(3)),
        ('${id(41)}','notifications','qualification.assigned',UTC_TIMESTAMP(3))`,
      `INSERT INTO durable_jobs (id,kind,schema_version,consumer,effect_key,event_id,reference,fingerprint,state,available_at,attempts,max_attempts,created_at,completed_at) VALUES
        ('${id(70)}','notification.deliver',1,'notifications','fictional-retired-1','${id(40)}',JSON_OBJECT(),REPEAT('g',32),'completed',UTC_TIMESTAMP(3),1,5,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)),
        ('${id(71)}','notification.deliver',1,'notifications','fictional-kept','${id(41)}',JSON_OBJECT(),REPEAT('h',32),'completed',UTC_TIMESTAMP(3),1,5,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)),
        ('${id(72)}','notification.deliver',1,'notifications','fictional-retired-2','${id(43)}',JSON_OBJECT(),REPEAT('i',32),'ready',UTC_TIMESTAMP(3),0,5,UTC_TIMESTAMP(3),NULL)`,
      `INSERT INTO job_effect_receipts (consumer,effect_key,job_id,committed_at) VALUES
        ('notifications','fictional-retired-1','${id(70)}',UTC_TIMESTAMP(3)),
        ('notifications','fictional-kept','${id(71)}',UTC_TIMESTAMP(3))`,
      `INSERT INTO notification_recipients (recipient_id) VALUES ('${id(1)}')`,
      `INSERT INTO notifications (id,recipient_id,sequence,effect_key,category,access,subject_kind,subject_id,subject_version,occurred_at,recipient_access_epoch) VALUES
        ('${id(50)}','${id(1)}',1,'fictional-e1','promotion.eligible','company','qualification','${id(21)}',1,UTC_TIMESTAMP(3),1),
        ('${id(51)}','${id(1)}',2,'fictional-e2','qualification.promoted','company','qualification','${id(21)}',1,UTC_TIMESTAMP(3),1),
        ('${id(52)}','${id(1)}',3,'fictional-e3','promotion.review_required','company','qualification','${id(30)}',1,UTC_TIMESTAMP(3),1)`,
    ];
    for (const statement of seed) await control.query(statement);
    expect(await runMigrations(settings)).toBe(5);
    expect(await runMigrations(settings)).toBe(0);

    await expectThreeTableModel();
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
    // Only the retired event types lose their routing, jobs and receipts.
    const ids = async (sql: string) => (await rows(sql)).map((r) => r.id);
    expect(await ids("SELECT CAST(event_id AS CHAR) id FROM outbox_routing ORDER BY 1")).toEqual([
      id(41),
    ]);
    expect(await ids("SELECT CAST(id AS CHAR) id FROM durable_jobs ORDER BY 1")).toEqual([id(71)]);
    expect(await ids("SELECT CAST(job_id AS CHAR) id FROM job_effect_receipts ORDER BY 1")).toEqual(
      [id(71)],
    );
    expect(
      (await rows("SELECT category FROM notifications ORDER BY 1")).map((r) => r.category),
    ).toEqual(["qualification.promoted"]);
    // The decision and the credit stay without their rule version reference. An upgraded
    // decision has no snapshot, so reads fall back to the level's current limits.
    expect(
      await rows(
        "SELECT CAST(id AS CHAR) id, CAST(level_id AS CHAR) level, CAST(assignment_id AS CHAR) assignment, qualification_snapshot snapshot FROM trip_decisions",
      ),
    ).toEqual([{ id: id(64), level: l1, assignment: id(20), snapshot: null }]);
    expect(
      await rows(
        "SELECT CAST(trip_id AS CHAR) id, credited, CAST(assignment_id AS CHAR) assignment, CAST(actual_distance_m AS CHAR) distance FROM trip_contributions",
      ),
    ).toEqual([
      { id: id(60), credited: 1, assignment: id(20), distance: "12500.000000000000000000" },
    ]);

    const upgraded = await schema();
    // A fresh migration reaches the same model: the three tables, no old tables, the same shape
    // and the structural levels in order.
    await reset(control);
    expect(await runMigrations(settings)).toBe(40);
    await expectThreeTableModel();
    expect(await schema()).toEqual(upgraded);
    expect(
      (
        await rows(
          "SELECT CAST(id AS CHAR) id FROM qualification_levels WHERE game='ets2' AND deleted_at IS NULL ORDER BY position",
        )
      ).map((r) => r.id),
    ).toEqual([...structuralLevels.ets2]);
    expect(await rows("SELECT id FROM qualification_assignments")).toEqual([]);
  },
  SCHEMA_SETUP_TIMEOUT_MS,
);
