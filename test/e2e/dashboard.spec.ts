import type { Locator, Page, TestInfo } from "@playwright/test";
import { computePeriodDates } from "../../apps/web/src/features/dashboard/model.ts";
import { formatQuantity } from "../../apps/web/src/shared/formatting.ts";
import {
  type DashboardMockState,
  levelIdAts,
  levelIdEts2,
  makeFilteredAnalyticsFixture,
  mockDashboardRoutes,
} from "./support/dashboard-ui.ts";
import { expect, test } from "./support/fixtures.ts";
import { switchLanguage } from "./support/locale.ts";

const kpis = (page: Page) =>
  page.getByRole("region", { name: /^(Key metrics|Ключевые показатели)$/ });
const chartCard = (page: Page) =>
  page.getByRole("region", { name: /^(Distance Dynamics|Динамика пробега)$/ });
const leaderboardCard = (page: Page) =>
  page.getByRole("region", { name: /^(Driver Leaderboard|Таблица лидеров)$/ });
const qualificationCard = (page: Page) =>
  page.getByRole("region", { name: /^(My Qualification|Моя квалификация)$/ });
const eventCard = (page: Page) =>
  page.getByRole("region", { name: /^(Upcoming Event|Ближайшее мероприятие)$/ });
const reviewCard = (page: Page) =>
  page.getByRole("region", { name: /^(Review Queue|Очередь проверки)$/ });
const gameGroup = (page: Page) => page.getByRole("group", { name: /^(Game|Игра)$/ });
const periodSelect = (page: Page) => page.getByRole("combobox", { name: /^(Period|Период)$/ });
const loadingStatus = (page: Page) =>
  page
    .getByRole("status")
    .filter({ hasText: /^(Loading dashboard data\.\.\.|Загрузка данных дашборда\.\.\.)$/ });
// Capabilities of the fictional account fixture without company.read.
const withoutCompanyRead = ["events.respond", "trips.read_own_private", "trips.submit_own"];

// Requests only the dashboard makes; the forbidden view must issue none of them.
const dashboardOnlyPaths = [
  "/api/v1/analytics/",
  "/api/v1/me/qualification-progress",
  "/api/v1/me/upcoming-event",
  "/api/v1/qualification-levels",
];
function requestsTo(state: DashboardMockState, prefix: string) {
  return state.requests.filter((url) => url.pathname.startsWith(prefix)).map(String);
}
function lastRequest(state: DashboardMockState, path: string) {
  return state.requests.filter((url) => url.pathname === path).at(-1);
}
async function box(locator: Locator) {
  const value = await locator.boundingBox();
  if (!value) throw new Error("ELEMENT_NOT_RENDERED");
  return value;
}
async function capture(page: Page, info: TestInfo, name: string, viewport = false) {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (viewport) await page.screenshot({ path: info.outputPath(`${name}-viewport.png`) });
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
}
async function loaded(page: Page) {
  await expect(leaderboardCard(page).getByRole("link", { name: "AlphaDriver" })).toBeVisible();
  await expect(loadingStatus(page)).toHaveCount(0);
}
/** Keyboard activation on desktop/tablet, a tap on the touch project. */
async function activate(page: Page, target: Locator, touch: boolean) {
  if (touch) await target.tap();
  else {
    await target.focus();
    await page.keyboard.press("Space");
  }
}

test.describe("Company Dashboard E2E", () => {
  test("loads the compact overview with KPIs, distance chart and existing-data widgets", async ({
    page,
  }, info) => {
    await mockDashboardRoutes(page);
    await page.goto("/account/dashboard");

    await expect(
      page.getByRole("heading", { name: "Company Overview", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

    const metrics = kpis(page);
    await expect(metrics.getByRole("term")).toHaveText([
      "Actual distance",
      "Accepted trips",
      "Active drivers",
    ]);
    await expect(metrics.getByRole("definition")).toHaveText(["125,430 km", "42", "2"]);

    await expect(
      chartCard(page).getByRole("heading", { name: "Distance Dynamics", exact: true }),
    ).toBeVisible();
    await expect(chartCard(page).getByText("Reporting timezone: Europe/Moscow")).toBeVisible();

    await expect(leaderboardCard(page).getByRole("link", { name: "AlphaDriver" })).toBeVisible();
    await expect(leaderboardCard(page).getByRole("link", { name: "BetaHauler" })).toBeVisible();
    await expect(qualificationCard(page).getByRole("link", { name: "All my trips" })).toBeVisible();
    await expect(reviewCard(page).getByRole("link", { name: "Go to review" })).toBeVisible();
    await expect(
      eventCard(page).getByRole("heading", { name: "Autumn Yukon Convoy 2026", exact: true }),
    ).toBeVisible();
    await expect(eventCard(page)).toContainText("(UTC)");

    // Blocks without an existing data source stay omitted instead of faked.
    await expect(
      page.getByRole("button", { name: /^(Going|Can't go|Поеду|Не смогу)$/ }),
    ).toHaveCount(0);
    await expect(page.getByText(/Recent company trips|Последние рейсы компании/)).toHaveCount(0);
    await expect(page.getByText(/Достаточно суров|Yukon\?/)).toHaveCount(0);

    await loaded(page);
    await capture(page, info, "dashboard-overview-en", true);
    await switchLanguage(page, "ru");
    await expect(page.getByRole("heading", { name: "Обзор компании", exact: true })).toBeVisible();
    await loaded(page);
    await capture(page, info, "dashboard-overview-ru", true);
  });

  test("filters by game and period with matching totals and requests", async ({ page }) => {
    const state = await mockDashboardRoutes(page, { filterAware: true });
    await page.goto("/account/dashboard");
    await loaded(page);

    const group = gameGroup(page);
    const ets2 = group.getByRole("button", { name: "ETS2", exact: true });
    await ets2.click();
    await expect(ets2).toHaveAttribute("aria-pressed", "true");
    await expect(group.getByRole("button", { name: "All games", exact: true })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(group.getByRole("button", { name: "ATS", exact: true })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await periodSelect(page).selectOption("lastMonth");
    await expect(periodSelect(page)).toHaveValue("lastMonth");

    const expected = computePeriodDates("lastMonth");
    for (const path of ["/api/v1/analytics/company", "/api/v1/analytics/leaderboard"]) {
      await expect
        .poll(() => lastRequest(state, path)?.searchParams.get("fromDate"))
        .toBe(expected.fromDate);
      const url = lastRequest(state, path);
      expect(url?.searchParams.get("game")).toBe("ets2");
      expect(url?.searchParams.get("toDateExclusive")).toBe(expected.toDateExclusive);
    }

    // The fixture total is the exact sum of its buckets, and the page shows exactly that total.
    const fixture = makeFilteredAnalyticsFixture(
      new URLSearchParams({ game: "ets2", granularity: "day" }),
    ).data;
    const bucketSum = fixture.buckets.reduce(
      (sum, bucket) => sum + BigInt(bucket.actualDistanceM),
      0n,
    );
    expect(bucketSum).toBe(BigInt(fixture.actualDistanceM));
    await expect(kpis(page).getByRole("definition")).toHaveText([
      formatQuantity(fixture.actualDistanceM, "km", "en"),
      String(fixture.acceptedTrips),
      "2",
    ]);

    const chart = chartCard(page);
    await chart.getByRole("button", { name: "Table", exact: true }).click();
    const rows = chart.locator("tbody tr");
    await expect(rows).toHaveCount(fixture.buckets.length);
    for (const [index, bucket] of fixture.buckets.entries()) {
      await expect(rows.nth(index).getByRole("rowheader")).toContainText(bucket.date);
      await expect(rows.nth(index)).toContainText(
        formatQuantity(bucket.actualDistanceM, "km", "en"),
      );
    }
  });

  test("shows the assigned qualification names for each game instead of UUIDs", async ({
    page,
  }) => {
    await mockDashboardRoutes(page);
    await page.goto("/account/dashboard");
    const widget = page.getByRole("region", { name: "My Qualification", exact: true });
    await expect(widget.getByText("European Driver II", { exact: true })).toBeVisible();
    await expect(widget.getByText("Pacific Driver III", { exact: true })).toBeVisible();
    await expect(widget).not.toContainText(levelIdEts2);
    await expect(widget).not.toContainText(levelIdAts);
    await switchLanguage(page, "ru");
    const russianWidget = page.getByRole("region", { name: "Моя квалификация", exact: true });
    await expect(russianWidget.getByText("European Driver II", { exact: true })).toBeVisible();
    await expect(russianWidget.getByText("Pacific Driver III", { exact: true })).toBeVisible();
  });

  for (const qualificationLevels of ["unavailable", "missing"] as const) {
    test(`keeps qualification progress when level names are ${qualificationLevels}`, async ({
      page,
    }) => {
      await mockDashboardRoutes(page, { qualificationLevels });
      await page.goto("/account/dashboard");
      const widget = page.getByRole("region", { name: "My Qualification", exact: true });
      await expect(widget.getByText("Level name unavailable", { exact: true })).toHaveCount(2);
      await expect(widget).not.toContainText(levelIdEts2);
      await expect(widget).not.toContainText(levelIdAts);
      await expect(widget).toContainText("15 / 20");
      await switchLanguage(page, "ru");
      const russianWidget = page.getByRole("region", { name: "Моя квалификация", exact: true });
      await expect(
        russianWidget.getByText("Название уровня недоступно", { exact: true }),
      ).toHaveCount(2);
    });
  }

  test("expands and collapses metric calculation definitions", async ({ page }) => {
    await mockDashboardRoutes(page);
    await page.goto("/account/dashboard");

    const toggleButton = page.getByRole("button", { name: /Show explanations/i });
    await expect(toggleButton).toBeVisible();
    await expect(toggleButton).toHaveAttribute("aria-expanded", "false");
    const controlled = await toggleButton.getAttribute("aria-controls");
    expect(controlled).toBeTruthy();
    await toggleButton.click();

    await expect(page.getByText("Company Timezone Attribution")).toBeVisible();
    await expect(page.getByText("Actual Trip Start Time")).toBeVisible();
    await expect(page.getByText("Trip Confirmation")).toBeVisible();
    await expect(page.locator(`[id="${controlled}"]`)).toBeVisible();

    // Collapse
    const hideButton = page.getByRole("button", { name: /Hide explanations/i });
    await expect(hideButton).toHaveAttribute("aria-expanded", "true");
    await hideButton.click();
    await expect(page.getByText("Company Timezone Attribution")).not.toBeVisible();
  });

  test("displays empty company state when company has zero metrics", async ({ page }, info) => {
    await mockDashboardRoutes(page, { emptyCompany: true });
    await page.goto("/account/dashboard");

    await expect(
      page.getByRole("heading", { name: "Company Overview", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Company starting from zero")).toBeVisible();
    await expect(kpis(page).getByRole("definition").first()).toHaveText("0 km");
    const chart = chartCard(page);
    const empty = chart.getByText("No data to display in chart for the selected period");
    await expect(empty).toBeVisible();
    await chart.getByRole("button", { name: "Table", exact: true }).click();
    await expect(chart.getByRole("button", { name: "Table", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(empty).toBeVisible();
    await expect(chart.getByRole("table")).toHaveCount(0);
    await expect(
      leaderboardCard(page).getByText("No confirmed trips in this period yet"),
    ).toBeVisible();
    await capture(page, info, "dashboard-empty-en");
    await switchLanguage(page, "ru");
    await expect(page.getByText("Компания начинает путь с нуля")).toBeVisible();
    await capture(page, info, "dashboard-empty-ru");
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
    await expect(page.getByRole("heading", { name: "Обзор компании", exact: true })).toBeVisible();
    await expect(kpis(page).getByRole("term")).toHaveText([
      "Пройденное расстояние",
      "Подтвержденные рейсы",
      "Активные водители",
    ]);
    await expect(kpis(page).getByRole("definition").first()).toHaveText(
      formatQuantity("125430000", "km", "ru"),
    );
    await expect(page.getByRole("heading", { name: "Таблица лидеров", exact: true })).toBeVisible();
    const view = chartCard(page).getByRole("group", { name: "Вид", exact: true });
    await expect(view.getByRole("button")).toHaveText(["График", "Таблица"]);

    // Switch back to English
    await switchLanguage(page, "en");
    await expect(
      page.getByRole("heading", { name: "Company Overview", exact: true }),
    ).toBeVisible();
    await expect(kpis(page).getByRole("term").first()).toHaveText("Actual distance");
    await expect(kpis(page).getByRole("definition").first()).toHaveText("125,430 km");
  });

  test("keeps qualification and the leaderboard on the first desktop screen", async ({
    page,
  }, info) => {
    test.skip(info.project.name !== "desktop-chromium", "The first-screen budget is 1280×800.");
    await mockDashboardRoutes(page);
    await page.goto("/account/dashboard");
    for (const locale of ["en", "ru"] as const) {
      if (locale === "ru") await switchLanguage(page, "ru");
      await loaded(page);
      await expect(qualificationCard(page).getByRole("heading", { level: 3 })).toHaveCount(2);
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => scrollY)).toBe(0);

      const qualification = await box(qualificationCard(page));
      expect(qualification.y).toBeGreaterThanOrEqual(0);
      expect(qualification.y + qualification.height).toBeLessThanOrEqual(800);
      for (const heading of await qualificationCard(page).getByRole("heading", { level: 3 }).all())
        expect((await box(heading)).y + (await box(heading)).height).toBeLessThanOrEqual(800);

      const leaderboard = leaderboardCard(page);
      const firstRow = leaderboard.locator("tbody tr").first();
      for (const target of [
        leaderboard.getByRole("heading", { level: 2 }),
        firstRow,
        page.getByRole("heading", { level: 1 }),
        gameGroup(page),
        periodSelect(page),
        kpis(page),
      ]) {
        const rect = await box(target);
        expect(rect.y + rect.height).toBeLessThanOrEqual(800);
      }

      const tops = await Promise.all(
        (await kpis(page).getByRole("definition").all()).map(async (dd) => (await box(dd)).y),
      );
      expect(tops).toHaveLength(3);
      for (const top of tops) expect(Math.abs(top - (tops[0] ?? 0))).toBeLessThanOrEqual(1);

      const title = await box(page.getByRole("heading", { level: 1 }));
      expect((await box(gameGroup(page))).y).toBeLessThan(title.y + title.height);
    }
  });

  test("switches the distance card between chart and exact table without losing focus", async ({
    page,
  }, info) => {
    const touch = info.project.name === "mobile-chromium";
    const state = await mockDashboardRoutes(page, { filterAware: true });
    await page.goto("/account/dashboard");
    await loaded(page);

    const chart = chartCard(page);
    const view = chart.getByRole("group", { name: "View", exact: true });
    const chartButton = view.getByRole("button", { name: "Chart", exact: true });
    const tableButton = view.getByRole("button", { name: "Table", exact: true });
    await expect(chartButton).toHaveAttribute("aria-pressed", "true");
    await expect(tableButton).toHaveAttribute("aria-pressed", "false");
    await expect(chart.getByRole("table")).toHaveCount(0);
    await expect(chart.locator("figcaption")).toHaveText(
      "Peak: 2026-10-04 — 48,430 km. Exact values are in the Table view.",
    );
    const before = (await box(chart)).height;

    await activate(page, tableButton, touch);
    await expect(tableButton).toHaveAttribute("aria-pressed", "true");
    await expect(chartButton).toHaveAttribute("aria-pressed", "false");
    if (!touch) await expect(tableButton).toBeFocused();
    const table = chart.getByRole("table");
    await expect(table.locator("caption")).toContainText("Europe/Moscow");
    await expect(table.getByRole("columnheader")).toHaveText(["Date", "Distance", "Trips"]);
    await expect(table.locator("tbody tr")).toHaveCount(4);
    const peakRow = table.locator("tbody tr").filter({ hasText: "2026-10-04" });
    await expect(peakRow).toContainText("48,430 km");
    await expect(peakRow).toContainText("17");
    await expect(peakRow).toContainText("Peak");
    await expect(chart.locator("svg")).toHaveCount(0);
    expect(Math.abs((await box(chart)).height - before)).toBeLessThanOrEqual(2);

    if (!touch) {
      await page.keyboard.press("Tab");
      await expect(
        chart.getByRole("region", { name: /^Distance data table for the period/ }),
      ).toBeFocused();
    }

    // Interval change in Table view: the header stays mounted and keeps focus and view.
    state.holdAnalytics();
    const monthly = chart
      .getByRole("group", { name: "Interval", exact: true })
      .getByRole("button", { name: "Monthly", exact: true });
    await activate(page, monthly, touch);
    await expect(monthly).toHaveAttribute("aria-pressed", "true");
    await expect(tableButton).toHaveAttribute("aria-pressed", "true");
    // The status is announced, not shown, so nothing below the header shifts.
    await expect(loadingStatus(page)).toHaveCount(1);
    if (!touch) await expect(monthly).toBeFocused();
    await expect
      .poll(() => lastRequest(state, "/api/v1/analytics/company")?.searchParams.get("granularity"))
      .toBe("month");
    const loadingTop = (await box(chart)).y;
    state.releaseAnalytics();
    await expect(loadingStatus(page)).toHaveCount(0);
    if (!touch) await expect(monthly).toBeFocused();
    expect(Math.abs((await box(chart)).y - loadingTop)).toBeLessThanOrEqual(1);
    const monthRow = chart.locator("tbody tr").filter({ hasText: "2026-10-01" });
    await expect(chart.locator("tbody tr")).toHaveCount(1);
    await expect(monthRow).toContainText("125,430 km");
    await expect(monthRow).toContainText("42");
    await capture(page, info, "dashboard-table-en");

    await chartButton.click();
    await expect(chart.getByRole("table")).toHaveCount(0);

    await switchLanguage(page, "ru");
    const russianView = chartCard(page).getByRole("group", { name: "Вид", exact: true });
    await russianView.getByRole("button", { name: "Таблица", exact: true }).click();
    const russianTable = chartCard(page).getByRole("table");
    await expect(russianTable.locator("caption")).toHaveText(
      "Таблица пройденного расстояния за период (Europe/Moscow)",
    );
    await expect(russianTable.getByRole("columnheader")).toHaveText([
      "Дата",
      "Расстояние",
      "Рейсы",
    ]);
    await capture(page, info, "dashboard-table-ru");
  });

  test("keeps the header usable while loading and recovers from an analytics failure", async ({
    page,
  }, info) => {
    const state = await mockDashboardRoutes(page, { holdAnalytics: true });
    await page.goto("/account/dashboard");
    await expect(loadingStatus(page)).toHaveCount(1);
    await expect(kpis(page)).toHaveAttribute("aria-busy", "true");
    for (const button of await gameGroup(page).getByRole("button").all())
      await expect(button).toBeEnabled();
    await expect(periodSelect(page)).toBeEnabled();
    await capture(page, info, "dashboard-loading-en");
    await switchLanguage(page, "ru");
    await expect(loadingStatus(page)).toHaveCount(1);
    await capture(page, info, "dashboard-loading-ru");
    await switchLanguage(page, "en");
    state.releaseAnalytics();
    await loaded(page);
    await expect(kpis(page)).toHaveAttribute("aria-busy", "false");

    state.failures.analytics = 503;
    await page.reload();
    const alert = page.getByRole("alert").filter({ hasText: "Failed to load dashboard data" });
    await expect(alert).toBeVisible();
    await expect(kpis(page)).toHaveCount(0);
    await capture(page, info, "dashboard-error-en");
    await switchLanguage(page, "ru");
    await expect(
      page.getByRole("alert").filter({ hasText: "Не удалось загрузить данные дашборда" }),
    ).toBeVisible();
    await capture(page, info, "dashboard-error-ru");
    await switchLanguage(page, "en");
    delete state.failures.analytics;
    await alert.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(kpis(page).getByRole("definition").first()).toHaveText("125,430 km");
    await expect(page.getByRole("alert")).toHaveCount(0);
    // The alert and its button are gone; focus lands on the page title, not the body.
    await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  });

  test("keeps partial failures distinct from empty data", async ({ page }) => {
    const state = await mockDashboardRoutes(page, {
      emptyCompany: true,
      failures: { leaderboard: 503 },
    });
    await page.goto("/account/dashboard");
    const leaderboard = leaderboardCard(page);
    await expect(leaderboard.getByText("Could not load the leaderboard")).toBeVisible();
    await expect(leaderboard.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
    await expect(leaderboard.getByText("No confirmed trips in this period yet")).toHaveCount(0);
    await expect(kpis(page).getByRole("definition").nth(2)).toHaveText("Unavailable");
    await expect(kpis(page).getByRole("definition").first()).toHaveText("0 km");
    await expect(page.getByText("Company starting from zero")).toHaveCount(0);

    delete state.failures.leaderboard;
    await leaderboard.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(leaderboard.getByText("No confirmed trips in this period yet")).toBeVisible();
    await expect(leaderboard.getByRole("heading", { level: 2 })).toBeFocused();
    await expect(page.getByText("Company starting from zero")).toBeVisible();

    state.failures.progress = 503;
    await page.reload();
    const qualification = qualificationCard(page);
    await expect(qualification.getByText("Progress unavailable", { exact: true })).toHaveCount(2);
    await expect(qualification.getByText("No qualification assigned")).toHaveCount(0);
  });

  test("keeps current values when a background refresh fails", async ({ page }) => {
    await page.clock.install();
    const state = await mockDashboardRoutes(page);
    await page.goto("/account/dashboard");
    await loaded(page);
    await expect(kpis(page).getByRole("definition")).toHaveText(["125,430 km", "42", "2"]);
    const initial = ["/api/v1/analytics/company", "/api/v1/analytics/leaderboard"].map(
      (path) => lastRequest(state, path)?.href ?? "",
    );

    // Let the cached data go stale (TanStack marks it on a timer), break both endpoints, then
    // leave and return to the same period: the cached query keys refetch and fail.
    await page.clock.fastForward(60_000);
    state.failures.analytics = 503;
    state.failures.leaderboard = 503;
    await periodSelect(page).selectOption("lastMonth");
    await expect(page.getByRole("alert")).toBeVisible();
    const refetched = Promise.all(
      initial.map((href) =>
        page.waitForResponse((response) => response.url() === href && response.status() === 503),
      ),
    );
    await periodSelect(page).selectOption("thisMonth");
    await refetched;
    for (const href of initial)
      expect(state.requests.filter((url) => url.href === href).length).toBe(2);
    // Retained data has no visible change to wait for; give the failed responses time to settle.
    await page.waitForTimeout(500);

    await expect(kpis(page).getByRole("definition")).toHaveText(["125,430 km", "42", "2"]);
    await expect(leaderboardCard(page).locator("tbody tr")).toHaveCount(2);
    await expect(leaderboardCard(page).getByRole("link", { name: "AlphaDriver" })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByText("Could not load the leaderboard")).toHaveCount(0);
    await expect(chartCard(page).locator("figcaption")).toContainText("48,430 km");
  });

  test("explains missing company access without requesting statistics", async ({ page }, info) => {
    const state = await mockDashboardRoutes(page, { capabilities: withoutCompanyRead });
    await page.goto("/account/dashboard");
    await expect(page.getByText("You do not have access to company statistics.")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Company Overview", exact: true }),
    ).toBeVisible();
    await expect(gameGroup(page)).toHaveCount(0);
    await expect(kpis(page)).toHaveCount(0);
    for (const path of dashboardOnlyPaths) expect(requestsTo(state, path)).toEqual([]);
    await capture(page, info, "dashboard-forbidden-en");
    await switchLanguage(page, "ru");
    await expect(page.getByText("Нет доступа к статистике компании.")).toBeVisible();
    await capture(page, info, "dashboard-forbidden-ru");
    for (const path of dashboardOnlyPaths) expect(requestsTo(state, path)).toEqual([]);
  });

  test("shows no qualification for members who cannot submit own trips", async ({ page }) => {
    const state = await mockDashboardRoutes(page, { capabilities: ["company.read"] });
    await page.goto("/account/dashboard");
    await loaded(page);
    const qualification = qualificationCard(page);
    await expect(qualification.getByText("No qualification assigned", { exact: true })).toHaveCount(
      2,
    );
    await expect(qualification.getByText("Loading progress…")).toHaveCount(0);
    await expect(reviewCard(page)).toHaveCount(0);
    expect(requestsTo(state, "/api/v1/me/qualification-progress")).toEqual([]);
  });

  test("keeps review queue and event failures inside their cards", async ({ page }) => {
    await mockDashboardRoutes(page, { failures: { review: 503, event: 503 } });
    await page.goto("/account/dashboard");
    await loaded(page);
    await expect(reviewCard(page).getByText("Could not load the review queue")).toBeVisible();
    await expect(reviewCard(page).getByRole("link", { name: "Go to review" })).toBeVisible();
    await expect(eventCard(page).getByText("Could not load the upcoming event")).toBeVisible();
    await expect(eventCard(page).getByText("No scheduled convoys")).toHaveCount(0);
    await expect(page.getByText("Failed to load dashboard data")).toHaveCount(0);
    await switchLanguage(page, "ru");
    await expect(reviewCard(page).getByText("Не удалось загрузить очередь проверки")).toBeVisible();
    await expect(
      eventCard(page).getByText("Не удалось загрузить ближайшее мероприятие"),
    ).toBeVisible();
  });

  test("replaces earlier values when company access is revoked", async ({ page }) => {
    const state = await mockDashboardRoutes(page);
    await page.goto("/account/dashboard");
    await loaded(page);
    await expect(kpis(page).getByRole("definition").first()).toHaveText("125,430 km");

    state.failures.analytics = 403;
    state.capabilities = withoutCompanyRead;
    await periodSelect(page).selectOption("lastMonth");
    await expect(page.getByText("You do not have access to company statistics.")).toBeVisible();
    await expect(page.getByText("125,430 km")).toHaveCount(0);
    await expect(kpis(page)).toHaveCount(0);
  });

  test("keeps compact targets on fine pointers and 40px targets on touch", async ({
    page,
  }, info) => {
    const state = await mockDashboardRoutes(page);
    await page.goto("/account/dashboard");
    await loaded(page);
    const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
    if (info.project.name === "mobile-chromium") expect(coarse).toBe(true);

    const height = async (target: Locator) => (await box(target)).height;
    const expectTarget = async (target: Locator, fine: number, exact: boolean) => {
      const value = await height(target);
      if (coarse) expect(value).toBeGreaterThanOrEqual(40);
      else if (exact) expect(Math.abs(value - fine)).toBeLessThanOrEqual(0.5);
      else expect(value).toBeGreaterThanOrEqual(fine - 0.5);
    };

    const chart = chartCard(page);
    for (const segment of [
      ...(await gameGroup(page).getByRole("button").all()),
      ...(await chart
        .getByRole("group", { name: "Interval", exact: true })
        .getByRole("button")
        .all()),
      ...(await chart.getByRole("group", { name: "View", exact: true }).getByRole("button").all()),
    ])
      await expectTarget(segment, 24, true);
    await expectTarget(periodSelect(page), 32, true);
    for (const link of [
      qualificationCard(page).getByRole("link", { name: "All my trips" }),
      leaderboardCard(page).getByRole("link", { name: "All drivers" }),
      leaderboardCard(page).getByRole("link", { name: "AlphaDriver" }),
      leaderboardCard(page).getByRole("link", { name: "BetaHauler" }),
    ])
      await expectTarget(link, 30, false);
    await expectTarget(page.getByRole("button", { name: "Show explanations" }), 30, false);

    for (const dd of await kpis(page).getByRole("definition").all())
      expect(await dd.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);

    state.failures.leaderboard = 503;
    await page.reload();
    await expectTarget(leaderboardCard(page).getByRole("button", { name: "Retry" }), 30, false);
    state.failures.analytics = 503;
    await page.reload();
    await expectTarget(page.getByRole("alert").getByRole("button", { name: "Retry" }), 30, false);
  });

  test("orders blocks visually and for keyboard users like the DOM", async ({ page }, info) => {
    await mockDashboardRoutes(page);
    await page.goto("/account/dashboard");
    await loaded(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

    const chart = await box(chartCard(page));
    const qualification = await box(qualificationCard(page));
    const leaderboard = await box(leaderboardCard(page));
    const event = await box(eventCard(page));
    if (info.project.name === "desktop-chromium") {
      expect(Math.abs(chart.y - qualification.y)).toBeLessThanOrEqual(2);
      expect(chart.x).toBeLessThan(qualification.x);
      expect(leaderboard.y).toBeGreaterThan(chart.y + chart.height);
      expect(event.x).toBeGreaterThan(leaderboard.x);

      const sequence = [
        gameGroup(page).getByRole("button", { name: "All games", exact: true }),
        gameGroup(page).getByRole("button", { name: "ETS2", exact: true }),
        gameGroup(page).getByRole("button", { name: "ATS", exact: true }),
        periodSelect(page),
        chartCard(page).getByRole("button", { name: "Daily", exact: true }),
        chartCard(page).getByRole("button", { name: "Monthly", exact: true }),
        chartCard(page).getByRole("button", { name: "Chart", exact: true }),
        chartCard(page).getByRole("button", { name: "Table", exact: true }),
        qualificationCard(page).getByRole("link", { name: "All my trips" }),
        leaderboardCard(page).getByRole("link", { name: "All drivers" }),
        leaderboardCard(page).getByRole("link", { name: "AlphaDriver" }),
      ];
      await sequence[0]?.focus();
      for (const [index, target] of sequence.entries()) {
        if (index > 0) await page.keyboard.press("Tab");
        await expect(target).toBeFocused();
      }
    } else {
      expect(chart.y).toBeLessThan(qualification.y);
      expect(qualification.y).toBeLessThan(leaderboard.y);
      expect(leaderboard.y).toBeLessThan(event.y);
    }
  });

  test("counts drivers beyond the widget and marks capped queues", async ({ page }) => {
    const state = await mockDashboardRoutes(page, { leaderboardSize: 12, reviewNextCursor: true });
    await page.goto("/account/dashboard");
    await expect(leaderboardCard(page).locator("tbody tr")).toHaveCount(10);
    await expect(kpis(page).getByRole("definition").nth(2)).toHaveText("12");
    expect(lastRequest(state, "/api/v1/analytics/leaderboard")?.searchParams.get("limit")).toBe(
      "100",
    );
    await expect(reviewCard(page)).toContainText("Trips pending review: 5+");
  });

  test("shows a lower bound when more drivers exist than one leaderboard page", async ({
    page,
  }) => {
    await mockDashboardRoutes(page, { leaderboardSize: 100, leaderboardNextCursor: true });
    await page.goto("/account/dashboard");
    await expect(kpis(page).getByRole("definition").nth(2)).toHaveText("100+");
    await expect(leaderboardCard(page).locator("tbody tr")).toHaveCount(10);
  });
});
