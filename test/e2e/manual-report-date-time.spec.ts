import type { Locator, Page } from "@playwright/test";
import { accountFixture } from "../../apps/web/src/features/account/fixtures.ts";
import { catalogLanguage } from "./support/catalogs.ts";
import { dateTimeField } from "./support/date-time.ts";
import { browserCase, expect, test } from "./support/fixtures.ts";
import { phone } from "./support/locale.ts";
import { completeForm, example, mockTrips } from "./support/trip-ui.ts";

// An English browser in another time zone than the account: the field follows the interface
// language and the account display timezone, never navigator settings.
test.use({ locale: "en-US", timezoneId: "America/Los_Angeles" });

// 12:00 UTC is 04:00 on 13 November in the browser zone and 02:00 on 14 November in the account
// zone, so 14 November is the last day a manual report can pick.
const now = new Date("2026-11-13T12:00:00.000Z");
const accountZone = "Pacific/Kiritimati";

async function openReport(page: Page) {
  await page.clock.setFixedTime(now);
  await mockTrips(page);
  const self = accountFixture("en");
  self.data.preferences.displayTimezone = accountZone;
  await page.route("**/api/v1/me", (route) => route.fulfill({ json: self }));
  let body: { fields?: Record<string, unknown> } | undefined;
  await page.route("**/api/v1/manual-reports", (route) => {
    body = route.request().postDataJSON();
    return route.fulfill({ status: 201, json: example("submitManualReport:dated") });
  });
  await page.goto("/account/reports/new");
  await expect(page.locator("#manual-file")).toBeVisible();
  return () => body;
}
const calendar = (page: Page, field: string) =>
  page.getByRole("dialog", { name: new RegExp(`^(Календарь|Calendar): ${field}$`) });
const day = (calendar: Locator, iso: string) => calendar.locator(`button[data-day="${iso}"]`);

test(
  "manual report date and time: Russian keyboard journey, account-zone limit and exact submission",
  browserCase(["@functional"]),
  async ({ page }) => {
    const submitted = await openReport(page);
    await catalogLanguage(page);
    await completeForm(page);
    await catalogLanguage(page, "ru");

    const start = dateTimeField(page, "Начало рейса");
    await expect(start.date).toHaveAttribute("placeholder", "дд.мм.гггг");
    await expect(start.date).toHaveAccessibleDescription(/Формат даты: дд\.мм\.гггг/);
    await start.date.fill("");
    await start.date.pressSequentially("05.11.2026");
    await page.keyboard.press("Tab");
    await expect(start.calendarButton).toBeFocused();
    await expect(start.calendarButton).toHaveAccessibleName("Выбрать дату: Начало рейса");
    await page.keyboard.press("Enter");
    const picker = calendar(page, "Начало рейса");
    const caption = picker.getByRole("status");
    await expect(picker).toBeVisible();
    await expect(day(picker, "2026-11-05")).toBeFocused();
    await expect(caption).toHaveText("Ноябрь 2026");
    await expect(picker.locator(".calendar-weekday")).toHaveText([
      "пн",
      "вт",
      "ср",
      "чт",
      "пт",
      "сб",
      "вс",
    ]);

    await page.keyboard.press("ArrowLeft");
    await expect(day(picker, "2026-11-04")).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(day(picker, "2026-10-28")).toBeFocused();
    await expect(caption).toHaveText("Октябрь 2026");
    await page.keyboard.press("ArrowDown");
    await expect(day(picker, "2026-11-04")).toBeFocused();
    await expect(caption).toHaveText("Ноябрь 2026");
    await page.keyboard.press("PageUp");
    await expect(day(picker, "2026-10-04")).toBeFocused();
    await expect(caption).toHaveText("Октябрь 2026");
    await page.keyboard.press("PageDown");
    await expect(day(picker, "2026-11-04")).toBeFocused();
    // Today is read in the account zone; later days cannot be picked.
    await expect(day(picker, "2026-11-14")).toBeEnabled();
    await expect(day(picker, "2026-11-14")).toHaveAccessibleName(/^Сегодня, /);
    await expect(day(picker, "2026-11-15")).toBeDisabled();
    await page.keyboard.press("Enter");
    await expect(picker).toHaveCount(0);
    await expect(start.date).toBeFocused();
    await expect(start.date).toHaveValue("04.11.2026");

    await page.keyboard.press("ArrowDown");
    await expect(day(picker, "2026-11-04")).toBeFocused();
    await expect(day(picker, "2026-11-04")).toHaveAccessibleName(/, выбрано$/);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
    await expect(start.date).toBeFocused();
    await expect(start.date).toHaveValue("04.11.2026");

    // 24-hour segments: typing advances from hours to minutes; arrows step and wrap.
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    const hours = start.segment("hours"),
      minutes = start.segment("minutes");
    await expect(hours).toBeFocused();
    await page.keyboard.type("0930");
    await expect(hours).toHaveValue("09");
    await expect(minutes).toHaveValue("30");
    await expect(minutes).toBeFocused();
    await expect(hours).toHaveAttribute("aria-valuetext", "09");
    await page.keyboard.press("ArrowUp");
    await expect(minutes).toHaveValue("31");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(minutes).toHaveValue("29");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowLeft");
    await expect(hours).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(hours).toHaveValue("08");
    await page.keyboard.press("ArrowUp");
    await expect(hours).toHaveValue("09");
    await expect(start.time).toHaveAccessibleName("Время, Начало рейса");
    await expect(start.time.getByRole("spinbutton")).toHaveCount(2);
    await expect(start.field).toContainText(accountZone);
    await expect(start.field).not.toContainText(/AM|PM/);

    // Switching the interface language reformats the typed date and keeps the time.
    await catalogLanguage(page, "en");
    const startEn = dateTimeField(page, "Trip start");
    await expect(startEn.date).toHaveValue("11/04/2026");
    await expect(startEn.segment("hours")).toHaveValue("09");
    await expect(startEn.segment("minutes")).toHaveValue("30");

    const end = dateTimeField(page, "Trip completion");
    await expect(end.date).toHaveAttribute("placeholder", "mm/dd/yyyy");
    // Without a typed date the calendar opens on the account-zone today.
    await end.date.fill("");
    await end.calendarButton.click();
    const endPicker = calendar(page, "Trip completion");
    await expect(endPicker.getByRole("status")).toHaveText("November 2026");
    await expect(endPicker.locator(".calendar-weekday")).toHaveText([
      "Su",
      "Mo",
      "Tu",
      "We",
      "Th",
      "Fr",
      "Sa",
    ]);
    await page.keyboard.press("Escape");
    await expect(endPicker).toHaveCount(0);
    await expect(end.date).toBeFocused();
    await end.date.fill("11/04/2026");
    await end.segment("hours").focus();
    await page.keyboard.type("2105");
    await expect(end.segment("hours")).toHaveValue("21");
    await expect(end.segment("minutes")).toHaveValue("05");
    await expect(end.field).not.toContainText(/AM|PM/);

    await page.getByRole("button", { name: "Submit for review", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
    // Account zone UTC+14: the wall clock converts in the form, not in the field.
    await expect
      .poll(() => submitted()?.fields)
      .toMatchObject({
        startedAt: "2026-11-03T19:30:00.000Z",
        completedAt: "2026-11-04T07:05:00.000Z",
      });
  },
);

test(
  "manual report date and time: invalid and incomplete entries use the existing field error",
  browserCase(["@functional"]),
  async ({ page }) => {
    await openReport(page);
    await catalogLanguage(page, "ru");
    const start = dateTimeField(page, "Начало рейса");
    const missing = page.getByRole("list", {
      name: "Перед отправкой заполните или исправьте:",
      exact: true,
    });
    await start.date.fill("31.02.2026");
    await start.segment("hours").fill("10");
    await start.segment("minutes").fill("00");
    await expect(start.date).toHaveAttribute("aria-invalid", "true");
    await expect(start.segment("hours")).toHaveAttribute("aria-invalid", "true");
    await expect(start.date).toHaveAccessibleDescription(
      /Укажите существующие дату и время в указанном часовом поясе\./,
    );
    await expect(page.getByRole("alert")).toContainText("Укажите существующие дату и время");
    await expect(missing).toContainText("Начало рейса");

    // A complete date without time is not silently empty.
    await start.date.fill("28.02.2026");
    await start.segment("minutes").fill("");
    await expect(start.date).toHaveAttribute("aria-invalid", "true");
    await start.segment("minutes").fill("15");
    await expect(start.date).not.toHaveAttribute("aria-invalid");
    await expect(start.segment("hours")).not.toHaveAttribute("aria-invalid");

    // Clearing every part leaves the field empty and only required.
    await start.date.fill("");
    await start.segment("hours").fill("");
    await start.segment("minutes").fill("");
    await expect(start.date).not.toHaveAttribute("aria-invalid");
    await expect(start.date).toHaveAttribute("aria-required", "true");
    await page.locator('label[for="startedAt"]').click();
    await expect(start.date).toBeFocused();
    await expect(missing).toContainText("Начало рейса");
  },
);

for (const locale of ["ru", "en"] as const)
  test(
    `manual report date and time ${locale} fits the viewport with readable targets`,
    browserCase(["@layout"]),
    async ({ page }, info) => {
      await openReport(page);
      await catalogLanguage(page, locale);
      const start = dateTimeField(page, locale === "ru" ? "Начало рейса" : "Trip start");
      await start.date.fill(locale === "ru" ? "04.11.2026" : "11/04/2026");
      await start.segment("hours").fill("09");
      await start.segment("minutes").fill("30");
      await start.field.scrollIntoViewIfNeeded();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      for (const input of [start.date, start.segment("hours"), start.segment("minutes")]) {
        // The placeholder fits the content box of its control.
        const fits = await input.evaluate((element) => {
          const control = element as HTMLInputElement;
          const style = getComputedStyle(control);
          const context = document.createElement("canvas").getContext("2d");
          if (!context) return false;
          context.font = style.font;
          const inner =
            control.clientWidth -
            Number.parseFloat(style.paddingLeft) -
            Number.parseFloat(style.paddingRight);
          return (
            context.measureText(control.placeholder).width <= inner + 0.5 &&
            context.measureText(control.value).width <= inner + 0.5
          );
        });
        expect(fits).toBe(true);
      }
      if (phone(page)) {
        for (const target of [
          start.date,
          start.calendarButton,
          start.segment("hours"),
          start.segment("minutes"),
        ]) {
          const box = await target.boundingBox();
          expect(box?.height ?? 0).toBeGreaterThanOrEqual(40);
          if (target !== start.date) expect(box?.width ?? 0).toBeGreaterThanOrEqual(40);
        }
      }
      await page.screenshot({ path: info.outputPath(`manual-date-time-${locale}.png`) });
      await start.calendarButton.click();
      const picker = calendar(page, locale === "ru" ? "Начало рейса" : "Trip start");
      await expect(day(picker, "2026-11-04")).toBeFocused();
      const box = await picker.boundingBox();
      const viewport = page.viewportSize();
      expect(box && viewport).toBeTruthy();
      if (box && viewport) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
        expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
      }
      if (phone(page)) {
        const target = await day(picker, "2026-11-04").boundingBox();
        expect(target?.width ?? 0).toBeGreaterThanOrEqual(40);
        expect(target?.height ?? 0).toBeGreaterThanOrEqual(40);
      }
      await page.screenshot({ path: info.outputPath(`manual-date-time-calendar-${locale}.png`) });
      await page.keyboard.press("Escape");
      await expect(picker).toHaveCount(0);
    },
  );
