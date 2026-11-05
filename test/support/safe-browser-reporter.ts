import { relative, resolve } from "node:path";
import type { FullResult, Reporter, TestCase, TestResult } from "@playwright/test/reporter";
import {
  browserFailureLine,
  browserFiles,
  safeBrowserFailure,
  safeQualificationAnnotations,
} from "../../scripts/browser-diagnostics.mjs";
import { fileTimingLine, safeFileTiming } from "../../scripts/ci-result.mjs";

export default class SafeBrowserReporter implements Reporter {
  private started = false;
  private emitted = new Set<string>();
  private files = new Map(Object.entries(browserFiles).map(([path, id]) => [resolve(path), id]));
  // Summed over all projects; feeds the CI shard weights.
  private durations = new Map<string, number>();

  printsToStdio() {
    return true;
  }
  onTestBegin() {
    this.started = true;
  }
  onTestEnd(test: TestCase, result: TestResult) {
    const file = relative(process.cwd(), test.location.file).replaceAll("\\", "/");
    this.durations.set(file, (this.durations.get(file) ?? 0) + result.duration);
    if (!["failed", "timedOut", "interrupted"].includes(result.status)) return;
    const failure = safeBrowserFailure({
      kind: "test",
      file: this.files.get(test.location.file),
      line: test.location.line,
      project: test.parent.project()?.name,
      status: result.status,
    });
    let phase: ReturnType<typeof safeQualificationAnnotations>;
    if (failure?.kind === "test" && failure.file === "qualifications") {
      try {
        phase = safeQualificationAnnotations(result.annotations);
      } catch {
        /* Invalid metadata keeps the coarse failure. */
      }
    }
    this.emit(
      (phase && safeBrowserFailure({ ...failure, ...phase })) ??
        failure ?? { kind: "global", category: "unmapped-test", status: result.status },
    );
  }
  onError() {
    this.emit({ kind: "global", category: "runner-error", status: "failed" });
  }
  onEnd(result: FullResult) {
    for (const [file, durationMs] of [...this.durations].sort(([a], [b]) => a.localeCompare(b))) {
      const timing = safeFileTiming({ lane: "e2e", file, durationMs: Math.round(durationMs) });
      if (timing) console.log(fileTimingLine(timing));
    }
    if (!this.started && result.status !== "passed")
      this.emit({
        kind: "global",
        category: "no-tests-started",
        status: result.status === "timedout" ? "timedOut" : result.status,
      });
  }
  private emit(value: unknown) {
    const line = browserFailureLine(value);
    if (this.emitted.size >= 32 || this.emitted.has(line)) return;
    this.emitted.add(line);
    console.log(line);
  }
}
