import type { components } from "@vtc/contracts";
import {
  applicationId,
  createAudit,
  decimal38_18,
  newId,
  type TxContext,
  type UnitOfWork,
  utcDateTime,
  utcIso,
} from "@vtc/db";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  or,
  promotionReviews,
  qualificationAssignments,
  qualificationLevels,
  qualificationPromotions,
  qualificationRules,
  qualificationStates,
  sql,
} from "@vtc/db/qualifications-schema";
import { closed, createOutbox, type QualificationEvent } from "../../platform/outbox/events.js";
import type { Catalogs } from "../catalogs/service.js";
import { type Actor, type Identity, identityError } from "../identity/service.js";
import {
  defaultRegistry,
  evaluateQualificationProgress,
  type Rule,
} from "../qualification-rules/index.js";
import { decimal } from "../sources/contracts/canonical.js";
import type { NormalizedTripEvidence } from "../sources/contracts/evidence.js";
import type { ContributionChange } from "../trips/contributions.js";
import type { Trips } from "../trips/service.js";
import { createAssignmentWriter } from "./assignment-writer.js";
import type { Game } from "./initialization.js";
import { type ActiveLevel, activeLevels, createLadder, ladderReason } from "./ladder.js";
import { levelReceipt } from "./level-receipts.js";
import { type Page, pagination } from "./pagination.js";
import { previewRules, validateDraftRules } from "./preview.js";

type S = components["schemas"];
type Assignment = typeof qualificationAssignments.$inferSelect;
type Level = typeof qualificationLevels.$inferSelect;
type PublishedRule = typeof qualificationRules.$inferSelect;

export interface QualificationsConfig {
  cursorKey: string;
  ladderEditsEnabled?: boolean;
}
export function validateQualificationsConfig(config: QualificationsConfig) {
  if (
    !/^[0-9a-f]{64}$/.test(config.cursorKey) ||
    (config.ladderEditsEnabled !== undefined && typeof config.ladderEditsEnabled !== "boolean")
  )
    throw new Error("INVALID_QUALIFICATIONS_CONFIG");
}
interface Ports {
  identity: Pick<
    Identity,
    | "transaction"
    | "externalCommand"
    | "qualificationContextInTransaction"
    | "completeTraineeInTransaction"
    | "qualificationMembersInTransaction"
    | "memberSummariesInTransaction"
  >;
  trips: Pick<Trips, "contributions">;
  catalogs?: Pick<Catalogs, "selectionsInTransaction">;
  events?: Pick<ReturnType<typeof createOutbox>, "append">;
}
export function createQualifications(
  unit: UnitOfWork,
  config: QualificationsConfig,
  ports: Ports,
  now = () => new Date(),
) {
  validateQualificationsConfig(config);
  const c = (tx: TxContext) => unit.client(tx),
    at = () => now().toISOString(),
    audit = createAudit(unit),
    outbox = ports.events ?? createOutbox(unit),
    page = pagination(config.cursorKey);
  const assignmentWriter = createAssignmentWriter(unit, outbox, at);
  const ladder = createLadder(
    unit,
    {
      identity: ports.identity,
      assignment: assignmentWriter,
      emit: (tx, id, version, instant) =>
        emit(tx, "qualification.rules_changed", id, version, null, null, instant),
    },
    config.ladderEditsEnabled === true,
    at,
  );
  function game(value: string): asserts value is Game {
    if (!["ets2", "ats"].includes(value)) throw identityError(422);
  }
  function reason(value: string) {
    if (typeof value !== "string" || !value.trim() || value.length > 2048) throw identityError(422);
  }
  function date(value: string) {
    try {
      return utcIso(utcDateTime(value));
    } catch {
      throw identityError(422);
    }
  }
  function exact(value: string) {
    try {
      return decimal(decimal38_18(value));
    } catch {
      throw identityError(422);
    }
  }
  async function emit(
    tx: TxContext,
    type: QualificationEvent["type"],
    id: string,
    version: number,
    userId: string | null,
    assignmentId: string | null,
    occurredAt = at(),
  ) {
    const eventId = newId();
    await outbox.append(tx, {
      eventId,
      type,
      schemaVersion: 1,
      aggregate: { kind: "qualification", id, version },
      occurredAt,
      correlationId: eventId,
      causationId: null,
      data: { userId, assignmentId },
    });
  }
  async function state(tx: TxContext, userId: string, selectedGame: Game) {
    let [row] = await c(tx)
      .select()
      .from(qualificationStates)
      .where(
        and(eq(qualificationStates.userId, userId), eq(qualificationStates.game, selectedGame)),
      )
      .for("update");
    if (!row) {
      await c(tx)
        .insert(qualificationStates)
        .values({ userId, game: selectedGame, assignmentId: null, version: 1 });
      [row] = await c(tx)
        .select()
        .from(qualificationStates)
        .where(
          and(eq(qualificationStates.userId, userId), eq(qualificationStates.game, selectedGame)),
        )
        .for("update");
    }
    if (!row) throw new Error("QUALIFICATION_STATE_MISSING");
    return row;
  }
  async function level(tx: TxContext, id: string) {
    const [row] = await c(tx)
      .select()
      .from(qualificationLevels)
      .where(eq(qualificationLevels.id, applicationId(id)))
      .for("update");
    if (!row) throw identityError(404);
    return row;
  }
  async function ruleAt(tx: TxContext, levelId: string, instant: string) {
    const [row] = await c(tx)
      .select()
      .from(qualificationRules)
      .where(
        and(eq(qualificationRules.levelId, levelId), lte(qualificationRules.effectiveAt, instant)),
      )
      .orderBy(desc(qualificationRules.effectiveAt))
      .limit(1)
      .for("share");
    return row;
  }
  async function effectiveRules(tx: TxContext, levels: ActiveLevel[], instant: string) {
    if (!levels.length) return new Map<string, PublishedRule>();
    const latest = c(tx)
      .select({
        levelId: qualificationRules.levelId,
        effectiveAt: sql<string>`MAX(${qualificationRules.effectiveAt})`.as("latest_effective_at"),
      })
      .from(qualificationRules)
      .where(
        and(
          inArray(
            qualificationRules.levelId,
            levels.map((row) => row.id),
          ),
          lte(qualificationRules.effectiveAt, instant),
        ),
      )
      .groupBy(qualificationRules.levelId)
      .as("latest_rule");
    const rows = await c(tx)
      .select({ rule: qualificationRules })
      .from(qualificationRules)
      .innerJoin(
        latest,
        and(
          eq(qualificationRules.levelId, latest.levelId),
          eq(qualificationRules.effectiveAt, latest.effectiveAt),
        ),
      );
    return new Map(rows.map(({ rule }) => [rule.levelId, rule]));
  }
  function assignmentDto(row: Assignment): S["Assignment"] {
    return {
      id: row.id,
      periodId: row.id,
      game: row.game,
      levelId: row.levelId,
      assignedAt: row.assignedAt,
    };
  }
  async function actors(tx: TxContext, ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((id): id is string => id !== null))].sort();
    const names = new Map<string, string>();
    for (let offset = 0; offset < unique.length; offset += 100) {
      const members = await ports.identity.memberSummariesInTransaction(
        tx,
        unique.slice(offset, offset + 100),
      );
      for (const [id, member] of members) names.set(id, member.nickname);
    }
    return (id: string | null): S["QualificationActionActor"] | null =>
      id === null ? null : { id, nickname: names.get(id) ?? null };
  }
  function promotionRule(row: Level, terminal: boolean, rule: PublishedRule | undefined) {
    return !terminal && rule?.promotionGeneration === row.promotionGeneration ? rule : undefined;
  }
  function freightRuleSummary(
    rule: PublishedRule | undefined,
  ): S["QualificationFreightRuleSummary"] | null {
    if (!rule) return null;
    const summary: S["QualificationFreightRuleSummary"] = {
      maxMassKg: null,
      allowedTrailerTypeCount: null,
      allowedAdrCategoryCount: null,
    };
    for (const restriction of rule.rules as S["Rule"][]) {
      if (restriction.type === "max_mass") summary.maxMassKg = restriction.maxKg;
      if (restriction.type === "allowed_trailer_types")
        summary.allowedTrailerTypeCount = restriction.entityIds.length;
      if (restriction.type === "allowed_adr_categories")
        summary.allowedAdrCategoryCount = restriction.classes.length;
    }
    return summary;
  }
  function levelDto(
    row: ActiveLevel,
    terminal: boolean,
    rule: PublishedRule | undefined,
  ): S["QualificationLevel"] {
    const requirements = promotionRule(row, terminal, rule);
    return {
      id: row.id,
      game: row.game,
      name: row.name,
      version: row.version,
      position: row.activePosition,
      terminal,
      ruleVersionId: rule?.id ?? null,
      configured: !!rule,
      freightRuleSummary: freightRuleSummary(rule),
      promotionConfigured: !!requirements,
      requiredTrips: requirements?.requiredTrips ?? null,
      requiredDistanceM:
        requirements?.requiredDistanceM == null ? null : decimal(requirements.requiredDistanceM),
    };
  }
  async function historical(tx: TxContext, userId: string, selectedGame: Game, instant: string) {
    const rows = await c(tx)
      .select()
      .from(qualificationAssignments)
      .where(
        and(
          eq(qualificationAssignments.userId, userId),
          eq(qualificationAssignments.game, selectedGame),
          lte(qualificationAssignments.assignedAt, instant),
          or(
            isNull(qualificationAssignments.endedAt),
            gt(qualificationAssignments.endedAt, instant),
          ),
        ),
      )
      .orderBy(desc(qualificationAssignments.assignedAt))
      .limit(2)
      .for("share");
    if (rows.length !== 1)
      return { status: "unresolved" as const, reasonCode: "qualification_history_unknown" };
    const assignment = rows[0];
    if (!assignment) throw new Error("QUALIFICATION_HISTORY_MISSING");
    const rule = await ruleAt(tx, assignment.levelId, instant);
    if (!rule)
      return { status: "unresolved" as const, reasonCode: "qualification_rules_unconfigured" };
    return {
      status: "resolved" as const,
      assignmentId: assignment.id,
      levelId: assignment.levelId,
      ruleVersionId: rule.id,
      rules: defaultRegistry.validateRuleSet(rule.rules),
      assignedAt: assignment.assignedAt,
      endedAt: assignment.endedAt,
    };
  }
  async function lookup(
    tx: TxContext,
    evidence: NormalizedTripEvidence,
    manualConfirmedAt?: string,
  ) {
    let instant: string | null = null,
      basis: "actual_start" | "manual_confirmation" | "staff_resolution" | "unresolved" =
        "unresolved";
    if (evidence.provider === "manual") {
      if (manualConfirmedAt) instant = date(manualConfirmedAt);
      basis = "manual_confirmation";
      if (instant && instant > at()) throw identityError(422);
    } else if (evidence.start.verifiedActual && evidence.start.utc) {
      instant = date(evidence.start.utc);
      basis = evidence.start.basis === "staff-resolution" ? "staff_resolution" : "actual_start";
    }
    if (!instant)
      return {
        status: "unresolved" as const,
        reasonCode: "qualification_attribution_time_unknown",
        attributionBasis: basis,
        attributionAt: null,
      };
    const resolved = await historical(tx, evidence.ownerUserId, evidence.game, instant);
    return { ...resolved, attributionBasis: basis, attributionAt: instant };
  }
  async function reviewProofs(tx: TxContext, assignmentIds: string[]) {
    for (const id of [...new Set(assignmentIds)].sort()) {
      const [assignment] = await c(tx)
        .select()
        .from(qualificationAssignments)
        .where(eq(qualificationAssignments.id, id))
        .for("update");
      if (!assignment) throw new Error("CONTRIBUTION_ASSIGNMENT_MISSING");
      await c(tx)
        .update(qualificationAssignments)
        .set({ revision: assignment.revision + 1 })
        .where(eq(qualificationAssignments.id, id));
      await emit(
        tx,
        "qualification.progress_changed",
        assignment.id,
        assignment.revision + 1,
        assignment.userId,
        assignment.id,
      );
      const [proof] = await c(tx)
        .select()
        .from(qualificationPromotions)
        .where(eq(qualificationPromotions.sourceAssignmentId, id))
        .for("share");
      if (!proof) continue;
      const totals = await ports.trips.contributions.totals(tx, id),
        required = !evaluateQualificationProgress(
          { requiredTrips: proof.requiredTrips, requiredDistanceM: proof.requiredDistanceM },
          totals,
        ).eligibleForPromotion;
      const [previous] = await c(tx)
        .select()
        .from(promotionReviews)
        .where(eq(promotionReviews.promotionId, proof.id))
        .for("update");
      const version = (previous?.version ?? 0) + (previous?.reviewRequired !== required ? 1 : 0);
      const values = {
        reviewRequired: required,
        version: Math.max(1, version),
        checkedRevision: assignment.revision + 1,
        checkedAt: at(),
      };
      if (previous)
        await c(tx)
          .update(promotionReviews)
          .set(values)
          .where(eq(promotionReviews.promotionId, proof.id));
      else
        await c(tx)
          .insert(promotionReviews)
          .values({ promotionId: proof.id, ...values });
      if (required && previous?.reviewRequired !== true)
        await emit(
          tx,
          "promotion.review_required",
          proof.id,
          values.version,
          assignment.userId,
          assignment.id,
        );
    }
  }
  async function progress(
    tx: TxContext,
    userId: string,
    selectedGame: Game,
    privateRead: boolean,
    instant = at(),
  ) {
    const current = await state(tx, userId, selectedGame);
    if (!current.assignmentId) throw identityError(409, "SETUP_REQUIRED");
    const [assignment] = await c(tx)
      .select()
      .from(qualificationAssignments)
      .where(eq(qualificationAssignments.id, current.assignmentId))
      .for("update");
    if (!assignment || assignment.endedAt !== null || assignment.assignedAt > instant)
      throw identityError(409, "SETUP_REQUIRED");
    const selected = await level(tx, assignment.levelId),
      successor = await ladder.nextLevelInTransaction(tx, { id: selected.id, game: selectedGame }),
      rule = promotionRule(selected, !successor, await ruleAt(tx, assignment.levelId, instant)),
      totals = await ports.trips.contributions.totals(tx, assignment.id);
    const requirements = {
      requiredTrips: rule?.requiredTrips ?? null,
      requiredDistanceM: rule?.requiredDistanceM == null ? null : decimal(rule.requiredDistanceM),
    };
    const eligible =
      !!rule && evaluateQualificationProgress(requirements, totals).eligibleForPromotion;
    const data: S["ProgressPublic"] = {
      assignment: assignmentDto(assignment),
      acceptedTrips: totals.completedTrips,
      actualDistanceM: totals.completedDistanceM,
      ...requirements,
      eligibleForConfirmation: eligible,
      computedAt: instant,
      projectionVersion: assignment.revision,
      projectionPending: false,
    };
    if (!privateRead) return { data, version: current.version, rule };
    const reviews = await c(tx)
      .select({ required: promotionReviews.reviewRequired })
      .from(promotionReviews)
      .innerJoin(
        qualificationPromotions,
        eq(qualificationPromotions.id, promotionReviews.promotionId),
      )
      .innerJoin(
        qualificationAssignments,
        eq(qualificationAssignments.id, qualificationPromotions.sourceAssignmentId),
      )
      .where(
        and(
          eq(qualificationAssignments.userId, userId),
          eq(qualificationAssignments.game, selectedGame),
          eq(promotionReviews.reviewRequired, true),
        ),
      )
      .limit(1);
    const reviewRequired = reviews.length > 0;
    return {
      data: {
        ...data,
        reviewRequired,
        reviewReasonCodes: reviewRequired ? ["promotion_requirements_no_longer_met"] : [],
      } as S["Progress"],
      version: current.version,
      rule,
    };
  }
  async function writeAssignment(
    tx: TxContext,
    actor: Actor,
    userId: string,
    selectedGame: Game,
    levelId: string,
    purpose: Assignment["purpose"],
    assignedAt: string,
    endedAt: string | null,
    text: string,
    options?: { companyId: string; instant: string },
  ) {
    const result = await assignmentWriter(
      tx,
      actor,
      {
        userId,
        game: selectedGame,
        levelId,
        purpose,
        assignedAt,
        endedAt,
        reason: text,
      },
      options,
    );
    return { data: assignmentDto(result.row), version: result.version };
  }

  async function prepare(tx: TxContext, owners: { ownerId: string; game: Game }[], actor?: Actor) {
    await ports.identity.qualificationContextInTransaction(
      tx,
      [...new Set(owners.map((r) => r.ownerId))],
      actor,
      "trips.review",
    );
    const unique = [...new Map(owners.map((r) => [`${r.ownerId}:${r.game}`, r])).values()].sort(
      (a, b) => `${a.ownerId}:${a.game}`.localeCompare(`${b.ownerId}:${b.game}`),
    );
    for (const row of unique) {
      await state(tx, row.ownerId, row.game);
      await c(tx)
        .select({ id: qualificationAssignments.id })
        .from(qualificationAssignments)
        .where(
          and(
            eq(qualificationAssignments.userId, row.ownerId),
            eq(qualificationAssignments.game, row.game),
          ),
        )
        .orderBy(asc(qualificationAssignments.id))
        .for("update");
    }
  }
  return {
    config,
    nextLevelInTransaction: ladder.nextLevelInTransaction,
    changeLadder(
      actor: Actor,
      selectedGame: Game,
      key: string,
      expected: number,
      change: Parameters<typeof ladder.change>[4],
    ) {
      game(selectedGame);
      return ladder.change(actor, selectedGame, key, expected, change);
    },
    async ladder(actor: Actor, selectedGame: Game) {
      game(selectedGame);
      return ports.identity.transaction(async (tx) => {
        await ports.identity.qualificationContextInTransaction(tx, [], actor);
        const instant = at();
        const rows = await activeLevels(unit, tx, selectedGame);
        const rules = await effectiveRules(tx, rows, instant);
        const counts = await ladder.counts(
          tx,
          selectedGame,
          rows.map((row) => row.id),
        );
        const revision = ladder.revision(rows);
        return {
          version: revision,
          data: {
            game: selectedGame,
            revision,
            asOf: instant,
            ladderEditsEnabled: config.ladderEditsEnabled === true,
            levels: rows.map((row, index) => {
              const rule = rules.get(row.id);
              return {
                ...levelDto(row, index === rows.length - 1, rule),
                currentDriverCount: counts.get(row.id) ?? 0,
                effectiveRule: rule
                  ? {
                      id: rule.id,
                      levelId: row.id,
                      game: row.game,
                      effectiveAt: rule.effectiveAt,
                      publishedAt: rule.publishedAt,
                      rules: rule.rules as S["Rule"][],
                      requiredTrips: rule.requiredTrips,
                      requiredDistanceM:
                        rule.requiredDistanceM === null ? null : decimal(rule.requiredDistanceM),
                    }
                  : null,
              };
            }),
          } satisfies S["QualificationLadder"],
        };
      });
    },
    prepareInTransaction: prepare,
    async notificationAssignmentInTransaction(tx: TxContext, id: string) {
      const [row] = await c(tx)
        .select({
          id: qualificationAssignments.id,
          userId: qualificationAssignments.userId,
          game: qualificationAssignments.game,
          purpose: qualificationAssignments.purpose,
          endedAt: qualificationAssignments.endedAt,
          revision: qualificationAssignments.revision,
          assignedAt: qualificationAssignments.assignedAt,
          levelId: qualificationAssignments.levelId,
        })
        .from(qualificationAssignments)
        .where(eq(qualificationAssignments.id, applicationId(id)))
        .for("share");
      if (!row) throw new Error("NOTIFICATION_ASSIGNMENT_MISSING");
      let eligible = false;
      const instant = at();
      if (row.endedAt === null && row.assignedAt <= instant) {
        // Notification consumption never creates state or takes writer-only locks. The caller
        // holds Identity's shared company fence; all qualification/contribution writers take X.
        const [current] = await c(tx)
          .select({ assignmentId: qualificationStates.assignmentId })
          .from(qualificationStates)
          .where(
            and(eq(qualificationStates.userId, row.userId), eq(qualificationStates.game, row.game)),
          )
          .for("share");
        if (!current) throw new Error("NOTIFICATION_QUALIFICATION_STATE_MISSING");
        if (current.assignmentId === row.id) {
          const [selected] = await c(tx)
            .select()
            .from(qualificationLevels)
            .where(eq(qualificationLevels.id, row.levelId))
            .for("share");
          if (!selected) throw new Error("NOTIFICATION_QUALIFICATION_LEVEL_MISSING");
          const successor = await ladder.nextLevelInTransaction(tx, {
            id: row.levelId,
            game: row.game,
          });
          const rule = promotionRule(selected, !successor, await ruleAt(tx, row.levelId, instant));
          eligible =
            !!rule &&
            evaluateQualificationProgress(
              rule,
              await ports.trips.contributions.totals(tx, row.id, "share"),
            ).eligibleForPromotion;
        }
      }
      return {
        ...row,
        eligible,
      };
    },
    async notificationPromotionReviewInTransaction(
      tx: TxContext,
      id: string,
      version: number,
      assignmentId: string,
    ) {
      const [row] = await c(tx)
        .select({
          reviewRequired: promotionReviews.reviewRequired,
          version: promotionReviews.version,
        })
        .from(promotionReviews)
        .innerJoin(
          qualificationPromotions,
          eq(qualificationPromotions.id, promotionReviews.promotionId),
        )
        .where(
          and(
            eq(promotionReviews.promotionId, applicationId(id)),
            eq(qualificationPromotions.sourceAssignmentId, applicationId(assignmentId)),
          ),
        )
        .for("share");
      return row?.version === version && row.reviewRequired;
    },
    async authorize(actor: Actor, manage = false) {
      return ports.identity.transaction((tx) =>
        ports.identity.qualificationContextInTransaction(
          tx,
          [],
          actor,
          manage ? "qualifications.manage" : "company.read",
        ),
      );
    },
    async members(actor: Actor, options: Page = {}) {
      return ports.identity.transaction(async (tx) => {
        await ports.identity.qualificationContextInTransaction(tx, [], actor);
        const paging = page(actor, ["qualification-members"], options);
        return paging.finish(
          await ports.identity.qualificationMembersInTransaction(
            tx,
            paging.after?.id ?? null,
            paging.limit,
          ),
          (row) => ({ id: row.id, time: null }),
        );
      });
    },
    async preview(actor: Actor, input: S["QualificationPreviewInput"]) {
      game(input.game);
      return ports.identity.transaction(async (tx) => {
        await ports.identity.qualificationContextInTransaction(tx, [], actor);
        return previewRules(input);
      });
    },
    async levels(actor: Actor, selectedGame: Game, options: Page = {}) {
      game(selectedGame);
      return ports.identity.transaction(async (tx) => {
        await ports.identity.qualificationContextInTransaction(tx, [], actor, "company.read");
        const rows = await activeLevels(unit, tx, selectedGame);
        const paging = page(actor, ["levels", selectedGame, ladder.revision(rows)], options);
        const start = paging.after ? rows.findIndex((row) => row.id === paging.after?.id) + 1 : 0;
        if (paging.after && !start) throw identityError(409, "VERSION_CONFLICT");
        const visible = rows.slice(start, start + paging.limit + 1);
        const rules = await effectiveRules(tx, visible, at());
        return paging.finish(
          visible.map((row) =>
            levelDto(row, row.activePosition === rows.length, rules.get(row.id)),
          ),
          (row) => ({
            id: row.id,
            time: null,
          }),
        );
      });
    },
    async archivedLevels(
      actor: Actor,
      selectedGame: Game,
      options: Page = {},
    ): Promise<S["ListQualificationArchivedLevel"]> {
      game(selectedGame);
      return ports.identity.transaction(async (tx) => {
        await ports.identity.qualificationContextInTransaction(tx, [], actor);
        const paging = page(actor, ["archived-levels", selectedGame, options.limit ?? 25], options);
        const rows = await c(tx)
          .select({
            id: qualificationLevels.id,
            game: qualificationLevels.game,
            name: qualificationLevels.name,
          })
          .from(qualificationLevels)
          .where(
            and(
              eq(qualificationLevels.game, selectedGame),
              isNull(qualificationLevels.activePosition),
              paging.after ? gt(qualificationLevels.id, paging.after.id) : undefined,
            ),
          )
          .orderBy(asc(qualificationLevels.id))
          .limit(paging.limit + 1)
          .for("share");
        return paging.finish(rows, (row) => ({ id: row.id, time: null }));
      });
    },
    async rules(
      actor: Actor,
      levelId: string,
      options: Page = {},
      ruleVersionId?: string,
      staff = false,
    ) {
      return ports.identity.transaction(async (tx) => {
        await ports.identity.qualificationContextInTransaction(
          tx,
          [],
          actor,
          staff ? "qualifications.manage" : "company.read",
        );
        const selected = await level(tx, levelId);
        const paging = page(
          actor,
          staff
            ? ["staff-rule-history", levelId, selected.game, selected.version]
            : ["rules", levelId],
          options,
        );
        const rows = await c(tx)
          .select()
          .from(qualificationRules)
          .where(
            and(
              eq(qualificationRules.levelId, selected.id),
              ruleVersionId ? eq(qualificationRules.id, applicationId(ruleVersionId)) : undefined,
              paging.after?.time
                ? or(
                    lt(qualificationRules.effectiveAt, paging.after.time),
                    and(
                      eq(qualificationRules.effectiveAt, paging.after.time),
                      lt(qualificationRules.id, paging.after.id),
                    ),
                  )
                : undefined,
            ),
          )
          .orderBy(desc(qualificationRules.effectiveAt), desc(qualificationRules.id))
          .limit(paging.limit + 1);
        const result = paging.finish(rows, (row) => ({ id: row.id, time: row.effectiveAt }));
        const actorDto = staff
          ? await actors(
              tx,
              result.items.map((row) => row.actorId),
            )
          : undefined;
        const items = result.items.map((row) => ({
          id: row.id,
          levelId,
          game: selected.game,
          publishedAt: row.publishedAt,
          effectiveAt: row.effectiveAt,
          rules: row.rules as S["Rule"][],
          requiredTrips: row.requiredTrips,
          requiredDistanceM: row.requiredDistanceM == null ? null : decimal(row.requiredDistanceM),
          ...(actorDto ? { publisher: actorDto(row.actorId) } : {}),
        }));
        if (ruleVersionId && !items.length) throw identityError(404);
        return { ...result, items };
      });
    },
    async rename(
      actor: Actor,
      levelId: string,
      key: string,
      expected: number,
      input: S["LevelInput"],
    ) {
      if (!input.name.trim() || input.name.length > 128) throw identityError(422);
      const rationale = ladderReason(input.reason);
      return ports.identity.transaction(async (tx) => {
        const { companyId } = await ports.identity.qualificationContextInTransaction(tx, [], actor);
        if (rationale !== null && !config.ladderEditsEnabled) throw identityError(503);
        const result = await ports.identity.externalCommand(
          tx,
          `${actor.userId}:qualification:rename:${levelId}`,
          key,
          { expected, input },
          async () => {
            const stored = await level(tx, levelId);
            if (stored.version !== expected) throw identityError(409, "VERSION_CONFLICT");
            if (stored.activePosition === null) throw identityError(409);
            const row = { ...stored, activePosition: stored.activePosition };
            const next = { ...row, name: input.name, version: row.version + 1 };
            await c(tx)
              .update(qualificationLevels)
              .set({ name: next.name, version: next.version })
              .where(eq(qualificationLevels.id, row.id));
            const instant = at();
            await ladder.auditLevel(tx, actor, companyId, row, next, instant, rationale);
            await emit(
              tx,
              "qualification.rules_changed",
              row.id,
              next.version,
              null,
              null,
              instant,
            );
            const terminal = !(await ladder.nextLevelInTransaction(tx, row));
            return {
              data: levelDto(next, terminal, await ruleAt(tx, next.id, instant)),
              version: next.version,
            };
          },
        );
        return levelReceipt(result, levelId);
      });
    },
    async publish(
      actor: Actor,
      levelId: string,
      key: string,
      expected: number,
      input: S["QualificationRulePublicationInput"],
    ) {
      const rationale = ladderReason(input.reason);
      let rules: Rule[];
      try {
        rules = validateDraftRules(input.rules);
      } catch {
        throw identityError(422);
      }
      if (
        rules.length > 32 ||
        new Set(rules.map((rule) => rule.type)).size !== rules.length ||
        (input.requiredTrips !== null &&
          (!Number.isInteger(input.requiredTrips) ||
            input.requiredTrips < 0 ||
            input.requiredTrips > 2147483647))
      )
        throw identityError(422);
      const distance = input.requiredDistanceM === null ? null : exact(input.requiredDistanceM);
      return ports.identity.transaction(async (tx) => {
        const { companyId } = await ports.identity.qualificationContextInTransaction(tx, [], actor);
        const result = await ports.identity.externalCommand(
          tx,
          `${actor.userId}:qualification:publish:${levelId}`,
          key,
          { expected, input },
          async () => {
            const stored = await level(tx, levelId);
            if (stored.version !== expected) throw identityError(409, "VERSION_CONFLICT");
            if (stored.activePosition === null) throw identityError(409);
            const selected = { ...stored, activePosition: stored.activePosition };
            const terminal = !(await ladder.nextLevelInTransaction(tx, selected));
            if (terminal && (input.requiredTrips !== null || distance !== null))
              throw identityError(422);
            const publishedAt = at(),
              effectiveAt = input.effectiveAt ? date(input.effectiveAt) : publishedAt;
            if (effectiveAt < publishedAt) throw identityError(422);
            const [latest] = await c(tx)
              .select()
              .from(qualificationRules)
              .where(eq(qualificationRules.levelId, levelId))
              .orderBy(desc(qualificationRules.effectiveAt))
              .limit(1)
              // Company/level writer fences serialize publication; prior rule versions are immutable.
              .for("share");
            if (latest && effectiveAt <= latest.effectiveAt) throw identityError(409);
            for (const rule of rules) {
              if (rule.type === "max_mass") exact(rule.maxKg as string);
              if (rule.type === "allowed_trailer_types") {
                const ids = (rule as { entityIds?: unknown }).entityIds;
                if (!ports.catalogs || !Array.isArray(ids) || ids.length > 1000)
                  throw identityError(422);
                const found = await ports.catalogs.selectionsInTransaction(
                  tx,
                  (ids as string[]).map((id) => ({ kind: "trailer" as const, id })),
                );
                const kept = new Set(
                  ((latest?.rules ?? []) as { type: string; entityIds?: string[] }[]).flatMap(
                    (previous) =>
                      previous.type === "allowed_trailer_types" ? (previous.entityIds ?? []) : [],
                  ),
                );
                for (const id of ids as string[]) {
                  const row = found.get(id);
                  if (!row || row.game !== selected.game) throw identityError(422);
                  if (row.hidden && !kept.has(id))
                    throw identityError(422, "CATALOG_SELECTION_HIDDEN");
                }
              }
            }
            const ruleId = newId();
            await c(tx).insert(qualificationRules).values({
              id: ruleId,
              levelId,
              publishedAt,
              effectiveAt,
              rules,
              requiredTrips: input.requiredTrips,
              requiredDistanceM: distance,
              actorId: actor.userId,
              reason: rationale,
              promotionGeneration: selected.promotionGeneration,
            });
            await c(tx)
              .update(qualificationLevels)
              .set({ version: selected.version + 1 })
              .where(eq(qualificationLevels.id, levelId));
            const version = selected.version + 1;
            await audit.append(tx, {
              actorKind: "user",
              actorId: actor.userId,
              companyId,
              operation: "qualification.rules_published",
              subjectKind: "qualification_rule_version",
              subjectId: ruleId,
              occurredAt: publishedAt,
              reason: "operator_request",
              details: {
                before: latest
                  ? {
                      game: selected.game,
                      levelId,
                      ruleVersionId: latest.id,
                      version: selected.version,
                    }
                  : null,
                after: { game: selected.game, levelId, ruleVersionId: ruleId, version },
              },
            });
            await emit(
              tx,
              "qualification.rules_changed",
              levelId,
              version,
              null,
              null,
              publishedAt,
            );
            return {
              data: levelDto(
                { ...selected, version },
                terminal,
                await ruleAt(tx, levelId, publishedAt),
              ),
              version,
            };
          },
        );
        return levelReceipt(result, levelId);
      });
    },
    lookupInTransaction: lookup,
    async tripAssignmentsInTransaction(
      tx: TxContext,
      ownerId: string,
      selectedGame: Game,
      after: { id: string; time: string | null } | null = null,
      limit = 101,
    ) {
      const rows = await c(tx)
        .select({ assignment: qualificationAssignments, levelName: qualificationLevels.name })
        .from(qualificationAssignments)
        .innerJoin(
          qualificationLevels,
          eq(qualificationLevels.id, qualificationAssignments.levelId),
        )
        .where(
          and(
            eq(qualificationAssignments.userId, ownerId),
            eq(qualificationAssignments.game, selectedGame),
            after?.time
              ? or(
                  lt(qualificationAssignments.assignedAt, after.time),
                  and(
                    eq(qualificationAssignments.assignedAt, after.time),
                    lt(qualificationAssignments.id, after.id),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(desc(qualificationAssignments.assignedAt), desc(qualificationAssignments.id))
        .limit(limit)
        .for("share");
      return rows.map(({ assignment, levelName }) => ({
        ...assignmentDto(assignment),
        endedAt: assignment.endedAt,
        levelName,
      }));
    },
    async replaceContributionsInTransaction(tx: TxContext, changes: readonly ContributionChange[]) {
      if (!changes.length || changes.length > 100) throw identityError(422);
      try {
        changes = changes.map((change) => {
          const input = closed(change, [
            "tripId",
            "expectedTripVersion",
            "version",
            "factId",
            ...(["aliasOf", "manualConfirmedAt"] as const).filter((key) =>
              Object.hasOwn(change, key),
            ),
          ]);
          if (
            !Number.isInteger(input.version) ||
            Number(input.version) < 1 ||
            Number(input.version) > 2147483647 ||
            !Number.isInteger(input.expectedTripVersion) ||
            Number(input.expectedTripVersion) < 1 ||
            Number(input.expectedTripVersion) > 2147483647 ||
            (input.manualConfirmedAt !== undefined && typeof input.manualConfirmedAt !== "string")
          )
            throw new Error("INVALID_CONTRIBUTION_COMMAND");
          return {
            tripId: applicationId(input.tripId as string),
            expectedTripVersion: input.expectedTripVersion as number,
            version: input.version as number,
            factId: applicationId(input.factId as string),
            ...(Object.hasOwn(input, "aliasOf")
              ? { aliasOf: input.aliasOf === null ? null : applicationId(input.aliasOf as string) }
              : {}),
            ...(typeof input.manualConfirmedAt === "string"
              ? { manualConfirmedAt: date(input.manualConfirmedAt) }
              : {}),
          };
        });
        if (new Set(changes.map((change) => change.tripId)).size !== changes.length)
          throw new Error("DUPLICATE_CONTRIBUTION_SUBJECT");
      } catch {
        throw identityError(422);
      }
      const owners = await ports.trips.contributions.owners(
        tx,
        changes.map((change) => change.tripId),
      );
      await ports.identity.qualificationContextInTransaction(tx, [
        ...new Set(owners.map((row) => row.ownerId)),
      ]);
      for (const row of [...owners].sort((a, b) =>
        `${a.ownerId}:${a.game}`.localeCompare(`${b.ownerId}:${b.game}`),
      )) {
        await state(tx, row.ownerId, row.game);
        await c(tx)
          .select({ id: qualificationAssignments.id })
          .from(qualificationAssignments)
          .where(
            and(
              eq(qualificationAssignments.userId, row.ownerId),
              eq(qualificationAssignments.game, row.game),
            ),
          )
          .orderBy(asc(qualificationAssignments.id))
          .for("update");
      }
      const contexts = await ports.trips.contributions.contexts(tx, changes);
      const affected: string[] = [];
      for (const context of contexts) {
        const resolved = await lookup(tx, context.evidence, context.change.manualConfirmedAt);
        affected.push(
          ...(await ports.trips.contributions.replace(
            tx,
            context,
            {
              assignmentId: resolved.status === "resolved" ? resolved.assignmentId : null,
              ruleVersionId: resolved.status === "resolved" ? resolved.ruleVersionId : null,
              attributionAt: resolved.attributionAt,
              attributionBasis: resolved.attributionBasis,
            },
            at(),
          )),
        );
      }
      await reviewProofs(tx, affected);
      return { affectedPeriods: [...new Set(affected)] };
    },
    async progress(
      actor: Actor,
      userId: string,
      selectedGame: Game,
      scope: "public" | "owner" | "admin",
    ) {
      game(selectedGame);
      applicationId(userId);
      if (scope === "owner" && actor.userId !== userId) throw identityError(404);
      return ports.identity.transaction(async (tx) => {
        await ports.identity.qualificationContextInTransaction(
          tx,
          [userId],
          actor,
          scope === "admin"
            ? "qualifications.manage"
            : scope === "owner"
              ? "trips.submit_own"
              : "company.read",
        );
        const { data, version } = await progress(tx, userId, selectedGame, scope !== "public");
        return { data, version };
      });
    },
    async history(
      actor: Actor,
      userId: string,
      selectedGame: Game,
      options: Page = {},
      admin = false,
    ) {
      game(selectedGame);
      applicationId(userId);
      if (!admin && userId !== actor.userId) throw identityError(404);
      return ports.identity.transaction(async (tx) => {
        await ports.identity.qualificationContextInTransaction(
          tx,
          [userId],
          actor,
          admin ? "qualifications.manage" : "company.read",
        );
        const current = await state(tx, userId, selectedGame);
        const paging = page(actor, ["history", userId, selectedGame, current.version], options);
        const rows = await c(tx)
          .select({ assignment: qualificationAssignments, levelName: qualificationLevels.name })
          .from(qualificationAssignments)
          .innerJoin(
            qualificationLevels,
            eq(qualificationLevels.id, qualificationAssignments.levelId),
          )
          .where(
            and(
              eq(qualificationAssignments.userId, userId),
              eq(qualificationAssignments.game, selectedGame),
              paging.after?.time
                ? or(
                    lt(qualificationAssignments.assignedAt, paging.after.time),
                    and(
                      eq(qualificationAssignments.assignedAt, paging.after.time),
                      lt(qualificationAssignments.id, paging.after.id),
                    ),
                  )
                : undefined,
            ),
          )
          .orderBy(desc(qualificationAssignments.assignedAt), desc(qualificationAssignments.id))
          .limit(paging.limit + 1);
        return {
          data: paging.finish(
            rows.map(({ assignment, levelName }) => ({
              ...assignmentDto(assignment),
              endedAt: assignment.endedAt,
              levelName,
            })),
            (row) => ({ id: row.id, time: row.assignedAt }),
          ),
          version: current.version,
        };
      });
    },
    async actionHistory(actor: Actor, userId: string, selectedGame: Game, options: Page = {}) {
      game(selectedGame);
      applicationId(userId);
      return ports.identity.transaction(async (tx) => {
        await ports.identity.qualificationContextInTransaction(tx, [userId], actor);
        const current = await state(tx, userId, selectedGame);
        const paging = page(
          actor,
          ["staff-action-history", userId, selectedGame, current.version],
          options,
        );
        const rows = await c(tx)
          .select({ assignment: qualificationAssignments, levelName: qualificationLevels.name })
          .from(qualificationAssignments)
          .innerJoin(
            qualificationLevels,
            eq(qualificationLevels.id, qualificationAssignments.levelId),
          )
          .where(
            and(
              eq(qualificationAssignments.userId, userId),
              eq(qualificationAssignments.game, selectedGame),
              paging.after?.time
                ? or(
                    lt(qualificationAssignments.assignedAt, paging.after.time),
                    and(
                      eq(qualificationAssignments.assignedAt, paging.after.time),
                      lt(qualificationAssignments.id, paging.after.id),
                    ),
                  )
                : undefined,
            ),
          )
          .orderBy(desc(qualificationAssignments.assignedAt), desc(qualificationAssignments.id))
          .limit(paging.limit + 1);
        const result = paging.finish(
          rows.map(({ assignment, levelName }) => ({ ...assignment, levelName })),
          (row) => ({ id: row.id, time: row.assignedAt }),
        );
        const actorDto = await actors(
          tx,
          result.items.map((row) => row.actorId),
        );
        const proofs = result.items.length
          ? await c(tx)
              .select({
                id: qualificationPromotions.id,
                targetAssignmentId: qualificationPromotions.targetAssignmentId,
                confirmedAt: qualificationPromotions.confirmedAt,
              })
              .from(qualificationPromotions)
              .where(
                inArray(
                  qualificationPromotions.targetAssignmentId,
                  result.items.map((row) => row.id),
                ),
              )
              .limit(result.items.length + 1)
          : [];
        if (proofs.length > result.items.length)
          throw new Error("AMBIGUOUS_QUALIFICATION_PROMOTION");
        const byTarget = new Map<string, S["QualificationActionHistory"]["promotion"]>();
        for (const proof of proofs) {
          if (byTarget.has(proof.targetAssignmentId))
            throw new Error("AMBIGUOUS_QUALIFICATION_PROMOTION");
          byTarget.set(proof.targetAssignmentId, { id: proof.id, confirmedAt: proof.confirmedAt });
        }
        return {
          data: {
            ...result,
            items: result.items.map((row): S["QualificationActionHistory"] => ({
              ...assignmentDto(row),
              endedAt: row.endedAt,
              levelName: row.levelName,
              purpose: row.purpose,
              actor: actorDto(row.actorId),
              promotion: byTarget.get(row.id) ?? null,
            })),
          },
          version: current.version,
        };
      });
    },
    async assign(
      actor: Actor,
      userId: string,
      key: string,
      expected: number,
      input: S["AssignmentInput"],
    ) {
      game(input.game);
      reason(input.reason);
      return ports.identity.transaction(async (tx) => {
        const authority = await ports.identity.qualificationContextInTransaction(
          tx,
          [userId],
          actor,
        );
        return ports.identity.externalCommand(
          tx,
          `${actor.userId}:qualification:assign:${userId}`,
          key,
          { expected, input },
          async () => {
            const current = await state(tx, userId, input.game),
              target = await level(tx, input.levelId);
            if (current.version !== expected) throw identityError(409, "VERSION_CONFLICT");
            if (
              target.game !== input.game ||
              (target.activePosition === null && input.purpose !== "historical_resolution")
            )
              throw identityError(422);
            const instant = at();
            let assignedAt = instant,
              endedAt: string | null = null;
            if (input.purpose === "historical_resolution") {
              if (!input.assignedAt || !input.endedAt) throw identityError(422);
              assignedAt = date(input.assignedAt);
              endedAt = date(input.endedAt);
              if (endedAt <= assignedAt || endedAt > instant) throw identityError(422);
              const rows = await c(tx)
                .select({ id: qualificationAssignments.id })
                .from(qualificationAssignments)
                .where(
                  and(
                    eq(qualificationAssignments.userId, userId),
                    eq(qualificationAssignments.game, input.game),
                    sql`${qualificationAssignments.assignedAt} < ${utcDateTime(endedAt)}`,
                    or(
                      isNull(qualificationAssignments.endedAt),
                      gt(qualificationAssignments.endedAt, assignedAt),
                    ),
                  ),
                )
                .limit(1)
                .for("update");
              if (rows.length) throw identityError(409);
            } else {
              if (
                input.assignedAt !== undefined ||
                input.endedAt !== undefined ||
                authority.members.get(userId)?.status !== "active"
              )
                throw identityError(409);
              if (input.purpose !== "administrative_correction" && current.assignmentId)
                throw identityError(409);
              if (input.purpose === "initial") {
                const [history] = await c(tx)
                  .select({ id: qualificationAssignments.id })
                  .from(qualificationAssignments)
                  .where(
                    and(
                      eq(qualificationAssignments.userId, userId),
                      eq(qualificationAssignments.game, input.game),
                    ),
                  )
                  .limit(1);
                if (history || target.activePosition !== 1) throw identityError(409);
              }
              if (input.purpose === "administrative_correction" && current.assignmentId) {
                const [old] = await c(tx)
                  .select()
                  .from(qualificationAssignments)
                  .where(eq(qualificationAssignments.id, current.assignmentId));
                const oldPosition = old ? (await level(tx, old.levelId)).activePosition : null;
                if (
                  target.activePosition === null ||
                  oldPosition === null ||
                  target.activePosition > oldPosition
                )
                  throw identityError(409);
              }
            }
            return writeAssignment(
              tx,
              actor,
              userId,
              input.game,
              target.id,
              input.purpose,
              assignedAt,
              endedAt,
              input.reason,
              { companyId: authority.companyId, instant },
            );
          },
        );
      });
    },
    async promote(
      actor: Actor,
      userId: string,
      key: string,
      expected: number,
      input: S["PromotionInput"],
    ) {
      game(input.game);
      reason(input.reason);
      return ports.identity.transaction(async (tx) => {
        const authority = await ports.identity.qualificationContextInTransaction(
          tx,
          [userId],
          actor,
        );
        return ports.identity.externalCommand(
          tx,
          `${actor.userId}:qualification:promote:${userId}`,
          key,
          { expected, input },
          async () => {
            const current = await state(tx, userId, input.game);
            if (authority.members.get(userId)?.status !== "active") throw identityError(409);
            if (current.version !== expected || current.assignmentId !== input.assignmentId)
              throw identityError(409, "VERSION_CONFLICT");
            const [assignment] = await c(tx)
              .select()
              .from(qualificationAssignments)
              .where(eq(qualificationAssignments.id, input.assignmentId))
              .for("update");
            if (!assignment) throw identityError(409);
            const source = await level(tx, assignment.levelId);
            const target = await ladder.nextLevelInTransaction(tx, {
              id: source.id,
              game: input.game,
            });
            if (!target || target.id !== input.targetLevelId) throw identityError(409);
            // One confirmation instant selects the immutable rule used by evaluation and proof.
            const confirmedAt = at(),
              currentProgress = await progress(tx, userId, input.game, true, confirmedAt),
              rule = currentProgress.rule;
            if (!currentProgress.data.eligibleForConfirmation || !rule) throw identityError(409);
            const result = await writeAssignment(
              tx,
              actor,
              userId,
              input.game,
              target.id,
              "promotion",
              confirmedAt,
              null,
              input.reason,
              { companyId: authority.companyId, instant: confirmedAt },
            );
            await c(tx).insert(qualificationPromotions).values({
              id: newId(),
              sourceAssignmentId: assignment.id,
              targetAssignmentId: result.data.id,
              ruleVersionId: rule.id,
              requiredTrips: rule.requiredTrips,
              requiredDistanceM: rule.requiredDistanceM,
              acceptedTrips: currentProgress.data.acceptedTrips,
              actualDistanceM: currentProgress.data.actualDistanceM,
              periodRevision: currentProgress.data.projectionVersion,
              confirmedAt,
              actorId: actor.userId,
              reason: input.reason,
            });
            if (source.activePosition === 1)
              await ports.identity.completeTraineeInTransaction(tx, actor, userId);
            await emit(
              tx,
              "qualification.promoted",
              result.data.id,
              result.version,
              userId,
              result.data.id,
              confirmedAt,
            );
            return result;
          },
        );
      });
    },
  };
}
export type Qualifications = ReturnType<typeof createQualifications>;
