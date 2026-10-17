import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { join } from "node:path";
import fastifyStatic from "@fastify/static";
import { readinessSchema } from "@vtc/contracts";
import Fastify from "fastify";
import { installSchemaCompilers } from "./platform/http/schemas.js";

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
    reply.header("Cache-Control", "no-store");
  });
  app.setErrorHandler((error, request, reply) => {
    const httpError = typeof error === "object" && error !== null ? error : {};
    const errorStatus =
      "statusCode" in httpError && typeof httpError.statusCode === "number"
        ? httpError.statusCode
        : 500;
    const status =
      "validation" in httpError
        ? 422
        : [400, 403, 413, 415, 429].includes(errorStatus)
          ? errorStatus
          : 500;
    const code =
      status === 422
        ? "INVALID_PAYLOAD"
        : status === 413
          ? "PAYLOAD_TOO_LARGE"
          : status === 400
            ? "BAD_REQUEST"
            : status === 415
              ? "UNSUPPORTED_MEDIA_TYPE"
              : status === 429
                ? "RATE_LIMITED"
                : status === 403
                  ? "FORBIDDEN"
                  : "INTERNAL_ERROR";
    reply.code(status).send({
      error: { code, messageKey: `errors.${code.toLowerCase()}`, retryable: false },
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
    await access(join(options.webRoot, "index.html"));
    await app.register(fastifyStatic, { root: options.webRoot, index: false });
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
