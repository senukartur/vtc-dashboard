import { createHash } from "node:crypto";
import type { UnitOfWork } from "@vtc/db";
import {
  catalogArtifacts,
  catalogEntities,
  catalogFacts,
  catalogRevisions,
} from "@vtc/db/catalogs-schema";
import { eventRevisions, events } from "@vtc/db/events-schema";
import { and, company, eq, membership } from "@vtc/db/identity-schema";
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
import { demoDataset, demoEpoch, demoId, demoMembers, games } from "./demo-dataset.js";
import type { Identity } from "./modules/identity/service.js";
import { structuralLevels } from "./modules/qualifications/initialization.js";
import type { Fact, NormalizedTripEvidence } from "./modules/sources/contracts/evidence.js";
import { createContributionRegister } from "./modules/trips/contributions.js";
import { createFactRepository } from "./modules/trips/facts.js";

// Explicit fixture writer: application startup and the worker never import it. It runs only through
// the guarded local CLI (scripts/demo/cli.ts) and the root stage operation (stage-seed.ts).
export async function seedDashboard(
  unit: UnitOfWork,
  identity: Identity,
  passwordHash: string,
  now = new Date(),
  options: { adoptCompany?: boolean } = {},
) {
  const dataset = demoDataset(now);
  const demoDirector = demoMembers[0];
  if (!demoDirector) throw new Error("DEMO_MEMBER_MISSING");
  const facts = createFactRepository(unit);
  const contributions = createContributionRegister(unit);
  return unit.run(async (tx) => {
    const c = unit.client(tx);
    const [existing] = await c.select().from(company).where(eq(company.singleton, 1)).for("update");
    if (options.adoptCompany && !existing) throw new Error("DEMO_COMPANY_REQUIRED");
    const adopted =
      !!existing &&
      (existing.id !== demoId("company") || existing.directorUserId !== demoDirector.id);
    if (adopted && !options.adoptCompany) throw new Error("DEMO_REFUSES_EXISTING_COMPANY");
    // An adopted director stands in for the first demo member, so their own pages have data too.
    const director = adopted ? { ...demoDirector, id: existing.directorUserId } : demoDirector;
    const members = demoMembers.map((member, index) => (index === 0 ? director : member));
    const ownerOf = (id: string) => (id === demoDirector.id ? director.id : id);
    const [installed] = await c
      .select({ id: catalogRevisions.id })
      .from(catalogRevisions)
      .where(eq(catalogRevisions.id, demoId("catalog/ets2")));
    if (adopted && !installed) {
      // First install only: this fixture is never written beside real members or a real catalog.
      const others = await c.select({ id: membership.userId }).from(membership);
      if (others.some((member) => member.id !== director.id))
        throw new Error("DEMO_REFUSES_EXISTING_MEMBERS");
      const [catalog] = await c.select({ id: catalogRevisions.id }).from(catalogRevisions).limit(1);
      if (catalog) throw new Error("DEMO_REFUSES_EXISTING_CATALOG");
    }
    if (!installed) {
      for (const member of adopted ? members.slice(1) : members) {
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
      if (!adopted)
        await c.insert(company).values({
          singleton: 1,
          id: demoId("company"),
          directorUserId: director.id,
          reportingTimezone: "Europe/Moscow",
        });
      else if (!existing.reportingTimezone)
        await c
          .update(company)
          .set({ reportingTimezone: "Europe/Moscow" })
          .where(eq(company.singleton, 1));
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
        for (const member of members) {
          const [held] = await c
            .select({ userId: qualificationStates.userId })
            .from(qualificationStates)
            .where(
              and(eq(qualificationStates.userId, member.id), eq(qualificationStates.game, game)),
            );
          if (held) continue;
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
                ["Demo curtainsider", "Демо: тентованный прицеп"],
              ]
            : [
                ["Seattle", "Сиэтл"],
                ["Portland", "Портленд"],
                ["Demo lumber", "Демо: пиломатериалы"],
                ["Demo flatbed", "Демо: платформа"],
              ];
        for (const [index, label] of labels.entries()) {
          const entityId = demoId(`entity/${game}/${index}`),
            kind = index === 3 ? "trailer_type" : index === 2 ? "cargo" : "city";
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
    // A member's current assignment decides the credit, including one the director already held.
    async function creditOf(userId: string, game: (typeof games)[number], rank: number) {
      const [current] = await c
        .select({ id: qualificationAssignments.id, levelId: qualificationAssignments.levelId })
        .from(qualificationStates)
        .innerJoin(
          qualificationAssignments,
          eq(qualificationAssignments.id, qualificationStates.assignmentId),
        )
        .where(and(eq(qualificationStates.userId, userId), eq(qualificationStates.game, game)));
      const levels: readonly string[] = structuralLevels[game];
      const held = current ? levels.indexOf(current.levelId) : -1;
      return {
        assignmentId: current?.id ?? demoId(`assignment/${userId}/${game}`),
        ruleVersionId: demoId(`rule/${game}/${held < 0 ? rank : held}`),
      };
    }
    let addedTrips = 0,
      addedEvents = 0;
    for (const fixture of dataset.trips) {
      const trip = { ...fixture, ownerId: ownerOf(fixture.ownerId) };
      const [saved] = await c.select({ id: trips.id }).from(trips).where(eq(trips.id, trip.id));
      if (saved) continue;
      const sourceId = demoId(`source/${trip.id}`),
        messageId = demoId(`message/${trip.id}`),
        factId = demoId(`fact/${trip.id}`);
      const member = members.find((member) => member.id === trip.ownerId);
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
        trailers: open ? { complete: false, items: [] } : { complete: true, items: [pin(3)] },
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
      const credit = accepted ? await creditOf(trip.ownerId, trip.game, member.rank) : null;
      const [context] = await contributions.contexts(tx, [
        { tripId: trip.id, expectedTripVersion: 1, version: 1, factId },
      ]);
      if (!context) throw new Error("DEMO_CONTRIBUTION_MISSING");
      await contributions.replace(
        tx,
        context,
        {
          assignmentId: credit?.assignmentId ?? null,
          ruleVersionId: credit?.ruleVersionId ?? null,
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
