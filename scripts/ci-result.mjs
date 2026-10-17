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
  return results?.quality === "success" ? 0 : 1;
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
  let pending = "";
  let oversized = false;
  return {
    events,
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
export function qualityReport(exitCode, durationMs, events, probe) {
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
  };
}
