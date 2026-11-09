import { randomUUID } from "node:crypto";
import { catalogTranslations } from "../../apps/web/src/features/catalogs/translations.ts";
import { resetAccountLimits, staffContext } from "./support/account.ts";
import { catalogLanguage } from "./support/catalogs.ts";
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
      await page.goto("/account/catalogs?game=ats&tab=trailers");
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
          await page.goto(`/account/catalogs?game=ats&tab=cities&q=${encodeURIComponent(term)}`);
          await expect(page.getByText(code, { exact: true }).first()).toBeVisible();
        }
      }
    } finally {
      await staff.dispose();
    }
  },
);
