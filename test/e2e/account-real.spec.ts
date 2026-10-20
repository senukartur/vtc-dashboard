import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import type { components } from "@vtc/contracts";
import {
  accountSecret,
  approveInvitation,
  createInvitation,
  deactivateFixtureMember,
  expireFixtureInvitation,
  origin,
  privateMail,
  resetAccountLimits,
  staffContext,
  write,
} from "./support/account.ts";
import { expect, test } from "./support/fixtures.ts";

test.use({ trace: "off", screenshot: "off", video: "off" });
test.beforeEach(resetAccountLimits);
async function english(page: Page) {
  await page
    .getByRole("banner")
    .getByRole("combobox", { name: /^(Language|Язык)$/ })
    .selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
}
async function replacePendingEmail(page: Page) {
  const confirmation = page.getByRole("form", {
    name: "Confirm email replacement stage",
    exact: true,
  });
  await confirmation.getByLabel("Email code", { exact: true }).fill("NONFUNCTIONAL_REPLACED_INPUT");
  const command = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/me/credential-challenges") &&
      response.request().method() === "POST",
  );
  const pending = page.waitForResponse(async (response) => {
    if (
      !response.url().endsWith("/api/v1/me/email-change") ||
      response.request().method() !== "GET" ||
      response.status() !== 200
    )
      return false;
    const issued = await command;
    if (issued.status() !== 202) return false;
    return (await response.json()).data.pending?.id === (await issued.json()).data.id;
  });
  await page
    .getByRole("form", { name: "Request email change", exact: true })
    .getByRole("button", { name: "Replace pending email request", exact: true })
    .click();
  const issued = await command;
  expect(issued.status()).toBe(202);
  const challengeId = (await issued.json()).data.id as string;
  await pending;
  await expect(confirmation.getByLabel("Email code", { exact: true })).toBeEnabled();
  await expect(confirmation.getByLabel("Email code", { exact: true })).toHaveValue("");
  return challengeId;
}
async function redeem(page: Page, link: string, password: string, uncertain = false) {
  await page.goto(link);
  await english(page);
  await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
  await page.getByLabel("New password", { exact: true }).fill(password);
  await page.getByLabel("Repeat new password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Accept invitation", exact: true }).click();
  if (uncertain) {
    await expect(page.getByRole("alert")).toContainText("result could not be confirmed");
    await page.getByRole("button", { name: "Retry this action", exact: true }).click();
  }
  await expect(page.getByRole("heading", { name: "Account created", exact: true })).toBeVisible();
}
async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await english(page);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  const response = page.waitForResponse(
    (result) => result.url().endsWith("/api/v1/auth/login") && result.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const authenticated = await response;
  expect(authenticated.status()).toBe(200);
  const self = (await authenticated.json()).data as components["schemas"]["Self"];
  await expect(
    page.getByRole("heading", { name: /^(Account|Аккаунт)$/, exact: true }),
  ).toBeVisible();
  await english(page);
  return self;
}
async function verify(page: Page, userId: string) {
  await page.getByRole("button", { name: "Request verification code", exact: true }).click();
  await expect(
    page.getByRole("form", { name: "Confirm email verification", exact: true }),
  ).toBeVisible();
  const mail = await privateMail(userId, "email_verification");
  const form = page.getByRole("form", { name: "Confirm email verification", exact: true });
  await form.getByLabel("Email code", { exact: true }).fill(mail.code);
  await form.getByRole("button", { name: "Confirm code", exact: true }).click();
  await expect(page.getByText("Your current email is verified.", { exact: true })).toBeVisible();
}
test("real rendered application, invitation, login, wrong verification code, preferences and logout", async ({
  page,
  context,
}) => {
  test.setTimeout(60000);
  let phase = "START";
  const staff = await staffContext();
  try {
    const email = `${randomUUID()}@example.invalid`,
      password = accountSecret("password");
    phase = "APPLICATION";
    await page.goto("/en");
    await page.getByLabel("Nickname", { exact: true }).fill("Fictional Account Member");
    await page.getByLabel("Invitation email", { exact: true }).fill(email);
    await page
      .getByLabel("Steam profile link", { exact: true })
      .fill("https://steamcommunity.com/id/fictional-account");
    await page.getByLabel("ETS2", { exact: true }).check();
    await page.getByRole("button", { name: "Send application", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Submission acknowledged");
    const invitation = await approveInvitation(staff, email);
    phase = "REDEMPTION";
    let attempts = 0;
    let original: { key: string | undefined; payload: string | null; receipt: string } | undefined;
    await page.route("**/api/v1/public/invitation-redemptions", async (route) => {
      const response = await route.fetch({ timeout: 5000 }).catch(() => {
        throw new Error("ACCOUNT_REDEMPTION_REPLAY_REQUEST_FAILED");
      });
      expect(response.status()).toBe(201);
      const request = route.request();
      const receipt = (await response.json()).data.id as string;
      attempts++;
      if (attempts === 1) {
        original = {
          key: request.headers()["idempotency-key"],
          payload: request.postData(),
          receipt,
        };
        await route.abort("failed");
      } else {
        expect(request.headers()["idempotency-key"] === original?.key).toBe(true);
        expect(request.postData() === original?.payload).toBe(true);
        expect(receipt === original?.receipt).toBe(true);
        await route.fulfill({ response });
      }
    });
    await redeem(page, invitation.link, password, true);
    expect(attempts).toBe(2);
    expect(new URL(page.url()).search === "").toBe(true);
    expect((await context.request.get("/api/v1/me")).status()).toBe(401);
    phase = "LOGIN";
    const me = await login(page, email, password);
    expect(me.emailVerified === false && me.member.roles.includes("trainee")).toBe(true);
    phase = "WRONG_CODE";
    await page.getByRole("button", { name: "Request verification code", exact: true }).click();
    const form = page.getByRole("form", { name: "Confirm email verification", exact: true });
    await form.getByLabel("Email code", { exact: true }).fill("NONFUNCTIONAL_WRONG_CODE");
    await form.getByRole("button", { name: "Confirm code", exact: true }).click();
    await expect(form.getByRole("alert")).toBeVisible();
    expect((await context.request.get("/api/v1/me")).status()).toBe(200);
    const mail = await privateMail(me.member.id, "email_verification");
    await form.getByLabel("Email code", { exact: true }).fill(mail.code);
    await form.getByRole("button", { name: "Retry this action", exact: true }).click();
    await expect(page.getByText("Your current email is verified.", { exact: true })).toBeVisible();
    phase = "PREFERENCES";
    const prefs = page.getByRole("form", { name: "Preferences", exact: true });
    await prefs.getByLabel("Display timezone", { exact: true }).fill("Europe/Warsaw");
    await prefs.getByRole("combobox", { name: "Language", exact: true }).selectOption("ru");
    await prefs.getByRole("button", { name: "Save preferences", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "ru");
    await page.reload();
    await expect(page.getByLabel("Часовой пояс отображения", { exact: true })).toHaveValue(
      "Europe/Warsaw",
    );
    phase = "LOGOUT";
    await page.getByRole("button", { name: "Выйти", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Войдите, чтобы открыть аккаунт", exact: true }),
    ).toBeVisible();
    expect((await context.request.get("/api/v1/me")).status()).toBe(401);
  } catch {
    throw new Error(`ACCOUNT_REAL_${phase}_FAILED`);
  } finally {
    await staff.dispose();
  }
});
test("real expired invitation, deactivated session/inactive login and neutral recovery acknowledgements", async ({
  page,
  context,
}) => {
  test.setTimeout(60000);
  let phase = "START";
  const staff = await staffContext();
  try {
    phase = "EXPIRED_INVITATION";
    const expired = await createInvitation(context.request, staff);
    await expireFixtureInvitation(expired.invitationId);
    await page.goto(expired.link);
    await english(page);
    await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
    const password = accountSecret("password");
    await page.getByLabel("New password", { exact: true }).fill(password);
    await page.getByLabel("Repeat new password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Accept invitation", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "This link is unavailable", exact: true }),
    ).toBeVisible();
    phase = "MEMBER";
    const invited = await createInvitation(context.request, staff);
    await redeem(page, invited.link, password);
    await login(page, invited.email, password);
    const current = await context.request.get("/api/v1/me");
    const self = (await current.json()).data;
    phase = "DEACTIVATION";
    const etag = current.headers().etag ?? "";
    await deactivateFixtureMember(staff, self.member.id, Number(etag.slice(2, -1)));
    await page.reload();
    await english(page);
    await expect(
      page.getByRole("heading", { name: "Sign in to open your account", exact: true }),
    ).toBeVisible();
    expect((await page.locator(".account-address").count()) === 0).toBe(true);
    phase = "INACTIVE_LOGIN";
    await page.goto("/login");
    await english(page);
    await page.getByLabel("Email", { exact: true }).fill(invited.email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(
      "credentials or code could not be accepted",
    );
    phase = "NEUTRAL_RECOVERY";
    for (const email of [invited.email, `${randomUUID()}@example.invalid`]) {
      await page.goto("/password-recovery");
      await english(page);
      await page.getByLabel("Email", { exact: true }).fill(email);
      await page.getByRole("button", { name: "Request password recovery", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Request received", exact: true }),
      ).toBeVisible();
    }
  } catch {
    throw new Error(`ACCOUNT_ACCESS_${phase}_FAILED`);
  } finally {
    await staff.dispose();
  }
});
test("real recoverable two-proof email replacement reloads both stages, replaces requests and ends sessions only at final proof", async ({
  page,
  context,
}) => {
  test.setTimeout(60000);
  let phase = "START";
  const staff = await staffContext();
  try {
    const invited = await createInvitation(context.request, staff),
      password = accountSecret("password");
    phase = "REDEEM";
    await redeem(page, invited.link, password);
    const member = await login(page, invited.email, password);
    const userId = member.member.id;
    phase = "VERIFY";
    await verify(page, userId);
    const proposed = `${randomUUID()}@example.invalid`;
    phase = "REQUEST";
    let request = page.getByRole("form", { name: "Request email change", exact: true });
    await request.getByLabel("Proposed email", { exact: true }).fill(proposed);
    await request.getByRole("button", { name: "Start email replacement", exact: true }).click();
    await expect(page.getByText(/First enter the code sent to your current email/)).toBeVisible();
    const first = await privateMail(userId, "email_change", "current_email");
    phase = "RELOAD_CURRENT";
    await page.reload();
    await english(page);
    await expect(page.getByText(/First enter the code sent to your current email/)).toBeVisible();
    request = page.getByRole("form", { name: "Request email change", exact: true });
    await request.getByLabel("Proposed email", { exact: true }).fill(proposed);
    const replacementId = await replacePendingEmail(page);
    await expect
      .poll(async () => {
        const mail = await privateMail(userId, "email_change", "current_email");
        return mail.id === replacementId && mail.id !== first.id;
      })
      .toBe(true);
    const current = await privateMail(userId, "email_change", "current_email");
    phase = "CURRENT_PROOF";
    let form = page.getByRole("form", { name: "Confirm email replacement stage", exact: true });
    await form.getByLabel("Email code", { exact: true }).fill(current.code);
    await form.getByRole("button", { name: "Confirm this email code", exact: true }).click();
    await expect(page.getByText(/Current email confirmed/)).toBeVisible();
    expect((await page.locator(".account-address").textContent()) === invited.email).toBe(true);
    phase = "RELOAD_PROPOSED";
    await page.reload();
    await english(page);
    await expect(page.getByText(/Current email confirmed/)).toBeVisible();
    const previousProof = await privateMail(userId, "email_change", "proposed_email");
    phase = "REISSUE_PROPOSED";
    request = page.getByRole("form", { name: "Request email change", exact: true });
    await request.getByLabel("Proposed email", { exact: true }).fill(proposed);
    const renewedId = await replacePendingEmail(page);
    await expect(page.getByText(/First enter the code sent to your current email/)).toBeVisible();
    await expect
      .poll(
        async () => (await privateMail(userId, "email_change", "current_email")).id === renewedId,
      )
      .toBe(true);
    const renewed = await privateMail(userId, "email_change", "current_email");
    form = page.getByRole("form", { name: "Confirm email replacement stage", exact: true });
    await form.getByLabel("Email code", { exact: true }).fill(renewed.code);
    await form.getByRole("button", { name: "Confirm this email code", exact: true }).click();
    await expect(page.getByText(/Current email confirmed/)).toBeVisible();
    const proof = await privateMail(userId, "email_change", "proposed_email");
    expect(proof.id !== previousProof.id).toBe(true);
    form = page.getByRole("form", { name: "Confirm email replacement stage", exact: true });
    await form.getByLabel("Email code", { exact: true }).fill(current.code);
    await form.getByRole("button", { name: "Confirm this email code", exact: true }).click();
    await expect(form.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();
    phase = "FINAL_PROOF";
    await form.getByLabel("Email code", { exact: true }).fill(proof.code);
    await form.getByRole("button", { name: "Retry this action", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: /^(Sign in|Войти)$/, exact: true }),
    ).toBeVisible();
    expect((await context.request.get("/api/v1/me")).status()).toBe(401);
    phase = "NEW_LOGIN";
    const replaced = await login(page, proposed, password);
    expect(replaced.email === proposed).toBe(true);
  } catch {
    throw new Error(`ACCOUNT_EMAIL_${phase}_FAILED`);
  } finally {
    await staff.dispose();
  }
});
test("real verified-email password change and recovery revoke old sessions and accept fresh credentials", async ({
  page,
  context,
}) => {
  test.setTimeout(60000);
  let phase = "START";
  const staff = await staffContext();
  try {
    const invited = await createInvitation(context.request, staff),
      password = accountSecret("password"),
      changed = `${password}A`,
      reset = `${password}B`;
    phase = "REDEEM";
    await redeem(page, invited.link, password);
    const member = await login(page, invited.email, password);
    const userId = member.member.id;
    phase = "VERIFY";
    await verify(page, userId);
    phase = "PASSWORD";
    await page.getByRole("button", { name: "Send code to current email", exact: true }).click();
    await expect(page.getByRole("form", { name: "Change password", exact: true })).toBeVisible();
    const proof = await privateMail(userId, "password_change"),
      form = page.getByRole("form", { name: "Change password", exact: true });
    await form.getByLabel("Email code", { exact: true }).fill(proof.code);
    await form.getByLabel("New password", { exact: true }).fill(changed);
    await form.getByLabel("Repeat new password", { exact: true }).fill(changed);
    await form.getByRole("button", { name: "Confirm password change", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: /^(Sign in|Войти)$/, exact: true }),
    ).toBeVisible();
    expect((await context.request.get("/api/v1/me")).status()).toBe(401);
    await login(page, invited.email, changed);
    phase = "RECOVERY_REQUEST";
    await page.goto("/password-recovery");
    await english(page);
    await page.getByLabel("Email", { exact: true }).fill(invited.email);
    await page.getByRole("button", { name: "Request password recovery", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Request received", exact: true }),
    ).toBeVisible();
    const recovery = await privateMail(userId, "password_reset");
    phase = "RECOVERY_RESET";
    await page.goto(`${origin}/password-reset?token=${encodeURIComponent(recovery.code)}`);
    await english(page);
    expect(new URL(page.url()).search === "").toBe(true);
    await page.getByLabel("New password", { exact: true }).fill(reset);
    await page.getByLabel("Repeat new password", { exact: true }).fill(reset);
    await page.getByRole("button", { name: "Set a new password", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Password updated", exact: true }),
    ).toBeVisible();
    expect((await context.request.get("/api/v1/me")).status()).toBe(401);
    phase = "FRESH_LOGIN";
    await login(page, invited.email, reset);
    const stale = await write(context.request, "/auth/password-resets", {
      token: recovery.code,
      newPassword: changed,
    });
    expect(stale.status()).toBe(401);
  } catch {
    throw new Error(`ACCOUNT_PASSWORD_${phase}_FAILED`);
  } finally {
    await staff.dispose();
  }
});
