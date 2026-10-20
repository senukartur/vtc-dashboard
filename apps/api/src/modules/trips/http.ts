import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Identity } from "../identity/service.js";
import type { ListOptions, Trips } from "./service.js";

const object = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  additionalProperties: false,
});
const ref = (name: string) => ({ $ref: `urn:vtc:browser:v1#/$defs/${name}` });
const game = { type: "string", enum: ["ets2", "ats"] };
export async function registerTripRoutes(app: FastifyInstance, identity: Identity, trips: Trips) {
  const actor = (request: FastifyRequest) =>
    identity.authenticate(new Headers({ cookie: request.headers.cookie ?? "" }));
  const envelope = (data: unknown, request: FastifyRequest) => ({
    data,
    meta: { requestId: request.id },
  });
  app.get<{ Querystring: ListOptions }>(
    "/api/v1/trips",
    {
      schema: {
        querystring: object({
          limit: { type: "integer", minimum: 1, maximum: 100 },
          cursor: { type: "string", minLength: 1, maxLength: 2048 },
          scope: { type: "string", enum: ["company", "mine", "review"] },
          game,
          decision: {
            type: "string",
            enum: ["unassessed", "pending_review", "accepted", "rejected"],
          },
        }),
        response: { 200: ref("EnvelopeListTripSummary") },
      },
    },
    async (request) => envelope(await trips.list(await actor(request), request.query), request),
  );
  app.get<{ Params: { tripId: string } }>(
    "/api/v1/trips/:tripId",
    {
      schema: {
        params: {
          ...object({
            tripId: {
              type: "string",
              format: "uuid",
              pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
            },
          }),
          required: ["tripId"],
        },
        querystring: object({}),
        response: { 200: ref("EnvelopeTripView") },
      },
    },
    async (request, reply) => {
      const result = await trips.detail(await actor(request), request.params.tripId);
      reply.header(
        "ETag",
        `"v${result.view === "private" ? result.summary.version : result.version}"`,
      );
      return envelope(result, request);
    },
  );
  app.get<{ Querystring: { game?: "ets2" | "ats" } }>(
    "/api/v1/me/trip-status-summary",
    {
      schema: {
        querystring: object({ game }),
        response: { 200: ref("EnvelopeOwnTripStatusSummary") },
      },
    },
    async (request) =>
      envelope(await trips.status(await actor(request), request.query.game), request),
  );
}
