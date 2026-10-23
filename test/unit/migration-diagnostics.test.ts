import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";
import { migrationFailure } from "../../packages/db/src/core/migration-diagnostics.ts";
import { observeDatabaseOperation } from "../../packages/db/src/core/operation-context.ts";

test("migration diagnostics propagate observed native context without private error fields", async () => {
  const native = Object.assign(new Error("private-secret SQL and credentials"), {
    code: "PROTOCOL_SEQUENCE_TIMEOUT",
    sql: "private-secret SQL",
    parameters: ["private-secret token"],
  });
  try {
    await observeDatabaseOperation("migration_baseline", 1000, async () => {
      throw native;
    });
  } catch (error) {
    expect(error).toBe(native);
  }
  const result = migrationFailure(new Error("private-secret outer", { cause: native }));
  expect(result).toMatchObject({
    event: "database.migration_failed",
    code: "MIGRATION_EXECUTION_FAILED",
    nativeCodes: ["PROTOCOL_SEQUENCE_TIMEOUT"],
    databaseOperation: { operation: "migration_baseline", wireDeadlineMs: 1000 },
  });
  expect(result.databaseOperation?.elapsedMs).toBeGreaterThanOrEqual(0);
  expect(JSON.stringify(result)).not.toContain("private-secret");
  expect(migrationFailure(new Error("MIGRATION_RECOVERY_REQUIRED")).code).toBe(
    "MIGRATION_RECOVERY_REQUIRED",
  );
});

test("migration diagnostics bound cycles and hostile or malformed causes with closed fallback categories", () => {
  const cyclic: Record<string, unknown> = { code: "ER_LOCK_DEADLOCK", message: "private-secret" };
  cyclic.cause = cyclic;
  expect(migrationFailure(cyclic).nativeCodes).toEqual(["ER_LOCK_DEADLOCK"]);
  const hostile = Object.create(null);
  for (const key of ["code", "message", "cause"])
    Object.defineProperty(hostile, key, {
      get() {
        throw new Error("private-secret getter");
      },
    });
  expect(migrationFailure(hostile)).toMatchObject({
    code: "MIGRATION_EXECUTION_FAILED",
    nativeCodes: [],
  });
  for (const value of [
    null,
    undefined,
    "private-secret",
    { code: "private-code", message: "private-secret", cause: 42 },
  ])
    expect(JSON.stringify(migrationFailure(value))).not.toContain("private-secret");
  let deep: unknown = { code: "ER_ACCESS_DENIED_ERROR" };
  for (let i = 0; i < 8; i++) deep = { cause: deep };
  expect(migrationFailure(deep).nativeCodes).toEqual([]);
});

test("migration CLI preserves native failure status and prints only reconstructed configuration diagnostics", () => {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "packages/db/src/migrate-cli.ts"],
    {
      encoding: "utf8",
      timeout: 5000,
      env: { ...process.env, MYSQL_PORT: "", MYSQL_PASSWORD: "private-secret-password" },
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  expect(JSON.parse(result.stderr)).toEqual({
    event: "database.migration_failed",
    code: "DATABASE_CONFIGURATION_MISSING",
    nativeCodes: [],
    action: "inspect_private_diagnostics_and_recovery_runbook",
  });
  expect(result.stderr).not.toContain("private-secret");
});
