import type { components } from "@vtc/contracts";
import type { TxContext, UnitOfWork } from "@vtc/db";
import {
  and,
  applications,
  desc,
  eq,
  invitations,
  lt,
  lte,
  or,
  sql,
} from "@vtc/db/admissions-schema";
import { asc, gt, isNotNull, isNull } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { type Actor, type Identity, identityError } from "../identity/service.js";
import { type AdmissionsConfig, admissionsSecurity } from "./security.js";

type Schemas = components["schemas"];
type State = "active" | "expired";
const ref = (name: string) => ({ $ref: `urn:vtc:browser:v1#/$defs/${name}` });

export interface InvitationListPorts {
  identity: Pick<Identity, "transaction" | "authorizeInTransaction">;
  // Messaging owner's safe delivery state; absent when mail is not configured.
  mailStatus?: (tx: TxContext, deliveryId: string) => Promise<string>;
}

/**
 * Staff invitation list (VTC-140): the current generation of each approved application with the
 * applicant's nickname and email. `active` is the invited counter definition; `expired` is an
 * unused active-state generation at or past its expiry, whose secrets the cleanup may have
 * purged. Only listed columns are read, so no link, token, hash or ciphertext leaves the module.
 */
export function createInvitationList(
  unit: UnitOfWork,
  config: AdmissionsConfig,
  ports: InvitationListPorts,
  now: () => Date = () => new Date(),
) {
  const crypto = admissionsSecurity(config),
    client = (tx: TxContext) => unit.client(tx);
  return {
    async list(
      actor: Actor,
      options: { limit?: number | undefined; cursor?: string | undefined; state?: State } = {},
    ): Promise<Schemas["InvitationStage4List"]> {
      const state = options.state ?? "active";
      if (state !== "active" && state !== "expired") throw identityError(422);
      const limit = options.limit ?? 25;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw identityError(422);
      const binding = `${actor.userId}:${actor.sessionId}:${actor.accessEpoch}:invitations:${state}:v1`;
      let after: { at: string; id: string } | null = null;
      if (options.cursor) {
        try {
          after = crypto.readCursor(binding, options.cursor);
        } catch {
          throw identityError(409, "VERSION_CONFLICT");
        }
      }
      return ports.identity.transaction(async (tx) => {
        await ports.identity.authorizeInTransaction(tx, actor, "applications.manage");
        const computedAt = now().toISOString();
        const selected = and(
          eq(applications.status, "approved"),
          eq(invitations.state, "active"),
          isNull(invitations.consumedAt),
          state === "active"
            ? and(
                isNotNull(invitations.secretHash),
                isNotNull(invitations.ciphertext),
                gt(invitations.expiresAt, computedAt),
              )
            : lte(invitations.expiresAt, computedAt),
        );
        // Current generation only: the application points at it and it belongs to the application.
        const current = and(
          eq(applications.invitationId, invitations.id),
          eq(applications.id, invitations.applicationId),
        );
        const [counted] = await client(tx)
          .select({ count: sql<number | string>`count(*)` })
          .from(applications)
          .innerJoin(invitations, current)
          .where(selected);
        const rows = await client(tx)
          .select({
            id: invitations.id,
            version: invitations.version,
            applicationId: invitations.applicationId,
            expiresAt: invitations.expiresAt,
            deliveryId: invitations.deliveryId,
            nickname: applications.nickname,
            email: applications.email,
          })
          .from(applications)
          .innerJoin(invitations, current)
          .where(
            and(
              selected,
              after
                ? or(
                    state === "active"
                      ? gt(invitations.expiresAt, after.at)
                      : lt(invitations.expiresAt, after.at),
                    and(eq(invitations.expiresAt, after.at), gt(invitations.id, after.id)),
                  )
                : undefined,
            ),
          )
          .orderBy(
            state === "active" ? asc(invitations.expiresAt) : desc(invitations.expiresAt),
            asc(invitations.id),
          )
          .limit(limit + 1);
        const page = rows.slice(0, limit),
          last = page.at(-1);
        const items: Schemas["InvitationStage4ListItem"][] = [];
        for (const row of page)
          items.push({
            invitation: {
              id: row.id,
              version: row.version,
              applicationId: row.applicationId,
              expiresAt: row.expiresAt,
              state,
              emailDelivery: (row.deliveryId
                ? ((await ports.mailStatus?.(tx, row.deliveryId)) ?? "unavailable")
                : "not_requested") as Schemas["Invitation"]["emailDelivery"],
              deliveryId: row.deliveryId,
            },
            applicant: { nickname: row.nickname, email: row.email },
          });
        return {
          items,
          nextCursor:
            rows.length > limit && last ? crypto.cursor(binding, last.expiresAt, last.id) : null,
          total: Number(counted?.count ?? 0),
        };
      });
    },
  };
}
export type InvitationList = ReturnType<typeof createInvitationList>;

/**
 * GET /api/v1/admin/invitations. The admissions route hook registered before it answers missing
 * cookies with 401 and charges the staff read quota; the global hook marks it no-store.
 */
export async function registerInvitationListRoutes(
  app: FastifyInstance,
  identity: Pick<Identity, "authenticate">,
  invitationList: InvitationList,
) {
  const actor = (request: FastifyRequest) =>
    identity.authenticate(
      new Headers(request.headers.cookie ? { cookie: request.headers.cookie } : {}),
    );
  app.get<{ Querystring: { limit?: number; cursor?: string; state?: State } }>(
    "/api/v1/admin/invitations",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 100 },
            cursor: { type: "string", minLength: 1, maxLength: 2048 },
            state: { type: "string", enum: ["active", "expired"] },
          },
          additionalProperties: false,
        },
        response: { 200: ref("InvitationStage4ListEnvelope") },
      },
    },
    async (request) => ({
      data: await invitationList.list(await actor(request), request.query),
      meta: { requestId: request.id },
    }),
  );
}
