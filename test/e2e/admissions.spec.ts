import { spawn } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import type { APIRequestContext, APIResponse } from "@playwright/test";
import { request as requests } from "@playwright/test";
import { guardedSettings, testConnection } from "../persistence/support.ts";
import { guardedAllocation, safeChildEnvironment } from "../support/environment.ts";
import { expect, test } from "./support/fixtures.ts";

// Credentials, links and authenticated responses never enter traces/screenshots.
test.use({ trace: "off", screenshot: "off", video: "off" });
test.beforeEach(async () => {
  // Independent device journeys share one synthetic socket; abuse persistence is tested separately.
  const control = await testConnection();
  try {
    await control.query("DELETE FROM admissions_limits");
    await control.query("DELETE FROM identity_limits");
  } finally {
    await control.end();
  }
});
const base = "http://127.0.0.1:4173";
const password = () =>
  createHmac("sha256", guardedAllocation().token)
    .update("browser-identity-password")
    .digest("base64url");
async function csrf(context: APIRequestContext) {
  const response = await context.get("/api/v1/auth/csrf");
  expect(response.status()).toBe(200);
  return (await response.json()).data.token as string;
}
async function login(
  context: APIRequestContext,
  origin: string,
  email = "browser@example.invalid",
  secret = password(),
) {
  const response = await context.post("/api/v1/auth/login", {
    headers: { Origin: origin, "X-CSRF-Token": await csrf(context) },
    data: { email, password: secret },
  });
  expect(response.status()).toBe(200);
  return response;
}
const fields = () => ({
  nickname: "Fictional Browser Applicant",
  email: `${randomUUID()}@example.invalid`,
  steamProfileUrl: "https://steamcommunity.com/id/fictional-driver",
  games: ["ets2", "ats"],
});
async function submit(context: APIRequestContext, origin: string, input = fields()) {
  const response = await context.post("/api/v1/public/applications", {
    headers: {
      Origin: origin,
      "X-CSRF-Token": await csrf(context),
      "Idempotency-Key": randomUUID(),
      "Accept-Language": "ru",
    },
    data: input,
  });
  expect(response.status()).toBe(201);
  return input;
}
async function find(context: APIRequestContext, email: string) {
  let cursor: string | null = null;
  for (let page = 0; page < 10; page++) {
    const response: APIResponse = await context.get(
      `/api/v1/admin/applications?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      data: {
        items: {
          id: string;
          version: number;
          status: string;
          invitationId: string | null;
          fields: { email: string };
        }[];
        nextCursor: string | null;
      };
    };
    const found = body.data.items.find(
      (item: { fields: { email: string } }) => item.fields.email === email,
    );
    if (found)
      return found as { id: string; version: number; status: string; invitationId: string | null };
    cursor = body.data.nextCursor;
    if (!cursor) break;
  }
  throw new Error("SYNTHETIC_BROWSER_APPLICATION_MISSING");
}
async function decide(
  context: APIRequestContext,
  origin: string,
  id: string,
  version: number,
  decision: "approve" | "reject",
) {
  const response = await context.post(`/api/v1/admin/applications/${id}/decisions`, {
    headers: {
      Origin: origin,
      "X-CSRF-Token": await csrf(context),
      "Idempotency-Key": randomUUID(),
      "If-Match": `"v${version}"`,
    },
    data:
      decision === "approve" ? { decision } : { decision, reason: "Fictional browser rejection" },
  });
  expect(response.status()).toBe(200);
  return (await response.json()).data as { invitationId: string; version: number };
}
async function copy(context: APIRequestContext, origin: string, id: string) {
  const response = await context.post(`/api/v1/admin/invitations/${id}/copy-link`, {
    headers: { Origin: origin, "X-CSRF-Token": await csrf(context), "If-Match": '"v1"' },
  });
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  return new URL((await response.json()).data.link).searchParams.get("token") as string;
}
test("built admissions API submits, reviews, manually copies and atomically redeems before normal login; rejection history permits reapplication", async ({
  context,
}) => {
  const visitor = context.request,
    staff = await requests.newContext({ baseURL: base });
  try {
    const raw = await submit(visitor, base);
    expect((await visitor.get("/api/v1/admin/applications")).status()).toBe(401);
    await login(staff, base);
    const app = await find(staff, raw.email);
    const approved = await decide(staff, base, app.id, app.version, "approve");
    const token = await copy(staff, base, approved.invitationId);
    const key = randomUUID(),
      headers = { Origin: base, "X-CSRF-Token": await csrf(visitor), "Idempotency-Key": key },
      data = { invitationToken: token, password: password() };
    const redeemed = await visitor.post("/api/v1/public/invitation-redemptions", { headers, data });
    expect(redeemed.status()).toBe(201);
    expect(redeemed.headers()["set-cookie"]).toBe(undefined);
    expect((await visitor.get("/api/v1/me")).status()).toBe(401);
    const replay = await visitor.post("/api/v1/public/invitation-redemptions", { headers, data });
    expect(replay.status()).toBe(201);
    expect((await replay.json()).data).toEqual((await redeemed.json()).data);
    const logged = await login(visitor, base, raw.email);
    expect((await logged.json()).data.emailVerified).toBe(false);
    expect((await logged.json()).data.member.roles).toEqual(["trainee"]);
    expect((await visitor.get("/api/v1/admin/applications")).status()).toBe(403);
    const rawRejected = await submit(staff, base),
      rejected = await find(staff, rawRejected.email);
    await decide(staff, base, rejected.id, rejected.version, "reject");
    await submit(staff, base, rawRejected);
    const history = await staff.get(`/api/v1/admin/applications/${rejected.id}/history`);
    expect(history.status()).toBe(200);
    expect((await history.json()).data.items.length).toBe(2);
    const stale = await staff.post(`/api/v1/admin/invitations/${approved.invitationId}/copy-link`, {
      headers: { Origin: base, "X-CSRF-Token": await csrf(staff), "If-Match": '"v2"' },
    });
    expect(stale.status()).toBe(409);
    const replaceInput = await submit(staff, base),
      replaceApp = await find(staff, replaceInput.email),
      old = await decide(staff, base, replaceApp.id, 1, "approve"),
      oldToken = await copy(staff, base, old.invitationId);
    const replaced = await staff.post(`/api/v1/admin/invitations/${old.invitationId}/reissue`, {
      headers: {
        Origin: base,
        "X-CSRF-Token": await csrf(staff),
        "If-Match": '"v1"',
        "Idempotency-Key": randomUUID(),
      },
    });
    expect(replaced.status()).toBe(200);
    const replacedRedeem = await staff.post("/api/v1/public/invitation-redemptions", {
      headers: { Origin: base, "X-CSRF-Token": await csrf(staff), "Idempotency-Key": randomUUID() },
      data: { invitationToken: oldToken, password: password() },
    });
    expect(replacedRedeem.status()).toBe(409);
  } finally {
    await staff.dispose();
  }
});
test("built server with mail disabled still copies an invitation and redeems without a session; expired link is unavailable", async () => {
  const settings = guardedSettings(),
    origin = "http://127.0.0.1:4175";
  const child = spawn(process.execPath, ["apps/api/dist/server.js"], {
    stdio: "ignore",
    env: {
      ...safeChildEnvironment(),
      API_HOST: "127.0.0.1",
      API_PORT: "4175",
      SERVE_WEB: "false",
      IDENTITY_ENABLED: "true",
      IDENTITY_ORIGIN: origin,
      IDENTITY_SECRET: randomBytes(32).toString("hex"),
      ADMISSIONS_ENABLED: "true",
      ADMISSIONS_ENCRYPTION_KEY: randomBytes(32).toString("base64url"),
      MAIL_MODE: "disabled",
      MYSQL_HOST: settings.host,
      MYSQL_PORT: String(settings.port),
      MYSQL_DATABASE: settings.database,
      MYSQL_USER: settings.user,
      MYSQL_PASSWORD: settings.password,
    },
  });
  const closed = once(child, "exit");
  const api = await requests.newContext({ baseURL: origin });
  try {
    let ready = false;
    for (let n = 0; n < 100; n++) {
      try {
        ready = (await api.get("/health/ready", { timeout: 500 })).status() === 200;
      } catch {}
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(ready).toBe(true);
    const raw = await submit(api, origin);
    await login(api, origin);
    const app = await find(api, raw.email),
      approved = await decide(api, origin, app.id, 1, "approve"),
      token = await copy(api, origin, approved.invitationId);
    const invite = await api.get(`/api/v1/admin/invitations/${approved.invitationId}`);
    expect((await invite.json()).data.emailDelivery).toBe("not_requested");
    const publicClient = await requests.newContext({ baseURL: origin });
    try {
      const r = await publicClient.post("/api/v1/public/invitation-redemptions", {
        headers: {
          Origin: origin,
          "X-CSRF-Token": await csrf(publicClient),
          "Idempotency-Key": randomUUID(),
        },
        data: { invitationToken: token, password: password() },
      });
      expect(r.status()).toBe(201);
      expect(r.headers()["set-cookie"]).toBe(undefined);
    } finally {
      await publicClient.dispose();
    }
    const expInput = await submit(api, origin),
      exp = await find(api, expInput.email),
      expired = await decide(api, origin, exp.id, 1, "approve"),
      expiredToken = await copy(api, origin, expired.invitationId);
    const control = await testConnection();
    try {
      await control.execute(
        "UPDATE admissions_invitations SET expires_at=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND WHERE id=?",
        [expired.invitationId],
      );
    } finally {
      await control.end();
    }
    const r = await api.post("/api/v1/public/invitation-redemptions", {
      headers: { Origin: origin, "X-CSRF-Token": await csrf(api), "Idempotency-Key": randomUUID() },
      data: { invitationToken: expiredToken, password: password() },
    });
    expect(r.status()).toBe(409);
  } finally {
    await api.dispose();
    child.kill("SIGTERM");
    await closed;
  }
});
