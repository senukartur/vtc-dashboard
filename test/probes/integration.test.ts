import { test } from "vitest";
import { testConnection } from "../persistence/support.ts";
import { deliberateFailure } from "../support/failure-proof.ts";

test("VTC008_INTEGRATION_ASSERTION_PROBE", async () => {
  const connection = await testConnection();
  await connection.end();
  deliberateFailure("integration");
});
