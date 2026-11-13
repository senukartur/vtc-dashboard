import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  browserRef,
  stage3Envelope,
  stage3Query,
  stage3QuerySelection,
} from "../../platform/http/stage3.js";
import type { Identity } from "../identity/service.js";
import type { ReviewPage } from "../trip-decisions/review-queue.js";
import type { TripDecisions } from "../trip-decisions/service.js";
import { type ListOptions, tripDecisions, tripOrders, tripSources } from "./list-query.js";
import type { Trips } from "./service.js";

const object = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  additionalProperties: false,
});
const ref = browserRef;
const game = { type: "string", enum: ["ets2", "ats"] };
// Wire schema of the listTrips query, exported for the OpenAPI parity contract test.
export const listTripsQuerystring = object({
  limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
  cursor: { type: "string", minLength: 1, maxLength: 2048 },
  scope: { type: "string", enum: ["company", "mine", "review"] },
  game,
  decision: { type: "string", enum: [...tripDecisions] },
  // TripSummary.sourceKinds vocabulary; applies to every scope.
  source: { type: "string", enum: [...tripSources] },
  hold: { type: "boolean" },
  order: { type: "string", enum: [...tripOrders], default: "desc" },
  from: ref("Timestamp"),
  toExclusive: ref("Timestamp"),
  q: { type: "string", minLength: 1, maxLength: 128, pattern: "\\S" },
  locale: { type: "string", enum: ["en", "ru"] },
  ownerId: ref("Id"),
});
const stageListQuery = {
  ...stage3Query,
  properties: {
    view: stage3Query.properties.view,
    scope: { type: "string", const: "review" },
    limit: listTripsQuerystring.properties.limit,
    cursor: listTripsQuerystring.properties.cursor,
    game,
    ownerId: ref("Id"),
    source: listTripsQuerystring.properties.source,
    locale: listTripsQuerystring.properties.locale,
    reasonCode: ref("TripStage3ReviewReasonCode"),
    status: { type: "string", enum: ["waiting", "resolved"] },
    order: { type: "string", enum: ["asc", "desc"] },
  },
  required: ["view", "scope"],
};
export async function registerTripRoutes(
  app: FastifyInstance,
  identity: Identity,
  trips: Trips,
  stage3?: TripDecisions["reviewQueue"],
) {
  const actor = (request: FastifyRequest) =>
    identity.authenticate(new Headers({ cookie: request.headers.cookie ?? "" }));
  const envelope = (data: unknown, request: FastifyRequest) => ({
    data,
    meta: { requestId: request.id },
  });
  const listEnvelope = stage3Envelope("EnvelopeListTripSummary", "TripStage3ReviewListEnvelope");
  app.get<{ Querystring: ListOptions | (ReviewPage & { view: "stage3"; scope: "review" }) }>(
    "/api/v1/trips",
    {
      schema: {
        querystring: stage3QuerySelection(listTripsQuerystring, !!stage3, stageListQuery),
        ...(!stage3 && { response: { 200: ref("EnvelopeListTripSummary") } }),
      },
    },
    async (request) => {
      const current = await actor(request);
      const query = request.query;
      if (stage3 && "view" in query)
        return listEnvelope(true, envelope(await stage3.list(current, query), request));
      return listEnvelope(false, envelope(await trips.list(current, query), request));
    },
  );
  if (stage3)
    app.get<{ Querystring: { game?: "ets2" | "ats" } }>(
      "/api/v1/trips/review-summary",
      {
        schema: {
          querystring: object({ game }),
          response: { 200: ref("TripStage3ReviewSummaryEnvelope") },
        },
      },
      async (request) =>
        envelope(await stage3.summary(await actor(request), request.query.game), request),
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
