import type { Locator, Page, TestInfo } from "@playwright/test";
import { catalogLanguage } from "./support/catalogs.ts";
import { browserCase, expect, test } from "./support/fixtures.ts";
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
    audit: "Audit log",
    auditTab: "Audit log",
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
    audit: "Журнал аудита",
    auditTab: "Журнал",
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
/** The post-transfer notice; the shell can show its own transient statuses meanwhile. */
const notice = (page: Page) => page.locator(".settings-transferred").getByRole("status");
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
  test(
    `S1 ${locale} main column and leadership panel are placed by width`,
    browserCase(["@layout"]),
    async ({ page }, info) => {
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
      await expect(
        main(page).getByRole("heading", { name: /Company name|Название компании/ }),
      ).toBeVisible();
      await expect(main(page).getByText("Yukon Union", { exact: true })).toBeVisible();
      await expect(page.getByLabel(/company name|название компании|discord/i)).toHaveCount(0);
      // Only the planned admin routes are read; shell reads are outside this check.
      expect(state.unexpected.filter((entry) => entry.includes(" /admin/"))).toEqual([]);
    },
  );

for (const locale of ["en", "ru"] as const)
  test(
    `S1 ${locale} the code step fits every width`,
    browserCase(["@layout"]),
    async ({ page }, info) => {
      await open(page, { pending: true, reportingTimezone: "Europe/Warsaw" }, locale);
      await settled(page);
      await expect(codeInput(page, locale)).toBeVisible();
      await noOverflow(page);
      expect(await brokenWords(page.locator(".settings-page"))).toEqual([]);
      await capture(page, info, `settings-code-${locale}`);
    },
  );

test(
  "S2 ru keeps whole words at the narrowest side-by-side width",
  browserCase(["@layout", "@viewport-desktop"]),
  async ({ page }, info) => {
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
  },
);

test(
  "S3 a deputy sees no transfer panel and makes no leadership reads",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await open(page, { role: "deputy" });
    await settled(page, false);
    await expect(page.getByRole("heading", { name: text.en.transfer })).toHaveCount(0);
    await expect(page.locator(".settings-leadership")).toHaveCount(0);
    await expect(page.getByRole("region", { name: text.en.sources, exact: true })).toBeVisible();
    expect(
      state.reads.filter(
        (path) => path.startsWith("/admin/leadership") || path.startsWith("/admin/members"),
      ),
    ).toEqual([]);
    // Without the panel the main column takes the full width.
    const layout = await box(page.locator(".settings-layout"));
    expect((await box(main(page))).width).toBeGreaterThanOrEqual(layout.width - 1);
    await page.getByRole("tab", { name: text.en.audit, exact: true }).click();
    await expect(page.getByRole("region", { name: text.en.audit, exact: true })).toBeVisible();
  },
);

test(
  "S4 no company.configure shows the restricted card without admin reads",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await mockSettings(page, { role: "driver" });
    await page.goto("/account/admin/settings");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Access restricted");
    await expect(page.locator(".settings-page")).toHaveCount(0);
    expect(state.reads.filter((path) => path.startsWith("/admin/"))).toEqual([]);
  },
);

test(
  "S4 an unverified director gets the verify-first link and no leadership reads",
  browserCase(["@functional"]),
  async ({ page }) => {
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
  },
);

test(
  "S5 the timezone save keeps its body, version, key and CSRF header",
  browserCase(["@functional", "@smoke-settings"]),
  async ({ page }) => {
    const state = await open(page);
    await settled(page);
    await expect(page.locator(".settings-readiness h2")).toHaveText("Reporting is not ready");
    await expect(page.locator(".settings-readiness")).toContainText(
      "Reporting timezone is not set",
    );
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
  },
);

test(
  "S5 a conflicting save re-reads the settings",
  browserCase(["@functional"]),
  async ({ page }) => {
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
  },
);

test(
  "S5 an aborted save is retried with the same key and body",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await open(page);
    await settled(page);
    state.outcomes.push("abort");
    await page.getByLabel("Company reporting timezone", { exact: true }).fill("Europe/Warsaw");
    await page.getByRole("button", { name: "Save reporting timezone", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("tab", { name: text.en.audit, exact: true }).click();
    await page.getByRole("tab", { name: "General", exact: true }).click();
    await expect(page.getByLabel("Company reporting timezone", { exact: true })).toHaveValue(
      "Europe/Warsaw",
    );
    await page
      .locator(".settings-reporting")
      .getByRole("button", { name: "Refresh", exact: true })
      .click();
    await expect.poll(() => state.commands.length).toBe(2);
    const [first, second] = state.commands;
    expect(second?.key).toBe(first?.key);
    expect(second?.body).toBe(first?.body);
    expect(second?.ifMatch).toBe('"v1"');
  },
);

test(
  "L1 requesting a code sends only the successor and shows server countdowns",
  browserCase(["@functional"]),
  async ({ page }) => {
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
  },
);

test(
  "L2 a wrong code closes the dialog, keeps it and shows the server's attempts",
  browserCase(["@functional"]),
  async ({ page }) => {
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
    // Focus does not fall to the page when the trigger becomes disabled.
    await expect(
      panel(page).getByRole("button", { name: text.en.resend, exact: true }),
    ).toBeFocused();
    await expect(panel(page)).toContainText(
      "Requesting a code for another successor cancels this code.",
    );
    await expect(page.getByText(sentinel)).toHaveCount(0);
  },
);

test(
  "L3 a limited request waits for the server's Retry-After",
  browserCase(["@functional"]),
  async ({ page }) => {
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
  },
);

test(
  "L4 a confirmed transfer leaves the restricted card and a notice",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await open(page, { pending: true });
    await settled(page);
    await codeInput(page).fill(correctCode);
    await panel(page).getByRole("button", { name: text.en.transferButton, exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Access restricted");
    await expect(notice(page)).toHaveText(
      `✓ Leadership transferred to ${names.volga}. You are now a driver; the audit log records the transfer.`,
    );
    await expect(notice(page)).toBeFocused();
    expect(
      state.commands.filter((command) => command.path === "/admin/leadership/transfers"),
    ).toEqual([
      expect.objectContaining({
        body: JSON.stringify({ challengeId: ids.challenge, code: correctCode }),
      }),
    ]);
    await expect(page.getByLabel(text.en.code)).toHaveCount(0);
    // The receipt is held in memory and a reload does not repeat it.
    expect(await page.evaluate(() => history.state?.usr ?? null)).toBeNull();
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Access restricted");
    await expect(page.locator(".settings-transferred")).toHaveCount(0);
  },
);

test(
  "P11 browser Back keeps an in-flight transfer and shows its confirmed outcome",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await mockSettings(page, { pending: true });
    let releaseTransfer = () => {};
    const held = new Promise<void>((resolve) => {
      releaseTransfer = resolve;
    });
    await page.route("**/api/v1/admin/leadership/transfers", async (route) => {
      await held;
      await route.fallback();
    });
    await page.goto("/account/admin/settings?tab=audit");
    await page.getByRole("tab", { name: "General", exact: true }).click();
    await settled(page);
    await codeInput(page).fill(correctCode);
    await panel(page).getByRole("button", { name: text.en.transferButton, exact: true }).click();
    const transfer = page.waitForRequest(
      (request) => new URL(request.url()).pathname === "/api/v1/admin/leadership/transfers",
    );
    await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
    await transfer;
    try {
      await page.goBack();
      await expect(page.getByRole("tab", { name: text.en.audit })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByRole("tab", { name: text.en.audit })).toBeFocused();
    } finally {
      releaseTransfer();
    }
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Access restricted");
    await expect(page).toHaveURL(/tab=audit$/);
    await expect(notice(page)).toContainText(names.volga);
    await expect(notice(page)).toBeFocused();
    expect(state.commands).toHaveLength(1);
  },
);

test(
  "P11 an authorized transfer receipt survives the resulting loss of settings access",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await mockSettings(page, { pending: true });
    let releaseResponse = () => {};
    state.transferResponseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    const auditUrl = "/account/admin/settings?tab=audit&keep=synthetic#anchor";
    await page.goto(auditUrl);
    await expect(page.getByRole("region", { name: "Audit log", exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "General", exact: true }).click();
    await settled(page);
    await codeInput(page).fill(correctCode);
    await panel(page).getByRole("button", { name: text.en.transferButton, exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
    try {
      await expect.poll(() => state.transferred).toBe(true);
      expect(state.commands).toHaveLength(1);
      await page.goBack();
      await expect(page).toHaveURL(auditUrl);
      await expect.poll(() => state.auditDeniedAfterTransfer).toBeGreaterThan(0);
      await expect.poll(() => state.selfReadsAfterTransfer).toBeGreaterThan(0);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Access restricted");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(codeInput(page)).toHaveCount(0);
      await expect(notice(page)).toHaveCount(0);
    } finally {
      releaseResponse();
    }

    await expect(notice(page)).toContainText(names.volga);
    await expect(notice(page)).toBeFocused();
    await expect(page).toHaveURL(auditUrl);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Access restricted");
    await expect.poll(() => page.evaluate(() => history.state?.usr ?? null)).toBeNull();
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Access restricted");
    await expect(notice(page)).toHaveCount(0);
    expect(state.commands).toHaveLength(1);
  },
);

test(
  "P11 the transfer notice survives a temporary session read failure",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await open(page, { pending: true });
    await settled(page);
    state.selfStatusAfterTransfer = 503;
    await codeInput(page).fill(correctCode);
    await panel(page).getByRole("button", { name: text.en.transferButton, exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Session check unavailable");
    await expect(notice(page)).toHaveCount(0);
    await expect(codeInput(page)).toHaveCount(0);
    expect(state.commands).toHaveLength(1);

    state.selfStatusAfterTransfer = 200;
    await page.getByRole("button", { name: "Check again", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Access restricted");
    await expect(notice(page)).toContainText(names.volga);
    await expect(notice(page)).toBeFocused();
    await expect(page).toHaveURL("/account/admin/settings");
    expect(state.commands).toHaveLength(1);
  },
);

test(
  "P11 a different account never sees the completed transfer notice",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await open(page, { pending: true });
    await settled(page);
    state.selfReplacementAfterTransfer = {
      id: ids.cedar,
      nickname: names.cedar,
      formerMember: false,
      roles: ["driver", "deputy_director"],
    };
    let releaseSelf = () => {};
    state.selfResponseGateAfterTransfer = new Promise<void>((resolve) => {
      releaseSelf = resolve;
    });
    await codeInput(page).fill(correctCode);
    await panel(page).getByRole("button", { name: text.en.transferButton, exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
    try {
      await expect.poll(() => state.selfReadsAfterTransfer).toBeGreaterThan(0);
      await expect(notice(page)).toHaveCount(0);
    } finally {
      releaseSelf();
    }
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(text.en.title);
    const workspace = page.getByRole("complementary", { name: "Workspace", exact: true });
    await expect(workspace.getByRole("button", { name: new RegExp(names.cedar) })).toBeVisible();
    await expect(panel(page)).toHaveCount(0);
    await expect(notice(page)).toHaveCount(0);
    expect(await page.evaluate(() => history.state?.usr ?? null)).toBeNull();
    expect(state.commands).toHaveLength(1);
  },
);

test(
  "P11 a cancelled review can reopen and an uncertain transfer retries the frozen request",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await open(page, { pending: true });
    await settled(page);
    await codeInput(page).fill(correctCode);
    const trigger = panel(page).getByRole("button", { name: text.en.transferButton, exact: true });
    const dialog = page.getByRole("dialog");
    const confirm = dialog.getByRole("button", { name: "Confirm", exact: true });
    await trigger.click();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(trigger).toBeFocused();
    expect(state.commands).toEqual([]);
    state.outcomes.push(503);
    await trigger.click();
    await confirm.click();
    await expect(dialog).toContainText("The result is uncertain.");
    await confirm.click();
    await expect(notice(page)).toContainText(names.volga);
    expect(state.commands).toHaveLength(2);
    expect(state.commands[1]?.key).toBe(state.commands[0]?.key);
    expect(state.commands[1]?.body).toBe(state.commands[0]?.body);
  },
);

test("L4 the transfer notice can be dismissed", browserCase(["@functional"]), async ({ page }) => {
  await open(page, { pending: true });
  await settled(page);
  await codeInput(page).fill(correctCode);
  await panel(page).getByRole("button", { name: text.en.transferButton, exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(notice(page)).toContainText(names.volga);
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(notice(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Access restricted");
});

test(
  "L5 changing the successor clears the code and requests for the new one",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await open(page, { pending: true });
    await settled(page);
    await codeInput(page).fill("fictional-typed-code");
    await panel(page).getByRole("button", { name: text.en.change, exact: true }).click();
    await expect(codeInput(page)).toHaveCount(0);
    await expect(panel(page).locator('[aria-current="step"]')).toHaveText("1 · Successor");
    // The pressed button leaves with the code step; focus continues at the successor choice.
    await expect(page.getByLabel(text.en.successor, { exact: true })).toBeFocused();
    await requestCode(page, ids.kestrel);
    await expect(codeInput(page)).toHaveValue("");
    await expect(panel(page)).toContainText(`bound to ${names.kestrel}.`);
    expect(state.commands.map((command) => command.body)).toEqual([
      JSON.stringify({ successorId: ids.kestrel }),
    ]);
  },
);

test(
  "L6 a reload resumes the code step from the server state",
  browserCase(["@functional"]),
  async ({ page }) => {
    await open(page, { pending: true });
    await settled(page);
    await page.reload();
    await expect(codeInput(page)).toBeVisible();
    await expect(panel(page)).toContainText(`bound to ${names.volga}.`);
    await expect(codeInput(page)).toHaveAccessibleDescription(/Attempts left: 5/);
  },
);

test("L7 an expired code cannot be submitted", browserCase(["@functional"]), async ({ page }) => {
  await page.clock.install({ time: base });
  // A new code is still minutes away when this one expires.
  await open(page, { pending: true, resendIn: 900, base });
  await settled(page);
  await codeInput(page).fill("fictional-typed-code");
  await expect(codeInput(page)).toBeFocused();
  const trigger = panel(page).getByRole("button", { name: text.en.transferButton, exact: true });
  await expect(trigger).toBeEnabled();
  await page.clock.fastForward(601_000);
  await expect(codeInput(page)).toHaveAccessibleDescription(
    "This code has expired. Request a new code.",
  );
  await expect(trigger).toBeDisabled();
  await expect(codeInput(page)).toBeDisabled();
  // Send a new code is still waiting, so focus moves from the disabled input to the explanation.
  await expect(
    panel(page).getByRole("button", { name: text.en.resend, exact: true }),
  ).toBeDisabled();
  await expect(page.locator("#leadership-code-timing")).toBeFocused();
});

test(
  "A-states settings, source, audit and leadership read errors offer Refresh",
  browserCase(["@functional"]),
  async ({ page }, info) => {
    const state = await mockSettings(page);
    state.settingsStatus = 503;
    state.sourcesStatus = 503;
    state.auditStatus = 503;
    state.challengeStatus = 503;
    await page.goto("/account/admin/settings");
    await expect(page.getByRole("alert")).toHaveCount(3);
    await expect(page.getByText(sentinel)).toHaveCount(0);
    await expect(page.locator(".settings-readiness")).toHaveCount(0);
    await expect(page.locator(".settings-steps")).toHaveCount(0);
    await capture(page, info, "settings-errors");
    state.settingsStatus = 200;
    state.sourcesStatus = 200;
    state.challengeStatus = 200;
    for (const scope of [".settings-reporting", ".settings-sources", ".settings-leadership"])
      await page.locator(scope).getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.locator(".settings-readiness")).toBeVisible();
    await expect(page.locator(".settings-steps")).toBeVisible();
    await page.getByRole("tab", { name: text.en.audit, exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("This information is unavailable.");
    await expect(page.getByText(sentinel)).toHaveCount(0);
    state.auditStatus = 200;
    state.auditEmpty = true;
    state.auditTotal = 0;
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(
      page.getByText("There are no records in this view.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Total entries: 0", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: text.en.audit })).toHaveCount(0);
  },
);

test(
  "A-states an empty successor list and a members error",
  browserCase(["@functional"]),
  async ({ page }) => {
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
  },
);

test(
  "A-live the settled page and code step add no live regions",
  browserCase(["@functional"]),
  async ({ page }) => {
    await open(page);
    await settled(page);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await requestCode(page);
    await expect(codeInput(page)).toHaveAccessibleDescription(/Attempts left: 5/);
    await expect(page.getByRole("status")).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.locator(".settings-page [aria-live], .settings-page output")).toHaveCount(0);
  },
);

test(
  "A-targets controls keep pointer-appropriate target sizes",
  browserCase(["@layout"]),
  async ({ page }, info) => {
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
  },
);

test(
  "A-dialog the transfer dialog fits a phone and returns focus",
  browserCase(["@layout", "@viewport-mobile"]),
  async ({ page }, info) => {
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
  },
);

test(
  "A-keyboard tab order follows the visual order",
  browserCase(["@layout"]),
  async ({ page }) => {
    await open(page, { pending: true, reportingTimezone: "Europe/Warsaw" });
    await settled(page);
    const order = [
      page.getByLabel("Company reporting timezone", { exact: true }),
      page.getByRole("button", { name: "Save reporting timezone", exact: true }),
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
  },
);

for (const locale of ["en", "ru"] as const)
  test(
    `P11 ${locale} audit columns, names and changes fit the account shell`,
    browserCase(["@layout"]),
    async ({ page }, info) => {
      await mockSettings(page, {
        reportingTimezone: "America/Edmonton",
        displayTimezone: "Asia/Tokyo",
      });
      await page.goto("/account/admin/settings?tab=audit");
      if (locale === "ru") await catalogLanguage(page, locale);
      const region = page.getByRole("region", { name: text[locale].audit, exact: true });
      await expect(region.getByRole("row")).toHaveCount(6);
      expect(await region.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      await expect(
        page.getByRole("tab", { name: text[locale].auditTab, exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      await expect(region.getByRole("columnheader")).toHaveText(
        locale === "en" ? ["When", "Who", "What changed"] : ["Когда", "Кто", "Что изменилось"],
      );
      await expect(region.getByRole("row").nth(1)).toContainText("Fictional Director");
      await expect(region.getByRole("row").nth(1)).toContainText("Yukon Union");
      await expect(region.getByRole("row").nth(1)).toContainText("10:02");
      await expect(region.getByRole("row").nth(1)).toContainText(
        locale === "en" ? "Not set" : "Не задано",
      );
      await expect(page.getByText(/America\/Edmonton/).first()).toBeVisible();
      await expect(page.getByText(/Asia\/Tokyo/)).toHaveCount(0);
      await expect(page.getByText("synthetic.unregistered")).toHaveCount(0);
      await expect(region).toContainText(
        locale === "en" ? "Unrecognized action" : "Неизвестное действие",
      );
      await capture(page, info, `settings-audit-${locale}`);
    },
  );

test(
  "P11 direct qualification URL, manual tabs, game changes and Back preserve route state",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await mockSettings(page, { role: "deputy" });
    await page.goto("/account/admin/settings?tab=qualifications&game=ats&keep=synthetic#anchor");
    const qualifications = page.getByRole("tab", { name: "Qualification levels", exact: true }),
      general = page.getByRole("tab", { name: "General", exact: true }),
      audit = page.getByRole("tab", { name: text.en.audit, exact: true }),
      qualificationPanel = page.getByRole("tabpanel", {
        name: "Qualification levels",
        exact: true,
      }),
      ats = qualificationPanel.getByRole("button", { name: "ATS", exact: true });
    const ladder = qualificationPanel.getByRole("table", { name: "Qualification ladder" });
    await expect(ladder.getByRole("rowheader")).toContainText("Fictional ATS starter");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Company settings");
    await expect(ats).toHaveAttribute("aria-pressed", "true");
    expect(state.reads.filter((path) => path.startsWith("/admin/company-settings"))).toEqual([]);
    expect(state.reads.filter((path) => path.includes("qualification"))).toEqual([
      "/admin/qualification-ladders/ats",
    ]);
    await qualifications.focus();
    await page.keyboard.press("ArrowRight");
    await expect(audit).toBeFocused();
    await expect(qualifications).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Home");
    await expect(general).toBeFocused();
    await page.keyboard.press("End");
    await expect(audit).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(audit).toHaveAttribute("aria-selected", "true");
    await expect(audit).toBeFocused();
    await expect(page.getByRole("tabpanel", { name: text.en.audit })).toBeVisible();
    await expect(
      page.getByText("Times in UTC because the company reporting timezone is unavailable."),
    ).toBeVisible();
    await expect(page).toHaveURL(/tab=audit&game=ats&keep=synthetic#anchor$/);
    await page.goBack();
    await expect(qualifications).toHaveAttribute("aria-selected", "true");
    await qualificationPanel.getByRole("button", { name: "ETS2", exact: true }).click();
    await expect(page).toHaveURL(/tab=qualifications&game=ets2&keep=synthetic#anchor$/);
    await expect(ats).toHaveAttribute("aria-pressed", "false");
    await expect(ladder.getByRole("rowheader")).toContainText("Fictional ETS2 starter");
    await page.goto("/account/admin/settings?tab=invalid");
    await expect(general).toHaveAttribute("aria-selected", "true");
    expect(state.unexpected.filter((entry) => entry.includes(" /admin/"))).toEqual([]);
  },
);

test(
  "P11 history moves focus from a hidden panel to its newly selected tab",
  browserCase(["@functional"]),
  async ({ page }) => {
    await open(page, { role: "deputy", reportingTimezone: "America/Edmonton" });
    const general = page.getByRole("tab", { name: "General", exact: true });
    const audit = page.getByRole("tab", { name: text.en.audit, exact: true });
    await audit.click();
    const filter = page.getByRole("combobox", { name: "Action", exact: true });
    await filter.focus();
    await expect(filter).toBeFocused();
    await page.goBack();
    await expect(general).toBeFocused();
    await expect(general).toHaveAttribute("aria-selected", "true");

    // A still-visible tab keeps focus while history selects another one.
    await page.goForward();
    await expect(audit).toHaveAttribute("aria-selected", "true");
    await expect(general).toBeFocused();
    await page.goBack();
    const timezone = page.getByLabel("Company reporting timezone", { exact: true });
    await timezone.focus();
    await expect(timezone).toBeFocused();
    await page.goForward();
    await expect(audit).toBeFocused();
  },
);

test(
  "P11 exact action filter, opaque next and previous cursors, and stale-page recovery",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await mockSettings(page, { role: "deputy" });
    state.auditPageSize = 1;
    state.auditTotal = 2;
    await page.goto(
      "/account/admin/settings?tab=audit&action=configuration.changed&keep=synthetic#anchor",
    );
    const audit = page.getByRole("region", { name: text.en.audit, exact: true }),
      filter = page.getByRole("combobox", { name: "Action", exact: true }),
      next = page.getByRole("button", { name: "Next page", exact: true }),
      previous = page.getByRole("button", { name: "Previous page", exact: true });
    await expect(filter).toHaveValue("configuration.changed");
    await expect(audit).toContainText("Fictional Director");
    await expect(page.getByText("Entries 1–1 of 2", { exact: true })).toBeVisible();
    state.auditTotal = undefined;
    await next.click();
    await expect(audit).toContainText("Change details unavailable.");
    await expect(audit).toContainText("ID c6500000…");
    await expect(audit).not.toContainText(ids.company);
    await expect(page.getByText("Entries 2–2", { exact: true })).toBeVisible();
    expect(state.reads).toContain(
      "/admin/audit?view=stage3&limit=25&action=configuration.changed&cursor=synthetic%2Bsecond%2Fpage%3D",
    );
    await previous.click();
    await expect(audit).toContainText("Fictional Director");
    state.auditCursorStatus = 503;
    await next.click();
    await expect(page.getByRole("alert")).toContainText("This information is unavailable.");
    await expect(audit).toHaveCount(0);
    await previous.click();
    await expect(audit).toContainText("Fictional Director");
    state.auditCursorStatus = 409;
    await next.click();
    await expect(page.getByRole("alert")).toContainText("This page has expired.");
    await expect(audit).toHaveCount(0);
    await expect(previous).toHaveCount(0);
    await page.getByRole("button", { name: "First page", exact: true }).click();
    await expect(audit).toContainText("Fictional Director");
    await filter.selectOption("membership.changed");
    await expect(page).toHaveURL(/tab=audit&action=membership.changed&keep=synthetic#anchor$/);
    await expect(audit).toContainText(names.cedar);
    await expect(audit).toContainText("Active · Trainee");
    await expect(audit).toContainText("Active · Driver");
    await expect(next).toHaveCount(0);
    await expect(previous).toHaveCount(0);
    expect(state.reads).toContain("/admin/audit?view=stage3&limit=25&action=membership.changed");
    state.auditStatus = 403;
    await filter.selectOption("roles.changed");
    await expect(page.getByRole("alert")).toHaveText(
      "Your current account cannot open this section.",
    );
    await expect(audit).toHaveCount(0);
    await expect(page.getByText(sentinel)).toHaveCount(0);
  },
);

test(
  "P11 partial permissions do not start restricted reads",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await mockSettings(page, {
      omitCapabilities: ["connections.manage", "members.manage", "qualifications.manage"],
    });
    await page.goto("/account/admin/settings?tab=audit");
    await expect(page.getByRole("heading", { name: "Access restricted" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Company settings");
    expect(state.reads.filter((path) => path.startsWith("/admin/"))).toEqual([]);
    await page.getByRole("tab", { name: "Qualification levels", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Access restricted" })).toBeVisible();
    await page.getByRole("tab", { name: "General", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Trip sources", exact: true })).toBeVisible();
    await expect(page.getByLabel("Company reporting timezone", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: text.en.transfer, exact: true })).toHaveCount(0);
    expect(state.reads.filter((path) => path.startsWith("/admin/"))).toEqual([
      "/admin/company-settings",
    ]);
    expect(state.reads.filter((path) => path.includes("qualification"))).toEqual([]);
  },
);
