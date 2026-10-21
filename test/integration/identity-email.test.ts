import { randomBytes } from "node:crypto";
import { createUnitOfWork, newId, runMigrations, type TxContext } from "@vtc/db";
import { eq, membership, sql } from "@vtc/db/identity-schema";
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
  type Actor,
  createIdentity,
  type PrivateChallenge,
} from "../../apps/api/src/modules/identity/service.ts";
import {
  guardedSettings,
  reset,
  SCHEMA_SETUP_TIMEOUT_MS,
  testConnection,
} from "../persistence/support.ts";
import { identityDiagnostics } from "../support/identity-diagnostics.ts";
import { schemaLifecycleHooks } from "../support/schema-lifecycle.ts";

const { beforeAll, afterAll } = schemaLifecycleHooks(vitestBeforeAll, vitestAfterAll);

const config = {
  secret: randomBytes(32).toString("hex"),
  origin: "http://127.0.0.1:4173",
  production: false,
};
const password = "Synthetic-email-passphrase-42";
const diagnostic = identityDiagnostics("email");
let control: Connection;
let unit: ReturnType<typeof createUnitOfWork>;
let instant = Date.now();
const time = () => new Date(instant);
const ports = {
  delivery: {
    async enqueue(tx: TxContext, payload: PrivateChallenge) {
      await unit
        .client(tx)
        .execute(
          sql`INSERT INTO synthetic_email_mail VALUES (${payload.id}, ${JSON.stringify(payload)})`,
        );
    },
  },
  accessEvents: {
    async append(tx: TxContext, event: { eventId: string }) {
      await unit
        .client(tx)
        .execute(sql`INSERT INTO synthetic_email_events VALUES (${event.eventId})`);
    },
  },
};
const owner = () => createIdentity(unit, config, ports, time);
async function safe<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    diagnostic.failure(error);
    throw Object.assign(new Error("SYNTHETIC_EMAIL_OPERATION_FAILED"), {
      statusCode:
        error && typeof error === "object" && "statusCode" in error ? error.statusCode : 500,
    });
  }
}
async function signIn(email: string) {
  const identity = owner(),
    result = await safe(identity.login(email, password));
  const cookie = result.cookies.map((value) => value.split(";", 1)[0]).join("; ");
  return {
    cookie,
    actor: await safe(identity.authenticate(new Headers({ cookie }))),
    data: result.data,
  };
}
async function mail(id: string): Promise<PrivateChallenge> {
  const [rows] = await safe(
    control.query<RowDataPacket[]>("SELECT payload FROM synthetic_email_mail WHERE id = ?", [id]),
  );
  if (!rows[0]) throw new Error("SYNTHETIC_MAIL_REQUIRED");
  return typeof rows[0].payload === "string" ? JSON.parse(rows[0].payload) : rows[0].payload;
}
async function member() {
  const identity = owner(),
    id = newId(),
    email = `${id}@example.invalid`;
  const credential = await identity.prepareCredential(password);
  await safe(
    unit.run((tx) =>
      identity.insertWithCredential(tx, {
        userId: id,
        email,
        name: "Synthetic Email Member",
        roles: ["driver"],
        ...credential,
      }),
    ),
  );
  const logged = await signIn(email);
  const requested = await safe(
    identity.requestChallenge(logged.actor, newId(), "email_verification"),
  );
  const proof = await mail(String(requested.id));
  await safe(
    identity.confirmChallenge(logged.actor, newId(), {
      purpose: "email_verification",
      challengeId: proof.id,
      code: proof.code,
    }),
  );
  return { id, email, ...logged };
}
async function start(actor: Actor, proposedEmail = `${newId()}@example.invalid`) {
  const requested = await safe(
    owner().requestChallenge(actor, newId(), "email_change", proposedEmail),
  );
  return { proposedEmail, proof: await mail(String(requested.id)) };
}
async function advance(actor: Actor, proof: PrivateChallenge) {
  const result = await safe(
    owner().confirmChallenge(actor, newId(), {
      purpose: "email_change",
      challengeId: proof.id,
      code: proof.code,
    }),
  );
  return mail(String(result.id));
}
async function unchanged(actor: Actor, email: string) {
  const current = await safe(owner().current(actor));
  expect(current.data.email === email).toBe(true);
  expect(current.data.emailVerified).toBe(true);
}
async function snapshot(id: string) {
  const [rows] = await safe(
    control.query<RowDataPacket[]>(
      "SELECT u.email, u.email_verified, m.version, m.access_epoch, m.identity_epoch, m.credential_epoch, m.email_epoch, (SELECT COUNT(*) FROM identity_sessions s WHERE s.user_id=u.id) AS sessions, (SELECT COUNT(*) FROM audit_entries a WHERE a.subject_id=u.id) AS audits, (SELECT COUNT(*) FROM synthetic_email_events) AS events FROM identity_users u JOIN identity_memberships m ON m.user_id=u.id WHERE u.id=?",
      [id],
    ),
  );
  return rows[0];
}
async function api(logged: { cookie: string }, identity = owner()) {
  const app = await createApp({ checkReadiness: async () => true, identity });
  const response = await app.inject({
    url: "/api/v1/auth/csrf",
    headers: { cookie: logged.cookie },
  });
  expect(response.statusCode).toBe(200);
  return {
    app,
    headers: {
      cookie: logged.cookie,
      origin: config.origin,
      "x-csrf-token": String(response.json().data.token),
    },
  };
}
beforeAll(async () => {
  control = await diagnostic.phase("connection", () => testConnection());
  await diagnostic.phase("reset", () => reset(control));
  await diagnostic.phase("migrations", () => runMigrations(guardedSettings()));
  await diagnostic.phase("synthetic_ddl", () =>
    control.query(
      "CREATE TABLE synthetic_email_mail (id VARCHAR(36) PRIMARY KEY, payload JSON NOT NULL) ENGINE=InnoDB",
    ),
  );
  await diagnostic.phase("synthetic_ddl", () =>
    control.query("CREATE TABLE synthetic_email_events (id VARCHAR(36) PRIMARY KEY) ENGINE=InnoDB"),
  );
  unit = diagnostic.unit(createUnitOfWork(guardedSettings()), control);
  await diagnostic.phase("bootstrap", () =>
    safe(
      owner().bootstrap({
        email: "synthetic-email-director@example.invalid",
        name: "Synthetic Email Director",
        password,
      }),
    ),
  );
  const director = await diagnostic.phase("verification", () =>
    signIn("synthetic-email-director@example.invalid"),
  );
  const requested = await diagnostic.phase("verification", () =>
    safe(owner().requestChallenge(director.actor, newId(), "email_verification")),
  );
  const proof = await diagnostic.phase("verification", () => mail(String(requested.id)));
  await diagnostic.phase("verification", () =>
    safe(
      owner().confirmChallenge(director.actor, newId(), {
        purpose: "email_verification",
        challengeId: proof.id,
        code: proof.code,
      }),
    ),
  );
}, SCHEMA_SETUP_TIMEOUT_MS);
beforeEach(() => {
  instant += 60000;
});
afterAll(async () => {
  await unit?.close();
  await control?.end();
});

test("API retains verified old email through 202 pending, discovers state and atomically completes only the proposed proof", async () => {
  const m = await member(),
    { app, headers } = await api(m);
  try {
    const proposedEmail = `${newId()}@example.invalid`,
      before = await snapshot(m.id),
      requestKey = newId();
    const request = () =>
      app.inject({
        method: "POST",
        url: "/api/v1/me/credential-challenges",
        headers: { ...headers, "idempotency-key": requestKey },
        payload: { purpose: "email_change", newEmail: proposedEmail },
      });
    const requested = await request();
    expect(requested.statusCode).toBe(202);
    expect((await request()).json().data).toEqual(requested.json().data);
    const old = await mail(requested.json().data.id);
    expect(old.email === m.email).toBe(true);
    expect(old.emailChangeStage).toBe("current_email");
    const read = () => app.inject({ url: "/api/v1/me/email-change", headers });
    expect((await read()).json().data.pending.stage).toBe("current_email");
    const key = newId();
    const confirm = () =>
      app.inject({
        method: "POST",
        url: "/api/v1/me/credential-changes",
        headers: { ...headers, "idempotency-key": key },
        payload: { kind: "email_change", challengeId: old.id, code: old.code },
      });
    const accepted = await confirm();
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json().data.state).toBe("pending");
    expect(accepted.json().data.id !== old.id).toBe(true);
    expect((await confirm()).json().data).toEqual(accepted.json().data);
    const pending = (await read()).json().data.pending;
    expect(pending.stage).toBe("proposed_email");
    expect(pending.proposedEmail === proposedEmail).toBe(true);
    const proposed = await mail(pending.id);
    expect(proposed.email === proposedEmail).toBe(true);
    expect(proposed.emailChangeStage).toBe("proposed_email");
    expect(proposed.code !== old.code).toBe(true);
    expect(new Date(proposed.expiresAt).getTime()).toBe(instant + 600000);
    expect(await snapshot(m.id)).toEqual(before);
    expect((await signIn(m.email)).data.emailVerified).toBe(true);
    const finalKey = newId(),
      input = { challengeId: proposed.id, code: proposed.code };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/me/email-change-confirmations",
          headers: { ...headers, "idempotency-key": newId() },
          payload: { ...input, newEmail: m.email },
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/me/email-change-confirmations",
          headers: { cookie: m.cookie, origin: config.origin, "idempotency-key": newId() },
          payload: input,
        })
      ).statusCode,
    ).toBe(403);
    const completed = await app.inject({
      method: "POST",
      url: "/api/v1/me/email-change-confirmations",
      headers: { ...headers, "idempotency-key": finalKey },
      payload: input,
    });
    expect(completed.statusCode).toBe(200);
    expect((await app.inject({ url: "/api/v1/me", headers })).statusCode).toBe(401);
    await expect(safe(owner().login(m.email, password))).rejects.toMatchObject({ statusCode: 401 });
    const logged = await signIn(proposedEmail);
    expect(logged.data.emailVerified).toBe(true);
    expect((await safe(owner().pendingEmailChange(logged.actor))).pending).toBe(null);
    const after = await snapshot(m.id);
    for (const field of [
      "version",
      "access_epoch",
      "credential_epoch",
      "email_epoch",
      "audits",
      "events",
    ])
      expect(Number(after?.[field])).toBe(Number(before?.[field]) + 1);
    expect(Number(after?.identity_epoch)).toBe(Number(before?.identity_epoch));
    expect(await safe(owner().confirmEmailChange(logged.actor, finalKey, input))).toEqual(
      completed.json().data,
    );
    await expect(
      safe(owner().confirmEmailChange(logged.actor, newId(), input)),
    ).rejects.toMatchObject({ statusCode: 401 });
  } finally {
    await app.close();
  }
});

test("unreachable proposed channel leaves old login, recovery and serving-director succession usable", async () => {
  const director = await signIn("synthetic-email-director@example.invalid"),
    successor = await member();
  const { proof } = await start(director.actor, "synthetic-unreachable@example.invalid");
  await advance(director.actor, proof);
  await unchanged(director.actor, "synthetic-email-director@example.invalid");
  expect((await signIn("synthetic-email-director@example.invalid")).data.emailVerified).toBe(true);
  await safe(
    owner().requestReset(
      "synthetic-email-recovery",
      newId(),
      "synthetic-email-director@example.invalid",
    ),
  );
  const [resetRows] = await safe(
    control.query<RowDataPacket[]>(
      "SELECT id FROM identity_challenges WHERE user_id=? AND purpose='password_reset' AND consumed=0",
      [director.actor.userId],
    ),
  );
  expect(
    (await mail(String(resetRows[0]?.id))).email === "synthetic-email-director@example.invalid",
  ).toBe(true);
  const requested = await safe(owner().requestSuccession(director.actor, successor.id, newId()));
  const succession = await mail(String(requested.id));
  expect(succession.email === "synthetic-email-director@example.invalid").toBe(true);
  await safe(
    owner().confirmSuccession(
      director.actor,
      successor.id,
      succession.id,
      succession.code,
      newId(),
    ),
  );
  expect(
    (await safe(owner().current(successor.actor))).data.capabilities.includes(
      "leadership.transfer",
    ),
  ).toBe(true);
});

test("restart replaces both stages and rejects replaced proofs while retaining the old verified channel", async () => {
  const m = await member(),
    first = await start(m.actor),
    second = await start(m.actor);
  await expect(
    safe(
      owner().confirmChallenge(m.actor, newId(), {
        purpose: "email_change",
        challengeId: first.proof.id,
        code: first.proof.code,
      }),
    ),
  ).rejects.toMatchObject({ statusCode: 401 });
  const proposed = await advance(m.actor, second.proof),
    replacement = await start(m.actor);
  await expect(
    safe(
      owner().confirmEmailChange(m.actor, newId(), {
        challengeId: proposed.id,
        code: proposed.code,
      }),
    ),
  ).rejects.toMatchObject({ statusCode: 401 });
  const pending = (await safe(owner().pendingEmailChange(m.actor))).pending;
  expect(pending?.id).toBe(replacement.proof.id);
  expect(pending?.stage).toBe("current_email");
  await unchanged(m.actor, m.email);
});

test("proofs bind actor, purpose and channel; proposed attempts exhaust without modifying identity", async () => {
  const m = await member(),
    other = await member(),
    first = await start(m.actor),
    original = await snapshot(m.id);
  const input = { challengeId: first.proof.id, code: first.proof.code };
  await expect(safe(owner().confirmEmailChange(m.actor, newId(), input))).rejects.toMatchObject({
    statusCode: 401,
  });
  await expect(
    safe(owner().confirmChallenge(other.actor, newId(), { purpose: "email_change", ...input })),
  ).rejects.toMatchObject({ statusCode: 401 });
  await expect(
    safe(owner().confirmChallenge(m.actor, newId(), { purpose: "email_verification", ...input })),
  ).rejects.toMatchObject({ statusCode: 401 });
  const proposed = await advance(m.actor, first.proof);
  await expect(
    safe(
      owner().confirmEmailChange(other.actor, newId(), {
        challengeId: proposed.id,
        code: proposed.code,
      }),
    ),
  ).rejects.toMatchObject({ statusCode: 401 });
  await expect(
    safe(
      owner().confirmChallenge(m.actor, newId(), {
        purpose: "email_change",
        challengeId: proposed.id,
        code: proposed.code,
      }),
    ),
  ).rejects.toMatchObject({ statusCode: 401 });
  for (let attempt = 0; attempt < 5; attempt++)
    await expect(
      safe(
        owner().confirmEmailChange(m.actor, newId(), {
          challengeId: proposed.id,
          code: first.proof.code,
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 401 });
  await expect(
    safe(
      owner().confirmEmailChange(m.actor, newId(), {
        challengeId: proposed.id,
        code: proposed.code,
      }),
    ),
  ).rejects.toMatchObject({ statusCode: 401 });
  expect((await safe(owner().pendingEmailChange(m.actor))).pending).toBe(null);
  expect(await snapshot(m.id)).toEqual(original);
});

test.each([false, true])(
  "email stage expiry is exact and recoverable (proposed=%s)",
  async (proposedStage) => {
    const m = await member(),
      { proof } = await start(m.actor),
      selected = proposedStage ? await advance(m.actor, proof) : proof;
    instant += 600000;
    const input = { challengeId: selected.id, code: selected.code };
    await expect(
      safe(
        proposedStage
          ? owner().confirmEmailChange(m.actor, newId(), input)
          : owner().confirmChallenge(m.actor, newId(), { purpose: "email_change", ...input }),
      ),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect((await safe(owner().pendingEmailChange(m.actor))).pending).toBe(null);
    await unchanged(m.actor, m.email);
    await start(m.actor);
  },
);

test.each(["emailEpoch", "accessEpoch", "credentialEpoch", "identityEpoch"] as const)(
  "proposed proof rejects changed %s after authoritative recheck",
  async (field) => {
    const m = await member(),
      { proof } = await start(m.actor),
      proposed = await advance(m.actor, proof);
    await safe(
      unit.run((tx) =>
        unit
          .client(tx)
          .update(membership)
          .set({ [field]: 2 })
          .where(eq(membership.userId, m.id)),
      ),
    );
    const fresh = await signIn(m.email);
    await expect(
      safe(
        owner().confirmEmailChange(fresh.actor, newId(), {
          challengeId: proposed.id,
          code: proposed.code,
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect((await safe(owner().pendingEmailChange(fresh.actor))).pending).toBe(null);
    await unchanged(fresh.actor, m.email);
  },
);

test("concurrent same-key old confirmation and competing final confirmations produce one final event", async () => {
  const m = await member(),
    { proof } = await start(m.actor),
    key = newId();
  const input = { purpose: "email_change" as const, challengeId: proof.id, code: proof.code };
  const results = await Promise.all(
    [1, 2].map(() => safe(owner().confirmChallenge(m.actor, key, input))),
  );
  expect(results[0]).toEqual(results[1]);
  const proposed = await mail(String(results[0]?.id)),
    before = await snapshot(m.id);
  const outcomes = await Promise.allSettled(
    [1, 2].map(() =>
      safe(
        owner().confirmEmailChange(m.actor, newId(), {
          challengeId: proposed.id,
          code: proposed.code,
        }),
      ),
    ),
  );
  expect(outcomes.filter((outcome) => outcome.status === "fulfilled").length).toBe(1);
  expect(outcomes.filter((outcome) => outcome.status === "rejected").length).toBe(1);
  const after = await snapshot(m.id);
  expect(Number(after?.events)).toBe(Number(before?.events) + 1);
  expect(Number(after?.sessions)).toBe(0);
});

test("competing valid proposed proofs for one address commit one swap and durably fail the uniqueness loser", async () => {
  const first = await member(),
    second = await member(),
    proposedEmail = `${newId()}@example.invalid`;
  const oldFirst = await start(first.actor, proposedEmail),
    oldSecond = await start(second.actor, proposedEmail);
  const proofFirst = await advance(first.actor, oldFirst.proof),
    proofSecond = await advance(second.actor, oldSecond.proof);
  const keys = [newId(), newId()],
    members = [first, second],
    proofs = [proofFirst, proofSecond];
  const outcomes = await Promise.allSettled(
    members.map((m, index) =>
      safe(
        owner().confirmEmailChange(m.actor, keys[index] ?? newId(), {
          challengeId: proofs[index]?.id ?? "",
          code: proofs[index]?.code ?? "",
        }),
      ),
    ),
  );
  expect(outcomes.filter((outcome) => outcome.status === "fulfilled").length).toBe(1);
  const loser = outcomes.findIndex((outcome) => outcome.status === "rejected"),
    m = members[loser],
    proof = proofs[loser];
  if (!m || !proof) throw new Error("SYNTHETIC_UNIQUENESS_LOSER_REQUIRED");
  expect(outcomes[loser]).toMatchObject({ status: "rejected", reason: { statusCode: 401 } });
  await unchanged(m.actor, m.email);
  await expect(
    safe(
      owner().confirmEmailChange(m.actor, keys[loser] ?? newId(), {
        challengeId: proof.id,
        code: proof.code,
      }),
    ),
  ).rejects.toMatchObject({ statusCode: 401 });
  const [rows] = await safe(
    control.query<RowDataPacket[]>(
      "SELECT attempts, consumed FROM identity_challenges WHERE id=?",
      [proof.id],
    ),
  );
  expect(Number(rows[0]?.attempts)).toBe(1);
  expect(Number(rows[0]?.consumed)).toBe(1);
  const [users] = await safe(
    control.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM identity_users WHERE email=? AND email_verified=1",
      [proposedEmail],
    ),
  );
  expect(Number(users[0]?.n)).toBe(1);
});

test("failed proposed delivery rolls back old proof consumption and required event failure rolls back final identity writes", async () => {
  const m = await member(),
    { proof } = await start(m.actor),
    initial = await snapshot(m.id);
  const noDelivery = createIdentity(unit, config, { accessEvents: ports.accessEvents }, time);
  const oldInput = { purpose: "email_change" as const, challengeId: proof.id, code: proof.code };
  await expect(safe(noDelivery.confirmChallenge(m.actor, newId(), oldInput))).rejects.toMatchObject(
    { statusCode: 503 },
  );
  const throwing = createIdentity(
    unit,
    config,
    {
      ...ports,
      delivery: {
        async enqueue(tx, payload) {
          await ports.delivery.enqueue(tx, payload);
          throw new Error("SYNTHETIC_DELIVERY_FAILURE");
        },
      },
    },
    time,
  );
  await expect(safe(throwing.confirmChallenge(m.actor, newId(), oldInput))).rejects.toMatchObject({
    statusCode: 500,
  });
  const [mailRows] = await safe(
    control.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM synthetic_email_mail WHERE JSON_UNQUOTE(JSON_EXTRACT(payload, '$.userId')) = ?",
      [m.id],
    ),
  );
  expect(Number(mailRows[0]?.n)).toBe(2);
  const [oldRows] = await safe(
    control.query<RowDataPacket[]>(
      "SELECT attempts, consumed FROM identity_challenges WHERE id=?",
      [proof.id],
    ),
  );
  expect(Number(oldRows[0]?.attempts)).toBe(0);
  expect(Number(oldRows[0]?.consumed)).toBe(0);
  const proposed = await advance(m.actor, proof),
    finalInput = { challengeId: proposed.id, code: proposed.code };
  const noEvents = createIdentity(unit, config, { delivery: ports.delivery }, time);
  await expect(
    safe(noEvents.confirmEmailChange(m.actor, newId(), finalInput)),
  ).rejects.toMatchObject({ statusCode: 503 });
  const failedEvent = createIdentity(
    unit,
    config,
    {
      ...ports,
      accessEvents: {
        async append(tx, event) {
          await ports.accessEvents.append(tx, event);
          throw new Error("SYNTHETIC_EVENT_FAILURE");
        },
      },
    },
    time,
  );
  await expect(
    safe(failedEvent.confirmEmailChange(m.actor, newId(), finalInput)),
  ).rejects.toMatchObject({ statusCode: 500 });
  expect(await snapshot(m.id)).toEqual(initial);
  const [newRows] = await safe(
    control.query<RowDataPacket[]>(
      "SELECT attempts, consumed FROM identity_challenges WHERE id=?",
      [proposed.id],
    ),
  );
  expect(Number(newRows[0]?.attempts)).toBe(0);
  expect(Number(newRows[0]?.consumed)).toBe(0);
  await safe(owner().confirmEmailChange(m.actor, newId(), finalInput));
});

test("canonical and semantic 254/255 email boundaries return safe 422 without database writes", async () => {
  const m = await member(),
    { app, headers } = await api(m);
  const email254 = `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`;
  expect(email254.length).toBe(254);
  try {
    const send = (email: string) =>
      app.inject({
        method: "POST",
        url: "/api/v1/me/credential-challenges",
        headers: { ...headers, "idempotency-key": newId() },
        payload: { purpose: "email_change", newEmail: email },
      });
    expect((await send(email254)).statusCode).toBe(202);
    const before = (await safe(owner().pendingEmailChange(m.actor))).pending?.id;
    const rejected = await send(`${email254}e`);
    expect(rejected.statusCode).toBe(422);
    expect(rejected.body.includes(email254)).toBe(false);
    expect(rejected.body.includes("SQL")).toBe(false);
    await expect(
      safe(owner().requestChallenge(m.actor, newId(), "email_change", `${email254}e`)),
    ).rejects.toMatchObject({ statusCode: 422 });
    expect((await safe(owner().pendingEmailChange(m.actor))).pending?.id).toBe(before);
  } finally {
    await app.close();
  }
});
