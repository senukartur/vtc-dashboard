import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";

// Every table and column a development grant file names must exist in the latest migration
// snapshot. MySQL accepts a GRANT on a table that a migration dropped only until apply runs it,
// so a stale entry fails late on a host; this check fails it in `pnpm check` instead.

const deploy = new URL("../../deploy/development/", import.meta.url);
const migrations = new URL("../../packages/db/migrations/meta/", import.meta.url);

/** Tables the acceptance harness creates itself, outside the migrations. */
const harnessTables: Record<string, string> = {
  "notifications-acceptance-grants.json": "notification_acceptance",
};

type Matrix = Record<string, Record<string, string[]>>;
const json = async (url: URL) => JSON.parse(await readFile(url, "utf8"));

/** Per-role supplements activation adds for an operator setting (EVENT_MEDIA_ROOT, Dispatch). */
const roleSupplements = ["eventMediaGrants", "dispatchStage3Grants"] as const;

function stageMatrices(stage: Record<string, unknown>): Matrix {
  const result: Matrix = {
    ...(stage.grants as Matrix),
    eventsDraftsGrants: stage.eventsDraftsGrants as Record<string, string[]>,
  };
  for (const name of roleSupplements) {
    const supplement = stage[name] as Matrix | undefined;
    assert.ok(supplement && Object.keys(supplement).length, `${name} missing`);
    for (const [role, tables] of Object.entries(supplement)) result[`${name} ${role}`] = tables;
  }
  return result;
}

async function latestSchema() {
  const journal = (await json(new URL("_journal.json", migrations))) as {
    entries: { idx: number }[];
  };
  const last = journal.entries.at(-1);
  assert.ok(last, "MIGRATION_JOURNAL_EMPTY");
  const name = `${String(last.idx).padStart(4, "0")}_snapshot.json`;
  const snapshot = (await json(new URL(name, migrations))) as {
    tables: Record<string, { name: string; columns: Record<string, unknown> }>;
  };
  return new Map(
    Object.values(snapshot.tables).map((table) => [
      table.name,
      new Set(Object.keys(table.columns)),
    ]),
  );
}

/** Every grant matrix of a file, labelled by file and role. */
async function grantMatrices() {
  const files = (await readdir(deploy)).filter(
    (name) => name === "stage-features.json" || /grants.*\.json$/.test(name),
  );
  assert.ok(files.includes("stage-features.json") && files.includes("activation-grants.json"));
  const result: { label: string; file: string; tables: Record<string, string[]> }[] = [];
  for (const file of files.sort()) {
    const value = await json(new URL(file, deploy));
    const matrices: Matrix = file === "stage-features.json" ? stageMatrices(value) : value;
    for (const [role, tables] of Object.entries(matrices))
      result.push({ label: `${file} ${role}`, file, tables });
  }
  return result;
}

/** Problems in one matrix against the schema; `harness` names a table outside the migrations. */
function grantProblems(
  schema: Map<string, Set<string>>,
  tables: Record<string, string[]>,
  harness?: string,
) {
  const problems: string[] = [];
  for (const [table, permissions] of Object.entries(tables)) {
    if (table === harness) continue;
    const columns = schema.get(table);
    if (!columns) {
      problems.push(`table ${table}`);
      continue;
    }
    for (const permission of permissions) {
      const named = /^\w+\((.+)\)$/.exec(permission)?.[1];
      for (const column of named?.split(",") ?? [])
        if (!columns.has(column)) problems.push(`column ${table}.${column}`);
    }
  }
  return problems;
}

test("every granted table and column exists in the latest migration snapshot", async () => {
  const schema = await latestSchema();
  const matrices = await grantMatrices();
  assert.ok(matrices.length >= 10, "GRANT_FILES_MISSING");
  for (const { label, file, tables } of matrices)
    assert.deepEqual(grantProblems(schema, tables, harnessTables[file]), [], label);
});

test("the Stage supplement repeats no base grant", async () => {
  // activation.py concatenates the supplement onto the base, so a repeat would grant it twice.
  const base = (await json(new URL("activation-grants.json", deploy))) as Matrix;
  const stage = await json(new URL("stage-features.json", deploy));
  const repeats: string[] = [];
  for (const [role, tables] of Object.entries({
    ...stage.grants,
    runtime: { ...stage.grants.runtime, ...stage.eventsDraftsGrants },
  }) as [string, Record<string, string[]>][])
    for (const [table, permissions] of Object.entries(tables))
      for (const permission of permissions)
        if (base[role]?.[table]?.includes(permission))
          repeats.push(`${role} ${table} ${permission}`);
  assert.deepEqual(repeats, []);
  // The level change history needs it on every host, not only with the supplement.
  assert.ok(base.runtime?.audit_entries?.includes("SELECT"));
});

test("the media and Dispatch supplements repeat nothing they are added to", async () => {
  // activation.py refuses a repeat inside the supplement; this also covers the base matrix.
  const base = (await json(new URL("activation-grants.json", deploy))) as Matrix;
  const stage = await json(new URL("stage-features.json", deploy));
  const repeats: string[] = [];
  for (const name of roleSupplements)
    for (const [role, tables] of Object.entries(stage[name] as Matrix))
      for (const [table, permissions] of Object.entries(tables)) {
        const existing = [
          ...(base[role]?.[table] ?? []),
          ...(stage.grants[role]?.[table] ?? []),
          ...(role === "runtime" ? (stage.eventsDraftsGrants[table] ?? []) : []),
          ...roleSupplements
            .filter((other) => other !== name)
            .flatMap((other) => stage[other][role]?.[table] ?? []),
        ];
        for (const permission of permissions)
          if (existing.includes(permission)) repeats.push(`${name} ${role} ${table} ${permission}`);
      }
  assert.deepEqual(repeats, []);
});

test("the Dispatch Stage 3 tables are granted only by their supplement", async () => {
  const stage = await json(new URL("stage-features.json", deploy));
  const dispatch = new Set(
    Object.values(stage.dispatchStage3Grants as Matrix).flatMap((tables) => Object.keys(tables)),
  );
  assert.deepEqual([...dispatch].sort(), [
    "reconciliation_candidate_dismissals",
    "trip_review_reasons",
  ]);
  for (const { label, tables } of await grantMatrices())
    if (!label.startsWith("stage-features.json dispatchStage3Grants "))
      assert.deepEqual(
        Object.keys(tables).filter((table) => dispatch.has(table)),
        [],
        label,
      );
});

test("the grant check reports dropped tables and columns", () => {
  const schema = new Map([["qualification_assignments", new Set(["id", "ended_at"])]]);
  assert.deepEqual(
    grantProblems(schema, {
      qualification_assignments: ["SELECT", "UPDATE(ended_at,revision)"],
      qualification_states: ["SELECT"],
    }),
    ["column qualification_assignments.revision", "table qualification_states"],
  );
  assert.deepEqual(grantProblems(schema, { harness_only: ["SELECT"] }, "harness_only"), []);
});
