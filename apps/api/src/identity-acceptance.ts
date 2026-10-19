import { randomBytes } from "node:crypto";
import { createUnitOfWork, newId } from "@vtc/db";
import { challenges, company, sql, user } from "@vtc/db/identity-schema";
import { mailDeliveries } from "@vtc/db/messaging-schema";
import { durableJobs } from "@vtc/db/platform-schema";
import { readConfig } from "./platform/config/env.js";
import { composeIdentity } from "./use-cases/identity-messaging.js";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
let unit: ReturnType<typeof createUnitOfWork> | undefined;
const watchdog = setTimeout(() => process.exit(1), 30000);
function requireState(condition: unknown): asserts condition {
  if (!condition) throw new Error("ACCEPTANCE_ASSERTION_FAILED");
}
try {
  const mode = process.argv[2];
  const run = process.env.VTC_IDENTITY_ACCEPTANCE_RUN ?? "";
  requireState(
    process.env.VTC_IDENTITY_ACCEPTANCE === "synthetic-only" &&
      uuid.test(run) &&
      process.argv.length === 3 &&
      ["produce", "inspect"].includes(mode ?? ""),
  );
  const suffix = run.replaceAll("-", "").slice(0, 16);
  const config = readConfig();
  requireState(
    config.database.database === `vtc_accept_${suffix}` &&
      config.database.user === `vtc_ar_${suffix}` &&
      config.identity &&
      config.mail,
  );
  unit = createUnitOfWork(config.database);
  const ownedUnit = unit;
  // This operator-created sentinel is SELECT-only for the allocated runtime account.
  const [allocation] = await ownedUnit.run((tx) =>
    ownedUnit.client(tx).execute(sql`SELECT run_id FROM acceptance_allocation WHERE singleton=1`),
  );
  requireState(
    Array.isArray(allocation) &&
      allocation.length === 1 &&
      (allocation[0] as { run_id?: string }).run_id === run,
  );
  if (mode === "produce") {
    const empty = await ownedUnit.run(async (tx) => {
      const db = ownedUnit.client(tx);
      return !(await db.select().from(company)).length && !(await db.select().from(user)).length;
    });
    requireState(empty);
    const recipient = process.env.VTC_ACCEPTANCE_RECIPIENT ?? "";
    requireState(recipient.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient));
    const password = randomBytes(32).toString("base64url");
    const { identity } = composeIdentity(ownedUnit, config.identity, config.mail);
    await identity.bootstrap({ email: recipient, name: "Synthetic Activation Director", password });
    const signed = await identity.login(recipient, password);
    const cookie = signed.cookies.map((value) => value.split(";", 1)[0]).join("; ");
    const actor = await identity.authenticate(new Headers({ cookie }));
    await identity.requestChallenge(actor, newId(), "email_verification");
  }
  const result = await ownedUnit.run(async (tx) => {
    const db = ownedUnit.client(tx);
    const generations = await db.select().from(challenges);
    const deliveries = await db.select().from(mailDeliveries);
    const jobs = await db.select().from(durableJobs);
    requireState(generations.length === 1 && deliveries.length === 1 && jobs.length === 1);
    const generation = generations[0];
    const delivery = deliveries[0];
    const job = jobs[0];
    requireState(generation && delivery && job);
    requireState(
      delivery.owner === "identity" &&
        delivery.kind === "email_verification" &&
        delivery.id === generation.id &&
        delivery.generationId === generation.id &&
        delivery.userId === generation.userId &&
        job.kind.toString("ascii") === "mail.deliver" &&
        JSON.stringify(job.reference) === JSON.stringify({ deliveryId: delivery.id }),
    );
    const retainedPayload = delivery.ciphertext !== null && delivery.payloadExpiresAt !== null;
    const purgedPayload = delivery.ciphertext === null && delivery.payloadExpiresAt === null;
    requireState(
      (delivery.state === "queued" &&
        retainedPayload &&
        job.state === "ready" &&
        delivery.attempts === 0) ||
        (["accepted", "simulated"].includes(delivery.state) &&
          purgedPayload &&
          job.state === "completed" &&
          delivery.attempts === 1 &&
          delivery.receipt !== null),
    );
    return {
      event: "identity_acceptance",
      runId: run,
      challengeId: generation.id,
      deliveryId: delivery.id,
      jobId: job.id,
      state: delivery.state,
      jobState: job.state,
      attempts: delivery.attempts,
      retainedPayload,
      purgedPayload,
    };
  });
  console.log(JSON.stringify(result));
} catch {
  console.error(
    JSON.stringify({ event: "identity_acceptance_failed", category: "operation_failed" }),
  );
  process.exitCode = 1;
} finally {
  try {
    await unit?.close();
  } catch {
    console.error(
      JSON.stringify({ event: "identity_acceptance_failed", category: "close_failed" }),
    );
    process.exitCode = 1;
  }
  clearTimeout(watchdog);
}
