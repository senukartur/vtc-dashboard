import assert from "node:assert/strict";

const origin = new URL(process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:5173");
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname) ||
  origin.username ||
  origin.password
) {
  throw new Error("This scaffold smoke check accepts only a credential-free local URL.");
}
const expectReady = process.env.SMOKE_EXPECT_READY !== "false";
const request = (path, headers = {}) =>
  fetch(new URL(path, origin), {
    headers,
    signal: AbortSignal.timeout(5000),
  });
const live = await request("/health/live");
assert.equal(live.status, 200);
assert.deepEqual(await live.json(), { status: "ok" });
const ready = await request("/health/ready");
assert.equal(ready.status, expectReady ? 200 : 503);
assert.deepEqual(await ready.json(), { status: expectReady ? "ready" : "not_ready" });
const page = await request("/", { accept: "text/html" });
assert.equal(page.status, 200);
const html = await page.text();
const modules = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)];
assert.ok(modules.length > 0, "Missing frontend module");
for (const module of modules) {
  const asset = new URL(module[1], origin);
  assert.equal(asset.origin, origin.origin);
  assert.equal((await request(asset.pathname)).status, 200);
}
const missing = await request("/api/v1/me", { accept: "text/html" });
assert.equal(missing.status, 404);
console.log(
  `Local HTTP/frontend smoke passed; database ${expectReady ? "ready" : "explicitly unavailable (negative path only)"}.`,
);
