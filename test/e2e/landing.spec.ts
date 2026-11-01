import { randomUUID } from "node:crypto";
import type { Page, TestInfo } from "@playwright/test";
import { eventTranslations } from "../../apps/web/src/features/events/translations.ts";
import { publicContent } from "../../apps/web/src/features/landing/content.ts";
import { testConnection } from "../persistence/support.ts";
import { expect, test } from "./support/fixtures.ts";
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
const receipt = {
  data: { id: "41000000-0000-4000-8000-000000000001", version: 1 },
  meta: { requestId: "synthetic-request" },
};
for (const locale of ["ru", "en"] as const) {
  test(`public ${locale} initial HTML and rendered validation/navigation are accessible without overflow`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(locale === "en" ? "/en" : "/");
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      locale === "ru" ? "Своя компания. Общая дорога." : "Your company. Our road.",
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
    await page
      .getByRole("combobox", { name: locale === "ru" ? "Язык" : "Language", exact: true })
      .selectOption(locale === "ru" ? "en" : "ru");
    await expect.poll(() => new URL(page.url()).pathname).toBe(locale === "ru" ? "/en" : "/");
    await expect(page.locator("html")).toHaveAttribute("lang", locale === "ru" ? "en" : "ru");
    await expect(
      page.getByRole("textbox", { name: locale === "ru" ? "Nickname" : "Никнейм", exact: true }),
    ).toHaveValue("Fictional Applicant");
    await page.getByRole("link", { name: "Yukon Union", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", locale === "ru" ? "en" : "ru");
    await page
      .getByRole("combobox", { name: locale === "ru" ? "Language" : "Язык", exact: true })
      .selectOption(locale);
    await page
      .getByRole("main")
      .getByRole("link", {
        name: locale === "ru" ? "Публичные события" : "Public events",
        exact: true,
      })
      .click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      locale === "ru" ? "Открытые конвои" : "Public convoys",
    );
    await page
      .getByRole("main")
      .getByRole("link", { name: locale === "ru" ? "Подать заявку" : "Apply to join", exact: true })
      .click();
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect.poll(() => new URL(page.url()).pathname).toBe(locale === "ru" ? "/" : "/en");
    await expect(
      page.getByRole("heading", {
        name: locale === "ru" ? "Начните со знакомства" : "Start with an introduction",
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
  });
}
test("built public documents contain real localized content before JavaScript and narrow indexing", async ({
  request,
}) => {
  for (const [path, locale, phrase] of [
    ["/", "ru", "Своя компания. Общая дорога."],
    ["/en", "en", "Your company. Our road."],
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
    // VTC-050: static ladder/join content and art are prerendered; live parts are client-only.
    const c = publicContent[locale as "ru" | "en"];
    for (const text of [
      c.ladderTitle,
      ...c.ladder.map((level) => level.name),
      ...c.joinSteps.map((step) => step.title),
      c.joinNote,
      'data-motion="static"',
      'class="landing-hero-art" aria-hidden="true"',
    ])
      expect(body).toContain(text);
    for (const text of [
      "landing-stats",
      "landing-ticker",
      "landing-convoy-chip",
      "aria-pressed",
      "Достаточно суров",
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
});
test("controlled pending and uncertain retries preserve original payload/key; changed input gets a new key", async ({
  page,
}, info) => {
  await page.route("**/api/v1/auth/csrf", (route) =>
    route.fulfill({
      json: { data: { token: "NONFUNCTIONAL_FIXTURE" }, meta: { requestId: "synthetic-request" } },
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
});
for (const locale of ["ru", "en"] as const) {
  test(`controlled ${locale} server failures preserve input and display safe translated feedback`, async ({
    page,
  }, info) => {
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
  });
}
// Real admissions integration uses fictional input and no capture of private HTTP material.
test.describe("real rendered admissions", () => {
  test("rendered form submits to real VTC-015 and repeat email receives the same safe confirmation without a session", async ({
    page,
    context,
  }) => {
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
  });
  for (const locale of ["en", "ru"] as const) {
    test(`committed but unconfirmed ${locale} submission replays after switching the interface language`, async ({
      page,
      context,
    }) => {
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
    });
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
  retired: false,
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
const landingPath = (locale: Locale) => (locale === "en" ? "/en" : "/");
const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

for (const locale of ["ru", "en"] as const) {
  test(`live ${locale} landing shows countdown, ticker, stats and cards with a working pause control`, async ({
    page,
    context,
    baseURL,
  }, info) => {
    const c = publicContent[locale],
      e = eventTranslations[locale],
      events = liveEvents(locale),
      first = events[0] as ReturnType<typeof liveEvent>;
    await context.addCookies([
      { name: "vtc_fictional_probe", value: "fictional", url: baseURL ?? "" },
    ]);
    await page.clock.install({ time: new Date("2026-10-30T12:00:00.000Z") });
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

    const ticker = page.locator(".landing-ticker");
    await expect(ticker).toHaveAttribute("aria-hidden", "true");
    await expect(ticker).toContainText("Fictional Origin → Fictional Destination");
    await expect(ticker).toContainText("Fictional Route West");
    await expect(ticker).not.toContainText("Fictional Cancelled Route");
    await expect(ticker.locator("a, button, [tabindex]")).toHaveCount(0);

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

    const convoys = page.getByRole("region", { name: e.publicTitle, exact: true });
    await expect(convoys.getByRole("listitem")).toHaveCount(3);
    const titles = convoys.getByRole("heading", { level: 3 }).getByRole("link");
    await expect(titles).toHaveCount(3);
    for (const [index, event] of events.entries())
      await expect(titles.nth(index)).toHaveAttribute("href", `/events/${event.id}`);
    await expect(convoys).toContainText(e.cancelled);
    await expect(convoys).toContainText("UTC");
    await expect(convoys).toContainText(c.convoysNote);

    expect(await motionState(page, ".hero-marker")).toContain("running");
    expect(await motionState(page, ".landing-ticker-track")).toContain("running");
    const toggle = page.getByRole("button", { name: c.pauseMotion, exact: true });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => motionState(page, ".hero-marker")).toEqual(["paused"]);
    await expect.poll(() => motionState(page, ".landing-ticker-track")).toEqual(["paused"]);
    const visible = chip.locator(".landing-chip-text");
    await expect(visible).toContainText(`${c.nextConvoy}:`);
    await expect(visible).not.toContainText(c.units.min);
    await expect(chip).toHaveAccessibleName(name);
    await expect(toggle).toBeFocused();
    await page.keyboard.press("Space");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => motionState(page, ".hero-marker")).toEqual(["running"]);
    await expect(visible).toContainText(c.units.min);
    expect(await noOverflow(page)).toBe(true);
    await capture(page, info, `${locale}-live`);
  });
}

test("reduced motion keeps the live landing static and hides the pause control without a timer", async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await routeEvents(page, liveEvents("en"));
  await page.goto("/en");
  const c = publicContent.en;
  await expect(chipFor(page, "en", "Fictional Evening Convoy")).toBeVisible();
  await expect(page.locator(".landing-ticker")).toBeAttached();
  expect(
    await page
      .locator(".landing")
      .evaluate((element) => element.getAnimations({ subtree: true }).length),
  ).toBe(0);
  await expect(page.locator(".landing-ticker [data-copy]").first()).toBeHidden();
  await expect(page.getByRole("button", { name: c.pauseMotion, exact: true })).toBeVisible();
  expect(await noOverflow(page)).toBe(true);
  await capture(page, info, "en-reduced-motion");
  await routeEvents(page, []);
  await page.goto("/en");
  await expect(page.getByText(c.convoysEmpty, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: c.pauseMotion, exact: true })).toBeHidden();
});

test("stats band stays hidden while pending or unavailable and shows partial months honestly", async ({
  page,
}) => {
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
});

test("convoy chip and ticker disappear for empty, cancelled-only and failed public event reads", async ({
  page,
}) => {
  const c = publicContent.en,
    e = eventTranslations.en;
  const convoys = page.getByRole("region", { name: e.publicTitle, exact: true });
  const nextChip = page.getByRole("link", { name: /^Next convoy/ });
  await page.goto("/en");
  await expect(convoys.getByText(c.convoysEmpty, { exact: true })).toBeVisible();
  await expect(nextChip).toHaveCount(0);
  await expect(page.locator(".landing-ticker")).toHaveCount(0);

  await routeEvents(
    page,
    liveEvents("en").filter((event) => event.status === "cancelled"),
  );
  await page.goto("/en");
  await expect(convoys.getByRole("listitem")).toHaveCount(1);
  await expect(convoys).toContainText(e.cancelled);
  await expect(nextChip).toHaveCount(0);
  await expect(page.locator(".landing-ticker")).toHaveCount(0);

  await page.route("**/api/v1/public/events?*", (route) =>
    route.fulfill({ status: 503, json: { error: { code: "UNAVAILABLE" } } }),
  );
  await page.goto("/en");
  await expect(convoys.getByRole("alert")).toContainText(e.unavailable);
  await expect(convoys.getByRole("button", { name: e.retry, exact: true })).toBeVisible();
  await expect(nextChip).toHaveCount(0);
  await expect(page.locator(".landing-ticker")).toHaveCount(0);
});

test("a started convoy refreshes the list once and the chip moves to the next scheduled one", async ({
  page,
}) => {
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
});

test("live controls keep keyboard order, visible focus and pointer-sized targets", async ({
  page,
}) => {
  const c = publicContent.en,
    e = eventTranslations.en;
  await routeEvents(page, liveEvents("en"));
  await page.goto("/en");
  const main = page.getByRole("main"),
    chip = chipFor(page, "en", "Fictional Evening Convoy"),
    apply = main.locator(".landing-hero").getByRole("link", { name: c.apply, exact: true }),
    publicEvents = main.getByRole("link", { name: c.events, exact: true }),
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
  await expect(publicEvents).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(toggle).toBeFocused();
  expect(await outlined(toggle)).toBe(true);

  const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
    minimum = coarse ? 40 : 30;
  const targets = [
    chip,
    toggle,
    apply,
    publicEvents,
    main.getByRole("link", { name: e.title, exact: true }),
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
});

test("compact application form keeps field order and lays out by card width", async ({ page }) => {
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
});
