import { defineConfig } from "vitest/config";

const lane = process.env.VTC_TEST_LANE ?? "unit";
if (!["unit", "contracts", "integration"].includes(lane)) throw new Error("INVALID_TEST_LANE");
export default defineConfig({
  test: {
    name: lane,
    include:
      process.env.VTC_FAILURE_PROBE === "assertion"
        ? [`test/probes/${lane}.test.ts`]
        : [`test/${lane}/**/*.test.ts`],
    environment: "node",
    setupFiles: ["test/support/setup.ts"],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 15000,
    hookTimeout: 15000,
    retry: 0,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    allowOnly: false,
    passWithNoTests: false,
  },
});
