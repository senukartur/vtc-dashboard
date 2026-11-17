import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { type AppOptions, createApp } from "../../apps/api/src/app.ts";
import { type Identity, identityError } from "../../apps/api/src/modules/identity/service.ts";

// Admission routing only: every service is a fake whose operations fail, and
// authentication rejects, so no handler or database work runs after admission.
const config = {
  secret: randomBytes(32).toString("hex"),
  origin: "http://127.0.0.1:4173",
  production: false,
};
const cookie = "vtc_dev_session=synthetic-read-admission";
const id = "41000000-0000-4000-8000-000000000001";
const other = "41000000-0000-4000-8000-000000000002";
const admitRead = vi.fn(async (_source: string, _cookie: string | undefined) => {});
const rateLimit = vi.fn(async (_category: string, _source: string) => {});
const authenticate = vi.fn(async () => {
  throw identityError(401);
});
function fake<T>(known: Record<string, unknown> = {}): T {
  return new Proxy(known, {
    get: (target, key) =>
      key in target
        ? target[key as string]
        : key === "then"
          ? undefined
          : async () => {
              throw identityError(401);
            },
  }) as T;
}
let app: Awaited<ReturnType<typeof createApp>>;

beforeAll(async () => {
  const identity = fake<Identity>({ config, admitRead, rateLimit, authenticate });
  const options: AppOptions = {
    checkReadiness: async () => true,
    identity,
    administration: fake(),
    messaging: fake(),
    externalIdentities: fake(),
    manualReports: fake({ config: {}, initialize: async () => {} }),
    qualifications: fake(),
    events: fake({ publishedRoutesEnabled: true, drafts: undefined }),
    eventMedia: fake({
      config: { maxFileBytes: 1024, timeoutMs: 1000 },
      initialize: async () => {},
    }),
    reconciliation: fake(),
    tripDecisions: fake({ config: { dispatchReviewStage3Enabled: false } }),
    analytics: fake(),
    notifications: fake(),
  };
  app = await createApp(options);
});
afterAll(async () => {
  await app?.close();
});
beforeEach(() => {
  admitRead.mockClear();
  rateLimit.mockClear();
});

const memberReads = [
  "/api/v1/me",
  "/api/v1/me/email-change",
  "/api/v1/members",
  `/api/v1/members/${id}`,
  "/api/v1/admin/members",
  "/api/v1/admin/audit",
  "/api/v1/analytics/company",
  "/api/v1/analytics/leaderboard",
  `/api/v1/members/${id}/analytics`,
  "/api/v1/events",
  `/api/v1/events/${id}/participants`,
  "/api/v1/admin/events",
  "/api/v1/me/upcoming-event",
  `/api/v1/events/${id}/media`,
  `/api/v1/events/${id}/media/${other}/content`,
  `/api/v1/admin/events/${id}/media`,
  `/api/v1/admin/members/${id}/identity`,
  `/api/v1/admin/members/${id}/steam-replacement-verifications/${other}`,
  "/api/v1/identity/steam/callback",
  "/api/v1/me/identity",
  `/api/v1/mail-deliveries/${id}`,
  "/api/v1/notifications",
  "/api/v1/notifications/history",
  "/api/v1/me/notification-preferences",
  `/api/v1/members/${id}/qualifications`,
  "/api/v1/me/qualifications",
  "/api/v1/reconciliation-candidates",
  `/api/v1/reconciliations/${id}`,
  `/api/v1/trips/${id}/review`,
  `/api/v1/trips/${id}/proposals`,
  `/api/v1/manual-reports/${id}`,
  `/api/v1/evidence/${id}`,
  "/api/v1/me/manual-drafts",
  "/api/v1/me/upload-policy",
  "/api/v1/me/manual-reports",
];

test.each(memberReads)(
  "GET %s is admitted exactly once by the member read admission",
  async (url) => {
    const response = await app.inject({ url, headers: { cookie } });
    expect(response.statusCode).not.toBe(404);
    expect(admitRead.mock.calls).toEqual([["127.0.0.1", cookie]]);
    expect(rateLimit).not.toHaveBeenCalled();
  },
);

test.each([
  "/api/v1/public/company-stats",
  "/api/v1/public/events",
  `/api/v1/public/events/${id}/cover`,
])("anonymous GET %s keeps the source read budget and never reads the cookie", async (url) => {
  const response = await app.inject({ url, headers: { cookie } });
  expect(response.statusCode).not.toBe(404);
  expect(rateLimit.mock.calls).toEqual([["read", "127.0.0.1"]]);
  expect(admitRead).not.toHaveBeenCalled();
});

test.each([
  ["POST", "/api/v1/notifications/read-all"],
  ["POST", "/api/v1/reconciliations"],
  ["PATCH", "/api/v1/me/preferences"],
  ["POST", "/api/v1/me/manual-drafts"],
  ["POST", `/api/v1/admin/events/${id}/cancellation`],
  ["POST", `/api/v1/mail-deliveries/${id}/resends`],
] as const)("%s %s keeps the unchanged command admission", async (method, url) => {
  const response = await app.inject({ method, url, headers: { cookie } });
  expect(response.statusCode).not.toBe(404);
  expect(rateLimit.mock.calls.length).toBeGreaterThan(0);
  expect(rateLimit.mock.calls.every(([category]) => category === "command")).toBe(true);
  expect(admitRead).not.toHaveBeenCalled();
});
