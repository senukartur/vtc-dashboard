import { writeFile } from "node:fs/promises";
import type { Page, TestInfo } from "@playwright/test";
import { catalogLanguage } from "./support/catalogs.ts";
import { eventId, mockEvents } from "./support/events.ts";
import { expect, test } from "./support/fixtures.ts";

test.use({ trace: "off", screenshot: "off", video: "off" });
for (const status of [412, 503, 429]) {
  test(`attendance page two keeps reviewable drafts and safe authority after ${status}`, async ({
    page,
  }, info) => {
    const state = await mockEvents(page, true);
    state.attendancePages = true;
    state.event.startsAt = "2020-10-25T13:00:00.000Z";
    state.event.meetingAt = "2020-10-25T12:00:00.000Z";
    await page.goto(`/account/events/${eventId}`);
    await page.getByRole("button", { name: "View responses and attendance", exact: true }).click();
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
      await page.getByRole("button", { name: "Keep this draft after review", exact: true }).click();
    } else {
      await expect(attendance).toHaveValue("attended");
      expect(state.attendanceCursors.at(-1)).toBe("synthetic-attendance-page-2-v1");
    }
    await save.click();
    await expect(page.getByText("Attendance recorded.", { exact: true })).toBeVisible();
    expect(state.preconditions).toEqual(['"v1"', status === 412 ? '"v2"' : '"v1"']);
    expect(state.keys[0] === state.keys[1]).toBe(status !== 412);
    expect(state.commands[1]?.body).toEqual(state.commands[0]?.body);
  });
}
test("attendance lost receipt retries the original decision after refreshed collection authority", async ({
  page,
}) => {
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
});
test("changing own RSVP from participants page two resets to the current first page", async ({
  page,
}) => {
  const state = await mockEvents(page);
  state.response = { response: "participating", declineReason: null, version: 2 };
  state.participantPages = true;
  await page.goto(`/account/events/${eventId}`);
  const participants = page
    .getByRole("heading", { name: "Signed-up members", exact: true })
    .locator("..");
  await participants.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(
    participants.getByRole("link", { name: "Fictional Yukon Member", exact: true }),
  ).toBeVisible();
  await page.getByRole("combobox", { name: "Your response", exact: true }).selectOption("declined");
  await page
    .getByLabel("Private decline reason", { exact: true })
    .fill("Fictional change from page two");
  await page.getByRole("button", { name: "Save response", exact: true }).click();
  await expect(page.getByText("Response saved.", { exact: true })).toBeVisible();
  const current = page
    .getByRole("heading", { name: "Signed-up members", exact: true })
    .locator("..");
  await expect(
    current.getByRole("link", { name: "Fictional participant 1", exact: true }),
  ).toBeVisible();
  await expect(
    current.getByRole("link", { name: "Fictional Yukon Member", exact: true }),
  ).toHaveCount(0);
  await expect(current.getByRole("button", { name: "First page", exact: true })).toHaveCount(0);
  expect(state.participantCursors).toEqual(["", "synthetic-participant-page-2", ""]);
});
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
test("nearest event refreshes once at start and selects the next accessible convoy", async ({
  page,
}) => {
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
  expect(state.requests.filter((r) => r === "GET /me/upcoming-event")).toHaveLength(2);
});
test("nearest boundary hides an expired same generation without looping if the client is ahead", async ({
  page,
}) => {
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
  expect(state.requests.filter((r) => r === "GET /me/upcoming-event")).toHaveLength(2);
});
test("nearest event keeps one request across locale changes and preserves accessible unanswered header", async ({
  page,
}) => {
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
});
test("event loading and unknown command results preserve exact retry identity and historical load", async ({
  page,
}, info) => {
  const state = await mockEvents(page, true);
  let release = () => {};
  state.readGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await page.goto("/events");
    await catalogLanguage(page);
    await expect(page.getByRole("status")).toContainText("Loading events");
    await page.screenshot({ path: info.outputPath("loading.png"), fullPage: true });
  } finally {
    release();
    state.readGate = null;
  }
  state.prescribedCargoId = "e0350000-0000-4000-8000-000000000002";
  state.prescribedMassKg = "21000.000000000000000001";
  state.prescribedTrailerTypeId = "e0350000-0000-4000-8000-000000000003";
  await page.goto(`/account/events/${eventId}`);
  await page.getByRole("button", { name: "Edit event", exact: true }).click();
  const dialog = page.getByRole("dialog"),
    save = dialog.getByRole("button", { name: "Save changes", exact: true });
  expect(state.requests.some((r) => r.includes("/catalogs/"))).toBe(false);
  await dialog.getByRole("button", { name: "Choose catalog selections", exact: true }).click();
  await expect(
    dialog.getByText("Catalog selection is unavailable. Existing selections are retained.", {
      exact: true,
    }),
  ).toBeVisible();
  state.failNext = 599;
  await save.click();
  await expect(dialog.getByRole("alert")).toContainText("result is unknown");
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
  expect(state.keys[2]).not.toBe(state.keys[1]);
  expect(state.commands[2]?.body).toMatchObject({
    prescribedCargoId: state.prescribedCargoId,
    prescribedTrailerTypeId: state.prescribedTrailerTypeId,
    prescribedMassKg: state.prescribedMassKg,
  });
});
for (const locale of ["en", "ru"] as const) {
  test(`events ${locale} public and member views fit viewport and keep private reads scoped`, async ({
    page,
  }, info) => {
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
    expect(state.requests.some((r) => /participants|attendance|my-response/.test(r))).toBe(false);
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
      page.getByRole("combobox", {
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
        name: locale === "en" ? "Public convoys" : "Открытые конвои",
        exact: true,
      })
      .locator("../..");
    await widget.evaluate((element) => element.scrollIntoView({ block: "start" }));
    await viewportCapture(page, info, `landing-populated-${locale}`);
    await widget.screenshot({
      path: info.outputPath(`landing-widget-${locale}.png`),
      animations: "disabled",
    });
    await page.goto("/account/events");
    await catalogLanguage(page, locale);
    await expect(page.getByRole("heading", { name: state.event.title, exact: true })).toBeVisible();
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
  });
}
test("RSVP prevents duplicates, retains decline input on stale and clears private state on session loss", async ({
  page,
}, info) => {
  const state = await mockEvents(page);
  await page.goto(`/account/events/${eventId}`);
  const response = page.getByRole("combobox", { name: "Your response", exact: true });
  await response.selectOption("declined");
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
  await expect(page.getByRole("button", { name: "Loading events…", exact: true })).toBeDisabled();
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
});
test("organizer stale edit preserves draft, cancellation dialog restores focus, attendance records intentional rows", async ({
  page,
}, info) => {
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
  await expect(page.getByRole("status").filter({ hasText: "Attendance recorded." })).toBeVisible();
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
});
test("public list empty error recovery cursor reset cancelled and inaccessible states are honest", async ({
  page,
}, info) => {
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
});
