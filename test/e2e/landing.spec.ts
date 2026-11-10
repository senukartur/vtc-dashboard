import { randomUUID } from "node:crypto";
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page, TestInfo } from "@playwright/test";
import { eventTranslations } from "../../apps/web/src/features/events/translations.ts";
import { publicContent } from "../../apps/web/src/features/landing/content.ts";
import { testConnection } from "../persistence/support.ts";
import { browserCase, expect, test } from "./support/fixtures.ts";

// Manual captures below contain controlled public states only; real HTTP material is never traced.
test.use({ trace: "off", screenshot: "off", video: "off" });
// Admissions/landing cases isolate the new widget; Events owns its real API integration.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/public/events?*", (route) =>
    route.fulfill({
      json: {
        data: { items: [], nextCursor: null },
        meta: { requestId: "synthetic-landing-events" },
      },
    }),
  );
  // The e2e API runs without analytics, so the stats band is hidden unless a case overrides it.
  await page.route(statsPath, (route) => route.fulfill(statsError(404, "NOT_FOUND")));
});
const statsPath = "**/api/v1/public/company-stats";
function statsError(status: number, code: string, headers: Record<string, string> = {}) {
  return {
    status,
    headers,
    json: {
      error: { code, messageKey: "errors.synthetic", retryable: status >= 429 },
      meta: { requestId: "synthetic-landing-stats" },
    },
  };
}
async function fill(page: Page, locale: "ru" | "en" = "en") {
  const ru = locale === "ru";
  await page
    .getByRole("textbox", { name: ru ? "Никнейм" : "Nickname", exact: true })
    .fill("Fictional Applicant");
  await page
    .getByRole("textbox", { name: ru ? "Email для приглашения" : "Invitation email", exact: true })
    .fill("applicant@example.invalid");
  await page
    .getByRole("textbox", {
      name: ru ? "Ссылка на профиль Steam" : "Steam profile link",
      exact: true,
    })
    .fill("https://steamcommunity.com/id/fictional-driver");
  await page.getByRole("checkbox", { name: "ETS2", exact: true }).check();
}
async function capture(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  await info.attach(name, { path, contentType: "image/png" });
}
/** Changes the language in the header or, where the header hides it, in the menu. */
async function chooseLanguage(page: Page, from: "ru" | "en", to: "ru" | "en") {
  const name = from === "ru" ? "Язык" : "Language";
  const header = page.getByRole("banner").getByRole("combobox", { name, exact: true });
  if (await header.isVisible()) {
    await header.selectOption(to);
    return;
  }
  await page
    .getByRole("button", { name: from === "ru" ? "Открыть навигацию" : "Open navigation" })
    .click();
  await page.getByRole("dialog").getByRole("combobox", { name, exact: true }).selectOption(to);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
const receipt = {
  data: { id: "41000000-0000-4000-8000-000000000001", version: 1 },
  meta: { requestId: "synthetic-request" },
};
for (const locale of ["ru", "en"] as const) {
  test(
    `public ${locale} initial HTML and rendered validation/navigation are accessible without overflow`,
    browserCase(["@layout"]),
    async ({ page }, info) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(locale === "en" ? "/en" : "/");
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        locale === "ru" ? "Юкон? Достаточно суров" : "Yukon? Tough enough.",
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await capture(page, info, `${locale}-landing`);
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("link", {
          name: locale === "ru" ? "Перейти к содержимому" : "Skip to content",
          exact: true,
        }),
      ).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("main")).toBeFocused();
      const submit = page.getByRole("button", {
        name: locale === "ru" ? "Отправить заявку" : "Send application",
        exact: true,
      });
      await submit.click();
      await expect(page.getByRole("alert")).toContainText([
        locale === "ru" ? "Введите никнейм" : "Enter a nickname",
        locale === "ru" ? "Введите корректный email" : "Enter a valid email",
        locale === "ru" ? "Укажите HTTPS" : "Use an HTTPS",
        locale === "ru" ? "Выберите ETS2" : "Select ETS2",
        locale === "ru" ? "Исправьте" : "Correct",
      ]);
      await capture(page, info, `${locale}-validation`);
      const menu = page.getByRole("button", {
        name: locale === "ru" ? "Открыть навигацию" : "Open navigation",
        exact: true,
      });
      if (await menu.isVisible()) {
        await menu.click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(menu).toBeFocused();
      }
      await fill(page, locale);
      await chooseLanguage(page, locale, locale === "ru" ? "en" : "ru");
      await expect.poll(() => new URL(page.url()).pathname).toBe(locale === "ru" ? "/en" : "/");
      await expect(page.locator("html")).toHaveAttribute("lang", locale === "ru" ? "en" : "ru");
      await expect(
        page.getByRole("textbox", { name: locale === "ru" ? "Nickname" : "Никнейм", exact: true }),
      ).toHaveValue("Fictional Applicant");
      await page.getByRole("link", { name: "Yukon Union", exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("lang", locale === "ru" ? "en" : "ru");
      await chooseLanguage(page, locale === "ru" ? "en" : "ru", locale);
      await page
        .getByRole("main")
        .getByRole("link", { name: publicContent[locale].allEvents, exact: true })
        .click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        locale === "ru" ? "Открытые конвои" : "Public convoys",
      );
      await page
        .getByRole("main")
        .getByRole("link", {
          name: locale === "ru" ? "Подать заявку" : "Apply to join",
          exact: true,
        })
        .click();
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect.poll(() => new URL(page.url()).pathname).toBe(locale === "ru" ? "/" : "/en");
      await expect(
        page.getByRole("heading", {
          name: publicContent[locale].requirementsTitle,
          exact: true,
        }),
      ).toBeInViewport();
      if (await menu.isVisible()) await menu.click();
      await page
        .getByRole("link", { name: locale === "ru" ? "Войти" : "Sign in", exact: true })
        .click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        locale === "ru" ? "Войти" : "Sign in",
      );
      await page
        .getByRole("main")
        .getByRole("link", { name: locale === "ru" ? "На главную" : "Home", exact: true })
        .click();
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
    },
  );
}
test(
  "built public documents contain real localized content before JavaScript and narrow indexing",
  browserCase(["@functional"]),
  async ({ request }) => {
    for (const [path, locale, phrase] of [
      ["/", "ru", "Достаточно суров"],
      ["/en", "en", "Tough enough."],
    ]) {
      const response = await request.get(path ?? "/");
      const body = await response.text();
      expect(response.status()).toBe(200);
      expect(response.headers()["cache-control"]).toBe("no-store");
      expect(body).toContain(`lang="${locale}"`);
      expect(body).toContain(phrase);
      expect(body).toContain('name="description"');
      expect(body).toContain('content="index, follow"');
      expect(body).toContain('href="https://steamcommunity.com/groups/yukon_union"');
      expect(body).not.toContain("hreflang=");
      expect(body).not.toContain("browser@example.invalid");
      expect(body).not.toContain("Synthetic Browser Member");
      expect(body).not.toContain("PRIVATE_SENTINEL");
      // VTC-089: the still, sections and join copy are prerendered; video and live parts are not.
      const c = publicContent[locale as "ru" | "en"];
      for (const text of [
        c.headingLead,
        c.convoysTitle,
        c.eventsTitle,
        ...c.eventFormats,
        c.cabTelemetry,
        c.aboutTitle,
        ...c.ranks,
        ...c.joinSteps.map((step) => step.title),
        c.joinNote,
        c.footerNote,
        'data-motion="static"',
        'class="landing-hero-still"',
        'class="landing-chip-slot"',
        'class="landing-menu-placeholder"',
        "https://vtc.haulmp.com/YukonUnion",
        "https://hub.truckyapp.com/company/184",
      ])
        expect(body).toContain(text);
      // React writes camel-cased attribute names; HTML attribute names are case-insensitive.
      expect(body.toLowerCase()).toContain('fetchpriority="high"');
      expect(body).toMatch(
        /<source media="\(max-width: 760px\)" srcset="\/assets\/hero-still-854-[\w-]+\.webp"/i,
      );
      for (const text of [
        "landing-stats",
        "landing-convoy-chip",
        "aria-pressed",
        "<video",
        ".mp4",
        "forum.vtc.world",
        "ykn-u.ru",
      ])
        expect(body).not.toContain(text);
      expect(body).not.toMatch(/\d+ (д|d) \d/);
      expect(await (await request.get(path ?? "/")).text()).toBe(body);
    }
    for (const path of [
      "/status",
      "/foundation",
      "/foundation/member",
      "/login",
      "/events",
      "/invitation?token=NONFUNCTIONAL_FIXTURE",
      "/unknown",
      "/?token=NONFUNCTIONAL_FIXTURE",
      "/en?token=NONFUNCTIONAL_FIXTURE",
      "/public-en.html",
    ]) {
      const response = await request.get(path, { headers: { Accept: "text/html" } });
      expect(response.headers()["x-robots-tag"]).toBe("noindex, nofollow");
      if (!path.endsWith(".html")) {
        expect(await response.text()).toContain('content="noindex, nofollow"');
      }
    }
  },
);
test(
  "controlled pending and uncertain retries preserve original payload/key; changed input gets a new key",
  browserCase(["@functional", "@smoke-public"]),
  async ({ page }, info) => {
    await page.route("**/api/v1/auth/csrf", (route) =>
      route.fulfill({
        json: {
          data: { token: "NONFUNCTIONAL_FIXTURE" },
          meta: { requestId: "synthetic-request" },
        },
      }),
    );
    const attempts: { key: string | undefined; payload: unknown }[] = [];
    let count = 0;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/v1/public/applications", async (route) => {
      attempts.push({
        key: route.request().headers()["idempotency-key"],
        payload: route.request().postDataJSON(),
      });
      count++;
      if (count === 1) {
        await gate;
        await route.abort("failed");
      } else if (count === 2)
        await route.fulfill({ status: 201, json: { malformed: "PRIVATE_SENTINEL" } });
      else await route.fulfill({ status: 201, json: receipt });
    });
    try {
      await page.goto("/en");
      await fill(page);
      await page.getByRole("button", { name: "Send application", exact: true }).click();
      await expect(page.getByRole("button", { name: "Sending…", exact: true })).toBeDisabled();
      await expect(page.getByRole("textbox", { name: "Nickname", exact: true })).toBeDisabled();
      await capture(page, info, "en-pending");
      release();
      await expect(page.getByRole("alert")).toContainText("Submission could not be confirmed");
      await expect(page.getByRole("textbox", { name: "Nickname", exact: true })).toHaveValue(
        "Fictional Applicant",
      );
      await page.getByRole("button", { name: "Retry submission", exact: true }).click();
      await expect(page.getByRole("alert")).toContainText("Submission could not be confirmed");
      expect(attempts).toHaveLength(2);
      expect(attempts[1]).toEqual(attempts[0]);
      expect(JSON.stringify(attempts[0]?.payload)).not.toContain("discord");
      await page
        .getByRole("textbox", { name: "Nickname", exact: true })
        .fill("Changed Fictional Applicant");
      await expect(page.getByText(/Changed details will be sent/)).toBeVisible();
      await page.getByRole("button", { name: "Retry submission", exact: true }).click();
      await expect(page.getByRole("status")).toContainText("Submission acknowledged");
      expect(attempts[2]?.key).not.toBe(attempts[0]?.key);
      await expect(page.getByText("PRIVATE_SENTINEL")).toHaveCount(0);
      await capture(page, info, "en-confirmed");
    } finally {
      release();
    }
  },
);
for (const locale of ["ru", "en"] as const) {
  test(
    `controlled ${locale} server failures preserve input and display safe translated feedback`,
    browserCase(["@functional"]),
    async ({ page }, info) => {
      await page.route("**/api/v1/auth/csrf", (route) =>
        route.fulfill({
          json: {
            data: { token: "NONFUNCTIONAL_FIXTURE" },
            meta: { requestId: "synthetic-request" },
          },
        }),
      );
      let status = 422;
      await page.route("**/api/v1/public/applications", (route) =>
        route.fulfill({
          status,
          headers: { "Retry-After": "1" },
          json: status === 201 ? receipt : { error: { code: "PRIVATE_SENTINEL" } },
        }),
      );
      await page.goto(locale === "en" ? "/en" : "/");
      await fill(page, locale);
      for (const current of [422, 403, 409, 429, 503]) {
        status = current;
        await page
          .getByRole("button", {
            name:
              locale === "en"
                ? /Send application|Retry submission/
                : /Отправить заявку|Повторить отправку/,
          })
          .click();
        await expect(page.getByRole("alert")).toBeVisible();
        await expect(
          page.getByRole("textbox", {
            name: locale === "en" ? "Invitation email" : "Email для приглашения",
            exact: true,
          }),
        ).toHaveValue("applicant@example.invalid");
        await expect(page.getByText("PRIVATE_SENTINEL")).toHaveCount(0);
        if (current === 429) {
          await expect(
            page.getByRole("button", {
              name: locale === "en" ? "Retry submission" : "Повторить отправку",
            }),
          ).toBeDisabled();
          await capture(page, info, `${locale}-rate-limited`);
          await expect(
            page.getByRole("button", {
              name: locale === "en" ? "Retry submission" : "Повторить отправку",
            }),
          ).toBeEnabled();
        }
        if (current === 503) await capture(page, info, `${locale}-unavailable`);
      }
      status = 201;
      await page
        .getByRole("button", {
          name: locale === "en" ? "Retry submission" : "Повторить отправку",
          exact: true,
        })
        .click();
      await expect(page.getByRole("status")).toContainText(
        locale === "en" ? "Submission acknowledged" : "Отправка подтверждена",
      );
      await capture(page, info, `${locale}-confirmed`);
    },
  );
}
// Real admissions integration uses fictional input and no capture of private HTTP material.
test.describe("real rendered admissions", () => {
  test(
    "rendered form submits to real VTC-015 and repeat email receives the same safe confirmation without a session",
    browserCase(["@real"]),
    async ({ page, context }) => {
      test.setTimeout(30000);
      const control = await testConnection();
      try {
        await control.query("DELETE FROM admissions_limits");
        await control.query("DELETE FROM identity_limits");
      } finally {
        await control.end();
      }
      await page.goto("/en");
      await fill(page);
      const email = `${randomUUID()}@example.invalid`;
      await page.getByRole("textbox", { name: "Invitation email", exact: true }).fill(email);
      for (let n = 0; n < 2; n++) {
        if (n) {
          await page.reload();
          await fill(page);
          await page.getByRole("textbox", { name: "Invitation email", exact: true }).fill(email);
        }
        const sent = page.waitForResponse(
          (response) =>
            response.url().endsWith("/api/v1/public/applications") &&
            response.request().method() === "POST",
        );
        await page.getByRole("button", { name: "Send application", exact: true }).click();
        expect((await sent).status()).toBe(201);
        await expect(page.getByRole("status")).toContainText("Submission acknowledged");
        expect((await context.request.get("/api/v1/me")).status()).toBe(401);
        expect((await context.request.get("/api/v1/admin/applications")).status()).toBe(401);
      }
    },
  );
  for (const locale of ["en", "ru"] as const) {
    test(
      `committed but unconfirmed ${locale} submission replays after switching the interface language`,
      browserCase(["@real"]),
      async ({ page, context }) => {
        const control = await testConnection();
        try {
          await control.query("DELETE FROM admissions_limits");
          await control.query("DELETE FROM identity_limits");
        } finally {
          await control.end();
        }
        const nextLocale = locale === "en" ? "ru" : "en";
        let attempts = 0;
        let original:
          | { key: string | undefined; payload: string | null; locale: string | undefined }
          | undefined;
        await page.route("**/api/v1/public/applications", async (route) => {
          const request = route.request();
          const command = {
            key: request.headers()["idempotency-key"],
            payload: request.postData(),
            locale: request.headers()["accept-language"],
          };
          const response = await route.fetch({ timeout: 5000 }).catch(() => {
            throw new Error("SYNTHETIC_APPLICATION_REPLAY_REQUEST_FAILED");
          });
          // Both responses come from real VTC-015 after its MySQL transaction commits.
          // Boolean comparisons avoid printing request material if a regression fails.
          expect(response.status()).toBe(201);
          attempts++;
          if (attempts === 1) {
            original = command;
            expect(command.locale === locale).toBe(true);
            await route.abort("failed");
          } else {
            expect(command.key === original?.key).toBe(true);
            expect(command.payload === original?.payload).toBe(true);
            expect(command.locale === original?.locale).toBe(true);
            await route.fulfill({ response });
          }
        });
        await page.goto(locale === "en" ? "/en" : "/");
        await fill(page, locale);
        await page
          .getByRole("textbox", {
            name: locale === "en" ? "Invitation email" : "Email для приглашения",
            exact: true,
          })
          .fill(`${randomUUID()}@example.invalid`);
        await page
          .getByRole("button", {
            name: locale === "en" ? "Send application" : "Отправить заявку",
            exact: true,
          })
          .click();
        await expect(page.getByRole("alert")).toContainText(
          locale === "en" ? "Submission could not be confirmed" : "Не удалось подтвердить отправку",
        );
        await page
          .getByRole("combobox", { name: locale === "en" ? "Language" : "Язык", exact: true })
          .selectOption(nextLocale);
        await expect(page.locator("html")).toHaveAttribute("lang", nextLocale);
        await expect(page.getByRole("alert")).toContainText(
          nextLocale === "en"
            ? "Submission could not be confirmed"
            : "Не удалось подтвердить отправку",
        );
        await page
          .getByRole("button", {
            name: nextLocale === "en" ? "Retry submission" : "Повторить отправку",
            exact: true,
          })
          .click();
        await expect(page.getByRole("status")).toContainText(
          nextLocale === "en" ? "Submission acknowledged" : "Отправка подтверждена",
        );
        expect(attempts).toBe(2);
        expect((await context.request.get("/api/v1/me")).status()).toBe(401);
        expect((await context.request.get("/api/v1/admin/applications")).status()).toBe(401);
      },
    );
  }
});
// VTC-050 live landing: fictional public convoys and aggregates at the network boundary only.
type Locale = "ru" | "en";
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const catalogLabel = (entityId: string, label: string) => ({
  entityId,
  label,
  requestedLocale: "en",
  renderedLocale: "en",
  englishFallback: false,
  hidden: false,
});
function liveEvent(
  index: number,
  overrides: { title: string; game: "ets2" | "ats"; startsAt: string } & Record<string, unknown>,
) {
  return {
    id: `41000000-0000-4000-8000-00000000005${index}`,
    version: 1,
    description: "Synthetic public convoy",
    endsAt: null,
    status: "scheduled",
    origin: null,
    destination: null,
    server: "Fictional Server 1",
    organizer: "Fictional Organizer",
    meetingLocation: "Fictional Depot",
    route: `Fictional Route ${index}`,
    meetingAt: overrides.startsAt,
    ...overrides,
  };
}
const longRuTitle =
  "Вымышленный вечерний конвой через всё западное побережье, горные перевалы и долгую ночную дорогу";
function liveEvents(locale: Locale) {
  return [
    liveEvent(1, {
      title: "Fictional Evening Convoy",
      game: "ets2",
      startsAt: "2026-11-02T18:30:00.000Z",
      origin: catalogLabel("51000000-0000-4000-8000-000000000001", "Fictional Origin"),
      destination: catalogLabel("51000000-0000-4000-8000-000000000002", "Fictional Destination"),
    }),
    liveEvent(2, {
      title: "Fictional Cancelled Convoy",
      game: "ets2",
      startsAt: "2026-11-03T18:00:00.000Z",
      status: "cancelled",
      route: "Fictional Cancelled Route",
    }),
    liveEvent(3, {
      title: locale === "ru" ? longRuTitle : "Fictional Coast Convoy",
      game: "ats",
      startsAt: "2026-11-05T19:00:00.000Z",
      route: "Fictional Route West",
    }),
  ];
}
const listEnvelope = (items: unknown[]) => ({
  json: { data: { items, nextCursor: null }, meta: { requestId: "synthetic-landing-events" } },
});
function statsEnvelope(currentMonth: Record<string, unknown>, activeMembers = 1234) {
  return {
    json: {
      data: { computedAt: "2026-10-30T11:59:00.000Z", activeMembers, currentMonth },
      meta: { requestId: "synthetic-landing-stats" },
    },
  };
}
const availableMonth = (overrides: Record<string, unknown> = {}) => ({
  status: "available",
  month: "2026-10",
  reportingTimezone: "UTC",
  fromDate: "2026-10-01",
  toDateExclusive: "2026-11-01",
  acceptedTrips: 57,
  actualDistanceM: "123456789.5",
  games: ["ets2", "ats"],
  ...overrides,
});
async function routeEvents(page: Page, items: unknown[]) {
  await page.route("**/api/v1/public/events?*", (route) => route.fulfill(listEnvelope(items)));
}
const motionState = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((element) => element.getAnimations().map((animation) => animation.playState));
const chipFor = (page: Page, locale: Locale, title: string) =>
  page.getByRole("link", {
    name: new RegExp(`^${escapeRegex(publicContent[locale].nextConvoy)}: ${escapeRegex(title)}`),
  });
// Fixed before every dated convoy fixture, so live cases never depend on the run date.
const liveClock = new Date("2026-10-30T12:00:00.000Z");
const landingPath = (locale: Locale) => (locale === "en" ? "/en" : "/");
const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

for (const locale of ["ru", "en"] as const) {
  test(
    `live ${locale} landing shows countdown, stats and cards with a working pause control`,
    browserCase(["@layout"]),
    async ({ page, context, baseURL }, info) => {
      const c = publicContent[locale],
        e = eventTranslations[locale],
        events = liveEvents(locale),
        first = events[0] as ReturnType<typeof liveEvent>;
      await context.addCookies([
        { name: "vtc_fictional_probe", value: "fictional", url: baseURL ?? "" },
      ]);
      await page.clock.install({ time: liveClock });
      await page.emulateMedia({ reducedMotion: "no-preference" });
      const cookies: { stats?: string | undefined; events?: string | undefined } = {};
      await page.route("**/api/v1/public/events?*", async (route) => {
        cookies.events = (await route.request().allHeaders()).cookie;
        await route.fulfill(listEnvelope(events));
      });
      await page.route(statsPath, async (route) => {
        cookies.stats = (await route.request().allHeaders()).cookie;
        await route.fulfill(statsEnvelope(availableMonth()));
      });
      await page.goto(landingPath(locale));
      const chip = chipFor(page, locale, first.title);
      await expect(chip).toHaveAttribute("href", `/events/${first.id}`);
      await expect(chip).toHaveAccessibleName(/UTC/);
      await expect(chip).toContainText(locale === "ru" ? "3 д 06 ч 30 мин" : "3 d 06 h 30 min");
      const name = (await chip.locator(".visually-hidden").textContent()) ?? "";
      await expect(chip).toHaveAccessibleName(name);
      await page.clock.runFor(60000);
      await expect(chip).toContainText(locale === "ru" ? "3 д 06 ч 29 мин" : "3 d 06 h 29 min");
      await expect(chip).toHaveAccessibleName(name);
      await expect(page.locator(".landing-hero [aria-live]")).toHaveCount(0);

      const stats = page.getByRole("region", { name: c.statsTitle, exact: true });
      await expect(stats).toContainText(locale === "ru" ? /1\s234/ : "1,234");
      await expect(stats).toContainText(locale === "ru" ? /123\s456,7895 км/ : "123,456.7895 km");
      await expect(stats).toContainText(c.statsTrips);
      await expect(stats).toContainText("57");
      await expect(stats).toContainText("ETS2 · ATS");
      await expect(stats).toContainText(locale === "ru" ? /октябрь 2026/ : "October 2026");
      await expect(stats).toContainText("UTC");
      // The anonymous aggregate never carries cookies, unlike the same-origin events read.
      expect(cookies.events).toContain("vtc_fictional_probe");
      expect(cookies.stats).toBeUndefined();

      const convoys = page.getByRole("region", { name: c.convoysTitle, exact: true });
      await expect(convoys.getByRole("listitem")).toHaveCount(3);
      await expect(convoys).toContainText("Fictional Origin → Fictional Destination");
      const titles = convoys.getByRole("heading", { level: 3 }).getByRole("link");
      await expect(titles).toHaveCount(3);
      for (const [index, event] of events.entries())
        await expect(titles.nth(index)).toHaveAttribute("href", `/events/${event.id}`);
      await expect(convoys).toContainText(e.cancelled);
      await expect(convoys).toContainText("UTC");
      await expect(convoys).toContainText(c.convoysNote);

      expect(await motionState(page, ".landing-cab-image")).toContain("running");
      const toggle = page.getByRole("button", { name: c.pauseMotion, exact: true });
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-pressed", "true");
      await expect.poll(() => motionState(page, ".landing-cab-image")).toEqual(["paused"]);
      const visible = chip.locator(".landing-chip-text");
      await expect(visible).toContainText(`${c.nextConvoy}:`);
      await expect(visible).not.toContainText(c.units.min);
      await expect(chip).toHaveAccessibleName(name);
      await expect(toggle).toBeFocused();
      await page.keyboard.press("Space");
      await expect(toggle).toHaveAttribute("aria-pressed", "false");
      await expect.poll(() => motionState(page, ".landing-cab-image")).toEqual(["running"]);
      await expect(visible).toContainText(c.units.min);
      expect(await noOverflow(page)).toBe(true);
      await capture(page, info, `${locale}-live`);
    },
  );
}

test(
  "reduced motion keeps the live landing static and hides the pause control without a timer",
  browserCase(["@functional"]),
  async ({ page }, info) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.clock.install({ time: liveClock });
    await routeEvents(page, liveEvents("en"));
    await page.goto("/en");
    const c = publicContent.en;
    await expect(chipFor(page, "en", "Fictional Evening Convoy")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    // Keyframe motion only: the shared reduced-motion rule turns any style change (such as a font
    // swap resizing `ch` widths) into a 0.01ms CSS transition, which is not landing motion.
    expect(
      await page
        .locator(".landing")
        .evaluate(
          (element) =>
            element
              .getAnimations({ subtree: true })
              .filter((animation) => animation instanceof CSSAnimation).length,
        ),
    ).toBe(0);
    for (const selector of [".landing-cab-image", ".landing-cab-sun", ".landing-chip-dot"])
      for (const element of await page.locator(selector).all())
        expect(await element.evaluate((node) => node.getAnimations().length)).toBe(0);
    await expect(page.getByRole("button", { name: c.pauseMotion, exact: true })).toBeVisible();
    expect(await noOverflow(page)).toBe(true);
    await capture(page, info, "en-reduced-motion");
    await routeEvents(page, []);
    await page.goto("/en");
    await expect(page.getByText(c.convoysEmpty, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: c.pauseMotion, exact: true })).toBeHidden();
  },
);

test(
  "stats band stays hidden while pending or unavailable and shows partial months honestly",
  browserCase(["@functional"]),
  async ({ page }) => {
    const en = publicContent.en,
      ru = publicContent.ru;
    const settle = () =>
      page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
    const region = (locale: Locale) =>
      page.getByRole("region", { name: publicContent[locale].statsTitle, exact: true });
    const failures: Parameters<Page["route"]>[1][] = [
      (route) => route.fulfill(statsError(404, "NOT_FOUND")),
      (route) => route.fulfill(statsError(409, "SETUP_REQUIRED")),
      (route) => route.fulfill(statsError(429, "RATE_LIMITED", { "Retry-After": "30" })),
      (route) => route.fulfill(statsError(503, "UNAVAILABLE")),
      (route) =>
        route.fulfill({
          json: { data: { activeMembers: "PRIVATE_SENTINEL" }, meta: { requestId: "synthetic" } },
        }),
      (route) => route.abort("failed"),
    ];
    for (const handler of failures) {
      await page.unroute(statsPath);
      await page.route(statsPath, handler);
      const isStats = (request: { url(): string }) =>
        request.url().endsWith("/api/v1/public/company-stats");
      const done = Promise.race([
        page.waitForEvent("requestfinished", { predicate: isStats }),
        page.waitForEvent("requestfailed", { predicate: isStats }),
      ]);
      await page.goto("/en");
      await done;
      await settle();
      await expect(region("en")).toHaveCount(0);
      await expect(page.getByText(/\b0 km\b/)).toHaveCount(0);
      await expect(page.getByText("PRIVATE_SENTINEL")).toHaveCount(0);
      await expect(page.getByRole("alert")).toHaveCount(0);
    }

    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.unroute(statsPath);
    await page.route(statsPath, async (route) => {
      await gate;
      await route.fulfill(statsEnvelope(availableMonth()));
    });
    await page.goto("/en");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(en.heading);
    await expect(region("en")).toHaveCount(0);
    release();
    await expect(region("en")).toBeVisible();

    await page.unroute(statsPath);
    await page.route(statsPath, (route) =>
      route.fulfill(
        statsEnvelope({ status: "unavailable", reason: "company_reporting_timezone" }, 3),
      ),
    );
    await page.goto("/");
    await expect(region("ru").locator("dd")).toHaveText(["3"]);
    await expect(region("ru")).toContainText(ru.statsMembers);
    for (const label of [ru.statsTrips, ru.statsDistance, ru.statsGames, ru.statsMonth])
      await expect(region("ru")).not.toContainText(label);

    await page.unroute(statsPath);
    await page.route(statsPath, (route) =>
      route.fulfill(
        statsEnvelope(availableMonth({ acceptedTrips: 0, actualDistanceM: "0", games: [] }), 12),
      ),
    );
    await page.goto("/en");
    await expect(region("en").locator("dd")).toHaveText(["12", "0", "0 km"]);
    await expect(region("en")).not.toContainText(en.statsGames);
  },
);

test(
  "convoy pill disappears for empty, cancelled-only and failed public event reads",
  browserCase(["@functional"]),
  async ({ page }) => {
    const c = publicContent.en,
      e = eventTranslations.en;
    const convoys = page.getByRole("region", { name: c.convoysTitle, exact: true });
    const nextChip = page.getByRole("link", { name: /^Next convoy/ });
    await page.clock.install({ time: liveClock });
    await page.goto("/en");
    await expect(convoys.getByText(c.convoysEmpty, { exact: true })).toBeVisible();
    await expect(nextChip).toHaveCount(0);

    await routeEvents(
      page,
      liveEvents("en").filter((event) => event.status === "cancelled"),
    );
    await page.goto("/en");
    await expect(convoys.getByRole("listitem")).toHaveCount(1);
    await expect(convoys).toContainText(e.cancelled);
    await expect(nextChip).toHaveCount(0);

    await page.route("**/api/v1/public/events?*", (route) =>
      route.fulfill({ status: 503, json: { error: { code: "UNAVAILABLE" } } }),
    );
    await page.goto("/en");
    await expect(convoys.getByRole("alert")).toContainText(e.unavailable);
    await expect(convoys.getByRole("button", { name: e.retry, exact: true })).toBeVisible();
    await expect(nextChip).toHaveCount(0);
  },
);

test(
  "a started convoy refreshes the list once and the chip moves to the next scheduled one",
  browserCase(["@functional"]),
  async ({ page }) => {
    const events = liveEvents("en").filter((event) => event.status === "scheduled");
    let reads = 0;
    await page.route("**/api/v1/public/events?*", (route) => {
      reads++;
      return route.fulfill(listEnvelope(events));
    });
    await page.clock.install({ time: new Date("2026-11-02T18:29:30.000Z") });
    await page.goto("/en");
    const firstChip = chipFor(page, "en", "Fictional Evening Convoy");
    await expect(firstChip).toContainText("1 min");
    const before = reads;
    await page.clock.runFor(31000);
    await expect(chipFor(page, "en", "Fictional Coast Convoy")).toBeVisible();
    await expect(firstChip).toHaveCount(0);
    await expect.poll(() => reads).toBe(before + 1);
    await page.clock.runFor(1000);
    expect(reads).toBe(before + 1);
  },
);

test(
  "live controls keep keyboard order, visible focus and pointer-sized targets",
  browserCase(["@layout"]),
  async ({ page }) => {
    const c = publicContent.en;
    await page.clock.install({ time: liveClock });
    await routeEvents(page, liveEvents("en"));
    await page.goto("/en");
    const main = page.getByRole("main"),
      chip = chipFor(page, "en", "Fictional Evening Convoy"),
      apply = main.locator(".landing-hero").getByRole("link", { name: c.apply, exact: true }),
      heroConvoys = main
        .locator(".landing-hero")
        .getByRole("link", { name: c.heroConvoys, exact: true }),
      toggle = page.getByRole("button", { name: c.pauseMotion, exact: true });
    await expect(chip).toBeVisible();
    await main.focus();
    const outlined = (locator: typeof chip) =>
      locator.evaluate((element) => {
        const style = getComputedStyle(element);
        return style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) >= 2;
      });
    await page.keyboard.press("Tab");
    await expect(chip).toBeFocused();
    expect(await outlined(chip)).toBe(true);
    await page.keyboard.press("Tab");
    await expect(apply).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(heroConvoys).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(toggle).toBeFocused();
    expect(await outlined(toggle)).toBe(true);

    const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
      minimum = coarse ? 40 : 30;
    const targets = [
      chip,
      toggle,
      apply,
      heroConvoys,
      main.getByRole("link", { name: c.allEvents, exact: true }),
      ...(await main.getByRole("heading", { level: 3 }).getByRole("link").all()),
      ...(await page.locator(".application-card .checkbox-label").all()),
    ];
    expect(targets.length).toBe(10);
    for (const target of targets)
      expect((await target.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(minimum - 0.5);
    for (const id of ["nickname", "email", "steamProfileUrl", "discord"]) {
      const height = (await page.locator(`#application-${id}`).boundingBox())?.height ?? 0;
      if (coarse) expect(height).toBeGreaterThanOrEqual(39.5);
      else expect(Math.abs(height - 32)).toBeLessThanOrEqual(0.5);
    }
  },
);

test(
  "compact application form keeps field order and lays out by card width",
  browserCase(["@layout"]),
  async ({ page }) => {
    await page.goto("/en");
    const contentWidth = await page.locator(".application-card").evaluate((element) => {
      const style = getComputedStyle(element);
      return (
        element.clientWidth -
        Number.parseFloat(style.paddingLeft) -
        Number.parseFloat(style.paddingRight)
      );
    });
    const box = async (selector: string) => {
      const result = await page.locator(selector).boundingBox();
      if (!result) throw new Error("MISSING_FORM_BOX");
      return result;
    };
    const nickname = await box("#application-nickname"),
      email = await box("#application-email");
    if (contentWidth >= 480) {
      expect(Math.abs(nickname.y - email.y)).toBeLessThanOrEqual(1);
      expect(email.x).toBeGreaterThan(nickname.x + nickname.width);
    } else expect(email.y).toBeGreaterThan(nickname.y + nickname.height);
    const fields = await box(".application-card .application-fields");
    for (const id of ["steamProfileUrl", "introduction"]) {
      const field = await box(`.application-card .field:has(> #application-${id})`);
      expect(Math.abs(field.width - fields.width)).toBeLessThanOrEqual(1);
    }
    expect(
      await page
        .locator(".application-card form")
        .locator("input, textarea, button")
        .evaluateAll((elements) =>
          elements.map((element) => element.id || (element as HTMLInputElement).type),
        ),
    ).toEqual([
      "application-nickname",
      "application-email",
      "application-steamProfileUrl",
      "application-discord",
      "checkbox",
      "checkbox",
      "application-introduction",
      "submit",
    ]);
    const privacy = await box(".application-card form > p.muted"),
      submit = await page
        .getByRole("button", { name: "Send application", exact: true })
        .boundingBox();
    expect(privacy.y + privacy.height).toBeLessThanOrEqual(submit?.y ?? 0);
  },
);

// VTC-089 hero video. Playwright's Chromium has no H.264 decoder, so these cases prove request
// timing, lifecycle and fallbacks with routed or stubbed media; real playback is an owner check.
type MediaProbe = {
  log: string[];
  firePlaying: () => void;
  setHidden: (hidden: boolean) => void;
};
const probe = (page: Page) =>
  page.evaluate(() => (window as unknown as { __media: MediaProbe }).__media.log.slice());
/**
 * Replaces media loading with a recorder, so no file is fetched and `playing` fires on demand.
 * Like iOS Safari, a layer has metadata only (HAVE_METADATA) until it has played once.
 */
function stubMedia() {
  const log: string[] = [];
  const state = new WeakMap<HTMLMediaElement, { src: string; time: number; ready: number }>();
  const own = (element: HTMLMediaElement) => {
    const value = state.get(element) ?? { src: "", time: 0, ready: 0 };
    state.set(element, value);
    return value;
  };
  const at = (element: HTMLMediaElement) =>
    Array.from(document.querySelectorAll("video")).indexOf(element as HTMLVideoElement);
  const proto = HTMLMediaElement.prototype;
  Object.defineProperty(proto, "src", {
    configurable: true,
    get() {
      return own(this).src;
    },
    set(value: string) {
      own(this).src = value;
      own(this).ready = 1;
      this.setAttribute("data-stub-src", value);
      log.push(`src${at(this)}`);
      // Muting and preload must already be in place when the source is assigned.
      log.push(
        `flags${at(this)}:${this.muted}:${this.hasAttribute("muted")}:${this.getAttribute("preload")}`,
      );
    },
  });
  Object.defineProperty(proto, "currentTime", {
    configurable: true,
    get() {
      return own(this).time;
    },
    set(value: number) {
      own(this).time = value;
      log.push(`seek${at(this)}:${value}`);
    },
  });
  Object.defineProperty(proto, "duration", { configurable: true, get: () => 7.917 });
  Object.defineProperty(proto, "readyState", {
    configurable: true,
    get() {
      return own(this).ready;
    },
  });
  proto.play = function () {
    log.push(`play${at(this)}`);
    const media = own(this);
    if (media.ready < 2) log.push(`rise${at(this)}:${media.ready}`);
    media.ready = 4;
    return Promise.resolve();
  };
  proto.pause = function () {
    log.push(`pause${at(this)}`);
  };
  proto.load = function () {
    log.push(`load${at(this)}`);
  };
  let hidden = false;
  Object.defineProperty(Document.prototype, "visibilityState", {
    configurable: true,
    get: () => (hidden ? "hidden" : "visible"),
  });
  (window as unknown as { __media: MediaProbe }).__media = {
    log,
    firePlaying: () => document.querySelector("video")?.dispatchEvent(new Event("playing")),
    setHidden(value) {
      hidden = value;
      document.dispatchEvent(new Event("visibilitychange"));
    },
  };
}
/** Both layers drop their source with load() on teardown (they are already detached then). */
const released = (log: string[]) => log.filter((entry) => entry.startsWith("load")).length;
const builtAsset = (pattern: RegExp) => {
  const directory = resolve("apps/web/dist/assets");
  const name = readdirSync(directory).find((file) => pattern.test(file));
  if (!name) throw new Error("MISSING_BUILT_LANDING_ASSET");
  return { url: `/assets/${name}`, bytes: statSync(resolve(directory, name)).size };
};

test(
  "the still paints first; the video waits for load, picks one size and failures keep the still",
  browserCase(["@layout"]),
  async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.addInitScript(() =>
      window.addEventListener("load", () => {
        (window as unknown as { __loadedAt: number }).__loadedAt = Date.now();
      }),
    );
    for (const outcome of ["abort", "corrupt"] as const) {
      const media: { url: string; at: number }[] = [];
      let release = () => {};
      const gate = new Promise<void>((done) => {
        release = done;
      });
      await page.route("**/*.mp4", async (route) => {
        media.push({ url: route.request().url(), at: Date.now() });
        await gate;
        if (outcome === "abort") await route.abort("failed");
        else await route.fulfill({ contentType: "video/mp4", body: "NOT_A_VIDEO" });
      });
      await page.goto("/en");
      const still = page.locator(".landing-hero-still");
      await expect(still).toBeVisible();
      await expect
        .poll(() => still.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
        .toBe(true);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Send application", exact: true }),
      ).toBeEnabled();
      await expect.poll(() => media.length).toBeGreaterThan(0);
      const narrow = (page.viewportSize()?.width ?? 1280) <= 760;
      for (const request of media)
        expect(request.url).toMatch(
          narrow ? /\/hero-854-[\w-]+\.mp4#?/ : /\/hero-1280-[\w-]+\.mp4#?/,
        );
      expect(await still.evaluate((img: HTMLImageElement) => img.currentSrc)).toMatch(
        narrow ? /hero-still-854-/ : /hero-still-1280-/,
      );
      const loadedAt = await page.evaluate(
        () => (window as unknown as { __loadedAt: number }).__loadedAt,
      );
      expect(media[0]?.at ?? 0).toBeGreaterThanOrEqual(loadedAt);
      release();
      await expect(page.locator(".landing-hero video")).toHaveCount(0);
      await expect(still).toBeVisible();
      await page.unroute("**/*.mp4");
    }
  },
);

test(
  "video layers start muted at 1 s, reveal on playing, pause with the toggle and tab, and unmount",
  browserCase(["@functional"]),
  async ({ page }) => {
    const c = publicContent.en;
    await page.addInitScript(stubMedia);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.clock.install({ time: liveClock });
    await routeEvents(page, liveEvents("en"));
    await page.goto("/en");
    const videos = page.locator(".landing-hero video"),
      first = videos.nth(0),
      second = videos.nth(1);
    await expect(videos).toHaveCount(2);
    const source = /\/assets\/hero-(854|1280)-[\w-]+\.mp4#t=1$/;
    await expect(first).toHaveAttribute("data-stub-src", source);
    for (const video of [first, second]) {
      await expect(video).toHaveAttribute("muted", "");
      await expect(video).toHaveAttribute("preload", "auto");
      await expect(video).toHaveAttribute("aria-hidden", "true");
      await expect(video).toHaveAttribute("tabindex", "-1");
      expect(await video.evaluate((node: HTMLVideoElement) => node.muted && node.playsInline)).toBe(
        true,
      );
    }
    await expect.poll(() => probe(page)).toContain("play0");
    const log = await probe(page);
    expect(log.indexOf("seek0:1")).toBeGreaterThan(-1);
    expect(log.indexOf("seek0:1")).toBeLessThan(log.indexOf("play0"));
    // Nothing is visible and the second layer is not requested before real playback.
    await expect(first).not.toHaveAttribute("data-active", "true");
    expect(await first.evaluate((node) => getComputedStyle(node).opacity)).toBe("0");
    await expect(second).not.toHaveAttribute("data-stub-src");
    await page.evaluate(() => (window as unknown as { __media: MediaProbe }).__media.firePlaying());
    await expect(first).toHaveAttribute("data-active", "true");
    await expect(second).toHaveAttribute("data-stub-src", source);
    // The hidden layer is primed (muted play, pause, back to 1 s) from below HAVE_CURRENT_DATA.
    await expect
      .poll(() => probe(page))
      .toEqual(expect.arrayContaining(["rise1:1", "pause1", "seek1:1"]));
    const primed = await probe(page);
    expect(primed).toEqual(
      expect.arrayContaining(["flags0:true:true:auto", "flags1:true:true:auto"]),
    );
    expect(primed.indexOf("src1")).toBeLessThan(primed.indexOf("play1"));
    expect(primed.indexOf("play1")).toBeLessThan(primed.indexOf("pause1"));
    expect(primed.indexOf("pause1")).toBeLessThan(primed.lastIndexOf("seek1:1"));
    await expect(second).not.toHaveAttribute("data-active", "true");
    expect(await second.evaluate((node) => getComputedStyle(node).opacity)).toBe("0");
    await page.clock.runFor(1200);
    await expect.poll(() => first.evaluate((node) => getComputedStyle(node).opacity)).toBe("1");

    const toggle = page.getByRole("button", { name: c.pauseMotion, exact: true });
    const count = async (entry: string) =>
      (await probe(page)).filter((item) => item === entry).length;
    const pauses = await count("pause0");
    await toggle.click();
    await expect.poll(() => count("pause0")).toBeGreaterThan(pauses);
    const plays = await count("play0");
    await toggle.click();
    await expect.poll(() => count("play0")).toBeGreaterThan(plays);
    const hiddenPauses = await count("pause0");
    await page.evaluate(() =>
      (window as unknown as { __media: MediaProbe }).__media.setHidden(true),
    );
    await expect.poll(() => count("pause0")).toBeGreaterThan(hiddenPauses);
    const visiblePlays = await count("play0");
    await page.evaluate(() =>
      (window as unknown as { __media: MediaProbe }).__media.setHidden(false),
    );
    await expect.poll(() => count("play0")).toBeGreaterThan(visiblePlays);

    // Near the end the primed layer fades in instead of the visible one jumping back.
    const beforeSwap = (await probe(page)).length;
    await first.evaluate((node: HTMLVideoElement) => {
      node.currentTime = 7.5;
    });
    await page.clock.runFor(100);
    await expect(second).toHaveAttribute("data-active", "true");
    await expect(first).toHaveAttribute("data-active", "false");
    const swap = (await probe(page)).slice(beforeSwap);
    expect(swap).toEqual(expect.arrayContaining(["seek1:1", "play1"]));
    expect(swap.slice(0, swap.indexOf("play1"))).not.toContain("seek0:1");
    expect(swap).not.toContain("rise1:1");

    await page.getByRole("main").getByRole("link", { name: c.allEvents, exact: true }).click();
    await expect(videos).toHaveCount(0);
    expect(released(await probe(page))).toBeGreaterThanOrEqual(2);
  },
);

test(
  "reduced motion never requests the video and a live switch tears it down",
  browserCase(["@functional"]),
  async ({ page }) => {
    const media: string[] = [];
    page.on("request", (request) => {
      if (/\.mp4/.test(request.url())) media.push(request.url());
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/en");
    await page.waitForLoadState("load");
    // Longer than the idle-callback deadline that would otherwise start the video.
    await page.waitForTimeout(2000);
    await expect(page.locator("video")).toHaveCount(0);
    expect(media).toEqual([]);
    await expect(page.locator(".landing-hero-still")).toBeVisible();

    await page.addInitScript(stubMedia);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/en");
    await expect(page.locator(".landing-hero video")).toHaveCount(2);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.locator(".landing-hero video")).toHaveCount(0);
    expect(released(await probe(page))).toBeGreaterThanOrEqual(2);
    expect(
      await page
        .locator(".landing")
        .evaluate(
          (element) =>
            element
              .getAnimations({ subtree: true })
              .filter((animation) => animation instanceof CSSAnimation).length,
        ),
    ).toBe(0);
    expect(media).toEqual([]);
  },
);

test(
  "built server serves landing media with ranges, exact types and immutable caching",
  browserCase(["@functional"]),
  async ({ request }) => {
    const video = builtAsset(/^hero-854-[\w-]+\.mp4$/),
      still = builtAsset(/^hero-still-854-[\w-]+\.webp$/);
    const partial = await request.get(video.url, { headers: { Range: "bytes=0-1023" } });
    expect(partial.status()).toBe(206);
    expect(partial.headers()["content-range"]).toBe(`bytes 0-1023/${video.bytes}`);
    expect(partial.headers()["accept-ranges"]).toBe("bytes");
    expect(partial.headers()["content-type"]).toBe("video/mp4");
    expect(partial.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect((await partial.body()).length).toBe(1024);
    const full = await request.get(video.url);
    expect(full.status()).toBe(200);
    expect(full.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect((await full.body()).length).toBe(video.bytes);
    const image = await request.get(still.url);
    expect(image.status()).toBe(200);
    expect(image.headers()["content-type"]).toBe("image/webp");
    expect(image.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
  },
);

test(
  "menu traps focus, Esc returns to its button and section links focus their section",
  browserCase(["@layout", "@viewport-narrow"]),
  async ({ page }) => {
    await page.goto("/");
    const trigger = page.getByRole("button", { name: "Открыть навигацию", exact: true });
    await expect(trigger).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Разделы", exact: true })).toBeHidden();
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Навигация", exact: true });
    await expect(dialog.getByRole("link", { name: "Конвои", exact: true })).toBeFocused();
    await expect(dialog.getByRole("link", { name: "Войти", exact: true })).toBeVisible();
    await expect(dialog.getByRole("combobox", { name: "Язык", exact: true })).toBeVisible();
    for (let step = 0; step < 12; step++) {
      await page.keyboard.press("Tab");
      expect(
        await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null),
      ).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await dialog.getByRole("link", { name: "Ранги", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator("#ranks")).toBeFocused();
    await expect(page.locator("#ranks")).toBeInViewport();
    expect(new URL(page.url()).hash).toBe("#ranks");
    expect(await noOverflow(page)).toBe(true);
    // Widening past the menu breakpoint closes an open sheet, whose trigger is gone there.
    await trigger.click();
    await expect(dialog).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeHidden();
  },
);

test(
  "pill and slogan stay below the truck and logo at every width without overflow",
  browserCase(["@layout", "@viewport-desktop"]),
  async ({ page }) => {
    await page.clock.install({ time: liveClock });
    await routeEvents(page, liveEvents("ru"));
    await page.goto("/");
    await expect(chipFor(page, "ru", "Fictional Evening Convoy")).toBeVisible();
    for (const width of [360, 390, 820, 1280, 1440, 1920, 2560]) {
      await page.setViewportSize({ width, height: 900 });
      const layout = await page.evaluate(() => {
        const rect = (selector: string) =>
          (document.querySelector(selector) as Element).getBoundingClientRect();
        const frame = rect(".landing-hero-frame");
        // Same cover/object-position as the CSS: 1280x720 source anchored at 50% 30%.
        const scale = Math.max(frame.width / 1280, frame.height / 720),
          width = 1280 * scale,
          height = 720 * scale,
          left = frame.left + (frame.width - width) * 0.5,
          top = frame.top + (frame.height - height) * 0.3;
        const area = (x1: number, x2: number, y1: number, y2: number) => ({
          left: left + x1 * width,
          right: left + x2 * width,
          top: top + y1 * height,
          bottom: top + y2 * height,
        });
        const plain = (box: DOMRect) => ({
          left: box.left,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
        });
        return {
          truck: area(0.19, 0.51, 0.35, 0.74),
          logo: area(0.48, 0.76, 0.13, 0.46),
          pill: plain(rect(".landing-convoy-chip")),
          slot: plain(rect(".landing-chip-slot")),
          heading: plain(rect(".landing-shell h1")),
          overflow: document.documentElement.scrollWidth > window.innerWidth,
        };
      });
      const overlaps = (
        a: { left: number; right: number; top: number; bottom: number },
        b: typeof a,
      ) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      expect(layout.overflow, `overflow at ${width}`).toBe(false);
      for (const name of ["pill", "slot", "heading"] as const) {
        expect(layout[name].top, `${name} below the truck at ${width}`).toBeGreaterThanOrEqual(
          layout.truck.bottom - 0.5,
        );
        expect(overlaps(layout[name], layout.truck), `${name}/truck at ${width}`).toBe(false);
        expect(overlaps(layout[name], layout.logo), `${name}/logo at ${width}`).toBe(false);
      }
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    const header = page.getByRole("navigation", { name: "Разделы", exact: true });
    await header.getByRole("link", { name: "Ранги", exact: true }).click();
    await expect(page.locator("#ranks")).toBeFocused();
    await expect(page.locator("#ranks")).toBeInViewport();
  },
);

test(
  "without JavaScript the document shows every header link and the form note",
  browserCase(["@functional"]),
  async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 390, height: 844 },
      ...(baseURL ? { baseURL } : {}),
    });
    try {
      const page = await context.newPage();
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Юкон? Достаточно суров");
      const sections = page.getByRole("navigation", { name: "Разделы", exact: true });
      await expect(sections.getByRole("link")).toHaveCount(5);
      for (const link of await sections.getByRole("link").all()) await expect(link).toBeVisible();
      await expect(page.getByRole("link", { name: "Войти", exact: true })).toBeVisible();
      await expect(page.locator(".landing-menu-placeholder")).toBeHidden();
      await expect(page.getByText(publicContent.ru.noScript, { exact: true })).toBeVisible();
      await expect(page.locator("video")).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    } finally {
      await context.close();
    }
  },
);

test(
  "throttled phone profile loads only the small still and video, after the page",
  browserCase(["@layout", "@viewport-mobile"]),
  async ({ page }, info) => {
    test.setTimeout(150000);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 150,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    const requests = new Map<
      string,
      { url: string; start: number; bytes?: number; failed?: boolean }
    >();
    cdp.on("Network.requestWillBeSent", (event) =>
      requests.set(event.requestId, { url: event.request.url, start: event.timestamp }),
    );
    cdp.on("Network.loadingFinished", (event) => {
      const entry = requests.get(event.requestId);
      if (entry) entry.bytes = event.encodedDataLength;
    });
    cdp.on("Network.loadingFailed", (event) => {
      const entry = requests.get(event.requestId);
      if (entry) entry.failed = true;
    });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/", { timeout: 60000 });
    await expect(page.getByRole("button", { name: "Отправить заявку", exact: true })).toBeEnabled({
      timeout: 30000,
    });
    // The expected variants below are for this project's 390px viewport at 1x density.
    expect(await page.evaluate(() => [innerWidth, devicePixelRatio])).toEqual([390, 1]);
    const media = () =>
      [...requests.values()]
        .filter((entry) => /\/assets\/[^/?#]+\.(webp|mp4)/.test(entry.url))
        .map((entry) => ({
          ...entry,
          name: new URL(entry.url).pathname.split("/").pop() ?? "",
          plain: (new URL(entry.url).pathname.split("/").pop() ?? "").replace(
            /-[\w-]{8}\.(webp|mp4)$/,
            ".$1",
          ),
        }));
    await expect
      .poll(() => media().some((entry) => entry.plain.endsWith(".mp4")), { timeout: 30000 })
      .toBe(true);
    // Bring the lazy images into range, then let every media request settle.
    const lazy = [
      { selector: ".landing-cab-image", variant: "cab-828.webp" },
      { selector: ".landing-photo-main img", variant: "about-parking-480.webp" },
      { selector: ".landing-photo-inset img", variant: "about-convoy-320.webp" },
    ];
    for (const { selector } of lazy) {
      const image = page.locator(selector);
      await image.scrollIntoViewIfNeeded();
      await expect
        .poll(
          () => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth),
          {
            timeout: 30000,
          },
        )
        .toBeGreaterThan(0);
    }
    await expect
      .poll(() => media().every((entry) => entry.bytes !== undefined || entry.failed), {
        timeout: 60000,
      })
      .toBe(true);
    const loaded = media();
    const names = loaded.map((entry) => entry.plain);
    expect(names).toContain("hero-still-854.webp");
    expect(names).toContain("hero-854.mp4");
    for (const { selector, variant } of lazy) {
      const chosen = await page
        .locator(selector)
        .evaluate((node: HTMLImageElement) => new URL(node.currentSrc).pathname.split("/").pop());
      expect(chosen?.replace(/-[\w-]{8}\.webp$/, ".webp"), selector).toBe(variant);
      const family = variant.replace(/-\d+\.webp$/, "-");
      // Exactly the chosen variant of each image family was requested, and it finished.
      expect(
        names.filter((name) => name.startsWith(family)),
        family,
      ).toEqual([variant]);
      expect(loaded.find((entry) => entry.plain === variant)?.bytes, variant).toBeDefined();
    }
    for (const absent of ["hero-still-1280.webp", "hero-1280.mp4"])
      expect(names).not.toContain(absent);
    const still = loaded.find((entry) => entry.plain === "hero-still-854.webp");
    const video = loaded.find((entry) => entry.plain === "hero-854.mp4");
    expect(still?.bytes, "hero still finished").toBeDefined();
    expect(still?.start ?? Number.POSITIVE_INFINITY).toBeLessThan(video?.start ?? 0);
    // Encoded lengths include response headers; allow 2 KB for them per file. Video requests
    // may be cancelled and resumed as ranges by the media pipeline; they must still settle.
    for (const entry of loaded) {
      if (entry.plain.endsWith(".webp"))
        expect(entry.bytes, `${entry.name} finished`).toBeDefined();
      if (entry.bytes === undefined) {
        expect(entry.failed, `${entry.name} settled`).toBe(true);
        continue;
      }
      const prepared = builtAsset(new RegExp(`^${entry.name.replace(/[.]/g, "\\.")}$`)).bytes;
      expect(entry.bytes, entry.name).toBeLessThanOrEqual(prepared + 2048);
    }
    const report = info.outputPath("landing-mobile-media.json");
    writeFileSync(
      report,
      JSON.stringify(
        loaded.map(({ name, bytes, failed }) => ({
          name,
          encodedDataLength: bytes ?? null,
          failed: !!failed,
        })),
        null,
        2,
      ),
    );
    await info.attach("landing-mobile-media.json", {
      path: report,
      contentType: "application/json",
    });
  },
);
