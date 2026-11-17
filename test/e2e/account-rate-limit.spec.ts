import type { Locator, Page, Route } from "@playwright/test";
import { accountFixture, fixtureId } from "../../apps/web/src/features/account/fixtures.ts";
import { mockDashboardRoutes } from "./support/dashboard-ui.ts";
import { alphaId } from "./support/drivers-fixtures.ts";
import { mockDriverRoutes } from "./support/drivers-ui.ts";
import { browserCase, expect, test } from "./support/fixtures.ts";
import { tripPageId } from "./support/trip-page-fixtures.ts";
import { mockTrips } from "./support/trip-ui.ts";

// A read limited by the server waits for its Retry-After, retries once, then shows a
// clear "too many requests" state. Every response here is a fictional mock.
const limitedResponse = (route: Route) =>
  route.fulfill({
    status: 429,
    headers: { "Retry-After": "1" },
    json: {
      error: { code: "RATE_LIMITED", messageKey: "errors.rate_limited", retryable: false },
      meta: { requestId: "synthetic-rate-limit" },
    },
  });

/** Answers the next `times` GETs matching `path` with 429; later ones reach the mocks. */
async function limit(page: Page, path: RegExp, times: number) {
  const state = { requests: 0, remaining: times };
  await page.route(
    (url) => path.test(url.pathname),
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      state.requests++;
      if (state.remaining <= 0) return route.fallback();
      state.remaining--;
      return limitedResponse(route);
    },
  );
  return state;
}
async function open(page: Page, locale: "en" | "ru" = "en", path = `/account/drivers/${alphaId}`) {
  await page.addInitScript((value) => localStorage.setItem("vtc.locale", value), locale);
  await page.clock.setFixedTime(new Date("2026-11-15T12:00:00Z"));
  await page.goto(path);
}
const profilePath = /^\/api\/v1\/members\/[^/]+$/;
const selfPath = /^\/api\/v1\/me$/;
const title = (page: Page) => page.getByRole("heading", { level: 1 });
const region = (page: Page, name: string | RegExp) =>
  page.getByRole("region", typeof name === "string" ? { name, exact: true } : { name });
/** The rate-limit notice inside `scope` (pages also keep a hidden loading status). */
const noticeIn = (scope: Locator) =>
  scope.getByRole("status").filter({ hasText: /^(Too many requests|Слишком много запросов)/ });
const notice = {
  en: "Too many requests Wait 1 s, then try again.",
  ru: "Слишком много запросов Подождите 1 с и повторите попытку.",
} as const;

test(
  "a driver profile limited once waits for Retry-After and renders after exactly one retry",
  browserCase(["@functional"]),
  async ({ page }) => {
    const mocks = await mockDriverRoutes(page);
    const profile = await limit(page, profilePath, 1);
    await open(page);
    await expect(title(page)).toHaveText("AlphaHauler");
    expect(profile.requests).toBe(2);
    expect(mocks.unexpected).toEqual([]);
  },
);

test(
  "a driver profile that stays limited stops after one retry and explains the wait",
  browserCase(["@functional"]),
  async ({ page }) => {
    await mockDriverRoutes(page);
    const profile = await limit(page, profilePath, Number.POSITIVE_INFINITY);
    await open(page);
    const main = page.getByRole("main");
    // One notice replaces the generic error; the Retry stays and no alert wraps the status.
    await expect(noticeIn(main)).toHaveText(notice.en);
    await expect(main.getByRole("alert")).toHaveCount(0);
    await expect(main.getByText("Failed to load data")).toHaveCount(0);
    const retry = main.getByRole("button", { name: "Retry", exact: true });
    await expect(retry).toBeVisible();
    expect(profile.requests).toBe(2);
    // A bounded absence check: no automatic loop follows the single retry.
    await page.waitForTimeout(2500);
    expect(profile.requests).toBe(2);
    profile.remaining = 0;
    await retry.click();
    await expect(title(page)).toHaveText("AlphaHauler");
    await expect(noticeIn(main)).toHaveCount(0);
  },
);

test(
  "limited driver profile blocks explain the wait beside their Retry",
  browserCase(["@functional"]),
  async ({ page }) => {
    const mocks = await mockDriverRoutes(page);
    const analytics = await limit(
      page,
      /^\/api\/v1\/members\/[^/]+\/analytics$/,
      Number.POSITIVE_INFINITY,
    );
    const trips = await limit(page, /^\/api\/v1\/trips$/, Number.POSITIVE_INFINITY);
    await open(page);
    await expect(title(page)).toHaveText("AlphaHauler");
    for (const name of ["Accepted trips", "Distance by month"]) {
      const block = region(page, name);
      await expect(noticeIn(block)).toHaveText(notice.en);
      await expect(block.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
    }
    const main = page.getByRole("main");
    await expect(main.getByText("Could not load trips.")).toHaveCount(0);
    await expect(main.getByText("Could not load statistics.")).toHaveCount(0);
    await expect(main.getByRole("alert")).toHaveCount(0);
    expect(analytics.requests).toBe(2);
    expect(trips.requests).toBe(2);
    expect(mocks.unexpected).toEqual([]);
  },
);

for (const [locale, text] of [
  [
    "en",
    {
      generic: "Failed to load dashboard data",
      retry: "Retry",
    },
  ],
  [
    "ru",
    {
      generic: "Не удалось загрузить данные дашборда",
      retry: "Повторить попытку",
    },
  ],
] as const)
  test(
    `a company overview that stays limited explains the wait in ${locale} and Retry recovers`,
    browserCase(["@functional"]),
    async ({ page }) => {
      await mockDashboardRoutes(page);
      // The account language from the start: switching it in the page rereads the periods.
      const self = accountFixture(locale);
      self.data.capabilities.push("trips.review");
      await page.route("**/api/v1/me", (route) => route.fulfill({ json: self }));
      const analytics = await limit(
        page,
        /^\/api\/v1\/analytics\/company$/,
        Number.POSITIVE_INFINITY,
      );
      await open(page, locale, "/account/company");
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      const main = page.getByRole("main");
      await expect(noticeIn(main)).toHaveText(notice[locale]);
      // The current and previous period reads, each retried once.
      await expect.poll(() => analytics.requests).toBe(4);
      await expect(main.getByRole("alert")).toHaveCount(0);
      await expect(main.getByText(text.generic)).toHaveCount(0);
      const retry = main.getByRole("button", { name: text.retry, exact: true });
      await expect(retry).toBeVisible();
      expect(analytics.requests).toBe(4);
      analytics.remaining = 0;
      await retry.click();
      await expect(noticeIn(main)).toHaveCount(0);
      await expect(region(page, /^(Driver Leaderboard|Таблица лидеров)$/)).toBeVisible();
    },
  );

test(
  "limited company overview blocks explain the wait beside their Retry",
  browserCase(["@functional"]),
  async ({ page }) => {
    await mockDashboardRoutes(page);
    const leaderboard = await limit(
      page,
      /^\/api\/v1\/analytics\/leaderboard$/,
      Number.POSITIVE_INFINITY,
    );
    const breakdowns = await limit(
      page,
      /^\/api\/v1\/analytics\/company\/breakdown$/,
      Number.POSITIVE_INFINITY,
    );
    await open(page, "en", "/account/company");
    await expect(title(page)).toHaveText("Company overview");
    for (const name of [
      "Driver Leaderboard",
      "Popular routes",
      "Frequent cargo",
      "How trips arrived",
    ]) {
      const block = region(page, name);
      await expect(noticeIn(block)).toHaveText(notice.en);
      await expect(block.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
    }
    const main = page.getByRole("main");
    await expect(main.locator(".dashboard-error")).toHaveCount(0);
    await expect(main.getByRole("alert")).toHaveCount(0);
    for (const generic of [
      "Could not load the leaderboard",
      "Could not load popular routes",
      "Could not load frequent cargo",
      "Could not load trip sources",
    ])
      await expect(main.getByText(generic)).toHaveCount(0);
    // One leaderboard read and three breakdown reads, each retried once.
    expect(leaderboard.requests).toBe(2);
    expect(breakdowns.requests).toBe(6);
  },
);

test(
  "limited My overview blocks explain the wait and keep it while Retry runs",
  browserCase(["@functional"]),
  async ({ page }) => {
    await mockDashboardRoutes(page);
    const member = await limit(
      page,
      new RegExp(`^/api/v1/members/${fixtureId}/analytics$`),
      Number.POSITIVE_INFINITY,
    );
    const trips = await limit(page, /^\/api\/v1\/trips$/, Number.POSITIVE_INFINITY);
    const event = await limit(page, /^\/api\/v1\/me\/upcoming-event$/, Number.POSITIVE_INFINITY);
    await open(page, "en", "/account/dashboard");
    await expect(title(page)).toHaveText("My overview");
    const generic = {
      "My November": "Could not load your month statistics",
      "My daily distance": "Could not load your month statistics",
      "Recent trips": "Could not load your recent trips",
      "Upcoming Event": "Could not load the upcoming event",
    };
    for (const [name, text] of Object.entries(generic)) {
      const block = region(page, name);
      await expect(noticeIn(block)).toHaveText(notice.en);
      await expect(block.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
      await expect(block.getByText(text)).toHaveCount(0);
    }
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
    // The month and its previous period share the member path, each retried once.
    await expect.poll(() => member.requests).toBe(4);
    expect(trips.requests).toBe(2);
    expect(event.requests).toBe(2);

    // While a user Retry waits for Retry-After the block keeps the notice and the focused Retry.
    const card = region(page, "My November");
    const retry = card.getByRole("button", { name: "Retry", exact: true });
    const before = member.requests;
    await retry.focus();
    await page.keyboard.press("Enter");
    await expect
      .poll(() => member.requests, { intervals: [50] })
      .toBeGreaterThanOrEqual(before + 2);
    expect(await card.getByText(generic["My November"]).count()).toBe(0);
    expect(await noticeIn(card).count()).toBe(1);
    await expect.poll(() => member.requests).toBe(before + 4);
    await expect(retry).toBeFocused();
    await expect(noticeIn(card)).toHaveText(notice.en);

    member.remaining = 0;
    await page.keyboard.press("Enter");
    await expect(card.locator("dd.dashboard-month-value")).toHaveText([
      "1,284 km",
      "6",
      "Not ranked in the company",
    ]);
    await expect(card.getByRole("heading", { level: 2 })).toBeFocused();
    await expect(noticeIn(card)).toHaveCount(0);
  },
);

test(
  "a trip page that stays limited explains the wait beside Refresh",
  browserCase(["@functional"]),
  async ({ page }) => {
    await mockTrips(page);
    const trip = await limit(
      page,
      new RegExp(`^/api/v1/trips/${tripPageId}$`),
      Number.POSITIVE_INFINITY,
    );
    await open(page, "en", `/account/trips/${tripPageId}`);
    const main = page.getByRole("main");
    await expect(noticeIn(main)).toHaveText(notice.en);
    await expect(main.getByRole("alert")).toHaveCount(0);
    await expect(main.getByText("Too many requests. Wait before retrying.")).toHaveCount(0);
    const refresh = main.getByRole("button", { name: "Refresh", exact: true });
    await expect(refresh).toBeVisible();
    expect(trip.requests).toBe(2);
    trip.remaining = 0;
    await refresh.click();
    await expect(page.locator(".trip-detail-tiles")).toBeVisible();
    await expect(noticeIn(main)).toHaveCount(0);
  },
);

test(
  "a session check limited once opens the cabinet after one retry",
  browserCase(["@functional"]),
  async ({ page }) => {
    await mockDriverRoutes(page);
    const self = await limit(page, selfPath, 1);
    await open(page);
    await expect(title(page)).toHaveText("AlphaHauler");
    expect(self.remaining).toBe(0);
    expect(self.requests).toBeGreaterThanOrEqual(2);
  },
);

for (const [locale, text] of [
  [
    "en",
    {
      heading: "Session check unavailable",
      title: "Too many requests",
      notice: "Too many requests Wait 1 s, then try again.",
      refresh: "Check again",
    },
  ],
  [
    "ru",
    {
      heading: "Не удалось проверить сессию",
      title: "Слишком много запросов",
      notice: "Слишком много запросов Подождите 1 с и повторите попытку.",
      refresh: "Проверить снова",
    },
  ],
] as const)
  test(
    `a session check that stays limited explains the wait in ${locale} and Check again recovers`,
    browserCase(["@functional"]),
    async ({ page }) => {
      await mockDriverRoutes(page);
      const self = await limit(page, selfPath, Number.POSITIVE_INFINITY);
      await open(page, locale);
      await expect(title(page)).toHaveText(text.heading);
      await expect(page.getByRole("status").filter({ hasText: text.title })).toHaveText(
        text.notice,
      );
      expect(self.requests).toBe(2);
      await page.waitForTimeout(2500);
      expect(self.requests).toBe(2);
      self.remaining = 0;
      await page.getByRole("button", { name: text.refresh, exact: true }).click();
      await expect(title(page)).toHaveText("AlphaHauler");
    },
  );
