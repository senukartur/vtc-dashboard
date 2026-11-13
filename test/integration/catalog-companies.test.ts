import { randomBytes } from "node:crypto";
import { createUnitOfWork, newId, runMigrations, type UnitOfWork } from "@vtc/db";
import { catalogCompanies, catalogCompanyLogos, eq } from "@vtc/db/catalogs-schema";
import type { Connection, RowDataPacket } from "mysql2/promise";
import {
  beforeEach,
  expect,
  test,
  afterAll as vitestAfterAll,
  beforeAll as vitestBeforeAll,
} from "vitest";
import { createApp } from "../../apps/api/src/app.ts";
import {
  CATALOG_LOGO_BULK_MAX_BYTES,
  CATALOG_LOGO_MAX_BYTES,
} from "../../apps/api/src/modules/catalogs/config.ts";
import { cursorCodec } from "../../apps/api/src/modules/catalogs/cursor.ts";
import { type Catalogs, createCatalogs } from "../../apps/api/src/modules/catalogs/service.ts";
import {
  type Actor,
  createIdentity,
  type Identity,
} from "../../apps/api/src/modules/identity/service.ts";
import { identityAccessEvents } from "../../apps/api/src/platform/outbox/events.ts";
import {
  greyAlphaLogo,
  jpegLike,
  paletteLogo,
  rgbaLogo,
  sha256Hex,
} from "../fixtures/catalogs/logos.ts";
import { catalogConfig } from "../fixtures/catalogs/synthetic.ts";
import {
  guardedSettings,
  hasCode,
  reset,
  SCHEMA_SETUP_TIMEOUT_MS,
  testConnection,
} from "../persistence/support.ts";
import { schemaLifecycleHooks } from "../support/schema-lifecycle.ts";

const { beforeAll, afterAll } = schemaLifecycleHooks(vitestBeforeAll, vitestAfterAll);

const origin = "http://127.0.0.1:4173",
  password = "Fictional-company-passphrase-42",
  boundary = "vtc-company-boundary";
const identityConfig = { secret: randomBytes(32).toString("hex"), origin, production: false };
const catalogSettings = catalogConfig();
let instant = Date.parse("2026-11-10T12:00:00.000Z");
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
      name: "Fictional Company Driver",
      ...credential,
      roles,
    }),
  );
  const saved = cookieOf((await identity.login(email, password)).cookies);
  return {
    userId,
    actor: await identity.authenticate(new Headers({ cookie: saved })),
    cookie: saved,
  };
}

beforeAll(async () => {
  control = await testConnection();
  unit = createUnitOfWork(guardedSettings());
  await reset(control);
  await runMigrations(guardedSettings());
  identity = createIdentity(unit, identityConfig, { accessEvents: identityAccessEvents(unit) });
  catalogs = createCatalogs(unit, catalogSettings, { identity }, now);
  await identity.bootstrap({
    email: "company-director@example.invalid",
    name: "Fictional Director",
    password,
  });
  directorCookie = cookieOf(
    (await identity.login("company-director@example.invalid", password)).cookies,
  );
  director = await identity.authenticate(new Headers({ cookie: directorCookie }));
  const member = await addMember(["driver"]);
  driver = member.actor;
  driverCookie = member.cookie;
}, SCHEMA_SETUP_TIMEOUT_MS);
beforeEach(async () => {
  instant = Date.parse("2026-11-10T12:00:00.000Z");
  for (const table of [
    "catalog_company_logos",
    "catalog_company_cities",
    "catalog_companies",
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

type Game = "ets2" | "ats";
const company = (code: string, game: Game = "ets2", extra: Record<string, unknown> = {}) =>
  catalogs.create(director, "companies", newId(), {
    game,
    code,
    nameEn: `Company ${code}`,
    ...extra,
  });
const city = (code: string, game: Game = "ets2", extra: Record<string, unknown> = {}) =>
  catalogs.create(director, "cities", newId(), { game, code, nameEn: `City ${code}`, ...extra });
const dlc = (code: string, game: Game = "ets2") =>
  catalogs.create(director, "dlcs", newId(), { game, code, nameEn: `Pack ${code}` });
const depot = (
  companyId: string,
  cityId: string,
  game: Game = "ets2",
  extra: Record<string, unknown> = {},
) => catalogs.createDepot(director, newId(), { game, companyId, cityId, ...extra });
const csv = (...rows: string[]) => Buffer.from(`${rows.join("\r\n")}\r\n`);
const count = async (table: string) => {
  const [rows] = await control.query<RowDataPacket[]>(`SELECT COUNT(*) n FROM ${table}`);
  return Number(rows[0]?.n);
};
const auditCount = async (operation: string) => {
  const [rows] = await control.query<RowDataPacket[]>(
    "SELECT COUNT(*) n FROM audit_entries WHERE operation=?",
    [operation],
  );
  return Number(rows[0]?.n);
};
const storedLogo = async (companyId: string) => {
  const [rows] = await control.query<RowDataPacket[]>(
    "SELECT png, byte_length, HEX(sha256) sha, CAST(updated_at AS CHAR) updated FROM catalog_company_logos WHERE company_id=?",
    [companyId],
  );
  return rows[0];
};
const file = (name: string, bytes: Buffer, truncated = false) => ({ name, bytes, truncated });

test("depots keep the company, city and source in one game, enforced by the database", async () => {
  const etsCity = await city("shared_city");
  const atsCompany = await company("shared_co", "ats");
  const etsCompany = await company("shared_co");
  const atsPack = await dlc("ats_pack", "ats");
  await expect(
    control.execute(
      "INSERT INTO catalog_company_cities (id,game,company_id,city_id) VALUES (?,'ets2',?,?)",
      [newId(), atsCompany.id, etsCity.id],
    ),
  ).rejects.toSatisfy(hasCode("ER_NO_REFERENCED_ROW_2"));
  await expect(
    control.execute(
      "INSERT INTO catalog_company_cities (id,game,company_id,city_id) VALUES (?,'ats',?,?)",
      [newId(), etsCompany.id, etsCity.id],
    ),
  ).rejects.toSatisfy(hasCode("ER_NO_REFERENCED_ROW_2"));
  await expect(
    control.execute(
      "INSERT INTO catalog_companies (id,game,code,name_en,dlc_id) VALUES (?,'ets2','dlc_co','Pack Co',?)",
      [newId(), atsPack.id],
    ),
  ).rejects.toSatisfy(hasCode("ER_NO_REFERENCED_ROW_2"));
  await expect(
    control.execute(
      "INSERT INTO catalog_company_cities (id,game,company_id,city_id,dlc_id) VALUES (?,'ets2',?,?,?)",
      [newId(), etsCompany.id, etsCity.id, atsPack.id],
    ),
  ).rejects.toSatisfy(hasCode("ER_NO_REFERENCED_ROW_2"));
  // The service reports the same mistakes as a safe parent error before touching the database.
  await expect(depot(atsCompany.id, etsCity.id, "ets2")).rejects.toMatchObject({
    statusCode: 422,
    publicCode: "CATALOG_PARENT_INVALID",
  });
  await expect(
    depot(etsCompany.id, etsCity.id, "ets2", { dlcId: atsPack.id }),
  ).rejects.toMatchObject({ statusCode: 422, publicCode: "CATALOG_PARENT_INVALID" });
  await expect(depot(newId(), etsCity.id)).rejects.toMatchObject({
    publicCode: "CATALOG_PARENT_INVALID",
  });
  expect(await count("catalog_company_cities")).toBe(0);
  // A referenced company, city or logo cannot be deleted from under a depot.
  const made = await depot(etsCompany.id, etsCity.id);
  expect(made.company.code).toBe("shared_co");
  await expect(
    control.execute("DELETE FROM catalog_companies WHERE id=?", [etsCompany.id]),
  ).rejects.toSatisfy(hasCode("ER_ROW_IS_REFERENCED_2"));
  await expect(
    control.execute("DELETE FROM catalog_cities WHERE id=?", [etsCity.id]),
  ).rejects.toSatisfy(hasCode("ER_ROW_IS_REFERENCED_2"));
});

test("a company and a city may share a code and a company code may repeat across games", async () => {
  const c = await company("same_code");
  const k = await city("same_code");
  await company("same_code", "ats");
  await expect(company("same_code")).rejects.toMatchObject({
    statusCode: 409,
    publicCode: "CATALOG_CODE_CONFLICT",
  });
  // Recognition reads only the three telemetry kinds and never mistakes a company for a city.
  await expect(
    unit.run((tx) =>
      catalogs.resolveInTransaction(tx, { game: "ets2", kind: "city", code: "same_code" }),
    ),
  ).resolves.toMatchObject({ status: "resolved", id: k.id });
  const cargo = await catalogs.create(director, "cargoes", newId(), {
    game: "ets2",
    code: "same_code",
    nameEn: "Cargo same",
  });
  await expect(
    unit.run((tx) =>
      catalogs.resolveInTransaction(tx, { game: "ets2", kind: "cargo", code: "same_code" }),
    ),
  ).resolves.toMatchObject({ status: "resolved", id: cargo.id });
  await expect(
    unit.run((tx) => catalogs.selectionsInTransaction(tx, [{ kind: "city", id: c.id }])),
  ).resolves.toEqual(new Map());
  await expect(
    unit.run((tx) => catalogs.labelsInTransaction(tx, [{ kind: "city", id: k.id }], "en")),
  ).resolves.toHaveProperty("size", 1);
});

test("one company in one city exists once, and the duplicate is a conflict", async () => {
  const c = await company("dup_co");
  const k = await city("dup_city");
  await depot(c.id, k.id);
  await expect(depot(c.id, k.id)).rejects.toMatchObject({
    statusCode: 409,
    publicCode: "CATALOG_CODE_CONFLICT",
  });
  await expect(
    control.execute(
      "INSERT INTO catalog_company_cities (id,game,company_id,city_id) VALUES (?,'ets2',?,?)",
      [newId(), c.id, k.id],
    ),
  ).rejects.toSatisfy(hasCode("ER_DUP_ENTRY"));
  expect(await count("catalog_company_cities")).toBe(1);
  // The same key replays the stored result instead of colliding.
  const key = newId();
  const other = await city("dup_city_two");
  const first = await catalogs.createDepot(director, key, {
    game: "ets2",
    companyId: c.id,
    cityId: other.id,
  });
  await expect(
    catalogs.createDepot(director, key, { game: "ets2", companyId: c.id, cityId: other.id }),
  ).resolves.toEqual(first);
  expect(await count("catalog_company_cities")).toBe(2);
});

test("hidden rows stay readable but cannot be newly linked, and an unchanged link stays valid", async () => {
  const pack = await dlc("hidden_pack");
  const c = await company("hide_co");
  const k = await city("hide_city");
  const k2 = await city("hide_city_two");
  const linked = await depot(c.id, k.id, "ets2", { dlcId: pack.id });
  await catalogs.patch(director, "companies", c.id, newId(), { hidden: true });
  await catalogs.patch(director, "dlcs", pack.id, newId(), { hidden: true });
  const parentInvalid = { statusCode: 422, publicCode: "CATALOG_PARENT_INVALID" };
  await expect(depot(c.id, k2.id)).rejects.toMatchObject(parentInvalid);
  const visible = await company("visible_co");
  await expect(depot(visible.id, k2.id, "ets2", { dlcId: pack.id })).rejects.toMatchObject(
    parentInvalid,
  );
  await catalogs.patch(director, "cities", k2.id, newId(), { hidden: true });
  await expect(depot(visible.id, k2.id)).rejects.toMatchObject(parentInvalid);
  // Editing the depot keeps its hidden source; it can still change the hidden flag and be hidden.
  const edited = await catalogs.patchDepot(director, linked.id, newId(), { dlcId: pack.id });
  expect(edited).toMatchObject({ dlcId: pack.id, company: { label: { hidden: true } } });
  await expect(
    catalogs.patchDepot(director, linked.id, newId(), { dlcId: (await dlc("other_pack")).id }),
  ).resolves.toMatchObject({ hidden: false });
  await expect(
    catalogs.patchDepot(director, linked.id, newId(), { dlcId: pack.id }),
  ).rejects.toMatchObject(parentInvalid);
  await expect(
    catalogs.patchDepot(director, newId(), newId(), { hidden: true }),
  ).rejects.toMatchObject({
    statusCode: 404,
    publicCode: "CATALOG_ROW_NOT_FOUND",
  });

  const defaults = await catalogs.listDepots(director, { game: "ets2", limit: 100 });
  expect(defaults.items).toEqual([]);
  const everything = await catalogs.listDepots(director, {
    game: "ets2",
    limit: 100,
    includeHidden: true,
  });
  expect(everything.items.map((item) => item.id)).toEqual([linked.id]);
  expect(everything.items[0]).toMatchObject({
    hidden: false,
    company: { label: { hidden: true } },
    city: { label: { hidden: false } },
  });
  // The company is still readable by id and in its list.
  expect((await catalogs.get(director, "companies", c.id)).hidden).toBe(true);
  expect(
    (await catalogs.list(director, "companies", { game: "ets2" })).items.map((i) => i.code),
  ).toEqual(["visible_co"]);
});

test("a depot is listed by default only when the depot, company and city are all visible", async () => {
  const c = await company("vis_co");
  const k = await city("vis_city");
  const d = await depot(c.id, k.id);
  const ids = async () =>
    (await catalogs.listDepots(director, { game: "ets2" })).items.map((item) => item.id);
  expect(await ids()).toEqual([d.id]);
  await catalogs.patchDepot(director, d.id, newId(), { hidden: true });
  expect(await ids()).toEqual([]);
  await catalogs.patchDepot(director, d.id, newId(), { hidden: false });
  await catalogs.patch(director, "cities", k.id, newId(), { hidden: true });
  expect(await ids()).toEqual([]);
  await catalogs.patch(director, "cities", k.id, newId(), { hidden: false });
  expect(await ids()).toEqual([d.id]);
  const summary = await catalogs.summary(director, "ets2");
  // Companies and depots carry no translation, so the summary counts none missing.
  expect(summary.lists.depots).toEqual({ visible: 1, hidden: 0 });
  expect(summary.lists.companies).toEqual({ visible: 1, hidden: 0, missingLogo: 1 });
  await catalogs.patchDepot(director, d.id, newId(), { hidden: true });
  expect((await catalogs.summary(director, "ets2")).lists.depots).toEqual({
    visible: 0,
    hidden: 1,
  });
  const empty = (await catalogs.summary(director, "ats")).lists;
  expect(empty.depots).toEqual({ visible: 0, hidden: 0 });
  expect(empty.companies).toEqual({ visible: 0, hidden: 0, missingLogo: 0 });
});

test("company logo filters combine before paging and follow changes to visible companies", async () => {
  const first = await company("filter_a"),
    second = await company("filter_b"),
    withLogo = await company("filter_c"),
    hidden = await company("filter_hidden"),
    ats = await company("filter_a", "ats");
  await company("other_d");
  await catalogs.setLogo(director, withLogo.id, newId(), rgbaLogo(2));
  await catalogs.patch(director, "companies", hidden.id, newId(), { hidden: true });

  const query = {
    game: "ets2",
    locale: "ru",
    logo: "missing",
    search: "filter_",
    dlc: "base",
    limit: 1,
  } as const;
  const page = await catalogs.list(driver, "companies", query);
  expect(page).toMatchObject({
    items: [{ id: first.id, logo: null, depotCount: 0, display: { englishFallback: false } }],
    total: 2,
    nextCursor: expect.any(String),
  });
  const cursor = page.nextCursor as string;
  expect(await catalogs.list(driver, "companies", { ...query, cursor })).toMatchObject({
    items: [{ id: second.id }],
    total: 2,
    nextCursor: null,
  });
  const { logo: _logo, ...withoutLogo } = query;
  await expect(
    catalogs.list(driver, "companies", { ...withoutLogo, cursor }),
  ).rejects.toMatchObject({
    statusCode: 409,
    publicCode: "VERSION_CONFLICT",
  });
  expect(
    (await catalogs.list(driver, "companies", { ...query, hidden: "only", includeHidden: true }))
      .items,
  ).toMatchObject([{ id: hidden.id }]);
  expect((await catalogs.list(driver, "companies", { ...query, game: "ats" })).items).toMatchObject(
    [{ id: ats.id }],
  );

  const counts = async () => (await catalogs.summary(driver, "ets2")).lists.companies;
  expect(await counts()).toEqual({ visible: 4, hidden: 1, missingLogo: 3 });
  instant += 123;
  const logo = await catalogs.setLogo(director, first.id, newId(), rgbaLogo(1));
  expect(logo.updatedAt).toBe(first.updatedAt);
  expect((await catalogs.list(driver, "companies", query)).items).toMatchObject([
    { id: second.id },
  ]);
  expect(await counts()).toMatchObject({ missingLogo: 2 });
  instant += 123;
  const removed = await catalogs.removeLogo(director, first.id, newId());
  expect(removed).toMatchObject({ logo: null, updatedAt: first.updatedAt });
  expect(await counts()).toMatchObject({ missingLogo: 3 });
});

test("depot filters use default visibility and the depot's own hidden flag", async () => {
  const a = await company("maintenance_a"),
    b = await company("maintenance_b"),
    c = await company("maintenance_c"),
    parentHidden = await company("maintenance_d");
  const cityMissing = await city("missing_label"),
    cityTranslated = await city("translated_label", "ets2", { nameRu: "Пример" }),
    cityHidden = await city("hidden_label");
  instant += 123;
  const defaultA = await depot(a.id, cityTranslated.id);
  const defaultB = await depot(b.id, cityMissing.id);
  const defaultC = await depot(c.id, cityTranslated.id);
  const depotHidden = await depot(a.id, cityMissing.id);
  const hiddenByCity = await depot(a.id, cityHidden.id);
  const hiddenByCompany = await depot(parentHidden.id, cityTranslated.id);
  instant += 123;
  await catalogs.patchDepot(director, depotHidden.id, newId(), { hidden: true });
  await catalogs.patch(director, "cities", cityHidden.id, newId(), { hidden: true });
  await catalogs.patch(director, "companies", parentHidden.id, newId(), { hidden: true });
  const ats = await company("maintenance_a", "ats");
  const atsCity = await city("missing_label", "ats");
  const atsDepot = await depot(ats.id, atsCity.id, "ats");

  const query = { game: "ets2", search: "maintenance", dlc: "base" } as const;
  const ids = (result: Awaited<ReturnType<Catalogs["listDepots"]>>) =>
    result.items.map((row) => row.id);
  for (const locale of ["en", "ru"] as const) {
    const scoped = { ...query, locale, limit: 2 };
    const first = await catalogs.listDepots(driver, scoped);
    expect(first.total).toBe(3);
    expect(first.nextCursor).toEqual(expect.any(String));
    const cursor = first.nextCursor as string;
    const second = await catalogs.listDepots(driver, { ...scoped, cursor });
    expect(second.total).toBe(3);
    expect(second.nextCursor).toBeNull();
    // Company order is the canonical name in both languages.
    expect([...ids(first), ...ids(second)]).toEqual([defaultA.id, defaultB.id, defaultC.id]);
    const { dlc: _dlc, ...withoutDlc } = scoped;
    await expect(catalogs.listDepots(driver, { ...withoutDlc, cursor })).rejects.toMatchObject({
      statusCode: 409,
      publicCode: "VERSION_CONFLICT",
    });
  }
  const hiddenOnly = { ...query, hidden: "only", includeHidden: true } as const;
  expect(ids(await catalogs.listDepots(driver, hiddenOnly))).toEqual([depotHidden.id]);
  const only = await catalogs.listDepots(driver, {
    ...hiddenOnly,
    companyId: a.id,
    cityId: cityMissing.id,
  });
  expect(ids(only)).toEqual([depotHidden.id]);
  expect(only.total).toBe(1);
  const all = await catalogs.listDepots(driver, { ...query, includeHidden: true });
  expect(ids(all).sort()).toEqual(
    [
      defaultA.id,
      defaultB.id,
      defaultC.id,
      depotHidden.id,
      hiddenByCity.id,
      hiddenByCompany.id,
    ].sort(),
  );
  expect(ids(await catalogs.listDepots(driver, { ...query, game: "ats" }))).toEqual([atsDepot.id]);
  expect((await catalogs.summary(driver, "ets2")).lists.depots).toEqual({ visible: 5, hidden: 1 });
  const companies = await catalogs.list(driver, "companies", { game: "ets2", includeHidden: true });
  expect(companies.items.map((row) => [row.id, row.depotCount])).toEqual([
    [a.id, 3],
    [b.id, 1],
    [c.id, 1],
    [parentHidden.id, 1],
  ]);
  expect((await catalogs.get(driver, "companies", a.id)).depotCount).toBe(3);
  expect((await catalogs.get(driver, "companies", ats.id)).depotCount).toBe(1);
  expect((await catalogs.get(driver, "companies", a.id)).updatedAt).toBe(a.updatedAt);
});

test("HTTP restores a saved depot by exact game, city and ID under the current visibility policy", async () => {
  const carrier = await company("saved_lookup_carrier");
  const alternative = await company("saved_lookup_alternative");
  const currentCity = await city("saved_lookup_city", "ets2", { nameRu: "Город" });
  const otherCity = await city("saved_lookup_other_city");
  const saved = await depot(carrier.id, currentCity.id);
  await depot(alternative.id, currentCity.id);

  const app = await createApp({ identity, catalogs, checkReadiness: async () => true });
  const path = "/api/v1/catalogs/depots";
  const query = { game: "ets2", cityId: currentCity.id, depotId: saved.id, locale: "ru" };
  const url = (parameters: Record<string, string>) => `${path}?${new URLSearchParams(parameters)}`;
  const read = (overrides: Record<string, string> = {}) =>
    app.inject({ url: url({ ...query, ...overrides }), headers: { cookie: driverCookie } });
  const empty = { items: [], total: 0, nextCursor: null };
  try {
    expect((await app.inject({ url: url(query) })).statusCode).toBe(401);
    const found = await read();
    expect(found.statusCode, found.body).toBe(200);
    expect(found.json().data).toMatchObject({
      items: [{ id: saved.id, city: { label: { label: "Город" } } }],
      total: 1,
      nextCursor: null,
    });
    for (const mismatch of [{ game: "ats" }, { cityId: otherCity.id }, { depotId: newId() }]) {
      const missing = await read(mismatch);
      expect(missing.statusCode).toBe(200);
      expect(missing.json().data).toEqual(empty);
    }
    const { cityId: _cityId, ...withoutCity } = query;
    const invalid = await app.inject({
      url: url(withoutCity),
      headers: { cookie: driverCookie },
    });
    expect(invalid.statusCode).toBe(422);

    await catalogs.patchDepot(director, saved.id, newId(), { hidden: true });
    expect((await read()).json().data).toEqual(empty);
    const restored = await read({ includeHidden: "true" });
    expect(restored.statusCode).toBe(200);
    expect(restored.json().data).toMatchObject({
      items: [{ id: saved.id, hidden: true }],
      total: 1,
      nextCursor: null,
    });
    expect((await read({ cityId: otherCity.id, includeHidden: "true" })).json().data).toEqual(
      empty,
    );
  } finally {
    await app.close();
  }
});

test("companies are listed by their canonical name in every locale, with stable ties and keyset paging", async () => {
  const alpha = await company("c_alpha", "ets2", { nameEn: "Alpha Freight" });
  await company("c_bravo", "ets2", { nameEn: "Bravo Freight" });
  await company("c_charlie", "ets2", { nameEn: "Charlie Freight" });
  await company("c_other_game", "ats", { nameEn: "Another game" });
  // A stored Russian name from an older import is ignored everywhere.
  await control.query("UPDATE catalog_companies SET name_ru=? WHERE id=?", ["Яблоко", alpha.id]);
  const names = async (locale: "en" | "ru") =>
    (await catalogs.list(director, "companies", { game: "ets2", locale })).items.map(
      (item) => item.display.label,
    );
  expect(await names("en")).toEqual(["Alpha Freight", "Bravo Freight", "Charlie Freight"]);
  expect(await names("ru")).toEqual(["Alpha Freight", "Bravo Freight", "Charlie Freight"]);
  const russian = await catalogs.list(director, "companies", { game: "ets2", locale: "ru" });
  expect(russian.items.map((item) => item.display.englishFallback)).toEqual([false, false, false]);
  expect(russian.items.map((item) => item.nameRu)).toEqual([null, null, null]);
  expect(
    (await catalogs.list(director, "companies", { game: "ets2", locale: "ru", search: "Яблоко" }))
      .total,
  ).toBe(0);
  expect(russian.items[0]).toMatchObject({ logo: null, dlcId: null });
  expect(russian.items[0]).not.toHaveProperty("regionId");
  expect(russian.total).toBe(3);

  for (const code of ["t1", "t2", "t3", "t4", "t5"])
    await company(code, "ets2", { nameEn: "Duplicate Freight" });
  const seen: string[] = [];
  let cursor: string | undefined;
  for (let pages = 0; pages < 6; pages++) {
    const page = await catalogs.list(director, "companies", {
      game: "ets2",
      search: "Duplicate",
      limit: 2,
      ...(cursor ? { cursor } : {}),
    });
    seen.push(...page.items.map((item) => item.id));
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  expect(new Set(seen).size).toBe(5);
  expect([...seen].sort()).toEqual(seen);
  // The region filter belongs to cities only.
  await expect(
    catalogs.list(director, "companies", { game: "ets2", regionId: newId() }),
  ).rejects.toMatchObject({ statusCode: 422 });
});

test("cursors issued under the localized order are refused where the canonical name now orders", async () => {
  const alpha = await company("l_alpha", "ets2", { nameEn: "Alpha Legacy" }),
    bravo = await company("l_bravo", "ets2", { nameEn: "Bravo Legacy" });
  await company("l_charlie", "ets2", { nameEn: "Charlie Legacy" });
  const port = await city("l_port", "ets2", { nameEn: "Legacy Port", nameRu: "Порт" }),
    bay = await city("l_bay", "ets2", { nameEn: "Legacy Bay" });
  const alphaDepot = await depot(alpha.id, port.id);
  await depot(bravo.id, port.id);
  await depot(alpha.id, bay.id);
  const codec = cursorCodec(catalogSettings.cursorKey);
  const session = [driver.userId, driver.sessionId, driver.accessEpoch] as const;
  const conflict = { statusCode: 409, publicCode: "VERSION_CONFLICT" };

  // A fresh Russian company cursor pages by the canonical name.
  const query = { game: "ets2", locale: "ru", search: "Legacy", limit: 1 } as const;
  const first = await catalogs.list(driver, "companies", query);
  expect(first.items.map((item) => item.id)).toEqual([alpha.id]);
  const fresh = await catalogs.list(driver, "companies", {
    ...query,
    cursor: first.nextCursor as string,
  });
  expect(fresh.items.map((item) => item.id)).toEqual([bravo.id]);
  // The binding of a cursor written before the change, without the canonical-name mark.
  const listBinding = [...session, "companies", "ets2", "Legacy", false, null, null, "ru"];
  const after = JSON.stringify(["Alpha Legacy", alpha.id]);
  await expect(
    catalogs.list(driver, "companies", { ...query, cursor: codec.write(listBinding, after) }),
  ).rejects.toMatchObject(conflict);
  // The same position with the mark is accepted, so the refusal is the missing mark alone.
  const marked = codec.write([...listBinding, "canonical-name"], after);
  expect(
    (await catalogs.list(driver, "companies", { ...query, cursor: marked })).items.map(
      (item) => item.id,
    ),
  ).toEqual([bravo.id]);

  // Companies in a city: ordered by the canonical company name, so old cursors are refused.
  const inCity = { game: "ets2", cityId: port.id, locale: "ru", limit: 1 } as const;
  const depotFirst = await catalogs.listDepots(driver, inCity);
  expect(depotFirst.items.map((row) => row.id)).toEqual([alphaDepot.id]);
  const byCompany = [...session, "depots", "ets2", null, port.id, null, null, false, "ru"];
  const depotAfter = JSON.stringify(["Alpha Legacy", alphaDepot.id]);
  await expect(
    catalogs.listDepots(driver, { ...inCity, cursor: codec.write(byCompany, depotAfter) }),
  ).rejects.toMatchObject(conflict);
  expect(
    (
      await catalogs.listDepots(driver, {
        ...inCity,
        cursor: codec.write([...byCompany, "canonical-name"], depotAfter),
      })
    ).items.map((row) => row.company.id),
  ).toEqual([bravo.id]);

  // Cities of one company keep their localized order, so their earlier cursors stay valid.
  const ofCompany = { game: "ets2", companyId: alpha.id, locale: "ru", limit: 1 } as const;
  const cityFirst = await catalogs.listDepots(driver, ofCompany);
  const [firstCity] = cityFirst.items;
  if (!firstCity) throw new Error("MISSING_SYNTHETIC_DEPOT");
  const byCity = [...session, "depots", "ets2", alpha.id, null, null, null, false, "ru"];
  const kept = await catalogs.listDepots(driver, {
    ...ofCompany,
    cursor: codec.write(byCity, JSON.stringify([firstCity.city.label.label, firstCity.id])),
  });
  expect(kept.items.map((row) => row.city.id)).toEqual(
    (
      await catalogs.listDepots(driver, { ...ofCompany, cursor: cityFirst.nextCursor as string })
    ).items.map((row) => row.city.id),
  );
  expect(kept.items).toHaveLength(1);
});

test("companies in a city and cities of a company read in name order with bound cursors", async () => {
  const north = await city("north", "ets2", { nameEn: "Northville", nameRu: "Север" });
  const south = await city("south", "ets2", { nameEn: "Southville" });
  const east = await city("east", "ets2", { nameEn: "Eastville", nameRu: "Восток" });
  const a = await company("a_co", "ets2", { nameEn: "Zeta Haulage", nameRu: "Альфа" });
  const b = await company("b_co", "ets2", { nameEn: "Alpha Haulage" });
  const other = await company("o_co", "ats", { nameEn: "Other game" });
  await depot(a.id, north.id);
  await depot(a.id, south.id);
  await depot(a.id, east.id);
  await depot(b.id, north.id);
  const otherCity = await city("north", "ats");
  await depot(other.id, otherCity.id, "ats");

  const inNorth = await catalogs.listDepots(director, { game: "ets2", cityId: north.id });
  expect(inNorth.items.map((item) => item.company.label.label)).toEqual([
    "Alpha Haulage",
    "Zeta Haulage",
  ]);
  expect(inNorth.total).toBe(2);
  const ofCompany = await catalogs.listDepots(director, { game: "ets2", companyId: a.id });
  expect(ofCompany.items.map((item) => item.city.label.label)).toEqual([
    "Eastville",
    "Northville",
    "Southville",
  ]);
  const russian = await catalogs.listDepots(director, {
    game: "ets2",
    companyId: a.id,
    locale: "ru",
  });
  expect(russian.items.map((item) => item.city.label.label)).toEqual([
    "Southville",
    "Восток",
    "Север",
  ]);
  expect(russian.items.map((item) => item.city.label.englishFallback)).toEqual([
    true,
    false,
    false,
  ]);
  const pair = await catalogs.listDepots(director, {
    game: "ets2",
    companyId: a.id,
    cityId: south.id,
  });
  expect(pair.items).toHaveLength(1);
  expect(pair.items[0]).toMatchObject({
    company: { code: "a_co", logo: null },
    city: { code: "south" },
    dlc: null,
  });
  expect((await catalogs.listDepots(director, { game: "ats" })).total).toBe(1);

  // Search runs over both names and both codes.
  expect((await catalogs.listDepots(director, { game: "ets2", search: "Zeta" })).total).toBe(3);
  expect((await catalogs.listDepots(director, { game: "ets2", search: "Eastv" })).total).toBe(1);
  expect((await catalogs.listDepots(director, { game: "ets2", search: "b_co" })).total).toBe(1);
  // In one city the search picks a company by its name or code, never by the city's own name.
  const inCity = (search: string) =>
    catalogs.listDepots(director, { game: "ets2", cityId: north.id, search });
  expect((await inCity("Northv")).total).toBe(0);
  expect((await inCity("Alpha")).items.map((item) => item.company.id)).toEqual([b.id]);
  expect((await inCity("a_co")).items.map((item) => item.company.id)).toEqual([a.id]);
  // A company's stored Russian name is not searchable.
  await control.query("UPDATE catalog_companies SET name_ru=? WHERE id=?", ["Альфа", a.id]);
  expect((await inCity("Альфа")).total).toBe(0);
  // For one company the search picks a city, never by the company's own name.
  const ofOne = (search: string) =>
    catalogs.listDepots(director, { game: "ets2", companyId: a.id, search });
  expect((await ofOne("Zeta")).total).toBe(0);
  expect((await ofOne("Восток")).items.map((item) => item.city.id)).toEqual([east.id]);
  expect((await ofOne("south")).items.map((item) => item.city.id)).toEqual([south.id]);
  expect((await catalogs.listDepots(director, { game: "ets2", search: "%" })).total).toBe(0);
  expect((await catalogs.listDepots(director, { game: "ets2", dlc: "base" })).total).toBe(4);

  // Paging is stable, resumes exactly and is bound to the filters it came from.
  const first = await catalogs.listDepots(director, { game: "ets2", companyId: a.id, limit: 2 });
  expect(first.nextCursor).toEqual(expect.any(String));
  const second = await catalogs.listDepots(director, {
    game: "ets2",
    companyId: a.id,
    limit: 2,
    cursor: first.nextCursor as string,
  });
  expect([...first.items, ...second.items].map((item) => item.city.code)).toEqual([
    "east",
    "north",
    "south",
  ]);
  expect(second.nextCursor).toBeNull();
  for (const filters of [
    { cityId: north.id },
    { companyId: b.id },
    { companyId: a.id, locale: "ru" as const },
    { companyId: a.id, includeHidden: true },
  ])
    await expect(
      catalogs.listDepots(director, {
        game: "ets2",
        ...filters,
        cursor: first.nextCursor as string,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  // Another member cannot reuse the cursor either.
  await expect(
    catalogs.listDepots(driver, {
      game: "ets2",
      companyId: a.id,
      cursor: first.nextCursor as string,
    }),
  ).rejects.toMatchObject({ statusCode: 409 });
});

test("depot pages keep a stable order across duplicate company names", async () => {
  const k = await city("tie_city");
  for (const code of ["d1", "d2", "d3", "d4", "d5"]) {
    const c = await company(code, "ets2", { nameEn: "Duplicate Haulage" });
    await depot(c.id, k.id);
  }
  const seen: string[] = [];
  let cursor: string | undefined;
  for (let pages = 0; pages < 6; pages++) {
    const page = await catalogs.listDepots(director, {
      game: "ets2",
      cityId: k.id,
      limit: 2,
      ...(cursor ? { cursor } : {}),
    });
    seen.push(...page.items.map((item) => item.id));
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  expect(new Set(seen).size).toBe(5);
  expect([...seen].sort()).toEqual(seen);
});

const companyHeader = "game,code,name_en,name_ru,dlc_code";
const depotHeader = "game,company_code,city_code,dlc_code";

test("a company import is a dry run first and then upserts without deleting or clearing", async () => {
  const pack = await dlc("imp_pack");
  const existing = await company("imp_existing", "ets2", { nameEn: "Before", dlcId: pack.id });
  // A Russian name stored before companies lost translations stays, but is never read.
  await control.query("UPDATE catalog_companies SET name_ru=? WHERE id=?", [
    "Прежнее",
    existing.id,
  ]);
  const storedRu = async (code: string) => {
    const [rows] = await control.query<RowDataPacket[]>(
      "SELECT name_ru FROM catalog_companies WHERE CAST(code AS CHAR)=? AND game=?",
      [code, "ets2"],
    );
    return rows[0]?.name_ru;
  };
  const file = csv(
    companyHeader,
    "ets2,imp_existing,After,,",
    "ets2,imp_new,Brand New,Новая,imp_pack",
    "ats,imp_new,Same code other game,,",
  );
  const preview = await catalogs.previewImport(director, "companies", file);
  expect(preview).toMatchObject({ rows: 3, added: 2, changed: 1, unchanged: 0, errors: 0 });
  expect(await count("catalog_companies")).toBe(1);
  expect(await auditCount("catalog.imported")).toBe(0);
  const result = await catalogs.applyImport(
    director,
    "companies",
    file,
    newId(),
    preview.token as string,
  );
  expect(result).toMatchObject({ rows: 3, added: 2, changed: 1 });
  // An empty cell keeps the stored source; the name_ru column is accepted and ignored.
  expect(await catalogs.get(director, "companies", existing.id)).toMatchObject({
    nameEn: "After",
    nameRu: null,
    dlcId: pack.id,
  });
  expect(await storedRu("imp_existing")).toBe("Прежнее");
  expect(await storedRu("imp_new")).toBeNull();
  expect(await count("catalog_companies")).toBe(3);
  expect(await auditCount("catalog.imported")).toBe(1);
  // Rows missing from a later file stay; a changed Russian name alone changes nothing.
  const later = csv(companyHeader, "ets2,imp_new,Brand New,Другое,imp_pack");
  const checked = await catalogs.previewImport(director, "companies", later);
  expect(checked).toMatchObject({ added: 0, changed: 0, unchanged: 1 });
  await catalogs.applyImport(director, "companies", later, newId(), checked.token as string);
  expect(await count("catalog_companies")).toBe(3);
  // The current template has no name_ru column at all.
  const template = csv("game,code,name_en,dlc_code", "ets2,imp_new,Brand New,imp_pack");
  expect(await catalogs.previewImport(director, "companies", template)).toMatchObject({
    errors: 0,
    unchanged: 1,
  });
});

test("a company file reports duplicates, unknown or hidden sources and bad values by line", async () => {
  const hidden = await dlc("hid_pack");
  await catalogs.patch(director, "dlcs", hidden.id, newId(), { hidden: true });
  const preview = await catalogs.previewImport(
    director,
    "companies",
    csv(
      companyHeader,
      "ets2,dup_co,One,,",
      "ets2,dup_co,Two,,",
      "ets2,bad_dlc,Bad,,missing_pack",
      "ets2,hid_dlc,Hidden,,hid_pack",
      "ets2,,No code,,",
      "xx,bad_game,Bad game,,",
    ),
  );
  expect(preview.token).toBeNull();
  expect(preview.errors).toBe(5);
  const issues = new Map(preview.lines.map((line) => [line.line, line.issues]));
  expect(issues.get(3)).toEqual([{ field: "code", reason: "duplicate_in_file" }]);
  expect(issues.get(4)).toEqual([{ field: "dlc_code", reason: "unknown_reference" }]);
  expect(issues.get(5)).toEqual([{ field: "dlc_code", reason: "hidden_reference" }]);
  expect(issues.get(6)).toEqual([{ field: "code", reason: "required" }]);
  expect(issues.get(7)).toEqual([{ field: "game", reason: "invalid" }]);
  expect(await count("catalog_companies")).toBe(0);
});

async function depotFixtures() {
  const c1 = await company("imp_co_one");
  const c2 = await company("imp_co_two");
  const k1 = await city("imp_city_one");
  const k2 = await city("imp_city_two");
  const pack = await dlc("depot_pack");
  return { c1, c2, k1, k2, pack };
}

test("a depot import resolves company, city and source by code and never deletes", async () => {
  const { c1, c2, k2, pack } = await depotFixtures();
  const kept = await depot(c2.id, k2.id);
  const file = csv(
    depotHeader,
    "ets2,imp_co_one,imp_city_one,",
    "ets2,imp_co_one,imp_city_two,depot_pack",
    "ets2,imp_co_two,imp_city_two,",
  );
  const preview = await catalogs.previewImport(director, "depots", file);
  expect(preview).toMatchObject({ rows: 3, added: 2, changed: 0, unchanged: 1, errors: 0 });
  expect(await count("catalog_company_cities")).toBe(1);
  const result = await catalogs.applyImport(
    director,
    "depots",
    file,
    newId(),
    preview.token as string,
  );
  expect(result).toMatchObject({ added: 2, changed: 0, unchanged: 1 });
  expect(await count("catalog_company_cities")).toBe(3);
  expect(await auditCount("catalog.imported")).toBe(1);
  const inTwo = await catalogs.listDepots(director, { game: "ets2", cityId: k2.id });
  expect(inTwo.items.map((item) => [item.company.code, item.dlc?.label ?? null])).toEqual([
    ["imp_co_one", `Pack ${pack.code}`],
    ["imp_co_two", null],
  ]);
  // An empty source cell keeps the stored one; a named source changes it; rows left out stay.
  const change = csv(
    depotHeader,
    "ets2,imp_co_one,imp_city_two,",
    "ets2,imp_co_two,imp_city_two,depot_pack",
  );
  const next = await catalogs.previewImport(director, "depots", change);
  expect(next).toMatchObject({ added: 0, changed: 1, unchanged: 1 });
  expect(next.lines).toEqual([
    expect.objectContaining({ code: "imp_co_two", status: "changed", changedFields: ["dlc_code"] }),
  ]);
  await catalogs.applyImport(director, "depots", change, newId(), next.token as string);
  expect(await count("catalog_company_cities")).toBe(3);
  expect((await catalogs.listDepots(director, { game: "ets2", companyId: c1.id })).total).toBe(2);
  expect(await depotDlc(kept.id)).toBe(pack.id);
});

const depotDlc = async (id: string) => {
  const [rows] = await control.query<RowDataPacket[]>(
    "SELECT CAST(dlc_id AS CHAR) dlc FROM catalog_company_cities WHERE id=?",
    [id],
  );
  return rows[0]?.dlc as string | null;
};

test("a depot file reports unknown and hidden references and duplicates by line", async () => {
  const { c1, k1 } = await depotFixtures();
  const hiddenCompany = await company("hid_co");
  const hiddenCity = await city("hid_city");
  await catalogs.patch(director, "companies", hiddenCompany.id, newId(), { hidden: true });
  await catalogs.patch(director, "cities", hiddenCity.id, newId(), { hidden: true });
  const preview = await catalogs.previewImport(
    director,
    "depots",
    csv(
      depotHeader,
      "ets2,imp_co_one,imp_city_one,",
      "ets2,imp_co_one,imp_city_one,",
      "ets2,no_such_co,imp_city_one,",
      "ets2,imp_co_one,no_such_city,",
      "ets2,hid_co,imp_city_one,",
      "ets2,imp_co_one,hid_city,",
      "ets2,imp_co_one,imp_city_two,no_pack",
      "ats,imp_co_one,imp_city_one,",
      "ets2,,imp_city_one,",
      "ets2,imp_co_one,,",
    ),
  );
  expect(preview.token).toBeNull();
  expect(preview.errors).toBe(9);
  const issues = new Map(preview.lines.map((line) => [line.line, line.issues]));
  expect(issues.get(3)).toEqual([{ field: "city_code", reason: "duplicate_in_file" }]);
  expect(issues.get(4)).toEqual([{ field: "company_code", reason: "unknown_reference" }]);
  expect(issues.get(5)).toEqual([{ field: "city_code", reason: "unknown_reference" }]);
  expect(issues.get(6)).toEqual([{ field: "company_code", reason: "hidden_reference" }]);
  expect(issues.get(7)).toEqual([{ field: "city_code", reason: "hidden_reference" }]);
  expect(issues.get(8)).toEqual([{ field: "dlc_code", reason: "unknown_reference" }]);
  expect(issues.get(9)).toEqual([
    { field: "company_code", reason: "unknown_reference" },
    { field: "city_code", reason: "unknown_reference" },
  ]);
  expect(issues.get(10)).toEqual([{ field: "company_code", reason: "required" }]);
  expect(issues.get(11)).toEqual([{ field: "city_code", reason: "required" }]);
  expect(preview.lines.find((line) => line.line === 4)?.code).toBe("no_such_co");
  expect(await count("catalog_company_cities")).toBe(0);
  // A hidden company or city is not an error for a depot that already exists.
  await depot(c1.id, k1.id);
  await catalogs.patch(director, "companies", c1.id, newId(), { hidden: true });
  const existing = csv(depotHeader, "ets2,imp_co_one,imp_city_one,");
  expect(await catalogs.previewImport(director, "depots", existing)).toMatchObject({
    errors: 0,
    unchanged: 1,
  });
});

test("depot timestamps follow its own edits and one instant per import", async () => {
  const { c1, k1, k2 } = await depotFixtures();
  const pack = await dlc("timestamp_pack");
  instant += 123;
  const row = await depot(c1.id, k1.id);
  expect(row.updatedAt).toBe(now().toISOString());
  instant += 123;
  await catalogs.patch(director, "companies", c1.id, newId(), { nameEn: "Renamed Company" });
  const listed = async () =>
    (await catalogs.listDepots(driver, { game: "ets2", includeHidden: true })).items;
  expect((await listed())[0]?.updatedAt).toBe(row.updatedAt);
  const unchanged = await catalogs.patchDepot(director, row.id, newId(), {
    hidden: false,
    dlcId: null,
  });
  expect(unchanged.updatedAt).toBe(row.updatedAt);
  const patchKey = newId();
  const patch = { hidden: true };
  const hidden = await catalogs.patchDepot(director, row.id, patchKey, patch);
  expect(hidden.updatedAt).toBe(now().toISOString());
  expect(hidden.updatedAt).not.toBe(row.updatedAt);
  instant += 123;
  const file = csv(
    depotHeader,
    "ets2,imp_co_one,imp_city_one,timestamp_pack",
    "ets2,imp_co_one,imp_city_two,timestamp_pack",
  );
  const preview = await catalogs.previewImport(director, "depots", file);
  expect(preview).toMatchObject({ added: 1, changed: 1, errors: 0 });
  expect((await listed())[0]?.updatedAt).toBe(hidden.updatedAt);
  instant += 123;
  const key = newId();
  const applied = await catalogs.applyImport(
    director,
    "depots",
    file,
    key,
    preview.token as string,
  );
  const rows = (await listed()).sort((left, right) =>
    left.city.code.localeCompare(right.city.code),
  );
  expect(rows).toMatchObject([
    {
      id: row.id,
      city: { id: k1.id },
      dlcId: pack.id,
      hidden: true,
      updatedAt: now().toISOString(),
    },
    { city: { id: k2.id }, dlcId: pack.id, hidden: false, updatedAt: now().toISOString() },
  ]);
  instant += 123;
  await expect(catalogs.patchDepot(director, row.id, patchKey, patch)).resolves.toEqual(hidden);
  await expect(
    catalogs.applyImport(director, "depots", file, key, preview.token as string),
  ).resolves.toEqual(applied);
  const sameFile = await catalogs.previewImport(director, "depots", file);
  expect(sameFile).toMatchObject({ added: 0, changed: 0, unchanged: 2, errors: 0 });
  await catalogs.applyImport(director, "depots", file, newId(), sameFile.token as string);
  expect(
    (await listed()).sort((left, right) => left.city.code.localeCompare(right.city.code)),
  ).toEqual(rows);
});

test("a depot apply is all-or-nothing and replays by key without a second effect", async () => {
  const { c1, c2, k1, k2 } = await depotFixtures();
  const file = csv(depotHeader, "ets2,imp_co_one,imp_city_one,", "ets2,imp_co_two,imp_city_two,");
  const preview = await catalogs.previewImport(director, "depots", file);
  // The second company disappears after the dry run: nothing is applied.
  await unit.run((tx) =>
    unit.client(tx).delete(catalogCompanies).where(eq(catalogCompanies.id, c2.id)),
  );
  await expect(
    catalogs.applyImport(director, "depots", file, newId(), preview.token as string),
  ).rejects.toMatchObject({ statusCode: 422, publicCode: "CATALOG_IMPORT_INVALID" });
  expect(await count("catalog_company_cities")).toBe(0);
  expect(await auditCount("catalog.imported")).toBe(0);

  const clean = csv(depotHeader, "ets2,imp_co_one,imp_city_one,");
  const checked = await catalogs.previewImport(director, "depots", clean);
  const key = newId();
  const applied = await catalogs.applyImport(
    director,
    "depots",
    clean,
    key,
    checked.token as string,
  );
  await expect(
    catalogs.applyImport(director, "depots", clean, key, checked.token as string),
  ).resolves.toEqual(applied);
  expect(await count("catalog_company_cities")).toBe(1);
  expect(await auditCount("catalog.imported")).toBe(1);
  expect(k2.id).not.toBe(k1.id);
  expect(c1.id).not.toBe(c2.id);
});

test("two concurrent depot imports serialize without losing or duplicating rows", async () => {
  const { k1, k2 } = await depotFixtures();
  expect([k1.id, k2.id]).toHaveLength(2);
  const first = csv(depotHeader, "ets2,imp_co_one,imp_city_one,", "ets2,imp_co_two,imp_city_one,");
  const second = csv(depotHeader, "ets2,imp_co_one,imp_city_one,", "ets2,imp_co_one,imp_city_two,");
  const [a, b] = await Promise.all([
    catalogs.previewImport(director, "depots", first),
    catalogs.previewImport(director, "depots", second),
  ]);
  const results = await Promise.allSettled([
    catalogs.applyImport(director, "depots", first, newId(), a.token as string),
    catalogs.applyImport(director, "depots", second, newId(), b.token as string),
  ]);
  expect(results.filter((r) => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
  for (const result of results)
    if (result.status === "rejected")
      expect(result.reason).toMatchObject({ publicCode: "CATALOG_CODE_CONFLICT" });
  const [rows] = await control.query<RowDataPacket[]>(
    "SELECT CONCAT(company_id,city_id) pair FROM catalog_company_cities",
  );
  expect(new Set(rows.map((row) => row.pair)).size).toBe(rows.length);
});

test("a single logo upload stores the checked bytes, lists only a version and replaces atomically", async () => {
  const c = await company("logo_co");
  expect(c.logo).toBeNull();
  const png = rgbaLogo(1);
  const saved = await catalogs.setLogo(director, c.id, newId(), png);
  const row = await storedLogo(c.id);
  expect(Buffer.from(row?.png).equals(png)).toBe(true);
  expect(row).toMatchObject({ byte_length: png.length, sha: sha256Hex(png).toUpperCase() });
  expect(row?.updated).toBe("2026-11-10 12:00:00.000");
  expect(saved.logo).toEqual({ version: sha256Hex(png).slice(0, 16), byteLength: png.length });
  const listed = await catalogs.list(director, "companies", { game: "ets2" });
  expect(listed.items[0]?.logo).toEqual(saved.logo);
  expect(JSON.stringify(listed)).not.toContain(png.toString("base64").slice(0, 40));
  expect(await auditCount("catalog.changed")).toBe(2);

  const replacement = paletteLogo(2);
  instant += 60_000;
  const replaced = await catalogs.setLogo(director, c.id, newId(), replacement);
  expect(replaced.logo?.version).toBe(sha256Hex(replacement).slice(0, 16));
  expect(replaced.logo?.version).not.toBe(saved.logo?.version);
  expect(Buffer.from((await storedLogo(c.id))?.png).equals(replacement)).toBe(true);
  expect((await storedLogo(c.id))?.updated).toBe("2026-11-10 12:01:00.000");
  expect(await count("catalog_company_logos")).toBe(1);

  // Identical bytes keep the version and the stored row untouched.
  instant += 60_000;
  const same = await catalogs.setLogo(director, c.id, newId(), replacement);
  expect(same.logo).toEqual(replaced.logo);
  expect((await storedLogo(c.id))?.updated).toBe("2026-11-10 12:01:00.000");
  expect(await catalogs.get(director, "companies", c.id)).toMatchObject({ logo: same.logo });
});

test("each committed upload writes one audit entry and a replay by key writes nothing", async () => {
  const c = await company("audit_co");
  const before = await auditCount("catalog.changed");
  const key = newId();
  const png = rgbaLogo(3);
  const first = await catalogs.setLogo(director, c.id, key, png);
  expect(await auditCount("catalog.changed")).toBe(before + 1);
  await expect(catalogs.setLogo(director, c.id, key, png)).resolves.toEqual(first);
  expect(await auditCount("catalog.changed")).toBe(before + 1);
  // The same key with other bytes is a conflict, not a second upload.
  await expect(catalogs.setLogo(director, c.id, key, rgbaLogo(4))).rejects.toMatchObject({
    statusCode: 409,
    publicCode: "IDEMPOTENCY_CONFLICT",
  });
  expect((await storedLogo(c.id))?.sha).toBe(sha256Hex(png).toUpperCase());
  const [audit] = await control.query<RowDataPacket[]>(
    "SELECT operation, subject_kind, CAST(subject_id AS CHAR) subject_id, CAST(actor_id AS CHAR) actor_id FROM audit_entries WHERE operation='catalog.changed' ORDER BY occurred_at DESC, id LIMIT 1",
  );
  expect(audit[0]).toMatchObject({
    subject_kind: "catalog",
    subject_id: c.id,
    actor_id: director.userId,
  });
  // The audit entry carries no image content.
  const [dump] = await control.query<RowDataPacket[]>("SELECT * FROM audit_entries");
  expect(JSON.stringify(dump)).not.toContain(png.toString("base64").slice(0, 30));
});

test("removing a logo deletes the row, and removing an absent one is a no-op without audit", async () => {
  const c = await company("remove_co");
  await catalogs.setLogo(director, c.id, newId(), rgbaLogo(1));
  const before = await auditCount("catalog.changed");
  const removed = await catalogs.removeLogo(director, c.id, newId());
  expect(removed.logo).toBeNull();
  expect(await count("catalog_company_logos")).toBe(0);
  expect(await auditCount("catalog.changed")).toBe(before + 1);
  const again = await catalogs.removeLogo(director, c.id, newId());
  expect(again.logo).toBeNull();
  expect(await auditCount("catalog.changed")).toBe(before + 1);
  await expect(catalogs.removeLogo(director, newId(), newId())).rejects.toMatchObject({
    statusCode: 404,
    publicCode: "CATALOG_ROW_NOT_FOUND",
  });
  await expect(catalogs.setLogo(director, newId(), newId(), rgbaLogo(1))).rejects.toMatchObject({
    statusCode: 404,
  });
  await expect(catalogs.readLogo(director, c.id, () => false)).rejects.toMatchObject({
    statusCode: 404,
    publicCode: "CATALOG_ROW_NOT_FOUND",
  });
});

test("a logo that is not an acceptable PNG is refused and nothing is stored", async () => {
  const c = await company("bad_logo_co");
  const key = newId();
  for (const bad of [
    jpegLike(),
    Buffer.alloc(0),
    rgbaLogo(1, 129, 32),
    rgbaLogo(1, 128, 33),
    rgbaLogo(1).subarray(0, 60),
    Buffer.concat([rgbaLogo(1), Buffer.from("tail")]),
  ])
    await expect(catalogs.setLogo(director, c.id, key, bad)).rejects.toMatchObject({
      statusCode: 422,
      publicCode: "CATALOG_FILE_INVALID",
    });
  await expect(
    catalogs.setLogo(director, c.id, newId(), Buffer.alloc(CATALOG_LOGO_MAX_BYTES + 1)),
  ).rejects.toMatchObject({ statusCode: 413, publicCode: "CATALOG_FILE_TOO_LARGE" });
  expect(await count("catalog_company_logos")).toBe(0);
  // The table itself refuses an image over the bound or one whose length disagrees.
  await expect(
    control.execute(
      "INSERT INTO catalog_company_logos (company_id,png,byte_length,sha256,updated_at) VALUES (?,?,?,?,'2026-11-10 12:00:00.000')",
      [c.id, Buffer.alloc(32769), 32769, Buffer.alloc(32)],
    ),
  ).rejects.toSatisfy(hasCode("ER_CHECK_CONSTRAINT_VIOLATED"));
  await expect(
    control.execute(
      "INSERT INTO catalog_company_logos (company_id,png,byte_length,sha256,updated_at) VALUES (?,?,?,?,'2026-11-10 12:00:00.000')",
      [c.id, Buffer.alloc(10), 11, Buffer.alloc(32)],
    ),
  ).rejects.toSatisfy(hasCode("ER_CHECK_CONSTRAINT_VIOLATED"));
});

test("a logo is read with its validator, skips the bytes on a match and survives hiding", async () => {
  const c = await company("read_co");
  const png = rgbaLogo(5);
  await catalogs.setLogo(director, c.id, newId(), png);
  const etag = sha256Hex(png);
  const full = await catalogs.readLogo(driver, c.id, () => false);
  expect(full.etag).toBe(etag);
  expect(full.version).toBe(etag.slice(0, 16));
  expect(full.png?.equals(png)).toBe(true);
  const matched = await catalogs.readLogo(driver, c.id, (value) => value === etag);
  expect(matched.png).toBeNull();
  await catalogs.patch(director, "companies", c.id, newId(), { hidden: true });
  expect((await catalogs.readLogo(driver, c.id, () => false)).png?.equals(png)).toBe(true);
  await catalogs.setLogo(director, c.id, newId(), paletteLogo(6));
  expect((await catalogs.readLogo(driver, c.id, (value) => value === etag)).png).not.toBeNull();
});

test("a bulk dry run lists unknown codes and invalid files, writes nothing and issues no token", async () => {
  const known = await company("bulk_known");
  await company("bulk_known", "ats");
  const good = rgbaLogo(1);
  const preview = await catalogs.previewLogos(director, "ets2", [
    file("bulk_known.png", good),
    file("bulk_unknown.png", good),
    file("bulk_known.PNG", good),
    file("notes.txt", Buffer.from("text")),
    file("bulk_known.png", good),
    file("bulk_big.png", Buffer.alloc(CATALOG_LOGO_MAX_BYTES), true),
    file("bulk_wide.png", rgbaLogo(1, 129, 32)),
    file("bulk_jpeg.png", jpegLike()),
    file("bulk_cut.png", good.subarray(0, 40)),
    file("dir/bulk_known.png", good),
  ]);
  expect(preview.token).toBeNull();
  expect(preview.rows).toBe(10);
  expect(preview.errors).toBe(9);
  expect(preview.added).toBe(1);
  const issues = new Map(preview.lines.map((line) => [line.line, line.issues]));
  expect(issues.get(1)).toBeUndefined();
  expect(issues.get(2)).toEqual([{ field: "code", reason: "unknown_reference" }]);
  expect(issues.get(3)).toEqual([{ field: "file", reason: "bad_name" }]);
  expect(issues.get(4)).toEqual([
    { field: "file", reason: "bad_name" },
    { field: "file", reason: "not_png" },
  ]);
  expect(issues.get(5)).toEqual([{ field: "file", reason: "duplicate_in_file" }]);
  expect(issues.get(6)).toEqual([
    { field: "file", reason: "too_large" },
    { field: "code", reason: "unknown_reference" },
  ]);
  expect(issues.get(7)).toEqual([
    { field: "file", reason: "bad_dimensions" },
    { field: "code", reason: "unknown_reference" },
  ]);
  expect(issues.get(8)?.[0]).toEqual({ field: "file", reason: "not_png" });
  expect(issues.get(9)?.[0]).toEqual({ field: "file", reason: "corrupt" });
  expect(issues.get(10)).toEqual([{ field: "file", reason: "bad_name" }]);
  expect(await count("catalog_company_logos")).toBe(0);
  expect(await auditCount("catalog.imported")).toBe(0);
  await expect(catalogs.previewLogos(director, "ets2", [])).rejects.toMatchObject({
    statusCode: 422,
    publicCode: "CATALOG_FILE_INVALID",
  });
  // Unknown codes are per game: the ATS company is not the ETS2 one.
  expect(known.game).toBe("ets2");
});

test("a bulk apply stores every logo or none, counts unchanged files and audits once", async () => {
  const a = await company("bulk_a");
  const b = await company("bulk_b");
  const c = await company("bulk_c");
  await catalogs.setLogo(director, b.id, newId(), rgbaLogo(2));
  await catalogs.setLogo(director, c.id, newId(), rgbaLogo(3));
  const files = [
    file("bulk_a.png", rgbaLogo(1)),
    file("bulk_b.png", rgbaLogo(4)),
    file("bulk_c.png", rgbaLogo(3)),
  ];
  const preview = await catalogs.previewLogos(director, "ets2", files);
  expect(preview).toMatchObject({ rows: 3, added: 1, changed: 1, unchanged: 1, errors: 0 });
  expect(preview.lines).toEqual([
    { line: 2, code: "bulk_b", status: "changed", issues: [], changedFields: ["logo"] },
  ]);
  expect(await count("catalog_company_logos")).toBe(2);
  const imports = await auditCount("catalog.imported");
  const key = newId();
  const applied = await catalogs.applyLogos(director, "ets2", files, key, preview.token as string);
  expect(applied).toMatchObject({ rows: 3, added: 1, changed: 1, unchanged: 1 });
  expect(await count("catalog_company_logos")).toBe(3);
  expect((await storedLogo(a.id))?.sha).toBe(sha256Hex(rgbaLogo(1)).toUpperCase());
  expect((await storedLogo(b.id))?.sha).toBe(sha256Hex(rgbaLogo(4)).toUpperCase());
  expect(await auditCount("catalog.imported")).toBe(imports + 1);
  // The same key replays the stored result; the token may even have expired by then.
  instant += 31 * 60 * 1000;
  await expect(
    catalogs.applyLogos(director, "ets2", files, key, preview.token as string),
  ).resolves.toEqual(applied);
  expect(await auditCount("catalog.imported")).toBe(imports + 1);
});

test("a bulk token binds the actor, game, files and time and a vanished company stops the apply", async () => {
  const a = await company("tok_a");
  await company("tok_b");
  const files = [file("tok_a.png", rgbaLogo(1)), file("tok_b.png", rgbaLogo(2))];
  const preview = await catalogs.previewLogos(director, "ets2", files);
  const token = preview.token as string;
  const invalid = { statusCode: 412, publicCode: "CATALOG_IMPORT_TOKEN_INVALID" };
  await expect(
    catalogs.applyLogos(
      director,
      "ets2",
      [files[0] as (typeof files)[0], file("tok_b.png", rgbaLogo(9))],
      newId(),
      token,
    ),
  ).rejects.toMatchObject(invalid);
  await expect(
    catalogs.applyLogos(
      director,
      "ets2",
      [files[1] as (typeof files)[0], files[0] as (typeof files)[0]],
      newId(),
      token,
    ),
  ).resolves.toMatchObject({ added: 2 });
  await control.query("DELETE FROM catalog_company_logos");
  await expect(catalogs.applyLogos(director, "ats", files, newId(), token)).rejects.toMatchObject(
    invalid,
  );
  const other = (await addMember(["deputy_director"])).actor;
  await expect(catalogs.applyLogos(other, "ets2", files, newId(), token)).rejects.toMatchObject(
    invalid,
  );
  await expect(
    catalogs.applyLogos(director, "ets2", files, newId(), "forged"),
  ).rejects.toMatchObject(invalid);
  instant += 30 * 60 * 1000 + 1000;
  await expect(catalogs.applyLogos(director, "ets2", files, newId(), token)).rejects.toMatchObject(
    invalid,
  );
  expect(await count("catalog_company_logos")).toBe(0);

  instant = Date.parse("2026-11-10T12:00:00.000Z");
  const fresh = await catalogs.previewLogos(director, "ets2", files);
  await unit.run((tx) =>
    unit.client(tx).delete(catalogCompanies).where(eq(catalogCompanies.id, a.id)),
  );
  await expect(
    catalogs.applyLogos(director, "ets2", files, newId(), fresh.token as string),
  ).rejects.toMatchObject({ statusCode: 422, publicCode: "CATALOG_IMPORT_INVALID" });
  expect(await count("catalog_company_logos")).toBe(0);
});

test("a bulk apply with an unchanged company logo of the same bytes still audits once", async () => {
  await company("same_a");
  const files = [file("same_a.png", greyAlphaLogo(1))];
  const first = await catalogs.previewLogos(director, "ets2", files);
  await catalogs.applyLogos(director, "ets2", files, newId(), first.token as string);
  const second = await catalogs.previewLogos(director, "ets2", files);
  expect(second).toMatchObject({ added: 0, changed: 0, unchanged: 1, errors: 0 });
  expect(second.token).toEqual(expect.any(String));
  const result = await catalogs.applyLogos(
    director,
    "ets2",
    files,
    newId(),
    second.token as string,
  );
  expect(result).toMatchObject({ added: 0, changed: 0, unchanged: 1 });
});

test("a bulk upload and a single upload to one company serialize", async () => {
  const c = await company("race_logo");
  const bulk = [file("race_logo.png", rgbaLogo(1))];
  const preview = await catalogs.previewLogos(director, "ets2", bulk);
  const results = await Promise.allSettled([
    catalogs.applyLogos(director, "ets2", bulk, newId(), preview.token as string),
    catalogs.setLogo(director, c.id, newId(), rgbaLogo(2)),
  ]);
  expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
  const sha = (await storedLogo(c.id))?.sha as string;
  expect([sha256Hex(rgbaLogo(1)).toUpperCase(), sha256Hex(rgbaLogo(2)).toUpperCase()]).toContain(
    sha,
  );
  expect(await count("catalog_company_logos")).toBe(1);
  expect(await auditCount("catalog.imported")).toBe(1);
  // Two single uploads to the same company also leave exactly one consistent row.
  await Promise.all([
    catalogs.setLogo(director, c.id, newId(), rgbaLogo(3)),
    catalogs.setLogo(director, c.id, newId(), rgbaLogo(4)),
  ]);
  const row = await storedLogo(c.id);
  expect(sha256Hex(Buffer.from(row?.png)).toUpperCase()).toBe(row?.sha);
  expect(row?.byte_length).toBe(Buffer.from(row?.png).length);
});

test("the logo table is touched only by the logo commands and a company id", async () => {
  const c = await company("table_co");
  await catalogs.setLogo(director, c.id, newId(), rgbaLogo(1));
  const rows = await unit.run((tx) =>
    unit.client(tx).select({ id: catalogCompanyLogos.companyId }).from(catalogCompanyLogos),
  );
  expect(rows.map((row) => row.id)).toEqual([c.id]);
  await expect(
    control.execute("DELETE FROM catalog_companies WHERE id=?", [c.id]),
  ).rejects.toSatisfy(hasCode("ER_ROW_IS_REFERENCED_2"));
  expect(CATALOG_LOGO_BULK_MAX_BYTES).toBe(16 * 1024 * 1024);
});

const multipart = (name: string, bytes: Buffer) =>
  Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: image/png\r\n\r\n`,
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

test("HTTP serves logos to members only and keeps every write behind staff and CSRF", async () => {
  const app = await createApp({ identity, catalogs, checkReadiness: async () => true });
  try {
    const csrf = (cookie: string) =>
      app
        .inject({ url: "/api/v1/auth/csrf", headers: { cookie } })
        .then((response) => response.json().data.token as string);
    const directorToken = await csrf(directorCookie),
      driverToken = await csrf(driverCookie);
    const c = await company("http_co");
    const k = await city("http_city");
    const png = rgbaLogo(1);
    const staffHeaders = {
      cookie: directorCookie,
      origin,
      "x-csrf-token": directorToken,
      "idempotency-key": newId(),
    };
    const form = { "content-type": `multipart/form-data; boundary=${boundary}` };
    const logoUrl = `/api/v1/catalogs/companies/${c.id}/logo`;
    const adminLogoUrl = `/api/v1/admin/catalogs/companies/${c.id}/logo`;

    // Before an upload there is nothing to serve.
    const none = await app.inject({ url: logoUrl, headers: { cookie: driverCookie } });
    expect(none.statusCode).toBe(404);
    expect(none.headers["cache-control"]).toBe("no-store");

    const uploaded = await app.inject({
      method: "PUT",
      url: adminLogoUrl,
      headers: { ...staffHeaders, ...form },
      payload: multipart("http_co.png", png),
    });
    expect(uploaded.statusCode).toBe(200);
    const version = uploaded.json().data.logo.version as string;
    expect(version).toBe(sha256Hex(png).slice(0, 16));

    // A member reads the image with cache headers keyed by the version.
    const served = await app.inject({
      url: `${logoUrl}?v=${version}`,
      headers: { cookie: driverCookie },
    });
    expect(served.statusCode).toBe(200);
    expect(served.rawPayload.equals(png)).toBe(true);
    expect(served.headers).toMatchObject({
      "content-type": "image/png",
      etag: `"${sha256Hex(png)}"`,
      "cache-control": "private, max-age=86400",
      vary: "Cookie",
      "x-content-type-options": "nosniff",
      "content-disposition": "inline",
    });
    const conditional = await app.inject({
      url: `${logoUrl}?v=${version}`,
      headers: { cookie: driverCookie, "if-none-match": `"${sha256Hex(png)}"` },
    });
    expect(conditional.statusCode).toBe(304);
    expect(conditional.rawPayload).toHaveLength(0);
    expect(
      (await app.inject({ url: logoUrl, headers: { cookie: driverCookie } })).headers[
        "cache-control"
      ],
    ).toBe("private, no-cache");
    // Unauthenticated callers get nothing, including a conditional request.
    for (const headers of [{}, { "if-none-match": `"${sha256Hex(png)}"` }])
      expect((await app.inject({ url: logoUrl, headers })).statusCode).toBe(401);

    // A hidden company's logo stays readable.
    await catalogs.patch(director, "companies", c.id, newId(), { hidden: true });
    expect((await app.inject({ url: logoUrl, headers: { cookie: driverCookie } })).statusCode).toBe(
      200,
    );

    // A session that no longer exists gets nothing, even for a conditional request.
    expect(
      (
        await app.inject({
          url: logoUrl,
          headers: { cookie: "vtc_session=expired", "if-none-match": `"${sha256Hex(png)}"` },
        })
      ).statusCode,
    ).toBe(401);

    // Reads on the other routes stay uncacheable.
    const list = await app.inject({
      url: "/api/v1/catalogs/companies?game=ets2&includeHidden=true",
      headers: { cookie: driverCookie },
    });
    expect(list.statusCode).toBe(200);
    expect(list.headers["cache-control"]).toBe("no-store");
    expect(list.json().data.items[0].logo).toEqual({ version, byteLength: png.length });

    // A driver without qualifications.manage is refused on every write route, CSRF notwithstanding.
    const asDriver = { cookie: driverCookie, origin, "x-csrf-token": driverToken };
    const json = { "content-type": "application/json" };
    const writes: [string, string, Record<string, string>, Buffer | string | undefined][] = [
      ["PUT", adminLogoUrl, { ...form, "idempotency-key": newId() }, multipart("x.png", png)],
      ["DELETE", adminLogoUrl, { "idempotency-key": newId() }, undefined],
      [
        "POST",
        "/api/v1/admin/catalogs/companies/logo-previews?game=ets2",
        form,
        multipart("x.png", png),
      ],
      [
        "POST",
        "/api/v1/admin/catalogs/companies/logo-imports?game=ets2",
        { ...form, "if-match": '"t"', "idempotency-key": newId() },
        multipart("x.png", png),
      ],
      [
        "POST",
        "/api/v1/admin/catalogs/companies",
        { ...json, "idempotency-key": newId() },
        JSON.stringify({ game: "ets2", code: "x", nameEn: "X" }),
      ],
      [
        "PATCH",
        `/api/v1/admin/catalogs/companies/${c.id}`,
        { ...json, "idempotency-key": newId() },
        JSON.stringify({ hidden: false }),
      ],
      [
        "POST",
        "/api/v1/admin/catalogs/depots",
        { ...json, "idempotency-key": newId() },
        JSON.stringify({ game: "ets2", companyId: c.id, cityId: k.id }),
      ],
      [
        "PATCH",
        `/api/v1/admin/catalogs/depots/${newId()}`,
        { ...json, "idempotency-key": newId() },
        JSON.stringify({ hidden: true }),
      ],
      [
        "POST",
        "/api/v1/admin/catalogs/depots/import-previews",
        form,
        multipart("d.csv", csv(depotHeader)),
      ],
      [
        "POST",
        "/api/v1/admin/catalogs/companies/import-previews",
        form,
        multipart("c.csv", csv(companyHeader)),
      ],
    ];
    for (const [method, url, extra, payload] of writes) {
      const response = await app.inject({
        method: method as "PUT",
        url,
        headers: { ...asDriver, ...extra },
        ...(payload === undefined ? {} : { payload }),
      });
      expect(response.statusCode, `${method} ${url}`).toBe(403);
    }
    expect(await count("catalog_company_logos")).toBe(1);
    expect(await count("catalog_company_cities")).toBe(0);

    // Staff need the CSRF token as well; a missing one is refused before the body is read.
    for (const [method, url, extra, payload] of writes.slice(0, 2)) {
      const response = await app.inject({
        method: method as "PUT",
        url,
        headers: { cookie: directorCookie, origin, ...extra },
        ...(payload === undefined ? {} : { payload }),
      });
      expect(response.statusCode, `${method} ${url} without csrf`).toBe(403);
    }
    expect(await count("catalog_company_logos")).toBe(1);

    // Staff remove the logo without a body; the image is gone and the item says so.
    const removed = await app.inject({
      method: "DELETE",
      url: adminLogoUrl,
      headers: { ...staffHeaders, "idempotency-key": newId() },
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json().data.logo).toBeNull();
    expect((await app.inject({ url: logoUrl, headers: { cookie: driverCookie } })).statusCode).toBe(
      404,
    );

    // Depot creation and its read, over HTTP, with the company logo reference.
    await catalogs.patch(director, "companies", c.id, newId(), { hidden: false });
    await app.inject({
      method: "PUT",
      url: adminLogoUrl,
      headers: { ...staffHeaders, ...form, "idempotency-key": newId() },
      payload: multipart("http_co.png", png),
    });
    const createdDepot = await app.inject({
      method: "POST",
      url: "/api/v1/admin/catalogs/depots",
      headers: { ...staffHeaders, ...json, "idempotency-key": newId() },
      payload: { game: "ets2", companyId: c.id, cityId: k.id },
    });
    expect(createdDepot.statusCode).toBe(201);
    const listed = await app.inject({
      url: `/api/v1/catalogs/depots?game=ets2&cityId=${k.id}&includeHidden=true`,
      headers: { cookie: driverCookie },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().data.items).toMatchObject([
      { company: { code: "http_co", logo: { version } }, city: { code: "http_city" } },
    ]);
    const duplicate = await app.inject({
      method: "POST",
      url: "/api/v1/admin/catalogs/depots",
      headers: { ...staffHeaders, ...json, "idempotency-key": newId() },
      payload: { game: "ets2", companyId: c.id, cityId: k.id },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe("CATALOG_CODE_CONFLICT");
  } finally {
    await app.close();
  }
});

test("HTTP rejects an invalid logo and an oversized batch with safe errors and stores nothing", async () => {
  const app = await createApp({ identity, catalogs, checkReadiness: async () => true });
  try {
    const token = await app
      .inject({ url: "/api/v1/auth/csrf", headers: { cookie: directorCookie } })
      .then((response) => response.json().data.token as string);
    const c = await company("http_bad_co");
    const headers = () => ({
      cookie: directorCookie,
      origin,
      "x-csrf-token": token,
      "idempotency-key": newId(),
      "content-type": `multipart/form-data; boundary=${boundary}`,
    });
    const put = (bytes: Buffer) =>
      app.inject({
        method: "PUT",
        url: `/api/v1/admin/catalogs/companies/${c.id}/logo`,
        headers: headers(),
        payload: multipart("x.png", bytes),
      });
    const jpeg = await put(jpegLike());
    expect(jpeg.statusCode).toBe(422);
    expect(jpeg.json().error.code).toBe("CATALOG_FILE_INVALID");
    expect((await put(rgbaLogo(1, 200, 40))).statusCode).toBe(422);
    const big = await put(Buffer.alloc(CATALOG_LOGO_MAX_BYTES + 1, 7));
    expect(big.statusCode).toBe(413);
    expect(big.json().error.code).toBe("CATALOG_FILE_TOO_LARGE");
    expect(await count("catalog_company_logos")).toBe(0);

    // The batch dry run answers 200 with per-file issues, and a bad file never blocks reading the rest.
    const preview = await app.inject({
      method: "POST",
      url: "/api/v1/admin/catalogs/companies/logo-previews?game=ets2",
      headers: headers(),
      payload: multipart("http_bad_co.png", rgbaLogo(1)),
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().data).toMatchObject({ added: 1, errors: 0 });
    const notPng = await app.inject({
      method: "POST",
      url: "/api/v1/admin/catalogs/companies/logo-previews?game=ets2",
      headers: headers(),
      payload: multipart("http_bad_co.png", jpegLike()),
    });
    expect(notPng.json().data).toMatchObject({
      errors: 1,
      token: null,
      lines: [{ line: 1, code: "http_bad_co", issues: [{ field: "file", reason: "not_png" }] }],
    });
    expect(await count("catalog_company_logos")).toBe(0);
  } finally {
    await app.close();
  }
});
