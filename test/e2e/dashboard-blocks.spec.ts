import type { Locator, Page, TestInfo } from "@playwright/test";
import {
  recentTrips,
  makeRecentTripsFixture,
  nextUpcomingEvent,
  overviewNow,
  recentTripItems,
  upcomingEvent,
} from "./support/dashboard-fixtures.ts";
import { type DashboardMockState, mockDashboardRoutes } from "./support/dashboard-ui.ts";
import { browserCase, expect, test } from "./support/fixtures.ts";
import { switchLanguage } from "./support/locale.ts";

// Overview recent company trips and nearest convoy RSVP blocks (VTC-055), all requests mocked.
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const text = {
  en: {
    allTrips: "All company trips",
    unavailable: "Unavailable",
    unknown: "Unknown",
    phoenix: "Phoenix",
    fallback: "English fallback",
    countdown: "in 3 d 4 h",
    going: "Going: 8",
    goingButton: "Going",
    cantGoButton: "Can't go",
    reason: "Private decline reason",
    hint: "Required. Only you, the director and deputies see the reason; all members see that you can't attend.",
    save: "Save response",
    reasonRequired: "Enter a reason to decline.",
    unanswered: "You have not answered. Leaving it unanswered has no penalty.",
    declined: "You can't attend. Only you, the director and deputies see your reason.",
    tripsEmpty: "No accepted company trips yet",
    tripsError: "Could not load recent company trips",
    tripsForbidden: "No access to company trips",
    noUpcoming: "No scheduled convoys",
    allEvents: "All events",
    eventError: "Could not load the upcoming event",
    countUnavailable: "Count unavailable",
    responseUnavailable: "Your response is unavailable",
    retry: "Retry",
  },
  ru: {
    allTrips: "Все рейсы компании",
    unavailable: "Недоступно",
    unknown: "Неизвестно",
    phoenix: "Финикс",
    fallback: "Показано на английском",
    countdown: "через 3 д 4 ч",
    going: "Поедут: 8",
    goingButton: "Поеду",
    cantGoButton: "Не смогу",
    reason: "Личная причина отказа",
    hint: "Обязательно. Причину видят только вы, директор и заместители; что вы не сможете — видят все участники ВТК.",
    save: "Сохранить ответ",
    reasonRequired: "Укажите причину отказа.",
    unanswered: "Вы ещё не ответили. Можно оставить без ответа — штрафов нет.",
    declined: "Вы не сможете. Причину видят только вы, директор и заместители.",
    tripsEmpty: "У компании пока нет принятых рейсов",
    tripsError: "Не удалось загрузить последние рейсы компании",
    tripsForbidden: "Нет доступа к рейсам компании",
    noUpcoming: "Нет запланированных конвоев",
    allEvents: "Все мероприятия",
    eventError: "Не удалось загрузить ближайшее мероприятие",
    countUnavailable: "Число участников недоступно",
    responseUnavailable: "Ваш ответ недоступен",
    retry: "Повторить попытку",
  },
} as const;
type Locale = keyof typeof text;

const eventCard = (page: Page) =>
  page.getByRole("region", { name: /^(Upcoming Event|Ближайшее мероприятие)$/ });
const tripsCard = (page: Page) =>
  page.getByRole("region", { name: /^(Recent company trips|Последние рейсы компании)$/ });
const leaderboardCard = (page: Page) =>
  page.getByRole("region", { name: /^(Driver Leaderboard|Таблица лидеров)$/ });
const chartCard = (page: Page) =>
  page.getByRole("region", { name: /^(Distance Dynamics|Динамика пробега)$/ });
const qualificationCard = (page: Page) =>
  page.getByRole("region", { name: /^(My Qualification|Моя квалификация)$/ });
const reviewCard = (page: Page) =>
  page.getByRole("region", { name: /^(Review Queue|Очередь проверки)$/ });
const responseGroup = (page: Page) =>
  eventCard(page).getByRole("group", { name: /^(Your response|Ваш ответ)$/ });
const going = (page: Page) => responseGroup(page).getByRole("button", { name: /^(Going|Поеду)$/ });
const cantGo = (page: Page) =>
  responseGroup(page).getByRole("button", { name: /^(Can't go|Не смогу)$/ });
const reasonBox = (page: Page) =>
  eventCard(page).getByRole("textbox", {
    name: /^(Private decline reason|Личная причина отказа)$/,
  });
const saveButton = (page: Page) =>
  eventCard(page).getByRole("button", { name: /^(Save response|Сохранить ответ)$/ });
const eventHeading = (page: Page) => eventCard(page).getByRole("heading", { level: 2 });
const tripsHeading = (page: Page) => tripsCard(page).getByRole("heading", { level: 2 });
const tripLink = (page: Page, id: string) =>
  tripsCard(page).locator(`a[href="/account/trips/${id}"]`);
const countdownChip = (page: Page) => eventCard(page).locator(".dashboard-countdown");

async function box(locator: Locator) {
  const value = await locator.boundingBox();
  if (!value) throw new Error("ELEMENT_NOT_RENDERED");
  return value;
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function capture(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
}
/** Live regions and busy markers inside a block; idle blocks have none. */
async function liveRegions(root: Locator) {
  return root.locator('[role="status"], [role="alert"], [aria-live]').count();
}
/** Words that wrap mid-word (a word whose text range spans several lines). */
async function brokenWords(root: Locator) {
  return root.evaluate((element) => {
    const broken: string[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (const match of (node.textContent ?? "").matchAll(/[^\s-]+/g)) {
        const range = document.createRange();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        const lines = new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top)));
        if (lines.size > 1) broken.push(match[0]);
      }
    }
    return broken;
  });
}
/** Visible interactive targets shorter than `min` pixels. */
async function smallTargets(root: Locator, min: number) {
  return root.evaluate(
    (element, limit) =>
      Array.from(element.querySelectorAll<HTMLElement>("a, button, textarea"))
        .filter((node) => node.getClientRects().length > 0)
        .filter((node) => node.getBoundingClientRect().height < limit)
        .map((node) => node.textContent?.trim() || node.tagName),
    min,
  );
}
/** Keyboard activation on desktop/tablet, a tap on the touch project. */
async function activate(page: Page, target: Locator, touch: boolean) {
  if (touch) await target.tap();
  else {
    await target.focus();
    await page.keyboard.press("Space");
  }
}
/**
 * Activates an aria-disabled control, which Playwright's actionability checks treat as disabled:
 * a key press on desktop/tablet, a click dispatched on the control itself on touch (a forced
 * tap could land on another element). The page must ignore it.
 */
async function activateBlocked(page: Page, target: Locator, touch: boolean) {
  if (touch) await target.dispatchEvent("click");
  else {
    await target.focus();
    await page.keyboard.press("Space");
  }
}
/** Mock state of each page opened by `open`, for the locale helpers. */
const mocks = new WeakMap<Page, DashboardMockState>();
/**
 * Switches the UI language. The switch stays in the browser, so the mock is told to render
 * catalog labels for the same locale.
 */
async function toLocale(page: Page, locale: Locale) {
  const state = mocks.get(page);
  if (state) state.tripLocale = locale;
  if (locale === "ru") await switchLanguage(page, "ru");
}
/** Reloads and restores the tested language (the account fixture prefers English). */
async function reload(page: Page, locale: Locale) {
  await page.reload();
  await toLocale(page, locale);
}
const isTouch = (info: TestInfo) => info.project.name === "mobile-chromium";
const count = (state: DashboardMockState, pattern: RegExp) =>
  state.requests.filter((url) => pattern.test(url.pathname + url.search)).length;

/** Fixed time (timers keep running): the convoy starts in 3 d 4 h 30 min. */
async function open(
  page: Page,
  setup?: (state: DashboardMockState) => void,
  capabilities?: string[],
) {
  await page.clock.setFixedTime(new Date(overviewNow));
  const state = await mockDashboardRoutes(page, capabilities ? { capabilities } : {});
  mocks.set(page, state);
  setup?.(state);
  await page.goto("/account/dashboard");
  await expect(leaderboardCard(page).getByRole("link", { name: "AlphaDriver" })).toBeVisible();
  return state;
}
/** Both blocks loaded with data, the own response ready. */
async function settled(page: Page, respond = true) {
  await expect(eventCard(page).getByRole("heading", { level: 3 })).toHaveText(upcomingEvent.title);
  await expect(tripsCard(page).getByRole("listitem")).toHaveCount(5);
  if (respond) await expect(going(page)).toHaveAttribute("aria-pressed", "false");
  await page.evaluate(() => document.fonts.ready);
}
async function inLocale(page: Page, locale: Locale) {
  await toLocale(page, locale);
  await settled(page);
}

for (const locale of ["en", "ru"] as const) {
  test(
    `B1 shows recent company trips and the nearest convoy (${locale})`,
    browserCase(["@layout"]),
    async ({ page }, info) => {
      await open(page);
      await inLocale(page, locale);
      const t = text[locale];
      const trips = tripsCard(page);
      const rows = trips.getByRole("listitem");
      for (const [index, trip] of recentTripItems.entries()) {
        await expect(tripLink(page, trip.id)).toBeVisible();
        await expect(rows.nth(index)).toContainText(trip.owner.nickname);
      }
      await expect(trips.getByRole("link", { name: t.allTrips, exact: true })).toHaveAttribute(
        "href",
        "/account/trips?scope=company",
      );
      await expect(rows.nth(1)).toContainText(t.unavailable);
      await expect(rows.nth(1)).not.toContainText(/\b0 (km|км)/);
      // Only the Russian rendering lacks a name (Wien) and falls back to English.
      if (locale === "ru")
        await expect(tripLink(page, recentTripItems[2]?.id ?? "")).toContainText(
          `Прага → Wien · ${t.fallback}`,
        );
      else await expect(trips).not.toContainText(t.fallback);
      await expect(tripLink(page, recentTripItems[3]?.id ?? "")).toContainText(
        `${t.unknown} → ${t.phoenix}`,
      );
      await expect(tripLink(page, recentTripItems[0]?.id ?? "")).not.toContainText(t.fallback);
      // Accepted-only list: no status badges.
      await expect(trips.locator(".badge")).toHaveCount(0);

      const event = eventCard(page);
      await expect(event.getByRole("heading", { level: 3 })).toHaveText(upcomingEvent.title);
      await expect(countdownChip(page)).toHaveText(t.countdown);
      await expect(event.getByText(t.going, { exact: true })).toBeVisible();
      await expect(event.getByText(upcomingEvent.route)).toBeVisible();
      await expect(event.getByRole("link", { name: /^(Details|Подробнее)$/ })).toHaveAttribute(
        "href",
        `/account/events/${upcomingEvent.id}`,
      );
      await expect(responseGroup(page).getByRole("button")).toHaveText([
        t.goingButton,
        t.cantGoButton,
      ]);
      await expect(event.getByText(t.unanswered)).toBeVisible();

      expect(await liveRegions(trips)).toBe(0);
      expect(await liveRegions(event)).toBe(0);
      await expect(trips).toHaveAttribute("aria-busy", "false");
      await noOverflow(page);
      expect(await brokenWords(trips)).toEqual([]);
      expect(await brokenWords(event)).toEqual([]);
      await expect(page.getByText(/Достаточно суров|Yukon\?/)).toHaveCount(0);
      await capture(page, info, `blocks-content-${locale}`);
    },
  );
}

test(
  "B2 keeps the first desktop screen and places both blocks",
  browserCase(["@layout"]),
  async ({ page }, info) => {
    await open(page);
    for (const locale of ["en", "ru"] as const) {
      await inLocale(page, locale);
      const chart = await box(chartCard(page));
      const qualification = await box(qualificationCard(page));
      const leaderboard = await box(leaderboardCard(page));
      const event = await box(eventCard(page));
      const trips = await box(tripsCard(page));
      if (info.project.name === "desktop-chromium") {
        expect(await page.evaluate(() => scrollY)).toBe(0);
        // 4px spare below the 800px fold for wider Linux fonts.
        expect(qualification.y + qualification.height).toBeLessThanOrEqual(796);
        const headings = await qualificationCard(page).getByRole("heading", { level: 3 }).all();
        expect(headings).toHaveLength(2);
        for (const heading of headings) {
          const rect = await box(heading);
          expect(rect.y + rect.height).toBeLessThanOrEqual(796);
        }
        for (const target of [
          leaderboardCard(page).getByRole("heading", { level: 2 }),
          leaderboardCard(page).locator("tbody tr").first(),
        ]) {
          const rect = await box(target);
          expect(rect.y + rect.height).toBeLessThanOrEqual(796);
        }
        const grid = await box(page.locator(".dashboard-grid"));
        expect(trips.y).toBeGreaterThanOrEqual(leaderboard.y + leaderboard.height - 0.5);
        expect(trips.y).toBeGreaterThanOrEqual(event.y + event.height - 0.5);
        expect(Math.abs(trips.x - grid.x)).toBeLessThanOrEqual(2);
        expect(Math.abs(trips.width - grid.width)).toBeLessThanOrEqual(2);
        expect(event.x).toBeGreaterThan(leaderboard.x);
      } else {
        expect(chart.y).toBeLessThan(qualification.y);
        expect(qualification.y).toBeLessThan(leaderboard.y);
        expect(leaderboard.y).toBeLessThan(event.y);
        expect(event.y).toBeLessThan(trips.y);
      }
      await capture(page, info, `blocks-layout-${locale}`);
    }
  },
);

test(
  "B3 Going sends one conditional PUT and shows the confirmed response",
  browserCase(["@functional"]),
  async ({ page }, info) => {
    const touch = isTouch(info);
    const state = await open(page);
    await settled(page);
    const counts = count(state, /\/response-counts$/);
    state.hold("rsvp");
    await activate(page, going(page), touch);
    await expect.poll(() => state.commands.length).toBe(1);
    await expect(going(page)).toHaveAttribute("aria-disabled", "true");
    await expect(cantGo(page)).toHaveAttribute("aria-disabled", "true");
    await expect(eventCard(page).getByText("Saving response…", { exact: true })).toBeVisible();
    if (!touch) await expect(going(page)).toBeFocused();
    // A second activation while the command is in flight sends nothing.
    await activateBlocked(page, going(page), touch);
    await page.waitForTimeout(300);
    expect(state.commands).toHaveLength(1);
    state.release("rsvp");

    await expect(going(page)).toHaveAttribute("aria-pressed", "true");
    await expect(cantGo(page)).toHaveAttribute("aria-pressed", "false");
    await expect(going(page)).not.toHaveAttribute("aria-disabled", "true");
    await expect(eventCard(page).getByText("You are participating.")).toBeVisible();
    await expect(eventCard(page).getByText("Going: 9", { exact: true })).toBeVisible();
    expect(count(state, /\/response-counts$/)).toBeGreaterThan(counts);
    await expect(eventCard(page).getByRole("status")).toHaveCount(1);
    await expect(eventCard(page).getByRole("status")).toHaveText("Response saved.");
    if (!touch) await expect(going(page)).toBeFocused();

    const [command] = state.commands;
    expect(command?.url.pathname).toBe(`/api/v1/events/${upcomingEvent.id}/my-response`);
    expect(command?.body).toEqual({ response: "participating" });
    expect(command?.headers["if-match"]).toBe('"v1"');
    expect(command?.headers["x-csrf-token"]).toBe("NONFUNCTIONAL_FIXTURE");
    expect(command?.headers["idempotency-key"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(state.commands).toHaveLength(1);
    // The next interaction clears the confirmation.
    await activate(page, cantGo(page), touch);
    await expect(eventCard(page).getByRole("status")).toHaveCount(0);
    await capture(page, info, "blocks-going-en");
  },
);

for (const locale of ["en", "ru"] as const) {
  test(
    `B4 Can't go requires a reason and saves the decline (${locale})`,
    browserCase(["@layout"]),
    async ({ page }, info) => {
      const touch = isTouch(info);
      const t = text[locale];
      const state = await open(page);
      await inLocale(page, locale);
      await activate(page, cantGo(page), touch);
      await expect(reasonBox(page)).toBeVisible();
      await expect(reasonBox(page)).toHaveAccessibleDescription(t.hint);
      await expect(reasonBox(page)).toHaveAttribute("maxlength", "2048");
      await expect(cantGo(page)).toHaveAttribute("aria-pressed", "true");
      await expect(going(page)).toHaveAttribute("aria-pressed", "false");
      if (!touch) await expect(cantGo(page)).toBeFocused();
      // Local draft state only: the confirmed response line is unchanged.
      await expect(eventCard(page).getByText(t.unanswered)).toBeVisible();

      await saveButton(page).click();
      await expect(eventCard(page).getByRole("alert")).toHaveText(t.reasonRequired);
      expect(state.commands).toHaveLength(0);
      await noOverflow(page);
      expect(await brokenWords(eventCard(page))).toEqual([]);
      await capture(page, info, `blocks-decline-form-${locale}`);

      await reasonBox(page).fill("  Fictional schedule clash  ");
      await saveButton(page).click();
      await expect(reasonBox(page)).toHaveCount(0);
      expect(state.commands).toHaveLength(1);
      expect(state.commands[0]?.body).toEqual({
        response: "declined",
        reason: "Fictional schedule clash",
      });
      await expect(cantGo(page)).toBeFocused();
      await expect(cantGo(page)).toHaveAttribute("aria-pressed", "true");
      await expect(eventCard(page).getByText(t.declined)).toBeVisible();
      await expect(eventCard(page).getByRole("alert")).toHaveCount(0);
      await capture(page, info, `blocks-declined-${locale}`);

      // Reopening prefills the saved reason; Cancel closes the draft and returns focus.
      await activate(page, cantGo(page), touch);
      await expect(reasonBox(page)).toHaveValue("Fictional schedule clash");
      await eventCard(page)
        .getByRole("button", { name: /^(Cancel|Отмена)$/ })
        .click();
      await expect(reasonBox(page)).toHaveCount(0);
      await expect(cantGo(page)).toBeFocused();
      expect(state.commands).toHaveLength(1);
    },
  );
}

test(
  "B5 reuses the key for an unchanged retry and handles conflicts and rate limits",
  browserCase(["@functional"]),
  async ({ page }, info) => {
    const touch = isTouch(info);
    const state = await open(page);
    await settled(page);

    state.rsvpOutcomes.push("abort");
    await activate(page, going(page), touch);
    await expect(eventCard(page).getByRole("alert")).toContainText("The result is unknown.");
    await expect(going(page)).toHaveAttribute("aria-pressed", "false");
    await activate(page, going(page), touch);
    await expect(going(page)).toHaveAttribute("aria-pressed", "true");
    expect(state.commands).toHaveLength(2);
    const [aborted, retried] = state.commands;
    expect(retried?.headers["idempotency-key"]).toBe(aborted?.headers["idempotency-key"]);
    expect(retried?.body).toEqual(aborted?.body);

    // A conflict refreshes the own response and keeps the typed reason.
    await activate(page, cantGo(page), touch);
    await reasonBox(page).fill("Fictional workshop shift");
    const reads = count(state, /\/my-response$/);
    const nearest = count(state, /^\/api\/v1\/me\/upcoming-event$/);
    state.rsvpOutcomes.push({ status: 409 });
    await saveButton(page).click();
    await expect(eventCard(page).getByRole("alert")).toContainText("The event changed.");
    await expect.poll(() => count(state, /\/my-response$/)).toBeGreaterThan(reads);
    // The event itself may have been cancelled or rescheduled, so the overview rereads it.
    await expect
      .poll(() => count(state, /^\/api\/v1\/me\/upcoming-event$/))
      .toBeGreaterThan(nearest);
    await expect(reasonBox(page)).toHaveValue("Fictional workshop shift");

    // A rate limit keeps the wait outside the alert and blocks every response control.
    state.rsvpOutcomes.push({ status: 429, retryAfter: 30 });
    await saveButton(page).click();
    await expect(eventCard(page).getByRole("alert")).toContainText("Too many requests.");
    await expect(eventCard(page).getByRole("alert")).not.toContainText("Try again in");
    await expect(eventCard(page).getByText("Try again in 30 seconds.")).toBeVisible();
    for (const control of [going(page), cantGo(page), saveButton(page)])
      await expect(control).toHaveAttribute("aria-disabled", "true");
    const sent = state.commands.length;
    await activateBlocked(page, saveButton(page), touch);
    await activateBlocked(page, going(page), touch);
    await page.waitForTimeout(300);
    expect(state.commands).toHaveLength(sent);
    await capture(page, info, "blocks-rate-limited-en");
  },
);

test(
  "B6 shows counts without response controls to members who cannot respond",
  browserCase(["@functional"]),
  async ({ page }, info) => {
    const state = await open(page, undefined, ["company.read", "trips.review"]);
    await settled(page, false);
    await expect(eventCard(page).getByText("Going: 8", { exact: true })).toBeVisible();
    await expect(eventCard(page).getByRole("link", { name: "Details" })).toHaveAttribute(
      "href",
      `/account/events/${upcomingEvent.id}`,
    );
    await expect(responseGroup(page)).toHaveCount(0);
    await expect(eventCard(page).getByRole("button")).toHaveCount(0);
    await expect(reviewCard(page)).toBeVisible();
    await page.waitForTimeout(300);
    expect(count(state, /\/my-response$/)).toBe(0);
    await capture(page, info, "blocks-read-only-en");
  },
);

for (const locale of ["en", "ru"] as const) {
  test(
    `B7 recent trips loading, empty and forbidden states stay in the block (${locale})`,
    browserCase(["@functional"]),
    async ({ page }, info) => {
      const t = text[locale];
      const state = await open(page, (s) => s.hold("companyTrips"));
      await toLocale(page, locale);
      const trips = tripsCard(page);
      await expect(trips).toHaveAttribute("aria-busy", "true");
      await expect(trips.locator(".dashboard-skeleton")).toHaveCount(5);
      expect(await liveRegions(trips)).toBe(0);
      await expect(leaderboardCard(page).locator("tbody tr")).toHaveCount(2);
      await capture(page, info, `blocks-trips-loading-${locale}`);

      state.companyTrips = makeRecentTripsFixture([]);
      state.release("companyTrips");
      await expect(trips.getByText(t.tripsEmpty, { exact: true })).toBeVisible();
      await expect(trips).toHaveAttribute("aria-busy", "false");
      await capture(page, info, `blocks-trips-empty-${locale}`);

      state.failures.companyTrips = 403;
      await reload(page, locale);
      await expect(tripsCard(page).getByText(t.tripsForbidden, { exact: true })).toBeVisible();
      await expect(tripsCard(page).getByRole("button")).toHaveCount(0);
      await expect(leaderboardCard(page).locator("tbody tr")).toHaveCount(2);
      await expect(page.getByRole("alert")).toHaveCount(0);
      await capture(page, info, `blocks-trips-forbidden-${locale}`);
    },
  );

  test(
    `B7 recent trips error retries in place (${locale})`,
    browserCase(["@functional"]),
    async ({ page }, info) => {
      const t = text[locale];
      const state = await open(page, (s) => {
        s.failures.companyTrips = 503;
      });
      await toLocale(page, locale);
      const retry = tripsCard(page).getByRole("button", { name: t.retry, exact: true });
      await expect(tripsCard(page).getByText(t.tripsError, { exact: true })).toBeVisible();
      await expect(leaderboardCard(page).locator("tbody tr")).toHaveCount(2);
      await expect(page.getByRole("alert")).toHaveCount(0);
      await capture(page, info, `blocks-trips-error-${locale}`);

      // A failed retry keeps focus on Retry; a successful one hands it to the heading.
      const reads = count(state, /^\/api\/v1\/trips\?scope=company/);
      await retry.focus();
      await page.keyboard.press("Enter");
      await expect.poll(() => count(state, /^\/api\/v1\/trips\?scope=company/)).toBe(reads + 1);
      await page.waitForTimeout(300);
      await expect(retry).toBeFocused();
      delete state.failures.companyTrips;
      await page.keyboard.press("Enter");
      await expect(tripsCard(page).getByRole("listitem")).toHaveCount(5);
      await expect(tripsHeading(page)).toBeFocused();
    },
  );

  test(
    `B7 convoy states stay in the block (${locale})`,
    browserCase(["@functional"]),
    async ({ page }, info) => {
      const t = text[locale];
      const state = await open(page, (s) => {
        s.upcoming = null;
      });
      await toLocale(page, locale);
      const event = eventCard(page);
      await expect(event.getByText(t.noUpcoming, { exact: true })).toBeVisible();
      await expect(event.getByRole("link", { name: t.allEvents, exact: true })).toHaveAttribute(
        "href",
        "/account/events",
      );
      await expect(countdownChip(page)).toHaveCount(0);
      await expect(responseGroup(page)).toHaveCount(0);
      await capture(page, info, `blocks-convoy-none-${locale}`);

      state.upcoming = upcomingEvent;
      state.failures.event = 503;
      await reload(page, locale);
      await expect(eventCard(page).getByText(t.eventError, { exact: true })).toBeVisible();
      await expect(leaderboardCard(page).locator("tbody tr")).toHaveCount(2);
      await capture(page, info, `blocks-convoy-error-${locale}`);
      delete state.failures.event;
      await eventCard(page).getByRole("button", { name: t.retry, exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect(eventCard(page).getByRole("heading", { level: 3 })).toHaveText(
        upcomingEvent.title,
      );
      await expect(eventHeading(page)).toBeFocused();

      state.failures.counts = 503;
      state.failures.myResponse = 503;
      await reload(page, locale);
      await expect(eventCard(page).getByText(t.countUnavailable, { exact: true })).toBeVisible();
      await expect(eventCard(page)).not.toContainText(/(Going|Поедут): 0/);
      await expect(eventCard(page).getByText(t.responseUnavailable, { exact: true })).toBeVisible();
      await expect(responseGroup(page)).toHaveCount(0);
      await expect(leaderboardCard(page).locator("tbody tr")).toHaveCount(2);
      await capture(page, info, `blocks-convoy-partial-${locale}`);
      // A failed retry keeps the unavailable state and focus on Retry, with no toggles between.
      const responseRetry = eventCard(page).getByRole("button", { name: t.retry, exact: true });
      await eventCard(page).evaluate((node) => {
        const seen = { toggles: 0 };
        (window as unknown as { __toggles: typeof seen }).__toggles = seen;
        new MutationObserver(() => {
          if (node.querySelector("fieldset")) seen.toggles += 1;
        }).observe(node, { childList: true, subtree: true });
      });
      const reads = count(state, /\/my-response$/);
      state.hold("myResponse");
      await responseRetry.focus();
      await page.keyboard.press("Enter");
      await expect.poll(() => count(state, /\/my-response$/)).toBe(reads + 1);
      await expect(eventCard(page).getByText(t.responseUnavailable, { exact: true })).toBeVisible();
      await expect(responseRetry).toBeFocused();
      state.release("myResponse");
      await page.waitForTimeout(300);
      await expect(responseRetry).toBeFocused();
      await expect(eventCard(page).getByText(t.responseUnavailable, { exact: true })).toBeVisible();
      expect(
        await page.evaluate(
          () => (window as unknown as { __toggles: { toggles: number } }).__toggles.toggles,
        ),
      ).toBe(0);

      delete state.failures.myResponse;
      await page.keyboard.press("Enter");
      await expect(going(page)).toHaveAttribute("aria-pressed", "false");
      await expect(eventHeading(page)).toBeFocused();
    },
  );
}

test(
  "B7 a later query shows its own state after a successful retry",
  browserCase(["@functional"]),
  async ({ page }) => {
    // Retry succeeds at the first error; the next game's first error is then a 403.
    const state = await open(page, (s) => {
      s.failures.companyTrips = 503;
    });
    const retry = tripsCard(page).getByRole("button", { name: "Retry", exact: true });
    await expect(retry).toBeVisible();
    delete state.failures.companyTrips;
    await retry.focus();
    await page.keyboard.press("Enter");
    await expect(tripsCard(page).getByRole("listitem")).toHaveCount(5);
    state.failures.companyTrips = 403;
    await page
      .getByRole("group", { name: "Game", exact: true })
      .getByRole("button", { name: "ETS2", exact: true })
      .click();
    await expect(tripsCard(page).getByText(text.en.tripsForbidden, { exact: true })).toBeVisible();
    await expect(tripsCard(page).getByRole("button")).toHaveCount(0);
    expect(
      state.requests.some(
        (url) =>
          url.searchParams.get("scope") === "company" && url.searchParams.get("game") === "ets2",
      ),
    ).toBe(true);
  },
);

test(
  "B8 updates the countdown at its boundary and closes responses at the start",
  browserCase(["@functional"]),
  async ({ page }, info) => {
    const start = Date.parse(upcomingEvent.startsAt);
    await page.clock.install({ time: new Date(start - (2 * HOUR + 30 * MINUTE + 20_000)) });
    const state = await mockDashboardRoutes(page);
    await page.goto("/account/dashboard");
    await settled(page);
    await expect(countdownChip(page)).toHaveText("in 2 h 30 min");
    const chipLive = () =>
      countdownChip(page).evaluate(
        (node) =>
          !!node.closest('[role="status"], [role="alert"], [aria-live], [aria-busy="true"]'),
      );
    expect(await chipLive()).toBe(false);
    await page.clock.fastForward(25_000);
    await expect(countdownChip(page)).toHaveText("in 2 h 29 min");
    expect(await chipLive()).toBe(false);

    await going(page).focus();
    await expect(going(page)).toBeFocused();
    const reads = count(state, /^\/api\/v1\/me\/upcoming-event$/);
    state.upcoming = nextUpcomingEvent;
    state.hold("event");
    await page.clock.fastForward(2 * HOUR + 30 * MINUTE);
    await expect(responseGroup(page)).toHaveCount(0);
    await expect(eventHeading(page)).toBeFocused();
    await expect(eventCard(page).getByRole("link", { name: /next convoy/ })).toHaveAttribute(
      "href",
      "/account/events",
    );
    await expect(countdownChip(page)).toHaveCount(0);
    await expect.poll(() => count(state, /^\/api\/v1\/me\/upcoming-event$/)).toBeGreaterThan(reads);
    state.release("event");
    await expect(eventCard(page).getByRole("heading", { level: 3 })).toHaveText(
      nextUpcomingEvent.title,
    );
    await expect(going(page)).toHaveAttribute("aria-pressed", "false");
    await expect(countdownChip(page)).toHaveText("in 6 d 23 h");
    await expect(eventHeading(page)).toBeFocused();
    await capture(page, info, "blocks-next-convoy-en");
  },
);

test(
  "B9 keeps compact targets on fine pointers and 40px targets on touch",
  browserCase(["@layout"]),
  async ({ page }, info) => {
    const touch = isTouch(info);
    const state = await open(page);
    await settled(page);
    const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
    if (touch) expect(coarse).toBe(true);
    const min = coarse ? 40 : 30;
    await activate(page, cantGo(page), touch);
    await expect(reasonBox(page)).toBeVisible();
    expect(await smallTargets(eventCard(page), min)).toEqual([]);
    expect(await smallTargets(tripsCard(page), min)).toEqual([]);

    state.failures.companyTrips = 503;
    state.failures.myResponse = 503;
    await page.reload();
    await expect(tripsCard(page).getByRole("button")).toHaveCount(1);
    await expect(eventCard(page).getByRole("button")).toHaveCount(1);
    expect(await smallTargets(eventCard(page), min)).toEqual([]);
    expect(await smallTargets(tripsCard(page), min)).toEqual([]);
  },
);

test(
  "B10 keeps the desktop Tab order through both blocks",
  browserCase(["@functional"]),
  async ({ page }, info) => {
    await open(page);
    await settled(page);
    const sequence = [
      leaderboardCard(page).getByRole("link", { name: "All drivers" }),
      leaderboardCard(page).getByRole("link", { name: "AlphaDriver" }),
      leaderboardCard(page).getByRole("link", { name: "BetaHauler" }),
      reviewCard(page).getByRole("link", { name: "Go to review" }),
      going(page),
      cantGo(page),
      eventCard(page).getByRole("link", { name: "Details" }),
      tripsCard(page).getByRole("link", { name: "All company trips" }),
      ...recentTripItems.map((trip) => tripLink(page, trip.id)),
      page.getByRole("button", { name: "Show explanations" }),
    ];
    await sequence[0]?.focus();
    for (const [index, target] of sequence.entries()) {
      if (index > 0) await page.keyboard.press("Tab");
      await expect(target).toBeFocused();
    }
  },
);

for (const locale of ["en", "ru"] as const)
  test(
    `the latest trips show a differing canonical city name (${locale})`,
    browserCase(["@layout"]),
    async ({ page }, info) => {
      await open(page, (state) => {
        const trips = recentTrips(locale),
          first = trips[0];
        if (first?.origin) first.origin = { ...first.origin, nameNative: "Krönburg" };
        if (first?.destination)
          first.destination = { ...first.destination, nameNative: first.destination.label };
        state.companyTrips = makeRecentTripsFixture(trips);
      });
      await inLocale(page, locale);
      const link = tripLink(page, recentTrips(locale)[0]?.id ?? "");
      await expect(link).toContainText("· Krönburg →");
      await expect(link.locator("small")).toHaveCount(1);
      await noOverflow(page);
      await capture(page, info, `dashboard-native-${locale}`);
    },
  );
