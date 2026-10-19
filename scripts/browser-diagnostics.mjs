export const browserFiles = {
  "test/e2e/admissions.spec.ts": "admissions",
  "test/e2e/foundation.spec.ts": "foundation",
  "test/e2e/identity.spec.ts": "identity",
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

// Reject whole records with extra fields; never serialize arbitrary runner objects.
export function safeBrowserFailure(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const keys = Object.keys(value).sort().join(",");
  if (!statuses.includes(value.status)) return undefined;
  if (
    keys === "file,kind,line,project,status" &&
    value.kind === "test" &&
    Object.values(browserFiles).includes(value.file) &&
    browserProjects.includes(value.project) &&
    Number.isSafeInteger(value.line) &&
    value.line >= 1 &&
    value.line <= 100000
  )
    return {
      kind: "test",
      file: value.file,
      project: value.project,
      line: value.line,
      status: value.status,
    };
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
