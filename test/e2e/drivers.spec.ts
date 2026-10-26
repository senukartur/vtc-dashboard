import type { Page } from "@playwright/test";
import { expect, test } from "./support/fixtures.ts";
import {
  formerMemberId,
  levelIdAts,
  levelIdEts2,
  member1Id,
  mockDashboardRoutes,
} from "./support/dashboard-ui.ts";

async function switchLanguage(page: Page, locale: "ru" | "en") {
  await page
    .getByRole("banner")
    .getByRole("combobox", { name: /^(Language|Язык)$/ })
    .selectOption(locale);
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
}

test.describe("Driver Directory and Profiles E2E", () => {
  test("loads driver directory with search, roles, and status indicators", async ({ page }) => {
    await mockDashboardRoutes(page);
    await page.goto("/account/drivers");

    // Title
    await expect(page.getByRole("heading", { name: "Company Drivers", exact: true })).toBeVisible();

    // Table rows
    await expect(page.getByRole("link", { name: "AlphaDriver" })).toBeVisible();
    await expect(page.getByRole("link", { name: "BetaHauler" })).toBeVisible();
    await expect(page.getByRole("link", { name: "GammaRetired" })).toBeVisible();

    // Status badges
    await expect(page.getByText("Active", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Former Member", { exact: true })).toBeVisible();

    // Search filter
    const searchInput = page.getByPlaceholder("Search drivers by nickname...");
    await expect(searchInput).toBeVisible();
    await searchInput.fill("Alpha");

    await expect(page.getByRole("link", { name: "AlphaDriver" })).toBeVisible();
    await expect(page.getByRole("link", { name: "BetaHauler" })).not.toBeVisible();
    await expect(page.getByRole("link", { name: "GammaRetired" })).not.toBeVisible();

    // Clear search
    await searchInput.fill("");
    await expect(page.getByRole("link", { name: "BetaHauler" })).toBeVisible();
  });

  test("navigates to driver profile and renders personal stats, chart, qualifications, and accepted trips", async ({
    page,
  }) => {
    await mockDashboardRoutes(page);
    await page.goto(`/account/drivers/${member1Id}`);

    // Profile header
    await expect(page.getByRole("heading", { name: /AlphaDriver/ })).toBeVisible();
    await expect(page.getByText("Active", { exact: true })).toBeVisible();

    // Privacy disclaimer notice
    await expect(
      page.getByText(
        /Privacy policy: personal account data \(email, authentication tokens, credentials\) is strictly protected/,
      ),
    ).toBeVisible();

    // Personal statistics KPIs
    await expect(page.getByText("Actual distance", { exact: true })).toBeVisible();
    await expect(page.getByText("125,430 km")).toBeVisible();
    await expect(page.getByText("Accepted trips", { exact: true }).first()).toBeVisible();

    // Qualifications card
    await expect(page.getByRole("heading", { name: "Qualifications", exact: true })).toBeVisible();
    await expect(page.getByText(levelIdEts2)).toBeVisible();
    await expect(page.getByText(levelIdAts)).toBeVisible();

    // Accepted trips history table
    await expect(
      page.getByRole("heading", { name: "Confirmed Trips History", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Medical Vaccines")).toBeVisible();
    await expect(page.getByText("580 km")).toBeVisible();
    await expect(page.getByRole("link", { name: "Trip", exact: true })).toBeVisible();
  });

  test("verifies strict privacy: no private account data (email, tokens, credentials) in DOM or storage", async ({
    page,
  }) => {
    await mockDashboardRoutes(page);
    await page.goto(`/account/drivers/${member1Id}`);

    // Ensure DOM does not leak private email addresses or password/token fields
    const domContent = await page.content();
    expect(domContent).not.toContain("@example.invalid");
    expect(domContent).not.toContain("passwordHash");
    expect(domContent).not.toContain("credentialHash");
    expect(domContent).not.toContain("sessionToken");

    // Check localStorage & sessionStorage
    const storageContent = await page.evaluate(() => {
      return JSON.stringify([localStorage, sessionStorage]);
    });
    expect(storageContent).not.toContain("@example.invalid");
    expect(storageContent).not.toContain("password");
  });

  test("displays former member profile with former status badge and no active qualifications", async ({
    page,
  }) => {
    await mockDashboardRoutes(page);
    await page.goto(`/account/drivers/${formerMemberId}`);

    await expect(page.getByRole("heading", { name: /GammaRetired/ })).toBeVisible();
    await expect(page.getByText("Former Member", { exact: true })).toBeVisible();
    await expect(page.getByText("No qualification assigned").first()).toBeVisible();
  });

  test("responsive viewport check without horizontal overflow on mobile, tablet, desktop", async ({
    page,
  }) => {
    await mockDashboardRoutes(page);

    const viewports = [
      { width: 1280, height: 800 },
      { width: 768, height: 1024 },
      { width: 390, height: 844 },
    ];

    for (const vp of viewports) {
      await page.setViewportSize(vp);

      // Directory page
      await page.goto("/account/drivers");
      await page.evaluate(() => document.fonts.ready);
      let overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(overflow).toBe(false);

      // Profile page
      await page.goto(`/account/drivers/${member1Id}`);
      await page.evaluate(() => document.fonts.ready);
      overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(overflow).toBe(false);
    }
  });

  test("bilingual RU and EN directory and profile rendering without untranslated keys", async ({
    page,
  }) => {
    await mockDashboardRoutes(page);
    await page.goto("/account/drivers");

    // Switch to Russian
    await switchLanguage(page, "ru");
    await expect(
      page.getByRole("heading", { name: "Водители компании", exact: true }),
    ).toBeVisible();
    await expect(page.getByPlaceholder("Поиск водителя по никнейму...")).toBeVisible();
    await expect(page.getByText("В штате").first()).toBeVisible();
    await expect(page.getByText("Бывший сотрудник")).toBeVisible();

    // Navigate to profile in Russian via SPA link
    await page.getByRole("link", { name: "AlphaDriver" }).click();
    await expect(page.getByText("Профиль водителя")).toBeVisible();
    await expect(page.getByText("Личная статистика")).toBeVisible();
    await expect(page.getByText("Пройденное расстояние", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Квалификации", exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "История подтвержденных рейсов", exact: true }),
    ).toBeVisible();

    // Switch back to English
    await switchLanguage(page, "en");
    await expect(page.getByText("Driver Profile")).toBeVisible();
    await expect(page.getByText("Personal Statistics")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Confirmed Trips History", exact: true }),
    ).toBeVisible();
  });
});
