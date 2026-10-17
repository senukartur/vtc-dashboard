import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { test } from "node:test";
import { browserSchemaRef } from "@vtc/contracts/runtime";
import { createApp } from "../../apps/api/src/app.ts";

test("liveness is independent of database readiness and failures stay private", async () => {
  const app = await createApp({
    checkReadiness: async () => {
      throw new Error("PRIVATE_DIAGNOSTIC");
    },
  });
  try {
    assert.equal((await app.inject("/health/live")).statusCode, 200);
    const ready = await app.inject("/health/ready");
    assert.equal(ready.statusCode, 503);
    assert.deepEqual(ready.json(), { status: "not_ready" });
    assert.equal(ready.headers["cache-control"], "no-store");
    assert.ok(!ready.body.includes("PRIVATE_DIAGNOSTIC"));
  } finally {
    await app.close();
  }
});

test("draft-2020-12 refs, union and null checks run through Fastify without input coercion", async () => {
  const app = await createApp({ checkReadiness: async () => true });
  app.post(
    "/schema-probe",
    { schema: { body: browserSchemaRef("CredentialChangeInput") } },
    async () => ({ ok: true }),
  );
  try {
    const payload = {
      kind: "email_change",
      challengeId: "41000000-0000-4000-8000-000000000001",
      code: "NONFUNCTIONAL_EXAMPLE_ONLY",
    };
    assert.equal(
      (await app.inject({ method: "POST", url: "/schema-probe", payload })).statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/schema-probe",
          payload: { ...payload, newPassword: "NONFUNCTIONAL_EXAMPLE_ONLY" },
        })
      ).statusCode,
      422,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/schema-probe",
          payload: { ...payload, challengeId: null },
        })
      ).statusCode,
      422,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/schema-probe",
          payload: { ...payload, code: 12345 },
        })
      ).statusCode,
      422,
    );
    const malformed = await app.inject({
      method: "POST",
      url: "/schema-probe",
      headers: { "content-type": "application/json" },
      payload: "{",
    });
    assert.equal(malformed.statusCode, 400);
    assert.ok(!malformed.body.includes("JSON.parse"));
  } finally {
    await app.close();
  }
});

test("invalid response fields fail closed instead of exposing private properties", async () => {
  const app = await createApp({ checkReadiness: async () => true });
  app.get(
    "/response-probe",
    { schema: { response: { 200: browserSchemaRef("CatalogLabel") } } },
    async () => ({
      entityId: "41000000-0000-4000-8000-000000000001",
      label: "Fixture City",
      requestedLocale: "ru",
      renderedLocale: "en",
      englishFallback: true,
      retired: false,
      privateDiagnostic: "PRIVATE_VALUE",
    }),
  );
  try {
    const result = await app.inject("/response-probe");
    assert.equal(result.statusCode, 500);
    assert.ok(!result.body.includes("PRIVATE_VALUE"));
    assert.equal(result.json().error.code, "INTERNAL_ERROR");
  } finally {
    await app.close();
  }
});

test("production SPA fallback never replaces API, evidence or missing-asset errors", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vtc006-http-"));
  await writeFile(join(directory, "index.html"), "<!doctype html><title>Fixture shell</title>");
  const app = await createApp({ checkReadiness: async () => true, webRoot: directory });
  try {
    assert.equal(
      (await app.inject({ url: "/", headers: { accept: "text/html" } })).statusCode,
      200,
    );
    assert.equal(
      (await app.inject({ url: "/members", headers: { accept: "text/html" } })).statusCode,
      200,
    );
    for (const url of [
      "/api/v1/me",
      "/api/telemetry/v1/connection",
      "/health/missing",
      "/evidence/private",
      "/uploads/private",
      "/assets/missing.js",
      "/%61pi/missing",
    ]) {
      const result = await app.inject({ url, headers: { accept: "text/html" } });
      assert.equal(result.statusCode, 404, url);
      assert.ok(!result.body.includes("Fixture shell"), url);
    }
  } finally {
    await app.close();
    const absolute = resolve(directory);
    assert.ok(absolute.startsWith(`${resolve(tmpdir())}${sep}vtc006-http-`));
    await rm(absolute, { recursive: true });
  }
});
