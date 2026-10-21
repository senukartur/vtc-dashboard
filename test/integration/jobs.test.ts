import { spawn } from "node:child_process";
import {
  createAudit,
  createUnitOfWork,
  newId,
  runMigrations,
  TransactionCommitOutcomeUnknownError,
  type TxContext,
  type UnitOfWork,
} from "@vtc/db";
import {
  durableJobs,
  effectReceipts,
  eq,
  outboxEvents,
  runnerLeases,
  sql,
} from "@vtc/db/platform-schema";
import type { Connection, RowDataPacket } from "mysql2/promise";
import {
  beforeEach,
  expect,
  test,
  afterAll as vitestAfterAll,
  beforeAll as vitestBeforeAll,
} from "vitest";
import {
  createAcceptanceQueue,
  fixtureJob,
  fixtureReference,
} from "../../apps/api/src/platform/jobs/acceptance.ts";
import {
  createQueue,
  type Handler,
  LeaseLostError,
  retryTransaction,
} from "../../apps/api/src/platform/jobs/queue.ts";
import { runPass } from "../../apps/api/src/platform/jobs/runner.ts";
import { type AccessEvent, createOutbox } from "../../apps/api/src/platform/outbox/events.ts";
import {
  guardedSettings,
  hasCode,
  reset,
  SCHEMA_SETUP_TIMEOUT_MS,
  testConnection,
} from "../persistence/support.ts";
import { barrier, bounded, deferred, until } from "../support/concurrency.ts";
import { safeIdentityFailure } from "../support/identity-diagnostics.ts";
import { schemaLifecycleHooks } from "../support/schema-lifecycle.ts";

const { beforeAll, afterAll } = schemaLifecycleHooks(vitestBeforeAll, vitestAfterAll);

let control: Connection;
let unit: ReturnType<typeof createUnitOfWork>;
const runId = newId();
function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("FIXTURE_VALUE_MISSING");
  return value;
}
const event = (): AccessEvent => ({
  eventId: newId(),
  type: "member.access_changed",
  schemaVersion: 1,
  aggregate: { kind: "member", id: newId(), version: 1 },
  occurredAt: "2026-01-31T23:59:59.999Z",
  correlationId: newId(),
  causationId: null,
  data: { userId: "", accessEpoch: 1, identityEpoch: 1 },
});
function envelope() {
  const e = event();
  e.data.userId = e.aggregate.id;
  return e;
}
async function safe<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (e) {
    console.log(JSON.stringify({ event: "jobs_fixture_failure", ...safeIdentityFailure(e) }));
    if (e instanceof Error && !safeIdentityFailure(e).codes.length) throw e;
    throw new Error("JOBS_FIXTURE_OPERATION_FAILED");
  }
}
const job = (sequence: number, stage = 1) => fixtureJob({ runId, sequence, stage });
async function cleanup() {
  await control.query("DELETE FROM job_effect_receipts");
  await control.query("DELETE FROM durable_jobs");
  await control.query("DELETE FROM outbox_events");
  await control.query("DELETE FROM job_runner_leases");
  await control.query("DELETE FROM synthetic_job_counter");
}
beforeAll(
  async () =>
    safe(async () => {
      control = await testConnection();
      await reset(control);
      await runMigrations(guardedSettings());
      await control.query(
        "CREATE TABLE synthetic_job_counter (run_id BINARY(36) NOT NULL, sequence INT NOT NULL, stage INT NOT NULL, touches INT NOT NULL, PRIMARY KEY(run_id,sequence,stage)) ENGINE=InnoDB",
      );
      unit = createUnitOfWork(guardedSettings());
    }),
  SCHEMA_SETUP_TIMEOUT_MS,
);
afterAll(async () => {
  await unit?.close();
  await control?.end();
});
beforeEach(async () => safe(cleanup));

test("domain/audit/event/job commit and rollback together; foreign/completed contexts reject", async () =>
  safe(async () => {
    const outbox = createOutbox(unit),
      queue = createAcceptanceQueue(unit),
      e = envelope();
    const audit = createAudit(unit);
    let completed: TxContext | undefined;
    await expect(
      unit.run(async (tx) => {
        await unit
          .client(tx)
          .execute(
            sql`INSERT INTO synthetic_job_counter VALUES (${Buffer.from(runId)}, 100, 1, 1)`,
          );
        await audit.append(tx, {
          actorKind: "system",
          actorId: null,
          operation: "membership.changed",
          subjectKind: "user",
          subjectId: e.aggregate.id,
          occurredAt: e.occurredAt,
          reason: "operator_request",
        });
        await outbox.append(tx, e);
        await queue.enqueue(tx, job(100));
        throw new Error("ROLLBACK_EXPECTED");
      }),
    ).rejects.toThrow("ROLLBACK_EXPECTED");
    const [c] = await control.query<RowDataPacket[]>(
      "SELECT (SELECT COUNT(*) FROM audit_entries) audit, (SELECT COUNT(*) FROM outbox_events) events, (SELECT COUNT(*) FROM durable_jobs) jobs, (SELECT COUNT(*) FROM synthetic_job_counter) effects",
    );
    expect(
      Object.fromEntries(Object.entries(c[0] ?? {}).map(([key, value]) => [key, Number(value)])),
    ).toMatchObject({ audit: 0, events: 0, jobs: 0, effects: 0 });
    await unit.run(async (tx) => {
      completed = tx;
      await outbox.append(tx, e);
      await queue.enqueue(tx, job(100));
    });
    await expect(outbox.append(required(completed), e)).rejects.toThrow("INACTIVE_OR_FOREIGN");
    await expect(queue.enqueue({} as TxContext, job(101))).rejects.toThrow("INACTIVE_OR_FOREIGN");
    await cleanup();
  }));

test("concurrent exact event/effect replay is idempotent; conflicting identity never overwrites", async () =>
  safe(async () => {
    const e = envelope(),
      outbox = createOutbox(unit),
      queue = createAcceptanceQueue(unit);
    await Promise.all([1, 2].map(() => unit.run((tx) => outbox.append(tx, e))));
    const ids = await Promise.all([1, 2].map(() => unit.run((tx) => queue.enqueue(tx, job(1)))));
    expect(ids[0]).toBe(ids[1]);
    await expect(
      unit.run((tx) => outbox.append(tx, { ...e, aggregate: { ...e.aggregate, version: 2 } })),
    ).rejects.toThrow("EVENT_IDENTITY_CONFLICT");
    await expect(
      unit.run((tx) => queue.enqueue(tx, { ...job(1), maxAttempts: 2 })),
    ).rejects.toThrow("JOB_IDENTITY_CONFLICT");
    expect(await unit.run((tx) => unit.client(tx).select().from(outboxEvents))).toHaveLength(1);
    await cleanup();
  }));

test("routing catches a late committed event without timestamp watermark and never binds an absent consumer", async () =>
  safe(async () => {
    const e = envelope(),
      outbox = createOutbox(unit),
      started = deferred<void>(),
      release = deferred<void>();
    const producer = unit.run(async (tx) => {
      await outbox.append(tx, e);
      started.resolve();
      await bounded(release.promise, "late-producer");
    });
    await bounded(started.promise, "late-event");
    const h: Handler = {
      kind: "acceptance.access",
      version: 1,
      consumer: "acceptance.access",
      mode: "local",
      validate: fixtureReference,
      local: async () => {},
    };
    const consumer = createQueue(
      unit,
      [h],
      [
        {
          kind: h.kind,
          consumer: h.consumer,
          eventType: e.type,
          reference: () => ({ runId, sequence: 1, stage: 1 }),
        },
      ],
    );
    try {
      expect(await consumer.route()).toBe(0);
    } finally {
      release.resolve();
      await producer;
    }
    expect(await createQueue(unit).route()).toBe(0);
    expect((await createQueue(unit).inspect()).retainedEvents).toBe(1);
    expect(await consumer.route()).toBe(1);
    expect(await consumer.route()).toBe(0);
    await cleanup();
  }));

test("two consumers skip held rows and persist claims across independent connection restart", async () =>
  safe(async () => {
    const queue = createAcceptanceQueue(unit);
    const ordered = [
      await unit.run((tx) => queue.enqueue(tx, job(1))),
      await unit.run((tx) => queue.enqueue(tx, job(2))),
    ].sort();
    const first = required(ordered[0]),
      second = required(ordered[1]);
    const held = deferred<void>(),
      release = deferred<void>();
    const holding = unit.run(async (tx) => {
      await unit
        .client(tx)
        .select()
        .from(durableJobs)
        .where(eq(durableJobs.id, first))
        .for("update");
      held.resolve();
      await bounded(release.promise, "skip-held");
    });
    await bounded(held.promise, "held-job");
    let claimed: Awaited<ReturnType<typeof queue.claim>>;
    try {
      claimed = await queue.claim();
      expect(claimed?.id).toBe(second);
    } finally {
      release.resolve();
      await holding;
    }
    const other = createUnitOfWork(guardedSettings());
    try {
      const next = await createAcceptanceQueue(other).claim();
      expect(next?.id).toBe(first);
      expect(next?.leaseToken).not.toBe(claimed?.leaseToken);
    } finally {
      await other.close();
    }
    const state = await unit.run((tx) => unit.client(tx).select().from(durableJobs));
    expect(state.filter((r) => r.state === "running")).toHaveLength(2);
    await cleanup();
  }));

test("expiry/reclaim fences stale business effect, completion/failure/renewal; final abandoned attempt exhausts", async () =>
  safe(async () => {
    const queue = createAcceptanceQueue(unit);
    await unit.run((tx) => queue.enqueue(tx, { ...job(1), maxAttempts: 2 }));
    const stale = required(await queue.claim());
    await control.query("UPDATE durable_jobs SET lease_until=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND");
    const fresh = required(await queue.claim());
    expect(fresh.attempts).toBe(2);
    await expect(queue.execute(stale)).rejects.toBeInstanceOf(LeaseLostError);
    await expect(queue.fail(stale, "retryable")).rejects.toBeInstanceOf(LeaseLostError);
    await expect(queue.renew(stale)).rejects.toBeInstanceOf(LeaseLostError);
    await control.query("UPDATE durable_jobs SET lease_until=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND");
    expect(await queue.claim()).toBeNull();
    expect((await queue.inspect()).failures[0]?.failure).toBe("exhausted");
    const [rows] = await control.query<RowDataPacket[]>(
      "SELECT COUNT(*) count FROM synthetic_job_counter",
    );
    expect(Number(rows[0]?.count)).toBe(0);
    await cleanup();
  }));

test("effect failure rolls back receipt/counter/chained enqueue; committed response replay has one effect", async () =>
  safe(async () => {
    let queue: ReturnType<typeof createQueue>;
    queue = createQueue(unit, [
      {
        kind: "acceptance.counter",
        version: 1,
        consumer: "acceptance.counter",
        mode: "local",
        validate: fixtureReference,
        local: async (tx, input, claim) => {
          const r = fixtureReference(input);
          await unit
            .client(tx)
            .execute(
              sql`INSERT INTO synthetic_job_counter VALUES (${Buffer.from(runId)}, ${r.sequence}, ${r.stage}, 1)`,
            );
          await queue.enqueue(tx, job(r.sequence, 2));
          if (claim.attempts === 1) throw new Error("EFFECT_ROLLBACK");
        },
      },
    ]);
    await unit.run((tx) => queue.enqueue(tx, job(1)));
    const claim = required(await queue.claim());
    await queue.execute(claim);
    expect(await unit.run((tx) => unit.client(tx).select().from(effectReceipts))).toHaveLength(0);
    const [rows] = await control.query<RowDataPacket[]>(
      "SELECT COUNT(*) count FROM synthetic_job_counter",
    );
    expect(Number(rows[0]?.count)).toBe(0);
    expect(await unit.run((tx) => unit.client(tx).select().from(durableJobs))).toHaveLength(1);
    await cleanup();
    const normal = createAcceptanceQueue(unit);
    await unit.run((tx) => normal.enqueue(tx, job(1)));
    const committed = required(await normal.claim());
    await normal.execute(committed);
    expect(await normal.receipt("acceptance.counter", job(1).effectKey)).toEqual({
      jobId: committed.id,
    });
    await expect(normal.execute(committed)).rejects.toBeInstanceOf(LeaseLostError);
    expect(await unit.run((tx) => unit.client(tx).select().from(effectReceipts))).toHaveLength(1);
    await cleanup();
  }));

test("due scheduling, retry delay and exhaustion are bounded; stored missing/version handlers fail visibly", async () =>
  safe(async () => {
    const queue = createAcceptanceQueue(unit);
    await unit.run((tx) =>
      queue.enqueue(tx, { ...job(1), availableAt: "9999-01-01T00:00:00.000Z" }),
    );
    expect(await queue.claim()).toBeNull();
    await cleanup();
    await unit.run((tx) => queue.enqueue(tx, { ...job(2), maxAttempts: 1 }));
    await queue.execute(required(await queue.claim()));
    expect((await queue.inspect()).failures[0]?.failure).toBe("exhausted");
    await cleanup();
    await unit.run((tx) => queue.enqueue(tx, job(2)));
    await queue.execute(required(await queue.claim()));
    expect(await queue.claim()).toBeNull();
    await control.query("UPDATE durable_jobs SET available_at=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND");
    const retry = required(await queue.claim());
    expect(retry.attempts).toBe(2);
    await queue.execute(retry);
    await cleanup();
    await unit.run((tx) => queue.enqueue(tx, job(1)));
    await createQueue(unit).execute(required(await queue.claim()));
    expect((await queue.inspect()).failures[0]?.failure).toBe("missing_handler");
    await cleanup();
    await unit.run((tx) => queue.enqueue(tx, job(1)));
    await control.query("UPDATE durable_jobs SET schema_version=99");
    await queue.execute(required(await queue.claim()));
    expect((await queue.inspect()).failures[0]?.failure).toBe("invalid_input");
    await cleanup();
  }));

test("runner overlap, token loss/restart and chained work use durable fences and leave a visible remainder", async () =>
  safe(async () => {
    const queue = createAcceptanceQueue(unit);
    const token = required(await queue.acquireRunner());
    expect(await queue.acquireRunner()).toBeNull();
    expect((await runPass(queue, new AbortController().signal)).status).toBe("overlap");
    await control.query(
      "UPDATE job_runner_leases SET lease_until=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND",
    );
    const next = required(await queue.acquireRunner());
    expect(next).not.toBe(token);
    await expect(queue.claim(token)).rejects.toBeInstanceOf(LeaseLostError);
    await expect(queue.renewRunner(token)).rejects.toBeInstanceOf(LeaseLostError);
    await queue.releaseRunner(token);
    expect(await unit.run((tx) => unit.client(tx).select().from(runnerLeases))).toHaveLength(1);
    await queue.releaseRunner(next);
    await unit.run((tx) => queue.enqueue(tx, job(1)));
    expect((await runPass(queue, new AbortController().signal)).processed).toBe(2);
    expect(await unit.run((tx) => unit.client(tx).select().from(effectReceipts))).toHaveLength(2);
    await cleanup();
  }));

test("external expired claim is ambiguous and never blindly repeats the provider callback", async () =>
  safe(async () => {
    let calls = 0;
    const queue = createQueue(unit, [
      {
        kind: "acceptance.counter",
        consumer: "acceptance.counter",
        version: 1,
        mode: "external",
        validate: fixtureReference,
        external: async () => {
          calls++;
        },
      },
    ]);
    await unit.run((tx) => queue.enqueue(tx, job(1)));
    await queue.claim();
    await control.query("UPDATE durable_jobs SET lease_until=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND");
    expect(await queue.claim()).toBeNull();
    expect(calls).toBe(0);
    expect((await queue.inspect()).failures[0]?.failure).toBe("external_ambiguity");
    await cleanup();
  }));

test("actual MySQL deadlock and lockwait roll back before bounded whole-transaction retry", async () =>
  safe(async () => {
    const rowA = newId(),
      rowB = newId();
    await control.execute("INSERT INTO synthetic_job_counter VALUES (?,1,1,0), (?,1,1,0)", [
      Buffer.from(rowA),
      Buffer.from(rowB),
    ]);
    const meet = barrier(2),
      attempts = [0, 0];
    await Promise.all(
      [0, 1].map((index) =>
        retryTransaction(unit, async (tx) => {
          attempts[index] = (attempts[index] ?? 0) + 1;
          const a = index === 0 ? rowA : rowB,
            b = index === 0 ? rowB : rowA;
          await unit
            .client(tx)
            .execute(
              sql`UPDATE synthetic_job_counter SET touches=touches+1 WHERE run_id=${Buffer.from(a)}`,
            );
          if (attempts[index] === 1) await meet();
          await unit
            .client(tx)
            .execute(
              sql`UPDATE synthetic_job_counter SET touches=touches+1 WHERE run_id=${Buffer.from(b)}`,
            );
        }),
      ),
    );
    expect(attempts.sort()).toEqual([1, 2]);
    const lock = deferred<void>(),
      release = deferred<void>();
    const held = unit.run(async (tx) => {
      await unit
        .client(tx)
        .execute(
          sql`UPDATE synthetic_job_counter SET touches=touches WHERE run_id=${Buffer.from(rowA)}`,
        );
      lock.resolve();
      await bounded(release.promise, "lockwait-release", 8000);
    });
    await bounded(lock.promise, "lockwait-held");
    let retries = 0;
    try {
      await expect(
        retryTransaction(unit, async (tx) => {
          retries++;
          await unit.client(tx).execute(sql`SET SESSION innodb_lock_wait_timeout=1`);
          await unit
            .client(tx)
            .execute(
              sql`UPDATE synthetic_job_counter SET touches=touches+1 WHERE run_id=${Buffer.from(rowB)}`,
            );
          await unit
            .client(tx)
            .execute(
              sql`UPDATE synthetic_job_counter SET touches=touches+1 WHERE run_id=${Buffer.from(rowA)}`,
            );
        }),
      ).rejects.toSatisfy(hasCode("ER_LOCK_WAIT_TIMEOUT"));
    } finally {
      release.resolve();
      await held;
    }
    expect(retries).toBe(3);
    const [rows] = await control.query<RowDataPacket[]>(
      "SELECT touches FROM synthetic_job_counter ORDER BY run_id",
    );
    expect(rows.map((r) => r.touches)).toEqual([2, 2]);
    await cleanup();
  }));

test("exhausted local transaction retries use durable backoff, recover once and respect final attempt exhaustion", async () =>
  safe(async () => {
    let calls = 0;
    const queue = createQueue(unit, [
      {
        kind: "acceptance.counter",
        consumer: "acceptance.counter",
        version: 1,
        mode: "local",
        validate: fixtureReference,
        local: async (tx, input) => {
          calls++;
          const reference = fixtureReference(input);
          await unit.client(tx).execute(sql`SET SESSION innodb_lock_wait_timeout=1`);
          await unit
            .client(tx)
            .execute(
              sql`INSERT INTO synthetic_job_counter VALUES (${Buffer.from(runId)}, ${reference.sequence}, 1, 1)`,
            );
          await unit
            .client(tx)
            .execute(
              sql`UPDATE synthetic_job_counter SET touches=touches+1 WHERE run_id=${Buffer.from(runId)} AND sequence=999`,
            );
        },
      },
    ]);
    await control.execute("INSERT INTO synthetic_job_counter VALUES (?,999,1,0)", [
      Buffer.from(runId),
    ]);
    async function blockEffect(sequence: number, maxAttempts: number) {
      await unit.run((tx) => queue.enqueue(tx, { ...job(sequence), maxAttempts }));
      const claim = required(await queue.claim());
      await control.beginTransaction();
      try {
        await control.execute(
          "SELECT * FROM synthetic_job_counter WHERE run_id=? AND sequence=999 FOR UPDATE",
          [Buffer.from(runId)],
        );
        await queue.execute(claim);
      } finally {
        await control.commit();
      }
      return claim;
    }
    const first = await blockEffect(1, 2);
    expect(calls).toBe(3);
    const [rows] = await control.query<RowDataPacket[]>(
      "SELECT state,failure,attempts,lease_token,lease_until,TIMESTAMPDIFF(MICROSECOND,UTC_TIMESTAMP(3),available_at) remaining FROM durable_jobs",
    );
    expect(rows[0]).toMatchObject({
      state: "ready",
      failure: "retryable",
      attempts: 1,
      lease_token: null,
      lease_until: null,
    });
    expect(Number(rows[0]?.remaining)).toBeGreaterThan(0);
    expect(Number(rows[0]?.remaining)).toBeLessThanOrEqual(1000000);
    expect(await queue.receipt("acceptance.counter", job(1).effectKey)).toBeNull();
    const [effects] = await control.query<RowDataPacket[]>(
      "SELECT sequence,touches FROM synthetic_job_counter",
    );
    expect(effects.map((row) => [row.sequence, row.touches])).toEqual([[999, 0]]);
    expect(await queue.claim()).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const recovered = required(await queue.claim());
    expect(recovered.id).toBe(first.id);
    expect(recovered.attempts).toBe(2);
    await queue.execute(recovered);
    expect(calls).toBe(4);
    expect(await queue.receipt("acceptance.counter", job(1).effectKey)).toEqual({
      jobId: first.id,
    });
    await blockEffect(2, 1);
    expect(calls).toBe(7);
    expect((await queue.inspect()).failures[0]?.failure).toBe("exhausted");
    expect(await queue.receipt("acceptance.counter", job(2).effectKey)).toBeNull();
    const [final] = await control.query<RowDataPacket[]>(
      "SELECT sequence,touches FROM synthetic_job_counter ORDER BY sequence",
    );
    expect(final.map((row) => [row.sequence, row.touches])).toEqual([
      [1, 1],
      [999, 1],
    ]);
    await cleanup();
  }));

test("pre-COMMIT connection loss backs off local work without replaying external callbacks or arbitrary failures", async () =>
  safe(async () => {
    for (const mode of ["local", "external"] as const) {
      let calls = 0;
      const work = async (tx?: TxContext) => {
        calls++;
        if (tx) {
          await unit
            .client(tx)
            .execute(
              sql`INSERT INTO synthetic_job_counter VALUES (${Buffer.from(runId)}, 1, 1, 1)`,
            );
          const [result] = await unit.client(tx).execute(sql`SELECT CONNECTION_ID() id`);
          const identity = Number((result as unknown as { id: number }[])[0]?.id);
          expect(Number.isSafeInteger(identity) && identity > 0).toBe(true);
          await Promise.all([
            unit.client(tx).execute(sql`SELECT SLEEP(3)`),
            (async () => {
              await new Promise((resolve) => setTimeout(resolve, 50));
              await control.query(`KILL CONNECTION ${identity}`);
            })(),
          ]);
        } else
          throw Object.assign(new Error("SYNTHETIC_TRANSPORT_FAILURE"), { code: "ECONNRESET" });
      };
      const queue = createQueue(unit, [
        {
          kind: "acceptance.counter",
          consumer: "acceptance.counter",
          version: 1,
          mode,
          validate: fixtureReference,
          ...(mode === "local" ? { local: work } : { external: async () => work() }),
        },
      ]);
      await unit.run((tx) => queue.enqueue(tx, job(1)));
      await queue.execute(required(await queue.claim()));
      expect(calls).toBe(1);
      const [rows] = await control.query<RowDataPacket[]>(
        "SELECT state,failure,lease_token FROM durable_jobs",
      );
      expect(rows[0]).toMatchObject({
        state: mode === "local" ? "ready" : "failed",
        failure: mode === "local" ? "retryable" : "external_ambiguity",
        lease_token: null,
      });
      expect(await queue.receipt("acceptance.counter", job(1).effectKey)).toBeNull();
      const [effects] = await control.query<RowDataPacket[]>(
        "SELECT COUNT(*) count FROM synthetic_job_counter",
      );
      expect(Number(effects[0]?.count)).toBe(0);
      await cleanup();
    }
    const queue = createQueue(unit, [
      {
        kind: "acceptance.counter",
        consumer: "acceptance.counter",
        version: 1,
        mode: "local",
        validate: fixtureReference,
        local: async () => {
          throw Object.assign(new Error("SYNTHETIC_SQL_FAILURE"), { code: "ER_BAD_FIELD_ERROR" });
        },
      },
    ]);
    await unit.run((tx) => queue.enqueue(tx, job(1)));
    await queue.execute(required(await queue.claim()));
    expect((await queue.inspect()).failures[0]?.failure).toBe("handler_failed");
    await cleanup();
  }));

function child(mode: string) {
  const proc = spawn(process.execPath, ["apps/api/dist/jobs-acceptance.js", mode, runId], {
    env: { ...process.env, VTC_JOBS_ACCEPTANCE: "synthetic-only", TZ: "Pacific/Honolulu" },
    stdio: "ignore",
  });
  return { proc, done: new Promise<number | null>((resolve) => proc.once("exit", resolve)) };
}
test("lost claim/effect COMMIT response never replays callbacks and reconciles durable receipt", async () =>
  safe(async () => {
    const base = createAcceptanceQueue(unit);
    await unit.run((tx) => base.enqueue(tx, job(1)));
    const uncertain = (failAt: number): UnitOfWork => {
      let calls = 0;
      return {
        client: (tx) => unit.client(tx),
        close: async () => {},
        run: async <T>(command: (tx: TxContext) => Promise<T>) => {
          const result = await unit.run(command);
          if (++calls === failAt)
            throw new TransactionCommitOutcomeUnknownError(
              Object.assign(new Error("SYNTHETIC_RECEIPT_LOSS"), { code: "ER_LOCK_WAIT_TIMEOUT" }),
            );
          return result;
        },
      };
    };
    await expect(createAcceptanceQueue(uncertain(1)).claim()).rejects.toBeInstanceOf(
      TransactionCommitOutcomeUnknownError,
    );
    expect(await base.claim()).toBeNull();
    await control.query("UPDATE durable_jobs SET lease_until=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND");
    const claim = required(await base.claim());
    await expect(createAcceptanceQueue(uncertain(2)).execute(claim)).rejects.toBeInstanceOf(
      TransactionCommitOutcomeUnknownError,
    );
    expect(await base.receipt("acceptance.counter", job(1).effectKey)).toEqual({ jobId: claim.id });
    const [rows] = await control.query<RowDataPacket[]>(
      "SELECT touches FROM synthetic_job_counter WHERE stage=1",
    );
    expect(rows.map((r) => r.touches)).toEqual([1]);
    await cleanup();
  }));

test("SIGTERM bounds a noncooperative child, preserves its claim and permits later recovery", async () =>
  safe(async () => {
    const queue = createAcceptanceQueue(unit);
    await unit.run((tx) => queue.enqueue(tx, job(1)));
    const running = child("hang");
    await until(async () => {
      const [rows] = await control.query<RowDataPacket[]>(
        "SELECT COUNT(*) count FROM durable_jobs WHERE state='running'",
      );
      return Number(rows[0]?.count) === 1;
    });
    const started = performance.now();
    running.proc.kill("SIGTERM");
    expect(await running.done).toBe(1);
    expect(performance.now() - started).toBeLessThan(8000);
    await control.query("UPDATE durable_jobs SET lease_until=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND");
    await queue.execute(required(await queue.claim()));
    expect(await queue.receipt("acceptance.counter", job(1).effectKey)).not.toBeNull();
    await cleanup();
  }));

test(
  "hard supervisor deadline terminates hung work without a signal",
  { timeout: 60000 },
  async () =>
    safe(async () => {
      const queue = createAcceptanceQueue(unit);
      await unit.run((tx) => queue.enqueue(tx, job(1)));
      const started = performance.now();
      const hung = child("hang");
      expect(await hung.done).toBe(1);
      expect(performance.now() - started).toBeGreaterThan(49000);
      expect(performance.now() - started).toBeLessThan(55000);
      const [rows] = await control.query<RowDataPacket[]>(
        "SELECT state,attempts FROM durable_jobs",
      );
      expect(rows[0]).toMatchObject({ state: "running", attempts: 1 });
      await queue.execute(required(await queue.claim()));
      expect(await queue.receipt("acceptance.counter", job(1).effectKey)).not.toBeNull();
      await cleanup();
    }),
);

test(
  "bounded backlog preserves remainder and acceptance claims cannot touch another run",
  { timeout: 30000 },
  async () =>
    safe(async () => {
      const queue = createAcceptanceQueue(unit, runId),
        otherRun = newId();
      const foreign = await unit.run((tx) =>
        queue.enqueue(tx, fixtureJob({ runId: otherRun, sequence: 1, stage: 1 })),
      );
      for (let sequence = 1; sequence <= 150; sequence++)
        await unit.run((tx) => queue.enqueue(tx, job(sequence)));
      const result = await runPass(queue, new AbortController().signal);
      expect(result.processed).toBe(100);
      const [foreignRow] = await unit.run((tx) =>
        unit.client(tx).select().from(durableJobs).where(eq(durableJobs.id, foreign)),
      );
      expect(foreignRow?.state).toBe("ready");
      expect(foreignRow?.attempts).toBe(0);
      expect(
        (await queue.inspect()).counts.some((r) => r.state === "ready" && Number(r.count) > 1),
      ).toBe(true);
      await cleanup();
    }),
);
test("real process crash after claim/after effect recovers without loss or duplicate counter", async () =>
  safe(async () => {
    const queue = createAcceptanceQueue(unit);
    await unit.run((tx) => queue.enqueue(tx, job(1)));
    expect(await child("crash-claim").done).toBe(86);
    await control.query("UPDATE durable_jobs SET lease_until=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND");
    expect(await child("crash-effect").done).toBe(86);
    expect(await child("run").done).toBe(0);
    const [rows] = await control.query<RowDataPacket[]>(
      "SELECT stage,touches FROM synthetic_job_counter ORDER BY stage",
    );
    expect(rows.map((r) => [r.stage, r.touches])).toEqual([
      [1, 1],
      [2, 1],
    ]);
    await cleanup();
  }));

test(
  "mixed retained-history full-row claim EXPLAIN and millisecond UTC survive a different process timezone",
  { timeout: 30000 },
  async () =>
    safe(async () => {
      const queue = createAcceptanceQueue(unit);
      await unit.run(async (tx) => {
        for (let sequence = 1; sequence <= 900; sequence++) await queue.enqueue(tx, job(sequence));
      });
      // Technical optimizer fixture, not a company retention/capacity policy.
      await control.query(
        "UPDATE durable_jobs SET state='completed',attempts=1,completed_at=UTC_TIMESTAMP(3) WHERE reference->>'$.sequence' <= 800",
      );
      await control.query(
        "UPDATE durable_jobs SET available_at=UTC_TIMESTAMP(3)+INTERVAL 1 DAY WHERE reference->>'$.sequence' BETWEEN 801 AND 880",
      );
      await control.execute(
        "UPDATE durable_jobs SET state='running',attempts=1,lease_token=?,lease_until=IF(reference->>'$.sequence'>895,UTC_TIMESTAMP(3)-INTERVAL 1 SECOND,UTC_TIMESTAMP(3)+INTERVAL 1 DAY) WHERE reference->>'$.sequence'>885",
        [Buffer.from(newId())],
      );
      const [distribution] = await control.query<RowDataPacket[]>(
        "SELECT SUM(state='completed') completed,SUM(state='ready' AND available_at<=UTC_TIMESTAMP(3)) readyDue,SUM(state='ready' AND available_at>UTC_TIMESTAMP(3)) readyFuture,SUM(state='running' AND lease_until<=UTC_TIMESTAMP(3)) runningExpired,SUM(state='running' AND lease_until>UTC_TIMESTAMP(3)) runningFuture FROM durable_jobs",
      );
      const counts = Object.fromEntries(
        Object.entries(distribution[0] ?? {}).map(([key, value]) => [key, Number(value)]),
      );
      expect(counts).toEqual({
        completed: 800,
        readyDue: 5,
        readyFuture: 80,
        runningExpired: 5,
        runningFuture: 10,
      });
      await control.query("ANALYZE TABLE durable_jobs");
      console.log(
        JSON.stringify({ event: "jobs_explain_fixture", ...counts, statistics: "analyzed" }),
      );
      for (const field of ["available_at", "lease_until"]) {
        const [rows] = await control.query<RowDataPacket[]>(
          `EXPLAIN SELECT * FROM durable_jobs WHERE state='${field === "available_at" ? "ready" : "running"}' AND ${field}<=UTC_TIMESTAMP(3) ORDER BY ${field},id LIMIT 1 FOR UPDATE SKIP LOCKED`,
        );
        console.log(
          JSON.stringify({
            event: "jobs_explain",
            shape: field === "available_at" ? "ready" : "expired",
            access: rows[0]?.type,
            key: rows[0]?.key,
            estimatedRows: rows[0]?.rows,
            extra: rows[0]?.Extra,
          }),
        );
        expect(rows[0]?.key).toBe(field === "available_at" ? "jobs_ready_idx" : "jobs_expired_idx");
      }
      const e = envelope();
      e.occurredAt = "2026-02-01T00:59:59.999+01:00";
      await unit.run((tx) => createOutbox(unit).append(tx, e));
      expect(
        (await unit.run((tx) => unit.client(tx).select().from(outboxEvents)))[0]?.occurredAt,
      ).toBe("2026-01-31T23:59:59.999Z");
      await cleanup();
    }),
);
