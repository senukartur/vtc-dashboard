import type { Locator, Page, TestInfo } from "@playwright/test";
import { fixtureId } from "../../apps/web/src/features/account/fixtures.ts";
import {
  averageDistanceM,
  bucketLabel,
  computePeriodDates,
  previousPeriodQuery,
} from "../../apps/web/src/features/dashboard/model.ts";
import { formatQuantity } from "../../apps/web/src/shared/formatting.ts";
import {
  type DashboardMockState,
  makeFilteredAnalyticsFixture,
  mockDashboardRoutes,
} from "./support/dashboard-ui.ts";
import { browserCase, expect, test } from "./support/fixtures.ts";
import { switchLanguage } from "./support/locale.ts";

const kpis = (page: Page) =>
  page.getByRole("region", { name: /^(Key metrics|Ключевые показатели)$/ });
/** The value of each KPI tile; a tile may add a sub-line and a comparison as more definitions. */
const kpiValues = (page: Page) => kpis(page).locator("dd.dashboard-kpi-value");
const kpiSubs = (page: Page) => kpis(page).locator("dd.dashboard-kpi-sub");
const kpiDeltas = (page: Page) => kpis(page).locator("dd.dashboard-kpi-delta");
const chartCard = (page: Page) =>
  page.getByRole("region", { name: /^(Distance Dynamics|Динамика пробега)$/ });
const leaderboardCard = (page: Page) =>
  page.getByRole("region", { name: /^(Driver Leaderboard|Таблица лидеров)$/ });
/** Blocks of My overview that the company overview no longer shows (VTC-159). */
const personalBlocks = (page: Page) =>
  page.getByRole("region", {
    name: /^(My Qualification|Моя квалификация|Upcoming Event|Ближайшее мероприятие|Recent trips|Последние рейсы|Needs attention|Нужно сделать)$/,
  });
const routesCard = (page: Page) =>
  page.getByRole("region", { name: /^(Popular routes|Популярные маршруты)$/ });
const cargoCard = (page: Page) =>
  page.getByRole("region", { name: /^(Frequent cargo|Частые грузы)$/ });
const sourceCard = (page: Page) =>
  page.getByRole("region", { name: /^(How trips arrived|Как пришли рейсы)$/ });
/** Ranked route or cargo rows of a breakdown card. */
const breakdownItems = (card: Locator) => card.locator(".dashboard-breakdown-list > li");
const breakdownApi = "/api/v1/analytics/company/breakdown";
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
  "/api/v1/me/qualifications",
  "/api/v1/me/upcoming-event",
  "/api/v1/trips",
  "/api/v1/events/",
  "/api/v1/public/company-stats",
];
function requestsTo(state: DashboardMockState, prefix: string) {
  return state.requests.filter((url) => url.pathname.startsWith(prefix)).map(String);
}
function breakdownRequests(state: DashboardMockState, dimension: string) {
  return state.requests.filter(
    (url) => url.pathname === breakdownApi && url.searchParams.get("dimension") === dimension,
  );
}
function lastRequest(state: DashboardMockState, path: string) {
  return state.requests.filter((url) => url.pathname === path).at(-1);
}
const statsPath = "/api/v1/public/company-stats";
const analyticsPath = "/api/v1/analytics/company";
const leaderboardPath = "/api/v1/analytics/leaderboard";
const periodPaths = [analyticsPath, leaderboardPath] as const;
// Reads of My overview that the company overview never makes (VTC-159).
const personalPaths = [
  "/api/v1/me/qualifications",
  "/api/v1/trips",
  "/api/v1/me/trip-status-summary",
] as const;
/** Clock and previous period of the KPI comparisons: 17 November against 1–17 October. */
const comparisonNow = new Date("2026-11-17T09:00:00.000Z");
const previousKey = "2026-10-01..2026-10-18";
/** October with 40 trips, 116,000 km and 3 drivers: +8%, +2, +3% and −1 against the fixture. */
const previousOctober = { acceptedTrips: 40, actualDistanceM: "116000000", activeDrivers: 3 };
/** Period requests to one or both period endpoints, optionally for one date range. */
function periodRequests(
  state: DashboardMockState,
  path?: string,
  fromDate?: string,
  toDateExclusive?: string,
) {
  return state.requests.filter(
    (url) =>
      (path ? url.pathname === path : periodPaths.some((item) => item === url.pathname)) &&
      (fromDate === undefined || url.searchParams.get("fromDate") === fromDate) &&
      (toDateExclusive === undefined ||
        url.searchParams.get("toDateExclusive") === toDateExclusive),
  );
}
/**
 * After a Retry with the Moscow zone: November reads of both period endpoints and one comparison
 * with the same elapsed day of October, never the UTC fallback dates.
 */
async function expectMoscowReads(state: DashboardMockState, before: number) {
  const after = () => periodRequests({ ...state, requests: state.requests.slice(before) });
  await expect.poll(() => after().length).toBe(3);
  for (const path of periodPaths)
    expect(
      periodRequests({ ...state, requests: after() }, path, "2026-11-01", "2026-12-01"),
    ).toHaveLength(1);
  expect(
    periodRequests({ ...state, requests: after() }, analyticsPath, "2026-10-01", "2026-10-02"),
  ).toHaveLength(1);
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
  test(
    "loads the company KPIs with comparisons, distance chart and top drivers",
    browserCase(["@layout"]),
    async ({ page }, info) => {
      await page.clock.setFixedTime(comparisonNow);
      const state = await mockDashboardRoutes(page);
      state.companyAnalyticsByRange[previousKey] = previousOctober;
      await page.goto("/account/company");

      await expect(
        page.getByRole("heading", { name: "Company overview", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(
        page.getByText("Accepted trips only; periods use the company reporting timezone", {
          exact: true,
        }),
      ).toBeVisible();

      const metrics = kpis(page);
      await expect(metrics.getByRole("term")).toHaveText([
        "Actual distance",
        "Accepted trips",
        "Average trip",
        "Active drivers",
      ]);
      // 125,430 km over 42 trips: 2,986.43 km, shown in whole kilometres.
      await expect(kpiValues(page)).toHaveText(["125,430 km", "42", "2,986 km", "2"]);
      await expect(kpiSubs(page)).toHaveText([
        "ETS2 61,430 km · ATS 64,000 km",
        "ETS2 20 · ATS 22",
        "per accepted trip",
        "Active members: 5",
      ]);
      // Each KPI against 1–17 October; only the first tile shows the period, the others keep
      // it for screen readers.
      await expect(kpiDeltas(page)).toHaveText([
        /^\+8% vs 1\s?–\s?17 Oct$/,
        /^\+2 vs 1\s?–\s?17 Oct$/,
        /^\+3% vs 1\s?–\s?17 Oct$/,
        /^−1 vs 1\s?–\s?17 Oct$/,
      ]);
      await expect(kpiDeltas(page).first().getByText(/^vs 1/)).toBeVisible();
      await expect(kpiDeltas(page).nth(1).locator(".visually-hidden")).toHaveText(
        /^vs 1\s?–\s?17 Oct$/,
      );
      await expect(kpiDeltas(page)).toHaveClass([
        /dashboard-delta-up/,
        /dashboard-delta-up/,
        /dashboard-delta-up/,
        /dashboard-delta-down/,
      ]);

      await expect(
        chartCard(page).getByRole("heading", { name: "Distance Dynamics", exact: true }),
      ).toBeVisible();
      await expect(chartCard(page).getByText("Reporting timezone: Europe/Moscow")).toBeVisible();

      await expect(leaderboardCard(page).getByRole("link", { name: "AlphaDriver" })).toBeVisible();
      await expect(leaderboardCard(page).getByRole("link", { name: "BetaHauler" })).toBeVisible();
      // The member's own blocks live on My overview.
      await expect(personalBlocks(page)).toHaveCount(0);
      await expect(page.getByText(/Достаточно суров|Yukon\?/)).toHaveCount(0);

      await loaded(page);
      for (const path of personalPaths) expect(requestsTo(state, path), path).toEqual([]);
      await capture(page, info, "dashboard-overview-en", true);
      await switchLanguage(page, "ru");
      await expect(
        page.getByRole("heading", { name: "Обзор компании", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Только принятые рейсы; периоды — в отчётном часовом поясе компании", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(kpiValues(page).nth(2)).toHaveText(formatQuantity("2986000", "km", "ru"));
      await expect(kpiSubs(page).nth(2)).toHaveText("по принятым рейсам");
      await expect(kpiDeltas(page)).toHaveText([
        /^\+8\s?% к 1–17 окт\.$/,
        /^\+2 к 1–17 окт\.$/,
        /^\+3\s?% к 1–17 окт\.$/,
        /^−1 к 1–17 окт\.$/,
      ]);
      await loaded(page);
      await capture(page, info, "dashboard-overview-ru", true);
    },
  );

  test(
    "compares with an empty, failed or missing previous period without inventing values",
    browserCase(["@functional"]),
    async ({ page }) => {
      await page.clock.setFixedTime(comparisonNow);
      const state = await mockDashboardRoutes(page);
      // No accepted trips in 1–17 October: no percentages, a neutral line on every tile.
      state.companyAnalyticsByRange[previousKey] = { acceptedTrips: 0, actualDistanceM: "0" };
      await page.goto("/account/company");
      await loaded(page);
      await expect(kpiDeltas(page)).toHaveText(
        Array.from({ length: 4 }, () => /^no data for 1\s?–\s?17 Oct$/),
      );
      await expect(kpis(page)).not.toContainText("%");
      await expect(
        kpiDeltas(page)
          .first()
          .getByText(/^for 1/),
      ).toBeVisible();

      // A failed comparison read leaves the current values and says so on each tile.
      state.companyAnalyticsByRange[previousKey] = 503;
      await page.reload();
      await loaded(page);
      await expect(kpiValues(page)).toHaveText(["125,430 km", "42", "2,986 km", "2"]);
      await expect(kpiDeltas(page)).toHaveText(Array(4).fill("comparison unavailable"));
      await expect(page.getByRole("alert")).toHaveCount(0);

      // A tiny change still reads as a change, never as 0%.
      state.companyAnalyticsByRange[previousKey] = {
        acceptedTrips: 42,
        actualDistanceM: "125000000",
        activeDrivers: 2,
      };
      await page.reload();
      await loaded(page);
      await expect(kpiDeltas(page)).toHaveText([
        /^\+<1% vs 1\s?–\s?17 Oct$/,
        /^0 vs 1\s?–\s?17 Oct$/,
        /^\+<1% vs 1\s?–\s?17 Oct$/,
        /^0 vs 1\s?–\s?17 Oct$/,
      ]);

      // The default October equals the month: no change, in Russian too.
      delete state.companyAnalyticsByRange[previousKey];
      await page.reload();
      await loaded(page);
      await switchLanguage(page, "ru");
      await expect(kpiDeltas(page).first()).toHaveText(/^0\s?% к 1–17 окт\.$/);

      // All time has no previous period: no comparison read and no line.
      const before = state.requests.length;
      await periodSelect(page).selectOption("allTime");
      await expect(kpiValues(page).first()).toHaveText(formatQuantity("1505160000", "km", "ru"));
      await expect(kpiDeltas(page)).toHaveCount(0);
      expect(
        state.requests.slice(before).filter((url) => url.pathname === analyticsPath),
      ).toHaveLength(1);
    },
  );

  test(
    "shows no average or comparison without accepted trips",
    browserCase(["@functional"]),
    async ({ page }) => {
      await page.clock.setFixedTime(comparisonNow);
      const state = await mockDashboardRoutes(page, { emptyCompany: true });
      state.companyAnalyticsByRange[previousKey] = previousOctober;
      await page.goto("/account/company");
      await expect(kpiValues(page)).toHaveText(["0 km", "0", "No trips", "0"]);
      await expect(kpiDeltas(page)).toHaveCount(3);
      await expect(kpiDeltas(page)).toHaveClass([
        /dashboard-delta-down/,
        /dashboard-delta-down/,
        /dashboard-delta-down/,
      ]);
      await expect(kpiDeltas(page)).toHaveText([
        /^−100% vs 1\s?–\s?17 Oct$/,
        /^−40 vs 1\s?–\s?17 Oct$/,
        /^−3 vs 1\s?–\s?17 Oct$/,
      ]);
    },
  );

  test(
    "filters by game and period with matching totals and requests",
    browserCase(["@functional", "@smoke-dashboard"]),
    async ({ page }) => {
      const now = new Date("2026-10-15T12:00:00.000Z");
      await page.clock.setFixedTime(now);
      const state = await mockDashboardRoutes(page, { filterAware: true });
      await page.goto("/account/company");
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

      const expected = computePeriodDates("lastMonth", now, "Europe/Moscow");
      expect(expected).toEqual({ fromDate: "2026-09-01", toDateExclusive: "2026-10-01" });
      const previous = previousPeriodQuery("lastMonth", now, "Europe/Moscow");
      expect(previous).toEqual({ fromDate: "2026-08-01", toDateExclusive: "2026-09-01" });
      if (!previous) throw new Error("lastMonth has a previous range");
      // The period reads and, for the company analytics, the comparison with August.
      for (const [path, range] of [
        [analyticsPath, expected],
        [leaderboardPath, expected],
        [analyticsPath, previous],
      ] as const) {
        await expect
          .poll(() => periodRequests(state, path, range.fromDate, range.toDateExclusive).length)
          .toBe(1);
        const [url] = periodRequests(state, path, range.fromDate, range.toDateExclusive);
        expect(url?.searchParams.get("game")).toBe("ets2");
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
      const average = averageDistanceM(fixture.actualDistanceM, fixture.acceptedTrips);
      await expect(kpiValues(page)).toHaveText([
        formatQuantity(fixture.actualDistanceM, "km", "en"),
        String(fixture.acceptedTrips),
        formatQuantity(average, "km", "en"),
        "2",
      ]);
      // One game: no game split under the totals.
      await expect(kpis(page).locator("dd.dashboard-kpi-sub")).toHaveText([
        "per accepted trip",
        "Active members: 5",
      ]);

      const chart = chartCard(page);
      await chart.getByRole("button", { name: "Table", exact: true }).click();
      const rows = chart.locator("tbody tr");
      await expect(rows).toHaveCount(fixture.buckets.length);
      for (const [index, bucket] of fixture.buckets.entries()) {
        await expect(
          rows.nth(index).getByRole("rowheader").locator(`time[datetime="${bucket.date}"]`),
        ).toHaveText(bucketLabel(bucket.date, "day", "en", "full"));
        await expect(rows.nth(index)).toContainText(
          formatQuantity(bucket.actualDistanceM, "km", "en"),
        );
      }
    },
  );

  test(
    "anchors periods to the reporting timezone across a month boundary",
    browserCase(["@functional"]),
    async ({ page }) => {
      // 01:30 on 1 November in Moscow while the UTC clock still shows 31 October.
      await page.clock.setFixedTime(new Date("2026-10-31T22:30:00.000Z"));
      const state = await mockDashboardRoutes(page, { filterAware: true });
      await page.goto("/account/company");
      await loaded(page);

      const statsIndex = state.requests.findIndex((url) => url.pathname === statsPath);
      const firstPeriodIndex = state.requests.findIndex((url) =>
        url.pathname.startsWith("/api/v1/analytics/"),
      );
      expect(statsIndex).toBeGreaterThanOrEqual(0);
      expect(firstPeriodIndex).toBeGreaterThan(statsIndex);
      // The month and, for the company analytics, the same elapsed day of October.
      expect(periodRequests(state, leaderboardPath, "2026-11-01", "2026-12-01")).toHaveLength(1);
      expect(periodRequests(state, analyticsPath, "2026-11-01", "2026-12-01")).toHaveLength(1);
      await expect
        .poll(() => periodRequests(state, analyticsPath, "2026-10-01", "2026-10-02").length)
        .toBe(1);
      expect(periodRequests(state)).toHaveLength(3);

      for (const [period, fromDate, toDateExclusive, previousFrom, previousTo] of [
        ["lastMonth", "2026-10-01", "2026-11-01", "2026-09-01", "2026-10-01"],
        ["last7Days", "2026-10-26", "2026-11-02", "2026-10-19", "2026-10-26"],
        ["last30Days", "2026-10-03", "2026-11-02", "2026-09-03", "2026-10-03"],
      ] as const) {
        await periodSelect(page).selectOption(period);
        for (const path of periodPaths)
          await expect
            .poll(() => periodRequests(state, path, fromDate, toDateExclusive).length)
            .toBe(1);
        await expect
          .poll(() => periodRequests(state, analyticsPath, previousFrom, previousTo).length)
          .toBe(1);
        const [previous] = periodRequests(state, analyticsPath, previousFrom, previousTo);
        // The comparison always reads days, whatever the Interval.
        expect(previous?.searchParams.get("granularity")).toBe("day");
        await loaded(page);
      }
      expect(requestsTo(state, statsPath)).toHaveLength(1);
      // One request per endpoint for the initial period and for each change, plus one comparison
      // read per dated period.
      expect(periodRequests(state, leaderboardPath)).toHaveLength(4);
      expect(periodRequests(state, analyticsPath)).toHaveLength(8);

      // All time has no previous period of the same length.
      await periodSelect(page).selectOption("allTime");
      const allTime = () =>
        periodRequests(state, analyticsPath).filter(
          (url) => url.searchParams.get("period") === "all_time",
        );
      await expect.poll(() => allTime().length).toBe(1);
      await loaded(page);
      expect(periodRequests(state, analyticsPath)).toHaveLength(9);
      expect(state.rejected).toEqual([]);
    },
  );

  test(
    "waits for the reporting timezone before requesting overview data",
    browserCase(["@functional"]),
    async ({ page }) => {
      await page.clock.setFixedTime(new Date("2026-10-31T22:30:00.000Z"));
      const state = await mockDashboardRoutes(page, { filterAware: true });
      state.hold("stats");
      await page.goto("/account/company");
      await expect.poll(() => requestsTo(state, statsPath).length).toBe(1);
      // Reads outside the gate still run: the shell chip's nearest event.
      await expect.poll(() => requestsTo(state, "/api/v1/me/upcoming-event").length).toBe(1);
      for (const path of [...periodPaths, breakdownApi])
        expect(requestsTo(state, path)).toEqual([]);
      await expect(loadingStatus(page)).toHaveCount(1);
      for (const button of await gameGroup(page).getByRole("button").all())
        await expect(button).toBeEnabled();
      await expect(periodSelect(page)).toBeEnabled();

      state.release("stats");
      await loaded(page);
      for (const path of periodPaths) {
        const requests = periodRequests(state, path, "2026-11-01", "2026-12-01");
        expect(requests).toHaveLength(1);
      }
      // The comparison with the same elapsed day of October, already with the zone's dates.
      await expect
        .poll(() => periodRequests(state, analyticsPath, "2026-10-01", "2026-10-02").length)
        .toBe(1);
      expect(periodRequests(state)).toHaveLength(3);
      // The member's own reads belong to My overview.
      for (const path of personalPaths) expect(requestsTo(state, path)).toEqual([]);
      const firstIndex = (path: string) =>
        state.requests.findIndex((url) => url.pathname.startsWith(path));
      const lastPeriod = Math.max(...periodPaths.map(firstIndex));
      expect(lastPeriod).toBeGreaterThanOrEqual(0);
      // The breakdowns follow, once per dimension and already with the zone's dates.
      for (const dimension of ["route", "cargo", "source"] as const)
        await expect.poll(() => breakdownRequests(state, dimension).length).toBe(1);
      expect(firstIndex(breakdownApi)).toBeGreaterThan(lastPeriod);
      for (const url of requestsTo(state, breakdownApi).map((href) => new URL(href))) {
        expect(url.searchParams.get("fromDate")).toBe("2026-11-01");
        expect(url.searchParams.get("toDateExclusive")).toBe("2026-12-01");
      }
    },
  );

  for (const variant of ["failed", "unavailable"] as const) {
    test(
      `falls back to UTC anchors when the timezone is ${variant}`,
      browserCase(["@functional"]),
      async ({ page }) => {
        await page.clock.setFixedTime(new Date("2026-10-31T22:30:00.000Z"));
        const state = await mockDashboardRoutes(page, {
          filterAware: true,
          ...(variant === "failed" ? { failures: { stats: 503 } } : { reportingTimezone: null }),
        });
        await page.goto("/account/company");
        await loaded(page);
        await expect(page.getByRole("alert")).toHaveCount(0);
        expect(requestsTo(state, statsPath)).toHaveLength(1);
        for (const path of periodPaths)
          expect(periodRequests(state, path, "2026-10-01", "2026-11-01")).toHaveLength(1);
        // 31 days of October against the 30 of September.
        await expect
          .poll(() => periodRequests(state, analyticsPath, "2026-09-01", "2026-10-01").length)
          .toBe(1);
        expect(periodRequests(state)).toHaveLength(3);
      },
    );
  }

  test(
    "keeps the UTC fallback view through a reconnect",
    browserCase(["@functional"]),
    async ({ page, context }) => {
      await page.clock.setFixedTime(new Date("2026-10-31T22:30:00.000Z"));
      const state = await mockDashboardRoutes(page, {
        filterAware: true,
        failures: { stats: 503 },
      });
      await page.goto("/account/company");
      await loaded(page);
      expect(requestsTo(state, statsPath)).toHaveLength(1);

      // A reconnect must not reread the failed zone and send the page back to loading.
      delete state.failures.stats;
      const selfReads = () => state.requests.filter((url) => url.pathname === "/api/v1/me").length;
      const leaderboardReads = () => periodRequests(state, leaderboardPath).length;
      const [selfBefore, leaderboardBefore] = [selfReads(), leaderboardReads()];
      // Past both stale times, so only refetchOnReconnect keeps the failed zone from rereading.
      await page.clock.setFixedTime(new Date("2026-10-31T22:31:01.000Z"));
      await context.setOffline(true);
      await page.waitForFunction(() => !navigator.onLine);
      await context.setOffline(false);
      await page.waitForFunction(() => navigator.onLine);
      // Positive control: queries that opt into reconnect refetches reread, so the reconnect
      // was handled.
      await expect.poll(selfReads).toBeGreaterThan(selfBefore);
      // The now stale leaderboard refetches once on the same reconnect, after the stats read
      // would have been issued.
      await expect.poll(leaderboardReads).toBe(leaderboardBefore + 1);
      expect(requestsTo(state, statsPath)).toHaveLength(1);
      await expect(kpis(page)).toHaveAttribute("aria-busy", "false");
      await expect(leaderboardCard(page).getByRole("link", { name: "AlphaDriver" })).toBeVisible();
      await expect(loadingStatus(page)).toHaveCount(0);
    },
  );

  test(
    "rereads a failed timezone on Retry and requests only the new dates",
    browserCase(["@functional"]),
    async ({ page }) => {
      // Moscow is already in November; the UTC fallback is still in October.
      await page.clock.setFixedTime(new Date("2026-10-31T22:30:00.000Z"));
      const state = await mockDashboardRoutes(page, {
        filterAware: true,
        failures: { stats: 503, analytics: 503 },
      });
      await page.goto("/account/company");
      const alert = page.getByRole("alert").filter({ hasText: "Failed to load dashboard data" });
      await expect(alert).toBeVisible();
      expect(requestsTo(state, statsPath)).toHaveLength(1);
      expect(periodRequests(state, analyticsPath, "2026-10-01", "2026-11-01")).toHaveLength(1);

      delete state.failures.stats;
      delete state.failures.analytics;
      state.hold("stats");
      const before = state.requests.length;
      // Two presses in one task: both reach the handler before the page rerenders, and the second
      // reuses the stats read in flight.
      await alert
        .getByRole("button", { name: "Retry", exact: true })
        .evaluate((button: HTMLElement) => {
          button.click();
          button.click();
        });
      await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
      await expect.poll(() => requestsTo(state, statsPath).length).toBe(2);
      // While the zone is reread the page waits: no alert, no Retry to press again, no period read.
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(loadingStatus(page)).toHaveCount(1);
      expect(periodRequests({ ...state, requests: state.requests.slice(before) })).toEqual([]);

      state.release("stats");
      await loaded(page);
      await expect(page.getByRole("alert")).toHaveCount(0);
      expect(requestsTo(state, statsPath)).toHaveLength(2);
      await expectMoscowReads(state, before);
      // The new zone's keys fetch the breakdowns once each, never the old dates again.
      const breakdownsAfter = () =>
        state.requests.slice(before).filter((url) => url.pathname === breakdownApi);
      await expect.poll(() => breakdownsAfter().length).toBe(3);
      await page.waitForTimeout(300);
      expect(breakdownsAfter().map((url) => url.searchParams.get("dimension"))).toEqual([
        "route",
        "cargo",
        "source",
      ]);
      for (const url of breakdownsAfter()) {
        expect(url.searchParams.get("fromDate")).toBe("2026-11-01");
        expect(url.searchParams.get("toDateExclusive")).toBe("2026-12-01");
      }
    },
  );

  test(
    "waits for a failed timezone that is reread when the overview remounts",
    browserCase(["@functional"]),
    async ({ page }) => {
      await page.clock.setFixedTime(new Date("2026-10-31T22:30:00.000Z"));
      const state = await mockDashboardRoutes(page, {
        filterAware: true,
        failures: { stats: 503, analytics: 503 },
      });
      await page.goto("/account/company");
      await expect(
        page.getByRole("alert").filter({ hasText: "Failed to load dashboard data" }),
      ).toBeVisible();

      // Leave and return in the same document, so the failed queries stay cached.
      delete state.failures.stats;
      delete state.failures.analytics;
      await page.evaluate(() => {
        history.pushState(null, "", "/account/drivers");
        dispatchEvent(new PopStateEvent("popstate"));
      });
      await expect(
        page.getByRole("heading", { name: "Company overview", exact: true }),
      ).toHaveCount(0);
      state.hold("stats");
      const before = state.requests.length;
      await page.goBack();
      await expect.poll(() => requestsTo(state, statsPath).length).toBe(2);
      // The cached failure and the October leaderboard of the fallback keys stay hidden.
      await expect(
        page.getByRole("heading", { name: "Company overview", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(loadingStatus(page)).toHaveCount(1);
      await expect(leaderboardCard(page).getByRole("link", { name: "AlphaDriver" })).toHaveCount(0);
      await expect(kpis(page)).toHaveAttribute("aria-busy", "true");
      expect(periodRequests({ ...state, requests: state.requests.slice(before) })).toEqual([]);

      state.release("stats");
      await loaded(page);
      await expect(page.getByRole("alert")).toHaveCount(0);
      expect(requestsTo(state, statsPath)).toHaveLength(2);
      await expectMoscowReads(state, before);
    },
  );

  test(
    "rereads an unavailable timezone on Retry after the zone is set",
    browserCase(["@functional"]),
    async ({ page }) => {
      await page.clock.setFixedTime(new Date("2026-10-31T22:30:00.000Z"));
      const state = await mockDashboardRoutes(page, {
        filterAware: true,
        reportingTimezone: null,
        failures: { analytics: 409 },
      });
      await page.goto("/account/company");
      const alert = page.getByRole("alert").filter({ hasText: "Failed to load dashboard data" });
      await expect(alert).toBeVisible();
      expect(requestsTo(state, statsPath)).toHaveLength(1);

      // A director sets the zone; the next stats read carries it.
      state.reportingTimezone = "Europe/Moscow";
      delete state.failures.analytics;
      const before = state.requests.length;
      await alert.getByRole("button", { name: "Retry", exact: true }).click();
      await loaded(page);
      await expect(page.getByRole("alert")).toHaveCount(0);
      expect(requestsTo(state, statsPath)).toHaveLength(2);
      await expectMoscowReads(state, before);
    },
  );

  test(
    "expands and collapses metric calculation definitions",
    browserCase(["@functional"]),
    async ({ page }) => {
      await mockDashboardRoutes(page);
      await page.goto("/account/company");

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
    },
  );

  test(
    "displays empty company state when company has zero metrics",
    browserCase(["@functional"]),
    async ({ page }, info) => {
      await mockDashboardRoutes(page, { emptyCompany: true });
      await page.goto("/account/company");

      await expect(
        page.getByRole("heading", { name: "Company overview", exact: true }),
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
    },
  );

  test(
    "responsive viewport check without horizontal scrollbar on mobile, tablet, desktop",
    browserCase(["@layout"]),
    async ({ page }) => {
      await mockDashboardRoutes(page);

      await page.goto("/account/company");
      await page.evaluate(() => document.fonts.ready);
      const hasHorizontalScroll = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(hasHorizontalScroll).toBe(false);
    },
  );

  test(
    "bilingual RU and EN rendering without empty or untranslated keys",
    browserCase(["@functional"]),
    async ({ page }) => {
      await mockDashboardRoutes(page);
      await page.goto("/account/company");

      // Switch to Russian
      await switchLanguage(page, "ru");
      await expect(
        page.getByRole("heading", { name: "Обзор компании", exact: true }),
      ).toBeVisible();
      await expect(kpis(page).getByRole("term")).toHaveText([
        "Пройденное расстояние",
        "Подтвержденные рейсы",
        "Средний рейс",
        "Активные водители",
      ]);
      await expect(kpiValues(page)).toHaveText([
        formatQuantity("125430000", "km", "ru"),
        "42",
        formatQuantity("2986000", "km", "ru"),
        "2",
      ]);
      await expect(kpis(page).locator("dd.dashboard-kpi-sub").nth(3)).toHaveText(
        "Участников в составе: 5",
      );
      await expect(
        page.getByRole("heading", { name: "Таблица лидеров", exact: true }),
      ).toBeVisible();
      const view = chartCard(page).getByRole("group", { name: "Вид", exact: true });
      await expect(view.getByRole("button")).toHaveText(["График", "Таблица"]);

      // Switch back to English
      await switchLanguage(page, "en");
      await expect(
        page.getByRole("heading", { name: "Company overview", exact: true }),
      ).toBeVisible();
      await expect(kpis(page).getByRole("term").first()).toHaveText("Actual distance");
      await expect(kpiValues(page).first()).toHaveText("125,430 km");
    },
  );

  test(
    "keeps the KPIs, the chart and the leaderboard on the first desktop screen",
    browserCase(["@layout", "@viewport-desktop"]),
    async ({ page }) => {
      await mockDashboardRoutes(page);
      await page.goto("/account/company");
      for (const locale of ["en", "ru"] as const) {
        if (locale === "ru") await switchLanguage(page, "ru");
        await loaded(page);
        await page.evaluate(() => document.fonts.ready);
        expect(await page.evaluate(() => scrollY)).toBe(0);

        // The chart and the top drivers share the row below the KPIs.
        const chart = await box(chartCard(page));
        const board = await box(leaderboardCard(page));
        expect(Math.abs(chart.y - board.y)).toBeLessThanOrEqual(1);
        expect(chart.x).toBeLessThan(board.x);
        expect(chart.width).toBeGreaterThan(board.width);
        expect(chart.y).toBeGreaterThan((await box(kpis(page))).y);

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
          (await kpiValues(page).all()).map(async (dd) => (await box(dd)).y),
        );
        expect(tops).toHaveLength(4);
        for (const top of tops) expect(Math.abs(top - (tops[0] ?? 0))).toBeLessThanOrEqual(1);

        const title = await box(page.getByRole("heading", { level: 1 }));
        expect((await box(gameGroup(page))).y).toBeLessThan(title.y + title.height);
      }
    },
  );

  test(
    "switches the distance card between chart and exact table without losing focus",
    browserCase(["@layout"]),
    async ({ page }, info) => {
      const touch = info.project.name === "mobile-chromium";
      const state = await mockDashboardRoutes(page, { filterAware: true });
      await page.goto("/account/company");
      await loaded(page);

      const chart = chartCard(page);
      const view = chart.getByRole("group", { name: "View", exact: true });
      const chartButton = view.getByRole("button", { name: "Chart", exact: true });
      const tableButton = view.getByRole("button", { name: "Table", exact: true });
      await expect(chartButton).toHaveAttribute("aria-pressed", "true");
      await expect(tableButton).toHaveAttribute("aria-pressed", "false");
      await expect(chart.getByRole("table")).toHaveCount(0);
      await expect(chart.locator("figcaption")).toHaveText(
        "Peak: 4 October 2026 — 48,430 km. Exact values are in the Table view.",
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
      const peakRow = table.locator("tbody tr").filter({ hasText: "4 October 2026" });
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
        .poll(() =>
          lastRequest(state, "/api/v1/analytics/company")?.searchParams.get("granularity"),
        )
        .toBe("month");
      const loadingTop = (await box(chart)).y;
      state.releaseAnalytics();
      await expect(loadingStatus(page)).toHaveCount(0);
      if (!touch) await expect(monthly).toBeFocused();
      expect(Math.abs((await box(chart)).y - loadingTop)).toBeLessThanOrEqual(1);
      const monthRow = chart.locator("tbody tr").filter({ hasText: "October 2026" });
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
    },
  );

  test(
    "labels chart dates in the interface language, never as ISO dates",
    browserCase(["@functional"]),
    async ({ page }) => {
      await page.clock.setFixedTime(new Date("2026-10-31T22:30:00.000Z"));
      await mockDashboardRoutes(page, { filterAware: true });
      await page.goto("/account/company");
      await loaded(page);
      const chart = chartCard(page);
      // The chart has only the date axis.
      const ticks = chart.locator(".recharts-cartesian-axis-tick-value");
      const tooltip = chart.locator(".dashboard-chart-tooltip");
      const iso = /\d{4}-\d{2}-\d{2}/;
      const table = chart.getByRole("button", { name: /^(Table|Таблица)$/ });
      const graph = chart.getByRole("button", { name: /^(Chart|График)$/ });
      /** Hovers the peak bar (4 October) and returns the tooltip. */
      const hoverPeak = async () => {
        await chart.locator(".recharts-bar-rectangle").nth(3).hover();
        await expect(tooltip).toBeVisible();
        return tooltip;
      };

      for (const [locale, axis, full, km, trips] of [
        ["en", "4 Oct", "4 October 2026", "48,430 km", "Trips: 17"],
        ["ru", "4 окт.", "4 октября 2026 г.", formatQuantity("48430000", "km", "ru"), "Рейсы: 17"],
      ] as const) {
        if (locale === "ru") await switchLanguage(page, "ru");
        await expect(ticks.last()).toHaveText(axis);
        for (const tick of await ticks.allTextContents()) expect(tick).not.toMatch(iso);
        await expect(await hoverPeak()).toHaveText(`${full}${km}${trips}`);
        await page.mouse.move(0, 0);
        await expect(chart).not.toContainText(iso);
        await table.click();
        await expect(chart.getByRole("rowheader").last().locator("time")).toHaveText(full);
        await expect(chart).not.toContainText(iso);
        await graph.click();
      }

      // Month buckets: the month name, with the year once the buckets span two years.
      await chart
        .getByRole("group", { name: "Шаг", exact: true })
        .getByRole("button", { name: "По месяцам", exact: true })
        .click();
      await expect(ticks).toHaveText(["окт."]);
      await chart.locator(".recharts-bar-rectangle").first().hover();
      await expect(tooltip).toContainText(/^октябрь 2026/);
      await page.mouse.move(0, 0);
      await switchLanguage(page, "en");
      await periodSelect(page).selectOption("allTime");
      await expect(ticks.first()).toHaveText("Dec 2025");
      await expect(ticks.last()).toHaveText("Nov 2026");
      await chart.locator(".recharts-bar-rectangle").last().hover();
      await expect(tooltip).toHaveText("November 2026125,430 kmTrips: 42");
      await page.mouse.move(0, 0);
      await expect(chart).not.toContainText(iso);
      await table.click();
      await expect(chart.getByRole("rowheader").first().locator("time")).toHaveText(
        "December 2025",
      );
      await expect(chart).not.toContainText(iso);
    },
  );

  test(
    "keeps the header usable while loading and recovers from an analytics failure",
    browserCase(["@functional"]),
    async ({ page }, info) => {
      const state = await mockDashboardRoutes(page, { holdAnalytics: true });
      await page.goto("/account/company");
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
    },
  );

  test(
    "keeps partial failures distinct from empty data",
    browserCase(["@functional"]),
    async ({ page }) => {
      const state = await mockDashboardRoutes(page, {
        emptyCompany: true,
        failures: { leaderboard: 503 },
      });
      await page.goto("/account/company");
      const leaderboard = leaderboardCard(page);
      await expect(leaderboard.getByText("Could not load the leaderboard")).toBeVisible();
      await expect(leaderboard.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
      await expect(leaderboard.getByText("No confirmed trips in this period yet")).toHaveCount(0);
      // Active drivers come from analytics, not from the failed leaderboard.
      await expect(kpiValues(page)).toHaveText(["0 km", "0", "No trips", "0"]);
      await expect(page.getByText("Company starting from zero")).toHaveCount(0);

      delete state.failures.leaderboard;
      await leaderboard.getByRole("button", { name: "Retry", exact: true }).click();
      await expect(leaderboard.getByText("No confirmed trips in this period yet")).toBeVisible();
      await expect(leaderboard.getByRole("heading", { level: 2 })).toBeFocused();
      await expect(page.getByText("Company starting from zero")).toBeVisible();
    },
  );

  test(
    "keeps current values when a background refresh fails",
    browserCase(["@functional"]),
    async ({ page }) => {
      await page.clock.install();
      const state = await mockDashboardRoutes(page);
      await page.goto("/account/company");
      await loaded(page);
      await expect(kpiValues(page)).toHaveText(["125,430 km", "42", "2,986 km", "2"]);
      // The month, its comparison and the leaderboard.
      await expect.poll(() => periodRequests(state).length).toBe(3);
      const initial = periodRequests(state).map((url) => url.href);
      const deltas = await kpiDeltas(page).allTextContents();
      expect(deltas).toHaveLength(4);

      // Let the cached data go stale (TanStack marks it on a timer), break the endpoints, then
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

      await expect(kpiValues(page)).toHaveText(["125,430 km", "42", "2,986 km", "2"]);
      // The comparison keeps its data too, never turning unavailable.
      await expect(kpiDeltas(page)).toHaveText(deltas);
      await expect(leaderboardCard(page).locator("tbody tr")).toHaveCount(2);
      await expect(leaderboardCard(page).getByRole("link", { name: "AlphaDriver" })).toBeVisible();
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(page.getByText("Could not load the leaderboard")).toHaveCount(0);
      await expect(chartCard(page).locator("figcaption")).toContainText("48,430 km");
    },
  );

  test(
    "explains missing company access without requesting statistics",
    browserCase(["@functional"]),
    async ({ page }, info) => {
      const state = await mockDashboardRoutes(page, { capabilities: withoutCompanyRead });
      await page.goto("/account/company");
      await expect(page.getByText("You do not have access to company statistics.")).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Company overview", exact: true }),
      ).toBeVisible();
      await expect(gameGroup(page)).toHaveCount(0);
      await expect(kpis(page)).toHaveCount(0);
      for (const path of dashboardOnlyPaths) expect(requestsTo(state, path)).toEqual([]);
      await capture(page, info, "dashboard-forbidden-en");
      await switchLanguage(page, "ru");
      await expect(page.getByText("Нет доступа к статистике компании.")).toBeVisible();
      await capture(page, info, "dashboard-forbidden-ru");
      for (const path of dashboardOnlyPaths) expect(requestsTo(state, path)).toEqual([]);
    },
  );

  test(
    "replaces earlier values when company access is revoked",
    browserCase(["@functional"]),
    async ({ page }) => {
      const state = await mockDashboardRoutes(page);
      await page.goto("/account/company");
      await loaded(page);
      await expect(kpis(page).getByRole("definition").first()).toHaveText("125,430 km");

      state.failures.analytics = 403;
      state.capabilities = withoutCompanyRead;
      await periodSelect(page).selectOption("lastMonth");
      await expect(page.getByText("You do not have access to company statistics.")).toBeVisible();
      await expect(page.getByText("125,430 km")).toHaveCount(0);
      await expect(kpis(page)).toHaveCount(0);
    },
  );

  test(
    "keeps compact targets on fine pointers and 40px targets on touch",
    browserCase(["@layout"]),
    async ({ page }, info) => {
      const state = await mockDashboardRoutes(page);
      await page.goto("/account/company");
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
        ...(await chart
          .getByRole("group", { name: "View", exact: true })
          .getByRole("button")
          .all()),
      ])
        await expectTarget(segment, 24, true);
      await expectTarget(periodSelect(page), 32, true);
      for (const link of [
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
    },
  );

  test(
    "orders blocks visually and for keyboard users like the DOM",
    browserCase(["@layout"]),
    async ({ page }, info) => {
      await mockDashboardRoutes(page);
      await page.goto("/account/company");
      await loaded(page);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

      const metrics = await box(kpis(page));
      const chart = await box(chartCard(page));
      const leaderboard = await box(leaderboardCard(page));
      const breakdowns = await box(page.locator(".dashboard-breakdowns"));
      expect(chart.y).toBeGreaterThanOrEqual(metrics.y + metrics.height - 0.5);
      expect(breakdowns.y).toBeGreaterThanOrEqual(leaderboard.y + leaderboard.height - 0.5);
      if (info.project.name === "desktop-chromium") {
        expect(Math.abs(chart.y - leaderboard.y)).toBeLessThanOrEqual(1);
        expect(chart.x).toBeLessThan(leaderboard.x);

        // The period comes before the game, as in the header.
        const sequence = [
          periodSelect(page),
          gameGroup(page).getByRole("button", { name: "All games", exact: true }),
          gameGroup(page).getByRole("button", { name: "ETS2", exact: true }),
          gameGroup(page).getByRole("button", { name: "ATS", exact: true }),
          chartCard(page).getByRole("button", { name: "Daily", exact: true }),
          chartCard(page).getByRole("button", { name: "Monthly", exact: true }),
          chartCard(page).getByRole("button", { name: "Chart", exact: true }),
          chartCard(page).getByRole("button", { name: "Table", exact: true }),
          leaderboardCard(page).getByRole("link", { name: "All drivers" }),
          leaderboardCard(page).getByRole("link", { name: "AlphaDriver" }),
        ];
        await sequence[0]?.focus();
        for (const [index, target] of sequence.entries()) {
          if (index > 0) await page.keyboard.press("Tab");
          await expect(target).toBeFocused();
        }
      } else {
        // One column in DOM order, or the leaderboard beside the chart when it fits.
        expect(leaderboard.y).toBeGreaterThanOrEqual(chart.y - 0.5);
        if (Math.abs(leaderboard.y - chart.y) > 1)
          expect(leaderboard.y).toBeGreaterThanOrEqual(chart.y + chart.height - 0.5);
      }
    },
  );

  test(
    "counts active drivers from analytics and lists the top five drivers",
    browserCase(["@functional"]),
    async ({ page }) => {
      const state = await mockDashboardRoutes(page, { leaderboardSize: 12 });
      await page.goto("/account/company");
      await expect(leaderboardCard(page).locator("tbody tr")).toHaveCount(5);
      // Active drivers come from analytics, never from counting leaderboard rows.
      await expect(kpiValues(page).nth(3)).toHaveText("2");
      await expect(kpis(page)).not.toContainText("+");
      expect(lastRequest(state, leaderboardPath)?.searchParams.get("limit")).toBe("5");
      // The review queue lives in Needs attention on My overview.
      await expect(
        page.getByRole("region", { name: /^(Review Queue|Очередь проверки)$/ }),
      ).toHaveCount(0);
    },
  );

  test(
    "marks the viewer's place in the leaderboard",
    browserCase(["@functional"]),
    async ({ page }) => {
      const state = await mockDashboardRoutes(page, { leaderboardViewer: "offPage" });
      await page.goto("/account/company");
      await loaded(page);
      const board = leaderboardCard(page);
      await expect(board.locator("tbody").first().locator("tr")).toHaveCount(5);
      await expect(board).not.toContainText("Fictional Driver 006");
      // Below the top five the own place follows in a separate row.
      const own = board.locator(".dashboard-leaderboard-self tr");
      await expect(own).toHaveCount(1);
      await expect(own.locator("td")).toHaveText([
        "14",
        "Fictional Yukon Member · you",
        "4",
        "37,400 km",
      ]);
      await expect(own.getByRole("link")).toHaveAttribute("href", `/account/drivers/${fixtureId}`);
      // Active drivers equal the ranked members behind the place; the place itself is on My
      // overview.
      await expect(kpiValues(page).nth(3)).toHaveText("15");
      await expect(kpis(page)).not.toContainText("My place");
      expect(lastRequest(state, leaderboardPath)?.searchParams.get("limit")).toBe("5");
      await switchLanguage(page, "ru");
      await expect(own.locator("td").nth(1)).toHaveText("Fictional Yukon Member · вы");
      await switchLanguage(page, "en");

      // On the shown page the own row is marked and nothing is appended.
      state.leaderboardViewer = "onPage";
      await page.reload();
      await loaded(page);
      await expect(board.locator("tbody tr")).toHaveCount(3);
      await expect(board.locator(".dashboard-leaderboard-self")).toHaveCount(0);
      await expect(board.locator("tbody tr").nth(2).locator("td").nth(1)).toHaveText(
        "Fictional Yukon Member · you",
      );
      await expect(board.getByText("· you")).toHaveCount(1);
      await expect(kpiValues(page).nth(3)).toHaveText("3");
    },
  );

  test(
    "shows a viewer without a place and unavailable Stage 4 values, never zero",
    browserCase(["@functional"]),
    async ({ page }) => {
      const state = await mockDashboardRoutes(page);
      await page.goto("/account/company");
      await loaded(page);
      await expect(leaderboardCard(page).locator("tbody tr")).toHaveCount(2);
      await expect(leaderboardCard(page).locator(".dashboard-leaderboard-self")).toHaveCount(0);
      await expect(leaderboardCard(page)).not.toContainText("you");

      // An API without the Stage 4 fields: active drivers and their comparison are unavailable;
      // the totals and the average still compare.
      state.stage4 = false;
      await page.reload();
      await loaded(page);
      await expect(kpiValues(page)).toHaveText(["125,430 km", "42", "2,986 km", "Unavailable"]);
      await expect(kpiSubs(page)).toHaveText(["per accepted trip"]);
      await expect(kpiDeltas(page).nth(3)).toHaveText("comparison unavailable");
      await expect(kpiDeltas(page).nth(0)).toHaveText(/^0% vs /);
      await expect(leaderboardCard(page).locator("tbody tr td:first-child")).toHaveText(["1", "2"]);
      await switchLanguage(page, "ru");
      await expect(kpiValues(page).nth(3)).toHaveText("Недоступно");
      await expect(kpiDeltas(page).nth(3)).toHaveText("сравнение недоступно");
    },
  );

  test(
    "reports all time in whole months without dates",
    browserCase(["@functional"]),
    async ({ page }) => {
      await page.clock.setFixedTime(new Date("2026-10-31T22:30:00.000Z"));
      const state = await mockDashboardRoutes(page, {
        filterAware: true,
        leaderboardViewer: "offPage",
      });
      await page.goto("/account/company");
      await loaded(page);
      await expect(breakdownItems(routesCard(page))).toHaveCount(5);
      const interval = chartCard(page).getByRole("group", { name: "Interval", exact: true });
      await expect(interval).toBeVisible();

      const before = state.requests.length;
      await periodSelect(page).selectOption("allTime");
      await expect(periodSelect(page)).toHaveValue("allTime");
      await expect(periodSelect(page).locator("option:checked")).toHaveText("All time");
      // Active drivers equal the ranked members of the same period, as the API guarantees.
      await expect(kpiValues(page)).toHaveText(["1,505,160 km", "504", "2,986 km", "15"]);
      await expect(kpiSubs(page)).toHaveText([
        "ETS2 737,160 km · ATS 768,000 km",
        "ETS2 240 · ATS 264",
        "per accepted trip",
        "Active members: 5",
      ]);
      // No previous period of the same length: no comparison.
      await expect(kpiDeltas(page)).toHaveCount(0);
      await expect(interval).toHaveCount(0);
      await expect(leaderboardCard(page).locator("tbody tr").first()).toContainText("288");
      await expect(breakdownItems(routesCard(page)).first()).toContainText("108 trips");
      await expect(breakdownItems(cargoCard(page)).first()).toContainText("120 trips");
      await expect(sourceCard(page).locator(".dashboard-source-legend li").first()).toContainText(
        "384 trips",
      );

      const after = state.requests.slice(before);
      const allTimeRequests = (path: string) => after.filter((url) => url.pathname === path);
      const [analytics, ...extraAnalytics] = allTimeRequests("/api/v1/analytics/company");
      expect(extraAnalytics).toEqual([]);
      expect(analytics?.search).toBe("?period=all_time&granularity=month");
      const [leaderboard, ...extraLeaderboard] = allTimeRequests("/api/v1/analytics/leaderboard");
      expect(extraLeaderboard).toEqual([]);
      expect(leaderboard?.search).toBe("?period=all_time&limit=5");
      const breakdowns = allTimeRequests(breakdownApi);
      expect(breakdowns.map((url) => url.searchParams.get("dimension"))).toEqual([
        "route",
        "cargo",
        "source",
      ]);
      for (const url of breakdowns) {
        expect(url.searchParams.get("period")).toBe("all_time");
        expect(url.searchParams.has("fromDate")).toBe(false);
        expect(url.searchParams.has("toDateExclusive")).toBe(false);
      }
      expect(state.rejected).toEqual([]);

      // Month buckets, also in the exact table.
      const chart = chartCard(page);
      await chart.getByRole("button", { name: "Table", exact: true }).click();
      const rows = chart.locator("tbody tr");
      await expect(rows).toHaveCount(12);
      await expect(rows.first().getByRole("rowheader").locator("time")).toHaveText("December 2025");
      await expect(rows.last().getByRole("rowheader").locator("time")).toHaveText("November 2026");
      await expect(rows.first()).toContainText("125,430 km");

      // A dated period restores the interval control, the kept daily interval and the dates.
      const restored = state.requests.length;
      await periodSelect(page).selectOption("lastMonth");
      await expect(interval).toBeVisible();
      await expect(interval.getByRole("button", { name: "Daily", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await loaded(page);
      await expect(kpiValues(page).first()).toHaveText("125,430 km");
      await expect(breakdownItems(routesCard(page)).first()).toContainText("9 trips");
      await expect(breakdownItems(cargoCard(page)).first()).toContainText("10 trips");
      await expect(sourceCard(page).locator(".dashboard-source-legend li").first()).toContainText(
        "32 trips",
      );
      const dated = state.requests.slice(restored);
      // The current reads and the comparison with September, all with dates.
      const october = (url: URL) =>
        url.searchParams.get("fromDate") === "2026-10-01" &&
        url.searchParams.get("toDateExclusive") === "2026-11-01";
      const september = (url: URL) =>
        url.searchParams.get("fromDate") === "2026-09-01" &&
        url.searchParams.get("toDateExclusive") === "2026-10-01";
      for (const path of [...periodPaths, breakdownApi]) {
        const requests = dated.filter((url) => url.pathname === path);
        expect(requests.filter(october)).toHaveLength(path === breakdownApi ? 3 : 1);
        expect(requests.filter(september)).toHaveLength(path === analyticsPath ? 1 : 0);
        expect(requests).toHaveLength(path === breakdownApi ? 3 : path === analyticsPath ? 2 : 1);
        for (const url of requests) {
          expect(url.searchParams.has("period")).toBe(false);
          if (path === analyticsPath) expect(url.searchParams.get("granularity")).toBe("day");
        }
      }
      expect(state.rejected).toEqual([]);
    },
  );

  test(
    "rereads all time after a failed timezone on Retry",
    browserCase(["@functional"]),
    async ({ page }) => {
      await page.clock.setFixedTime(new Date("2026-10-31T22:30:00.000Z"));
      const state = await mockDashboardRoutes(page, {
        filterAware: true,
        failures: { stats: 503, analytics: 503 },
      });
      await page.goto("/account/company");
      const alert = page.getByRole("alert").filter({ hasText: "Failed to load dashboard data" });
      await expect(alert).toBeVisible();
      await periodSelect(page).selectOption("allTime");
      await expect
        .poll(() =>
          state.requests.filter(
            (url) =>
              url.pathname === "/api/v1/analytics/company" &&
              url.searchParams.get("period") === "all_time",
          ),
        )
        .toHaveLength(1);
      await expect(alert).toBeVisible();

      // The zone changes from the UTC fallback to Moscow, but all time has no dates: Retry must
      // still refetch every all-time read, once.
      delete state.failures.stats;
      delete state.failures.analytics;
      state.hold("stats");
      const before = state.requests.length;
      await alert.getByRole("button", { name: "Retry", exact: true }).click();
      await expect.poll(() => requestsTo(state, statsPath).length).toBe(2);
      state.release("stats");
      await expect(kpiValues(page).first()).toHaveText("1,505,160 km");
      await expect(breakdownItems(routesCard(page))).toHaveCount(5);
      await expect(page.getByRole("alert")).toHaveCount(0);
      const reads = (path: string, dimension: string | null) =>
        state.requests
          .slice(before)
          .filter(
            (url) =>
              url.pathname === path &&
              (dimension === null || url.searchParams.get("dimension") === dimension),
          )
          .map((url) => url.searchParams.get("period"));
      const all = [
        ["/api/v1/analytics/company", null],
        ["/api/v1/analytics/leaderboard", null],
        [breakdownApi, "route"],
        [breakdownApi, "cargo"],
        [breakdownApi, "source"],
      ] as const;
      for (const [path, dimension] of all)
        await expect.poll(() => reads(path, dimension)).toEqual(["all_time"]);
      // Exactly once: nothing follows.
      await page.waitForTimeout(300);
      for (const [path, dimension] of all) expect(reads(path, dimension)).toEqual(["all_time"]);
      expect(state.rejected).toEqual([]);
    },
  );

  test(
    "requests the breakdowns per dimension, game and language",
    browserCase(["@functional"]),
    async ({ page }) => {
      await page.clock.setFixedTime(new Date("2026-10-31T22:30:00.000Z"));
      const state = await mockDashboardRoutes(page);
      await page.goto("/account/company");
      await loaded(page);
      const routes = routesCard(page);
      const cargo = cargoCard(page);
      const source = sourceCard(page);
      await expect(breakdownItems(routes)).toHaveCount(5);
      await expect(breakdownItems(cargo)).toHaveCount(5);
      await expect(source.locator(".dashboard-source-legend li")).toHaveCount(2);
      for (const dimension of ["route", "cargo", "source"] as const) {
        const [url, ...extra] = breakdownRequests(state, dimension);
        expect(extra).toEqual([]);
        expect(url?.searchParams.get("locale")).toBe("en");
        expect(url?.searchParams.get("fromDate")).toBe("2026-11-01");
        expect(url?.searchParams.get("toDateExclusive")).toBe("2026-12-01");
        expect(url?.searchParams.get("limit")).toBe(dimension === "source" ? null : "5");
        expect(url?.searchParams.has("game")).toBe(false);
      }

      // Ranked items with game chips for all games, exact counts, remainder and undetermined.
      await expect(breakdownItems(routes)).toHaveText([
        "ATSSeattle → Portland9 trips",
        "ETS2Munich · München → Warszawa8 trips",
        "ATSPhoenix → Seattle6 trips",
        "ETS2Praha → Wien5 trips",
        "ETS2Saint Petersburg → Nizhny Novgorod3 trips",
      ]);
      await expect(routes.locator(".dashboard-breakdown-extra li")).toHaveText([
        "Other routes8 trips",
        "City not recognized3 trips",
      ]);
      await expect(routes.locator(".dashboard-breakdown-bar")).toHaveCount(5);
      await expect(breakdownItems(cargo)).toHaveText([
        "ATSLumber10 trips",
        "ETS2Medical Vaccines7 trips",
        "ATSGravel6 trips",
        "ETS2Steel Coils5 trips",
        "ETS2Fresh Fish4 trips",
      ]);
      await expect(cargo.locator(".dashboard-breakdown-extra li")).toHaveText([
        "Other cargo6 trips",
        "Cargo not recognized4 trips",
      ]);
      await expect(source.locator(".dashboard-source-legend li")).toHaveText([
        "Telemetry32 trips76%",
        "Manual reports10 trips24%",
      ]);
      await expect(source.locator(".dashboard-source-bar > span")).toHaveCount(2);
      await expect(source).toContainText("Manual reports count after review in Dispatch.");
      for (const card of [routes, cargo, source])
        await expect(card).not.toContainText(/[0-9a-f]{8}-[0-9a-f]{4}-/);
      await expect(page.locator(".dashboard-breakdowns [aria-busy='true']")).toHaveCount(0);

      // Russian labels for the interface language, with the English-fallback marker.
      await switchLanguage(page, "ru");
      await expect(breakdownItems(routes).nth(3)).toHaveText(
        "ETS2Прага → Wien · Показано на английском5 рейсов",
      );
      await expect(breakdownItems(routes).nth(1)).toHaveText(
        "ETS2Мюнхен · München → Варшава8 рейсов",
      );
      await expect(breakdownItems(routes).nth(4)).toContainText("3 рейса");
      await expect(breakdownItems(cargo).nth(2)).toHaveText(
        "ATSGravel · Показано на английском6 рейсов",
      );
      await expect(source.locator(".dashboard-source-legend li").first()).toHaveText(
        /^Телеметрия32 рейса76\s%$/,
      );
      await expect(source).toContainText(
        "Ручные отчёты попадают в статистику после проверки в Диспетчерской.",
      );
      for (const dimension of ["route", "cargo", "source"] as const)
        await expect
          .poll(
            () =>
              breakdownRequests(state, dimension).filter(
                (url) => url.searchParams.get("locale") === "ru",
              ).length,
          )
          .toBe(1);

      // One game: requests with the game, no chips.
      await gameGroup(page).getByRole("button", { name: "ETS2", exact: true }).click();
      await expect(breakdownItems(routes)).toHaveCount(3);
      await expect(routes.locator(".dashboard-game")).toHaveCount(0);
      await expect(cargo.locator(".dashboard-game")).toHaveCount(0);
      await expect(source.locator(".dashboard-source-legend li")).toHaveText([
        /^Телеметрия17 рейсов85\s%$/,
        /^Ручные отчёты3 рейса15\s%$/,
      ]);
      await expect(breakdownItems(cargo)).toHaveCount(3);
      for (const dimension of ["route", "cargo", "source"] as const)
        expect(
          breakdownRequests(state, dimension).filter(
            (url) => url.searchParams.get("game") === "ets2",
          ),
        ).toHaveLength(1);
      expect(state.rejected).toEqual([]);
    },
  );

  test(
    "shows empty breakdowns without bars or shares",
    browserCase(["@functional"]),
    async ({ page }) => {
      const state = await mockDashboardRoutes(page);
      state.emptyBreakdowns = true;
      await page.goto("/account/company");
      await loaded(page);
      for (const card of [routesCard(page), cargoCard(page), sourceCard(page)]) {
        await expect(
          card.getByText("No accepted trips in the selected period", { exact: true }),
        ).toBeVisible();
        await expect(card).not.toContainText(/0\s?%/);
        await expect(card.getByRole("button")).toHaveCount(0);
        await expect(card).toHaveAttribute("aria-busy", "false");
      }
      await expect(page.locator(".dashboard-source-bar, .dashboard-breakdown-bar")).toHaveCount(0);
      await expect(kpiValues(page).first()).toHaveText("125,430 km");
      await switchLanguage(page, "ru");
      await expect(
        sourceCard(page).getByText("За выбранный период нет принятых рейсов", { exact: true }),
      ).toBeVisible();
    },
  );

  test(
    "shows unrecognized trips without an empty list and as a third source part",
    browserCase(["@functional"]),
    async ({ page }) => {
      const state = await mockDashboardRoutes(page);
      state.unrecognizedBreakdowns = true;
      await page.goto("/account/company");
      await loaded(page);
      // Every route and cargo trip is unrecognized: no ranked list, bars or empty state.
      for (const [card, text] of [
        [routesCard(page), "City not recognized42 trips"],
        [cargoCard(page), "Cargo not recognized42 trips"],
      ] as const) {
        await expect(card.locator(".dashboard-breakdown-extra li")).toHaveText([text]);
        await expect(card.locator(".dashboard-breakdown-list")).toHaveCount(0);
        await expect(card.locator("ol, .dashboard-breakdown-bar")).toHaveCount(0);
        await expect(card.locator(".dashboard-empty")).toHaveCount(0);
      }
      // The neutral third part follows telemetry and manual reports, with its count and share.
      const source = sourceCard(page);
      await expect(source.locator(".dashboard-source-legend li")).toHaveText([
        "Telemetry29 trips69%",
        "Manual reports10 trips24%",
        "Source not recognized3 trips7%",
      ]);
      await expect(source.locator(".dashboard-source-bar > span")).toHaveClass([
        "dashboard-source-ets2telemetry",
        "dashboard-source-manual",
        "dashboard-source-undetermined",
      ]);
      await switchLanguage(page, "ru");
      await expect(source.locator(".dashboard-source-legend li").last()).toHaveText(
        /^Источник не определён3 рейса7\s%$/,
      );
      await expect(routesCard(page).locator(".dashboard-breakdown-extra li")).toHaveText(
        "Город не распознан42 рейса",
      );
      expect(state.rejected).toEqual([]);
    },
  );

  test(
    "keeps a failing or loading breakdown inside its card",
    browserCase(["@functional"]),
    async ({ page }) => {
      const state = await mockDashboardRoutes(page, { failures: { breakdownRoute: 503 } });
      await page.goto("/account/company");
      await loaded(page);
      const routes = routesCard(page);
      await expect(
        routes.getByText("Could not load popular routes", { exact: true }),
      ).toBeVisible();
      await expect(breakdownItems(cargoCard(page))).toHaveCount(5);
      await expect(sourceCard(page).locator(".dashboard-source-legend li")).toHaveCount(2);
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(kpiValues(page).first()).toHaveText("125,430 km");
      await expect(leaderboardCard(page).locator("tbody tr")).toHaveCount(2);

      // A failed Retry keeps focus on Retry; a successful one hands it to the heading.
      const retry = routes.getByRole("button", { name: "Retry", exact: true });
      const reads = breakdownRequests(state, "route").length;
      await retry.focus();
      await page.keyboard.press("Enter");
      await expect.poll(() => breakdownRequests(state, "route").length).toBe(reads + 1);
      await page.waitForTimeout(300);
      await expect(retry).toBeFocused();
      delete state.failures.breakdownRoute;
      await page.keyboard.press("Enter");
      await expect(breakdownItems(routes)).toHaveCount(5);
      await expect(routes.getByRole("heading", { level: 2 })).toBeFocused();

      // A held card is busy on its own while the others and the page status line are idle.
      state.hold("breakdownCargo");
      await page.reload();
      await loaded(page);
      await expect(cargoCard(page)).toHaveAttribute("aria-busy", "true");
      await expect(cargoCard(page).locator(".dashboard-skeleton")).toHaveCount(5);
      await expect(breakdownItems(routesCard(page))).toHaveCount(5);
      await expect(sourceCard(page)).toHaveAttribute("aria-busy", "false");
      await expect(loadingStatus(page)).toHaveCount(0);
      state.release("breakdownCargo");
      await expect(breakdownItems(cargoCard(page))).toHaveCount(5);
      await expect(cargoCard(page)).toHaveAttribute("aria-busy", "false");

      state.failures.breakdownSource = 403;
      await page.reload();
      await loaded(page);
      await expect(
        sourceCard(page).getByText("No access to trip statistics", { exact: true }),
      ).toBeVisible();
      await expect(sourceCard(page).getByRole("button")).toHaveCount(0);
    },
  );
});
