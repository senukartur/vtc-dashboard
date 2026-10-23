import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { createUnitOfWork, newId, settingsFromEnvironment } from "@vtc/db";
import { sourceMessages, sourceTrips, trips, eq, tripContributions } from "@vtc/db/trips-schema";
import { createFactRepository } from "../dist/modules/trips/facts.js";
import {
  createQualificationInitialization,
  structuralLevels,
} from "../dist/modules/qualifications/initialization.js";
import { composeIdentity } from "../dist/use-cases/identity-messaging.js";
import { createQueue } from "../dist/platform/jobs/queue.js";
import { runPass } from "../dist/platform/jobs/runner.js";
assert.equal(process.env.MANUAL_SYNTHETIC_ACK, "synthetic-only");
const phase = process.argv[2],
  run = process.env.MANUAL_REHEARSAL_RUN ?? "";
assert.ok(["seed", "produce", "worker"].includes(phase));
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
const composed = composeIdentity(
  unit,
  { secret: key("identity"), origin, production: false },
  undefined,
  undefined,
  false,
  {
    production: false,
    synthetic: true,
    cursorKey: key("catalog"),
    maxFileBytes: 1048576,
    artifactTtlMs: 86400000,
    policyRevision: 1,
    evidence: [],
  },
  { cursorKey: key("trips") },
  undefined,
  { key: key("manual"), maxFilesPerReport: 5, policyRevision: 1, orphanGraceMs: 60000 },
  { cursorKey: key("qualifications") },
  { cursorKey: key("events") },
  { key: key("reconciliation") },
  { key: key("decisions") },
);
const {
  identity,
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
    const entity = (name, kind) => ({
        key: name,
        kind,
        mapNamespace: "synthetic",
        packId: "base",
        retired: false,
        labels: { en: `Fictional ${name}`, ru: null },
        aliases: [],
        mappings: [],
        regionKey: null,
        cargoUnitMassKg: null,
        adrCategoryKey: null,
        trailerBodyTypeKey: null,
        trailerChainTypeKey: null,
      }),
      entities = [
        entity("origin", "city"),
        entity("destination", "city"),
        entity("cargo", "cargo"),
        entity("trailer", "trailer_type"),
      ],
      artifact = {
        schemaVersion: 1,
        importerVersion: "vtc-catalogs/1",
        synthetic: true,
        game: "ets2",
        gameBuild: "synthetic-decision-proof",
        releaseInventoryAsOf: "2026-10-20",
        sourceManifestSha256: "a".repeat(64),
        packs: [
          {
            packId: "base",
            title: "Fictional base",
            state: "validated",
            contributionKinds: ["city", "cargo", "trailer_type"],
            provenance: [],
            reasonCodes: [],
          },
        ],
        provenance: [],
        entities,
        mappingIssues: [],
      };
    const uploaded = await catalogs.upload(
        director,
        newId(),
        Buffer.from(JSON.stringify(artifact)),
      ),
      op = await catalogs.import(director, newId(), {
        artifactId: uploaded.id,
        sha256: uploaded.sha256,
        game: "ets2",
      });
    await runPass(createQueue(unit, [catalogs.handler]), new AbortController().signal);
    const completed = await catalogs.operation(director, op.id);
    assert.equal(completed.state, "completed");
    const revisionId = completed.resultId,
      r = await catalogs.detail(director, revisionId);
    await catalogs.publish(director, revisionId, newId(), r.version, {
      expectedPublicationVersion: r.publicationVersion,
      reason: "Fictional restricted acceptance dataset",
    });
    const pins = new Map();
    for (const kind of ["city", "cargo", "trailer_type"])
      for (const row of (await catalogs.entities(director, { revisionId, kind, locale: "en" }))
        .items) {
        const p = await unit.run((tx) => catalogs.pinnedInTransaction(tx, revisionId, row.id));
        pins.set(row.display.label.replace("Fictional ", ""), {
          entityId: row.id,
          catalogRevisionId: revisionId,
          factRevisionId: p.id,
        });
      }
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
    const tripIds = [];
    for (let n = 0; n < 2; n++)
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
        await unit.client(tx).insert(trips).values({
          id: tripId,
          ownerId,
          game: "ets2",
          version: 1,
          outcome: "delivered",
          recording: "complete",
          decision: "unassessed",
          currentFactId: factId,
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
          recording: "complete",
          catalogRevisionId: null,
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
      });
    await connection.execute("UPDATE synthetic_trip_decision_guard SET refs=? WHERE id=1", [
      JSON.stringify({ runtimeTripId: tripIds[0], workerTripId: tripIds[1] }),
    ]);
  } else {
    const refs = typeof guard[0].refs === "string" ? JSON.parse(guard[0].refs) : guard[0].refs;
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
      await manual.requestCorrection(owner, id, newId(), corrected.version, {
        reason: "Fictional pending request observed by restricted worker",
      });
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
    ])
      await assert.rejects(connection.query(statement), (e) =>
        [1044, 1142, 1143, 1227].includes(e.errno),
      );
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
