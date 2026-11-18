import type { companionComponents } from "@vtc/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { logRequestFailure } from "../../platform/http/request-failure.js";
import type { TelemetryCompanion } from "../../use-cases/telemetry-companion.js";
import { parseJson, TelemetryError } from "./parser.js";
import type { TelemetryService } from "./service.js";

type S = companionComponents["schemas"];
const ref = (name: keyof S) => ({ $ref: `urn:vtc:companion:v1#/$defs/${name}` });
const noQuery = { type: "object", properties: {}, additionalProperties: false };
export async function registerCompanionRoutes(
  app: FastifyInstance,
  telemetry: TelemetryService,
  companion: TelemetryCompanion,
) {
  await app.register(async (child) => {
    const auth = (r: FastifyRequest) =>
      typeof r.headers.authorization === "string" ? r.headers.authorization : undefined;
    const tickets = new WeakMap<FastifyRequest, object>();
    child.removeAllContentTypeParsers();
    child.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: 16384 }, (_r, body, done) => {
      try {
        done(null, parseJson(body as Buffer));
      } catch (error) {
        done(error as Error, undefined);
      }
    });
    child.addHook("onRequest", async (r) => {
      tickets.set(r, await telemetry.admit(auth(r), r.ip, "companion"));
      if (r.headers["content-encoding"] !== undefined)
        throw new TelemetryError(415, "UNSUPPORTED_MEDIA_TYPE");
      if (
        r.method === "GET" &&
        (r.headers["transfer-encoding"] !== undefined ||
          (r.headers["content-length"] !== undefined && r.headers["content-length"] !== "0"))
      )
        throw new TelemetryError(400, "INVALID_PAYLOAD");
      if (
        r.method !== "GET" &&
        (r.headers["content-encoding"] !== undefined ||
          !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(
            r.headers["content-type"] ?? "",
          ))
      )
        throw new TelemetryError(415, "UNSUPPORTED_MEDIA_TYPE");
    });
    child.setErrorHandler((error, r, reply) => {
      const status = Number((error as { statusCode?: number })?.statusCode),
        validation = !!(error as { validation?: unknown })?.validation;
      const e =
        error instanceof TelemetryError
          ? error
          : new TelemetryError(
              validation ? 400 : [400, 413, 415].includes(status) ? status : 503,
              validation || status === 400
                ? "INVALID_PAYLOAD"
                : status === 413
                  ? "PAYLOAD_TOO_LARGE"
                  : status === 415
                    ? "UNSUPPORTED_MEDIA_TYPE"
                    : "TEMPORARILY_UNAVAILABLE",
            );
      if (e.statusCode === 401)
        reply.header("WWW-Authenticate", 'Bearer realm="telemetry-companion"');
      if (e.statusCode === 429 || e.statusCode >= 500)
        reply.header("Retry-After", String(e.retryAfter ?? 1));
      if (e.statusCode >= 500) logRequestFailure(r, e.statusCode, "TEMPORARILY_UNAVAILABLE", error);
      return reply.code(e.statusCode).send({
        error: { code: e.publicCode, retryable: e.statusCode === 429 || e.statusCode >= 500 },
        requestId: r.id,
      });
    });
    child.addHook("onSend", async (r, reply, payload) => {
      reply.header("Cache-Control", "no-store");
      if (typeof payload === "string" && Buffer.byteLength(payload) > 1048576) {
        if (
          reply.statusCode === 200 &&
          r.method === "POST" &&
          r.routeOptions.url === "/api/telemetry/companion/v1/results"
        )
          throw new TelemetryError(422, "RESULT_BATCH_TOO_LARGE");
        throw new TelemetryError(503, "TEMPORARILY_UNAVAILABLE");
      }
    });
    const prefix = "/api/telemetry/companion/v1";
    child.get(
      `${prefix}/capabilities`,
      { schema: { querystring: noQuery, response: { 200: ref("Capabilities") } } },
      (r) => companion.capabilities(auth(r), r.ip, tickets.get(r)),
    );
    child.get<{ Params: { game: S["Game"] } }>(
      `${prefix}/qualification/:game`,
      {
        schema: {
          querystring: noQuery,
          params: {
            type: "object",
            properties: { game: { type: "string", enum: ["ets2", "ats"] } },
            required: ["game"],
            additionalProperties: false,
          },
          response: { 200: ref("Qualification") },
        },
      },
      (r) => companion.qualification(auth(r), r.ip, r.params.game, tickets.get(r)),
    );
    child.post<{ Body: S["PreviewInput"] }>(
      `${prefix}/preview`,
      {
        schema: {
          querystring: noQuery,
          body: ref("PreviewInput"),
          response: { 200: ref("Preview") },
        },
      },
      (r) => companion.preview(auth(r), r.ip, r.body, tickets.get(r)),
    );
    child.post<{ Body: S["ResultBatchInput"] }>(
      `${prefix}/results`,
      {
        schema: {
          querystring: noQuery,
          body: ref("ResultBatchInput"),
          response: { 200: ref("ResultBatch"), 422: ref("Error") },
        },
      },
      (r) => companion.results(auth(r), r.ip, r.body, tickets.get(r)),
    );
  });
}
