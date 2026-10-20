import { spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { createUnitOfWork, runMigrations } from "@vtc/db";
import { sql } from "@vtc/db/identity-schema";
import { createIdentity } from "../../../apps/api/src/modules/identity/service.ts";
import { guardedSettings, testConnection } from "../../persistence/support.ts";
import { guardedAllocation, safeChildEnvironment } from "../../support/environment.ts";
import { accountSecret } from "./account.ts";

const settings = guardedSettings();
const ownership = await testConnection();
await ownership.query(
  "CREATE TABLE synthetic_browser_events (id VARCHAR(36) PRIMARY KEY) ENGINE=InnoDB",
);
await ownership.end();
await runMigrations(settings);
const secret = accountSecret("identity");
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
  for (const project of ["desktop", "tablet", "mobile"]) {
    const credential = await identity.prepareCredential(
      createHmac("sha256", guardedAllocation().token)
        .update(`browser-steam-${project}`)
        .digest("base64url"),
    );
    await unit.run((tx) =>
      identity.insertWithCredential(tx, {
        userId: crypto.randomUUID(),
        email: `browser-steam-${project}@example.invalid`,
        name: "Synthetic Browser Steam Member",
        roles: ["driver"],
        ...credential,
      }),
    );
  }
} catch {
  throw new Error("SYNTHETIC_BROWSER_IDENTITY_SETUP_FAILED");
} finally {
  await unit.close();
}
const app = spawn(process.execPath, ["--import", "tsx", "test/e2e/support/runtime.ts"], {
  stdio: "inherit",
  env: {
    ...safeChildEnvironment(),
    SERVE_WEB: "true",
    API_HOST: "127.0.0.1",
    API_PORT: "4173",
    IDENTITY_ENABLED: "true",
    IDENTITY_SECRET: secret,
    IDENTITY_ORIGIN: "http://127.0.0.1:4173",
    EXTERNAL_IDENTITIES_ENABLED: "true",
    VTC_TEST_CONFIG: process.env.VTC_TEST_CONFIG,
    DB_TEST_RESET_ACK: process.env.DB_TEST_RESET_ACK,
    ADMISSIONS_ENABLED: "true",
    ADMISSIONS_ENCRYPTION_KEY: randomBytes(32).toString("base64url"),
    MAIL_MODE: "local",
    MAIL_ENCRYPTION_KEY: accountSecret("mail"),
    MAIL_SENDER: "sender@example.invalid",
    CATALOGS_ENABLED: "true",
    CATALOGS_SYNTHETIC: "true",
    CATALOGS_CURSOR_KEY: randomBytes(32).toString("hex"),
    CATALOGS_MAX_FILE_BYTES: "8388608",
    CATALOGS_ARTIFACT_TTL_MS: "86400000",
    CATALOGS_POLICY_REVISION: "1",
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
