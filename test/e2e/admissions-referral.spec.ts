import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { resetAccountLimits, staffContext } from "./support/account.ts";
import { box, brokenWords, noOverflow } from "./support/application-checks.ts";
import { catalogLanguage } from "./support/catalogs.ts";
import { browserCase, expect, test } from "./support/fixtures.ts";

// VTC-149: the optional "How did you hear about us?" answer on the public application form.
// Mocked cases stub only the public routes; fictional applicant data throughout.
// Manual captures show controlled public states only; real HTTP material is never traced.
test.use({ trace: "off", screenshot: "off", video: "off" });
test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/public/events?*", (route) =>
    route.fulfill({
      json: { data: { items: [], nextCursor: null }, meta: { requestId: "synthetic-referral" } },
    }),
  );
  await page.route("**/api/v1/public/company-stats", (route) =>
    route.fulfill({
      status: 404,
      json: {
        error: { code: "NOT_FOUND", messageKey: "errors.synthetic", retryable: false },
        meta: { requestId: "synthetic-referral" },
      },
    }),
  );
});
const text = {
  en: {
    source: "How did you hear about us? (optional)",
    other: "Where exactly (optional)",
    submit: "Send application",
    sent: "Submission acknowledged",
    nickname: "Nickname",
    email: "Invitation email",
    steam: "Steam profile link",
  },
  ru: {
    source: "Откуда узнали о нас (необязательно)",
    other: "Где именно (необязательно)",
    submit: "Отправить заявку",
    sent: "Отправка подтверждена",
    nickname: "Никнейм",
    email: "Email для приглашения",
    steam: "Ссылка на профиль Steam",
  },
} as const;
async function fill(page: Page, locale: "en" | "ru" = "en", email = "applicant@example.invalid") {
  const s = text[locale];
  await page.getByRole("textbox", { name: s.nickname, exact: true }).fill("Fictional Applicant");
  await page.getByRole("textbox", { name: s.email, exact: true }).fill(email);
  await page
    .getByRole("textbox", { name: s.steam, exact: true })
    .fill("https://steamcommunity.com/id/fictional-driver");
  await page.getByRole("checkbox", { name: "ETS2", exact: true }).check();
}
/** Stubs CSRF and the public POST; returns the JSON payloads that were sent. */
async function capture(page: Page) {
  const payloads: Record<string, unknown>[] = [];
  await page.route("**/api/v1/auth/csrf", (route) =>
    route.fulfill({
      json: { data: { token: "NONFUNCTIONAL_FIXTURE" }, meta: { requestId: "synthetic-referral" } },
    }),
  );
  await page.route("**/api/v1/public/applications", (route) => {
    payloads.push(route.request().postDataJSON());
    return route.fulfill({
      status: 201,
      json: {
        data: { id: "41000000-0000-4000-8000-000000000001", version: 1 },
        meta: { requestId: "synthetic-referral" },
      },
    });
  });
  return payloads;
}
const source = (page: Page, locale: "en" | "ru" = "en") =>
  page.getByRole("combobox", { name: text[locale].source, exact: true });
const other = (page: Page, locale: "en" | "ru" = "en") =>
  page.getByRole("textbox", { name: text[locale].other, exact: true });
async function submit(page: Page) {
  await page.getByRole("button", { name: text.en.submit, exact: true }).click();
}

test(
  "R1 an unanswered question sends no referral keys",
  browserCase(["@functional"]),
  async ({ page }) => {
    const payloads = await capture(page);
    await page.goto("/en");
    await fill(page);
    await expect(source(page)).toHaveValue("");
    await expect(other(page)).toHaveCount(0);
    await submit(page);
    await expect(page.getByRole("status")).toContainText(text.en.sent);
    expect(payloads).toHaveLength(1);
    expect(Object.keys(payloads[0] ?? {}).filter((key) => key.startsWith("referral"))).toEqual([]);
  },
);

test(
  "R2 a listed source is sent alone without the free-text field",
  browserCase(["@functional"]),
  async ({ page }) => {
    const payloads = await capture(page);
    await page.goto("/en");
    await fill(page);
    await expect(source(page).locator("option")).toHaveText([
      "Not selected",
      "TruckersMP",
      "Discord",
      "From a friend or member",
      "YouTube or Twitch",
      "Other",
    ]);
    await source(page).selectOption("friend_or_member");
    await expect(other(page)).toHaveCount(0);
    await submit(page);
    await expect(page.getByRole("status")).toContainText(text.en.sent);
    expect(payloads[0]?.referralSource).toBe("friend_or_member");
    expect(payloads[0]).not.toHaveProperty("referralOther");
  },
);

test(
  "R3 Other shows a counted field whose untrimmed text is sent",
  browserCase(["@functional"]),
  async ({ page }) => {
    const payloads = await capture(page);
    await page.goto("/en");
    await fill(page);
    await source(page).selectOption("other");
    await expect(other(page)).toBeVisible();
    await expect(other(page)).toHaveAccessibleDescription("0 of 200 characters");
    await other(page).fill(" Fictional convoy poster ");
    await expect(other(page)).toHaveAccessibleDescription("25 of 200 characters");
    await submit(page);
    await expect(page.getByRole("status")).toContainText(text.en.sent);
    expect(payloads[0]).toMatchObject({
      referralSource: "other",
      referralOther: " Fictional convoy poster ",
    });
  },
);

test(
  "R3 switching away from Other hides the text and does not send it",
  browserCase(["@functional"]),
  async ({ page }) => {
    const payloads = await capture(page);
    await page.goto("/en");
    await fill(page);
    await source(page).selectOption("other");
    await other(page).fill("Fictional convoy poster");
    await source(page).selectOption("discord");
    await expect(other(page)).toHaveCount(0);
    await submit(page);
    await expect(page.getByRole("status")).toContainText(text.en.sent);
    expect(payloads[0]?.referralSource).toBe("discord");
    expect(payloads[0]).not.toHaveProperty("referralOther");
  },
);

test(
  "R3 Other with blank text sends only the source, even past the limit",
  browserCase(["@functional"]),
  async ({ page }) => {
    const payloads = await capture(page);
    await page.goto("/en");
    await fill(page);
    await source(page).selectOption("other");
    // Blank text is dropped rather than rejected, so it is never marked over the limit.
    await other(page).fill(" ".repeat(201));
    await expect(other(page)).toHaveAccessibleDescription("201 of 200 characters");
    await expect(page.locator("#referral-count")).not.toHaveClass(/field-error/);
    await other(page).fill("\ufeff".repeat(201));
    await expect(page.locator("#referral-count")).not.toHaveClass(/field-error/);
    await other(page).fill("   ");
    await submit(page);
    await expect(page.getByRole("status")).toContainText(text.en.sent);
    expect(payloads[0]?.referralSource).toBe("other");
    expect(payloads[0]).not.toHaveProperty("referralOther");
  },
);

test(
  "R4 the 200-character limit counts code points and blocks a longer answer",
  browserCase(["@functional"]),
  async ({ page }) => {
    const payloads = await capture(page);
    await page.goto("/en");
    await fill(page);
    await source(page).selectOption("other");
    await other(page).fill("x".repeat(201));
    await expect(other(page)).toHaveAccessibleDescription("201 of 200 characters");
    await expect(page.locator("#referral-count")).toHaveClass(/field-error/);
    await submit(page);
    await expect(page.locator("#referralOther-error")).toHaveText(
      "Where exactly must be at most 200 characters, without control characters.",
    );
    await expect(other(page)).toBeFocused();
    await expect(other(page)).toHaveAttribute("aria-invalid", "true");
    expect(payloads).toHaveLength(0);
    await other(page).fill("x".repeat(200));
    await expect(other(page)).toHaveAccessibleDescription(/^200 of 200 characters/);
    await expect(page.locator("#referral-count")).not.toHaveClass(/field-error/);
    const truck = "\u{1f69a}".repeat(200);
    await other(page).fill(truck);
    await expect(page.locator("#referral-count")).toHaveText("200 of 200 characters");
    await submit(page);
    await expect(page.getByRole("status")).toContainText(text.en.sent);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]?.referralOther).toBe(truck);
  },
);

for (const locale of ["en", "ru"] as const)
  test(
    `R5 ${locale} the referral fields fit the application card at every width`,
    browserCase(["@layout"]),
    async ({ page }, info) => {
      await page.goto(locale === "en" ? "/en" : "/");
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await source(page, locale).selectOption("other");
      await other(page, locale).fill(
        "Fictional convoy poster at the Kassel rest stop, shared in a long community thread",
      );
      const card = page.locator(".application-card"),
        fields = await box(card.locator(".application-fields"));
      for (const control of [source(page, locale), other(page, locale)]) {
        const field = await box(control);
        expect(Math.abs(field.width - fields.width)).toBeLessThanOrEqual(1);
      }
      const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
      expect((await box(source(page, locale))).height).toBeGreaterThanOrEqual(coarse ? 39.5 : 31.5);
      await noOverflow(page);
      expect(await brokenWords(card)).toEqual([]);
      await page.evaluate(() => document.fonts.ready);
      await card.screenshot({ path: info.outputPath(`referral-form-${locale}.png`) });
    },
  );

test.describe("real referral submission", () => {
  test.beforeEach(resetAccountLimits);
  test(
    "R6 an Other answer reaches the staff detail with the vanity link left unchecked",
    browserCase(["@real"]),
    async ({ page }) => {
      const nickname = `Fictional Referral ${randomUUID().slice(0, 8)}`;
      await page.goto("/en");
      await fill(page, "en", `${randomUUID()}@example.invalid`);
      await page.getByRole("textbox", { name: text.en.nickname, exact: true }).fill(nickname);
      await source(page).selectOption("other");
      await other(page).fill(" Fictional convoy poster ");
      const sent = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/public/applications") &&
          response.request().method() === "POST",
      );
      await submit(page);
      expect((await sent).status()).toBe(201);
      await expect(page.getByRole("status")).toContainText(text.en.sent);
      const staff = await staffContext();
      try {
        await page.context().addCookies((await staff.storageState()).cookies);
        await page.goto("/account/admin/applications?status=submitted");
        await catalogLanguage(page);
        await page.getByRole("button", { name: nickname, exact: true }).click();
        const detail = page.locator(".applications-detail");
        await expect(detail.getByRole("heading", { level: 2, name: nickname })).toBeVisible();
        await expect(detail).toContainText("Other: « Fictional convoy poster »");
        await expect(detail.locator(".applications-check")).toContainText(
          "not checked: the Steam link has no SteamID",
        );
        await expect(detail.locator(".applications-check").getByRole("button")).toHaveCount(0);
      } finally {
        await staff.dispose();
      }
    },
  );
});
