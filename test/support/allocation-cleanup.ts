import { bounded } from "./concurrency.ts";

export const SCHEMA_DROP_QUERY_TIMEOUT_MS = 10000;
export const SCHEMA_CLEANUP_TIMEOUT_MS = 12000;

export interface OwnedAllocation {
  schema: boolean;
  user: boolean;
  file: boolean;
}

interface CleanupOperations {
  lock: () => Promise<void>;
  schema: () => Promise<void>;
  user: () => Promise<void>;
  file: () => Promise<void>;
  admin: () => Promise<void>;
  destroyAdmin: () => void;
}

export async function cleanupAllocation(
  owned: OwnedAllocation,
  operations: CleanupOperations,
): Promise<string[]> {
  const failures: string[] = [];
  for (const step of ["lock", "schema", "user", "file", "admin"] as const) {
    if (step !== "lock" && step !== "admin" && !owned[step]) continue;
    try {
      await bounded(
        operations[step](),
        `cleanup_${step}`,
        step === "schema" ? SCHEMA_CLEANUP_TIMEOUT_MS : 3000,
      );
    } catch {
      // Never expose driver diagnostics or credentials through cleanup errors.
      failures.push(step.toUpperCase());
    }
  }
  // Closing may reject or time out. Always force-close the provisioner's transport too.
  try {
    operations.destroyAdmin();
  } catch {
    failures.push("ADMIN_TRANSPORT");
  }
  return failures;
}
