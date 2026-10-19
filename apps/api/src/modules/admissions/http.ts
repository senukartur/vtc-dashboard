import type { components } from "@vtc/contracts";
import { applicationId } from "@vtc/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { csrfProtection } from "../identity/http.js";
import { type Actor, type Identity, identityError } from "../identity/service.js";
import type { Admissions } from "./service.js";

type Schemas = components["schemas"];
const ref = (name: string) => ({ $ref: `urn:vtc:browser:v1#/$defs/${name}` });
const identifier = {
  type: "string",
  format: "uuid",
  pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
};
export async function registerAdmissionsRoutes(
  app: FastifyInstance,
  identity: Identity,
  admissions: Admissions,
) {
  const csrf = csrfProtection(identity.config);
  const owned = (route: string) =>
    route === "/api/v1/public/applications" ||
    route === "/api/v1/public/invitation-redemptions" ||
    route.startsWith("/api/v1/admin/applications") ||
    route.startsWith("/api/v1/admin/invitations");
  app.addHook("onRequest", async (request) => {
    const route = request.routeOptions.url;
    if (!route || !owned(route)) return;
    await admissions.rateLimit(
      route === "/api/v1/public/applications"
        ? "submit"
        : route === "/api/v1/public/invitation-redemptions"
          ? "redeem"
          : request.method === "GET"
            ? "staff_read"
            : "staff_command",
      request.ip,
    );
  });
  app.addHook("preValidation", async (request) => {
    const route = request.routeOptions.url;
    if (!route || !owned(route) || request.method !== "POST") return;
    if (
      request.body !== undefined &&
      request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !== "application/json"
    )
      throw identityError(415);
    if ((route.endsWith("/copy-link") || route.endsWith("/reissue")) && request.body !== undefined)
      throw identityError(422);
  });
  const actor = (request: FastifyRequest) =>
    identity.authenticate(
      new Headers(request.headers.cookie ? { cookie: request.headers.cookie } : {}),
    );
  async function publicScope(request: FastifyRequest) {
    let current: Actor | undefined;
    try {
      current = await actor(request);
    } catch (error) {
      if (
        !(
          error &&
          typeof error === "object" &&
          "statusCode" in error &&
          [401, 409].includes(Number(error.statusCode))
        )
      )
        throw error;
    }
    return csrf.check(request, current);
  }
  const key = (request: FastifyRequest) => {
    try {
      return applicationId(request.headers["idempotency-key"] as string);
    } catch {
      throw identityError(422);
    }
  };
  const expected = (request: FastifyRequest) => {
    const value = request.headers["if-match"];
    if (value === undefined) throw identityError(428);
    if (typeof value !== "string" || !/^"v[1-9][0-9]*"$/.test(value)) throw identityError(422);
    return Number(value.slice(2, -1));
  };
  const envelope = (data: unknown, request: FastifyRequest) => ({
    data,
    meta: { requestId: request.id },
  });
  const params = (name: string) => ({
    type: "object",
    properties: { [name]: identifier },
    required: [name],
    additionalProperties: false,
  });
  const page = {
    type: "object",
    properties: {
      limit: { type: "integer", minimum: 1, maximum: 100 },
      cursor: { type: "string", minLength: 1, maxLength: 2048 },
    },
    additionalProperties: false,
  };
  app.post<{ Body: Schemas["ApplicationInput"] }>(
    "/api/v1/public/applications",
    {
      schema: {
        body: ref("ApplicationInput"),
        headers: {
          type: "object",
          properties: { "accept-language": { type: "string", maxLength: 256 } },
          additionalProperties: true,
        },
        response: { 201: ref("EnvelopeCommandResult") },
      },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(
          envelope(
            await admissions.submit(
              await publicScope(request),
              key(request),
              request.body,
              /^ru(?:\b|-)/i.test(request.headers["accept-language"] ?? "") ? "ru" : "en",
            ),
            request,
          ),
        ),
  );
  app.post<{ Body: Schemas["RedeemInput"] }>(
    "/api/v1/public/invitation-redemptions",
    { schema: { body: ref("RedeemInput"), response: { 201: ref("EnvelopeCommandResult") } } },
    async (request, reply) =>
      reply
        .code(201)
        .send(
          envelope(
            await admissions.redeem(
              await publicScope(request),
              key(request),
              request.body.invitationToken,
              request.body.password,
            ),
            request,
          ),
        ),
  );
  app.get<{ Querystring: { limit?: number; cursor?: string } }>(
    "/api/v1/admin/applications",
    { schema: { querystring: page, response: { 200: ref("EnvelopeListApplication") } } },
    async (request) =>
      envelope(await admissions.list(await actor(request), request.query), request),
  );
  app.get<{ Params: { applicationId: string }; Querystring: { limit?: number; cursor?: string } }>(
    "/api/v1/admin/applications/:applicationId/history",
    {
      schema: {
        params: params("applicationId"),
        querystring: page,
        response: { 200: ref("EnvelopeListApplication") },
      },
    },
    async (request) =>
      envelope(
        await admissions.list(await actor(request), {
          ...request.query,
          historyId: request.params.applicationId,
        }),
        request,
      ),
  );
  app.get<{ Params: { applicationId: string } }>(
    "/api/v1/admin/applications/:applicationId",
    { schema: { params: params("applicationId"), response: { 200: ref("EnvelopeApplication") } } },
    async (request, reply) => {
      const data = await admissions.detail(await actor(request), request.params.applicationId);
      reply.header("ETag", `"v${data.version}"`);
      return envelope(data, request);
    },
  );
  app.post<{ Params: { applicationId: string }; Body: Schemas["ApplicationDecisionInput"] }>(
    "/api/v1/admin/applications/:applicationId/decisions",
    {
      schema: {
        params: params("applicationId"),
        body: ref("ApplicationDecisionInput"),
        response: { 200: ref("EnvelopeApplication") },
      },
    },
    async (request, reply) => {
      const current = await actor(request);
      csrf.check(request, current);
      const data = await admissions.decide(
        current,
        request.params.applicationId,
        key(request),
        expected(request),
        request.body,
      );
      reply.header("ETag", `"v${data.version}"`);
      return envelope(data, request);
    },
  );
  app.get<{ Params: { invitationId: string } }>(
    "/api/v1/admin/invitations/:invitationId",
    { schema: { params: params("invitationId"), response: { 200: ref("EnvelopeInvitation") } } },
    async (request, reply) => {
      const data = await admissions.inspect(await actor(request), request.params.invitationId);
      reply.header("ETag", `"v${data.version}"`);
      return envelope(data, request);
    },
  );
  app.post<{ Params: { invitationId: string } }>(
    "/api/v1/admin/invitations/:invitationId/copy-link",
    {
      schema: { params: params("invitationId"), response: { 200: ref("EnvelopeInvitationLink") } },
    },
    async (request, reply) => {
      const current = await actor(request);
      csrf.check(request, current);
      const version = expected(request);
      const data = await admissions.copy(current, request.params.invitationId, version);
      reply.header("ETag", `"v${version}"`);
      return envelope(data, request);
    },
  );
  app.post<{ Params: { invitationId: string } }>(
    "/api/v1/admin/invitations/:invitationId/reissue",
    { schema: { params: params("invitationId"), response: { 200: ref("EnvelopeInvitation") } } },
    async (request, reply) => {
      const current = await actor(request);
      csrf.check(request, current);
      const data = await admissions.reissue(
        current,
        request.params.invitationId,
        key(request),
        expected(request),
      );
      reply.header("ETag", `"v${data.version}"`);
      return envelope(data, request);
    },
  );
}
