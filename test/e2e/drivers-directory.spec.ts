import type { Locator, Page, TestInfo } from "@playwright/test";
import { alphaId, betaId, formerId, levelId } from "./support/drivers-fixtures.ts";
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

async function open(page: Page, search = "", at = "2026-11-15T12:00:00Z") {
  await page.clock.setFixedTime(new Date(at));
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
        ["Driver II", "Highway Driver II", "3,150 km", "9", "2 days ago"],
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
    "shows Access buttons only for members.manage and reads nothing under /admin until one is used",
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
      const echo = page.getByRole("button", { name: "Access: EchoRunner" });
      await expect(echo).toHaveAttribute("aria-haspopup", "dialog");
      await expect(page.getByRole("link", { name: /^Access:/ })).toHaveCount(0);
      await tab(page, /^Left: 4$/).click();
      await loaded(page);
      await expect(page.getByRole("button", { name: "Access: GammaRetired" })).toBeVisible();
      expect(adminReads(state)).toEqual([]);

      // Without members.manage the column is absent and ?access= is ignored.
      await page.unrouteAll({ behavior: "ignoreErrors" });
      const member = await mockDirectoryRoutes(page);
      await open(page, "?access=41000000-0000-4000-8000-000000000201");
      await loaded(page);
      await expect(table(page).getByRole("columnheader", { name: "Access" })).toHaveCount(0);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      expect(adminReads(member)).toEqual([]);
      expect(member.unexpected).toEqual([]);
    },
  );

  test(
    "shows the last trip as a relative day with the absolute time on hover and focus",
    browserCase(["@functional"]),
    async ({ page }) => {
      await mockDirectoryRoutes(page);
      await open(page);
      await loaded(page);
      const last = (nickname: string) => row(page, nickname).locator("time");
      await expect(last("AlphaHauler")).toHaveText("yesterday");
      await expect(last("AlphaHauler")).toHaveAttribute("datetime", "2026-11-14T16:20:00.000Z");
      await expect(last("Fictional Yukon Member")).toHaveText("2 days ago");
      await expect(last("HotelTransit")).toHaveText("6 days ago");
      await expect(last("MikeHauler")).toHaveText("30 Oct 2026");
      await expect(row(page, "FoxtrotLane").getByText("No accepted trips")).toBeVisible();

      await last("AlphaHauler").hover();
      await expect(page.getByRole("tooltip")).toHaveText("14 Nov 2026, 16:20");
      // Away from the tooltip above the day, outside Radix's grace area towards it.
      await page.mouse.move(100, 600, { steps: 5 });
      await expect(page.getByRole("tooltip")).toHaveCount(0);
      // Keyboard focus shows the date and describes the day; Escape hides it. (A row on the first
      // screen: Radix closes a tooltip when the page scrolls.)
      await last("PapaLogistics").focus();
      await expect(page.getByRole("tooltip")).toHaveText("13 Nov 2026, 15:10");
      await expect(last("PapaLogistics")).toHaveAccessibleDescription("13 Nov 2026, 15:10");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("tooltip")).toHaveCount(0);
      await expect(last("PapaLogistics")).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("tooltip")).toHaveText("13 Nov 2026, 15:10");

      await switchLanguage(page, "ru");
      await expect(last("AlphaHauler")).toHaveText("вчера");
      await expect(last("Fictional Yukon Member")).toHaveText("2 дня назад");
      await expect(last("MikeHauler")).toHaveText("30 окт. 2026 г.");
    },
  );

  test(
    "turns today into yesterday at midnight of the display timezone",
    browserCase(["@functional"]),
    async ({ page }) => {
      // 22:00 UTC on 14 November is already 01:00 on 15 November in Moscow.
      const at = "2026-11-14T22:00:00Z";
      await mockDirectoryRoutes(page);
      await open(page, "", at);
      await loaded(page);
      const alpha = row(page, "AlphaHauler").locator("time");
      await expect(alpha).toHaveText("today");
      await expect(row(page, "BetaTrainee").locator("time")).toHaveText("today");
      await expect(row(page, "Fictional Yukon Member").locator("time")).toHaveText("yesterday");

      await page.unrouteAll({ behavior: "ignoreErrors" });
      await mockDirectoryRoutes(page, { displayTimezone: "Europe/Moscow" });
      await open(page, "", at);
      await loaded(page);
      await expect(alpha).toHaveText("yesterday");
      await expect(row(page, "Fictional Yukon Member").locator("time")).toHaveText("2 days ago");
      await alpha.hover();
      await expect(page.getByRole("tooltip")).toHaveText("14 Nov 2026, 19:20");
      await expect(page.getByText("Dates: Europe/Moscow")).toBeVisible();
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

test(
  "taps a relative last-trip day to show and hide its absolute time on a phone",
  browserCase(["@layout", "@viewport-mobile"]),
  async ({ page }) => {
    await mockDirectoryRoutes(page);
    await open(page);
    await loaded(page);
    const alpha = row(page, "AlphaHauler").locator("time");
    await expect(alpha).toHaveText("yesterday");
    expect((await box(alpha)).height).toBeGreaterThanOrEqual(40);
    await alpha.tap();
    await expect(page.getByRole("tooltip")).toHaveText("14 Nov 2026, 16:20");
    await alpha.tap();
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    expect(await noOverflow(page)).toBe(true);
  },
);

// Access panel (VTC-160): the Members page reads and commands over a mutable mock, opened from a
// row of the directory as a drawer (desktop) or a bottom sheet (phones).
const manager = [...memberCapabilities, "members.manage"];
const echoId = "41000000-0000-4000-8000-000000000201";
const sierraId = "41000000-0000-4000-8000-000000000215";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const panel = (page: Page, nickname: string) => page.getByRole("dialog", { name: nickname });
// The modal panel hides the page from the accessibility tree, so these also match hidden nodes.
const hiddenTab = (page: Page, name: RegExp) =>
  page.getByRole("tab", { name, includeHidden: true });
const listRow = (page: Page, nickname: string) =>
  page
    .locator("tbody tr")
    .filter({ has: page.getByRole("link", { name: nickname, exact: true, includeHidden: true }) });
const openRow = (page: Page) => page.locator(".drivers-row[data-access-open]");
const accessButton = (page: Page, nickname: string) =>
  page.getByRole("button", { name: new RegExp(`^(Access|Доступ): ${nickname}$`) });
const membershipChoice = (page: Page, nickname: string) =>
  panel(page, nickname).getByRole("group", { name: /^(Membership|Членство)$/ });
async function openAccess(page: Page, nickname: string) {
  await accessButton(page, nickname).click();
  const dialog = panel(page, nickname);
  await expect(dialog.getByRole("heading", { level: 2, name: nickname })).toBeFocused();
  await expect(dialog.getByText("Loading access…")).toHaveCount(0);
  return dialog;
}
/** Opens the panel's Confirmation, types the reason and confirms. */
async function confirm(page: Page, trigger: string | RegExp, title: string, reason: string) {
  await page.getByRole("button", { name: trigger }).click();
  const dialog = page.getByRole("dialog", { name: title });
  const go = dialog.getByRole("button", { name: /^(Confirm|Подтвердить)$/ });
  await expect(go).toBeDisabled();
  await dialog.getByRole("textbox", { name: /^(Reason|Причина)$/ }).fill(reason);
  await go.click();
  return dialog;
}
const commandBody = (state: DirectoryMockState, index = -1) =>
  JSON.parse(state.commands.at(index)?.body ?? "null") as unknown;

test.describe("Drivers access panel", () => {
  test(
    "opens from a row and saves a membership change with the Members page command",
    browserCase(["@functional"]),
    async ({ page }) => {
      const state = await mockDirectoryRoutes(page, { capabilities: manager });
      await open(page);
      await loaded(page);
      const reads = memberReads(state).length;
      const dialog = await openAccess(page, "BetaTrainee");
      await expect(page).toHaveURL(new RegExp(`[?&]access=${betaId}(&|$)`));
      await expect(openRow(page)).toHaveCount(1);
      await expect(openRow(page)).toContainText("BetaTrainee");
      await expect(dialog).toHaveAccessibleDescription(
        "Access and roles · in the company since 12 Sept 2026",
      );
      expect(adminReads(state)).toEqual([`/admin/members/${betaId}`]);
      const choice = membershipChoice(page, "BetaTrainee");
      await expect(choice.getByRole("button", { name: "Trainee" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      const save = dialog.getByRole("button", { name: "Save" });
      await expect(save).toBeDisabled();
      await choice.getByRole("button", { name: "Driver" }).click();
      await expect(dialog.getByText("Unsaved")).toBeVisible();
      await expect(save).toBeEnabled();

      const confirmation = await confirm(
        page,
        "Save",
        "Change BetaTrainee's membership?",
        "Fictional promotion",
      );
      await expect(confirmation).toHaveCount(0);
      await expect(dialog.getByText("The action was committed.")).toBeVisible();
      await expect(dialog.getByRole("heading", { level: 2, name: "BetaTrainee" })).toBeFocused();
      expect(state.commands).toHaveLength(1);
      const [sent] = state.commands;
      expect(sent).toMatchObject({
        method: "PUT",
        path: `/admin/members/${betaId}/membership`,
        ifMatch: '"m-1"',
        csrf: "NONFUNCTIONAL_FIXTURE",
        contentType: expect.stringMatching(/^application\/json/),
      });
      expect(sent?.key).toMatch(uuid);
      expect(commandBody(state)).toEqual({ membership: "driver", reason: "Fictional promotion" });
      // The list and the panel read again: the badge changes and the new version is shown.
      await expect(listRow(page, "BetaTrainee").locator(".drivers-badges")).toHaveText("Driver");
      expect(memberReads(state).length).toBeGreaterThan(reads);
      await expect(choice.getByRole("button", { name: "Driver" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(adminReads(state).filter((path) => path === `/admin/members/${betaId}`).length).toBe(
        2,
      );

      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(accessButton(page, "BetaTrainee")).toBeFocused();
      await expect(page).not.toHaveURL(/access=/);
      expect(state.unexpected).toEqual([]);
    },
  );

  test(
    "saves one change type at a time and sends the roles command for additional roles",
    browserCase(["@functional"]),
    async ({ page }) => {
      const state = await mockDirectoryRoutes(page, { capabilities: manager });
      await open(page);
      await loaded(page);
      const dialog = await openAccess(page, "AlphaHauler");
      const save = dialog.getByRole("button", { name: "Save" });
      const dispatcher = dialog.getByRole("checkbox", { name: /^Dispatcher/ });
      await expect(dispatcher).toBeChecked();
      await expect(dispatcher).toHaveAccessibleDescription("Reviews manual and disputed trips.");

      // Membership and roles changed together: Save waits until one of them is reset.
      await membershipChoice(page, "AlphaHauler").getByRole("button", { name: "Trainee" }).click();
      await dispatcher.uncheck();
      await expect(
        dialog.getByText("One change is saved at a time: reset the membership or the role change."),
      ).toBeVisible();
      await expect(save).toBeDisabled();
      await dialog.getByRole("button", { name: "Reset" }).first().click();
      await expect(
        membershipChoice(page, "AlphaHauler").getByRole("button", { name: "Driver" }),
      ).toBeFocused();
      await expect(dialog.getByRole("button", { name: "Reset" })).toHaveCount(1);
      await expect(save).toBeEnabled();

      const confirmation = await confirm(
        page,
        "Save",
        "Change AlphaHauler's roles?",
        "Fictional rota change",
      );
      await expect(confirmation).toHaveCount(0);
      await expect(dialog.getByText("The action was committed.")).toBeVisible();
      expect(state.commands.map(({ method, path }) => `${method} ${path}`)).toEqual([
        `PUT /admin/members/${alphaId}/roles`,
      ]);
      expect(commandBody(state)).toEqual({ roles: ["driver"], reason: "Fictional rota change" });
      await expect(dialog.getByRole("checkbox", { name: /^Dispatcher/ })).not.toBeChecked();
      await expect(listRow(page, "AlphaHauler").locator(".drivers-badges")).toHaveText("Driver");
    },
  );

  test(
    "keeps the panel open with a notice after a 403 and removes the Access column",
    browserCase(["@functional"]),
    async ({ page }) => {
      const state = await mockDirectoryRoutes(page, { capabilities: manager });
      await open(page);
      await loaded(page);
      const dialog = await openAccess(page, "BetaTrainee");
      await membershipChoice(page, "BetaTrainee").getByRole("button", { name: "Driver" }).click();
      const meReads = state.requests.filter((url) => url.pathname === "/api/v1/me").length;
      state.capabilities = [...memberCapabilities];
      state.commandOutcomes.push(403);
      await page.getByRole("button", { name: "Save" }).click();
      const confirmation = page.getByRole("dialog", { name: "Change BetaTrainee's membership?" });
      await confirmation.getByRole("textbox", { name: "Reason" }).fill("Fictional promotion");
      await confirmation.getByRole("button", { name: "Confirm" }).click();
      await expect(dialog.getByRole("alert")).toHaveText(
        "Your access no longer allows changing member access.",
      );
      await expect(page.locator("[data-access-member]")).toHaveCount(0);
      await expect(page.locator("thead th").filter({ hasText: /^Access$/ })).toHaveCount(0);
      expect(state.requests.filter((url) => url.pathname === "/api/v1/me").length).toBeGreaterThan(
        meReads,
      );
      expect(state.commands).toHaveLength(1);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page).not.toHaveURL(/access=/);
      await expect(search(page)).toBeFocused();
    },
  );

  test(
    "marks a member changed elsewhere as stale and answers conflicts with a re-read",
    browserCase(["@functional"]),
    async ({ page }) => {
      const state = await mockDirectoryRoutes(page, { capabilities: manager });
      await open(page);
      await loaded(page);
      const dialog = await openAccess(page, "BetaTrainee");
      const choice = membershipChoice(page, "BetaTrainee");
      const save = dialog.getByRole("button", { name: "Save" });
      await choice.getByRole("button", { name: "Driver" }).click();
      // Another administrator changed the member; a background re-read finds the new version.
      state.bump(betaId);
      await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
      await expect(dialog.getByRole("alert")).toHaveText(
        "This member changed. Refresh to continue.",
      );
      await expect(save).toBeDisabled();
      await expect(choice.getByRole("button", { name: "Trainee" })).toBeDisabled();
      await dialog.getByRole("button", { name: "Refresh" }).click();
      await expect(dialog.getByText("This member changed. Refresh to continue.")).toHaveCount(0);
      await expect(choice.getByRole("button", { name: "Trainee" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(state.commands).toEqual([]);

      // A change between the read and the command: 412 from the old If-Match, then a re-read.
      const conflict =
        "This record changed or the request is no longer valid. Refresh and review current information.";
      await choice.getByRole("button", { name: "Driver" }).click();
      state.bump(betaId);
      await confirm(page, "Save", "Change BetaTrainee's membership?", "Fictional promotion");
      await expect(dialog.getByText(conflict)).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(1);
      await expect(dialog.getByRole("heading", { level: 2, name: "BetaTrainee" })).toBeFocused();
      // 428 is answered the same way; the next save sends the version read last.
      state.commandOutcomes.push(428);
      await choice.getByRole("button", { name: "Driver" }).click();
      await confirm(page, "Save", "Change BetaTrainee's membership?", "Fictional promotion");
      await expect(page.getByRole("dialog")).toHaveCount(1);
      await expect(dialog.getByText(conflict)).toBeVisible();
      await choice.getByRole("button", { name: "Driver" }).click();
      await confirm(page, "Save", "Change BetaTrainee's membership?", "Fictional promotion");
      await expect(dialog.getByText("The action was committed.")).toBeVisible();
      expect(state.commands.map((command) => command.ifMatch)).toEqual(['"m-2"', '"m-3"', '"m-3"']);
      expect(new Set(state.commands.map((command) => command.key)).size).toBe(3);
    },
  );

  test(
    "holds an uncertain command and retries the same request until it commits",
    browserCase(["@functional"]),
    async ({ page }) => {
      const state = await mockDirectoryRoutes(page, { capabilities: manager });
      await open(page);
      await loaded(page);
      const dialog = await openAccess(page, "AlphaHauler");
      await dialog.getByRole("checkbox", { name: /^Deputy Director/ }).check();
      state.commandOutcomes.push("abort", 503);
      const confirmation = await confirm(
        page,
        "Save",
        "Change AlphaHauler's roles?",
        "Fictional deputy",
      );
      await expect(confirmation.getByRole("alert")).toHaveText(
        "The action was not confirmed. Close this dialog to review the status and recoverable values.",
      );
      await page.keyboard.press("Escape");
      await expect(confirmation).toHaveCount(0);
      const retry = dialog.getByRole("button", { name: "Retry the same request" });
      await expect(retry).toBeFocused();
      await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
      await expect(dialog.getByRole("checkbox", { name: /^Deputy Director/ })).toBeDisabled();
      await retry.click();
      await expect(
        dialog.getByText("The service is unavailable. The original request is retained"),
      ).toBeVisible();
      await expect(retry).toBeFocused();
      await retry.click();
      await expect(dialog.getByText("The action was committed.")).toBeVisible();
      await expect(dialog.getByRole("heading", { level: 2, name: "AlphaHauler" })).toBeFocused();
      expect(state.commands).toHaveLength(3);
      const [first, ...rest] = state.commands;
      for (const command of rest)
        expect(command).toMatchObject({
          method: first?.method,
          path: first?.path,
          body: first?.body,
          key: first?.key,
          ifMatch: first?.ifMatch,
        });
      expect(commandBody(state)).toEqual({
        roles: ["driver", "dispatcher", "deputy_director"],
        reason: "Fictional deputy",
      });
    },
  );

  test(
    "waits out Retry-After before the next command",
    browserCase(["@functional"]),
    async ({ page }) => {
      const state = await mockDirectoryRoutes(page, { capabilities: manager });
      await open(page);
      await loaded(page);
      await openAccess(page, "BetaTrainee");
      await membershipChoice(page, "BetaTrainee").getByRole("button", { name: "Driver" }).click();
      state.commandOutcomes.push({ status: 429, retryAfter: 30 });
      const confirmation = await confirm(
        page,
        "Save",
        "Change BetaTrainee's membership?",
        "Fictional promotion",
      );
      // The confirmation stays open while the countdown blocks the next attempt; the modal
      // confirmation hides the panel from the accessibility tree.
      await expect(page.getByText(/^Try again in \d+ seconds\.$/)).toBeVisible();
      await expect(confirmation.getByRole("button", { name: "Confirm" })).toBeDisabled();
      await expect(confirmation.getByRole("button", { name: "Cancel" })).toBeDisabled();
      await expect(
        page
          .getByRole("dialog", { name: "BetaTrainee", includeHidden: true })
          .getByRole("button", { name: "Save", includeHidden: true }),
      ).toBeDisabled();
      expect(state.commands).toHaveLength(1);
    },
  );

  test(
    "removes a member from the company and returns a former member",
    browserCase(["@functional"]),
    async ({ page }) => {
      const state = await mockDirectoryRoutes(page, { capabilities: manager });
      await open(page);
      await loaded(page);
      const dialog = await openAccess(page, "EchoRunner");
      await expect(dialog.getByText("Trips and statistics are kept.")).toBeVisible();
      const confirmation = await confirm(
        page,
        "Remove from the company…",
        "Remove EchoRunner from the company?",
        "Fictional departure",
      );
      await expect(confirmation).toHaveCount(0);
      await expect(dialog.getByRole("heading", { name: "Return to the company" })).toBeVisible();
      await expect(page.locator(".drivers-counts")).toContainText("17 in the company");
      await expect(hiddenTab(page, /^Left: 5$/)).toHaveCount(1);
      await expect(listRow(page, "EchoRunner")).toHaveCount(0);
      expect(state.commands.at(-1)).toMatchObject({
        method: "POST",
        path: `/admin/members/${echoId}/deactivation`,
        ifMatch: '"m-1"',
      });
      expect(commandBody(state)).toEqual({ reason: "Fictional departure" });
      await page.getByRole("button", { name: "Close" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(search(page)).toBeFocused();

      // Return SierraPast from the Left tab as a Trainee with an ETS2 level.
      await tab(page, /^Left: 5$/).click();
      await loaded(page);
      const before = adminReads(state).length;
      const sierra = await openAccess(page, "SierraPast");
      await expect(sierra).toHaveAccessibleDescription("Access and roles · left the company");
      const returnButton = sierra.getByRole("button", { name: "Return…" });
      await expect(returnButton).toBeDisabled();
      await expect(sierra.getByText("Choose a qualification for at least one game.")).toBeVisible();
      await sierra
        .getByRole("combobox", { name: "Euro Truck Simulator 2" })
        .selectOption({ label: "Trainee" });
      expect(adminReads(state).slice(before)).toEqual([
        `/admin/members/${sierraId}`,
        "/admin/reinstatement-options",
      ]);
      const back = await confirm(
        page,
        "Return…",
        "Return SierraPast to the company?",
        "Fictional return",
      );
      await expect(back).toHaveCount(0);
      expect(state.commands.at(-1)).toMatchObject({
        method: "POST",
        path: `/admin/members/${sierraId}/reinstatement`,
      });
      expect(commandBody(state)).toEqual({
        roles: ["trainee"],
        assignments: [
          {
            game: "ets2",
            levelId: levelId("ets2", "trainee"),
            purpose: "reinstatement",
            reason: "Fictional return",
          },
        ],
        reason: "Fictional return",
      });
      await expect(hiddenTab(page, /^Left: 4$/)).toHaveCount(1);
      await expect(listRow(page, "SierraPast")).toHaveCount(0);
    },
  );

  test(
    "shows the serving Director read-only and closes a confirmation before the panel",
    browserCase(["@functional"]),
    async ({ page }) => {
      const state = await mockDirectoryRoutes(page, {
        capabilities: [...manager, "leadership.transfer"],
      });
      await open(page);
      await loaded(page);
      const oscar = await openAccess(page, "OscarTrail");
      await expect(oscar.getByText("Protected account")).toBeVisible();
      await expect(oscar.getByRole("link", { name: "Open leadership transfer" })).toHaveAttribute(
        "href",
        "/account/admin/settings",
      );
      const remove = oscar.getByRole("button", { name: "Remove from the company…" });
      await expect(remove).toBeDisabled();
      await expect(remove).toHaveAccessibleDescription(/^The serving Director's membership/);
      for (const button of await membershipChoice(page, "OscarTrail").getByRole("button").all())
        await expect(button).toBeDisabled();
      await expect(oscar.getByRole("button", { name: "Save" })).toHaveCount(0);
      await expect(oscar.getByRole("link", { name: "All member settings" })).toHaveAttribute(
        "href",
        /^\/account\/admin\/members\?status=active&search=/,
      );
      await page.keyboard.press("Escape");
      await expect(accessButton(page, "OscarTrail")).toBeFocused();

      // Escape inside a confirmation closes only the confirmation.
      const echo = await openAccess(page, "EchoRunner");
      await echo.getByRole("button", { name: "Remove from the company…" }).click();
      const confirmation = page.getByRole("dialog", {
        name: "Remove EchoRunner from the company?",
      });
      await expect(confirmation).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(confirmation).toHaveCount(0);
      await expect(echo).toBeVisible();
      await expect(echo.getByRole("button", { name: "Remove from the company…" })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(accessButton(page, "EchoRunner")).toBeFocused();
      expect(state.commands).toEqual([]);
    },
  );

  test(
    "opens a deep link on the Left tab and speaks Russian",
    browserCase(["@functional"]),
    async ({ page }) => {
      const state = await mockDirectoryRoutes(page, { capabilities: manager });
      await open(page, `?access=${formerId}&tab=former`);
      await expect(hiddenTab(page, /^Left: 4$/)).toHaveAttribute("aria-selected", "true");
      const gamma = panel(page, "GammaRetired");
      await expect(gamma.getByRole("heading", { level: 2, name: "GammaRetired" })).toBeFocused();
      await expect(gamma.getByRole("heading", { name: "Return to the company" })).toBeVisible();
      await expect(openRow(page)).toContainText("GammaRetired");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page).toHaveURL(/[?&]tab=former(&|$)/);
      await expect(accessButton(page, "GammaRetired")).toBeFocused();
      await loaded(page);

      await switchLanguage(page, "ru");
      await tab(page, /^В составе: 18$/).click();
      await loaded(page);
      const beta = await openAccess(page, "BetaTrainee");
      await expect(beta).toHaveAccessibleDescription(
        "Доступ и роли · в компании с 12 сент. 2026 г.",
      );
      await expect(beta.getByRole("group", { name: "Членство" })).toBeVisible();
      await expect(beta.getByRole("button", { name: "Сохранить" })).toBeDisabled();
      await expect(beta.getByRole("button", { name: "Исключить из компании…" })).toBeEnabled();
      await expect(beta.getByRole("button", { name: "Закрыть" })).toBeVisible();
      await expect(beta.getByText("Изменение попадёт в журнал")).toBeVisible();
      const text = await beta.innerText();
      expect(text).not.toMatch(/\baccess\.[a-z]/);
      expect(state.unexpected).toEqual([]);
    },
  );
});

test(
  "lays the access panel out as a drawer or a phone sheet in both languages",
  browserCase(["@layout"]),
  async ({ page }, info) => {
    await mockDirectoryRoutes(page, { capabilities: manager });
    const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
    const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
    for (const locale of ["en", "ru"] as const) {
      await open(page);
      if (locale === "ru") await switchLanguage(page, "ru");
      await loaded(page);
      const dialog = await openAccess(page, "AlphaHauler");
      await page.evaluate(() => document.fonts.ready);
      const area = await box(dialog);
      if (viewport.width <= 800) {
        // A bottom sheet across the full width that leaves the top of the list visible.
        expect(Math.round(area.x)).toBe(0);
        expect(Math.round(area.width)).toBe(viewport.width);
        expect(Math.round(area.y + area.height)).toBe(viewport.height);
        expect(area.y).toBeGreaterThan(0);
      } else {
        // A right drawer of 400 px over the full height.
        expect(Math.round(area.x + area.width)).toBe(viewport.width);
        expect(Math.round(area.width)).toBe(400);
        expect(Math.round(area.height)).toBe(viewport.height);
      }
      expect(
        await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth),
        "the panel does not scroll sideways",
      ).toBe(true);
      expect(await noOverflow(page)).toBe(true);
      if (coarse) {
        const targets = [
          dialog.getByRole("button", { name: /^(Close|Закрыть)$/ }),
          membershipChoice(page, "AlphaHauler").getByRole("button").first(),
          dialog.locator(".drivers-access-check").first(),
          dialog.getByRole("button", { name: /^(Save|Сохранить)$/ }),
          dialog.getByRole("button", {
            name: /^(Remove from the company…|Исключить из компании…)$/,
          }),
          dialog.getByRole("link", { name: /^(All member settings|Все настройки участника)$/ }),
        ];
        for (const target of targets)
          expect(
            (await box(target)).height,
            await target.evaluate((node) => node.outerHTML.slice(0, 60)),
          ).toBeGreaterThanOrEqual(40);
      }
      await page.screenshot({ path: info.outputPath(`drivers-access-${locale}.png`) });
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      if (locale === "ru") await switchLanguage(page, "en");
    }
  },
);
