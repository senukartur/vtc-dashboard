import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { applicationId, createUnitOfWork, newId, settingsFromEnvironment } from "@vtc/db";
import { eq, trips } from "@vtc/db/trips-schema";
import sharp from "sharp";
import { createCatalogs } from "../dist/modules/catalogs/service.js";
import { createIdentity } from "../dist/modules/identity/service.js";
import { createManualReports } from "../dist/modules/manual-reports/service.js";
import { createTrips } from "../dist/modules/trips/service.js";
import { createQueue } from "../dist/platform/jobs/queue.js";
import { runPass } from "../dist/platform/jobs/runner.js";
import { catalogEvents, identityAccessEvents } from "../dist/platform/outbox/events.js";

// This script runs only in the uniquely allocated synthetic rehearsal database.
assert.equal(process.env.MANUAL_SYNTHETIC_ACK, "synthetic-only");
assert.ok(["produce", "worker"].includes(process.argv[2]));
const proofRun = process.env.MANUAL_REHEARSAL_RUN ?? "";
assert.ok(/^[a-f0-9]{32}$/.test(proofRun), "MANUAL_SYNTHETIC_GUARD_REQUIRED");
assert.equal(
  await readFile("/app/private-evidence/.manual-rehearsal-guard", "utf8"),
  proofRun,
  "MANUAL_SYNTHETIC_VOLUME_REQUIRED",
);
const guardMysql = createRequire(import.meta.resolve("@vtc/db"))("mysql2/promise");
let guardConnection;
try {
  guardConnection = await guardMysql.createConnection(settingsFromEnvironment());
  const [rows] = await guardConnection.query(
    "SELECT run_id FROM synthetic_manual_guard WHERE id=1",
  );
  assert.ok(rows.length === 1 && rows[0].run_id === proofRun, "MANUAL_SYNTHETIC_GUARD_REQUIRED");
} catch {
  throw Error("MANUAL_SYNTHETIC_GUARD_REQUIRED");
} finally {
  await guardConnection?.end();
}

const key = () => randomBytes(32).toString("hex"),
  unit = createUnitOfWork(settingsFromEnvironment());
const identity = createIdentity(
  unit,
  { secret: key(), origin: "http://127.0.0.1:4173", production: false },
  { accessEvents: identityAccessEvents(unit) },
);
const catalogs = createCatalogs(
  unit,
  {
    production: false,
    synthetic: true,
    cursorKey: key(),
    maxFileBytes: 1024 * 1024,
    artifactTtlMs: 86400000,
    policyRevision: 1,
    evidence: [],
  },
  { identity, published: catalogEvents(unit).append },
);
let clock = new Date("2020-01-01T00:00:00.000Z"),
  manual;
const tripsService = createTrips(
  unit,
  { cursorKey: key() },
  {
    identity,
    catalogs,
    manualEvidence: (tx, owner, payload, tripId) =>
      manual.validateSourceInTransaction(tx, owner, payload, tripId),
    manualProjection: (tx, ids) => manual.projectionInTransaction(tx, ids),
  },
  () => clock,
);
manual = createManualReports(
  unit,
  {
    key: key(),
    maxFilesPerReport: 2,
    policyRevision: 1,
    orphanGraceMs: 60000,
    storage: {
      root: "/app/private-evidence",
      maxFileBytes: 1024 * 1024,
      maxPixels: 10000,
      timeoutMs: 5000,
    },
  },
  { identity, catalogs, trips: tripsService },
  () => clock,
);
let smokePhase = "initialize";
try {
  await manual.initialize("/app/public");
  if (process.argv[2] === "produce") {
    smokePhase = "bootstrap";
    const password = "Fictional-manual-rehearsal-passphrase-42";
    await identity.bootstrap({
      email: "manual-rehearsal-director@example.invalid",
      name: "Fictional Manual Director",
      password,
    });
    smokePhase = "owner_login";
    const login = await identity.login("manual-rehearsal-director@example.invalid", password);
    smokePhase = "owner_authenticate";
    const cookie = login.cookies.map((value) => value.split(";", 1)[0]).join("; "),
      owner = await identity.authenticate(new Headers({ cookie }));
    smokePhase = "staff_credential";
    const staffId = newId(),
      credential = await identity.prepareCredential(password);
    smokePhase = "staff_insert";
    await unit.run((tx) =>
      identity.insertWithCredential(tx, {
        userId: staffId,
        email: "manual-rehearsal-reviewer@example.invalid",
        name: "Fictional Manual Reviewer",
        ...credential,
        roles: ["dispatcher"],
      }),
    );
    smokePhase = "staff_login";
    const staffLogin = await identity.login("manual-rehearsal-reviewer@example.invalid", password);
    smokePhase = "staff_authenticate";
    const staff = await identity.authenticate(
      new Headers({
        cookie: staffLogin.cookies.map((value) => value.split(";", 1)[0]).join("; "),
      }),
    );
    smokePhase = "fixture_encode";
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "black" } })
      .png()
      .toBuffer();
    smokePhase = "receipt_lock_privileges";
    const receiptMysql = createRequire(import.meta.resolve("@vtc/db"))("mysql2/promise"),
      receiptConnection = await receiptMysql.createConnection(settingsFromEnvironment());
    try {
      await receiptConnection.beginTransaction();
      for (const table of ["manual_commands", "source_messages"]) {
        await assert.rejects(
          receiptConnection.query(`SELECT * FROM ${table} LIMIT 1 FOR UPDATE`),
          (error) => [1142, 1143].includes(error.errno),
        );
        await receiptConnection.query(`SELECT * FROM ${table} LIMIT 1 FOR SHARE`);
      }
      await receiptConnection.rollback();
    } finally {
      await receiptConnection.end();
    }
    smokePhase = "upload";
    const image = await manual.upload(
      owner,
      newId(),
      "synthetic.png",
      (async function* () {
        yield bytes;
      })(),
      "image/png",
    );
    const unresolved = {
      status: "unresolved",
      label: "Fictional selection",
      reasonCode: "not_listed",
      locale: "en",
      context: null,
    };
    const fields = {
      game: "ets2",
      origin: unresolved,
      destination: unresolved,
      cargo: unresolved,
      trailerType: unresolved,
      cargoMassKg: "0",
      actualDistanceM: "1",
      evidenceIds: [image.id],
    };
    smokePhase = "draft";
    const draft = await manual.createDraft(owner, newId(), { fields });
    smokePhase = "submit";
    const report = await manual.submitDraft(owner, draft.id, newId(), draft.version, { fields });
    smokePhase = "private_read";
    assert.equal((await manual.getReport(staff, report.id)).id, report.id);
    smokePhase = "decision_seam";
    await unit.run(async (tx) => {
      await identity.authorizeInTransaction(tx, staff, "trips.review");
      await tripsService.manualGateInTransaction(tx, owner.userId, report.tripId);
      await unit
        .client(tx)
        .update(trips)
        .set({ decision: "accepted", reviewHold: false, correctionPending: false })
        .where(eq(trips.id, report.tripId));
      await manual.decisionRecordedInTransaction(
        tx,
        staff,
        report.id,
        report.currentRevision.id,
        clock.toISOString(),
      );
    });
  } else {
    smokePhase = "worker_lock_privileges";
    const mysql = createRequire(import.meta.resolve("@vtc/db"))("mysql2/promise"),
      c = await mysql.createConnection(settingsFromEnvironment());
    let evidenceId;
    try {
      await c.beginTransaction();
      for (const table of [
        "trips",
        "manual_review_gates",
        "manual_evidence_refs",
        "manual_draft_evidence",
      ]) {
        await assert.rejects(c.query(`SELECT * FROM ${table} LIMIT 1 FOR UPDATE`), (error) =>
          [1142, 1143].includes(error.errno),
        );
        await c.query(`SELECT * FROM ${table} LIMIT 1 FOR SHARE`);
      }
      const [rows] = await c.query("SELECT id,state FROM manual_evidence");
      assert.equal(rows.length, 1);
      assert.equal(rows[0].state, "ready");
      assert.ok(Buffer.isBuffer(rows[0].id));
      evidenceId = applicationId(rows[0].id.toString("utf8"));
      await c.rollback();
    } finally {
      await c.end();
    }
    smokePhase = "worker_reservation";
    clock = new Date("2022-01-01T00:00:00.000Z");
    assert.equal(await manual.reserveExpiry(evidenceId), true);
    smokePhase = "worker_expiry";
    const result = await runPass(
      createQueue(unit, [manual.handler, manual.generationHandler]),
      new AbortController().signal,
    );
    assert.equal(result.processed, 1);
  }
  const mysql = createRequire(import.meta.resolve("@vtc/db"))("mysql2/promise"),
    c = await mysql.createConnection(settingsFromEnvironment());
  try {
    if (process.argv[2] === "worker") {
      const [rows] = await c.query("SELECT state FROM manual_evidence");
      assert.equal(rows.length, 1);
      assert.equal(rows[0].state, "expired");
      await c.beginTransaction();
      for (const table of [
        "trips",
        "manual_review_gates",
        "manual_evidence_refs",
        "manual_draft_evidence",
      ])
        await c.query(`SELECT * FROM ${table} LIMIT 1 FOR SHARE`);
      await c.rollback();
    }
    smokePhase = "immutable_write_denials";
    const denied =
      process.argv[2] === "produce"
        ? [
            "UPDATE manual_revisions SET number=number",
            "DELETE FROM manual_evidence_refs",
            "UPDATE trip_facts SET id=id",
            "DELETE FROM source_messages",
            "UPDATE source_messages SET id=id",
            "UPDATE manual_commands SET scope=scope",
            "DELETE FROM manual_commands",
          ]
        : [
            "UPDATE manual_revisions SET number=number",
            "DELETE FROM manual_evidence_refs",
            "UPDATE trips SET version=version",
            "UPDATE audit_entries SET reason=reason",
          ];
    for (const statement of denied) {
      await assert.rejects(c.query(statement), (error) => [1142, 1143].includes(error.errno));
    }
  } finally {
    await c.end();
  }
  console.log(`Manual restricted grants: ${process.argv[2]} PASS`);
} catch (error) {
  const causes = [],
    seen = new Set();
  for (let cause = error; cause && causes.length < 8 && !seen.has(cause); cause = cause.cause) {
    seen.add(cause);
    causes.push({
      sqlErrno: [1044, 1062, 1142, 1143, 1227, 1364, 1452, 3819].includes(cause.errno)
        ? cause.errno
        : null,
      status: [400, 401, 403, 404, 409, 413, 415, 422, 429, 503].includes(cause.statusCode)
        ? cause.statusCode
        : null,
      assertion: cause.code === "ERR_ASSERTION",
    });
  }
  console.error(
    JSON.stringify({
      event: "manual_restricted_smoke_failed",
      phase: smokePhase,
      causes,
    }),
  );
  throw Error(`MANUAL_RESTRICTED_GRANTS_${process.argv[2].toUpperCase()}_FAILED`);
} finally {
  await unit.close();
}
