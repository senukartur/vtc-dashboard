import { spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { createUnitOfWork, runMigrations } from "@vtc/db";
import { sql } from "@vtc/db/identity-schema";
import { createIdentity } from "../../../apps/api/src/modules/identity/service.ts";
import { guardedSettings, testConnection } from "../../persistence/support.ts";
import { guardedAllocation, safeChildEnvironment } from "../../support/environment.ts";

const settings = guardedSettings();
const ownership = await testConnection();
await ownership.query(
  "CREATE TABLE synthetic_browser_events (id VARCHAR(36) PRIMARY KEY) ENGINE=InnoDB",
);
await ownership.end();
await runMigrations(settings);
const secret = randomBytes(32).toString("hex");
const password = createHmac("sha256", guardedAllocation().token)
  .update("browser-identity-password")
  .digest("base64url");
const unit = createUnitOfWork(settings);
try {
  const identity = createIdentity(
    unit,
    { secret, origin: "http://127.0.0.1:4173", production: false },
    {
      accessEvents: {
        append: async (tx, event) => {
          await unit
            .client(tx)
            .execute(sql`INSERT INTO synthetic_browser_events VALUES (${event.eventId})`);
        },
      },
    },
  );
  await identity.bootstrap({
    email: "browser@example.invalid",
    name: "Synthetic Browser Member",
    password,
  });
} catch {
  throw new Error("SYNTHETIC_BROWSER_IDENTITY_SETUP_FAILED");
} finally {
  await unit.close();
}
const app = spawn(process.execPath, ["apps/api/dist/server.js"], {
  stdio: "inherit",
  env: {
    ...safeChildEnvironment(),
    SERVE_WEB: "true",
    API_HOST: "127.0.0.1",
    API_PORT: "4173",
    IDENTITY_ENABLED: "true",
    IDENTITY_SECRET: secret,
    IDENTITY_ORIGIN: "http://127.0.0.1:4173",
    ADMISSIONS_ENABLED: "true",
    ADMISSIONS_ENCRYPTION_KEY: randomBytes(32).toString("base64url"),
    MAIL_MODE: "local",
    MAIL_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    MAIL_SENDER: "sender@example.invalid",
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
