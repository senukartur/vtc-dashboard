import { relative } from "node:path";
import type { Reporter, TestModule } from "vitest/node";
import { fileTimingLine, safeFileTiming } from "../../scripts/ci-result.mjs";

// Prints one fixed-schema duration line per integration file; it feeds the shard weights.
export default class FileTimingReporter implements Reporter {
  onTestModuleEnd(module: TestModule) {
    const diagnostic = module.diagnostic();
    const timing = safeFileTiming({
      lane: "integration",
      file: relative(process.cwd(), module.moduleId).replaceAll("\\", "/"),
      durationMs: Math.round(
        diagnostic.environmentSetupDuration +
          diagnostic.prepareDuration +
          diagnostic.collectDuration +
          diagnostic.setupDuration +
          diagnostic.duration,
      ),
    });
    if (timing) console.log(fileTimingLine(timing));
  }
}
