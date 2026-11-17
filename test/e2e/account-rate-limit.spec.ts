import type { Page, Route } from "@playwright/test";
import { alphaId } from "./support/drivers-fixtures.ts";
import { mockDriverRoutes } from "./support/drivers-ui.ts";
import { browserCase, expect, test } from "./support/fixtures.ts";

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
async function open(page: Page, locale: "en" | "ru" = "en") {
  await page.addInitScript((value) => localStorage.setItem("vtc.locale", value), locale);
  await page.clock.setFixedTime(new Date("2026-11-15T12:00:00Z"));
  await page.goto(`/account/drivers/${alphaId}`);
}
const profilePath = /^\/api\/v1\/members\/[^/]+$/;
const selfPath = /^\/api\/v1\/me$/;
const title = (page: Page) => page.getByRole("heading", { level: 1 });

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
  "a driver profile that stays limited stops after one retry and shows its error state",
  browserCase(["@functional"]),
  async ({ page }) => {
    await mockDriverRoutes(page);
    const profile = await limit(page, profilePath, Number.POSITIVE_INFINITY);
    await open(page);
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
    expect(profile.requests).toBe(2);
    // A bounded absence check: no automatic loop follows the single retry.
    await page.waitForTimeout(2500);
    expect(profile.requests).toBe(2);
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
