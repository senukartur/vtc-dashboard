import { createQualificationInitialization } from "../../../apps/api/src/modules/qualifications/initialization.ts";
import { createHmac, randomUUID } from "node:crypto";
import { request, type APIRequestContext } from "@playwright/test";
import { mailCrypto } from "../../../apps/api/src/modules/messaging/content.ts";
import { guardedAllocation } from "../../support/environment.ts";
import { testConnection } from "../../persistence/support.ts";
import { guardedSettings } from "../../persistence/support.ts";
import { createUnitOfWork } from "@vtc/db";
import { createIdentity } from "../../../apps/api/src/modules/identity/service.ts";
import { identityAccessEvents } from "../../../apps/api/src/platform/outbox/events.ts";
// Available only under the launcher's allocation + ownership guards. Never write plaintext inboxes.
export function accountSecret(kind: "identity" | "mail" | "password") {
  return createHmac("sha256", guardedAllocation().token)
    .update(`browser-account-${kind}`)
    .digest("hex");
}
export function browserAdmissionsKey() {
  return createHmac("sha256", guardedAllocation().token)
    .update("browser-account-admissions")
    .digest("base64url");
}
export const origin = "http://127.0.0.1:4173";
export async function resetAccountLimits() {
  const connection = await testConnection();
  try {
    await connection.query("DELETE FROM identity_limits");
    await connection.query("DELETE FROM admissions_limits");
  } finally {
    await connection.end();
  }
}
export async function csrf(context: APIRequestContext) {
  const response = await context.get("/api/v1/auth/csrf");
  if (response.status() !== 200) throw new Error("ACCOUNT_FIXTURE_CSRF_FAILED");
  return (await response.json()).data.token as string;
}
export async function write(
  context: APIRequestContext,
  path: string,
  data?: unknown,
  etag?: string,
) {
  return context.post(`/api/v1${path}`, {
    headers: {
      Origin: origin,
      "X-CSRF-Token": await csrf(context),
      "Idempotency-Key": randomUUID(),
      ...(etag ? { "If-Match": etag } : {}),
    },
    ...(data === undefined ? {} : { data }),
  });
}
export async function staffContext() {
  const context = await request.newContext({ baseURL: origin });
  const password = createHmac("sha256", guardedAllocation().token)
    .update("browser-identity-password")
    .digest("base64url");
  const result = await write(context, "/auth/login", {
    email: "browser@example.invalid",
    password,
  });
  if (result.status() !== 200) {
    await context.dispose();
    throw new Error("ACCOUNT_FIXTURE_STAFF_LOGIN_FAILED");
  }
  return context;
}
export async function approveInvitation(staff: APIRequestContext, email: string) {
  const result = await staff.get("/api/v1/admin/applications?limit=100");
  if (result.status() !== 200) throw new Error("ACCOUNT_FIXTURE_DISCOVERY_FAILED");
  const body = (await result.json()).data as {
    items: { id: string; version: number; fields: { email: string } }[];
  };
  const application = body.items.find((item) => item.fields.email === email);
  if (!application) throw new Error("ACCOUNT_FIXTURE_APPLICATION_MISSING");
  const approved = await write(
    staff,
    `/admin/applications/${application.id}/decisions`,
    { decision: "approve" },
    `"v${application.version}"`,
  );
  if (approved.status() !== 200) throw new Error("ACCOUNT_FIXTURE_APPROVAL_FAILED");
  const invitationId = (await approved.json()).data.invitationId as string;
  const copy = await write(
    staff,
    `/admin/invitations/${invitationId}/copy-link`,
    undefined,
    '"v1"',
  );
  if (copy.status() !== 200) throw new Error("ACCOUNT_FIXTURE_COPY_FAILED");
  return { invitationId, link: (await copy.json()).data.link as string };
}
export async function createInvitation(visitor: APIRequestContext, staff: APIRequestContext) {
  const email = `${randomUUID()}@example.invalid`;
  const result = await write(visitor, "/public/applications", {
    nickname: "Fictional Account Member",
    email,
    steamProfileUrl: "https://steamcommunity.com/id/fictional-account",
    games: ["ets2", "ats"],
  });
  if (result.status() !== 201) throw new Error("ACCOUNT_FIXTURE_APPLICATION_FAILED");
  return { email, ...(await approveInvitation(staff, email)) };
}
export async function privateMail(userId: string, kind: string, stage?: string) {
  const connection = await testConnection();
  try {
    const [rows] = await connection.execute(
      "SELECT id, ciphertext FROM mail_deliveries WHERE user_id=? AND kind=? AND ciphertext IS NOT NULL ORDER BY created_at DESC LIMIT 10",
      [userId, kind],
    );
    for (const row of rows as { id: string | Buffer; ciphertext: string }[]) {
      const decoded = mailCrypto(accountSecret("mail")).open(String(row.id), row.ciphertext);
      if (!stage || decoded.intent.stage === stage)
        return { id: String(row.id), code: decoded.intent.code ?? "" };
    }
    throw new Error("ACCOUNT_FIXTURE_MAIL_MISSING");
  } catch {
    throw new Error("ACCOUNT_FIXTURE_MAIL_UNAVAILABLE");
  } finally {
    await connection.end();
  }
}
export async function deactivateFixtureMember(
  staff: APIRequestContext,
  userId: string,
  version: number,
) {
  const unit = createUnitOfWork(guardedSettings());
  try {
    const identity = createIdentity(
      unit,
      { secret: accountSecret("identity"), origin, production: false },
      {
        accessEvents: identityAccessEvents(unit),
        qualificationsLifecycle: createQualificationInitialization(unit),
      },
    );
    const state = await staff.storageState();
    const actor = await identity.authenticate(
      new Headers({
        cookie: state.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "),
      }),
    );
    await identity.administer(actor, userId, randomUUID(), version, { kind: "deactivate" });
  } catch {
    throw new Error("ACCOUNT_FIXTURE_DEACTIVATION_FAILED");
  } finally {
    await unit.close();
  }
}
export async function expireFixtureInvitation(id: string) {
  const connection = await testConnection();
  try {
    await connection.execute(
      "UPDATE admissions_invitations SET expires_at=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND WHERE id=?",
      [id],
    );
  } finally {
    await connection.end();
  }
}
