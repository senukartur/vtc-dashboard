import { createHash } from "node:crypto";
import type { UnitOfWork } from "@vtc/db";
import {
  catalogArtifacts,
  catalogEntities,
  catalogFacts,
  catalogRevisions,
} from "@vtc/db/catalogs-schema";
import { eventRevisions, events } from "@vtc/db/events-schema";
import { company, eq, membership } from "@vtc/db/identity-schema";
import {
  qualificationAssignments,
  qualificationRules,
  qualificationStates,
} from "@vtc/db/qualifications-schema";
import {
  sourceMessages,
  sourcePayloads,
  sourceTrips,
  tripHistory,
  trips,
} from "@vtc/db/trips-schema";
import type { Identity } from "../../apps/api/src/modules/identity/service.ts";
import { structuralLevels } from "../../apps/api/src/modules/qualifications/initialization.ts";
import type {
  Fact,
  NormalizedTripEvidence,
} from "../../apps/api/src/modules/sources/contracts/evidence.ts";
import { createContributionRegister } from "../../apps/api/src/modules/trips/contributions.ts";
import { createFactRepository } from "../../apps/api/src/modules/trips/facts.ts";
import { demoDataset, demoEpoch, demoId, demoMembers, games } from "./dataset.ts";

// Explicit fixture writer: never imported by application startup or production commands.
export async function seedDashboard(
  unit: UnitOfWork,
  identity: Identity,
  passwordHash: string,
  now = new Date(),
) {
  const dataset = demoDataset(now);
  const director = demoMembers[0];
  if (!director) throw new Error("DEMO_MEMBER_MISSING");
  const facts = createFactRepository(unit);
  const contributions = createContributionRegister(unit);
  return unit.run(async (tx) => {
    const c = unit.client(tx);
    const [existing] = await c.select().from(company).where(eq(company.singleton, 1)).for("update");
    if (existing && (existing.id !== demoId("company") || existing.directorUserId !== director.id))
      throw new Error("DEMO_REFUSES_EXISTING_COMPANY");
    if (!existing) {
      for (const member of demoMembers) {
        await identity.insertWithCredential(tx, {
          userId: member.id,
          email: member.email,
          name: member.nickname,
          passwordHash,
          roles: member.roles,
        });
        await c
          .update(membership)
          .set({
            locale: "ru",
            displayTimezone: "Europe/Moscow",
            status: member.former ? "inactive" : "active",
          })
          .where(eq(membership.userId, member.id));
      }
      await c.insert(company).values({
        singleton: 1,
        id: demoId("company"),
        directorUserId: director.id,
        reportingTimezone: "Europe/Moscow",
      });
      for (const game of games) {
        for (const [rank, levelId] of structuralLevels[game].entries()) {
          await c.insert(qualificationRules).values({
            id: demoId(`rule/${game}/${rank}`),
            levelId,
            actorId: director.id,
            publishedAt: demoEpoch,
            effectiveAt: demoEpoch,
            rules: [],
            requiredTrips: rank === 3 ? null : 20 + rank * 10,
            requiredDistanceM: rank === 3 ? null : String((12000 + rank * 8000) * 1000),
            reason: "Synthetic local demo thresholds; not company launch configuration",
          });
        }
        for (const member of demoMembers) {
          const assignmentId = demoId(`assignment/${member.id}/${game}`);
          const levelId = structuralLevels[game][member.rank];
          if (!levelId) throw new Error("DEMO_LEVEL_MISSING");
          await c.insert(qualificationAssignments).values({
            id: assignmentId,
            userId: member.id,
            game,
            levelId,
            assignedAt: demoEpoch,
            endedAt: member.former ? demoEpoch : null,
            purpose: "initial",
            actorId: null,
            reason: "Synthetic local dashboard fixture",
          });
          await c.insert(qualificationStates).values({
            userId: member.id,
            game,
            assignmentId: member.former ? null : assignmentId,
            version: 1,
          });
        }
        const artifactId = demoId(`artifact/${game}`),
          revisionId = demoId(`catalog/${game}`);
        const hash = createHash("sha256").update(`original-demo-labels/${game}`).digest();
        await c.insert(catalogArtifacts).values({
          id: artifactId,
          creatorId: director.id,
          sha256: hash,
          byteLength: 0,
          content: null,
          expiresAt: demoEpoch,
          createdAt: demoEpoch,
        });
        await c.insert(catalogRevisions).values({
          id: revisionId,
          game,
          version: 1,
          state: "validated",
          complete: true,
          artifactId,
          artifactSha256: hash,
          gameBuild: "synthetic-demo",
          inventoryAsOf: "2026-01-01",
          synthetic: true,
          sourceManifestSha256: hash,
          provenance: [{ source: "Original fictional local fixture; no extracted game data" }],
          createdAt: demoEpoch,
        });
        const labels =
          game === "ets2"
            ? [
                ["Berlin", "Берлин"],
                ["Hamburg", "Гамбург"],
                ["Demo machinery", "Демо: оборудование"],
              ]
            : [
                ["Seattle", "Сиэтл"],
                ["Portland", "Портленд"],
                ["Demo lumber", "Демо: пиломатериалы"],
              ];
        for (const [index, label] of labels.entries()) {
          const entityId = demoId(`entity/${game}/${index}`),
            kind = index === 2 ? "cargo" : "city";
          const map = Buffer.from("local-demo");
          await c
            .insert(catalogEntities)
            .values({ id: entityId, game, kind, map, sourceKey: Buffer.from(`demo/${index}`) });
          await c.insert(catalogFacts).values({
            id: demoId(`catalog-fact/${game}/${index}`),
            revisionId,
            entityId,
            game,
            kind,
            map,
            retired: false,
            labelEn: label[0],
            labelRu: label[1],
            packId: Buffer.from("local-demo"),
          });
        }
      }
    }
    let addedTrips = 0,
      addedEvents = 0;
    for (const trip of dataset.trips) {
      const [saved] = await c.select({ id: trips.id }).from(trips).where(eq(trips.id, trip.id));
      if (saved) continue;
      const sourceId = demoId(`source/${trip.id}`),
        messageId = demoId(`message/${trip.id}`),
        factId = demoId(`fact/${trip.id}`);
      const member = demoMembers.find((member) => member.id === trip.ownerId);
      if (!member) throw new Error("DEMO_MEMBER_MISSING");
      const accepted = trip.decision === "accepted";
      const open = trip.decision === "unassessed";
      const reasonCodes =
        trip.decision === "pending_review"
          ? ["SYNTHETIC_STAFF_REVIEW"]
          : trip.decision === "rejected"
            ? ["SYNTHETIC_REJECTED"]
            : [];
      const [stored] = await c.insert(trips).values({
        id: trip.id,
        ownerId: trip.ownerId,
        game: trip.game,
        version: 1,
        outcome: open ? "open" : "delivered",
        recording: open ? "partial" : "complete",
        decision: trip.decision,
        assessmentPending: false,
        correctionPending: false,
        actualStart: trip.start,
        actualEnd: open ? null : trip.end,
        reportingAt: open ? null : trip.end,
        actualDistanceM: trip.actualDistanceM,
        reviewReasons: reasonCodes,
        createdAt: trip.start,
      });
      if (!stored.affectedRows) throw new Error("DEMO_TRIP_INSERT_FAILED");
      await c.insert(sourceTrips).values({
        id: sourceId,
        provider: "ets2telemetry",
        game: trip.game,
        sessionKey: Buffer.from(demoId(`session/${trip.id}`)),
        tripKey: Buffer.from(trip.id),
        ownerId: trip.ownerId,
        canonicalTripId: trip.id,
        latestRevision: "1",
        connectionContext: { synthetic: true },
        createdAt: trip.start,
      });
      const content = JSON.stringify({ synthetic: true, fixture: "local-dashboard-v1", ...trip });
      await c.insert(sourceMessages).values({
        id: messageId,
        sourceTripId: sourceId,
        provider: "ets2telemetry",
        eventKey: Buffer.from(demoId(`event-key/${trip.id}`)),
        revision: "1",
        sha256: createHash("sha256").update(content).digest(),
        receivedAt: trip.end,
        deliveryMode: "backfill",
      });
      await c.insert(sourcePayloads).values({ messageId, content });
      const known = <T>(value: T, sourceField: string): Fact<T> => ({
        status: "known",
        value,
        sourceRecordId: messageId,
        sourceField,
      });
      const unknown = {
        status: "unknown" as const,
        reasonCode: "SYNTHETIC_NOT_RECORDED",
        sourceRecordId: messageId,
      };
      const pin = (index: number) =>
        known(
          {
            entityId: demoId(`entity/${trip.game}/${index}`),
            catalogRevisionId: demoId(`catalog/${trip.game}`),
            factRevisionId: demoId(`catalog-fact/${trip.game}/${index}`),
          },
          `demo/catalog/${index}`,
        );
      const evidence: NormalizedTripEvidence = {
        sourceRecordId: messageId,
        factRevisionId: factId,
        provider: "ets2telemetry",
        ownerUserId: trip.ownerId,
        game: trip.game,
        outcome: open ? "open" : "delivered",
        recording: open ? "partial" : "complete",
        catalogRevisionId: null,
        start: { utc: trip.start, basis: "event", verifiedActual: true },
        end: {
          utc: open ? null : trip.end,
          basis: open ? "unknown" : "event",
          verifiedActual: !open,
        },
        origin: pin(0),
        destination: pin(1),
        cargo: pin(2),
        cargoMassKg: known("16000", "demo/mass"),
        actualDistanceM: known(trip.actualDistanceM, "demo/distance"),
        measuredSegmentM: unknown,
        plannedDistanceM: unknown,
        deliveredDistanceM: unknown,
        fuelUsedL: known(String(Number(trip.actualDistanceM) / 3000), "demo/fuel"),
        cargoDamageFraction: known("0", "demo/damage"),
        money: null,
        provenance: { synthetic: true },
        wholeTripDistanceSupported: !open,
        trailers: { complete: false, items: [] },
        adrCategory: unknown,
        ruleContextComplete: false,
        reasonCodes,
      };
      await facts.insert(tx, trip.id, evidence, 2);
      await c.update(trips).set({ currentFactId: factId }).where(eq(trips.id, trip.id));
      await c.insert(tripHistory).values({
        id: demoId(`history/${trip.id}`),
        tripId: trip.id,
        version: 1,
        factId,
        outcome: evidence.outcome,
        reasons: reasonCodes,
        createdAt: trip.end,
      });
      const [context] = await contributions.contexts(tx, [
        { tripId: trip.id, expectedTripVersion: 1, version: 1, factId },
      ]);
      if (!context) throw new Error("DEMO_CONTRIBUTION_MISSING");
      await contributions.replace(
        tx,
        context,
        {
          assignmentId: accepted ? demoId(`assignment/${trip.ownerId}/${trip.game}`) : null,
          ruleVersionId: accepted ? demoId(`rule/${trip.game}/${member.rank}`) : null,
          attributionBasis: accepted ? "actual_start" : "unresolved",
          attributionAt: accepted ? trip.start : null,
        },
        trip.end,
      );
      addedTrips++;
    }
    // Keep existing future fixtures; add replacements once both convoys have passed.
    for (const event of dataset.events) {
      const existingEvents = await c.select().from(events).where(eq(events.game, event.game));
      if (
        existingEvents.some(
          (saved) =>
            saved.id === event.id ||
            (saved.startsAt > now.toISOString() && saved.status === "scheduled"),
        )
      )
        continue;
      const revisionId = demoId(`revision/${event.id}`);
      await c.insert(events).values({
        id: event.id,
        game: event.game,
        version: 1,
        changeSequence: 1,
        attendanceVersion: 1,
        visibility: "members",
        status: "scheduled",
        startsAt: event.startsAt,
        createdAt: now.toISOString(),
      });
      await c.insert(eventRevisions).values({
        id: revisionId,
        eventId: event.id,
        version: 1,
        sequence: 1,
        actorId: director.id,
        recordedAt: now.toISOString(),
        category: "created",
        status: "scheduled",
        title: event.title,
        description:
          "Synthetic local convoy for dashboard development. No actual event is scheduled.",
        game: event.game,
        server: "Demo simulation",
        organizer: "Demo company",
        meetingLocation: event.game === "ets2" ? "Berlin demo depot" : "Seattle demo depot",
        route: event.route,
        meetingAt: event.meetingAt,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        visibility: "members",
      });
      await c.update(events).set({ currentRevisionId: revisionId }).where(eq(events.id, event.id));
      addedEvents++;
    }
    return { addedTrips, addedEvents, members: demoMembers.length };
  });
}
