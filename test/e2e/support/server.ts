import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { guardedSettings } from "../../persistence/support.ts";
import { safeChildEnvironment } from "../../support/environment.ts";
import { accountSecret, browserAdmissionsKey } from "./account.ts";

// The lane prepares its owned schema before Playwright starts the real readiness clock.
const settings = guardedSettings();
const secret = accountSecret("identity");
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
    ADMISSIONS_ENCRYPTION_KEY: browserAdmissionsKey(),
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
