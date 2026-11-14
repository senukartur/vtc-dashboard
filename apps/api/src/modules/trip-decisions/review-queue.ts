import type { components } from "@vtc/contracts";
import { applicationId, type TxContext, type UnitOfWork } from "@vtc/db";
import { and, desc, eq, lt, or, sql, tripDecisions } from "@vtc/db/trip-decisions-schema";
import { asc, count, gt, isNotNull, notExists } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import type { Actor, Identity } from "../identity/service.js";
import { identityError } from "../identity/service.js";
import type { Reconciliation } from "../reconciliation/service.js";
import type { ReviewFilters } from "../trips/review-queue.js";
import type { Trips } from "../trips/service.js";
import type { Page, pagination } from "./pagination.js";

type S = components["schemas"];

export interface ReviewPage extends ReviewFilters, Page {
  status?: "waiting" | "resolved";
  locale?: "en" | "ru";
  order?: "asc" | "desc";
}

const newer = alias(tripDecisions, "newer_trip_decision");

export function createReviewQueue(
  unit: UnitOfWork,
  ports: {
    identity: Identity;
    trips: Trips;
    reconciliation?: Pick<Reconciliation, "stage3DuplicateCountInTransaction">;
  },
  signPage: ReturnType<typeof pagination>,
  now: () => Date,
) {
  async function summaryInTransaction(
    tx: TxContext,
    viewerId: string,
    computedAt: string,
    game?: "ets2" | "ats",
  ): Promise<S["TripStage3ReviewSummary"]> {
    const { waitingCount, oldestQueuedAt } = await ports.trips.waitingReviewTotalsInTransaction(
      tx,
      viewerId,
      game,
    );
    const duplicateCount =
      (await ports.reconciliation?.stage3DuplicateCountInTransaction(tx, viewerId, game)) ?? 0;
    return {
      computedAt,
      waitingCount,
      oldestQueuedAt,
      oldestAgeSeconds:
        oldestQueuedAt === null
          ? null
          : Math.max(0, Math.floor((Date.parse(computedAt) - Date.parse(oldestQueuedAt)) / 1000)),
      duplicateCount,
    };
  }

  return {
    summaryInTransaction,
    summary(actor: Actor, game?: "ets2" | "ats") {
      return ports.identity.transaction(async (tx) => {
        const current = await ports.identity.authorizeInTransaction(tx, actor, "trips.review");
        return summaryInTransaction(tx, current.userId, now().toISOString(), game);
      });
    },
    list(actor: Actor, options: ReviewPage): Promise<S["TripStage3ReviewList"]> {
      return ports.identity.transaction(async (tx) => {
        const db = unit.client(tx);
        const current = await ports.identity.authorizeInTransaction(tx, actor, "trips.review");
        const status = options.status ?? "waiting";
        const order = options.order ?? (status === "waiting" ? "asc" : "desc");
        if (status === "resolved" && order !== "desc") throw identityError(422);
        const { game, source, reasonCode } = options;
        const ownerId = options.ownerId ? applicationId(options.ownerId) : undefined;
        const locale = options.locale ?? current.locale;
        const reviewer = { ...current, locale };
        const filters = {
          game: game ?? null,
          source: source ?? null,
          reasonCode: reasonCode ?? null,
          ownerId: ownerId ?? null,
        };
        const paging = signPage(
          current,
          ["stage3-trip-review", status, order, locale, filters],
          options,
        );
        const roots = ports.trips
          .reviewRootsInTransaction(tx, current.userId, status === "waiting", options)
          .as("review_roots");
        const waiting = db
          .select({
            id: roots.id,
            at: roots.queuedAt,
            reasonCodes: roots.reasonCodes,
            outcome: sql<null>`NULL`.as("outcome"),
          })
          .from(roots);
        const resolved = db
          .select({
            id: roots.id,
            at: tripDecisions.decidedAt,
            reasonCodes: tripDecisions.reasonCodes,
            outcome: tripDecisions.outcome,
          })
          .from(roots)
          .innerJoin(tripDecisions, eq(tripDecisions.tripId, roots.id))
          .where(
            and(
              eq(tripDecisions.outcome, roots.decision),
              or(eq(tripDecisions.outcome, "accepted"), isNotNull(tripDecisions.actorId)),
              notExists(
                db
                  .select({ id: newer.id })
                  .from(newer)
                  .where(
                    and(
                      eq(newer.tripId, tripDecisions.tripId),
                      gt(newer.sequence, tripDecisions.sequence),
                    ),
                  ),
              ),
              reasonCode
                ? sql`JSON_CONTAINS(${tripDecisions.reasonCodes}, JSON_QUOTE(${reasonCode}))`
                : undefined,
            ),
          );
        const eligible = (status === "waiting" ? waiting : resolved).as("eligible_review");
        const [totals] = await db.select({ total: count() }).from(eligible);
        const after = paging.after;
        const beyond = order === "asc" ? gt : lt;
        const sort = order === "asc" ? asc : desc;
        const rows = await db
          .select()
          .from(eligible)
          .where(
            after?.time
              ? or(
                  beyond(eligible.at, after.time),
                  and(eq(eligible.at, after.time), beyond(eligible.id, after.id)),
                )
              : undefined,
          )
          .orderBy(sort(eligible.at), sort(eligible.id))
          .limit(paging.limit + 1);
        const result = paging.finish(rows, (r) => ({ id: r.id, time: r.at }));
        const summaries = await ports.trips.reviewSummariesInTransaction(
          tx,
          result.items.map((r) => r.id),
          reviewer,
        );
        const items = result.items.map(
          ({ id, at, reasonCodes, outcome }): S["TripStage3ReviewItem"] => {
            const summary = summaries.get(id);
            if (!summary || !at) throw new Error("TRIP_REVIEW_ROW_INVALID");
            if (status === "waiting")
              return { state: "waiting", ...summary, queuedAt: at, reasonCodes };
            if (!outcome) throw new Error("TRIP_REVIEW_DECISION_INVALID");
            return { state: "resolved", trip: summary.trip, decidedAt: at, reasonCodes, outcome };
          },
        );
        return { items, nextCursor: result.nextCursor, total: totals?.total ?? 0 };
      });
    },
  };
}
