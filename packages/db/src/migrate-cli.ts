import { runMigrations } from "./core/migrations.js";
import { settingsFromEnvironment } from "./core/session.js";

try {
  const count = await runMigrations(settingsFromEnvironment());
  console.log(JSON.stringify({ event: "database.migrated", applied: count }));
} catch (error) {
  // Driver messages can carry SQL, identifiers and credentials; never print them here.
  const safeCodes = [
    "MIGRATION_LOCK_UNAVAILABLE",
    "MIGRATION_BASELINE_MISMATCH",
    "MIGRATION_HISTORY_DRIFT",
    "MIGRATION_RECOVERY_REQUIRED",
    "INVALID_MIGRATION_ORDER",
    "DATABASE_CONFIGURATION_MISSING",
    "DATABASE_PORT_INVALID",
  ];
  const code =
    error instanceof Error && safeCodes.includes(error.message)
      ? error.message
      : "MIGRATION_EXECUTION_FAILED";
  console.error(
    JSON.stringify({
      event: "database.migration_failed",
      code,
      action: "inspect_private_diagnostics_and_recovery_runbook",
    }),
  );
  process.exitCode = 1;
}
