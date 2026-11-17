import { createHmac, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { type AppOptions, createApp } from "../../apps/api/src/app.ts";
import {
  sessionCookieName,
  signedSessionToken,
} from "../../apps/api/src/modules/identity/engine.ts";
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

// The API package's own better-call, which Better Auth uses to sign and read the cookie.
const betterCall = createRequire(new URL("../../apps/api/package.json", import.meta.url))(
  "better-call",
);
async function libraryToken(header: string | undefined): Promise<string | null> {
  const context = await betterCall.createInternalContext(
    { headers: new Headers(header === undefined ? {} : { cookie: header }) },
    { options: {}, path: "/synthetic" },
  );
  const value: unknown = await context.getSignedCookie(sessionCookieName(config), config.secret);
  return typeof value === "string" ? value : null;
}

test("the in-process session signature check matches better-call for issued and hostile cookies", async () => {
  expect(sessionCookieName(config)).toBe("vtc_dev_session");
  expect(sessionCookieName({ ...config, origin: "https://dashboard.example.invalid" })).toBe(
    "__Host-vtc_session",
  );
  const name = sessionCookieName(config),
    token = "SyntheticSessionToken0123456789ab";
  const issue = async (value: string, secret = config.secret) =>
    ((await betterCall.serializeSignedCookie(name, value, secret)) as string).split(
      ";",
    )[0] as string;
  const issued = await issue(token);
  const raw = decodeURIComponent(issued.slice(name.length + 1));
  const signature = raw.slice(raw.lastIndexOf(".") + 1);
  const cases = [
    undefined,
    "",
    "synthetic-unrelated=1",
    issued,
    `synthetic-unrelated=1; ${issued}`,
    `  ${issued}  `,
    `${issued}; ${name}=synthetic-junk`,
    `${name}=synthetic-junk; ${issued}`,
    `${name}="${raw}"`,
    `${name}=${raw}`,
    `__Host-vtc_session=${encodeURIComponent(raw)}`,
    await issue(token, randomBytes(32).toString("hex")),
    await issue("Synthetic.dotted.token"),
    `${name}=${encodeURIComponent(`.${signature}`)}`,
    `${name}=${encodeURIComponent(`${token}.${signature.slice(0, -1)}`)}`,
    `${name}=${encodeURIComponent(`${token}.${signature.slice(0, -2)}==`)}`,
    `${name}=${encodeURIComponent(`${token}.${"*".repeat(43)}=`)}`,
    `${name}=${encodeURIComponent(`${token}x.${signature}`)}`,
    `${name}=${token}.${createHmac("sha256", config.secret).update(token).digest("base64url")}`,
    `${name}=%E0%A4%A`,
  ];
  for (const header of cases)
    expect(signedSessionToken(config, header), String(header)).toBe(await libraryToken(header));
  // Sanity: the library itself accepts the issued forms and the dotted token.
  expect(signedSessionToken(config, issued)).toBe(token);
  expect(signedSessionToken(config, `${name}=${raw}`)).toBe(token);
  expect(signedSessionToken(config, cases[12])).toBe("Synthetic.dotted.token");
  expect(signedSessionToken(config, cases[11])).toBeNull();
});
