export const browserFiles = {
  "test/e2e/dashboard.spec.ts": "dashboard",
  "test/e2e/events.spec.ts": "events",
  "test/e2e/notifications.spec.ts": "notifications",
  "test/e2e/notifications-real.spec.ts": "notifications-real",
  "test/e2e/events-real.spec.ts": "events-real",
  "test/e2e/administration-real.spec.ts": "administration-real",
  "test/e2e/qualifications-editor.spec.ts": "qualifications-editor",
  "test/e2e/qualifications.spec.ts": "qualifications",
  "test/e2e/qualifications-real.spec.ts": "qualifications-real",
  "test/e2e/trips-corrections.spec.ts": "trips-corrections",
  "test/e2e/trips.spec.ts": "trips",
  "test/e2e/trips-real.spec.ts": "trips-real",
  "test/e2e/account.spec.ts": "account",
  "test/e2e/account-real.spec.ts": "account-real",
  "test/e2e/catalogs.spec.ts": "catalogs",
  "test/e2e/catalogs-real.spec.ts": "catalogs-real",
  "test/e2e/admissions.spec.ts": "admissions",
  "test/e2e/foundation.spec.ts": "foundation",
  "test/e2e/navigation.spec.ts": "navigation",
  "test/e2e/identity.spec.ts": "identity",
  "test/e2e/external-identities.spec.ts": "external-identities",
  "test/e2e/landing.spec.ts": "landing",
  "test/e2e/readiness-states.spec.ts": "readiness-states",
  "test/e2e/smoke.spec.ts": "smoke",
  "test/probes/browser.spec.ts": "assertion-probe",
};
export const browserProjects = ["desktop-chromium", "tablet-chromium", "mobile-chromium"];
const statuses = ["failed", "timedOut", "interrupted"];
const categories = [
  "runner-error",
  "no-tests-started",
  "unmapped-test",
  "unreported-runner-failure",
];
export const browserFailurePrefix = "VTC_BROWSER_FAILURE ";
export const qualificationPhaseAnnotation = "vtc-qualification-promotion-phase";
export const qualificationPhaseScenario = "qualification-promotion-refresh";
export const qualificationPromotionPhases = Object.freeze([
  "setup",
  "initial-route",
  "initial-reason",
  "open-promotion",
  "confirm-promotion",
  "command-arrived",
  "trigger-old-reads",
  "old-reads-held",
  "release-promotion",
  "promotion-committed",
  "release-old-reads",
  "promotion-dialog-settled",
  "current-level",
  "promotion-disabled",
  "history-assignment",
  "history-level",
  "assignment-purpose",
  "assignment-level",
  "open-assignment",
  "confirm-assignment",
  "assignment-dialog-settled",
  "command-etags",
  "finally-release-command",
  "finally-release-held",
  "finally-persist-race",
  "complete",
]);
export function safeQualificationPhase(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "phase,primaryPhase,scenario" ||
    value.scenario !== qualificationPhaseScenario ||
    !qualificationPromotionPhases.includes(value.phase) ||
    !(
      value.primaryPhase === "none" ||
      qualificationPromotionPhases.slice(0, -4).includes(value.primaryPhase)
    )
  )
    return undefined;
  return {
    scenario: qualificationPhaseScenario,
    phase: value.phase,
    primaryPhase: value.primaryPhase,
  };
}
// Runtime annotations are untrusted metadata. Never inspect unrelated descriptions or locations.
export function safeQualificationAnnotations(annotations) {
  try {
    if (!Array.isArray(annotations) || annotations.length > 32) return undefined;
    let found;
    for (let i = 0; i < annotations.length; i++) {
      const item = Object.getOwnPropertyDescriptor(annotations, String(i))?.value;
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      if (Object.getOwnPropertyDescriptor(item, "type")?.value !== qualificationPhaseAnnotation)
        continue;
      if (
        found ||
        Object.keys(item).some((key) => !["type", "description", "location"].includes(key))
      )
        return undefined;
      const description = Object.getOwnPropertyDescriptor(item, "description")?.value;
      if (typeof description !== "string" || description.length > 512) return undefined;
      found = safeQualificationPhase(JSON.parse(description));
      if (!found) return undefined;
    }
    return found;
  } catch {
    return undefined;
  }
}

// Reject whole records with extra fields; never serialize arbitrary runner objects.
export function safeBrowserFailure(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const keys = Object.keys(value).sort().join(",");
  if (!statuses.includes(value.status)) return undefined;
  if (
    [
      "file,kind,line,project,status",
      "file,kind,line,phase,primaryPhase,project,scenario,status",
    ].includes(keys) &&
    value.kind === "test" &&
    Object.values(browserFiles).includes(value.file) &&
    browserProjects.includes(value.project) &&
    Number.isSafeInteger(value.line) &&
    value.line >= 1 &&
    value.line <= 100000
  ) {
    const result = {
      kind: "test",
      file: value.file,
      project: value.project,
      line: value.line,
      status: value.status,
    };
    if (keys === "file,kind,line,project,status") return result;
    const phase =
      value.file === "qualifications"
        ? safeQualificationPhase({
            scenario: value.scenario,
            phase: value.phase,
            primaryPhase: value.primaryPhase,
          })
        : undefined;
    return phase ? { ...result, ...phase } : undefined;
  }
  if (
    keys === "category,kind,status" &&
    value.kind === "global" &&
    categories.includes(value.category)
  )
    return { kind: "global", category: value.category, status: value.status };
  return undefined;
}
export function browserFailureLine(value) {
  const failure = safeBrowserFailure(value);
  if (!failure) throw new Error("INVALID_BROWSER_FAILURE");
  return `${browserFailurePrefix}${JSON.stringify(failure)}`;
}

export const browserPreparationPrefix = "VTC_BROWSER_PREPARATION ";
const preparationPhases = [
  "ownership",
  "synthetic_ddl",
  "ownership_close",
  "migrations",
  "bootstrap",
  "credential_hash",
  "credential_insert",
  "unit_close",
];
const preparationCategories = [
  "completed",
  "nonzero-exit",
  "signal-exit",
  "spawn-error",
  "pipe-error",
  "deadline",
];
const databaseOperations = [
  "connection_open",
  "session_configuration",
  "session_charset",
  "migration_lock",
  "migration_baseline",
  "migration_autocommit",
  "migration_journal_create",
  "migration_history_read",
  "migration_journal_insert",
  "migration_statement",
  "migration_journal_finalize",
];
const milliseconds = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 86400000;
function fields(value, required, optional = []) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
  );
}

// Preparation is a separate diagnostic channel, never a browser assertion failure record.
export function safeBrowserPreparation(value) {
  if (
    fields(value, ["kind", "state", "category", "configuredTimeoutMs", "durationMs"]) &&
    value.kind === "wrapper" &&
    ["success", "failed"].includes(value.state) &&
    preparationCategories.includes(value.category) &&
    (value.state !== "success" || value.category === "completed") &&
    milliseconds(value.durationMs) &&
    milliseconds(value.configuredTimeoutMs) &&
    value.configuredTimeoutMs > 0
  )
    return {
      kind: "wrapper",
      state: value.state,
      category: value.category,
      configuredTimeoutMs: value.configuredTimeoutMs,
      durationMs: value.durationMs,
    };
  if (
    !fields(
      value,
      ["kind", "phase", "state", "durationMs", "totalDurationMs"],
      ["credential", "applied", "databaseOperation"],
    ) ||
    value.kind !== "phase" ||
    !preparationPhases.includes(value.phase) ||
    !["started", "success", "failed"].includes(value.state) ||
    !milliseconds(value.durationMs) ||
    !milliseconds(value.totalDurationMs)
  )
    return undefined;
  const result = {
    kind: "phase",
    phase: value.phase,
    state: value.state,
    durationMs: value.durationMs,
    totalDurationMs: value.totalDurationMs,
  };
  if (Object.hasOwn(value, "credential")) {
    if (
      !["credential_hash", "credential_insert"].includes(value.phase) ||
      ![1, 2, 3].includes(value.credential)
    )
      return undefined;
    result.credential = value.credential;
  }
  if (Object.hasOwn(value, "applied")) {
    if (
      value.phase !== "migrations" ||
      value.state !== "success" ||
      !Number.isSafeInteger(value.applied) ||
      value.applied < 0
    )
      return undefined;
    result.applied = value.applied;
  }
  if (Object.hasOwn(value, "databaseOperation")) {
    const context = value.databaseOperation;
    if (
      value.state !== "failed" ||
      !fields(context, ["operation", "wireDeadlineMs", "elapsedMs"]) ||
      !databaseOperations.includes(context.operation) ||
      !milliseconds(context.wireDeadlineMs) ||
      context.wireDeadlineMs < 1 ||
      !milliseconds(context.elapsedMs)
    )
      return undefined;
    result.databaseOperation = {
      operation: context.operation,
      wireDeadlineMs: context.wireDeadlineMs,
      elapsedMs: context.elapsedMs,
    };
  }
  return result;
}

export function browserPreparationLine(value) {
  const preparation = safeBrowserPreparation(value);
  if (!preparation) throw new Error("INVALID_BROWSER_PREPARATION");
  return `${browserPreparationPrefix}${JSON.stringify(preparation)}`;
}
