import type { Locator, Page, TestInfo } from "@playwright/test";
import { browserCase, expect, test } from "./support/fixtures.ts";
import { mockQualifications, qid } from "./support/qualifications-ui.ts";

type Locale = "en" | "ru";
const text = {
  en: {
    title: "Qualifications",
    game: "Game",
    mine: "My level",
    top: "Highest level",
    howLabel: "How qualifications work",
    how: "A level decides which trips the company credits.",
    empty: "Any trips",
    levelOf: "Level 1 of 2 · 1 driver",
    limitsLabel: "About trip limits",
    limitsTip: "The company does not credit a trip outside these limits.",
    limitsHint: "An empty field means no limit.",
    promotionLabel: "About promotion",
    promotionTip: "Every set condition must be met.",
    drivers: "Drivers on this level",
    history: "Change history",
    editTitle: "Edit “Fictional Trainee”",
    distanceLabel: "About trip distance",
    distanceTip: "The actual distance counts: it is known from telemetry and from a manual report.",
    hardModeLabel: "About Hard Mode",
    hardModeTip: "The telemetry client reports the mode.",
    conditionsLabel: "About promotion conditions",
    conditionsTip: "Fill in at least one field.",
    savingLabel: "About saving",
    savingTip: "New limits apply to trips checked after saving.",
    adrLabel: "Dangerous goods (ADR)",
    adrSelected: "Selected classes",
    adrLong: "4 · Flammable solids",
    summary: "What drivers will see",
  },
  ru: {
    title: "Квалификации",
    game: "Игра",
    mine: "Мой уровень",
    top: "Высший уровень",
    howLabel: "Как работают квалификации",
    how: "Уровень определяет, какие рейсы компания засчитывает.",
    empty: "Любые рейсы",
    levelOf: "Уровень 1 из 2 · 1 водитель",
    limitsLabel: "Об ограничениях рейса",
    limitsTip: "Рейс вне этих ограничений компания не засчитывает.",
    limitsHint: "Пустое поле — без ограничения.",
    promotionLabel: "О переходе",
    promotionTip: "Нужно выполнить все заданные условия.",
    drivers: "Водители на этом уровне",
    history: "История изменений",
    editTitle: "Изменить «Fictional Trainee»",
    distanceLabel: "О расстоянии рейса",
    distanceTip: "Считается фактический пробег: он есть и в телеметрии, и в ручном отчёте.",
    hardModeLabel: "О Hard Mode",
    hardModeTip: "Режим определяет клиент телеметрии.",
    conditionsLabel: "Об условиях перехода",
    conditionsTip: "Заполните хотя бы одно поле.",
    savingLabel: "О сохранении",
    savingTip: "Новые ограничения применяются к рейсам, которые проверят после сохранения.",
    adrLabel: "Опасные грузы (ADR)",
    adrSelected: "Выбранные классы",
    adrLong: "4 · Легковоспламеняющиеся твёрдые вещества",
    summary: "Так это увидят водители",
  },
} as const;

const ladder = (page: Page) => page.locator(".qualification-ladder-card");
async function open(page: Page, locale: Locale, lead: boolean, path: string) {
  const mock = await mockQualifications(page, { lead, locale });
  await page.goto(path);
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("status")).toHaveCount(0);
  return mock;
}
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
/** Opens one info tooltip, checks its text fits the viewport, then closes it with Escape. */
async function tooltip(page: Page, label: string, body: string) {
  const trigger = page.getByRole("button", { name: label, exact: true });
  await trigger.click();
  const content = page.locator(".info-tip-content");
  await expect(content).toHaveCount(1);
  await expect(content).toBeVisible();
  await expect(content).toContainText(body);
  const rect = await box(content),
    viewport = page.viewportSize();
  if (!viewport) throw new Error("VIEWPORT_MISSING");
  expect(rect.x).toBeGreaterThanOrEqual(0);
  expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width);
  await noOverflow(page);
  await page.keyboard.press("Escape");
  await expect(content).toHaveCount(0);
  await expect(trigger).toBeFocused();
}
/** The Hard Mode label keeps its English name in both languages and carries the flame icon. */
async function hardModeLabel(label: Locator) {
  await expect(label).toContainText("Hard Mode");
  const flame = label.locator("svg.lucide-flame");
  await expect(flame).toBeVisible();
  await expect(flame).toHaveAttribute("aria-hidden", "true");
  const icon = await box(flame);
  expect(icon.width).toBeGreaterThan(0);
}

for (const locale of ["en", "ru"] as const)
  test(
    `L1 ${locale} the ladder page fits the viewport with the level chips, my level and the info tooltips`,
    browserCase(["@layout"]),
    async ({ page }, info) => {
      const s = text[locale];
      await open(page, locale, false, "/account/qualifications");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(s.title);
      await expect(
        page
          .getByRole("group", { name: s.game, exact: true })
          .getByRole("button", { name: "ETS2", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(ladder(page)).toContainText("Fictional Trainee");
      await expect(ladder(page)).toContainText("Fictional Driver");
      await expect(ladder(page)).toContainText(s.top);
      await expect(ladder(page).locator("[data-current='true']").first()).toContainText(
        "Fictional Trainee",
      );
      await hardModeLabel(ladder(page).locator(".badge-ok").filter({ hasText: "Hard Mode" }));
      const mine = page.locator(".qualification-mine");
      await expect(mine.getByRole("heading", { name: s.mine })).toBeVisible();
      await expect(mine.getByRole("link", { name: "Fictional Trainee" })).toBeVisible();
      // The member's own level comes before the ladder on every width.
      expect((await box(mine)).y).toBeLessThan((await box(ladder(page))).y);
      await capture(page, info, `qualifications-${locale}`);
      await tooltip(page, s.howLabel, s.how);
    },
  );

for (const locale of ["en", "ru"] as const)
  test(
    `L2 ${locale} a lead's level page fits the viewport with limits, promotion, drivers and history`,
    browserCase(["@layout"]),
    async ({ page }, info) => {
      const s = text[locale];
      await open(page, locale, true, `/account/qualifications/${qid(1)}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Fictional Trainee");
      await expect(page.getByText(s.levelOf, { exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: s.drivers })).toBeVisible();
      await expect(page.getByText("Fictional_Driver")).toBeVisible();
      await expect(page.getByRole("heading", { name: s.history })).toBeVisible();
      await hardModeLabel(page.locator(".qualification-limit-list .qualification-hard-mode"));
      // Every action stays reachable on the page without sideways scrolling.
      for (const action of await page.locator("main button, main a").all())
        if (await action.isVisible()) {
          const rect = await box(action);
          expect(rect.x + rect.width).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
        }
      await capture(page, info, `qualification-level-${locale}`);
      await tooltip(page, s.limitsLabel, s.limitsTip);
      await tooltip(page, s.promotionLabel, s.promotionTip);
    },
  );

for (const locale of ["en", "ru"] as const)
  test(
    `L4 ${locale} the level editor fits the viewport with long ADR classes, the summary and every info tooltip`,
    browserCase(["@layout"]),
    async ({ page }, info) => {
      const s = text[locale];
      const mock = await open(page, locale, true, `/account/qualifications/${qid(1)}/edit`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(s.editTitle);
      await hardModeLabel(page.locator("legend.qualification-hard-mode"));
      const summary = page.locator(".qualification-summary");
      await expect(summary.getByRole("heading", { name: s.summary })).toBeVisible();
      await hardModeLabel(summary.locator(".qualification-hard-mode"));
      await page.getByRole("button", { name: s.adrSelected, exact: true }).click();
      // Before a class is chosen the summary names the mode instead of an empty value.
      const adr = summary.locator(".qualification-limit-list > div").filter({
        has: page.locator(`dt:text-is(${JSON.stringify(s.adrLabel)})`),
      });
      await expect(adr.locator("dd")).toHaveText(s.adrSelected);
      const longest = page.getByRole("button", { name: s.adrLong, exact: true });
      await expect(longest).toBeVisible();
      expect(await longest.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      await capture(page, info, `qualification-editor-${locale}`);
      await tooltip(page, s.limitsLabel, s.limitsHint);
      await tooltip(page, s.distanceLabel, s.distanceTip);
      await tooltip(page, s.hardModeLabel, s.hardModeTip);
      await tooltip(page, s.conditionsLabel, s.conditionsTip);
      await tooltip(page, s.savingLabel, s.savingTip);
      expect(mock.requests.filter((request) => request.method !== "GET")).toEqual([]);
    },
  );

test(
  "L3 game switch updates the URL, requests the ATS levels and resets the selection",
  browserCase(["@functional", "@smoke-qualifications"]),
  async ({ page }) => {
    const s = text.en;
    const mock = await open(page, "en", false, "/account/qualifications");
    const games = page.getByRole("group", { name: s.game, exact: true });
    await expect(ladder(page)).toContainText("Fictional Trainee");
    await expect(page.locator(".qualification-mine")).toBeVisible();
    const before = mock.requests.length;
    await games.getByRole("button", { name: "ATS", exact: true }).click();
    await expect(page).toHaveURL(/\/account\/qualifications\?game=ats$/);
    await expect(games.getByRole("button", { name: "ATS", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(games.getByRole("button", { name: "ETS2", exact: true })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(ladder(page)).toContainText("Fictional Hauler");
    await expect(ladder(page)).toContainText(s.empty);
    await expect(ladder(page)).not.toContainText("Fictional Trainee");
    // The ETS2 level and its current-row marker do not carry over to the ATS ladder.
    await expect(page.locator(".qualification-mine")).toHaveCount(0);
    await expect(ladder(page).locator("[data-current='true']")).toHaveCount(0);
    expect(mock.requests.slice(before)).toEqual([
      { method: "GET", path: "/qualification-levels?game=ats", body: null },
    ]);
    await page.goBack();
    await expect(page).toHaveURL(/\/account\/qualifications$/);
    await expect(games.getByRole("button", { name: "ETS2", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(ladder(page)).toContainText("Fictional Trainee");
    await expect(page.locator(".qualification-mine")).toBeVisible();
    expect(mock.requests.filter((request) => request.method !== "GET")).toEqual([]);
  },
);
