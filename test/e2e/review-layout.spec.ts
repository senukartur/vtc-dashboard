import type { Locator, Page, TestInfo } from "@playwright/test";
import { catalogLanguage } from "./support/catalogs.ts";
import { expect, test } from "./support/fixtures.ts";
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
  test(`R1 ${locale} queue and decision panel fit side by side without broken words`, async ({
    page,
  }, info) => {
    const mock = await open(page, "/account/review", { locale });
    await expect(table(page).locator("tbody tr")).toHaveCount(5);
    expect(mock.lists.at(-1)?.toString()).toBe("scope=review&hold=true&order=asc&limit=25");
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
  });

test("R2 rows open the full page below 1200px with one column, coarse targets and a back link", async ({
  page,
}, info) => {
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
});

test("R3 over-limit acceptance lists every limit and sends the confirmed flag", async ({
  page,
}, info) => {
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
});

test("R4 ordinary accept and reject send exact bodies and keep line breaks", async ({
  page,
}, info) => {
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
});

test("R5 unavailable acceptance is explained while rejection still works", async ({
  page,
}, info) => {
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
});

for (const locale of ["en", "ru"] as const)
  test(`R6 ${locale} own report shows a note and no decision controls`, async ({ page }, info) => {
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
  });

test("R7 diff marks changed fields in text and first submissions have no previous column", async ({
  page,
}) => {
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
});

test("R8 evidence opens on demand in a fitting dialog and expired images say so", async ({
  page,
}, info) => {
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
});

test("R9 empty, filtered, failed, missing and forbidden states offer a next step", async ({
  page,
}, info) => {
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
});

test("R10 keyboard: pressed tabs keep focus, Enter opens the panel and Escape returns", async ({
  page,
}, info) => {
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
  test.skip(!wide(info), "The side panel needs at least 1200px.");
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
  await expect(form(page).getByRole("button", { name: "Reject trip", exact: true })).toBeFocused();
});

test("R11 a 409 closes the confirmation, keeps the reason and resets the confirmation", async ({
  page,
}, info) => {
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
  await expect.poll(() => page.evaluate(() => document.activeElement !== document.body)).toBe(true);
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
});

for (const locale of ["en", "ru"] as const)
  test(`R12 ${locale} rendered review states for the visual record`, async ({ page }, info) => {
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
  });

const factsText = {
  en: { facts: "Trip facts", held: "Why it is held:", unavailable: "Unavailable" },
  ru: { facts: "Факты рейса", held: "Почему на проверке:", unavailable: "Недоступно" },
} as const;
for (const locale of ["en", "ru"] as const)
  test(`R13 ${locale} telemetry and late-telemetry reviews show trip facts and hold reasons`, async ({
    page,
  }, info) => {
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
  });

test("R14 Escape inside the decision form keeps the draft; elsewhere it closes the panel", async ({
  page,
}, info) => {
  test.skip(!wide(info), "The side panel needs at least 1200px.");
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
});

// A tab switch and a filter change in quick succession keep both (router updates are
// transitions, so each update must start from the committed URL). No waits in between.
test("R15a Awaiting then an immediate order change keeps both", async ({ page }) => {
  await open(page, "/account/review?tab=decided&order=asc");
  await page.getByRole("button", { name: text.en.awaiting, exact: true }).click();
  await page.locator("#review-order").selectOption("desc");
  await expect(page).toHaveURL(/\/account\/review\?order=desc$/);
  await expect(page.getByRole("button", { name: text.en.awaiting, exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("R15b Decided then an immediate game change keeps both", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: text.en.decided, exact: true }).click();
  await page.locator("#review-game").selectOption("ats");
  await expect(page).toHaveURL(/\/account\/review\?tab=decided&game=ats$/);
  await expect(page.locator("#review-game")).toHaveValue("ats");
});

test("R15c a tab click and an order change dispatched in one task keep both", async ({ page }) => {
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
});
