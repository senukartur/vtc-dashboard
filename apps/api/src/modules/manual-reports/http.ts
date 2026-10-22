import multipart from "@fastify/multipart";
import type { components } from "@vtc/contracts";
import { applicationId } from "@vtc/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { BlobFailure } from "../../platform/blob-storage/filesystem.js";
import { csrfProtection } from "../identity/http.js";
import type { Actor, Identity } from "../identity/service.js";
import { type ManualReports, manualError } from "./service.js";

type S = components["schemas"];
type Request = FastifyRequest<{
  Params: Record<string, string>;
  Querystring: { limit?: number; cursor?: string };
}>;
const ref = (name: string) => ({ $ref: `urn:vtc:browser:v1#/$defs/${name}` });
const id = {
  type: "string",
  format: "uuid",
  pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
};
const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
function expected(r: FastifyRequest) {
  const value = r.headers["if-match"];
  if (value === undefined) throw manualError(428);
  if (
    typeof value !== "string" ||
    !/^"v[1-9]\d*"$/.test(value) ||
    !Number.isSafeInteger(Number(value.slice(2, -1)))
  )
    throw manualError(422);
  return Number(value.slice(2, -1));
}
function key(r: FastifyRequest) {
  try {
    return applicationId(r.headers["idempotency-key"] as string);
  } catch {
    throw manualError(422);
  }
}
export async function registerManualRoutes(
  app: FastifyInstance,
  identity: Identity,
  manual: ManualReports,
) {
  const maxBytes = manual.config.storage?.maxFileBytes ?? 1,
    actors = new WeakMap<FastifyRequest, Actor>(),
    csrf = csrfProtection(identity.config),
    oversized = new WeakSet<FastifyRequest>();
  await app.register(multipart, {
    limits: {
      files: 1,
      fields: 0,
      parts: 1,
      fileSize: maxBytes,
      fieldSize: 1,
      fieldNameSize: 32,
      headerPairs: 32,
    },
    throwFileSizeLimit: true,
  });
  async function actor(r: FastifyRequest) {
    const cached = actors.get(r);
    if (cached) return cached;
    const result = await identity.authenticate(new Headers({ cookie: r.headers.cookie ?? "" }));
    actors.set(r, result);
    return result;
  }
  app.addHook("onRequest", async (r) => {
    await identity.rateLimit(r.method === "GET" ? "read" : "command", r.ip);
    const current = await actor(r);
    await manual.authorize(
      current,
      r.method !== "GET" ||
        r.routeOptions.url?.includes("manual-drafts") ||
        r.routeOptions.url === "/api/v1/me/upload-policy",
    );
    if (r.method !== "GET") {
      csrf.check(r, current);
      key(r);
      if (r.routeOptions.url === "/api/v1/evidence") {
        if (
          r.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !== "multipart/form-data"
        )
          throw manualError(415);
        if (Number(r.headers["content-length"]) > maxBytes + 16384) throw manualError(413);
      } else if (
        r.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !== "application/json"
      )
        throw manualError(415);
    }
  });
  app.addHook("preParsing", async (r, reply, payload) => {
    if (r.routeOptions.url !== "/api/v1/evidence" || r.method !== "POST") return payload;
    let received = 0;
    payload.pause();
    const count = (chunk: Buffer) => {
      received += chunk.length;
      if (received <= maxBytes + 16384 || oversized.has(r)) return;
      oversized.add(r);
      payload.pause();
      reply.raw.once("finish", () => payload.destroy());
      void reply.send(manualError(413));
    };
    const cleanup = () => payload.removeListener("data", count);
    payload.on("data", count);
    payload.once("end", cleanup);
    payload.once("close", cleanup);
    return payload;
  });
  const envelope = (r: FastifyRequest, data: unknown) => ({ data, meta: { requestId: r.id } });
  function route(
    method: "GET" | "POST" | "PUT",
    url: string,
    response: string,
    invoke: (actor: Actor, r: Request) => Promise<unknown>,
    body?: string,
    status = 200,
    page = false,
  ) {
    const names = [...url.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1] as string);
    app.route({
      method,
      url,
      schema: {
        params: object(Object.fromEntries(names.map((n) => [n, id])), names),
        querystring: object(
          page
            ? {
                limit: { type: "integer", minimum: 1, maximum: 100 },
                cursor: { type: "string", minLength: 1, maxLength: 2048 },
              }
            : {},
        ),
        ...(body ? { body: ref(body) } : {}),
        response: { [status]: ref(response) },
      },
      handler: async (raw, reply) => {
        const r = raw as Request,
          data = await invoke(await actor(r), r);
        let result = data;
        if (data && typeof data === "object" && "data" in data && "version" in data) {
          reply.header("ETag", `"v${data.version}"`);
          result = data.data;
        } else if (data && typeof data === "object" && "version" in data)
          reply.header("ETag", `"v${data.version}"`);
        else if (
          data &&
          typeof data === "object" &&
          "view" in data &&
          data.view === "private" &&
          "summary" in data
        )
          reply.header("ETag", `"v${(data.summary as S["TripSummary"]).version}"`);
        return reply.code(status).send(envelope(r, result));
      },
    });
  }
  route("GET", "/api/v1/me/upload-policy", "EnvelopeUploadPolicy", (a) => manual.policy(a));
  route(
    "GET",
    "/api/v1/me/manual-drafts",
    "EnvelopeListManualDraft",
    (a, r) => manual.listDrafts(a, r.query),
    undefined,
    200,
    true,
  );
  route(
    "POST",
    "/api/v1/me/manual-drafts",
    "EnvelopeManualDraft",
    (a, r) => manual.createDraft(a, key(r), r.body as S["ManualDraftInput"]),
    "ManualDraftInput",
    201,
  );
  route("GET", "/api/v1/me/manual-drafts/:draftId", "EnvelopeManualDraft", (a, r) =>
    manual.getDraft(a, r.params.draftId as string),
  );
  route(
    "PUT",
    "/api/v1/me/manual-drafts/:draftId",
    "EnvelopeManualDraft",
    (a, r) =>
      manual.replaceDraft(
        a,
        r.params.draftId as string,
        key(r),
        expected(r),
        r.body as S["ManualDraftInput"],
      ),
    "ManualDraftInput",
  );
  route(
    "POST",
    "/api/v1/me/manual-drafts/:draftId/submission",
    "EnvelopeManualReport",
    (a, r) =>
      manual.submitDraft(
        a,
        r.params.draftId as string,
        key(r),
        expected(r),
        r.body as S["ManualDraftSubmission"],
      ),
    "ManualDraftSubmission",
    201,
  );
  route(
    "GET",
    "/api/v1/me/manual-reports",
    "EnvelopeListManualReport",
    (a, r) => manual.listReports(a, r.query),
    undefined,
    200,
    true,
  );
  route(
    "POST",
    "/api/v1/manual-reports",
    "EnvelopeManualReport",
    (a, r) => manual.submitReport(a, key(r), r.body as S["ManualReportInput"]),
    "ManualReportInput",
    201,
  );
  route(
    "GET",
    "/api/v1/trips/:tripId/manual-reports",
    "EnvelopeListManualReport",
    (a, r) => manual.listReports(a, r.query, r.params.tripId),
    undefined,
    200,
    true,
  );
  route("GET", "/api/v1/manual-reports/:reportId", "EnvelopeManualReport", (a, r) =>
    manual.getReport(a, r.params.reportId as string),
  );
  for (const tripScope of [false, true]) {
    const url = tripScope
        ? "/api/v1/trips/:tripId/manual-revisions"
        : "/api/v1/manual-reports/:reportId/revisions",
      resource = (r: Request) => (tripScope ? r.params.tripId : r.params.reportId) as string;
    route(
      "GET",
      url,
      "EnvelopeListManualRevision",
      (a, r) => manual.revisions(a, resource(r), r.query, tripScope),
      undefined,
      200,
      true,
    );
    route("GET", `${url}/:revisionId`, "EnvelopeManualRevision", (a, r) =>
      manual.revisions(a, resource(r), {}, tripScope, r.params.revisionId),
    );
  }
  route(
    "POST",
    "/api/v1/manual-reports/:reportId/revisions",
    "EnvelopeManualReport",
    (a, r) =>
      manual.reviseReport(
        a,
        r.params.reportId as string,
        key(r),
        expected(r),
        r.body as S["ManualReportRevisionInput"],
      ),
    "ManualReportRevisionInput",
  );
  route(
    "POST",
    "/api/v1/manual-trips",
    "EnvelopeTripPrivate",
    (a, r) => manual.legacySubmit(a, key(r), r.body as S["ManualResolvedInput"]),
    "ManualResolvedInput",
    201,
  );
  route(
    "POST",
    "/api/v1/trips/:tripId/manual-revisions",
    "EnvelopeTripPrivate",
    (a, r) =>
      manual.legacySubmit(
        a,
        key(r),
        r.body as S["ManualResolvedInput"],
        r.params.tripId,
        expected(r),
      ),
    "ManualResolvedInput",
  );
  route(
    "POST",
    "/api/v1/trips/:tripId/correction-requests",
    "EnvelopeCommandResult",
    (a, r) =>
      manual.requestCorrection(
        a,
        r.params.tripId as string,
        key(r),
        expected(r),
        r.body as S["ReasonInput"],
      ),
    "ReasonInput",
    201,
  );
  route(
    "GET",
    "/api/v1/trips/:tripId/correction-requests",
    "EnvelopeListManualCorrectionRequest",
    (a, r) => manual.corrections(a, r.params.tripId as string, r.query),
    undefined,
    200,
    true,
  );
  route(
    "GET",
    "/api/v1/trips/:tripId/correction-requests/:requestId",
    "EnvelopeManualCorrectionRequest",
    (a, r) => manual.corrections(a, r.params.tripId as string, {}, r.params.requestId),
  );
  route("GET", "/api/v1/evidence/:evidenceId", "EnvelopeEvidence", (a, r) =>
    manual.metadata(a, r.params.evidenceId as string),
  );
  app.get<{ Params: { evidenceId: string } }>(
    "/api/v1/evidence/:evidenceId/content",
    { schema: { params: object({ evidenceId: id }, ["evidenceId"]), querystring: object({}) } },
    async (r, reply) => {
      const { stream, metadata } = await manual.content(await actor(r), r.params.evidenceId);
      reply.raw.once("close", () => stream.destroy());
      return reply
        .header("X-Content-Type-Options", "nosniff")
        .header(
          "Content-Disposition",
          `attachment; filename="evidence.${metadata.contentType === "image/png" ? "png" : "jpg"}"`,
        )
        .header("Content-Length", metadata.byteLength)
        .type(metadata.contentType)
        .send(stream);
    },
  );
  app.post(
    "/api/v1/evidence",
    {
      bodyLimit: maxBytes + 16384,
      schema: { querystring: object({}), response: { 202: ref("EnvelopeEvidence") } },
    },
    async (r, reply) => {
      if (!manual.config.storage) {
        reply.raw.once("finish", () => r.raw.destroy());
        throw manualError(503, "DEPENDENCY_UNAVAILABLE");
      }
      const abort = new AbortController(),
        cancel = () => abort.abort();
      let file: NodeJS.ReadableStream | undefined;
      let expired = false,
        uploadStarted = false;
      const timer = setTimeout(() => {
        expired = true;
        cancel();
        if (file && "destroy" in file) (file as import("node:stream").Readable).destroy();
        // A premature raw close rejects multipart's pending next(), even before
        // it has produced a file. Aborting the blob signal alone cannot do that.
        r.raw.destroy();
        r.raw.socket.destroy();
      }, manual.config.storage.timeoutMs);
      r.raw.once("aborted", cancel);
      try {
        const parts = r.parts(),
          first = await parts.next();
        if (first.done || first.value.type !== "file" || first.value.fieldname !== "file")
          throw manualError(422);
        const part = first.value;
        file = part.file;
        abort.signal.throwIfAborted();
        async function* chunks() {
          try {
            for await (const chunk of part.file) {
              if (oversized.has(r)) throw new BlobFailure("oversized");
              yield chunk as Buffer;
            }
            if (part.file.truncated || oversized.has(r)) throw new BlobFailure("oversized");
            if (!(await parts.next()).done) throw new BlobFailure("invalid");
          } catch (error) {
            if (error instanceof BlobFailure) throw error;
            throw new BlobFailure(
              error &&
                typeof error === "object" &&
                "statusCode" in error &&
                error.statusCode === 413
                ? "oversized"
                : "invalid",
            );
          }
        }
        const current = await actor(r);
        abort.signal.throwIfAborted();
        uploadStarted = true;
        const data = await manual.upload(
          current,
          key(r),
          part.filename,
          chunks(),
          part.mimetype,
          abort.signal,
        );
        return reply.code(202).send(envelope(r, data));
      } catch (error) {
        if (file && "destroy" in file) (file as import("node:stream").Readable).destroy();
        if (!r.raw.destroyed) reply.raw.once("finish", () => r.raw.destroy());
        if (oversized.has(r)) throw manualError(413);
        if (expired && !uploadStarted) throw manualError(503, "DEPENDENCY_UNAVAILABLE");
        if (error && typeof error === "object" && "statusCode" in error) throw error;
        throw manualError(422);
      } finally {
        clearTimeout(timer);
        r.raw.removeListener("aborted", cancel);
      }
    },
  );
}
