import { expect, test } from "vitest";
import { importColumns as serverColumns } from "../../apps/api/src/modules/catalogs/config.ts";
import {
  type CatalogFilters,
  catalogListParams,
  catalogTabs,
  fallbackBadge,
  filterParams,
  importChangedText,
  importColumns,
  importIssueText,
  importLinesFromDetails,
  logoSrc,
  parseFilters,
  templateCsv,
  templateJson,
} from "../../apps/web/src/features/catalogs/model.ts";
import { catalogTranslations } from "../../apps/web/src/features/catalogs/translations.ts";
import {
  catalogAttempt,
  depotListSchema,
  depotSchema,
  importPreviewSchema,
  importResultSchema,
  summarySchema,
} from "../../apps/web/src/features/catalogs/transport.ts";
import {
  clampActive,
  comboboxRows,
  leaveAction,
  moveActive,
  searchTerm,
  selectorDisplay,
  typedText,
} from "../../apps/web/src/shared/catalog-selectors/combobox.ts";
import {
  type CatalogItem,
  catalogParams,
  compatibleSelection,
  itemSchema,
  labelSchema,
  listOfKind,
  listSchema,
  logoSchema,
} from "../../apps/web/src/shared/catalog-selectors/contracts.ts";
import {
  cityNameText,
  secondaryCityName,
} from "../../apps/web/src/shared/catalog-selectors/native-name.ts";

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
  expect(listOfKind).toEqual({
    city: "cities",
    cargo: "cargoes",
    trailer: "trailers",
    company: "companies",
  });
});

const row = (entityId: string, overrides: Partial<CatalogItem> = {}): CatalogItem => ({
  ...item,
  id: entityId,
  ...overrides,
});
const rowsOf = (extra = false, hasMore = false, failed = false) =>
  comboboxRows({
    items: [row(id), row(regionId)],
    game: "ats",
    hasMore,
    failed,
    extra,
  }).map((r) => r.key);

test("combobox rows keep catalog rows first, then load more or refresh, then the extra row", () => {
  expect(rowsOf()).toEqual([id, regionId]);
  expect(rowsOf(true, true)).toEqual([id, regionId, "more", "extra"]);
  // A failed read offers only Refresh, even when the failed page had a next one.
  expect(rowsOf(true, true, true)).toEqual([id, regionId, "refresh", "extra"]);
  expect(rowsOf(false, true, true)).toEqual([id, regionId, "refresh"]);
});

test("combobox rows drop hidden and other-game rows and add no extra row without one", () => {
  const hidden = row("h", { hidden: true }),
    otherGame = row("o", { game: "ets2" });
  expect(
    comboboxRows({
      items: [hidden, otherGame, row(id)],
      game: "ats",
      hasMore: false,
      failed: false,
      extra: false,
    }).map((r) => r.key),
  ).toEqual([id]);
  expect(
    comboboxRows({ items: [], game: "ats", hasMore: false, failed: false, extra: true }).map(
      (r) => r.kind,
    ),
  ).toEqual(["extra"]);
  expect(
    comboboxRows({ items: [], game: "ats", hasMore: false, failed: false, extra: false }),
  ).toEqual([]);
});

const native = "Krönburg";
const translated: CatalogItem["display"] = {
  ...label,
  label: "Крёнбург",
  renderedLocale: "ru",
  englishFallback: false,
};

test("the selector shows the canonical city name and no English mark when it has one", () => {
  expect(selectorDisplay({ ...item, display: { ...translated, nameNative: native } })).toEqual({
    text: native,
    englishFallback: false,
  });
  // The English mark goes only when the canonical name replaces the fallback label.
  expect(selectorDisplay({ ...item, display: { ...label, nameNative: native } })).toEqual({
    text: native,
    englishFallback: false,
  });
  expect(selectorDisplay(item)).toEqual({ text: label.label, englishFallback: true });
  expect(selectorDisplay({ ...item, display: translated })).toEqual({
    text: "Крёнбург",
    englishFallback: false,
  });
  // Cargo-shaped rows never carry the name, so they keep their label and fallback mark.
  const cargo = { ...item, regionId: undefined, region: undefined, adrClass: "3" as const };
  expect(selectorDisplay(cargo as unknown as CatalogItem)).toEqual({
    text: label.label,
    englishFallback: true,
  });
});

test("secondary city text appears only when it differs from the displayed name", () => {
  expect(secondaryCityName({ ...translated, nameNative: native })).toBe(native);
  expect(secondaryCityName({ ...label, label: native, nameNative: native })).toBeNull();
  expect(secondaryCityName({ ...label, label: "KRÖNBURG", nameNative: native })).toBeNull();
  // A precomposed and a decomposed spelling are the same text.
  expect(
    secondaryCityName({ ...label, label: "Kro\u0308nburg", nameNative: "Kr\u00f6nburg" }),
  ).toBeNull();
  expect(secondaryCityName(label)).toBeNull();
  expect(secondaryCityName(null)).toBeNull();
  expect(secondaryCityName(undefined)).toBeNull();
  expect(cityNameText({ ...translated, nameNative: native }, "?")).toBe(`Крёнбург · ${native}`);
  expect(cityNameText(translated, "?")).toBe("Крёнбург");
  expect(cityNameText(null, "Unknown")).toBe("Unknown");
});

test("the web schemas accept the optional canonical name and bound it", () => {
  expect(labelSchema.safeParse({ ...label, nameNative: native }).success).toBe(true);
  expect(labelSchema.safeParse(label).success).toBe(true);
  expect(labelSchema.safeParse({ ...label, nameNative: "" }).success).toBe(false);
  expect(labelSchema.safeParse({ ...label, nameNative: "x".repeat(257) }).success).toBe(false);
  expect(itemSchema.safeParse({ ...item, nameNative: native }).success).toBe(true);
  expect(itemSchema.safeParse({ ...item, nameNative: null }).success).toBe(true);
  expect(itemSchema.safeParse(item).success).toBe(true);
  expect(itemSchema.safeParse({ ...item, nameNative: "" }).success).toBe(false);
});

test("arrow movement wraps and a shrunken list clamps the active row", () => {
  expect(moveActive(0, 1, 3)).toBe(1);
  expect(moveActive(2, 1, 3)).toBe(0);
  expect(moveActive(0, -1, 3)).toBe(2);
  expect(moveActive(-1, 1, 0)).toBe(-1);
  expect(clampActive(5, 3)).toBe(2);
  expect(clampActive(-1, 3)).toBe(0);
  expect(clampActive(Number.MAX_SAFE_INTEGER, 3)).toBe(2);
  expect(clampActive(0, 0)).toBe(-1);
});

test("leaving the field clears only fully erased text", () => {
  expect(leaveAction("", true)).toBe("clear");
  expect(leaveAction("   ", true)).toBe("clear");
  expect(leaveAction("", false)).toBe("restore");
  expect(leaveAction("abc", true)).toBe("restore");
  expect(leaveAction(null, true)).toBe("restore");
});

test("the search term is trimmed and clamped to the route limit", () => {
  expect(searchTerm(null)).toBe("");
  expect(searchTerm("  a b  ")).toBe("a b");
  expect(searchTerm("x".repeat(200))).toHaveLength(128);
  // Never ends on a space or half of a surrogate pair after clamping.
  expect(searchTerm(`${"x".repeat(127)} y`)).toBe("x".repeat(127));
  expect(searchTerm(`${"x".repeat(127)}🚚`)).toBe("x".repeat(127));
});

test("an edit of the extra row label the field shows holds no typed text", () => {
  const shown = { label: "Not listed", active: true };
  expect(typedText("Not listed", shown)).toBe("");
  expect(typedText("Not listed / x", shown)).toBe("");
  // Backspace leaves a prefix of the label.
  expect(typedText("Not liste", shown)).toBe("");
  expect(typedText("  Not  ", shown)).toBe("");
  expect(typedText(null, shown)).toBe("");
  // Neither a prefix nor an extension is real text.
  expect(typedText("  Ust  ", shown)).toBe("Ust");
  expect(typedText("Not listing", shown)).toBe("Not listing");
});

test("the same text is kept on a field that does not show the extra row", () => {
  const inactive = { label: "Not listed", active: false };
  expect(typedText("Not", inactive)).toBe("Not");
  expect(typedText("Not listed / x", inactive)).toBe("Not listed / x");
  expect(typedText("Ust")).toBe("Ust");
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
    company: "",
    city: "",
    maintenance: null,
  });
  expect(
    parseFilters(
      new URLSearchParams({
        game: "other",
        tab: "unknown",
        dlc: "not-a-uuid",
        region: "x",
        company: "y",
        city: "z",
      }),
    ),
  ).toEqual({
    game: "ets2",
    tab: "cities",
    q: "",
    dlc: "",
    region: "",
    company: "",
    city: "",
    maintenance: null,
  });
  expect(parseFilters(new URLSearchParams({ q: "x".repeat(200) })).q).toHaveLength(128);
  const full: CatalogFilters = {
    game: "ats",
    tab: "cities",
    q: "A & Б",
    dlc: "base",
    region: regionId,
    company: "",
    city: "",
    maintenance: "all",
  };
  expect(parseFilters(filterParams(full))).toEqual(full);
  expect(filterParams({ ...full, tab: "dlcs", dlc: id, region: regionId }).toString()).toBe(
    new URLSearchParams({ game: "ats", tab: "dlcs", q: "A & Б", hidden: "true" }).toString(),
  );
  expect(filterParams({ ...full, tab: "cargoes" }).has("region")).toBe(false);
  expect(
    filterParams({ ...full, game: "ets2", q: "", dlc: "", region: "", maintenance: null }).size,
  ).toBe(0);
  expect(parseFilters(new URLSearchParams({ tab: "cargoes" })).tab).toBe("cargoes");
  expect(catalogTabs).toEqual([
    "dlcs",
    "regions",
    "cities",
    "companies",
    "depots",
    "cargoes",
    "trailers",
  ]);
  // The company and city filters belong to the depots tab and survive a shared link there only.
  const depots: CatalogFilters = {
    ...full,
    tab: "depots",
    region: "",
    company: id,
    city: regionId,
  };
  expect(parseFilters(filterParams(depots))).toEqual(depots);
  expect(filterParams({ ...depots, tab: "companies" }).has("company")).toBe(false);
  expect(filterParams({ ...depots, tab: "companies" }).has("city")).toBe(false);
  expect(parseFilters(new URLSearchParams({ tab: "depots", company: "nope" })).company).toBe("");
});

test("maintenance deep links choose one supported mode and map to the exact list arguments", () => {
  const cases = [
    ["hidden=true", "hidden=true", { includeHidden: "true" }],
    ["hidden=only&untranslated=true", "hidden=only", { hidden: "only" }],
    ["tab=companies&hidden=only&logo=missing", "tab=companies&hidden=only", { hidden: "only" }],
    [
      "tab=companies&logo=missing&untranslated=true",
      "tab=companies&logo=missing",
      { logo: "missing" },
    ],
    [
      "tab=depots&logo=missing&untranslated=true&hidden=true",
      "tab=depots&untranslated=true",
      { untranslated: "true" },
    ],
    ["tab=depots&logo=missing&hidden=true", "tab=depots&hidden=true", { includeHidden: "true" }],
    ["tab=companies&logo=true&hidden=1&untranslated=on", "tab=companies", {}],
  ] as const;
  for (const [input, canonical, maintenance] of cases) {
    const parsed = parseFilters(new URLSearchParams(input));
    expect(filterParams(parsed).toString()).toBe(canonical);
    expect(
      Object.fromEntries(new URLSearchParams(catalogParams(catalogListParams(parsed, "en")))),
    ).toEqual({
      game: "ets2",
      locale: "en",
      limit: "25",
      ...maintenance,
    });
  }
  const filters = parseFilters(
    new URLSearchParams({
      tab: "depots",
      company: id,
      city: regionId,
      region: regionId,
      dlc: "base",
      hidden: "only",
      q: "A/B",
    }),
  );
  expect(
    Object.fromEntries(new URLSearchParams(catalogParams(catalogListParams(filters, "ru")))),
  ).toEqual({
    game: "ets2",
    search: "A/B",
    dlc: "base",
    hidden: "only",
    companyId: id,
    cityId: regionId,
    locale: "ru",
    limit: "25",
  });
  expect(filterParams({ ...filters, tab: "dlcs", maintenance: "missingLogo" }).has("logo")).toBe(
    false,
  );
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
  const lists = {
    dlcs: count,
    regions: count,
    cities: count,
    companies: count,
    depots: count,
    cargoes: count,
    trailers: count,
  };
  expect(summarySchema.parse({ game: "ats", lists }).lists.cities).toEqual(count);
  const expanded = { ...count, untranslated: 1 };
  const expandedLists = {
    dlcs: expanded,
    regions: expanded,
    cities: expanded,
    companies: { ...expanded, missingLogo: 0 },
    depots: expanded,
    cargoes: expanded,
    trailers: expanded,
  };
  expect(summarySchema.parse({ game: "ats", lists: expandedLists }).lists).toEqual(expandedLists);
  for (const cities of [
    { ...expanded, missingLogo: 0 },
    { ...expanded, unexpected: true },
    { ...expanded, untranslated: -1 },
    { ...expanded, untranslated: 0.5 },
  ]) {
    expect(
      summarySchema.safeParse({ game: "ats", lists: { ...expandedLists, cities } }).success,
    ).toBe(false);
  }
  expect(
    summarySchema.safeParse({
      game: "ats",
      lists: {
        ...expandedLists,
        companies: { ...expanded, missingLogo: Number.MAX_SAFE_INTEGER + 1 },
      },
    }).success,
  ).toBe(false);
  expect(summarySchema.safeParse({ game: "ats", lists, latest: id }).success).toBe(false);
  // A summary without the company counters is not this contract.
  const { depots: _depots, ...withoutDepots } = lists;
  expect(summarySchema.safeParse({ game: "ats", lists: withoutDepots }).success).toBe(false);

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
    "found",
    "historical",
    "historyError",
    "clearField",
    "more",
  ])
    expect(en).toHaveProperty(key);
  expect(en.tabTrailers).toBe("Trailers");
  expect([en.tabCompanies, en.tabDepots]).toEqual(["Companies", "Depots"]);
  expect([ru.tabCompanies, ru.tabDepots]).toEqual(["Компании", "Депо"]);
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

const { regionId: _unusedRegionId, region: _unusedRegion, ...cityless } = item;
const companyItem: CatalogItem = {
  ...cityless,
  code: "fictional_co",
  nameEn: "Fictional Freight Co",
};

test("a company row carries an optional logo reference and nothing else about the image", () => {
  const logo = { version: "0123456789abcdef", byteLength: 4096 };
  expect(itemSchema.parse({ ...companyItem, logo }).logo).toEqual(logo);
  expect(itemSchema.parse({ ...companyItem, logo: null }).logo).toBeNull();
  expect(itemSchema.parse(companyItem).logo).toBeUndefined();
  for (const bad of [
    { ...logo, extra: 1 },
    { version: "short", byteLength: 10 },
    { version: logo.version, byteLength: 0 },
    { version: logo.version, byteLength: 32769 },
    { version: logo.version },
  ])
    expect(logoSchema.safeParse(bad).success).toBe(false);
  expect(itemSchema.safeParse({ ...companyItem, logo: { ...logo, png: "AAAA" } }).success).toBe(
    false,
  );
  // The image URL names the company and the version, so a replaced logo is fetched again.
  expect(logoSrc(id, logo)).toBe(`/api/v1/catalogs/companies/${id}/logo?v=0123456789abcdef`);
  expect(logoSrc(id, { ...logo, version: "fedcba9876543210" })).not.toBe(logoSrc(id, logo));
});

const updatedAt = "2026-11-11T12:34:56.789Z";
const malformedInstants = [
  "2026-11-11T12:34:56Z",
  "2026-11-11T12:34:56.789+00:00",
  "2026-02-31T12:34:56.789Z",
  null,
];

test("item reads accept legacy payloads and the new row timestamp and company depot count", () => {
  expect(itemSchema.parse(companyItem)).toEqual(companyItem);
  const expanded = { ...companyItem, updatedAt, depotCount: 0 };
  expect(itemSchema.parse(expanded)).toEqual(expanded);
  expect(listSchema.parse({ items: [expanded], nextCursor: null, total: 1 }).items).toEqual([
    expanded,
  ]);
  expect(itemSchema.parse({ ...item, updatedAt }).updatedAt).toBe(updatedAt);
  for (const depotCount of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, "1", null])
    expect(itemSchema.safeParse({ ...expanded, depotCount }).success).toBe(false);
  for (const value of malformedInstants)
    expect(itemSchema.safeParse({ ...expanded, updatedAt: value }).success).toBe(false);
  expect(itemSchema.safeParse({ ...expanded, untranslated: 1 }).success).toBe(false);
});

test("depot rows accept both server shapes and reject extras", () => {
  const depot = {
    id: regionId,
    game: "ats",
    hidden: false,
    dlcId: null,
    dlc: null,
    company: {
      id,
      code: "fictional_co",
      label: { ...label, entityId: id, label: "Fictional Freight Co" },
      logo: null,
    },
    city: { id: regionId, code: "_x__x", label: { ...label, nameNative: "Fictional city" } },
  };
  expect(depotSchema.parse(depot)).toEqual(depot);
  const expanded = { ...depot, updatedAt };
  expect(depotListSchema.parse({ items: [expanded], nextCursor: null, total: 1 }).items).toEqual([
    expanded,
  ]);
  for (const value of malformedInstants)
    expect(depotSchema.safeParse({ ...expanded, updatedAt: value }).success).toBe(false);
  expect(depotSchema.safeParse({ ...expanded, depotCount: 1 }).success).toBe(false);
  expect(depotListSchema.safeParse({ items: [depot], nextCursor: null, total: 1 }).success).toBe(
    true,
  );
  expect(depotSchema.safeParse({ ...depot, extra: true }).success).toBe(false);
  expect(
    depotSchema.safeParse({ ...depot, company: { ...depot.company, blob: "AAAA" } }).success,
  ).toBe(false);
  expect(depotSchema.safeParse({ ...depot, city: { ...depot.city, region: null } }).success).toBe(
    false,
  );
  const { company: _company, ...withoutCompany } = depot;
  expect(depotSchema.safeParse(withoutCompany).success).toBe(false);
});

test("logo and depot dry-run messages are localized for both languages", () => {
  const en = translate("en"),
    ru = translate("ru");
  const cases: [string, string, keyof typeof catalogTranslations.en][] = [
    ["file", "bad_name", "issueBadName"],
    ["file", "not_png", "issueNotPng"],
    ["file", "too_large", "issueLogoTooLarge"],
    ["file", "bad_dimensions", "issueBadDimensions"],
    ["file", "corrupt", "issueCorrupt"],
    ["file", "duplicate_in_file", "issueDuplicateFile"],
    ["code", "unknown_reference", "issueUnknownCompany"],
    ["company_code", "unknown_reference", "issueUnknownCompany"],
    ["city_code", "unknown_reference", "issueUnknownCity"],
    ["company_code", "hidden_reference", "issueHiddenCompany"],
    ["city_code", "hidden_reference", "issueHiddenCity"],
  ];
  for (const [field, reason, key] of cases) {
    expect(importIssueText(en, { field, reason })).toBe(catalogTranslations.en[key]);
    expect(importIssueText(ru, { field, reason })).toBe(catalogTranslations.ru[key]);
  }
  expect(importChangedText(en, ["logo", "dlc_code"])).toBe("Changed fields: Logo, Source");
});
