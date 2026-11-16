import { createHmac, timingSafeEqual } from "node:crypto";
import { applicationId } from "@vtc/db";
import { type Actor, identityError } from "../identity/service.js";
import { canonicalJson } from "../sources/contracts/canonical.js";

export interface Page {
  limit?: number | undefined;
  cursor?: string | undefined;
}

export interface LeaderboardPosition {
  id: string;
  distance: string;
  trips: number;
}

const decimalPattern = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?$/;

/** Exact sign of a - b for decimal strings (any scale), without float conversion. */
export function compareDecimal(a: string, b: string): number {
  const left = decimalPattern.exec(a);
  const right = decimalPattern.exec(b);
  if (!left || !right) throw new Error("INVALID_DECIMAL");
  const scale = Math.max(left[3]?.length ?? 0, right[3]?.length ?? 0);
  const scaled = (match: RegExpExecArray) => {
    const value = BigInt(`${match[2]}${(match[3] ?? "").padEnd(scale, "0")}`);
    return match[1] ? -value : value;
  };
  const diff = scaled(left) - scaled(right);
  return diff === 0n ? 0 : diff > 0n ? 1 : -1;
}

/**
 * Keyset start: index of the first row strictly after `after` under the leaderboard order
 * (distance desc, trips desc, id asc), or rows.length. A row that changed or disappeared since
 * the previous page does not restart or repeat the list.
 */
export function afterIndex(
  rows: readonly LeaderboardPosition[],
  after: LeaderboardPosition,
): number {
  const index = rows.findIndex((row) => {
    const distance = compareDecimal(row.distance, after.distance);
    if (distance !== 0) return distance < 0;
    if (row.trips !== after.trips) return row.trips < after.trips;
    // Same byte order as the binary(36) owner_id tie-breaker in MySQL (ASCII IDs).
    return row.id > after.id;
  });
  return index < 0 ? rows.length : index;
}

export function pagination(key: string) {
  const sign = (body: string) =>
    createHmac("sha256", Buffer.from(key, "hex"))
      .update("analytics/cursor/v1\0")
      .update(body)
      .digest();

  return function page(actor: Actor, scope: unknown[], options: Page) {
    const limit = options.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw identityError(422);
    const binding = canonicalJson([actor.userId, actor.sessionId, actor.accessEpoch, ...scope]);
    let after: LeaderboardPosition | null = null;

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
          after: LeaderboardPosition;
        };
        applicationId(payload.after.id);
        if (
          typeof payload.after.distance !== "string" ||
          !decimalPattern.test(payload.after.distance) ||
          !Number.isSafeInteger(payload.after.trips) ||
          payload.after.trips < 0
        )
          throw new Error();
        if (payload.binding !== binding) throw new Error();
        after = payload.after;
      } catch {
        throw identityError(409, "VERSION_CONFLICT");
      }
    }

    return {
      after,
      limit,
      finish<T extends { member: { id: string }; actualDistanceM: string; acceptedTrips: number }>(
        rows: T[],
      ) {
        const items = rows.slice(0, limit);
        const last = items.at(-1);
        const body = Buffer.from(
          JSON.stringify({
            binding,
            after: last
              ? {
                  id: last.member.id,
                  distance: last.actualDistanceM,
                  trips: last.acceptedTrips,
                }
              : null,
          }),
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
