import type { components } from "@vtc/contracts";
import type { TxContext, UnitOfWork } from "@vtc/db";
import {
  and,
  reconciliationCandidates as candidates,
  desc,
  reconciliationCandidateDismissals as dismissals,
  eq,
  lt,
  or,
} from "@vtc/db/reconciliation-schema";
import { count, isNotNull, isNull } from "drizzle-orm";
import type { Actor } from "../identity/service.js";
import type { Trips } from "../trips/service.js";
import type { Page, pagination } from "./cursor.js";

type S = components["schemas"];
export interface CandidatePage extends Page {
  game?: "ets2" | "ats";
  status?: "waiting" | "dismissed";
}

function tripSummary(trip: S["TripStage3ReviewQueueTrip"]): S["TripStage3DuplicateTrip"] {
  const {
    id,
    number,
    version,
    game,
    owner,
    outcome,
    decision,
    origin,
    destination,
    cargo,
    actualDistanceM,
    reportingAt,
    sourceKinds,
  } = trip;
  return {
    id,
    number,
    version,
    game,
    owner,
    outcome,
    decision,
    origin,
    destination,
    cargo,
    actualDistanceM,
    reportingAt,
    sourceKinds,
  };
}

export function createStage3Candidates(
  unit: UnitOfWork,
  trips: Trips,
  page: ReturnType<typeof pagination>,
  hash: Buffer,
) {
  function relation(tx: TxContext, viewerId: string, dismissed: boolean, game?: "ets2" | "ats") {
    const db = unit.client(tx);
    const primary = trips.reviewCandidateRootsInTransaction(tx, viewerId, "candidate_primary");
    const secondary = trips.reviewCandidateRootsInTransaction(tx, viewerId, "candidate_secondary");
    return db
      .select({
        id: candidates.id,
        game: candidates.game,
        createdAt: candidates.createdAt,
        primaryId: candidates.primaryTripId,
        secondaryId: candidates.secondaryTripId,
        reasons: candidates.reasons,
        dismissalVersion: dismissals.version,
      })
      .from(candidates)
      .innerJoin(
        primary,
        and(
          eq(primary.id, candidates.primaryTripId),
          eq(primary.version, candidates.primaryVersion),
          eq(primary.ownerId, candidates.ownerId),
          eq(primary.game, candidates.game),
        ),
      )
      .innerJoin(
        secondary,
        and(
          eq(secondary.id, candidates.secondaryTripId),
          eq(secondary.version, candidates.secondaryVersion),
          eq(secondary.ownerId, candidates.ownerId),
          eq(secondary.game, candidates.game),
        ),
      )
      .leftJoin(dismissals, eq(dismissals.candidateId, candidates.id))
      .where(
        and(
          eq(candidates.active, true),
          eq(candidates.ruleHash, hash),
          game ? eq(candidates.game, game) : undefined,
          dismissed
            ? and(isNotNull(dismissals.candidateId), isNull(dismissals.undoneAt))
            : or(isNull(dismissals.candidateId), isNotNull(dismissals.undoneAt)),
        ),
      )
      .as("current_review_candidates");
  }

  return {
    async countInTransaction(tx: TxContext, viewerId: string, game?: "ets2" | "ats") {
      const [totals] = await unit
        .client(tx)
        .select({ total: count() })
        .from(relation(tx, viewerId, false, game));
      return totals?.total ?? 0;
    },
    async list(
      tx: TxContext,
      actor: Actor & { locale: "en" | "ru" },
      options: CandidatePage,
    ): Promise<S["TripStage3DuplicateList"]> {
      const db = unit.client(tx);
      const status = options.status ?? "waiting";
      const paging = page(
        actor,
        ["stage3-candidates", hash.toString("hex"), options.game ?? null, status, actor.locale],
        options,
      );
      const eligible = relation(tx, actor.userId, status === "dismissed", options.game);
      const [totals] = await db.select({ total: count() }).from(eligible);
      const after = paging.after;
      const rows = await db
        .select()
        .from(eligible)
        .where(
          after?.time
            ? or(
                lt(eligible.createdAt, after.time),
                and(eq(eligible.createdAt, after.time), lt(eligible.id, after.id)),
              )
            : undefined,
        )
        .orderBy(desc(eligible.createdAt), desc(eligible.id))
        .limit(paging.limit + 1);
      const result = paging.finish(rows, (row) => ({ id: row.id, time: row.createdAt }));
      const summaries = await trips.reviewSummariesInTransaction(
        tx,
        result.items.flatMap((row) => [row.primaryId, row.secondaryId]),
        actor,
      );
      return {
        total: totals?.total ?? 0,
        nextCursor: result.nextCursor,
        items: result.items.map(
          ({ id, game, createdAt, primaryId, secondaryId, reasons, dismissalVersion }) => {
            const primary = summaries.get(primaryId),
              secondary = summaries.get(secondaryId);
            if (!primary || !secondary) throw new Error("REVIEW_CANDIDATE_TRIPS_MISSING");
            return {
              id,
              game,
              createdAt,
              version: dismissalVersion ?? 1,
              dismissed: status === "dismissed",
              reasonCodes: reasons,
              primaryTrip: tripSummary(primary.trip),
              secondaryTrip: tripSummary(secondary.trip),
            };
          },
        ),
      };
    },
  };
}
