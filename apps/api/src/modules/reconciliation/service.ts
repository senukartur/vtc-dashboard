import { createHmac } from "node:crypto";
import type { components } from "@vtc/contracts";
import { applicationId, createAudit, newId, type TxContext, type UnitOfWork } from "@vtc/db";
import {
  and,
  desc,
  eq,
  lt,
  or,
  reconciliationCandidates,
  reconciliationCommands,
  reconciliationHistory,
  reconciliationRules,
  reconciliations,
} from "@vtc/db/reconciliation-schema";
import { causes, retryTransaction, unknownCommit } from "../../platform/jobs/queue.js";
import { createOutbox, duplicateKey } from "../../platform/outbox/events.js";
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
    const p = snapshot.after.find((t) => t.id === primary.id),
      s = snapshot.after.find((t) => t.id === secondary.id);
    if (!p || !s) throw new Error("RECONCILIATION_WRITE_MISSING");
    await coordinator.replace(tx, snapshot.after, snapshot.credits);
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
    await invalidate(
      tx,
      snapshot.after.map((t) => t.id),
    );
    await effects(tx, row, actor);
    return { data: dto(row), version: row.version };
  }
  async function authorize(tx: TxContext, actor: Actor) {
    return ports.identity.authorizeInTransaction(tx, actor, "trips.review");
  }
  return {
    config,
    async refreshInTransaction(tx: TxContext, tripId: string, _sourceRecordId: string) {
      await rule(tx);
      const root = await ports.trips.groups.resolve(tx, tripId, true);
      await c(tx)
        .update(reconciliationCandidates)
        .set({ active: false })
        .where(
          and(
            eq(reconciliationCandidates.ownerId, root.ownerId),
            eq(reconciliationCandidates.game, root.game),
          ),
        );
      const discovered = await ports.trips.reconciliation.discover(
        tx,
        root.ownerId,
        root.game,
        candidateBound + 1,
      );
      const roots = [
        ...new Map([...discovered.slice(0, candidateBound), root].map((t) => [t.id, t])).values(),
      ].sort((a, b) => a.id.localeCompare(b.id));
      let complete = discovered.length <= candidateBound;
      const entries: {
        trip: typeof root;
        facts: Awaited<ReturnType<Trips["reconciliation"]["evidence"]>>;
      }[] = [];
      for (const trip of roots) {
        const members = await ports.trips.groups.members(tx, [trip.id], true),
          evidence = await ports.trips.reconciliation.matchingEvidence(
            tx,
            members.map((t) => t.id),
          );
        complete = complete && evidence.complete;
        entries.push({ trip, facts: evidence.facts });
      }
      const searchHash = contentHash(
        canonicalJson({
          rule: hash.toString("hex"),
          complete,
          groups: entries.map((e) => ({
            id: e.trip.id,
            version: e.trip.version,
            facts: e.facts.map((f) => f.factRevisionId).sort(),
          })),
        }),
      );
      const matches: {
        primary: (typeof entries)[number];
        secondary: (typeof entries)[number];
        reasons: string[];
        supported: boolean;
      }[] = [];
      for (let i = 0; i < entries.length; i++)
        for (let j = i + 1; j < entries.length; j++) {
          const primary = entries[i],
            secondary = entries[j];
          if (!primary || !secondary) throw new Error("CANDIDATE_PAIR_MISSING");
          const outcomes = primary.facts
            .flatMap((a) => secondary.facts.map((b) => matchEvidence(a, b, config.rule)))
            .filter((r) => r.outcome !== "different");
          if (outcomes.length)
            matches.push({
              primary,
              secondary,
              reasons: [...new Set(outcomes.flatMap((r) => r.reasons))],
              supported: outcomes.every((r) => r.outcome === "supported"),
            });
        }
      const related = matches.filter(
          (m) => m.primary.trip.id === root.id || m.secondary.trip.id === root.id,
        ),
        only = automaticCandidate(related, complete);
      if (only) {
        const target = only.primary.trip.id === root.id ? only.secondary.trip : only.primary.trip;
        const reciprocal = matches.filter(
          (m) => m.primary.trip.id === target.id || m.secondary.trip.id === target.id,
        );
        if (
          reciprocal.length === 1 &&
          root.decision !== "accepted" &&
          target.decision !== "accepted"
        ) {
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
          return;
        }
      }
      const values = matches.map((match) => {
        const primary = match.primary.trip,
          secondary = match.secondary.trip;
        const degree = (id: string) =>
          matches.filter((m) => m.primary.trip.id === id || m.secondary.trip.id === id).length;
        return {
          id: newId(),
          ownerId: root.ownerId,
          game: root.game,
          searchHash,
          primaryTripId: primary.id,
          secondaryTripId: secondary.id,
          primaryVersion: primary.version,
          secondaryVersion: secondary.version,
          ruleHash: hash,
          evidence: {
            factIds: [...match.primary.facts, ...match.secondary.facts]
              .map((f) => f.factRevisionId)
              .sort(),
            searchComplete: complete,
            groups: entries.map((e) => ({ id: e.trip.id, version: e.trip.version })),
          },
          reasons: [
            ...new Set([
              ...match.reasons,
              ...(!complete ? ["candidate_search_overflow"] : []),
              ...(degree(primary.id) > 1 || degree(secondary.id) > 1
                ? ["multiple_candidates"]
                : []),
              ...(primary.decision === "accepted" || secondary.decision === "accepted"
                ? ["confirmed_facts_require_review"]
                : []),
            ]),
          ].sort(),
          active: true,
          createdAt: at(),
        };
      });
      for (let offset = 0; offset < values.length; offset += 100)
        await c(tx)
          .insert(reconciliationCandidates)
          .values(values.slice(offset, offset + 100))
          .onDuplicateKeyUpdate({ set: { active: true } });
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
          const states = await ports.trips.statesInTransaction(tx, [
            row.primaryTripId,
            row.secondaryTripId,
          ]);
          if (
            states.length !== 2 ||
            states.some((t) => t.aliasOf) ||
            !states.some((t) => t.id === row.primaryTripId && t.version === row.primaryVersion) ||
            !states.some((t) => t.id === row.secondaryTripId && t.version === row.secondaryVersion)
          )
            continue;
          items.push({
            id: row.id,
            primaryTripId: row.primaryTripId,
            secondaryTripId: row.secondaryTripId,
            reasonCodes: row.reasons,
            confidence: "review_required",
          });
        }
        return { ...result, items };
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
          const primary = restored.find((t) => t.id === row.primaryTripId),
            secondary = restored.find((t) => t.id === row.secondaryTripId);
          if (!primary || !secondary) throw new Error("RECONCILIATION_REVERSE_MISSING");
          const updated: Row = {
            ...row,
            version: row.version + 1,
            state: "reversed",
            primaryVersion: primary.version,
            secondaryVersion: secondary.version,
          };
          await c(tx).update(reconciliations).set(updated).where(eq(reconciliations.id, id));
          await c(tx).insert(reconciliationHistory).values({
            reconciliationId: id,
            version: updated.version,
            actorId: actor.userId,
            operation: "reverse",
            reason: input.reason,
            snapshot: { restored },
            createdAt: at(),
          });
          await invalidate(
            tx,
            restored.map((t) => t.id),
          );
          await effects(tx, updated, actor);
          return { data: dto(updated), version: updated.version };
        });
      });
    },
  };
}
export type Reconciliation = ReturnType<typeof createReconciliation>;
