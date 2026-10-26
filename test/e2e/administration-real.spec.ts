import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import type { APIRequestContext, Page } from "@playwright/test";
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
async function chooseMember(page: Page, name: string) {
  const master = page.locator(".admin-master");
  await expect(master.locator("tbody tr").first()).toBeVisible();
  for (let index = 0; index < 30; index++) {
    const target = master.getByRole("button", { name, exact: true });
    if (await target.count()) {
      await target.click();
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
    await page.getByLabel("Dispatcher", { exact: true }).check();
    await page.getByLabel("Reason", { exact: true }).first().fill("Fictional additive assignment");
    await confirm(page, "Save selected roles");
    await expect(page.getByLabel("Dispatcher", { exact: true })).toBeChecked();
    await expect(page.getByLabel("Driver", { exact: true })).toBeChecked();
    await page.getByLabel("Reason", { exact: true }).first().fill("Fictional departure");
    await confirm(page, "Deactivate member");
    await expect(
      page.getByRole("button", { name: "Reinstate same member", exact: true }),
    ).toBeVisible();
    await page.getByLabel("Driver", { exact: true }).check();
    await page.getByLabel("Euro Truck Simulator 2", { exact: true }).selectOption({ index: 1 });
    await page.getByLabel("Reason", { exact: true }).first().fill("Fictional explicit return");
    await confirm(page, "Reinstate same member");
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
    await staffPage(
      page,
      staff,
      "/account/admin/settings",
      /^(Company settings|Настройки компании)$/,
    );
    const leadership = page
      .getByRole("heading", { name: "Transfer leadership", exact: true })
      .locator("..");
    for (
      let index = 0;
      index < 30 && !(await leadership.locator(`option[value="${successor.userId}"]`).count());
      index++
    ) {
      const nextPage = page.waitForResponse(
        (r) => r.url().includes("/api/v1/admin/members?status=active") && r.status() === 200,
      );
      await leadership.getByRole("button", { name: "Next page", exact: true }).click();
      await nextPage;
    }
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
    const invitationId = await approveWithMailDisabled(staff, (await submitted.json()).data.id);
    await staffPage(
      page,
      staff,
      "/account/admin/applications?status=approved",
      /^(Applications|Заявки)$/,
    );
    await page.getByRole("button", { name: new RegExp(nickname) }).click();
    await expect(
      page.getByText("Email status: Email not requested", { exact: true }),
    ).toBeVisible();
    async function copyLink() {
      await page.getByRole("button", { name: "Show valid invitation link", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      const link = await dialog.locator("pre").textContent();
      if (!link) throw new Error("SYNTHETIC_INVITATION_LINK_REQUIRED");
      await page.keyboard.press("Escape");
      return link;
    }
    const original = await copyLink(),
      before = (await (await staff.get(`/api/v1/admin/invitations/${invitationId}`)).json()).data;
    await page.getByRole("button", { name: "Request first invitation email", exact: true }).click();
    await expect(page.getByText("Email status: Queued", { exact: true })).toBeVisible();
    const requested = (await (await staff.get(`/api/v1/admin/invitations/${invitationId}`)).json())
      .data;
    expect(requested.id).toBe(invitationId);
    expect(requested.expiresAt).toBe(before.expiresAt);
    expect((await copyLink()) === original).toBe(true);
    await controlledInvitationMailFailure(staff, requested.deliveryId);
    const failedJob = await invitationMailJob(requested.deliveryId);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: /^(Applications|Заявки)$/, exact: true }),
    ).toBeVisible();
    await catalogLanguage(page);
    await page.getByRole("button", { name: new RegExp(nickname) }).click();
    await expect(
      page.getByText("Email status: Known delivery failure", { exact: true }),
    ).toBeVisible();
    expect((await copyLink()) === original).toBe(true);
    await page.getByRole("button", { name: "Retry rejected email", exact: true }).click();
    await expect(page.getByText("Email status: Queued", { exact: true })).toBeVisible();
    const retriedJob = await invitationMailJob(requested.deliveryId);
    expect(retriedJob.id).toBe(failedJob.id);
    expect(retriedJob.attempts).toBe(failedJob.attempts);
    expect(retriedJob.state).toBe("ready");
    await controlledInvitationMailFailure(staff, requested.deliveryId, true);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: /^(Applications|Заявки)$/, exact: true }),
    ).toBeVisible();
    await catalogLanguage(page);
    await page.getByRole("button", { name: new RegExp(nickname) }).click();
    await expect(
      page.getByText("Email status: Outcome unknown; retry is blocked", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Retry rejected email", exact: true }),
    ).toHaveCount(0);
    expect((await copyLink()) === original).toBe(true);
    const state = (await (await staff.get(`/api/v1/admin/invitations/${invitationId}`)).json())
      .data;
    const delivery = await staff.get(`/api/v1/mail-deliveries/${state.deliveryId}`);
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
