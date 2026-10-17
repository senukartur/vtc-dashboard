import { expect, test } from "vitest";
import { testConnection } from "../persistence/support.ts";

test("VTC008_INTEGRATION_ASSERTION_PROBE", async () => {
  const connection = await testConnection();
  await connection.end();
  expect("VTC008_INTEGRATION_ASSERTION_PROBE").toBe("deliberately different");
});
