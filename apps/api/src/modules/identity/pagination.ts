import { createHmac, timingSafeEqual } from "node:crypto";
import { applicationId } from "@vtc/db";
import { type Actor, identityError } from "./service.js";

export interface Page {
  limit?: number | undefined;
  cursor?: string | undefined;
}

export function pagination(key: string) {
  const sign = (body: string) =>
    createHmac("sha256", key).update("identity/members/cursor/v1\0").update(body).digest();

  return function page(actor: Actor, scope: unknown[], options: Page) {
    const limit = options.limit ?? 25;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw identityError(422);
    const binding = JSON.stringify([actor.userId, actor.sessionId, actor.accessEpoch, ...scope]);
    let after: string | null = null;

    if (options.cursor) {
      try {
        if (options.cursor.length > 2048) throw new Error();
        const [body = "", mac = "", extra] = options.cursor.split(".");
        const supplied = Buffer.from(mac, "base64url");
        const expected = sign(body);
        if (
          extra !== undefined ||
          Buffer.from(body, "base64url").toString("base64url") !== body ||
          supplied.toString("base64url") !== mac ||
          supplied.length !== expected.length ||
          !timingSafeEqual(supplied, expected)
        ) {
          throw new Error();
        }
        const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as {
          binding: string;
          after: string | null;
        };
        if (payload.after !== null) {
          applicationId(payload.after);
        }
        if (payload.binding !== binding) throw new Error();
        after = payload.after;
      } catch {
        throw identityError(409, "VERSION_CONFLICT");
      }
    }

    return {
      after,
      limit,
      finish<T extends { id: string }>(rows: T[], position: (row: T) => string) {
        const items = rows.slice(0, limit);
        const last = items.at(-1);
        const body = Buffer.from(
          JSON.stringify({ binding, after: last ? position(last) : null }),
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
