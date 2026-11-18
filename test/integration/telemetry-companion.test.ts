import { randomBytes } from "node:crypto";
import { type IncomingHttpHeaders, request as httpRequest } from "node:http";
import type { companionComponents, components } from "@vtc/contracts";
import { createUnitOfWork, newId, runMigrations, type UnitOfWork } from "@vtc/db";
import { steamAccounts, steamLinks } from "@vtc/db/external-identities-schema";
import { manualEvidence } from "@vtc/db/manual-reports-schema";
import { eq, membership } from "@vtc/db/identity-schema";
import { tripOwnerRevisions } from "@vtc/db/trips-schema";
import { tripDecisions } from "@vtc/db/trip-decisions-schema";
import type { Connection, RowDataPacket } from "mysql2/promise";
import { beforeEach, expect, test, afterAll as vAfter, beforeAll as vBefore } from "vitest";
import { createApp } from "../../apps/api/src/app.ts";
import { createCatalogs } from "../../apps/api/src/modules/catalogs/service.ts";
import { createEvents } from "../../apps/api/src/modules/events/service.ts";
import { createExternalIdentities } from "../../apps/api/src/modules/external-identities/service.ts";
import { createTelemetry } from "../../apps/api/src/modules/telemetry/service.ts";
import type { Actor } from "../../apps/api/src/modules/identity/service.ts";
import type { AssignableRole } from "../../apps/api/src/modules/identity/permissions.ts";
import { createIdentity } from "../../apps/api/src/modules/identity/service.ts";
import {
  createQualificationInitialization,
  structuralLevels,
} from "../../apps/api/src/modules/qualifications/initialization.ts";
import type { Telemetry } from "../../apps/api/src/modules/sources/contracts/telemetry.ts";
import { createCompanionAssessments } from "../../apps/api/src/modules/trip-decisions/companion.ts";
import { createTrips } from "../../apps/api/src/modules/trips/service.ts";
import { composeIdentity } from "../../apps/api/src/use-cases/identity-messaging.ts";
import { createTelemetryCompanion } from "../../apps/api/src/use-cases/telemetry-companion.ts";
import { catalogConfig, seedCatalog } from "../fixtures/catalogs/synthetic.ts";
import {
  guardedSettings,
  reset,
  SCHEMA_SETUP_TIMEOUT_MS,
  testConnection,
} from "../persistence/support.ts";
import { telemetryFixture } from "../support/builders.ts";
import { schemaLifecycleHooks } from "../support/schema-lifecycle.ts";
import { bounded, deferred } from "../support/concurrency.ts";

const { beforeAll, afterAll } = schemaLifecycleHooks(vBefore, vAfter);
type C = companionComponents["schemas"];
type S = components["schemas"];
const immutableAssessment = (assessment: C["Assessment"] | null) =>
  assessment ? { ...assessment, trailerDisplay: [] } : null;
const key = () => randomBytes(32).toString("hex"),
  origin = "http://127.0.0.1:4173",
  password = "Fictional-companion-passphrase-42",
  ip = "127.0.0.1";
const prefix = "/api/telemetry/companion/v1";
const openLimits: S["QualificationLimitsInput"] = {
  massMinKg: null,
  massMaxKg: null,
  distanceMinM: null,
  distanceMaxM: null,
  trailers: { mode: "any", typeIds: [] },
  adr: { mode: "any", classes: [] },
  hardModeRequired: false,
};
let control: Connection,
  unit: UnitOfWork,
  modules: ReturnType<typeof composeIdentity>,
  app: Awaited<ReturnType<typeof createApp>>,
  director: Actor,
  driver: Actor,
  authorization: string,
  tokenId: string,
  sequence = 0;
const bearer = (token: string) => `Bearer ${token}`;
async function configure(
  limits: Partial<S["QualificationLimitsInput"]> = {},
  conditions: S["QualificationConditions"] = {
    requiredTrips: 1000,
    requiredDistanceM: "1000000000",
  },
  game: "ets2" | "ats" = "ets2",
) {
  const q = modules.qualifications!;
  const level = await q.detail(director, structuralLevels[game][0]);
  return q.update(director, level.id, {
    expectedVersion: level.version,
    name: level.name,
    limits: { ...openLimits, ...limits },
    conditions,
  });
}
async function member(
  games: ("ets2" | "ats")[] = ["ets2", "ats"],
  roles: AssignableRole[] = ["driver"],
) {
  const id = newId(),
    email = `${id}@example.invalid`,
    credential = await modules.identity.prepareCredential(password);
  await unit.run(async (tx) => {
    await modules.identity.insertWithCredential(tx, {
      userId: id,
      email,
      name: "Fictional companion driver",
      roles,
      ...credential,
    });
    if (games.length)
      await createQualificationInitialization(unit).initialize(tx, {
        userId: id,
        games,
        assignedAt: "2026-01-01T00:00:00.000Z",
      });
    const steamId = `765611900100${String(++sequence).padStart(5, "0")}`;
    await unit
      .client(tx)
      .insert(steamAccounts)
      .values({ steamId, userId: id, createdAt: new Date() });
    await unit.client(tx).insert(steamLinks).values({ userId: id, steamId });
  });
  const login = await modules.identity.login(email, password);
  const actor = await modules.identity.authenticate(
    new Headers({ cookie: login.cookies.map((v) => v.split(";", 1)[0]).join("; ") }),
  );
  return actor;
}
async function issue(actor = driver, companion = true) {
  return modules.telemetry!.issue(actor, newId(), {
    label: "Fictional companion",
    ...(companion ? { companion: true } : {}),
  });
}
const sourceRequest = (p: Telemetry): C["SourceRequest"] => ({
  source: {
    provider: "ets2telemetry",
    game: p.source.game,
    pluginSessionId: p.source.pluginSessionId,
    tripId: p.source.tripId,
  },
  revision: p.revision,
  eventId: p.eventId,
});
const batch = (items: C["SourceRequest"][]): C["ResultBatchInput"] => ({
  requestId: newId(),
  items,
});
async function results(items: C["SourceRequest"][], auth = authorization) {
  return modules.telemetryCompanion!.results(auth, ip, batch(items));
}
async function httpResults(items: C["SourceRequest"][]) {
  if (!app.server.listening) await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("SYNTHETIC_HTTP_ADDRESS_REQUIRED");
  const payload = JSON.stringify(batch(items));
  return new Promise<{ status: number | undefined; headers: IncomingHttpHeaders; body: string }>(
    (resolve, reject) => {
      const request = httpRequest(
        {
          host: "127.0.0.1",
          port: address.port,
          path: prefix + "/results",
          method: "POST",
          headers: {
            authorization,
            "content-type": "application/json",
            "content-length": Buffer.byteLength(payload),
          },
        },
        (response) => {
          let body = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => {
            body += chunk;
          });
          response.on("end", () =>
            resolve({ status: response.statusCode, headers: response.headers, body }),
          );
        },
      );
      request.setTimeout(10000, () => request.destroy(new Error("SYNTHETIC_HTTP_TIMEOUT")));
      request.on("error", reject);
      request.end(payload);
    },
  );
}
async function clearAdmission() {
  await control.query("DELETE FROM telemetry_limits");
}
async function upload() {
  const registration = await modules.telemetry!.register(authorization, ip, newId());
  const p = telemetryFixture("completed") as unknown as Telemetry,
    now = Date.now();
  p.eventId = newId();
  p.source.tripId = newId();
  p.source.pluginSessionId = newId();
  p.createdUtcMs = now;
  p.snapshot.start.utcMs = now - 60000;
  if (p.snapshot.end) p.snapshot.end.utcMs = now;
  p.installationId = registration.installationId;
  p.bindingId = registration.bindingId;
  return p;
}
const preview = (): C["PreviewInput"] => ({
  requestId: newId(),
  contextRevision: 1,
  evidenceRevision: 1,
  game: "ets2",
  cargo: { availability: "known", code: "fixture_crates" },
  cargoMassKg: { availability: "known", value: "18000" },
  trailers: { complete: true, items: [{ code: "fixture_box", provenance: "attached" }] },
  actualDistance: {
    availability: "known",
    metres: "99999.999999999999999999",
    support: "whole-trip",
    final: false,
  },
  hardMode: { result: "qualified", final: false },
  start: null,
  eventId: null,
});
async function domainState() {
  const [rows] = await control.query<RowDataPacket[]>(
    "SELECT (SELECT COUNT(*) FROM qualification_assignments) assignments,(SELECT SUM(version) FROM qualification_levels) levels,(SELECT COUNT(*) FROM trip_decisions) decisions,(SELECT COUNT(*) FROM trip_contribution_history) credits,(SELECT COUNT(*) FROM source_messages) messages,(SELECT COALESCE(SUM(version),0) FROM trips) trips,(SELECT COUNT(*) FROM trip_event_associations) associations,(SELECT COUNT(*) FROM outbox_events) outbox,(SELECT COALESCE(SUM(revision),0) FROM trip_owner_revisions) revisions",
  );
  return rows[0];
}
beforeAll(async () => {
  const started = performance.now();
  const phase = (phase: string) =>
    console.log(
      JSON.stringify({
        event: "companion_setup",
        phase,
        elapsedMs: Math.round(performance.now() - started),
      }),
    );
  phase("connection");
  control = await testConnection();
  unit = createUnitOfWork(guardedSettings());
  await reset(control);
  phase("migrations");
  await runMigrations(guardedSettings());
  phase("composition");
  modules = composeIdentity(
    unit,
    { secret: key(), origin, production: false },
    undefined,
    undefined,
    true,
    catalogConfig(),
    { cursorKey: key() },
    { cursorKey: key(), ipPerMinute: 600, globalPerMinute: 6000 },
    { key: key(), maxFilesPerReport: 5, policyRevision: 1, orphanGraceMs: 60000 },
    {},
    { cursorKey: key() },
    { key: key() },
    { key: key() },
  );
  phase("bootstrap");
  await modules.identity.bootstrap({
    email: "companion-director@example.invalid",
    name: "Fictional Companion Director",
    password,
  });
  const login = await modules.identity.login("companion-director@example.invalid", password);
  director = await modules.identity.authenticate(
    new Headers({ cookie: login.cookies.map((v) => v.split(";", 1)[0]).join("; ") }),
  );
  for (const game of ["ets2", "ats"] as const)
    await seedCatalog(unit, game, {
      cities: ["fixture_north", "fixture_south"],
      cargoes: ["fixture_crates", { code: "fixture_gas", adrClass: "2" }],
      trailers: [{ code: "fixture_box", nameEn: "Fictional box", nameRu: "Вымышленный фургон" }],
    });
  phase("http");
  app = await createApp({ ...modules, checkReadiness: async () => true });
  phase("ready");
}, SCHEMA_SETUP_TIMEOUT_MS);
beforeEach(async () => {
  await clearAdmission();
  await configure();
  driver = await member();
  const issued = await issue();
  authorization = bearer(issued.token);
  tokenId = issued.info.id;
});
afterAll(async () => {
  await app?.close();
  await unit?.close();
  await control?.end();
});

test("own qualification and preview are consistent read-only snapshots with exact remaining amounts and a bounded lease", async () => {
  await configure(
    { massMinKg: "0", distanceMinM: "100000", distanceMaxM: "500000", hardModeRequired: true },
    { requiredTrips: 3, requiredDistanceM: "300000.125" },
  );
  const before = await domainState();
  const qualification = await modules.telemetryCompanion!.qualification(authorization, ip, "ets2");
  const connection = await modules.telemetry!.connection(authorization, ip);
  expect(qualification.ownerId).toBe(connection.accountId);
  expect(qualification).toMatchObject({
    state: "assigned",
    ownerId: driver.userId,
    game: "ets2",
    assignment: { level: { id: structuralLevels.ets2[0] }, limits: { massMinKg: "0" } },
    progress: {
      creditedTrips: 0,
      creditedDistanceM: "0",
      remainingTrips: 3,
      remainingDistanceM: "300000.125",
      conditionsMet: false,
      terminal: false,
    },
  });
  const body = preview(),
    checked = await modules.telemetryCompanion!.preview(authorization, ip, body);
  expect(checked).toMatchObject({
    provisional: true,
    basis: "current_projection",
    contextRevision: 1,
    evidenceRevision: 1,
    outcome: "unknown",
    eventExempt: false,
    applicability: {
      contextRevision: 1,
      minimumDistanceM: body.actualDistance.metres,
      maximumDistanceM: "500000",
      qualificationRevision: qualification.progressRevision,
      requiresQualificationRefresh: true,
    },
  });
  expect(
    Date.parse(checked.applicability.expiresAt) - Date.parse(checked.evaluatedAt),
  ).toBeLessThanOrEqual(5000);
  expect(checked.rules.find((r) => r.rule === "distance")).toMatchObject({
    result: "unknown",
    reasons: ["below_minimum_growing"],
  });
  expect(await domainState()).toEqual(before);
  const ats = await modules.telemetryCompanion!.qualification(authorization, ip, "ats");
  expect(ats.game).toBe("ats");
  expect(ats.assignment).not.toBeNull();
  const missing = await member([]),
    missingToken = await issue(missing);
  expect(
    await modules.telemetryCompanion!.qualification(bearer(missingToken.token), ip, "ets2"),
  ).toMatchObject({ state: "assignment_missing", assignment: null, progress: null });
  const disabled = createTelemetryCompanion({
    telemetry: modules.telemetry!,
    trips: modules.trips!,
  });
  expect(await disabled.qualification(authorization, ip, "ets2")).toMatchObject({
    state: "unavailable",
    assignment: null,
    progress: null,
  });
});

test("strict HTTP bearer capability, no cookie fallback, payload/media bounds and safe unsupported game", async () => {
  const ingestOnly = await issue(driver, false);
  expect(ingestOnly.info.companion).toBe(false);
  const forbidden = await app.inject({
    url: `${prefix}/capabilities`,
    headers: { authorization: bearer(ingestOnly.token) },
  });
  expect(forbidden.statusCode).toBe(403);
  expect(forbidden.json().error.code).toBe("CAPABILITY_REQUIRED");
  const connection = await modules.telemetry!.connection(bearer(ingestOnly.token), ip);
  expect(connection.contract).toEqual({ major: 1, minor: 0 });
  const cookieOnly = await app.inject({
    url: `${prefix}/qualification/ets2`,
    headers: { cookie: "untrusted=synthetic" },
  });
  expect(cookieOnly.statusCode).toBe(401);
  const good = await app.inject({ url: `${prefix}/capabilities`, headers: { authorization } });
  expect(good.statusCode).toBe(200);
  expect(good.headers["cache-control"]).toBe("no-store");
  expect(good.json()).toMatchObject({
    capability: "companion.own.v1",
    maxBatch: 25,
    maxBodyBytes: 16384,
  });
  const invalidGame = await app.inject({
    url: `${prefix}/qualification/unsupported`,
    headers: { authorization },
  });
  expect(invalidGame.statusCode).toBe(400);
  await clearAdmission();
  const queryTarget = await app.inject({
    url: `${prefix}/qualification/ets2?memberId=${newId()}`,
    headers: { authorization },
  });
  expect(queryTarget.statusCode).toBe(400);
  expect(queryTarget.headers["cache-control"]).toBe("no-store");
  const getBody = await app.inject({
    method: "GET",
    url: `${prefix}/capabilities`,
    headers: { authorization, "content-type": "application/json", "content-length": "2" },
    payload: "{}",
  });
  expect(getBody.statusCode).toBe(400);
  for (const value of [
    { ...preview(), memberId: newId() },
    { ...preview(), cargoMassKg: { availability: "known", value: "1.0" } },
    { ...preview(), cargoMassKg: { availability: "unknown", value: "0" } },
    {
      ...preview(),
      trailers: {
        complete: true,
        items: Array(11).fill({ code: "fixture_box", provenance: "attached" }),
      },
    },
  ]) {
    const response = await app.inject({
      method: "POST",
      url: `${prefix}/preview`,
      headers: { authorization },
      payload: value,
    });
    expect(response.statusCode).toBe(400);
  }
  await clearAdmission();
  const media = await app.inject({
    method: "POST",
    url: `${prefix}/preview`,
    headers: { authorization, "content-type": "text/plain" },
    payload: "{}",
  });
  expect(media.statusCode).toBe(415);
  const huge = await app.inject({
    method: "POST",
    url: `${prefix}/preview`,
    headers: { authorization, "content-type": "application/json" },
    payload: `{"padding":"${"x".repeat(16384)}"}`,
  });
  expect(huge.statusCode).toBe(413);
  const duplicateKeys = await app.inject({
    method: "POST",
    url: `${prefix}/results`,
    headers: { authorization, "content-type": "application/json" },
    payload: '{"items":[],"items":[]}',
  });
  expect(duplicateKeys.statusCode).toBe(400);
});

test("exact result receipt, replay, foreign lookup, retained immutable assessment and conditional request fencing", async () => {
  const p = await upload(),
    requested = sourceRequest(p);
  const absent = (await results([requested])).items[0]!;
  expect(absent).toMatchObject({
    receipt: "not_received",
    state: "not_received",
    assessment: null,
    credit: null,
  });
  const stored = await modules.telemetry!.receive(authorization, ip, p);
  expect(stored.status).toBe("stored");
  const first = (await results([requested])).items[0]!;
  expect(first).toMatchObject({
    receipt: "received",
    state: "decided",
    companyDecision: "accepted",
    assessmentBasis: "current",
    assessment: {
      availability: "retained",
      sourceRevision: p.revision,
      sourceEventId: p.eventId,
      assessedSource: requested.source,
      outcome: "pass",
    },
    credit: { credited: true, trips: 1, actualDistanceM: "123400" },
  });
  expect(first.assessment!.trailerDisplay).toEqual([
    expect.objectContaining({
      code: "fixture_box",
      nameEn: "Fictional box",
      nameRu: "Вымышленный фургон",
      basis: "current_catalog",
    }),
  ]);
  expect(BigInt(first.resultRevision)).toBeGreaterThan(BigInt(absent.resultRevision));
  const domain = await domainState(),
    repeat = await modules.telemetry!.receive(authorization, ip, p);
  expect(repeat.status).toBe("duplicate");
  expect(await domainState()).toEqual(domain);
  const unchanged = (await results([{ ...requested, ifVersion: first.version }])).items[0]!;
  expect(unchanged).toMatchObject({
    unchanged: true,
    assessment: null,
    credit: null,
    version: first.version,
  });
  const wrongEvent = (await results([{ ...requested, eventId: newId(), ifVersion: first.version }]))
    .items[0]!;
  expect(wrongEvent).toMatchObject({
    receipt: "not_received",
    unchanged: false,
    assessmentBasis: "predecessor",
  });
  const foreign = await member(),
    foreignToken = await issue(foreign),
    foreignReply = (await results([requested], bearer(foreignToken.token))).items[0]!;
  expect(foreignReply).toMatchObject({
    receipt: "not_received",
    canonicalTripId: null,
    latestSourceRevision: null,
    assessment: null,
    credit: null,
  });
  const foreignConditional = (
    await results([{ ...requested, ifVersion: first.version }], bearer(foreignToken.token))
  ).items[0]!;
  expect(foreignConditional.unchanged).toBe(false);
  expect(foreignConditional.canonicalTripId).toBeNull();
  const retained = first.assessment;
  await configure({ massMaxKg: "1" });
  await clearAdmission();
  const edited = (await results([requested])).items[0]!;
  expect(immutableAssessment(edited.assessment)).toEqual(immutableAssessment(retained));
  expect(BigInt(edited.resultRevision)).toBeGreaterThan(BigInt(first.resultRevision));
  await unit.run((tx) =>
    unit
      .client(tx)
      .update(tripDecisions)
      .set({ qualificationSnapshot: null })
      .where(eq(tripDecisions.id, first.assessment!.decisionId)),
  );
  const legacy = (await results([requested])).items[0]!;
  expect(legacy.assessment).toMatchObject({
    availability: "historical_unavailable",
    limits: null,
    outcome: null,
    rules: [],
  });
});

test("asynchronous receipt, late revision correction and predecessor persist across read-service restart", async () => {
  const p = await upload(),
    asyncTrips = createTrips(unit, modules.trips!.config, {
      identity: modules.identity,
      catalogs: modules.catalogs!,
      prepare: (tx, ownerId, game) =>
        modules.qualifications!.prepareInTransaction(tx, [{ ownerId, game }]),
    });
  const receipt = await unit.run((tx) =>
    asyncTrips.storeInTransaction(tx, "ets2telemetry", p, {
      ownerUserId: driver.userId,
      connection: { state: "unknown", referenceId: null },
    }),
  );
  expect((await results([sourceRequest(p)])).items[0]).toMatchObject({
    receipt: "received",
    state: "processing",
    assessmentPending: true,
    assessment: null,
  });
  await unit.run((tx) => modules.tripDecisions!.assessInTransaction(tx, receipt.tripId));
  const original = (await results([sourceRequest(p)])).items[0]!;
  expect(original.assessmentBasis).toBe("current");
  const corrected = structuredClone(p);
  corrected.revision++;
  corrected.eventId = newId();
  corrected.snapshot.job.cargoMass = {
    ...corrected.snapshot.job.cargoMass,
    available: true,
    value: 19000,
  };
  await modules.telemetry!.receive(authorization, ip, corrected);
  const restarted = createTelemetryCompanion({
    telemetry: modules.telemetry!,
    trips: modules.trips!,
    qualifications: modules.qualifications!,
    catalogs: modules.catalogs!,
    events: modules.events!,
    assessments: createCompanionAssessments(unit, modules.events!),
  });
  const pending = (await restarted.results(authorization, ip, batch([sourceRequest(corrected)])))
    .items[0]!;
  expect(pending).toMatchObject({
    receipt: "received",
    latestSourceRevision: corrected.revision,
    correctionPending: true,
    assessmentBasis: "predecessor",
    assessment: {
      decisionId: original.assessment!.decisionId,
      sourceEventId: p.eventId,
      sourceRevision: p.revision,
    },
    credit: { credited: true },
  });
  expect(BigInt(pending.resultRevision)).toBeGreaterThan(BigInt(original.resultRevision));
  expect(
    (await results([{ ...sourceRequest(corrected), eventId: newId() }])).items[0],
  ).toMatchObject({ receipt: "not_received", assessmentBasis: "predecessor" });
});

test("promotion needs both configured conditions and preserves old assessed assignment after advancement", async () => {
  await configure({}, { requiredTrips: 1, requiredDistanceM: "200000" });
  const p = await upload();
  await modules.telemetry!.receive(authorization, ip, p);
  const first = await modules.telemetryCompanion!.qualification(authorization, ip, "ets2");
  expect(first).toMatchObject({
    assignment: { level: { id: structuralLevels.ets2[0] } },
    progress: {
      creditedTrips: 1,
      creditedDistanceM: "123400",
      remainingTrips: 0,
      remainingDistanceM: "76600",
      conditionsMet: false,
    },
  });
  const retained = (await results([sourceRequest(p)])).items[0]!.assessment;
  await configure({}, { requiredTrips: 1, requiredDistanceM: "100000" });
  const promoted = await modules.telemetryCompanion!.qualification(authorization, ip, "ets2");
  expect(promoted.assignment!.level.id).not.toBe(structuralLevels.ets2[0]);
  expect(BigInt(promoted.progressRevision)).toBeGreaterThan(BigInt(first.progressRevision));
  expect(immutableAssessment((await results([sourceRequest(p)])).items[0]!.assessment)).toEqual(
    immutableAssessment(retained),
  );
});

test("confirmed attendance exempts all five server-side, RSVP/client references cannot grant it and later attendance invalidates results", async () => {
  await configure({
    massMaxKg: "1",
    distanceMinM: "999999",
    trailers: {
      mode: "selected",
      typeIds: [(await modules.catalogs!.list(driver, "trailers", { game: "ets2" })).items[0]!.id],
    },
    adr: { mode: "forbidden", classes: [] },
    hardModeRequired: true,
  });
  const time = Date.now(),
    created = await modules.events!.create(director, newId(), {
      title: "Fictional companion convoy",
      description: "Fictional convoy",
      game: "ets2",
      server: "Fictional",
      organizer: "Fictional company",
      meetingLocation: "Fictional yard",
      route: "Fictional route",
      meetingAt: new Date(time + 1800000).toISOString(),
      startsAt: new Date(time + 3600000).toISOString(),
      endsAt: null,
      visibility: "members",
      originCityId: null,
      destinationCityId: null,
      prescribedCargoId: null,
      prescribedMassKg: null,
      prescribedTrailerTypeId: null,
    });
  const eventId = created.data.event.id,
    body = preview();
  body.eventId = eventId;
  body.cargoMassKg.value = "99999";
  const unresolved = await modules.telemetryCompanion!.preview(authorization, ip, body);
  expect(unresolved).toMatchObject({ eventExempt: false, outcome: "fail" });
  expect(unresolved.reasons).toContain("event_unresolved");
  const futureEvents = createEvents(
    unit,
    { cursorKey: key() },
    {
      identity: modules.identity,
      catalogs: modules.catalogs!,
      companionChanged: async (tx, ids) => {
        for (const id of ids) await modules.trips!.companion.revision.bump(tx, id);
      },
    },
    () => new Date(time + 3600001),
  );
  await futureEvents.setAttendance(director, eventId, newId(), 1, {
    members: [{ memberId: driver.userId, attendance: "attended", note: null }],
  });
  const confirmed = await modules.telemetryCompanion!.preview(authorization, ip, body);
  expect(confirmed).toMatchObject({ eventExempt: true, outcome: "pass" });
  expect(confirmed.rules.every((rule) => rule.result === "pass")).toBe(true);
  expect(BigInt(confirmed.applicability.qualificationRevision)).toBeGreaterThan(
    BigInt(unresolved.applicability.qualificationRevision),
  );
  const p = await upload();
  await modules.telemetry!.receive(authorization, ip, p);
  const result = (await results([sourceRequest(p)])).items[0]!;
  const row = await modules.trips!.detail(driver, result.canonicalTripId!);
  if (row.view !== "private") throw new Error("SYNTHETIC_OWN_PRIVATE_TRIP_REQUIRED");
  const association = await modules.tripDecisions!.associate(
    driver,
    result.canonicalTripId!,
    newId(),
    row.summary.version,
    { eventId },
  );
  const proposal = await modules.tripDecisions!.getProposal(
    director,
    result.canonicalTripId!,
    association.data.id,
  );
  await modules.tripDecisions!.proposalDecision(
    director,
    result.canonicalTripId!,
    proposal.data.id,
    newId(),
    proposal.version,
    {
      decision: "approve",
      reviewedRevisionId: proposal.data.revisionId,
      reason: "Fictional confirmed event association",
    },
  );
  await clearAdmission();
  const before = (await results([sourceRequest(p)])).items[0]!;
  expect(before.assessment).toMatchObject({ eventExempt: true });
  await futureEvents.setAttendance(director, eventId, newId(), 2, {
    members: [
      {
        memberId: driver.userId,
        attendance: "not_attended",
        note: "Fictional private attendance note",
      },
    ],
  });
  const changed = (await results([{ ...sourceRequest(p), ifVersion: before.version }])).items[0]!;
  expect(changed.unchanged).toBe(false);
  expect(changed.assessmentPending).toBe(true);
  expect(changed.assessmentBasis).toBe("predecessor");
  expect(BigInt(changed.resultRevision)).toBeGreaterThan(BigInt(before.resultRevision));
  expect(JSON.stringify(changed)).not.toContain("private attendance");
});

test("staff replacement and merge/unmerge advance owner ordering without presenting another source as current assessment", async () => {
  const first = await upload();
  await modules.telemetry!.receive(authorization, ip, first);
  const a = (await results([sourceRequest(first)])).items[0]!;
  const review = await modules.tripDecisions!.review(director, a.canonicalTripId!);
  await modules.tripDecisions!.decide(director, a.canonicalTripId!, newId(), review.version, {
    decision: "reject",
    reviewedRevisionId: review.data.factRevisionId,
    factRevisionId: review.data.factRevisionId,
    proposalId: null,
    reason: "Fictional private reviewer explanation",
  });
  const rejected = (await results([sourceRequest(first)])).items[0]!;
  expect(rejected.companyDecision).toBe("rejected");
  expect(rejected.credit?.credited).toBe(false);
  expect(rejected.assessment?.outcome).toBe("pass");
  expect(BigInt(rejected.resultRevision)).toBeGreaterThan(BigInt(a.resultRevision));
  expect(JSON.stringify(rejected)).not.toContain("reviewer explanation");
  const replacement = await modules.tripDecisions!.review(director, a.canonicalTripId!);
  await modules.tripDecisions!.decide(director, a.canonicalTripId!, newId(), replacement.version, {
    decision: "accept",
    reviewedRevisionId: replacement.data.factRevisionId,
    factRevisionId: replacement.data.factRevisionId,
    proposalId: null,
    reason: "Fictional corrected company decision",
  });
  const second = await upload();
  second.snapshot.start.utcMs = first.snapshot.start.utcMs;
  second.snapshot.end = structuredClone(first.snapshot.end);
  second.createdUtcMs = first.createdUtcMs;
  await modules.telemetry!.receive(authorization, ip, second);
  await clearAdmission();
  const b = (await results([sourceRequest(second)])).items[0]!;
  const states = await unit.run((tx) =>
    modules.trips!.statesInTransaction(tx, [a.canonicalTripId!, b.canonicalTripId!]),
  );
  const merged = await modules.reconciliation!.merge(director, newId(), {
    primaryTripId: a.canonicalTripId!,
    secondaryTripId: b.canonicalTripId!,
    primaryVersion: states.find((t) => t.id === a.canonicalTripId)!.version,
    secondaryVersion: states.find((t) => t.id === b.canonicalTripId)!.version,
    reason: "Fictional same journey",
  });
  const mapped = (await results([sourceRequest(second)])).items[0]!;
  expect(mapped.canonicalTripId).toBe(a.canonicalTripId);
  expect(mapped.assessmentBasis).not.toBe("current");
  expect(BigInt(mapped.resultRevision)).toBeGreaterThan(BigInt(b.resultRevision));
  const current = await modules.reconciliation!.get(director, merged.data.id);
  await modules.reconciliation!.reverse(director, merged.data.id, newId(), current.version, {
    primaryVersion: current.data.primaryVersion,
    secondaryVersion: current.data.secondaryVersion,
    reason: "Fictional independent journey",
  });
  const restored = (await results([sourceRequest(second)])).items[0]!;
  expect(restored.canonicalTripId).toBe(b.canonicalTripId);
  expect(BigInt(restored.resultRevision)).toBeGreaterThan(BigInt(mapped.resultRevision));
});

test("conditional requests reauthorize epochs/revocation; rate budget survives another instance without spending event credits", async () => {
  const p = await upload(),
    requested = sourceRequest(p),
    initial = (await results([requested])).items[0]!;
  const before = await domainState();
  await modules.telemetry!.revoke(driver, newId(), tokenId);
  const denied = await app.inject({
    method: "POST",
    url: `${prefix}/results`,
    headers: { authorization },
    payload: batch([{ ...requested, ifVersion: initial.version }]),
  });
  expect(denied.statusCode).toBe(401);
  expect(await domainState()).toEqual(before);
  const replacement = await issue();
  authorization = bearer(replacement.token);
  await clearAdmission();
  const companion = modules.telemetryCompanion!;
  const fixedNow = new Date(),
    rateTelemetry = createTelemetry(
      unit,
      modules.telemetry!.config,
      {
        identity: modules.identity,
        external: createExternalIdentities(unit, modules.identity),
        trips: modules.trips!,
      },
      () => fixedNow,
    );
  const first = createTelemetryCompanion({ telemetry: rateTelemetry, trips: modules.trips! });
  for (let n = 0; n < 10; n++) await first.capabilities(authorization, ip);
  const secondUnit = createUnitOfWork(guardedSettings());
  try {
    const identity = createIdentity(secondUnit, modules.identity.config),
      trips = createTrips(secondUnit, modules.trips!.config, { identity }),
      telemetry = createTelemetry(
        secondUnit,
        modules.telemetry!.config,
        { identity, external: createExternalIdentities(secondUnit, identity), trips },
        () => fixedNow,
      );
    const second = createTelemetryCompanion({ telemetry, trips });
    await expect(second.capabilities(authorization, ip)).rejects.toMatchObject({ statusCode: 429 });
  } finally {
    await secondUnit.close();
  }
  expect((await modules.telemetry!.connection(authorization, ip)).contract).toEqual({
    major: 1,
    minor: 0,
  });
  await unit.run((tx) =>
    unit
      .client(tx)
      .update(membership)
      .set({ accessEpoch: driver.accessEpoch + 1 })
      .where(eq(membership.userId, driver.userId)),
  );
  await expect(
    companion.results(authorization, ip, batch([{ ...requested, ifVersion: initial.version }])),
  ).rejects.toMatchObject({ statusCode: 403 });
});

test("real loopback HTTP returns the authenticated companion snapshot", async () => {
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("SYNTHETIC_HTTP_ADDRESS_REQUIRED");
  const response = await new Promise<{ status: number | undefined; body: string }>(
    (resolve, reject) => {
      const req = httpRequest(
        {
          host: "127.0.0.1",
          port: address.port,
          path: `${prefix}/qualification/ets2`,
          headers: { authorization },
        },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            body += chunk;
          });
          res.on("end", () => resolve({ status: res.statusCode, body }));
        },
      );
      req.setTimeout(10000, () => req.destroy(new Error("SYNTHETIC_HTTP_TIMEOUT")));
      req.on("error", reject);
      req.end();
    },
  );
  expect(response.status).toBe(200);
  expect(JSON.parse(response.body)).toMatchObject({ ownerId: driver.userId, state: "assigned" });
});

test("terminal qualification has no invented conditions, owner counters preserve integers beyond MAX_SAFE and exact source lookup uses its unique index", async () => {
  await modules.qualifications!.changeMember(director, driver.userId, "ets2", {
    levelId: structuralLevels.ets2[3],
    reason: "Fictional terminal placement",
  });
  const terminal = await modules.telemetryCompanion!.qualification(authorization, ip, "ets2");
  expect(terminal.progress).toMatchObject({
    terminal: true,
    nextLevel: null,
    conditions: { requiredTrips: null, requiredDistanceM: null },
    remainingTrips: null,
    remainingDistanceM: null,
    conditionsMet: false,
  });
  await unit.run((tx) =>
    unit
      .client(tx)
      .insert(tripOwnerRevisions)
      .values({ ownerId: driver.userId, revision: 9007199254740993n })
      .onDuplicateKeyUpdate({ set: { revision: 9007199254740993n } }),
  );
  const p = await upload();
  p.revision = Number.MAX_SAFE_INTEGER;
  await modules.telemetry!.receive(authorization, ip, p);
  const result = (await results([sourceRequest(p)])).items[0]!;
  expect(BigInt(result.resultRevision)).toBeGreaterThan(9007199254740993n);
  expect(result.latestSourceRevision).toBe(Number.MAX_SAFE_INTEGER);
  expect(result.assessment?.sourceRevision).toBe(Number.MAX_SAFE_INTEGER);
  const [plan] = await control.execute<RowDataPacket[]>(
    "EXPLAIN SELECT id FROM source_trips WHERE provider='ets2telemetry' AND game=? AND session_key=? AND trip_key=? AND owner_id=?",
    [
      p.source.game,
      Buffer.from(p.source.pluginSessionId),
      Buffer.from(p.source.tripId),
      driver.userId,
    ],
  );
  expect(plan[0]!.key).toBe("source_permanent_identity");
});

test("a conditional read waiting behind an identity epoch change is denied under current member locks without domain effects", async () => {
  const p = await upload(),
    requested = sourceRequest(p),
    version = (await results([requested])).items[0]!.version;
  const locked = deferred<void>(),
    release = deferred<void>(),
    entered = deferred<void>();
  const external = createExternalIdentities(unit, modules.identity);
  const telemetry = createTelemetry(unit, modules.telemetry!.config, {
    identity: modules.identity,
    trips: modules.trips!,
    external: {
      captureCredential: external.captureCredential,
      credentialEligible: async (tx, input) => {
        entered.resolve();
        return external.credentialEligible(tx, input);
      },
    },
  });
  const companion = createTelemetryCompanion({ telemetry, trips: modules.trips! });
  const before = await domainState();
  const changing = unit.run(async (tx) => {
    await modules.identity.qualificationContextInTransaction(tx, [driver.userId]);
    locked.resolve();
    await bounded(release.promise, "companion-epoch-release");
    await unit
      .client(tx)
      .update(membership)
      .set({ accessEpoch: driver.accessEpoch + 1 })
      .where(eq(membership.userId, driver.userId));
  });
  let waiting: Promise<C["ResultBatch"]> | undefined;
  try {
    await bounded(locked.promise, "companion-epoch-held");
    waiting = companion.results(authorization, ip, batch([{ ...requested, ifVersion: version }]));
    await bounded(entered.promise, "companion-epoch-authentication");
    release.resolve();
    await changing;
    await expect(waiting).rejects.toMatchObject({ statusCode: 403 });
    expect(await domainState()).toEqual(before);
  } finally {
    release.resolve();
    await changing.catch(() => undefined);
    await waiting?.catch(() => undefined);
  }
});

for (const kind of ["trailer", "cargo"] as const)
  test(`preview resolves current ${kind} code and classification after authentication waits for a catalog writer`, async () => {
    const catalog = createCatalogs(unit, catalogConfig(), { identity: modules.identity });
    const input = preview(),
      oldCode = `fictional_race_${kind}_old`,
      newCode = `fictional_race_${kind}_new`;
    const types = (await catalog.trailerTypes(director, { game: "ets2", limit: 100 })).items;
    const allowed = types[0]!,
      disallowed = types[1]!;
    const row = await catalog.create(
      director,
      kind === "trailer" ? "trailers" : "cargoes",
      newId(),
      {
        game: "ets2",
        code: oldCode,
        nameEn: `Fictional current ${kind}`,
        ...(kind === "trailer" ? { trailerTypeId: disallowed.id } : { adrClass: null }),
      },
    );
    if (kind === "trailer") {
      input.trailers = { complete: true, items: [{ code: oldCode, provenance: "attached" }] };
      await configure({ trailers: { mode: "selected", basis: "type", typeIds: [allowed.id] } });
    } else {
      input.cargo = { availability: "known", code: oldCode };
      await configure({ adr: { mode: "forbidden", classes: [] } });
    }
    const rule = kind === "trailer" ? "trailer_types" : "adr";
    const initial = await modules.telemetryCompanion!.preview(authorization, ip, input);
    expect(initial.rules.find((r) => r.rule === rule)?.result).toBe(
      kind === "trailer" ? "fail" : "pass",
    );
    const locked = deferred<void>(),
      release = deferred<void>(),
      authenticated = deferred<void>();
    const writer = createCatalogs(unit, catalogConfig(), {
      identity: {
        ...modules.identity,
        authorizeInTransaction: async (tx, actor, capability) => {
          const current = await modules.identity.authorizeInTransaction(tx, actor, capability);
          locked.resolve();
          await bounded(release.promise, "catalog-preview-writer-release");
          return current;
        },
      },
    });
    const external = createExternalIdentities(unit, modules.identity);
    const telemetry = createTelemetry(unit, modules.telemetry!.config, {
      identity: modules.identity,
      trips: modules.trips!,
      external: {
        captureCredential: external.captureCredential,
        credentialEligible: async (tx, credential) => {
          // authenticate has already read the token without a lock, establishing its RR snapshot.
          authenticated.resolve();
          return external.credentialEligible(tx, credential);
        },
      },
    });
    const companion = createTelemetryCompanion({
      telemetry,
      trips: modules.trips!,
      qualifications: modules.qualifications!,
      catalogs: catalog,
    });
    const changing = writer.patch(
      director,
      kind === "trailer" ? "trailers" : "cargoes",
      row.id,
      newId(),
      kind === "trailer" ? { code: newCode, trailerTypeId: allowed.id } : { adrClass: "1" },
    );
    let waiting: Promise<C["Preview"]> | undefined;
    try {
      await bounded(locked.promise, "catalog-preview-company-held");
      waiting = companion.preview(authorization, ip, input);
      await bounded(authenticated.promise, "catalog-preview-auth-snapshot");
      release.resolve();
      await changing;
      const current = await waiting;
      expect(current.outcome).toBe(kind === "trailer" ? "unknown" : "fail");
      expect(current.rules.find((r) => r.rule === rule)).toMatchObject({
        result: kind === "trailer" ? "unknown" : "fail",
        ...(kind === "trailer" ? { observedIds: [] } : { observed: "1" }),
      });
      expect(await modules.telemetryCompanion!.preview(authorization, ip, input)).toMatchObject({
        outcome: current.outcome,
        rules: current.rules,
      });
    } finally {
      release.resolve();
      await changing.catch(() => undefined);
      await waiting?.catch(() => undefined);
    }
  });

test("safe HTTP failures retain no-store, Retry-After and the companion error shape", async () => {
  const missing = await app.inject({ url: `${prefix}/unsupported`, headers: { authorization } });
  expect(missing.statusCode).toBe(404);
  expect(missing.headers["cache-control"]).toBe("no-store");
  expect(missing.json()).toMatchObject({
    error: { code: "NOT_FOUND", retryable: false },
    requestId: expect.any(String),
  });
  await clearAdmission();
  for (let i = 0; i < 10; i++) await modules.telemetryCompanion!.capabilities(authorization, ip);
  const limited = await app.inject({ url: `${prefix}/capabilities`, headers: { authorization } });
  expect(limited.statusCode).toBe(429);
  expect(limited.headers["retry-after"]).toBeDefined();
  expect(limited.headers["cache-control"]).toBe("no-store");
  await clearAdmission();
  const failing = await createApp({
    ...modules,
    telemetryCompanion: {
      ...modules.telemetryCompanion!,
      capabilities: async () => {
        throw new Error("Fictional private diagnostics must not escape");
      },
    },
    checkReadiness: async () => true,
  });
  try {
    const unavailable = await failing.inject({
      url: `${prefix}/capabilities`,
      headers: { authorization },
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.headers["retry-after"]).toBe("1");
    expect(unavailable.headers["cache-control"]).toBe("no-store");
    expect(unavailable.json()).toMatchObject({
      error: { code: "TEMPORARILY_UNAVAILABLE", retryable: true },
    });
    expect(unavailable.body).not.toContain("diagnostics");
  } finally {
    await failing.close();
  }
});

test("event edits invalidate a decided associated owner without an attendance row before queued catch-up", async () => {
  const time = Date.now(),
    definition: S["EventInput"] = {
      title: "Fictional unconfirmed convoy",
      description: "Fictional event",
      game: "ets2",
      server: "Fictional",
      organizer: "Fictional company",
      meetingLocation: "Fictional yard",
      route: "Fictional route",
      meetingAt: new Date(time + 1800000).toISOString(),
      startsAt: new Date(time + 3600000).toISOString(),
      endsAt: null,
      visibility: "members",
      originCityId: null,
      destinationCityId: null,
      prescribedCargoId: null,
      prescribedMassKg: null,
      prescribedTrailerTypeId: null,
    };
  const created = await modules.events!.create(director, newId(), definition),
    eventId = created.data.event.id,
    p = await upload();
  await modules.telemetry!.receive(authorization, ip, p);
  const received = (await results([sourceRequest(p)])).items[0]!,
    row = await modules.trips!.detail(driver, received.canonicalTripId!);
  if (row.view !== "private") throw new Error("SYNTHETIC_OWN_PRIVATE_TRIP_REQUIRED");
  const association = await modules.tripDecisions!.associate(
    driver,
    received.canonicalTripId!,
    newId(),
    row.summary.version,
    { eventId },
  );
  const proposal = await modules.tripDecisions!.getProposal(
    director,
    received.canonicalTripId!,
    association.data.id,
  );
  await modules.tripDecisions!.proposalDecision(
    director,
    received.canonicalTripId!,
    proposal.data.id,
    newId(),
    proposal.version,
    {
      decision: "approve",
      reviewedRevisionId: proposal.data.revisionId,
      reason: "Fictional ordinary event association",
    },
  );
  const before = (await results([sourceRequest(p)])).items[0]!;
  expect(before.assessmentBasis).toBe("current");
  const [attendance] = await control.execute<RowDataPacket[]>(
    "SELECT COUNT(*) n FROM event_attendances WHERE event_id=? AND member_id=?",
    [eventId, driver.userId],
  );
  expect(String(attendance[0]!.n)).toBe("0");
  await modules.events!.update(director, eventId, newId(), created.version, {
    ...definition,
    title: "Fictional edited convoy",
  });
  const domain = await domainState(),
    changed = (await results([{ ...sourceRequest(p), ifVersion: before.version }])).items[0]!;
  expect(changed).toMatchObject({
    unchanged: false,
    assessmentPending: true,
    assessmentBasis: "predecessor",
  });
  expect(BigInt(changed.resultRevision)).toBeGreaterThan(BigInt(before.resultRevision));
  expect(changed.assessment?.decisionId).toBe(before.assessment?.decisionId);
  expect(await domainState()).toEqual(domain);
});

test("real HTTP oversized results give a permanent split hint and one full immutable assessment remains retrievable", async () => {
  const seeded = await seedCatalog(unit, "ets2", {
    trailers: Array.from({ length: 99 }, (_, i) => ({
      code: `fixture_budget_${i}`,
      nameEn: "F".repeat(256),
      nameRu: "Ф".repeat(256),
    })),
  });
  const box = await unit.run((tx) =>
    modules.catalogs!.resolveInTransaction(tx, {
      game: "ets2",
      kind: "trailer",
      code: "fixture_box",
    }),
  );
  if (box.status !== "resolved") throw new Error("SYNTHETIC_TRAILER_REQUIRED");
  await configure({ trailers: { mode: "selected", typeIds: [box.id, ...seeded.ids.values()] } });
  const p = await upload();
  await modules.telemetry!.receive(authorization, ip, p);
  await clearAdmission();
  const expected = (await results([sourceRequest(p)])).items[0]!;
  const before = await domainState();
  const oversized = await httpResults(Array(25).fill(sourceRequest(p)));
  expect(oversized.status).toBe(422);
  expect(Buffer.byteLength(oversized.body)).toBeLessThan(1048576);
  expect(oversized.headers["cache-control"]).toBe("no-store");
  expect(oversized.headers["retry-after"]).toBeUndefined();
  expect(JSON.parse(oversized.body)).toEqual({
    error: { code: "RESULT_BATCH_TOO_LARGE", retryable: false },
    requestId: expect.stringMatching(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/),
  });
  expect(await domainState()).toEqual(before);
  const single = await httpResults([sourceRequest(p)]);
  expect(single.status).toBe(200);
  expect(single.headers["cache-control"]).toBe("no-store");
  expect(single.headers["retry-after"]).toBeUndefined();
  expect(Buffer.byteLength(single.body)).toBeLessThan(1048576);
  const reply = JSON.parse(single.body) as C["ResultBatch"];
  expect(reply.items).toHaveLength(1);
  const actual = reply.items[0]!;
  expect(actual).toMatchObject({
    unchanged: false,
    receipt: "received",
    state: "decided",
    assessmentBasis: "current",
  });
  expect(immutableAssessment(actual.assessment)).toEqual(immutableAssessment(expected.assessment));
  expect(actual.credit).toEqual(expected.credit);
  expect(actual.assessment!.trailerDisplay).toHaveLength(100);
  const labels = (assessment: C["Assessment"]) =>
    assessment.trailerDisplay.map(({ asOf: _asOf, ...label }) => label);
  expect(labels(actual.assessment!)).toEqual(labels(expected.assessment!));
  expect(actual.assessment!.limits!.trailers.typeIds).toHaveLength(100);
  expect(actual.assessment!.rules).toHaveLength(5);
  expect(await domainState()).toEqual(before);
});

test("both games keep exact source identities and independent credit while sharing the owner ordering fence", async () => {
  const ets = await upload();
  await modules.telemetry!.receive(authorization, ip, ets);
  const etsResult = (await results([sourceRequest(ets)])).items[0]!,
    before = await modules.telemetryCompanion!.qualification(authorization, ip, "ets2");
  const ats = structuredClone(ets);
  ats.source.game = "ats";
  ats.eventId = newId();
  await modules.telemetry!.receive(authorization, ip, ats);
  const atsResult = (await results([sourceRequest(ats)])).items[0]!;
  expect(atsResult).toMatchObject({
    receipt: "received",
    companyDecision: "accepted",
    assessmentBasis: "current",
    assessment: {
      assignmentId: expect.any(String),
      level: { id: structuralLevels.ats[0] },
      assessedSource: { game: "ats" },
    },
    credit: { credited: true },
  });
  expect(atsResult.canonicalTripId).not.toBe(etsResult.canonicalTripId);
  const after = await modules.telemetryCompanion!.qualification(authorization, ip, "ets2"),
    atsQualification = await modules.telemetryCompanion!.qualification(authorization, ip, "ats");
  expect(after.progress?.creditedTrips).toBe(1);
  expect(atsQualification.progress?.creditedTrips).toBe(1);
  expect(BigInt(after.progressRevision)).toBeGreaterThan(BigInt(before.progressRevision));
  expect(atsQualification.progressRevision).toBe(after.progressRevision);
  await clearAdmission();
  const input = preview();
  input.game = "ats";
  expect(await modules.telemetryCompanion!.preview(authorization, ip, input)).toMatchObject({
    assignment: { level: { id: structuralLevels.ats[0] } },
    provisional: true,
    outcome: "pass",
  });
});

for (const game of ["ets2", "ats"] as const) {
  test(`${game} semantic preview uses exact body classification, explicit unknowns and immutable saved mappings`, async () => {
    const catalog = modules.catalogs!;
    const types = (await catalog.trailerTypes(director, { game, limit: 100 })).items;
    const allowed = types.find((row) => row.code === "dryvan")!,
      wrong = types.find((row) => row.id !== allowed.id)!;
    const variants: S["CatalogItem"][] = [];
    for (const classification of [allowed.id, wrong.id, null])
      variants.push(
        await catalog.create(director, "trailers", newId(), {
          game,
          code: `fixture_semantic_${newId()}`,
          nameEn: "Fictional semantic body",
          nameRu: "Вымышленный кузов",
          trailerTypeId: classification,
        }),
      );
    await configure(
      { trailers: { basis: "type", mode: "selected", typeIds: [allowed.id] } },
      undefined,
      game,
    );
    const body = preview();
    body.game = game;
    body.actualDistance.metres = "123400";
    body.actualDistance.final = true;
    body.hardMode.final = true;
    const assess = async (index: number) => {
      body.requestId = newId();
      body.trailers = {
        complete: true,
        items: [{ code: variants[index]!.code, provenance: "attached" }],
      };
      return modules.telemetryCompanion!.preview(authorization, ip, body);
    };
    const pass = await assess(0);
    expect(pass.assignment!.limits.trailers).toMatchObject({
      basis: "type",
      mode: "selected",
      typeIds: [allowed.id],
    });
    expect(pass.outcome).toBe("pass");
    expect(pass.trailerDisplay).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: allowed.id,
          identityKind: "type",
          code: allowed.code,
          nameEn: allowed.nameEn,
          groupCode: null,
          classification: { state: "not_applicable" },
        }),
        expect.objectContaining({
          id: variants[0]!.id,
          identityKind: "variant",
          classification: { state: "classified", typeId: allowed.id },
        }),
      ]),
    );
    expect((await assess(1)).outcome).toBe("fail");
    expect((await assess(2)).outcome).toBe("unknown");
    body.requestId = newId();
    body.trailers = {
      complete: false,
      items: [
        { code: variants[1]!.code, provenance: "previous" },
        { code: variants[2]!.code, provenance: "attached" },
      ],
    };
    expect((await modules.telemetryCompanion!.preview(authorization, ip, body)).outcome).toBe(
      "fail",
    );
    const p = await upload();
    p.source.game = game;
    p.snapshot.trailers.items[0]!.bodyType = { available: true, value: variants[0]!.code };
    await modules.telemetry!.receive(authorization, ip, p);
    await clearAdmission();
    const saved = (await results([sourceRequest(p)])).items[0]!;
    expect(saved).toMatchObject({
      state: "decided",
      assessmentBasis: "current",
      assessment: {
        outcome: "pass",
        limits: { trailers: { basis: "type" } },
        trailerComparison: {
          basis: "type",
          entries: expect.arrayContaining([
            { id: allowed.id, comparisonIdentity: `type:${allowed.id}` },
            { id: variants[0]!.id, comparisonIdentity: `type:${allowed.id}` },
          ]),
        },
      },
    });
    const immutable = immutableAssessment(saved.assessment),
      domain = await domainState();
    await catalog.patch(director, "trailers", variants[0]!.id, newId(), {
      trailerTypeId: wrong.id,
    });
    const changed = (await results([{ ...sourceRequest(p), ifVersion: saved.version }])).items[0]!;
    expect(changed.resultRevision).toBe(saved.resultRevision);
    expect(changed.version).not.toBe(saved.version);
    expect(changed.unchanged).toBe(false);
    expect(immutableAssessment(changed.assessment)).toEqual(immutable);
    expect(changed.credit).toEqual(saved.credit);
    expect(changed.assessmentPending).toBe(false);
    body.requestId = newId();
    body.trailers = {
      complete: true,
      items: [{ code: variants[0]!.code, provenance: "attached" }],
    };
    expect((await modules.telemetryCompanion!.preview(authorization, ip, body)).outcome).toBe(
      "fail",
    );
    expect(
      Date.parse(pass.applicability.expiresAt) - Date.parse(pass.evaluatedAt),
    ).toBeLessThanOrEqual(5000);
    expect(await domainState()).toEqual(domain);
    await configure({}, undefined, game);
  });
}

test("presentation A/B/A revalidates historical owner zero without domain writes, replay/unchanged-import/rollback churn or foreign disclosure", async () => {
  const catalog = modules.catalogs!,
    box = await unit.run((tx) =>
      catalog.resolveInTransaction(tx, { game: "ets2", kind: "trailer", code: "fixture_box" }),
    );
  if (box.status !== "resolved") throw new Error("SYNTHETIC_BODY_REQUIRED");
  const type = (await catalog.trailerTypes(director, { game: "ets2", limit: 100 })).items.find(
    (row) => row.code === "dryvan",
  )!;
  const p = await upload();
  await modules.telemetry!.receive(authorization, ip, p);
  await catalog.patch(director, "trailers", box.id, newId(), {
    nameEn: "Fictional label A",
    commonTrailer: "fictional.model.a",
    trailerTypeId: null,
  });
  // Model an upgraded historical owner whose published decisions predate the new ordering table.
  await control.execute("DELETE FROM trip_owner_revisions WHERE owner_id=?", [driver.userId]);
  let observed = Date.parse("2026-11-18T12:00:00.000Z");
  const companion = createTelemetryCompanion(
    {
      telemetry: modules.telemetry!,
      trips: modules.trips!,
      qualifications: modules.qualifications!,
      catalogs: catalog,
      events: modules.events!,
      assessments: createCompanionAssessments(unit, modules.events!),
    },
    () => new Date(observed),
  );
  const read = async (ifVersion?: string) => {
    const input = batch([{ ...sourceRequest(p), ...(ifVersion ? { ifVersion } : {}) }]);
    const reply = await companion.results(authorization, ip, input);
    expect(reply.requestId).toBe(input.requestId);
    return reply.items[0]!;
  };
  const a = await read(),
    domain = await domainState();
  expect(a.resultRevision).toBe("0");
  const decision = async () =>
    (
      await control.execute<RowDataPacket[]>(
        "SELECT CAST(qualification_snapshot AS CHAR) snapshot FROM trip_decisions WHERE id=?",
        [a.assessment!.decisionId],
      )
    )[0][0]!.snapshot;
  const saved = await decision(),
    keyB = newId(),
    change = {
      nameEn: "Fictional label B",
      commonTrailer: "fictional.model.b",
      trailerTypeId: type.id,
    };
  await catalog.patch(director, "trailers", box.id, keyB, change);
  observed += 1000;
  const b = await read(a.version);
  expect(b.unchanged).toBe(false);
  expect(b.resultRevision).toBe(a.resultRevision);
  expect(b.version).not.toBe(a.version);
  expect(b.assessment!.trailerDisplay).toEqual([
    expect.objectContaining({
      nameEn: "Fictional label B",
      groupCode: "fictional.model.b",
      classification: { state: "classified", typeId: type.id },
    }),
  ]);
  expect(immutableAssessment(b.assessment)).toEqual(immutableAssessment(a.assessment));
  expect(b.credit).toEqual(a.credit);
  expect(b.assessmentPending).toBe(a.assessmentPending);
  observed += 1000;
  const matched = await read(b.version);
  expect(matched).toMatchObject({
    unchanged: true,
    assessment: null,
    credit: null,
    version: b.version,
  });
  await catalog.patch(director, "trailers", box.id, keyB, change);
  observed += 1000;
  expect((await read(b.version)).unchanged).toBe(true);
  const bytes = Buffer.from("game,code,trailer_type_code\nets2,fixture_box,dryvan\n");
  const plan = await catalog.previewImport(director, "trailers", bytes);
  expect(plan).toMatchObject({ errors: 0, changed: 0, unchanged: 1 });
  await catalog.applyImport(director, "trailers", bytes, newId(), plan.token!);
  observed += 1000;
  expect((await read(b.version)).unchanged).toBe(true);
  const marker = new Error("SYNTHETIC_CATALOG_ROLLBACK");
  await expect(
    unit.run(async (tx) => {
      const scoped = {
        run: <T>(command: (tx: import("@vtc/db").TxContext) => Promise<T>) => command(tx),
        client: unit.client,
        close: async () => {},
      };
      await createCatalogs(scoped, catalog.config, { identity: modules.identity }).patch(
        director,
        "trailers",
        box.id,
        newId(),
        { nameEn: "Fictional rollback label" },
      );
      throw marker;
    }),
  ).rejects.toBe(marker);
  observed += 1000;
  expect((await read(b.version)).unchanged).toBe(true);
  await catalog.patch(director, "trailers", box.id, newId(), {
    nameEn: "Fictional label A",
    commonTrailer: "fictional.model.a",
    trailerTypeId: null,
  });
  observed += 1000;
  const again = await read(b.version);
  expect(again.unchanged).toBe(false);
  expect(again.version).toBe(a.version);
  expect(again.resultRevision).toBe("0");
  expect(immutableAssessment(again.assessment)).toEqual(immutableAssessment(a.assessment));
  observed += 1000;
  expect((await read(again.version)).unchanged).toBe(true);
  expect(await decision()).toBe(saved);
  expect(await domainState()).toEqual(domain);
  await clearAdmission();
  const foreign = await member(),
    foreignToken = await issue(foreign);
  const foreignReply = (await results([sourceRequest(p)], bearer(foreignToken.token))).items[0]!;
  const missing = (
    await results([
      { ...sourceRequest(p), source: { ...sourceRequest(p).source, tripId: newId() } },
    ])
  ).items[0]!;
  const neutral = ({ source: _source, version: _version, ...rest }: C["Result"]) => rest;
  expect(neutral(foreignReply)).toEqual(neutral(missing));
});

test("legacy common-model allowances remain literal after semantic classification and retain their saved map", async () => {
  const catalog = modules.catalogs!,
    types = (await catalog.trailerTypes(director, { game: "ets2", limit: 100 })).items;
  const allowed = await catalog.create(director, "trailers", newId(), {
    game: "ets2",
    code: `fixture_legacy_a_${newId()}`,
    nameEn: "Fictional legacy A",
    commonTrailer: "fictional.legacy",
    trailerTypeId: types[0]!.id,
  });
  const peer = await catalog.create(director, "trailers", newId(), {
    game: "ets2",
    code: `fixture_legacy_b_${newId()}`,
    nameEn: "Fictional legacy B",
    commonTrailer: "fictional.legacy",
    trailerTypeId: types[1]!.id,
  });
  const other = await catalog.create(director, "trailers", newId(), {
    game: "ets2",
    code: `fixture_legacy_c_${newId()}`,
    nameEn: "Fictional legacy C",
    commonTrailer: "fictional.other",
    trailerTypeId: types[0]!.id,
  });
  await configure({ trailers: { basis: "variant", mode: "selected", typeIds: [allowed.id] } });
  const body = preview();
  body.actualDistance.metres = "123400";
  body.actualDistance.final = true;
  body.hardMode.final = true;
  const check = async (code: string) => {
    body.requestId = newId();
    body.trailers = { complete: true, items: [{ code, provenance: "attached" }] };
    return modules.telemetryCompanion!.preview(authorization, ip, body);
  };
  expect((await check(peer.code)).outcome).toBe("pass");
  expect((await check(other.code)).outcome).toBe("fail");
  const p = await upload();
  p.snapshot.trailers.items[0]!.bodyType = { available: true, value: peer.code };
  await modules.telemetry!.receive(authorization, ip, p);
  const saved = (await results([sourceRequest(p)])).items[0]!;
  expect(saved.assessment!.trailerComparison).toEqual({
    basis: "variant",
    entries: [allowed.id, peer.id].sort().map((id) => ({
      id,
      comparisonIdentity: `common:ets2:${Buffer.from("fictional.legacy").toString("hex")}`,
    })),
  });
  await catalog.patch(director, "trailers", peer.id, newId(), {
    commonTrailer: "fictional.changed",
    trailerTypeId: types[0]!.id,
  });
  expect((await check(peer.code)).outcome).toBe("fail");
  const changed = (await results([{ ...sourceRequest(p), ifVersion: saved.version }])).items[0]!;
  expect(immutableAssessment(changed.assessment)).toEqual(immutableAssessment(saved.assessment));
  expect(changed.credit).toEqual(saved.credit);
  expect(changed.assessmentPending).toBe(false);
  expect(changed.resultRevision).toBe(saved.resultRevision);
});

test("typed manual and derived facts retain identity kind, labels and saved comparisons through reconciliation", async () => {
  const catalog = modules.catalogs!,
    type = (await catalog.trailerTypes(director, { game: "ets2", limit: 100 })).items.find(
      (row) => row.code === "dryvan",
    )!;
  const variant = await catalog.create(director, "trailers", newId(), {
    game: "ets2",
    code: `fixture_typed_material_${newId()}`,
    nameEn: "Fictional typed material",
    trailerTypeId: type.id,
  });
  await configure({ trailers: { basis: "type", mode: "selected", typeIds: [type.id] } });
  const p = await upload();
  p.snapshot.trailers.items[0]!.bodyType = { available: true, value: variant.code };
  await modules.telemetry!.receive(authorization, ip, p);
  const original = (await results([sourceRequest(p)])).items[0]!;
  const dispatcher = await member([], ["dispatcher"]),
    row = await modules.trips!.detail(driver, original.canonicalTripId!);
  if (row.view !== "private") throw new Error("SYNTHETIC_PRIVATE_TRIP_REQUIRED");
  const proposed = await modules.tripDecisions!.propose(
    dispatcher,
    original.canonicalTripId!,
    newId(),
    row.summary.version,
    { reason: "Fictional semantic correction", evidenceIds: [], trailerTypeId: type.id },
  );
  const proposal = await modules.tripDecisions!.getProposal(
    director,
    original.canonicalTripId!,
    proposed.data.id,
  );
  await modules.tripDecisions!.proposalDecision(
    director,
    original.canonicalTripId!,
    proposal.data.id,
    newId(),
    proposal.version,
    {
      decision: "approve",
      reviewedRevisionId: proposal.data.revisionId,
      reason: "Fictional typed correction approval",
    },
  );
  const derived = (await results([sourceRequest(p)])).items[0]!;
  expect(derived.assessment!.materialIdentity).not.toBe(original.assessment!.materialIdentity);
  expect(derived.assessment!.trailerDisplay).toEqual([
    expect.objectContaining({
      id: type.id,
      identityKind: "type",
      code: type.code,
      groupCode: null,
      classification: { state: "not_applicable" },
    }),
  ]);
  const [derivedRows] = await control.execute<RowDataPacket[]>(
    "SELECT trailer_id,CAST(trailer_type_id AS CHAR) type FROM trip_fact_trailers WHERE trip_fact_id=?",
    [derived.assessment!.factId],
  );
  expect(derivedRows).toEqual([expect.objectContaining({ trailer_id: null, type: type.id })]);
  const evidenceId = newId(),
    instant = new Date().toISOString();
  await unit.run((tx) =>
    unit
      .client(tx)
      .insert(manualEvidence)
      .values({
        id: evidenceId,
        ownerId: driver.userId,
        state: "ready",
        generation: newId(),
        originalName: "fictional.png",
        contentType: "image/png",
        byteLength: 1,
        sha256: randomBytes(32),
        fingerprint: randomBytes(32),
        createdAt: instant,
        updatedAt: instant,
        nextCheckAt: instant,
      }),
  );
  const pin = async (kind: "city" | "cargo", code: string) => {
    const found = await unit.run((tx) =>
      catalog.resolveInTransaction(tx, { game: "ets2", kind, code }),
    );
    if (found.status !== "resolved") throw new Error("SYNTHETIC_CATALOG_REQUIRED");
    return { status: "resolved" as const, entityId: found.id };
  };
  const manual = await modules.manualReports!.submitReport(driver, newId(), {
    fields: {
      game: "ets2",
      origin: await pin("city", "fixture_north"),
      destination: await pin("city", "fixture_south"),
      cargo: await pin("cargo", "fixture_crates"),
      trailerType: { status: "resolved", entityId: type.id },
      cargoMassKg: "18000",
      actualDistanceM: "123400",
      evidenceIds: [evidenceId],
      startedAt: new Date(p.snapshot.start.utcMs!).toISOString(),
      completedAt: new Date(p.snapshot.end!.utcMs!).toISOString(),
    },
  });
  const review = await modules.tripDecisions!.review(director, manual.tripId);
  await modules.tripDecisions!.decide(director, manual.tripId, newId(), review.version, {
    decision: "accept",
    reviewedRevisionId: review.data.trip.manualRevision!.id,
    factRevisionId: review.data.factRevisionId,
    proposalId: null,
    reason: "Fictional typed manual report",
  });
  const [messages] = await control.execute<RowDataPacket[]>(
    "SELECT CAST(message_id AS CHAR) id FROM trip_facts WHERE id=(SELECT current_fact_id FROM trips WHERE id=?)",
    [manual.tripId],
  );
  const readback = await unit.run((tx) =>
    modules.trips!.sourceEvidenceInTransaction(tx, messages[0]!.id),
  );
  expect(readback?.trailers.items[0]).toMatchObject({
    status: "known",
    value: { entityId: type.id, identityKind: "type" },
  });
  const states = await unit.run((tx) =>
    modules.trips!.statesInTransaction(tx, [manual.tripId, original.canonicalTripId!]),
  );
  await modules.reconciliation!.merge(director, newId(), {
    primaryTripId: manual.tripId,
    secondaryTripId: original.canonicalTripId!,
    primaryVersion: states.find((value) => value.id === manual.tripId)!.version,
    secondaryVersion: states.find((value) => value.id === original.canonicalTripId)!.version,
    reason: "Fictional same typed journey",
  });
  await clearAdmission();
  const merged = (await results([sourceRequest(p)])).items[0]!;
  expect(merged.canonicalTripId).toBe(manual.tripId);
  expect(merged.assessmentBasis).toBe("predecessor");
  expect(merged.assessment!.limits!.trailers.basis).toBe("type");
  expect(merged.assessment!.rules.find((value) => value.rule === "trailer_types")).toMatchObject({
    observedIds: [type.id],
  });
  expect(merged.assessment!.trailerDisplay).toEqual([
    expect.objectContaining({ id: type.id, identityKind: "type", nameEn: type.nameEn }),
  ]);
  const retained = immutableAssessment(merged.assessment);
  const wire = await httpResults([sourceRequest(p)]);
  expect(wire.status).toBe(200);
  const wireItem = (JSON.parse(wire.body) as C["ResultBatch"]).items[0]!;
  expect(wireItem.requestedSourceMessageId).toBe(original.requestedSourceMessageId);
  expect(wireItem.assessmentBasis).toBe("predecessor");
  expect(wireItem.assessment!.assessedSource).toBeNull();
  expect(wireItem.assessment!.sourceMessageId).not.toBe(wireItem.requestedSourceMessageId);
  expect(immutableAssessment(wireItem.assessment)).toEqual(retained);
  await catalog.patch(director, "trailers", variant.id, newId(), { trailerTypeId: null });
  expect(immutableAssessment((await results([sourceRequest(p)])).items[0]!.assessment)).toEqual(
    retained,
  );
});

test("real owning UInt32 promotion conditions and a widened exact distance SUM serialize without losing precision", async () => {
  await configure({}, { requiredTrips: 4294967295, requiredDistanceM: null });
  const dispatcher = await member([], ["dispatcher"]),
    maximum = "99999999999999999999.999999999999999999";
  for (let i = 0; i < 2; i++) {
    const p = await upload();
    await modules.telemetry!.receive(authorization, ip, p);
    const result = (await results([sourceRequest(p)])).items[0]!,
      row = await modules.trips!.detail(driver, result.canonicalTripId!);
    if (row.view !== "private") throw new Error("SYNTHETIC_PRIVATE_TRIP_REQUIRED");
    const proposed = await modules.tripDecisions!.propose(
      dispatcher,
      result.canonicalTripId!,
      newId(),
      row.summary.version,
      { reason: "Fictional exact-distance correction", evidenceIds: [], actualDistanceM: maximum },
    );
    const proposal = await modules.tripDecisions!.getProposal(
      director,
      result.canonicalTripId!,
      proposed.data.id,
    );
    await modules.tripDecisions!.proposalDecision(
      director,
      result.canonicalTripId!,
      proposal.data.id,
      newId(),
      proposal.version,
      {
        decision: "approve",
        reviewedRevisionId: proposal.data.revisionId,
        reason: "Fictional exact-distance approval",
      },
    );
  }
  const before = await domainState();
  const response = await app.inject({
    url: `${prefix}/qualification/ets2`,
    headers: { authorization },
  });
  expect(response.statusCode).toBe(200);
  expect(response.json().progress).toMatchObject({
    creditedTrips: 2,
    creditedDistanceM: "199999999999999999999.999999999999999998",
    conditions: { requiredTrips: 4294967295, requiredDistanceM: null },
    remainingTrips: 4294967293,
    remainingDistanceM: null,
    conditionsMet: false,
  });
  expect(await domainState()).toEqual(before);
});
