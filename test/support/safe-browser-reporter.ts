import { resolve } from "node:path";
import type { FullResult, Reporter, TestCase, TestResult } from "@playwright/test/reporter";
import {
  browserFailureLine,
  browserFiles,
  safeBrowserFailure,
} from "../../scripts/browser-diagnostics.mjs";

export default class SafeBrowserReporter implements Reporter {
  private started = false;
  private emitted = new Set<string>();
  private files = new Map(Object.entries(browserFiles).map(([path, id]) => [resolve(path), id]));

  printsToStdio() {
    return true;
  }
  onTestBegin() {
    this.started = true;
  }
  onTestEnd(test: TestCase, result: TestResult) {
    if (!["failed", "timedOut", "interrupted"].includes(result.status)) return;
    const failure = safeBrowserFailure({
      kind: "test",
      file: this.files.get(test.location.file),
      line: test.location.line,
      project: test.parent.project()?.name,
      status: result.status,
    });
    this.emit(failure ?? { kind: "global", category: "unmapped-test", status: result.status });
  }
  onError() {
    this.emit({ kind: "global", category: "runner-error", status: "failed" });
  }
  onEnd(result: FullResult) {
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
