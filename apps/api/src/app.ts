import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { join, relative } from "node:path";
import fastifyStatic from "@fastify/static";
import { readinessSchema } from "@vtc/contracts";
import Fastify from "fastify";
import { installSchemaCompilers } from "./platform/http/schemas.js";

const assetCache = "public, max-age=31536000, immutable";
const errorCodes: Readonly<Record<number, string>> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  405: "METHOD_NOT_ALLOWED",
  406: "NOT_ACCEPTABLE",
  409: "STATE_CONFLICT",
  412: "PRECONDITION_FAILED",
  413: "PAYLOAD_TOO_LARGE",
  415: "UNSUPPORTED_MEDIA_TYPE",
  422: "INVALID_PAYLOAD",
  428: "PRECONDITION_REQUIRED",
  429: "RATE_LIMITED",
  503: "SERVICE_UNAVAILABLE",
};

export interface AppOptions {
  checkReadiness: () => Promise<boolean>;
  closeDatabase?: () => Promise<void>;
  webRoot?: string;
}

export async function createApp(options: AppOptions) {
  const app = Fastify({
    logger: false,
    bodyLimit: 64 * 1024,
    genReqId: () => randomUUID(),
    trustProxy: false,
  });
  installSchemaCompilers(app);
  app.addHook("onSend", async (_request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    if (
      ![200, 206, 304].includes(reply.statusCode) ||
      reply.getHeader("cache-control") !== assetCache
    )
      reply.header("Cache-Control", "no-store");
  });
  app.setErrorHandler((error, request, reply) => {
    const httpError = typeof error === "object" && error !== null ? error : {};
    const errorStatus =
      "statusCode" in httpError && typeof httpError.statusCode === "number"
        ? httpError.statusCode
        : 500;
    const status =
      "validation" in httpError ? 422 : Object.hasOwn(errorCodes, errorStatus) ? errorStatus : 500;
    const code = errorCodes[status] ?? "INTERNAL_ERROR";
    if (status >= 500)
      console.error(JSON.stringify({ event: "request_failed", requestId: request.id, code }));
    reply.code(status).send({
      error: { code, messageKey: `errors.${code.toLowerCase()}`, retryable: status === 503 },
      meta: { requestId: request.id },
    });
  });
  app.get(
    "/health/live",
    {
      schema: {
        response: {
          200: {
            type: "object",
            properties: { status: { const: "ok", type: "string" } },
            required: ["status"],
            additionalProperties: false,
          },
        },
      },
    },
    async () => ({ status: "ok" }),
  );
  app.get(
    "/health/ready",
    {
      schema: { response: { 200: readinessSchema, 503: readinessSchema } },
    },
    async (_request, reply) => {
      const ready = await options.checkReadiness().catch(() => false);
      return reply.code(ready ? 200 : 503).send({ status: ready ? "ready" : "not_ready" });
    },
  );
  if (options.closeDatabase) app.addHook("onClose", options.closeDatabase);
  if (options.webRoot) {
    const webRoot = options.webRoot;
    await access(join(webRoot, "index.html"));
    await app.register(fastifyStatic, {
      root: webRoot,
      index: false,
      setHeaders(response, filePath) {
        const path = relative(webRoot, filePath).replaceAll("\\", "/");
        if (/^assets\/[^/]+-[\w-]{8,}\.(js|css)$/.test(path))
          response.header("Cache-Control", assetCache);
      },
    });
    app.get("/", async (_request, reply) => reply.type("text/html").sendFile("index.html"));
  }
  app.setNotFoundHandler((request, reply) => {
    let path = request.url.split("?")[0] ?? "/";
    try {
      path = decodeURIComponent(path);
    } catch {
      path = "/api/invalid-path";
    }
    const reserved = ["/api", "/health", "/evidence", "/uploads"].some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    );
    if (
      options.webRoot &&
      request.method === "GET" &&
      !reserved &&
      !path.split("/").at(-1)?.includes(".") &&
      request.headers.accept?.includes("text/html")
    ) {
      return reply.type("text/html").sendFile("index.html");
    }
    return reply.code(404).send({
      error: { code: "NOT_FOUND", messageKey: "errors.not_found", retryable: false },
      meta: { requestId: request.id },
    });
  });
  return app;
}
