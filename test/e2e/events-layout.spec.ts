import type { Locator, Page, TestInfo } from "@playwright/test";
import type { components } from "@vtc/contracts";
import { fixtureId } from "../../apps/web/src/features/account/fixtures.ts";
import { stage2Fixture } from "../fixtures/events-stage-2.ts";
import { catalogLanguage } from "./support/catalogs.ts";
import { eventFixture, eventId, mockEvents } from "./support/events.ts";
import {
  coverCaption,
  detailsPath,
  eventPath,
  galleryLabel,
  lastCaption,
  middleCaption,
  mockStructuredDetail,
  organizerLabel,
} from "./support/events-detail.ts";
import { mockEventsStage2 } from "./support/events-stage-2.ts";
import { browserCase, expect, test } from "./support/fixtures.ts";

type S = components["schemas"];
const text = {
  en: {
    title: "Company events",
    response: "Your response",
    participating: "Participating",
    declined: "Can't attend",
    unanswered: "No answer",
    signedUp: "Signed up",
    cantAttend: "Can't attend",
    participants: "Participants",
    save: "Save response",
    reason: "Private decline reason",
  },
  ru: {
    title: "События компании",
    response: "Ваш ответ",
    participating: "Участвую",
    declined: "Не смогу",
    unanswered: "Без ответа",
    signedUp: "Записались",
    cantAttend: "Не смогут",
    participants: "Участники",
    save: "Сохранить ответ",
    reason: "Личная причина отказа",
  },
} as const;
const slogan = /Достаточно суров|Юкон\?|Yukon\?/;
const privateReads = /participants|decliners|response-counts|my-response|attendance/;
const longNames = [
  "Фиктивный_Дальнобойщик_Северного_Маршрута",
  "Фиктивная Водительница Ночного Конвоя",
  "Fictional_Long_Haul_Night_Convoy_Driver",
];
const person = (index: number, nickname: string): S["Participant"] => ({
  member: {
    id: `e0582000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    nickname,
    formerMember: index === 3,
    roles: ["driver"],
  },
});

async function box(locator: Locator) {
  const value = await locator.boundingBox();
  if (!value) throw new Error("ELEMENT_NOT_RENDERED");
  return value;
}
const workspace = (page: Page) => page.locator(".events-page");
/**
 * Words that wrap mid-word (a word whose text range spans several lines). Only .events-break
 * (IDs and exact masses) may break anywhere; options of a closed select have no visible lines.
 */
async function brokenWords(root: Locator) {
  return root.evaluate((element) => {
    const broken: string[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement?.closest(".events-break, select")) continue;
      for (const match of (node.textContent ?? "").matchAll(/[^\s-]+/g)) {
        const range = document.createRange();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        const lines = new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top)));
        if (lines.size > 1) broken.push(match[0]);
      }
    }
    return broken;
  });
}
/** The next read of a path ending in `suffix` with `status` (await it before changing the mock). */
function read(page: Page, suffix: string, status: number) {
  return page.waitForResponse(
    (response) => new URL(response.url()).pathname.endsWith(suffix) && response.status() === status,
  );
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test(
  "the mobile event editor keeps visibility choices and the end date and time in rows",
  browserCase(["@layout", "@viewport-mobile"]),
  async ({ page }) => {
    await mockEventsStage2(page, "manager", "ru", { draftsRollout: true });
    await page.goto("/account/events/new");
    await catalogLanguage(page, "ru");
    const main = page.getByRole("main");
    const members = main.getByRole("button", { name: "Только компания", exact: true });
    const everyone = main.getByRole("button", { name: "Все, и на сайте", exact: true });
    await expect(members).toHaveAttribute("aria-pressed", "true");
    await page.evaluate(() => document.fonts.ready);
    const first = await box(members);
    const second = await box(everyone);
    expect(first.x + first.width).toBeLessThanOrEqual(second.x);
    expect(first.y).toBeCloseTo(second.y, 0);
    expect(first.width).toBeCloseTo(second.width, 0);
    expect(first.height).toBeGreaterThanOrEqual(44);
    await everyone.tap();
    await expect(everyone).toHaveAttribute("aria-pressed", "true");
    await expect(members).toHaveAttribute("aria-pressed", "false");

    const schedule = main.getByRole("group", { name: "Когда", exact: true });
    await schedule.getByRole("textbox", { name: "Дата", exact: true }).fill("2099-10-25");
    await schedule.getByRole("button", { name: "+ Указать окончание", exact: true }).click();
    const end = schedule.getByRole("group", { name: "Окончание", exact: true });
    const date = end.getByRole("textbox", { name: "Дата", exact: true });
    const time = end.getByRole("textbox", { name: "Окончание", exact: true });
    const dateBox = await box(date);
    const timeBox = await box(time);
    expect(dateBox.x + dateBox.width).toBeLessThanOrEqual(timeBox.x);
    expect(dateBox.y).toBeCloseTo(timeBox.y, 0);
    await date.fill("2099-10-26");
    await time.fill("01:15");
    await expect(date).toHaveValue("2099-10-26");
    await expect(time).toHaveValue("01:15");
    const remove = schedule.getByRole("button", { name: "Убрать окончание", exact: true });
    await expect(remove).toHaveCSS("font-weight", "400");
    await expect(remove).toHaveCSS("padding-inline-start", "12px");
    await remove.click();
    await expect(end).toHaveCount(0);

    await main.getByRole("button", { name: "TruckersMP", exact: true }).click();
    const server = main.getByRole("textbox", { name: "Сервер", exact: true });
    expect(await server.getAttribute("list")).toBeNull();
    await server.fill("Fictional convoy server");
    await expect(server).toHaveValue("Fictional convoy server");
    const dlcs = main.getByRole("button", { name: "Нужные DLC", exact: true });
    await dlcs.click();
    await expect(dlcs).toHaveAttribute("aria-expanded", "true");
    await main.getByRole("button", { name: "Готово", exact: true }).click();
    await expect(dlcs).toHaveAttribute("aria-expanded", "false");
    await expect(dlcs).toBeFocused();
    await noOverflow(page);
  },
);

test(
  "the upcoming event header keeps a long title, local start time and RSVP on one line",
  browserCase(["@layout"]),
  async ({ page }) => {
    await mockEventsStage2(page, "manager", "en", { draftsRollout: true });
    const upcoming = stage2Fixture("getUpcomingEvent", "own-response")
      .response as S["EventStage2EnvelopeUpcoming"];
    if (!upcoming.data) throw new Error("Missing upcoming event fixture");
    const title = "Fictional evening convoy along the northern route ".repeat(4).trim();
    upcoming.data.event.title = title;
    upcoming.data.event.startsAt = "2099-10-25T22:30:00.000Z";
    await page.route(/\/api\/v1\/me\/upcoming-event\?/, (route) =>
      route.fulfill({ json: upcoming }),
    );
    await page.goto("/account/events/new");
    const banner = page.getByRole("banner");
    const link = banner.getByRole("link", { name: new RegExp(title) });
    const name = link.locator("strong");
    const start = link.locator("time");
    const icon = link.locator("svg");
    const going = banner.getByRole("button", { name: "Going", exact: true });
    await expect(name).toHaveText(title);
    await expect(link).toHaveAccessibleName(/Europe\/Warsaw · GMT\+01:00/);
    await expect(start).toContainText(/11:30 PM GMT\+1/i);
    await expect(icon).toHaveAttribute("aria-hidden", "true");
    await expect(going).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const [mark, label, date, button] = await Promise.all([
      box(icon),
      box(name),
      box(start),
      box(going),
    ]);
    expect(mark.x + mark.width).toBeLessThanOrEqual(label.x);
    expect(label.x + label.width).toBeLessThanOrEqual(date.x);
    expect(date.x + date.width).toBeLessThanOrEqual(button.x);
    expect(date.y + date.height / 2).toBeCloseTo(button.y + button.height / 2, 0);
    await noOverflow(page);
  },
);

async function capture(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
}
/** Interactive targets inside the workspace are at least 30px tall (40px on coarse pointers). */
async function smallTargets(root: Locator) {
  return root.evaluate((element) =>
    Array.from(element.querySelectorAll<HTMLElement>("a, button, textarea, select, input"))
      .filter((node) => node.getClientRects().length > 0)
      .filter((node) => node.getBoundingClientRect().height < 30)
      .map((node) => node.textContent?.trim() || node.tagName),
  );
}
/** No live region remains in the workspace; shell statuses such as the event chip are outside. */
async function quiet(page: Page) {
  await expect(workspace(page).getByRole("status")).toHaveCount(0);
  await expect(workspace(page).getByRole("alert")).toHaveCount(0);
  await expect(workspace(page).locator("[aria-live]")).toHaveCount(0);
}
async function openDetail(
  page: Page,
  locale: "en" | "ru" = "en",
  setup: (state: Awaited<ReturnType<typeof mockEvents>>) => void = () => {},
  staff = false,
) {
  const state = await mockEvents(page, staff, locale);
  setup(state);
  await page.goto(`/account/events/${eventId}`);
  if (locale !== "en") await catalogLanguage(page, locale);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(state.event.title);
  return state;
}
async function settledDetail(page: Page, locale: "en" | "ru" = "en") {
  const participants = page.getByRole("region", { name: text[locale].participants, exact: true });
  await expect(participants.locator(".events-counts")).not.toContainText(/…/);
  for (const name of [text[locale].signedUp, text[locale].cantAttend])
    await expect(
      participants.getByRole("region", { name, exact: true }).getByRole("status"),
    ).toHaveCount(0);
  return participants;
}

function listItems(locale: "en" | "ru"): S["EventPublic"][] {
  const base = eventFixture();
  return [
    {
      ...base,
      title:
        locale === "ru"
          ? "Фиктивный вечерний конвой по длинному северному маршруту"
          : "Fictional evening convoy along the long northern route",
    },
    {
      ...base,
      id: "e0582000-0000-4000-8000-000000000101",
      game: "ats",
      title: locale === "ru" ? "Фиктивный ночной рейс" : "Fictional night run",
      startsAt: "2099-10-25T23:30:00.000Z",
      meetingAt: "2099-10-25T23:00:00.000Z",
    },
    {
      ...base,
      id: "e0582000-0000-4000-8000-000000000102",
      title: locale === "ru" ? "Фиктивный отменённый конвой" : "Fictional cancelled convoy",
      status: "cancelled",
    },
  ];
}

for (const locale of ["en", "ru"] as const)
  test(
    `L1 ${locale} list rows keep the date tile left of the body and fit`,
    browserCase(["@layout"]),
    async ({ page }, info) => {
      await mockEvents(page, false, locale);
      const items = listItems(locale);
      await page.route("**/api/v1/events?*", (route) =>
        route.fulfill({
          json: { data: { items, nextCursor: null }, meta: { requestId: "synthetic-events-list" } },
        }),
      );
      await page.goto("/account/events");
      if (locale !== "en") await catalogLanguage(page, locale);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(text[locale].title);
      const rows = workspace(page).locator(".events-row");
      await expect(rows).toHaveCount(3);
      await expect(workspace(page)).toContainText(/Europe\/Warsaw \(GMT\+0[12]:00\)/);
      await expect(
        workspace(page).getByRole("heading", {
          level: 2,
          name: items[0]?.title ?? "",
          exact: true,
        }),
      ).toBeVisible();
      await expect(rows.nth(2).locator(".events-status")).toHaveText(
        locale === "en" ? "Cancelled" : "Отменено",
      );
      // 23:30 UTC on 25 October 2099 is 00:30 on the 26th in Warsaw (UTC+1 after summer time):
      // the tile follows the display timezone, not UTC.
      await expect(rows.nth(1).locator(".events-tile-day")).toHaveText("26");
      await expect(rows.nth(1)).toContainText("ATS");
      for (let index = 0; index < 3; index++) {
        const tile = await box(rows.nth(index).locator(".events-tile")),
          body = await box(rows.nth(index).locator(".events-row-body"));
        expect(tile.x + tile.width).toBeLessThanOrEqual(body.x);
      }
      await expect(page.getByRole("button", { name: "Event details" })).toHaveCount(0);
      await expect(
        page.getByRole("group", { name: locale === "en" ? "Period" : "Период", exact: true }),
      ).toBeVisible();
      await noOverflow(page);
      expect(await brokenWords(workspace(page))).toEqual([]);
      expect(await smallTargets(workspace(page))).toEqual([]);
      await quiet(page);
      await expect(page.locator("body")).not.toContainText(slogan);
      await capture(page, info, `events-list-${locale}`);
    },
  );

for (const locale of ["en", "ru"] as const)
  test(
    `L2 ${locale} upcoming detail places participants by width and keeps names whole`,
    browserCase(["@layout"]),
    async ({ page }, info) => {
      const state = await openDetail(page, locale, (s) => {
        s.response = { response: "participating", declineReason: null, version: 2 };
        s.extraParticipants = longNames.map((name, index) => person(index + 1, name));
        s.extraDecliners = [person(4, "Фиктивный_Отказавшийся_Водитель_Колонны")];
        s.event.description =
          locale === "ru"
            ? "Фиктивный сбор в гавани.\nВторая строка описания."
            : "Fictional harbour meeting.\nSecond description line.";
        s.prescribedMassKg = "21000.000000000000000001";
        s.prescribedCargoId = "e0350000-0000-4000-8000-000000000002";
      });
      const participants = await settledDetail(page, locale);
      const main = await box(workspace(page).locator(".events-main")),
        side = await box(workspace(page).locator(".events-side"));
      if (info.project.name === "desktop-chromium")
        expect(side.x).toBeGreaterThanOrEqual(main.x + main.width);
      else expect(side.y).toBeGreaterThanOrEqual(main.y + main.height);
      const counts = participants.locator(".events-counts");
      await expect(counts).toContainText(locale === "en" ? "✓ Participating: 4" : "✓ Участвуют: 4");
      await expect(counts).toContainText(locale === "en" ? "✕ Can't attend: 1" : "✕ Не смогут: 1");
      const signedUp = participants.getByRole("region", {
        name: text[locale].signedUp,
        exact: true,
      });
      for (const name of longNames)
        await expect(signedUp.getByRole("link", { name, exact: true })).toBeVisible();
      await expect(signedUp).toContainText(locale === "en" ? "(you)" : "(вы)");
      await expect(signedUp).toContainText(locale === "en" ? "former member" : "бывший участник");
      // The segmented options stay inside the response card at every width.
      const group = page.getByRole("group", { name: text[locale].response, exact: true }),
        card = await box(page.getByRole("region", { name: text[locale].response, exact: true }));
      for (const name of [
        text[locale].participating,
        text[locale].declined,
        text[locale].unanswered,
      ]) {
        const option = await box(group.getByRole("button", { name, exact: true }));
        expect(option.x).toBeGreaterThanOrEqual(card.x);
        expect(option.x + option.width).toBeLessThanOrEqual(card.x + card.width);
      }
      await expect(group.getByRole("button", { name: text[locale].participating })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      // The description keeps its line break; the prescribed mass is the only breakable value.
      expect(
        await workspace(page)
          .locator(".events-description")
          .evaluate((node) => getComputedStyle(node).whiteSpace),
      ).toBe("pre-wrap");
      await expect(workspace(page).locator(".events-break").first()).toHaveText(
        state.prescribedMassKg as string,
      );
      await expect(workspace(page).locator(".events-exception")).toBeVisible();
      await noOverflow(page);
      expect(await brokenWords(workspace(page))).toEqual([]);
      expect(await smallTargets(workspace(page))).toEqual([]);
      await quiet(page);
      await expect(page.locator("body")).not.toContainText(slogan);
      await capture(page, info, `events-detail-${locale}`);
    },
  );

test(
  "L2 ru keeps whole words at the narrowest two-column width",
  browserCase(["@layout", "@viewport-desktop"]),
  async ({ page }, info) => {
    await openDetail(page, "ru", (s) => {
      s.extraParticipants = longNames.map((name, index) => person(index + 1, name));
    });
    await settledDetail(page, "ru");
    let side = false;
    for (let width = 900; width <= 1400 && !side; width += 10) {
      await page.setViewportSize({ width, height: 900 });
      const main = await box(workspace(page).locator(".events-main")),
        right = await box(workspace(page).locator(".events-side"));
      side = right.x >= main.x + main.width;
    }
    expect(side).toBe(true);
    await noOverflow(page);
    expect(await brokenWords(workspace(page))).toEqual([]);
    await capture(page, info, "events-detail-ru-narrow-two-column");
  },
);

test(
  "L3 declining keeps focus, pending Save keeps focus and one saved status follows",
  browserCase(["@functional"]),
  async ({ page }, info) => {
    const state = await openDetail(page);
    await settledDetail(page);
    await quiet(page);
    const group = page.getByRole("group", { name: text.en.response, exact: true }),
      declined = group.getByRole("button", { name: text.en.declined, exact: true }),
      save = page.getByRole("button", { name: text.en.save, exact: true });
    await declined.click();
    await expect(declined).toBeFocused();
    await expect(declined).toHaveAttribute("aria-pressed", "true");
    const reason = page.getByRole("textbox", { name: text.en.reason, exact: true });
    await expect(reason).toBeVisible();
    await expect(reason).toHaveAccessibleDescription(/Only you, the director and deputies/);
    await reason.fill("Fictional night shift\nSecond line");
    // Switching away and back keeps the typed reason.
    await group.getByRole("button", { name: text.en.unanswered, exact: true }).click();
    await expect(reason).toHaveCount(0);
    await declined.click();
    await expect(reason).toHaveValue("Fictional night shift\nSecond line");
    let release = () => {};
    state.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await save.focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => state.commands.length).toBe(1);
    const pending = page.getByRole("button", { name: "Saving response…", exact: true });
    await expect(pending).toBeFocused();
    await expect(pending).toHaveAttribute("aria-disabled", "true");
    // A second activation and a choice change are ignored while the command is pending.
    await page.keyboard.press("Enter");
    // dispatchEvent clicks without moving focus, so the focus assertion below stays meaningful.
    await group
      .getByRole("button", { name: text.en.participating, exact: true })
      .dispatchEvent("click");
    await expect(declined).toHaveAttribute("aria-pressed", "true");
    await expect(pending).toBeFocused();
    await capture(page, info, "events-decline-pending");
    release();
    await expect(workspace(page).getByRole("status")).toHaveText("Response saved.");
    await expect(workspace(page).getByRole("status")).toHaveCount(1);
    await expect(save).toBeFocused();
    expect(state.commands).toHaveLength(1);
    expect(state.commands[0]?.body).toEqual({
      response: "declined",
      reason: "Fictional night shift\nSecond line",
    });
    await expect(workspace(page).getByRole("alert")).toHaveCount(0);
    const counts = page
      .getByRole("region", { name: text.en.participants, exact: true })
      .locator(".events-counts");
    await expect(counts).toContainText("✕ Can't attend: 1");
    await expect(counts).not.toHaveAttribute("role", /.+/);
    await expect(workspace(page).locator("[aria-live]")).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: text.en.cantAttend, exact: true }).getByRole("link", {
        name: "Fictional Yukon Member",
        exact: true,
      }),
    ).toBeVisible();
    await expect(workspace(page).locator(".events-state")).toContainText("You can't attend.");
  },
);

for (const locale of ["en", "ru"] as const)
  test(
    `L4 ${locale} a started event shows the closed summary without reading my-response`,
    browserCase(["@layout"]),
    async ({ page }, info) => {
      const state = await openDetail(page, locale, (s) => {
        s.event.startsAt = "2020-10-25T13:00:00.000Z";
        s.event.meetingAt = "2020-10-25T12:00:00.000Z";
        s.response = { response: "declined", declineReason: "Fictional own reason", version: 2 };
        s.ownAttendance = "attended";
      });
      await settledDetail(page, locale);
      const section = page.getByRole("region", { name: text[locale].response, exact: true });
      await expect(section).toContainText(
        locale === "en" ? "Your response before the start" : "Ваш ответ до начала",
      );
      await expect(section).toContainText(`✕ ${text[locale].declined}`);
      await expect(section).toContainText("Fictional own reason");
      await expect(section).toContainText(locale === "en" ? "Attended" : "Участвовал");
      await expect(page.getByRole("group", { name: text[locale].response })).toHaveCount(0);
      await expect(page.getByRole("button", { name: text[locale].save })).toHaveCount(0);
      expect(state.requests.filter((r) => r.includes("/my-response"))).toEqual([]);
      await noOverflow(page);
      expect(await brokenWords(workspace(page))).toEqual([]);
      await quiet(page);
      await capture(page, info, `events-started-${locale}`);
    },
  );

test(
  "L4 a manager sees the roster before the start with recording unavailable",
  browserCase(["@layout"]),
  async ({ page }, info) => {
    const state = await openDetail(page, "en", () => {}, true);
    await settledDetail(page);
    await page
      .getByRole("button", { name: "View responses and attendance", exact: true })
      .press("Enter");
    const roster = page.getByRole("form", { name: "Actual attendance", exact: true });
    const heading = roster.getByRole("heading", { name: "Actual attendance", exact: true });
    await expect(heading).toBeFocused();
    await expect(heading).toBeInViewport();
    await expect(roster.locator(".event-attendance-row")).toHaveCount(1);
    await expect(roster).toContainText("✕ Can't attend");
    await expect(roster).toContainText("Fictional private RSVP reason");
    await expect(
      roster.getByText("Available after the event starts", { exact: true }),
    ).toBeVisible();
    const record = roster.getByRole("button", { name: "Record attendance", exact: true });
    await expect(record).toBeDisabled();
    await expect(record).toHaveAccessibleDescription("Available after the event starts");
    await expect(roster.locator(`#attendance-${fixtureId}`)).toBeDisabled();
    // A regressed guard would first read /auth/csrf, so wait (bounded) for that request not to occur.
    const csrf = page
      .waitForRequest((request) => new URL(request.url()).pathname === "/api/v1/auth/csrf", {
        timeout: 2000,
      })
      .then(
        () => true,
        () => false,
      );
    await record.click({ force: true });
    await expect(record).toBeFocused();
    await page.keyboard.press("Enter");
    expect(await csrf).toBe(false);
    expect(state.requests.filter((r) => r === "GET /auth/csrf")).toEqual([]);
    expect(state.commands).toEqual([]);
    await noOverflow(page);
    expect(await brokenWords(workspace(page))).toEqual([]);
    await capture(page, info, "events-manager-upcoming");
  },
);

test(
  "L5 a cancelled event closes responses and hides organizer actions",
  browserCase(["@layout"]),
  async ({ page }, info) => {
    const state = await openDetail(
      page,
      "en",
      (s) => {
        s.event.status = "cancelled";
        s.response = { response: "participating", declineReason: null, version: 2 };
      },
      true,
    );
    await settledDetail(page);
    const section = page.getByRole("region", { name: text.en.response, exact: true });
    await expect(section).toContainText("Responses are closed: the event was cancelled.");
    await expect(section).toContainText("✓ Participating");
    await expect(section).not.toContainText("records attendance after the start");
    await expect(workspace(page).locator(".events-header .events-status")).toHaveText("Cancelled");
    await expect(page.getByRole("button", { name: "Edit event" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Cancel event" })).toHaveCount(0);
    await expect(page.getByRole("group", { name: text.en.response })).toHaveCount(0);
    expect(state.requests.filter((r) => r.includes("/my-response"))).toEqual([]);
    await noOverflow(page);
    await quiet(page);
    await capture(page, info, "events-cancelled");
  },
);

test(
  "L6 counts and list failures stay in their section and are never shown as zero",
  browserCase(["@layout"]),
  async ({ page }, info) => {
    const state = await openDetail(page, "en", (s) => {
      s.countsStatus = 503;
      s.declinersStatus = 503;
    });
    const participants = page.getByRole("region", { name: text.en.participants, exact: true }),
      decliners = participants.getByRole("region", { name: text.en.cantAttend, exact: true }),
      signedUp = participants.getByRole("region", { name: text.en.signedUp, exact: true });
    await expect(participants.locator(".events-counts")).toHaveText("Counts are unavailable");
    await expect(participants.locator(".events-counts")).not.toContainText(/\d/);
    await expect(decliners.getByRole("alert")).toBeVisible();
    await expect(decliners.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
    await expect(workspace(page).getByRole("alert")).toHaveCount(1);
    await expect(signedUp).toContainText("No members have signed up.");
    await noOverflow(page);
    await capture(page, info, "events-section-failures");
    // Without cached data the retry button is replaced while loading, so focus moves to the
    // section heading. Each mock change waits for the previous read to finish.
    const retry = decliners.getByRole("button", { name: "Try again", exact: true });
    await retry.focus();
    let settled = read(page, "/decliners", 503);
    await page.keyboard.press("Enter");
    await settled;
    await expect(decliners.getByRole("heading", { level: 3 })).toBeFocused();
    await expect(decliners.getByRole("alert")).toBeVisible();
    state.declinersStatus = 200;
    await retry.focus();
    settled = read(page, "/decliners", 200);
    await page.keyboard.press("Enter");
    await settled;
    await expect(decliners.getByRole("heading", { level: 3 })).toBeFocused();
    await expect(decliners).toContainText("No one has declined.");
    const counts = participants.getByRole("button", { name: "Load counts again", exact: true });
    await counts.focus();
    settled = read(page, "/response-counts", 503);
    await page.keyboard.press("Enter");
    await settled;
    await expect(participants.getByRole("heading", { level: 2 })).toBeFocused();
    await expect(participants.locator(".events-counts")).toHaveText("Counts are unavailable");
    state.countsStatus = 200;
    await counts.focus();
    settled = read(page, "/response-counts", 200);
    await page.keyboard.press("Enter");
    await settled;
    await expect(participants.getByRole("heading", { level: 2 })).toBeFocused();
    await expect(participants.locator(".events-counts")).toContainText("✓ Participating: 0");
    await expect(counts).toHaveCount(0);
    await quiet(page);
  },
);

test(
  "L6 a failed list read retried from the keyboard focuses the page heading",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await mockEvents(page);
    state.listStatus = 503;
    await page.goto("/account/events");
    const retry = workspace(page).getByRole("button", { name: "Try again", exact: true });
    await retry.focus();
    state.listStatus = 200;
    const settled = read(page, "/events", 200);
    await page.keyboard.press("Enter");
    await settled;
    await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
    await expect(workspace(page).locator(".events-row")).toHaveCount(1);
    await quiet(page);
  },
);

test(
  "L6 a failed refresh of cached names keeps focus on Try again",
  browserCase(["@functional"]),
  async ({ page }) => {
    const state = await openDetail(page);
    await settledDetail(page);
    const decliners = page.getByRole("region", { name: text.en.cantAttend, exact: true });
    await expect(decliners).toContainText("No one has declined.");
    // A committed response refreshes the decliners in the background while their page is cached.
    state.declinersStatus = 503;
    let settled = read(page, "/decliners", 503);
    await page
      .getByRole("group", { name: text.en.response, exact: true })
      .getByRole("button", { name: text.en.participating, exact: true })
      .click();
    await expect(page.getByRole("button", { name: text.en.save, exact: true })).toHaveCount(0);
    await settled;
    const retry = decliners.getByRole("button", { name: "Try again", exact: true });
    await expect(retry).toBeVisible();
    await retry.focus();
    settled = read(page, "/decliners", 503);
    await page.keyboard.press("Enter");
    await settled;
    // The button stays mounted through the failed retry, so focus stays on it.
    await expect(decliners.getByRole("alert")).toBeVisible();
    await expect(retry).toBeFocused();
    await expect(decliners.getByRole("heading", { level: 3 })).not.toBeFocused();
    state.declinersStatus = 200;
    settled = read(page, "/decliners", 200);
    await page.keyboard.press("Enter");
    await settled;
    await expect(decliners).toContainText("No one has declined.");
    await expect(retry).toHaveCount(0);
  },
);

for (const phase of ["started", "cancelled"] as const)
  test(
    `L4 a ${phase} event shows no own-response section without events.respond`,
    browserCase(["@functional"]),
    async ({ page }) => {
      const state = await openDetail(
        page,
        "en",
        (s) => {
          s.capabilities = ["company.read", "events.manage"];
          if (phase === "cancelled") s.event.status = "cancelled";
          else {
            s.event.startsAt = "2020-10-25T13:00:00.000Z";
            s.event.meetingAt = "2020-10-25T12:00:00.000Z";
          }
        },
        true,
      );
      await settledDetail(page);
      await expect(page.getByRole("region", { name: text.en.response, exact: true })).toHaveCount(
        0,
      );
      await expect(workspace(page)).not.toContainText("Your response before the start");
      await expect(
        page.getByRole("region", { name: text.en.participants, exact: true }),
      ).toBeVisible();
      expect(state.requests.filter((r) => r.includes("/my-response"))).toEqual([]);
      await quiet(page);
    },
  );

test("L6 an empty decliner list says so", browserCase(["@functional"]), async ({ page }) => {
  await openDetail(page);
  await settledDetail(page);
  await expect(page.getByRole("region", { name: text.en.cantAttend, exact: true })).toContainText(
    "No one has declined.",
  );
  await quiet(page);
});

test(
  "L6 last-page paging moves focus to the list heading",
  browserCase(["@functional"]),
  async ({ page }) => {
    const declining = await openDetail(page, "en", (s) => {
      s.declinerPages = true;
      s.response = { response: "declined", declineReason: "Fictional reason", version: 2 };
    });
    const decliners = page.getByRole("region", { name: text.en.cantAttend, exact: true });
    await expect(decliners.getByRole("link")).toHaveCount(25);
    await expect(decliners).toContainText("former member");
    await decliners.getByRole("button", { name: "Next page", exact: true }).click();
    await expect(decliners.getByRole("heading", { level: 3 })).toBeFocused();
    await expect(decliners.getByRole("link", { name: "Fictional Yukon Member" })).toBeVisible();
    await expect(decliners.getByRole("button", { name: "Next page" })).toHaveCount(0);
    await decliners.getByRole("button", { name: "First page", exact: true }).click();
    await expect(decliners.getByRole("heading", { level: 3 })).toBeFocused();
    await expect(decliners.getByRole("link")).toHaveCount(25);
    expect(declining.declinerCursors).toEqual(["", "synthetic-decliner-page-2", ""]);
    await expect(decliners).not.toContainText("Fictional reason");
  },
);

test(
  "L7 the public detail on a phone in Russian makes no private reads",
  browserCase(["@layout", "@viewport-mobile"]),
  async ({ page }, info) => {
    const state = await mockEvents(page, false, "ru");
    state.event.title = "Фиктивный открытый конвой по длинному северному маршруту";
    state.event.description = "Фиктивный сбор.\nВторая строка.";
    await page.goto(`/events/${eventId}`);
    await catalogLanguage(page, "ru");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(state.event.title);
    await expect(
      workspace(page).getByRole("heading", { name: "Маршрут", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("region", { name: text.ru.participants })).toHaveCount(0);
    await expect(page.getByRole("group", { name: text.ru.response })).toHaveCount(0);
    expect(state.requests.filter((r) => privateReads.test(r))).toEqual([]);
    await noOverflow(page);
    expect(await brokenWords(workspace(page))).toEqual([]);
    await quiet(page);
    await capture(page, info, "events-public-ru");
  },
);

test(
  "L8 the form closes at the start and focus moves to the response heading",
  browserCase(["@functional"]),
  async ({ page }, info) => {
    await page.clock.install({ time: new Date("2026-11-04T16:59:00.000Z") });
    const state = await openDetail(page, "en", (s) => {
      s.event.meetingAt = "2026-11-04T16:30:00.000Z";
      s.event.startsAt = "2026-11-04T17:00:00.000Z";
    });
    await settledDetail(page);
    const participating = page
      .getByRole("group", { name: text.en.response, exact: true })
      .getByRole("button", { name: text.en.participating, exact: true });
    await participating.focus();
    await expect(participating).toBeFocused();
    const reads = state.requests.filter((r) => r.includes("/my-response")).length;
    await page.clock.fastForward(61000);
    const section = page.getByRole("region", { name: text.en.response, exact: true });
    await expect(section).toContainText("Your response before the start");
    await expect(section.getByRole("heading", { level: 2, name: text.en.response })).toBeFocused();
    await expect(page.getByRole("group", { name: text.en.response })).toHaveCount(0);
    expect(state.requests.filter((r) => r.includes("/my-response")).length).toBe(reads);
    await quiet(page);
    await capture(page, info, "events-closed-at-start");
  },
);

for (const locale of ["en", "ru"] as const) {
  test(
    `Stage 2 ${locale} event detail shows the structured route, load and gallery`,
    browserCase(["@layout"]),
    async ({ page }, info) => {
      await page.addInitScript((language) => localStorage.setItem("vtc.locale", language), locale);
      const state = await mockStructuredDetail(page, locale, "driver");
      await page.goto(detailsPath);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(state.member.event.title);
      const gallery = page.getByRole("region", { name: galleryLabel[locale] });
      await expect(gallery.locator("figcaption")).toHaveText([
        coverCaption,
        middleCaption,
        lastCaption,
      ]);
      await expect(gallery.locator("img")).toHaveCount(3);
      const route = page.locator(".events-route-stops");
      await expect(
        route.getByText(locale === "ru" ? "Синтетическая гавань" : "Fictional Harbour", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(route.getByText("Fictional Plateau Depot")).toBeVisible();
      await route.scrollIntoViewIfNeeded();
      await expect(route.locator(".company-logo img")).toHaveCount(1);
      await expect(route.locator(".company-logo img")).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(page.getByText("TruckersMP", { exact: true })).toBeVisible();
      await expect(page.getByText("Fictional Simulation", { exact: true })).toBeVisible();
      await expect(
        page.getByText(locale === "ru" ? "0 км" : "0 km", { exact: true }),
      ).toBeVisible();
      await expect(page.getByText("Fictional Northern Roads")).toBeVisible();
      await expect(
        page.getByText(locale === "ru" ? "Синтетический груз" : "Fictional Cargo"),
      ).toBeVisible();
      await expect(
        page.getByText(locale === "ru" ? "Синтетический прицеп" : "Fictional Trailer"),
      ).toBeVisible();
      const organizer = page.getByRole("region", { name: organizerLabel[locale] });
      await expect(organizer.getByRole("link")).toHaveAttribute(
        "href",
        `/account/drivers/${state.member.organizerMemberId}`,
      );
      await expect(page.locator(".events-counts")).toContainText(
        locale === "en" ? "Participating: 2" : "Участвуют: 2",
      );
      await expect(page.locator(".events-counts")).toContainText(
        locale === "en" ? "Can't attend: 1" : "Не смогут: 1",
      );
      expect(state.requests.some((url) => url.pathname.endsWith("/response-counts"))).toBe(false);
      const depotReads = state.requests
        .filter((url) => url.pathname === "/api/v1/catalogs/depots")
        .map((url) => Object.fromEntries(url.searchParams));
      const { origin, destination, originDepot, destinationDepot, game } = state.member.event;
      expect(depotReads).toHaveLength(2);
      expect(depotReads).toEqual(
        expect.arrayContaining([
          {
            game,
            cityId: origin?.entityId,
            depotId: originDepot?.id,
            includeHidden: "true",
            locale,
          },
          {
            game,
            cityId: destination?.entityId,
            depotId: destinationDepot?.id,
            includeHidden: "true",
            locale,
          },
        ]),
      );
      expect(
        state.requests.some(
          (url) => url.pathname.endsWith(eventPath) && url.searchParams.get("locale") === locale,
        ),
      ).toBe(true);
      expect(state.requests.some((url) => url.pathname.includes(`/admin${eventPath}`))).toBe(false);
      const main = await page.locator(".events-main").boundingBox();
      const rail = await page.locator(".events-side").boundingBox();
      const response = await page.locator(".events-response").boundingBox();
      if (!main || !rail || !response) throw new Error("Detail layout did not render");
      if (info.project.name === "desktop-chromium") {
        expect(rail.x).toBeGreaterThanOrEqual(main.x + main.width);
        expect(response.x).toBe(rail.x);
        expect(rail.y).toBeGreaterThanOrEqual(response.y + response.height);
      } else {
        expect(main.y).toBeGreaterThanOrEqual(response.y + response.height);
        expect(rail.y).toBeGreaterThanOrEqual(main.y + main.height);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({
        path: info.outputPath(`stage-2-detail-${locale}.png`),
        fullPage: true,
        animations: "disabled",
      });
    },
  );
}
