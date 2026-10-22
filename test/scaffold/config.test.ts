import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { expectedMysqlVersion, requiredSqlModes } from "@vtc/db";
import { readConfig } from "../../apps/api/src/platform/config/env.ts";

const fixture = {
  MYSQL_HOST: "127.0.0.1",
  MYSQL_PORT: "3307",
  MYSQL_USER: "fixture_user",
  MYSQL_DATABASE: "fixture_database",
  MYSQL_PASSWORD: "NONFUNCTIONAL_EXAMPLE_ONLY",
};

test("telemetry activation requires all prerequisites, separate key and uint32-safe validated limits", () => {
  assert.equal(readConfig(fixture).telemetry, undefined);
  const input = {
    ...fixture,
    IDENTITY_ENABLED: "true",
    IDENTITY_SECRET: "nonfunctional-synthetic-identity-secret-42",
    IDENTITY_ORIGIN: "http://127.0.0.1:4173",
    TRIPS_ENABLED: "true",
    TRIPS_CURSOR_KEY: "a".repeat(64),
    EXTERNAL_IDENTITIES_ENABLED: "true",
    TELEMETRY_ENABLED: "true",
    TELEMETRY_CURSOR_KEY: "b".repeat(64),
    TELEMETRY_IP_PER_MINUTE: "600",
    TELEMETRY_GLOBAL_PER_MINUTE: "6000",
  };
  assert.equal(readConfig(input).telemetry?.globalPerMinute, 6000);
  assert.equal(
    readConfig({ ...input, TELEMETRY_IP_PER_MINUTE: "60000", TELEMETRY_GLOBAL_PER_MINUTE: "60000" })
      .telemetry?.globalPerMinute,
    60000,
  );
  for (const changes of [
    { TELEMETRY_ENABLED: "yes" },
    { TRIPS_ENABLED: "false" },
    { EXTERNAL_IDENTITIES_ENABLED: "false" },
    { TELEMETRY_CURSOR_KEY: "a".repeat(64) },
    { TELEMETRY_IP_PER_MINUTE: "59" },
    { TELEMETRY_GLOBAL_PER_MINUTE: "1000000" },
    { TELEMETRY_GLOBAL_PER_MINUTE: "599" },
  ])
    assert.throws(() => readConfig({ ...input, ...changes }), /TELEMETRY_/);
});

test("trip reads are opt-in and require identity plus a separate cursor key", () => {
  assert.equal(readConfig(fixture).trips, undefined);
  assert.throws(() => readConfig({ ...fixture, TRIPS_ENABLED: "yes" }), /TRIPS_ENABLED/);
  assert.throws(() => readConfig({ ...fixture, TRIPS_ENABLED: "true" }), /IDENTITY_ENABLED/);
  const input = {
    ...fixture,
    IDENTITY_ENABLED: "true",
    IDENTITY_SECRET: "nonfunctional-synthetic-identity-secret-42",
    IDENTITY_ORIGIN: "http://127.0.0.1:4173",
    TRIPS_ENABLED: "true",
  };
  assert.throws(() => readConfig(input), /TRIPS_CURSOR_KEY/);
  assert.equal(
    readConfig({ ...input, TRIPS_CURSOR_KEY: "a".repeat(64) }).trips?.cursorKey.length,
    64,
  );
});

test("environment parsing rejects placeholders, invalid ports and unsafe booleans without leaking values", () => {
  assert.equal(readConfig(fixture).database.port, 3307);
  for (const changes of [
    { MYSQL_PASSWORD: "REPLACE_WITH_GENERATED_LOCAL_PASSWORD" },
    { MYSQL_PORT: "3307.5" },
    { MYSQL_PORT: "0" },
    { SERVE_WEB: "yes" },
  ]) {
    assert.throws(
      () => readConfig({ ...fixture, ...changes }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.startsWith("Invalid environment fields:"));
        assert.ok(!error.message.includes("NONFUNCTIONAL_EXAMPLE_ONLY"));
        assert.ok(!error.message.includes("REPLACE_WITH"));
        return true;
      },
    );
  }
});

test("shared runtime baseline matches local/container versions and MySQL configuration", async () => {
  const runtime = JSON.parse(
    await readFile(new URL("../../config/runtime.json", import.meta.url), "utf8"),
  );
  const root = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  const compose = await readFile(new URL("../../compose.yaml", import.meta.url), "utf8");
  const dockerfile = await readFile(new URL("../../Dockerfile", import.meta.url), "utf8");
  const mysql = await readFile(new URL("../../deploy/local/mysql.cnf", import.meta.url), "utf8");
  assert.equal(root.engines.node, runtime.node);
  assert.equal(root.packageManager, `pnpm@${runtime.pnpm}`);
  assert.equal(runtime.mysql, expectedMysqlVersion);
  assert.ok(compose.includes(`mysql:${runtime.mysql}@sha256:`));
  assert.ok(dockerfile.includes(`node:${runtime.node}-bookworm-slim@sha256:`));
  assert.ok(dockerfile.includes(`pnpm@${runtime.pnpm}`));
  assert.ok(mysql.includes(`default-time-zone=${runtime.mysqlTimezone}`));
  assert.ok(mysql.includes(`transaction-isolation=${runtime.mysqlIsolation}`));
  assert.ok(mysql.includes(`collation-server=${runtime.mysqlCollation}`));
  assert.ok(mysql.includes(`sql-mode=${runtime.mysqlSqlMode}`));
  for (const setting of [
    `character-set-server=${runtime.mysqlCharset}`,
    `collation-server=${runtime.mysqlCollation}`,
    `default-time-zone=${runtime.mysqlTimezone}`,
    `transaction-isolation=${runtime.mysqlIsolation}`,
    `sql-mode=${runtime.mysqlSqlMode}`,
  ])
    assert.ok(compose.includes(`--${setting}`), setting);
  assert.ok(
    !compose.includes("/etc/mysql/conf.d/"),
    "Do not bind-mount Windows config permissions into mysqld",
  );
  assert.deepEqual(new Set(runtime.mysqlSqlMode.split(",")), new Set(requiredSqlModes));
});
test("external identities activation is explicit and requires valid identity configuration", () => {
  assert.equal(readConfig(fixture).externalIdentities, false);
  assert.throws(
    () => readConfig({ ...fixture, EXTERNAL_IDENTITIES_ENABLED: "yes" }),
    /EXTERNAL_IDENTITIES_ENABLED/,
  );
  assert.throws(
    () => readConfig({ ...fixture, EXTERNAL_IDENTITIES_ENABLED: "true" }),
    /IDENTITY_ENABLED/,
  );
  assert.equal(
    readConfig({
      ...fixture,
      IDENTITY_ENABLED: "true",
      IDENTITY_SECRET: "nonfunctional-synthetic-identity-secret-42",
      IDENTITY_ORIGIN: "http://127.0.0.1:4173",
      EXTERNAL_IDENTITIES_ENABLED: "true",
    }).externalIdentities,
    true,
  );
});

test("qualification activation requires identity/trips and an independent cursor key without numeric defaults", () => {
  assert.equal(readConfig(fixture).qualifications, undefined);
  const input = {
    ...fixture,
    IDENTITY_ENABLED: "true",
    IDENTITY_SECRET: "nonfunctional-synthetic-identity-secret-42",
    IDENTITY_ORIGIN: "http://127.0.0.1:4173",
    TRIPS_ENABLED: "true",
    TRIPS_CURSOR_KEY: "a".repeat(64),
    QUALIFICATIONS_ENABLED: "true",
    QUALIFICATIONS_CURSOR_KEY: "b".repeat(64),
  };
  assert.deepEqual(readConfig(input).qualifications, { cursorKey: "b".repeat(64) });
  for (const changes of [
    { QUALIFICATIONS_ENABLED: "yes" },
    { IDENTITY_ENABLED: "false" },
    { TRIPS_ENABLED: "false" },
    { QUALIFICATIONS_CURSOR_KEY: "" },
    { QUALIFICATIONS_CURSOR_KEY: "a".repeat(64) },
    { MANUAL_REPORTS_KEY: "b".repeat(64) },
  ])
    assert.throws(() => readConfig({ ...input, ...changes }));
});
