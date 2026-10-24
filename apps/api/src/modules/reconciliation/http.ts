import type { components } from "@vtc/contracts";
import { applicationId } from "@vtc/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { csrfProtection } from "../identity/http.js";
import { type Actor, type Identity, identityError } from "../identity/service.js";
import type { Reconciliation } from "./service.js";
type S = components["schemas"];
const ref = (name: string) => ({ $ref: `urn:vtc:browser:v1#/$defs/${name}` });
const id = {
  type: "string",
  format: "uuid",
  pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
};
const empty = { type: "object", properties: {}, additionalProperties: false };
export async function registerReconciliationRoutes(
  app: FastifyInstance,
  identity: Identity,
  service: Reconciliation,
) {
  const actors = new WeakMap<FastifyRequest, Actor>();
  const csrf = csrfProtection(identity.config),
    actor = async (r: FastifyRequest) => {
      const cached = actors.get(r);
      if (cached) return cached;
      const value = await identity.authenticate(new Headers({ cookie: r.headers.cookie ?? "" }));
      actors.set(r, value);
      return value;
    },
    envelope = (data: unknown, r: FastifyRequest) => ({ data, meta: { requestId: r.id } });
  const params = { ...empty, properties: { reconciliationId: id }, required: ["reconciliationId"] };
  function key(r: FastifyRequest) {
    try {
      return applicationId(r.headers["idempotency-key"] as string);
    } catch {
      throw identityError(422);
    }
  }
  app.addHook("onRequest", async (r) => {
    await identity.rateLimit(r.method === "GET" ? "read" : "command", r.ip);
    const current = await actor(r);
    await service.authorize(current);
    if (r.method !== "GET") {
      csrf.check(r, current);
      key(r);
      if (r.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !== "application/json")
        throw identityError(415);
    }
  });
  app.get<{ Querystring: { limit?: number; cursor?: string } }>(
    "/api/v1/reconciliation-candidates",
    {
      schema: {
        querystring: {
          ...empty,
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 100 },
            cursor: { type: "string", minLength: 1, maxLength: 2048 },
          },
        },
        response: { 200: ref("EnvelopeListMergeCandidate") },
      },
    },
    async (r) => envelope(await service.list(await actor(r), r.query), r),
  );
  app.get<{ Params: { tripId: string }; Querystring: { limit?: number; cursor?: string } }>(
    "/api/v1/trips/:tripId/reconciliations",
    {
      schema: {
        params: { ...empty, properties: { tripId: id }, required: ["tripId"] },
        querystring: {
          ...empty,
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 100 },
            cursor: { type: "string", minLength: 1, maxLength: 2048 },
          },
        },
        response: { 200: ref("EnvelopeListReconciliation") },
      },
    },
    async (r) => envelope(await service.history(await actor(r), r.params.tripId, r.query), r),
  );
  app.get<{ Params: { reconciliationId: string } }>(
    "/api/v1/reconciliations/:reconciliationId",
    { schema: { params, querystring: empty, response: { 200: ref("EnvelopeReconciliation") } } },
    async (r, reply) => {
      const result = await service.get(await actor(r), r.params.reconciliationId);
      reply.header("ETag", `"v${result.version}"`);
      return envelope(result.data, r);
    },
  );
  app.post<{ Body: S["MergeInput"] }>(
    "/api/v1/reconciliations",
    {
      schema: {
        querystring: empty,
        body: ref("MergeInput"),
        response: { 201: ref("EnvelopeReconciliation") },
      },
    },
    async (r, reply) => {
      const current = await actor(r);
      csrf.check(r, current);
      const result = await service.merge(current, key(r), r.body);
      reply.code(201);
      return envelope(result.data, r);
    },
  );
  app.post<{ Params: { reconciliationId: string }; Body: S["MergeReversalInput"] }>(
    "/api/v1/reconciliations/:reconciliationId/reversals",
    {
      schema: {
        params,
        querystring: empty,
        body: ref("MergeReversalInput"),
        response: { 200: ref("EnvelopeReconciliation") },
      },
    },
    async (r, reply) => {
      const current = await actor(r);
      csrf.check(r, current);
      const match = r.headers["if-match"];
      if (match === undefined) throw identityError(428);
      if (
        typeof match !== "string" ||
        !/^"v[1-9]\d*"$/.test(match) ||
        !Number.isSafeInteger(Number(match.slice(2, -1)))
      )
        throw identityError(422);
      const result = await service.reverse(
        current,
        r.params.reconciliationId,
        key(r),
        Number(match.slice(2, -1)),
        r.body,
      );
      reply.header("ETag", `"v${result.version}"`);
      return envelope(result.data, r);
    },
  );
}
