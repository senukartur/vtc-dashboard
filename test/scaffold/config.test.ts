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
  assert.deepEqual(new Set(runtime.mysqlSqlMode.split(",")), new Set(requiredSqlModes));
});
