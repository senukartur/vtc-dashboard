import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rename, unlink, writeFile } from "node:fs/promises";

export async function writeAcceptanceSignal(file: string, value: unknown) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  let written = false;
  try {
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
    written = true;
    await rename(temporary, file);
    written = false;
  } catch (error) {
    // A rejected exclusive write grants no authority to remove an existing temporary path.
    if (written) await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  // A failed producer may reject before the recipient transaction has started.
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}

export async function acceptanceInterruptionHandshake<
  T extends object,
  Ready extends object,
  Tx,
>(options: {
  producer: (prepared: (target: T) => Promise<void>) => Promise<T>;
  startup: (target: T) => Promise<Ready>;
  recipient: (body: (tx: Tx) => Promise<void>) => Promise<void>;
  lockRecipient: (tx: Tx) => Promise<void>;
  afterCommit: (tx: Tx, target: T, ready: Ready) => Promise<void>;
  secondary: (error: unknown) => void;
}) {
  const held = deferred<void>(),
    committed = deferred<{ target: T; ready: Ready }>();
  let recipient: Promise<void> | undefined, target: T | undefined, ready: Ready | undefined;
  let failed = false,
    primary: unknown;
  try {
    const result = await options.producer(async (prepared) => {
      assert.equal(target, undefined, "ACCEPTANCE_PREPARE_REPEATED");
      target = prepared;
      ready = await options.startup(prepared);
      recipient = options.recipient(async (tx) => {
        await options.lockRecipient(tx);
        held.resolve();
        const value = await committed.promise;
        await options.afterCommit(tx, value.target, value.ready);
      });
      void recipient.then(
        () => held.reject(new Error("ACCEPTANCE_RECIPIENT_ENDED_BEFORE_COMMIT")),
        held.reject,
      );
      await held.promise;
    });
    assert.ok(target && ready && recipient, "ACCEPTANCE_PREPARE_REQUIRED");
    assert.equal(result, target, "ACCEPTANCE_COMMIT_TARGET_CHANGED");
    // The producer adapter resolves only after its existing COMMIT receipt is known.
    committed.resolve({ target: result, ready });
    await recipient;
    return result;
  } catch (error) {
    failed = true;
    primary = error;
    committed.reject(error);
    throw error;
  } finally {
    if (recipient) {
      try {
        await recipient;
      } catch (error) {
        // Success already awaited this same promise; any rejection here accompanies a primary failure.
        if (failed && error !== primary) {
          try {
            options.secondary(error);
          } catch {
            /* A diagnostic sink cannot replace the primary transaction failure. */
          }
        }
      }
    }
  }
}

export interface InterruptionTarget {
  runId: string;
  requestId: string;
  tripId: string;
  sourceRecordId: string;
  eventId: string;
}

export function interruptionStartupAck(value: unknown, target: InterruptionTarget) {
  assert.ok(value && typeof value === "object");
  const row = value as Record<string, unknown>;
  assert.deepEqual(Object.keys(row).sort(), [...Object.keys(target), "workerId", "phase"].sort());
  for (const key of Object.keys(target) as (keyof InterruptionTarget)[])
    assert.equal(row[key], target[key]);
  assert.equal(row.phase, "startup_ready");
  assert.ok(typeof row.workerId === "string" && /^[a-f0-9]{64}$/.test(row.workerId));
  return { ...target, workerId: row.workerId };
}

export function interruptionStopAck(
  value: unknown,
  expected: InterruptionTarget & { workerId: string },
) {
  assert.ok(value && typeof value === "object");
  const row = value as Record<string, unknown>;
  assert.deepEqual(
    Object.keys(row).sort(),
    [...Object.keys(expected), "phase", "jobIdHex", "processAbsent", "lease"].sort(),
  );
  for (const key of Object.keys(expected) as (keyof typeof expected)[])
    assert.equal(row[key], expected[key]);
  assert.equal(row.phase, "stopped");
  assert.equal(row.processAbsent, true);
  assert.ok(typeof row.jobIdHex === "string" && /^[A-Fa-f0-9]{72}$/.test(row.jobIdHex));
  assert.match(
    Buffer.from(row.jobIdHex, "hex").toString("ascii"),
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
  );
  assert.ok(row.lease && typeof row.lease === "object");
  const lease = row.lease as Record<string, unknown>;
  assert.deepEqual(
    Object.keys(lease).sort(),
    ["state", "attempts", "leaseUntilUtc", "observedUtc", "unexpired", "completedAt"].sort(),
  );
  assert.equal(lease.state, "running");
  assert.ok(Number.isSafeInteger(lease.attempts) && Number(lease.attempts) >= 1);
  assert.equal(lease.unexpired, 1);
  assert.equal(lease.completedAt, null);
  assert.ok(
    typeof lease.leaseUntilUtc === "string" && Number.isFinite(Date.parse(lease.leaseUntilUtc)),
  );
  assert.ok(
    typeof lease.observedUtc === "string" && Number.isFinite(Date.parse(lease.observedUtc)),
  );
  assert.ok(Date.parse(lease.leaseUntilUtc) > Date.parse(lease.observedUtc));
  const utc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,6}Z$/;
  assert.match(lease.leaseUntilUtc, utc);
  assert.match(lease.observedUtc, utc);
  return {
    ...expected,
    jobIdHex: row.jobIdHex,
    lease: {
      attempts: Number(lease.attempts),
      leaseUntilUtc: lease.leaseUntilUtc,
      observedUtc: lease.observedUtc,
    },
  };
}
