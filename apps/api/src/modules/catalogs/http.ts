import multipart from "@fastify/multipart";
import type { components } from "@vtc/contracts";
import { applicationId } from "@vtc/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { csrfProtection } from "../identity/http.js";
import { type Actor, type Identity, identityError } from "../identity/service.js";
import { kinds } from "./artifact.js";
import type { Catalogs } from "./service.js";

type S = components["schemas"];
const ref = (name: string) => ({ $ref: `urn:vtc:browser:v1#/$defs/${name}` });
const id = {
  type: "string",
  format: "uuid",
  pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
};
const locale = { type: "string", enum: ["en", "ru"] },
  game = { type: "string", enum: ["ets2", "ats"] };
const page = {
  limit: { type: "integer", minimum: 1, maximum: 100 },
  cursor: { type: "string", minLength: 1, maxLength: 2048 },
};
const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
export async function registerCatalogRoutes(
  app: FastifyInstance,
  identity: Identity,
  catalogs: Catalogs,
) {
  await app.register(multipart, {
    limits: {
      files: 1,
      fields: 0,
      parts: 1,
      fileSize: catalogs.config.maxFileBytes,
      fieldSize: 1,
      fieldNameSize: 32,
      headerPairs: 32,
    },
    throwFileSizeLimit: true,
  });
  const oversized = new WeakSet<FastifyRequest>();
  const actors = new WeakMap<FastifyRequest, Actor>(),
    csrf = csrfProtection(identity.config);
  const owned = (path: string) =>
    path.startsWith("/api/v1/catalogs/") ||
    path.startsWith("/api/v1/admin/catalog-") ||
    path.startsWith("/api/v1/operations/");
  async function actor(request: FastifyRequest) {
    const saved = actors.get(request);
    if (saved) return saved;
    const current = await identity.authenticate(
      new Headers({ cookie: request.headers.cookie ?? "" }),
    );
    actors.set(request, current);
    return current;
  }
  app.addHook("onRequest", async (request) => {
    const path = request.routeOptions.url;
    if (!path || !owned(path)) return;
    const current = await actor(request);
    await catalogs.authorize(current, !path.startsWith("/api/v1/catalogs/"));
    if (request.method === "POST") csrf.check(request, current);
    if (path === "/api/v1/admin/catalog-import-artifacts" && request.method === "POST") {
      if (
        request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !==
        "multipart/form-data"
      )
        throw identityError(415);
      const length = Number(request.headers["content-length"]);
      if (length > catalogs.config.maxFileBytes + 16384) throw identityError(413);
    }
  });
  app.addHook("preParsing", async (request, reply, payload) => {
    if (
      request.routeOptions.url !== "/api/v1/admin/catalog-import-artifacts" ||
      request.method !== "POST"
    )
      return payload;
    let received = 0;
    // Multipart consumes request.raw, not the hook's replacement payload. Observe
    // that stream without a second pipe, and let its parser start the flow.
    payload.pause();
    const count = (chunk: Buffer) => {
      received += chunk.length;
      if (received <= catalogs.config.maxFileBytes + 16384 || oversized.has(request)) return;
      oversized.add(request);
      payload.pause();
      // Stop reading immediately, but flush the safe response before closing
      // the request. The handler also fences retention after an exceeded limit.
      reply.raw.once("finish", () => payload.destroy());
      void reply.send(identityError(413));
    };
    const cleanup = () => payload.removeListener("data", count);
    payload.on("data", count);
    payload.once("end", cleanup);
    payload.once("close", cleanup);
    return payload;
  });
  app.addHook("preValidation", async (request) => {
    const path = request.routeOptions.url;
    if (
      path &&
      owned(path) &&
      request.method === "POST" &&
      path !== "/api/v1/admin/catalog-import-artifacts" &&
      request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !== "application/json"
    )
      throw identityError(415);
  });
  const envelope = (request: FastifyRequest, data: unknown) => ({
    data,
    meta: { requestId: request.id },
  });
  const key = (request: FastifyRequest) => {
    try {
      return applicationId(request.headers["idempotency-key"] as string);
    } catch {
      throw identityError(422);
    }
  };
  const expected = (request: FastifyRequest) => {
    const value = request.headers["if-match"];
    if (value === undefined) throw identityError(428);
    if (
      typeof value !== "string" ||
      !/^"v[1-9]\d*"$/.test(value) ||
      !Number.isSafeInteger(Number(value.slice(2, -1)))
    )
      throw identityError(422);
    return Number(value.slice(2, -1));
  };
  app.get<{ Querystring: { game: "ets2" | "ats"; limit?: number; cursor?: string } }>(
    "/api/v1/catalogs/revisions",
    {
      schema: {
        querystring: object({ ...page, game }, ["game"]),
        response: { 200: ref("EnvelopeListCatalogRevision") },
      },
    },
    async (request) =>
      envelope(
        request,
        await catalogs.revisions(await actor(request), request.query.game, request.query),
      ),
  );
  app.get<{
    Querystring: {
      revisionId: string;
      kind: string;
      locale: "en" | "ru";
      search?: string;
      regionId?: string;
      limit?: number;
      cursor?: string;
    };
  }>(
    "/api/v1/catalogs/entities",
    {
      schema: {
        querystring: object(
          {
            ...page,
            revisionId: id,
            kind: { type: "string", enum: kinds },
            locale,
            regionId: id,
            search: { type: "string", minLength: 1, maxLength: 128 },
          },
          ["revisionId", "kind", "locale"],
        ),
        response: { 200: ref("EnvelopeListCatalogEntity") },
      },
    },
    async (request) =>
      envelope(request, await catalogs.entities(await actor(request), request.query)),
  );
  app.get<{
    Params: { entityId: string };
    Querystring: { revisionId: string; locale: "en" | "ru" };
  }>(
    "/api/v1/catalogs/entities/:entityId",
    {
      schema: {
        params: object({ entityId: id }, ["entityId"]),
        querystring: object({ revisionId: id, locale }, ["revisionId", "locale"]),
        response: { 200: ref("EnvelopeCatalogEntity") },
      },
    },
    async (request) =>
      envelope(
        request,
        await catalogs.entity(
          await actor(request),
          request.params.entityId,
          request.query.revisionId,
          request.query.locale,
        ),
      ),
  );
  app.get(
    "/api/v1/admin/catalog-import-policy",
    { schema: { response: { 200: ref("EnvelopeUploadPolicy") } } },
    async (request) => envelope(request, await catalogs.policy(await actor(request))),
  );
  app.post(
    "/api/v1/admin/catalog-import-artifacts",
    { schema: { response: { 202: ref("EnvelopeCatalogArtifact") } } },
    async (request, reply) => {
      const idempotencyKey = key(request);
      let bytes: Buffer | undefined;
      try {
        for await (const part of request.parts()) {
          if (
            part.type !== "file" ||
            part.fieldname !== "file" ||
            part.mimetype !== "application/json" ||
            bytes
          )
            throw identityError(422);
          bytes = await part.toBuffer();
          if (part.file.truncated) throw identityError(413);
        }
      } catch (error) {
        if (oversized.has(request)) throw identityError(413);
        if (error && typeof error === "object" && "statusCode" in error) throw error;
        throw identityError(422);
      }
      if (oversized.has(request)) throw identityError(413);
      if (!bytes) throw identityError(422);
      return reply
        .code(202)
        .send(
          envelope(request, await catalogs.upload(await actor(request), idempotencyKey, bytes)),
        );
    },
  );
  app.get<{ Params: { artifactId: string } }>(
    "/api/v1/admin/catalog-import-artifacts/:artifactId",
    {
      schema: {
        params: object({ artifactId: id }, ["artifactId"]),
        response: { 200: ref("EnvelopeCatalogArtifact") },
      },
    },
    async (request) =>
      envelope(request, await catalogs.artifact(await actor(request), request.params.artifactId)),
  );
  app.post<{ Body: S["CatalogImportInput"] }>(
    "/api/v1/admin/catalog-imports",
    { schema: { body: ref("CatalogImportInput"), response: { 202: ref("EnvelopeOperation") } } },
    async (request, reply) =>
      reply
        .code(202)
        .send(
          envelope(
            request,
            await catalogs.import(await actor(request), key(request), request.body),
          ),
        ),
  );
  app.get<{ Params: { operationId: string } }>(
    "/api/v1/operations/:operationId",
    {
      schema: {
        params: object({ operationId: id }, ["operationId"]),
        response: { 200: ref("EnvelopeOperation") },
      },
    },
    async (request) =>
      envelope(request, await catalogs.operation(await actor(request), request.params.operationId)),
  );
  for (const review of [false, true])
    app.get<{ Params: { revisionId: string } }>(
      `/api/v1/admin/catalog-revisions/:revisionId${review ? "/review" : ""}`,
      {
        schema: {
          params: object({ revisionId: id }, ["revisionId"]),
          response: { 200: ref(review ? "EnvelopeCatalogReview" : "EnvelopeCatalogRevision") },
        },
      },
      async (request, reply) => {
        const data = await (review
          ? catalogs.review(await actor(request), request.params.revisionId)
          : catalogs.detail(await actor(request), request.params.revisionId));
        reply.header("ETag", `"v${data.version}"`);
        return envelope(request, data);
      },
    );
  for (const [lane, response] of [
    ["diff", "EnvelopeListCatalogEntityChange"],
    ["coverage", "EnvelopeListCatalogCoveragePack"],
    ["mapping-issues", "EnvelopeListCatalogMappingIssue"],
  ] as const)
    app.get<{
      Params: { revisionId: string };
      Querystring: { reviewVersion: number; changeKind?: string; limit?: number; cursor?: string };
    }>(
      `/api/v1/admin/catalog-revisions/:revisionId/${lane}`,
      {
        schema: {
          params: object({ revisionId: id }, ["revisionId"]),
          querystring: object(
            {
              ...page,
              reviewVersion: { type: "integer", minimum: 1, maximum: 9007199254740991 },
              ...(lane === "diff"
                ? { changeKind: { type: "string", enum: ["added", "changed", "retired"] } }
                : {}),
            },
            ["reviewVersion"],
          ),
          response: { 200: ref(response) },
        },
      },
      async (request) =>
        envelope(
          request,
          await catalogs.reviewPage(
            await actor(request),
            request.params.revisionId,
            lane,
            request.query,
          ),
        ),
    );
  app.post<{ Body: S["CatalogMappingInput"] }>(
    "/api/v1/admin/catalog-mappings",
    {
      schema: { body: ref("CatalogMappingInput"), response: { 201: ref("EnvelopeCommandResult") } },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(
          envelope(
            request,
            await catalogs.mapping(await actor(request), key(request), request.body),
          ),
        ),
  );
  app.post<{ Params: { revisionId: string }; Body: S["PublicationInput"] }>(
    "/api/v1/admin/catalog-revisions/:revisionId/publication",
    {
      schema: {
        params: object({ revisionId: id }, ["revisionId"]),
        body: ref("PublicationInput"),
        response: { 200: ref("EnvelopeCatalogRevision") },
      },
    },
    async (request, reply) => {
      const data = await catalogs.publish(
        await actor(request),
        request.params.revisionId,
        key(request),
        expected(request),
        request.body,
      );
      reply.header("ETag", `"v${data.version}"`);
      return envelope(request, data);
    },
  );
}
