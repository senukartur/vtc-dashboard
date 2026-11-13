import { mockDashboardRoutes } from "./support/dashboard-ui.ts";
import { browserCase, expect, test } from "./support/fixtures.ts";

test(
  "a session without the rollout flag keeps legacy list, header and overview reads",
  browserCase(["@functional"]),
  async ({ page }) => {
    const dashboard = await mockDashboardRoutes(page);
    const event = dashboard.upcoming;
    if (!event) throw new Error("Missing legacy convoy fixture");
    const listReads: URL[] = [];
    await page.route(/\/api\/v1\/events\?/, (route) => {
      listReads.push(new URL(route.request().url()));
      return route.fulfill({
        json: {
          data: { items: [event], nextCursor: null },
          meta: { requestId: "synthetic-legacy-list" },
        },
      });
    });

    await page.goto("/account/dashboard");
    const overview = page.getByRole("region", { name: "Upcoming Event" });
    const header = page.locator(".event-nearest");
    await expect(overview.getByRole("heading", { name: event.title })).toBeVisible();
    await expect(overview.getByRole("button", { name: "Going" })).toBeVisible();
    await expect(header.getByRole("link")).toHaveAttribute("href", `/account/events/${event.id}`);
    await expect(header.getByRole("button", { name: "Going" })).toHaveCount(0);

    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Events", exact: true })
      .click();
    const main = page.getByRole("main");
    await expect(main.getByRole("link", { name: event.title })).toBeVisible();
    await expect(main.getByRole("button", { name: "Drafts" })).toHaveCount(0);
    expect(listReads.map(({ searchParams }) => searchParams.get("locale"))).toEqual([null]);
    const nearest = dashboard.requests.filter(
      ({ pathname }) => pathname === "/api/v1/me/upcoming-event",
    );
    expect(nearest.map(({ searchParams }) => searchParams.get("locale"))).toEqual([null]);

    await page.goto("/account/events?period=drafts&cursor=fictional-draft-cursor");
    await expect(main.getByRole("link", { name: event.title })).toBeVisible();
    await expect(main.getByRole("button", { name: "Upcoming", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(listReads).toHaveLength(2);
    const fallback = listReads.at(-1)?.searchParams;
    expect(fallback?.get("period")).toBe("upcoming");
    expect(fallback?.has("cursor")).toBe(false);
    expect(fallback?.has("locale")).toBe(false);
    expect(
      dashboard.requests.some(({ pathname }) => pathname.startsWith("/api/v1/admin/events")),
    ).toBe(false);
  },
);
