import type { components } from "@vtc/contracts";
import { applicationId } from "@vtc/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { csrfProtection } from "../identity/http.js";
import { type Actor, type Identity, identityError } from "../identity/service.js";
import type { Page } from "./pagination.js";
import type { TripDecisions } from "./service.js";

type S = components["schemas"];
const ref = (name: string) => ({ $ref: `urn:vtc:browser:v1#/$defs/${name}` });
const id = {
  type: "string",
  format: "uuid",
  pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
};
const empty = { type: "object", properties: {}, additionalProperties: false };
const params = { ...empty, properties: { tripId: id }, required: ["tripId"] },
  proposalParams = {
    ...params,
    properties: { tripId: id, proposalId: id },
    required: ["tripId", "proposalId"],
  };
const paging = {
  ...empty,
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 100 },
    cursor: { type: "string", minLength: 1, maxLength: 2048 },
  },
};
export async function registerTripDecisionRoutes(
  app: FastifyInstance,
  identity: Identity,
  service: TripDecisions,
) {
  const actors = new WeakMap<FastifyRequest, Actor>(),
    csrf = csrfProtection(identity.config),
    actor = async (r: FastifyRequest) => {
      const old = actors.get(r);
      if (old) return old;
      const value = await identity.authenticate(new Headers({ cookie: r.headers.cookie ?? "" }));
      actors.set(r, value);
      return value;
    },
    envelope = (data: unknown, r: FastifyRequest) => ({ data, meta: { requestId: r.id } });
  const key = (r: FastifyRequest) => {
    try {
      return applicationId(r.headers["idempotency-key"] as string);
    } catch {
      throw identityError(422);
    }
  };
  function version(r: FastifyRequest) {
    const match = r.headers["if-match"];
    if (match === undefined) throw identityError(428);
    if (
      typeof match !== "string" ||
      !/^"v[1-9]\d*"$/.test(match) ||
      !Number.isSafeInteger(Number(match.slice(2, -1)))
    )
      throw identityError(422);
    return Number(match.slice(2, -1));
  }
  app.addHook("onRequest", async (r) => {
    await identity.rateLimit(r.method === "GET" ? "read" : "command", r.ip);
    const current = await actor(r);
    await service.authorize(current);
    if (r.method !== "GET") {
      csrf.check(r, current);
      key(r);
      version(r);
      if (r.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !== "application/json")
        throw identityError(415);
    }
  });
  app.get<{ Params: { tripId: string } }>(
    "/api/v1/trips/:tripId/review",
    { schema: { params, querystring: empty, response: { 200: ref("EnvelopeReview") } } },
    async (r, reply) => {
      const result = await service.review(await actor(r), r.params.tripId);
      reply.header("ETag", `"v${result.version}"`);
      return envelope(result.data, r);
    },
  );
  app.get<{ Params: { tripId: string }; Querystring: Page }>(
    "/api/v1/trips/:tripId/proposals",
    { schema: { params, querystring: paging, response: { 200: ref("EnvelopeListTripProposal") } } },
    async (r) => envelope(await service.proposals(await actor(r), r.params.tripId, r.query), r),
  );
  app.get<{ Params: { tripId: string; proposalId: string } }>(
    "/api/v1/trips/:tripId/proposals/:proposalId",
    {
      schema: {
        params: proposalParams,
        querystring: empty,
        response: { 200: ref("EnvelopeTripProposal") },
      },
    },
    async (r, reply) => {
      const result = await service.getProposal(
        await actor(r),
        r.params.tripId,
        r.params.proposalId,
      );
      reply.header("ETag", `"v${result.version}"`);
      return envelope(result.data, r);
    },
  );
  app.get<{ Params: { tripId: string }; Querystring: Page }>(
    "/api/v1/trips/:tripId/qualification-assignments",
    {
      schema: {
        params,
        querystring: paging,
        response: { 200: ref("EnvelopeListAssignmentHistory") },
      },
    },
    async (r) => envelope(await service.assignments(await actor(r), r.params.tripId, r.query), r),
  );
  app.post<{ Params: { tripId: string }; Body: S["DecisionInput"] }>(
    "/api/v1/trips/:tripId/decisions",
    {
      schema: {
        params,
        querystring: empty,
        body: ref("DecisionInput"),
        response: { 200: ref("EnvelopeDecision") },
      },
    },
    async (r, reply) => {
      const result = await service.decide(
        await actor(r),
        r.params.tripId,
        key(r),
        version(r),
        r.body,
      );
      reply.header("ETag", `"v${result.version}"`);
      return envelope(result.data, r);
    },
  );
  app.post<{ Params: { tripId: string }; Body: S["ResolutionInput"] }>(
    "/api/v1/trips/:tripId/resolution-proposals",
    {
      schema: {
        params,
        querystring: empty,
        body: ref("ResolutionInput"),
        response: { 201: ref("EnvelopeCommandResult") },
      },
    },
    async (r, reply) => {
      const result = await service.propose(
        await actor(r),
        r.params.tripId,
        key(r),
        version(r),
        r.body,
      );
      reply.code(201).header("ETag", `"v${result.version}"`);
      return envelope(result.data, r);
    },
  );
  app.post<{ Params: { tripId: string; proposalId: string }; Body: S["ProposalDecisionInput"] }>(
    "/api/v1/trips/:tripId/proposals/:proposalId/decisions",
    {
      schema: {
        params: proposalParams,
        querystring: empty,
        body: ref("ProposalDecisionInput"),
        response: { 200: ref("EnvelopeTripProposalDecision") },
      },
    },
    async (r, reply) => {
      const result = await service.proposalDecision(
        await actor(r),
        r.params.tripId,
        r.params.proposalId,
        key(r),
        version(r),
        r.body,
      );
      reply.header("ETag", `"v${result.version}"`);
      return envelope(result.data, r);
    },
  );
  app.post<{ Params: { tripId: string }; Body: S["EventAssociationInput"] }>(
    "/api/v1/trips/:tripId/event-association",
    {
      schema: {
        params,
        querystring: empty,
        body: ref("EventAssociationInput"),
        response: { 200: ref("EnvelopeCommandResult") },
      },
    },
    async (r, reply) => {
      const result = await service.associate(
        await actor(r),
        r.params.tripId,
        key(r),
        version(r),
        r.body,
      );
      reply.header("ETag", `"v${result.version}"`);
      return envelope(result.data, r);
    },
  );
}
