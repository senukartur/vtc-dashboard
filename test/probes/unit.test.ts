import { test } from "vitest";
import { deliberateFailure } from "../support/failure-proof.ts";

test("VTC008_UNIT_ASSERTION_PROBE", async () => {
  deliberateFailure("unit");
});
