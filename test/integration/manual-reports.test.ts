import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { components } from "@vtc/contracts";
import {
  createUnitOfWork,
  newId,
  runMigrations,
  TransactionCommitOutcomeUnknownError,
  type UnitOfWork,
} from "@vtc/db";
import { membership } from "@vtc/db/identity-schema";
import {
  eq,
  manualBlobGenerations,
  manualEvidence,
  manualEvidenceReferences,
  manualReports,
  manualReviewGates,
  manualRevisions,
} from "@vtc/db/manual-reports-schema";
import { sourceMessages, tripFacts, tripFactTrailers, trips } from "@vtc/db/trips-schema";
import type { Connection, RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { createApp } from "../../apps/api/src/app.ts";
import { type Catalogs, createCatalogs } from "../../apps/api/src/modules/catalogs/service.ts";
import { csrfProtection } from "../../apps/api/src/modules/identity/http.ts";
import {
  type Actor,
  createIdentity,
  type Identity,
} from "../../apps/api/src/modules/identity/service.ts";
import {
  createManualReports,
  type ManualReports,
} from "../../apps/api/src/modules/manual-reports/service.ts";
import type { NormalizedTripEvidence } from "../../apps/api/src/modules/sources/contracts/evidence.ts";
import { createTrips, type Trips } from "../../apps/api/src/modules/trips/service.ts";
import {
  createPrivateFilesystem,
  type PrivateBlobs,
} from "../../apps/api/src/platform/blob-storage/filesystem.ts";
import { createQueue } from "../../apps/api/src/platform/jobs/queue.ts";
import { runPass } from "../../apps/api/src/platform/jobs/runner.ts";
import { catalogEvents, identityAccessEvents } from "../../apps/api/src/platform/outbox/events.ts";
import { composeIdentity } from "../../apps/api/src/use-cases/identity-messaging.ts";
import { artifact, entity } from "../fixtures/catalogs/synthetic.ts";
import { pngBytes } from "../fixtures/manual-images.ts";
import { createFactRepository as oldFacts } from "../fixtures/manual-v1-facts.ts";
import {
  guardedSettings,
  hasCode,
  reset,
  SCHEMA_SETUP_TIMEOUT_MS,
  testConnection,
} from "../persistence/support.ts";
import { telemetryFixture } from "../support/builders.ts";
import { bounded, until } from "../support/concurrency.ts";
import { safeChildEnvironment } from "../support/environment.ts";

type S = components["schemas"];
let control: Connection,
  unit: UnitOfWork,
  identity: Identity,
  catalogs: Catalogs,
  tripService: Trips,
  manual: ManualReports,
  blobs: PrivateBlobs,
  root: string;
let owner: Actor,
  other: Actor,
  staff: Actor,
  reviewer: Actor,
  trainee: Actor,
  ownerCookie: string,
  otherCookie: string,
  staffCookie: string;
let instant = Date.parse("2026-10-21T12:00:00.000Z");
const now = () => new Date(instant);
const identityConfig = {
  secret: randomBytes(32).toString("hex"),
  origin: "http://127.0.0.1:4173",
  production: false,
};
const manualConfig = {
  key: randomBytes(32).toString("hex"),
  maxFilesPerReport: 5,
  policyRevision: 1,
  orphanGraceMs: 60000,
  storage: { root: "", maxFileBytes: 1024 * 1024, maxPixels: 10000, timeoutMs: 5000 },
};
const password = "Fictional-manual-passphrase-42";
const cookie = (cookies: string[]) => cookies.map((c) => c.split(";", 1)[0]).join("; ");
async function member(roles: ("driver" | "trainee" | "dispatcher")[] = ["driver"]) {
  const userId = newId(),
    email = `${userId}@example.invalid`,
    credential = await identity.prepareCredential(password);
  await unit.run((tx) =>
    identity.insertWithCredential(tx, {
      userId,
      email,
      name: "Fictional Manual Driver",
      ...credential,
      roles,
    }),
  );
  const login = await identity.login(email, password),
    saved = cookie(login.cookies);
  return { actor: await identity.authenticate(new Headers({ cookie: saved })), cookie: saved };
}
async function* bytes(value = pngBytes()) {
  yield value;
}
async function upload(key = newId(), name = "synthetic.png", value = pngBytes()) {
  return manual.upload(owner, key, name, bytes(value), "image/png");
}
function fields(evidenceId: string): S["ManualSubmissionFields"] {
  const unknown = {
    status: "unresolved" as const,
    label: "Fictional selection",
    reasonCode: "not_listed" as const,
    locale: "en" as const,
    context: null,
  };
  return {
    game: "ets2",
    origin: unknown,
    destination: unknown,
    cargo: unknown,
    trailerType: unknown,
    cargoMassKg: "0",
    actualDistanceM: "1234.5",
    evidenceIds: [evidenceId],
  };
}
async function submit(evidenceId: string, key = newId()) {
  return manual.submitReport(owner, key, { fields: fields(evidenceId) });
}
async function terminal(
  report: S["ManualReport"],
  decision: "accepted" | "rejected" = "accepted",
  decisionAt = now().toISOString(),
) {
  // Synthetic VTC-029 seam: no decision HTTP implementation or contribution claim.
  await unit.run(async (tx) => {
    await identity.authorizeInTransaction(tx, staff, "trips.review");
    await tripService.manualGateInTransaction(tx, owner.userId, report.tripId);
    await unit
      .client(tx)
      .update(trips)
      .set({ decision, reviewHold: false, correctionPending: false })
      .where(eq(trips.id, report.tripId));
    await manual.decisionRecordedInTransaction(
      tx,
      staff,
      report.id,
      report.currentRevision.id,
      decisionAt,
    );
  });
}
async function counts() {
  const [rows] = await control.query<RowDataPacket[]>(
    "SELECT (SELECT COUNT(*) FROM trips) trips,(SELECT COUNT(*) FROM manual_reports) reports,(SELECT COUNT(*) FROM manual_revisions) revisions,(SELECT COUNT(*) FROM source_messages) messages",
  );
  return Object.fromEntries(
    Object.entries(rows[0] ?? {}).map(([key, value]) => [key, Number(value)]),
  );
}
async function setupPhase<T>(
  phase:
    | "connection"
    | "reset"
    | "migrations"
    | "bootstrap"
    | "owner_credentials"
    | "other_credentials"
    | "reviewer_credentials"
    | "trainee_credentials",
  work: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  try {
    return await work();
  } finally {
    console.log(
      JSON.stringify({
        event: "manual_fixture_phase",
        phase,
        durationMs: Math.round(performance.now() - start),
      }),
    );
  }
}
beforeAll(async () => {
  control = await setupPhase("connection", () => testConnection());
  unit = createUnitOfWork(guardedSettings());
  await setupPhase("reset", () => reset(control));
  await setupPhase("migrations", () => runMigrations(guardedSettings()));
  root = await mkdtemp(join(tmpdir(), "vtc-manual-integration-"));
  await chmod(root, 0o700);
  manualConfig.storage.root = root;
  blobs = createPrivateFilesystem(manualConfig.storage);
  identity = createIdentity(unit, identityConfig, { accessEvents: identityAccessEvents(unit) });
  await setupPhase("bootstrap", () =>
    identity.bootstrap({
      email: "manual-director@example.invalid",
      name: "Fictional Manual Director",
      password,
    }),
  );
  staffCookie = cookie((await identity.login("manual-director@example.invalid", password)).cookies);
  staff = await identity.authenticate(new Headers({ cookie: staffCookie }));
  const a = await setupPhase("owner_credentials", () => member()),
    b = await setupPhase("other_credentials", () => member());
  owner = a.actor;
  ownerCookie = a.cookie;
  other = b.actor;
  otherCookie = b.cookie;
  reviewer = (await setupPhase("reviewer_credentials", () => member(["dispatcher"]))).actor;
  trainee = (await setupPhase("trainee_credentials", () => member(["trainee"]))).actor;
  catalogs = createCatalogs(
    unit,
    {
      production: false,
      synthetic: true,
      cursorKey: randomBytes(32).toString("hex"),
      maxFileBytes: 1024 * 1024,
      artifactTtlMs: 86400000,
      policyRevision: 1,
      evidence: [],
    },
    { identity, published: catalogEvents(unit).append },
  );
  tripService = createTrips(
    unit,
    { cursorKey: randomBytes(32).toString("hex") },
    {
      identity,
      catalogs,
      manualEvidence: (tx, owner, payload, tripId) =>
        manual.validateSourceInTransaction(tx, owner, payload, tripId),
      manualProjection: (tx, ids) => manual.projectionInTransaction(tx, ids),
    },
    now,
  );
  manual = createManualReports(
    unit,
    manualConfig,
    { identity, catalogs, trips: tripService, blobs },
    now,
  );
  await manual.initialize();
}, SCHEMA_SETUP_TIMEOUT_MS);
beforeEach(async () => {
  await control.query("UPDATE manual_reports SET current_revision_id=NULL");
  for (const table of [
    "identity_limits",
    "manual_blob_generations",
    "job_effect_receipts",
    "durable_jobs",
    "manual_commands",
    "manual_draft_history",
    "manual_draft_evidence",
    "manual_drafts",
    "manual_correction_history",
    "manual_correction_requests",
    "manual_evidence_refs",
    "manual_revisions",
    "manual_reports",
    "manual_review_gates",
    "manual_evidence",
    "trip_history",
    "trip_fact_trailers",
    "trip_facts",
    "source_payloads",
    "source_messages",
    "source_trips",
    "trips",
    "outbox_events",
  ])
    await control.query(`DELETE FROM ${table}`);
  instant = Date.parse("2026-10-21T12:00:00.000Z");
});
afterAll(async () => {
  await unit?.close();
  await control?.end();
  if (root) await rm(root, { recursive: true, force: true });
});

test("partial owner drafts create no trip; submission is atomic/idempotent with original unresolved fields and unknown actual times", async () => {
  const image = await upload(),
    draft = await manual.createDraft(owner, newId(), { fields: { game: "ets2" } });
  expect(Number((await counts())?.trips)).toBe(0);
  const key = newId(),
    saved = await manual.replaceDraft(owner, draft.id, key, draft.version, {
      fields: { evidenceIds: [image.id] },
    });
  expect(
    await manual.replaceDraft(owner, draft.id, key, draft.version, {
      fields: { evidenceIds: [image.id] },
    }),
  ).toEqual(saved);
  await expect(manual.getDraft(other, draft.id)).rejects.toMatchObject({ statusCode: 404 });
  await expect(manual.getDraft(staff, draft.id)).rejects.toMatchObject({ statusCode: 404 });
  await expect(manual.getDraft(reviewer, draft.id)).rejects.toMatchObject({ statusCode: 403 });
  await expect(
    manual.createDraft(reviewer, newId(), { fields: { game: "ets2" } }),
  ).rejects.toMatchObject({ statusCode: 403 });
  expect((await manual.createDraft(trainee, newId(), { fields: { game: "ets2" } })).state).toBe(
    "editing",
  );
  const submissionKey = newId(),
    results = await Promise.all([
      manual.submitDraft(owner, draft.id, submissionKey, saved.version, {
        fields: fields(image.id),
      }),
      manual.submitDraft(owner, draft.id, submissionKey, saved.version, {
        fields: fields(image.id),
      }),
    ]);
  expect(results[0]).toEqual(results[1]);
  const report = results[0] as S["ManualReport"];
  expect(report.currentRevision).toMatchObject({
    representation: "extended",
    fields: { eventId: null, comment: null, cargo: { status: "unresolved" } },
  });
  expect(await manual.getDraft(owner, draft.id)).toMatchObject({
    state: "submitted",
    submittedReportId: report.id,
  });
  expect(await counts()).toMatchObject({ trips: 1, reports: 1, revisions: 1, messages: 1 });
  const state = await unit.run((tx) => tripService.statesInTransaction(tx, [report.tripId]));
  expect(state[0]).toMatchObject({
    decision: "pending_review",
    reportingAt: null,
    actualStart: null,
    actualEnd: null,
    actualDistanceM: "1234.500000000000000000",
  });
  const [fact] = await unit.run((tx) => unit.client(tx).select().from(tripFacts));
  expect(fact).toMatchObject({
    adapterVersion: 2,
    catalogRevisionId: null,
    originEntityId: null,
    originCatalogRevisionId: null,
  });
  await expect(
    manual.submitDraft(owner, draft.id, submissionKey, saved.version, {
      fields: { ...fields(image.id), actualDistanceM: "2" },
    }),
  ).rejects.toMatchObject({ publicCode: "IDEMPOTENCY_CONFLICT" });
});

test("same-ETag revisions race safely, rejected edits retain history, and accepted correction requests preserve effective results", async () => {
  const image = await upload(),
    key = newId(),
    report = await submit(image.id, key),
    value = {
      fields: { ...fields(image.id), actualDistanceM: "20" },
      expectedTripVersion: report.tripVersion,
    };
  const edits = await Promise.allSettled([
    manual.reviseReport(owner, report.id, newId(), report.version, value),
    manual.reviseReport(owner, report.id, newId(), report.version, value),
  ]);
  expect(edits.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(edits.filter((r) => r.status === "rejected")).toHaveLength(1);
  const revised = await manual.getReport(owner, report.id);
  expect(revised.currentRevision.number).toBe(2);
  expect(await submit(image.id, key)).toEqual(report);
  const history = await manual.revisions(owner, report.id);
  expect(history).toHaveProperty("items");
  await terminal(revised, "rejected");
  const next = await manual.reviseReport(owner, report.id, newId(), revised.version, {
    fields: fields(image.id),
    expectedTripVersion: revised.tripVersion,
  });
  expect(next.tripId).toBe(report.tripId);
  expect(next.currentRevision.number).toBe(3);
  await terminal(next);
  await expect(
    manual.reviseReport(owner, next.id, newId(), next.version, {
      fields: fields(image.id),
      expectedTripVersion: next.tripVersion,
    }),
  ).rejects.toMatchObject({ statusCode: 409 });
  const request = await manual.requestCorrection(owner, next.tripId, newId(), next.tripVersion, {
    reason: "Fictional correction explanation",
  });
  expect(await manual.corrections(owner, next.tripId, {}, request.id)).toMatchObject({
    data: { id: request.id, baseRevisionId: next.currentRevision.id, status: "pending" },
    version: request.version,
  });
  const [trip] = await unit.run((tx) => tripService.statesInTransaction(tx, [next.tripId]));
  expect(trip).toMatchObject({ decision: "accepted", correctionPending: true, reviewHold: true });
  expect(await counts()).toMatchObject({ trips: 1, reports: 1, revisions: 3 });
});

test("uploads compare actual validated fingerprints; failed and concurrent attempts never duplicate or permanently strand a key", async () => {
  const key = newId();
  await expect(
    manual.upload(owner, key, "synthetic.jpg", bytes(), "image/jpeg"),
  ).rejects.toMatchObject({ statusCode: 422 });
  const image = await upload(key);
  expect(await upload(key)).toEqual(image);
  await expect(upload(key, "different.png")).rejects.toMatchObject({
    publicCode: "IDEMPOTENCY_CONFLICT",
  });
  let started!: () => void, release!: () => void;
  const gate = new Promise<void>((resolve) => {
      started = resolve;
    }),
    finish = new Promise<void>((resolve) => {
      release = resolve;
    });
  async function* delayed() {
    started();
    await finish;
    yield pngBytes();
  }
  const raceKey = newId(),
    first = manual.upload(owner, raceKey, "synthetic.png", delayed(), "image/png");
  await gate;
  await expect(upload(raceKey)).rejects.toMatchObject({ statusCode: 503 });
  release();
  const result = await first;
  expect((await upload(raceKey)).id).toBe(result.id);
  expect(
    (await readdir(root)).filter((name) => name.includes(result.id) && name.endsWith(".blob")),
  ).toHaveLength(1);
});

test("current private permissions protect unattached uploads, report history and binary streams; ordinary accepted readers see only summary", async () => {
  const image = await upload();
  for (const actor of [other, staff])
    await expect(manual.metadata(actor, image.id)).rejects.toMatchObject({ statusCode: 404 });
  const report = await submit(image.id);
  expect((await manual.metadata(staff, image.id)).state).toBe("ready");
  await expect(manual.getReport(other, report.id)).rejects.toMatchObject({ statusCode: 404 });
  await terminal(report);
  const view = await tripService.detail(other, report.tripId);
  expect(view.view).toBe("summary");
  expect(view).not.toHaveProperty("evidence");
  const own = await tripService.detail(owner, report.tripId);
  expect(own).toMatchObject({
    view: "private",
    manualRevision: { id: report.currentRevision.id },
    evidence: [{ id: image.id }],
  });
  await expect(
    manual.submitReport(staff, newId(), { fields: fields(image.id) }),
  ).rejects.toMatchObject({ statusCode: 404 });
  await expect(
    manual.submitReport(reviewer, newId(), { fields: fields(image.id) }),
  ).rejects.toMatchObject({ statusCode: 403 });
  await unit.run((tx) =>
    unit
      .client(tx)
      .update(membership)
      .set({ status: "inactive" })
      .where(eq(membership.userId, other.userId)),
  );
  try {
    await expect(manual.getReport(other, report.id)).rejects.toMatchObject({ statusCode: 401 });
  } finally {
    await unit.run((tx) =>
      unit
        .client(tx)
        .update(membership)
        .set({ status: "active" })
        .where(eq(membership.userId, other.userId)),
    );
  }
});

test("explicit telemetry attachment rechecks same owner/game/source/version and preserves canonical telemetry times", async () => {
  const payload = telemetryFixture("completed"),
    telemetry = await unit.run((tx) =>
      tripService.storeInTransaction(tx, "ets2telemetry", payload, {
        ownerUserId: owner.userId,
        connection: { state: "unknown", referenceId: null },
      }),
    );
  const [before] = await unit.run((tx) => tripService.statesInTransaction(tx, [telemetry.tripId]));
  const image = await upload(),
    report = await manual.submitReport(owner, newId(), {
      fields: fields(image.id),
      targetTrip: { tripId: telemetry.tripId, expectedVersion: before?.version as number },
    });
  expect(report.tripId).toBe(telemetry.tripId);
  const [after] = await unit.run((tx) => tripService.statesInTransaction(tx, [report.tripId]));
  expect(after).toMatchObject({
    actualStart: before?.actualStart,
    actualEnd: before?.actualEnd,
    currentFactId: before?.currentFactId,
    reviewHold: true,
  });
  expect(await counts()).toMatchObject({ trips: 1, messages: 2 });
  await expect(
    manual.submitReport(other, newId(), {
      fields: fields(image.id),
      targetTrip: { tripId: telemetry.tripId, expectedVersion: report.tripVersion },
    }),
  ).rejects.toMatchObject({ statusCode: 404 });
  await expect(
    manual.submitReport(owner, newId(), {
      fields: fields(image.id),
      targetTrip: { tripId: telemetry.tripId, expectedVersion: 1 },
    }),
  ).rejects.toMatchObject({ publicCode: "VERSION_CONFLICT" });
  await expect(
    manual.submitReport(owner, newId(), {
      fields: { ...fields(image.id), game: "ats" },
      targetTrip: { tripId: telemetry.tripId, expectedVersion: report.tripVersion },
    }),
  ).rejects.toMatchObject({ statusCode: 409 });
});

test("HTTP enforces CSRF/Origin, closed bodies, ETags, multipart limits and private content headers alongside catalog multipart", async () => {
  const app = await createApp({
    identity,
    catalogs,
    trips: tripService,
    manualReports: manual,
    checkReadiness: async () => true,
  });
  const token = csrfProtection(identityConfig).issue({}, owner).token,
    headers = {
      cookie: ownerCookie,
      origin: identityConfig.origin,
      "x-csrf-token": token,
      "idempotency-key": newId(),
    };
  try {
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/me/manual-drafts",
          headers: { cookie: ownerCookie },
          payload: { fields: {} },
        })
      ).statusCode,
    ).toBe(403);
    for (const field of ["ownerId", "tripDate", "accepted", "qualificationId", "actualStartedAt"]) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/v1/me/manual-drafts",
            headers: { ...headers, "idempotency-key": newId() },
            payload: { fields: { [field]: "forbidden" } },
          })
        ).statusCode,
      ).toBe(422);
    }
    const draft = await app.inject({
      method: "POST",
      url: "/api/v1/me/manual-drafts",
      headers,
      payload: { fields: {} },
    });
    expect(draft.statusCode).toBe(201);
    expect(draft.headers.etag).toBe('"v1"');
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/api/v1/me/manual-drafts/${draft.json().data.id}`,
          headers: { ...headers, "idempotency-key": newId() },
          payload: { fields: {} },
        })
      ).statusCode,
    ).toBe(428);
    const image = await upload(),
      report = await submit(image.id);
    const download = await app.inject({
      url: `/api/v1/evidence/${image.id}/content`,
      headers: { cookie: ownerCookie },
    });
    expect(download.statusCode).toBe(200);
    expect(download.rawPayload).toEqual(pngBytes());
    expect(download.headers["cache-control"]).toBe("no-store");
    expect(download.headers["x-content-type-options"]).toBe("nosniff");
    expect(download.headers["content-disposition"]).toContain("attachment");
    expect(
      (
        await app.inject({
          url: `/api/v1/manual-reports/${report.id}`,
          headers: { cookie: otherCookie },
        })
      ).statusCode,
    ).toBe(404);
    const boundary = "synthetic-manual-boundary",
      part = (name: string, data: Buffer, type = "image/png") =>
        Buffer.concat([
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="synthetic.png"\r\nContent-Type: ${type}\r\n\r\n`,
          ),
          data,
          Buffer.from("\r\n"),
        ]),
      body = (parts: Buffer[]) => Buffer.concat([...parts, Buffer.from(`--${boundary}--\r\n`)]);
    const uploadHeaders = {
      ...headers,
      "content-type": `multipart/form-data; boundary=${boundary}`,
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/evidence",
          headers: { ...uploadHeaders, "idempotency-key": newId() },
          payload: body([part("file", pngBytes())]),
        })
      ).statusCode,
    ).toBe(202);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/evidence",
          headers: { ...uploadHeaders, "idempotency-key": newId() },
          payload: body([part("file", pngBytes()), part("extra", pngBytes())]),
        })
      ).statusCode,
    ).toBe(413);
    const catalogToken = csrfProtection(identityConfig).issue({}, staff).token;
    const catalogResponse = await app.inject({
      method: "POST",
      url: "/api/v1/admin/catalog-import-artifacts",
      headers: {
        cookie: staffCookie,
        origin: identityConfig.origin,
        "x-csrf-token": catalogToken,
        "idempotency-key": newId(),
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: body([
        part(
          "file",
          Buffer.from(JSON.stringify(artifact("ets2", [entity("manual-http")]))),
          "application/json",
        ),
      ]),
    });
    expect(catalogResponse.statusCode).toBe(202);
  } finally {
    await app.close();
  }
});

test("retention protects every reference until the newest decision calendar boundary, fences review/attach and retains structured history after expiry", async () => {
  const image = await upload(),
    first = await submit(image.id);
  await terminal(first);
  expect(await manual.reserveExpiry(image.id)).toBe(false);
  const second = await submit(image.id);
  instant = Date.parse("2027-10-21T12:00:00.000Z");
  expect(await manual.reserveExpiry(image.id)).toBe(false);
  await terminal(second);
  instant = Date.parse("2028-10-21T11:59:59.999Z");
  expect(await manual.reserveExpiry(image.id)).toBe(false);
  instant++;
  expect(await manual.reserveExpiry(image.id)).toBe(true);
  await expect(manual.metadata(owner, image.id)).rejects.toMatchObject({
    statusCode: 503,
    publicCode: "EVIDENCE_TRANSITION",
  });
  await expect(
    unit.run((tx) => manual.reopenInTransaction(tx, staff, first.tripId)),
  ).rejects.toMatchObject({ publicCode: "EVIDENCE_TRANSITION" });
  await expect(submit(image.id)).rejects.toMatchObject({ publicCode: "EVIDENCE_TRANSITION" });
  const queue = createQueue(unit, [manual.handler]);
  await control.query(
    "UPDATE durable_jobs SET available_at=UTC_TIMESTAMP(3) WHERE kind='manual.evidence-delete'",
  );
  expect((await runPass(queue, new AbortController().signal)).processed).toBe(1);
  expect((await manual.metadata(owner, image.id)).state).toBe("expired");
  await expect(manual.content(owner, image.id)).rejects.toMatchObject({ statusCode: 410 });
  expect((await manual.getReport(owner, first.id)).currentRevision.id).toBe(
    first.currentRevision.id,
  );
  expect(
    await blobs.inspect(
      (
        await unit.run((tx) =>
          unit.client(tx).select().from(manualEvidence).where(eq(manualEvidence.id, image.id)),
        )
      )[0] as { id: string; generation: string },
    ),
  ).toBeNull();
  await expect(submit(image.id)).rejects.toMatchObject({ statusCode: 409 });
});

test("review winning the canonical lock blocks expiry; changed reference discovery retries instead of taking late locks", async () => {
  const image = await upload(),
    report = await submit(image.id);
  await terminal(report);
  instant = Date.parse("2028-10-21T12:00:00.000Z");
  let locked!: () => void, release!: () => void;
  const gate = new Promise<void>((r) => {
      locked = r;
    }),
    wait = new Promise<void>((r) => {
      release = r;
    });
  const review = unit.run(async (tx) => {
    await identity.authorizeInTransaction(tx, staff, "trips.review");
    await tripService.manualGateInTransaction(tx, owner.userId, report.tripId);
    locked();
    await wait;
    await manual.reopenInTransaction(tx, staff, report.tripId);
  });
  await gate;
  const expiry = manual.reserveExpiry(image.id);
  release();
  await review;
  expect(await expiry).toBe(false);
  await terminal(report);
  let discovered!: () => void, continueLock!: () => void;
  const seen = new Promise<void>((r) => {
      discovered = r;
    }),
    barrier = new Promise<void>((r) => {
      continueLock = r;
    });
  let first = true;
  const instrumented = {
    ...tripService,
    async statesInTransaction(
      tx: Parameters<Trips["statesInTransaction"]>[0],
      ids: string[],
      lock: Parameters<Trips["statesInTransaction"]>[2] = false,
    ) {
      if (lock && first) {
        first = false;
        discovered();
        await barrier;
      }
      return tripService.statesInTransaction(tx, ids, lock);
    },
  };
  const cleaner = createManualReports(
    unit,
    manualConfig,
    { identity, catalogs, trips: instrumented, blobs },
    now,
  );
  instant = Date.parse("2030-10-21T12:00:00.000Z");
  const pending = cleaner.reserveExpiry(image.id);
  await seen;
  await submit(image.id);
  continueLock();
  expect(await pending).toBe(false);
  expect((await manual.metadata(owner, image.id)).state).toBe("ready");
});

test("recovery validates finalized objects after restart, rejects missing files and safely repeats deletion after unlink-before-completion", async () => {
  const id = newId(),
    generation = newId();
  await unit.run((tx) =>
    unit.client(tx).insert(manualEvidence).values({
      id,
      generation,
      ownerId: owner.userId,
      state: "processing",
      originalName: "synthetic.png",
      contentType: "image/png",
      leaseToken: newId(),
      leaseUntil: "2026-10-20T00:00:00.000Z",
      createdAt: now().toISOString(),
      updatedAt: now().toISOString(),
      nextCheckAt: now().toISOString(),
    }),
  );
  await blobs.put({ id, generation }, bytes());
  const restarted = createManualReports(
    unit,
    manualConfig,
    {
      identity,
      catalogs,
      trips: tripService,
      blobs: createPrivateFilesystem(manualConfig.storage),
    },
    now,
  );
  await restarted.recoverUpload(id);
  expect((await restarted.metadata(owner, id)).state).toBe("ready");
  const missing = newId();
  await unit.run((tx) =>
    unit.client(tx).insert(manualEvidence).values({
      id: missing,
      generation: newId(),
      ownerId: owner.userId,
      state: "processing",
      originalName: "synthetic.png",
      contentType: "image/png",
      leaseUntil: "2026-10-20T00:00:00.000Z",
      createdAt: now().toISOString(),
      updatedAt: now().toISOString(),
      nextCheckAt: now().toISOString(),
    }),
  );
  await restarted.recoverUpload(missing);
  expect((await restarted.metadata(owner, missing)).state).toBe("rejected");
  const report = await submit(id);
  await terminal(report);
  instant = Date.parse("2028-10-21T12:00:00.000Z");
  expect(await restarted.reserveExpiry(id)).toBe(true);
  await blobs.remove({ id, generation });
  await control.query(
    "UPDATE durable_jobs SET available_at=UTC_TIMESTAMP(3) WHERE kind='manual.evidence-delete'",
  );
  expect(
    (await runPass(createQueue(unit, [restarted.handler]), new AbortController().signal)).processed,
  ).toBe(1);
  expect((await restarted.metadata(owner, id)).state).toBe("expired");
});

test("more than one hundred referencing trips are locked in complete ordered batches without starving retention", async () => {
  const image = await upload(),
    first = await submit(image.id);
  await terminal(first);
  const canonical = Array.from({ length: 101 }, () => ({
    id: newId(),
    ownerId: owner.userId,
    game: "ets2" as const,
    version: 1,
    outcome: "delivered" as const,
    recording: "unknown" as const,
    decision: "accepted" as const,
    reviewReasons: [],
    createdAt: now().toISOString(),
  }));
  await unit.run(async (tx) => {
    const db = unit.client(tx);
    await db.insert(trips).values(canonical);
    const reports = canonical.map((t) => ({
      id: newId(),
      tripId: t.id,
      ownerId: owner.userId,
      version: 1,
      revisionNumber: 1,
      createdAt: now().toISOString(),
    }));
    await db.insert(manualReports).values(reports);
    const revisions = reports.map((r) => ({
      id: newId(),
      reportId: r.id,
      number: 1,
      format: "extended" as const,
      fields: { ...fields(image.id), eventId: null, comment: null },
      submittedAt: now().toISOString(),
    }));
    await db.insert(manualRevisions).values(revisions);
    await db.insert(manualEvidenceReferences).values(
      revisions.map((r, i) => ({
        evidenceId: image.id,
        revisionId: r.id,
        reportId: r.reportId,
        tripId: canonical[i]?.id as string,
      })),
    );
    await db.insert(manualReviewGates).values(
      canonical.map((t) => ({
        tripId: t.id,
        underReview: false,
        latestDecisionAt: now().toISOString(),
      })),
    );
  });
  instant = Date.parse("2028-10-21T12:00:00.000Z");
  expect(await manual.reserveExpiry(image.id)).toBe(true);
});

test("equal-time revision keysets retain every immutable revision exactly once", async () => {
  const image = await upload();
  const report = await manual.submitReport(owner, newId(), { fields: fields(image.id) });
  const next = await manual.reviseReport(owner, report.id, newId(), report.version, {
    fields: { ...fields(image.id), actualDistanceM: "2" },
    expectedTripVersion: report.tripVersion,
  });
  expect(next.currentRevision.submittedAt).toBe(report.currentRevision.submittedAt);
  const first = await manual.revisions(owner, report.id, { limit: 1 });
  if (!("items" in first)) throw Error("REVISION_PAGE_EXPECTED");
  expect(first.items).toHaveLength(1);
  expect(first.nextCursor).not.toBeNull();
  const second = await manual.revisions(owner, report.id, {
    limit: 1,
    cursor: first.nextCursor as string,
  });
  if (!("items" in second)) throw Error("REVISION_PAGE_EXPECTED");
  expect(second.items).toHaveLength(1);
  expect(second.nextCursor).toBeNull();
  const history = [...first.items, ...second.items];
  expect(history.map((row) => row.id)).toEqual(
    [report.currentRevision.id, next.currentRevision.id].sort().reverse(),
  );
  expect(new Set(history.map((row) => row.id)).size).toBe(2);
  expect(history.find((row) => row.id === report.currentRevision.id)).toEqual(
    report.currentRevision,
  );
  expect(history.find((row) => row.id === next.currentRevision.id)).toEqual(next.currentRevision);
});

test("published resolved pins remain legacy-compatible and invalid null/cross-pin writes fail closed under MySQL constraints", async () => {
  const a = artifact("ets2", [
    entity("manual-north"),
    entity("manual-south"),
    entity("manual-load", { kind: "cargo" }),
    entity("manual-box", { kind: "trailer_type" }),
  ]);
  const uploaded = await catalogs.upload(staff, newId(), Buffer.from(JSON.stringify(a))),
    op = await catalogs.import(staff, newId(), {
      artifactId: uploaded.id,
      sha256: uploaded.sha256,
      game: "ets2",
    });
  await runPass(createQueue(unit, [catalogs.handler]), new AbortController().signal);
  const revisionId = (await catalogs.operation(staff, op.id)).resultId as string,
    r = await catalogs.detail(staff, revisionId);
  await catalogs.publish(staff, revisionId, newId(), r.version, {
    expectedPublicationVersion: r.publicationVersion,
    reason: "Fictional manual pin review",
  });
  const cities = await catalogs.entities(staff, { revisionId, kind: "city", locale: "en" }),
    cargo = await catalogs.entities(staff, { revisionId, kind: "cargo", locale: "en" }),
    trailer = await catalogs.entities(staff, { revisionId, kind: "trailer_type", locale: "en" }),
    image = await upload();
  const legacy: S["ManualResolvedInput"] = {
    game: "ets2",
    catalogRevisionId: revisionId,
    originCityId: cities.items.find((city) => city.display.label === "Fictional manual-north")
      ?.id as string,
    destinationCityId: cities.items.find((city) => city.display.label === "Fictional manual-south")
      ?.id as string,
    cargoId: cargo.items[0]?.id as string,
    trailerTypeId: trailer.items[0]?.id as string,
    cargoMassKg: "1000",
    actualDistanceM: "100",
    evidenceIds: [image.id],
  };
  const legacyKey = newId(),
    result = await manual.legacySubmit(owner, legacyKey, legacy);
  expect(result.manualRevision).toHaveProperty("fields.originCityId", legacy.originCityId);
  const [fact] = await unit.run((tx) => unit.client(tx).select().from(tripFacts));
  if (!fact) throw Error("SYNTHETIC_FACT_REQUIRED");
  expect(fact.adapterVersion).toBe(1);
  const old = oldFacts(unit);
  expect((await unit.run((tx) => old.read(tx, [fact.id]))).get(fact.id)?.tripId).toBe(
    result.summary.id,
  );
  const oldFactId = newId(),
    oldMessageId = newId(),
    oldUnknownMessageId = newId(),
    oldUnknownFactId = newId();
  await unit.run(async (tx) => {
    const [message] = await unit
      .client(tx)
      .select()
      .from(sourceMessages)
      .where(eq(sourceMessages.id, fact.messageId));
    if (!message) throw Error("SYNTHETIC_MESSAGE_REQUIRED");
    await unit
      .client(tx)
      .insert(sourceMessages)
      .values({ ...message, id: oldMessageId, eventKey: Buffer.from(newId()), revision: "99" });
    await old.insert(
      tx,
      result.summary.id,
      {
        ...(fact.evidence as NormalizedTripEvidence),
        sourceRecordId: oldMessageId,
        factRevisionId: oldFactId,
      },
      1,
    );
  });
  await unit.run(async (tx) => {
    const [message] = await unit
      .client(tx)
      .select()
      .from(sourceMessages)
      .where(eq(sourceMessages.id, fact.messageId));
    if (!message) throw Error("SYNTHETIC_MESSAGE_REQUIRED");
    await unit
      .client(tx)
      .insert(sourceMessages)
      .values({
        ...message,
        id: oldUnknownMessageId,
        eventKey: Buffer.from(newId()),
        revision: "100",
      });
    const unknown = {
      status: "unknown" as const,
      reasonCode: "synthetic_unknown",
      sourceRecordId: oldUnknownMessageId,
    };
    await old.insert(
      tx,
      result.summary.id,
      {
        ...(fact.evidence as NormalizedTripEvidence),
        sourceRecordId: oldUnknownMessageId,
        factRevisionId: oldUnknownFactId,
        catalogRevisionId: null,
        origin: unknown,
        destination: unknown,
        cargo: unknown,
        adrCategory: unknown,
        trailers: { complete: true, items: [unknown] },
      },
      1,
    );
  });
  expect(
    (await unit.run((tx) => old.read(tx, [oldUnknownFactId]))).get(oldUnknownFactId)?.evidence
      .trailers.items[0]?.status,
  ).toBe("unknown");
  const [oldTrailer] = await unit.run((tx) =>
    unit
      .client(tx)
      .select()
      .from(tripFactTrailers)
      .where(eq(tripFactTrailers.tripFactId, oldUnknownFactId)),
  );
  expect(oldTrailer).toMatchObject({
    sourceAdapterVersion: 1,
    legacyCatalogRevisionId: null,
    catalogRevisionId: null,
  });
  const [oldRow] = await unit.run((tx) =>
    unit.client(tx).select().from(tripFacts).where(eq(tripFacts.id, oldFactId)),
  );
  expect(oldRow).toMatchObject({
    adapterVersion: 1,
    originCatalogRevisionId: null,
    destinationCatalogRevisionId: null,
    cargoCatalogRevisionId: null,
    adrCatalogRevisionId: null,
  });
  expect(
    (await unit.run((tx) => old.read(tx, [oldFactId]))).get(oldFactId)?.evidence.origin.status,
  ).toBe("known");
  // Raw old-writer shape after forward migration: omit all new pin columns.
  await control.execute(
    "UPDATE trip_facts SET origin_catalog_revision_id=NULL,destination_catalog_revision_id=NULL,cargo_catalog_revision_id=NULL,adr_catalog_revision_id=NULL WHERE id=?",
    [Buffer.from(fact.id)],
  );
  expect((await tripService.detail(owner, result.summary.id)).view).toBe("private");
  await expect(
    control.execute("UPDATE trip_facts SET catalog_revision_id=NULL WHERE id=?", [
      Buffer.from(fact.id),
    ]),
  ).rejects.toSatisfy(hasCode("ER_CHECK_CONSTRAINT_VIOLATED"));
  await expect(
    control.execute("UPDATE trip_facts SET origin_catalog_revision_id=? WHERE id=?", [
      Buffer.from(newId()),
      Buffer.from(fact.id),
    ]),
  ).rejects.toBeDefined();
  await expect(
    control.execute("UPDATE trip_facts SET cargo_entity_id=? WHERE id=?", [
      Buffer.from(legacy.originCityId),
      Buffer.from(fact.id),
    ]),
  ).rejects.toSatisfy(hasCode("ER_NO_REFERENCED_ROW_2"));
  const report = (await manual.listReports(owner)).items[0] as S["ManualReport"];
  for (const invalid of [
    {
      ...fields(image.id),
      game: "ats" as const,
      origin: {
        status: "resolved" as const,
        entityId: legacy.originCityId,
        catalogRevisionId: revisionId,
      },
    },
    {
      ...fields(image.id),
      cargo: {
        status: "resolved" as const,
        entityId: legacy.originCityId,
        catalogRevisionId: revisionId,
      },
    },
    {
      ...fields(image.id),
      origin: {
        status: "resolved" as const,
        entityId: legacy.originCityId,
        catalogRevisionId: newId(),
      },
    },
    { ...fields(image.id), cargoMassKg: "1".repeat(39) },
    { ...fields(image.id), actualDistanceM: "0.1234567890123456789" },
  ])
    await expect(
      Promise.resolve().then(() => manual.submitReport(owner, newId(), { fields: invalid })),
    ).rejects.toMatchObject({ statusCode: 422 });
  const nextArtifact = artifact("ets2", [
    entity("manual-north", { retired: true }),
    entity("manual-south"),
    entity("manual-load", { kind: "cargo" }),
    entity("manual-box", { kind: "trailer_type" }),
  ]);
  const uploadedNext = await catalogs.upload(
      staff,
      newId(),
      Buffer.from(JSON.stringify(nextArtifact)),
    ),
    opNext = await catalogs.import(staff, newId(), {
      artifactId: uploadedNext.id,
      sha256: uploadedNext.sha256,
      game: "ets2",
    });
  await runPass(createQueue(unit, [catalogs.handler]), new AbortController().signal);
  const secondRevision = (await catalogs.operation(staff, opNext.id)).resultId as string,
    secondDetail = await catalogs.detail(staff, secondRevision);
  await catalogs.publish(staff, secondRevision, newId(), secondDetail.version, {
    expectedPublicationVersion: secondDetail.publicationVersion,
    reason: "Fictional mixed pin review",
  });
  const secondCargo = (
    await catalogs.entities(staff, { revisionId: secondRevision, kind: "cargo", locale: "en" })
  ).items[0];
  if (!secondCargo) throw Error("SYNTHETIC_CARGO_REQUIRED");
  expect(
    (await catalogs.entity(staff, legacy.originCityId, secondRevision, "en")).display.retired,
  ).toBe(true);
  await expect(
    manual.submitReport(owner, newId(), {
      fields: {
        ...fields(image.id),
        origin: {
          status: "resolved",
          entityId: legacy.originCityId,
          catalogRevisionId: secondRevision,
        },
      },
    }),
  ).rejects.toMatchObject({ statusCode: 422 });
  const nextTrailer = await unit.run((tx) =>
    catalogs.pinnedInTransaction(tx, secondRevision, legacy.trailerTypeId),
  );
  if (!nextTrailer) throw Error("SYNTHETIC_TRAILER_REQUIRED");
  await expect(
    control.execute(
      "UPDATE trip_fact_trailers SET catalog_revision_id=?,catalog_fact_id=? WHERE trip_fact_id=? AND position=0",
      [Buffer.from(secondRevision), Buffer.from(nextTrailer.id), Buffer.from(fact.id)],
    ),
  ).rejects.toSatisfy(hasCode("ER_NO_REFERENCED_ROW_2"));
  await expect(
    control.execute("UPDATE trip_fact_trailers SET source_adapter_version=2 WHERE trip_fact_id=?", [
      Buffer.from(fact.id),
    ]),
  ).rejects.toSatisfy(hasCode("ER_NO_REFERENCED_ROW_2"));
  await expect(
    control.execute(
      "UPDATE trip_fact_trailers SET source_adapter_version=NULL WHERE trip_fact_id=?",
      [Buffer.from(fact.id)],
    ),
  ).rejects.toSatisfy(hasCode("ER_BAD_NULL_ERROR"));
  await expect(
    control.execute(
      "UPDATE trip_fact_trailers SET legacy_catalog_revision_id=NULL WHERE trip_fact_id=?",
      [Buffer.from(fact.id)],
    ),
  ).rejects.toSatisfy(hasCode("ER_NON_DEFAULT_VALUE_FOR_GENERATED_COLUMN"));
  const mixed: S["ManualSubmissionFields"] = {
    ...fields(image.id),
    origin: { status: "resolved", entityId: legacy.originCityId, catalogRevisionId: revisionId },
    cargo: { status: "resolved", entityId: secondCargo.id, catalogRevisionId: secondRevision },
    trailerType: {
      status: "resolved",
      entityId: legacy.trailerTypeId,
      catalogRevisionId: secondRevision,
    },
  };
  // The chronological-order assertion below requires distinct submitted timestamps.
  instant += 1;
  const next = await manual.reviseReport(owner, report.id, newId(), report.version, {
    fields: mixed,
    expectedTripVersion: report.tripVersion,
  });
  expect(next.currentRevision.submittedAt > report.currentRevision.submittedAt).toBe(true);
  expect((await manual.legacySubmit(owner, legacyKey, legacy)).summary).toEqual(result.summary);
  const [current] = await unit.run((tx) =>
    unit.client(tx).select().from(trips).where(eq(trips.id, next.tripId)),
  );
  const [mixedRow] = await unit.run((tx) =>
    unit
      .client(tx)
      .select()
      .from(tripFacts)
      .where(eq(tripFacts.id, current?.currentFactId ?? "")),
  );
  expect(mixedRow).toMatchObject({
    adapterVersion: 2,
    catalogRevisionId: null,
    originCatalogRevisionId: revisionId,
    cargoCatalogRevisionId: secondRevision,
  });
  if (!current?.currentFactId) throw Error("SYNTHETIC_CURRENT_FACT_REQUIRED");
  const [mixedTrailer] = await unit.run((tx) =>
    unit
      .client(tx)
      .select()
      .from(tripFactTrailers)
      .where(eq(tripFactTrailers.tripFactId, current.currentFactId as string)),
  );
  expect(mixedTrailer).toMatchObject({
    sourceAdapterVersion: 2,
    legacyCatalogRevisionId: null,
    catalogRevisionId: secondRevision,
  });
  await expect(
    control.execute("UPDATE trip_fact_trailers SET source_adapter_version=1 WHERE trip_fact_id=?", [
      Buffer.from(current.currentFactId),
    ]),
  ).rejects.toSatisfy(hasCode("ER_NO_REFERENCED_ROW_2"));
  await expect(
    control.execute("UPDATE trip_facts SET catalog_revision_id=? WHERE id=?", [
      Buffer.from(revisionId),
      Buffer.from(current.currentFactId),
    ]),
  ).rejects.toSatisfy(hasCode("ER_CHECK_CONSTRAINT_VIOLATED"));
  await expect(unit.run((tx) => old.read(tx, [current.currentFactId as string]))).rejects.toThrow(
    "UNSUPPORTED_SOURCE_FACT_VERSION",
  );
  const history = await manual.revisions(owner, report.id);
  expect(history).toMatchObject({
    items: [
      { id: next.currentRevision.id, representation: "extended" },
      { id: report.currentRevision.id },
    ],
  });
});

test("built listening HTTP protects chunked uploads, actual limits, socket abort recovery and binary reads", async () => {
  const { createApp: builtApp }: { createApp: typeof createApp } = await import(
    pathToFileURL(resolve("apps/api/dist/app.js")).href
  );
  const { createManualReports: builtManual }: { createManualReports: typeof createManualReports } =
    await import(pathToFileURL(resolve("apps/api/dist/modules/manual-reports/service.js")).href);
  const module = builtManual(unit, manualConfig, { identity, catalogs, trips: tripService }, now);
  await expect(
    builtApp({ identity, manualReports: module, webRoot: root, checkReadiness: async () => true }),
  ).rejects.toThrow("PRIVATE_STATIC_ROOT_OVERLAP");
  await expect(
    builtApp({ manualReports: module, webRoot: root, checkReadiness: async () => true }),
  ).rejects.toThrow("PRIVATE_STATIC_ROOT_OVERLAP");
  const app = await builtApp({
    identity,
    manualReports: module,
    trips: tripService,
    checkReadiness: async () => true,
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (!address || typeof address === "string") throw Error("SYNTHETIC_LISTENER_REQUIRED");
  const port = address.port;
  async function http(
    path: string,
    method = "GET",
    headers: Record<string, string> = {},
    chunks: Buffer[] = [],
  ) {
    return new Promise<{
      status: number;
      headers: import("node:http").IncomingHttpHeaders;
      body: Buffer;
    }>((accept, reject) => {
      const req = request({ host: "127.0.0.1", port, path, method, headers }, (res) => {
        const body: Buffer[] = [];
        res.on("data", (chunk) => body.push(chunk));
        res.on("end", () =>
          accept({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(body) }),
        );
      });
      req.setTimeout(5000, () => req.destroy(new Error("SYNTHETIC_HTTP_DEADLINE")));
      req.on("error", () => reject(new Error("SYNTHETIC_HTTP_FAILURE")));
      for (const chunk of chunks) req.write(chunk);
      req.end();
    });
  }
  const boundary = "synthetic-real-manual-boundary",
    preamble = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="synthetic.png"\r\nContent-Type: image/png\r\n\r\n`,
    ),
    end = Buffer.from(`\r\n--${boundary}--\r\n`);
  try {
    const csrf = JSON.parse(
      (await http("/api/v1/auth/csrf", "GET", { cookie: ownerCookie })).body.toString(),
    ).data.token as string;
    const headers = {
      cookie: ownerCookie,
      origin: identityConfig.origin,
      "x-csrf-token": csrf,
      "idempotency-key": newId(),
      "content-type": `multipart/form-data; boundary=${boundary}`,
    };
    const denied = await http(
      "/api/v1/evidence",
      "POST",
      { "content-type": headers["content-type"] },
      [preamble, pngBytes(), end],
    );
    expect(denied.status).toBe(401);
    expect(
      (
        await http("/api/v1/evidence", "POST", { ...headers, "x-csrf-token": "invalid" }, [
          preamble,
          pngBytes(),
          end,
        ])
      ).status,
    ).toBe(403);
    const accepted = await http("/api/v1/evidence", "POST", headers, [
      preamble,
      pngBytes().subarray(0, 20),
      pngBytes().subarray(20),
      end,
    ]);
    expect(accepted.status).toBe(202);
    const image = JSON.parse(accepted.body.toString()).data as S["Evidence"];
    expect(
      (await http(`/api/v1/evidence/${image.id}/content`, "GET", { cookie: otherCookie })).status,
    ).toBe(404);
    expect(
      (await http(`/api/v1/evidence/${image.id}/content`, "GET", { cookie: staffCookie })).status,
    ).toBe(404);
    const download = await http(`/api/v1/evidence/${image.id}/content`, "GET", {
      cookie: ownerCookie,
    });
    expect(download.status).toBe(200);
    expect(download.body).toEqual(pngBytes());
    expect(download.headers["cache-control"]).toBe("no-store");
    expect(download.headers["x-content-type-options"]).toBe("nosniff");
    const oversized = await http(
      "/api/v1/evidence",
      "POST",
      { ...headers, "idempotency-key": newId() },
      [preamble, Buffer.alloc(manualConfig.storage.maxFileBytes + 1), end],
    );
    expect(oversized.status).toBe(413);
    const abortKey = newId();
    const interrupted = request({
      host: "127.0.0.1",
      port,
      path: "/api/v1/evidence",
      method: "POST",
      headers: { ...headers, "idempotency-key": abortKey },
    });
    interrupted.on("error", () => {});
    interrupted.write(preamble);
    interrupted.write(pngBytes().subarray(0, 16));
    try {
      await until(async () => {
        const [rows] = await control.query<RowDataPacket[]>(
          "SELECT COUNT(*) n FROM manual_evidence WHERE state='processing'",
        );
        return Number(rows[0]?.n) === 1;
      });
    } finally {
      interrupted.destroy();
    }
    await until(async () => {
      const [rows] = await control.query<RowDataPacket[]>(
        "SELECT COUNT(*) n FROM manual_evidence WHERE state='processing'",
      );
      return Number(rows[0]?.n) === 0;
    });
    expect(
      (
        await http("/api/v1/evidence", "POST", { ...headers, "idempotency-key": abortKey }, [
          preamble,
          pngBytes(),
          end,
        ])
      ).status,
    ).toBe(202);
    const submitted = await http(
      "/api/v1/manual-reports",
      "POST",
      { ...headers, "idempotency-key": newId(), "content-type": "application/json" },
      [Buffer.from(JSON.stringify({ fields: fields(image.id) }))],
    );
    expect(submitted.status).toBe(201);
    expect(submitted.headers.etag).toBe('"v1"');
    expect(
      (await http(`/api/v1/evidence/${image.id}/content`, "GET", { cookie: staffCookie })).status,
    ).toBe(200);
  } finally {
    await app.close();
  }
});

test("same-report current pointers and report-trip evidence references are restrictive relational invariants", async () => {
  const image = await upload(),
    first = await submit(image.id),
    second = await submit(image.id);
  for (const revision of [newId(), second.currentRevision.id])
    await expect(
      control.execute("UPDATE manual_reports SET current_revision_id=? WHERE id=?", [
        Buffer.from(revision),
        Buffer.from(first.id),
      ]),
    ).rejects.toSatisfy(hasCode("ER_NO_REFERENCED_ROW_2"));
  const unattached = await upload();
  await expect(
    control.execute(
      "INSERT INTO manual_evidence_refs(evidence_id,revision_id,report_id,trip_id) VALUES (?,?,?,?)",
      [
        Buffer.from(unattached.id),
        Buffer.from(first.currentRevision.id),
        Buffer.from(second.id),
        Buffer.from(second.tripId),
      ],
    ),
  ).rejects.toSatisfy(hasCode("ER_NO_REFERENCED_ROW_2"));
  await expect(
    control.execute(
      "INSERT INTO manual_evidence_refs(evidence_id,revision_id,report_id,trip_id) VALUES (?,?,?,?)",
      [
        Buffer.from(unattached.id),
        Buffer.from(first.currentRevision.id),
        Buffer.from(first.id),
        Buffer.from(second.tripId),
      ],
    ),
  ).rejects.toSatisfy(hasCode("ER_NO_REFERENCED_ROW_2"));
  expect((await manual.getReport(owner, first.id)).currentRevision.id).toBe(
    first.currentRevision.id,
  );
});

test("retention and processing recovery scans use bounded selective indexes through retained history", async () => {
  const created = now().toISOString();
  await unit.run((tx) =>
    unit
      .client(tx)
      .insert(manualEvidence)
      .values(
        Array.from({ length: 500 }, () => ({
          id: newId(),
          generation: newId(),
          ownerId: owner.userId,
          state: "expired" as const,
          originalName: "synthetic.png",
          contentType: "image/png",
          sha256: Buffer.alloc(32),
          fingerprint: Buffer.alloc(32),
          byteLength: 1,
          createdAt: created,
          updatedAt: created,
          nextCheckAt: created,
        })),
      ),
  );
  await unit.run((tx) =>
    unit
      .client(tx)
      .insert(manualEvidence)
      .values([
        {
          id: newId(),
          generation: newId(),
          ownerId: owner.userId,
          state: "ready" as const,
          originalName: "synthetic.png",
          contentType: "image/png",
          sha256: Buffer.alloc(32),
          fingerprint: Buffer.alloc(32),
          byteLength: 1,
          createdAt: created,
          updatedAt: created,
          nextCheckAt: created,
        },
        {
          id: newId(),
          generation: newId(),
          ownerId: owner.userId,
          state: "processing" as const,
          originalName: "synthetic.png",
          contentType: "image/png",
          createdAt: created,
          updatedAt: created,
          nextCheckAt: created,
          leaseUntil: created,
        },
      ]),
  );
  await control.query("ANALYZE TABLE manual_evidence");
  for (const [shape, statement, key] of [
    [
      "retention",
      "SELECT id FROM manual_evidence WHERE state='ready' AND next_check_at<='2027-01-01 00:00:00.000' ORDER BY next_check_at,id LIMIT 25",
      "manual_evidence_retention_scan",
    ],
    [
      "processing",
      "SELECT id FROM manual_evidence WHERE state='processing' AND lease_until<='2027-01-01 00:00:00.000' ORDER BY lease_until,id LIMIT 25",
      "manual_evidence_recovery",
    ],
  ]) {
    const [rows] = await control.query<RowDataPacket[]>(`EXPLAIN ${statement}`);
    expect(rows[0]?.key).toBe(key);
    expect(Number(rows[0]?.rows)).toBeLessThan(10);
    console.log(
      JSON.stringify({
        event: "manual_query_plan",
        shape,
        index: rows[0]?.key,
        access: rows[0]?.type,
        estimatedRows: Number(rows[0]?.rows),
      }),
    );
  }
});

test("lost command receipt after actual MySQL commit is not replayed automatically and resolves by the original key", async () => {
  const image = await upload(),
    key = newId();
  let executions = 0;
  const lost: UnitOfWork = {
    client: (tx) => unit.client(tx),
    close: async () => {},
    async run(fn) {
      executions++;
      await unit.run(fn);
      throw new TransactionCommitOutcomeUnknownError(new Error("SYNTHETIC_LOST_ACK"));
    },
  };
  const isolated = createManualReports(
    lost,
    manualConfig,
    { identity, catalogs, trips: tripService, blobs },
    now,
  );
  await expect(
    isolated.submitReport(owner, key, { fields: fields(image.id) }),
  ).rejects.toMatchObject({ statusCode: 503, publicCode: "DEPENDENCY_UNAVAILABLE" });
  expect(executions).toBe(1);
  const replay = await manual.submitReport(owner, key, { fields: fields(image.id) });
  expect(replay.currentRevision.number).toBe(1);
  expect(await counts()).toMatchObject({ trips: 1, reports: 1, revisions: 1, messages: 1 });
  const failing = createManualReports(
    unit,
    manualConfig,
    {
      identity,
      catalogs,
      trips: {
        ...tripService,
        async storeInTransaction(...args: Parameters<Trips["storeInTransaction"]>) {
          await tripService.storeInTransaction(...args);
          throw Error("SYNTHETIC_AFTER_SOURCE_FAILURE");
        },
      },
      blobs,
    },
    now,
  );
  await expect(failing.submitReport(owner, newId(), { fields: fields(image.id) })).rejects.toThrow(
    "SYNTHETIC_AFTER_SOURCE_FAILURE",
  );
  expect(await counts()).toMatchObject({ trips: 1, reports: 1, revisions: 1, messages: 1 });
});

test("stale deletion generations cannot expire a ready object; two ordinary workers complete one tombstone", async () => {
  const image = await upload(),
    report = await submit(image.id),
    queue = createQueue(unit, [manual.handler]);
  await unit.run((tx) =>
    queue.enqueue(tx, {
      kind: manual.handler.kind,
      consumer: manual.handler.consumer,
      schemaVersion: 1,
      eventId: null,
      effectKey: `stale:${image.id}`,
      reference: { evidenceId: image.id, generation: newId() },
      availableAt: "2020-01-01T00:00:00.000Z",
      maxAttempts: 3,
    }),
  );
  expect((await runPass(queue, new AbortController().signal)).processed).toBe(1);
  expect((await manual.metadata(owner, image.id)).state).toBe("ready");
  await terminal(report);
  instant = Date.parse("2028-10-21T12:00:00.000Z");
  expect(await manual.reserveExpiry(image.id)).toBe(true);
  await control.query(
    "UPDATE durable_jobs SET state='failed',failure='handler_failed' WHERE kind='manual.evidence-delete' AND state='ready'",
  );
  await manual.maintenance(new AbortController().signal);
  const [retry] = await unit.run((tx) =>
    unit.client(tx).select().from(manualEvidence).where(eq(manualEvidence.id, image.id)),
  );
  expect(retry?.deleteAttempt).toBe(2);

  await control.query(
    "UPDATE durable_jobs SET available_at=UTC_TIMESTAMP(3) WHERE kind='manual.evidence-delete'",
  );
  const results = await Promise.all([
    runPass(queue, new AbortController().signal),
    runPass(createQueue(unit, [manual.handler]), new AbortController().signal),
  ]);
  expect(results.reduce((sum, row) => sum + row.processed, 0)).toBe(1);
  expect((await manual.metadata(owner, image.id)).state).toBe("expired");
});

async function generationWorker(signal?: AbortSignal) {
  signal?.throwIfAborted();
  const started = performance.now();
  const db = guardedSettings();
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "test/support/manual-generation-worker.ts", root],
    {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: {
        ...safeChildEnvironment(),
        MYSQL_HOST: db.host,
        MYSQL_PORT: String(db.port),
        MYSQL_DATABASE: db.database,
        MYSQL_USER: db.user,
        MYSQL_PASSWORD: db.password,
        DB_TEST_RESET_ACK: "synthetic-only",
        VTC_TEST_CONFIG: process.env.VTC_TEST_CONFIG,
      },
    },
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output = (output + String(chunk)).slice(-4000);
  });
  child.stderr.resume();
  const stop = () => {
    child.kill("SIGKILL");
  };
  const timer = setTimeout(stop, 5000);
  signal?.addEventListener("abort", stop, { once: true });
  if (signal?.aborted) stop();
  const status = await new Promise<number | null>((accept, reject) => {
    child.once("exit", accept);
    child.once("error", () => reject(Error("SYNTHETIC_GENERATION_WORKER_START_FAILED")));
  }).finally(() => {
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
  });
  expect(status).toBe(0);
  const lines = output.trim().split("\n"),
    last = JSON.parse(lines.at(-1) ?? "{}");
  expect(last.event).toBe("manual_generation_worker");
  console.log(
    JSON.stringify({
      event: "manual_generation_process_duration",
      durationMs: Math.round(performance.now() - started),
      processed: last.processed,
    }),
  );
  return last as { processed: number; pid: number };
}
test("durable generation intent makes bounded progress beyond100 protected current files across fresh worker processes", async () => {
  const signal = AbortSignal.timeout(11000),
    image = await upload();
  await submit(image.id);
  const [original] = await unit.run((tx) =>
    unit.client(tx).select().from(manualEvidence).where(eq(manualEvidence.id, image.id)),
  );
  if (!original) throw Error("SYNTHETIC_EVIDENCE_REQUIRED");
  const protectedRows = Array.from({ length: 105 }, () => ({
    ...original,
    id: newId(),
    generation: newId(),
    nextCheckAt: "9999-01-01T00:00:00.000Z",
  }));
  await unit.run((tx) => unit.client(tx).insert(manualEvidence).values(protectedRows));
  const obsolete = { evidenceId: image.id, generation: newId() },
    candidates = [
      ...protectedRows.map((row) => ({ evidenceId: row.id, generation: row.generation })),
      obsolete,
    ].map((key, index) => ({
      ...key,
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
      leaseUntil: "2020-01-01T00:00:00.000Z",
      nextCheckAt: new Date(Date.parse("2020-01-01T00:00:00.000Z") + index).toISOString(),
    }));
  await unit.run((tx) => unit.client(tx).insert(manualBlobGenerations).values(candidates));
  for (const candidate of candidates)
    await writeFile(
      join(root, candidate.evidenceId + "." + candidate.generation + ".blob"),
      pngBytes(),
      { flag: "wx", mode: 0o600 },
    );
  const unregistered = newId() + "." + newId() + ".blob";
  await writeFile(join(root, unregistered), pngBytes(), { flag: "wx", mode: 0o600 });
  expect((await readdir(root)).length).toBeGreaterThan(100);
  const workers = [];
  for (let pass = 0; pass < 5; pass++) workers.push(await generationWorker(signal));
  expect(workers.map((worker) => worker.processed)).toEqual([0, 0, 0, 0, 1]);
  expect(new Set(workers.map((worker) => worker.pid)).size).toBe(5);
  const names = await readdir(root);
  for (const row of protectedRows) expect(names).toContain(row.id + "." + row.generation + ".blob");
  expect(names).not.toContain(obsolete.evidenceId + "." + obsolete.generation + ".blob");
  expect(names).toContain(unregistered);
  expect((await manual.metadata(owner, image.id)).state).toBe("ready");
  const [intents] = await control.query<RowDataPacket[]>(
    "SELECT COUNT(*) n FROM manual_blob_generations",
  );
  expect(Number(intents[0]?.n)).toBe(107);
});
test("missing generation observations survive late actual finalization and reconcile in a fresh worker", async () => {
  const image = await upload();
  await submit(image.id);
  const generation = newId(),
    key = { id: image.id, generation };
  await unit.run((tx) =>
    unit.client(tx).insert(manualBlobGenerations).values({
      evidenceId: image.id,
      generation,
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
      leaseUntil: "2020-01-01T00:00:00.000Z",
      nextCheckAt: "2020-01-01T00:00:00.000Z",
    }),
  );
  expect((await generationWorker()).processed).toBe(0);
  const [seen] = await unit.run((tx) =>
    unit
      .client(tx)
      .select()
      .from(manualBlobGenerations)
      .where(eq(manualBlobGenerations.generation, generation)),
  );
  expect(seen?.state).toBe("tracked");
  expect(seen?.nextCheckAt).not.toBe("2020-01-01T00:00:00.000Z");
  // A delayed immutable publication arrives AFTER the sweep's missing result.
  await blobs.put(key, bytes());
  await control.execute(
    "UPDATE manual_blob_generations SET next_check_at='2020-01-01 00:00:00.000' WHERE generation=?",
    [Buffer.from(generation)],
  );
  expect((await generationWorker()).processed).toBe(1);
  expect(await blobs.present(key)).toBe(false);
  expect((await manual.metadata(owner, image.id)).state).toBe("ready");
});

test("every initial, ready replay and rejected retry generation commits its intent before actual file I/O", async () => {
  const observed: string[] = [];
  const proving: PrivateBlobs = {
    ...blobs,
    async put(key, input, signal) {
      const [row] = await unit.run((tx) =>
        unit
          .client(tx)
          .select()
          .from(manualBlobGenerations)
          .where(eq(manualBlobGenerations.generation, key.generation))
          .for("update"),
      );
      expect(row?.evidenceId).toBe(key.id);
      expect(row?.state).toBe("tracked");
      observed.push(key.generation);
      return blobs.put(key, input, signal);
    },
  };
  const module = createManualReports(
      unit,
      manualConfig,
      { identity, catalogs, trips: tripService, blobs: proving },
      now,
    ),
    key = newId();
  const first = await module.upload(owner, key, "synthetic.png", bytes(), "image/png");
  expect((await module.upload(owner, key, "synthetic.png", bytes(), "image/png")).id).toBe(
    first.id,
  );
  const failed = newId();
  await expect(
    module.upload(owner, failed, "synthetic.png", bytes(Buffer.from("invalid")), "image/png"),
  ).rejects.toBeDefined();
  await module.upload(owner, failed, "synthetic.png", bytes(), "image/png");
  expect(new Set(observed).size).toBe(4);
});

test("generation cleanup retries a failed file effect durably and recovers an exhausted job in a fresh worker", async () => {
  const image = await upload();
  await submit(image.id);
  const generation = newId(),
    key = { id: image.id, generation };
  await unit.run((tx) =>
    unit.client(tx).insert(manualBlobGenerations).values({
      evidenceId: image.id,
      generation,
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
      leaseUntil: "2020-01-01T00:00:00.000Z",
      nextCheckAt: "2020-01-01T00:00:00.000Z",
    }),
  );
  await blobs.put(key, bytes());
  const failing: PrivateBlobs = {
    ...blobs,
    async remove(ref, staging) {
      if (ref.generation === generation && !staging) throw Error("SYNTHETIC_FILE_EFFECT_FAILURE");
      return blobs.remove(ref, staging);
    },
  };
  const module = createManualReports(
    unit,
    manualConfig,
    { identity, catalogs, trips: tripService, blobs: failing },
    now,
  );
  await module.maintenance(new AbortController().signal);
  const queue = createQueue(unit, [module.handler, module.generationHandler]);
  expect((await runPass(queue, new AbortController().signal)).processed).toBe(1);
  expect(await blobs.present(key)).toBe(true);
  const [failed] = await control.query<RowDataPacket[]>(
    "SELECT state,attempts FROM durable_jobs WHERE kind='manual.generation-delete'",
  );
  expect(failed[0]?.state).toBe("ready");
  expect(Number(failed[0]?.attempts)).toBe(1);
  await control.query(
    "UPDATE durable_jobs SET state='failed',attempts=max_attempts,failure='handler_failed' WHERE kind='manual.generation-delete'",
  );
  await control.execute(
    "UPDATE manual_blob_generations SET next_check_at='2020-01-01 00:00:00.000' WHERE generation=?",
    [Buffer.from(generation)],
  );
  expect((await generationWorker()).processed).toBe(1);
  expect(await blobs.present(key)).toBe(false);
  const [saved] = await unit.run((tx) =>
    unit
      .client(tx)
      .select()
      .from(manualBlobGenerations)
      .where(eq(manualBlobGenerations.generation, generation)),
  );
  expect(saved).toMatchObject({ state: "tracked", deleteAttempt: 2 });
  expect((await manual.metadata(owner, image.id)).state).toBe("ready");
});

test("continuous real reference changes defer retention instead of starving the maintenance page", async () => {
  const image = await upload(),
    first = await submit(image.id);
  await terminal(first);
  instant = Date.parse("2028-10-21T12:00:00.000Z");
  let pending: (() => void) | undefined, release: (() => void) | undefined;
  const instrumented: Trips = {
    ...tripService,
    async statesInTransaction(tx, ids, lock) {
      if (lock) {
        pending?.();
        await bounded(
          new Promise<void>((accept) => {
            release = accept;
          }),
          "manual_reference_barrier",
        );
      }
      return tripService.statesInTransaction(tx, ids, lock);
    },
  };
  const module = createManualReports(
    unit,
    manualConfig,
    { identity, catalogs, trips: instrumented, blobs },
    now,
  );

  // Each barrier uses a real concurrent submitted report/reference before locking.
  const notices: Promise<void>[] = [],
    signals: (() => void)[] = [];
  for (let i = 0; i < 3; i++) notices.push(new Promise<void>((accept) => signals.push(accept)));
  let calls = 0;
  pending = () => signals[calls++]?.();
  const expiry = module.reserveExpiry(image.id);
  for (let i = 0; i < 3; i++) {
    await bounded(
      notices[i] ?? Promise.reject(Error("SYNTHETIC_BARRIER_MISSING")),
      "manual_reference_notice",
    );
    await submit(image.id);
    release?.();
  }
  expect(await expiry).toBe(false);
  expect(calls).toBe(3);
  const [row] = await unit.run((tx) =>
    unit.client(tx).select().from(manualEvidence).where(eq(manualEvidence.id, image.id)),
  );
  if (!row) throw Error("SYNTHETIC_EVIDENCE_REQUIRED");
  expect(row.nextCheckAt > now().toISOString()).toBe(true);
});

test("decision retention seam rejects an obsolete manual revision after a peer commit despite an older RR snapshot", async () => {
  const image = await upload(),
    first = await submit(image.id);
  let seen!: () => void, release!: () => void;
  const snapshot = new Promise<void>((accept) => {
      seen = accept;
    }),
    resume = new Promise<void>((accept) => {
      release = accept;
    });
  const decision = unit.run(async (tx) => {
    await unit.client(tx).select().from(manualReports).where(eq(manualReports.id, first.id));
    seen();
    await bounded(resume, "manual_decision_resume");
    await identity.authorizeInTransaction(tx, staff, "trips.review");
    await tripService.manualGateInTransaction(tx, owner.userId, first.tripId);
    await unit
      .client(tx)
      .update(trips)
      .set({ decision: "accepted", reviewHold: false, correctionPending: false })
      .where(eq(trips.id, first.tripId));
    await manual.decisionRecordedInTransaction(
      tx,
      staff,
      first.id,
      first.currentRevision.id,
      now().toISOString(),
    );
  });
  const outcome = decision.then(
    () => ({ accepted: true }),
    (error) => ({ error }),
  );
  await bounded(snapshot, "manual_decision_snapshot");
  const revised = await manual.reviseReport(owner, first.id, newId(), first.version, {
    fields: { ...fields(image.id), actualDistanceM: "2" },
    expectedTripVersion: first.tripVersion,
  });
  release();
  const result = await outcome;
  expect(result).toHaveProperty("error.statusCode", 409);
  expect((await manual.getReport(owner, first.id)).currentRevision.id).toBe(
    revised.currentRevision.id,
  );
  const [trip] = await unit.run((tx) => tripService.statesInTransaction(tx, [first.tripId]));
  expect(trip?.decision).toBe("pending_review");
});

test("draft-only composition pauses both manual deletion kinds without consuming attempts when storage is absent", async () => {
  const image = await upload(),
    report = await submit(image.id);
  await terminal(report);
  instant = Date.parse("2027-10-21T12:00:00.000Z");
  expect(await manual.reserveExpiry(image.id)).toBe(true);
  await control.query(
    "UPDATE durable_jobs SET available_at=UTC_TIMESTAMP(3) WHERE kind='manual.evidence-delete'",
  );
  const producer = createQueue(unit, [manual.handler, manual.generationHandler]);
  await unit.run((tx) =>
    producer.enqueue(tx, {
      kind: manual.generationHandler.kind,
      consumer: manual.generationHandler.consumer,
      schemaVersion: 1,
      eventId: null,
      effectKey: "synthetic:configuration-pause",
      reference: { evidenceId: image.id, generation: newId() },
      availableAt: new Date().toISOString(),
      maxAttempts: 5,
    }),
  );
  const { storage: _storage, ...draftOnlyConfig } = manualConfig;
  const composed = composeIdentity(
    unit,
    identityConfig,
    undefined,
    undefined,
    false,
    {
      production: false,
      synthetic: true,
      cursorKey: randomBytes(32).toString("hex"),
      maxFileBytes: 1024 * 1024,
      artifactTtlMs: 86400000,
      policyRevision: 1,
      evidence: [],
    },
    { cursorKey: randomBytes(32).toString("hex") },
    undefined,
    draftOnlyConfig,
  );
  if (!composed.manualReports) throw Error("SYNTHETIC_MANUAL_COMPOSITION_REQUIRED");
  expect(await composed.manualReports.maintenance(new AbortController().signal)).toBe(
    "configuration_pending",
  );
  expect((await composed.manualReports.policy(owner)).enabled).toBe(false);
  expect((await runPass(composed.jobsQueue, new AbortController().signal)).processed).toBe(0);
  const [jobs] = await control.query<RowDataPacket[]>(
    "SELECT state,attempts FROM durable_jobs WHERE kind IN ('manual.evidence-delete','manual.generation-delete')",
  );
  expect(jobs).toHaveLength(2);
  for (const job of jobs) expect(job).toMatchObject({ state: "ready", attempts: 0 });
  const [evidence] = await control.query<RowDataPacket[]>(
    "SELECT state FROM manual_evidence WHERE id=?",
    [image.id],
  );
  expect(evidence[0]?.state).toBe("deleting");
});
