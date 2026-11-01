import type { Page, TestInfo } from "@playwright/test";
import { accountFixture } from "../../apps/web/src/features/account/fixtures.ts";
import { catalogLanguage, entityId, envelope, list } from "./support/catalogs.ts";
import { expect, test } from "./support/fixtures.ts";
import { example, mockTrips } from "./support/trip-ui.ts";

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
const listKeys = new Set(["scope", "game", "decision", "limit", "cursor"]);

async function mockList(page: Page, { paged = false } = {}) {
  await mockTrips(page);
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
    const q = new URL(route.request().url()).searchParams;
    if (q.get("scope") === "company") return route.fulfill({ json: list([summary(colleague)]) });
    if (paged && q.get("cursor") === "page-2")
      return route.fulfill({ json: list([summary(first)]) });
    return route.fulfill({
      json: list([first, second, third].map(summary), paged ? "page-2" : null),
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
  return { lists, details, others };
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
    decision = filters.getByRole("combobox", { name: "Company decision", exact: true });
  await expect(game).toHaveValue("");
  await expect(game.locator("option").first()).toHaveText("ETS2 and ATS");
  await expect(decision.locator("option").first()).toHaveText("Any decision");
  const [gameBox, decisionBox] = [await game.boundingBox(), await decision.boundingBox()];
  if (!gameBox || !decisionBox) throw new Error("FILTERS_NOT_RENDERED");
  if (!phone)
    expect(
      Math.abs(gameBox.y + gameBox.height / 2 - (decisionBox.y + decisionBox.height / 2)),
    ).toBeLessThanOrEqual(4);
  for (const box of [gameBox, decisionBox])
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

test("list requests keep server scope rules and review stays permission gated", async ({
  page,
}) => {
  const { lists } = await mockList(page);
  await page.goto("/account/trips?scope=company&decision=rejected&source=manual&trip=nope");
  await catalogLanguage(page);
  await expect(table(page)).toBeVisible();
  await expect.poll(() => lists.length).toBeGreaterThan(0);
  for (const q of lists) {
    expect(q.get("scope")).toBe("company");
    expect(q.has("decision")).toBe(false);
    expect(q.has("source")).toBe(false);
    expect(q.has("trip")).toBe(false);
  }
  expectListParams(lists);
  await page.route("**/api/v1/me", (route) => route.fulfill({ json: accountFixture("en") }));
  lists.length = 0;
  await page.goto("/account/review");
  await expect(
    page
      .getByText(/^(Your current permissions do not allow this action\.|.*permission.*)$/i)
      .first(),
  ).toBeVisible();
  await page.waitForTimeout(250);
  expect(lists).toEqual([]);
});
