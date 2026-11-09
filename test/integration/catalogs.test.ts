import { randomBytes } from "node:crypto";
import { createUnitOfWork, newId, runMigrations, type UnitOfWork } from "@vtc/db";
import { catalogCities, catalogRegions, eq } from "@vtc/db/catalogs-schema";
import type { Connection, RowDataPacket } from "mysql2/promise";
import {
  beforeEach,
  expect,
  test,
  afterAll as vitestAfterAll,
  beforeAll as vitestBeforeAll,
} from "vitest";
import { createApp } from "../../apps/api/src/app.ts";
import { CATALOG_IMPORT_MAX_BYTES } from "../../apps/api/src/modules/catalogs/config.ts";
import { type Catalogs, createCatalogs } from "../../apps/api/src/modules/catalogs/service.ts";
import { csrfProtection } from "../../apps/api/src/modules/identity/http.ts";
import {
  type Actor,
  createIdentity,
  type Identity,
} from "../../apps/api/src/modules/identity/service.ts";
import { identityAccessEvents } from "../../apps/api/src/platform/outbox/events.ts";
import { catalogConfig } from "../fixtures/catalogs/synthetic.ts";
import {
  guardedSettings,
  reset,
  SCHEMA_SETUP_TIMEOUT_MS,
  testConnection,
} from "../persistence/support.ts";
import { schemaLifecycleHooks } from "../support/schema-lifecycle.ts";

const { beforeAll, afterAll } = schemaLifecycleHooks(vitestBeforeAll, vitestAfterAll);

const origin = "http://127.0.0.1:4173",
  password = "Fictional-catalog-passphrase-42",
  boundary = "vtc-catalog-boundary";
const identityConfig = { secret: randomBytes(32).toString("hex"), origin, production: false };
let instant = Date.parse("2026-10-30T12:00:00.000Z");
const now = () => new Date(instant);
let control: Connection,
  unit: UnitOfWork,
  identity: Identity,
  catalogs: Catalogs,
  director: Actor,
  driver: Actor,
  directorCookie: string,
  driverCookie: string;
const cookieOf = (cookies: string[]) => cookies.map((c) => c.split(";", 1)[0]).join("; ");

async function addMember(roles: ("driver" | "deputy_director")[]) {
  const userId = newId(),
    email = `${userId}@example.invalid`,
    credential = await identity.prepareCredential(password);
  await unit.run((tx) =>
    identity.insertWithCredential(tx, {
      userId,
      email,
      name: "Fictional Catalog Driver",
      ...credential,
      roles,
    }),
  );
  const saved = cookieOf((await identity.login(email, password)).cookies);
  return { actor: await identity.authenticate(new Headers({ cookie: saved })), cookie: saved };
}

beforeAll(async () => {
  control = await testConnection();
  unit = createUnitOfWork(guardedSettings());
  await reset(control);
  await runMigrations(guardedSettings());
  identity = createIdentity(unit, identityConfig, { accessEvents: identityAccessEvents(unit) });
  catalogs = createCatalogs(unit, catalogConfig(), { identity }, now);
  await identity.bootstrap({
    email: "catalog-director@example.invalid",
    name: "Fictional Director",
    password,
  });
  directorCookie = cookieOf(
    (await identity.login("catalog-director@example.invalid", password)).cookies,
  );
  director = await identity.authenticate(new Headers({ cookie: directorCookie }));
  const member = await addMember(["driver"]);
  driver = member.actor;
  driverCookie = member.cookie;
}, SCHEMA_SETUP_TIMEOUT_MS);
beforeEach(async () => {
  instant = Date.parse("2026-10-30T12:00:00.000Z");
  for (const table of [
    "catalog_cities",
    "catalog_cargoes",
    "catalog_trailers",
    "catalog_regions",
    "catalog_dlcs",
    "audit_entries",
    "identity_command_results",
    "identity_limits",
  ])
    await control.query(`DELETE FROM ${table}`);
});
afterAll(async () => {
  await unit?.close();
  await control?.end();
});

const csv = (...rows: string[]) => Buffer.from(`${rows.join("\r\n")}\r\n`);
const cityHeader = "game,code,name_en,name_ru,region_code,dlc_code";
const cityRow = (code: string, name = "Fictional city", ru = "", region = "", dlc = "") =>
  `ets2,${code},${name},${ru},${region},${dlc}`;
const count = async (table: string) => {
  const [rows] = await control.query<RowDataPacket[]>(`SELECT COUNT(*) n FROM ${table}`);
  return Number(rows[0]?.n);
};
const city = (code: string, game: "ets2" | "ats" = "ets2", extra: Record<string, unknown> = {}) =>
  catalogs.create(director, "cities", newId(), { game, code, nameEn: `Name ${code}`, ...extra });
const auditCount = async (operation: string) => {
  const [rows] = await control.query<RowDataPacket[]>(
    "SELECT COUNT(*) n FROM audit_entries WHERE operation=?",
    [operation],
  );
  return Number(rows[0]?.n);
};

test("codes round trip byte-exact through create and import, and search treats wildcards literally", async () => {
  const created = await catalogs.create(director, "trailers", newId(), {
    game: "ets2",
    code: "_x__x",
    nameEn: "Fictional masked body",
  });
  expect(created.code).toBe("_x__x");
  const file = csv("game,code,name_en,name_ru,dlc_code", "ets2,_a__b,Fictional imported body,,");
  const preview = await catalogs.previewImport(director, "trailers", file);
  await catalogs.applyImport(director, "trailers", file, newId(), preview.token as string);
  const [imported] = await control.query<RowDataPacket[]>(
    "SELECT CAST(code AS CHAR) code FROM catalog_trailers ORDER BY name_en",
  );
  expect(imported.map((row) => row.code).sort()).toEqual(["_a__b", "_x__x"]);
  await catalogs.create(director, "trailers", newId(), {
    game: "ets2",
    code: "plain",
    nameEn: "Fictional underscore-free",
  });
  const underscore = await catalogs.list(director, "trailers", { game: "ets2", search: "_" });
  expect(underscore.items.map((item) => item.code).sort()).toEqual(["_a__b", "_x__x"]);
  expect((await catalogs.list(director, "trailers", { game: "ets2", search: "%" })).total).toBe(0);
});

test("code identity is exact per game and never trimmed or merged", async () => {
  await city("Fixed_Code");
  await city("fixed_code");
  await city("fixed_code", "ats");
  await expect(city("fixed_code")).rejects.toMatchObject({
    statusCode: 409,
    publicCode: "CATALOG_CODE_CONFLICT",
  });
  await expect(city("trailing ")).rejects.toMatchObject({ statusCode: 422 });
  expect(await count("catalog_cities")).toBe(3);
});

test("parents must belong to the same game", async () => {
  const atsDlc = await catalogs.create(director, "dlcs", newId(), {
    game: "ats",
    code: "pack",
    nameEn: "Fictional pack",
  });
  await expect(city("c1", "ets2", { dlcId: atsDlc.id })).rejects.toMatchObject({
    statusCode: 422,
    publicCode: "CATALOG_PARENT_INVALID",
  });
  const region = await catalogs.create(director, "regions", newId(), {
    game: "ats",
    code: "region",
    nameEn: "Fictional region",
  });
  await expect(city("c2", "ets2", { regionId: region.id })).rejects.toMatchObject({
    publicCode: "CATALOG_PARENT_INVALID",
  });
  const saved = await city("c3");
  await expect(
    catalogs.patch(director, "cities", saved.id, newId(), { regionId: region.id }),
  ).rejects.toMatchObject({ publicCode: "CATALOG_PARENT_INVALID" });
});

test("a hidden parent cannot be newly linked but stays valid while unchanged", async () => {
  const dlc = await catalogs.create(director, "dlcs", newId(), {
    game: "ets2",
    code: "pack",
    nameEn: "Fictional pack",
  });
  const region = await catalogs.create(director, "regions", newId(), {
    game: "ets2",
    code: "region",
    nameEn: "Fictional region",
  });
  const linked = await city("linked", "ets2", { dlcId: dlc.id, regionId: region.id });
  const free = await city("free");
  await catalogs.patch(director, "dlcs", dlc.id, newId(), { hidden: true });
  await catalogs.patch(director, "regions", region.id, newId(), { hidden: true });
  const parentInvalid = { statusCode: 422, publicCode: "CATALOG_PARENT_INVALID" };
  await expect(city("new_row", "ets2", { dlcId: dlc.id })).rejects.toMatchObject(parentInvalid);
  await expect(city("new_row", "ets2", { regionId: region.id })).rejects.toMatchObject(
    parentInvalid,
  );
  await expect(
    catalogs.patch(director, "cities", free.id, newId(), { dlcId: dlc.id }),
  ).rejects.toMatchObject(parentInvalid);
  await expect(
    catalogs.patch(director, "cities", free.id, newId(), { regionId: region.id }),
  ).rejects.toMatchObject(parentInvalid);
  const unchanged = await catalogs.patch(director, "cities", linked.id, newId(), {
    dlcId: dlc.id,
    regionId: region.id,
    nameEn: "Fictional renamed",
  });
  expect(unchanged).toMatchObject({ dlcId: dlc.id, regionId: region.id });
});

test("keyset pages keep a stable order across duplicate names and hidden rows filter", async () => {
  for (const code of ["c1", "c2", "c3", "c4", "c5"])
    await catalogs.create(director, "cities", newId(), {
      game: "ets2",
      code,
      nameEn: "Duplicate name",
    });
  const seen: string[] = [];
  let cursor: string | undefined;
  for (let pages = 0; pages < 4; pages++) {
    const page = await catalogs.list(director, "cities", {
      game: "ets2",
      limit: 2,
      ...(cursor ? { cursor } : {}),
    });
    seen.push(...page.items.map((item) => item.id));
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  expect(new Set(seen).size).toBe(5);
  expect([...seen].sort()).toEqual(seen);

  const hidden = await city("hidden_row");
  await catalogs.patch(director, "cities", hidden.id, newId(), { hidden: true });
  const visible = await catalogs.list(director, "cities", { game: "ets2", limit: 100 });
  expect(visible.items.map((item) => item.code)).not.toContain("hidden_row");
  const all = await catalogs.list(director, "cities", {
    game: "ets2",
    limit: 100,
    includeHidden: true,
  });
  expect(all.items.map((item) => item.code)).toContain("hidden_row");
  expect((await catalogs.summary(director, "ets2")).lists.cities).toEqual({
    visible: 5,
    hidden: 1,
  });
  await expect(
    catalogs.list(director, "cities", { game: "ets2", cursor: "tampered" }),
  ).rejects.toMatchObject({ statusCode: 409 });
});

test("import preview writes nothing and reports added, changed, unchanged and line issues", async () => {
  await catalogs.create(director, "cities", newId(), {
    game: "ets2",
    code: "existing",
    nameEn: "Before",
  });
  const file = csv(cityHeader, cityRow("fresh"), cityRow("existing", "After"));
  const preview = await catalogs.previewImport(director, "cities", file);
  expect(preview).toMatchObject({ added: 1, changed: 1, unchanged: 0, errors: 0, rows: 2 });
  expect(preview.token).toEqual(expect.any(String));
  expect(await count("catalog_cities")).toBe(1);
  expect(await auditCount("catalog.imported")).toBe(0);

  const bad = csv(cityHeader, cityRow("ok"), "ets2,,No code,,,");
  const rejected = await catalogs.previewImport(director, "cities", bad);
  expect(rejected.errors).toBe(1);
  expect(rejected.token).toBeNull();
  expect(rejected.lines).toEqual([
    expect.objectContaining({ line: 3, status: "error", code: null }),
  ]);
});

test("apply is all-or-nothing when a referenced parent disappears after preview", async () => {
  const region = await catalogs.create(director, "regions", newId(), {
    game: "ets2",
    code: "north_region",
    nameEn: "Fictional region",
  });
  const file = csv(cityHeader, cityRow("good"), cityRow("bad", "Bad", "", "north_region"));
  const preview = await catalogs.previewImport(director, "cities", file);
  await unit.run((tx) =>
    unit.client(tx).delete(catalogRegions).where(eq(catalogRegions.id, region.id)),
  );
  await expect(
    catalogs.applyImport(director, "cities", file, newId(), preview.token as string),
  ).rejects.toMatchObject({ statusCode: 422, publicCode: "CATALOG_IMPORT_INVALID" });
  expect(await count("catalog_cities")).toBe(0);
  expect(await auditCount("catalog.imported")).toBe(0);
});

test("import rejects a newly linked hidden parent but keeps an unchanged hidden link", async () => {
  const dlc = await catalogs.create(director, "dlcs", newId(), {
    game: "ets2",
    code: "hidden_pack",
    nameEn: "Fictional pack",
  });
  const linked = await city("linked_row", "ets2", { dlcId: dlc.id });
  await catalogs.patch(director, "dlcs", dlc.id, newId(), { hidden: true });
  const preview = await catalogs.previewImport(
    director,
    "cities",
    csv(
      cityHeader,
      cityRow("linked_row", "Fictional renamed", "", "", "hidden_pack"),
      cityRow("new_row", "Fictional new", "", "", "hidden_pack"),
    ),
  );
  expect(preview.token).toBeNull();
  expect(preview.errors).toBe(1);
  expect(preview.changed).toBe(1);
  expect(preview.lines).toContainEqual(
    expect.objectContaining({
      code: "new_row",
      status: "error",
      issues: [{ field: "dlc_code", reason: "hidden_reference" }],
    }),
  );
  const clean = csv(cityHeader, cityRow("linked_row", "Fictional renamed", "", "", "hidden_pack"));
  const checked = await catalogs.previewImport(director, "cities", clean);
  await catalogs.applyImport(director, "cities", clean, newId(), checked.token as string);
  expect(await catalogs.get(director, "cities", linked.id)).toMatchObject({
    nameEn: "Fictional renamed",
    dlcId: dlc.id,
  });
});

test("import updates only named values, never deletes and keeps parents and hidden state", async () => {
  const dlc = await catalogs.create(director, "dlcs", newId(), {
    game: "ets2",
    code: "pack",
    nameEn: "Fictional pack",
  });
  const region = await catalogs.create(director, "regions", newId(), {
    game: "ets2",
    code: "region",
    nameEn: "Fictional region",
  });
  const kept = await catalogs.create(director, "cities", newId(), {
    game: "ets2",
    code: "kept",
    nameEn: "Kept",
    nameRu: "Сохранено",
    dlcId: dlc.id,
    regionId: region.id,
  });
  await catalogs.patch(director, "cities", kept.id, newId(), { hidden: true });
  await city("untouched");
  const file = csv(cityHeader, cityRow("kept", "Renamed"));
  const preview = await catalogs.previewImport(director, "cities", file);
  expect(preview).toMatchObject({ added: 0, changed: 1, unchanged: 0 });
  await catalogs.applyImport(director, "cities", file, newId(), preview.token as string);
  const [row] = await unit.run((tx) =>
    unit.client(tx).select().from(catalogCities).where(eq(catalogCities.id, kept.id)),
  );
  expect(row).toMatchObject({
    nameEn: "Renamed",
    nameRu: "Сохранено",
    dlcId: dlc.id,
    regionId: region.id,
    hidden: true,
  });
  expect(await count("catalog_cities")).toBe(2);
});

test("an import records one audit row and replays by key without new effects", async () => {
  const file = csv(cityHeader, cityRow("audited"));
  const preview = await catalogs.previewImport(director, "cities", file);
  const key = newId();
  const first = await catalogs.applyImport(director, "cities", file, key, preview.token as string);
  expect(first).toMatchObject({ added: 1, rows: 1 });
  expect(await auditCount("catalog.imported")).toBe(1);
  const replay = await catalogs.applyImport(director, "cities", file, key, preview.token as string);
  expect(replay).toEqual(first);
  expect(await auditCount("catalog.imported")).toBe(1);
  expect(await count("catalog_cities")).toBe(1);

  const other = csv(cityHeader, cityRow("other_file"));
  const otherPreview = await catalogs.previewImport(director, "cities", other);
  await expect(
    catalogs.applyImport(director, "cities", other, key, otherPreview.token as string),
  ).rejects.toMatchObject({ statusCode: 409, publicCode: "IDEMPOTENCY_CONFLICT" });
  expect(await count("catalog_cities")).toBe(1);
});

test("two concurrent imports of one list serialize without losing or duplicating rows", async () => {
  const first = csv(cityHeader, cityRow("race_one"), cityRow("shared", "From first"));
  const second = csv(cityHeader, cityRow("race_two"), cityRow("shared", "From second"));
  const [a, b] = await Promise.all([
    catalogs.previewImport(director, "cities", first),
    catalogs.previewImport(director, "cities", second),
  ]);
  const results = await Promise.allSettled([
    catalogs.applyImport(director, "cities", first, newId(), a.token as string),
    catalogs.applyImport(director, "cities", second, newId(), b.token as string),
  ]);
  const fulfilled = results.filter((r) => r.status === "fulfilled");
  expect(fulfilled.length).toBeGreaterThanOrEqual(1);
  for (const result of results)
    if (result.status === "rejected")
      expect(result.reason).toMatchObject({ publicCode: "CATALOG_CODE_CONFLICT" });
  const [rows] = await control.query<RowDataPacket[]>(
    "SELECT CAST(code AS CHAR) code FROM catalog_cities",
  );
  expect(new Set(rows.map((row) => row.code)).size).toBe(rows.length);
  expect(rows.map((row) => row.code)).toContain("shared");
});

test("an import token binds the actor, file and time", async () => {
  const file = csv(cityHeader, cityRow("token_row"));
  const preview = await catalogs.previewImport(director, "cities", file);
  const token = preview.token as string;
  const otherFile = csv(cityHeader, cityRow("token_row"), cityRow("smuggled"));
  await expect(
    catalogs.applyImport(director, "cities", otherFile, newId(), token),
  ).rejects.toMatchObject({ statusCode: 412, publicCode: "CATALOG_IMPORT_TOKEN_INVALID" });
  const other = (await addMember(["deputy_director"])).actor;
  await expect(catalogs.applyImport(other, "cities", file, newId(), token)).rejects.toMatchObject({
    statusCode: 412,
  });
  instant += 30 * 60 * 1000 + 1000;
  await expect(
    catalogs.applyImport(director, "cities", file, newId(), token),
  ).rejects.toMatchObject({ publicCode: "CATALOG_IMPORT_TOKEN_INVALID" });
  expect(await count("catalog_cities")).toBe(0);
});

test("a retry after the import token expires returns the stored summary", async () => {
  const file = csv(cityHeader, cityRow("retry_row"));
  const preview = await catalogs.previewImport(director, "cities", file);
  const token = preview.token as string;
  const key = newId();
  const first = await catalogs.applyImport(director, "cities", file, key, token);
  instant += 30 * 60 * 1000 + 1000;
  await expect(catalogs.applyImport(director, "cities", file, key, token)).resolves.toEqual(first);
  await expect(
    catalogs.applyImport(director, "cities", file, newId(), token),
  ).rejects.toMatchObject({ statusCode: 412, publicCode: "CATALOG_IMPORT_TOKEN_INVALID" });
  expect(await count("catalog_cities")).toBe(1);
  expect(await auditCount("catalog.imported")).toBe(1);
});

test("HTTP enforces read permission, staff writes, CSRF and import size", async () => {
  const app = await createApp({ identity, catalogs, checkReadiness: async () => true });
  try {
    expect((await app.inject({ url: "/api/v1/catalogs/cities?game=ets2" })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          url: "/api/v1/catalogs/cities?game=ets2",
          headers: { cookie: driverCookie },
        })
      ).statusCode,
    ).toBe(200);
    const csrf = (cookie: string) =>
      app
        .inject({ url: "/api/v1/auth/csrf", headers: { cookie } })
        .then((response) => response.json().data.token as string);
    const body = { game: "ets2", code: "http_city", nameEn: "HTTP city" };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/admin/catalogs/cities",
          headers: {
            cookie: driverCookie,
            origin,
            "x-csrf-token": await csrf(driverCookie),
            "idempotency-key": newId(),
          },
          payload: body,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/admin/catalogs/cities",
          headers: { cookie: directorCookie, origin, "idempotency-key": newId() },
          payload: body,
        })
      ).statusCode,
    ).toBe(403);
    const token = await csrf(directorCookie);
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/admin/catalogs/cities",
      headers: {
        cookie: directorCookie,
        origin,
        "x-csrf-token": token,
        "idempotency-key": newId(),
      },
      payload: body,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data.code).toBe("http_city");

    const headers = {
      cookie: directorCookie,
      origin,
      "x-csrf-token": token,
      "content-type": `multipart/form-data; boundary=${boundary}`,
    };
    const multipart = (bytes: Buffer) =>
      Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="x.csv"\r\nContent-Type: text/csv\r\n\r\n`,
        ),
        bytes,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
    const file = csv(cityHeader, cityRow("uploaded"));
    const preview = await app.inject({
      method: "POST",
      url: "/api/v1/admin/catalogs/cities/import-previews",
      headers,
      payload: multipart(file),
    });
    expect(preview.statusCode).toBe(200);
    const previewToken = preview.json().data.token as string;

    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/admin/catalogs/cities/import-previews",
          headers: { cookie: directorCookie, origin, "x-csrf-token": token },
          payload: "{}",
        })
      ).statusCode,
    ).toBe(415);
    const tooLarge = await app.inject({
      method: "POST",
      url: "/api/v1/admin/catalogs/cities/import-previews",
      headers,
      payload: multipart(Buffer.alloc(CATALOG_IMPORT_MAX_BYTES + 1024, 0x61)),
    });
    expect(tooLarge.statusCode).toBe(413);
    expect(tooLarge.json().error.code).toBe("CATALOG_FILE_TOO_LARGE");

    const imports = "/api/v1/admin/catalogs/cities/imports";
    expect(
      (
        await app.inject({
          method: "POST",
          url: imports,
          headers: { ...headers, "idempotency-key": newId() },
          payload: multipart(file),
        })
      ).json().error.code,
    ).toBe("CATALOG_IMPORT_TOKEN_REQUIRED");
    expect(
      (
        await app.inject({
          method: "POST",
          url: imports,
          headers: { ...headers, "idempotency-key": newId(), "if-match": "not-quoted" },
          payload: multipart(file),
        })
      ).json().error.code,
    ).toBe("CATALOG_IMPORT_TOKEN_INVALID");
    const applied = await app.inject({
      method: "POST",
      url: imports,
      headers: { ...headers, "idempotency-key": newId(), "if-match": `"${previewToken}"` },
      payload: multipart(file),
    });
    expect(applied.statusCode).toBe(200);
    expect(applied.json().data).toMatchObject({ added: 1 });
    expect(await count("catalog_cities")).toBe(2);
  } finally {
    await app.close();
  }
});
