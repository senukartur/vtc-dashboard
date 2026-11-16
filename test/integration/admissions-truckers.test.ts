import { randomBytes } from "node:crypto";
import { createUnitOfWork, newId, runMigrations, type UnitOfWork } from "@vtc/db";
import { applications, eq, sql } from "@vtc/db/admissions-schema";
import { getTableName } from "drizzle-orm";
import type { Connection, RowDataPacket } from "mysql2/promise";
import {
  beforeEach,
  expect,
  test,
  afterAll as vitestAfterAll,
  beforeAll as vitestBeforeAll,
} from "vitest";
import { createApp } from "../../apps/api/src/app.ts";
import {
  type ApplicationInput,
  validateApplication,
} from "../../apps/api/src/modules/admissions/security.ts";
import {
  type Admissions,
  type AdmissionsPorts,
  createAdmissions,
} from "../../apps/api/src/modules/admissions/service.ts";
import {
  type ApplicantLookup,
  maxCheckAttempts,
  type TruckersPort,
  truckersCheckKind,
} from "../../apps/api/src/modules/admissions/truckers-checks.ts";
import { ProviderFailure } from "../../apps/api/src/modules/external-identities/providers.ts";
import { csrfProtection } from "../../apps/api/src/modules/identity/http.ts";
import {
  type Actor,
  createIdentity,
  type Identity,
} from "../../apps/api/src/modules/identity/service.ts";
import { createQualificationInitialization } from "../../apps/api/src/modules/qualifications/initialization.ts";
import { createQueue, LeaseLostError, type Queue } from "../../apps/api/src/platform/jobs/queue.ts";
import {
  admissionsEvents,
  identityAccessEvents,
} from "../../apps/api/src/platform/outbox/events.ts";
import { composeIdentity } from "../../apps/api/src/use-cases/identity-messaging.ts";
import {
  guardedSettings,
  reset,
  SCHEMA_SETUP_TIMEOUT_MS,
  testConnection,
} from "../persistence/support.ts";
import { bounded, deferred } from "../support/concurrency.ts";
import { identityDiagnostics } from "../support/identity-diagnostics.ts";
import { schemaLifecycleHooks } from "../support/schema-lifecycle.ts";

const { beforeAll, afterAll } = schemaLifecycleHooks(vitestBeforeAll, vitestAfterAll);

// Fictional Steam and TruckersMP identities only; the provider port is always a local fake.
const diagnostic = identityDiagnostics("admissions");
const origin = "http://127.0.0.1:4173",
  password = "Synthetic-truckers-check-passphrase-42";
const identityConfig = { secret: randomBytes(32).toString("hex"), origin, production: false };
const config = { key: randomBytes(32).toString("base64url"), origin };
const steamId = (n: number) => `7656119${String(n).padStart(10, "0")}`;
const profileUrl = (n: number) => `https://steamcommunity.com/profiles/${steamId(n)}`;
let control: Connection,
  unit: UnitOfWork,
  identity: Identity,
  admissions: Admissions,
  worker: Queue,
  director: Actor,
  directorCookie: string;
let instant = Date.now();
const time = () => new Date(instant);
let lookups: string[] = [];
let respond: (id: string) => Promise<ApplicantLookup> = async () => player();
const truckers: TruckersPort = {
  lookup: (id) => {
    lookups.push(id);
    return respond(id);
  },
};
function player(
  patch: Partial<NonNullable<ApplicantLookup["profile"]>> = {},
  bans: ApplicantLookup["bans"] = { any: false, count: 0 },
): ApplicantLookup {
  return {
    found: true,
    profile: {
      playerId: "900000000000001",
      displayName: "Fictional Applicant TMP",
      vtc: { inVtc: true, id: "900000000001", name: "Fictional Other VTC", tag: "FOV" },
      ...patch,
    },
    bans,
  };
}
const fail = (category: ProviderFailure["category"]) => async () => {
  throw new ProviderFailure(category);
};
function harness(
  overrides: Partial<AdmissionsPorts> = {},
  u: UnitOfWork = unit,
  adapter: TruckersPort | null = truckers,
) {
  const auth = createIdentity(u, identityConfig, { accessEvents: identityAccessEvents(u) }, time);
  return createAdmissions(
    u,
    config,
    {
      identity: auth,
      qualifications: createQualificationInitialization(u),
      events: admissionsEvents(u),
      invalidateMail: async () => {},
      ...(adapter ? { truckers: adapter } : {}),
      ...overrides,
    },
    time,
  );
}
function failAfterInsert(tableName: string): UnitOfWork {
  function after(builder: object): object {
    return new Proxy(builder, {
      get(target, property) {
        const value = Reflect.get(target, property);
        if (property === "then" && typeof value === "function")
          return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
            Promise.resolve(target as PromiseLike<unknown>)
              .then(() => {
                throw new Error("SYNTHETIC_POST_WRITE_FAILURE");
              })
              .then(resolve, reject);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          const next = Reflect.apply(value, target, args);
          return next && typeof next === "object" ? after(next) : next;
        };
      },
    });
  }
  return {
    run: (command) => unit.run(command),
    close: async () => {},
    client(tx) {
      const original = unit.client(tx);
      return new Proxy(original, {
        get(target, property) {
          if (property === "insert")
            return (table: Parameters<typeof target.insert>[0]) => {
              const builder = target.insert(table);
              return getTableName(table) === tableName ? after(builder) : builder;
            };
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
}
const input = (patch: Partial<ApplicationInput> = {}): ApplicationInput => ({
  nickname: "Fictional Applicant",
  email: `${newId()}@example.invalid`,
  steamProfileUrl: profileUrl(1),
  games: ["ets2"],
  ...patch,
});
async function status(work: Promise<unknown>) {
  try {
    await work;
    return 200;
  } catch (error) {
    return error && typeof error === "object" && "statusCode" in error
      ? Number(error.statusCode)
      : 500;
  }
}
async function submitted(owner = admissions, raw = input()) {
  await owner.submit(`pre:${newId()}`, newId(), raw, "en");
  const [app] = await unit.run((tx) =>
    unit
      .client(tx)
      .select()
      .from(applications)
      .where(eq(applications.emailKey, raw.email.toLowerCase()))
      .orderBy(sql`${applications.submittedAt} DESC`)
      .limit(1),
  );
  if (!app) throw new Error("SYNTHETIC_APPLICATION_MISSING");
  return app;
}
async function check(id: string) {
  const [rows] = await control.execute<RowDataPacket[]>(
    "SELECT generation, state, steam_id AS steamId, CAST(lease_id AS CHAR) AS leaseId, lease_until AS leaseUntil, found, profile, failure, requested_at AS requestedAt, checked_at AS checkedAt, last_attempt_at AS lastAttemptAt FROM admissions_truckers_checks WHERE application_id=?",
    [id],
  );
  return rows[0];
}
async function jobs(id: string) {
  const [rows] = await control.execute<RowDataPacket[]>(
    "SELECT CAST(kind AS CHAR) AS kind, CAST(consumer AS CHAR) AS consumer, CAST(effect_key AS CHAR) AS effectKey, reference, state, failure, attempts, max_attempts AS maxAttempts, available_at AS availableAt FROM durable_jobs WHERE JSON_UNQUOTE(JSON_EXTRACT(reference, '$.applicationId'))=? ORDER BY created_at, available_at",
    [id],
  );
  return rows;
}
async function count(table: "admissions_command_results" | "admissions_applications") {
  const [rows] = await control.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM ${table}`);
  return Number(rows[0]?.n);
}
const stored = (iso: string) => iso.replace("T", " ").replace("Z", "");
// Jobs due by the test clock become claimable now; claims and leases stay on the database clock.
async function work() {
  await control.execute(
    "UPDATE durable_jobs SET available_at=UTC_TIMESTAMP(3) WHERE state='ready' AND available_at<=?",
    [stored(time().toISOString())],
  );
  let executed = 0;
  for (let claim = await worker.claim(); claim; claim = await worker.claim()) {
    await worker.execute(claim);
    executed++;
  }
  return executed;
}
async function signedIn(roles: ("trainee" | "driver" | "dispatcher" | "deputy_director")[]) {
  const userId = newId(),
    email = `${userId}@example.invalid`;
  const prepared = await identity.prepareCredential(password);
  await unit.run((tx) =>
    identity.insertWithCredential(tx, {
      userId,
      email,
      name: "Fictional Staff",
      roles,
      ...prepared,
    }),
  );
  const login = await identity.login(email, password);
  const cookie = login.cookies.map((c) => c.split(";", 1)[0]).join("; ");
  return { cookie, actor: await identity.authenticate(new Headers({ cookie })) };
}
beforeAll(async () => {
  control = await diagnostic.phase("connection", () => testConnection());
  await diagnostic.phase("reset", () => reset(control));
  await diagnostic.phase("migrations", () => runMigrations(guardedSettings()));
  unit = await diagnostic.phase("unit", async () =>
    diagnostic.unit(createUnitOfWork(guardedSettings()), control, true),
  );
  identity = createIdentity(
    unit,
    identityConfig,
    { accessEvents: identityAccessEvents(unit) },
    time,
  );
  admissions = harness({ identity });
  if (!admissions.truckersHandler) throw new Error("SYNTHETIC_HANDLER_MISSING");
  worker = createQueue(unit, [admissions.truckersHandler]);
  await identity.bootstrap({
    email: "truckers-director@example.invalid",
    name: "Fictional Director",
    password,
  });
  const login = await identity.login("truckers-director@example.invalid", password);
  directorCookie = login.cookies.map((c) => c.split(";", 1)[0]).join("; ");
  director = await identity.authenticate(new Headers({ cookie: directorCookie }));
  await control.execute(
    "UPDATE identity_sessions SET expires_at=UTC_TIMESTAMP(3)+INTERVAL 30 DAY WHERE id=?",
    [director.sessionId],
  );
}, SCHEMA_SETUP_TIMEOUT_MS);
beforeEach(async () => {
  instant = Date.now();
  lookups = [];
  respond = async () => player();
  await control.query("DELETE FROM admissions_limits");
  await control.query("DELETE FROM identity_limits");
  await control.query("DELETE FROM job_effect_receipts");
  await control.query("DELETE FROM durable_jobs");
});
afterAll(async () => {
  await unit?.close();
  await control?.end();
});

test("a /profiles/ submission commits its check row and first job, and the worker completes it privately", async () => {
  const app = await submitted(
    admissions,
    input({ referralSource: "other", referralOther: "A fictional convoy poster" }),
  );
  const saved = await check(app.id);
  expect(saved).toMatchObject({ generation: 1, state: "checking", steamId: steamId(1) });
  expect(saved?.found).toBeNull();
  const [job] = await jobs(app.id);
  expect(job).toMatchObject({
    kind: truckersCheckKind,
    consumer: "admissions-truckers-check-v1",
    effectKey: `truckers:${app.id}:${saved?.leaseId}`,
    state: "ready",
    maxAttempts: 3,
  });
  expect(job?.reference).toEqual({
    applicationId: app.id,
    generation: 1,
    attempt: 1,
    token: saved?.leaseId,
  });
  const before = await admissions.detail(director, app.id);
  expect(before.truckersmpCheck).toMatchObject({ state: "checking", found: null, failure: null });
  expect(before.fields).toMatchObject({
    referralSource: "other",
    referralOther: "A fictional convoy poster",
  });

  respond = async () => player({}, { any: true, count: 2 });
  expect(await work()).toBe(1);
  expect(lookups).toEqual([steamId(1)]);
  const at = time().toISOString();
  expect((await admissions.detail(director, app.id)).truckersmpCheck).toEqual({
    state: "completed",
    notCheckedReason: null,
    found: true,
    playerId: "900000000000001",
    displayName: "Fictional Applicant TMP",
    profileUrl: "https://truckersmp.com/user/900000000000001",
    bans: { any: true, count: 2 },
    vtc: { inVtc: true, id: "900000000001", name: "Fictional Other VTC", tag: "FOV" },
    checkedAt: at,
    lastAttemptAt: at,
    failure: null,
  });
  const done = await check(app.id);
  expect(done).toMatchObject({
    state: "completed",
    leaseId: null,
    leaseUntil: null,
    failure: null,
  });
  // The stored projection holds explicit safe fields only: no member ID or raw payload.
  expect(done?.profile).toEqual({
    playerId: "900000000000001",
    displayName: "Fictional Applicant TMP",
    vtc: { inVtc: true, id: "900000000001", name: "Fictional Other VTC", tag: "FOV" },
    bans: { any: true, count: 2 },
  });
  const list = await admissions.list(director);
  const listed = list.items.find((item) => item.id === app.id);
  expect(listed).toBeDefined();
  expect(listed).not.toHaveProperty("truckersmpCheck");
  expect(listed?.fields).toMatchObject({ referralSource: "other" });
  expect((await admissions.list(director, { historyId: app.id })).items[0]).not.toHaveProperty(
    "truckersmpCheck",
  );
});

test("not found, no VTC, staff accounts without a ban count and vanity links stay distinct", async () => {
  const absent = await submitted(admissions, input({ steamProfileUrl: profileUrl(2) }));
  respond = async () => ({ found: false, profile: null, bans: null });
  await work();
  expect((await admissions.detail(director, absent.id)).truckersmpCheck).toMatchObject({
    state: "completed",
    found: false,
    playerId: null,
    profileUrl: null,
    bans: null,
    vtc: null,
    failure: null,
  });
  expect((await check(absent.id))?.profile).toBeNull();

  const independent = await submitted(admissions, input({ steamProfileUrl: `${profileUrl(3)}/` }));
  respond = async () => player({ vtc: { inVtc: false, id: null, name: null, tag: null } }, null);
  await work();
  expect(lookups.at(-1)).toBe(steamId(3));
  expect((await admissions.detail(director, independent.id)).truckersmpCheck).toMatchObject({
    state: "completed",
    found: true,
    bans: null,
    vtc: { inVtc: false, id: null, name: null, tag: null },
  });

  const vanity = await submitted(
    admissions,
    input({ steamProfileUrl: "https://steamcommunity.com/id/fictional-applicant" }),
  );
  expect(await check(vanity.id)).toBeUndefined();
  expect(await jobs(vanity.id)).toEqual([]);
  expect((await admissions.detail(director, vanity.id)).truckersmpCheck).toEqual({
    state: "not_checked",
    notCheckedReason: "steam_vanity_url",
    found: null,
    playerId: null,
    displayName: null,
    profileUrl: null,
    bans: null,
    vtc: null,
    checkedAt: null,
    lastAttemptAt: null,
    failure: null,
  });
  const receipts = await count("admissions_command_results");
  expect(await status(admissions.recheckTruckers(director, vanity.id, newId()))).toBe(409);
  expect(await count("admissions_command_results")).toBe(receipts);
  expect(await check(vanity.id)).toBeUndefined();
});

test("submission rolls back the application, check and job together when either check write fails", async () => {
  for (const table of ["admissions_truckers_checks", "durable_jobs"]) {
    const before = {
      applications: await count("admissions_applications"),
      receipts: await count("admissions_command_results"),
    };
    const raw = input();
    expect(
      await status(harness({}, failAfterInsert(table)).submit(`pre:${newId()}`, newId(), raw)),
      table,
    ).toBe(500);
    expect({
      applications: await count("admissions_applications"),
      receipts: await count("admissions_command_results"),
    }).toEqual(before);
    const [orphans] = await control.query<RowDataPacket[]>(
      "SELECT (SELECT COUNT(*) FROM durable_jobs) AS jobs, (SELECT COUNT(*) FROM admissions_truckers_checks c LEFT JOIN admissions_applications a ON a.id=c.application_id WHERE a.id IS NULL) AS checks",
    );
    expect({ jobs: Number(orphans[0]?.jobs), checks: Number(orphans[0]?.checks) }).toEqual({
      jobs: 0,
      checks: 0,
    });
  }
});

test("transient provider failures retry with backoff behind a checking state, then complete", async () => {
  const app = await submitted(admissions, input({ steamProfileUrl: profileUrl(4) }));
  respond = fail("unavailable");
  const started = instant;
  await work();
  const first = await check(app.id);
  expect(first).toMatchObject({ state: "checking", failure: "unavailable" });
  const dto = (await admissions.detail(director, app.id)).truckersmpCheck;
  expect(dto).toMatchObject({ state: "checking", failure: null, found: null });
  expect(dto.lastAttemptAt).toBe(new Date(started).toISOString());
  let pending = (await jobs(app.id)).filter((job) => job.state === "ready");
  expect(pending).toHaveLength(1);
  expect(pending[0]?.reference).toMatchObject({ attempt: 2, token: first?.leaseId });
  expect(pending[0]?.availableAt).toBe(stored(new Date(started + 60_000).toISOString()));
  // Not due before the first one-minute backoff.
  expect(await work()).toBe(0);

  instant = started + 60_000;
  respond = fail("rate_limited");
  expect(await work()).toBe(1);
  pending = (await jobs(app.id)).filter((job) => job.state === "ready");
  expect(pending[0]?.reference).toMatchObject({ attempt: 3 });
  expect(pending[0]?.availableAt).toBe(stored(new Date(instant + 300_000).toISOString()));
  expect((await check(app.id))?.failure).toBe("rate_limited");

  instant += 300_000;
  respond = async () => player();
  expect(await work()).toBe(1);
  expect(lookups).toHaveLength(3);
  expect((await admissions.detail(director, app.id)).truckersmpCheck).toMatchObject({
    state: "completed",
    found: true,
    failure: null,
  });
  expect((await jobs(app.id)).map((job) => job.state)).toEqual([
    "completed",
    "completed",
    "completed",
  ]);
});

test("five transient failures end failed, and an invalid response fails without retry", async () => {
  const app = await submitted(admissions, input({ steamProfileUrl: profileUrl(5) }));
  respond = fail("timeout");
  for (const delay of [0, 60_000, 300_000, 900_000, 1_800_000]) {
    instant += delay;
    expect(await work()).toBe(1);
  }
  expect(lookups).toHaveLength(maxCheckAttempts);
  instant += 3_600_000;
  expect(await work()).toBe(0);
  expect(await check(app.id)).toMatchObject({ state: "failed", failure: "timeout", leaseId: null });
  expect((await admissions.detail(director, app.id)).truckersmpCheck).toMatchObject({
    state: "failed",
    failure: "timeout",
    found: null,
  });

  const invalid = await submitted(admissions, input({ steamProfileUrl: profileUrl(6) }));
  respond = fail("invalid_response");
  expect(await work()).toBe(1);
  instant += 3_600_000;
  expect(await work()).toBe(0);
  expect(lookups.filter((id) => id === steamId(6))).toHaveLength(1);
  expect((await admissions.detail(director, invalid.id)).truckersmpCheck).toMatchObject({
    state: "failed",
    failure: "invalid_response",
  });
  expect(await jobs(invalid.id)).toHaveLength(1);
});

test("an expired job lease is reclaimed and the stale claim cannot commit", async () => {
  const app = await submitted(admissions, input({ steamProfileUrl: profileUrl(7) }));
  await control.execute("UPDATE durable_jobs SET available_at=UTC_TIMESTAMP(3)");
  const abandoned = await worker.claim();
  if (!abandoned) throw new Error("SYNTHETIC_CLAIM_MISSING");
  await control.execute(
    "UPDATE durable_jobs SET lease_until=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND WHERE id=?",
    [abandoned.id],
  );
  const reclaimed = await worker.claim();
  expect(reclaimed?.id).toBe(abandoned.id);
  expect(reclaimed?.attempts).toBe(2);
  await expect(worker.execute(abandoned)).rejects.toBeInstanceOf(LeaseLostError);
  if (!reclaimed) throw new Error("SYNTHETIC_RECLAIM_MISSING");
  await worker.execute(reclaimed);
  expect((await check(app.id))?.state).toBe("completed");
  expect(lookups).toEqual([steamId(7)]);
});

test("a recheck during an overdue in-flight lookup starts generation 2 and discards the stale result", async () => {
  const app = await submitted(admissions, input({ steamProfileUrl: profileUrl(8) }));
  const entered = deferred<void>(),
    release = deferred<void>();
  respond = async () => {
    entered.resolve();
    await release.promise;
    return player({ displayName: "Stale Fictional Result" });
  };
  await control.execute("UPDATE durable_jobs SET available_at=UTC_TIMESTAMP(3)");
  const claim = await worker.claim();
  if (!claim) throw new Error("SYNTHETIC_CLAIM_MISSING");
  const running = worker.execute(claim);
  await bounded(entered.promise, "truckers_lookup_entered");
  const started = instant;
  // Past the ten-minute check lease the running check reads as failed and may restart.
  instant += 600_001;
  expect((await admissions.detail(director, app.id)).truckersmpCheck).toMatchObject({
    state: "failed",
    failure: "unavailable",
  });
  const restarted = await admissions.recheckTruckers(director, app.id, newId());
  expect(restarted).toMatchObject({ state: "checking", failure: null });
  expect(await check(app.id)).toMatchObject({ generation: 2, state: "checking" });
  release.resolve();
  await running;
  expect(await check(app.id)).toMatchObject({ generation: 2, state: "checking", found: null });
  const second = (await jobs(app.id)).find((job) => job.state === "ready");
  expect(second?.reference).toMatchObject({ generation: 2, attempt: 1 });
  // The last provider attempt is more than a minute old, so generation 2 is due at once.
  expect(second?.availableAt).toBe(stored(new Date(instant).toISOString()));
  expect((await check(app.id))?.lastAttemptAt).toBe(stored(new Date(started).toISOString()));
  respond = async () => player();
  expect(await work()).toBe(1);
  expect((await admissions.detail(director, app.id)).truckersmpCheck).toMatchObject({
    state: "completed",
    displayName: "Fictional Applicant TMP",
  });
});

test("recheck over HTTP needs applications.manage, CSRF, a UUID key and no body, and replays its result", async () => {
  const app = await submitted(admissions, input({ steamProfileUrl: profileUrl(9) }));
  await work();
  const server = await createApp({ identity, admissions, checkReadiness: async () => true });
  const url = `/api/v1/admin/applications/${app.id}/truckersmp-checks`;
  const headers = (cookie: string, actor: Actor, key: string = newId()) => ({
    cookie,
    origin,
    "x-csrf-token": csrfProtection(identityConfig).issue({}, actor).token,
    "idempotency-key": key,
  });
  try {
    const dispatcher = await signedIn(["dispatcher"]);
    for (const request of [
      { method: "POST" as const, url, headers: headers(dispatcher.cookie, dispatcher.actor) },
      {
        method: "GET" as const,
        url: `/api/v1/admin/applications/${app.id}`,
        headers: { cookie: dispatcher.cookie },
      },
      {
        method: "GET" as const,
        url: "/api/v1/admin/applications",
        headers: { cookie: dispatcher.cookie },
      },
    ]) {
      const denied = await server.inject(request);
      expect(denied.statusCode, request.url).toBe(403);
      expect(denied.body.includes("900000000000001")).toBe(false);
      expect(denied.body.includes("truckersmpCheck")).toBe(false);
    }
    const valid = headers(directorCookie, director);
    const { "x-csrf-token": _csrf, ...noCsrf } = valid;
    expect((await server.inject({ method: "POST", url, headers: noCsrf })).statusCode).toBe(403);
    const { "idempotency-key": _key, ...noKey } = valid;
    expect((await server.inject({ method: "POST", url, headers: noKey })).statusCode).toBe(422);
    expect(
      (await server.inject({ method: "POST", url, headers: { ...valid, "idempotency-key": "1" } }))
        .statusCode,
    ).toBe(422);
    expect(
      (
        await server.inject({
          method: "POST",
          url,
          headers: { ...valid, "content-type": "application/json" },
          payload: "{}",
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await server.inject({
          method: "POST",
          url,
          headers: { ...valid, "content-type": "text/plain" },
          payload: "fictional",
        })
      ).statusCode,
    ).toBe(415);
    expect(
      (
        await server.inject({
          method: "POST",
          url: `/api/v1/admin/applications/${newId()}/truckersmp-checks`,
          headers: headers(directorCookie, director),
        })
      ).statusCode,
    ).toBe(404);
    expect(await jobs(app.id)).toHaveLength(1);

    const key = newId();
    const accepted = await server.inject({
      method: "POST",
      url,
      headers: headers(directorCookie, director, key),
    });
    expect(accepted.statusCode).toBe(202);
    expect(accepted.headers["cache-control"]).toBe("no-store");
    expect(accepted.headers.etag).toBeUndefined();
    const data = accepted.json().data;
    // A new generation keeps the previous successful result until it is replaced.
    expect(data).toMatchObject({
      state: "checking",
      found: true,
      playerId: "900000000000001",
      failure: null,
    });
    expect(accepted.json().meta.requestId).toBeTruthy();
    expect(await check(app.id)).toMatchObject({ generation: 2, state: "checking", found: 1 });
    expect(await jobs(app.id)).toHaveLength(2);

    const replay = await server.inject({
      method: "POST",
      url,
      headers: headers(directorCookie, director, key),
    });
    expect(replay.statusCode).toBe(202);
    expect(replay.json().data).toEqual(data);
    const running = await server.inject({
      method: "POST",
      url,
      headers: headers(directorCookie, director),
    });
    expect(running.statusCode).toBe(202);
    expect(running.json().data).toEqual(data);
    expect(await check(app.id)).toMatchObject({ generation: 2 });
    expect(await jobs(app.id)).toHaveLength(2);

    instant += 60_000;
    expect(await work()).toBe(1);
    expect(
      (
        await server.inject({
          method: "POST",
          url,
          headers: headers(directorCookie, director, key),
        })
      ).json().data,
    ).toEqual(data);
    const detail = await server.inject({
      url: `/api/v1/admin/applications/${app.id}`,
      headers: { cookie: directorCookie },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.truckersmpCheck).toMatchObject({ state: "completed", found: true });
    const listed = await server.inject({
      url: "/api/v1/admin/applications",
      headers: { cookie: directorCookie },
    });
    expect(listed.statusCode).toBe(200);
    for (const item of listed.json().data.items) expect(item).not.toHaveProperty("truckersmpCheck");
    // A completed check starts generation 3 on a fresh key.
    const again = await server.inject({
      method: "POST",
      url,
      headers: headers(directorCookie, director),
    });
    expect(again.statusCode).toBe(202);
    expect(await check(app.id)).toMatchObject({ generation: 3, state: "checking" });
  } finally {
    await server.close();
  }
});

test("without the provider adapter submissions create no check, reads say not_requested and recheck is 503", async () => {
  const disabled = harness({}, unit, null);
  expect(disabled.truckersHandler).toBeUndefined();
  const app = await submitted(disabled, input({ steamProfileUrl: profileUrl(10) }));
  expect(await check(app.id)).toBeUndefined();
  expect(await jobs(app.id)).toEqual([]);
  expect((await disabled.detail(director, app.id)).truckersmpCheck).toMatchObject({
    state: "not_checked",
    notCheckedReason: "not_requested",
  });
  expect(Object.keys((await disabled.detail(director, app.id)).fields).sort()).toEqual([
    "discord",
    "email",
    "games",
    "introduction",
    "nickname",
    "steamProfileUrl",
  ]);
  const receipts = await count("admissions_command_results");
  expect(await status(disabled.recheckTruckers(director, app.id, newId()))).toBe(503);
  expect(await status(disabled.recheckTruckers(director, newId(), newId()))).toBe(404);
  expect(await count("admissions_command_results")).toBe(receipts);

  // Composition without external identities pauses the check kind for the shared worker.
  const composed = composeIdentity(unit, identityConfig, undefined, config, false);
  expect(composed.admissions?.truckersHandler).toBeUndefined();
  await submitted(admissions, input({ steamProfileUrl: profileUrl(11) }));
  await control.execute("UPDATE durable_jobs SET available_at=UTC_TIMESTAMP(3)");
  expect(await composed.jobsQueue.claim()).toBeNull();
  expect(
    composeIdentity(unit, identityConfig, undefined, config, true).admissions?.truckersHandler,
  ).toBeDefined();
});

test("deleting an application deletes its check row and the orphaned job is a no-op", async () => {
  const app = await submitted(admissions, input({ steamProfileUrl: profileUrl(12) }));
  expect(await check(app.id)).toBeDefined();
  await control.execute("DELETE FROM admissions_applications WHERE id=?", [app.id]);
  expect(await check(app.id)).toBeUndefined();
  expect(await work()).toBe(1);
  expect(lookups).toEqual([]);
  expect(await check(app.id)).toBeUndefined();
  expect((await jobs(app.id)).map((job) => job.state)).toEqual(["completed"]);
});

test("referral answers round-trip over HTTP and misplaced free text is 422 without a row or receipt", async () => {
  const server = await createApp({ identity, admissions, checkReadiness: async () => true });
  try {
    const issued = await server.inject({ url: "/api/v1/auth/csrf" });
    const cookie = String(issued.headers["set-cookie"]).split(";", 1)[0] as string;
    const headers = { cookie, origin, "x-csrf-token": issued.json().data.token as string };
    const before = {
      applications: await count("admissions_applications"),
      receipts: await count("admissions_command_results"),
    };
    for (const extra of [
      { referralOther: "Fictional text without a source" },
      { referralSource: "discord", referralOther: "Fictional text with another source" },
      { referralSource: "other", referralOther: String.fromCodePoint(0x85) },
      { referralSource: "other", referralOther: "x".repeat(201) },
    ]) {
      const response = await server.inject({
        method: "POST",
        url: "/api/v1/public/applications",
        headers: { ...headers, "idempotency-key": newId() },
        payload: { ...input(), ...extra },
      });
      expect(response.statusCode, JSON.stringify(extra).slice(0, 80)).toBe(422);
      expect(response.json().error.code).toBe("INVALID_PAYLOAD");
    }
    expect({
      applications: await count("admissions_applications"),
      receipts: await count("admissions_command_results"),
    }).toEqual(before);
    const raw = input({
      steamProfileUrl: "https://steamcommunity.com/id/fictional-referral",
      referralSource: "other",
      referralOther: `${"\u{1F69A}".repeat(199)}x`,
    });
    const created = await server.inject({
      method: "POST",
      url: "/api/v1/public/applications",
      headers: { ...headers, "idempotency-key": newId() },
      payload: raw,
    });
    expect(created.statusCode).toBe(201);
    const app = await submitted(admissions, input({ referralSource: "youtube_or_twitch" }));
    const [saved] = await unit.run((tx) =>
      unit.client(tx).select().from(applications).where(eq(applications.emailKey, raw.email)),
    );
    if (!saved) throw new Error("SYNTHETIC_APPLICATION_MISSING");
    expect(saved).toMatchObject({ referralSource: "other", referralOther: raw.referralOther });
    const detail = await server.inject({
      url: `/api/v1/admin/applications/${saved.id}`,
      headers: { cookie: directorCookie },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.fields).toMatchObject({
      referralSource: "other",
      referralOther: raw.referralOther,
    });
    const plain = (await admissions.detail(director, app.id)).fields;
    expect(plain).toMatchObject({ referralSource: "youtube_or_twitch" });
    expect(plain).not.toHaveProperty("referralOther");
  } finally {
    await server.close();
  }
});

test("API free-text acceptance is a subset of the MySQL nonblank CHECK, which still guards direct writes", async () => {
  const candidates = [
    0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x85, 0xa0, 0xad, 0x1680, 0x180e,
    0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x200b,
    0x2028, 0x2029, 0x202f, 0x205f, 0x2060, 0x3000, 0xfeff,
  ];
  const results: { code: string; api: boolean; database: boolean }[] = [];
  for (const code of candidates) {
    const value = String.fromCodePoint(code);
    let api = true;
    try {
      validateApplication({ ...input(), referralSource: "other", referralOther: value });
    } catch {
      api = false;
    }
    const [rows] = await control.execute<RowDataPacket[]>(
      "SELECT REGEXP_LIKE(?, '[^[:space:]]') AS accepted",
      [value],
    );
    results.push({ code: code.toString(16), api, database: Number(rows[0]?.accepted) === 1 });
  }
  expect(results.filter((result) => result.api && !result.database)).toEqual([]);
  // Characters both sides treat as visible content stay accepted.
  for (const code of ["ad", "180e", "200b", "2060"])
    expect(results.find((result) => result.code === code)?.api, code).toBe(true);

  const direct = (other: string) =>
    control.execute(
      "INSERT INTO admissions_applications (id, submitted_at, nickname, email, email_key, steam_profile_url, games, referral_source, referral_other) VALUES (?, UTC_TIMESTAMP(3), 'Fictional Direct', ?, ?, 'https://steamcommunity.com/id/fictional-direct', JSON_ARRAY('ets2'), 'other', ?)",
      [newId(), "direct@example.invalid", "direct@example.invalid", other],
    );
  await control.beginTransaction();
  try {
    await expect(direct(String.fromCodePoint(0x85))).rejects.toMatchObject({ errno: 3819 });
    await expect(direct(" \t ")).rejects.toMatchObject({ errno: 3819 });
  } finally {
    await control.rollback();
  }
  expect(
    await status(
      admissions.submit(`pre:${newId()}`, newId(), {
        ...input(),
        referralSource: "other",
        referralOther: String.fromCodePoint(0x85),
      }),
    ),
  ).toBe(422);
});
