import type { Locator, Page, TestInfo } from "@playwright/test";
import { catalogLanguage } from "./support/catalogs.ts";
import { expect, test } from "./support/fixtures.ts";
import {
  ids,
  levelId,
  type MembersOptions,
  mockMembers,
  names,
  sentinel,
} from "./support/members.ts";

const text = {
  en: {
    title: "Members",
    headers: ["Member", "Roles", "ETS2", "ATS", "Last accepted", "Status"],
    back: "Back to list",
    membership: "Change membership…",
    saveRoles: "Save roles…",
    deactivate: "Deactivate…",
    steam: "Apply replacement…",
    restore: "Restore…",
    reason: "Reason",
  },
  ru: {
    title: "Участники",
    headers: ["Участник", "Роли", "ETS2", "ATS", "Последний принятый", "Статус"],
    back: "Назад к списку",
    membership: "Сменить членство…",
    saveRoles: "Сохранить роли…",
    deactivate: "Деактивировать…",
    steam: "Применить замену…",
    restore: "Восстановить…",
    reason: "Причина",
  },
} as const;
const protectedNote =
  "The serving Director's membership and roles cannot be changed here and the account cannot be deactivated; the Director changes only through leadership transfer by the Director.";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function box(locator: Locator) {
  const value = await locator.boundingBox();
  if (!value) throw new Error("ELEMENT_NOT_RENDERED");
  return value;
}
const page$ = (page: Page) => page.locator(".members-page");
const master = (page: Page) => page.locator(".members-page .admin-master");
const detail = (page: Page) => page.locator(".members-page .members-detail");
const rows = (page: Page) => master(page).locator("tbody tr");
const heading = (page: Page, name: string) =>
  detail(page).getByRole("heading", { level: 2, name, exact: true });
const feedback = (page: Page) => detail(page).locator(".members-feedback");
const phone = (info: TestInfo) => info.project.name === "mobile-chromium";
async function open(
  page: Page,
  options: MembersOptions = {},
  locale: "en" | "ru" = "en",
  search = "",
) {
  const state = await mockMembers(page, options);
  await page.goto(`/account/admin/members${search}`);
  await catalogLanguage(page, locale);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(text[locale].title);
  await expect(rows(page).first()).toBeVisible();
  return state;
}
async function select(page: Page, nickname: string) {
  await master(page).getByRole("button", { name: nickname, exact: true }).click();
  await expect(heading(page, nickname)).toBeVisible();
}
/** The detail has no loading status left: identity, proofs and level labels settled. */
async function settledDetail(page: Page) {
  await expect(detail(page).locator(".members-steam .members-facts")).toBeVisible();
  await expect(detail(page).getByRole("status")).toHaveCount(0);
}
/**
 * Words that wrap mid-word (a word whose text range spans several lines). Only .members-break
 * (email, Steam URLs, IDs) may break anywhere; clipped header rows and visually hidden text have
 * no visible lines to check.
 */
async function brokenWords(root: Locator) {
  return root.evaluate((element) => {
    const broken: string[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (parent?.closest(".members-break, .visually-hidden")) continue;
      const head = parent?.closest("thead");
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
/** Single-line dates must stay inside their table cell. */
async function datesFit(root: Locator) {
  return root.locator("tbody time").evaluateAll((elements) =>
    elements
      .filter((element) => {
        const cell = element.closest("td")?.getBoundingClientRect(),
          own = element.getBoundingClientRect();
        return !cell || own.right > cell.right + 0.5 || own.left < cell.left - 0.5;
      })
      .map((element) => element.textContent),
  );
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
/** Opens a confirmation, fills its reason and confirms; Confirm stays disabled while blank. */
async function confirmWith(page: Page, trigger: Locator, reason: string) {
  await trigger.click();
  const dialog = page.getByRole("dialog");
  const confirm = dialog.getByRole("button", { name: "Confirm", exact: true });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel("Reason", { exact: true }).fill("   ");
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel("Reason", { exact: true }).fill(reason);
  await expect(confirm).toBeEnabled();
  await confirm.click();
  return dialog;
}

for (const locale of ["en", "ru"] as const)
  test(`M1 ${locale} list and detail are placed by width without overflow`, async ({
    page,
  }, info) => {
    const s = text[locale];
    await open(page, {}, locale);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    const table = master(page).getByRole("table");
    await expect(table.getByRole("columnheader")).toHaveText([...s.headers]);
    await expect(rows(page)).toHaveCount(5);
    await expect(master(page).getByText(ids.kestrel)).toHaveCount(0);
    const workbench = page.locator(".members-page .admin-workbench"),
      display = () => workbench.evaluate((element) => getComputedStyle(element).display);
    if (phone(info)) {
      expect(await display()).toBe("block");
      await expect(detail(page)).toBeHidden();
      expect(await brokenWords(master(page))).toEqual([]);
      await capture(page, info, `members-list-${locale}`);
      await select(page, names.kestrel);
      await expect(master(page)).toBeHidden();
      await settledDetail(page);
      expect(await brokenWords(detail(page))).toEqual([]);
      await capture(page, info, `members-detail-${locale}`);
      await page.getByRole("button", { name: s.back, exact: true }).click();
      await expect(master(page)).toBeVisible();
      await expect(detail(page)).toBeHidden();
    } else {
      expect(await display()).toBe("flex");
      await select(page, names.kestrel);
      await settledDetail(page);
      const list = await box(master(page)),
        side = await box(detail(page));
      if (info.project.name === "desktop-chromium")
        expect(side.x).toBeGreaterThanOrEqual(list.x + list.width);
      else expect(side.y).toBeGreaterThanOrEqual(list.y + list.height);
      expect(await table.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      );
      expect(await brokenWords(master(page))).toEqual([]);
      expect(await datesFit(master(page))).toEqual([]);
      expect(await brokenWords(detail(page))).toEqual([]);
      await capture(page, info, `members-detail-${locale}`);
    }
    await select(page, names.long);
    await settledDetail(page);
    expect(await brokenWords(detail(page))).toEqual([]);
    await noOverflow(page);
    await expect(page.locator("body")).not.toContainText(/Достаточно суров|Yukon\?|Юкон\?/);
  });

for (const locale of ["en", "ru"] as const)
  test(`M1 ${locale} former member restore form fits every width`, async ({ page }, info) => {
    await open(page, {}, locale, "?status=inactive");
    await expect(rows(page)).toHaveCount(1);
    await select(page, names.former);
    await settledDetail(page);
    await expect(
      detail(page).getByRole("button", { name: text[locale].restore, exact: true }),
    ).toBeDisabled();
    await expect(detail(page).locator("#reinstate-ets2")).toBeVisible();
    expect(await brokenWords(detail(page))).toEqual([]);
    await capture(page, info, `members-restore-${locale}`);
  });

test("M2 ru keeps whole words at the narrowest side-by-side width", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-chromium", "The narrow two-column band is one check.");
  await open(page, {}, "ru");
  await select(page, names.kestrel);
  await settledDetail(page);
  let side = false;
  for (let width = 900; width <= 1500 && !side; width += 10) {
    await page.setViewportSize({ width, height: 900 });
    const list = await box(master(page)),
      other = await box(detail(page));
    side = other.x >= list.x + list.width;
  }
  expect(side).toBe(true);
  await noOverflow(page);
  expect(await brokenWords(master(page))).toEqual([]);
  expect(await datesFit(master(page))).toEqual([]);
  expect(await brokenWords(detail(page))).toEqual([]);
  await capture(page, info, "members-ru-narrow-two-column");
});

test("M3 list reads carry status first, the role filter and the debounced search", async ({
  page,
}) => {
  const state = await open(page);
  expect(state.reads).toContain("/admin/members?status=active&limit=25");
  await select(page, names.kestrel);
  const listReads = () => state.reads.filter((path) => path.startsWith("/admin/members?"));
  const before = listReads().length;
  await page
    .getByRole("group", { name: "Role", exact: true })
    .getByRole("button", { name: "Dispatchers", exact: true })
    .click();
  await expect(rows(page)).toHaveCount(2);
  expect(listReads().slice(before)).toEqual([
    "/admin/members?status=active&limit=25&role=dispatcher",
  ]);
  await expect(page).toHaveURL(/\?status=active&role=dispatcher$/);
  await expect(detail(page).getByRole("heading", { level: 2 })).toHaveCount(0);
  await expect(
    master(page).getByRole("button", { name: names.kestrel, exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  const search = page.getByRole("searchbox", { name: "Search by nickname", exact: true });
  await search.pressSequentially("kest", { delay: 40 });
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText(names.kestrel);
  const searched = listReads().filter((path) => path.includes("search="));
  expect(searched).toEqual(["/admin/members?status=active&limit=25&role=dispatcher&search=kest"]);
  await expect(search).toBeFocused();
});

test("M3 typing just after each debounced search write keeps every keystroke", async ({ page }) => {
  const state = await open(page);
  const search = page.getByRole("searchbox", { name: "Search by nickname", exact: true });
  await search.focus();
  // Each keystroke lands just after the previous term was written to the URL.
  await page.keyboard.type("Fictional K", { delay: 330 });
  await expect(search).toHaveValue("Fictional K");
  await expect(page).toHaveURL(/\?status=active&search=Fictional\+K$/);
  await expect(rows(page)).toHaveCount(1);
  await expect(search).toHaveValue("Fictional K");
  expect(state.reads.at(-1)).toBe("/admin/members?status=active&limit=25&search=Fictional%20K");
});

test("M3 membership switch sends one PUT with the reviewed version and no roles call", async ({
  page,
}) => {
  const state = await open(page);
  await select(page, names.kestrel);
  await settledDetail(page);
  const roles = detail(page).locator(".members-roles");
  await expect(roles.getByLabel("Driver", { exact: true })).toBeChecked();
  const change = roles.getByRole("button", { name: text.en.membership, exact: true });
  await expect(change).toBeDisabled();
  await roles.getByLabel("Trainee", { exact: true }).check();
  await expect(roles.locator(".members-unsaved")).toContainText("Unsaved changes");
  await expect(roles.getByRole("button", { name: text.en.saveRoles, exact: true })).toBeDisabled();
  await expect(
    roles.getByText("Save or reset the membership change before changing roles.", { exact: true }),
  ).toBeVisible();
  await change.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading")).toHaveText(`Change ${names.kestrel}'s membership?`);
  for (const point of [
    "Membership: Driver → Trainee",
    "ETS2/ATS qualifications and other roles do not change.",
    "The member stays signed in and keeps telemetry credentials.",
    "Recorded in the audit log.",
  ])
    await expect(dialog.getByText(point, { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(change).toBeFocused();
  await confirmWith(page, change, " Fictional reason ");
  await expect(dialog).toHaveCount(0);
  expect(state.commands).toHaveLength(1);
  const [command] = state.commands;
  expect(command).toMatchObject({
    method: "PUT",
    path: `/admin/members/${ids.kestrel}/membership`,
    body: '{"membership":"trainee","reason":" Fictional reason "}',
    ifMatch: '"m-1"',
    csrf: "NONFUNCTIONAL_FIXTURE",
    contentType: "application/json",
  });
  expect(command?.key).toMatch(uuid);
  await expect(heading(page, names.kestrel)).toBeFocused();
  await expect(roles.getByLabel("Trainee", { exact: true })).toBeChecked();
  await expect(roles.getByLabel("Dispatcher", { exact: true })).toBeChecked();
});

test("M3 save roles sends the additional roles with the server membership", async ({ page }) => {
  const state = await open(page);
  await select(page, names.kestrel);
  await settledDetail(page);
  const roles = detail(page).locator(".members-roles");
  await roles.getByLabel("Dispatcher", { exact: true }).uncheck();
  await roles.getByLabel("Deputy Director", { exact: true }).check();
  await expect(roles.getByRole("button", { name: text.en.membership, exact: true })).toBeDisabled();
  await expect(roles.getByLabel("Dispatcher", { exact: true })).toHaveAccessibleDescription(
    "Reviews manual and disputed trips.",
  );
  const save = roles.getByRole("button", { name: text.en.saveRoles, exact: true });
  await save.click();
  const dialog = page.getByRole("dialog");
  for (const point of [
    "Adds the Deputy Director role.",
    "Removes the Dispatcher role.",
    "Saving roles signs the member out on every device and revokes their personal telemetry credentials.",
  ])
    await expect(dialog.getByText(point, { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await confirmWith(page, save, "Fictional roles");
  await expect(dialog).toHaveCount(0);
  expect(state.commands).toHaveLength(1);
  expect(state.commands[0]).toMatchObject({
    method: "PUT",
    path: `/admin/members/${ids.kestrel}/roles`,
    body: '{"roles":["driver","deputy_director"],"reason":"Fictional roles"}',
    ifMatch: '"m-1"',
  });
  expect(state.commands[0]?.key).toMatch(uuid);
});

test("M3 deactivation keeps a multi-line reason and shows the restore form", async ({ page }) => {
  const state = await open(page);
  await select(page, names.long);
  await settledDetail(page);
  const lines = ["Fictional first line", "Fictional second line"].join("\n");
  const dialog = await confirmWith(
    page,
    detail(page).getByRole("button", { name: text.en.deactivate, exact: true }),
    lines,
  );
  await expect(dialog).toHaveCount(0);
  expect(state.commands).toHaveLength(1);
  expect(state.commands[0]).toMatchObject({
    method: "POST",
    path: `/admin/members/${ids.long}/deactivation`,
    body: JSON.stringify({ reason: lines }),
    ifMatch: '"m-1"',
  });
  await expect(
    detail(page).getByRole("button", { name: text.en.restore, exact: true }),
  ).toBeVisible();
  await expect(detail(page).locator(".members-status")).toHaveText("◇Former member");
});

test("M3 restore sends the existing reinstatement body", async ({ page }) => {
  const state = await open(page, {}, "en", "?status=inactive");
  await select(page, names.former);
  await settledDetail(page);
  const restore = detail(page).locator(".members-restore");
  await expect(restore.getByLabel("Trainee", { exact: true })).toBeChecked();
  await restore.getByLabel("Driver", { exact: true }).check();
  await restore.getByLabel("Dispatcher", { exact: true }).check();
  await restore
    .getByLabel("Euro Truck Simulator 2", { exact: true })
    .selectOption(levelId("ets2", "driver_iii"));
  const trigger = restore.getByRole("button", { name: text.en.restore, exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Roles: Driver, Dispatcher");
  await expect(dialog).toContainText("Euro Truck Simulator 2: Driver III");
  await page.keyboard.press("Escape");
  await confirmWith(page, trigger, "Fictional return");
  await expect(dialog).toHaveCount(0);
  expect(state.commands[0]).toMatchObject({
    method: "POST",
    path: `/admin/members/${ids.former}/reinstatement`,
    body: JSON.stringify({
      roles: ["driver", "dispatcher"],
      assignments: [
        {
          game: "ets2",
          levelId: levelId("ets2", "driver_iii"),
          purpose: "reinstatement",
          reason: "Fictional return",
        },
      ],
      reason: "Fictional return",
    }),
    ifMatch: '"m-1"',
  });
  await expect(
    detail(page).getByRole("button", { name: text.en.deactivate, exact: true }),
  ).toBeVisible();
});

test("M3 Steam replacement sends the proof and reason with the member version", async ({
  page,
}) => {
  const state = await open(page);
  await select(page, names.kestrel);
  await settledDetail(page);
  const steam = detail(page).locator(".members-steam");
  await expect(steam).toContainText("https://steamcommunity.com/id/fictional-kestrel-replacement");
  const dialog = await confirmWith(
    page,
    steam.getByRole("button", { name: text.en.steam, exact: true }),
    "Fictional steam",
  );
  await expect(dialog).toHaveCount(0);
  expect(state.commands[0]).toMatchObject({
    method: "POST",
    path: `/admin/members/${ids.kestrel}/steam-replacement`,
    body: JSON.stringify({ verificationId: ids.proof, reason: "Fictional steam" }),
    ifMatch: '"m-1"',
  });
  expect(state.commands[0]?.key).toMatch(uuid);
  await expect(
    detail(page).getByText("No current verified replacement is available.", { exact: true }),
  ).toBeVisible();
  await expect(heading(page, names.kestrel)).toBeFocused();
});

test("M4 an aborted switch freezes its reason and retries the same request", async ({ page }) => {
  const state = await open(page);
  state.commandOutcomes.push("abort");
  await select(page, names.kestrel);
  await settledDetail(page);
  const roles = detail(page).locator(".members-roles");
  await roles.getByLabel("Trainee", { exact: true }).check();
  const dialog = await confirmWith(
    page,
    roles.getByRole("button", { name: text.en.membership, exact: true }),
    "Fictional reason",
  );
  await expect(dialog.getByRole("alert")).toBeVisible();
  // The held attempt resends its frozen body: the sent reason cannot be edited or re-confirmed.
  await expect(dialog.getByLabel("Reason", { exact: true })).toBeDisabled();
  await expect(dialog.getByLabel("Reason", { exact: true })).toHaveValue("Fictional reason");
  await expect(dialog.getByRole("button", { name: "Confirm", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  const retry = feedback(page).getByRole("button", { name: "Retry the same request", exact: true });
  await expect(retry).toBeFocused();
  await expect(feedback(page).getByRole("alert")).toContainText(
    "The result could not be confirmed.",
  );
  for (const name of [text.en.membership, text.en.deactivate])
    await expect(detail(page).getByRole("button", { name, exact: true })).toBeDisabled();
  await retry.click();
  await expect.poll(() => state.commands.length).toBe(2);
  const [first, second] = state.commands;
  expect(second?.key).toBe(first?.key);
  expect(second?.body).toBe('{"membership":"trainee","reason":"Fictional reason"}');
  expect(second?.ifMatch).toBe(first?.ifMatch);
  expect(second?.path).toBe(`/admin/members/${ids.kestrel}/membership`);
  await expect(roles.getByLabel("Trainee", { exact: true })).toBeChecked();
  await expect(heading(page, names.kestrel)).toBeFocused();
});

test("M4 a Steam retry that fails again keeps focus and the frozen request", async ({ page }) => {
  const state = await open(page);
  state.commandOutcomes.push("abort", "abort");
  await select(page, names.kestrel);
  await settledDetail(page);
  const steam = detail(page).locator(".members-steam");
  const dialog = await confirmWith(
    page,
    steam.getByRole("button", { name: text.en.steam, exact: true }),
    "Fictional steam",
  );
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByLabel("Reason", { exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Confirm", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  const retry = steam.getByRole("button", { name: "Retry the same request", exact: true });
  await expect(retry).toBeFocused();
  await retry.click();
  await expect.poll(() => state.commands.length).toBe(2);
  await expect(retry).not.toHaveAttribute("aria-disabled", "true");
  await expect(retry).toBeFocused();
  await retry.press("Enter");
  await expect.poll(() => state.commands.length).toBe(3);
  expect(new Set(state.commands.map((command) => command.key)).size).toBe(1);
  expect(new Set(state.commands.map((command) => command.ifMatch))).toEqual(new Set(['"m-1"']));
  expect(state.commands.map((command) => command.body)).toEqual(
    Array(3).fill(JSON.stringify({ verificationId: ids.proof, reason: "Fictional steam" })),
  );
  await expect(heading(page, names.kestrel)).toBeFocused();
});

test("M4 a conflicting deactivation explains it and re-reads the member", async ({ page }) => {
  const state = await open(page);
  state.commandOutcomes.push(409);
  await select(page, names.kestrel);
  await settledDetail(page);
  const reads = () => state.reads.filter((path) => path === `/admin/members/${ids.kestrel}`).length;
  const before = reads();
  await confirmWith(
    page,
    detail(page).getByRole("button", { name: text.en.deactivate, exact: true }),
    "Fictional reason",
  );
  await expect(feedback(page).getByRole("alert")).toContainText(
    "This record changed or the request is no longer valid.",
  );
  await expect.poll(reads).toBeGreaterThan(before);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(heading(page, names.kestrel)).toBeFocused();
});

test("M5 the serving director is protected for the director and a deputy", async ({ page }) => {
  for (const session of ["director", "deputy"] as const) {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    const state = await open(page, { session });
    await select(page, names.director);
    await settledDetail(page);
    const roles = detail(page).locator(".members-roles");
    await expect(roles.getByText(protectedNote, { exact: true })).toBeVisible();
    for (const label of ["Trainee", "Driver", "Dispatcher", "Deputy Director"])
      await expect(roles.getByLabel(label, { exact: true })).toBeDisabled();
    await expect(roles.getByLabel("Driver", { exact: true })).toBeChecked();
    await expect(roles.getByLabel("Driver", { exact: true })).toHaveAccessibleDescription(
      protectedNote,
    );
    const deactivate = detail(page).getByRole("button", { name: text.en.deactivate, exact: true });
    await expect(deactivate).toBeDisabled();
    await expect(deactivate).toHaveAccessibleDescription(protectedNote);
    for (const name of [text.en.membership, text.en.saveRoles])
      await expect(detail(page).getByRole("button", { name })).toHaveCount(0);
    await expect(detail(page).locator(".members-steam .members-facts")).toBeVisible();
    const transfer = detail(page).getByRole("link", {
      name: "Open leadership transfer",
      exact: true,
    });
    if (session === "director")
      await expect(transfer).toHaveAttribute("href", "/account/admin/settings");
    else await expect(transfer).toHaveCount(0);
    expect(state.commands).toEqual([]);
  }
});

test("M6 list loading, error, Refresh and empty states", async ({ page }, info) => {
  const state = await mockMembers(page);
  let release = () => {};
  state.listGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  state.listStatus = 503;
  await page.goto("/account/admin/members");
  await expect(master(page).getByRole("status")).toHaveText("Loading…");
  await expect(rows(page)).toHaveCount(0);
  release();
  state.listGate = null;
  await expect(master(page).getByRole("alert")).toContainText("This information is unavailable.");
  await expect(page.getByText(sentinel)).toHaveCount(0);
  await capture(page, info, "members-list-error");
  state.listStatus = 200;
  state.members = [];
  await master(page).getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    master(page).getByText("There are no records in this view.", { exact: true }),
  ).toBeVisible();
  await expect(master(page).getByRole("alert")).toHaveCount(0);
  await expect(master(page).getByRole("table")).toHaveCount(0);
});

test("M6 filtered empty list offers Reset filters", async ({ page }) => {
  await open(page);
  const search = page.getByRole("searchbox", { name: "Search by nickname", exact: true });
  await search.fill("zzz-fictional-nobody");
  await expect(
    master(page).getByText("No members match these filters.", { exact: true }),
  ).toBeVisible();
  await expect(master(page).getByText("There are no records in this view.")).toHaveCount(0);
  await master(page).getByRole("button", { name: "Reset filters", exact: true }).click();
  await expect(rows(page)).toHaveCount(5);
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
  await expect(page).toHaveURL(/\?status=active$/);
});

test("M6 detail read errors offer Refresh", async ({ page }, info) => {
  const state = await open(page);
  state.detailStatus = 503;
  await master(page).getByRole("button", { name: names.kestrel, exact: true }).click();
  await expect(detail(page).getByRole("alert")).toContainText("This information is unavailable.");
  if (phone(info))
    await expect(detail(page).getByRole("button", { name: "Refresh", exact: true })).toBeFocused();
  state.detailStatus = 200;
  await detail(page).getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(heading(page, names.kestrel)).toBeVisible();
});

test("M6 a session without members.manage sees the restricted card", async ({ page }) => {
  await mockMembers(page, {
    capabilities: ["company.read", "events.respond", "trips.submit_own"],
  });
  await page.goto("/account/admin/members");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Access restricted");
  await expect(page$(page)).toHaveCount(0);
});

test("M6 a level options failure marks cells unavailable with a scoped alert", async ({ page }) => {
  const state = await mockMembers(page);
  state.optionsStatus = 503;
  await page.goto("/account/admin/members");
  await expect(rows(page)).toHaveCount(5);
  await expect(master(page).getByRole("alert")).toContainText("This information is unavailable.");
  await expect(rows(page).first().getByRole("cell").nth(1)).toContainText("Unavailable");
  await expect(page.getByText(sentinel)).toHaveCount(0);
  state.optionsStatus = 200;
  await master(page).getByRole("alert").getByRole("button", { name: "Refresh" }).click();
  await expect(master(page).getByRole("alert")).toHaveCount(0);
  await expect(rows(page).first().getByRole("cell").nth(1)).toContainText("Driver I");
});

test("M6 the pager moves focus to the first row of the new page", async ({ page }) => {
  await open(page, { pageSize: 2 });
  await expect(rows(page)).toHaveCount(2);
  await master(page).getByRole("button", { name: "Next page", exact: true }).click();
  await expect(rows(page).first()).toContainText(names.kestrel);
  await expect(
    master(page).getByRole("button", { name: names.kestrel, exact: true }),
  ).toBeFocused();
});

test("M7 the settled list and detail add no live regions", async ({ page }) => {
  await open(page);
  await expect(rows(page).first().getByRole("cell").nth(1)).toContainText("Driver I");
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await select(page, names.kestrel);
  await settledDetail(page);
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator(".members-page [aria-live], .members-page output")).toHaveCount(0);
});

test("M8 confirmation dialogs fit a phone and return focus", async ({ page }, info) => {
  test.skip(!phone(info), "The phone dialog is a 390px check.");
  for (const locale of ["en", "ru"] as const) {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await open(page, {}, locale);
    await select(page, names.kestrel);
    await settledDetail(page);
    const s = text[locale];
    const roles = detail(page).locator(".members-roles");
    await roles.locator('input[value="trainee"]').check();
    for (const [index, name] of [s.membership, s.deactivate, s.steam].entries()) {
      const trigger = detail(page).getByRole("button", { name, exact: true });
      await trigger.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByLabel(s.reason, { exact: true })).toBeVisible();
      await inViewport(page, dialog);
      expect(await brokenWords(dialog)).toEqual([]);
      await dialog.screenshot({
        path: info.outputPath(`members-dialog-${index}-${locale}.png`),
      });
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
    }
  }
});

test("M9 controls keep pointer-appropriate target sizes", async ({ page }, info) => {
  await open(page);
  await select(page, names.kestrel);
  await settledDetail(page);
  const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  if (phone(info)) expect(coarse).toBe(true);
  const root = page$(page);
  for (const control of await root
    .locator(
      "button:visible, .admin-tabs a:visible, .members-option:visible, input[type=search]:visible",
    )
    .all())
    expect((await box(control)).height).toBeGreaterThanOrEqual(coarse ? 40 : 24);
  if (!phone(info))
    for (const control of await master(page).locator("tbody button").all())
      expect((await box(control)).height).toBeGreaterThanOrEqual(coarse ? 40 : 30);
});

test("M10 keyboard order follows the visual order", async ({ page }, info) => {
  test.skip(phone(info), "Phones show one pane at a time; covered by the phone focus test.");
  await open(page);
  await page.getByRole("searchbox", { name: "Search by nickname", exact: true }).focus();
  for (const name of ["All", "Deputy Directors", "Dispatchers", "Drivers", "Trainees"]) {
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name, exact: true })).toBeFocused();
  }
  await page.keyboard.press("Tab");
  const first = master(page).getByRole("button", { name: names.director, exact: true });
  await expect(first).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(master(page).getByRole("button", { name: names.deputy, exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await settledDetail(page);
  await expect(master(page).getByRole("button", { name: names.deputy, exact: true })).toBeFocused();
  // Sections follow the DOM order visually: header, qualifications, roles, Steam, leaving.
  const tops = await detail(page)
    .locator(":scope > .members-head, :scope > .members-section")
    .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().top));
  expect(tops.length).toBe(5);
  expect(tops).toEqual([...tops].sort((a, b) => a - b));
});

test("M10 phone selection focuses the heading and Back restores the row", async ({
  page,
}, info) => {
  test.skip(!phone(info), "The list/detail toggle exists only on phones.");
  await open(page);
  await master(page).getByRole("button", { name: names.trainee, exact: true }).click();
  await expect(heading(page, names.trainee)).toBeFocused();
  await page.getByRole("button", { name: text.en.back, exact: true }).click();
  await expect(
    master(page).getByRole("button", { name: names.trainee, exact: true }),
  ).toBeFocused();
});

test("M11 last accepted dates use the display timezone and null stays neutral", async ({
  page,
}) => {
  await open(page, { displayTimezone: "Europe/Moscow" });
  await expect(master(page)).toContainText(
    "Last accepted is the day of the latest accepted trip's reporting time, shown in Europe/Moscow; no other activity is tracked.",
  );
  const cell = (name: string) =>
    master(page)
      .getByRole("row")
      .filter({ has: page.getByRole("button", { name, exact: true }) })
      .getByRole("cell")
      .nth(3);
  await expect(cell(names.kestrel)).toHaveText("Last accepted1 Nov 2026");
  await expect(cell(names.kestrel).locator("time")).toHaveAttribute(
    "datetime",
    "2026-10-31T23:30:00.000Z",
  );
  await expect(cell(names.trainee)).toHaveText("Last acceptedNone recorded");
  await select(page, names.trainee);
  await expect(detail(page)).toContainText("No accepted trips recorded");
  await expect(detail(page)).toContainText("Dates and times in Europe/Moscow.");
  await expect(page.locator("body")).not.toContainText(/never drove|never driven/i);
});
