import type { components } from "@vtc/contracts";
import type { FastifyInstance } from "fastify";
import { stage3Envelope, stage3QuerySelection } from "../../platform/http/stage3.js";
import type { Actor, Identity } from "../identity/service.js";

export async function registerWorkspaceSummaryRoutes(
  app: FastifyInstance,
  identity: Pick<Identity, "authenticate">,
  workspace: {
    read(actor: Actor): Promise<components["schemas"]["WorkspaceSummary"]>;
    readStage3(actor: Actor): Promise<components["schemas"]["WorkspaceStage3Summary"]>;
  },
) {
  const envelope = stage3Envelope("EnvelopeWorkspaceSummary", "WorkspaceStage3SummaryEnvelope");
  app.get<{ Querystring: { view?: "stage3" } }>(
    "/api/v1/me/workspace-summary",
    {
      async onRequest(_request, reply) {
        reply.header("Cache-Control", "no-store");
      },
      schema: {
        querystring: stage3QuerySelection(
          { type: "object", properties: {}, additionalProperties: false },
          true,
        ),
      },
    },
    async (request) => {
      const actor = await identity.authenticate(
        new Headers({ cookie: request.headers.cookie ?? "" }),
      );
      const stage3 = request.query.view === "stage3";
      const data = stage3 ? await workspace.readStage3(actor) : await workspace.read(actor);
      return envelope(stage3, { data, meta: { requestId: request.id } });
    },
  );
}
