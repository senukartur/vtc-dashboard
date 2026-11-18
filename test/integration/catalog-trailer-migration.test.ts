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
} from "../persistence/support.ts";

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
    journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx <= 36);
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
    expect(await runMigrations(settings)).toBe(38);
    expect(await runMigrations(settings)).toBe(0);
  } finally {
    await control.end();
    await rm(folder, { recursive: true });
  }
}, 180000);
