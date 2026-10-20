import { identityDiagnostics } from "../support/identity-diagnostics.ts";
import { randomBytes } from "node:crypto";
import { createUnitOfWork, newId, runMigrations, type TxContext } from "@vtc/db";
import { eq, membership, sql } from "@vtc/db/identity-schema";
import type { Connection, RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { createApp } from "../../apps/api/src/app.ts";
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
const password = "Synthetic-reset-passphrase-42";
const diagnostic = identityDiagnostics("reset");
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
          sql`INSERT INTO synthetic_reset_mail VALUES (${payload.id}, ${JSON.stringify(payload)})`,
        );
    },
  },
  accessEvents: {
    async append(tx: TxContext, event: { eventId: string }) {
      await unit
        .client(tx)
        .execute(sql`INSERT INTO synthetic_reset_events VALUES (${event.eventId})`);
    },
  },
};
const owner = () => createIdentity(unit, config, ports, time);
async function safe<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    diagnostic.failure(error);
    throw Object.assign(new Error("SYNTHETIC_RESET_OPERATION_FAILED"), {
      statusCode:
        error && typeof error === "object" && "statusCode" in error ? error.statusCode : 500,
    });
  }
}
async function member(verified = true) {
  const identity = owner(),
    id = newId(),
    email = `${id}@example.invalid`;
  const credential = await identity.prepareCredential(password);
  await safe(
    unit.run((tx) =>
      identity.insertWithCredential(tx, {
        userId: id,
        email,
        name: "Synthetic Reset Member",
        roles: ["driver"],
        ...credential,
      }),
    ),
  );
  if (verified) {
    const login = await safe(identity.login(email, password));
    const cookie = login.cookies.map((value) => value.split(";", 1)[0]).join("; ");
    const actor = await safe(identity.authenticate(new Headers({ cookie })));
    const requested = await safe(identity.requestChallenge(actor, newId(), "email_verification"));
    const proof = await mail(String(requested.id));
    await safe(
      identity.confirmChallenge(actor, newId(), {
        purpose: "email_verification",
        challengeId: proof.id,
        code: proof.code,
      }),
    );
  }
  return { id, email };
}
async function mail(id: string): Promise<PrivateChallenge> {
  const [rows] = await safe(
    control.query<RowDataPacket[]>("SELECT payload FROM synthetic_reset_mail WHERE id=?", [id]),
  );
  if (!rows[0]) throw new Error("SYNTHETIC_RESET_MAIL_REQUIRED");
  return typeof rows[0].payload === "string" ? JSON.parse(rows[0].payload) : rows[0].payload;
}
async function active(id: string) {
  const [rows] = await safe(
    control.query<RowDataPacket[]>(
      "SELECT * FROM identity_challenges WHERE user_id=? AND purpose='password_reset' AND consumed=0",
      [id],
    ),
  );
  return rows;
}
async function resetMailCount(id: string) {
  const [rows] = await safe(
    control.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM synthetic_reset_mail WHERE JSON_UNQUOTE(JSON_EXTRACT(payload, '$.userId'))=? AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.purpose'))='password_reset'",
      [id],
    ),
  );
  return Number(rows[0]?.n);
}
const request = (email: string, identity = owner()) =>
  safe(identity.requestReset(`synthetic-reset-binding:${newId()}`, newId(), email));
async function proof(id: string) {
  const rows = await active(id);
  if (rows.length !== 1) throw new Error("SYNTHETIC_SINGLE_RESET_REQUIRED");
  return mail(String(rows[0]?.id));
}
function unchanged(before: RowDataPacket[], after: RowDataPacket[]) {
  // A failed assertion must not render protected verification material.
  expect(JSON.stringify(before) === JSON.stringify(after)).toBe(true);
}
async function binding(app: Awaited<ReturnType<typeof createApp>>) {
  const response = await app.inject({ url: "/api/v1/auth/csrf" });
  expect(response.statusCode).toBe(200);
  return {
    cookie: response.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "),
    origin: config.origin,
    "x-csrf-token": String(response.json().data.token),
    "idempotency-key": newId(),
  };
}
beforeAll(async () => {
  control = await diagnostic.phase("connection", () => testConnection());
  await diagnostic.phase("reset", () => reset(control));
  await diagnostic.phase("migrations", () => runMigrations(guardedSettings()));
  await diagnostic.phase("synthetic_ddl", () =>
    control.query(
      "CREATE TABLE synthetic_reset_mail (id VARCHAR(36) PRIMARY KEY, payload JSON NOT NULL) ENGINE=InnoDB",
    ),
  );
  await diagnostic.phase("synthetic_ddl", () =>
    control.query("CREATE TABLE synthetic_reset_events (id VARCHAR(36) PRIMARY KEY) ENGINE=InnoDB"),
  );
  unit = diagnostic.unit(createUnitOfWork(guardedSettings()), control);
  await diagnostic.phase("bootstrap", () =>
    safe(
      owner().bootstrap({
        email: "synthetic-reset-director@example.invalid",
        name: "Synthetic Reset Director",
        password,
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

test("distinct anonymous API bindings and coordinated requests retain one recovery code/mail across recreation", async () => {
  const m = await member(),
    entered = deferred<void>(),
    release = deferred<void>();
  let deliveryCalls = 0;
  const held = createIdentity(
    unit,
    config,
    {
      ...ports,
      delivery: {
        async enqueue(tx, payload) {
          deliveryCalls++;
          await ports.delivery.enqueue(tx, payload);
          entered.resolve();
          await bounded(release.promise, "reset_delivery");
        },
      },
    },
    time,
  );
  const app = await createApp({ checkReadiness: async () => true, identity: held });
  try {
    const bindings: Awaited<ReturnType<typeof binding>>[] = [];
    for (let n = 0; n < 16; n++) bindings.push(await binding(app));
    expect(new Set(bindings.map((headers) => headers.cookie)).size).toBe(16);
    const post = (index: number) => {
      const headers = bindings[index];
      if (!headers) throw new Error("SYNTHETIC_RESET_BINDING_REQUIRED");
      return app.inject({
        method: "POST",
        url: "/api/v1/auth/password-reset-requests",
        headers,
        payload: { email: m.email },
      });
    };
    const first = post(0);
    await bounded(entered.promise, "reset_issuance");
    const waiting = [1, 2, 3].map(post);
    release.resolve();
    const responses = await Promise.all([first, ...waiting]);
    for (const response of responses) {
      expect(response.statusCode).toBe(202);
      expect(response.json().data).toEqual({ status: "received" });
    }
    expect(deliveryCalls).toBe(1);
    const original = await active(m.id),
      token = await proof(m.id);
    for (let n = 4; n < 16; n++) {
      const response = await post(n);
      expect(response.statusCode).toBe(202);
      expect(response.json().data).toEqual({ status: "received" });
      expect(response.body.includes(m.email) || response.body.includes(token.code)).toBe(false);
    }
    await request(m.email, createIdentity(unit, config, ports, time));
    unchanged(original, await active(m.id));
    expect(await resetMailCount(m.id)).toBe(1);
    expect(deliveryCalls).toBe(1);
    const key = newId(),
      changedPassword = "Synthetic-reset-changed-43";
    await safe(
      owner().resetPassword("synthetic-legitimate-binding", key, token.code, changedPassword),
    );
    expect((await safe(owner().login(m.email, changedPassword))).data.member.id).toBe(m.id);
    await expect(safe(owner().login(m.email, password))).rejects.toMatchObject({ statusCode: 401 });
  } finally {
    release.resolve();
    await app.close();
  }
});

test("coalescing preserves attempts and original expiry until the exact expiration boundary", async () => {
  const m = await member();
  await request(m.email);
  const token = await proof(m.id),
    initialTime = instant;
  await expect(
    safe(
      owner().resetPassword(
        "synthetic-wrong-binding",
        newId(),
        `${token.id}.synthetic-wrong-code`,
        password,
      ),
    ),
  ).rejects.toMatchObject({ statusCode: 401 });
  const before = await active(m.id);
  expect(Number(before[0]?.attempts)).toBe(1);
  instant = initialTime + 599999;
  await request(m.email);
  unchanged(before, await active(m.id));
  expect(await resetMailCount(m.id)).toBe(1);
  instant = initialTime + 600000;
  await request(m.email);
  const renewed = await proof(m.id);
  expect(renewed.id !== token.id && renewed.code !== token.code).toBe(true);
  expect(new Date(renewed.expiresAt).getTime()).toBe(instant + 600000);
  expect(await resetMailCount(m.id)).toBe(2);
  await expect(
    safe(owner().resetPassword("synthetic-expired-binding", newId(), token.code, password)),
  ).rejects.toMatchObject({ statusCode: 401 });
});

test("consumed and exhausted recovery codes permit a fresh generation without changing authenticated replacement rules", async () => {
  const m = await member();
  await request(m.email);
  const first = await proof(m.id);
  await safe(owner().resetPassword("synthetic-consume-binding", newId(), first.code, password));
  await request(m.email);
  const second = await proof(m.id);
  expect(second.id !== first.id).toBe(true);
  for (let attempt = 0; attempt < 5; attempt++)
    await expect(
      safe(
        owner().resetPassword(
          "synthetic-attempt-binding",
          newId(),
          `${second.id}.synthetic-wrong-code`,
          password,
        ),
      ),
    ).rejects.toMatchObject({ statusCode: 401 });
  expect(Number((await active(m.id))[0]?.attempts)).toBe(5);
  await request(m.email);
  const third = await proof(m.id);
  expect(third.id !== second.id).toBe(true);
  expect(Number((await active(m.id))[0]?.attempts)).toBe(0);
  expect(await resetMailCount(m.id)).toBe(3);
  await safe(owner().resetPassword("synthetic-renewal-binding", newId(), third.code, password));
});

test.each(["emailEpoch", "accessEpoch", "credentialEpoch", "identityEpoch"] as const)(
  "a reset challenge with stale %s is replaced with a current bound generation",
  async (field) => {
    const m = await member();
    await request(m.email);
    const first = await proof(m.id);
    await safe(
      unit.run((tx) =>
        unit
          .client(tx)
          .update(membership)
          .set({ [field]: 2 })
          .where(eq(membership.userId, m.id)),
      ),
    );
    await request(m.email);
    const second = await proof(m.id);
    expect(second.id !== first.id).toBe(true);
    expect(await resetMailCount(m.id)).toBe(2);
    await expect(
      safe(owner().resetPassword("synthetic-stale-epoch", newId(), first.code, password)),
    ).rejects.toMatchObject({ statusCode: 401 });
    await safe(owner().resetPassword("synthetic-current-epoch", newId(), second.code, password));
  },
);

test("unknown, unverified and inactive accounts receive identical generic API acknowledgements without recovery mail", async () => {
  const unknown = `${newId()}@example.invalid`,
    unverified = await member(false),
    inactive = await member();
  await safe(
    unit.run((tx) =>
      unit
        .client(tx)
        .update(membership)
        .set({ status: "inactive" })
        .where(eq(membership.userId, inactive.id)),
    ),
  );
  const app = await createApp({ checkReadiness: async () => true, identity: owner() });
  try {
    for (const email of [unknown, unverified.email, inactive.email]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/password-reset-requests",
        headers: await binding(app),
        payload: { email },
      });
      expect(response.statusCode).toBe(202);
      expect(response.json().data).toEqual({ status: "received" });
      expect(response.body.includes(email)).toBe(false);
    }
    expect(await resetMailCount(unverified.id)).toBe(0);
    expect(await resetMailCount(inactive.id)).toBe(0);
    expect((await active(unverified.id)).length).toBe(0);
    expect((await active(inactive.id)).length).toBe(0);
  } finally {
    await app.close();
  }
});

test("missing delivery fails closed even for an existing code; failed renewal delivery rolls back without consuming it", async () => {
  const m = await member();
  await request(m.email);
  const first = await proof(m.id),
    original = await active(m.id);
  const noDelivery = createIdentity(unit, config, { accessEvents: ports.accessEvents }, time);
  const app = await createApp({ checkReadiness: async () => true, identity: noDelivery });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password-reset-requests",
      headers: await binding(app),
      payload: { email: m.email },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.retryable).toBe(true);
  } finally {
    await app.close();
  }
  unchanged(original, await active(m.id));
  const faulty = createIdentity(
    unit,
    config,
    {
      ...ports,
      delivery: {
        async enqueue(tx, payload) {
          await ports.delivery.enqueue(tx, payload);
          throw new Error("SYNTHETIC_RESET_DELIVERY_FAILURE");
        },
      },
    },
    time,
  );
  const output: string[] = [],
    log = vi
      .spyOn(console, "error")
      .mockImplementation((value: unknown) => output.push(String(value)));
  try {
    // A usable generation needs no delivery, including when the port is unhealthy.
    await request(m.email, faulty);
    instant += 600000;
    const key = newId(),
      scope = `synthetic-renewal:${newId()}`;
    await expect(safe(faulty.requestReset(scope, key, m.email))).rejects.toMatchObject({
      statusCode: 500,
    });
    unchanged(original, await active(m.id));
    expect(await resetMailCount(m.id)).toBe(1);
    const [results] = await safe(
      control.query<RowDataPacket[]>(
        "SELECT COUNT(*) AS n FROM identity_command_results WHERE command_key=?",
        [key],
      ),
    );
    expect(Number(results[0]?.n)).toBe(0);
    expect(
      output.every(
        (value) =>
          value === JSON.stringify({ event: "identity_operation_failed", category: "unexpected" }),
      ),
    ).toBe(true);
    await safe(owner().requestReset(scope, key, m.email));
    expect((await proof(m.id)).id !== first.id).toBe(true);
    expect(await resetMailCount(m.id)).toBe(2);
  } finally {
    log.mockRestore();
  }
});
