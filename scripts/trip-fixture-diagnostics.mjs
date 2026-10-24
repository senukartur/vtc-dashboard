import {
  safeGenerationProcessRecord,
  safeScopedTransactionRecord,
} from "../test/support/manual-generation-diagnostics.ts";
import { safeManualJobsRecord } from "../test/support/manual-jobs-diagnostics.ts";

// Node 24 loads these dependency-free, erasable test schemas before the build runs.
export function safeTripFixture(value) {
  const generation = safeGenerationProcessRecord(value);
  if (
    generation &&
    ((generation.event === "manual_generation_process" &&
      ["close", "spawn_error"].includes(generation.state)) ||
      (generation.event === "manual_generation_transaction" &&
        ["callback_threw", "rejected"].includes(generation.boundary)))
  )
    return generation;
  const cli = safeManualJobsRecord(value);
  if (cli) return cli;
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const required = [
    "event",
    "fixture",
    "phase",
    "state",
    "durationMs",
    "caseId",
    "step",
    "transactionOrdinal",
    "category",
    "codes",
  ];
  const optional = ["statusCode", "databaseOperation"];
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key)) ||
    value.event !== "identity_fixture" ||
    value.fixture !== "reconciliation" ||
    value.phase !== "transaction" ||
    value.state !== "failed"
  )
    return;
  const { event: _event, phase: _phase, state: _state, ...facts } = value;
  const safe = safeScopedTransactionRecord({
    ...facts,
    event: "identity_fixture_transaction",
    boundary: "rejected",
  });
  if (!safe) return;
  const { event: _transaction, boundary: _boundary, ...fields } = safe;
  return { event: "identity_fixture", phase: "transaction", state: "failed", ...fields };
}
