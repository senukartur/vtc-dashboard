import { browserFailurePrefix, safeBrowserFailure } from "./browser-diagnostics.mjs";
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
export function requiredCi(results) {
  if (results?.quality !== "success" || results?.deployment !== "success") return 1;
  if (results.event === "pull_request") return results.artifact === "skipped" ? 0 : 1;
  return results.event === "push" &&
    results.ref === "refs/heads/main" &&
    results.artifact === "success"
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
export function collectEvents() {
  const events = [];
  const browserFailures = [];
  const fixtureDiagnostics = [];
  let pending = "";
  let oversized = false;
  return {
    events,
    browserFailures,
    fixtureDiagnostics,
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
  };
}
