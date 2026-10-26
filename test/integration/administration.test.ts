import { randomBytes } from "node:crypto";
import { createUnitOfWork, newId, runMigrations, type UnitOfWork } from "@vtc/db";
import { eq, membership, user, company } from "@vtc/db/identity-schema";
import { steamAccounts, steamLinks } from "@vtc/db/external-identities-schema";
import { qualificationAssignments } from "@vtc/db/qualifications-schema";
import type { Connection, RowDataPacket } from "mysql2/promise";
import {
  beforeEach,
  expect,
  test,
  beforeAll as vitestBeforeAll,
  afterAll as vitestAfterAll,
} from "vitest";
import { createApp } from "../../apps/api/src/app.ts";
import {
  createIdentity,
  type Actor,
  type PrivateChallenge,
} from "../../apps/api/src/modules/identity/service.ts";
import {
  createQualificationInitialization,
  structuralLevels,
} from "../../apps/api/src/modules/qualifications/initialization.ts";
import { identityAccessEvents } from "../../apps/api/src/platform/outbox/events.ts";
import { createAdministration } from "../../apps/api/src/use-cases/administration.ts";
import { composeIdentity } from "../../apps/api/src/use-cases/identity-messaging.ts";
import {
  guardedSettings,
  reset,
  SCHEMA_SETUP_TIMEOUT_MS,
  testConnection,
} from "../persistence/support.ts";
import { schemaLifecycleHooks } from "../support/schema-lifecycle.ts";

const { beforeAll, afterAll } = schemaLifecycleHooks(vitestBeforeAll, vitestAfterAll);
const origin = "http://127.0.0.1:4173",
  password = "Fictional-admin-test-passphrase-42",
  cfg = { secret: randomBytes(32).toString("hex"), origin, production: false };
let unit: UnitOfWork,
  control: Connection,
  composed: ReturnType<typeof composeIdentity>,
  director: Actor,
  directorCookie: string;
const enabled = {
  telemetry: true,
  manual: false,
  qualifications: false,
  externalIdentities: true,
  admissions: true,
  mail: false,
};
const cookies = (values: readonly string[]) =>
  values.map((value) => value.split(";", 1)[0]).join("; ");
async function member(
  roles: ("driver" | "trainee" | "dispatcher" | "deputy_director")[] = ["driver"],
) {
  const id = newId(),
    email = `${id}@example.invalid`,
    credential = await composed.identity.prepareCredential(password);
  await unit.run(async (tx) => {
    await composed.identity.insertWithCredential(tx, {
      userId: id,
      email,
      name: "Fictional Administration Member",
      roles,
      ...credential,
    });
    await createQualificationInitialization(unit).initialize(tx, {
      userId: id,
      games: ["ets2", "ats"],
      assignedAt: new Date(Date.now() - 10000).toISOString(),
    });
  });
  const login = await composed.identity.login(email, password),
    cookie = cookies(login.cookies);
  return {
    id,
    email,
    cookie,
    actor: await composed.identity.authenticate(new Headers({ cookie })),
  };
}
async function linkSteam(id: string) {
  const steamId = `7656119${String(BigInt(`0x${randomBytes(5).toString("hex")}`))
    .padStart(10, "0")
    .slice(-10)}`;
  await unit.run(async (tx) => {
    await unit
      .client(tx)
      .insert(steamAccounts)
      .values({ steamId, userId: id, createdAt: new Date() });
    await unit.client(tx).insert(steamLinks).values({ userId: id, steamId });
  });
}
async function browser(cookie = directorCookie) {
  const app = await createApp({ ...composed, checkReadiness: async () => true });
  const csrf = await app.inject({ url: "/api/v1/auth/csrf", headers: { cookie } });
  return {
    app,
    headers: { cookie, origin, "x-csrf-token": csrf.json().data.token, "idempotency-key": newId() },
  };
}
beforeAll(async () => {
  control = await testConnection();
  await reset(control);
  await runMigrations(guardedSettings());
  unit = createUnitOfWork(guardedSettings());
  composed = composeIdentity(
    unit,
    cfg,
    undefined,
    { key: randomBytes(32).toString("base64url"), origin },
    true,
    undefined,
    { cursorKey: randomBytes(32).toString("hex") },
    { cursorKey: randomBytes(32).toString("hex"), ipPerMinute: 6000, globalPerMinute: 12000 },
  );
  await composed.identity.bootstrap({
    email: "administration-director@example.invalid",
    name: "Fictional Administration Director",
    password,
  });
  const login = await composed.identity.login("administration-director@example.invalid", password);
  directorCookie = cookies(login.cookies);
  director = await composed.identity.authenticate(new Headers({ cookie: directorCookie }));
}, SCHEMA_SETUP_TIMEOUT_MS);
beforeEach(async () => {
  await control.query("DELETE FROM identity_limits");
  await control.query("DELETE FROM admissions_limits");
});
afterAll(async () => {
  await unit?.close();
  await control?.end();
});

test("new HTTP families enforce current roles, Origin/CSRF, versions and bounded private projections", async () => {
  const ordinary = await member(),
    deputy = await member(["deputy_director"]),
    { app, headers } = await browser();
  try {
    for (const path of [
      "/admin/members",
      "/admin/reinstatement-options",
      `/admin/members/${ordinary.id}`,
      "/admin/company-settings",
      "/admin/audit",
      "/admin/source-capabilities",
    ]) {
      expect((await app.inject({ url: `/api/v1${path}` })).statusCode).toBe(401);
      expect(
        (await app.inject({ url: `/api/v1${path}`, headers: { cookie: ordinary.cookie } }))
          .statusCode,
      ).toBe(403);
      expect(
        (await app.inject({ url: `/api/v1${path}`, headers: { cookie: deputy.cookie } }))
          .statusCode,
      ).toBe(200);
    }
    expect(
      (await app.inject({ url: "/api/v1/qualification-levels?game=ets2", headers })).statusCode,
    ).toBe(404);
    const choices = await app.inject({ url: "/api/v1/admin/reinstatement-options", headers });
    expect(choices.statusCode).toBe(200);
    expect(choices.json().data.levels).toHaveLength(8);
    expect(Object.keys(choices.json().data.levels[0]).sort()).toEqual([
      "code",
      "game",
      "id",
      "name",
    ]);
    const detail = await app.inject({ url: `/api/v1/admin/members/${ordinary.id}`, headers });
    expect(detail.json().data.profile.qualifications).toHaveLength(2);
    expect(Object.keys(detail.json().data).sort()).toEqual([
      "accessEpoch",
      "email",
      "identityEpoch",
      "profile",
      "status",
      "version",
    ]);
    const path = `/api/v1/admin/members/${ordinary.id}/roles`,
      payload = { roles: ["driver", "dispatcher"], reason: "Fictional additive assignment" };
    expect(
      (
        await app.inject({
          method: "PUT",
          url: path,
          headers: { ...headers, origin: "https://other.example.invalid", "if-match": '"v1"' },
          payload,
        })
      ).statusCode,
    ).toBe(403);
    expect((await app.inject({ method: "PUT", url: path, headers, payload })).statusCode).toBe(428);
    const changed = await app.inject({
      method: "PUT",
      url: path,
      headers: { ...headers, "if-match": '"v1"' },
      payload,
    });
    expect(changed.statusCode).toBe(200);
    expect(
      await composed.identity.authenticate(new Headers({ cookie: ordinary.cookie })).then(
        () => 200,
        () => 401,
      ),
    ).toBe(401);
    const after = await app.inject({ url: `/api/v1/admin/members/${ordinary.id}`, headers });
    expect(after.json().data.profile.member.roles).toEqual(["dispatcher", "driver"]);
    expect(after.json().data.profile.qualifications).toEqual(
      detail.json().data.profile.qualifications,
    );
    expect(
      (
        await app.inject({
          method: "PUT",
          url: path,
          headers: { ...headers, "idempotency-key": newId(), "if-match": '"v1"' },
          payload,
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/api/v1/admin/members/${director.userId}/roles`,
          headers: { ...headers, "idempotency-key": newId(), "if-match": '"v1"' },
          payload,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/admin/leadership/challenges",
          headers: { ...headers, cookie: deputy.cookie },
          payload: { successorId: ordinary.id },
        })
      ).statusCode,
    ).toBe(403);
  } finally {
    await app.close();
  }
});

test("admin keysets bind session, status, route and limit and audit excludes private content", async () => {
  const administration = composed.administration,
    target = await member(),
    first = await administration.members(director, { limit: 1 }),
    cursor = first.nextCursor as string;
  expect(cursor).toBeTruthy();
  expect(
    (await administration.members(director, { limit: 1, cursor })).items[0]?.profile.member.id,
  ).not.toBe(first.items[0]?.profile.member.id);
  for (const [actor, options] of [
    [
      { ...director, sessionId: target.actor.sessionId },
      { limit: 1, cursor },
    ],
    [director, { limit: 2, cursor }],
    [director, { limit: 1, status: "inactive" as const, cursor }],
    [director, { limit: 1, cursor: `${cursor}x` }],
  ] as const)
    await expect(administration.members(actor, options)).rejects.toMatchObject({
      statusCode: expect.any(Number),
    });
  await expect(administration.audit(director, { limit: 1, cursor })).rejects.toMatchObject({
    statusCode: 409,
  });
  const rows = await administration.audit(director, { limit: 100 });
  expect(rows.items.length).toBeGreaterThan(0);
  for (const row of rows.items)
    expect(Object.keys(row).sort()).toEqual(["action", "actorId", "id", "occurredAt", "subjectId"]);
  const [plan] = await control.query<RowDataPacket[]>(
    "EXPLAIN SELECT id,actor_id,operation,subject_id,occurred_at FROM audit_entries WHERE company_id=? OR company_id IS NULL ORDER BY occurred_at DESC,id DESC LIMIT 26",
    [(await administration.settings(director)).id],
  );
  expect(plan.length).toBeGreaterThan(0);
});

test("deactivation and explicit reinstatement retain identity/history and never revive old credentials", async () => {
  const target = await member();
  await linkSteam(target.id);
  const telemetry = composed.telemetry;
  if (!telemetry) throw new Error("SYNTHETIC_TELEMETRY_REQUIRED");
  const issued = await telemetry.issue(target.actor, newId(), { label: "Fictional lifecycle" }),
    { app, headers } = await browser();
  try {
    const deactivate = await app.inject({
      method: "POST",
      url: `/api/v1/admin/members/${target.id}/deactivation`,
      headers: { ...headers, "if-match": '"v1"' },
      payload: { reason: "Fictional leave" },
    });
    expect(deactivate.statusCode).toBe(200);
    expect(
      (await app.inject({ url: "/api/v1/me", headers: { cookie: target.cookie } })).statusCode,
    ).toBe(401);
    await expect(telemetry.connection(`Bearer ${issued.token}`, "127.0.0.1")).rejects.toMatchObject(
      { statusCode: 401 },
    );
    const assignment = {
      game: "ets2" as const,
      levelId: structuralLevels.ets2[1],
      purpose: "reinstatement" as const,
      reason: "Fictional return",
    };
    for (const assignments of [
      [assignment, assignment],
      [{ ...assignment, levelId: structuralLevels.ats[0] }],
      [{ ...assignment, purpose: "initial" }],
      [{ ...assignment, assignedAt: new Date().toISOString() }],
    ]) {
      const denied = await app.inject({
        method: "POST",
        url: `/api/v1/admin/members/${target.id}/reinstatement`,
        headers: { ...headers, "idempotency-key": newId(), "if-match": '"v2"' },
        payload: { roles: ["driver"], assignments, reason: "Fictional return" },
      });
      expect([409, 422]).toContain(denied.statusCode);
    }
    const restored = await app.inject({
      method: "POST",
      url: `/api/v1/admin/members/${target.id}/reinstatement`,
      headers: { ...headers, "idempotency-key": newId(), "if-match": '"v2"' },
      payload: {
        roles: ["driver", "dispatcher"],
        assignments: [assignment],
        reason: "Fictional explicit return",
      },
    });
    expect(restored.statusCode).toBe(200);
    const login = await composed.identity.login(target.email, password);
    expect(login.data.member.id).toBe(target.id);
    await expect(telemetry.connection(`Bearer ${issued.token}`, "127.0.0.1")).rejects.toMatchObject(
      { statusCode: 401 },
    );
    const periods = await unit.run((tx) =>
      unit
        .client(tx)
        .select()
        .from(qualificationAssignments)
        .where(eq(qualificationAssignments.userId, target.id)),
    );
    expect(periods).toHaveLength(3);
    expect(periods.filter((row) => row.endedAt === null)).toHaveLength(1);
    expect(periods.find((row) => row.purpose === "reinstatement")?.levelId).toBe(
      assignment.levelId,
    );
  } finally {
    await app.close();
  }
});

test("reinstatement qualification/event failure rolls back status, roles, periods and credential invalidation", async () => {
  const target = await member();
  await composed.identity.administer(director, target.id, newId(), 1, { kind: "deactivate" });
  const lifecycle = createQualificationInitialization(unit),
    broken = createIdentity(unit, cfg, {
      accessEvents: {
        append: async () => {
          throw new Error("SYNTHETIC_ACCESS_EVENT_FAILURE");
        },
      },
      qualificationsLifecycle: lifecycle,
    });
  const before = await unit.run((tx) =>
    unit
      .client(tx)
      .select()
      .from(qualificationAssignments)
      .where(eq(qualificationAssignments.userId, target.id)),
  );
  await expect(
    broken.administer(director, target.id, newId(), 2, {
      kind: "reinstate",
      roles: ["driver"],
      qualifications: [
        {
          game: "ets2",
          levelId: structuralLevels.ets2[0],
          purpose: "reinstatement",
          reason: "Fictional rollback",
        },
      ],
    }),
  ).rejects.toThrow();
  const [after] = await unit.run((tx) =>
    unit.client(tx).select().from(membership).where(eq(membership.userId, target.id)),
  );
  expect(after?.status).toBe("inactive");
  expect(after?.version).toBe(2);
  expect(
    await unit.run((tx) =>
      unit
        .client(tx)
        .select()
        .from(qualificationAssignments)
        .where(eq(qualificationAssignments.userId, target.id)),
    ),
  ).toEqual(before);
});

test("timezone settings remain partial without qualification setup and update real company reporting state", async () => {
  const { app, headers } = await browser();
  try {
    const initial = await app.inject({ url: "/api/v1/admin/company-settings", headers });
    expect(initial.json().data.reportingTimezone).toBeNull();
    expect(initial.json().data.launchReady).toBe(false);
    for (const reportingTimezone of ["Not/A_Zone", "+03:00"])
      expect(
        (
          await app.inject({
            method: "PATCH",
            url: "/api/v1/admin/company-settings",
            headers: { ...headers, "if-match": initial.headers.etag },
            payload: { reportingTimezone },
          })
        ).statusCode,
      ).toBe(422);
    const changed = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/company-settings",
      headers: { ...headers, "idempotency-key": newId(), "if-match": initial.headers.etag },
      payload: { reportingTimezone: "Europe/Warsaw" },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().data.missingSetup).toEqual(["qualification_configuration"]);
    expect(changed.json().data.launchReady).toBe(false);
    expect((await composed.identity.current(director)).data.missingSetup).not.toContain(
      "company_reporting_timezone",
    );
    const source = await composed.administration.sources(director);
    expect(source.sources.find((row) => row.provider === "manual")?.runtimeEnabled).toBe(false);
    expect(source.sources.filter((row) => !row.implemented).map((row) => row.provider)).toEqual([
      "trucky",
      "vtcbase",
    ]);
  } finally {
    await app.close();
  }
});

test("bound succession HTTP accepts only challenge/code and preserves singleton leadership under concurrent confirmation", async () => {
  const successor = await member(["driver", "dispatcher"]),
    deliveries: PrivateChallenge[] = [];
  await unit.run((tx) =>
    unit.client(tx).update(user).set({ emailVerified: true }).where(eq(user.id, director.userId)),
  );
  const identity = createIdentity(unit, cfg, {
      accessEvents: identityAccessEvents(unit),
      delivery: {
        enqueue: async (_tx, value) => {
          deliveries.push(value);
        },
      },
    }),
    administration = createAdministration(unit, identity, enabled),
    app = await createApp({ identity, administration, checkReadiness: async () => true });
  try {
    const csrf = await app.inject({
        url: "/api/v1/auth/csrf",
        headers: { cookie: directorCookie },
      }),
      headers = {
        cookie: directorCookie,
        origin,
        "x-csrf-token": csrf.json().data.token,
        "idempotency-key": newId(),
      };
    const challenge = await app.inject({
      method: "POST",
      url: "/api/v1/admin/leadership/challenges",
      headers,
      payload: { successorId: successor.id },
    });
    expect(challenge.statusCode).toBe(202);
    const code = deliveries.at(-1)?.code;
    if (!code) throw new Error("SYNTHETIC_CHALLENGE_REQUIRED");
    const body = { challengeId: challenge.json().data.id, code };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/admin/leadership/transfers",
          headers: { ...headers, "idempotency-key": newId() },
          payload: { ...body, successorId: director.userId },
        })
      ).statusCode,
    ).toBe(422);
    const results = await Promise.all(
      [1, 2].map(() =>
        app.inject({
          method: "POST",
          url: "/api/v1/admin/leadership/transfers",
          headers: { ...headers, "idempotency-key": newId() },
          payload: body,
        }),
      ),
    );
    expect(results.filter((row) => row.statusCode === 200)).toHaveLength(1);
    const [current] = await unit.run((tx) => unit.client(tx).select().from(company));
    expect(current?.directorUserId).toBe(successor.id);
    expect((await identity.current(director)).data.member.roles).toEqual(["driver"]);
    expect((await identity.current(successor.actor)).data.member.roles).toEqual([
      "director",
      "dispatcher",
      "driver",
    ]);
  } finally {
    await unit.run((tx) =>
      unit
        .client(tx)
        .update(company)
        .set({ directorUserId: director.userId })
        .where(eq(company.singleton, 1)),
    );
    await app.close();
  }
});
