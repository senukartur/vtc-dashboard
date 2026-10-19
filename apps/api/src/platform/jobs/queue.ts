import {
  applicationId,
  newId,
  opaqueUtf8,
  TransactionCommitOutcomeUnknownError,
  type TxContext,
  type UnitOfWork,
  utcDateTime,
  utcIso,
} from "@vtc/db";
import { performance } from "node:perf_hooks";
import {
  and,
  asc,
  effectReceipts,
  eq,
  durableJobs as jobs,
  lte,
  notExists,
  outboxEvents,
  runnerLeases,
  sql,
} from "@vtc/db/platform-schema";
import {
  type AccessEvent,
  accessEvent,
  closed,
  duplicateKey,
  fingerprint,
} from "../outbox/events.js";

export const bounds = Object.freeze({
  jobLeaseMs: 15000,
  runnerLeaseMs: 20000,
  passMs: 40000,
  hardMs: 50000,
  maxJobs: 100,
  routeBatch: 25,
  maxAttempts: 5,
  transactionAttempts: 3,
  externalCompletionHeadroomMs: 6000,
});
type Job = typeof jobs.$inferSelect;
export type Claim = Job & { leaseToken: string };
export type Failure = NonNullable<Job["failure"]>;
export interface JobInput {
  kind: string;
  schemaVersion: number;
  consumer: string;
  effectKey: string;
  eventId: string | null;
  reference: unknown;
  availableAt: string;
  maxAttempts: number;
}
export interface Handler {
  kind: string;
  version: number;
  consumer: string;
  validate(input: unknown): unknown;
  mode: "local" | "external";
  local?: (tx: TxContext, reference: unknown, claim: Claim) => Promise<void>;
  external?: (
    reference: unknown,
    effectKey: string,
    signal: AbortSignal,
    execution: ExternalExecution,
  ) => Promise<void>;
}
export interface ExternalExecution {
  remainingMs(): number;
}
export function externalExecutionBudget(
  remainingAtMeasurementMs: number,
  measuredAt: number,
  upstream: AbortSignal,
  clock: () => number = () => performance.now(),
): ExternalExecution & { signal: AbortSignal } {
  const remainingMs = () =>
    Math.max(
      0,
      Math.floor(
        remainingAtMeasurementMs - (clock() - measuredAt) - bounds.externalCompletionHeadroomMs,
      ),
    );
  const budget = remainingMs();
  if (!Number.isFinite(budget) || budget <= 0 || upstream.aborted)
    throw new ExternalAmbiguityError();
  return { remainingMs, signal: AbortSignal.any([upstream, AbortSignal.timeout(budget)]) };
}
export interface Subscription {
  consumer: string;
  kind: string;
  eventType: "member.access_changed";
  reference(event: AccessEvent): unknown;
}
export class RetryableJobError extends Error {}
export class ExternalAmbiguityError extends Error {}
export class ExternalRejectedError extends Error {}
export class JobReopenDeniedError extends Error {
  constructor() {
    super("JOB_REOPEN_DENIED");
  }
}
// Only an adapter with a durable unchanged request and a safe retry decision may
// use this outcome. Ordinary external exceptions remain terminal ambiguity.
export class ExternalRetryError extends Error {
  constructor(readonly delayMs: number) {
    super("EXTERNAL_RETRY_SAFE");
    if (!Number.isInteger(delayMs) || delayMs < 1000 || delayMs > 86400000)
      throw new Error("INVALID_EXTERNAL_RETRY_DELAY");
  }
}
export class LeaseLostError extends Error {
  constructor() {
    super("JOB_LEASE_LOST");
  }
}

export function causes(error: unknown): object[] {
  const result: object[] = [];
  for (
    let current = error;
    current && typeof current === "object" && result.length < 8 && !result.includes(current);
    current = "cause" in current ? current.cause : null
  )
    result.push(current);
  return result;
}
export function unknownCommit(error: unknown): boolean {
  return causes(error).some((e) => e instanceof TransactionCommitOutcomeUnknownError);
}
function retryableLocalDatabaseFailure(error: unknown): boolean {
  // Called only after UnitOfWork rolled back/discarded the local effect transaction.
  // Connection failures get durable backoff, never an immediate callback replay.
  return causes(error).some(
    (e) =>
      "code" in e &&
      [
        "ER_LOCK_DEADLOCK",
        "ER_LOCK_WAIT_TIMEOUT",
        "PROTOCOL_SEQUENCE_TIMEOUT",
        "ETIMEDOUT",
        "ECONNRESET",
        "ECONNREFUSED",
        "PROTOCOL_CONNECTION_LOST",
        "EPIPE",
      ].includes(String(e.code)),
  );
}
export async function retryTransaction<T>(
  unit: UnitOfWork,
  command: (tx: TxContext) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await unit.run(command);
    } catch (error) {
      if (
        unknownCommit(error) ||
        causes(error).some((e) => e instanceof LeaseLostError) ||
        attempt >= bounds.transactionAttempts ||
        !causes(error).some(
          (e) =>
            "code" in e && ["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(String(e.code)),
        )
      )
        throw error;
      // UnitOfWork has explicitly rolled back and discarded the failed connection.
      await new Promise((resolve) => setTimeout(resolve, 10 * attempt));
    }
  }
}
function name(value: string): Buffer {
  if (typeof value !== "string" || !/^[a-z][a-z0-9_.-]{0,63}$/.test(value))
    throw new Error("INVALID_JOB_CODE");
  return opaqueUtf8(value, 64);
}
function effect(value: string): Buffer {
  if (typeof value !== "string" || !/^[a-zA-Z0-9:_.-]{1,128}$/.test(value))
    throw new Error("INVALID_EFFECT_KEY");
  return opaqueUtf8(value, 128);
}
export function createQueue(
  unit: UnitOfWork,
  handlers: readonly Handler[] = [],
  subscriptions: readonly Subscription[] = [],
  claimScope?: { kind: string; consumer: string; runId: string },
  pausedKinds: readonly string[] = [],
) {
  const scope = claimScope
    ? and(
        eq(jobs.kind, name(claimScope.kind)),
        eq(jobs.consumer, name(claimScope.consumer)),
        sql`JSON_UNQUOTE(JSON_EXTRACT(${jobs.reference}, '$.runId')) = ${applicationId(claimScope.runId)}`,
      )
    : undefined;
  const scoped = and(scope, ...pausedKinds.map((kind) => sql`${jobs.kind} <> ${name(kind)}`));
  const registry = new Map<string, Handler>();
  for (const h of handlers) {
    name(h.kind);
    name(h.consumer);
    if (
      h.version !== 1 ||
      registry.has(h.kind) ||
      (h.mode === "local" ? !h.local || !!h.external : !h.external || !!h.local)
    )
      throw new Error("INVALID_JOB_REGISTRATION");
    registry.set(h.kind, h);
  }
  const consumers = new Set<string>();
  for (const s of subscriptions) {
    const h = registry.get(s.kind);
    if (
      !h ||
      h.consumer !== s.consumer ||
      s.eventType !== "member.access_changed" ||
      consumers.has(s.consumer)
    )
      throw new Error("INVALID_SUBSCRIPTION");
    consumers.add(s.consumer);
  }
  const run = <T>(fn: (tx: TxContext) => Promise<T>) => retryTransaction(unit, fn);
  const due = (ms: number) => sql`TIMESTAMPADD(MICROSECOND, ${ms * 1000}, UTC_TIMESTAMP(3))`;
  async function enqueue(tx: TxContext, input: JobInput): Promise<string> {
    const c = unit.client(tx);
    input = closed(input, [
      "kind",
      "schemaVersion",
      "consumer",
      "effectKey",
      "eventId",
      "reference",
      "availableAt",
      "maxAttempts",
    ]) as unknown as JobInput;
    const h = registry.get(input.kind);
    if (!h || h.version !== input.schemaVersion || h.consumer !== input.consumer)
      throw new Error("UNREGISTERED_JOB");
    if (
      !Number.isInteger(input.maxAttempts) ||
      input.maxAttempts < 1 ||
      input.maxAttempts > bounds.maxAttempts
    )
      throw new Error("INVALID_ATTEMPT_LIMIT");
    const safe = {
      kind: input.kind,
      schemaVersion: input.schemaVersion,
      consumer: input.consumer,
      effectKey: input.effectKey,
      eventId: input.eventId === null ? null : applicationId(input.eventId),
      reference: h.validate(input.reference),
      availableAt: utcIso(utcDateTime(input.availableAt)),
      maxAttempts: input.maxAttempts,
    };
    if (Buffer.byteLength(JSON.stringify(safe.reference)) > 4096)
      throw new Error("JOB_REFERENCE_TOO_LARGE");
    const hash = fingerprint(safe);
    const id = newId();
    try {
      await c.insert(jobs).values({
        ...safe,
        id,
        kind: name(safe.kind),
        consumer: name(safe.consumer),
        effectKey: effect(safe.effectKey),
        fingerprint: hash,
        attempts: 0,
        state: "ready",
        createdAt: sql`UTC_TIMESTAMP(3)`,
      });
    } catch (error) {
      if (!duplicateKey(error)) throw error;
    }
    const [saved] = await c
      .select()
      .from(jobs)
      .where(
        and(eq(jobs.consumer, name(safe.consumer)), eq(jobs.effectKey, effect(safe.effectKey))),
      )
      .for("share");
    if (!saved?.fingerprint.equals(hash)) throw new Error("JOB_IDENTITY_CONFLICT");
    return saved.id;
  }
  async function fence(tx: TxContext, claim: Claim): Promise<Job> {
    const [saved] = await unit
      .client(tx)
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.id, claim.id),
          eq(jobs.state, "running"),
          eq(jobs.leaseToken, claim.leaseToken),
          sql`${jobs.leaseUntil} > UTC_TIMESTAMP(3)`,
        ),
      )
      .for("update");
    if (!saved) throw new LeaseLostError();
    return saved;
  }
  async function runnerFence(tx: TxContext, token: string): Promise<void> {
    const [saved] = await unit
      .client(tx)
      .select()
      .from(runnerLeases)
      .where(
        and(
          eq(runnerLeases.name, name("minute")),
          eq(runnerLeases.token, token),
          sql`${runnerLeases.leaseUntil} > UTC_TIMESTAMP(3)`,
        ),
      )
      .for("update");
    if (!saved) throw new LeaseLostError();
  }
  async function finish(tx: TxContext, claim: Claim) {
    await fence(tx, claim);
    await unit
      .client(tx)
      .update(jobs)
      .set({
        state: "completed",
        leaseToken: null,
        leaseUntil: null,
        failure: null,
        completedAt: sql`UTC_TIMESTAMP(3)`,
      })
      .where(
        and(
          eq(jobs.id, claim.id),
          eq(jobs.state, "running"),
          eq(jobs.leaseToken, claim.leaseToken),
        ),
      );
  }
  return {
    enqueue,
    async effectState(tx: TxContext, consumer: string, effectKey: string) {
      const [row] = await unit
        .client(tx)
        .select({ state: jobs.state, failure: jobs.failure })
        .from(jobs)
        .where(and(eq(jobs.consumer, name(consumer)), eq(jobs.effectKey, effect(effectKey))));
      return row ?? null;
    },
    async reopenRejected(tx: TxContext, consumer: string, effectKey: string): Promise<void> {
      const c = unit.client(tx);
      const [saved] = await c
        .select()
        .from(jobs)
        .where(and(eq(jobs.consumer, name(consumer)), eq(jobs.effectKey, effect(effectKey))))
        .for("update");
      if (
        saved?.state !== "failed" ||
        saved.failure !== "handler_failed" ||
        saved.attempts >= saved.maxAttempts ||
        saved.leaseToken ||
        saved.leaseUntil ||
        registry.get(saved.kind.toString())?.mode !== "external"
      )
        throw new JobReopenDeniedError();
      const [receipt] = await c
        .select()
        .from(effectReceipts)
        .where(
          and(
            eq(effectReceipts.consumer, saved.consumer),
            eq(effectReceipts.effectKey, saved.effectKey),
          ),
        )
        .for("share");
      if (receipt) throw new JobReopenDeniedError();
      await c
        .update(jobs)
        .set({ state: "ready", failure: null, availableAt: sql`UTC_TIMESTAMP(3)` })
        .where(eq(jobs.id, saved.id));
    },
    async receipt(consumer: string, effectKey: string): Promise<{ jobId: string } | null> {
      return run(async (tx) => {
        const [saved] = await unit
          .client(tx)
          .select({ jobId: effectReceipts.jobId })
          .from(effectReceipts)
          .where(
            and(
              eq(effectReceipts.consumer, name(consumer)),
              eq(effectReceipts.effectKey, effect(effectKey)),
            ),
          );
        return saved ?? null;
      });
    },
    async route(): Promise<number> {
      let count = 0;
      // Anti-join over durable identities has no timestamp watermark, so late commits remain eligible.
      for (const s of subscriptions) {
        count += await run(async (tx) => {
          const c = unit.client(tx);
          const events = await c
            .select()
            .from(outboxEvents)
            .where(
              and(
                eq(outboxEvents.type, name(s.eventType)),
                notExists(
                  c
                    .select({ id: jobs.id })
                    .from(jobs)
                    .where(
                      and(eq(jobs.eventId, outboxEvents.id), eq(jobs.consumer, name(s.consumer))),
                    ),
                ),
              ),
            )
            .orderBy(asc(outboxEvents.recordedAt), asc(outboxEvents.id))
            .limit(bounds.routeBatch);
          for (const e of events) {
            const envelope = accessEvent({
              eventId: e.id,
              type: e.type.toString(),
              schemaVersion: e.schemaVersion,
              aggregate: {
                kind: e.aggregateKind.toString(),
                id: e.aggregateId,
                version: e.aggregateVersion,
              },
              occurredAt: e.occurredAt,
              correlationId: e.correlationId,
              causationId: e.causationId,
              data: e.data,
            });
            await enqueue(tx, {
              kind: s.kind,
              schemaVersion: 1,
              consumer: s.consumer,
              effectKey: e.id,
              eventId: e.id,
              reference: s.reference(envelope),
              availableAt: e.recordedAt,
              maxAttempts: bounds.maxAttempts,
            });
          }
          return events.length;
        });
      }
      return count;
    },
    async claim(runnerToken?: string): Promise<Claim | null> {
      return run(async (tx) => {
        if (runnerToken) await runnerFence(tx, runnerToken);
        const c = unit.client(tx);
        // Two bounded indexed selections avoid an OR across availability/expiry indexes.
        let [row] = await c
          .select()
          .from(jobs)
          .where(
            and(scoped, eq(jobs.state, "running"), lte(jobs.leaseUntil, sql`UTC_TIMESTAMP(3)`)),
          )
          .orderBy(asc(jobs.leaseUntil), asc(jobs.id))
          .limit(1)
          .for("update", { skipLocked: true });
        if (!row)
          [row] = await c
            .select()
            .from(jobs)
            .where(
              and(scoped, eq(jobs.state, "ready"), lte(jobs.availableAt, sql`UTC_TIMESTAMP(3)`)),
            )
            .orderBy(asc(jobs.availableAt), asc(jobs.id))
            .limit(1)
            .for("update", { skipLocked: true });
        if (!row) return null;
        if (row.state === "running" && registry.get(row.kind.toString())?.mode === "external") {
          await c
            .update(jobs)
            .set({
              state: "failed",
              failure: "external_ambiguity",
              leaseToken: null,
              leaseUntil: null,
            })
            .where(eq(jobs.id, row.id));
          return null;
        }
        if (row.attempts >= row.maxAttempts) {
          await c
            .update(jobs)
            .set({ state: "failed", failure: "exhausted", leaseToken: null, leaseUntil: null })
            .where(eq(jobs.id, row.id));
          return null;
        }
        const token = newId();
        await c
          .update(jobs)
          .set({
            state: "running",
            attempts: row.attempts + 1,
            leaseToken: token,
            leaseUntil: due(bounds.jobLeaseMs),
          })
          .where(eq(jobs.id, row.id));
        return { ...row, state: "running", attempts: row.attempts + 1, leaseToken: token };
      });
    },
    async renew(claim: Claim): Promise<void> {
      await run(async (tx) => {
        await fence(tx, claim);
        await unit
          .client(tx)
          .update(jobs)
          .set({ leaseUntil: due(bounds.jobLeaseMs) })
          .where(and(eq(jobs.id, claim.id), eq(jobs.leaseToken, claim.leaseToken)));
      });
    },
    async fail(claim: Claim, category: Failure, retryDelayMs?: number): Promise<void> {
      await run(async (tx) => {
        const saved = await fence(tx, claim);
        const retry = category === "retryable" && saved.attempts < saved.maxAttempts;
        await unit
          .client(tx)
          .update(jobs)
          .set({
            state: retry ? "ready" : "failed",
            failure: category === "retryable" && !retry ? "exhausted" : category,
            availableAt: due(retryDelayMs ?? Math.min(60000, 1000 * 2 ** (saved.attempts - 1))),
            leaseToken: null,
            leaseUntil: null,
          })
          .where(and(eq(jobs.id, claim.id), eq(jobs.leaseToken, claim.leaseToken)));
      });
    },
    async execute(claim: Claim, signal: AbortSignal = new AbortController().signal): Promise<void> {
      const authoritative = await run((tx) => fence(tx, claim));
      claim = { ...authoritative, leaseToken: claim.leaseToken };
      const h = registry.get(claim.kind.toString());
      if (!h) {
        await this.fail(claim, "missing_handler");
        return;
      }
      let reference: unknown;
      try {
        if (claim.schemaVersion !== h.version || claim.consumer.toString() !== h.consumer)
          throw new Error("INVALID_STORED_VERSION");
        reference = h.validate(claim.reference);
      } catch {
        await this.fail(claim, "invalid_input");
        return;
      }
      try {
        if (h.mode === "local") {
          await run(async (tx) => {
            const saved = await fence(tx, claim);
            const c = unit.client(tx);
            const [receipt] = await c
              .select()
              .from(effectReceipts)
              .where(
                and(
                  eq(effectReceipts.consumer, saved.consumer),
                  eq(effectReceipts.effectKey, saved.effectKey),
                ),
              )
              .for("share");
            if (!receipt) {
              await c.insert(effectReceipts).values({
                consumer: saved.consumer,
                effectKey: saved.effectKey,
                jobId: saved.id,
                committedAt: sql`UTC_TIMESTAMP(3)`,
              });
              await h.local?.(tx, reference, claim);
            }
            await finish(tx, claim);
          });
        } else {
          const lease = await run(async (tx) => {
            await fence(tx, claim);
            // Anchor before the DB clock read, conservatively including query
            // response and COMMIT receipt latency in the monotonic elapsed time.
            const measuredAt = performance.now();
            const [remaining] = await unit
              .client(tx)
              .select({
                remainingMs: sql<number>`TIMESTAMPDIFF(MICROSECOND, UTC_TIMESTAMP(3), ${jobs.leaseUntil}) DIV 1000`,
              })
              .from(jobs)
              .where(eq(jobs.id, claim.id));
            if (!remaining) throw new LeaseLostError();
            return { measuredAt, remainingMs: Number(remaining.remainingMs) };
          });
          const execution = externalExecutionBudget(lease.remainingMs, lease.measuredAt, signal);
          // Adapters must use this durable key with their provider and reconcile unknown outcomes.
          await h.external?.(
            reference,
            `${claim.consumer.toString()}:${claim.effectKey.toString()}`,
            execution.signal,
            execution,
          );
          await run(async (tx) => {
            await fence(tx, claim);
            await finish(tx, claim);
          });
        }
      } catch (error) {
        if (unknownCommit(error) || causes(error).some((e) => e instanceof LeaseLostError))
          throw error;
        await this.fail(
          claim,
          h.mode === "external"
            ? error instanceof ExternalRetryError
              ? "retryable"
              : error instanceof ExternalRejectedError
                ? "handler_failed"
                : "external_ambiguity"
            : error instanceof RetryableJobError || retryableLocalDatabaseFailure(error)
              ? "retryable"
              : "handler_failed",
          error instanceof ExternalRetryError ? error.delayMs : undefined,
        );
      }
    },
    async acquireRunner(): Promise<string | null> {
      return run(async (tx) => {
        const token = newId();
        const c = unit.client(tx);
        await c
          .insert(runnerLeases)
          .values({ name: name("minute"), token, leaseUntil: due(bounds.runnerLeaseMs) })
          .onDuplicateKeyUpdate({
            set: {
              token: sql`IF(lease_until <= UTC_TIMESTAMP(3), ${Buffer.from(token)}, token)`,
              leaseUntil: sql`IF(lease_until <= UTC_TIMESTAMP(3), ${due(bounds.runnerLeaseMs)}, lease_until)`,
            },
          });
        const [saved] = await c
          .select()
          .from(runnerLeases)
          .where(eq(runnerLeases.name, name("minute")))
          .for("update");
        return saved?.token === token ? token : null;
      });
    },
    async renewRunner(token: string): Promise<void> {
      await run(async (tx) => {
        await runnerFence(tx, token);
        await unit
          .client(tx)
          .update(runnerLeases)
          .set({ leaseUntil: due(bounds.runnerLeaseMs) })
          .where(and(eq(runnerLeases.name, name("minute")), eq(runnerLeases.token, token)));
      });
    },
    async releaseRunner(token: string): Promise<void> {
      await run(async (tx) => {
        await unit
          .client(tx)
          .delete(runnerLeases)
          .where(and(eq(runnerLeases.name, name("minute")), eq(runnerLeases.token, token)));
      });
    },
    async inspect() {
      return run(async (tx) => {
        const c = unit.client(tx);
        const counts = await c
          .select({
            state: jobs.state,
            failure: jobs.failure,
            count: sql<number>`CAST(COUNT(*) AS UNSIGNED)`,
            oldest: sql<string | null>`MIN(available_at)`,
          })
          .from(jobs)
          .groupBy(jobs.state, jobs.failure);
        const events = await c
          .select({ count: sql<number>`CAST(COUNT(*) AS UNSIGNED)` })
          .from(outboxEvents);
        const failures = await c
          .select({
            id: jobs.id,
            kind: jobs.kind,
            schemaVersion: jobs.schemaVersion,
            attempts: jobs.attempts,
            failure: jobs.failure,
          })
          .from(jobs)
          .where(eq(jobs.state, "failed"))
          .orderBy(asc(jobs.id))
          .limit(25);
        return {
          counts,
          retainedEvents: Number(events[0]?.count ?? 0),
          unboundEvents: subscriptions.length === 0 ? Number(events[0]?.count ?? 0) : 0,
          boundConsumers: subscriptions.length,
          failures: failures.map((f) => ({ ...f, kind: f.kind.toString() })),
        };
      });
    },
  };
}
export type Queue = ReturnType<typeof createQueue>;
