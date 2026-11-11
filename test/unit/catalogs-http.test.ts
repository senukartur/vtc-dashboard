import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { createApp } from "../../apps/api/src/app.ts";
import {
  CATALOG_IMPORT_MAX_BYTES,
  CATALOG_LOGO_BULK_MAX_BYTES,
  CATALOG_LOGO_BULK_MAX_FILES,
  CATALOG_LOGO_MAX_BYTES,
} from "../../apps/api/src/modules/catalogs/config.ts";
import { identityError } from "../../apps/api/src/modules/identity/service.ts";
import { rgbaLogo, sha256Hex } from "../fixtures/catalogs/logos.ts";
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
type Seen = { op: string; args: unknown[] };
const calls: Seen[] = [];
let authorizeError: unknown = null;
let logoMatcher: ((etag: string) => boolean) | null = null;
const companyItem = {
  id: "40000000-0000-4000-8000-000000000001",
  game: "ets2",
  code: "fictional_co",
  nameEn: "Fictional Freight Co",
  nameRu: null,
  hidden: false,
  display: {
    entityId: "40000000-0000-4000-8000-000000000001",
    label: "Fictional Freight Co",
    requestedLocale: "en",
    renderedLocale: "en",
    englishFallback: false,
    hidden: false,
  },
  dlcId: null,
  dlc: null,
  logo: { version: "0123456789abcdef", byteLength: 100 },
};
const stored = rgbaLogo(7);
const storedEtag = sha256Hex(stored);
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
    authorize: async () => {
      if (authorizeError) throw authorizeError;
    },
    setLogo: async (_actor: Actor, companyId: string, _key: string, bytes: Buffer) => {
      calls.push({ op: "setLogo", args: [companyId, bytes] });
      return companyItem;
    },
    removeLogo: async (_actor: Actor, companyId: string) => {
      calls.push({ op: "removeLogo", args: [companyId] });
      return { ...companyItem, logo: null };
    },
    readLogo: async (_actor: Actor, companyId: string, matches: (etag: string) => boolean) => {
      calls.push({ op: "readLogo", args: [companyId] });
      logoMatcher = matches;
      const version = storedEtag.slice(0, 16);
      return matches(storedEtag)
        ? { etag: storedEtag, version, png: null }
        : { etag: storedEtag, version, png: stored };
    },
    previewLogos: async (
      _actor: Actor,
      game: string,
      files: { name: string; bytes: Buffer; truncated: boolean }[],
    ) => {
      calls.push({ op: "previewLogos", args: [game, files] });
      return previewResult;
    },
    applyLogos: async (
      _actor: Actor,
      game: string,
      files: { name: string; bytes: Buffer; truncated: boolean }[],
      _key: string,
      token: string,
    ) => {
      calls.push({ op: "applyLogos", args: [game, files, token] });
      return importResult;
    },
    listDepots: async (_actor: Actor, query: unknown) => {
      calls.push({ op: "listDepots", args: [query] });
      return { items: [], nextCursor: null, total: 0 };
    },
    createDepot: async () => {
      throw new Error("SYNTHETIC_DEPOT_CREATE_REACHED");
    },
    patchDepot: async () => {
      throw new Error("SYNTHETIC_DEPOT_PATCH_REACHED");
    },
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
    list: async (_actor: Actor, list: string, query: unknown) => {
      calls.push({ op: "list", args: [list, query] });
      return { items: [], nextCursor: null, total: 0 };
    },
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
  calls.length = 0;
  authorizeError = null;
  logoMatcher = null;
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
    { ...valid, updatedAt: "2026-11-11T12:00:00.000Z" },
    { ...valid, depotCount: 1 },
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

test("maintenance filters validate literal values and only companies accept the logo filter", async () => {
  const get = (list: string, filters: string) =>
    app.inject({ url: `/api/v1/catalogs/${list}?game=ets2&${filters}` });
  const commonQuery = { game: "ets2", hidden: "only", includeHidden: true, untranslated: true };
  for (const list of ["dlcs", "regions", "cities", "companies", "cargoes", "trailers", "depots"]) {
    const filters = "hidden=only&includeHidden=true&untranslated=true";
    expect((await get(list, filters)).statusCode).toBe(200);
    expect(calls.pop()).toEqual(
      list === "depots"
        ? { op: "listDepots", args: [commonQuery] }
        : { op: "list", args: [list, commonQuery] },
    );
    for (const invalid of [
      "hidden=true",
      "hidden=visible",
      "untranslated=false",
      "untranslated=1",
      "untranslated=True",
      "untranslated=true&untranslated=true",
      ...(list === "companies" ? ["logo=present"] : ["logo=missing"]),
    ]) {
      expect((await get(list, invalid)).statusCode).toBe(422);
    }
  }
  expect(calls).toEqual([]);
  expect((await get("companies", "logo=missing")).statusCode).toBe(200);
  expect(calls).toEqual([
    {
      op: "list",
      args: [
        "companies",
        { game: "ets2", logo: "missing", includeHidden: false, untranslated: false },
      ],
    },
  ]);
});

const companyId = "40000000-0000-4000-8000-000000000001";
const logoUrl = `/api/v1/admin/catalogs/companies/${companyId}/logo`;
const logoPreviewUrl = "/api/v1/admin/catalogs/companies/logo-previews?game=ets2";
const logoImportUrl = "/api/v1/admin/catalogs/companies/logo-imports?game=ets2";
const part = (name: string, bytes: Buffer, field = "file") =>
  Buffer.concat([
    Buffer.from(
      `--synthetic\r\nContent-Disposition: form-data; name="${field}"; filename="${name}"\r\nContent-Type: image/png\r\n\r\n`,
    ),
    bytes,
    Buffer.from("\r\n"),
  ]);
const batch = (...parts: Buffer[]) => Buffer.concat([...parts, Buffer.from("--synthetic--\r\n")]);
const formHeaders = { "content-type": "multipart/form-data; boundary=synthetic" };
const send = (method: "PUT" | "POST", url: string, payload: Buffer, extra = {}) =>
  app.inject({ method, url, headers: write({ ...formHeaders, ...extra }), payload });
const sentFiles = (op: string) =>
  (calls.find((call) => call.op === op)?.args[1] ?? []) as {
    name: string;
    bytes: Buffer;
    truncated: boolean;
  }[];

test("a single logo upload passes its bytes to the service and is bounded by the logo size", async () => {
  const png = rgbaLogo(1);
  const ok = await send("PUT", logoUrl, batch(part("logo.png", png)));
  expect(ok.statusCode).toBe(200);
  expect(calls).toEqual([{ op: "setLogo", args: [companyId, png] }]);
  calls.length = 0;
  // The limit applies to the file, not to the framing around it.
  const atLimit = await send(
    "PUT",
    logoUrl,
    batch(part("logo.png", Buffer.alloc(CATALOG_LOGO_MAX_BYTES))),
  );
  expect(atLimit.statusCode).toBe(200);
  calls.length = 0;
  const over = await send(
    "PUT",
    logoUrl,
    batch(part("logo.png", Buffer.alloc(CATALOG_LOGO_MAX_BYTES + 1))),
  );
  expect({ status: over.statusCode, code: over.json().error.code }).toEqual({
    status: 413,
    code: "CATALOG_FILE_TOO_LARGE",
  });
  const huge = await send("PUT", logoUrl, batch(part("logo.png", Buffer.alloc(200 * 1024))));
  expect(huge.statusCode).toBe(413);
  expect(calls).toEqual([]);
});

test("a single logo upload is multipart with exactly one named file part", async () => {
  const png = rgbaLogo(1);
  const wrongType = await app.inject({
    method: "PUT",
    url: logoUrl,
    headers: write({ "content-type": "image/png" }),
    payload: png,
  });
  expect(wrongType.statusCode).toBe(415);
  const wrongField = await send("PUT", logoUrl, batch(part("logo.png", png, "image")));
  expect(wrongField.statusCode).toBe(422);
  const twoFiles = await send("PUT", logoUrl, batch(part("a.png", png), part("b.png", png)));
  expect([413, 422]).toContain(twoFiles.statusCode);
  const noFile = await send("PUT", logoUrl, Buffer.from("--synthetic--\r\n"));
  expect(noFile.statusCode).toBe(422);
  const noKey = await send("PUT", logoUrl, batch(part("logo.png", png)), {
    "idempotency-key": "x",
  });
  expect(noKey.statusCode).toBe(422);
  const badId = await send(
    "PUT",
    "/api/v1/admin/catalogs/companies/not-a-uuid/logo",
    batch(part("l.png", png)),
  );
  expect(badId.statusCode).toBe(422);
  expect(calls).toEqual([]);
});

test("removing a logo needs no body but still needs the session and the CSRF token", async () => {
  const headers = write();
  const removed = await app.inject({ method: "DELETE", url: logoUrl, headers });
  expect(removed.statusCode).toBe(200);
  expect(calls).toEqual([{ op: "removeLogo", args: [companyId] }]);
  calls.length = 0;
  const { "x-csrf-token": _token, ...withoutCsrf } = headers;
  expect(
    (await app.inject({ method: "DELETE", url: logoUrl, headers: withoutCsrf })).statusCode,
  ).toBe(403);
  const { origin: _origin, ...withoutOrigin } = headers;
  expect(
    (await app.inject({ method: "DELETE", url: logoUrl, headers: withoutOrigin })).statusCode,
  ).toBe(403);
  const { "idempotency-key": _key, ...withoutKey } = headers;
  expect(
    (await app.inject({ method: "DELETE", url: logoUrl, headers: withoutKey })).statusCode,
  ).toBe(422);
  // A body on the delete is not part of the contract.
  const withBody = await app.inject({
    method: "DELETE",
    url: logoUrl,
    headers: write({ "content-type": "text/plain" }),
    payload: "x",
  });
  expect(withBody.statusCode).toBe(415);
  // The exception is for this one route: other body-less writes stay 415.
  const patch = await app.inject({
    method: "PATCH",
    url: `/api/v1/admin/catalogs/cities/${id}`,
    headers: write(),
  });
  expect(patch.statusCode).toBe(415);
  expect(calls).toEqual([]);
  // A caller without the staff capability is refused before the service sees anything.
  authorizeError = identityError(403);
  expect((await app.inject({ method: "DELETE", url: logoUrl, headers })).statusCode).toBe(403);
  expect(calls).toEqual([]);
});

test("a logo batch keeps submission order, names and a per-file truncation flag", async () => {
  const a = rgbaLogo(1),
    b = rgbaLogo(2, 20, 8);
  const oversized = Buffer.alloc(CATALOG_LOGO_MAX_BYTES + 500, 1);
  const response = await send(
    "POST",
    logoPreviewUrl,
    batch(part("first_co.png", a), part("sub/dir.png", b), part("big_co.png", oversized)),
  );
  expect(response.statusCode).toBe(200);
  const files = sentFiles("previewLogos");
  // The path is kept so the dry run can name it as a bad file name instead of using its basename.
  expect(files.map((file) => file.name)).toEqual(["first_co.png", "sub/dir.png", "big_co.png"]);
  expect(files.map((file) => file.truncated)).toEqual([false, false, true]);
  expect(files[0]?.bytes.equals(a)).toBe(true);
  expect(files[1]?.bytes.equals(b)).toBe(true);
  expect(files[2]?.bytes).toHaveLength(CATALOG_LOGO_MAX_BYTES);
  expect(calls[0]?.args[0]).toBe("ets2");
});

test("a logo batch rejects fields, other part names, empty uploads and a 501st file", async () => {
  const png = rgbaLogo(1);
  const field = Buffer.from(
    '--synthetic\r\nContent-Disposition: form-data; name="note"\r\n\r\nhello\r\n',
  );
  // A text field trips the parser's no-fields limit, as for the CSV upload.
  expect((await send("POST", logoPreviewUrl, batch(part("a.png", png), field))).statusCode).toBe(
    413,
  );
  for (const payload of [batch(part("a.png", png, "other")), Buffer.from("--synthetic--\r\n")])
    expect((await send("POST", logoPreviewUrl, payload)).statusCode).toBe(422);
  const many = Array.from({ length: CATALOG_LOGO_BULK_MAX_FILES + 1 }, (_, n) =>
    part(`c${n}.png`, png.subarray(0, 8)),
  );
  expect((await send("POST", logoPreviewUrl, batch(...many))).statusCode).toBe(413);
  const limit = Array.from({ length: CATALOG_LOGO_BULK_MAX_FILES }, (_, n) =>
    part(`c${n}.png`, png.subarray(0, 8)),
  );
  expect((await send("POST", logoPreviewUrl, batch(...limit))).statusCode).toBe(200);
  expect(sentFiles("previewLogos")).toHaveLength(CATALOG_LOGO_BULK_MAX_FILES);
  calls.length = 0;
  const noGame = await send(
    "POST",
    "/api/v1/admin/catalogs/companies/logo-previews",
    batch(part("a.png", png)),
  );
  expect(noGame.statusCode).toBe(422);
  const badGame = await send(
    "POST",
    "/api/v1/admin/catalogs/companies/logo-previews?game=eu",
    batch(part("a.png", png)),
  );
  expect(badGame.statusCode).toBe(422);
  const notMultipart = await app.inject({
    method: "POST",
    url: logoPreviewUrl,
    headers: write({ "content-type": "application/json" }),
    payload: "{}",
  });
  expect(notMultipart.statusCode).toBe(415);
  expect(calls).toEqual([]);
});

test("a logo batch larger than the total bound gets 413 before the service", async () => {
  const oversizedHeader = await app.inject({
    method: "POST",
    url: logoPreviewUrl,
    headers: write({
      ...formHeaders,
      "content-length": String(
        CATALOG_LOGO_BULK_MAX_BYTES + CATALOG_LOGO_BULK_MAX_FILES * 1024 + 1,
      ),
    }),
    payload: Buffer.from("--synthetic--\r\n"),
  });
  expect(oversizedHeader.statusCode).toBe(413);
  expect(oversizedHeader.json().error.code).toBe("CATALOG_FILE_TOO_LARGE");
  expect(calls).toEqual([]);
});

test("applying a logo batch needs the quoted dry-run token and passes the files and token on", async () => {
  const png = rgbaLogo(1);
  const body = batch(part("fictional_co.png", png));
  const missing = await send("POST", logoImportUrl, body);
  expect(missing.statusCode).toBe(428);
  expect(missing.json().error.code).toBe("CATALOG_IMPORT_TOKEN_REQUIRED");
  const malformed = await send("POST", logoImportUrl, body, { "if-match": "signed-token" });
  expect(malformed.statusCode).toBe(412);
  expect(calls).toEqual([]);
  const applied = await send("POST", logoImportUrl, body, { "if-match": '"signed-token"' });
  expect(applied.statusCode).toBe(200);
  expect(applied.json().data).toEqual(importResult);
  expect(calls[0]?.args[0]).toBe("ets2");
  expect(calls[0]?.args[2]).toBe("signed-token");
  expect(sentFiles("applyLogos").map((file) => file.name)).toEqual(["fictional_co.png"]);
});

const read = (headers: Record<string, string> = {}, query = "") =>
  app.inject({
    method: "GET",
    url: `/api/v1/catalogs/companies/${companyId}/logo${query}`,
    headers: { cookie: "fixture=placeholder", ...headers },
  });

test("the logo is served with exact private cache headers keyed by version", async () => {
  const version = storedEtag.slice(0, 16);
  const current = await read({}, `?v=${version}`);
  expect(current.statusCode).toBe(200);
  expect(current.rawPayload.equals(stored)).toBe(true);
  expect(current.headers).toMatchObject({
    "content-type": "image/png",
    "content-length": String(stored.length),
    etag: `"${storedEtag}"`,
    vary: "Cookie",
    "x-content-type-options": "nosniff",
    "content-disposition": "inline",
    "cache-control": "private, max-age=86400",
  });
  // A stale, absent or malformed-but-allowed version must revalidate instead of living a day.
  for (const query of ["", "?v=0000000000000000"]) {
    const revalidate = await read({}, query);
    expect(revalidate.statusCode).toBe(200);
    expect(revalidate.headers["cache-control"]).toBe("private, no-cache");
    expect(revalidate.headers.etag).toBe(`"${storedEtag}"`);
  }
  expect((await read({}, "?v=not-a-version")).statusCode).toBe(422);
  expect((await read({}, `?v=${version}&x=1`)).statusCode).toBe(422);
});

test("a matching validator gets 304 without a body, keeping the cache policy", async () => {
  const version = storedEtag.slice(0, 16);
  for (const header of [`"${storedEtag}"`, `W/"${storedEtag}"`, "*", `"other", "${storedEtag}"`]) {
    const response = await read({ "if-none-match": header }, `?v=${version}`);
    expect(response.statusCode, header).toBe(304);
    expect(response.rawPayload).toHaveLength(0);
    expect(response.headers.etag).toBe(`"${storedEtag}"`);
    expect(response.headers["cache-control"]).toBe("private, max-age=86400");
    expect(response.headers.vary).toBe("Cookie");
  }
  const stale = await read({ "if-none-match": `"${storedEtag}"` });
  expect(stale.statusCode).toBe(304);
  expect(stale.headers["cache-control"]).toBe("private, no-cache");
  const different = await read({ "if-none-match": `"${"0".repeat(64)}"` });
  expect(different.statusCode).toBe(200);
  expect(logoMatcher?.(storedEtag)).toBe(false);
});

test("a conditional logo request is authorized before it can be answered 304", async () => {
  authorizeError = identityError(403);
  const forbidden = await read({ "if-none-match": `"${storedEtag}"` });
  expect(forbidden.statusCode).toBe(403);
  expect(forbidden.headers["cache-control"]).toBe("no-store");
  expect(forbidden.headers.etag).toBeUndefined();
  authorizeError = identityError(401);
  expect((await read({ "if-none-match": "*" })).statusCode).toBe(401);
  expect(calls).toEqual([]);
});

test("only the logo route is cached; every other catalog response stays no-store", async () => {
  const list = await app.inject({
    method: "GET",
    url: "/api/v1/catalogs/companies?game=ets2",
    headers: { cookie: "fixture=placeholder" },
  });
  expect(list.statusCode).toBe(200);
  expect(list.headers["cache-control"]).toBe("no-store");
  const depots = await app.inject({
    method: "GET",
    url: "/api/v1/catalogs/depots?game=ets2",
    headers: { cookie: "fixture=placeholder" },
  });
  expect(depots.statusCode).toBe(200);
  expect(depots.headers["cache-control"]).toBe("no-store");
  const staff = await send("POST", logoPreviewUrl, batch(part("a.png", rgbaLogo(1))));
  expect(staff.headers["cache-control"]).toBe("no-store");
});

test("depot routes enforce closed schemas before the service", async () => {
  const get = (url: string) =>
    app.inject({ method: "GET", url, headers: { cookie: "fixture=placeholder" } });
  expect(
    (await get(`/api/v1/catalogs/depots?game=ets2&companyId=${companyId}&cityId=${id}&dlc=base`))
      .statusCode,
  ).toBe(200);
  expect(calls[0]?.args[0]).toMatchObject({ game: "ets2", companyId, cityId: id, dlc: "base" });
  for (const url of [
    "/api/v1/catalogs/depots",
    "/api/v1/catalogs/depots?game=ets2&companyId=nope",
    "/api/v1/catalogs/depots?game=ets2&cityId=nope",
    `/api/v1/catalogs/depots?game=ets2&regionId=${id}`,
    "/api/v1/catalogs/depots?game=ets2&limit=101",
    "/api/v1/catalogs/depots?game=ets2&unexpected=1",
  ])
    expect((await get(url)).statusCode, url).toBe(422);
  const json = (method: "POST" | "PATCH", url: string, payload: unknown) =>
    app.inject({
      method,
      url,
      headers: write({ "content-type": "application/json" }),
      payload: JSON.stringify(payload),
    });
  const valid = { game: "ets2", companyId, cityId: id };
  for (const body of [
    { ...valid, unexpected: true },
    { game: "ets2", companyId },
    { ...valid, companyId: "nope" },
    { ...valid, game: "eu" },
  ])
    expect((await json("POST", "/api/v1/admin/catalogs/depots", body)).statusCode).toBe(422);
  const depotUrl = `/api/v1/admin/catalogs/depots/${id}`;
  for (const body of [
    {},
    { companyId },
    { cityId: id },
    { game: "ats" },
    { hidden: "yes" },
    { hidden: true, updatedAt: "2026-11-11T12:00:00.000Z" },
  ])
    expect((await json("PATCH", depotUrl, body)).statusCode).toBe(422);
  // A valid body reaches the service, which here stands in for the transaction.
  await expect(json("POST", "/api/v1/admin/catalogs/depots", valid)).resolves.toMatchObject({
    statusCode: 500,
  });
  await expect(json("PATCH", depotUrl, { hidden: true })).resolves.toMatchObject({
    statusCode: 500,
  });
  // Depot import shares the file flow of the lists.
  const depotImport = await upload(
    "/api/v1/admin/catalogs/depots/import-previews",
    "game,company_code\r\n",
  );
  expect(depotImport.statusCode).toBe(200);
});
