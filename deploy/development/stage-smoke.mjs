// Root-only `operations.py stage-smoke`: signs in a seeded fixture account under the real runtime
// account and requires every product page's read routes to answer. Prints statuses, never data.
import { readFileSync } from "node:fs";
import { createUnitOfWork } from "@vtc/db";
import { createApp } from "../dist/app.js";
import { readConfig } from "../dist/platform/config/env.js";
import { composeIdentity } from "../dist/use-cases/identity-messaging.js";

const watchdog = setTimeout(() => process.exit(1), 100000);
const today = new Date();
const month = (offset) =>
  new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + offset, 1))
    .toISOString()
    .slice(0, 10);
const range = `fromDate=${month(-1)}&toDateExclusive=${month(1)}`;
const routes = [
  "/api/v1/me",
  "/api/v1/me/identity",
  "/api/v1/me/connection-capabilities",
  "/api/v1/me/telemetry-tokens",
  "/api/v1/me/trip-status-summary",
  "/api/v1/me/upcoming-event",
  "/api/v1/me/upload-policy",
  "/api/v1/me/manual-drafts",
  "/api/v1/me/manual-reports",
  "/api/v1/me/notification-preferences",
  "/api/v1/me/qualification-progress?game=ets2",
  "/api/v1/me/qualification-progress?game=ats",
  "/api/v1/members",
  "/api/v1/notifications",
  "/api/v1/events",
  `/api/v1/analytics/company?${range}`,
  `/api/v1/analytics/leaderboard?${range}`,
  "/api/v1/trips?scope=mine&limit=5",
  "/api/v1/trips?scope=company&limit=5",
  "/api/v1/trips?scope=review&decision=pending_review",
  "/api/v1/qualification-levels?game=ets2",
  "/api/v1/catalogs/revisions?game=ets2",
  "/api/v1/reconciliation-candidates",
  "/api/v1/admin/members",
  "/api/v1/admin/applications",
  "/api/v1/admin/audit",
  "/api/v1/admin/company-settings",
  "/api/v1/admin/qualification-members",
  "/api/v1/admin/source-capabilities",
  "/api/v1/admin/catalog-import-policy",
];
let unit, app;
try {
  const config = readConfig();
  const password = readFileSync(0, "utf8").trim();
  unit = createUnitOfWork(config.database);
  const composed = composeIdentity(
    unit,
    config.identity,
    config.mail,
    config.admissions,
    config.externalIdentities,
    config.catalogs,
    config.trips,
    config.telemetry,
    config.manualReports,
    config.qualifications,
    config.events,
    config.reconciliation,
    config.tripDecisions,
    config.analytics,
    config.notifications,
  );
  app = await createApp({ checkReadiness: async () => true, ...composed });
  // Fixture member 1 is the seeded deputy director, who can read every administrative page.
  const login = await composed.identity.login("demo.driver.1@example.invalid", password);
  const cookie = login.cookies.map((part) => part.split(";", 1)[0]).join("; ");
  const failed = [];
  for (const url of routes) {
    const { statusCode } = await app.inject({
      method: "GET",
      url,
      headers: { cookie, origin: config.identity.origin },
    });
    console.log(`${statusCode} ${url.split("?")[0]}`);
    if (statusCode >= 400) failed.push(url);
  }
  if (failed.length) throw new Error("STAGE_SMOKE_ROUTES_FAILED");
} catch (error) {
  console.error(
    error instanceof Error && /^STAGE_/.test(error.message) ? error.message : "STAGE_SMOKE_FAILED",
  );
  process.exitCode = 1;
} finally {
  await app?.close();
  await unit?.close();
  clearTimeout(watchdog);
}
