import { randomBytes } from "node:crypto";
import { expect, test } from "vitest";
import { validateIdentityConfig } from "../../apps/api/src/modules/identity/engine.ts";
import { csrfProtection } from "../../apps/api/src/modules/identity/http.ts";
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
