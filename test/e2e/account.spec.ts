import { inertNotifications } from "./support/notifications.ts";
import type { Locator, Page, Request, TestInfo } from "@playwright/test";
import { accountFixture, fixtureId } from "../../apps/web/src/features/account/fixtures.ts";
import { publicContent } from "../../apps/web/src/features/landing/content.ts";
import { expect, test } from "./support/fixtures.ts";
import { openMoreSheet, phone, signOutFromMenu, switchLanguage } from "./support/locale.ts";

const meta = { requestId: "synthetic-request" };
const receipt = { data: { id: fixtureId, version: 2 }, meta };
const challenge = {
  data: { id: fixtureId, expiresAt: "2099-10-19T12:00:00.000Z", state: "pending" },
  meta,
};
const error = (status: number) => ({ status, json: { error: { code: "PRIVATE_SENTINEL" } } });
async function mocks(page: Page) {
  await page.route("**/api/v1/**", (route) => {
    const notification = inertNotifications(route);
    if (notification) return notification;
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/auth/csrf")
      return route.fulfill({ json: { data: { token: "NONFUNCTIONAL_FIXTURE" }, meta } });
    if (path === "/api/v1/me") return route.fulfill(error(401));
    if (path === "/api/v1/me/email-change")
      return route.fulfill({ json: { data: { pending: null }, meta } });
    return route.fulfill(error(503));
  });
}
const language = switchLanguage;
async function capture(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
}
test("early link ingress is StrictMode-safe, removes history/query/hash, never redeems on GET and hides malformed links", async ({
  page,
}) => {
  await mocks(page);
  let writes = 0;
  let secretReferrer = false;
  const token = `${fixtureId}.${"x".repeat(43)}`;
  page.on("request", (request) => {
    if (request.method() === "POST") writes++;
    if ((request.headers().referer ?? "").includes(token)) secretReferrer = true;
  });
  await page.goto(`/INVITATION/?token=${token}#discard`);
  await language(page, "en");
  expect(page.url().endsWith("/invitation")).toBe(true);
  expect(await page.evaluate(() => JSON.stringify(history.state).includes("x".repeat(43)))).toBe(
    false,
  );
  await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => "__vtcLink" in window)).toBe(false);
  expect(
    await page.evaluate(() =>
      JSON.stringify([localStorage, sessionStorage, document.body.innerHTML]).includes(
        "x".repeat(43),
      ),
    ),
  ).toBe(false);
  expect(writes).toBe(0);
  expect(secretReferrer).toBe(false);
  await page.reload();
  await language(page, "en");
  await expect(page.getByRole("heading", { name: "This link is unavailable" })).toBeVisible();
  for (const suffix of ["", "?token=bad", `?token=${token}&token=${token}`]) {
    await page.goto(`/password-reset${suffix}`);
    await language(page, "en");
    await expect(page.getByRole("heading", { name: "This link is unavailable" })).toBeVisible();
  }
});
for (const locale of ["en", "ru"] as const) {
  test(`controlled ${locale} login failures retain input, bound rate retry and hide server details`, async ({
    page,
  }, info) => {
    await mocks(page);
    let status = 401;
    await page.route("**/api/v1/auth/login", (route) =>
      route.fulfill({ ...error(status), headers: { "Retry-After": "1" } }),
    );
    await page.goto("/login");
    await language(page, locale);
    const form = page.getByRole("form", {
      name: locale === "en" ? "Sign in" : "Войти",
      exact: true,
    });
    await form
      .getByLabel(locale === "en" ? "Email" : "Электронная почта", { exact: true })
      .fill("member@example.invalid");
    const password = form.getByLabel(locale === "en" ? "Password" : "Пароль", { exact: true });
    await password.fill("NONFUNCTIONAL_FIXTURE");
    for (const value of [401, 403, 429, 503]) {
      status = value;
      await form
        .getByRole("button", {
          name: locale === "en" ? /^(Sign in|Retry this action)$/ : /^(Войти|Повторить действие)$/,
        })
        .click();
      await expect(form.getByRole("alert")).toBeVisible();
      await expect(password).toHaveValue("NONFUNCTIONAL_FIXTURE");
      await expect(page.getByText("PRIVATE_SENTINEL")).toHaveCount(0);
      if (value === 429) {
        await expect(
          form.getByRole("button", {
            name: locale === "en" ? "Retry this action" : "Повторить действие",
            exact: true,
          }),
        ).toBeDisabled();
        await expect(
          form.getByRole("button", {
            name: locale === "en" ? "Retry this action" : "Повторить действие",
            exact: true,
          }),
        ).toBeEnabled();
      }
    }
    await capture(page, info, `${locale}-login-unavailable`);
  });
  test(`controlled ${locale} accessible sign-in validation, recovery, visibility, mobile focus and synthetic render`, async ({
    page,
  }, info) => {
    await mocks(page);
    await page.goto("/login");
    await language(page, locale);
    const form = page.getByRole("form", {
      name: locale === "en" ? "Sign in" : "Войти",
      exact: true,
    });
    await form
      .getByRole("button", { name: locale === "en" ? "Sign in" : "Войти", exact: true })
      .click();
    await expect(page.locator(".error-summary")).toBeFocused();
    await expect(page.locator(".error-summary a")).toHaveCount(2);
    await page.locator(".error-summary a").first().click();
    await expect(
      page.getByLabel(locale === "en" ? "Email" : "Электронная почта", { exact: true }),
    ).toBeFocused();
    const password = page.getByLabel(locale === "en" ? "Password" : "Пароль", { exact: true });
    await password.fill("NONFUNCTIONAL_FIXTURE");
    const toggle = form.getByRole("button", {
      name: locale === "en" ? "Show password" : "Показать пароль",
      exact: true,
    });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(password).toHaveAttribute("type", "text");
    await page
      .getByRole("banner")
      .getByRole("combobox")
      .selectOption(locale === "en" ? "ru" : "en");
    await expect(
      page.getByLabel(locale === "en" ? "Пароль" : "Password", { exact: true }),
    ).toHaveValue("NONFUNCTIONAL_FIXTURE");
    await expect(
      page.getByRole("button", {
        name: locale === "en" ? "Показать пароль" : "Show password",
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    await language(page, locale);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await capture(page, info, `${locale}-login-validation`);
    if (info.project.name === "desktop-chromium") {
      const viewport = page.viewportSize();
      await page.setViewportSize({ width: 375, height: 812 });
      await capture(page, info, `${locale}-login-small`);
      await page.setViewportSize({ width: 844, height: 390 });
      await capture(page, info, `${locale}-login-landscape`);
      if (viewport) await page.setViewportSize(viewport);
    }
    const menu = page.getByRole("button", { name: /^(Open navigation|Открыть навигацию)$/ });
    if (await menu.isVisible()) {
      await menu.click();
      await page.keyboard.press("Escape");
      await expect(menu).toBeFocused();
    }
    await page.goto("/password-recovery");
    await language(page, locale);
    await page.route("**/api/v1/auth/password-reset-requests", (route) =>
      route.fulfill({ status: 202, json: { data: { status: "received" }, meta } }),
    );
    await page
      .getByLabel(locale === "en" ? "Email" : "Электронная почта", { exact: true })
      .fill("unknown@example.invalid");
    await page
      .getByRole("button", {
        name: locale === "en" ? "Request password recovery" : "Запросить восстановление пароля",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("heading", {
        name: locale === "en" ? "Request received" : "Запрос принят",
        exact: true,
      }),
    ).toBeVisible();
    await capture(page, info, `${locale}-recovery`);
  });
}
async function box(locator: Locator) {
  const value = await locator.boundingBox();
  if (!value) throw new Error("SYNTHETIC_LAYOUT_MISSING");
  return value;
}
const lastControlType = (form: Locator) =>
  form.evaluate((element) =>
    Array.from(element.querySelectorAll("a, button, input, select, textarea"))
      .at(-1)
      ?.getAttribute("type"),
  );
const coarsePointer = (page: Page) => page.evaluate(() => matchMedia("(pointer: coarse)").matches);
const near = (actual: number, expected: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(0.5);
const linkToken = `${fixtureId}.${"x".repeat(43)}`;
for (const locale of ["en", "ru"] as const) {
  const en = locale === "en";
  const copy = {
    form: en ? "Sign in" : "Войти",
    email: en ? "Email" : "Электронная почта",
    password: en ? "Password" : "Пароль",
    newPassword: en ? "New password" : "Новый пароль",
    confirmation: en ? "Repeat new password" : "Повторите новый пароль",
    forgot: en ? "Forgot your password?" : "Забыли пароль?",
    show: en ? "Show password" : "Показать пароль",
    showRepeat: en ? "Show repeated password" : "Показать повтор пароля",
    back: en ? "Back to sign in" : "Ко входу",
    home: en ? "Home" : "На главную",
    notMember: en ? "Not in the company yet?" : "Ещё не в компании?",
    steps: en ? "Next steps" : "Следующие шаги",
  };
  test(`controlled ${locale} sign-in layout keeps the recovery link on the password label row, submit last and the application link below`, async ({
    page,
  }, info) => {
    await mocks(page);
    await page.goto("/login");
    await language(page, locale);
    const main = page.getByRole("main");
    const form = page.getByRole("form", { name: copy.form, exact: true });
    const email = form.getByLabel(copy.email, { exact: true });
    const password = form.getByLabel(copy.password, { exact: true });
    const forgot = form.getByRole("link", { name: copy.forgot, exact: true });
    const toggle = form.getByRole("button", { name: copy.show, exact: true });
    const submit = form.getByRole("button", { name: copy.form, exact: true });
    await expect(forgot).toHaveAttribute("href", "/password-recovery");
    const [forgotBox, passwordBox, labelBox, toggleBox] = await Promise.all([
      box(forgot),
      box(password),
      box(form.locator('label[for="login-password"]')),
      box(toggle),
    ]);
    expect(forgotBox.y + forgotBox.height).toBeLessThanOrEqual(passwordBox.y + 0.5);
    expect(
      Math.abs(forgotBox.x + forgotBox.width - (passwordBox.x + passwordBox.width)),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(forgotBox.y + forgotBox.height / 2 - (labelBox.y + labelBox.height / 2)),
    ).toBeLessThanOrEqual(4);
    expect(toggleBox.x).toBeGreaterThanOrEqual(passwordBox.x - 0.5);
    expect(toggleBox.y).toBeGreaterThanOrEqual(passwordBox.y - 0.5);
    expect(toggleBox.x + toggleBox.width).toBeLessThanOrEqual(
      passwordBox.x + passwordBox.width + 0.5,
    );
    expect(toggleBox.y + toggleBox.height).toBeLessThanOrEqual(
      passwordBox.y + passwordBox.height + 0.5,
    );
    const coarse = await coarsePointer(page);
    for (const control of [email, password, submit]) {
      const { height } = await box(control);
      if (coarse) expect(height).toBeGreaterThanOrEqual(40);
      else near(height, 32);
    }
    near(toggleBox.width, coarse ? 40 : 32);
    near(toggleBox.height, coarse ? 40 : 32);
    expect(forgotBox.height).toBeGreaterThanOrEqual(coarse ? 40 : 24);
    await email.focus();
    for (const next of [forgot, password, toggle, submit]) {
      await page.keyboard.press("Tab");
      await expect(next).toBeFocused();
    }
    expect(await lastControlType(form)).toBe("submit");
    const apply = main.getByRole("link", { name: publicContent[locale].apply, exact: true });
    await expect(apply).toHaveAttribute("href", en ? "/en#apply" : "/#apply");
    const formBox = await box(form);
    expect((await box(apply)).y).toBeGreaterThanOrEqual(formBox.y + formBox.height);
    await expect(main.getByText(copy.notMember, { exact: true })).toBeVisible();
    await expect(main.getByRole("link", { name: copy.home, exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    const brand = page.locator(".auth-brand");
    await expect(brand).toHaveAttribute("aria-hidden", "true");
    await expect(brand).toContainText(publicContent[locale].heading);
    if (info.project.name === "desktop-chromium") {
      await expect(brand).toBeVisible();
      expect((await box(brand)).x).toBeGreaterThanOrEqual(formBox.x + formBox.width);
    } else await expect(brand).toBeHidden();
    expect(await page.evaluate(() => document.body.textContent?.includes("Достаточно суров"))).toBe(
      false,
    );
    for (const reducedMotion of ["no-preference", "reduce"] as const) {
      await page.emulateMedia({ reducedMotion });
      expect(
        await brand.evaluate((element) =>
          [element, ...Array.from(element.querySelectorAll("*"))].every(
            (node) => getComputedStyle(node).animationName === "none",
          ),
        ),
      ).toBe(true);
    }
    await capture(page, info, `${locale}-login-layout`);
  });
  test(`controlled ${locale} in-field password toggles keep value, focus and autocomplete, mask on submit and follow the entry-screen pattern`, async ({
    page,
  }, info) => {
    await mocks(page);
    await page.route("**/api/v1/auth/login", (route) => route.fulfill(error(401)));
    await page.goto("/login");
    await language(page, locale);
    const main = page.getByRole("main");
    const form = page.getByRole("form", { name: copy.form, exact: true });
    const password = form.getByLabel(copy.password, { exact: true });
    const toggle = form.getByRole("button", { name: copy.show, exact: true });
    await expect(toggle).toHaveAttribute("aria-controls", "login-password");
    await expect(password).toHaveAttribute("id", "login-password");
    await password.fill("NONFUNCTIONAL_FIXTURE");
    const before = await box(password);
    await toggle.click();
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(password).toHaveAttribute("type", "text");
    await expect(password).toHaveValue("NONFUNCTIONAL_FIXTURE");
    await expect(password).toHaveAttribute("autocomplete", "current-password");
    await expect(password).toHaveAttribute("name", "password");
    await expect(password).toHaveAttribute("spellcheck", "false");
    const after = await box(password);
    for (const key of ["x", "y", "width", "height"] as const) near(after[key], before[key]);
    await page.keyboard.press("Space");
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(password).toHaveAttribute("type", "password");
    await toggle.click();
    await expect(password).toHaveAttribute("type", "text");
    await form.getByLabel(copy.email, { exact: true }).fill("member@example.invalid");
    await form.getByRole("button", { name: copy.form, exact: true }).click();
    await expect(form.getByRole("alert")).toBeVisible();
    await expect(password).toHaveAttribute("type", "password");
    await expect(password).toHaveValue("NONFUNCTIONAL_FIXTURE");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");

    await page.goto(`/password-reset?token=${linkToken}`);
    await language(page, locale);
    const back = main.getByRole("link", { name: copy.back, exact: true });
    await expect(back).toHaveAttribute("href", "/login");
    expect(await main.evaluate((element) => element.querySelector("a")?.textContent)).toBe(
      copy.back,
    );
    expect((await box(back)).y + (await box(back)).height).toBeLessThanOrEqual(
      (await box(page.getByRole("heading", { level: 1 }))).y,
    );
    const newPassword = main.getByLabel(copy.newPassword, { exact: true });
    const confirmation = main.getByLabel(copy.confirmation, { exact: true });
    const show = main.getByRole("button", { name: copy.show, exact: true });
    const showRepeat = main.getByRole("button", { name: copy.showRepeat, exact: true });
    for (const input of [newPassword, confirmation])
      await expect(input).toHaveAttribute("autocomplete", "new-password");
    await show.click();
    await expect(newPassword).toHaveAttribute("type", "text");
    await expect(confirmation).toHaveAttribute("type", "password");
    await expect(showRepeat).toHaveAttribute("aria-pressed", "false");
    await showRepeat.click();
    await expect(confirmation).toHaveAttribute("type", "text");
    await expect(show).toHaveAttribute("aria-pressed", "true");
    const hint = main.locator("#reset-password-hint");
    await expect(newPassword).toHaveAttribute("aria-describedby", /(^| )reset-password-hint( |$)/);
    const passwordBox = await box(newPassword);
    expect((await box(hint)).y).toBeGreaterThanOrEqual(passwordBox.y + passwordBox.height);
    await expect(main.getByRole("link", { name: copy.forgot, exact: true })).toHaveCount(0);
    await expect(
      main.getByRole("link", { name: publicContent[locale].apply, exact: true }),
    ).toHaveCount(0);
    await capture(page, info, `${locale}-reset`);

    await page.goto(`/invitation?token=${linkToken}`);
    await language(page, locale);
    await expect(main.getByRole("link", { name: copy.back, exact: true })).toHaveAttribute(
      "href",
      "/login",
    );
    await main.getByRole("button", { name: copy.showRepeat, exact: true }).click();
    await expect(main.getByLabel(copy.confirmation, { exact: true })).toHaveAttribute(
      "type",
      "text",
    );
    await expect(main.getByLabel(copy.newPassword, { exact: true })).toHaveAttribute(
      "type",
      "password",
    );
    const steps = main.getByRole("list", { name: copy.steps, exact: true });
    await expect(steps.getByRole("listitem")).toHaveText(
      en
        ? [
            "Set your account password",
            "Sign in with your invitation email",
            "Verify Steam ownership in Connections",
          ]
        : [
            "Задайте пароль аккаунта",
            "Войдите с почтой из приглашения",
            "Подтвердите Steam в разделе «Подключения»",
          ],
    );
    await expect(steps.getByRole("listitem").first()).toHaveAttribute("aria-current", "step");
    const accept = await box(
      main.getByRole("button", {
        name: en ? "Accept invitation" : "Принять приглашение",
        exact: true,
      }),
    );
    expect((await box(steps)).y).toBeGreaterThanOrEqual(accept.y + accept.height);
    await capture(page, info, `${locale}-invitation`);

    await page.goto("/password-reset");
    await language(page, locale);
    await expect(
      page.getByRole("heading", {
        name: en ? "This link is unavailable" : "Ссылка недоступна",
        exact: true,
      }),
    ).toBeVisible();
    await expect(main.getByRole("link", { name: copy.back, exact: true })).toBeVisible();
    await expect(
      main.getByRole("link", {
        name: en ? "Request password recovery" : "Запросить восстановление пароля",
        exact: true,
      }),
    ).toHaveAttribute("href", "/password-recovery");

    await page.goto("/password-recovery");
    await language(page, locale);
    await expect(main.getByRole("link", { name: copy.back, exact: true })).toHaveAttribute(
      "href",
      "/login",
    );
    const recovery = page.getByRole("form", {
      name: en ? "Request password recovery" : "Запросить восстановление пароля",
      exact: true,
    });
    expect(await lastControlType(recovery)).toBe("submit");
    await capture(page, info, `${locale}-recovery-form`);
  });
}
test("controlled uncertain invitation retry retains payload/key, pending prevents duplicates, expired result is safe", async ({
  page,
}) => {
  await mocks(page);
  const attempts: { key: string | undefined; body: string | null }[] = [];
  let count = 0;
  let release = () => {};
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/public/invitation-redemptions", async (route) => {
    attempts.push({
      key: route.request().headers()["idempotency-key"],
      body: route.request().postData(),
    });
    count++;
    if (count === 1) {
      await delayed;
      await route.abort("failed");
    } else await route.fulfill({ status: 201, json: receipt });
  });
  await page.goto(`/invitation?token=${fixtureId}.${"x".repeat(43)}`);
  await language(page, "en");
  await page.getByLabel("New password", { exact: true }).fill("NONFUNCTIONAL_FIXTURE");
  await page.getByLabel("Repeat new password", { exact: true }).fill("NONFUNCTIONAL_FIXTURE");
  await page.getByRole("button", { name: "Accept invitation", exact: true }).click();
  try {
    await expect(page.getByRole("button", { name: "Please wait…", exact: true })).toBeDisabled();
    await expect(page.getByLabel("New password", { exact: true })).toBeDisabled();
    await page
      .getByRole("form", { name: "Accept invitation", exact: true })
      .evaluate(async (element) => {
        if (!(element instanceof HTMLFormElement)) throw new Error("SYNTHETIC_FORM_MISSING");
        element.requestSubmit();
        element.requestSubmit();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      });
    expect(attempts).toHaveLength(1);
  } finally {
    release();
  }
  await expect(page.getByRole("alert")).toContainText("result could not be confirmed");
  await page.getByRole("button", { name: "Retry this action", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Account created", exact: true })).toBeVisible();
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  await page.route("**/api/v1/public/invitation-redemptions", (route) => route.fulfill(error(409)));
  await page.goto(`/invitation?token=${fixtureId}.${"x".repeat(43)}`);
  await language(page, "en");
  await page.getByLabel("New password", { exact: true }).fill("NONFUNCTIONAL_FIXTURE");
  await page.getByLabel("Repeat new password", { exact: true }).fill("NONFUNCTIONAL_FIXTURE");
  await page.getByRole("button", { name: "Accept invitation", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "This link is unavailable", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("PRIVATE_SENTINEL")).toHaveCount(0);
});
test("authenticated pending-email read401 evicts the account instead of retaining cached self", async ({
  page,
}) => {
  await mocks(page);
  const self = accountFixture();
  self.data.emailVerified = true;
  await page.route("**/api/v1/me", (route) =>
    route.fulfill({ json: self, headers: { ETag: '"v1"' } }),
  );
  await page.route("**/api/v1/me/email-change", (route) => route.fulfill(error(401)));
  await page.goto("/account");
  // Reach the terminal state first: the brief authenticated shell's user menu is about to unmount.
  await expect(
    page.getByRole("heading", {
      name: /^(Sign in to open your account|Войдите, чтобы открыть аккаунт)$/,
    }),
  ).toBeVisible();
  await language(page, "en");
  await expect(
    page.getByRole("heading", { name: "Sign in to open your account", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Fictional Yukon Member", { exact: true })).toHaveCount(0);
  await expect(page.locator(".account-address")).toHaveCount(0);
  await expect(page.getByRole("form", { name: "Request email change", exact: true })).toHaveCount(
    0,
  );
});
test("challenge replacement clears old confirmation fields while wrong-code retries preserve recoverable input", async ({
  page,
}) => {
  await mocks(page);
  const self = accountFixture();
  let generation = 16;
  const next = () => ({
    data: {
      ...challenge.data,
      id: `41000000-0000-4000-8000-${String(++generation).padStart(12, "0")}`,
    },
    meta,
  });
  await page.route("**/api/v1/me", (route) =>
    route.fulfill({ json: self, headers: { ETag: '"v1"' } }),
  );
  await page.route("**/api/v1/me/email-verification-requests", (route) =>
    route.fulfill({ status: 202, json: next() }),
  );
  await page.route("**/api/v1/me/email-verifications", (route) => route.fulfill(error(401)));
  await page.route("**/api/v1/me/credential-challenges", (route) =>
    route.fulfill({ status: 202, json: next() }),
  );
  await page.route("**/api/v1/me/credential-changes", (route) => route.fulfill(error(401)));
  await page.goto("/account");
  await expect(
    page.getByRole("heading", { name: "Account and security", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Request verification code", exact: true }).click();
  let form = page.getByRole("form", { name: "Confirm email verification", exact: true });
  await form.getByLabel("Email code", { exact: true }).fill("NONFUNCTIONAL_OLD_CODE");
  await form.getByRole("button", { name: "Confirm code", exact: true }).click();
  await expect(form.getByRole("alert")).toBeVisible();
  await expect(form.getByLabel("Email code", { exact: true })).toHaveValue(
    "NONFUNCTIONAL_OLD_CODE",
  );
  await page.getByRole("button", { name: "Request a new code", exact: true }).click();
  await expect(form.getByLabel("Email code", { exact: true })).toHaveValue("");
  self.data.emailVerified = true;
  await page.reload();
  await language(page, "en");
  await page.getByRole("button", { name: "Send code to current email", exact: true }).click();
  form = page.getByRole("form", { name: "Change password", exact: true });
  await form.getByLabel("Email code", { exact: true }).fill("NONFUNCTIONAL_OLD_CODE");
  await form.getByLabel("New password", { exact: true }).fill("NONFUNCTIONAL_PASSWORD");
  await form.getByLabel("Repeat new password", { exact: true }).fill("NONFUNCTIONAL_PASSWORD");
  await form.getByRole("button", { name: "Confirm password change", exact: true }).click();
  await expect(form.getByRole("alert")).toBeVisible();
  await expect(form.getByLabel("New password", { exact: true })).toHaveValue(
    "NONFUNCTIONAL_PASSWORD",
  );
  await page.getByRole("button", { name: "Request a new code", exact: true }).click();
  for (const label of ["Email code", "New password", "Repeat new password"])
    await expect(form.getByLabel(label, { exact: true })).toHaveValue("");
});

for (const readFailure of [false, true]) {
  test(`VTC019 ordering regression: email replacement fences command and pending read${readFailure ? " with recovery" : ""}`, async ({
    page,
  }) => {
    await mocks(page);
    const self = accountFixture();
    self.data.emailVerified = true;
    const replacementId = "41000000-0000-4000-8000-000000000071";
    const proposedId = "41000000-0000-4000-8000-000000000072";
    let pending = {
      id: fixtureId,
      stage: "current_email",
      proposedEmail: "replacement@example.invalid",
      expiresAt: challenge.data.expiresAt,
    };
    let releaseCommand = () => {},
      releaseRead = () => {},
      releaseStage = () => {},
      commandEntered = () => {},
      readEntered = () => {},
      stageEntered = () => {};
    const commandGate = new Promise<void>((resolve) => {
      releaseCommand = resolve;
    });
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const commandStarted = new Promise<void>((resolve) => {
      commandEntered = resolve;
    });
    const readStarted = new Promise<void>((resolve) => {
      readEntered = resolve;
    });
    const stageGate = new Promise<void>((resolve) => {
      releaseStage = resolve;
    });
    const stageStarted = new Promise<void>((resolve) => {
      stageEntered = resolve;
    });
    let replacementIssued = false,
      readHeld = false,
      stageHeld = false,
      failCommand = readFailure,
      confirmations = 0,
      matchingGeneration = false;
    let phase = "DISCOVERY";
    await page.route("**/api/v1/me", (route) =>
      route.fulfill({ json: self, headers: { ETag: '"v1"' } }),
    );
    await page.route("**/api/v1/me/email-change", async (route) => {
      if (replacementIssued && !readHeld) {
        readHeld = true;
        readEntered();
        await readGate;
        if (readFailure) return route.fulfill(error(503));
      }
      if (pending.stage === "proposed_email" && !stageHeld) {
        stageHeld = true;
        stageEntered();
        await stageGate;
      }
      return route.fulfill({ json: { data: { pending }, meta } });
    });
    await page.route("**/api/v1/me/credential-challenges", async (route) => {
      if (failCommand) {
        failCommand = false;
        return route.fulfill(error(503));
      }
      commandEntered();
      await commandGate;
      replacementIssued = true;
      pending = { ...pending, id: replacementId };
      return route.fulfill({
        status: 202,
        json: { ...challenge, data: { ...challenge.data, id: replacementId } },
      });
    });
    await page.route("**/api/v1/me/credential-changes", (route) => {
      confirmations++;
      const body = route.request().postDataJSON();
      matchingGeneration = body.challengeId === replacementId;
      if (body.code !== "NONFUNCTIONAL_NEW_CODE") return route.fulfill(error(401));
      pending = { ...pending, id: proposedId, stage: "proposed_email" };
      return route.fulfill({
        status: 202,
        json: { ...challenge, data: { ...challenge.data, id: proposedId } },
      });
    });
    try {
      await page.goto("/account");
      await expect(
        page.getByRole("heading", { name: "Account and security", exact: true }),
      ).toBeVisible();
      const request = page.getByRole("form", { name: "Request email change", exact: true });
      const confirm = page.getByRole("form", {
        name: "Confirm email replacement stage",
        exact: true,
      });
      const code = confirm.getByLabel("Email code", { exact: true });
      await code.fill("NONFUNCTIONAL_OLD_CODE");
      await request.getByLabel("Proposed email", { exact: true }).fill(pending.proposedEmail);
      phase = "COMMAND_PENDING";
      if (readFailure) {
        await request
          .getByRole("button", { name: "Replace pending email request", exact: true })
          .click();
        await expect(request.getByRole("alert")).toBeVisible();
        await expect(code).toBeEnabled();
        await expect(code).toHaveValue("NONFUNCTIONAL_OLD_CODE");
      }
      await request
        .getByRole("button", {
          name: readFailure ? "Retry this action" : "Replace pending email request",
          exact: true,
        })
        .click();
      await commandStarted;
      await expect(request.getByLabel("Proposed email", { exact: true })).toBeDisabled();
      const commandBlockedConfirmation = await code.isDisabled();
      releaseCommand();
      await readStarted;
      phase = "PENDING_FENCE";
      await expect(code).toBeDisabled();
      await expect(
        confirm.getByRole("button", { name: /^(Please wait…|Confirm this email code)$/ }),
      ).toBeDisabled();
      await expect(request.getByLabel("Proposed email", { exact: true })).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "Refresh pending request", exact: true }),
      ).toBeDisabled();
      expect(confirmations).toBe(0);
      releaseRead();
      if (readFailure) {
        phase = "READ_RECOVERY";
        await expect(
          page.getByText("Pending email replacement could not be checked.", { exact: true }),
        ).toBeVisible();
        await expect(confirm).toHaveCount(0);
        await expect(request.getByLabel("Proposed email", { exact: true })).toHaveValue(
          pending.proposedEmail,
        );
        await page.getByRole("button", { name: "Check again", exact: true }).click();
      }
      phase = "GENERATION_READY";
      await expect(code).toBeEnabled();
      await expect(code).toHaveValue("");
      expect(commandBlockedConfirmation).toBe(true);
      phase = "WRONG_CODE";
      await code.fill("NONFUNCTIONAL_WRONG_CODE");
      await confirm.getByRole("button", { name: "Confirm this email code", exact: true }).click();
      await expect(confirm.getByRole("alert")).toBeVisible();
      await expect(code).toHaveValue("NONFUNCTIONAL_WRONG_CODE");
      await expect(
        page.getByRole("heading", { name: "Account and security", exact: true }),
      ).toBeVisible();
      phase = "NEW_STAGE";
      await code.fill("NONFUNCTIONAL_NEW_CODE");
      await confirm.getByRole("button", { name: "Retry this action", exact: true }).click();
      await stageStarted;
      await expect(code).toBeDisabled();
      await expect(request.getByLabel("Proposed email", { exact: true })).toBeDisabled();
      releaseStage();
      await expect(page.getByText(/Current email confirmed/)).toBeVisible();
      await expect(code).toHaveValue("");
      expect(matchingGeneration).toBe(true);
      expect(confirmations).toBe(2);
      await expect(page.locator(".account-address")).toHaveText(self.data.email);
    } catch {
      throw new Error(`VTC019_EMAIL_${readFailure ? "RECOVERY" : "SUCCESS"}_${phase}_FAILED`);
    } finally {
      releaseCommand();
      releaseRead();
      releaseStage();
    }
  });
}
test("controlled account preferences conflict requires refresh/review, wrong codes preserve session, outage and revoked access hide private content", async ({
  page,
}, info) => {
  await mocks(page);
  let self = accountFixture();
  let status = 200;
  let version = 1;
  await page.route("**/api/v1/me", (route) =>
    route.fulfill(
      status === 200 ? { json: self, headers: { ETag: `"v${version}"` } } : error(status),
    ),
  );
  await page.route("**/api/v1/me/email-verification-requests", (route) =>
    route.fulfill({ status: 202, json: challenge }),
  );
  await page.route("**/api/v1/me/email-verifications", (route) => route.fulfill(error(401)));
  let conflicts = true;
  await page.route("**/api/v1/me/preferences", (route) => {
    if (conflicts) {
      version++;
      self = {
        ...self,
        data: { ...self.data, preferences: { locale: "en", displayTimezone: "Europe/Warsaw" } },
      };
      return route.fulfill(error(409));
    }
    expect(route.request().headers()["if-match"]).toBe(`"v${version}"`);
    self.data.preferences = route.request().postDataJSON();
    version++;
    return route.fulfill({ json: { data: self.data.preferences, meta } });
  });
  await page.goto("/account");
  await expect(
    page.getByRole("heading", { name: "Account and security", exact: true }),
  ).toBeVisible();
  await capture(page, info, "en-account");
  await language(page, "ru");
  await capture(page, info, "ru-account");
  await language(page, "en");
  const prefs = page.getByRole("form", { name: "Preferences", exact: true });
  await prefs.getByRole("button", { name: "Save preferences" }).click();
  await page.getByRole("button", { name: "Refresh preferences for review" }).click();
  await expect(page.getByText(/Preferences changed elsewhere/)).toBeVisible();
  await expect(page.getByLabel("Display timezone", { exact: true })).toHaveValue("Europe/Warsaw");
  conflicts = false;
  await page.getByLabel("Display timezone", { exact: true }).fill("UTC");
  await page
    .getByRole("form", { name: "Preferences", exact: true })
    .getByRole("button", { name: "Save preferences", exact: true })
    .click();
  await expect(page.getByText("Preferences saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Request verification code", exact: true }).click();
  const form = page.getByRole("form", { name: "Confirm email verification", exact: true });
  await form.getByLabel("Email code", { exact: true }).fill("NONFUNCTIONAL_WRONG_CODE");
  await form.getByRole("button", { name: "Confirm code", exact: true }).click();
  await expect(form.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Account and security", exact: true }),
  ).toBeVisible();
  status = 503;
  await page.goto("/account");
  await language(page, "en");
  await expect(
    page.getByRole("heading", { name: "Session check unavailable", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Fictional Yukon Member", { exact: true })).toHaveCount(0);
  status = 401;
  await page.getByRole("button", { name: "Check again", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Sign in to open your account", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("member@example.invalid", { exact: true })).toHaveCount(0);
});
test("controlled current capabilities expose role-grouped workspace navigation equally for trainee/driver and staff destinations without deputy succession", async ({
  page,
}) => {
  await mocks(page);
  const destinations: Record<string, (string | null)[]> = {};
  for (const roles of [
    ["trainee"],
    ["driver"],
    ["driver", "dispatcher"],
    ["driver", "deputy_director"],
  ] as const) {
    const self = accountFixture();
    self.data.member.roles = [...roles];
    self.data.capabilities = [
      "company.read",
      "trips.submit_own",
      ...(roles.includes("dispatcher" as never) || roles.includes("deputy_director" as never)
        ? ["trips.review"]
        : []),
      ...(roles.includes("deputy_director" as never) ? ["applications.manage"] : []),
    ];
    await page.route("**/api/v1/me", (route) =>
      route.fulfill({ json: self, headers: { ETag: '"v1"' } }),
    );
    await page.goto("/account");
    await expect(
      page.getByRole("heading", { name: "Account and security", exact: true }),
    ).toBeVisible();
    const report = page
      .getByRole("link", { name: "New report", exact: true })
      .filter({ visible: true });
    // Phones show New report in the bottom bar and the other sections in the More sheet.
    if (phone(page)) {
      await expect(report).toBeVisible();
      await openMoreSheet(page);
    } else {
      const menu = page.getByRole("button", { name: "Open navigation" });
      if (await menu.isVisible()) await menu.click();
    }
    const navigation = page.getByRole("navigation", { name: "Main navigation", exact: true });
    await expect(navigation.getByRole("link", { name: "Drafts", exact: true })).toBeVisible();
    if (!phone(page)) await expect(report).toBeVisible();
    await expect(page.getByText(/Leadership transfer/)).toHaveCount(0);
    await expect(navigation.getByRole("link", { name: "Dispatch", exact: true })).toHaveCount(
      self.data.capabilities.includes("trips.review") ? 1 : 0,
    );
    await expect(navigation.getByRole("link", { name: "Applications", exact: true })).toHaveCount(
      self.data.capabilities.includes("applications.manage") ? 1 : 0,
    );
    destinations[roles.join("+")] = await navigation
      .getByRole("link")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    if (await page.getByRole("dialog").isVisible()) await page.keyboard.press("Escape");
  }
  expect(destinations.trainee).toEqual(destinations.driver);
});
test("confirmed anonymous sessions can recover a new shared-cookie session on focus without restoring old identity data or looping", async ({
  page,
}) => {
  await mocks(page);
  let status = 401;
  let reads = 0;
  const self = accountFixture();
  self.data.member.nickname = "Fictional Recovered Member";
  await page.route("**/api/v1/me", (route) => {
    reads++;
    return route.fulfill(
      status === 200 ? { json: self, headers: { ETag: '"v1"' } } : error(status),
    );
  });
  await page.goto("/account");
  await language(page, "en");
  await expect(
    page.getByRole("heading", { name: "Sign in to open your account", exact: true }),
  ).toBeVisible();
  expect(reads).toBe(1);
  status = 200;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("heading", { name: "Account and security", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("main").getByText("Fictional Recovered Member", { exact: true }),
  ).toBeVisible();
  status = 401;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("heading", { name: "Sign in to open your account", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Fictional Recovered Member", { exact: true })).toHaveCount(0);
  const before = reads;
  status = 200;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(
    page.getByRole("heading", { name: "Account and security", exact: true }),
  ).toBeVisible();
  expect(reads).toBe(before + 1);
});
for (const held of ["probe", "command"] as const) {
  test(`old logout ${held} cannot end B or start an unowned probe after shared-cookie identity switching`, async ({
    page,
  }) => {
    await mocks(page);
    const first = accountFixture();
    first.data.member.nickname = "Fictional Member A";
    const second = accountFixture();
    second.data.member.id = "41000000-0000-4000-8000-000000000018";
    second.data.member.nickname = "Fictional Member B";
    let current = first;
    let logoutStarted = false;
    let reads = 0;
    let probes = 0;
    let heldRequest: Request | undefined;
    let release = () => {};
    let started = () => {};
    let handled = () => {};
    let settled = () => {};
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    const delayed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handlerFinished = new Promise<void>((resolve) => {
      handled = resolve;
    });
    const requestSettled = new Promise<void>((resolve) => {
      settled = resolve;
    });
    const onSettled = (request: Request) => {
      if (request === heldRequest) settled();
    };
    page.on("requestfinished", onSettled);
    page.on("requestfailed", onSettled);
    await page.route("**/api/v1/me", async (route) => {
      reads++;
      if (current === first && logoutStarted) {
        probes++;
        heldRequest = route.request();
        started();
        await delayed;
        await route.fulfill(error(401)).catch(() => {});
        handled();
      } else await route.fulfill({ json: current, headers: { ETag: '"v1"' } });
    });
    await page.route("**/api/v1/auth/logout", async (route) => {
      logoutStarted = true;
      if (held === "command") {
        heldRequest = route.request();
        started();
        await delayed;
      }
      await route.fulfill(error(503)).catch(() => {});
      if (held === "command") handled();
    });
    try {
      await page.goto("/account");
      await expect(
        page.getByRole("main").getByText("Fictional Member A", { exact: true }),
      ).toBeVisible();
      await signOutFromMenu(page);
      await began;
      expect(probes).toBe(held === "probe" ? 1 : 0);
      const beforeSwitch = reads;
      current = second;
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(
        page.getByRole("main").getByText("Fictional Member B", { exact: true }),
      ).toBeVisible();
      const timezone = page.getByLabel("Display timezone", { exact: true });
      await timezone.fill("Europe/Warsaw");
      release();
      await Promise.all([handlerFinished, requestSettled]);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await expect(
        page.getByRole("main").getByText("Fictional Member B", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Account and security", exact: true }),
      ).toBeVisible();
      await expect(timezone).toHaveValue("Europe/Warsaw");
      await expect(page.getByText("Fictional Member A", { exact: true })).toHaveCount(0);
      // Focus discovers B, then the new access generation confirms B. Disposed A owns no read.
      expect(reads).toBe(beforeSwitch + 2);
      expect(probes).toBe(held === "probe" ? 1 : 0);
    } finally {
      release();
      page.off("requestfinished", onSettled);
      page.off("requestfailed", onSettled);
    }
  });
}
test("late private reads from A cannot appear after rendered logout and B login in the same app cache", async ({
  page,
}) => {
  await mocks(page);
  const first = accountFixture();
  first.data.emailVerified = true;
  first.data.member.nickname = "Fictional Member A";
  const second = accountFixture();
  second.data.member.id = "41000000-0000-4000-8000-000000000018";
  second.data.member.nickname = "Fictional Member B";
  let current = first;
  let release = () => {};
  let started = () => {};
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/me", (route) =>
    route.fulfill({ json: current, headers: { ETag: '"v1"' } }),
  );
  await page.route("**/api/v1/me/email-change", async (route) => {
    if (current === first) {
      started();
      await delayed;
      await route
        .fulfill({
          json: {
            data: {
              pending: {
                id: fixtureId,
                proposedEmail: "private-a@example.invalid",
                expiresAt: "2099-10-19T12:00:00.000Z",
                stage: "proposed_email",
              },
            },
            meta,
          },
        })
        .catch(() => {});
    } else await route.fulfill({ json: { data: { pending: null }, meta } });
  });
  await page.route("**/api/v1/auth/logout", (route) => route.fulfill({ json: receipt }));
  await page.route("**/api/v1/auth/login", (route) => {
    current = second;
    return route.fulfill({ json: second, headers: { ETag: '"v1"' } });
  });
  try {
    await page.goto("/account");
    await began;
    await expect(
      page.getByRole("main").getByText("Fictional Member A", { exact: true }),
    ).toBeVisible();
    await signOutFromMenu(page);
    await expect(
      page.getByRole("heading", { name: "Sign in to open your account", exact: true }),
    ).toBeVisible();
    await page.getByRole("main").getByRole("link", { name: "Sign in", exact: true }).click();
    await page.getByLabel("Email", { exact: true }).fill("member-b@example.invalid");
    await page.getByLabel("Password", { exact: true }).fill("NONFUNCTIONAL_FIXTURE");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    // The main sign-in link records the protected page it came from, so B returns to Account.
    await expect(page).toHaveURL(/\/account$/);
    await expect(
      page.getByRole("heading", { name: "Account and security", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("main").getByText("Fictional Member B", { exact: true }),
    ).toBeVisible();
    release();
    await expect(page.getByText("Fictional Member A", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/private-a@example.invalid/)).toHaveCount(0);
  } finally {
    release();
  }
});
