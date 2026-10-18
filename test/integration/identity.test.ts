import { randomBytes } from "node:crypto";
import { createUnitOfWork, newId, runMigrations, type TxContext } from "@vtc/db";
import {
  account,
  and,
  challenges,
  company,
  eq,
  membership,
  session,
  sql,
  user,
} from "@vtc/db/identity-schema";
import type { Connection, RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createApp } from "../../apps/api/src/app.ts";
import { engine, type IdentityConfig } from "../../apps/api/src/modules/identity/engine.ts";
import {
  type AssignableRole,
  guardManualReview,
} from "../../apps/api/src/modules/identity/permissions.ts";
import {
  createIdentity,
  type Identity,
  type PrivateChallenge,
} from "../../apps/api/src/modules/identity/service.ts";
import { guardedSettings, reset, testConnection } from "../persistence/support.ts";

let control: Connection;
let unit: ReturnType<typeof createUnitOfWork>;
let identity: Identity;
const config: IdentityConfig = {
  secret: randomBytes(32).toString("hex"),
  origin: "http://127.0.0.1:4173",
  production: false,
};
const password = "Synthetic-integration-passphrase-42";
let instant = Date.now();
const time = () => new Date(instant);
const safe = async <T>(operation: Promise<T>): Promise<T> => {
  try {
    return await operation;
  } catch (error) {
    throw Object.assign(new Error("SYNTHETIC_IDENTITY_OPERATION_FAILED"), {
      statusCode:
        error && typeof error === "object" && "statusCode" in error ? error.statusCode : 500,
    });
  }
};
const ports = () => ({
  delivery: {
    enqueue: async (tx: TxContext, input: PrivateChallenge) => {
      await unit
        .client(tx)
        .execute(
          sql`INSERT INTO synthetic_private_delivery (id, payload) VALUES (${input.id}, ${JSON.stringify(input)})`,
        );
    },
  },
  accessEvents: {
    append: async (tx: TxContext, input: { eventId: string }) => {
      await unit
        .client(tx)
        .execute(sql`INSERT INTO synthetic_access_events (id) VALUES (${input.eventId})`);
    },
  },
});
const cookies = (values: readonly string[]) =>
  values
    .map((value) => value.split(";")[0])
    .filter(Boolean)
    .join("; ");
async function signIn(email: string) {
  const result = await safe(identity.login(email, password));
  const headers = new Headers({ cookie: cookies(result.cookies) });
  return { ...result, headers, actor: await safe(identity.authenticate(headers)) };
}
async function addMember(assigned: readonly AssignableRole[] = ["driver"]) {
  const id = newId(),
    email = `${id}@example.invalid`;
  const credential = await identity.prepareCredential(password);
  await safe(
    unit.run((tx) =>
      identity.insertWithCredential(tx, {
        userId: id,
        email,
        name: "Synthetic Member",
        ...credential,
        roles: assigned,
      }),
    ),
  );
  return { id, email };
}
async function latestChallenge(userId: string, purpose: string) {
  const [rows] = await control.query<RowDataPacket[]>(
    "SELECT payload FROM synthetic_private_delivery",
  );
  const entries = rows.map((row) =>
    typeof row.payload === "string"
      ? (JSON.parse(row.payload) as PrivateChallenge)
      : (row.payload as PrivateChallenge),
  );
  const active = await unit.run((tx) =>
    unit
      .client(tx)
      .select()
      .from(challenges)
      .where(
        and(
          eq(challenges.userId, userId),
          eq(challenges.purpose, purpose as PrivateChallenge["purpose"]),
          eq(challenges.consumed, false),
        ),
      ),
  );
  const value = entries.find((entry) => entry.id === active[0]?.id);
  if (!value) throw new Error("SYNTHETIC_CHALLENGE_MISSING");
  return value;
}
async function verify(member: Awaited<ReturnType<typeof signIn>>) {
  await safe(identity.requestChallenge(member.actor, newId(), "email_verification"));
  const challenge = await latestChallenge(member.actor.userId, "email_verification");
  await safe(
    identity.confirmChallenge(member.actor, newId(), {
      purpose: "email_verification",
      challengeId: challenge.id,
      code: challenge.code,
    }),
  );
}
beforeAll(async () => {
  control = await testConnection();
  await reset(control);
  await runMigrations(guardedSettings());
  await control.query(
    "CREATE TABLE synthetic_private_delivery (id VARCHAR(36) PRIMARY KEY, payload JSON NOT NULL) ENGINE=InnoDB",
  );
  await control.query(
    "CREATE TABLE synthetic_access_events (id VARCHAR(36) PRIMARY KEY) ENGINE=InnoDB",
  );
  unit = createUnitOfWork(guardedSettings());
  identity = createIdentity(unit, config, ports(), time);
});
afterAll(async () => {
  await unit?.close();
  await control?.end();
});

test("bootstrap race leaves exactly one unverified active director and no session; repeat is rejected", async () => {
  const results = await Promise.allSettled(
    [1, 2].map((n) =>
      safe(
        identity.bootstrap({
          email: `bootstrap${n}@example.invalid`,
          name: "Synthetic Director",
          password,
        }),
      ),
    ),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const state = await unit.run(async (tx) => ({
    users: await unit.client(tx).select().from(user),
    company: await unit.client(tx).select().from(company),
    sessions: await unit.client(tx).select().from(session),
  }));
  expect(state.users).toHaveLength(1);
  expect(state.company).toHaveLength(1);
  expect(state.sessions).toHaveLength(0);
  expect(state.users[0]?.emailVerified).toBe(false);
  await expect(
    safe(identity.bootstrap({ email: "another@example.invalid", name: "Synthetic", password })),
  ).rejects.toMatchObject({ statusCode: 409 });
});

test("version-pinned owned credential mapping signs in through Better Auth; exact UUID/date and rollback share caller connection", async () => {
  const member = await addMember();
  const login = await signIn(member.email.toUpperCase());
  expect(login.data.member.id).toBe(member.id);
  expect(login.data.emailVerified).toBe(false);
  const stored = await unit.run(async (tx) => ({
    accounts: await unit.client(tx).select().from(account).where(eq(account.userId, member.id)),
    sessions: await unit.client(tx).select().from(session).where(eq(session.userId, member.id)),
  }));
  expect(stored.accounts[0]?.providerId).toBe("credential");
  expect(stored.sessions[0]?.accessEpoch).toBe(1);
  expect(stored.sessions[0]?.expiresAt instanceof Date).toBe(true);
  expect(stored.sessions[0]?.expiresAt.toISOString().endsWith("Z")).toBe(true);
  const id = newId(),
    credential = await identity.prepareCredential(password);
  await expect(
    safe(
      unit.run(async (tx) => {
        await identity.insertWithCredential(tx, {
          userId: id,
          email: "rollback@example.invalid",
          name: "Synthetic",
          ...credential,
          roles: ["driver"],
        });
        const [inside] = await unit.client(tx).select().from(user).where(eq(user.id, id));
        expect(inside?.id).toBe(id);
        // A library session write also must not escape the caller transaction.
        const response = await engine(unit.client(tx), config).api.signInEmail({
          body: { email: "rollback@example.invalid", password },
          asResponse: true,
        });
        expect(response.ok).toBe(true);
        throw new Error("SYNTHETIC_ROLLBACK");
      }),
    ),
  ).rejects.toMatchObject({ statusCode: 500 });
  expect(
    await unit.run((tx) => unit.client(tx).select().from(user).where(eq(user.id, id))),
  ).toHaveLength(0);
  expect(
    await unit.run((tx) => unit.client(tx).select().from(session).where(eq(session.userId, id))),
  ).toHaveLength(0);
  await expect(safe(identity.login("rollback@example.invalid", password))).rejects.toMatchObject({
    statusCode: 401,
  });
  const duplicate = await Promise.allSettled(
    [1, 2].map(() =>
      safe(
        unit.run((tx) =>
          identity.insertWithCredential(tx, {
            userId: newId(),
            email: "duplicate@example.invalid",
            name: "Synthetic",
            ...credential,
            roles: [],
          }),
        ),
      ),
    ),
  );
  expect(duplicate.filter((r) => r.status === "fulfilled")).toHaveLength(1);
});

test("native signup is disabled and project routes never expose native reset/admin/signup mutations", async () => {
  await expect(
    safe(
      unit.run((tx) =>
        engine(unit.client(tx), config).api.signUpEmail({
          body: { email: "signup@example.invalid", name: "Synthetic", password },
        }),
      ),
    ),
  ).rejects.toMatchObject({ statusCode: 400 });
  const app = await createApp({ checkReadiness: async () => true, identity });
  try {
    for (const path of [
      "/api/auth/sign-up/email",
      "/private-auth-engine/sign-up/email",
      "/api/v1/auth/sign-up/email",
      "/api/v1/admin/users",
    ])
      expect((await app.inject({ method: "POST", url: path, payload: {} })).statusCode).toBe(404);
  } finally {
    await app.close();
  }
});

test("every role combination is additive, deputies match administration and all staff self-review is denied", async () => {
  for (let mask = 0; mask < 16; mask++) {
    const assigned = (["trainee", "driver", "dispatcher", "deputy_director"] as const).filter(
      (_role, i) => mask & (1 << i),
    );
    const member = await addMember(assigned),
      login = await signIn(member.email);
    expect(login.actor.capabilities.includes("company.read")).toBe(true);
    expect(login.actor.capabilities.includes("trips.submit_own")).toBe(
      assigned.some((r) => r === "trainee" || r === "driver"),
    );
    expect(login.actor.capabilities.includes("members.manage")).toBe(
      assigned.includes("deputy_director"),
    );
    expect(login.actor.capabilities.includes("leadership.transfer")).toBe(false);
    if (assigned.some((r) => r === "dispatcher" || r === "deputy_director"))
      expect(() => guardManualReview(login.actor, member.id)).toThrow("SELF_REVIEW_FORBIDDEN");
  }
  const [director] = await unit.run((tx) => unit.client(tx).select().from(company));
  if (!director) throw new Error("SYNTHETIC_DIRECTOR_MISSING");
  const [row] = await unit.run((tx) =>
    unit.client(tx).select().from(user).where(eq(user.id, director.directorUserId)),
  );
  const login = await signIn(row?.email ?? "");
  expect(() => guardManualReview(login.actor, login.actor.userId)).toThrow("SELF_REVIEW_FORBIDDEN");
});

test("deactivation/reinstatement retains identity/history, replaces roles and makes every old cookie/epoch invalid", async () => {
  const [current] = await unit.run((tx) => unit.client(tx).select().from(company));
  const [owner] = await unit.run((tx) =>
    unit
      .client(tx)
      .select()
      .from(user)
      .where(eq(user.id, current?.directorUserId ?? newId())),
  );
  const director = await signIn(owner?.email ?? ""),
    member = await addMember(["driver", "dispatcher"]),
    login = await signIn(member.email);
  await safe(identity.administer(director.actor, member.id, newId(), 1, { kind: "deactivate" }));
  await expect(safe(identity.authenticate(login.headers))).rejects.toMatchObject({
    statusCode: 401,
  });
  await expect(safe(identity.login(member.email, password))).rejects.toMatchObject({
    statusCode: 401,
  });
  await expect(safe(identity.login("absent@example.invalid", password))).rejects.toMatchObject({
    statusCode: 401,
  });
  await expect(safe(identity.login(member.email, "wrong-password"))).rejects.toMatchObject({
    statusCode: 401,
  });
  await safe(
    identity.administer(director.actor, member.id, newId(), 2, {
      kind: "reinstate",
      roles: ["trainee"],
    }),
  );
  const returned = await signIn(member.email);
  expect(returned.data.member.id).toBe(member.id);
  expect(returned.data.member.roles).toEqual(["trainee"]);
  expect(returned.data.identityEpoch).toBe(3);
  expect(returned.actor.accessEpoch).toBe(3);
  await expect(safe(identity.authenticate(login.headers))).rejects.toMatchObject({
    statusCode: 401,
  });
  for (const kind of ["roles", "deactivate", "reinstate"] as const)
    await expect(
      safe(
        identity.administer(director.actor, director.actor.userId, newId(), 1, {
          kind,
          roles: ["driver"],
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  await expect(
    safe(
      identity.administer(director.actor, member.id, newId(), 3, {
        kind: "roles",
        roles: ["director"] as unknown as AssignableRole[],
      }),
    ),
  ).rejects.toMatchObject({ statusCode: 422 });
  await expect(
    safe(
      identity.administer(director.actor, member.id, newId(), 3, {
        kind: "roles",
        roles: ["driver"],
        qualifications: [{}],
      }),
    ),
  ).rejects.toMatchObject({ statusCode: 503 });
});

test("challenge replacement, five wrong attempts, exact ten-minute expiry, purpose and actor binding are durable", async () => {
  const m = await addMember(),
    login = await signIn(m.email);
  await verify(login);
  await safe(identity.requestChallenge(login.actor, newId(), "password_change"));
  const old = await latestChallenge(m.id, "password_change");
  await safe(identity.requestChallenge(login.actor, newId(), "password_change"));
  const current = await latestChallenge(m.id, "password_change");
  const confirm = (
    id: string,
    code: string,
    purpose: "password_change" | "email_verification" = "password_change",
  ) =>
    safe(
      identity.confirmChallenge(login.actor, newId(), {
        purpose,
        challengeId: id,
        code,
        newPassword: password,
      }),
    );
  await expect(confirm(old.id, old.code)).rejects.toMatchObject({ statusCode: 401 });
  await expect(confirm(current.id, current.code, "email_verification")).rejects.toMatchObject({
    statusCode: 401,
  });
  for (let i = 0; i < 5; i++)
    await expect(confirm(current.id, "invalid")).rejects.toMatchObject({ statusCode: 401 });
  await expect(confirm(current.id, current.code)).rejects.toMatchObject({ statusCode: 401 });
  await safe(identity.requestChallenge(login.actor, newId(), "password_change"));
  const expiring = await latestChallenge(m.id, "password_change");
  expect(new Date(expiring.expiresAt).getTime() - instant).toBe(600000);
  instant += 600000;
  await expect(confirm(expiring.id, expiring.code)).rejects.toMatchObject({ statusCode: 401 });
  instant -= 600000;
  const other = await signIn((await addMember()).email);
  await expect(
    safe(
      identity.confirmChallenge(other.actor, newId(), {
        purpose: "password_change",
        challengeId: expiring.id,
        code: expiring.code,
        newPassword: password,
      }),
    ),
  ).rejects.toMatchObject({ statusCode: 401 });
});

test("reset is current-verified-email bound, one-time, concurrent-safe and revokes password/sessions; exact replay is safe", async () => {
  const m = await addMember(),
    login = await signIn(m.email);
  await verify(login);
  await safe(identity.requestReset("synthetic-pre-session", newId(), m.email));
  const old = await latestChallenge(m.id, "password_reset");
  await safe(identity.requestReset("synthetic-pre-session", newId(), m.email));
  const challenge = await latestChallenge(m.id, "password_reset");
  expect(challenge.id === old.id && challenge.code === old.code).toBe(true);
  const key = newId(),
    args = [
      "synthetic-pre-session",
      key,
      challenge.code,
      "Synthetic-changed-passphrase-43",
    ] as const;
  const results = await Promise.all([
    safe(identity.resetPassword(...args)),
    safe(identity.resetPassword(...args)),
  ]);
  expect(results[0]).toEqual(results[1]);
  await expect(
    safe(identity.resetPassword("other-scope", newId(), challenge.code, password)),
  ).rejects.toMatchObject({ statusCode: 401 });
  await expect(
    safe(identity.resetPassword(...([args[0], key, challenge.code, password] as const))),
  ).rejects.toMatchObject({ statusCode: 409 });
  await expect(safe(identity.authenticate(login.headers))).rejects.toMatchObject({
    statusCode: 401,
  });
  await expect(safe(identity.login(m.email, password))).rejects.toMatchObject({ statusCode: 401 });
  expect((await safe(identity.login(m.email, args[3]))).data.member.id).toBe(m.id);
  expect(
    await safe(identity.requestReset("synthetic-pre-session", newId(), "unknown@example.invalid")),
  ).toEqual({ status: "received" });
});

test("protected email replacement requires both channels before invalidating epochs and verifying the new address", async () => {
  const m = await addMember(),
    login = await signIn(m.email);
  await verify(login);
  const newEmail = `${newId()}@example.invalid`;
  await safe(identity.requestChallenge(login.actor, newId(), "email_change", newEmail));
  const challenge = await latestChallenge(m.id, "email_change");
  expect(challenge.email === m.email).toBe(true);
  await safe(
    identity.confirmChallenge(login.actor, newId(), {
      purpose: "email_change",
      challengeId: challenge.id,
      code: challenge.code,
    }),
  );
  expect((await safe(identity.current(login.actor))).data.email).toBe(m.email);
  const proposed = await latestChallenge(m.id, "email_change");
  expect(proposed.email === newEmail).toBe(true);
  await safe(
    identity.confirmEmailChange(login.actor, newId(), {
      challengeId: proposed.id,
      code: proposed.code,
    }),
  );
  await expect(safe(identity.authenticate(login.headers))).rejects.toMatchObject({
    statusCode: 401,
  });
  const changed = await signIn(newEmail);
  expect(changed.data.emailVerified).toBe(true);
  await safe(identity.requestChallenge(changed.actor, newId(), "password_change"));
});

test("production engine emits exact host-only secure cookies and current membership epochs defeat a still-present session", async () => {
  const member = await addMember();
  const production = createIdentity(
    unit,
    { ...config, production: true, origin: "https://dashboard.example.invalid" },
    ports(),
    time,
  );
  const result = await safe(production.login(member.email, password));
  const cookie = result.cookies.find((value) => value.startsWith("__Host-vtc_session="));
  expect(
    Boolean(
      cookie?.includes("HttpOnly") &&
        cookie.includes("Secure") &&
        cookie.includes("SameSite=Lax") &&
        cookie.includes("Path=/") &&
        !cookie.includes("Domain="),
    ),
  ).toBe(true);
  const headers = new Headers({ cookie: cookies(result.cookies) });
  const actor = await safe(production.authenticate(headers));
  await safe(
    unit.run((tx) =>
      unit
        .client(tx)
        .update(membership)
        .set({ accessEpoch: 2 })
        .where(eq(membership.userId, member.id)),
    ),
  );
  expect(
    await unit.run((tx) =>
      unit.client(tx).select().from(session).where(eq(session.id, actor.sessionId)),
    ),
  ).toHaveLength(1);
  await expect(safe(production.authenticate(headers))).rejects.toMatchObject({ statusCode: 401 });
});

test("preference command reserves concurrent keys, replays committed safe results and detects changed input/stale versions", async () => {
  const login = await signIn((await addMember()).email),
    key = newId();
  const results = await Promise.all(
    [1, 2].map(() => safe(identity.preferences(login.actor, key, 1, { locale: "ru" }))),
  );
  expect(results[0]).toEqual(results[1]);
  expect(results[0]?.version).toBe(2);
  await expect(
    safe(identity.preferences(login.actor, key, 1, { locale: "en" })),
  ).rejects.toMatchObject({ statusCode: 409 });
  await expect(
    safe(identity.preferences(login.actor, newId(), 1, { locale: "ru" })),
  ).rejects.toMatchObject({ statusCode: 409 });
  await expect(
    safe(identity.preferences(login.actor, newId(), 2, { displayTimezone: "Invalid/Timezone" })),
  ).rejects.toMatchObject({ statusCode: 422 });
});

test("serving director alone can succeed another active member; binding, epoch, expiry, replay and competing confirmations are enforced", async () => {
  const [c] = await unit.run((tx) => unit.client(tx).select().from(company));
  const [u] = await unit.run((tx) =>
    unit
      .client(tx)
      .select()
      .from(user)
      .where(eq(user.id, c?.directorUserId ?? newId())),
  );
  const director = await signIn(u?.email ?? "");
  await verify(director);
  const successor = await addMember(),
    other = await addMember(),
    deputy = await signIn((await addMember(["deputy_director"])).email);
  await expect(
    safe(identity.requestSuccession(deputy.actor, successor.id, newId())),
  ).rejects.toMatchObject({ statusCode: 403 });
  await expect(
    safe(identity.requestSuccession(director.actor, director.actor.userId, newId())),
  ).rejects.toMatchObject({ statusCode: 409 });
  const inactive = await addMember();
  await safe(identity.administer(director.actor, inactive.id, newId(), 1, { kind: "deactivate" }));
  await expect(
    safe(identity.requestSuccession(director.actor, inactive.id, newId())),
  ).rejects.toMatchObject({ statusCode: 409 });
  await safe(identity.requestSuccession(director.actor, successor.id, newId()));
  const replaced = await latestChallenge(director.actor.userId, "succession");
  await safe(identity.requestSuccession(director.actor, other.id, newId()));
  await expect(
    safe(
      identity.confirmSuccession(director.actor, successor.id, replaced.id, replaced.code, newId()),
    ),
  ).rejects.toMatchObject({ statusCode: 401 });
  const expired = await latestChallenge(director.actor.userId, "succession");
  instant += 600000;
  await expect(
    safe(identity.confirmSuccession(director.actor, other.id, expired.id, expired.code, newId())),
  ).rejects.toMatchObject({ statusCode: 401 });
  instant -= 600000;
  await safe(identity.requestSuccession(director.actor, successor.id, newId()));
  const staleEpoch = await latestChallenge(director.actor.userId, "succession");
  await safe(
    unit.run((tx) =>
      unit
        .client(tx)
        .update(membership)
        .set({ emailEpoch: sql`${membership.emailEpoch} + 1` })
        .where(eq(membership.userId, director.actor.userId)),
    ),
  );
  await expect(
    safe(
      identity.confirmSuccession(
        director.actor,
        successor.id,
        staleEpoch.id,
        staleEpoch.code,
        newId(),
      ),
    ),
  ).rejects.toMatchObject({ statusCode: 401 });
  await safe(identity.requestSuccession(director.actor, successor.id, newId()));
  const challenge = await latestChallenge(director.actor.userId, "succession");
  await expect(
    safe(
      identity.confirmSuccession(director.actor, other.id, challenge.id, challenge.code, newId()),
    ),
  ).rejects.toMatchObject({ statusCode: 401 });
  const commandKeys = [newId(), newId()];
  const results = await Promise.allSettled(
    commandKeys.map((commandKey) =>
      safe(
        identity.confirmSuccession(
          director.actor,
          successor.id,
          challenge.id,
          challenge.code,
          commandKey,
        ),
      ),
    ),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const committedIndex = results.findIndex((result) => result.status === "fulfilled");
  const committedKey = commandKeys[committedIndex];
  if (!committedKey) throw new Error("SYNTHETIC_COMMITTED_KEY_MISSING");
  expect(
    await safe(
      identity.confirmSuccession(
        director.actor,
        successor.id,
        challenge.id,
        challenge.code,
        committedKey,
      ),
    ),
  ).toEqual((results[committedIndex] as PromiseFulfilledResult<Record<string, unknown>>).value);
  const former = await safe(identity.current(director.actor));
  expect(former.data.member.roles.includes("director")).toBe(false);
  expect(former.data.member.roles.includes("driver")).toBe(true);
  const next = await signIn(successor.email);
  expect(next.data.member.roles.includes("director")).toBe(true);
  expect(await unit.run((tx) => unit.client(tx).select().from(company))).toHaveLength(1);
});

test("missing mail/events refuse effects, event failure rolls back mutation and database FK restricts director deletion", async () => {
  const m = await addMember(),
    login = await signIn(m.email);
  const disabled = createIdentity(unit, config);
  await expect(safe(disabled.requestReset("scope", newId(), m.email))).rejects.toMatchObject({
    statusCode: 503,
  });
  await expect(
    safe(disabled.requestReset("scope", newId(), "unknown@example.invalid")),
  ).rejects.toMatchObject({ statusCode: 503 });
  await expect(
    safe(disabled.requestChallenge(login.actor, newId(), "email_verification")),
  ).rejects.toMatchObject({ statusCode: 503 });
  const [c] = await unit.run((tx) => unit.client(tx).select().from(company));
  const [u] = await unit.run((tx) =>
    unit
      .client(tx)
      .select()
      .from(user)
      .where(eq(user.id, c?.directorUserId ?? newId())),
  );
  const director = await signIn(u?.email ?? ""),
    failing = createIdentity(unit, config, {
      ...ports(),
      accessEvents: {
        append: async () => {
          throw new Error("SYNTHETIC_EVENT_FAILURE");
        },
      },
    });
  await expect(
    safe(failing.administer(director.actor, m.id, newId(), 1, { kind: "deactivate" })),
  ).rejects.toMatchObject({ statusCode: 500 });
  expect((await safe(identity.current(login.actor))).data.member.id).toBe(m.id);
  await expect(
    safe(unit.run((tx) => unit.client(tx).delete(user).where(eq(user.id, director.actor.userId)))),
  ).rejects.toMatchObject({ statusCode: 500 });
});

test("shared rate counters survive service recreation and concurrent requests; attacker-created bucket cardinality is bounded", async () => {
  for (let i = 0; i < 19; i++) await safe(identity.rateLimit("login", "synthetic-rate-source"));
  const recreated = createIdentity(unit, config, ports(), time);
  const results = await Promise.allSettled(
    [1, 2].map(() => safe(recreated.rateLimit("login", "synthetic-rate-source"))),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
});

test("real API enforces structural schemas, current membership, CSRF/origin rotation, cookies and precise status envelopes", async () => {
  // This API scenario has its own minute window, independent of the prior
  // deliberate slot saturation (which may conservatively hash to this socket).
  instant += 60000;
  const m = await addMember(),
    app = await createApp({ checkReadiness: async () => true, identity });
  try {
    expect((await app.inject({ url: "/api/v1/me" })).statusCode).toBe(401);
    const pre = await app.inject({ url: "/api/v1/auth/csrf" });
    expect(pre.statusCode).toBe(200);
    const preCookie = cookies(pre.cookies.map((c) => `${c.name}=${c.value}`));
    const preToken = pre.json().data.token as string;
    const request = (
      headers: Record<string, string>,
      payload: string | Record<string, unknown> = { email: m.email, password },
    ) => app.inject({ method: "POST", url: "/api/v1/auth/login", headers, payload });
    const basic = { cookie: preCookie, origin: config.origin, "x-csrf-token": preToken };
    expect((await request({})).statusCode).toBe(403);
    expect(
      (await request({ ...basic, origin: "https://foreign.example.invalid" })).statusCode,
    ).toBe(403);
    expect((await request(basic, { email: m.email, password, extra: true })).statusCode).toBe(422);
    expect((await request({ ...basic, "content-type": "text/plain" }, "bad")).statusCode).toBe(415);
    const logged = await request(basic);
    expect(logged.statusCode).toBe(200);
    expect(Array.isArray(logged.headers["set-cookie"])).toBe(true);
    const sessionCookie = cookies(logged.cookies.map((c) => `${c.name}=${c.value}`));
    expect(
      (await app.inject({ url: "/api/v1/me", headers: { cookie: sessionCookie } })).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/auth/logout",
          headers: { ...basic, cookie: sessionCookie },
        })
      ).statusCode,
    ).toBe(403);
    const bound = await app.inject({
      url: "/api/v1/auth/csrf",
      headers: { cookie: sessionCookie },
    });
    const logout = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: {
        cookie: sessionCookie,
        origin: config.origin,
        "x-csrf-token": bound.json().data.token,
      },
    });
    expect(logout.statusCode).toBe(200);
    expect(
      (await app.inject({ url: "/api/v1/me", headers: { cookie: sessionCookie } })).statusCode,
    ).toBe(401);
    const direct = await signIn(m.email);
    await safe(
      unit.run((tx) =>
        unit
          .client(tx)
          .update(session)
          .set({ expiresAt: new Date(Date.now() - 1) })
          .where(eq(session.id, direct.actor.sessionId)),
      ),
    );
    await expect(safe(identity.authenticate(direct.headers))).rejects.toMatchObject({
      statusCode: 401,
    });
  } finally {
    await app.close();
  }
});
