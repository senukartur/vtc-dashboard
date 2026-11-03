import { randomBytes } from "node:crypto";
import { createUnitOfWork, newId, runMigrations, type UnitOfWork } from "@vtc/db";
import { eq, membership, user, company, roles as identityRoles } from "@vtc/db/identity-schema";
import { steamAccounts, steamLinks } from "@vtc/db/external-identities-schema";
import { qualificationAssignments } from "@vtc/db/qualifications-schema";
import { trips } from "@vtc/db/trips-schema";
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
import { fixtureDatabaseFailure } from "../support/fixture-database-diagnostics.ts";
import { safeIdentityFailure } from "../support/identity-diagnostics.ts";
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
  trips: true,
};
const cookies = (values: readonly string[]) =>
  values.map((value) => value.split(";", 1)[0]).join("; ");
async function member(
  roles: ("driver" | "trainee" | "dispatcher" | "deputy_director")[] = ["driver"],
  name = "Fictional Administration Member",
) {
  const id = newId(),
    email = `${id}@example.invalid`,
    credential = await composed.identity.prepareCredential(password);
  await unit.run(async (tx) => {
    await composed.identity.insertWithCredential(tx, {
      userId: id,
      email,
      name,
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
  expect(csrf.statusCode).toBe(200);
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

test("new HTTP read families enforce current roles and bounded private projections", async () => {
  const ordinary = await member(),
    deputy = await member(["deputy_director"]),
    { app } = await browser();
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
  } finally {
    await app.close();
  }
});

test("member command journey preserves versions, idempotency and protected targets within its own source phase", async () => {
  const ordinary = await member(),
    deputy = await member(["deputy_director"]),
    { app, headers } = await browser();
  try {
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
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.profile.qualifications).toHaveLength(2);
    expect(Object.keys(detail.json().data).sort()).toEqual([
      "accessEpoch",
      "email",
      "identityEpoch",
      "lastAcceptedTripAt",
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
    const changedReason = await app.inject({
      method: "PUT",
      url: path,
      headers: { ...headers, "if-match": '"v1"' },
      payload: { ...payload, reason: "Fictional different rationale" },
    });
    expect(changedReason.statusCode).toBe(409);
    expect(changedReason.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(
      await composed.identity.authenticate(new Headers({ cookie: ordinary.cookie })).then(
        () => 200,
        () => 401,
      ),
    ).toBe(401);
    const after = await app.inject({ url: `/api/v1/admin/members/${ordinary.id}`, headers });
    expect(after.statusCode).toBe(200);
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
    expect(initial.statusCode).toBe(200);
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

// Identity admission charges every admin request per source; reset between phases of one test.
const resetLimits = () => control.query("DELETE FROM identity_limits");
async function csrfHeaders(app: Awaited<ReturnType<typeof createApp>>, cookie: string) {
  const csrf = await app.inject({ url: "/api/v1/auth/csrf", headers: { cookie } });
  expect(csrf.statusCode).toBe(200);
  return { cookie, origin, "x-csrf-token": csrf.json().data.token as string };
}
async function memberRow(id: string) {
  const [row] = await unit.run((tx) =>
    unit.client(tx).select().from(membership).where(eq(membership.userId, id)),
  );
  if (!row) throw new Error("SYNTHETIC_MEMBER_REQUIRED");
  return row;
}
async function explicitRoles(id: string) {
  return (
    await unit.run((tx) =>
      unit
        .client(tx)
        .select({ role: identityRoles.role })
        .from(identityRoles)
        .where(eq(identityRoles.userId, id)),
    )
  )
    .map((row) => row.role)
    .sort();
}
async function assignmentRows(id: string) {
  return unit.run((tx) =>
    unit
      .client(tx)
      .select()
      .from(qualificationAssignments)
      .where(eq(qualificationAssignments.userId, id))
      .orderBy(qualificationAssignments.id),
  );
}
async function membershipAudits(subjectId: string, actorId: string) {
  const [rows] = await control.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM audit_entries WHERE operation = 'membership.changed' AND subject_id = ? AND actor_id = ?",
    [subjectId, actorId],
  );
  return Number(rows[0]?.n);
}

test("direct membership change replaces only Trainee/Driver and keeps other roles, qualifications, sessions and credentials", async () => {
  const telemetry = composed.telemetry;
  if (!telemetry) throw new Error("SYNTHETIC_TELEMETRY_REQUIRED");
  const deputy = await member(["deputy_director"]),
    { app } = await browser();
  try {
    for (const actor of [
      { id: director.userId, cookie: directorCookie },
      { id: deputy.id, cookie: deputy.cookie },
    ]) {
      await resetLimits();
      const target = await member(["driver", "dispatcher"]);
      await linkSteam(target.id);
      const issued = await telemetry.issue(target.actor, newId(), {
        label: "Fictional membership",
      });
      const headers = await csrfHeaders(app, actor.cookie),
        path = `/api/v1/admin/members/${target.id}/membership`,
        detailPath = `/api/v1/admin/members/${target.id}`;
      const before = await app.inject({ url: detailPath, headers: { cookie: actor.cookie } });
      expect(before.statusCode).toBe(200);
      expect(before.headers.etag).toBe('"v1"');
      const rowBefore = await memberRow(target.id),
        periodsBefore = await assignmentRows(target.id),
        auditsBefore = await membershipAudits(target.id, actor.id);
      let version = 1;
      for (const [membershipRole, expected] of [
        ["trainee", ["dispatcher", "trainee"]],
        ["driver", ["dispatcher", "driver"]],
      ] as const) {
        const changed = await app.inject({
          method: "PUT",
          url: path,
          headers: { ...headers, "idempotency-key": newId(), "if-match": `"v${version}"` },
          payload: { membership: membershipRole, reason: "Fictional membership change" },
        });
        expect(changed.statusCode).toBe(200);
        version += 1;
        expect(changed.json().data).toEqual({ id: target.id, version });
        expect(changed.headers.etag).toBe(`"v${version}"`);
        const after = await app.inject({ url: detailPath, headers: { cookie: actor.cookie } });
        expect(after.statusCode).toBe(200);
        expect(after.headers.etag).toBe(`"v${version}"`);
        expect(after.json().data.version).toBe(version);
        expect(after.json().data.profile.member.roles).toEqual(expected);
        expect(after.json().data.profile.qualifications).toEqual(
          before.json().data.profile.qualifications,
        );
        expect(await explicitRoles(target.id)).toEqual(expected);
      }
      expect(await assignmentRows(target.id)).toEqual(periodsBefore);
      const rowAfter = await memberRow(target.id);
      expect(rowAfter.version).toBe(rowBefore.version + 2);
      expect({
        status: rowAfter.status,
        accessEpoch: rowAfter.accessEpoch,
        credentialEpoch: rowAfter.credentialEpoch,
        identityEpoch: rowAfter.identityEpoch,
      }).toEqual({
        status: rowBefore.status,
        accessEpoch: rowBefore.accessEpoch,
        credentialEpoch: rowBefore.credentialEpoch,
        identityEpoch: rowBefore.identityEpoch,
      });
      // The member's existing session and telemetry credential keep working.
      expect(
        (await composed.identity.authenticate(new Headers({ cookie: target.cookie }))).userId,
      ).toBe(target.id);
      expect(
        (await app.inject({ url: "/api/v1/me", headers: { cookie: target.cookie } })).statusCode,
      ).toBe(200);
      const [tokens] = await control.query<RowDataPacket[]>(
        "SELECT revoked_at FROM telemetry_tokens WHERE owner_id = ?",
        [target.id],
      );
      expect(tokens).toHaveLength(1);
      expect(tokens[0]?.revoked_at).toBeNull();
      await expect(
        telemetry.connection(`Bearer ${issued.token}`, "127.0.0.1"),
      ).resolves.toMatchObject({ accountId: target.id });
      expect(await membershipAudits(target.id, actor.id)).toBe(auditsBefore + 2);
    }
  } finally {
    await app.close();
  }
});

test("direct membership change keeps idempotency, preconditions, authority and normalization guards", async () => {
  const target = await member(["driver"]),
    driver = await member(["driver"]),
    dispatcher = await member(["dispatcher"]),
    inactive = await member(["driver"]),
    neither = await member(["dispatcher"]),
    both = await member(["trainee", "driver"]),
    { app } = await browser();
  await composed.identity.administer(director, inactive.id, newId(), 1, { kind: "deactivate" });
  try {
    const headers = await csrfHeaders(app, directorCookie),
      path = `/api/v1/admin/members/${target.id}/membership`,
      payload = { membership: "trainee", reason: "Fictional membership change" },
      key = newId();
    const first = await app.inject({
      method: "PUT",
      url: path,
      headers: { ...headers, "idempotency-key": key, "if-match": '"v1"' },
      payload,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().data).toEqual({ id: target.id, version: 2 });
    const replay = await app.inject({
      method: "PUT",
      url: path,
      headers: { ...headers, "idempotency-key": key, "if-match": '"v1"' },
      payload,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().data).toEqual(first.json().data);
    const conflict = await app.inject({
      method: "PUT",
      url: path,
      headers: { ...headers, "idempotency-key": key, "if-match": '"v1"' },
      payload: { ...payload, membership: "driver" },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(
      (
        await app.inject({
          method: "PUT",
          url: path,
          headers: { ...headers, "idempotency-key": newId() },
          payload: { ...payload, membership: "driver" },
        })
      ).statusCode,
    ).toBe(428);
    const stale = await app.inject({
      method: "PUT",
      url: path,
      headers: { ...headers, "idempotency-key": newId(), "if-match": '"v1"' },
      payload: { ...payload, membership: "driver" },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("VERSION_CONFLICT");
    const { "x-csrf-token": _token, ...withoutCsrf } = headers;
    for (const denied of [
      { ...headers, origin: "https://other.example.invalid" },
      withoutCsrf,
      { ...headers, cookie: driver.cookie },
      { ...headers, cookie: dispatcher.cookie },
    ])
      expect(
        (
          await app.inject({
            method: "PUT",
            url: path,
            headers: { ...denied, "idempotency-key": newId(), "if-match": '"v2"' },
            payload: { ...payload, membership: "driver" },
          })
        ).statusCode,
      ).toBe(403);
    const unchanged = await app.inject({
      method: "PUT",
      url: path,
      headers: { ...headers, "idempotency-key": newId(), "if-match": '"v2"' },
      payload,
    });
    expect(unchanged.statusCode).toBe(409);
    expect(unchanged.json().error.code).toBe("STATE_CONFLICT");
    expect((await memberRow(target.id)).version).toBe(2);
    expect(await explicitRoles(target.id)).toEqual(["trainee"]);
    await resetLimits();
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/api/v1/admin/members/${inactive.id}/membership`,
          headers: { ...headers, "idempotency-key": newId(), "if-match": '"v2"' },
          payload,
        })
      ).statusCode,
    ).toBe(409);
    expect(await memberRow(inactive.id)).toMatchObject({ status: "inactive", version: 2 });
    expect(await explicitRoles(inactive.id)).toEqual([]);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/api/v1/admin/members/${newId()}/membership`,
          headers: { ...headers, "idempotency-key": newId(), "if-match": '"v1"' },
          payload,
        })
      ).statusCode,
    ).toBe(404);
    for (const invalid of [
      { membership: "director", reason: "Fictional" },
      { membership: "dispatcher", reason: "Fictional" },
      { membership: "driver" },
      { membership: "driver", reason: "Fictional", roles: ["driver"] },
    ])
      expect(
        (
          await app.inject({
            method: "PUT",
            url: path,
            headers: { ...headers, "idempotency-key": newId(), "if-match": '"v2"' },
            payload: invalid,
          })
        ).statusCode,
      ).toBe(422);
    expect((await memberRow(target.id)).version).toBe(2);
    for (const [subject, membershipRole, expected] of [
      [neither, "driver", ["dispatcher", "driver"]],
      [both, "driver", ["driver"]],
    ] as const) {
      const normalized = await app.inject({
        method: "PUT",
        url: `/api/v1/admin/members/${subject.id}/membership`,
        headers: { ...headers, "idempotency-key": newId(), "if-match": '"v1"' },
        payload: { membership: membershipRole, reason: "Fictional normalization" },
      });
      expect(normalized.statusCode).toBe(200);
      expect(normalized.json().data).toEqual({ id: subject.id, version: 2 });
      expect(await explicitRoles(subject.id)).toEqual(expected);
    }
  } finally {
    await app.close();
  }
});

test("director and deputy cannot change the serving director's roles, membership or status", async () => {
  const deputy = await member(["deputy_director"]),
    { app } = await browser();
  async function directorState() {
    const [current] = await unit.run((tx) => unit.client(tx).select().from(company));
    const row = await memberRow(director.userId);
    return {
      pointer: current?.directorUserId,
      status: row.status,
      version: row.version,
      accessEpoch: row.accessEpoch,
      credentialEpoch: row.credentialEpoch,
      identityEpoch: row.identityEpoch,
      roles: await explicitRoles(director.userId),
    };
  }
  try {
    const before = await directorState();
    expect(before.pointer).toBe(director.userId);
    const base = `/api/v1/admin/members/${director.userId}`,
      reason = "Fictional protected change",
      operations = [
        { method: "PUT", url: `${base}/roles`, payload: { roles: ["trainee"], reason } },
        { method: "PUT", url: `${base}/membership`, payload: { membership: "trainee", reason } },
        { method: "POST", url: `${base}/deactivation`, payload: { reason } },
        {
          method: "POST",
          url: `${base}/reinstatement`,
          payload: {
            roles: ["driver"],
            assignments: [
              {
                game: "ets2",
                levelId: structuralLevels.ets2[0],
                purpose: "reinstatement",
                reason,
              },
            ],
            reason,
          },
        },
      ] as const;
    for (const cookie of [directorCookie, deputy.cookie]) {
      await resetLimits();
      const headers = await csrfHeaders(app, cookie);
      for (const operation of operations) {
        const denied = await app.inject({
          ...operation,
          headers: {
            ...headers,
            "idempotency-key": newId(),
            "if-match": `"v${before.version}"`,
          },
        });
        expect(denied.statusCode, `${operation.method} ${operation.url}`).toBe(403);
        expect(await directorState()).toEqual(before);
      }
    }
  } finally {
    await app.close();
  }
});

test("member administration reports the latest accepted canonical trip without per-row reads", async () => {
  const latest = await member(["driver"]),
    undated = await member(["trainee"]),
    idle = await member(["driver"]),
    former = await member(["driver"]);
  const trip = (
    ownerId: string,
    decision: "unassessed" | "pending_review" | "accepted" | "rejected",
    reportingAt: string | null,
    aliasOf: string | null = null,
  ) => ({
    id: newId(),
    ownerId,
    game: "ets2" as const,
    aliasOf,
    version: 1,
    outcome: "delivered" as const,
    recording: "complete" as const,
    decision,
    assessmentPending: decision === "unassessed",
    correctionPending: false,
    reviewHold: false,
    reviewReasons: [],
    actualDistanceM: "100000",
    reportingAt,
    createdAt: "2026-10-01T00:00:00.000Z",
  });
  const older = trip(latest.id, "accepted", "2026-09-10T08:00:00.000Z");
  await unit.run((tx) =>
    unit
      .client(tx)
      .insert(trips)
      .values([
        older,
        trip(latest.id, "accepted", "2026-10-12T19:45:30.123Z"),
        trip(latest.id, "accepted", null),
        trip(latest.id, "pending_review", "2026-10-20T10:00:00.000Z"),
        trip(latest.id, "rejected", "2026-10-21T10:00:00.000Z"),
        trip(latest.id, "unassessed", "2026-10-22T10:00:00.000Z"),
        trip(latest.id, "accepted", "2026-10-25T10:00:00.000Z", older.id),
        trip(undated.id, "accepted", null),
        trip(undated.id, "pending_review", "2026-10-20T10:00:00.000Z"),
        trip(former.id, "accepted", "2026-08-01T00:00:00.000Z"),
      ]),
  );
  await composed.identity.administer(director, former.id, newId(), 1, { kind: "deactivate" });
  const { app, headers } = await browser();
  try {
    for (const [subject, expected] of [
      [latest, "2026-10-12T19:45:30.123Z"],
      [undated, null],
      [idle, null],
      [former, "2026-08-01T00:00:00.000Z"],
    ] as const) {
      const detail = await app.inject({ url: `/api/v1/admin/members/${subject.id}`, headers });
      expect(detail.statusCode).toBe(200);
      expect(detail.json().data.lastAcceptedTripAt).toBe(expected);
    }
    const lists = new Map<string, unknown>();
    for (const status of ["active", "inactive"]) {
      const list = await app.inject({
        url: `/api/v1/admin/members?status=${status}&limit=100`,
        headers,
      });
      expect(list.statusCode).toBe(200);
      expect(list.json().data.nextCursor).toBeNull();
      for (const item of list.json().data.items as {
        status: string;
        lastAcceptedTripAt: string | null;
        profile: { member: { id: string } };
      }[]) {
        expect(item.status).toBe(status);
        lists.set(item.profile.member.id, item.lastAcceptedTripAt);
      }
    }
    expect(lists.get(latest.id)).toBe("2026-10-12T19:45:30.123Z");
    expect(lists.get(undated.id)).toBeNull();
    expect(lists.get(idle.id)).toBeNull();
    expect(lists.get(former.id)).toBe("2026-08-01T00:00:00.000Z");
    const inactive = await composed.administration.members(director, {
      status: "inactive",
      limit: 100,
    });
    expect(inactive.items.map((item) => item.profile.member.id)).toContain(former.id);
    // Diagnostic plan on synthetic rows: the bounded aggregate can use an owner-prefixed index.
    const [plan] = await control.query<RowDataPacket[]>(
      "EXPLAIN SELECT owner_id, MAX(reporting_at) FROM trips WHERE owner_id IN (?, ?) AND decision = 'accepted' AND alias_of IS NULL AND reporting_at IS NOT NULL GROUP BY owner_id",
      [latest.id, former.id],
    );
    const access = plan.find((row) => row.table === "trips");
    expect(String(access?.possible_keys ?? "")).toMatch(/trip_match_owner|trip_owner_page/);
    console.log(
      JSON.stringify({
        event: "administration_trip_activity_plan",
        type: access?.type,
        key: access?.key,
      }),
    );
  } finally {
    await app.close();
  }
});

test("member list role and search filters run in SQL and bind the cursor", async () => {
  const dispatcher = await member(["driver", "dispatcher"], "Fictional Filter Kestrel Dispatcher"),
    trainee = await member(["trainee"], "Fictional Filter Kestrel Trainee"),
    cyrillic = await member(["driver"], "Вымышленный Сокол"),
    literal = await member(["driver"], "Fictional 100%_Literal"),
    decoy = await member(["driver"], "Fictional 100xxLiteral"),
    formerKestrel = await member(["dispatcher"], "Fictional Filter Kestrel Former");
  await composed.identity.administer(director, formerKestrel.id, newId(), 1, {
    kind: "deactivate",
  });
  const { app, headers } = await browser();
  type Row = { status: string; profile: { member: { id: string; roles: string[] } } };
  async function list(query: string) {
    const response = await app.inject({ url: `/api/v1/admin/members?limit=100&${query}`, headers });
    expect(response.statusCode, query).toBe(200);
    expect(response.json().data.nextCursor).toBeNull();
    return response.json().data.items as Row[];
  }
  const ids = (rows: Row[]) => rows.map((row) => row.profile.member.id).sort();
  try {
    const dispatchers = await list("role=dispatcher");
    expect(ids(dispatchers)).toContain(dispatcher.id);
    expect(ids(dispatchers)).not.toContain(trainee.id);
    for (const row of dispatchers) expect(row.profile.member.roles).toContain("dispatcher");
    const trainees = await list("role=trainee");
    expect(ids(trainees)).toContain(trainee.id);
    expect(ids(trainees)).not.toContain(dispatcher.id);
    for (const row of trainees) expect(row.profile.member.roles).toContain("trainee");
    const directors = await list("role=director");
    expect(ids(directors)).toEqual([director.userId]);
    expect(directors[0]?.profile.member.roles).toContain("director");
    expect(ids(await list("search=kestrel&status=active"))).toEqual(
      [dispatcher.id, trainee.id].sort(),
    );
    expect(ids(await list(`search=${encodeURIComponent("  KESTREL ")}`))).toEqual(
      [dispatcher.id, trainee.id, formerKestrel.id].sort(),
    );
    expect(ids(await list(`search=${encodeURIComponent("сокол")}`))).toEqual([cyrillic.id]);
    expect(ids(await list(`search=${encodeURIComponent("100%_")}`))).toEqual([literal.id]);
    expect(ids(await list(`search=${encodeURIComponent("100")}`))).toEqual(
      [literal.id, decoy.id].sort(),
    );
    expect(ids(await list("role=dispatcher&search=Kestrel&status=active"))).toEqual([
      dispatcher.id,
    ]);
    expect(ids(await list("search=Kestrel&status=inactive"))).toEqual([formerKestrel.id]);
    expect(ids(await list("role=dispatcher&search=Kestrel&status=inactive"))).toEqual([]);
    await resetLimits();
    const blank = await app.inject({
      url: `/api/v1/admin/members?search=${encodeURIComponent("   ")}`,
      headers,
    });
    expect(blank.statusCode).toBe(422);
    for (const query of ["role=director_general", `search=${"x".repeat(129)}`])
      expect(
        (await app.inject({ url: `/api/v1/admin/members?${query}`, headers })).statusCode,
      ).toBe(422);
    const first = await app.inject({
      url: "/api/v1/admin/members?limit=1&role=driver&search=Fictional",
      headers,
    });
    expect(first.statusCode).toBe(200);
    const cursor = encodeURIComponent(first.json().data.nextCursor as string);
    expect(
      (
        await app.inject({
          url: `/api/v1/admin/members?limit=1&role=driver&search=Fictional&cursor=${cursor}`,
          headers,
        })
      ).statusCode,
    ).toBe(200);
    for (const changed of [
      "role=trainee&search=Fictional",
      "search=Fictional",
      "role=driver&search=Kestrel",
      "role=driver",
    ]) {
      const reused = await app.inject({
        url: `/api/v1/admin/members?limit=1&${changed}&cursor=${cursor}`,
        headers,
      });
      expect(reused.statusCode, changed).toBe(409);
      expect(reused.json().error.code).toBe("VERSION_CONFLICT");
    }
  } finally {
    await app.close();
  }
});

test("leadership code state is director-only, no-store and safe, and an early resend returns its exact Retry-After", async () => {
  const successor = await member(),
    deputy = await member(["deputy_director"]),
    deliveries: PrivateChallenge[] = [],
    url = "/api/v1/admin/leadership/challenge";
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
    expect((await app.inject({ url })).statusCode).toBe(401);
    expect((await app.inject({ url, headers: { cookie: deputy.cookie } })).statusCode).toBe(403);
    const empty = await app.inject({ url, headers: { cookie: directorCookie } });
    expect(empty.statusCode).toBe(200);
    expect(empty.headers["cache-control"]).toBe("no-store");
    expect(empty.json().data).toEqual({ pending: null, resendAvailableAt: null });
    const csrf = await app.inject({
      url: "/api/v1/auth/csrf",
      headers: { cookie: directorCookie },
    });
    const headers = {
      cookie: directorCookie,
      origin,
      "x-csrf-token": csrf.json().data.token,
      "idempotency-key": newId(),
    };
    const issued = await app.inject({
      method: "POST",
      url: "/api/v1/admin/leadership/challenges",
      headers,
      payload: { successorId: successor.id },
    });
    expect(issued.statusCode).toBe(202);
    const challenge = issued.json().data;
    const read = await app.inject({ url, headers: { cookie: directorCookie } });
    expect(read.statusCode).toBe(200);
    expect(read.headers["cache-control"]).toBe("no-store");
    const state = read.json().data;
    expect(state.pending).toEqual({
      id: challenge.id,
      successor: {
        id: successor.id,
        nickname: "Fictional Administration Member",
        formerMember: false,
        roles: ["driver"],
      },
      expiresAt: challenge.expiresAt,
      attemptsRemaining: 5,
    });
    // Issued + 60 s equals the ten-minute expiry minus nine minutes.
    expect(Date.parse(state.resendAvailableAt)).toBe(Date.parse(challenge.expiresAt) - 540000);
    const code = deliveries.at(-1)?.code;
    if (!code) throw new Error("SYNTHETIC_CHALLENGE_REQUIRED");
    for (const secret of [code, "administration-director@example.invalid", successor.email])
      expect(read.body.includes(secret)).toBe(false);
    const before = Date.now();
    const limited = await app.inject({
      method: "POST",
      url: "/api/v1/admin/leadership/challenges",
      headers: { ...headers, "idempotency-key": newId() },
      payload: { successorId: successor.id },
    });
    const after = Date.now();
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe("RATE_LIMITED");
    const retryAfter = Number(limited.headers["retry-after"]);
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThanOrEqual(
      Math.max(1, Math.ceil((Date.parse(state.resendAvailableAt) - after) / 1000)),
    );
    expect(retryAfter).toBeLessThanOrEqual(
      Math.ceil((Date.parse(state.resendAvailableAt) - before) / 1000),
    );
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect(deliveries).toHaveLength(1);
    // The committed request replays under its own key without a new code.
    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/admin/leadership/challenges",
      headers,
      payload: { successorId: successor.id },
    });
    expect(replay.statusCode).toBe(202);
    expect(replay.json().data).toEqual(challenge);
    expect(deliveries).toHaveLength(1);
  } finally {
    // Retained succession history would otherwise hold later tests in the cooldown.
    await control.query(
      "DELETE FROM identity_challenges WHERE user_id = ? AND purpose = 'succession'",
      [director.userId],
    );
    await app.close();
  }
});

test("bound succession HTTP accepts only challenge/code and preserves singleton leadership under concurrent confirmation", async () => {
  const setupStarted = performance.now();
  let successor: Awaited<ReturnType<typeof member>>;
  try {
    successor = await member(["driver", "dispatcher"]);
  } catch (error) {
    try {
      console.log(
        JSON.stringify({
          event: "administration_fixture",
          caseId: "administration_successor",
          step: "member_setup",
          durationMs: Math.round(performance.now() - setupStarted),
          ...safeIdentityFailure(error),
        }),
      );
    } catch {
      // Failed diagnostics must not replace the original uncertain transaction outcome.
    }
    try {
      await fixtureDatabaseFailure(control, "administration_successor");
    } catch {
      // Even observation/output failures preserve the identical original exception.
    }
    throw error;
  }
  const deliveries: PrivateChallenge[] = [];
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
    });
    expect(csrf.statusCode).toBe(200);
    const headers = {
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
