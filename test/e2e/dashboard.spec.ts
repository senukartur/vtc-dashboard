import type { Page } from "@playwright/test";
import { expect, test } from "./support/fixtures.ts";
import { mockDashboardRoutes } from "./support/dashboard-ui.ts";

async function switchLanguage(page: Page, locale: "ru" | "en") {
  await page
    .getByRole("banner")
    .getByRole("combobox", { name: /^(Language|Язык)$/ })
    .selectOption(locale);
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
}

test.describe("Company Dashboard E2E", () => {
  test("loads company dashboard with overview KPIs, distance chart, and widgets", async ({
    page,
  }) => {
    await mockDashboardRoutes(page);
    await page.goto("/account/dashboard");

    // Title and subtitle
    await expect(
      page.getByRole("heading", { name: "Company Dashboard", exact: true }),
    ).toBeVisible();

    // Metric KPI cards
    await expect(page.getByText("Actual distance", { exact: true })).toBeVisible();
    await expect(page.getByText("Accepted trips", { exact: true })).toBeVisible();
    await expect(page.getByText("Active drivers", { exact: true })).toBeVisible();

    // Exact formatted numbers
    await expect(page.getByText("125,430 km")).toBeVisible();
    await expect(page.getByText("42", { exact: true })).toBeVisible();

    // Distance chart
    await expect(
      page.getByRole("heading", { name: "Distance Dynamics", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Reporting timezone: Europe/Moscow")).toBeVisible();

    // Leaderboard
    await expect(
      page.getByRole("heading", { name: "Driver Leaderboard", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "AlphaDriver" })).toBeVisible();
    await expect(page.getByRole("link", { name: "BetaHauler" })).toBeVisible();

    // My Qualification widget
    await expect(
      page.getByRole("heading", { name: "My Qualification", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "All my trips" })).toBeVisible();

    // Reviewer queue widget
    await expect(page.getByRole("heading", { name: "Review Queue", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to review" })).toBeVisible();

    // Upcoming event widget
    await expect(page.getByRole("heading", { name: "Upcoming Event", exact: true })).toBeVisible();
    await expect(page.getByText("Autumn Yukon Convoy 2026")).toBeVisible();
  });

  test("filters by game and period", async ({ page }) => {
    await mockDashboardRoutes(page);
    await page.goto("/account/dashboard");

    // Click ETS2 filter
    const ets2Button = page.getByRole("button", { name: "ETS2", exact: true });
    await expect(ets2Button).toBeVisible();
    await ets2Button.click();
    await expect(ets2Button).toHaveAttribute("aria-pressed", "true");

    // Click Last Month period filter
    const lastMonthButton = page.getByRole("button", { name: "Last month", exact: true });
    await expect(lastMonthButton).toBeVisible();
    await lastMonthButton.click();
    await expect(lastMonthButton).toHaveAttribute("aria-pressed", "true");
  });

  test("expands and collapses metric calculation definitions", async ({ page }) => {
    await mockDashboardRoutes(page);
    await page.goto("/account/dashboard");

    const toggleButton = page.getByRole("button", { name: /Show explanations/i });
    await expect(toggleButton).toBeVisible();
    await toggleButton.click();

    await expect(page.getByText("Company Timezone Attribution")).toBeVisible();
    await expect(page.getByText("Actual Trip Start Time")).toBeVisible();
    await expect(page.getByText("Trip Confirmation")).toBeVisible();

    // Collapse
    const hideButton = page.getByRole("button", { name: /Hide explanations/i });
    await hideButton.click();
    await expect(page.getByText("Company Timezone Attribution")).not.toBeVisible();
  });

  test("displays empty company state when company has zero metrics", async ({ page }) => {
    await mockDashboardRoutes(page, { emptyCompany: true });
    await page.goto("/account/dashboard");

    await expect(
      page.getByRole("heading", { name: "Company Dashboard", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Company starting from zero")).toBeVisible();
    await expect(page.locator(".metric-value", { hasText: "0 km" })).toBeVisible();
    await expect(page.getByText("No confirmed trips in this period yet")).toBeVisible();
  });

  test("responsive viewport check without horizontal scrollbar on mobile, tablet, desktop", async ({
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
      await page.goto("/account/dashboard");
      await page.evaluate(() => document.fonts.ready);

      const hasHorizontalScroll = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(hasHorizontalScroll).toBe(false);
    }
  });

  test("bilingual RU and EN rendering without empty or untranslated keys", async ({ page }) => {
    await mockDashboardRoutes(page);
    await page.goto("/account/dashboard");

    // Switch to Russian
    await switchLanguage(page, "ru");
    await expect(
      page.getByRole("heading", { name: "Панель управления", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Пройденное расстояние", { exact: true })).toBeVisible();
    await expect(page.getByText("Подтвержденные рейсы", { exact: true })).toBeVisible();
    await expect(page.getByText("125 430 км")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Таблица лидеров", exact: true })).toBeVisible();

    // Switch back to English
    await switchLanguage(page, "en");
    await expect(
      page.getByRole("heading", { name: "Company Dashboard", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Actual distance", { exact: true })).toBeVisible();
    await expect(page.getByText("125,430 km")).toBeVisible();
  });
});
