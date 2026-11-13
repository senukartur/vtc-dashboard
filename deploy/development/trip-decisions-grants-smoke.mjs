import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { createUnitOfWork, newId, settingsFromEnvironment } from "@vtc/db";
import { reconciliationCandidates, reconciliationRules } from "@vtc/db/reconciliation-schema";
import { eq, sourceMessages, sourceTrips, tripContributions, trips } from "@vtc/db/trips-schema";
import {
  createQualificationInitialization,
  structuralLevels,
} from "../dist/modules/qualifications/initialization.js";
import { ruleIdentity, ruleSnapshot } from "../dist/modules/reconciliation/matcher.js";
import { createFactRepository } from "../dist/modules/trips/facts.js";
import { createQueue } from "../dist/platform/jobs/queue.js";
import { runPass } from "../dist/platform/jobs/runner.js";
import { composeIdentity } from "../dist/use-cases/identity-messaging.js";

assert.equal(process.env.MANUAL_SYNTHETIC_ACK, "synthetic-only");
const phase = process.argv[2],
  run = process.env.MANUAL_REHEARSAL_RUN ?? "";
assert.ok(
  ["seed", "produce", "worker", "produce-stage3", "seed-stage3-worker", "worker-stage3"].includes(
    phase,
  ),
);
assert.match(run, /^[a-f0-9]{32}$/);
const mysql = createRequire(import.meta.resolve("@vtc/db"))("mysql2/promise"),
  connection = await mysql.createConnection(settingsFromEnvironment());
const [guard] = await connection.execute(
  "SELECT run_id,refs FROM synthetic_trip_decision_guard WHERE id=1",
);
assert.equal(guard[0]?.run_id, run, "SYNTHETIC_TRIP_DECISION_GUARD_REQUIRED");
const unit = createUnitOfWork(settingsFromEnvironment()),
  key = (purpose) =>
    createHash("sha256")
      .update(run + purpose)
      .digest("hex"),
  password = "Fictional-manual-rehearsal-passphrase-42",
  origin = "http://127.0.0.1:4173";
const compose = (stage3 = false) =>
  composeIdentity(
    unit,
    { secret: key("identity"), origin, production: false },
    undefined,
    undefined,
    false,
    { cursorKey: key("catalog") },
    { cursorKey: key("trips") },
    undefined,
    { key: key("manual"), maxFilesPerReport: 5, policyRevision: 1, orphanGraceMs: 60000 },
    { cursorKey: key("qualifications") },
    { cursorKey: key("events") },
    { key: key("reconciliation") },
    { key: key("decisions") },
    undefined,
    undefined,
    undefined,
    stage3,
  );
const stage3 = phase === "produce-stage3" || phase === "worker-stage3";
const composed = compose(stage3);
const {
  identity,
  workspaceSummary,
  reconciliation,
  catalogs,
  qualifications,
  trips: _tripService,
  manualReports: manual,
  tripDecisions: service,
} = composed;
let step = "guard";
try {
  if (phase === "seed") {
    step = "seed_identity";
    const login = await identity.login("manual-rehearsal-director@example.invalid", password),
      director = await identity.authenticate(
        new Headers({ cookie: login.cookies.map((c) => c.split(";", 1)[0]).join("; ") }),
      );
    const ownerId = newId(),
      credential = await identity.prepareCredential(password);
    await unit.run(async (tx) => {
      await identity.insertWithCredential(tx, {
        userId: ownerId,
        email: "decision-proof-driver@example.invalid",
        name: "Fictional Decision Driver",
        ...credential,
        roles: ["driver"],
      });
      await createQualificationInitialization(unit).initialize(tx, {
        userId: ownerId,
        games: ["ets2"],
        assignedAt: "2020-01-01T00:00:00.000Z",
      });
    });
    step = "seed_catalog";
    const seed = async (list, name) => {
      const item = await catalogs.create(director, list, newId(), {
        game: "ets2",
        code: `fictional_${name}`,
        nameEn: `Fictional ${name}`,
      });
      return { entityId: item.id };
    };
    const pins = new Map([
      ["origin", await seed("cities", "origin")],
      ["destination", await seed("cities", "destination")],
      ["cargo", await seed("cargoes", "cargo")],
      ["trailer", await seed("trailers", "trailer")],
    ]);
    step = "seed_rules";
    const level = (await qualifications.levels(director, "ets2")).items.find(
      (l) => l.id === structuralLevels.ets2[0],
    );
    await qualifications.publish(director, level.id, newId(), level.version, {
      rules: [{ type: "max_mass", maxKg: "20000" }],
      requiredTrips: 1,
      requiredDistanceM: "100",
      reason: "Fictional restricted proof configuration",
    });
    step = "seed_facts";
    const tripIds = [],
      factIds = [];
    for (let n = 0; n < 6; n++)
      await unit.run(async (tx) => {
        const tripId = newId(),
          sourceId = newId(),
          messageId = newId(),
          factId = newId(),
          time = new Date().toISOString(),
          known = (value, field) => ({
            status: "known",
            value,
            sourceRecordId: messageId,
            sourceField: field,
          }),
          unknown = () => ({
            status: "unknown",
            reasonCode: "synthetic_not_supported",
            sourceRecordId: messageId,
          });
        await unit
          .client(tx)
          .insert(trips)
          .values({
            id: tripId,
            ownerId,
            game: "ets2",
            version: 1,
            outcome: "delivered",
            recording: n === 4 ? "partial" : "complete",
            decision: "unassessed",
            currentFactId: factId,
            ...(n >= 2 && { assessmentPending: false }),
            reviewReasons: [],
            createdAt: time,
          });
        await unit
          .client(tx)
          .insert(sourceTrips)
          .values({
            id: sourceId,
            provider: "ets2telemetry",
            game: "ets2",
            sessionKey: Buffer.from(newId()),
            tripKey: Buffer.from(newId()),
            ownerId,
            canonicalTripId: tripId,
            latestRevision: "1",
            connectionContext: { state: "unknown", referenceId: null },
            createdAt: time,
          });
        await unit
          .client(tx)
          .insert(sourceMessages)
          .values({
            id: messageId,
            sourceTripId: sourceId,
            provider: "ets2telemetry",
            eventKey: Buffer.from(newId()),
            revision: "1",
            sha256: randomBytes(32),
            receivedAt: time,
            deliveryMode: "backfill",
          });
        const e = {
          sourceRecordId: messageId,
          factRevisionId: factId,
          provider: "ets2telemetry",
          ownerUserId: ownerId,
          game: "ets2",
          outcome: "delivered",
          recording: n === 4 ? "partial" : "complete",
          start: { utc: time, basis: "event", verifiedActual: true },
          end: { utc: time, basis: "event", verifiedActual: true },
          origin: known(pins.get("origin"), "synthetic.origin"),
          destination: known(pins.get("destination"), "synthetic.destination"),
          cargo: known(pins.get("cargo"), "synthetic.cargo"),
          cargoMassKg: known("18000", "synthetic.mass"),
          actualDistanceM: known("123400", "synthetic.distance"),
          measuredSegmentM: unknown(),
          plannedDistanceM: unknown(),
          deliveredDistanceM: unknown(),
          fuelUsedL: unknown(),
          cargoDamageFraction: unknown(),
          money: null,
          provenance: { synthetic: true },
          wholeTripDistanceSupported: true,
          trailers: { complete: true, items: [known(pins.get("trailer"), "synthetic.trailer")] },
          adrCategory: unknown(),
          ruleContextComplete: false,
          reasonCodes: [],
        };
        await createFactRepository(unit).insert(tx, tripId, e, 2);
        tripIds.push(tripId);
        factIds.push(factId);
      });
    const candidateId = newId();
    await unit.run(async (tx) => {
      const time = new Date().toISOString();
      const hash = ruleIdentity(undefined);
      const [rule] = await unit
        .client(tx)
        .select({ hash: reconciliationRules.hash })
        .from(reconciliationRules)
        .where(eq(reconciliationRules.hash, hash));
      if (!rule)
        await unit
          .client(tx)
          .insert(reconciliationRules)
          .values({
            hash,
            version: null,
            config: ruleSnapshot(undefined),
            createdAt: time,
          });
      await unit
        .client(tx)
        .insert(reconciliationCandidates)
        .values([
          {
            id: candidateId,
            ownerId,
            game: "ets2",
            ruleHash: hash,
            searchHash: randomBytes(32),
            primaryTripId: tripIds[2],
            secondaryTripId: tripIds[3],
            primaryVersion: 1,
            secondaryVersion: 1,
            evidence: { factIds: [factIds[2], factIds[3]].sort() },
            reasons: ["synthetic_duplicate"],
            active: true,
            createdAt: time,
          },
          {
            id: newId(),
            ownerId,
            game: "ets2",
            ruleHash: hash,
            searchHash: randomBytes(32),
            primaryTripId: tripIds[0],
            secondaryTripId: tripIds[3],
            primaryVersion: 1,
            secondaryVersion: 1,
            evidence: { factIds: [factIds[0], factIds[3]].sort() },
            reasons: ["synthetic_duplicate"],
            active: true,
            createdAt: time,
          },
        ]);
    });
    await connection.execute("UPDATE synthetic_trip_decision_guard SET refs=? WHERE id=1", [
      JSON.stringify({
        runtimeTripId: tripIds[0],
        workerTripId: tripIds[1],
        candidateId,
        stage3WorkerTripId: tripIds[4],
        stage3RuntimeTripId: tripIds[5],
        candidatePrimaryId: tripIds[2],
        candidateSecondaryId: tripIds[3],
      }),
    ]);
  } else {
    const refs = typeof guard[0].refs === "string" ? JSON.parse(guard[0].refs) : guard[0].refs;
    if (phase === "seed-stage3-worker") {
      step = "seed_stage3_worker_input";
      const [result] = await connection.execute(
        "UPDATE trips SET assessment_pending=TRUE WHERE id=? AND decision='unassessed' AND assessment_pending=FALSE",
        [refs.stage3WorkerTripId],
      );
      assert.equal(result.affectedRows, 1);
      await unit.run(async (tx) => {
        const db = unit.client(tx);
        await db.update(trips).set({ version: 2 }).where(eq(trips.id, refs.candidatePrimaryId));
        const snapshotQueue = createQueue(unit, [reconciliation.handler]);
        await snapshotQueue.enqueue(tx, {
          kind: "reconciliation.search",
          consumer: "reconciliation-search-v1",
          schemaVersion: 1,
          eventId: null,
          effectKey: `synthetic-snapshot:${run}`,
          reference: {
            tripId: refs.candidatePrimaryId,
            previous: 1,
            version: 2,
            cursor: "00000000-0000-4000-8000-000000000000",
          },
          availableAt: new Date().toISOString(),
          maxAttempts: 5,
        });
      });
    } else {
      const denied = (error) => [1044, 1142, 1143, 1227].includes(error.errno);
      if (!stage3) {
        step = "disabled_stage3_tables_denied";
        for (const table of ["trip_review_reasons", "reconciliation_candidate_dismissals"])
          await assert.rejects(connection.query(`SELECT 1 FROM ${table} LIMIT 1`), denied);
      }
      if (phase === "produce") {
        step = "runtime_review";
        const login = await identity.login("manual-rehearsal-director@example.invalid", password),
          actor = await identity.authenticate(
            new Headers({ cookie: login.cookies.map((c) => c.split(";", 1)[0]).join("; ") }),
          ),
          id = refs.runtimeTripId,
          review = await service.review(actor, id),
          commandKey = newId(),
          input = {
            decision: "accept",
            reviewedRevisionId: review.data.factRevisionId,
            factRevisionId: review.data.factRevisionId,
            proposalId: null,
            reason: "Fictional restricted runtime acceptance",
          };
        step = "runtime_decision";
        const accepted = await service.decide(actor, id, commandKey, review.version, input);
        assert.equal(accepted.data.outcome, "accepted");
        const [refreshed] = await connection.execute(
          "SELECT primary_version FROM reconciliation_candidates WHERE active=TRUE AND primary_trip_id=? AND secondary_trip_id=?",
          [id, refs.candidateSecondaryId],
        );
        assert.equal(refreshed.length, 1);
        assert.equal(refreshed[0].primary_version, accepted.version);
        assert.deepEqual(
          await service.decide(actor, id, commandKey, review.version, input),
          accepted,
        );
        step = "runtime_correction";
        const ownerLogin = await identity.login("decision-proof-driver@example.invalid", password),
          owner = await identity.authenticate(
            new Headers({ cookie: ownerLogin.cookies.map((c) => c.split(";", 1)[0]).join("; ") }),
          );
        const request = await manual.requestCorrection(owner, id, newId(), accepted.version, {
          reason: "Fictional linked runtime request",
        });
        const proposal = await service.propose(actor, id, newId(), request.version, {
            reason: "Fictional supported distance correction",
            evidenceIds: [],
            actualDistanceM: "200000",
            correctionRequestId: request.id,
          }),
          detail = await service.getProposal(actor, id, proposal.data.id),
          corrected = await service.proposalDecision(
            actor,
            id,
            detail.data.id,
            newId(),
            detail.version,
            {
              decision: "approve",
              reviewedRevisionId: detail.data.revisionId,
              reason: "Fictional verified corrected distance",
            },
          );
        assert.notEqual(corrected.data.basis.factRevisionId, review.data.factRevisionId);
        const requestReadback = await manual.corrections(owner, id, {}, request.id);
        assert.equal(requestReadback.data.status, "resolved");
        assert.deepEqual(requestReadback.data.history.map((h) => h.status).sort(), [
          "pending",
          "resolved",
        ]);
        const related = await service.proposals(actor, id);
        const originating = related.items.find(
          (p) => p.kind === "correction_request" && p.correctionRequestId === request.id,
        );
        assert.equal(originating.state, "approved");
        assert.equal(detail.data.correctionRequestId, request.id);
        const [credit] = await unit.run((tx) =>
          unit.client(tx).select().from(tripContributions).where(eq(tripContributions.tripId, id)),
        );
        assert.equal(credit.credited, true);
        assert.equal(credit.factId, corrected.data.basis.factRevisionId);
        assert.equal(credit.actualDistanceM, "200000.000000000000000000");
        step = "runtime_disabled_workspace";
        const workspace = await workspaceSummary.readStage3(actor);
        assert.ok(workspace.legacyReviewQueue);
        assert.equal(workspace.reviewQueue, undefined);
        await manual.requestCorrection(owner, id, newId(), corrected.version, {
          reason: "Fictional pending request observed by restricted worker",
        });
      } else if (phase === "produce-stage3") {
        step = "runtime_stage3_projection_and_dismissal";
        const login = await identity.login("manual-rehearsal-director@example.invalid", password);
        const actor = await identity.authenticate(
          new Headers({
            cookie: login.cookies.map((entry) => entry.split(";", 1)[0]).join("; "),
          }),
        );
        const id = refs.stage3RuntimeTripId;
        const review = await service.reviewStage3(actor, id);
        const accepted = await service.decide(
          actor,
          id,
          newId(),
          review.version,
          {
            decision: "accept",
            proposalId: null,
            factRevisionId: review.data.factRevisionId,
            reviewedRevisionId: review.data.factRevisionId,
          },
          true,
        );
        assert.equal(accepted.data.outcome, "accepted");
        assert.equal(accepted.data.reason, null);
        const workspace = await workspaceSummary.readStage3(actor);
        assert.ok(workspace.reviewQueue);
        assert.equal(workspace.legacyReviewQueue, undefined);
        const candidates = await reconciliation.stage3List(actor, { game: "ets2" });
        assert.equal(
          candidates.items.some(({ id }) => id === refs.candidateId),
          true,
        );
        const dismissalKey = newId();
        const value = { reason: "Fictional restricted dismissal" };
        const dismissal = await reconciliation.dismissCandidate(
          actor,
          refs.candidateId,
          dismissalKey,
          1,
          value,
        );
        assert.equal(dismissal.version, 2);
        const undo = await reconciliation.dismissCandidate(
          actor,
          refs.candidateId,
          newId(),
          2,
          null,
        );
        assert.equal(undo.version, 3);
        assert.deepEqual(
          await reconciliation.dismissCandidate(actor, refs.candidateId, dismissalKey, 1, value),
          dismissal,
        );
      } else if (phase === "worker-stage3") {
        step = "worker_stage3_reason_projection";
        await assert.rejects(
          connection.query("UPDATE reconciliation_candidate_dismissals SET reason=reason"),
          denied,
        );
        await service.catchup();
        const queue = createQueue(unit, [service.handler, reconciliation.handler]);
        await runPass(queue, new AbortController().signal);
        const read = async () => {
          const [rows] = await connection.execute(
            "SELECT r.code, t.queued_at FROM trip_review_reasons r JOIN trips t ON t.id=r.trip_id WHERE r.trip_id=? ORDER BY r.code",
            [refs.stage3WorkerTripId],
          );
          return rows;
        };
        const first = await read();
        assert.ok(first.length > 0 && first.every((row) => row.queued_at !== null));
        step = "worker_stage3_candidate_continuation";
        const readCandidate = async () => {
          const [rows] = await connection.execute(
            "SELECT CAST(id AS CHAR) id, primary_version, secondary_version FROM reconciliation_candidates WHERE active=TRUE AND primary_trip_id=? AND secondary_trip_id=?",
            [refs.candidatePrimaryId, refs.candidateSecondaryId],
          );
          return rows;
        };
        const replacements = await readCandidate();
        assert.equal(replacements.length, 1);
        assert.notEqual(replacements[0].id, refs.candidateId);
        assert.equal(replacements[0].primary_version, 2);
        assert.equal(replacements[0].secondary_version, 1);
        await runPass(queue, new AbortController().signal);
        assert.deepEqual(await read(), first);
        assert.deepEqual(await readCandidate(), replacements);
      } else {
        step = "worker_pending_requests";
        assert.equal(
          await unit.run(async (tx) => {
            await identity.qualificationContextInTransaction(tx, []);
            return manual.hasPendingCorrectionsInTransaction(tx, refs.runtimeTripId);
          }),
          true,
        );
        await assert.rejects(
          connection.query("UPDATE manual_correction_requests SET status=status"),
          (e) => [1044, 1142, 1143, 1227].includes(e.errno),
        );
        step = "worker_catchup";
        await service.catchup();
        await runPass(createQueue(unit, [service.handler]), new AbortController().signal);
        const [credit] = await unit.run((tx) =>
          unit
            .client(tx)
            .select()
            .from(tripContributions)
            .where(eq(tripContributions.tripId, refs.workerTripId)),
        );
        assert.equal(credit.credited, true);
        assert.equal(credit.actualDistanceM, "123400.000000000000000000");
        const before = JSON.stringify(credit);
        await runPass(createQueue(unit, [service.handler]), new AbortController().signal);
        const [after] = await unit.run((tx) =>
          unit
            .client(tx)
            .select()
            .from(tripContributions)
            .where(eq(tripContributions.tripId, refs.workerTripId)),
        );
        assert.equal(JSON.stringify(after), before);
      }
      step = "immutable_denials";
      for (const statement of [
        "CREATE TABLE forbidden_decision (id INT)",
        "UPDATE manual_correction_requests SET reason=reason",
        "DELETE FROM manual_correction_requests",
        "UPDATE manual_correction_history SET reason=reason",
        "DELETE FROM manual_correction_history",
        "UPDATE trip_decisions SET reason=reason",
        "DELETE FROM trip_decisions",
        "UPDATE trip_proposals SET reason=reason",
        "DELETE FROM trip_proposals",
        "UPDATE trip_proposal_reviews SET reason=reason",
        "DELETE FROM trip_proposal_reviews",
        "UPDATE trip_decision_commands SET result=result",
        "DELETE FROM trip_decision_commands",
        "UPDATE trip_resolutions SET reason=reason",
        "DELETE FROM trip_resolutions",
        "UPDATE source_messages SET revision=revision",
        "DELETE FROM source_messages",
        "UPDATE trip_facts SET actual_distance_m=actual_distance_m",
        "DELETE FROM trip_facts",
        "UPDATE trip_contribution_history SET snapshot=snapshot",
        "UPDATE reconciliation_candidates SET evidence=evidence",
        "DELETE FROM reconciliation_candidate_dismissals",
        "UPDATE reconciliation_candidate_dismissals SET candidate_id=candidate_id",
      ])
        await assert.rejects(connection.query(statement), denied);
    }
  }
  console.log(JSON.stringify({ event: "trip_decision_restricted_proof", phase, result: "pass" }));
} catch {
  console.error(
    JSON.stringify({ event: "trip_decision_restricted_proof", phase, step, result: "fail" }),
  );
  throw Error("TRIP_DECISION_RESTRICTED_PROOF_FAILED");
} finally {
  await connection.end();
  await unit.close();
}
