import { createHmac } from "node:crypto";
import { guardedAllocation } from "../support/environment.ts";
import { expect, test } from "./support/fixtures.ts";

// Auth traces contain generated credentials/cookies; keep them out of artifact uploads.
test.use({ trace: "off", screenshot: "off", video: "off" });
test("built server accepts provisioned credential with browser cookies and rotates CSRF through logout", async ({
  context,
}) => {
  const fixture = {
    email: "browser@example.invalid",
    password: createHmac("sha256", guardedAllocation().token)
      .update("browser-identity-password")
      .digest("base64url"),
  };
  const pre = await context.request.get("/api/v1/auth/csrf");
  expect(pre.status()).toBe(200);
  const before = (await pre.json()) as { data: { token: string } };
  const login = await context.request.post("/api/v1/auth/login", {
    headers: { Origin: "http://127.0.0.1:4173", "X-CSRF-Token": before.data.token },
    data: fixture,
  });
  expect(login.status()).toBe(200);
  const current = await context.request.get("/api/v1/me");
  expect(current.status()).toBe(200);
  expect((await current.json()).data.member.nickname).toBe("Synthetic Browser Member");
  const cookies = await context.cookies();
  const session = cookies.find((cookie) => cookie.name === "vtc_dev_session");
  expect(
    Boolean(
      session?.httpOnly && session.sameSite === "Lax" && session.path === "/" && !session.secure,
    ),
  ).toBe(true);
  const stale = await context.request.post("/api/v1/auth/logout", {
    headers: { Origin: "http://127.0.0.1:4173", "X-CSRF-Token": before.data.token },
  });
  expect(stale.status()).toBe(403);
  const bound = await context.request.get("/api/v1/auth/csrf");
  const token = (await bound.json()).data.token as string;
  const loggedOut = await context.request.post("/api/v1/auth/logout", {
    headers: { Origin: "http://127.0.0.1:4173", "X-CSRF-Token": token },
  });
  expect(loggedOut.status()).toBe(200);
  expect((await context.request.get("/api/v1/me")).status()).toBe(401);
});
