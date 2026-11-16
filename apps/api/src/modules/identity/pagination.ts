import { createHmac, timingSafeEqual } from "node:crypto";
import { applicationId } from "@vtc/db";
import type { DirectorySort } from "./directory.js";
import { type Actor, identityError } from "./service.js";

export interface Page {
  limit?: number | undefined;
  cursor?: string | undefined;
}
export type CursorValue = string | number | null;
export interface DirectoryPosition {
  id: string;
  value: CursorValue;
}

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DECIMAL = /^(0|[1-9]\d*)(\.\d*[1-9])?$/;
const canonicalTimestamp = (value: unknown): value is string =>
  typeof value === "string" &&
  TIMESTAMP.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;

function validValue(sort: DirectorySort | undefined, value: unknown): value is CursorValue {
  switch (sort) {
    case undefined:
      return value === null;
    case "nickname":
      return typeof value === "string" && value.length >= 1 && value.length <= 128;
    case "trips30d":
      return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
    case "distance30d":
      return typeof value === "string" && value.length <= 64 && DECIMAL.test(value);
    case "lastTrip":
      return value === null || canonicalTimestamp(value);
  }
}

/**
 * Signed member directory cursors (v2). The body carries an HMAC digest of the binding (actor,
 * session, access epoch and normalized filters, sort and effective order), the last row's
 * keyset position and the page window end. Any mismatch or malformed value is 409.
 */
export function pagination(key: string) {
  const mac = (body: string) =>
    createHmac("sha256", key).update("identity/members/cursor/v2\0").update(body).digest();
  const bound = (binding: string) =>
    createHmac("sha256", key)
      .update("identity/members/cursor-binding/v2\0")
      .update(binding)
      .digest("base64url");

  return function page(
    actor: Actor,
    scope: unknown[],
    options: Page,
    shape: { sort: DirectorySort | undefined; windowed: boolean },
  ) {
    const limit = options.limit ?? 25;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw identityError(422);
    const binding = bound(
      JSON.stringify([actor.userId, actor.sessionId, actor.accessEpoch, ...scope]),
    );
    let after: DirectoryPosition | null = null;
    let windowEndsAt: string | null = null;

    if (options.cursor) {
      try {
        if (options.cursor.length > 2048) throw new Error();
        const [body = "", signature = "", extra] = options.cursor.split(".");
        const supplied = Buffer.from(signature, "base64url");
        const expected = mac(body);
        if (
          extra !== undefined ||
          !body ||
          Buffer.from(body, "base64url").toString("base64url") !== body ||
          supplied.toString("base64url") !== signature ||
          supplied.length !== expected.length ||
          !timingSafeEqual(supplied, expected)
        )
          throw new Error();
        const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as {
          b?: unknown;
          after?: { id?: unknown; v?: unknown } | null;
          w?: unknown;
        };
        if (payload.b !== binding || !payload.after || typeof payload.after.id !== "string")
          throw new Error();
        const id = applicationId(payload.after.id);
        if (!validValue(shape.sort, payload.after.v)) throw new Error();
        if (shape.windowed ? !canonicalTimestamp(payload.w) : payload.w !== null) throw new Error();
        after = { id, value: payload.after.v };
        windowEndsAt = shape.windowed ? (payload.w as string) : null;
      } catch {
        throw identityError(409, "VERSION_CONFLICT");
      }
    }

    return {
      after,
      limit,
      windowEndsAt,
      finish<T>(rows: T[], position: (row: T) => DirectoryPosition, window: string | null) {
        const items = rows.slice(0, limit);
        const last = items.at(-1);
        if (rows.length <= limit || !last) return { items, nextCursor: null };
        const { id, value } = position(last);
        const body = Buffer.from(
          JSON.stringify({ b: binding, after: { id, v: value }, w: window }),
        ).toString("base64url");
        return { items, nextCursor: `${body}.${mac(body).toString("base64url")}` };
      },
    };
  };
}
