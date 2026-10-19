import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createDatabase,
  dedicatedConnection,
  migrationFolder,
  settingsFromEnvironment,
} from "@vtc/db";
import type { Connection, RowDataPacket } from "mysql2/promise";
import { guardedAllocation } from "../support/environment.ts";

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
  guardedAllocation();
  return settings;
}

export async function testConnection(): Promise<Connection> {
  const settings = guardedSettings();
  const baseline = createDatabase(settings);
  try {
    if (!(await baseline.check())) throw new Error("TEST_DATABASE_BASELINE_MISMATCH");
  } finally {
    await baseline.close();
  }
  const connection = await dedicatedConnection(settings);
  try {
    const [rows] = await connection.query<RowDataPacket[]>(
      "SELECT DATABASE() AS name, IS_USED_LOCK(?) AS owner",
      [`vtc008:${settings.database}`],
    );
    assert.equal(rows[0]?.name, settings.database);
    assert.equal(
      Number(rows[0]?.owner),
      guardedAllocation().ownerConnectionId,
      "launcher must hold this allocation's suite ownership lock",
    );
    return connection;
  } catch (error) {
    await connection.end();
    throw error;
  }
}

export async function reset(connection: Connection) {
  // Fixed fixture-owned tables only; no arbitrary identifiers, schema drops or FK disabling.
  for (const name of [
    "mail_commands",
    "mail_deliveries",
    "job_effect_receipts",
    "durable_jobs",
    "outbox_events",
    "job_runner_leases",
    "synthetic_job_counter",
    "synthetic_mail_owner",
    "identity_command_results",
    "identity_limits",
    "identity_challenges",
    "identity_company",
    "identity_roles",
    "identity_sessions",
    "identity_accounts",
    "identity_verifications",
    "identity_memberships",
    "identity_users",
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

export async function auditOnlyFolder(): Promise<string> {
  return publishedPrefixFolder(1);
}

export async function identityFoundationFolder(): Promise<string> {
  return publishedPrefixFolder(2);
}
export async function jobsPriorFolder(): Promise<string> {
  return publishedPrefixFolder(3);
}
export async function messagingPriorFolder(): Promise<string> {
  return publishedPrefixFolder(4);
}

async function publishedPrefixFolder(count: 1 | 2 | 3 | 4): Promise<string> {
  await mkdir(join(root, ".local"), { recursive: true });
  const folder = await mkdtemp(join(root, ".local/identity-audit-prefix-"));
  await mkdir(join(folder, "meta"));
  const production = JSON.parse(
    await readFile(join(migrationFolder, "meta/_journal.json"), "utf8"),
  ) as Journal;
  const first = production.entries[0];
  if (first?.tag !== "0000_solid_spencer_smythe")
    throw new Error("PUBLISHED_AUDIT_PREFIX_REQUIRED");
  const entries = production.entries.slice(0, count);
  if (count === 2 && entries[1]?.tag !== "0001_mean_masked_marvel")
    throw new Error("PUBLISHED_IDENTITY_PREFIX_REQUIRED");
  if (count === 3 && entries[2]?.tag !== "0002_acoustic_starfox")
    throw new Error("PUBLISHED_EMAIL_PREFIX_REQUIRED");
  if (count === 4 && entries[3]?.tag !== "0003_windy_jackal")
    throw new Error("PUBLISHED_JOBS_PREFIX_REQUIRED");
  for (const entry of entries)
    await copyFile(join(migrationFolder, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  await writeFile(join(folder, "meta/_journal.json"), JSON.stringify({ ...production, entries }));
  return folder;
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
