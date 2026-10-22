import { randomBytes } from "node:crypto";
import { createUnitOfWork } from "@vtc/db";

const { composeIdentity } = await import(
  new URL("../../apps/api/dist/use-cases/identity-messaging.js", import.meta.url).href
);
const { runPass } = await import(
  new URL("../../apps/api/dist/platform/jobs/runner.js", import.meta.url).href
);

import { guardedSettings, testConnection } from "../persistence/support.ts";
import { identityDiagnostics, safeIdentityFailure } from "./identity-diagnostics.ts";
import {
  type GenerationPhase,
  generationTransactionTracing,
  generationWorkerPhaseLine,
} from "./manual-generation-diagnostics.ts";

// This producer-free worker inherits only its launcher's disposable allocation.
let unit: ReturnType<typeof createUnitOfWork> | undefined;
let traceTransactions = false;
const diagnostic = identityDiagnostics("generation_worker");
const key = () => randomBytes(32).toString("hex");
async function phase<T>(name: GenerationPhase, work: () => T | Promise<T>): Promise<T> {
  const started = performance.now();
  const emit = (state: "started" | "success" | "failed", extra = {}) =>
    console.error(
      generationWorkerPhaseLine({
        event: "manual_generation_worker_phase",
        phase: name,
        state,
        durationMs: Math.round(performance.now() - started),
        ...extra,
      }),
    );
  emit("started");
  try {
    const result = traceTransactions
      ? await diagnostic.scope({ caseId: "generation_worker", step: name }, async () => work())
      : await work();
    const pass = result as { status: string; processed: number };
    emit(
      "success",
      name === "pass" ? { runnerStatus: pass.status, processed: pass.processed } : {},
    );
    return result;
  } catch (error) {
    try {
      const failure = safeIdentityFailure(error);
      emit("failed", {
        category: failure.category,
        codes: failure.codes,
        ...(failure.databaseOperation ? { databaseOperation: failure.databaseOperation } : {}),
      });
    } catch {
      /* Keep the original failure and exit verdict. */
    }
    throw error;
  }
}
try {
  traceTransactions = generationTransactionTracing(process.argv.slice(3));
  await phase("guard", async () => {
    const control = await testConnection();
    await control.end();
  });
  const rawUnit = createUnitOfWork(guardedSettings());
  unit = traceTransactions ? diagnostic.unit(rawUnit, undefined, true) : rawUnit;
  const current = unit;
  const composed = await phase("composition", () =>
    composeIdentity(
      current,
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
    ),
  );
  await phase("initialize", () => composed.manualReports?.initialize());
  await phase("maintenance", () =>
    composed.manualReports?.maintenance(new AbortController().signal),
  );
  const result = await phase("pass", () =>
    runPass(composed.jobsQueue, new AbortController().signal),
  );
  console.log(
    JSON.stringify({
      event: "manual_generation_worker",
      processed: result.processed,
      pid: process.pid,
    }),
  );
} catch {
  process.exitCode = 1;
} finally {
  if (unit) {
    const current = unit;
    try {
      await phase("close", () => current.close());
    } catch {
      process.exitCode = 1;
    }
  }
}
