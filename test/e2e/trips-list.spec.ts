import { writeFile } from "node:fs/promises";
import type { Page, TestInfo } from "@playwright/test";
import { accountFixture } from "../../apps/web/src/features/account/fixtures.ts";
import { catalogLanguage, entityId, envelope, list } from "./support/catalogs.ts";
import { expect, test } from "./support/fixtures.ts";
import { countInsertedAlerts, example, mockTrips } from "./support/trip-ui.ts";

// Fictional trips only; every identity, label and reason below is synthetic.
const ids = [1, 2, 3, 4].map((n) => `49000000-0000-4000-8000-00000000000${n}`) as [
  string,
  string,
  string,
  string,
];
const [first, second, third, colleague] = ids;
const label = (text: string, englishFallback = false) => ({
  entityId,
  label: text,
  requestedLocale: englishFallback ? "ru" : "en",
  renderedLocale: "en",
  englishFallback,
  retired: false,
});
const owner = accountFixture("en").data.member;
function summary(tripId: string) {
  const trip = example("getTrip:success").data;
  trip.id = tripId;
  trip.owner = owner;
  if (tripId === first)
    Object.assign(trip, {
      decision: "accepted",
      outcome: "delivered",
      origin: label("Fictional Harbor"),
      destination: label("Fictional Ridge"),
      cargo: label("Fictional machinery"),
      actualDistanceM: "755400",
      reportingAt: "2026-10-31T03:00:00.000Z",
      reportingBasis: "actual_completion",
      recording: "complete",
      sourceKinds: ["ets2telemetry"],
    });
  if (tripId === second)
    Object.assign(trip, {
      decision: "pending_review",
      origin: label("Fictional Quarry"),
      destination: label("Fictional Harbor"),
      cargo: label("Fictional gravel"),
      actualDistanceM: "0",
      reportingBasis: "unknown",
      recording: "unknown",
      sourceKinds: ["manual"],
    });
  if (tripId === third)
    Object.assign(trip, {
      game: "ats",
      decision: "rejected",
      origin: label("Fictional Long Valley Junction with an extended catalog label", true),
      destination: label("Fictional Desert Crossing", true),
      cargo: label("Fictional lumber", true),
      actualDistanceM: "186000",
      reportingAt: "2026-10-26T18:30:00.000Z",
      reportingBasis: "manual_confirmation",
      recording: "partial",
      sourceKinds: ["ets2telemetry", "manual"],
    });
  if (tripId === colleague)
    Object.assign(trip, {
      decision: "accepted",
      owner: { ...owner, id: colleague, nickname: "Fictional Colleague" },
      origin: label("Fictional Port"),
      destination: label("Fictional Mill"),
      cargo: label("Fictional paper"),
      actualDistanceM: "277000",
      reportingAt: "2026-10-21T09:15:00.000Z",
      reportingBasis: "actual_completion",
      sourceKinds: ["ets2telemetry"],
    });
  return trip;
}
const routeNames: Record<string, string> = {
  [first]: "Fictional Harbor → Fictional Ridge",
  [second]: "Fictional Quarry → Fictional Harbor",
  [colleague]: "Fictional Port → Fictional Mill",
};
function routeName(tripId: string) {
  const name = routeNames[tripId];
  if (!name) throw new Error("UNKNOWN_FIXTURE_TRIP");
  return name;
}
const reason = "Fictional screenshot does not support the submitted distance";
const listKeys = new Set(["scope", "game", "decision", "source", "limit", "cursor"]);

async function mockList(page: Page, { paged = false } = {}) {
  await mockTrips(page);
  let expired = false;
  const lists: URLSearchParams[] = [],
    details: string[] = [],
    others: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/v1/trips") lists.push(url.searchParams);
    else if (url.pathname.startsWith("/api/v1/trips/")) {
      const rest = url.pathname.slice("/api/v1/trips/".length);
      (rest.includes("/") ? others : details).push(rest);
    } else if (url.pathname.startsWith("/api/v1/evidence")) others.push(url.pathname);
  });
  await page.route("**/api/v1/trips?*", (route) => {
    const q = new URL(route.request().url()).searchParams,
      source = q.get("source"),
      only = (tripIds: string[]) =>
        tripIds
          .map(summary)
          .filter((trip) => !source || (trip.sourceKinds as string[]).includes(source));
    // An expired or rotated cursor: the server rejects every cursor with 409 VERSION_CONFLICT.
    if (expired && q.has("cursor"))
      return route.fulfill({ status: 409, json: { error: { code: "VERSION_CONFLICT" } } });
    if (q.get("scope") === "company") return route.fulfill({ json: list(only([colleague])) });
    // Page two holds the mixed-source trip when filtered, so every source has a second page.
    if (paged && q.get("cursor") === "page-2")
      return route.fulfill({ json: list(only([source ? third : first])) });
    return route.fulfill({
      json: list(only([first, second, third]), paged ? "page-2" : null),
    });
  });
  await page.route("**/api/v1/trips/*", (route) => {
    const tripId = new URL(route.request().url()).pathname.split("/").at(-1);
    if (tripId === third)
      return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" } } });
    if (tripId === colleague) return route.fulfill({ json: envelope(summary(colleague)) });
    const view = example("getTrip:resubmitted-with-history");
    view.data.summary = summary(tripId ?? first);
    if (tripId === first) view.data.decisions = [];
    return route.fulfill({ json: view, headers: { ETag: '"v1"' } });
  });
  return {
    lists,
    details,
    others,
    /** Makes every later cursor answer 409. */
    expire: () => {
      expired = true;
    },
  };
}
function expectListParams(lists: URLSearchParams[]) {
  expect(lists.length).toBeGreaterThan(0);
  for (const q of lists) {
    for (const key of q.keys()) expect(listKeys.has(key), key).toBe(true);
    expect(q.get("limit")).toBe("25");
  }
}
const coarse = (page: Page) => page.evaluate(() => matchMedia("(pointer: coarse)").matches);
const table = (page: Page, name = "Trip list") => page.getByRole("table", { name, exact: true });
const rowLink = (page: Page, tripId: string) => page.locator(`#trip-link-${tripId}`);
const panel = (page: Page, tripId: string) =>
  page.getByRole("region", { name: routeName(tripId), exact: true });
/** Id of the link that receives a click at the centre of the given cell, if any. */
function linkAtCellCentre(page: Page, row: number, cell: number) {
  return page.evaluate(
    ([r, c]) => {
      const td = document.querySelectorAll("tbody tr")[r]?.querySelectorAll("td")[c];
      if (!td) throw new Error("CELL_NOT_RENDERED");
      td.scrollIntoView({ block: "center" });
      const at = td.getBoundingClientRect();
      return (
        document.elementFromPoint(at.x + at.width / 2, at.y + at.height / 2)?.closest("a")?.id ??
        null
      );
    },
    [row, cell] as const,
  );
}
async function noOverflow(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
}
async function capture(page: Page, info: TestInfo, name: string) {
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
}

test("trip list layout: tabs, compact filters, dense table or phone cards in RU and EN", async ({
  page,
}, info) => {
  const { lists } = await mockList(page);
  await page.goto("/account/trips");
  await catalogLanguage(page);
  const phone = info.project.name === "mobile-chromium",
    touch = await coarse(page);
  await expect(page.getByRole("heading", { level: 1, name: "Trips", exact: true })).toBeVisible();
  const header = page
    .getByRole("main")
    .locator("header")
    .filter({ has: page.getByRole("heading", { level: 1 }) });
  await expect(header.getByRole("link")).toHaveText(["Saved drafts", "New report"]);
  const tabs = page.getByRole("tablist", { name: "Trip scope", exact: true });
  await expect(tabs.getByRole("tab")).toHaveText(["My trips", "Accepted company trips"]);
  await expect(tabs.getByRole("tab", { name: "My trips" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const filters = page.getByRole("group", { name: "Filters", exact: true });
  const game = filters.getByRole("combobox", { name: "Game", exact: true }),
    decision = filters.getByRole("combobox", { name: "Company decision", exact: true }),
    source = filters.getByRole("combobox", { name: "Source", exact: true });
  await expect(game).toHaveValue("");
  await expect(game.locator("option").first()).toHaveText("ETS2 and ATS");
  await expect(decision.locator("option").first()).toHaveText("Any decision");
  await expect(source).toHaveValue("");
  await expect(source.locator("option")).toHaveText(["Any source", "Telemetry", "Manual report"]);
  const [gameBox, decisionBox, sourceBox] = [
    await game.boundingBox(),
    await decision.boundingBox(),
    await source.boundingBox(),
  ];
  if (!gameBox || !decisionBox || !sourceBox) throw new Error("FILTERS_NOT_RENDERED");
  if (!phone)
    for (const box of [decisionBox, sourceBox])
      expect(
        Math.abs(gameBox.y + gameBox.height / 2 - (box.y + box.height / 2)),
      ).toBeLessThanOrEqual(4);
  for (const box of [gameBox, decisionBox, sourceBox])
    if (touch) expect(box.height).toBeGreaterThanOrEqual(40);
    else expect(Math.abs(box.height - 32)).toBeLessThanOrEqual(0.5);
  await expect(page.getByText("Times in UTC", { exact: true })).toBeVisible();
  const trips = table(page);
  await expect(trips).toBeVisible();
  await expect(trips.getByRole("row")).toHaveCount(4);
  await expect(page.getByText("0 km", { exact: true })).toBeVisible();
  const link = rowLink(page, first);
  await expect(link).toHaveAccessibleName(routeName(first));
  const linkBox = await link.boundingBox();
  expect(linkBox?.height ?? 0).toBeGreaterThanOrEqual(touch ? 40 : 30);
  // The row link is the only control. Hit-testing shows its overlay covers the route cell in the
  // table and the whole card on phones, but never other cells, other rows or the page chrome.
  expect(await linkAtCellCentre(page, 0, 0)).toBe(`trip-link-${first}`);
  expect(await linkAtCellCentre(page, 2, 0)).toBe(`trip-link-${third}`);
  expect(await linkAtCellCentre(page, 0, 1)).toBe(phone ? `trip-link-${first}` : null);
  for (const target of [
    page.getByRole("combobox", { name: "Game", exact: true }),
    page.getByRole("tab", { name: "Accepted company trips", exact: true }),
    header.getByRole("link", { name: "Saved drafts", exact: true }),
  ])
    await target.click({ trial: true, timeout: 2000 });
  const nextPage = page.getByRole("button", { name: "Next page", exact: true });
  expect((await nextPage.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(touch ? 40 : 30);
  for (const locale of ["en", "ru"] as const) {
    await catalogLanguage(page, locale);
    const ru = locale === "ru";
    const names = ru
      ? ["Маршрут", "Груз", "Пробег", "Источники", "Решение компании", "Время учёта"]
      : ["Route", "Cargo", "Driven distance", "Sources", "Company decision", "Reporting time"];
    const current = table(page, ru ? "Список рейсов" : "Trip list");
    await expect(current).toBeVisible();
    await expect(
      header.getByRole("link").filter({ hasText: /\S/ }),
      "header keeps only drafts and new report",
    ).toHaveText(ru ? ["Сохранённые черновики", "Новый отчёт"] : ["Saved drafts", "New report"]);
    if (phone) {
      const headBox = await current.locator("thead").boundingBox();
      expect(headBox?.width ?? 0).toBeLessThanOrEqual(1);
      const row = current.locator("tbody tr").first();
      await expect(row).toHaveRole("row");
      await expect(row.locator("td").nth(1)).toHaveRole("cell");
      await expect(row.locator(".trips-cell-label").first()).toHaveAttribute("aria-hidden", "true");
      for (const text of names.slice(1))
        await expect(row.getByText(text, { exact: true })).toBeVisible();
      const [routeBox, cargoBox, rowBox, listBox] = [
        await row.locator("td").first().boundingBox(),
        await row.locator("td").nth(1).boundingBox(),
        await row.boundingBox(),
        await current.boundingBox(),
      ];
      if (!routeBox || !cargoBox || !rowBox || !listBox) throw new Error("CARD_NOT_RENDERED");
      expect(routeBox.y + routeBox.height).toBeLessThanOrEqual(cargoBox.y + 1);
      expect(Math.abs(rowBox.width - listBox.width)).toBeLessThanOrEqual(2);
    } else await expect(current.getByRole("columnheader")).toHaveText(names);
    const localizedSource = page.getByRole("combobox", {
      name: ru ? "Источник" : "Source",
      exact: true,
    });
    await expect(localizedSource.locator("option")).toHaveText(
      ru
        ? ["Любой источник", "Телеметрия", "Ручной отчёт"]
        : ["Any source", "Telemetry", "Manual report"],
    );
    if (ru) {
      const fallbackRow = current.locator("tbody tr").nth(2);
      await expect(fallbackRow.getByText("Показано на английском", { exact: false })).toHaveCount(
        3,
      );
      await expect(current.locator("tbody tr").first()).not.toContainText("Показано на английском");
    }
    await expect(page.locator("body")).not.toContainText(/Достаточно суров|Yukon\?/);
    await noOverflow(page);
    await capture(page, info, `trips-list-${locale}`);
  }
  await catalogLanguage(page);
  await header.getByRole("link", { name: "Saved drafts", exact: true }).click();
  await expect(page).toHaveURL(/\/account\/reports$/);
  expectListParams(lists);
});

test("wide screens open a validated ?trip= side panel without refetching the list", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop-chromium", "The side panel needs at least 1200px.");
  const { lists, details, others } = await mockList(page);
  await page.goto("/account/trips?game=ets2");
  await catalogLanguage(page);
  await expect(table(page)).toBeVisible();
  const listCount = lists.length;
  await rowLink(page, second).click();
  await expect(page).toHaveURL(new RegExp(`[?&]trip=${second}`));
  await expect(page).toHaveURL(/game=ets2/);
  const region = panel(page, second);
  await expect(region).toBeVisible();
  await expect(region.getByRole("heading", { level: 2 })).toBeFocused();
  await expect(rowLink(page, second)).toHaveAttribute("aria-current", "true");
  const [tableBox, panelBox] = [await table(page).boundingBox(), await region.boundingBox()];
  expect(panelBox?.x ?? 0).toBeGreaterThanOrEqual((tableBox?.x ?? 0) + (tableBox?.width ?? 0));
  for (const term of ["Actual driven distance", "Cargo", "Source outcome", "Reporting instant"])
    await expect(region.getByText(term, { exact: true })).toBeVisible();
  await expect(region.getByRole("listitem")).toHaveCount(1);
  await expect(region.getByRole("listitem")).toContainText("Rejected");
  await expect(region.getByText(reason, { exact: true })).toBeVisible();
  await expect(region.getByRole("link", { name: "Open full page", exact: true })).toHaveAttribute(
    "href",
    `/account/trips/${second}`,
  );
  expect(details).toEqual([second]);
  expect(lists.length).toBe(listCount);
  const closeBox = await region.getByRole("button", { name: "Close details" }).boundingBox();
  expect(closeBox?.width ?? 0).toBeGreaterThanOrEqual(24);
  expect(Math.abs((closeBox?.width ?? 0) - (closeBox?.height ?? 0))).toBeLessThanOrEqual(7);
  // Beside the panel the table drops Sources (shown in the panel) and keeps badges on one line.
  await expect(table(page).getByRole("columnheader")).toHaveText([
    "Route",
    "Cargo",
    "Driven distance",
    "Company decision",
    "Reporting time",
  ]);
  await expect(table(page).locator("tbody tr").first().getByRole("cell")).toHaveCount(5);
  const badge = table(page).locator("tbody tr").nth(1).getByText("Pending review");
  expect((await badge.boundingBox())?.height ?? 99).toBeLessThanOrEqual(22);
  await capture(page, info, "trips-panel-en");
  await catalogLanguage(page, "ru");
  await expect(
    page.getByRole("region", { name: "Fictional Quarry → Fictional Harbor", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Закрыть детали", exact: true })).toBeVisible();
  await capture(page, info, "trips-panel-ru");
  await catalogLanguage(page);

  await region.getByRole("button", { name: "Close details", exact: true }).click();
  await expect(region).toHaveCount(0);
  await expect(page).not.toHaveURL(/trip=/);
  await expect(rowLink(page, second)).toBeFocused();
  await rowLink(page, second).click();
  await expect(panel(page, second).getByRole("heading", { level: 2 })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(panel(page, second)).toHaveCount(0);
  await expect(rowLink(page, second)).toBeFocused();

  await rowLink(page, first).click();
  await expect(panel(page, first)).toBeVisible();
  await rowLink(page, second).click();
  await expect(panel(page, second)).toBeVisible();
  await page.goBack();
  await expect(panel(page, first)).toBeVisible();
  await expect(panel(page, second)).toHaveCount(0);
  await rowLink(page, second).click();
  await panel(page, second).getByRole("button", { name: "Close details" }).focus();
  await page.goBack();
  await expect(panel(page, first)).toBeVisible();
  await expect(rowLink(page, second)).toBeFocused();

  await rowLink(page, third).click();
  const missing = page.getByRole("region", { name: /Fictional Long Valley/ });
  await expect(missing.getByText("This record is unavailable or inaccessible.")).toBeVisible();
  await expect(missing.getByRole("button", { name: "Refresh", exact: true })).toBeVisible();
  await expect(table(page)).toBeVisible();
  await expect(rowLink(page, first)).toBeVisible();

  details.length = 0;
  await page.goto("/account/trips?trip=nope");
  await expect(table(page)).toBeVisible();
  await expect(page.getByRole("region")).toHaveCount(0);
  expect(details).toEqual([]);

  await page.goto(`/account/trips?trip=${first}`);
  const deep = panel(page, first);
  await expect(deep).toBeVisible();
  await expect(deep.getByText("No company decisions yet.", { exact: true })).toBeVisible();
  await expect(deep.getByText("Some facts are unavailable. Missing is not zero.")).toBeVisible();
  await expect(deep.getByRole("heading", { level: 2 })).not.toBeFocused();

  others.length = 0;
  await page.getByRole("tab", { name: "Accepted company trips", exact: true }).click();
  await expect(page).toHaveURL(/scope=company/);
  await expect(page).not.toHaveURL(/trip=/);
  await expect(page.getByRole("region")).toHaveCount(0);
  await rowLink(page, colleague).click();
  const shared = panel(page, colleague);
  await expect(shared.getByText("Decision history is not included in this view.")).toBeVisible();
  await expect(shared).not.toContainText(reason);
  await expect(table(page)).toContainText("Fictional Colleague");
  expect(others).toEqual([]);

  await shared.getByRole("button", { name: "Close details" }).focus();
  await page.setViewportSize({ width: 1100, height: 800 });
  await expect(page.getByRole("region")).toHaveCount(0);
  await expect(rowLink(page, colleague)).toBeFocused();
  await expect(rowLink(page, colleague)).toHaveAttribute("href", `/account/trips/${colleague}`);
  expectListParams(lists);
});

test("narrow screens link rows to the full detail page and ignore ?trip=", async ({
  page,
}, info) => {
  test.skip(info.project.name === "desktop-chromium", "Covered by the wide-screen panel test.");
  const { lists, details } = await mockList(page);
  await page.goto(`/account/trips?trip=${first}`);
  await catalogLanguage(page);
  await expect(table(page)).toBeVisible();
  await expect(page.getByRole("region")).toHaveCount(0);
  await expect(rowLink(page, first)).toHaveAttribute("href", `/account/trips/${first}`);
  await page.waitForTimeout(250);
  expect(details).toEqual([]);
  await rowLink(page, second).click();
  await expect(page).toHaveURL(new RegExp(`/account/trips/${second}$`));
  await expect(page.getByRole("link", { name: "Back to trips", exact: true })).toBeVisible();
  expectListParams(lists);
});

test("keyboard reaches filters, rows and the panel in order; tabs activate manually", async ({
  page,
}, info) => {
  const { lists } = await mockList(page);
  await page.goto("/account/trips?decision=rejected");
  await catalogLanguage(page);
  await expect(table(page)).toBeVisible();
  await page.getByRole("combobox", { name: "Game", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("combobox", { name: "Company decision", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("combobox", { name: "Source", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("tabpanel")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(rowLink(page, first)).toBeFocused();
  if (info.project.name === "desktop-chromium") {
    await page.keyboard.press("Enter");
    await expect(panel(page, first).getByRole("heading", { level: 2 })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(panel(page, first)).toHaveCount(0);
    await expect(rowLink(page, first)).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(rowLink(page, second)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(panel(page, second).getByRole("heading", { level: 2 })).toBeFocused();
  } else if (info.project.name === "tablet-chromium") {
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/account/trips/${first}$`));
    return;
  }
  await page.goto("/account/trips?decision=rejected");
  const mine = page.getByRole("tab", { name: "My trips", exact: true });
  await mine.focus();
  await page.keyboard.press("ArrowRight");
  const company = page.getByRole("tab", { name: "Accepted company trips", exact: true });
  await expect(company).toBeFocused();
  await expect(page).not.toHaveURL(/scope=company/);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/scope=company/);
  await expect(company).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("combobox", { name: "Company decision", exact: true })).toHaveCount(
    0,
  );
  await expect.poll(() => lists.at(-1)?.get("scope")).toBe("company");
  expect(lists.at(-1)?.has("decision")).toBe(false);
  expectListParams(lists);
});

test("pagination keeps the selection while filter changes clear it", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-chromium", "The side panel needs at least 1200px.");
  const { lists } = await mockList(page, { paged: true });
  await page.goto(`/account/trips?trip=${second}`);
  await catalogLanguage(page);
  await expect(panel(page, second)).toBeVisible();
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect.poll(() => lists.at(-1)?.get("cursor")).toBe("page-2");
  await expect(page).toHaveURL(new RegExp(`trip=${second}`));
  await expect(panel(page, second)).toBeVisible();
  await page.getByRole("button", { name: "Previous page", exact: true }).click();
  await expect.poll(() => lists.at(-1)?.has("cursor")).toBe(false);
  await expect(panel(page, second)).toBeVisible();
  await page.getByRole("combobox", { name: "Game", exact: true }).selectOption("ats");
  await expect(page).not.toHaveURL(/trip=/);
  await expect(page.getByRole("region")).toHaveCount(0);
  await expect
    .poll(() => lists.at(-1)?.toString())
    .toBe(new URLSearchParams({ scope: "mine", game: "ats", limit: "25" }).toString());
  expectListParams(lists);
});

test("a rejected cursor restarts at the first page of the same filters without an error", async ({
  page,
}, info) => {
  const desktop = info.project.name === "desktop-chromium";
  const { lists, expire } = await mockList(page, { paged: true });
  const search = `?game=ets2${desktop ? `&trip=${second}` : ""}`;
  await page.goto(`/account/trips${search}`);
  await catalogLanguage(page);
  await expect(table(page)).toBeVisible();
  if (desktop) await expect(panel(page, second)).toBeVisible();
  const alerts = await countInsertedAlerts(page, ".trips-list-area");
  expire();
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  const first = "scope=mine&game=ets2&limit=25";
  await expect.poll(() => lists.slice(-2).map(String)).toEqual([`${first}&cursor=page-2`, first]);
  await expect(page.getByRole("button", { name: "Previous page", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Next page", exact: true })).toBeEnabled();
  // The filters and the selection stay; only the page restarts.
  expect(new URL(page.url()).search).toBe(search);
  if (desktop) await expect(panel(page, second)).toBeVisible();
  await page.waitForTimeout(250);
  expect(await alerts()).toBe(0);
  // One rejected cursor costs one first-page request, not a loop.
  expect(lists.filter((q) => q.has("cursor"))).toHaveLength(1);
  expect(lists.at(-1)?.toString()).toBe(first);
  expectListParams(lists);
});

test("list requests keep server scope rules and review stays permission gated", async ({
  page,
}) => {
  const { lists } = await mockList(page);
  await page.goto("/account/trips?scope=company&decision=rejected&source=manual&trip=nope");
  await catalogLanguage(page);
  // The only synthetic company trip is telemetry-only, so the filtered page is empty.
  await expect(page.getByText("No records match this view.", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Source", exact: true })).toHaveValue("manual");
  await expect.poll(() => lists.length).toBeGreaterThan(0);
  // Company scope drops the decision filter but keeps the server-side source filter.
  for (const q of lists) {
    expect(q.get("scope")).toBe("company");
    expect(q.has("decision")).toBe(false);
    expect(q.get("source")).toBe("manual");
    expect(q.has("trip")).toBe(false);
  }
  expectListParams(lists);
  await page.route("**/api/v1/me", (route) => route.fulfill({ json: accountFixture("en") }));
  lists.length = 0;
  await page.goto("/account/review");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1, name: "Review workspace" })).toBeVisible();
  await expect(
    main.getByText("Your current permissions do not allow this action.", { exact: true }),
  ).toBeVisible();
  // The forbidden queue renders no toolbar or table and never asks for the review scope.
  await expect(main.getByRole("table")).toHaveCount(0);
  await expect(main.locator("#review-game")).toHaveCount(0);
  await page.waitForTimeout(250);
  expect(lists).toEqual([]);
  expect(lists.some((q) => q.get("scope") === "review")).toBe(false);
});

test("source filter: request query, URL state, cursor reset and focus", async ({ page }, info) => {
  const desktop = info.project.name === "desktop-chromium";
  const { lists } = await mockList(page, { paged: true });
  const last = () => lists.at(-1)?.toString();
  await page.goto(desktop ? `/account/trips?trip=${second}` : "/account/trips");
  await catalogLanguage(page);
  await expect(table(page)).toBeVisible();
  if (desktop) await expect(panel(page, second)).toBeVisible();
  const source = page.getByRole("combobox", { name: "Source", exact: true });
  await source.focus();
  await source.selectOption("manual");
  await expect(page).toHaveURL(/[?&]source=manual(&|$)/);
  await expect(page).not.toHaveURL(/[?&](trip|cursor)=/);
  await expect.poll(last).toBe("scope=mine&source=manual&limit=25");
  // The select stays mounted while the list reloads, so focus is not lost.
  await expect(source).toBeFocused();
  await expect(page.getByRole("region")).toHaveCount(0);
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect.poll(last).toBe("scope=mine&source=manual&limit=25&cursor=page-2");
  const previous = page.getByRole("button", { name: "Previous page", exact: true });
  await expect(previous).toBeEnabled();
  if (desktop) {
    await rowLink(page, third).click();
    await expect(page).toHaveURL(new RegExp(`[?&]trip=${third}`));
  }
  await source.selectOption("ets2telemetry");
  await expect.poll(last).toBe("scope=mine&source=ets2telemetry&limit=25");
  await expect(previous).toBeDisabled();
  await expect(page).toHaveURL(/[?&]source=ets2telemetry(&|$)/);
  await expect(page).not.toHaveURL(/[?&](trip|cursor)=/);
  await expect(page.getByRole("region")).toHaveCount(0);

  await page.getByRole("tab", { name: "Accepted company trips", exact: true }).click();
  await expect.poll(last).toBe("scope=company&source=ets2telemetry&limit=25");
  await expect(source).toHaveValue("ets2telemetry");
  await expect(rowLink(page, colleague)).toBeVisible();
  await source.selectOption("");
  await expect.poll(last).toBe("scope=company&limit=25");
  await expect(page).not.toHaveURL(/source=/);
  await page.goBack();
  await expect(page).toHaveURL(/[?&]source=ets2telemetry(&|$)/);
  await expect(source).toHaveValue("ets2telemetry");

  await page.goto("/account/trips?source=bogus");
  await expect(table(page)).toBeVisible();
  await expect(source).toHaveValue("");
  await expect.poll(last).toBe("scope=mine&limit=25");
  // Two changes in one task: the second must build on the first, not on stale router params.
  await page.evaluate(() => {
    for (const [id, value] of [
      ["trip-game", "ats"],
      ["trip-source", "manual"],
    ] as const) {
      const select = document.getElementById(id);
      if (!(select instanceof HTMLSelectElement)) throw new Error("FILTER_NOT_RENDERED");
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  await expect(page).toHaveURL(/[?&]game=ats(&|$)/);
  await expect(page).toHaveURL(/[?&]source=manual(&|$)/);
  await expect.poll(last).toBe("scope=mine&game=ats&source=manual&limit=25");
  expect(lists.some((q) => q.get("source") === "bogus")).toBe(false);
  expectListParams(lists);
});

const wideFont = ".trips-toolbar, .trips-toolbar * { letter-spacing: 0.06em !important; }";
/** Toolbar geometry: spare width after children and gaps, and row alignment of the children. */
function toolbarBudget(page: Page) {
  return page.evaluate(async () => {
    await document.fonts.ready;
    const bar = document.querySelector(".trip-page .trips-toolbar");
    if (!bar) throw new Error("TOOLBAR_NOT_RENDERED");
    const box = (element: Element) => element.getBoundingClientRect(),
      children = Array.from(bar.children),
      filters = children.filter((child) => child.classList.contains("trips-filter")),
      selects = Array.from(bar.querySelectorAll("select")),
      gap = Number.parseFloat(getComputedStyle(bar).columnGap) || 0,
      width = box(bar).width;
    const used = (list: Element[]) =>
      list.reduce((total, element) => total + box(element).width, 0) +
      gap * Math.max(0, list.length - 1);
    const spread = (list: Element[]) => {
      const centres = list.map((element) => box(element).top + box(element).height / 2);
      return Math.max(...centres) - Math.min(...centres);
    };
    const round = (value: number) => Math.round(value * 10) / 10;
    return {
      width: round(width),
      children: children.length,
      spareAll: round(width - used(children)),
      spareSelects: round(width - used(filters)),
      rowSpreadAll: round(spread(children)),
      rowSpreadSelects: round(spread(filters)),
      selectHeights: selects.map((select) => round(box(select).height)),
      selectsInside: selects.every(
        (select) =>
          box(select).left >= box(bar).left - 0.5 &&
          box(select).right <= box(bar).right + 0.5 &&
          box(select).right <= window.innerWidth,
      ),
    };
  });
}
test("toolbar budget with wide-font spare in RU and EN for own and company trips", async ({
  page,
}, info) => {
  await mockList(page);
  const project = info.project.name,
    touch = project === "mobile-chromium";
  const results: Record<string, unknown>[] = [];
  for (const scope of ["mine", "company"] as const) {
    await page.goto(scope === "company" ? "/account/trips?scope=company" : "/account/trips");
    await catalogLanguage(page);
    await expect(table(page)).toBeVisible();
    for (const locale of ["en", "ru"] as const) {
      await catalogLanguage(page, locale);
      await expect(page.locator("#trip-source option").first()).toHaveText(
        locale === "ru" ? "Любой источник" : "Any source",
      );
      for (const wide of [false, true]) {
        const style = wide ? await page.addStyleTag({ content: wideFont }) : null,
          budget = await toolbarBudget(page),
          label = JSON.stringify({ project, scope, locale, wide, ...budget });
        results.push({ scope, locale, wide, ...budget });
        expect(budget.children, label).toBe(scope === "mine" ? 4 : 3);
        for (const height of budget.selectHeights)
          if (touch) expect(height, label).toBeGreaterThanOrEqual(40);
          else expect(Math.abs(height - 32), label).toBeLessThanOrEqual(0.5);
        if (project === "desktop-chromium") {
          // Selects and the timezone note share one row with at least 4px to spare.
          expect(budget.rowSpreadAll, label).toBeLessThanOrEqual(4);
          expect(budget.spareAll, label).toBeGreaterThanOrEqual(4);
        } else if (project === "tablet-chromium") {
          expect(budget.rowSpreadSelects, label).toBeLessThanOrEqual(4);
          expect(budget.spareSelects, label).toBeGreaterThanOrEqual(4);
        }
        expect(budget.selectsInside, label).toBe(true);
        await noOverflow(page);
        if (touch)
          await capture(page, info, `trips-toolbar-${scope}-${locale}${wide ? "-wide" : ""}`);
        await style?.evaluate((node) => node.parentNode?.removeChild(node));
      }
    }
  }
  await writeFile(info.outputPath("toolbar-budget.json"), JSON.stringify(results, null, 2));
});
