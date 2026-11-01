import type { Locator, Page, TestInfo } from "@playwright/test";
import { mockDashboardRoutes } from "./support/dashboard-ui.ts";
import {
  alphaId,
  betaId,
  formerId,
  levelId,
  selfId,
  topId,
  unknownId,
} from "./support/drivers-fixtures.ts";
import { mockDriverRoutes, profileRequests } from "./support/drivers-ui.ts";
import { expect, test } from "./support/fixtures.ts";
import { switchLanguage } from "./support/locale.ts";

const memberCapabilities = [
  "company.read",
  "events.respond",
  "trips.read_own_private",
  "trips.submit_own",
];

async function open(page: Page, memberId: string) {
  // Fixed clock: the rolling window is Dec 2025 – Nov 2026.
  await page.clock.setFixedTime(new Date("2026-11-15T12:00:00Z"));
  await page.goto(`/account/drivers/${memberId}`);
}
const main = (page: Page) => page.getByRole("main");
const kpis = (page: Page) => page.getByRole("region", { name: /^(Driver statistics|Показатели)/ });
const tripsCard = (page: Page) =>
  page.getByRole("region", { name: /^(Accepted trips|Принятые рейсы)$/ });
const qualification = (page: Page, game: "ETS2" | "ATS") =>
  page.getByRole("region", { name: new RegExp(`^${game}( ·|$)`) });
const chartCard = (page: Page) =>
  page.getByRole("region", { name: /^(Distance by month|Пробег по месяцам)$/ });
const gameGroup = (page: Page) => page.getByRole("group", { name: /^(Game|Игра)$/ });
async function loaded(page: Page) {
  await expect(tripsCard(page).getByRole("table")).toBeVisible();
  await expect(kpis(page).getByText("Accepted trips")).toBeVisible();
}
async function box(locator: Locator) {
  const value = await locator.boundingBox();
  if (!value) throw new Error("ELEMENT_NOT_RENDERED");
  return value;
}
async function capture(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
}
/** The table stays inside its card: no column spills into the neighbouring column. */
const tableFits = (card: Locator) =>
  card.evaluate((element) => {
    const table = element.querySelector("table");
    if (!table) return false;
    const style = getComputedStyle(element);
    const right = element.getBoundingClientRect().right - Number.parseFloat(style.paddingRight);
    return table.getBoundingClientRect().right <= right + 0.5;
  });
const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
/** Lines whose text breaks inside a word: a line starts right after a letter of the same word. */
function midWordBreaks(root: Locator, selector: string) {
  return root.evaluate((element, css) => {
    const broken: string[] = [];
    for (const target of Array.from(element.querySelectorAll(css))) {
      const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent ?? "";
        let previousTop: number | null = null;
        for (let index = 0; index < text.length; index += 1) {
          const range = document.createRange();
          range.setStart(node, index);
          range.setEnd(node, index + 1);
          const rect = range.getClientRects()[0];
          if (!rect) continue;
          if (
            previousTop !== null &&
            rect.top > previousTop + 2 &&
            /[\p{L}\p{N}]/u.test(text[index - 1] ?? "") &&
            /[\p{L}\p{N}]/u.test(text[index] ?? "")
          )
            broken.push(text);
          previousTop = rect.top;
        }
      }
    }
    return broken;
  }, selector);
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
});

test.describe("Compact driver profile", () => {
  test("shows identity, statistics, qualification and accepted trips without IDs or faked metrics", async ({
    page,
  }, info) => {
    const state = await mockDriverRoutes(page);
    await open(page, alphaId);
    await loaded(page);

    const header = page.getByRole("main").locator("header.driver-header");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("AlphaHauler");
    for (const text of [
      "Driver",
      "Dispatcher",
      "Active",
      "ETS2 · Driver II",
      "ATS · Highway Driver III",
    ])
      await expect(header.getByText(text, { exact: true })).toBeVisible();
    await expect(header.getByText("You", { exact: true })).toHaveCount(0);

    // KPIs: exact window totals and the current (last) month bucket.
    const strip = kpis(page);
    await expect(strip).toHaveAccessibleName("Driver statistics, last 12 months");
    await expect(strip.getByRole("definition")).toHaveText([
      "139last 12 months",
      "31,836.5 kmlast 12 months",
      "1,482 kmTrips: 5 · November 2026",
    ]);

    // Qualification cards with public progress, ladder and eligibility.
    const ets2 = qualification(page, "ETS2");
    await expect(ets2.getByRole("heading", { level: 2 })).toHaveText("ETS2 · Driver II");
    await expect(ets2.getByText("Next: Driver I")).toBeVisible();
    const ladder = ets2.getByRole("list", { name: "Level ladder" });
    await expect(ladder.locator(".driver-ladder-arrow")).toHaveCount(3);
    for (const arrow of await ladder.locator(".driver-ladder-arrow").all())
      await expect(arrow).toHaveAttribute("aria-hidden", "true");
    expect(await ladder.evaluate((element) => getComputedStyle(element).cursor)).toBe("default");
    await expect(ladder.locator(".driver-ladder-name")).toHaveText([
      "Trainee",
      "Driver III",
      "Driver II",
      "Driver I",
    ]);
    await expect(ets2.locator('[aria-current="step"] .driver-ladder-name')).toHaveText("Driver II");
    await expect(ets2.getByRole("definition")).toHaveText(["41 / 80", "52,300 / 100,000 km"]);
    await expect(ets2.getByText(/Requirements met/)).toHaveCount(0);
    await expect(ets2.getByText("Progress since 20 Aug 2026, 09:00 (UTC)")).toBeVisible();
    const ats = qualification(page, "ATS");
    await expect(ats.getByRole("heading", { level: 2 })).toHaveText("ATS · Highway Driver III");
    await expect(ats.getByText("Next: Highway Driver II")).toBeVisible();
    await expect(ats.getByRole("definition")).toHaveText(["50 / 50", "61,200 / 60,000 km"]);
    await expect(
      ats.getByText("Requirements met — awaiting confirmation by the director or a deputy"),
    ).toBeVisible();
    await expect(
      page.getByText(/^Progress counts accepted trips and actual distance/),
    ).toBeVisible();

    // Trips: only this member's trips from the company window, with its disclosure.
    const trips = tripsCard(page);
    await expect(trips.getByText("Times: UTC")).toBeVisible();
    await expect(trips.getByRole("columnheader")).toHaveText([
      "Counted",
      "Route",
      "Cargo",
      "Source",
      "Distance",
    ]);
    await expect(trips.getByRole("row")).toHaveCount(6);
    await expect(trips.getByRole("link", { name: "Осло → Гётеборг" })).toHaveAttribute(
      "href",
      "/account/trips/55000000-0000-4000-8000-000000000001",
    );
    await expect(
      trips.getByRole("link", { name: "Grand Junction · English name → Шайенн" }),
    ).toBeVisible();
    await expect(trips.getByText("Бумага")).toHaveCount(0);
    await expect(trips.getByText("Telemetry + Manual report")).toBeVisible();
    await expect(trips.getByRole("cell", { name: "Unavailable" })).toHaveCount(1);
    await expect(trips.getByRole("cell", { name: "Unknown" })).toHaveCount(2);
    await expect(
      trips.getByText("Showing this driver's trips among the latest 100 accepted company trips."),
    ).toBeVisible();
    await expect(trips.getByText(/^Pending and rejected reports/)).toBeVisible();

    // Chart: peak summary; the table view shows exact values with the reporting timezone.
    await expect(chartCard(page).getByText("Reporting timezone: Europe/Moscow")).toBeVisible();
    await expect(chartCard(page).getByText("Highest: October 2026, 4,000 km")).toBeVisible();

    const text = (await main(page).innerText()).toLowerCase();
    expect(text).not.toContain(levelId("ets2", "driver_ii"));
    for (const absent of ["average trip", "convoys", "member since", "steam", "truckersmp"])
      expect(text).not.toContain(absent);
    expect(await page.content()).not.toContain("@example.invalid");
    expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain(
      "@example.invalid",
    );
    expect(state.unexpected).toEqual([]);
    await capture(page, info, "driver-profile-en");
  });

  test("requests exactly the profile, rolling analytics, assigned progress/levels and the company window", async ({
    page,
  }) => {
    const state = await mockDriverRoutes(page);
    await open(page, alphaId);
    await loaded(page);
    await expect(qualification(page, "ATS").getByRole("definition").first()).toBeVisible();
    expect(profileRequests(state).sort()).toEqual(
      [
        `/api/v1/members/${alphaId}`,
        `/api/v1/members/${alphaId}/analytics?fromDate=2025-12-01&toDateExclusive=2026-12-01&granularity=month`,
        `/api/v1/members/${alphaId}/qualification-progress?game=ets2`,
        `/api/v1/members/${alphaId}/qualification-progress?game=ats`,
        "/api/v1/qualification-levels?game=ets2&limit=25",
        "/api/v1/qualification-levels?game=ats&limit=25",
        "/api/v1/trips?scope=company&decision=accepted&limit=100",
      ].sort(),
    );
    expect(state.requests.some((url) => url.pathname.startsWith("/api/v1/admin"))).toBe(false);
    expect(state.requests.some((url) => url.searchParams.get("scope") === "review")).toBe(false);
  });

  test("filters by game from the keyboard and refetches only analytics and trips", async ({
    page,
  }) => {
    const state = await mockDriverRoutes(page);
    await open(page, alphaId);
    await loaded(page);
    await expect(qualification(page, "ATS").getByRole("definition").first()).toBeVisible();
    const before = profileRequests(state).length;

    const ats = gameGroup(page).getByRole("button", { name: "ATS", exact: true });
    await ats.focus();
    await page.keyboard.press("Enter");
    await expect(ats).toHaveAttribute("aria-pressed", "true");
    await expect(gameGroup(page).getByRole("button", { name: "All games" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(tripsCard(page).getByRole("row")).toHaveCount(3);
    await expect(kpis(page).getByRole("definition").first()).toHaveText("31last 12 months");
    expect(profileRequests(state).slice(before).sort()).toEqual(
      [
        `/api/v1/members/${alphaId}/analytics?fromDate=2025-12-01&toDateExclusive=2026-12-01&granularity=month&game=ats`,
        "/api/v1/trips?scope=company&decision=accepted&limit=100&game=ats",
      ].sort(),
    );
    await expect(qualification(page, "ETS2")).toHaveCount(0);
    await expect(qualification(page, "ATS")).toBeVisible();
    const header = page.locator("header.driver-header");
    await expect(header.getByText("ETS2 · Driver II", { exact: true })).toBeVisible();
    await expect(header.getByText("ATS · Highway Driver III", { exact: true })).toBeVisible();
    await expect(ats).toBeFocused();
    await expect(
      tripsCard(page).getByText(
        "Showing this driver's trips among the latest 100 accepted ATS company trips.",
      ),
    ).toBeVisible();
  });

  test("caps another member's list at ten and says so even when the window is complete", async ({
    page,
  }) => {
    await mockDriverRoutes(page, { bulkTrips: true, tripsNextCursor: false });
    await open(page, alphaId);
    await loaded(page);
    // Twelve of this member's trips are in the window; ten rows plus the header are shown.
    await expect(tripsCard(page).getByRole("row")).toHaveCount(11);
    await expect(
      tripsCard(page).getByText(
        "Showing the latest 10 of this driver's trips among the latest 100 accepted company trips.",
      ),
    ).toBeVisible();
    await gameGroup(page).getByRole("button", { name: "ATS", exact: true }).click();
    await expect(tripsCard(page).getByRole("row")).toHaveCount(3);
    // Complete window and not truncated: the list is this member's full ATS list, no note.
    await expect(tripsCard(page).getByText(/^Showing/)).toHaveCount(0);
    await switchLanguage(page, "ru");
    await gameGroup(page).getByRole("button", { name: "Все игры" }).click();
    await expect(
      tripsCard(page).getByText(
        "Показаны последние 10 рейсов водителя среди последних 100 принятых рейсов компании.",
      ),
    ).toBeVisible();
  });

  test("own profile uses the exact own trip page and links to all own trips", async ({ page }) => {
    const state = await mockDriverRoutes(page);
    await open(page, selfId);
    await loaded(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Fictional Yukon Member");
    await expect(
      page.locator("header.driver-header").getByText("You", { exact: true }),
    ).toBeVisible();
    expect(profileRequests(state)).toContain("/api/v1/trips?scope=mine&decision=accepted&limit=10");
    expect(profileRequests(state).some((path) => path.includes("scope=company"))).toBe(false);
    await expect(tripsCard(page).getByRole("row")).toHaveCount(3);
    await expect(tripsCard(page).getByText(/among the latest/)).toHaveCount(0);
    await expect(tripsCard(page).getByRole("link", { name: "All my trips" })).toHaveAttribute(
      "href",
      "/account/trips",
    );
    await expect(qualification(page, "ATS").getByText("No qualification assigned")).toBeVisible();

    state.emptyTrips = true;
    state.tripsNextCursor = false;
    await gameGroup(page).getByRole("button", { name: "ETS2", exact: true }).click();
    await expect(tripsCard(page).getByText("You have no accepted trips yet.")).toBeVisible();
    await expect(tripsCard(page).getByRole("link", { name: "All my trips" })).toHaveCount(0);
  });

  test("former member without assignments shows the badge and requests no progress or levels", async ({
    page,
  }) => {
    const state = await mockDriverRoutes(page);
    await open(page, formerId);
    await expect(kpis(page).getByText("Accepted trips")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("GammaRetired");
    await expect(
      page.locator("header.driver-header").getByText("Former member", { exact: true }),
    ).toBeVisible();
    for (const game of ["ETS2", "ATS"] as const)
      await expect(qualification(page, game).getByText("No qualification assigned")).toBeVisible();
    await expect(page.locator("header.driver-header .driver-level-chip")).toHaveCount(0);
    await expect(kpis(page).getByRole("definition").first()).toHaveText("139last 12 months");
    await expect(
      tripsCard(page).getByText(
        "No trips by this driver among the latest 100 accepted company trips.",
      ),
    ).toBeVisible();
    const paths = profileRequests(state);
    expect(paths.filter((path) => path.includes("qualification"))).toEqual([]);
    expect(paths).toHaveLength(3);
  });

  test("covers loading, not found, retryable error, forbidden and missing company.read", async ({
    page,
  }) => {
    const state = await mockDriverRoutes(page, { holdProfile: true });
    await open(page, alphaId);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Driver profile");
    await expect(page.getByRole("status").filter({ hasText: "Loading data..." })).toHaveCount(1);
    state.releaseProfile();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("AlphaHauler");

    await open(page, unknownId);
    await expect(page.getByText("Driver not found")).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to drivers directory" })).toHaveAttribute(
      "href",
      "/account/drivers",
    );

    state.failures.profile = 503;
    await open(page, alphaId);
    const alert = page.getByRole("alert").filter({ hasText: "Failed to load data" });
    await expect(alert).toBeVisible();
    delete state.failures.profile;
    await alert.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("AlphaHauler");
    await expect(page.getByRole("heading", { level: 1 })).toBeFocused();

    state.failures.profile = 403;
    await open(page, betaId);
    await expect(page.getByText("You do not have access to driver profiles.")).toBeVisible();
    delete state.failures.profile;

    state.capabilities = memberCapabilities.filter((item) => item !== "company.read");
    const before = state.requests.length;
    await open(page, alphaId);
    await expect(page.getByText("You do not have access to driver profiles.")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Driver profile");
    expect(
      state.requests.slice(before).filter((url) => url.pathname.startsWith("/api/v1/members")),
    ).toEqual([]);
  });

  test("keeps available blocks when analytics, progress, levels or trips fail", async ({
    page,
  }) => {
    const state = await mockDriverRoutes(page, { failures: { analytics: 503 } });
    await open(page, alphaId);
    await expect(kpis(page).getByText("Could not load statistics.")).toBeVisible();
    await expect(chartCard(page).getByText("Could not load statistics.")).toBeVisible();
    await expect(tripsCard(page).getByRole("table")).toBeVisible();
    delete state.failures.analytics;
    await kpis(page).getByRole("button", { name: "Retry" }).click();
    await expect(kpis(page).getByRole("definition").first()).toHaveText("139last 12 months");

    state.failures.analytics = 409;
    await open(page, alphaId);
    await expect(
      kpis(page).getByText(/until the company reporting timezone is configured/),
    ).toBeVisible();
    await expect(kpis(page).getByRole("button", { name: "Retry" })).toHaveCount(0);
    delete state.failures.analytics;

    state.emptyAnalytics = true;
    await open(page, alphaId);
    await expect(kpis(page).getByRole("definition")).toHaveText([
      "0last 12 months",
      "0 kmlast 12 months",
      "0 kmTrips: 0 · November 2026",
    ]);
    await expect(
      chartCard(page).getByText("No accepted trips in the last 12 months."),
    ).toBeVisible();
    state.emptyAnalytics = false;

    state.failures.progressAts = 503;
    await open(page, alphaId);
    await expect(qualification(page, "ATS").getByText("Progress unavailable")).toBeVisible();
    await expect(qualification(page, "ETS2").getByRole("definition").first()).toHaveText("41 / 80");
    delete state.failures.progressAts;

    state.failures.levels = 503;
    await open(page, alphaId);
    await expect(
      page.locator("header.driver-header").getByText("ETS2 · Level unavailable", { exact: true }),
    ).toBeVisible();
    await expect(qualification(page, "ETS2").getByRole("heading", { level: 2 })).toHaveText(
      "ETS2 · Level unavailable",
    );
    await expect(qualification(page, "ETS2").getByRole("definition").first()).toHaveText("41 / 80");
    await expect(qualification(page, "ETS2").getByRole("list")).toHaveCount(0);
    delete state.failures.levels;

    state.failures.trips = 503;
    await open(page, alphaId);
    await expect(tripsCard(page).getByText("Could not load trips.")).toBeVisible();
    delete state.failures.trips;
    await tripsCard(page).getByRole("button", { name: "Retry" }).click();
    await expect(tripsCard(page).getByRole("table")).toBeVisible();
    await expect(tripsCard(page).getByRole("heading", { name: "Accepted trips" })).toBeFocused();

    state.emptyTrips = true;
    state.tripsNextCursor = false;
    await open(page, alphaId);
    await expect(tripsCard(page).getByText("No accepted trips yet.")).toBeVisible();
  });

  test("shows unconfigured thresholds and the top level", async ({ page }) => {
    await mockDriverRoutes(page);
    await open(page, topId);
    await loaded(page);
    const ets2 = qualification(page, "ETS2");
    await expect(ets2.getByRole("heading", { level: 2 })).toHaveText("ETS2 · Driver I");
    await expect(ets2.getByText("Top level")).toBeVisible();
    await expect(ets2.getByRole("definition")).toHaveText(["12", "9,800 km"]);
    await expect(ets2.getByText("Promotion thresholds are not configured.")).toBeVisible();
    await expect(ets2.locator(".driver-bar")).toHaveCount(0);
  });

  test("fits every viewport with phone cards and compact or touch targets", async ({
    page,
  }, info) => {
    await mockDriverRoutes(page);
    for (const locale of ["en", "ru"] as const) {
      await open(page, alphaId);
      if (locale === "ru") await switchLanguage(page, "ru");
      await expect(tripsCard(page).getByRole("table")).toBeVisible();
      expect(await noOverflow(page)).toBe(true);
      const width = page.viewportSize()?.width ?? 0;
      const label = tripsCard(page).locator(".driver-cell-label").first();
      if (width <= 760) {
        await expect(label).toBeVisible();
        const group = await box(gameGroup(page));
        const title = await box(page.getByRole("heading", { level: 1 }));
        expect(group.y).toBeGreaterThan(title.y + title.height - 1);
      } else await expect(label).toBeHidden();
      await capture(page, info, `driver-profile-${locale}`);
    }
    const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
    if (info.project.name === "mobile-chromium") expect(coarse).toBe(true);
    const expectTarget = async (target: Locator, fine: number) => {
      const { height } = await box(target);
      if (coarse) expect(height).toBeGreaterThanOrEqual(40);
      else expect(height).toBeGreaterThanOrEqual(fine - 0.5);
    };
    for (const segment of await gameGroup(page).getByRole("button").all())
      await expectTarget(segment, 24);
    await expectTarget(page.locator("a.driver-back"), 30);
    for (const link of await tripsCard(page).locator("a.driver-trip-link").all())
      await expectTarget(link, 30);
  });

  test("uses two columns from 1200px and wraps Russian only between words", async ({
    page,
  }, info) => {
    test.skip(info.project.name !== "desktop-chromium", "Explicit desktop widths");
    await mockDriverRoutes(page);
    for (const width of [1280, 1200]) {
      await page.setViewportSize({ width, height: 800 });
      await open(page, alphaId);
      await switchLanguage(page, "ru");
      await expect(tripsCard(page).getByRole("table")).toBeVisible();
      await expect(qualification(page, "ATS").getByRole("definition").first()).toBeVisible();
      const trips = await box(tripsCard(page));
      const side = await box(qualification(page, "ETS2"));
      expect(side.x).toBeGreaterThan(trips.x + trips.width - 1);
      expect(Math.abs(side.y - trips.y)).toBeLessThan(2);
      expect(await noOverflow(page)).toBe(true);
      expect(
        await midWordBreaks(
          main(page),
          ".driver-trips-table td, .driver-kpi dt, .driver-kpi dd, .driver-qualification, .badge, .driver-level-chip",
        ),
      ).toEqual([]);
      expect(await tableFits(tripsCard(page))).toBe(true);
      expect(
        await tripsCard(page)
          .locator("td")
          .evaluateAll(
            (cells) => cells.filter((cell) => cell.scrollWidth > cell.clientWidth).length,
          ),
      ).toBe(0);
      if (width === 1200) await capture(page, info, "driver-profile-ru-1200");
    }
    await page.setViewportSize({ width: 1199, height: 800 });
    const trips = await box(tripsCard(page));
    const side = await box(qualification(page, "ETS2"));
    expect(side.y).toBeGreaterThan(trips.y + trips.height - 1);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(tripsCard(page).locator(".driver-cell-label").first()).toBeVisible();
    expect(await noOverflow(page)).toBe(true);
    expect(await midWordBreaks(main(page), ".driver-trips-table td, .driver-kpi dt")).toEqual([]);
    expect(
      await tripsCard(page)
        .locator("td > span")
        .evaluateAll(
          (cells) =>
            cells.filter((cell) => cell.scrollWidth > (cell.parentElement?.clientWidth ?? 0))
              .length,
        ),
    ).toBe(0);
  });

  test("exposes headings, regions, table semantics and a logical keyboard order", async ({
    page,
  }) => {
    test.skip(
      (page.viewportSize()?.width ?? 0) < 768,
      "Phones reach the page through the bottom bar",
    );
    await mockDriverRoutes(page);
    await open(page, selfId);
    await loaded(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    for (const region of [
      kpis(page),
      tripsCard(page),
      qualification(page, "ETS2"),
      chartCard(page),
    ])
      await expect(region).toBeVisible();
    await expect(tripsCard(page).getByRole("table")).toHaveAccessibleName(
      "Accepted trips of Fictional Yukon Member",
    );
    await expect(
      qualification(page, "ETS2").locator('[aria-current="step"] .driver-ladder-name'),
    ).toHaveText("Trainee");
    await expect(qualification(page, "ETS2").locator(".driver-bar").first()).toHaveAttribute(
      "aria-hidden",
      "true",
    );

    const back = page.getByRole("link", { name: "All drivers", exact: true });
    await back.focus();
    const order: string[] = [];
    for (let step = 0; step < 9; step += 1) {
      order.push(
        await page.evaluate(() => {
          const active = document.activeElement as HTMLElement | null;
          return active?.textContent?.replace(/\s+/g, " ").trim() ?? "";
        }),
      );
      await page.keyboard.press("Tab");
    }
    expect(order).toEqual([
      "← All drivers",
      "All games",
      "ETS2",
      "ATS",
      "Гамбург → Берлин",
      "Прага → Вена",
      "All my trips",
      "Chart",
      "Table",
    ]);
    const table = chartCard(page).getByRole("button", { name: "Table" });
    await table.focus();
    await page.keyboard.press("Enter");
    await expect(table).toBeFocused();
    await expect(table).toHaveAttribute("aria-pressed", "true");
    await expect(chartCard(page).getByRole("table")).toHaveAccessibleName(
      "Distance by month (Europe/Moscow)",
    );
    await expect(chartCard(page).getByRole("rowheader").last()).toHaveText("November 2026");
  });

  test("switches between Russian and English and keeps the selected game", async ({ page }) => {
    await mockDriverRoutes(page);
    await open(page, alphaId);
    await loaded(page);
    await gameGroup(page).getByRole("button", { name: "ATS", exact: true }).click();
    await switchLanguage(page, "ru");
    await expect(gameGroup(page).getByRole("button", { name: "ATS", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(kpis(page)).toHaveAccessibleName("Показатели водителя за 12 месяцев");
    await expect(tripsCard(page).getByRole("columnheader")).toHaveText([
      "Учтён",
      "Маршрут",
      "Груз",
      "Источник",
      "Пробег",
    ]);
    await expect(
      qualification(page, "ATS").getByText("Следующий: Highway Driver II"),
    ).toBeVisible();
    await expect(chartCard(page).getByText("Часовой пояс отчётности: Europe/Moscow")).toBeVisible();
    const text = await main(page).innerText();
    expect(text).not.toMatch(/\b(profile|kpi|trips|qualification|chart|states)\.[a-z]/);
    await switchLanguage(page, "en");
    await expect(gameGroup(page).getByRole("button", { name: "ATS", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(kpis(page)).toHaveAccessibleName("Driver statistics, last 12 months");
  });
});
