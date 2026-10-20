import type { components } from "@vtc/contracts";
import { applicationId } from "@vtc/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { csrfProtection } from "../identity/http.js";
import { type Identity, identityError } from "../identity/service.js";
import { contract, event, fail, parseJson, TelemetryError } from "./parser.js";
import type { TelemetryService } from "./service.js";

const ref = (name: string) => ({ $ref: `urn:vtc:browser:v1#/$defs/${name}` });
export async function registerTelemetryRoutes(
  app: FastifyInstance,
  identity: Identity,
  telemetry: TelemetryService,
) {
  const csrf = csrfProtection(identity.config);
  const actor = (r: FastifyRequest) =>
    identity.authenticate(new Headers({ cookie: r.headers.cookie ?? "" }));
  const envelope = (data: unknown, r: FastifyRequest) => ({ data, meta: { requestId: r.id } });
  const key = (r: FastifyRequest) => {
    try {
      if (typeof r.headers["idempotency-key"] !== "string") throw new Error();
      return applicationId(r.headers["idempotency-key"]);
    } catch {
      throw identityError(422);
    }
  };
  app.get<{ Querystring: { limit?: number; cursor?: string } }>(
    "/api/v1/me/telemetry-tokens",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 100 },
            cursor: { type: "string", maxLength: 2048 },
          },
          additionalProperties: false,
        },
        response: { 200: ref("EnvelopeListTokenInfo") },
      },
    },
    async (r) => envelope(await telemetry.list(await actor(r), r.query), r),
  );
  app.post<{ Body: components["schemas"]["TokenInput"] }>(
    "/api/v1/me/telemetry-tokens",
    { schema: { body: ref("TokenInput"), response: { 201: ref("EnvelopeTokenIssued") } } },
    async (r, reply) => {
      const a = await actor(r);
      csrf.check(r, a);
      return reply.code(201).send(envelope(await telemetry.issue(a, key(r), r.body), r));
    },
  );
  app.delete<{ Params: { tokenId: string } }>(
    "/api/v1/me/telemetry-tokens/:tokenId",
    {
      schema: {
        params: {
          type: "object",
          required: ["tokenId"],
          properties: {
            tokenId: {
              type: "string",
              format: "uuid",
              pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
            },
          },
          additionalProperties: false,
        },
        response: { 200: ref("EnvelopeCommandResult") },
      },
    },
    async (r) => {
      const a = await actor(r);
      csrf.check(r, a);
      if (r.body !== undefined) throw identityError(422);
      return envelope(await telemetry.revoke(a, key(r), r.params.tokenId), r);
    },
  );
  // Encapsulation keeps frozen transport parsing, compilers and errors out of browser routes.
  await app.register(async (frozen) => {
    const tickets = new WeakMap<FastifyRequest, object>();
    frozen.removeAllContentTypeParsers();
    frozen.addContentTypeParser(
      "*",
      { parseAs: "buffer", bodyLimit: 65536 },
      (_request, body, done) => {
        try {
          done(null, parseJson(body as Buffer));
        } catch (e) {
          done(e as Error, undefined);
        }
      },
    );
    frozen.addHook("onRequest", async (r) => {
      tickets.set(
        r,
        await telemetry.admit(
          typeof r.headers.authorization === "string" ? r.headers.authorization : undefined,
          r.ip,
          r.routeOptions.url?.endsWith("/events") ? "events" : "control",
        ),
      );
      if (r.method === "GET") return;
      const media = r.headers["content-type"] ?? "";
      if (
        r.headers["content-encoding"] !== undefined ||
        !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(media)
      )
        return fail(415, "UNSUPPORTED_MEDIA_TYPE");
    });
    frozen.setErrorHandler((error, r, reply) => {
      const e =
        error instanceof TelemetryError
          ? error
          : error &&
              typeof error === "object" &&
              "statusCode" in error &&
              [400, 413, 415].includes(Number(error.statusCode))
            ? new TelemetryError(
                Number(error.statusCode),
                error.statusCode === 413
                  ? "PAYLOAD_TOO_LARGE"
                  : error.statusCode === 415
                    ? "UNSUPPORTED_MEDIA_TYPE"
                    : "INVALID_PAYLOAD",
              )
            : new TelemetryError(503, "TEMPORARILY_UNAVAILABLE");
      if (e.statusCode === 401) reply.header("WWW-Authenticate", 'Bearer realm="telemetry"');
      if (e.statusCode === 429) reply.header("Retry-After", String(e.retryAfter ?? 1));
      return reply.code(e.statusCode).send({
        error: { code: e.publicCode, retryable: e.statusCode === 429 || e.statusCode >= 500 },
        requestId: r.id,
      });
    });
    const auth = (r: FastifyRequest) =>
      typeof r.headers.authorization === "string" ? r.headers.authorization : undefined;
    frozen.get("/api/telemetry/v1/connection", async (r) =>
      telemetry.connection(auth(r), r.ip, tickets.get(r)),
    );
    frozen.post("/api/telemetry/v1/installations", async (r) => {
      contract(r.body);
      const p = r.body as Record<string, unknown>;
      if (
        Object.keys(p).length !== 2 ||
        typeof p.clientInstallationId !== "string" ||
        !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(p.clientInstallationId) ||
        !p.contract ||
        typeof p.contract !== "object" ||
        Object.keys(p.contract).length !== 2
      )
        return fail(400, "INVALID_PAYLOAD");
      return telemetry.register(auth(r), r.ip, p.clientInstallationId, tickets.get(r));
    });
    frozen.post("/api/telemetry/v1/events", async (r, reply) => {
      const result = await telemetry.receive(auth(r), r.ip, event(r.body), tickets.get(r));
      return reply.code(result.status === "stored" ? 202 : 200).send(result);
    });
  });
}
