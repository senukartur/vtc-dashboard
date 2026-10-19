import type { Page, Request, TestInfo } from "@playwright/test";
import { accountFixture, fixtureId } from "../../apps/web/src/features/account/fixtures.ts";
import { expect, test } from "./support/fixtures.ts";
const meta = { requestId: "synthetic-request" };
const receipt = { data: { id: fixtureId, version: 2 }, meta };
const challenge = {
  data: { id: fixtureId, expiresAt: "2099-10-19T12:00:00.000Z", state: "pending" },
  meta,
};
const error = (status: number) => ({ status, json: { error: { code: "PRIVATE_SENTINEL" } } });
async function mocks(page: Page) {
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/auth/csrf")
      return route.fulfill({ json: { data: { token: "NONFUNCTIONAL_FIXTURE" }, meta } });
    if (path === "/api/v1/me") return route.fulfill(error(401));
    if (path === "/api/v1/me/email-change")
      return route.fulfill({ json: { data: { pending: null }, meta } });
    return route.fulfill(error(503));
  });
}
async function language(page: Page, locale: "ru" | "en") {
  await page
    .getByRole("banner")
    .getByRole("combobox", { name: /^(Language|Язык)$/ })
    .selectOption(locale);
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
}
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
    await form.getByRole("button", { name: /^(Show:|Показать:)/ }).click();
    await expect(password).toHaveAttribute("type", "text");
    await page
      .getByRole("banner")
      .getByRole("combobox")
      .selectOption(locale === "en" ? "ru" : "en");
    await expect(
      page.getByLabel(locale === "en" ? "Пароль" : "Password", { exact: true }),
    ).toHaveValue("NONFUNCTIONAL_FIXTURE");
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
  await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();
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
test("controlled current capabilities filter unavailable navigation equally for trainee/driver and add staff destinations without deputy succession", async ({
  page,
}) => {
  await mocks(page);
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
    await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();
    const menu = page.getByRole("button", { name: "Open navigation" });
    if (await menu.isVisible()) await menu.click();
    await expect(
      page.getByText("Trip reports · Unavailable", { exact: true }).filter({ visible: true }),
    ).toBeVisible();
    await expect(page.getByText("Leadership transfer · Unavailable", { exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByRole("link", { name: "Report review" })).toHaveCount(0);
    if (await page.getByRole("dialog").isVisible()) await page.keyboard.press("Escape");
  }
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
  await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();
  await expect(page.getByText("Fictional Recovered Member", { exact: true })).toBeVisible();
  status = 401;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("heading", { name: "Sign in to open your account", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Fictional Recovered Member", { exact: true })).toHaveCount(0);
  const before = reads;
  status = 200;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();
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
      await expect(page.getByText("Fictional Member A", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await began;
      expect(probes).toBe(held === "probe" ? 1 : 0);
      const beforeSwitch = reads;
      current = second;
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(page.getByText("Fictional Member B", { exact: true })).toBeVisible();
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
      await expect(page.getByText("Fictional Member B", { exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();
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
    await expect(page.getByText("Fictional Member A", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Sign in to open your account", exact: true }),
    ).toBeVisible();
    await page.getByRole("main").getByRole("link", { name: "Sign in", exact: true }).click();
    await page.getByLabel("Email", { exact: true }).fill("member-b@example.invalid");
    await page.getByLabel("Password", { exact: true }).fill("NONFUNCTIONAL_FIXTURE");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("Fictional Member B", { exact: true })).toBeVisible();
    release();
    await expect(page.getByText("Fictional Member A", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/private-a@example.invalid/)).toHaveCount(0);
  } finally {
    release();
  }
});
