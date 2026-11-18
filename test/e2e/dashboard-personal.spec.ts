import type { Locator, Page, TestInfo } from "@playwright/test";
import { fixtureId } from "../../apps/web/src/features/account/fixtures.ts";
import { formatQuantity } from "../../apps/web/src/shared/formatting.ts";
import { makeRecentTripsFixture, ownTrips, upcomingEvent } from "./support/dashboard-fixtures.ts";
import {
  type DashboardMockState,
  levelIdAts,
  levelIdEts2,
  mockDashboardRoutes,
} from "./support/dashboard-ui.ts";
import { browserCase, expect, test } from "./support/fixtures.ts";
import { switchLanguage } from "./support/locale.ts";

// My overview (VTC-159, /account/dashboard): the member's own month with its place and
// comparison, qualification, nearest convoy, daily distance and latest trips. All requests are
// mocked; 08:00 UTC on 12 November 2026 is 11:00 in the Moscow reporting timezone.
const now = "2026-11-12T08:00:00.000Z";
const month = { fromDate: "2026-11-01", toDateExclusive: "2026-12-01" };
/** The same elapsed days of October: 1–12 October. */
const previous = { fromDate: "2026-10-01", toDateExclusive: "2026-10-13" };
const monthKey = `${month.fromDate}..${month.toDateExclusive}`;
const previousKey = `${previous.fromDate}..${previous.toDateExclusive}`;
const memberPath = `/api/v1/members/${fixtureId}/analytics`;
const statsPath = "/api/v1/public/company-stats";
// Capabilities of a dispatcher: no own trips to submit and no convoy responses.
const dispatcher = ["company.read", "trips.read_own_private", "trips.review"];
const withoutCompanyRead = ["events.respond", "trips.read_own_private", "trips.submit_own"];

const text = {
  en: {
    title: "My overview",
    subtitle: "November 2026 · only your trips and progress",
    attention: "Needs attention",
    month: "My November",
    values: ["1,284 km", "6", "3 of 3 in the company"],
    more: /^320 km more than 1\s?–\s?12 October$/,
    chart: "My daily distance",
    trips: "Recent trips",
    allTrips: "All my trips",
    decisions: ["Accepted", "Pending review", "Rejected", "Not checked yet", "Accepted"],
    companyLink: "Company overview · statistics of all drivers",
    unavailable: "Unavailable",
  },
  ru: {
    title: "Мой обзор",
    subtitle: "Ноябрь 2026 · только ваши рейсы и прогресс",
    attention: "Нужно сделать",
    month: "Мой ноябрь",
    values: [formatQuantity("1284000", "km", "ru"), "6", "3 из 3 в компании"],
    more: /^На 320 км больше, чем 1–12 октября$/,
    chart: "Мой пробег по дням",
    trips: "Последние рейсы",
    allTrips: "Все мои рейсы",
    decisions: ["Принят", "На проверке", "Отклонён", "Ещё не проверен", "Принят"],
    companyLink: "Обзор компании · статистика всех водителей",
    unavailable: "Недоступно",
  },
} as const;
type Locale = keyof typeof text;

const title = (page: Page) => page.getByRole("heading", { level: 1 });
const region = (page: Page, name: RegExp) => page.getByRole("region", { name });
const attentionCard = (page: Page) => region(page, /^(Needs attention|Нужно сделать)$/);
const monthCard = (page: Page) => region(page, /^(My (November|October)|Мой (ноябрь|октябрь))$/);
const monthValues = (page: Page) => monthCard(page).locator("dd.dashboard-month-value");
const monthDelta = (page: Page) => monthCard(page).locator(".dashboard-month-delta");
const qualificationCard = (page: Page) => region(page, /^(My Qualification|Моя квалификация)$/);
const eventCard = (page: Page) => region(page, /^(Upcoming Event|Ближайшее мероприятие)$/);
const chartCard = (page: Page) => region(page, /^(My daily distance|Мой пробег по дням)$/);
const tripsCard = (page: Page) => region(page, /^(Recent trips|Последние рейсы)$/);
const startCard = (page: Page) =>
  region(page, /^(Your trips and progress will appear here|Здесь появятся ваши рейсы и прогресс)$/);
const companyLink = (page: Page) => page.locator("a.dashboard-company-link");
const gameGroup = (page: Page) => page.getByRole("group", { name: /^(Game|Игра)$/ });
const loadingStatus = (page: Page) =>
  page
    .getByRole("status")
    .filter({ hasText: /^(Loading dashboard data\.\.\.|Загрузка данных дашборда\.\.\.)$/ });

async function box(locator: Locator) {
  const value = await locator.boundingBox();
  if (!value) throw new Error("ELEMENT_NOT_RENDERED");
  return value;
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function capture(page: Page, info: TestInfo, name: string, viewport = false) {
  await page.evaluate(() => document.fonts.ready);
  await noOverflow(page);
  if (viewport) await page.screenshot({ path: info.outputPath(`${name}-viewport.png`) });
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
}
const requestsTo = (state: DashboardMockState, path: string) =>
  state.requests.filter((url) => url.pathname === path);
const memberReads = (state: DashboardMockState, range = month, game: string | null = null) =>
  requestsTo(state, memberPath).filter(
    (url) =>
      url.searchParams.get("fromDate") === range.fromDate &&
      url.searchParams.get("toDateExclusive") === range.toDateExclusive &&
      url.searchParams.get("game") === game,
  );

/** Opens My overview at the fixed time; `setup` changes the mock before the first request. */
async function open(
  page: Page,
  options: {
    setup?: (state: DashboardMockState) => void;
    capabilities?: string[];
    /** Options of the mock itself, such as missing qualifications. */
    mock?: Parameters<typeof mockDashboardRoutes>[1];
    time?: string;
    locale?: Locale;
  } = {},
) {
  await page.clock.setFixedTime(new Date(options.time ?? now));
  const state = await mockDashboardRoutes(page, {
    ...options.mock,
    ...(options.capabilities ? { capabilities: options.capabilities } : {}),
  });
  state.tripLocale = options.locale ?? "en";
  options.setup?.(state);
  await page.goto("/account/dashboard");
  if (options.locale === "ru") await switchLanguage(page, "ru");
  return state;
}
/** The month, its comparison and the latest trips are loaded. */
async function settled(page: Page) {
  await expect(monthValues(page).first()).not.toBeEmpty();
  await expect(monthCard(page)).toHaveAttribute("aria-busy", "false");
  await expect(tripsCard(page).getByRole("listitem")).toHaveCount(5);
  await expect(loadingStatus(page)).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
}
/** A previous October with 3 trips and 964 km: this month is 320 km more. */
function withPreviousMonth(state: DashboardMockState) {
  state.memberAnalyticsByRange[previousKey] = { acceptedTrips: 3, actualDistanceM: "964000" };
}
function withReturnedTrip(state: DashboardMockState) {
  state.summary = {
    ...state.summary,
    tripsNeedingFixes: {
      count: 1,
      items: [
        {
          tripId: "05600000-0000-4000-8000-000000000003",
          latestReturnReason: "Fictional missing delivery screenshot",
        },
      ],
    },
  };
}

for (const locale of ["en", "ru"] as const) {
  test(
    `P1 shows the own month, progress, convoy and latest trips (${locale})`,
    browserCase(["@layout"]),
    async ({ page }, info) => {
      const t = text[locale];
      const state = await open(page, {
        locale,
        setup: (s) => {
          withPreviousMonth(s);
          withReturnedTrip(s);
          s.leaderboardViewer = "onPage";
        },
      });
      await settled(page);
      await expect(title(page)).toHaveText(t.title);
      await expect(title(page)).toHaveCount(1);
      await expect(page.getByText(t.subtitle, { exact: true })).toBeVisible();

      // Needs attention first, then the own month with the place among ranked members.
      await expect(attentionCard(page).getByRole("heading", { level: 2 })).toHaveText(t.attention);
      await expect(monthCard(page).getByRole("heading", { level: 2 })).toHaveText(t.month);
      await expect(monthValues(page)).toHaveText([...t.values]);
      await expect(monthDelta(page)).toHaveText(t.more);
      await expect(monthDelta(page)).toHaveClass(/dashboard-delta-up/);
      const place = monthCard(page).getByRole("link", { name: /^(in the company|в компании)$/ });
      await expect(place).toHaveAttribute("href", "/account/company");

      await expect(qualificationCard(page).getByRole("heading", { level: 3 })).toHaveCount(2);
      await expect(eventCard(page).getByRole("heading", { level: 3 })).toHaveText(
        upcomingEvent.title,
      );
      await expect(chartCard(page).getByRole("heading", { level: 2 })).toHaveText(t.chart);

      // Own trips: no driver name, the game and the company decision of each.
      const trips = tripsCard(page);
      await expect(trips.getByRole("heading", { level: 2 })).toHaveText(t.trips);
      await expect(trips.locator(".dashboard-game")).toHaveText([
        "ETS2",
        "ATS",
        "ETS2",
        "ATS",
        "ETS2",
      ]);
      await expect(trips.locator(".trips-decision")).toHaveText([...t.decisions]);
      await expect(trips).not.toContainText("Fictional Yukon Member");
      await expect(trips.getByRole("listitem").nth(1)).toContainText(t.unavailable);
      await expect(trips.getByRole("listitem").nth(1)).not.toContainText(/\b0 (km|км)/);
      if (locale === "ru")
        await expect(trips.getByRole("listitem").nth(2)).toContainText(
          "Прага → Wien · Показано на английском",
        );
      for (const trip of ownTrips(locale))
        await expect(trips.locator(`a[href="/account/trips/${trip.id}"]`)).toBeVisible();
      await expect(trips.getByRole("link", { name: t.allTrips, exact: true })).toHaveAttribute(
        "href",
        "/account/trips",
      );

      // Company statistics live on the company overview.
      await expect(region(page, /^(Key metrics|Ключевые показатели)$/)).toHaveCount(0);
      await expect(region(page, /^(Driver Leaderboard|Таблица лидеров)$/)).toHaveCount(0);
      await expect(page.locator(".dashboard-breakdowns")).toHaveCount(0);
      expect(requestsTo(state, "/api/v1/analytics/company")).toEqual([]);

      const blocks = [
        attentionCard(page),
        monthCard(page),
        qualificationCard(page),
        eventCard(page),
        chartCard(page),
        tripsCard(page),
      ];
      const [attention, own, qualification, event, chart, recent] = await Promise.all(
        blocks.map((block) => box(block)),
      );
      if (!attention || !own || !qualification || !event || !chart || !recent)
        throw new Error("BLOCKS_NOT_RENDERED");
      const phone = info.project.name === "mobile-chromium";
      if (phone) {
        // P4: one column in DOM order with the company card before the chart.
        await expect(companyLink(page)).toBeVisible();
        await expect(companyLink(page)).toHaveText(t.companyLink);
        await expect(companyLink(page).locator("svg")).toHaveClass(/lucide-chevron-right/);
        await expect(companyLink(page)).toHaveAttribute("href", "/account/company");
        const link = await box(companyLink(page));
        const order = [attention, own, qualification, event, link, chart, recent];
        for (const [index, rect] of order.entries())
          if (index > 0) expect(rect.y, `block ${index}`).toBeGreaterThan(order[index - 1]?.y ?? 0);
        for (const rect of order) expect(rect.x + rect.width).toBeLessThanOrEqual(391);
      } else {
        await expect(companyLink(page)).toBeHidden();
        expect(attention.y).toBeLessThan(own.y);
        if (info.project.name === "desktop-chromium") {
          // One row of the month, qualification and convoy, then the chart beside the trips.
          for (const rect of [qualification, event])
            expect(Math.abs(rect.y - own.y)).toBeLessThanOrEqual(1);
          expect(own.x).toBeLessThan(qualification.x);
          expect(qualification.x).toBeLessThan(event.x);
          expect(Math.abs(chart.y - recent.y)).toBeLessThanOrEqual(1);
          expect(chart.x).toBeLessThan(recent.x);
          expect(chart.width).toBeGreaterThan(recent.width);
        }
        expect(chart.y).toBeGreaterThanOrEqual(own.y + own.height - 0.5);
      }
      await capture(page, info, `personal-${locale}`, true);
    },
  );
}

test(
  "P1 reads only the own month, its comparison, place and trips for the selected game",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await open(page);
    await settled(page);
    // The zone first, then the month reads.
    const statsIndex = state.requests.findIndex((url) => url.pathname === statsPath);
    const firstMember = state.requests.findIndex((url) => url.pathname === memberPath);
    expect(statsIndex).toBeGreaterThanOrEqual(0);
    expect(firstMember).toBeGreaterThan(statsIndex);
    const reads = requestsTo(state, memberPath);
    expect(reads.map((url) => url.search)).toEqual([
      "?fromDate=2026-11-01&toDateExclusive=2026-12-01&granularity=day",
      "?fromDate=2026-10-01&toDateExclusive=2026-10-13&granularity=day",
    ]);
    const [leaderboard, ...extra] = requestsTo(state, "/api/v1/analytics/leaderboard");
    expect(extra).toEqual([]);
    expect(leaderboard?.search).toBe("?fromDate=2026-11-01&toDateExclusive=2026-12-01&limit=5");
    const [trips, ...moreTrips] = requestsTo(state, "/api/v1/trips");
    expect(moreTrips).toEqual([]);
    expect(trips?.search).toBe("?scope=mine&limit=5&order=completion_desc&locale=en");
    expect(requestsTo(state, "/api/v1/analytics/company")).toEqual([]);
    expect(requestsTo(state, "/api/v1/analytics/company/breakdown")).toEqual([]);
    expect(requestsTo(state, "/api/v1/me/trip-status-summary")).toHaveLength(1);
    expect(requestsTo(state, "/api/v1/me/qualifications")).toHaveLength(1);
    // Previous October equals this month in the default fixture.
    await expect(monthValues(page)).toHaveText(["1,284 km", "6", "Not ranked in the company"]);
    await expect(monthDelta(page)).toHaveText(/^The same as 1\s?–\s?12 October$/);

    await gameGroup(page).getByRole("button", { name: "ETS2", exact: true }).click();
    await expect(monthValues(page)).toHaveText(["812 km", "4", "Not ranked in the company"]);
    expect(memberReads(state, month, "ets2")).toHaveLength(1);
    expect(memberReads(state, previous, "ets2")).toHaveLength(1);
    await expect
      .poll(() =>
        requestsTo(state, "/api/v1/analytics/leaderboard").map((url) =>
          url.searchParams.get("game"),
        ),
      )
      .toEqual([null, "ets2"]);
    await expect
      .poll(() => requestsTo(state, "/api/v1/trips").map((url) => url.searchParams.get("game")))
      .toEqual([null, "ets2"]);
    // The qualification shows the selected game only, from the same read.
    const qualification = qualificationCard(page);
    await expect(qualification.getByRole("heading", { level: 3 })).toHaveCount(1);
    await expect(qualification.getByText("European Driver II", { exact: true })).toBeVisible();
    await expect(qualification.getByText("Pacific Driver III", { exact: true })).toHaveCount(0);
    expect(requestsTo(state, "/api/v1/me/qualifications")).toHaveLength(1);
    // The status summary behind the start steps never follows the game.
    expect(requestsTo(state, "/api/v1/me/trip-status-summary")).toHaveLength(1);
    expect(requestsTo(state, "/api/v1/analytics/company")).toEqual([]);
    expect(state.rejected).toEqual([]);
  },
);

test(
  "P1 states a smaller, equal, missing or unavailable previous month without zero values",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await open(page);
    await settled(page);
    for (const [previousMonth, sentence, tone] of [
      [
        { acceptedTrips: 9, actualDistanceM: "1604000" },
        /^320 km less than 1\s?–\s?12 October$/,
        "down",
      ],
      [
        { acceptedTrips: 6, actualDistanceM: "1284000" },
        /^The same as 1\s?–\s?12 October$/,
        "same",
      ],
      [
        { acceptedTrips: 0, actualDistanceM: "0" },
        /^No accepted trips in 1\s?–\s?12 October$/,
        "noBaseline",
      ],
      [503, /^Comparison unavailable$/, "unavailable"],
    ] as const) {
      state.memberAnalyticsByRange[previousKey] = previousMonth;
      await page.reload();
      await settled(page);
      await expect(monthDelta(page)).toHaveText(sentence);
      await expect(monthDelta(page)).toHaveClass(new RegExp(`dashboard-delta-${tone}`));
      // The month itself stays exact; a failed comparison is no block error.
      await expect(monthValues(page)).toHaveText(["1,284 km", "6", "Not ranked in the company"]);
      await expect(monthCard(page).getByRole("button")).toHaveCount(0);
    }
    await switchLanguage(page, "ru");
    await expect(monthDelta(page)).toHaveText("Сравнение недоступно");
    state.memberAnalyticsByRange[previousKey] = { acceptedTrips: 9, actualDistanceM: "1604000" };
    state.tripLocale = "ru";
    await page.reload();
    await switchLanguage(page, "ru");
    await expect(monthDelta(page)).toHaveText(/^На 320 км меньше, чем 1–12 октября$/);
  },
);

test(
  "P1 gives a new member start steps and others neutral blocks",
  browserCase(["@functional"]),
  async ({ page }, info) => {
    const state = await open(page, { setup: (s) => (s.emptyStatusSummary = true) });
    const start = startCard(page);
    await expect(start).toBeVisible();
    await expect(
      start.getByRole("list", { name: "How to start" }).getByRole("listitem"),
    ).toHaveCount(2);
    await expect(start.getByRole("link", { name: "Get a token", exact: true })).toHaveAttribute(
      "href",
      "/account/connections",
    );
    await expect(start.getByRole("link", { name: "New report", exact: true })).toHaveAttribute(
      "href",
      "/account/reports/new",
    );
    // The steps replace the statistics blocks.
    for (const block of [
      monthCard(page),
      qualificationCard(page),
      eventCard(page),
      chartCard(page),
      tripsCard(page),
    ])
      await expect(block).toHaveCount(0);
    await capture(page, info, "personal-start-en");
    await switchLanguage(page, "ru");
    await expect(
      startCard(page).getByRole("link", { name: "Получить токен", exact: true }),
    ).toBeVisible();
    await expect(
      startCard(page).getByRole("link", { name: "Новый отчёт", exact: true }),
    ).toBeVisible();
    await capture(page, info, "personal-start-ru");
    expect(state.rejected).toEqual([]);

    // A dispatcher without own trips: no steps, calm blocks, never a reading error. The chosen
    // language stays in the browser, so switch back first.
    await switchLanguage(page, "en");
    const other = await open(page, {
      capabilities: dispatcher,
      setup: (s) => {
        s.emptyStatusSummary = true;
        s.ownTrips = makeRecentTripsFixture([]);
        s.memberAnalyticsByRange[monthKey] = { acceptedTrips: 0, actualDistanceM: "0" };
        s.memberAnalyticsByRange[previousKey] = { acceptedTrips: 0, actualDistanceM: "0" };
      },
    });
    await expect(monthValues(page)).toHaveText(["0 km", "0", "Not ranked in the company"]);
    await expect(monthDelta(page)).toHaveText(/^No accepted trips in 1\s?–\s?12 October$/);
    await expect(startCard(page)).toHaveCount(0);
    await expect(
      qualificationCard(page).getByText("No qualification assigned", { exact: true }),
    ).toHaveCount(2);
    await expect(tripsCard(page).getByText("You have no trips yet", { exact: true })).toBeVisible();
    await expect(
      chartCard(page).getByText("No data to display in chart for the selected period"),
    ).toBeVisible();
    await expect(eventCard(page).getByText("Going: 8", { exact: true })).toBeVisible();
    await expect(eventCard(page).getByRole("group", { name: "Your response" })).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(requestsTo(other, "/api/v1/me/trip-status-summary")).toEqual([]);
    expect(requestsTo(other, "/api/v1/me/qualifications")).toEqual([]);
    // Without events.respond the convoy reads no own response.
    expect(other.requests.filter((url) => url.pathname.endsWith("/my-response"))).toEqual([]);
  },
);

test(
  "P1 waits for the reporting timezone and falls back to UTC months",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await open(page, { setup: (s) => s.hold("stats") });
    await expect.poll(() => requestsTo(state, statsPath).length).toBe(1);
    await expect(title(page)).toHaveText("My overview");
    await expect(loadingStatus(page)).toHaveCount(1);
    for (const path of [
      memberPath,
      "/api/v1/analytics/leaderboard",
      "/api/v1/trips",
      "/api/v1/me/qualifications",
      "/api/v1/me/trip-status-summary",
    ])
      expect(requestsTo(state, path), path).toEqual([]);
    await expect(monthCard(page)).toHaveCount(0);
    state.release("stats");
    await settled(page);
    expect(memberReads(state)).toHaveLength(1);
    expect(memberReads(state, previous)).toHaveLength(1);

    // 01:30 on 1 November in Moscow, but without the zone the UTC October counts.
    const fallback = await open(page, {
      time: "2026-10-31T22:30:00.000Z",
      setup: (s) => (s.failures.stats = 503),
    });
    await expect(monthCard(page).getByRole("heading", { level: 2 })).toHaveText("My October");
    await expect(page.getByText("October 2026 · only your trips and progress")).toBeVisible();
    await settled(page);
    expect(requestsTo(fallback, memberPath).map((url) => url.search)).toEqual([
      "?fromDate=2026-10-01&toDateExclusive=2026-11-01&granularity=day",
      // 31 days of October against the 30 of September.
      "?fromDate=2026-09-01&toDateExclusive=2026-10-01&granularity=day",
    ]);
    await expect(monthDelta(page)).toHaveText(/^The same as 1\s?–\s?30 September$/);
    await expect(page.getByRole("alert")).toHaveCount(0);
  },
);

test(
  "P1 keeps a failed month inside its blocks and retries it in place",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await open(page, { setup: (s) => (s.failures.memberAnalytics = 503) });
    const card = monthCard(page);
    await expect(card.getByText("Could not load your month statistics")).toBeVisible();
    await expect(chartCard(page).getByText("Could not load your month statistics")).toBeVisible();
    // The place, qualification, convoy and trips come from their own reads.
    await expect(monthValues(page)).toHaveText(["Not ranked in the company"]);
    await expect(monthDelta(page)).toHaveCount(0);
    await expect(tripsCard(page).getByRole("listitem")).toHaveCount(5);
    await expect(qualificationCard(page).getByRole("heading", { level: 3 })).toHaveCount(2);
    await expect(eventCard(page).getByRole("heading", { level: 3 })).toHaveText(
      upcomingEvent.title,
    );
    await expect(page.locator(".dashboard-error")).toHaveCount(0);

    const reads = requestsTo(state, memberPath).length;
    const retry = card.getByRole("button", { name: "Retry", exact: true });
    await retry.focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => requestsTo(state, memberPath).length).toBeGreaterThan(reads);
    await page.waitForTimeout(300);
    await expect(retry).toBeFocused();
    delete state.failures.memberAnalytics;
    await page.keyboard.press("Enter");
    await expect(monthValues(page)).toHaveText(["1,284 km", "6", "Not ranked in the company"]);
    await expect(card.getByRole("heading", { level: 2 })).toBeFocused();
    await expect(chartCard(page).getByText("Could not load your month statistics")).toHaveCount(0);
    // The stats read had not failed, so Retry did not reread the zone.
    expect(requestsTo(state, statsPath)).toHaveLength(1);

    // The chart has its own Retry; a successful retry from it focuses the chart heading.
    const again = await open(page, { setup: (s) => (s.failures.memberAnalytics = 503) });
    const chartRetry = chartCard(page).getByRole("button", { name: "Retry", exact: true });
    await expect(chartRetry).toBeVisible();
    delete again.failures.memberAnalytics;
    await chartRetry.focus();
    await page.keyboard.press("Enter");
    await expect(chartCard(page).getByText("Could not load your month statistics")).toHaveCount(0);
    await expect(chartCard(page).getByRole("heading", { level: 2 })).toBeFocused();
    await expect(monthValues(page)).toHaveText(["1,284 km", "6", "Not ranked in the company"]);

    // Without company.read nothing of the page is requested.
    const forbidden = await open(page, { capabilities: withoutCompanyRead });
    await expect(page.getByText("You do not have access to company statistics.")).toBeVisible();
    await expect(title(page)).toHaveText("My overview");
    await expect(gameGroup(page)).toHaveCount(0);
    for (const path of [
      memberPath,
      statsPath,
      "/api/v1/analytics/leaderboard",
      "/api/v1/trips",
      "/api/v1/me/qualifications",
      "/api/v1/me/trip-status-summary",
    ])
      expect(requestsTo(forbidden, path), path).toEqual([]);
  },
);

test(
  "P1 and P1b fill a wide desktop screen in both languages",
  browserCase(["@layout", "@viewport-desktop"]),
  async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, {
      setup: (s) => {
        withPreviousMonth(s);
        withReturnedTrip(s);
        s.leaderboardViewer = "onPage";
        s.companyAnalyticsByRange["2026-10-01..2026-10-13"] = {
          acceptedTrips: 40,
          actualDistanceM: "116000000",
          activeDrivers: 2,
        };
      },
    });
    for (const locale of ["en", "ru"] as const) {
      if (locale === "ru") await switchLanguage(page, "ru");
      await expect(title(page)).toHaveText(text[locale].title);
      await settled(page);
      await capture(page, info, `p1-1440-${locale}`, true);
    }
    // The chosen language stays in the browser: Russian first, then English.
    await page.goto("/account/company");
    for (const locale of ["ru", "en"] as const) {
      if (locale === "en") await switchLanguage(page, "en");
      await expect(title(page)).toHaveText(locale === "en" ? "Company overview" : "Обзор компании");
      await expect(
        region(page, /^(Driver Leaderboard|Таблица лидеров)$/).locator("tbody tr"),
      ).toHaveCount(3);
      await expect(page.locator("dd.dashboard-kpi-delta").first()).not.toBeEmpty();
      await expect(loadingStatus(page)).toHaveCount(0);
      await capture(page, info, `p1b-1440-${locale}`, true);
    }
  },
);

test(
  "P1 shows the assigned qualification names and progress instead of UUIDs",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await open(page);
    const widget = qualificationCard(page);
    await expect(widget.getByText("European Driver II", { exact: true })).toBeVisible();
    await expect(widget.getByText("Pacific Driver III", { exact: true })).toBeVisible();
    await expect(widget).not.toContainText(levelIdEts2);
    await expect(widget).not.toContainText(levelIdAts);
    await expect(widget).toContainText("15 / 20");
    await expect(widget.getByRole("link", { name: "All qualifications" })).toBeVisible();
    // Both games come from one read of my qualifications.
    expect(requestsTo(state, "/api/v1/me/qualifications")).toHaveLength(1);
    await switchLanguage(page, "ru");
    const russian = qualificationCard(page);
    await expect(russian.getByText("European Driver II", { exact: true })).toBeVisible();
    await expect(russian.getByText("Pacific Driver III", { exact: true })).toBeVisible();
  },
);

for (const [qualifications, calm, other] of [
  ["unavailable", "Progress unavailable", "No qualification assigned"],
  ["missing", "No qualification assigned", "Progress unavailable"],
  ["failed", "Progress unavailable", "No qualification assigned"],
] as const) {
  test(
    `P1 shows a calm state when my qualifications are ${qualifications}`,
    browserCase(["@functional"]),
    async ({ page }) => {
      await open(page, {
        ...(qualifications === "failed"
          ? { setup: (s) => (s.failures.progress = 503) }
          : { mock: { qualifications } }),
      });
      const widget = qualificationCard(page);
      // One calm line per game, never a level, progress or an error alert.
      await expect(widget.getByText(calm, { exact: true })).toHaveCount(2);
      await expect(widget.getByText(other, { exact: true })).toHaveCount(0);
      await expect(widget.getByRole("alert")).toHaveCount(0);
      await expect(widget).not.toContainText(levelIdEts2);
      await expect(widget).not.toContainText("15 / 20");
      await expect(monthValues(page).first()).toHaveText("1,284 km");
    },
  );
}
