import type { Page, TestInfo } from "@playwright/test";
import { catalogTranslations } from "../../apps/web/src/features/catalogs/translations.ts";
import {
  catalogItem,
  catalogLanguage,
  catalogList,
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
    await expect(dialog.getByText("adr_class: invalid", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: c.apply, exact: true })).toBeDisabled();
    await dialog.getByRole("button", { name: c.otherFile, exact: true }).click();
    // A clean file offers apply; a stale token asks to check again.
    previewResponse = { status: 200, json: envelope(previewOk) };
    await dialog.locator('input[type="file"]').setInputFiles(file());
    await expect(dialog.getByText("fixture_changed", { exact: true })).toBeVisible();
    expect(calls.at(-1)).toMatchObject({ path: "/admin/catalogs/cities/import-previews" });
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
    expect(apply).toHaveLength(3);
    expect(apply.at(-1)?.ifMatch).toBe('"signed-token"');
    // An uncertain 503 retry repeats the same logical key, so it cannot double-apply;
    // the definite stale-token failure before it does not.
    expect(apply[0]?.key).not.toBe(apply[1]?.key);
    expect(apply[1]?.key).toBe(apply[2]?.key);
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

test(
  "a selector offers visible rows only, labels fallback and never submits its enclosing form",
  browserCase(["@functional"]),
  async ({ page }) => {
    await mockTrips(page);
    const hiddenId = "63000000-0000-4000-8000-000000000030";
    const city = (id: string, name: string, overrides = {}) =>
      catalogItem(id, name, "ru", overrides);
    await page.route("**/api/v1/catalogs/cities?*", (route) =>
      route.fulfill({
        json: catalogList([
          city(entityId, "Fictional visible"),
          city(hiddenId, "Fictional hidden", {
            hidden: true,
            display: { ...city(hiddenId, "Fictional hidden").display, hidden: true },
          }),
        ]),
      }),
    );
    let submissions = 0;
    await page.route("**/api/v1/manual-reports", (route) => {
      if (route.request().method() === "POST") submissions++;
      return route.fallback();
    });
    await page.goto("/account/reports/new");
    await catalogLanguage(page, "ru");
    const origin = page.getByRole("combobox", { name: "Город отправления", exact: true });
    await expect(origin.locator("option")).toHaveCount(2);
    await expect(origin.locator("option").nth(1)).toContainText("Fictional visible");
    await expect(origin.locator("option").nth(1)).toContainText(catalogTranslations.ru.fallback);
    await expect(origin.locator(`option[value="${hiddenId}"]`)).toHaveCount(0);
    const search = page
      .getByRole("searchbox", { name: `Поиск: Город отправления` })
      .or(page.getByRole("searchbox", { name: /Город отправления/ }));
    await search.first().press("Enter");
    await page.waitForTimeout(150);
    expect(submissions).toBe(0);
  },
);
