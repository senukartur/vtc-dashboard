import type { Locator, Page, Request, TestInfo } from "@playwright/test";
import { accountFixture } from "../../apps/web/src/features/account/fixtures.ts";
import { catalogLanguage } from "./support/catalogs.ts";
import { browserCase, expect, test } from "./support/fixtures.ts";
import {
  acceptedTelemetry,
  asOtherMember,
  eventMember,
  eventPage,
  fictionalEvent,
  fixtureReviewer,
  longCompanyName,
  longEventTitle,
  longValues,
  manualUnknown,
  needsFixEvidence,
  needsFixManual,
  needsFixReason,
  needsFixReportId,
  olderPrivate,
  openTelemetry,
  otherSummary,
  pendingManual,
  reconciledAccepted,
  returnedReason,
  returnedTrip,
  senderCompanyId,
  type TripEnvelope,
  tripEventId,
  tripPageId,
  tripPrivate,
  withoutSources,
  withRoute,
} from "./support/trip-page-fixtures.ts";
import { mockTrips } from "./support/trip-ui.ts";

const tripPath = `/account/trips/${tripPageId}`;
// A device zone other than UTC, so a saved zone and "as on the device" (null) render differently.
const deviceZone = "Asia/Tokyo";
const retentionNotice =
  "Screenshots remain for at least one calendar year after the latest decision and throughout review. Structured history remains after expiry.";
test.use({ timezoneId: deviceZone });

/**
 * The signed-in fixture member reading the mutable stub through the trip mock: the author without
 * staff capabilities unless `staff` adds trips.review. The saved display zone is UTC unless null
 * ("as on the device") is requested.
 */
async function author(
  page: Page,
  initial: TripEnvelope,
  displayTimezone: string | null = "UTC",
  staff = false,
) {
  await mockTrips(page);
  const self = accountFixture("en");
  const json = {
    ...self,
    data: {
      ...self.data,
      capabilities: staff ? [...self.data.capabilities, "trips.review"] : self.data.capabilities,
      preferences: { locale: "en", displayTimezone },
    },
  };
  await page.route("**/api/v1/me", (route) => route.fulfill({ json }));
  const state = { view: initial, status: 200, calls: 0 };
  await page.route(`**/api/v1/trips/${tripPageId}`, (route) => {
    state.calls++;
    return route.fulfill(
      state.status === 200
        ? { json: state.view, headers: { ETag: '"v1"' } }
        : { status: state.status, json: { error: { code: "PRIVATE_SENTINEL" } } },
    );
  });
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/v1/")) requests.push(url.pathname);
  });
  return { state, requests };
}
const region = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
/** Waits for the route card and asserts that no load failure is announced. */
async function loaded(page: Page) {
  await expect(page.locator(".trip-route")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
}
/** The definition next to an exact term inside `scope`. */
const fact = (scope: Locator, term: string) =>
  scope.locator(`dt:text-is(${JSON.stringify(term)}) + dd`);
const status = (page: Page) => page.locator(".trip-detail-status");
const banner = (page: Page, name = "Trip status") => region(page, name);
const counted = (page: Page) => page.locator(".trip-detail-counted");
const menuButton = (page: Page, name = "More actions") =>
  page.getByRole("main").getByRole("button", { name, exact: true });
const logoRequests = (requests: string[]) => requests.filter((path) => path.endsWith("/logo"));
// Staff-only reads. The author reads their own trip's proposals for its history (VTC-169).
const privatePaths = /\/review|\/reconciliations|\/manual-revisions|\/manual-reports/;

/** Opens the actions menu by keyboard and returns it. */
async function openMenu(page: Page, name = "More actions") {
  await menuButton(page, name).focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name, exact: true });
  await expect(menu).toBeVisible();
  return menu;
}
/** Refreshes the trip through the actions menu and waits for the read. */
async function refresh(page: Page, locale: "en" | "ru" = "en") {
  const menu = await openMenu(page, locale === "en" ? "More actions" : "Ещё действия");
  const read = page.waitForResponse((r) => r.url().endsWith(`/trips/${tripPageId}`));
  await menu
    .getByRole("menuitem", { name: locale === "en" ? "Refresh data" : "Обновить данные" })
    .click();
  await read;
}
/** Opens an info button inside `scope` and returns its popover. */
async function openTip(page: Page, scope: Locator, name: string) {
  await scope.getByRole("button", { name, exact: true }).click();
  const tip = page.locator(".info-tip-content");
  await expect(tip).toBeVisible();
  return tip;
}
async function closeTip(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.locator(".info-tip-content")).toHaveCount(0);
}
/** Visible page text without identifiers, raw timestamps, file details, codes or fallback notes. */
async function expectHumanText(page: Page, forbidden: (string | RegExp)[] = []) {
  const text = await page.locator("main").innerText();
  for (const pattern of [
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    /\d{4}-\d{2}-\d{2}T/,
    "image/png",
    "SYNTHETIC_",
    "manual_report",
    "qualification_level_unknown",
    "fict_logistics",
    "fict_port",
    "fict_unknown_depot",
    "English fallback",
    "For dispatchers",
    ...forbidden,
  ])
    if (typeof pattern === "string") expect(text).not.toContain(pattern);
    else expect(text).not.toMatch(pattern);
}

test(
  "an accepted trip leads with its outcome: title, counted line, route, strip, cards and a collapsed check",
  browserCase(["@functional"]),
  async ({ page }) => {
    const { state, requests } = await author(page, acceptedTelemetry());
    await page.goto(tripPath);
    await catalogLanguage(page);
    await loaded(page);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Fictional Westport → Fictional Eastbrook",
    );
    await expect(status(page)).toHaveText("Accepted");
    // An accepted trip has no banner, only its counted line.
    await expect(banner(page)).toHaveCount(0);
    await expect(counted(page)).toHaveText(
      `Counted: +812 km in statistics and ETS2 qualification · ${fixtureReviewer.nickname}, 11 Nov, 08:15`,
    );
    await expect(page.locator(".trip-detail-meta > span")).toHaveText([
      "Trip #1170",
      "ETS2",
      "Telemetry",
      "Hard Mode",
    ]);
    // The shell breadcrumb is the only one; the page does not repeat it.
    await expect(page.getByRole("main").getByRole("navigation")).toHaveCount(0);
    // The menu replaces the separate Refresh and Review buttons.
    for (const name of ["Refresh", "Review workspace", "Open in dispatch"])
      for (const role of ["button", "link"] as const)
        await expect(page.getByRole("main").getByRole(role, { name, exact: true })).toHaveCount(0);

    const route = region(page, "Route");
    const [origin, middle, destination] = [
      route.locator(".trip-route-end[data-side=origin]"),
      route.locator(".trip-route-middle"),
      route.locator(".trip-route-end[data-side=destination]"),
    ];
    await expect(origin).toContainText("Fictional Logistics");
    await expect(origin).toContainText("Fictional Westport");
    await expect(origin.locator("time")).toHaveText("10 Nov, 10:00");
    await expect(origin.locator(".company-logo")).toHaveAttribute("data-logo", "image");
    await expect
      .poll(() =>
        origin.locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth),
      )
      .toBeGreaterThan(0);
    await expect(destination).toContainText("Fictional Port Services");
    await expect(destination.locator(".company-logo")).toHaveAttribute("data-logo", "placeholder");
    await expect(destination.locator("time")).toHaveAttribute(
      "datetime",
      "2026-11-10T18:00:00.000Z",
    );
    expect(logoRequests(requests)).toEqual([`/api/v1/catalogs/companies/${senderCompanyId}/logo`]);
    await expect(middle).toContainText("812 km · 8 h");
    await expect(middle).toContainText("Delivered");
    await expect(fact(route, "Distance")).toHaveText("812 km");
    await expect(fact(route, "Revenue")).toHaveText("12,480 EUR");
    await expect(fact(route, "Cargo mass")).toHaveText("24.9 t");
    await expect(fact(route, "Damage")).toHaveText("0 %");

    const cargo = region(page, "Cargo and trailer");
    await expect(cargo.locator("dt")).toHaveText(["Properties", "Trailer"]);
    await expect(fact(cargo, "Properties").getByRole("listitem")).toHaveText(["Machinery"]);
    await expect(fact(cargo, "Properties").locator(".lucide")).toHaveCount(1);
    // The cargo labels are explained once, in the bottom data note.
    await expect(cargo.getByRole("button")).toHaveCount(0);
    await expect(fact(cargo, "Trailer")).toHaveText("Fictional trailer_type");

    const conditions = region(page, "Conditions");
    await expect(conditions.locator("dt")).toHaveText([
      "Game mode",
      "Job type",
      "Hard Mode",
      "Event",
    ]);
    await expect(fact(conditions, "Game mode")).toHaveText("Single-player");
    await expect(fact(conditions, "Game mode").locator(".lucide")).toHaveCount(1);
    await expect(fact(conditions, "Job type")).toHaveText("Freight market");
    await expect(fact(conditions, "Hard Mode")).toHaveText("Qualified");
    const event = fact(conditions, "Event");
    await expect(event.getByRole("link", { name: "Fictional Winter Convoy" })).toHaveAttribute(
      "href",
      `/account/events/${tripEventId}`,
    );
    await expect(event.getByRole("button", { name: "Change", exact: true })).toHaveAttribute(
      "aria-haspopup",
      "dialog",
    );

    const check = region(page, "Qualification");
    await expect(check.locator(".trip-qualification-rules")).toHaveText("Rules: 5 of 6");
    await expect(check).toContainText("Checked against “Fictional Trainee” · As at the decision");
    await expect(check.getByRole("listitem")).toHaveCount(0);
    const toggle = check.getByRole("button", { name: "Show rules", exact: true });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    const hide = check.getByRole("button", { name: "Hide rules", exact: true });
    await expect(hide).toHaveAttribute("aria-expanded", "true");
    const rules = check.getByRole("listitem");
    await expect(rules).toHaveCount(6);
    await expect(page.locator(`#${await hide.getAttribute("aria-controls")}`)).toBeVisible();
    for (const [index, result] of ["pass", "pass", "fail", "pass", "pass", "pass"].entries())
      await expect(rules.nth(index)).toHaveAttribute("data-result", result);
    await expect(rules.nth(2)).toContainText("Trailer types · Outside the limit");
    // The cargo damage cap (VTC-171) is one of the counted rules.
    await expect(rules.filter({ hasText: "Cargo damage · Passes" })).toContainText(
      "Trip: 37.5% · Limit: up to 100%",
    );
    // The shared list renders without its own heading inside the card.
    await expect(check.getByRole("heading")).toHaveText(["Qualification"]);
    await hide.click();
    await expect(rules).toHaveCount(0);

    const history = region(page, "History");
    await expect(history.getByRole("listitem")).toHaveCount(2);
    await expect(history.getByRole("listitem").nth(0)).toContainText("Telemetry received");
    await expect(history.getByRole("listitem").nth(1)).toContainText(
      `Accepted11 Nov, 08:15 · ${fixtureReviewer.nickname}`,
    );

    const note = page.locator(".trip-data-note");
    await expect(note).toContainText("Times in your time zone (UTC)");
    const tip = await openTip(page, note, "About the data");
    await expect(tip).toContainText("Where the data comes from");
    await expect(tip).toContainText(
      "Telemetry recorded the trip on 10 Nov, 18:00, distance 812 km.",
    );
    await expect(tip).toContainText("No manual report.");
    await expect(tip).toContainText("company reporting time zone");
    await expect(tip).toContainText("company catalog");
    await closeTip(page);

    // The driver sees no dispatcher block, sources or raw data and causes no private reads.
    for (const name of ["Sources", "For dispatchers", "Technical details"])
      await expect(page.getByText(name, { exact: true })).toHaveCount(0);
    await expectHumanText(page);
    expect(requests.filter((path) => privatePaths.test(path))).toEqual([]);

    state.status = 403;
    await refresh(page);
    await expect(page.getByRole("alert")).toContainText("permissions");
    for (const name of ["Route", "Cargo and trailer", "Conditions", "Qualification", "History"])
      await expect(region(page, name)).toHaveCount(0);
    const deniedCalls = state.calls;
    await page.waitForTimeout(250);
    expect(state.calls).toBe(deniedCalls);
  },
);

test(
  "the actions menu works by keyboard, offers each viewer only its actions and copies the link",
  browserCase(["@functional"]),
  async ({ page, context }) => {
    const { state } = await author(page, acceptedTelemetry());
    await page.goto(tripPath);
    await catalogLanguage(page);
    await loaded(page);
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: new URL(page.url()).origin,
    });

    let menu = await openMenu(page);
    await expect(menu.getByRole("menuitem")).toHaveText([
      "Link to an event…",
      "Refresh data",
      "Copy link",
    ]);
    await expect(menu.getByRole("menuitem").first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", { name: "Refresh data" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(menuButton(page)).toBeFocused();

    menu = await openMenu(page);
    await menu.getByRole("menuitem", { name: "Copy link" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Link copied." })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      `${new URL(page.url()).origin}${tripPath}`,
    );
    await page.evaluate(() => {
      navigator.clipboard.writeText = () => Promise.reject(new Error("denied"));
    });
    menu = await openMenu(page);
    await menu.getByRole("menuitem", { name: "Copy link" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Could not copy the link." }),
    ).toBeVisible();

    // A revisable pending report adds Edit the report; a returned one gets the banner action.
    const pending = pendingManual();
    state.view = pending;
    await refresh(page);
    menu = await openMenu(page);
    await expect(menu.getByRole("menuitem")).toHaveText([
      "Link to an event…",
      "Edit the report",
      "Refresh data",
      "Copy link",
    ]);
    await expect(menu.getByRole("menuitem", { name: "Edit the report" })).toHaveAttribute(
      "href",
      `/account/reports/${needsFixReportId}/edit`,
    );
    await page.keyboard.press("Escape");
    state.view = needsFixManual();
    await refresh(page);
    menu = await openMenu(page);
    await expect(menu.getByRole("menuitem", { name: "Edit the report" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(banner(page).getByRole("link", { name: "Fix the report" })).toHaveAttribute(
      "href",
      `/account/reports/${needsFixReportId}/edit`,
    );

    // Staff reading another member's trip open it in dispatch; they cannot link or fix it.
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await author(page, asOtherMember(needsFixManual()), "UTC", true);
    await page.reload();
    await catalogLanguage(page);
    await loaded(page);
    menu = await openMenu(page);
    await expect(menu.getByRole("menuitem")).toHaveText([
      "Refresh data",
      "Copy link",
      "Open in dispatch",
    ]);
    await expect(menu.getByRole("menuitem", { name: "Open in dispatch" })).toHaveAttribute(
      "href",
      `/account/review/${tripPageId}`,
    );
    await page.keyboard.press("Escape");
    await expect(banner(page).getByRole("link")).toHaveCount(0);
  },
);

const banners = {
  en: {
    region: "Trip status",
    held: "Why it is held",
    reason: "Other reason",
    rows: [
      [
        "Pending review",
        "not counted yet",
        "Staff will review the trip.",
        "Submitted 11 Nov, 09:00",
      ],
      [
        "Needs fixes",
        "not counted yet",
        "Open the report, correct it and submit it again.",
        `${fixtureReviewer.nickname}, 12 Nov, 10:31`,
      ],
      [
        "Rejected",
        "not counted",
        "The trip was rejected and does not count.",
        "Fictional Stage Four Dispatcher, 11 Nov, 10:00",
      ],
      ["In progress", "not counted yet", "The trip is still in progress in the game.", ""],
      ["Not checked yet", "not counted yet", "The trip has not been assessed yet.", ""],
      ["Cancelled", "not counted", "A cancelled delivery does not count.", ""],
    ],
    quotes: [
      "",
      `"${needsFixReason}" · Other reason, No completion screenshot`,
      `"${returnedReason}"`,
      "",
      "",
      "",
    ],
    action: "Fix the report",
  },
  ru: {
    region: "Статус рейса",
    held: "Почему на проверке",
    reason: "Другая причина",
    rows: [
      ["На проверке", "пока не засчитан", "Рейс проверит сотрудник.", "Отправлен 11 нояб., 09:00"],
      [
        "Нужно исправить",
        "пока не засчитан",
        "Откройте отчёт, исправьте его и отправьте снова.",
        `${fixtureReviewer.nickname}, 12 нояб., 10:31`,
      ],
      [
        "Отклонён",
        "не засчитан",
        "Рейс отклонён и не учитывается.",
        "Fictional Stage Four Dispatcher, 11 нояб., 10:00",
      ],
      ["Выполняется", "пока не засчитан", "Рейс ещё идёт в игре.", ""],
      ["Ещё не проверен", "пока не засчитан", "Рейс ещё не оценён.", ""],
      ["Отменён", "не засчитан", "Отменённая доставка не учитывается.", ""],
    ],
    quotes: [
      "",
      `«${needsFixReason}» · Другая причина, Нет скриншота завершения`,
      `«${returnedReason}»`,
      "",
      "",
      "",
    ],
    action: "Исправить отчёт",
  },
} as const;

test(
  "every status that is not accepted reads as one banner with at most one action in EN and RU",
  browserCase(["@functional"]),
  async ({ page }) => {
    const pending = pendingManual();
    tripPrivate(pending).summary.submittedAt = "2026-11-11T09:00:00.000Z";
    const unassessed = openTelemetry();
    tripPrivate(unassessed).summary.outcome = "delivered";
    const cancelled = openTelemetry();
    tripPrivate(cancelled).summary.outcome = "cancelled";
    const views = () => [
      structuredClone(pending),
      needsFixManual(),
      returnedTrip(),
      openTelemetry(),
      structuredClone(unassessed),
      structuredClone(cancelled),
    ];
    const { state } = await author(page, acceptedTelemetry());
    await page.goto(tripPath);
    for (const locale of ["en", "ru"] as const) {
      await catalogLanguage(page, locale);
      const text = banners[locale];
      for (const [index, view] of views().entries()) {
        const [title = "", count = "", sentence = "", by = ""] = text.rows[index] ?? [];
        state.view = view;
        await refresh(page, locale);
        const box = banner(page, text.region);
        await expect(status(page)).toHaveText(title);
        await expect(box.locator(".trip-banner-title strong")).toHaveText(title);
        await expect(box.locator(".trip-banner-counted")).toHaveText(count);
        await expect(box.locator(".trip-banner-text")).toHaveText(sentence);
        await expect(counted(page)).toHaveCount(0);
        const quote = text.quotes[index] ?? "";
        if (quote) await expect(box.locator(".trip-detail-quote")).toHaveText(quote);
        else await expect(box.locator(".trip-detail-quote")).toHaveCount(0);
        if (by) await expect(box.locator(".trip-banner-body > .trip-muted")).toHaveText(by);
        else await expect(box.locator(".trip-banner-body > .trip-muted")).toHaveCount(0);
        // At most one action: the owner's fix of a returned report.
        await expect(box.getByRole("link")).toHaveCount(index === 1 ? 1 : 0);
        if (index === 1) await expect(box.getByRole("link")).toHaveText(text.action);
        if (index === 0) {
          const tip = await openTip(page, box, text.held);
          await expect(tip).toContainText(text.reason);
          await expect(tip).not.toContainText("SYNTHETIC_");
          await closeTip(page);
        }
      }
    }
  },
);

test(
  "missing values are left out, unknown distance is explained and zero damage stays zero",
  browserCase(["@functional"]),
  async ({ page }) => {
    const { state, requests } = await author(page, manualUnknown());
    await page.goto(tripPath);
    await catalogLanguage(page);
    await loaded(page);

    const route = region(page, "Route");
    // An unresolved company and one without a code are both left out of the route.
    await expect(route.locator(".trip-route-company")).toHaveCount(0);
    await expect(route).not.toContainText("Unknown company");
    await expect(page.locator(".company-logo")).toHaveCount(0);
    await expect(route.locator("dt")).toHaveText(["Distance"]);
    await expect(fact(route, "Distance")).toHaveText("500 km");
    await expect(route).not.toContainText("0 %");
    // Nothing is known about the cargo, so the card is not rendered at all.
    await expect(region(page, "Cargo and trailer")).toHaveCount(0);
    const conditions = region(page, "Conditions");
    await expect(conditions.locator("dt")).toHaveText(["Event"]);
    await expect(fact(conditions, "Event")).toHaveText("Not linked·Link");
    const check = region(page, "Qualification");
    await expect(check).toContainText("The driver's level at trip time is unknown");
    await expect(check.locator(".trip-qualification-rules")).toHaveCount(0);
    await expect(check.getByRole("button")).toHaveCount(0);
    const tip = await openTip(page, page.locator(".trip-data-note"), "About the data");
    await expect(tip).toContainText("Manual report: telemetry did not record this trip.");
    await expect(tip).not.toContainText("company reporting time zone");
    await closeTip(page);
    await expectHumanText(page);

    const unknownDistance = manualUnknown();
    tripPrivate(unknownDistance).summary.actualDistanceM = null;
    state.view = unknownDistance;
    await refresh(page);
    const distance = fact(region(page, "Route"), "Distance");
    await expect(distance).toHaveText("Unavailable");
    await expect(distance).not.toContainText("0 km");
    await expect(await openTip(page, distance, "Why is this unknown?")).toContainText("not zero");
    await closeTip(page);

    state.view = manualUnknown("zero-damage");
    await refresh(page);
    await expect(fact(region(page, "Route"), "Damage")).toHaveText("0 %");

    state.view = manualUnknown("no-check");
    await refresh(page);
    await expect(region(page, "Qualification")).toHaveCount(0);

    state.view = manualUnknown("event-exempt");
    await refresh(page);
    await expect(region(page, "Qualification")).toContainText(
      "A company event trip — credited without the qualification check",
    );
    await expect(region(page, "Qualification").getByRole("button")).toHaveCount(0);

    // A returned manual report: the report's trailer stands in without a per-field mark.
    state.view = needsFixManual("no-fact");
    await refresh(page);
    await expect(fact(region(page, "Cargo and trailer"), "Trailer")).toHaveText(
      "Fictional trailer_type",
    );
    await expect(page.getByText("by the report")).toHaveCount(0);
    await expect(fact(region(page, "Route"), "Damage")).toHaveText("12.5 %");
    const shots = region(page, "Completion screenshots");
    await expect(shots).toContainText(needsFixEvidence.originalName);
    await expect(shots.getByText(retentionNotice, { exact: true })).toBeVisible();
    const reported = await openTip(page, page.locator(".trip-data-note"), "About the data");
    await expect(reported).toContainText("Manual report submitted on 11 Nov, 09:00.");
    await expect(reported).toContainText("The driver stated this in the manual report.");
    await closeTip(page);
    state.view = needsFixManual("unknown-damage");
    await refresh(page);
    await expect(fact(region(page, "Route"), "Damage")).toHaveCount(0);

    // Another member's accepted summary: route, distance and the counted line only.
    const ownReads = requests.length;
    state.view = otherSummary();
    await refresh(page);
    await expect(page.getByText("Accepted company summary", { exact: true })).toBeVisible();
    await expect(counted(page)).toHaveText("Counted: +812 km in statistics and ETS2 qualification");
    await expect(page.locator(".trip-detail-meta")).toContainText("Driver: Fictional Other Driver");
    await expect(region(page, "Route").locator("dt")).toHaveText(["Distance"]);
    // Only the cargo itself: labels and the trailer are private.
    const summaryCargo = region(page, "Cargo and trailer");
    await expect(summaryCargo.locator("dt")).toHaveText(["Cargo"]);
    await expect(fact(summaryCargo, "Cargo")).toHaveText("Fictional machine parts");
    for (const name of ["Conditions", "Qualification", "History"])
      await expect(region(page, name)).toHaveCount(0);
    await expect(page.locator(".trip-data-note")).toHaveCount(0);
    expect(
      requests.filter((path) => privatePaths.test(path) || path.includes("/evidence")),
    ).toEqual([]);
    // Another member's summary reads no proposals.
    expect(requests.slice(ownReads).filter((path) => path.includes("/proposals"))).toEqual([]);
    expect(logoRequests(requests)).toEqual([]);

    // Older private views without Stage 4 data still read as a trip page.
    state.view = olderPrivate("extended-manual-revision");
    await refresh(page);
    await expect(region(page, "History")).toBeVisible();
    await expect(region(page, "Completion screenshots")).toContainText(
      "No screenshots are attached.",
    );
  },
);

test(
  "the dispatcher block stays collapsed and unread until opened and never renders for drivers",
  browserCase(["@functional"]),
  async ({ page }) => {
    const fallback = withRoute(needsFixManual());
    const origin = tripPrivate(fallback).summary.origin;
    if (origin) origin.englishFallback = true;
    const driver = await author(page, fallback);
    await page.goto(tripPath);
    await catalogLanguage(page);
    await loaded(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Fictional Westport → Fictional Eastbrook",
    );
    await expect(page.locator("summary", { hasText: "For dispatchers" })).toHaveCount(0);
    await expectHumanText(page, [String(needsFixEvidence.byteLength)]);
    expect(driver.requests.filter((path) => privatePaths.test(path))).toEqual([]);

    await page.unrouteAll({ behavior: "ignoreErrors" });
    const staff = await author(page, asOtherMember(needsFixManual()), "UTC", true);
    await page.reload();
    await catalogLanguage(page);
    await loaded(page);
    await expect(status(page)).toHaveText("Needs fixes");
    await expect(page.locator(".trip-detail-meta")).toContainText("Driver: Fictional Other Driver");
    await expect(banner(page).locator(".trip-banner-text")).toHaveText(
      "The report was returned to the driver for fixes.",
    );
    const block = page.locator("details.trip-staff");
    await expect(block.locator("summary")).toHaveText(
      "For dispatchersSources · technical details · private history · merges",
    );
    await expect(block).not.toHaveAttribute("open");
    // Nothing inside renders or loads while collapsed.
    for (const name of ["Sources", "Technical details", "Reconciliation history"])
      await expect(page.getByText(name, { exact: true })).toHaveCount(0);
    expect(staff.requests.filter((path) => privatePaths.test(path))).toEqual([]);

    await block.locator("summary").first().click();
    await expect(block).toHaveAttribute("open");
    await expect(region(page, "Sources").getByRole("listitem")).toHaveCount(1);
    for (const name of [
      "Technical details",
      "Private report and review history",
      "Reconciliation history",
    ])
      await expect(block.locator("summary", { hasText: new RegExp(`^${name}`) })).toBeVisible();
    const technical = block.locator("details").filter({
      has: page.locator("summary", { hasText: /^Technical details/ }),
    });
    await technical.locator("summary").click();
    await expect(technical.getByText(tripPageId, { exact: true })).toBeVisible();
    await expect(technical.getByText("SYNTHETIC_STAFF_REVIEW", { exact: true })).toBeVisible();
    await expect(technical).toContainText(String(needsFixEvidence.byteLength));
    expect(
      staff.requests.filter((path) => /\/manual-revisions|\/manual-reports/.test(path)),
    ).toEqual([]);
  },
);

test(
  "staff read reconciled sources in the dispatcher block; a failed logo, selected limits and the correction request stay as before",
  browserCase(["@functional"]),
  async ({ page }) => {
    // A null saved zone follows the device; staff own this trip so every block renders.
    const { state } = await author(page, reconciledAccepted(), null, true);
    await page.route(new RegExp(`/api/v1/catalogs/companies/${senderCompanyId}/logo`), (route) =>
      route.fulfill({ status: 500, json: { error: { code: "PRIVATE_SENTINEL" } } }),
    );
    await page.goto(tripPath);
    await catalogLanguage(page);
    await loaded(page);

    // The failed logo falls back to the placeholder plate without leaking the failure.
    const origin = region(page, "Route").locator(".trip-route-end[data-side=origin]");
    await expect(origin.locator(".company-logo")).toHaveAttribute("data-logo", "placeholder");
    await expect(origin).toContainText("Fictional Logistics");
    await expect(region(page, "Route").locator("img")).toHaveCount(0);
    await expect(page.getByText("PRIVATE_SENTINEL")).toHaveCount(0);
    await expect(page.locator(".trip-detail-meta > span")).toContainText([
      "Telemetry",
      "Manual report",
    ]);
    await expect(page.locator(".trip-data-note")).toContainText(
      `Times in your time zone (${deviceZone})`,
    );
    // An accepted telemetry trip is final: the driver is offered no correction (VTC-169).
    await expect(
      page.getByRole("heading", { name: "Propose a correction", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Correct the trip", exact: true })).toHaveCount(0);

    await page.locator("details.trip-staff > summary").click();
    const sources = region(page, "Sources");
    const items = sources.getByRole("listitem");
    await expect(items.locator(".trip-source-head > .badge:first-child")).toHaveText([
      "Telemetry",
      "Manual report",
    ]);
    await expect(sources.getByText("Used for the trip", { exact: true })).toHaveCount(1);
    await expect(items.nth(0).getByText("Used for the trip", { exact: true })).toBeVisible();
    await expect(fact(items.nth(0), "Driven distance")).toHaveText("812.4005 km");
    await expect(fact(items.nth(1), "Driven distance")).toHaveText("810 km");
    await expect(fact(items.nth(1), "Source outcome")).toHaveText("Delivered");
    await expect(sources).toContainText(`Times in ${deviceZone}`);
    await expect(fact(items.nth(0), "Received")).toHaveText(/11 Nov 2026.*03:00/);

    // A rejected own trip: no correction; selected limits are named, never blank.
    state.view = returnedTrip();
    await refresh(page);
    await expect(status(page)).toHaveText("Rejected");
    await expect(
      page.getByRole("heading", { name: "Propose a correction", exact: true }),
    ).toHaveCount(0);
    const check = region(page, "Qualification");
    await check.getByRole("button", { name: "Show rules", exact: true }).click();
    const rules = check.getByRole("listitem");
    await expect(rules).toHaveCount(5);
    await expect(rules.nth(2)).toContainText("Trip: Fictional Tanker · Limit: Only selected");
    await expect(rules.nth(3)).toHaveAttribute("data-result", "fail");
    await expect(rules.nth(3)).toContainText(
      "Trip: 3 · Flammable liquids · Limit: Selected classes",
    );

    // No recorded source is explained inside the dispatcher block.
    state.view = withoutSources();
    await refresh(page);
    const block = page.locator("details.trip-staff");
    if ((await block.getAttribute("open")) === null) await block.locator("summary").first().click();
    await expect(region(page, "Sources")).toContainText("No sources are recorded for this trip.");
    await expect(region(page, "Sources").getByRole("listitem")).toHaveCount(0);
  },
);

/** The pending own trip the dialog cases link: on 10 Nov 10:00–18:00 UTC between two cities. */
function pendingTelemetry() {
  const trip = acceptedTelemetry("no-event");
  const view = tripPrivate(trip);
  view.summary.decision = "pending_review";
  view.decisions = [];
  return trip;
}
const events = {
  older: fictionalEvent(1, "2026-11-01T09:00:00.000Z"),
  otherGame: fictionalEvent(2, "2026-11-10T08:00:00.000Z", { game: "ats" }),
  cancelled: fictionalEvent(3, "2026-11-10T08:30:00.000Z", { status: "cancelled" }),
  match: fictionalEvent(4, "2026-11-10T09:00:00.000Z", {
    sameRoute: true,
    title: "Fictional Westport Convoy",
  }),
  sameDay: fictionalEvent(5, "2026-11-10T20:00:00.000Z", { title: "Fictional Evening Run" }),
  later: fictionalEvent(6, "2026-11-12T09:00:00.000Z", { title: "Fictional Later Run" }),
};
/**
 * Serves the past events in pages keyed by cursor, each member read by event, and records every
 * list request's query string.
 */
async function serveEvents(
  page: Page,
  pages: Record<string, { items: (typeof events)[keyof typeof events][]; next: string | null }>,
  members: Record<string, ReturnType<typeof eventMember>> = {},
) {
  const reads: string[] = [];
  const control = { status: 200 };
  await page.route(/\/api\/v1\/events(\?.*)?$/, (route) => {
    const url = new URL(route.request().url());
    // Other event reads (the shell's upcoming events) keep the default mock.
    if (url.searchParams.get("period") !== "past") return route.fallback();
    reads.push(url.search);
    if (control.status !== 200)
      return route.fulfill({
        status: control.status,
        json: { error: { code: "PRIVATE_SENTINEL" } },
      });
    const found = pages[url.searchParams.get("cursor") ?? ""];
    if (!found)
      return route.fulfill({ status: 409, json: { error: { code: "VERSION_CONFLICT" } } });
    return route.fulfill({ json: eventPage(found.items, found.next) });
  });
  await page.route(/\/api\/v1\/events\/[0-9a-f-]{36}$/, (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1) ?? "";
    const member = members[id];
    return member
      ? route.fulfill({ json: member })
      : route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" } } });
  });
  return { reads, control };
}
const dialog = (page: Page) => page.getByRole("dialog", { name: "Link to an event" });
const options = (page: Page) => dialog(page).getByRole("radio");
const optionNames = (page: Page) =>
  dialog(page).locator(".trip-event-option strong").allInnerTexts();

test(
  "the event dialog lists same-game scheduled events of the trip day, matches routes and links the trip",
  browserCase(["@functional"]),
  async ({ page }) => {
    const { state } = await author(page, pendingTelemetry());
    const { reads } = await serveEvents(
      page,
      {
        "": {
          items: [events.older, events.otherGame, events.cancelled, events.match],
          next: "cursor-2",
        },
        "cursor-2": { items: [events.sameDay, events.later], next: "cursor-3" },
        "cursor-3": { items: [], next: "cursor-4" },
        "cursor-4": { items: [], next: null },
      },
      {
        [events.match.id]: eventMember(events.match, "unconfirmed", "participating"),
        [events.sameDay.id]: eventMember(events.sameDay, "unconfirmed", "unanswered"),
        [events.older.id]: eventMember(events.older, "attended", "participating"),
      },
    );
    await page.goto(tripPath);
    await catalogLanguage(page);
    await loaded(page);
    const conditions = region(page, "Conditions");
    await expect(fact(conditions, "Event")).toHaveText("Not linked·Link");
    const link = fact(conditions, "Event").getByRole("button", { name: "Link", exact: true });
    await link.click();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toContainText(
      "Fictional Westport → Fictional Eastbrook · 10 Nov, 10:00–10 Nov, 18:00 · ETS2",
    );
    await expect(dialog(page)).toContainText("Times in UTC");
    // The scan stops once a page passes the trip day; the next cursor is not read.
    await expect.poll(() => reads.length).toBe(2);
    for (const [index, search] of reads.entries()) {
      const query = new URLSearchParams(search);
      expect(query.get("period")).toBe("past");
      expect(query.get("limit")).toBe("100");
      expect(query.get("cursor")).toBe(index === 0 ? null : "cursor-2");
    }

    const tabs = dialog(page).getByRole("group", { name: "Events to show" });
    await expect(tabs.getByRole("button", { name: "On the trip day" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Newest first; another game and a cancelled event are never offered.
    expect(await optionNames(page)).toEqual([events.sameDay.title, events.match.title]);
    const matchCard = dialog(page).locator(".trip-event-option", { hasText: events.match.title });
    await expect(matchCard).toContainText(
      "10 Nov, 09:00 · Fictional Westport → Fictional Eastbrook",
    );
    await expect(matchCard.getByText("Route matches", { exact: true })).toBeVisible();
    await expect(
      dialog(page).locator(".trip-event-option", { hasText: events.sameDay.title }),
    ).toContainText(`10 Nov, 20:00 · ${events.sameDay.route}`);
    await expect(dialog(page).getByText("Route matches", { exact: true })).toHaveCount(1);
    await expect(dialog(page).getByText("Only part of the list is loaded.")).toHaveCount(0);

    const submit = dialog(page).getByRole("button", { name: "Link", exact: true });
    await expect(submit).toBeDisabled();
    await matchCard.click();
    await expect(options(page).nth(1)).toBeChecked();
    await expect(submit).toBeEnabled();
    const consequence = dialog(page).locator(".trip-event-consequence");
    await expect(consequence).toHaveText(
      "The trip is linked at once and checked again. You signed up, but attendance is not confirmed yet; until then the level limits apply.",
    );
    // Native radios move the selection with the arrow keys.
    await page.keyboard.press("ArrowUp");
    await expect(options(page).nth(0)).toBeChecked();
    await expect(options(page).nth(0)).toBeFocused();
    await expect(consequence).toContainText("You did not sign up and attendance is not confirmed");
    const help = await openTip(page, consequence, "How linking works");
    await expect(help).toContainText("Linking is not attendance");
    await expect(help).toContainText("RSVP does not prove attendance");
    await closeTip(page);

    // All past events, then the rest of the list on demand.
    await tabs.getByRole("button", { name: "All past" }).click();
    expect(await optionNames(page)).toEqual([
      events.later.title,
      events.sameDay.title,
      events.match.title,
      events.older.title,
    ]);
    await expect(dialog(page).getByText("Only part of the list is loaded.")).toBeVisible();
    await dialog(page).getByRole("button", { name: "Load more events" }).click();
    await expect(dialog(page).getByText("Only part of the list is loaded.")).toHaveCount(0);
    // Past the trip day, one Load more reads the full batch budget, not a single page.
    expect(reads.slice(-2).map((search) => new URLSearchParams(search).get("cursor"))).toEqual([
      "cursor-3",
      "cursor-4",
    ]);
    await dialog(page).locator(".trip-event-option", { hasText: events.older.title }).click();
    await expect(consequence).toContainText(
      "Your attendance is confirmed, so the level limits do not apply to this trip.",
    );
    // A selection outside the trip day stays visible and checked on that tab.
    await tabs.getByRole("button", { name: "On the trip day" }).click();
    expect(await optionNames(page)).toEqual([
      events.older.title,
      events.sameDay.title,
      events.match.title,
    ]);
    await expect(options(page).nth(0)).toBeChecked();

    // Cancel and Escape close without a command and return focus to the opener.
    await dialog(page).getByRole("button", { name: "Cancel" }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(link).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    await expect(link).toBeFocused();

    // Link from the menu: exactly the event ID with the trip version and an idempotency key.
    const posts: Request[] = [];
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`**/api/v1/trips/${tripPageId}/event-association`, async (route) => {
      posts.push(route.request());
      await held;
      const linked = pendingTelemetry();
      tripPrivate(linked).summary.event = { id: events.match.id, title: events.match.title };
      state.view = linked;
      await route.fulfill({
        json: { data: { id: tripPageId, version: 4 }, meta: { requestId: "synthetic" } },
        headers: { ETag: '"v4"' },
      });
    });
    const menu = await openMenu(page);
    await menu.getByRole("menuitem", { name: "Link to an event…" }).click();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).getByRole("radio").first()).toBeVisible();
    await dialog(page).locator(".trip-event-option", { hasText: events.match.title }).click();
    const before = state.calls;
    await submit.click();
    await expect.poll(() => posts.length).toBe(1);
    await expect(submit).toBeDisabled();
    await expect(dialog(page).getByRole("button", { name: "Cancel" })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeVisible();
    release();
    await expect(dialog(page)).toHaveCount(0);
    await expect(
      page.getByRole("status").filter({ hasText: "The trip is linked to the event." }),
    ).toBeVisible();
    await expect(menuButton(page)).toBeFocused();
    await expect.poll(() => state.calls).toBeGreaterThan(before);
    await expect(fact(region(page, "Conditions"), "Event")).toHaveText(
      `${events.match.title}·Change`,
    );
    expect(posts).toHaveLength(1);
    const [post] = posts;
    if (!post) throw new Error("POST_MISSING");
    expect(post.postDataJSON()).toEqual({ eventId: events.match.id });
    expect(post.headers()["if-match"]).toBe('"v1"');
    expect(post.headers()["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
  },
);

test(
  "the event dialog explains decided trips, keeps the selection on conflict and recovers failed reads",
  browserCase(["@functional"]),
  async ({ page }) => {
    // The accepted trip is linked to an event outside the loaded list.
    await author(page, acceptedTelemetry());
    const served = await serveEvents(
      page,
      // The first batch stops after an event past the trip day, leaving a cursor the server rejects.
      { "": { items: [events.older, events.later], next: "stale" } },
      {
        [events.older.id]: eventMember(events.older, "not_attended", "participating"),
        [tripEventId]: eventMember(
          { ...events.older, id: tripEventId, title: "Fictional Winter Convoy" },
          "attended",
        ),
      },
    );
    let conflicts = 0;
    await page.route(`**/api/v1/trips/${tripPageId}/event-association`, (route) => {
      conflicts++;
      return route.fulfill({ status: 409, json: { error: { code: "VERSION_CONFLICT" } } });
    });
    await page.goto(tripPath);
    await catalogLanguage(page);
    await loaded(page);
    await fact(region(page, "Conditions"), "Event").getByRole("button", { name: "Change" }).click();
    await expect(dialog(page)).toBeVisible();
    // Nothing of the loaded list started on the trip day; the current event is still offered.
    const current = dialog(page).locator(".trip-event-option", {
      hasText: "Fictional Winter Convoy",
    });
    await expect(current).toContainText("Linked now");
    await expect(current.getByRole("radio")).toBeChecked();
    const consequence = dialog(page).locator(".trip-event-consequence");
    await expect(consequence).toHaveText(
      "The trip is already decided, so staff will review the link; the current result stays until then. Your attendance is confirmed, so the level limits do not apply to this trip.",
    );
    // The preselected linked event is not a change: Link stays disabled until another is picked.
    const submit = dialog(page).getByRole("button", { name: "Link", exact: true });
    await expect(submit).toBeDisabled();
    await dialog(page).getByRole("button", { name: "All past" }).click();
    await dialog(page).locator(".trip-event-option", { hasText: events.later.title }).click();
    await expect(submit).toBeEnabled();
    await current.click();
    await expect(current.getByRole("radio")).toBeChecked();
    await expect(submit).toBeDisabled();
    await submit.click({ force: true });
    expect(conflicts).toBe(0);

    // A rejected (stale) cursor shows a safe failure; Refresh starts over from the first page.
    await dialog(page).getByRole("button", { name: "All past" }).click();
    await dialog(page).locator(".trip-event-option", { hasText: events.older.title }).click();
    await expect(consequence).toContainText("Staff recorded that you did not attend");
    await dialog(page).getByRole("button", { name: "Load more events" }).click();
    await expect(dialog(page).getByRole("alert")).toContainText("The record changed.");
    await expect(dialog(page).getByRole("button", { name: "Refresh", exact: true })).toBeVisible();
    await expect(dialog(page)).not.toContainText("VERSION_CONFLICT");
    const readsBefore = served.reads.length;
    await dialog(page).getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(dialog(page).getByRole("alert")).toHaveCount(0);
    expect(new URLSearchParams(served.reads[readsBefore]).get("cursor")).toBeNull();

    // A conflicting link keeps the dialog and the selection and explains the conflict.
    await dialog(page).locator(".trip-event-option", { hasText: events.older.title }).click();
    await dialog(page).getByRole("button", { name: "Link", exact: true }).click();
    await expect(dialog(page).getByRole("alert")).toContainText("The record changed.");
    await expect(
      dialog(page)
        .locator(".trip-event-option", { hasText: events.older.title })
        .getByRole("radio"),
    ).toBeChecked();
    expect(conflicts).toBe(1);
    await page.keyboard.press("Escape");

    // A failed list read is a safe alert with Refresh.
    served.control.status = 503;
    await fact(region(page, "Conditions"), "Event").getByRole("button", { name: "Change" }).click();
    await expect(dialog(page).getByRole("alert")).toContainText("The service is unavailable");
    await expect(dialog(page)).not.toContainText("PRIVATE_SENTINEL");
    served.control.status = 200;
    await dialog(page).getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(dialog(page).getByRole("alert")).toHaveCount(0);
    await expect(dialog(page).getByText("Linked now")).toBeVisible();
  },
);

test(
  "an incomplete scan never claims that no events exist",
  browserCase(["@functional"]),
  async ({ page }) => {
    await author(page, pendingTelemetry());
    // Five empty pages fill the first batch and still leave a cursor.
    const empty = (next: string) => ({ items: [], next });
    const { reads } = await serveEvents(page, {
      "": empty("c1"),
      c1: empty("c2"),
      c2: empty("c3"),
      c3: empty("c4"),
      c4: empty("c5"),
      c5: { items: [events.match], next: null },
    });
    await page.goto(tripPath);
    await catalogLanguage(page);
    await loaded(page);
    await fact(region(page, "Conditions"), "Event").getByRole("button", { name: "Link" }).click();
    await expect.poll(() => reads.length).toBe(5);
    for (const tab of ["On the trip day", "All past"]) {
      await dialog(page).getByRole("button", { name: tab, exact: true }).click();
      await expect(options(page)).toHaveCount(0);
      await expect(dialog(page)).toContainText("Nothing found in the loaded part yet.");
      await expect(dialog(page)).not.toContainText(
        "No events of this game started on the trip day.",
      );
      await expect(dialog(page)).not.toContainText("No past events of this game.");
      await expect(dialog(page).getByText("Only part of the list is loaded.")).toBeVisible();
    }
    await dialog(page).getByRole("button", { name: "Load more events" }).click();
    await expect(options(page)).toHaveCount(1);
    expect(new URLSearchParams(reads.at(-1)).get("cursor")).toBe("c5");
    await expect(dialog(page).getByText("Only part of the list is loaded.")).toHaveCount(0);
    await expect(dialog(page)).not.toContainText("Nothing found in the loaded part yet.");
  },
);

test(
  "a successful link of a decided trip is announced as sent for review",
  browserCase(["@functional"]),
  async ({ page }) => {
    await author(page, acceptedTelemetry("no-event"));
    const sameRouteLater = fictionalEvent(7, "2026-11-12T12:00:00.000Z", { sameRoute: true });
    await serveEvents(page, { "": { items: [events.older, sameRouteLater], next: null } });
    await page.route(`**/api/v1/trips/${tripPageId}/event-association`, (route) =>
      route.fulfill({ json: { data: { id: tripPageId, version: 2 }, meta: { requestId: "s" } } }),
    );
    await page.goto(tripPath);
    await catalogLanguage(page, "ru");
    await loaded(page);
    await fact(region(page, "Условия"), "Мероприятие")
      .getByRole("button", { name: "Привязать", exact: true })
      .click();
    const box = page.getByRole("dialog", { name: "Привязать к мероприятию" });
    await expect(box).toContainText("Время в поясе UTC");
    // Nothing started on the trip day; the whole past list is one tab away.
    await expect(box.getByRole("radio")).toHaveCount(0);
    await expect(box).toContainText("В день рейса мероприятий этой игры не было.");
    await box.getByRole("button", { name: "Все прошедшие" }).click();
    await expect(box.getByRole("radio")).toHaveCount(2);
    const option = box.locator(".trip-event-option", { hasText: sameRouteLater.title });
    await expect(option.getByText("Совпадает маршрут", { exact: true })).toBeVisible();
    await expect(box.getByText("Совпадает маршрут", { exact: true })).toHaveCount(1);
    await option.click();
    await expect(box.locator(".trip-event-consequence")).toContainText(
      "Решение по рейсу уже есть, поэтому привязку проверит сотрудник",
    );
    await box.getByRole("button", { name: "Привязать", exact: true }).click();
    await expect(box).toHaveCount(0);
    await expect(
      page.getByRole("status").filter({ hasText: "Привязка отправлена на проверку сотруднику." }),
    ).toBeVisible();
  },
);

test(
  "the reported cargo labels use icon badges in both languages without a second info button",
  browserCase(["@layout"]),
  async ({ page }, info) => {
    const trip = acceptedTelemetry();
    const facts = tripPrivate(trip).effectiveFacts;
    if (!facts) throw new Error("EXPECTED_PRIVATE_TELEMETRY_FACTS");
    facts.cargoClassification = {
      fragile: true,
      valuable: true,
      adr: { state: "class", class: 3 },
      overweight: true,
      oversize: null,
      groups: ["liquid", "refrigerated"],
    };
    await author(page, trip);
    await page.goto(tripPath);
    for (const [locale, card, term, labels] of [
      [
        "en",
        "Cargo and trailer",
        "Properties",
        ["ADR 3", "Fragile", "Valuable", "Heavy", "Liquid", "Refrigerated"],
      ],
      [
        "ru",
        "Груз и прицеп",
        "Свойства",
        ["ADR 3", "Хрупкий", "Ценный", "Тяжёлый", "Наливной", "Рефрижератор"],
      ],
    ] as const) {
      await catalogLanguage(page, locale);
      await loaded(page);
      const properties = fact(region(page, card), term);
      await expect(properties.getByRole("listitem")).toHaveText([...labels]);
      await expect(properties.locator(".lucide")).toHaveCount(labels.length);
      await expect(properties.getByRole("button")).toHaveCount(0);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      await region(page, card).screenshot({
        path: info.outputPath(`trip-cargo-labels-${locale}.png`),
      });
    }
  },
);

/** Top edges of the visible text rectangles; a badge on one line has a single top. */
async function textLines(locator: Locator) {
  return locator.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const tops = Array.from(range.getClientRects(), (rect) => rect.top).sort((a, b) => a - b);
    return tops.filter((top, index) => index === 0 || top - (tops[index - 1] ?? top) > 4).length;
  });
}
async function box(locator: Locator) {
  const found = await locator.boundingBox();
  if (!found) throw new Error("NOT_RENDERED");
  return found;
}

test(
  "the trip page fits phone, tablet and desktop in RU and EN with the route and strip per width",
  browserCase(["@layout"]),
  async ({ page }, info) => {
    const width = page.viewportSize()?.width ?? 0;
    const long = withRoute(longValues());
    const longSummary = tripPrivate(long).summary;
    if (longSummary.origin) longSummary.origin.label = "Fictional Westport-on-the-Long-Bay";
    const { state } = await author(page, acceptedTelemetry());
    await serveEvents(page, {
      "": {
        items: Array.from({ length: 12 }, (_, i) =>
          fictionalEvent(10 + i, `2026-11-10T0${i % 10}:15:00.000Z`, {
            sameRoute: i % 3 === 0,
            title: `${longEventTitle} ${i}`,
          }),
        ),
        next: null,
      },
    });
    await page.goto(tripPath);
    for (const [name, view] of [
      ["accepted", () => acceptedTelemetry()],
      ["no-revenue", () => acceptedTelemetry("no-revenue")],
      ["no-labels", () => acceptedTelemetry("no-labels")],
      ["needs-fix", () => withRoute(needsFixManual())],
      ["long", () => structuredClone(long)],
    ] as const) {
      state.view = view();
      for (const locale of ["en", "ru"] as const) {
        await page.reload();
        await catalogLanguage(page, locale);
        await loaded(page);
        await page.evaluate(() => document.fonts.ready);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        for (const overflow of await page
          .locator(".trip-detail .card")
          .evaluateAll((cards) => cards.map((el) => el.scrollWidth - el.clientWidth)))
          expect(overflow).toBeLessThanOrEqual(0);
        expect(await textLines(status(page))).toBe(1);

        const origin = await box(page.locator(".trip-route-end[data-side=origin]"));
        const destination = await box(page.locator(".trip-route-end[data-side=destination]"));
        if (width < 560) expect(destination.y).toBeGreaterThanOrEqual(origin.y + origin.height - 1);
        else expect(destination.x).toBeGreaterThanOrEqual(origin.x + origin.width - 1);
        const cells = await page
          .locator(".trip-route-strip > div")
          .evaluateAll((items) => items.map((el) => Math.round(el.getBoundingClientRect().top)));
        if (width >= 1280) expect(new Set(cells).size).toBe(1);
        if (width < 560 && cells.length === 4) {
          expect(cells[0]).toBe(cells[1]);
          expect(cells[2]).toBe(cells[3]);
          expect(cells[2]).toBeGreaterThan(cells[0] ?? 0);
        }
        if (name === "long") {
          await expect(page.locator(".trip-route")).toContainText(longCompanyName);
          // All six limits, including the cargo damage cap, fit once the rules are shown.
          const check = page.locator(".trip-qualification");
          await check
            .getByRole("button", { name: locale === "en" ? "Show rules" : "Показать правила" })
            .click();
          await expect(check.getByRole("listitem")).toHaveCount(6);
          await expect(check).toContainText(locale === "en" ? "37.5%" : "37,5%");
        }
        if (name === "needs-fix") {
          const section = await box(page.locator(".trip-banner"));
          const action = await box(page.locator(".trip-banner-action"));
          if (width < 560) expect(action.width).toBeGreaterThanOrEqual(section.width - 40);
          else expect(action.width).toBeLessThan(section.width / 2);
        }
        await capture(page, info, `trip-page-${name}-${locale}-${width}`);
      }
    }

    // The open dialog fits a phone: scrolling list, visible actions.
    state.view = pendingTelemetry();
    await page.reload();
    await catalogLanguage(page);
    await loaded(page);
    await fact(region(page, "Conditions"), "Event").getByRole("button", { name: "Link" }).click();
    await expect(options(page)).toHaveCount(12);
    const frame = await box(dialog(page));
    const viewport = page.viewportSize();
    if (!viewport) throw new Error("VIEWPORT_MISSING");
    expect(frame.x).toBeGreaterThanOrEqual(0);
    expect(frame.x + frame.width).toBeLessThanOrEqual(viewport.width);
    expect(frame.y + frame.height).toBeLessThanOrEqual(viewport.height);
    for (const name of ["Cancel", "Link"])
      await expect(dialog(page).getByRole("button", { name, exact: true })).toBeInViewport();
    const list = dialog(page).locator(".trip-event-options");
    // The list scrolls inside its own box; it never runs under the actions.
    const listBox = await box(list);
    const actions = await box(dialog(page).locator(".trip-event-actions"));
    expect(listBox.y + listBox.height).toBeLessThanOrEqual(actions.y);
    if (width < 1280)
      expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    expect(await dialog(page).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`trip-event-dialog-${width}.png`) });
  },
);

/** Full-height capture without `fullPage`, which briefly resizes headless Chrome. */
async function capture(page: Page, info: TestInfo, name: string) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("VIEWPORT_MISSING");
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: viewport.width, height: Math.max(height, viewport.height) });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath(`${name}.png`) });
  await page.setViewportSize(viewport);
}
