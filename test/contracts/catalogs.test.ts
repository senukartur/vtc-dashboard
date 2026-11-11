import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { createSchemaValidator } from "../../apps/api/src/platform/http/schemas.ts";

const id = "10000000-0000-4000-8000-000000000001",
  regionId = "20000000-0000-4000-8000-000000000001";
const validate = (name: string) =>
  createSchemaValidator().compile({ $ref: `urn:vtc:browser:v1#/$defs/${name}` });
const label = {
  entityId: id,
  label: "Fictional City",
  requestedLocale: "ru",
  renderedLocale: "en",
  englishFallback: true,
  hidden: false,
};
const item = {
  id,
  game: "ats",
  code: "_fixture__city",
  nameEn: "Fictional City",
  nameRu: null,
  hidden: false,
  display: label,
  dlcId: null,
  dlc: null,
  regionId,
  region: { ...label, entityId: regionId, label: "Fictional Region" },
};

test("catalog items carry label fallback and reject the retired revision model", () => {
  expect(validate("CatalogItem")(item)).toBe(true);
  expect(validate("CatalogItem")({ ...item, adrClass: "3" })).toBe(true);
  expect(validate("CatalogItem")({ ...item, adrClass: "5" })).toBe(false);
  for (const extra of [
    { revisionId: id },
    { mapNamespace: "base" },
    { cargoMassKg: "1000" },
    { sourcePath: "nonfunctional-placeholder" },
  ])
    expect(validate("CatalogItem")({ ...item, ...extra })).toBe(false);
  expect(validate("CatalogItem")({ ...item, display: { ...label, retired: true } })).toBe(false);
  expect(validate("CatalogLabel")({ ...label, hidden: undefined })).toBe(false);
  expect(validate("EffectiveCatalogPin")({ entityId: id })).toBe(true);
  expect(validate("EffectiveCatalogPin")({ entityId: id, catalogRevisionId: id })).toBe(false);
});

test("the canonical city name is optional on labels and items and rejects a blank value", () => {
  const validLabel = validate("CatalogLabel"),
    validItem = validate("CatalogItem");
  expect(validLabel({ ...label, nameNative: "Krönburg" })).toBe(true);
  expect(validLabel(label)).toBe(true);
  expect(validLabel({ ...label, nameNative: "" })).toBe(false);
  expect(validLabel({ ...label, nameNative: "x".repeat(257) })).toBe(false);
  expect(validLabel({ ...label, nameNative: null })).toBe(false);
  expect(validItem({ ...item, nameNative: "Krönburg" })).toBe(true);
  expect(validItem({ ...item, nameNative: null })).toBe(true);
  expect(validItem(item)).toBe(true);
  expect(validItem({ ...item, nameNative: "" })).toBe(false);
  expect(validItem({ ...item, nameNative: "x".repeat(257) })).toBe(false);
  expect(validItem({ ...item, display: { ...label, nameNative: "" } })).toBe(false);
});

test("the canonical name is a nullable write field for cities only", () => {
  const base = { game: "ets2", code: "kronburg", nameEn: "Crownburg" };
  expect(validate("CatalogCityInput")({ ...base, nameNative: "Krönburg" })).toBe(true);
  expect(validate("CatalogCityInput")({ ...base, nameNative: null })).toBe(true);
  expect(validate("CatalogCityInput")({ ...base, nameNative: "x".repeat(257) })).toBe(false);
  expect(validate("CatalogCargoInput")({ ...base, nameNative: "Krönburg" })).toBe(false);
  expect(validate("CatalogTrailerInput")({ ...base, nameNative: "Krönburg" })).toBe(false);
  expect(validate("CatalogItemPatch")({ nameNative: null })).toBe(true);
  expect(validate("CatalogItemPatch")({ nameNative: "Krönburg" })).toBe(true);
});

test("create inputs follow each list and treat code as bounded opaque text", () => {
  const base = { game: "ets2", code: "_x__x", nameEn: "Fictional" };
  expect(validate("CatalogDlcInput")({ ...base, steamAppId: 4294967295 })).toBe(true);
  expect(validate("CatalogDlcInput")({ ...base, steamAppId: 0 })).toBe(false);
  expect(validate("CatalogCityInput")({ ...base, regionId })).toBe(true);
  expect(validate("CatalogCargoInput")({ ...base, adrClass: "8" })).toBe(true);
  expect(validate("CatalogCargoInput")({ ...base, adrClass: "7" })).toBe(false);
  expect(validate("CatalogTrailerInput")({ ...base, dlcId: id })).toBe(true);
  expect(validate("CatalogTrailerInput")({ ...base, adrClass: "8" })).toBe(false);
  for (const code of ["", "a b", "a\u0000", " a", "a".repeat(129)])
    expect(validate("CatalogTrailerInput")({ ...base, code })).toBe(false);
  expect(validate("CatalogTrailerInput")({ ...base, nameEn: "   " })).toBe(false);
  expect(validate("CatalogTrailerInput")({ ...base, game: "eu" })).toBe(false);
});

test("a row edit is partial, non-empty and can never move a row between games", () => {
  expect(validate("CatalogItemPatch")({ hidden: true })).toBe(true);
  expect(validate("CatalogItemPatch")({ nameRu: null, code: "renamed" })).toBe(true);
  expect(validate("CatalogItemPatch")({})).toBe(false);
  expect(validate("CatalogItemPatch")({ game: "ats" })).toBe(false);
  expect(validate("CatalogItemPatch")({ hidden: "yes" })).toBe(false);
});

test("import results are closed and a preview with errors withholds its token", () => {
  const preview = {
    fileSha256: "a".repeat(64),
    token: null,
    rows: 2,
    added: 1,
    changed: 0,
    unchanged: 0,
    errors: 1,
    lines: [
      {
        line: 3,
        code: null,
        status: "error",
        issues: [{ field: "code", reason: "invalid" }],
        changedFields: [],
      },
    ],
    truncated: false,
  };
  expect(validate("CatalogImportPreview")(preview)).toBe(true);
  expect(validate("CatalogImportPreview")({ ...preview, token: "t".repeat(2049) })).toBe(false);
  expect(
    validate("CatalogImportPreview")({
      ...preview,
      lines: [{ ...preview.lines[0], status: "added" }],
    }),
  ).toBe(false);
  expect(
    validate("CatalogImportResult")({ importId: id, rows: 1, added: 1, changed: 0, unchanged: 0 }),
  ).toBe(true);
  expect(validate("CatalogImportResult")({ importId: id, rows: 1, added: 1, changed: 0 })).toBe(
    false,
  );
});

const companyId = "30000000-0000-4000-8000-000000000001";
const company = {
  id: companyId,
  game: "ets2",
  code: "fictional_freight",
  nameEn: "Fictional Freight",
  nameRu: null,
  hidden: false,
  display: { ...label, entityId: companyId, label: "Fictional Freight" },
  dlcId: null,
  dlc: null,
};

test("a company row has an optional logo reference and never carries image bytes", () => {
  const validItem = validate("CatalogItem");
  const logo = { version: "0123456789abcdef", byteLength: 2048 };
  expect(validItem(company)).toBe(true);
  expect(validItem({ ...company, logo })).toBe(true);
  expect(validItem({ ...company, logo: null })).toBe(true);
  for (const bad of [
    { ...logo, png: "AAAA" },
    { ...logo, sha256: "a".repeat(64) },
    { version: "0123", byteLength: 2048 },
    { version: "0123456789ABCDEF", byteLength: 2048 },
    { version: logo.version, byteLength: 0 },
    { version: logo.version, byteLength: 32769 },
    { byteLength: 2048 },
  ])
    expect(validItem({ ...company, logo: bad }), JSON.stringify(bad)).toBe(false);
  expect(validate("CatalogLogo")(logo)).toBe(true);
});

test("company input and patch follow the plain-list shape", () => {
  const base = { game: "ets2", code: "fictional_freight", nameEn: "Fictional Freight" };
  const input = validate("CatalogCompanyInput");
  expect(input(base)).toBe(true);
  expect(input({ ...base, nameRu: null, dlcId: id })).toBe(true);
  for (const extra of [{ regionId }, { adrClass: "3" }, { nameNative: "x" }, { logo: null }])
    expect(input({ ...base, ...extra })).toBe(false);
  expect(input({ ...base, code: "a b" })).toBe(false);
  expect(input({ game: "ets2", code: "fictional_freight" })).toBe(false);
  expect(validate("CatalogItemPatch")({ dlcId: null, hidden: true })).toBe(true);
});

test("summary counts include companies and depots", () => {
  const count = { visible: 3, hidden: 1 };
  const lists = {
    dlcs: count,
    regions: count,
    cities: count,
    companies: count,
    depots: count,
    cargoes: count,
    trailers: count,
  };
  expect(validate("CatalogSummary")({ game: "ets2", lists })).toBe(true);
  const { depots: _depots, ...withoutDepots } = lists;
  expect(validate("CatalogSummary")({ game: "ets2", lists: withoutDepots })).toBe(false);
  expect(validate("CatalogSummary")({ game: "ets2", lists: { ...lists, other: count } })).toBe(
    false,
  );
});

test("a depot names its company, city and source and is closed to extra fields", () => {
  const depot = {
    id,
    game: "ets2",
    hidden: false,
    dlcId: null,
    dlc: null,
    company: {
      id: companyId,
      code: "fictional_freight",
      label: { ...label, entityId: companyId },
      logo: null,
    },
    city: { id: regionId, code: "_fixture__city", label: { ...label, entityId: regionId } },
  };
  const valid = validate("CatalogDepot");
  expect(valid(depot)).toBe(true);
  expect(
    valid({
      ...depot,
      company: { ...depot.company, logo: { version: "0123456789abcdef", byteLength: 10 } },
    }),
  ).toBe(true);
  expect(valid({ ...depot, extra: true })).toBe(false);
  expect(valid({ ...depot, company: { ...depot.company, nameEn: "x" } })).toBe(false);
  expect(valid({ ...depot, city: { ...depot.city, logo: null } })).toBe(false);
  const { company: _company, ...withoutCompany } = depot;
  expect(valid(withoutCompany)).toBe(false);
  expect(validate("CatalogDepotList")({ items: [depot], nextCursor: null, total: 1 })).toBe(true);
  expect(
    validate("CatalogDepotList")({ items: Array(101).fill(depot), nextCursor: null, total: 101 }),
  ).toBe(false);
});

test("depot input and patch keep the game, company and city fixed once created", () => {
  const input = validate("CatalogDepotInput"),
    patch = validate("CatalogDepotPatch");
  const base = { game: "ats", companyId, cityId: regionId };
  expect(input(base)).toBe(true);
  expect(input({ ...base, dlcId: id })).toBe(true);
  expect(input({ ...base, dlcId: null })).toBe(true);
  for (const bad of [
    { ...base, extra: 1 },
    { ...base, game: "eu" },
    { ...base, companyId: "not-a-uuid" },
    { game: "ats", companyId },
    { game: "ats", cityId: regionId },
  ])
    expect(input(bad), JSON.stringify(bad)).toBe(false);
  expect(patch({ hidden: true })).toBe(true);
  expect(patch({ dlcId: null })).toBe(true);
  for (const bad of [{}, { companyId }, { cityId: regionId }, { game: "ets2" }, { hidden: "yes" }])
    expect(patch(bad), JSON.stringify(bad)).toBe(false);
});

test("a logo batch is a closed list of at most 500 files", () => {
  const batch = validate("CatalogLogoBatchInput");
  expect(batch({ file: ["a.png"] })).toBe(true);
  expect(batch({ file: [] })).toBe(false);
  expect(batch({ file: Array(501).fill("a.png") })).toBe(false);
  expect(batch({ file: ["a.png"], note: "x" })).toBe(false);
  expect(validate("EnvelopeCatalogDepot")({ data: undefined, meta: {} })).toBe(false);
});

const dashboardContract = (file: string) =>
  JSON.parse(
    readFileSync(new URL(`../../docs/contracts/dashboard/${file}`, import.meta.url), "utf8"),
  );
const stageFixtures = dashboardContract("examples.json");
const stageFixture = (id: string) =>
  stageFixtures.cases.find((item: { id: string }) => item.id === id);

test("staged catalog filter examples follow the list-specific query parameters", () => {
  const spec = dashboardContract("openapi.json");
  const items = spec.paths["/api/v1/catalogs/{list}"].get;
  const depots = spec.paths["/api/v1/catalogs/depots"].get;
  const compileQuery = (operation: typeof items) => {
    const properties = Object.fromEntries(
      operation.parameters
        .filter((p: { in?: string }) => p.in === "query")
        .map((p: { name: string; schema: object }) => [p.name, p.schema]),
    );
    return createSchemaValidator().compile({
      type: "object",
      properties,
      required: ["game"],
      additionalProperties: false,
    });
  };
  const itemQuery = compileQuery(items);
  const depotQuery = compileQuery(depots);
  const hidden = stageFixture("listCatalogItems:updated-dlcs");
  const company = stageFixture("listCatalogItems:updated-companies");
  const untranslated = stageFixture("listCatalogItems:updated-cities");
  const depot = stageFixture("listCatalogDepots:hidden-untranslated");
  expect(hidden.query).toEqual({ game: "ets2", hidden: "only", includeHidden: false });
  expect(company).toMatchObject({ path: { list: "companies" }, query: { logo: "missing" } });
  expect(untranslated.query).toEqual({ game: "ets2", untranslated: true });
  expect(depot.query).toMatchObject({ hidden: "only", includeHidden: false, untranslated: true });
  expect(itemQuery(hidden.query)).toBe(true);
  expect(itemQuery(company.query)).toBe(true);
  expect(itemQuery(untranslated.query)).toBe(true);
  expect(depotQuery(depot.query)).toBe(true);
  expect(depotQuery(company.query)).toBe(false);
  for (const query of [
    { hidden: "all" },
    { untranslated: false },
    { untranslated: "true" },
    { logo: "present" },
  ]) {
    expect(itemQuery({ game: "ets2", ...query })).toBe(false);
  }
  expect(items.parameters.find((p: { name?: string }) => p.name === "logo").description).toMatch(
    /Companies list only/,
  );
  expect(items.description).toMatch(/bound into the cursor/);
  expect(depots.description).toMatch(/takes precedence over includeHidden/);
});

test("catalog row timestamps and summary counters are additive and bounded", () => {
  const summary = stageFixture("getCatalogSummary:visible-filter-counts");
  expect(summary.query).toEqual({ game: "ets2" });
  const data = summary.response.data;
  expect(validate("CatalogSummary")(data)).toBe(true);
  expect(data.lists.trailers.untranslated).toBe(0);
  expect(data.lists.companies.missingLogo).toBe(1);
  expect(
    validate("CatalogSummary")({
      ...data,
      lists: { ...data.lists, depots: { ...data.lists.depots, missingLogo: 1 } },
    }),
  ).toBe(false);
  expect(
    validate("CatalogSummary")({
      ...data,
      lists: { ...data.lists, cargoes: { ...data.lists.cargoes, untranslated: -1 } },
    }),
  ).toBe(false);
  for (const kind of ["dlcs", "regions", "cities", "companies", "cargoes", "trailers"]) {
    const fixture = stageFixture(`listCatalogItems:updated-${kind}`);
    expect(fixture.path).toEqual({ list: kind });
    const [row] = fixture.response.data.items;
    expect(validate("CatalogItem")(row)).toBe(true);
    expect(row.updatedAt).toMatch(/\.\d{3}Z$/);
    expect(validate("CatalogItem")({ ...row, updatedAt: "2026-10-21" })).toBe(false);
    if (kind === "companies") {
      expect(row.depotCount).toBe(2);
      expect(validate("CatalogItem")({ ...row, depotCount: 0 })).toBe(true);
      expect(validate("CatalogItem")({ ...row, depotCount: -1 })).toBe(false);
    } else {
      expect(row).not.toHaveProperty("depotCount");
    }
  }
  const example = stageFixture("listCatalogDepots:hidden-untranslated");
  const [depot] = example.response.data.items;
  expect(validate("CatalogDepot")(depot)).toBe(true);
  for (const label of [depot.company.label, depot.city.label]) {
    expect(label).toMatchObject({
      requestedLocale: example.query.locale,
      renderedLocale: "en",
      englishFallback: true,
    });
  }
  expect(depot.updatedAt).toMatch(/\.\d{3}Z$/);
  expect(validate("CatalogDepot")({ ...depot, updatedAt: "2026-10-21T12:00:00.000+00:00" })).toBe(
    false,
  );
  expect(validate("CatalogDepot")({ ...depot, depotCount: 1 })).toBe(false);
  expect(validate("CatalogDepotPatch")({ hidden: true, updatedAt: depot.updatedAt })).toBe(false);
  expect(validate("CatalogItemPatch")({ hidden: true, depotCount: 1 })).toBe(false);
});
