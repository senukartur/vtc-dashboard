import { writeFile } from "node:fs/promises";
import type { Locator, Page, TestInfo } from "@playwright/test";
import type { components } from "@vtc/contracts";
import { catalogItem, catalogLanguage, envelope } from "./support/catalogs.ts";
import { browserCase, expect, test } from "./support/fixtures.ts";
import {
  entities,
  evidence,
  member,
  mockReview,
  type ReviewMockOptions,
  rejection,
  reviewer,
  reviewIds,
} from "./support/review-ui.ts";
import { countInsertedAlerts } from "./support/trip-ui.ts";

test(
  "overall review totals stay independent of filters and distinguish zero age from an empty queue",
  browserCase(["@functional"]),
  async ({ page }) => {
    const mock = await mockReview(page);
    const computedAt = "2026-11-12T08:00:00.000Z";
    let summary: components["schemas"]["WorkspaceStage3Summary"] = {
      computedAt,
      legacyReviewQueue: { count: 41, oldestAgeSeconds: 0 },
    };
    let reads = 0;
    await page.route("**/api/v1/me/workspace-summary?view=stage3", (route) => {
      reads += 1;
      return route.fulfill({ json: envelope(summary) });
    });
    await page.goto("/account/review");
    const header = page.locator(".review-queue-header");
    await expect(header.getByText("Awaiting decision overall (41)", { exact: true })).toBeVisible();
    await expect(
      header.getByText("Oldest waiting trip added 0 seconds ago", { exact: true }),
    ).toBeVisible();
    await page.locator("#review-game").selectOption("ats");
    await page.locator("#review-source").selectOption("manual");
    await page.getByRole("button", { name: "Decided", exact: true }).click();
    await expect.poll(() => mock.lists.at(-1)?.get("hold")).toBe("false");
    await expect(header.getByText("Awaiting decision overall (41)", { exact: true })).toBeVisible();
    expect(reads).toBe(1);
    summary = { computedAt, legacyReviewQueue: { count: 0, oldestAgeSeconds: null } };
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(header.getByText("Awaiting decision overall (0)", { exact: true })).toBeVisible();
    await expect(
      header.getByText("No other drivers' trips are waiting.", { exact: true }),
    ).toBeVisible();
    summary = { computedAt };
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      header.getByText("Overall queue totals are unavailable.", { exact: true }),
    ).toBeVisible();
    await expect(header.getByText("Awaiting decision overall (0)", { exact: true })).toHaveCount(0);
  },
);

for (const locale of ["en", "ru"] as const)
  test(
    `an own-only awaiting queue counts zero and explains the uncounted own trips (${locale})`,
    browserCase(["@functional"]),
    async ({ page }) => {
      await mockReview(page, { locale, awaiting: "own" });
      const summary: components["schemas"]["WorkspaceStage3Summary"] = {
        computedAt: "2026-11-12T08:00:00.000Z",
        legacyReviewQueue: { count: 0, oldestAgeSeconds: null },
      };
      await page.route("**/api/v1/me/workspace-summary?view=stage3", (route) =>
        route.fulfill({ json: envelope(summary) }),
      );
      await page.goto("/account/review");
      await catalogLanguage(page, locale);
      const header = page.locator(".review-queue-header");
      const copy =
        locale === "en"
          ? {
              total: "Awaiting decision overall (0)",
              none: "No other drivers' trips are waiting.",
              own: "Your own trips in this list are not counted: another reviewer decides on them.",
            }
          : {
              total: "Всего ждут решения (0)",
              none: "Нет рейсов других водителей, ожидающих решения.",
              own: "Ваши рейсы в этом списке не учитываются: решение по ним принимает другой проверяющий.",
            };
      // The list shows the own trip while the count, like the menu and the overview, excludes it.
      await expect(rowOf(page, reviewIds.own)).toContainText(text[locale].you);
      await expect(table(page).locator("tbody tr")).toHaveCount(1);
      await expect(header.getByText(copy.total, { exact: true })).toBeVisible();
      await expect(header.getByText(copy.none, { exact: true })).toBeVisible();
      await expect(header.getByText(copy.own, { exact: true })).toBeVisible();
      await page.getByRole("button", { name: text[locale].decided, exact: true }).click();
      await expect(header.getByText(copy.own, { exact: true })).toHaveCount(0);
      await expect(header.getByText(copy.total, { exact: true })).toBeVisible();
    },
  );

// Controlled synthetic review queue and decision panel (VTC-059); all data is fictional.
const text = {
  en: {
    title: "Review workspace",
    awaiting: "Awaiting decision",
    decided: "Decided",
    you: "(you)",
    own: "You cannot review your own manual report, including merged groups.",
    marker: "Accepted over limits",
    confirm: "I confirm acceptance over these limits",
  },
  ru: {
    title: "Диспетчерская",
    awaiting: "Ожидают решения",
    decided: "Решённые",
    you: "(вы)",
    own: "Нельзя проверять собственный ручной отчёт, включая объединённые группы.",
    marker: "Принят с превышением лимитов",
    confirm: "Подтверждаю принятие с превышением этих лимитов",
  },
} as const;
type Locale = keyof typeof text;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const queue = (page: Page) => page.locator(".review-queue");
const table = (page: Page) => page.locator("#review-queue-table");
const rowOf = (page: Page, id: string) =>
  table(page)
    .locator("tbody tr")
    .filter({ has: page.locator(`#trip-link-${id}`) });
const panel = (page: Page) => page.locator(".review-decision");
const form = (page: Page) => page.locator(".review-form");
const wide = (info: TestInfo) => info.project.name === "desktop-chromium";
const coarse = (page: Page) => page.evaluate(() => matchMedia("(pointer: coarse)").matches);

async function box(locator: Locator) {
  const value = await locator.boundingBox();
  if (!value) throw new Error("ELEMENT_NOT_RENDERED");
  return value;
}
async function noOverflow(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}
/**
 * Saves a full-height capture for the visual record. Headless Chrome briefly resizes the window
 * to 1x1 for a `fullPage` shot, which narrows below the side-panel layout and remounts it, so the
 * viewport grows to the page height instead and is restored afterwards.
 */
async function capture(page: Page, info: TestInfo, name: string) {
  await noOverflow(page);
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("VIEWPORT_MISSING");
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: viewport.width, height: Math.max(height, viewport.height) });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath(`${name}.png`) });
  await page.setViewportSize(viewport);
}
/** Words (outside .review-break and hidden text) whose text range spans several lines. */
async function brokenWords(root: Locator) {
  // Measure the design font: the Cyrillic subset loads only once Russian text renders.
  await root.page().evaluate(() => document.fonts.ready);
  return root.evaluate((element) => {
    const broken: string[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || parent.closest(".review-break, .visually-hidden, textarea, code")) continue;
      const head = parent.closest("thead");
      if (head && head.getBoundingClientRect().height <= 1) continue;
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
/** Table words with less than `margin` pixels to spare in their cell after padding and borders. */
async function tightWords(root: Locator, margin: number) {
  await root.page().evaluate(() => document.fonts.ready);
  return root.evaluate((table, need) => {
    const tight: string[] = [];
    const px = (value: string) => Number.parseFloat(value) || 0;
    const sides = (element: Element) => {
      const style = getComputedStyle(element);
      return (
        px(style.paddingLeft) +
        px(style.paddingRight) +
        px(style.borderLeftWidth) +
        px(style.borderRightWidth)
      );
    };
    for (const cell of Array.from(table.querySelectorAll<HTMLElement>("th, td"))) {
      if (cell.getBoundingClientRect().height <= 1) continue;
      const style = getComputedStyle(cell),
        own = px(style.paddingLeft) + px(style.paddingRight);
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement;
        // Badges are measured by badgesFit; the game chip and route link sit in one line box.
        if (!parent || parent.closest(".visually-hidden, .review-break, .badge, .trips-game"))
          continue;
        let room = cell.clientWidth - own;
        for (let up: Element | null = parent; up && up !== cell; up = up.parentElement)
          room -= sides(up);
        const value = node.textContent ?? "";
        for (const match of value.matchAll(/\S+/g)) {
          const range = document.createRange();
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);
          const rect = range.getBoundingClientRect(),
            bounds = cell.getBoundingClientRect(),
            // Text sharing a line box with a chip has less room than the cell: it must still end
            // inside the cell, while ordinary wrapping may leave any gap at the line end.
            edge = bounds.right - px(style.borderRightWidth) - px(style.paddingRight) - rect.right,
            spare = room - rect.width;
          if (spare < need || edge < -0.5)
            tight.push(`${match[0]} (${Math.min(spare, edge).toFixed(1)}px)`);
        }
      }
    }
    return tight;
  }, margin);
}
/** Badges whose narrowest layout leaves less than `margin` pixels in their cell. */
async function badgesFit(root: Locator, margin: number) {
  await root.page().evaluate(() => document.fonts.ready);
  return root.locator("tbody .badge").evaluateAll(
    (badges, need) =>
      badges.flatMap((badge) => {
        const cell = badge.closest("td, th");
        if (!cell) return [`${badge.textContent} (no cell)`];
        const px = (value: string) => Number.parseFloat(value) || 0,
          style = getComputedStyle(cell),
          rect = cell.getBoundingClientRect(),
          left = rect.left + px(style.borderLeftWidth) + px(style.paddingLeft),
          right = rect.right - px(style.borderRightWidth) - px(style.paddingRight),
          element = badge as HTMLElement,
          width = element.style.width;
        element.style.width = "min-content";
        const narrowest = element.getBoundingClientRect().width;
        element.style.width = width;
        const own = badge.getBoundingClientRect(),
          spare = right - left - narrowest;
        return spare < need || own.right > right + 0.5 || own.left < left - 0.5
          ? [`${badge.textContent} (${spare.toFixed(1)}px)`]
          : [];
      }),
    margin,
  );
}
/** Computed wrapping inside the feature never breaks words, and nothing scrolls sideways. */
async function wrapsBetweenWords(root: Locator) {
  const values = await root.evaluate((element) =>
    Array.from(element.querySelectorAll<HTMLElement>("td, th, p, li, h2, h3"))
      .filter((node) => !node.closest(".review-break"))
      .map((node) => getComputedStyle(node).overflowWrap),
  );
  expect(new Set(values)).toEqual(new Set(["normal"]));
  expect(await root.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
}
async function open(
  page: Page,
  path = "/account/review",
  options: ReviewMockOptions = {},
  locale: Locale = options.locale ?? "en",
) {
  const mock = await mockReview(page, { ...options, locale });
  await page.goto(path);
  await catalogLanguage(page, locale);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(text[locale].title);
  return mock;
}
/** Opens a trip: the side panel at 1280, the full review page below. */
async function openTrip(page: Page, info: TestInfo, id: string) {
  await page.locator(`#trip-link-${id}`).click();
  if (wide(info)) await expect(page).toHaveURL(new RegExp(`trip=${id}`));
  else await expect(page).toHaveURL(new RegExp(`/account/review/${id}`));
  await expect(panel(page).getByRole("heading", { level: 2 })).toBeVisible();
  await expect(panel(page).getByRole("status")).toHaveCount(0);
}
async function settled(page: Page) {
  await expect(panel(page).getByText(/^(Loading…|Загрузка…)$/)).toHaveCount(0);
}

for (const locale of ["en", "ru"] as const)
  test(
    `R1 ${locale} queue and decision panel fit side by side without broken words`,
    browserCase(["@layout"]),
    async ({ page }, info) => {
      const mock = await open(page, "/account/review", { locale });
      await expect(table(page).locator("tbody tr")).toHaveCount(5);
      expect(mock.lists.at(-1)?.toString()).toBe(
        `scope=review&hold=true&order=asc&locale=${locale}&limit=25`,
      );
      await expect(
        table(page).getByRole("columnheader", { name: locale === "en" ? "Revision" : "Редакция" }),
      ).toBeVisible();
      await expect(rowOf(page, reviewIds.own)).toContainText(text[locale].you);
      await expect(rowOf(page, reviewIds.over).locator(".review-flag")).toHaveAttribute(
        "data-flag",
        "exceeded",
      );
      expect(await brokenWords(queue(page))).toEqual([]);
      if (info.project.name !== "mobile-chromium") {
        await wrapsBetweenWords(table(page));
        expect(await tightWords(table(page), 4)).toEqual([]);
        expect(await badgesFit(table(page), 4)).toEqual([]);
      }
      await capture(page, info, `review-queue-${locale}`);
      await openTrip(page, info, reviewIds.over);
      await settled(page);
      if (wide(info)) {
        const list = await box(page.locator(".review-list-area")),
          side = await box(panel(page));
        expect(side.x).toBeGreaterThanOrEqual(list.x + list.width);
        await expect(panel(page).getByRole("heading", { level: 2 })).toBeFocused();
        // Beside the panel the queue keeps every column with room to spare.
        await wrapsBetweenWords(table(page));
        expect(await tightWords(table(page), 4)).toEqual([]);
        expect(await badgesFit(table(page), 4)).toEqual([]);
        expect(await brokenWords(table(page))).toEqual([]);
      }
      await wrapsBetweenWords(panel(page));
      expect(await brokenWords(panel(page))).toEqual([]);
      await capture(page, info, `review-panel-${locale}`);
      await expect(page.locator("body")).not.toContainText(/Достаточно суров|Yukon\?|Юкон\?/);
    },
  );

test(
  "R2 rows open the full page below 1200px with one column, coarse targets and a back link",
  browserCase(["@layout"]),
  async ({ page }, info) => {
    await open(page, "/account/review?tab=decided&order=asc");
    const awaiting = page.getByRole("button", { name: "Awaiting decision", exact: true });
    await awaiting.click();
    // Switching tabs drops the decided-tab order; the next filter starts from the new tab.
    await expect(awaiting).toHaveAttribute("aria-pressed", "true");
    await expect(page).not.toHaveURL(/order=/);
    await page.locator("#review-order").selectOption("desc");
    await expect(page).toHaveURL(/order=desc/);
    if (wide(info)) {
      await expect(page.locator(`#trip-link-${reviewIds.resubmission}`)).toHaveAttribute(
        "href",
        new RegExp(`trip=${reviewIds.resubmission}`),
      );
      await page.goto(`/account/review/${reviewIds.resubmission}?order=desc`);
    } else {
      await expect(page.locator(`#trip-link-${reviewIds.resubmission}`)).toHaveAttribute(
        "href",
        `/account/review/${reviewIds.resubmission}?order=desc`,
      );
      await page.locator(`#trip-link-${reviewIds.resubmission}`).click();
    }
    await expect(page).toHaveURL(new RegExp(`/account/review/${reviewIds.resubmission}`));
    await settled(page);
    const columns = await page
      .locator(".review-decision-columns")
      .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length);
    expect(columns).toBe(wide(info) ? 2 : 1);
    await noOverflow(page);
    expect(await brokenWords(panel(page))).toEqual([]);
    // Touch input raises the shared control and target heights.
    if (await coarse(page))
      for (const target of [
        page.locator("#review-choice-accept"),
        page.locator("#review-choice-reject"),
        page.getByRole("button", { name: "Record decision", exact: true }),
        page.getByRole("button", { name: /^View/ }).first(),
        page.getByRole("link", { name: "Back to queue", exact: true }),
      ])
        expect((await box(target)).height).toBeGreaterThanOrEqual(40);
    await capture(page, info, "review-full-page-narrow-en");
    const back = page.getByRole("link", { name: "Back to queue", exact: true });
    await expect(back).toHaveAttribute("href", "/account/review?order=desc");
    await back.click();
    await expect(page).toHaveURL(/\/account\/review\?order=desc$/);
    await expect(page.locator("#review-order")).toHaveValue("desc");
  },
);

test(
  "R3 over-limit acceptance lists every limit and sends the confirmed flag",
  browserCase(["@functional", "@smoke-review"]),
  async ({ page }, info) => {
    const mock = await open(page);
    await openTrip(page, info, reviewIds.over);
    await settled(page);
    const submit = form(page).getByRole("button", { name: "Record decision", exact: true });
    await expect(submit).toBeDisabled();
    await page.locator("#review-choice-accept").click();
    await expect(page.locator("#review-choice-accept")).toHaveAttribute("aria-pressed", "true");
    const box$ = form(page).locator(".review-over-limits"),
      limits = box$.locator(".review-limits li");
    await expect(limits).toHaveCount(2);
    await expect(limits.nth(0)).toHaveText("Cargo mass 34 t exceeds the 20 t limit");
    await expect(limits.nth(1)).toContainText("Trailer type is not allowed: Fictional lowboy");
    const accept = form(page).getByRole("button", { name: "Accept trip", exact: true });
    await expect(accept).toBeDisabled();
    await page.locator("#review-reason").fill("   ");
    await expect(accept).toBeDisabled();
    await page.locator("#review-reason").fill("Fictional waiver\nchecked against two screenshots");
    await expect(accept).toBeDisabled();
    await expect(form(page).getByText("Confirm acceptance over the limits first.")).toBeVisible();
    const check = page.locator("#review-confirm-limits");
    await expect(check).toHaveAccessibleDescription(/Cargo mass 34 t exceeds the 20 t limit/);
    await check.check();
    await expect(accept).toBeEnabled();
    await capture(page, info, "review-over-limits-side-en");
    await accept.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(text.en.marker);
    await expect(dialog.locator(".review-multiline")).toHaveCSS("white-space", "pre-line");
    await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(form(page).getByRole("status")).toHaveText("Server confirmed the command.");
    expect(mock.posts).toHaveLength(1);
    const [post] = mock.posts;
    expect(post?.body).toEqual({
      decision: "accept",
      reviewedRevisionId: mock.states.over.review.trip.manualRevision?.id,
      factRevisionId: mock.states.over.review.factRevisionId,
      proposalId: null,
      reason: "Fictional waiver\nchecked against two screenshots",
      confirmOverLimits: true,
    });
    expect(post?.headers["if-match"]).toBe('"v1"');
    expect(post?.headers["idempotency-key"]).toMatch(uuid);
    expect(post?.headers["x-csrf-token"]).toBe("NONFUNCTIONAL_FIXTURE");
    const history = panel(page).locator(".review-history li").first();
    await expect(history).toContainText("Trip accepted");
    await expect(history).toContainText(text.en.marker);
    await expect(history).toContainText(reviewer.nickname);
    // The refreshed review version needs a new confirmation.
    await expect(check).not.toBeChecked();
    if (wide(info)) {
      // The trip left Awaiting; the panel stays open and Close hands focus to the table.
      await expect(page.locator(`#trip-link-${reviewIds.over}`)).toHaveCount(0);
      await expect(panel(page)).toBeVisible();
      await panel(page).getByRole("button", { name: "Close details", exact: true }).click();
      await expect(table(page)).toBeFocused();
    }
  },
);

test(
  "R4 ordinary accept and reject send exact bodies and keep line breaks",
  browserCase(["@functional"]),
  async ({ page }, info) => {
    const mock = await open(page, `/account/review/${reviewIds.resubmission}`);
    await settled(page);
    await page.locator("#review-choice-reject").click();
    await expect(form(page).getByText("Rejection reason", { exact: true })).toBeVisible();
    await expect(page.locator("#review-reason")).toHaveAccessibleDescription(
      "Required. Visible to the author and staff.",
    );
    const reject = form(page).getByRole("button", { name: "Reject trip", exact: true });
    await page.locator("#review-reason").fill(" \n  ");
    await expect(reject).toBeDisabled();
    await expect(reject).toHaveAccessibleDescription("Enter the reason before submitting.");
    await page.locator("#review-reason").fill("  Fictional first line\nFictional second line  ");
    await reject.click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(JSON.stringify(mock.posts[0]?.body)).toBe(
      JSON.stringify({
        decision: "reject",
        reviewedRevisionId: mock.states.resubmission.review.trip.manualRevision?.id,
        factRevisionId: mock.states.resubmission.review.factRevisionId,
        proposalId: null,
        reason: "Fictional first line\nFictional second line",
      }),
    );
    const latest = panel(page).locator(".review-history li").first();
    await expect(latest).toContainText("Trip rejected");
    const lines = await latest.locator(".review-multiline").evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top))).size;
    });
    expect(lines).toBeGreaterThanOrEqual(2);
    // A new decision on the same trip: an ordinary accept never carries the over-limit flag.
    await expect(form(page).getByRole("heading", { name: "Record a new decision" })).toBeVisible();
    await page.locator("#review-choice-accept").click();
    await expect(form(page).locator(".review-over-limits")).toHaveCount(0);
    await form(page).getByRole("button", { name: "Accept trip", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
    await expect.poll(() => mock.posts.length).toBe(2);
    expect(mock.posts[1]?.body).not.toHaveProperty("confirmOverLimits");
    expect(mock.posts[1]?.headers["if-match"]).toBe('"v2"');
    await noOverflow(page);
    expect(info.project.name).toBeTruthy();
  },
);

test(
  "R5 unavailable acceptance is explained while rejection still works",
  browserCase(["@functional"]),
  async ({ page }, info) => {
    const mock = await open(page, `/account/review/${reviewIds.late}`);
    await settled(page);
    const accept = page.locator("#review-choice-accept");
    await expect(accept).toBeDisabled();
    await expect(accept).toHaveAccessibleDescription(
      "Acceptance is unavailable: The trip has a telemetry source",
    );
    // aria-disabled keeps the choice focusable for its explanation; activating it does nothing.
    await accept.click({ force: true });
    await expect(accept).toHaveAttribute("aria-pressed", "false");
    // The waived decision stays in the history with its marker and reviewer.
    await expect(panel(page).locator(".review-history")).toContainText(text.en.marker);
    await page.locator("#review-choice-reject").click();
    await page.locator("#review-reason").fill("Fictional telemetry confirms the breach");
    await form(page).getByRole("button", { name: "Reject trip", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
    await expect.poll(() => mock.posts.length).toBe(1);
    expect(mock.posts[0]?.body.decision).toBe("reject");
    await capture(page, info, "review-unavailable-en");
  },
);

for (const locale of ["en", "ru"] as const)
  test(
    `R6 ${locale} own report shows a note and no decision controls`,
    browserCase(["@layout"]),
    async ({ page }, info) => {
      const mock = await open(page, "/account/review", { locale });
      await expect(rowOf(page, reviewIds.own).locator(".review-driver")).toContainText(
        `${member.nickname}`,
      );
      await openTrip(page, info, reviewIds.own);
      await settled(page);
      await expect(form(page).getByRole("note")).toHaveText(text[locale].own);
      for (const id of ["#review-choice-accept", "#review-choice-reject", "#review-reason"])
        await expect(page.locator(id)).toHaveCount(0);
      await expect(form(page).getByRole("button")).toHaveCount(0);
      await capture(page, info, `review-own-${locale}`);
      expect(mock.posts).toEqual([]);
    },
  );

test(
  "R7 diff marks changed fields in text and first submissions have no previous column",
  browserCase(["@layout"]),
  async ({ page }) => {
    await open(page, `/account/review/${reviewIds.resubmission}`);
    await settled(page);
    const diff = panel(page).locator(".review-diff");
    await expect(diff.locator("thead th")).toHaveText([
      "Field",
      "Revision 2 · current",
      "Revision 1",
    ]);
    await expect(
      panel(page).getByText("Changes against revision 1 of the same report."),
    ).toBeVisible();
    const changed = diff.locator("tbody tr[data-changed]");
    await expect(changed.locator("th")).toHaveText([
      "Cargo",
      "Cargo mass",
      "Actual driven distance",
      "Comment",
    ]);
    for (const row of await changed.all()) await expect(row).toContainText("Changed");
    // An unknown catalog entity keeps its canonical ID as text only.
    await expect(changed.first().locator(".review-previous")).toContainText("Unknown entity");
    await expect(changed.first().locator(".review-previous .visually-hidden")).toHaveText(
      ` ${entities.unknown}`,
    );
    await expect(diff.getByText("Fictional transformer").first()).toBeVisible();
    const check = panel(page).locator(".review-checks li");
    await expect(check.nth(1)).toHaveAttribute("data-state", "bypassed");
    await expect(check.nth(1)).toContainText("Bypassed by event");
    await page.goto(`/account/review/${reviewIds.over}`);
    await settled(page);
    await expect(panel(page).locator(".review-diff thead th")).toHaveCount(2);
    await expect(
      panel(page).getByText("First submission: there is nothing to compare."),
    ).toBeVisible();
    await page.goto(`/account/review/${reviewIds.telemetry}`);
    await expect(panel(page).getByRole("heading", { level: 3, name: "History" })).toBeVisible();
    await expect(panel(page).locator(".review-diff")).toHaveCount(0);
    await expect(panel(page).getByRole("heading", { name: "Evidence" })).toHaveCount(0);
    await expect(panel(page).locator(".review-checks li")).toContainText(
      "Qualification history is unknown",
    );
  },
);

test(
  "R8 evidence opens on demand in a fitting dialog and expired images say so",
  browserCase(["@layout"]),
  async ({ page }, info) => {
    await open(page, `/account/review/${reviewIds.over}`);
    await settled(page);
    const items = panel(page).locator(".review-evidence li");
    await expect(items).toHaveCount(3);
    await expect(items.nth(2)).toContainText("Expired");
    await expect(items.nth(2).getByRole("button")).toHaveCount(0);
    const view = items.nth(0).getByRole("button", { name: "View Evidence 1", exact: true });
    await view.click();
    const dialog = page.getByRole("dialog", { name: "Evidence 1" });
    await expect(dialog.getByRole("img", { name: "Evidence 1" })).toBeVisible();
    const rect = await box(dialog),
      viewport = page.viewportSize();
    if (!viewport) throw new Error("VIEWPORT_MISSING");
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width);
    expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height);
    await capture(page, info, "review-evidence-en");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(view).toBeFocused();
    await expect(page.locator(`#trip-link-${reviewIds.over}`)).toHaveCount(0);
    await items.nth(1).getByRole("button", { name: "View Evidence 2", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Evidence 2" })).toContainText("Expired");
    await page.keyboard.press("Escape");
    expect(evidence.ready).toMatch(uuid);
  },
);

test(
  "R9 empty, filtered, failed, missing and forbidden states offer a next step",
  browserCase(["@functional"]),
  async ({ page }, info) => {
    const mock = await open(page, "/account/review", { awaiting: "empty" });
    await expect(queue(page).getByText("No reports are waiting for a decision.")).toBeVisible();
    const decided = page.getByRole("button", { name: "Show decided trips", exact: true });
    await capture(page, info, "review-empty-en");
    await decided.click();
    // The empty-state button unmounts; focus moves to the chosen tab rather than the document.
    const decidedTab = page.getByRole("button", { name: text.en.decided, exact: true });
    await expect(decidedTab).toHaveAttribute("aria-pressed", "true");
    await expect(decidedTab).toBeFocused();
    await expect.poll(() => mock.lists.at(-1)?.get("hold")).toBe("false");
    await page.locator("#review-game").selectOption("ats");
    await expect(queue(page).getByText("No trips match these filters.")).toBeVisible();
    await page.getByRole("button", { name: "Reset filters", exact: true }).click();
    await expect(page.locator("#review-game")).toHaveValue("");
    await expect(page.locator("#review-game")).toBeFocused();
    await expect.poll(() => mock.lists.at(-1)?.has("game")).toBe(false);
    await page.unrouteAll({ behavior: "ignoreErrors" });
    const failing = await open(page, "/account/review", { awaiting: 503 });
    await expect(queue(page).getByRole("alert")).toBeVisible();
    await capture(page, info, "review-error-en");
    failing.recover();
    await queue(page).getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(table(page).locator("tbody tr")).toHaveCount(5);
    await page.goto(`/account/review/${reviewIds.missing}`);
    await expect(panel(page).getByRole("alert")).toContainText(
      "This record is unavailable or inaccessible.",
    );
    await expect(page.getByRole("link", { name: "Back to queue", exact: true })).toBeVisible();
    await page.unrouteAll({ behavior: "ignoreErrors" });
    const forbidden = await open(page, "/account/review", { forbidden: true });
    await expect(
      page.getByText("Your current permissions do not allow this action.", { exact: true }),
    ).toBeVisible();
    expect(forbidden.lists).toEqual([]);
  },
);

test(
  "R10 keyboard: pressed tabs keep focus, Enter opens the panel and Escape returns",
  browserCase(["@layout"]),
  async ({ page }, info) => {
    await open(page);
    const decided = page.getByRole("button", { name: text.en.decided, exact: true });
    await decided.focus();
    await page.keyboard.press("Enter");
    await expect(decided).toHaveAttribute("aria-pressed", "true");
    await expect(decided).toBeFocused();
    const awaiting = page.getByRole("button", { name: text.en.awaiting, exact: true });
    await page.keyboard.press("Shift+Tab");
    await expect(awaiting).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(awaiting).toHaveAttribute("aria-pressed", "true");
    await expect(awaiting).toBeFocused();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(page.locator("#review-game")).toBeFocused();
    // Filter keyboard behavior applies at every width; only wide screens have the side panel.
    if (!wide(info)) return;
    const link = page.locator(`#trip-link-${reviewIds.resubmission}`);
    await link.focus();
    await page.keyboard.press("Enter");
    const heading = panel(page).getByRole("heading", { level: 2 });
    await expect(heading).toBeFocused();
    await settled(page);
    await page.keyboard.press("Shift+Tab");
    await expect(
      panel(page).getByRole("button", { name: "Close details", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(panel(page)).toHaveCount(0);
    await expect(link).toBeFocused();
    // Escape inside a confirmation closes only the dialog.
    await link.press("Enter");
    await settled(page);
    await page.locator("#review-choice-reject").click();
    await page.locator("#review-reason").fill("Fictional keyboard reason");
    await form(page).getByRole("button", { name: "Reject trip", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(panel(page)).toBeVisible();
    await expect(
      form(page).getByRole("button", { name: "Reject trip", exact: true }),
    ).toBeFocused();
  },
);

test(
  "R11 a 409 closes the confirmation, keeps the reason and resets the confirmation",
  browserCase(["@functional"]),
  async ({ page }, info) => {
    const mock = await open(page, `/account/review/${reviewIds.over}`, { firstDecision: 409 });
    await settled(page);
    await page.locator("#review-choice-accept").click();
    await page.locator("#review-reason").fill("Fictional retained waiver");
    await page.locator("#review-confirm-limits").check();
    await form(page).getByRole("button", { name: "Accept trip", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(form(page).getByRole("alert")).toContainText("record changed");
    await expect(page.getByText("PRIVATE_SENTINEL")).toHaveCount(0);
    await expect(page.locator("#review-reason")).toHaveValue("Fictional retained waiver");
    await expect(page.locator("#review-confirm-limits")).not.toBeChecked();
    const accept = form(page).getByRole("button", { name: "Accept trip", exact: true });
    await expect(accept).toBeDisabled();
    // Focus never falls back to the document when the trigger is disabled.
    await expect
      .poll(() => page.evaluate(() => document.activeElement !== document.body))
      .toBe(true);
    await page.locator("#review-confirm-limits").check();
    await accept.click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
    await expect.poll(() => mock.posts.length).toBe(2);
    expect(mock.posts.map((post) => post.headers["if-match"])).toEqual(['"v1"', '"v2"']);
    expect(mock.posts[0]?.headers["idempotency-key"]).not.toBe(
      mock.posts[1]?.headers["idempotency-key"],
    );
    expect(mock.posts[1]?.body.confirmOverLimits).toBe(true);
    expect(info.project.name).toBeTruthy();
  },
);

for (const locale of ["en", "ru"] as const)
  test(
    `R12 ${locale} rendered review states for the visual record`,
    browserCase(["@layout"]),
    async ({ page }, info) => {
      await open(page, `/account/review/${reviewIds.over}`, { locale });
      await settled(page);
      await page.locator("#review-choice-accept").click();
      await expect(form(page).locator(".review-over-limits")).toBeVisible();
      await expect(page.getByText(text[locale].confirm)).toBeVisible();
      expect(await brokenWords(panel(page))).toEqual([]);
      await capture(page, info, `review-over-limits-${locale}`);
      await panel(page).locator(".review-evidence li").first().getByRole("button").click();
      await expect(page.getByRole("dialog").getByRole("img")).toBeVisible();
      await capture(page, info, `review-evidence-${locale}`);
      await page.keyboard.press("Escape");
      await page.goto(`/account/review/${reviewIds.resubmission}`);
      await settled(page);
      expect(await brokenWords(panel(page))).toEqual([]);
      await wrapsBetweenWords(panel(page));
      await capture(page, info, `review-full-page-${locale}`);
      await expect(panel(page).locator(".review-history")).toContainText(
        rejection.split("\n")[0] ?? "",
      );
    },
  );

const factsText = {
  en: { facts: "Effective facts", held: "Why it is held:", unavailable: "Unavailable" },
  ru: { facts: "Действующие факты", held: "Почему на проверке:", unavailable: "Недоступно" },
} as const;
for (const locale of ["en", "ru"] as const)
  test(
    `R13 ${locale} telemetry and late-telemetry reviews show trip facts and hold reasons`,
    browserCase(["@layout"]),
    async ({ page }, info) => {
      await open(page, "/account/review", { locale });
      const words = factsText[locale];
      await openTrip(page, info, reviewIds.telemetry);
      await settled(page);
      const hold = panel(page).locator(".review-hold");
      await expect(hold).toContainText(words.held);
      await expect(hold).toContainText(
        locale === "en" ? "Qualification history is unknown" : "История квалификации неизвестна",
      );
      await expect(hold).toContainText(
        locale === "en"
          ? "The game clock looks inconsistent"
          : "Игровые часы выглядят несогласованными",
      );
      // A code without a label stays readable as the code itself.
      await expect(hold.locator("code")).toHaveText("fictional_unlabeled_hold");
      const facts = panel(page).getByRole("region", { name: words.facts });
      const fact = (label: string) =>
        facts
          .locator(".review-facts > div")
          .filter({ has: page.locator("dt").getByText(label, { exact: true }) })
          .locator("dd");
      await expect(fact(locale === "en" ? "Cargo" : "Груз")).toContainText(
        locale === "en" ? "Fictional lumber" : "Вымышленный лес",
      );
      await expect(fact(locale === "en" ? "Origin city" : "Город отправления")).toContainText(
        locale === "en" ? "Fictional Mesa" : "Вымышленная Меса",
      );
      // Unknown mass and planned distance read as unavailable, never as zero.
      await expect(fact(locale === "en" ? "Cargo mass" : "Масса груза")).toHaveText(
        words.unavailable,
      );
      await expect(fact(locale === "en" ? "Planned distance" : "Плановая дистанция")).toHaveText(
        words.unavailable,
      );
      await expect(
        fact(locale === "en" ? "Actual driven distance" : "Фактический пробег"),
      ).not.toHaveText(words.unavailable);
      await expect(facts).not.toContainText(/(^|\s)0 (t|т|km|км)/);
      await expect(panel(page).locator(".review-diff")).toHaveCount(0);
      await wrapsBetweenWords(panel(page));
      expect(await brokenWords(panel(page))).toEqual([]);
      await capture(page, info, `review-telemetry-${locale}`);
      await page.goto(`/account/review/${reviewIds.telemetry}`);
      await settled(page);
      await expect(panel(page).getByRole("region", { name: words.facts })).toBeVisible();
      await expect(panel(page).locator(".review-hold")).toContainText(words.held);
      await capture(page, info, `review-telemetry-page-${locale}`);
      // Late telemetry: the confirmed facts sit beside the diff of the earlier manual revision.
      await page.goto(`/account/review/${reviewIds.late}`);
      await settled(page);
      await expect(panel(page).locator(".review-hold")).toContainText(
        locale === "en"
          ? "Confirmed facts changed after the decision"
          : "Подтверждённые факты изменились",
      );
      const late = panel(page).getByRole("region", { name: words.facts });
      await expect(late.locator("dd").filter({ hasText: /^21 (t|т)$/ })).toHaveCount(1);
      await expect(panel(page).locator(".review-diff")).toBeVisible();
      expect(await brokenWords(panel(page))).toEqual([]);
      await capture(page, info, `review-late-page-${locale}`);
      if (wide(info)) {
        await page.goto(`/account/review?trip=${reviewIds.late}`);
        await settled(page);
        await expect(panel(page).getByRole("region", { name: words.facts })).toBeVisible();
        await capture(page, info, `review-late-${locale}`);
      }
    },
  );

for (const locale of ["en", "ru"] as const)
  test(
    `R16 ${locale} manual trips show the revision diff first, then effective facts`,
    browserCase(["@layout"]),
    async ({ page }, info) => {
      await open(page, "/account/review", { locale });
      const words = factsText[locale];
      await openTrip(page, info, reviewIds.resubmission);
      await settled(page);
      const diff = panel(page).locator(".review-diff"),
        facts = panel(page).getByRole("region", { name: words.facts });
      await expect(diff).toBeVisible();
      await expect(facts).toContainText(locale === "en" ? "Source: Manual" : "Источник: Ручной");
      // A staff resolution changed the distance without a new revision; the facts show it.
      await expect(facts).toContainText(/1[,\s]012 (km|км)/);
      expect((await box(facts)).y).toBeGreaterThan((await box(diff)).y);
      expect(await brokenWords(panel(page))).toEqual([]);
      await capture(page, info, `review-manual-${locale}`);
      // A manual trip whose read has no effective facts shows only its revision.
      await page.goto(`/account/review/${reviewIds.over}`);
      await settled(page);
      await expect(panel(page).locator(".review-diff")).toBeVisible();
      await expect(panel(page).getByRole("region", { name: words.facts })).toHaveCount(0);
    },
  );

test(
  "R14 Escape inside the decision form keeps the draft; elsewhere it closes the panel",
  browserCase(["@layout", "@viewport-desktop"]),
  async ({ page }, info) => {
    await open(page);
    await openTrip(page, info, reviewIds.over);
    await settled(page);
    await page.locator("#review-choice-accept").click();
    await page.locator("#review-choice-accept").press("Escape");
    await page.locator("#review-reason").fill("Fictional draft kept");
    await page.locator("#review-reason").press("Escape");
    await page.locator("#review-confirm-limits").check();
    await page.locator("#review-confirm-limits").press("Escape");
    await expect(panel(page)).toBeVisible();
    await expect(page.locator("#review-reason")).toHaveValue("Fictional draft kept");
    await expect(page.locator("#review-choice-accept")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#review-confirm-limits")).toBeChecked();
    // An IME composition's Escape never closes the panel either, even outside the form.
    const heading = panel(page).getByRole("heading", { level: 2 });
    await heading.focus();
    await heading.evaluate((node) =>
      node.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, isComposing: true }),
      ),
    );
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel(page)).toHaveCount(0);
    await expect(page.locator(`#trip-link-${reviewIds.over}`)).toBeFocused();
    // After a decision focus lands on the form heading; Escape there closes the panel. The decided
    // trip left Awaiting, so focus falls back to the queue table.
    await page.locator(`#trip-link-${reviewIds.over}`).press("Enter");
    await settled(page);
    await page.locator("#review-choice-accept").click();
    await page.locator("#review-reason").fill("Fictional waiver");
    await page.locator("#review-confirm-limits").check();
    await form(page).getByRole("button", { name: "Accept trip", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(form(page).getByRole("status")).toBeVisible();
    const decisionHeading = form(page).getByRole("heading", { level: 3 }).first();
    await expect(decisionHeading).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(panel(page)).toHaveCount(0);
    await expect(table(page)).toBeFocused();
  },
);

// A tab switch and a filter change in quick succession keep both (router updates are
// transitions, so each update must start from the committed URL). No waits in between.
test(
  "R15a Awaiting then an immediate order change keeps both",
  browserCase(["@functional"]),
  async ({ page }) => {
    await open(page, "/account/review?tab=decided&order=asc");
    await page.getByRole("button", { name: text.en.awaiting, exact: true }).click();
    await page.locator("#review-order").selectOption("desc");
    await expect(page).toHaveURL(/\/account\/review\?order=desc$/);
    await expect(page.getByRole("button", { name: text.en.awaiting, exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  },
);

test(
  "R15b Decided then an immediate game change keeps both",
  browserCase(["@functional"]),
  async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: text.en.decided, exact: true }).click();
    await page.locator("#review-game").selectOption("ats");
    await expect(page).toHaveURL(/\/account\/review\?tab=decided&game=ats$/);
    await expect(page.locator("#review-game")).toHaveValue("ats");
  },
);

test(
  "R15c a tab click and an order change dispatched in one task keep both",
  browserCase(["@functional"]),
  async ({ page }) => {
    await open(page, "/account/review?tab=decided&order=asc");
    await page.evaluate(() => {
      const [awaiting] = Array.from(
        document.querySelectorAll<HTMLButtonElement>(".review-tabs button"),
      );
      const order = document.getElementById("review-order") as HTMLSelectElement;
      awaiting?.click();
      order.value = "desc";
      order.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(page).toHaveURL(/\/account\/review\?order=desc$/);
    await expect(page.locator("#review-order")).toHaveValue("desc");
  },
);

// Source filter (VTC-077): the shared listTrips `source` parameter on both queue tabs.
const lastList = (mock: { lists: URLSearchParams[] }) => () => mock.lists.at(-1)?.toString();
/** Every cursor the queue sent belongs to the source filter of its own request. */
function cursorsMatchSource(lists: URLSearchParams[]) {
  for (const request of lists)
    if (request.has("cursor"))
      expect(request.get("cursor"), request.toString()).toBe(
        `page-2.${request.get("source") ?? "any"}`,
      );
}
test(
  "R17a source filter sends the parameter, restarts paging, closes the panel and keeps focus",
  browserCase(["@functional"]),
  async ({ page }, info) => {
    const mock = await open(
      page,
      wide(info) ? `/account/review?trip=${reviewIds.over}` : "/account/review",
      { paged: true },
    );
    if (wide(info)) await expect(panel(page)).toBeVisible();
    const source = page.locator("#review-source");
    await expect(page.getByRole("combobox", { name: "Source", exact: true })).toBeVisible();
    await expect(source.locator("option")).toHaveText(["Any source", "Telemetry", "Manual report"]);
    await expect(source).toHaveValue("");
    await page.locator("#review-game").focus();
    await page.keyboard.press("Tab");
    await expect(source).toBeFocused();
    await source.selectOption("manual");
    await expect(page).toHaveURL(/[?&]source=manual(&|$)/);
    await expect(page).not.toHaveURL(/[?&](trip|cursor)=/);
    await expect
      .poll(lastList(mock))
      .toBe("scope=review&hold=true&source=manual&order=asc&locale=en&limit=25");
    await expect(source).toBeFocused();
    await expect(panel(page)).toHaveCount(0);
    await expect(table(page).locator("tbody tr")).toHaveCount(2);
    await page.getByRole("button", { name: "Next page", exact: true }).click();
    await expect
      .poll(lastList(mock))
      .toBe(
        "scope=review&hold=true&source=manual&order=asc&locale=en&limit=25&cursor=page-2.manual",
      );
    await expect(page.getByRole("button", { name: "Previous page", exact: true })).toBeEnabled();
    if (wide(info)) {
      await page.locator(`#trip-link-${reviewIds.resubmission}`).click();
      await expect(page).toHaveURL(new RegExp(`trip=${reviewIds.resubmission}`));
      await expect(panel(page)).toBeVisible();
    }
    // Focus left the select for paging (and the row on desktop); the reviewer returns to it.
    await source.focus();
    await source.selectOption("ets2telemetry");
    await expect
      .poll(lastList(mock))
      .toBe("scope=review&hold=true&source=ets2telemetry&order=asc&locale=en&limit=25");
    await expect(page.getByRole("button", { name: "Previous page", exact: true })).toBeDisabled();
    await expect(page).not.toHaveURL(/[?&](trip|cursor)=/);
    await expect(panel(page)).toHaveCount(0);
    await expect(source).toBeFocused();
    await expect(queue(page).getByRole("alert")).toHaveCount(0);
    cursorsMatchSource(mock.lists);
  },
);

test(
  "R17b tabs keep the source, Reset clears it and Back restores it",
  browserCase(["@functional"]),
  async ({ page }) => {
    const mock = await open(page, "/account/review?source=ets2telemetry");
    const source = page.locator("#review-source");
    await expect(source).toHaveValue("ets2telemetry");
    await page.getByRole("button", { name: text.en.decided, exact: true }).click();
    await expect
      .poll(lastList(mock))
      .toBe("scope=review&hold=false&source=ets2telemetry&order=desc&locale=en&limit=25");
    await expect(source).toHaveValue("ets2telemetry");
    await expect(queue(page).getByText("No trips match these filters.")).toBeVisible();
    await page.getByRole("button", { name: "Reset filters", exact: true }).click();
    await expect(page).toHaveURL(/\/account\/review\?tab=decided$/);
    await expect(source).toHaveValue("");
    await expect(page.locator("#review-game")).toBeFocused();
    await expect.poll(lastList(mock)).toBe("scope=review&hold=false&order=desc&locale=en&limit=25");
    await page.goBack();
    await expect(page).toHaveURL(/[?&]source=ets2telemetry(&|$)/);
    await expect(source).toHaveValue("ets2telemetry");
    await page.unrouteAll({ behavior: "ignoreErrors" });
    // An empty Awaiting tab is "filtered" only by a valid source.
    await open(page, "/account/review?source=manual", { awaiting: "empty" });
    await expect(queue(page).getByText("No trips match these filters.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Reset filters", exact: true })).toBeVisible();
    await page.goto("/account/review?source=bogus");
    await expect(queue(page).getByText("No reports are waiting for a decision.")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Show decided trips", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Reset filters", exact: true })).toHaveCount(0);
  },
);

test(
  "R17c unknown sources are never sent, rapid changes keep both and back links carry it",
  browserCase(["@functional"]),
  async ({ page }, info) => {
    const mock = await open(page, "/account/review?source=bogus");
    const source = page.locator("#review-source");
    await expect(source).toHaveValue("");
    await expect.poll(lastList(mock)).toBe("scope=review&hold=true&order=asc&locale=en&limit=25");
    // Two filter changes dispatched in one task: each starts from the committed URL.
    await page.evaluate(() => {
      for (const [id, value] of [
        ["review-game", "ats"],
        ["review-source", "manual"],
      ] as const) {
        const select = document.getElementById(id);
        if (!(select instanceof HTMLSelectElement)) throw new Error("FILTER_NOT_RENDERED");
        select.value = value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    await expect(page).toHaveURL(/[?&]game=ats(&|$)/);
    await expect(page).toHaveURL(/[?&]source=manual(&|$)/);
    await expect
      .poll(lastList(mock))
      .toBe("scope=review&hold=true&game=ats&source=manual&order=asc&locale=en&limit=25");
    expect(mock.lists.some((request) => request.get("source") === "bogus")).toBe(false);
    await page.goto("/account/review");
    await page.getByRole("button", { name: text.en.decided, exact: true }).click();
    await source.selectOption("manual");
    await expect(page).toHaveURL(/\/account\/review\?tab=decided&source=manual$/);
    await expect(source).toHaveValue("manual");
    await page.goto("/account/review?source=manual");
    const link = page.locator(`#trip-link-${reviewIds.over}`);
    if (wide(info)) {
      await expect(link).toHaveAttribute("href", /[?&]source=manual(&|$)/);
      await expect(link).toHaveAttribute("href", new RegExp(`[?&]trip=${reviewIds.over}(&|$)`));
    } else
      await expect(link).toHaveAttribute("href", `/account/review/${reviewIds.over}?source=manual`);
    await page.goto(`/account/review/${reviewIds.over}?source=manual`);
    await expect(page.getByRole("link", { name: "Back to queue", exact: true })).toHaveAttribute(
      "href",
      "/account/review?source=manual",
    );
  },
);

const wideFont = ".review-toolbar, .review-toolbar * { letter-spacing: 0.06em !important; }";
/**
 * Queue toolbar geometry: spare width once the tabs, the bar gap and the filters with their own
 * gaps share one row (spareControls) or the filters alone (spareSelects); the room left beside
 * the tabs and the widest single filter when items wrap; row alignment; and the timezone note.
 * The arrangement follows the CSS: phones (760px viewport and below) stack the controls, a toolbar
 * of 1000px or more keeps the tabs and filters on one row, narrower toolbars put the filters on a
 * row below the tabs.
 */
function toolbarBudget(page: Page) {
  return page.evaluate(async () => {
    await document.fonts.ready;
    const bar = document.querySelector(".review-queue .review-toolbar"),
      tabs = bar?.querySelector(".review-tabs"),
      group = bar?.querySelector(".review-filters"),
      timezone = bar?.querySelector(".review-timezone");
    if (!bar || !tabs || !group || !timezone) throw new Error("TOOLBAR_NOT_RENDERED");
    const box = (element: Element) => element.getBoundingClientRect(),
      gapOf = (element: Element) => Number.parseFloat(getComputedStyle(element).columnGap) || 0,
      filters = Array.from(group.querySelectorAll(".review-filter")),
      selects = Array.from(bar.querySelectorAll("select")),
      width = box(bar).width,
      used =
        filters.reduce((total, element) => total + box(element).width, 0) +
        gapOf(group) * Math.max(0, filters.length - 1);
    const spread = (list: Element[]) => {
      const centres = list.map((element) => box(element).top + box(element).height / 2);
      return Math.max(...centres) - Math.min(...centres);
    };
    const inside = (element: Element) =>
      box(element).left >= box(bar).left - 0.5 &&
      box(element).right <= box(bar).right + 0.5 &&
      box(element).right <= window.innerWidth &&
      box(element).top >= box(bar).top - 0.5 &&
      box(element).bottom <= box(bar).bottom + 0.5;
    const overlaps = (a: DOMRect, b: DOMRect) =>
      a.left < b.right - 0.5 &&
      b.left < a.right - 0.5 &&
      a.top < b.bottom - 0.5 &&
      b.top < a.bottom - 0.5;
    const round = (value: number) => Math.round(value * 10) / 10;
    const arrangement = window.innerWidth <= 760 ? "phone" : width >= 1000 ? "one-row" : "two-row";
    return {
      arrangement,
      width: round(width),
      filters: filters.length,
      filterWidths: [tabs, ...filters].map((element) => round(box(element).width)),
      spareControls: round(width - box(tabs).width - gapOf(bar) - used),
      spareSelects: round(width - used),
      rowSpreadControls: round(spread([tabs, ...filters])),
      rowSpreadSelects: round(spread(filters)),
      filtersBelowTabs: filters.every((filter) => box(filter).top >= box(tabs).bottom - 0.5),
      timezoneBelowFilters: box(timezone).top >= box(group).bottom - 0.5,
      tabsSpare: round(width - box(tabs).width),
      widestSelectSpare: round(width - Math.max(...filters.map((f) => box(f).width))),
      selectHeights: selects.map((select) => round(box(select).height)),
      selectsInside: selects.every(inside),
      timezoneInside: inside(timezone),
      timezoneOverlaps: [tabs, ...filters].some((element) => overlaps(box(timezone), box(element))),
    };
  });
}
test(
  "R17d a rejected cursor restarts the same filters at the first page without an error",
  browserCase(["@functional"]),
  async ({ page }, info) => {
    const search = `?source=manual${wide(info) ? `&trip=${reviewIds.over}` : ""}`;
    const mock = await open(page, `/account/review${search}`, { paged: true });
    await expect(table(page).locator("tbody tr")).toHaveCount(2);
    if (wide(info)) await expect(panel(page)).toBeVisible();
    const alerts = await countInsertedAlerts(page, ".review-list-area");
    // The server rejects an expired, rotated or mismatched cursor with 409 VERSION_CONFLICT.
    mock.expire();
    await page.getByRole("button", { name: "Next page", exact: true }).click();
    const first = "scope=review&hold=true&source=manual&order=asc&locale=en&limit=25";
    await expect
      .poll(() => mock.lists.slice(-2).map(String))
      .toEqual([`${first}&cursor=page-2.manual`, first]);
    await expect(table(page).locator("tbody tr")).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Previous page", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Next page", exact: true })).toBeEnabled();
    // The filters and the open decision panel stay; only the page restarts.
    expect(new URL(page.url()).search).toBe(search);
    if (wide(info)) await expect(panel(page)).toBeVisible();
    await page.waitForTimeout(250);
    expect(await alerts()).toBe(0);
    // One rejected cursor costs one first-page request, not a loop.
    expect(mock.lists.filter((q) => q.has("cursor"))).toHaveLength(1);
    expect(mock.lists.at(-1)?.toString()).toBe(first);
  },
);

test(
  "R18 toolbar budget with wide-font spare in RU and EN on both tabs and beside the panel",
  browserCase(["@layout"]),
  async ({ page }, info) => {
    test.setTimeout(60_000);
    const project = info.project.name,
      desktop = project === "desktop-chromium";
    await open(page);
    // Coarse pointers raise every control to a 40px target.
    const touch = await coarse(page);
    const layouts = desktop
      ? [
          { width: 1280, trip: null },
          { width: 1200, trip: reviewIds.over },
        ]
      : [{ width: page.viewportSize()?.width ?? 0, trip: null }];
    const results: Record<string, unknown>[] = [];
    for (const layout of layouts) {
      if (desktop) await page.setViewportSize({ width: layout.width, height: 800 });
      for (const tab of ["awaiting", "decided"] as const) {
        const search = new URLSearchParams();
        if (tab === "decided") search.set("tab", "decided");
        if (layout.trip) search.set("trip", layout.trip);
        await page.goto(`/account/review${search.size ? `?${search}` : ""}`);
        for (const locale of ["en", "ru"] as const) {
          await catalogLanguage(page, locale);
          await expect(page.getByRole("heading", { level: 1 })).toHaveText(text[locale].title);
          await expect(queue(page).locator(".review-list-footer")).toBeVisible();
          if (layout.trip) {
            await expect(page.locator('.review-layout[data-panel="open"]')).toBeVisible();
            await expect(panel(page)).toBeVisible();
            await settled(page);
          }
          for (const wideText of [false, true]) {
            const style = wideText ? await page.addStyleTag({ content: wideFont }) : null,
              budget = await toolbarBudget(page),
              context = {
                project,
                viewport: layout.width,
                panel: !!layout.trip,
                tab,
                locale,
                wideText,
              },
              label = JSON.stringify({ ...context, ...budget });
            results.push({ ...context, ...budget });
            expect(budget.filters, label).toBe(tab === "decided" ? 4 : 3);
            for (const height of budget.selectHeights)
              if (touch) expect(height, label).toBeGreaterThanOrEqual(40);
              else expect(Math.abs(height - 32), label).toBeLessThanOrEqual(0.5);
            expect(budget.selectsInside, label).toBe(true);
            expect(budget.tabsSpare, label).toBeGreaterThanOrEqual(4);
            expect(budget.widestSelectSpare, label).toBeGreaterThanOrEqual(4);
            expect(budget.timezoneInside, label).toBe(true);
            expect(budget.timezoneOverlaps, label).toBe(false);
            if (budget.arrangement === "one-row") {
              // A toolbar of 1000px or more keeps the tabs and every filter on one row.
              expect(budget.rowSpreadControls, label).toBeLessThanOrEqual(4);
              expect(budget.spareControls, label).toBeGreaterThanOrEqual(4);
            } else if (budget.arrangement === "two-row") {
              // Narrower toolbars (tablet, 1200px beside the panel) put every filter on one row
              // below the tabs, on both tabs alike.
              expect(budget.filtersBelowTabs, label).toBe(true);
              expect(budget.rowSpreadSelects, label).toBeLessThanOrEqual(4);
              expect(budget.spareSelects, label).toBeGreaterThanOrEqual(4);
            } else {
              // Phones stack the tabs, then the filters, then the timezone note.
              expect(budget.filtersBelowTabs, label).toBe(true);
              expect(budget.timezoneBelowFilters, label).toBe(true);
            }
            await noOverflow(page);
            expect(await brokenWords(page.locator(".review-toolbar")), label).toEqual([]);
            if (touch)
              await capture(
                page,
                info,
                `review-toolbar-${tab}-${locale}${wideText ? "-wide" : ""}`,
              );
            await style?.evaluate((node) => node.parentNode?.removeChild(node));
          }
        }
      }
    }
    await expect(page.locator("body")).not.toContainText(/Достаточно суров|Yukon\?|Юкон\?/);
    await writeFile(
      info.outputPath("review-toolbar-budget.json"),
      JSON.stringify(results, null, 2),
    );
  },
);

for (const locale of ["en", "ru"] as const)
  test(
    `${locale} the canonical city name reads as secondary text in the queue and decision panel`,
    browserCase(["@layout"]),
    async ({ page }, info) => {
      const mock = await mockReview(page, { locale });
      const native = { nameNative: "Krönburg" };
      const queued = mock.states.over.summary,
        full = mock.states.over.review.trip.summary;
      if (!queued.origin || !full.origin) throw new Error("FIXTURE_ORIGIN_MISSING");
      queued.origin = { ...queued.origin, ...native };
      full.origin = { ...full.origin, ...native };
      const label = locale === "ru" ? "Вымышленный Северопортск" : "Fictional Northport";
      await page.route(
        (url) => url.pathname === `/api/v1/catalogs/cities/${entities.north}`,
        (route) => {
          const base = catalogItem(entities.north, label, locale);
          return route.fulfill({
            json: envelope({
              ...base,
              nameNative: "Krönburg",
              display: { ...base.display, ...native },
            }),
          });
        },
      );
      await page.goto("/account/review");
      await catalogLanguage(page, locale);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(text[locale].title);
      await expect(rowOf(page, reviewIds.over)).toContainText("· Krönburg");
      await expect(rowOf(page, reviewIds.over).locator(".catalog-native")).toHaveCSS(
        "display",
        "inline",
      );
      await expect(rowOf(page, reviewIds.own)).not.toContainText("Krönburg");
      await noOverflow(page);
      await capture(page, info, `review-native-${locale}`);
      await openTrip(page, info, reviewIds.over);
      await settled(page);
      const heading = panel(page).getByRole("heading", { level: 2 });
      await expect(heading).toContainText("· Krönburg");
      await expect(heading.locator(".catalog-native")).toHaveCSS("display", "inline");
      const entity = panel(page)
        .locator(".review-entity")
        .filter({ hasText: "· Krönburg" })
        .first();
      await expect(entity).toContainText(`${label} · Krönburg`);
      await expect(entity.locator(".catalog-native")).toHaveCSS("display", "inline");
      await noOverflow(page);
    },
  );
