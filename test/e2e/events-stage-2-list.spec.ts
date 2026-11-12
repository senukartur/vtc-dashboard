import type { Page } from "@playwright/test";
import type { components } from "@vtc/contracts";
import { accountFixture } from "../../apps/web/src/features/account/fixtures.ts";
import {
  stage2DraftId,
  stage2EventId,
  stage2Fixture,
  stage2LegacyEventId,
  stage2MediaId,
} from "../fixtures/events-stage-2.ts";
import { catalogLanguage } from "./support/catalogs.ts";
import { mockEventsStage2 } from "./support/events-stage-2.ts";
import { browserCase, expect, test } from "./support/fixtures.ts";

type DTO = components["schemas"];
const memberList = /\/api\/v1\/events(?:\?|$)/;
const draftList = /\/api\/v1\/admin\/events\?/;
const discardPath = `/api/v1/admin/events/${stage2DraftId}`;

async function mockDraftsEnabled(page: Page, access: "member" | "manager" = "manager") {
  const events = await mockEventsStage2(page, access);
  await page.route("**/api/v1/me", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const self = accountFixture("en");
    if (access === "manager") self.data.capabilities.push("events.manage");
    self.data.preferences.displayTimezone = "Europe/Warsaw";
    return route.fulfill({
      json: self,
      headers: { ETag: '"v1"', "X-VTC-Events-Stage2": "1", "X-VTC-Events-Drafts": "1" },
    });
  });
  return events;
}

function projection() {
  return stage2Fixture("listEvents", "own-response")
    .response as DTO["EventStage2EnvelopeMemberList"];
}

function legacyRow() {
  const list = stage2Fixture("listPublicEvents", "structured-and-legacy")
    .response as DTO["EventStage2EnvelopePublicList"];
  const legacy = list.data.items.find(({ id }) => id === stage2LegacyEventId);
  if (!legacy) throw new Error("Missing legacy event fixture");
  return {
    ...projection().data.items[0],
    event: legacy,
    myResponse: null,
    myResponseVersion: null,
    responseCounts: { participating: 0, declined: 0 },
  };
}

function recordReads(page: Page) {
  const reads: URL[] = [];
  page.on("request", (request) => {
    if (request.method() === "GET" && request.url().includes("/api/v1/")) {
      reads.push(new URL(request.url()));
    }
  });
  return reads;
}

for (const locale of ["en", "ru"] as const) {
  test(
    `member event cards fit the ${locale} viewport and read only covers that exist`,
    browserCase(["@layout"]),
    async ({ page }, info) => {
      const mock = await mockEventsStage2(page, "member", locale);
      const data = projection();
      const first = data.data.items[0];
      const legacy = legacyRow();
      if (!first) throw new Error("Missing member event fixture");
      data.data.items.push({
        ...first,
        ...legacy,
        ...("myResponseVersion" in first ? {} : { myResponseVersion: undefined }),
      });
      const reads = recordReads(page);
      await page.route(memberList, async (route) => {
        const url = new URL(route.request().url());
        if (url.searchParams.get("locale") !== locale) return route.fallback();
        return route.fulfill({ json: data });
      });

      await page.goto("/account/events");
      if (locale === "ru") await catalogLanguage(page, locale);
      const main = page.getByRole("main");
      const structured = main.getByRole("listitem").filter({
        has: page.locator(`a[href="/account/events/${stage2EventId}"]`),
      });
      const older = main.getByRole("listitem").filter({
        has: page.locator(`a[href="/account/events/${stage2LegacyEventId}"]`),
      });

      await expect(structured.getByRole("link", { name: first.event.title })).toHaveAttribute(
        "href",
        `/account/events/${stage2EventId}`,
      );
      await expect(structured).toContainText("TruckersMP");
      const dlcs = structured.getByRole("list", {
        name: locale === "en" ? "Required DLC" : "Необходимые DLC",
      });
      await expect(dlcs.getByRole("listitem")).toHaveText(["Fictional Northern Roads"]);
      await expect(structured).toContainText("GMT+01:00");
      await expect(structured).toContainText(locale === "en" ? "Meeting time" : "Время сбора");
      await expect(structured.locator("img")).toHaveJSProperty("complete", true);
      expect(
        await structured.locator("img").evaluate((node) => (node as HTMLImageElement).naturalWidth),
      ).toBeGreaterThan(0);
      const cover = await structured.locator("img").boundingBox();
      expect(cover?.width).toBeGreaterThanOrEqual(58);
      expect(cover?.height).toBeGreaterThanOrEqual(42);
      await expect(older).toContainText(legacy.event.route ?? "");
      await expect(older).toContainText(locale === "en" ? "No DLC required" : "DLC не нужны");
      await expect(older.locator(".event-list-placeholder")).toBeVisible();
      await expect(older.locator("img")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: locale === "en" ? "Drafts" : "Черновики" }),
      ).toHaveCount(0);
      expect(
        mock.requests.some(
          ({ route }) => route === `GET /events/${stage2EventId}/media/${stage2MediaId}/content`,
        ),
      ).toBe(true);
      expect(reads.some(({ pathname }) => pathname.includes(`/${stage2LegacyEventId}/media`))).toBe(
        false,
      );
      expect(reads.some(({ pathname }) => pathname.endsWith("/my-response"))).toBe(false);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        page.viewportSize()?.width ?? 0,
      );
      await page.screenshot({ path: info.outputPath(`event-cards-${locale}.png`), fullPage: true });
    },
  );
}

test(
  "nearest cutoff and cancellation refresh the affected open list page",
  browserCase(["@functional"]),
  async ({ page }) => {
    await page.clock.install({ time: new Date("2099-10-25T12:59:50.000Z") });
    await mockEventsStage2(page, "member");
    const initialList = projection();
    const row = initialList.data.items[0];
    const initialNearest = stage2Fixture("getUpcomingEvent", "own-response")
      .response as DTO["EventStage2EnvelopeUpcoming"];
    if (!row || !initialNearest.data) throw new Error("Missing Stage 2 projections");
    const next = {
      ...row.event,
      id: stage2LegacyEventId,
      title: "Fictional afternoon convoy",
      meetingAt: "2099-10-25T14:00:00.000Z",
      startsAt: "2099-10-25T15:00:00.000Z",
      hasCover: false,
    };
    let list = initialList;
    let nearest = initialNearest;
    let reads = 0;
    await page.route(memberList, (route) => {
      reads++;
      return route.fulfill({ json: list });
    });
    await page.route(/\/api\/v1\/me\/upcoming-event\?/, (route) =>
      route.fulfill({ json: nearest }),
    );

    await page.goto("/account/events");
    const main = page.getByRole("main");
    const header = page.locator(".event-nearest");
    await expect(main.getByRole("link", { name: row.event.title })).toBeVisible();
    await expect(header.getByRole("link")).toHaveAttribute(
      "href",
      `/account/events/${row.event.id}`,
    );
    expect(reads).toBe(1);

    list = { ...initialList, data: { ...initialList.data, items: [{ ...row, event: next }] } };
    nearest = { ...initialNearest, data: { ...initialNearest.data, event: next } };
    await page.clock.fastForward(11_000);
    await expect(header.getByRole("link")).toHaveAttribute("href", `/account/events/${next.id}`);
    await expect(main.getByRole("link", { name: next.title })).toBeVisible();
    await expect(main.getByRole("link", { name: row.event.title })).toHaveCount(0);
    expect(reads).toBe(2);

    list = { ...initialList, data: { ...initialList.data, items: [] } };
    nearest = { ...initialNearest, data: null };
    await page.clock.fastForward(31_000);
    await expect(header).toContainText("No upcoming event");
    await expect(main.getByText("No events in this period.")).toBeVisible();
    expect(reads).toBe(3);
  },
);

test(
  "nearest cancellation replaces the first list read already in flight",
  browserCase(["@functional"]),
  async ({ page }) => {
    await page.clock.install({ time: new Date("2099-10-25T12:00:00.000Z") });
    const mock = await mockEventsStage2(page, "member");
    const initial = projection();
    const row = initial.data.items[0];
    if (!row) throw new Error("Missing Stage 2 event fixture");
    let listReads = 0;
    let releaseOld = () => {};
    const oldGate = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    let oldSettled = false;
    await page.route(memberList, async (route) => {
      if (++listReads !== 1)
        return route.fulfill({ json: { ...initial, data: { ...initial.data, items: [] } } });
      await oldGate;
      await route.fulfill({ json: initial }).catch(() => undefined);
      oldSettled = true;
    });

    try {
      const baselineFeed = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          response.ok() &&
          url.pathname === "/api/v1/notifications" &&
          !url.searchParams.has("cursor")
        );
      });
      await page.goto("/account/dashboard");
      await baselineFeed;
      const header = page.locator(".event-nearest");
      await expect(header.getByRole("link")).toHaveAttribute(
        "href",
        `/account/events/${row.event.id}`,
      );
      // Move most of the way to the next poll before starting the bounded list read.
      await page.clock.fastForward(24_000);
      const firstRead = page.waitForRequest((request) => memberList.test(request.url()));
      await page
        .getByRole("navigation", { name: "Main navigation" })
        .getByRole("link", { name: "Events", exact: true })
        .click();
      const oldRequest = await firstRead;
      await expect.poll(() => listReads).toBe(1);

      mock.upcoming = false;
      expect(oldRequest.failure()).toBeNull();
      await page.clock.fastForward(8_000);
      const main = page.getByRole("main");
      await expect(header).toContainText("No upcoming event");
      await expect(main.getByText("No events in this period.")).toBeVisible();
      await expect.poll(() => oldRequest.failure()).not.toBeNull();
      expect(listReads).toBe(2);
      expect(mock.requests.filter(({ route }) => route === "GET /me/upcoming-event")).toHaveLength(
        2,
      );

      releaseOld();
      await expect.poll(() => oldSettled).toBe(true);
      await expect(main.getByRole("link", { name: row.event.title })).toHaveCount(0);
      await expect(main.getByText("No events in this period.")).toBeVisible();
    } finally {
      releaseOld();
    }
  },
);

for (const access of ["member", "manager"] as const) {
  test(
    access === "member"
      ? "a member cannot request drafts by bookmarking the enabled tab"
      : "a manager without the draft rollout opens Upcoming from a draft bookmark",
    browserCase(["@functional"]),
    async ({ page }) => {
      if (access === "member") await mockDraftsEnabled(page, access);
      else await mockEventsStage2(page, access);
      const reads = recordReads(page);
      await page.goto("/account/events?period=drafts&cursor=fictional-draft-cursor");
      await expect(
        page.getByRole("main").getByRole("link", { name: "Fictional northern convoy" }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Upcoming" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(page.getByRole("button", { name: "Drafts", exact: true })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Continue", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^Discard draft:/ })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Create event", exact: true })).toHaveCount(
        access === "manager" ? 1 : 0,
      );
      expect(reads.filter(({ pathname }) => pathname.startsWith("/api/v1/admin/events"))).toEqual(
        [],
      );
      const list = reads.find(({ pathname }) => pathname === "/api/v1/events");
      expect(list?.searchParams.get("period")).toBe("upcoming");
      expect(list?.searchParams.has("cursor")).toBe(false);
    },
  );
}

test(
  "a rejected cursor can be reset from the keyboard",
  browserCase(["@functional"]),
  async ({ page }) => {
    await mockEventsStage2(page, "member");
    await page.route(memberList, async (route) => {
      return new URL(route.request().url()).searchParams.has("cursor")
        ? route.fulfill({ status: 422 })
        : route.fallback();
    });
    await page.goto("/account/events?period=past&cursor=expired-synthetic-page");
    await page.getByRole("button", { name: "Start from first page" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Company events" })).toBeFocused();
    await expect(page).toHaveURL(/\/account\/events\?period=past$/);
    await expect(
      page.getByRole("main").getByRole("link", { name: "Fictional northern convoy" }),
    ).toBeVisible();
  },
);

test(
  "a manager confirms discarding an incomplete draft and retries the exact attempt",
  browserCase(["@functional"]),
  async ({ page }, info) => {
    await mockDraftsEnabled(page);
    const reads = recordReads(page);
    const drafts = stage2Fixture("listAdminEvents", "drafts")
      .response as DTO["EventStage2EnvelopeAdminList"];
    const entry = drafts.data.items[0];
    if (entry?.lifecycle !== "draft") throw new Error("Missing draft fixture");
    entry.fields = {};
    let discarded = false;
    const attempts: { precondition: string | undefined; key: string | undefined }[] = [];

    await page.route(draftList, async (route) => {
      const url = new URL(route.request().url());
      expect(url.searchParams.get("period")).toBe("drafts");
      return route.fulfill({
        json: discarded ? { ...drafts, data: { ...drafts.data, items: [] } } : drafts,
      });
    });
    await page.route(`**${discardPath}`, async (route) => {
      if (route.request().method() !== "DELETE") return route.fallback();
      const headers = route.request().headers();
      attempts.push({ precondition: headers["if-match"], key: headers["idempotency-key"] });
      expect(headers["x-csrf-token"]).toBeTruthy();
      if (attempts.length === 1) return route.abort("failed");
      discarded = true;
      return route.fallback();
    });
    await page.goto("/account/events");
    await expect(
      page.getByRole("main").getByRole("link", { name: "Fictional northern convoy" }),
    ).toBeVisible();
    expect(reads.filter(({ pathname }) => pathname === "/api/v1/admin/events")).toEqual([]);
    await page.getByRole("button", { name: "Drafts" }).click();
    const heading = page.getByRole("heading", { name: "Company events" });
    await expect(page.getByRole("heading", { name: "Untitled event" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Continue" })).toHaveAttribute(
      "href",
      `/account/events/new?draftId=${stage2DraftId}`,
    );
    const trigger = page.getByRole("button", { name: "Discard draft: Untitled event" });
    const dialog = page.getByRole("dialog", { name: "Discard Untitled event?" });
    await trigger.click();
    await expect(dialog.getByRole("button", { name: "Keep draft" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(attempts).toEqual([]);
    await trigger.click();
    await page.screenshot({ path: info.outputPath("discard-draft.png"), fullPage: true });
    await dialog.getByRole("button", { name: "Discard draft" }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await dialog.getByRole("button", { name: "Try again" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(heading).toBeFocused();
    await expect(page.getByText("Draft discarded.", { exact: true })).toBeVisible();
    await expect(page.getByText("No event drafts.", { exact: true })).toBeVisible();
    expect(attempts).toEqual([{ key: expect.any(String), precondition: '"v1"' }, attempts[0]]);
  },
);

test(
  "a stale draft discard refreshes authority and requires a new confirmation",
  browserCase(["@functional"]),
  async ({ page }) => {
    const mock = await mockDraftsEnabled(page);
    const drafts = stage2Fixture("listAdminEvents", "drafts")
      .response as DTO["EventStage2EnvelopeAdminList"];
    const entry = drafts.data.items[0];
    if (entry?.lifecycle !== "draft") throw new Error("Missing draft fixture");
    let conflict = true;
    await page.route(draftList, (route) => route.fulfill({ json: drafts }));
    await page.route(`**${discardPath}`, async (route) => {
      if (!conflict) return route.fallback();
      conflict = false;
      entry.version = 2;
      entry.fields.title = "Fictional renamed convoy";
      return route.fulfill({ status: 412 });
    });
    await page.goto("/account/events?period=drafts");
    await page.getByRole("button", { name: "Discard draft: Fictional incomplete convoy" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Discard draft" }).click();
    await expect(page.getByRole("alert")).toContainText("This draft changed.");
    await expect(page.getByRole("heading", { name: "Fictional renamed convoy" })).toBeVisible();
    expect(mock.requests.filter(({ route }) => route.startsWith("DELETE "))).toEqual([]);
    await page.getByRole("button", { name: "Discard draft: Fictional renamed convoy" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Discard draft" }).click();
    await expect(page.getByText("Draft discarded.")).toBeVisible();
    expect(mock.requests.filter(({ route }) => route.startsWith("DELETE "))).toEqual([
      {
        route: `DELETE /admin/events/${stage2DraftId}`,
        key: expect.any(String),
        precondition: '"v2"',
      },
    ]);
  },
);
