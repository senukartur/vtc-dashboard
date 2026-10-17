import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dedicatedConnection, migrationFolder, settingsFromEnvironment } from "@vtc/db";
import type { Connection, RowDataPacket } from "mysql2/promise";

export const root = fileURLToPath(new URL("../../", import.meta.url));
export const fixtureRoot = join(root, "test/fixtures/persistence");

export function guardedSettings() {
  const settings = settingsFromEnvironment();
  if (
    process.env.NODE_ENV !== "test" ||
    process.env.DB_TEST_RESET_ACK !== "synthetic-only" ||
    !/^vtc_test_[a-z0-9_]{1,40}$/.test(settings.database)
  ) {
    throw new Error("SYNTHETIC_DATABASE_AND_RESET_ACK_REQUIRED");
  }
  return settings;
}

export async function testConnection(): Promise<Connection> {
  const settings = guardedSettings();
  const connection = await dedicatedConnection(settings);
  const [rows] = await connection.query<RowDataPacket[]>("SELECT DATABASE() AS name");
  assert.equal(rows[0]?.name, settings.database);
  return connection;
}

export async function reset(connection: Connection) {
  // Fixed fixture-owned tables only; no arbitrary identifiers, schema drops or FK disabling.
  for (const name of [
    "synthetic_values",
    "synthetic_parent",
    "audit_entries",
    "synthetic_recovery_kept",
    "synthetic_recovery_missing",
    "_vtc_migrations",
  ]) {
    await connection.query(`DROP TABLE IF EXISTS ${name}`);
  }
}

interface Journal {
  entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[];
  version: string;
  dialect: string;
}

export async function extendedFixtureFolder(): Promise<string> {
  await mkdir(join(root, ".local"), { recursive: true });
  const folder = await mkdtemp(join(root, ".local/persistence-"));
  await mkdir(join(folder, "meta"));
  const priorFolder = join(fixtureRoot, "prior");
  const prior = JSON.parse(
    await readFile(join(priorFolder, "meta/_journal.json"), "utf8"),
  ) as Journal;
  const production = JSON.parse(
    await readFile(join(migrationFolder, "meta/_journal.json"), "utf8"),
  ) as Journal;
  for (const [directory, journal] of [
    [priorFolder, prior],
    [migrationFolder, production],
  ] as const) {
    for (const entry of journal.entries)
      await copyFile(join(directory, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  }
  await writeFile(
    join(folder, "meta/_journal.json"),
    JSON.stringify({
      ...production,
      entries: [...prior.entries, ...production.entries].map((entry, idx) => ({ ...entry, idx })),
    }),
  );
  return folder;
}

export function hasCode(code: string) {
  return (error: unknown): boolean => {
    let current = error;
    for (let depth = 0; current && typeof current === "object" && depth < 5; depth++) {
      if ("code" in current && current.code === code) return true;
      current = "cause" in current ? current.cause : null;
    }
    return false;
  };
}

export function hasMessage(message: string) {
  return (error: unknown): boolean => {
    let current = error;
    for (let depth = 0; current instanceof Error && depth < 5; depth++) {
      if (current.message.includes(message)) return true;
      current = current.cause;
    }
    return false;
  };
}
