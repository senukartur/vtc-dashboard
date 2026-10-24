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
  reconciliationCandidates,
  reconciliationCommands,
  reconciliationHistory,
  reconciliationRules,
  reconciliationSearches,
  reconciliations,
  sql,
} from "@vtc/db/reconciliation-schema";
import {
  causes,
  createQueue,
  type Handler,
  retryTransaction,
  unknownCommit,
} from "../../platform/jobs/queue.js";
import { closed, createOutbox, duplicateKey } from "../../platform/outbox/events.js";
import { reconciliationCoordinator } from "../../use-cases/trip-reconciliation.js";
import { type Actor, type Identity, identityError } from "../identity/service.js";
import type { ManualReports } from "../manual-reports/service.js";
import type { Qualifications } from "../qualifications/service.js";
import { canonicalJson, contentHash } from "../sources/contracts/canonical.js";
import type { GroupSnapshot } from "../trips/reconciliation.js";
import type { Trips } from "../trips/service.js";
import { type Page, pagination } from "./cursor.js";
import {
  automaticCandidate,
  candidateBound,
  matchEvidence,
  type ReconciliationConfig,
  ruleIdentity,
  ruleSnapshot,
  validateReconciliationConfig,
} from "./matcher.js";

type S = components["schemas"];
type Row = typeof reconciliations.$inferSelect;
function dto(row: Row): S["Reconciliation"] {
  return {
    id: row.id,
    version: row.version,
    primaryTripId: row.primaryTripId,
    secondaryTripId: row.secondaryTripId,
    primaryVersion: row.primaryVersion,
    secondaryVersion: row.secondaryVersion,
    state: row.state,
  };
}
export function createReconciliation(
  unit: UnitOfWork,
  config: ReconciliationConfig,
  ports: {
    identity: Identity;
    trips: Trips;
    qualifications: Qualifications;
    manual?: ManualReports;
    outbox?: ReturnType<typeof createOutbox>;
    workflowChanged?: (tx: TxContext, tripId: string) => Promise<void>;
  },
  now = () => new Date(),
) {
  validateReconciliationConfig(config);
  const c = (tx: TxContext) => unit.client(tx),
    at = () => now().toISOString(),
    hash = ruleIdentity(config.rule),
    page = pagination(config.key),
    coordinator = reconciliationCoordinator(ports),
    audit = createAudit(unit),
    outbox = ports.outbox ?? createOutbox(unit);
  let searchQueue: ReturnType<typeof createQueue>;
  async function command<T>(work: (tx: TxContext) => Promise<T>): Promise<T> {
    try {
      return await retryTransaction(unit, work);
    } catch (error) {
      // Classify only after the owning transaction has exhausted safe rollback retries.
      if (
        !unknownCommit(error) &&
        causes(error).some(
          (cause) =>
            "code" in cause &&
            ["ER_LOCK_WAIT_TIMEOUT", "ER_LOCK_DEADLOCK"].includes(String(cause.code)),
        )
      )
        throw identityError(503);
      throw error;
    }
  }
  async function once(
    tx: TxContext,
    actor: Actor,
    operation: "merge" | "reverse",
    key: string,
    input: unknown,
    command: () => Promise<{ data: S["Reconciliation"]; version: number }>,
  ) {
    const fingerprint = createHmac("sha256", Buffer.from(config.key, "hex"))
      .update("reconciliation/command/v1\0")
      .update(canonicalJson(input))
      .digest();
    const where = and(
      eq(reconciliationCommands.actorId, actor.userId),
      eq(reconciliationCommands.operation, operation),
      eq(reconciliationCommands.key, key),
    );
    const [saved] = await c(tx).select().from(reconciliationCommands).where(where).for("update");
    if (saved) {
      if (!saved.fingerprint.equals(fingerprint)) throw identityError(409, "IDEMPOTENCY_CONFLICT");
      return saved.result as { data: S["Reconciliation"]; version: number };
    }
    const result = await command();
    await c(tx)
      .insert(reconciliationCommands)
      .values({ actorId: actor.userId, operation, key, fingerprint, result, createdAt: at() });
    return result;
  }
  async function rule(tx: TxContext) {
    if (config.rule) {
      const [sameVersion] = await c(tx)
        .select()
        .from(reconciliationRules)
        .where(eq(reconciliationRules.version, config.rule.version))
        .for("share");
      if (sameVersion && !sameVersion.hash.equals(hash))
        throw new Error("RECONCILIATION_RULE_VERSION_REUSED");
    }
    try {
      await c(tx)
        .insert(reconciliationRules)
        .values({
          hash,
          version: config.rule?.version ?? null,
          config: config.rule ?? ruleSnapshot(undefined),
          createdAt: at(),
        });
    } catch (error) {
      if (!duplicateKey(error)) throw error;
    }
  }
  async function invalidate(tx: TxContext, ids: string[]) {
    for (const id of ids)
      await c(tx)
        .update(reconciliationCandidates)
        .set({ active: false })
        .where(
          or(
            eq(reconciliationCandidates.primaryTripId, id),
            eq(reconciliationCandidates.secondaryTripId, id),
          ),
        );
  }
  async function effects(tx: TxContext, row: Row, actor: Actor | null) {
    await audit.append(tx, {
      actorKind: actor ? "user" : "system",
      actorId: actor?.userId ?? null,
      operation: "trip.reconciled",
      subjectKind: "trip",
      subjectId: row.primaryTripId,
      occurredAt: at(),
      reason: actor ? "staff_review" : "operator_request",
    });
    const eventId = newId();
    await outbox.append(tx, {
      eventId,
      type: "trip.correction_recorded",
      schemaVersion: 1,
      aggregate: { kind: "trip", id: row.primaryTripId, version: row.primaryVersion },
      occurredAt: at(),
      correlationId: eventId,
      causationId: null,
      data: {
        reconciliationId: row.id,
        primaryTripId: row.primaryTripId,
        secondaryTripId: row.secondaryTripId,
        reconciliationVersion: row.version,
      },
    });
  }
  async function settleWorkflow(tx: TxContext, rootIds: string[]) {
    for (const id of [...new Set(rootIds)].sort()) {
      await startSearch(tx, id, false);
      await ports.workflowChanged?.(tx, id);
      const current = await ports.trips.groups.resolve(tx, id, true);
      // The search and immutable reconciliation snapshot describe the same final
      // projection, including assessment performed inside this caller transaction.
      await c(tx)
        .update(reconciliationSearches)
        .set({
          rootVersion: current.version,
          epoch: await ports.trips.reconciliation.searchEpoch(tx, current.ownerId, current.game),
        })
        .where(eq(reconciliationSearches.tripId, current.id));
    }
  }
  async function apply(tx: TxContext, input: S["MergeInput"], actor: Actor | null) {
    const rows = await coordinator.prepare(
        tx,
        [input.primaryTripId, input.secondaryTripId],
        actor ?? undefined,
      ),
      primary = rows.find((t) => t.id === input.primaryTripId),
      secondary = rows.find((t) => t.id === input.secondaryTripId);
    if (
      !primary ||
      !secondary ||
      primary.aliasOf ||
      secondary.aliasOf ||
      primary.version !== input.primaryVersion ||
      secondary.version !== input.secondaryVersion
    )
      throw identityError(409, "VERSION_CONFLICT");
    const snapshot = await ports.trips.reconciliation.apply(tx, primary, secondary);
    await coordinator.replace(tx, snapshot.after, snapshot.credits);
    await invalidate(
      tx,
      snapshot.after.map((t) => t.id),
    );
    await settleWorkflow(tx, [primary.id]);
    snapshot.after = await ports.trips.groups.members(
      tx,
      snapshot.after.map((t) => t.id),
      true,
    );
    const p = snapshot.after.find((t) => t.id === primary.id),
      s = snapshot.after.find((t) => t.id === secondary.id);
    if (!p || !s) throw new Error("RECONCILIATION_WRITE_MISSING");
    const row: Row = {
      id: newId(),
      version: 1,
      primaryTripId: p.id,
      secondaryTripId: s.id,
      primaryVersion: p.version,
      secondaryVersion: s.version,
      state: "applied",
      createdAt: at(),
    };
    await c(tx).insert(reconciliations).values(row);
    await c(tx)
      .insert(reconciliationHistory)
      .values({
        reconciliationId: row.id,
        version: 1,
        actorId: actor?.userId ?? null,
        operation: "apply",
        reason: input.reason,
        snapshot,
        createdAt: at(),
      });
    await effects(tx, row, actor);
    return { data: dto(row), version: row.version };
  }
  async function authorize(tx: TxContext, actor: Actor) {
    return ports.identity.authorizeInTransaction(tx, actor, "trips.review");
  }
  type Search = typeof reconciliationSearches.$inferSelect;
  const reference = (value: unknown) => {
    const p = closed(value, ["tripId", "generation", "phase", "cursor"]);
    if (p.phase !== "partners" && p.phase !== "discovery") throw new Error("INVALID_SEARCH_PHASE");
    return {
      tripId: applicationId(p.tripId as string),
      generation: applicationId(p.generation as string),
      phase: p.phase,
      cursor: p.cursor === null ? null : applicationId(p.cursor as string),
    };
  };
  async function enqueueSearch(tx: TxContext, state: Search) {
    const ref = reference({
      tripId: state.tripId,
      generation: state.generation,
      phase: state.phase,
      cursor: state.cursor,
    });
    await searchQueue.enqueue(tx, {
      kind: "reconciliation.search",
      consumer: "reconciliation-search-v1",
      schemaVersion: 1,
      eventId: null,
      effectKey: `search:${contentHash(canonicalJson(ref)).toString("hex")}`,
      reference: ref,
      availableAt: state.updatedAt,
      maxAttempts: 5,
    });
  }
  async function startSearch(tx: TxContext, tripId: string, immediate: boolean) {
    await rule(tx);
    const root = await ports.trips.groups.resolve(tx, tripId, true);
    const state: Search = {
      tripId: root.id,
      generation: newId(),
      rootVersion: root.version,
      ruleHash: hash,
      epoch: await ports.trips.reconciliation.searchEpoch(tx, root.ownerId, root.game),
      phase: "partners",
      cursor: null,
      finished: false,
      complete: false,
      evidenceComplete: true,
      updatedAt: at(),
    };
    await c(tx).insert(reconciliationSearches).values(state).onDuplicateKeyUpdate({ set: state });
    await ports.trips.reconciliation.searchStatus(tx, root.id, true);
    if (immediate) await advanceSearch(tx, state);
    else await enqueueSearch(tx, state);
  }
  async function possibleAutomatic(tx: TxContext, state: Search) {
    if (!state.complete) return;
    const related = await c(tx)
      .select()
      .from(reconciliationCandidates)
      .where(
        and(
          eq(reconciliationCandidates.active, true),
          eq(reconciliationCandidates.ruleHash, hash),
          or(
            eq(reconciliationCandidates.primaryTripId, state.tripId),
            eq(reconciliationCandidates.secondaryTripId, state.tripId),
          ),
        ),
      )
      .limit(2)
      .for("share");
    const only = automaticCandidate(
      related.map((row) => ({
        row,
        supported: (row.evidence as { supported?: boolean }).supported === true,
      })),
      true,
    );
    if (!only) return;
    const root = await ports.trips.groups.resolve(tx, state.tripId, true),
      target = await ports.trips.groups.resolve(
        tx,
        only.row.primaryTripId === root.id ? only.row.secondaryTripId : only.row.primaryTripId,
        true,
      );
    if (root.id === target.id || root.decision === "accepted" || target.decision === "accepted")
      return;
    const [reciprocal] = await c(tx)
      .select()
      .from(reconciliationSearches)
      .where(eq(reconciliationSearches.tripId, target.id))
      .for("update");
    if (
      !reciprocal ||
      reciprocal.rootVersion !== target.version ||
      !reciprocal.ruleHash.equals(hash) ||
      !reciprocal.epoch.equals(state.epoch)
    ) {
      await startSearch(tx, target.id, false);
      return;
    }
    if (!reciprocal.complete) return;
    const other = await c(tx)
      .select({ id: reconciliationCandidates.id })
      .from(reconciliationCandidates)
      .where(
        and(
          eq(reconciliationCandidates.active, true),
          eq(reconciliationCandidates.ruleHash, hash),
          or(
            eq(reconciliationCandidates.primaryTripId, target.id),
            eq(reconciliationCandidates.secondaryTripId, target.id),
          ),
        ),
      )
      .limit(2)
      .for("share");
    if (other.length !== 1) return;
    await apply(
      tx,
      {
        primaryTripId: target.id,
        secondaryTripId: root.id,
        primaryVersion: target.version,
        secondaryVersion: root.version,
        reason: "Unique fully supported configured evidence match",
      },
      null,
    );
  }
  async function advanceSearch(tx: TxContext, state: Search) {
    const root = await ports.trips.groups.resolve(tx, state.tripId, true);
    if (root.id !== state.tripId) {
      await c(tx)
        .update(reconciliationSearches)
        .set({ finished: true, complete: false })
        .where(eq(reconciliationSearches.tripId, state.tripId));
      return;
    }
    const epoch = await ports.trips.reconciliation.searchEpoch(tx, root.ownerId, root.game);
    if (
      root.version !== state.rootVersion ||
      !epoch.equals(state.epoch) ||
      !state.ruleHash.equals(hash)
    ) {
      await startSearch(tx, root.id, false);
      return;
    }
    const rootMembers = await ports.trips.groups.members(tx, [root.id], true),
      evidence = await ports.trips.reconciliation.matchingEvidence(
        tx,
        rootMembers.map((t) => t.id),
      );
    state.evidenceComplete =
      state.evidenceComplete && evidence.complete && evidence.facts.length > 0;
    let ids: string[], last: string | null, more: boolean;
    if (state.phase === "partners") {
      const rows = await c(tx)
        .select()
        .from(reconciliationCandidates)
        .where(
          and(
            eq(reconciliationCandidates.active, true),
            or(
              eq(reconciliationCandidates.primaryTripId, root.id),
              eq(reconciliationCandidates.secondaryTripId, root.id),
            ),
            sql`COALESCE(JSON_UNQUOTE(JSON_EXTRACT(${reconciliationCandidates.evidence}, '$.searchGeneration')),'') <> ${state.generation}`,
            state.cursor ? sql`${reconciliationCandidates.id} > ${state.cursor}` : undefined,
          ),
        )
        .orderBy(reconciliationCandidates.id)
        .limit(candidateBound + 1)
        .for("update");
      ids = [
        ...new Set(
          rows
            .slice(0, candidateBound)
            .map((r) => (r.primaryTripId === root.id ? r.secondaryTripId : r.primaryTripId)),
        ),
      ];
      more = rows.length > candidateBound;
      last = rows.slice(0, candidateBound).at(-1)?.id ?? state.cursor;
      if (!ids.length) {
        state.phase = "discovery";
        state.cursor = null;
        await advanceSearch(tx, state);
        return;
      }
    } else {
      const rows = await ports.trips.reconciliation.discover(
        tx,
        root,
        evidence,
        candidateBound + 1,
        state.cursor,
      );
      ids = rows.slice(0, candidateBound).map((r) => r.id);
      more = rows.length > candidateBound;
      last = ids.at(-1) ?? state.cursor;
    }
    for (const id of ids.sort()) {
      const target = await ports.trips.groups.resolve(tx, id, true);
      // Only this affected pair is replaced. All unrelated review work remains intact.
      await c(tx)
        .update(reconciliationCandidates)
        .set({ active: false })
        .where(
          or(
            and(
              eq(reconciliationCandidates.primaryTripId, root.id),
              eq(reconciliationCandidates.secondaryTripId, id),
            ),
            and(
              eq(reconciliationCandidates.secondaryTripId, root.id),
              eq(reconciliationCandidates.primaryTripId, id),
            ),
          ),
        );
      if (
        target.id !== id ||
        target.id === root.id ||
        target.ownerId !== root.ownerId ||
        target.game !== root.game
      )
        continue;
      const members = await ports.trips.groups.members(tx, [target.id], true),
        other = await ports.trips.reconciliation.matchingEvidence(
          tx,
          members.map((t) => t.id),
        );
      state.evidenceComplete = state.evidenceComplete && other.complete;
      const outcomes = evidence.facts
        .flatMap((a) => other.facts.map((b) => matchEvidence(a, b, config.rule)))
        .filter((r) => r.outcome !== "different");
      if (!outcomes.length && evidence.complete && other.complete) continue;
      const pair = [root, target].sort((a, b) => a.id.localeCompare(b.id)),
        primary = pair[0],
        secondary = pair[1];
      if (!primary || !secondary) throw new Error("CANDIDATE_PAIR_MISSING");
      const factIds = [...evidence.facts, ...other.facts].map((f) => f.factRevisionId).sort();
      await c(tx)
        .insert(reconciliationCandidates)
        .values({
          id: newId(),
          ownerId: root.ownerId,
          game: root.game,
          searchHash: contentHash(
            canonicalJson([
              state.generation,
              epoch.toString("hex"),
              primary.version,
              secondary.version,
              factIds,
            ]),
          ),
          primaryTripId: primary.id,
          secondaryTripId: secondary.id,
          primaryVersion: primary.version,
          secondaryVersion: secondary.version,
          ruleHash: hash,
          evidence: {
            factIds,
            searchGeneration: state.generation,
            searchComplete: false,
            supported:
              evidence.complete &&
              other.complete &&
              outcomes.length > 0 &&
              outcomes.every((r) => r.outcome === "supported"),
          },
          reasons: [
            ...new Set([
              ...outcomes.flatMap((r) => r.reasons),
              ...(!evidence.complete || !other.complete ? ["candidate_evidence_incomplete"] : []),
              ...(more ? ["candidate_search_overflow"] : []),
              ...(root.decision === "accepted" || target.decision === "accepted"
                ? ["confirmed_facts_require_review"]
                : []),
            ]),
          ].sort(),
          active: true,
          createdAt: at(),
        })
        .onDuplicateKeyUpdate({ set: { active: true } });
    }
    state.cursor = last;
    if (state.phase === "partners" && !more) {
      state.phase = "discovery";
      state.cursor = null;
    } else if (state.phase === "discovery" && !more) {
      state.finished = true;
      state.complete = state.evidenceComplete;
    }
    state.updatedAt = at();
    await c(tx)
      .update(reconciliationSearches)
      .set(state)
      .where(eq(reconciliationSearches.tripId, state.tripId));
    await ports.trips.reconciliation.searchStatus(tx, root.id, !state.complete);
    if (!state.finished) await enqueueSearch(tx, state);
    else await possibleAutomatic(tx, state);
  }
  const handler: Handler = {
    kind: "reconciliation.search",
    consumer: "reconciliation-search-v1",
    version: 1,
    mode: "local",
    validate: reference,
    async local(tx, value) {
      const ref = reference(value);
      const owners = await ports.trips.contributions.owners(tx, [ref.tripId]);
      await ports.qualifications.prepareInTransaction(tx, owners);
      const [state] = await c(tx)
        .select()
        .from(reconciliationSearches)
        .where(eq(reconciliationSearches.tripId, ref.tripId))
        .for("update");
      if (
        !state ||
        state.finished ||
        state.generation !== ref.generation ||
        state.phase !== ref.phase ||
        state.cursor !== ref.cursor
      )
        return;
      await advanceSearch(tx, state);
    },
  };
  searchQueue = createQueue(unit, [handler]);
  return {
    config,
    handler,
    async refreshInTransaction(tx: TxContext, tripId: string, _sourceRecordId: string) {
      await startSearch(tx, tripId, true);
    },
    authorize: (actor: Actor) => ports.identity.transaction((tx) => authorize(tx, actor)),
    list(actor: Actor, options: Page = {}) {
      return ports.identity.transaction(async (tx) => {
        await authorize(tx, actor);
        const paging = page(actor, ["candidates", hash.toString("hex")], options);
        const rows = await c(tx)
          .select()
          .from(reconciliationCandidates)
          .where(
            and(
              eq(reconciliationCandidates.active, true),
              eq(reconciliationCandidates.ruleHash, hash),
              paging.after?.time
                ? or(
                    lt(reconciliationCandidates.createdAt, paging.after.time),
                    and(
                      eq(reconciliationCandidates.createdAt, paging.after.time),
                      lt(reconciliationCandidates.id, paging.after.id),
                    ),
                  )
                : undefined,
            ),
          )
          .orderBy(desc(reconciliationCandidates.createdAt), desc(reconciliationCandidates.id))
          .limit(paging.limit + 1);
        const result = paging.finish(rows, (r) => ({ id: r.id, time: r.createdAt }));
        const items: S["MergeCandidate"][] = [];
        for (const row of result.items) {
          const states = await ports.trips.statesInTransaction(
            tx,
            [row.primaryTripId, row.secondaryTripId],
            "share",
          );
          const primary = states.find((t) => t.id === row.primaryTripId),
            secondary = states.find((t) => t.id === row.secondaryTripId);
          if (
            !primary ||
            !secondary ||
            primary.aliasOf ||
            secondary.aliasOf ||
            primary.ownerId !== row.ownerId ||
            secondary.ownerId !== row.ownerId ||
            primary.game !== row.game ||
            secondary.game !== row.game
          )
            continue;
          let reasons = row.reasons;
          if (
            primary.version !== row.primaryVersion ||
            secondary.version !== row.secondaryVersion
          ) {
            // Assessment can change a projection version without changing its immutable
            // source evidence. Only that provable case can refresh this advisory read.
            const members = await ports.trips.groups.members(
              tx,
              [primary.id, secondary.id],
              "share",
            );
            const left = await ports.trips.reconciliation.matchingEvidence(
              tx,
              members.filter((m) => (m.aliasOf ?? m.id) === primary.id).map((m) => m.id),
            );
            const right = await ports.trips.reconciliation.matchingEvidence(
              tx,
              members.filter((m) => (m.aliasOf ?? m.id) === secondary.id).map((m) => m.id),
            );
            const saved = (row.evidence as { factIds?: unknown }).factIds;
            const factIds = [...left.facts, ...right.facts].map((f) => f.factRevisionId).sort();
            if (
              !left.complete ||
              !right.complete ||
              !left.facts.length ||
              !right.facts.length ||
              !Array.isArray(saved) ||
              saved.some((id) => typeof id !== "string") ||
              canonicalJson([...saved].sort()) !== canonicalJson(factIds) ||
              !left.facts.some((f) => f.factRevisionId === primary.currentFactId) ||
              !right.facts.some((f) => f.factRevisionId === secondary.currentFactId)
            )
              continue;
            const outcomes = left.facts
              .flatMap((a) => right.facts.map((b) => matchEvidence(a, b, config.rule)))
              .filter((r) => r.outcome !== "different");
            if (!outcomes.length) continue;
            reasons = [
              ...new Set([
                ...outcomes.flatMap((r) => r.reasons),
                ...(states.some((t) => t.reviewReasons.includes("candidate_search_overflow"))
                  ? ["candidate_search_overflow"]
                  : []),
                ...(states.some((t) => t.decision === "accepted")
                  ? ["confirmed_facts_require_review"]
                  : []),
              ]),
            ].sort();
          }
          items.push({
            id: row.id,
            primaryTripId: row.primaryTripId,
            secondaryTripId: row.secondaryTripId,
            reasonCodes: [
              ...new Set([
                ...reasons,
                ...((
                  await c(tx)
                    .select({ id: reconciliationCandidates.id })
                    .from(reconciliationCandidates)
                    .where(
                      and(
                        eq(reconciliationCandidates.active, true),
                        eq(reconciliationCandidates.ruleHash, hash),
                        or(
                          eq(reconciliationCandidates.primaryTripId, row.primaryTripId),
                          eq(reconciliationCandidates.secondaryTripId, row.primaryTripId),
                          eq(reconciliationCandidates.primaryTripId, row.secondaryTripId),
                          eq(reconciliationCandidates.secondaryTripId, row.secondaryTripId),
                        ),
                      ),
                    )
                    .limit(2)
                ).length > 1
                  ? ["multiple_candidates"]
                  : []),
              ]),
            ].sort(),
            confidence: "review_required",
          });
        }
        return { ...result, items };
      });
    },
    history(actor: Actor, tripId: string, options: Page = {}) {
      return ports.identity.transaction(async (tx) => {
        await authorize(tx, actor);
        const root = await ports.trips.groups.resolve(tx, applicationId(tripId), "share");
        const members = await ports.trips.groups.members(tx, [root.id], "share");
        const ids = members.map((t) => t.id);
        const paging = page(actor, ["history", tripId, root.id, root.version], options);
        const rows = await c(tx)
          .select()
          .from(reconciliations)
          .where(
            and(
              or(
                inArray(reconciliations.primaryTripId, ids),
                inArray(reconciliations.secondaryTripId, ids),
              ),
              paging.after?.time
                ? or(
                    lt(reconciliations.createdAt, paging.after.time),
                    and(
                      eq(reconciliations.createdAt, paging.after.time),
                      lt(reconciliations.id, paging.after.id),
                    ),
                  )
                : undefined,
            ),
          )
          .orderBy(desc(reconciliations.createdAt), desc(reconciliations.id))
          .limit(paging.limit + 1);
        const result = paging.finish(rows, (r) => ({ id: r.id, time: r.createdAt }));
        return { ...result, items: result.items.map(dto) };
      });
    },
    get(actor: Actor, id: string) {
      return ports.identity.transaction(async (tx) => {
        await authorize(tx, actor);
        const [row] = await c(tx)
          .select()
          .from(reconciliations)
          .where(eq(reconciliations.id, applicationId(id)));
        if (!row) throw identityError(404);
        const members = await ports.trips.groups.members(tx, [
          row.primaryTripId,
          row.secondaryTripId,
        ]);
        return {
          data: dto({
            ...row,
            primaryVersion:
              members.find((t) => t.id === row.primaryTripId)?.version ?? row.primaryVersion,
            secondaryVersion:
              members.find((t) => t.id === row.secondaryTripId)?.version ?? row.secondaryVersion,
          }),
          version: row.version,
        };
      });
    },
    merge(actor: Actor, key: string, input: S["MergeInput"]) {
      applicationId(key);
      applicationId(input.primaryTripId);
      applicationId(input.secondaryTripId);
      if (
        input.primaryTripId === input.secondaryTripId ||
        !input.reason?.trim() ||
        input.reason.length > 2048
      )
        throw identityError(422);
      return command(async (tx) => {
        await coordinator.prepare(tx, [input.primaryTripId, input.secondaryTripId], actor);
        return once(tx, actor, "merge", key, input, () => apply(tx, input, actor));
      });
    },
    reverse(
      actor: Actor,
      id: string,
      key: string,
      expected: number,
      input: S["MergeReversalInput"],
    ) {
      applicationId(id);
      applicationId(key);
      if (!input.reason?.trim() || input.reason.length > 2048) throw identityError(422);
      return command(async (tx) => {
        await authorize(tx, actor);
        const [found] = await c(tx)
          .select()
          .from(reconciliations)
          .where(eq(reconciliations.id, id));
        if (!found) throw identityError(404);
        const members = await coordinator.prepare(
          tx,
          [found.primaryTripId, found.secondaryTripId],
          actor,
        );
        return once(tx, actor, "reverse", key, { id, expected, input }, async () => {
          if (
            members.find((t) => t.id === found.primaryTripId)?.version !== input.primaryVersion ||
            members.find((t) => t.id === found.secondaryTripId)?.version !== input.secondaryVersion
          )
            throw identityError(409, "VERSION_CONFLICT");
          const [row] = await c(tx)
            .select()
            .from(reconciliations)
            .where(eq(reconciliations.id, id))
            .for("update");
          if (!row || row.version !== expected || row.state !== "applied")
            throw identityError(409, "VERSION_CONFLICT");
          const [history] = await c(tx)
            .select()
            .from(reconciliationHistory)
            .where(
              and(
                eq(reconciliationHistory.reconciliationId, id),
                eq(reconciliationHistory.version, 1),
              ),
            )
            .for("share");
          if (!history) throw new Error("RECONCILIATION_HISTORY_MISSING");
          const snapshot = history.snapshot as GroupSnapshot,
            restored = await ports.trips.reconciliation.reverse(tx, snapshot);
          await coordinator.replace(tx, restored, snapshot.credits);
          await invalidate(
            tx,
            restored.map((t) => t.id),
          );
          await settleWorkflow(
            tx,
            restored.filter((t) => !t.aliasOf).map((t) => t.id),
          );
          const settled = await ports.trips.groups.members(
            tx,
            restored.map((t) => t.id),
            true,
          );
          const primary = settled.find((t) => t.id === row.primaryTripId),
            secondary = settled.find((t) => t.id === row.secondaryTripId);
          if (!primary || !secondary) throw new Error("RECONCILIATION_REVERSE_MISSING");
          const updated: Row = {
            ...row,
            version: row.version + 1,
            state: "reversed",
            primaryVersion: primary.version,
            secondaryVersion: secondary.version,
          };
          await c(tx).update(reconciliations).set(updated).where(eq(reconciliations.id, id));
          await c(tx)
            .insert(reconciliationHistory)
            .values({
              reconciliationId: id,
              version: updated.version,
              actorId: actor.userId,
              operation: "reverse",
              reason: input.reason,
              snapshot: { restored: settled },
              createdAt: at(),
            });
          await effects(tx, updated, actor);
          return { data: dto(updated), version: updated.version };
        });
      });
    },
  };
}
export type Reconciliation = ReturnType<typeof createReconciliation>;
