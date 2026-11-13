import type { TxContext, UnitOfWork } from "@vtc/db";
import {
  and,
  eq,
  gt,
  inArray,
  isNull,
  ne,
  sql,
  tripReviewReasons,
  trips,
} from "@vtc/db/trips-schema";
import { exists, isNotNull, type SQL } from "drizzle-orm";
import type { TripState } from "./groups.js";
import { type TripSource, tripSourceCondition } from "./list-query.js";

export interface ReviewFilters {
  game?: "ets2" | "ats";
  ownerId?: string;
  source?: TripSource;
  reasonCode?: string;
}

export function reviewRoots(
  client: ReturnType<UnitOfWork["client"]>,
  viewerId: string,
  waiting: boolean,
  filters: ReviewFilters = {},
): SQL | undefined {
  return and(
    isNull(trips.aliasOf),
    ne(trips.ownerId, viewerId),
    eq(trips.reviewHold, waiting),
    waiting ? isNotNull(trips.queuedAt) : undefined,
    filters.game ? eq(trips.game, filters.game) : undefined,
    filters.ownerId ? eq(trips.ownerId, filters.ownerId) : undefined,
    filters.source ? tripSourceCondition(client, filters.source) : undefined,
    waiting && filters.reasonCode
      ? /^[ -~]{1,128}$/.test(filters.reasonCode)
        ? exists(
            client
              .select({ tripId: tripReviewReasons.tripId })
              .from(tripReviewReasons)
              .where(
                and(
                  eq(tripReviewReasons.tripId, trips.id),
                  eq(tripReviewReasons.code, filters.reasonCode),
                  sql`CAST(${tripReviewReasons.code} AS BINARY) = CAST(${filters.reasonCode} AS BINARY)`,
                ),
              ),
          )
        : sql`FALSE`
      : undefined,
  );
}

// Call with the original trip locked, including when it is about to become an alias.
export function queueClock(
  row: TripState,
  patch: Partial<Pick<TripState, "aliasOf" | "reviewHold">>,
  at: string,
): Pick<TripState, "queuedAt"> {
  const aliasOf = patch.aliasOf === undefined ? row.aliasOf : patch.aliasOf;
  const held = patch.reviewHold ?? row.reviewHold;
  return {
    queuedAt:
      aliasOf || !held
        ? null
        : row.reviewHold && !row.aliasOf
          ? (row.queuedAt ?? row.createdAt)
          : at,
  };
}

function indexedReasons(row: Pick<TripState, "aliasOf" | "reviewHold" | "reviewReasons">) {
  if (row.aliasOf || !row.reviewHold) return [];
  const reasons = [...new Set(row.reviewReasons)].sort();
  if (reasons.some((code) => !/^[ -~]{1,128}$/.test(code) || code !== code.trim()))
    throw new Error("TRIP_REVIEW_REASON_INVALID");
  return reasons;
}

export function createReviewQueueRepair(unit: UnitOfWork) {
  return {
    async page(tx: TxContext, after: string | undefined, limit: number) {
      return unit
        .client(tx)
        .select({ id: trips.id, ownerId: trips.ownerId, game: trips.game })
        .from(trips)
        .where(after ? gt(trips.id, after) : undefined)
        .orderBy(trips.id)
        .limit(limit);
    },
    async apply(
      tx: TxContext,
      id: string,
      verify: boolean,
      proveHistoricalStart: (row: TripState) => Promise<string | null>,
    ) {
      const db = unit.client(tx);
      const [row] = await db.select().from(trips).where(eq(trips.id, id)).for("update");
      if (!row) throw new Error("TRIP_REVIEW_REPAIR_ROW_MISSING");
      const held = row.reviewHold && !row.aliasOf;
      let expected = held ? (row.queuedAt ?? row.createdAt) : null;
      if (held && (row.queuedAt === null || row.queuedAt === row.createdAt))
        expected = (await proveHistoricalStart(row)) ?? row.createdAt;

      if (verify) {
        const saved = await db
          .select({ code: tripReviewReasons.code })
          .from(tripReviewReasons)
          .where(eq(tripReviewReasons.tripId, id))
          .orderBy(tripReviewReasons.code)
          .for("share");
        const wanted = indexedReasons(row);
        return (
          row.queuedAt !== expected ||
          saved.length !== wanted.length ||
          saved.some(({ code }, i) => code !== wanted[i])
        );
      }

      if (row.queuedAt !== expected)
        await db.update(trips).set({ queuedAt: expected }).where(eq(trips.id, id));
      await syncReviewReasons(db, row);
      return false;
    },
  };
}

export async function syncReviewReasons(
  db: ReturnType<UnitOfWork["client"]>,
  row: Pick<TripState, "id" | "aliasOf" | "reviewHold" | "reviewReasons">,
) {
  const wanted = indexedReasons(row);
  const saved = await db
    .select({ code: tripReviewReasons.code })
    .from(tripReviewReasons)
    .where(eq(tripReviewReasons.tripId, row.id))
    .for("update");
  const obsolete = saved.map(({ code }) => code).filter((code) => !wanted.includes(code));
  const missing = wanted.filter((code) => !saved.some((existing) => existing.code === code));
  if (obsolete.length)
    await db
      .delete(tripReviewReasons)
      .where(and(eq(tripReviewReasons.tripId, row.id), inArray(tripReviewReasons.code, obsolete)));
  if (missing.length)
    await db.insert(tripReviewReasons).values(missing.map((code) => ({ tripId: row.id, code })));
}
