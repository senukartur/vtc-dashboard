import type { components } from "@vtc/contracts";
import { applicationId } from "@vtc/db";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  checkImageMultipart,
  mediaType,
  multipartOverhead,
  registerImageMultipart,
} from "../../platform/http/image-multipart.js";
import { csrfProtection } from "../identity/http.js";
import { type Actor, type Identity, identityError } from "../identity/service.js";
import type { EventMedia } from "./media.js";

type S = components["schemas"];
const adminPath = "/api/v1/admin/events/:eventId/media";
const itemPath = `${adminPath}/:mediaId`;
const memberPath = "/api/v1/events/:eventId/media";
const contentPath = `${memberPath}/:mediaId/content`;
const coverPath = "/api/v1/public/events/:eventId/cover";
export const isEventMediaRoute = (path: string) =>
  [adminPath, itemPath, memberPath, contentPath, coverPath].includes(path);

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
};
type EventParam = { eventId: string };
type ItemParam = EventParam & { mediaId: string };
const eventParams = object({ eventId: id }, ["eventId"]);
const itemParams = object({ eventId: id, mediaId: id }, ["eventId", "mediaId"]);
const noQuery = object({});

function command(request: FastifyRequest) {
  const etag = request.headers["if-match"];
  if (etag === undefined) throw identityError(428);
  if (
    typeof etag !== "string" ||
    !/^"v[1-9]\d*"$/.test(etag) ||
    !Number.isSafeInteger(Number(etag.slice(2, -1)))
  )
    throw identityError(422);
  try {
    return {
      key: applicationId(request.headers["idempotency-key"] as string),
      expected: Number(etag.slice(2, -1)),
    };
  } catch {
    throw identityError(422);
  }
}

function envelope(request: FastifyRequest, data: unknown) {
  return { data, meta: { requestId: request.id } };
}
function versioned(
  request: FastifyRequest,
  reply: FastifyReply,
  data: { version: number },
  status = 200,
) {
  return reply.header("ETag", `"v${data.version}"`).code(status).send(envelope(request, data));
}
function image(reply: FastifyReply, content: Awaited<ReturnType<EventMedia["content"]>>) {
  reply.raw.once("close", () => content.stream.destroy());
  if (content.byteLength !== null) reply.header("Content-Length", content.byteLength);
  return reply
    .header("Cache-Control", "no-store")
    .header("X-Content-Type-Options", "nosniff")
    .type(content.contentType)
    .send(content.stream);
}

export async function registerEventMediaRoutes(
  app: FastifyInstance,
  identity: Identity,
  media: EventMedia,
) {
  const isUpload = (request: FastifyRequest) =>
    request.method === "POST" && request.routeOptions.url === adminPath;
  const maxBytes = media.config.maxFileBytes;
  const receive = await registerImageMultipart(app, maxBytes, isUpload, identityError, true);
  const csrf = csrfProtection(identity.config);
  const actors = new WeakMap<FastifyRequest, Actor>();
  function actor(request: FastifyRequest) {
    const current = actors.get(request);
    if (!current) throw new Error("EVENT_MEDIA_ACTOR_MISSING");
    return current;
  }
  app.addHook("onRequest", async (request) => {
    const read = request.method === "GET";
    await identity.rateLimit(read ? "read" : "command", request.ip);
    const path = request.routeOptions.url;
    if (path === coverPath) return;
    const current = await identity.authenticate(
      new Headers({ cookie: request.headers.cookie ?? "" }),
    );
    actors.set(request, current);
    await media.authorize(current, path === adminPath || path === itemPath);
    if (read) return;
    csrf.check(request, current);
    command(request);
    if (isUpload(request)) checkImageMultipart(request, maxBytes, identityError);
    else if (request.method === "DELETE") {
      if (
        request.headers["transfer-encoding"] !== undefined ||
        (request.headers["content-length"] !== undefined &&
          request.headers["content-length"] !== "0")
      )
        throw identityError(422);
      if (request.headers["content-type"] !== undefined)
        request.headers = { ...request.headers, "content-type": undefined };
    } else if (mediaType(request) !== "application/json") throw identityError(415);
  });
  const adminResponse = { 200: ref("EventStage2EnvelopeAdminMediaList") };
  app.get<{ Params: EventParam }>(
    adminPath,
    {
      exposeHeadRoute: false,
      schema: { params: eventParams, querystring: noQuery, response: adminResponse },
    },
    async (r, reply) => versioned(r, reply, await media.adminList(actor(r), r.params.eventId)),
  );

  app.post<{ Params: EventParam }>(
    adminPath,
    {
      bodyLimit: maxBytes + multipartOverhead,
      schema: {
        params: eventParams,
        querystring: noQuery,
        response: { 202: ref("EventStage2EnvelopeMediaUpload") },
      },
    },
    async (r, reply) => {
      const requestCommand = command(r);
      const data = await receive(
        r,
        reply,
        media.config.timeoutMs,
        ({ bytes, contentType, signal }) =>
          media.upload(actor(r), r.params.eventId, requestCommand, contentType, bytes, signal),
      );
      return versioned(r, reply, data, 202);
    },
  );
  app.patch<{ Params: ItemParam; Body: S["EventStage2MediaEditInput"] }>(
    itemPath,
    {
      schema: {
        params: itemParams,
        querystring: noQuery,
        body: ref("EventStage2MediaEditInput"),
        response: adminResponse,
      },
    },
    async (r, reply) =>
      versioned(
        r,
        reply,
        await media.edit(actor(r), r.params.eventId, r.params.mediaId, command(r), r.body),
      ),
  );
  app.delete<{ Params: ItemParam }>(
    itemPath,
    {
      schema: { params: itemParams, querystring: noQuery, response: adminResponse },
    },
    async (r, reply) =>
      versioned(
        r,
        reply,
        await media.remove(actor(r), r.params.eventId, r.params.mediaId, command(r)),
      ),
  );

  app.get<{ Params: EventParam }>(
    memberPath,
    {
      exposeHeadRoute: false,
      schema: {
        params: eventParams,
        querystring: noQuery,
        response: { 200: ref("EventStage2EnvelopeMediaList") },
      },
    },
    async (r) => envelope(r, await media.memberList(actor(r), r.params.eventId)),
  );
  app.get<{ Params: ItemParam; Querystring: { size: "thumb" | "full" } }>(
    contentPath,
    {
      exposeHeadRoute: false,
      schema: {
        params: itemParams,
        querystring: object({ size: { type: "string", enum: ["thumb", "full"] } }, ["size"]),
      },
    },
    async (r, reply) =>
      image(reply, await media.content(actor(r), r.params.eventId, r.params.mediaId, r.query.size)),
  );
  app.get<{ Params: EventParam }>(
    coverPath,
    {
      exposeHeadRoute: false,
      schema: { params: eventParams, querystring: noQuery },
    },
    async (r, reply) => image(reply, await media.content(null, r.params.eventId, null, "thumb")),
  );
}
