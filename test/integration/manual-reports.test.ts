import { spawn } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { components } from "@vtc/contracts";
import {
  createUnitOfWork,
  newId,
  runMigrations,
  TransactionCommitOutcomeUnknownError,
  type UnitOfWork,
} from "@vtc/db";
import {
  catalogCargoes,
  catalogCities,
  catalogCompanies,
  catalogCompanyCities,
} from "@vtc/db/catalogs-schema";
import { membership, roles } from "@vtc/db/identity-schema";
import {
  eq,
  manualBlobGenerations,
  manualCommands,
  manualDraftEvidence,
  manualDraftHistory,
  manualDrafts,
  manualEvidence,
  manualEvidenceReferences,
  manualReports,
  manualReviewGates,
  manualRevisions,
  sql,
} from "@vtc/db/manual-reports-schema";
import { outboxEvents } from "@vtc/db/platform-schema";
import {
  sourceMessages,
  sourcePayloads,
  tripFacts,
  tripFactTrailers,
  trips,
} from "@vtc/db/trips-schema";
import type { Connection, RowDataPacket } from "mysql2/promise";
import {
  afterEach,
  beforeEach,
  expect,
  test,
  afterAll as vitestAfterAll,
  beforeAll as vitestBeforeAll,
} from "vitest";
import { createApp } from "../../apps/api/src/app.ts";
import { type Catalogs, createCatalogs } from "../../apps/api/src/modules/catalogs/service.ts";
import { createEvents, type Events } from "../../apps/api/src/modules/events/service.ts";
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
import { createQualifications } from "../../apps/api/src/modules/qualifications/service.ts";
import { canonicalJson } from "../../apps/api/src/modules/sources/contracts/canonical.ts";
import type { NormalizedTripEvidence } from "../../apps/api/src/modules/sources/contracts/evidence.ts";
import { createTrips, type Trips } from "../../apps/api/src/modules/trips/service.ts";
import {
  BlobFailure,
  createPrivateFilesystem,
  type PrivateBlobs,
} from "../../apps/api/src/platform/blob-storage/filesystem.ts";
import { createQueue } from "../../apps/api/src/platform/jobs/queue.ts";
import { runPass } from "../../apps/api/src/platform/jobs/runner.ts";
import { identityAccessEvents } from "../../apps/api/src/platform/outbox/events.ts";
import { composeIdentity } from "../../apps/api/src/use-cases/identity-messaging.ts";
import { catalogConfig, seedCatalog } from "../fixtures/catalogs/synthetic.ts";
import { pngBytes } from "../fixtures/manual-images.ts";
import {
  guardedSettings,
  hasCode,
  reset,
  SCHEMA_SETUP_TIMEOUT_MS,
  testConnection,
} from "../persistence/support.ts";
import { telemetryFixture } from "../support/builders.ts";
import { bounded, deferred, until } from "../support/concurrency.ts";
import { safeChildEnvironment } from "../support/environment.ts";
import { fixtureDatabaseFailure } from "../support/fixture-database-diagnostics.ts";
import { childClose, fixtureSettlement } from "../support/fixture-settlement.ts";
import {
  type GenerationCase,
  generationProcessLine,
  generationTransactionArguments,
  parseGenerationWorkerLine,
} from "../support/manual-generation-diagnostics.ts";
import { manualJobsObservation } from "../support/manual-jobs-diagnostics.ts";
import { schemaLifecycleHooks } from "../support/schema-lifecycle.ts";

const { beforeAll, afterAll } = schemaLifecycleHooks(vitestBeforeAll, vitestAfterAll);
const workerCases = fixtureSettlement();
function it(name: string, work: () => Promise<void>, timeout?: number) {
  test(name, () => workerCases.track(work()), timeout);
}

type S = components["schemas"];
let control: Connection,
  unit: UnitOfWork,
  identity: Identity,
  catalogs: Catalogs,
  events: Events,
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
function undatedFields(evidenceId: string): S["ManualSubmissionFields"] {
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
const referenceDates = {
  startedAt: "2026-09-19T08:00:00.001Z",
  completedAt: "2026-09-19T09:00:00.002Z",
};
function fields(evidenceId: string): S["ManualDatedSubmissionFields"] {
  return { ...undatedFields(evidenceId), ...referenceDates };
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
  catalogs = createCatalogs(unit, catalogConfig(), { identity });
  events = createEvents(unit, { cursorKey: randomBytes(32).toString("hex") }, { identity }, now);
  tripService = createTrips(
    unit,
    { cursorKey: randomBytes(32).toString("hex") },
    {
      identity,
      catalogs,
      manualEvidence: (tx, owner, payload, tripId) =>
        manual.validateSourceInTransaction(tx, owner, payload, tripId),
      manualProjection: (tx, ids) => manual.projectionInTransaction(tx, ids),
      manualRevisions: (tx, ids) => manual.revisionSummariesInTransaction(tx, ids),
      eventTitles: events.tripTitlesInTransaction,
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
  // Framework timeout does not cancel a child or its original callback.
  await workerCases.wait();
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
    "trip_contribution_history",
    "trip_contributions",
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
  await workerCases.wait();
  await unit?.close();
  await control?.end();
  if (root) await rm(root, { recursive: true, force: true });
});
afterEach(async ({ task }) => {
  if (task.result?.state !== "fail") return;
  await workerCases.wait();
  const caseId = task.name.startsWith("durable generation intent")
    ? "generation_progress"
    : task.name.startsWith("missing generation observations")
      ? "generation_late"
      : task.name.startsWith("generation cleanup retries")
        ? "generation_retry"
        : task.name.startsWith("unavailable due manual storage")
          ? "manual_storage"
          : null;
  if (caseId) await fixtureDatabaseFailure(control, caseId);
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
    originCityId: null,
    cargoId: null,
    adrClass: null,
  });
  await expect(
    manual.submitDraft(owner, draft.id, submissionKey, saved.version, {
      fields: { ...fields(image.id), actualDistanceM: "2" },
    }),
  ).rejects.toMatchObject({ publicCode: "IDEMPOTENCY_CONFLICT" });
});

test("manual event fallback omits a wrong-game reference and shows the matching revision title", async () => {
  const input: S["EventInput"] = {
    title: "Fictional ATS convoy",
    description: "Fictional manual association",
    game: "ats",
    server: "Synthetic",
    organizer: "Fictional company",
    meetingLocation: "Fictional yard",
    route: "Fictional route",
    meetingAt: new Date(instant + 1800000).toISOString(),
    startsAt: new Date(instant + 3600000).toISOString(),
    endsAt: null,
    visibility: "members",
    originCityId: null,
    destinationCityId: null,
    prescribedCargoId: null,
    prescribedMassKg: null,
    prescribedTrailerTypeId: null,
  };
  const ats = (await events.create(staff, newId(), input)).data.event;
  const ets2 = (
    await events.create(staff, newId(), { ...input, title: "Fictional ETS2 convoy", game: "ets2" })
  ).data.event;
  const image = await upload();
  const report = await manual.submitReport(owner, newId(), {
    fields: { ...fields(image.id), eventId: ats.id },
  });
  expect(report.currentRevision.fields.eventId).toBe(ats.id);
  expect((await tripService.list(owner, { scope: "mine" })).items[0]).toMatchObject({
    id: report.tripId,
    event: null,
  });
  expect((await tripService.list(reviewer, { scope: "review" })).items[0]).toMatchObject({
    id: report.tripId,
    event: null,
  });
  expect(await tripService.detail(owner, report.tripId)).toMatchObject({
    view: "private",
    summary: { event: null },
  });

  await manual.reviseReport(owner, report.id, newId(), report.version, {
    fields: { ...fields(image.id), eventId: ets2.id },
    expectedTripVersion: report.tripVersion,
  });
  const [matching] = (await tripService.list(owner, { scope: "mine" })).items;
  expect(matching?.id).toBe(report.tripId);
  expect(matching?.event).toEqual({ id: ets2.id, title: ets2.title });
});

test("same-ETag revisions race safely, rejected edits retain history, and accepted correction requests preserve effective results", async () => {
  const image = await upload(),
    key = newId(),
    report = await submit(image.id, key),
    value = {
      fields: { ...fields(image.id), actualDistanceM: "20" },
      expectedTripVersion: report.tripVersion,
    };
  const [first] = (await tripService.list(owner, { scope: "mine" })).items;
  expect(first).toMatchObject({
    id: report.tripId,
    submittedAt: report.currentRevision.submittedAt,
    gameMode: "unknown",
  });
  instant += 1;
  const edits = await Promise.allSettled([
    manual.reviseReport(owner, report.id, newId(), report.version, value),
    manual.reviseReport(owner, report.id, newId(), report.version, value),
  ]);
  expect(edits.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(edits.filter((r) => r.status === "rejected")).toHaveLength(1);
  const revised = await manual.getReport(owner, report.id);
  expect(revised.currentRevision.number).toBe(2);
  expect(revised.currentRevision.submittedAt).not.toBe(report.currentRevision.submittedAt);
  const [reviewed] = (await tripService.list(reviewer, { scope: "review" })).items;
  expect(reviewed).toMatchObject({
    id: report.tripId,
    number: first?.number,
    createdAt: first?.createdAt,
    submittedAt: revised.currentRevision.submittedAt,
    review: { manualRevision: { number: 2, submittedAt: revised.currentRevision.submittedAt } },
  });
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
  expect(view).toMatchObject({ view: "summary", submittedAt: report.currentRevision.submittedAt });
  expect(view).not.toHaveProperty("evidence");
  expect(view).not.toHaveProperty("event");
  expect(view).not.toHaveProperty("gameMode");
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
  } finally {
    await app.close();
  }
});

const emptyJsonHeaders = { "content-type": "application/json", "content-length": "0" };

test("staged HTTP writes save partial dates, clear omitted references and replace them on final submission", async () => {
  const app = await createApp({
    identity,
    manualReports: manual,
    checkReadiness: async () => true,
  });
  const image = await upload();
  const headers = {
    cookie: ownerCookie,
    origin: identityConfig.origin,
    "x-csrf-token": csrfProtection(identityConfig).issue({}, owner).token,
  };
  function write(
    method: "POST" | "PUT",
    url: string,
    payload: object,
    key = newId(),
    version?: number,
  ) {
    return app.inject({
      method,
      url,
      headers: {
        ...headers,
        "idempotency-key": key,
        ...(version === undefined ? {} : { "if-match": `"v${version}"` }),
      },
      payload,
    });
  }
  try {
    const created = await write("POST", "/api/v1/me/manual-drafts", {
      fields: { startedAt: referenceDates.startedAt, cargoDamagePercent: 0 },
    });
    expect(created.statusCode).toBe(201);
    const { data: draft } = created.json() as S["EnvelopeManualDraft"];
    expect(draft.fields).toEqual({ startedAt: referenceDates.startedAt, cargoDamagePercent: 0 });

    const path = `/api/v1/me/manual-drafts/${draft.id}`;
    const replacement = { fields: { completedAt: referenceDates.completedAt } };
    const replaceKey = newId();
    const replaced = await write("PUT", path, replacement, replaceKey, draft.version);
    expect(replaced.statusCode).toBe(200);
    const { data: saved } = replaced.json() as S["EnvelopeManualDraft"];
    expect(saved.fields).toEqual(replacement.fields);
    expect((await manual.getDraft(owner, draft.id)).fields).toEqual(replacement.fields);
    const [stored] = await unit.run((tx) =>
      unit.client(tx).select().from(manualDrafts).where(eq(manualDrafts.id, draft.id)),
    );
    expect(stored).toMatchObject({
      fields: {},
      startedAt: null,
      completedAt: referenceDates.completedAt,
      cargoDamagePercent: null,
    });

    const dated = {
      ...fields(image.id),
      completedAt: now().toISOString(),
      cargoDamagePercent: 100,
    };
    const final = await write(
      "POST",
      `${path}/submission`,
      { fields: dated },
      newId(),
      saved.version,
    );
    expect(final.statusCode).toBe(201);
    const { data: submitted } = final.json() as S["EnvelopeManualReport"];
    expect(submitted.currentRevision.fields).toMatchObject(dated);
    expect(await manual.getDraft(owner, draft.id)).toMatchObject({
      state: "submitted",
      fields: dated,
      submittedReportId: submitted.id,
    });
    const oldDraft = await write("PUT", path, replacement, replaceKey, draft.version);
    expect(oldDraft.statusCode).toBe(200);
    expect((oldDraft.json() as S["EnvelopeManualDraft"]).data).toEqual(saved);

    const createKey = newId();
    const rejected = await write(
      "POST",
      "/api/v1/manual-reports",
      { fields: undatedFields(image.id) },
      createKey,
    );
    expect(rejected.statusCode).toBe(422);
    const direct = await write("POST", "/api/v1/manual-reports", { fields: dated }, createKey);
    expect(direct.statusCode).toBe(201);
    const { data: report } = direct.json() as S["EnvelopeManualReport"];
    const damage = 12.345678901234567;
    const revision = await write(
      "POST",
      `/api/v1/manual-reports/${report.id}/revisions`,
      { expectedTripVersion: report.tripVersion, fields: { ...dated, cargoDamagePercent: damage } },
      newId(),
      report.version,
    );
    expect(revision.statusCode).toBe(200);
    const { data: revised } = revision.json() as S["EnvelopeManualReport"];
    expect(revised.currentRevision.fields).toMatchObject({ ...dated, cargoDamagePercent: damage });
    const history = await manual.revisions(owner, report.id, {}, false, report.currentRevision.id);
    expect(history).toEqual(report.currentRevision);
  } finally {
    await app.close();
  }
});

test("final dates and damage fail closed without creating trips or receipts", async () => {
  const image = await upload();
  const base = fields(image.id);
  for (const invalid of [
    undatedFields(image.id),
    { ...undatedFields(image.id), startedAt: base.startedAt },
    { ...undatedFields(image.id), completedAt: base.completedAt },
    { ...base, startedAt: base.completedAt },
    { ...base, startedAt: "2026-09-20T08:00:00.001Z" },
    { ...base, completedAt: new Date(instant + 1).toISOString() },
    { ...base, startedAt: "2026-02-30T08:00:00.001Z" },
    { ...base, startedAt: "0999-12-31T08:00:00.001Z" },
    { ...base, startedAt: "2026-09-19T08:00:00+00:00" },
    { ...base, cargoDamagePercent: -0.1 },
    { ...base, cargoDamagePercent: 100.1 },
  ]) {
    await expect(
      Promise.resolve().then(() => manual.submitReport(owner, newId(), { fields: invalid })),
    ).rejects.toMatchObject({ statusCode: 422 });
  }
  await expect(
    manual.createDraft(owner, newId(), { fields: { startedAt: "0999-12-31T08:00:00.001Z" } }),
  ).rejects.toMatchObject({ statusCode: 422 });
  expect(await counts()).toMatchObject({ trips: 0, reports: 0, revisions: 0, messages: 0 });
  const receipts = await unit.run((tx) => unit.client(tx).select().from(manualCommands));
  expect(receipts.map((row) => row.scope.toString())).toEqual(["upload"]);

  const dated = { ...base, startedAt: "1000-01-01T00:00:00.000Z", cargoDamagePercent: 0 };
  const report = await manual.submitReport(owner, newId(), { fields: dated });
  expect(report.currentRevision.fields).toMatchObject(dated);
});

test("company selections require visible same-game depots and stay private reference data", async () => {
  const cities = await seedCatalog(unit, "ets2", {
    cities: ["reference-north", "reference-south"],
  });
  const ats = await seedCatalog(unit, "ats", { cities: ["reference-ats"] });
  const north = cities.id("reference-north"),
    south = cities.id("reference-south"),
    atsCity = ats.id("reference-ats");
  const originCompanyId = newId(),
    destinationCompanyId = newId(),
    atsCompanyId = newId(),
    originDepot = newId();
  await unit.run(async (tx) => {
    const client = unit.client(tx);
    await client.insert(catalogCompanies).values([
      {
        id: originCompanyId,
        game: "ets2",
        code: Buffer.from("reference-north"),
        nameEn: "Fictional North Depot",
      },
      {
        id: destinationCompanyId,
        game: "ets2",
        code: Buffer.from("reference-south"),
        nameEn: "Fictional South Depot",
      },
      {
        id: atsCompanyId,
        game: "ats",
        code: Buffer.from("reference-ats"),
        nameEn: "Fictional ATS Depot",
      },
    ]);
    await client.insert(catalogCompanyCities).values([
      { id: originDepot, game: "ets2", cityId: north, companyId: originCompanyId },
      { id: newId(), game: "ets2", cityId: south, companyId: destinationCompanyId },
      { id: newId(), game: "ats", cityId: atsCity, companyId: atsCompanyId },
    ]);
  });
  const resolved = (entityId: string) => ({ status: "resolved" as const, entityId });
  for (const invalid of [
    { originCompanyId },
    { game: "ets2" as const, originCompanyId, origin: resolved(south) },
    { game: "ets2" as const, originCompanyId: atsCompanyId, origin: resolved(atsCity) },
  ]) {
    await expect(manual.createDraft(owner, newId(), { fields: invalid })).rejects.toMatchObject({
      statusCode: 422,
    });
  }

  const image = await upload();
  const base = {
    ...undatedFields(image.id),
    origin: resolved(north),
    destination: resolved(south),
  };
  const dated = {
    ...base,
    ...referenceDates,
    cargoDamagePercent: 0,
    originCompanyId,
    destinationCompanyId,
  };
  const value = { fields: dated };
  const draft = await manual.createDraft(owner, newId(), { fields: dated });
  expect(draft.fields).toEqual(dated);
  const key = newId();
  const report = await manual.submitReport(owner, key, value);

  const stored = await unit.run(async (tx) => {
    const [row] = await unit
      .client(tx)
      .select({
        fields: manualRevisions.fields,
        startedAt: manualRevisions.startedAt,
        completedAt: manualRevisions.completedAt,
        cargoDamagePercent: manualRevisions.cargoDamagePercent,
        originCompanyId: manualRevisions.originCompanyId,
        destinationCompanyId: manualRevisions.destinationCompanyId,
        content: sourcePayloads.content,
        sha256: sourceMessages.sha256,
      })
      .from(manualRevisions)
      .innerJoin(sourceMessages, eq(sourceMessages.id, manualRevisions.sourceRecordId))
      .innerJoin(sourcePayloads, eq(sourcePayloads.messageId, sourceMessages.id))
      .where(eq(manualRevisions.id, report.currentRevision.id));
    return row;
  });
  const canonicalFields = { ...base, comment: null, eventId: null };
  const canonical = canonicalJson({
    format: 2,
    reportId: report.id,
    revisionId: report.currentRevision.id,
    revision: 1,
    fields: canonicalFields,
  });
  expect(stored).toEqual({
    fields: canonicalFields,
    ...referenceDates,
    cargoDamagePercent: 0,
    originCompanyId,
    destinationCompanyId,
    content: canonical,
    sha256: createHash("sha256").update(canonical).digest(),
  });
  const [trip] = await unit.run((tx) => tripService.statesInTransaction(tx, [report.tripId]));
  expect(trip).toMatchObject({ actualStart: null, actualEnd: null, reportingAt: null });
  for (const actor of [owner, reviewer]) {
    const view = await tripService.detail(actor, report.tripId);
    expect(view).toMatchObject({ view: "private", manualRevision: { fields: dated } });
  }
  await expect(tripService.detail(other, report.tripId)).rejects.toMatchObject({ statusCode: 404 });

  await catalogs.patchDepot(staff, originDepot, newId(), { hidden: true });
  expect(await manual.submitReport(owner, key, value)).toEqual(report);
  await expect(
    manual.submitReport(owner, key, { fields: { ...dated, cargoDamagePercent: 1 } }),
  ).rejects.toMatchObject({ publicCode: "IDEMPOTENCY_CONFLICT" });
  await expect(
    manual.submitDraft(owner, draft.id, newId(), draft.version, value),
  ).rejects.toMatchObject({ statusCode: 422 });
  expect(await manual.getDraft(owner, draft.id)).toMatchObject({
    version: 1,
    state: "editing",
    fields: dated,
  });

  await catalogs.patchDepot(staff, originDepot, newId(), { hidden: false });
  await unit.run((tx) =>
    unit
      .client(tx)
      .update(catalogCompanies)
      .set({ hidden: true })
      .where(eq(catalogCompanies.id, originCompanyId)),
  );
  await expect(manual.submitReport(owner, newId(), value)).rejects.toMatchObject({
    statusCode: 422,
  });
  await unit.run(async (tx) => {
    const client = unit.client(tx);
    await client
      .update(catalogCompanies)
      .set({ hidden: false })
      .where(eq(catalogCompanies.id, originCompanyId));
    await client.update(catalogCities).set({ hidden: true }).where(eq(catalogCities.id, north));
  });
  await expect(manual.submitReport(owner, newId(), value)).rejects.toMatchObject({
    statusCode: 422,
  });
  expect(await counts()).toMatchObject({ trips: 1, reports: 1, revisions: 1, messages: 1 });

  await terminal(report);
  const company = await tripService.detail(other, report.tripId);
  expect(company.view).toBe("summary");
  expect(company).not.toHaveProperty("manualRevision");
  expect(company).not.toHaveProperty("startedAt");
});

test("all three staged routes replay predecessor undated receipts and preserve undated history", async () => {
  const image = await upload();
  const value = { fields: undatedFields(image.id) };
  const base = { ...value.fields, eventId: null, comment: null };
  const reportId = newId(),
    draftReportId = newId(),
    firstRevision = newId(),
    currentRevision = newId(),
    draftRevision = newId(),
    draftId = newId();
  const createdKey = newId(),
    revisedKey = newId(),
    submittedKey = newId();
  const timestamp = now().toISOString();
  const { beforeRevision, currentTripVersion } = await unit.run(async (tx) => {
    await identity.authorizeInTransaction(tx, owner, "trips.submit_own");
    const tripId = await tripService.reserveManualInTransaction(tx, owner.userId, "ets2");
    const draftTripId = await tripService.reserveManualInTransaction(tx, owner.userId, "ets2");
    const client = unit.client(tx);
    await client.insert(manualReports).values([
      {
        id: reportId,
        ownerId: owner.userId,
        tripId,
        version: 2,
        revisionNumber: 2,
        createdAt: timestamp,
      },
      {
        id: draftReportId,
        ownerId: owner.userId,
        tripId: draftTripId,
        version: 1,
        revisionNumber: 1,
        createdAt: timestamp,
      },
    ]);
    await client.insert(manualRevisions).values([
      {
        id: firstRevision,
        reportId,
        number: 1,
        format: "extended",
        fields: base,
        submittedAt: timestamp,
      },
      {
        id: currentRevision,
        reportId,
        number: 2,
        format: "extended",
        fields: base,
        submittedAt: timestamp,
      },
      {
        id: draftRevision,
        reportId: draftReportId,
        number: 1,
        format: "extended",
        fields: base,
        submittedAt: timestamp,
      },
    ]);
    // Seed predecessor rows with their real canonical source chain, but no reference columns.
    const tripVersion = async (id: string) => {
      const [trip] = await tripService.statesInTransaction(tx, [id]);
      if (!trip) throw Error("SYNTHETIC_MANUAL_TRIP_REQUIRED");
      return trip.version;
    };
    let priorTripVersion = 1;
    for (const [id, trip, revisionId, number, previous] of [
      [reportId, tripId, firstRevision, 1, null],
      [reportId, tripId, currentRevision, 2, firstRevision],
      [draftReportId, draftTripId, draftRevision, 1, null],
    ] as const) {
      const payload = { format: 2, reportId: id, revisionId, revision: number, fields: base };
      const context = {
        ownerUserId: owner.userId,
        connection: { state: "unknown" as const, referenceId: null },
        canonical: { tripId: trip, expectedVersion: await tripVersion(trip) },
      };
      if (previous) priorTripVersion = context.canonical.expectedVersion;
      const source = previous
        ? await tripService.supersedeManualInTransaction(tx, payload, context, previous)
        : await tripService.storeInTransaction(tx, "manual", payload, context);
      await client
        .update(manualRevisions)
        .set({ sourceRecordId: source.sourceRecordId })
        .where(eq(manualRevisions.id, revisionId));
      await client.insert(manualEvidenceReferences).values({
        evidenceId: image.id,
        revisionId,
        reportId: id,
        tripId: trip,
      });
      await tripService.manualPendingInTransaction(tx, trip);
      await tripService.manualStoredInTransaction(tx, trip, source.sourceRecordId);
    }
    for (const [id, revisionId] of [
      [reportId, currentRevision],
      [draftReportId, draftRevision],
    ] as const)
      await client
        .update(manualReports)
        .set({ currentRevisionId: revisionId })
        .where(eq(manualReports.id, id));
    await client.insert(manualDrafts).values({
      id: draftId,
      ownerId: owner.userId,
      state: "submitted",
      version: 2,
      fields: base,
      submittedReportId: draftReportId,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const currentTripVersion = await tripVersion(tripId);
    const beforeRevision = priorTripVersion;
    const receipts = [
      {
        scope: "report/create",
        key: createdKey,
        input: { fields: base, targetTrip: null },
        id: reportId,
        version: 1,
        revisionId: firstRevision,
        tripVersion: beforeRevision,
      },
      {
        scope: `report/${reportId}/revise`,
        key: revisedKey,
        input: { expected: 1, expectedTripVersion: beforeRevision, fields: base },
        id: reportId,
        version: 2,
        revisionId: currentRevision,
        tripVersion: currentTripVersion,
      },
      {
        scope: `draft/${draftId}/submit`,
        key: submittedKey,
        input: { expected: 1, fields: base },
        id: draftReportId,
        version: 1,
        revisionId: draftRevision,
        tripVersion: await tripVersion(draftTripId),
      },
    ];
    await client.insert(manualCommands).values(
      receipts.map(({ scope, key, input, ...result }) => ({
        ownerId: owner.userId,
        scope: Buffer.from(scope),
        key,
        fingerprint: createHmac("sha256", Buffer.from(manualConfig.key, "hex"))
          .update(`manual-command/v1\0${canonicalJson(input)}`)
          .digest(),
        result: { kind: "report", ...result },
        createdAt: timestamp,
      })),
    );
    return { beforeRevision, currentTripVersion };
  });

  const historyBefore = await manual.getReport(owner, reportId);
  expect(historyBefore.currentRevision.fields).toEqual(base);
  const beforeCounts = await counts();
  expect((await manual.getDraft(owner, draftId)).fields).toEqual(base);
  const app = await createApp({
    identity,
    manualReports: manual,
    checkReadiness: async () => true,
  });
  try {
    for (const [url, key, payload, status, revisionId, version] of [
      ["/api/v1/manual-reports", createdKey, value, 201, firstRevision, 1],
      [
        `/api/v1/manual-reports/${reportId}/revisions`,
        revisedKey,
        { ...value, expectedTripVersion: beforeRevision },
        200,
        currentRevision,
        2,
      ],
      [
        `/api/v1/me/manual-drafts/${draftId}/submission`,
        submittedKey,
        value,
        201,
        draftRevision,
        1,
      ],
    ] as const) {
      const response = await app.inject({
        method: "POST",
        url,
        headers: {
          cookie: ownerCookie,
          origin: identityConfig.origin,
          "x-csrf-token": csrfProtection(identityConfig).issue({}, owner).token,
          "if-match": '"v1"',
          "idempotency-key": key,
        },
        payload,
      });
      expect(response.statusCode).toBe(status);
      const { data } = response.json() as S["EnvelopeManualReport"];
      expect(data.version).toBe(version);
      expect(data.currentRevision.id).toBe(revisionId);
      expect(data.currentRevision.fields).toEqual(base);
    }
  } finally {
    await app.close();
  }
  expect(await counts()).toEqual(beforeCounts);
  const dated = await manual.reviseReport(owner, reportId, newId(), historyBefore.version, {
    expectedTripVersion: currentTripVersion,
    fields: fields(image.id),
  });
  expect(dated.currentRevision.number).toBe(3);
  expect(dated.currentRevision.fields).toMatchObject(referenceDates);
  expect(await manual.revisions(owner, reportId, {}, false, currentRevision)).toEqual(
    historyBefore.currentRevision,
  );
});

test("bodyless draft deletion enforces current session, capability, ownership, Origin, CSRF and command headers", async () => {
  const draft = await manual.createDraft(owner, newId(), { fields: {} });
  const app = await createApp({
    identity,
    manualReports: manual,
    checkReadiness: async () => true,
  });
  const csrf = csrfProtection(identityConfig);
  const headers = {
    cookie: ownerCookie,
    origin: identityConfig.origin,
    "x-csrf-token": csrf.issue({}, owner).token,
    "idempotency-key": newId(),
    "if-match": '"v1"',
  };
  const url = `/api/v1/me/manual-drafts/${draft.id}`;
  // The identity and manual reports hooks both charge the source bucket.
  const sources = new Map<number, string>();
  for (let host = 1; host <= 254; host++) {
    const source = `192.0.2.${host}`;
    const bucket = createHmac("sha256", identityConfig.secret).update(source).digest().readUInt8(0);
    sources.set(bucket, source);
  }
  const sourceBuckets = sources.values();
  function nextSource() {
    const source = sourceBuckets.next();
    if (source.done) throw Error("SYNTHETIC_RATE_LIMIT_SOURCE_REQUIRED");
    return source.value;
  }
  try {
    for (const [override, status, code, path] of [
      [{ cookie: undefined }, 401, "UNAUTHORIZED"],
      [{ origin: `${identityConfig.origin}/` }, 403, "FORBIDDEN"],
      [{ "x-csrf-token": csrf.issue({}, other).token }, 403, "FORBIDDEN"],
      [{ cookie: otherCookie, "x-csrf-token": csrf.issue({}, other).token }, 404, "NOT_FOUND"],
      [{ cookie: staffCookie, "x-csrf-token": csrf.issue({}, staff).token }, 404, "NOT_FOUND"],
      [{}, 404, "NOT_FOUND", `/api/v1/me/manual-drafts/${newId()}`],
      [{ "idempotency-key": undefined }, 422, "INVALID_PAYLOAD"],
      [{ "idempotency-key": "malformed-key" }, 422, "INVALID_PAYLOAD"],
      [{ "if-match": undefined }, 428, "PRECONDITION_REQUIRED"],
      [{ ...emptyJsonHeaders, "if-match": undefined }, 428, "PRECONDITION_REQUIRED"],
      [{ "if-match": 'W/"v1"' }, 422, "INVALID_PAYLOAD"],
      [{ "if-match": "*" }, 422, "INVALID_PAYLOAD"],
      [{ "if-match": '"v1", "v2"' }, 422, "INVALID_PAYLOAD"],
      [{ "if-match": '"v2"' }, 409, "VERSION_CONFLICT"],
      [{ "transfer-encoding": "chunked" }, 422, "INVALID_PAYLOAD"],
    ] as const) {
      const reply = await app.inject({
        method: "DELETE",
        url: path ?? url,
        remoteAddress: nextSource(),
        headers: Object.fromEntries(
          Object.entries({ ...headers, ...override }).filter(([, value]) => value !== undefined),
        ),
      });
      expect(reply.statusCode).toBe(status);
      expect(reply.headers["cache-control"]).toBe("no-store");
      expect(reply.json()).toMatchObject({ error: { code } });
    }
    const payload = await app.inject({
      method: "DELETE",
      url,
      headers,
      payload: { fields: {} },
      remoteAddress: nextSource(),
    });
    expect(payload.statusCode).toBe(422);
    expect(payload.headers["cache-control"]).toBe("no-store");
    expect(payload.json()).toMatchObject({ error: { code: "INVALID_PAYLOAD" } });
    expect(await manual.getDraft(owner, draft.id)).toMatchObject({ state: "editing", version: 1 });

    const formerSubmitter = await member();
    const own = await manual.createDraft(formerSubmitter.actor, newId(), { fields: {} });
    const key = newId();
    await manual.deleteDraft(formerSubmitter.actor, own.id, key, own.version);
    await unit.run((tx) =>
      unit.client(tx).delete(roles).where(eq(roles.userId, formerSubmitter.actor.userId)),
    );
    const lost = await app.inject({
      method: "DELETE",
      url: `/api/v1/me/manual-drafts/${own.id}`,
      remoteAddress: nextSource(),
      headers: {
        ...headers,
        cookie: formerSubmitter.cookie,
        "x-csrf-token": csrf.issue({}, formerSubmitter.actor).token,
        "idempotency-key": key,
      },
    });
    expect(lost.statusCode).toBe(403);
    expect(lost.headers["cache-control"]).toBe("no-store");
    expect(lost.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
  } finally {
    await app.close();
  }
});

test("discard retains immutable history and independent evidence holds through ordinary orphan cleanup", async () => {
  const orphan = await upload();
  const draftHeld = await upload();
  const reportHeld = await upload();
  const report = await submit(reportHeld.id);
  const value = { fields: { evidenceIds: [orphan.id, draftHeld.id, reportHeld.id] } };
  const createKey = newId();
  const draft = await manual.createDraft(owner, createKey, value);
  const replaceKey = newId();
  const replacedValue = { fields: { ...value.fields, comment: "Fictional saved draft" } };
  const replaced = await manual.replaceDraft(owner, draft.id, replaceKey, 1, replacedValue);
  instant += 30_000;
  const otherDraft = await manual.createDraft(owner, newId(), {
    fields: { evidenceIds: [draftHeld.id] },
  });
  const previousCounts = await counts();
  const beforeEvents = await unit.run((tx) =>
    unit.client(tx).select().from(outboxEvents).orderBy(outboxEvents.id),
  );
  const key = newId();
  const deleted = await manual.deleteDraft(owner, draft.id, key, replaced.version);
  expect(deleted).toEqual({ id: draft.id, version: 3 });
  expect(await manual.deleteDraft(owner, draft.id, key, replaced.version)).toEqual(deleted);
  expect(await manual.createDraft(owner, createKey, value)).toEqual(draft);
  expect(await manual.replaceDraft(owner, draft.id, replaceKey, 1, replacedValue)).toEqual(
    replaced,
  );
  await expect(
    manual.replaceDraft(owner, draft.id, newId(), 3, replacedValue),
  ).rejects.toMatchObject({ statusCode: 404 });
  await expect(
    manual.submitDraft(owner, draft.id, newId(), 3, { fields: fields(orphan.id) }),
  ).rejects.toMatchObject({ statusCode: 404 });

  await unit.run(async (tx) => {
    const client = unit.client(tx);
    const history = await client
      .select({ version: manualDraftHistory.version, snapshot: manualDraftHistory.snapshot })
      .from(manualDraftHistory)
      .where(eq(manualDraftHistory.draftId, draft.id))
      .orderBy(manualDraftHistory.version);
    expect(history).toEqual([
      { version: 1, snapshot: draft },
      { version: 2, snapshot: replaced },
      { version: 3, snapshot: { ...deleted, state: "discarded", updatedAt: now().toISOString() } },
    ]);
    const [parent] = await client.select().from(manualDrafts).where(eq(manualDrafts.id, draft.id));
    expect(parent).toMatchObject({
      id: draft.id,
      ownerId: owner.userId,
      state: "discarded",
      version: 3,
      fields: replaced.fields,
      updatedAt: now().toISOString(),
    });
    expect(
      await client.select().from(manualCommands).where(eq(manualCommands.key, key)),
    ).toHaveLength(1);
    const joins = await client
      .select({ draftId: manualDraftEvidence.draftId, evidenceId: manualDraftEvidence.evidenceId })
      .from(manualDraftEvidence);
    expect(joins).toEqual([{ draftId: otherDraft.id, evidenceId: draftHeld.id }]);
    const reportReferences = await client
      .select()
      .from(manualEvidenceReferences)
      .where(eq(manualEvidenceReferences.evidenceId, reportHeld.id));
    expect(reportReferences).toMatchObject([
      { reportId: report.id, revisionId: report.currentRevision.id },
    ]);
    expect(await client.select().from(outboxEvents).orderBy(outboxEvents.id)).toEqual(beforeEvents);
  });
  expect(await counts()).toEqual(previousCounts);
  expect((await manual.metadata(owner, orphan.id)).state).toBe("ready");
  expect(await manual.reserveExpiry(orphan.id)).toBe(false);
  instant += 30_000;
  expect(await manual.reserveExpiry(draftHeld.id)).toBe(false);
  expect(await manual.reserveExpiry(reportHeld.id)).toBe(false);
  expect(await manual.reserveExpiry(orphan.id)).toBe(true);
  await control.query(
    "UPDATE durable_jobs SET available_at=UTC_TIMESTAMP(3) WHERE kind='manual.evidence-delete'",
  );
  const queue = createQueue(unit, [manual.handler]);
  expect((await runPass(queue, new AbortController().signal)).processed).toBe(1);
  expect((await manual.metadata(owner, orphan.id)).state).toBe("expired");
  await expect(manual.content(owner, orphan.id)).rejects.toMatchObject({ statusCode: 410 });
  expect((await manual.metadata(owner, draftHeld.id)).state).toBe("ready");
  expect((await manual.metadata(owner, reportHeld.id)).state).toBe("ready");
});

async function raceDraftCommands(
  winner: (service: ManualReports) => Promise<unknown>,
  contender: (service: ManualReports) => Promise<unknown>,
) {
  const staged = deferred<number>(),
    started = deferred<number>(),
    release = deferred<void>();
  const connectionId = async (tx: Parameters<UnitOfWork["client"]>[0]) => {
    const [rows] = await unit.client(tx).execute(sql`SELECT CONNECTION_ID() AS connectionId`);
    const id = Array.isArray(rows) ? Number(rows[0]?.connectionId) : NaN;
    if (!Number.isSafeInteger(id)) throw Error("SYNTHETIC_CONNECTION_ID_REQUIRED");
    return id;
  };
  const service = (run: UnitOfWork["run"]) =>
    createManualReports(
      { ...unit, run },
      manualConfig,
      { identity, catalogs, trips: tripService, blobs },
      now,
    );
  const first = winner(
    service((fn) =>
      unit.run(async (tx) => {
        const result = await fn(tx);
        staged.resolve(await connectionId(tx));
        await bounded(release.promise, "release_draft_command", 5000);
        return result;
      }),
    ),
  );
  const second = bounded(staged.promise, "stage_draft_command", 5000).then(() =>
    contender(
      service((fn) =>
        unit.run(async (tx) => {
          const id = await connectionId(tx);
          const outcome = fn(tx);
          started.resolve(id);
          return outcome;
        }),
      ),
    ),
  );
  const settled = Promise.allSettled([first, second] as const);
  try {
    const firstId = await bounded(staged.promise, "stage_draft_command", 5000);
    const secondId = await bounded(started.promise, "start_peer_draft_command", 5000);
    expect(secondId).not.toBe(firstId);
    // The winner holds the exclusive company gate until release. Observe the contender's
    // actual locking SELECT at that gate, using only the fixture account's own connections.
    await until(async () => {
      const [rows] = await control.query<RowDataPacket[]>({
        sql: "SELECT EXISTS(SELECT 1 FROM information_schema.PROCESSLIST WHERE ID=? AND USER=SUBSTRING_INDEX(CURRENT_USER(),'@',1) AND LOCATE('from `identity_company`',LOWER(INFO))>0 AND LOCATE('for update',LOWER(INFO))>0) AS at_gate",
        values: [secondId],
        timeout: 500,
      });
      return Number(rows[0]?.at_gate) === 1;
    });
  } finally {
    release.resolve();
    await settled;
  }
  return settled;
}

test("concurrent exact deletes serialize on two connections and write one receipt and marker", async () => {
  const draft = await manual.createDraft(owner, newId(), { fields: {} });
  const key = newId();
  const remove = (service: ManualReports) =>
    service.deleteDraft({ ...owner }, draft.id, key, draft.version);
  const outcomes = await raceDraftCommands(remove, remove);
  expect(outcomes).toEqual([
    { status: "fulfilled", value: { id: draft.id, version: 2 } },
    { status: "fulfilled", value: { id: draft.id, version: 2 } },
  ]);
  await unit.run(async (tx) => {
    const client = unit.client(tx);
    expect(
      await client.select().from(manualCommands).where(eq(manualCommands.key, key)),
    ).toHaveLength(1);
    const history = await client
      .select()
      .from(manualDraftHistory)
      .where(eq(manualDraftHistory.draftId, draft.id))
      .orderBy(manualDraftHistory.version);
    expect(history.map((row) => row.version)).toEqual([1, 2]);
    expect(history[1]?.snapshot).toMatchObject({ state: "discarded", version: 2 });
  });
});

test.each(["submit", "delete"] as const)(
  "%s winning the two-connection draft race determines the only committed operation",
  async (winner) => {
    const image = await upload();
    const draft = await manual.createDraft(owner, newId(), { fields: { evidenceIds: [image.id] } });
    const submitKey = newId(),
      deleteKey = newId(),
      value = { fields: fields(image.id) };
    const submit = (service: ManualReports) =>
      service.submitDraft({ ...owner }, draft.id, submitKey, draft.version, value);
    const remove = (service: ManualReports) =>
      service.deleteDraft({ ...owner }, draft.id, deleteKey, draft.version);
    const outcomes =
      winner === "submit"
        ? await raceDraftCommands(submit, remove)
        : await raceDraftCommands(remove, submit);
    const [committed, denied] = outcomes;
    if (committed.status !== "fulfilled") throw committed.reason;
    if (winner === "submit") {
      expect(denied).toMatchObject({
        status: "rejected",
        reason: { statusCode: 409, publicCode: "VERSION_CONFLICT" },
      });
      expect(await counts()).toMatchObject({ trips: 1, reports: 1, revisions: 1, messages: 1 });
      expect(await submit(manual)).toEqual(committed.value);
      expect(await manual.getDraft(owner, draft.id)).toMatchObject({
        state: "submitted",
        version: 2,
      });
    } else {
      expect(denied).toMatchObject({ status: "rejected", reason: { statusCode: 404 } });
      expect(await counts()).toMatchObject({ trips: 0, reports: 0, revisions: 0, messages: 0 });
      expect(await remove(manual)).toEqual({ id: draft.id, version: 2 });
      await expect(manual.getDraft(owner, draft.id)).rejects.toMatchObject({ statusCode: 404 });
    }
    const losingKey = winner === "submit" ? deleteKey : submitKey;
    expect(
      await unit.run((tx) =>
        unit.client(tx).select().from(manualCommands).where(eq(manualCommands.key, losingKey)),
      ),
    ).toEqual([]);
  },
);

test("draft deletion returns a private versioned receipt and preserves version-before-state precedence", async () => {
  const image = await upload();
  const draft = await manual.createDraft(owner, newId(), { fields: {} });
  const submitted = await manual.createDraft(owner, newId(), { fields: {} });
  await manual.submitDraft(owner, submitted.id, newId(), submitted.version, {
    fields: fields(image.id),
  });
  const app = await createApp({
    identity,
    manualReports: manual,
    checkReadiness: async () => true,
  });
  const key = newId();
  async function remove(id: string, version: number, commandKey = key, typedEmpty = false) {
    const reply = await app.inject({
      method: "DELETE",
      url: `/api/v1/me/manual-drafts/${id}`,
      headers: {
        cookie: ownerCookie,
        origin: identityConfig.origin,
        "x-csrf-token": csrfProtection(identityConfig).issue({}, owner).token,
        "idempotency-key": commandKey,
        "if-match": `"v${version}"`,
        ...(typedEmpty ? emptyJsonHeaders : {}),
      },
    });
    expect(reply.headers["cache-control"]).toBe("no-store");
    expect(reply.headers.etag).toBeUndefined();
    return reply;
  }
  try {
    const stale = await remove(submitted.id, 1);
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: { code: "VERSION_CONFLICT" } });
    const state = await remove(submitted.id, 2);
    expect(state.statusCode).toBe(409);
    expect(state.json()).toMatchObject({ error: { code: "STATE_CONFLICT" } });

    const deleted = await remove(draft.id, draft.version, key, true);
    const replayed = await remove(draft.id, draft.version, key, true);
    const untypedReplay = await remove(draft.id, draft.version);
    expect(deleted.statusCode).toBe(200);
    expect(replayed.statusCode).toBe(200);
    expect(untypedReplay.statusCode).toBe(200);
    const result = deleted.json() as S["EnvelopeCommandResult"];
    const replay = replayed.json() as S["EnvelopeCommandResult"];
    expect(result.data).toEqual({ id: draft.id, version: 2 });
    expect(replay.data).toEqual(result.data);
    expect(untypedReplay.json()).toMatchObject({ data: result.data });
    expect(replay.meta.requestId).not.toBe(result.meta.requestId);
    const changed = await remove(draft.id, 2);
    expect(changed.statusCode).toBe(409);
    expect(changed.json()).toMatchObject({ error: { code: "IDEMPOTENCY_CONFLICT" } });
    const fresh = await remove(draft.id, 2, newId());
    expect(fresh.statusCode).toBe(404);
    expect(fresh.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
    const detail = await app.inject({
      url: `/api/v1/me/manual-drafts/${draft.id}`,
      headers: { cookie: ownerCookie },
    });
    expect(detail.statusCode).toBe(404);
    expect(detail.headers["cache-control"]).toBe("no-store");
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

test("recovery rejects finalized PNG bytes declared as JPEG and permits a fresh-generation retry", async () => {
  const key = newId();
  await expect(
    manual.upload(owner, key, "synthetic.jpg", bytes(), "image/jpeg"),
  ).rejects.toMatchObject({ statusCode: 422 });
  const [reserved] = await unit.run((tx) => unit.client(tx).select().from(manualEvidence));
  if (!reserved) throw Error("SYNTHETIC_UPLOAD_MISSING");
  const original = { id: reserved.id, generation: reserved.generation };
  expect(await blobs.present(original)).toBe(true);
  expect((await blobs.inspect(original))?.contentType).toBe("image/png");
  // Restore the durable boundary after finalization but before upload MIME validation.
  await unit.run((tx) =>
    unit
      .client(tx)
      .update(manualEvidence)
      .set({
        state: "processing",
        leaseToken: newId(),
        leaseUntil: "2026-10-20T00:00:00.000Z",
      })
      .where(eq(manualEvidence.id, reserved.id)),
  );
  const recovered = createManualReports(
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
  await recovered.recoverUpload(reserved.id);
  const [rejected] = await unit.run((tx) =>
    unit.client(tx).select().from(manualEvidence).where(eq(manualEvidence.id, reserved.id)),
  );
  expect(rejected).toMatchObject({
    ...original,
    state: "rejected",
    contentType: "image/jpeg",
    sha256: null,
    fingerprint: null,
    leaseToken: null,
    leaseUntil: null,
  });
  const [intent] = await unit.run((tx) =>
    unit
      .client(tx)
      .select()
      .from(manualBlobGenerations)
      .where(eq(manualBlobGenerations.generation, original.generation)),
  );
  expect(intent).toMatchObject({ evidenceId: reserved.id, state: "tracked" });
  expect(await blobs.present(original)).toBe(true);
  const retry = await recovered.upload(owner, key, "synthetic.png", bytes(), "image/png");
  expect(retry).toMatchObject({ id: reserved.id, state: "ready", contentType: "image/png" });
  const [current] = await unit.run((tx) =>
    unit.client(tx).select().from(manualEvidence).where(eq(manualEvidence.id, reserved.id)),
  );
  expect(current?.generation).not.toBe(original.generation);
  expect(await blobs.present(original)).toBe(true);
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
      fields: { ...undatedFields(image.id), eventId: null, comment: null },
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

test("workspace joins only current author revisions, including multiple reports for the same trip", async () => {
  const trip = await unit.run(async (tx) => {
    const telemetry = await tripService.storeInTransaction(
      tx,
      "ets2telemetry",
      telemetryFixture("completed"),
      {
        ownerUserId: owner.userId,
        connection: { state: "unknown", referenceId: null },
      },
    );
    const [stored] = await tripService.statesInTransaction(tx, [telemetry.tripId]);
    if (!stored) throw Error("SYNTHETIC_TELEMETRY_TRIP_REQUIRED");
    return stored;
  });
  const image = await upload();
  const original = await manual.submitReport(owner, newId(), {
    fields: fields(image.id),
    targetTrip: { tripId: trip.id, expectedVersion: trip.version },
  });
  instant += 1000;
  const revised = await manual.reviseReport(owner, original.id, newId(), original.version, {
    fields: { ...fields(image.id), actualDistanceM: "2" },
    expectedTripVersion: original.tripVersion,
  });
  instant += 1000;
  const second = await manual.submitReport(owner, newId(), {
    fields: fields(image.id),
    targetTrip: { tripId: trip.id, expectedVersion: revised.tripVersion },
  });
  const foreignImage = await manual.upload(other, newId(), "synthetic.png", bytes(), "image/png");
  const foreign = await manual.submitReport(other, newId(), { fields: fields(foreignImage.id) });
  expect(second.tripId).toBe(original.tripId);
  expect(revised.currentRevision.submittedAt).not.toBe(original.createdAt);

  await unit.run(async (tx) => {
    await identity.authorizeInTransaction(tx, owner, "trips.read_own_private");
    const db = unit.client(tx);
    const relation = manual.workspaceCurrentAuthorRevisionsRelation(tx, owner.userId);
    const read = () =>
      db
        .select({
          tripId: trips.id,
          reportTripId: relation.reportTripId,
          reportId: relation.reportId,
          revisionId: relation.revisionId,
          reportCreatedAt: relation.reportCreatedAt,
          revisionNumber: manualRevisions.number,
        })
        .from(trips)
        .leftJoin(relation, eq(relation.reportTripId, trips.id))
        .leftJoin(manualRevisions, eq(manualRevisions.id, relation.revisionId))
        .orderBy(relation.reportCreatedAt, relation.reportId);
    const unmatched = {
      tripId: foreign.tripId,
      reportTripId: null,
      reportId: null,
      revisionId: null,
      reportCreatedAt: null,
      revisionNumber: null,
    };
    const own = [
      {
        tripId: original.tripId,
        reportTripId: original.tripId,
        reportId: original.id,
        revisionId: revised.currentRevision.id,
        reportCreatedAt: original.createdAt,
        revisionNumber: revised.currentRevision.number,
      },
      {
        tripId: second.tripId,
        reportTripId: second.tripId,
        reportId: second.id,
        revisionId: second.currentRevision.id,
        reportCreatedAt: second.createdAt,
        revisionNumber: second.currentRevision.number,
      },
    ];
    expect(await read()).toEqual([unmatched, ...own]);
    await db
      .update(manualReports)
      .set({ currentRevisionId: null })
      .where(eq(manualReports.id, original.id));
    expect(await read()).toEqual([unmatched, own[1]]);
    await db
      .update(manualReports)
      .set({ currentRevisionId: revised.currentRevision.id })
      .where(eq(manualReports.id, original.id));
    expect(await read()).toEqual([unmatched, ...own]);
  });
});

test("draft list pages editing and submitted states with owner-bound cursors and an unpaged editing count", async () => {
  expect(await manual.listDrafts(owner, { state: "editing" })).toEqual({
    items: [],
    nextCursor: null,
    editingCount: 0,
  });
  const image = await upload();
  const add = (actor = owner) => manual.createDraft(actor, newId(), { fields: {} });
  const first = await add(),
    second = await add(),
    sent = await add(),
    discarded = await add();
  await add(other);
  instant++;
  const latest = await add();
  instant++;
  const edited = await manual.replaceDraft(owner, first.id, newId(), first.version, { fields: {} });
  await manual.submitDraft(owner, sent.id, newId(), sent.version, { fields: fields(image.id) });
  await manual.deleteDraft(owner, discarded.id, newId(), discarded.version);

  const earlier = [edited, second].sort((left, right) => right.id.localeCompare(left.id));
  const workspace = await unit.run(async (tx) => {
    await identity.authorizeInTransaction(tx, owner, "trips.submit_own");
    return manual.workspaceEditingDraftsInTransaction(tx, owner.userId);
  });
  expect(workspace).toEqual({
    count: 3,
    items: [latest, ...earlier].map(({ id, updatedAt }) => ({ draftId: id, updatedAt })),
  });

  const list = "/api/v1/me/manual-drafts";
  const app = await createApp({
    identity,
    manualReports: manual,
    checkReadiness: async () => true,
  });
  async function page(query: string, cookie = ownerCookie) {
    const reply = await app.inject({ url: `${list}?${query}`, headers: { cookie } });
    expect(reply.headers["cache-control"]).toBe("no-store");
    return reply;
  }
  function read(reply: Awaited<ReturnType<typeof page>>) {
    expect(reply.statusCode).toBe(200);
    return (reply.json() as S["EnvelopeListManualDraft"]).data;
  }
  try {
    const all = read(await page("limit=1"));
    const editing = read(await page("limit=1&state=editing"));
    expect(all.items.map(({ id }) => id)).toEqual([latest.id]);
    expect(editing.items.map(({ id }) => id)).toEqual([latest.id]);
    expect(all.editingCount).toBe(3);
    expect(editing.editingCount).toBe(3);
    expect(all.nextCursor).toEqual(expect.any(String));
    expect(editing.nextCursor).toEqual(expect.any(String));
    const allCursor = encodeURIComponent(all.nextCursor ?? "");
    const editingCursor = encodeURIComponent(editing.nextCursor ?? "");
    const remaining = read(await page(`cursor=${allCursor}`));
    expect(remaining.items.map(({ id }) => id)).toEqual(
      [first.id, second.id, sent.id].sort().reverse(),
    );
    expect(remaining.items.find(({ id }) => id === sent.id)?.state).toBe("submitted");
    expect(remaining.editingCount).toBe(3);
    expect(remaining.nextCursor).toBeNull();
    const filtered = read(await page(`state=editing&cursor=${editingCursor}`));
    expect(filtered.items.map(({ id }) => id)).toEqual([first.id, second.id].sort().reverse());
    expect(filtered.items.every((draft) => draft.state === "editing")).toBe(true);
    expect(filtered.editingCount).toBe(3);
    expect(filtered.nextCursor).toBeNull();

    for (const [query, cookie] of [
      [`state=editing&cursor=${allCursor}`, ownerCookie],
      [`cursor=${editingCursor}`, ownerCookie],
      [`state=editing&cursor=${editingCursor}`, otherCookie],
    ] as const) {
      const incompatible = await page(query, cookie);
      expect(incompatible.statusCode).toBe(409);
      expect(incompatible.json()).toMatchObject({ error: { code: "VERSION_CONFLICT" } });
    }
    expect((await page("state=submitted")).statusCode).toBe(422);
    expect((await page("state=editing&limit=101")).statusCode).toBe(422);
    const anotherList = await app.inject({
      url: "/api/v1/me/manual-reports?state=editing",
      headers: { cookie: ownerCookie },
    });
    expect(anotherList.statusCode).toBe(422);
    expect(read(await page("state=editing", otherCookie)).editingCount).toBe(1);
  } finally {
    await app.close();
  }
});

test("draft labels follow current member locale and only matching catalog game and kind", async () => {
  const catalog = await seedCatalog(unit, "ets2", {
    cities: [
      {
        code: "draft-native-city",
        nameEn: "Fictional North",
        nameRu: "Северный город",
        hidden: true,
      },
      { code: "draft-english-city", nameEn: "Fictional South" },
    ],
  });
  const wrongGame = await seedCatalog(unit, "ats", { cities: ["draft-foreign-city"] });
  const north = catalog.id("draft-native-city"),
    south = catalog.id("draft-english-city");
  await unit.run(async (tx) => {
    const client = unit.client(tx);
    await client
      .update(catalogCities)
      .set({ nameNative: "Fictional native North" })
      .where(eq(catalogCities.id, north));
    // Cross-table ID reuse must not shadow a different kind's label.
    await client.insert(catalogCargoes).values({
      id: north,
      game: "ets2",
      code: Buffer.from("draft-cargo"),
      nameEn: "Fictional cargo",
      nameRu: "Вымышленный груз",
    });
  });
  const resolved = (entityId: string) => ({ status: "resolved" as const, entityId });
  const draft = await manual.createDraft(owner, newId(), {
    fields: {
      game: "ets2",
      origin: resolved(north),
      destination: resolved(south),
      cargo: resolved(north),
    },
  });
  const invalid = await manual.createDraft(owner, newId(), {
    fields: {
      game: "ets2",
      origin: resolved(wrongGame.id("draft-foreign-city")),
      destination: resolved(newId()),
      cargo: resolved(south),
    },
  });
  const partial = await manual.createDraft(owner, newId(), {
    fields: { origin: resolved(north), destination: fields(newId()).destination },
  });
  const emptyLabels = { origin: null, destination: null, cargo: null };
  expect(draft).not.toHaveProperty("labels");
  const russian = await manual.getDraft(owner, draft.id);
  expect(russian.fields).toEqual(draft.fields);
  expect(russian.labels).toEqual({
    origin: {
      entityId: north,
      label: "Северный город",
      nameNative: "Fictional native North",
      requestedLocale: "ru",
      renderedLocale: "ru",
      englishFallback: false,
      hidden: true,
    },
    destination: {
      entityId: south,
      label: "Fictional South",
      requestedLocale: "ru",
      renderedLocale: "en",
      englishFallback: true,
      hidden: false,
    },
    cargo: {
      entityId: north,
      label: "Вымышленный груз",
      requestedLocale: "ru",
      renderedLocale: "ru",
      englishFallback: false,
      hidden: false,
    },
  });
  expect((await manual.getDraft(owner, invalid.id)).labels).toEqual(emptyLabels);
  expect((await manual.getDraft(owner, partial.id)).labels).toEqual({
    ...emptyLabels,
    origin: russian.labels?.origin,
  });
  const setLocale = (locale: "ru" | "en") =>
    unit.run((tx) =>
      unit.client(tx).update(membership).set({ locale }).where(eq(membership.userId, owner.userId)),
    );
  const app = await createApp({
    identity,
    manualReports: manual,
    checkReadiness: async () => true,
  });
  try {
    await setLocale("en");
    const headers = { cookie: ownerCookie, "accept-language": "ru" };
    const detail = await app.inject({ url: `/api/v1/me/manual-drafts/${draft.id}`, headers });
    const list = await app.inject({ url: "/api/v1/me/manual-drafts?state=editing", headers });
    expect(detail.statusCode).toBe(200);
    expect(detail.headers.etag).toBe('"v1"');
    expect(list.statusCode).toBe(200);
    const current = (detail.json() as S["EnvelopeManualDraft"]).data;
    expect(current.fields).toEqual(draft.fields);
    expect(current.labels).toMatchObject({
      origin: {
        label: "Fictional North",
        nameNative: "Fictional native North",
        requestedLocale: "en",
        renderedLocale: "en",
        englishFallback: false,
        hidden: true,
      },
      destination: { label: "Fictional South", englishFallback: false },
      cargo: { label: "Fictional cargo", englishFallback: false },
    });
    const { items } = (list.json() as S["EnvelopeListManualDraft"]).data;
    expect(items.find(({ id }) => id === draft.id)).toEqual(current);
    expect(items.find(({ id }) => id === invalid.id)?.labels).toEqual(emptyLabels);
    expect(items.find(({ id }) => id === partial.id)?.labels).toEqual({
      ...emptyLabels,
      origin: current.labels?.origin,
    });
  } finally {
    await setLocale("ru");
    await app.close();
  }
});

test("draft list trims the keyset sentinel before bounded catalog lookups and supports indexed owner/state queries", async () => {
  const catalog = await seedCatalog(unit, "ets2", {
    cities: ["draft-batch-city"],
    cargoes: ["draft-batch-cargo"],
  });
  const city = { status: "resolved" as const, entityId: catalog.id("draft-batch-city") },
    cargo = { status: "resolved" as const, entityId: catalog.id("draft-batch-cargo") };
  const draftFields = { game: "ets2", origin: city, destination: city, cargo };
  const timestamp = now().toISOString();
  const rows = (length: number, ownerId: string, state: "editing" | "discarded") =>
    Array.from({ length }, () => ({
      id: newId(),
      ownerId,
      state,
      version: state === "editing" ? 1 : 2,
      fields: draftFields,
      createdAt: timestamp,
      updatedAt: timestamp,
    }));
  const editing = rows(101, owner.userId, "editing");
  const newestIds = editing
    .map(({ id }) => id)
    .sort()
    .reverse();
  await unit.run(async (tx) => {
    await identity.authorizeInTransaction(tx, owner, "trips.submit_own");
    await unit
      .client(tx)
      .insert(manualDrafts)
      .values([
        ...editing,
        ...rows(300, owner.userId, "discarded"),
        ...rows(200, other.userId, "editing"),
      ]);
    // These rows are still uncommitted and visible to the caller's transaction.
    expect(await manual.workspaceEditingDraftsInTransaction(tx, owner.userId)).toEqual({
      count: 101,
      items: newestIds.slice(0, 5).map((draftId) => ({ draftId, updatedAt: timestamp })),
    });
  });

  const labelBatchSizes: number[] = [];
  const measured = createManualReports(
    unit,
    manualConfig,
    {
      identity,
      trips: tripService,
      blobs,
      catalogs: {
        ...catalogs,
        labelsInTransaction(tx, refs, locale) {
          labelBatchSizes.push(refs.length);
          return catalogs.labelsInTransaction(tx, refs, locale);
        },
      },
    },
    now,
  );
  const defaultPage = await manual.listDrafts(owner);
  expect(defaultPage.items).toHaveLength(25);
  expect(defaultPage.editingCount).toBe(101);

  const first = await measured.listDrafts(owner, { state: "editing", limit: 100 });
  expect(first.items).toHaveLength(100);
  expect(first.editingCount).toBe(101);
  expect(labelBatchSizes).toEqual([200, 100]);
  expect(
    first.items.every(
      ({ labels }) =>
        labels?.origin?.entityId === city.entityId && labels.cargo?.entityId === cargo.entityId,
    ),
  ).toBe(true);
  if (!first.nextCursor) throw Error("SYNTHETIC_DRAFT_CURSOR_REQUIRED");
  const last = await measured.listDrafts(owner, {
    state: "editing",
    limit: 100,
    cursor: first.nextCursor,
  });
  expect(last.nextCursor).toBeNull();
  expect(last.editingCount).toBe(101);
  expect(labelBatchSizes).toEqual([200, 100, 2, 1]);
  expect([...first.items, ...last.items].map(({ id }) => id)).toEqual(newestIds);

  await control.query("ANALYZE TABLE manual_drafts");
  const plans = [
    [
      "unfiltered",
      "SELECT * FROM manual_drafts WHERE owner_id=? AND state IN ('editing','submitted') ORDER BY created_at DESC,id DESC LIMIT 26",
      "manual_draft_owner_page",
    ],
    [
      "editing",
      "SELECT * FROM manual_drafts WHERE owner_id=? AND state='editing' ORDER BY created_at DESC,id DESC LIMIT 26",
      "manual_draft_owner_state_page",
    ],
    [
      "editing_count",
      "SELECT COUNT(*) FROM manual_drafts WHERE owner_id=? AND state='editing'",
      "manual_draft_owner_state_page",
    ],
  ] as const;
  for (const [shape, statement, expectedIndex] of plans) {
    const [rows] = await control.query<RowDataPacket[]>(`EXPLAIN ${statement}`, [
      Buffer.from(owner.userId, "ascii"),
    ]);
    const [plan] = rows;
    expect(String(plan?.possible_keys).split(",")).toContain(expectedIndex);
    console.log(
      JSON.stringify({
        event: "manual_query_plan",
        shape,
        index: plan?.key,
        access: plan?.type,
        estimatedRows: Number(plan?.rows),
        extra: plan?.Extra,
      }),
    );
  }
});

test("resolved selections take same-game list rows, hidden rows stay only when unchanged and the legacy route stays readable", async () => {
  const rows = await seedCatalog(unit, "ets2", {
    cities: [
      { code: "manual-north", nameEn: "Fictional manual north" },
      { code: "manual-south", nameEn: "Fictional manual south" },
      { code: "manual-hidden-city", hidden: true },
    ],
    cargoes: [{ code: "manual-gas", adrClass: "2" }],
    trailers: ["manual-box"],
  });
  const atsRows = await seedCatalog(unit, "ats", { cities: ["manual-ats-city"] });
  const resolved = (entityId: string) => ({ status: "resolved" as const, entityId });
  const north = rows.id("manual-north"),
    south = rows.id("manual-south"),
    cargo = rows.id("manual-gas"),
    trailer = rows.id("manual-box"),
    hidden = rows.id("manual-hidden-city"),
    image = await upload();
  const listed: S["ManualDatedSubmissionFields"] = {
    ...fields(image.id),
    origin: resolved(north),
    destination: resolved(south),
    cargo: resolved(cargo),
    trailerType: resolved(trailer),
    cargoMassKg: "1000",
    actualDistanceM: "100",
  };
  for (const invalid of [
    { ...listed, origin: resolved(atsRows.id("manual-ats-city")) },
    { ...listed, origin: resolved(cargo) },
    { ...listed, origin: resolved(newId()) },
    { ...listed, cargo: resolved(north) },
    { ...listed, trailerType: resolved(cargo) },
  ])
    await expect(manual.submitReport(owner, newId(), { fields: invalid })).rejects.toMatchObject({
      statusCode: 422,
    });
  await expect(
    manual.submitReport(owner, newId(), { fields: { ...listed, origin: resolved(hidden) } }),
  ).rejects.toMatchObject({ statusCode: 422, publicCode: "CATALOG_SELECTION_HIDDEN" });

  const report = await manual.submitReport(owner, newId(), { fields: listed });
  const [fact] = await unit.run((tx) =>
    unit.client(tx).select().from(tripFacts).where(eq(tripFacts.canonicalTripId, report.tripId)),
  );
  if (!fact) throw Error("SYNTHETIC_FACT_REQUIRED");
  expect(fact).toMatchObject({
    originCityId: north,
    destinationCityId: south,
    cargoId: cargo,
    adrClass: "2",
    trailerCount: 1,
  });
  const trailers = await unit.run((tx) =>
    unit.client(tx).select().from(tripFactTrailers).where(eq(tripFactTrailers.tripFactId, fact.id)),
  );
  expect(trailers.map((row) => [row.position, row.trailerId])).toEqual([[0, trailer]]);

  // A later hide leaves unchanged selections valid; a new hidden choice is refused.
  await unit.run((tx) =>
    unit.client(tx).update(catalogCities).set({ hidden: true }).where(eq(catalogCities.id, north)),
  );
  const kept = await manual.reviseReport(owner, report.id, newId(), report.version, {
    fields: { ...listed, actualDistanceM: "150" },
    expectedTripVersion: report.tripVersion,
  });
  expect(kept.currentRevision.number).toBe(2);
  await expect(
    manual.reviseReport(owner, report.id, newId(), kept.version, {
      fields: { ...listed, origin: resolved(hidden), actualDistanceM: "175" },
      expectedTripVersion: kept.tripVersion,
    }),
  ).rejects.toMatchObject({ publicCode: "CATALOG_SELECTION_HIDDEN" });

  // The legacy route keeps its ids; validation is the same.
  await unit.run((tx) =>
    unit.client(tx).update(catalogCities).set({ hidden: false }).where(eq(catalogCities.id, north)),
  );
  const legacyInput: S["ManualResolvedInput"] = {
    game: "ets2",
    originCityId: north,
    destinationCityId: south,
    cargoId: cargo,
    trailerTypeId: trailer,
    cargoMassKg: "2000",
    actualDistanceM: "200",
    evidenceIds: [image.id],
  };
  const legacyKey = newId(),
    legacy = await manual.legacySubmit(owner, legacyKey, legacyInput);
  expect(legacy.manualRevision).toHaveProperty("fields.originCityId", north);
  expect((await manual.legacySubmit(owner, legacyKey, legacyInput)).summary).toEqual(
    legacy.summary,
  );
  await expect(
    manual.legacySubmit(owner, newId(), { ...legacyInput, originCityId: cargo }),
  ).rejects.toMatchObject({ statusCode: 422 });
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

test("built listening upload deadline closes incomplete first part headers and settles the handler before a valid upload", async () => {
  const { createApp: builtApp }: { createApp: typeof createApp } = await import(
    pathToFileURL(resolve("apps/api/dist/app.js")).href
  );
  const { createManualReports: builtManual }: { createManualReports: typeof createManualReports } =
    await import(pathToFileURL(resolve("apps/api/dist/modules/manual-reports/service.js")).href);
  const module = builtManual(unit, manualConfig, { identity, catalogs, trips: tripService }, now);
  let uploads = 0;
  const observed: ManualReports = {
    ...module,
    upload(...args) {
      uploads++;
      return module.upload(...args);
    },
  };
  const app = await builtApp({
    identity,
    manualReports: observed,
    trips: tripService,
    checkReadiness: async () => true,
  });
  const stallKey = newId(),
    closed = deferred<void>(),
    settled = deferred<void>(),
    clients = new Set<ReturnType<typeof request>>();
  let serverStarted: number | undefined,
    elapsed: number | undefined,
    handlerStatus: number | undefined,
    handlerCode: unknown,
    serverDestroyed = false,
    watchdogFired = false,
    clientClosed = false,
    bytesSent = 0;
  let drip: ReturnType<typeof setInterval> | undefined,
    watchdog: ReturnType<typeof setTimeout> | undefined;
  app.addHook("preHandler", async (r) => {
    if (r.headers["idempotency-key"] === stallKey) serverStarted = performance.now();
  });
  app.addHook("onError", async (r, _reply, error) => {
    if (r.headers["idempotency-key"] !== stallKey) return;
    handlerStatus = error.statusCode;
    handlerCode = "publicCode" in error ? error.publicCode : undefined;
    serverDestroyed = r.raw.destroyed;
    elapsed = serverStarted === undefined ? undefined : performance.now() - serverStarted;
    settled.resolve();
  });
  try {
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
      return new Promise<{ status: number; body: Buffer }>((accept, reject) => {
        const req = request({ host: "127.0.0.1", port, path, method, headers }, (res) => {
          const body: Buffer[] = [];
          res.on("data", (chunk) => body.push(chunk));
          res.on("end", () => accept({ status: res.statusCode ?? 0, body: Buffer.concat(body) }));
        });
        clients.add(req);
        req.setTimeout(5000, () => req.destroy(new Error("SYNTHETIC_HTTP_DEADLINE")));
        req.on("error", () => reject(new Error("SYNTHETIC_HTTP_FAILURE")));
        for (const chunk of chunks) req.write(chunk);
        req.end();
      });
    }
    const csrf = JSON.parse(
      (await http("/api/v1/auth/csrf", "GET", { cookie: ownerCookie })).body.toString(),
    ).data.token as string;
    const boundary = "synthetic-incomplete-first-part",
      headers = {
        cookie: ownerCookie,
        origin: identityConfig.origin,
        "x-csrf-token": csrf,
        "idempotency-key": stallKey,
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "transfer-encoding": "chunked",
      },
      filesBefore = (await readdir(root)).sort();
    const stalled = request({
      host: "127.0.0.1",
      port,
      path: "/api/v1/evidence",
      method: "POST",
      headers,
    });
    clients.add(stalled);
    stalled.on("error", () => {});
    stalled.on("response", (res) => res.resume());
    stalled.once("close", () => {
      clientClosed = true;
      clearInterval(drip);
      closed.resolve();
    });
    const deadline = new Promise<never>((_, reject) => {
      watchdog = setTimeout(() => {
        watchdogFired = true;
        reject(new Error("SYNTHETIC_FIRST_PART_WATCHDOG"));
      }, 7000);
    });
    // Deliberately omit the header terminator and never end the chunked body.
    const firstHeader = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="synthetic.png"\r\nContent-Type: image/png`,
    );
    stalled.flushHeaders();
    stalled.write(firstHeader);
    bytesSent += firstHeader.length;
    drip = setInterval(() => {
      if (!stalled.destroyed) {
        stalled.write("a");
        bytesSent++;
      }
    }, 100);
    await Promise.race([Promise.all([closed.promise, settled.promise]), deadline]);
    clearTimeout(watchdog);
    expect(watchdogFired).toBe(false);
    expect(clientClosed).toBe(true);
    expect(serverDestroyed).toBe(true);
    expect(handlerStatus).toBe(503);
    expect(handlerCode).toBe("DEPENDENCY_UNAVAILABLE");
    // Allow timer clock granularity without changing the configured allowance.
    expect(elapsed).toBeGreaterThanOrEqual(manualConfig.storage.timeoutMs - 10);
    expect(elapsed).toBeLessThan(7000);
    expect(bytesSent).toBeLessThan(manualConfig.storage.maxFileBytes);
    expect(bytesSent).toBeGreaterThan(firstHeader.length);
    expect(uploads).toBe(0);
    for (const table of ["manual_evidence", "manual_commands", "manual_blob_generations"]) {
      const [rows] = await control.query<RowDataPacket[]>(`SELECT COUNT(*) n FROM ${table}`);
      expect(Number(rows[0]?.n)).toBe(0);
    }
    expect((await readdir(root)).sort()).toEqual(filesBefore);
    console.info(
      JSON.stringify({
        event: "manual_first_part_deadline",
        elapsedMs: Math.round(elapsed ?? 0),
        clientClosed,
        handlerSettled: true,
        watchdogFired,
        uploads,
        bytesSent,
      }),
    );
    const valid = await http(
      "/api/v1/evidence",
      "POST",
      { ...headers, "idempotency-key": newId() },
      [
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="synthetic.png"\r\nContent-Type: image/png\r\n\r\n`,
        ),
        pngBytes(),
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ],
    );
    expect(valid.status).toBe(202);
    expect(uploads).toBe(1);
    const image = JSON.parse(valid.body.toString()).data as S["Evidence"];
    const download = await http(`/api/v1/evidence/${image.id}/content`, "GET", {
      cookie: ownerCookie,
    });
    expect(download.status).toBe(200);
    expect(download.body).toEqual(pngBytes());
    expect(
      (await http(`/api/v1/evidence/${image.id}/content`, "GET", { cookie: otherCookie })).status,
    ).toBe(404);
    expect(
      (await http(`/api/v1/evidence/${image.id}/content`, "GET", { cookie: staffCookie })).status,
    ).toBe(404);
  } finally {
    clearInterval(drip);
    clearTimeout(watchdog);
    for (const client of clients) client.destroy();
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

async function generationWorker(caseId: GenerationCase, ordinal: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const started = performance.now();
  const db = guardedSettings();
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "test/support/manual-generation-worker.ts",
      root,
      ...generationTransactionArguments(caseId, ordinal),
    ],
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
  const completion = childClose(child);
  let lastTransaction: Record<string, unknown> | undefined;
  let receipt: { event: string; processed: number; pid: number } | undefined;
  let malformed = false,
    closed = false,
    timerFired = false,
    caseAborted = false,
    spawnFailed = false;
  let exitCode: number | null = null;
  let exitSignal: string | null = null;
  let firstStop: "none" | "child_deadline" | "case_abort" = "none";
  const emit = (state: "exit" | "close" | "spawn_error") =>
    console.log(
      generationProcessLine({
        event: "manual_generation_process",
        caseId,
        ordinal,
        state,
        durationMs: Math.round(performance.now() - started),
        exitCode,
        signal:
          exitSignal === null || ["SIGKILL", "SIGTERM", "SIGINT"].includes(exitSignal)
            ? exitSignal
            : "other",
        timerFired,
        caseAborted,
        spawnFailed,
        firstStop,
        receiptState: receipt ? "valid" : !closed ? "pending" : malformed ? "malformed" : "missing",
        ...(lastTransaction ? { lastTransaction } : {}),
      }),
    );
  const removeStreamListeners: (() => void)[] = [];
  for (const [stream, stdout] of [
    [child.stdout, true],
    [child.stderr, false],
  ] as const) {
    let pending = "",
      oversized = false;
    const line = (value: string) => {
      const record = parseGenerationWorkerLine(value);
      if (stdout && record?.event === "manual_generation_worker") {
        // This validated private PID stays in memory for the original distinct-process proof.
        if (receipt) malformed = true;
        else receipt = JSON.parse(value) as typeof receipt;
      } else if (record?.event === "manual_generation_worker_phase") {
        console.log(
          generationProcessLine({ ...record, event: "manual_generation_phase", caseId, ordinal }),
        );
      } else if (record?.event === "identity_fixture_transaction") {
        const { event: _event, fixture: _fixture, caseId: _scope, step, ...facts } = record;
        const line = generationProcessLine({
          ...facts,
          event: "manual_generation_transaction",
          phase: step,
          caseId,
          ordinal,
        });
        lastTransaction = JSON.parse(line) as Record<string, unknown>;
        console.log(line);
      } else if (stdout && value.trim()) malformed = true;
    };
    const onData = (chunk: Buffer | string) => {
      for (const part of String(chunk).split(/(\n)/)) {
        if (part === "\n") {
          if (!oversized) line(pending);
          else if (stdout) malformed = true;
          pending = "";
          oversized = false;
        } else if (!oversized) {
          pending += part;
          if (pending.length > 4000) {
            pending = "";
            oversized = true;
            if (stdout) malformed = true;
          }
        }
      }
    };
    const onEnd = () => {
      if (pending && !oversized) line(pending);
    };
    stream.on("data", onData);
    stream.once("end", onEnd);
    removeStreamListeners.push(() => {
      stream.off("data", onData);
      stream.off("end", onEnd);
    });
  }
  const stop = (reason: "child_deadline" | "case_abort") => {
    // This records a local kill attempt, independently of the native exit code/signal.
    if (firstStop === "none") firstStop = reason;
    child.kill("SIGKILL");
  };
  const timer = setTimeout(() => {
    timerFired = true;
    stop("child_deadline");
  }, 5000);
  const abort = () => {
    caseAborted = true;
    stop("case_abort");
  };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  child.once("close", (code, signal) => {
    closed = true;
    exitCode = code;
    exitSignal = signal;
    emit("close");
  });
  const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
    exitCode = code;
    exitSignal = signal;
    emit("exit");
  };
  const onError = () => {
    spawnFailed = true;
    emit("spawn_error");
  };
  child.once("exit", onExit);
  child.once("error", onError);
  const outcome = await completion.finally(() => {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    child.off("exit", onExit);
    child.off("error", onError);
    for (const remove of removeStreamListeners) remove();
  });
  if (outcome.spawnFailed) throw Error("SYNTHETIC_GENERATION_WORKER_START_FAILED");
  expect(outcome.streamFailed).toBe(false);
  expect(outcome.code).toBe(0);
  expect(malformed).toBe(false);
  const last = receipt ?? { event: undefined };
  expect(last.event).toBe("manual_generation_worker");
  console.log(
    generationProcessLine({
      event: "manual_generation_process_duration",
      caseId,
      ordinal,
      durationMs: Math.round(performance.now() - started),
      processed: receipt?.processed,
    }),
  );
  return last as { processed: number; pid: number };
}
it("durable generation intent makes bounded progress beyond100 protected current files across fresh worker processes", async () => {
  // Five unchanged 5-second workers plus the ordinary 15-second fixture allowance
  // compose a 40-second engineering guard; abort 5 seconds earlier for settlement.
  const signal = AbortSignal.timeout(35000),
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
  for (let pass = 0; pass < 5; pass++)
    workers.push(await generationWorker("generation_progress", pass, signal));
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
}, 40000);
it("missing generation observations survive late actual finalization and reconcile in a fresh worker", async () => {
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
  expect((await generationWorker("generation_late", 0)).processed).toBe(0);
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
  expect((await generationWorker("generation_late", 1)).processed).toBe(1);
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

it("generation cleanup retries a failed file effect durably and recovers an exhausted job in a fresh worker", async () => {
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
  expect((await generationWorker("generation_retry", 0)).processed).toBe(1);
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
    { cursorKey: randomBytes(32).toString("hex") },
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

async function ownedJobsCli(environment: NodeJS.ProcessEnv, deadline: number, ordinal: 1 | 2) {
  const observation = manualJobsObservation(ordinal, deadline);
  if (performance.now() >= deadline) throw Error("SYNTHETIC_JOBS_FIXTURE_DEADLINE");
  const child = spawn(process.execPath, ["apps/api/dist/jobs.js", "run"], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...safeChildEnvironment(), ...environment },
  });
  let closed = false,
    timedOut = false,
    spawnFailed = false,
    streamFailed = false,
    storageFailure = false;
  let exitCode: number | null = null;
  let result: { manualCleanup: string; processed: number } | undefined;
  const emit = (state: Parameters<typeof observation.line>[0]) => {
    try {
      console.log(
        observation.line(state, { closed, timedOut, spawnFailed, streamFailed, exitCode }),
      );
    } catch {
      /* Preserve the original process outcome when diagnostics fail. */
    }
  };
  emit("spawn");
  const completion = new Promise<void>((accept) => {
    child.once("close", (code) => {
      closed = true;
      exitCode = code;
      emit("close");
      accept();
    });
  });
  child.once("error", () => {
    spawnFailed = true;
    emit("spawn_error");
  });
  const stop = () => {
    if (!closed && child.pid !== undefined) child.kill("SIGTERM");
  };
  // Fail this fixture, then let the unchanged CLI supervisor drain/kill its own worker.
  const watchdog = setTimeout(
    () => {
      timedOut = true;
      emit("deadline");
      stop();
    },
    Math.max(1, deadline - performance.now()),
  );
  for (const stream of [child.stdout, child.stderr]) {
    stream.once("error", () => {
      streamFailed = true;
      emit("stream_error");
      stop();
    });
    let line = "",
      oversized = false;
    stream.on("data", (chunk) => {
      for (const part of String(chunk).split(/(\n)/)) {
        if (part === "\n") {
          if (!oversized) {
            try {
              const value = JSON.parse(line);
              observation.accept(value);
              if (
                value.event === "manual_cleanup_failed" &&
                value.category === "storage_unavailable"
              )
                storageFailure = true;
              if (
                value.event === "jobs_result" &&
                ["complete", "configuration_pending", "storage_unavailable"].includes(
                  value.manualCleanup,
                ) &&
                Number.isSafeInteger(value.processed) &&
                value.processed >= 0
              )
                result = { manualCleanup: value.manualCleanup, processed: value.processed };
            } catch {
              /* Raw child diagnostics are deliberately discarded. */
            }
          }
          line = "";
          oversized = false;
        } else if (!oversized) {
          if (line.length + part.length > 4000) {
            line = "";
            oversized = true;
          } else line += part;
        }
      }
    });
  }
  try {
    await completion;
    expect(timedOut).toBe(false);
    expect(spawnFailed).toBe(false);
    expect(streamFailed).toBe(false);
    return { exitCode, storageFailure, result };
  } catch (error) {
    emit("failure");
    throw error;
  } finally {
    clearTimeout(watchdog);
    if (!closed) {
      stop();
      await completion;
    }
  }
}

it("unavailable due manual storage reports failure while real local mail completes once, then recovers", async () => {
  const deadline = performance.now() + 7000;
  const ownedRoot = resolve(root, "jobs-storage-outage"),
    heldRoot = resolve(root, "jobs-storage-outage.offline");
  expect(
    ownedRoot.startsWith(resolve(root) + sep) && heldRoot.startsWith(resolve(root) + sep),
  ).toBe(true);
  await mkdir(ownedRoot, { mode: 0o700 });
  const owned = await lstat(ownedRoot);
  const verifyRoot = async (path: string) => {
    expect([ownedRoot, heldRoot]).toContain(path);
    const stat = await lstat(path);
    expect(stat.isDirectory() && !stat.isSymbolicLink()).toBe(true);
    expect([stat.dev, stat.ino]).toEqual([owned.dev, owned.ino]);
  };
  let displaced = false;
  try {
    const mailKey = randomBytes(32).toString("hex"),
      catalogKey = randomBytes(32).toString("hex"),
      tripKey = randomBytes(32).toString("hex");
    const config = {
      ...manualConfig,
      key: randomBytes(32).toString("hex"),
      storage: { ...manualConfig.storage, root: ownedRoot },
    };
    const composed = composeIdentity(
      unit,
      identityConfig,
      {
        mode: "local",
        key: mailKey,
        sender: "synthetic@example.invalid",
        origin: identityConfig.origin,
        production: false,
      },
      undefined,
      false,
      { cursorKey: catalogKey },
      { cursorKey: tripKey },
      undefined,
      config,
    );
    if (!composed.manualReports) throw Error("SYNTHETIC_MANUAL_COMPOSITION_REQUIRED");
    await composed.manualReports.initialize();
    const challenge = await composed.identity.requestChallenge(
      owner,
      newId(),
      "email_verification",
    );
    const challengeId = challenge.id;
    if (typeof challengeId !== "string") throw Error("SYNTHETIC_MAIL_CHALLENGE_REQUIRED");
    const evidenceId = newId(),
      generation = newId(),
      leaseToken = newId();
    const past = new Date(Date.now() - 120000).toISOString();
    await unit.run(async (tx) => {
      await unit.client(tx).insert(manualEvidence).values({
        id: evidenceId,
        ownerId: owner.userId,
        state: "processing",
        generation,
        originalName: "synthetic.png",
        contentType: "image/png",
        leaseToken,
        leaseUntil: past,
        nextCheckAt: past,
        createdAt: past,
        updatedAt: past,
      });
      await unit.client(tx).insert(manualBlobGenerations).values({
        evidenceId,
        generation,
        leaseUntil: past,
        nextCheckAt: past,
        createdAt: past,
        updatedAt: past,
      });
    });
    const db = guardedSettings();
    const environment: NodeJS.ProcessEnv = {
      MYSQL_HOST: db.host,
      MYSQL_PORT: String(db.port),
      MYSQL_DATABASE: db.database,
      MYSQL_USER: db.user,
      MYSQL_PASSWORD: db.password,
      IDENTITY_ENABLED: "true",
      IDENTITY_SECRET: identityConfig.secret,
      IDENTITY_ORIGIN: identityConfig.origin,
      MAIL_MODE: "local",
      MAIL_ENCRYPTION_KEY: mailKey,
      MAIL_SENDER: "synthetic@example.invalid",
      CATALOGS_ENABLED: "true",
      CATALOGS_CURSOR_KEY: catalogKey,
      TRIPS_ENABLED: "true",
      TRIPS_CURSOR_KEY: tripKey,
      MANUAL_REPORTS_ENABLED: "true",
      MANUAL_REPORTS_KEY: config.key,
      MANUAL_MAX_FILES_PER_REPORT: "5",
      MANUAL_POLICY_REVISION: "1",
      MANUAL_ORPHAN_GRACE_MS: "60000",
      MANUAL_EVIDENCE_ROOT: ownedRoot,
      MANUAL_MAX_FILE_BYTES: "1048576",
      MANUAL_MAX_PIXELS: "10000",
      MANUAL_UPLOAD_TIMEOUT_MS: "5000",
    };
    const delivery = async () => {
      const [rows] = await control.query<RowDataPacket[]>(
        "SELECT state,attempts,id,receipt FROM mail_deliveries WHERE generation_id=?",
        [Buffer.from(challengeId)],
      );
      expect(rows).toHaveLength(1);
      return rows[0] as RowDataPacket;
    };
    expect((await delivery()).state).toBe("queued");
    await verifyRoot(ownedRoot);
    expect((await readdir(root)).includes("jobs-storage-outage.offline")).toBe(false);
    await rename(ownedRoot, heldRoot);
    displaced = true;
    const failed = await ownedJobsCli(environment, deadline, 1);
    expect(failed).toMatchObject({
      exitCode: 1,
      storageFailure: true,
      result: { manualCleanup: "storage_unavailable" },
    });
    expect(failed.result?.processed).toBeGreaterThanOrEqual(1);
    const delivered = await delivery();
    expect(delivered).toMatchObject({ state: "simulated", attempts: 1 });
    expect(delivered.receipt).toBe(`local:messaging.mail:${String(delivered.id)}`);
    const [pending] = await control.query<RowDataPacket[]>(
      "SELECT state,generation,lease_token,deletion_job_id FROM manual_evidence WHERE id=?",
      [Buffer.from(evidenceId)],
    );
    expect(pending[0]?.state).toBe("processing");
    expect(String(pending[0]?.generation)).toBe(generation);
    expect(pending[0]?.lease_token).not.toBeNull();
    expect(pending[0]?.deletion_job_id).toBeNull();
    await verifyRoot(heldRoot);
    expect((await readdir(root)).includes("jobs-storage-outage")).toBe(false);
    await rename(heldRoot, ownedRoot);
    displaced = false;
    // Expire only this fixture's recovered lease; production deadlines remain unchanged.
    await control.execute(
      "UPDATE manual_evidence SET lease_until=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE id=? AND state='processing'",
      [Buffer.from(evidenceId)],
    );
    const recovered = await ownedJobsCli(environment, deadline, 2);
    expect(recovered).toMatchObject({
      exitCode: 0,
      storageFailure: false,
      result: { manualCleanup: "complete" },
    });
    expect(await delivery()).toEqual(delivered);
    const [settled] = await control.query<RowDataPacket[]>(
      "SELECT state,lease_token,lease_until FROM manual_evidence WHERE id=?",
      [Buffer.from(evidenceId)],
    );
    expect(settled[0]).toMatchObject({ state: "rejected", lease_token: null, lease_until: null });
    const [generations] = await control.query<RowDataPacket[]>(
      "SELECT state FROM manual_blob_generations WHERE evidence_id=? AND generation=?",
      [Buffer.from(evidenceId), Buffer.from(generation)],
    );
    expect(generations).toHaveLength(1);
    expect(generations[0]?.state).toBe("tracked");
    const [mailJobs] = await control.query<RowDataPacket[]>(
      "SELECT state,attempts FROM durable_jobs WHERE consumer=? AND effect_key=?",
      [Buffer.from("messaging.mail"), delivered.id],
    );
    expect(mailJobs).toHaveLength(1);
    expect(mailJobs[0]).toMatchObject({ state: "completed", attempts: 1 });
    expect(await readdir(ownedRoot)).toEqual([]);
    console.log(
      JSON.stringify({
        event: "manual_jobs_storage_isolation",
        storageFailureReported: true,
        mailSimulatedOnce: true,
        manualRecovered: true,
      }),
    );
  } finally {
    if (displaced) {
      await verifyRoot(heldRoot);
      expect((await readdir(root)).includes("jobs-storage-outage")).toBe(false);
      await rename(heldRoot, ownedRoot);
    }
    await verifyRoot(ownedRoot);
    await rm(ownedRoot, { recursive: true });
  }
});

test.each([
  "unavailable",
  "cancelled",
  "non_blob",
  "unknown_commit",
  "wrapped_cause",
  "wrapped_unknown_commit",
  "status_bearing",
] as const)(
  "expired upload recovery preserves %s failure ownership without consuming new bytes",
  async (scenario) => {
    const key = newId(),
      image = await upload(key);
    const [original] = await unit.run((tx) => unit.client(tx).select().from(manualEvidence));
    if (!original) throw Error("SYNTHETIC_UPLOAD_REQUIRED");
    const uncertain = new TransactionCommitOutcomeUnknownError(Error("SYNTHETIC_RECEIPT_LOSS"));
    const failure =
      scenario === "non_blob"
        ? Error("SYNTHETIC_INSPECTION_FAILURE")
        : scenario === "unknown_commit"
          ? uncertain
          : scenario === "wrapped_cause"
            ? Object.assign(new BlobFailure("unavailable"), {
                cause: Error("SYNTHETIC_WRAPPED_FAILURE"),
              })
            : scenario === "wrapped_unknown_commit"
              ? Object.assign(new BlobFailure("unavailable"), { cause: uncertain })
              : scenario === "status_bearing"
                ? Object.assign(new BlobFailure("unavailable"), { statusCode: 409 })
                : new BlobFailure(scenario === "cancelled" ? "cancelled" : "unavailable");
    let inspected = 0,
      puts = 0,
      consumed = 0;
    const module = createManualReports(
      unit,
      manualConfig,
      {
        identity,
        catalogs,
        trips: tripService,
        blobs: {
          ...blobs,
          async inspect() {
            inspected++;
            throw failure;
          },
          async put(...args) {
            puts++;
            return blobs.put(...args);
          },
        },
      },
      now,
    );
    async function* untouched() {
      consumed++;
      yield pngBytes();
    }
    const boundaryToken = newId();
    await unit.run((tx) =>
      unit
        .client(tx)
        .update(manualEvidence)
        .set({
          state: "processing",
          leaseToken: boundaryToken,
          leaseUntil: new Date(instant + manualConfig.storage.timeoutMs).toISOString(),
        })
        .where(eq(manualEvidence.id, image.id)),
    );
    await expect(
      module.upload(owner, key, "synthetic.png", untouched(), "image/png"),
    ).rejects.toMatchObject({
      statusCode: 503,
      publicCode: "DEPENDENCY_UNAVAILABLE",
    });
    expect(inspected).toBe(0);
    const expire = () =>
      unit.run((tx) =>
        unit
          .client(tx)
          .update(manualEvidence)
          .set({
            leaseUntil: new Date(instant - 1).toISOString(),
          })
          .where(eq(manualEvidence.id, image.id)),
      );
    await expire();
    const replay = module.upload(owner, key, "synthetic.png", untouched(), "image/png");
    if (scenario === "unavailable" || scenario === "cancelled")
      await expect(replay).rejects.toMatchObject({
        statusCode: 503,
        publicCode: "DEPENDENCY_UNAVAILABLE",
      });
    else await expect(replay).rejects.toBe(failure);
    expect(inspected).toBe(1);
    expect(puts).toBe(0);
    expect(consumed).toBe(0);
    const [retained] = await unit.run((tx) => unit.client(tx).select().from(manualEvidence));
    expect(retained).toMatchObject({
      id: image.id,
      state: "processing",
      generation: original.generation,
    });
    expect(retained?.leaseToken).not.toBe(boundaryToken);
    expect(retained?.leaseToken).not.toBeNull();
    expect(retained?.leaseUntil).toBe(
      new Date(instant + manualConfig.storage.timeoutMs).toISOString(),
    );
    const commands = await unit.run((tx) => unit.client(tx).select().from(manualCommands));
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ key, result: { id: image.id } });
    await expire();
    // Shared maintenance recovery keeps its original classified error boundary.
    await expect(module.recoverUpload(image.id)).rejects.toBe(failure);
    expect(inspected).toBe(2);
    expect(puts).toBe(0);
    expect(consumed).toBe(0);
  },
);

test("built HTTP expired upload replay reports unavailable storage as retryable and recovers the same identity", async ({
  signal,
}) => {
  const ownedRoot = resolve(root, "upload-recovery-status"),
    heldRoot = resolve(root, "upload-recovery-status.offline");
  expect(
    ownedRoot.startsWith(resolve(root) + sep) && heldRoot.startsWith(resolve(root) + sep),
  ).toBe(true);
  await mkdir(ownedRoot, { mode: 0o700 });
  const owned = await lstat(ownedRoot);
  const verifyRoot = async (path: string) => {
    expect([ownedRoot, heldRoot]).toContain(path);
    const stat = await lstat(path);
    expect(stat.isDirectory() && !stat.isSymbolicLink()).toBe(true);
    expect([stat.dev, stat.ino]).toEqual([owned.dev, owned.ino]);
  };
  let displaced = false,
    app: Awaited<ReturnType<typeof createApp>> | undefined;
  const clients = new Set<ReturnType<typeof request>>();
  const stop = () => {
    for (const client of clients) client.destroy();
  };
  signal.addEventListener("abort", stop, { once: true });
  try {
    signal.throwIfAborted();
    const { createApp: builtApp }: { createApp: typeof createApp } = await import(
      pathToFileURL(resolve("apps/api/dist/app.js")).href
    );
    const {
      createManualReports: builtManual,
    }: { createManualReports: typeof createManualReports } = await import(
      pathToFileURL(resolve("apps/api/dist/modules/manual-reports/service.js")).href
    );
    const module = builtManual(
      unit,
      { ...manualConfig, storage: { ...manualConfig.storage, root: ownedRoot } },
      { identity, catalogs, trips: tripService },
      now,
    );
    app = await builtApp({
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
      body?: Buffer,
    ) {
      signal.throwIfAborted();
      return new Promise<{
        status: number;
        headers: import("node:http").IncomingHttpHeaders;
        body: Buffer;
      }>((accept, reject) => {
        const fail = () => reject(Error("SYNTHETIC_RECOVERY_HTTP_FAILURE"));
        const client = request(
          { host: "127.0.0.1", port, path, method, headers, agent: false },
          (response) => {
            const chunks: Buffer[] = [];
            response.on("data", (chunk) => chunks.push(chunk));
            response.once("error", fail);
            response.once("aborted", fail);
            response.once("end", () =>
              accept({
                status: response.statusCode ?? 0,
                headers: response.headers,
                body: Buffer.concat(chunks),
              }),
            );
          },
        );
        clients.add(client);
        client.once("close", () => clients.delete(client));
        client.once("error", fail);
        client.end(body);
      });
    }
    const csrf = JSON.parse(
      (await http("/api/v1/auth/csrf", "GET", { cookie: ownerCookie })).body.toString(),
    ).data.token as string;
    const key = newId(),
      boundary = "synthetic-recovery-status-boundary";
    const headers = {
      cookie: ownerCookie,
      origin: identityConfig.origin,
      "x-csrf-token": csrf,
      "idempotency-key": key,
      "content-type": `multipart/form-data; boundary=${boundary}`,
    };
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="synthetic.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      pngBytes(),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const first = await http("/api/v1/evidence", "POST", headers, body);
    expect(first.status).toBe(202);
    const image = JSON.parse(first.body.toString()).data as S["Evidence"];
    const row = async () =>
      (
        await unit.run((tx) =>
          unit.client(tx).select().from(manualEvidence).where(eq(manualEvidence.id, image.id)),
        )
      )[0];
    const original = await row();
    if (!original) throw Error("SYNTHETIC_UPLOAD_REQUIRED");
    expect(original.state).toBe("ready");
    await unit.run((tx) =>
      unit
        .client(tx)
        .update(manualEvidence)
        .set({
          state: "processing",
          leaseToken: newId(),
          leaseUntil: new Date(instant - 1).toISOString(),
        })
        .where(eq(manualEvidence.id, image.id)),
    );
    await verifyRoot(ownedRoot);
    expect((await readdir(root)).includes("upload-recovery-status.offline")).toBe(false);
    await rename(ownedRoot, heldRoot);
    displaced = true;
    const unavailable = await http("/api/v1/evidence", "POST", headers, body);
    expect(unavailable.status).toBe(503);
    expect(JSON.parse(unavailable.body.toString()).error).toMatchObject({
      code: "DEPENDENCY_UNAVAILABLE",
      retryable: true,
    });
    expect(unavailable.headers["retry-after"]).toBe("1");
    expect(unavailable.headers["cache-control"]).toBe("no-store");
    const retained = await row();
    expect(retained).toMatchObject({
      id: image.id,
      state: "processing",
      generation: original.generation,
    });
    expect(retained?.leaseToken).not.toBeNull();
    expect(retained?.leaseUntil).toBe(
      new Date(instant + manualConfig.storage.timeoutMs).toISOString(),
    );
    await verifyRoot(heldRoot);
    const filename = `${image.id}.${original.generation}.blob`;
    expect(await readdir(heldRoot)).toEqual([filename]);
    expect(await readFile(join(heldRoot, filename))).toEqual(pngBytes());
    expect((await readdir(root)).includes("upload-recovery-status")).toBe(false);
    await rename(heldRoot, ownedRoot);
    displaced = false;
    await unit.run((tx) =>
      unit
        .client(tx)
        .update(manualEvidence)
        .set({ leaseUntil: new Date(instant - 1).toISOString() })
        .where(eq(manualEvidence.id, image.id)),
    );
    const recovered = await http("/api/v1/evidence", "POST", headers, body);
    expect(recovered.status).toBe(202);
    expect(JSON.parse(recovered.body.toString()).data).toMatchObject({
      id: image.id,
      state: "ready",
    });
    expect(await row()).toMatchObject({
      id: image.id,
      generation: original.generation,
      state: "ready",
      leaseToken: null,
      leaseUntil: null,
    });
    expect(await unit.run((tx) => unit.client(tx).select().from(manualEvidence))).toHaveLength(1);
    const commands = await unit.run((tx) => unit.client(tx).select().from(manualCommands));
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ key, result: { id: image.id } });
    const downloaded = await http(`/api/v1/evidence/${image.id}/content`, "GET", {
      cookie: ownerCookie,
    });
    expect(downloaded.status).toBe(200);
    expect(downloaded.body).toEqual(pngBytes());
    expect(
      (await http(`/api/v1/evidence/${image.id}/content`, "GET", { cookie: otherCookie })).status,
    ).toBe(404);
    expect(await readdir(ownedRoot)).toEqual([filename]);
  } finally {
    try {
      const closure = Promise.all(
        [...clients].map(
          (client) => new Promise<void>((accept) => client.once("close", () => accept())),
        ),
      );
      stop();
      await closure;
      await app?.close();
    } finally {
      signal.removeEventListener("abort", stop);
      if (displaced) {
        await verifyRoot(heldRoot);
        expect((await readdir(root)).includes("upload-recovery-status")).toBe(false);
        await rename(heldRoot, ownedRoot);
      }
      await verifyRoot(ownedRoot);
      await rm(ownedRoot, { recursive: true });
    }
  }
});
