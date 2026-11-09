import type { Locator, Page, TestInfo } from "@playwright/test";
import { catalogTranslations } from "../../apps/web/src/features/catalogs/translations.ts";
import {
  catalogItem,
  catalogLanguage,
  catalogList,
  chooseCatalogRow,
  cargoRowId,
  dlcId,
  defaultRows,
  entityId,
  envelope,
  mockCatalogs,
  regionId,
  trailerRowId,
} from "./support/catalogs.ts";
import { browserCase, expect, test } from "./support/fixtures.ts";
import { mockTrips } from "./support/trip-ui.ts";

const phone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 760;
const tab = (page: Page, name: string) => page.getByRole("tab", { name: new RegExp(`^${name}`) });
const rowOf = (page: Page, text: string) =>
  phone(page)
    ? page.locator(".catalog-card-row").filter({ hasText: text })
    : page.getByTestId("catalog-table").getByRole("row").filter({ hasText: text });
async function open(page: Page, locale: "en" | "ru" = "en", search = "") {
  await page.goto(`/account/catalogs${search}`);
  await catalogLanguage(page, locale);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    catalogTranslations[locale].title,
  );
}
async function fitsViewport(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function capture(page: Page, info: TestInfo, name: string) {
  await fitsViewport(page);
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
}
/** The row's action trigger: table buttons on desktop, the actions sheet on a phone. */
async function rowAction(page: Page, text: string, action: string) {
  if (!phone(page))
    return rowOf(page, text).getByRole("button", { name: action, exact: true }).click();
  await page.getByRole("button", { name: `Actions for ${text}`, exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: action, exact: true }).click();
}
for (const locale of ["en", "ru"] as const) {
  test(
    `${locale} lists show tabs, labels and layout at every width`,
    browserCase(["@layout"]),
    async ({ page }, info) => {
      const c = catalogTranslations[locale];
      await mockCatalogs(page, true, {
        rows: {
          ets2: {
            ...defaultRows(locale),
            cities: [
              catalogItem(entityId, "Fictional long logistics terminal city name", locale, {
                regionId,
                region: { ...catalogItem(regionId, "Fictional region", locale).display },
                code: "_city__fixture",
              }),
              catalogItem("63000000-0000-4000-8000-000000000030", "Fictional hidden city", locale, {
                hidden: true,
                display: {
                  ...catalogItem(regionId, "Fictional hidden city", locale).display,
                  hidden: true,
                },
              }),
            ],
            cargoes: [
              catalogItem(cargoRowId, "Fictional cargo", locale, { adrClass: "3" }),
              catalogItem("63000000-0000-4000-8000-000000000031", "Fictional plain", locale, {
                adrClass: null,
              }),
            ],
            dlcs: [catalogItem(dlcId, "Fictional pack", locale, { steamAppId: 1234 })],
          },
        },
      });
      await open(page, locale);
      for (const name of [c.tabDlcs, c.tabRegions, c.tabCities, c.tabCargoes, c.tabTrailers])
        await expect(tab(page, name)).toBeVisible();
      await expect(tab(page, c.tabCities)).toHaveAttribute("aria-selected", "true");
      await expect(
        rowOf(page, "Fictional long logistics").getByText("_city__fixture"),
      ).toBeVisible();
      await expect(
        page.locator(
          phone(page) ? '[data-testid="catalog-cards"]' : '[data-testid="catalog-table"]',
        ),
      ).toBeVisible();
      await expect(
        page.locator(
          phone(page) ? '[data-testid="catalog-table"]' : '[data-testid="catalog-cards"]',
        ),
      ).toBeHidden();
      if (locale === "ru")
        await expect(
          rowOf(page, "Fictional long logistics").getByText(c.rowFallback),
        ).toBeVisible();
      else await expect(page.getByText(c.rowFallback, { exact: true })).toHaveCount(0);
      await expect(page.getByText("Fictional hidden city", { exact: true })).toHaveCount(0);
      await capture(page, info, `lists-${locale}-cities`);

      await tab(page, c.tabCargoes).click();
      await expect(page).toHaveURL(/tab=cargoes/);
      await expect(rowOf(page, "Fictional plain").getByText(c.nonHazardous)).toBeVisible();
      await tab(page, c.tabTrailers).click();
      await expect(page).toHaveURL(/tab=trailers/);
      await tab(page, c.tabDlcs).click();
      // The Steam app ID is a table column; phone rows carry only the name and code.
      if (phone(page)) await expect(rowOf(page, "Fictional pack")).toBeVisible();
      else await expect(rowOf(page, "Fictional pack").getByText("1234")).toBeVisible();
      await capture(page, info, `lists-${locale}-dlcs`);
    },
  );
}

test(
  "a staff member can add a row, and a duplicate code keeps the form open with the right error",
  browserCase(["@functional", "@smoke-catalogs"]),
  async ({ page }) => {
    const c = catalogTranslations.en;
    const bodies: unknown[] = [];
    let conflict = false;
    await mockCatalogs(page, true, {
      rows: { ets2: { ...defaultRows("en"), trailers: [] } },
      writes: ({ method, path, body }) => {
        if (method === "POST" && path === "/admin/catalogs/trailers") {
          bodies.push(JSON.parse(String(body)));
          if (conflict) return { status: 409, json: { error: { code: "CATALOG_CODE_CONFLICT" } } };
          return { status: 201, json: envelope(catalogItem(trailerRowId, "Fictional curtain")) };
        }
        return null;
      },
    });
    await open(page, "en", "?tab=trailers");
    await expect(page.getByText(c.emptyList, { exact: true })).toBeVisible();
    // On a phone the bottom bar carries the same actions.
    await page.getByRole("button", { name: c.addTrailers, exact: true }).last().click();
    const form = page.getByRole("dialog");
    await expect(form.getByText(c.trailerCodeHint, { exact: true })).toBeVisible();
    await form.getByRole("button", { name: c.save, exact: true }).click();
    await expect(form.getByText(c.errorRequired, { exact: true })).toBeVisible();
    expect(bodies).toEqual([]);
    await form.getByLabel(c.fieldCode, { exact: true }).fill("_box__fixture");
    await form.getByLabel(c.fieldNameEn, { exact: true }).fill("Fictional curtain");
    conflict = true;
    await form.getByRole("button", { name: c.save, exact: true }).click();
    await expect(form.getByText(c.errorCodeTaken, { exact: true })).toBeVisible();
    await expect(form).toBeVisible();
    conflict = false;
    await form.getByRole("button", { name: c.save, exact: true }).click();
    await expect(form).toHaveCount(0);
    expect(bodies).toEqual([
      {
        game: "ets2",
        code: "_box__fixture",
        nameEn: "Fictional curtain",
        nameRu: null,
        dlcId: null,
      },
      {
        game: "ets2",
        code: "_box__fixture",
        nameEn: "Fictional curtain",
        nameRu: null,
        dlcId: null,
      },
    ]);
  },
);

test(
  "editing sends a partial change, hide and restore round-trip, and a failed hide shows the reason",
  browserCase(["@functional"]),
  async ({ page }) => {
    const c = catalogTranslations.en;
    const patches: unknown[] = [];
    let failHide = false;
    const hidden = catalogItem(entityId, "Fictional city", "en", {
      hidden: true,
      display: { ...catalogItem(entityId, "Fictional city").display, hidden: true },
    });
    await mockCatalogs(page, true, {
      rows: { ets2: { cities: [catalogItem(entityId, "Fictional city"), hidden] } },
      writes: ({ method, path, body }) => {
        if (method !== "PATCH" || !path.endsWith(entityId)) return null;
        const parsed = JSON.parse(String(body));
        patches.push(parsed);
        if (failHide) return { status: 503, json: { error: { code: "PRIVATE_SENTINEL" } } };
        return {
          status: 200,
          json: envelope(catalogItem(entityId, parsed.nameEn ?? "Fictional city")),
        };
      },
    });
    await open(page);
    await rowAction(page, "Fictional city", c.edit);
    const form = page.getByRole("dialog");
    await form.getByLabel(c.fieldNameRu, { exact: true }).fill("Вымышленный город");
    await form.getByRole("button", { name: c.save, exact: true }).click();
    await expect(form).toHaveCount(0);
    expect(patches.at(-1)).toMatchObject({ nameRu: "Вымышленный город", code: "fictional_city" });
    failHide = true;
    await rowAction(page, "Fictional city", c.hide);
    await expect(page.getByRole("alert")).toContainText(c.unavailableError);
    failHide = false;
    await page.getByRole("checkbox", { name: c.showHidden }).click();
    await expect(page).toHaveURL(/hidden=true/);
    await rowAction(page, "Fictional city", c.restore);
    await expect.poll(() => patches.at(-1)).toEqual({ hidden: false });
  },
);

test(
  "a hidden source is offered only as the row's current value, marked hidden",
  browserCase(["@functional"]),
  async ({ page }) => {
    const c = catalogTranslations.en;
    const hiddenDlc = "65000000-0000-4000-8000-000000000021";
    await mockCatalogs(page, true, {
      rows: {
        ets2: {
          dlcs: [
            catalogItem(dlcId, "Fictional visible pack"),
            catalogItem(hiddenDlc, "Fictional hidden pack", "en", {
              hidden: true,
              display: { ...catalogItem(hiddenDlc, "Fictional hidden pack").display, hidden: true },
            }),
          ],
          cities: [catalogItem(entityId, "Fictional city", "en", { dlcId: hiddenDlc })],
        },
      },
    });
    await open(page);
    await rowAction(page, "Fictional city", c.edit);
    let form = page.getByRole("dialog");
    await expect(form.locator(`option[value="${hiddenDlc}"]`)).toHaveText(
      `Fictional hidden pack · ${c.hidden}`,
    );
    await expect(form.getByLabel(c.fieldDlc, { exact: true })).toHaveValue(hiddenDlc);
    await form.getByRole("button", { name: c.cancel, exact: true }).click();
    await page.getByRole("button", { name: c.addCities, exact: true }).first().click();
    form = page.getByRole("dialog");
    await expect(form.locator(`option[value="${dlcId}"]`)).toBeAttached();
    await expect(form.locator(`option[value="${hiddenDlc}"]`)).toHaveCount(0);
  },
);

test(
  "filters live in the URL, the game switch restarts them and search stays literal",
  browserCase(["@functional"]),
  async ({ page }) => {
    const c = catalogTranslations.en;
    const { requests } = await mockCatalogs(page, true, {
      rows: {
        ets2: {
          dlcs: [catalogItem(dlcId, "Fictional pack")],
          regions: [catalogItem(regionId, "Fictional region")],
        },
        ats: { cities: [catalogItem(entityId, "Fictional ATS city", "en", { game: "ats" })] },
      },
    });
    const cityReads = () =>
      requests
        .filter((url) => url.pathname === "/api/v1/catalogs/cities")
        .map((url) => Object.fromEntries(url.searchParams));
    await open(page);
    await page.getByRole("searchbox", { name: c.searchLabel }).fill("a_%b");
    await expect(page).toHaveURL(/q=a_%25b/);
    await expect.poll(() => cityReads().at(-1)?.search).toBe("a_%b");
    await page.getByLabel(c.dlcFilter).selectOption("base");
    await expect.poll(() => cityReads().at(-1)?.dlc).toBe("base");
    await page.getByLabel(c.regionFilter).selectOption(regionId);
    await expect.poll(() => cityReads().at(-1)?.regionId).toBe(regionId);
    await page
      .getByRole("group", { name: c.game, exact: true })
      .getByRole("button", { name: "ATS", exact: true })
      .click();
    await expect(page).toHaveURL(/game=ats/);
    await expect(page).not.toHaveURL(/region=/);
    await expect.poll(() => cityReads().at(-1)?.game).toBe("ats");
    // A shared link restores the same state.
    await page.goto(`/account/catalogs?game=ats&tab=cities&q=${encodeURIComponent("x y")}`);
    await expect(page.getByRole("searchbox", { name: c.searchLabel })).toHaveValue("x y");
  },
);

test(
  "import checks the file first, withholds apply on errors and applies with the dry-run token",
  browserCase(["@functional"]),
  async ({ page }) => {
    const c = catalogTranslations.en;
    const calls: { path: string; ifMatch?: string | undefined; key?: string | undefined }[] = [];
    let previewResponse: { status: number; json: unknown };
    let applyStatus = 200;
    const previewOk = {
      fileSha256: "a".repeat(64),
      token: "signed-token",
      rows: 2,
      added: 1,
      changed: 1,
      unchanged: 0,
      errors: 0,
      lines: [
        {
          line: 3,
          code: "fixture_changed",
          status: "changed",
          issues: [],
          changedFields: ["name_en"],
        },
      ],
      truncated: false,
    };
    previewResponse = { status: 200, json: envelope(previewOk) };
    await mockCatalogs(page, true, {
      writes: ({ method, path, headers }) => {
        if (method !== "POST" || (!path.includes("/imports") && !path.includes("/import-previews")))
          return null;
        calls.push({ path, ifMatch: headers["if-match"], key: headers["idempotency-key"] });
        if (path.endsWith("/import-previews")) return previewResponse;
        if (applyStatus === 422)
          return {
            status: 422,
            json: {
              error: {
                code: "CATALOG_IMPORT_INVALID",
                details: [{ field: "line:4:dlc_code", code: "hidden_reference" }],
              },
            },
          };
        if (applyStatus !== 200)
          return {
            status: applyStatus,
            json: {
              error: {
                code: applyStatus === 412 ? "CATALOG_IMPORT_TOKEN_INVALID" : "UNAVAILABLE",
              },
            },
          };
        return {
          status: 200,
          json: envelope({
            importId: entityId,
            rows: 2,
            added: 1,
            changed: 1,
            unchanged: 0,
          }),
        };
      },
    });
    await open(page);
    await page.getByRole("button", { name: c.importButton, exact: true }).last().click();
    let dialog = page.getByRole("dialog");
    await expect(dialog.getByText(c.fileNote, { exact: false })).toBeVisible();
    await expect(dialog.locator("code").first()).toHaveText(
      "game, code, name_en, name_ru, region_code, dlc_code",
    );
    const file = (body = "game,code\n") => ({
      name: "fixture-import.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(body),
    });
    // A file with errors is reported line by line and cannot be applied.
    previewResponse = {
      status: 200,
      json: envelope({
        ...previewOk,
        token: null,
        errors: 1,
        changed: 0,
        lines: [
          {
            line: 2,
            code: null,
            status: "error",
            issues: [{ field: "adr_class", reason: "invalid" }],
            changedFields: [],
          },
        ],
      }),
    };
    await dialog.locator('input[type="file"]').setInputFiles(file());
    await expect(
      dialog.getByText(c.fixAndRetry.split("{{")[0] ?? "", { exact: false }),
    ).toBeVisible();
    await expect(dialog.getByText(c.statusError, { exact: true })).toBeVisible();
    await expect(
      dialog.getByText("Invalid value in Hazardous cargo", { exact: false }),
    ).toBeVisible();
    await expect(dialog.getByRole("button", { name: c.apply, exact: true })).toBeDisabled();
    await dialog.getByRole("button", { name: c.otherFile, exact: true }).click();
    // A clean file offers apply; a stale token asks to check again.
    previewResponse = { status: 200, json: envelope(previewOk) };
    await dialog.locator('input[type="file"]').setInputFiles(file());
    await expect(dialog.getByText("fixture_changed", { exact: true })).toBeVisible();
    expect(calls.at(-1)).toMatchObject({ path: "/admin/catalogs/cities/import-previews" });
    await expect(dialog.getByText(c.willChange, { exact: true }).last()).toBeVisible();
    await expect(dialog.getByText("Changed fields: Name EN", { exact: false })).toBeVisible();
    applyStatus = 422;
    await dialog.getByRole("button", { name: c.apply, exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText(c.importInvalid);
    await expect(dialog.locator(".catalog-lines")).toContainText(c.issueHiddenDlc);
    await expect(dialog.getByText(c.statusError, { exact: true })).toBeVisible();
    await expect(dialog.getByText("fixture_changed", { exact: true })).toHaveCount(0);
    applyStatus = 412;
    await dialog.getByRole("button", { name: c.apply, exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText(c.tokenExpired);
    applyStatus = 503;
    await dialog.getByRole("button", { name: c.apply, exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText(c.unavailableError);
    applyStatus = 200;
    await dialog.getByRole("button", { name: c.apply, exact: true }).click();
    await expect(dialog.getByText(c.appliedTitle, { exact: true })).toBeVisible();
    const apply = calls.filter((call) => call.path.endsWith("/imports"));
    expect(apply).toHaveLength(4);
    expect(apply.at(-1)?.ifMatch).toBe('"signed-token"');
    // An uncertain 503 retry repeats the same logical key, so it cannot double-apply;
    // the definite 422 and stale-token failures before it do not.
    expect(apply[0]?.key).not.toBe(apply[1]?.key);
    expect(apply[1]?.key).not.toBe(apply[2]?.key);
    expect(apply[2]?.key).toBe(apply[3]?.key);
    await dialog.getByRole("button", { name: c.done, exact: true }).click();
    await expect(dialog).toHaveCount(0);

    // Client-side size guard: an empty file is rejected before any upload.
    const before = calls.length;
    await page.getByRole("button", { name: c.importButton, exact: true }).last().click();
    dialog = page.getByRole("dialog");
    await dialog
      .locator('input[type="file"]')
      .setInputFiles({ name: "empty.csv", mimeType: "text/csv", buffer: Buffer.alloc(0) });
    await expect(dialog.getByText(c.invalidFile, { exact: true })).toBeVisible();
    expect(calls).toHaveLength(before);
  },
);

test(
  "members without manage rights read lists but get no actions; without read access nothing is requested",
  browserCase(["@functional"]),
  async ({ page }) => {
    const c = catalogTranslations.en;
    await mockCatalogs(page, false, {
      capabilities: ["account.self", "company.read"],
    });
    await open(page);
    await expect(rowOf(page, "Fictional city")).toBeVisible();
    for (const name of [c.importButton, c.importShort, c.addCities, c.edit, c.hide])
      await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
    await page.close();
  },
);

test(
  "without company read the page explains the restriction and reads no catalog",
  browserCase(["@functional"]),
  async ({ page }) => {
    const c = catalogTranslations.en;
    const { requests } = await mockCatalogs(page, false, { capabilities: ["account.self"] });
    await page.goto("/account/catalogs");
    await catalogLanguage(page);
    await expect(page.getByText(c.pageForbidden, { exact: true })).toBeVisible();
    await page.waitForTimeout(200);
    expect(requests.filter((url) => url.pathname.startsWith("/api/v1/catalogs/"))).toEqual([]);
  },
);

test(
  "pending, error and empty states are distinct, and Refresh retries the read",
  browserCase(["@functional"]),
  async ({ page }, info) => {
    const c = catalogTranslations.en;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let failing = false;
    let reads = 0;
    await mockCatalogs(page, true, {
      gate,
      rows: { ets2: { cities: [] }, ats: { cities: [] } },
    });
    await page.route("**/api/v1/catalogs/cities?*", (route) => {
      reads++;
      return failing
        ? route.fulfill({ status: 503, json: { error: { code: "UNAVAILABLE" } } })
        : route.fallback();
    });
    await page.goto("/account/catalogs");
    await catalogLanguage(page);
    await expect(page.getByRole("status")).toContainText(c.loading);
    await capture(page, info, "states-pending");
    release();
    await expect(page.getByText(c.emptyList, { exact: true })).toBeVisible();

    failing = true;
    await page.getByRole("searchbox", { name: c.searchLabel }).fill("absent");
    await expect(page.getByRole("alert")).toContainText(c.readError);
    await capture(page, info, "states-error");
    const before = reads;
    failing = false;
    await page.getByRole("button", { name: c.refresh, exact: true }).click();
    await expect.poll(() => reads).toBeGreaterThan(before);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByText(c.empty, { exact: true })).toBeVisible();
  },
);

const fieldLabels = {
  en: ["Origin city", "Destination city", "Cargo", "Trailer type"],
  ru: ["Город отправления", "Город назначения", "Груз", "Тип прицепа"],
} as const;
/** Serves cities from `rows` with server-side search and 25-row cursor pages, and records reads. */
async function serveCities(page: Page, rows: ReturnType<typeof catalogItem>[]) {
  const reads: URL[] = [];
  await page.route(
    (url) => /^\/api\/v1\/catalogs\/cities(\/.*)?$/.test(url.pathname),
    (route) => {
      const url = new URL(route.request().url()),
        rowId = url.pathname.split("/")[5];
      if (rowId) {
        const found = rows.find((row) => row.id === rowId);
        return found
          ? route.fulfill({ json: envelope(found) })
          : route.fulfill({ status: 404, json: { error: { code: "PRIVATE_SENTINEL" } } });
      }
      reads.push(url);
      const search = url.searchParams.get("search")?.toLowerCase() ?? "",
        matches = rows.filter((row) => row.display.label.toLowerCase().includes(search)),
        cursor = Number(url.searchParams.get("cursor") ?? 0),
        next = cursor + 25;
      return route.fulfill({
        json: catalogList(
          matches.slice(cursor, next),
          next < matches.length ? String(next) : null,
          matches.length,
        ),
      });
    },
  );
  return reads;
}
const fictionalRows = (count: number, locale: "en" | "ru" = "en") =>
  Array.from({ length: count }, (_, index) => {
    const number = String(index + 1).padStart(2, "0");
    return catalogItem(
      `63000000-0000-4000-8000-0000000002${number}`,
      `Fictional row ${number}`,
      locale,
    );
  });
async function openReport(page: Page, locale: "en" | "ru" = "en") {
  await page.goto("/account/reports/new");
  await catalogLanguage(page, locale);
  await expect(page.locator("#manual-file")).toBeVisible();
}
const originField = (page: Page) =>
  page.getByRole("combobox", { name: "Origin city", exact: true });
const originList = (page: Page) => page.getByRole("listbox", { name: "Origin city", exact: true });
const activeOption = (scope: Page | Locator) =>
  scope.locator('[role="option"][aria-selected="true"]');

test(
  "a selector offers visible rows only, labels fallback and never submits its enclosing form",
  browserCase(["@functional"]),
  async ({ page }) => {
    await mockTrips(page);
    const hiddenId = "63000000-0000-4000-8000-000000000030";
    const city = (id: string, name: string, overrides = {}) =>
      catalogItem(id, name, "ru", overrides);
    const visible = city(entityId, "Fictional visible");
    await page.route(
      (url) => /^\/api\/v1\/catalogs\/cities(\/.*)?$/.test(url.pathname),
      (route) => {
        if (new URL(route.request().url()).pathname.split("/")[5])
          return route.fulfill({ json: envelope(visible) });
        return route.fulfill({
          json: catalogList([
            visible,
            city(hiddenId, "Fictional hidden", {
              hidden: true,
              display: { ...city(hiddenId, "Fictional hidden").display, hidden: true },
            }),
          ]),
        });
      },
    );
    let submissions = 0;
    await page.route("**/api/v1/manual-reports", (route) => {
      if (route.request().method() === "POST") submissions++;
      return route.fallback();
    });
    await page.goto("/account/reports/new");
    await catalogLanguage(page, "ru");
    const origin = page.getByRole("combobox", { name: "Город отправления", exact: true });
    await expect(origin).toHaveAttribute("aria-expanded", "false");
    await expect(origin).toHaveAttribute("aria-autocomplete", "list");
    await origin.click();
    const listbox = page.getByRole("listbox", { name: "Город отправления", exact: true });
    await expect(listbox).toBeVisible();
    await expect(origin).toHaveAttribute("aria-controls", (await listbox.getAttribute("id")) ?? "");
    const option = listbox.getByRole("option", { name: /Fictional visible/ });
    await expect(option).toContainText("EN");
    await expect(option).toHaveAccessibleName(new RegExp(catalogTranslations.ru.fallback));
    await expect(listbox.getByRole("option", { name: /Fictional hidden/ })).toHaveCount(0);
    await origin.press("Enter");
    await expect(origin).toHaveValue("Fictional visible");
    await expect(origin).toHaveAttribute("aria-expanded", "false");
    await expect(origin).toHaveAccessibleDescription(catalogTranslations.ru.fallback);
    await origin.press("Enter");
    await page.waitForTimeout(150);
    expect(submissions).toBe(0);
    await expect(origin).toHaveValue("Fictional visible");
  },
);

for (const locale of ["en", "ru"] as const)
  test(
    `the catalog field is one combobox in ${locale} with no separate search, select, checkbox or load-more button`,
    browserCase(["@layout"]),
    async ({ page }, info) => {
      const c = catalogTranslations[locale];
      await mockTrips(page);
      await serveCities(page, fictionalRows(30, locale));
      await openReport(page, locale);
      await capture(page, info, `combobox-${locale}-closed`);
      const fields = page.locator(".manual-report-fields");
      for (const name of fieldLabels[locale])
        await expect(fields.getByRole("combobox", { name, exact: true })).toHaveCount(1);
      for (const missing of ["searchbox", "checkbox"] as const)
        await expect(fields.getByRole(missing)).toHaveCount(0);
      await expect(fields.locator(".manual-catalog-field select")).toHaveCount(0);
      await expect(fields.getByRole("button", { name: c.more, exact: true })).toHaveCount(0);

      const origin = fields.getByRole("combobox", { name: fieldLabels[locale][0], exact: true }),
        listbox = page.getByRole("listbox", { name: fieldLabels[locale][0], exact: true }),
        coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
        min = coarse ? 40 : 30;
      await origin.click();
      await expect(listbox.getByRole("option")).toHaveCount(27);
      await capture(page, info, `combobox-${locale}-open`);
      for (const option of await listbox.getByRole("option").all()) {
        const box = await option.boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(min);
      }
      await chooseCatalogRow(page, fieldLabels[locale][0], "Fictional row 01");
      const clear = page.getByRole("button", {
        name: c.clearField.replace("{{label}}", fieldLabels[locale][0]),
        exact: true,
      });
      const clearBox = await clear.boundingBox();
      expect(clearBox?.height ?? 0).toBeGreaterThanOrEqual(min);
      expect(clearBox?.width ?? 0).toBeGreaterThanOrEqual(min);
      await capture(page, info, `combobox-${locale}-chosen`);
      if (locale === "ru") {
        const chip = page
          .locator(".manual-catalog-field")
          .filter({
            has: page.getByRole("combobox", { name: fieldLabels[locale][0], exact: true }),
          })
          .getByText("EN", { exact: true });
        await expect(chip).toHaveAttribute("title", c.fallback);
        // Hovering proves the chip takes the pointer; clicking it still opens the input.
        await chip.hover();
        await chip.click();
        await expect(origin).toBeFocused();
        await expect(origin).toHaveAttribute("aria-expanded", "true");
        await origin.press("Escape");
      }
    },
  );

test(
  "typing filters through the server search after the debounce and load more reaches every row",
  browserCase(["@functional"]),
  async ({ page }) => {
    await mockTrips(page);
    const reads = await serveCities(page, fictionalRows(30));
    await openReport(page);
    const origin = originField(page),
      list = originList(page);
    const params = () =>
      reads
        .map((url) => Object.fromEntries(url.searchParams))
        .map(({ search, cursor }) => ({ search, cursor }));
    expect(reads).toEqual([]);

    // One read for the whole typing burst, with the final text.
    await origin.pressSequentially("row", { delay: 20 });
    await expect(list.getByRole("option", { name: /^Fictional row 01/ })).toBeVisible();
    expect(params()).toEqual([{ search: "row", cursor: undefined }]);

    // The last rows are reached from inside the list, with the keyboard only.
    await origin.press("ArrowUp"); // wraps to the extra row
    await origin.press("ArrowUp"); // the load-more row
    await expect(activeOption(page)).toHaveText("Load more");
    await origin.press("Enter");
    await expect(list.getByRole("option", { name: /^Fictional row 30/ })).toBeVisible();
    expect(params()).toEqual([
      { search: "row", cursor: undefined },
      { search: "row", cursor: "25" },
    ]);
    await expect(activeOption(page)).toContainText("Fictional row 26");
    await expect(list.getByRole("option", { name: "Load more" })).toHaveCount(0);
    for (let step = 0; step < 4; step++) await origin.press("ArrowDown");
    await expect(activeOption(page)).toContainText("Fictional row 30");
    await expect(activeOption(page)).toBeInViewport({ ratio: 1 });
    await origin.press("Enter");
    await expect(origin).toHaveValue("Fictional row 30");
    await expect(origin).toHaveAttribute("aria-expanded", "false");

    // The same row also pages with the mouse and keeps its place in the list.
    await origin.click();
    await list.getByRole("option", { name: "Load more", exact: true }).click();
    await expect(list.getByRole("option", { name: /^Fictional row 26/ })).toBeVisible();
    await expect(activeOption(page)).toContainText("Fictional row 26");
    expect(params().at(-1)).toEqual({ search: undefined, cursor: "25" });
  },
);

test(
  "the combobox follows the keyboard pattern for arrows, Enter, Esc and Tab",
  browserCase(["@functional"]),
  async ({ page }) => {
    await mockTrips(page);
    await serveCities(page, fictionalRows(3));
    let submissions = 0;
    await page.route("**/api/v1/manual-reports", (route) => {
      if (route.request().method() === "POST") submissions++;
      return route.fallback();
    });
    await openReport(page);
    const origin = originField(page),
      list = originList(page),
      extra = /^Not listed/;

    await page.locator("#manual-game").focus();
    await page.keyboard.press("Tab");
    await expect(origin).toBeFocused();
    await expect(origin).toHaveAttribute("aria-expanded", "false");

    await page.keyboard.press("ArrowDown");
    await expect(origin).toHaveAttribute("aria-expanded", "true");
    await expect(activeOption(page)).toContainText("Fictional row 01");
    await expect(activeOption(page)).toHaveCSS("outline-style", "solid");
    await expect(origin).toHaveAttribute(
      "aria-activedescendant",
      (await activeOption(page).getAttribute("id")) ?? "",
    );
    await page.keyboard.press("ArrowDown");
    await expect(activeOption(page)).toContainText("Fictional row 02");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await expect(activeOption(page)).toHaveAccessibleName(extra);
    await page.keyboard.press("ArrowDown");
    await expect(activeOption(page)).toContainText("Fictional row 01");

    await page.keyboard.press("Escape");
    await expect(origin).toHaveAttribute("aria-expanded", "false");
    await expect(origin).toHaveValue("");
    await page.keyboard.press("ArrowUp");
    await expect(origin).toHaveAttribute("aria-expanded", "true");
    await expect(activeOption(page)).toHaveAccessibleName(extra);
    await expect(list).toBeVisible();

    await page.keyboard.press("Escape");
    await origin.fill("row 02");
    await expect(list.getByRole("option", { name: /Fictional row 02/ })).toBeVisible();
    await expect(activeOption(page)).toContainText("Fictional row 02");
    await page.keyboard.press("Enter");
    await expect(origin).toHaveValue("Fictional row 02");
    await expect(origin).toHaveAttribute("aria-expanded", "false");
    await expect(origin).toBeFocused();

    // Enter with the list closed stays in the field, Tab leaves and restores a discarded edit.
    await page.keyboard.press("Enter");
    expect(submissions).toBe(0);
    await origin.fill("zzz");
    await page.keyboard.press("Tab");
    await expect(origin).not.toBeFocused();
    await expect(origin).toHaveValue("Fictional row 02");
    await expect(origin).toHaveAttribute("aria-expanded", "false");
    expect(submissions).toBe(0);

    // On a settled empty search the not-listed row is active, so Enter chooses it.
    await origin.fill("no such row");
    await expect(activeOption(page)).toHaveAccessibleName(extra);
    await page.keyboard.press("Enter");
    await expect(origin).toHaveValue("Not listed / unresolved");
    await expect(
      page
        .getByRole("group", { name: "Origin city", exact: true })
        .getByLabel("Diagnostic label", { exact: true }),
    ).toHaveValue("no such row");
    expect(submissions).toBe(0);
  },
);

test(
  "a stale row cannot be chosen during the debounce",
  browserCase(["@functional"]),
  async ({ page }, info) => {
    await page.clock.install();
    await mockTrips(page);
    await serveCities(page, fictionalRows(2));
    await openReport(page);
    const origin = originField(page),
      list = originList(page);
    await origin.click();
    await expect(list.getByRole("option", { name: /Fictional row 01/ })).toBeVisible();

    // Hold the searched read too, so the loading window that follows is also deterministic.
    let release = () => {},
      searched = false;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(
      (url) => url.pathname === "/api/v1/catalogs/cities" && url.searchParams.has("search"),
      async (route) => {
        searched = true;
        await gate;
        return route.fallback();
      },
    );
    const noRowCanBeChosen = async () => {
      await expect(list.getByRole("option", { name: /Fictional row/ })).toHaveCount(0);
      await expect(page.getByRole("status")).toHaveText("Loading catalog…");
      // The not-listed row stays reachable while searching, but no row is active for Enter.
      await expect(list.getByRole("option", { name: /^Not listed/ })).toBeVisible();
      await expect(activeOption(page)).toHaveCount(0);
      await origin.press("Enter");
      await expect(origin).toHaveValue("row 02");
      await expect(origin).toHaveAttribute("aria-expanded", "true");
    };

    // Frozen timers hold the debounce open: the previous rows are gone and no read has started.
    await page.clock.pauseAt(Date.now() + 1000);
    await origin.fill("row 02");
    await noRowCanBeChosen();
    expect(searched).toBe(false);

    // Past the debounce the search is sent, and rows stay unavailable until it answers.
    await page.clock.runFor(250);
    await page.clock.resume();
    await expect.poll(() => searched).toBe(true);
    await noRowCanBeChosen();
    await capture(page, info, "combobox-loading");
    release();
    await expect(list.getByRole("option", { name: /Fictional row 02/ })).toBeVisible();
    await origin.press("Enter");
    await expect(origin).toHaveValue("Fictional row 02");
  },
);

test(
  "clearing and erasing remove the value and return focus to the field",
  browserCase(["@functional"]),
  async ({ page }) => {
    await mockTrips(page);
    await serveCities(page, fictionalRows(2));
    await openReport(page);
    const origin = originField(page),
      clear = page.getByRole("button", { name: "Clear selection: Origin city", exact: true });
    await chooseCatalogRow(page, "Origin city", "Fictional row 01");
    await expect(clear).toBeVisible();
    await clear.click();
    await expect(origin).toHaveValue("");
    await expect(origin).toBeFocused();
    await expect(clear).toHaveCount(0);

    // The same action from the keyboard: Tab lands on Clear and Enter activates it.
    await chooseCatalogRow(page, "Origin city", "Fictional row 02");
    await origin.focus();
    await page.keyboard.press("Tab");
    await expect(clear).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(origin).toHaveValue("");
    await expect(origin).toBeFocused();
    await expect(clear).toHaveCount(0);

    await chooseCatalogRow(page, "Origin city", "Fictional row 02");
    await origin.fill("");
    await page.keyboard.press("Tab");
    await expect(origin).not.toBeFocused();
    await expect(origin).toHaveValue("");
    await expect(clear).toHaveCount(0);

    // Erased text with no prior value restores nothing and clears nothing.
    await origin.fill("   ");
    await origin.blur();
    await expect(origin).toHaveValue("");
    await expect(origin).toHaveAttribute("aria-expanded", "false");
  },
);
