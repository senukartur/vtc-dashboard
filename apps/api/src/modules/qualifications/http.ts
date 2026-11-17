import type { components } from "@vtc/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { browserRef as ref } from "../../platform/http/stage3.js";
import { csrfProtection } from "../identity/http.js";
import { type Actor, type Identity, identityError } from "../identity/service.js";
import type { Game } from "./ladder.js";
import type { Qualifications } from "./service.js";

type S = components["schemas"];
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
  game = { type: "string", enum: ["ets2", "ats"] };
const LEVELS = "/api/v1/qualification-levels",
  ADMIN_LEVELS = "/api/v1/admin/qualification-levels";

export async function registerQualificationRoutes(
  app: FastifyInstance,
  identity: Identity,
  qualifications: Qualifications,
) {
  const actors = new WeakMap<FastifyRequest, Actor>(),
    csrf = csrfProtection(identity.config);
  const owned = (path: string) =>
    path.startsWith(LEVELS) ||
    path.startsWith(ADMIN_LEVELS) ||
    path === "/api/v1/me/qualifications" ||
    path === "/api/v1/members/:memberId/qualifications" ||
    path === "/api/v1/admin/members/:memberId/qualifications/:game";
  const writes = ["POST", "PUT"];
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
    if (!path.startsWith("/api/v1/me/")) {
      if (request.method === "GET") await identity.admitRead(request.ip, request.headers.cookie);
      else await identity.rateLimit("command", request.ip);
    }
    const current = await actor(request);
    await qualifications.authorize(current, path.startsWith("/api/v1/admin/"));
    if (writes.includes(request.method)) csrf.check(request, current);
  });
  app.addHook("preValidation", async (request) => {
    if (
      request.routeOptions.url &&
      owned(request.routeOptions.url) &&
      writes.includes(request.method) &&
      request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !== "application/json"
    )
      throw identityError(415);
  });
  const envelope = (request: FastifyRequest, data: unknown) => ({
    data,
    meta: { requestId: request.id },
  });
  const levelParams = object({ levelId: id }, ["levelId"]);
  app.get<{ Querystring: { game: Game } }>(
    LEVELS,
    {
      schema: {
        querystring: object({ game }, ["game"]),
        response: { 200: ref("EnvelopeQualificationLevelList") },
      },
    },
    async (request) =>
      envelope(request, await qualifications.list(await actor(request), request.query.game)),
  );
  app.get<{ Params: { levelId: string } }>(
    `${LEVELS}/:levelId`,
    {
      schema: {
        params: levelParams,
        querystring: object({}),
        response: { 200: ref("EnvelopeQualificationLevelDetail") },
      },
    },
    async (request) =>
      envelope(request, await qualifications.detail(await actor(request), request.params.levelId)),
  );
  app.get(
    "/api/v1/me/qualifications",
    {
      schema: {
        querystring: object({}),
        response: { 200: ref("EnvelopeMyQualificationList") },
      },
    },
    async (request) => {
      const current = await actor(request);
      return envelope(request, await qualifications.memberQualifications(current, current.userId));
    },
  );
  app.get<{ Params: { memberId: string } }>(
    "/api/v1/members/:memberId/qualifications",
    {
      schema: {
        params: object({ memberId: id }, ["memberId"]),
        querystring: object({}),
        response: { 200: ref("EnvelopeMyQualificationList") },
      },
    },
    async (request) =>
      envelope(
        request,
        await qualifications.memberQualifications(await actor(request), request.params.memberId),
      ),
  );
  app.post<{ Body: S["QualificationLevelCreateInput"] }>(
    ADMIN_LEVELS,
    {
      schema: {
        querystring: object({}),
        body: ref("QualificationLevelCreateInput"),
        response: { 201: ref("EnvelopeQualificationLevelCommandResult") },
      },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(envelope(request, await qualifications.create(await actor(request), request.body))),
  );
  app.put<{ Params: { levelId: string }; Body: S["QualificationLevelUpdateInput"] }>(
    `${ADMIN_LEVELS}/:levelId`,
    {
      schema: {
        params: levelParams,
        querystring: object({}),
        body: ref("QualificationLevelUpdateInput"),
        response: { 200: ref("EnvelopeQualificationLevelCommandResult") },
      },
    },
    async (request) =>
      envelope(
        request,
        await qualifications.update(await actor(request), request.params.levelId, request.body),
      ),
  );
  app.put<{ Params: { levelId: string }; Body: S["QualificationLevelMoveInput"] }>(
    `${ADMIN_LEVELS}/:levelId/position`,
    {
      schema: {
        params: levelParams,
        querystring: object({}),
        body: ref("QualificationLevelMoveInput"),
        response: { 200: ref("EnvelopeQualificationLevelCommandResult") },
      },
    },
    async (request) =>
      envelope(
        request,
        await qualifications.move(await actor(request), request.params.levelId, request.body),
      ),
  );
  app.post<{ Params: { levelId: string }; Body: S["QualificationLevelRemovalInput"] }>(
    `${ADMIN_LEVELS}/:levelId/removal`,
    {
      schema: {
        params: levelParams,
        querystring: object({}),
        body: ref("QualificationLevelRemovalInput"),
        response: { 200: ref("EnvelopeQualificationLevelRemovalResult") },
      },
    },
    async (request) =>
      envelope(
        request,
        await qualifications.remove(await actor(request), request.params.levelId, request.body),
      ),
  );
  app.put<{
    Params: { memberId: string; game: Game };
    Body: S["QualificationManualChangeInput"];
  }>(
    "/api/v1/admin/members/:memberId/qualifications/:game",
    {
      schema: {
        params: object({ memberId: id, game }, ["memberId", "game"]),
        querystring: object({}),
        body: ref("QualificationManualChangeInput"),
        response: { 200: ref("EnvelopeQualificationManualChangeResult") },
      },
    },
    async (request) =>
      envelope(
        request,
        await qualifications.changeMember(
          await actor(request),
          request.params.memberId,
          request.params.game,
          request.body,
        ),
      ),
  );
}
