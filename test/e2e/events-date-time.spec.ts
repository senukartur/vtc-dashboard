import type { Page, Request } from "@playwright/test";
import type { components } from "@vtc/contracts";
import { stage2Fixture } from "../fixtures/events-stage-2.ts";
import { catalogLanguage } from "./support/catalogs.ts";
import { dateTimeField } from "./support/date-time.ts";
import { mockEvents } from "./support/events.ts";
import { detailsPath } from "./support/events-detail.ts";
import { mockEventsStage2 } from "./support/events-stage-2.ts";
import { browserCase, expect, test } from "./support/fixtures.ts";
import { phone } from "./support/locale.ts";

// An English browser outside UTC: event organizer times stay explicit UTC wall clocks.
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

test(
  "Stage 2 event times: Russian keyboard and calendar entry saves exact UTC instants",
  browserCase(["@functional"]),
  async ({ page }) => {
    await mockEventsStage2(page, "manager", "ru", { draftsRollout: true });
    const posts = captureWrites(page, "POST", "/api/v1/admin/events");
    await page.goto("/account/events/new");
    await catalogLanguage(page, "ru");
    await page.getByRole("textbox", { name: "Название события" }).fill("Fictional date convoy");

    const meeting = dateTimeField(page, "Время сбора (UTC)");
    await expect(meeting.field).toContainText("UTC");
    await expect(meeting.time).toHaveAccessibleDescription(/Часовой пояс: UTC/);
    await meeting.date.focus();
    await page.keyboard.type("25.10.2099");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.type("1200");
    await expect(meeting.segment("hours")).toHaveValue("12");
    await expect(meeting.segment("minutes")).toHaveValue("00");

    const start = dateTimeField(page, "Время старта (UTC)");
    await start.date.fill("25.10.2099");
    await start.date.press("ArrowDown");
    const picker = calendar(page, "Время старта");
    await expect(picker.locator('button[data-day="2099-10-25"]')).toBeFocused();
    await expect(picker.getByRole("status")).toHaveText("Октябрь 2099");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await expect(picker).toHaveCount(0);
    await expect(start.date).toBeFocused();
    await expect(start.date).toHaveValue("26.10.2099");
    await start.segment("hours").focus();
    await page.keyboard.type("1330");

    await page.getByRole("button", { name: "Сохранить черновик", exact: true }).click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toMatchObject({
      draft: true,
      meetingAt: "2099-10-25T12:00:00.000Z",
      startsAt: "2099-10-26T13:30:00.000Z",
      endsAt: null,
    });
  },
);

test(
  "Stage 2 edit dialog keeps untouched exact times and Escape closes only the calendar",
  browserCase(["@functional"]),
  async ({ page }) => {
    await mockEventsStage2(page, "manager");
    const detail = stage2Fixture("getEvent", "structured")
      .response as components["schemas"]["EventStage2EnvelopeMember"];
    detail.data.event.startsAt = "2099-10-25T14:00:30.500Z";
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
    const start = dateTimeField(dialog, "Start time (UTC)");
    await expect(start.date).toHaveValue("10/25/2099");
    await expect(start.segment("hours")).toHaveValue("14");
    await expect(start.segment("minutes")).toHaveValue("00");

    await start.calendarButton.click();
    const picker = calendar(page, "Start time");
    await expect(picker.locator('button[data-day="2099-10-25"]')).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await expect(start.date).toBeFocused();

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
      const labels =
        locale === "ru"
          ? ["Время сбора (UTC)", "Время старта (UTC)", "Время окончания (UTC) · Необязательно"]
          : ["Meeting time (UTC)", "Start time (UTC)", "End time (UTC) · Optional"];
      for (const label of labels) {
        const control = dateTimeField(dialog, label);
        await control.field.scrollIntoViewIfNeeded();
        const fieldBox = await control.field.boundingBox();
        const dialogBox = await dialog.boundingBox();
        expect(fieldBox && dialogBox).toBeTruthy();
        if (fieldBox && dialogBox)
          expect(fieldBox.x + fieldBox.width).toBeLessThanOrEqual(dialogBox.x + dialogBox.width);
        expect(
          await control.field.evaluate((element) => element.scrollWidth <= element.clientWidth),
        ).toBe(true);
        if (phone(page))
          for (const target of [control.calendarButton, control.segment("hours")]) {
            const box = await target.boundingBox();
            expect(box?.height ?? 0).toBeGreaterThanOrEqual(40);
            expect(box?.width ?? 0).toBeGreaterThanOrEqual(40);
          }
      }
      const meeting = dateTimeField(dialog, labels[0] ?? "");
      await meeting.field.scrollIntoViewIfNeeded();
      await meeting.calendarButton.click();
      const picker = page.getByRole("dialog", {
        name: /^(Календарь|Calendar): /,
      });
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
      await expect(meeting.date).toBeFocused();
    },
  );
