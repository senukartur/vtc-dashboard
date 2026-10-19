import { applicationId, newId, type TxContext, type UnitOfWork } from "@vtc/db";
import { performance } from "node:perf_hooks";
import {
  and,
  eq,
  lte,
  mailCommands,
  mailDeliveries as deliveries,
  sql,
} from "@vtc/db/messaging-schema";
import { type Actor, identityError, type PrivateChallenge } from "../identity/service.js";
import {
  createQueue,
  causes,
  unknownCommit,
  ExternalAmbiguityError,
  ExternalRejectedError,
  ExternalRetryError,
  ExternalNotStartedError,
  JobReopenDeniedError,
  type Handler,
  retryTransaction,
} from "../../platform/jobs/queue.js";
import { closed, duplicateKey } from "../../platform/outbox/events.js";
import {
  mailCrypto,
  type MailIntent,
  type PrivateMail,
  mailbox,
  render,
  validateIntent,
} from "./content.js";
import type { Category, MailProvider, Outcome } from "./provider.js";

export interface MessagingConfig {
  mode: "local" | "resend";
  key: string;
  sender: string;
  origin: string;
  production: boolean;
}
export interface MailOwners {
  identityValid(
    tx: TxContext,
    input: {
      id: string;
      userId: string;
      purpose: PrivateChallenge["purpose"];
      stage?: "current_email" | "proposed_email";
    },
  ): Promise<boolean>;
  authorize(tx: TxContext, actor: Actor, scope: "own" | "admissions"): Promise<void>;
  // VTC-015 must check its authoritative generation, decision and consumption on tx.
  admissionsValid?(
    tx: TxContext,
    input: { generationId: string; kind: "invitation" | "rejection" },
  ): Promise<boolean>;
}
type Row = typeof deliveries.$inferSelect;
export function validateMessagingConfig(config: MessagingConfig) {
  mailCrypto(config.key);
  mailbox(config.sender);
  const origin = new URL(config.origin);
  if (
    !["local", "resend"].includes(config.mode) ||
    (config.production && config.mode === "local") ||
    origin.origin !== config.origin ||
    origin.username ||
    origin.password ||
    (origin.protocol !== "https:" &&
      !(
        origin.protocol === "http:" &&
        !config.production &&
        ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
      ))
  )
    throw new Error("INVALID_MAIL_CONFIGURATION");
}
const reference = (input: unknown): { deliveryId: string } => {
  const value = closed(input, ["deliveryId"]);
  return { deliveryId: applicationId(value.deliveryId as string) };
};
// One eligibility index excludes all ciphertext-cleared retained history. Exposed
// as a builder so integration inspection measures this exact production shape.
export function mailExpirySweep(unit: UnitOfWork, tx: TxContext, at: string) {
  return unit
    .client(tx)
    .update(deliveries)
    .set({
      ciphertext: null,
      payloadExpiresAt: null,
      updatedAt: at,
      version: sql`${deliveries.version} + 1`,
      state: sql`IF(${deliveries.state} IN ('accepted','simulated','ambiguous','attempting'), ${deliveries.state}, 'suppressed')`,
      category: sql`IF(${deliveries.state} IN ('accepted','simulated','ambiguous','attempting'), ${deliveries.category}, 'obsolete')`,
      nextAttemptAt: null,
    })
    .where(lte(deliveries.payloadExpiresAt, at))
    .limit(100);
}
export async function purgeExpiredMail(unit: UnitOfWork, now: () => Date = () => new Date()) {
  const client = (tx: TxContext) => unit.client(tx);
  return retryTransaction(unit, async (tx) => {
    await mailExpirySweep(unit, tx, now().toISOString());
    await client(tx)
      .delete(mailCommands)
      .where(lte(mailCommands.createdAt, new Date(now().getTime() - 86400000).toISOString()))
      .limit(100);
  });
}

export async function cleanupMail(
  unit: UnitOfWork,
  enabled: boolean,
  now: () => Date = () => new Date(),
): Promise<"completed" | "configuration_pending"> {
  try {
    await purgeExpiredMail(unit, now);
    return "completed";
  } catch (error) {
    if (
      enabled ||
      unknownCommit(error) ||
      !causes(error).some(
        (cause) =>
          "code" in cause &&
          ["ER_NO_SUCH_TABLE", "ER_TABLEACCESS_DENIED_ERROR"].includes(String(cause.code)),
      )
    )
      throw error;
    return "configuration_pending";
  }
}

export function createMessaging(
  unit: UnitOfWork,
  config: MessagingConfig,
  provider: MailProvider,
  owners: MailOwners,
  now: () => Date = () => new Date(),
) {
  validateMessagingConfig(config);
  if (provider.mode !== config.mode) throw new Error("MAIL_PROVIDER_MODE_MISMATCH");
  const crypto = mailCrypto(config.key),
    client = (tx: TxContext) => unit.client(tx);
  const run = <T>(command: (tx: TxContext) => Promise<T>) => retryTransaction(unit, command);
  const timestamp = () => now().toISOString();
  const retryWindow = (row: Row) =>
    !row.firstAttemptAt || now().getTime() - Date.parse(row.firstAttemptAt) < 23 * 3600000;
  async function valid(
    tx: TxContext,
    row: Pick<Row, "owner" | "generationId" | "kind" | "userId" | "expiresAt">,
    stage?: "current_email" | "proposed_email",
  ) {
    if (Date.parse(row.expiresAt) <= now().getTime()) return false;
    if (
      row.owner === "identity" &&
      row.userId &&
      row.kind !== "invitation" &&
      row.kind !== "rejection"
    )
      return owners.identityValid(tx, {
        id: row.generationId,
        userId: row.userId,
        purpose: row.kind,
        ...(stage ? { stage } : {}),
      });
    if (row.owner === "admissions" && (row.kind === "invitation" || row.kind === "rejection"))
      return (
        owners.admissionsValid?.(tx, { generationId: row.generationId, kind: row.kind }) ?? false
      );
    return false;
  }
  async function get(tx: TxContext, id: string): Promise<Row> {
    const [row] = await client(tx)
      .select()
      .from(deliveries)
      .where(eq(deliveries.id, applicationId(id)))
      .for("update");
    if (!row) throw identityError(404);
    return row;
  }
  async function change(tx: TxContext, row: Row, values: Partial<typeof deliveries.$inferInsert>) {
    // Every terminal/private-payload transition clears indexed eligibility in
    // the same write. Safe expiry/history timestamps remain unchanged.
    if (values.ciphertext === null) values.payloadExpiresAt = null;
    await client(tx)
      .update(deliveries)
      .set({ ...values, updatedAt: timestamp(), version: row.version + 1 })
      .where(eq(deliveries.id, row.id));
  }
  function status(row: Row) {
    // A crash or lease loss cannot turn an in-flight provider request into a retry.
    const stale =
      row.state === "attempting" && Date.parse(row.updatedAt) + 15000 <= now().getTime();
    return {
      id: row.id,
      kind: row.kind,
      state: stale ? ("ambiguous" as const) : row.state,
      version: row.version,
      attempts: row.attempts,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      expiresAt: row.expiresAt,
      nextAttemptAt: row.nextAttemptAt,
      recovery: stale ? "acceptance_unknown" : row.category,
    };
  }
  async function prepare(id: string) {
    // Read only safe ownership before acquiring identity locks. Re-read the
    // delivery under lock after the owning facade, preserving lock order.
    const initial = await run(async (tx) => {
      const [row] = await client(tx).select().from(deliveries).where(eq(deliveries.id, id));
      return row;
    });
    if (!initial) throw new Error("MAIL_REFERENCE_MISSING");
    if (["accepted", "simulated", "suppressed", "failed", "ambiguous"].includes(initial.state))
      return null;
    let privateMail: PrivateMail | null = null;
    try {
      privateMail = initial.ciphertext ? crypto.open(id, initial.ciphertext) : null;
      if (privateMail) {
        const intent = privateMail.intent;
        if (
          !crypto.fingerprint(intent).equals(initial.fingerprint) ||
          intent.owner !== initial.owner ||
          intent.generationId !== initial.generationId ||
          intent.userId !== initial.userId ||
          intent.kind !== initial.kind ||
          intent.locale !== initial.locale ||
          intent.expiresAt !== initial.expiresAt
        )
          throw new Error();
      }
    } catch {
      privateMail = null;
    }
    return run(async (tx) => {
      const usable = privateMail ? await valid(tx, initial, privateMail.intent.stage) : false;
      const row = await get(tx, id);
      if (["accepted", "simulated", "suppressed", "failed", "ambiguous"].includes(row.state))
        return null;
      if (row.state === "attempting") {
        await change(tx, row, { state: "ambiguous", category: "acceptance_unknown" });
        return null;
      }
      if (!privateMail) {
        await change(tx, row, {
          state: "failed",
          category: "payload_unavailable",
          ciphertext: null,
        });
        return null;
      }
      if (privateMail.providerBinding !== crypto.binding(provider.scope)) {
        await change(tx, row, {
          state: "failed",
          category: "provider_changed",
          ciphertext: null,
          nextAttemptAt: null,
        });
        return null;
      }
      if (!usable) {
        await change(tx, row, {
          state: "suppressed",
          category: "obsolete",
          ciphertext: null,
          nextAttemptAt: null,
        });
        return null;
      }
      if (!retryWindow(row) || row.attempts >= 5 || row.mode !== provider.mode) {
        await change(tx, row, {
          state: "failed",
          category: row.attempts >= 5 ? "attempts_exhausted" : "idempotency_expired",
          ciphertext: null,
          nextAttemptAt: null,
        });
        return null;
      }
      if (row.nextAttemptAt && Date.parse(row.nextAttemptAt) > now().getTime())
        throw new ExternalRetryError(
          Math.min(86400000, Math.max(1000, Date.parse(row.nextAttemptAt) - now().getTime())),
        );
      await change(tx, row, {
        state: "attempting",
        category: null,
        attempts: row.attempts + 1,
        firstAttemptAt: row.firstAttemptAt ?? timestamp(),
        nextAttemptAt: null,
      });
      return { row, request: privateMail.request };
    });
  }
  const handler: Handler = {
    kind: "mail.deliver",
    version: 1,
    consumer: "messaging.mail",
    mode: "external",
    validate: reference,
    external: async (input, effectKey, signal, execution) => {
      const { deliveryId } = reference(input),
        started = performance.now();
      if (effectKey !== `messaging.mail:${deliveryId}`) throw new ExternalRejectedError();
      const prepared = await prepare(deliveryId);
      if (!prepared) return;
      // The first-attempt marker commits before any provider I/O. If that commit
      // is uncertain it propagates unchanged and no request is made.
      let outcome: Outcome | { state: "not_started" } = { state: "not_started" };
      // Reserve a separate five-second private receipt COMMIT plus statement
      // headroom; the queue has already reserved its own completion budget.
      const requestBudgetMs = Math.min(4000, Math.floor(execution.remainingMs() - 6000));
      if (!signal.aborted && performance.now() - started < 2500 && requestBudgetMs > 0) {
        try {
          outcome = await provider.send(
            prepared.request,
            effectKey,
            AbortSignal.any([signal, AbortSignal.timeout(requestBudgetMs)]),
          );
        } catch {
          outcome = { state: "ambiguous", category: "acceptance_unknown" };
        }
      }
      let delay: number | null = null;
      await run(async (tx) => {
        const row = await get(tx, deliveryId);
        if (["accepted", "simulated"].includes(row.state)) return;
        if (outcome.state === "accepted" || outcome.state === "simulated") {
          await change(tx, row, {
            state: outcome.state,
            receipt: outcome.receipt,
            category: null,
            ciphertext: null,
            nextAttemptAt: null,
          });
        } else if (outcome.state === "not_started") {
          const next = now().getTime() + 1000,
            canRetry =
              row.attempts < 5 &&
              retryWindow(row) &&
              next < Date.parse(row.expiresAt) &&
              next < Date.parse(row.firstAttemptAt ?? timestamp()) + 23 * 3600000;
          delay = canRetry ? 1000 : null;
          await change(tx, row, {
            state: canRetry ? "retryable" : "failed",
            category: canRetry
              ? "not_started"
              : row.attempts >= 5
                ? "attempts_exhausted"
                : "idempotency_expired",
            nextAttemptAt: canRetry ? new Date(next).toISOString() : null,
            ...(!canRetry ? { ciphertext: null } : {}),
          });
        } else if (outcome.state === "ambiguous") {
          await change(tx, row, {
            state: "ambiguous",
            category: "acceptance_unknown",
            nextAttemptAt: null,
          });
        } else {
          delay = outcome.retryAfterMs;
          const canRetry =
            delay !== null &&
            row.attempts < 5 &&
            retryWindow(row) &&
            now().getTime() + delay < Date.parse(row.expiresAt) &&
            now().getTime() + delay < Date.parse(row.firstAttemptAt ?? timestamp()) + 23 * 3600000;
          await change(tx, row, {
            state: canRetry ? "retryable" : "failed",
            category: outcome.category,
            nextAttemptAt: delay !== null ? new Date(now().getTime() + delay).toISOString() : null,
            ...(!canRetry &&
            ![
              "daily_quota",
              "monthly_quota",
              "authentication",
              "provider_unavailable",
              "rate_limit",
            ].includes(outcome.category)
              ? { ciphertext: null }
              : {}),
          });
          if (!canRetry) delay = null;
        }
      });
      if (outcome.state === "not_started") {
        if (delay !== null) throw new ExternalNotStartedError();
        throw new ExternalRejectedError();
      }
      if (delay !== null) throw new ExternalRetryError(delay);
      if (outcome.state === "ambiguous") throw new ExternalAmbiguityError();
      if (outcome.state === "rejected") throw new ExternalRejectedError();
    },
  };
  const queue = createQueue(unit, [handler]);
  async function enqueue(tx: TxContext, raw: MailIntent): Promise<string> {
    const input = validateIntent(raw, config.origin);
    if (
      Date.parse(input.expiresAt) <= now().getTime() ||
      (input.kind === "invitation" && Date.parse(input.expiresAt) > now().getTime() + 7 * 86400000)
    )
      throw new Error("INVALID_MAIL_EXPIRY");
    if (input.owner === "admissions" && !owners.admissionsValid) throw identityError(503);
    if (
      !(await valid(
        tx,
        {
          owner: input.owner,
          generationId: input.generationId,
          kind: input.kind,
          userId: input.userId,
          expiresAt: input.expiresAt,
        },
        input.stage,
      ))
    )
      throw identityError(409);
    const id = input.owner === "identity" ? input.generationId : newId(),
      fingerprint = crypto.fingerprint(input);
    try {
      await client(tx)
        .insert(deliveries)
        .values({
          id,
          owner: input.owner,
          generationId: input.generationId,
          userId: input.userId,
          kind: input.kind,
          locale: input.locale,
          mode: config.mode,
          templateVersion: 1,
          fingerprint,
          payloadExpiresAt: input.expiresAt,
          ciphertext: crypto.seal(id, {
            intent: input,
            request: render(input, config.sender, config.origin),
            providerBinding: crypto.binding(provider.scope),
          }),
          state: "queued",
          version: 1,
          attempts: 0,
          expiresAt: input.expiresAt,
          createdAt: timestamp(),
          updatedAt: timestamp(),
        });
    } catch (error) {
      if (!duplicateKey(error)) throw error;
    }
    const [saved] = await client(tx)
      .select()
      .from(deliveries)
      .where(
        and(
          eq(deliveries.owner, input.owner),
          eq(deliveries.generationId, input.generationId),
          eq(deliveries.kind, input.kind),
        ),
      )
      .for("update");
    if (!saved?.fingerprint.equals(fingerprint)) throw identityError(409, "IDEMPOTENCY_CONFLICT");
    await queue.enqueue(tx, {
      kind: handler.kind,
      schemaVersion: 1,
      consumer: handler.consumer,
      effectKey: saved.id,
      eventId: null,
      reference: { deliveryId: saved.id },
      availableAt: saved.createdAt,
      maxAttempts: 5,
    });
    return saved.id;
  }
  async function authorize(tx: TxContext, actor: Actor, id: string) {
    // Authorize current session before looking up an inaccessible delivery.
    await owners.authorize(tx, actor, "own");
    const row = await get(tx, id);
    if (row.owner === "identity") {
      if (row.userId !== actor.userId) throw identityError(404);
    } else {
      try {
        await owners.authorize(tx, actor, "admissions");
      } catch (error) {
        if (error && typeof error === "object" && "statusCode" in error && error.statusCode === 403)
          throw identityError(404);
        throw error;
      }
    }
    return row;
  }
  return {
    queue,
    handler,
    enqueue,
    delivery: {
      async enqueue(tx: TxContext, input: PrivateChallenge) {
        await enqueue(tx, {
          owner: "identity",
          generationId: input.id,
          userId: input.userId,
          recipient: input.email,
          kind: input.purpose,
          locale: input.locale ?? "en",
          code: input.code,
          expiresAt: input.expiresAt,
          ...(input.emailChangeStage ? { stage: input.emailChangeStage } : {}),
        });
      },
      async invalidate(
        tx: TxContext,
        input: { userId: string; purpose?: PrivateChallenge["purpose"]; generationId?: string },
      ) {
        await client(tx)
          .update(deliveries)
          .set({
            ciphertext: null,
            payloadExpiresAt: null,
            updatedAt: timestamp(),
            version: sql`${deliveries.version} + 1`,
            state: sql`IF(${deliveries.state} IN ('accepted','simulated'), ${deliveries.state}, 'suppressed')`,
            category: sql`IF(${deliveries.state} IN ('accepted','simulated'), NULL, 'obsolete')`,
            nextAttemptAt: null,
          })
          .where(
            and(
              eq(deliveries.owner, "identity"),
              eq(deliveries.userId, input.userId),
              input.purpose ? eq(deliveries.kind, input.purpose) : undefined,
              input.generationId ? eq(deliveries.generationId, input.generationId) : undefined,
              sql`${deliveries.ciphertext} IS NOT NULL`,
            ),
          );
      },
    },
    async inspect(actor: Actor, id: string) {
      return run(async (tx) => {
        const row = await authorize(tx, actor, id),
          result = status(row);
        const job = await queue.effectState(tx, handler.consumer, id);
        if (
          !["accepted", "simulated", "suppressed"].includes(row.state) &&
          job?.state === "failed" &&
          (["missing_handler", "invalid_input", "exhausted"].includes(job.failure ?? "") ||
            (job.failure === "handler_failed" && row.state === "queued"))
        )
          return {
            ...result,
            state: "failed" as const,
            recovery: job.failure === "exhausted" ? "attempts_exhausted" : "worker_configuration",
          };
        return job?.failure === "external_ambiguity" &&
          !["accepted", "simulated", "suppressed"].includes(row.state)
          ? { ...result, state: "ambiguous" as const, recovery: "acceptance_unknown" }
          : result;
      });
    },
    async invalidateAdmissions(tx: TxContext, generationId: string) {
      if (!owners.admissionsValid) throw identityError(503);
      await client(tx)
        .update(deliveries)
        .set({
          ciphertext: null,
          payloadExpiresAt: null,
          updatedAt: timestamp(),
          version: sql`${deliveries.version} + 1`,
          state: sql`IF(${deliveries.state} IN ('accepted','simulated'), ${deliveries.state}, 'suppressed')`,
          category: sql`IF(${deliveries.state} IN ('accepted','simulated'), NULL, 'obsolete')`,
          nextAttemptAt: null,
        })
        .where(
          and(
            eq(deliveries.owner, "admissions"),
            eq(deliveries.generationId, applicationId(generationId)),
            sql`${deliveries.ciphertext} IS NOT NULL`,
          ),
        );
    },
    async resend(actor: Actor, id: string, key: string, expectedVersion: number) {
      applicationId(key);
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw identityError(422);
      return run(async (tx) => {
        const row = await authorize(tx, actor, id);
        const [saved] = await client(tx)
          .select()
          .from(mailCommands)
          .where(and(eq(mailCommands.actorId, actor.userId), eq(mailCommands.key, key)))
          .for("update");
        if (saved) {
          if (saved.deliveryId !== id || saved.expectedVersion !== expectedVersion)
            throw identityError(409, "IDEMPOTENCY_CONFLICT");
          return { id, version: saved.resultVersion };
        }
        if (row.version !== expectedVersion) throw identityError(409, "VERSION_CONFLICT");
        if (
          !["failed", "retryable"].includes(row.state) ||
          !row.ciphertext ||
          !retryWindow(row) ||
          row.attempts >= 5 ||
          ![
            "rate_limit",
            "daily_quota",
            "monthly_quota",
            "authentication",
            "provider_unavailable",
            "not_started",
          ].includes(row.category ?? "") ||
          (row.nextAttemptAt && Date.parse(row.nextAttemptAt) > now().getTime())
        )
          throw identityError(409);
        const payload = crypto.open(row.id, row.ciphertext);
        if (!(await valid(tx, row, payload.intent.stage))) throw identityError(409);
        // Reopen only known rejected requests, preserving the original job/key,
        // attempt counter, expiry and frozen payload. Ambiguity is never reopened.
        try {
          // The mail outcome and queue retry acknowledgement commit separately.
          // Always lock/check the authoritative job before recording success.
          await queue.retryRejected(tx, handler.consumer, id, { deliveryId: id });
        } catch (error) {
          if (error instanceof JobReopenDeniedError) throw identityError(409);
          throw error;
        }
        await change(tx, row, { state: "queued", nextAttemptAt: null });
        await client(tx)
          .insert(mailCommands)
          .values({
            key,
            actorId: actor.userId,
            deliveryId: id,
            expectedVersion,
            resultVersion: row.version + 1,
            createdAt: timestamp(),
          });
        return { id, version: row.version + 1 };
      });
    },
    async purgeExpired() {
      return purgeExpiredMail(unit, now);
    },
  };
}
export type Messaging = ReturnType<typeof createMessaging>;
export type MailStatus = ReturnType<Messaging["inspect"]>;
export type MailFailure = Category;
