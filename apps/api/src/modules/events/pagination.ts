import { createHmac, timingSafeEqual } from "node:crypto";
import { applicationId, utcDateTime } from "@vtc/db";
import { type Actor, identityError } from "../identity/service.js";
import { canonicalJson } from "../sources/contracts/canonical.js";
export interface Page {
  limit?: number;
  cursor?: string;
}
export function pagination(key: string, now: () => Date) {
  const sign = (body: string) =>
    createHmac("sha256", Buffer.from(key, "hex"))
      .update("events/cursor/v1\0")
      .update(body)
      .digest();
  return (actor: Actor | null, scope: unknown[], options: Page) => {
    const limit = options.limit ?? 25;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw identityError(422);
    const binding = canonicalJson([
      actor?.userId ?? null,
      actor?.sessionId ?? null,
      actor?.accessEpoch ?? null,
      ...scope,
    ]);
    let boundary = now().toISOString(),
      after: { id: string; time: string | null } | null = null;
    if (options.cursor)
      try {
        if (options.cursor.length > 2048) throw new Error();
        const [body = "", mac = "", extra] = options.cursor.split(".");
        const supplied = Buffer.from(mac, "base64url"),
          expected = sign(body);
        if (
          extra !== undefined ||
          Buffer.from(body, "base64url").toString("base64url") !== body ||
          supplied.toString("base64url") !== mac ||
          supplied.length !== expected.length ||
          !timingSafeEqual(supplied, expected)
        )
          throw new Error();
        const p = JSON.parse(Buffer.from(body, "base64url").toString());
        if (p.binding !== binding) throw new Error();
        applicationId(p.after.id);
        if (p.after.time !== null) utcDateTime(p.after.time);
        utcDateTime(p.boundary);
        after = p.after;
        boundary = p.boundary;
      } catch {
        throw identityError(409, "VERSION_CONFLICT");
      }
    return {
      limit,
      after,
      boundary,
      finish<T>(rows: T[], position: (row: T) => { id: string; time: string | null }) {
        const items = rows.slice(0, limit),
          last = items.at(-1);
        const body = Buffer.from(
          JSON.stringify({ binding, boundary, after: last ? position(last) : null }),
        ).toString("base64url");
        return {
          items,
          nextCursor:
            rows.length > limit && last ? `${body}.${sign(body).toString("base64url")}` : null,
        };
      },
    };
  };
}
