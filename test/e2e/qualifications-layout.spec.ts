import type { Locator, Page, TestInfo } from "@playwright/test";
import { accountFixture } from "../../apps/web/src/features/account/fixtures.ts";
import { catalogLanguage } from "./support/catalogs.ts";
import { expect, test } from "./support/fixtures.ts";
import { levels, mockQualifications, ruleId } from "./support/qualifications.ts";

const [traineeId, driverIIIId, driverIIId] = levels("ets2").map((level) => level.id);
const text = {
  en: {
    title: "Qualifications",
    table: "Levels and effective rules",
    game: "Game",
    headers: ["Level", "Max mass", "Trailers", "ADR", "Promotion threshold", "Version"],
    mass: "0.01 t",
    noRestriction: "No restriction",
    threshold: "Trips: 2 · 0.100000000000000000001 km",
    topLevel: "Top level",
    effective: "Effective",
    current: "Current qualification · ETS2",
    distance: "0.100000000000000000001 km / 0.1 km",
    ready: "Ready for confirmation",
    unconfigured:
      "4 of 4 ETS2 levels have no published rules. No default values are applied; the director or deputy publishes them before launch.",
  },
  ru: {
    title: "Квалификации",
    table: "Уровни и действующие правила",
    game: "Игра",
    headers: ["Уровень", "Макс. масса", "Прицепы", "ADR", "Порог повышения", "Версия"],
    mass: "0,01 т",
    noRestriction: "Без ограничений",
    threshold: "Рейсы: 2 · 0,100000000000000000001 км",
    topLevel: "Высший уровень",
    effective: "Действует",
    current: "Текущая квалификация · ETS2",
    distance: "0,100000000000000000001 км / 0,1 км",
    ready: "Можно подтвердить",
    unconfigured:
      "У 4 из 4 уровней ETS2 нет опубликованных правил. Значения по умолчанию не подставляются — их публикует директор или заместитель до запуска.",
  },
} as const;

/** Every /api/v1 request except the shell's inert notification reads. */
function recordRequests(page: Page) {
  const urls: URL[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.pathname.startsWith("/api/v1/") &&
      !url.pathname.startsWith("/api/v1/notifications") &&
      url.pathname !== "/api/v1/me/notification-preferences"
    )
      urls.push(url);
  });
  return urls;
}
const levelsTable = (page: Page, locale: "en" | "ru" = "en") =>
  page.getByRole("table", { name: text[locale].table, exact: true });
const levelsRegion = (page: Page, locale: "en" | "ru" = "en") =>
  page.getByRole("region", { name: text[locale].table, exact: true });
const rowButton = (page: Page, code: string) =>
  levelsTable(page).getByRole("button", { name: `Fictional ${code}`, exact: true });
const row = (page: Page, code: string, locale: "en" | "ru" = "en") =>
  levelsTable(page, locale)
    .getByRole("row")
    .filter({ has: page.getByRole("button", { name: `Fictional ${code}`, exact: true }) });
const currentCard = (page: Page, locale: "en" | "ru" = "en") =>
  page.getByRole("heading", { name: text[locale].current, exact: true }).locator("..");
const panel = (page: Page, id: string | undefined) => page.locator(`#qualification-level-${id}`);
async function box(locator: Locator) {
  const value = await locator.boundingBox();
  if (!value) throw new Error("ELEMENT_NOT_RENDERED");
  return value;
}
async function settled(page: Page, locale: "en" | "ru" = "en") {
  const cells = levelsTable(page, locale).locator("tbody tr td:first-of-type");
  await expect(cells).toHaveCount(4);
  for (const cell of await cells.all()) await expect(cell).toContainText(text[locale].mass);
}
async function capture(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
}

for (const locale of ["en", "ru"] as const)
  test(`L1 ${locale} compact layout shows the levels table beside the member column`, async ({
    page,
  }, info) => {
    const s = text[locale];
    await mockQualifications(page, locale);
    await page.goto("/account/qualifications");
    await catalogLanguage(page, locale);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(s.title);
    await expect(
      page
        .getByRole("group", { name: s.game, exact: true })
        .getByRole("button", { name: "ETS2", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    const table = levelsTable(page, locale);
    await expect(table.getByRole("columnheader")).toHaveText([...s.headers]);
    await settled(page, locale);
    await expect(table.locator("tbody tr")).toHaveCount(4);
    for (const code of ["trainee", "driver_iii", "driver_ii", "driver_i"]) {
      const cells = row(page, code, locale).getByRole("cell");
      await expect(cells.nth(0)).toContainText(s.mass);
      await expect(cells.nth(1)).toContainText(s.noRestriction);
      await expect(cells.nth(2)).toContainText(s.noRestriction);
      await expect(cells.nth(3)).toContainText(code === "driver_i" ? s.topLevel : s.threshold);
      await expect(cells.nth(4)).toContainText("v1");
      await expect(cells.nth(4)).toContainText(s.effective);
    }
    await expect(
      table.getByRole("button", { name: "Fictional trainee", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".qualification-banner")).toHaveCount(0);
    const region = await box(levelsRegion(page, locale)),
      current = await box(currentCard(page, locale)),
      aside = await box(page.locator(".qualification-aside > *").first());
    if (info.project.name === "desktop-chromium") {
      expect(current.x).toBeGreaterThanOrEqual(region.x + region.width);
      expect(Math.abs(aside.y - region.y)).toBeLessThanOrEqual(2);
    } else expect(region.y).toBeLessThan(current.y);
    if (info.project.name === "mobile-chromium") {
      expect((await box(table.locator("thead"))).height).toBeLessThanOrEqual(1);
      await expect(
        row(page, "trainee", locale).locator(".qualification-cell-label").first(),
      ).toBeVisible();
    }
    await expect(page.locator("body")).not.toContainText(/Достаточно суров|Yukon\?|Юкон\?/);
    await capture(page, info, `qualifications-compact-${locale}`);
  });

test("L2 row selection swaps panels without reads, supports the keyboard and keeps drafts", async ({
  page,
}) => {
  await mockQualifications(page);
  await page.goto("/account/qualifications");
  await settled(page);
  const requests = recordRequests(page);
  const driverII = rowButton(page, "driver_ii");
  await driverII.click();
  await expect(driverII).toHaveAttribute("aria-pressed", "true");
  await expect(rowButton(page, "trainee")).toHaveAttribute("aria-pressed", "false");
  await expect(
    page.getByRole("heading", { name: "Fictional driver_ii · ETS2", exact: true }),
  ).toBeVisible();
  await expect(panel(page, traineeId)).toBeHidden();
  await expect(panel(page, driverIIId)).toBeVisible();
  await expect(driverII).toBeFocused();
  expect(requests.map(String)).toEqual([]);

  await page.keyboard.press("Tab");
  await expect(rowButton(page, "driver_i")).toBeFocused();
  await page.keyboard.press("Space");
  await expect(rowButton(page, "driver_i")).toHaveAttribute("aria-pressed", "true");
  await expect(panel(page, driverIIId)).toBeHidden();

  await rowButton(page, "driver_iii").click();
  const draftPanel = panel(page, driverIIIId);
  await draftPanel.getByRole("button", { name: "Edit rules", exact: true }).click();
  const editor = draftPanel.locator("section").last();
  await editor.locator('[id^="reason-"]').fill("Fictional retained hidden draft");
  await expect(row(page, "driver_iii").getByText("Draft open", { exact: true })).toBeVisible();
  await rowButton(page, "trainee").click();
  await expect(draftPanel).toBeHidden();
  await expect(row(page, "driver_iii").getByText("Draft open", { exact: true })).toBeVisible();
  await rowButton(page, "driver_iii").click();
  await expect(draftPanel).toBeVisible();
  await expect(editor.locator('[id^="reason-"]')).toHaveValue("Fictional retained hidden draft");
});

test("L3 game switch updates the URL, requests the ATS levels and resets the selection", async ({
  page,
}) => {
  await mockQualifications(page);
  await page.goto("/account/qualifications");
  await settled(page);
  await rowButton(page, "driver_ii").click();
  const requests = recordRequests(page);
  const ats = page
    .getByRole("group", { name: "Game", exact: true })
    .getByRole("button", { name: "ATS", exact: true });
  await ats.click();
  await expect(page).toHaveURL(/game=ats/);
  await expect(ats).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("heading", { name: "Current qualification · ATS", exact: true }),
  ).toBeVisible();
  await expect(rowButton(page, "trainee")).toHaveAttribute("aria-pressed", "true");
  await expect(rowButton(page, "driver_ii")).toHaveAttribute("aria-pressed", "false");
  await expect(
    page.getByRole("heading", { name: "Fictional trainee · ATS", exact: true }),
  ).toBeVisible();
  expect(
    requests.some(
      (url) =>
        url.pathname === "/api/v1/qualification-levels" && url.searchParams.get("game") === "ats",
    ),
  ).toBe(true);
});

for (const locale of ["en", "ru"] as const)
  test(`L4 ${locale} unconfigured levels show the launch banner and request no rule details`, async ({
    page,
  }, info) => {
    const state = await mockQualifications(page, locale);
    state.unconfigured = true;
    const requests = recordRequests(page);
    await page.goto("/account/qualifications");
    await catalogLanguage(page, locale);
    await expect(
      page.getByRole("status").filter({ hasText: text[locale].unconfigured }),
    ).toBeVisible();
    const cells = row(page, "trainee", locale).getByRole("cell");
    await expect(cells.nth(0)).toContainText(locale === "en" ? "Unset" : "Не задано");
    await expect(cells.nth(3)).toContainText(locale === "en" ? "Unset" : "Не задано");
    await expect(cells.nth(4)).toContainText(locale === "en" ? "Not published" : "Не опубликовано");
    await expect(row(page, "driver_i", locale).getByRole("cell").nth(3)).toContainText(
      text[locale].topLevel,
    );
    await capture(page, info, `qualifications-unconfigured-${locale}`);
    expect(requests.filter((url) => url.pathname.includes("/rule-versions/")).map(String)).toEqual(
      [],
    );
  });

for (const locale of ["en", "ru"] as const)
  test(`L5 ${locale} member progress shows exact km values with bars and readiness`, async ({
    page,
  }) => {
    await mockQualifications(page, locale);
    await page.goto("/account/qualifications");
    await catalogLanguage(page, locale);
    const current = currentCard(page, locale);
    await expect(current.getByText("2 / 2", { exact: true })).toBeVisible();
    await expect(current.getByText(text[locale].distance, { exact: true })).toBeVisible();
    await expect(current.getByText(text[locale].ready, { exact: true })).toBeVisible();
    await expect(current.locator(".qualification-bar")).toHaveCount(2);
  });

test("L5 retained review is a decision callout without actions; unset requirements have no bar", async ({
  page,
}, info) => {
  const state = await mockQualifications(page);
  state.review = true;
  await page.goto("/account/qualifications");
  const alert = currentCard(page).getByRole("alert");
  await expect(alert).toContainText("Decision needed");
  await expect(alert).toContainText("Earlier promotion requirements are no longer met.");
  await expect(alert).toContainText("no automatic demotion");
  await expect(alert.getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(1);
  await capture(page, info, "qualifications-review");
  state.review = false;
  state.unset = true;
  await page.reload();
  const current = currentCard(page);
  await expect(current.getByText("2 / Unset", { exact: true })).toBeVisible();
  await expect(current.locator(".qualification-bar")).toHaveCount(0);
  await expect(current.getByText("Ready for confirmation", { exact: true })).toHaveCount(0);
});

test("L6 without company.read the page is forbidden and requests nothing", async ({
  page,
}, info) => {
  await mockQualifications(page);
  await page.route("**/api/v1/me", (route) => {
    const self = accountFixture("en");
    self.data.capabilities = self.data.capabilities.filter((c) => c !== "company.read");
    return route.fulfill({ json: self });
  });
  const requests = recordRequests(page);
  await page.goto("/account/qualifications");
  await expect(
    page.getByText("You do not have access to qualifications.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Qualifications");
  await expect(page.getByRole("group", { name: "Game", exact: true })).toHaveCount(0);
  await capture(page, info, "qualifications-forbidden");
  expect(
    requests
      .filter((url) => /qualification-(levels|progress)/.test(url.pathname))
      .map((url) => url.pathname),
  ).toEqual([]);
});

test("L6 levels failure offers Refresh without a table; one rule failure stays in its row", async ({
  page,
}, info) => {
  await mockQualifications(page);
  let failLevels = true;
  await page.route(
    (url) => url.pathname === "/api/v1/qualification-levels",
    (route) => (failLevels ? route.fulfill({ status: 503, json: {} }) : route.fallback()),
  );
  await page.route(
    (url) => url.pathname === `/api/v1/qualification-levels/${driverIIId}/rule-versions/${ruleId}`,
    (route) => route.fulfill({ status: 503, json: {} }),
  );
  await page.goto("/account/qualifications");
  const region = levelsRegion(page);
  await expect(region.getByRole("alert")).toBeVisible();
  await expect(region.getByRole("button", { name: "Refresh", exact: true })).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
  await capture(page, info, "qualifications-levels-error");
  failLevels = false;
  await region.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(row(page, "driver_ii").getByRole("cell").nth(0)).toContainText("Unavailable");
  await expect(row(page, "trainee").getByRole("cell").nth(0)).toContainText("0.01 t");
  await expect(row(page, "driver_iii").getByRole("cell").nth(0)).toContainText("0.01 t");
});

test("L7 rows, game options and Edit keep pointer-appropriate target sizes", async ({
  page,
}, info) => {
  await mockQualifications(page);
  await page.goto("/account/qualifications");
  await settled(page);
  const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  if (info.project.name === "mobile-chromium") expect(coarse).toBe(true);
  const minimum = coarse ? 40 : 30;
  for (const button of await levelsTable(page).getByRole("button").all())
    expect((await box(button)).height).toBeGreaterThanOrEqual(minimum);
  for (const option of await page
    .getByRole("group", { name: "Game", exact: true })
    .getByRole("button")
    .all()) {
    const height = (await box(option)).height;
    if (coarse) expect(height).toBeGreaterThanOrEqual(40);
    else expect(height).toBeCloseTo(24, 0);
  }
  const edit = panel(page, traineeId).getByRole("button", { name: "Edit rules", exact: true });
  expect((await box(edit)).height).toBeGreaterThanOrEqual(minimum);
});

test("L8 members without qualifications.manage get no editing or administration", async ({
  page,
}) => {
  await mockQualifications(page, "en", false);
  await page.goto("/account/qualifications");
  await settled(page);
  await expect(page.getByRole("button", { name: "Edit rules", exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Qualification administration", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("Draft open", { exact: true })).toHaveCount(0);
  await rowButton(page, "driver_iii").click();
  await expect(
    panel(page, driverIIIId).getByRole("button", { name: "Edit rules", exact: true }),
  ).toHaveCount(0);
  await expect(panel(page, driverIIIId).locator("section")).toHaveCount(0);
});
