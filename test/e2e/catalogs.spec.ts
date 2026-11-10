import type { Locator, Page, TestInfo } from "@playwright/test";
import { accountFixture } from "../../apps/web/src/features/account/fixtures.ts";
import { catalogTranslations } from "../../apps/web/src/features/catalogs/translations.ts";
import { rgbaLogo } from "../fixtures/catalogs/logos.ts";
import {
  cargoRowId,
  catalogItem,
  catalogLanguage,
  catalogList,
  chooseCatalogRow,
  companyRowId,
  defaultRows,
  depotRow,
  depotRowId,
  dlcId,
  entityId,
  envelope,
  logoRef,
  mockCatalogs,
  regionId,
  trailerRowId,
} from "./support/catalogs.ts";
import { browserCase, expect, test } from "./support/fixtures.ts";
import { evidenceId, example, id, mockTrips } from "./support/trip-ui.ts";

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
      "game, code, name_en, name_ru, region_code, dlc_code, name_native",
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
        matches = rows.filter(
          (row) =>
            row.display.label.toLowerCase().includes(search) ||
            row.nameNative?.toLowerCase().includes(search),
        ),
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
  "the EN chip on a form locked by its fieldset neither opens the list nor reads it",
  browserCase(["@functional"]),
  async ({ page }) => {
    await mockTrips(page);
    const reads = await serveCities(page, [catalogItem(entityId, "Fictional locked city", "ru")]);
    const report = example("getManualReport:success").data,
      view = example("getTrip:extended-manual-revision"),
      pin = (rowId: string) => ({ status: "resolved", entityId: rowId });
    report.id = id;
    report.tripId = id;
    report.version = 1;
    report.tripVersion = 1;
    report.currentRevision = {
      representation: "extended",
      id: "45000000-0000-4000-8000-000000000030",
      reportId: id,
      number: 1,
      submittedAt: "2026-10-24T12:00:00.000Z",
      fields: {
        game: "ets2",
        origin: pin(entityId),
        destination: pin(entityId),
        cargo: pin(cargoRowId),
        trailerType: pin(trailerRowId),
        cargoMassKg: "1000",
        actualDistanceM: "100",
        evidenceIds: [evidenceId],
        eventId: null,
        comment: "Fictional original",
      },
    };
    view.data.manualRevision = report.currentRevision;
    view.data.summary.owner = accountFixture("en").data.member;
    view.data.summary.id = id;
    view.data.summary.decision = "accepted";
    view.data.summary.version = 1;
    view.data.evidence = [];
    await page.route(`**/api/v1/manual-reports/${id}`, (route) =>
      route.fulfill({ json: envelope(report), headers: { ETag: '"v1"' } }),
    );
    await page.route(`**/api/v1/trips/${id}`, (route) =>
      route.fulfill({ json: view, headers: { ETag: '"v1"' } }),
    );
    await page.goto(`/account/reports/${id}/edit`);
    await catalogLanguage(page, "ru");

    const name = fieldLabels.ru[0],
      origin = page.getByRole("combobox", { name, exact: true }),
      chip = page
        .locator(".manual-catalog-field")
        .filter({ has: origin })
        .getByText("EN", { exact: true });
    await expect(origin).toHaveValue("Fictional locked city");
    await expect(origin).toBeDisabled();
    await chip.click();
    // Long enough for a list read, had one started, to reach the mock.
    await page.waitForTimeout(150);
    await expect(origin).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("listbox", { name, exact: true })).toHaveCount(0);
    expect(reads).toHaveLength(0);
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

const kronburgId = "63000000-0000-4000-8000-000000000041";
/** A fictional city whose canonical name is not its displayed translation. */
function kronburg(locale: "en" | "ru") {
  const label = locale === "ru" ? "Крёнбург" : "Crownburg",
    base = catalogItem(kronburgId, label, locale, {
      code: "kronburg",
      nameEn: "Crownburg",
      nameRu: "Крёнбург",
      nameNative: "Krönburg",
    });
  return {
    ...base,
    display: {
      ...base.display,
      renderedLocale: locale,
      englishFallback: false,
      nameNative: "Krönburg",
    },
  };
}
const kronburgLabel = (locale: "en" | "ru") => (locale === "ru" ? "Крёнбург" : "Crownburg");
async function openRowForm(page: Page, locale: "en" | "ru", text: string, name: string) {
  const c = catalogTranslations[locale];
  if (phone(page)) {
    await page
      .getByRole("button", { name: c.actions.replace("{{name}}", name), exact: true })
      .click();
    await page.getByRole("dialog").getByRole("button", { name: c.edit, exact: true }).click();
  } else await rowOf(page, text).getByRole("button", { name: c.edit, exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

for (const locale of ["en", "ru"] as const)
  test(
    `${locale} staff add, edit and clear a canonical city name, shown in the list at every width`,
    browserCase(["@layout"]),
    async ({ page }, info) => {
      const c = catalogTranslations[locale];
      const writes: Record<string, unknown>[] = [];
      await mockCatalogs(page, true, {
        rows: {
          ets2: {
            ...defaultRows(locale),
            cities: [
              kronburg(locale),
              catalogItem(entityId, "Fictional plain city", locale, { code: "plain_city" }),
            ],
          },
        },
        writes: ({ method, path, body }) => {
          if (!path.startsWith("/admin/catalogs/cities")) return null;
          writes.push(JSON.parse(String(body)));
          return { status: method === "POST" ? 201 : 200, json: envelope(kronburg(locale)) };
        },
      });
      await open(page, locale);
      await expect(rowOf(page, "kronburg").getByText("Krönburg")).toBeVisible();
      await expect(page.getByTestId(phone(page) ? "catalog-table" : "catalog-cards")).toBeHidden();
      await capture(page, info, `native-${locale}-list`);

      const form = page.getByRole("dialog"),
        field = form.getByLabel(c.fieldNameNative, { exact: true }),
        save = form.getByRole("button", { name: c.save, exact: true });
      await openRowForm(page, locale, "kronburg", kronburgLabel(locale));
      await expect(field).toHaveValue("Krönburg");
      await expect(form.getByText(c.nameNativeHint, { exact: true })).toBeVisible();
      await field.fill("  Krönburg-Mitte  ");
      await capture(page, info, `native-${locale}-form`);
      await save.click();
      await expect(form).toHaveCount(0);
      expect(writes.at(-1)).toMatchObject({ nameNative: "Krönburg-Mitte" });

      await openRowForm(page, locale, "kronburg", kronburgLabel(locale));
      await field.fill("   ");
      await save.click();
      await expect(form).toHaveCount(0);
      expect(writes.at(-1)).toMatchObject({ nameNative: null });

      await page.getByRole("button", { name: c.addCities, exact: true }).first().click();
      await form.getByLabel(c.fieldCode, { exact: true }).fill("fixture_new");
      await form.getByLabel(c.fieldNameEn, { exact: true }).fill("Fictional new");
      await field.fill("Nöwburg");
      await save.click();
      await expect(form).toHaveCount(0);
      expect(writes.at(-1)).toMatchObject({ code: "fixture_new", nameNative: "Nöwburg" });

      await tab(page, c.tabCargoes).click();
      await page.getByRole("button", { name: c.addCargoes, exact: true }).first().click();
      await expect(form.getByLabel(c.fieldNameNative, { exact: true })).toHaveCount(0);
    },
  );

for (const locale of ["en", "ru"] as const)
  test(
    `${locale} the city autocomplete shows the canonical name without a fallback mark`,
    browserCase(["@layout"]),
    async ({ page }, info) => {
      const [originLabel, , cargoLabel] = fieldLabels[locale];
      await mockTrips(page);
      await serveCities(page, [
        kronburg(locale),
        catalogItem(entityId, "Fictional plain city", locale, { code: "plain_city" }),
      ]);
      await openReport(page, locale);
      const origin = page.getByRole("combobox", { name: originLabel, exact: true });
      await origin.click();
      const listbox = page.getByRole("listbox", { name: originLabel, exact: true }),
        option = listbox.getByRole("option").filter({ hasText: "kronburg" }),
        plain = listbox.getByRole("option").filter({ hasText: "plain_city" });
      await expect(option.locator(".catalog-option-name")).toHaveText("Krönburg");
      await expect(option.locator(".catalog-chip")).toHaveCount(0);
      await expect(option.locator("code")).toHaveText("kronburg");
      const [name, code] = await Promise.all([
        option.locator(".catalog-option-name").boundingBox(),
        option.locator("code").boundingBox(),
      ]);
      expect(code?.x ?? 0).toBeGreaterThan(name?.x ?? 0);
      await expect(plain.locator(".catalog-chip")).toHaveCount(locale === "ru" ? 1 : 0);
      await capture(page, info, `native-${locale}-options`);

      await chooseCatalogRow(page, originLabel, "Krönburg");
      await expect(origin).toHaveAttribute("title", "Krönburg");
      await expect(
        page
          .locator(".manual-catalog-field")
          .filter({ has: origin })
          .locator(".catalog-adornments .catalog-chip"),
      ).toHaveCount(0);
      await capture(page, info, `native-${locale}-chosen`);

      // Cargo has no canonical name: its label and fallback mark stay as they were.
      const cargo = page.getByRole("combobox", { name: cargoLabel, exact: true });
      await chooseCatalogRow(page, cargoLabel, "Fictional cargo");
      await expect(cargo).toHaveValue("Fictional cargo");
      await expect(
        page
          .locator(".manual-catalog-field")
          .filter({ has: cargo })
          .getByText("EN", { exact: true }),
      ).toHaveCount(locale === "ru" ? 1 : 0);
    },
  );

// ---- Companies, depots and logos (VTC-091) ----
const freight = { id: companyRowId, name: "Fictional Freight Co" };
const plainCo = { id: "66000000-0000-4000-8000-000000000032", name: "Fictional Plain Co" };
const brokenCo = { id: "66000000-0000-4000-8000-000000000033", name: "Fictional Broken Co" };
const northCity = { id: entityId, name: "Fictional north city" };
const southCity = { id: "63000000-0000-4000-8000-000000000040", name: "Fictional south city" };
const companyRow = (
  co: { id: string; name: string },
  locale: "en" | "ru" = "en",
  logo: ReturnType<typeof logoRef> | null = null,
) => catalogItem(co.id, co.name, locale, { logo });
const plate = (page: Page, text: string) => rowOf(page, text).locator(".company-logo");
const png = (seed: number, width = 128, height = 32) => rgbaLogo(seed, width, height);

for (const locale of ["en", "ru"] as const) {
  test(
    `${locale} companies show the logo on a plate and a placeholder when there is none or it fails`,
    browserCase(["@layout"]),
    async ({ page }, info) => {
      const c = catalogTranslations[locale];
      const { requests } = await mockCatalogs(page, true, {
        rows: {
          ets2: {
            ...defaultRows(locale),
            companies: [
              companyRow(freight, locale, logoRef(3)),
              companyRow(plainCo, locale, null),
              companyRow(brokenCo, locale, logoRef(4)),
            ],
          },
        },
        brokenLogos: [brokenCo.id],
      });
      await open(page, locale, "?tab=companies");
      await expect(tab(page, c.tabCompanies)).toHaveAttribute("aria-selected", "true");
      await expect(tab(page, c.tabDepots)).toBeVisible();

      const loaded = plate(page, freight.name);
      await expect(loaded).toHaveAttribute("data-logo", "image");
      await expect
        .poll(() => loaded.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth))
        .toBeGreaterThan(0);
      const box = await loaded.boundingBox();
      expect([box?.width, box?.height]).toEqual([128, 32]);
      // The name stays beside the logo, so the image itself carries no text alternative.
      await expect(loaded.locator("img")).toHaveAttribute("alt", "");
      await expect(rowOf(page, freight.name)).toContainText(freight.name);

      await expect(plate(page, plainCo.name)).toHaveAttribute("data-logo", "placeholder");
      await expect(plate(page, plainCo.name).locator("img")).toHaveCount(0);
      await expect(plate(page, brokenCo.name)).toHaveAttribute("data-logo", "placeholder");
      await expect(plate(page, brokenCo.name).locator("img")).toHaveCount(0);

      // A company without a logo is never asked for an image; the others name their version.
      const images = requests.filter((url) => url.pathname.endsWith("/logo"));
      expect(images.some((url) => url.pathname.includes(plainCo.id))).toBe(false);
      expect(images.find((url) => url.pathname.includes(freight.id))?.search).toBe(
        `?v=${logoRef(3).version}`,
      );
      if (locale === "ru")
        await expect(rowOf(page, freight.name).getByText(c.rowFallback)).toBeVisible();
      await capture(page, info, `companies-${locale}`);
    },
  );

  test(
    `${locale} depots show the company with its logo, the city and the source at every width`,
    browserCase(["@layout"]),
    async ({ page }, info) => {
      const c = catalogTranslations[locale];
      await mockCatalogs(page, true, {
        rows: {
          ets2: { ...defaultRows(locale), companies: [companyRow(freight, locale, logoRef(3))] },
        },
        depots: {
          ets2: [
            depotRow(
              depotRowId,
              { ...freight, logo: logoRef(3) },
              { ...northCity, name: "Fictional north city with a very long canonical name" },
              {},
              locale,
            ),
            depotRow(
              "67000000-0000-4000-8000-000000000021",
              plainCo,
              southCity,
              { hidden: true },
              locale,
            ),
          ],
        },
      });
      await open(page, locale, "?tab=depots");
      await expect(tab(page, c.tabDepots)).toHaveAttribute("aria-selected", "true");
      // The tab strip scrolls on a phone; the chosen tab is brought into view.
      await expect(tab(page, c.tabDepots)).toBeInViewport();
      await expect(rowOf(page, freight.name)).toContainText(
        "Fictional north city with a very long",
      );
      await expect(plate(page, freight.name)).toHaveAttribute("data-logo", "image");
      // Brands repeat across companies, so the row names the company code too.
      await expect(rowOf(page, freight.name).locator("code")).toHaveText("fictional_freight_co");
      // Filters: like the search and source fields, the company and city selectors show their
      // name only as the placeholder (the label stays for assistive technology). Each input fills
      // its field, so the chevron sits inside it, and shares the search box's row edges.
      const searchBox = await page.getByRole("searchbox").boundingBox();
      expect(searchBox).not.toBeNull();
      for (const name of [c.companyFilter, c.cityFilter]) {
        const input = page.getByRole("combobox", { name, exact: true });
        await expect(input).toBeVisible();
        await expect(input).toHaveAttribute("placeholder", name);
        await expect(page.locator(`label[for="${await input.getAttribute("id")}"]`)).toHaveClass(
          /visually-hidden/,
        );
        const field = await input.boundingBox();
        const wrapper = await input.locator("xpath=..").boundingBox();
        expect(field && wrapper && Math.abs(field.width - wrapper.width) < 1).toBe(true);
        if (field && searchBox && field.y < searchBox.y + searchBox.height) {
          expect(Math.abs(field.y + field.height - (searchBox.y + searchBox.height))).toBeLessThan(
            1.5,
          );
        }
      }
      await expect(rowOf(page, plainCo.name)).toHaveCount(0);
      await page.getByRole("checkbox", { name: c.showHidden }).click();
      await expect(plate(page, plainCo.name)).toHaveAttribute("data-logo", "placeholder");
      await expect(rowOf(page, plainCo.name).getByText(c.hidden, { exact: true })).toBeVisible();
      await capture(page, info, `depots-${locale}`);
    },
  );
}

test(
  "a page of company logos loads a few at a time and retries busy answers instead of showing placeholders",
  browserCase(["@functional"]),
  async ({ page }) => {
    const c = catalogTranslations.en;
    const companies = Array.from({ length: 24 }, (_, i) => ({
      id: `66000000-0000-4000-8000-${(100 + i).toString().padStart(12, "0")}`,
      name: `Fictional Busy Co ${String(i + 1).padStart(2, "0")}`,
    }));
    const { logos } = await mockCatalogs(page, true, {
      rows: {
        ets2: {
          ...defaultRows("en"),
          companies: companies.map((co) => companyRow(co, "en", logoRef(3))),
        },
      },
      busyLogoTries: 1,
      logoDelayMs: 40,
    });
    await open(page, "en", "?tab=companies");
    await expect(tab(page, c.tabCompanies)).toHaveAttribute("aria-selected", "true");
    // Every visible row gets its logo although each first answer was 503.
    const first = plate(page, companies[0]?.name ?? "");
    await expect(first).toHaveAttribute("data-logo", "image");
    await expect
      .poll(() => first.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);
    const visible = page.locator(".company-logo").filter({ visible: true });
    await expect
      .poll(async () => {
        const modes = await visible.evaluateAll((plates) =>
          plates
            .filter((p) => p.getBoundingClientRect().top < window.innerHeight)
            .map((p) => p.getAttribute("data-logo")),
        );
        return modes.length > 0 && modes.every((mode) => mode === "image");
      })
      .toBe(true);
    await expect(page.locator('.company-logo[data-logo="placeholder"]')).toHaveCount(0);
    // The API's pool holds five connections; logos never take more than three of them.
    expect(logos.maxInFlight).toBeGreaterThan(0);
    expect(logos.maxInFlight).toBeLessThanOrEqual(3);
    expect([...logos.tries.values()].every((tries) => tries <= 2)).toBe(true);
  },
);

test(
  "depots filter by company and city, add a depot, report a duplicate and hide one",
  browserCase(["@functional"]),
  async ({ page }) => {
    const c = catalogTranslations.en;
    const posts: unknown[] = [];
    const patches: { path: string; body: unknown }[] = [];
    let conflict = true;
    const created = depotRow("67000000-0000-4000-8000-000000000022", plainCo, northCity);
    await mockCatalogs(page, true, {
      rows: {
        ets2: {
          ...defaultRows("en"),
          companies: [companyRow(freight, "en", logoRef(3)), companyRow(plainCo)],
          cities: [
            catalogItem(northCity.id, northCity.name),
            catalogItem(southCity.id, southCity.name),
          ],
        },
      },
      depots: {
        ets2: [
          depotRow(depotRowId, { ...freight, logo: logoRef(3) }, northCity),
          depotRow("67000000-0000-4000-8000-000000000023", plainCo, southCity),
        ],
      },
      writes: ({ method, path, body }) => {
        if (method === "POST" && path === "/admin/catalogs/depots") {
          posts.push(JSON.parse(String(body)));
          return conflict
            ? { status: 409, json: { error: { code: "CATALOG_CODE_CONFLICT" } } }
            : { status: 201, json: envelope(created) };
        }
        if (method === "PATCH" && path.startsWith("/admin/catalogs/depots/")) {
          patches.push({ path, body: JSON.parse(String(body)) });
          return { status: 200, json: envelope({ ...created, hidden: true }) };
        }
        return null;
      },
    });
    await open(page, "en", "?tab=depots");
    await expect(rowOf(page, freight.name)).toContainText(northCity.name);
    await expect(rowOf(page, plainCo.name)).toContainText(southCity.name);

    // The company and city filters live in the URL and narrow the list.
    await chooseCatalogRow(page, c.companyFilter, plainCo.name);
    await expect(page).toHaveURL(new RegExp(`company=${plainCo.id}`));
    await expect(rowOf(page, freight.name)).toHaveCount(0);
    await expect(rowOf(page, plainCo.name)).toContainText(southCity.name);
    await page.getByRole("button", { name: `Clear selection: ${c.companyFilter}` }).click();
    await expect(page).not.toHaveURL(/company=/);
    await chooseCatalogRow(page, c.cityFilter, northCity.name);
    await expect(page).toHaveURL(new RegExp(`city=${northCity.id}`));
    await expect(rowOf(page, plainCo.name)).toHaveCount(0);
    await expect(rowOf(page, freight.name)).toBeVisible();
    await page.getByRole("button", { name: `Clear selection: ${c.cityFilter}` }).click();

    await page.getByRole("button", { name: c.addDepots, exact: true }).last().click();
    const form = page.getByRole("dialog");
    await form.getByRole("button", { name: c.save, exact: true }).click();
    await expect(form.getByText(c.errorDepotRequired, { exact: true })).toBeVisible();
    expect(posts).toEqual([]);
    await chooseCatalogRow(form, c.fieldCompany, plainCo.name);
    await chooseCatalogRow(form, c.fieldCity, northCity.name);
    await form.getByRole("button", { name: c.save, exact: true }).click();
    await expect(form.getByText(c.errorDepotExists, { exact: true })).toBeVisible();
    await expect(form).toBeVisible();
    conflict = false;
    await form.getByRole("button", { name: c.save, exact: true }).click();
    await expect(form).toHaveCount(0);
    const body = { game: "ets2", companyId: plainCo.id, cityId: northCity.id, dlcId: null };
    expect(posts).toEqual([body, body]);

    // Hide the first depot: only the hidden flag is sent.
    if (phone(page)) {
      await page
        .getByRole("button", {
          name: `Actions for ${freight.name} (fictional_freight_co) · ${northCity.name}`,
          exact: true,
        })
        .click();
      await page.getByRole("dialog").getByRole("button", { name: c.hide, exact: true }).click();
    } else
      await rowOf(page, freight.name).getByRole("button", { name: c.hide, exact: true }).click();
    await expect.poll(() => patches.length).toBe(1);
    expect(patches[0]).toEqual({
      path: `/admin/catalogs/depots/${depotRowId}`,
      body: { hidden: true },
    });
  },
);

test(
  "a staff member uploads, replaces and removes one company logo from its edit form",
  browserCase(["@functional"]),
  async ({ page }) => {
    const c = catalogTranslations.en;
    const calls: {
      method: string;
      type?: string | undefined;
      key?: string | undefined;
      csrf?: string | undefined;
    }[] = [];
    let mode: "ok" | "reject" | "large" = "ok";
    await mockCatalogs(page, true, {
      rows: { ets2: { ...defaultRows("en"), companies: [companyRow(freight, "en", null)] } },
      writes: ({ method, path, headers }) => {
        if (path !== `/admin/catalogs/companies/${freight.id}/logo`) return null;
        calls.push({
          method,
          type: headers["content-type"],
          key: headers["idempotency-key"],
          csrf: headers["x-csrf-token"],
        });
        if (mode === "reject")
          return { status: 422, json: { error: { code: "CATALOG_FILE_INVALID" } } };
        return {
          status: 200,
          json: envelope(companyRow(freight, "en", method === "DELETE" ? null : logoRef(5))),
        };
      },
    });
    await open(page, "en", "?tab=companies");
    await rowAction(page, freight.name, c.edit);
    const form = page.getByRole("dialog");
    await expect(form.getByText(c.logoNone, { exact: true })).toBeVisible();
    await expect(form.getByRole("button", { name: c.logoRemove, exact: true })).toHaveCount(0);
    await expect(form.locator(".company-logo")).toHaveAttribute("data-logo", "placeholder");
    const input = form.locator('input[type="file"]');
    await expect(input).toHaveAttribute("accept", /png/);

    // An empty or oversized file is stopped in the browser before any request.
    await input.setInputFiles({
      name: "big.png",
      mimeType: "image/png",
      buffer: Buffer.alloc(40000),
    });
    await expect(form.getByText(c.logoTooLarge, { exact: true })).toBeVisible();
    expect(calls).toEqual([]);

    await input.setInputFiles({ name: "freight.png", mimeType: "image/png", buffer: png(5) });
    await expect(form.getByText(c.logoCurrent, { exact: true })).toBeVisible();
    await expect(form.locator(".company-logo")).toHaveAttribute("data-logo", "image");
    await expect(form.getByText(c.logoReplace, { exact: true })).toBeVisible();
    expect(calls[0]).toMatchObject({ method: "PUT", csrf: "NONFUNCTIONAL_FIXTURE" });
    expect(calls[0]?.type).toMatch(/^multipart\/form-data/);

    // The server's refusal of a replacement keeps the current logo and says why.
    mode = "reject";
    await input.setInputFiles({ name: "wrong.png", mimeType: "image/png", buffer: png(6) });
    await expect(form.getByText(c.logoRejected, { exact: true })).toBeVisible();
    await expect(form.locator(".company-logo")).toHaveAttribute("data-logo", "image");

    mode = "ok";
    await form.getByRole("button", { name: c.logoRemove, exact: true }).click();
    await expect(form.getByText(c.logoNone, { exact: true })).toBeVisible();
    await expect(form.locator(".company-logo")).toHaveAttribute("data-logo", "placeholder");
    const removal = calls.at(-1);
    expect(removal).toMatchObject({ method: "DELETE" });
    // Removal carries no body and so no content type; it still carries the session's CSRF token.
    expect(removal?.type).toBeUndefined();
    expect(removal?.csrf).toBe("NONFUNCTIONAL_FIXTURE");
    expect(new Set(calls.map((call) => call.key)).size).toBe(calls.length);
  },
);

test(
  "a bulk logo upload dry-runs the files, lists bad names and unknown codes, then applies with the token",
  browserCase(["@functional"]),
  async ({ page }) => {
    const c = catalogTranslations.en;
    const calls: {
      path: string;
      search: string;
      ifMatch?: string | undefined;
      key?: string | undefined;
      parts: number;
    }[] = [];
    const preview = (over: object) => ({
      fileSha256: "b".repeat(64),
      token: "signed-logo-token",
      rows: 3,
      added: 2,
      changed: 1,
      unchanged: 0,
      errors: 0,
      lines: [
        {
          line: 2,
          code: "fictional_plain_co",
          status: "changed",
          issues: [],
          changedFields: ["logo"],
        },
      ],
      truncated: false,
      ...over,
    });
    let response = envelope(
      preview({
        token: null,
        errors: 2,
        lines: [
          {
            line: 2,
            code: "unknown_co",
            status: "error",
            issues: [{ field: "code", reason: "unknown_reference" }],
            changedFields: [],
          },
          {
            line: 3,
            code: null,
            status: "error",
            issues: [
              { field: "file", reason: "bad_name" },
              { field: "file", reason: "not_png" },
            ],
            changedFields: [],
          },
        ],
      }),
    );
    await mockCatalogs(page, true, {
      rows: {
        ets2: {
          ...defaultRows("en"),
          companies: [companyRow(freight, "en", null), companyRow(plainCo, "en", logoRef(2))],
        },
      },
      writes: ({ method, path, search, headers, body }) => {
        if (method !== "POST" || !path.startsWith("/admin/catalogs/companies/logo-")) return null;
        calls.push({
          path,
          search,
          ifMatch: headers["if-match"],
          key: headers["idempotency-key"],
          parts: String(body).split('name="file"').length - 1,
        });
        if (path.endsWith("/logo-previews")) return { status: 200, json: response };
        return {
          status: 200,
          json: envelope({ importId: entityId, rows: 3, added: 2, changed: 1, unchanged: 0 }),
        };
      },
    });
    await open(page, "en", "?tab=companies");
    await page
      .getByRole("button", { name: phone(page) ? c.logoUploadShort : c.logoUploadAll, exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(c.logoBulkNote, { exact: true })).toBeVisible();
    const picker = dialog.locator('input[type="file"]');
    await expect(picker).toHaveAttribute("multiple", "");
    await picker.setInputFiles([
      { name: "fictional_freight_co.png", mimeType: "image/png", buffer: png(1) },
      { name: "unknown_co.png", mimeType: "image/png", buffer: png(2) },
      { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not an image") },
    ]);
    // Bad files and unknown codes are listed by file name, and nothing can be applied yet.
    await expect(dialog.getByText("unknown_co.png", { exact: true })).toBeVisible();
    await expect(dialog.getByText("notes.txt", { exact: true })).toBeVisible();
    await expect(dialog.getByText(c.issueUnknownCompany, { exact: false })).toBeVisible();
    await expect(dialog.getByText(c.issueBadName, { exact: false })).toBeVisible();
    await expect(dialog.getByText(c.issueNotPng, { exact: false })).toBeVisible();
    await expect(dialog.getByRole("button", { name: c.logoBulkApply, exact: true })).toBeDisabled();
    await expect(dialog.getByRole("alert").filter({ hasText: "2" })).toBeVisible();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      path: "/admin/catalogs/companies/logo-previews",
      search: "?game=ets2",
      parts: 3,
    });

    await dialog.getByRole("button", { name: c.logoOtherFiles, exact: true }).click();
    response = envelope(preview({}));
    await dialog.locator('input[type="file"]').setInputFiles([
      { name: "fictional_freight_co.png", mimeType: "image/png", buffer: png(1) },
      { name: "fictional_plain_co.png", mimeType: "image/png", buffer: png(4) },
      { name: "third_co.png", mimeType: "image/png", buffer: png(5) },
    ]);
    await expect(dialog.getByText(c.logoWillReplace, { exact: true })).toBeVisible();
    await expect(dialog.getByText("fictional_plain_co.png", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Changed fields: Logo", { exact: false })).toBeVisible();
    await dialog.getByRole("button", { name: c.logoBulkApply, exact: true }).click();
    await expect(dialog.getByText(c.logoBulkApplied, { exact: true })).toBeVisible();
    await expect(
      dialog.getByText("2 added, 1 replaced, 0 unchanged", { exact: true }),
    ).toBeVisible();
    const apply = calls.at(-1);
    expect(apply).toMatchObject({
      path: "/admin/catalogs/companies/logo-imports",
      search: "?game=ets2",
      ifMatch: '"signed-logo-token"',
      parts: 3,
    });
    expect(apply?.key).toEqual(expect.any(String));
    await dialog.getByRole("button", { name: c.done, exact: true }).click();
    await expect(dialog).toHaveCount(0);

    // More than 500 files, or an unreadable total, is refused in the browser.
    const before = calls.length;
    await page
      .getByRole("button", { name: phone(page) ? c.logoUploadShort : c.logoUploadAll, exact: true })
      .click();
    await page
      .getByRole("dialog")
      .locator('input[type="file"]')
      .setInputFiles(
        Array.from({ length: 501 }, (_, n) => ({
          name: `c${n}.png`,
          mimeType: "image/png",
          buffer: Buffer.from("x"),
        })),
      );
    await expect(
      page.getByRole("dialog").getByText(c.logoBulkInvalid, { exact: true }),
    ).toBeVisible();
    expect(calls).toHaveLength(before);
  },
);

test(
  "the depot import dialog shows the depot columns and templates",
  browserCase(["@functional"]),
  async ({ page }) => {
    const c = catalogTranslations.en;
    await mockCatalogs(page, true, {});
    await open(page, "en", "?tab=depots");
    await page.getByRole("button", { name: c.importButton, exact: true }).last().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("code").first()).toHaveText(
      "game, company_code, city_code, dlc_code",
    );
    await expect(dialog.getByRole("button", { name: c.templateCsv, exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: c.templateJson, exact: true })).toBeVisible();
  },
);

test(
  "members without manage rights see logos and depots but get no logo, depot or import actions",
  browserCase(["@functional"]),
  async ({ page }) => {
    const c = catalogTranslations.en;
    const { requests } = await mockCatalogs(page, false, {
      capabilities: ["account.self", "company.read"],
      rows: { ets2: { ...defaultRows("en"), companies: [companyRow(freight, "en", logoRef(3))] } },
      depots: { ets2: [depotRow(depotRowId, { ...freight, logo: logoRef(3) }, northCity)] },
    });
    await open(page, "en", "?tab=companies");
    await expect(plate(page, freight.name)).toHaveAttribute("data-logo", "image");
    await open(page, "en", "?tab=depots");
    await expect(rowOf(page, freight.name)).toContainText(northCity.name);
    for (const name of [
      c.logoUploadAll,
      c.logoUploadShort,
      c.addDepots,
      c.addCompanies,
      c.importButton,
      c.importShort,
      c.edit,
      c.hide,
    ])
      await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
    expect(requests.filter((url) => url.pathname.startsWith("/api/v1/admin/"))).toEqual([]);
  },
);
