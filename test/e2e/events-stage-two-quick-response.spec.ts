import type { Page } from "@playwright/test";
import type { components } from "@vtc/contracts";
import { accountFixture } from "../../apps/web/src/features/account/fixtures.ts";
import { stage2EventId, stage2Fixture, stage2LegacyEventId } from "../fixtures/events-stage-2.ts";
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

async function mockStage2Dashboard(page: Page) {
  const dashboard = await mockDashboardRoutes(page);
  // Use the existing account response with the VTC-124 transport opt-in.
  await page.route("**/api/v1/me", (route) =>
    route.fulfill({ json: accountFixture("en"), headers: { "X-VTC-Events-Stage2": "1" } }),
  );
  return dashboard;
}

test(
  "header and overview share each localized nearest-event read at cutoff and on notification poll",
  browserCase(["@functional"]),
  async ({ page }) => {
    // Cross the cutoff without advancing to the next notification poll.
    await page.clock.install({ time: new Date("2099-10-25T12:59:50.000Z") });
    await mockStage2Dashboard(page);
    let reads = 0;
    const initial = upcomingProjection();
    const initialEvent = initial.data;
    if (!initialEvent) throw new Error("Missing nearest event fixture");
    let wire = initial;
    await page.route(upcomingPath, (route) => {
      expect(new URL(route.request().url()).searchParams.get("locale")).toBe("en");
      reads++;
      return route.fulfill({ json: wire });
    });
    await page.goto("/account/dashboard");
    const overview = page.getByRole("region", { name: "Upcoming Event" });
    const header = page.locator(".event-nearest");
    await expect(overview.getByRole("heading", { name: initialEvent.event.title })).toBeVisible();
    await expect(header.getByRole("link")).toHaveAttribute(
      "href",
      `/account/events/${stage2EventId}`,
    );
    expect(reads).toBe(1);
    wire = { ...initial, data: null };
    await page.clock.fastForward(11_000);
    await expect(overview.getByText("No scheduled convoys")).toBeVisible();
    await expect(header).toContainText("No upcoming event");
    expect(reads).toBe(2);

    const nextTitle = "Fictional afternoon convoy";
    wire = {
      ...initial,
      data: {
        ...initialEvent,
        event: {
          ...initialEvent.event,
          id: stage2LegacyEventId,
          title: nextTitle,
          meetingAt: "2099-10-25T14:00:00.000Z",
          startsAt: "2099-10-25T15:00:00.000Z",
        },
      },
    };
    // The next notification poll invalidates the shared query for both surfaces.
    await page.clock.fastForward(31_000);
    await expect(overview.getByRole("heading", { name: nextTitle })).toBeVisible();
    await expect(header.getByRole("link")).toHaveAttribute(
      "href",
      `/account/events/${stage2LegacyEventId}`,
    );
    expect(reads).toBe(3);
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
    let response: DTO["Rsvp"]["response"] = "unanswered";
    let version = 7;
    let responseCounts = { participating: 1, declined: 0 };
    await mockEventsStage2(page, "member");
    let listReads = 0;
    await page.route(listPath, (route) => {
      listReads++;
      return route.fulfill({
        json: {
          ...list,
          data: {
            ...list.data,
            items: [{ ...row, myResponse: response, myResponseVersion: version, responseCounts }],
          },
        },
      });
    });
    await page.route(upcomingPath, (route) =>
      route.fulfill({
        json: {
          ...nearest,
          data: { ...nearest.data, myResponse: response, myResponseVersion: version },
        },
      }),
    );
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
    let releaseDecline: () => void = () => {};
    const declineGate = new Promise<void>((resolve) => {
      releaseDecline = resolve;
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
      if (attempts.length === 2) {
        // The retry recovers the old receipt. A newer committed reset already exists.
        version = 9;
        return route.fulfill({
          headers: { ETag: '"v8"' },
          json: {
            data: { response: "participating", version: 8, declineReason: null },
            meta: nearest.meta,
          },
        });
      }
      if (attempts.length === 3) {
        response = "participating";
        version = 10;
        responseCounts = { participating: 2, declined: 0 };
        return route.fulfill({ status: 412 });
      }
      await declineGate;
      return route.fulfill({
        headers: { ETag: '"v11"' },
        json: {
          data: {
            response: body.response,
            version: 11,
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
    await expect(card).toContainText("Participating: 1");
    await expect(card).toContainText("Your response: No answer");
    expect(listReads).toBe(2);
    expect(attempts).toEqual([
      { key: expect.any(String), precondition: '"v7"', body: { response: "participating" } },
      attempts[0],
    ]);

    await card.getByRole("button", { name: "Can't go" }).click();
    await card.getByRole("button", { name: "Save response" }).click();
    await expect(card.getByText("Enter a reason to decline.")).toBeVisible();
    expect(attempts).toHaveLength(2);
    const privateReason = "Fictional night shift";
    const reasonField = card.getByRole("textbox", { name: "Private decline reason" });
    await reasonField.fill(privateReason);
    const save = card.getByRole("button", { name: "Save response" });
    await save.click();
    await expect(card.getByRole("alert")).toContainText("The event changed.");
    await expect(card).toContainText("Participating: 2");
    await expect(reasonField).toHaveValue(privateReason);
    expect(attempts[2]).toEqual({
      key: expect.any(String),
      precondition: '"v9"',
      body: { response: "declined", reason: privateReason },
    });
    await save.click();
    const period = page.getByRole("button", { name: "Upcoming", exact: true });
    await period.focus();
    releaseDecline();
    await expect(card.getByText("Response saved.")).toBeVisible();
    await expect(period).toBeFocused();
    await expect(card).toContainText("Participating: 1");
    await expect(card).toContainText("Can't attend: 1");
    await expect(card.getByText(privateReason)).toHaveCount(0);
    expect(attempts[3]).toEqual({
      key: expect.any(String),
      precondition: '"v10"',
      body: { response: "declined", reason: privateReason },
    });
    expect(attempts[3]?.key).not.toBe(attempts[2]?.key);
    expect(ownReads).toEqual([]);
    expect(listReads).toBe(3);
  },
);

test(
  "a detail response refreshes the header and seeds the overview's next precondition",
  browserCase(["@functional"]),
  async ({ page }) => {
    const nearest = upcomingProjection();
    if (!nearest.data) throw new Error("Missing Stage 2 projection");
    const detail = stage2Fixture("getEvent", "structured")
      .response as DTO["EventStage2EnvelopeMember"];
    const dashboard = await mockStage2Dashboard(page);
    dashboard.response = { response: "unanswered", declineReason: null, version: 7 };
    dashboard.counts = { participating: 4, declined: 0 };
    let nearestReads = 0;
    let ownReads = 0;
    page.on("request", (request) => {
      if (request.method() === "GET" && new URL(request.url()).pathname === responsePath)
        ownReads++;
    });
    await page.route(upcomingPath, (route) => {
      nearestReads++;
      return route.fulfill({
        json: {
          ...nearest,
          data: {
            ...nearest.data,
            myResponse: dashboard.response.response,
            myResponseVersion: dashboard.response.version,
          },
        },
      });
    });
    await page.route(`**/api/v1/events/${stage2EventId}?locale=en`, (route) =>
      route.fulfill({
        json: {
          ...detail,
          data: {
            ...detail.data,
            myResponse: dashboard.response,
            responseCounts: dashboard.counts,
          },
        },
        headers: { ETag: `"v${detail.data.event.version}"` },
      }),
    );

    await page.goto(`/account/events/${stage2EventId}`);
    const headerGoing = page.locator(".event-nearest").getByRole("button", { name: "Going" });
    const main = page.getByRole("main");
    await expect(headerGoing).toHaveAttribute("aria-pressed", "false");
    await expect(
      main.getByRole("heading", { name: detail.data.event.title, exact: true }),
    ).toBeVisible();
    await main
      .getByRole("group", { name: "Your response", exact: true })
      .getByRole("button", { name: "Participating", exact: true })
      .click();
    await expect(main.getByText("Response saved.")).toBeVisible();
    await expect(headerGoing).toHaveAttribute("aria-pressed", "true");
    expect(nearestReads).toBe(2);

    const detailOwnReads = ownReads;
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Overview", exact: true })
      .click();
    const overview = page.getByRole("region", { name: "Upcoming Event" });
    await expect(overview).toContainText("Going: 5");
    await expect(overview.getByRole("button", { name: "Going" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await overview.getByRole("button", { name: "Can't go" }).click();
    await overview
      .getByRole("textbox", { name: "Private decline reason" })
      .fill("Fictional overnight work");
    dashboard.hold("rsvp");
    dashboard.rsvpOutcomes.push({ status: 503 });
    const save = overview.getByRole("button", { name: "Save response" });
    await save.click();
    await expect(overview).toContainText("Going: 4");
    await expect(headerGoing).toHaveAttribute("aria-disabled", "true");
    dashboard.release("rsvp");
    await expect(overview.getByRole("alert")).toBeVisible();
    await expect(overview).toContainText("Going: 5");
    await expect(headerGoing).toHaveAttribute("aria-pressed", "true");
    expect(dashboard.commands.map(({ headers }) => headers["if-match"])).toEqual(['"v7"', '"v8"']);
    expect(nearestReads).toBe(2);
    expect(ownReads).toBe(detailOwnReads);
  },
);

test(
  "quick RSVP replaces an old detail read and updates its counts and roster",
  browserCase(["@functional"]),
  async ({ page }) => {
    const nearest = upcomingProjection();
    const detail = stage2Fixture("getEvent", "structured")
      .response as DTO["EventStage2EnvelopeMember"];
    if (!nearest.data) throw new Error("Missing Stage 2 projection");
    const dashboard = await mockStage2Dashboard(page);
    dashboard.response = { response: "unanswered", declineReason: null, version: 7 };
    dashboard.counts = { participating: 4, declined: 0 };

    await page.route(upcomingPath, (route) =>
      route.fulfill({
        json: {
          ...nearest,
          data: {
            ...nearest.data,
            myResponse: dashboard.response.response,
            myResponseVersion: dashboard.response.version,
          },
        },
      }),
    );
    let detailReads = 0;
    let releaseOld = () => {};
    const oldGate = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    let oldSettled = false;
    await page.route(`**/api/v1/events/${stage2EventId}?locale=en`, async (route) => {
      const json = {
        ...detail,
        data: { ...detail.data, myResponse: dashboard.response, responseCounts: dashboard.counts },
      };
      if (++detailReads !== 1) return route.fulfill({ json });
      await oldGate;
      await route.fulfill({ json }).catch(() => undefined);
      oldSettled = true;
    });
    const member = accountFixture("en").data.member;
    await page.route(`**/api/v1/events/${stage2EventId}/participants?limit=25`, (route) =>
      route.fulfill({
        json: {
          data: {
            items: dashboard.response.response === "participating" ? [{ member }] : [],
            nextCursor: null,
          },
          meta: detail.meta,
        },
      }),
    );

    try {
      const first = page.waitForRequest((request) => {
        const url = new URL(request.url());
        return url.pathname === `/api/v1/events/${stage2EventId}` && url.searchParams.has("locale");
      });
      await page.goto(`/account/events/${stage2EventId}`);
      const oldRequest = await first;
      await expect.poll(() => detailReads).toBe(1);
      expect(oldRequest.failure()).toBeNull();
      const header = page.locator(".event-nearest");
      await header.getByRole("button", { name: "Going", exact: true }).click();
      await expect(header.getByText("Response saved.", { exact: true })).toBeVisible();
      const participants = page.getByRole("region", { name: "Participants", exact: true });
      await expect(participants).toContainText("Participating: 5");
      await expect(
        participants.getByRole("link", { name: member.nickname, exact: true }),
      ).toBeVisible();
      await expect.poll(() => oldRequest.failure()).not.toBeNull();

      releaseOld();
      await expect.poll(() => oldSettled).toBe(true);
      await expect(participants).toContainText("Participating: 5");
      expect(detailReads).toBe(2);
    } finally {
      releaseOld();
    }
  },
);

test(
  "a header response replaces an in-flight first list read with current authority",
  browserCase(["@functional"]),
  async ({ page }) => {
    const nearest = upcomingProjection();
    const list = stage2Fixture("listEvents", "own-response")
      .response as DTO["EventStage2EnvelopeMemberList"];
    const row = list.data.items[0];
    if (!nearest.data || !row) throw new Error("Missing Stage 2 projections");

    await mockEventsStage2(page, "member");
    let response: DTO["Rsvp"]["response"] = "unanswered";
    let version = 7;
    let listReads = 0;
    const preconditions: (string | undefined)[] = [];
    let releaseOld = () => {};
    const oldGate = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    let oldSettled = false;

    await page.route(listPath, async (route) => {
      const json = {
        ...list,
        data: {
          ...list.data,
          items: [
            {
              ...row,
              myResponse: response,
              myResponseVersion: version,
              responseCounts: {
                participating: response === "participating" ? 2 : 1,
                declined: response === "declined" ? 1 : 0,
              },
            },
          ],
        },
      };
      if (++listReads !== 1) return route.fulfill({ json });
      await oldGate;
      // The browser may already have detached the aborted request.
      await route.fulfill({ json }).catch(() => undefined);
      oldSettled = true;
    });
    await page.route(upcomingPath, (route) =>
      route.fulfill({
        json: {
          ...nearest,
          data: { ...nearest.data, myResponse: response, myResponseVersion: version },
        },
      }),
    );
    await page.route(`**${responsePath}`, async (route) => {
      const request = route.request();
      const precondition = request.headers()["if-match"];
      preconditions.push(precondition);
      if (request.method() !== "PUT" || precondition !== `"v${version}"`)
        return route.fulfill({ status: 412 });
      const body = request.postDataJSON() as DTO["RsvpInput"];
      response = body.response;
      version++;
      return route.fulfill({
        headers: { ETag: `"v${version}"` },
        json: {
          data: {
            response,
            version,
            declineReason: body.response === "declined" ? body.reason : null,
          },
          meta: nearest.meta,
        },
      });
    });

    try {
      const firstRead = page.waitForRequest((request) => listPath.test(request.url()));
      await page.goto("/account/events");
      const oldRequest = await firstRead;
      await expect.poll(() => listReads).toBe(1);
      const header = page.locator(".event-nearest");
      const card = page
        .getByRole("main")
        .getByRole("listitem")
        .filter({ hasText: row.event.title });
      await expect(card).toHaveCount(0);
      await header.getByRole("button", { name: "Going" }).click();
      await expect(card).toContainText("Your response: Participating");
      await expect(card).toContainText("Participating: 2");
      await expect.poll(() => oldRequest.failure()).not.toBeNull();
      expect(listReads).toBe(2);

      releaseOld();
      await expect.poll(() => oldSettled).toBe(true);
      await expect(card.getByRole("button", { name: "Going" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await card.getByRole("button", { name: "Can't go" }).click();
      await card
        .getByRole("textbox", { name: "Private decline reason" })
        .fill("Fictional scheduling conflict");
      await card.getByRole("button", { name: "Save response" }).click();
      await expect(card.getByText("Response saved.")).toBeVisible();
      await expect(card).toContainText("Participating: 1");
      await expect(card).toContainText("Can't attend: 1");
      expect(preconditions).toEqual(['"v7"', '"v8"']);
      expect(listReads).toBe(2);
    } finally {
      releaseOld();
    }
  },
);
