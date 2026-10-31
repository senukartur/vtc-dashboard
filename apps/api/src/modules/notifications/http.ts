import type { components } from "@vtc/contracts";
import { applicationId } from "@vtc/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { csrfProtection } from "../identity/http.js";
import { type Actor, type Identity, identityError } from "../identity/service.js";
import type { Notifications } from "./service.js";

const ref = (name: string) => ({ $ref: `urn:vtc:browser:v1#/$defs/${name}` });
const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
export async function registerNotificationRoutes(
  app: FastifyInstance,
  identity: Identity,
  service: Notifications,
) {
  const actors = new WeakMap<FastifyRequest, Actor>(),
    csrf = csrfProtection(identity.config);
  const owned = (p: string) =>
    p === "/api/v1/me/notification-preferences" ||
    p === "/api/v1/notifications" ||
    p.startsWith("/api/v1/notifications/");
  async function actor(r: FastifyRequest) {
    let a = actors.get(r);
    if (!a) {
      a = await identity.authenticate(new Headers({ cookie: r.headers.cookie ?? "" }));
      actors.set(r, a);
    }
    return a;
  }
  app.addHook("onRequest", async (r) => {
    const p = r.routeOptions.url;
    if (!p || !owned(p)) return;
    if (!p.startsWith("/api/v1/me/"))
      await identity.rateLimit(r.method === "GET" ? "read" : "command", r.ip);
    const a = await actor(r);
    await service.authorize(a);
    if (r.method !== "GET") csrf.check(r, a);
  });
  app.addHook("preValidation", async (r) => {
    const p = r.routeOptions.url;
    if (p && owned(p) && p.endsWith("/read")) {
      if (r.body !== undefined) throw identityError(422);
      return;
    }
    if (
      p &&
      owned(p) &&
      r.method !== "GET" &&
      r.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !== "application/json"
    )
      throw identityError(415);
  });
  const envelope = (r: FastifyRequest, data: unknown) => ({ data, meta: { requestId: r.id } });
  function key(r: FastifyRequest) {
    try {
      return applicationId(r.headers["idempotency-key"] as string);
    } catch {
      throw identityError(422);
    }
  }
  function expected(r: FastifyRequest) {
    const v = r.headers["if-match"];
    if (v === undefined) throw identityError(428);
    if (
      typeof v !== "string" ||
      !/^"v[1-9]\d*"$/.test(v) ||
      !Number.isSafeInteger(Number(v.slice(2, -1)))
    )
      throw identityError(422);
    return Number(v.slice(2, -1));
  }
  const query = object({
    limit: { type: "integer", minimum: 1, maximum: 100 },
    cursor: { type: "string", minLength: 1, maxLength: 2048 },
  });
  for (const history of [false, true])
    app.get<{ Querystring: { cursor?: string; limit?: number } }>(
      history ? "/api/v1/notifications/history" : "/api/v1/notifications",
      {
        schema: {
          querystring: query,
          response: { 200: ref(history ? "EnvelopeListNotification" : "EnvelopeNotificationFeed") },
        },
      },
      async (r) =>
        envelope(
          r,
          await (history
            ? service.history(await actor(r), r.query)
            : service.poll(await actor(r), r.query)),
        ),
    );
  app.get(
    "/api/v1/me/notification-preferences",
    {
      schema: {
        querystring: object({}),
        response: { 200: ref("EnvelopeNotificationPreferences") },
      },
    },
    async (r, reply) => {
      const result = await service.getPreferences(await actor(r));
      reply.header("ETag", `"v${result.version}"`);
      return envelope(r, result.data);
    },
  );
  app.put<{ Body: components["schemas"]["NotificationPreferences"] }>(
    "/api/v1/me/notification-preferences",
    {
      schema: {
        querystring: object({}),
        body: ref("NotificationPreferences"),
        response: { 200: ref("EnvelopeNotificationPreferences") },
      },
    },
    async (r, reply) => {
      const result = await service.setPreferences(await actor(r), key(r), expected(r), r.body);
      reply.header("ETag", `"v${result.version}"`);
      return envelope(r, result.data);
    },
  );
  app.post<{ Params: { notificationId: string } }>(
    "/api/v1/notifications/:notificationId/read",
    {
      schema: {
        params: object(
          {
            notificationId: {
              type: "string",
              format: "uuid",
              pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
            },
          },
          ["notificationId"],
        ),
        querystring: object({}),
        response: { 200: ref("EnvelopeCommandResult") },
      },
    },
    async (r) => envelope(r, await service.read(await actor(r), r.params.notificationId, key(r))),
  );
  app.post<{ Body: components["schemas"]["ReadAllInput"] }>(
    "/api/v1/notifications/read-all",
    {
      schema: {
        querystring: object({}),
        body: ref("ReadAllInput"),
        response: { 200: ref("EnvelopeCommandResult") },
      },
    },
    async (r) =>
      envelope(r, await service.readThrough(await actor(r), key(r), r.body.throughCursor)),
  );
}
