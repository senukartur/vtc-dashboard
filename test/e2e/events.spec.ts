import { writeFile } from "node:fs/promises";
import type { Page, Request, TestInfo } from "@playwright/test";
import type { components } from "@vtc/contracts";
import {
  stage2DraftId,
  stage2Fixture,
  stage2LegacyEventId,
  stage2MediaId,
} from "../fixtures/events-stage-2.ts";
import { pngBytes } from "../fixtures/manual-images.ts";
import {
  catalogItem,
  catalogLanguage,
  catalogList,
  chooseCatalogRow,
  envelope,
} from "./support/catalogs.ts";
import { fillDate, fillDateTime, fillTime } from "./support/date-time.ts";
import { eventFixture, eventId, mockEvents, selectPastReportEvent } from "./support/events.ts";
import {
  coverCaption,
  detailsPath,
  eventPath,
  middleCaption,
  mockStructuredDetail,
  nextUnreported,
  unreported,
} from "./support/events-detail.ts";
import { mockEventsStage2 } from "./support/events-stage-2.ts";
import { browserCase, expect, test } from "./support/fixtures.ts";

test.use({ trace: "off", screenshot: "off", video: "off" });
for (const [access, draftsRollout] of [
  ["legacy", false],
  ["member", false],
  ["manager", true],
  ["public", true],
] as const) {
  test(
    `event fixture advertises rollout only for opted-in authenticated reads (${access})`,
    browserCase(["@functional"]),
    async ({ page }) => {
      if (access === "legacy") await mockEvents(page);
      else await mockEventsStage2(page, access, "en", { draftsRollout });
      await page.goto("/en");
      const result = await page.evaluate(async () => {
        const response = await fetch("/api/v1/me", { cache: "no-store" });
        return {
          status: response.status,
          stage2: response.headers.get("X-VTC-Events-Stage2"),
          drafts: response.headers.get("X-VTC-Events-Drafts"),
        };
      });
      expect(result).toEqual({
        status: access === "public" ? 401 : 200,
        stage2: access === "member" || access === "manager" ? "1" : null,
        drafts: access === "manager" ? "1" : null,
      });
    },
  );
}
for (const targetPage of [1, 2]) {
  test(
    `report event selection settles decoded options through page ${targetPage}`,
    browserCase(["@functional"]),
    async ({ page }) => {
      await mockEvents(page);
      const cursors: string[] = [],
        event = {
          ...eventFixture(),
          meetingAt: "2020-10-25T12:00:00.000Z",
          startsAt: "2020-10-25T13:00:00.000Z",
          status: "completed" as const,
        };
      await page.route("**/api/v1/events?*", async (route) => {
        const url = new URL(route.request().url()),
          cursor = url.searchParams.get("cursor") ?? "";
        if (url.searchParams.get("period") !== "past")
          return route.fulfill({
            json: {
              data: { items: [], nextCursor: null },
              meta: { requestId: "synthetic-report-events" },
            },
          });
        cursors.push(cursor);
        const first = targetPage === 2 && !cursor;
        const items = first
          ? Array.from({ length: 25 }, (_, i) => ({
              ...event,
              id: `e0353000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
            }))
          : [event];
        await route.fulfill({
          json: {
            data: { items, nextCursor: first ? "synthetic-report-event-page-2" : null },
            meta: { requestId: "synthetic-report-events" },
          },
        });
      });
      await page.addInitScript(() => {
        const original = window.fetch.bind(window);
        let ordinal = 0;
        window.fetch = async (input, init) => {
          const response = await original(input, init),
            url = new URL(input instanceof Request ? input.url : String(input), location.origin);
          if (url.pathname === "/api/v1/events" && url.searchParams.get("period") === "past") {
            const json = response.json.bind(response);
            response.json = async () => {
              const body = await json();
              // Hold decoded data before the client promise resolves, after HTTP body completion.
              await new Promise<void>((resolve) => {
                const release = () => {
                    clearTimeout(timer);
                    window.removeEventListener("synthetic-release-report-decode", release);
                    resolve();
                  },
                  timer = window.setTimeout(release, 5000);
                window.addEventListener("synthetic-release-report-decode", release, { once: true });
                document.documentElement.dataset.reportDecodeOrdinal = String(++ordinal);
              });
              return body;
            };
          }
          return response;
        };
      });
      await page.goto("/account/reports/new");
      await catalogLanguage(page);
      const selecting = selectPastReportEvent(page, eventId),
        select = page.locator("#report-event");
      void selecting.catch(() => {});
      try {
        for (let ordinal = 1; ordinal <= targetPage; ordinal++) {
          await expect(page.locator("html")).toHaveAttribute(
            "data-report-decode-ordinal",
            String(ordinal),
          );
          await expect(select.locator("..").getByRole("status")).toBeVisible();
          await expect(select.locator(`option[value="${eventId}"]`)).toHaveCount(0);
          await page.evaluate(() =>
            window.dispatchEvent(new Event("synthetic-release-report-decode")),
          );
        }
        await selecting;
        await expect(select).toHaveValue(eventId);
        await expect(
          page.getByRole("link", { name: "View selected event", exact: true }),
        ).toHaveAttribute("href", `/account/events/${eventId}`);
        expect(cursors).toEqual(targetPage === 1 ? [""] : ["", "synthetic-report-event-page-2"]);
      } finally {
        await page
          .evaluate(() => window.dispatchEvent(new Event("synthetic-release-report-decode")))
          .catch(() => {});
        await selecting.catch(() => {});
      }
    },
  );
}
for (const status of [412, 503, 429]) {
  test(
    `attendance page two keeps reviewable drafts and safe authority after ${status}`,
    browserCase(["@functional"]),
    async ({ page }, info) => {
      const state = await mockEvents(page, true);
      state.attendancePages = true;
      state.event.startsAt = "2020-10-25T13:00:00.000Z";
      state.event.meetingAt = "2020-10-25T12:00:00.000Z";
      await page.goto(`/account/events/${eventId}`);
      await page
        .getByRole("button", { name: "View responses and attendance", exact: true })
        .click();
      await page.getByRole("button", { name: "Next page", exact: true }).click();
      const attendance = page.getByRole("combobox", {
        name: "Actual attendance · Fictional Yukon Member",
        exact: true,
      });
      await attendance.selectOption("attended");
      await page
        .getByLabel("Private staff note · Fictional Yukon Member", { exact: true })
        .fill("Fictional page two draft");
      state.failNext = status;
      const save = page.getByRole("button", { name: "Record attendance", exact: true });
      await save.click();
      await expect(page.getByRole("alert").last()).toBeVisible();
      const drafts = page.getByRole("region", { name: "Unsaved attendance changes", exact: true });
      await expect(drafts).toContainText("Fictional page two draft");
      if (status === 412) {
        await expect(attendance).toHaveCount(0);
        await expect(save).toBeDisabled();
        await viewportCapture(page, info, "attendance-stale-page-two-draft");
        await page.getByRole("button", { name: "Next page", exact: true }).click();
        await expect(attendance).toHaveValue("attended");
        await expect(save).toBeDisabled();
        await page
          .getByRole("button", { name: "Keep this draft after review", exact: true })
          .click();
      } else {
        await expect(attendance).toHaveValue("attended");
        expect(state.attendanceCursors.at(-1)).toBe("synthetic-attendance-page-2-v1");
      }
      await save.click();
      await expect(page.getByText("Attendance recorded.", { exact: true })).toBeVisible();
      expect(state.preconditions).toEqual(['"v1"', status === 412 ? '"v2"' : '"v1"']);
      expect(state.keys[0] === state.keys[1]).toBe(status !== 412);
      expect(state.commands[1]?.body).toEqual(state.commands[0]?.body);
    },
  );
}
test(
  "attendance lost receipt retries the original decision after refreshed collection authority",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await mockEvents(page, true);
    state.attendancePages = true;
    state.event.startsAt = "2020-10-25T13:00:00.000Z";
    state.event.meetingAt = "2020-10-25T12:00:00.000Z";
    await page.goto(`/account/events/${eventId}`);
    await page.getByRole("button", { name: "View responses and attendance", exact: true }).click();
    await page.getByRole("button", { name: "Next page", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Actual attendance · Fictional Yukon Member", exact: true })
      .selectOption("attended");
    state.loseAttendanceReceipt = true;
    await page.getByRole("button", { name: "Record attendance", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("result is unknown");
    expect(state.attendanceDecisions).toBe(1);
    await page.getByRole("button", { name: "First page", exact: true }).click();
    await page.getByRole("button", { name: "Next page", exact: true }).click();
    expect(state.attendanceCursors.at(-1)).toBe("synthetic-attendance-page-2-v2");
    await page.getByRole("button", { name: "Record attendance", exact: true }).click();
    await expect(page.getByText("Attendance recorded.", { exact: true })).toBeVisible();
    expect(state.preconditions).toEqual(['"v1"', '"v1"']);
    expect(state.keys[0]).toBe(state.keys[1]);
    expect(state.commands[0]?.body).toEqual(state.commands[1]?.body);
    expect(state.attendanceDecisions).toBe(1);
  },
);
test(
  "Stage 2 attendance requires reviewing an off-page draft against the newer roster",
  browserCase(["@functional"]),
  async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("vtc.locale", "en"));
    const state = await mockStructuredDetail(page, "en", "director");
    state.member.event.meetingAt = "2020-10-25T12:00:00.000Z";
    state.member.event.startsAt = "2020-10-25T13:00:00.000Z";
    type Attendance = components["schemas"]["EventStage2Attendance"];
    const fixture = stage2Fixture("getEventAttendance", "leadership")
      .response as components["schemas"]["EventStage2EnvelopeAttendance"];
    const first = fixture.data.items[0];
    if (!first) throw new Error("Missing synthetic attendance row");
    const target = {
      ...first.member,
      id: "e1320000-0000-4000-8000-000000000098",
      nickname: "Fictional Attendance Driver",
    };
    const path = `/api/v1/admin${eventPath}/attendance`;
    let version = 1;
    let recorded: Attendance["items"][number]["attendance"] = "unconfirmed";
    const writes: { etag: string | undefined; body: unknown }[] = [];
    await page.route(
      (url) => url.pathname === path,
      (route) => {
        const request = route.request();
        if (request.method() === "PUT") {
          const etag = request.headers()["if-match"];
          const body = request.postDataJSON();
          writes.push({ etag, body });
          if (etag !== `"v${version}"`) return route.fulfill({ status: 412 });
          recorded = body.members[0].attendance;
          version++;
          return route.fulfill({
            json: envelope({ id: state.member.event.id, version }),
            headers: { ETag: `"v${version}"` },
          });
        }
        const { searchParams } = new URL(request.url());
        if (searchParams.get("view") !== "stage2") return route.fulfill({ status: 422 });
        const cursor = searchParams.get("cursor");
        const nextCursor = `fictional-attendance-v${version}`;
        if (cursor && cursor !== nextCursor) return route.fulfill({ status: 412 });
        const data: Attendance = {
          items: cursor
            ? [{ ...first, member: target, attendance: recorded, tripId: null }]
            : [first],
          totals: {
            total: 2,
            attended: 1 + Number(recorded === "attended"),
            notAttended: Number(recorded === "not_attended"),
            unconfirmed: Number(recorded === "unconfirmed"),
          },
          nextCursor: cursor ? null : nextCursor,
        };
        return route.fulfill({
          json: envelope(data),
          headers: { ETag: `"v${version}"` },
        });
      },
    );
    await page.goto(detailsPath);
    await page.getByRole("button", { name: "View responses and attendance", exact: true }).click();
    const roster = page.getByRole("form", { name: "Actual attendance", exact: true });
    const next = roster.getByRole("button", { name: "Next page", exact: true });
    const record = roster.getByRole("button", { name: "Record attendance", exact: true });
    const targetRow = roster.getByRole("group", { name: target.nickname, exact: true });
    const decision = targetRow.getByRole("combobox");
    const note = targetRow.getByRole("textbox", {
      name: `Private staff note · ${target.nickname}`,
    });
    await next.click();
    await decision.selectOption("attended");
    await note.fill("Fictional draft at v1");
    await expect(record).toBeEnabled();

    recorded = "not_attended";
    version = 2;
    const updated = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === "GET" &&
        url.pathname === path &&
        !url.searchParams.has("cursor")
      );
    });
    await roster.getByRole("button", { name: "First page", exact: true }).click();
    const firstPage = await updated;
    expect(new URL(firstPage.url()).searchParams.getAll("view")).toEqual(["stage2"]);
    expect(firstPage.headers().etag).toBe('"v2"');
    await expect(targetRow).toHaveCount(0);
    await expect(roster.getByRole("status")).toContainText("Attendance changed");
    await expect(record).toBeDisabled();
    await record.press("Enter");

    await next.click();
    await expect(targetRow).toContainText("Actual attendance: Did not attend");
    await expect(decision).toHaveValue("attended");
    await expect(note).toHaveValue("Fictional draft at v1");
    await note.fill("Fictional note after checking the current row");
    await expect(record).toBeDisabled();
    expect(writes).toEqual([]);
    await targetRow
      .getByRole("button", { name: "Keep this draft after review", exact: true })
      .click();
    await expect(record).toBeEnabled();
    await record.click();
    await expect(roster.getByText("Attendance recorded.", { exact: true })).toBeVisible();
    expect(writes).toEqual([
      {
        etag: '"v2"',
        body: {
          members: [
            {
              memberId: target.id,
              attendance: "attended",
              note: "Fictional note after checking the current row",
            },
          ],
        },
      },
    ]);
  },
);
test(
  "changing own RSVP from participants page two resets to the current first page",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await mockEvents(page);
    state.response = { response: "participating", declineReason: null, version: 2 };
    state.participantPages = true;
    await page.goto(`/account/events/${eventId}`);
    const participants = page.getByRole("region", { name: "Signed up", exact: true });
    await participants.getByRole("button", { name: "Next page", exact: true }).click();
    await expect(
      participants.getByRole("link", { name: "Fictional Yukon Member", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("group", { name: "Your response", exact: true })
      .getByRole("button", { name: "Can't attend", exact: true })
      .click();
    await page
      .getByLabel("Private decline reason", { exact: true })
      .fill("Fictional change from page two");
    await page.getByRole("button", { name: "Save response", exact: true }).click();
    await expect(page.getByText("Response saved.", { exact: true })).toBeVisible();
    await expect(
      participants.getByRole("link", { name: "Fictional participant 1", exact: true }),
    ).toBeVisible();
    await expect(
      participants.getByRole("link", { name: "Fictional Yukon Member", exact: true }),
    ).toHaveCount(0);
    await expect(participants.getByRole("button", { name: "First page", exact: true })).toHaveCount(
      0,
    );
    expect(state.participantCursors).toEqual(["", "synthetic-participant-page-2", ""]);
  },
);
test(
  "changing own RSVP from decliners page two resets to the current first page",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await mockEvents(page);
    state.response = { response: "declined", declineReason: "Fictional old reason", version: 2 };
    state.declinerPages = true;
    await page.goto(`/account/events/${eventId}`);
    const decliners = page.getByRole("region", { name: "Can't attend", exact: true });
    await decliners.getByRole("button", { name: "Next page", exact: true }).click();
    await expect(
      decliners.getByRole("link", { name: "Fictional Yukon Member", exact: true }),
    ).toBeVisible();
    await expect(decliners).toContainText("(you)");
    await expect(decliners).not.toContainText("Fictional old reason");
    await page
      .getByRole("group", { name: "Your response", exact: true })
      .getByRole("button", { name: "Participating", exact: true })
      .click();
    await expect(page.getByRole("button", { name: "Save response", exact: true })).toHaveCount(0);
    await expect(page.getByText("Response saved.", { exact: true })).toBeVisible();
    await expect(
      decliners.getByRole("link", { name: "Fictional decliner 1", exact: true }),
    ).toBeVisible();
    await expect(
      decliners.getByRole("link", { name: "Fictional Yukon Member", exact: true }),
    ).toHaveCount(0);
    await expect(decliners.getByRole("button", { name: "First page", exact: true })).toHaveCount(0);
    expect(state.declinerCursors).toEqual(["", "synthetic-decliner-page-2", ""]);
    await expect(
      page.getByRole("region", { name: "Signed up", exact: true }).getByRole("link", {
        name: "Fictional Yukon Member",
        exact: true,
      }),
    ).toBeVisible();
  },
);
async function viewportCapture(page: Page, info: TestInfo, name: string) {
  const observation = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]'),
      bounds = dialog?.getBoundingClientRect();
    return {
      width: innerWidth,
      height: innerHeight,
      activeTag: document.activeElement?.tagName,
      activeId: document.activeElement?.id,
      dialog: bounds
        ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
        : null,
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  expect(observation.overflow).toBe(false);
  if (observation.dialog) {
    expect(observation.dialog.x).toBeGreaterThanOrEqual(0);
    expect(observation.dialog.y).toBeGreaterThanOrEqual(0);
    expect(observation.dialog.x + observation.dialog.width).toBeLessThanOrEqual(
      observation.width + 1,
    );
    expect(observation.dialog.y + observation.dialog.height).toBeLessThanOrEqual(
      observation.height + 1,
    );
  }
  await page.screenshot({
    path: info.outputPath(`${name}.png`),
    fullPage: false,
    animations: "disabled",
  });
  await writeFile(info.outputPath(`${name}.json`), JSON.stringify(observation));
}
test(
  "nearest event coalesces its start boundary with bounded notification refresh",
  browserCase(["@functional"]),
  async ({ page }) => {
    await page.clock.install({ time: new Date("2026-10-27T12:00:00.000Z") });
    const state = await mockEvents(page);
    state.event.meetingAt = "2026-10-27T12:00:00.000Z";
    state.event.startsAt = "2026-10-27T12:01:00.000Z";
    await page.goto(`/account/events/${eventId}`);
    await expect(page.locator(".event-nearest a")).toHaveAttribute(
      "href",
      `/account/events/${eventId}`,
    );
    state.upcoming = {
      ...state.event,
      id: "e0350000-0000-4000-8000-000000000004",
      title: "Fictional next convoy",
      startsAt: "2026-10-27T13:00:00.000Z",
    };
    await page.clock.fastForward(61000);
    await expect(page.locator(".event-nearest strong")).toContainText("Fictional next convoy");
    // Initial header + one start-boundary read + at most one coalesced notification cycle.
    const reads = state.requests.filter((r) => r === "GET /me/upcoming-event").length;
    expect(reads).toBeGreaterThanOrEqual(2);
    expect(reads).toBeLessThanOrEqual(3);
  },
);
test(
  "nearest boundary hides an expired same generation without looping if the client is ahead",
  browserCase(["@functional"]),
  async ({ page }) => {
    await page.clock.install({ time: new Date("2026-10-27T12:00:00.000Z") });
    const state = await mockEvents(page);
    state.event.meetingAt = "2026-10-27T12:00:00.000Z";
    state.event.startsAt = "2026-10-27T12:01:00.000Z";
    await page.goto(`/account/events/${eventId}`);
    await expect(page.locator(".event-nearest strong")).toBeVisible();
    await page.clock.fastForward(61000);
    await expect(page.locator(".event-nearest a")).toHaveText(
      "Check the event list for the next convoy",
    );
    await page.clock.fastForward(180000);
    // Fast-forward coalesces elapsed polling ticks. The unchanged start generation
    // must not add a self-triggered refresh loop to the two elapsed feed cycles.
    const reads = state.requests.filter((r) => r === "GET /me/upcoming-event").length;
    expect(reads).toBeGreaterThanOrEqual(2);
    expect(reads).toBeLessThanOrEqual(4);
  },
);
test(
  "nearest event keeps one request across locale changes and preserves accessible unanswered header",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await mockEvents(page);
    await page.goto(`/account/events/${eventId}`);
    await expect(page.locator(".event-nearest a")).toHaveAttribute(
      "href",
      `/account/events/${eventId}`,
    );
    await expect(page.locator(".event-nearest strong")).toContainText("Nearest event");
    expect(state.requests.filter((r) => r === "GET /me/upcoming-event")).toHaveLength(1);
    await catalogLanguage(page, "ru");
    await expect(page.locator(".event-nearest strong")).toContainText("Ближайшее событие");
    expect(state.requests.filter((r) => r === "GET /me/upcoming-event")).toHaveLength(1);
    await catalogLanguage(page);
    await expect(page.locator(".event-nearest strong")).toContainText("Nearest event");
    expect(state.requests.filter((r) => r === "GET /me/upcoming-event")).toHaveLength(1);
  },
);
test(
  "event loading and unknown command results preserve exact retry identity and historical load",
  browserCase(["@functional"]),
  async ({ page }, info) => {
    const state = await mockEvents(page, true);
    let release = () => {};
    state.readGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prescribedCargoId = "e0350000-0000-4000-8000-000000000002";
    await page.route(
      (url) => url.pathname === `/api/v1/catalogs/cargoes/${prescribedCargoId}`,
      (route) =>
        route.fulfill({
          json: envelope(
            catalogItem(prescribedCargoId, "Fictional prescribed", "en", { game: "ats" }),
          ),
        }),
    );
    try {
      await page.goto("/events");
      await catalogLanguage(page);
      await expect(page.getByRole("status")).toContainText("Loading events");
      await page.screenshot({ path: info.outputPath("loading.png"), fullPage: true });
    } finally {
      release();
      state.readGate = null;
    }
    state.prescribedCargoId = prescribedCargoId;
    state.prescribedMassKg = "21000.000000000000000001";
    state.prescribedTrailerTypeId = "e0350000-0000-4000-8000-000000000003";
    await page.goto(`/account/events/${eventId}`);
    await page.getByRole("button", { name: "Edit event", exact: true }).click();
    const dialog = page.getByRole("dialog"),
      save = dialog.getByRole("button", { name: "Save changes", exact: true });
    expect(state.requests.some((r) => r.includes("/catalogs/"))).toBe(false);
    await dialog.getByRole("button", { name: "Choose catalog selections", exact: true }).click();
    // A row from another game stays readable and asks for a new choice.
    const cargoField = dialog.getByRole("combobox", { name: "Prescribed cargo", exact: true });
    await expect(cargoField).toHaveValue("Fictional prescribed");
    await expect(dialog.getByText(/Hidden or from another game/)).toBeVisible();
    await expect(cargoField).toHaveAttribute("data-historical", "true");
    // Lists are read only once opened; Escape inside the open list must not close the dialog.
    await cargoField.click();
    await expect(
      dialog.getByRole("alert").filter({ hasText: "Catalog data could not be read" }).first(),
    ).toBeVisible();
    await expect(dialog.getByRole("option", { name: /^Not listed/ })).toHaveCount(0);
    await cargoField.press("Escape");
    await expect(cargoField).toHaveAttribute("aria-expanded", "false");
    await expect(dialog).toBeVisible();
    await expect(cargoField).toHaveValue("Fictional prescribed");
    state.failNext = 599;
    await save.click();
    await expect(dialog.getByRole("alert").filter({ hasText: "result is unknown" })).toBeVisible();
    state.failNext = 599;
    await save.click();
    await expect.poll(() => state.keys.length).toBe(2);
    expect(state.keys[0]).toBe(state.keys[1]);
    await dialog
      .getByLabel("Route", { exact: true })
      .fill("Fictional changed route after uncertainty");
    await save.click();
    await expect(dialog.getByRole("status")).toHaveText("Changes saved.");
    await fillDateTime(dialog, "Start time (UTC)", "2099-10-25T14:00");
    await expect(dialog.getByText("Changes saved.", { exact: true })).toHaveCount(0);
    await save.click();
    await expect(dialog.getByRole("status")).toHaveText("Changes saved.");
    await dialog.getByLabel("Game", { exact: true }).selectOption("ats");
    await expect(dialog.getByText("Changes saved.", { exact: true })).toHaveCount(0);
    // The event editor clears its catalog selections when the game changes.
    await expect(cargoField).toHaveValue("");
    expect(state.keys[2]).not.toBe(state.keys[1]);
    expect(state.commands[2]?.body).toMatchObject({
      prescribedCargoId: state.prescribedCargoId,
      prescribedTrailerTypeId: state.prescribedTrailerTypeId,
      prescribedMassKg: state.prescribedMassKg,
    });
  },
);
for (const locale of ["en", "ru"] as const) {
  test(
    `events ${locale} public and member views fit viewport and keep private reads scoped`,
    browserCase(["@layout"]),
    async ({ page }, info) => {
      const state = await mockEvents(page, false, locale);
      if (locale === "ru") {
        state.event.title = "Фиктивный конвой компании с длинным названием маршрута "
          .repeat(3)
          .trim();
        state.event.route = "Фиктивный северный город → Фиктивный южный порт с длинным названием";
      }
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/events/${eventId}`);
      await catalogLanguage(page, locale);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(state.event.title);
      await expect(page.getByText("Europe/Warsaw")).toHaveCount(0);
      expect(
        state.requests.some((r) =>
          /participants|decliners|response-counts|attendance|my-response/.test(r),
        ),
      ).toBe(false);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: info.outputPath(`public-${locale}.png`),
        fullPage: true,
        animations: "disabled",
      });
      await page.goto(`/account/events/${eventId}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(state.event.title);
      await expect(
        page.getByRole("group", {
          name: locale === "en" ? "Your response" : "Ваш ответ",
          exact: true,
        }),
      ).toBeVisible();
      expect(state.requests.some((r) => r.includes("/admin/"))).toBe(false);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: info.outputPath(`member-${locale}.png`),
        fullPage: true,
        animations: "disabled",
      });
      state.listPages = true;
      await page.goto(locale === "en" ? "/en" : "/");
      const widget = page
        .getByRole("heading", {
          name: locale === "en" ? "The convoy leaves on schedule" : "Колонна уходит по расписанию",
          exact: true,
        })
        .locator("xpath=ancestor::section[1]");
      await widget.evaluate((element) => element.scrollIntoView({ block: "start" }));
      await viewportCapture(page, info, `landing-populated-${locale}`);
      await widget.screenshot({
        path: info.outputPath(`landing-widget-${locale}.png`),
        animations: "disabled",
      });
      await page.goto("/account/events");
      await catalogLanguage(page, locale);
      await expect(
        page.getByRole("heading", { name: state.event.title, exact: true }),
      ).toBeVisible();
      await viewportCapture(page, info, `member-list-${locale}`);
      await page
        .getByRole("button", { name: locale === "en" ? "Past" : "Прошедшие", exact: true })
        .click();
      await expect(
        page.getByText(locale === "en" ? "Completed" : "Завершено", { exact: true }),
      ).toBeVisible();
      await viewportCapture(page, info, `past-list-${locale}`);
      await page
        .getByRole("button", {
          name: locale === "en" ? "Next page" : "Следующая страница",
          exact: true,
        })
        .click();
      await expect(
        page.getByRole("heading", { name: "Fictional second page convoy", exact: true }),
      ).toBeVisible();
      expect(new URL(page.url()).searchParams.get("cursor")).toBe("synthetic-event-page-2");
      await viewportCapture(page, info, `cursor-list-${locale}`);
    },
  );
}
test(
  "RSVP prevents duplicates, retains decline input on stale and clears private state on session loss",
  browserCase(["@functional", "@smoke-events"]),
  async ({ page }, info) => {
    const state = await mockEvents(page);
    await page.goto(`/account/events/${eventId}`);
    await page
      .getByRole("group", { name: "Your response", exact: true })
      .getByRole("button", { name: "Can't attend", exact: true })
      .click();
    const reason = page.getByRole("textbox", { name: "Private decline reason", exact: true });
    await reason.fill("   ");
    await page.getByRole("button", { name: "Save response", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Check");
    for (const locale of ["en", "ru"] as const) {
      await catalogLanguage(page, locale);
      await viewportCapture(page, info, `decline-validation-${locale}`);
    }
    await catalogLanguage(page);
    expect(state.commands).toHaveLength(0);
    await reason.fill("Fictional retained reason");
    state.failNext = 412;
    await page.getByRole("button", { name: "Save response", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("changed");
    await expect(reason).toHaveValue("Fictional retained reason");
    let release = () => {};
    state.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.getByRole("button", { name: "Save response", exact: true }).click();
    await expect.poll(() => state.commands.length).toBe(2);
    await expect(
      page.getByRole("button", { name: "Saving response…", exact: true }),
    ).toBeDisabled();
    for (const locale of ["en", "ru"] as const) {
      await catalogLanguage(page, locale);
      await viewportCapture(page, info, `decline-pending-${locale}`);
    }
    await catalogLanguage(page);
    release();
    await expect(page.getByRole("status").filter({ hasText: "Response saved." })).toBeVisible();
    expect(state.preconditions).toEqual(['"v1"', '"v2"']);
    state.session = false;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByText("Fictional retained reason", { exact: true })).toHaveCount(0);
    await expect(reason).toHaveCount(0);
  },
);
test(
  "organizer stale edit preserves draft, cancellation dialog restores focus, attendance records intentional rows",
  browserCase(["@functional"]),
  async ({ page }, info) => {
    const state = await mockEvents(page, true);
    await page.goto(`/account/events/${eventId}`);
    const edit = page.getByRole("button", { name: "Edit event", exact: true });
    await edit.click();
    const dialog = page.getByRole("dialog"),
      title = dialog.getByLabel("Event title", { exact: true });
    await title.fill("Fictional revised convoy");
    state.failNext = 412;
    await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("changed");
    await expect(title).toHaveValue("Fictional revised convoy");
    await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(dialog.getByRole("status")).toHaveText("Changes saved.");
    expect(state.preconditions).toEqual(['"v1"', '"v2"']);
    await dialog.evaluate((el) => {
      el.scrollTop = 0;
    });
    await viewportCapture(page, info, "organizer-viewport");
    await page.screenshot({
      path: info.outputPath("organizer.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
    await expect(edit).toBeFocused();
    await catalogLanguage(page, "ru");
    await page.getByRole("button", { name: "Изменить событие", exact: true }).click();
    await viewportCapture(page, info, "organizer-ru-viewport");
    await page.screenshot({
      path: info.outputPath("organizer-ru.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
    await catalogLanguage(page);
    for (const locale of ["ru", "en"] as const) {
      await catalogLanguage(page, locale);
      const cancel = page.getByRole("button", {
        name: locale === "en" ? "Cancel event" : "Отменить событие",
        exact: true,
      });
      await cancel.click();
      await page
        .getByRole("dialog")
        .getByLabel(locale === "en" ? "Private reason" : "Личная причина", { exact: true })
        .fill("Fictional cancellation review");
      await viewportCapture(page, info, `cancellation-dialog-${locale}`);
      await page.keyboard.press("Escape");
      await expect(cancel).toBeFocused();
    }
    await expect(page.getByRole("button", { name: "Cancel event", exact: true })).toBeFocused();
    state.event.startsAt = "2020-10-25T13:00:00.000Z";
    state.event.meetingAt = "2020-10-25T12:00:00.000Z";
    await page.reload();
    await page.getByRole("button", { name: "View responses and attendance", exact: true }).click();
    await expect(page.getByText("Fictional private RSVP reason", { exact: false })).toBeVisible();
    await page
      .getByRole("combobox", { name: "Actual attendance · Fictional Yukon Member", exact: true })
      .selectOption("attended");
    state.failNext = 412;
    await page.getByRole("button", { name: "Record attendance", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("changed");
    await page.getByRole("button", { name: "Keep this draft after review", exact: true }).click();
    await page.getByRole("button", { name: "Record attendance", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Attendance recorded." }),
    ).toBeVisible();
    await page
      .getByRole("combobox", { name: "Actual attendance · Fictional Yukon Member", exact: true })
      .selectOption("not_attended");
    await expect(page.getByText("Attendance recorded.", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Record attendance", exact: true }).click();
    await expect(page.getByText("Attendance recorded.", { exact: true })).toBeVisible();
    await page
      .getByRole("combobox", { name: "Actual attendance · Fictional Yukon Member", exact: true })
      .selectOption("attended");
    await page
      .getByLabel("Private staff note · Fictional Yukon Member", { exact: true })
      .fill("Fictional unsaved note");
    await expect(page.getByText("Attendance recorded.", { exact: true })).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath("attendance.png"),
      fullPage: true,
      animations: "disabled",
    });
    await catalogLanguage(page, "ru");
    await viewportCapture(page, info, "attendance-ru-viewport");
    await page.screenshot({
      path: info.outputPath("attendance-ru.png"),
      fullPage: true,
      animations: "disabled",
    });
  },
);
test(
  "public list empty error recovery cursor reset cancelled and inaccessible states are honest",
  browserCase(["@functional"]),
  async ({ page }, info) => {
    const state = await mockEvents(page);
    state.listStatus = 503;
    await page.goto("/events?period=past&cursor=obsolete");
    await catalogLanguage(page);
    await expect(page.getByRole("alert")).toContainText("unavailable");
    for (const locale of ["en", "ru"] as const) {
      await catalogLanguage(page, locale);
      await viewportCapture(page, info, `error-${locale}`);
    }
    await catalogLanguage(page);
    state.listStatus = 200;
    state.empty = true;
    await page.getByRole("button", { name: "Start from first page", exact: true }).click();
    await expect(page.getByText("No events in this period.", { exact: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.has("cursor")).toBe(false);
    await page.screenshot({ path: info.outputPath("empty.png"), fullPage: true });
    state.event.status = "cancelled";
    await page.goto(`/events/${eventId}`);
    await catalogLanguage(page);
    await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath("cancelled.png"), fullPage: true });
    state.status = 404;
    await page.reload();
    await catalogLanguage(page);
    await expect(page.getByRole("alert")).toContainText("do not have access");
    for (const locale of ["en", "ru"] as const) {
      await catalogLanguage(page, locale);
      await viewportCapture(page, info, `inaccessible-${locale}`);
    }
  },
);

test(
  "member opens the full gallery with the keyboard and returns focus to the thumbnail",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await mockStructuredDetail(page, "en", "driver");
    await page.goto(detailsPath);
    const gallery = page.getByRole("region", { name: "Gallery" });
    const cover = gallery.getByRole("button", { name: `View image: ${coverCaption}` });
    await expect(cover).toBeVisible();
    expect(state.requests.some((url) => url.searchParams.get("size") === "full")).toBe(false);
    await cover.focus();
    await page.keyboard.press("Enter");
    const viewer = page.getByRole("dialog", { name: "Image 1 of 3" });
    await expect(viewer).toBeVisible();
    await expect(viewer.getByRole("button", { name: "Close", exact: true })).toBeFocused();
    await expect(viewer.getByRole("img", { name: coverCaption })).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("dialog", { name: "Image 2 of 3" })).toHaveAccessibleDescription(
      middleCaption,
    );
    await expect(page.getByRole("dialog").getByRole("img", { name: middleCaption })).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(viewer.getByRole("img", { name: coverCaption })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(cover).toBeFocused();
    expect(
      state.requests.some(
        (url) => url.pathname.includes(stage2MediaId) && url.searchParams.get("size") === "full",
      ),
    ).toBe(true);
  },
);

function trackGuestReads(page: Page) {
  const requests: Request[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/v1/")) requests.push(request);
  });
  return requests;
}

function guestRequestPaths(requests: Request[]) {
  return requests.map((request) => {
    const { pathname, search } = new URL(request.url());
    return `${request.method()} ${pathname}${search}`;
  });
}

test(
  "public detail reads one strict Stage 2 response and only the advertised cover",
  browserCase(["@functional"]),
  async ({ page, baseURL }) => {
    if (!baseURL) throw new Error("The public detail test requires a base URL");
    await page
      .context()
      .addCookies([{ name: "fictional_public_cookie", value: "fictional", url: baseURL }]);
    const state = await mockStructuredDetail(page, "ru");
    const reads = trackGuestReads(page);
    await page.goto(eventPath);
    await expect(page.getByRole("img", { name: "Обложка события" })).toBeVisible();
    const organizer = page.getByRole("region", { name: "Организатор" });
    await expect(organizer).toContainText(state.member.event.organizer);
    await expect(organizer.getByRole("link")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Ваш ответ" })).toHaveCount(0);
    await expect(page.getByText("Синтетический груз", { exact: true })).toHaveCount(0);
    expect(guestRequestPaths(reads)).toEqual([
      `GET /api/v1/public${eventPath}?locale=ru`,
      `GET /api/v1/public${eventPath}/cover`,
    ]);
    for (const request of reads) expect(await request.headerValue("cookie")).toBeNull();
  },
);

test(
  "public detail reads one strict legacy response at the same localized URL",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await mockEvents(page, false, "ru");
    state.session = false;
    state.event.origin = {
      entityId: "e0350000-0000-4000-8000-000000000093",
      label: "Фиктивная северная гавань",
      englishFallback: false,
      requestedLocale: "ru",
      renderedLocale: "ru",
      hidden: false,
    };
    const reads = trackGuestReads(page);
    await page.goto(`/events/${eventId}`);
    await expect(page.getByRole("heading", { name: state.event.title })).toBeVisible();
    await expect(page.getByText("Фиктивная северная гавань", { exact: true })).toBeVisible();
    const organizer = page.getByRole("region", { name: "Организатор" });
    await expect(organizer).toContainText(state.event.organizer);
    await expect(organizer.getByRole("link")).toHaveCount(0);
    await expect(page.getByRole("img", { name: "Обложка события" })).toHaveCount(0);
    await expect(page.getByText("Не нужны, хватит базовой карты")).toHaveCount(0);
    expect(guestRequestPaths(reads)).toEqual([`GET /api/v1/public/events/${eventId}?locale=ru`]);
  },
);

test(
  "public detail renders a Stage 2 legacy row with organizer text and no cover",
  browserCase(["@functional"]),
  async ({ page }) => {
    await mockStructuredDetail(page, "ru");
    const reads = trackGuestReads(page);
    await page.goto(`/events/${stage2LegacyEventId}`);
    await expect(page.getByText("Не нужны, хватит базовой карты", { exact: true })).toBeVisible();
    const legacy = (
      stage2Fixture("listPublicEvents", "structured-and-legacy")
        .response as components["schemas"]["EventStage2EnvelopePublicList"]
    ).data.items[1];
    if (!legacy) throw new Error("Missing legacy row fixture");
    const organizer = page.getByRole("region", { name: "Организатор" });
    await expect(organizer).toContainText(legacy.organizer);
    await expect(organizer.getByRole("link")).toHaveCount(0);
    await expect(page.getByRole("img", { name: "Обложка события" })).toHaveCount(0);
    expect(guestRequestPaths(reads)).toEqual([
      `GET /api/v1/public/events/${stage2LegacyEventId}?locale=ru`,
    ]);
  },
);

test(
  "dispatcher sees an empty gallery for an absent media endpoint and cannot manage the event",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await mockStructuredDetail(page, "en", "dispatcher");
    state.missingMedia = true;
    await page.goto(detailsPath);
    const gallery = page.getByRole("region", { name: "Gallery" });
    await expect(gallery).toContainText("No images have been added to this event.");
    await expect(page.getByRole("button", { name: "View responses and attendance" })).toHaveCount(
      0,
    );
    await expect(page.getByRole("button", { name: "Cancel event" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Edit event" })).toHaveCount(0);
    expect(state.requests.some((url) => url.pathname.includes(`/admin${eventPath}`))).toBe(false);
  },
);

test(
  "gallery read failure can be retried without showing an empty state",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await mockStructuredDetail(page, "en", "driver");
    state.mediaFailure = true;
    await page.goto(detailsPath);
    const gallery = page.getByRole("region", { name: "Gallery" });
    await expect(gallery.getByRole("alert")).toBeVisible();
    await expect(gallery.getByText("No images have been added to this event.")).toHaveCount(0);
    state.mediaFailure = false;
    await gallery.getByRole("button", { name: "Try again" }).click();
    await expect(
      gallery.getByRole("button", { name: `View image: ${coverCaption}` }),
    ).toBeVisible();
  },
);

for (const role of ["director", "deputy_director"] as const) {
  test(
    `${role} sees leadership-only attendance totals, canonical trip and nonresponders`,
    browserCase(["@functional"]),
    async ({ page }) => {
      const state = await mockStructuredDetail(page, "en", role);
      await page.goto(detailsPath);
      const show = page.getByRole("button", { name: "View responses and attendance" });
      await expect(show).toBeVisible();
      expect(state.requests.some((url) => url.pathname.includes(`/admin${eventPath}`))).toBe(false);
      await expect(page.getByRole("button", { name: "Cancel event" })).toBeEnabled();
      const rosterRead = page.waitForRequest(
        (request) =>
          request.method() === "GET" &&
          new URL(request.url()).pathname === `/api/v1/admin${eventPath}/attendance`,
      );
      await show.click();
      expect(new URL((await rosterRead).url()).searchParams.getAll("view")).toEqual(["stage2"]);
      const attendance = page.locator(".events-attendance-totals");
      await expect(attendance).toContainText("Total members");
      await expect(attendance.getByText("2", { exact: true })).toBeVisible();
      const trip = page.getByRole("link", { name: "View trip for Fictional Coordinator" });
      await expect(trip).toHaveAttribute(
        "href",
        "/account/trips/e1320000-0000-4000-8000-000000000011",
      );
      const nonresponders = page.getByRole("region", { name: "No response yet" });
      await expect(nonresponders.getByRole("link", { name: unreported })).toBeVisible();
      const noTrip = page.getByRole("group", { name: unreported, exact: true });
      await expect(noTrip.getByRole("link", { name: /^View trip/ })).toHaveCount(0);
      await nonresponders.getByRole("button", { name: "Next page" }).click();
      await expect(nonresponders.getByRole("link", { name: nextUnreported })).toBeVisible();
      await expect(nonresponders.getByRole("heading")).toBeFocused();
    },
  );
}

test(
  "Stage 2 leadership cancellation retains its reason across stale definition authority",
  browserCase(["@functional"]),
  async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("vtc.locale", "en"));
    const state = await mockStructuredDetail(page, "en", "director");
    await page.goto(detailsPath);
    await page.getByRole("button", { name: "Cancel event", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const reason = dialog.getByLabel("Private reason");
    const confirm = dialog.getByRole("button", { name: "Confirm cancellation" });
    await reason.fill("Fictional snow closure");
    state.staleCancellation = true;
    await confirm.click();
    await expect(dialog.getByRole("alert")).toContainText("changed");
    await expect(reason).toHaveValue("Fictional snow closure");
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Your response" })).toContainText(
      "Your response before the start",
    );
    expect(state.cancellations.map(({ body, etag, locale }) => ({ body, etag, locale }))).toEqual([
      { body: { reason: "Fictional snow closure" }, etag: '"v1"', locale: "en" },
      { body: { reason: "Fictional snow closure" }, etag: '"v2"', locale: "en" },
    ]);
    expect(state.cancellations[0]?.key).toBeTruthy();
    expect(state.cancellations[0]?.key).not.toBe(state.cancellations[1]?.key);
  },
);

test(
  "a member can clear a response immediately without a reason or Save",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await mockEvents(page);
    state.response = { version: 3, response: "participating", declineReason: null };
    await page.goto(`/account/events/${eventId}`);
    const section = page.getByRole("region", { name: "Your response" });
    const clear = section.getByRole("button", { name: "No answer" });
    await expect(section.getByRole("button", { name: "Participating" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await clear.click();
    await expect(section.getByRole("status")).toHaveText("Response saved.");
    await expect(clear).toHaveAttribute("aria-pressed", "true");
    await expect(clear).toBeFocused();
    await expect(section.getByLabel("Private decline reason")).toHaveCount(0);
    await expect(section.getByRole("button", { name: "Save response" })).toHaveCount(0);
    expect(state.commands).toEqual([
      { method: "PUT", path: `/events/${eventId}/my-response`, body: { response: "unanswered" } },
    ]);
    expect(state.preconditions).toEqual(['"v3"']);
  },
);

function trackMemberDetailReads(page: Page, path: string) {
  const locales: (string | null)[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname === `/api/v1${path}`)
      locales.push(url.searchParams.get("locale"));
  });
  return locales;
}

test(
  "member detail selects one localized Stage 2 read from the session flag",
  browserCase(["@functional"]),
  async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("vtc.locale", "en"));
    await mockEventsStage2(page, "member");
    const locales = trackMemberDetailReads(page, eventPath);
    await page.goto(detailsPath);
    await expect(page.getByRole("heading", { name: "Fictional northern convoy" })).toBeVisible();
    await expect(page.getByText("TruckersMP", { exact: true })).toBeVisible();
    expect(locales).toEqual(["en"]);
  },
);

for (const status of [404, 422, 503] as const) {
  test(
    `member detail stays on Stage 2 after HTTP ${status}`,
    browserCase(["@functional"]),
    async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem("vtc.locale", "en"));
      const state = await mockEventsStage2(page, "member");
      state.statusByRequest.set(`GET ${eventPath}`, status);
      const locales = trackMemberDetailReads(page, eventPath);
      await page.goto(detailsPath);
      await expect(page.locator(".events-detail").getByRole("alert")).toBeVisible();
      expect(locales).toEqual(["en"]);
    },
  );
}

test(
  "member detail uses legacy reads and cancellation without the Stage 2 session flag",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await mockEvents(page, true);
    state.extraParticipants = [
      {
        member: {
          id: "e0350000-0000-4000-8000-000000000099",
          nickname: "Fictional legacy participant",
          roles: ["driver"],
          formerMember: false,
        },
      },
    ];
    await page.addInitScript(() => localStorage.setItem("vtc.locale", "en"));
    const reads = trackMemberDetailReads(page, `/events/${eventId}`);
    await page.goto(`/account/events/${eventId}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(state.event.title);
    expect(reads).toEqual([null]);
    await expect(page.getByRole("region", { name: "Gallery" })).toContainText(
      "No images have been added to this event.",
    );
    await expect(page.getByText("Base map is enough", { exact: true })).toHaveCount(0);
    await expect(page.locator(".events-counts")).toContainText("Participating: 1");
    await expect(page.getByRole("link", { name: "Fictional legacy participant" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit event" })).toBeEnabled();
    const roster = page.waitForRequest(
      (request) =>
        request.method() === "GET" &&
        new URL(request.url()).pathname === `/api/v1/admin/events/${eventId}/attendance`,
    );
    await page.getByRole("button", { name: "View responses and attendance" }).click();
    expect(new URL((await roster).url()).searchParams.has("view")).toBe(false);
    await expect(
      page.getByRole("combobox", { name: "Actual attendance · Fictional Yukon Member" }),
    ).toBeVisible();
    await expect(page.getByRole("region", { name: "No response yet" })).toHaveCount(0);
    await expect(page.locator(".events-attendance-totals")).toHaveCount(0);
    await page.getByRole("button", { name: "Cancel event", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Private reason").fill("Fictional cancellation on the legacy API");
    const cancellation = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname === `/api/v1/admin/events/${eventId}/cancellation`,
    );
    await dialog.getByRole("button", { name: "Confirm cancellation" }).click();
    expect(new URL((await cancellation).url()).searchParams.has("locale")).toBe(false);
    await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
    expect(state.commands.at(-1)?.path).toBe(`/admin/events/${eventId}/cancellation`);
    expect(
      state.requests.some(
        (request) => request.endsWith("/media") || request.endsWith("/nonresponders"),
      ),
    ).toBe(false);
  },
);

for (const status of [401, 403, 404, 422] as const) {
  test(
    `public detail stops after one GET for ${status === 404 ? "a missing or private event" : status}`,
    browserCase(["@functional"]),
    async ({ page }) => {
      const state = await mockEvents(page, false, "ru");
      state.status = status;
      state.session = false;
      const reads = trackGuestReads(page);
      await page.goto(`/events/${eventId}`);
      await expect(page.locator(".events-detail").getByRole("alert")).toBeVisible();
      expect(guestRequestPaths(reads)).toEqual([`GET /api/v1/public/events/${eventId}?locale=ru`]);
    },
  );
}

for (const projection of ["legacy", "Stage 2"] as const) {
  test(
    `public detail rejects a private field in the ${projection} response`,
    browserCase(["@functional"]),
    async ({ page }) => {
      const data =
        projection === "legacy"
          ? eventFixture()
          : (
              stage2Fixture("getPublicEvent", "structured")
                .response as components["schemas"]["EventStage2EnvelopePublic"]
            ).data;
      const path = `/api/v1/public/events/${data.id}`;
      const reads = trackGuestReads(page);
      await page.route(
        (url) => url.pathname === path,
        (route) =>
          route.fulfill({
            json: envelope({ ...data, organizerMemberId: "e0350000-0000-4000-8000-000000000094" }),
          }),
      );
      await page.goto(`/events/${data.id}`);
      await expect(page.locator(".events-detail").getByRole("alert")).toBeVisible();
      await expect(page.getByRole("heading", { name: data.title })).toHaveCount(0);
      expect(guestRequestPaths(reads)).toEqual([`GET ${path}?locale=ru`]);
    },
  );
}

test.describe("Stage 2 draft entry", () => {
  const url = `/account/events/new?draftId=${stage2DraftId}`;
  const path = `/api/v1/admin/events/drafts/${stage2DraftId}`;
  const fixture = () =>
    stage2Fixture("getEventDraft", "read")
      .response as components["schemas"]["EventStage2EnvelopeDraft"];

  test(
    "the new event form saves an overnight Moscow schedule in UTC and tonnes in kilograms",
    browserCase(["@functional"]),
    async ({ page }) => {
      await mockEventsStage2(page, "manager", "en", { draftsRollout: true });
      await page.goto("/account/events/new");
      const schedule = page.getByRole("group", { name: "When", exact: true });
      await fillDate(schedule, "Date", "2099-10-25");
      await schedule.getByRole("button", { name: "Set a separate meeting date" }).click();
      await fillDate(schedule, "Meeting date", "2099-10-24");
      await fillTime(schedule, "Meeting time", "23:30");
      await fillTime(schedule, "Start time", "01:00");
      await page.getByRole("button", { name: "+ Set end time", exact: true }).click();
      const end = schedule.getByRole("group", { name: "End time", exact: true });
      await fillDate(end, "Date", "2099-10-26");
      await fillTime(end, "End time", "00:15");
      const preview = page.locator(".event-editor-preview");
      await expect(preview).toContainText("Europe/Warsaw");
      await expect(preview).toContainText(/meeting time Oct 24, 2099/);
      await page.getByRole("button", { name: "+ Add load", exact: true }).click();
      await page.getByRole("textbox", { name: "Mass (t)", exact: true }).fill("18,025");

      const request = page.waitForRequest(
        (candidate) =>
          candidate.method() === "POST" &&
          new URL(candidate.url()).pathname === "/api/v1/admin/events",
      );
      await page.getByRole("button", { name: "Save draft", exact: true }).click();
      expect((await request).postDataJSON()).toMatchObject({
        draft: true,
        meetingAt: "2099-10-24T20:30:00.000Z",
        startsAt: "2099-10-24T22:00:00.000Z",
        endsAt: "2099-10-25T21:15:00.000Z",
        prescribedMassKg: "18025",
      });
    },
  );

  test(
    "the DLC picker finds codes and removes a manual requirement independently of the route",
    browserCase(["@functional"]),
    async ({ page }) => {
      await mockEventsStage2(page, "manager", "en", { draftsRollout: true });
      const dlc = catalogItem("e1320000-0000-4000-8000-000000000037", "Fictional roads", "en", {
        code: "synthetic_pack_37",
        steamAppId: 1,
      });
      const city = catalogItem("e1320000-0000-4000-8000-000000000038", "Fictional harbour", "en", {
        dlcId: dlc.id,
      });
      const hiddenDlc = catalogItem(
        "e1320000-0000-4000-8000-000000000039",
        "Fictional older roads",
        "en",
        {
          hidden: true,
          steamAppId: 2,
        },
      );
      const otherCity = catalogItem(
        "e1320000-0000-4000-8000-000000000040",
        "Fictional old quay",
        "en",
        {
          dlcId: hiddenDlc.id,
        },
      );
      await page.route("**/api/v1/catalogs/cities?*", (route) =>
        route.fulfill({ json: catalogList([city, otherCity]) }),
      );
      await page.route(`**/api/v1/catalogs/cities/${city.id}?*`, (route) =>
        route.fulfill({ json: envelope(city) }),
      );
      await page.route(`**/api/v1/catalogs/cities/${otherCity.id}?*`, (route) =>
        route.fulfill({ json: envelope(otherCity) }),
      );
      await page.route("**/api/v1/catalogs/dlcs?*", (route) =>
        route.fulfill({
          json: catalogList(
            new URL(route.request().url()).searchParams.get("search") === dlc.code ? [dlc] : [],
          ),
        }),
      );
      await page.route(`**/api/v1/catalogs/dlcs/${dlc.id}?*`, (route) =>
        route.fulfill({ json: envelope(dlc) }),
      );
      await page.route(`**/api/v1/catalogs/dlcs/${hiddenDlc.id}?*`, (route) =>
        route.fulfill({ json: envelope(hiddenDlc) }),
      );
      await page.goto("/account/events/new");
      const picker = page.getByRole("button", { name: "Required DLC", exact: true });
      await picker.click();
      await page.getByRole("searchbox").fill(dlc.code);
      await page.getByRole("checkbox", { name: `${dlc.nameEn} · ${dlc.code}` }).check();
      await page.getByRole("button", { name: "Done", exact: true }).click();
      await chooseCatalogRow(page, "Origin city", city.display.label);
      await chooseCatalogRow(page, "Destination city", otherCity.display.label);
      await picker.click();
      const manual = page.getByRole("checkbox", { name: `${dlc.nameEn} · ${dlc.code} · Manual` });
      const hiddenManual = page.getByRole("checkbox", {
        name: `${hiddenDlc.nameEn} · ${hiddenDlc.code} · Manual`,
      });
      await expect(hiddenManual).toBeDisabled();
      await expect(manual).toBeChecked();
      await manual.uncheck();
      await expect(page.getByText("Manual · Required by the route", { exact: true })).toHaveCount(
        2,
      );
      await page.getByRole("button", { name: "Done", exact: true }).click();
      await expect(picker).toContainText(dlc.nameEn);
      const saved = page.waitForRequest(
        (request) =>
          request.method() === "POST" && new URL(request.url()).pathname === "/api/v1/admin/events",
      );
      await page.getByRole("button", { name: "Save draft", exact: true }).click();
      expect((await saved).postDataJSON()).toMatchObject({
        originCityId: city.id,
        destinationCityId: otherCity.id,
        requiredDlcIds: [],
      });
    },
  );

  test(
    "a manager opens a draft, retries its exact save and reloads without mutating media",
    browserCase(["@functional"]),
    async ({ page }) => {
      const mock = await mockEventsStage2(page, "manager", "en", { draftsRollout: true });
      const draft = fixture();
      const retained = {
        originCityId: "e1320000-0000-4000-8000-000000000002",
        originDepotId: "e1320000-0000-4000-8000-000000000004",
        organizerMemberId: "e1320000-0000-4000-8000-000000000006",
        prescribedMassKg: "0",
        requiredDlcIds: ["e1320000-0000-4000-8000-000000000008"],
      };
      draft.data.fields = { ...draft.data.fields, ...retained };
      const expected = { ...draft.data.fields, title: "Fictional draft revision" };
      const mediaWrites: string[] = [];
      const writes: { body: unknown; etag: string | undefined; key: string | undefined }[] = [];
      page.on("request", (request) => {
        const path = new URL(request.url()).pathname;
        if (/\/media(?:\/[^/]+)?$/.test(path) && request.method() !== "GET")
          mediaWrites.push(request.method());
      });
      let loseReceipt = true;
      await page.route(`**${path}`, async (route) => {
        const request = route.request();
        if (request.method() === "PATCH") {
          const body = request.postDataJSON();
          const etag = request.headers()["if-match"];
          const key = request.headers()["idempotency-key"];
          writes.push({ body, etag, key });
          if (loseReceipt) {
            loseReceipt = false;
            draft.data.fields = body;
            draft.data.version += 1;
            return route.abort("failed");
          }
        }
        return route.fulfill({ json: draft, headers: { ETag: `"v${draft.data.version}"` } });
      });
      await page.goto(url);
      const title = page.getByRole("textbox", { name: "Event title" });
      await expect(title).toHaveValue(draft.data.fields.title ?? "");
      const mediaRead = `GET /admin/events/${stage2DraftId}/media`;
      const upcomingRead = "GET /me/upcoming-event";
      const count = (path: string) => mock.requests.filter(({ route }) => route === path).length;
      await expect.poll(() => count(mediaRead)).toBe(1);
      await expect.poll(() => count(upcomingRead)).toBe(1);
      await title.fill("Fictional draft revision");
      await page.getByRole("button", { name: "Save draft" }).click();
      await expect(title).toHaveValue("Fictional draft revision");
      await page.getByRole("button", { name: "Retry the same request" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Draft saved." })).toBeVisible();
      expect(writes).toEqual([
        {
          body: expect.objectContaining(expected),
          etag: '"v1"',
          key: expect.stringMatching(/^[a-f0-9-]{36}$/),
        },
        { body: writes[0]?.body, etag: '"v1"', key: writes[0]?.key },
      ]);
      expect(count(mediaRead)).toBe(1);
      expect(count(upcomingRead)).toBe(1);
      await page.reload();
      await expect(title).toHaveValue("Fictional draft revision");
      expect(mediaWrites).toEqual([]);
    },
  );

  test(
    "conflicting draft saves require explicit review before using a newer ETag",
    browserCase(["@functional"]),
    async ({ page }) => {
      await mockEventsStage2(page, "manager", "en", { draftsRollout: true });
      const draft = fixture();
      const originalCityId = "e1320000-0000-4000-8000-000000000002";
      const savedCityId = "e1320000-0000-4000-8000-000000000034";
      const localCity = catalogItem(
        "e1320000-0000-4000-8000-000000000033",
        "Fictional local harbour",
      );
      draft.data.fields.game = "ets2";
      draft.data.fields.originCityId = originalCityId;
      await page.route("**/api/v1/catalogs/cities?*", (route) =>
        route.fulfill({ json: catalogList([localCity]) }),
      );
      await page.route(`**/api/v1/catalogs/cities/${localCity.id}?*`, (route) =>
        route.fulfill({ json: envelope(localCity) }),
      );
      const attempts: { etag: string | undefined; body: typeof draft.data.fields }[] = [];
      await page.route(`**${path}`, async (route) => {
        const request = route.request();
        if (request.method() === "PATCH") {
          const etag = request.headers()["if-match"];
          const body = request.postDataJSON();
          attempts.push({ etag, body });
          if (attempts.length === 1) {
            draft.data.version = 2;
            draft.data.fields.title = "Fictional concurrent title";
            draft.data.fields.description = "Fictional concurrent description";
            draft.data.fields.distanceKm = "12.5";
            draft.data.fields.originCityId = savedCityId;
            return route.fulfill({ status: 412 });
          }
          draft.data.version = 3;
          draft.data.fields = body;
        }
        return route.fulfill({ json: draft, headers: { ETag: `"v${draft.data.version}"` } });
      });
      await page.goto(url);
      const title = page.getByRole("textbox", { name: "Event title" });
      await title.fill("Fictional local edit");
      await page.getByRole("textbox", { name: "Description" }).fill("Fictional local description");
      await chooseCatalogRow(page, "Origin city", localCity.display.label);
      const save = page.getByRole("button", { name: "Save draft" });
      await save.click();
      await expect(
        page.getByRole("alert").filter({ hasText: "The saved definition changed." }),
      ).toBeVisible();
      await expect(title).toHaveValue("Fictional local edit");
      await expect(save).toBeDisabled();
      await page.getByRole("button", { name: "Check latest version" }).click();
      await expect(
        page.getByText("Latest saved title · Fictional concurrent title", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Latest value · Fictional concurrent title", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Latest value · Fictional concurrent description", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Latest value · Selection details unavailable", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Your value · Fictional local harbour", { exact: true }),
      ).toBeVisible();
      await expect(page.getByText(new RegExp(savedCityId))).toHaveCount(0);
      await expect(page.getByText(new RegExp(localCity.id))).toHaveCount(0);
      await page.getByRole("button", { name: "Use my edits with the latest version" }).click();
      await save.click();
      await expect(page.getByRole("status").filter({ hasText: "Draft saved." })).toBeVisible();
      expect(attempts.map(({ etag }) => etag)).toEqual(['"v1"', '"v2"']);
      expect(attempts[1]?.body).toMatchObject({
        title: "Fictional local edit",
        description: "Fictional local description",
        distanceKm: "12.5",
        originCityId: localCity.id,
      });
    },
  );

  for (const command of ["upload", "caption"] as const) {
    test(
      `a replayed gallery ${command} waits for the current collection before another edit`,
      browserCase(["@functional"]),
      async ({ page }) => {
        const mock = await mockEventsStage2(page, "manager", "en", { draftsRollout: true });
        const collection = `/api/v1/admin/events/${stage2DraftId}/media`;
        const itemPath = `${collection}/${stage2MediaId}`;
        const original = stage2Fixture("listAdminEventMedia", "gallery")
          .response as components["schemas"]["EventStage2EnvelopeAdminMediaList"];
        const receipt = stage2Fixture("uploadEventMedia", "processing")
          .response as components["schemas"]["EventStage2EnvelopeMediaUpload"];
        receipt.data.version = 5;
        receipt.data.item.state = "rejected";
        const saved = structuredClone(original);
        saved.data.version = 3;
        const savedMedia = saved.data.items[0]?.media;
        if (!savedMedia) throw new Error("Missing synthetic gallery item");
        savedMedia.caption = "Fictional saved caption";
        const latest = structuredClone(original);
        latest.data.version = 5;
        const latestMedia = latest.data.items[0]?.media;
        if (!latestMedia) throw new Error("Missing synthetic gallery item");
        latestMedia.caption = "Fictional newer caption";
        const writes: { method: string; etag: string | undefined; key: string | undefined }[] = [];
        let galleryReads = 0;
        await page.route("**/api/v1/me/upload-policy", (route) =>
          route.fulfill({
            json: envelope({
              enabled: true,
              maxFileBytes: 1048576,
              maxFilesPerReport: 5,
              allowedMimeTypes: ["image/png"],
              policyRevision: 1,
            }),
          }),
        );
        await page.route("**/api/v1/admin/events/**/media**", (route) => {
          const request = route.request();
          const target = new URL(request.url()).pathname;
          const method = request.method();
          if (target === collection && method === "GET") {
            galleryReads++;
            if (galleryReads === 2) return route.fulfill({ status: 503 });
            const data = galleryReads === 1 ? original : latest;
            return route.fulfill({ json: data, headers: { ETag: `"v${data.data.version}"` } });
          }
          if (
            (target === collection && method === "POST") ||
            (target === itemPath && method === "PATCH")
          ) {
            const headers = request.headers();
            writes.push({ method, etag: headers["if-match"], key: headers["idempotency-key"] });
            if (writes.length === 1) return route.abort("failed");
            if (writes.length === 2) {
              return command === "upload"
                ? route.fulfill({ status: 202, json: receipt, headers: { ETag: '"v5"' } })
                : route.fulfill({ json: saved, headers: { ETag: '"v3"' } });
            }
            latestMedia.caption = request.postDataJSON().caption;
            latest.data.version = 6;
            return route.fulfill({ json: latest, headers: { ETag: '"v6"' } });
          }
          return route.fallback();
        });
        await page.goto(url);
        const gallery = page.getByRole("group", { name: "Screenshots", exact: true });
        const caption = gallery.getByRole("textbox", { name: "Caption · Screenshot 1" });
        await expect(caption).toHaveValue("Fictional route screenshot");
        await expect
          .poll(
            () => mock.requests.filter(({ route }) => route === "GET /me/upcoming-event").length,
          )
          .toBe(1);
        const file = gallery.locator('input[type="file"]');
        if (command === "upload") {
          await file.setInputFiles({
            name: "synthetic.png",
            mimeType: "image/png",
            buffer: pngBytes(),
          });
          await gallery.getByRole("button", { name: "Upload screenshot" }).click();
        } else {
          await caption.fill("Fictional saved caption");
          await gallery.getByRole("button", { name: "Save caption" }).click();
        }
        const retryWrite = gallery.getByRole("button", { name: "Retry the same request" });
        await retryWrite.click();
        await expect(gallery.getByRole("alert")).toHaveText("Screenshots are unavailable.");
        await expect(retryWrite).toHaveCount(0);
        await expect(file).toBeDisabled();
        if (command === "upload") await expect(file).toHaveValue(/synthetic\.png$/);
        await expect(caption).toHaveCount(0);
        expect(galleryReads).toBe(2);
        expect(writes).toEqual([
          {
            method: command === "upload" ? "POST" : "PATCH",
            etag: '"v2"',
            key: expect.any(String),
          },
          writes[0],
        ]);
        await gallery.getByRole("button", { name: "Try again", exact: true }).click();
        await expect(caption).toHaveValue("Fictional newer caption");
        if (command === "upload") await expect(file).toHaveValue("");
        expect(galleryReads).toBe(3);
        expect(writes).toHaveLength(2);
        await caption.fill("Fictional next edit");
        await gallery.getByRole("button", { name: "Save caption" }).click();
        await expect(
          gallery.getByRole("status").filter({ hasText: "Gallery updated." }),
        ).toBeVisible();
        expect(writes[2]).toMatchObject({ method: "PATCH", etag: '"v5"' });
        expect(
          mock.requests.filter(({ route }) => route === "GET /me/upcoming-event"),
        ).toHaveLength(1);
      },
    );
  }

  test(
    "a reopened draft publishes with the fresh revision after saving and without reading the retired draft",
    browserCase(["@functional"]),
    async ({ page }) => {
      await mockEventsStage2(page, "manager", "en", { draftsRollout: true });
      const draft = fixture();
      const definition = stage2Fixture("publishEventDraft", "retains-identity")
        .response as components["schemas"]["EventStage2EnvelopeMember"];
      const publishedDefinition = stage2Fixture("getEvent", "structured")
        .response as components["schemas"]["EventStage2EnvelopeMember"];
      const source = publishedDefinition.data;
      draft.data.fields = {
        title: source.event.title,
        description: source.event.description,
        game: source.event.game,
        platform: source.event.platform,
        server: source.event.server,
        meetingAt: source.event.meetingAt,
        startsAt: source.event.startsAt,
        originCityId: source.event.origin?.entityId ?? null,
        destinationCityId: source.event.destination?.entityId ?? null,
        organizerMemberId: source.organizerMemberId,
        visibility: source.visibility,
      };
      definition.data.event.id = stage2DraftId;
      let published = false;
      let retiredReads = 0;
      const writes: { method: string; etag: string | undefined }[] = [];
      await page.route("**/api/v1/**", async (route) => {
        const request = route.request();
        const target = new URL(request.url()).pathname;
        const method = request.method();
        const etag = request.headers()["if-match"];
        if (target === path) {
          if (method === "PATCH") {
            writes.push({ method, etag });
            draft.data.fields = request.postDataJSON();
            draft.data.version = 2;
          } else if (published) {
            retiredReads++;
            return route.fulfill({ status: 404 });
          }
          return route.fulfill({ json: draft, headers: { ETag: `"v${draft.data.version}"` } });
        }
        if (target === `/api/v1/admin/events/${stage2DraftId}/publication` && method === "POST") {
          writes.push({ method, etag });
          published = true;
          definition.data.event.title = draft.data.fields.title ?? "";
          return route.fulfill({ json: definition, headers: { ETag: '"v1"' } });
        }
        if (target === `/api/v1/events/${stage2DraftId}` && method === "GET" && published) {
          return route.fulfill({ json: definition, headers: { ETag: '"v1"' } });
        }
        return route.fallback();
      });

      await page.goto(url);
      const title = page.getByRole("textbox", { name: "Event title" });
      await title.fill("Fictional published draft");
      await title.press("Enter");
      expect(writes).toEqual([]);
      await page.getByRole("button", { name: "Publish event", exact: true }).press("Space");
      await expect(page).toHaveURL(`/account/events/${stage2DraftId}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Fictional published draft");
      expect(writes).toEqual([
        { method: "PATCH", etag: '"v1"' },
        { method: "POST", etag: '"v2"' },
      ]);
      expect(retiredReads).toBe(0);
    },
  );

  test(
    "a manager edits a structured published event through the detail dialog",
    browserCase(["@functional"]),
    async ({ page }) => {
      const state = await mockEventsStage2(page, "manager");
      const detail = stage2Fixture("getEvent", "structured")
        .response as components["schemas"]["EventStage2EnvelopeMember"];
      detail.data.event.route = "Fictional legacy route";
      detail.data.event.meetingLocation = "Fictional legacy meeting place";
      const updatedTitle = "Fictional revised structured convoy";
      const adminPath = `/api/v1/admin/events/${detail.data.event.id}`;
      let committed = false;
      await page.route("**/api/v1/**", async (route) => {
        const request = route.request();
        const current = new URL(request.url());
        if (current.pathname === adminPath && request.method() === "PATCH") {
          expect(current.searchParams.get("locale")).toBe("en");
          expect(request.headers()["if-match"]).toBe('"v1"');
          expect(request.postDataJSON()).toMatchObject({
            title: updatedTitle,
            originDepotId: null,
            route: null,
            meetingLocation: null,
            destinationDepotId: detail.data.event.destinationDepot?.id ?? null,
            distanceKm: detail.data.event.distanceKm,
          });
          detail.data.event.title = updatedTitle;
          detail.data.event.originDepot = null;
          detail.data.event.route = null;
          detail.data.event.meetingLocation = null;
          detail.data.event.version = 2;
          committed = true;
          return route.fulfill({ json: detail, headers: { ETag: '"v2"' } });
        }
        if (
          current.pathname === `/api/v1/events/${detail.data.event.id}` &&
          request.method() === "GET" &&
          committed
        ) {
          return route.fulfill({ json: detail, headers: { ETag: '"v2"' } });
        }
        return route.fallback();
      });
      await page.goto(detailsPath);
      const edit = page.getByRole("button", { name: "Edit event", exact: true });
      await edit.click();
      const dialog = page.getByRole("dialog", { name: "Edit event" });
      await expect(dialog.getByRole("group", { name: "Screenshots", exact: true })).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Save draft" })).toHaveCount(0);
      await dialog.getByRole("textbox", { name: "Event title" }).fill(updatedTitle);
      await dialog
        .getByRole("group", { name: "Origin depot", exact: true })
        .getByRole("button", { name: "Clear selection" })
        .click();
      await dialog.getByRole("button", { name: "Save changes" }).click();
      await expect(dialog.getByRole("status").filter({ hasText: "Changes saved." })).toBeVisible();
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(updatedTitle);
      await expect(edit).toBeFocused();
      expect(
        state.requests.some(
          ({ route }) => route === `GET /admin/events/${detail.data.event.id}/media`,
        ),
      ).toBe(true);
    },
  );

  for (const status of [503, 404]) {
    test(
      status === 503
        ? "structured edit keeps local changes when a conflict refresh is temporarily unavailable"
        : "structured edit closes after a terminal detail refresh",
      browserCase(["@functional"]),
      async ({ page }) => {
        await mockEventsStage2(page, "manager");
        const detail = stage2Fixture("getEvent", "structured")
          .response as components["schemas"]["EventStage2EnvelopeMember"];
        const path = `/api/v1/events/${detail.data.event.id}`;
        let readsAfterConflict = 0;
        let conflict = false;
        await page.route("**/api/v1/**", async (route) => {
          const request = route.request();
          const target = new URL(request.url()).pathname;
          if (
            target === `/api/v1/admin/events/${detail.data.event.id}` &&
            request.method() === "PATCH"
          ) {
            conflict = true;
            return route.fulfill({ status: 412 });
          }
          if (target === path && request.method() === "GET" && conflict) {
            readsAfterConflict++;
            if (status === 404 || readsAfterConflict === 1) return route.fulfill({ status });
            detail.data.event.title = "Fictional server revision";
            detail.data.event.version = 2;
            return route.fulfill({ json: detail, headers: { ETag: '"v2"' } });
          }
          return route.fallback();
        });
        await page.goto(detailsPath);
        await page.getByRole("button", { name: "Edit event", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "Edit event" });
        const title = dialog.getByRole("textbox", { name: "Event title" });
        await title.fill("Fictional unsaved structured title");
        await dialog.getByRole("button", { name: "Save changes" }).click();
        if (status === 404) {
          await expect(dialog).toHaveCount(0);
          await expect(
            page
              .getByRole("alert")
              .filter({ hasText: "This event is unavailable or you do not have access." }),
          ).toBeVisible();
        } else {
          await expect(
            dialog.getByRole("alert").filter({ hasText: "The saved definition changed." }),
          ).toBeVisible();
          await expect(title).toHaveValue("Fictional unsaved structured title");
          await dialog.getByRole("button", { name: "Check latest version" }).click();
          await expect(
            dialog.getByText("Latest value · Fictional server revision", { exact: true }),
          ).toBeVisible();
          await dialog
            .getByRole("button", { name: "Use my edits with the latest version" })
            .click();
          await expect(title).toHaveValue("Fictional unsaved structured title");
          await expect(dialog.getByRole("button", { name: "Save changes" })).toBeEnabled();
        }
        expect(readsAfterConflict).toBeGreaterThan(0);
      },
    );
  }

  for (const terminalRead of [false, true]) {
    test(
      terminalRead
        ? "a terminal draft read closes an opened editor"
        : "a terminal draft write closes an opened editor",
      browserCase(["@functional"]),
      async ({ page }) => {
        await mockEventsStage2(page, "manager", "en", { draftsRollout: true });
        const draft = fixture();
        let writes = 0;
        let terminalReads = 0;
        await page.route(`**${path}`, async (route) => {
          if (route.request().method() === "PATCH") {
            writes += 1;
            return route.fulfill({ status: terminalRead ? 412 : 404 });
          }
          if (terminalRead && writes) {
            terminalReads += 1;
            return route.fulfill({ status: 404 });
          }
          return route.fulfill({ json: draft, headers: { ETag: '"v1"' } });
        });
        await page.goto(url);
        const title = page.getByRole("textbox", { name: "Event title" });
        await title.fill("Fictional inaccessible draft");
        await page.getByRole("button", { name: "Save draft" }).click();
        await expect(
          page
            .getByRole("alert")
            .filter({ hasText: "This event is unavailable or you do not have access." }),
        ).toBeVisible();
        await expect(title).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Retry the same request" })).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Check latest version" })).toHaveCount(0);
        expect(writes).toBe(1);
        expect(terminalReads).toBe(terminalRead ? 1 : 0);
      },
    );
  }

  test(
    "malformed or repeated draft IDs cannot open a draft or start creation",
    browserCase(["@functional"]),
    async ({ page }) => {
      const mock = await mockEventsStage2(page, "manager", "en", { draftsRollout: true });
      for (const invalid of [
        "?draftId=",
        "?draftId=bad",
        `?draftId=${stage2DraftId}&draftId=${stage2DraftId}`,
      ]) {
        await page.goto(`/account/events/new${invalid}`);
        await expect(
          page.getByRole("alert").filter({ hasText: "This draft link is invalid." }),
        ).toBeVisible();
        await expect(page.getByRole("textbox", { name: "Event title" })).toHaveCount(0);
      }
      expect(mock.requests.filter(({ route }) => route.includes("/admin/events"))).toEqual([]);
    },
  );

  for (const routesEnabled of [false, true]) {
    test(
      routesEnabled
        ? "a manager can publish directly when routes are on and drafts are off"
        : "a manager sees legacy creation when routes and drafts are off",
      browserCase(["@functional"]),
      async ({ page }) => {
        if (routesEnabled) await mockEventsStage2(page);
        else await mockEvents(page, true);
        const draftTraffic: string[] = [];
        page.on("request", (request) => {
          const path = new URL(request.url()).pathname;
          if (
            path.startsWith("/api/v1/admin/events/drafts/") ||
            path.endsWith("/media") ||
            path === "/api/v1/me/upload-policy" ||
            (path === "/api/v1/admin/events" && request.method() === "POST")
          ) {
            draftTraffic.push(request.method());
          }
        });
        const [session] = await Promise.all([
          page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/me"),
          page.goto(url),
        ]);
        expect(session.status()).toBe(200);
        expect(await session.headerValue("x-vtc-events-stage2")).toBe(routesEnabled ? "1" : null);
        expect(await session.headerValue("x-vtc-events-drafts")).toBeNull();
        await expect(
          page.getByRole("alert").filter({ hasText: "Event drafts are unavailable." }),
        ).toBeVisible();
        await expect(page.getByRole("textbox", { name: "Event title" })).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Save draft" })).toHaveCount(0);
        expect(draftTraffic).toEqual([]);

        await page.goto("/account/events/new");
        await expect(
          page.getByRole("heading", {
            name: routesEnabled ? "New event" : "Create event",
            exact: true,
          }),
        ).toBeVisible();
        await expect(page.getByRole("textbox", { name: "Event title" })).toBeVisible();
        await expect(
          page.getByRole("button", {
            name: routesEnabled ? "Publish event" : "Create event",
            exact: true,
          }),
        ).toBeEnabled();
        await expect(page.getByRole("group", { name: "Screenshots", exact: true })).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Save draft", exact: true })).toHaveCount(0);
        expect(draftTraffic).toEqual([]);
      },
    );
  }

  test(
    "a member without event management cannot request a draft",
    browserCase(["@functional"]),
    async ({ page }) => {
      const mock = await mockEventsStage2(page, "member", "en", { draftsRollout: true });
      await page.goto(url);
      await expect(
        page.getByRole("alert").filter({ hasText: "You no longer have access to this action." }),
      ).toBeVisible();
      await expect(page.getByRole("textbox", { name: "Event title" })).toHaveCount(0);
      expect(mock.requests.filter(({ route }) => route.includes("/admin/events"))).toEqual([]);
    },
  );

  test(
    "an unavailable draft stays on the protected draft entry",
    browserCase(["@functional"]),
    async ({ page }) => {
      const mock = await mockEventsStage2(page, "manager", "en", { draftsRollout: true });
      mock.statusByRequest.set(`GET /admin/events/drafts/${stage2DraftId}`, 404);
      await page.goto(url);
      await expect(
        page
          .getByRole("alert")
          .filter({ hasText: "This event is unavailable or you do not have access." }),
      ).toBeVisible();
      await expect(page.getByRole("textbox", { name: "Event title" })).toHaveCount(0);
      expect(mock.requests.filter(({ route }) => route === "POST /admin/events")).toEqual([]);
    },
  );
});
