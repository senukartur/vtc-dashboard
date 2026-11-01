import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

test("invalid response fields fail closed instead of exposing private properties", async (t) => {
  const log = t.mock.method(console, "error", () => {});
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
    assert.equal(log.mock.callCount(), 1);
    const record = JSON.parse(String(log.mock.calls[0]?.arguments[0]));
    assert.deepEqual(record, {
      event: "request_failed",
      requestId: result.json().meta.requestId,
      code: "INTERNAL_ERROR",
    });
  } finally {
    await app.close();
  }
});

test("framework errors retain safe status codes without echoing their details", async (t) => {
  t.mock.method(console, "error", () => {});
  const app = await createApp({ checkReadiness: async () => true });
  for (const statusCode of [401, 404, 405, 406, 409, 412, 428, 503])
    app.get(`/error-probe/${statusCode}`, async () => {
      throw Object.assign(new Error("PRIVATE_ERROR_DETAIL"), { statusCode });
    });
  try {
    for (const statusCode of [401, 404, 405, 406, 409, 412, 428, 503]) {
      const result = await app.inject(`/error-probe/${statusCode}`);
      assert.equal(result.statusCode, statusCode);
      assert.equal(result.json().error.retryable, statusCode === 503);
      assert.ok(!result.body.includes("PRIVATE_ERROR_DETAIL"));
    }
  } finally {
    await app.close();
  }
});

test("wire parameters decode schema types while body and response validation stay strict", async () => {
  const app = await createApp({ checkReadiness: async () => true });
  app.get(
    "/query-probe/:page",
    {
      schema: {
        querystring: {
          type: "object",
          properties: { limit: { type: "integer", minimum: 1, maximum: 100 } },
          required: ["limit"],
          additionalProperties: false,
        },
        params: {
          type: "object",
          properties: { page: { type: "integer", minimum: 1 } },
          required: ["page"],
        },
        headers: {
          type: "object",
          properties: { "x-page": { type: "integer", minimum: 1 } },
          required: ["x-page"],
        },
      },
    },
    async (request) => ({
      query: request.query,
      params: request.params,
      header: request.headers["x-page"],
    }),
  );
  try {
    const valid = await app.inject({ url: "/query-probe/2?limit=20", headers: { "x-page": "3" } });
    assert.equal(valid.statusCode, 200);
    assert.deepEqual(valid.json(), { query: { limit: 20 }, params: { page: 2 }, header: 3 });
    for (const value of ["abc", "20.5", "0", "101", "", "20&limit=21"]) {
      const result = await app.inject({
        url: `/query-probe/2?limit=${value}`,
        headers: { "x-page": "3" },
      });
      assert.equal(result.statusCode, 422, value);
    }
    assert.equal(
      (await app.inject({ url: "/query-probe/abc?limit=20", headers: { "x-page": "3" } }))
        .statusCode,
      422,
    );
    assert.equal(
      (await app.inject({ url: "/query-probe/2?limit=20", headers: { "x-page": "abc" } }))
        .statusCode,
      422,
    );
  } finally {
    await app.close();
  }
});

test("production SPA fallback never replaces API, evidence or missing-asset errors", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vtc006-http-"));
  await writeFile(join(directory, "index.html"), "<!doctype html><title>Fixture shell</title>");
  await writeFile(
    join(directory, "public-ru.html"),
    "<!doctype html><title>Public RU fixture</title>",
  );
  await writeFile(
    join(directory, "public-en.html"),
    "<!doctype html><title>Public EN fixture</title>",
  );
  await mkdir(join(directory, "assets"));
  await writeFile(join(directory, "assets", "index-Ab12cd34.js"), "export default 1;");
  await writeFile(join(directory, "assets", "unversioned.js"), "export default 2;");
  const app = await createApp({ checkReadiness: async () => true, webRoot: directory });
  try {
    assert.equal(
      (await app.inject("/assets/index-Ab12cd34.js")).headers["cache-control"],
      "public, max-age=31536000, immutable",
    );
    for (const url of [
      "/",
      "/members",
      "/health/live",
      "/assets/unversioned.js",
      "/assets/missing-Ab12cd34.js",
    ])
      assert.equal(
        (await app.inject({ url, headers: { accept: "text/html" } })).headers["cache-control"],
        "no-store",
        url,
      );
    assert.equal(
      (await app.inject({ url: "/", headers: { accept: "text/html" } })).statusCode,
      200,
    );
    assert.equal(
      (await app.inject({ url: "/members", headers: { accept: "text/html" } })).statusCode,
      200,
    );
    assert.ok((await app.inject("/")).body.includes("Public RU fixture"));
    assert.ok((await app.inject("/en")).body.includes("Public EN fixture"));
    for (const url of [
      "/?token=NONFUNCTIONAL_FIXTURE",
      "/en?token=NONFUNCTIONAL_FIXTURE",
      "/unknown",
      "/invitation?token=NONFUNCTIONAL_FIXTURE",
    ]) {
      const result = await app.inject({ url, headers: { accept: "text/html" } });
      assert.ok(result.body.includes("Fixture shell"));
      assert.equal(result.headers["x-robots-tag"], "noindex, nofollow");
      assert.ok(!result.body.includes("NONFUNCTIONAL_FIXTURE"));
    }
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

test("only the allowlisted public summary route keeps its short public cache on 200", async (t) => {
  t.mock.method(console, "error", () => {});
  const app = await createApp({ checkReadiness: async () => true });
  let fail = false;
  app.get("/api/v1/public/company-stats", async (_request, reply) => {
    reply.header("Cache-Control", "public, max-age=60");
    if (fail) throw Object.assign(new Error("PRIVATE_ERROR_DETAIL"), { statusCode: 503 });
    return { ok: true };
  });
  app.get("/api/v1/public/company", async (_request, reply) => {
    reply.header("Cache-Control", "public, max-age=60");
    return { ok: true };
  });
  app.get("/api/v1/public/company-stats/other", async (_request, reply) => {
    reply.header("Cache-Control", "public, max-age=60");
    return { ok: true };
  });
  app.get("/cache-probe/created", async (_request, reply) => {
    reply.header("Cache-Control", "public, max-age=60");
    return reply.code(201).send({ ok: true });
  });
  app.get("/cache-probe/stronger", async (_request, reply) => {
    reply.header("Cache-Control", "public, max-age=3600");
    return { ok: true };
  });
  try {
    const kept = await app.inject("/api/v1/public/company-stats");
    assert.equal(kept.statusCode, 200);
    assert.equal(kept.headers["cache-control"], "public, max-age=60");
    assert.equal(kept.headers["x-content-type-options"], "nosniff");
    // The route pattern, not the query string, decides; schema validation guards real queries.
    assert.equal(
      (await app.inject("/api/v1/public/company-stats?probe=1")).headers["cache-control"],
      "public, max-age=60",
    );
    for (const url of [
      "/api/v1/public/company",
      "/api/v1/public/company-stats/other",
      "/cache-probe/created",
      "/cache-probe/stronger",
    ])
      assert.equal((await app.inject(url)).headers["cache-control"], "no-store", url);
    fail = true;
    const unavailable = await app.inject("/api/v1/public/company-stats");
    assert.equal(unavailable.statusCode, 503);
    assert.equal(unavailable.headers["cache-control"], "no-store");
    assert.ok(!unavailable.body.includes("PRIVATE_ERROR_DETAIL"));
  } finally {
    await app.close();
  }
});
