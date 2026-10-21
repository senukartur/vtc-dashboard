import type { components } from "@vtc/contracts";
import { applicationId } from "@vtc/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { csrfProtection } from "../identity/http.js";
import { type Actor, type Identity, identityError } from "../identity/service.js";
import type { Game } from "./initialization.js";
import type { Page } from "./pagination.js";
import type { Qualifications } from "./service.js";

type S = components["schemas"];
const ref = (name: string) => ({ $ref: `urn:vtc:browser:v1#/$defs/${name}` });
const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const id = {
    type: "string",
    format: "uuid",
    pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
  },
  game = { type: "string", enum: ["ets2", "ats"] },
  page = {
    limit: { type: "integer", minimum: 1, maximum: 100 },
    cursor: { type: "string", minLength: 1, maxLength: 2048 },
  };
export async function registerQualificationRoutes(
  app: FastifyInstance,
  identity: Identity,
  qualifications: Qualifications,
) {
  const actors = new WeakMap<FastifyRequest, Actor>(),
    csrf = csrfProtection(identity.config);
  const owned = (path: string) =>
    path.startsWith("/api/v1/qualification-levels") ||
    path.startsWith("/api/v1/admin/qualification-levels") ||
    /^\/api\/v1\/(?:admin\/)?members\/:memberId\/(?:qualification-progress|qualification-assignments|promotions)$/.test(
      path,
    ) ||
    ["/api/v1/me/qualification-progress", "/api/v1/me/qualification-assignments"].includes(path);
  async function actor(request: FastifyRequest) {
    let current = actors.get(request);
    if (!current) {
      current = await identity.authenticate(new Headers({ cookie: request.headers.cookie ?? "" }));
      actors.set(request, current);
    }
    return current;
  }
  app.addHook("onRequest", async (request) => {
    const path = request.routeOptions.url;
    if (!path || !owned(path)) return;
    // Identity already admits every /me route before parsing.
    if (!path.startsWith("/api/v1/me/"))
      await identity.rateLimit(request.method === "GET" ? "read" : "command", request.ip);
    const current = await actor(request);
    await qualifications.authorize(current, path.startsWith("/api/v1/admin/"));
    if (["POST", "PATCH"].includes(request.method)) csrf.check(request, current);
  });
  app.addHook("preValidation", async (request) => {
    if (
      request.routeOptions.url &&
      owned(request.routeOptions.url) &&
      ["POST", "PATCH"].includes(request.method) &&
      request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !== "application/json"
    )
      throw identityError(415);
  });
  function key(request: FastifyRequest) {
    try {
      return applicationId(request.headers["idempotency-key"] as string);
    } catch {
      throw identityError(422);
    }
  }
  function expected(request: FastifyRequest) {
    const value = request.headers["if-match"];
    if (value === undefined) throw identityError(428);
    if (
      typeof value !== "string" ||
      !/^"v[1-9]\d*"$/.test(value) ||
      !Number.isSafeInteger(Number(value.slice(2, -1)))
    )
      throw identityError(422);
    return Number(value.slice(2, -1));
  }
  const envelope = (request: FastifyRequest, data: unknown) => ({
    data,
    meta: { requestId: request.id },
  });
  app.get<{ Querystring: Page & { game: Game } }>(
    "/api/v1/qualification-levels",
    {
      schema: {
        querystring: object({ ...page, game }, ["game"]),
        response: { 200: ref("EnvelopeListQualificationLevel") },
      },
    },
    async (request) =>
      envelope(
        request,
        await qualifications.levels(await actor(request), request.query.game, request.query),
      ),
  );
  app.get<{ Params: { levelId: string }; Querystring: Page }>(
    "/api/v1/qualification-levels/:levelId/rule-versions",
    {
      schema: {
        params: object({ levelId: id }, ["levelId"]),
        querystring: object(page),
        response: { 200: ref("EnvelopeListQualificationRuleVersion") },
      },
    },
    async (request) =>
      envelope(
        request,
        await qualifications.rules(await actor(request), request.params.levelId, request.query),
      ),
  );
  app.get<{ Params: { levelId: string; ruleVersionId: string } }>(
    "/api/v1/qualification-levels/:levelId/rule-versions/:ruleVersionId",
    {
      schema: {
        params: object({ levelId: id, ruleVersionId: id }, ["levelId", "ruleVersionId"]),
        querystring: object({}),
        response: { 200: ref("EnvelopeQualificationRuleVersion") },
      },
    },
    async (request) =>
      envelope(
        request,
        (
          await qualifications.rules(
            await actor(request),
            request.params.levelId,
            {},
            request.params.ruleVersionId,
          )
        ).items[0],
      ),
  );
  for (const scope of ["owner", "public", "admin"] as const) {
    const path =
      scope === "owner"
        ? "/api/v1/me/qualification-progress"
        : `/api/v1/${scope === "admin" ? "admin/" : ""}members/:memberId/qualification-progress`;
    app.get<{ Params: { memberId?: string }; Querystring: { game: Game } }>(
      path,
      {
        schema: {
          ...(scope === "owner" ? {} : { params: object({ memberId: id }, ["memberId"]) }),
          querystring: object({ game }, ["game"]),
          response: {
            200: ref(scope === "public" ? "EnvelopeProgressPublic" : "EnvelopeProgress"),
          },
        },
      },
      async (request, reply) => {
        const current = await actor(request),
          result = await qualifications.progress(
            current,
            request.params.memberId ?? current.userId,
            request.query.game,
            scope,
          );
        reply.header("ETag", `"v${result.version}"`);
        return envelope(request, result.data);
      },
    );
  }
  for (const admin of [false, true]) {
    const path = admin
      ? "/api/v1/admin/members/:memberId/qualification-assignments"
      : "/api/v1/me/qualification-assignments";
    app.get<{ Params: { memberId?: string }; Querystring: Page & { game: Game } }>(
      path,
      {
        schema: {
          ...(admin ? { params: object({ memberId: id }, ["memberId"]) } : {}),
          querystring: object({ ...page, game }, ["game"]),
          response: { 200: ref("EnvelopeListAssignmentHistory") },
        },
      },
      async (request, reply) => {
        const current = await actor(request),
          result = await qualifications.history(
            current,
            request.params.memberId ?? current.userId,
            request.query.game,
            request.query,
            admin,
          );
        reply.header("ETag", `"v${result.version}"`);
        return envelope(request, result.data);
      },
    );
  }
  app.patch<{ Params: { levelId: string }; Body: S["LevelInput"] }>(
    "/api/v1/admin/qualification-levels/:levelId",
    {
      schema: {
        params: object({ levelId: id }, ["levelId"]),
        querystring: object({}),
        body: ref("LevelInput"),
        response: { 200: ref("EnvelopeQualificationLevel") },
      },
    },
    async (request, reply) => {
      const result = await qualifications.rename(
        await actor(request),
        request.params.levelId,
        key(request),
        expected(request),
        request.body,
      );
      reply.header("ETag", `"v${result.version}"`);
      return envelope(request, result.data);
    },
  );
  app.post<{ Params: { levelId: string }; Body: S["RulesInput"] }>(
    "/api/v1/admin/qualification-levels/:levelId/rule-versions",
    {
      schema: {
        params: object({ levelId: id }, ["levelId"]),
        querystring: object({}),
        body: ref("RulesInput"),
        response: { 201: ref("EnvelopeQualificationLevel") },
      },
    },
    async (request, reply) => {
      const result = await qualifications.publish(
        await actor(request),
        request.params.levelId,
        key(request),
        expected(request),
        request.body,
      );
      reply.header("ETag", `"v${result.version}"`);
      return reply.code(201).send(envelope(request, result.data));
    },
  );
  app.post<{ Params: { memberId: string }; Body: S["AssignmentInput"] }>(
    "/api/v1/admin/members/:memberId/qualification-assignments",
    {
      schema: {
        params: object({ memberId: id }, ["memberId"]),
        querystring: object({}),
        body: ref("AssignmentInput"),
        response: { 201: ref("EnvelopeAssignment") },
      },
    },
    async (request, reply) => {
      const result = await qualifications.assign(
        await actor(request),
        request.params.memberId,
        key(request),
        expected(request),
        request.body,
      );
      reply.header("ETag", `"v${result.version}"`);
      return reply.code(201).send(envelope(request, result.data));
    },
  );
  app.post<{ Params: { memberId: string }; Body: S["PromotionInput"] }>(
    "/api/v1/admin/members/:memberId/promotions",
    {
      schema: {
        params: object({ memberId: id }, ["memberId"]),
        querystring: object({}),
        body: ref("PromotionInput"),
        response: { 200: ref("EnvelopeAssignment") },
      },
    },
    async (request, reply) => {
      const result = await qualifications.promote(
        await actor(request),
        request.params.memberId,
        key(request),
        expected(request),
        request.body,
      );
      reply.header("ETag", `"v${result.version}"`);
      return envelope(request, result.data);
    },
  );
}
