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

// Expanded 62-table setup measured 7.1s reset + 21.4s migration before fixture bootstrap.
// Only the outer setup/teardown allowance changes; runtime/query/transaction bounds are unchanged.
export const SCHEMA_SETUP_TIMEOUT_MS = 60000;

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
    if (process.env.VTC_TEST_LANE === "integration") {
      const [guard] = await connection.query<RowDataPacket[]>({
        sql: "SELECT GET_LOCK(?,0) owned",
        values: [`vtc008-suite:${settings.database}`],
        timeout: 1000,
      });
      assert.equal(
        Number(guard[0]?.owned),
        1,
        "prior integration setup/teardown must settle before reset",
      );
    }
    return connection;
  } catch (error) {
    await connection.end();
    throw error;
  }
}

export async function reset(connection: Connection) {
  const [pointer] = await connection.query<RowDataPacket[]>(
    "SELECT CONSTRAINT_NAME FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME='manual_report_current_revision_fk'",
  );
  if (pointer.length)
    await connection.query(
      "ALTER TABLE manual_reports DROP FOREIGN KEY manual_report_current_revision_fk",
    );
  // Fixed fixture-owned tables only; no arbitrary identifiers, schema drops or FK disabling.
  const tables = [
    "manual_blob_generations",
    "manual_commands",
    "manual_draft_history",
    "manual_draft_evidence",
    "manual_drafts",
    "manual_correction_history",
    "manual_correction_requests",
    "manual_evidence_refs",
    "manual_revisions",
    "manual_reports",
    "manual_review_gates",
    "manual_evidence",
    "event_commands",
    "event_catalog_pins",
    "event_responses",
    "event_attendances",
    "event_attendance_revisions",
    "event_response_revisions",
    "event_revisions",
    "events",
    "telemetry_commands",
    "telemetry_installations",
    "telemetry_limits",
    "telemetry_tokens",
    "trip_contribution_history",
    "trip_contributions",
    "qualification_promotion_reviews",
    "qualification_promotions",
    "qualification_states",
    "qualification_assignments",
    "qualification_rule_versions",
    "qualification_levels",
    "trip_history",
    "trip_fact_trailers",
    "trip_facts",
    "source_payloads",
    "source_messages",
    "source_trips",
    "trips",
    "external_truckers_cache",
    "external_steam_changes",
    "external_steam_links",
    "external_steam_proofs",
    "external_steam_nonces",
    "external_steam_accounts",
    "catalog_mapping_reviews",
    "catalog_mapping_issues",
    "catalog_aliases",
    "catalog_relations",
    "catalog_mappings",
    "catalog_changes",
    "catalog_coverage",
    "catalog_facts",
    "catalog_entities",
    "catalog_publications",
    "catalog_revisions",
    "catalog_operations",
    "catalog_commands",
    "catalog_artifacts",
    "admissions_command_results",
    "admissions_limits",
    "admissions_decisions",
    "admissions_invitations",
    "admissions_applications",
    "qualification_initial_assignments",
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
  ];
  await connection.query(`DROP TABLE IF EXISTS ${tables.join(",")}`);
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
export async function admissionsPriorFolder(): Promise<string> {
  return publishedPrefixFolder(5);
}
export async function externalIdentitiesPriorFolder(): Promise<string> {
  return publishedPrefixFolder(6);
}

export async function catalogsPriorFolder(): Promise<string> {
  return publishedPrefixFolder(7);
}

export async function eventsPriorFolder(): Promise<string> {
  return publishedPrefixFolder(11);
}

async function publishedPrefixFolder(
  count: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12,
): Promise<string> {
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
  if (count === 5 && entries[4]?.tag !== "0004_windy_ravenous")
    throw new Error("PUBLISHED_MESSAGING_PREFIX_REQUIRED");
  if (count === 6 && entries[5]?.tag !== "0005_admissions")
    throw new Error("PUBLISHED_ADMISSIONS_PREFIX_REQUIRED");
  if (count === 7 && entries[6]?.tag !== "0006_nervous_daredevil")
    throw new Error("PUBLISHED_EXTERNAL_IDENTITIES_PREFIX_REQUIRED");
  if (count === 8 && entries[7]?.tag !== "0007_nice_gateway")
    throw new Error("PUBLISHED_CATALOG_PREFIX_REQUIRED");
  if (count === 10 && entries[9]?.tag !== "0009_slimy_exiles")
    throw new Error("PUBLISHED_TELEMETRY_PREFIX_REQUIRED");
  if (count === 9 && entries[8]?.tag !== "0008_stale_prowler")
    throw new Error("PUBLISHED_TRIP_PREFIX_REQUIRED");
  if (count === 10 && entries[9]?.tag !== "0009_slimy_exiles")
    throw new Error("PUBLISHED_TELEMETRY_PREFIX_REQUIRED");
  if (count === 11 && entries[10]?.tag !== "0010_qualifications")
    throw new Error("PUBLISHED_QUALIFICATION_PREFIX_REQUIRED");
  if (count === 12 && entries[11]?.tag !== "0011_tearful_infant_terrible")
    throw new Error("PUBLISHED_EVENTS_PREFIX_REQUIRED");
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

export async function tripsPriorFolder(): Promise<string> {
  return publishedPrefixFolder(8);
}

export async function telemetryPriorFolder(): Promise<string> {
  return publishedPrefixFolder(9);
}

export async function qualificationsPriorFolder(): Promise<string> {
  return publishedPrefixFolder(10);
}

export async function manualPriorFolder(): Promise<string> {
  return publishedPrefixFolder(12);
}
