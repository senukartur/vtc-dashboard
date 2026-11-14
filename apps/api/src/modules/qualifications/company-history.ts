import type { components } from "@vtc/contracts";
import type { TxContext, UnitOfWork } from "@vtc/db";
import {
  alias,
  and,
  desc,
  eq,
  lt,
  ne,
  or,
  qualificationAssignments,
  qualificationLevels,
  qualificationPromotions,
  sql,
} from "@vtc/db/qualifications-schema";
import type { Identity } from "../identity/service.js";
import { canonicalDecimal } from "../qualification-rules/decimal.js";
import { levelSummary } from "./eligibility.js";
import type { Game } from "./initialization.js";
import type { Position } from "./pagination.js";

type S = components["schemas"];
type Kind = S["QualificationStage3CompanyAction"]["kind"];
const sourceAssignment = alias(qualificationAssignments, "source_assignment");
const sourceLevel = alias(qualificationLevels, "source_level");

export async function qualificationMembersById(
  identity: Pick<Identity, "memberSummariesInTransaction">,
  tx: TxContext,
  ids: (string | null)[],
) {
  const unique = [...new Set(ids.filter((id): id is string => id !== null))].sort();
  const members = new Map<string, S["MemberSummary"]>();
  for (let offset = 0; offset < unique.length; offset += 100) {
    const batch = await identity.memberSummariesInTransaction(
      tx,
      unique.slice(offset, offset + 100),
    );
    for (const [id, member] of batch) members.set(id, member);
  }
  return members;
}

export function qualificationActor(members: Map<string, S["MemberSummary"]>, id: string | null) {
  return id === null ? null : { id, nickname: members.get(id)?.nickname ?? null };
}

export interface CompanyHistoryFilters {
  game?: Game;
  memberId?: string;
}

export function createCompanyHistory(
  unit: UnitOfWork,
  identity: Pick<Identity, "memberSummariesInTransaction">,
) {
  return async (
    tx: TxContext,
    filters: CompanyHistoryFilters,
    after: Position | null,
    limit: number,
  ) => {
    const c = unit.client(tx);
    const common = and(
      filters.game ? eq(qualificationAssignments.game, filters.game) : undefined,
      filters.memberId ? eq(qualificationAssignments.userId, filters.memberId) : undefined,
    );
    const ordinary = and(common, ne(qualificationAssignments.purpose, "promotion"));
    const target = and(
      eq(qualificationPromotions.targetAssignmentId, qualificationAssignments.id),
      eq(qualificationAssignments.purpose, "promotion"),
    );
    const totals = {
      total: sql<string | number>`COUNT(*)`,
    };
    // The Identity company fence spans counts and both keysets.
    const [ordinaryTotal] = await c
      .select(totals)
      .from(qualificationAssignments)
      .where(ordinary)
      .for("share");
    const [promotionTotal] = await c
      .select(totals)
      .from(qualificationPromotions)
      .innerJoin(qualificationAssignments, target)
      .where(common)
      .for("share");

    const ordinaryRows = await c
      .select({ row: qualificationAssignments, level: qualificationLevels })
      .from(qualificationAssignments)
      .innerJoin(qualificationLevels, eq(qualificationLevels.id, qualificationAssignments.levelId))
      .where(
        and(
          ordinary,
          afterAction(
            "assignment",
            qualificationAssignments.assignedAt,
            qualificationAssignments.id,
            after,
          ),
        ),
      )
      .orderBy(desc(qualificationAssignments.assignedAt), desc(qualificationAssignments.id))
      .limit(limit + 1)
      .for("share");
    const promotionRows = await c
      .select({
        proof: qualificationPromotions,
        memberId: qualificationAssignments.userId,
        game: qualificationAssignments.game,
        sourceLevel,
        targetLevel: qualificationLevels,
      })
      .from(qualificationPromotions)
      .innerJoin(qualificationAssignments, target)
      .innerJoin(qualificationLevels, eq(qualificationLevels.id, qualificationAssignments.levelId))
      .innerJoin(
        sourceAssignment,
        eq(sourceAssignment.id, qualificationPromotions.sourceAssignmentId),
      )
      .innerJoin(sourceLevel, eq(sourceLevel.id, sourceAssignment.levelId))
      .where(
        and(
          common,
          afterAction(
            "promotion",
            qualificationPromotions.confirmedAt,
            qualificationPromotions.id,
            after,
          ),
        ),
      )
      .orderBy(desc(qualificationPromotions.confirmedAt), desc(qualificationPromotions.id))
      .limit(limit + 1)
      .for("share");
    const actions = [
      ...ordinaryRows.map(({ row, level }) => ({
        id: row.id,
        time: row.assignedAt,
        kind: "assignment" as const,
        memberId: row.userId,
        actorId: row.actorId,
        row,
        level,
      })),
      ...promotionRows.map(({ proof, ...row }) => ({
        id: proof.id,
        time: proof.confirmedAt,
        kind: "promotion" as const,
        actorId: proof.actorId,
        proof,
        ...row,
      })),
    ]
      .sort(compareActions)
      .slice(0, limit + 1);

    const members = await qualificationMembersById(
      identity,
      tx,
      actions.slice(0, limit).flatMap(({ memberId, actorId }) => [memberId, actorId]),
    );
    return {
      total: Number(ordinaryTotal?.total ?? 0) + Number(promotionTotal?.total ?? 0),
      actions,
      dto(action: (typeof actions)[number]): S["QualificationStage3CompanyAction"] {
        const member = members.get(action.memberId);
        if (!member) throw new Error("QUALIFICATION_ACTION_MEMBER_MISSING");
        const actor = qualificationActor(members, action.actorId);
        if (action.kind === "promotion") {
          const { proof } = action;
          return {
            kind: action.kind,
            id: proof.id,
            game: action.game,
            actor,
            member,
            confirmedAt: proof.confirmedAt,
            sourceAssignmentId: proof.sourceAssignmentId,
            sourceLevel: levelSummary(action.sourceLevel),
            targetAssignmentId: proof.targetAssignmentId,
            targetLevel: levelSummary(action.targetLevel),
            requiredTrips: proof.requiredTrips,
            requiredDistanceM:
              proof.requiredDistanceM === null ? null : canonicalDecimal(proof.requiredDistanceM),
            acceptedTrips: proof.acceptedTrips,
            actualDistanceM: canonicalDecimal(proof.actualDistanceM),
            reason: proof.reason.trim() ? proof.reason : null,
          };
        }
        const { row } = action;
        if (row.purpose === "promotion") throw new Error("UNEXPECTED_PROMOTION_ASSIGNMENT");
        return {
          kind: action.kind,
          id: row.id,
          assignmentId: row.id,
          game: row.game,
          actor,
          member,
          assignedAt: row.assignedAt,
          endedAt: row.endedAt,
          level: levelSummary(action.level),
          purpose: row.purpose,
          reason: row.reason.trim() ? row.reason : null,
        };
      },
    };
  };
}

function afterAction(
  kind: Kind,
  time: typeof qualificationAssignments.assignedAt | typeof qualificationPromotions.confirmedAt,
  id: typeof qualificationAssignments.id | typeof qualificationPromotions.id,
  after: Position | null,
): ReturnType<typeof sql> | undefined {
  if (!after?.time || !after.kind) return undefined;
  return or(
    lt(time, after.time),
    and(eq(time, after.time), lt(id, after.id)),
    kind > after.kind ? and(eq(time, after.time), eq(id, after.id)) : undefined,
  );
}

function compareActions(a: { id: string; time: string; kind: Kind }, b: typeof a) {
  if (a.time !== b.time) return a.time > b.time ? -1 : 1;
  if (a.id !== b.id) return a.id > b.id ? -1 : 1;
  return a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
}
