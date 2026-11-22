import type { components } from "@vtc/contracts";
import {
  applicationId,
  newId,
  type TxContext,
  type UnitOfWork,
  utcDateTime,
  utcIso,
} from "@vtc/db";
import {
  and,
  eq,
  inArray,
  isNull,
  sourceMessages,
  sourceTrips,
  sql,
  tripFacts,
  tripHistory,
  tripResolutions,
  trips,
} from "@vtc/db/trips-schema";
import { alias } from "drizzle-orm/mysql-core";
import type { Catalogs } from "../catalogs/service.js";
import { identityError } from "../identity/service.js";
import { canonicalJson, decimal } from "../sources/contracts/canonical.js";
import type { Fact, NormalizedTripEvidence, TripEntity } from "../sources/contracts/evidence.js";
import { createFactRepository } from "./facts.js";
import { createTripGroups, type TripState } from "./groups.js";
import { createOwnerRevision } from "./owner-revision.js";
import { queueClock, syncReviewReasons } from "./review-queue.js";

type S = components["schemas"];
export const damageRevisionReasons: ReadonlySet<string> = new Set([
  "damage_out_of_range",
  "quality_supported_conflict",
  "quality_cannot_replace_supported_snapshot",
]);

// The review exception cannot replace independent facts or staff-supported provenance.
function damageCorrectionBasis(e: NormalizedTripEvidence) {
  const fact = (value: Fact<unknown>) =>
    value.status === "known" ? [value.value, value.sourceField] : [value.reasonCode];
  return canonicalJson({
    outcome: e.outcome,
    recording: e.recording,
    start: e.start,
    end: e.end,
    wholeTripDistanceSupported: e.wholeTripDistanceSupported,
    ruleContextComplete: e.ruleContextComplete,
    fields: [
      e.origin,
      e.destination,
      e.cargo,
      e.adrCategory,
      e.cargoMassKg,
      e.actualDistanceM,
      e.measuredSegmentM,
      e.plannedDistanceM,
      e.deliveredDistanceM,
      e.fuelUsedL,
    ].map(fact),
    trailers: [e.trailers.complete, e.trailers.items.map(fact)],
    recordedTelemetry: e.recordedTelemetry ?? null,
    companies: e.companies ?? null,
    money: e.money,
    reasons: e.reasonCodes.filter((code) => !damageRevisionReasons.has(code)).sort(),
  });
}
export function createTripAdjudication(
  unit: UnitOfWork,
  catalogs?: Pick<Catalogs, "selectionsInTransaction">,
  now = () => new Date(),
  stage3Enabled = false,
  changed?: (tx: TxContext, before: TripState, after: TripState) => Promise<void>,
) {
  const c = (tx: TxContext) => unit.client(tx),
    facts = createFactRepository(unit),
    groups = createTripGroups(unit);
  return {
    facts: facts.read,
    /** Prove the locked support's latest delivery is a later revision of the same persisted source. */
    async telemetryDamageSuccessor(
      tx: TxContext,
      row: TripState,
      members: readonly TripState[],
      retained: NormalizedTripEvidence,
      evidence: readonly NormalizedTripEvidence[],
    ) {
      const memberIds = members.map((member) => member.id);
      const latestMessage = alias(sourceMessages, "latest_damage_message");
      const latestFact = alias(tripFacts, "latest_damage_fact");
      const [link] = await c(tx)
        .select({ factId: latestFact.id, retainedKind: tripFacts.kind })
        .from(tripFacts)
        .innerJoin(
          sourceMessages,
          eq(
            sourceMessages.id,
            sql`COALESCE(${tripFacts.messageId},${tripFacts.derivedSourceMessageId})`,
          ),
        )
        .innerJoin(sourceTrips, eq(sourceTrips.id, sourceMessages.sourceTripId))
        .innerJoin(
          latestMessage,
          and(
            eq(latestMessage.sourceTripId, sourceTrips.id),
            eq(latestMessage.provider, "ets2telemetry"),
            eq(latestMessage.revision, sourceTrips.latestRevision),
            sql`CAST(${latestMessage.revision} AS UNSIGNED) > CAST(${sourceMessages.revision} AS UNSIGNED)`,
          ),
        )
        .innerJoin(
          latestFact,
          and(
            eq(latestFact.messageId, latestMessage.id),
            eq(latestFact.canonicalTripId, sourceTrips.canonicalTripId),
          ),
        )
        .where(
          and(
            eq(tripFacts.id, retained.factRevisionId),
            eq(tripFacts.outcome, "delivered"),
            eq(latestFact.outcome, "delivered"),
            eq(sourceTrips.provider, "ets2telemetry"),
            eq(sourceTrips.ownerId, row.ownerId),
            eq(sourceTrips.game, row.game),
            inArray(sourceTrips.canonicalTripId, memberIds),
            inArray(tripFacts.canonicalTripId, memberIds),
          ),
        )
        .for("share");
      if (!link) return null;
      const fact = evidence.find((item) => item.factRevisionId === link.factId);
      if (!fact) return null;
      return {
        fact,
        preservesFacts:
          link.retainedKind === "source" &&
          damageCorrectionBasis(retained) === damageCorrectionBasis(fact),
      };
    },
    async assessmentComplete(tx: TxContext, id: string) {
      const root = await groups.resolve(tx, id, true);
      if (root.assessmentPending) await createOwnerRevision(unit).bump(tx, root.ownerId);
      await c(tx).update(trips).set({ assessmentPending: false }).where(eq(trips.id, id));
    },
    async hasPendingAssessment(tx: TxContext) {
      const [row] = await c(tx)
        .select({ id: trips.id })
        .from(trips)
        .where(and(eq(trips.assessmentPending, true), isNull(trips.aliasOf)))
        .limit(1)
        .for("share");
      return !!row;
    },
    async catchup(tx: TxContext, cursor: string | null, limit: number) {
      return c(tx)
        .select({ id: trips.id })
        .from(trips)
        .where(
          and(
            eq(trips.assessmentPending, true),
            isNull(trips.aliasOf),
            cursor ? sql`${trips.id} > ${cursor}` : undefined,
          ),
        )
        .orderBy(trips.id)
        .limit(limit);
    },
    async write(
      tx: TxContext,
      row: TripState,
      patch: Partial<
        Pick<
          TripState,
          "decision" | "reviewHold" | "correctionPending" | "reviewReasons" | "reportingAt"
        >
      >,
      e: NormalizedTripEvidence | undefined,
      independent = false,
    ) {
      if (row.version >= 2147483647 || row.adjudicationVersion >= 2147483647)
        throw identityError(409);
      await createOwnerRevision(unit).bump(tx, row.ownerId);
      const version = row.version + 1,
        at = now().toISOString();
      await c(tx)
        .update(trips)
        .set({
          ...patch,
          ...queueClock(row, patch, at),
          version,
          adjudicationVersion: row.adjudicationVersion + (independent ? 1 : 0),
          ...(e
            ? {
                currentFactId: e.factRevisionId,
                outcome: e.outcome,
                recording: e.recording,
                actualStart: e.start.verifiedActual ? e.start.utc : null,
                actualEnd: e.end.verifiedActual ? e.end.utc : null,
                actualDistanceM:
                  e.actualDistanceM.status === "known" ? e.actualDistanceM.value : null,
              }
            : {}),
        })
        .where(eq(trips.id, row.id));
      if (stage3Enabled) await syncReviewReasons(c(tx), { ...row, ...patch });
      if (row.currentFactId || e)
        await c(tx)
          .insert(tripHistory)
          .values({
            id: newId(),
            tripId: row.id,
            version,
            factId: e?.factRevisionId ?? (row.currentFactId as string),
            outcome: e?.outcome ?? row.outcome,
            reasons: patch.reviewReasons ?? row.reviewReasons,
            createdAt: at,
          });
      const after = await groups.resolve(tx, row.id, true);
      await changed?.(tx, row, after);
      return after;
    },
    async derive(
      tx: TxContext,
      row: TripState,
      base: NormalizedTripEvidence,
      revisionId: string,
      authorId: string,
      input: S["ResolutionInput"],
      createdAt: string,
    ) {
      const { reason, evidenceIds, correctionRequestId: _request, ...changes } = input;
      if (base.provider === "manual" && (changes.actualStartAt || changes.actualCompletedAt))
        throw identityError(422);
      const evidence = structuredClone(base);
      evidence.factRevisionId = newId();
      const known = <T>(value: T, field: string): Fact<T> => ({
        status: "known",
        value,
        sourceRecordId: base.sourceRecordId,
        sourceField: `resolution/${revisionId}/${field}`,
      });
      // A hidden row is only acceptable when the trip already carries it.
      async function select(
        id: string,
        kind: "city" | "cargo" | "trailer",
        current: Fact<TripEntity> | undefined,
      ) {
        if (!catalogs) throw identityError(503);
        const entityId = applicationId(id);
        const entity = (await catalogs.selectionsInTransaction(tx, [{ kind, id: entityId }])).get(
          entityId,
        );
        if (!entity || entity.game !== row.game || entity.kind !== kind) throw identityError(422);
        if (entity.hidden && (current?.status !== "known" || current.value.entityId !== entityId))
          throw identityError(422, "CATALOG_SELECTION_HIDDEN");
        return entity;
      }
      const reference = (entityId: string, kind: string): Fact<TripEntity> =>
        known({ entityId }, kind);
      if (changes.originCityId)
        evidence.origin = reference(
          (await select(changes.originCityId, "city", base.origin)).id,
          "city",
        );
      if (changes.destinationCityId)
        evidence.destination = reference(
          (await select(changes.destinationCityId, "city", base.destination)).id,
          "city",
        );
      // A depot belongs to one city: a moved endpoint keeps only the raw company code.
      for (const side of ["origin", "destination"] as const) {
        const before = base[side],
          after = evidence[side],
          company = evidence.companies?.[side];
        if (
          company?.depotId &&
          (after.status !== "known" ||
            before.status !== "known" ||
            after.value.entityId !== before.value.entityId)
        )
          company.depotId = null;
      }
      if (changes.cargoId) {
        const cargo = await select(changes.cargoId, "cargo", base.cargo);
        evidence.cargo = reference(cargo.id, "cargo");
        evidence.adrCategory =
          cargo.adrClass === null
            ? {
                status: "unknown",
                reasonCode: "cargo_not_adr",
                sourceRecordId: base.sourceRecordId,
              }
            : known(cargo.adrClass, "adrClass");
      }
      if (changes.trailerTypeId) {
        const trailer = await select(changes.trailerTypeId, "trailer", base.trailers.items[0]);
        evidence.trailers = {
          complete: true,
          items: [
            known(
              {
                entityId: trailer.id,
                ...(trailer.identityKind ? { identityKind: trailer.identityKind } : {}),
              },
              "trailer",
            ),
          ],
        };
      }
      if (changes.cargoMassKg)
        evidence.cargoMassKg = known(decimal(changes.cargoMassKg), "cargoMassKg");
      if (changes.actualDistanceM) {
        evidence.actualDistanceM = known(decimal(changes.actualDistanceM), "actualDistanceM");
        evidence.wholeTripDistanceSupported = true;
      }
      for (const [field, key] of [
        ["start", "actualStartAt"],
        ["end", "actualCompletedAt"],
      ] as const)
        if (changes[key])
          evidence[field] = {
            utc: utcIso(utcDateTime(changes[key])),
            basis: "staff-resolution",
            verifiedActual: true,
          };
      if (
        (evidence.start.utc && evidence.start.utc > createdAt) ||
        (evidence.end.utc && evidence.end.utc > createdAt) ||
        (evidence.start.utc && evidence.end.utc && evidence.start.utc > evidence.end.utc)
      )
        throw identityError(422);
      await c(tx).insert(tripResolutions).values({
        id: revisionId,
        tripId: row.id,
        baseFactId: base.factRevisionId,
        authorId,
        changes,
        evidenceIds,
        reason: reason.trim(),
        createdAt,
      });
      await facts.insert(tx, row.id, evidence, 2, {
        baseFactId: base.factRevisionId,
        resolutionRevisionId: revisionId,
      });
      return evidence;
    },
  };
}
