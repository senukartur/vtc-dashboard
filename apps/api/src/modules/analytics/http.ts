import type { FastifyInstance, FastifyRequest } from "fastify";
import { type Actor, type Identity, identityError } from "../identity/service.js";
import type { AnalyticsQuery, AnalyticsService, LeaderboardQuery } from "./service.js";

const ref = (name: string) => ({ $ref: `urn:vtc:browser:v1#/$defs/${name}` });

const id = {
  type: "string",
  format: "uuid",
  pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
};

const analyticsQuery = {
  type: "object",
  properties: {
    game: { type: "string", enum: ["ets2", "ats"] },
    fromDate: { type: "string", format: "date" },
    toDateExclusive: { type: "string", format: "date" },
    granularity: { type: "string", enum: ["day", "month"] },
  },
  required: ["fromDate", "toDateExclusive"],
  additionalProperties: false,
};

const leaderboardQuery = {
  type: "object",
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 100 },
    cursor: { type: "string", minLength: 1, maxLength: 2048 },
    game: { type: "string", enum: ["ets2", "ats"] },
    fromDate: { type: "string", format: "date" },
    toDateExclusive: { type: "string", format: "date" },
    granularity: { type: "string", enum: ["day", "month"] },
  },
  required: ["fromDate", "toDateExclusive"],
  additionalProperties: false,
};

const memberParams = {
  type: "object",
  properties: {
    memberId: id,
  },
  required: ["memberId"],
  additionalProperties: false,
};

export async function registerAnalyticsRoutes(
  app: FastifyInstance,
  identity: Identity,
  service: AnalyticsService,
) {
  const actors = new WeakMap<FastifyRequest, Actor>();
  const actor = async (r: FastifyRequest) => {
    const old = actors.get(r);
    if (old) return old;
    const value = await identity.authenticate(new Headers({ cookie: r.headers.cookie ?? "" }));
    actors.set(r, value);
    return value;
  };
  const envelope = (data: unknown, r: FastifyRequest) => ({ data, meta: { requestId: r.id } });

  const owned = (p: string) =>
    p === "/api/v1/analytics/company" ||
    p === "/api/v1/analytics/leaderboard" ||
    /^\/api\/v1\/members\/[^/]+\/analytics$/.test(p);

  app.addHook("onRequest", async (r) => {
    const url = r.routeOptions.url;
    if (!url || !owned(url)) return;
    await identity.rateLimit("read", r.ip);
    const current = await actor(r);
    if (!current.capabilities.includes("company.read")) {
      throw identityError(403);
    }
  });

  app.get<{ Querystring: AnalyticsQuery }>(
    "/api/v1/analytics/company",
    {
      schema: {
        querystring: analyticsQuery,
        response: { 200: ref("EnvelopeAnalytics") },
      },
    },
    async (r) => envelope(await service.getCompanyAnalytics(await actor(r), r.query), r),
  );

  app.get<{ Params: { memberId: string }; Querystring: AnalyticsQuery }>(
    "/api/v1/members/:memberId/analytics",
    {
      schema: {
        params: memberParams,
        querystring: analyticsQuery,
        response: { 200: ref("EnvelopeAnalytics") },
      },
    },
    async (r) =>
      envelope(await service.getMemberAnalytics(await actor(r), r.params.memberId, r.query), r),
  );

  app.get<{ Querystring: LeaderboardQuery }>(
    "/api/v1/analytics/leaderboard",
    {
      schema: {
        querystring: leaderboardQuery,
        response: { 200: ref("EnvelopeListLeaderboardEntry") },
      },
    },
    async (r) => envelope(await service.getLeaderboard(await actor(r), r.query), r),
  );
}
