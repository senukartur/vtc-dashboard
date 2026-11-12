import type { components } from "@vtc/contracts";
import { stage2EventId, stage2Fixture } from "../fixtures/events-stage-2.ts";
import { mockDashboardRoutes } from "./support/dashboard-ui.ts";
import { mockEventsStage2 } from "./support/events-stage-2.ts";
import { browserCase, expect, test } from "./support/fixtures.ts";

type DTO = components["schemas"];
const upcomingPath = /\/api\/v1\/me\/upcoming-event\?/;
const listPath = /\/api\/v1\/events\?/;
const responsePath = `/api/v1/events/${stage2EventId}/my-response`;

function upcomingProjection() {
  return stage2Fixture("getUpcomingEvent", "own-response")
    .response as DTO["EventStage2EnvelopeUpcoming"];
}

test(
  "header and overview share a localized nearest-event read and refresh once at cutoff",
  browserCase(["@functional"]),
  async ({ page }) => {
    await page.clock.install({ time: new Date("2099-10-25T12:59:00.000Z") });
    await mockDashboardRoutes(page);
    let reads = 0;
    const next = upcomingProjection();
    const title = next.data?.event.title ?? "";
    await page.route(upcomingPath, (route) => {
      expect(new URL(route.request().url()).searchParams.get("locale")).toBe("en");
      reads++;
      return route.fulfill({ json: reads === 1 ? next : { ...next, data: null } });
    });
    await page.goto("/account/dashboard");
    const overview = page.getByRole("region", { name: "Upcoming Event" });
    await expect(overview.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.locator(".event-nearest").getByRole("link")).toHaveAttribute(
      "href",
      `/account/events/${stage2EventId}`,
    );
    expect(reads).toBe(1);
    await page.clock.fastForward(61_000);
    await expect(overview.getByText("No scheduled convoys")).toBeVisible();
    await expect(page.locator(".event-nearest")).toContainText("No upcoming event");
    expect(reads).toBe(2);
  },
);

test(
  "quick RSVP shares pending state, rolls back and retries exactly without reading my-response",
  browserCase(["@functional"]),
  async ({ page }) => {
    const nearest = upcomingProjection();
    const list = stage2Fixture("listEvents", "own-response")
      .response as DTO["EventStage2EnvelopeMemberList"];
    const row = list.data.items[0];
    if (!nearest.data || !row) throw new Error("Missing Stage 2 projections");
    test.skip(!("myResponseVersion" in nearest.data), "Requires the VTC-126 generated contract");
    const versionedNearest = {
      ...nearest,
      data: { ...nearest.data, myResponse: "unanswered", myResponseVersion: 7 },
    };
    const versionedList = {
      ...list,
      data: { ...list.data, items: [{ ...row, myResponse: "unanswered", myResponseVersion: 7 }] },
    };
    await mockEventsStage2(page, "member");
    let listReads = 0;
    await page.route(listPath, (route) => {
      listReads++;
      return route.fulfill({ json: versionedList });
    });
    await page.route(upcomingPath, (route) => route.fulfill({ json: versionedNearest }));
    const attempts: {
      key: string | undefined;
      precondition: string | undefined;
      body: DTO["RsvpInput"];
    }[] = [];
    const ownReads: string[] = [];
    let releaseFailure: () => void = () => {};
    const failureGate = new Promise<void>((resolve) => {
      releaseFailure = resolve;
    });
    await page.route(`**${responsePath}`, async (route) => {
      const request = route.request();
      if (request.method() === "GET") {
        ownReads.push(request.url());
        return route.fulfill({ status: 500 });
      }
      const body = request.postDataJSON() as DTO["RsvpInput"];
      const headers = request.headers();
      attempts.push({ key: headers["idempotency-key"], precondition: headers["if-match"], body });
      expect(headers["x-csrf-token"]).toBeTruthy();
      if (attempts.length === 1) {
        await failureGate;
        return route.abort("failed");
      }
      return route.fulfill({
        headers: { ETag: `"v${6 + attempts.length}"` },
        json: {
          data: {
            response: body.response,
            version: 6 + attempts.length,
            declineReason: body.response === "declined" ? body.reason : null,
          },
          meta: nearest.meta,
        },
      });
    });

    await page.goto("/account/events");
    const header = page.locator(".event-nearest");
    const card = page.getByRole("main").getByRole("listitem").filter({ hasText: row.event.title });
    const headerGoing = header.getByRole("button", { name: "Going" });
    const cardGoing = card.getByRole("button", { name: "Going" });
    await expect(card).toContainText("Participating: 1");
    await expect(headerGoing).toBeVisible();
    expect(await headerGoing.evaluate((element) => element.closest("a"))).toBeNull();
    await headerGoing.click();
    await expect(card).toContainText("Participating: 2");
    await expect(cardGoing).toHaveAttribute("aria-disabled", "true");
    await cardGoing.press("Enter");
    expect(attempts).toHaveLength(1);
    releaseFailure();
    await expect(header.getByRole("alert")).toBeVisible();
    await expect(card).toContainText("Participating: 1");
    await headerGoing.click();
    await expect(header.getByText("Response saved.")).toBeVisible();
    await expect(card).toContainText("Participating: 2");
    expect(attempts).toEqual([
      { key: expect.any(String), precondition: '"v7"', body: { response: "participating" } },
      attempts[0],
    ]);

    await card.getByRole("button", { name: "Can't go" }).click();
    await card.getByRole("button", { name: "Save response" }).click();
    await expect(card.getByText("Enter a reason to decline.")).toBeVisible();
    expect(attempts).toHaveLength(2);
    const privateReason = "Fictional night shift";
    await card.getByRole("textbox", { name: "Private decline reason" }).fill(privateReason);
    await card.getByRole("button", { name: "Save response" }).click();
    await expect(card.getByText("Response saved.")).toBeVisible();
    await expect(card).toContainText("Participating: 1");
    await expect(card).toContainText("Can't attend: 1");
    await expect(card.getByText(privateReason)).toHaveCount(0);
    expect(attempts[2]).toEqual({
      key: expect.any(String),
      precondition: '"v8"',
      body: { response: "declined", reason: privateReason },
    });
    expect(ownReads).toEqual([]);
    expect(listReads).toBe(1);
  },
);
