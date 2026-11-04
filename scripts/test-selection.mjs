import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Focused local runs. CI never passes a selection and always runs every lane.
export const selectableLanes = [
  "unit",
  "contracts",
  "integration",
  "persistence",
  "recovery",
  "e2e",
];
export const browserProjects = ["desktop-chromium", "tablet-chromium", "mobile-chromium"];
const filePattern =
  /^test\/(unit|contracts|integration)\/[a-z0-9][a-z0-9-]*\.test\.ts$|^test\/e2e\/[a-z0-9][a-z0-9-]*\.spec\.ts$/;
const singleFileLanes = {
  "test/persistence/persistence.test.ts": "persistence",
  "test/persistence/recovery.test.ts": "recovery",
};
const maxTokens = 200;

export function laneOf(token) {
  if (selectableLanes.includes(token)) return token;
  if (Object.hasOwn(singleFileLanes, token)) return singleFileLanes[token];
  const match = filePattern.exec(token);
  if (!match) return undefined;
  return match[1] ?? "e2e";
}

// Tokens are lane names (whole lane) or test files. Returns lanes in canonical order;
// an empty file list means the whole lane.
export function groupSelection(tokens, exists = existsSync) {
  if (!Array.isArray(tokens) || tokens.length === 0 || tokens.length > maxTokens)
    throw new Error("TEST_SELECTION_INVALID");
  const groups = new Map();
  for (const token of tokens) {
    const lane = typeof token === "string" ? laneOf(token) : undefined;
    if (!lane) throw new Error("TEST_SELECTION_INVALID");
    const whole = lane === token || Object.hasOwn(singleFileLanes, token);
    if (!whole && !exists(token)) throw new Error("TEST_SELECTION_MISSING_FILE");
    const files = groups.get(lane);
    if (whole) groups.set(lane, null);
    else if (files !== null) groups.set(lane, [...new Set([...(files ?? []), token])]);
  }
  return selectableLanes
    .filter((lane) => groups.has(lane))
    .map((lane) => ({ lane, files: groups.get(lane) ?? [] }));
}

export function serializeSelection(tokens) {
  return tokens.join(" ");
}

export function parseSelection(value) {
  return typeof value === "string" && value ? value.split(" ") : [];
}

export function validProject(value) {
  return browserProjects.includes(value);
}

const localFoci = ["all", ...selectableLanes, "failure-reporting", "selected"];

// pnpm test:local [focus] [--probe] [--skip-check] [--project <name>] [--] [lane|file ...]
export function parseLocalArguments(argv) {
  const [focus = "all", ...rest] = argv;
  if (!localFoci.includes(focus)) throw new Error("INVALID_TEST_LANE");
  const options = { focus, probe: false, skipCheck: false, project: "", tokens: [] };
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (value === "--") continue;
    if (value === "--probe") options.probe = true;
    else if (value === "--skip-check") options.skipCheck = true;
    else if (value === "--project") {
      options.project = rest[index + 1] ?? "";
      index += 1;
      if (!validProject(options.project)) throw new Error("INVALID_TEST_PROJECT");
    } else if (!value.startsWith("-")) options.tokens.push(value.replaceAll("\\", "/"));
    else throw new Error("INVALID_TEST_ARGUMENTS");
  }
  if (options.probe) {
    if (!["unit", "integration", "e2e"].includes(focus)) throw new Error("INVALID_PROBE_LANE");
    if (options.skipCheck || options.project || options.tokens.length)
      throw new Error("INVALID_TEST_ARGUMENTS");
  }
  if ((focus === "selected") !== options.tokens.length > 0)
    throw new Error("INVALID_TEST_ARGUMENTS");
  if (options.skipCheck && ["all", "failure-reporting"].includes(focus))
    throw new Error("INVALID_TEST_ARGUMENTS");
  if (options.project && focus !== "e2e" && focus !== "selected")
    throw new Error("INVALID_TEST_ARGUMENTS");
  return options;
}

// Changed paths map to tests by area. Anything unmapped selects every lane: a shared
// change is safer to over-test than to miss.
const areas = [
  {
    paths: [
      "apps/api/src/modules/identity/",
      "apps/api/src/use-cases/identity-messaging.ts",
      "apps/api/src/identity-acceptance.ts",
      "apps/web/src/features/account/",
    ],
    tests: ["identity", "account"],
  },
  {
    paths: ["apps/api/src/modules/external-identities/", "apps/web/src/features/connections/"],
    tests: ["external-identities"],
  },
  {
    paths: ["apps/api/src/modules/admissions/", "apps/web/src/features/admissions/"],
    tests: ["admissions", "applications", "identity-admission"],
  },
  { paths: ["apps/web/src/features/landing/"], tests: ["landing", "public-documents"] },
  {
    paths: ["apps/api/src/use-cases/administration.ts", "apps/web/src/features/admin/"],
    tests: ["administration", "members", "settings", "applications", "succession-limits"],
  },
  {
    paths: ["apps/api/src/modules/analytics/", "apps/web/src/features/dashboard/"],
    tests: ["analytics", "dashboard", "company-stats", "public-company-stats"],
  },
  {
    paths: [
      "apps/api/src/modules/catalogs/",
      "apps/web/src/features/catalogs/",
      "apps/web/src/shared/catalog-selectors/",
      "scripts/catalogs/",
      "test/fixtures/catalogs/",
    ],
    tests: ["catalog"],
  },
  {
    paths: ["apps/api/src/modules/events/", "apps/web/src/features/events/"],
    tests: ["events", "event-workspace"],
  },
  { paths: ["apps/api/src/modules/messaging/"], tests: ["messaging", "identity-email"] },
  {
    paths: [
      "apps/api/src/modules/notifications/",
      "apps/api/src/notifications-acceptance",
      "apps/web/src/features/notifications/",
    ],
    tests: ["notifications"],
  },
  {
    paths: [
      "apps/api/src/modules/manual-reports/",
      "apps/web/src/features/manual-reports/",
      "packages/blob-storage/",
      "test/fixtures/manual-",
    ],
    tests: ["manual"],
  },
  {
    paths: [
      "apps/api/src/modules/qualifications/",
      "apps/api/src/modules/qualification-rules/",
      "apps/web/src/features/qualifications/",
      "test/fixtures/qualification-rules/",
    ],
    tests: ["qualification"],
  },
  {
    paths: [
      "apps/api/src/modules/reconciliation/",
      "apps/api/src/use-cases/trip-reconciliation.ts",
      "apps/web/src/features/review/",
    ],
    tests: ["reconciliation", "trips-corrections"],
  },
  {
    paths: ["apps/api/src/modules/telemetry/", "apps/api/src/modules/sources/"],
    tests: ["telemetry"],
  },
  { paths: ["apps/api/src/modules/trips/", "apps/web/src/features/trips/"], tests: ["trip"] },
  {
    paths: ["apps/api/src/modules/trip-decisions/", "apps/api/src/use-cases/trip-decisions.ts"],
    tests: ["trip-decisions", "trips-corrections"],
  },
  { paths: ["apps/web/src/features/drivers/"], tests: ["drivers"] },
  { paths: ["apps/web/src/features/foundation/"], tests: ["foundation", "ui-variants"] },
  {
    paths: [
      "apps/api/src/jobs.ts",
      "apps/api/src/jobs-acceptance.ts",
      "packages/jobs/",
      "packages/outbox/",
    ],
    tests: ["jobs"],
  },
  { paths: ["scripts/demo/"], tests: ["demo"] },
  {
    paths: ["deploy/development/"],
    tests: ["development-deployment", "notifications-acceptance"],
  },
  {
    paths: [
      "scripts/ci-result.mjs",
      "scripts/browser-diagnostics.mjs",
      "scripts/trip-fixture-diagnostics.mjs",
      "test/support/safe-browser-reporter.ts",
    ],
    tests: ["ci-result", "browser-diagnostics", "trip-ci-diagnostics"],
  },
  {
    paths: ["scripts/test-selection.mjs", "scripts/test-affected.mjs"],
    tests: ["test-selection"],
  },
  { paths: [".github/workflows/claude-review.yml"], tests: ["claude-review-schema"] },
];
// No runtime test covers these; `pnpm check` still runs the scaffold/document checks.
const untested = [".agents/", ".claude/", ".github/", "docs/"];

function testName(file) {
  return file.slice(file.lastIndexOf("/") + 1).replace(/\.(test|spec)\.ts$/, "");
}

export function listTestFiles(root) {
  const files = [];
  for (const [directory, suffix] of [
    ["test/unit", ".test.ts"],
    ["test/contracts", ".test.ts"],
    ["test/integration", ".test.ts"],
    ["test/e2e", ".spec.ts"],
  ])
    for (const name of readdirSync(join(root, directory)))
      if (name.endsWith(suffix)) files.push(`${directory}/${name}`);
  return files.sort();
}

// Returns selection tokens plus one human-readable reason per changed path.
export function affectedTests(changed, inventory, exists = existsSync) {
  const tokens = new Set();
  const reasons = [];
  for (const raw of changed) {
    const path = raw.replaceAll("\\", "/");
    const lane = laneOf(path);
    if (lane && lane !== path) {
      if (exists(path)) tokens.add(path);
      reasons.push(`${path}: changed test`);
      continue;
    }
    if (path.endsWith(".md")) {
      reasons.push(`${path}: documentation, no runtime tests`);
      continue;
    }
    const area = areas.find((entry) => entry.paths.some((prefix) => path.startsWith(prefix)));
    if (area) {
      const files = inventory.filter((file) =>
        area.tests.some((prefix) => testName(file).startsWith(prefix)),
      );
      for (const file of files) tokens.add(file);
      reasons.push(`${path}: ${files.length} mapped test file(s)`);
      continue;
    }
    if (path.startsWith("test/e2e/support/")) {
      tokens.add("e2e");
      reasons.push(`${path}: browser support, whole e2e lane`);
    } else if (path.startsWith("test/persistence/")) {
      tokens.add("persistence");
      tokens.add("recovery");
      reasons.push(`${path}: persistence support, persistence and recovery lanes`);
    } else if (untested.some((prefix) => path.startsWith(prefix))) {
      reasons.push(`${path}: no runtime tests (CI or documentation)`);
    } else {
      for (const name of selectableLanes) tokens.add(name);
      reasons.push(`${path}: shared or unmapped, every lane`);
    }
  }
  const whole = new Set(selectableLanes.filter((name) => tokens.has(name)));
  return {
    tokens: [...tokens].filter((token) => token === laneOf(token) || !whole.has(laneOf(token))),
    reasons,
  };
}
