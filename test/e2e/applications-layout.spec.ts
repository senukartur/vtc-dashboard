import type { Locator, Page, TestInfo } from "@playwright/test";
import { catalogLanguage } from "./support/catalogs.ts";
import { browserCase, expect, test } from "./support/fixtures.ts";
import {
  type ApplicationsOptions,
  ids,
  mockApplications,
  names,
  rejectedReason,
} from "./support/applications.ts";

test(
  "application tabs show their own totals including an available zero",
  browserCase(["@layout"]),
  async ({ page }) => {
    await open(page, { statusCounts: { submitted: 108, approved: 27, rejected: 0 } });
    const tabs = page.getByRole("navigation", { name: "Status", exact: true });
    await expect(
      tabs.getByRole("link", { name: "Awaiting review (108)", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(tabs.getByRole("link", { name: "Approved (27)", exact: true })).toBeVisible();
    await tabs.getByRole("link", { name: "Rejected (0)", exact: true }).click();
    await expect(page).toHaveURL(/\?status=rejected$/);
    await expect(tabs.getByRole("link", { name: "Rejected (0)", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
  },
);

const text = {
  en: {
    title: "Applications",
    headers: ["Applicant", "Games", "Submitted", "Status"],
    awaiting: "Awaiting review",
    approve: "Approve application",
    reject: "Reject application",
    reissue: "Reissue link",
    copy: "Copy link",
    back: "Back to list",
    noEmail: "No email is sent until you choose Send to email.",
  },
  ru: {
    title: "Заявки",
    headers: ["Кандидат", "Игры", "Подана", "Статус"],
    awaiting: "Ожидает решения",
    approve: "Одобрить заявку",
    reject: "Отклонить заявку",
    reissue: "Перевыпустить ссылку",
    copy: "Скопировать ссылку",
    back: "Назад к списку",
    noEmail: "Письмо не отправляется, пока вы не нажмёте «Отправить на email».",
  },
} as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function box(locator: Locator) {
  const value = await locator.boundingBox();
  if (!value) throw new Error("ELEMENT_NOT_RENDERED");
  return value;
}
const master = (page: Page) => page.locator(".admin-master");
const detail = (page: Page) => page.locator(".applications-detail");
const rows = (page: Page) => master(page).locator("tbody tr");
const decision = (page: Page) => page.locator(".applications-decision");
const invitation = (page: Page) => page.locator(".applications-invitation");
async function open(
  page: Page,
  options: ApplicationsOptions = {},
  status = "submitted",
  locale: "en" | "ru" = "en",
) {
  const state = await mockApplications(page, options);
  await page.goto(`/account/admin/applications?status=${status}`);
  await catalogLanguage(page, locale);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(text[locale].title);
  await expect(rows(page).first()).toBeVisible();
  return state;
}
async function select(page: Page, nickname: string) {
  await master(page).getByRole("button", { name: nickname, exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: nickname, exact: true })).toBeVisible();
}
/** The detail has no loading status left: history, decision and invitation reads settled. */
async function settledDetail(page: Page, invitationShown: boolean) {
  await expect(detail(page).locator(".applications-history-item").first()).toBeVisible();
  if (invitationShown) await expect(invitation(page).locator(".applications-invite")).toBeVisible();
  await expect(detail(page).getByRole("status")).toHaveCount(0);
}
/**
 * Words in the queue and detail that wrap mid-word (a word whose text range spans several lines).
 * Only .applications-break (email, Steam URL, IDs) may break anywhere; a clipped phone header row
 * has no visible lines to check.
 */
async function brokenWords(root: Locator) {
  return root.evaluate((element) => {
    const broken: string[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement?.closest(".applications-break")) continue;
      const head = node.parentElement?.closest("thead");
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

for (const locale of ["en", "ru"] as const)
  test(
    `A1 ${locale} queue and detail are placed by width without overflow`,
    browserCase(["@layout"]),
    async ({ page }, info) => {
      const s = text[locale];
      await open(page, {}, "submitted", locale);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      const table = master(page).getByRole("table");
      await expect(table.getByRole("columnheader")).toHaveText([...s.headers]);
      await expect(rows(page)).toHaveCount(2);
      await expect(rows(page).first().getByRole("cell").nth(2)).toContainText(s.awaiting);
      const workbench = page.locator(".admin-workbench"),
        display = () => workbench.evaluate((element) => getComputedStyle(element).display);
      if (info.project.name === "mobile-chromium") {
        expect(await display()).toBe("block");
        await expect(page.locator(".admin-detail")).toBeHidden();
        expect(await brokenWords(master(page))).toEqual([]);
        await capture(page, info, `applications-list-${locale}`);
        await select(page, names.submitted);
        await expect(master(page)).toBeHidden();
        await settledDetail(page, false);
        expect(await brokenWords(detail(page))).toEqual([]);
        await capture(page, info, `applications-detail-${locale}`);
        await page.getByRole("button", { name: s.back, exact: true }).click();
        await expect(master(page)).toBeVisible();
        await expect(page.locator(".admin-detail")).toBeHidden();
      } else {
        expect(await display()).toBe("flex");
        await select(page, names.submitted);
        await settledDetail(page, false);
        const list = await box(master(page)),
          side = await box(detail(page));
        if (info.project.name === "desktop-chromium")
          expect(side.x).toBeGreaterThanOrEqual(list.x + list.width);
        else expect(side.y).toBeGreaterThanOrEqual(list.y + list.height);
        expect(await table.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
          true,
        );
        expect(await brokenWords(master(page))).toEqual([]);
        expect(await brokenWords(detail(page))).toEqual([]);
        await capture(page, info, `applications-detail-${locale}`);
      }
      await expect(page.locator("body")).not.toContainText(/Достаточно суров|Yukon\?|Юкон\?/);
    },
  );

for (const locale of ["en", "ru"] as const)
  test(
    `A1 ${locale} approved detail with a valid invitation fits every width`,
    browserCase(["@layout"]),
    async ({ page }, info) => {
      await open(page, {}, "approved", locale);
      await select(page, names.approved);
      await settledDetail(page, true);
      await expect(
        invitation(page).getByRole("button", { name: text[locale].copy, exact: true }),
      ).toBeVisible();
      expect(await brokenWords(detail(page))).toEqual([]);
      await capture(page, info, `applications-invitation-${locale}`);
    },
  );

test(
  "A1 rejected tab adds the Decided column and keeps whole words in RU",
  browserCase(["@layout"]),
  async ({ page }, info) => {
    await open(page, {}, "rejected", "ru");
    await expect(master(page).getByRole("columnheader")).toHaveText([
      ...text.ru.headers,
      "Решение",
    ]);
    await noOverflow(page);
    expect(await brokenWords(master(page))).toEqual([]);
    await select(page, names.rejected);
    await settledDetail(page, false);
    await expect(decision(page)).toContainText(`«${rejectedReason}»`);
    expect(await brokenWords(detail(page))).toEqual([]);
    await capture(page, info, "applications-rejected-ru");
  },
);

test(
  "A2 ru keeps whole words at the narrowest side-by-side width",
  browserCase(["@layout", "@viewport-desktop"]),
  async ({ page }, info) => {
    await open(page, {}, "submitted", "ru");
    await select(page, names.submitted);
    await settledDetail(page, false);
    let side = false;
    for (let width = 900; width <= 1400 && !side; width += 10) {
      await page.setViewportSize({ width, height: 900 });
      const list = await box(master(page)),
        other = await box(detail(page));
      side = other.x >= list.x + list.width;
    }
    expect(side).toBe(true);
    await noOverflow(page);
    expect(await brokenWords(master(page))).toEqual([]);
    expect(await brokenWords(detail(page))).toEqual([]);
    await capture(page, info, "applications-ru-narrow-two-column");
  },
);

test(
  "A3 approve sends the original body, version, key and CSRF header",
  browserCase(["@functional", "@smoke-admissions"]),
  async ({ page }) => {
    const state = await open(page);
    await select(page, names.submitted);
    await settledDetail(page, false);
    await decision(page).getByRole("button", { name: text.en.approve, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(text.en.noEmail);
    await expect(dialog).toContainText(
      "After accepting the invitation, the applicant starts as a Trainee in Euro Truck Simulator 2, American Truck Simulator.",
    );
    await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(state.commands).toHaveLength(1);
    const [command] = state.commands;
    expect(command).toMatchObject({
      method: "POST",
      path: `/admin/applications/${ids.submitted}/decisions`,
      body: '{"decision":"approve"}',
      ifMatch: '"app-1"',
      csrf: "NONFUNCTIONAL_FIXTURE",
    });
    expect(command?.key).toMatch(uuid);
    await expect(page.getByRole("heading", { name: "Invitation", exact: true })).toBeVisible();
    await expect(
      page.getByText("Email status: Email not requested", { exact: true }),
    ).toBeVisible();
    await expect(decision(page)).toContainText("Approved · ");
  },
);

test(
  "A3 reject needs a non-blank reason and sends it untrimmed",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await open(page);
    await select(page, names.submitted);
    const reject = decision(page).getByRole("button", { name: text.en.reject, exact: true }),
      reason = page.getByLabel("Reason", { exact: true });
    await expect(reject).toBeDisabled();
    await expect(reason).toHaveAccessibleDescription(
      "Required to reject. It is emailed to the applicant and kept in the application history.",
    );
    await reason.fill("   ");
    await expect(reject).toBeDisabled();
    await reason.fill(" Fictional incomplete profile ");
    await expect(reject).toBeEnabled();
    await reject.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Fictional incomplete profile");
    await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(state.commands.map((command) => command.body)).toEqual([
      '{"decision":"reject","reason":" Fictional incomplete profile "}',
    ]);
    expect(state.commands[0]?.ifMatch).toBe('"app-1"');
    await expect(decision(page)).toContainText("Rejected · ");
    await expect(decision(page)).toContainText(
      "This reason was queued for email to the applicant.",
    );
  },
);

test(
  "A3 a multi-line reason keeps its line breaks in the dialog, decision and history",
  browserCase(["@layout"]),
  async ({ page }) => {
    const state = await open(page);
    await select(page, names.submitted);
    await settledDetail(page, false);
    const lines = ["Fictional first line", "Fictional second line"].join("\n");
    await page.getByLabel("Reason", { exact: true }).fill(lines);
    await decision(page).getByRole("button", { name: text.en.reject, exact: true }).click();
    const dialog = page.getByRole("dialog"),
      rendered = (locator: Locator) =>
        locator.evaluate((element) => (element as HTMLElement).innerText);
    expect(await rendered(dialog.locator(".applications-quote"))).toBe(lines);
    await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(state.commands[0]?.body).toBe(JSON.stringify({ decision: "reject", reason: lines }));
    const quote = decision(page).locator(".applications-quote");
    await expect(quote).toBeVisible();
    expect(await rendered(quote)).toBe(`«${lines}»`);
    const history = detail(page).locator(".applications-reason-text").first();
    await expect(history).toContainText("Fictional second line");
    expect(await rendered(history)).toBe(lines);
  },
);

test(
  "A3 an aborted approve keeps its key and body for Refresh",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await open(page);
    state.commandOutcomes.push("abort");
    await select(page, names.submitted);
    await decision(page).getByRole("button", { name: text.en.approve, exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(decision(page).getByRole("alert")).toContainText(
      "The result could not be confirmed.",
    );
    await decision(page).getByRole("button", { name: "Refresh", exact: true }).click();
    await expect.poll(() => state.commands.length).toBe(2);
    const [first, second] = state.commands;
    expect(second?.key).toBe(first?.key);
    expect(second?.body).toBe('{"decision":"approve"}');
    expect(second?.ifMatch).toBe(first?.ifMatch);
    await expect(page.getByRole("heading", { name: "Invitation", exact: true })).toBeVisible();
  },
);

test(
  "A3 a conflicting decision explains it and re-reads the application",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await open(page);
    state.commandOutcomes.push(409);
    await select(page, names.submitted);
    await settledDetail(page, false);
    const before = state.reads.filter(
      (path) => path === `/admin/applications/${ids.submitted}`,
    ).length;
    await decision(page).getByRole("button", { name: text.en.approve, exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(decision(page).getByRole("alert")).toContainText(
      "This record changed or the request is no longer valid.",
    );
    await expect
      .poll(
        () => state.reads.filter((path) => path === `/admin/applications/${ids.submitted}`).length,
      )
      .toBeGreaterThan(before);
  },
);

test(
  "A3 copy, send, retry and reissue keep their bodies and versions",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await open(page, {}, "approved");
    state.reads.length = 0;
    await select(page, names.approved);
    await settledDetail(page, true);
    // Opening a detail reads exactly the detail, history, invitation and capabilities.
    expect([...state.reads].sort()).toEqual(
      [
        `/admin/applications/${ids.approved}`,
        `/admin/applications/${ids.approved}/history`,
        `/admin/invitations/${ids.invitation}`,
        "/admin/source-capabilities",
      ].sort(),
    );
    const copy = invitation(page).getByRole("button", { name: text.en.copy, exact: true });
    await copy.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("pre")).toContainText("example.invalid");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(copy).toBeFocused();
    expect(state.commands[0]).toMatchObject({
      path: `/admin/invitations/${ids.invitation}/copy-link`,
      body: null,
      ifMatch: '"inv-1"',
      contentType: undefined,
    });
    expect(state.commands[0]?.key).toMatch(uuid);
    await expect(invitation(page)).toContainText(
      "No email has been sent. Send it, or copy the link and deliver it yourself.",
    );
    await invitation(page).getByRole("button", { name: "Send to email", exact: true }).click();
    await expect(page.getByText("Email status: Queued", { exact: true })).toBeVisible();
    expect(state.commands[1]).toMatchObject({
      path: `/admin/invitations/${ids.invitation}/email-deliveries`,
      body: null,
      ifMatch: '"inv-1"',
    });
    expect(state.commands[1]?.key).toMatch(uuid);
    await expect(invitation(page).getByRole("button", { name: "Send to email" })).toHaveCount(0);
    await invitation(page).getByRole("button", { name: text.en.reissue, exact: true }).click();
    const reissue = page.getByRole("dialog");
    await expect(reissue).toContainText(
      "The current link stops working at once, including copies already shared.",
    );
    await reissue.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(reissue).toHaveCount(0);
    expect(state.commands[2]).toMatchObject({
      path: `/admin/invitations/${ids.invitation}/reissue`,
      body: null,
      ifMatch: '"inv-2"',
    });
    expect(state.commands[2]?.key).toMatch(uuid);
    await expect(
      page.getByText("Email status: Email not requested", { exact: true }),
    ).toBeVisible();
  },
);

test(
  "A3 a failed delivery offers Retry email with the delivery version",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await open(
      page,
      {
        invitation: { emailDelivery: "failed", deliveryId: ids.delivery },
        delivery: { state: "failed" },
      },
      "approved",
    );
    state.reads.length = 0;
    await select(page, names.approved);
    await settledDetail(page, true);
    await expect(
      page.getByText("Email status: Known delivery failure", { exact: true }),
    ).toBeVisible();
    expect(state.reads).toContain(`/mail-deliveries/${ids.delivery}`);
    await expect(invitation(page)).toContainText(
      "Delivery failed. Retry the email, or copy the link and deliver it yourself.",
    );
    await expect(invitation(page).getByRole("button", { name: "Send to email" })).toHaveCount(0);
    await invitation(page).getByRole("button", { name: "Retry email", exact: true }).click();
    await expect.poll(() => state.commands.length).toBe(1);
    expect(state.commands[0]).toMatchObject({
      path: `/mail-deliveries/${ids.delivery}/resends`,
      body: null,
      ifMatch: '"mail-1"',
    });
    expect(state.commands[0]?.key).toMatch(uuid);
  },
);

test(
  "A4 list loading, error, Refresh and empty states",
  browserCase(["@functional"]),
  async ({ page }, info) => {
    const state = await mockApplications(page);
    let release = () => {};
    state.listGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    state.listStatus = 503;
    await page.goto("/account/admin/applications");
    await expect(master(page).getByRole("status")).toHaveText("Loading…");
    await expect(rows(page)).toHaveCount(0);
    release();
    state.listGate = null;
    await expect(master(page).getByRole("alert")).toContainText("This information is unavailable.");
    await expect(page.getByText("PRIVATE_SENTINEL")).toHaveCount(0);
    await capture(page, info, "applications-list-error");
    state.listStatus = 200;
    state.listEmpty = true;
    await master(page).getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(
      master(page).getByText("There are no records in this view.", { exact: true }),
    ).toBeVisible();
    await expect(master(page).getByRole("alert")).toHaveCount(0);
    await expect(master(page).getByRole("table")).toHaveCount(0);
    await capture(page, info, "applications-list-empty");
  },
);

test("A4 detail read errors offer Refresh", browserCase(["@functional"]), async ({ page }) => {
  const state = await open(page);
  state.detailStatus = 503;
  await master(page).getByRole("button", { name: names.submitted, exact: true }).click();
  await expect(page.locator(".applications-detail").getByRole("alert")).toContainText(
    "This information is unavailable.",
  );
  state.detailStatus = 200;
  await page
    .locator(".applications-detail")
    .getByRole("button", { name: "Refresh", exact: true })
    .click();
  await expect(page.getByRole("heading", { level: 2, name: names.submitted })).toBeVisible();
});

test(
  "A4 a session without applications.manage sees the restricted card",
  browserCase(["@functional"]),
  async ({ page }) => {
    await mockApplications(page, {
      capabilities: ["company.read", "events.respond", "trips.submit_own"],
    });
    await page.goto("/account/admin/applications");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Access restricted");
    await expect(page.locator(".applications-page")).toHaveCount(0);
  },
);

test(
  "A4 expired, used and replaced invitations explain the state",
  browserCase(["@functional"]),
  async ({ page }) => {
    const past = new Date(Date.now() - 86_400_000).toISOString().replace(/\.\d{3}Z$/, ".000Z");
    for (const [invite, badge, line, reissue] of [
      [{ state: "expired", expiresAt: past }, "Expired", "The link expired on", true],
      [{ state: "active", expiresAt: past }, "Expired", "The link expired on", true],
      [{ state: "used" }, "Used", "The link was used", false],
      [{ state: "revoked" }, "Replaced", "replaced by a reissued one", false],
    ] as const) {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await open(page, { invitation: invite }, "approved");
      await select(page, names.approved);
      await settledDetail(page, true);
      await expect(invitation(page).locator(".applications-invite")).toHaveText(badge);
      await expect(invitation(page)).toContainText(line);
      for (const name of [text.en.copy, "Send to email", "Retry email"])
        await expect(invitation(page).getByRole("button", { name })).toHaveCount(0);
      await expect(invitation(page).getByText(/^Email status:/)).toHaveCount(0);
      const button = invitation(page).getByRole("button", { name: text.en.reissue, exact: true });
      if (reissue) await expect(button).toBeEnabled();
      else await expect(button).toHaveCount(0);
    }
  },
);

test(
  "A4 mail states: disabled, ambiguous and accepted",
  browserCase(["@functional"]),
  async ({ page }) => {
    await open(page, { mailEnabled: false }, "approved");
    await select(page, names.approved);
    await settledDetail(page, true);
    await expect(
      invitation(page).getByRole("button", { name: "Send to email", exact: true }),
    ).toBeDisabled();
    await expect(invitation(page)).toContainText("Email is turned off in this runtime.");
    await expect(
      invitation(page).getByRole("button", { name: text.en.copy, exact: true }),
    ).toBeEnabled();
    for (const [mailState, label] of [
      ["ambiguous", "Email status: Outcome unknown; retry is blocked"],
      ["accepted", "Email status: Provider accepted request"],
    ] as const) {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await open(
        page,
        {
          invitation: { emailDelivery: mailState, deliveryId: ids.delivery },
          delivery: { state: mailState },
        },
        "approved",
      );
      await select(page, names.approved);
      await settledDetail(page, true);
      await expect(page.getByText(label, { exact: true })).toBeVisible();
      await expect(invitation(page).getByRole("button", { name: "Retry email" })).toHaveCount(0);
      await expect(invitation(page)).toContainText("It does not prove inbox delivery.");
    }
  },
);

test(
  "A5 the settled list and invitation detail add no live regions",
  browserCase(["@functional"]),
  async ({ page }) => {
    await open(page, {}, "approved");
    await expect(page.getByRole("status")).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await select(page, names.approved);
    await settledDetail(page, true);
    await expect(page.getByRole("status")).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(
      page.locator(".applications-page [aria-live], .applications-page output"),
    ).toHaveCount(0);
  },
);

test(
  "A6 the copy dialog fits a phone and returns focus to Copy link",
  browserCase(["@layout", "@viewport-mobile"]),
  async ({ page }, info) => {
    for (const locale of ["en", "ru"] as const) {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await open(page, {}, "approved", locale);
      await select(page, names.approved);
      await settledDetail(page, true);
      const copy = invitation(page).getByRole("button", { name: text[locale].copy, exact: true });
      await copy.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.locator("pre")).toBeVisible();
      await inViewport(page, dialog);
      expect(
        await dialog
          .locator("pre")
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
      ).toBe(true);
      await dialog.screenshot({ path: info.outputPath(`applications-copy-${locale}.png`) });
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(copy).toBeFocused();
    }
  },
);

test(
  "A7 approve and reissue dialogs fit a phone",
  browserCase(["@layout", "@viewport-mobile"]),
  async ({ page }, info) => {
    for (const locale of ["en", "ru"] as const) {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await open(page, {}, "submitted", locale);
      await select(page, names.submitted);
      await decision(page).getByRole("button", { name: text[locale].approve, exact: true }).click();
      const approve = page.getByRole("dialog");
      await expect(approve).toContainText(text[locale].noEmail);
      await inViewport(page, approve);
      expect(await brokenWords(approve)).toEqual([]);
      await approve.screenshot({ path: info.outputPath(`applications-approve-${locale}.png`) });
      await page.keyboard.press("Escape");
      await expect(approve).toHaveCount(0);
      await page.getByRole("button", { name: text[locale].back, exact: true }).click();
      await page
        .getByRole("navigation", { name: locale === "en" ? "Status" : "Состояние" })
        .getByRole("link", { name: locale === "en" ? "Approved" : "Одобрены" })
        .click();
      await select(page, names.approved);
      await settledDetail(page, true);
      await invitation(page)
        .getByRole("button", { name: text[locale].reissue, exact: true })
        .click();
      const reissue = page.getByRole("dialog");
      await inViewport(page, reissue);
      expect(await brokenWords(reissue)).toEqual([]);
      await reissue.screenshot({ path: info.outputPath(`applications-reissue-${locale}.png`) });
      await page.keyboard.press("Escape");
      await expect(reissue).toHaveCount(0);
    }
  },
);

test(
  "A8 controls keep pointer-appropriate target sizes",
  browserCase(["@layout"]),
  async ({ page }, info) => {
    await open(page);
    await select(page, names.submitted);
    await settledDetail(page, false);
    const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
    if (info.project.name === "mobile-chromium") expect(coarse).toBe(true);
    const root = page.locator(".applications-page");
    for (const control of await root.locator("button:visible, textarea, .admin-tabs a").all())
      expect((await box(control)).height).toBeGreaterThanOrEqual(coarse ? 40 : 24);
    if (info.project.name !== "mobile-chromium") {
      for (const control of await master(page).locator("tbody button").all())
        expect((await box(control)).height).toBeGreaterThanOrEqual(coarse ? 40 : 30);
    }
  },
);

test(
  "A8 invitation actions keep pointer-appropriate target sizes",
  browserCase(["@layout"]),
  async ({ page }) => {
    const minimum = async () =>
      (await page.evaluate(() => matchMedia("(pointer: coarse)").matches)) ? 40 : 24;
    await open(page, {}, "approved");
    await select(page, names.approved);
    await settledDetail(page, true);
    for (const name of [text.en.copy, "Send to email", text.en.reissue])
      expect(
        (await box(invitation(page).getByRole("button", { name, exact: true }))).height,
      ).toBeGreaterThanOrEqual(await minimum());
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await open(
      page,
      {
        invitation: { emailDelivery: "failed", deliveryId: ids.delivery },
        delivery: { state: "failed" },
      },
      "approved",
    );
    await select(page, names.approved);
    await settledDetail(page, true);
    expect(
      (await box(invitation(page).getByRole("button", { name: "Retry email", exact: true })))
        .height,
    ).toBeGreaterThanOrEqual(await minimum());
  },
);

test(
  "A9 keyboard order follows the visual order",
  browserCase(["@layout", "@viewport-non-mobile"]),
  async ({ page }, info) => {
    await open(page);
    const first = master(page).getByRole("button", { name: names.submitted, exact: true });
    await first.focus();
    await page.keyboard.press("Tab");
    await expect(
      master(page).getByRole("button", { name: names.second, exact: true }),
    ).toBeFocused();
    await first.click();
    await settledDetail(page, false);
    await expect(first).toBeFocused();
    await expect(first).toHaveAttribute("aria-pressed", "true");
    await page.getByLabel("Reason", { exact: true }).fill("Fictional reason");
    await page.getByLabel("Reason", { exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(decision(page).getByRole("button", { name: text.en.approve })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(decision(page).getByRole("button", { name: text.en.reject })).toBeFocused();
    // Sections follow the DOM order visually: header, facts, history, decision.
    const tops = await detail(page)
      .locator(
        ":scope > .applications-detail-head, :scope > .applications-facts, :scope > .applications-section",
      )
      .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().top));
    expect(tops.length).toBe(4);
    expect(tops).toEqual([...tops].sort((a, b) => a - b));
  },
);
