import type { companionComponents } from "@vtc/contracts";
import type { TxContext, UnitOfWork } from "@vtc/db";
import {
  and,
  eq,
  gt,
  isNull,
  lte,
  or,
  qualificationAssignments,
  qualificationLevels,
} from "@vtc/db/qualifications-schema";
import type { Catalogs } from "../catalogs/service.js";
import { compareDecimal, subtractDecimal } from "../sources/contracts/decimal.js";
import type { ContributionRegister } from "../trips/contributions.js";
import { conditionsMet } from "./check.js";
import { activeLevels, conditionsOf, type Game, levelTrailers, limitsOf } from "./ladder.js";

type S = companionComponents["schemas"];
/** Caller holds the authoritative company/member fence. This facade never promotes/rechecks. */
export function createCompanionQualifications(
  unit: UnitOfWork,
  contributions: ContributionRegister,
  catalogs?: Pick<Catalogs, "companionTrailerDisplayInTransaction">,
  now = () => new Date(),
) {
  const c = (tx: TxContext) => unit.client(tx);
  async function assignment(
    tx: TxContext,
    userId: string,
    game: Game,
    instant?: string,
  ): Promise<S["Assignment"] | null> {
    const rows = await c(tx)
      .select()
      .from(qualificationAssignments)
      .where(
        and(
          eq(qualificationAssignments.userId, userId),
          eq(qualificationAssignments.game, game),
          instant ? lte(qualificationAssignments.assignedAt, instant) : undefined,
          instant
            ? or(
                isNull(qualificationAssignments.endedAt),
                gt(qualificationAssignments.endedAt, instant),
              )
            : isNull(qualificationAssignments.endedAt),
        ),
      )
      .limit(2)
      .for("share");
    if (rows.length !== 1 || !rows[0]) return null;
    const current = rows[0];
    const [level] = await c(tx)
      .select()
      .from(qualificationLevels)
      .where(eq(qualificationLevels.id, current.levelId))
      .for("share");
    if (!level) return null;
    const trailers = await levelTrailers(unit, tx, [level.id]);
    const limits = limitsOf(level, trailers.get(level.id) ?? []);
    return {
      id: current.id,
      startedAt: current.assignedAt,
      level: { id: level.id, name: level.name, editVersion: level.version },
      limits: {
        ...limits,
        trailers: { mode: limits.trailers.mode, typeIds: [...limits.trailers.typeIds] },
        adr: { mode: limits.adr.mode, classes: [...limits.adr.classes] },
      },
      trailerDisplay:
        (await catalogs?.companionTrailerDisplayInTransaction(
          tx,
          game,
          limits.trailers.typeIds,
          now().toISOString(),
        )) ?? [],
    };
  }
  return {
    assignment,
    async current(tx: TxContext, ownerId: string, game: Game) {
      const current = await assignment(tx, ownerId, game);
      if (!current)
        return { state: "assignment_missing" as const, assignment: null, progress: null };
      const ladder = await activeLevels(unit, tx, game),
        level = ladder.find((row) => row.id === current.level.id);
      if (!level) return { state: "assignment_missing" as const, assignment: null, progress: null };
      const next = ladder[ladder.indexOf(level) + 1],
        conditions = conditionsOf(level),
        totals = await contributions.totals(tx, current.id, "share");
      const progress: S["Progress"] = {
        creditedTrips: totals.completedTrips,
        creditedDistanceM: totals.completedDistanceM,
        conditions,
        remainingTrips:
          conditions.requiredTrips === null
            ? null
            : Math.max(0, conditions.requiredTrips - totals.completedTrips),
        remainingDistanceM:
          conditions.requiredDistanceM === null
            ? null
            : compareDecimal(conditions.requiredDistanceM, totals.completedDistanceM) <= 0
              ? "0"
              : subtractDecimal(conditions.requiredDistanceM, totals.completedDistanceM),
        conditionsMet: conditionsMet(conditions, totals),
        nextLevel: next ? { id: next.id, name: next.name } : null,
        terminal: !next,
      };
      return { state: "assigned" as const, assignment: current, progress };
    },
  };
}
