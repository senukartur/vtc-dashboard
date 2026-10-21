import { randomBytes } from "node:crypto";
import { request } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createUnitOfWork, newId, runMigrations, type UnitOfWork } from "@vtc/db";
import { steamAccounts, steamLinks } from "@vtc/db/external-identities-schema";
import { eq, membership } from "@vtc/db/identity-schema";
import { telemetryTokens as tokens } from "@vtc/db/telemetry-schema";
import type { Connection, RowDataPacket } from "mysql2/promise";
import {
  beforeEach,
  expect,
  test,
  afterAll as vitestAfterAll,
  beforeAll as vitestBeforeAll,
} from "vitest";
import {
  steamEndpoint,
  steamProvider,
} from "../../apps/api/src/modules/external-identities/providers.ts";
import { createExternalIdentities } from "../../apps/api/src/modules/external-identities/service.ts";
import {
  type Actor,
  createIdentity,
  type Identity,
} from "../../apps/api/src/modules/identity/service.ts";
import type { Telemetry } from "../../apps/api/src/modules/sources/contracts/telemetry.ts";
import {
  createTelemetry,
  invalidateTelemetryCredentials,
  type TelemetryService,
} from "../../apps/api/src/modules/telemetry/service.ts";
import { createTrips } from "../../apps/api/src/modules/trips/service.ts";
import { identityAccessEvents } from "../../apps/api/src/platform/outbox/events.ts";
import {
  guardedSettings,
  reset,
  SCHEMA_SETUP_TIMEOUT_MS,
  testConnection,
} from "../persistence/support.ts";
import { telemetryFixture } from "../support/builders.ts";
import { bounded, deferred } from "../support/concurrency.ts";
import { safeIdentityFailure } from "../support/identity-diagnostics.ts";
import { schemaLifecycleHooks } from "../support/schema-lifecycle.ts";

const { beforeAll, afterAll } = schemaLifecycleHooks(vitestBeforeAll, vitestAfterAll);

let control: Connection,
  unit: UnitOfWork,
  identity: Identity,
  service: TelemetryService,
  owner: Actor,
  staff: Actor,
  cookie: string;
let instant = Date.now(),
  sequence = 0;
const now = () => new Date(instant),
  password = "Fictional-telemetry-passphrase-42";
const identityConfig = {
  secret: randomBytes(32).toString("hex"),
  origin: "http://127.0.0.1:4173",
  production: false,
};
const config = {
  cursorKey: randomBytes(32).toString("hex"),
  ipPerMinute: 600,
  globalPerMinute: 6000,
};
const tripConfig = { cursorKey: randomBytes(32).toString("hex") };
const bearer = (token: string) => `Bearer ${token}`;
const serviceFor = (
  host = unit,
  portIdentity = identity,
  trips = createTrips(host, tripConfig, { identity: portIdentity }, now),
) =>
  createTelemetry(
    host,
    config,
    { identity: portIdentity, external: createExternalIdentities(host, portIdentity), trips },
    now,
  );
async function safe<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    throw Object.assign(new Error("SYNTHETIC_TELEMETRY_OPERATION_FAILED"), safeIdentityFailure(e));
  }
}
beforeAll(async () => {
  control = await testConnection();
  unit = createUnitOfWork(guardedSettings());
  await reset(control);
  await runMigrations(guardedSettings());
  identity = createIdentity(unit, identityConfig, {
    accessEvents: identityAccessEvents(unit),
    invalidateTelemetryCredentials: (tx, id) => invalidateTelemetryCredentials(unit, tx, id),
  });
  await safe(
    identity.bootstrap({
      email: "telemetry-director@example.invalid",
      name: "Fictional Director",
      password,
    }),
  );
  const login = await safe(identity.login("telemetry-director@example.invalid", password));
  staff = await identity.authenticate(
    new Headers({ cookie: login.cookies.map((x) => x.split(";", 1)[0]).join("; ") }),
  );
}, SCHEMA_SETUP_TIMEOUT_MS);
beforeEach(async () => {
  await control.query("DELETE FROM telemetry_limits");
  instant = Date.now();
  const userId = newId(),
    email = `${userId}@example.invalid`,
    credential = await identity.prepareCredential(password);
  await safe(
    unit.run((tx) =>
      identity.insertWithCredential(tx, {
        userId,
        email,
        name: "Fictional Telemetry Member",
        roles: ["trainee"],
        ...credential,
      }),
    ),
  );
  const login = await safe(identity.login(email, password));
  cookie = login.cookies.map((x) => x.split(";", 1)[0]).join("; ");
  owner = await identity.authenticate(new Headers({ cookie }));
  await safe(
    unit.run(async (tx) => {
      const id = `765611900000${String(++sequence).padStart(5, "0")}`;
      await unit.client(tx).insert(steamAccounts).values({ steamId: id, userId, createdAt: now() });
      await unit.client(tx).insert(steamLinks).values({ userId, steamId: id });
    }),
  );
  service = serviceFor();
});
afterAll(async () => {
  await unit?.close();
  await control?.end();
});
async function connect(target = service) {
  const issued = await safe(target.issue(owner, newId(), { label: "Fictional recorder" }));
  const registration = await safe(target.register(bearer(issued.token), "127.0.0.1", newId()));
  const p = telemetryFixture("completed") as unknown as Telemetry;
  p.eventId = newId();
  p.source.tripId = newId();
  p.source.pluginSessionId = newId();
  p.installationId = registration.installationId;
  p.bindingId = registration.bindingId;
  return { issued, registration, p };
}
async function counts() {
  const [r] = await control.query<RowDataPacket[]>(
    "SELECT (SELECT COUNT(*) FROM source_messages) messages,(SELECT COUNT(*) FROM trips) trips,(SELECT COUNT(*) FROM outbox_events WHERE type IN ('source.snapshot_stored','trip.lifecycle_changed','trip.facts_changed')) events",
  );
  return JSON.stringify(r[0]);
}
test("one-show issuance serializes concurrent same keys; lost reply has safe recovery reference and changed input conflicts", async () => {
  const key = newId(),
    results = await Promise.allSettled([
      service.issue(owner, key, { label: "Fictional" }),
      service.issue(owner, key, { label: "Fictional" }),
    ]);
  expect(results.filter((x) => x.status === "fulfilled").length).toBe(1);
  const rejected = results.find((x) => x.status === "rejected");
  expect(rejected?.status === "rejected" && rejected.reason.publicCode).toBe(
    "SECRET_ALREADY_ISSUED",
  );
  await expect(service.issue(owner, key, { label: "Changed" })).rejects.toMatchObject({
    publicCode: "IDEMPOTENCY_CONFLICT",
  });
  const rows = await unit.run((tx) =>
    unit.client(tx).select().from(tokens).where(eq(tokens.ownerId, owner.userId)),
  );
  expect(rows.length).toBe(1);
  expect(rows[0]?.secretHash.length).toBe(32);
  expect(rows[0]?.lastUsedAt).toBeNull();
});
test("registration retry and rotation preserve frozen binding, receipt, first time and exact deduplication without effects", async () => {
  const { issued, p } = await connect();
  const key = newId();
  const a = await service.register(bearer(issued.token), "127.0.0.1", key),
    b = await service.register(bearer(issued.token), "127.0.0.1", key);
  expect(a).toEqual(b);
  const before = await counts();
  const first = await service.receive(bearer(issued.token), "127.0.0.1", p);
  expect(first.status).toBe("stored");
  const replacement = await service.issue(owner, newId(), { label: "Replacement" });
  await service.revoke(owner, newId(), issued.info.id);
  const current = await counts();
  expect(current === before).toBe(false);
  const next = await service.receive(bearer(replacement.token), "127.0.0.1", p);
  expect(next).toEqual({ ...first, status: "duplicate" });
  expect(await counts()).toBe(current);
  await expect(service.receive(bearer(issued.token), "127.0.0.1", p)).rejects.toMatchObject({
    publicCode: "TOKEN_INVALID",
  });
  const changed = structuredClone(p);
  changed.createdUtcMs++;
  await expect(
    service.receive(bearer(replacement.token), "127.0.0.1", changed),
  ).rejects.toMatchObject({ publicCode: "IDENTITY_CONFLICT" });
  const revision = structuredClone(p);
  revision.eventId = newId();
  await expect(
    service.receive(bearer(replacement.token), "127.0.0.1", revision),
  ).rejects.toMatchObject({ publicCode: "IDENTITY_CONFLICT" });
  expect(
    (await service.list(owner, {})).items.find((x) => x.id === replacement.info.id)?.lastUsedAt,
  ).not.toBeNull();
});
test("simultaneous first events on independent instances create one canonical receipt and retain conflicting revision evidence safely", async () => {
  const { issued, p } = await connect();
  const otherUnit = createUnitOfWork(guardedSettings());
  try {
    const second = serviceFor(otherUnit, createIdentity(otherUnit, identityConfig));
    const before = JSON.parse(await counts());
    const results = await Promise.all([
      service.receive(bearer(issued.token), "127.0.0.1", p),
      second.receive(bearer(issued.token), "127.0.0.1", p),
    ]);
    expect(new Set(results.map((x) => x.receiptId)).size).toBe(1);
    expect(results.filter((x) => x.status === "stored").length).toBe(1);
    const after = JSON.parse(await counts());
    expect(Number(after.messages) - Number(before.messages)).toBe(1);
    expect(Number(after.trips) - Number(before.trips)).toBe(1);
    expect(Number(after.events) - Number(before.events)).toBe(2);
  } finally {
    await otherUnit.close();
  }
});
test("simultaneous conflicting event contents and alternate IDs for one revision return exactly one safe conflict", async () => {
  for (const kind of ["content", "revision"] as const) {
    const { issued, p } = await connect(),
      conflict = structuredClone(p);
    if (kind === "content") conflict.createdUtcMs++;
    else conflict.eventId = newId();
    const results = await Promise.allSettled([
      service.receive(bearer(issued.token), "127.0.0.1", p),
      service.receive(bearer(issued.token), "127.0.0.1", conflict),
    ]);
    if (results.some((x) => x.status === "rejected" && x.reason.publicCode !== "IDENTITY_CONFLICT"))
      console.log(
        JSON.stringify({
          event: "telemetry_conflict_diagnostic",
          variant: kind,
          outcomes: results.map((x) =>
            x.status === "fulfilled"
              ? { state: "success" }
              : {
                  state: "failed",
                  ...safeIdentityFailure(x.reason),
                },
          ),
        }),
      );
    expect(results.filter((x) => x.status === "fulfilled").length).toBe(1);
    expect(
      results.filter((x) => x.status === "rejected" && x.reason.publicCode === "IDENTITY_CONFLICT")
        .length,
    ).toBe(1);
  }
});
test("source writes roll back on coordinator failure and ACK waits for durable commit; reconnect reuses committed lost reply", async () => {
  const trips = createTrips(unit, tripConfig, { identity }, now),
    gate = deferred<void>(),
    entered = deferred<void>();
  const delayed = createTelemetry(
    unit,
    config,
    {
      identity,
      external: createExternalIdentities(unit, identity),
      trips: {
        storeInTransaction: async (...args) => {
          const r = await trips.storeInTransaction(...args);
          entered.resolve();
          await gate.promise;
          return r;
        },
      },
    },
    now,
  );
  const { issued, p } = await connect();
  const before = await counts();
  let settled = false;
  const pending = delayed.receive(bearer(issued.token), "127.0.0.1", p).finally(() => {
    settled = true;
  });
  try {
    await bounded(entered.promise, "source-gate");
    expect(settled).toBe(false);
    expect(await counts()).toBe(before);
  } finally {
    gate.resolve();
  }
  const first = await pending;
  const restartedUnit = createUnitOfWork(guardedSettings());
  try {
    const replacement = serviceFor(restartedUnit, createIdentity(restartedUnit, identityConfig));
    expect(await replacement.receive(bearer(issued.token), "127.0.0.1", p)).toEqual({
      ...first,
      status: "duplicate",
    });
  } finally {
    await restartedUnit.close();
  }
  const broken = createTelemetry(
    unit,
    config,
    {
      identity,
      external: createExternalIdentities(unit, identity),
      trips: {
        storeInTransaction: async (...args) => {
          await trips.storeInTransaction(...args);
          throw new Error("SYNTHETIC_ROLLBACK");
        },
      },
    },
    now,
  );
  const change = structuredClone(p);
  change.eventId = newId();
  change.source.tripId = newId();
  const durable = await counts();
  await expect(broken.receive(bearer(issued.token), "127.0.0.1", change)).rejects.toThrow(
    "SYNTHETIC_ROLLBACK",
  );
  expect(await counts()).toBe(durable);
});
test("durable burst budget survives a second instance and restart, refills, and checks revoked tokens before rate denial", async () => {
  const { issued, p } = await connect();
  for (let i = 0; i < 10; i++) await service.receive(bearer(issued.token), "127.0.0.1", p);
  const secondUnit = createUnitOfWork(guardedSettings());
  try {
    const second = serviceFor(secondUnit, createIdentity(secondUnit, identityConfig));
    const [before] = await control.execute<RowDataPacket[]>(
      "SELECT credits FROM telemetry_limits WHERE bucket_key=?",
      [Buffer.from("global")],
    );
    await expect(second.receive(bearer(issued.token), "127.0.0.1", p)).rejects.toMatchObject({
      statusCode: 429,
      retryAfter: 1,
    });
    const [after] = await control.execute<RowDataPacket[]>(
      "SELECT credits FROM telemetry_limits WHERE bucket_key=?",
      [Buffer.from("global")],
    );
    expect(after).toEqual(before);
  } finally {
    await secondUnit.close();
  }
  service = serviceFor();
  instant += 1000;
  expect((await service.receive(bearer(issued.token), "127.0.0.1", p)).status).toBe("duplicate");
  await service.revoke(owner, newId(), issued.info.id);
  await expect(service.receive(bearer(issued.token), "127.0.0.1", p)).rejects.toMatchObject({
    statusCode: 401,
  });
});
test("foreign bindings and copied source ownership cannot disclose receipts; scope/eligibility and unlinked issuance deny", async () => {
  const { issued, p } = await connect();
  const foreign = structuredClone(p);
  foreign.bindingId = newId();
  await expect(service.receive(bearer(issued.token), "127.0.0.1", foreign)).rejects.toMatchObject({
    publicCode: "BINDING_MISMATCH",
  });
  await service.receive(bearer(issued.token), "127.0.0.1", p);
  const userId = newId(),
    email = `${userId}@example.invalid`,
    credential = await identity.prepareCredential(password);
  await unit.run((tx) =>
    identity.insertWithCredential(tx, {
      userId,
      email,
      name: "Fictional Other Owner",
      roles: ["driver"],
      ...credential,
    }),
  );
  const login = await identity.login(email, password),
    otherCookie = login.cookies.map((x) => x.split(";", 1)[0]).join("; ");
  const other = await identity.authenticate(new Headers({ cookie: otherCookie }));
  await unit.run(async (tx) => {
    const steamId = `765611900000${String(++sequence).padStart(5, "0")}`;
    await unit.client(tx).insert(steamAccounts).values({ steamId, userId, createdAt: now() });
    await unit.client(tx).insert(steamLinks).values({ userId, steamId });
  });
  const otherToken = await service.issue(other, newId(), { label: "Other" });
  const foreignRegistration = await service.register(
    bearer(otherToken.token),
    "127.0.0.1",
    newId(),
  );
  await expect(service.receive(bearer(otherToken.token), "127.0.0.1", p)).rejects.toMatchObject({
    publicCode: "BINDING_MISMATCH",
  });
  const copied = structuredClone(p);
  copied.installationId = foreignRegistration.installationId;
  copied.bindingId = foreignRegistration.bindingId;
  await expect(
    service.receive(bearer(otherToken.token), "127.0.0.1", copied),
  ).rejects.toMatchObject({ publicCode: "IDENTITY_CONFLICT" });
  await unit.run((tx) =>
    unit
      .client(tx)
      .update(tokens)
      .set({ scope: "ingest", identityEpoch: 99 })
      .where(eq(tokens.id, issued.info.id)),
  );
  await expect(service.connection(bearer(issued.token), "127.0.0.1")).rejects.toMatchObject({
    statusCode: 403,
  });
  expect(
    (await service.list(owner, {})).items.find((x) => x.id === issued.info.id)?.revokedAt,
  ).not.toBeNull();
  await unit.run((tx) =>
    unit.client(tx).delete(steamLinks).where(eq(steamLinks.userId, owner.userId)),
  );
  await expect(service.issue(owner, newId(), { label: "Unlinked" })).rejects.toMatchObject({
    statusCode: 403,
  });
});
test("signed token pages bind current actor/session/limit and return bounded secret-free DTOs", async () => {
  for (let i = 0; i < 5; i++) await service.issue(owner, newId(), { label: `Fictional ${i}` });
  const page = await service.list(owner, { limit: 2 });
  expect(page.items.length).toBe(2);
  expect(page.nextCursor).not.toBeNull();
  const next = await service.list(owner, { limit: 2, cursor: page.nextCursor as string });
  expect(next.items.length).toBe(2);
  expect(new Set([...page.items, ...next.items].map((x) => x.id)).size).toBe(4);
  expect(Object.keys(page.items[0] ?? {}).sort()).toEqual([
    "createdAt",
    "id",
    "label",
    "lastUsedAt",
    "revokedAt",
  ]);
  await expect(
    service.list(owner, { limit: 3, cursor: page.nextCursor as string }),
  ).rejects.toMatchObject({ statusCode: 409 });
  await expect(
    service.list(staff, { limit: 2, cursor: page.nextCursor as string }),
  ).rejects.toMatchObject({ statusCode: 409 });
});
test("ingestion-first and revocation-first lock orders serialize new and duplicate receipts", async () => {
  const { issued, p } = await connect(),
    gate = deferred<void>(),
    entered = deferred<void>(),
    trips = createTrips(unit, tripConfig, { identity }, now);
  const delayed = createTelemetry(
    unit,
    config,
    {
      identity,
      external: createExternalIdentities(unit, identity),
      trips: {
        storeInTransaction: async (...args) => {
          const result = await trips.storeInTransaction(...args);
          entered.resolve();
          await bounded(gate.promise, "release-ingress");
          return result;
        },
      },
    },
    now,
  );
  const ingress = delayed.receive(bearer(issued.token), "127.0.0.1", p);
  await bounded(entered.promise, "ingress-held");
  const revoke = service.revoke(owner, newId(), issued.info.id);
  gate.resolve();
  expect((await ingress).status).toBe("stored");
  await revoke;
  await expect(service.receive(bearer(issued.token), "127.0.0.1", p)).rejects.toMatchObject({
    statusCode: 401,
  });
  const next = await service.issue(owner, newId(), { label: "Revocation first" });
  await service.revoke(owner, newId(), next.info.id);
  const fresh = structuredClone(p);
  fresh.eventId = newId();
  fresh.source.tripId = newId();
  const outcomes = await Promise.allSettled([
    service.receive(bearer(next.token), "127.0.0.1", p),
    service.receive(bearer(next.token), "127.0.0.1", fresh),
  ]);
  expect(outcomes.every((x) => x.status === "rejected" && x.reason.statusCode === 401)).toBe(true);
});
test("Steam replacement atomically revokes tokens; invalidation callback failure rolls back link, epochs, audit and access event", async () => {
  const { issued, p } = await connect();
  await service.receive(bearer(issued.token), "127.0.0.1", p);
  const providers = {
    steam: steamProvider(
      async () => new Response("ns:http://specs.openid.net/auth/2.0\nis_valid:true\n"),
    ),
    truckers: { lookup: async () => ({ found: false, profile: null }) },
  };
  const external = createExternalIdentities(unit, identity, providers),
    proof = await external.request(owner, newId(), "replacement");
  const returned = new URL(
      new URL(proof.verificationUrl).searchParams.get("openid.return_to") ?? "",
    ),
    query = returned.searchParams,
    candidate = `765611900000${String(++sequence).padStart(5, "0")}`;
  for (const [key, value] of Object.entries({
    ns: "http://specs.openid.net/auth/2.0",
    mode: "id_res",
    op_endpoint: steamEndpoint,
    claimed_id: `https://steamcommunity.com/openid/id/${candidate}`,
    identity: `https://steamcommunity.com/openid/id/${candidate}`,
    return_to: returned.toString(),
    response_nonce: `${new Date().toISOString().slice(0, 19)}Z${newId()}`,
    assoc_handle: "synthetic",
    signed: "op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle",
    sig: Buffer.alloc(32, 1).toString("base64"),
  }))
    query.set(`openid.${key}`, value);
  await external.callback(owner, query.toString());
  const version = (await identity.current(owner)).version;
  const [before] = await control.query<RowDataPacket[]>(
    "SELECT (SELECT COUNT(*) FROM audit_entries) audit,(SELECT COUNT(*) FROM outbox_events) events",
  );
  const broken = createIdentity(unit, identityConfig, {
    accessEvents: identityAccessEvents(unit),
    invalidateTelemetryCredentials: async (tx, id) => {
      await invalidateTelemetryCredentials(unit, tx, id);
      throw new Error("SYNTHETIC_INVALIDATION_FAILURE");
    },
  });
  const replacement = createExternalIdentities(unit, broken, providers);
  await expect(
    replacement.replace(staff, owner.userId, newId(), version, {
      verificationId: proof.id,
      reason: "Fictional requested change",
    }),
  ).rejects.toThrow();
  const [after] = await control.query<RowDataPacket[]>(
    "SELECT (SELECT COUNT(*) FROM audit_entries) audit,(SELECT COUNT(*) FROM outbox_events) events",
  );
  expect(after).toEqual(before);
  expect((await service.connection(bearer(issued.token), "127.0.0.1")).identityEpoch).toBe(1);
  const gate = deferred<void>(),
    entered = deferred<void>();
  const racingIdentity = createIdentity(unit, identityConfig, {
    accessEvents: identityAccessEvents(unit),
    invalidateTelemetryCredentials: async (tx, id) => {
      await invalidateTelemetryCredentials(unit, tx, id);
      entered.resolve();
      await bounded(gate.promise, "steam-replacement-release");
    },
  });
  const applying = createExternalIdentities(unit, racingIdentity, providers).replace(
    staff,
    owner.userId,
    newId(),
    version,
    {
      verificationId: proof.id,
      reason: "Fictional requested change",
    },
  );
  let pending: Promise<PromiseSettledResult<unknown>[]>;
  try {
    await bounded(entered.promise, "steam-replacement-held");
    const fresh = structuredClone(p);
    fresh.eventId = newId();
    fresh.source.tripId = newId();
    pending = Promise.allSettled([
      service.receive(bearer(issued.token), "127.0.0.1", p),
      service.receive(bearer(issued.token), "127.0.0.1", fresh),
    ]);
  } finally {
    gate.resolve();
  }
  await applying;
  expect((await pending).every((x) => x.status === "rejected" && x.reason.statusCode === 401)).toBe(
    true,
  );
  await expect(service.receive(bearer(issued.token), "127.0.0.1", p)).rejects.toMatchObject({
    statusCode: 401,
  });
  const replacementToken = await service.issue(owner, newId(), { label: "New epoch" });
  await expect(
    service.receive(bearer(replacementToken.token), "127.0.0.1", p),
  ).rejects.toMatchObject({ publicCode: "BINDING_MISMATCH" });
  const [source] = await control.execute<RowDataPacket[]>(
    "SELECT owner_id FROM source_trips WHERE trip_key=?",
    [Buffer.from(p.source.tripId)],
  );
  expect(source[0]?.owner_id.toString() === owner.userId).toBe(true);
});
test("deactivation and reinstatement eagerly revoke old credentials permanently with source owner retained", async () => {
  const { issued, p } = await connect();
  await service.receive(bearer(issued.token), "127.0.0.1", p);
  const version = await unit.run(
    async (tx) =>
      (
        await unit.client(tx).select().from(membership).where(eq(membership.userId, owner.userId))
      )[0]?.version,
  );
  await identity.administer(staff, owner.userId, newId(), version as number, {
    kind: "deactivate",
  });
  expect(
    (
      await unit.run((tx) =>
        unit.client(tx).select().from(tokens).where(eq(tokens.id, issued.info.id)),
      )
    )[0]?.revokedAt,
  ).not.toBeNull();
  await expect(service.receive(bearer(issued.token), "127.0.0.1", p)).rejects.toMatchObject({
    statusCode: 401,
  });
  await identity.administer(staff, owner.userId, newId(), (version as number) + 1, {
    kind: "reinstate",
    roles: ["driver"],
  });
  await expect(service.receive(bearer(issued.token), "127.0.0.1", p)).rejects.toMatchObject({
    statusCode: 401,
  });
});
test("built server uses actual bytes, frozen errors and browser CSRF/Origin guards including DELETE without bearer crossover", async () => {
  const { createApp: builtApp } = await import(pathToFileURL(resolve("apps/api/dist/app.js")).href);
  const { createTelemetry: builtTelemetry } = await import(
    pathToFileURL(resolve("apps/api/dist/modules/telemetry/service.js")).href
  );
  const app = await builtApp({
    identity,
    telemetry: builtTelemetry(
      unit,
      config,
      {
        identity,
        external: createExternalIdentities(unit, identity),
        trips: createTrips(unit, tripConfig, { identity }, now),
      },
      now,
    ),
    checkReadiness: async () => true,
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("SYNTHETIC_ADDRESS_REQUIRED");
  const http = (
    path: string,
    body?: Buffer,
    headers: Record<string, string> = {},
    method = body ? "POST" : "GET",
  ) =>
    new Promise<{
      status: number;
      headers: Record<string, unknown>;
      body: Record<string, unknown>;
    }>((accept, reject) => {
      const req = request(
        {
          host: "127.0.0.1",
          port: address.port,
          path,
          method,
          headers: {
            ...(body
              ? { "Content-Type": "application/json", "Content-Length": String(body.length) }
              : {}),
            ...headers,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            try {
              accept({
                status: res.statusCode ?? 0,
                headers: res.headers,
                body: JSON.parse(Buffer.concat(chunks).toString()),
              });
            } catch {
              reject(new Error("SYNTHETIC_INVALID_RESPONSE"));
            }
          });
        },
      );
      req.on("error", () => reject(new Error("SYNTHETIC_HTTP_FAILURE")));
      req.end(body);
    });
  try {
    const { issued, p } = await connect();
    const auth = { Authorization: bearer(issued.token) };
    expect((await http("/api/telemetry/v1/connection", undefined, { Cookie: cookie })).status).toBe(
      401,
    );
    expect((await http("/api/v1/me/telemetry-tokens", undefined, auth)).status).toBe(401);
    for (const bytes of [
      Buffer.from([0xc3, 0x28]),
      Buffer.from('{"a":{"x":1,"x":2}}'),
      Buffer.from("9007199254740992"),
      Buffer.from("1e999"),
      Buffer.from(`${"[".repeat(18)}0${"]".repeat(18)}`),
      Buffer.from(`${" ".repeat(65536)}{}`),
    ]) {
      const r = await http("/api/telemetry/v1/events", bytes, auth);
      expect([400, 413].includes(r.status)).toBe(true);
      expect(r.body).toHaveProperty("requestId");
      expect(r.body).not.toHaveProperty("meta");
    }
    expect(
      (
        await http("/api/telemetry/v1/events", Buffer.from(JSON.stringify(p)), {
          ...auth,
          "Content-Encoding": "gzip",
        })
      ).status,
    ).toBe(415);
    expect(
      (
        await http("/api/telemetry/v1/events", Buffer.from(JSON.stringify(p)), {
          ...auth,
          "Content-Type": "text/plain",
        })
      ).status,
    ).toBe(415);
    expect(
      (
        await http(
          "/api/telemetry/v1/events",
          Buffer.from(JSON.stringify({ ...p, contract: { major: 1, minor: 1 } })),
          auth,
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await http(
          "/api/telemetry/v1/events",
          Buffer.from(JSON.stringify({ ...p, userId: owner.userId })),
          auth,
        )
      ).status,
    ).toBe(400);
    instant += 10000;
    const stored = await http("/api/telemetry/v1/events", Buffer.from(JSON.stringify(p)), auth);
    expect(stored.status).toBe(202);
    expect(stored.headers["cache-control"]).toBe("no-store");
    await control.query("DELETE FROM telemetry_limits");
    for (let i = 0; i < 10; i++)
      expect((await http("/api/telemetry/v1/events", Buffer.from("{}"), auth)).status).toBe(400);
    const limited = await http("/api/telemetry/v1/events", Buffer.from("{}"), auth);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers["retry-after"])).toBeGreaterThanOrEqual(1);
    const csrf = await http("/api/v1/auth/csrf", undefined, { Cookie: cookie });
    const csrfToken = (csrf.body.data as { token: string }).token;
    const issueKey = newId(),
      browserHeaders = {
        Cookie: cookie,
        Origin: identityConfig.origin,
        "X-CSRF-Token": csrfToken,
        "Idempotency-Key": issueKey,
      };
    expect(
      (
        await http("/api/v1/me/telemetry-tokens", Buffer.from('{"label":"HTTP recorder"}'), {
          Cookie: cookie,
          Origin: identityConfig.origin,
          "Idempotency-Key": newId(),
        })
      ).status,
    ).toBe(403);
    const created = await http(
      "/api/v1/me/telemetry-tokens",
      Buffer.from('{"label":"HTTP recorder"}'),
      browserHeaders,
    );
    expect(created.status).toBe(201);
    const replay = await http(
      "/api/v1/me/telemetry-tokens",
      Buffer.from('{"label":"HTTP recorder"}'),
      browserHeaders,
    );
    expect(replay.status).toBe(409);
    expect(
      (replay.body.error as { details: { ownResourceId: string }[] }).details[0]?.ownResourceId ===
        (created.body.data as { info: { id: string } }).info.id,
    ).toBe(true);
    expect(
      JSON.stringify(replay.body).includes((created.body.data as { token: string }).token),
    ).toBe(false);
    const path = `/api/v1/me/telemetry-tokens/${issued.info.id}`;
    expect(
      (
        await http(
          path,
          undefined,
          { Cookie: cookie, Origin: identityConfig.origin, "Idempotency-Key": newId() },
          "DELETE",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await http(
          path,
          undefined,
          {
            Cookie: cookie,
            Origin: "http://example.invalid",
            "X-CSRF-Token": csrfToken,
            "Idempotency-Key": newId(),
          },
          "DELETE",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await http(
          path,
          undefined,
          {
            Cookie: cookie,
            Origin: identityConfig.origin,
            "X-CSRF-Token": csrfToken,
            "Idempotency-Key": newId(),
          },
          "DELETE",
        )
      ).status,
    ).toBe(200);
    const denied = await http("/api/telemetry/v1/events", Buffer.from(JSON.stringify(p)), auth);
    expect(denied.status).toBe(401);
    expect(denied.headers["www-authenticate"]).toBeDefined();
  } finally {
    await app.close();
  }
});

test("built HTTP reconnect after closing app and pool preserves lost receipt and lower-revision terminal-before-start history", async () => {
  const { issued, p } = await connect();
  const { createApp: builtApp } = await import(pathToFileURL(resolve("apps/api/dist/app.js")).href);
  const { createTelemetry: builtTelemetry } = await import(
    pathToFileURL(resolve("apps/api/dist/modules/telemetry/service.js")).href
  );
  const launch = async () => {
    const host = createUnitOfWork(guardedSettings()),
      hostIdentity = createIdentity(host, identityConfig);
    const telemetry = builtTelemetry(
      host,
      config,
      {
        identity: hostIdentity,
        external: createExternalIdentities(host, hostIdentity),
        trips: createTrips(host, tripConfig, { identity: hostIdentity }, now),
      },
      now,
    );
    const app = await builtApp({
      identity: hostIdentity,
      telemetry,
      checkReadiness: async () => true,
      closeDatabase: () => host.close(),
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("SYNTHETIC_ADDRESS_REQUIRED");
    const send = (payload: Telemetry) =>
      new Promise<{ status: number; body: Record<string, unknown> }>((accept, reject) => {
        const bytes = Buffer.from(JSON.stringify(payload));
        const req = request(
          {
            host: "127.0.0.1",
            port: address.port,
            path: "/api/telemetry/v1/events",
            method: "POST",
            headers: {
              Authorization: bearer(issued.token),
              "Content-Type": "application/json",
              "Content-Length": String(bytes.length),
            },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () => {
              try {
                accept({
                  status: res.statusCode ?? 0,
                  body: JSON.parse(Buffer.concat(chunks).toString()),
                });
              } catch {
                reject(new Error("SYNTHETIC_RESPONSE_REQUIRED"));
              }
            });
          },
        );
        req.on("error", () => reject(new Error("SYNTHETIC_HTTP_FAILED")));
        req.end(bytes);
      });
    return { app, send };
  };
  let running = await launch();
  let first: Record<string, unknown>;
  try {
    const result = await running.send(p);
    expect(result.status).toBe(202);
    first = result.body;
  } finally {
    await running.app.close();
  }
  running = await launch();
  try {
    const duplicate = await running.send(p);
    expect(duplicate.status).toBe(200);
    expect(duplicate.body).toEqual({ ...first, status: "duplicate" });
    const opening = telemetryFixture("started") as unknown as Telemetry;
    opening.eventId = newId();
    opening.source = p.source;
    opening.installationId = p.installationId;
    opening.bindingId = p.bindingId;
    opening.revision = 1;
    const terminal = structuredClone(p);
    terminal.eventId = newId();
    terminal.source.tripId = newId();
    terminal.revision = 3;
    opening.source = structuredClone(terminal.source);
    expect((await running.send(terminal)).status).toBe(202);
    expect((await running.send(opening)).status).toBe(202);
    const [state] = await control.execute<RowDataPacket[]>(
      "SELECT t.outcome,t.decision,s.latest_revision FROM trips t JOIN source_trips s ON s.canonical_trip_id=t.id WHERE s.trip_key=?",
      [Buffer.from(terminal.source.tripId)],
    );
    expect(state[0]?.outcome).toBe("delivered");
    expect(state[0]?.decision).toBe("unassessed");
    expect(String(state[0]?.latest_revision)).toBe("3");
    const [money] = await control.execute<RowDataPacket[]>(
      "SELECT COUNT(*) count FROM source_messages m JOIN source_trips s ON s.id=m.source_trip_id WHERE s.trip_key=?",
      [Buffer.from(terminal.source.tripId)],
    );
    expect(Number(money[0]?.count)).toBe(2);
  } finally {
    await running.app.close();
  }
});

test("deactivation holding identity locks refuses both waiting new and duplicate receipts without source changes", async () => {
  const { issued, p } = await connect();
  await service.receive(bearer(issued.token), "127.0.0.1", p);
  const gate = deferred<void>(),
    entered = deferred<void>(),
    before = await counts();
  const guarded = createIdentity(unit, identityConfig, {
    accessEvents: identityAccessEvents(unit),
    invalidateTelemetryCredentials: async (tx, id) => {
      await invalidateTelemetryCredentials(unit, tx, id);
      entered.resolve();
      await bounded(gate.promise, "deactivation-release");
    },
  });
  const changing = guarded.administer(staff, owner.userId, newId(), 1, { kind: "deactivate" });
  let pending: Promise<PromiseSettledResult<unknown>[]>;
  try {
    await bounded(entered.promise, "deactivation-held");
    const fresh = structuredClone(p);
    fresh.eventId = newId();
    fresh.source.tripId = newId();
    pending = Promise.allSettled([
      service.receive(bearer(issued.token), "127.0.0.1", p),
      service.receive(bearer(issued.token), "127.0.0.1", fresh),
    ]);
  } finally {
    gate.resolve();
  }
  await changing;
  expect((await pending).every((x) => x.status === "rejected" && x.reason.statusCode === 401)).toBe(
    true,
  );
  expect(await counts()).toBe(before);
});
test("security change while telemetry invalidation is absent cannot revive stale rows on reenable", async () => {
  const { issued } = await connect();
  const disabled = createIdentity(unit, identityConfig, {
    accessEvents: identityAccessEvents(unit),
  });
  await disabled.administer(staff, owner.userId, newId(), 1, { kind: "roles", roles: ["trainee"] });
  const [before] = await control.execute<RowDataPacket[]>(
    "SELECT revoked_at FROM telemetry_tokens WHERE id=?",
    [Buffer.from(issued.info.id)],
  );
  expect(before[0]?.revoked_at).toBeNull();
  await expect(service.connection(bearer(issued.token), "127.0.0.1")).rejects.toMatchObject({
    statusCode: 403,
  });
  const [after] = await control.execute<RowDataPacket[]>(
    "SELECT revoked_at FROM telemetry_tokens WHERE id=?",
    [Buffer.from(issued.info.id)],
  );
  expect(after[0]?.revoked_at).not.toBeNull();
  await expect(service.connection(bearer(issued.token), "127.0.0.1")).rejects.toMatchObject({
    statusCode: 401,
  });
});

test("an auth snapshot opened before peer commit checks current revision and complete current fact/trailer rows", async () => {
  for (const variant of ["same-revision", "higher-revision"] as const) {
    const { issued, p } = await connect(),
      before = JSON.parse(await counts()),
      later = structuredClone(p);
    later.eventId = newId();
    if (variant === "higher-revision") later.revision++;
    const entered = deferred<void>(),
      release = deferred<void>(),
      external = createExternalIdentities(unit, identity);
    let paused = false;
    const slow = createTelemetry(
      unit,
      config,
      {
        identity,
        external: {
          captureCredential: external.captureCredential,
          credentialEligible: async (tx, credential) => {
            if (!paused) {
              paused = true;
              entered.resolve();
              await bounded(release.promise, "old-snapshot-release");
            }
            return external.credentialEligible(tx, credential);
          },
        },
        trips: createTrips(unit, tripConfig, { identity }, now),
      },
      now,
    );
    // authenticate has already done its nonlocking token read and opened the RR snapshot.
    const pending = Promise.allSettled([slow.receive(bearer(issued.token), "127.0.0.1", later)]);
    try {
      await bounded(entered.promise, "old-snapshot-held");
      await service.receive(bearer(issued.token), "127.0.0.1", p);
    } finally {
      release.resolve();
    }
    const [result] = await bounded(pending, "old-snapshot-result"),
      after = JSON.parse(await counts());
    expect(Number(after.trips) - Number(before.trips)).toBe(1);
    if (variant === "same-revision") {
      expect(
        result?.status === "rejected" && result.reason.publicCode === "IDENTITY_CONFLICT",
      ).toBe(true);
      expect(Number(after.messages) - Number(before.messages)).toBe(1);
      expect(Number(after.events) - Number(before.events)).toBe(2);
    } else {
      expect(result?.status).toBe("fulfilled");
      expect(Number(after.messages) - Number(before.messages)).toBe(2);
      expect(Number(after.events) - Number(before.events)).toBe(4);
      const [rows] = await control.execute<RowDataPacket[]>(
        "SELECT m.revision,f.trailer_count,(SELECT COUNT(*) FROM trip_fact_trailers ft WHERE ft.trip_fact_id=f.id) children FROM source_trips s JOIN trips t ON t.id=s.canonical_trip_id JOIN trip_facts f ON f.id=t.current_fact_id JOIN source_messages m ON m.id=f.message_id WHERE s.trip_key=?",
        [Buffer.from(p.source.tripId)],
      );
      expect(String(rows[0]?.revision)).toBe(String(later.revision));
      expect(Number(rows[0]?.children)).toBe(p.snapshot.trailers.items.length);
      expect(Number(rows[0]?.trailer_count)).toBe(p.snapshot.trailers.items.length);
      const duplicate = await service.receive(bearer(issued.token), "127.0.0.1", later);
      expect(duplicate.status).toBe("duplicate");
      expect(await counts()).toBe(JSON.stringify(after));
    }
  }
});
