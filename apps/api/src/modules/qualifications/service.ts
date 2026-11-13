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
  levelCodes,
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
import {
  type CompanyHistoryFilters,
  createCompanyHistory,
  qualificationActor,
  qualificationMembersById,
} from "./company-history.js";
import { createEligibility, nextLevel, promotionEligible, successor } from "./eligibility.js";
import type { Game } from "./initialization.js";
import { type Page, pagination } from "./pagination.js";
import { previewRules, validateDraftRules } from "./preview.js";

type S = components["schemas"];
type Assignment = typeof qualificationAssignments.$inferSelect;
type Level = typeof qualificationLevels.$inferSelect;

export { nextLevel } from "./eligibility.js";

export interface QualificationsConfig {
  cursorKey: string;
  eligibilityTrackingSince?: string;
}
export function validateEligibilityTrackingSince(since: string, instant = new Date()) {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(since) ||
    utcIso(utcDateTime(since)) !== since ||
    since > instant.toISOString()
  )
    throw new Error("INVALID_ELIGIBILITY_TRACKING_SINCE");
}

export function validateQualificationsConfig(config: QualificationsConfig, instant?: Date) {
  if (!/^[0-9a-f]{64}$/.test(config.cursorKey)) throw new Error("INVALID_QUALIFICATIONS_CONFIG");
  if (config.eligibilityTrackingSince !== undefined)
    validateEligibilityTrackingSince(config.eligibilityTrackingSince, instant);
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
  validateQualificationsConfig(
    config,
    config.eligibilityTrackingSince === undefined ? undefined : now(),
  );
  const c = (tx: TxContext) => unit.client(tx),
    at = () => now().toISOString(),
    audit = createAudit(unit),
    outbox = ports.events ?? createOutbox(unit),
    page = pagination(config.cursorKey),
    companyHistory = createCompanyHistory(unit, ports.identity),
    eligibility = createEligibility(
      unit,
      ports.trips.contributions,
      ports.identity,
      config.eligibilityTrackingSince,
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
  ) {
    const eventId = newId();
    await outbox.append(tx, {
      eventId,
      type,
      schemaVersion: 1,
      aggregate: { kind: "qualification", id, version },
      occurredAt: at(),
      correlationId: eventId,
      causationId: null,
      data: { userId, assignmentId },
    });
  }
  async function recordAudit(
    tx: TxContext,
    actor: Actor,
    subjectId: string,
    operation: "configuration.changed" | "membership.changed",
  ) {
    await audit.append(tx, {
      actorKind: "user",
      actorId: actor.userId,
      operation,
      subjectKind: operation === "configuration.changed" ? "qualification" : "user",
      subjectId,
      reason: "operator_request",
      occurredAt: at(),
    });
  }
  async function state(tx: TxContext, userId: string, selectedGame: Game) {
    let [row] = await c(tx)
      .select({
        assignmentId: qualificationStates.assignmentId,
        version: qualificationStates.version,
      })
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
        .select({
          assignmentId: qualificationStates.assignmentId,
          version: qualificationStates.version,
        })
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
  function assignmentDto(row: Assignment): S["Assignment"] {
    return {
      id: row.id,
      periodId: row.id,
      game: row.game,
      levelId: row.levelId,
      assignedAt: row.assignedAt,
    };
  }
  async function levelDto(tx: TxContext, row: Level): Promise<S["QualificationLevel"]> {
    const rule = await ruleAt(tx, row.id, at());
    return {
      id: row.id,
      game: row.game,
      code: row.code,
      name: row.name,
      version: row.version,
      ruleVersionId: rule?.id ?? null,
      configured: !!rule,
      requiredTrips: rule?.requiredTrips ?? null,
      requiredDistanceM: rule?.requiredDistanceM == null ? null : decimal(rule.requiredDistanceM),
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
    const gameLevels = await eligibility.levels(tx, selectedGame);
    if (!gameLevels.some((item) => item.id === assignment.levelId)) throw identityError(404);
    const next = successor(gameLevels, selectedGame, assignment.levelId),
      rule = await ruleAt(tx, assignment.levelId, instant),
      totals = await ports.trips.contributions.totals(tx, assignment.id);
    const requirements = {
      requiredTrips: rule?.requiredTrips ?? null,
      requiredDistanceM: rule?.requiredDistanceM == null ? null : decimal(rule.requiredDistanceM),
    };
    const eligible = promotionEligible(next !== null, rule, totals);
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
  ) {
    const result = await createAssignmentWriter(
      unit,
      outbox,
      at,
      config.eligibilityTrackingSince !== undefined,
    )(tx, actor, {
      userId,
      game: selectedGame,
      levelId,
      purpose,
      assignedAt,
      endedAt,
      reason: text,
    });
    return { data: assignmentDto(result.row), version: result.version };
  }

  async function prepare(tx: TxContext, owners: { ownerId: string; game: Game }[], actor?: Actor) {
    const authority = await ports.identity.qualificationContextInTransaction(
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
    return authority;
  }
  return {
    config,
    nextLevel,
    nextLevelInGame: successor,
    async prepareInTransaction(
      tx: TxContext,
      owners: { ownerId: string; game: Game }[],
      actor?: Actor,
    ) {
      await prepare(tx, owners, actor);
    },
    workspacePromotionsReadyInTransaction: eligibility.ready,
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
          const gameLevels = await eligibility.levels(tx, row.game);
          if (!gameLevels.some((item) => item.id === row.levelId))
            throw new Error("NOTIFICATION_QUALIFICATION_LEVEL_MISSING");
          const next = successor(gameLevels, row.game, row.levelId);
          const rule = await ruleAt(tx, row.levelId, instant);
          if (next && rule)
            eligible = promotionEligible(
              true,
              rule,
              await ports.trips.contributions.totals(tx, row.id, "share"),
            );
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
    async members(actor: Actor, options: Page & { view?: "stage3"; search?: string } = {}) {
      const search = options.search?.trim();
      if (
        options.search !== undefined &&
        (options.view !== "stage3" || !search || options.search.length > 128)
      )
        throw identityError(422);
      return ports.identity.transaction(async (tx) => {
        await ports.identity.qualificationContextInTransaction(tx, [], actor);
        const paging = page(
          actor,
          options.view === "stage3"
            ? ["stage3-qualification-members", search ?? null]
            : ["qualification-members"],
          options,
        );
        return paging.finish(
          await ports.identity.qualificationMembersInTransaction(
            tx,
            paging.after?.id ?? null,
            paging.limit,
            search,
          ),
          (row) => ({ id: row.id, time: null }),
        );
      });
    },
    async promotionCandidates(
      actor: Actor,
      options: Page & { game: Game; status?: "eligible" | "all" },
    ): Promise<S["QualificationStage3PromotionCandidateList"]> {
      game(options.game);
      const status = options.status ?? "eligible";
      if (status !== "eligible" && status !== "all") throw identityError(422);
      return ports.identity.transaction(async (tx) => {
        await ports.identity.qualificationContextInTransaction(tx, [], actor);
        const paging = page(actor, ["promotion-candidates", options.game, status], options);
        const { rows, total } = await eligibility.candidates(
          tx,
          options.game,
          status,
          at(),
          paging.after,
          paging.limit,
        );
        const { items, nextCursor } = paging.finish(rows, (row) => ({
          id: row.id,
          time: row.eligibleSince,
        }));
        return { items: items.map(({ id: _id, ...row }) => row), nextCursor, total };
      });
    },
    async promotionHistory(
      actor: Actor,
      options: Page & CompanyHistoryFilters = {},
    ): Promise<S["QualificationStage3PromotionHistoryList"]> {
      if (options.game !== undefined) game(options.game);
      if (options.memberId !== undefined) applicationId(options.memberId);
      return ports.identity.transaction(async (tx) => {
        await ports.identity.qualificationContextInTransaction(tx, [], actor);
        const paging = page(
          actor,
          ["company-qualification-history", options.game ?? null, options.memberId ?? null],
          options,
        );
        const result = await companyHistory(tx, options, paging.after, paging.limit);
        const { items, nextCursor } = paging.finish(result.actions, ({ id, time, kind }) => ({
          id,
          time,
          kind,
        }));
        return { items: items.map(result.dto), nextCursor, total: result.total };
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
        const paging = page(actor, ["levels", selectedGame], options);
        const rows = await c(tx)
          .select()
          .from(qualificationLevels)
          .where(
            and(
              eq(qualificationLevels.game, selectedGame),
              paging.after ? gt(qualificationLevels.id, paging.after.id) : undefined,
            ),
          )
          .orderBy(asc(qualificationLevels.id))
          .limit(paging.limit + 1);
        return paging.finish(await Promise.all(rows.map((row) => levelDto(tx, row))), (row) => ({
          id: row.id,
          time: null,
        }));
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
        const publishers = staff
          ? await qualificationMembersById(
              ports.identity,
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
          ...(publishers ? { publisher: qualificationActor(publishers, row.actorId) } : {}),
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
      return ports.identity.transaction(async (tx) => {
        await ports.identity.qualificationContextInTransaction(tx, [], actor);
        return ports.identity.externalCommand(
          tx,
          `${actor.userId}:qualification:rename:${levelId}`,
          key,
          { expected, input },
          async () => {
            const row = await level(tx, levelId);
            if (row.version !== expected) throw identityError(409, "VERSION_CONFLICT");
            const next = { ...row, name: input.name, version: row.version + 1 };
            await c(tx)
              .update(qualificationLevels)
              .set({ name: next.name, version: next.version })
              .where(eq(qualificationLevels.id, row.id));
            await recordAudit(tx, actor, levelId, "configuration.changed");
            await emit(tx, "qualification.rules_changed", row.id, next.version, null, null);
            return { data: await levelDto(tx, next), version: next.version };
          },
        );
      });
    },
    async publish(
      actor: Actor,
      levelId: string,
      key: string,
      expected: number,
      input: S["QualificationRulePublicationInput"],
    ) {
      if (input.reason !== undefined) reason(input.reason);
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
        await ports.identity.qualificationContextInTransaction(tx, [], actor);
        return ports.identity.externalCommand(
          tx,
          `${actor.userId}:qualification:publish:${levelId}`,
          key,
          { expected, input },
          async () => {
            const selected = await level(tx, levelId);
            if (selected.version !== expected) throw identityError(409, "VERSION_CONFLICT");
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
            if (effectiveAt === publishedAt)
              await eligibility.applyImmediateRule(tx, selected, effectiveAt, {
                requiredTrips: input.requiredTrips,
                requiredDistanceM: distance,
              });
            await c(tx)
              .insert(qualificationRules)
              .values({
                id: newId(),
                levelId,
                publishedAt,
                effectiveAt,
                rules,
                requiredTrips: input.requiredTrips,
                requiredDistanceM: distance,
                actorId: actor.userId,
                reason: input.reason ?? null,
              });
            await c(tx)
              .update(qualificationLevels)
              .set({ version: selected.version + 1 })
              .where(eq(qualificationLevels.id, levelId));
            await recordAudit(tx, actor, levelId, "configuration.changed");
            await emit(
              tx,
              "qualification.rules_changed",
              levelId,
              selected.version + 1,
              null,
              null,
            );
            return {
              data: await levelDto(tx, { ...selected, version: selected.version + 1 }),
              version: selected.version + 1,
            };
          },
        );
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
        .select()
        .from(qualificationAssignments)
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
      return rows.map((row) => ({ ...assignmentDto(row), endedAt: row.endedAt }));
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
      const locked = await prepare(tx, owners);
      const contexts = await ports.trips.contributions.contexts(tx, changes);
      const changedAt = at();
      const finishEligibility = await eligibility.prepareContributionBatch(
        tx,
        owners.filter(({ ownerId }) => locked.members.get(ownerId)?.status === "active"),
        changedAt,
      );
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
            changedAt,
          )),
        );
      }
      await finishEligibility(new Set(affected));
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
          .select()
          .from(qualificationAssignments)
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
            rows.map((row) => ({ ...assignmentDto(row), endedAt: row.endedAt })),
            (row) => ({ id: row.id, time: row.assignedAt }),
          ),
          version: current.version,
        };
      });
    },
    async actionHistory(
      actor: Actor,
      userId: string,
      selectedGame: Game,
      options: Page & { view?: "stage3" } = {},
    ) {
      game(selectedGame);
      applicationId(userId);
      return ports.identity.transaction(async (tx) => {
        await ports.identity.qualificationContextInTransaction(tx, [userId], actor);
        const stage3 = options.view === "stage3";
        // Staff history is readable for former members or games that have no current assignment.
        const [current] = await c(tx)
          .select({ version: qualificationStates.version })
          .from(qualificationStates)
          .where(
            and(eq(qualificationStates.userId, userId), eq(qualificationStates.game, selectedGame)),
          )
          .for("share");
        const version = current?.version ?? 1;
        const paging = page(
          actor,
          [
            stage3 ? "stage3-staff-action-history" : "staff-action-history",
            userId,
            selectedGame,
            version,
          ],
          options,
        );
        const rows = await c(tx)
          .select()
          .from(qualificationAssignments)
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
        const result = paging.finish(rows, (row) => ({ id: row.id, time: row.assignedAt }));
        const proofs = result.items.length
          ? await c(tx)
              .select({
                id: qualificationPromotions.id,
                targetAssignmentId: qualificationPromotions.targetAssignmentId,
                confirmedAt: qualificationPromotions.confirmedAt,
                actorId: qualificationPromotions.actorId,
                reason: qualificationPromotions.reason,
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
        const byTarget = new Map<string, (typeof proofs)[number]>();
        for (const proof of proofs) {
          if (byTarget.has(proof.targetAssignmentId))
            throw new Error("AMBIGUOUS_QUALIFICATION_PROMOTION");
          byTarget.set(proof.targetAssignmentId, proof);
        }
        const members = await qualificationMembersById(ports.identity, tx, [
          ...result.items.map((row) => row.actorId),
          ...(stage3 ? proofs.map((proof) => proof.actorId) : []),
        ]);
        const items = result.items.map(
          (row): S["QualificationActionHistory"] | S["QualificationStage3ActionHistory"] => {
            const proof = byTarget.get(row.id);
            const common = {
              ...assignmentDto(row),
              endedAt: row.endedAt,
              purpose: row.purpose,
              actor: qualificationActor(members, row.actorId),
            };
            if (!stage3)
              return {
                ...common,
                promotion: proof ? { id: proof.id, confirmedAt: proof.confirmedAt } : null,
              };
            return {
              ...common,
              assignmentReason: row.reason.trim() ? row.reason : null,
              promotion: proof
                ? {
                    id: proof.id,
                    confirmedAt: proof.confirmedAt,
                    actor: qualificationActor(members, proof.actorId),
                    reason: proof.reason.trim() ? proof.reason : null,
                  }
                : null,
            };
          },
        );
        return { data: { ...result, items }, version };
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
            if (target.game !== input.game) throw identityError(422);
            let assignedAt = at(),
              endedAt: string | null = null;
            if (input.purpose === "historical_resolution") {
              if (!input.assignedAt || !input.endedAt) throw identityError(422);
              assignedAt = date(input.assignedAt);
              endedAt = date(input.endedAt);
              if (endedAt <= assignedAt || endedAt > at()) throw identityError(422);
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
                if (history) throw identityError(409);
              }
              if (input.purpose === "administrative_correction" && current.assignmentId) {
                const [old] = await c(tx)
                  .select()
                  .from(qualificationAssignments)
                  .where(eq(qualificationAssignments.id, current.assignmentId));
                if (
                  !old ||
                  levelCodes.indexOf(target.code) >
                    levelCodes.indexOf((await level(tx, old.levelId)).code)
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
            const target = await level(tx, input.targetLevelId);
            if (
              successor(await eligibility.levels(tx, input.game), input.game, source.id)?.id !==
              target.id
            )
              throw identityError(409);
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
            if (source.code === "trainee")
              await ports.identity.completeTraineeInTransaction(tx, actor, userId);
            await emit(
              tx,
              "qualification.promoted",
              result.data.id,
              result.version,
              userId,
              result.data.id,
            );
            return result;
          },
        );
      });
    },
  };
}
export type Qualifications = ReturnType<typeof createQualifications>;
