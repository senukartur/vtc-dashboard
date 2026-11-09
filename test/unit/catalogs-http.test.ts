import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { createApp } from "../../apps/api/src/app.ts";
import { CATALOG_IMPORT_MAX_BYTES } from "../../apps/api/src/modules/catalogs/config.ts";
import type { Catalogs } from "../../apps/api/src/modules/catalogs/service.ts";
import { csrfProtection } from "../../apps/api/src/modules/identity/http.ts";
import type { Actor, Identity } from "../../apps/api/src/modules/identity/service.ts";

const config = { secret: "a".repeat(64), origin: "http://127.0.0.1:4173", production: false },
  id = "30000000-0000-4000-8000-000000000001",
  actor: Actor = {
    userId: "10000000-0000-4000-8000-000000000001",
    sessionId: "20000000-0000-4000-8000-000000000001",
    accessEpoch: 1,
    credentialEpoch: 1,
    capabilities: ["qualifications.manage"],
  };
const previewUrl = "/api/v1/admin/catalogs/cities/import-previews",
  importUrl = "/api/v1/admin/catalogs/cities/imports";
const previewResult = {
  fileSha256: "a".repeat(64),
  token: "signed-token",
  rows: 1,
  added: 1,
  changed: 0,
  unchanged: 0,
  errors: 0,
  lines: [],
  truncated: false,
};
const importResult = { importId: id, rows: 1, added: 1, changed: 0, unchanged: 0 };
const received: Buffer[] = [],
  tokens: string[] = [];
let app: Awaited<ReturnType<typeof createApp>>;

const write = (extra: Record<string, string> = {}) => ({
  cookie: "fixture=placeholder",
  origin: config.origin,
  "x-csrf-token": csrfProtection(config).issue({}, actor).token,
  "idempotency-key": id,
  ...extra,
});
const multipart = (content: string, filename = "fixture.csv") => ({
  headers: { "content-type": "multipart/form-data; boundary=synthetic" },
  payload: `--synthetic\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: text/csv\r\n\r\n${content}\r\n--synthetic--\r\n`,
});
const upload = (url: string, content: string, extra: Record<string, string> = {}) => {
  const body = multipart(content);
  return app.inject({
    method: "POST",
    url,
    headers: write({ ...body.headers, ...extra }),
    payload: body.payload,
  });
};

beforeAll(async () => {
  const identity = { config, authenticate: async () => actor } as unknown as Identity;
  const catalogs = {
    config: { cursorKey: "1".repeat(64) },
    authorize: async () => {},
    previewImport: async (_actor: Actor, _list: string, bytes: Buffer) => {
      received.push(bytes);
      return previewResult;
    },
    applyImport: async (
      _actor: Actor,
      _list: string,
      bytes: Buffer,
      _key: string,
      token: string,
    ) => {
      received.push(bytes);
      tokens.push(token);
      return importResult;
    },
    list: async () => ({ items: [], nextCursor: null, total: 0 }),
    create: async () => {
      throw new Error("SYNTHETIC_CREATE_REACHED");
    },
    patch: async () => {
      throw new Error("SYNTHETIC_PATCH_REACHED");
    },
  } as unknown as Catalogs;
  app = await createApp({ identity, catalogs, checkReadiness: async () => true });
});
afterAll(() => app.close());
beforeEach(() => {
  received.length = 0;
  tokens.length = 0;
});

test("a preview admits one bounded file and passes its bytes through unchanged", async () => {
  const bytes = 'game,code\r\nets2,"_x__x"\r\n';
  const response = await upload(previewUrl, bytes);
  expect({ status: response.statusCode, body: response.json() }).toMatchObject({
    status: 200,
    body: { data: previewResult },
  });
  expect(received.map(String)).toEqual([bytes]);
  const second = multipart("x");
  const extraPart = await app.inject({
    method: "POST",
    url: previewUrl,
    headers: write(second.headers),
    payload: second.payload.replace(
      "--synthetic--",
      `--synthetic\r\nContent-Disposition: form-data; name="file"; filename="b.csv"\r\n\r\ny\r\n--synthetic--`,
    ),
  });
  expect(extraPart.statusCode).toBe(413);
  expect(received.map(String)).toEqual([bytes]);
});

test("an oversized upload gets 413 and never reaches the service", async () => {
  const atLimit = await upload(previewUrl, "x".repeat(CATALOG_IMPORT_MAX_BYTES));
  expect(atLimit.statusCode).toBe(200);
  expect(received.at(-1)).toHaveLength(CATALOG_IMPORT_MAX_BYTES);
  received.length = 0;
  for (const size of [CATALOG_IMPORT_MAX_BYTES + 1, CATALOG_IMPORT_MAX_BYTES + 32768]) {
    const response = await upload(previewUrl, "x".repeat(size));
    expect(response.statusCode).toBe(413);
    expect(response.json().error.code).toBe("CATALOG_FILE_TOO_LARGE");
  }
  expect(received).toEqual([]);
});

test("uploads other than multipart get 415 before any file handling", async () => {
  for (const url of [previewUrl, importUrl]) {
    const response = await app.inject({
      method: "POST",
      url,
      headers: write({ "content-type": "text/csv", "if-match": '"token"' }),
      payload: "game,code",
    });
    expect(response.statusCode).toBe(415);
  }
  expect(received).toEqual([]);
});

test("apply needs the quoted dry-run token: absent 428, malformed 412, present reaches the service", async () => {
  const missing = await upload(importUrl, "x");
  expect(missing.statusCode).toBe(428);
  expect(missing.json().error.code).toBe("CATALOG_IMPORT_TOKEN_REQUIRED");
  for (const value of ["signed-token", '"', '""']) {
    const malformed = await upload(importUrl, "x", { "if-match": value });
    expect(malformed.statusCode).toBe(412);
    expect(malformed.json().error.code).toBe("CATALOG_IMPORT_TOKEN_INVALID");
  }
  expect(received).toEqual([]);
  const applied = await upload(importUrl, "x", { "if-match": '"signed-token"' });
  expect(applied.statusCode).toBe(200);
  expect(applied.json().data).toEqual(importResult);
  expect(tokens).toEqual(["signed-token"]);
});

test("list and write routes enforce their closed schemas before the service", async () => {
  const get = (url: string) =>
    app.inject({ method: "GET", url, headers: { cookie: "fixture=placeholder" } });
  expect((await get("/api/v1/catalogs/cities?game=ets2")).statusCode).toBe(200);
  for (const url of [
    "/api/v1/catalogs/cities",
    "/api/v1/catalogs/cities?game=eu",
    "/api/v1/catalogs/cities?game=ets2&limit=101",
    "/api/v1/catalogs/cities?game=ets2&includeHidden=1",
    "/api/v1/catalogs/cities?game=ets2&dlc=other",
    "/api/v1/catalogs/dlcs?game=ets2&dlc=base",
    "/api/v1/catalogs/regions?game=ets2&regionId=30000000-0000-4000-8000-000000000001",
    "/api/v1/catalogs/cities?game=ets2&unexpected=1",
  ])
    expect((await get(url)).statusCode).toBe(422);
  expect((await get("/api/v1/catalogs/cities/not-a-uuid")).statusCode).toBe(422);
  expect((await get("/api/v1/catalogs/unknown?game=ets2")).statusCode).toBe(404);

  const send = (method: "POST" | "PATCH", url: string, payload: unknown) =>
    app.inject({
      method,
      url,
      headers: write({ "content-type": "application/json" }),
      payload: JSON.stringify(payload),
    });
  const valid = { game: "ets2", code: "fixture_city", nameEn: "Fictional" };
  for (const body of [
    { ...valid, code: "a b" },
    { ...valid, nameEn: "   " },
    { ...valid, unexpected: true },
    { game: "ets2", code: "fixture_city" },
  ])
    expect((await send("POST", "/api/v1/admin/catalogs/cities", body)).statusCode).toBe(422);
  expect(
    (await send("POST", "/api/v1/admin/catalogs/cargoes", { ...valid, adrClass: "5" })).statusCode,
  ).toBe(422);
  expect((await send("PATCH", `/api/v1/admin/catalogs/cities/${id}`, {})).statusCode).toBe(422);
  expect(
    (await send("PATCH", `/api/v1/admin/catalogs/cities/${id}`, { game: "ats" })).statusCode,
  ).toBe(422);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/v1/admin/catalogs/cities",
        headers: write({ "content-type": "text/plain" }),
        payload: JSON.stringify(valid),
      })
    ).statusCode,
  ).toBe(415);
});
