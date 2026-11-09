import multipart from "@fastify/multipart";
import type { components } from "@vtc/contracts";
import { applicationId } from "@vtc/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { csrfProtection } from "../identity/http.js";
import { type Actor, type Identity, identityError } from "../identity/service.js";
import { CATALOG_IMPORT_MAX_BYTES, type CatalogList, catalogLists, type Game } from "./config.js";
import type { Catalogs } from "./service.js";

type S = components["schemas"];
const ref = (name: string) => ({ $ref: `urn:vtc:browser:v1#/$defs/${name}` });
const uuid = {
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
const inputSchema: Record<CatalogList, string> = {
  dlcs: "CatalogDlcInput",
  regions: "CatalogRegionInput",
  cities: "CatalogCityInput",
  cargoes: "CatalogCargoInput",
  trailers: "CatalogTrailerInput",
};
// Query strings arrive as text; this explicit enum is the only accepted boolean spelling.
const includeHidden = { type: "string", enum: ["true", "false"] };
const multipartOverhead = 16384;

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
      fileSize: CATALOG_IMPORT_MAX_BYTES,
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
    path === "/api/v1/catalogs" ||
    path.startsWith("/api/v1/catalogs/") ||
    path.startsWith("/api/v1/admin/catalogs/");
  const uploads = new Set(
    catalogLists.flatMap((list) => [
      `/api/v1/admin/catalogs/${list}/import-previews`,
      `/api/v1/admin/catalogs/${list}/imports`,
    ]),
  );
  const tooLarge = () => identityError(413, "CATALOG_FILE_TOO_LARGE");
  async function actor(request: FastifyRequest) {
    const saved = actors.get(request);
    if (saved) return saved;
    const current = await identity.authenticate(
      new Headers({ cookie: request.headers.cookie ?? "" }),
    );
    actors.set(request, current);
    return current;
  }
  const contentType = (request: FastifyRequest) =>
    request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
  app.addHook("onRequest", async (request) => {
    const path = request.routeOptions.url;
    if (!path || !owned(path)) return;
    const current = await actor(request);
    await catalogs.authorize(current, path.startsWith("/api/v1/admin/"));
    if (request.method !== "GET") csrf.check(request, current);
    if (uploads.has(path)) {
      if (contentType(request) !== "multipart/form-data") throw identityError(415);
      if (Number(request.headers["content-length"]) > CATALOG_IMPORT_MAX_BYTES + multipartOverhead)
        throw tooLarge();
    }
  });
  app.addHook("preParsing", async (request, reply, payload) => {
    if (!uploads.has(request.routeOptions.url ?? "")) return payload;
    let received = 0;
    // Multipart consumes request.raw, not the hook's replacement payload. Observe
    // that stream without a second pipe, and let its parser start the flow.
    payload.pause();
    const count = (chunk: Buffer) => {
      received += chunk.length;
      if (received <= CATALOG_IMPORT_MAX_BYTES + multipartOverhead || oversized.has(request))
        return;
      oversized.add(request);
      payload.pause();
      reply.raw.once("finish", () => payload.destroy());
      void reply.send(tooLarge());
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
      request.method !== "GET" &&
      !uploads.has(path) &&
      contentType(request) !== "application/json"
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
  async function upload(request: FastifyRequest) {
    let bytes: Buffer | undefined;
    try {
      for await (const part of request.parts()) {
        if (part.type !== "file" || part.fieldname !== "file" || bytes) throw identityError(422);
        bytes = await part.toBuffer();
        if (part.file.truncated) throw tooLarge();
      }
    } catch (error) {
      if (oversized.has(request)) throw tooLarge();
      if (error && typeof error === "object") {
        if ("code" in error && error.code === "FST_REQ_FILE_TOO_LARGE") throw tooLarge();
        if ("statusCode" in error) throw error;
      }
      throw identityError(422);
    }
    if (oversized.has(request)) throw tooLarge();
    if (!bytes) throw identityError(422);
    return bytes;
  }
  type ListQuery = {
    game: Game;
    search?: string;
    includeHidden?: "true" | "false";
    dlc?: string;
    regionId?: string;
    locale?: "en" | "ru";
    limit?: number;
    cursor?: string;
  };
  app.get<{ Querystring: { game: Game } }>(
    "/api/v1/catalogs/summary",
    {
      schema: {
        querystring: object({ game }, ["game"]),
        response: { 200: ref("EnvelopeCatalogSummary") },
      },
    },
    async (request) =>
      envelope(request, await catalogs.summary(await actor(request), request.query.game)),
  );
  for (const list of catalogLists) {
    app.get<{ Querystring: ListQuery }>(
      `/api/v1/catalogs/${list}`,
      {
        schema: {
          querystring: object(
            {
              ...page,
              game,
              search: { type: "string", minLength: 1, maxLength: 128 },
              includeHidden,
              locale,
              ...(list === "dlcs" ? {} : { dlc: { anyOf: [{ const: "base" }, uuid] } }),
              ...(list === "cities" ? { regionId: uuid } : {}),
            },
            ["game"],
          ),
          response: { 200: ref("EnvelopeCatalogItemList") },
        },
      },
      async (request) => {
        const query = request.query;
        return envelope(
          request,
          await catalogs.list(await actor(request), list, {
            ...query,
            includeHidden: query.includeHidden === "true",
          }),
        );
      },
    );
    app.get<{ Params: { id: string }; Querystring: { locale?: "en" | "ru" } }>(
      `/api/v1/catalogs/${list}/:id`,
      {
        schema: {
          params: object({ id: uuid }, ["id"]),
          querystring: object({ locale }),
          response: { 200: ref("EnvelopeCatalogItem") },
        },
      },
      async (request) =>
        envelope(
          request,
          await catalogs.get(await actor(request), list, request.params.id, request.query.locale),
        ),
    );
    app.post<{ Body: Record<string, unknown> & { game: Game } }>(
      `/api/v1/admin/catalogs/${list}`,
      {
        bodyLimit: 64 * 1024,
        schema: { body: ref(inputSchema[list]), response: { 201: ref("EnvelopeCatalogItem") } },
      },
      async (request, reply) =>
        reply
          .code(201)
          .send(
            envelope(
              request,
              await catalogs.create(await actor(request), list, key(request), request.body),
            ),
          ),
    );
    app.patch<{ Params: { id: string }; Body: S["CatalogItemPatch"] }>(
      `/api/v1/admin/catalogs/${list}/:id`,
      {
        bodyLimit: 64 * 1024,
        schema: {
          params: object({ id: uuid }, ["id"]),
          body: ref("CatalogItemPatch"),
          response: { 200: ref("EnvelopeCatalogItem") },
        },
      },
      async (request) =>
        envelope(
          request,
          await catalogs.patch(
            await actor(request),
            list,
            request.params.id,
            key(request),
            request.body,
          ),
        ),
    );
    app.post(
      `/api/v1/admin/catalogs/${list}/import-previews`,
      { schema: { response: { 200: ref("EnvelopeCatalogImportPreview") } } },
      async (request) => {
        const bytes = await upload(request);
        return envelope(request, await catalogs.previewImport(await actor(request), list, bytes));
      },
    );
    app.post(
      `/api/v1/admin/catalogs/${list}/imports`,
      { schema: { response: { 200: ref("EnvelopeCatalogImportResult") } } },
      async (request) => {
        const value = request.headers["if-match"];
        if (typeof value !== "string" || value === "")
          throw identityError(428, "CATALOG_IMPORT_TOKEN_REQUIRED");
        const token = /^"(.+)"$/.exec(value)?.[1];
        if (!token) throw identityError(412, "CATALOG_IMPORT_TOKEN_INVALID");
        const idempotencyKey = key(request);
        const bytes = await upload(request);
        return envelope(
          request,
          await catalogs.applyImport(await actor(request), list, bytes, idempotencyKey, token),
        );
      },
    );
  }
}
