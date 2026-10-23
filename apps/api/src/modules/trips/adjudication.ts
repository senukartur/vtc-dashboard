import type { components } from "@vtc/contracts";
import {
  applicationId,
  newId,
  type TxContext,
  type UnitOfWork,
  utcDateTime,
  utcIso,
} from "@vtc/db";
import { and, eq, isNull, sql, tripHistory, tripResolutions, trips } from "@vtc/db/trips-schema";
import type { Catalogs } from "../catalogs/service.js";
import { identityError } from "../identity/service.js";
import { decimal } from "../sources/contracts/canonical.js";
import type { Fact, NormalizedTripEvidence, PinnedEntity } from "../sources/contracts/evidence.js";
import { createFactRepository } from "./facts.js";
import { createTripGroups, type TripState } from "./groups.js";

type S = components["schemas"];
export function createTripAdjudication(
  unit: UnitOfWork,
  catalogs?: Pick<Catalogs, "pinnedInTransaction">,
) {
  const c = (tx: TxContext) => unit.client(tx),
    facts = createFactRepository(unit),
    groups = createTripGroups(unit);
  return {
    facts: facts.read,
    async assessmentComplete(tx: TxContext, id: string) {
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
      const version = row.version + 1;
      await c(tx)
        .update(trips)
        .set({
          ...patch,
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
            createdAt: new Date().toISOString(),
          });
      return groups.resolve(tx, row.id, true);
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
      if (
        (changes.originCityId ||
          changes.destinationCityId ||
          changes.cargoId ||
          changes.trailerTypeId) &&
        !changes.catalogRevisionId
      )
        throw identityError(422);
      const evidence = structuredClone(base);
      evidence.factRevisionId = newId();
      evidence.catalogRevisionId = null;
      const known = <T>(value: T, field: string): Fact<T> => ({
        status: "known",
        value,
        sourceRecordId: base.sourceRecordId,
        sourceField: `resolution/${revisionId}/${field}`,
      });
      async function pin(id: string, kind: string): Promise<Fact<PinnedEntity>> {
        if (!catalogs || !changes.catalogRevisionId) throw identityError(503);
        const p = await catalogs.pinnedInTransaction(
          tx,
          changes.catalogRevisionId,
          applicationId(id),
        );
        if (!p || p.game !== row.game || p.kind !== kind) throw identityError(422);
        return known(
          {
            entityId: p.entityId,
            catalogRevisionId: changes.catalogRevisionId,
            factRevisionId: p.id,
          },
          kind,
        );
      }
      if (changes.originCityId) evidence.origin = await pin(changes.originCityId, "city");
      if (changes.destinationCityId)
        evidence.destination = await pin(changes.destinationCityId, "city");
      if (changes.cargoId) {
        evidence.cargo = await pin(changes.cargoId, "cargo");
        const p = await catalogs?.pinnedInTransaction(
          tx,
          changes.catalogRevisionId as string,
          changes.cargoId,
        );
        if (p?.adrCategoryId) evidence.adrCategory = await pin(p.adrCategoryId, "adr_category");
        else
          evidence.adrCategory = {
            status: "unknown",
            reasonCode: "cargo_adr_unknown",
            sourceRecordId: base.sourceRecordId,
          };
      }
      if (changes.trailerTypeId)
        evidence.trailers = {
          complete: true,
          items: [await pin(changes.trailerTypeId, "trailer_type")],
        };
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
