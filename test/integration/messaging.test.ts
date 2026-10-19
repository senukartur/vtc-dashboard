import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  createUnitOfWork,
  newId,
  runMigrations,
  TransactionCommitOutcomeUnknownError,
  type UnitOfWork,
} from "@vtc/db";
import { eq, mailCommands, mailDeliveries, sql } from "@vtc/db/messaging-schema";
import { durableJobs } from "@vtc/db/platform-schema";
import { company, membership, roles } from "@vtc/db/identity-schema";
import type { Connection, RowDataPacket } from "mysql2/promise";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import { createApp } from "../../apps/api/src/app.ts";
import type { Actor } from "../../apps/api/src/modules/identity/service.ts";
import { mailCrypto, type MailIntent } from "../../apps/api/src/modules/messaging/content.ts";
import {
  localProvider,
  type MailProvider,
  type Outcome,
} from "../../apps/api/src/modules/messaging/provider.ts";
import {
  createMessaging,
  cleanupMail,
  mailExpirySweep,
  type MailOwners,
  type Messaging,
  type MessagingConfig,
} from "../../apps/api/src/modules/messaging/service.ts";
import { createQueue, LeaseLostError } from "../../apps/api/src/platform/jobs/queue.ts";
import { composeIdentity } from "../../apps/api/src/use-cases/identity-messaging.ts";
import { guardedSettings, reset, testConnection } from "../persistence/support.ts";
import { safeIdentityFailure } from "../support/identity-diagnostics.ts";

let control: Connection, unit: UnitOfWork;
let instant = Date.now();
const now = () => new Date(instant);
const config: MessagingConfig = {
  mode: "local",
  key: randomBytes(32).toString("hex"),
  sender: "sender@example.invalid",
  origin: "http://127.0.0.1:4173",
  production: false,
};
const actor: Actor = {
  userId: newId(),
  sessionId: newId(),
  accessEpoch: 1,
  credentialEpoch: 1,
  capabilities: ["applications.manage"],
};
const required = <T>(value: T | null | undefined): T => {
  if (value == null) throw new Error("MAIL_FIXTURE_MISSING");
  return value;
};
async function safe<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof Error && error.name === "AssertionError") throw error;
    console.log(JSON.stringify({ event: "mail_fixture_failure", ...safeIdentityFailure(error) }));
    const statusCode =
      error && typeof error === "object" && "statusCode" in error ? error.statusCode : 500;
    throw Object.assign(new Error("MAIL_FIXTURE_OPERATION_FAILED"), { statusCode });
  }
}
const ownerValid: MailOwners["identityValid"] = async (tx, input) => {
  const [rows] = await unit
    .client(tx)
    .execute(
      sql`SELECT current_generation FROM synthetic_mail_owner WHERE id=${Buffer.from(input.id)}`,
    );
  return Number((rows as unknown as RowDataPacket[])[0]?.current_generation) === 1;
};
const owners: MailOwners = {
  identityValid: ownerValid,
  authorize: async (_tx, current, scope) => {
    if (current.accessEpoch !== 1) throw Object.assign(new Error("DENIED"), { statusCode: 401 });
    if (scope === "admissions" && !current.capabilities.includes("applications.manage"))
      throw Object.assign(new Error("DENIED"), { statusCode: 403 });
  },
  admissionsValid: (tx, input) =>
    ownerValid(tx, { id: input.generationId, userId: actor.userId, purpose: "email_verification" }),
};
const input = (changes: Partial<MailIntent> = {}): MailIntent => {
  const result: MailIntent = {
    owner: "identity",
    generationId: newId(),
    userId: actor.userId,
    kind: "password_change",
    locale: "ru",
    recipient: "fictional@example.invalid",
    code: "NONFUNCTIONAL_SYNTHETIC_CODE",
    expiresAt: new Date(instant + 600000).toISOString(),
    ...changes,
  };
  if (result.owner === "admissions") delete result.code;
  return result;
};
const service = (
  provider: MailProvider = localProvider(),
  selectedUnit = unit,
  selectedConfig = config,
) =>
  createMessaging(selectedUnit, { ...selectedConfig, mode: provider.mode }, provider, owners, now);
async function seed(mail: Messaging, intent = input()) {
  return unit.run(async (tx) => {
    await unit
      .client(tx)
      .execute(
        sql`INSERT INTO synthetic_mail_owner VALUES (${Buffer.from(intent.generationId)},1)`,
      );
    return mail.enqueue(tx, intent);
  });
}
const delivery = (id: string) =>
  unit.run(
    async (tx) =>
      (await unit.client(tx).select().from(mailDeliveries).where(eq(mailDeliveries.id, id)))[0],
  );
async function execute(mail: Messaging) {
  const claim = required(await mail.queue.claim());
  await mail.queue.execute(claim);
  return claim;
}
const rejected: Outcome = { state: "rejected", category: "authentication", retryAfterMs: null };
beforeAll(async () =>
  safe(async () => {
    control = await testConnection();
    await reset(control);
    await runMigrations(guardedSettings());
    await control.query(
      "CREATE TABLE synthetic_mail_owner (id BINARY(36) PRIMARY KEY,current_generation INT NOT NULL) ENGINE=InnoDB",
    );
    unit = createUnitOfWork(guardedSettings());
  }),
);
beforeEach(async () =>
  safe(async () => {
    instant = Date.now();
    for (const table of [
      "mail_commands",
      "mail_deliveries",
      "job_effect_receipts",
      "durable_jobs",
      "synthetic_mail_owner",
    ])
      await control.query(`DELETE FROM ${table}`);
  }),
);
afterAll(async () => {
  await unit?.close();
  await control?.end();
});
afterEach(async () =>
  safe(async () => {
    const [rows] = await control.query<RowDataPacket[]>(
      "SELECT COUNT(*) count FROM mail_deliveries WHERE (ciphertext IS NULL) <> (payload_expires_at IS NULL) OR payload_expires_at <> expires_at",
    );
    expect(Number(rows[0]?.count)).toBe(0);
  }),
);

test("domain/private intent/safe job commit and rollback atomically; concurrent identical replay retains one identity", async () =>
  safe(async () => {
    const mail = service(),
      intent = input();
    await expect(
      unit.run(async (tx) => {
        await unit
          .client(tx)
          .execute(
            sql`INSERT INTO synthetic_mail_owner VALUES (${Buffer.from(intent.generationId)},1)`,
          );
        await mail.enqueue(tx, intent);
        throw new Error("SYNTHETIC_ROLLBACK");
      }),
    ).rejects.toThrow("SYNTHETIC_ROLLBACK");
    expect(await delivery(intent.generationId)).toBeUndefined();
    const id = await seed(mail, intent);
    const ids = await Promise.all([1, 2].map(() => unit.run((tx) => mail.enqueue(tx, intent))));
    expect(ids).toEqual([id, id]);
    await expect(
      unit.run((tx) => mail.enqueue(tx, { ...intent, recipient: "changed@example.invalid" })),
    ).rejects.toMatchObject({ statusCode: 409 });
    const jobs = await unit.run((tx) => unit.client(tx).select().from(durableJobs));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.reference).toEqual({ deliveryId: id });
    const ciphertext = required(await delivery(id)).ciphertext ?? "";
    expect(ciphertext.includes(intent.recipient)).toBe(false);
    expect(ciphertext.includes(intent.code ?? "")).toBe(false);
  }));
test("fictional recipient follows encrypted/template/local worker path, preserves locale and purges accepted secrets", async () =>
  safe(async () => {
    const mail = service(),
      intent = input(),
      id = await seed(mail, intent);
    const payload = mailCrypto(config.key).open(id, required((await delivery(id))?.ciphertext));
    expect(payload.request.text).toContain("Одноразовый код");
    expect(payload.request.to).toEqual([intent.recipient]);
    await execute(mail);
    expect(await mail.inspect(actor, id)).toMatchObject({
      state: "simulated",
      attempts: 1,
      recovery: null,
    });
    expect((await delivery(id))?.ciphertext).toBeNull();
    expect((await delivery(id))?.payloadExpiresAt).toBeNull();
    expect(JSON.stringify(await mail.inspect(actor, id)).includes(intent.recipient)).toBe(false);
    await expect(
      mail.resend(actor, id, newId(), required(await delivery(id)).version),
    ).rejects.toMatchObject({ statusCode: 409 });
  }));

test("maximum technical rejection payload stores and renders without truncating escaped or four-byte text", async () =>
  safe(async () => {
    const mail = service();
    for (const reason of ["&".repeat(8000), "🚚".repeat(4000)]) {
      const id = await seed(
        mail,
        input({ owner: "admissions", kind: "rejection", userId: null, reason }),
      );
      const ciphertext = required((await delivery(id))?.ciphertext),
        decoded = mailCrypto(config.key).open(id, ciphertext);
      expect(decoded.intent.reason === reason).toBe(true);
      expect(decoded.request.text.includes(reason)).toBe(true);
      expect(ciphertext.length).toBeGreaterThan(65000);
      await execute(mail);
      expect((await delivery(id))?.state).toBe("simulated");
    }
  }));

test("provider credential changes cannot reuse a retry in another idempotency namespace", async () =>
  safe(async () => {
    let sends = 0;
    const provider: MailProvider = {
      mode: "resend",
      scope: "synthetic-original-credential",
      async send() {
        sends++;
        return { state: "rejected", category: "provider_unavailable", retryAfterMs: 60000 };
      },
    };
    const mail = service(provider),
      id = await seed(mail);
    await execute(mail);
    instant += 60001;
    await control.query("UPDATE durable_jobs SET available_at=UTC_TIMESTAMP(3)");
    const changed = service({ ...provider, scope: "synthetic-other-team-credential" });
    await execute(changed);
    expect(sends).toBe(1);
    expect((await delivery(id))?.category).toBe("provider_changed");
  }));
test("obsolete, expired and missing-owner work is suppressed without provider I/O; expiry cleanup cannot starve on null rows", async () =>
  safe(async () => {
    let sends = 0;
    const mail = service({
      mode: "local",
      scope: "local-v1",
      send: async () => {
        sends++;
        return { state: "simulated", receipt: "synthetic" };
      },
    });
    const obsolete = await seed(mail),
      expired = await seed(mail);
    await control.execute("UPDATE synthetic_mail_owner SET current_generation=0 WHERE id=?", [
      Buffer.from(obsolete),
    ]);
    instant += 600000;
    await execute(mail);
    await execute(mail);
    expect(sends).toBe(0);
    expect((await delivery(obsolete))?.state).toBe("suppressed");
    expect((await delivery(expired))?.ciphertext).toBeNull();
    const missingOwner = service(localProvider(), unit, config);
    await expect(
      unit.run((tx) =>
        missingOwner.enqueue(
          tx,
          input({
            owner: "admissions",
            userId: null,
            kind: "rejection",
            reason: "Synthetic reason",
          }),
        ),
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
  }));

test("disabled mail pauses existing jobs; configuration failures are observable and cannot bypass queue recovery", async () =>
  safe(async () => {
    const mail = service(),
      id = await seed(mail),
      paused = createQueue(unit, [], [], undefined, ["mail.deliver"]);
    expect(await paused.claim()).toBeNull();
    expect((await mail.inspect(actor, id)).state).toBe("queued");
    await execute(mail);
    expect((await delivery(id))?.state).toBe("simulated");
    const next = await seed(mail),
      missing = createQueue(unit),
      claim = required(await missing.claim());
    await missing.execute(claim);
    expect(await mail.inspect(actor, next)).toMatchObject({
      state: "failed",
      recovery: "worker_configuration",
    });
    await expect(
      mail.resend(actor, next, newId(), required(await delivery(next)).version),
    ).rejects.toMatchObject({ statusCode: 409 });
  }));

test("daily/monthly quota exhaustion never loops claims, and no manual retry crosses provider retention", async () =>
  safe(async () => {
    let sends = 0;
    for (const [category, retryAfterMs] of [
      ["daily_quota", 3600000],
      ["monthly_quota", null],
    ] as const) {
      const mail = service({
        mode: "resend",
        scope: "synthetic-credential-v1",
        async send() {
          sends++;
          return { state: "rejected", category, retryAfterMs };
        },
      });
      const intent =
        category === "monthly_quota"
          ? input({
              owner: "admissions",
              userId: null,
              kind: "invitation",
              link: `${config.origin}/invitation?token=NONFUNCTIONAL`,
              expiresAt: new Date(instant + 7 * 86400000).toISOString(),
            })
          : input();
      const id = await seed(mail, intent);
      await execute(mail);
      expect(await mail.queue.claim()).toBeNull();
      expect((await delivery(id))?.category).toBe(category);
      if (category === "daily_quota")
        await expect(
          mail.resend(actor, id, newId(), required(await delivery(id)).version),
        ).rejects.toMatchObject({ statusCode: 409 });
      else {
        instant += 24 * 3600000;
        await expect(
          mail.resend(actor, id, newId(), required(await delivery(id)).version),
        ).rejects.toMatchObject({ statusCode: 409 });
      }
    }
    expect(sends).toBe(2);
  }));
test("known rejection becomes failed job; authorized concurrent resend reopens exactly one original job then executes", async () =>
  safe(async () => {
    let succeed = false,
      calls = 0;
    const provider: MailProvider = {
      mode: "resend",
      scope: "synthetic-credential-v1",
      async send() {
        calls++;
        return succeed ? { state: "accepted", receipt: "synthetic-receipt" } : rejected;
      },
    };
    const mail = service(provider),
      id = await seed(mail);
    await execute(mail);
    const row = required(await delivery(id));
    expect(row.state).toBe("failed");
    expect((await mail.queue.inspect()).failures[0]?.failure).toBe("handler_failed");
    const commandKey = newId();
    const [beforeRetry] = await control.execute<RowDataPacket[]>(
      "SELECT available_at FROM durable_jobs WHERE effect_key=?",
      [Buffer.from(id)],
    );
    const results = await Promise.allSettled(
      [1, 2].map(() => mail.resend(actor, id, commandKey, row.version)),
    );
    // Synthetic owners do not serialize on identity's company lock. A conflicting
    // reservation can deadlock and the facade retries the whole safe transaction.
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    await expect(mail.resend(actor, id, commandKey, row.version + 1)).rejects.toMatchObject({
      statusCode: 409,
    });
    const [afterRetry] = await control.execute<RowDataPacket[]>(
      "SELECT available_at FROM durable_jobs WHERE effect_key=?",
      [Buffer.from(id)],
    );
    expect(afterRetry[0]?.available_at).toEqual(beforeRetry[0]?.available_at);
    await control.execute(
      "UPDATE durable_jobs SET available_at=UTC_TIMESTAMP(3) WHERE effect_key=?",
      [Buffer.from(id)],
    );
    succeed = true;
    await execute(mail);
    expect(calls).toBe(2);
    expect((await delivery(id))?.state).toBe("accepted");
    expect(
      (await mail.queue.inspect()).counts.map((row) => ({
        state: row.state,
        count: Number(row.count),
      })),
    ).toEqual([{ state: "completed", count: 1 }]);
  }));
test("safe retries use frozen request/key after recreation and configuration changes; quotas wait without spending claims", async () =>
  safe(async () => {
    const calls: { request: unknown; key: string }[] = [];
    const provider: MailProvider = {
      mode: "resend",
      scope: "synthetic-credential-v1",
      async send(request, key) {
        calls.push({ request, key });
        return calls.length === 1
          ? { state: "rejected", category: "rate_limit", retryAfterMs: 60000 }
          : { state: "accepted", receipt: "synthetic" };
      },
    };
    const mail = service(provider),
      id = await seed(mail);
    await execute(mail);
    expect((await delivery(id))?.state).toBe("retryable");
    expect(await mail.queue.claim()).toBeNull();
    await expect(
      mail.resend(actor, id, newId(), required(await delivery(id)).version),
    ).rejects.toMatchObject({ statusCode: 409 });
    instant += 60001;
    await control.query("UPDATE durable_jobs SET available_at=UTC_TIMESTAMP(3)");
    const recreated = service(provider, unit, { ...config, sender: "changed@example.invalid" });
    await execute(recreated);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(calls[1]);
    expect((await delivery(id))?.state).toBe("accepted");
  }));

test("resend checks the current authoritative queue after retry acknowledgement failure or lease loss", async () =>
  safe(async () => {
    for (const scenario of [
      "before_commit",
      "after_commit",
      "failed_write",
      "lost_lease",
    ] as const) {
      instant = Date.now();
      let calls = 0,
        transactions = 0;
      const requests: { request: unknown; key: string }[] = [];
      const provider: MailProvider = {
        mode: "resend",
        scope: "synthetic-credential-v1",
        async send(request, key) {
          requests.push({ request, key });
          calls++;
          if (calls > 1) return { state: "accepted", receipt: "synthetic" };
          if (scenario === "lost_lease")
            await control.query(
              "UPDATE durable_jobs SET lease_until=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND WHERE state='running'",
            );
          return { state: "rejected", category: "rate_limit", retryAfterMs: 60000 };
        },
      };
      const mail = service(provider),
        id = await seed(mail);
      const uncertainty = new TransactionCommitOutcomeUnknownError(
          new Error("SYNTHETIC_RETRY_ACK_LOSS"),
        ),
        failedWrite = new Error("SYNTHETIC_RETRY_WRITE_FAILURE");
      const faulty: UnitOfWork = {
        client: (tx) => unit.client(tx),
        close: async () => {},
        run: async (command) => {
          transactions++;
          if (transactions === 7 && scenario === "before_commit") throw uncertainty;
          if (transactions === 7 && scenario === "failed_write") throw failedWrite;
          const result = await unit.run(command);
          if (transactions === 7 && scenario === "after_commit") throw uncertainty;
          return result;
        },
      };
      const worker = service(provider, faulty),
        claim = required(await worker.queue.claim());
      if (scenario === "lost_lease")
        await expect(worker.queue.execute(claim)).rejects.toBeInstanceOf(LeaseLostError);
      else
        await expect(worker.queue.execute(claim)).rejects.toBe(
          scenario === "failed_write" ? failedWrite : uncertainty,
        );
      const row = required(await delivery(id));
      expect(row.state).toBe("retryable");
      instant += 60001;
      const key = newId();
      if (scenario === "after_commit") {
        // The retry really committed despite acknowledgement loss. The current
        // locking read may safely preserve that runnable job and its original due time.
        await control.execute("UPDATE durable_jobs SET available_at=UTC_TIMESTAMP(3) WHERE id=?", [
          Buffer.from(claim.id),
        ]);
        await mail.resend(actor, id, key, row.version);
        await execute(mail);
        expect(calls).toBe(2);
        expect(requests[1]).toEqual(requests[0]);
        expect((await delivery(id))?.state).toBe("accepted");
      } else {
        expect(await mail.inspect(actor, id)).toMatchObject({
          state: scenario === "lost_lease" ? "ambiguous" : "retryable",
        });
        await expect(mail.resend(actor, id, key, row.version)).rejects.toMatchObject({
          statusCode: 409,
        });
        await control.execute(
          "UPDATE durable_jobs SET lease_until=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND WHERE id=?",
          [Buffer.from(claim.id)],
        );
        expect(await mail.queue.claim()).toBeNull();
        expect(await mail.inspect(actor, id)).toMatchObject({
          state: "ambiguous",
          recovery: "acceptance_unknown",
        });
        await expect(mail.resend(actor, id, key, row.version)).rejects.toMatchObject({
          statusCode: 409,
        });
        expect((await delivery(id))?.version).toBe(row.version);
        expect((await delivery(id))?.state).toBe("retryable");
        expect(calls).toBe(1);
        const [commands] = await control.execute<RowDataPacket[]>(
          "SELECT COUNT(*) count FROM mail_commands WHERE actor_id=? AND command_key=?",
          [Buffer.from(actor.userId), Buffer.from(key)],
        );
        expect(Number(commands[0]?.count)).toBe(0);
      }
    }
  }));
test("unknown provider acceptance and abandoned claim never permit blind resend or another provider call", async () =>
  safe(async () => {
    let sends = 0;
    const mail = service({
        mode: "resend",
        scope: "synthetic-credential-v1",
        async send() {
          sends++;
          return { state: "ambiguous", category: "acceptance_unknown" };
        },
      }),
      id = await seed(mail);
    await execute(mail);
    expect((await delivery(id))?.state).toBe("ambiguous");
    await expect(
      mail.resend(actor, id, newId(), required(await delivery(id)).version),
    ).rejects.toMatchObject({ statusCode: 409 });
    const next = await seed(mail),
      claim = required(await mail.queue.claim());
    expect(claim.reference).toEqual({ deliveryId: next });
    await control.query(
      "UPDATE durable_jobs SET lease_until=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND WHERE state='running'",
    );
    expect(await mail.queue.claim()).toBeNull();
    expect(sends).toBe(1);
  }));
test("durable acceptance survives completion failure; an unknown first-attempt COMMIT never calls provider", async () =>
  safe(async () => {
    let sends = 0;
    const provider: MailProvider = {
      mode: "resend",
      scope: "synthetic-credential-v1",
      async send() {
        sends++;
        await control.query(
          "UPDATE durable_jobs SET lease_until=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND",
        );
        return { state: "accepted", receipt: "synthetic" };
      },
    };
    const mail = service(provider),
      id = await seed(mail),
      claim = required(await mail.queue.claim());
    await expect(mail.queue.execute(claim)).rejects.toBeInstanceOf(LeaseLostError);
    expect((await delivery(id))?.state).toBe("accepted");
    expect(sends).toBe(1);
    expect(await mail.queue.claim()).toBeNull();
    const second = await seed(mail);
    let transactions = 0;
    const uncertain = new TransactionCommitOutcomeUnknownError(new Error("SYNTHETIC_RECEIPT_LOSS"));
    const failing: UnitOfWork = {
      client: (tx) => unit.client(tx),
      close: async () => {},
      run: async (command) => {
        const result = await unit.run(command);
        if (++transactions === 5) throw uncertain;
        return result;
      },
    };
    const worker = service(provider, failing),
      nextClaim = required(await worker.queue.claim());
    // claim, execute fence, external fence, initial read, first-attempt marker
    expect(nextClaim.reference).toEqual({ deliveryId: second });
    await expect(worker.queue.execute(nextClaim)).rejects.toBe(uncertain);
    expect(sends).toBe(1);
  }));

test("acceptance with failed or uncertain receipt persistence never replays the external request", async () =>
  safe(async () => {
    for (const receiptCommitted of [false, true]) {
      let sends = 0,
        transactions = 0;
      const provider: MailProvider = {
        mode: "resend",
        scope: "synthetic-credential-v1",
        async send() {
          sends++;
          return { state: "accepted", receipt: "synthetic" };
        },
      };
      const mail = service(provider),
        id = await seed(mail);
      const failure = new TransactionCommitOutcomeUnknownError(new Error("SYNTHETIC_RECEIPT_LOSS"));
      const faulty: UnitOfWork = {
        client: (tx) => unit.client(tx),
        close: async () => {},
        run: async (command) => {
          transactions++;
          if (transactions === 6 && !receiptCommitted) throw failure;
          const result = await unit.run(command);
          if (transactions === 6 && receiptCommitted) throw failure;
          return result;
        },
      };
      const worker = service(provider, faulty),
        claim = required(await worker.queue.claim());
      await expect(worker.queue.execute(claim)).rejects.toBe(failure);
      expect(sends).toBe(1);
      expect((await delivery(id))?.state).toBe(receiptCommitted ? "accepted" : "attempting");
      await control.query(
        "UPDATE durable_jobs SET lease_until=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND WHERE state='running'",
      );
      expect(await mail.queue.claim()).toBeNull();
      await expect(
        mail.resend(actor, id, newId(), required(await delivery(id)).version),
      ).rejects.toMatchObject({ statusCode: 409 });
    }
  }));

test("delayed pre-fence COMMIT receipt consumes the lease budget before any provider start", async () =>
  safe(async () => {
    let sends = 0,
      transactions = 0;
    const provider: MailProvider = {
      mode: "resend",
      scope: "synthetic-credential-v1",
      async send() {
        sends++;
        return { state: "accepted", receipt: "synthetic" };
      },
    };
    const mail = service(provider),
      id = await seed(mail);
    const slow: UnitOfWork = {
      client: (tx) => unit.client(tx),
      close: async () => {},
      run: async (command) => {
        const result = await unit.run(command);
        if (++transactions === 3) await delay(3500);
        return result;
      },
    };
    const worker = service(provider, slow),
      claim = required(await worker.queue.claim());
    await worker.queue.execute(claim);
    expect(sends).toBe(0);
    expect(await mail.inspect(actor, id)).toMatchObject({
      state: "retryable",
      recovery: "not_started",
    });
    const before = required(await delivery(id));
    instant += 1001;
    await control.query("UPDATE durable_jobs SET available_at=UTC_TIMESTAMP(3)");
    await execute(mail);
    expect(sends).toBe(1);
    expect(await mail.inspect(actor, id)).toMatchObject({
      state: "accepted",
      attempts: 2,
      expiresAt: before.expiresAt,
    });
  }));

test("insufficient authoritative DB lease prevents external callback entry without provider I/O", async () =>
  safe(async () => {
    let sends = 0;
    const mail = service({
        mode: "resend",
        scope: "synthetic-credential-v1",
        async send() {
          sends++;
          return { state: "accepted", receipt: "synthetic" };
        },
      }),
      id = await seed(mail),
      claim = required(await mail.queue.claim());
    await control.execute(
      "UPDATE durable_jobs SET lease_until=UTC_TIMESTAMP(3)+INTERVAL 4 SECOND WHERE id=?",
      [Buffer.from(claim.id)],
    );
    await mail.queue.execute(claim);
    expect(sends).toBe(0);
    expect((await delivery(id))?.attempts).toBe(0);
    expect(await mail.inspect(actor, id)).toMatchObject({
      state: "queued",
      recovery: null,
    });
    await control.query("UPDATE durable_jobs SET available_at=UTC_TIMESTAMP(3)");
    await execute(mail);
    expect(sends).toBe(1);
    expect(await mail.inspect(actor, id)).toMatchObject({ state: "accepted", attempts: 1 });
  }));

test("abort before callback or provider invocation defers the same immutable delivery and recovers", async () =>
  safe(async () => {
    for (const beforeCallback of [true, false]) {
      instant = Date.now();
      const abort = new AbortController();
      let transactions = 0;
      const calls: { request: unknown; key: string }[] = [];
      const provider: MailProvider = {
        mode: "resend",
        scope: "synthetic-credential-v1",
        async send(request, key) {
          calls.push({ request, key });
          return { state: "accepted", receipt: "synthetic" };
        },
      };
      const mail = service(provider),
        id = await seed(mail),
        original = required(await delivery(id));
      const frozen = mailCrypto(config.key).open(id, required(original.ciphertext));
      const interrupted: UnitOfWork = {
        client: (tx) => unit.client(tx),
        close: async () => {},
        run: async (command) => {
          const result = await unit.run(command);
          if (++transactions === 5 && !beforeCallback) abort.abort();
          return result;
        },
      };
      const worker = service(provider, interrupted),
        claim = required(await worker.queue.claim());
      if (beforeCallback) abort.abort();
      await worker.queue.execute(claim, abort.signal);
      expect(calls).toHaveLength(0);
      expect((await delivery(id))?.ciphertext).toBe(original.ciphertext);
      instant += 1001;
      await control.query("UPDATE durable_jobs SET available_at=UTC_TIMESTAMP(3)");
      await execute(mail);
      expect(calls).toEqual([{ request: frozen.request, key: `messaging.mail:${id}` }]);
      expect((await delivery(id))?.expiresAt).toBe(original.expiresAt);
      expect((await delivery(id))?.state).toBe("accepted");
    }
  }));

test("known no-call retry stops at original expiry, provider window and attempt bounds", async () =>
  safe(async () => {
    for (const boundary of ["expiry", "window", "attempts"] as const) {
      instant = Date.now();
      let sends = 0,
        transactions = 0;
      const abort = new AbortController(),
        provider: MailProvider = {
          mode: "resend",
          scope: "synthetic-credential-v1",
          async send() {
            sends++;
            return { state: "accepted", receipt: "synthetic" };
          },
        };
      const mail = service(provider),
        id = await seed(mail);
      if (boundary === "attempts")
        await control.execute("UPDATE mail_deliveries SET attempts=4 WHERE id=?", [
          Buffer.from(id),
        ]);
      if (boundary === "window")
        await control.execute("UPDATE mail_deliveries SET first_attempt_at=? WHERE id=?", [
          new Date(instant - 23 * 3600000 + 500).toISOString().slice(0, 23).replace("T", " "),
          Buffer.from(id),
        ]);
      const interrupted: UnitOfWork = {
        client: (tx) => unit.client(tx),
        close: async () => {},
        run: async (command) => {
          const result = await unit.run(command);
          if (++transactions === 5) {
            if (boundary === "expiry") instant += 599500;
            abort.abort();
          }
          return result;
        },
      };
      const worker = service(provider, interrupted),
        claim = required(await worker.queue.claim());
      await worker.queue.execute(claim, abort.signal);
      expect(sends).toBe(0);
      expect((await delivery(id))?.state).toBe("failed");
      expect((await delivery(id))?.ciphertext).toBeNull();
      expect((await delivery(id))?.nextAttemptAt).toBeNull();
      expect(await mail.queue.claim()).toBeNull();
    }
  }));
test("corrupt ciphertext, wrong key and delivery substitution fail closed without provider I/O", async () =>
  safe(async () => {
    let sends = 0;
    const provider: MailProvider = {
      mode: "local",
      scope: "local-v1",
      async send() {
        sends++;
        return { state: "simulated", receipt: "synthetic" };
      },
    };
    const mail = service(provider),
      one = await seed(mail),
      original = required((await delivery(one))?.ciphertext);
    await control.execute("UPDATE mail_deliveries SET ciphertext=? WHERE id=?", [
      "corrupt",
      Buffer.from(one),
    ]);
    await execute(mail);
    const two = await seed(mail);
    await control.execute("UPDATE mail_deliveries SET ciphertext=? WHERE id=?", [
      original,
      Buffer.from(two),
    ]);
    await execute(mail);
    const three = await seed(mail);
    const wrongKey = service(provider, unit, { ...config, key: randomBytes(32).toString("hex") });
    await execute(wrongKey);
    expect(sends).toBe(0);
    expect((await delivery(one))?.state).toBe("failed");
    expect((await delivery(two))?.state).toBe("failed");
    expect((await delivery(three))?.state).toBe("failed");
  }));

test("representative delivery inspection and actor-command lookups use their exact selective indexes", async () =>
  safe(async () => {
    const mail = service(),
      id = await seed(mail),
      row = required(await delivery(id));
    await unit.run(async (tx) => {
      await unit
        .client(tx)
        .insert(mailDeliveries)
        .values(
          Array.from({ length: 300 }, () => ({
            ...row,
            id: newId(),
            generationId: newId(),
            userId: newId(),
            ciphertext: null,
            payloadExpiresAt: null,
            state: "accepted" as const,
          })),
        );
      await unit
        .client(tx)
        .execute(
          sql`INSERT INTO mail_commands (actor_id, command_key, delivery_id, expected_version, result_version, created_at) VALUES (${Buffer.from(actor.userId)}, ${Buffer.from(id)}, ${Buffer.from(id)}, 1, 2, UTC_TIMESTAMP(3))`,
        );
    });
    await control.query("ANALYZE TABLE mail_deliveries,mail_commands");
    for (const [shape, query, values, expected] of [
      [
        "delivery",
        "EXPLAIN SELECT * FROM mail_deliveries WHERE id=? FOR UPDATE",
        [Buffer.from(id)],
        "PRIMARY",
      ],
      [
        "resend",
        "EXPLAIN SELECT * FROM mail_commands WHERE actor_id=? AND command_key=? FOR UPDATE",
        [Buffer.from(actor.userId), Buffer.from(id)],
        "mail_command_actor_unique",
      ],
    ] as const) {
      const [rows] = await control.query<RowDataPacket[]>(query, [...values]);
      console.log(
        JSON.stringify({
          event: "mail_explain",
          shape,
          key: rows[0]?.key,
          access: rows[0]?.type,
          estimatedRows: rows[0]?.rows,
        }),
      );
      expect(rows[0]?.key).toBe(expected);
    }
  }));

test(
  "actual keyless cleanup uses bounded indexed eligibility through substantial cleared history and an empty eligible range",
  { timeout: 30000 },
  async () =>
    safe(async () => {
      const mail = service(),
        ids = await Promise.all([1, 2, 3].map(() => seed(mail))),
        template = required(await delivery(required(ids[0])));
      for (let offset = 0; offset < 5000; offset += 500)
        await unit.run((tx) =>
          unit
            .client(tx)
            .insert(mailDeliveries)
            .values(
              Array.from({ length: 500 }, () => ({
                ...template,
                id: newId(),
                generationId: newId(),
                ciphertext: null,
                payloadExpiresAt: null,
                state: "accepted" as const,
              })),
            ),
        );
      instant += 600001;
      await control.query("ANALYZE TABLE mail_deliveries");
      const reads = [
        "Handler_read_first",
        "Handler_read_key",
        "Handler_read_next",
        "Handler_read_prev",
        "Handler_read_rnd",
        "Handler_read_rnd_next",
      ];
      for (const eligibleRows of [3, 0]) {
        const query = await unit.run(async (tx) =>
          mailExpirySweep(unit, tx, now().toISOString()).toSQL(),
        );
        const [plan] = await control.query<RowDataPacket[]>(`EXPLAIN ${query.sql}`, query.params);
        let examinedReads = -1;
        const measured: UnitOfWork = {
          client: (tx) => unit.client(tx),
          close: async () => {},
          run: (command) =>
            unit.run(async (tx) => {
              const stats = async () => {
                const [rows] = await unit
                  .client(tx)
                  .execute(sql`SHOW SESSION STATUS LIKE 'Handler_read%'`);
                return Object.fromEntries(
                  (rows as unknown as RowDataPacket[]).map((row) => [
                    String(row.Variable_name),
                    Number(row.Value),
                  ]),
                );
              };
              const before = await stats(),
                result = await command(tx),
                after = await stats();
              examinedReads = reads.reduce(
                (total, key) => total + Number(after[key]) - Number(before[key]),
                0,
              );
              return result;
            }),
        };
        expect(await cleanupMail(measured, false, now)).toBe("completed");
        console.log(
          JSON.stringify({
            event: "mail_cleanup_work",
            shape: eligibleRows ? "eligible" : "empty",
            key: plan[0]?.key,
            access: plan[0]?.type,
            historyRows: 5000,
            eligibleRows,
            examinedReads,
          }),
        );
        expect(plan[0]?.key).toBe("mail_payload_expiry_idx");
        expect(plan[0]?.type).toBe("range");
        expect(examinedReads).toBeGreaterThanOrEqual(0);
        expect(examinedReads).toBeLessThanOrEqual(120);
        for (const id of ids) {
          expect((await delivery(id))?.ciphertext).toBeNull();
          expect((await delivery(id))?.payloadExpiresAt).toBeNull();
        }
      }
      const [retained] = await control.query<RowDataPacket[]>(
        "SELECT COUNT(*) count FROM mail_deliveries",
      );
      expect(Number(retained[0]?.count)).toBe(5003);
    }),
);

test("safe job reference and encrypted intent metadata cannot be substituted under another delivery key", async () =>
  safe(async () => {
    let sends = 0;
    const mail = service({
      mode: "local",
      scope: "local-v1",
      async send() {
        sends++;
        return { state: "simulated", receipt: "synthetic" };
      },
    });
    const one = await seed(mail),
      two = await seed(mail);
    await control.execute(
      "UPDATE durable_jobs SET available_at=UTC_TIMESTAMP(3)+INTERVAL 1 DAY WHERE effect_key=?",
      [Buffer.from(two)],
    );
    await control.execute("UPDATE durable_jobs SET reference=? WHERE effect_key=?", [
      JSON.stringify({ deliveryId: two }),
      Buffer.from(one),
    ]);
    await execute(mail);
    expect(sends).toBe(0);
    expect(await mail.inspect(actor, one)).toMatchObject({
      state: "failed",
      recovery: "worker_configuration",
    });
    await control.execute("UPDATE mail_deliveries SET locale='en' WHERE id=?", [Buffer.from(two)]);
    await control.execute(
      "UPDATE durable_jobs SET available_at=UTC_TIMESTAMP(3) WHERE effect_key=?",
      [Buffer.from(two)],
    );
    await execute(mail);
    expect(sends).toBe(0);
    expect((await delivery(two))?.state).toBe("failed");
  }));
test("security status is owner-only; admissions needs current capability; expired ephemeral material and commands are purged", async () =>
  safe(async () => {
    const mail = service(),
      id = await seed(mail);
    await expect(mail.inspect({ ...actor, userId: newId() }, id)).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(mail.inspect({ ...actor, accessEpoch: 2 }, id)).rejects.toMatchObject({
      statusCode: 401,
    });
    const admission = input({
        owner: "admissions",
        userId: null,
        kind: "rejection",
        reason: "Synthetic private reason",
      }),
      admissionId = await seed(mail, admission);
    await expect(mail.inspect({ ...actor, capabilities: [] }, admissionId)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect((await mail.inspect(actor, admissionId)).kind).toBe("rejection");
    const row = required(await delivery(id));
    await unit.run(async (tx) => {
      await unit
        .client(tx)
        .insert(mailDeliveries)
        .values(
          Array.from({ length: 101 }, () => ({ ...row, id: newId(), generationId: newId() })),
        );
      await unit
        .client(tx)
        .insert(mailCommands)
        .values({
          actorId: actor.userId,
          key: newId(),
          deliveryId: id,
          expectedVersion: 1,
          resultVersion: 2,
          createdAt: new Date(instant - 86400001).toISOString(),
        });
    });
    instant += 600001;
    // Pausing claims does not require the provider or decryption key for cleanup.
    expect(await createQueue(unit, [], [], undefined, ["mail.deliver"]).claim()).toBeNull();
    expect(await cleanupMail(unit, false, now)).toBe("completed");
    expect(await cleanupMail(unit, false, now)).toBe("completed");
    expect((await delivery(id))?.ciphertext).toBeNull();
    expect((await delivery(admissionId))?.ciphertext).toBeNull();
    const [remaining] = await control.query<RowDataPacket[]>(
      "SELECT (SELECT COUNT(*) FROM mail_deliveries WHERE ciphertext IS NOT NULL) payloads, (SELECT COUNT(*) FROM mail_commands) commands, (SELECT COUNT(*) FROM mail_deliveries) retained",
    );
    expect(Number(remaining[0]?.payloads)).toBe(0);
    expect(Number(remaining[0]?.commands)).toBe(0);
    expect(Number(remaining[0]?.retained)).toBe(103);
  }));
test(
  "real identity binding, locale, replacement, epoch and protected director APIs govern delivery",
  { timeout: 30000 },
  async () =>
    safe(async () => {
      const identityConfig = {
        secret: randomBytes(32).toString("hex"),
        origin: config.origin,
        production: false,
      };
      const { identity, messaging } = composeIdentity(unit, identityConfig, config);
      const mail = required(messaging);
      const password = "Synthetic-messaging-passphrase-42";
      await identity.bootstrap({
        email: "director-mail@example.invalid",
        name: "Synthetic Director",
        password,
      });
      const login = await identity.login("director-mail@example.invalid", password);
      const cookie = login.cookies.map((value) => value.split(";")[0]).join("; ");
      const director = await identity.authenticate(new Headers({ cookie }));
      await unit.run((tx) =>
        unit
          .client(tx)
          .update(membership)
          .set({ locale: "ru" })
          .where(eq(membership.userId, director.userId)),
      );
      const first = await identity.requestChallenge(director, newId(), "email_verification");
      const firstId = String(first.id);
      expect((await delivery(firstId))?.locale).toBe("ru");
      const second = await identity.requestChallenge(director, newId(), "email_verification");
      expect((await delivery(firstId))?.ciphertext).toBeNull();
      expect((await delivery(firstId))?.state).toBe("suppressed");
      const secondId = String(second.id),
        payload = mailCrypto(config.key).open(
          secondId,
          required((await delivery(secondId))?.ciphertext),
        );
      await identity.confirmChallenge(director, newId(), {
        purpose: "email_verification",
        challengeId: secondId,
        code: required(payload.intent.code),
      });
      expect((await delivery(secondId))?.ciphertext).toBeNull();
      const pending = await identity.requestChallenge(director, newId(), "password_change"),
        pendingId = String(pending.id);
      await unit.run((tx) =>
        unit
          .client(tx)
          .update(membership)
          .set({ credentialEpoch: 2 })
          .where(eq(membership.userId, director.userId)),
      );
      expect(
        await unit.run((tx) =>
          identity.deliveryValid(tx, {
            id: pendingId,
            userId: director.userId,
            purpose: "password_change",
          }),
        ),
      ).toBe(false);
      await unit.run((tx) =>
        unit
          .client(tx)
          .update(membership)
          .set({ credentialEpoch: 1 })
          .where(eq(membership.userId, director.userId)),
      );
      const deputyId = newId(),
        successorId = newId(),
        credential = await identity.prepareCredential(password);
      for (const [userId, email, assigned] of [
        [deputyId, "deputy-mail@example.invalid", ["deputy_director"]],
        [successorId, "successor-mail@example.invalid", ["driver"]],
      ] as const) {
        await unit.run((tx) =>
          identity.insertWithCredential(tx, {
            userId,
            email,
            name: "Synthetic Member",
            ...credential,
            roles: assigned,
          }),
        );
      }
      const deputyLogin = await identity.login("deputy-mail@example.invalid", password),
        deputyCookie = deputyLogin.cookies.map((value) => value.split(";")[0]).join("; "),
        deputy = await identity.authenticate(new Headers({ cookie: deputyCookie }));
      await expect(mail.inspect(deputy, pendingId)).rejects.toMatchObject({ statusCode: 404 });
      await expect(mail.resend(deputy, pendingId, newId(), 1)).rejects.toMatchObject({
        statusCode: 404,
      });
      const succession = await identity.requestSuccession(director, successorId, newId()),
        successionId = String(succession.id);
      const validSuccession = () =>
        unit.run((tx) =>
          identity.deliveryValid(tx, {
            id: successionId,
            userId: director.userId,
            purpose: "succession",
          }),
        );
      expect(await validSuccession()).toBe(true);
      await unit.run((tx) =>
        unit
          .client(tx)
          .update(membership)
          .set({ status: "inactive" })
          .where(eq(membership.userId, successorId)),
      );
      expect(await validSuccession()).toBe(false);
      await unit.run((tx) =>
        unit
          .client(tx)
          .update(membership)
          .set({ status: "active" })
          .where(eq(membership.userId, successorId)),
      );
      await unit.run((tx) =>
        unit
          .client(tx)
          .update(company)
          .set({ directorUserId: deputyId })
          .where(eq(company.singleton, 1)),
      );
      expect(await validSuccession()).toBe(false);
      await unit.run((tx) =>
        unit
          .client(tx)
          .update(company)
          .set({ directorUserId: director.userId })
          .where(eq(company.singleton, 1)),
      );
      const realAdmissions = createMessaging(unit, config, localProvider(), {
        identityValid: (tx, request) => identity.deliveryValid(tx, request),
        authorize: async (tx, current, scope) => {
          await identity.authorizeInTransaction(
            tx,
            current,
            scope === "admissions" ? "applications.manage" : "company.read",
          );
        },
        admissionsValid: async () => true,
      });
      const admission = input({
          owner: "admissions",
          userId: null,
          kind: "rejection",
          reason: "Synthetic reason",
        }),
        admissionId = await unit.run((tx) => realAdmissions.enqueue(tx, admission));
      expect((await realAdmissions.inspect(deputy, admissionId)).kind).toBe("rejection");
      await unit.run((tx) => unit.client(tx).delete(roles).where(eq(roles.userId, deputyId)));
      await expect(realAdmissions.inspect(deputy, admissionId)).rejects.toMatchObject({
        statusCode: 404,
      });
      await unit.run((tx) =>
        unit
          .client(tx)
          .update(membership)
          .set({ accessEpoch: 2 })
          .where(eq(membership.userId, deputyId)),
      );
      await expect(mail.inspect(deputy, pendingId)).rejects.toMatchObject({ statusCode: 401 });
      const app = await createApp({ checkReadiness: async () => true, identity, messaging: mail });
      try {
        const status = await app.inject({
          url: `/api/v1/mail-deliveries/${pendingId}`,
          headers: { cookie },
        });
        expect(status.statusCode).toBe(200);
        expect(status.headers["cache-control"]).toBe("no-store");
        const csrf = await app.inject({ url: "/api/v1/auth/csrf", headers: { cookie } });
        const headers = {
          cookie,
          origin: config.origin,
          "x-csrf-token": csrf.json().data.token as string,
          "idempotency-key": newId(),
          "if-match": '"v1"',
        };
        expect(
          (
            await app.inject({
              method: "POST",
              url: `/api/v1/mail-deliveries/${pendingId}/resends`,
              headers: { ...headers, origin: "https://foreign.example.invalid" },
            })
          ).statusCode,
        ).toBe(403);
        expect(
          (
            await app.inject({
              method: "POST",
              url: `/api/v1/mail-deliveries/${pendingId}/resends`,
              headers,
              payload: { recipient: "changed@example.invalid" },
            })
          ).statusCode,
        ).toBe(422);
        expect(
          (
            await app.inject({
              method: "POST",
              url: `/api/v1/mail-deliveries/${pendingId}/resends`,
              headers,
            })
          ).statusCode,
        ).toBe(409);
      } finally {
        await app.close();
      }
    }),
);
