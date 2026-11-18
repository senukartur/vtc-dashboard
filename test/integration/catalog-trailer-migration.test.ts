import { randomBytes } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createUnitOfWork, migrationFolder, newId, runMigrations } from "@vtc/db";
import type { RowDataPacket } from "mysql2/promise";
import { expect, test } from "vitest";
import { createIdentity } from "../../apps/api/src/modules/identity/service.ts";
import { identityAccessEvents } from "../../apps/api/src/platform/outbox/events.ts";
import {
  companionPriorFolder,
  guardedSettings,
  reset,
  testConnection,
  trailerGroupingPriorFolder,
  trailerTypesPriorFolder,
} from "../persistence/support.ts";

test("type migration preserves exact body identities and legacy allowances without guessing classifications", async () => {
  const control = await testConnection(),
    settings = guardedSettings(),
    folder = await trailerTypesPriorFolder();
  try {
    await reset(control);
    expect(await runMigrations(settings, { folder })).toBe(37);
    const id = newId();
    await control.execute(
      "INSERT INTO catalog_trailers(id,game,code,name_en,common_trailer) VALUES (?,'ets2',?,'Fictional seasonal body',?)",
      [id, Buffer.from("_fiction_curt_01"), Buffer.from("fictional.model")],
    );
    await control.execute(
      "UPDATE qualification_levels SET trailer_mode='selected' WHERE id='02800000-0000-4000-8000-000000000001'",
    );
    await control.execute(
      "INSERT INTO qualification_level_trailers(level_id,game,trailer_id) VALUES ('02800000-0000-4000-8000-000000000001','ets2',?)",
      [id],
    );
    expect(await runMigrations(settings)).toBe(2);
    expect(await runMigrations(settings)).toBe(0);
    const [rows] = await control.query<RowDataPacket[]>(
      "SELECT CAST(t.id AS CHAR) id,HEX(t.code) code,CAST(t.common_trailer AS CHAR) model,t.trailer_type_id,l.trailer_basis FROM catalog_trailers t JOIN qualification_level_trailers q ON q.trailer_id=t.id JOIN qualification_levels l ON l.id=q.level_id",
    );
    expect(rows).toMatchObject([
      {
        id,
        code: Buffer.from("_fiction_curt_01").toString("hex").toUpperCase(),
        model: "fictional.model",
        trailer_type_id: null,
        trailer_basis: "variant",
      },
    ]);
    const [types] = await control.query<RowDataPacket[]>(
      "SELECT COUNT(*) n FROM catalog_trailer_types",
    );
    expect(Number(types[0]?.n)).toBe(43);
  } finally {
    await control.end();
    await rm(folder, { recursive: true });
  }
}, 180000);

test("interrupted trailer grouping DDL preserves body rows and requires recovery before replay", async () => {
  const control = await testConnection(),
    settings = guardedSettings();
  const folder = await trailerGroupingPriorFolder();
  try {
    await reset(control);
    expect(await runMigrations(settings, { folder })).toBe(36);
    const id = newId();
    await control.execute(
      "INSERT INTO catalog_trailers(id,game,code,name_en) VALUES (?,'ets2',?,'Fictional transporter')",
      [id, Buffer.from("_fiction_body")],
    );
    const journal = JSON.parse(await readFile(join(migrationFolder, "meta/_journal.json"), "utf8"));
    journal.entries = journal.entries.slice(0, 37);
    const entry = journal.entries.at(-1);
    expect(entry.tag).toBe("0036_trailer_groups");
    const sql = await readFile(join(migrationFolder, `${entry.tag}.sql`), "utf8");
    const first = sql.split("--> statement-breakpoint")[0];
    await writeFile(
      join(folder, `${entry.tag}.sql`),
      `${first}--> statement-breakpoint\nSELECT * FROM fictional_missing_grouping_table;`,
    );
    await writeFile(join(folder, "meta/_journal.json"), JSON.stringify(journal));
    await expect(runMigrations(settings, { folder })).rejects.toMatchObject({
      code: "ER_NO_SUCH_TABLE",
    });
    const [rows] = await control.query<RowDataPacket[]>(
      "SELECT CAST(id AS CHAR) id,HEX(code) code,common_trailer FROM catalog_trailers",
    );
    expect(rows).toMatchObject([
      {
        id,
        code: Buffer.from("_fiction_body").toString("hex").toUpperCase(),
        common_trailer: null,
      },
    ]);
    await expect(runMigrations(settings, { folder, lockTimeoutSeconds: 0 })).rejects.toThrow(
      "MIGRATION_RECOVERY_REQUIRED",
    );
    // Only this disposable allocation is reset to its known empty baseline.
    await reset(control);
    expect(await runMigrations(settings)).toBe(39);
    expect(await runMigrations(settings)).toBe(0);
  } finally {
    await control.end();
    await rm(folder, { recursive: true });
  }
}, 180000);

test("exact 38-migration base upgrades once to companion without changing taxonomy, legacy selections, assignments or retained decisions", async () => {
  const control = await testConnection(),
    settings = guardedSettings(),
    folder = await companionPriorFolder(),
    unit = createUnitOfWork(settings);
  try {
    await reset(control);
    expect(await runMigrations(settings, { folder })).toBe(38);
    const identity = createIdentity(
      unit,
      {
        secret: randomBytes(32).toString("hex"),
        origin: "http://127.0.0.1:4173",
        production: false,
      },
      { accessEvents: identityAccessEvents(unit) },
    );
    await identity.bootstrap({
      email: "companion-prefix@example.invalid",
      name: "Fictional Prefix Director",
      password: "Fictional-prefix-passphrase-42",
    });
    const [users] = await control.query<RowDataPacket[]>(
        "SELECT CAST(user_id AS CHAR) id FROM identity_memberships LIMIT 1",
      ),
      owner = users[0]!.id;
    const [companies] = await control.query<RowDataPacket[]>(
      "SELECT CAST(id AS CHAR) id FROM identity_company LIMIT 1",
    );
    const [types] = await control.query<RowDataPacket[]>(
        "SELECT CAST(id AS CHAR) id FROM catalog_trailer_types WHERE game='ets2' AND code='dryvan'",
      ),
      type = types[0]!.id;
    const variant = newId(),
      assignment = newId(),
      trip = newId(),
      source = newId(),
      message = newId(),
      fact = newId(),
      decision = newId(),
      token = newId(),
      level = "02800000-0000-4000-8000-000000000001",
      typedLevel = "02800000-0000-4000-8000-000000000002";
    await control.execute(
      "INSERT INTO catalog_trailers(id,game,code,name_en,common_trailer,trailer_type_id) VALUES (?,'ets2',?,'Fictional published body',?,?)",
      [variant, Buffer.from("fictional_prefix_body"), Buffer.from("fictional.prefix.model"), type],
    );
    await control.execute("UPDATE qualification_levels SET trailer_mode='selected' WHERE id=?", [
      level,
    ]);
    await control.execute(
      "INSERT INTO qualification_level_trailers(level_id,game,trailer_id) VALUES (?,'ets2',?)",
      [level, variant],
    );
    await control.execute(
      "UPDATE qualification_levels SET trailer_mode='selected',trailer_basis='type' WHERE id=?",
      [typedLevel],
    );
    await control.execute(
      "INSERT INTO qualification_level_trailer_types(level_id,game,trailer_id) VALUES (?,'ets2',?)",
      [typedLevel, type],
    );
    await control.execute(
      "INSERT INTO qualification_assignments(id,user_id,game,level_id,assigned_at,kind,comment) VALUES (?,?,'ets2',?,'2026-01-01 00:00:00.000','admission','Fictional published assignment')",
      [assignment, owner, level],
    );
    await control.execute(
      "INSERT INTO trips(id,owner_id,game,version,outcome,recording,decision,reporting_at,actual_distance_m,review_reasons,created_at) VALUES (?,?,'ets2',1,'delivered','complete','accepted','2026-01-10 03:00:00.000','12500',JSON_ARRAY(),'2026-01-10 00:00:00.000')",
      [trip, owner],
    );
    await control.execute(
      "INSERT INTO source_trips(id,provider,game,session_key,trip_key,owner_id,canonical_trip_id,latest_revision,connection_context,created_at) VALUES (?,'ets2telemetry','ets2','fictional-session','fictional-trip',?,?,'1',JSON_OBJECT(),'2026-01-10 00:00:00.000')",
      [source, owner, trip],
    );
    await control.execute(
      "INSERT INTO source_messages(id,source_trip_id,provider,event_key,revision,sha256,received_at,delivery_mode) VALUES (?,?,'ets2telemetry','fictional-event','1',REPEAT('c',32),'2026-01-10 03:00:00.000','live')",
      [message, source],
    );
    await control.execute(
      "INSERT INTO trip_facts(id,message_id,canonical_trip_id,adapter_version,outcome,recording,start_basis,start_verified,end_basis,end_verified,whole_trip_distance_supported,trailers_complete,trailer_count,rule_context_complete,reasons,evidence) VALUES (?,?,?,1,'delivered','complete','unknown',0,'unknown',0,1,1,0,1,JSON_ARRAY(),JSON_OBJECT())",
      [fact, message, trip],
    );
    const snapshot = {
      levelId: level,
      levelName: "Fictional retained level",
      editVersion: 1,
      limits: {
        massMinKg: null,
        massMaxKg: null,
        distanceMinM: null,
        distanceMaxM: null,
        trailers: { mode: "selected", typeIds: [variant] },
        adr: { mode: "any", classes: [] },
        hardModeRequired: false,
      },
      trailerGroups: {
        [variant]: `common:ets2:${Buffer.from("fictional.prefix.model").toString("hex")}`,
      },
      eventExempt: false,
      outcome: "pass",
      reasonCode: null,
      rules: [],
    };
    await control.execute(
      "INSERT INTO trip_decisions(id,trip_id,sequence,fact_id,outcome,reason_codes,assignment_id,level_id,attribution_at,attribution_basis,supporting_facts,decided_at,qualification_snapshot) VALUES (?,?,1,?,'accepted',JSON_ARRAY(),?,?,'2026-01-10 00:00:00.000','actual_start',JSON_ARRAY(),'2026-01-10 03:00:00.000',?)",
      [decision, trip, fact, assignment, level, JSON.stringify(snapshot)],
    );
    await control.execute("UPDATE trips SET current_fact_id=? WHERE id=?", [fact, trip]);
    await control.execute(
      "INSERT INTO trip_contributions(trip_id,version,owner_id,game,fact_id,accepted,credited,assignment_id,attribution_basis,attribution_at,actual_distance_m,fingerprint,changed_at) VALUES (?,1,?,'ets2',?,1,1,?,'actual_start','2026-01-10 00:00:00.000','12500',REPEAT('d',32),'2026-01-10 03:00:00.000')",
      [trip, owner, fact, assignment],
    );
    await control.execute(
      "INSERT INTO telemetry_tokens(id,owner_id,company_id,steam_id,access_epoch,identity_epoch,credential_epoch,secret_hash,scope,label,created_at) VALUES (?,?,?,?,1,1,1,?,'ingest','Fictional old recorder',UTC_TIMESTAMP(3))",
      [token, owner, companies[0]!.id, Buffer.from("76561190000000001"), Buffer.alloc(32, 42)],
    );
    const preserved = async () => {
      const statements = [
        "SELECT * FROM catalog_trailer_types ORDER BY id",
        "SELECT * FROM catalog_trailers ORDER BY id",
        "SELECT * FROM qualification_level_trailers ORDER BY level_id,trailer_id",
        "SELECT * FROM qualification_level_trailer_types ORDER BY level_id,trailer_id",
        "SELECT * FROM qualification_assignments ORDER BY id",
        "SELECT * FROM trip_decisions ORDER BY id",
        "SELECT * FROM trip_contributions ORDER BY trip_id",
        "SELECT id,secret_hash,scope FROM telemetry_tokens ORDER BY id",
      ];
      return Promise.all(
        statements.map(async (sql) => (await control.query<RowDataPacket[]>(sql))[0]),
      );
    };
    const before = await preserved(),
      [prefix] = await control.query<RowDataPacket[]>(
        "SELECT version,hash,state FROM _vtc_migrations ORDER BY version",
      );
    expect(prefix).toHaveLength(38);
    expect(await runMigrations(settings)).toBe(1);
    expect(await runMigrations(settings)).toBe(0);
    expect(await preserved()).toEqual(before);
    const [after] = await control.query<RowDataPacket[]>(
      "SELECT version,hash,state FROM _vtc_migrations ORDER BY version LIMIT 38",
    );
    expect(after).toEqual(prefix);
    const [grant] = await control.execute<RowDataPacket[]>(
      "SELECT companion FROM telemetry_tokens WHERE id=?",
      [token],
    );
    expect(Number(grant[0]!.companion)).toBe(0);
    const [revisions] = await control.query<RowDataPacket[]>(
      "SELECT COUNT(*) n FROM trip_owner_revisions",
    );
    expect(Number(revisions[0]!.n)).toBe(0);
  } finally {
    await unit.close();
    await control.end();
    await rm(folder, { recursive: true });
  }
}, 180000);
