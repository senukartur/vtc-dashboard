import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import type { components } from "@vtc/contracts";
import { catalogTranslations } from "../../apps/web/src/features/catalogs/translations.ts";
import { rgbaLogo } from "../fixtures/catalogs/logos.ts";
import { csrf, origin, resetAccountLimits, staffContext, write } from "./support/account.ts";
import { type CatalogListName, catalogLanguage, catalogTimezone } from "./support/catalogs.ts";
import { browserCase, expect, test } from "./support/fixtures.ts";

test.use({ trace: "off", screenshot: "off", video: "off" });
test(
  "staff create, import, hide and restore list rows through the real API",
  browserCase(["@real"]),
  async ({ page, context }) => {
    test.setTimeout(90000);
    let phase = "START";
    const c = catalogTranslations.en;
    // Allocated databases are shared within a run; codes stay unique per attempt.
    const unique = randomUUID().slice(0, 8),
      cityCode = `_browser__${unique}`,
      importedCode = `import_${unique}`;
    const staff = await staffContext();
    try {
      await resetAccountLimits();
      await context.addCookies((await staff.storageState()).cookies);
      phase = "OPEN";
      await page.goto("/account/catalogs?game=ats&tab=cities");
      await catalogLanguage(page);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(c.title);

      phase = "CREATE";
      await page.getByRole("button", { name: c.addCities, exact: true }).first().click();
      const form = page.getByRole("dialog");
      await form.getByLabel(c.fieldCode, { exact: true }).fill(cityCode);
      await form.getByLabel(c.fieldNameEn, { exact: true }).fill(`Fictional Browser ${unique}`);
      await form.getByRole("button", { name: c.save, exact: true }).click();
      await expect(form).toHaveCount(0);

      phase = "DUPLICATE";
      await page.getByRole("button", { name: c.addCities, exact: true }).first().click();
      await form.getByLabel(c.fieldCode, { exact: true }).fill(cityCode);
      await form.getByLabel(c.fieldNameEn, { exact: true }).fill("Fictional duplicate");
      await form.getByRole("button", { name: c.save, exact: true }).click();
      await expect(form.getByText(c.errorCodeTaken, { exact: true })).toBeVisible();
      await form.getByRole("button", { name: c.cancel, exact: true }).click();

      phase = "IMPORT";
      await page.goto(`/account/catalogs?game=ats&tab=trailers&untranslated=true&q=${unique}`);
      const untranslated = page.getByRole("button", { name: c.untranslated, exact: true });
      await expect(untranslated).toHaveAttribute("aria-pressed", "true");
      await expect(untranslated).toHaveAccessibleDescription(/\d+/);
      const beforeImport = await staff.get("/api/v1/catalogs/summary?game=ats");
      expect(beforeImport.status()).toBe(200);
      const beforeImportLists = (
        (await beforeImport.json()).data as CatalogSchemas["CatalogSummary"]
      ).lists;
      const oldCount = beforeImportLists.trailers.untranslated;
      if (oldCount === undefined) throw new Error("CATALOG_IMPORT_COUNT_MISSING");
      await page.getByRole("button", { name: c.importButton, exact: true }).first().click();
      const dialog = page.getByRole("dialog");
      await dialog.locator('input[type="file"]').setInputFiles({
        name: "synthetic-import.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(
          `game,code,name_en,name_ru,dlc_code\nats,${importedCode},Fictional import,,\n`,
        ),
      });
      await expect(dialog.getByRole("button", { name: c.apply, exact: true })).toBeEnabled();
      await expect(dialog.locator(".catalog-counts strong").nth(0)).toHaveText("1");
      await dialog.getByRole("button", { name: c.apply, exact: true }).click();
      await expect(dialog.getByText(c.appliedTitle, { exact: true })).toBeVisible();
      await dialog.getByRole("button", { name: c.done, exact: true }).click();
      await expect(page.getByText(importedCode, { exact: true }).first()).toBeVisible();
      await expect(untranslated).toHaveAccessibleDescription(
        new Intl.NumberFormat("en-GB").format(oldCount + 1),
      );

      phase = "LOCALE";
      await page.goto(`/account/catalogs?game=ats&tab=cities&q=${unique}`);
      await catalogLanguage(page, "ru");
      await expect(
        page.getByText(catalogTranslations.ru.rowFallback, { exact: true }).first(),
      ).toBeVisible();
      await catalogLanguage(page);

      phase = "HIDE";
      await expect(page.getByText(cityCode, { exact: true }).first()).toBeVisible();
      const narrow = (page.viewportSize()?.width ?? 1280) < 760;
      if (narrow) {
        await page
          .getByRole("button", { name: `Actions for Fictional Browser ${unique}`, exact: true })
          .click();
        await page.getByRole("dialog").getByRole("button", { name: c.hide, exact: true }).click();
      } else {
        await page.getByRole("button", { name: c.hide, exact: true }).first().click();
      }
      await expect(page.getByText(cityCode, { exact: true })).toHaveCount(0);

      phase = "RESTORE";
      await page.getByRole("checkbox", { name: c.showHidden }).click();
      await expect(page.getByText(c.hidden, { exact: true }).first()).toBeVisible();
      await expect(page.getByText(cityCode, { exact: true }).first()).toBeVisible();
    } catch {
      throw new Error(`CATALOG_REAL_${phase}_FAILED`);
    } finally {
      await staff.dispose();
    }
  },
);

test(
  "a real city is found by canonical, English and Russian names and code, with or without accents",
  browserCase(["@real"]),
  async ({ page, context }) => {
    test.setTimeout(90000);
    const c = catalogTranslations.en;
    const unique = randomUUID().slice(0, 8),
      code = `native_${unique}`;
    const staff = await staffContext();
    try {
      await resetAccountLimits();
      await context.addCookies((await staff.storageState()).cookies);
      await page.goto("/account/catalogs?game=ats&tab=cities");
      await catalogLanguage(page);
      await page.getByRole("button", { name: c.addCities, exact: true }).first().click();
      const form = page.getByRole("dialog");
      await form.getByLabel(c.fieldCode, { exact: true }).fill(code);
      await form.getByLabel(c.fieldNameEn, { exact: true }).fill(`Crownburg ${unique}`);
      await form.getByLabel(c.fieldNameRu, { exact: true }).fill(`Крёнбург ${unique}`);
      await form.getByLabel(c.fieldNameNative, { exact: true }).fill(`Krönburg ${unique}`);
      await form.getByRole("button", { name: c.save, exact: true }).click();
      await expect(form).toHaveCount(0);
      for (const locale of ["en", "ru"] as const) {
        await catalogLanguage(page, locale);
        for (const term of [
          `Krönburg ${unique}`,
          `Kronburg ${unique}`,
          `KRÖNBURG ${unique}`,
          `Crownburg ${unique}`,
          `Кренбург ${unique}`,
          code,
        ]) {
          const [response] = await Promise.all([
            page.waitForResponse((response) => {
              const url = new URL(response.url());
              return (
                url.pathname === "/api/v1/catalogs/cities" &&
                url.searchParams.get("search") === term &&
                url.searchParams.get("locale") === locale
              );
            }),
            page
              .getByRole("searchbox", { name: catalogTranslations[locale].searchLabel })
              .fill(term),
          ]);
          expect(response.status()).toBe(200);
          expect((await response.json()).data.items).toEqual(
            expect.arrayContaining([expect.objectContaining({ code })]),
          );
          await expect(page.getByText(code, { exact: true }).first()).toBeVisible();
        }
      }
    } finally {
      await staff.dispose();
    }
  },
);

test(
  "staff import a company, upload a drawn logo that renders from the authenticated route, then remove it",
  browserCase(["@real"]),
  async ({ page, context }) => {
    test.setTimeout(90000);
    let phase = "START";
    const c = catalogTranslations.en;
    const unique = randomUUID().slice(0, 8),
      code = `logo_co_${unique}`,
      name = `Fictional Haulage ${unique}`;
    const staff = await staffContext();
    const narrow = () => (page.viewportSize()?.width ?? 1280) < 760;
    const row = () =>
      narrow()
        ? page.locator(".catalog-card-row").filter({ hasText: name })
        : page.getByTestId("catalog-table").getByRole("row").filter({ hasText: name });
    const edit = async () => {
      if (narrow()) {
        await page.getByRole("button", { name: `Actions for ${name}`, exact: true }).click();
        await page.getByRole("dialog").getByRole("button", { name: c.edit, exact: true }).click();
      } else await row().getByRole("button", { name: c.edit, exact: true }).click();
    };
    try {
      await resetAccountLimits();
      await context.addCookies((await staff.storageState()).cookies);
      phase = "IMPORT";
      await page.goto(`/account/catalogs?game=ats&tab=companies&q=${unique}`);
      await catalogLanguage(page);
      await page.getByRole("button", { name: c.importButton, exact: true }).first().click();
      const dialog = page.getByRole("dialog");
      await dialog.locator('input[type="file"]').setInputFiles({
        name: "synthetic-companies.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(`game,code,name_en,name_ru,dlc_code\nats,${code},${name},,\n`),
      });
      await expect(dialog.getByRole("button", { name: c.apply, exact: true })).toBeEnabled();
      await dialog.getByRole("button", { name: c.apply, exact: true }).click();
      await expect(dialog.getByText(c.appliedTitle, { exact: true })).toBeVisible();
      await dialog.getByRole("button", { name: c.done, exact: true }).click();
      await expect(row()).toBeVisible();
      await expect(row().locator(".company-logo")).toHaveAttribute("data-logo", "placeholder");

      phase = "UPLOAD";
      await edit();
      const form = page.getByRole("dialog");
      await form.locator('input[type="file"]').setInputFiles({
        name: `${code}.png`,
        mimeType: "image/png",
        buffer: rgbaLogo(2),
      });
      await expect(form.getByText(c.logoCurrent, { exact: true })).toBeVisible();
      await form.getByRole("button", { name: c.cancel, exact: true }).click();
      await expect(form).toHaveCount(0);

      phase = "RENDER";
      const plate = row().locator(".company-logo");
      await expect(plate).toHaveAttribute("data-logo", "image");
      await expect
        .poll(() => plate.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth))
        .toBeGreaterThan(0);
      await page.reload();
      await expect(plate).toHaveAttribute("data-logo", "image");

      phase = "REMOVE";
      await edit();
      await form.getByRole("button", { name: c.logoRemove, exact: true }).click();
      await expect(form.getByText(c.logoNone, { exact: true })).toBeVisible();
      await form.getByRole("button", { name: c.cancel, exact: true }).click();
      await expect(plate).toHaveAttribute("data-logo", "placeholder");
      await expect(plate.locator("img")).toHaveCount(0);
    } catch {
      throw new Error(`CATALOG_REAL_LOGO_${phase}_FAILED`);
    } finally {
      await staff.dispose();
    }
  },
);

type CatalogSchemas = components["schemas"];

async function setCatalogPreferences(
  staff: APIRequestContext,
  preferences: CatalogSchemas["PreferencesInput"],
  version: string,
) {
  const response = await staff.patch("/api/v1/me/preferences", {
    headers: {
      Origin: origin,
      "X-CSRF-Token": await csrf(staff),
      "Idempotency-Key": randomUUID(),
      "If-Match": version,
    },
    data: preferences,
  });
  expect(response.status()).toBe(200);
  const updatedVersion = response.headers().etag;
  if (!updatedVersion) throw new Error("CATALOG_PREFERENCE_VERSION_MISSING");
  return updatedVersion;
}

test(
  "maintenance chips and all seven row times use the real catalog API and saved display timezone",
  browserCase(["@real"]),
  async ({ page, context }) => {
    test.setTimeout(90000);
    const c = catalogTranslations.en;
    const unique = randomUUID().slice(0, 8);
    const game = "ats";
    await resetAccountLimits();
    const staff = await staffContext();
    let restorePreferences: (() => Promise<string>) | undefined;
    try {
      const selfResponse = await staff.get("/api/v1/me");
      expect(selfResponse.status()).toBe(200);
      const self = (await selfResponse.json()).data as CatalogSchemas["Self"];
      const etag = selfResponse.headers().etag;
      if (!etag) throw new Error("CATALOG_PREFERENCE_VERSION_MISSING");
      const savedVersion = await setCatalogPreferences(
        staff,
        { locale: "en", displayTimezone: catalogTimezone },
        etag,
      );
      restorePreferences = () => setCatalogPreferences(staff, self.preferences, savedVersion);
      await context.addCookies((await staff.storageState()).cookies);

      const summary = async () => {
        const response = await staff.get("/api/v1/catalogs/summary?game=ats");
        expect(response.status()).toBe(200);
        return (await response.json()).data as CatalogSchemas["CatalogSummary"];
      };
      const before = (await summary()).lists;
      const createItem = async (
        list: CatalogListName,
        variant: string = list,
        nameRu: string | null = null,
      ) => {
        const code = `f1_${variant}_${unique}`;
        const response = await write(staff, `/admin/catalogs/${list}`, {
          game,
          code,
          nameEn: `Fictional ${variant} ${unique}`,
          nameRu,
        });
        expect(response.status()).toBe(201);
        return (await response.json()).data as CatalogSchemas["CatalogItem"];
      };
      const dlc = await createItem("dlcs");
      const region = await createItem("regions");
      const city = await createItem("cities", "cities", "Вымышленный город");
      const cargo = await createItem("cargoes");
      const trailer = await createItem("trailers");
      const noLogo = await createItem("companies", "no_logo", "Вымышленная компания");
      const hasLogo = await createItem("companies", "has_logo");
      const hidden = await createItem("companies", "hidden");
      const authHeaders = async () => ({
        Origin: origin,
        "X-CSRF-Token": await csrf(staff),
        "Idempotency-Key": randomUUID(),
      });
      const logo = await staff.put(`/api/v1/admin/catalogs/companies/${hasLogo.id}/logo`, {
        headers: await authHeaders(),
        multipart: {
          file: { name: `${hasLogo.code}.png`, mimeType: "image/png", buffer: rgbaLogo(2) },
        },
      });
      expect(logo.status()).toBe(200);
      const hide = await staff.patch(`/api/v1/admin/catalogs/companies/${hidden.id}`, {
        headers: await authHeaders(),
        data: { hidden: true },
      });
      expect(hide.status()).toBe(200);
      const depotResponse = await write(staff, "/admin/catalogs/depots", {
        game,
        cityId: city.id,
        companyId: hasLogo.id,
      });
      expect(depotResponse.status()).toBe(201);
      const depot = (await depotResponse.json()).data as CatalogSchemas["CatalogDepot"];
      const after = (await summary()).lists;
      expect(after.companies).toMatchObject({
        hidden: before.companies.hidden + 1,
        untranslated: (before.companies.untranslated ?? 0) + 1,
        missingLogo: (before.companies.missingLogo ?? 0) + 1,
      });
      expect(after.depots.untranslated).toBe((before.depots.untranslated ?? 0) + 1);

      await page.goto("/account/catalogs");
      await catalogLanguage(page);
      expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe(
        "UTC",
      );
      const table = page.getByTestId("catalog-table");
      const row = (code: string) => table.getByRole("row").filter({ hasText: code });
      const expectTime = async (code: string, updatedAt: string | undefined) => {
        if (!updatedAt) throw new Error("CATALOG_REAL_UPDATED_AT_MISSING");
        const formatted = new Intl.DateTimeFormat("en-GB", {
          timeZone: catalogTimezone,
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(updatedAt));
        const time = row(code).locator("time");
        await expect(time).toBeVisible();
        await expect(time).toHaveAttribute("datetime", updatedAt);
        await expect(time).toHaveText(formatted);
      };
      const query = (extra: Record<string, string> = {}) => ({
        game,
        search: unique,
        locale: "en",
        limit: "25",
        ...extra,
      });
      const listResponse = async (
        list: string,
        action: () => Promise<unknown>,
        extra?: Record<string, string>,
      ) => {
        const [response] = await Promise.all([
          page.waitForResponse((candidate) => {
            const url = new URL(candidate.url());
            return (
              url.pathname === `/api/v1/catalogs/${list}` && url.searchParams.get("limit") === "25"
            );
          }),
          action(),
        ]);
        expect(Object.fromEntries(new URL(response.url()).searchParams)).toEqual(query(extra));
        expect(response.status()).toBe(200);
        return (await response.json()).data as {
          items: { id: string; updatedAt?: string; depotCount?: number }[];
          total: number;
        };
      };
      const listUrl = (list: string, extra: Record<string, string> = {}) =>
        `/account/catalogs?${new URLSearchParams({ game, tab: list, q: unique, ...extra })}`;
      const chip = (label: string) => page.getByRole("button", { name: label, exact: true });
      const hiddenChip = chip(c.hiddenOnly);
      const untranslatedChip = chip(c.untranslated);
      const noLogoChip = chip(c.missingLogo);
      const countText = (count: number | undefined) => {
        if (count === undefined) throw new Error("CATALOG_REAL_SUMMARY_COUNT_MISSING");
        return new Intl.NumberFormat("en-GB").format(count);
      };
      const show = await listResponse("companies", () => page.goto(listUrl("companies")));
      expect(show.items.map((item) => item.id).sort()).toEqual([hasLogo.id, noLogo.id].sort());
      expect(show.total).toBe(2);
      await expect(hiddenChip).toHaveAccessibleDescription(countText(after.companies.hidden));
      await expect(untranslatedChip).toHaveAccessibleDescription(
        countText(after.companies.untranslated),
      );
      await expect(noLogoChip).toHaveAccessibleDescription(countText(after.companies.missingLogo));

      for (const [label, filter, value, item, depotCount] of [
        [c.hiddenOnly, "hidden", "only", hidden, 0],
        [c.untranslated, "untranslated", "true", hasLogo, 1],
        [c.missingLogo, "logo", "missing", noLogo, 0],
      ] as const) {
        const actual = await listResponse("companies", () => chip(label).click(), {
          [filter]: value,
        });
        expect(actual.total).toBe(1);
        expect(actual.items).toMatchObject([{ id: item.id, depotCount }]);
        await expect(chip(label)).toHaveAttribute("aria-pressed", "true");
        await expect(
          row(item.code).getByRole("cell", { name: String(depotCount), exact: true }),
        ).toBeVisible();
        await expectTime(item.code, actual.items[0]?.updatedAt);
      }

      for (const [list, item] of [
        ["dlcs", dlc],
        ["regions", region],
        ["cities", city],
        ["cargoes", cargo],
        ["trailers", trailer],
      ] as const) {
        const actual = await listResponse(list, () => page.goto(listUrl(list)));
        expect(actual.items).toMatchObject([{ id: item.id }]);
        await expectTime(item.code, actual.items[0]?.updatedAt);
      }

      const depotData = await listResponse(
        "depots",
        () => page.goto(listUrl("depots", { untranslated: "true" })),
        { untranslated: "true" },
      );
      expect(depotData.items).toMatchObject([{ id: depot.id }]);
      await expect(untranslatedChip).toHaveAccessibleDescription(
        countText(after.depots.untranslated),
      );
      await expect(noLogoChip).toHaveCount(0);
      await expectTime(hasLogo.code, depotData.items[0]?.updatedAt);

      await page.goto(listUrl("companies", { untranslated: "true" }));
      await row(hasLogo.code).getByRole("button", { name: c.edit, exact: true }).click();
      const form = page.getByRole("dialog");
      await form.getByLabel(c.fieldNameRu, { exact: true }).fill("Вымышленный перевозчик");
      await form.getByRole("button", { name: c.save, exact: true }).click();
      await expect(form).toHaveCount(0);
      await expect(page.getByText(c.empty, { exact: true })).toBeVisible();
      await expect(untranslatedChip).toHaveAccessibleDescription(
        countText(before.companies.untranslated),
      );
    } finally {
      try {
        await restorePreferences?.();
      } finally {
        await staff.dispose();
      }
    }
  },
);
