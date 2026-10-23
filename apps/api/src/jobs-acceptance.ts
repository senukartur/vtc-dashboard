import { applicationId, createUnitOfWork } from "@vtc/db";
import { sql } from "@vtc/db/platform-schema";
import { readConfig } from "./platform/config/env.js";
import { createAcceptanceQueue, fixtureJob } from "./platform/jobs/acceptance.js";
import { acceptanceFailure } from "./platform/jobs/acceptance-diagnostics.js";
import { ownedCli } from "./platform/jobs/process.js";
import { bounds } from "./platform/jobs/queue.js";
import { runPass } from "./platform/jobs/runner.js";

await ownedCli(async () => {
  // Separate opt-in binary: the ordinary jobs CLI never installs synthetic handlers.
  const watchdog = setTimeout(() => process.exit(1), bounds.hardMs);
  const abort = new AbortController();
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => abort.abort());
  let unit: ReturnType<typeof createUnitOfWork> | undefined;
  try {
    if (process.env.VTC_JOBS_ACCEPTANCE !== "synthetic-only")
      throw new Error("ACCEPTANCE_GUARD_REQUIRED");
    const mode = process.argv[2];
    const runId = applicationId(process.argv[3] ?? "");
    if (
      process.argv.length !== 4 ||
      ![
        "seed",
        "seed-backlog",
        "run",
        "consume",
        "inspect",
        "crash-claim",
        "crash-effect",
        "hang",
      ].includes(mode ?? "")
    )
      throw new Error("INVALID_ACCEPTANCE_MODE");
    unit = createUnitOfWork(readConfig().database);
    const queue = createAcceptanceQueue(unit, runId);
    if (mode === "seed" || mode === "seed-backlog") {
      for (let sequence = 1; sequence <= (mode === "seed" ? 10 : 150); sequence++)
        await unit.run((tx) => queue.enqueue(tx, fixtureJob({ runId, sequence, stage: 1 })));
    } else if (mode === "inspect") {
      const activeUnit = unit;
      const result = await unit.run(async (tx) => {
        const [rows] = await activeUnit
          .client(tx)
          .execute(
            sql`SELECT stage, COUNT(*) AS effects, SUM(touches) AS touches FROM synthetic_job_counter WHERE run_id=${Buffer.from(runId)} GROUP BY stage ORDER BY stage`,
          );
        return rows;
      });
      console.log(JSON.stringify({ event: "acceptance_counter", result }));
    } else if (mode === "crash-claim" || mode === "crash-effect" || mode === "hang") {
      const claim = await queue.claim();
      if (!claim) throw new Error("ACCEPTANCE_CLAIM_REQUIRED");
      if (mode === "hang") await new Promise(() => {});
      if (mode === "crash-effect") await queue.execute(claim, abort.signal);
      process.exit(86);
    } else if (mode === "consume") {
      const started = performance.now();
      let processed = 0;
      while (
        !abort.signal.aborted &&
        processed < bounds.maxJobs &&
        performance.now() - started < bounds.passMs
      ) {
        const claim = await queue.claim();
        if (!claim) break;
        await queue.execute(claim, abort.signal);
        processed++;
      }
      console.log(JSON.stringify({ event: "acceptance_consumed", processed }));
    } else console.log(JSON.stringify(await runPass(queue, abort.signal)));
  } catch (error) {
    console.error(JSON.stringify(acceptanceFailure(error)));
    process.exitCode = 1;
  } finally {
    try {
      await unit?.close();
    } catch {
      console.error(JSON.stringify({ event: "acceptance_failed", category: "close_failed" }));
      process.exitCode = 1;
    }
    clearTimeout(watchdog);
  }
});
