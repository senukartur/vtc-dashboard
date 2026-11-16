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
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  maxQualificationLevels,
  or,
  qualificationAssignments,
  qualificationLevels,
  qualificationLevelTrailers,
  sql,
} from "@vtc/db/qualifications-schema";
import { closed, createOutbox } from "../../platform/outbox/events.js";
import type { Catalogs } from "../catalogs/service.js";
import { type Actor, type Identity, identityError } from "../identity/service.js";
import { decimal } from "../sources/contracts/canonical.js";
import { compareDecimal } from "../sources/contracts/decimal.js";
import type { AdrClass, NormalizedTripEvidence } from "../sources/contracts/evidence.js";
import type { ContributionChange } from "../trips/contributions.js";
import type { Trips } from "../trips/service.js";
import {
  ATTRIBUTION_UNKNOWN,
  adrClasses,
  type CheckedRule,
  NO_LEVEL,
  type QualificationConditions,
  type QualificationLimits,
  type QualificationSnapshot,
} from "./check.js";
import {
  type ActiveLevel,
  activeLevels,
  conditionsOf,
  type Game,
  type LevelRow,
  levelTrailers,
  limitsOf,
} from "./ladder.js";
import { type Assignment, createAssignments } from "./promotion.js";

type S = components["schemas"];
type Locale = "en" | "ru";
// Qualifications needs no settings of its own; its presence enables the module.
export type QualificationsConfig = Record<string, never>;
export function validateQualificationsConfig(config: QualificationsConfig) {
  if (!config || typeof config !== "object" || Object.keys(config).length)
    throw new Error("INVALID_QUALIFICATIONS_CONFIG");
}
interface Ports {
  identity: Pick<
    Identity,
    | "transaction"
    | "qualificationContextInTransaction"
    | "completeTraineeAsSystemInTransaction"
    | "memberSummariesInTransaction"
    | "authorizeInTransaction"
  >;
  trips: Pick<Trips, "contributions">;
  catalogs?: Pick<Catalogs, "selectionsInTransaction" | "labelsInTransaction">;
  events?: Pick<ReturnType<typeof createOutbox>, "append">;
}
const MAX_DRIVERS = 1000;
const LEVEL_OPERATIONS = {
  "qualification.level_created": "created",
  "qualification.level_edited": "edited",
  "qualification.level_moved": "moved",
  "qualification.level_removed": "removed",
} as const;
type LevelChange = "name" | "limits" | "conditions" | "position";

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
    assignments = createAssignments(
      unit,
      {
        identity: ports.identity,
        totals: ports.trips.contributions,
        events: outbox,
      },
      at,
    );
  function game(value: string): asserts value is Game {
    if (!["ets2", "ats"].includes(value)) throw identityError(422);
  }
  function id(value: string) {
    try {
      return applicationId(value);
    } catch {
      throw identityError(422);
    }
  }
  function date(value: string) {
    try {
      return utcIso(utcDateTime(value));
    } catch {
      throw identityError(422);
    }
  }
  function amount(value: string | null, positive: boolean) {
    if (value === null) return null;
    let exact: string;
    try {
      exact = decimal(decimal38_18(value));
    } catch {
      throw identityError(422);
    }
    if (positive && compareDecimal(exact, "0") <= 0) throw identityError(422);
    return exact;
  }
  function text(value: string, max: number) {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (!trimmed || [...trimmed].length > max) throw identityError(422);
    return trimmed;
  }
  async function locale(tx: TxContext, actor: Actor): Promise<Locale> {
    const current = await ports.identity.authorizeInTransaction(tx, actor, "company.read");
    return current.locale === "ru" ? "ru" : "en";
  }
  async function trailerLabels(tx: TxContext, ids: readonly string[], language: Locale) {
    if (!ids.length || !ports.catalogs) return new Map<string, S["CatalogLabel"]>();
    return ports.catalogs.labelsInTransaction(
      tx,
      [...new Set(ids)].map((value) => ({ kind: "trailer" as const, id: value })),
      language,
    );
  }
  const labelsOf = (labels: Map<string, S["CatalogLabel"]>, ids: readonly string[]) =>
    ids.flatMap((value) => {
      const label = labels.get(value);
      return label ? [label] : [];
    });
  async function limitsDto(
    tx: TxContext,
    limits: QualificationLimits,
    language: Locale,
  ): Promise<S["QualificationLimits"]> {
    const labels = await trailerLabels(tx, limits.trailers.typeIds, language);
    return {
      massMinKg: limits.massMinKg,
      massMaxKg: limits.massMaxKg,
      distanceMinM: limits.distanceMinM,
      distanceMaxM: limits.distanceMaxM,
      trailers: { mode: limits.trailers.mode, types: labelsOf(labels, limits.trailers.typeIds) },
      adr: { mode: limits.adr.mode, classes: [...limits.adr.classes] },
      hardModeRequired: limits.hardModeRequired,
    };
  }
  async function driverCounts(tx: TxContext, levelIds: string[]) {
    const counts = new Map<string, number>();
    if (!levelIds.length) return counts;
    const rows = await c(tx)
      .select({ levelId: qualificationAssignments.levelId, count: sql<number | string>`COUNT(*)` })
      .from(qualificationAssignments)
      .where(
        and(
          inArray(qualificationAssignments.levelId, levelIds),
          isNull(qualificationAssignments.endedAt),
        ),
      )
      .groupBy(qualificationAssignments.levelId);
    for (const row of rows) counts.set(row.levelId, Number(row.count));
    return counts;
  }
  async function summaries(
    tx: TxContext,
    ladder: ActiveLevel[],
    language: Locale,
  ): Promise<S["QualificationLevelSummary"][]> {
    const ids = ladder.map((row) => row.id);
    const [trailers, counts] = [await levelTrailers(unit, tx, ids), await driverCounts(tx, ids)];
    const result: S["QualificationLevelSummary"][] = [];
    for (const [index, row] of ladder.entries()) {
      const next = ladder[index + 1];
      result.push({
        id: row.id,
        game: row.game,
        name: row.name,
        position: row.position,
        version: row.version,
        limits: await limitsDto(tx, limitsOf(row, trailers.get(row.id) ?? []), language),
        conditions: conditionsOf(row),
        nextLevel: next ? { id: next.id, name: next.name } : null,
        driverCount: counts.get(row.id) ?? 0,
      });
    }
    return result;
  }
  async function totals(tx: TxContext, ids: string[]) {
    const result = new Map<string, { trips: number; distanceM: string }>();
    for (let offset = 0; offset < ids.length; offset += 100) {
      const found = await ports.trips.contributions.totalsByAssignment(
        tx,
        ids.slice(offset, offset + 100),
        "share",
      );
      for (const [key, value] of found)
        result.set(key, { trips: value.completedTrips, distanceM: value.completedDistanceM });
    }
    return (key: string) => result.get(key) ?? { trips: 0, distanceM: "0" };
  }
  async function mine(
    tx: TxContext,
    userId: string,
    selected: Game,
    ladder?: ActiveLevel[],
  ): Promise<S["MyQualification"]> {
    const [current] = await c(tx)
      .select()
      .from(qualificationAssignments)
      .where(
        and(
          eq(qualificationAssignments.userId, userId),
          eq(qualificationAssignments.game, selected),
          isNull(qualificationAssignments.endedAt),
        ),
      )
      .for("share");
    const levels = ladder ?? (await activeLevels(unit, tx, selected));
    const index = current ? levels.findIndex((row) => row.id === current.levelId) : -1;
    const level = levels[index];
    if (!current || !level)
      return {
        game: selected,
        level: null,
        since: null,
        progress: { trips: 0, distanceM: "0" },
        conditions: null,
        nextLevel: null,
      };
    const next = levels[index + 1];
    return {
      game: selected,
      level: { id: level.id, name: level.name, position: level.position },
      since: current.assignedAt,
      progress: (await totals(tx, [current.id]))(current.id),
      conditions: conditionsOf(level),
      nextLevel: next ? { id: next.id, name: next.name } : null,
    };
  }
  async function memberNames(tx: TxContext, ids: string[]) {
    const unique = [...new Set(ids)].sort();
    const names = new Map<string, string>();
    for (let offset = 0; offset < unique.length; offset += 100) {
      const members = await ports.identity.memberSummariesInTransaction(
        tx,
        unique.slice(offset, offset + 100),
      );
      for (const [key, member] of members) names.set(key, member.nickname);
    }
    return names;
  }
  async function history(tx: TxContext, levelId: string) {
    const rows = await audit.subjectHistory(tx, {
      subjectKind: "qualification_level",
      subjectId: levelId,
      limit: 50,
    });
    const contexts = rows.map((row) =>
      "context" in row && row.context && "changes" in row.context ? row.context : null,
    );
    const transferIds = [
      ...new Set(
        contexts.flatMap((context) => (context?.transferLevelId ? [context.transferLevelId] : [])),
      ),
    ];
    const transfers = transferIds.length
      ? await c(tx)
          .select({ id: qualificationLevels.id, name: qualificationLevels.name })
          .from(qualificationLevels)
          .where(inArray(qualificationLevels.id, transferIds))
      : [];
    const names = await memberNames(
      tx,
      rows.flatMap((row) => (row.actorId ? [row.actorId] : [])),
    );
    return rows.map((row, index): S["QualificationLevelHistoryEntry"] => {
      const context = contexts[index];
      const operation =
        context && row.action in LEVEL_OPERATIONS
          ? LEVEL_OPERATIONS[row.action as keyof typeof LEVEL_OPERATIONS]
          : "legacy";
      const transfer = transfers.find((level) => level.id === context?.transferLevelId);
      const name = row.actorId ? names.get(row.actorId) : undefined;
      return {
        at: row.occurredAt,
        actor: row.actorId && name ? { id: row.actorId, displayName: name } : null,
        operation,
        changes: context?.changes ?? [],
        position: context?.position ?? null,
        transferLevel: transfer ? { id: transfer.id, name: transfer.name } : null,
      };
    });
  }
  async function detail(
    tx: TxContext,
    actor: Actor,
    levelId: string,
    canManage: boolean,
  ): Promise<S["QualificationLevelDetail"]> {
    const [found] = await c(tx)
      .select({ game: qualificationLevels.game })
      .from(qualificationLevels)
      .where(and(eq(qualificationLevels.id, levelId), isNotNull(qualificationLevels.position)))
      .for("share");
    if (!found) throw identityError(404);
    const ladder = await activeLevels(unit, tx, found.game);
    const language = await locale(tx, actor);
    const summary = (await summaries(tx, ladder, language)).find((row) => row.id === levelId);
    if (!summary) throw identityError(404);
    const open = await c(tx)
      .select()
      .from(qualificationAssignments)
      .where(
        and(
          eq(qualificationAssignments.levelId, levelId),
          isNull(qualificationAssignments.endedAt),
        ),
      )
      .orderBy(qualificationAssignments.assignedAt, qualificationAssignments.id)
      .limit(MAX_DRIVERS)
      .for("share");
    const credited = await totals(
      tx,
      open.map((row) => row.id),
    );
    const names = await memberNames(
      tx,
      open.map((row) => row.userId),
    );
    return {
      ...summary,
      levelCount: ladder.length,
      canManage,
      mine: await mine(tx, actor.userId, found.game, ladder),
      drivers: open.map((row) => ({
        memberId: row.userId,
        displayName: names.get(row.userId) ?? "Former member",
        since: row.assignedAt,
        credited: credited(row.id),
      })),
      history: canManage ? await history(tx, levelId) : null,
    };
  }
  async function readContext(tx: TxContext, actor: Actor, targets: string[] = []) {
    const authority = await ports.identity.qualificationContextInTransaction(
      tx,
      targets,
      actor,
      "company.read",
    );
    return { ...authority, canManage: actor.capabilities.includes("qualifications.manage") };
  }
  async function writeContext(tx: TxContext, actor: Actor, targets: string[] = []) {
    return ports.identity.qualificationContextInTransaction(
      tx,
      targets,
      actor,
      "qualifications.manage",
    );
  }
  // Validates a level command against the catalog; selected modes need at least one item.
  async function validLimits(
    tx: TxContext,
    selected: Game,
    input: S["QualificationLimitsInput"],
  ): Promise<QualificationLimits> {
    const limits = closed(input, [
      "massMinKg",
      "massMaxKg",
      "distanceMinM",
      "distanceMaxM",
      "trailers",
      "adr",
      "hardModeRequired",
    ]) as unknown as S["QualificationLimitsInput"];
    const massMinKg = amount(limits.massMinKg, false),
      massMaxKg = amount(limits.massMaxKg, true),
      distanceMinM = amount(limits.distanceMinM, false),
      distanceMaxM = amount(limits.distanceMaxM, true);
    for (const [min, max] of [
      [massMinKg, massMaxKg],
      [distanceMinM, distanceMaxM],
    ] as const)
      if (min !== null && max !== null && compareDecimal(min, max) > 0) throw identityError(422);
    const typeIds = [...new Set(limits.trailers.typeIds.map(id))].sort();
    if (
      typeIds.length !== limits.trailers.typeIds.length ||
      (limits.trailers.mode === "selected") !== typeIds.length > 0 ||
      typeIds.length > 100
    )
      throw identityError(422);
    if (typeIds.length) {
      if (!ports.catalogs) throw identityError(503);
      const found = await ports.catalogs.selectionsInTransaction(
        tx,
        typeIds.map((value) => ({ kind: "trailer" as const, id: value })),
      );
      if (
        typeIds.some((value) => {
          const entity = found.get(value);
          return entity?.kind !== "trailer" || entity.game !== selected;
        })
      )
        throw identityError(422);
    }
    const classes = [...new Set(limits.adr.classes)].sort() as AdrClass[];
    if (
      classes.length !== limits.adr.classes.length ||
      classes.some((value) => !(adrClasses as readonly string[]).includes(value)) ||
      (limits.adr.mode === "selected") !== classes.length > 0
    )
      throw identityError(422);
    if (typeof limits.hardModeRequired !== "boolean") throw identityError(422);
    return {
      massMinKg,
      massMaxKg,
      distanceMinM,
      distanceMaxM,
      trailers: { mode: limits.trailers.mode, typeIds },
      adr: { mode: limits.adr.mode, classes },
      hardModeRequired: limits.hardModeRequired,
    };
  }
  function validConditions(input: S["QualificationConditions"], top: boolean) {
    const requiredTrips = input.requiredTrips;
    if (
      requiredTrips !== null &&
      (!Number.isInteger(requiredTrips) || requiredTrips < 1 || requiredTrips > 4294967295)
    )
      throw identityError(422);
    const conditions: QualificationConditions = {
      requiredTrips,
      requiredDistanceM: amount(input.requiredDistanceM, true),
    };
    if (!top && conditions.requiredTrips === null && conditions.requiredDistanceM === null)
      throw identityError(422, "QUALIFICATION_CONDITIONS_REQUIRED");
    return conditions;
  }
  const levelValues = (limits: QualificationLimits, conditions: QualificationConditions) => ({
    massMinKg: limits.massMinKg,
    massMaxKg: limits.massMaxKg,
    distanceMinM: limits.distanceMinM,
    distanceMaxM: limits.distanceMaxM,
    trailerMode: limits.trailers.mode,
    adrMode: limits.adr.mode,
    adrClasses: limits.adr.mode === "selected" ? [...limits.adr.classes] : null,
    hardModeRequired: limits.hardModeRequired,
    requiredTrips: conditions.requiredTrips,
    requiredDistanceM: conditions.requiredDistanceM,
  });
  async function writeTrailers(tx: TxContext, level: { id: string; game: Game }, ids: string[]) {
    await c(tx)
      .delete(qualificationLevelTrailers)
      .where(eq(qualificationLevelTrailers.levelId, level.id));
    if (ids.length)
      await c(tx)
        .insert(qualificationLevelTrailers)
        .values(ids.map((trailerId) => ({ levelId: level.id, game: level.game, trailerId })));
  }
  // Positions are unique per game: shift rows one at a time in an order that never collides.
  async function shift(tx: TxContext, rows: ActiveLevel[], delta: 1 | -1) {
    const ordered = [...rows].sort((a, b) => (b.position - a.position) * delta);
    for (const row of ordered)
      await c(tx)
        .update(qualificationLevels)
        .set({ position: row.position + delta, version: row.version + 1 })
        .where(eq(qualificationLevels.id, row.id));
  }
  async function levelAudit(
    tx: TxContext,
    actor: Actor,
    companyId: string,
    operation: keyof typeof LEVEL_OPERATIONS,
    level: { id: string; game: Game; name: string },
    position: number | null,
    changes: LevelChange[],
    transferLevelId: string | null = null,
    occurredAt = at(),
  ) {
    await audit.append(tx, {
      actorKind: "user",
      actorId: actor.userId,
      reason: "operator_request",
      occurredAt,
      companyId,
      operation,
      subjectKind: "qualification_level",
      subjectId: level.id,
      details: { game: level.game, name: level.name, position, changes, transferLevelId },
    });
  }
  async function lockedLadder(tx: TxContext, levelId: string, expectedVersion?: number) {
    const [found] = await c(tx)
      .select({ game: qualificationLevels.game })
      .from(qualificationLevels)
      .where(eq(qualificationLevels.id, id(levelId)))
      .for("update");
    if (!found) throw identityError(404);
    const ladder = await activeLevels(unit, tx, found.game, "update");
    const level = ladder.find((row) => row.id === levelId);
    if (!level) throw identityError(404);
    if (expectedVersion !== undefined && level.version !== expectedVersion)
      throw identityError(409, "VERSION_CONFLICT");
    return { ladder, level };
  }
  function same(a: unknown, b: unknown) {
    return JSON.stringify(a) === JSON.stringify(b);
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
        reasonCode: ATTRIBUTION_UNKNOWN,
        attributionBasis: basis,
        attributionAt: null,
      };
    const rows = await c(tx)
      .select()
      .from(qualificationAssignments)
      .where(
        and(
          eq(qualificationAssignments.userId, evidence.ownerUserId),
          eq(qualificationAssignments.game, evidence.game),
          lte(qualificationAssignments.assignedAt, instant),
          or(
            isNull(qualificationAssignments.endedAt),
            gt(qualificationAssignments.endedAt, instant),
          ),
        ),
      )
      .limit(2)
      .for("share");
    const assignment = rows.length === 1 ? rows[0] : undefined;
    const [level] = assignment
      ? await c(tx)
          .select()
          .from(qualificationLevels)
          .where(eq(qualificationLevels.id, assignment.levelId))
          .for("share")
      : [];
    if (!assignment || !level)
      return {
        status: "unresolved" as const,
        reasonCode: NO_LEVEL,
        attributionBasis: basis,
        attributionAt: instant,
      };
    const trailers = await levelTrailers(unit, tx, [level.id]);
    return {
      status: "resolved" as const,
      assignmentId: assignment.id,
      levelId: level.id,
      levelName: level.name,
      editVersion: level.version,
      limits: limitsOf(level, trailers.get(level.id) ?? []),
      attributionBasis: basis,
      attributionAt: instant,
    };
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
    for (const row of unique) await assignments.openFor(tx, row.ownerId, row.game);
    return authority;
  }
  function ruleDto(
    rule: CheckedRule,
    labels: Map<string, S["CatalogLabel"]>,
  ): S["QualificationRuleCheck"] {
    if (rule.rule !== "trailer_types") return rule;
    return {
      rule: rule.rule,
      result: rule.result,
      mode: rule.mode,
      allowed: labelsOf(labels, rule.allowedIds).slice(0, 100),
      observed: labelsOf(labels, rule.observedIds).slice(0, 10),
    };
  }
  return {
    config,
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
    async list(actor: Actor, selected: Game): Promise<S["QualificationLevelList"]> {
      game(selected);
      return ports.identity.transaction(async (tx) => {
        const { canManage } = await readContext(tx, actor);
        const ladder = await activeLevels(unit, tx, selected);
        return {
          game: selected,
          canManage,
          levels: await summaries(tx, ladder, await locale(tx, actor)),
          mine: await mine(tx, actor.userId, selected, ladder),
        };
      });
    },
    async detail(actor: Actor, levelId: string) {
      const selected = id(levelId);
      return ports.identity.transaction(async (tx) => {
        const { canManage } = await readContext(tx, actor);
        return detail(tx, actor, selected, canManage);
      });
    },
    async memberQualifications(actor: Actor, memberId: string): Promise<S["MyQualificationList"]> {
      const target = id(memberId);
      return ports.identity.transaction(async (tx) => {
        await readContext(tx, actor, target === actor.userId ? [] : [target]);
        const items: S["MyQualification"][] = [];
        for (const selected of ["ets2", "ats"] as const) {
          const item = await mine(tx, target, selected);
          if (item.level) items.push(item);
        }
        return { items };
      });
    },
    async create(actor: Actor, input: S["QualificationLevelCreateInput"]) {
      game(input.game);
      const name = text(input.name, 128);
      return ports.identity.transaction(async (tx) => {
        const { companyId } = await writeContext(tx, actor);
        const ladder = await activeLevels(unit, tx, input.game, "update");
        if (ladder.length >= maxQualificationLevels) throw identityError(409);
        if (
          !Number.isInteger(input.position) ||
          input.position < 1 ||
          input.position > ladder.length + 1
        )
          throw identityError(422);
        const limits = await validLimits(tx, input.game, input.limits);
        const conditions = validConditions(input.conditions, input.position === ladder.length + 1);
        await shift(
          tx,
          ladder.filter((row) => row.position >= input.position),
          1,
        );
        const level = { id: newId(), game: input.game, name };
        await c(tx)
          .insert(qualificationLevels)
          .values({
            ...level,
            version: 1,
            position: input.position,
            ...levelValues(limits, conditions),
          });
        await writeTrailers(tx, level, limits.trailers.typeIds as string[]);
        await levelAudit(
          tx,
          actor,
          companyId,
          "qualification.level_created",
          level,
          input.position,
          [],
        );
        const promotedCount = await assignments.recheckGameInTransaction(tx, input.game, companyId);
        return { level: await detail(tx, actor, level.id, true), promotedCount };
      });
    },
    async update(actor: Actor, levelId: string, input: S["QualificationLevelUpdateInput"]) {
      const name = text(input.name, 128);
      return ports.identity.transaction(async (tx) => {
        const { companyId } = await writeContext(tx, actor);
        const { ladder, level } = await lockedLadder(tx, levelId, input.expectedVersion);
        const limits = await validLimits(tx, level.game, input.limits);
        const conditions = validConditions(input.conditions, level.position === ladder.length);
        const before = limitsOf(
          level,
          (await levelTrailers(unit, tx, [level.id])).get(level.id) ?? [],
        );
        const changes: LevelChange[] = [
          ...(name !== level.name ? (["name"] as const) : []),
          ...(!same(before, limits) ? (["limits"] as const) : []),
          ...(!same(conditionsOf(level), conditions) ? (["conditions"] as const) : []),
        ];
        await c(tx)
          .update(qualificationLevels)
          .set({ name, version: level.version + 1, ...levelValues(limits, conditions) })
          .where(eq(qualificationLevels.id, level.id));
        await writeTrailers(tx, level, limits.trailers.typeIds as string[]);
        await levelAudit(
          tx,
          actor,
          companyId,
          "qualification.level_edited",
          { ...level, name },
          level.position,
          changes,
        );
        const promotedCount = await assignments.recheckGameInTransaction(tx, level.game, companyId);
        return { level: await detail(tx, actor, level.id, true), promotedCount };
      });
    },
    async move(actor: Actor, levelId: string, input: S["QualificationLevelMoveInput"]) {
      return ports.identity.transaction(async (tx) => {
        const { companyId } = await writeContext(tx, actor);
        const { ladder, level } = await lockedLadder(tx, levelId, input.expectedVersion);
        if (
          !Number.isInteger(input.position) ||
          input.position < 1 ||
          input.position > ladder.length
        )
          throw identityError(422);
        if (input.position !== level.position) {
          const instant = at();
          // Park the moved level outside the ladder, shift the rest, then place it.
          await c(tx)
            .update(qualificationLevels)
            .set({ position: null, deletedAt: instant })
            .where(eq(qualificationLevels.id, level.id));
          const down = input.position > level.position;
          await shift(
            tx,
            ladder.filter((row) =>
              down
                ? row.position > level.position && row.position <= input.position
                : row.position >= input.position && row.position < level.position,
            ),
            down ? -1 : 1,
          );
          await c(tx)
            .update(qualificationLevels)
            .set({ position: input.position, deletedAt: null, version: level.version + 1 })
            .where(eq(qualificationLevels.id, level.id));
          await levelAudit(
            tx,
            actor,
            companyId,
            "qualification.level_moved",
            level,
            input.position,
            ["position"],
            null,
            instant,
          );
        }
        const promotedCount = await assignments.recheckGameInTransaction(tx, level.game, companyId);
        return { level: await detail(tx, actor, level.id, true), promotedCount };
      });
    },
    async remove(actor: Actor, levelId: string, input: S["QualificationLevelRemovalInput"]) {
      const transferId = id(input.transferLevelId);
      return ports.identity.transaction(async (tx) => {
        const { companyId } = await writeContext(tx, actor);
        const { ladder, level } = await lockedLadder(tx, levelId, input.expectedVersion);
        const target = ladder.find((row) => row.id === transferId);
        if (!target || target.id === level.id) throw identityError(422);
        const instant = at();
        for (const row of await assignments.openOnLevelsInTransaction(tx, [level.id]))
          await assignments.assign(tx, {
            userId: row.userId,
            game: row.game,
            levelId: target.id,
            kind: "level_removed",
            actorId: actor.userId,
            comment: null,
            companyId,
            at: instant,
            previous: row,
          });
        await c(tx)
          .update(qualificationLevels)
          .set({ position: null, deletedAt: instant, version: level.version + 1 })
          .where(eq(qualificationLevels.id, level.id));
        await shift(
          tx,
          ladder.filter((row) => row.position > level.position),
          -1,
        );
        await levelAudit(
          tx,
          actor,
          companyId,
          "qualification.level_removed",
          level,
          null,
          [],
          target.id,
          instant,
        );
        const promotedCount = await assignments.recheckGameInTransaction(tx, level.game, companyId);
        return { transferLevel: await detail(tx, actor, target.id, true), promotedCount };
      });
    },
    async changeMember(
      actor: Actor,
      memberId: string,
      selected: Game,
      input: S["QualificationManualChangeInput"],
    ) {
      game(selected);
      const target = id(memberId),
        levelId = id(input.levelId),
        comment = text(input.reason, 2048);
      return ports.identity.transaction(async (tx) => {
        const authority = await writeContext(tx, actor, [target]);
        if (authority.members.get(target)?.status !== "active") throw identityError(409);
        const ladder = await activeLevels(unit, tx, selected);
        if (!ladder.some((row) => row.id === levelId)) throw identityError(422);
        const current = await assignments.openFor(tx, target, selected);
        if (current?.levelId === levelId) throw identityError(409);
        await assignments.assign(tx, {
          userId: target,
          game: selected,
          levelId,
          kind: "manual",
          actorId: actor.userId,
          comment,
          companyId: authority.companyId,
          previous: current ?? null,
        });
        return { qualification: await mine(tx, target, selected) };
      });
    },
    lookupInTransaction: lookup,
    async prepareInTransaction(
      tx: TxContext,
      owners: { ownerId: string; game: Game }[],
      actor?: Actor,
    ) {
      await prepare(tx, owners, actor);
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
      const authority = await prepare(tx, owners);
      const contexts = await ports.trips.contributions.contexts(tx, changes);
      const changedAt = at();
      const affected: string[] = [];
      for (const context of contexts) {
        const resolved = await lookup(tx, context.evidence, context.change.manualConfirmedAt);
        affected.push(
          ...(await ports.trips.contributions.replace(
            tx,
            context,
            {
              assignmentId: resolved.status === "resolved" ? resolved.assignmentId : null,
              attributionAt: resolved.attributionAt,
              attributionBasis: resolved.attributionBasis,
            },
            changedAt,
          )),
        );
      }
      // The completing credit promotes in this transaction. A revoked trip never demotes.
      const promotedCount = await assignments.promoteInTransaction(
        tx,
        affected,
        authority.companyId,
      );
      return { affectedPeriods: [...new Set(affected)], promotedCount };
    },
    async notificationAssignmentInTransaction(tx: TxContext, assignmentId: string) {
      const [row] = await c(tx)
        .select({
          id: qualificationAssignments.id,
          userId: qualificationAssignments.userId,
          game: qualificationAssignments.game,
          kind: qualificationAssignments.kind,
          endedAt: qualificationAssignments.endedAt,
          assignedAt: qualificationAssignments.assignedAt,
          levelId: qualificationAssignments.levelId,
        })
        .from(qualificationAssignments)
        .where(eq(qualificationAssignments.id, applicationId(assignmentId)))
        .for("share");
      if (!row) throw new Error("NOTIFICATION_ASSIGNMENT_MISSING");
      return row;
    },
    /** Contract view of a stored or live check, with trailer labels in the viewer locale. */
    async checkViewInTransaction(
      tx: TxContext,
      actor: Actor,
      snapshot: QualificationSnapshot,
      basis: "decision" | "current",
    ): Promise<S["QualificationCheck"]> {
      const trailerIds = snapshot.rules.flatMap((rule) =>
        rule.rule === "trailer_types" ? [...rule.allowedIds, ...rule.observedIds] : [],
      );
      const labels = await trailerLabels(tx, trailerIds.slice(0, 300), await locale(tx, actor));
      return {
        status: snapshot.eventExempt ? "event_exempt" : snapshot.levelId ? "checked" : "no_level",
        basis,
        level:
          snapshot.levelId && snapshot.levelName
            ? { id: snapshot.levelId, name: snapshot.levelName }
            : null,
        outcome: snapshot.outcome,
        reasonCode: snapshot.reasonCode,
        rules: snapshot.rules.map((rule) => ruleDto(rule, labels)),
      };
    },
  };
}
export type Qualifications = ReturnType<typeof createQualifications>;
export type { Assignment };
