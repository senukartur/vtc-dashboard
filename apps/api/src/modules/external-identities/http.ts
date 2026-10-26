import type { components } from "@vtc/contracts";
import { applicationId } from "@vtc/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { csrfProtection } from "../identity/http.js";
import { type Identity, identityError } from "../identity/service.js";
import type { ExternalIdentities } from "./service.js";

const ref = (name: string) => ({ $ref: `urn:vtc:browser:v1#/$defs/${name}` });
const identifier = {
  type: "string",
  format: "uuid",
  pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
};
export async function registerExternalIdentityRoutes(
  app: FastifyInstance,
  identity: Identity,
  external: ExternalIdentities,
) {
  const csrf = csrfProtection(identity.config);
  const actor = (request: FastifyRequest) =>
    identity.authenticate(
      new Headers(request.headers.cookie ? { cookie: request.headers.cookie } : {}),
    );
  const envelope = (data: unknown, request: FastifyRequest) => ({
    data,
    meta: { requestId: request.id },
  });
  const key = (request: FastifyRequest) => {
    try {
      return applicationId(request.headers["idempotency-key"] as string);
    } catch {
      throw identityError(422);
    }
  };
  const params = (...names: string[]) => ({
    type: "object",
    properties: Object.fromEntries(names.map((name) => [name, identifier])),
    required: names,
    additionalProperties: false,
  });
  const ownedAdmin = (route: string) =>
    route.startsWith("/api/v1/admin/members/") &&
    (route.includes("/steam-replacement") || route.endsWith("/identity"));
  app.addHook("onRequest", async (request, reply) => {
    const route = request.routeOptions.url;
    if (route === "/api/v1/identity/steam/callback" || route === "/api/v1/identity/steam/completed")
      reply
        .header("Referrer-Policy", "no-referrer")
        .header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
        .header("Cache-Control", "no-store");
    // /me routes already use the identity module's persistent early admission hook.
    if (route && (ownedAdmin(route) || route === "/api/v1/identity/steam/callback"))
      await identity.rateLimit(request.method === "GET" ? "read" : "command", request.ip);
  });
  app.addHook("preValidation", async (request) => {
    const route = request.routeOptions.url;
    if (
      request.method !== "POST" ||
      !route ||
      (!ownedAdmin(route) && !route.startsWith("/api/v1/me/steam-"))
    )
      return;
    if (
      request.body !== undefined &&
      request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !== "application/json"
    )
      throw identityError(415);
    if (route.endsWith("verifications") && request.body !== undefined) throw identityError(422);
  });
  app.get<{ Params: { memberId: string } }>(
    "/api/v1/admin/members/:memberId/identity",
    { schema: { params: params("memberId"), response: { 200: ref("EnvelopeIdentity") } } },
    async (request, reply) => {
      const result = await external.staffCurrent(await actor(request), request.params.memberId);
      reply.header("ETag", `"v${result.version}"`);
      return envelope(result.data, request);
    },
  );
  app.get(
    "/api/v1/me/identity",
    { schema: { response: { 200: ref("EnvelopeIdentity") } } },
    async (request, reply) => {
      const result = await external.current(await actor(request));
      reply.header("ETag", `"v${result.version}"`);
      return envelope(result.data, request);
    },
  );
  for (const [path, purpose] of [
    ["steam-verifications", "initial"],
    ["steam-replacement-verifications", "replacement"],
  ] as const) {
    app.post(
      `/api/v1/me/${path}`,
      { schema: { response: { 200: ref("EnvelopeIdentityVerification") } } },
      async (request) => {
        const current = await actor(request);
        csrf.check(request, current);
        return envelope(await external.request(current, key(request), purpose), request);
      },
    );
  }
  // Steam's redirect cannot send the JSON API's Origin/CSRF headers. Signed return_to,
  // keyed state, initiating session and current security epochs are its dedicated guard.
  app.get("/api/v1/identity/steam/callback", async (request, reply) => {
    reply
      .header("Referrer-Policy", "no-referrer")
      .header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
      .header("Cache-Control", "no-store");
    await external.callback(await actor(request), request.url.split("?").slice(1).join("?"));
    return reply.redirect("/api/v1/identity/steam/completed", 303);
  });
  app.get("/api/v1/identity/steam/completed", async (_request, reply) =>
    reply
      .header("Referrer-Policy", "no-referrer")
      .header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
      .type("text/plain")
      .send("Steam verification completed. Return to your account."),
  );
  app.get<{ Params: { verificationId: string } }>(
    "/api/v1/me/steam-replacement-verifications/:verificationId",
    {
      schema: {
        params: params("verificationId"),
        response: { 200: ref("EnvelopeSteamReplacementProof") },
      },
    },
    async (request) =>
      envelope(
        await external.inspect(await actor(request), request.params.verificationId),
        request,
      ),
  );
  app.get<{ Params: { memberId: string; verificationId: string } }>(
    "/api/v1/admin/members/:memberId/steam-replacement-verifications/:verificationId",
    {
      schema: {
        params: params("memberId", "verificationId"),
        response: { 200: ref("EnvelopeSteamReplacementProof") },
      },
    },
    async (request) =>
      envelope(
        await external.inspect(
          await actor(request),
          request.params.verificationId,
          request.params.memberId,
          true,
        ),
        request,
      ),
  );
  app.get<{ Params: { memberId: string }; Querystring: { limit?: number; cursor?: string } }>(
    "/api/v1/admin/members/:memberId/steam-replacement-verifications",
    {
      schema: {
        params: params("memberId"),
        querystring: {
          type: "object",
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 100 },
            cursor: { type: "string", minLength: 1, maxLength: 2048 },
          },
          additionalProperties: false,
        },
        response: { 200: ref("EnvelopeListSteamReplacementProof") },
      },
    },
    async (request) =>
      envelope(
        await external.list(await actor(request), request.params.memberId, request.query),
        request,
      ),
  );
  app.post<{ Params: { memberId: string }; Body: components["schemas"]["SteamReplacementInput"] }>(
    "/api/v1/admin/members/:memberId/steam-replacement",
    {
      schema: {
        params: params("memberId"),
        body: ref("SteamReplacementInput"),
        response: { 200: ref("EnvelopeCommandResult") },
      },
    },
    async (request, reply) => {
      const current = await actor(request);
      csrf.check(request, current);
      const match = request.headers["if-match"];
      if (match === undefined) throw identityError(428);
      if (
        typeof match !== "string" ||
        !/^"v[1-9][0-9]*"$/.test(match) ||
        !Number.isSafeInteger(Number(match.slice(2, -1)))
      )
        throw identityError(422);
      const result = await external.replace(
        current,
        request.params.memberId,
        key(request),
        Number(match.slice(2, -1)),
        request.body,
      );
      reply.header("ETag", `"v${result.version}"`);
      return envelope(result, request);
    },
  );
}
