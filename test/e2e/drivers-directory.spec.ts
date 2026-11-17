import type { Locator, Page, TestInfo } from "@playwright/test";
import { levelId } from "./support/drivers-fixtures.ts";
import {
  adminReads,
  type DirectoryMockState,
  memberCapabilities,
  memberReads,
  mockDirectoryRoutes,
} from "./support/drivers-directory-ui.ts";
import { browserCase, expect, test } from "./support/fixtures.ts";
import { switchLanguage } from "./support/locale.ts";

// Drivers directory (VTC-145) over a server-like listMembers mock: 18 active and 4 former
// fictional members, company-wide counters, filter-bound cursors and the Stage 4 shapes.

const activeDefault = "/members?limit=25&status=active&sort=distance30d&order=desc";
const formerDefault = "/members?limit=25&status=former&sort=lastTrip&order=desc";
const staff = [...memberCapabilities, "applications.manage", "members.manage"];

async function open(page: Page, search = "") {
  await page.clock.setFixedTime(new Date("2026-11-15T12:00:00Z"));
  await page.goto(`/account/drivers${search}`);
}
const table = (page: Page) =>
  page.getByRole("table", {
    name: /^(Drivers in the company|Водители в составе компании|Members who left the company|Ушедшие из компании)$/,
  });
const rows = (page: Page) => table(page).locator("tbody tr");
const nicknames = (page: Page) => table(page).getByRole("rowheader").getByRole("link");
const row = (page: Page, nickname: string) =>
  table(page)
    .getByRole("row")
    .filter({ has: page.getByRole("link", { name: nickname, exact: true }) });
const tab = (page: Page, name: RegExp) => page.getByRole("tab", { name });
const filters = (page: Page) =>
  page.getByRole("group", { name: /^(Driver filters|Фильтры водителей)$/ });
const search = (page: Page) =>
  page.getByRole("searchbox", { name: /^(Search drivers|Поиск водителя)$/ });
const select = (page: Page, name: string) =>
  filters(page).getByRole("combobox", { name, exact: true });
const pager = (page: Page) => page.getByRole("navigation", { name: /^(Pages|Страницы)$/ });
async function loaded(page: Page) {
  await expect(rows(page).first()).toBeVisible();
  await expect(table(page)).not.toHaveAttribute("aria-busy", "true");
  await expect(page.locator(".drivers-table[data-busy]")).toHaveCount(0);
}
async function box(locator: Locator) {
  const value = await locator.boundingBox();
  if (!value) throw new Error("ELEMENT_NOT_RENDERED");
  return value;
}
const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
async function capture(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  expect(await noOverflow(page)).toBe(true);
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
}
const since = (state: DirectoryMockState, before: number) => memberReads(state).slice(before);

test.describe("Drivers directory", () => {
  test(
    "lists the company by 30-day distance with counters, levels, zero rows and no private data",
    browserCase(["@functional"]),
    async ({ page }) => {
      const state = await mockDirectoryRoutes(page);
      await open(page);
      await loaded(page);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Drivers");
      await expect(page.locator(".drivers-counts")).toHaveText(
        "18 in the company · 15 drove in the last 30 days",
      );
      await expect(
        page.getByRole("tablist", { name: "Company membership" }).getByRole("tab"),
      ).toHaveText(["In company18", "Left4"]);
      await expect(tab(page, /^In company: 18$/)).toHaveAttribute("aria-selected", "true");
      await expect(tab(page, /^Left: 4$/)).toBeVisible();
      await expect(tab(page, /Invited/)).toHaveCount(0);

      await expect(table(page).getByRole("columnheader")).toHaveText(
        ["Driver", "ETS2", "ATS", "Distance, 30 days", "Trips, 30 days", "Last trip"],
        { useInnerText: true },
      );
      await expect(
        table(page).getByRole("columnheader", { name: "Distance, 30 days" }),
      ).toHaveAttribute("aria-sort", "descending");
      await expect(nicknames(page)).toHaveText([
        "Romeo Long Distance Hauler of the Northern Routes",
        "AlphaHauler",
        "JulietRoute",
        "PapaLogistics",
        "EchoRunner",
        "OscarTrail",
        "LimaConvoy",
        "DeltaVeteran",
        "KiloFreight",
        "HotelTransit",
        "IndiaCargo",
        "Fictional Yukon Member",
        "MikeHauler",
        "BetaTrainee",
        "QuebecMile",
        "FoxtrotLane",
        "GolfCarrier",
        "NovemberRig",
      ]);
      await expect(row(page, "EchoRunner").getByRole("cell")).toHaveText(
        ["Driver II", "Highway Driver II", "3,150 km", "9", "13 Nov 2026"],
        { useInnerText: true },
      );
      // A zero row is 0; a member without a level "doesn't drive", spoken as no current level.
      const zero = row(page, "FoxtrotLane");
      await expect(zero.getByRole("cell")).toHaveText(
        ["Driver III", "doesn't drive No current ATS level", "0 km", "0", "No accepted trips"],
        { useInnerText: true },
      );
      await expect(zero.getByRole("cell", { name: "No current ATS level" })).toBeVisible();
      await expect(row(page, "OscarTrail").getByRole("rowheader")).toContainText("DirectorDriver");
      await expect(
        row(page, "Fictional Yukon Member").getByText("You", { exact: true }),
      ).toBeVisible();
      await expect(
        row(page, "EchoRunner").getByRole("link", { name: "EchoRunner" }),
      ).toHaveAttribute("href", "/account/drivers/41000000-0000-4000-8000-000000000201");
      await expect(pager(page).getByText("Page 1")).toBeVisible();
      await expect(page.getByText("Dates: UTC")).toBeVisible();

      // The 30-day rule sits behind the ⓘ button, not in the page text.
      const hint = page.getByRole("button", { name: "How the 30 days are counted" });
      await hint.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("dialog")).toHaveText(
        "30-day distance and trips count accepted trips whose reporting time falls in the 30 days up to 14 Nov 2026, 12:00 (UTC). Pending and rejected reports are not counted.",
      );
      await page.keyboard.press("Escape");
      await expect(hint).toBeFocused();

      const text = await page.getByRole("main").innerText();
      expect(text).not.toContain(levelId("ets2", "driver_ii"));
      expect(text).not.toMatch(/\b(directory|invited|roles)\.[a-z]/);
      expect(memberReads(state)).toEqual([activeDefault]);
      expect(adminReads(state)).toEqual([]);
      expect(state.unexpected).toEqual([]);
    },
  );

  test(
    "sorts from the headers, keeps focus and rows while loading and restarts the cursor",
    browserCase(["@functional"]),
    async ({ page }) => {
      const state = await mockDirectoryRoutes(page, { pageCap: 10 });
      await open(page);
      await loaded(page);
      await pager(page).getByRole("button", { name: "Next page" }).click();
      await expect(pager(page).getByText("Page 2")).toBeVisible();
      expect(memberReads(state).at(-1)).toMatch(/&cursor=fixture-directory/);

      const distance = page.getByRole("button", { name: "Distance, 30 days" });
      state.hold("members");
      await distance.click();
      // The previous rows stay, dimmed, while the other order loads.
      await expect(page.locator(".drivers-table")).toHaveAttribute("data-busy", "true");
      await expect(rows(page)).toHaveCount(8);
      state.release("members");
      await expect(page).toHaveURL("/account/drivers?sort=distance30d&order=asc");
      await expect(
        table(page).getByRole("columnheader", { name: "Distance, 30 days" }),
      ).toHaveAttribute("aria-sort", "ascending");
      await expect(nicknames(page).first()).toHaveText("FoxtrotLane");
      await expect(distance).toBeFocused();
      await expect(pager(page).getByText("Page 1")).toBeVisible();
      expect(memberReads(state).at(-1)).toBe(
        "/members?limit=25&status=active&sort=distance30d&order=asc",
      );

      // Back to the default drops the sort from the URL.
      await distance.click();
      await expect(page).toHaveURL("/account/drivers");
      const trips = page.getByRole("button", { name: "Trips, 30 days" });
      await trips.click();
      await expect(page).toHaveURL("/account/drivers?sort=trips30d");
      await loaded(page);
      await expect(nicknames(page).first()).toHaveText("AlphaHauler");
      await expect(trips).toBeFocused();
      const lastTrip = page.getByRole("button", { name: "Last trip" });
      await lastTrip.click();
      await expect(page).toHaveURL("/account/drivers?sort=lastTrip");
      await loaded(page);
      await expect(lastTrip).toBeFocused();
      await page.getByRole("button", { name: "Driver", exact: true }).click();
      await expect(page).toHaveURL("/account/drivers?sort=nickname");
      await loaded(page);
      await expect(nicknames(page).first()).toHaveText("AlphaHauler");
      await expect
        .poll(() => memberReads(state).slice(-3))
        .toEqual([
          "/members?limit=25&status=active&sort=trips30d&order=desc",
          "/members?limit=25&status=active&sort=lastTrip&order=desc",
          "/members?limit=25&status=active&sort=nickname&order=asc",
        ]);
      expect(state.unexpected).toEqual([]);
    },
  );

  test(
    "search, role and level filters update the URL, reset the cursor and keep the counters",
    browserCase(["@functional"]),
    async ({ page }) => {
      const state = await mockDirectoryRoutes(page, { pageCap: 10 });
      await open(page);
      await loaded(page);
      await pager(page).getByRole("button", { name: "Next page" }).click();
      await expect(pager(page).getByText("Page 2")).toBeVisible();

      const box = search(page);
      await box.fill("  hauler");
      await expect(page).toHaveURL("/account/drivers?search=hauler");
      await expect(nicknames(page)).toHaveText([
        "Romeo Long Distance Hauler of the Northern Routes",
        "AlphaHauler",
        "MikeHauler",
      ]);
      await expect(box).toBeFocused();
      expect(memberReads(state).at(-1)).toBe(
        "/members?limit=25&status=active&search=hauler&sort=distance30d&order=desc",
      );
      await expect(tab(page, /^In company: 18$/)).toBeVisible();

      const role = select(page, "Role");
      await role.focus();
      await role.selectOption("dispatcher");
      await expect(page).toHaveURL("/account/drivers?search=hauler&role=dispatcher");
      await expect(nicknames(page)).toHaveText(["AlphaHauler"]);
      await expect(role).toBeFocused();

      const ets2 = select(page, "ETS2 level");
      await expect(ets2.locator("option")).toHaveText([
        "ETS2 level",
        "Trainee",
        "Driver III",
        "Driver II",
        "Driver I",
      ]);
      await role.selectOption("");
      await ets2.focus();
      await ets2.selectOption({ label: "Driver II" });
      const driverII = levelId("ets2", "driver_ii");
      await expect(page).toHaveURL(`/account/drivers?search=hauler&ets2Level=${driverII}`);
      await expect(nicknames(page)).toHaveText([
        "Romeo Long Distance Hauler of the Northern Routes",
        "AlphaHauler",
      ]);
      await expect(ets2).toBeFocused();
      const atsSelect = select(page, "ATS level");
      await atsSelect.focus();
      await atsSelect.selectOption({ label: "Highway Driver III" });
      await expect(nicknames(page)).toHaveText(["AlphaHauler"]);
      await expect(atsSelect).toBeFocused();
      expect(memberReads(state).at(-1)).toBe(
        `/members?limit=25&status=active&search=hauler&ets2Level=${driverII}&atsLevel=${levelId("ats", "driver_iii")}&sort=distance30d&order=desc`,
      );
      expect(memberReads(state).filter((path) => path.includes("cursor"))).toHaveLength(1);
      await expect(tab(page, /^In company: 18$/)).toBeVisible();
      await expect(tab(page, /^Left: 4$/)).toBeVisible();

      // Back restores the previous URL and the search draft.
      await box.fill("alpha");
      await expect(page).toHaveURL(/search=alpha/);
      await page.goBack();
      await expect(page).toHaveURL(`/account/drivers?search=hauler&ets2Level=${driverII}`);
      await expect(box).toHaveValue("hauler");
      await expect(select(page, "ATS level")).toHaveValue("");

      await filters(page).getByRole("button", { name: "Reset filters" }).click();
      await expect(page).toHaveURL("/account/drivers");
      await expect(box).toHaveValue("");
      await expect(box).toBeFocused();
      await expect(rows(page)).toHaveCount(10);
      expect(state.unexpected).toEqual([]);
    },
  );

  test(
    "restarts a rejected cursor at page 1 without an error",
    browserCase(["@functional"]),
    async ({ page }) => {
      const state = await mockDirectoryRoutes(page, { pageCap: 10 });
      await open(page);
      await loaded(page);
      state.rejectNextCursor = true;
      const before = memberReads(state).length;
      await pager(page).getByRole("button", { name: "Next page" }).click();
      await expect(pager(page).getByText("Page 1")).toBeVisible();
      await expect(nicknames(page).first()).toHaveText(
        "Romeo Long Distance Hauler of the Northern Routes",
      );
      // The first page is still fresh in the cache, so only the rejected request was sent.
      expect(since(state, before)).toHaveLength(1);
      expect(since(state, before)[0]).toMatch(/&cursor=fixture-directory/);
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(rows(page)).toHaveCount(10);
    },
  );

  test(
    "shows the invalid-filters state for a stale level and recovers with Reset",
    browserCase(["@functional"]),
    async ({ page }) => {
      const state = await mockDirectoryRoutes(page);
      const stale = "41000000-0000-4000-8000-0000000009ff";
      await open(page, `?ets2Level=${stale}`);
      const alert = page.getByRole("alert");
      await expect(alert).toContainText("These filters or this sort are not available now.");
      // The implicit activity sort is tried once, then the nickname fallback.
      expect(memberReads(state)).toEqual([
        `/members?limit=25&status=active&ets2Level=${stale}&sort=distance30d&order=desc`,
        `/members?limit=25&status=active&ets2Level=${stale}&sort=nickname&order=asc`,
      ]);
      await expect(select(page, "ETS2 level")).toHaveValue(stale);
      await expect(select(page, "ETS2 level").locator("option:checked")).toHaveText(
        "Level unavailable",
      );
      await alert.getByRole("button", { name: "Reset filters" }).click();
      await expect(page).toHaveURL("/account/drivers");
      await expect(search(page)).toBeFocused();
      await loaded(page);
      await expect(page.getByRole("alert")).toHaveCount(0);
      expect(memberReads(state).at(-1)).toBe(activeDefault);
      // An explicit activity sort the server refuses is not retried.
      const before = memberReads(state).length;
      await open(page, `?ets2Level=${stale}&sort=trips30d`);
      await expect(page.getByRole("alert")).toContainText("not available now");
      expect(since(state, 0).slice(before)).toEqual([
        `/members?limit=25&status=active&ets2Level=${stale}&sort=trips30d&order=desc`,
      ]);
    },
  );

  test(
    "returns to the distance default when a valid level replaces a stale one",
    browserCase(["@functional"]),
    async ({ page }) => {
      const state = await mockDirectoryRoutes(page);
      const stale = "41000000-0000-4000-8000-0000000009ff";
      await open(page, `?ets2Level=${stale}`);
      await expect(page.getByRole("alert")).toContainText("not available now");
      expect(memberReads(state)).toHaveLength(2);
      // Picking a level instead of Reset: the nickname page proves Trips on, so the activity
      // default is requested once more and stays the default.
      const ets2 = select(page, "ETS2 level");
      await ets2.focus();
      await ets2.selectOption({ label: "Driver II" });
      const driverII = levelId("ets2", "driver_ii");
      await expect(page).toHaveURL(`/account/drivers?ets2Level=${driverII}`);
      await expect
        .poll(() => memberReads(state).at(-1))
        .toBe(`/members?limit=25&status=active&ets2Level=${driverII}&sort=distance30d&order=desc`);
      await loaded(page);
      await expect(
        table(page).getByRole("columnheader", { name: "Distance, 30 days" }),
      ).toHaveAttribute("aria-sort", "descending");
      await expect(table(page).getByRole("columnheader", { name: "Driver" })).not.toHaveAttribute(
        "aria-sort",
        "ascending",
      );
      await expect(nicknames(page).first()).toHaveText(
        "Romeo Long Distance Hauler of the Northern Routes",
      );
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(ets2).toBeFocused();
      // One nickname page settled the fallback, then exactly one activity request followed.
      expect(memberReads(state).slice(2)).toEqual([
        `/members?limit=25&status=active&ets2Level=${driverII}&sort=nickname&order=asc`,
        `/members?limit=25&status=active&ets2Level=${driverII}&sort=distance30d&order=desc`,
      ]);
      // Clicking Driver now writes the nickname sort: it is no longer the default.
      await page.getByRole("button", { name: "Driver", exact: true }).click();
      await expect(page).toHaveURL(`/account/drivers?ets2Level=${driverII}&sort=nickname`);
      expect(state.unexpected).toEqual([]);
    },
  );

  test(
    "clears inactive directory pages and refreshes the session after a 403",
    browserCase(["@functional"]),
    async ({ page }) => {
      const state = await mockDirectoryRoutes(page, { pageCap: 2 });
      await open(page);
      await loaded(page);
      await tab(page, /^Left: 4$/).click();
      await loaded(page);
      const sessions = () => state.requests.filter((url) => url.pathname === "/api/v1/me").length;
      const before = sessions();
      // The refused read is the next Left page, so the In company key itself stays unchanged.
      state.failures.members = 403;
      await pager(page).getByRole("button", { name: "Next page" }).click();
      await expect(page.getByRole("alert")).toBeVisible();
      expect(memberReads(state).at(-1)).toMatch(/^\/members\?limit=25&status=former&.*&cursor=/);
      await expect.poll(sessions).toBeGreaterThan(before);
      delete state.failures.members;
      // The In company page was cached and inactive: the 403 removed it, so it is read again.
      const reads = memberReads(state).length;
      await tab(page, /^In company: 18$/).click();
      await expect.poll(() => memberReads(state).slice(reads)).toEqual([activeDefault]);
      await expect(nicknames(page).first()).toHaveText(
        "Romeo Long Distance Hauler of the Northern Routes",
      );
      expect(state.unexpected).toEqual([]);
    },
  );

  test(
    "falls back to nickname once without Trips and marks activity unavailable",
    browserCase(["@functional"]),
    async ({ page }) => {
      const state = await mockDirectoryRoutes(page, { tripsOff: true });
      await open(page);
      await loaded(page);
      expect(memberReads(state)).toEqual([
        activeDefault,
        "/members?limit=25&status=active&sort=nickname&order=asc",
      ]);
      await expect(page.locator(".drivers-counts")).toHaveText("18 in the company");
      await expect(page.getByRole("button", { name: "How the 30 days are counted" })).toHaveCount(
        0,
      );
      await expect(nicknames(page).first()).toHaveText("AlphaHauler");
      const echo = row(page, "EchoRunner");
      await expect(echo.getByRole("cell", { name: "Unavailable" })).toHaveCount(3);
      await expect(echo.getByRole("cell", { name: "Highway Driver II" })).toBeVisible();
      for (const name of ["Distance, 30 days", "Trips, 30 days", "Last trip"])
        await expect(page.getByRole("button", { name })).toHaveCount(0);
      await expect(table(page).getByRole("columnheader", { name: "Driver" })).toHaveAttribute(
        "aria-sort",
        "ascending",
      );
      await tab(page, /^Left: 4$/).click();
      await expect(page).toHaveURL("/account/drivers?tab=former");
      await loaded(page);
      expect(memberReads(state).at(-1)).toBe(
        "/members?limit=25&status=former&sort=nickname&order=asc",
      );
      expect(memberReads(state)).toHaveLength(3);
    },
  );

  test(
    "hides level filters and marks levels unavailable without Qualifications",
    browserCase(["@functional"]),
    async ({ page }) => {
      await mockDirectoryRoutes(page, { qualificationsOff: true });
      await open(page);
      await loaded(page);
      const echo = row(page, "EchoRunner");
      await expect(echo.getByRole("cell", { name: "Unavailable" })).toHaveCount(2);
      await expect(echo.getByRole("cell", { name: "3,150 km" })).toBeVisible();
      await expect(select(page, "ETS2 level")).toHaveCount(0);
      await expect(select(page, "ATS level")).toHaveCount(0);
      await expect(select(page, "Role")).toBeVisible();
    },
  );

  test(
    "switches to Left from the keyboard with the search kept, the cursor reset and focus on the tab",
    browserCase(["@functional"]),
    async ({ page }) => {
      const state = await mockDirectoryRoutes(page, { pageCap: 10 });
      const driverII = levelId("ets2", "driver_ii");
      await open(page, `?search=er&role=driver&ets2Level=${driverII}`);
      await loaded(page);
      const active = tab(page, /^In company: 18$/);
      await active.focus();
      await page.keyboard.press("ArrowRight");
      const left = tab(page, /^Left: 4$/);
      await expect(left).toBeFocused();
      await expect(active).toHaveAttribute("aria-selected", "true");
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL("/account/drivers?search=er&tab=former");
      await expect(left).toHaveAttribute("aria-selected", "true");
      await expect(left).toBeFocused();
      await loaded(page);
      expect(memberReads(state).at(-1)).toBe(
        "/members?limit=25&status=former&search=er&sort=lastTrip&order=desc",
      );
      await expect(table(page).getByRole("columnheader")).toHaveText(
        ["Driver", "Distance, 30 days", "Trips, 30 days", "Last trip"],
        { useInnerText: true },
      );
      await expect(nicknames(page)).toHaveText(["SierraPast", "TangoEarlier"]);
      await expect(row(page, "SierraPast").getByRole("cell")).toHaveText(
        ["420 km", "1", "2 Nov 2026"],
        { useInnerText: true },
      );
      // Deactivation clears access roles, so Left has no role filter and never sends one.
      await expect(select(page, "ETS2 level")).toHaveCount(0);
      await expect(select(page, "Role")).toHaveCount(0);
      await expect(search(page)).toHaveValue("er");
      await expect(page.locator(".drivers-counts")).toHaveText(
        "18 in the company · 15 drove in the last 30 days",
      );
      await expect(tab(page, /^In company: 18$/)).toBeVisible();

      await search(page).fill("");
      await expect(page).toHaveURL("/account/drivers?tab=former");
      await expect(nicknames(page)).toHaveText([
        "SierraPast",
        "UniformGone",
        "GammaRetired",
        "TangoEarlier",
      ]);
      await page.goto("/account/drivers?tab=former&role=driver");
      await loaded(page);
      expect(memberReads(state).at(-1)).toBe(formerDefault);
      expect(
        memberReads(state).filter((path) => path.includes("status=former") && /role=/.test(path)),
      ).toEqual([]);
    },
  );

  test(
    "shows Invited with its counter only for applications.manage, without links, tokens or emails",
    browserCase(["@functional"]),
    async ({ page }) => {
      const state = await mockDirectoryRoutes(page, {
        capabilities: [...memberCapabilities, "applications.manage"],
        displayTimezone: "Europe/Moscow",
      });
      await open(page);
      await loaded(page);
      await expect(page.getByRole("tablist").getByRole("tab")).toHaveText([
        "In company18",
        "Invited2",
        "Left4",
      ]);
      expect(adminReads(state)).toEqual(["/admin/invitations?state=active&limit=1"]);
      await tab(page, /^Invited: 2$/).click();
      await expect(page).toHaveURL("/account/drivers?tab=invited");
      const invitations = page.getByRole("table", { name: "Active invitations" });
      await expect(invitations.getByRole("rowheader")).toHaveText(
        ["Fictional Applicant One", "Fictional Applicant Two"],
        { useInnerText: true },
      );
      await expect(invitations.getByRole("cell").first()).toHaveText("20 Nov 2026, 15:00", {
        useInnerText: true,
      });
      await expect(page.getByText("Times: Europe/Moscow")).toBeVisible();
      await expect(search(page)).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Approved applications" })).toHaveAttribute(
        "href",
        "/account/admin/applications?status=approved",
      );
      // The counters stay with the smallest directory read.
      await expect(tab(page, /^In company: 18$/)).toBeVisible();
      expect(memberReads(state).at(-1)).toBe("/members?limit=1&sort=nickname");

      const states = page.getByRole("group", { name: "Invitations" });
      await states.getByRole("button", { name: "Expired" }).click();
      await expect(page).toHaveURL("/account/drivers?tab=invited&state=expired");
      await expect(
        page.getByRole("table", { name: "Expired invitations" }).getByRole("rowheader"),
      ).toHaveText(["Fictional Late Applicant"], { useInnerText: true });
      expect(adminReads(state)).toEqual([
        "/admin/invitations?state=active&limit=1",
        "/admin/invitations?state=active&limit=25",
        "/admin/invitations?state=expired&limit=25",
      ]);
      const html = await page.getByRole("main").innerHTML();
      for (const secret of ["@example.invalid", "token", "/invite"])
        expect(html).not.toContain(secret);
      expect(
        await page.evaluate(() => JSON.stringify([localStorage, sessionStorage])),
      ).not.toContain("@example.invalid");

      await tab(page, /^In company: 18$/).click();
      await expect(page).toHaveURL("/account/drivers");
      await loaded(page);
      expect(state.unexpected).toEqual([]);
    },
  );

  test(
    "falls back from Invited without applications.manage and sends no admin request",
    browserCase(["@functional"]),
    async ({ page }) => {
      const state = await mockDirectoryRoutes(page);
      await open(page, "?tab=invited");
      await loaded(page);
      await expect(tab(page, /^In company: 18$/)).toHaveAttribute("aria-selected", "true");
      await expect(tab(page, /Invited/)).toHaveCount(0);
      expect(memberReads(state)).toEqual([activeDefault]);
      expect(adminReads(state)).toEqual([]);
    },
  );

  test(
    "links Access to the Members page only for members.manage and never reads /admin/members",
    browserCase(["@functional"]),
    async ({ page }) => {
      const state = await mockDirectoryRoutes(page, {
        capabilities: [...memberCapabilities, "members.manage"],
      });
      await open(page);
      await loaded(page);
      await expect(table(page).getByRole("columnheader").last()).toHaveText("Access", {
        useInnerText: true,
      });
      await expect(page.getByRole("link", { name: "Access: EchoRunner" })).toHaveAttribute(
        "href",
        "/account/admin/members?status=active&search=EchoRunner",
      );
      await tab(page, /^Left: 4$/).click();
      await loaded(page);
      await expect(page.getByRole("link", { name: "Access: GammaRetired" })).toHaveAttribute(
        "href",
        "/account/admin/members?status=inactive&search=GammaRetired",
      );
      expect(adminReads(state)).toEqual([]);
    },
  );

  test(
    "shows the access notice without company.read and requests no directory data",
    browserCase(["@functional"]),
    async ({ page }) => {
      const state = await mockDirectoryRoutes(page, { capabilities: ["events.respond"] });
      await open(page);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Drivers");
      await expect(page.getByText("You do not have access to driver profiles.")).toBeVisible();
      await expect(page.getByRole("tablist")).toHaveCount(0);
      expect(memberReads(state)).toEqual([]);
      expect(adminReads(state)).toEqual([]);
    },
  );

  test(
    "shows empty, filtered-empty and retryable failure states",
    browserCase(["@functional"]),
    async ({ page }) => {
      const state = await mockDirectoryRoutes(page, { empty: true });
      await open(page);
      await expect(table(page).getByText("No drivers in the company yet.")).toBeVisible();
      await tab(page, /^Left: 4$/).click();
      await expect(table(page).getByText("No one has left the company yet.")).toBeVisible();

      delete state.empty;
      await open(page, "?search=zzz");
      await expect(table(page).getByText("No drivers match these filters.")).toBeVisible();
      await table(page).getByRole("button", { name: "Reset filters" }).click();
      await expect(search(page)).toBeFocused();
      await loaded(page);

      state.failures.members = 503;
      await open(page);
      const alert = page.getByRole("alert");
      await expect(alert).toContainText("Could not load drivers.");
      delete state.failures.members;
      await alert.getByRole("button", { name: "Retry" }).click();
      await loaded(page);
      await expect(page.getByRole("alert")).toHaveCount(0);
    },
  );

  test(
    "switches between English and Russian without rereading the directory",
    browserCase(["@functional"]),
    async ({ page }) => {
      const state = await mockDirectoryRoutes(page);
      await open(page);
      await loaded(page);
      const before = memberReads(state).length;
      await switchLanguage(page, "ru");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Водители");
      await expect(page.locator(".drivers-counts")).toHaveText(
        "18 в составе · 15 ездили за 30 дней",
      );
      await expect(tab(page, /^В составе: 18$/)).toBeVisible();
      await expect(table(page).getByRole("columnheader")).toHaveText(
        ["Водитель", "ETS2", "ATS", "Пробег, 30 дн", "Рейсы, 30 дн", "Последний рейс"],
        { useInnerText: true },
      );
      await expect(row(page, "FoxtrotLane").getByRole("cell")).toHaveText(
        ["Driver III", "не ездит Нет текущего уровня ATS", "0 км", "0", "Нет принятых рейсов"],
        { useInnerText: true },
      );
      const text = await page.getByRole("main").innerText();
      expect(text).not.toMatch(/\b(directory|invited|roles)\.[a-z]/);
      await switchLanguage(page, "en");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Drivers");
      expect(memberReads(state)).toHaveLength(before);
    },
  );
});

test(
  "fits phone, tablet and desktop in both languages with touch-size controls",
  browserCase(["@layout"]),
  async ({ page }, info) => {
    await mockDirectoryRoutes(page, { capabilities: staff });
    const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
    const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
    for (const locale of ["en", "ru"] as const) {
      await open(page);
      if (locale === "ru") await switchLanguage(page, "ru");
      await loaded(page);
      await page.evaluate(() => document.fonts.ready);
      expect(await noOverflow(page)).toBe(true);
      // The first screen shows the heading, tabs, filters and the first driver.
      const first = await box(rows(page).first());
      expect(first.y + Math.min(first.height, 60)).toBeLessThan(viewport.height);
      const cards = viewport.width <= 800;
      expect(
        await table(page)
          .locator("thead")
          .evaluate((head) => getComputedStyle(head).position),
      ).toBe(cards ? "absolute" : "static");
      if (cards)
        await expect(page.getByRole("combobox", { name: /^(Sort|Сортировка)$/ })).toBeVisible();
      if (coarse) {
        const targets = [
          search(page),
          select(page, locale === "en" ? "Role" : "Роль"),
          tab(page, /^(In company|В составе): 18$/),
          rows(page).first().getByRole("link").first(),
          page.getByRole("button", {
            name: /^(How the 30 days are counted|Как считаются 30 дней)$/,
          }),
        ];
        for (const target of targets)
          expect(
            (await box(target)).height,
            await target.evaluate((node) => node.outerHTML.slice(0, 60)),
          ).toBeGreaterThanOrEqual(40);
      }
      // Long nicknames wrap inside their cell instead of widening the table.
      const long = row(page, "Romeo Long Distance Hauler of the Northern Routes");
      const cell = await box(long.getByRole("rowheader"));
      const area = await box(table(page));
      expect(cell.x + cell.width).toBeLessThanOrEqual(area.x + area.width + 0.5);
      await capture(page, info, `drivers-directory-${locale}`);
      if (locale === "ru") await switchLanguage(page, "en");
    }
  },
);

test(
  "changes the phone Sort select from page 2 with the cursor reset and focus kept",
  browserCase(["@layout", "@viewport-mobile"]),
  async ({ page }) => {
    const state = await mockDirectoryRoutes(page, { pageCap: 10 });
    await open(page);
    await loaded(page);
    await pager(page).getByRole("button", { name: "Next page" }).click();
    await expect(pager(page).getByText("Page 2")).toBeVisible();
    await loaded(page);
    expect(memberReads(state).at(-1)).toMatch(/&cursor=fixture-directory/);

    const sort = page.getByRole("combobox", { name: "Sort", exact: true });
    await expect(sort).toHaveValue("distance30d:desc");
    const before = memberReads(state).length;
    await sort.focus();
    await sort.selectOption("trips30d:desc");
    await expect(page).toHaveURL("/account/drivers?sort=trips30d");
    await loaded(page);
    await expect(pager(page).getByText("Page 1")).toBeVisible();
    await expect(nicknames(page).first()).toHaveText("AlphaHauler");
    expect(since(state, before)).toEqual([
      "/members?limit=25&status=active&sort=trips30d&order=desc",
    ]);
    await expect(sort).toHaveValue("trips30d:desc");
    await expect(sort).toBeFocused();
    expect(state.unexpected).toEqual([]);
  },
);
