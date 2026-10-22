import type { components } from "@vtc/contracts";
import { applicationId } from "@vtc/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { csrfProtection } from "../identity/http.js";
import { type Actor, type Identity, identityError } from "../identity/service.js";
import type { Page } from "./pagination.js";
import type { Events } from "./service.js";
type S = components["schemas"];
const ref = (name: string) => ({ $ref: `urn:vtc:browser:v1#/$defs/${name}` });
const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const id = {
    type: "string",
    format: "uuid",
    pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
  },
  params = object({ eventId: id }, ["eventId"]),
  page = {
    limit: { type: "integer", minimum: 1, maximum: 100 },
    cursor: { type: "string", minLength: 1, maxLength: 2048 },
  };
export async function registerEventRoutes(
  app: FastifyInstance,
  identity: Identity,
  events: Events,
) {
  const actors = new WeakMap<FastifyRequest, Actor>(),
    csrf = csrfProtection(identity.config);
  const owned = (p: string) =>
    p.startsWith("/api/v1/events") ||
    p.startsWith("/api/v1/public/events") ||
    p.startsWith("/api/v1/admin/events") ||
    p === "/api/v1/me/upcoming-event";
  async function actor(request: FastifyRequest) {
    let a = actors.get(request);
    if (!a) {
      a = await identity.authenticate(new Headers({ cookie: request.headers.cookie ?? "" }));
      actors.set(request, a);
    }
    return a;
  }
  app.addHook("onRequest", async (request) => {
    const p = request.routeOptions.url;
    if (!p || !owned(p)) return;
    if (!p.startsWith("/api/v1/me/"))
      await identity.rateLimit(request.method === "GET" ? "read" : "command", request.ip);
    if (p.startsWith("/api/v1/public/")) return;
    const a = await actor(request);
    await events.authorize(a, p.startsWith("/api/v1/admin/"));
    if (request.method !== "GET") csrf.check(request, a);
  });
  app.addHook("preValidation", async (request) => {
    if (
      request.routeOptions.url &&
      owned(request.routeOptions.url) &&
      request.method !== "GET" &&
      request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !== "application/json"
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
  for (const publicOnly of [false, true]) {
    const prefix = publicOnly ? "/api/v1/public/events" : "/api/v1/events";
    app.get<{ Querystring: Page & { period?: "upcoming" | "past" } }>(
      prefix,
      {
        schema: {
          querystring: object({ ...page, period: { type: "string", enum: ["upcoming", "past"] } }),
          response: { 200: ref("EnvelopeListEventPublic") },
        },
      },
      async (r) => envelope(r, await events.list(publicOnly ? null : await actor(r), r.query)),
    );
    app.get<{ Params: { eventId: string } }>(
      `${prefix}/:eventId`,
      {
        schema: {
          params,
          querystring: object({}),
          response: { 200: ref(publicOnly ? "EnvelopeEventPublic" : "EnvelopeEventMember") },
        },
      },
      async (r, reply) => {
        const result = await events.get(publicOnly ? null : await actor(r), r.params.eventId);
        reply.header("ETag", `"v${result.version}"`);
        return envelope(r, result.data);
      },
    );
  }
  app.get(
    "/api/v1/me/upcoming-event",
    { schema: { querystring: object({}), response: { 200: ref("EnvelopeOptionalEvent") } } },
    async (r) => envelope(r, await events.nearest(await actor(r))),
  );
  app.get<{ Params: { eventId: string } }>(
    "/api/v1/events/:eventId/my-response",
    { schema: { params, querystring: object({}), response: { 200: ref("EnvelopeRsvp") } } },
    async (r, reply) => {
      const result = await events.myResponse(await actor(r), r.params.eventId);
      reply.header("ETag", `"v${result.version}"`);
      return envelope(r, result.data);
    },
  );
  app.put<{ Params: { eventId: string }; Body: S["RsvpInput"] }>(
    "/api/v1/events/:eventId/my-response",
    { schema: { params, body: ref("RsvpInput"), response: { 200: ref("EnvelopeRsvp") } } },
    async (r, reply) => {
      const result = await events.respond(
        await actor(r),
        r.params.eventId,
        key(r),
        expected(r),
        r.body,
      );
      reply.header("ETag", `"v${result.version}"`);
      return envelope(r, result.data);
    },
  );
  app.get<{ Params: { eventId: string }; Querystring: Page }>(
    "/api/v1/events/:eventId/participants",
    {
      schema: {
        params,
        querystring: object(page),
        response: { 200: ref("EnvelopeListParticipant") },
      },
    },
    async (r) => envelope(r, await events.participants(await actor(r), r.params.eventId, r.query)),
  );
  app.post<{ Body: S["EventInput"] }>(
    "/api/v1/admin/events",
    { schema: { body: ref("EventInput"), response: { 201: ref("EnvelopeEventMember") } } },
    async (r, reply) => {
      const result = await events.create(await actor(r), key(r), r.body);
      reply.code(201).header("ETag", `"v${result.version}"`);
      return envelope(r, result.data);
    },
  );
  app.patch<{ Params: { eventId: string }; Body: S["EventInput"] }>(
    "/api/v1/admin/events/:eventId",
    { schema: { params, body: ref("EventInput"), response: { 200: ref("EnvelopeEventMember") } } },
    async (r, reply) => {
      const result = await events.update(
        await actor(r),
        r.params.eventId,
        key(r),
        expected(r),
        r.body,
      );
      reply.header("ETag", `"v${result.version}"`);
      return envelope(r, result.data);
    },
  );
  app.post<{ Params: { eventId: string }; Body: S["ReasonInput"] }>(
    "/api/v1/admin/events/:eventId/cancellation",
    { schema: { params, body: ref("ReasonInput"), response: { 200: ref("EnvelopeEventMember") } } },
    async (r, reply) => {
      const result = await events.cancel(
        await actor(r),
        r.params.eventId,
        key(r),
        expected(r),
        r.body.reason,
      );
      reply.header("ETag", `"v${result.version}"`);
      return envelope(r, result.data);
    },
  );
  app.get<{ Params: { eventId: string }; Querystring: Page }>(
    "/api/v1/admin/events/:eventId/attendance",
    {
      schema: {
        params,
        querystring: object(page),
        response: { 200: ref("EnvelopeListAttendance") },
      },
    },
    async (r, reply) => {
      const result = await events.attendance(await actor(r), r.params.eventId, r.query);
      reply.header("ETag", `"v${result.version}"`);
      return envelope(r, result.data);
    },
  );
  app.put<{ Params: { eventId: string }; Body: S["AttendanceInput"] }>(
    "/api/v1/admin/events/:eventId/attendance",
    {
      schema: {
        params,
        body: ref("AttendanceInput"),
        response: { 200: ref("EnvelopeCommandResult") },
      },
    },
    async (r, reply) => {
      const result = await events.setAttendance(
        await actor(r),
        r.params.eventId,
        key(r),
        expected(r),
        r.body,
      );
      reply.header("ETag", `"v${result.version}"`);
      return envelope(r, result.data);
    },
  );
}
