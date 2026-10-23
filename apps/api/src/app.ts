import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { join, relative } from "node:path";
import fastifyStatic from "@fastify/static";
import { readinessSchema } from "@vtc/contracts";
import Fastify from "fastify";
import { registerAdmissionsRoutes } from "./modules/admissions/http.js";
import type { Admissions } from "./modules/admissions/service.js";
import { registerCatalogRoutes } from "./modules/catalogs/http.js";
import type { Catalogs } from "./modules/catalogs/service.js";
import { registerEventRoutes } from "./modules/events/http.js";
import type { Events } from "./modules/events/service.js";
import { registerExternalIdentityRoutes } from "./modules/external-identities/http.js";
import type { ExternalIdentities } from "./modules/external-identities/service.js";
import { registerIdentityRoutes } from "./modules/identity/http.js";
import type { Identity } from "./modules/identity/service.js";
import { registerManualRoutes } from "./modules/manual-reports/http.js";
import type { ManualReports } from "./modules/manual-reports/service.js";
import { registerMessagingRoutes } from "./modules/messaging/http.js";
import type { Messaging } from "./modules/messaging/service.js";
import { registerReconciliationRoutes } from "./modules/reconciliation/http.js";
import type { Reconciliation } from "./modules/reconciliation/service.js";
import { registerQualificationRoutes } from "./modules/qualifications/http.js";
import type { Qualifications } from "./modules/qualifications/service.js";
import { registerTelemetryRoutes } from "./modules/telemetry/http.js";
import type { TelemetryService } from "./modules/telemetry/service.js";
import { registerTripDecisionRoutes } from "./modules/trip-decisions/http.js";
import type { TripDecisions } from "./modules/trip-decisions/service.js";
import { registerTripRoutes } from "./modules/trips/http.js";
import type { Trips } from "./modules/trips/service.js";
import { ingressTrust } from "./platform/http/ingress.js";
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
  410: "EVIDENCE_EXPIRED",
  412: "PRECONDITION_FAILED",
  413: "PAYLOAD_TOO_LARGE",
  415: "UNSUPPORTED_MEDIA_TYPE",
  422: "INVALID_PAYLOAD",
  428: "PRECONDITION_REQUIRED",
  429: "RATE_LIMITED",
  503: "SERVICE_UNAVAILABLE",
};

export interface AppOptions {
  identity?: Identity;
  messaging?: Messaging;
  admissions?: Admissions;
  externalIdentities?: ExternalIdentities;
  catalogs?: Catalogs;
  trips?: Trips;
  telemetry?: TelemetryService;
  manualReports?: ManualReports;
  qualifications?: Qualifications;
  events?: Events;
  reconciliation?: Reconciliation;
  tripDecisions?: TripDecisions;
  checkReadiness: () => Promise<boolean>;
  closeDatabase?: () => Promise<void>;
  webRoot?: string;
  proxyAddress?: string;
}

export async function createApp(options: AppOptions) {
  if (options.manualReports) await options.manualReports.initialize(options.webRoot);
  const app = Fastify({
    logger: false,
    bodyLimit: 64 * 1024,
    genReqId: () => randomUUID(),
    trustProxy: ingressTrust(options.proxyAddress),
  });
  installSchemaCompilers(app);
  app.addHook("onSend", async (request, reply) => {
    if (!["/", "/en"].includes(request.url)) reply.header("X-Robots-Tag", "noindex, nofollow");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
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
    const suppliedCode = "publicCode" in httpError ? httpError.publicCode : undefined;
    const code =
      typeof suppliedCode === "string" &&
      [
        "SETUP_REQUIRED",
        "SECRET_ALREADY_ISSUED",
        "VERSION_CONFLICT",
        "IDEMPOTENCY_CONFLICT",
        "SELF_REVIEW_FORBIDDEN",
        "EVIDENCE_TRANSITION",
        "EVIDENCE_EXPIRED",
        "DEPENDENCY_UNAVAILABLE",
      ].includes(suppliedCode)
        ? suppliedCode
        : (errorCodes[status] ?? "INTERNAL_ERROR");
    if (status === 429) reply.header("Retry-After", "60");
    if (status === 503) reply.header("Retry-After", "1");
    if (status >= 500)
      console.error(JSON.stringify({ event: "request_failed", requestId: request.id, code }));
    reply.code(status).send({
      error: {
        code,
        messageKey: `errors.${code.toLowerCase()}`,
        retryable: status === 503,
        ...(code === "SECRET_ALREADY_ISSUED" &&
        "ownResourceId" in httpError &&
        typeof httpError.ownResourceId === "string"
          ? {
              details: [{ field: "idempotency-key", code, ownResourceId: httpError.ownResourceId }],
            }
          : {}),
      },
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
  if (options.identity) await registerIdentityRoutes(app, options.identity);
  if (options.identity && options.messaging)
    await registerMessagingRoutes(app, options.identity, options.messaging);
  if (options.identity && options.admissions)
    await registerAdmissionsRoutes(app, options.identity, options.admissions);
  if (options.identity && options.externalIdentities)
    await registerExternalIdentityRoutes(app, options.identity, options.externalIdentities);
  if (options.identity && options.catalogs)
    await app.register(async (scope) =>
      registerCatalogRoutes(scope, options.identity as Identity, options.catalogs as Catalogs),
    );
  if (options.identity && options.manualReports) {
    await app.register(async (scope) =>
      registerManualRoutes(
        scope,
        options.identity as Identity,
        options.manualReports as ManualReports,
      ),
    );
  }
  if (options.identity && options.trips)
    await registerTripRoutes(app, options.identity, options.trips);
  if (options.identity && options.telemetry)
    await registerTelemetryRoutes(app, options.identity, options.telemetry);
  if (options.identity && options.qualifications)
    await registerQualificationRoutes(app, options.identity, options.qualifications);
  if (options.identity && options.events)
    await registerEventRoutes(app, options.identity, options.events);
  if (options.identity && options.reconciliation)
    await app.register(async (scope) =>
      registerReconciliationRoutes(
        scope,
        options.identity as Identity,
        options.reconciliation as Reconciliation,
      ),
    );
  if (options.identity && options.tripDecisions)
    await app.register((scope) =>
      registerTripDecisionRoutes(
        scope,
        options.identity as Identity,
        options.tripDecisions as TripDecisions,
      ),
    );
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
    for (const [path, file] of [
      ["/", "public-ru.html"],
      ["/en", "public-en.html"],
    ] as const) {
      app.get(path, async (request, reply) => {
        // Query-bearing/token URLs use the nonindexable shell and never reflect input.
        const selected = request.url === path ? file : "index.html";
        return reply.type("text/html").sendFile(selected);
      });
    }
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
