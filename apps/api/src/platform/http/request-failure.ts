import { existsSync } from "node:fs";
import { METHODS } from "node:http";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyRequest } from "fastify";

const apiRoot = fileURLToPath(new URL("../../", import.meta.url));
const diagnosticCodes = new Set([
  "TRANSACTION_COMMIT_OUTCOME_UNKNOWN",
  "FST_ERR_FAILED_ERROR_SERIALIZATION",
  "FST_ERR_REP_INVALID_PAYLOAD_TYPE",
  "FST_ERR_HOOK_TIMEOUT",
  "FST_ERR_HANDLER_TIMEOUT",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EACCES",
  "ENOSPC",
  "EPIPE",
  "PROTOCOL_CONNECTION_LOST",
  "PROTOCOL_SEQUENCE_TIMEOUT",
  "ER_ACCESS_DENIED_ERROR",
  "ER_BAD_FIELD_ERROR",
  "ER_CON_COUNT_ERROR",
  "ER_DUP_ENTRY",
  "ER_LOCK_DEADLOCK",
  "ER_LOCK_WAIT_TIMEOUT",
  "ER_NO_SUCH_TABLE",
]);
const diagnosticMessages = new Set(["RESPONSE_SCHEMA_INVALID", "TRANSACTION_CONTROL_TIMEOUT"]);

function errorField(error: object, key: string): unknown {
  try {
    return Reflect.get(error, key);
  } catch {
    return undefined;
  }
}

function sourceLocation(error: object): string | null {
  const name = errorField(error, "name");
  const message = errorField(error, "message");
  const stack = errorField(error, "stack");
  if (typeof name !== "string" || typeof message !== "string" || typeof stack !== "string")
    return null;
  // Skip the whole message, including any lines that look like stack frames.
  const header = `${name && message ? `${name}: ` : name}${message}\n`;
  if (!stack.startsWith(header)) return null;
  const frames = stack.slice(Math.max(header.length, stack.length - 8192));
  for (const frame of frames.split("\n").slice(-16)) {
    const match =
      /^\s+at (?:.* \(|async )?((?:file:\/\/\/|[A-Za-z]:[\\/]|\/).+):(\d{1,8}):\d{1,8}\)?$/.exec(
        frame,
      );
    if (!match?.[1]) continue;
    try {
      const path = match[1].startsWith("file:") ? fileURLToPath(match[1]) : match[1];
      const file = relative(apiRoot, path).split(sep).join("/");
      if (
        !isAbsolute(file) &&
        /^(?:[\w-]+\/)*[\w.-]+\.[jt]s$/.test(file) &&
        !file.startsWith("node_modules/") &&
        existsSync(resolve(apiRoot, file))
      )
        return `${file}:${match[2]}`;
    } catch {
      // Ignore malformed or nonlocal frame paths.
    }
  }
  return null;
}

function failureDetails(error: unknown) {
  let current = error;
  let reason: string | undefined;
  let location: string | null = null;
  for (let depth = 0; depth < 6 && current !== null && typeof current === "object"; depth++) {
    location ??= sourceLocation(current);
    const code = errorField(current, "code");
    if (typeof code === "string" && diagnosticCodes.has(code)) return { reason: code, location };
    const message = errorField(current, "message");
    if (typeof message === "string" && diagnosticMessages.has(message))
      return { reason: message, location };
    const name = errorField(current, "name");
    if (
      name === "TypeError" ||
      name === "RangeError" ||
      name === "ReferenceError" ||
      name === "SyntaxError"
    )
      reason ??= name;
    current = errorField(current, "cause");
  }
  return { reason: reason ?? "UNCLASSIFIED_ERROR", location };
}

export function logRequestFailure(
  request: FastifyRequest,
  statusCode: number,
  code: string,
  error: unknown,
): void {
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      event: "request_failed",
      requestId: request.id,
      method: METHODS.includes(request.method) ? request.method : null,
      route: request.routeOptions.url ?? null,
      statusCode,
      code,
      ...failureDetails(error),
    }),
  );
}
