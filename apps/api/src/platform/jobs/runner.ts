import { performance } from "node:perf_hooks";
import { bounds, type Queue } from "./queue.js";

export async function runPass(queue: Queue, signal: AbortSignal) {
  const started = performance.now();
  const token = await queue.acquireRunner();
  if (!token) return { status: "overlap", processed: 0 };
  let processed = 0;
  let failed = false;
  let failure: unknown;
  let inspection: Awaited<ReturnType<Queue["inspect"]>> | undefined;
  try {
    while (
      !signal.aborted &&
      processed < bounds.maxJobs &&
      performance.now() - started < bounds.passMs
    ) {
      await queue.renewRunner(token);
      await queue.route();
      if (signal.aborted || performance.now() - started >= bounds.passMs) break;
      const claim = await queue.claim(token);
      if (!claim) break;
      await queue.execute(claim, signal);
      processed++;
    }
    inspection = await queue.inspect();
  } catch (error) {
    failed = true;
    failure = error;
  }
  try {
    await queue.releaseRunner(token);
  } catch (error) {
    if (!failed) throw error;
  }
  if (failed) throw failure;
  return { status: signal.aborted ? "stopped" : "completed", processed, inspection };
}
