import type { afterAll as AfterAll, beforeAll as BeforeAll } from "vitest";
import { SCHEMA_SETUP_TIMEOUT_MS } from "../persistence/support.ts";
// Framework timeouts do not cancel SQL. Teardown must await setup settlement before releasing
// the suite's database guard; a later suite refuses the still-owned schema before reset.
export function schemaLifecycleHooks(
  registerBefore: typeof BeforeAll,
  registerAfter: typeof AfterAll,
) {
  let pending: Promise<void> | undefined;
  return {
    beforeAll(command: () => Promise<void>, timeout = SCHEMA_SETUP_TIMEOUT_MS) {
      registerBefore(async () => {
        pending = command();
        await pending;
      }, timeout);
    },
    afterAll(command: () => Promise<void>, timeout = SCHEMA_SETUP_TIMEOUT_MS) {
      registerAfter(async () => {
        try {
          await pending;
        } catch {
          /* Preserve the original setup failure. */
        }
        await command();
      }, timeout);
    },
  };
}
