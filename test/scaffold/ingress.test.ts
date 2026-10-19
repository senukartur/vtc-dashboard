import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../../apps/api/src/app.ts";
import { readConfig } from "../../apps/api/src/platform/config/env.ts";
import { ingressTrust } from "../../apps/api/src/platform/http/ingress.ts";

test("ingress trusts only the configured literal or dotted mapped IPv4 at hop zero", () => {
  assert.equal(ingressTrust(), false);
  const trust = ingressTrust("192.0.2.5");
  assert.equal(typeof trust, "function");
  if (typeof trust !== "function") throw new Error("MISSING_TRUST_PREDICATE");
  for (const literal of ["192.0.2.5", "::ffff:192.0.2.5"]) {
    assert.equal(trust(literal, 0), true);
    assert.equal(trust(literal, 1), false);
  }
  for (const literal of ["192.0.2.6", "::ffff:c000:205", "::FFFF:192.0.2.5", "192.0.2.05", "::1"])
    assert.equal(trust(literal, 0), false);
  const database = {
    MYSQL_HOST: "db",
    MYSQL_PORT: "3306",
    MYSQL_DATABASE: "fixture",
    MYSQL_USER: "fixture",
    MYSQL_PASSWORD: "NONFUNCTIONAL_EXAMPLE_ONLY",
  };
  for (const value of [
    "",
    "true",
    "false",
    "192.0.2.0/24",
    "192.0.2.5,192.0.2.6",
    "proxy",
    "0.0.0.0",
    "127.0.0.1",
    "192.0.2.5:3000",
    "192.0.2.05",
    "255.255.255.255",
  ])
    assert.throws(
      () => readConfig({ ...database, API_TRUSTED_PROXY_IPV4: value }),
      /API_TRUSTED_PROXY_IPV4/,
    );
});

test("pinned Fastify resolves one exact trusted peer and ignores chains behind the immediate client", async () => {
  for (const proxyAddress of [undefined, "192.0.2.5"]) {
    const app = await createApp({
      checkReadiness: async () => true,
      ...(proxyAddress ? { proxyAddress } : {}),
    });
    app.get("/synthetic-ip", (request) => ({ ip: request.ip }));
    try {
      const request = (remoteAddress: string, forwarded?: string) =>
        app.inject({
          url: "/synthetic-ip",
          remoteAddress,
          headers: forwarded
            ? { "x-forwarded-for": forwarded, forwarded: "for=198.51.100.99" }
            : {},
        });
      assert.equal((await request("192.0.2.6", "198.51.100.1")).json().ip, "192.0.2.6");
      assert.equal((await request("192.0.2.5")).json().ip, "192.0.2.5");
      for (const remote of ["192.0.2.5", "::ffff:192.0.2.5"])
        assert.equal(
          (await request(remote, "198.51.100.99, 198.51.100.1")).json().ip,
          proxyAddress ? "198.51.100.1" : remote,
        );
    } finally {
      await app.close();
    }
  }
});
