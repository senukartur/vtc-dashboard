import { randomBytes } from "node:crypto";
import { createUnitOfWork } from "@vtc/db";
const { composeIdentity } = await import(
  new URL("../../apps/api/dist/use-cases/identity-messaging.js", import.meta.url).href
);
const { runPass } = await import(
  new URL("../../apps/api/dist/platform/jobs/runner.js", import.meta.url).href
);
import { guardedSettings, testConnection } from "../persistence/support.ts";

// This producer-free worker inherits only its launcher's disposable allocation.
const control = await testConnection();
await control.end();
const unit = createUnitOfWork(guardedSettings()),
  key = () => randomBytes(32).toString("hex");
let phase = "composition";
try {
  const composed = composeIdentity(
    unit,
    { secret: key(), origin: "http://127.0.0.1:4173", production: false },
    undefined,
    undefined,
    false,
    {
      production: false,
      synthetic: true,
      cursorKey: key(),
      maxFileBytes: 1048576,
      artifactTtlMs: 86400000,
      policyRevision: 1,
      evidence: [],
    },
    { cursorKey: key() },
    undefined,
    {
      key: key(),
      maxFilesPerReport: 5,
      policyRevision: 1,
      orphanGraceMs: 60000,
      storage: {
        root: process.argv[2] ?? "",
        maxFileBytes: 1048576,
        maxPixels: 10000,
        timeoutMs: 5000,
      },
    },
  );
  phase = "initialize";
  await composed.manualReports?.initialize();
  phase = "maintenance";
  await composed.manualReports?.maintenance(new AbortController().signal);
  phase = "pass";
  const result = await runPass(composed.jobsQueue, new AbortController().signal);
  console.log(
    JSON.stringify({
      event: "manual_generation_worker",
      processed: result.processed,
      pid: process.pid,
    }),
  );
} catch {
  console.error(JSON.stringify({ event: "manual_generation_worker", status: "failed", phase }));
  process.exitCode = 1;
} finally {
  await unit.close();
}
