import { identityDiagnostics } from "../support/identity-diagnostics.ts";
import { createHmac, randomBytes } from "node:crypto";
import { createUnitOfWork, newId, runMigrations, type TxContext, type UnitOfWork } from "@vtc/db";
import { account, company, eq, membership, sql, user } from "@vtc/db/identity-schema";
import type { Connection, RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { createApp } from "../../apps/api/src/app.ts";
import * as authEngine from "../../apps/api/src/modules/identity/engine.ts";
import {
  type CredentialProof,
  engine,
  verifySignInCredential,
} from "../../apps/api/src/modules/identity/engine.ts";
import {
  createIdentity,
  type PrivateChallenge,
} from "../../apps/api/src/modules/identity/service.ts";
import {
  SCHEMA_SETUP_TIMEOUT_MS,
  guardedSettings,
  reset,
  testConnection,
} from "../persistence/support.ts";
import { bounded, deferred } from "../support/concurrency.ts";

const config = {
  secret: randomBytes(32).toString("hex"),
  origin: "http://127.0.0.1:4173",
  production: false,
};
const password = "Synthetic-admission-passphrase-42";
const diagnostic = identityDiagnostics("admission");
let control: Connection;
let unit: UnitOfWork;
let activeTransactions = 0;
let instant = Date.now();
const time = () => new Date(instant);
const tracked: UnitOfWork = {
  client: (tx) => unit.client(tx),
  close: async () => {},
  async run(command) {
    activeTransactions++;
    try {
      return await unit.run(command);
    } finally {
      activeTransactions--;
    }
  },
};
const ports = {
  delivery: {
    enqueue: async (tx: TxContext, payload: PrivateChallenge) => {
      await unit
        .client(tx)
        .execute(
          sql`INSERT INTO synthetic_admission_mail VALUES (${payload.id}, ${JSON.stringify(payload)})`,
        );
    },
  },
  accessEvents: {
    append: async (tx: TxContext, event: { eventId: string }) => {
      await unit
        .client(tx)
        .execute(sql`INSERT INTO synthetic_admission_events VALUES (${event.eventId})`);
    },
  },
};
const identity = () => createIdentity(tracked, config, ports, time);
async function safe<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    diagnostic.failure(error);
    throw Object.assign(new Error("SYNTHETIC_ADMISSION_OPERATION_FAILED"), {
      statusCode:
        error && typeof error === "object" && "statusCode" in error ? error.statusCode : 500,
    });
  }
}
async function signIn(email: string) {
  const owner = identity();
  const result = await safe(owner.login(email, password));
  const cookie = result.cookies.map((value) => value.split(";", 1)[0]).join("; ");
  return { cookie, actor: await safe(owner.authenticate(new Headers({ cookie }))) };
}
async function latest(userId: string, purpose: string): Promise<PrivateChallenge> {
  const [rows] = await safe(
    control.query<RowDataPacket[]>(
      "SELECT m.payload FROM synthetic_admission_mail m JOIN identity_challenges c ON c.id = m.id WHERE c.user_id = ? AND c.purpose = ? AND c.consumed = 0",
      [userId, purpose],
    ),
  );
  const values = rows.map((row) =>
    typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload,
  ) as PrivateChallenge[];
  const found = values
    .filter((value) => value.userId === userId && value.purpose === purpose)
    .at(-1);
  if (!found) throw new Error("SYNTHETIC_ADMISSION_CHALLENGE_MISSING");
  return found;
}
async function addMember() {
  const id = newId(),
    email = `${newId()}@example.invalid`;
  const owner = identity();
  const credential = await owner.prepareCredential(password);
  await safe(
    unit.run((tx) =>
      owner.insertWithCredential(tx, {
        userId: id,
        email,
        name: "Synthetic Admission Member",
        roles: ["driver"],
        ...credential,
      }),
    ),
  );
  const logged = await signIn(email);
  await safe(owner.requestChallenge(logged.actor, newId(), "email_verification"));
  const challenge = await latest(id, "email_verification");
  await safe(
    owner.confirmChallenge(logged.actor, newId(), {
      purpose: "email_verification",
      challengeId: challenge.id,
      code: challenge.code,
    }),
  );
  return { id, email, ...logged };
}
async function director() {
  const [rows] = await safe(
    control.query<RowDataPacket[]>(
      "SELECT u.email FROM identity_company c JOIN identity_users u ON u.id = c.director_user_id",
    ),
  );
  return signIn(String(rows[0]?.email));
}
async function sessionCount(id: string) {
  const [rows] = await safe(
    control.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM identity_sessions WHERE user_id = ?",
      [id],
    ),
  );
  return Number(rows[0]?.n);
}
beforeAll(async () => {
  try {
    control = await diagnostic.phase("connection", () => testConnection());
    await diagnostic.phase("reset", () => reset(control));
    await diagnostic.phase("migrations", () => runMigrations(guardedSettings()));
    await diagnostic.phase("synthetic_ddl", () =>
      control.query(
        "CREATE TABLE synthetic_admission_mail (id VARCHAR(36) PRIMARY KEY, payload JSON NOT NULL) ENGINE=InnoDB",
      ),
    );
    await diagnostic.phase("synthetic_ddl", () =>
      control.query(
        "CREATE TABLE synthetic_admission_events (id VARCHAR(36) PRIMARY KEY) ENGINE=InnoDB",
      ),
    );
    unit = diagnostic.unit(createUnitOfWork(guardedSettings()), control);
    const email = "admission-director@example.invalid";
    await diagnostic.phase("bootstrap", () =>
      identity().bootstrap({ email, name: "Synthetic Admission Director", password }),
    );
    const logged = await diagnostic.phase("verification", () => signIn(email));
    await diagnostic.phase("verification", () =>
      identity().requestChallenge(logged.actor, newId(), "email_verification"),
    );
    const challenge = await diagnostic.phase("verification", () =>
      latest(logged.actor.userId, "email_verification"),
    );
    await diagnostic.phase("verification", () =>
      identity().confirmChallenge(logged.actor, newId(), {
        purpose: "email_verification",
        challengeId: challenge.id,
        code: challenge.code,
      }),
    );
  } catch {
    throw new Error("SYNTHETIC_ADMISSION_SETUP_FAILED");
  }
}, SCHEMA_SETUP_TIMEOUT_MS);
beforeEach(async () => {
  await safe(control.query("DELETE FROM identity_limits"));
});
afterAll(async () => {
  await unit?.close();
  await control?.end();
});

test("a flooded source cannot charge global after denial; category budgets, restart, concurrency and window expiry remain bounded", async () => {
  const owner = identity();
  const slot = (value: string) => createHmac("sha256", config.secret).update(value).digest()[0];
  const first = "synthetic-flood-source";
  let second = "synthetic-distinct-source";
  while (slot(second) === slot(first)) second += "x";
  let admitted = 0,
    denied = 0;
  for (let i = 0; i < 225; i++) {
    try {
      await safe(owner.rateLimit("login", first));
      admitted++;
    } catch (error) {
      expect((error as { statusCode: number }).statusCode).toBe(429);
      denied++;
    }
  }
  expect(admitted).toBe(20);
  expect(denied).toBe(205);
  const [global] = await safe(
    control.query<RowDataPacket[]>(
      "SELECT count FROM identity_limits WHERE bucket = 'global:login'",
    ),
  );
  expect(Number(global[0]?.count)).toBe(20);
  await safe(identity().rateLimit("login", second));
  // Ten different admitted slots fill only the CSRF global category.
  const used = new Set<number>();
  for (let i = 0; used.size < 10; i++) {
    const source = `synthetic-csrf-${i}`,
      key = slot(source);
    if (key === undefined || used.has(key)) continue;
    used.add(key);
    for (let n = 0; n < 20; n++) await safe(owner.rateLimit("csrf", source));
  }
  let extra = "synthetic-extra-csrf";
  while (used.has(slot(extra) ?? -1)) extra += "x";
  await expect(safe(owner.rateLimit("csrf", extra))).rejects.toMatchObject({
    statusCode: 429,
  });
  await safe(owner.rateLimit("command", second));
  await safe(owner.rateLimit("login", second));
  const actorGlobalBefore = await safe(
    control.query<RowDataPacket[]>(
      "SELECT count FROM identity_limits WHERE bucket = 'global:challenge'",
    ),
  );
  await safe(owner.rateLimit("challenge", first, "actor"));
  const actorGlobalAfter = await safe(
    control.query<RowDataPacket[]>(
      "SELECT count FROM identity_limits WHERE bucket = 'global:challenge'",
    ),
  );
  expect(actorGlobalBefore[0].length).toBe(actorGlobalAfter[0].length);
  await safe(control.query("DELETE FROM identity_limits"));
  for (let i = 0; i < 19; i++) await safe(owner.rateLimit("login", first));
  const results = await Promise.allSettled(
    Array.from({ length: 5 }, () => safe(identity().rateLimit("login", first))),
  );
  expect(results.filter((result) => result.status === "fulfilled").length).toBe(1);
  expect(results.filter((result) => result.status === "rejected").length).toBe(4);
  await expect(safe(identity().rateLimit("login", first))).rejects.toMatchObject({
    statusCode: 429,
  });
  instant += 60000;
  await safe(identity().rateLimit("login", first));
  const [renewed] = await safe(
    control.query<RowDataPacket[]>(
      "SELECT count FROM identity_limits WHERE bucket = 'global:login'",
    ),
  );
  expect(Number(renewed[0]?.count)).toBe(1);
  const [counts] = await safe(
    control.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM identity_limits"),
  );
  expect(Number(counts[0]?.n)).toBeLessThanOrEqual(2565);
});

test("every owned route rejects a denied socket source before actor/current/crypto or command work, ignoring forwarded addresses", async () => {
  const owner = identity();
  for (const category of ["csrf", "login", "challenge", "command", "read"] as const)
    for (let n = 0; n < 20; n++) await safe(owner.rateLimit(category, "127.0.0.1"));
  const guarded = [
    "authenticate",
    "current",
    "login",
    "logout",
    "requestReset",
    "resetPassword",
    "requestChallenge",
    "confirmChallenge",
    "pendingEmailChange",
    "confirmEmailChange",
    "preferences",
  ] as const;
  const spies = guarded.map((method) =>
    vi.spyOn(owner, method).mockImplementation(async () => {
      throw new Error("SYNTHETIC_DENIED_WORK_REACHED");
    }),
  );
  const crypto = vi.spyOn(authEngine, "verifySignInCredential");
  const app = await createApp({ checkReadiness: async () => true, identity: owner });
  app.get("/api/v1/members", async () => ({ synthetic: true }));
  app.post("/api/v1/members", async () => ({ synthetic: true }));
  try {
    const requests = [
      ["GET", "/api/v1/auth/csrf"],
      ["GET", "/api/v1/me"],
      ["POST", "/api/v1/auth/login"],
      ["POST", "/api/v1/auth/logout"],
      ["POST", "/api/v1/auth/password-reset-requests"],
      ["POST", "/api/v1/auth/password-resets"],
      ["POST", "/api/v1/me/email-verification-requests"],
      ["POST", "/api/v1/me/email-verifications"],
      ["POST", "/api/v1/me/credential-challenges"],
      ["POST", "/api/v1/me/credential-changes"],
      ["GET", "/api/v1/me/email-change"],
      ["POST", "/api/v1/me/email-change-confirmations"],
      ["PATCH", "/api/v1/me/preferences"],
    ] as const;
    for (const [method, url] of requests) {
      const response = await app.inject({
        method,
        url,
        headers: {
          cookie: "vtc_dev_session=synthetic-unknown",
          "x-forwarded-for": "198.51.100.17",
        },
      });
      expect(response.statusCode).toBe(429);
      expect(response.headers["retry-after"]).toBe("60");
    }
    for (const spy of spies) expect(spy.mock.calls.length).toBe(0);
    expect(crypto.mock.calls.length).toBe(0);
    expect((await app.inject({ url: "/api/v1/members" })).statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/members",
          headers: { "content-type": "text/plain" },
          payload: "synthetic",
        })
      ).statusCode,
    ).toBe(200);
  } finally {
    await app.close();
    for (const spy of spies) spy.mockRestore();
    crypto.mockRestore();
  }
});

test("native scrypt holds no transaction or pool connection and authenticated me finishes before verification is released", async () => {
  const member = await addMember();
  const entered = deferred<void>(),
    release = deferred<void>();
  const original = authEngine.verifySignInCredential;
  const verify = vi
    .spyOn(authEngine, "verifySignInCredential")
    .mockImplementation(async (...input) => {
      expect(activeTransactions).toBe(0);
      entered.resolve();
      await bounded(release.promise, "verification_release", 5000);
      return original(...input);
    });
  const app = await createApp({ checkReadiness: async () => true, identity: identity() });
  const pending = safe(identity().login(member.email, password));
  try {
    await bounded(entered.promise, "verification_entered");
    expect(activeTransactions).toBe(0);
    const me = await bounded(
      app.inject({ url: "/api/v1/me", headers: { cookie: member.cookie } }),
      "me_during_verification",
    );
    expect(me.statusCode).toBe(200);
    release.resolve();
    await pending;
    expect(verify.mock.calls.length).toBe(1);
  } finally {
    release.resolve();
    await pending.catch(() => {});
    await app.close();
    verify.mockRestore();
  }
});

test.each(["reset", "deactivate", "hash", "identity_epoch", "succession"] as const)(
  "a verified login snapshot cannot issue a session after coordinated %s change",
  async (change) => {
    const member = await addMember(),
      admin = await director();
    const successor = change === "succession" ? await addMember() : null;
    const entered = deferred<void>(),
      release = deferred<void>();
    const original = authEngine.verifySignInCredential;
    const verify = vi
      .spyOn(authEngine, "verifySignInCredential")
      .mockImplementation(async (...input) => {
        entered.resolve();
        await bounded(release.promise, "stale_verification_release", 5000);
        return original(...input);
      });
    const pending = safe(identity().login(member.email, password)).then(
      () => 200,
      (error: { statusCode: number }) => error.statusCode,
    );
    try {
      await bounded(entered.promise, "stale_verification_entered");
      if (change === "reset") {
        await safe(identity().requestReset("synthetic-stale-reset", newId(), member.email));
        const challenge = await latest(member.id, "password_reset");
        await safe(
          identity().resetPassword(
            "synthetic-stale-reset",
            newId(),
            challenge.code,
            "Synthetic-replacement-password-43",
          ),
        );
      } else if (change === "deactivate") {
        const [rows] = await safe(
          control.query<RowDataPacket[]>(
            "SELECT version FROM identity_memberships WHERE user_id = ?",
            [member.id],
          ),
        );
        await safe(
          identity().administer(admin.actor, member.id, newId(), Number(rows[0]?.version), {
            kind: "deactivate",
          }),
        );
      } else if (change === "hash") {
        const replacement = await identity().prepareCredential("Synthetic-replacement-password-43");
        await safe(
          unit.run((tx) =>
            unit
              .client(tx)
              .update(account)
              .set({ password: replacement.passwordHash })
              .where(eq(account.userId, member.id)),
          ),
        );
      } else if (change === "identity_epoch") {
        await safe(
          unit.run((tx) =>
            unit
              .client(tx)
              .update(membership)
              .set({ identityEpoch: sql`${membership.identityEpoch} + 1` })
              .where(eq(membership.userId, member.id)),
          ),
        );
      } else if (successor) {
        await safe(identity().requestSuccession(admin.actor, successor.id, newId()));
        const challenge = await latest(admin.actor.userId, "succession");
        await safe(
          identity().confirmSuccession(
            admin.actor,
            successor.id,
            challenge.id,
            challenge.code,
            newId(),
          ),
        );
      }
      const before = await sessionCount(member.id);
      release.resolve();
      expect(await pending).toBe(401);
      expect(await sessionCount(member.id)).toBe(before);
    } finally {
      release.resolve();
      await pending;
      verify.mockRestore();
    }
  },
);

test("opaque native proof rejects forgery, another config/user/epoch and a mismatched password", async () => {
  const member = await addMember();
  await safe(
    unit.run(async (tx) => {
      const [identityRow] = await unit.client(tx).select().from(user).where(eq(user.id, member.id));
      const [credential] = await unit
        .client(tx)
        .select()
        .from(account)
        .where(eq(account.userId, member.id));
      const [row] = await unit
        .client(tx)
        .select()
        .from(membership)
        .where(eq(membership.userId, member.id));
      const [state] = await unit.client(tx).select().from(company);
      if (!identityRow || !credential?.password || !row || !state)
        throw new Error("SYNTHETIC_BINDING_REQUIRED");
      const binding = {
        userId: member.id,
        credentialId: credential.id,
        email: member.email,
        emailVerified: identityRow.emailVerified,
        accessEpoch: row.accessEpoch,
        credentialEpoch: row.credentialEpoch,
        identityEpoch: row.identityEpoch,
        emailEpoch: row.emailEpoch,
        companyVersion: state.version,
      };
      // Only the test exercises verifier construction inside a fixture transaction;
      // the production login's coordinated test above requires zero held Tx slots.
      const proof = await verifySignInCredential(credential.password, password, config, binding);
      if (!proof) throw new Error("SYNTHETIC_PROOF_REQUIRED");
      expect(() => engine(unit.client(tx), config, {} as CredentialProof, binding)).toThrow(
        "INVALID_INTERNAL_CREDENTIAL_PROOF",
      );
      expect(() =>
        engine(
          unit.client(tx),
          { ...config, origin: "https://other.example.invalid", production: true },
          proof,
          binding,
        ),
      ).toThrow("INVALID_INTERNAL_CREDENTIAL_PROOF");
      expect(() => engine(unit.client(tx), config, proof, { ...binding, userId: newId() })).toThrow(
        "INVALID_INTERNAL_CREDENTIAL_PROOF",
      );
      expect(() =>
        engine(unit.client(tx), config, proof, {
          ...binding,
          accessEpoch: binding.accessEpoch + 1,
        }),
      ).toThrow("INVALID_INTERNAL_CREDENTIAL_PROOF");
      const finalEngine = engine(unit.client(tx), config, proof, binding);
      // Invalid hash syntax would reach native crypto (and throw) without the
      // proof's exact-pair verifier. Its dummy hash fallback also fails closed.
      expect(
        await finalEngine.options.emailAndPassword.password.verify({
          hash: "synthetic-invalid-hash",
          password,
        }),
      ).toBe(false);
      await expect(
        finalEngine.options.emailAndPassword.password.hash(password),
      ).rejects.toMatchObject({ statusCode: 401 });
      const wrong = await finalEngine.api.signInEmail({
        body: { email: member.email, password: "Synthetic-wrong-password" },
        asResponse: true,
      });
      expect(wrong.status).toBe(401);
    }),
  );
});

test("taken and current email confirmations durably fail generically without identity/session/event effects or endless replay", async () => {
  const member = await addMember(),
    taken = await addMember(),
    owner = identity();
  const app = await createApp({ checkReadiness: async () => true, identity: owner });
  const logs: string[] = [];
  const output = vi
    .spyOn(console, "error")
    .mockImplementation((value: unknown) => logs.push(String(value)));
  try {
    for (const proposedEmail of [taken.email, member.email]) {
      await safe(owner.requestChallenge(member.actor, newId(), "email_change", proposedEmail));
      let challenge = await latest(member.id, "email_change");
      const proposedStage = proposedEmail !== member.email;
      if (proposedStage) {
        await safe(
          owner.confirmChallenge(member.actor, newId(), {
            purpose: "email_change",
            challengeId: challenge.id,
            code: challenge.code,
          }),
        );
        challenge = await latest(member.id, "email_change");
      }
      const [before] = await safe(
        control.query<RowDataPacket[]>(
          "SELECT u.email, u.email_verified, m.version, m.access_epoch, m.identity_epoch, m.credential_epoch, m.email_epoch FROM identity_users u JOIN identity_memberships m ON m.user_id = u.id WHERE u.id = ?",
          [member.id],
        ),
      );
      const [eventsBefore] = await safe(
        control.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM synthetic_admission_events"),
      );
      const sessionsBefore = await sessionCount(member.id);
      const csrf = await app.inject({
        url: "/api/v1/auth/csrf",
        headers: { cookie: member.cookie },
      });
      expect(csrf.statusCode).toBe(200);
      const key = newId();
      const confirm = (idempotencyKey: string, code = challenge.code) =>
        app.inject({
          method: "POST",
          url: proposedStage
            ? "/api/v1/me/email-change-confirmations"
            : "/api/v1/me/credential-changes",
          headers: {
            cookie: member.cookie,
            origin: config.origin,
            "x-csrf-token": csrf.json().data.token,
            "idempotency-key": idempotencyKey,
          },
          payload: {
            ...(proposedStage ? {} : { kind: "email_change" }),
            challengeId: challenge.id,
            code,
          },
        });
      const rejected = await confirm(key),
        replay = await confirm(key),
        consumed = await confirm(newId(), "synthetic-invalid-code");
      expect(rejected.statusCode).toBe(401);
      expect(replay.statusCode).toBe(401);
      expect(consumed.statusCode).toBe(401);
      expect(rejected.json().error).toEqual({
        code: "UNAUTHORIZED",
        messageKey: "errors.unauthorized",
        retryable: false,
      });
      expect(replay.json().error).toEqual(rejected.json().error);
      expect(consumed.json().error).toEqual(rejected.json().error);
      const [attempts] = await safe(
        control.query<RowDataPacket[]>(
          "SELECT attempts, consumed FROM identity_challenges WHERE id = ?",
          [challenge.id],
        ),
      );
      expect(Number(attempts[0]?.attempts)).toBe(1);
      expect(Number(attempts[0]?.consumed)).toBe(1);
      const [result] = await safe(
        control.query<RowDataPacket[]>(
          "SELECT result FROM identity_command_results WHERE command_key = ?",
          [key],
        ),
      );
      const durable =
        typeof result[0]?.result === "string" ? JSON.parse(result[0].result) : result[0]?.result;
      expect(durable).toEqual({ failure: 401 });
      const [after] = await safe(
        control.query<RowDataPacket[]>(
          "SELECT u.email, u.email_verified, m.version, m.access_epoch, m.identity_epoch, m.credential_epoch, m.email_epoch FROM identity_users u JOIN identity_memberships m ON m.user_id = u.id WHERE u.id = ?",
          [member.id],
        ),
      );
      expect(after).toEqual(before);
      expect(await sessionCount(member.id)).toBe(sessionsBefore);
      const [eventsAfter] = await safe(
        control.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM synthetic_admission_events"),
      );
      expect(Number(eventsAfter[0]?.n)).toBe(Number(eventsBefore[0]?.n));
      expect(
        (await app.inject({ url: "/api/v1/me", headers: { cookie: member.cookie } })).statusCode,
      ).toBe(200);
      expect(rejected.body.includes(proposedEmail)).toBe(false);
      expect(rejected.body.includes("UPDATE")).toBe(false);
    }
    expect(logs.length).toBe(0);
  } finally {
    await app.close();
    output.mockRestore();
  }
});

test("two-hop succession derives Director only from the pointer and preserves removable explicit Deputy/Dispatcher roles", async () => {
  const owner = identity(),
    first = await director(),
    second = await addMember(),
    third = await addMember();
  const [version] = await safe(
    control.query<RowDataPacket[]>("SELECT version FROM identity_memberships WHERE user_id = ?", [
      second.id,
    ]),
  );
  await safe(
    owner.administer(first.actor, second.id, newId(), Number(version[0]?.version), {
      kind: "roles",
      roles: ["driver", "dispatcher", "deputy_director"],
    }),
  );
  const deputy = await signIn(second.email);
  const transfer = async (actor: typeof first.actor, successorId: string) => {
    await safe(owner.requestSuccession(actor, successorId, newId()));
    const challenge = await latest(actor.userId, "succession");
    await safe(owner.confirmSuccession(actor, successorId, challenge.id, challenge.code, newId()));
  };
  await transfer(first.actor, second.id);
  const promoted = await safe(owner.current(deputy.actor));
  expect(promoted.data.member.roles.includes("director")).toBe(true);
  expect(promoted.data.member.roles.includes("deputy_director")).toBe(true);
  expect(promoted.data.capabilities.includes("leadership.transfer")).toBe(true);
  await transfer(deputy.actor, third.id);
  const former = await safe(owner.current(deputy.actor));
  expect(former.data.member.roles).toEqual(["deputy_director", "dispatcher", "driver"]);
  expect(former.data.capabilities.includes("members.manage")).toBe(true);
  expect(former.data.capabilities.includes("leadership.transfer")).toBe(false);
  await expect(
    safe(owner.requestSuccession(deputy.actor, first.actor.userId, newId())),
  ).rejects.toMatchObject({ statusCode: 403 });
  const final = await signIn(third.email);
  expect((await safe(owner.current(final.actor))).data.member.roles.includes("director")).toBe(
    true,
  );
  await safe(
    owner.administer(final.actor, second.id, newId(), former.version, {
      kind: "roles",
      roles: ["driver"],
    }),
  );
  const stripped = await signIn(second.email);
  const current = await safe(owner.current(stripped.actor));
  expect(current.data.member.roles).toEqual(["driver"]);
  expect(current.data.capabilities.includes("members.manage")).toBe(false);
  expect(current.data.capabilities.includes("leadership.transfer")).toBe(false);
  const [rows] = await safe(
    control.query<RowDataPacket[]>("SELECT director_user_id FROM identity_company"),
  );
  expect(String(rows[0]?.director_user_id)).toBe(third.id);
});
