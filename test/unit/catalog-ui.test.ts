import { expect, test } from "vitest";
import { importColumns as serverColumns } from "../../apps/api/src/modules/catalogs/config.ts";
import {
  type CatalogFilters,
  catalogTabs,
  fallbackBadge,
  filterParams,
  importChangedText,
  importColumns,
  importIssueText,
  importLinesFromDetails,
  parseFilters,
  templateCsv,
  templateJson,
} from "../../apps/web/src/features/catalogs/model.ts";
import { catalogTranslations } from "../../apps/web/src/features/catalogs/translations.ts";
import {
  catalogAttempt,
  importPreviewSchema,
  importResultSchema,
  summarySchema,
} from "../../apps/web/src/features/catalogs/transport.ts";
import {
  type CatalogItem,
  catalogParams,
  compatibleSelection,
  itemSchema,
  labelSchema,
  listOfKind,
  listSchema,
} from "../../apps/web/src/shared/catalog-selectors/contracts.ts";

const id = "51000000-0000-4000-8000-000000000020",
  regionId = "52000000-0000-4000-8000-000000000020";
const label: CatalogItem["display"] = {
  entityId: id,
  label: "Fictional city",
  requestedLocale: "ru",
  renderedLocale: "en",
  englishFallback: true,
  hidden: false,
};
const item: CatalogItem = {
  id,
  game: "ats",
  code: "_x__x",
  nameEn: "Fictional city",
  nameRu: null,
  hidden: false,
  display: label,
  dlcId: null,
  dlc: null,
  regionId,
  region: { ...label, entityId: regionId, label: "Fictional region" },
};

test("a selector offers visible same-game rows only, and a hidden row stays readable but not choosable", () => {
  expect(compatibleSelection(item, "ats")).toBe(true);
  expect(compatibleSelection(item, "ats", regionId)).toBe(true);
  expect(compatibleSelection(item, "ets2")).toBe(false);
  expect(compatibleSelection(item, "ats", id)).toBe(false);
  expect(compatibleSelection({ ...item, hidden: true }, "ats")).toBe(false);
  expect(listOfKind).toEqual({ city: "cities", cargo: "cargoes", trailer: "trailers" });
});

test("the English fallback badge follows only the display returned by the server", () => {
  expect(fallbackBadge(item)).toBe(true);
  expect(fallbackBadge({ ...item, display: { ...label, englishFallback: false } })).toBe(false);
  // Hidden is carried on the row and on a referenced label without losing the name.
  expect(labelSchema.parse({ ...label, hidden: true }).label).toBe("Fictional city");
});

test("uncertain retries retain their command key after more than sixty seconds", () => {
  const first = catalogAttempt("same-payload", null, 100);
  expect(catalogAttempt("same-payload", first, 100000)).toBe(first);
  expect(catalogAttempt("changed-payload", first, 100000).key).not.toBe(first.key);
  expect(catalogAttempt("same-payload", null, 100000).key).not.toBe(first.key);
});

test("filters parse safely from a shared URL and only non-default values are written back", () => {
  expect(parseFilters(new URLSearchParams())).toEqual({
    game: "ets2",
    tab: "cities",
    q: "",
    dlc: "",
    region: "",
    hidden: false,
  });
  expect(
    parseFilters(
      new URLSearchParams({ game: "other", tab: "unknown", dlc: "not-a-uuid", region: "x" }),
    ),
  ).toEqual({ game: "ets2", tab: "cities", q: "", dlc: "", region: "", hidden: false });
  expect(parseFilters(new URLSearchParams({ q: "x".repeat(200) })).q).toHaveLength(128);
  const full: CatalogFilters = {
    game: "ats",
    tab: "cities",
    q: "A & Б",
    dlc: "base",
    region: regionId,
    hidden: true,
  };
  expect(parseFilters(filterParams(full))).toEqual(full);
  expect(filterParams({ ...full, tab: "dlcs", dlc: id, region: regionId }).toString()).toBe(
    new URLSearchParams({ game: "ats", tab: "dlcs", q: "A & Б", hidden: "true" }).toString(),
  );
  expect(filterParams({ ...full, tab: "cargoes" }).has("region")).toBe(false);
  expect(
    filterParams({ ...full, game: "ets2", q: "", dlc: "", region: "", hidden: false }).size,
  ).toBe(0);
  expect(parseFilters(new URLSearchParams({ tab: "cargoes" })).tab).toBe("cargoes");
  expect(catalogTabs).toEqual(["dlcs", "regions", "cities", "cargoes", "trailers"]);
});

test("request parameters drop empty values and keep exact IDs and search text", () => {
  const query = new URLSearchParams(
    catalogParams({ regionId: id, search: "A & Б", limit: 25, cursor: null, game: undefined }),
  );
  expect(Object.fromEntries(query)).toEqual({ regionId: id, search: "A & Б", limit: "25" });
});

test("downloaded templates match the columns the server reads", () => {
  for (const list of catalogTabs) {
    expect(importColumns[list]).toEqual(serverColumns[list]);
    expect(templateCsv(list)).toBe(`${serverColumns[list].join(",")}\r\n`);
    const parsed = JSON.parse(templateJson(list)) as Record<string, string>[];
    expect(parsed).toHaveLength(1);
    expect(Object.keys(parsed[0] as Record<string, string>)).toEqual([...serverColumns[list]]);
  }
});

test("web schemas accept server shapes and reject unknown or retired fields", () => {
  expect(itemSchema.parse(item).code).toBe("_x__x");
  expect(listSchema.parse({ items: [item], nextCursor: null, total: 1 }).items).toHaveLength(1);
  for (const extra of [{ revisionId: id }, { retired: false }, { private_payload: "sentinel" }])
    expect(itemSchema.safeParse({ ...item, ...extra }).success).toBe(false);
  expect(labelSchema.safeParse({ ...label, retired: false }).success).toBe(false);

  const count = { visible: 1, hidden: 0 };
  const lists = { dlcs: count, regions: count, cities: count, cargoes: count, trailers: count };
  expect(summarySchema.safeParse({ game: "ats", lists }).success).toBe(true);
  expect(summarySchema.safeParse({ game: "ats", lists, latest: id }).success).toBe(false);

  const preview = {
    fileSha256: "a".repeat(64),
    token: "signed",
    rows: 1,
    added: 1,
    changed: 0,
    unchanged: 0,
    errors: 0,
    lines: [],
    truncated: false,
  };
  expect(importPreviewSchema.safeParse(preview).success).toBe(true);
  expect(importPreviewSchema.safeParse({ ...preview, token: null }).success).toBe(true);
  expect(
    importPreviewSchema.safeParse({
      ...preview,
      lines: [{ line: 1, code: null, status: "added", issues: [], changedFields: [] }],
    }).success,
  ).toBe(false);
  expect(
    importResultSchema.safeParse({ importId: id, rows: 1, added: 1, changed: 0, unchanged: 0 })
      .success,
  ).toBe(true);
});

const translate = (locale: "en" | "ru") =>
  ((key: string, values: Record<string, string> = {}) =>
    (catalogTranslations[locale] as Record<string, string>)[key]?.replace(
      /{{(\w+)}}/g,
      (_, name: string) => values[name] ?? "",
    ) ?? key) as unknown as Parameters<typeof importIssueText>[0];

test("dry-run results read as localized text and keep unknown codes readable", () => {
  const en = translate("en"),
    ru = translate("ru");
  expect(importIssueText(en, { field: "dlc_code", reason: "unknown_reference" })).toBe(
    "This game has no source with this code",
  );
  expect(importIssueText(ru, { field: "region_code", reason: "hidden_reference" })).toBe(
    catalogTranslations.ru.issueHiddenRegion,
  );
  expect(importIssueText(en, { field: "name_ru", reason: "too_long" })).toBe("Name RU is too long");
  expect(importIssueText(ru, { field: "code", reason: "required" })).toBe("Не заполнено поле Код");
  expect(importIssueText(en, { field: "extra_col", reason: "unknown_field" })).toBe(
    "Unknown column: extra_col",
  );
  expect(importIssueText(en, { field: "constructor", reason: "future_reason" })).toBe(
    "constructor: future_reason",
  );
  expect(importChangedText(en, ["name_ru", "dlc_code", "future_field"])).toBe(
    "Changed fields: Name RU, Source, future_field",
  );
});

test("an apply rejection's line details rebuild the dry-run lines", () => {
  expect(
    importLinesFromDetails([
      { field: "line:12:dlc_code", code: "unknown_reference" },
      { field: "line:3:code", code: "required" },
      { field: "line:12:name_en", code: "too_long" },
      { field: "idempotency-key", code: "x" },
      { field: "line:x:code", code: "required" },
      { field: "line:4:code" },
      null,
    ]),
  ).toEqual([
    {
      line: 3,
      code: null,
      status: "error",
      issues: [{ field: "code", reason: "required" }],
      changedFields: [],
    },
    {
      line: 12,
      code: null,
      status: "error",
      issues: [
        { field: "dlc_code", reason: "unknown_reference" },
        { field: "name_en", reason: "too_long" },
      ],
      changedFields: [],
    },
  ]);
  expect(importLinesFromDetails(undefined)).toEqual([]);
  expect(importLinesFromDetails([])).toEqual([]);
});

test("catalog strings keep RU/EN parity and name the shared and owner-required text", () => {
  const { en, ru } = catalogTranslations;
  expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort());
  for (const key of [
    "pageForbidden",
    "readError",
    "loading",
    "empty",
    "emptyList",
    "fallback",
    "rowFallback",
    "statusError",
    "issueGeneric",
    "hidden",
    "staffOnly",
    "choose",
    "search",
    "selected",
    "historical",
    "historyError",
    "clear",
    "more",
  ])
    expect(en).toHaveProperty(key);
  expect(en.tabTrailers).toBe("Trailers");
  expect(ru.tabTrailers).toBe("Прицепы");
  expect(en.trailerCodeHint).toBe(
    "Body type from telemetry (body.type), not the trailer ID. A coupling counts as its first trailer's type.",
  );
  expect(ru.trailerCodeHint).toBe(
    "Тип кузова из телеметрии (body.type), а не ID прицепа. У сцепки учитывается тип первого прицепа.",
  );
  for (const key of ["revisionsTitle", "reviewTitle", "publish", "mappingTitle", "retired"])
    expect(en).not.toHaveProperty(key);
  for (const value of [...Object.values(en), ...Object.values(ru)])
    expect(value).not.toMatch(/справочник/i);
});
