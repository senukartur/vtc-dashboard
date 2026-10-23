import { runMigrations } from "./core/migrations.js";
import { migrationFailure } from "./core/migration-diagnostics.js";
import { settingsFromEnvironment } from "./core/session.js";

try {
  const count = await runMigrations(settingsFromEnvironment());
  console.log(JSON.stringify({ event: "database.migrated", applied: count }));
} catch (error) {
  console.error(JSON.stringify(migrationFailure(error)));
  process.exitCode = 1;
}
