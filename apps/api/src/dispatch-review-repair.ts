import { applicationId, createUnitOfWork } from "@vtc/db";
import { readConfig } from "./platform/config/env.js";
import { composeIdentity } from "./use-cases/identity-messaging.js";

try {
  const args = process.argv.slice(2);
  const cursors = args.filter((arg) => arg.startsWith("--after="));
  const flags = args.filter((arg) => arg === "--verify");
  const phases = args.filter((arg) => arg === "--phase=trips" || arg === "--phase=candidates");
  if (
    cursors.length + flags.length + phases.length !== args.length ||
    cursors.length > 1 ||
    flags.length > 1 ||
    phases.length > 1
  )
    throw new Error("INVALID_DISPATCH_REVIEW_REPAIR_ARGUMENTS");
  const after = cursors[0] === undefined ? undefined : applicationId(cursors[0].slice(8));
  const config = readConfig();
  if (!config.identity || !config.tripDecisions || config.dispatchReviewStage3Enabled)
    throw new Error("DISPATCH_REVIEW_REPAIR_REQUIRES_LEGACY_DECISIONS");
  const unit = createUnitOfWork(config.database);
  try {
    const { tripDecisions, reconciliation } = composeIdentity(
      unit,
      config.identity,
      undefined,
      undefined,
      config.externalIdentities,
      config.catalogs,
      config.trips,
      config.telemetry,
      config.manualReports,
      config.qualifications,
      config.events,
      config.reconciliation,
      config.tripDecisions,
    );
    if (!tripDecisions || !reconciliation)
      throw new Error("DISPATCH_REVIEW_REPAIR_COMPOSITION_INCOMPLETE");
    const repair =
      phases[0] === "--phase=candidates"
        ? reconciliation.repairCandidateVersionsInTransaction
        : tripDecisions.repairReviewQueueInTransaction;
    const result = await unit.run((tx) => repair(tx, after, flags.length === 1));
    console.log(JSON.stringify(result));
    if (result.mismatches > 0) process.exitCode = 1;
  } finally {
    await unit.close();
  }
} catch {
  console.error(
    "Dispatch review repair failed. Check command arguments, disabled Stage 3 configuration and database permissions.",
  );
  process.exitCode = 1;
}
