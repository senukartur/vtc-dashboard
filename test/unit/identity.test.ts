import { randomBytes } from "node:crypto";
import { expect, test } from "vitest";
import { validateIdentityConfig } from "../../apps/api/src/modules/identity/engine.ts";
import { csrfProtection } from "../../apps/api/src/modules/identity/http.ts";
import { capabilities, type Role } from "../../apps/api/src/modules/identity/permissions.ts";
import { readConfig } from "../../apps/api/src/platform/config/env.ts";

const config = {
  secret: randomBytes(32).toString("hex"),
  origin: "https://dashboard.example.invalid",
  production: true,
};
const actor = (sessionId: string) => ({
  userId: "synthetic",
  sessionId,
  accessEpoch: 1,
  credentialEpoch: 1,
  capabilities: [],
});

test.each<{
  roles: Role[];
  submit: boolean;
  respond: boolean;
  review: boolean;
  administer: boolean;
  transfer: boolean;
}>([
  { roles: [], submit: false, respond: false, review: false, administer: false, transfer: false },
  {
    roles: ["trainee"],
    submit: true,
    respond: true,
    review: false,
    administer: false,
    transfer: false,
  },
  {
    roles: ["driver"],
    submit: true,
    respond: true,
    review: false,
    administer: false,
    transfer: false,
  },
  {
    roles: ["dispatcher"],
    submit: false,
    respond: false,
    review: true,
    administer: false,
    transfer: false,
  },
  {
    roles: ["deputy_director"],
    submit: false,
    respond: false,
    review: true,
    administer: true,
    transfer: false,
  },
  {
    roles: ["director"],
    submit: false,
    respond: false,
    review: true,
    administer: true,
    transfer: true,
  },
  {
    roles: ["driver", "director"],
    submit: true,
    respond: true,
    review: true,
    administer: true,
    transfer: true,
  },
])(
  "approved permission matrix for $roles preserves universal private reads and member-role actions",
  (row) => {
    const assigned = capabilities(row.roles);
    expect(assigned.includes("company.read")).toBe(true);
    expect(assigned.includes("trips.read_own_private")).toBe(true);
    expect(assigned.includes("trips.submit_own")).toBe(row.submit);
    expect(assigned.includes("events.respond")).toBe(row.respond);
    expect(assigned.includes("trips.review")).toBe(row.review);
    expect(assigned.includes("members.manage")).toBe(row.administer);
    expect(assigned.includes("leadership.transfer")).toBe(row.transfer);
  },
);

test("HTTPS cookie policy survives an unset NODE_ENV and HTTP is limited to exact local origins", () => {
  const enabled = readConfig({
    MYSQL_HOST: "127.0.0.1",
    MYSQL_PORT: "3307",
    MYSQL_DATABASE: "synthetic",
    MYSQL_USER: "synthetic",
    MYSQL_PASSWORD: "NONFUNCTIONAL_EXAMPLE_ONLY",
    IDENTITY_ENABLED: "true",
    IDENTITY_ORIGIN: config.origin,
    IDENTITY_SECRET: config.secret,
  }).identity;
  if (!enabled) throw new Error("SYNTHETIC_CONFIG_MISSING");
  expect(enabled.production).toBe(false);
  const secure = csrfProtection(enabled);
  for (const cookie of [secure.issue({}).cookie, secure.clear()])
    expect(cookie.startsWith("__Host-vtc_csrf=") && cookie.includes("; Secure")).toBe(true);
  for (const origin of ["http://localhost", "http://127.0.0.1:5173", "http://[::1]:5173"]) {
    const local = { ...config, origin, production: false };
    expect(() => validateIdentityConfig(local)).not.toThrow();
    const csrf = csrfProtection(local);
    for (const cookie of [csrf.issue({}).cookie, csrf.clear()])
      expect(cookie.startsWith("vtc_dev_csrf=") && !cookie.includes("; Secure")).toBe(true);
    expect(() => validateIdentityConfig({ ...local, production: true })).toThrow();
  }
  for (const origin of [
    "http://dashboard.example.invalid",
    "http://localhost.example.invalid",
    "http://evil-localhost",
    "http://localhost.",
    "http://127.0.0.2",
    "http://127.0.0.1.example.invalid",
    "http://127.1",
    "http://[::2]",
  ])
    expect(() => validateIdentityConfig({ ...config, origin, production: false })).toThrow();
});
test("signed pre-session and session CSRF reject cross-session, forged, stale, missing and cross-origin writes", () => {
  let now = 1800000;
  const csrf = csrfProtection(config, () => now);
  const pre = csrf.issue({});
  const cookie = pre.cookie.split(";")[0] ?? "";
  expect(
    pre.cookie.includes("__Host-vtc_csrf=") &&
      pre.cookie.includes("HttpOnly") &&
      pre.cookie.includes("Secure") &&
      !pre.cookie.includes("Domain="),
  ).toBe(true);
  const request = { headers: { origin: config.origin, cookie, "x-csrf-token": pre.token } };
  expect(csrf.check(request).startsWith("pre:")).toBe(true);
  for (const headers of [
    { ...request.headers, origin: "https://foreign.example.invalid" },
    { ...request.headers, "x-csrf-token": "forged" },
    { ...request.headers, cookie: "" },
    { ...request.headers, "x-csrf-token": undefined },
  ])
    expect(() => csrf.check({ headers })).toThrow();
  const bound = csrf.issue({}, actor("one"));
  const signed = { headers: { origin: config.origin, "x-csrf-token": bound.token } };
  expect(csrf.check(signed, actor("one"))).toBe("session:one");
  expect(() => csrf.check(signed, actor("two"))).toThrow();
  expect(() => csrf.check(request, actor("one"))).toThrow();
  now += 1800000;
  expect(() => csrf.check(request)).toThrow();
  expect(() => csrf.check(signed, actor("one"))).toThrow();
});
test("identity rollout is disabled by default, opt-in validates exact origin and private secret without changing old startup", () => {
  const env = {
    MYSQL_HOST: "127.0.0.1",
    MYSQL_PORT: "3307",
    MYSQL_DATABASE: "synthetic",
    MYSQL_USER: "synthetic",
    MYSQL_PASSWORD: "NONFUNCTIONAL_EXAMPLE_ONLY",
  };
  expect(readConfig(env).identity).toBeUndefined();
  expect(() => readConfig({ ...env, IDENTITY_ENABLED: "true" })).toThrow(
    "Invalid environment fields",
  );
  expect(() =>
    validateIdentityConfig({ ...config, origin: "http://dashboard.example.invalid" }),
  ).toThrow();
  expect(() =>
    validateIdentityConfig({ ...config, origin: "https://dashboard.example.invalid/path" }),
  ).toThrow();
  expect(
    readConfig({
      ...env,
      NODE_ENV: "production",
      IDENTITY_ENABLED: "true",
      IDENTITY_ORIGIN: config.origin,
      IDENTITY_SECRET: config.secret,
    }).identity?.production,
  ).toBe(true);
});
