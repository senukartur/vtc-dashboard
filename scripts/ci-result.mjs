import {
  browserFailurePrefix,
  safeBrowserFailure,
  browserTimingPrefix,
  browserTimingLimit,
  safeBrowserTiming,
} from "./browser-diagnostics.mjs";
import { safeTripFixture } from "./trip-fixture-diagnostics.mjs";

// Public diagnostics are reconstructed from fixed values; raw child output is never retained.
export const stages = [
  "build-image",
  "check",
  "build",
  "isolation",
  "unit",
  "contracts",
  "integration",
  "persistence",
  "recovery",
  "e2e",
  "failure-reporting",
  "cleanup",
];
// The rehearsal follows the successful scope job from ci-scope.mjs: the path rule on a pull
// request, always skipped on a main push (which alone publishes the artifact), and always run
// by the main schedule or manual dispatch.
export function requiredCi(results) {
  if (results?.quality !== "success" || results?.scope !== "success") return 1;
  if (!["true", "false"].includes(results.rehearsal)) return 1;
  const rehearsal = results.rehearsal === "true" ? "success" : "skipped";
  if (results.deployment !== rehearsal) return 1;
  if (results.event === "pull_request") return results.artifact === "skipped" ? 0 : 1;
  if (results.ref !== "refs/heads/main") return 1;
  if (results.event === "push")
    return results.rehearsal === "false" && results.artifact === "success" ? 0 : 1;
  return ["schedule", "workflow_dispatch"].includes(results.event) &&
    results.rehearsal === "true" &&
    results.artifact === "skipped"
    ? 0
    : 1;
}
export function safeEvent(value) {
  if (
    !value ||
    !stages.includes(value.stage) ||
    !["success", "failure"].includes(value.status) ||
    !Number.isSafeInteger(value.exitCode) ||
    value.exitCode < 0 ||
    value.exitCode > 255 ||
    !Number.isSafeInteger(value.durationMs) ||
    value.durationMs < 0 ||
    value.durationMs > 86400000 ||
    (value.status === "success") !== (value.exitCode === 0)
  )
    return undefined;
  return {
    stage: value.stage,
    status: value.status,
    exitCode: value.exitCode,
    durationMs: value.durationMs,
  };
}
export function eventLine(stage, exitCode, durationMs) {
  const event = safeEvent({
    stage,
    status: exitCode === 0 ? "success" : "failure",
    exitCode,
    durationMs,
  });
  if (!event) throw new Error("INVALID_CI_EVENT");
  return `VTC_CI_EVENT ${JSON.stringify(event)}`;
}
// Per-file durations for the sharded lanes: only committed test file names and a bounded
// integer, so the weights in test-shard-weights.json can be refreshed from hosted runs.
export const fileTimingPrefix = "VTC_FILE_TIMING ";
const timedFiles = {
  integration: /^test\/integration\/[a-z0-9][a-z0-9-]*\.test\.ts$/,
  e2e: /^test\/e2e\/[a-z0-9][a-z0-9-]*\.spec\.ts$/,
};
export function safeFileTiming(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Object.keys(value).length !== 3 ||
    !["integration", "e2e"].includes(value.lane) ||
    typeof value.file !== "string" ||
    !timedFiles[value.lane].test(value.file) ||
    !Number.isSafeInteger(value.durationMs) ||
    value.durationMs < 0 ||
    value.durationMs > 86400000
  )
    return undefined;
  return { lane: value.lane, file: value.file, durationMs: value.durationMs };
}
export function fileTimingLine(value) {
  const timing = safeFileTiming(value);
  if (!timing) throw new Error("INVALID_FILE_TIMING");
  return `${fileTimingPrefix}${JSON.stringify(timing)}`;
}
export function collectEvents() {
  const events = [];
  const browserFailures = [];
  const fixtureDiagnostics = [];
  const fileTimings = [];
  const browserTimings = [];
  let pending = "";
  let oversized = false;
  return {
    events,
    browserFailures,
    fixtureDiagnostics,
    fileTimings,
    browserTimings,
    push(chunk) {
      for (const part of String(chunk).split(/(\n)/)) {
        if (part === "\n") {
          if (!oversized && pending.startsWith("VTC_CI_EVENT ")) {
            try {
              const event = safeEvent(JSON.parse(pending.slice(13)));
              if (event && events.length < 64) events.push(event);
            } catch {
              /* Unstructured diagnostics remain private. */
            }
          }
          if (!oversized && pending.startsWith(browserFailurePrefix)) {
            try {
              const failure = safeBrowserFailure(
                JSON.parse(pending.slice(browserFailurePrefix.length)),
              );
              if (failure && browserFailures.length < 32) browserFailures.push(failure);
            } catch {
              /* Unstructured browser diagnostics remain private. */
            }
          }
          if (!oversized && pending.startsWith(fileTimingPrefix)) {
            try {
              const timing = safeFileTiming(JSON.parse(pending.slice(fileTimingPrefix.length)));
              if (timing && fileTimings.length < 128) fileTimings.push(timing);
            } catch {
              /* Only the closed timing schema can reach the public report. */
            }
          }
          if (!oversized && pending.startsWith(browserTimingPrefix)) {
            try {
              const timing = safeBrowserTiming(
                JSON.parse(pending.slice(browserTimingPrefix.length)),
              );
              if (timing && browserTimings.length < browserTimingLimit) browserTimings.push(timing);
            } catch {
              /* Arbitrary runner output never becomes public timing metadata. */
            }
          }
          if (!oversized && pending.startsWith("{")) {
            try {
              const diagnostic = safeTripFixture(JSON.parse(pending));
              if (diagnostic && fixtureDiagnostics.length < 64) fixtureDiagnostics.push(diagnostic);
            } catch {
              /* Only closed fixture schemas can reach the public report. */
            }
          }
          pending = "";
          oversized = false;
        } else if (!oversized) {
          pending += part;
          if (pending.length > 1024) {
            pending = "";
            oversized = true;
          }
        }
      }
    },
  };
}
export function qualityReport(
  exitCode,
  durationMs,
  events,
  probe,
  browserFailures = [],
  fixtureDiagnostics = [],
  fileTimings = [],
  browserTimings = [],
) {
  const failures = browserFailures.map(safeBrowserFailure).filter(Boolean).slice(0, 32);
  if (
    !failures.length &&
    events.some((event) => event.stage === "e2e" && event.status === "failure")
  )
    failures.push({ kind: "global", category: "unreported-runner-failure", status: "failed" });
  const failedProbe =
    probe && events.some((event) => event.stage === probe && event.status === "failure");
  return {
    version: 1,
    status: exitCode === 0 ? "success" : "failure",
    category: probe
      ? failedProbe
        ? "deliberate-assertion"
        : "probe-not-reached"
      : exitCode === 0
        ? "completed"
        : "suite-or-environment-failure",
    exitCode,
    durationMs,
    ...(failedProbe ? { probeIdentity: `VTC008_${probe.toUpperCase()}_ASSERTION_PROBE` } : {}),
    stages: events.map(safeEvent).filter(Boolean).slice(0, 64),
    browserFailures: failures,
    fixtureDiagnostics: fixtureDiagnostics.map(safeTripFixture).filter(Boolean).slice(0, 64),
    fileTimings: fileTimings.map(safeFileTiming).filter(Boolean).slice(0, 128),
    browserTimings: browserTimings
      .map(safeBrowserTiming)
      .filter(Boolean)
      .slice(0, browserTimingLimit),
  };
}
