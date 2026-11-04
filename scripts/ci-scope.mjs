import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Owner-approved path rule (VTC-070, 2026-11-03): on pull requests the deployment rehearsal
// runs only when the PR touches what it exercises; pushes to main always run it. Every other
// path skips it, so keep this list broad.
const rehearsalPrefixes = [
  "deploy/",
  "third_party/",
  "packages/db/",
  "packages/jobs/",
  "packages/outbox/",
  "packages/blob-storage/",
  "apps/api/src/platform/",
  "apps/api/src/modules/identity/",
  "apps/api/src/modules/manual-reports/",
  "apps/api/src/modules/messaging/",
  "apps/api/src/modules/notifications/",
  ".github/workflows/ci.yml",
  "scripts/ci-scope.mjs",
  "scripts/ci-result.mjs",
];
const rehearsalFiles = [
  "Dockerfile",
  ".dockerignore",
  ".npmrc",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
];

export function rehearsalPath(path) {
  return (
    rehearsalFiles.includes(path) ||
    rehearsalPrefixes.some((prefix) => path.startsWith(prefix)) ||
    // Production image inputs: every manifest and the API entry, composition and acceptance files.
    /(^|\/)package\.json$/.test(path) ||
    /^apps\/api\/src\/[^/]+$/.test(path)
  );
}

// Returns "true" or "false" for the workflow output. Owner-approved policy (VTC-072): a main push
// skips it because the strict ruleset already rehearsed the same merge candidate on its PR when
// the path rule required it; the weekly schedule and manual dispatch always run it in full.
export function rehearsalScope(event, paths) {
  if (event === "push") return "false";
  if (event === "schedule" || event === "workflow_dispatch") return "true";
  if (event !== "pull_request") throw new Error("CI_SCOPE_EVENT_INVALID");
  if (!Array.isArray(paths)) throw new Error("CI_SCOPE_PATHS_INVALID");
  return paths.some(rehearsalPath) ? "true" : "false";
}

function changedPaths() {
  // pull_request checks out the merge candidate: parent 1 is the base, parent 2 the PR head.
  const parents = execFileSync("git", ["rev-list", "--parents", "-n", "1", "HEAD"], {
    encoding: "utf8",
  })
    .trim()
    .split(" ");
  if (parents.length !== 3) throw new Error("CI_SCOPE_MERGE_CANDIDATE_REQUIRED");
  return execFileSync("git", ["diff", "--name-only", "-z", "HEAD^1", "HEAD"], {
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const event = process.env.GITHUB_EVENT_NAME;
  const paths = event === "pull_request" ? changedPaths() : [];
  const rehearsal = rehearsalScope(event, paths);
  const matched = paths.filter(rehearsalPath);
  console.log(
    `Deployment rehearsal: ${rehearsal === "true" ? "required" : "skipped by scope rule"} (${event}, ${paths.length} changed, ${matched.length} matched)`,
  );
  for (const path of matched.slice(0, 20)) console.log(`  ${path}`);
  if (!process.env.GITHUB_OUTPUT) throw new Error("CI_SCOPE_OUTPUT_REQUIRED");
  appendFileSync(process.env.GITHUB_OUTPUT, `rehearsal=${rehearsal}\n`);
}
