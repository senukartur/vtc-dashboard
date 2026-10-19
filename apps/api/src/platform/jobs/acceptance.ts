import { applicationId, type UnitOfWork } from "@vtc/db";
import { sql } from "@vtc/db/platform-schema";
import { closed } from "../outbox/events.js";
import { createQueue, type JobInput, RetryableJobError } from "./queue.js";

export interface FixtureReference {
  runId: string;
  sequence: number;
  stage: number;
}
export function fixtureReference(value: unknown): FixtureReference {
  const r = closed(value, ["runId", "sequence", "stage"]);
  if (
    typeof r.sequence !== "number" ||
    typeof r.stage !== "number" ||
    !Number.isInteger(r.sequence) ||
    Number(r.sequence) < 1 ||
    Number(r.sequence) > 1000 ||
    ![1, 2].includes(Number(r.stage))
  )
    throw new Error("INVALID_ACCEPTANCE_REFERENCE");
  return {
    runId: applicationId(r.runId as string),
    sequence: Number(r.sequence),
    stage: Number(r.stage),
  };
}
export function fixtureJob(reference: FixtureReference): JobInput {
  return {
    kind: "acceptance.counter",
    schemaVersion: 1,
    consumer: "acceptance.counter",
    effectKey: `${reference.runId}:${reference.sequence}:${reference.stage}`,
    eventId: null,
    reference,
    availableAt: "2000-01-01T00:00:00.000Z",
    maxAttempts: 3,
  };
}
export function createAcceptanceQueue(unit: UnitOfWork, runId?: string) {
  const queue = createQueue(
    unit,
    [
      {
        kind: "acceptance.counter",
        version: 1,
        consumer: "acceptance.counter",
        mode: "local",
        validate: fixtureReference,
        local: async (tx, input, claim) => {
          const r = fixtureReference(input);
          if (r.sequence === 2 && r.stage === 1 && claim.attempts === 1)
            throw new RetryableJobError("ACCEPTANCE_RETRY");
          await unit
            .client(tx)
            .execute(
              sql`INSERT INTO synthetic_job_counter (run_id, sequence, stage, touches) VALUES (${Buffer.from(r.runId)}, ${r.sequence}, ${r.stage}, 1)`,
            );
          if (r.stage === 1) await queue.enqueue(tx, fixtureJob({ ...r, stage: 2 }));
        },
      },
    ],
    [],
    runId ? { kind: "acceptance.counter", consumer: "acceptance.counter", runId } : undefined,
  );
  return queue;
}
