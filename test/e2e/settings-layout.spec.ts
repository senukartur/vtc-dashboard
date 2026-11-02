import type { Locator, Page, TestInfo } from "@playwright/test";
import { catalogLanguage } from "./support/catalogs.ts";
import { expect, test } from "./support/fixtures.ts";
import {
  correctCode,
  ids,
  mockSettings,
  names,
  type SettingsOptions,
  sentinel,
} from "./support/settings.ts";

const text = {
  en: {
    title: "Company settings",
    transfer: "Transfer leadership",
    request: "Send bound transfer code",
    code: "Code from your current verified email",
    transferButton: "Transfer leadership…",
    resend: "Send a new code",
    change: "Change successor",
    successor: "Active successor",
    sources: "Trip sources",
  },
  ru: {
    title: "Настройки компании",
    transfer: "Передача руководства",
    request: "Отправить код для выбранного преемника",
    code: "Код с вашей текущей подтверждённой почты",
    transferButton: "Передать руководство…",
    resend: "Отправить новый код",
    change: "Сменить преемника",
    successor: "Активный преемник",
    sources: "Источники рейсов",
  },
} as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const base = Date.parse("2026-11-02T12:00:00.000Z");
const slogan = /Достаточно суров|Юкон\?|Yukon\?/;

async function box(locator: Locator) {
  const value = await locator.boundingBox();
  if (!value) throw new Error("ELEMENT_NOT_RENDERED");
  return value;
}
const main = (page: Page) => page.locator(".settings-main");
const panel = (page: Page, locale: "en" | "ru" = "en") =>
  page.getByRole("complementary", { name: text[locale].transfer, exact: true });
const codeInput = (page: Page, locale: "en" | "ru" = "en") =>
  page.getByLabel(text[locale].code, { exact: true });
async function open(page: Page, options: SettingsOptions = {}, locale: "en" | "ru" = "en") {
  const state = await mockSettings(page, options);
  await page.goto("/account/admin/settings");
  if (locale !== "en") await catalogLanguage(page, locale);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(text[locale].title);
  return state;
}
/** Every read has settled: no loading status remains anywhere on the page. */
async function settled(page: Page, director = true) {
  await expect(page.locator(".settings-readiness")).toBeVisible();
  await expect(page.locator(".settings-source").first()).toBeVisible();
  await expect(page.locator(".settings-audit-table tbody tr").first()).toBeVisible();
  if (director) await expect(page.locator(".settings-steps")).toBeVisible();
  await expect(page.getByRole("status")).toHaveCount(0);
}
async function settledSuccessors(page: Page) {
  await expect(page.locator("#leadership-successor option")).toHaveCount(4);
}
/**
 * Words that wrap mid-word (a word whose text range spans several lines). Only .settings-break
 * (IDs) may break anywhere; options of a closed select have no visible lines.
 */
async function brokenWords(root: Locator) {
  return root.evaluate((element) => {
    const broken: string[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement?.closest(".settings-break, select")) continue;
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
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function capture(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
}
async function inViewport(page: Page, locator: Locator) {
  const rect = await box(locator),
    viewport = page.viewportSize();
  if (!viewport) throw new Error("VIEWPORT_MISSING");
  expect(rect.x).toBeGreaterThanOrEqual(0);
  expect(rect.y).toBeGreaterThanOrEqual(0);
  expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width);
  expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height);
  expect(await locator.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  );
}
/** Selects a successor and requests a code; returns once the code step is shown. */
async function requestCode(page: Page, successor: string = ids.volga) {
  await settledSuccessors(page);
  await page.getByLabel(text.en.successor, { exact: true }).selectOption(successor);
  await panel(page).getByRole("button", { name: text.en.request, exact: true }).click();
  await expect(codeInput(page)).toBeVisible();
}

for (const locale of ["en", "ru"] as const)
  test(`S1 ${locale} main column and leadership panel are placed by width`, async ({
    page,
  }, info) => {
    const state = await open(page, {}, locale);
    await settled(page);
    await settledSuccessors(page);
    const left = await box(main(page)),
      right = await box(panel(page, locale));
    if (info.project.name === "desktop-chromium")
      expect(right.x).toBeGreaterThanOrEqual(left.x + left.width);
    else expect(right.y).toBeGreaterThanOrEqual(left.y + left.height);
    await noOverflow(page);
    expect(await brokenWords(page.locator(".settings-page"))).toEqual([]);
    await capture(page, info, `settings-successor-${locale}`);
    await expect(page.locator("body")).not.toContainText(slogan);
    // The company name, public page and Discord are not settings here.
    await expect(page.getByLabel(/company name|название компании|discord/i)).toHaveCount(0);
    // Only the planned admin routes are read; shell reads are outside this check.
    expect(state.unexpected.filter((entry) => entry.includes(" /admin/"))).toEqual([]);
  });

for (const locale of ["en", "ru"] as const)
  test(`S1 ${locale} the code step fits every width`, async ({ page }, info) => {
    await open(page, { pending: true, reportingTimezone: "Europe/Warsaw" }, locale);
    await settled(page);
    await expect(codeInput(page, locale)).toBeVisible();
    await noOverflow(page);
    expect(await brokenWords(page.locator(".settings-page"))).toEqual([]);
    await capture(page, info, `settings-code-${locale}`);
  });

test("S2 ru keeps whole words at the narrowest side-by-side width", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-chromium", "The narrow two-column band is one check.");
  await open(page, { pending: true }, "ru");
  await settled(page);
  let side = false;
  for (let width = 900; width <= 1400 && !side; width += 10) {
    await page.setViewportSize({ width, height: 900 });
    const left = await box(main(page)),
      right = await box(panel(page, "ru"));
    side = right.x >= left.x + left.width;
  }
  expect(side).toBe(true);
  await noOverflow(page);
  expect(await brokenWords(page.locator(".settings-page"))).toEqual([]);
  await capture(page, info, "settings-ru-narrow-two-column");
});

test("S3 a deputy sees no transfer panel and makes no leadership reads", async ({ page }) => {
  const state = await open(page, { role: "deputy" });
  await settled(page, false);
  await expect(page.getByRole("heading", { name: text.en.transfer })).toHaveCount(0);
  await expect(page.locator(".settings-leadership")).toHaveCount(0);
  await expect(page.getByRole("region", { name: text.en.sources, exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Audit history", exact: true })).toBeVisible();
  expect(
    state.reads.filter(
      (path) => path.startsWith("/admin/leadership") || path.startsWith("/admin/members"),
    ),
  ).toEqual([]);
  // Without the panel the main column takes the full width.
  const layout = await box(page.locator(".settings-layout"));
  expect((await box(main(page))).width).toBeGreaterThanOrEqual(layout.width - 1);
});

test("S4 no company.configure shows the restricted card without admin reads", async ({ page }) => {
  const state = await mockSettings(page, { role: "driver" });
  await page.goto("/account/admin/settings");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Access restricted");
  await expect(page.locator(".settings-page")).toHaveCount(0);
  expect(state.reads.filter((path) => path.startsWith("/admin/"))).toEqual([]);
});

test("S4 an unverified director gets the verify-first link and no leadership reads", async ({
  page,
}) => {
  const state = await open(page, { emailVerified: false });
  await settled(page, false);
  await expect(panel(page)).toContainText(
    "Verify your current email before requesting leadership transfer.",
  );
  await expect(
    panel(page).getByRole("link", { name: "Open account security", exact: true }),
  ).toHaveAttribute("href", "/account/security");
  await expect(panel(page).getByRole("combobox")).toHaveCount(0);
  expect(
    state.reads.filter(
      (path) => path.startsWith("/admin/leadership") || path.startsWith("/admin/members"),
    ),
  ).toEqual([]);
});

test("S5 the timezone save keeps its body, version, key and CSRF header", async ({ page }) => {
  const state = await open(page);
  await settled(page);
  await expect(page.locator(".settings-readiness h2")).toHaveText("Reporting is not ready");
  await expect(page.locator(".settings-readiness")).toContainText("Reporting timezone is not set");
  await page.getByLabel("Company reporting timezone", { exact: true }).fill("Europe/Warsaw");
  const save = page.getByRole("button", { name: "Save reporting timezone", exact: true });
  await save.click();
  await expect(page.getByRole("dialog")).toContainText("Europe/Warsaw");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(save).toBeFocused();
  expect(state.commands).toEqual([]);
  await save.click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(state.commands).toHaveLength(1);
  expect(state.commands[0]).toMatchObject({
    method: "PATCH",
    path: "/admin/company-settings",
    body: '{"reportingTimezone":"Europe/Warsaw"}',
    ifMatch: '"v1"',
    csrf: "NONFUNCTIONAL_FIXTURE",
    contentType: "application/json",
  });
  expect(state.commands[0]?.key).toMatch(uuid);
  await expect(page.locator(".settings-readiness")).toContainText("Timezone: Europe/Warsaw");
});

test("S5 a conflicting save re-reads the settings", async ({ page }) => {
  const state = await open(page);
  await settled(page);
  state.outcomes.push(409);
  const before = state.reads.filter((path) => path === "/admin/company-settings").length;
  await page.getByLabel("Company reporting timezone", { exact: true }).fill("Europe/Warsaw");
  await page.getByRole("button", { name: "Save reporting timezone", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alert")).toContainText(
    "This record changed or the request is no longer valid.",
  );
  await expect
    .poll(() => state.reads.filter((path) => path === "/admin/company-settings").length)
    .toBeGreaterThan(before);
});

test("S5 an aborted save is retried with the same key and body", async ({ page }) => {
  const state = await open(page);
  await settled(page);
  state.outcomes.push("abort");
  await page.getByLabel("Company reporting timezone", { exact: true }).fill("Europe/Warsaw");
  await page.getByRole("button", { name: "Save reporting timezone", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await page.keyboard.press("Escape");
  await page
    .locator(".settings-reporting")
    .getByRole("button", { name: "Refresh", exact: true })
    .click();
  await expect.poll(() => state.commands.length).toBe(2);
  const [first, second] = state.commands;
  expect(second?.key).toBe(first?.key);
  expect(second?.body).toBe(first?.body);
  expect(second?.ifMatch).toBe('"v1"');
});

test("L1 requesting a code sends only the successor and shows server countdowns", async ({
  page,
}) => {
  await page.clock.install({ time: base });
  const state = await open(page, { base });
  await settled(page);
  await requestCode(page);
  expect(state.commands).toHaveLength(1);
  expect(state.commands[0]).toMatchObject({
    method: "POST",
    path: "/admin/leadership/challenges",
    body: JSON.stringify({ successorId: ids.volga }),
    ifMatch: undefined,
    csrf: "NONFUNCTIONAL_FIXTURE",
  });
  expect(state.commands[0]?.key).toMatch(uuid);
  // The state is read again after the request.
  expect(
    state.reads.filter((path) => path === "/admin/leadership/challenge").length,
  ).toBeGreaterThanOrEqual(2);
  await expect(codeInput(page)).toBeFocused();
  await expect(panel(page)).toContainText(
    `It is single-use, valid for 10 minutes and bound to ${names.volga}.`,
  );
  await expect(codeInput(page)).toHaveAccessibleDescription(
    /^Expires in (10:00|9:5\d) · Attempts left: 5 · New code in (1:00|0:5\d)$/,
  );
  await expect(panel(page).locator('[aria-current="step"]')).toHaveText(
    "2 · Code and confirmation",
  );
  const resend = panel(page).getByRole("button", { name: text.en.resend, exact: true });
  await expect(resend).toBeDisabled();
  await expect(resend).toHaveAccessibleDescription(/^New code available in (1:00|0:5\d)$/);
  await page.clock.fastForward(30_000);
  await expect(resend).toBeDisabled();
  await page.clock.fastForward(32_000);
  await expect(resend).toBeEnabled();
  await expect(codeInput(page)).toHaveAccessibleDescription(/You can request a new code$/);
  await resend.click();
  await expect.poll(() => state.commands.length).toBe(2);
  expect(state.commands[1]?.body).toBe(JSON.stringify({ successorId: ids.volga }));
  expect(state.commands[1]?.key).toMatch(uuid);
  expect(state.commands[1]?.key).not.toBe(state.commands[0]?.key);
});

test("L2 a wrong code closes the dialog, keeps it and shows the server's attempts", async ({
  page,
}) => {
  const state = await open(page, { pending: true });
  await settled(page);
  await codeInput(page).fill("fictional-wrong-code");
  const trigger = panel(page).getByRole("button", { name: text.en.transferButton, exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading")).toHaveText(`Transfer leadership to ${names.volga}?`);
  await expect(dialog).toContainText(ids.volga);
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.commands).toHaveLength(1);
  expect(state.commands[0]).toMatchObject({
    path: "/admin/leadership/transfers",
    body: JSON.stringify({ challengeId: ids.challenge, code: "fictional-wrong-code" }),
    ifMatch: undefined,
    csrf: "NONFUNCTIONAL_FIXTURE",
  });
  expect(state.commands[0]?.key).toMatch(uuid);
  await expect(panel(page).getByRole("alert")).toHaveText(
    "The code was not accepted. Check it, or request a new code.",
  );
  await expect(page.getByRole("alert")).toHaveCount(1);
  await expect(codeInput(page)).toHaveValue("fictional-wrong-code");
  await expect(codeInput(page)).toHaveAccessibleDescription(/Attempts left: 4/);
  await expect(trigger).toBeFocused();
  // The server stops reporting the code: it is explained, not silently dropped.
  state.pending = null;
  await trigger.click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(codeInput(page)).toHaveAccessibleDescription(
    "This code can no longer be used. Request a new code.",
  );
  await expect(trigger).toBeDisabled();
  await expect(page.getByText(sentinel)).toHaveCount(0);
});

test("L3 a limited request waits for the server's Retry-After", async ({ page }) => {
  await page.clock.install({ time: base });
  const state = await open(page, { base });
  await settled(page);
  await settledSuccessors(page);
  state.outcomes.push({ status: 429, retryAfter: 42 });
  await page.getByLabel(text.en.successor, { exact: true }).selectOption(ids.kestrel);
  const request = panel(page).getByRole("button", { name: text.en.request, exact: true });
  await request.click();
  await expect(panel(page).getByRole("alert")).toHaveText(
    "Too many requests. Wait before retrying.",
  );
  await expect(request).toBeDisabled();
  await expect(request).toHaveAccessibleDescription(/^New code available in (0:42|0:41)$/);
  await page.clock.fastForward(20_000);
  await expect(request).toBeDisabled();
  expect(state.commands).toHaveLength(1);
  await page.clock.fastForward(23_000);
  await expect(request).toBeEnabled();
  await request.click();
  await expect(codeInput(page)).toBeVisible();
  expect(state.commands).toHaveLength(2);
  // The held attempt is retried as it was.
  expect(state.commands[1]?.key).toBe(state.commands[0]?.key);
  expect(state.commands[1]?.body).toBe(JSON.stringify({ successorId: ids.kestrel }));
});

test("L4 a confirmed transfer leaves the restricted card and a notice", async ({ page }) => {
  const state = await open(page, { pending: true });
  await settled(page);
  await codeInput(page).fill(correctCode);
  await panel(page).getByRole("button", { name: text.en.transferButton, exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Access restricted");
  await expect(page.getByRole("status")).toHaveText(
    `✓ Leadership transferred to ${names.volga}. You are now a driver; the audit log records the transfer.`,
  );
  await expect(page.getByRole("status")).toBeFocused();
  expect(
    state.commands.filter((command) => command.path === "/admin/leadership/transfers"),
  ).toEqual([
    expect.objectContaining({
      body: JSON.stringify({ challengeId: ids.challenge, code: correctCode }),
    }),
  ]);
  await expect(page.getByLabel(text.en.code)).toHaveCount(0);
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Access restricted");
});

test("L5 changing the successor clears the code and requests for the new one", async ({ page }) => {
  const state = await open(page, { pending: true });
  await settled(page);
  await codeInput(page).fill("fictional-typed-code");
  await panel(page).getByRole("button", { name: text.en.change, exact: true }).click();
  await expect(codeInput(page)).toHaveCount(0);
  await expect(panel(page).locator('[aria-current="step"]')).toHaveText("1 · Successor");
  await requestCode(page, ids.kestrel);
  await expect(codeInput(page)).toHaveValue("");
  await expect(panel(page)).toContainText(`bound to ${names.kestrel}.`);
  expect(state.commands.map((command) => command.body)).toEqual([
    JSON.stringify({ successorId: ids.kestrel }),
  ]);
});

test("L6 a reload resumes the code step from the server state", async ({ page }) => {
  await open(page, { pending: true });
  await settled(page);
  await page.reload();
  await expect(codeInput(page)).toBeVisible();
  await expect(panel(page)).toContainText(`bound to ${names.volga}.`);
  await expect(codeInput(page)).toHaveAccessibleDescription(/Attempts left: 5/);
});

test("L7 an expired code cannot be submitted", async ({ page }) => {
  await page.clock.install({ time: base });
  await open(page, { pending: true, base });
  await settled(page);
  await codeInput(page).fill("fictional-typed-code");
  const trigger = panel(page).getByRole("button", { name: text.en.transferButton, exact: true });
  await expect(trigger).toBeEnabled();
  await page.clock.fastForward(601_000);
  await expect(codeInput(page)).toHaveAccessibleDescription(
    "This code has expired. Request a new code.",
  );
  await expect(trigger).toBeDisabled();
});

test("A-states settings, source, audit and leadership read errors offer Refresh", async ({
  page,
}, info) => {
  const state = await mockSettings(page);
  state.settingsStatus = 503;
  state.sourcesStatus = 503;
  state.auditStatus = 503;
  state.challengeStatus = 503;
  await page.goto("/account/admin/settings");
  await expect(page.getByRole("alert")).toHaveCount(4);
  await expect(page.getByText(sentinel)).toHaveCount(0);
  await expect(page.locator(".settings-readiness")).toHaveCount(0);
  await expect(page.locator(".settings-steps")).toHaveCount(0);
  await capture(page, info, "settings-errors");
  state.settingsStatus = 200;
  state.sourcesStatus = 200;
  state.auditStatus = 200;
  state.auditEmpty = true;
  state.challengeStatus = 200;
  for (const scope of [
    ".settings-reporting",
    ".settings-sources",
    ".settings-audit",
    ".settings-leadership",
  ])
    await page.locator(scope).getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator(".settings-readiness")).toBeVisible();
  await expect(
    page
      .locator(".settings-audit")
      .getByText("There are no records in this view.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Audit history" })).toHaveCount(0);
  await expect(page.locator(".settings-steps")).toBeVisible();
});

test("A-states an empty successor list and a members error", async ({ page }) => {
  const state = await mockSettings(page);
  state.membersEmpty = true;
  await page.goto("/account/admin/settings");
  await expect(panel(page).getByText("There are no records in this view.")).toBeVisible();
  await expect(
    panel(page).getByRole("button", { name: text.en.request, exact: true }),
  ).toBeDisabled();
  await page.unrouteAll({ behavior: "ignoreErrors" });
  const failing = await mockSettings(page);
  failing.membersStatus = 503;
  await page.goto("/account/admin/settings");
  await expect(panel(page).getByRole("alert")).toContainText("This information is unavailable.");
  await expect(page.getByText(sentinel)).toHaveCount(0);
});

test("A-live the settled page and code step add no live regions", async ({ page }) => {
  await open(page);
  await settled(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await requestCode(page);
  await expect(codeInput(page)).toHaveAccessibleDescription(/Attempts left: 5/);
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator(".settings-page [aria-live], .settings-page output")).toHaveCount(0);
});

test("A-targets controls keep pointer-appropriate target sizes", async ({ page }, info) => {
  await open(page, { pending: true });
  await settled(page);
  const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  if (info.project.name === "mobile-chromium") expect(coarse).toBe(true);
  const root = page.locator(".settings-page");
  const controls = await root
    .locator("button:visible, select:visible, input:visible, a:visible")
    .all();
  expect(controls.length).toBeGreaterThan(5);
  for (const control of controls)
    expect((await box(control)).height).toBeGreaterThanOrEqual(coarse ? 40 : 24);
});

test("A-dialog the transfer dialog fits a phone and returns focus", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile-chromium", "The phone dialog is a 390px check.");
  for (const locale of ["en", "ru"] as const) {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await open(page, { pending: true }, locale);
    await settled(page);
    await codeInput(page, locale).fill("fictional-typed-code");
    const trigger = panel(page, locale).getByRole("button", {
      name: text[locale].transferButton,
      exact: true,
    });
    await trigger.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading")).toContainText(names.volga);
    await inViewport(page, dialog);
    expect(await brokenWords(dialog)).toEqual([]);
    await dialog.screenshot({ path: info.outputPath(`settings-transfer-dialog-${locale}.png`) });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
});

test("A-keyboard tab order follows the visual order", async ({ page }) => {
  await open(page, { pending: true, reportingTimezone: "Europe/Warsaw" });
  await settled(page);
  const order = [
    page.getByLabel("Company reporting timezone", { exact: true }),
    page.getByRole("button", { name: "Save reporting timezone", exact: true }),
    page.getByRole("link", { name: "Open qualification configuration and history", exact: true }),
    page.getByRole("region", { name: "Audit history", exact: true }),
    codeInput(page),
    panel(page).getByRole("button", { name: text.en.resend, exact: true }),
    panel(page).getByRole("button", { name: text.en.change, exact: true }),
    panel(page).getByRole("link", { name: "Open account security", exact: true }),
  ];
  await order[0]?.focus();
  for (const next of order.slice(1)) {
    await page.keyboard.press("Tab");
    await expect(next).toBeFocused();
  }
  // Visual order matches: main cards top to bottom, then the panel (beside or below).
  const tops = await main(page)
    .locator(":scope > *")
    .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().top));
  expect(tops).toEqual([...tops].sort((a, b) => a - b));
});
