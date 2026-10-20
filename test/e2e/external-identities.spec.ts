import { createHmac, randomUUID } from "node:crypto";
import { guardedAllocation } from "../support/environment.ts";
import { expect, test } from "./support/fixtures.ts";

test.use({ trace: "off", screenshot: "off", video: "off" });
test("built server binds Steam proof to browser session, links once and preserves password sign-in", async ({
  context,
}, info) => {
  const project = info.project.name.split("-")[0] ?? "";
  const password = createHmac("sha256", guardedAllocation().token)
    .update(`browser-steam-${project}`)
    .digest("base64url");
  const login = async () => {
    const csrf = await context.request.get("/api/v1/auth/csrf");
    const response = await context.request.post("/api/v1/auth/login", {
      headers: { Origin: "http://127.0.0.1:4173", "X-CSRF-Token": (await csrf.json()).data.token },
      data: { email: `browser-steam-${project}@example.invalid`, password },
    });
    expect(response.status()).toBe(200);
  };
  await login();
  const csrf = await context.request.get("/api/v1/auth/csrf");
  const start = await context.request.post("/api/v1/me/steam-verifications", {
    headers: {
      Origin: "http://127.0.0.1:4173",
      "X-CSRF-Token": (await csrf.json()).data.token,
      "Idempotency-Key": randomUUID(),
    },
  });
  expect(start.status()).toBe(200);
  const returned = new URL(
    new URL((await start.json()).data.verificationUrl).searchParams.get("openid.return_to") ?? "",
  );
  const query = returned.searchParams;
  const index = ["desktop", "tablet", "mobile"].indexOf(project),
    id = `7656119000000000${index + 1}`;
  for (const [name, value] of Object.entries({
    ns: "http://specs.openid.net/auth/2.0",
    mode: "id_res",
    op_endpoint: "https://steamcommunity.com/openid/login",
    claimed_id: `https://steamcommunity.com/openid/id/${id}`,
    identity: `https://steamcommunity.com/openid/id/${id}`,
    return_to: returned.toString(),
    response_nonce: `${new Date().toISOString().slice(0, 19)}Z${randomUUID()}`,
    assoc_handle: "synthetic",
    signed: "op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle",
    sig: Buffer.alloc(32, 1).toString("base64"),
  }))
    query.set(`openid.${name}`, value);
  const callback = `/api/v1/identity/steam/callback?${query}`;
  const completed = await context.request.get(callback, { maxRedirects: 0 });
  expect(completed.status()).toBe(303);
  expect(completed.headers().location).toBe("/api/v1/identity/steam/completed");
  expect((await context.request.get(callback, { maxRedirects: 0 })).status()).toBe(401);
  expect((await (await context.request.get("/api/v1/me")).json()).data.steamVerified).toBe(true);
  const identity = await context.request.get("/api/v1/me/identity");
  expect(identity.status()).toBe(200);
  expect((await identity.json()).data.truckersMp.found).toBe(false);
  await login();
  expect((await (await context.request.get("/api/v1/me")).json()).data.steamVerified).toBe(true);
});
