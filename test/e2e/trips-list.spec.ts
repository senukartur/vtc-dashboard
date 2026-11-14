import type { Page, TestInfo } from "@playwright/test";
import { accountFixture } from "../../apps/web/src/features/account/fixtures.ts";
import { catalogLanguage, entityId, envelope, list } from "./support/catalogs.ts";
import { browserCase, expect, test } from "./support/fixtures.ts";
import { countInsertedAlerts, example, mockTrips } from "./support/trip-ui.ts";

// Fictional trips only; every identity, label and reason below is synthetic.
const ids = [1, 2, 3, 4].map((n) => `49000000-0000-4000-8000-00000000000${n}`) as [
  string,
  string,
  string,
  string,
];
const [first, second, third, colleague] = ids;
const colleagueOwnerId = "49000000-0000-4000-8000-00000000000a";
const label = (text: string, englishFallback = false) => ({
  entityId,
  label: text,
  requestedLocale: englishFallback ? "ru" : "en",
  renderedLocale: "en",
  englishFallback,
  hidden: false,
});
const owner = accountFixture("en").data.member;
const longCyrillicOrigin =
  "Вымышленный длинный кириллический город возле северного транспортного узла";
function summary(tripId: string) {
  const trip = example("getTrip:success").data;
  trip.id = tripId;
  trip.owner = owner;
  if (tripId === first)
    Object.assign(trip, {
      decision: "accepted",
      outcome: "delivered",
      origin: label(longCyrillicOrigin),
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
      owner: { ...owner, id: colleagueOwnerId, nickname: "Fictional Colleague" },
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
  [first]: `${longCyrillicOrigin} → Fictional Ridge`,
  [second]: "Fictional Quarry → Fictional Harbor",
  [colleague]: "Fictional Port → Fictional Mill",
};
function routeName(tripId: string) {
  const name = routeNames[tripId];
  if (!name) throw new Error("UNKNOWN_FIXTURE_TRIP");
  return name;
}
const reason = "Fictional screenshot does not support the submitted distance";
const listKeys = new Set([
  "scope",
  "game",
  "decision",
  "source",
  "q",
  "order",
  "locale",
  "from",
  "toExclusive",
  "ownerId",
  "limit",
  "cursor",
]);

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
async function openFilters(page: Page) {
  const toggle = page.getByRole("button", { name: /^(Filters|Фильтры)/ });
  if ((await toggle.isVisible()) && (await toggle.getAttribute("aria-expanded")) === "false")
    await toggle.click();
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
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
}

test(
  "trip list layout: tabs, compact filters, dense table or phone cards in RU and EN",
  browserCase(["@layout"]),
  async ({ page }, info) => {
    const { lists } = await mockList(page);
    await page.goto("/account/trips");
    await catalogLanguage(page);
    const narrow = info.project.name !== "desktop-chromium",
      touch = await coarse(page);
    await expect(page.getByRole("heading", { level: 1, name: "Trips", exact: true })).toBeVisible();
    const header = page
      .getByRole("main")
      .locator("header")
      .filter({ has: page.getByRole("heading", { level: 1 }) });
    await expect(header.getByRole("link")).toHaveText(["New report"]);
    await expect(page.getByRole("tab", { name: "Drafts (0)", exact: true })).toBeVisible();
    if (narrow) {
      await expect(page.getByRole("combobox", { name: "Game", exact: true })).toHaveCount(0);
      await openFilters(page);
    }
    const tabs = page.getByRole("tablist", { name: "Trip scope", exact: true });
    await expect(tabs.getByRole("tab")).toHaveCount(3);
    await expect(
      tabs.getByRole("tab", { name: "Accepted company trips", exact: true }),
    ).toBeVisible();
    await expect(tabs.getByRole("tab", { name: "My trips" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const filters = page.getByRole("group", { name: "Filters", exact: true });
    const game = filters.getByRole("combobox", { name: "Game", exact: true }),
      decision = filters.getByRole("combobox", { name: "Company decision", exact: true }),
      source = filters.getByRole("combobox", { name: "Source", exact: true });
    await expect(game).toHaveValue("");
    await expect(decision.locator("option").first()).toHaveText("Any decision");
    await expect(source).toHaveValue("");
    await expect(source.locator("option")).toHaveText(["Any source", "Telemetry", "Manual report"]);
    const [gameBox, decisionBox, sourceBox] = [
      await game.boundingBox(),
      await decision.boundingBox(),
      await source.boundingBox(),
    ];
    if (!gameBox || !decisionBox || !sourceBox) throw new Error("FILTERS_NOT_RENDERED");
    if (!narrow)
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
    expect(await linkAtCellCentre(page, 0, 1)).toBe(narrow ? `trip-link-${first}` : null);
    for (const target of [
      page.getByRole("combobox", { name: "Game", exact: true }),
      page.getByRole("tab", { name: "Accepted company trips", exact: true }),
      page.getByRole("tab", { name: "Drafts (0)", exact: true }),
    ])
      await target.click({ trial: true, timeout: 2000 });
    const nextPage = page.getByRole("button", { name: "Next page", exact: true });
    expect((await nextPage.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(touch ? 40 : 30);
    for (const locale of ["en", "ru"] as const) {
      await catalogLanguage(page, locale);
      const ru = locale === "ru";
      const names = ru
        ? ["Маршрут", "Груз", "Пробег", "Источники", "Решение компании", "Завершён / подтверждён"]
        : [
            "Route",
            "Cargo",
            "Driven distance",
            "Sources",
            "Company decision",
            "Completed / confirmed",
          ];
      const current = table(page, ru ? "Список рейсов" : "Trip list");
      await expect(current).toBeVisible();
      await expect(rowLink(page, first)).toBeVisible();
      await expect(rowLink(page, first)).toContainText(longCyrillicOrigin);
      await expect(header.getByRole("link")).toHaveText([ru ? "Новый отчёт" : "New report"]);
      if (narrow) {
        const headBox = await current.locator("thead").boundingBox();
        expect(headBox?.width ?? 0).toBeLessThanOrEqual(1);
        const row = current.locator("tbody tr").first();
        await expect(row).toHaveRole("row");
        await expect(row.locator("td").nth(1)).toHaveRole("cell");
        await expect(row.locator(".data-table-label").first()).toHaveAttribute(
          "aria-hidden",
          "true",
        );
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
        // Header column widths never shrink a card cell: the route spans the card, others halve it.
        expect(routeBox.width).toBeGreaterThanOrEqual(rowBox.width * 0.8);
        expect(cargoBox.width).toBeGreaterThanOrEqual(rowBox.width * 0.4);
      } else {
        await expect(current.getByRole("columnheader")).toHaveText(
          [...names.slice(0, -1), ru ? /Завершение/ : /Completion/],
          { useInnerText: true },
        );
      }
      const localizedGame = page.getByRole("combobox", {
        name: ru ? "Игра" : "Game",
        exact: true,
      });
      await expect(localizedGame.locator("option")).toHaveText([ru ? "Все" : "All", "ETS2", "ATS"]);
      const localizedSource = page.getByRole("combobox", {
        name: ru ? "Источник" : "Source",
        exact: true,
      });
      await expect(localizedSource.locator("option")).toHaveText(
        ru
          ? ["Любой источник", "Телеметрия", "Ручной отчёт"]
          : ["Any source", "Telemetry", "Manual report"],
      );
      // The filter names a returned trip by what the driver does next; badges keep "Rejected".
      await expect(
        page
          .getByRole("combobox", {
            name: ru ? "Решение компании" : "Company decision",
            exact: true,
          })
          .locator('option[value="rejected"]'),
      ).toHaveText(ru ? "Нужно исправить" : "Needs fixes");
      if (ru) {
        const fallbackRow = current.locator("tbody tr").nth(2);
        await expect(fallbackRow.getByText("Показано на английском", { exact: false })).toHaveCount(
          3,
        );
        await expect(current.locator("tbody tr").first()).not.toContainText(
          "Показано на английском",
        );
      }
      await expect(page.locator("body")).not.toContainText(/Достаточно суров|Yukon\?/);
      await noOverflow(page);
      await capture(page, info, `trips-list-${locale}`);
    }
    await catalogLanguage(page);
    await page.getByRole("tab", { name: "Drafts (0)", exact: true }).click();
    await expect(page).toHaveURL(/\/account\/trips\?tab=drafts$/);
    await expect(page.getByRole("heading", { name: "Saved drafts", exact: true })).toBeVisible();
    await page.goto("/account/reports");
    await expect(
      page.getByRole("heading", { level: 1, name: "Saved drafts", exact: true }),
    ).toBeVisible();
    expectListParams(lists);
  },
);

test(
  "wide screens open a validated ?trip= side panel without refetching the list",
  browserCase(["@layout", "@viewport-desktop"]),
  async ({ page }, info) => {
    const { lists, details, others } = await mockList(page);
    await page.goto("/account/trips?game=ets2");
    await catalogLanguage(page);
    await expect(rowLink(page, second)).toBeVisible();
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
      /Completion/,
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
    for (const field of ["Job type", "Game mode", "Hard Mode result"])
      await expect(shared.getByText(field, { exact: true })).toHaveCount(0);
    await expect(table(page)).toContainText("Fictional Colleague");
    expect(others).toEqual([]);

    await shared.getByRole("button", { name: "Close details" }).focus();
    await page.setViewportSize({ width: 1100, height: 800 });
    await expect(page.getByRole("region")).toHaveCount(0);
    await expect(rowLink(page, colleague)).toBeFocused();
    await expect(rowLink(page, colleague)).toHaveAttribute("href", `/account/trips/${colleague}`);
    expectListParams(lists);
  },
);

test(
  "narrow screens link rows to the full detail page and ignore ?trip=",
  browserCase(["@layout", "@viewport-narrow"]),
  async ({ page }, info) => {
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
  },
);

test(
  "keyboard reaches filters, rows and the panel in order; tabs activate manually",
  browserCase(["@layout"]),
  async ({ page }, info) => {
    const { lists } = await mockList(page);
    await page.goto("/account/trips?decision=rejected");
    await catalogLanguage(page);
    await expect(table(page)).toBeVisible();
    await openFilters(page);
    await page.getByRole("combobox", { name: "Game", exact: true }).focus();
    await page.keyboard.press("ArrowDown");
    // The new filter replaces the rows with a loading state; a Tab before they return skips them.
    await expect.poll(() => lists.at(-1)?.get("game")).toBe("ets2");
    await expect(rowLink(page, first)).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("combobox", { name: "Company decision", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("combobox", { name: "Source", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("combobox", { name: "Period", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Reset", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("tabpanel")).toBeFocused();
    // The table's sort control comes next: the header button on desktop, the phone select below.
    await page.keyboard.press("Tab");
    await expect(
      info.project.name === "desktop-chromium"
        ? page.getByRole("button", { name: "Completion" })
        : page.getByRole("combobox", { name: "Completion order" }),
    ).toBeFocused();
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
  },
);

test(
  "pagination keeps the selection while filter changes clear it",
  browserCase(["@functional"]),
  async ({ page }, info) => {
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
      .toBe(
        new URLSearchParams({
          scope: "mine",
          game: "ats",
          order: "completion_desc",
          locale: "en",
          limit: "25",
        }).toString(),
      );
    expectListParams(lists);
  },
);

test(
  "a rejected cursor restarts at the first page of the same filters without an error",
  browserCase(["@functional"]),
  async ({ page }, info) => {
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
    const first = "scope=mine&game=ets2&order=completion_desc&locale=en&limit=25";
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
  },
);

test(
  "list requests keep server scope rules and review stays permission gated",
  browserCase(["@functional"]),
  async ({ page }) => {
    const { lists } = await mockList(page);
    await page.goto("/account/trips?scope=company&decision=rejected&source=manual&trip=nope");
    await catalogLanguage(page);
    // The only synthetic company trip is telemetry-only, so the filtered page is empty.
    await expect(page.getByText("No records match this view.", { exact: true })).toBeVisible();
    await openFilters(page);
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
  },
);

test(
  "source filter: request query, URL state, cursor reset and focus",
  browserCase(["@functional", "@smoke-trip-list"]),
  async ({ page }, info) => {
    const desktop = info.project.name === "desktop-chromium";
    const { lists } = await mockList(page, { paged: true });
    const last = () => lists.at(-1)?.toString();
    await page.goto(desktop ? `/account/trips?trip=${second}` : "/account/trips");
    await catalogLanguage(page);
    await expect(table(page)).toBeVisible();
    if (desktop) await expect(panel(page, second)).toBeVisible();
    await openFilters(page);
    const source = page.getByRole("combobox", { name: "Source", exact: true });
    await source.focus();
    await source.selectOption("manual");
    await expect(page).toHaveURL(/[?&]source=manual(&|$)/);
    await expect(page).not.toHaveURL(/[?&](trip|cursor)=/);
    await expect
      .poll(last)
      .toBe("scope=mine&source=manual&order=completion_desc&locale=en&limit=25");
    // The select stays mounted while the list reloads, so focus is not lost.
    await expect(source).toBeFocused();
    await expect(page.getByRole("region")).toHaveCount(0);
    await page.getByRole("button", { name: "Next page", exact: true }).click();
    await expect
      .poll(last)
      .toBe("scope=mine&source=manual&order=completion_desc&locale=en&limit=25&cursor=page-2");
    const previous = page.getByRole("button", { name: "Previous page", exact: true });
    await expect(previous).toBeEnabled();
    if (desktop) {
      await rowLink(page, third).click();
      await expect(page).toHaveURL(new RegExp(`[?&]trip=${third}`));
    }
    await source.selectOption("ets2telemetry");
    await expect
      .poll(last)
      .toBe("scope=mine&source=ets2telemetry&order=completion_desc&locale=en&limit=25");
    await expect(previous).toBeDisabled();
    await expect(page).toHaveURL(/[?&]source=ets2telemetry(&|$)/);
    await expect(page).not.toHaveURL(/[?&](trip|cursor)=/);
    await expect(page.getByRole("region")).toHaveCount(0);

    await page.getByRole("tab", { name: "Accepted company trips", exact: true }).click();
    await expect
      .poll(last)
      .toBe("scope=company&source=ets2telemetry&order=completion_desc&locale=en&limit=25");
    await expect(source).toHaveValue("ets2telemetry");
    await expect(rowLink(page, colleague)).toBeVisible();
    await source.selectOption("");
    await expect.poll(last).toBe("scope=company&order=completion_desc&locale=en&limit=25");
    await expect(page).not.toHaveURL(/source=/);
    await page.goBack();
    await expect(page).toHaveURL(/[?&]source=ets2telemetry(&|$)/);
    await expect(source).toHaveValue("ets2telemetry");

    await page.goto("/account/trips?source=bogus");
    await expect(table(page)).toBeVisible();
    await openFilters(page);
    await expect(source).toHaveValue("");
    await expect.poll(last).toBe("scope=mine&order=completion_desc&locale=en&limit=25");
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
    await expect
      .poll(last)
      .toBe("scope=mine&game=ats&source=manual&order=completion_desc&locale=en&limit=25");
    expect(lists.some((q) => q.get("source") === "bogus")).toBe(false);
    expectListParams(lists);
  },
);

test(
  "search keeps the latest URL intent, supports both number spellings and preserves sort focus",
  browserCase(["@functional"]),
  async ({ page }) => {
    const { lists } = await mockList(page);
    const privateTrip = {
      ...summary(first),
      number: 1046,
      gameMode: "haulmp",
      event: { id: entityId, title: "Fictional Winter Convoy" },
    };
    const status = example("getMyTripStatusSummary:success");
    status.data.lifetimeTotals = { acceptedTrips: 42, actualDistanceM: "6551250" };
    await page.route("**/api/v1/me/trip-status-summary", (route) => {
      expect(new URL(route.request().url()).search).toBe("");
      return route.fulfill({ json: status });
    });
    let releaseOld = () => {};
    const old = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    await page.route("**/api/v1/trips?*", async (route) => {
      const params = new URL(route.request().url()).searchParams;
      const term = params.get("q") ?? "";
      if (term === "older search") {
        await old;
        await route.fulfill({ json: list([summary(second)]) }).catch(() => {});
        return;
      }
      const items = ["", "#1046", "1046"].includes(term) ? [privateTrip] : [];
      return route.fulfill({ json: envelope({ items, nextCursor: null, total: items.length }) });
    });
    await page.goto("/account/trips?game=ets2");
    await catalogLanguage(page);
    const search = page.getByRole("searchbox", { name: "City, cargo, trip number" });
    await expect(page.getByText("Lifetime accepted trips · 42 · 6,551.25 km")).toBeVisible();
    await expect(page.getByText("Found 1", { exact: true })).toBeVisible();
    await expect(rowLink(page, first)).toContainText("#1046");
    await expect(page.getByText("HaulMP", { exact: true })).toBeVisible();
    const event = page.getByRole("link", { name: "Fictional Winter Convoy" });
    await expect(event).toHaveAttribute("href", `/account/events/${entityId}`);
    await event.click({ trial: true });

    await search.fill("older search");
    await expect.poll(() => lists.at(-1)?.get("q")).toBe("older search");
    await expect(search).toBeFocused();
    await search.fill("short transient");
    await search.fill("  #1046  ");
    await expect(page).toHaveURL(/[?&]q=%231046(&|$)/);
    await expect(rowLink(page, first)).toBeVisible();
    await expect(search).toHaveValue("#1046");
    expect(lists.some((params) => params.get("q") === "short transient")).toBe(false);
    releaseOld();
    await expect(rowLink(page, second)).toHaveCount(0);
    await expect(lists.at(-1)?.get("game")).toBe("ets2");

    await search.fill("1046");
    await expect(page).toHaveURL(/[?&]q=1046(&|$)/);
    await expect(rowLink(page, first)).toBeVisible();
    const sort = page.getByRole("button", { name: "Completion", exact: true });
    await expect(sort.locator("..")).toHaveAttribute("aria-sort", "descending");
    expect(lists.at(-1)?.get("order")).toBe("completion_desc");
    await sort.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/[?&]order=completion_asc(&|$)/);
    await expect(sort).toBeFocused();
    await expect(sort.locator("..")).toHaveAttribute("aria-sort", "ascending");
    await expect.poll(() => lists.at(-1)?.get("order")).toBe("completion_asc");

    await page.goBack();
    await expect(sort.locator("..")).toHaveAttribute("aria-sort", "descending");
    await page.goBack();
    await expect(search).toHaveValue("#1046");
    await page.goForward();
    await expect(search).toHaveValue("1046");
    await page.goForward();
    await page.reload();
    await expect(search).toHaveValue("1046");
    await expect(sort.locator("..")).toHaveAttribute("aria-sort", "ascending");
    await expect(rowLink(page, first)).toBeVisible();
    await catalogLanguage(page, "ru");
    await expect.poll(() => lists.at(-1)?.get("locale")).toBe("ru");
    expect(lists.at(-1)?.get("q")).toBe("1046");
    const limit = `${"🚛".repeat(127)}я`;
    await page.getByRole("searchbox").fill(` ${limit} `);
    await expect.poll(() => lists.at(-1)?.get("q")).toBe(limit);
    expectListParams(lists);
  },
);

test(
  "period bounds use saved display time and fall back to All time for an unknown zone",
  browserCase(["@functional"]),
  async ({ page }) => {
    const { lists } = await mockList(page);
    await page.clock.setFixedTime(new Date("2026-10-30T12:00:00Z"));
    let displayTimezone = "Mars/Olympus";
    await page.route("**/api/v1/me", (route) => {
      const self = accountFixture("en");
      self.data.preferences.displayTimezone = displayTimezone;
      return route.fulfill({ json: self });
    });
    await page.goto(
      `/account/trips?scope=company&ownerId=${colleagueOwnerId.toUpperCase()}&period=thisMonth`,
    );
    await catalogLanguage(page);
    await expect(page.getByText("Display timezone unavailable. Showing all time.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open preferences" })).toHaveAttribute(
      "href",
      "/account/preferences",
    );
    const period = page.getByRole("combobox", { name: "Period" });
    await expect(period).toHaveValue("");
    await expect(rowLink(page, colleague)).toBeVisible();
    expect(lists.at(-1)?.has("from")).toBe(false);
    displayTimezone = "Europe/Warsaw";
    await page.reload();
    await expect(period).toHaveValue("thisMonth");
    await expect.poll(() => lists.at(-1)?.get("from")).toBe("2026-09-30T22:00:00.000Z");
    expect(lists.at(-1)?.get("toExclusive")).toBe("2026-10-31T23:00:00.000Z");
    expect(lists.at(-1)?.get("ownerId")).toBe(colleagueOwnerId);
    expect(lists.at(-1)?.has("decision")).toBe(false);
    await expect(rowLink(page, colleague)).toBeVisible();
    await page.getByRole("button", { name: "Clear driver filter" }).click();
    await expect(page).not.toHaveURL(/ownerId=/);
    await expect(page).toHaveURL(/period=thisMonth/);
    await expect.poll(() => lists.at(-1)?.has("ownerId")).toBe(false);

    const requestCount = lists.length;
    await page.goto("/account/trips?scope=company&ownerId=not-a-driver");
    await expect(rowLink(page, colleague)).toBeVisible();
    expect(lists.length).toBeGreaterThan(requestCount);
    expect(lists.at(-1)?.has("ownerId")).toBe(false);
    await expect(page.getByRole("button", { name: "Clear driver filter" })).toHaveCount(0);
    expectListParams(lists);
  },
);

test(
  "phone taps distinguish the event link from the adjacent trip card",
  browserCase(["@layout", "@viewport-mobile"]),
  async ({ page }) => {
    await mockList(page);
    await page.route(`**/api/v1/events/${entityId}`, (route) =>
      route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" } } }),
    );
    await page.route("**/api/v1/trips?*", (route) => {
      const trip = {
        ...summary(first),
        event: { id: entityId, title: "Fictional Winter Convoy" },
      };
      return route.fulfill({ json: list([trip]) });
    });
    await page.goto("/account/trips");
    await catalogLanguage(page);

    const drafts = page.getByRole("tab", { name: "Drafts (0)", exact: true });
    await expect(drafts).toBeVisible();
    expect((await drafts.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(40);
    const event = page.getByRole("link", { name: "Fictional Winter Convoy", exact: true });
    await event.scrollIntoViewIfNeeded();
    const target = await event.boundingBox();
    if (!target) throw new Error("EVENT_LINK_NOT_RENDERED");
    expect(target.height).toBeGreaterThanOrEqual(40);
    await page.touchscreen.tap(target.x + target.width / 2, target.y + 3);
    await expect(page).toHaveURL(`/account/events/${entityId}`);

    await page.goBack();
    const cargo = table(page).getByRole("cell", { name: "Fictional machinery", exact: true });
    await cargo.scrollIntoViewIfNeeded();
    const adjacent = await cargo.boundingBox();
    if (!adjacent) throw new Error("TRIP_CARD_NOT_RENDERED");
    await page.touchscreen.tap(adjacent.x + adjacent.width / 2, adjacent.y + adjacent.height / 2);
    await expect(page).toHaveURL(`/account/trips/${first}`);
  },
);

test(
  "the match count distinguishes a retryable error, zero and unavailable metadata",
  browserCase(["@functional"]),
  async ({ page }) => {
    const { lists } = await mockList(page);
    const self = accountFixture("en");
    self.data.capabilities = self.data.capabilities.filter(
      (capability) => capability !== "trips.submit_own",
    );
    await page.route("**/api/v1/me", (route) => route.fulfill({ json: self }));
    const status = example("getMyTripStatusSummary:success");
    status.data.counts.accepted = 0;
    status.data.lifetimeTotals = { acceptedTrips: 0, actualDistanceM: "0" };
    await page.route("**/api/v1/me/trip-status-summary", (route) =>
      route.fulfill({ json: status }),
    );
    let state = "error";
    await page.route("**/api/v1/trips?*", (route) => {
      if (state === "error")
        return route.fulfill({ status: 503, json: { error: { code: "UNAVAILABLE" } } });
      if (state === "missing")
        return route.fulfill({
          json: list([{ ...summary(first), reportingBasis: undefined }, summary(third)]),
        });
      return route.fulfill({ json: envelope({ items: [], nextCursor: null, total: 0 }) });
    });
    await page.goto("/account/trips?q=impossible");
    await catalogLanguage(page);
    await expect(page.getByText("Lifetime accepted trips · 0 · 0 km")).toBeVisible();
    await expect(page.getByRole("link", { name: "New report", exact: true })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: /^Drafts/ })).toHaveCount(0);
    // The error and its Retry live inside the table, under the kept headers.
    const retry = table(page)
      .getByRole("alert")
      .getByRole("button", { name: "Retry", exact: true });
    await expect(retry).toBeVisible();
    await expect(table(page).getByRole("alert")).toContainText("The service is unavailable.");
    await expect(page.getByText("Count unavailable", { exact: true })).toBeVisible();
    await expect(page.getByText("Found 0", { exact: true })).toHaveCount(0);
    state = "empty";
    await retry.click();
    await expect(page.getByText("Found 0", { exact: true })).toBeVisible();
    await expect(page.getByText("No records match this view.")).toBeVisible();
    expect(lists.at(-1)?.get("q")).toBe("impossible");
    state = "missing";
    await page.getByRole("searchbox").fill("");
    await expect(rowLink(page, first)).toBeVisible();
    await expect(page.getByText("Count unavailable", { exact: true })).toBeVisible();
    await expect(page.getByText("Staff confirmation", { exact: true })).toBeVisible();
    await expect(page.getByText("Reporting time", { exact: true })).toBeVisible();
    await expect(page.locator(`#trip-time-${first}`)).toContainText("31 Oct 2026, 03:00");
  },
);

test(
  "toolbar fits one row at 1280px and discloses touch filters at 390px and 768px",
  browserCase(["@layout"]),
  async ({ page }, info) => {
    await mockList(page);
    const desktop = info.project.name === "desktop-chromium";
    const touch = await coarse(page);
    for (const scope of ["mine", "company"] as const) {
      await page.goto(`/account/trips?scope=${scope}&game=ets2&source=manual`);
      for (const locale of ["en", "ru"] as const) {
        await catalogLanguage(page, locale);
        const toggle = page.getByRole("button", {
          name: locale === "ru" ? "Фильтры · 2" : "Filters · 2",
        });
        if (!desktop) {
          await expect(toggle).toBeVisible();
          const toggleBox = await toggle.boundingBox();
          expect(toggleBox?.height ?? 0).toBeGreaterThanOrEqual(touch ? 40 : 30);
          await expect(toggle).toHaveAttribute("aria-expanded", "false");
          await toggle.click();
          await expect(toggle).toHaveAttribute("aria-expanded", "true");
        } else await expect(toggle).toHaveCount(0);
        await expect(page.locator("#trip-source")).toBeVisible();
        const budget = await page.locator(".trips-toolbar").evaluate((bar) => {
          const bounds = bar.getBoundingClientRect();
          const elements = Array.from(bar.querySelectorAll("input, select, button, .trips-matches"))
            .map((control) => control.getBoundingClientRect())
            .filter((box) => box.width > 0 && box.height > 0);
          const centres = elements.map((box) => box.top + box.height / 2);
          return {
            spread: Math.max(...centres) - Math.min(...centres),
            searchWidth: bar.querySelector("input")?.getBoundingClientRect().width ?? 0,
            inside: elements.every(
              (box) => box.left >= bounds.left - 1 && box.right <= bounds.right + 1,
            ),
          };
        });
        expect(budget.inside).toBe(true);
        if (desktop) {
          expect(budget.spread).toBeLessThanOrEqual(4);
          expect(budget.searchWidth).toBeGreaterThanOrEqual(200);
        }
        await noOverflow(page);
        await capture(page, info, `trips-toolbar-${scope}-${locale}`);
        if (!desktop) await toggle.click();
      }
    }
  },
);

for (const locale of ["en", "ru"] as const)
  test(
    `the canonical city name reads as secondary text in the list and panel (${locale})`,
    browserCase(["@layout"]),
    async ({ page }, info) => {
      await mockList(page);
      const trip = {
        ...summary(first),
        origin: { ...label("Крёнбург"), nameNative: "Krönburg" },
        destination: { ...label("Fictional Ridge"), nameNative: "fictional ridge" },
        cargo: label("Fictional machinery"),
      };
      const both = {
        ...summary(second),
        origin: { ...label("Крёнбург"), nameNative: "Krönburg" },
        destination: { ...label("Лёдерно"), nameNative: "Lüdernau" },
      };
      await page.route("**/api/v1/trips?*", (route) => route.fulfill({ json: list([trip, both]) }));
      await page.goto("/account/trips");
      await catalogLanguage(page, locale);
      const link = rowLink(page, first);
      await expect(link).toContainText("Крёнбург · Krönburg");
      await expect(link).not.toContainText("fictional ridge");
      await expect(link.locator(".catalog-native")).toHaveCSS("display", "inline");
      // Both names of a route stay in one flowing line, which may wrap but never overflows.
      const pair = rowLink(page, second);
      await expect(pair).toContainText("Крёнбург · Krönburg → Лёдерно · Lüdernau");
      await expect(pair.locator(".catalog-native")).toHaveCount(2);
      for (const name of await pair.locator(".catalog-native").all())
        await expect(name).toHaveCSS("display", "inline");
      await noOverflow(page);
      await capture(page, info, `trips-native-${locale}`);
      if (info.project.name === "desktop-chromium") {
        await page.route(`**/api/v1/trips/${first}`, (route) =>
          route.fulfill({ json: envelope(trip), headers: { ETag: '"v1"' } }),
        );
        await link.click();
        const opened = page.getByRole("region", { name: /^Крёнбург/ });
        await expect(opened).toContainText("Крёнбург · Krönburg");
        await expect(opened.locator(".catalog-native").first()).toHaveCSS("display", "inline");
      }
    },
  );

test(
  "private trip panel localizes recorded job type and unavailable audit fields",
  browserCase(["@layout", "@viewport-desktop"]),
  async ({ page }) => {
    await mockList(page);
    const view = example("getTrip:private-recorded-telemetry");
    view.data.summary = summary(first);
    view.data.effectiveFacts.recordedTelemetry = {
      jobType: "cargo-market",
      gameMode: "unknown",
      hardModeResult: "unknown",
    };
    await page.route(`**/api/v1/trips/${first}`, (route) =>
      route.fulfill({ json: view, headers: { ETag: '"v1"' } }),
    );
    await page.goto(`/account/trips?trip=${first}`);
    const detail = panel(page, first);
    for (const [locale, rows] of [
      [
        "en",
        [
          ["Job type", "Cargo market"],
          ["Game mode", "Unknown"],
          ["Hard Mode result", "Unknown"],
        ],
      ],
      [
        "ru",
        [
          ["Тип заказа", "Рынок грузов для своего прицепа"],
          ["Режим игры", "Неизвестно"],
          ["Результат сложного режима", "Неизвестно"],
        ],
      ],
    ] as const) {
      await catalogLanguage(page, locale);
      for (const [label, value] of rows) {
        const term = detail.getByText(label, { exact: true });
        await expect(term).toBeVisible();
        await expect(term.locator("xpath=following-sibling::dd")).toHaveText(value);
      }
      await noOverflow(page);
    }
  },
);

/** Fictional page of 25 trips; numbers keep every row id distinct. */
function tripPage(offset: number) {
  return Array.from({ length: 25 }, (_, index) => {
    const n = String(offset + index).padStart(2, "0");
    return summary(`49000000-0000-4000-8000-0000000001${n}`);
  });
}

test(
  "a slow next page keeps the rows dimmed, the pager busy and focus on Next",
  browserCase(["@functional"]),
  async ({ page }, info) => {
    await mockList(page);
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/v1/trips?*", async (route) => {
      const cursor = new URL(route.request().url()).searchParams.get("cursor");
      if (cursor === "page-2") {
        await gate;
        await route
          .fulfill({ json: envelope({ items: tripPage(25), nextCursor: "page-3", total: 60 }) })
          .catch(() => {});
        return;
      }
      return route.fulfill({
        json: envelope({ items: tripPage(0), nextCursor: "page-2", total: 60 }),
      });
    });
    await page.goto("/account/trips");
    await catalogLanguage(page);
    const trips = table(page);
    const next = page.getByRole("button", { name: "Next page", exact: true });
    const previous = page.getByRole("button", { name: "Previous page", exact: true });
    await expect(page.getByText("1–25 of 60", { exact: true })).toBeVisible();
    await expect(trips).not.toHaveAttribute("aria-busy", "true");
    await next.click();
    // The previous rows stay, dimmed, while both pager buttons wait for the answer.
    await expect(trips).toHaveAttribute("aria-busy", "true");
    await expect(page.locator(".data-table.trips-table")).toHaveAttribute("data-busy", "true");
    await expect(trips.locator("tbody tr")).toHaveCount(25);
    await expect(trips.locator("tbody")).toHaveCSS("opacity", "0.5");
    await expect(next).toHaveAttribute("aria-disabled", "true");
    await expect(previous).toHaveAttribute("aria-disabled", "true");
    await expect(next).toBeFocused();
    await expect(page.getByText("1–25 of 60", { exact: true })).toHaveCount(0);
    await capture(page, info, "trips-list-busy");
    release();
    await expect(page.getByText("26–50 of 60", { exact: true })).toBeVisible();
    await expect(trips).not.toHaveAttribute("aria-busy", "true");
    await expect(next).toBeFocused();
    await expect(next).toBeEnabled();
    await expect(previous).toBeEnabled();
  },
);

test(
  "the phone sort select drives order= and restarts the cursor",
  browserCase(["@layout", "@viewport-narrow"]),
  async ({ page }, info) => {
    const { lists } = await mockList(page, { paged: true });
    await page.goto("/account/trips");
    await catalogLanguage(page);
    await expect(table(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Completion", exact: true })).toBeHidden();
    const sort = page.getByRole("combobox", { name: "Completion order", exact: true });
    await expect(sort).toBeVisible();
    await expect(sort.locator("option")).toHaveText(["Newest first", "Oldest first"]);
    await expect(sort).toHaveValue("completion:desc");
    if (await coarse(page))
      expect((await sort.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(40);
    await page.getByRole("button", { name: "Next page", exact: true }).click();
    await expect.poll(() => lists.at(-1)?.get("cursor")).toBe("page-2");
    await sort.focus();
    await sort.selectOption("completion:asc");
    await expect(page).toHaveURL(/[?&]order=completion_asc(&|$)/);
    await expect(page).not.toHaveURL(/cursor=/);
    await expect
      .poll(() => lists.at(-1)?.toString())
      .toBe("scope=mine&order=completion_asc&locale=en&limit=25");
    await expect(sort).toBeFocused();
    await expect(page.getByRole("button", { name: "Previous page", exact: true })).toBeDisabled();
    await catalogLanguage(page, "ru");
    const localized = page.getByRole("combobox", { name: "Порядок завершения", exact: true });
    await expect(localized).toHaveValue("completion:asc");
    await expect(localized.locator("option")).toHaveText(["Сначала новые", "Сначала старые"]);
    await noOverflow(page);
    await capture(page, info, "trips-list-phone-sort-ru");
    expectListParams(lists);
  },
);

test(
  "an empty My trips list offers New report while other empty views do not",
  browserCase(["@functional"]),
  async ({ page }) => {
    await mockList(page);
    await page.route("**/api/v1/trips?*", (route) =>
      route.fulfill({ json: envelope({ items: [], nextCursor: null, total: 0 }) }),
    );
    await page.goto("/account/trips");
    await catalogLanguage(page);
    const trips = table(page);
    await expect(trips).toContainText("No trips yet");
    await expect(trips.getByRole("link", { name: "New report", exact: true })).toHaveAttribute(
      "href",
      "/account/reports/new",
    );
    await expect(trips.getByRole("button", { name: "Reset filters" })).toHaveCount(0);
    // An empty first page has nothing to page through.
    await expect(page.getByRole("button", { name: "Next page", exact: true })).toHaveCount(0);
    await page.getByRole("tab", { name: "Accepted company trips", exact: true }).click();
    await expect(table(page)).toContainText("No records match this view.");
    await expect(table(page).getByRole("link")).toHaveCount(0);
    await page.goto("/account/trips?game=ats");
    const reset = table(page).getByRole("button", { name: "Reset filters", exact: true });
    await expect(reset).toBeVisible();
    await expect(table(page).getByRole("link")).toHaveCount(0);
    await reset.click();
    await expect(page).not.toHaveURL(/game=/);
    await expect(table(page)).toContainText("No trips yet");
  },
);

test(
  "switching to another tab shows the loading skeleton, never the previous tab's rows",
  browserCase(["@functional"]),
  async ({ page }) => {
    await mockList(page);
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/v1/trips?*", async (route) => {
      const scope = new URL(route.request().url()).searchParams.get("scope");
      if (scope === "company") {
        await gate;
        await route.fulfill({ json: list([summary(colleague)]) }).catch(() => {});
        return;
      }
      return route.fulfill({ json: list([summary(first), summary(second)]) });
    });
    await page.goto("/account/trips");
    await catalogLanguage(page);
    await expect(rowLink(page, first)).toBeVisible();
    await page.getByRole("tab", { name: "Accepted company trips", exact: true }).click();
    const trips = table(page);
    await expect(trips.locator("tbody.data-table-skeleton")).toBeAttached();
    await expect(trips).toHaveAttribute("aria-busy", "true");
    await expect(rowLink(page, first)).toHaveCount(0);
    await expect(page.locator(".data-table.trips-table")).not.toHaveAttribute("data-busy", "true");
    release();
    await expect(rowLink(page, colleague)).toBeVisible();
    await expect(rowLink(page, first)).toHaveCount(0);
    await expect(trips).not.toHaveAttribute("aria-busy", "true");
  },
);
