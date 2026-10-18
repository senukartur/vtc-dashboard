import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { components } from "@vtc/contracts";
import { applicationId } from "@vtc/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { IdentityConfig } from "./engine.js";
import { type Actor, type Identity, identityError } from "./service.js";

type Schemas = components["schemas"];
const ref = (name: string) => ({ $ref: `urn:vtc:browser:v1#/$defs/${name}` });

export function csrfProtection(config: IdentityConfig, now: () => number = Date.now) {
  const cookieName = config.production ? "__Host-vtc_csrf" : "vtc_dev_csrf";
  const sign = (value: string) =>
    createHmac("sha256", config.secret).update(`csrf:${value}`).digest("base64url");
  const equal = (a: string, b: string) => {
    const aa = Buffer.from(a),
      bb = Buffer.from(b);
    return aa.length === bb.length && timingSafeEqual(aa, bb);
  };
  const signed = (value: string) => `${value}.${sign(value)}`;
  const verify = (value: string | undefined) => {
    if (!value || value.length > 512) return null;
    const split = value.lastIndexOf("."),
      payload = value.slice(0, split);
    return split > 0 && equal(sign(payload), value.slice(split + 1)) ? payload : null;
  };
  const cookie = (value: string, maxAge: number) =>
    `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.production ? "; Secure" : ""}`;
  function preSession(headers: { cookie?: string | undefined }): string | null {
    const raw = headers.cookie
      ?.split(";")
      .map((part) => part.trim())
      .filter((part) => part.startsWith(`${cookieName}=`));
    if (raw?.length !== 1) return null;
    const payload = verify(raw[0]?.slice(cookieName.length + 1));
    if (!payload) return null;
    const [nonce, expiry] = payload.split(":");
    if (!nonce || !/^[a-zA-Z0-9_-]{43}$/.test(nonce) || !expiry || Number(expiry) <= now())
      return null;
    return payload;
  }
  return {
    issue(headers: { cookie?: string | undefined }, actor?: Actor) {
      const pre =
        preSession(headers) ?? `${randomBytes(32).toString("base64url")}:${now() + 1800000}`;
      const binding = actor ? `session:${actor.sessionId}` : `pre:${pre}`;
      return {
        token: signed(`${binding}|${now() + 1800000}`),
        cookie: actor ? cookie("", 0) : cookie(signed(pre), 1800),
        scope: binding,
      };
    },
    check(
      request: {
        headers: {
          origin?: string | undefined;
          cookie?: string | undefined;
          "x-csrf-token"?: string | string[] | undefined;
        };
      },
      actor?: Actor,
    ) {
      const supplied = request.headers["x-csrf-token"];
      if (request.headers.origin !== config.origin || typeof supplied !== "string")
        throw identityError(403);
      const payload = verify(supplied),
        split = payload?.lastIndexOf("|") ?? -1;
      if (!payload || split < 0 || Number(payload.slice(split + 1)) <= now())
        throw identityError(403);
      const pre = preSession(request.headers),
        expected = actor ? `session:${actor.sessionId}` : pre ? `pre:${pre}` : "";
      if (!expected || !equal(payload.slice(0, split), expected)) throw identityError(403);
      return expected;
    },
    clear: () => cookie("", 0),
  };
}

export async function registerIdentityRoutes(app: FastifyInstance, identity: Identity) {
  const ownedRoute = (route: string) =>
    route.startsWith("/api/v1/auth/") || route === "/api/v1/me" || route.startsWith("/api/v1/me/");
  app.addHook("onRequest", async (request) => {
    const route = request.routeOptions.url;
    if (!route || !ownedRoute(route)) return;
    const category =
      route === "/api/v1/auth/csrf"
        ? "csrf"
        : route === "/api/v1/auth/login"
          ? "login"
          : request.method === "GET"
            ? "read"
            : [
                  "/api/v1/auth/password-reset-requests",
                  "/api/v1/me/email-verification-requests",
                  "/api/v1/me/credential-challenges",
                ].includes(route)
              ? "challenge"
              : "command";
    // Admission precedes parsing, authentication and every locked identity read.
    // request.ip is the direct socket address: forwarded headers are not trusted.
    await identity.rateLimit(category, request.ip);
  });
  app.addHook("preValidation", async (request) => {
    const route = request.routeOptions.url;
    if (!route || !ownedRoute(route) || !["POST", "PATCH"].includes(request.method)) return;
    if (
      request.body !== undefined &&
      request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !== "application/json"
    )
      throw identityError(415);
    if (
      ["/api/v1/auth/logout", "/api/v1/me/email-verification-requests"].includes(route) &&
      request.body !== undefined
    )
      throw identityError(422);
  });
  const csrf = csrfProtection(identity.config);
  const headers = (request: FastifyRequest) =>
    new Headers(request.headers.cookie ? { cookie: request.headers.cookie } : {});
  const actor = (request: FastifyRequest) => identity.authenticate(headers(request));
  async function optionalActor(request: FastifyRequest) {
    try {
      return await actor(request);
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "statusCode" in error &&
        [401, 409].includes(Number(error.statusCode))
      )
        return undefined;
      throw error;
    }
  }
  const key = (request: FastifyRequest) => {
    const value = request.headers["idempotency-key"];
    if (typeof value !== "string") throw identityError(422);
    try {
      return applicationId(value);
    } catch {
      throw identityError(422);
    }
  };
  const envelope = (data: unknown, request: FastifyRequest) => ({
    data,
    meta: { requestId: request.id },
  });
  const schema = (response: string, body?: string, status = 200) => ({
    ...(body ? { body: ref(body) } : {}),
    response: { [status]: ref(response) },
  });
  app.get("/api/v1/auth/csrf", { schema: schema("EnvelopeCsrf") }, async (request, reply) => {
    const issued = csrf.issue(request.headers, await optionalActor(request));
    reply.header("Set-Cookie", issued.cookie);
    return envelope({ token: issued.token }, request);
  });
  app.post<{ Body: Schemas["LoginInput"] }>(
    "/api/v1/auth/login",
    { schema: schema("EnvelopeSelf", "LoginInput") },
    async (request, reply) => {
      csrf.check(request, await optionalActor(request));
      const result = await identity.login(request.body.email, request.body.password);
      reply
        .header("Set-Cookie", [...result.cookies, csrf.clear()])
        .header("ETag", `"v${result.version}"`);
      return envelope(result.data, request);
    },
  );
  app.post(
    "/api/v1/auth/logout",
    { schema: schema("EnvelopeCommandResult") },
    async (request, reply) => {
      const current = await actor(request);
      csrf.check(request, current);
      const result = await identity.logout(current, headers(request));
      reply.header("Set-Cookie", [...result.cookies, csrf.clear()]);
      return envelope({ id: result.id, version: result.version }, request);
    },
  );
  app.get("/api/v1/me", { schema: schema("EnvelopeSelf") }, async (request, reply) => {
    const result = await identity.current(await actor(request));
    reply.header("ETag", `"v${result.version}"`);
    return envelope(result.data, request);
  });
  app.post<{ Body: Schemas["PasswordResetRequest"] }>(
    "/api/v1/auth/password-reset-requests",
    { schema: schema("EnvelopeAcknowledged", "PasswordResetRequest", 202) },
    async (request, reply) => {
      const scope = csrf.check(request, await optionalActor(request));
      const result = await identity.requestReset(scope, key(request), request.body.email);
      return reply.code(202).send(envelope(result, request));
    },
  );
  app.post<{ Body: Schemas["PasswordResetInput"] }>(
    "/api/v1/auth/password-resets",
    { schema: schema("EnvelopeCommandResult", "PasswordResetInput") },
    async (request) => {
      const scope = csrf.check(request, await optionalActor(request));
      return envelope(
        await identity.resetPassword(
          scope,
          key(request),
          request.body.token,
          request.body.newPassword,
        ),
        request,
      );
    },
  );
  app.post(
    "/api/v1/me/email-verification-requests",
    { schema: schema("EnvelopeChallenge", undefined, 202) },
    async (request, reply) => {
      const current = await actor(request);
      csrf.check(request, current);
      return reply
        .code(202)
        .send(
          envelope(
            await identity.requestChallenge(current, key(request), "email_verification"),
            request,
          ),
        );
    },
  );
  app.post<{ Body: Schemas["EmailVerificationInput"] }>(
    "/api/v1/me/email-verifications",
    { schema: schema("EnvelopeCommandResult", "EmailVerificationInput") },
    async (request) => {
      const current = await actor(request);
      csrf.check(request, current);
      return envelope(
        await identity.confirmChallenge(current, key(request), {
          purpose: "email_verification",
          ...request.body,
        }),
        request,
      );
    },
  );
  app.patch<{ Body: Schemas["PreferencesInput"] }>(
    "/api/v1/me/preferences",
    { schema: schema("EnvelopePreferences", "PreferencesInput") },
    async (request, reply) => {
      const current = await actor(request);
      csrf.check(request, current);
      const match = request.headers["if-match"];
      if (typeof match !== "string") throw identityError(428);
      if (!/^"v[1-9][0-9]*"$/.test(match)) throw identityError(422);
      const result = await identity.preferences(
        current,
        key(request),
        Number(match.slice(2, -1)),
        request.body,
      );
      reply.header("ETag", `"v${result.version}"`);
      return envelope({ locale: result.locale, displayTimezone: result.displayTimezone }, request);
    },
  );
  app.post<{ Body: Schemas["CredentialChallengeInput"] }>(
    "/api/v1/me/credential-challenges",
    { schema: schema("EnvelopeChallenge", "CredentialChallengeInput", 202) },
    async (request, reply) => {
      const current = await actor(request);
      csrf.check(request, current);
      return reply
        .code(202)
        .send(
          envelope(
            await identity.requestChallenge(
              current,
              key(request),
              request.body.purpose,
              "newEmail" in request.body ? request.body.newEmail : null,
            ),
            request,
          ),
        );
    },
  );
  app.post<{ Body: Schemas["CredentialChangeInput"] }>(
    "/api/v1/me/credential-changes",
    { schema: schema("EnvelopeCommandResult", "CredentialChangeInput") },
    async (request) => {
      const current = await actor(request);
      csrf.check(request, current);
      return envelope(
        await identity.confirmChallenge(current, key(request), {
          purpose: request.body.kind,
          challengeId: request.body.challengeId,
          code: request.body.code,
          ...("newPassword" in request.body ? { newPassword: request.body.newPassword } : {}),
        }),
        request,
      );
    },
  );
}
