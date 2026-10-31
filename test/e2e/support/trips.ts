import { createHmac, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { components } from "@vtc/contracts";
import { createUnitOfWork } from "@vtc/db";
import {
  createQualificationInitialization,
  structuralLevels,
} from "../../../apps/api/src/modules/qualifications/initialization.ts";
import type { Telemetry } from "../../../apps/api/src/modules/sources/contracts/telemetry.ts";
import { runPass } from "../../../apps/api/src/platform/jobs/runner.ts";
import { composeIdentity } from "../../../apps/api/src/use-cases/identity-messaging.ts";
import { artifact, entity } from "../../fixtures/catalogs/synthetic.ts";
import { guardedSettings } from "../../persistence/support.ts";
import { telemetryFixture } from "../../support/builders.ts";
import { completeCatalogImport } from "../../support/catalog-import-fixture.ts";
import { guardedAllocation } from "../../support/environment.ts";
import { accountSecret, origin } from "./account.ts";
import { browserTripConfig } from "./trip-config.ts";
export async function tripBrowserFixture() {
  const unit = createUnitOfWork(guardedSettings()),
    cfg = browserTripConfig(),
    catalogConfig = {
      production: false,
      synthetic: true,
      cursorKey: createHmac("sha256", guardedAllocation().token)
        .update("browser-trip-catalog")
        .digest("hex"),
      maxFileBytes: 8388608,
      artifactTtlMs: 86400000,
      policyRevision: 1,
      evidence: [],
    };
  const composed = composeIdentity(
    unit,
    { secret: accountSecret("identity"), origin, production: false },
    undefined,
    undefined,
    true,
    catalogConfig,
    cfg.trips,
    undefined,
    cfg.manual,
    cfg.qualifications,
    cfg.events,
    cfg.reconciliation,
    cfg.decisions,
    undefined,
    cfg.notifications,
  );
  const identity = composed.identity,
    now = new Date().toISOString();
  const password = createHmac("sha256", guardedAllocation().token)
    .update(`trip-browser-${randomUUID()}`)
    .digest("base64url");
  const email = `${randomUUID()}@example.invalid`,
    userId = randomUUID();
  try {
    const credential = await identity.prepareCredential(password);
    await unit.run(async (tx) => {
      await identity.insertWithCredential(tx, {
        userId,
        email,
        name: "Fictional Trip Browser Driver",
        roles: ["driver"],
        ...credential,
      });
      await createQualificationInitialization(unit).initialize(tx, {
        userId,
        games: ["ets2"],
        assignedAt: new Date(Date.now() - 86400000).toISOString(),
      });
    });
    const staffPassword = createHmac("sha256", guardedAllocation().token)
      .update("browser-identity-password")
      .digest("base64url");
    const staffLogin = await identity.login("browser@example.invalid", staffPassword),
      staff = await identity.authenticate(
        new Headers({ cookie: staffLogin.cookies.map((v) => v.split(";", 1)[0]).join("; ") }),
      );
    const login = await identity.login(email, password),
      cookie = login.cookies.map((v) => v.split(";", 1)[0]).join("; "),
      author = await identity.authenticate(new Headers({ cookie }));
    const catalogs = composed.catalogs,
      qualifications = composed.qualifications,
      trips = composed.trips;
    if (!catalogs || !qualifications || !trips) throw Error("TRIP_BROWSER_COMPOSITION_MISSING");
    const tripStore = trips.storeInTransaction;
    const source = artifact(
      "ets2",
      [
        entity("fixture_north"),
        entity("fixture_south"),
        entity("fixture_crates", { kind: "cargo" }),
        entity("fixture_trailer", { kind: "trailer_type" }),
      ].map((e) => ({
        ...e,
        mapNamespace: "official",
        mappings: [{ provider: "ets2telemetry", sourceId: e.key }],
      })),
    );
    const uploaded = await catalogs.upload(
        staff,
        randomUUID(),
        Buffer.from(JSON.stringify(source)),
      ),
      operation = await catalogs.import(staff, randomUUID(), {
        artifactId: uploaded.id,
        sha256: uploaded.sha256,
        game: "ets2",
      });
    const complete = await completeCatalogImport(
      operation.id,
      {
        read: (id) => catalogs.operation(staff, id),
        pass: (signal) => runPass(composed.jobsQueue, signal),
      },
      {
        deadlineAt: performance.now() + 25000,
        observe: (record) => console.log(JSON.stringify(record)),
      },
    );
    const revisionId = complete.resultId;
    const revision = await catalogs.detail(staff, revisionId);
    await catalogs.publish(staff, revisionId, randomUUID(), revision.version, {
      expectedPublicationVersion: revision.publicationVersion,
      reason: "Synthetic reviewed trip browser catalog",
    });
    const ids: Record<string, string> = {};
    for (const kind of ["city", "cargo", "trailer_type"]) {
      for (const e of (await catalogs.entities(staff, { revisionId, kind, locale: "en" })).items)
        ids[e.display.label.replace("Fictional ", "")] = e.id;
    }
    const level = (await qualifications.levels(staff, "ets2")).items.find(
      (v) => v.id === structuralLevels.ets2[0],
    );
    if (!level) throw Error("TRIP_BROWSER_LEVEL_MISSING");
    await qualifications.publish(staff, level.id, randomUUID(), level.version, {
      rules: [{ type: "max_mass", maxKg: "20000" }],
      requiredTrips: 1,
      requiredDistanceM: "100",
      reason: "Synthetic browser fixture, not production settings",
    });
    const supportedStart = Date.now();
    const pin = (name: string): components["schemas"]["ManualResolvedSelection"] => ({
      status: "resolved",
      entityId: ids[name] as string,
      catalogRevisionId: revisionId,
    });
    const fields = {
      game: "ets2" as const,
      origin: pin("fixture_north"),
      destination: pin("fixture_south"),
      cargo: pin("fixture_crates"),
      trailerType: pin("fixture_trailer"),
      cargoMassKg: "18000",
      actualDistanceM: "123400",
      evidenceIds: [] as string[],
    };
    async function telemetry(
      target?: { tripId: string; expectedVersion: number },
      kind: "started" | "completed" = "completed",
    ) {
      const p = telemetryFixture(kind) as unknown as Telemetry;
      p.eventId = randomUUID();
      p.source.tripId = randomUUID();
      p.source.pluginSessionId = randomUUID();
      p.snapshot.context.gameBuild = { available: true, value: "synthetic-build" };
      p.snapshot.start.utcMs = Math.max(supportedStart, Date.now() - 60000);
      if (p.snapshot.end) p.snapshot.end.utcMs = Date.now();
      p.createdUtcMs = Date.now();
      return unit.run((tx) =>
        tripStore(tx, "ets2telemetry", p, {
          ownerUserId: userId,
          connection: { state: "unknown", referenceId: null },
          ...(target ? { canonical: target } : {}),
        }),
      );
    }
    async function newMember(roles: components["schemas"]["RolesInput"]["roles"] = ["driver"]) {
      const userId = randomUUID(),
        email = `${userId}@example.invalid`,
        password = createHmac("sha256", guardedAllocation().token)
          .update(`trip-browser-${userId}`)
          .digest("base64url"),
        credential = await identity.prepareCredential(password);
      await unit.run(async (tx) => {
        await identity.insertWithCredential(tx, {
          userId,
          email,
          name: "Fictional Other Trip Browser Driver",
          roles,
          ...credential,
        });
        await createQualificationInitialization(unit).initialize(tx, {
          userId,
          games: ["ets2"],
          assignedAt: new Date(Date.now() - 86400000).toISOString(),
        });
      });
      return { email, password, userId };
    }
    return {
      unit,
      composed,
      newMember,
      author,
      staff,
      email,
      password,
      userId,
      fields,
      revisionId,
      ids,
      telemetry,
      now,
      close: () => unit.close(),
    };
  } catch (error) {
    await unit.close();
    throw error;
  }
}
