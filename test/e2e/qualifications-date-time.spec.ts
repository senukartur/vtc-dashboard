import type { Page, Request } from "@playwright/test";
import { catalogLanguage } from "./support/catalogs.ts";
import { dateTimeField } from "./support/date-time.ts";
import { browserCase, expect, test } from "./support/fixtures.ts";
import { phone } from "./support/locale.ts";
import { mockQualifications } from "./support/qualifications.ts";

// An English browser outside UTC: qualification times stay explicit UTC wall clocks.
test.use({ locale: "en-US", timezoneId: "Asia/Tokyo" });
// 13 November 2026 in UTC (already 14 November in the browser zone).
const now = new Date("2026-11-13T20:00:00.000Z");

const calendar = (page: Page, field: string) =>
  page.getByRole("dialog", { name: new RegExp(`^(Календарь|Calendar): ${field}$`) });

async function historicalAssignment(page: Page) {
  await page.locator("#assignment-purpose").selectOption("historical_resolution");
  await page.locator("#assignment-level").selectOption("d3400000-0000-4000-8000-000000000001");
}

test(
  "historical assignment takes exact millisecond UTC bounds and no future days",
  browserCase(["@functional"]),
  async ({ page }) => {
    await page.clock.setFixedTime(now);
    await mockQualifications(page);
    const posts: Record<string, unknown>[] = [];
    page.on("request", (request: Request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname.endsWith("/qualification-assignments")
      )
        posts.push(request.postDataJSON());
    });
    await page.goto("/account/qualifications");
    await catalogLanguage(page);
    await historicalAssignment(page);

    const start = dateTimeField(page, "Interval start (UTC)");
    await expect(start.time.getByRole("spinbutton")).toHaveCount(4);
    await start.date.fill("01/01/2025");
    await start.segment("hours").focus();
    await page.keyboard.type("000000000");
    await expect(start.segment("milliseconds")).toHaveValue("000");
    await expect(start.segment("milliseconds")).toBeFocused();

    const end = dateTimeField(page, "Exclusive interval end (UTC)");
    await end.date.fill("01/31/2025");
    await end.segment("hours").focus();
    await page.keyboard.type("235959999");
    for (const [segment, value] of [
      ["hours", "23"],
      ["minutes", "59"],
      ["seconds", "59"],
      ["milliseconds", "999"],
    ] as const)
      await expect(end.segment(segment)).toHaveValue(value);
    await expect(
      page.getByText("UTC · [ 2025-01-01T00:00:00.000Z, 2025-01-31T23:59:59.999Z )", {
        exact: true,
      }),
    ).toBeVisible();

    // Later UTC days cannot be picked even though the browser zone is already on 14 November.
    await end.date.fill("11/10/2026");
    await end.calendarButton.click();
    const picker = calendar(page, "Exclusive interval end \\(UTC\\)");
    await expect(picker.locator('button[data-day="2026-11-10"]')).toBeFocused();
    await expect(picker.locator('button[data-day="2026-11-13"]')).toBeEnabled();
    await expect(picker.locator('button[data-day="2026-11-14"]')).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(end.date).toBeFocused();
    await end.date.fill("01/31/2025");

    await page.locator("#assignment-reason").fill("Fictional exact historical interval");
    await page.getByRole("button", { name: "Assign qualification", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(
      "UTC · [2025-01-01T00:00:00.000Z, 2025-01-31T23:59:59.999Z)",
    );
    await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toMatchObject({
      purpose: "historical_resolution",
      assignedAt: "2025-01-01T00:00:00.000Z",
      endedAt: "2025-01-31T23:59:59.999Z",
    });
  },
);

test(
  "scheduled rule effective time is required, starts today and publishes an exact instant",
  browserCase(["@functional"]),
  async ({ page }) => {
    await page.clock.setFixedTime(now);
    const state = await mockQualifications(page);
    await page.goto("/account/qualifications");
    await catalogLanguage(page);
    const card = page
      .getByRole("heading", { name: "Fictional trainee · ETS2", exact: true })
      .locator("..");
    await card.getByRole("button", { name: "Edit rules", exact: true }).click();
    const editor = card.locator("section").last();
    await editor.locator('[id^="mass-"]').fill("12");
    await editor.locator('[id^="mode-"]').selectOption("schedule");
    const effective = dateTimeField(editor, "Effective time (UTC) (required)");
    await expect(effective.date).toHaveJSProperty("required", true);
    await expect(effective.date).toHaveAttribute("aria-invalid", "true");
    await expect(effective.segment("hours")).toHaveAttribute("aria-invalid", "true");
    await expect(effective.time.getByRole("spinbutton")).toHaveCount(2);
    const publish = editor.getByRole("button", { name: "Publish rule version", exact: true });
    await expect(publish).toBeDisabled();

    await effective.calendarButton.click();
    const picker = calendar(page, "Effective time \\(UTC\\)");
    await expect(picker.locator('button[data-day="2026-11-13"]')).toBeFocused();
    await expect(picker.locator('button[data-day="2026-11-12"]')).toBeDisabled();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(picker.locator('button[data-day="2026-12-04"]')).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(effective.date).toBeFocused();
    await expect(effective.date).toHaveValue("12/04/2026");
    await effective.segment("hours").fill("08");
    await effective.segment("minutes").fill("15");
    await expect(effective.date).not.toHaveAttribute("aria-invalid");
    await expect(editor.getByText("2026-12-04T08:15:00.000Z", { exact: true })).toBeVisible();
    await publish.click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
    await expect.poll(() => state.publications.length).toBe(1);
    expect(state.publications[0]?.effectiveAt).toBe("2026-12-04T08:15:00.000Z");
  },
);

for (const locale of ["ru", "en"] as const)
  test(
    `qualification date and time fields ${locale} fit with millisecond segments`,
    browserCase(["@layout"]),
    async ({ page }, info) => {
      await page.clock.setFixedTime(now);
      await mockQualifications(page, locale);
      await page.goto("/account/qualifications");
      await catalogLanguage(page, locale);
      await historicalAssignment(page);
      const label = locale === "ru" ? "Начало интервала (UTC)" : "Interval start (UTC)";
      const start = dateTimeField(page, label);
      await start.date.fill(locale === "ru" ? "01.01.2025" : "01/01/2025");
      await start.segment("hours").focus();
      await page.keyboard.type("235959999");
      await start.field.scrollIntoViewIfNeeded();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      for (const name of ["hours", "minutes", "seconds", "milliseconds"] as const) {
        const segment = start.segment(name);
        expect(
          await segment.evaluate((element) => element.scrollWidth <= element.clientWidth),
        ).toBe(true);
        if (phone(page)) {
          const box = await segment.boundingBox();
          expect(box?.height ?? 0).toBeGreaterThanOrEqual(40);
          expect(box?.width ?? 0).toBeGreaterThanOrEqual(40);
        }
      }
      await page.screenshot({ path: info.outputPath(`qualification-date-time-${locale}.png`) });
      await start.calendarButton.click();
      const picker = calendar(page, label.replace("(UTC)", "\\(UTC\\)"));
      await expect(picker.locator('button[data-day="2025-01-01"]')).toBeFocused();
      const box = await picker.boundingBox();
      const viewport = page.viewportSize();
      expect(box && viewport).toBeTruthy();
      if (box && viewport) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
        expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
      }
      await page.screenshot({
        path: info.outputPath(`qualification-date-time-calendar-${locale}.png`),
      });
      await page.keyboard.press("Escape");
      await expect(start.date).toBeFocused();
    },
  );
