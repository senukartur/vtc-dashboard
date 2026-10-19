import { cleanupMail } from "./modules/messaging/service.js";
import { cleanupAdmissions } from "./modules/admissions/service.js";
import { createUnitOfWork } from "@vtc/db";
import { readConfig } from "./platform/config/env.js";
import { ownedCli } from "./platform/jobs/process.js";
import { bounds, createQueue, unknownCommit } from "./platform/jobs/queue.js";
import { runPass } from "./platform/jobs/runner.js";
import { composeIdentity } from "./use-cases/identity-messaging.js";

await ownedCli(async () => {
  // This watchdog terminates this owned CLI, including noncooperative handlers/hung SQL.
  // Promise.race alone would leave work alive. MySQL leases recover abandoned claims.
  const watchdog = setTimeout(() => {
    console.error(JSON.stringify({ event: "jobs_failed", category: "hard_deadline" }));
    process.exit(1);
  }, bounds.hardMs);
  const abort = new AbortController();
  for (const s of ["SIGINT", "SIGTERM"] as const) process.once(s, () => abort.abort());
  let unit: ReturnType<typeof createUnitOfWork> | undefined;
  try {
    const mode = process.argv[2] ?? "run";
    if (!["run", "inspect"].includes(mode) || process.argv.length > 3)
      throw new Error("INVALID_JOBS_MODE");
    const config = readConfig();
    unit = createUnitOfWork(config.database);
    const composed = config.identity
      ? composeIdentity(unit, config.identity, config.mail, config.admissions)
      : undefined;
    const messaging = composed?.messaging;
    const admissionsCleanup =
      mode === "run" ? await cleanupAdmissions(unit, !!composed?.admissions) : "not_run";
    if (admissionsCleanup === "configuration_pending")
      console.error(
        JSON.stringify({ event: "admissions_cleanup_pending", category: "worker_configuration" }),
      );
    const mailCleanup = mode === "run" ? await cleanupMail(unit, !!messaging) : "not_run";
    if (mailCleanup === "configuration_pending")
      console.error(
        JSON.stringify({ event: "mail_cleanup_pending", category: "worker_configuration" }),
      );
    const queue = messaging?.queue ?? createQueue(unit, [], [], undefined, ["mail.deliver"]);
    const result = mode === "inspect" ? await queue.inspect() : await runPass(queue, abort.signal);
    console.log(
      JSON.stringify({
        event: "jobs_result",
        mailMode: config.mail?.mode ?? "disabled",
        mailCleanup,
        admissionsCleanup,
        ...result,
      }),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "jobs_failed",
        category: unknownCommit(error) ? "commit_outcome_unknown" : "operation_failed",
      }),
    );
    process.exitCode = 1;
  } finally {
    try {
      await unit?.close();
    } catch {
      console.error(JSON.stringify({ event: "jobs_failed", category: "close_failed" }));
      process.exitCode = 1;
    }
    clearTimeout(watchdog);
  }
});
