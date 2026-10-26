import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import type { APIRequestContext, Page, Response, TestInfo } from "@playwright/test";
import { testConnection } from "../persistence/support.ts";
import { privateMail, resetAccountLimits, staffContext, write } from "./support/account.ts";
import {
  administrationMember,
  approveWithMailDisabled,
  controlledInvitationMailFailure,
  invitationMailJob,
} from "./support/administration.ts";
import { catalogLanguage } from "./support/catalogs.ts";
import { expect, test } from "./support/fixtures.ts";

test.use({ trace: "off", screenshot: "off", video: "off", actionTimeout: 15000 });
test.beforeEach(resetAccountLimits);
async function staffPage(page: Page, context: APIRequestContext, path: string, title: RegExp) {
  await page.context().addCookies((await context.storageState()).cookies);
  await page.goto(path);
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await catalogLanguage(page);
}
async function confirm(page: Page, label: string) {
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function safeStateCapture(page: Page, info: TestInfo, filename: string) {
  // Call only for empty/error/session-ended views after private content is hidden.
  await expect(page.locator("html")).toHaveAttribute(
    "lang",
    filename.includes("-ru.") ? "ru" : "en",
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await mkdir(info.outputPath("safe"), { recursive: true });
  await page.screenshot({ path: info.outputPath("safe", filename), fullPage: true });
}
async function chooseMember(page: Page, name: string, waitForDetail = true) {
  const master = page.locator(".admin-master");
  await expect(master.locator("tbody tr").first()).toBeVisible();
  for (let index = 0; index < 30; index++) {
    const target = master.getByRole("button", { name, exact: true });
    if (await target.count()) {
      await target.click();
      if (waitForDetail)
        await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
      return;
    }
    const next = master.getByRole("button", { name: "Next page", exact: true });
    if (!(await next.count())) break;
    const response = page.waitForResponse(
      (r) =>
        r.url().includes("/api/v1/admin/members?status=active") && r.request().method() === "GET",
    );
    await next.click();
    const received = await response;
    expect(received.status()).toBe(200);
    const firstId = (await received.json()).data.items[0]?.profile.member.id;
    if (firstId) await expect(master.getByText(firstId, { exact: true })).toBeVisible();
    else await expect(master.locator("tbody tr")).toHaveCount(0);
  }
  throw new Error("SYNTHETIC_ADMIN_MEMBER_NOT_FOUND");
}
async function steamAssertion(context: APIRequestContext, verificationUrl: string) {
  const returned = new URL(new URL(verificationUrl).searchParams.get("openid.return_to") ?? ""),
    query = new URLSearchParams(returned.search),
    steamId = `7656119${Date.now().toString().slice(-10)}`;
  for (const [name, value] of Object.entries({
    ns: "http://specs.openid.net/auth/2.0",
    mode: "id_res",
    op_endpoint: "https://steamcommunity.com/openid/login",
    claimed_id: `https://steamcommunity.com/openid/id/${steamId}`,
    identity: `https://steamcommunity.com/openid/id/${steamId}`,
    return_to: returned.toString(),
    response_nonce: `${new Date().toISOString().slice(0, 19)}Z${randomUUID()}`,
    assoc_handle: "synthetic",
    signed: "op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle",
    sig: Buffer.alloc(32, 1).toString("base64"),
  }))
    query.set(`openid.${name}`, value);
  expect(
    (await context.get(`/api/v1/identity/steam/callback?${query}`, { maxRedirects: 0 })).status(),
  ).toBe(303);
}
test("real application review, manual invitation copy and redemption with history", async ({
  page,
  context,
}) => {
  const staff = await staffContext(),
    nickname = `Fictional Applicant ${randomUUID().slice(0, 8)}`,
    email = `${randomUUID()}@example.invalid`;
  try {
    expect(
      (
        await write(context.request, "/public/applications", {
          nickname,
          email,
          steamProfileUrl: "https://steamcommunity.com/id/fictional-admin",
          games: ["ets2", "ats"],
        })
      ).status(),
    ).toBe(201);
    await staffPage(page, staff, "/account/admin/applications", /^(Applications|Заявки)$/);
    await page.getByRole("button", { name: new RegExp(nickname) }).click();
    await expect(page.getByRole("heading", { name: nickname, exact: true })).toBeVisible();
    await confirm(page, "Approve application");
    await expect(page.getByRole("heading", { name: "Invitation", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Show valid invitation link", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const link = await dialog.locator("pre").textContent();
    if (!link) throw new Error("SYNTHETIC_LINK_REQUIRED");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Show valid invitation link", exact: true }),
    ).toBeFocused();
    await page.getByRole("button", { name: "Show valid invitation link", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Dismiss sensitive value", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Show valid invitation link", exact: true }),
    ).toBeFocused();
    await page.goto(link);
    await expect(page.getByLabel(/^(New password|Новый пароль)$/, { exact: true })).toBeVisible();
    await catalogLanguage(page);
    await page
      .getByLabel("New password", { exact: true })
      .fill("Fictional-new-admin-passphrase-42");
    await page
      .getByLabel("Repeat new password", { exact: true })
      .fill("Fictional-new-admin-passphrase-42");
    await page.getByRole("button", { name: "Accept invitation", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Account created", exact: true })).toBeVisible();
    expect(page.url()).not.toContain("token=");
  } finally {
    await staff.dispose();
  }
});

test("real additive roles, deactivate and explicit same-identity reinstatement", async ({
  page,
}) => {
  const member = await administrationMember(),
    staff = await staffContext();
  try {
    await staffPage(page, staff, "/account/admin/members", /^(Members|Участники)$/);
    await chooseMember(page, member.name);
    await expect(
      page.getByRole("region", { name: "Per-game qualifications", exact: true }),
    ).toContainText("Trainee");
    await page.getByLabel("Dispatcher", { exact: true }).check();
    await page.getByLabel("Reason", { exact: true }).first().fill("Fictional additive assignment");
    await confirm(page, "Save selected roles");
    await expect(page.getByLabel("Dispatcher", { exact: true })).toBeChecked();
    await expect(page.getByLabel("Driver", { exact: true })).toBeChecked();
    // Assignment, departure and later return are separate administrative fixture phases,
    // not a combined source-throughput measurement. Domain and session state remain real.
    await resetAccountLimits();
    await page.getByLabel("Reason", { exact: true }).first().fill("Fictional departure");
    await confirm(page, "Deactivate member");
    await expect(
      page.getByRole("button", { name: "Reinstate same member", exact: true }),
    ).toBeVisible();
    await resetAccountLimits();
    await page.getByLabel("Driver", { exact: true }).check();
    await page.getByLabel("Euro Truck Simulator 2", { exact: true }).selectOption({ index: 1 });
    const selectedLabel = await page.locator("#reinstate-ets2 option:checked").textContent();
    if (!selectedLabel) throw new Error("SYNTHETIC_QUALIFICATION_LABEL_REQUIRED");
    await page.getByLabel("Reason", { exact: true }).first().fill("Fictional explicit return");
    await page.getByRole("button", { name: "Reinstate same member", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText(selectedLabel);
    await expect(page.getByRole("dialog")).toContainText("Euro Truck Simulator 2");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Deactivate member", exact: true }),
    ).toBeVisible();
  } finally {
    await staff.dispose();
  }
});

test("real Steam proof, one-show token, lost issuance recovery and revoke", async ({
  page,
  context,
}) => {
  const member = await administrationMember();
  expect(
    (
      await write(context.request, "/auth/login", {
        email: member.email,
        password: member.password,
      })
    ).status(),
  ).toBe(200);
  await page.goto("/account/connections");
  await expect(
    page.getByRole("heading", { name: /^(Connections|Подключения)$/, exact: true }),
  ).toBeVisible();
  await catalogLanguage(page);
  const verification = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/me/steam-verifications") && r.request().method() === "POST",
  );
  await expect(
    page.getByRole("button", { name: "Verify Steam ownership", exact: true }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Verify Steam ownership", exact: true }).click();
  await steamAssertion(context.request, (await (await verification).json()).data.verificationUrl);
  await page.getByRole("button", { name: "Refresh", exact: true }).first().click();
  await expect(page.getByLabel("Credential label", { exact: true })).toBeVisible();
  await page.getByLabel("Credential label", { exact: true }).fill("Fictional recorder");
  await page.getByRole("button", { name: "Create credential", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "One-time telemetry secret", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Create credential", exact: true })).toBeFocused();
  await page.getByLabel("Credential label", { exact: true }).fill("Fictional alternate recorder");
  await page.getByRole("button", { name: "Create credential", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Dismiss sensitive value", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create credential", exact: true })).toBeFocused();
  await confirm(page, "Revoke credential · Fictional alternate recorder");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: /^(Connections|Подключения)$/, exact: true }),
  ).toBeVisible();
  await catalogLanguage(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".admin-secret")).toHaveCount(0);
  await confirm(page, "Revoke credential · Fictional recorder");
  let lost = false;
  await page.route("**/api/v1/me/telemetry-tokens", async (route) => {
    if (!lost && route.request().method() === "POST") {
      lost = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByLabel("Credential label", { exact: true }).fill("Fictional lost response");
  await page.getByRole("button", { name: "Create credential", exact: true }).click();
  await expect(
    page.getByText(
      "The result could not be confirmed. Retry the original request before making another change.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Create credential", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Revoke credential from the previous issuance", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Revoke credential from the previous issuance", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Revoke credential from the previous issuance", exact: true }),
  ).toHaveCount(0);
  // Token lifecycle is complete; this independent permission-negative phase keeps
  // the same authenticated member while resetting only synthetic source accounting.
  await resetAccountLimits();
  expect((await context.request.get("/api/v1/admin/members")).status()).toBe(403);
});

test("real company settings, safe sources/audit and RU/EN responsive keyboard rendering", async ({
  page,
}, info) => {
  const staff = await staffContext();
  try {
    await staffPage(
      page,
      staff,
      "/account/admin/settings",
      /^(Company settings|Настройки компании)$/,
    );
    await page.getByLabel("Company reporting timezone", { exact: true }).fill("Europe/Warsaw");
    await confirm(page, "Save reporting timezone");
    await expect(page.getByLabel("Company reporting timezone", { exact: true })).toHaveValue(
      "Europe/Warsaw",
    );
    await expect(page.getByRole("heading", { name: "Trip sources", exact: true })).toBeVisible();
    await expect(page.getByText("Deferred company adapter", { exact: true })).toHaveCount(2);
    await page.getByRole("button", { name: "Save reporting timezone", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Save reporting timezone", exact: true }),
    ).toBeFocused();
    const audit = page.getByRole("region", { name: "Audit history", exact: true });
    if (await audit.evaluate((element) => element.scrollWidth > element.clientWidth)) {
      await audit.focus();
      await expect(audit).toBeFocused();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      await expect(audit).toBeFocused();
      const initialLeft = await audit.evaluate((element) => element.scrollLeft);
      await page.keyboard.press("ArrowRight");
      await expect
        .poll(() => audit.evaluate((element) => element.scrollLeft))
        .toBeGreaterThan(initialLeft);
      const right = await audit.evaluate((element) => element.scrollLeft);
      await page.keyboard.press("ArrowLeft");
      await expect.poll(() => audit.evaluate((element) => element.scrollLeft)).toBeLessThan(right);
      expect(await audit.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe(
        "none",
      );
    }
    for (const locale of ["en", "ru"] as const) {
      await catalogLanguage(page, locale);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await mkdir(info.outputPath("safe"), { recursive: true });
      await page.screenshot({
        path: info.outputPath("safe", `administration-settings-${locale}.png`),
        fullPage: true,
      });
    }
  } finally {
    await staff.dispose();
  }
});

test("real director-only verified-email leadership transfer uses the bound successor", async ({
  page,
  context,
}) => {
  const staff = await staffContext(),
    successor = await administrationMember(["driver", "dispatcher"]),
    connection = await testConnection();
  const self = (await (await staff.get("/api/v1/me")).json()).data;
  try {
    if (!self.emailVerified) {
      expect((await write(staff, "/me/email-verification-requests")).status()).toBe(202);
      const mail = await privateMail(self.member.id, "email_verification");
      expect(
        (
          await write(staff, "/me/email-verifications", { challengeId: mail.id, code: mail.code })
        ).status(),
      ).toBe(200);
    }
    function successorPage(cursor: string | null) {
      return page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          url.pathname === "/api/v1/admin/members" &&
          url.searchParams.get("status") === "active" &&
          url.searchParams.get("limit") === "25" &&
          url.searchParams.get("cursor") === cursor &&
          response.request().method() === "GET"
        );
      });
    }
    const initialSuccessors = successorPage(null);
    await staffPage(
      page,
      staff,
      "/account/admin/settings",
      /^(Company settings|Настройки компании)$/,
    );
    const leadership = page
      .getByRole("heading", { name: "Transfer leadership", exact: true })
      .locator("..");
    async function settledSuccessors(response: Response) {
      expect(response.status()).toBe(200);
      const data = (await response.json()).data as {
        items: { profile: { member: { id: string; nickname: string } } }[];
        nextCursor: string | null;
      };
      const members = data.items
        .map((row) => row.profile.member)
        .filter((member) => member.id !== self.member.id);
      // A response can arrive before React commits its choices. Match this page's
      // actual rendered values and labels before deciding whether to paginate.
      await expect
        .poll(() =>
          leadership
            .locator("option")
            .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value)),
        )
        .toEqual(["", ...members.map((member) => member.id)]);
      await expect(leadership.locator('option:not([value=""])')).toHaveText(
        members.map((member) => `${member.nickname} · ${member.id}`),
      );
      return data.nextCursor;
    }
    let nextCursor = await settledSuccessors(await initialSuccessors);
    for (
      let index = 0;
      index < 30 && !(await leadership.locator(`option[value="${successor.userId}"]`).count());
      index++
    ) {
      if (!nextCursor) break;
      const nextPage = successorPage(nextCursor);
      await leadership.getByRole("button", { name: "Next page", exact: true }).click();
      nextCursor = await settledSuccessors(await nextPage);
    }
    await expect(leadership.locator(`option[value="${successor.userId}"]`)).toHaveCount(1);
    await page.getByLabel("Active successor", { exact: true }).selectOption(successor.userId);
    const challengeResponse = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/v1/admin/leadership/challenges") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Send bound transfer code", exact: true }).click();
    expect((await challengeResponse).status()).toBe(202);
    const mail = await privateMail(self.member.id, "succession");
    await page.getByRole("button", { name: "Review successor and transfer", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByLabel("Code from your current verified email", { exact: true })
      .fill(mail.code);
    await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: /^(Access restricted|Доступ ограничен)$/, exact: true }),
    ).toBeVisible();
    expect((await staff.get("/api/v1/admin/company-settings")).status()).toBe(403);
    expect(
      (
        await write(context.request, "/auth/login", {
          email: successor.email,
          password: successor.password,
        })
      ).status(),
    ).toBe(200);
    const next = (await (await context.request.get("/api/v1/me")).json()).data;
    expect(next.member.roles).toEqual(["director", "dispatcher", "driver"]);
    expect(
      (await staff.get("/api/v1/me").then((response) => response.json())).data.member.roles,
    ).toContain("driver");
  } finally {
    await connection.execute("UPDATE identity_company SET director_user_id=? WHERE singleton=1", [
      self.member.id,
    ]);
    await connection.end();
    await staff.dispose();
  }
});

test("obsolete delayed application details cannot replace the next selected record", async ({
  page,
  context,
}) => {
  const staff = await staffContext(),
    first = `Fictional First ${randomUUID().slice(0, 8)}`,
    second = `Fictional Second ${randomUUID().slice(0, 8)}`;
  let release: () => void = () => {},
    entered: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
      release = resolve;
    }),
    ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
  try {
    for (const nickname of [first, second])
      expect(
        (
          await write(context.request, "/public/applications", {
            nickname,
            email: `${randomUUID()}@example.invalid`,
            steamProfileUrl: "https://steamcommunity.com/id/fictional-delay",
            games: ["ets2"],
          })
        ).status(),
      ).toBe(201);
    const listed = (
      await (await staff.get("/api/v1/admin/applications?status=submitted&limit=25")).json()
    ).data.items;
    const id = listed.find(
      (row: { fields: { nickname: string } }) => row.fields.nickname === first,
    ).id;
    await page.route(`**/api/v1/admin/applications/${id}`, async (route) => {
      const response = await route.fetch();
      entered();
      await gate;
      await route.fulfill({ response }).catch(() => {});
    });
    await staffPage(page, staff, "/account/admin/applications", /^(Applications|Заявки)$/);
    await page.getByRole("button", { name: new RegExp(first) }).click();
    await ready;
    if ((page.viewportSize()?.width ?? 1280) < 700)
      await page.getByRole("button", { name: "Back to list", exact: true }).click();
    await page.getByRole("button", { name: new RegExp(second) }).click();
    await expect(page.getByRole("heading", { name: second, exact: true })).toBeVisible();
    release();
    await expect(page.getByRole("heading", { name: first, exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: second, exact: true })).toBeVisible();
  } finally {
    release();
    await staff.dispose();
  }
});

test("real rejection requires a reason and a later application retains the previous decision", async ({
  page,
  context,
}) => {
  const staff = await staffContext(),
    email = `${randomUUID()}@example.invalid`,
    first = `Fictional Rejected ${randomUUID().slice(0, 8)}`,
    second = `Fictional Return ${randomUUID().slice(0, 8)}`,
    reason = "Fictional prior decision retained for staff review";
  try {
    const submit = (nickname: string) =>
      write(context.request, "/public/applications", {
        nickname,
        email,
        steamProfileUrl: "https://steamcommunity.com/id/fictional-prior-application",
        games: ["ets2"],
      });
    expect((await submit(first)).status()).toBe(201);
    await staffPage(page, staff, "/account/admin/applications", /^(Applications|Заявки)$/);
    await page.getByRole("button", { name: new RegExp(first) }).click();
    await expect(
      page.getByRole("button", { name: "Reject application", exact: true }),
    ).toBeDisabled();
    await page.getByLabel("Reason", { exact: true }).fill(reason);
    await confirm(page, "Reject application");
    await expect(page.getByRole("heading", { name: "Decision", exact: true })).toBeVisible();
    expect((await submit(second)).status()).toBe(201);
    await page.goto("/account/admin/applications?status=submitted");
    await expect(
      page.getByRole("heading", { name: /^(Applications|Заявки)$/, exact: true }),
    ).toBeVisible();
    await catalogLanguage(page);
    await page.getByRole("button", { name: new RegExp(second) }).click();
    const history = page
      .getByRole("heading", { name: "Application history for this email", exact: true })
      .locator("..");
    await expect(history).toContainText(reason);
    await expect(history).toContainText("Rejected");
    await expect(page.getByRole("heading", { name: second, exact: true })).toBeVisible();
  } finally {
    await staff.dispose();
  }
});

test("real disabled-mail invitation supports independent copy, first email, supported resend and blocked ambiguity", async ({
  page,
  context,
}) => {
  const staff = await staffContext(),
    nickname = `Fictional Mail ${randomUUID().slice(0, 8)}`;
  try {
    const submitted = await write(context.request, "/public/applications", {
      nickname,
      email: `${randomUUID()}@example.invalid`,
      steamProfileUrl: "https://steamcommunity.com/id/fictional-mail",
      games: ["ets2"],
    });
    expect(submitted.status()).toBe(201);
    const invitationId = await approveWithMailDisabled(staff, nickname),
      initialList = responseFor("/admin/applications");
    await staffPage(
      page,
      staff,
      "/account/admin/applications?status=approved",
      /^(Applications|Заявки)$/,
    );
    expect((await initialList).status()).toBe(200);
    const initialDetail = applicationDetail(),
      initialInvitation = responseFor(`/admin/invitations/${invitationId}`);
    await page.getByRole("button", { name: new RegExp(nickname) }).click();
    expect((await initialDetail).status()).toBe(200);
    expect((await initialInvitation).status()).toBe(200);
    await expect(
      page.getByText("Email status: Email not requested", { exact: true }),
    ).toBeVisible();
    function responseFor(path: string, method = "GET") {
      return page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === `/api/v1${path}` &&
          response.request().method() === method,
      );
    }
    function applicationDetail() {
      return page.waitForResponse(
        (response) =>
          /^\/api\/v1\/admin\/applications\/[^/]+$/.test(new URL(response.url()).pathname) &&
          response.request().method() === "GET",
      );
    }
    async function readInvitation() {
      const response = await staff.get(`/api/v1/admin/invitations/${invitationId}`);
      expect(response.status()).toBe(200);
      return (await response.json()).data;
    }
    async function copyLink() {
      const response = responseFor(`/admin/invitations/${invitationId}/copy-link`, "POST");
      await page.getByRole("button", { name: "Show valid invitation link", exact: true }).click();
      expect((await response).status()).toBe(200);
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      const link = await dialog.locator("pre").textContent();
      if (!link) throw new Error("SYNTHETIC_INVITATION_LINK_REQUIRED");
      await page.keyboard.press("Escape");
      return link;
    }
    const original = await copyLink(),
      before = await readInvitation(),
      firstEmail = responseFor(`/admin/invitations/${invitationId}/email-deliveries`, "POST"),
      firstDelivery = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname.startsWith("/api/v1/mail-deliveries/") &&
          response.request().method() === "GET",
      );
    await page.getByRole("button", { name: "Request first invitation email", exact: true }).click();
    expect((await firstEmail).status()).toBe(200);
    expect((await firstDelivery).status()).toBe(200);
    await expect(page.getByText("Email status: Queued", { exact: true })).toBeVisible();
    const requested = await readInvitation();
    expect(requested.id).toBe(invitationId);
    expect(requested.expiresAt).toBe(before.expiresAt);
    expect((await copyLink()) === original).toBe(true);
    async function showWorkerOutcome(state: "failed" | "ambiguous", label: string) {
      // Each controlled worker outcome starts a separate operator inspection phase.
      // Reset rate accounting only; encrypted delivery, generation and queue history remain.
      await resetAccountLimits();
      const list = responseFor("/admin/applications"),
        detail = applicationDetail(),
        invitation = responseFor(`/admin/invitations/${invitationId}`),
        delivery = responseFor(`/mail-deliveries/${requested.deliveryId}`);
      await page.reload();
      expect((await list).status()).toBe(200);
      await expect(
        page.getByRole("heading", { name: /^(Applications|Заявки)$/, exact: true }),
      ).toBeVisible();
      await catalogLanguage(page);
      await page.getByRole("button", { name: new RegExp(nickname) }).click();
      expect((await detail).status()).toBe(200);
      expect((await invitation).status()).toBe(200);
      const received = await delivery;
      expect(received.status()).toBe(200);
      expect((await received.json()).data.state).toBe(state);
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
    await controlledInvitationMailFailure(staff, requested.deliveryId);
    const failedJob = await invitationMailJob(requested.deliveryId);
    await showWorkerOutcome("failed", "Email status: Known delivery failure");
    expect((await copyLink()) === original).toBe(true);
    const retry = responseFor(`/mail-deliveries/${requested.deliveryId}/resends`, "POST"),
      queued = responseFor(`/mail-deliveries/${requested.deliveryId}`);
    await page.getByRole("button", { name: "Retry rejected email", exact: true }).click();
    expect((await retry).status()).toBe(200);
    const queuedResponse = await queued;
    expect(queuedResponse.status()).toBe(200);
    expect((await queuedResponse.json()).data.state).toBe("queued");
    await expect(page.getByText("Email status: Queued", { exact: true })).toBeVisible();
    const retriedJob = await invitationMailJob(requested.deliveryId);
    expect(retriedJob.id).toBe(failedJob.id);
    expect(retriedJob.attempts).toBe(failedJob.attempts);
    expect(retriedJob.state).toBe("ready");
    await controlledInvitationMailFailure(staff, requested.deliveryId, true);
    await showWorkerOutcome("ambiguous", "Email status: Outcome unknown; retry is blocked");
    await expect(
      page.getByRole("button", { name: "Retry rejected email", exact: true }),
    ).toHaveCount(0);
    expect((await copyLink()) === original).toBe(true);
    const state = await readInvitation();
    expect(state.id).toBe(invitationId);
    expect(state.deliveryId).toBe(requested.deliveryId);
    expect(state.expiresAt).toBe(before.expiresAt);
    const delivery = await staff.get(`/api/v1/mail-deliveries/${state.deliveryId}`);
    expect(delivery.status()).toBe(200);
    expect((await delivery.json()).data.state).toBe("ambiguous");
    expect(
      (
        await write(
          staff,
          `/mail-deliveries/${state.deliveryId}/resends`,
          undefined,
          delivery.headers().etag,
        )
      ).status(),
    ).toBe(409);
  } finally {
    await staff.dispose();
  }
});

test("real staff Steam replacement applies only verified proof and invalidates the old telemetry credential", async ({
  page,
  context,
}) => {
  const member = await administrationMember(),
    staff = await staffContext();
  try {
    expect(
      (
        await write(context.request, "/auth/login", {
          email: member.email,
          password: member.password,
        })
      ).status(),
    ).toBe(200);
    await page.goto("/account/connections");
    await expect(
      page.getByRole("heading", { name: /^(Connections|Подключения)$/, exact: true }),
    ).toBeVisible();
    await catalogLanguage(page);
    const initialResponse = page.waitForResponse(
      (r) => r.url().endsWith("/api/v1/me/steam-verifications") && r.request().method() === "POST",
    );
    await expect(
      page.getByRole("button", { name: "Verify Steam ownership", exact: true }),
    ).toHaveCount(1);
    await page.getByRole("button", { name: "Verify Steam ownership", exact: true }).click();
    await steamAssertion(
      context.request,
      (await (await initialResponse).json()).data.verificationUrl,
    );
    await page.getByRole("button", { name: "Refresh", exact: true }).first().click();
    await expect(
      page.getByRole("button", { name: "Verify a replacement Steam account", exact: true }),
    ).toBeVisible();
    const issued = await write(context.request, "/me/telemetry-tokens", {
      label: "Fictional replacement proof token",
    });
    expect(issued.status()).toBe(201);
    const token = (await issued.json()).data.token;
    const replacementResponse = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/v1/me/steam-replacement-verifications") &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Verify a replacement Steam account", exact: true })
      .click();
    const replacement = (await (await replacementResponse).json()).data;
    await steamAssertion(context.request, replacement.verificationUrl);
    const proof = (
      await (
        await context.request.get(`/api/v1/me/steam-replacement-verifications/${replacement.id}`)
      ).json()
    ).data;
    expect(proof.state).toBe("verified");
    const before = (await (await staff.get(`/api/v1/admin/members/${member.userId}`)).json()).data;
    // These are separate member and staff journeys, not a combined shared-IP load test.
    await resetAccountLimits();
    await staffPage(page, staff, "/account/admin/members", /^(Members|Участники)$/);
    await chooseMember(page, member.name);
    await expect(
      page.getByRole("button", { name: "Apply verified Steam replacement", exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("Reason", { exact: true })
      .last()
      .fill("Fictional verified identity replacement");
    await confirm(page, "Apply verified Steam replacement");
    await expect(
      page.getByRole("link", { name: proof.candidateSteamProfileUrl, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Apply verified Steam replacement", exact: true }),
    ).toHaveCount(0);
    const after = (await (await staff.get(`/api/v1/admin/members/${member.userId}`)).json()).data;
    expect(after.identityEpoch).toBe(before.identityEpoch + 1);
    expect(
      JSON.stringify(after.profile.qualifications) ===
        JSON.stringify(before.profile.qualifications),
    ).toBe(true);
    expect(
      (
        await context.request.get("/api/telemetry/v1/connection", {
          headers: { Authorization: `Bearer ${token}` },
        })
      ).status(),
    ).toBe(401);
  } finally {
    await staff.dispose();
  }
});

test("controlled administration loading, read-error, explicit retry and empty states render in EN and RU", async ({
  page,
}, info) => {
  const staff = await staffContext();
  let release: () => void = () => {},
    entered: () => void = () => {},
    reads = 0,
    recover = false;
  const gate = new Promise<void>((resolve) => {
      release = resolve;
    }),
    ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
  await page.route("**/api/v1/admin/applications**", async (route) => {
    if (new URL(route.request().url()).pathname !== "/api/v1/admin/applications")
      return route.continue();
    reads++;
    if (!recover) {
      entered();
      await gate;
      await route.fulfill({
        status: 503,
        json: {
          error: {
            code: "SERVICE_UNAVAILABLE",
            messageKey: "errors.service_unavailable",
            retryable: true,
          },
          meta: { requestId: "synthetic-admin-read-error" },
        },
      });
    } else
      await route.fulfill({
        json: {
          data: { items: [], nextCursor: null },
          meta: { requestId: "synthetic-admin-empty" },
        },
      });
  });
  try {
    await staffPage(page, staff, "/account/admin/applications", /^(Applications|Заявки)$/);
    await ready;
    const master = page.locator(".admin-master");
    await expect(master.getByRole("status")).toHaveText("Loading…");
    await expect(master.locator(".admin-list button")).toHaveCount(0);
    release();
    await expect(master.getByRole("alert")).toContainText("This information is unavailable.");
    await safeStateCapture(page, info, "administration-read-error-en.png");
    await catalogLanguage(page, "ru");
    await expect(master.getByRole("alert")).toContainText("Информация недоступна.");
    await safeStateCapture(page, info, "administration-read-error-ru.png");
    await catalogLanguage(page, "en");
    recover = true;
    await master.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(
      master.getByText("There are no records in this view.", { exact: true }),
    ).toBeVisible();
    await expect(master.getByRole("alert")).toHaveCount(0);
    expect(reads).toBe(2);
    await safeStateCapture(page, info, "administration-empty-recovered-en.png");
    await catalogLanguage(page, "ru");
    await expect(
      master.getByText("В этом списке пока нет записей.", { exact: true }),
    ).toBeVisible();
    await safeStateCapture(page, info, "administration-empty-recovered-ru.png");
  } finally {
    release();
    await staff.dispose();
  }
});

test("controlled qualification label read failure is explicit and retry restores owning names", async ({
  page,
}) => {
  const staff = await staffContext(),
    member = await administrationMember();
  let recover = false;
  await page.route("**/api/v1/admin/reinstatement-options", async (route) => {
    if (recover) await route.continue();
    else
      await route.fulfill({
        status: 503,
        json: {
          error: {
            code: "SERVICE_UNAVAILABLE",
            messageKey: "errors.service_unavailable",
            retryable: true,
          },
          meta: { requestId: "synthetic-qualification-label-error" },
        },
      });
  });
  try {
    await staffPage(page, staff, "/account/admin/members", /^(Members|Участники)$/);
    await chooseMember(page, member.name);
    const qualifications = page.getByRole("region", {
      name: "Per-game qualifications",
      exact: true,
    });
    await expect(
      qualifications.getByText("Qualification label unavailable", { exact: true }),
    ).toHaveCount(2);
    await expect(qualifications.getByRole("alert")).toContainText(
      "This information is unavailable.",
    );
    recover = true;
    await qualifications.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(qualifications).toContainText("Trainee");
    await expect(
      qualifications.getByText("Qualification label unavailable", { exact: true }),
    ).toHaveCount(0);
    await expect(qualifications.getByRole("alert")).toHaveCount(0);
  } finally {
    await staff.dispose();
  }
});

test("real revoked administration session clears private content before a delayed authorized response arrives", async ({
  page,
  context,
}, info) => {
  const staff = await staffContext(),
    viewer = await administrationMember(["deputy_director"]),
    target = await administrationMember();
  let release: () => void = () => {},
    entered: () => void = () => {},
    attempted: () => void = () => {},
    capturedPrivate = false;
  const gate = new Promise<void>((resolve) => {
      release = resolve;
    }),
    ready = new Promise<void>((resolve) => {
      entered = resolve;
    }),
    lateAttempt = new Promise<void>((resolve) => {
      attempted = resolve;
    });
  await page.route(`**/api/v1/admin/members/${target.userId}`, async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    capturedPrivate = (await response.json()).data.email === target.email;
    entered();
    await gate;
    try {
      await route.fulfill({ response });
    } catch {
      /* Cancellation after session loss is expected. */
    } finally {
      attempted();
    }
  });
  try {
    expect(
      (
        await write(context.request, "/auth/login", {
          email: viewer.email,
          password: viewer.password,
        })
      ).status(),
    ).toBe(200);
    await page.goto("/account/admin/members");
    await expect(
      page.getByRole("heading", { name: /^(Members|Участники)$/, exact: true }),
    ).toBeVisible();
    await catalogLanguage(page);
    await chooseMember(page, target.name, false);
    await ready;
    expect(capturedPrivate).toBe(true);
    await expect(page.getByText(target.email, { exact: true })).toHaveCount(0);
    // Navigation by the deputy and revocation by a separate director are distinct fixture phases.
    await resetAccountLimits();
    const current = await staff.get(`/api/v1/admin/members/${viewer.userId}`);
    expect(current.status()).toBe(200);
    expect(
      (
        await write(
          staff,
          `/admin/members/${viewer.userId}/deactivation`,
          { reason: "Fictional revoked administration session" },
          current.headers().etag,
        )
      ).status(),
    ).toBe(200);
    const deniedSelf = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/v1/me" && response.status() === 401,
    );
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await deniedSelf;
    await expect(
      page.getByRole("heading", {
        name: /^(Sign in to open your account|Войдите, чтобы открыть аккаунт)$/,
        exact: true,
      }),
    ).toBeVisible();
    release();
    await lateAttempt;
    await expect(page.locator(".admin-detail")).toHaveCount(0);
    await expect(page.getByText(target.email, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: target.name, exact: true })).toHaveCount(0);
    expect((await context.request.get("/api/v1/admin/members")).status()).toBe(401);
    await catalogLanguage(page, "en");
    await safeStateCapture(page, info, "administration-session-ended-en.png");
  } finally {
    release();
    await staff.dispose();
  }
});

for (const refreshOutcome of ["success", "failure"] as const) {
  test(`real confirmed token survives ${refreshOutcome} list refresh beyond the command deadline`, async ({
    page,
    context,
  }) => {
    const member = await administrationMember(),
      label = `Fictional confirmed ${refreshOutcome}`;
    expect(
      (
        await write(context.request, "/auth/login", {
          email: member.email,
          password: member.password,
        })
      ).status(),
    ).toBe(200);
    const proof = await write(context.request, "/me/steam-verifications");
    expect(proof.status()).toBe(200);
    await steamAssertion(context.request, (await proof.json()).data.verificationUrl);
    const initialList = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/v1/me/telemetry-tokens" &&
        response.request().method() === "GET",
    );
    await page.goto("/account/connections");
    expect((await initialList).status()).toBe(200);
    await catalogLanguage(page);
    await expect(page.getByLabel("Credential label", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Verify a replacement Steam account", exact: true }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "Verify a replacement Steam account", exact: true }),
    ).toBeVisible();
    const tokens = page
      .getByRole("heading", { name: "Personal telemetry credentials", exact: true })
      .locator("..");
    await expect(
      tokens.getByText("There are no records in this view.", { exact: true }),
    ).toBeVisible();
    let release: () => void = () => {},
      entered: () => void = () => {},
      releasePost: () => void = () => {},
      postEntered: () => void = () => {},
      held = true,
      posts = 0,
      issuedId = "",
      issuedSecret = "";
    const gate = new Promise<void>((resolve) => {
        release = resolve;
      }),
      ready = new Promise<void>((resolve) => {
        entered = resolve;
      }),
      postGate = new Promise<void>((resolve) => {
        releasePost = resolve;
      }),
      postReady = new Promise<void>((resolve) => {
        postEntered = resolve;
      });
    await page.route("**/api/v1/me/telemetry-tokens**", async (route) => {
      if (new URL(route.request().url()).pathname !== "/api/v1/me/telemetry-tokens")
        return route.continue();
      if (route.request().method() === "POST") {
        posts++;
        const response = await route.fetch();
        expect(response.status()).toBe(201);
        const data = (await response.json()).data;
        issuedId = data.info.id;
        issuedSecret = data.token;
        postEntered();
        await postGate;
        await route.fulfill({ response });
      } else if (route.request().method() === "GET" && held) {
        held = false;
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        entered();
        await gate;
        if (refreshOutcome === "success") await route.fulfill({ response });
        else
          await route.fulfill({
            status: 503,
            json: {
              error: {
                code: "SERVICE_UNAVAILABLE",
                messageKey: "errors.service_unavailable",
                retryable: true,
              },
              meta: { requestId: "synthetic-confirmed-token-list-failure" },
            },
          });
      } else await route.continue();
    });
    await page.clock.install();
    try {
      await page.getByLabel("Credential label", { exact: true }).fill(label);
      await page.getByRole("button", { name: "Create credential", exact: true }).click();
      await postReady;
      // The server has committed POST201, but the browser response is gated. Keep
      // this request below its own 15-second deadline before starting the list read.
      await page.clock.fastForward(8000);
      const issued = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/v1/me/telemetry-tokens" &&
          response.request().method() === "POST",
      );
      releasePost();
      expect((await issued).status()).toBe(201);
      await ready;
      const secret = page.getByRole("dialog", { name: "One-time telemetry secret", exact: true });
      await expect(secret).toBeVisible();
      // Combined browser command time now exceeds 15 seconds, while the separately
      // gated read remains below its own unchanged deadline. No wall-clock sleep.
      await page.clock.fastForward(8001);
      await expect(secret).toBeVisible();
      expect(
        (await secret.locator("pre").textContent()) === issuedSecret && issuedSecret.length > 0,
      ).toBe(true);
      expect(posts).toBe(1);
      const refreshed = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/v1/me/telemetry-tokens" &&
          response.request().method() === "GET",
      );
      release();
      expect((await refreshed).status()).toBe(refreshOutcome === "success" ? 200 : 503);
      await expect(secret).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("button", { name: "Create credential", exact: true }),
      ).toBeFocused();
      await expect(page.locator(".admin-secret")).toHaveCount(0);
      await expect(
        tokens.getByText(
          "The result could not be confirmed. Retry the original request before making another change.",
          { exact: true },
        ),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", {
          name: "Revoke credential from the previous issuance",
          exact: true,
        }),
      ).toHaveCount(0);
      if (refreshOutcome === "failure") {
        await expect(tokens.getByRole("alert")).toContainText("This information is unavailable.");
        const recovered = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === "/api/v1/me/telemetry-tokens" &&
            response.request().method() === "GET",
        );
        await tokens.getByRole("button", { name: "Refresh", exact: true }).click();
        expect((await recovered).status()).toBe(200);
      }
      await expect(tokens.getByRole("heading", { name: label, exact: true })).toBeVisible();
      await confirm(page, `Revoke credential · ${label}`);
      await expect(tokens.getByText("Revoked", { exact: true })).toBeVisible();
      const listed = await context.request.get("/api/v1/me/telemetry-tokens?limit=25");
      expect(listed.status()).toBe(200);
      const matching = (await listed.json()).data.items.filter(
        (row: { label: string }) => row.label === label,
      );
      expect(matching.length).toBe(1);
      expect(matching[0].id === issuedId && matching[0].revokedAt !== null).toBe(true);
      expect(posts).toBe(1);
    } finally {
      releasePost();
      release();
      await page.clock.resume();
    }
  });
}

for (const role of ["deputy_director", "dispatcher"] as const) {
  test(`real non-driving ${role} connections keep delayed permitted identity without requesting tokens`, async ({
    page,
    context,
  }) => {
    const member = await administrationMember([role]);
    expect(
      (
        await write(context.request, "/auth/login", {
          email: member.email,
          password: member.password,
        })
      ).status(),
    ).toBe(200);
    let release: () => void = () => {},
      entered: () => void = () => {},
      tokenReads = 0;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
      }),
      ready = new Promise<void>((resolve) => {
        entered = resolve;
      });
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/v1/me/telemetry-tokens") tokenReads++;
    });
    await page.route("**/api/v1/me/identity", async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      entered();
      await gate;
      await route.fulfill({ response });
    });
    try {
      await page.goto("/account/connections");
      await ready;
      await catalogLanguage(page);
      const tokens = page
        .getByRole("heading", { name: "Personal telemetry credentials", exact: true })
        .locator("..");
      await expect(
        tokens.getByText("Your current roles do not allow personal telemetry credentials.", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(tokens.getByRole("status")).toHaveCount(0);
      await expect(tokens.getByRole("alert")).toHaveCount(0);
      await expect(tokens.getByRole("button")).toHaveCount(0);
      expect((await context.request.get("/api/v1/me/telemetry-tokens?limit=25")).status()).toBe(
        403,
      );
      const identity = page.waitForResponse(
        (response) => new URL(response.url()).pathname === "/api/v1/me/identity",
      );
      release();
      expect((await identity).status()).toBe(200);
      await expect(
        page.getByRole("button", { name: "Verify Steam ownership", exact: true }),
      ).toBeVisible();
      await expect(
        page
          .getByRole("heading", { name: "Steam and TruckersMP", exact: true })
          .locator("..")
          .getByText("Not linked", { exact: true })
          .first(),
      ).toBeVisible();
      expect(tokenReads).toBe(0);
    } finally {
      release();
    }
  });
}

test("controlled resource denial at unchanged real authority does not cancel a permitted identity read", async ({
  page,
  context,
}) => {
  const member = await administrationMember();
  expect(
    (
      await write(context.request, "/auth/login", {
        email: member.email,
        password: member.password,
      })
    ).status(),
  ).toBe(200);
  let release: () => void = () => {},
    entered: () => void = () => {},
    denied = false;
  const gate = new Promise<void>((resolve) => {
      release = resolve;
    }),
    ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
  await page.route("**/api/v1/me/identity", async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    entered();
    await gate;
    try {
      await route.fulfill({ response });
    } catch {
      /* A regression may cancel the request. */
    }
  });
  await page.route("**/api/v1/me/telemetry-tokens**", async (route) => {
    await ready;
    denied = true;
    await route.fulfill({
      status: 403,
      json: {
        error: { code: "FORBIDDEN", messageKey: "errors.forbidden", retryable: false },
        meta: { requestId: "synthetic-isolated-resource-denial" },
      },
    });
  });
  const reconciled = page.waitForResponse(
    (response) =>
      denied &&
      new URL(response.url()).pathname === "/api/v1/me" &&
      response.request().method() === "GET",
  );
  try {
    await page.goto("/account/connections");
    await ready;
    const current = await reconciled;
    expect(current.status()).toBe(200);
    expect((await current.json()).data.capabilities.includes("trips.submit_own")).toBe(true);
    await catalogLanguage(page);
    release();
    await expect(
      page.getByRole("button", { name: "Verify Steam ownership", exact: true }),
    ).toBeVisible();
    const listed = await context.request.get("/api/v1/me/telemetry-tokens?limit=25");
    expect(listed.status()).toBe(200);
    await expect(
      page
        .getByRole("heading", { name: "Personal telemetry credentials", exact: true })
        .locator("..")
        .getByRole("alert"),
    ).toContainText("This information is unavailable.");
  } finally {
    release();
  }
});
