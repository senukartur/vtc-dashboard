import { writeFile } from "node:fs/promises";
import type { Page, TestInfo } from "@playwright/test";
import { catalogItem, catalogLanguage, envelope } from "./support/catalogs.ts";
import { mockEventsStage2 } from "./support/events-stage-2.ts";
import { eventFixture, eventId, mockEvents, selectPastReportEvent } from "./support/events.ts";
import { browserCase, expect, test } from "./support/fixtures.ts";

test.use({ trace: "off", screenshot: "off", video: "off" });
for (const access of ["legacy", "member", "public"] as const) {
  test(
    `event fixture advertises Stage 2 only for an opted-in authenticated read (${access})`,
    browserCase(["@functional"]),
    async ({ page }) => {
      if (access === "legacy") await mockEvents(page);
      else await mockEventsStage2(page, access);
      await page.goto("/en");
      const result = await page.evaluate(async () => {
        const response = await fetch("/api/v1/me", { cache: "no-store" });
        return { status: response.status, rollout: response.headers.get("X-VTC-Events-Stage2") };
      });
      expect(result).toEqual({
        status: access === "public" ? 401 : 200,
        rollout: access === "member" ? "1" : null,
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
    await page.getByRole("button", { name: "Save response", exact: true }).click();
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
    await dialog.getByLabel("Start time (UTC)", { exact: true }).fill("2099-10-25T14:00");
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
