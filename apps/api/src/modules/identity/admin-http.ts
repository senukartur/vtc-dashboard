import type { components } from "@vtc/contracts";
import { applicationId } from "@vtc/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Administration } from "../../use-cases/administration.js";
import { csrfProtection } from "./http.js";
import { type Actor, type Identity, identityError } from "./service.js";

type S = components["schemas"];
const ref = (name: string) => ({ $ref: `urn:vtc:browser:v1#/$defs/${name}` });
const identifier = {
  type: "string",
  format: "uuid",
  pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
};
const params = {
  type: "object",
  properties: { memberId: identifier },
  required: ["memberId"],
  additionalProperties: false,
};
const page = {
  type: "object",
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 100 },
    cursor: { type: "string", minLength: 1, maxLength: 2048 },
  },
  additionalProperties: false,
};
export async function registerAdministrationRoutes(
  app: FastifyInstance,
  identity: Identity,
  administration: Administration,
) {
  const csrf = csrfProtection(identity.config),
    actors = new WeakMap<FastifyRequest, Actor>();
  const owned = (path: string) =>
    [
      "/api/v1/admin/members",
      "/api/v1/admin/reinstatement-options",
      "/api/v1/admin/members/:memberId",
      "/api/v1/admin/members/:memberId/roles",
      "/api/v1/admin/members/:memberId/deactivation",
      "/api/v1/admin/members/:memberId/reinstatement",
      "/api/v1/admin/company-settings",
      "/api/v1/admin/audit",
      "/api/v1/admin/source-capabilities",
      "/api/v1/admin/leadership/challenges",
      "/api/v1/admin/leadership/transfers",
    ].includes(path);
  async function actor(request: FastifyRequest) {
    const saved = actors.get(request);
    if (saved) return saved;
    const value = await identity.authenticate(
      new Headers({ cookie: request.headers.cookie ?? "" }),
    );
    actors.set(request, value);
    return value;
  }
  app.addHook("onRequest", async (request) => {
    const path = request.routeOptions.url;
    if (!path || !owned(path)) return;
    await identity.rateLimit(request.method === "GET" ? "read" : "command", request.ip);
    const current = await actor(request);
    await identity.transaction((tx) =>
      identity.authorizeInTransaction(
        tx,
        current,
        path.includes("/leadership/")
          ? "leadership.transfer"
          : path.includes("/members") ||
              path.endsWith("/audit") ||
              path.endsWith("/reinstatement-options")
            ? "members.manage"
            : path.endsWith("source-capabilities")
              ? "connections.manage"
              : "company.configure",
      ),
    );
  });
  app.addHook("preValidation", async (request) => {
    if (!request.routeOptions.url || !owned(request.routeOptions.url) || request.method === "GET")
      return;
    if (
      request.body !== undefined &&
      request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !== "application/json"
    )
      throw identityError(415);
  });
  const key = (r: FastifyRequest) => {
    try {
      return applicationId(r.headers["idempotency-key"] as string);
    } catch {
      throw identityError(422);
    }
  };
  const expected = (r: FastifyRequest) => {
    const value = r.headers["if-match"];
    if (value === undefined) throw identityError(428);
    if (
      typeof value !== "string" ||
      !/^"v[1-9][0-9]*"$/.test(value) ||
      !Number.isSafeInteger(Number(value.slice(2, -1)))
    )
      throw identityError(422);
    return Number(value.slice(2, -1));
  };
  const envelope = (data: unknown, r: FastifyRequest) => ({ data, meta: { requestId: r.id } });
  app.get(
    "/api/v1/me/connection-capabilities",
    { schema: { response: { 200: ref("EnvelopePersonalConnectionCapabilities") } } },
    async (r) => envelope(await administration.personalCapabilities(await actor(r)), r),
  );
  app.get(
    "/api/v1/admin/reinstatement-options",
    { schema: { response: { 200: ref("EnvelopeReinstatementOptions") } } },
    async (r) => envelope(await administration.reinstatementOptions(await actor(r)), r),
  );
  app.get<{ Querystring: { limit?: number; cursor?: string; status?: "active" | "inactive" } }>(
    "/api/v1/admin/members",
    {
      schema: {
        querystring: {
          ...page,
          properties: {
            ...page.properties,
            status: { type: "string", enum: ["active", "inactive"] },
          },
        },
        response: { 200: ref("EnvelopeListMemberAdmin") },
      },
    },
    async (r) => envelope(await administration.members(await actor(r), r.query), r),
  );
  app.get<{ Params: { memberId: string } }>(
    "/api/v1/admin/members/:memberId",
    { schema: { params, response: { 200: ref("EnvelopeMemberAdmin") } } },
    async (r, reply) => {
      const data = (await administration.members(await actor(r), {}, r.params.memberId)).items[0];
      if (!data) throw identityError(404);
      reply.header("ETag", `"v${data.version}"`);
      return envelope(data, r);
    },
  );
  const memberCommand = async (
    r: FastifyRequest<{ Params: { memberId: string } }>,
    input: Parameters<Identity["administer"]>[4],
  ) => {
    const current = await actor(r);
    csrf.check(r, current);
    return identity.administer(current, r.params.memberId, key(r), expected(r), input);
  };
  app.put<{ Params: { memberId: string }; Body: S["RolesInput"] }>(
    "/api/v1/admin/members/:memberId/roles",
    {
      schema: { params, body: ref("RolesInput"), response: { 200: ref("EnvelopeCommandResult") } },
    },
    async (r, reply) => {
      const data = await memberCommand(r, { kind: "roles", roles: r.body.roles });
      reply.header("ETag", `"v${data.version}"`);
      return envelope(data, r);
    },
  );
  app.post<{ Params: { memberId: string }; Body: S["ReasonInput"] }>(
    "/api/v1/admin/members/:memberId/deactivation",
    {
      schema: { params, body: ref("ReasonInput"), response: { 200: ref("EnvelopeCommandResult") } },
    },
    async (r, reply) => {
      const data = await memberCommand(r, { kind: "deactivate" });
      reply.header("ETag", `"v${data.version}"`);
      return envelope(data, r);
    },
  );
  app.post<{ Params: { memberId: string }; Body: S["ReinstateInput"] }>(
    "/api/v1/admin/members/:memberId/reinstatement",
    {
      schema: {
        params,
        body: ref("ReinstateInput"),
        response: { 200: ref("EnvelopeCommandResult") },
      },
    },
    async (r, reply) => {
      const data = await memberCommand(r, {
        kind: "reinstate",
        roles: r.body.roles,
        qualifications: r.body.assignments,
      });
      reply.header("ETag", `"v${data.version}"`);
      return envelope(data, r);
    },
  );
  app.get(
    "/api/v1/admin/company-settings",
    { schema: { response: { 200: ref("EnvelopeCompanySettings") } } },
    async (r, reply) => {
      const data = await administration.settings(await actor(r));
      reply.header("ETag", `"v${data.version}"`);
      return envelope(data, r);
    },
  );
  app.patch<{ Body: S["CompanySettingsInput"] }>(
    "/api/v1/admin/company-settings",
    {
      schema: {
        body: ref("CompanySettingsInput"),
        response: { 200: ref("EnvelopeCompanySettings") },
      },
    },
    async (r, reply) => {
      const current = await actor(r);
      csrf.check(r, current);
      const data = await administration.updateSettings(
        current,
        key(r),
        expected(r),
        r.body.reportingTimezone,
      );
      reply.header("ETag", `"v${data.version}"`);
      return envelope(data, r);
    },
  );
  app.get<{ Querystring: { limit?: number; cursor?: string } }>(
    "/api/v1/admin/audit",
    { schema: { querystring: page, response: { 200: ref("EnvelopeListAuditEntry") } } },
    async (r) => envelope(await administration.audit(await actor(r), r.query), r),
  );
  app.get(
    "/api/v1/admin/source-capabilities",
    { schema: { response: { 200: ref("EnvelopeSourceCapabilities") } } },
    async (r) => envelope(await administration.sources(await actor(r)), r),
  );
  app.post<{ Body: S["LeadershipChallengeInput"] }>(
    "/api/v1/admin/leadership/challenges",
    {
      schema: {
        body: ref("LeadershipChallengeInput"),
        response: { 202: ref("EnvelopeChallenge") },
      },
    },
    async (r, reply) => {
      const current = await actor(r);
      csrf.check(r, current);
      return reply
        .code(202)
        .send(envelope(await identity.requestSuccession(current, r.body.successorId, key(r)), r));
    },
  );
  app.post<{ Body: S["LeadershipConfirmInput"] }>(
    "/api/v1/admin/leadership/transfers",
    {
      schema: {
        body: ref("LeadershipConfirmInput"),
        response: { 200: ref("EnvelopeCommandResult") },
      },
    },
    async (r) => {
      const current = await actor(r);
      csrf.check(r, current);
      return envelope(
        await identity.confirmBoundSuccession(current, r.body.challengeId, r.body.code, key(r)),
        r,
      );
    },
  );
}
