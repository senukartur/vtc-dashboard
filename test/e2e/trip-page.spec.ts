import type { Locator, Page, TestInfo } from "@playwright/test";
import { accountFixture } from "../../apps/web/src/features/account/fixtures.ts";
import { catalogLanguage } from "./support/catalogs.ts";
import { browserCase, expect, test } from "./support/fixtures.ts";
import { mockTrips } from "./support/trip-ui.ts";
import {
  longCompanyName,
  longEventTitle,
  longTrailerLabel,
  longValues,
  manualUnknown,
  olderPrivate,
  otherSummary,
  reconciledAccepted,
  returnedReason,
  returnedTrip,
  senderCompanyId,
  type TripEnvelope,
  telemetryWithEvent,
  tripEventId,
  tripPageId,
  withoutSources,
} from "./support/trip-page-fixtures.ts";

const tripPath = `/account/trips/${tripPageId}`;
// A device zone other than UTC, so a saved zone and "as on the device" (null) render differently.
const deviceZone = "Asia/Tokyo";
test.use({ timezoneId: deviceZone });

/**
 * The trip's author without staff capabilities, reading the mutable stub through the trip mock.
 * The saved display zone is UTC unless null ("as on the device") is requested.
 */
async function author(page: Page, initial: TripEnvelope, displayTimezone: string | null = "UTC") {
  await mockTrips(page);
  const self = accountFixture("en");
  const json = { ...self, data: { ...self.data, preferences: { locale: "en", displayTimezone } } };
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
/** Waits for the trip summary and asserts that no load failure is announced. */
async function loaded(page: Page) {
  await expect(page.locator(".trip-row").first()).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
}
const region = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const delivery = (page: Page) => page.locator(".trip-delivery");
/** The definition next to an exact term inside `scope`. */
const fact = (scope: Locator, term: string) =>
  scope.locator(`dt:text-is(${JSON.stringify(term)}) + dd`);
const logoRequests = (requests: string[]) => requests.filter((path) => path.endsWith("/logo"));

test(
  "F1 telemetry trip shows its source, companies, damage, event link and rule checks to the author",
  browserCase(["@functional"]),
  async ({ page }) => {
    const { state, requests } = await author(page, telemetryWithEvent());
    await page.goto(tripPath);
    await catalogLanguage(page);
    await loaded(page);

    const sources = region(page, "Sources");
    const items = sources.getByRole("listitem");
    await expect(items).toHaveCount(1);
    await expect(items.locator(".trip-source-head strong")).toHaveText("Telemetry");
    await expect(fact(items, "Received")).toHaveText(/10 Nov 2026.*18:00/);
    await expect(fact(items, "Driven distance")).toHaveText("812.4005 km");
    await expect(fact(items, "Source outcome")).toHaveText("Delivered");
    await expect(items.getByText("Used for the trip", { exact: true })).toBeVisible();
    await expect(sources).toContainText("Times in UTC");

    const sender = fact(delivery(page), "Sender company");
    await expect(sender).toContainText("Fictional Logistics");
    await expect(sender).toContainText("fict_logistics");
    await expect(sender.locator(".company-logo")).toHaveAttribute("data-logo", "image");
    await expect
      .poll(() =>
        sender.locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth),
      )
      .toBeGreaterThan(0);
    const receiver = fact(delivery(page), "Receiver company");
    await expect(receiver).toContainText("Fictional Port Services");
    await expect(receiver).toContainText("fict_port");
    await expect(receiver.locator(".company-logo")).toHaveAttribute("data-logo", "placeholder");
    await expect(receiver.locator("img")).toHaveCount(0);
    expect(logoRequests(requests)).toEqual([`/api/v1/catalogs/companies/${senderCompanyId}/logo`]);
    await expect(fact(delivery(page), "Cargo damage")).toHaveText("37.5 %");
    await expect(fact(delivery(page), "Event").getByRole("link")).toHaveText(
      "Fictional Winter Convoy",
    );
    await expect(fact(delivery(page), "Event").getByRole("link")).toHaveAttribute(
      "href",
      `/account/events/${tripEventId}`,
    );

    const rules = region(page, "Qualification check").getByRole("listitem");
    await expect(rules).toHaveCount(3);
    await expect(rules.nth(0)).toHaveAttribute("data-state", "pass");
    await expect(rules.nth(0).locator(".trip-rule-symbol")).toHaveAttribute("aria-hidden", "true");
    await expect(rules.nth(0)).toContainText("Maximum mass");
    await expect(rules.nth(0)).toContainText("Passed");
    await expect(rules.nth(0)).toContainText("19 t against the 20 t limit");
    await expect(rules.nth(1)).toHaveAttribute("data-state", "fail");
    await expect(rules.nth(1)).toContainText("Allowed trailer types");
    await expect(rules.nth(1)).toContainText("Failed");
    await expect(rules.nth(1)).toContainText("Allowed: Fictional Curtainsider and 2 more");
    await expect(rules.nth(1)).toContainText("Not allowed: Fictional Tanker");
    await expect(rules.nth(2)).toHaveAttribute("data-state", "bypassed");
    await expect(rules.nth(2)).toContainText("Allowed ADR categories");
    await expect(rules.nth(2)).toContainText("Bypassed by event");
    await expect(rules.nth(2)).toContainText("Allowed: ADR class 2, ADR class 3");

    // The author sees no reviewer-only workspace or reconciliation data.
    await expect(page.getByRole("link", { name: "Review workspace", exact: true })).toHaveCount(0);
    expect(requests.filter((path) => /\/review|\/reconciliations/.test(path))).toEqual([]);

    state.status = 403;
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("permissions");
    await expect(region(page, "Sources")).toHaveCount(0);
    await expect(region(page, "Qualification check")).toHaveCount(0);
    await expect(delivery(page)).toHaveCount(0);
    const deniedCalls = state.calls;
    await page.waitForTimeout(250);
    expect(state.calls).toBe(deniedCalls);
  },
);

test(
  "F2 manual trip keeps unknown distance, companies and check apart from zero and hides a missing check",
  browserCase(["@functional"]),
  async ({ page }) => {
    const { state, requests } = await author(page, manualUnknown());
    await page.goto(tripPath);
    await catalogLanguage(page);
    await loaded(page);

    const item = region(page, "Sources").getByRole("listitem");
    await expect(item).toHaveCount(1);
    await expect(item.locator(".trip-source-head strong")).toHaveText("Manual report");
    await expect(fact(item, "Driven distance")).toHaveText("Unavailable");
    await expect(item).not.toContainText("0 km");
    const sender = fact(delivery(page), "Sender company");
    await expect(sender).toContainText("Unknown company");
    await expect(sender).toContainText("fict_unknown_depot");
    const receiver = fact(delivery(page), "Receiver company");
    await expect(receiver).toHaveText("Unknown company");
    await expect(receiver.locator(".trip-company-code")).toHaveCount(0);
    await expect(page.locator(".company-logo")).toHaveCount(0);
    await expect(page.locator(".trip-delivery img")).toHaveCount(0);
    await expect(fact(delivery(page), "Cargo damage")).toHaveCount(0);
    await expect(fact(delivery(page), "Event")).toHaveCount(0);

    const check = region(page, "Qualification check");
    await expect(check.getByRole("listitem")).toHaveCount(1);
    await expect(check.getByRole("listitem")).toHaveAttribute("data-state", "unavailable");
    await expect(check).toContainText("Check unavailable");
    await expect(check).toContainText("The rules that applied to this trip are unknown.");
    await expect(page.getByText("historical_assignment_missing")).toHaveCount(0);

    // Current production sends no check: nothing renders, not even an empty state.
    state.view = manualUnknown("no-check");
    await page.reload();
    await loaded(page);
    await expect(region(page, "Sources")).toBeVisible();
    await expect(region(page, "Qualification check")).toHaveCount(0);
    await expect(page.getByText("No qualification rules apply.", { exact: true })).toHaveCount(0);

    state.view = manualUnknown("no-rules");
    await page.reload();
    await loaded(page);
    await expect(region(page, "Qualification check")).toContainText(
      "No qualification rules apply.",
    );
    await expect(region(page, "Qualification check").getByRole("listitem")).toHaveCount(0);

    state.view = manualUnknown("zero-damage");
    await page.reload();
    await loaded(page);
    await expect(fact(delivery(page), "Cargo damage")).toHaveText("0 %");
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
    // A null saved zone follows the device, exactly like the summary block above.
    await expect(page.locator(".trip-row small", { hasText: deviceZone })).toBeVisible();
    await expect(sources).toContainText(`Times in ${deviceZone}`);
    await expect(fact(items.nth(0), "Received")).toHaveText(/11 Nov 2026.*03:00/);

    const sender = fact(delivery(page), "Sender company");
    await expect(sender.locator(".company-logo")).toHaveAttribute("data-logo", "placeholder");
    await expect(sender).toContainText("Fictional Logistics");
    await expect(page.locator(".trip-delivery img")).toHaveCount(0);
    await expect(page.getByText("PRIVATE_SENTINEL")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Request correction", exact: true }),
    ).toBeVisible();
  },
);

test(
  "F4 a returned trip keeps its Stage 4 blocks with the rejection in decision history",
  browserCase(["@functional"]),
  async ({ page }) => {
    await author(page, returnedTrip());
    await page.goto(tripPath);
    await catalogLanguage(page);
    await loaded(page);

    await expect(page.locator(".trip-row .status-rejected")).toHaveText("Rejected");
    const history = page
      .locator("section.card")
      .filter({ has: page.getByRole("heading", { name: "Decision history", exact: true }) });
    await expect(history.getByRole("heading", { name: "Rejected", exact: true })).toBeVisible();
    await expect(history).toContainText(returnedReason);
    await expect(region(page, "Sources").getByRole("listitem")).toHaveCount(2);
    const rules = region(page, "Qualification check").getByRole("listitem");
    await expect(rules).toHaveCount(3);
    // Empty configured allowlists are stated, not omitted.
    await expect(rules.nth(1)).toContainText("Allowed: none");
    await expect(rules.nth(1)).toContainText("Not allowed: Fictional Tanker");
    await expect(rules.nth(1)).not.toContainText("more");
    await expect(rules.nth(2)).toContainText("Allowed: non-hazardous cargo only");
    await expect(fact(delivery(page), "Sender company")).toContainText("Fictional Logistics");
    await expect(
      page.getByRole("heading", { name: "Request correction", exact: true }),
    ).toHaveCount(0);
  },
);

test(
  "F5 older private views and company summaries show no Stage 4 blocks; no sources is explained",
  browserCase(["@functional"]),
  async ({ page }) => {
    const { state } = await author(page, olderPrivate("private-recorded-telemetry"));
    await page.goto(tripPath);
    await catalogLanguage(page);
    for (const step of ["private-recorded-telemetry", "extended-manual-revision", "summary"]) {
      if (step === "extended-manual-revision") state.view = olderPrivate(step);
      if (step === "summary") state.view = otherSummary();
      if (step !== "private-recorded-telemetry") await page.reload();
      await loaded(page);
      await expect(
        page.getByRole("paragraph").filter({
          hasText:
            step === "summary"
              ? /^Accepted company summary$/
              : /^Private report and review history$/,
        }),
      ).toBeVisible();
      await expect(region(page, "Sources")).toHaveCount(0);
      await expect(region(page, "Qualification check")).toHaveCount(0);
      await expect(delivery(page)).toHaveCount(0);
      await expect(page.getByText("Sender company", { exact: true })).toHaveCount(0);
      await expect(page.getByText("Receiver company", { exact: true })).toHaveCount(0);
    }

    state.view = withoutSources();
    await page.reload();
    await loaded(page);
    const sources = region(page, "Sources");
    await expect(sources).toContainText("No sources are recorded for this trip.");
    await expect(sources.getByRole("listitem")).toHaveCount(0);
  },
);

test(
  "L1 trip page Stage 4 blocks fit phone, tablet and desktop widths in RU and EN",
  browserCase(["@layout"]),
  async ({ page }, info) => {
    await author(page, longValues());
    await page.goto(tripPath);
    const width = page.viewportSize()?.width ?? 0;
    for (const locale of ["en", "ru"] as const) {
      await catalogLanguage(page, locale);
      await loaded(page);
      const labels =
        locale === "en"
          ? {
              sources: "Sources",
              check: "Qualification check",
              sender: "Sender company",
              effective: "Used for the trip",
            }
          : {
              sources: "Источники",
              check: "Проверка квалификации",
              sender: "Компания-отправитель",
              effective: "Используется для рейса",
            };
      const sources = region(page, labels.sources);
      const check = region(page, labels.check);
      await expect(sources.getByText(labels.effective, { exact: true })).toBeVisible();
      await expect(check.getByRole("listitem")).toHaveCount(3);
      const sender = fact(delivery(page), labels.sender);
      await expect(sender).toContainText(longCompanyName);
      await expect(fact(delivery(page), locale === "en" ? "Event" : "Мероприятие")).toContainText(
        longEventTitle,
      );
      await expect(check).toContainText(longTrailerLabel);
      await expect(check).toContainText(locale === "en" ? "and 11 more" : "и ещё 11");

      await page.evaluate(() => document.fonts.ready);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      for (const section of [sources, check, delivery(page)])
        expect(await section.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

      const plate = await sender.locator(".company-logo").boundingBox();
      const name = await sender.locator(".trip-company-name").boundingBox();
      if (!plate || !name) throw new Error("COMPANY_NOT_RENDERED");
      expect(Math.round(plate.width)).toBe(128);
      expect(Math.round(plate.height)).toBe(32);
      const overlaps =
        name.x < plate.x + plate.width &&
        plate.x < name.x + name.width &&
        name.y < plate.y + plate.height &&
        plate.y < name.y + name.height;
      expect(overlaps).toBe(false);

      // State texts and the effective badge never wrap inside themselves.
      const states = page.locator(".trip-rule-state, .trip-source-effective");
      await expect(states).toHaveCount(4);
      for (const lines of await states.evaluateAll((elements) =>
        elements.map((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          return new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top))).size;
        }),
      ))
        expect(lines).toBe(1);
      if (width <= 760)
        expect(
          await delivery(page).evaluate(
            (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
          ),
        ).toBe(1);
      await capture(page, info, `trip-page-${locale}-${width}`);
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
