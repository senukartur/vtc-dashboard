import { applicationId } from "@vtc/db";
import type { FastifyInstance } from "fastify";
import { csrfProtection } from "../identity/http.js";
import { type Identity, identityError } from "../identity/service.js";
import type { Messaging } from "./service.js";

export async function registerMessagingRoutes(
  app: FastifyInstance,
  identity: Identity,
  messaging: Messaging,
) {
  const path = "/api/v1/mail-deliveries/:deliveryId",
    csrf = csrfProtection(identity.config);
  const ref = (name: string) => ({ $ref: `urn:vtc:browser:v1#/$defs/${name}` });
  app.addHook("onRequest", async (request) => {
    if (request.routeOptions.url === path || request.routeOptions.url === `${path}/resends`)
      await identity.rateLimit(request.method === "GET" ? "read" : "command", request.ip);
  });
  app.addHook("preValidation", async (request) => {
    if (request.routeOptions.url === `${path}/resends` && request.body !== undefined)
      throw identityError(422);
  });
  const params = {
    type: "object",
    properties: {
      deliveryId: {
        type: "string",
        format: "uuid",
        pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
      },
    },
    required: ["deliveryId"],
    additionalProperties: false,
  };
  app.get<{ Params: { deliveryId: string } }>(
    path,
    { schema: { params, response: { 200: ref("EnvelopeMailDelivery") } } },
    async (request, reply) => {
      const actor = await identity.authenticate(
        new Headers(request.headers.cookie ? { cookie: request.headers.cookie } : {}),
      );
      const data = await messaging.inspect(actor, request.params.deliveryId);
      reply.header("ETag", `"v${data.version}"`);
      return { data, meta: { requestId: request.id } };
    },
  );
  app.post<{ Params: { deliveryId: string } }>(
    `${path}/resends`,
    { schema: { params, response: { 200: ref("EnvelopeCommandResult") } } },
    async (request, reply) => {
      const actor = await identity.authenticate(
        new Headers(request.headers.cookie ? { cookie: request.headers.cookie } : {}),
      );
      csrf.check(request, actor);
      const match = request.headers["if-match"],
        key = request.headers["idempotency-key"];
      if (match === undefined) throw identityError(428);
      if (typeof match !== "string" || !/^"v[1-9][0-9]*"$/.test(match) || typeof key !== "string")
        throw identityError(422);
      try {
        applicationId(key);
      } catch {
        throw identityError(422);
      }
      await identity.rateLimit("challenge", actor.userId, "actor");
      const data = await messaging.resend(
        actor,
        request.params.deliveryId,
        key,
        Number(match.slice(2, -1)),
      );
      reply.header("ETag", `"v${data.version}"`);
      return { data, meta: { requestId: request.id } };
    },
  );
}
