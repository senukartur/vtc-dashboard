import { spawn } from "node:child_process";
import { runMigrations } from "@vtc/db";
import { guardedSettings, testConnection } from "../../persistence/support.ts";
import { safeChildEnvironment } from "../../support/environment.ts";

const settings = guardedSettings();
const ownership = await testConnection();
await ownership.end();
await runMigrations(settings);
const app = spawn(process.execPath, ["apps/api/dist/server.js"], {
  stdio: "inherit",
  env: {
    ...safeChildEnvironment(),
    SERVE_WEB: "true",
    API_HOST: "127.0.0.1",
    API_PORT: "4173",
    MYSQL_HOST: settings.host,
    MYSQL_PORT: String(settings.port),
    MYSQL_DATABASE: settings.database,
    MYSQL_USER: settings.user,
    MYSQL_PASSWORD: settings.password,
  },
});
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => app.kill(signal));
app.once("error", () => {
  process.exitCode = 1;
});
app.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
