import { newId, type TxContext, type UnitOfWork } from "@vtc/db";
import {
  and,
  eq,
  inArray,
  isNull,
  lt,
  sourceMessages,
  sourceTrips,
  sql,
  tripContributions,
  tripFacts,
  tripHistory,
  trips,
} from "@vtc/db/trips-schema";
import { identityError } from "../identity/service.js";
import { selectQuality } from "../reconciliation/quality.js";
import { canonicalJson, contentHash } from "../sources/contracts/canonical.js";
import type { NormalizedTripEvidence } from "../sources/contracts/evidence.js";
import { createFactRepository } from "./facts.js";
import { createTripGroups, type TripState } from "./groups.js";
export interface GroupSnapshot {
  before: TripState[];
  after: TripState[];
  credits: (typeof tripContributions.$inferSelect)[];
  facts: string[];
  selection: ReturnType<typeof selectQuality>["provenance"];
}
export function createTripReconciliation(unit: UnitOfWork, now: () => Date) {
  const c = (tx: TxContext) => unit.client(tx),
    groups = createTripGroups(unit),
    facts = createFactRepository(unit);
  async function matchingEvidence(tx: TxContext, ids: string[]) {
    const rows = await c(tx)
      .select({ id: tripFacts.id })
      .from(sourceTrips)
      .innerJoin(
        sourceMessages,
        and(
          eq(sourceMessages.sourceTripId, sourceTrips.id),
          eq(sourceMessages.revision, sourceTrips.latestRevision),
        ),
      )
      .innerJoin(tripFacts, eq(tripFacts.messageId, sourceMessages.id))
      .where(inArray(sourceTrips.canonicalTripId, ids.slice(0, 100)))
      .orderBy(tripFacts.id)
      .limit(101)
      .for("share");
    return {
      facts: [
        ...(
          await facts.read(
            tx,
            rows.slice(0, 100).map((r) => r.id),
            true,
          )
        ).values(),
      ].map((f) => f.evidence),
      complete: ids.length <= 100 && rows.length <= 100,
    };
  }
  async function evidence(tx: TxContext, ids: string[]) {
    const result = await matchingEvidence(tx, ids);
    if (!result.complete) throw identityError(409);
    return result.facts;
  }
  function projection(f: NonNullable<ReturnType<typeof selectQuality>["selected"]>) {
    return {
      currentFactId: f.factRevisionId,
      outcome: f.outcome,
      recording: f.recording,
      actualStart: f.start.verifiedActual ? f.start.utc : null,
      actualEnd: f.end.verifiedActual ? f.end.utc : null,
      actualDistanceM: f.actualDistanceM.status === "known" ? f.actualDistanceM.value : null,
      reportingAt: f.provider === "ets2telemetry" && f.end.verifiedActual ? f.end.utc : null,
    };
  }
  async function write(tx: TxContext, row: TripState, patch: Partial<TripState>) {
    if (row.version >= 2147483647) throw identityError(409);
    await c(tx)
      .update(trips)
      .set({ ...patch, version: row.version + 1 })
      .where(eq(trips.id, row.id));
    const [after] = await c(tx).select().from(trips).where(eq(trips.id, row.id)).for("update");
    if (!after) throw new Error("TRIP_GROUP_WRITE_MISSING");
    if (after.currentFactId)
      await c(tx).insert(tripHistory).values({
        id: newId(),
        tripId: row.id,
        version: after.version,
        factId: after.currentFactId,
        outcome: after.outcome,
        reasons: after.reviewReasons,
        createdAt: now().toISOString(),
      });
    return after;
  }
  return {
    evidence,
    matchingEvidence,
    async manualAuthors(tx: TxContext, ids: string[]) {
      const rows = await c(tx)
        .select({ ownerId: sourceTrips.ownerId })
        .from(sourceTrips)
        .where(and(inArray(sourceTrips.canonicalTripId, ids), eq(sourceTrips.provider, "manual")))
        .for("share");
      return [...new Set(rows.map((r) => r.ownerId))];
    },
    async inspect(tx: TxContext, ids: string[]) {
      return groups.members(tx, ids, true);
    },
    async credits(tx: TxContext, ids: string[]) {
      return c(tx)
        .select()
        .from(tripContributions)
        .where(inArray(tripContributions.tripId, ids))
        .orderBy(tripContributions.tripId)
        .for("update");
    },
    async apply(tx: TxContext, primary: TripState, secondary: TripState): Promise<GroupSnapshot> {
      if (
        primary.aliasOf ||
        secondary.aliasOf ||
        primary.id === secondary.id ||
        primary.ownerId !== secondary.ownerId ||
        primary.game !== secondary.game
      )
        throw identityError(409);
      if (secondary.decision === "accepted" && primary.decision !== "accepted")
        throw identityError(409);
      const before = await groups.members(tx, [primary.id, secondary.id], true);
      if (before.length > 100) throw identityError(409);
      const all = await evidence(
        tx,
        before.map((t) => t.id),
      );
      const retained = primary.currentFactId
        ? (await facts.read(tx, [primary.currentFactId], true)).get(primary.currentFactId)?.evidence
        : undefined;
      if (retained && !all.some((f) => f.factRevisionId === retained.factRevisionId))
        all.push(retained);
      const selected = selectQuality(all, primary.currentFactId);
      if (!selected.selected || !primary.currentFactId || !secondary.currentFactId)
        throw identityError(409);
      const credits = await c(tx)
        .select()
        .from(tripContributions)
        .where(
          inArray(
            tripContributions.tripId,
            before.map((t) => t.id),
          ),
        )
        .orderBy(tripContributions.tripId)
        .for("update");
      // An accepted primary is the retained reviewed result. A merge is not another acceptance decision.
      const change = primary.decision === "accepted" ? {} : projection(selected.selected);
      const reasons = [
        ...new Set([
          ...primary.reviewReasons,
          ...secondary.reviewReasons,
          ...selected.reasons,
          ...(primary.decision === "accepted" &&
          selected.selected.factRevisionId !== primary.currentFactId
            ? ["confirmed_facts_require_review"]
            : []),
        ]),
      ].sort();
      const after: TripState[] = [];
      for (const row of before)
        after.push(
          await write(
            tx,
            row,
            row.id === primary.id
              ? {
                  ...change,
                  reviewReasons: reasons,
                  reviewHold: before.some((t) => t.reviewHold) || selected.reasons.length > 0,
                  correctionPending:
                    primary.correctionPending ||
                    (primary.decision === "accepted" &&
                      (selected.reasons.length > 0 ||
                        selected.selected.factRevisionId !== primary.currentFactId)),
                }
              : { aliasOf: primary.id },
          ),
        );
      return {
        before,
        after,
        credits,
        facts: all.map((f) => f.factRevisionId),
        selection:
          primary.decision === "accepted" && retained
            ? {
                ...(selectQuality([retained], retained.factRevisionId).provenance as NonNullable<
                  GroupSnapshot["selection"]
                >),
                alternatives: all.map((f) => f.factRevisionId).sort(),
              }
            : selected.provenance,
      };
    },
    async reverse(tx: TxContext, snapshot: GroupSnapshot): Promise<TripState[]> {
      const current = await groups.members(
        tx,
        snapshot.after.map((t) => t.id),
        true,
      );
      if (
        canonicalJson(current.map((t) => [t.id, t.aliasOf])) !==
        canonicalJson(snapshot.after.map((t) => [t.id, t.aliasOf]))
      )
        throw identityError(409, "VERSION_CONFLICT");
      for (const row of current) {
        const saved = snapshot.after.find((t) => t.id === row.id);
        if (saved && row.version > saved.version) {
          // Source and reconciliation mutations append a versioned projection history row.
          // A later review request or independently owned mutation without that proof is stale.
          const [history] = await c(tx)
            .select({ count: sql<number>`COUNT(*)` })
            .from(tripHistory)
            .where(
              and(
                eq(tripHistory.tripId, row.id),
                sql`${tripHistory.version} > ${saved.version}`,
                sql`${tripHistory.version} <= ${row.version}`,
              ),
            )
            .for("share");
          if (Number(history?.count) !== row.version - saved.version)
            throw identityError(409, "VERSION_CONFLICT");
        }
        if (
          !saved ||
          row.decision !== saved.decision ||
          (row.decision === "accepted" &&
            (row.currentFactId !== saved.currentFactId || row.reportingAt !== saved.reportingAt))
        )
          throw identityError(409, "VERSION_CONFLICT");
      }
      // Restore the independent reviewed states using new versions. Never rewind aggregate/credit versions.
      const result: TripState[] = [];
      for (const row of current) {
        const saved = snapshot.before.find((t) => t.id === row.id);
        if (!saved) throw new Error("RECONCILIATION_SNAPSHOT_INVALID");
        const {
          id: _id,
          version: _version,
          ownerId: _owner,
          game: _game,
          createdAt: _created,
          ...state
        } = saved;
        result.push(await write(tx, row, state));
      }
      for (const root of result.filter((t) => !t.aliasOf)) {
        const members = await groups.members(tx, [root.id], true),
          all = await evidence(
            tx,
            members.map((t) => t.id),
          );
        if (all.some((f) => !snapshot.facts.includes(f.factRevisionId))) {
          const choice = selectQuality(all, root.currentFactId);
          const patch =
            root.decision === "accepted"
              ? {
                  correctionPending: true,
                  reviewHold: true,
                  reviewReasons: [
                    ...new Set([...root.reviewReasons, "reversed_group_new_evidence"]),
                  ].sort(),
                }
              : {
                  ...(choice.selected ? projection(choice.selected) : {}),
                  reviewHold: true,
                  reviewReasons: [
                    ...new Set([
                      ...root.reviewReasons,
                      ...choice.reasons,
                      "reversed_group_new_evidence",
                    ]),
                  ].sort(),
                };
          await c(tx).update(trips).set(patch).where(eq(trips.id, root.id));
          Object.assign(root, patch);
          await c(tx)
            .update(tripHistory)
            .set({
              factId: root.currentFactId as string,
              outcome: root.outcome,
              reasons: root.reviewReasons,
            })
            .where(and(eq(tripHistory.tripId, root.id), eq(tripHistory.version, root.version)));
        }
      }
      return result;
    },
    async searchStatus(tx: TxContext, id: string, pending: boolean) {
      const row = await groups.resolve(tx, id, true);
      // Diagnostic state changes neither the fact/version epoch nor adjudication/credit.
      const reasons = row.reviewReasons.filter((r) => r !== "candidate_search_overflow");
      if (pending) reasons.push("candidate_search_overflow");
      await c(tx)
        .update(trips)
        .set({ reviewReasons: [...new Set(reasons)].sort() })
        .where(eq(trips.id, row.id));
    },
    async searchEpoch(tx: TxContext, ownerId: string, game: "ets2" | "ats") {
      const [rows] = await c(tx)
        .select({
          count: sql<string>`COUNT(*)`,
          versions: sql<string>`COALESCE(SUM(${trips.version}),0)`,
        })
        .from(trips)
        .where(and(eq(trips.ownerId, ownerId), eq(trips.game, game)))
        .for("share");
      const [messages] = await c(tx)
        .select({ count: sql<string>`COUNT(*)` })
        .from(sourceMessages)
        .innerJoin(sourceTrips, eq(sourceTrips.id, sourceMessages.sourceTripId))
        .where(and(eq(sourceTrips.ownerId, ownerId), eq(sourceTrips.game, game)))
        .for("share");
      return contentHash(
        canonicalJson([String(rows?.count), String(rows?.versions), String(messages?.count)]),
      );
    },
    async discover(
      tx: TxContext,
      root: TripState,
      evidence: { facts: NormalizedTripEvidence[]; complete: boolean },
      limit: number,
      cursor: string | null,
    ) {
      // EXISTS examines every latest original source in each effective group before LIMIT.
      // Unknown IDs and incomplete root evidence are possibilities, never exclusion proof.
      const compatible =
        evidence.complete && evidence.facts.length
          ? sql.join(
              evidence.facts.map(
                (f) => sql`(s.provider <> ${f.provider}
            AND ${f.origin.status === "known" ? sql`(f.origin_entity_id IS NULL OR f.origin_entity_id = ${f.origin.value.entityId})` : sql`TRUE`}
            AND ${f.destination.status === "known" ? sql`(f.destination_entity_id IS NULL OR f.destination_entity_id = ${f.destination.value.entityId})` : sql`TRUE`}
            AND ${f.cargo.status === "known" ? sql`(f.cargo_entity_id IS NULL OR f.cargo_entity_id = ${f.cargo.value.entityId})` : sql`TRUE`})`,
              ),
              sql` OR `,
            )
          : sql`TRUE`;
      return c(tx)
        .select()
        .from(trips)
        .where(
          and(
            eq(trips.ownerId, root.ownerId),
            eq(trips.game, root.game),
            isNull(trips.aliasOf),
            sql`${trips.id} <> ${root.id}`,
            cursor ? lt(sql`${cursor}`, trips.id) : undefined,
            sql`EXISTS (SELECT 1 FROM source_trips s JOIN trips m ON m.id = s.canonical_trip_id JOIN source_messages sm ON sm.source_trip_id = s.id AND sm.revision = s.latest_revision JOIN trip_facts f ON f.message_id = sm.id WHERE COALESCE(m.alias_of,m.id) = ${trips.id} AND (${compatible}) FOR SHARE)`,
          ),
        )
        .orderBy(trips.id)
        .limit(limit)
        .for("update");
    },
  };
}
