import multipart from "@fastify/multipart";
import type { components } from "@vtc/contracts";
import { applicationId } from "@vtc/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { logoRevalidateCache, logoVersionedCache } from "../../platform/http/cache.js";
import { csrfProtection } from "../identity/http.js";
import { type Actor, type Identity, identityError } from "../identity/service.js";
import {
  CATALOG_IMPORT_MAX_BYTES,
  CATALOG_LOGO_BULK_MAX_BYTES,
  CATALOG_LOGO_BULK_MAX_FILES,
  CATALOG_LOGO_MAX_BYTES,
  type CatalogList,
  catalogLists,
  type Game,
  type ImportList,
  isCanonicalList,
} from "./config.js";
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
  companies: "CatalogCompanyInput",
  cargoes: "CatalogCargoInput",
  trailers: "CatalogTrailerInput",
};
// Validate literal query strings before converting flags for the service.
const listFilters = {
  includeHidden: { type: "string", enum: ["true", "false"] },
  hidden: { type: "string", const: "only" },
};
// Canonical lists and depots carry no translation, so they offer no untranslated filter.
const untranslatedFilter = { untranslated: { type: "string", const: "true" } };
const multipartOverhead = 16384;
// A batch part carries its own boundary and headers; this allows for the longest file names.
const batchOverhead = CATALOG_LOGO_BULK_MAX_FILES * 1024;
const logoPath = "/api/v1/admin/catalogs/companies/:id/logo";
const logoPreviewPath = "/api/v1/admin/catalogs/companies/logo-previews";
const logoImportPath = "/api/v1/admin/catalogs/companies/logo-imports";
const importLists: readonly ImportList[] = [...catalogLists, "depots"];

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
  // Upload routes and the most request bytes each accepts, multipart framing included.
  const uploads = new Map<string, number>([
    ...importLists.flatMap((list): [string, number][] => [
      [
        `POST /api/v1/admin/catalogs/${list}/import-previews`,
        CATALOG_IMPORT_MAX_BYTES + multipartOverhead,
      ],
      [`POST /api/v1/admin/catalogs/${list}/imports`, CATALOG_IMPORT_MAX_BYTES + multipartOverhead],
    ]),
    [`PUT ${logoPath}`, CATALOG_LOGO_MAX_BYTES + multipartOverhead],
    [`POST ${logoPreviewPath}`, CATALOG_LOGO_BULK_MAX_BYTES + batchOverhead],
    [`POST ${logoImportPath}`, CATALOG_LOGO_BULK_MAX_BYTES + batchOverhead],
  ]);
  const routeKey = (request: FastifyRequest) =>
    `${request.method} ${request.routeOptions.url ?? ""}`;
  // The only write that carries no body; it still needs a session and the CSRF token.
  const bodyless = new Set([`DELETE ${logoPath}`]);
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
    const limit = uploads.get(routeKey(request));
    if (limit !== undefined) {
      if (contentType(request) !== "multipart/form-data") throw identityError(415);
      if (Number(request.headers["content-length"]) > limit) throw tooLarge();
    }
  });
  app.addHook("preParsing", async (request, reply, payload) => {
    const limit = uploads.get(routeKey(request));
    if (limit === undefined) return payload;
    let received = 0;
    // Multipart consumes request.raw, not the hook's replacement payload. Observe
    // that stream without a second pipe, and let its parser start the flow.
    payload.pause();
    const count = (chunk: Buffer) => {
      received += chunk.length;
      if (received <= limit || oversized.has(request)) return;
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
      !uploads.has(routeKey(request)) &&
      contentType(request) !== "application/json"
    ) {
      const empty =
        !request.headers["transfer-encoding"] &&
        (request.headers["content-length"] === undefined ||
          request.headers["content-length"] === "0");
      if (!(bodyless.has(routeKey(request)) && empty)) throw identityError(415);
    }
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
  const failedUpload = (request: FastifyRequest, error: unknown): never => {
    if (oversized.has(request)) throw tooLarge();
    if (error && typeof error === "object") {
      if ("code" in error && error.code === "FST_REQ_FILE_TOO_LARGE") throw tooLarge();
      if ("statusCode" in error) throw error;
    }
    throw identityError(422);
  };
  /** The single file of an upload; `fileBytes` tightens the per-file limit for logos. */
  async function upload(request: FastifyRequest, fileBytes = CATALOG_IMPORT_MAX_BYTES) {
    let bytes: Buffer | undefined;
    try {
      for await (const part of request.parts({ limits: { fileSize: fileBytes } })) {
        if (part.type !== "file" || part.fieldname !== "file" || bytes) throw identityError(422);
        bytes = await part.toBuffer();
        if (part.file.truncated) throw tooLarge();
      }
    } catch (error) {
      return failedUpload(request, error);
    }
    if (oversized.has(request)) throw tooLarge();
    if (!bytes) throw identityError(422);
    return bytes;
  }
  /**
   * The files of a logo batch in submission order. A file over the per-logo size is kept as
   * truncated so the dry run can name it instead of rejecting the whole upload.
   */
  async function logoFiles(request: FastifyRequest) {
    const files: { name: string; bytes: Buffer; truncated: boolean }[] = [];
    try {
      // The plugin reads throwFileSizeLimit per call, but its typings omit it.
      const options = {
        preservePath: true,
        throwFileSizeLimit: false,
        limits: {
          files: CATALOG_LOGO_BULK_MAX_FILES,
          parts: CATALOG_LOGO_BULK_MAX_FILES,
          fileSize: CATALOG_LOGO_MAX_BYTES,
        },
      };
      for await (const part of request.parts(options)) {
        if (part.type !== "file" || part.fieldname !== "file") throw identityError(422);
        const bytes = await part.toBuffer();
        files.push({ name: part.filename, bytes, truncated: part.file.truncated });
      }
    } catch (error) {
      return failedUpload(request, error);
    }
    if (oversized.has(request)) throw tooLarge();
    if (!files.length) throw identityError(422);
    return files;
  }
  const gameQuery = object({ game }, ["game"]);
  const importToken = (request: FastifyRequest) => {
    const value = request.headers["if-match"];
    if (typeof value !== "string" || value === "")
      throw identityError(428, "CATALOG_IMPORT_TOKEN_REQUIRED");
    const token = /^"(.+)"$/.exec(value)?.[1];
    if (!token) throw identityError(412, "CATALOG_IMPORT_TOKEN_INVALID");
    return token;
  };
  type ListQuery = {
    game: Game;
    search?: string;
    includeHidden?: "true" | "false";
    hidden?: "only";
    untranslated?: "true";
    dlc?: string;
    regionId?: string;
    locale?: "en" | "ru";
    limit?: number;
    cursor?: string;
  };
  const normalizeListQuery = <T extends ListQuery>(query: T) => ({
    ...query,
    includeHidden: query.includeHidden === "true",
    untranslated: query.untranslated === "true",
  });
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
    app.get<{ Querystring: ListQuery & { logo?: "missing" } }>(
      `/api/v1/catalogs/${list}`,
      {
        schema: {
          querystring: object(
            {
              ...page,
              game,
              search: { type: "string", minLength: 1, maxLength: 128 },
              ...listFilters,
              ...(isCanonicalList(list) ? {} : untranslatedFilter),
              locale,
              ...(list === "companies" ? { logo: { type: "string", const: "missing" } } : {}),
              ...(list === "dlcs" ? {} : { dlc: { anyOf: [{ const: "base" }, uuid] } }),
              ...(list === "cities" ? { regionId: uuid } : {}),
            },
            ["game"],
          ),
          response: { 200: ref("EnvelopeCatalogItemList") },
        },
      },
      async (request) =>
        envelope(
          request,
          await catalogs.list(await actor(request), list, normalizeListQuery(request.query)),
        ),
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
  }

  for (const list of importLists) {
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
        const token = importToken(request);
        const idempotencyKey = key(request);
        const bytes = await upload(request);
        return envelope(
          request,
          await catalogs.applyImport(await actor(request), list, bytes, idempotencyKey, token),
        );
      },
    );
  }

  // Depots: a company that operates in a city.
  app.get<{
    Querystring: Omit<ListQuery, "untranslated"> & {
      companyId?: string;
      cityId?: string;
      depotId?: string;
    };
  }>(
    "/api/v1/catalogs/depots",
    {
      schema: {
        querystring: object(
          {
            ...page,
            game,
            companyId: uuid,
            cityId: uuid,
            depotId: uuid,
            search: { type: "string", minLength: 1, maxLength: 128 },
            ...listFilters,
            locale,
            dlc: { anyOf: [{ const: "base" }, uuid] },
          },
          ["game"],
        ),
        response: { 200: ref("EnvelopeCatalogDepotList") },
      },
    },
    async (request) =>
      envelope(
        request,
        await catalogs.listDepots(await actor(request), {
          ...request.query,
          includeHidden: request.query.includeHidden === "true",
        }),
      ),
  );
  app.post<{ Body: S["CatalogDepotInput"] }>(
    "/api/v1/admin/catalogs/depots",
    {
      bodyLimit: 64 * 1024,
      schema: { body: ref("CatalogDepotInput"), response: { 201: ref("EnvelopeCatalogDepot") } },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(
          envelope(
            request,
            await catalogs.createDepot(await actor(request), key(request), request.body),
          ),
        ),
  );
  app.patch<{ Params: { id: string }; Body: S["CatalogDepotPatch"] }>(
    "/api/v1/admin/catalogs/depots/:id",
    {
      bodyLimit: 64 * 1024,
      schema: {
        params: object({ id: uuid }, ["id"]),
        body: ref("CatalogDepotPatch"),
        response: { 200: ref("EnvelopeCatalogDepot") },
      },
    },
    async (request) =>
      envelope(
        request,
        await catalogs.patchDepot(
          await actor(request),
          request.params.id,
          key(request),
          request.body,
        ),
      ),
  );

  // Company logos. Reads need company.read on every request; writes need qualifications.manage.
  const etagMatcher = (request: FastifyRequest) => {
    const header = request.headers["if-none-match"];
    const supplied =
      typeof header === "string" ? header.split(",").map((v) => v.trim().replace(/^W\//, "")) : [];
    return (etag: string) => supplied.includes("*") || supplied.includes(`"${etag}"`);
  };
  app.get<{ Params: { id: string }; Querystring: { v?: string } }>(
    "/api/v1/catalogs/companies/:id/logo",
    {
      schema: {
        params: object({ id: uuid }, ["id"]),
        querystring: object({ v: { type: "string", pattern: "^[0-9a-f]{16}$" } }),
      },
    },
    async (request, reply) => {
      const logo = await catalogs.readLogo(
        await actor(request),
        request.params.id,
        etagMatcher(request),
      );
      reply
        .header("ETag", `"${logo.etag}"`)
        .header("Vary", "Cookie")
        .header(
          "Cache-Control",
          request.query.v === logo.version ? logoVersionedCache : logoRevalidateCache,
        );
      if (logo.png === null) return reply.code(304).send();
      return reply
        .type("image/png")
        .header("Content-Disposition", "inline")
        .header("Content-Length", logo.png.length)
        .send(logo.png);
    },
  );
  app.put<{ Params: { id: string } }>(
    logoPath,
    {
      schema: {
        params: object({ id: uuid }, ["id"]),
        response: { 200: ref("EnvelopeCatalogItem") },
      },
    },
    async (request) => {
      const idempotencyKey = key(request);
      const bytes = await upload(request, CATALOG_LOGO_MAX_BYTES);
      return envelope(
        request,
        await catalogs.setLogo(await actor(request), request.params.id, idempotencyKey, bytes),
      );
    },
  );
  app.delete<{ Params: { id: string } }>(
    logoPath,
    {
      schema: {
        params: object({ id: uuid }, ["id"]),
        response: { 200: ref("EnvelopeCatalogItem") },
      },
    },
    async (request) =>
      envelope(
        request,
        await catalogs.removeLogo(await actor(request), request.params.id, key(request)),
      ),
  );
  app.post<{ Querystring: { game: Game } }>(
    logoPreviewPath,
    {
      schema: {
        querystring: gameQuery,
        response: { 200: ref("EnvelopeCatalogImportPreview") },
      },
    },
    async (request) =>
      envelope(
        request,
        await catalogs.previewLogos(
          await actor(request),
          request.query.game,
          await logoFiles(request),
        ),
      ),
  );
  app.post<{ Querystring: { game: Game } }>(
    logoImportPath,
    {
      schema: {
        querystring: gameQuery,
        response: { 200: ref("EnvelopeCatalogImportResult") },
      },
    },
    async (request) => {
      const token = importToken(request);
      const idempotencyKey = key(request);
      const files = await logoFiles(request);
      return envelope(
        request,
        await catalogs.applyLogos(
          await actor(request),
          request.query.game,
          files,
          idempotencyKey,
          token,
        ),
      );
    },
  );
}
