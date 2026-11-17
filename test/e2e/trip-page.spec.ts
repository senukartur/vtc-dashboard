import type { Locator, Page, TestInfo } from "@playwright/test";
import { accountFixture } from "../../apps/web/src/features/account/fixtures.ts";
import { catalogLanguage } from "./support/catalogs.ts";
import { browserCase, expect, test } from "./support/fixtures.ts";
import {
  asOtherMember,
  longCompanyName,
  longEventTitle,
  longTrailerLabel,
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
  telemetryWithEvent,
  tripEventId,
  tripPageId,
  tripPrivate,
  withoutSources,
  withTrailer,
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
/** Waits for the trip tiles and asserts that no load failure is announced. */
async function loaded(page: Page) {
  await expect(page.locator(".trip-detail-tiles")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
}
const region = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const tripCard = (page: Page, name = "Trip") => region(page, name);
/** The definition next to an exact term inside `scope`. */
const fact = (scope: Locator, term: string) =>
  scope.locator(`dt:text-is(${JSON.stringify(term)}) + dd`);
/** One summary tile by its label. */
const tile = (page: Page, label: string) =>
  page
    .locator(".trip-detail-tile")
    .filter({ has: page.locator(`.trip-detail-tile-label:text-is(${JSON.stringify(label)})`) });
const status = (page: Page) => page.locator(".trip-detail-status");
const logoRequests = (requests: string[]) => requests.filter((path) => path.endsWith("/logo"));
const privatePaths = /\/review|\/reconciliations|\/proposals|\/manual-revisions|\/manual-reports/;
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
/** Visible page text without identifiers, raw timestamps, file details or raw codes. */
async function expectHumanText(page: Page, forbidden: (string | RegExp)[] = []) {
  const text = await page.locator("main").innerText();
  for (const pattern of [
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    /\d{4}-\d{2}-\d{2}T/,
    "image/png",
    "SYNTHETIC_",
    "manual_report",
    "qualification_level_unknown",
    ...forbidden,
  ])
    if (typeof pattern === "string") expect(text).not.toContain(pattern);
    else expect(text).not.toMatch(pattern);
}

test(
  "F1 telemetry trip shows its status, tiles, companies, damage, event link and five limits",
  browserCase(["@functional"]),
  async ({ page }) => {
    const { state, requests } = await author(page, withTrailer());
    await page.goto(tripPath);
    await catalogLanguage(page);
    await loaded(page);

    await expect(status(page)).toHaveText("✓Accepted");
    await expect(page.locator(".trip-detail-meta")).toHaveText(
      "ETS2 · Telemetry · completed 10 Nov, 18:00",
    );
    // The shell breadcrumb is the only one; the page does not repeat it.
    const crumb = page.getByRole("navigation", { name: "Breadcrumb", exact: true });
    await expect(page.getByRole("main").getByRole("navigation")).toHaveCount(0);
    await expect(crumb.getByRole("link", { name: "My trips", exact: true })).toHaveAttribute(
      "href",
      "/account/trips",
    );
    await expect(tile(page, "Distance")).toContainText("812.4005 km");
    await expect(tile(page, "Distance")).toContainText("by telemetry");
    await expect(tile(page, "Distance")).not.toContainText("no telemetry");
    await expect(tile(page, "Credited")).toContainText("Yes");
    await expect(tile(page, "Credited")).toContainText("counted on 10 Nov, 18:00");
    await expect(page.getByText("Reporting instant", { exact: true })).toHaveCount(0);
    const basis = await openTip(page, tile(page, "Credited"), "How the trip is counted");
    await expect(basis).toContainText("company reporting time zone");
    await closeTip(page);
    await expect(tile(page, "What next")).toContainText("Nothing to do");
    await expect(tile(page, "What next")).toContainText("The trip is counted.");
    await expect(tile(page, "What next")).not.toHaveAttribute("data-attention");

    const sources = region(page, "Sources");
    const items = sources.getByRole("listitem");
    await expect(items).toHaveCount(1);
    await expect(items.locator(".trip-source-head strong")).toHaveText("Telemetry");
    await expect(fact(items, "Received")).toHaveText(/10 Nov 2026.*18:00/);
    await expect(fact(items, "Driven distance")).toHaveText("812.4005 km");
    await expect(fact(items, "Source outcome")).toHaveText("Delivered");
    await expect(items.getByText("Used for the trip", { exact: true })).toBeVisible();
    await expect(sources).toContainText("Times in UTC");

    const card = tripCard(page);
    const sender = fact(card, "From");
    await expect(sender).toContainText("Fictional Logistics");
    await expect(sender).toContainText("fict_logistics");
    await expect(sender.locator(".company-logo")).toHaveAttribute("data-logo", "image");
    await expect
      .poll(() =>
        sender.locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth),
      )
      .toBeGreaterThan(0);
    const receiver = fact(card, "To");
    await expect(receiver).toContainText("Fictional Port Services");
    await expect(receiver).toContainText("fict_port");
    await expect(receiver.locator(".company-logo")).toHaveAttribute("data-logo", "placeholder");
    await expect(receiver.locator("img")).toHaveCount(0);
    expect(logoRequests(requests)).toEqual([`/api/v1/catalogs/companies/${senderCompanyId}/logo`]);
    await expect(fact(card, "Cargo")).toContainText("19 t");
    await expect(fact(card, "Trailer")).toHaveText("Fictional trailer_type");
    await expect(fact(card, "Started")).toHaveText("10 Nov 2026, 10:00");
    await expect(fact(card, "Completed").locator("time")).toHaveAttribute(
      "datetime",
      "2026-11-10T18:00:00.000Z",
    );
    await expect(fact(card, "Damage")).toHaveText("37.5 % of cargo");
    await expect(fact(card, "Event").getByRole("link")).toHaveText("Fictional Winter Convoy");
    await expect(fact(card, "Event").getByRole("link")).toHaveAttribute(
      "href",
      `/account/events/${tripEventId}`,
    );
    await expect(card).toContainText("Times in UTC");

    const history = region(page, "History");
    await expect(history.getByRole("listitem")).toHaveCount(1);
    await expect(history).toContainText("Telemetry received");

    const check = region(page, "Qualification check");
    await expect(check).toContainText("Checked against “Fictional Trainee” · As at the decision");
    const rules = check.getByRole("listitem");
    await expect(rules).toHaveCount(5);
    for (const [index, result] of ["pass", "pass", "fail", "pass", "pass"].entries())
      await expect(rules.nth(index)).toHaveAttribute("data-result", result);
    await expect(rules.nth(0).locator(".qualification-check-symbol")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    await expect(rules.nth(0)).toContainText("Cargo mass · Passes");
    await expect(rules.nth(0)).toContainText("Trip: 19 t · Limit: up to 20 t");
    await expect(rules.nth(1)).toContainText("Trip distance · Passes");
    await expect(rules.nth(2)).toContainText("Trailer types · Outside the limit");
    await expect(rules.nth(2)).toContainText(
      "Trip: Fictional Tanker · Limit: Fictional Curtainsider",
    );
    await expect(rules.nth(3)).toContainText("Trip: not ADR · Limit: Forbidden");
    await expect(rules.nth(4)).toContainText("Hard Mode · Passes");
    await expect(rules.nth(4).locator("svg.flame-icon")).toBeVisible();
    await expect(rules.nth(4)).toContainText("Trip: unknown · Limit: Not required");

    // The author sees no reviewer-only workspace, technical details or reconciliation data.
    await expect(page.getByRole("link", { name: "Review workspace", exact: true })).toHaveCount(0);
    await expect(page.getByText("Technical details", { exact: true })).toHaveCount(0);
    expect(requests.filter((path) => privatePaths.test(path))).toEqual([]);

    state.status = 403;
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("permissions");
    for (const name of ["Sources", "Qualification check", "Trip", "History", "Summary"])
      await expect(region(page, name)).toHaveCount(0);
    const deniedCalls = state.calls;
    await page.waitForTimeout(250);
    expect(state.calls).toBe(deniedCalls);
  },
);

test(
  "F2 manual trip keeps unknown values muted and explained, apart from zero, and hides a missing check",
  browserCase(["@functional"]),
  async ({ page }) => {
    const { state, requests } = await author(page, manualUnknown());
    await page.goto(tripPath);
    await catalogLanguage(page);
    await loaded(page);

    await expect(status(page)).toHaveText("●Pending review");
    await expect(tile(page, "Distance")).toContainText("500 km");
    await expect(tile(page, "Distance")).toContainText("by the report · no telemetry");
    await expect(tile(page, "Credited")).toContainText("Not yet");
    await expect(tile(page, "Credited")).toContainText("counts after acceptance");
    const item = region(page, "Sources").getByRole("listitem");
    await expect(item).toHaveCount(1);
    await expect(item.locator(".trip-source-head strong")).toHaveText("Manual report");
    await expect(fact(item, "Driven distance")).toHaveText("Unavailable");
    await expect(item).not.toContainText("0 km");

    const card = tripCard(page);
    const sender = fact(card, "From");
    await expect(sender).toContainText("Unknown company");
    await expect(sender).toContainText("fict_unknown_depot");
    // Without a provider code the company counts as missing: the place reads as the city alone.
    const receiver = fact(card, "To");
    await expect(receiver.locator(".trip-company")).toHaveCount(0);
    await expect(receiver).not.toContainText("Unknown company");
    await expect(receiver).not.toContainText("Not specified");
    await expect(receiver).not.toContainText("·");
    await expect(page.locator(".company-logo")).toHaveCount(0);
    await expect(card.locator("img")).toHaveCount(0);
    const damage = fact(card, "Damage");
    await expect(damage).toHaveText("Unavailable");
    await expect(damage).not.toContainText("0 %");
    await expect(await openTip(page, damage, "Why is this unknown?")).toHaveText(
      "This value is unavailable. It is not zero.",
    );
    await closeTip(page);
    await expect(fact(card, "Event")).toHaveText("Not linked");
    for (const term of ["Game mode", "Job type"]) {
      await expect(fact(card, term)).toHaveText("Unknown");
      await expect(fact(card, term).locator(".trip-detail-unknown")).toBeVisible();
      await expect(await openTip(page, fact(card, term), "Why is this unknown?")).toHaveText(
        "Manual report: telemetry did not record this trip.",
      );
      await closeTip(page);
    }

    const check = region(page, "Qualification check");
    await expect(check).toContainText("The driver's level at trip time is unknown");
    await expect(check.getByRole("listitem")).toHaveCount(0);
    await expect(page.getByText("qualification_level_unknown")).toHaveCount(0);
    const next = tile(page, "What next");
    await expect(next).toContainText("Nothing to do");
    // The unknown review code reads as a generic reason, never as the raw code.
    await expect(await openTip(page, next, "Why it is held")).toContainText("Other reason");
    await closeTip(page);
    await expect(page.getByText("manual_report")).toHaveCount(0);

    // Unknown distance is unavailable with an explanation, never zero.
    const unknownDistance = manualUnknown();
    tripPrivate(unknownDistance).summary.actualDistanceM = null;
    state.view = unknownDistance;
    await page.reload();
    await loaded(page);
    await expect(tile(page, "Distance")).toContainText("Unavailable");
    await expect(tile(page, "Distance")).not.toContainText("0 km");
    await expect(await openTip(page, tile(page, "Distance"), "Why is this unknown?")).toContainText(
      "not zero",
    );
    await closeTip(page);

    // Current production sends no check: nothing renders, not even an empty state.
    state.view = manualUnknown("no-check");
    await page.reload();
    await loaded(page);
    await expect(region(page, "Sources")).toBeVisible();
    await expect(region(page, "Qualification check")).toHaveCount(0);
    await expect(page.getByText("Qualification check", { exact: true })).toHaveCount(0);

    state.view = manualUnknown("event-exempt");
    await page.reload();
    await loaded(page);
    await expect(region(page, "Qualification check")).toContainText(
      "A company event trip — credited without the qualification check",
    );
    await expect(region(page, "Qualification check").getByRole("listitem")).toHaveCount(0);

    state.view = manualUnknown("zero-damage");
    await page.reload();
    await loaded(page);
    await expect(fact(tripCard(page), "Damage")).toHaveText("0 % of cargo");

    state.view = manualUnknown("no-company");
    await page.reload();
    await loaded(page);
    const origin = fact(tripCard(page), "From");
    await expect(origin.locator(".trip-company")).toHaveCount(0);
    await expect(origin).not.toContainText("Not specified");
    await expect(origin).not.toContainText("·");
    expect(logoRequests(requests)).toEqual([]);
  },
);

test(
  "F3 reconciled accepted trip lists both sources in order and falls back from a failed logo",
  browserCase(["@functional"]),
  async ({ page }) => {
    await author(page, reconciledAccepted(), null);
    await page.route(new RegExp(`/api/v1/catalogs/companies/${senderCompanyId}/logo`), (route) =>
      route.fulfill({ status: 500, json: { error: { code: "PRIVATE_SENTINEL" } } }),
    );
    await page.goto(tripPath);
    await catalogLanguage(page);
    await loaded(page);

    const sources = region(page, "Sources");
    const items = sources.getByRole("listitem");
    await expect(items.locator(".trip-source-head strong")).toHaveText([
      "Telemetry",
      "Manual report",
    ]);
    await expect(sources.getByText("Used for the trip", { exact: true })).toHaveCount(1);
    await expect(items.nth(0).getByText("Used for the trip", { exact: true })).toBeVisible();
    await expect(fact(items.nth(0), "Driven distance")).toHaveText("812.4005 km");
    await expect(fact(items.nth(1), "Driven distance")).toHaveText("810 km");
    await expect(fact(items.nth(1), "Source outcome")).toHaveText("Delivered");
    // A null saved zone follows the device, exactly like the trip block.
    await expect(tripCard(page)).toContainText(`Times in ${deviceZone}`);
    await expect(sources).toContainText(`Times in ${deviceZone}`);
    await expect(fact(items.nth(0), "Received")).toHaveText(/11 Nov 2026.*03:00/);
    await expect(page.locator(".trip-detail-meta")).toContainText("Telemetry + Manual report");

    const sender = fact(tripCard(page), "From");
    await expect(sender.locator(".company-logo")).toHaveAttribute("data-logo", "placeholder");
    await expect(sender).toContainText("Fictional Logistics");
    await expect(tripCard(page).locator("img")).toHaveCount(0);
    await expect(page.getByText("PRIVATE_SENTINEL")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Request correction", exact: true }),
    ).toBeVisible();
  },
);

test(
  "F4 a rejected trip shows the reason in History; a revisable report needs fixes instead",
  browserCase(["@functional"]),
  async ({ page }) => {
    const { state } = await author(page, returnedTrip());
    await page.goto(tripPath);
    await catalogLanguage(page);
    await loaded(page);

    // Without a report to revise the trip is rejected, not returned for fixes.
    await expect(status(page)).toHaveText("✕Rejected");
    await expect(page.getByRole("link", { name: "Fix the report", exact: true })).toHaveCount(0);
    await expect(tile(page, "Credited")).toContainText("No");
    await expect(tile(page, "What next")).toContainText("Not counted");
    await expect(tile(page, "What next")).toContainText(
      `Fictional Stage Four Dispatcher: "${returnedReason}"`,
    );
    const history = region(page, "History");
    await expect(history.getByRole("listitem")).toHaveCount(2);
    const rejection = history.getByRole("listitem").nth(1);
    await expect(rejection).toContainText("Rejected");
    await expect(rejection).toContainText("11 Nov, 10:00 · Fictional Stage Four Dispatcher");
    await expect(rejection).toContainText(`"${returnedReason}"`);
    await expect(region(page, "Sources").getByRole("listitem")).toHaveCount(2);
    const rules = region(page, "Qualification check").getByRole("listitem");
    await expect(rules).toHaveCount(5);
    // Selected limits without entries are named, never left blank.
    await expect(rules.nth(2)).toContainText("Trip: Fictional Tanker · Limit: Only selected");
    await expect(rules.nth(3)).toHaveAttribute("data-result", "fail");
    await expect(rules.nth(3)).toContainText(
      "Trip: 3 · Flammable liquids · Limit: Selected classes",
    );
    await expect(fact(tripCard(page), "From")).toContainText("Fictional Logistics");
    await expect(
      page.getByRole("heading", { name: "Request correction", exact: true }),
    ).toHaveCount(0);

    state.view = needsFixManual();
    await page.reload();
    await loaded(page);
    await expect(status(page)).toHaveText("!Needs fixes");
    const returned = region(page, "History").getByRole("listitem");
    await expect(returned).toHaveCount(3);
    await expect(returned.nth(0)).toContainText("Report submitted");
    await expect(returned.nth(1)).toContainText("Rejected");
    await expect(returned.nth(1)).toContainText("System");
    await expect(returned.nth(2)).toContainText("Returned for fixes");
    await expect(returned.nth(2)).toContainText(`"${needsFixReason}"`);
    await expect(returned.nth(2)).toContainText("Other reason, No completion screenshot");
  },
);

test(
  "F5 older private views and company summaries show no Stage 4 blocks; no sources is explained",
  browserCase(["@functional"]),
  async ({ page }) => {
    const { state, requests } = await author(page, olderPrivate("private-recorded-telemetry"));
    await page.goto(tripPath);
    await catalogLanguage(page);
    for (const step of ["private-recorded-telemetry", "extended-manual-revision"] as const) {
      if (step !== "private-recorded-telemetry") {
        state.view = olderPrivate(step);
        await page.reload();
      }
      await loaded(page);
      await expect(tripCard(page)).toBeVisible();
      await expect(region(page, "History")).toBeVisible();
      await expect(region(page, "Sources")).toHaveCount(0);
      await expect(region(page, "Qualification check")).toHaveCount(0);
      await expect(page.locator(".trip-company")).toHaveCount(0);
      await expect(page.getByText("Accepted company summary", { exact: true })).toHaveCount(0);
    }
    // The older manual report can still be revised; its screenshots card explains none is ready.
    await expect(
      page.getByRole("link", { name: "Revise and resubmit", exact: true }),
    ).toHaveAttribute("href", "/account/reports/51000000-0000-4000-8000-000000000009/edit");
    await expect(region(page, "Completion screenshots")).toContainText(
      "No screenshots are attached.",
    );

    state.view = otherSummary();
    await page.reload();
    await loaded(page);
    await expect(page.getByText("Accepted company summary", { exact: true })).toBeVisible();
    await expect(page.locator(".trip-detail-tile")).toHaveCount(2);
    await expect(tile(page, "What next")).toHaveCount(0);
    await expect(page.locator(".trip-detail-aside")).toHaveCount(0);
    await expect(page.locator(".trip-detail-meta")).toContainText("Driver: Fictional Other Driver");
    const card = tripCard(page);
    await expect(card.locator("dt")).toHaveText(["From", "To", "Cargo"]);
    for (const name of ["Sources", "Qualification check", "History", "Completion screenshots"])
      await expect(region(page, name)).toHaveCount(0);
    expect(
      requests.filter((path) => privatePaths.test(path) || path.includes("/evidence")),
    ).toEqual([]);

    state.view = withoutSources();
    await page.reload();
    await loaded(page);
    const sources = region(page, "Sources");
    await expect(sources).toContainText("No sources are recorded for this trip.");
    await expect(sources.getByRole("listitem")).toHaveCount(0);
  },
);

test(
  "R1 the author sees a human trip page while staff get collapsed technical details",
  browserCase(["@functional"]),
  async ({ page }) => {
    const { state, requests } = await author(page, needsFixManual());
    await page.goto(tripPath);
    await catalogLanguage(page);
    await loaded(page);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Fictional Westport → Fictional Eastbrook",
    );
    await expect(page.locator(".trip-detail-meta")).toHaveText(
      "Trip #1044 · ETS2 · Manual report · completed 10 Nov, 18:00",
    );
    await expect(page.getByRole("main").getByRole("navigation")).toHaveCount(0);
    // The effective fact names no receiving company, so the place is the city alone.
    const receiver = fact(tripCard(page), "To");
    await expect(receiver).toHaveText("Fictional Eastbrook");
    await expect(
      page.getByRole("complementary", { name: "Trip history and check", exact: true }),
    ).toContainText("History");
    const fix = page.getByRole("link", { name: "Fix the report", exact: true });
    await expect(fix).toHaveAttribute("href", `/account/reports/${needsFixReportId}/edit`);
    const next = tile(page, "What next");
    await expect(next).toHaveAttribute("data-attention", "true");
    await expect(next).toContainText(`Fictional Stage Four Dispatcher: "${needsFixReason}"`);
    const shots = region(page, "Completion screenshots");
    await expect(shots).toContainText("Screenshots: 1");
    await expect(shots).toContainText(needsFixEvidence.originalName);
    await expect(shots).toContainText("Ready");
    await expect(shots.getByRole("button", { name: "View Evidence 1", exact: true })).toBeVisible();
    // The author sees the retention notice under the screenshots, not only staff details.
    await expect(shots.getByText(retentionNotice, { exact: true })).toBeVisible();
    await expect(fact(tripCard(page), "Trailer")).toHaveText("Fictional trailer_type");
    await expect(fact(tripCard(page), "Damage")).toHaveText("12.5 % of cargo");
    for (const hidden of [
      "Technical details",
      "Private report and review history",
      "Reconciliation history",
    ])
      await expect(page.getByText(hidden, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Review workspace", exact: true })).toHaveCount(0);
    await expectHumanText(page, [String(needsFixEvidence.byteLength)]);

    // Without an effective fact the report's trailer and damage stand in, marked as reported.
    state.view = needsFixManual("no-fact");
    await page.reload();
    await loaded(page);
    const trailer = fact(tripCard(page), "Trailer");
    await expect(trailer).toContainText("Fictional trailer_type");
    await expect(trailer).toContainText("by the report");
    const reportedDamage = fact(tripCard(page), "Damage");
    await expect(reportedDamage).toContainText("12.5 % of cargo");
    await expect(reportedDamage).toContainText("by the report");
    await expect(await openTip(page, reportedDamage, "About values from the report")).toHaveText(
      "The driver stated this in the manual report. Staff confirmation determines reporting and qualification.",
    );
    await closeTip(page);
    // An explicit unknown from the server is not replaced by the report's damage.
    state.view = needsFixManual("unknown-damage");
    await page.reload();
    await loaded(page);
    await expect(fact(tripCard(page), "Damage")).toHaveText("Unavailable");

    // A manual report without screenshots keeps the card but has nothing to retain.
    const bare = needsFixManual();
    tripPrivate(bare).evidence = [];
    state.view = bare;
    await page.reload();
    await loaded(page);
    await expect(region(page, "Completion screenshots")).toBeVisible();
    await expect(page.getByText(retentionNotice, { exact: true })).toHaveCount(0);

    state.view = telemetryWithEvent();
    await page.reload();
    await loaded(page);
    await expectHumanText(page);
    expect(requests.filter((path) => privatePaths.test(path))).toEqual([]);

    // Staff reading another member's trip: the review link and collapsed technical details.
    await page.unrouteAll({ behavior: "ignoreErrors" });
    const staff = await author(page, asOtherMember(needsFixManual()), "UTC", true);
    await page.reload();
    await loaded(page);
    await expect(page.getByRole("link", { name: "Review workspace", exact: true })).toHaveAttribute(
      "href",
      `/account/review/${tripPageId}`,
    );
    await expect(page.getByRole("link", { name: "Fix the report", exact: true })).toHaveCount(0);
    // Staff read the same status and credit as the owner; only the owner can act on the fix.
    await expect(status(page)).toHaveText("!Needs fixes");
    await expect(page.locator(".trip-detail-meta")).toContainText("Driver: Fictional Other Driver");
    await expect(tile(page, "What next")).toContainText("Waiting for the driver's fix");
    await expect(tile(page, "What next")).toContainText(
      `Fictional Stage Four Dispatcher: "${needsFixReason}"`,
    );
    await expect(tile(page, "What next")).not.toHaveAttribute("data-attention", "true");
    await expect(tile(page, "Credited")).toContainText("Not yet");
    await expect(
      region(page, "Completion screenshots").getByText(retentionNotice, { exact: true }),
    ).toBeVisible();
    const technical = page.locator("details").filter({
      has: page.locator("summary", { hasText: "Technical details" }),
    });
    await expect(technical).not.toHaveAttribute("open");
    await expect(
      page.getByText("Private report and review history", { exact: true }),
    ).toBeVisible();
    await expectHumanText(page, [String(needsFixEvidence.byteLength)]);
    await technical.locator("summary").click();
    await expect(technical).toHaveAttribute("open");
    await expect(technical.getByText(tripPageId, { exact: true })).toBeVisible();
    await expect(
      technical.getByText("41500000-0000-4000-8000-000000000310", { exact: true }).first(),
    ).toBeVisible();
    await expect(technical).toContainText(String(needsFixEvidence.byteLength));
    await expect(technical.getByText("SYNTHETIC_STAFF_REVIEW", { exact: true })).toBeVisible();
    await expect(technical.getByText("SYNTHETIC_REJECTED", { exact: true })).toBeVisible();
    expect(
      staff.requests.filter((path) => /\/manual-revisions|\/manual-reports/.test(path)),
    ).toEqual([]);
  },
);

const labels = {
  en: {
    refresh: "Refresh",
    next: "What next",
    credited: "Credited",
    held: "Why it is held",
    reason: "Other reason",
    rows: [
      ["Accepted", "Nothing to do", "Yes"],
      ["Pending review", "Nothing to do", "Not yet"],
      ["Needs fixes", "Fix the report", "Not yet"],
      ["Rejected", "Not counted", "No"],
      ["In progress", "Finish the delivery", "Not yet"],
      ["Not checked yet", "Not checked yet", "Not yet"],
      ["Cancelled", "Delivery cancelled", "No"],
    ],
  },
  ru: {
    refresh: "Обновить",
    next: "Что дальше",
    credited: "Засчитан",
    held: "Почему на проверке",
    reason: "Другая причина",
    rows: [
      ["Принят", "Ничего не нужно", "Да"],
      ["На проверке", "Ничего не нужно", "Пока нет"],
      ["Нужно исправить", "Исправьте отчёт", "Пока нет"],
      ["Отклонён", "Не засчитан", "Нет"],
      ["В пути", "Завершите доставку", "Пока нет"],
      ["Ещё не проверен", "Ещё не проверен", "Пока нет"],
      ["Отменён", "Доставка отменена", "Нет"],
    ],
  },
} as const;

test(
  "R2 every status, next step and credit state reads in words in EN and RU",
  browserCase(["@functional"]),
  async ({ page }) => {
    const unassessed = openTelemetry();
    tripPrivate(unassessed).summary.outcome = "delivered";
    const cancelled = openTelemetry();
    tripPrivate(cancelled).summary.outcome = "cancelled";
    const views = () => [
      telemetryWithEvent(),
      pendingManual(),
      needsFixManual(),
      returnedTrip(),
      openTelemetry(),
      structuredClone(unassessed),
      structuredClone(cancelled),
    ];
    const { state } = await author(page, telemetryWithEvent());
    await page.goto(tripPath);
    for (const locale of ["en", "ru"] as const) {
      await catalogLanguage(page, locale);
      const text = labels[locale];
      for (const [index, view] of views().entries()) {
        const [label, next, credited] = text.rows[index] ?? [];
        state.view = view;
        const read = page.waitForResponse((r) => r.url().endsWith(`/trips/${tripPageId}`));
        await page.getByRole("button", { name: text.refresh, exact: true }).click();
        await read;
        await expect(status(page)).toHaveText(new RegExp(`^.?${label}$`));
        await expect(tile(page, text.next).locator(".trip-detail-tile-value")).toHaveText(
          next ?? "",
        );
        await expect(tile(page, text.credited).locator(".trip-detail-tile-value")).toHaveText(
          credited ?? "",
        );
        if (index === 1) {
          const tip = await openTip(page, tile(page, text.next), text.held);
          await expect(tip).toContainText(text.reason);
          await expect(tip).not.toContainText("SYNTHETIC_");
          await closeTip(page);
        }
      }
    }
  },
);

test(
  "L1 trip page fits phone, tablet and desktop widths in RU and EN with the aside beside or below",
  browserCase(["@layout"]),
  async ({ page }, info) => {
    const { state } = await author(page, longValues());
    await page.goto(tripPath);
    const width = page.viewportSize()?.width ?? 0;
    for (const [name, view] of [
      ["long", longValues],
      ["needs-fix", needsFixManual],
    ] as const) {
      state.view = view();
      await page.reload();
      for (const locale of ["en", "ru"] as const) {
        await catalogLanguage(page, locale);
        await loaded(page);
        const labels =
          locale === "en"
            ? { trip: "Trip", sources: "Sources", check: "Qualification check", from: "From" }
            : {
                trip: "Рейс",
                sources: "Источники",
                check: "Проверка квалификации",
                from: "Откуда",
              };
        const card = tripCard(page, labels.trip);
        const sources = region(page, labels.sources);
        const check = region(page, labels.check);
        if (name === "long") {
          await expect(check.getByRole("listitem")).toHaveCount(5);
          const sender = fact(card, labels.from);
          await expect(sender).toContainText(longCompanyName);
          await expect(card).toContainText(longEventTitle);
          await expect(check).toContainText(`${longTrailerLabel}, ${longTrailerLabel}`);
          await expect(check).toContainText(`${longTrailerLabel} Tanker`);
          await expect(check.locator("svg.flame-icon")).toBeVisible();
          const plate = await sender.locator(".company-logo").boundingBox();
          const company = await sender.locator(".trip-company-name").boundingBox();
          if (!plate || !company) throw new Error("COMPANY_NOT_RENDERED");
          expect(Math.round(plate.width)).toBe(128);
          expect(Math.round(plate.height)).toBe(32);
          const overlaps =
            company.x < plate.x + plate.width &&
            plate.x < company.x + company.width &&
            company.y < plate.y + plate.height &&
            plate.y < company.y + company.height;
          expect(overlaps).toBe(false);
        }
        await expect(sources).toBeVisible();

        await page.evaluate(() => document.fonts.ready);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        for (const overflow of await page
          .locator(".trip-detail .card")
          .evaluateAll((cards) => cards.map((el) => el.scrollWidth - el.clientWidth)))
          expect(overflow).toBeLessThanOrEqual(0);

        const main = await page.locator(".trip-detail-main").boundingBox();
        const aside = await page.locator(".trip-detail-aside").boundingBox();
        if (!main || !aside) throw new Error("COLUMNS_NOT_RENDERED");
        if (width >= 1100) {
          expect(aside.x).toBeGreaterThanOrEqual(main.x + main.width - 1);
          expect(Math.abs(aside.y - main.y)).toBeLessThan(2);
        } else expect(aside.y).toBeGreaterThanOrEqual(main.y + main.height - 1);
        const tiles = await page
          .locator(".trip-detail-tile")
          .evaluateAll((items) => items.map((el) => Math.round(el.getBoundingClientRect().top)));
        expect(tiles).toHaveLength(3);
        if (width >= 1100) expect(new Set(tiles).size).toBe(1);
        if (width < 600) expect(new Set(tiles).size).toBe(3);

        // Result symbols, the effective badge and the status never wrap inside themselves.
        const states = page.locator(".qualification-check-symbol, .trip-source-effective");
        for (const lines of await states.evaluateAll((elements) =>
          elements.map((element) => {
            const range = document.createRange();
            range.selectNodeContents(element);
            return new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top))).size;
          }),
        ))
          expect(lines).toBe(1);
        // The status symbol may come from a fallback font a few pixels off the text line, so
        // tops within 4px count as one line; a wrapped status would start a line lower.
        const statusLines = await status(page).evaluate((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          const tops = Array.from(range.getClientRects(), (rect) => rect.top).sort((a, b) => a - b);
          return tops.filter((top, index) => index === 0 || top - (tops[index - 1] ?? top) > 4)
            .length;
        });
        expect(statusLines).toBe(1);
        // On phones only the primary action fills the row; secondary buttons keep their width.
        const actions = await page.locator(".trip-detail-actions").boundingBox();
        if (!actions) throw new Error("ACTIONS_NOT_RENDERED");
        const buttons = await page.locator(".trip-detail-actions > .button").evaluateAll((items) =>
          items.map((el) => ({
            primary: el.classList.contains("button-primary"),
            width: el.getBoundingClientRect().width,
          })),
        );
        expect(buttons.some(({ primary }) => !primary)).toBe(true);
        expect(buttons.some(({ primary }) => primary)).toBe(name === "needs-fix");
        if (width <= 760)
          for (const { primary, width: button } of buttons)
            if (primary) expect(button).toBeGreaterThanOrEqual(actions.width - 1);
            else expect(button).toBeLessThan(actions.width * 0.6);
        await capture(page, info, `trip-page-${name}-${locale}-${width}`);
      }
    }
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
