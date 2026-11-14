import type { components } from "@vtc/contracts";
import type { TxContext, UnitOfWork } from "@vtc/db";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  qualificationAssignments,
  qualificationLevels,
  qualificationRules,
  qualificationStates,
  sql,
} from "@vtc/db/qualifications-schema";
import type { Identity } from "../identity/service.js";
import type { QualificationProgressTotals } from "../qualification-rules/contracts.js";
import { canonicalDecimal } from "../qualification-rules/decimal.js";
import { evaluateQualificationProgress } from "../qualification-rules/index.js";
import { type ContributionRegister, emptyTotals } from "../trips/contributions.js";
import type { Game } from "./initialization.js";
import { activeLevels, type ActiveLevel } from "./ladder.js";
import type { Position } from "./pagination.js";

type S = components["schemas"];
type Level = typeof qualificationLevels.$inferSelect;
type Threshold = Pick<
  typeof qualificationRules.$inferSelect,
  "requiredTrips" | "requiredDistanceM"
>;
type Rule = Threshold & { effectiveAt: string };
type Assignment = {
  id: string;
  userId: string;
  levelId: string;
  assignedAt: string;
  version: number;
  eligibleSince: string | null;
  eligibilityEvaluatedAt: string | null;
};

export function successor(levels: readonly Level[], game: Game, levelId: string) {
  const level = levels.find((row) => row.game === game && row.id === levelId);
  if (level?.activePosition == null) return null;
  const position = level.activePosition + 1;
  return levels.find((row) => row.game === game && row.activePosition === position) ?? null;
}

export const levelSummary = ({ id, name }: Pick<Level, "id" | "name">) => ({ id, name });

export function promotionEligible(
  hasNextLevel: boolean,
  rule: Threshold | undefined,
  totals: QualificationProgressTotals,
) {
  return hasNextLevel && !!rule && evaluateQualificationProgress(rule, totals).eligibleForPromotion;
}

function transition(
  before: { eligible: boolean; since: string | null },
  eligible: boolean,
  instant: string,
) {
  return { eligible, since: eligible ? (before.eligible ? before.since : instant) : null };
}

function trackingStart(row: Assignment, cutoff: string, instant: string) {
  const checkpoint = row.eligibilityEvaluatedAt;
  const valid = checkpoint !== null && checkpoint >= cutoff && checkpoint >= row.assignedAt;
  if (valid && checkpoint > instant) throw new Error("ELIGIBILITY_CLOCK_REGRESSION");
  return {
    start: valid ? checkpoint : row.assignedAt >= cutoff ? row.assignedAt : cutoff,
    since: valid ? row.eligibleSince : row.assignedAt >= cutoff ? row.assignedAt : null,
  };
}

export function createEligibility(
  unit: UnitOfWork,
  contributions: Pick<ContributionRegister, "totalsByAssignment">,
  identity: Pick<Identity, "memberSummariesInTransaction">,
  cutoff: string | undefined,
) {
  const c = (tx: TxContext) => unit.client(tx);
  const tracking = (instant: string) => {
    if (cutoff !== undefined && instant < cutoff) throw new Error("ELIGIBILITY_CLOCK_REGRESSION");
    return cutoff !== undefined;
  };
  const batchSize = 100;

  const levels = (tx: TxContext, game: Game) => activeLevels(unit, tx, game);

  async function currentAssignments(
    tx: TxContext,
    game: Game,
    instant: string,
    filters: { after?: string; levelId?: string; userIds?: string[] },
    includeOnset = true,
  ): Promise<Assignment[]> {
    const trackingFields =
      includeOnset && cutoff !== undefined
        ? {
            eligibleSince: qualificationStates.eligibleSince,
            eligibilityEvaluatedAt: qualificationStates.eligibilityEvaluatedAt,
          }
        : {
            eligibleSince: sql<null>`NULL`,
            eligibilityEvaluatedAt: sql<null>`NULL`,
          };
    return c(tx)
      .select({
        id: qualificationAssignments.id,
        userId: qualificationStates.userId,
        levelId: qualificationAssignments.levelId,
        assignedAt: qualificationAssignments.assignedAt,
        version: qualificationStates.version,
        ...trackingFields,
      })
      .from(qualificationStates)
      .innerJoin(
        qualificationAssignments,
        and(
          eq(qualificationAssignments.id, qualificationStates.assignmentId),
          eq(qualificationAssignments.userId, qualificationStates.userId),
          eq(qualificationAssignments.game, qualificationStates.game),
        ),
      )
      .where(
        and(
          eq(qualificationStates.game, game),
          isNull(qualificationAssignments.endedAt),
          lte(qualificationAssignments.assignedAt, instant),
          filters.after ? gt(qualificationStates.userId, filters.after) : undefined,
          filters.levelId ? eq(qualificationAssignments.levelId, filters.levelId) : undefined,
          filters.userIds ? inArray(qualificationStates.userId, filters.userIds) : undefined,
        ),
      )
      .orderBy(asc(qualificationStates.userId))
      .limit(batchSize)
      .for("share");
  }

  async function* activeAssignments(
    tx: TxContext,
    game: Game,
    instant: string,
    options: { levelId?: string; includeOnset?: boolean } = {},
  ) {
    let after: string | undefined;
    for (;;) {
      const rows = await currentAssignments(
        tx,
        game,
        instant,
        {
          ...(after === undefined ? {} : { after }),
          ...(options.levelId === undefined ? {} : { levelId: options.levelId }),
        },
        options.includeOnset,
      );
      if (rows.length === 0) return;
      const members = await identity.memberSummariesInTransaction(
        tx,
        rows.map(({ userId }) => userId),
      );
      yield rows.flatMap((row) => {
        const member = members.get(row.userId);
        return member && !member.formerMember ? [{ ...row, member }] : [];
      });
      after = rows.at(-1)?.userId;
      if (rows.length < batchSize) return;
    }
  }

  async function readRules(tx: TxContext, level: Level, instant: string, oldest: string) {
    const applicable = and(
      eq(qualificationRules.levelId, level.id),
      eq(qualificationRules.promotionGeneration, level.promotionGeneration),
    );
    const fields = {
      effectiveAt: qualificationRules.effectiveAt,
      requiredTrips: qualificationRules.requiredTrips,
      requiredDistanceM: qualificationRules.requiredDistanceM,
    };
    const [first] = await c(tx)
      .select(fields)
      .from(qualificationRules)
      .where(and(applicable, lte(qualificationRules.effectiveAt, oldest)))
      .orderBy(desc(qualificationRules.effectiveAt))
      .limit(1)
      .for("share");
    if (oldest === instant) return first ? [first] : [];
    const result = first ? [first] : [];
    let after = oldest;
    for (;;) {
      const rows = await c(tx)
        .select(fields)
        .from(qualificationRules)
        .where(
          and(
            applicable,
            gt(qualificationRules.effectiveAt, after),
            lte(qualificationRules.effectiveAt, instant),
          ),
        )
        .orderBy(asc(qualificationRules.effectiveAt))
        .limit(batchSize)
        .for("share");
      result.push(...rows);
      const last = rows.at(-1);
      if (rows.length < batchSize || !last) return result;
      after = last.effectiveAt;
    }
  }

  async function evaluate<T extends Assignment>(
    tx: TxContext,
    game: Game,
    rows: T[],
    gameLevels: Level[],
    instant: string,
    includeOnset: boolean,
  ) {
    const histories = new Map<string, Rule[]>();
    const byId = new Map(gameLevels.map((level) => [level.id, level]));
    const oldest = new Map<string, string>();
    const epoch = includeOnset && tracking(instant) ? cutoff : undefined;
    for (const row of rows) {
      const start = epoch ? trackingStart(row, epoch, instant).start : instant;
      const previous = oldest.get(row.levelId);
      if (previous === undefined || start < previous) oldest.set(row.levelId, start);
    }
    for (const [levelId, start] of oldest) {
      const current = byId.get(levelId);
      if (!current) throw new Error("QUALIFICATION_LEVEL_MISSING");
      if (successor(gameLevels, game, levelId))
        histories.set(levelId, await readRules(tx, current, instant, start));
    }
    const totals = await contributions.totalsByAssignment(
      tx,
      rows.map(({ id }) => id),
      "share",
    );
    return rows.map((row) => {
      const current = byId.get(row.levelId);
      if (!current) throw new Error("QUALIFICATION_LEVEL_MISSING");
      const next = successor(gameLevels, game, row.levelId);
      const total = totals.get(row.id) ?? emptyTotals;
      const rules = histories.get(row.levelId) ?? [];
      const rule = rules.at(-1);
      let eligible = promotionEligible(next !== null, rule, total);
      let since: string | null = null;
      if (epoch && next) {
        const { start, since: baseline } = trackingStart(row, epoch, instant);
        let condition = {
          eligible: promotionEligible(
            true,
            rules.findLast((version) => version.effectiveAt <= start),
            total,
          ),
          since: baseline,
        };
        if (!condition.eligible) condition.since = null;
        for (const version of rules) {
          if (version.effectiveAt > start)
            condition = transition(
              condition,
              promotionEligible(true, version, total),
              version.effectiveAt,
            );
        }
        ({ eligible, since } = condition);
      }
      return { row, current, next, rule, total, eligible, since };
    });
  }

  async function save(
    tx: TxContext,
    game: Game,
    row: Assignment,
    since: string | null,
    instant: string,
  ) {
    await c(tx)
      .update(qualificationStates)
      .set({ eligibleSince: since, eligibilityEvaluatedAt: instant })
      .where(
        and(
          eq(qualificationStates.userId, row.userId),
          eq(qualificationStates.game, game),
          eq(qualificationStates.assignmentId, row.id),
        ),
      );
  }

  async function prepareContributionBatch(
    tx: TxContext,
    owners: readonly { ownerId: string; game: Game }[],
    instant: string,
  ) {
    const before: { game: Game; evaluations: Awaited<ReturnType<typeof evaluate<Assignment>>> }[] =
      [];
    if (tracking(instant)) {
      for (const game of ["ats", "ets2"] as const) {
        const userIds = [
          ...new Set(owners.filter((owner) => owner.game === game).map((owner) => owner.ownerId)),
        ];
        if (!userIds.length) continue;
        const gameLevels = await levels(tx, game);
        const rows = await currentAssignments(tx, game, instant, { userIds });
        before.push({
          game,
          evaluations: await evaluate(
            tx,
            game,
            rows.filter((row) => successor(gameLevels, game, row.levelId)),
            gameLevels,
            instant,
            true,
          ),
        });
      }
    }
    return async (affected: ReadonlySet<string>) => {
      for (const { game, evaluations } of before) {
        const changed = evaluations.filter(({ row }) => affected.has(row.id));
        const totals = await contributions.totalsByAssignment(
          tx,
          changed.map(({ row }) => row.id),
          "share",
        );
        for (const { row, rule, eligible, since } of changed) {
          const final = promotionEligible(true, rule, totals.get(row.id) ?? emptyTotals);
          await save(tx, game, row, transition({ eligible, since }, final, instant).since, instant);
        }
      }
    };
  }

  return {
    levels,
    prepareContributionBatch,
    async applyTopology(
      tx: TxContext,
      game: Game,
      changedLevels: readonly ActiveLevel[],
      gameLevels: readonly ActiveLevel[],
      instant: string,
    ) {
      if (cutoff === undefined || !tracking(instant)) return;
      for (const level of changedLevels) {
        const next = successor(gameLevels, game, level.id);
        const rule = next ? (await readRules(tx, level, instant, instant))[0] : undefined;

        for await (const rows of activeAssignments(tx, game, instant, { levelId: level.id })) {
          const totals = rule
            ? await contributions.totalsByAssignment(
                tx,
                rows.map(({ id }) => id),
                "share",
              )
            : new Map<string, QualificationProgressTotals>();
          for (const row of rows) {
            trackingStart(row, cutoff, instant);
            const eligible = promotionEligible(
              next !== null,
              rule,
              totals.get(row.id) ?? emptyTotals,
            );
            // The previous successor does not establish onset for this edge.
            await save(tx, game, row, eligible ? instant : null, instant);
          }
        }
      }
    },
    async applyImmediateRule(tx: TxContext, level: Level, instant: string, rule: Threshold) {
      if (!tracking(instant)) return;
      const gameLevels = await levels(tx, level.game);
      if (!successor(gameLevels, level.game, level.id)) return;
      // Evaluate with old rules before INSERT, including an earlier operation in the same millisecond.
      for await (const rows of activeAssignments(tx, level.game, instant, { levelId: level.id })) {
        for (const { row, total, eligible, since } of await evaluate(
          tx,
          level.game,
          rows,
          gameLevels,
          instant,
          true,
        )) {
          const final = promotionEligible(true, rule, total);
          await save(
            tx,
            level.game,
            row,
            transition({ eligible, since }, final, instant).since,
            instant,
          );
        }
      }
    },
    async candidates(
      tx: TxContext,
      game: Game,
      status: "all" | "eligible",
      instant: string,
      after: Position | null,
      limit: number,
      gameLevels: ActiveLevel[],
    ) {
      let total = 0;
      let page: (S["QualificationStage3PromotionCandidate"] & { id: string })[] = [];
      for await (const rows of activeAssignments(tx, game, instant)) {
        const candidates = await evaluate(tx, game, rows, gameLevels, instant, true);
        for (const item of candidates) {
          if (status === "eligible" && !item.eligible) continue;
          total++;
          const { row, since, rule, current, next } = item;
          if (after && compareCandidates({ id: row.userId, time: since }, after) <= 0) continue;
          page.push({
            id: row.userId,
            member: row.member,
            game,
            assignmentId: row.id,
            version: row.version,
            currentLevel: levelSummary(current),
            nextLevel: next ? levelSummary(next) : null,
            acceptedTrips: item.total.completedTrips,
            actualDistanceM: item.total.completedDistanceM,
            requiredTrips: rule?.requiredTrips ?? null,
            requiredDistanceM:
              rule?.requiredDistanceM == null ? null : canonicalDecimal(rule.requiredDistanceM),
            eligible: item.eligible,
            eligibleSince: since,
          });
        }
        page.sort((a, b) =>
          compareCandidates(
            { id: a.id, time: a.eligibleSince },
            { id: b.id, time: b.eligibleSince },
          ),
        );
        page = page.slice(0, limit + 1);
      }
      return { total, rows: page };
    },
    async ready(tx: TxContext, computedAt: string) {
      const counts = { ets2: 0, ats: 0 };
      for (const game of ["ets2", "ats"] as const) {
        const gameLevels = await levels(tx, game);
        for await (const rows of activeAssignments(tx, game, computedAt, { includeOnset: false })) {
          const promotable = rows.filter((row) => successor(gameLevels, game, row.levelId));
          const evaluations = await evaluate(tx, game, promotable, gameLevels, computedAt, false);
          counts[game] += evaluations.filter((item) => item.eligible).length;
        }
      }
      return counts;
    },
  };
}

function compareCandidates(a: Position, b: Position) {
  if (a.time !== b.time) {
    if (a.time === null) return 1;
    if (b.time === null) return -1;
    return a.time > b.time ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
