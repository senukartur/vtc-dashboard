import type { Page, Request } from "@playwright/test";
import type { components } from "@vtc/contracts";
import { stage2Fixture } from "../fixtures/events-stage-2.ts";
import { catalogLanguage } from "./support/catalogs.ts";
import { dateTimeField, timeField } from "./support/date-time.ts";
import { mockEvents } from "./support/events.ts";
import { detailsPath } from "./support/events-detail.ts";
import { mockEventsStage2 } from "./support/events-stage-2.ts";
import { browserCase, expect, test } from "./support/fixtures.ts";
import { phone } from "./support/locale.ts";

// An English browser outside Moscow and UTC: Stage 2 schedules are entered in Moscow time
// (UTC+3) and saved as exact UTC instants; the legacy editor keeps explicit UTC wall clocks.
test.use({ locale: "en-US", timezoneId: "America/New_York" });

function captureWrites(page: Page, method: string, path: string) {
  const bodies: Record<string, unknown>[] = [];
  page.on("request", (request: Request) => {
    if (request.method() === method && new URL(request.url()).pathname === path)
      bodies.push(request.postDataJSON());
  });
  return bodies;
}
const calendar = (page: Page, field: string) =>
  page.getByRole("dialog", { name: new RegExp(`^(Календарь|Calendar): ${field}$`) });

async function editDialog(page: Page, startsAt: string) {
  await mockEventsStage2(page, "manager");
  const detail = stage2Fixture("getEvent", "structured")
    .response as components["schemas"]["EventStage2EnvelopeMember"];
  detail.data.event.startsAt = startsAt;
  const eventRead = `/api/v1/events/${detail.data.event.id}`;
  await page.route(
    (url) => url.pathname === eventRead,
    (route) =>
      route.request().method() === "GET"
        ? route.fulfill({ json: detail, headers: { ETag: '"v1"' } })
        : route.fallback(),
  );
  const patches = captureWrites(page, "PATCH", `/api/v1/admin/events/${detail.data.event.id}`);
  await page.goto(detailsPath);
  await catalogLanguage(page);
  await page.getByRole("button", { name: "Edit event", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit event" });
  const schedule = dialog.getByRole("group", { name: "When", exact: true });
  return { dialog, schedule, patches };
}

test(
  "Stage 2 schedule: Russian keyboard and calendar entry in Moscow time saves exact UTC instants",
  browserCase(["@functional"]),
  async ({ page }) => {
    await mockEventsStage2(page, "manager", "ru", { draftsRollout: true });
    const posts = captureWrites(page, "POST", "/api/v1/admin/events");
    await page.goto("/account/events/new");
    await catalogLanguage(page, "ru");
    await page
      .getByRole("textbox", { name: "Название", exact: true })
      .fill("Fictional date convoy");
    const schedule = page.getByRole("group", { name: "Когда", exact: true });
    const date = dateTimeField(schedule, "Дата");
    const meeting = timeField(schedule, "Сбор");
    const start = timeField(schedule, "Старт");
    await expect(date.date).toHaveAttribute("placeholder", "дд.мм.гггг");
    await expect(meeting.segment("hours")).toBeDisabled();
    await expect(schedule).toContainText("Время по Москве (UTC+3)");
    await expect(meeting.segment("hours")).toHaveAccessibleDescription(
      /Время по Москве \(UTC\+3\)/,
    );
    await expect(schedule.getByText(/AM|PM/)).toHaveCount(0);

    await date.date.focus();
    await page.keyboard.type("25.10.2099");
    await page.keyboard.press("Tab");
    await expect(date.calendarButton).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(meeting.segment("hours")).toBeFocused();
    await page.keyboard.type("2330");
    await expect(meeting.segment("hours")).toHaveValue("23");
    await expect(meeting.segment("minutes")).toHaveValue("30");

    // The calendar moves the shared date; the meeting time moves with it.
    await date.date.focus();
    await page.keyboard.press("ArrowDown");
    const picker = calendar(page, "Дата");
    await expect(picker.locator('button[data-day="2099-10-25"]')).toBeFocused();
    await expect(picker.getByRole("status")).toHaveText("Октябрь 2099");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await expect(picker).toHaveCount(0);
    await expect(date.date).toBeFocused();
    await expect(date.date).toHaveValue("26.10.2099");

    // A separate meeting date the evening before an overnight start.
    await schedule
      .getByRole("button", { name: "Указать отдельную дату сбора", exact: true })
      .click();
    const meetingDate = dateTimeField(schedule, "Дата сбора");
    await expect(meetingDate.date).toHaveValue("26.10.2099");
    await meetingDate.date.fill("25.10.2099");
    await start.segment("hours").focus();
    await page.keyboard.type("0100");
    await expect(start.segment("hours")).toHaveValue("01");
    await expect(start.segment("minutes")).toHaveValue("00");

    await page.getByRole("button", { name: "Сохранить черновик", exact: true }).click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toMatchObject({
      draft: true,
      meetingAt: "2099-10-25T20:30:00.000Z",
      startsAt: "2099-10-25T22:00:00.000Z",
      endsAt: null,
    });
  },
);

test(
  "Stage 2 edit dialog keeps untouched exact times and Escape closes only the calendar",
  browserCase(["@functional"]),
  async ({ page }) => {
    const { dialog, schedule, patches } = await editDialog(page, "2099-10-25T14:00:30.500Z");
    const date = dateTimeField(schedule, "Date");
    const start = timeField(schedule, "Start time");
    await expect(date.date).toHaveValue("10/25/2099");
    // 14:00:30.500 UTC is 17:00 in Moscow; the hidden seconds stay in the untouched value.
    await expect(start.segment("hours")).toHaveValue("17");
    await expect(start.segment("minutes")).toHaveValue("00");
    await expect(timeField(schedule, "Meeting time").segment("hours")).toHaveValue("15");

    await date.calendarButton.click();
    const picker = calendar(page, "Date");
    await expect(picker.locator('button[data-day="2099-10-25"]')).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await expect(date.date).toBeFocused();

    await dialog.getByRole("textbox", { name: "Event title" }).fill("Fictional retimed convoy");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect.poll(() => patches.length).toBe(1);
    expect(patches[0]).toMatchObject({
      title: "Fictional retimed convoy",
      meetingAt: "2099-10-25T12:00:00.000Z",
      startsAt: "2099-10-25T14:00:30.500Z",
    });
  },
);

test(
  "Stage 2 edit dialog: digits typed into filled time segments replace them",
  browserCase(["@functional"]),
  async ({ page }) => {
    const { dialog, schedule, patches } = await editDialog(page, "2099-10-25T14:00:00.000Z");
    const meeting = timeField(schedule, "Meeting time");
    const start = timeField(schedule, "Start time");
    const hours = start.segment("hours"),
      minutes = start.segment("minutes");
    await expect(hours).toHaveValue("17");
    await expect(minutes).toHaveValue("00");

    // Tab from the meeting minutes into the filled start hours.
    await meeting.segment("minutes").focus();
    await page.keyboard.press("Tab");
    await expect(hours).toBeFocused();
    await page.keyboard.type("9");
    await expect(hours).toHaveValue("09");
    await expect(minutes).toBeFocused();
    await page.keyboard.type("30");
    await expect(minutes).toHaveValue("30");
    // Shift+Tab back into the filled hours replaces them as well.
    await page.keyboard.press("Shift+Tab");
    await expect(hours).toBeFocused();
    await page.keyboard.type("1");
    await expect(hours).toHaveValue("1");
    await page.keyboard.type("8");
    await expect(hours).toHaveValue("18");
    await expect(minutes).toBeFocused();
    await expect(minutes).toHaveValue("30");

    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect.poll(() => patches.length).toBe(1);
    expect(patches[0]).toMatchObject({
      meetingAt: "2099-10-25T12:00:00.000Z",
      startsAt: "2099-10-25T15:30:00.000Z",
    });
  },
);

test(
  "Stage 2 incomplete dates and times are kept as typed and block saving as invalid times",
  browserCase(["@functional"]),
  async ({ page }) => {
    await mockEventsStage2(page, "manager", "en", { draftsRollout: true });
    const posts = captureWrites(page, "POST", "/api/v1/admin/events");
    await page.goto("/account/events/new");
    await catalogLanguage(page);
    const schedule = page.getByRole("group", { name: "When", exact: true });
    const date = dateTimeField(schedule, "Date");
    const meeting = timeField(schedule, "Meeting time");
    const start = timeField(schedule, "Start time");
    const save = page.getByRole("button", { name: "Save draft", exact: true });
    const startField = schedule.getByRole("group", { name: "Start time", exact: true });
    const invalidTime = startField.getByText("Enter a valid date and time.", { exact: true });
    await date.date.fill("10/25/2099");
    await meeting.segment("hours").fill("12");
    await meeting.segment("minutes").fill("00");
    await start.segment("hours").focus();
    await page.keyboard.type("1");
    await expect(start.segment("hours")).toHaveValue("1");
    await expect(start.segment("hours")).toBeFocused();

    await save.click();
    await expect(invalidTime).toBeVisible();
    await expect(start.segment("hours")).toHaveAttribute("aria-invalid", "true");
    // The kept digit is padded when focus leaves the segment; it is not cleared.
    await expect(start.segment("hours")).toHaveValue("01");
    await expect(start.segment("minutes")).toHaveValue("");
    expect(posts).toEqual([]);

    // An incomplete shared date keeps both times and an error instead of clearing them.
    await start.segment("hours").fill("13");
    await start.segment("minutes").fill("00");
    await date.date.fill("10/25/20");
    await save.click();
    await expect(invalidTime).toBeVisible();
    await expect(date.date).toHaveValue("10/25/20");
    await expect(start.segment("hours")).toHaveValue("13");
    await expect(meeting.segment("hours")).toHaveValue("12");
    expect(posts).toEqual([]);

    await date.date.fill("10/25/2099");
    await save.click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toMatchObject({
      meetingAt: "2099-10-25T09:00:00.000Z",
      startsAt: "2099-10-25T10:00:00.000Z",
    });
  },
);

test(
  "legacy event editor keeps native required times and creates exact UTC instants",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await mockEvents(page, true);
    await page.goto("/account/events/new");
    await catalogLanguage(page);
    for (const [label, value] of [
      ["Event title", "Fictional legacy timing"],
      ["Server", "Fictional Simulation"],
      ["Organizer", "Fictional Yukon Team"],
      ["Route", "Fictional North → Fictional South"],
      ["Meeting location", "Fictional harbour"],
      ["Description", "Synthetic legacy timing check."],
    ])
      await page.getByLabel(label as string, { exact: true }).fill(value as string);
    const meeting = dateTimeField(page, "Meeting time (UTC)");
    const start = dateTimeField(page, "Start time (UTC)");
    const end = dateTimeField(page, "End time (UTC) · Optional");
    await expect(meeting.date).toHaveJSProperty("required", true);
    await expect(start.date).toHaveJSProperty("required", true);
    await expect(end.date).toHaveJSProperty("required", false);

    const create = page.getByRole("button", { name: "Create event", exact: true });
    await create.click();
    expect(state.commands).toEqual([]);
    await expect(meeting.date).toBeFocused();

    await meeting.date.fill("10/25/2099");
    await meeting.segment("hours").fill("18");
    await meeting.segment("minutes").fill("45");
    await start.date.fill("10/25/2099");
    await start.segment("hours").fill("19");
    await start.segment("minutes").fill("00");
    await create.click();
    await expect.poll(() => state.commands.length).toBe(1);
    expect(state.commands[0]?.body).toMatchObject({
      meetingAt: "2099-10-25T18:45:00.000Z",
      startsAt: "2099-10-25T19:00:00.000Z",
      endsAt: null,
    });
  },
);

for (const locale of ["ru", "en"] as const)
  test(
    `event date and time fields ${locale} fit the editor dialog and keep the calendar on screen`,
    browserCase(["@layout"]),
    async ({ page }, info) => {
      await mockEventsStage2(page, "manager", locale);
      await page.goto(detailsPath);
      await catalogLanguage(page, locale);
      const edit = locale === "ru" ? "Изменить событие" : "Edit event";
      await page.getByRole("button", { name: edit, exact: true }).click();
      const dialog = page.getByRole("dialog", { name: edit });
      const schedule = dialog.getByRole("group", {
        name: locale === "ru" ? "Когда" : "When",
        exact: true,
      });
      const date = dateTimeField(schedule, locale === "ru" ? "Дата" : "Date");
      const times = (locale === "ru" ? ["Сбор", "Старт"] : ["Meeting time", "Start time"]).map(
        (name) => timeField(schedule, name),
      );
      const dialogBox = await dialog.boundingBox();
      for (const control of [date.field, ...times.map((time) => time.time)]) {
        await control.scrollIntoViewIfNeeded();
        const box = await control.boundingBox();
        expect(box && dialogBox).toBeTruthy();
        if (box && dialogBox)
          expect(box.x + box.width).toBeLessThanOrEqual(dialogBox.x + dialogBox.width);
        expect(
          await control.evaluate((element) => element.scrollWidth <= element.clientWidth),
        ).toBe(true);
      }
      if (phone(page))
        for (const target of [date.calendarButton, ...times.map((time) => time.segment("hours"))]) {
          const box = await target.boundingBox();
          expect(box?.height ?? 0).toBeGreaterThanOrEqual(40);
          expect(box?.width ?? 0).toBeGreaterThanOrEqual(40);
        }
      await date.field.scrollIntoViewIfNeeded();
      await date.calendarButton.click();
      const picker = page.getByRole("dialog", { name: /^(Календарь|Calendar): / });
      await expect(picker.locator('button[data-day="2099-10-25"]')).toBeFocused();
      const box = await picker.boundingBox();
      const viewport = page.viewportSize();
      expect(box && viewport).toBeTruthy();
      if (box && viewport) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
        expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
      }
      await page.screenshot({ path: info.outputPath(`event-date-time-calendar-${locale}.png`) });
      await page.keyboard.press("Escape");
      await expect(picker).toHaveCount(0);
      await expect(dialog).toBeVisible();
      await expect(date.date).toBeFocused();
    },
  );
