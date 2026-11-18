import type { Locator, Page } from "@playwright/test";
import { mockDirectoryRoutes } from "./support/drivers-directory-ui.ts";
import { alphaId, directoryResponse, levelsFixture } from "./support/drivers-fixtures.ts";
import { mockDriverRoutes } from "./support/drivers-ui.ts";
import { browserCase, expect, test } from "./support/fixtures.ts";
import { mockQualifications, qid } from "./support/qualifications-ui.ts";

const names = {
  ru: "Водитель международных грузовых перевозок повышенной сложности".padEnd(128, "я"),
  en: "International heavy freight driver qualification".padEnd(128, "x"),
};

async function fits(page: Page, labels: Locator) {
  await expect(labels.first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  for (const label of await labels.all()) {
    const rect = await label.boundingBox();
    expect(rect).not.toBeNull();
    expect((rect?.x ?? 0) + (rect?.width ?? 0)).toBeLessThanOrEqual(
      page.viewportSize()?.width ?? 0,
    );
    await expect(label.locator(".badge")).toHaveCSS("height", "20px");
    await expect(label.locator(".badge")).toHaveCSS("white-space", "nowrap");
  }
  const scrollable = labels.and(page.locator('[tabindex="0"]'));
  if ((page.viewportSize()?.width ?? 0) <= 390) expect(await scrollable.count()).toBeGreaterThan(0);
  if ((await scrollable.count()) === 0) return;
  const first = scrollable.first();
  await expect(first).toHaveAttribute("tabindex", "0");
  await first.focus();
  await expect(first).toBeFocused();
  await first.press("ArrowRight");
  await expect.poll(() => first.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await first.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  expect(
    await first.evaluate(
      (element) => element.scrollWidth - element.clientWidth - element.scrollLeft,
    ),
  ).toBeLessThanOrEqual(1);
}

for (const locale of ["ru", "en"] as const) {
  test(
    `long badge labels: ${locale} driver profile`,
    browserCase(["@layout"]),
    async ({ page }) => {
      await mockDriverRoutes(page);
      await page.addInitScript((value) => localStorage.setItem("vtc.locale", value), locale);
      await page.route("**/api/v1/qualification-levels?*", async (route) => {
        const game =
          new URL(route.request().url()).searchParams.get("game") === "ats" ? "ats" : "ets2";
        const body = levelsFixture(game);
        for (const level of body.data.levels) level.name = names[locale];
        await route.fulfill({ json: body });
      });
      await page.goto(`/account/drivers/${alphaId}`);
      await fits(
        page,
        page.locator(".driver-chips .badge-label-scroll, .driver-ladder .badge-label-scroll"),
      );
    },
  );

  test(
    `long badge labels: ${locale} drivers directory`,
    browserCase(["@layout"]),
    async ({ page }) => {
      await mockDirectoryRoutes(page);
      await page.addInitScript((value) => localStorage.setItem("vtc.locale", value), locale);
      await page.route("**/api/v1/members?*", async (route) => {
        const response = directoryResponse(new URL(route.request().url()).searchParams);
        if (response.status === 200 && "data" in response.body) {
          for (const entry of response.body.data.items) {
            if (entry.levels?.ets2) entry.levels.ets2.name = names[locale];
            if (entry.levels?.ats) entry.levels.ats.name = names[locale];
          }
        }
        await route.fulfill({ status: response.status, json: response.body });
      });
      await page.goto("/account/drivers");
      await fits(page, page.locator(".drivers-table .badge-label-scroll"));
      expect(
        await page.locator(".badge-label-scroll").evaluateAll((labels) =>
          labels.every((label) => {
            const cell = label.closest("td");
            return (
              !cell || label.getBoundingClientRect().right <= cell.getBoundingClientRect().right + 1
            );
          }),
        ),
      ).toBe(true);
    },
  );

  test(
    `long badge labels: ${locale} trailer detail and editor`,
    browserCase(["@layout"]),
    async ({ page }) => {
      const mock = await mockQualifications(page, { lead: true, locale });
      const level = mock.ladder[0];
      if (!level) throw new Error("Fixture level missing");
      level.limits.trailers = {
        mode: "selected",
        types: [
          {
            entityId: qid(300),
            label: names[locale],
            requestedLocale: locale,
            renderedLocale: locale,
            englishFallback: false,
            hidden: false,
          },
        ],
      };
      await page.goto(`/account/qualifications/${qid(1)}`);
      await fits(
        page,
        page
          .locator(".qualification-limit-list .badge-label-scroll")
          .filter({ hasText: names[locale] }),
      );
      await page.goto(`/account/qualifications/${qid(1)}/edit`);
      await fits(page, page.locator(".qualification-selected-chip .badge-label-scroll"));
      const remove = page.locator(".qualification-selected-chip button");
      await expect(remove).toBeVisible();
      expect(
        await remove.evaluate((element) => element.getBoundingClientRect().right <= innerWidth),
      ).toBe(true);
      await remove.click();
      await expect(page.locator(".qualification-selected-chip")).toHaveCount(0);
    },
  );
}
