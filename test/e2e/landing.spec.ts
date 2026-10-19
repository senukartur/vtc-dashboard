import { randomUUID } from "node:crypto";
import type { Page, TestInfo } from "@playwright/test";
import { testConnection } from "../persistence/support.ts";
import { expect, test } from "./support/fixtures.ts";
// Manual captures below contain controlled public states only; real HTTP material is never traced.
test.use({ trace: "off", screenshot: "off", video: "off" });
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
      locale === "ru" ? "Публичные события ещё готовятся" : "Public events are on the way",
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
      locale === "ru" ? "Вход в кабинет ещё готовится" : "Member sign-in is on the way",
    );
    await page
      .getByRole("main")
      .getByRole("link", { name: locale === "ru" ? "Подать заявку" : "Apply to join", exact: true })
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
