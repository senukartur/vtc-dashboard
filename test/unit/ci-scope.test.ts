import { expect, test } from "vitest";
import { rehearsalPath, rehearsalScope } from "../../scripts/ci-scope.mjs";

test("main pushes skip the rehearsal while the schedule and manual dispatch always run it", () => {
  expect(rehearsalScope("push", [])).toBe("false");
  expect(rehearsalScope("push", ["deploy/development/rehearsal.py"])).toBe("false");
  for (const event of ["schedule", "workflow_dispatch"])
    expect(rehearsalScope(event, [])).toBe("true");
  for (const event of ["workflow_run", "pull_request_target", "", undefined])
    expect(() => rehearsalScope(event, [])).toThrow("CI_SCOPE_EVENT_INVALID");
});

test("pull requests require it only for paths the rehearsal exercises", () => {
  for (const path of [
    "deploy/development/rehearsal.py",
    "third_party/sharp-libvips-1.3.4/lib/libvips-cpp.so",
    "Dockerfile",
    ".dockerignore",
    "package.json",
    "apps/api/package.json",
    "pnpm-lock.yaml",
    "packages/db/migrations/0016_notifications.sql",
    "packages/db/src/client.ts",
    "packages/jobs/src/index.ts",
    "packages/outbox/src/index.ts",
    "packages/blob-storage/src/index.ts",
    "apps/api/src/server.ts",
    "apps/api/src/jobs.ts",
    "apps/api/src/notifications-acceptance.ts",
    "apps/api/src/platform/config.ts",
    "apps/api/src/modules/notifications/service.ts",
    "apps/api/src/modules/identity/routes.ts",
    "apps/api/src/modules/manual-reports/codec.ts",
    "apps/api/src/modules/messaging/mail.ts",
    ".github/workflows/ci.yml",
    "scripts/ci-scope.mjs",
    "scripts/ci-result.mjs",
  ]) {
    expect(rehearsalPath(path), path).toBe(true);
    expect(rehearsalScope("pull_request", ["docs/CONCEPT.MD", path])).toBe("true");
  }
  for (const path of [
    "apps/web/src/features/events/EventsPage.tsx",
    "apps/api/src/modules/events/service.ts",
    "apps/api/src/use-cases/administration.ts",
    "test/e2e/events.spec.ts",
    "docs/development/ci.md",
    "scripts/test-lanes.ts",
  ])
    expect(rehearsalPath(path), path).toBe(false);
  expect(
    rehearsalScope("pull_request", [
      "apps/web/src/features/events/EventsPage.tsx",
      "apps/api/src/modules/events/service.ts",
      "docs/development/ci.md",
    ]),
  ).toBe("false");
  expect(rehearsalScope("pull_request", [])).toBe("false");
  expect(() => rehearsalScope("pull_request", undefined)).toThrow("CI_SCOPE_PATHS_INVALID");
});
