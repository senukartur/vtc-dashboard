import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { migrationFolder, newId, runMigrations } from "@vtc/db";
import type { RowDataPacket } from "mysql2/promise";
import { expect, test } from "vitest";
import {
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
    expect(await runMigrations(settings)).toBe(1);
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
    expect(await runMigrations(settings)).toBe(38);
    expect(await runMigrations(settings)).toBe(0);
  } finally {
    await control.end();
    await rm(folder, { recursive: true });
  }
}, 180000);
