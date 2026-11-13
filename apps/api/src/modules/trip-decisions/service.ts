import { createHmac } from "node:crypto";
import type { components } from "@vtc/contracts";
import { applicationId, createAudit, newId, type TxContext, type UnitOfWork } from "@vtc/db";
import {
  and,
  desc,
  eq,
  inArray,
  lt,
  or,
  sql,
  tripDecisionCatchup,
  tripDecisionCommands,
  tripDecisions,
  tripEventAssociations,
  tripProposalReviews,
  tripProposals,
  tripReviewWork,
} from "@vtc/db/trip-decisions-schema";
import { createSchemaValidator } from "../../platform/http/schemas.js";
import {
  createQueue,
  type Handler,
  RetryableJobError,
  retryTransaction,
} from "../../platform/jobs/queue.js";
import { closed, createOutbox } from "../../platform/outbox/events.js";
import { tripDecisionCoordinator } from "../../use-cases/trip-decisions.js";
import type { Events } from "../events/service.js";
import { type Actor, type Identity, identityError } from "../identity/service.js";
import type { ManualReports } from "../manual-reports/service.js";
import type { Qualifications } from "../qualifications/service.js";
import { selectQuality } from "../reconciliation/quality.js";
import type { Reconciliation } from "../reconciliation/service.js";
import { canonicalJson, contentHash } from "../sources/contracts/canonical.js";
import type { NormalizedTripEvidence } from "../sources/contracts/evidence.js";
import type { TripState } from "../trips/groups.js";
import { ingestionConflictCodes, type Trips } from "../trips/service.js";
import {
  ACCEPTED_OVER_LIMITS,
  acceptance,
  classify,
  evaluationSnapshot,
  qualificationCheck,
} from "./evaluation.js";
import { type Page, pagination } from "./pagination.js";
import { createReviewQueue } from "./review-queue.js";

type S = components["schemas"];
type Decision = typeof tripDecisions.$inferSelect;
type Proposal = typeof tripProposals.$inferSelect;
export interface TripDecisionsConfig {
  key: string;
  dispatchReviewStage3Enabled?: boolean;
}
export function validateTripDecisionsConfig(config: TripDecisionsConfig) {
  if (!/^[0-9a-f]{64}$/.test(config.key)) throw new Error("INVALID_TRIP_DECISIONS_CONFIG");
}
const validate = createSchemaValidator();
function input<T>(name: string, value: T): T {
  if (!validate.compile({ $ref: `urn:vtc:browser:v1#/$defs/${name}` })(value))
    throw identityError(422);
  return structuredClone(value);
}
function reason(value: string) {
  if (!value.trim() || value.length > 2048) throw identityError(422);
  return value.trim();
}
type Reviewers = Map<string, S["MemberSummary"]>;
function dto(row: Decision, e: NormalizedTripEvidence, reviewers: Reviewers): S["Decision"] {
  const reviewer = row.actorId ? reviewers.get(row.actorId) : null;
  if (reviewer === undefined) throw new Error("DECISION_REVIEWER_MISSING");
  return {
    id: row.id,
    outcome: row.outcome,
    reasonCodes: row.reasonCodes,
    reason: row.reason,
    decidedAt: row.decidedAt,
    reviewerId: row.actorId,
    reviewer,
    acceptedOverLimits:
      row.outcome === "accepted" &&
      row.actorId !== null &&
      row.reasonCodes.includes(ACCEPTED_OVER_LIMITS),
    reviewedRevisionId: row.reviewedRevisionId,
    basis: {
      factRevisionId: row.factId,
      qualificationAssignmentId: row.assignmentId,
      levelId: row.levelId,
      ruleVersionId: row.ruleVersionId,
      eventId: row.eventId,
      attendanceRevisionId: row.attendanceRevisionId,
      attributionAt: row.attributionAt,
      attributionBasis: row.attributionBasis,
      reportingAt: row.reportingAt,
    },
  };
}
function safeSourceFacts(e: NormalizedTripEvidence): S["SafeSourceFact"][] {
  return (
    [
      ["origin_city", e.origin],
      ["destination_city", e.destination],
      ["cargo", e.cargo],
      ["cargo_mass", e.cargoMassKg],
      ["actual_distance", e.actualDistanceM],
    ] as const
  ).map(([field, value]) => ({
    field,
    sourceValue:
      value.status === "known"
        ? typeof value.value === "string"
          ? value.value
          : value.value.entityId
        : null,
    sourceId: null,
    sourceLocale: null,
    mapNamespace: null,
    evidenceBasis: e.provider === "manual" ? "manual" : "event",
    evidenceRecordId: e.sourceRecordId,
    reasonCode: value.status === "unknown" ? value.reasonCode : null,
    candidateEntityIds: [],
  }));
}

function selectTelemetry(evidence: NormalizedTripEvidence[], preferredId: string | null) {
  return selectQuality(
    evidence.filter((fact) => fact.provider === "ets2telemetry"),
    preferredId,
  ).selected;
}

export function createTripDecisions(
  unit: UnitOfWork,
  config: TripDecisionsConfig,
  ports: {
    identity: Identity;
    trips: Trips;
    qualifications: Qualifications;
    manual: ManualReports;
    events: Events;
    reconciliation?: Pick<Reconciliation, "stage3DuplicateCountInTransaction">;
    outbox?: Pick<ReturnType<typeof createOutbox>, "append">;
  },
  now = () => new Date(),
) {
  validateTripDecisionsConfig(config);
  const c = (tx: TxContext) => unit.client(tx),
    at = () => now().toISOString(),
    audit = createAudit(unit),
    outbox = ports.outbox ?? createOutbox(unit),
    page = pagination(config.key);
  const reviewQueue = createReviewQueue(unit, ports, page, now);
  const run = <T>(fn: (tx: TxContext) => Promise<T>) => retryTransaction(unit, fn);
  const prepare = tripDecisionCoordinator(ports).prepare;
  async function confirmation(
    tx: TxContext,
    row: TripState,
    e: NormalizedTripEvidence,
    instant: string,
  ) {
    if (e.provider !== "manual") return instant;
    const [accepted] = await c(tx)
      .select({ attributionAt: tripDecisions.attributionAt })
      .from(tripDecisions)
      .where(
        and(
          eq(tripDecisions.tripId, row.id),
          eq(tripDecisions.outcome, "accepted"),
          eq(tripDecisions.attributionBasis, "manual_confirmation"),
        ),
      )
      .orderBy(desc(tripDecisions.sequence))
      .limit(1)
      .for("share");
    return accepted?.attributionAt ?? instant;
  }
  async function support(
    tx: TxContext,
    row: TripState,
    members: TripState[],
    eventOverride?: string,
  ) {
    const evidence = await ports.trips.reconciliation.evidence(
      tx,
      members.map((t) => t.id),
    );
    if (row.currentFactId && !evidence.some((e) => e.factRevisionId === row.currentFactId)) {
      const fact = (await ports.trips.adjudication.facts(tx, [row.currentFactId], true)).get(
        row.currentFactId,
      );
      if (!fact) throw new Error("TRIP_FACT_MISSING");
      evidence.push(fact.evidence);
    }
    const [association] = await c(tx)
      .select()
      .from(tripEventAssociations)
      .where(eq(tripEventAssociations.tripId, row.id))
      .for("share");
    const manualEvents = [
      ...new Set(
        evidence.flatMap((e) => {
          const p = e.provenance as { eventId?: string | null };
          return e.provider === "manual" && p?.eventId ? [p.eventId] : [];
        }),
      ),
    ];
    const selectedManualEvent = manualEvents.length === 1 ? manualEvents[0] : undefined;
    if (
      !association &&
      !eventOverride &&
      selectedManualEvent &&
      row.decision !== "accepted" &&
      row.decision !== "rejected"
    )
      await c(tx)
        .insert(tripEventAssociations)
        .values({ tripId: row.id, eventId: selectedManualEvent });
    const eventId = eventOverride ?? association?.eventId ?? selectedManualEvent;
    let event: Awaited<ReturnType<Events["currentAssociationInTransaction"]>> | null = null,
      eventInvalid = manualEvents.length > 1;
    if (eventId)
      try {
        event = await ports.events.currentAssociationInTransaction(tx, {
          eventId,
          memberId: row.ownerId,
          game: row.game,
        });
      } catch (error) {
        if ((error as { statusCode?: number }).statusCode === 409) eventInvalid = true;
        else throw error;
      }
    const histories = [];
    for (const e of evidence) {
      const h = await ports.qualifications.lookupInTransaction(
        tx,
        e,
        await confirmation(tx, row, e, at()),
      );
      histories.push([
        e.factRevisionId,
        h.status,
        h.status === "resolved" ? h.assignmentId : h.reasonCode,
        h.status === "resolved" ? h.ruleVersionId : null,
      ]);
    }
    const hash = contentHash(
      canonicalJson({
        members: members.map((t) => [t.id, t.aliasOf, t.currentFactId]),
        facts: evidence.map((e) => e.factRevisionId).sort(),
        event,
        eventInvalid,
        histories,
        reconciliationPending: row.reviewReasons.includes("candidate_search_overflow"),
      }),
    );
    return { evidence, event, eventId: eventId ?? null, eventInvalid, hash };
  }
  async function latest(tx: TxContext, id: string) {
    const [row] = await c(tx)
      .select()
      .from(tripDecisions)
      .where(eq(tripDecisions.tripId, id))
      .orderBy(desc(tripDecisions.sequence))
      .limit(1)
      .for("share");
    return row;
  }
  // Every staff path first runs prepare() or authorizeInTransaction(), which take the company
  // row FOR UPDATE before anything else. Identity writers lock the company row first too, so
  // these identity FOR SHARE reads are serialized against them. System decisions need no lookup.
  async function reviewers(tx: TxContext, rows: readonly Decision[]): Promise<Reviewers> {
    const ids = [...new Set(rows.flatMap((row) => (row.actorId ? [row.actorId] : [])))];
    return ids.length ? ports.identity.memberSummariesInTransaction(tx, ids) : new Map();
  }
  async function decisionDto(tx: TxContext, row: Decision, people?: Reviewers) {
    const e = (await ports.trips.adjudication.facts(tx, [row.factId], true)).get(
      row.factId,
    )?.evidence;
    if (!e) throw new Error("DECISION_FACT_MISSING");
    return dto(row, e, people ?? (await reviewers(tx, [row])));
  }
  async function work(
    tx: TxContext,
    row: TripState,
    hash: Buffer,
    reasons: string[],
    pending: boolean,
  ) {
    await c(tx)
      .insert(tripReviewWork)
      .values({ tripId: row.id, supportHash: hash, reasons, pending, assessedAt: at() })
      .onDuplicateKeyUpdate({ set: { supportHash: hash, reasons, pending, assessedAt: at() } });
  }
  async function hasPendingProposal(tx: TxContext, members: TripState[]) {
    const [pending] = await c(tx)
      .select({ id: tripProposals.id })
      .from(tripProposals)
      .leftJoin(tripProposalReviews, eq(tripProposalReviews.proposalId, tripProposals.id))
      .where(
        and(
          inArray(
            tripProposals.tripId,
            members.map((t) => t.id),
          ),
          sql`${tripProposalReviews.proposalId} IS NULL`,
        ),
      )
      .limit(1)
      .for("share");
    return (
      !!pending ||
      (await ports.manual.hasPendingCorrectionsInTransaction(tx, members[0]?.id as string))
    );
  }
  async function commitDecision(
    tx: TxContext,
    prepared: Awaited<ReturnType<typeof prepare>>,
    s: Awaited<ReturnType<typeof support>>,
    e: NormalizedTripEvidence,
    outcome: "accepted" | "rejected",
    explanation: string | null,
    actor: Actor | null,
    reviewedRevisionId: string | null,
    confirmOverLimits = false,
    stage3 = false,
  ) {
    const { row } = prepared,
      decidedAt = at(),
      previous = await latest(tx, row.id);
    const manualConfirmedAt = await confirmation(tx, row, e, decidedAt);
    const h = await ports.qualifications.lookupInTransaction(tx, e, manualConfirmedAt),
      evaluation = classify(e, h, s.event?.confirmedEvent ?? null, [], true),
      allowed =
        outcome === "accepted"
          ? acceptance(e, h, s.event?.confirmedEvent ?? null, {
              hasTelemetrySource: s.evidence.some((f) => f.provider === "ets2telemetry"),
              eventInvalid: s.eventInvalid,
              eventReviewRequired: !!s.event?.reviewRequired,
            })
          : null;
    // The flag must match the mode the reviewer saw: a missing or stale confirmation never
    // accepts, and nothing else can waive a gate.
    if (
      allowed &&
      (allowed.mode === "unavailable" ||
        (allowed.mode === "over_limits") !== (confirmOverLimits && actor !== null))
    )
      throw identityError(409, "RESOLUTION_REQUIRED");
    if (allowed && stage3) {
      const telemetry = selectTelemetry(s.evidence, row.currentFactId);
      if (telemetry && telemetry.factRevisionId !== e.factRevisionId) {
        const historical = await ports.qualifications.lookupInTransaction(tx, telemetry);
        const telemetryAcceptance = acceptance(
          telemetry,
          historical,
          s.event?.confirmedEvent ?? null,
          {
            hasTelemetrySource: true,
            eventInvalid: s.eventInvalid,
            eventReviewRequired: !!s.event?.reviewRequired,
          },
        );
        if (telemetryAcceptance.mode !== "ordinary")
          throw identityError(409, "RESOLUTION_REQUIRED");
      }
    }
    const overLimits = allowed?.mode === "over_limits";
    const basis = evaluationSnapshot(e, h, s.event?.confirmedEvent ?? null, manualConfirmedAt),
      pending = await hasPendingProposal(tx, prepared.members);
    const changed = await ports.trips.adjudication.write(
      tx,
      row,
      {
        decision: outcome,
        reviewHold: pending,
        correctionPending: pending,
        reviewReasons: pending
          ? ["proposal_pending"]
          : outcome === "rejected"
            ? evaluation.reasons
            : [],
        reportingAt: basis.reportingAt,
      },
      e,
      actor !== null,
    );
    const credits = await ports.trips.reconciliation.credits(tx, [row.id]),
      contributionVersion = (credits[0]?.version ?? 0) + 1;
    await ports.qualifications.replaceContributionsInTransaction(tx, [
      {
        tripId: row.id,
        expectedTripVersion: changed.version,
        version: contributionVersion,
        factId: e.factRevisionId,
        ...(e.provider === "manual" ? { manualConfirmedAt } : {}),
      },
    ]);
    const id = newId(),
      saved: Decision = {
        id,
        tripId: row.id,
        sequence: (previous?.sequence ?? 0) + 1,
        factId: e.factRevisionId,
        outcome,
        actorId: actor?.userId ?? null,
        reviewedRevisionId,
        reason: explanation,
        reasonCodes:
          allowed?.mode === "over_limits"
            ? [...allowed.exceeded, ACCEPTED_OVER_LIMITS]
            : evaluation.reasons,
        assignmentId: basis.qualificationAssignmentId,
        levelId: basis.levelId,
        ruleVersionId: basis.ruleVersionId,
        eventId: basis.eventId,
        eventRevisionId: s.event?.eventRevisionId ?? null,
        attendanceRevisionId: basis.attendanceRevisionId,
        attributionAt: basis.attributionAt,
        attributionBasis: basis.attributionBasis,
        reportingAt: basis.reportingAt,
        supportingFacts: s.evidence.map((f) => f.factRevisionId).sort(),
        decidedAt,
      };
    await c(tx).insert(tripDecisions).values(saved);
    await ports.manual.groupDecisionInTransaction(tx, row.id, decidedAt);
    if (pending) await ports.manual.groupDecisionInTransaction(tx, row.id, null);
    await audit.append(tx, {
      actorKind: actor ? "user" : "system",
      actorId: actor?.userId ?? null,
      operation: "report.reviewed",
      subjectKind: "trip",
      subjectId: row.id,
      occurredAt: decidedAt,
      reason: actor ? "staff_review" : "operator_request",
    });
    if (overLimits && actor)
      await audit.append(tx, {
        actorKind: "user",
        actorId: actor.userId,
        operation: "report.accepted_over_limits",
        subjectKind: "trip",
        subjectId: row.id,
        occurredAt: decidedAt,
        reason: "staff_review",
      });
    const eventId = newId();
    await outbox.append(tx, {
      eventId,
      type: "trip.decision_changed",
      schemaVersion: 1,
      aggregate: { kind: "trip", id: row.id, version: changed.version },
      occurredAt: decidedAt,
      correlationId: eventId,
      causationId: null,
      data: { decisionId: id, contributionVersion },
    });
    const committedSupport = await support(
      tx,
      changed,
      await ports.trips.groups.members(tx, [changed.id], true),
    );
    await work(tx, changed, committedSupport.hash, pending ? ["proposal_pending"] : [], pending);
    return { data: dto(saved, e, await reviewers(tx, [saved])), version: changed.version };
  }
  async function assess(tx: TxContext, id: string) {
    await evaluateInTransaction(tx, id);
    const root = await ports.trips.groups.resolve(tx, id, true);
    await ports.trips.adjudication.assessmentComplete(tx, root.id);
  }
  async function evaluateInTransaction(tx: TxContext, id: string) {
    const prepared = await prepare(tx, id),
      { row, members } = prepared,
      s = await support(tx, row, members);
    if (!row.currentFactId) return;
    const [old] = await c(tx)
      .select()
      .from(tripReviewWork)
      .where(eq(tripReviewWork.tripId, row.id))
      .for("update");
    if (old?.supportHash.equals(s.hash)) return;
    const current = s.evidence.find((e) => e.factRevisionId === row.currentFactId);
    if (!current) throw new Error("TRIP_FACT_MISSING");
    // A source revision that ingestion held (not current, carrying its conflict codes) is never
    // the worker's basis; its codes keep the trip in review until staff decide.
    const holds = (f: NormalizedTripEvidence) =>
      f.factRevisionId === row.currentFactId
        ? []
        : f.reasonCodes.filter((code) => ingestionConflictCodes.has(code));
    const held = new Set(s.evidence.flatMap(holds));
    const selection = selectQuality(
        s.evidence.filter((f) => !holds(f).length),
        row.currentFactId,
      ),
      e = selection.selected ?? current;
    const workflow = [
      ...selection.reasons,
      ...held,
      ...row.reviewReasons.filter((r) => r === "candidate_search_overflow"),
      ...(s.eventInvalid || s.event?.reviewRequired ? ["event_requires_review"] : []),
    ];
    const h = await ports.qualifications.lookupInTransaction(tx, e),
      classified = classify(
        e,
        h,
        s.event?.confirmedEvent ?? null,
        workflow,
        false,
        prepared.manual.reports.length > 0 &&
          row.decision !== "accepted" &&
          row.decision !== "rejected",
      ),
      // Violations would otherwise reject automatically despite the held revision.
      evaluation =
        held.size && classified.decision === "rejected"
          ? { ...classified, decision: "pending_review" as const }
          : classified;
    if (row.decision === "accepted" || row.decision === "rejected") {
      const effective = await latest(tx, row.id),
        basis = evaluationSnapshot(e, h, s.event?.confirmedEvent ?? null, at());
      const unchanged =
        effective &&
        !old?.pending &&
        !selection.reasons.length &&
        !held.size &&
        !s.eventInvalid &&
        !s.event?.reviewRequired &&
        e.factRevisionId === row.currentFactId &&
        evaluation.decision === row.decision &&
        basis.qualificationAssignmentId === effective.assignmentId &&
        basis.ruleVersionId === effective.ruleVersionId &&
        basis.reportingAt === effective.reportingAt &&
        basis.eventId === effective.eventId &&
        basis.attendanceRevisionId === effective.attendanceRevisionId;
      if (unchanged) {
        await ports.trips.adjudication.write(
          tx,
          row,
          { reviewHold: false, correctionPending: false, reviewReasons: [] },
          undefined,
        );
        await work(tx, row, s.hash, [], false);
        return;
      }
      // A source/proposal change cannot silently replace a confirmed fact, period or credit.
      const reasons = [
        ...new Set([...evaluation.reasons, "confirmed_facts_require_review"]),
      ].sort();
      await ports.trips.adjudication.write(
        tx,
        row,
        { reviewHold: true, correctionPending: true, reviewReasons: reasons },
        undefined,
      );
      await ports.manual.groupDecisionInTransaction(tx, row.id, null);
      await work(tx, row, s.hash, reasons, true);
      return;
    }
    if (evaluation.decision === "accepted" || evaluation.decision === "rejected") {
      await commitDecision(tx, prepared, s, e, evaluation.decision, null, null, null);
      return;
    }
    if (
      row.decision !== evaluation.decision ||
      canonicalJson(row.reviewReasons) !== canonicalJson(evaluation.reasons)
    )
      await ports.trips.adjudication.write(
        tx,
        row,
        {
          decision: evaluation.decision,
          reviewHold: evaluation.decision === "pending_review",
          reviewReasons: evaluation.reasons,
        },
        undefined,
      );
    if (evaluation.decision === "pending_review")
      await ports.manual.groupDecisionInTransaction(tx, row.id, null);
    await work(tx, row, s.hash, evaluation.reasons, evaluation.decision === "pending_review");
  }
  async function once<T extends { data: { id: string }; version: number }>(
    tx: TxContext,
    actor: Actor,
    operation: typeof tripDecisionCommands.$inferInsert.operation,
    key: string,
    value: unknown,
    fn: () => Promise<T>,
  ): Promise<T> {
    applicationId(key);
    const fingerprint = createHmac("sha256", Buffer.from(config.key, "hex"))
        .update("trip-decisions/command/v1\0")
        .update(canonicalJson(value))
        .digest(),
      where = and(
        eq(tripDecisionCommands.actorId, actor.userId),
        eq(tripDecisionCommands.operation, operation),
        eq(tripDecisionCommands.key, key),
      );
    const [old] = await c(tx).select().from(tripDecisionCommands).where(where).for("share");
    if (old) {
      if (!old.fingerprint.equals(fingerprint)) throw identityError(409, "IDEMPOTENCY_CONFLICT");
      const receipt = closed(old.result, ["kind", "id", "version", "reviewed"]),
        id = applicationId(receipt.id as string),
        version = receipt.version;
      if (
        typeof receipt.reviewed !== "boolean" ||
        typeof version !== "number" ||
        !Number.isInteger(version) ||
        version < 1
      )
        throw new Error("TRIP_RECEIPT_INVALID");
      if (receipt.kind === "decision") {
        const [decision] = await c(tx)
          .select()
          .from(tripDecisions)
          .where(eq(tripDecisions.id, id))
          .for("share");
        if (!decision) throw new Error("TRIP_RECEIPT_INVALID");
        return { data: await decisionDto(tx, decision), version } as unknown as T;
      }
      if (receipt.kind === "proposal") {
        const [proposal] = await c(tx)
          .select()
          .from(tripProposals)
          .where(eq(tripProposals.id, id))
          .for("share");
        if (!proposal) throw new Error("TRIP_RECEIPT_INVALID");
        return { data: await proposalDto(tx, proposal, receipt.reviewed), version } as unknown as T;
      }
      if (receipt.kind !== "command") throw new Error("TRIP_RECEIPT_INVALID");
      return { data: { id, version }, version } as unknown as T;
    }
    const result = await fn();
    const receipt = {
      kind: "outcome" in result.data ? "decision" : "kind" in result.data ? "proposal" : "command",
      id: result.data.id,
      version: result.version,
      reviewed: "review" in result.data && result.data.review !== null,
    };
    await c(tx).insert(tripDecisionCommands).values({
      actorId: actor.userId,
      operation,
      key,
      fingerprint,
      result: receipt,
      createdAt: at(),
    });
    return result;
  }
  function expected(row: TripState, version: number) {
    if (!Number.isInteger(version) || version < 1) throw identityError(422);
    if (row.version !== version) throw identityError(409, "VERSION_CONFLICT");
  }
  async function proposalDto(
    tx: TxContext,
    p: Proposal,
    includeReview = true,
  ): Promise<S["TripProposal"]> {
    const [savedReview] = await c(tx)
      .select()
      .from(tripProposalReviews)
      .where(eq(tripProposalReviews.proposalId, p.id))
      .for("share");
    const review = includeReview ? savedReview : undefined;
    const owners = await ports.trips.contributions.owners(tx, [p.tripId]),
      owner = owners[0];
    if (!owner) throw identityError(404);
    const evidence = await ports.manual.resolutionEvidenceInTransaction(
      tx,
      p.tripId,
      owner.ownerId,
      p.evidenceIds,
      false,
    );
    return {
      id: p.id,
      revisionId: p.revisionId,
      tripId: p.tripId,
      kind: p.kind,
      correctionRequestId: p.correctionRequestId,
      createdAt: p.createdAt,
      authorId: p.authorId,
      baseTripVersion: p.baseTripVersion,
      baseFactRevisionId: p.baseFactId,
      reason: p.reason,
      evidence,
      changes: p.changes as S["ResolutionChanges"] | null,
      eventAssociation:
        p.eventId && p.eventRevisionId
          ? {
              eventId: p.eventId,
              eventRevisionId: p.eventRevisionId,
              attendanceRevisionId: p.attendanceRevisionId,
            }
          : null,
      state: review ? (review.outcome === "approve" ? "approved" : "rejected") : "pending",
      review: review
        ? {
            decision: review.outcome,
            reviewedRevisionId: review.reviewedRevisionId,
            reason: review.reason,
            reviewerId: review.actorId,
            decidedAt: review.decidedAt,
          }
        : null,
    };
  }
  async function review(actor: Actor, id: string): Promise<{ data: S["Review"]; version: number }>;
  async function review(
    actor: Actor,
    id: string,
    stage3: true,
  ): Promise<{ data: S["TripStage3Review"]; version: number }>;
  async function review(actor: Actor, id: string, stage3 = false) {
    return run(async (tx) => {
      if (stage3) await ports.identity.authorizeInTransaction(tx, actor, "trips.review");
      // Legacy reviewer authors can inspect their own trip review workspace.
      const prepared = await prepare(tx, id, actor, false);
      await ports.identity.authorizeInTransaction(tx, actor, "trips.review");
      const { members, manual } = prepared;
      if (stage3 && prepared.row.ownerId === actor.userId)
        throw identityError(403, "SELF_REVIEW_FORBIDDEN");
      let row = prepared.row;
      const s = await support(tx, row, members);
      const [reviewedSupport] = await c(tx)
        .select()
        .from(tripReviewWork)
        .where(eq(tripReviewWork.tripId, row.id))
        .for("update");
      if (!reviewedSupport?.supportHash.equals(s.hash)) {
        row = await ports.trips.adjudication.write(tx, row, {}, undefined);
        await work(tx, row, s.hash, row.reviewReasons, true);
      }
      const selection = selectQuality(s.evidence, row.currentFactId),
        e = selection.selected ?? s.evidence.find((e) => e.factRevisionId === row.currentFactId);
      if (!e) throw identityError(409);
      const telemetry = stage3 ? selectTelemetry(s.evidence, row.currentFactId) : null;
      const evaluated = telemetry ?? e;
      const decidedAt = at(),
        confirmedAt = await confirmation(tx, row, evaluated, decidedAt),
        h = await ports.qualifications.lookupInTransaction(tx, evaluated, confirmedAt),
        blocked = manual.reports.some((r) => r.ownerId === actor.userId)
          ? ["self_review_forbidden"]
          : [];
      const event = s.event?.confirmedEvent ?? null;
      const allowed = acceptance(evaluated, h, event, {
        hasTelemetrySource: s.evidence.some((f) => f.provider === "ets2telemetry"),
        eventInvalid: s.eventInvalid,
        eventReviewRequired: !!s.event?.reviewRequired,
      });
      const ownMode =
        evaluated === e
          ? allowed
          : acceptance(
              e,
              await ports.qualifications.lookupInTransaction(
                tx,
                e,
                await confirmation(tx, row, e, decidedAt),
              ),
              event,
              {
                hasTelemetrySource: true,
                eventInvalid: s.eventInvalid,
                eventReviewRequired: !!s.event?.reviewRequired,
              },
            );
      const shared = {
        factRevisionId: e.factRevisionId,
        evaluation: evaluationSnapshot(evaluated, h, event, confirmedAt),
        qualificationCheck: qualificationCheck(evaluated, h, event),
        acceptance: {
          mode:
            allowed.mode === "unavailable" || ownMode.mode === "unavailable"
              ? ("unavailable" as const)
              : allowed.mode,
          blockedReasonCodes: [
            ...new Set([...allowed.blockedReasonCodes, ...ownMode.blockedReasonCodes]),
          ].sort(),
        },
        canDecide: blocked.length === 0,
        blockedReasonCodes: blocked,
      };
      const trip = await privateProjection(tx, row, actor);
      if (stage3) {
        const damage = telemetry?.cargoDamageFraction;
        const fraction = damage?.status === "known" ? Number(damage.value) : NaN;
        const normalized =
          telemetry && (await ports.trips.projectReviewSourceInTransaction(tx, telemetry));
        const data: S["TripStage3Review"] = {
          ...shared,
          summary: { ...trip.summary, number: row.number, createdAt: row.createdAt },
          effectiveFacts: trip.effectiveFacts ?? null,
          decisions: trip.decisions,
          pendingProposalId: trip.pendingProposalId,
          reviewReasonCodes: trip.reviewReasonCodes,
          sources: {
            manual: trip.manualRevision
              ? { manualRevision: trip.manualRevision, evidence: trip.evidence }
              : null,
            telemetry:
              telemetry && normalized
                ? {
                    facts: safeSourceFacts(telemetry),
                    normalizedFacts: {
                      ...normalized,
                      provider: "ets2telemetry",
                      sourceRecordId: telemetry.sourceRecordId,
                      cargoDamagePercent: fraction >= 0 && fraction <= 1 ? fraction * 100 : null,
                    },
                  }
                : null,
          },
        };
        return { data, version: row.version };
      }
      return {
        data: { ...shared, trip, facts: safeSourceFacts(e) } satisfies S["Review"],
        version: row.version,
      };
    });
  }

  async function privateProjection(
    tx: TxContext,
    row: TripState,
    actor: Actor,
  ): Promise<S["TripPrivate"]> {
    const memberIds = (await ports.trips.groups.members(tx, [row.id], "share")).map((t) => t.id);
    const projection = (await ports.manual.projectionInTransaction(tx, [row.id])).get(row.id),
      decisions = await c(tx)
        .select()
        .from(tripDecisions)
        .where(inArray(tripDecisions.tripId, memberIds))
        .orderBy(desc(tripDecisions.decidedAt), desc(tripDecisions.id))
        .limit(100)
        .for("share");
    const pending = await c(tx)
      .select({ id: tripProposals.id })
      .from(tripProposals)
      .leftJoin(tripProposalReviews, eq(tripProposalReviews.proposalId, tripProposals.id))
      .where(
        and(
          inArray(tripProposals.tripId, memberIds),
          sql`${tripProposalReviews.proposalId} IS NULL`,
        ),
      )
      .orderBy(desc(tripProposals.createdAt), desc(tripProposals.id))
      .limit(1)
      .for("share");
    // One bounded batch (at most 100 decisions) for every reviewer in the history.
    const people = await reviewers(tx, decisions);
    return {
      view: "private",
      summary: await ports.trips.privateSummaryInTransaction(tx, row.id, actor, projection),
      effectiveFacts: await ports.trips.effectiveFactsInTransaction(tx, row.id),
      manualRevision: projection?.manualRevision ?? null,
      evidence: projection?.evidence ?? [],
      decisions: await Promise.all(decisions.map((d) => decisionDto(tx, d, people))),
      pendingProposalId: pending[0]?.id ?? null,
      reviewReasonCodes: row.reviewReasons,
    };
  }
  async function proposal(
    tx: TxContext,
    prepared: Awaited<ReturnType<typeof prepare>>,
    actor: Actor,
    raw: S["ResolutionInput"] | null,
    eventId: string | null,
  ) {
    const { row, members } = prepared;
    if (!row.currentFactId) throw identityError(409);
    const correctionRequestId = raw?.correctionRequestId ?? null;
    if (correctionRequestId)
      await ports.manual.correctionRequestInTransaction(tx, actor, row.id, correctionRequestId);
    const s = await support(tx, row, members, eventId ?? undefined),
      base = s.evidence.find((e) => e.factRevisionId === row.currentFactId);
    if (!base) throw identityError(409);
    const id = newId(),
      revisionId = newId(),
      createdAt = at();
    const evidenceIds = raw?.evidenceIds ?? [];
    await ports.manual.resolutionEvidenceInTransaction(tx, row.id, row.ownerId, evidenceIds);
    if (raw && !evidenceIds.length && base.provider === "manual") throw identityError(422);
    const derived = raw
      ? await ports.trips.adjudication.derive(
          tx,
          row,
          base,
          revisionId,
          actor.userId,
          raw,
          createdAt,
        )
      : undefined;
    if (raw?.qualificationAssignmentId) {
      const h = await ports.qualifications.lookupInTransaction(
        tx,
        derived ?? base,
        await confirmation(tx, row, derived ?? base, createdAt),
      );
      if (h.status !== "resolved" || h.assignmentId !== raw.qualificationAssignmentId)
        throw identityError(422);
    }
    const changed = await ports.trips.adjudication.write(
      tx,
      row,
      { reviewHold: true, correctionPending: row.decision === "accepted" || row.correctionPending },
      undefined,
    );
    await ports.manual.groupDecisionInTransaction(tx, row.id, null);
    const {
      reason: explanation,
      evidenceIds: _ids,
      correctionRequestId: _request,
      ...changes
    } = raw ?? { reason: "Event association requires review", evidenceIds: [] };
    await c(tx)
      .insert(tripProposals)
      .values({
        id,
        revisionId,
        tripId: row.id,
        kind: raw ? "resolution" : "correction_request",
        correctionRequestId,
        authorId: actor.userId,
        baseTripVersion: changed.version,
        baseFactId: base.factRevisionId,
        derivedFactId: derived?.factRevisionId ?? null,
        resolutionId: raw ? revisionId : null,
        supportHash: s.hash,
        reason: reason(explanation),
        evidenceIds,
        changes: raw ? changes : null,
        eventId,
        eventRevisionId: eventId ? (s.event?.eventRevisionId ?? null) : null,
        attendanceRevisionId: eventId ? (s.event?.attendanceRevisionId ?? null) : null,
        createdAt,
      });
    await work(
      tx,
      changed,
      s.hash,
      [correctionRequestId ? "author_correction_requested" : "proposal_pending"],
      true,
    );
    await audit.append(tx, {
      actorKind: "user",
      actorId: actor.userId,
      operation: "report.reviewed",
      subjectKind: "trip",
      subjectId: row.id,
      occurredAt: createdAt,
      reason: "staff_review",
    });
    return { id, version: changed.version };
  }
  async function reviewProposal(
    tx: TxContext,
    prepared: Awaited<ReturnType<typeof prepare>>,
    actor: Actor,
    p: Proposal,
    value: S["ProposalDecisionInput"],
    stage3 = false,
  ) {
    const { row, members } = prepared;
    if (
      !members.some((member) => member.id === p.tripId) ||
      p.revisionId !== value.reviewedRevisionId ||
      (value.decision === "approve" &&
        (p.tripId !== row.id ||
          p.baseTripVersion !== row.version ||
          p.baseFactId !== row.currentFactId))
    )
      throw identityError(409, "VERSION_CONFLICT");
    const [old] = await c(tx)
      .select()
      .from(tripProposalReviews)
      .where(eq(tripProposalReviews.proposalId, p.id))
      .for("share");
    if (old) throw identityError(409, "VERSION_CONFLICT");
    const s = await support(tx, row, members, p.eventId ?? undefined);
    if (value.decision === "approve" && !p.supportHash.equals(s.hash))
      throw identityError(409, "VERSION_CONFLICT");
    const decidedAt = at(),
      closedProposals = [p];
    if (p.correctionRequestId) {
      if (value.decision === "approve")
        await ports.manual.correctionRequestInTransaction(tx, actor, row.id, p.correctionRequestId);
      const terminalized = await ports.manual.completeCorrectionInTransaction(
        tx,
        actor,
        row.id,
        p.correctionRequestId,
        value.decision === "approve" ? "resolved" : "declined",
        reason(value.reason),
        decidedAt,
      );
      if (terminalized) {
        const origins = await c(tx)
          .select({ proposal: tripProposals })
          .from(tripProposals)
          .leftJoin(tripProposalReviews, eq(tripProposalReviews.proposalId, tripProposals.id))
          .where(
            and(
              eq(tripProposals.correctionRequestId, p.correctionRequestId),
              eq(tripProposals.kind, "correction_request"),
              sql`${tripProposalReviews.proposalId} IS NULL`,
            ),
          )
          .for("share");
        for (const { proposal: origin } of origins)
          if (origin.id !== p.id) {
            await c(tx)
              .insert(tripProposalReviews)
              .values({
                proposalId: origin.id,
                actorId: actor.userId,
                outcome: value.decision,
                reviewedRevisionId: origin.revisionId,
                reason: reason(value.reason),
                decidedAt,
              });
            closedProposals.push(origin);
          }
      }
    }
    await c(tx)
      .insert(tripProposalReviews)
      .values({
        proposalId: p.id,
        actorId: actor.userId,
        outcome: value.decision,
        reviewedRevisionId: value.reviewedRevisionId,
        reason: reason(value.reason),
        decidedAt,
      });
    let result: { data: S["Decision"]; version: number } | undefined,
      reviewVersion = row.version;
    if (value.decision === "approve") {
      if (p.eventId) {
        if (s.eventInvalid || s.event?.reviewRequired) throw identityError(409);
        await c(tx)
          .insert(tripEventAssociations)
          .values({ tripId: row.id, eventId: p.eventId })
          .onDuplicateKeyUpdate({ set: { eventId: p.eventId } });
      }
      const e = (
        await ports.trips.adjudication.facts(tx, [p.derivedFactId ?? p.baseFactId], true)
      ).get(p.derivedFactId ?? p.baseFactId)?.evidence;
      if (!e) throw identityError(409);
      await ports.manual.resolutionEvidenceInTransaction(tx, row.id, row.ownerId, p.evidenceIds);
      const h = await ports.qualifications.lookupInTransaction(
          tx,
          e,
          await confirmation(tx, row, e, decidedAt),
        ),
        outcome = classify(e, h, s.event?.confirmedEvent ?? null, [], true);
      if (outcome.decision !== "accepted" && outcome.decision !== "rejected")
        throw identityError(409, "RESOLUTION_REQUIRED");
      result = await commitDecision(
        tx,
        prepared,
        s,
        e,
        outcome.decision,
        reason(value.reason),
        actor,
        p.revisionId,
        false,
        stage3,
      );
    } else {
      const effective =
        row.decision === "accepted" || row.decision === "rejected"
          ? await latest(tx, row.id)
          : undefined;
      const retained = await support(tx, row, members);
      const pending = await hasPendingProposal(tx, members),
        sourceReview = effective
          ? retained.evidence.some(
              (e) =>
                e.factRevisionId !== row.currentFactId &&
                !effective.supportingFacts.includes(e.factRevisionId),
            ) ||
            retained.eventInvalid ||
            !!retained.event?.reviewRequired ||
            (effective.eventId !== null &&
              (retained.event?.eventRevisionId !== effective.eventRevisionId ||
                retained.event?.attendanceRevisionId !== effective.attendanceRevisionId))
          : row.decision === "pending_review";
      const reasons = [
          ...(pending ? ["proposal_pending"] : []),
          ...(sourceReview ? ["source_evidence_requires_review"] : []),
          ...row.reviewReasons.filter((r) => r === "candidate_search_overflow"),
        ],
        remains = reasons.length > 0;
      const changed = await ports.trips.adjudication.write(
        tx,
        row,
        {
          reviewHold: remains,
          correctionPending: remains,
          reviewReasons: reasons,
        },
        undefined,
        true,
      );
      await ports.manual.groupDecisionInTransaction(tx, row.id, remains ? null : decidedAt);
      reviewVersion = changed.version;
      if (effective) result = { data: await decisionDto(tx, effective), version: changed.version };
      await audit.append(tx, {
        actorKind: "user",
        actorId: actor.userId,
        operation: "report.reviewed",
        subjectKind: "trip",
        subjectId: row.id,
        occurredAt: decidedAt,
        reason: "staff_review",
      });
      await work(
        tx,
        changed,
        (await support(tx, changed, await ports.trips.groups.members(tx, [changed.id], true))).hash,
        reasons,
        remains,
      );
    }

    const version = result?.version ?? reviewVersion;
    for (const closed of closedProposals) {
      const eventId = newId();
      await outbox.append(tx, {
        eventId,
        type: "trip.proposal_reviewed",
        schemaVersion: 1,
        aggregate: { kind: "trip", id: row.id, version },
        occurredAt: decidedAt,
        correlationId: eventId,
        causationId: null,
        data: { proposalId: closed.id, reviewedRevisionId: closed.revisionId },
      });
    }
    return { data: result?.data ?? (await proposalDto(tx, p)), version };
  }
  const reference = (value: unknown) => {
    const r = closed(value, ["eventId", "generation", "cursor"]);
    if (r.eventId !== null) applicationId(r.eventId as string);
    if (r.cursor !== null) applicationId(r.cursor as string);
    if (typeof r.generation !== "number" || !Number.isSafeInteger(r.generation) || r.generation < 0)
      throw new Error("INVALID_TRIP_REEVALUATION_REFERENCE");
    return r as { eventId: string | null; generation: number; cursor: string | null };
  };
  let queue: ReturnType<typeof createQueue>;
  async function enqueue(tx: TxContext, ref: ReturnType<typeof reference>) {
    await queue.enqueue(tx, {
      kind: "trips.reevaluate",
      schemaVersion: 1,
      consumer: "trip-reevaluation-v1",
      effectKey: `${ref.eventId ?? "catchup"}:${ref.generation}:${ref.cursor ?? "start"}`,
      eventId: null,
      reference: ref,
      availableAt: at(),
      maxAttempts: 5,
    });
  }
  const handler: Handler = {
    kind: "trips.reevaluate",
    consumer: "trip-reevaluation-v1",
    version: 1,
    mode: "local",
    validate: reference,
    async local(tx, value) {
      try {
        const ref = reference(value);
        await ports.identity.qualificationContextInTransaction(tx, []);
        if (ref.eventId) {
          const generation = await ports.events.tripInvalidationInTransaction(tx, ref.eventId);
          if (generation.generation !== ref.generation) return;
          const rows = await c(tx)
            .select({ id: tripEventAssociations.tripId })
            .from(tripEventAssociations)
            .where(
              and(
                eq(tripEventAssociations.eventId, ref.eventId),
                ref.cursor ? sql`${tripEventAssociations.tripId}>${ref.cursor}` : undefined,
              ),
            )
            .orderBy(tripEventAssociations.tripId)
            .limit(26);
          for (const row of rows.slice(0, 25)) await assess(tx, row.id);
          if (rows.length > 25) await enqueue(tx, { ...ref, cursor: rows[24]?.id ?? null });
        } else {
          const [state] = await c(tx)
            .select()
            .from(tripDecisionCatchup)
            .where(eq(tripDecisionCatchup.id, 1))
            .for("update");
          if (
            !state ||
            state.complete ||
            state.generation !== ref.generation ||
            state.cursor !== ref.cursor
          )
            return;
          const rows = await ports.trips.adjudication.catchup(tx, ref.cursor, 26);
          for (const row of rows.slice(0, 25)) await assess(tx, row.id);
          const cursor = rows.slice(0, 25).at(-1)?.id ?? state.cursor,
            complete = rows.length <= 25;
          await c(tx)
            .update(tripDecisionCatchup)
            .set({ cursor, complete })
            .where(eq(tripDecisionCatchup.id, 1));
          if (!complete) await enqueue(tx, { ...ref, cursor });
        }
      } catch (error) {
        if ((error as { statusCode?: number })?.statusCode === 503) throw new RetryableJobError();
        throw error;
      }
    },
  };
  queue = createQueue(unit, [handler]);
  return {
    config,
    handler,
    assessInTransaction: assess,
    async notificationDecisionInTransaction(tx: TxContext, id: string) {
      const [row] = await c(tx)
        .select({
          tripId: tripDecisions.tripId,
          outcome: tripDecisions.outcome,
          sequence: tripDecisions.sequence,
        })
        .from(tripDecisions)
        .where(eq(tripDecisions.id, applicationId(id)))
        .for("share");
      if (!row) throw new Error("NOTIFICATION_DECISION_MISSING");
      const root = await ports.trips.notificationStateInTransaction(tx, row.tripId),
        current = await latest(tx, root.id);
      return { ...row, current: current?.id === id && root.decision === row.outcome };
    },
    async notificationCurrentDecisionsInTransaction(tx: TxContext, canonicalTripIds: string[]) {
      if (canonicalTripIds.length > 100) throw new Error("NOTIFICATION_DECISION_BOUND_EXCEEDED");
      const result = new Map<string, { id: string; outcome: Decision["outcome"] }>();
      // Canonical IDs come from the owning Trips read facade. Each indexed latest lookup reads
      // one immutable decision, rather than materializing every historical revision in a group.
      for (const id of [...new Set(canonicalTripIds.map(applicationId))].sort()) {
        const current = await latest(tx, id);
        if (current) result.set(id, { id: current.id, outcome: current.outcome });
      }
      return result;
    },
    async correctionRequestedInTransaction(
      tx: TxContext,
      id: string,
      requestId: string,
      actor: Actor,
      explanation: string,
    ) {
      const prepared = await prepare(tx, id),
        { row, members } = prepared;
      if (!row.currentFactId) throw identityError(409);
      const s = await support(tx, row, members);
      await c(tx)
        .insert(tripProposals)
        .values({
          id: newId(),
          revisionId: newId(),
          tripId: row.id,
          kind: "correction_request",
          correctionRequestId: requestId,
          authorId: actor.userId,
          baseTripVersion: row.version,
          baseFactId: row.currentFactId,
          supportHash: s.hash,
          reason: reason(explanation),
          evidenceIds: [],
          createdAt: at(),
        });
      await work(tx, row, s.hash, ["author_correction_requested"], true);
    },
    async eventChangedInTransaction(tx: TxContext, eventId: string, generation: number) {
      await enqueue(tx, { eventId, generation, cursor: null });
      await ports.events.acknowledgeTripInvalidationInTransaction(tx, eventId, generation);
    },
    async catchup() {
      await run(async (tx) => {
        await ports.identity.qualificationContextInTransaction(tx, []);
        const invalidations = await ports.events.pendingTripInvalidationsInTransaction(tx, 25);
        for (const pending of invalidations) {
          await enqueue(tx, {
            eventId: pending.eventId,
            generation: pending.generation,
            cursor: null,
          });
          await ports.events.acknowledgeTripInvalidationInTransaction(
            tx,
            pending.eventId,
            pending.generation,
          );
        }
        const [old] = await c(tx)
          .select()
          .from(tripDecisionCatchup)
          .where(eq(tripDecisionCatchup.id, 1))
          .for("update");
        if (old && (!old.complete || !(await ports.trips.adjudication.hasPendingAssessment(tx))))
          return;
        if ((old?.generation ?? 0) >= 2147483647)
          throw new Error("TRIP_CATCHUP_GENERATION_EXHAUSTED");
        const generation = (old?.generation ?? 0) + 1;
        await c(tx)
          .insert(tripDecisionCatchup)
          .values({ id: 1, generation, cursor: null, complete: false })
          .onDuplicateKeyUpdate({ set: { generation, cursor: null, complete: false } });
        await enqueue(tx, { eventId: null, generation, cursor: null });
      });
    },
    async authorize(actor: Actor, review = false) {
      await run((tx) =>
        ports.identity.authorizeInTransaction(tx, actor, review ? "trips.review" : "company.read"),
      );
    },
    async eventAssociationsInTransaction(tx: TxContext, tripIds: string[]) {
      if (tripIds.length > 100) throw new Error("TRIP_ASSOCIATION_BATCH_BOUND_EXCEEDED");
      if (!tripIds.length) return new Map<string, string>();
      const rows = await c(tx)
        .select({ tripId: tripEventAssociations.tripId, eventId: tripEventAssociations.eventId })
        .from(tripEventAssociations)
        .where(inArray(tripEventAssociations.tripId, tripIds))
        .for("share");
      return new Map(rows.map((row) => [row.tripId, row.eventId]));
    },
    async eventAttendanceTripIdsInTransaction(
      tx: TxContext,
      actor: Actor,
      eventId: string,
      game: TripState["game"],
      memberIds: string[],
    ) {
      if (!memberIds.length) return new Map<string, string>();
      const roots = await ports.trips.eventAttendanceRootsInTransaction(tx, actor, game, memberIds);
      // Only the current root's committed association qualifies. If a member has
      // multiple eligible trips, the lowest canonical UUID is the stable tie-break.
      const rows = await c(tx)
        .select({
          memberId: roots.ownerId,
          tripId: sql<string>`MIN(${tripEventAssociations.tripId})`.mapWith(
            tripEventAssociations.tripId,
          ),
        })
        .from(tripEventAssociations)
        .innerJoin(roots, eq(roots.tripId, tripEventAssociations.tripId))
        .where(eq(tripEventAssociations.eventId, applicationId(eventId)))
        .groupBy(roots.ownerId);
      return new Map(rows.map((row) => [row.memberId, row.tripId]));
    },
    async privateProjectionInTransaction(tx: TxContext, id: string, actor: Actor) {
      const row = await ports.trips.groups.resolve(tx, id, "share");
      return privateProjection(tx, row, actor);
    },
    review,
    reviewStage3: (actor: Actor, id: string) => review(actor, id, true),
    reviewQueue,
    async repairReviewQueueInTransaction(tx: TxContext, after?: string, verify = false) {
      if (config.dispatchReviewStage3Enabled)
        throw new Error("DISPATCH_REVIEW_REPAIR_REQUIRES_FLAG_OFF");
      if (after !== undefined) applicationId(after);
      await ports.identity.qualificationContextInTransaction(tx, []);
      const repair = ports.trips.reviewQueueRepair;
      const rows = await repair.page(tx, after, 26);
      const batch = rows.slice(0, 25);
      if (batch.length) await ports.qualifications.prepareInTransaction(tx, batch);
      let mismatches = 0;
      for (const { id } of batch) {
        const invalid = await repair.apply(tx, id, verify, async (row) => {
          if (row.decision !== "pending_review" || row.correctionPending || !row.currentFactId)
            return null;
          const members = await ports.trips.groups.members(tx, [row.id], true);
          if (members.length !== 1) return null;
          const sources = await ports.trips.reconciliation.matchingEvidence(tx, [row.id]);
          if (!sources.complete || sources.facts.length !== 1) return null;
          const fact = sources.facts[0];
          if (fact?.provider !== "manual" || fact.factRevisionId !== row.currentFactId) return null;
          const submitted = await ports.manual.reviewQueueSubmissionInTransaction(tx, row.id);
          if (!submitted || submitted.sourceRecordId !== fact.sourceRecordId) return null;
          const [proposal] = await c(tx)
            .select({ id: tripProposals.id })
            .from(tripProposals)
            .where(eq(tripProposals.tripId, row.id))
            .limit(1)
            .for("share");
          if (proposal) return null;
          const decision = await latest(tx, row.id);
          if (!decision)
            return ports.manual.firstReviewSubmissionInTransaction(tx, submitted.reportId);
          if (
            decision.outcome === "rejected" &&
            decision.actorId &&
            decision.reviewedRevisionId &&
            decision.reviewedRevisionId !== submitted.id
          )
            return ports.manual.firstReviewSubmissionInTransaction(tx, submitted.reportId, {
              id: decision.reviewedRevisionId,
              at: decision.decidedAt,
            });
          return null;
        });
        if (invalid) mismatches++;
      }
      return {
        processed: batch.length,
        mismatches,
        nextCursor: rows.length > batch.length ? (batch.at(-1)?.id ?? null) : null,
      };
    },
    async decide(
      actor: Actor,
      id: string,
      key: string,
      version: number,
      raw: S["DecisionInput"] | S["TripStage3DecisionInput"],
      stage3 = false,
    ) {
      const value: Omit<S["DecisionInput"], "reason"> & { reason?: string } = input(
        stage3 ? "TripStage3DecisionInput" : "DecisionInput",
        raw,
      );
      const explanation =
        stage3 && value.decision === "accept" && value.proposalId === null
          ? value.reason?.trim() || null
          : reason(value.reason as string);
      const { confirmOverLimits, ...body } = value,
        confirmed = confirmOverLimits === true;
      // Over-limit confirmation applies only to a direct acceptance (owner decisions 5 and 6).
      if (confirmed && (value.decision !== "accept" || value.proposalId !== null))
        throw identityError(422);
      // An absent or false flag keeps the pre-existing receipt fingerprint for identical retries.
      const normalized = stage3 ? { ...body, reason: explanation } : body;
      const fingerprint = confirmed ? { ...normalized, confirmOverLimits: true } : normalized;
      return run(async (tx) => {
        if (stage3) await ports.identity.authorizeInTransaction(tx, actor, "trips.review");
        const prepared = await prepare(tx, id, actor);
        if (stage3 && prepared.row.ownerId === actor.userId)
          throw identityError(403, "SELF_REVIEW_FORBIDDEN");
        return once(
          tx,
          actor,
          "decide",
          key,
          { id, version, value: fingerprint, ...(stage3 && { view: "stage3" }) },
          async () => {
            expected(prepared.row, version);
            if (value.proposalId) {
              const [p] = await c(tx)
                .select()
                .from(tripProposals)
                .where(eq(tripProposals.id, value.proposalId))
                .for("share");
              if (!p) throw identityError(404);
              if (stage3 && value.factRevisionId !== (p.derivedFactId ?? p.baseFactId))
                throw identityError(409, "VERSION_CONFLICT");
              const reviewed = await reviewProposal(
                tx,
                prepared,
                actor,
                p,
                {
                  decision: value.decision === "accept" ? "approve" : "reject",
                  reviewedRevisionId: value.reviewedRevisionId,
                  reason: explanation as string,
                },
                stage3,
              );
              if (!("outcome" in reviewed.data)) throw identityError(409, "VERSION_CONFLICT");
              return { data: reviewed.data, version: reviewed.version };
            }
            const s = await support(tx, prepared.row, prepared.members),
              e = s.evidence.find((e) => e.factRevisionId === value.factRevisionId);
            const [reviewedSupport] = await c(tx)
              .select()
              .from(tripReviewWork)
              .where(eq(tripReviewWork.tripId, prepared.row.id))
              .for("share");
            if (!reviewedSupport?.supportHash.equals(s.hash))
              throw identityError(409, "VERSION_CONFLICT");
            if (
              !e ||
              (stage3 &&
                selectQuality(s.evidence, prepared.row.currentFactId).selected?.factRevisionId !==
                  e.factRevisionId)
            )
              throw identityError(409, "VERSION_CONFLICT");
            const manualRevision = prepared.manual.reports.find(
              (r) => r.revisionId === value.reviewedRevisionId,
            );
            if (
              prepared.manual.reports.length
                ? !manualRevision
                : value.reviewedRevisionId !== e.factRevisionId
            )
              throw identityError(409, "VERSION_CONFLICT");
            return commitDecision(
              tx,
              prepared,
              s,
              e,
              value.decision === "accept" ? "accepted" : "rejected",
              explanation,
              actor,
              value.reviewedRevisionId,
              confirmed,
              stage3,
            );
          },
        );
      });
    },
    async propose(
      actor: Actor,
      id: string,
      key: string,
      version: number,
      raw: S["ResolutionInput"],
    ) {
      const value = input("ResolutionInput", {
        ...raw,
        correctionRequestId: raw.correctionRequestId ?? null,
      });
      reason(value.reason);
      return run(async (tx) => {
        const prepared = await prepare(tx, id, actor);
        return once(tx, actor, "propose", key, { id, version, value }, async () => {
          expected(prepared.row, version);
          const result = await proposal(tx, prepared, actor, value, null);
          return { data: result, version: result.version };
        });
      });
    },
    async proposalDecision(
      actor: Actor,
      id: string,
      proposalId: string,
      key: string,
      version: number,
      raw: S["ProposalDecisionInput"],
    ) {
      const value = input("ProposalDecisionInput", raw);
      reason(value.reason);
      return run(async (tx) => {
        const prepared = await prepare(tx, id, actor);
        return once(tx, actor, "review", key, { id, proposalId, version, value }, async () => {
          expected(prepared.row, version);
          const [p] = await c(tx)
            .select()
            .from(tripProposals)
            .where(eq(tripProposals.id, applicationId(proposalId)))
            .for("share");
          if (!p) throw identityError(404);
          return reviewProposal(tx, prepared, actor, p, value);
        });
      });
    },
    async proposals(actor: Actor, id: string, options: Page = {}) {
      return run(async (tx) => {
        const { row, members } = await prepare(tx, id, actor, false),
          paging = page(actor, ["proposals", row.id], options),
          rows = await c(tx)
            .select()
            .from(tripProposals)
            .where(
              and(
                inArray(
                  tripProposals.tripId,
                  members.map((t) => t.id),
                ),
                paging.after?.time
                  ? or(
                      lt(tripProposals.createdAt, paging.after.time),
                      and(
                        eq(tripProposals.createdAt, paging.after.time),
                        lt(tripProposals.id, paging.after.id),
                      ),
                    )
                  : undefined,
              ),
            )
            .orderBy(desc(tripProposals.createdAt), desc(tripProposals.id))
            .limit(paging.limit + 1)
            .for("share");
        const result = paging.finish(rows, (r) => ({ id: r.id, time: r.createdAt }));
        return { ...result, items: await Promise.all(result.items.map((p) => proposalDto(tx, p))) };
      });
    },
    async getProposal(actor: Actor, id: string, proposalId: string) {
      return run(async (tx) => {
        const { row, members } = await prepare(tx, id, actor, false),
          [p] = await c(tx)
            .select()
            .from(tripProposals)
            .where(
              and(
                eq(tripProposals.id, applicationId(proposalId)),
                inArray(
                  tripProposals.tripId,
                  members.map((t) => t.id),
                ),
              ),
            )
            .for("share");
        if (!p) throw identityError(404);
        return { data: await proposalDto(tx, p), version: row.version };
      });
    },
    async associate(
      actor: Actor,
      id: string,
      key: string,
      version: number,
      raw: S["EventAssociationInput"],
    ) {
      const value = input("EventAssociationInput", raw);
      return run(async (tx) => {
        const prepared = await prepare(tx, id, actor, false),
          { row } = prepared;
        await ports.identity.authorizeInTransaction(tx, actor, "trips.submit_own");
        if (row.ownerId !== actor.userId) throw identityError(404);
        return once(tx, actor, "associate", key, { id, version, value }, async () => {
          expected(row, version);
          await ports.events.associateInTransaction(tx, actor, {
            eventId: value.eventId,
            memberId: row.ownerId,
            game: row.game,
          });
          if (row.decision === "accepted" || row.decision === "rejected") {
            const result = await proposal(tx, prepared, actor, null, value.eventId);
            return { data: result, version: result.version };
          }
          await c(tx)
            .insert(tripEventAssociations)
            .values({ tripId: row.id, eventId: value.eventId })
            .onDuplicateKeyUpdate({ set: { eventId: value.eventId } });
          const _changed = await ports.trips.adjudication.write(tx, row, {}, undefined);
          await assess(tx, row.id);
          const current = await ports.trips.groups.resolve(tx, row.id, true);
          return { data: { id: row.id, version: current.version }, version: current.version };
        });
      });
    },
    async assignments(actor: Actor, id: string, options: Page = {}) {
      return run(async (tx) => {
        const { row } = await prepare(tx, id, actor),
          paging = page(actor, ["assignments", row.ownerId, row.game], options),
          rows = await ports.qualifications.tripAssignmentsInTransaction(
            tx,
            row.ownerId,
            row.game,
            paging.after,
            paging.limit + 1,
          );
        return paging.finish(rows, (r) => ({ id: r.id, time: r.assignedAt }));
      });
    },
  };
}
export type TripDecisions = ReturnType<typeof createTripDecisions>;
