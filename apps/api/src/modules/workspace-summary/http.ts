import type { components } from "@vtc/contracts";
import type { FastifyInstance } from "fastify";
import type { Actor, Identity } from "../identity/service.js";

export async function registerWorkspaceSummaryRoutes(
  app: FastifyInstance,
  identity: Pick<Identity, "authenticate">,
  workspace: { read(actor: Actor): Promise<components["schemas"]["WorkspaceSummary"]> },
) {
  app.get(
    "/api/v1/me/workspace-summary",
    {
      async onRequest(_request, reply) {
        reply.header("Cache-Control", "no-store");
      },
      schema: {
        querystring: { type: "object", properties: {}, additionalProperties: false },
        response: { 200: { $ref: "urn:vtc:browser:v1#/$defs/EnvelopeWorkspaceSummary" } },
      },
    },
    async (request) => {
      const actor = await identity.authenticate(
        new Headers({ cookie: request.headers.cookie ?? "" }),
      );
      return { data: await workspace.read(actor), meta: { requestId: request.id } };
    },
  );
}
