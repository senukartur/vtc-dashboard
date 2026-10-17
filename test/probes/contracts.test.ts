import { test } from "vitest";
import { deliberateFailure } from "../support/failure-proof.ts";

test("VTC008_CONTRACTS_ASSERTION_PROBE", async () => {
  deliberateFailure("contracts");
});
