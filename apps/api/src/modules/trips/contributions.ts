import { applicationId, type TxContext, type UnitOfWork } from "@vtc/db";
import {
  and,
  eq,
  inArray,
  sql,
  tripContributionHistory,
  tripContributions,
  trips,
} from "@vtc/db/trips-schema";
import { identityError } from "../identity/service.js";
import { compareDecimal } from "../qualification-rules/decimal.js";
import { canonicalJson, contentHash, decimal } from "../sources/contracts/canonical.js";
import type { NormalizedTripEvidence } from "../sources/contracts/evidence.js";
import { createTripGroups } from "./groups.js";
import { createFactRepository } from "./facts.js";
export interface ContributionChange {
  tripId: string;
  expectedTripVersion: number;
  version: number;
  factId: string;
  aliasOf?: string | null;
  manualConfirmedAt?: string;
}
export interface Attribution {
  assignmentId: string | null;
  ruleVersionId: string | null;
  attributionBasis: "actual_start" | "manual_confirmation" | "unresolved";
  attributionAt: string | null;
}
export interface ContributionContext {
  change: ContributionChange;
  trip: typeof trips.$inferSelect;
  evidence: NormalizedTripEvidence;
}
export function createContributionRegister(unit: UnitOfWork) {
  const c = (tx: TxContext) => unit.client(tx),
    facts = createFactRepository(unit),
    groups = createTripGroups(unit);
  return {
    async contexts(tx: TxContext, changes: readonly ContributionChange[]) {
      if (
        !changes.length ||
        changes.length > 100 ||
        new Set(changes.map((change) => change.tripId)).size !== changes.length
      )
        throw identityError(422);
      const rows = new Map<string, typeof trips.$inferSelect>();
      for (const id of [
        ...new Set(
          changes.flatMap((change) => [change.tripId, ...(change.aliasOf ? [change.aliasOf] : [])]),
        ),
      ].sort()) {
        const [row] = await c(tx)
          .select()
          .from(trips)
          .where(eq(trips.id, applicationId(id)))
          .for("update");
        if (!row) throw identityError(404);
        rows.set(id, row);
      }
      for (const change of changes) {
        if (!change.aliasOf) continue;
        const targetChange = changes.find((candidate) => candidate.tripId === change.aliasOf);
        if (targetChange?.aliasOf) throw identityError(409);
        if (!targetChange) {
          const [targetCredit] = await c(tx)
            .select({ aliasOf: tripContributions.aliasOf })
            .from(tripContributions)
            .where(eq(tripContributions.tripId, change.aliasOf))
            .for("update");
          if (targetCredit?.aliasOf) throw identityError(409);
        }
      }
      const result: ContributionContext[] = [];
      for (const change of changes) {
        if (
          !Number.isInteger(change.version) ||
          change.version < 1 ||
          change.version > 2147483647 ||
          !Number.isInteger(change.expectedTripVersion)
        )
          throw identityError(422);
        const trip = rows.get(change.tripId);
        if (!trip) throw identityError(404);
        const alias = change.aliasOf ? rows.get(change.aliasOf) : null;
        if (
          change.aliasOf &&
          (!alias ||
            alias.id === trip.id ||
            alias.ownerId !== trip.ownerId ||
            alias.game !== trip.game)
        )
          throw identityError(409);
        if (trip.version !== change.expectedTripVersion || trip.currentFactId !== change.factId)
          throw identityError(409, "VERSION_CONFLICT");
        const fact = (await facts.read(tx, [applicationId(change.factId)], true)).get(
          change.factId,
        );
        if (
          !fact ||
          !(await groups.contains(tx, trip.aliasOf ?? trip.id, fact.tripId, true)) ||
          fact.evidence.ownerUserId !== trip.ownerId ||
          fact.evidence.game !== trip.game
        )
          throw identityError(409);
        result.push({ change, trip, evidence: fact.evidence });
      }
      return result;
    },
    // Caller has locked company/member/qualification state before contexts. No public setter exists.
    async replace(
      tx: TxContext,
      context: ContributionContext,
      attribution: Attribution,
      changedAt: string,
    ) {
      const { change, trip, evidence } = context;
      const accepted = trip.decision === "accepted";
      const actualDistanceM =
        evidence.actualDistanceM.status === "known"
          ? decimal(evidence.actualDistanceM.value)
          : null;
      const credited =
        accepted &&
        !change.aliasOf &&
        attribution.assignmentId !== null &&
        attribution.ruleVersionId !== null &&
        attribution.attributionAt !== null &&
        evidence.outcome === "delivered" &&
        (evidence.provider === "manual" ||
          (evidence.recording === "complete" && evidence.wholeTripDistanceSupported)) &&
        actualDistanceM !== null &&
        compareDecimal(actualDistanceM, "0") > 0;
      const snapshot = {
        tripId: trip.id,
        version: change.version,
        ownerId: trip.ownerId,
        game: trip.game,
        factId: change.factId,
        accepted,
        credited,
        aliasOf: change.aliasOf ?? null,
        ...attribution,
        actualDistanceM,
      };
      const fingerprint = contentHash(canonicalJson(snapshot));
      const [previous] = await c(tx)
        .select()
        .from(tripContributions)
        .where(eq(tripContributions.tripId, trip.id))
        .for("update");
      if (previous && previous.version >= change.version) {
        if (previous.version === change.version && !previous.fingerprint.equals(fingerprint))
          throw identityError(409, "IDEMPOTENCY_CONFLICT");
        return [];
      }
      if (previous)
        await c(tx)
          .update(tripContributions)
          .set({ ...snapshot, fingerprint, changedAt })
          .where(eq(tripContributions.tripId, trip.id));
      else
        await c(tx)
          .insert(tripContributions)
          .values({ ...snapshot, fingerprint, changedAt });
      await c(tx)
        .insert(tripContributionHistory)
        .values({ tripId: trip.id, version: change.version, snapshot, changedAt });
      return [
        ...new Set(
          [previous?.assignmentId, attribution.assignmentId].filter((id): id is string => !!id),
        ),
      ];
    },
    async totals(tx: TxContext, assignmentId: string) {
      // All writers hold the same member/qualification lock. Locking reads avoid stale RR snapshots.
      const rows = await c(tx)
        .select({ distance: tripContributions.actualDistanceM })
        .from(tripContributions)
        .where(
          and(
            eq(tripContributions.assignmentId, assignmentId),
            eq(tripContributions.credited, true),
          ),
        )
        .for("update");
      let total = 0n;
      for (const row of rows) {
        if (row.distance === null) throw new Error("CREDIT_DISTANCE_MISSING");
        const [whole = "0", fraction = ""] = row.distance.split(".");
        total += BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, "0"));
      }
      return {
        completedTrips: rows.length,
        completedDistanceM: (() => {
          const fraction = (total % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
          return `${total / 10n ** 18n}${fraction ? `.${fraction}` : ""}`;
        })(),
      };
    },
    async owners(tx: TxContext, tripIds: string[]) {
      const rows = await c(tx)
        .select({ id: trips.id, ownerId: trips.ownerId, game: trips.game })
        .from(trips)
        .where(inArray(trips.id, tripIds.map(applicationId)));
      if (rows.length !== tripIds.length) throw identityError(404);
      return rows;
    },
    async assignmentUsed(tx: TxContext, assignmentIds: string[]) {
      if (!assignmentIds.length) return false;
      const [row] = await c(tx)
        .select({ count: sql<number>`COUNT(*)` })
        .from(tripContributions)
        .where(inArray(tripContributions.assignmentId, assignmentIds));
      return Number(row?.count) > 0;
    },
  };
}
export type ContributionRegister = ReturnType<typeof createContributionRegister>;
